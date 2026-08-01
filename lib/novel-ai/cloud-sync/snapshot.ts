import { NOVEL_STORES, type NovelRepository } from "../repository/contracts";
import { CLOUD_SYNC_SCHEMA_VERSION, type CloudProjectSnapshot } from "./types";

const TRANSFER_EXCLUDED_STORES = new Set([
  "backups",
  "settings",
  "aiJobs",
  "migrationJournal",
  "operationJournal",
]);

const DEVICE_ONLY_STORES = new Set([
  "characterPrivateArcs",
  "characterSimulations",
  "characterSimulationTurns",
]);

const SENSITIVE_KEYS = new Set([
  "accesstoken",
  "refreshtoken",
  "apikey",
  "adminToken".toLowerCase(),
  "authorization",
  "cookie",
  "password",
  "secret",
  "token",
  "endpoint",
  "baseurl",
  "connectionstring",
]);

const CREDENTIAL_PATTERN = /\b(?:vcp|sbp|sk|gh[pousr])_[A-Za-z0-9_-]{16,}\b|\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*\b/iu;

function stableStringifyInternal(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringifyInternal).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringifyInternal(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function stableCloudStringify(value: unknown) {
  return stableStringifyInternal(value);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashCloudRecords(records: Record<string, unknown[]>) {
  return sha256(stableCloudStringify(records));
}

function isDeviceOnlyRecord(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.visibility === "author-only"
    || record.visibility === "AUTHOR_ONLY"
    || record.scope === "AUTHOR_ONLY"
    || record.privacyLevel === "device_only"
    || record.privacyLevel === "author_only"
    || record.authorOnly === true
    || record.author_only === true
    || record.privateSimulation === true
    || record.private_simulation === true
    || record.privateMode === true
    || record.mode === "private_simulation"
    || record.canonType === "PRIVATE_SIMULATION"
    || record.originType === "PRIVATE_SIMULATION"
    || record.approvalStatus === "PRIVATE_ONLY"
    || record.status === "PRIVATE_SIMULATION"
    || record.status === "private_simulation";
}

function sanitizeValue(
  value: unknown,
  counters: { sanitizedFieldCount: number },
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, counters));
  }
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.replace(/[_-]/gu, "").toLowerCase();
    if (
      SENSITIVE_KEYS.has(normalizedKey)
      || normalizedKey.startsWith("private")
      || normalizedKey.startsWith("authoronly")
    ) {
      counters.sanitizedFieldCount += 1;
      continue;
    }
    output[key] = sanitizeValue(item, counters);
  }
  return output;
}

export async function buildCloudProjectSnapshot(
  repository: NovelRepository,
  projectId: string,
): Promise<{ snapshot: CloudProjectSnapshot; contentHash: string }> {
  const exported = await repository.exportProject(projectId);
  const counters = { sanitizedFieldCount: 0 };
  let excludedRecordCount = 0;
  const records: Record<string, unknown[]> = {};
  for (const store of NOVEL_STORES) {
    if (TRANSFER_EXCLUDED_STORES.has(store)) continue;
    if (DEVICE_ONLY_STORES.has(store)) {
      excludedRecordCount += (exported[store] ?? []).length;
      records[store] = [];
      continue;
    }
    const rows = exported[store] ?? [];
    const allowed = rows.filter((row) => {
      const excluded = isDeviceOnlyRecord(row);
      if (excluded) excludedRecordCount += 1;
      return !excluded;
    });
    records[store] = allowed
      .map((row) => sanitizeValue(row, counters))
      .sort((left, right) => String((left as { id?: unknown }).id ?? "")
        .localeCompare(String((right as { id?: unknown }).id ?? "")));
  }
  const serializedRecords = stableCloudStringify(records);
  if (CREDENTIAL_PATTERN.test(serializedRecords)) {
    throw Object.assign(new Error("雲端同步資料疑似含有憑證，已停止上傳。"), {
      code: "CLOUD_SYNC_CREDENTIAL_BLOCKED",
      retryable: false,
    });
  }
  const snapshot: CloudProjectSnapshot = {
    schemaVersion: CLOUD_SYNC_SCHEMA_VERSION,
    projectId,
    createdAt: new Date().toISOString(),
    contentHash: await hashCloudRecords(records),
    records,
    recordCounts: Object.fromEntries(
      Object.entries(records).map(([store, rows]) => [store, rows.length]),
    ),
    privacyReport: {
      excludedStores: [...TRANSFER_EXCLUDED_STORES, ...DEVICE_ONLY_STORES].sort(),
      excludedRecordCount,
      sanitizedFieldCount: counters.sanitizedFieldCount,
      credentialScan: "passed",
    },
  };
  return {
    snapshot,
    contentHash: snapshot.contentHash,
  };
}

export function assertCloudSnapshot(snapshot: CloudProjectSnapshot) {
  if (snapshot.schemaVersion !== CLOUD_SYNC_SCHEMA_VERSION) {
    throw Object.assign(new Error("雲端快照版本不相容。"), {
      code: "CLOUD_SYNC_SCHEMA_UNSUPPORTED",
    });
  }
  if (
    !snapshot.projectId
    || !/^[a-f0-9]{64}$/u.test(snapshot.contentHash)
    || !snapshot.records
    || !Array.isArray(snapshot.records.projects)
  ) {
    throw Object.assign(new Error("雲端快照缺少作品資料。"), {
      code: "CLOUD_SYNC_SNAPSHOT_INVALID",
    });
  }
  if (snapshot.records.projects.length !== 1) {
    throw Object.assign(new Error("雲端快照作品範圍不正確。"), {
      code: "CLOUD_SYNC_PROJECT_SCOPE_INVALID",
    });
  }
  if (CREDENTIAL_PATTERN.test(stableCloudStringify(snapshot.records))) {
    throw Object.assign(new Error("雲端快照含有禁止的憑證內容。"), {
      code: "CLOUD_SYNC_CREDENTIAL_BLOCKED",
    });
  }
}

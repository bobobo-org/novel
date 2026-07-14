import crypto from "crypto";
import { z } from "zod";
import { JsonRecord, normalizeVersionChangeSets } from "../../story-bible-change-sets";

export const STORY_BIBLE_INTEGRITY_ALGORITHM = "SHA-256";
export const STORY_BIBLE_INTEGRITY_SCHEMA_VERSION = "story-bible-integrity-v1";

const SET_LIKE_KEYS = new Set([
  "candidateIds",
  "candidate_ids",
  "approvedCandidateIds",
  "approved_candidate_ids",
  "mutationRequestIds",
  "mutation_request_ids",
  "aliases",
  "relatedCharacters",
  "relatedEvents",
  "sourceRefs",
  "source_refs",
  "possessions",
]);

export const IntegrityQuerySchema = z.object({
  projectId: z.string().min(1).max(120),
  fromVersion: z.coerce.number().int().min(1).optional(),
  toVersion: z.coerce.number().int().min(1).optional(),
  includeDetails: z.coerce.boolean().default(false),
  verifyPayload: z.coerce.boolean().default(true),
  verifyParentChain: z.coerce.boolean().default(true),
});

export const IntegrityBackfillSchema = z.object({
  projectId: z.string().min(1).max(120),
  dryRun: z.boolean().default(true),
  fromVersion: z.number().int().min(1).optional(),
  toVersion: z.number().int().min(1).optional(),
  batchSize: z.number().int().min(1).max(1000).default(100),
  stopOnError: z.boolean().default(true),
});

export class StoryBibleIntegrityError extends Error {
  constructor(
    public errorCode: string,
    message: string,
    public status = 400,
    public details: JsonRecord = {},
  ) {
    super(message);
    this.name = "StoryBibleIntegrityError";
  }
}

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { url: url.replace(/\/$/, ""), key };
}

async function rest<T>(table: string, init: RequestInit & { query?: string } = {}): Promise<T> {
  const cfg = supabaseConfig();
  if (!cfg.url || !cfg.key) throw new StoryBibleIntegrityError("STORY_BIBLE_PERSISTENCE_NOT_CONFIGURED", "Story Bible persistence is not configured.", 503);
  const query = init.query ? `?${init.query}` : "";
  const response = await fetch(`${cfg.url}/rest/v1/${table}${query}`, {
    ...init,
    headers: {
      apikey: cfg.key,
      authorization: `Bearer ${cfg.key}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new StoryBibleIntegrityError("STORY_BIBLE_INTEGRITY_DB_ERROR", `Story Bible database error: ${response.status}`, 500, {
      technicalMessage: text.slice(0, 300),
      retryable: true,
    });
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function queryValue(value: string) {
  return encodeURIComponent(value);
}

function isPlainObject(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeDateString(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value.normalize("NFC") : new Date(parsed).toISOString();
}

function canonicalSortKey(value: unknown) {
  return stableCanonicalize(value);
}

function shouldSortArray(path: string[]) {
  const last = path[path.length - 1] || "";
  return SET_LIKE_KEYS.has(last);
}

export function stableCanonicalize(value: unknown, path: string[] = []): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(normalizeDateString(value));
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "null";
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    const items = value.map((item) => ({ item, key: canonicalSortKey(item) }));
    const normalizedItems = shouldSortArray(path)
      ? items.sort((a, b) => a.key.localeCompare(b.key)).map((x) => x.item)
      : items.map((x) => x.item);
    return `[${normalizedItems.map((item, index) => stableCanonicalize(item, [...path, String(index)])).join(",")}]`;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key.normalize("NFC"))}:${stableCanonicalize(item, [...path, key])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export function computeIntegrityHash(payload: unknown) {
  return crypto.createHash("sha256").update(stableCanonicalize(payload)).digest("hex");
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function buildIntegrityPayload(version: JsonRecord, previousIntegrityHash: string | null = null) {
  return {
    projectId: version.project_id || null,
    versionId: version.id || null,
    versionNumber: Number(version.version_number || 0),
    parentVersionId: version.parent_version_id || null,
    operationType: version.operation_type || null,
    operationSource: version.operation_source || "legacy_unknown",
    candidateIds: asArray(version.candidate_ids),
    mutationRequestIds: asArray(version.mutation_request_ids),
    normalizedChangeSet: normalizeVersionChangeSets(version),
    summary: version.summary || "",
    createdBy: version.created_by || "system",
    createdAt: version.created_at || null,
    sourceProviderType: version.source_provider_type || "legacy_unknown",
    sourceProviderLocation: version.source_provider_location || "unknown",
    sourceModelId: version.source_model_id || null,
    sourceExecutionId: version.source_execution_id || null,
    sourceMode: version.source_mode || "legacy",
    dataLeftDevice: version.data_left_device ?? null,
    storageLocation: version.storage_location || "legacy_unknown",
    canonicalAuthority: version.canonical_authority || "local",
    previousIntegrityHash,
    integritySchemaVersion: STORY_BIBLE_INTEGRITY_SCHEMA_VERSION,
  };
}

export function verifyVersionIntegrity(version: JsonRecord, previousIntegrityHash: string | null = null) {
  const expectedHash = computeIntegrityHash(buildIntegrityPayload(version, previousIntegrityHash));
  const actualHash = typeof version.integrity_hash === "string" ? version.integrity_hash : null;
  const schemaVersion = version.integrity_schema_version || null;
  const algorithm = version.integrity_algorithm || null;
  const status = version.integrity_status || "legacy_uninitialized";
  const supported = (!schemaVersion || schemaVersion === STORY_BIBLE_INTEGRITY_SCHEMA_VERSION)
    && (!algorithm || algorithm === STORY_BIBLE_INTEGRITY_ALGORITHM);
  return {
    versionId: version.id,
    versionNumber: Number(version.version_number || 0),
    valid: Boolean(actualHash && expectedHash === actualHash && supported),
    expectedHash,
    actualHash,
    previousIntegrityHash: version.previous_integrity_hash || null,
    expectedPreviousIntegrityHash: previousIntegrityHash,
    previousHashValid: (version.previous_integrity_hash || null) === previousIntegrityHash,
    status,
    supported,
    integrityAlgorithm: algorithm,
    integritySchemaVersion: schemaVersion,
  };
}

export async function readIntegrityVersions(projectId: string) {
  return rest<JsonRecord[]>("story_bible_versions", {
    query: `project_id=eq.${queryValue(projectId)}&select=*&order=version_number.asc&limit=10000`,
  });
}

function rangeFilter(versions: JsonRecord[], from?: number, to?: number) {
  return versions.filter((version) => {
    const number = Number(version.version_number || 0);
    if (from != null && number < from) return false;
    if (to != null && number > to) return false;
    return true;
  });
}

function duplicateNumbers(versions: JsonRecord[]) {
  const counts = new Map<number, number>();
  for (const version of versions) counts.set(Number(version.version_number || 0), (counts.get(Number(version.version_number || 0)) || 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([number]) => number);
}

function missingNumbers(versions: JsonRecord[]) {
  if (versions.length === 0) return [];
  const numbers = versions.map((version) => Number(version.version_number || 0)).filter((x) => x > 0);
  const set = new Set(numbers);
  const max = Math.max(...numbers);
  const missing: number[] = [];
  for (let i = 1; i <= max; i += 1) if (!set.has(i)) missing.push(i);
  return missing;
}

export async function verifyVersionChain(input: unknown) {
  const query = IntegrityQuerySchema.parse(input);
  const started = Date.now();
  const versions = await readIntegrityVersions(query.projectId);
  if (versions.length === 0) {
    throw new StoryBibleIntegrityError("PROJECT_NOT_FOUND", "No Story Bible versions exist for this project.", 404, { retryable: false });
  }
  const selected = rangeFilter(versions, query.fromVersion, query.toVersion);
  if (selected.length === 0) {
    throw new StoryBibleIntegrityError("VERSION_RANGE_INVALID", "No versions match this range.", 400, { retryable: false });
  }
  const byId = new Map(versions.map((version) => [String(version.id), version]));
  const details = [];
  let previousHash: string | null = null;
  let validVersions = 0;
  let invalidVersions = 0;
  let pendingVersions = 0;
  let firstInvalidVersion: JsonRecord | null = null;
  const invalidParentLinks: Array<JsonRecord> = [];
  let parentChainValid = true;

  for (const version of versions) {
    const number = Number(version.version_number || 0);
    const parentId = version.parent_version_id ? String(version.parent_version_id) : null;
    if (number === 1 && parentId !== null) {
      parentChainValid = false;
      invalidParentLinks.push({ versionNumber: number, versionId: version.id, reason: "version_1_parent_must_be_null" });
    }
    if (number > 1) {
      const parent = parentId ? byId.get(parentId) : null;
      if (!parent || parent.project_id !== version.project_id || Number(parent.version_number || 0) !== number - 1) {
        parentChainValid = false;
        invalidParentLinks.push({ versionNumber: number, versionId: version.id, parentVersionId: parentId, reason: "parent_must_be_previous_version_same_project" });
      }
    }
    const check = verifyVersionIntegrity(version, previousHash);
    const inRange = selected.some((selectedVersion) => selectedVersion.id === version.id);
    if (inRange) {
      if (check.valid && check.previousHashValid) validVersions += 1;
      else if (!check.actualHash || check.status === "pending" || check.status === "legacy_uninitialized") pendingVersions += 1;
      else invalidVersions += 1;
      if ((!check.valid || !check.previousHashValid) && !firstInvalidVersion) firstInvalidVersion = {
        versionId: version.id,
        versionNumber: number,
        expectedHash: check.expectedHash,
        actualHash: check.actualHash,
        expectedPreviousIntegrityHash: check.expectedPreviousIntegrityHash,
        previousIntegrityHash: check.previousIntegrityHash,
        integrityStatus: check.status,
      };
      details.push(check);
    }
    previousHash = check.actualHash || check.expectedHash;
  }

  const missingVersionNumbers = missingNumbers(versions);
  const duplicateVersionNumbers = duplicateNumbers(versions);
  const valid = invalidVersions === 0
    && pendingVersions === 0
    && parentChainValid
    && missingVersionNumbers.length === 0
    && duplicateVersionNumbers.length === 0;
  const lastSelected = selected[selected.length - 1];
  const lastCheck = details[details.length - 1] as JsonRecord | undefined;
  return {
    valid,
    projectId: query.projectId,
    checkedVersions: selected.length,
    validVersions,
    invalidVersions,
    pendingVersions,
    firstInvalidVersion,
    expectedHash: firstInvalidVersion?.expectedHash || null,
    actualHash: firstInvalidVersion?.actualHash || null,
    parentChainValid,
    missingVersionNumbers,
    duplicateVersionNumbers,
    invalidParentLinks,
    integrityAlgorithm: STORY_BIBLE_INTEGRITY_ALGORITHM,
    integritySchemaVersion: STORY_BIBLE_INTEGRITY_SCHEMA_VERSION,
    rootHash: lastCheck?.actualHash || lastCheck?.expectedHash || lastSelected?.integrity_hash || null,
    checkedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    details: query.includeDetails ? details : undefined,
  };
}

export async function updateVersionIntegrity(projectId: string, versionId: string, patch: JsonRecord) {
  const rows = await rest<JsonRecord[]>("story_bible_versions", {
    method: "PATCH",
    query: `project_id=eq.${queryValue(projectId)}&id=eq.${queryValue(versionId)}&select=*`,
    body: JSON.stringify({ ...patch, integrity_computed_at: new Date().toISOString() }),
  });
  return rows[0] || null;
}

async function bulkUpdateVersionIntegrity(patches: JsonRecord[]) {
  if (patches.length === 0) return [];
  return rest<JsonRecord[]>("story_bible_versions", {
    method: "POST",
    query: "on_conflict=id&select=id,version_number,integrity_hash",
    headers: { prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(patches.map((patch) => ({ ...patch, integrity_computed_at: new Date().toISOString() }))),
  });
}

export async function backfillStoryBibleIntegrity(input: unknown) {
  const query = IntegrityBackfillSchema.parse(input);
  const started = Date.now();
  const versions = rangeFilter(await readIntegrityVersions(query.projectId), query.fromVersion, query.toVersion);
  if (versions.length === 0) {
    throw new StoryBibleIntegrityError("PROJECT_NOT_FOUND", "No Story Bible versions exist for this project.", 404, { retryable: false });
  }
  const planned: JsonRecord[] = [];
  const updated: JsonRecord[] = [];
  const conflicts: JsonRecord[] = [];
  const failures: JsonRecord[] = [];
  let pendingPatches: JsonRecord[] = [];
  let previousHash: string | null = null;

  async function flushPatches() {
    if (query.dryRun || pendingPatches.length === 0) return;
    const batch = pendingPatches;
    pendingPatches = [];
    try {
      const patchedRows = await bulkUpdateVersionIntegrity(batch);
      for (const patched of patchedRows) {
        updated.push({ versionId: patched.id, versionNumber: patched.version_number, integrityHash: patched.integrity_hash });
      }
    } catch (error) {
      for (const patch of batch) {
        failures.push({ versionId: patch.id, versionNumber: patch.version_number, error: error instanceof Error ? error.message : String(error) });
      }
      if (query.stopOnError) throw error;
    }
  }

  for (const version of versions) {
    const payloadVersion = {
      ...version,
      previous_integrity_hash: previousHash,
      integrity_algorithm: STORY_BIBLE_INTEGRITY_ALGORITHM,
      integrity_schema_version: STORY_BIBLE_INTEGRITY_SCHEMA_VERSION,
      canonical_authority: version.canonical_authority || "local",
    };
    const expectedHash = computeIntegrityHash(buildIntegrityPayload(payloadVersion, previousHash));
    const existingHash = typeof version.integrity_hash === "string" ? version.integrity_hash : "";
    const schema = String(version.integrity_schema_version || "");
    const status = String(version.integrity_status || "legacy_uninitialized");
    const canWrite = !existingHash || !schema || status === "legacy_uninitialized" || status === "pending" || status === "backfill_failed";
    const row = {
      versionId: version.id,
      versionNumber: Number(version.version_number || 0),
      previousIntegrityHash: previousHash,
      expectedHash,
      existingHash: existingHash || null,
      action: canWrite ? "backfill" : existingHash === expectedHash ? "skip-valid" : "conflict",
    };
    planned.push(row);
    if (!canWrite && existingHash !== expectedHash) {
      conflicts.push(row);
      if (!query.dryRun) {
        await updateVersionIntegrity(query.projectId, String(version.id), { integrity_status: "invalid" }).catch((error) => {
          failures.push({ ...row, error: error instanceof Error ? error.message : String(error) });
        });
      }
      if (query.stopOnError) break;
      previousHash = existingHash || expectedHash;
      continue;
    }
    if (!query.dryRun && canWrite) {
      pendingPatches.push({
          id: version.id,
          project_id: query.projectId,
          version_number: version.version_number,
          previous_integrity_hash: previousHash,
          integrity_algorithm: STORY_BIBLE_INTEGRITY_ALGORITHM,
          integrity_schema_version: STORY_BIBLE_INTEGRITY_SCHEMA_VERSION,
          integrity_hash: expectedHash,
          integrity_status: "valid",
          canonical_authority: "local",
      });
      if (pendingPatches.length >= query.batchSize) await flushPatches();
    }
    previousHash = expectedHash;
  }
  await flushPatches();

  return {
    projectId: query.projectId,
    dryRun: query.dryRun,
    scannedVersions: versions.length,
    plannedCount: planned.length,
    updatedCount: updated.length,
    conflictCount: conflicts.length,
    failureCount: failures.length,
    planned,
    updated,
    conflicts,
    failures,
    elapsedMs: Date.now() - started,
    integrityAlgorithm: STORY_BIBLE_INTEGRITY_ALGORITHM,
    integritySchemaVersion: STORY_BIBLE_INTEGRITY_SCHEMA_VERSION,
  };
}


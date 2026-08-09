import type { BackupManifest, DomainRecord, ProjectBackup } from "../domain";
import { makeRecord } from "../domain";
import { LEGACY_REQUIRED_RESTORE_STORES, NOVEL_STORES, P24A_REQUIRED_RESTORE_STORES, P24B_RC5_REQUIRED_RESTORE_STORES, P24B_RC6_REQUIRED_RESTORE_STORES, REQUIRED_RESTORE_STORES, type NovelRepository } from "./contracts";
import { validateImportRecords } from "./import-remap";
import {
  copySovereignLearningBackupSnapshot,
  createSovereignLearningBackupSnapshot,
  createSovereignLearningRepository,
  restoreSovereignLearningBackupSnapshot,
  validateSovereignLearningBackupSnapshot,
  type SovereignLearningBackupSnapshot,
  type SovereignLearningRepository,
} from "../sovereign-learning";

export type BackupPayload = {
  manifest: BackupManifest;
  records: Record<string, unknown[]>;
  sovereignLearning?: SovereignLearningBackupSnapshot;
};

type BackupOptions = {
  appCommit?: string | null;
  releaseTag?: string | null;
  sovereignLearningRepository?: SovereignLearningRepository;
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((item) => item.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("BACKUP_CRYPTO_UNAVAILABLE");
}

const EXCLUDED_BACKUP_STORES = new Set(["backups", "settings", "aiJobs", "migrationJournal", "operationJournal"]);
const SENSITIVE_KEYS = new Set(["accesstoken", "refreshtoken", "apikey", "admintoken", "authorization", "cookie", "password", "secret", "token", "endpoint", "baseurl", "connectionstring", "pairingsecret", "systemprompt", "chainofthought", "rawreasoning"]);
const TRANSIENT_ATTACHMENT_KEYS = new Set(["rawcontent", "rawbytes", "arraybuffer", "parsedtext", "fulltext", "filehandle", "blob"]);
const CREDENTIAL_PATTERN = /\b(?:vcp|sbp|gh[pousr])_[A-Za-z0-9_-]{16,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*\b/iu;

function normalizedKey(key: string) {
  return key.replace(/[_-]/gu, "").toLowerCase();
}

function sanitizeBackupValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeBackupValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const sanitized = Object.fromEntries(Object.entries(record)
    .filter(([key]) => !SENSITIVE_KEYS.has(normalizedKey(key)) && !TRANSIENT_ATTACHMENT_KEYS.has(normalizedKey(key)))
    .map(([key, item]) => [key, sanitizeBackupValue(item)]));
  if (record.conversationSchemaVersion === "conversation-attachment-v1") {
    sanitized.rawContentRetained = false;
    sanitized.localAnalysisOnly = true;
  }
  return sanitized;
}

function containsSensitiveKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSensitiveKey);
  if (typeof value === "string") return CREDENTIAL_PATTERN.test(value);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => SENSITIVE_KEYS.has(normalizedKey(key)) || TRANSIENT_ATTACHMENT_KEYS.has(normalizedKey(key)) || containsSensitiveKey(item));
}

export async function createProjectBackup(
  repository: NovelRepository,
  projectId: string,
  kind: ProjectBackup["kind"],
  release: BackupOptions = {},
) {
  const exported = await repository.exportProject(projectId);
  const records = Object.fromEntries(Object.entries(exported).filter(([store]) => !EXCLUDED_BACKUP_STORES.has(store)).map(([store, rows]) => [store, sanitizeBackupValue(rows) as unknown[]]));
  const conversationArtifactIds = new Set(
    (records.conversationArtifacts ?? [])
      .map((record) => String((record as { id?: unknown }).id ?? ""))
      .filter(Boolean),
  );
  if (Array.isArray(records.conversationMessages)) {
    records.conversationMessages = records.conversationMessages.map((record) => {
      const message = record as { candidateIds?: unknown };
      return {
        ...(record as Record<string, unknown>),
        candidateIds: Array.isArray(message.candidateIds)
          ? message.candidateIds.filter((candidateId): candidateId is string =>
            typeof candidateId === "string" && conversationArtifactIds.has(candidateId))
          : [],
      };
    });
  }
  // A backup is a recovery point, not a recursive archive of earlier recovery points.
  // Keeping nested snapshots would grow exponentially with every backup.
  const learningRepository = release.sovereignLearningRepository
    ?? createSovereignLearningRepository();
  const sovereignLearning = await createSovereignLearningBackupSnapshot(
    learningRepository,
    projectId,
  );
  const semanticBody = { records, sovereignLearning };
  const body = stableStringify(semanticBody);
  const now = new Date().toISOString();
  const manifest: BackupManifest = {
    format: "novel-project-backup", formatVersion: "novel-backup-v6", backupId: crypto.randomUUID(), projectId,
    projectSchemaVersion: "novel-repository-v8", createdAt: now, appCommit: release.appCommit ?? null, releaseTag: release.releaseTag ?? null,
    sourceDevice: "browser", contentHash: await digest(body), recordCounts: Object.fromEntries(Object.entries(records).map(([store, rows]) => [store, rows.length])),
    includedStores: Object.keys(records), compression: "none", encryption: "none",
  };
  const backup: ProjectBackup = {
    ...makeRecord(projectId, "system"),
    id: manifest.backupId,
    formatVersion: "novel-backup-v6",
    kind,
    byteSize: new TextEncoder().encode(body).byteLength,
    snapshot: records,
    sovereignLearningSnapshot: sovereignLearning,
    manifest,
  };
  await repository.put("backups", backup);
  return {
    backup,
    payload: { manifest, records, sovereignLearning } satisfies BackupPayload,
  };
}

export async function validateBackupPayload(input: unknown): Promise<{ valid: true; payload: BackupPayload } | { valid: false; reason: string }> {
  if (!input || typeof input !== "object") return { valid: false, reason: "BACKUP_INVALID_FORMAT" };
  const payload = input as BackupPayload;
  if (payload.manifest?.format !== "novel-project-backup" || !["novel-backup-v3", "novel-backup-v4", "novel-backup-v5", "novel-backup-v6"].includes(payload.manifest.formatVersion)) return { valid: false, reason: "BACKUP_UNSUPPORTED_FORMAT" };
  if (!["novel-domain-v1", "novel-repository-v4", "novel-repository-v5", "novel-repository-v6", "novel-repository-v7", "novel-repository-v8"].includes(payload.manifest.projectSchemaVersion)) return { valid: false, reason: "BACKUP_SCHEMA_UNSUPPORTED" };
  if (!payload.records || !Array.isArray(payload.records.projects) || payload.records.projects.length !== 1) return { valid: false, reason: "BACKUP_PROJECT_MISSING" };
  const project = payload.records.projects[0] as DomainRecord;
  if ((project.projectId || project.id) !== payload.manifest.projectId) return { valid: false, reason: "BACKUP_PROJECT_SCOPE_MISMATCH" };
  if (payload.sovereignLearning) {
    const learningValidation = await validateSovereignLearningBackupSnapshot(
      payload.sovereignLearning,
      payload.manifest.projectId,
    );
    if (!learningValidation.valid) return { valid: false, reason: learningValidation.reason };
  }
  const recordStores = Object.keys(payload.records).sort();
  const manifestStores = [...payload.manifest.includedStores].sort();
  if (recordStores.some((store) => !NOVEL_STORES.includes(store as (typeof NOVEL_STORES)[number]) || EXCLUDED_BACKUP_STORES.has(store))) return { valid: false, reason: "BACKUP_STORE_NOT_ALLOWED" };
  if (containsSensitiveKey(payload.records)) return { valid: false, reason: "BACKUP_SENSITIVE_DATA_NOT_ALLOWED" };
  if (recordStores.join("|") !== manifestStores.join("|")) return { valid: false, reason: "BACKUP_MANIFEST_STORE_MISMATCH" };
  if (payload.manifest.projectSchemaVersion === "novel-repository-v8") {
    const missing = REQUIRED_RESTORE_STORES.filter((store) => !recordStores.includes(store));
    if (missing.length) return { valid: false, reason: "BACKUP_REQUIRED_STORE_MISSING" };
  } else if (payload.manifest.projectSchemaVersion === "novel-repository-v7") {
    const missing = P24B_RC6_REQUIRED_RESTORE_STORES.filter((store) => !recordStores.includes(store));
    if (missing.length) return { valid: false, reason: "BACKUP_REQUIRED_STORE_MISSING" };
  } else if (payload.manifest.projectSchemaVersion === "novel-repository-v6") {
    const missing = P24B_RC5_REQUIRED_RESTORE_STORES.filter((store) => !recordStores.includes(store));
    if (missing.length) return { valid: false, reason: "BACKUP_REQUIRED_STORE_MISSING" };
  } else if (payload.manifest.projectSchemaVersion === "novel-repository-v5") {
    const missing = P24A_REQUIRED_RESTORE_STORES.filter((store) => !recordStores.includes(store));
    if (missing.length) return { valid: false, reason: "BACKUP_REQUIRED_STORE_MISSING" };
  } else if (payload.manifest.projectSchemaVersion === "novel-repository-v4") {
    const missing = LEGACY_REQUIRED_RESTORE_STORES.filter((store) => !recordStores.includes(store));
    if (missing.length) return { valid: false, reason: "BACKUP_REQUIRED_STORE_MISSING" };
  }
  for (const store of recordStores) if (payload.manifest.recordCounts[store] !== payload.records[store].length) return { valid: false, reason: "BACKUP_MANIFEST_COUNT_MISMATCH" };
  try { validateImportRecords(payload.records); } catch (error) { return { valid: false, reason: error instanceof Error ? error.message : "BACKUP_REFERENCE_INVALID" }; }
  for (const raw of payload.records.conversationMessages ?? []) {
    const message = raw as { content?: unknown; contentDigest?: unknown };
    if (typeof message.content !== "string" || await digest(message.content.normalize("NFKC")) !== message.contentDigest) {
      return { valid: false, reason: "BACKUP_CONVERSATION_MESSAGE_DIGEST_MISMATCH" };
    }
  }
  for (const raw of payload.records.conversationArtifacts ?? []) {
    const artifact = raw as { candidateContent?: unknown; candidateDigest?: unknown };
    if (typeof artifact.candidateContent !== "string" || await digest(artifact.candidateContent.normalize("NFKC")) !== artifact.candidateDigest) {
      return { valid: false, reason: "BACKUP_CONVERSATION_ARTIFACT_DIGEST_MISMATCH" };
    }
  }
  for (const raw of payload.records.conversationSummaries ?? []) {
    const summary = raw as { content?: unknown; contentDigest?: unknown };
    if (typeof summary.content !== "string" || await digest(summary.content.normalize("NFKC")) !== summary.contentDigest) {
      return { valid: false, reason: "BACKUP_CONVERSATION_SUMMARY_DIGEST_MISMATCH" };
    }
  }
  const actualHash = await digest(stableStringify(payload.sovereignLearning
    ? { records: payload.records, sovereignLearning: payload.sovereignLearning }
    : payload.records));
  if (actualHash !== payload.manifest.contentHash) return { valid: false, reason: "BACKUP_HASH_MISMATCH" };
  return { valid: true, payload };
}

async function removeImportedProject(repository: NovelRepository, projectId: string) {
  const exported = await repository.exportProject(projectId);
  for (const store of [...NOVEL_STORES].reverse()) {
    for (const row of exported[store] ?? []) {
      const id = (row as { id?: unknown }).id;
      if (typeof id === "string") await repository.remove(store, id);
    }
  }
}

/**
 * Restores Canon and the separate Sovereign Learning namespace together.
 * Each repository mutation is transactional; a cross-database failure is
 * compensated back to the pre-restore snapshots before the error escapes.
 */
export async function restoreProjectBackup(
  repository: NovelRepository,
  input: unknown,
  mode: "copy" | "replace",
  targetProjectId?: string,
  options: { sovereignLearningRepository?: SovereignLearningRepository } = {},
) {
  const validation = await validateBackupPayload(input);
  if (!validation.valid) throw new Error(validation.reason);
  const payload = validation.payload;
  const learningRepository = options.sovereignLearningRepository
    ?? createSovereignLearningRepository();
  if (mode === "replace") {
    const expectedProjectId = targetProjectId ?? payload.manifest.projectId;
    if (payload.manifest.projectId !== expectedProjectId) {
      throw new Error("BACKUP_PROJECT_SCOPE_MISMATCH");
    }
    const previousRecords = await repository.exportProject(expectedProjectId);
    const previousLearning = await createSovereignLearningBackupSnapshot(
      learningRepository,
      expectedProjectId,
    );
    try {
      const restoredId = await repository.importProject(
        payload.records,
        "replace",
        expectedProjectId,
      );
      if (payload.sovereignLearning) {
        await restoreSovereignLearningBackupSnapshot(
          learningRepository,
          payload.sovereignLearning,
          expectedProjectId,
        );
      }
      return restoredId;
    } catch (error) {
      try {
        await repository.importProject(previousRecords, "replace", expectedProjectId);
        await restoreSovereignLearningBackupSnapshot(
          learningRepository,
          previousLearning,
          expectedProjectId,
        );
      } catch (rollbackError) {
        throw Object.assign(
          new AggregateError([error, rollbackError], "Backup restore compensation failed."),
          { code: "BACKUP_RESTORE_COMPENSATION_FAILED" },
        );
      }
      throw error;
    }
  }

  let copiedProjectId: string | null = null;
  try {
    copiedProjectId = await repository.importProject(payload.records, "copy");
    if (payload.sovereignLearning) {
      const copiedLearning = await copySovereignLearningBackupSnapshot(
        payload.sovereignLearning,
        copiedProjectId,
      );
      await restoreSovereignLearningBackupSnapshot(
        learningRepository,
        copiedLearning,
        copiedProjectId,
      );
    }
    return copiedProjectId;
  } catch (error) {
    if (copiedProjectId) {
      try {
        await removeImportedProject(repository, copiedProjectId);
        await learningRepository.clearProject(copiedProjectId);
      } catch (rollbackError) {
        throw Object.assign(
          new AggregateError([error, rollbackError], "Backup copy compensation failed."),
          { code: "BACKUP_COPY_COMPENSATION_FAILED" },
        );
      }
    }
    throw error;
  }
}

export function backupDownload(payload: BackupPayload, filename: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/vnd.novel-project+json" });
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${filename || "novel"}.novel-backup.json`; anchor.click();
  URL.revokeObjectURL(url);
}

export function markdownDownload(records: Record<string, unknown[]>, filename: string) {
  const project = records.projects?.[0] as { title?: string } | undefined;
  const chapters = (records.chapters ?? []) as Array<{ title?: string; order?: number; content?: string }>;
  const markdown = [`# ${project?.title || filename || "未命名作品"}`, "", ...chapters.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).flatMap((chapter) => [`## ${chapter.title || "未命名章節"}`, "", chapter.content || "", ""])].join("\n");
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${filename || "novel"}.md`; anchor.click(); URL.revokeObjectURL(url);
}

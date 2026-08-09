import { sha256Hex, stableStringify } from "./hashing";
import type {
  LearningImportStagingRecord,
  LearningRepositoryCommit,
  SovereignLearningRepository,
} from "./repository";
import {
  SOVEREIGN_LEARNING_SCHEMA_VERSION,
  type LearnedNarrativeRule,
  type LearningAuditRecord,
  type LearningFeedbackRecord,
  type LearningPreferenceProfile,
  type LearningSourceRecord,
} from "./types";

export const SOVEREIGN_LEARNING_BACKUP_VERSION =
  "closed-ai-sovereign-learning-backup-v1" as const;

export type SovereignLearningBackupSnapshot = {
  schemaVersion: typeof SOVEREIGN_LEARNING_BACKUP_VERSION;
  projectId: string;
  createdAt: string;
  sources: LearningSourceRecord[];
  rules: LearnedNarrativeRule[];
  feedback: LearningFeedbackRecord[];
  profile: LearningPreferenceProfile | null;
  audit: LearningAuditRecord[];
  staging: LearningImportStagingRecord[];
  rawSourceContentIncluded: false;
  contentHash: string;
};

const FORBIDDEN_KEYS = new Set([
  "accesstoken",
  "refreshtoken",
  "apikey",
  "admintoken",
  "authorization",
  "cookie",
  "password",
  "secret",
  "pairingsecret",
  "systemprompt",
  "chainofthought",
  "rawreasoning",
  "rawdocument",
  "rawcontent",
  "originaltext",
  "sourcecontent",
  "documenttext",
  "textcontent",
  "plaintext",
  "prompt",
  "rawbytes",
  "arraybuffer",
  "parsedtext",
  "fulltext",
  "filehandle",
  "blob",
]);
const CREDENTIAL_PATTERN = /\b(?:vcp|sbp|gh[pousr])_[A-Za-z0-9_-]{16,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*\b/iu;
const ABSOLUTE_LOCAL_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/u;

function normalizedKey(key: string) {
  return key.replace(/[_-]/gu, "").toLowerCase();
}

function containsForbiddenData(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenData);
  if (typeof value === "string") return CREDENTIAL_PATTERN.test(value);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, item]) =>
    FORBIDDEN_KEYS.has(normalizedKey(key)) || containsForbiddenData(item));
}

function isSafeSourceReference(value: unknown) {
  return value === null || (
    typeof value === "string"
    && !ABSOLUTE_LOCAL_PATH.test(value)
    && !value.startsWith("file://")
  );
}

function hasProjectScope(value: { projectId?: unknown }, projectId: string) {
  return value.projectId === projectId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateSnapshotRecords(
  snapshot: SovereignLearningBackupSnapshot,
  expectedProjectId: string,
) {
  if (
    snapshot.sources.some((row) => !isRecord(row))
    || snapshot.rules.some((row) => !isRecord(row))
    || snapshot.feedback.some((row) => !isRecord(row))
    || snapshot.audit.some((row) => !isRecord(row))
    || snapshot.profile !== null && !isRecord(snapshot.profile)
    || snapshot.staging.some((row) =>
      !isRecord(row)
      || !Array.isArray(row.sources)
      || !Array.isArray(row.rules)
      || !Array.isArray(row.audit)
      || !Array.isArray(row.chunkManifest))
  ) {
    return "LEARNING_BACKUP_RECORD_INVALID";
  }
  const allRecords = [
    ...snapshot.sources,
    ...snapshot.rules,
    ...snapshot.feedback,
    ...(snapshot.profile ? [snapshot.profile] : []),
    ...snapshot.audit,
  ];
  if (allRecords.some((record) =>
    !record
    || !hasProjectScope(record, expectedProjectId)
    || record.schemaVersion !== SOVEREIGN_LEARNING_SCHEMA_VERSION)) {
    return "LEARNING_BACKUP_RECORD_INVALID";
  }
  if (snapshot.sources.some((source) =>
    source.rawContentRetained !== false
    || !isSafeSourceReference(source.sourceReference)
    || ABSOLUTE_LOCAL_PATH.test(source.title))) {
    return "LEARNING_BACKUP_RAW_OR_LOCAL_PATH_NOT_ALLOWED";
  }
  if (snapshot.feedback.some((feedback) => feedback.rawOutputRetained !== false)) {
    return "LEARNING_BACKUP_RAW_OUTPUT_NOT_ALLOWED";
  }
  if (snapshot.audit.some((record) => record.rawContentIncluded !== false)) {
    return "LEARNING_BACKUP_RAW_AUDIT_NOT_ALLOWED";
  }
  if (snapshot.staging.some((row) =>
    !row
    || row.projectId !== expectedProjectId
    || row.rawContentRetained !== false
    || row.sources.some((source) =>
      source.projectId !== expectedProjectId
      || source.rawContentRetained !== false
      || !isSafeSourceReference(source.sourceReference)
      || ABSOLUTE_LOCAL_PATH.test(source.title))
    || row.rules.some((rule) => rule.projectId !== expectedProjectId)
    || row.audit.some((record) =>
      record.projectId !== expectedProjectId || record.rawContentIncluded !== false))) {
    return "LEARNING_BACKUP_STAGING_INVALID";
  }
  const sourceIds = new Set([
    ...snapshot.sources.map((source) => source.id),
    ...snapshot.staging.flatMap((row) => row.sources.map((source) => source.id)),
  ]);
  if ([...snapshot.rules, ...snapshot.staging.flatMap((row) => row.rules)]
    .some((rule) => !sourceIds.has(rule.sourceId))) {
    return "LEARNING_BACKUP_SOURCE_REFERENCE_INVALID";
  }
  if (containsForbiddenData(snapshot)) return "LEARNING_BACKUP_SENSITIVE_DATA_NOT_ALLOWED";
  return null;
}

export async function createSovereignLearningBackupSnapshot(
  repository: SovereignLearningRepository,
  projectId: string,
) {
  const [sources, rules, feedback, profile, audit, staging] = await Promise.all([
    repository.listSources(projectId),
    repository.listRules(projectId),
    repository.listFeedback(projectId),
    repository.getProfile(projectId),
    repository.listAudit(projectId),
    repository.listImportStaging(projectId),
  ]);
  const body = {
    schemaVersion: SOVEREIGN_LEARNING_BACKUP_VERSION,
    projectId,
    createdAt: new Date().toISOString(),
    sources,
    rules,
    feedback,
    profile,
    audit,
    staging,
    rawSourceContentIncluded: false as const,
  };
  const snapshot = {
    ...body,
    contentHash: await sha256Hex(stableStringify(body)),
  } satisfies SovereignLearningBackupSnapshot;
  const validation = await validateSovereignLearningBackupSnapshot(snapshot, projectId);
  if (!validation.valid) throw new Error(validation.reason);
  return snapshot;
}

export async function validateSovereignLearningBackupSnapshot(
  input: unknown,
  expectedProjectId: string,
): Promise<
  | { valid: true; snapshot: SovereignLearningBackupSnapshot }
  | { valid: false; reason: string }
> {
  if (!input || typeof input !== "object") {
    return { valid: false, reason: "LEARNING_BACKUP_INVALID_FORMAT" };
  }
  const snapshot = input as SovereignLearningBackupSnapshot;
  if (
    snapshot.schemaVersion !== SOVEREIGN_LEARNING_BACKUP_VERSION
    || snapshot.projectId !== expectedProjectId
    || snapshot.rawSourceContentIncluded !== false
    || typeof snapshot.createdAt !== "string"
    || typeof snapshot.contentHash !== "string"
    || !Array.isArray(snapshot.sources)
    || !Array.isArray(snapshot.rules)
    || !Array.isArray(snapshot.feedback)
    || !Array.isArray(snapshot.audit)
    || !Array.isArray(snapshot.staging)
  ) {
    return { valid: false, reason: "LEARNING_BACKUP_INVALID_FORMAT" };
  }
  const recordError = validateSnapshotRecords(snapshot, expectedProjectId);
  if (recordError) return { valid: false, reason: recordError };
  const { contentHash, ...body } = snapshot;
  if (await sha256Hex(stableStringify(body)) !== contentHash) {
    return { valid: false, reason: "LEARNING_BACKUP_HASH_MISMATCH" };
  }
  return { valid: true, snapshot };
}

function ids<T extends { id: string }>(rows: T[]) {
  return new Set(rows.map((row) => row.id));
}

/** Replaces one project's learning namespace in one repository transaction. */
export async function restoreSovereignLearningBackupSnapshot(
  repository: SovereignLearningRepository,
  input: unknown,
  expectedProjectId: string,
) {
  const validation = await validateSovereignLearningBackupSnapshot(input, expectedProjectId);
  if (!validation.valid) throw new Error(validation.reason);
  const snapshot = validation.snapshot;
  const [oldSources, oldRules, oldFeedback, oldProfile, oldAudit, oldStaging] = await Promise.all([
    repository.listSources(expectedProjectId),
    repository.listRules(expectedProjectId),
    repository.listFeedback(expectedProjectId),
    repository.getProfile(expectedProjectId),
    repository.listAudit(expectedProjectId),
    repository.listImportStaging(expectedProjectId),
  ]);
  const nextIds = {
    sources: ids(snapshot.sources),
    rules: ids(snapshot.rules),
    feedback: ids(snapshot.feedback),
    profiles: ids(snapshot.profile ? [snapshot.profile] : []),
    audit: ids(snapshot.audit),
    staging: ids(snapshot.staging),
  };
  const commit: LearningRepositoryCommit = {
    sources: snapshot.sources,
    rules: snapshot.rules,
    feedback: snapshot.feedback,
    profiles: snapshot.profile ? [snapshot.profile] : [],
    audit: snapshot.audit,
    staging: snapshot.staging,
    remove: {
      sources: oldSources.filter((row) => !nextIds.sources.has(row.id)).map((row) => row.id),
      rules: oldRules.filter((row) => !nextIds.rules.has(row.id)).map((row) => row.id),
      feedback: oldFeedback.filter((row) => !nextIds.feedback.has(row.id)).map((row) => row.id),
      profiles: oldProfile && !nextIds.profiles.has(oldProfile.id) ? [oldProfile.id] : [],
      audit: oldAudit.filter((row) => !nextIds.audit.has(row.id)).map((row) => row.id),
      staging: oldStaging.filter((row) => !nextIds.staging.has(row.id)).map((row) => row.id),
    },
  };
  await repository.commit(commit);
  return snapshot;
}

/**
 * Creates an isolated copy of committed learning state.  Transient staging is
 * intentionally not copied because its attachment IDs are remapped by the
 * canonical repository in a separate transaction and cannot be resumed
 * safely without that private mapping.
 */
export async function copySovereignLearningBackupSnapshot(
  snapshot: SovereignLearningBackupSnapshot,
  targetProjectId: string,
) {
  const validation = await validateSovereignLearningBackupSnapshot(snapshot, snapshot.projectId);
  if (!validation.valid) throw new Error(validation.reason);
  const sourceIds = new Map(snapshot.sources.map((row) => [row.id, crypto.randomUUID()]));
  const ruleIds = new Map(snapshot.rules.map((row) => [row.id, crypto.randomUUID()]));
  const sources = snapshot.sources.map((row): LearningSourceRecord => ({
    ...row,
    id: sourceIds.get(row.id)!,
    projectId: targetProjectId,
    sourceReference: row.sourceReference?.startsWith("local-attachment:")
      ? "local-attachment:missing-after-copy"
      : row.sourceReference,
  }));
  const rules = snapshot.rules.map((row): LearnedNarrativeRule => ({
    ...row,
    id: ruleIds.get(row.id)!,
    projectId: targetProjectId,
    sourceId: sourceIds.get(row.sourceId)!,
    conflictRuleIds: row.conflictRuleIds.flatMap((id) => ruleIds.get(id) ?? []),
    supersededByRuleId: row.supersededByRuleId
      ? ruleIds.get(row.supersededByRuleId) ?? null
      : null,
  }));
  const feedback = snapshot.feedback.map((row): LearningFeedbackRecord => ({
    ...row,
    id: crypto.randomUUID(),
    projectId: targetProjectId,
    ruleIds: row.ruleIds.flatMap((id) => ruleIds.get(id) ?? []),
  }));
  const profile = snapshot.profile ? {
    ...snapshot.profile,
    id: `learning-profile:${targetProjectId}`,
    projectId: targetProjectId,
    ruleWeights: Object.fromEntries(Object.entries(snapshot.profile.ruleWeights)
      .flatMap(([id, weight]) => {
        const mapped = ruleIds.get(id);
        return mapped ? [[mapped, weight] as const] : [];
      })),
  } satisfies LearningPreferenceProfile : null;
  const audit = snapshot.audit.map((row): LearningAuditRecord => ({
    ...row,
    id: crypto.randomUUID(),
    projectId: targetProjectId,
    sourceId: row.sourceId ? sourceIds.get(row.sourceId) ?? null : null,
    ruleId: row.ruleId ? ruleIds.get(row.ruleId) ?? null : null,
  }));
  const body = {
    schemaVersion: SOVEREIGN_LEARNING_BACKUP_VERSION,
    projectId: targetProjectId,
    createdAt: new Date().toISOString(),
    sources,
    rules,
    feedback,
    profile,
    audit,
    staging: [] as LearningImportStagingRecord[],
    rawSourceContentIncluded: false as const,
  };
  return {
    ...body,
    contentHash: await sha256Hex(stableStringify(body)),
  } satisfies SovereignLearningBackupSnapshot;
}

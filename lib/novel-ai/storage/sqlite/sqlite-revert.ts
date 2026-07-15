import crypto from "crypto";
import { z } from "zod";
import { buildDependencyGraph } from "../../story-bible-dependencies";
import { buildInverseChangeSet, requiredAtomicChangeIds, type InverseChange } from "../../story-bible-inverse-change-set";
import { normalizeVersionChangeSets, stableValueKey, type JsonRecord, type NormalizedChangeSet } from "../../story-bible-change-sets";
import type { SQLiteStoryBibleStorageAdapter } from "./sqlite-adapter";

type EntityType = "character" | "event" | "item" | "world_rule" | "foreshadowing" | "open_thread";

export const SQLITE_REVERT_MIGRATION_VERSION = "l0b3b_sqlite_safe_revert_001";
export const SQLITE_REVERT_SCHEMA_VERSION = "sqlite-revert-preview-v1";

export const SQLiteRevertRequestSchema = z.strictObject({
  projectId: z.string().min(1).max(160),
  requestId: z.string().min(8).max(200),
  expectedCurrentVersion: z.number().int().min(0),
  revertReason: z.string().min(2).max(1000),
  dryRun: z.boolean().default(true),
  selectedChangeIds: z.array(z.string().min(1).max(200)).optional(),
  conflictResolutionMode: z.enum(["strict", "review_required"]).default("strict"),
  previewHash: z.string().min(16).max(128).optional(),
  faultInjectionStage: z.string().max(120).optional(),
});

export class SQLiteRevertError extends Error {
  errorCode: string;
  status: number;
  details: JsonRecord;

  constructor(errorCode: string, message: string, status = 400, details: JsonRecord = {}) {
    super(message);
    this.name = "SQLiteRevertError";
    this.errorCode = errorCode;
    this.status = status;
    this.details = details;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function traceId() {
  return `sqlite_revert_trace_${crypto.randomUUID()}`;
}

function stableCanonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableCanonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableCanonicalize(record[key])}`).join(",")}}`;
}

function sha256(value: unknown) {
  return crypto.createHash("sha256").update(stableCanonicalize(value ?? null)).digest("hex");
}

function versionNumber(version: JsonRecord | null) {
  return Number(version?.versionNumber || version?.version_number || 0);
}

function versionId(version: JsonRecord | null) {
  return String(version?.id || version?.versionId || version?.version_id || "");
}

function versionSummary(version: JsonRecord | null) {
  return version ? {
    versionId: versionId(version),
    versionNumber: versionNumber(version),
    operationType: version.operationType || version.operation_type || null,
    createdAt: version.createdAt || version.created_at || null,
    summary: version.summary || version.revertReason || version.revert_reason || null,
  } : null;
}

function fieldLeaf(fieldPath: string) {
  return fieldPath.split(".").pop() || fieldPath;
}

function asEntityType(value: string): EntityType {
  if (["character", "event", "item", "world_rule", "foreshadowing", "open_thread"].includes(value)) return value as EntityType;
  throw new SQLiteRevertError("REVERT_ENTITY_NOT_SUPPORTED", `Unsupported entity type: ${value}`, 422, { retryable: false });
}

function requestHash(input: JsonRecord) {
  return sha256(input);
}

async function readVersions(adapter: SQLiteStoryBibleStorageAdapter, projectId: string) {
  const versions = await adapter.listVersions(projectId, 10000);
  return versions.sort((a, b) => versionNumber(a) - versionNumber(b));
}

function assertTargetVersion(versionIdOrNumber: string, projectId: string, versions: JsonRecord[]) {
  const target = versions.find((version) => versionId(version) === versionIdOrNumber || String(versionNumber(version)) === versionIdOrNumber);
  if (!target) throw new SQLiteRevertError("REVERT_VERSION_NOT_FOUND", "Target SQLite version was not found.", 404, { retryable: false });
  if (String(target.projectId || target.project_id || "") !== projectId) {
    throw new SQLiteRevertError("REVERT_WRONG_PROJECT", "Target version belongs to another project.", 404, { retryable: false });
  }
  return target;
}

function selectedChanges(target: JsonRecord, selectedChangeIds?: string[]) {
  const changes = normalizeVersionChangeSets({
    ...target,
    id: versionId(target),
    version_number: versionNumber(target),
    change_set: target.change_set || target.changeSet || target.changes || [],
  });
  if (!selectedChangeIds || selectedChangeIds.length === 0) return changes;
  const byId = new Map(changes.map((change) => [change.changeId, change]));
  const missing = selectedChangeIds.filter((id) => !byId.has(id));
  if (missing.length) {
    throw new SQLiteRevertError("REVERT_CHANGE_NOT_FOUND", "One or more selected changes do not exist on target version.", 404, { missingChangeIds: missing, retryable: false });
  }
  const required = requiredAtomicChangeIds(changes, selectedChangeIds);
  if (required.length) {
    throw new SQLiteRevertError("PARTIAL_REVERT_NOT_SAFE", "Selected changes split an atomic change group.", 422, { requiredChangeIds: required, retryable: false });
  }
  return selectedChangeIds.map((id) => byId.get(id)!).filter(Boolean);
}

function buildPreview(input: {
  projectId: string;
  target: JsonRecord;
  current: JsonRecord;
  selected: NormalizedChangeSet[];
  inverse: InverseChange[];
  dependency: ReturnType<typeof buildDependencyGraph>;
  mode: "strict" | "review_required";
}) {
  const blockingCount = input.dependency.blockingDependencies.length;
  const majorCount = input.dependency.majorDependencies.length;
  const safeToRevert = blockingCount === 0 && (input.mode === "review_required" || majorCount === 0);
  const selectedChangeIds = input.selected.map((change) => change.changeId);
  const payload = {
    schemaVersion: SQLITE_REVERT_SCHEMA_VERSION,
    projectId: input.projectId,
    targetVersionId: versionId(input.target),
    targetVersionNumber: versionNumber(input.target),
    currentVersionId: versionId(input.current),
    currentVersionNumber: versionNumber(input.current),
    selectedChangeIds,
    inverseChangeSet: input.inverse,
    dependencyResult: input.dependency,
    conflictResolutionMode: input.mode,
    expectedCurrentVersion: versionNumber(input.current),
  };
  const previewHash = sha256(payload);
  return {
    targetVersion: versionSummary(input.target),
    currentVersion: versionSummary(input.current),
    selectedChangeIds,
    inverseChangeSet: input.inverse,
    dependencySummary: {
      dependencyCount: input.dependency.dependencies.length,
      blockingCount,
      majorCount,
      warningCount: input.dependency.warnings.length,
      safeToRevert,
    },
    dependencyGraph: input.dependency.dependencies,
    blockingDependencies: input.dependency.blockingDependencies,
    majorDependencies: input.dependency.majorDependencies,
    atomicGroups: [],
    warnings: [
      ...input.dependency.warnings,
      ...(majorCount > 0 && input.mode === "review_required" ? ["Major dependencies require human review."] : []),
    ],
    affectedEntities: [...new Set(input.inverse.map((change) => `${change.entityType}:${change.entityId}`))],
    affectedFields: input.inverse.map((change) => ({ entityType: change.entityType, entityId: change.entityId, fieldPath: change.fieldPath })),
    integrityVerified: true,
    safeToRevert,
    requiresHumanReview: majorCount > 0,
    estimatedNewVersion: versionNumber(input.current) + 1,
    estimatedOperationType: input.selected.length === normalizeVersionChangeSets({ ...input.target, change_set: input.target.change_set || input.target.changeSet || input.target.changes || [] }).length ? "revert" : "partial_revert",
    expectedCurrentVersion: versionNumber(input.current),
    previewHash,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    canonicalAuthority: "local",
    storageLocation: "local_sqlite",
    dataLeftDevice: false,
  };
}

function patchCanonical(row: JsonRecord | null, projectId: string, change: InverseChange) {
  const leaf = fieldLeaf(change.fieldPath);
  const next: JsonRecord = {
    ...(row || {}),
    projectId,
    project_id: projectId,
    entityId: change.entityId,
    entity_id: change.entityId,
    entityType: change.entityType,
    entity_type: change.entityType,
    active: row?.active ?? true,
    canonicalAuthority: "local",
    storageLocation: "local_sqlite",
    dataLeftDevice: false,
  };
  if (change.operation === "deactivated") {
    next.active = false;
    next.status = "reverted";
    next.deactivatedByRevert = true;
  } else if (change.operation === "removed") {
    const removeSet = new Set((Array.isArray(change.newValue) ? change.newValue : [change.newValue]).map(stableValueKey));
    next[leaf] = (Array.isArray(next[leaf]) ? next[leaf] as unknown[] : []).filter((item) => !removeSet.has(stableValueKey(item)));
  } else if (change.operation === "appended") {
    const current = Array.isArray(next[leaf]) ? next[leaf] as unknown[] : [];
    const existing = new Set(current.map(stableValueKey));
    const added = (Array.isArray(change.newValue) ? change.newValue : [change.newValue]).filter((item) => !existing.has(stableValueKey(item)));
    next[leaf] = [...current, ...added];
  } else {
    next[leaf] = change.newValue;
  }
  if (leaf === "canonicalName" || leaf === "name" || leaf === "title") next.canonicalName = String(change.newValue ?? change.entityDisplayName ?? change.entityId);
  return next;
}

function shouldFault(stage: string | undefined, target: string) {
  if (stage === target) throw new SQLiteRevertError(`FAULT_${target.toUpperCase()}`, `Injected revert fault at ${target}.`, 500, { retryable: true, faultInjectionStage: target });
}

export async function createSQLiteRevertPreview(adapter: SQLiteStoryBibleStorageAdapter, versionIdOrNumber: string, body: unknown) {
  const parsed = SQLiteRevertRequestSchema.parse({ ...(body as JsonRecord || {}), dryRun: true });
  const versions = await readVersions(adapter, parsed.projectId);
  if (!versions.length) throw new SQLiteRevertError("REVERT_VERSION_NOT_FOUND", "No SQLite versions exist for this project.", 404, { retryable: false });
  const target = assertTargetVersion(versionIdOrNumber, parsed.projectId, versions);
  const current = versions.at(-1)!;
  if (versionNumber(current) !== parsed.expectedCurrentVersion) {
    throw new SQLiteRevertError("REVERT_CURRENT_VERSION_CONFLICT", "Current SQLite Story Bible version changed; re-run preview.", 409, {
      expectedCurrentVersion: parsed.expectedCurrentVersion,
      actualCurrentVersion: versionNumber(current),
      retryable: true,
    });
  }
  const integrity = await adapter.verifyStoredIntegrityFields(parsed.projectId);
  if (!integrity.ok) throw new SQLiteRevertError("REVERT_INTEGRITY_FAILED", "SQLite integrity chain failed; revert is blocked.", 409, { errors: integrity.errors, retryable: false });
  const selected = selectedChanges(target, parsed.selectedChangeIds);
  const laterChanges = versions
    .filter((version) => versionNumber(version) > versionNumber(target))
    .flatMap((version) => normalizeVersionChangeSets({ ...version, change_set: version.change_set || version.changeSet || version.changes || [] }));
  const inverse = buildInverseChangeSet(selected);
  const dependency = buildDependencyGraph({ targetVersionNumber: versionNumber(target), selectedChanges: selected, laterChanges });
  const preview = buildPreview({ projectId: parsed.projectId, target, current, selected, inverse, dependency, mode: parsed.conflictResolutionMode });
  await adapter.createRevertAudit({
    projectId: parsed.projectId,
    targetVersionId: versionId(target),
    currentVersionBefore: versionNumber(current),
    selectedChangeIds: preview.selectedChangeIds,
    previewHash: preview.previewHash,
    dependencySummary: preview.dependencySummary,
    status: "previewed",
    reason: parsed.revertReason,
    createdAt: nowIso(),
  });
  return { ok: true, dryRun: true, traceId: traceId(), ...preview };
}

export async function applySQLiteRevert(adapter: SQLiteStoryBibleStorageAdapter, versionIdOrNumber: string, body: unknown) {
  const parsed = SQLiteRevertRequestSchema.parse({ ...(body as JsonRecord || {}), dryRun: false });
  const applyTraceId = traceId();
  const versions = await readVersions(adapter, parsed.projectId);
  if (!versions.length) throw new SQLiteRevertError("REVERT_VERSION_NOT_FOUND", "No SQLite versions exist for this project.", 404, { traceId: applyTraceId, retryable: false });
  const target = assertTargetVersion(versionIdOrNumber, parsed.projectId, versions);
  const selected = selectedChanges(target, parsed.selectedChangeIds);
  const selectedChangeIds = selected.map((change) => change.changeId);
  const operationType = selected.length === normalizeVersionChangeSets({ ...target, change_set: target.change_set || target.changeSet || target.changes || [] }).length ? "revert" : "partial_revert";
  const reqHash = requestHash({
    projectId: parsed.projectId,
    targetVersionId: versionId(target),
    expectedCurrentVersion: parsed.expectedCurrentVersion,
    selectedChangeIds,
    revertReason: parsed.revertReason,
    conflictResolutionMode: parsed.conflictResolutionMode,
  });
  const existing = await adapter.getMutationRequest(parsed.requestId);
  if (existing) {
    if (existing.requestHash !== reqHash && existing.request_hash !== reqHash) {
      throw new SQLiteRevertError("STORAGE_IDEMPOTENCY_CONFLICT", "requestId has already been used with a different SQLite revert payload.", 409, { traceId: applyTraceId, retryable: false });
    }
    if (existing.status === "completed" && existing.response) return { ...(existing.response as JsonRecord), idempotentReplay: true, traceId: applyTraceId };
  }
  const preview = await createSQLiteRevertPreview(adapter, versionIdOrNumber, { ...parsed, dryRun: true });
  if (parsed.previewHash && parsed.previewHash !== preview.previewHash) {
    throw new SQLiteRevertError("REVERT_PREVIEW_STALE", "SQLite revert preview is stale; re-run preview.", 409, {
      expectedPreviewHash: preview.previewHash,
      suppliedPreviewHash: parsed.previewHash,
      traceId: applyTraceId,
      retryable: true,
    });
  }
  if (!preview.safeToRevert) {
    const code = preview.blockingDependencies.length ? "REVERT_DEPENDENCY_CONFLICT" : "REVERT_REVIEW_REQUIRED";
    throw new SQLiteRevertError(code, "SQLite revert requires review because dependencies were detected.", code === "REVERT_REVIEW_REQUIRED" ? 422 : 409, {
      blockingDependencies: preview.blockingDependencies,
      majorDependencies: preview.majorDependencies,
      traceId: applyTraceId,
      retryable: false,
    });
  }

  const current = versions.at(-1)!;
  shouldFault(parsed.faultInjectionStage, "after_preview_validation");
  const response = await adapter.transaction(async () => {
    await adapter.beginMutationRequest({
      projectId: parsed.projectId,
      project_id: parsed.projectId,
      requestId: parsed.requestId,
      requestHash: reqHash,
      request_hash: reqHash,
      operation: operationType,
      status: "running",
    });
    shouldFault(parsed.faultInjectionStage, "after_inverse_build");
    shouldFault(parsed.faultInjectionStage, "after_atomic_group_check");
    shouldFault(parsed.faultInjectionStage, "after_dependency_check");
    for (const [index, change] of preview.inverseChangeSet.entries()) {
      const entityType = asEntityType(String(change.entityType));
      const before = await adapter.getCanonicalEntity(parsed.projectId, entityType, String(change.entityId));
      await adapter.createCanonicalEntity(entityType, patchCanonical(before, parsed.projectId, change));
      if (index === 0) shouldFault(parsed.faultInjectionStage, "after_first_entity_apply");
    }
    const newVersion = await adapter.createVersion({
      projectId: parsed.projectId,
      project_id: parsed.projectId,
      id: `sqlite_revert_version_${crypto.randomUUID()}`,
      versionNumber: versionNumber(current) + 1,
      parentVersionId: versionId(current),
      revertedVersionId: versionId(target),
      targetVersionId: versionId(target),
      operationType,
      operation_type: operationType,
      entityType: String(preview.inverseChangeSet[0]?.entityType || ""),
      entityId: String(preview.inverseChangeSet[0]?.entityId || ""),
      fieldPath: String(preview.inverseChangeSet[0]?.fieldPath || ""),
      changes: preview.inverseChangeSet,
      change_set: preview.inverseChangeSet,
      selectedChangeIds,
      selected_change_ids: selectedChangeIds,
      inverseChangeSet: preview.inverseChangeSet,
      inverse_change_set: preview.inverseChangeSet,
      dependencySummary: preview.dependencySummary,
      dependency_summary: preview.dependencySummary,
      previewHash: preview.previewHash,
      preview_hash: preview.previewHash,
      revertReason: parsed.revertReason,
      revert_reason: parsed.revertReason,
      canonicalAuthority: "local",
      storageLocation: "local_sqlite",
      dataLeftDevice: false,
      summary: parsed.revertReason,
      createdAt: nowIso(),
    });
    shouldFault(parsed.faultInjectionStage, "after_version_insert");
    for (const change of preview.inverseChangeSet) {
      await adapter.createCanonicalSourceRelation({
        projectId: parsed.projectId,
        project_id: parsed.projectId,
        entityType: change.entityType,
        entityId: change.entityId,
        sourceId: versionId(target),
        sourceType: "revert-operation",
        versionId: newVersion.id,
        fieldPath: change.fieldPath,
        originalChangeId: change.originalChangeId,
      });
    }
    shouldFault(parsed.faultInjectionStage, "after_source_relation_update");
    shouldFault(parsed.faultInjectionStage, "after_change_set_insert");
    await adapter.saveIntegrityMetadata({
      projectId: parsed.projectId,
      project_id: parsed.projectId,
      id: `sqlite_revert_integrity_${newVersion.id}`,
      versionNumber: versionNumber(newVersion),
      content: { version: versionNumber(newVersion), changes: preview.inverseChangeSet, operationType },
    });
    shouldFault(parsed.faultInjectionStage, "after_integrity_write");
    const result = {
      ok: true,
      dryRun: false,
      traceId: applyTraceId,
      requestId: parsed.requestId,
      projectId: parsed.projectId,
      operationType,
      targetVersion: versionSummary(target),
      previousCurrentVersion: versionSummary(current),
      newVersion: versionSummary(newVersion),
      selectedChangeIds,
      inverseChangeSet: preview.inverseChangeSet,
      dependencySummary: preview.dependencySummary,
      previewHash: preview.previewHash,
      canonicalAuthority: "local",
      storageLocation: "local_sqlite",
      dataLeftDevice: false,
    };
    await adapter.createRevertAudit({
      projectId: parsed.projectId,
      project_id: parsed.projectId,
      targetVersionId: versionId(target),
      currentVersionBefore: versionNumber(current),
      newVersionId: versionId(newVersion),
      selectedChangeIds,
      previewHash: preview.previewHash,
      dependencySummary: preview.dependencySummary,
      reason: parsed.revertReason,
      status: "completed",
      createdAt: nowIso(),
      completedAt: nowIso(),
    });
    shouldFault(parsed.faultInjectionStage, "after_revert_audit");
    await adapter.completeMutationRequest(parsed.requestId, result);
    shouldFault(parsed.faultInjectionStage, "before_commit");
    return result;
  });
  return response;
}

export async function revertSQLiteStoryBibleVersion(adapter: SQLiteStoryBibleStorageAdapter, versionIdOrNumber: string, body: unknown) {
  const dryRun = Boolean((body as JsonRecord | null)?.dryRun ?? true);
  return dryRun ? createSQLiteRevertPreview(adapter, versionIdOrNumber, body) : applySQLiteRevert(adapter, versionIdOrNumber, body);
}


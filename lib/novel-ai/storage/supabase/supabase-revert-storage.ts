import crypto from "crypto";
import { z } from "zod";
import { normalizeVersionChangeSets, type JsonRecord, type NormalizedChangeSet, stableValueKey } from "../../story-bible-change-sets";
import { buildInverseChangeSet, requiredAtomicChangeIds, type InverseChange } from "../../story-bible-inverse-change-set";
import { buildDependencyGraph } from "../../story-bible-dependencies";
import { storyBibleEntityAdapters } from "../../story-bible-mutations";
import {
  buildIntegrityPayload,
  computeIntegrityHash,
  STORY_BIBLE_INTEGRITY_ALGORITHM,
  STORY_BIBLE_INTEGRITY_SCHEMA_VERSION,
  verifyVersionChain,
} from "../../story-bible-integrity";

type EntityType = "character" | "event" | "item" | "world_rule" | "foreshadowing" | "open_thread";

export const STORY_BIBLE_REVERT_MIGRATION_VERSION = "p0c2c3_safe_revert_011";

export const RevertRequestSchema = z.strictObject({
  projectId: z.string().min(1).max(120),
  requestId: z.string().min(8).max(180),
  expectedCurrentVersion: z.number().int().min(0),
  revertReason: z.string().min(2).max(1000),
  dryRun: z.boolean().default(true),
  selectedChangeIds: z.array(z.string().min(1).max(160)).optional(),
  conflictResolutionMode: z.enum(["strict", "review_required"]).default("strict"),
  previewHash: z.string().min(16).max(128).optional(),
});

export class StoryBibleRevertError extends Error {
  constructor(
    public errorCode: string,
    message: string,
    public status = 400,
    public details: JsonRecord = {},
  ) {
    super(message);
    this.name = "StoryBibleRevertError";
  }
}

function cfg() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { url: url.replace(/\/$/, ""), key };
}

async function rest<T>(table: string, init: RequestInit & { query?: string } = {}): Promise<T> {
  const c = cfg();
  if (!c.url || !c.key) throw new StoryBibleRevertError("REVERT_PERSISTENCE_NOT_CONFIGURED", "Story Bible persistence is not configured.", 503, { retryable: true });
  const query = init.query ? `?${init.query}` : "";
  const response = await fetch(`${c.url}/rest/v1/${table}${query}`, {
    ...init,
    headers: {
      apikey: c.key,
      authorization: `Bearer ${c.key}`,
      "content-type": "application/json",
      prefer: "return=representation,resolution=merge-duplicates",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new StoryBibleRevertError("REVERT_DB_ERROR", `Story Bible revert database error: ${response.status}`, 500, {
      technicalMessage: text.slice(0, 300),
      retryable: true,
    });
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function q(value: string) {
  return encodeURIComponent(value);
}

function nowIso() {
  return new Date().toISOString();
}

function hash(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function traceId() {
  return `story_revert_trace_${crypto.randomUUID()}`;
}

function adapterFor(entityType: string) {
  return storyBibleEntityAdapters[entityType as EntityType];
}

async function readVersions(projectId: string) {
  return rest<JsonRecord[]>("story_bible_versions", {
    query: `project_id=eq.${q(projectId)}&select=*&order=version_number.asc&limit=10000`,
  });
}

function currentVersion(versions: JsonRecord[]) {
  return versions[versions.length - 1] || null;
}

function versionNumber(version: JsonRecord | null) {
  return Number(version?.version_number || 0);
}

function versionSummary(version: JsonRecord | null) {
  return version ? {
    versionId: version.id,
    versionNumber: versionNumber(version),
    operationType: version.operation_type || null,
    createdAt: version.created_at || null,
    summary: version.summary || null,
  } : null;
}

function requestHash(input: JsonRecord) {
  return hash({
    projectId: input.projectId,
    targetVersionId: input.targetVersionId,
    expectedCurrentVersion: input.expectedCurrentVersion,
    selectedChangeIds: input.selectedChangeIds || [],
    revertReason: input.revertReason,
    conflictResolutionMode: input.conflictResolutionMode,
  });
}

async function getMutationRequest(requestId: string) {
  const rows = await rest<JsonRecord[]>("story_bible_mutation_requests", {
    query: `request_id=eq.${q(requestId)}&select=*&limit=1`,
  });
  return rows[0] || null;
}

async function writeMutationRequest(input: {
  requestId: string;
  projectId: string;
  operation: string;
  requestHash: string;
  status: string;
  response?: JsonRecord;
  resultVersionId?: string | null;
  errorCode?: string | null;
}) {
  const row = {
    request_id: input.requestId,
    project_id: input.projectId,
    operation: input.operation,
    candidate_ids: [],
    status: input.status,
    request_hash: input.requestHash,
    response_hash: input.requestHash,
    response_json: input.response || null,
    result_version_id: input.resultVersionId || null,
    error_code: input.errorCode || null,
    reviewer_id: "admin-token",
    created_at: nowIso(),
    completed_at: input.status === "completed" || input.status === "failed" ? nowIso() : null,
  };
  return rest<JsonRecord[]>("story_bible_mutation_requests", {
    method: "POST",
    query: "on_conflict=request_id",
    body: JSON.stringify([row]),
  });
}

function assertProjectVersion(targetVersionId: string, projectId: string, versions: JsonRecord[]) {
  const target = versions.find((version) => String(version.id) === targetVersionId || String(version.version_number) === targetVersionId);
  if (!target) throw new StoryBibleRevertError("REVERT_VERSION_NOT_FOUND", "Target version was not found for this project.", 404, { retryable: false });
  if (target.project_id !== projectId) throw new StoryBibleRevertError("REVERT_WRONG_PROJECT", "Target version belongs to another project.", 404, { retryable: false });
  return target;
}

function selectedChanges(target: JsonRecord, selectedChangeIds?: string[]) {
  const changes = normalizeVersionChangeSets(target);
  if (!selectedChangeIds || selectedChangeIds.length === 0) return changes;
  const byId = new Map(changes.map((change) => [change.changeId, change]));
  const missing = selectedChangeIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new StoryBibleRevertError("REVERT_CHANGE_NOT_FOUND", "One or more selected changes do not exist on the target version.", 404, {
      missingChangeIds: missing,
      retryable: false,
    });
  }
  const required = requiredAtomicChangeIds(changes, selectedChangeIds);
  if (required.length > 0) {
    throw new StoryBibleRevertError("PARTIAL_REVERT_NOT_SAFE", "Selected changes split an atomic change group.", 422, {
      requiredChangeIds: required,
      retryable: false,
    });
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
  reason: string;
  mode: "strict" | "review_required";
}) {
  const blockingCount = input.dependency.blockingDependencies.length;
  const majorCount = input.dependency.majorDependencies.length;
  const safeToRevert = blockingCount === 0 && (input.mode === "review_required" || majorCount === 0);
  const payload = {
    projectId: input.projectId,
    targetVersionId: input.target.id,
    targetVersionNumber: versionNumber(input.target),
    currentVersionId: input.current.id,
    currentVersionNumber: versionNumber(input.current),
    selectedChangeIds: input.selected.map((change) => change.changeId),
    inverseChangeSet: input.inverse,
    dependencyGraph: input.dependency.dependencies,
    conflictResolutionMode: input.mode,
  };
  const previewHash = hash(payload);
  return {
    targetVersion: versionSummary(input.target),
    currentVersion: versionSummary(input.current),
    selectedChangeIds: input.selected.map((change) => change.changeId),
    inverseChangeSet: input.inverse,
    affectedEntities: [...new Set(input.inverse.map((change) => `${change.entityType}:${change.entityId}`))],
    affectedFields: input.inverse.map((change) => ({ entityType: change.entityType, entityId: change.entityId, fieldPath: change.fieldPath })),
    dependentVersions: [...new Set(input.dependency.dependencies.map((dep) => dep.laterModifiedAtVersion).filter(Boolean))],
    dependencyGraph: input.dependency.dependencies,
    blockingDependencies: input.dependency.blockingDependencies,
    majorDependencies: input.dependency.majorDependencies,
    warnings: [
      ...input.dependency.warnings,
      ...(majorCount > 0 && input.mode === "review_required" ? ["Major dependencies require human review."] : []),
    ],
    newConflicts: input.dependency.dependencies.filter((dep) => dep.severity === "blocking" || dep.severity === "major"),
    integrityVerified: true,
    safeToRevert,
    estimatedNewVersion: versionNumber(input.current) + 1,
    estimatedOperationType: input.selected.length === normalizeVersionChangeSets(input.target).length ? "revert" : "partial_revert",
    requiresHumanReview: majorCount > 0,
    previewHash,
    currentIntegrityRootHash: input.current.integrity_hash || null,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
}

function fieldLeaf(fieldPath: string) {
  return fieldPath.split(".").pop() || fieldPath;
}

async function loadCanonical(projectId: string, entityType: EntityType, entityId: string) {
  const adapter = adapterFor(entityType);
  const rows = await rest<JsonRecord[]>(adapter.table, {
    query: `project_id=eq.${q(projectId)}&${adapter.idColumn}=eq.${q(entityId)}&select=*&limit=1`,
  });
  return rows[0] || null;
}

function patchCanonical(row: JsonRecord | null, projectId: string, change: InverseChange) {
  const adapter = adapterFor(change.entityType);
  const json = { ...((row?.[adapter.jsonColumn] as JsonRecord) || {}) };
  const leaf = fieldLeaf(change.fieldPath);
  const payload: JsonRecord = {
    id: row?.id || `${projectId}_${change.entityId}`,
    project_id: projectId,
    [adapter.idColumn]: change.entityId,
    [adapter.titleColumn]: row?.[adapter.titleColumn] || change.entityDisplayName || change.entityId,
    [adapter.jsonColumn]: json,
  };
  if (adapter.hasUpdatedAt !== false) payload.updated_at = nowIso();
  if (change.operation === "deactivated") {
    json.active = false;
    json.status = "reverted";
    if ("statusColumn" in adapter && adapter.statusColumn) payload[adapter.statusColumn] = "reverted";
  } else if (leaf === "canonicalName" || leaf === "name" || leaf === "title") {
    payload[adapter.titleColumn] = String(change.newValue ?? change.entityDisplayName ?? change.entityId);
  } else if (leaf === "status" && "statusColumn" in adapter && adapter.statusColumn) {
    payload[adapter.statusColumn] = String(change.newValue ?? "");
    json[leaf] = change.newValue;
  } else if (leaf === "immutable" && change.entityType === "world_rule") {
    payload.immutable = Boolean(change.newValue);
    json[leaf] = change.newValue;
  } else if (change.operation === "removed") {
    const removeSet = new Set((Array.isArray(change.newValue) ? change.newValue : [change.newValue]).map(stableValueKey));
    json[leaf] = (Array.isArray(json[leaf]) ? json[leaf] as unknown[] : []).filter((item) => !removeSet.has(stableValueKey(item)));
  } else if (change.operation === "appended") {
    const current = Array.isArray(json[leaf]) ? json[leaf] as unknown[] : [];
    const existing = new Set(current.map(stableValueKey));
    const added = (Array.isArray(change.newValue) ? change.newValue : [change.newValue]).filter((item) => !existing.has(stableValueKey(item)));
    json[leaf] = [...current, ...added];
  } else {
    json[leaf] = change.newValue;
  }
  if (change.entityType === "world_rule" && payload.immutable == null) payload.immutable = Boolean(row?.immutable);
  if (change.entityType === "open_thread") payload.thread_type = String(row?.thread_type || json.threadType || "general");
  if ("statusColumn" in adapter && adapter.statusColumn && payload[adapter.statusColumn] == null) {
    payload[adapter.statusColumn] = row?.[adapter.statusColumn] || json.status || (change.entityType === "foreshadowing" ? "planted" : "open");
  }
  return payload;
}

async function upsertCanonical(entityType: EntityType, payload: JsonRecord) {
  const adapter = adapterFor(entityType);
  const rows = await rest<JsonRecord[]>(adapter.table, {
    method: "POST",
    query: "on_conflict=id",
    body: JSON.stringify([payload]),
  });
  return rows[0] || payload;
}

async function createVersion(input: {
  projectId: string;
  current: JsonRecord;
  target: JsonRecord;
  operationType: string;
  inverse: InverseChange[];
  requestId: string;
  reason: string;
  selectedChangeIds: string[];
  dependencySummary: JsonRecord;
  previewHash: string;
}) {
  const versionId = `story_version_${crypto.randomUUID()}`;
  const previousIntegrityHash = String(input.current.integrity_hash || "");
  const row: JsonRecord = {
    id: versionId,
    project_id: input.projectId,
    version_number: versionNumber(input.current) + 1,
    parent_version_id: input.current.id,
    operation_type: input.operationType,
    candidate_ids: [],
    approved_candidate_ids: [],
    change_set: input.inverse,
    created_by: "admin-token",
    request_id: input.requestId,
    operation_source: "author",
    mutation_request_ids: [input.requestId],
    summary: input.reason.slice(0, 500),
    source_provider_type: "author",
    source_provider_location: "reviewer",
    source_mode: "author-declared",
    data_left_device: false,
    storage_location: "supabase-postgres",
    canonical_authority: "local",
    previous_integrity_hash: previousIntegrityHash || null,
    integrity_algorithm: STORY_BIBLE_INTEGRITY_ALGORITHM,
    integrity_schema_version: STORY_BIBLE_INTEGRITY_SCHEMA_VERSION,
    integrity_status: "valid",
    reverted_version_id: input.target.id,
    revert_reason: input.reason,
    target_version_id: input.target.id,
    selected_change_ids: input.selectedChangeIds,
    inverse_change_set: input.inverse,
    dependency_summary: input.dependencySummary,
    preview_hash: input.previewHash,
    created_at: nowIso(),
  };
  row.integrity_hash = computeIntegrityHash(buildIntegrityPayload(row, previousIntegrityHash || null));
  row.integrity_computed_at = nowIso();
  const rows = await rest<JsonRecord[]>("story_bible_versions", { method: "POST", body: JSON.stringify([row]) });
  return rows[0] || row;
}

async function linkRevertSources(projectId: string, versionId: string, targetVersionId: string, inverse: InverseChange[], reason: string) {
  const rows = inverse.map((change) => ({
    id: `story_canonical_source_${crypto.randomUUID()}`,
    project_id: projectId,
    canonical_entity_type: change.entityType,
    canonical_entity_id: change.entityId,
    field_path: change.fieldPath,
    source_type: "revert-operation",
    source_id: targetVersionId,
    candidate_id: change.candidateId,
    version_id: versionId,
    source_hash: hash({ versionId, changeId: change.changeId, targetVersionId, reason }),
    created_by: "admin-token",
    created_at: nowIso(),
  }));
  if (rows.length === 0) return [];
  return rest<JsonRecord[]>("story_canonical_sources", { method: "POST", body: JSON.stringify(rows) });
}

async function audit(input: {
  projectId: string;
  targetVersionId: string;
  currentVersionBefore: number;
  newVersionId?: string | null;
  selectedChangeIds: string[];
  previewHash?: string | null;
  dependencyCount: number;
  blockingCount: number;
  warningCount: number;
  reason: string;
  status: string;
  errorCode?: string | null;
  failureStage?: string | null;
}) {
  await rest("story_bible_revert_audits", {
    method: "POST",
    body: JSON.stringify([{
      id: `revert_audit_${crypto.randomUUID()}`,
      project_id: input.projectId,
      target_version_id: input.targetVersionId,
      current_version_before: input.currentVersionBefore,
      new_version_id: input.newVersionId || null,
      selected_change_ids: input.selectedChangeIds,
      preview_hash: input.previewHash || null,
      dependency_count: input.dependencyCount,
      blocking_count: input.blockingCount,
      warning_count: input.warningCount,
      requested_by: "admin-token",
      reason: input.reason,
      status: input.status,
      error_code: input.errorCode || null,
      failure_stage: input.failureStage || null,
      created_at: nowIso(),
      completed_at: input.status === "completed" || input.status === "failed" ? nowIso() : null,
    }]),
  });
}

export async function revertStoryBibleVersion(versionId: string, body: unknown) {
  const parsed = RevertRequestSchema.parse(body);
  const revertTraceId = traceId();
  const versions = await readVersions(parsed.projectId);
  if (versions.length === 0) throw new StoryBibleRevertError("REVERT_VERSION_NOT_FOUND", "No versions exist for this project.", 404, { traceId: revertTraceId, retryable: false });
  const target = assertProjectVersion(versionId, parsed.projectId, versions);
  const selected = selectedChanges(target, parsed.selectedChangeIds);
  const selectedChangeIds = selected.map((change) => change.changeId);
  const op = selected.length === normalizeVersionChangeSets(target).length ? "revert_version" : "partial_revert";
  const reqHash = requestHash({ ...parsed, targetVersionId: target.id, selectedChangeIds });
  const existing = await getMutationRequest(parsed.requestId);
  if (existing) {
    if (existing.request_hash !== reqHash && existing.response_hash !== reqHash) {
      throw new StoryBibleRevertError("REVERT_IDEMPOTENCY_KEY_REUSED", "requestId has already been used with a different payload.", 409, { traceId: revertTraceId, retryable: false });
    }
    if (existing.status === "completed" && existing.response_json) return { ...(existing.response_json as JsonRecord), idempotentReplay: true, traceId: revertTraceId };
  }
  const current = currentVersion(versions);
  if (!current) throw new StoryBibleRevertError("REVERT_VERSION_NOT_FOUND", "Current version was not found.", 404, { traceId: revertTraceId, retryable: false });
  if (versionNumber(current) !== parsed.expectedCurrentVersion) {
    throw new StoryBibleRevertError("REVERT_CURRENT_VERSION_CONFLICT", "Current Story Bible version changed; re-run dry-run before applying revert.", 409, {
      traceId: revertTraceId,
      expectedCurrentVersion: parsed.expectedCurrentVersion,
      actualCurrentVersion: versionNumber(current),
      targetVersion: versionNumber(target),
      retryable: true,
      replanRequired: true,
    });
  }
  const integrity = await verifyVersionChain({ projectId: parsed.projectId, includeDetails: false });
  if (!integrity.valid) {
    throw new StoryBibleRevertError("REVERT_INTEGRITY_FAILED", "Story Bible integrity chain failed; revert is blocked.", 409, {
      traceId: revertTraceId,
      retryable: false,
      firstInvalidVersion: integrity.firstInvalidVersion,
    });
  }
  const laterChanges = versions
    .filter((version) => versionNumber(version) > versionNumber(target))
    .flatMap((version) => normalizeVersionChangeSets(version));
  const inverse = buildInverseChangeSet(selected);
  const dependency = buildDependencyGraph({ targetVersionNumber: versionNumber(target), selectedChanges: selected, laterChanges });
  const preview = buildPreview({
    projectId: parsed.projectId,
    target,
    current,
    selected,
    inverse,
    dependency,
    reason: parsed.revertReason,
    mode: parsed.conflictResolutionMode,
  });
  if (parsed.dryRun) return { ok: true, dryRun: true, traceId: revertTraceId, ...preview };
  if (parsed.previewHash && parsed.previewHash !== preview.previewHash) {
    throw new StoryBibleRevertError("REVERT_PREVIEW_STALE", "Revert preview is stale; re-run dry-run.", 409, {
      traceId: revertTraceId,
      expectedPreviewHash: preview.previewHash,
      suppliedPreviewHash: parsed.previewHash,
      retryable: true,
      replanRequired: true,
    });
  }
  if (!preview.safeToRevert) {
    const code = dependency.blockingDependencies.length > 0 ? "REVERT_DEPENDENCY_CONFLICT" : "REVERT_REVIEW_REQUIRED";
    throw new StoryBibleRevertError(code, "Revert requires review because dependencies were detected.", code === "REVERT_REVIEW_REQUIRED" ? 422 : 409, {
      traceId: revertTraceId,
      blockingDependencies: dependency.blockingDependencies,
      majorDependencies: dependency.majorDependencies,
      retryable: false,
    });
  }

  if (!existing) {
    await writeMutationRequest({ requestId: parsed.requestId, projectId: parsed.projectId, operation: op, requestHash: reqHash, status: "running" });
  }

  const rollback: Array<() => Promise<unknown>> = [];
  let newVersion: JsonRecord | null = null;
  try {
    const beforeRows: Array<{ entityType: EntityType; entityId: string; before: JsonRecord | null }> = [];
    for (const change of inverse) {
      const entityType = change.entityType as EntityType;
      const adapter = adapterFor(entityType);
      if (!adapter) throw new StoryBibleRevertError("REVERT_ENTITY_NOT_FOUND", `Unsupported entity type: ${change.entityType}`, 422, { traceId: revertTraceId, retryable: false });
      const before = await loadCanonical(parsed.projectId, entityType, change.entityId);
      beforeRows.push({ entityType, entityId: change.entityId, before });
      const payload = patchCanonical(before, parsed.projectId, change);
      await upsertCanonical(entityType, payload);
    }
    rollback.push(async () => {
      for (const item of beforeRows.reverse()) {
        const adapter = adapterFor(item.entityType);
        if (item.before) await rest(adapter.table, { method: "POST", query: "on_conflict=id", body: JSON.stringify([item.before]) });
        else await rest(adapter.table, { method: "DELETE", query: `project_id=eq.${q(parsed.projectId)}&${adapter.idColumn}=eq.${q(item.entityId)}` });
      }
    });

    newVersion = await createVersion({
      projectId: parsed.projectId,
      current,
      target,
      operationType: op === "revert_version" ? "revert" : "partial_revert",
      inverse,
      requestId: parsed.requestId,
      reason: parsed.revertReason,
      selectedChangeIds: preview.selectedChangeIds,
      dependencySummary: {
        dependencyCount: dependency.dependencies.length,
        blockingCount: dependency.blockingDependencies.length,
        majorCount: dependency.majorDependencies.length,
        safeToRevert: preview.safeToRevert,
      },
      previewHash: preview.previewHash,
    });
    rollback.push(async () => {
      await rest("story_bible_versions", { method: "DELETE", query: `project_id=eq.${q(parsed.projectId)}&id=eq.${q(String(newVersion?.id || ""))}` });
    });
    await linkRevertSources(parsed.projectId, String(newVersion.id), String(target.id), inverse, parsed.revertReason);
    rollback.push(async () => {
      await rest("story_canonical_sources", { method: "DELETE", query: `project_id=eq.${q(parsed.projectId)}&version_id=eq.${q(String(newVersion?.id || ""))}` });
    });
    const response = {
      ok: true,
      dryRun: false,
      traceId: revertTraceId,
      requestId: parsed.requestId,
      projectId: parsed.projectId,
      operationType: op === "revert_version" ? "revert" : "partial_revert",
      targetVersion: versionSummary(target),
      previousCurrentVersion: versionSummary(current),
      newVersion: versionSummary(newVersion),
      selectedChangeIds: preview.selectedChangeIds,
      inverseChangeSet: inverse,
      dependencySummary: {
        dependencyCount: dependency.dependencies.length,
        blockingCount: dependency.blockingDependencies.length,
        majorCount: dependency.majorDependencies.length,
      },
      previewHash: preview.previewHash,
      integrityHash: newVersion.integrity_hash || null,
      canonicalAuthority: "local",
    };
    await writeMutationRequest({ requestId: parsed.requestId, projectId: parsed.projectId, operation: op, requestHash: reqHash, status: "completed", response, resultVersionId: String(newVersion.id) });
    await audit({
      projectId: parsed.projectId,
      targetVersionId: String(target.id),
      currentVersionBefore: versionNumber(current),
      newVersionId: String(newVersion.id),
      selectedChangeIds: preview.selectedChangeIds,
      previewHash: preview.previewHash,
      dependencyCount: dependency.dependencies.length,
      blockingCount: dependency.blockingDependencies.length,
      warningCount: dependency.warnings.length,
      reason: parsed.revertReason,
      status: "completed",
    });
    return response;
  } catch (error) {
    for (const undo of rollback.reverse()) await undo().catch(() => undefined);
    const err = error instanceof StoryBibleRevertError
      ? error
      : new StoryBibleRevertError("REVERT_TRANSACTION_FAILED", error instanceof Error ? error.message : "Story Bible revert transaction failed.", 500, { traceId: revertTraceId, retryable: true });
    await writeMutationRequest({
      requestId: parsed.requestId,
      projectId: parsed.projectId,
      operation: op,
      requestHash: reqHash,
      status: "failed",
      errorCode: err.errorCode,
      response: { ok: false, traceId: revertTraceId, errorCode: err.errorCode, ...err.details },
    }).catch(() => undefined);
    await audit({
      projectId: parsed.projectId,
      targetVersionId: String(target.id),
      currentVersionBefore: versionNumber(current),
      selectedChangeIds: preview.selectedChangeIds,
      previewHash: preview.previewHash,
      dependencyCount: dependency.dependencies.length,
      blockingCount: dependency.blockingDependencies.length,
      warningCount: dependency.warnings.length,
      reason: parsed.revertReason,
      status: "failed",
      errorCode: err.errorCode,
      failureStage: "transaction",
    }).catch(() => undefined);
    throw err;
  }
}


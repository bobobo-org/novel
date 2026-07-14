import crypto from "crypto";
import { z } from "zod";
import { StoryBibleMutationError } from "./story-bible";

type JsonRecord = Record<string, unknown>;
type CandidateStatus = "pending" | "needs_review" | "approved" | "rejected" | "stale" | "superseded" | "failed";
type EntityType = "character" | "event" | "item" | "world_rule" | "foreshadowing" | "open_thread";
type SourceMode = "ai-supported" | "author-declared";

const EntityTypeSchema = z.enum(["character", "event", "item", "world_rule", "foreshadowing", "open_thread"]);
const ReviewableStatusSchema = z.enum(["pending", "needs_review"]);

export const ApproveMutationRequestSchema = z.strictObject({
  projectId: z.string().min(1).max(120),
  requestId: z.string().min(8).max(160),
  expectedCandidateStatus: ReviewableStatusSchema,
  expectedStoryBibleVersion: z.number().int().min(0),
  reviewReason: z.string().min(2).max(1000),
});

export const EditApproveMutationRequestSchema = z.strictObject({
  projectId: z.string().min(1).max(120),
  requestId: z.string().min(8).max(160),
  expectedCandidateStatus: ReviewableStatusSchema,
  expectedStoryBibleVersion: z.number().int().min(0),
  editedValue: z.unknown(),
  editReason: z.string().min(2).max(1000),
  sourceMode: z.enum(["ai-supported", "author-declared"]),
});

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { url: url.replace(/\/$/, ""), key };
}

async function rest<T>(table: string, init: RequestInit & { query?: string } = {}): Promise<T> {
  const cfg = supabaseConfig();
  if (!cfg.url || !cfg.key) throw new StoryBibleMutationError("STORY_BIBLE_PERSISTENCE_NOT_CONFIGURED", "Story Bible persistence is not configured.", 503);
  const query = init.query ? `?${init.query}` : "";
  const response = await fetch(`${cfg.url}/rest/v1/${table}${query}`, {
    ...init,
    headers: {
      apikey: cfg.key,
      authorization: `Bearer ${cfg.key}`,
      "content-type": "application/json",
      prefer: "return=representation,resolution=merge-duplicates",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new StoryBibleMutationError("STORY_BIBLE_DB_ERROR", `Story Bible database error: ${response.status}`, 500, {
      technicalMessage: text.slice(0, 300),
      retryable: true,
    });
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function nowIso() {
  return new Date().toISOString();
}

function hashText(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function queryValue(value: string) {
  return encodeURIComponent(value);
}

function reviewerFromAdmin() {
  return "admin-token";
}

function traceId() {
  return `story_mutation_trace_${crypto.randomUUID()}`;
}

function requestHash(input: unknown) {
  return hashText(JSON.stringify(input || null));
}

function fieldLeaf(fieldPath: string) {
  return fieldPath.split(".").pop() || "";
}

function ensureArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

const adapterMap: Record<EntityType, {
  table: string;
  idColumn: string;
  jsonColumn: string;
  titleColumn: string;
  fields: string[];
  statusColumn?: string;
  hasUpdatedAt?: boolean;
}> = {
  character: {
    table: "story_characters",
    idColumn: "character_id",
    jsonColumn: "character_json",
    titleColumn: "canonical_name",
    fields: ["canonicalName", "aliases", "age", "identity", "role", "appearance", "personalityTraits", "speechPatterns", "knownFacts", "unknownFacts", "abilities", "abilityLimits", "injuries", "lifeStatus", "currentLocationId", "possessions", "emotionalState"],
  },
  event: {
    table: "story_events",
    idColumn: "event_id",
    jsonColumn: "event_json",
    titleColumn: "title",
    fields: ["title", "eventType", "chapterId", "storyDate", "sequenceOrder", "participants", "locationId", "causes", "consequences", "factsRevealed", "status"],
  },
  item: {
    table: "story_items",
    idColumn: "item_id",
    jsonColumn: "item_json",
    titleColumn: "name",
    fields: ["name", "aliases", "itemType", "description", "abilities", "limitations", "currentOwnerCharacterId", "currentLocationId", "status", "history"],
  },
  world_rule: {
    table: "story_world_rules",
    idColumn: "rule_id",
    jsonColumn: "rule_json",
    titleColumn: "title",
    fields: ["category", "title", "description", "scope", "exceptions", "consequences", "immutable"],
  },
  foreshadowing: {
    table: "story_foreshadowing",
    idColumn: "foreshadow_id",
    jsonColumn: "foreshadow_json",
    titleColumn: "title",
    statusColumn: "status",
    fields: ["title", "description", "expectedPayoff", "relatedCharacters", "relatedEvents", "status", "payoffChapterId", "abandonedReason"],
  },
  open_thread: {
    table: "story_open_threads",
    idColumn: "thread_id",
    jsonColumn: "thread_json",
    titleColumn: "title",
    statusColumn: "status",
    hasUpdatedAt: false,
    fields: ["threadType", "title", "description", "relatedCharacters", "relatedEvents", "urgency", "expectedResolution", "status", "resolvedChapterId"],
  },
};

export const storyBibleEntityAdapters = adapterMap;

function adapterFor(type: string) {
  const parsed = EntityTypeSchema.safeParse(type);
  return parsed.success ? adapterMap[parsed.data] : undefined;
}

function canonicalIdFor(candidate: JsonRecord, entityType: EntityType) {
  const raw = String(candidate.entity_id || candidate.temporary_entity_id || "");
  if (raw) return raw;
  const value = candidate.proposed_value;
  const safe = typeof value === "string" ? value : `${entityType}_${crypto.randomUUID()}`;
  return `${entityType}_${hashText(safe).slice(0, 12)}`;
}

async function readRows(table: string, query: string) {
  return rest<JsonRecord[]>(table, { query });
}

async function getCandidate(projectId: string, candidateId: string) {
  const rows = await readRows("story_fact_candidates", `project_id=eq.${queryValue(projectId)}&id=eq.${queryValue(candidateId)}&select=*&limit=1`);
  return rows[0] || null;
}

async function getCandidateSources(projectId: string, candidateId: string) {
  return readRows("story_fact_sources", `project_id=eq.${queryValue(projectId)}&candidate_id=eq.${queryValue(candidateId)}&select=*&order=created_at.asc`);
}

async function getCandidateConflicts(projectId: string, candidateId: string) {
  return readRows("story_fact_conflicts", `project_id=eq.${queryValue(projectId)}&candidate_id=eq.${queryValue(candidateId)}&status=eq.open&select=*`);
}

async function getMutationRequest(requestId: string) {
  const rows = await readRows("story_bible_mutation_requests", `request_id=eq.${queryValue(requestId)}&select=*&limit=1`);
  return rows[0] || null;
}

async function createMutationRequest(input: {
  requestId: string;
  projectId: string;
  operation: string;
  candidateId: string;
  hash: string;
  expectedStatus: string;
  expectedVersion: number;
}) {
  return rest<JsonRecord[]>("story_bible_mutation_requests", {
    method: "POST",
    body: JSON.stringify([{
      request_id: input.requestId,
      project_id: input.projectId,
      operation: input.operation,
      candidate_ids: [input.candidateId],
      status: "running",
      request_hash: input.hash,
      response_hash: input.hash,
      reviewer_id: reviewerFromAdmin(),
      expected_candidate_status: input.expectedStatus,
      expected_story_bible_version: input.expectedVersion,
      created_at: nowIso(),
    }]),
  });
}

async function finishMutationRequest(requestId: string, response: JsonRecord, status = "completed", errorCode: string | null = null) {
  return rest("story_bible_mutation_requests", {
    method: "PATCH",
    query: `request_id=eq.${queryValue(requestId)}`,
    body: JSON.stringify({
      status,
      response_json: response,
      error_code: errorCode,
      result_version_id: response.versionId || null,
      completed_at: nowIso(),
    }),
  });
}

async function currentVersion(projectId: string) {
  const rows = await readRows("story_bible_versions", `project_id=eq.${queryValue(projectId)}&select=id,version_number&order=version_number.desc&limit=1`);
  const row = rows[0];
  return {
    versionId: row?.id ? String(row.id) : null,
    versionNumber: row?.version_number == null ? 0 : Number(row.version_number),
  };
}

async function loadCanonical(projectId: string, entityType: EntityType, entityId: string) {
  const adapter = adapterMap[entityType];
  const rows = await readRows(adapter.table, `project_id=eq.${queryValue(projectId)}&${adapter.idColumn}=eq.${queryValue(entityId)}&select=*&limit=1`);
  return rows[0] || null;
}

function canonicalValue(row: JsonRecord | null, entityType: EntityType, fieldPath: string) {
  if (!row) return undefined;
  const adapter = adapterMap[entityType];
  const leaf = fieldLeaf(fieldPath);
  if ((leaf === "canonicalName" || leaf === "name" || leaf === "title") && adapter.titleColumn) return row[adapter.titleColumn];
  if (leaf === "status" && adapter.statusColumn) return row[adapter.statusColumn];
  if (leaf === "immutable" && entityType === "world_rule") return row.immutable;
  const json = row[adapter.jsonColumn];
  return json && typeof json === "object" ? (json as JsonRecord)[leaf] : undefined;
}

function normalizeValue(entityType: EntityType, field: string, value: unknown) {
  if (field === "age") {
    if (value == null || value === "") return null;
    const num = Number(value);
    if (!Number.isInteger(num) || num < 0 || num > 2000) throw new StoryBibleMutationError("INVALID_FIELD_VALUE", "age 必須是合理整數。", 422, { fieldPath: field, retryable: false });
    return num;
  }
  if (field === "lifeStatus") {
    const val = String(value);
    if (!["alive", "dead", "missing", "unknown"].includes(val)) throw new StoryBibleMutationError("INVALID_FIELD_VALUE", "lifeStatus 不在允許範圍。", 422, { fieldPath: field, retryable: false });
    return val;
  }
  if (entityType === "foreshadowing" && field === "status") {
    const val = String(value);
    if (!["planted", "developing", "partially_paid", "paid", "abandoned"].includes(val)) throw new StoryBibleMutationError("INVALID_FIELD_VALUE", "foreshadowing status 不在允許範圍。", 422, { fieldPath: field, retryable: false });
    return val;
  }
  if (entityType === "open_thread" && field === "status") {
    const val = String(value);
    if (!["open", "developing", "resolved", "abandoned"].includes(val)) throw new StoryBibleMutationError("INVALID_FIELD_VALUE", "open thread status 不在允許範圍。", 422, { fieldPath: field, retryable: false });
    return val;
  }
  if (field === "immutable") return Boolean(value);
  if (["aliases", "knownFacts", "unknownFacts", "abilities", "abilityLimits", "injuries", "possessions", "participants", "causes", "consequences", "factsRevealed", "history", "relatedCharacters", "relatedEvents", "exceptions", "consequences"].includes(field)) return ensureArray(value);
  return value;
}

function validateField(entityType: EntityType, fieldPath: string) {
  const field = fieldLeaf(fieldPath);
  if (!adapterMap[entityType].fields.includes(field)) {
    throw new StoryBibleMutationError("FIELD_PATH_NOT_SUPPORTED", `不支援的 fieldPath：${fieldPath}`, 422, { fieldPath, entityType, retryable: false });
  }
  return field;
}

function validateTransition(entityType: EntityType, field: string, previous: unknown, next: unknown, candidate: JsonRecord, sourceMode: SourceMode, conflicts: JsonRecord[]) {
  const blocking = conflicts.filter((x) => x.severity === "blocking");
  if (blocking.length > 0) {
    throw new StoryBibleMutationError("BLOCKING_CONFLICT_PRESENT", "候選仍有 blocking conflict，不能核准。", 409, {
      conflictIds: blocking.map((x) => x.id),
      retryable: false,
    });
  }
  if (sourceMode === "ai-supported" && candidate.source_valid === false) {
    throw new StoryBibleMutationError("INVALID_SOURCE_REFERENCE", "AI-supported 來源無效，不能核准。", 409, { retryable: false });
  }
  if (entityType === "world_rule" && field !== "immutable" && candidate.operation !== "create") {
    // immutable rows are protected even with author-declared edits.
    if ((candidate as JsonRecord).immutable === true) {
      throw new StoryBibleMutationError("IMMUTABLE_RULE_CHANGE_BLOCKED", "immutable world rule 不可直接修改。", 409, { retryable: false });
    }
  }
  if (entityType === "foreshadowing" && field === "status" && previous === "paid" && next !== "paid") {
    throw new StoryBibleMutationError("INVALID_FORESHADOWING_TRANSITION", "paid 伏筆不可回退。", 409, { retryable: false });
  }
  if (entityType === "open_thread" && field === "status" && previous === "resolved" && next === "open") {
    throw new StoryBibleMutationError("INVALID_OPEN_THREAD_TRANSITION", "resolved thread 不可直接回 open。", 409, { retryable: false });
  }
}

function rowPayload(projectId: string, entityType: EntityType, entityId: string, existing: JsonRecord | null, field: string, nextValue: unknown, operation: string) {
  const adapter = adapterMap[entityType];
  const now = nowIso();
  const json = { ...((existing?.[adapter.jsonColumn] as JsonRecord) || {}) };
  let titleValue = existing?.[adapter.titleColumn] || String(nextValue || entityId);
  if (field === "canonicalName" || field === "name" || field === "title") titleValue = String(nextValue || titleValue);
  if (operation === "append") json[field] = [...ensureArray(json[field]), ...ensureArray(nextValue)];
  else if (operation === "remove") json[field] = ensureArray(json[field]).filter((x) => !ensureArray(nextValue).some((y) => JSON.stringify(y) === JSON.stringify(x)));
  else if (!["canonicalName", "name", "title", "status", "immutable"].includes(field)) json[field] = nextValue;

  const payload: JsonRecord = {
    id: existing?.id || `${projectId}_${entityId}`,
    project_id: projectId,
    [adapter.idColumn]: entityId,
    [adapter.titleColumn]: titleValue,
    [adapter.jsonColumn]: json,
  };
  if (adapter.hasUpdatedAt !== false) payload.updated_at = now;
  if (entityType === "world_rule") payload.immutable = field === "immutable" ? Boolean(nextValue) : Boolean(existing?.immutable);
  if (entityType === "open_thread") payload.thread_type = field === "threadType" ? String(nextValue) : String(existing?.thread_type || json.threadType || "general");
  if (adapter.statusColumn) payload[adapter.statusColumn] = field === "status" ? String(nextValue) : String(existing?.[adapter.statusColumn] || (entityType === "foreshadowing" ? "planted" : "open"));
  return payload;
}

async function upsertCanonical(entityType: EntityType, row: JsonRecord) {
  const adapter = adapterMap[entityType];
  const rows = await rest<JsonRecord[]>(adapter.table, {
    method: "POST",
    query: "on_conflict=id",
    body: JSON.stringify(row),
  });
  return rows[0] || row;
}

async function updateCandidate(projectId: string, candidateId: string, patch: JsonRecord) {
  const rows = await rest<JsonRecord[]>("story_fact_candidates", {
    method: "PATCH",
    query: `project_id=eq.${queryValue(projectId)}&id=eq.${queryValue(candidateId)}&select=*`,
    body: JSON.stringify({ ...patch, status_updated_at: nowIso() }),
  });
  return rows[0] || null;
}

async function createVersion(input: {
  projectId: string;
  parentVersionId: string | null;
  versionNumber: number;
  operationType: string;
  candidateId: string;
  changeSet: JsonRecord;
  requestId: string;
}) {
  const versionId = `story_version_${crypto.randomUUID()}`;
  const rows = await rest<JsonRecord[]>("story_bible_versions", {
    method: "POST",
    body: JSON.stringify([{
      id: versionId,
      project_id: input.projectId,
      version_number: input.versionNumber,
      parent_version_id: input.parentVersionId,
      operation_type: input.operationType,
      candidate_ids: [input.candidateId],
      approved_candidate_ids: [input.candidateId],
      change_set: input.changeSet,
      created_by: reviewerFromAdmin(),
      request_id: input.requestId,
      created_at: nowIso(),
    }]),
  });
  return rows[0] || { id: versionId, version_number: input.versionNumber };
}

async function linkSources(input: {
  projectId: string;
  entityType: EntityType;
  entityId: string;
  fieldPath: string;
  sourceMode: SourceMode;
  candidateId: string;
  versionId: string;
  sourceRefs: JsonRecord[];
}) {
  const rows = input.sourceMode === "author-declared"
    ? [{
        id: `story_canonical_source_${crypto.randomUUID()}`,
        project_id: input.projectId,
        canonical_entity_type: input.entityType,
        canonical_entity_id: input.entityId,
        field_path: input.fieldPath,
        source_type: "author-declared",
        source_id: null,
        candidate_id: input.candidateId,
        version_id: input.versionId,
        source_hash: hashText(`${input.candidateId}:${input.fieldPath}:author-declared`),
        created_by: reviewerFromAdmin(),
        created_at: nowIso(),
      }]
    : input.sourceRefs.map((ref) => ({
        id: `story_canonical_source_${crypto.randomUUID()}`,
        project_id: input.projectId,
        canonical_entity_type: input.entityType,
        canonical_entity_id: input.entityId,
        field_path: input.fieldPath,
        source_type: "chapter-evidence",
        source_id: ref.id || ref.excerpt_hash || null,
        candidate_id: input.candidateId,
        version_id: input.versionId,
        source_hash: ref.excerpt_hash || hashText(JSON.stringify(ref)),
        created_by: reviewerFromAdmin(),
        created_at: nowIso(),
      }));
  return rest<JsonRecord[]>("story_canonical_sources", { method: "POST", body: JSON.stringify(rows) });
}

async function ensureStoryBible(projectId: string) {
  await rest("story_bibles", {
    method: "POST",
    query: "on_conflict=project_id",
    body: JSON.stringify({
      project_id: projectId,
      schema_version: "story-bible-v1",
      status: "active",
      core_json: { projectId },
      created_at: nowIso(),
      updated_at: nowIso(),
    }),
  });
}

async function handleIdempotency(input: { operation: string; candidateId: string; body: JsonRecord; requestId: string; projectId: string; expectedStatus: string; expectedVersion: number }) {
  const hash = requestHash({
    operation: input.operation,
    projectId: input.projectId,
    candidateId: input.candidateId,
    expectedStatus: input.expectedStatus,
    expectedVersion: input.expectedVersion,
    editedValue: input.body.editedValue,
    sourceMode: input.body.sourceMode,
    reviewReason: input.body.reviewReason,
    editReason: input.body.editReason,
  });
  const existing = await getMutationRequest(input.requestId);
  if (existing) {
    if (existing.request_hash !== hash && existing.response_hash !== hash) {
      throw new StoryBibleMutationError("IDEMPOTENCY_KEY_REUSED", "同一 requestId 不可搭配不同 payload 重複使用。", 409, { requestId: input.requestId, retryable: false });
    }
    if (existing.status === "completed" && existing.response_json) return { hash, replay: existing.response_json as JsonRecord };
  } else {
    await createMutationRequest({
      requestId: input.requestId,
      projectId: input.projectId,
      operation: input.operation,
      candidateId: input.candidateId,
      hash,
      expectedStatus: input.expectedStatus,
      expectedVersion: input.expectedVersion,
    });
  }
  return { hash, replay: null };
}

export async function applyStoryBibleCandidateMutation(candidateId: string, operation: "approve" | "edit-and-approve", body: unknown) {
  const mutationTrace = traceId();
  const parsed = operation === "approve"
    ? ApproveMutationRequestSchema.parse(body)
    : EditApproveMutationRequestSchema.parse(body);
  const sourceMode: SourceMode = operation === "approve" ? "ai-supported" : (parsed as z.infer<typeof EditApproveMutationRequestSchema>).sourceMode;
  const reviewerReason = operation === "approve"
    ? (parsed as z.infer<typeof ApproveMutationRequestSchema>).reviewReason
    : (parsed as z.infer<typeof EditApproveMutationRequestSchema>).editReason;
  const idempotency = await handleIdempotency({
    operation,
    candidateId,
    body: parsed as JsonRecord,
    requestId: parsed.requestId,
    projectId: parsed.projectId,
    expectedStatus: parsed.expectedCandidateStatus,
    expectedVersion: parsed.expectedStoryBibleVersion,
  });
  if (idempotency.replay) return { ...idempotency.replay, idempotentReplay: true, traceId: mutationTrace };

  const rollback: Array<() => Promise<unknown>> = [];
  try {
    await ensureStoryBible(parsed.projectId);
    const candidate = await getCandidate(parsed.projectId, candidateId);
    if (!candidate) throw new StoryBibleMutationError("CANDIDATE_NOT_FOUND", "找不到此 project 內的候選資料。", 404, { traceId: mutationTrace, retryable: false });
    const currentStatus = String(candidate.status || "");
    if (currentStatus !== parsed.expectedCandidateStatus) {
      throw new StoryBibleMutationError("CANDIDATE_STATUS_MISMATCH", "候選狀態已改變，請重新讀取後再審核。", 409, {
        traceId: mutationTrace,
        currentStatus,
        expectedStatus: parsed.expectedCandidateStatus,
        retryable: true,
      });
    }
    if (!["pending", "needs_review"].includes(currentStatus)) {
      throw new StoryBibleMutationError("CANDIDATE_NOT_REVIEWABLE", "此候選目前不可核准。", 409, { traceId: mutationTrace, currentStatus, retryable: false });
    }
    const entityType = EntityTypeSchema.safeParse(candidate.entity_type);
    if (!entityType.success) throw new StoryBibleMutationError("ENTITY_TYPE_NOT_SUPPORTED", "不支援的 Story Bible entity type。", 422, { traceId: mutationTrace, entityType: candidate.entity_type, retryable: false });
    const adapter = adapterFor(entityType.data);
    if (!adapter) throw new StoryBibleMutationError("ENTITY_TYPE_NOT_SUPPORTED", "不支援的 Story Bible entity type。", 422, { traceId: mutationTrace, entityType: candidate.entity_type, retryable: false });
    const field = validateField(entityType.data, String(candidate.field_path || ""));
    const version = await currentVersion(parsed.projectId);
    if (version.versionNumber !== parsed.expectedStoryBibleVersion) {
      await updateCandidate(parsed.projectId, candidateId, { status: "stale", previous_status: currentStatus, request_id: parsed.requestId });
      throw new StoryBibleMutationError("STORY_BIBLE_VERSION_CONFLICT", "Story Bible 版本已變更，請重新讀取候選資料。", 409, {
        traceId: mutationTrace,
        expectedVersion: parsed.expectedStoryBibleVersion,
        currentVersion: version.versionNumber,
        candidateBasedOnVersion: candidate.based_on_version_number ?? null,
        staleReason: "expectedStoryBibleVersion differs from currentStoryBibleVersion",
        retryable: true,
      });
    }
    const sourceRefs = await getCandidateSources(parsed.projectId, candidateId);
    if (sourceMode === "ai-supported" && (candidate.source_valid === false || sourceRefs.length === 0)) {
      throw new StoryBibleMutationError("INVALID_SOURCE_REFERENCE", "AI-supported 核准需要有效 source reference。", 409, { traceId: mutationTrace, retryable: false });
    }
    const conflicts = await getCandidateConflicts(parsed.projectId, candidateId);
    const canonicalId = canonicalIdFor(candidate, entityType.data);
    const existing = await loadCanonical(parsed.projectId, entityType.data, canonicalId);
    const previous = canonicalValue(existing, entityType.data, String(candidate.field_path || ""));
    const nextRaw = operation === "edit-and-approve" ? (parsed as z.infer<typeof EditApproveMutationRequestSchema>).editedValue : candidate.proposed_value;
    const next = normalizeValue(entityType.data, field, nextRaw);
    validateTransition(entityType.data, field, previous, next, { ...candidate, immutable: existing?.immutable }, sourceMode, conflicts);

    if (JSON.stringify(previous) === JSON.stringify(next)) {
      const updated = await updateCandidate(parsed.projectId, candidateId, {
        status: "approved",
        previous_status: currentStatus,
        reviewer_id: reviewerFromAdmin(),
        review_reason: reviewerReason,
        request_id: parsed.requestId,
        reviewed_at: nowIso(),
      });
      const response = {
        ok: true,
        operation,
        noChange: true,
        traceId: mutationTrace,
        requestId: parsed.requestId,
        candidateId,
        projectId: parsed.projectId,
        status: updated?.status || "approved",
        previousStatus: currentStatus,
        storyBibleVersion: version.versionNumber,
        versionId: null,
        canonicalEntityType: entityType.data,
        canonicalEntityId: canonicalId,
        sourceMode,
      };
      await finishMutationRequest(parsed.requestId, response);
      return response;
    }

    const canonicalBefore = existing ? { ...existing } : null;
    const payload = rowPayload(parsed.projectId, entityType.data, canonicalId, existing, field, next, String(candidate.operation || "update"));
    const canonical = await upsertCanonical(entityType.data, payload);
    rollback.push(async () => {
      if (canonicalBefore) {
        await rest(adapter.table, { method: "POST", query: "on_conflict=id", body: JSON.stringify(canonicalBefore) });
      } else {
        await rest(adapter.table, { method: "DELETE", query: `project_id=eq.${queryValue(parsed.projectId)}&${adapter.idColumn}=eq.${queryValue(canonicalId)}` });
      }
    });

    const changeSet = {
      entityType: entityType.data,
      entityId: canonicalId,
      fieldPath: String(candidate.field_path || ""),
      operation: operation === "edit-and-approve" ? "human_edited" : candidate.operation || "update",
      previousValue: previous ?? null,
      newValue: next,
      sourceRefs,
      candidateId,
      reviewerId: reviewerFromAdmin(),
      reason: reviewerReason,
      humanEdited: operation === "edit-and-approve",
      sourceMode,
      manualOverride: conflicts.some((x) => x.severity === "major"),
      majorConflicts: conflicts.filter((x) => x.severity === "major").map((x) => x.id),
    };
    const newVersion = await createVersion({
      projectId: parsed.projectId,
      parentVersionId: version.versionId,
      versionNumber: version.versionNumber + 1,
      operationType: operation,
      candidateId,
      changeSet,
      requestId: parsed.requestId,
    });
    rollback.push(async () => {
      await rest("story_bible_versions", { method: "DELETE", query: `project_id=eq.${queryValue(parsed.projectId)}&id=eq.${queryValue(String(newVersion.id))}` });
    });

    await linkSources({
      projectId: parsed.projectId,
      entityType: entityType.data,
      entityId: canonicalId,
      fieldPath: String(candidate.field_path || ""),
      sourceMode,
      candidateId,
      versionId: String(newVersion.id),
      sourceRefs,
    });
    rollback.push(async () => {
      await rest("story_canonical_sources", { method: "DELETE", query: `project_id=eq.${queryValue(parsed.projectId)}&candidate_id=eq.${queryValue(candidateId)}&version_id=eq.${queryValue(String(newVersion.id))}` });
    });

    const updated = await updateCandidate(parsed.projectId, candidateId, {
      status: "approved",
      previous_status: currentStatus,
      reviewer_id: reviewerFromAdmin(),
      review_reason: reviewerReason,
      request_id: parsed.requestId,
      reviewed_at: nowIso(),
    });
    const response = {
      ok: true,
      operation,
      traceId: mutationTrace,
      requestId: parsed.requestId,
      candidateId,
      projectId: parsed.projectId,
      status: updated?.status || "approved",
      previousStatus: currentStatus,
      storyBibleVersion: Number(newVersion.version_number || version.versionNumber + 1),
      versionId: newVersion.id,
      canonicalEntityType: entityType.data,
      canonicalEntityId: canonicalId,
      fieldPath: String(candidate.field_path || ""),
      previousValue: previous ?? null,
      newValue: next,
      sourceMode,
      humanEdited: operation === "edit-and-approve",
      manualOverride: changeSet.manualOverride,
      canonicalChanged: true,
      sourceChanged: true,
      conflictChanged: false,
      canonical,
    };
    await finishMutationRequest(parsed.requestId, response);
    return response;
  } catch (error) {
    for (const undo of rollback.reverse()) await undo().catch(() => undefined);
    const err = error instanceof StoryBibleMutationError
      ? error
      : new StoryBibleMutationError("STORY_BIBLE_MUTATION_FAILED", error instanceof Error ? error.message : "Story Bible mutation failed.", 500, { traceId: mutationTrace, retryable: true });
    await finishMutationRequest(parsed.requestId, {
      ok: false,
      operation,
      traceId: mutationTrace,
      requestId: parsed.requestId,
      candidateId,
      errorCode: err.errorCode,
      userMessage: err.message,
      ...err.details,
    }, "failed", err.errorCode).catch(() => undefined);
    throw err;
  }
}

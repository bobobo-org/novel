import crypto from "crypto";

export type JsonRecord = Record<string, unknown>;
export type StoryBibleEntityType = "character" | "event" | "item" | "world_rule" | "foreshadowing" | "open_thread";
export type NormalizedChangeOperation =
  | "created"
  | "updated"
  | "appended"
  | "removed"
  | "superseded"
  | "restored"
  | "deleted"
  | "unchanged";

export type NormalizedChangeSet = {
  changeId: string;
  versionId: string;
  versionNumber: number;
  entityType: StoryBibleEntityType | "legacy_unknown";
  entityId: string;
  entityDisplayName: string;
  fieldPath: string;
  operation: NormalizedChangeOperation;
  previousValue: unknown;
  newValue: unknown;
  candidateId: string | null;
  mutationRequestId: string | null;
  reviewerId: string | null;
  reason: string;
  humanEdited: boolean;
  sourceMode: string;
  sourceRefs: JsonRecord[];
  sourceProviderType: string;
  sourceProviderLocation: string | null;
  sourceModelId: string | null;
  sourceExecutionId: string | null;
  createdAt: string | null;
};

export type ReconstructedField = {
  key: string;
  entityType: string;
  entityId: string;
  entityDisplayName: string;
  fieldPath: string;
  value: unknown;
  introducedAtVersion: number;
  lastChangedAtVersion: number;
  lastChange: NormalizedChangeSet;
};

const ENTITY_TYPES = new Set(["character", "event", "item", "world_rule", "foreshadowing", "open_thread"]);

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function hashJson(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

export function stableValueKey(value: unknown) {
  return JSON.stringify(value ?? null);
}

function stringOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function entityType(value: unknown): StoryBibleEntityType | "legacy_unknown" {
  const text = String(value || "");
  return ENTITY_TYPES.has(text) ? text as StoryBibleEntityType : "legacy_unknown";
}

function normalizeOperation(value: unknown): NormalizedChangeOperation {
  const raw = String(value || "update").trim();
  if (raw === "create" || raw === "created") return "created";
  if (raw === "append" || raw === "appended") return "appended";
  if (raw === "remove" || raw === "removed") return "removed";
  if (raw === "delete" || raw === "deleted") return "deleted";
  if (raw === "restore" || raw === "restored") return "restored";
  if (raw === "supersede" || raw === "superseded") return "superseded";
  if (raw === "no-change" || raw === "unchanged") return "unchanged";
  return "updated";
}

export function changeSetArray(version: JsonRecord): JsonRecord[] {
  const raw = version.change_set;
  if (Array.isArray(raw)) return raw.map(asRecord);
  const record = asRecord(raw);
  return Object.keys(record).length > 0 ? [record] : [];
}

function versionMutationRequestId(version: JsonRecord, change: JsonRecord) {
  const direct = stringOrNull(change.mutationRequestId) || stringOrNull(change.requestId) || stringOrNull(version.request_id);
  if (direct) return direct;
  const ids = asArray<string>(version.mutation_request_ids).filter(Boolean);
  return ids[0] || null;
}

function providerType(version: JsonRecord, change: JsonRecord) {
  return String(version.source_provider_type || change.sourceProviderType || (change.sourceMode === "author-declared" ? "author" : "legacy_unknown"));
}

export function normalizeChangeSet(version: JsonRecord, change: JsonRecord, index: number, sourceRefs: JsonRecord[] = []): NormalizedChangeSet {
  const versionId = String(version.id || "");
  const versionNumber = Number(version.version_number || 0);
  const normalizedEntityType = entityType(change.entityType);
  const fieldPath = String(change.fieldPath || change.field_path || "legacy.unknown");
  const entityId = String(change.entityId || change.entity_id || change.temporaryEntityId || change.temporary_entity_id || `legacy_entity_${index}`);
  const candidateId = stringOrNull(change.candidateId) || stringOrNull(change.candidate_id);
  const refs = asArray<JsonRecord>(change.sourceRefs).map(asRecord);
  const mergedRefs = refs.length > 0 ? refs : sourceRefs;
  const fingerprint = {
    versionId,
    versionNumber,
    index,
    entityType: normalizedEntityType,
    entityId,
    fieldPath,
    candidateId,
    previousValue: change.previousValue ?? change.previous_value ?? null,
    newValue: change.newValue ?? change.new_value ?? null,
  };
  return {
    changeId: String(change.changeId || change.change_id || `change_${hashJson(fingerprint).slice(0, 20)}`),
    versionId,
    versionNumber,
    entityType: normalizedEntityType,
    entityId,
    entityDisplayName: String(change.entityDisplayName || change.displayName || entityId),
    fieldPath,
    operation: normalizeOperation(change.operation),
    previousValue: change.previousValue ?? change.previous_value ?? null,
    newValue: change.newValue ?? change.new_value ?? null,
    candidateId,
    mutationRequestId: versionMutationRequestId(version, change),
    reviewerId: stringOrNull(change.reviewerId) || stringOrNull(version.created_by),
    reason: String(change.reason || version.summary || ""),
    humanEdited: Boolean(change.humanEdited || change.human_edited || version.operation_type === "edit-and-approve"),
    sourceMode: String(version.source_mode || change.sourceMode || ""),
    sourceRefs: mergedRefs,
    sourceProviderType: providerType(version, change),
    sourceProviderLocation: stringOrNull(version.source_provider_location) || stringOrNull(change.sourceProviderLocation),
    sourceModelId: stringOrNull(version.source_model_id) || stringOrNull(change.sourceModelId),
    sourceExecutionId: stringOrNull(version.source_execution_id) || stringOrNull(change.sourceExecutionId),
    createdAt: stringOrNull(version.created_at),
  };
}

export function normalizeVersionChangeSets(version: JsonRecord, sourceRefs: JsonRecord[] = []): NormalizedChangeSet[] {
  const changes = changeSetArray(version);
  return changes.map((change, index) => {
    const matchingSources = sourceRefs.filter((source) => {
      const candidateMatches = !change.candidateId || source.candidate_id === change.candidateId;
      const fieldMatches = !change.fieldPath || source.field_path === change.fieldPath;
      return source.version_id === version.id && candidateMatches && fieldMatches;
    });
    return normalizeChangeSet(version, change, index, matchingSources);
  });
}

function fieldKey(change: Pick<NormalizedChangeSet, "entityType" | "entityId" | "fieldPath">) {
  return `${change.entityType}:${change.entityId}:${change.fieldPath}`;
}

function addUnique(existing: unknown[], added: unknown[]) {
  const seen = new Set(existing.map(stableValueKey));
  const out = [...existing];
  for (const item of added) {
    const key = stableValueKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function removeValues(existing: unknown[], removed: unknown[]) {
  const removedKeys = new Set(removed.map(stableValueKey));
  return existing.filter((item) => !removedKeys.has(stableValueKey(item)));
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

export function applyChangeToState(state: Map<string, ReconstructedField>, change: NormalizedChangeSet) {
  const key = fieldKey(change);
  const previous = state.get(key);
  if (change.operation === "unchanged") return;
  if (change.operation === "deleted") {
    state.delete(key);
    return;
  }
  let value = change.newValue;
  if (change.operation === "appended") value = addUnique(arrayValue(previous?.value), arrayValue(change.newValue));
  if (change.operation === "removed") value = removeValues(arrayValue(previous?.value), arrayValue(change.newValue));
  state.set(key, {
    key,
    entityType: change.entityType,
    entityId: change.entityId,
    entityDisplayName: change.entityDisplayName || previous?.entityDisplayName || change.entityId,
    fieldPath: change.fieldPath,
    value,
    introducedAtVersion: previous?.introducedAtVersion || change.versionNumber,
    lastChangedAtVersion: change.versionNumber,
    lastChange: change,
  });
}

export function reconstructStateFromVersions(versions: JsonRecord[], targetVersionNumber: number, sourceRefs: JsonRecord[] = []) {
  const state = new Map<string, ReconstructedField>();
  const appliedChanges: NormalizedChangeSet[] = [];
  for (const version of versions) {
    const number = Number(version.version_number || 0);
    if (number <= 0 || number > targetVersionNumber) continue;
    const changes = normalizeVersionChangeSets(version, sourceRefs);
    for (const change of changes) {
      applyChangeToState(state, change);
      appliedChanges.push(change);
    }
  }
  return { state, appliedChanges };
}

export function displayNameFromCanonical(entityType: string, row: JsonRecord | undefined, fallback: string) {
  if (!row) return fallback;
  if (entityType === "character") return String(row.canonical_name || fallback);
  if (entityType === "event") return String(row.title || fallback);
  if (entityType === "item") return String(row.name || fallback);
  if (entityType === "world_rule") return String(row.title || fallback);
  if (entityType === "foreshadowing") return String(row.title || fallback);
  if (entityType === "open_thread") return String(row.title || fallback);
  return fallback;
}

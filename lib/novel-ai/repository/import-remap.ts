import type { DomainRecord } from "../domain";
import { CHARACTER_AGENT_STORES, DRAMA_STORES, LEGACY_REQUIRED_RESTORE_STORES, NOVEL_STORES, P24A_REQUIRED_RESTORE_STORES, REQUIRED_RESTORE_STORES, type NovelStoreName } from "./contracts";

export function assertCompleteReplacePayload(payload: Record<string, unknown[]>) {
  const containsCharacterAgentData = CHARACTER_AGENT_STORES.some((store) => Object.hasOwn(payload, store));
  const containsDramaData = DRAMA_STORES.some((store) => Object.hasOwn(payload, store));
  const requiredStores = containsCharacterAgentData
    ? REQUIRED_RESTORE_STORES
    : containsDramaData
      ? P24A_REQUIRED_RESTORE_STORES
      : LEGACY_REQUIRED_RESTORE_STORES;
  const missing = requiredStores.filter((store) => !Array.isArray(payload[store]));
  if (missing.length) throw new Error(`BACKUP_REQUIRED_STORE_MISSING:${missing.join(",")}`);
}

export function validateImportRecords(payload: Record<string, unknown[]>) {
  for (const [store, rows] of Object.entries(payload)) {
    if (!NOVEL_STORES.includes(store as NovelStoreName)) throw new Error("BACKUP_UNKNOWN_STORE");
    if (!Array.isArray(rows)) throw new Error("BACKUP_STORE_INVALID");
  }
  const projects = payload.projects;
  if (!Array.isArray(projects) || projects.length !== 1) throw new Error("BACKUP_PROJECT_MISSING");
  const project = projects[0] as DomainRecord;
  const sourceProjectId = project?.projectId || project?.id;
  if (!sourceProjectId || !project?.id) throw new Error("BACKUP_PROJECT_INVALID");
  for (const store of NOVEL_STORES) {
    const seenRecordIds = new Set<string>();
    for (const raw of payload[store] ?? []) {
      const row = raw as DomainRecord;
      if (!row || typeof row !== "object" || !row.id) throw new Error("BACKUP_RECORD_INVALID");
      if (seenRecordIds.has(row.id)) throw new Error(`BACKUP_DUPLICATE_ID:${store}:${row.id}`);
      seenRecordIds.add(row.id);
      if (row.projectId && row.projectId !== sourceProjectId) throw new Error("BACKUP_PROJECT_SCOPE_MISMATCH");
      if (!Number.isInteger(row.revision) || row.revision < 1) throw new Error("BACKUP_REVISION_INVALID");
      if (!row.schemaVersion || !row.createdAt || !row.updatedAt) throw new Error("BACKUP_REQUIRED_FIELD_MISSING");
    }
  }
  const ids = new Set(NOVEL_STORES.flatMap((store) => (payload[store] ?? []).map((raw) => (raw as DomainRecord).id)));
  const accepted = (payload.acceptedChoices ?? []) as Array<DomainRecord & { candidateId?: string; branchId?: string; chapterId?: string; acceptedChoiceId?: string }>;
  const branches = (payload.storyBranches ?? []) as Array<DomainRecord & { branchId?: string; parentBranchId?: string | null; acceptedChoiceId?: string; sourceCandidateId?: string; chapterId?: string }>;
  for (const row of accepted) {
    if (!row.candidateId || !row.branchId || !row.chapterId || !ids.has(row.candidateId) || !ids.has(row.branchId) || !ids.has(row.chapterId)) throw new Error("BACKUP_ACCEPTED_CHOICE_REFERENCE_INVALID");
    if (row.acceptedChoiceId && row.acceptedChoiceId !== row.id) throw new Error("BACKUP_ACCEPTED_CHOICE_ID_MISMATCH");
  }
  const branchMap = new Map(branches.map((row) => [row.id, row]));
  for (const row of branches) {
    if ((row.branchId && row.branchId !== row.id) || !row.acceptedChoiceId || !row.sourceCandidateId || !row.chapterId || !ids.has(row.acceptedChoiceId) || !ids.has(row.sourceCandidateId) || !ids.has(row.chapterId)) throw new Error("BACKUP_STORY_BRANCH_REFERENCE_INVALID");
    if (row.parentBranchId && !branchMap.has(row.parentBranchId)) throw new Error("BACKUP_PARENT_BRANCH_MISSING");
    const seen = new Set<string>([row.id]); let parent = row.parentBranchId ?? null;
    while (parent) { if (seen.has(parent)) throw new Error("BACKUP_BRANCH_CYCLE"); seen.add(parent); parent = branchMap.get(parent)?.parentBranchId ?? null; }
  }
  const deltas = (payload.storyBibleDeltas ?? []) as Array<DomainRecord & { transactionId?: string; candidateId?: string; acceptedChoiceId?: string; chapterId?: string }>;
  const approvals = (payload.approvalTransactions ?? []) as Array<DomainRecord & { transactionId?: string; acceptedChoiceId?: string; branchId?: string; storyBibleDeltaId?: string; candidateId?: string }>;
  const idempotency = (payload.idempotencyRecords ?? []) as Array<DomainRecord & { transactionId?: string; acceptedChoiceId?: string; branchId?: string; storyBibleDeltaId?: string; candidateId?: string }>;
  for (const row of deltas) if (!row.transactionId || !row.candidateId || !row.acceptedChoiceId || !row.chapterId || !ids.has(row.transactionId) || !ids.has(row.candidateId) || !ids.has(row.acceptedChoiceId) || !ids.has(row.chapterId)) throw new Error("BACKUP_STORY_BIBLE_DELTA_REFERENCE_INVALID");
  for (const row of approvals) if (!row.transactionId || row.transactionId !== row.id || !row.acceptedChoiceId || !row.branchId || !row.storyBibleDeltaId || !row.candidateId || !ids.has(row.acceptedChoiceId) || !ids.has(row.branchId) || !ids.has(row.storyBibleDeltaId) || !ids.has(row.candidateId)) throw new Error("BACKUP_APPROVAL_TRANSACTION_REFERENCE_INVALID");
  for (const row of idempotency) if (!row.transactionId || !row.acceptedChoiceId || !row.branchId || !row.storyBibleDeltaId || !row.candidateId || !ids.has(row.transactionId) || !ids.has(row.acceptedChoiceId) || !ids.has(row.branchId) || !ids.has(row.storyBibleDeltaId) || !ids.has(row.candidateId)) throw new Error("BACKUP_IDEMPOTENCY_REFERENCE_INVALID");
  const dramaProjects = (payload.dramaProjects ?? []) as Array<DomainRecord & { dramaProjectId?: string; seasonIds?: string[] }>;
  const canonLinks = (payload.narrativeCanonLinks ?? []) as Array<DomainRecord & { dramaProjectId?: string; episodeIds?: string[] }>;
  const dramaApprovals = (payload.dramaApprovals ?? []) as Array<DomainRecord & { dramaProjectId?: string; approvedEntityIds?: string[] }>;
  for (const row of dramaProjects) {
    if (row.dramaProjectId !== row.id || !row.seasonIds?.every((id) => ids.has(id))) throw new Error("BACKUP_DRAMA_PROJECT_REFERENCE_INVALID");
  }
  for (const row of canonLinks) {
    if (!row.dramaProjectId || !ids.has(row.dramaProjectId) || !row.episodeIds?.every((id) => ids.has(id))) throw new Error("BACKUP_DRAMA_CANON_LINK_REFERENCE_INVALID");
  }
  for (const row of dramaApprovals) {
    if (!row.dramaProjectId || !ids.has(row.dramaProjectId) || !row.approvedEntityIds?.every((id) => ids.has(id))) throw new Error("BACKUP_DRAMA_APPROVAL_REFERENCE_INVALID");
  }
  const profiles = (payload.characterAgentProfiles ?? []) as Array<DomainRecord & { profileId?: string; characterId?: string }>;
  const states = (payload.characterAgentStates ?? []) as Array<DomainRecord & { stateId?: string; characterId?: string; canonContextId?: string }>;
  const memories = (payload.characterMemories ?? []) as Array<DomainRecord & { memoryId?: string; characterId?: string; canonContextId?: string; sourceRevision?: number }>;
  const relationshipEvents = (payload.characterRelationshipEvents ?? []) as Array<DomainRecord & { eventId?: string; relationshipId?: string; evidenceIds?: string[]; idempotencyScope?: string; sourceEventScope?: string }>;
  const proposals = (payload.characterProposals ?? []) as Array<DomainRecord & { proposalId?: string; evaluationId?: string; characterIds?: string[] }>;
  const characterApprovals = (payload.characterAgentApprovals ?? []) as Array<DomainRecord & { approvalId?: string; proposalId?: string; canonicalEntityId?: string; idempotencyScope?: string }>;
  const profileCharacters = new Set(((payload.characters ?? []) as DomainRecord[]).map((row) => row.id));
  for (const row of profiles) {
    if (row.profileId !== row.id || !row.characterId || !profileCharacters.has(row.characterId)) throw new Error("BACKUP_CHARACTER_PROFILE_REFERENCE_INVALID");
  }
  for (const row of states) {
    if (row.stateId !== row.id || !row.characterId || !profileCharacters.has(row.characterId) || !row.canonContextId) throw new Error("BACKUP_CHARACTER_STATE_REFERENCE_INVALID");
  }
  for (const row of memories) {
    if (row.memoryId !== row.id || !row.characterId || !profileCharacters.has(row.characterId) || !row.canonContextId || !Number.isInteger(row.sourceRevision)) throw new Error("BACKUP_CHARACTER_MEMORY_REFERENCE_INVALID");
  }
  const relationshipIds = new Set(((payload.characterRelationships ?? []) as DomainRecord[]).map((row) => row.id));
  const eventIdempotencyScopes = new Set<string>();
  const eventSourceScopes = new Set<string>();
  for (const row of relationshipEvents) {
    if (row.eventId !== row.id || !row.relationshipId || !relationshipIds.has(row.relationshipId) || !row.evidenceIds?.length || !row.idempotencyScope || !row.sourceEventScope) throw new Error("BACKUP_CHARACTER_RELATIONSHIP_EVENT_REFERENCE_INVALID");
    if (eventIdempotencyScopes.has(row.idempotencyScope) || eventSourceScopes.has(row.sourceEventScope)) throw new Error("BACKUP_DUPLICATE_RELATIONSHIP_EVENT");
    eventIdempotencyScopes.add(row.idempotencyScope);
    eventSourceScopes.add(row.sourceEventScope);
  }
  for (const row of proposals) {
    if (row.proposalId !== row.id || !row.evaluationId || !ids.has(row.evaluationId) || !row.characterIds?.every((id) => profileCharacters.has(id))) throw new Error("BACKUP_CHARACTER_PROPOSAL_REFERENCE_INVALID");
  }
  const approvalScopes = new Set<string>();
  for (const row of characterApprovals) {
    if (row.approvalId !== row.id || !row.proposalId || !ids.has(row.proposalId) || !row.canonicalEntityId || !ids.has(row.canonicalEntityId) || !row.idempotencyScope) throw new Error("BACKUP_CHARACTER_APPROVAL_REFERENCE_INVALID");
    if (approvalScopes.has(row.idempotencyScope)) throw new Error("BACKUP_DUPLICATE_CHARACTER_APPROVAL");
    approvalScopes.add(row.idempotencyScope);
  }
  return { project, sourceProjectId };
}

export function buildImportIdMap(payload: Record<string, unknown[]>, sourceProjectId: string, targetProjectId: string) {
  const idMap = new Map<string, string>([[sourceProjectId, targetProjectId]]);
  for (const store of NOVEL_STORES) for (const raw of payload[store] ?? []) {
    const row = raw as DomainRecord;
    if (row.id === sourceProjectId || store === "projects") idMap.set(row.id, targetProjectId);
    else idMap.set(row.id, crypto.randomUUID());
  }
  const collectCanonContextIds = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(collectCanonContextIds);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if ((key === "canonContextId" || key === "sourceCanonContextId") && typeof item === "string" && item) {
        if (!idMap.has(item)) idMap.set(item, `canon-context:${crypto.randomUUID()}`);
      }
      collectCanonContextIds(item);
    }
  };
  collectCanonContextIds(payload);
  return idMap;
}

const COMPOUND_ID_FIELDS = new Set(["idempotencyKey", "idempotencyScope", "sourceEventScope"]);
const COPY_REVISION_FIELDS = new Set([
  "sourceRevision",
  "sourceCharacterRevision",
  "sourceStoryRevision",
  "sourceStoryBibleVersion",
  "expectedProposalRevision",
  "expectedSourceRevision",
  "expectedSourceStoryBibleVersion",
  "resultingCanonicalRevision",
]);

function remapCompoundIdentity(value: string, idMap: Map<string, string>) {
  return [...idMap.entries()]
    .sort(([left], [right]) => right.length - left.length)
    .reduce((result, [sourceId, targetId]) => result.replaceAll(sourceId, targetId), value);
}

function remapValue(value: unknown, idMap: Map<string, string>, fieldName = ""): unknown {
  if (typeof value === "string") {
    const exact = idMap.get(value);
    if (exact) return exact;
    return COMPOUND_ID_FIELDS.has(fieldName) ? remapCompoundIdentity(value, idMap) : value;
  }
  if (Array.isArray(value)) return value.map((item) => remapValue(item, idMap, fieldName));
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      const mappedKey = idMap.get(key) ?? key;
      if (key === "sourceCharacterRevisions" && item && typeof item === "object" && !Array.isArray(item)) {
        return [mappedKey, Object.fromEntries(Object.keys(item as Record<string, unknown>).map((characterId) => [idMap.get(characterId) ?? characterId, 1]))];
      }
      if (COPY_REVISION_FIELDS.has(key) && typeof item === "number") return [mappedKey, 1];
      return [mappedKey, remapValue(item, idMap, key)];
    });
    const mapped = Object.fromEntries(entries);
    if (typeof mapped.canonContextId === "string" && typeof mapped.novelRevision === "number" && typeof mapped.storyBibleVersion === "number") {
      mapped.novelRevision = 1;
      mapped.storyBibleVersion = 1;
      if (typeof mapped.dramaAdaptationRevision === "number") mapped.dramaAdaptationRevision = 1;
    }
    return mapped;
  }
  return value;
}

export function remapImportedRecord(raw: DomainRecord, targetProjectId: string, idMap: Map<string, string>, copy: boolean) {
  if (!copy) return structuredClone({ ...raw, projectId: targetProjectId }) as DomainRecord;
  const mapped = remapValue(raw, idMap) as Record<string, unknown>;
  return {
    ...mapped,
    id: idMap.get(raw.id)!,
    projectId: targetProjectId,
    revision: 1,
    parentRevision: null,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    migrationVersion: "p21-backup-import-v2",
  } as DomainRecord;
}

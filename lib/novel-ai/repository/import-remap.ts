import type { DomainRecord } from "../domain";
import { NOVEL_STORES, REQUIRED_RESTORE_STORES, type NovelStoreName } from "./contracts";

export function assertCompleteReplacePayload(payload: Record<string, unknown[]>) {
  const missing = REQUIRED_RESTORE_STORES.filter((store) => !Array.isArray(payload[store]));
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
  for (const store of NOVEL_STORES) for (const raw of payload[store] ?? []) {
    const row = raw as DomainRecord;
    if (!row || typeof row !== "object" || !row.id) throw new Error("BACKUP_RECORD_INVALID");
    if (row.projectId && row.projectId !== sourceProjectId) throw new Error("BACKUP_PROJECT_SCOPE_MISMATCH");
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
  return { project, sourceProjectId };
}

export function buildImportIdMap(payload: Record<string, unknown[]>, sourceProjectId: string, targetProjectId: string) {
  const idMap = new Map<string, string>([[sourceProjectId, targetProjectId]]);
  for (const store of NOVEL_STORES) for (const raw of payload[store] ?? []) {
    const row = raw as DomainRecord;
    if (row.id === sourceProjectId || store === "projects") idMap.set(row.id, targetProjectId);
    else idMap.set(row.id, crypto.randomUUID());
  }
  return idMap;
}

function remapValue(value: unknown, idMap: Map<string, string>): unknown {
  if (typeof value === "string") return idMap.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => remapValue(item, idMap));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, remapValue(item, idMap)]));
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

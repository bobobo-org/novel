import type { AcceptedChoice, ApprovalTransaction, Chapter, ChoiceCandidate, DomainRecord, IdempotencyRecord, NovelProject, ProjectBundle, StoryBible, StoryBibleDelta, StoryBranch, StoryState } from "../../domain/index";
import { acceptChoicePayloadFingerprint, buildAcceptedChoiceRecords } from "../../services/accept-choice";
import { NOVEL_STORES, RepositoryOperationError, RevisionConflictError, type AcceptChoiceTransactionInput, type AcceptChoiceTransactionResult, type NovelRepository, type NovelStoreName } from "../contracts/index";
import { assertCompleteReplacePayload, buildImportIdMap, remapImportedRecord, validateImportRecords } from "../import-remap";

export class MemoryNovelRepository implements NovelRepository {
  readonly kind = "memory" as const;
  private stores = new Map<NovelStoreName, Map<string, DomainRecord>>(NOVEL_STORES.map((name) => [name, new Map()]));
  private requests = new Map<string, ProjectBundle>();
  private interactionQueue: Promise<unknown> = Promise.resolve();
  isAvailable() { return true; }
  async get<T extends DomainRecord>(store: NovelStoreName, id: string) { return (structuredClone(this.stores.get(store)?.get(id)) as T | undefined) ?? null; }
  async list<T extends DomainRecord>(store: NovelStoreName, projectId?: string) { return [...(this.stores.get(store)?.values() ?? [])].filter((item) => !projectId || item.projectId === projectId).map((item) => structuredClone(item) as T); }
  async put<T extends DomainRecord>(store: NovelStoreName, record: T, expectedRevision?: number) {
    const current = this.stores.get(store)?.get(record.id);
    if (expectedRevision !== undefined && (current?.revision ?? 0) !== expectedRevision) throw new RevisionConflictError(expectedRevision, current?.revision ?? 0);
    const next = { ...record, revision: current ? current.revision + 1 : record.revision, updatedAt: new Date().toISOString(), parentRevision: current?.revision ?? null } as T;
    this.stores.get(store)?.set(next.id, structuredClone(next)); return structuredClone(next);
  }
  async remove(store: NovelStoreName, id: string) { this.stores.get(store)?.delete(id); }
  async createProject(bundle: ProjectBundle, requestId: string) {
    const replay = this.requests.get(requestId); if (replay) return structuredClone(replay);
    if (await this.get("projects", bundle.project.id)) throw new Error("PROJECT_ALREADY_EXISTS");
    const writes: Array<[NovelStoreName, DomainRecord | null]> = [["projects",bundle.project],["projectSeeds",bundle.seed],["storyBibles",bundle.storyBible],["characters",bundle.protagonist],["worlds",bundle.world],["storyStates",bundle.storyState],["tasks",bundle.initialTask],["readerStates",bundle.readerState],["backups",bundle.initialBackup]];
    for (const [store, record] of writes) if (record) await this.put(store, record);
    this.requests.set(requestId, structuredClone(bundle)); return structuredClone(bundle);
  }
  acceptChoiceTransaction(input: AcceptChoiceTransactionInput): Promise<AcceptChoiceTransactionResult> {
    const run = this.interactionQueue.then(() => this.acceptChoiceTransactionInternal(input));
    this.interactionQueue = run.catch(() => undefined);
    return run;
  }
  private async acceptChoiceTransactionInternal(input: AcceptChoiceTransactionInput): Promise<AcceptChoiceTransactionResult> {
    const replay = (await this.list<IdempotencyRecord>("idempotencyRecords", input.projectId)).find((item) => item.idempotencyKey === input.idempotencyKey);
    if (replay) {
      if (replay.payloadFingerprint !== acceptChoicePayloadFingerprint(input)) throw new RepositoryOperationError("IDEMPOTENCY_PAYLOAD_MISMATCH");
      const [project, chapter, candidate, acceptedChoice, branch, storyBible, storyBibleDelta, approvalTransaction] = await Promise.all([
        this.get<NovelProject>("projects", input.projectId), this.get<Chapter>("chapters", input.chapterId), this.get<ChoiceCandidate>("candidates", input.candidateId),
        this.get<AcceptedChoice>("acceptedChoices", replay.acceptedChoiceId), this.get<StoryBranch>("storyBranches", replay.branchId),
        (this.list<StoryBible>("storyBibles", input.projectId)).then((rows) => rows[0] ?? null), this.get<StoryBibleDelta>("storyBibleDeltas", replay.storyBibleDeltaId),
        this.get<ApprovalTransaction>("approvalTransactions", replay.transactionId),
      ]);
      const storyState = (await this.list<StoryState>("storyStates", input.projectId))[0] ?? null;
      if (!project || !chapter || !candidate || !storyState || !acceptedChoice || !branch || !storyBible || !storyBibleDelta || !approvalTransaction) throw new RepositoryOperationError("IDEMPOTENCY_REPLAY_INCOMPLETE");
      return { replayed: true, project, chapter, candidate, storyState, acceptedChoice, branch, storyBible, storyBibleDelta, approvalTransaction, idempotencyRecord: replay };
    }
    const project = await this.get<NovelProject>("projects", input.projectId), chapter = await this.get<Chapter>("chapters", input.chapterId), candidate = await this.get<ChoiceCandidate>("candidates", input.candidateId), storyState = (await this.list<StoryState>("storyStates", input.projectId))[0] ?? null, storyBible = (await this.list<StoryBible>("storyBibles", input.projectId))[0] ?? null, parentBranch = input.parentBranchId ? await this.get<StoryBranch>("storyBranches", input.parentBranchId) : null;
    if (!project || !chapter || !candidate || !storyState || !storyBible) throw new RepositoryOperationError("ACCEPT_CHOICE_RECORD_MISSING");
    const records = buildAcceptedChoiceRecords(input, { project, chapter, candidate, storyState, storyBible, parentBranch });
    const before = new Map(NOVEL_STORES.map((name) => [name, new Map([...(this.stores.get(name)?.entries() ?? [])].map(([id, row]) => [id, structuredClone(row)]))]));
    try {
      for (const [store, row] of [["projects",records.project],["chapters",records.chapter],["candidates",records.candidate],["storyStates",records.storyState],["acceptedChoices",records.acceptedChoice],["storyBranches",records.branch],["storyBibles",records.storyBible],["storyBibleDeltas",records.storyBibleDelta],["approvalTransactions",records.approvalTransaction],["idempotencyRecords",records.idempotencyRecord],["operationJournal",records.journal]] as Array<[NovelStoreName, DomainRecord]>) this.stores.get(store)?.set(row.id, structuredClone(row));
      return { replayed: false, project: records.project, chapter: records.chapter, candidate: records.candidate, storyState: records.storyState, acceptedChoice: records.acceptedChoice, branch: records.branch, storyBible: records.storyBible, storyBibleDelta: records.storyBibleDelta, approvalTransaction: records.approvalTransaction, idempotencyRecord: records.idempotencyRecord };
    } catch (error) { this.stores = before; throw error; }
  }
  async listAcceptedChoices(projectId: string, chapterId?: string) { return (await this.list<AcceptedChoice>("acceptedChoices", projectId)).filter((item) => !chapterId || item.chapterId === chapterId); }
  async listStoryBranches(projectId: string, chapterId?: string) { return (await this.list<StoryBranch>("storyBranches", projectId)).filter((item) => !chapterId || item.chapterId === chapterId); }
  async deleteInteractionsByProject(projectId: string) { for (const store of ["acceptedChoices","storyBranches","storyBibleDeltas","approvalTransactions","idempotencyRecords","operationJournal"] as NovelStoreName[]) for (const row of await this.list(store, projectId)) await this.remove(store, row.id); }
  async exportProject(projectId: string) { const output: Record<string, unknown[]> = {}; for (const store of NOVEL_STORES) output[store] = await this.list(store, projectId); return output; }
  async importProject(payload: Record<string, unknown[]>, mode: "copy" | "replace", targetProjectId?: string) {
    const { sourceProjectId: sourceId } = validateImportRecords(payload);
    if (mode === "replace") assertCompleteReplacePayload(payload);
    const nextProjectId = mode === "replace" ? (targetProjectId || sourceId) : crypto.randomUUID();
    const idMap = buildImportIdMap(payload, sourceId, nextProjectId);
    const previous = mode === "replace" ? await this.exportProject(nextProjectId) : null;
    try {
      if (mode === "replace") for (const store of NOVEL_STORES.filter((store) => store !== "backups")) for (const record of await this.list(store, nextProjectId)) await this.remove(store, record.id);
      for (const store of NOVEL_STORES) {
        if (mode === "replace" && store === "backups") continue;
        for (const raw of payload[store] ?? []) {
          const row = remapImportedRecord(raw as DomainRecord, nextProjectId, idMap, mode === "copy");
          this.stores.get(store)?.set(row.id, structuredClone(row));
        }
      }
      return nextProjectId;
    } catch (error) {
      if (previous) {
        for (const store of NOVEL_STORES.filter((name) => name !== "backups")) for (const record of await this.list(store, nextProjectId)) await this.remove(store, record.id);
        for (const store of NOVEL_STORES.filter((name) => name !== "backups")) for (const raw of previous[store] ?? []) {
          const row = raw as DomainRecord; this.stores.get(store)?.set(row.id, structuredClone(row));
        }
      }
      throw error;
    }
  }
}

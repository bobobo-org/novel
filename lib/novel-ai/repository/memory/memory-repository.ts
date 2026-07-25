import type { AcceptedChoice, ApprovalTransaction, Chapter, ChoiceCandidate, DomainRecord, IdempotencyRecord, NovelProject, ProjectBundle, StoryBible, StoryBibleDelta, StoryBranch, StoryState } from "../../domain/index";
import { buildDramaApprovalRecords } from "../../drama-os/approval";
import type { ApproveDramaProjectionInput, ApproveDramaProjectionResult, DramaApprovalRecord, DramaEvaluation, DramaProject, DramaProjectionPackage, MarkDramaProjectionsStaleInput, MarkDramaProjectionsStaleResult, NarrativeCanonLink } from "../../drama-os/types";
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
  async saveDramaProjectionTransaction(input: DramaProjectionPackage): Promise<void> {
    const rows: Array<[NovelStoreName, DomainRecord[]]> = [
      ["dramaProjects", [input.project]],
      ["dramaSeasons", input.seasons],
      ["dramaEpisodes", input.episodes],
      ["dramaScenes", input.scenes],
      ["dramaBeats", input.beats],
      ["dramaBranchCandidates", input.branchCandidates],
      ["dramaEvaluations", input.evaluations],
      ["narrativeCanonLinks", input.canonLinks],
    ];
    if (rows.some(([, records]) => records.some((record) => record.projectId !== input.project.projectId))) {
      throw new RepositoryOperationError("DRAMA_PROJECT_SCOPE_MISMATCH");
    }
    const before = new Map(NOVEL_STORES.map((name) => [name, new Map([...(this.stores.get(name)?.entries() ?? [])].map(([id, row]) => [id, structuredClone(row)]))]));
    try {
      for (const [store, records] of rows) for (const record of records) this.stores.get(store)?.set(record.id, structuredClone(record));
    } catch (error) {
      this.stores = before;
      throw error;
    }
  }
  approveDramaProjectionTransaction(input: ApproveDramaProjectionInput): Promise<ApproveDramaProjectionResult> {
    const run = this.interactionQueue.then(() => this.approveDramaProjectionTransactionInternal(input));
    this.interactionQueue = run.catch(() => undefined);
    return run;
  }
  private async approveDramaProjectionTransactionInternal(input: ApproveDramaProjectionInput): Promise<ApproveDramaProjectionResult> {
    const replay = (await this.list<DramaApprovalRecord>("dramaApprovals", input.projectId))
      .find((record) => record.idempotencyKey === input.idempotencyKey);
    if (replay) {
      if (replay.dramaProjectId !== input.dramaProjectId || replay.payloadFingerprint !== input.payloadFingerprint) {
        throw new RepositoryOperationError("DRAMA_IDEMPOTENCY_PAYLOAD_MISMATCH");
      }
      const project = await this.get<DramaProject>("dramaProjects", replay.dramaProjectId);
      const canonLink = (await this.list<NarrativeCanonLink>("narrativeCanonLinks", input.projectId))
        .find((record) => record.dramaProjectId === replay.dramaProjectId && record.dramaAdaptationRevision === replay.resultingAdaptationRevision);
      if (!project || !canonLink) throw new RepositoryOperationError("DRAMA_IDEMPOTENCY_REPLAY_INCOMPLETE");
      return { replayed: true, project, approval: replay, canonLink };
    }
    const currentProject = await this.get<DramaProject>("dramaProjects", input.dramaProjectId);
    const currentCanonLink = (await this.list<NarrativeCanonLink>("narrativeCanonLinks", input.projectId))
      .find((record) => record.dramaProjectId === input.dramaProjectId);
    if (!currentProject || !currentCanonLink) throw new RepositoryOperationError("DRAMA_PROJECTION_NOT_FOUND");
    const sourceProject = await this.get<NovelProject>("projects", input.projectId);
    const sourceStoryBible = (await this.list<StoryBible>("storyBibles", input.projectId))[0] ?? null;
    if (!sourceProject || sourceProject.revision !== input.expectedSourceStoryRevision) {
      throw new RepositoryOperationError("DRAMA_SOURCE_REVISION_STALE", "小說內容已更新，請重新建立改編候選。");
    }
    if (!sourceStoryBible || sourceStoryBible.revision !== input.expectedStoryBibleVersion) {
      throw new RepositoryOperationError("DRAMA_STORY_BIBLE_STALE", "角色與世界設定已更新，請重新建立改編候選。");
    }
    const blockingEvaluation = (await this.list<DramaEvaluation>("dramaEvaluations", input.projectId))
      .find((record) => record.dramaProjectId === input.dramaProjectId && record.blockingIssueCount > 0);
    if (blockingEvaluation) throw new RepositoryOperationError("DRAMA_APPROVAL_BLOCKED");
    const records = buildDramaApprovalRecords(input, currentProject, currentCanonLink);
    const before = new Map(NOVEL_STORES.map((name) => [name, new Map([...(this.stores.get(name)?.entries() ?? [])].map(([id, row]) => [id, structuredClone(row)]))]));
    try {
      this.stores.get("dramaProjects")?.set(records.project.id, structuredClone(records.project));
      this.stores.get("dramaApprovals")?.set(records.approval.id, structuredClone(records.approval));
      this.stores.get("narrativeCanonLinks")?.set(records.canonLink.id, structuredClone(records.canonLink));
      return { replayed: false, ...records };
    } catch (error) {
      this.stores = before;
      throw error;
    }
  }
  async markDramaProjectionsStaleTransaction(input: MarkDramaProjectionsStaleInput): Promise<MarkDramaProjectionsStaleResult> {
    const projects = await this.list<DramaProject>("dramaProjects", input.projectId);
    const links = await this.list<NarrativeCanonLink>("narrativeCanonLinks", input.projectId);
    const staleProjects = projects.filter((row) =>
      row.status !== "approved"
      && row.status !== "rejected"
      && row.status !== "private_simulation"
      && (row.sourceStoryRevision !== input.currentStoryRevision || row.sourceStoryBibleVersion !== input.currentStoryBibleVersion));
    const staleProjectIds = new Set(projects.filter((row) =>
      row.sourceStoryRevision !== input.currentStoryRevision || row.sourceStoryBibleVersion !== input.currentStoryBibleVersion)
      .map((row) => row.dramaProjectId));
    const staleLinks = links.filter((row) => staleProjectIds.has(row.dramaProjectId) && row.projectionStatus !== "stale");
    const beforeProjects = new Map([...(this.stores.get("dramaProjects")?.entries() ?? [])].map(([id, row]) => [id, structuredClone(row)]));
    const beforeLinks = new Map([...(this.stores.get("narrativeCanonLinks")?.entries() ?? [])].map(([id, row]) => [id, structuredClone(row)]));
    const now = new Date().toISOString();
    try {
      for (const row of staleProjects) this.stores.get("dramaProjects")?.set(row.id, structuredClone({
        ...row,
        status: "stale",
        parentRevision: row.revision,
        revision: row.revision + 1,
        updatedAt: now,
      }));
      for (const row of staleLinks) this.stores.get("narrativeCanonLinks")?.set(row.id, structuredClone({
        ...row,
        projectionStatus: "stale",
        staleReason: row.sourceStoryRevision !== input.currentStoryRevision
          ? "SOURCE_STORY_REVISION_CHANGED"
          : "SOURCE_STORY_BIBLE_VERSION_CHANGED",
        parentRevision: row.revision,
        revision: row.revision + 1,
        updatedAt: now,
      }));
      return {
        staleDramaProjectIds: staleProjects.map((row) => row.dramaProjectId),
        staleCanonLinkIds: staleLinks.map((row) => row.canonLinkId),
      };
    } catch (error) {
      this.stores.set("dramaProjects", beforeProjects);
      this.stores.set("narrativeCanonLinks", beforeLinks);
      throw error;
    }
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

import type { AcceptedChoice, ApprovalTransaction, Chapter, ChoiceCandidate, DomainRecord, IdempotencyRecord, NovelProject, OperationJournal, ProjectBundle, StoryBible, StoryBibleDelta, StoryBranch, StoryState } from "../../domain/index";
import { buildDramaApprovalRecords } from "../../drama-os/approval";
import type { ApproveDramaProjectionInput, ApproveDramaProjectionResult, DramaApprovalRecord, DramaEvaluation, DramaProject, DramaProjectionPackage, MarkDramaProjectionsStaleInput, MarkDramaProjectionsStaleResult, NarrativeCanonLink } from "../../drama-os/types";
import { acceptChoicePayloadFingerprint, buildAcceptedChoiceRecords } from "../../services/accept-choice";
import { NOVEL_STORES, RepositoryOperationError, RevisionConflictError, type AcceptChoiceTransactionInput, type AcceptChoiceTransactionResult, type NovelRepository, type NovelStoreName } from "../contracts/index";
import { assertCompleteReplacePayload, buildImportIdMap, remapImportedRecord, validateImportRecords } from "../import-remap";

const DB_NAME = "novel-intelligence-platform";
const DB_VERSION = 5;
const REQUEST_STORE = "requestLedger";

function request<T>(value: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error ?? new Error("INDEXEDDB_REQUEST_FAILED")); }); }
function complete(tx: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error("INDEXEDDB_TRANSACTION_ABORTED")); tx.onerror = () => reject(tx.error ?? new Error("INDEXEDDB_TRANSACTION_FAILED")); }); }

export class IndexedDbNovelRepository implements NovelRepository {
  readonly kind = "indexeddb" as const;
  private dbPromise: Promise<IDBDatabase> | null = null;
  isAvailable() { return typeof indexedDB !== "undefined"; }
  private open() {
    if (!this.isAvailable()) return Promise.reject(new Error("INDEXEDDB_UNAVAILABLE"));
    if (!this.dbPromise) this.dbPromise = new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result, tx = open.transaction!;
        for (const name of [...NOVEL_STORES, REQUEST_STORE]) {
          const store = db.objectStoreNames.contains(name) ? tx.objectStore(name) : db.createObjectStore(name, { keyPath: name === REQUEST_STORE ? "requestId" : "id" });
          if (name !== REQUEST_STORE && !store.indexNames.contains("projectId")) store.createIndex("projectId", "projectId", { unique: false });
          if (name === "acceptedChoices") for (const [index, key, unique] of [["chapterId","chapterId",false],["candidateId","candidateId",true],["branchId","branchId",true],["acceptedChoiceId","acceptedChoiceId",true]] as const) if (!store.indexNames.contains(index)) store.createIndex(index, key, { unique });
          if (name === "storyBranches") for (const [index, key, unique] of [["chapterId","chapterId",false],["parentBranchId","parentBranchId",false],["candidateId","sourceCandidateId",true],["branchId","branchId",true],["acceptedChoiceId","acceptedChoiceId",true],["status","status",false]] as const) if (!store.indexNames.contains(index)) store.createIndex(index, key, { unique });
          if (name === "operationJournal" && !store.indexNames.contains("idempotencyKey")) store.createIndex("idempotencyKey", "idempotencyKey", { unique: true });
          if (name === "idempotencyRecords" && !store.indexNames.contains("idempotencyKey")) store.createIndex("idempotencyKey", "idempotencyKey", { unique: true });
          if (name === "approvalTransactions" && !store.indexNames.contains("idempotencyKey")) store.createIndex("idempotencyKey", "idempotencyKey", { unique: true });
          if (name === "dramaApprovals" && !store.indexNames.contains("idempotencyKey")) store.createIndex("idempotencyKey", "idempotencyKey", { unique: true });
          if (name === "narrativeCanonLinks" && !store.indexNames.contains("dramaProjectId")) store.createIndex("dramaProjectId", "dramaProjectId", { unique: true });
        }
      };
      open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error ?? new Error("INDEXEDDB_OPEN_FAILED")); open.onblocked = () => reject(new Error("INDEXEDDB_UPGRADE_BLOCKED"));
    });
    return this.dbPromise;
  }
  async get<T extends DomainRecord>(store: NovelStoreName, id: string) { const db = await this.open(); return (await request(db.transaction(store).objectStore(store).get(id)) as T | undefined) ?? null; }
  async list<T extends DomainRecord>(store: NovelStoreName, projectId?: string) { const db = await this.open(), objectStore = db.transaction(store).objectStore(store); return await request((projectId ? objectStore.index("projectId").getAll(projectId) : objectStore.getAll()) as IDBRequest<T[]>); }
  async put<T extends DomainRecord>(store: NovelStoreName, record: T, expectedRevision?: number) {
    const db = await this.open(), tx = db.transaction(store, "readwrite"), objectStore = tx.objectStore(store), current = await request(objectStore.get(record.id)) as T | undefined;
    if (expectedRevision !== undefined && (current?.revision ?? 0) !== expectedRevision) { tx.abort(); throw new RevisionConflictError(expectedRevision, current?.revision ?? 0); }
    const next = { ...record, revision: current ? current.revision + 1 : record.revision, updatedAt: new Date().toISOString(), parentRevision: current?.revision ?? null } as T;
    objectStore.put(next); await complete(tx); return next;
  }
  async remove(store: NovelStoreName, id: string) { const db = await this.open(), tx = db.transaction(store, "readwrite"); tx.objectStore(store).delete(id); await complete(tx); }
  async createProject(bundle: ProjectBundle, requestId: string) {
    const db = await this.open(), names = ["projects","projectSeeds","storyBibles","characters","worlds","storyStates","tasks","readerStates","backups",REQUEST_STORE] as string[], tx = db.transaction(names, "readwrite"), ledger = tx.objectStore(REQUEST_STORE);
    const replay = await request(ledger.get(requestId)) as { requestId: string; bundle: ProjectBundle } | undefined;
    if (replay) { tx.abort(); return replay.bundle; }
    if (await request(tx.objectStore("projects").get(bundle.project.id))) { tx.abort(); throw new Error("PROJECT_ALREADY_EXISTS"); }
    const writes: Array<[string, DomainRecord | null]> = [["projects",bundle.project],["projectSeeds",bundle.seed],["storyBibles",bundle.storyBible],["characters",bundle.protagonist],["worlds",bundle.world],["storyStates",bundle.storyState],["tasks",bundle.initialTask],["readerStates",bundle.readerState],["backups",bundle.initialBackup]];
    for (const [store, record] of writes) if (record) tx.objectStore(store).put(record);
    ledger.put({ requestId, projectId: bundle.project.id, bundle, createdAt: new Date().toISOString() }); await complete(tx); return bundle;
  }
  async acceptChoiceTransaction(input: AcceptChoiceTransactionInput): Promise<AcceptChoiceTransactionResult> {
    const db = await this.open();
    const stores: NovelStoreName[] = ["projects","chapters","candidates","storyStates","acceptedChoices","storyBranches","storyBibles","storyBibleDeltas","approvalTransactions","idempotencyRecords","operationJournal"];
    const tx = db.transaction(stores, "readwrite");
    const get = async <T>(store: NovelStoreName, id: string) => await request(tx.objectStore(store).get(id)) as T | undefined;
    try {
      const replay = await request(tx.objectStore("idempotencyRecords").index("idempotencyKey").get(input.idempotencyKey)) as IdempotencyRecord | undefined;
      if (replay) {
        if (replay.projectId !== input.projectId || replay.payloadFingerprint !== acceptChoicePayloadFingerprint(input)) throw new RepositoryOperationError("IDEMPOTENCY_PAYLOAD_MISMATCH");
        const [project, chapter, candidate, storyState, acceptedChoice, branch, storyBible, storyBibleDelta, approvalTransaction] = await Promise.all([
          get<NovelProject>("projects", input.projectId), get<Chapter>("chapters", input.chapterId), get<ChoiceCandidate>("candidates", input.candidateId),
          request(tx.objectStore("storyStates").index("projectId").get(input.projectId)) as Promise<StoryState | undefined>,
          get<AcceptedChoice>("acceptedChoices", replay.acceptedChoiceId), get<StoryBranch>("storyBranches", replay.branchId),
          request(tx.objectStore("storyBibles").index("projectId").get(input.projectId)) as Promise<StoryBible | undefined>,
          get<StoryBibleDelta>("storyBibleDeltas", replay.storyBibleDeltaId), get<ApprovalTransaction>("approvalTransactions", replay.transactionId),
        ]);
        if (!project || !chapter || !candidate || !storyState || !acceptedChoice || !branch || !storyBible || !storyBibleDelta || !approvalTransaction) throw new RepositoryOperationError("IDEMPOTENCY_REPLAY_INCOMPLETE");
        await complete(tx);
        return { replayed: true, project, chapter, candidate, storyState, acceptedChoice, branch, storyBible, storyBibleDelta, approvalTransaction, idempotencyRecord: replay };
      }
      const [project, chapter, candidate, storyState, storyBible, parentBranch] = await Promise.all([
        get<NovelProject>("projects", input.projectId), get<Chapter>("chapters", input.chapterId), get<ChoiceCandidate>("candidates", input.candidateId),
        request(tx.objectStore("storyStates").index("projectId").get(input.projectId)) as Promise<StoryState | undefined>,
        request(tx.objectStore("storyBibles").index("projectId").get(input.projectId)) as Promise<StoryBible | undefined>,
        input.parentBranchId ? get<StoryBranch>("storyBranches", input.parentBranchId) : Promise.resolve(undefined),
      ]);
      if (!project || !chapter || !candidate || !storyState || !storyBible) throw new RepositoryOperationError("ACCEPT_CHOICE_RECORD_MISSING");
      const records = buildAcceptedChoiceRecords(input, { project, chapter, candidate, storyState, storyBible, parentBranch: parentBranch ?? null });
      tx.objectStore("projects").put(records.project);
      tx.objectStore("chapters").put(records.chapter);
      tx.objectStore("candidates").put(records.candidate);
      tx.objectStore("storyStates").put(records.storyState);
      tx.objectStore("acceptedChoices").put(records.acceptedChoice);
      tx.objectStore("storyBranches").put(records.branch);
      tx.objectStore("storyBibles").put(records.storyBible);
      tx.objectStore("storyBibleDeltas").put(records.storyBibleDelta);
      tx.objectStore("approvalTransactions").put(records.approvalTransaction);
      tx.objectStore("idempotencyRecords").put(records.idempotencyRecord);
      tx.objectStore("operationJournal").put(records.journal);
      await complete(tx);
      return { replayed: false, project: records.project, chapter: records.chapter, candidate: records.candidate, storyState: records.storyState, acceptedChoice: records.acceptedChoice, branch: records.branch, storyBible: records.storyBible, storyBibleDelta: records.storyBibleDelta, approvalTransaction: records.approvalTransaction, idempotencyRecord: records.idempotencyRecord };
    } catch (error) {
      try { tx.abort(); } catch { /* transaction already completed */ }
      throw error;
    }
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
    const db = await this.open();
    const stores = rows.map(([store]) => store);
    const tx = db.transaction(stores, "readwrite");
    try {
      for (const [store, records] of rows) for (const record of records) tx.objectStore(store).put(record);
      await complete(tx);
    } catch (error) {
      try { tx.abort(); } catch { /* transaction already completed */ }
      throw error;
    }
  }
  async approveDramaProjectionTransaction(input: ApproveDramaProjectionInput): Promise<ApproveDramaProjectionResult> {
    const db = await this.open();
    const tx = db.transaction(["projects", "storyBibles", "dramaProjects", "dramaApprovals", "narrativeCanonLinks", "dramaEvaluations"], "readwrite");
    try {
      const approvalStore = tx.objectStore("dramaApprovals");
      const replay = await request(approvalStore.index("idempotencyKey").get(input.idempotencyKey)) as DramaApprovalRecord | undefined;
      if (replay) {
        if (replay.projectId !== input.projectId || replay.dramaProjectId !== input.dramaProjectId || replay.payloadFingerprint !== input.payloadFingerprint) {
          throw new RepositoryOperationError("DRAMA_IDEMPOTENCY_PAYLOAD_MISMATCH");
        }
        const project = await request(tx.objectStore("dramaProjects").get(replay.dramaProjectId)) as DramaProject | undefined;
        const canonLink = await request(tx.objectStore("narrativeCanonLinks").index("dramaProjectId").get(replay.dramaProjectId)) as NarrativeCanonLink | undefined;
        if (!project || !canonLink || canonLink.dramaAdaptationRevision !== replay.resultingAdaptationRevision) {
          throw new RepositoryOperationError("DRAMA_IDEMPOTENCY_REPLAY_INCOMPLETE");
        }
        await complete(tx);
        return { replayed: true, project, approval: replay, canonLink };
      }
      const currentProject = await request(tx.objectStore("dramaProjects").get(input.dramaProjectId)) as DramaProject | undefined;
      const currentCanonLink = await request(tx.objectStore("narrativeCanonLinks").index("dramaProjectId").get(input.dramaProjectId)) as NarrativeCanonLink | undefined;
      if (!currentProject || !currentCanonLink) throw new RepositoryOperationError("DRAMA_PROJECTION_NOT_FOUND");
      const sourceProject = await request(tx.objectStore("projects").get(input.projectId)) as NovelProject | undefined;
      const sourceStoryBibles = await request(tx.objectStore("storyBibles").index("projectId").getAll(input.projectId)) as StoryBible[];
      const sourceStoryBible = sourceStoryBibles[0];
      if (!sourceProject || sourceProject.revision !== input.expectedSourceStoryRevision) {
        throw new RepositoryOperationError("DRAMA_SOURCE_REVISION_STALE", "小說內容已更新，請重新建立改編候選。");
      }
      if (!sourceStoryBible || sourceStoryBible.revision !== input.expectedStoryBibleVersion) {
        throw new RepositoryOperationError("DRAMA_STORY_BIBLE_STALE", "角色與世界設定已更新，請重新建立改編候選。");
      }
      const evaluations = await request(tx.objectStore("dramaEvaluations").index("projectId").getAll(input.projectId)) as DramaEvaluation[];
      if (evaluations.some((record) => record.dramaProjectId === input.dramaProjectId && record.blockingIssueCount > 0)) {
        throw new RepositoryOperationError("DRAMA_APPROVAL_BLOCKED");
      }
      const records = buildDramaApprovalRecords(input, currentProject, currentCanonLink);
      tx.objectStore("dramaProjects").put(records.project);
      approvalStore.put(records.approval);
      tx.objectStore("narrativeCanonLinks").put(records.canonLink);
      await complete(tx);
      return { replayed: false, ...records };
    } catch (error) {
      try { tx.abort(); } catch { /* transaction already completed */ }
      throw error;
    }
  }
  async markDramaProjectionsStaleTransaction(input: MarkDramaProjectionsStaleInput): Promise<MarkDramaProjectionsStaleResult> {
    const db = await this.open();
    const tx = db.transaction(["dramaProjects", "narrativeCanonLinks"], "readwrite");
    try {
      const projectStore = tx.objectStore("dramaProjects");
      const linkStore = tx.objectStore("narrativeCanonLinks");
      const projects = await request(projectStore.index("projectId").getAll(input.projectId)) as DramaProject[];
      const links = await request(linkStore.index("projectId").getAll(input.projectId)) as NarrativeCanonLink[];
      const staleProjects = projects.filter((row) =>
        row.status !== "approved"
        && row.status !== "rejected"
        && row.status !== "private_simulation"
        && (row.sourceStoryRevision !== input.currentStoryRevision || row.sourceStoryBibleVersion !== input.currentStoryBibleVersion));
      const staleProjectIds = new Set(projects.filter((row) =>
        row.sourceStoryRevision !== input.currentStoryRevision || row.sourceStoryBibleVersion !== input.currentStoryBibleVersion)
        .map((row) => row.dramaProjectId));
      const staleLinks = links.filter((row) => staleProjectIds.has(row.dramaProjectId) && row.projectionStatus !== "stale");
      const now = new Date().toISOString();
      for (const row of staleProjects) projectStore.put({
        ...row,
        status: "stale",
        parentRevision: row.revision,
        revision: row.revision + 1,
        updatedAt: now,
      });
      for (const row of staleLinks) linkStore.put({
        ...row,
        projectionStatus: "stale",
        staleReason: row.sourceStoryRevision !== input.currentStoryRevision
          ? "SOURCE_STORY_REVISION_CHANGED"
          : "SOURCE_STORY_BIBLE_VERSION_CHANGED",
        parentRevision: row.revision,
        revision: row.revision + 1,
        updatedAt: now,
      });
      await complete(tx);
      return {
        staleDramaProjectIds: staleProjects.map((row) => row.dramaProjectId),
        staleCanonLinkIds: staleLinks.map((row) => row.canonLinkId),
      };
    } catch (error) {
      try { tx.abort(); } catch { /* transaction already completed */ }
      throw error;
    }
  }
  async listAcceptedChoices(projectId: string, chapterId?: string) { return (await this.list<AcceptedChoice>("acceptedChoices", projectId)).filter((item) => !chapterId || item.chapterId === chapterId); }
  async listStoryBranches(projectId: string, chapterId?: string) { return (await this.list<StoryBranch>("storyBranches", projectId)).filter((item) => !chapterId || item.chapterId === chapterId); }
  async deleteInteractionsByProject(projectId: string) {
    const db = await this.open(), stores: NovelStoreName[] = ["acceptedChoices","storyBranches","storyBibleDeltas","approvalTransactions","idempotencyRecords","operationJournal"], tx = db.transaction(stores, "readwrite");
    for (const store of stores) { const objectStore = tx.objectStore(store), keys = await request(objectStore.index("projectId").getAllKeys(projectId)); for (const key of keys) objectStore.delete(key); }
    await complete(tx);
  }
  async exportProject(projectId: string) {
    const db = await this.open(), tx = db.transaction([...NOVEL_STORES], "readonly"), output: Record<string, unknown[]> = {};
    await Promise.all(NOVEL_STORES.map(async (store) => { output[store] = await request(tx.objectStore(store).index("projectId").getAll(projectId)); }));
    await complete(tx); return output;
  }
  async importProject(payload: Record<string, unknown[]>, mode: "copy" | "replace", targetProjectId?: string) {
    const { sourceProjectId: sourceId } = validateImportRecords(payload);
    if (mode === "replace") assertCompleteReplacePayload(payload);
    const nextProjectId = mode === "replace" ? (targetProjectId || sourceId) : crypto.randomUUID();
    const idMap = buildImportIdMap(payload, sourceId, nextProjectId);
    const db = await this.open();
    // Keep recovery points while replacing content. The caller deliberately creates a
    // safety backup before restore; deleting it in the same operation defeats recovery.
    const replaceStores = NOVEL_STORES.filter((store) => store !== "backups");
    const tx = db.transaction([...NOVEL_STORES], "readwrite");
    if (mode === "replace") for (const store of replaceStores) {
      const objectStore = tx.objectStore(store);
      const keys = await request(objectStore.index("projectId").getAllKeys(nextProjectId));
      for (const key of keys) objectStore.delete(key);
    }
    for (const store of NOVEL_STORES) {
      if (mode === "replace" && store === "backups") continue;
      for (const raw of payload[store] ?? []) {
      tx.objectStore(store).put(remapImportedRecord(raw as DomainRecord, nextProjectId, idMap, mode === "copy"));
      }
    }
    await complete(tx); return nextProjectId;
  }
}

export function indexedDbCapability() { return { supported: typeof indexedDB !== "undefined", database: DB_NAME, version: DB_VERSION, stores: [...NOVEL_STORES] }; }

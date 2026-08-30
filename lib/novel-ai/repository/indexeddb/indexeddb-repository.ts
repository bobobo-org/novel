import type { AcceptedChoice, ApprovalTransaction, Chapter, ChoiceCandidate, ConversationApprovalTransaction, ConversationArtifact, ConversationMessage, ConversationSession, ConversationSummary, ConversationToolInvocation, DomainRecord, IdempotencyRecord, NovelProject, ProjectBundle, RpgTurnReceipt, StoryBible, StoryBibleDelta, StoryBranch, StoryState } from "../../domain/index";
import { buildDramaApprovalRecords } from "../../drama-os/approval";
import type { ApproveDramaProjectionInput, ApproveDramaProjectionResult, DramaApprovalRecord, DramaEvaluation, DramaProject, DramaProjectionPackage, MarkDramaProjectionsStaleInput, MarkDramaProjectionsStaleResult, NarrativeCanonLink } from "../../drama-os/types";
import { buildCharacterApprovalRecords, buildCharacterRejectionRecords } from "../../character-agent/approval-service";
import type {
  ApproveCharacterProposalInput,
  ApproveCharacterProposalResult,
  CharacterAgentApprovalRecord,
  CharacterAgentEvaluation,
  CharacterProposalEnvelope,
  RejectCharacterProposalInput,
  RejectCharacterProposalResult,
} from "../../character-agent/types";
import { acceptChoicePayloadFingerprint, assertAcceptChoiceInput, buildAcceptedChoiceRecords } from "../../services/accept-choice";
import {
  assertRpgContextRevisionGuard,
  assertRpgContextRevisionGuardIntegrity,
  RPG_CONTEXT_REVISION_STORE_NAMES,
  type RpgContextRevisionRecords,
} from "../../services/rpg-context-revision";
import { NOVEL_STORES, RepositoryOperationError, RevisionConflictError, type AcceptChoiceTransactionInput, type AcceptChoiceTransactionResult, type ApproveConversationArtifactTransactionInput, type ApproveConversationArtifactTransactionResult, type CommitStudioCandidateTransactionInput, type CommitStudioCandidateTransactionResult, type MarkConversationArtifactApprovedFromExternalCommitInput, type NovelRepository, type NovelStoreName, type StudioCandidateOperationJournal } from "../contracts/index";
import { assertCompleteReplacePayload, buildImportIdMap, remapImportedRecord, validateImportRecords } from "../import-remap";
import { assertStudioCandidateReplay, buildStudioCandidateCommitRecords } from "../studio-candidate-transaction";
import { notifyCloudSyncMutation } from "../../cloud-sync/mutation-events";
import {
  acceptedChoiceConversationApprovalPayloadFingerprint,
  assertAcceptedChoiceConversationApprovalReplay,
  assertConversationApprovalExecutionTruth,
  assertConversationApprovalReplay,
  assertConversationApprovalSource,
  buildConversationApprovalRecords,
  buildNextConversationCanonicalRecord,
  conversationApprovalPayloadFingerprint,
  conversationCanonicalRecordDigest,
  conversationContentDigest,
  prepareAcceptedChoiceConversationApproval,
  type ConversationArtifactApprovalInput,
} from "../../conversation/approval-transaction";
import { assertConversationRecordSafe } from "../../conversation/record-security";
import { sha256Hex, stableStringify } from "../../closed-ai-cache";
import {
  asIndexedDbRepositoryError,
  INDEXEDDB_DATABASE_VERSION,
  IndexedDbRepositoryError,
} from "../persistence-recovery";
import { resolveProjectStoryBible } from "../../domain/story-bible-selection";

const DB_NAME = "novel-intelligence-platform";
const DB_VERSION = INDEXEDDB_DATABASE_VERSION;
const REQUEST_STORE = "requestLedger";
const REQUIRED_STORES = [...new Set([...NOVEL_STORES, REQUEST_STORE])];

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(asIndexedDbRepositoryError(value.error, "INDEXEDDB_REQUEST_FAILED"));
  });
}

function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(asIndexedDbRepositoryError(tx.error, "INDEXEDDB_TRANSACTION_ABORTED"));
    tx.onerror = () => reject(asIndexedDbRepositoryError(tx.error, "INDEXEDDB_TRANSACTION_FAILED"));
  });
}

export class IndexedDbNovelRepository implements NovelRepository {
  readonly kind = "indexeddb" as const;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private characterInteractionQueue: Promise<unknown> = Promise.resolve();
  private readonly approvalFaultInjector: ((point: string) => void) | null;
  constructor(options: { approvalFaultInjector?: (point: string) => void } = {}) {
    this.approvalFaultInjector = options.approvalFaultInjector ?? null;
  }
  private inject(point: string) { this.approvalFaultInjector?.(point); }
  isAvailable() { return typeof indexedDB !== "undefined"; }
  private open() {
    if (!this.isAvailable()) return Promise.reject(new IndexedDbRepositoryError("INDEXEDDB_UNAVAILABLE"));
    if (!this.dbPromise) {
      let settled = false;
      const pending = new Promise<IDBDatabase>((resolve, reject) => {
        const fail = (error: unknown, fallback: Parameters<typeof asIndexedDbRepositoryError>[1]) => {
          if (settled) return;
          settled = true;
          reject(asIndexedDbRepositoryError(error, fallback));
        };
        const open = indexedDB.open(DB_NAME, DB_VERSION);
        open.onupgradeneeded = () => {
          try {
            const db = open.result, tx = open.transaction!;
            for (const name of REQUIRED_STORES) {
              const store = db.objectStoreNames.contains(name) ? tx.objectStore(name) : db.createObjectStore(name, { keyPath: name === REQUEST_STORE ? "requestId" : "id" });
              if (name !== REQUEST_STORE && !store.indexNames.contains("projectId")) store.createIndex("projectId", "projectId", { unique: false });
              if (name === "acceptedChoices") for (const [index, key, unique] of [["chapterId","chapterId",false],["candidateId","candidateId",true],["branchId","branchId",true],["acceptedChoiceId","acceptedChoiceId",true]] as const) if (!store.indexNames.contains(index)) store.createIndex(index, key, { unique });
              if (name === "storyBranches") for (const [index, key, unique] of [["chapterId","chapterId",false],["parentBranchId","parentBranchId",false],["candidateId","sourceCandidateId",true],["branchId","branchId",true],["acceptedChoiceId","acceptedChoiceId",true],["status","status",false]] as const) if (!store.indexNames.contains(index)) store.createIndex(index, key, { unique });
              if (name === "operationJournal" && !store.indexNames.contains("idempotencyKey")) store.createIndex("idempotencyKey", "idempotencyKey", { unique: true });
              if (name === "idempotencyRecords" && !store.indexNames.contains("idempotencyKey")) store.createIndex("idempotencyKey", "idempotencyKey", { unique: true });
              if (name === "approvalTransactions" && !store.indexNames.contains("idempotencyKey")) store.createIndex("idempotencyKey", "idempotencyKey", { unique: true });
              if (name === "rpgTurnReceipts") {
                if (!store.indexNames.contains("acceptedChoiceId")) store.createIndex("acceptedChoiceId", "acceptedChoiceId", { unique: true });
                if (!store.indexNames.contains("operationId")) store.createIndex("operationId", "operationId", { unique: true });
                if (!store.indexNames.contains("chapterId")) store.createIndex("chapterId", "chapterId", { unique: false });
              }
              if (name === "dramaApprovals" && !store.indexNames.contains("idempotencyKey")) store.createIndex("idempotencyKey", "idempotencyKey", { unique: true });
              if (name === "narrativeCanonLinks" && !store.indexNames.contains("dramaProjectId")) store.createIndex("dramaProjectId", "dramaProjectId", { unique: true });
              if (name === "characterAgentApprovals" && !store.indexNames.contains("idempotencyScope")) store.createIndex("idempotencyScope", "idempotencyScope", { unique: true });
              if (name === "characterRelationshipEvents") {
                if (!store.indexNames.contains("idempotencyScope")) store.createIndex("idempotencyScope", "idempotencyScope", { unique: true });
                if (!store.indexNames.contains("sourceEventScope")) store.createIndex("sourceEventScope", "sourceEventScope", { unique: true });
              }
              if (name === "characterAgentProfiles" && !store.indexNames.contains("characterId")) store.createIndex("characterId", "characterId", { unique: false });
              if (name === "characterMemories" && !store.indexNames.contains("characterId")) store.createIndex("characterId", "characterId", { unique: false });
              if (name === "characterRelationships") {
                if (!store.indexNames.contains("fromCharacterId")) store.createIndex("fromCharacterId", "fromCharacterId", { unique: false });
                if (!store.indexNames.contains("toCharacterId")) store.createIndex("toCharacterId", "toCharacterId", { unique: false });
              }
              if (name === "conversationSessions") {
                if (!store.indexNames.contains("status")) store.createIndex("status", "status", { unique: false });
                if (!store.indexNames.contains("lastMessageAt")) store.createIndex("lastMessageAt", "lastMessageAt", { unique: false });
              }
              if (["conversationMessages", "conversationToolInvocations", "conversationAttachments", "conversationArtifacts", "conversationSummaries", "conversationApprovalTransactions", "learningImportSessions"].includes(name)
                && !store.indexNames.contains("sessionId")) {
                store.createIndex("sessionId", "sessionId", { unique: false });
              }
              if (name === "conversationMessages" && !store.indexNames.contains("sourceMessageId")) store.createIndex("sourceMessageId", "sourceMessageId", { unique: false });
              if (name === "conversationToolInvocations") {
                if (!store.indexNames.contains("messageId")) store.createIndex("messageId", "messageId", { unique: false });
                if (!store.indexNames.contains("taskId")) store.createIndex("taskId", "taskId", { unique: true });
              }
              if (name === "conversationAttachments" && !store.indexNames.contains("contentHash")) store.createIndex("contentHash", "contentHash", { unique: false });
              if (name === "conversationArtifacts" && !store.indexNames.contains("sourceMessageId")) store.createIndex("sourceMessageId", "sourceMessageId", { unique: false });
              if (name === "conversationApprovalTransactions" && !store.indexNames.contains("idempotencyScope")) store.createIndex("idempotencyScope", "idempotencyScope", { unique: true });
              if (name === "learningImportSessions" && !store.indexNames.contains("importSessionId")) store.createIndex("importSessionId", "importSessionId", { unique: true });
            }
          } catch (error) {
            try { open.transaction?.abort(); } catch { /* the upgrade transaction already stopped */ }
            fail(error, "INDEXEDDB_OPEN_FAILED");
          }
        };
        open.onsuccess = () => {
          const db = open.result;
          if (settled) {
            db.close();
            return;
          }
          const missingStores = REQUIRED_STORES.filter((name) => !db.objectStoreNames.contains(name));
          if (missingStores.length > 0) {
            db.close();
            fail(new IndexedDbRepositoryError("INDEXEDDB_SCHEMA_MISMATCH"), "INDEXEDDB_SCHEMA_MISMATCH");
            return;
          }
          settled = true;
          db.onversionchange = () => {
            db.close();
            this.dbPromise = null;
          };
          resolve(db);
        };
        open.onerror = () => fail(open.error, "INDEXEDDB_OPEN_FAILED");
        open.onblocked = () => fail(new IndexedDbRepositoryError("INDEXEDDB_UPGRADE_BLOCKED"), "INDEXEDDB_UPGRADE_BLOCKED");
      });
      const retryable = pending.catch((error) => {
        this.dbPromise = null;
        throw asIndexedDbRepositoryError(error, "INDEXEDDB_OPEN_FAILED");
      });
      this.dbPromise = retryable;
    }
    return this.dbPromise;
  }
  async get<T extends DomainRecord>(store: NovelStoreName, id: string) { const db = await this.open(); return (await request(db.transaction(store).objectStore(store).get(id)) as T | undefined) ?? null; }
  async list<T extends DomainRecord>(store: NovelStoreName, projectId?: string) { const db = await this.open(), objectStore = db.transaction(store).objectStore(store); return await request((projectId ? objectStore.index("projectId").getAll(projectId) : objectStore.getAll()) as IDBRequest<T[]>); }
  async put<T extends DomainRecord>(store: NovelStoreName, record: T, expectedRevision?: number) {
    await assertConversationRecordSafe(store, record);
    const db = await this.open(), tx = db.transaction(store, "readwrite"), objectStore = tx.objectStore(store), current = await request(objectStore.get(record.id)) as T | undefined;
    if (expectedRevision !== undefined && (current?.revision ?? 0) !== expectedRevision) { tx.abort(); throw new RevisionConflictError(expectedRevision, current?.revision ?? 0); }
    const next = { ...record, revision: current ? current.revision + 1 : record.revision, updatedAt: new Date().toISOString(), parentRevision: current?.revision ?? null } as T;
    objectStore.put(next); await complete(tx);
    notifyCloudSyncMutation(next.projectId, `put:${store}`);
    return next;
  }
  async remove(store: NovelStoreName, id: string) {
    const db = await this.open(), tx = db.transaction(store, "readwrite"), objectStore = tx.objectStore(store);
    const current = await request(objectStore.get(id)) as DomainRecord | undefined;
    objectStore.delete(id);
    await complete(tx);
    if (current?.projectId) notifyCloudSyncMutation(current.projectId, `remove:${store}`);
  }
  async createProject(bundle: ProjectBundle, requestId: string) {
    const db = await this.open(), names = ["projects","projectSeeds","storyBibles","characters","relationships","worlds","worldRules","lore","storyStates","tasks","readerStates","backups",REQUEST_STORE] as string[], tx = db.transaction(names, "readwrite"), ledger = tx.objectStore(REQUEST_STORE);
    const replay = await request(ledger.get(requestId)) as { requestId: string; bundle: ProjectBundle } | undefined;
    if (replay) { tx.abort(); return replay.bundle; }
    if (await request(tx.objectStore("projects").get(bundle.project.id))) { tx.abort(); throw new Error("PROJECT_ALREADY_EXISTS"); }
    const writes: Array<[string, DomainRecord | null]> = [
      ["projects", bundle.project],
      ["projectSeeds", bundle.seed],
      ["storyBibles", bundle.storyBible],
      ["characters", bundle.protagonist],
      ...(bundle.cast ?? []).map((record) => ["characters", record] as [string, DomainRecord]),
      ...(bundle.relationships ?? []).map((record) => ["relationships", record] as [string, DomainRecord]),
      ["worlds", bundle.world],
      ...(bundle.worldRules ?? []).map((record) => ["worldRules", record] as [string, DomainRecord]),
      ...(bundle.lore ?? []).map((record) => ["lore", record] as [string, DomainRecord]),
      ["storyStates", bundle.storyState],
      ["tasks", bundle.initialTask],
      ["readerStates", bundle.readerState],
      ["backups", bundle.initialBackup],
    ];
    for (const [store, record] of writes) if (record) tx.objectStore(store).put(record);
    ledger.put({ requestId, projectId: bundle.project.id, bundle, createdAt: new Date().toISOString() });
    await complete(tx);
    notifyCloudSyncMutation(bundle.project.id, "create-project");
    return bundle;
  }
  async acceptChoiceTransaction(input: AcceptChoiceTransactionInput): Promise<AcceptChoiceTransactionResult> {
    if (input.rpgContextRevisionGuard) {
      await assertRpgContextRevisionGuardIntegrity(input.rpgContextRevisionGuard);
    }
    const conversationPayloadFingerprint = input.conversationApproval
      ? await acceptedChoiceConversationApprovalPayloadFingerprint(input)
      : null;
    const conversationPreflightArtifact = input.conversationApproval
      ? await this.get<ConversationArtifact>(
          "conversationArtifacts",
          input.conversationApproval.artifactId,
        )
      : null;
    const conversationCandidateRawDigest = conversationPreflightArtifact
      ? await sha256Hex(conversationPreflightArtifact.candidateContent)
      : undefined;
    let prepared: {
      records: ReturnType<typeof buildAcceptedChoiceRecords>;
      conversation: NonNullable<Awaited<ReturnType<typeof prepareAcceptedChoiceConversationApproval>>>;
      session: ConversationSession;
      sourceMessage: ConversationMessage;
      artifact: ConversationArtifact;
      candidateRawContentDigest: string;
    } | null = null;
    if (input.conversationApproval) {
      const preflightReplay = await this.get<IdempotencyRecord>("idempotencyRecords", input.idempotencyKey);
      if (!preflightReplay) {
        const [project, chapter, candidate, storyState, storyBibles, parentBranch, session, sourceMessage, artifact] = await Promise.all([
          this.get<NovelProject>("projects", input.projectId),
          this.get<Chapter>("chapters", input.chapterId),
          this.get<ChoiceCandidate>("candidates", input.candidateId),
          this.list<StoryState>("storyStates", input.projectId).then((rows) => rows[0] ?? null),
          this.list<StoryBible>("storyBibles", input.projectId),
          input.parentBranchId ? this.get<StoryBranch>("storyBranches", input.parentBranchId) : Promise.resolve(null),
          this.get<ConversationSession>("conversationSessions", input.conversationApproval.sessionId),
          this.get<ConversationMessage>("conversationMessages", input.conversationApproval.sourceMessageId),
          this.get<ConversationArtifact>("conversationArtifacts", input.conversationApproval.artifactId),
        ]);
        const storyBible = resolveProjectStoryBible(project, storyBibles);
        if (!project || !chapter || !candidate || !storyState || !storyBible || !session || !sourceMessage || !artifact) {
          throw new RepositoryOperationError("ACCEPT_CHOICE_RECORD_MISSING");
        }
        const records = buildAcceptedChoiceRecords(input, {
          project,
          chapter,
          candidate,
          storyState,
          storyBible,
          parentBranch,
        });
        const linkedIds = new Set(sourceMessage.toolInvocationIds);
        const toolInvocations = (await this.list<ConversationToolInvocation>(
          "conversationToolInvocations",
          input.projectId,
        )).filter((invocation) =>
          linkedIds.has(invocation.id)
          && invocation.messageId === sourceMessage.id
          && invocation.sessionId === sourceMessage.sessionId);
        const conversation = await prepareAcceptedChoiceConversationApproval({
          request: input,
          currentChapter: chapter,
          approvedChapter: records.chapter,
          session,
          sourceMessage,
          artifact,
          toolInvocations,
        });
        if (!conversation) throw new RepositoryOperationError("RPG_CONVERSATION_APPROVAL_MISSING");
        prepared = {
          records,
          conversation,
          session,
          sourceMessage,
          artifact,
          candidateRawContentDigest: conversationCandidateRawDigest
            ?? await sha256Hex(artifact.candidateContent),
        };
      }
    }
    const db = await this.open();
    const stores = [...new Set<NovelStoreName>([
      "projects", "chapters", "candidates", "storyStates", "acceptedChoices",
      "storyBranches", "storyBibles", "storyBibleDeltas", "approvalTransactions",
      "idempotencyRecords", "operationJournal", "rpgTurnReceipts",
      ...(input.rpgContextRevisionGuard
        ? [...RPG_CONTEXT_REVISION_STORE_NAMES] as NovelStoreName[]
        : []),
      ...(input.conversationApproval
        ? ["conversationSessions", "conversationMessages", "conversationToolInvocations", "conversationArtifacts", "conversationSummaries", "conversationApprovalTransactions"] as NovelStoreName[]
        : []),
    ])];
    const tx = db.transaction(stores, "readwrite");
    const get = async <T>(store: NovelStoreName, id: string) => await request(tx.objectStore(store).get(id)) as T | undefined;
    const getToolInvocations = async (message: ConversationMessage) => {
      const linkedIds = new Set(message.toolInvocationIds);
      return (await request(
        tx.objectStore("conversationToolInvocations").index("messageId").getAll(message.id),
      ) as ConversationToolInvocation[]).filter((invocation) => linkedIds.has(invocation.id));
    };
    try {
      const replay = await request(tx.objectStore("idempotencyRecords").index("idempotencyKey").get(input.idempotencyKey)) as IdempotencyRecord | undefined;
      if (replay) {
        if (replay.projectId !== input.projectId || replay.payloadFingerprint !== acceptChoicePayloadFingerprint(input)) throw new RepositoryOperationError("IDEMPOTENCY_PAYLOAD_MISMATCH");
        const [project, chapter, candidate, storyState, acceptedChoice, branch, storyBibles, storyBibleDelta, approvalTransaction] = await Promise.all([
          get<NovelProject>("projects", input.projectId), get<Chapter>("chapters", input.chapterId), get<ChoiceCandidate>("candidates", input.candidateId),
          request(tx.objectStore("storyStates").index("projectId").get(input.projectId)) as Promise<StoryState | undefined>,
          get<AcceptedChoice>("acceptedChoices", replay.acceptedChoiceId), get<StoryBranch>("storyBranches", replay.branchId),
          request(tx.objectStore("storyBibles").index("projectId").getAll(input.projectId)) as Promise<StoryBible[]>,
          get<StoryBibleDelta>("storyBibleDeltas", replay.storyBibleDeltaId), get<ApprovalTransaction>("approvalTransactions", replay.transactionId),
        ]);
        const storyBible = resolveProjectStoryBible(project, storyBibles);
        if (!project || !chapter || !candidate || !storyState || !acceptedChoice || !branch || !storyBible || !storyBibleDelta || !approvalTransaction) throw new RepositoryOperationError("IDEMPOTENCY_REPLAY_INCOMPLETE");
        let conversationArtifact: ConversationArtifact | undefined;
        let conversationApprovalTransaction: ConversationApprovalTransaction | undefined;
        const rpgTurnReceipt = replay.rpgTurnReceiptId
          ? await get<RpgTurnReceipt>("rpgTurnReceipts", replay.rpgTurnReceiptId)
          : undefined;
        if (replay.rpgTurnReceiptId && !rpgTurnReceipt) {
          throw new RepositoryOperationError("RPG_TURN_RECEIPT_REPLAY_INCOMPLETE");
        }
        if (input.conversationApproval) {
          conversationApprovalTransaction = await request(
            tx.objectStore("conversationApprovalTransactions").index("idempotencyScope")
              .get(`${input.projectId}:${input.conversationApproval.idempotencyKey}`),
          ) as ConversationApprovalTransaction | undefined;
          if (!conversationApprovalTransaction || !conversationPayloadFingerprint) {
            throw new RepositoryOperationError("RPG_CONVERSATION_APPROVAL_REPLAY_INCOMPLETE");
          }
          assertAcceptedChoiceConversationApprovalReplay(input, conversationApprovalTransaction, conversationPayloadFingerprint);
          const [session, sourceMessage, artifact] = await Promise.all([
            get<ConversationSession>("conversationSessions", input.conversationApproval.sessionId),
            get<ConversationMessage>("conversationMessages", input.conversationApproval.sourceMessageId),
            get<ConversationArtifact>("conversationArtifacts", input.conversationApproval.artifactId),
          ]);
          if (
            !session
            || !sourceMessage
            || !artifact
            || session.projectId !== input.projectId
            || sourceMessage.projectId !== input.projectId
            || sourceMessage.sessionId !== session.id
            || artifact.projectId !== input.projectId
            || artifact.sessionId !== session.id
            || artifact.status !== "approved"
            || artifact.candidateDigest !== input.conversationApproval.candidateDigest
          ) {
            throw new RepositoryOperationError("RPG_CONVERSATION_APPROVAL_REPLAY_INCOMPLETE");
          }
          assertConversationApprovalExecutionTruth(
            sourceMessage,
            artifact,
            await getToolInvocations(sourceMessage),
            conversationCandidateRawDigest,
          );
          conversationArtifact = artifact;
        }
        await complete(tx);
        return {
          replayed: true,
          project,
          chapter,
          candidate,
          storyState,
          acceptedChoice,
          branch,
          storyBible,
          storyBibleDelta,
          approvalTransaction,
          idempotencyRecord: replay,
          rpgTurnReceipt,
          conversationArtifact,
          conversationApprovalTransaction,
        };
      }
      const [project, chapter, candidate, storyState, storyBibles, parentBranch] = await Promise.all([
        get<NovelProject>("projects", input.projectId), get<Chapter>("chapters", input.chapterId), get<ChoiceCandidate>("candidates", input.candidateId),
        request(tx.objectStore("storyStates").index("projectId").get(input.projectId)) as Promise<StoryState | undefined>,
        request(tx.objectStore("storyBibles").index("projectId").getAll(input.projectId)) as Promise<StoryBible[]>,
        input.parentBranchId ? get<StoryBranch>("storyBranches", input.parentBranchId) : Promise.resolve(undefined),
      ]);
      const storyBible = resolveProjectStoryBible(project, storyBibles);
      if (!project || !chapter || !candidate || !storyState || !storyBible) throw new RepositoryOperationError("ACCEPT_CHOICE_RECORD_MISSING");
      if (input.rpgContextRevisionGuard) {
        const contextRows = await Promise.all(RPG_CONTEXT_REVISION_STORE_NAMES.map(async (store) => (
          [
            store,
            await request(tx.objectStore(store).index("projectId").getAll(input.projectId)) as DomainRecord[],
          ] as const
        )));
        assertRpgContextRevisionGuard(
          input.rpgContextRevisionGuard,
          Object.fromEntries(contextRows) as unknown as RpgContextRevisionRecords,
        );
      }
      let records: ReturnType<typeof buildAcceptedChoiceRecords>;
      let conversationRecords: NonNullable<Awaited<ReturnType<typeof prepareAcceptedChoiceConversationApproval>>> | null = null;
      if (input.conversationApproval) {
        if (!prepared) throw new RepositoryOperationError("RPG_CONVERSATION_APPROVAL_PREFLIGHT_MISSING");
        assertAcceptChoiceInput(input, { project, chapter, candidate, storyState, storyBible, parentBranch: parentBranch ?? null });
        const [session, sourceMessage, artifact, existingConversationApproval] = await Promise.all([
          get<ConversationSession>("conversationSessions", input.conversationApproval.sessionId),
          get<ConversationMessage>("conversationMessages", input.conversationApproval.sourceMessageId),
          get<ConversationArtifact>("conversationArtifacts", input.conversationApproval.artifactId),
          request(
            tx.objectStore("conversationApprovalTransactions").index("idempotencyScope")
              .get(`${input.projectId}:${input.conversationApproval.idempotencyKey}`),
          ) as Promise<ConversationApprovalTransaction | undefined>,
        ]);
        if (existingConversationApproval) throw new RepositoryOperationError("RPG_CONVERSATION_APPROVAL_ALREADY_EXISTS");
        if (
          !session
          || !sourceMessage
          || !artifact
          || session.revision !== prepared.session.revision
          || sourceMessage.revision !== prepared.sourceMessage.revision
          || artifact.revision !== prepared.artifact.revision
          || artifact.candidateContent !== prepared.artifact.candidateContent
        ) {
          throw new RepositoryOperationError("CONVERSATION_APPROVAL_SOURCE_STALE");
        }
        const toolInvocations = await getToolInvocations(sourceMessage);
        assertConversationApprovalSource(
          prepared.conversation.request,
          {
            session,
            sourceMessage,
            artifact,
            canonicalRecord: chapter,
            toolInvocations,
            candidateRawContentDigest: prepared.candidateRawContentDigest,
          },
          prepared.artifact.candidateDigest,
          prepared.conversation.request.expectedSourceRevision,
        );
        records = prepared.records;
        conversationRecords = prepared.conversation;
      } else {
        records = buildAcceptedChoiceRecords(input, { project, chapter, candidate, storyState, storyBible, parentBranch: parentBranch ?? null });
      }
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
      if (records.rpgTurnReceipt) {
        this.inject("before:rpgTurnReceipts");
        tx.objectStore("rpgTurnReceipts").put(records.rpgTurnReceipt);
        this.inject("after:rpgTurnReceipts");
      }
      if (conversationRecords) {
        this.inject("before:conversationArtifacts");
        tx.objectStore("conversationArtifacts").put(conversationRecords.artifact);
        this.inject("after:conversationArtifacts");
        this.inject("before:conversationApprovalTransactions");
        tx.objectStore("conversationApprovalTransactions").put(conversationRecords.approvalTransaction);
        this.inject("after:conversationApprovalTransactions");
        this.inject("before:conversationSummaryInvalidation");
        const summaryStore = tx.objectStore("conversationSummaries");
        const summaries = await request(summaryStore.index("projectId").getAll(input.projectId)) as ConversationSummary[];
        for (const summary of summaries) {
          if (summary.invalidatedAt) continue;
          summaryStore.put({
            ...summary,
            invalidatedAt: conversationRecords.approvalTransaction.approvedAt,
            parentRevision: summary.revision,
            revision: summary.revision + 1,
            updatedAt: conversationRecords.approvalTransaction.approvedAt,
          });
          const summarySession = await get<ConversationSession>("conversationSessions", summary.sessionId);
          if (summarySession?.summaryDigest === summary.contentDigest) {
            tx.objectStore("conversationSessions").put({
              ...summarySession,
              summaryDigest: null,
              parentRevision: summarySession.revision,
              revision: summarySession.revision + 1,
              updatedAt: conversationRecords.approvalTransaction.approvedAt,
            });
          }
        }
        this.inject("after:conversationSummaryInvalidation");
      }
      await complete(tx);
      notifyCloudSyncMutation(input.projectId, "accept-choice");
      return {
        replayed: false,
        project: records.project,
        chapter: records.chapter,
        candidate: records.candidate,
        storyState: records.storyState,
        acceptedChoice: records.acceptedChoice,
        branch: records.branch,
        storyBible: records.storyBible,
        storyBibleDelta: records.storyBibleDelta,
        approvalTransaction: records.approvalTransaction,
        idempotencyRecord: records.idempotencyRecord,
        rpgTurnReceipt: records.rpgTurnReceipt,
        conversationArtifact: conversationRecords?.artifact,
        conversationApprovalTransaction: conversationRecords?.approvalTransaction,
      };
    } catch (error) {
      try { tx.abort(); } catch { /* transaction already completed */ }
      throw error;
    }
  }
  async commitStudioCandidateTransaction(input: CommitStudioCandidateTransactionInput): Promise<CommitStudioCandidateTransactionResult> {
    const db = await this.open();
    const tx = db.transaction(["chapters", "operationJournal"], "readwrite");
    try {
      const journalStore = tx.objectStore("operationJournal");
      const replay = await request(
        journalStore.index("idempotencyKey").get(input.idempotencyKey),
      ) as StudioCandidateOperationJournal | undefined;
      if (replay) {
        assertStudioCandidateReplay(input, replay);
        const chapter = await request(
          tx.objectStore("chapters").get(replay.chapterId),
        ) as Chapter | undefined;
        if (!chapter || chapter.revision < replay.resultingRevision) {
          throw new RepositoryOperationError("STUDIO_CANDIDATE_IDEMPOTENCY_REPLAY_INCOMPLETE");
        }
        await complete(tx);
        return { replayed: true, chapter, journal: replay };
      }
      const current = await request(
        tx.objectStore("chapters").get(input.chapterId),
      ) as Chapter | undefined;
      if (!current) {
        throw new RepositoryOperationError("STUDIO_CANDIDATE_SOURCE_CHAPTER_NOT_FOUND");
      }
      const records = buildStudioCandidateCommitRecords(input, current);
      this.inject("before:studioCandidateChapter");
      tx.objectStore("chapters").put(records.chapter);
      this.inject("after:studioCandidateChapter");
      this.inject("before:studioCandidateJournal");
      journalStore.put(records.journal);
      this.inject("after:studioCandidateJournal");
      await complete(tx);
      notifyCloudSyncMutation(input.projectId, "commit-studio-candidate");
      return { replayed: false, ...records };
    } catch (error) {
      try { tx.abort(); } catch { /* transaction already completed */ }
      throw error;
    }
  }
  private async runConversationApprovalTransaction(
    input: ConversationArtifactApprovalInput,
  ): Promise<ApproveConversationArtifactTransactionResult> {
    const payloadFingerprint = await conversationApprovalPayloadFingerprint(input);
    const [
      preflightSession,
      preflightSourceMessage,
      preflightArtifact,
      preflightCanonical,
      preflightProjectInvocations,
    ] = await Promise.all([
      this.get<ConversationSession>("conversationSessions", input.sessionId),
      this.get<ConversationMessage>("conversationMessages", input.sourceMessageId),
      this.get<ConversationArtifact>("conversationArtifacts", input.artifactId),
      this.get<DomainRecord>(input.targetStore as NovelStoreName, input.targetRecordId),
      this.list<ConversationToolInvocation>("conversationToolInvocations", input.projectId),
    ]);
    const preflightLinkedInvocationIds = new Set(
      preflightSourceMessage?.toolInvocationIds ?? [],
    );
    const preflightToolInvocations = preflightProjectInvocations
      .filter((invocation) => (
        invocation.messageId === input.sourceMessageId
        && preflightLinkedInvocationIds.has(invocation.id)
      ))
      .sort((left, right) => left.id.localeCompare(right.id));
    const preflightSourceMessageContentDigest = preflightSourceMessage
      ? await conversationContentDigest(preflightSourceMessage.content)
      : null;
    if (
      preflightSourceMessage
      && preflightSourceMessageContentDigest !== preflightSourceMessage.contentDigest
    ) {
      throw new RepositoryOperationError("CONVERSATION_APPROVAL_SOURCE_STALE");
    }
    const candidateContentDigest = preflightArtifact
      ? await conversationContentDigest(preflightArtifact.candidateContent)
      : "";
    const candidateRawContentDigest = preflightArtifact
      ? await sha256Hex(preflightArtifact.candidateContent)
      : undefined;
    const preflightCanonicalDigest = preflightCanonical
      ? await conversationCanonicalRecordDigest(preflightCanonical)
      : null;
    const db = await this.open();
    const stores = [...new Set<NovelStoreName>([
      "conversationSessions",
      "conversationMessages",
      "conversationToolInvocations",
      "conversationArtifacts",
      "conversationSummaries",
      "conversationApprovalTransactions",
      input.targetStore as NovelStoreName,
    ])];
    const tx = db.transaction(stores, "readwrite");
    try {
      const approvalStore = tx.objectStore("conversationApprovalTransactions");
      const idempotencyScope = `${input.projectId}:${input.idempotencyKey}`;
      const replay = await request(approvalStore.index("idempotencyScope").get(idempotencyScope)) as ConversationApprovalTransaction | undefined;
      if (replay) {
        assertConversationApprovalReplay(input, payloadFingerprint, replay);
        const [session, sourceMessage, artifact, canonicalRecord] = await Promise.all([
          request(tx.objectStore("conversationSessions").get(replay.sessionId)) as Promise<ConversationSession | undefined>,
          request(tx.objectStore("conversationMessages").get(replay.sourceMessageId)) as Promise<ConversationMessage | undefined>,
          request(tx.objectStore("conversationArtifacts").get(replay.artifactId)) as Promise<ConversationArtifact | undefined>,
          request(tx.objectStore(replay.targetStore).get(replay.targetRecordId)) as Promise<DomainRecord | undefined>,
        ]);
        if (
          !session
          || !sourceMessage
          || !artifact
          || !canonicalRecord
          || !preflightSession
          || !preflightSourceMessage
          || !preflightArtifact
          || stableStringify(session) !== stableStringify(preflightSession)
          || stableStringify(sourceMessage) !== stableStringify(preflightSourceMessage)
          || stableStringify(artifact) !== stableStringify(preflightArtifact)
          || stableStringify(canonicalRecord) !== stableStringify(preflightCanonical ?? null)
          || artifact.status !== "approved"
          || canonicalRecord.revision < replay.resultingRevision
        ) {
          throw new RepositoryOperationError("CONVERSATION_IDEMPOTENCY_REPLAY_INCOMPLETE");
        }
        const linkedIds = new Set(sourceMessage.toolInvocationIds);
        const toolInvocations = (await request(
          tx.objectStore("conversationToolInvocations").index("messageId").getAll(sourceMessage.id),
        ) as ConversationToolInvocation[])
          .filter((invocation) => linkedIds.has(invocation.id))
          .sort((left, right) => left.id.localeCompare(right.id));
        if (stableStringify(toolInvocations) !== stableStringify(preflightToolInvocations)) {
          throw new RepositoryOperationError("CONVERSATION_APPROVAL_SOURCE_STALE");
        }
        assertConversationApprovalExecutionTruth(
          sourceMessage,
          artifact,
          toolInvocations,
          candidateRawContentDigest,
        );
        await complete(tx);
        return { replayed: true, session, sourceMessage, artifact, canonicalRecord, approvalTransaction: replay };
      }
      const [session, sourceMessage, artifact, canonicalRecord] = await Promise.all([
        request(tx.objectStore("conversationSessions").get(input.sessionId)) as Promise<ConversationSession | undefined>,
        request(tx.objectStore("conversationMessages").get(input.sourceMessageId)) as Promise<ConversationMessage | undefined>,
        request(tx.objectStore("conversationArtifacts").get(input.artifactId)) as Promise<ConversationArtifact | undefined>,
        request(tx.objectStore(input.targetStore).get(input.targetRecordId)) as Promise<DomainRecord | undefined>,
      ]);
      const external = "commitId" in input;
      if (
        !preflightSession
        || !preflightSourceMessage
        || !preflightArtifact
        || stableStringify(session ?? null) !== stableStringify(preflightSession)
        || stableStringify(sourceMessage ?? null) !== stableStringify(preflightSourceMessage)
        || stableStringify(artifact ?? null) !== stableStringify(preflightArtifact)
        || stableStringify(canonicalRecord ?? null) !== stableStringify(preflightCanonical ?? null)
      ) {
        throw new RepositoryOperationError("CONVERSATION_APPROVAL_SOURCE_STALE");
      }
      const linkedIds = new Set(sourceMessage?.toolInvocationIds ?? []);
      const toolInvocations = sourceMessage
        ? (await request(
            tx.objectStore("conversationToolInvocations").index("messageId").getAll(sourceMessage.id),
          ) as ConversationToolInvocation[])
            .filter((invocation) => linkedIds.has(invocation.id))
            .sort((left, right) => left.id.localeCompare(right.id))
        : [];
      if (stableStringify(toolInvocations) !== stableStringify(preflightToolInvocations)) {
        throw new RepositoryOperationError("CONVERSATION_APPROVAL_SOURCE_STALE");
      }
      assertConversationApprovalSource(
        input,
        {
          session,
          sourceMessage,
          artifact,
          canonicalRecord,
          toolInvocations,
          candidateRawContentDigest,
        },
        candidateContentDigest,
        external ? input.resultingRevision : input.expectedSourceRevision,
      );
      let approvedCanonicalRecord: DomainRecord;
      if (external) {
        if (
          !canonicalRecord
          || input.resultingRevision !== input.expectedSourceRevision + 1
          || preflightCanonical?.revision !== canonicalRecord.revision
          || preflightCanonicalDigest !== input.canonicalRecordDigest
          || !input.commitId.trim()
        ) {
          throw new RepositoryOperationError("CONVERSATION_EXTERNAL_COMMIT_INVALID");
        }
        approvedCanonicalRecord = canonicalRecord;
      } else {
        approvedCanonicalRecord = buildNextConversationCanonicalRecord(input, canonicalRecord ?? null, artifact!);
      }
      const records = buildConversationApprovalRecords({
        request: input,
        artifact: artifact!,
        canonicalRecord: approvedCanonicalRecord,
        payloadFingerprint,
        commitMode: external ? "external_canonical" : "atomic_canonical",
        applicationMode: external ? "external_commit" : input.applicationMode,
        externalCommitId: external ? input.commitId : null,
      });
      if (!external) {
        this.inject(`before:${input.targetStore}`);
        tx.objectStore(input.targetStore).put(approvedCanonicalRecord);
        this.inject(`after:${input.targetStore}`);
      }
      this.inject("before:conversationArtifacts");
      tx.objectStore("conversationArtifacts").put(records.artifact);
      this.inject("after:conversationArtifacts");
      this.inject("before:conversationApprovalTransactions");
      approvalStore.put(records.approvalTransaction);
      this.inject("after:conversationApprovalTransactions");
      this.inject("before:conversationSummaryInvalidation");
      const summaryStore = tx.objectStore("conversationSummaries");
      const summaries = await request(summaryStore.index("projectId").getAll(input.projectId)) as ConversationSummary[];
      for (const summary of summaries) {
        if (summary.invalidatedAt) continue;
        summaryStore.put({
          ...summary,
          invalidatedAt: records.approvalTransaction.approvedAt,
          parentRevision: summary.revision,
          revision: summary.revision + 1,
          updatedAt: records.approvalTransaction.approvedAt,
        });
        const summarySession = await request(tx.objectStore("conversationSessions").get(summary.sessionId)) as ConversationSession | undefined;
        if (summarySession?.summaryDigest === summary.contentDigest) {
          tx.objectStore("conversationSessions").put({
            ...summarySession,
            summaryDigest: null,
            parentRevision: summarySession.revision,
            revision: summarySession.revision + 1,
            updatedAt: records.approvalTransaction.approvedAt,
          });
        }
      }
      this.inject("after:conversationSummaryInvalidation");
      const approvedSession = await request(tx.objectStore("conversationSessions").get(input.sessionId)) as ConversationSession | undefined;
      await complete(tx);
      notifyCloudSyncMutation(input.projectId, external
        ? "approve-conversation-artifact-external"
        : "approve-conversation-artifact");
      return {
        replayed: false,
        session: approvedSession ?? session!,
        sourceMessage: sourceMessage!,
        artifact: records.artifact,
        canonicalRecord: approvedCanonicalRecord,
        approvalTransaction: records.approvalTransaction,
      };
    } catch (error) {
      try { tx.abort(); } catch { /* transaction already completed */ }
      throw error;
    }
  }
  approveConversationArtifactTransaction(
    input: ApproveConversationArtifactTransactionInput,
  ): Promise<ApproveConversationArtifactTransactionResult> {
    return this.runConversationApprovalTransaction(input);
  }
  markConversationArtifactApprovedFromExternalCommit(
    input: MarkConversationArtifactApprovedFromExternalCommitInput,
  ): Promise<ApproveConversationArtifactTransactionResult> {
    return this.runConversationApprovalTransaction(input);
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
      notifyCloudSyncMutation(input.project.projectId, "save-drama-projection");
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
      const sourceStoryBible = resolveProjectStoryBible(sourceProject, sourceStoryBibles);
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
      notifyCloudSyncMutation(input.projectId, "approve-drama-projection");
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
      if (staleProjects.length || staleLinks.length) {
        notifyCloudSyncMutation(input.projectId, "mark-drama-projection-stale");
      }
      return {
        staleDramaProjectIds: staleProjects.map((row) => row.dramaProjectId),
        staleCanonLinkIds: staleLinks.map((row) => row.canonLinkId),
      };
    } catch (error) {
      try { tx.abort(); } catch { /* transaction already completed */ }
      throw error;
    }
  }
  approveCharacterProposalTransaction(input: ApproveCharacterProposalInput): Promise<ApproveCharacterProposalResult> {
    const run = this.characterInteractionQueue.then(() => this.approveCharacterProposalTransactionInternal(input));
    this.characterInteractionQueue = run.catch(() => undefined);
    return run;
  }
  private async approveCharacterProposalTransactionInternal(input: ApproveCharacterProposalInput): Promise<ApproveCharacterProposalResult> {
    const idempotencyScope = `${input.projectId}:${input.idempotencyKey}`;
    const existingApproval = (await this.list<CharacterAgentApprovalRecord>("characterAgentApprovals", input.projectId))
      .find((record) => record.idempotencyScope === idempotencyScope);
    if (existingApproval) {
      if (existingApproval.proposalId !== input.proposalId || existingApproval.payloadFingerprint !== input.payloadFingerprint) {
        throw new RepositoryOperationError("CHARACTER_IDEMPOTENCY_PAYLOAD_MISMATCH");
      }
      const proposal = await this.get<CharacterProposalEnvelope>("characterProposals", existingApproval.proposalId);
      if (!proposal) throw new RepositoryOperationError("CHARACTER_IDEMPOTENCY_REPLAY_INCOMPLETE");
      const canonicalStore: NovelStoreName = proposal.canonicalPatch.entityType === "character"
        ? "characters"
        : proposal.canonicalPatch.entityType === "relationship"
          ? "relationships"
          : "dramaScenes";
      const canonicalRecord = await this.get<DomainRecord>(canonicalStore, existingApproval.canonicalEntityId);
      if (!canonicalRecord || canonicalRecord.revision !== existingApproval.resultingCanonicalRevision) throw new RepositoryOperationError("CHARACTER_IDEMPOTENCY_REPLAY_INCOMPLETE");
      return { replayed: true, proposal, approval: existingApproval, canonicalRecord };
    }
    const proposal = await this.get<CharacterProposalEnvelope>("characterProposals", input.proposalId);
    if (!proposal) throw new RepositoryOperationError("CHARACTER_PROPOSAL_NOT_FOUND");
    const canonicalStore: NovelStoreName = proposal.canonicalPatch.entityType === "character"
      ? "characters"
      : proposal.canonicalPatch.entityType === "relationship"
        ? "relationships"
        : "dramaScenes";
    const [evaluation, canonicalRecord] = await Promise.all([
      this.get<CharacterAgentEvaluation>("characterAgentEvaluations", proposal.evaluationId),
      this.get<DomainRecord>(canonicalStore, proposal.canonicalPatch.entityId),
    ]);
    if (!evaluation || !canonicalRecord) throw new RepositoryOperationError("CHARACTER_APPROVAL_SOURCE_MISSING");
    const records = await buildCharacterApprovalRecords({ request: input, proposal, evaluation, canonicalRecord });
    const stores = [...new Set<NovelStoreName>([
      "projects", "storyBibles", "characters", canonicalStore, "characterProposals",
      "characterAgentEvaluations", "characterAgentApprovals", "characterAgentAudit",
      "characterAgentStates", "characterMemories", "characterRelationships",
      "characterRelationshipEvents", "characterKnowledge", "characterPrivateArcs",
    ])];
    const db = await this.open();
    const tx = db.transaction(stores, "readwrite");
    try {
      const approvalStore = tx.objectStore("characterAgentApprovals");
      const replay = await request(approvalStore.index("idempotencyScope").get(idempotencyScope)) as CharacterAgentApprovalRecord | undefined;
      if (replay) {
        if (replay.proposalId !== input.proposalId || replay.payloadFingerprint !== input.payloadFingerprint) {
          throw new RepositoryOperationError("CHARACTER_IDEMPOTENCY_PAYLOAD_MISMATCH");
        }
        const replayProposal = await request(tx.objectStore("characterProposals").get(replay.proposalId)) as CharacterProposalEnvelope | undefined;
        const replayCanonical = await request(tx.objectStore(canonicalStore).get(replay.canonicalEntityId)) as DomainRecord | undefined;
        if (!replayProposal || !replayCanonical || replayCanonical.revision !== replay.resultingCanonicalRevision) {
          throw new RepositoryOperationError("CHARACTER_IDEMPOTENCY_REPLAY_INCOMPLETE");
        }
        await complete(tx);
        return { replayed: true, proposal: replayProposal, approval: replay, canonicalRecord: replayCanonical };
      }
      const [currentProposal, currentProject, storyBibles, currentCanonical, currentEvaluation] = await Promise.all([
        request(tx.objectStore("characterProposals").get(input.proposalId)) as Promise<CharacterProposalEnvelope | undefined>,
        request(tx.objectStore("projects").get(input.projectId)) as Promise<NovelProject | undefined>,
        request(tx.objectStore("storyBibles").index("projectId").getAll(input.projectId)) as Promise<StoryBible[]>,
        request(tx.objectStore(canonicalStore).get(proposal.canonicalPatch.entityId)) as Promise<DomainRecord | undefined>,
        request(tx.objectStore("characterAgentEvaluations").get(proposal.evaluationId)) as Promise<CharacterAgentEvaluation | undefined>,
      ]);
      const currentStoryBible = resolveProjectStoryBible(currentProject, storyBibles);
      if (
        !currentProposal
        || currentProposal.status !== proposal.status
        || currentProposal.revision !== proposal.revision
        || !currentProject
        || currentProject.revision !== input.expectedSourceRevision
        || !currentStoryBible
        || currentStoryBible.revision !== input.expectedSourceStoryBibleVersion
        || !currentCanonical
        || currentCanonical.revision !== canonicalRecord.revision
        || !currentEvaluation
        || currentEvaluation.blockingIssueCount > 0
      ) throw new RepositoryOperationError("CHARACTER_APPROVAL_SOURCE_STALE");
      for (const [characterId, revision] of Object.entries(proposal.sourceCharacterRevisions)) {
        const character = await request(tx.objectStore("characters").get(characterId)) as DomainRecord | undefined;
        if (!character || character.projectId !== input.projectId || character.revision !== revision) {
          throw new RepositoryOperationError("CHARACTER_APPROVAL_CHARACTER_STALE");
        }
      }
      const relationshipEvent = records.effects.relationshipEvent;
      if (relationshipEvent) {
        const [duplicateByKey, duplicateBySource, currentEdge] = await Promise.all([
          request(tx.objectStore("characterRelationshipEvents").index("idempotencyScope").get(relationshipEvent.idempotencyScope)),
          request(tx.objectStore("characterRelationshipEvents").index("sourceEventScope").get(relationshipEvent.sourceEventScope)),
          request(tx.objectStore("characterRelationships").get(relationshipEvent.relationshipId)) as Promise<DomainRecord | undefined>,
        ]);
        if (duplicateByKey || duplicateBySource) throw new RepositoryOperationError("DUPLICATE_RELATIONSHIP_EVENT");
        if (!currentEdge || currentEdge.revision !== relationshipEvent.beforeRevision) throw new RepositoryOperationError("STALE_RELATIONSHIP_REVISION");
      }
      const writes: Array<[NovelStoreName, DomainRecord]> = [
        ["characterProposals", records.proposal],
        ["characterAgentApprovals", records.approval],
        [canonicalStore, records.canonicalRecord],
        ...(records.effects.stateUpdate ? [["characterAgentStates", records.effects.stateUpdate] as [NovelStoreName, DomainRecord]] : []),
        ...records.effects.approvedMemories.map((row) => ["characterMemories", row] as [NovelStoreName, DomainRecord]),
        ...(records.effects.relationshipEdge ? [["characterRelationships", records.effects.relationshipEdge] as [NovelStoreName, DomainRecord]] : []),
        ...(records.effects.relationshipEvent ? [["characterRelationshipEvents", records.effects.relationshipEvent] as [NovelStoreName, DomainRecord]] : []),
        ...(records.effects.knowledgeAcquisition ? [["characterKnowledge", records.effects.knowledgeAcquisition] as [NovelStoreName, DomainRecord]] : []),
        ...(records.effects.privateArcPromotion ? [["characterPrivateArcs", records.effects.privateArcPromotion] as [NovelStoreName, DomainRecord]] : []),
        ["characterAgentAudit", records.audit],
      ];
      for (const [store, row] of writes) {
        if (row.projectId !== input.projectId) throw new RepositoryOperationError("CHARACTER_APPROVAL_PROJECT_SCOPE_MISMATCH");
        this.inject(`before:${store}`);
        tx.objectStore(store).put(row);
        this.inject(`after:${store}`);
      }
      await complete(tx);
      notifyCloudSyncMutation(input.projectId, "approve-character-proposal");
      return { replayed: false, proposal: records.proposal, approval: records.approval, canonicalRecord: records.canonicalRecord };
    } catch (error) {
      try { tx.abort(); } catch { /* transaction already completed */ }
      throw error;
    }
  }
  rejectCharacterProposalTransaction(input: RejectCharacterProposalInput): Promise<RejectCharacterProposalResult> {
    const run = this.characterInteractionQueue.then(() => this.rejectCharacterProposalTransactionInternal(input));
    this.characterInteractionQueue = run.catch(() => undefined);
    return run;
  }
  private async rejectCharacterProposalTransactionInternal(input: RejectCharacterProposalInput): Promise<RejectCharacterProposalResult> {
    const proposal = await this.get<CharacterProposalEnvelope>("characterProposals", input.proposalId);
    if (!proposal) throw new RepositoryOperationError("CHARACTER_PROPOSAL_NOT_FOUND");
    const records = buildCharacterRejectionRecords({ request: input, proposal });
    const db = await this.open();
    const tx = db.transaction(["characterProposals", "characterAgentAudit"], "readwrite");
    try {
      const current = await request(tx.objectStore("characterProposals").get(input.proposalId)) as CharacterProposalEnvelope | undefined;
      if (!current || current.revision !== proposal.revision || current.status !== proposal.status) {
        throw new RepositoryOperationError("CHARACTER_PROPOSAL_REJECTION_STALE");
      }
      this.inject("before:characterProposals");
      tx.objectStore("characterProposals").put(records.proposal);
      this.inject("after:characterProposals");
      this.inject("before:characterAgentAudit");
      tx.objectStore("characterAgentAudit").put(records.audit);
      this.inject("after:characterAgentAudit");
      await complete(tx);
      notifyCloudSyncMutation(input.projectId, "reject-character-proposal");
      return records;
    } catch (error) {
      try { tx.abort(); } catch { /* transaction already completed */ }
      throw error;
    }
  }
  async listAcceptedChoices(projectId: string, chapterId?: string) { return (await this.list<AcceptedChoice>("acceptedChoices", projectId)).filter((item) => !chapterId || item.chapterId === chapterId); }
  async listStoryBranches(projectId: string, chapterId?: string) { return (await this.list<StoryBranch>("storyBranches", projectId)).filter((item) => !chapterId || item.chapterId === chapterId); }
  async deleteInteractionsByProject(projectId: string) {
    const db = await this.open(), stores: NovelStoreName[] = ["acceptedChoices","storyBranches","storyBibleDeltas","approvalTransactions","idempotencyRecords","operationJournal","rpgTurnReceipts"], tx = db.transaction(stores, "readwrite");
    for (const store of stores) { const objectStore = tx.objectStore(store), keys = await request(objectStore.index("projectId").getAllKeys(projectId)); for (const key of keys) objectStore.delete(key); }
    await complete(tx);
    notifyCloudSyncMutation(projectId, "delete-project-interactions");
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
    await complete(tx);
    notifyCloudSyncMutation(nextProjectId, mode === "replace" ? "restore-cloud-snapshot" : "copy-cloud-snapshot");
    return nextProjectId;
  }
}

export function indexedDbCapability() { return { supported: typeof indexedDB !== "undefined", database: DB_NAME, version: DB_VERSION, stores: [...NOVEL_STORES] }; }

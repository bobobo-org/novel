import type { AcceptedChoice, ApprovalTransaction, Chapter, ChoiceCandidate, ConversationApprovalTransaction, ConversationArtifact, ConversationMessage, ConversationSession, ConversationSummary, ConversationToolInvocation, DomainRecord, IdempotencyRecord, NovelProject, ProjectBundle, RpgTurnReceipt, StoryBible, StoryBibleDelta, StoryBranch, StoryState } from "../../domain/index";
import { sha256Hex } from "../../closed-ai-cache";
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
import { acceptChoicePayloadFingerprint, buildAcceptedChoiceRecords } from "../../services/accept-choice";
import { NOVEL_STORES, RepositoryOperationError, RevisionConflictError, type AcceptChoiceTransactionInput, type AcceptChoiceTransactionResult, type ApproveConversationArtifactTransactionInput, type ApproveConversationArtifactTransactionResult, type CommitStudioCandidateTransactionInput, type CommitStudioCandidateTransactionResult, type MarkConversationArtifactApprovedFromExternalCommitInput, type NovelRepository, type NovelStoreName, type StudioCandidateOperationJournal } from "../contracts/index";
import { assertCompleteReplacePayload, buildImportIdMap, remapImportedRecord, validateImportRecords } from "../import-remap";
import { assertStudioCandidateReplay, buildStudioCandidateCommitRecords } from "../studio-candidate-transaction";
import {
  assertAcceptedChoiceConversationApprovalReplay,
  assertConversationApprovalExecutionTruth,
  assertConversationApprovalReplay,
  assertConversationApprovalSource,
  buildConversationApprovalRecords,
  buildNextConversationCanonicalRecord,
  acceptedChoiceConversationApprovalPayloadFingerprint,
  prepareAcceptedChoiceConversationApproval,
  conversationApprovalPayloadFingerprint,
  conversationCanonicalRecordDigest,
  conversationContentDigest,
  type ConversationArtifactApprovalInput,
} from "../../conversation/approval-transaction";
import { assertConversationRecordSafe } from "../../conversation/record-security";

export class MemoryNovelRepository implements NovelRepository {
  readonly kind = "memory" as const;
  private stores = new Map<NovelStoreName, Map<string, DomainRecord>>(NOVEL_STORES.map((name) => [name, new Map()]));
  private requests = new Map<string, ProjectBundle>();
  private interactionQueue: Promise<unknown> = Promise.resolve();
  private readonly approvalFaultInjector: ((point: string) => void) | null;
  constructor(options: { approvalFaultInjector?: (point: string) => void } = {}) {
    this.approvalFaultInjector = options.approvalFaultInjector ?? null;
  }
  private inject(point: string) { this.approvalFaultInjector?.(point); }
  private async conversationToolInvocationsForMessage(
    sourceMessage: ConversationMessage | null,
  ) {
    if (!sourceMessage) return [];
    const linkedIds = new Set(sourceMessage.toolInvocationIds);
    return (await this.list<ConversationToolInvocation>(
      "conversationToolInvocations",
      sourceMessage.projectId,
    )).filter((invocation) =>
      linkedIds.has(invocation.id)
      && invocation.messageId === sourceMessage.id
      && invocation.sessionId === sourceMessage.sessionId);
  }
  private invalidateConversationSummaries(projectId: string, changedAt: string) {
    for (const row of this.stores.get("conversationSummaries")?.values() ?? []) {
      const summary = row as ConversationSummary;
      if (summary.projectId !== projectId || summary.invalidatedAt) continue;
      const invalidated: ConversationSummary = {
        ...summary,
        invalidatedAt: changedAt,
        parentRevision: summary.revision,
        revision: summary.revision + 1,
        updatedAt: changedAt,
      };
      this.stores.get("conversationSummaries")?.set(invalidated.id, structuredClone(invalidated));
      const session = this.stores.get("conversationSessions")?.get(summary.sessionId) as ConversationSession | undefined;
      if (session?.summaryDigest === summary.contentDigest) {
        this.stores.get("conversationSessions")?.set(session.id, structuredClone({
          ...session,
          summaryDigest: null,
          parentRevision: session.revision,
          revision: session.revision + 1,
          updatedAt: changedAt,
        }));
      }
    }
  }
  isAvailable() { return true; }
  async get<T extends DomainRecord>(store: NovelStoreName, id: string) { return (structuredClone(this.stores.get(store)?.get(id)) as T | undefined) ?? null; }
  async list<T extends DomainRecord>(store: NovelStoreName, projectId?: string) { return [...(this.stores.get(store)?.values() ?? [])].filter((item) => !projectId || item.projectId === projectId).map((item) => structuredClone(item) as T); }
  async put<T extends DomainRecord>(store: NovelStoreName, record: T, expectedRevision?: number) {
    await assertConversationRecordSafe(store, record);
    const current = this.stores.get(store)?.get(record.id);
    if (expectedRevision !== undefined && (current?.revision ?? 0) !== expectedRevision) throw new RevisionConflictError(expectedRevision, current?.revision ?? 0);
    const next = { ...record, revision: current ? current.revision + 1 : record.revision, updatedAt: new Date().toISOString(), parentRevision: current?.revision ?? null } as T;
    this.stores.get(store)?.set(next.id, structuredClone(next)); return structuredClone(next);
  }
  async remove(store: NovelStoreName, id: string) { this.stores.get(store)?.delete(id); }
  async createProject(bundle: ProjectBundle, requestId: string) {
    const replay = this.requests.get(requestId); if (replay) return structuredClone(replay);
    if (await this.get("projects", bundle.project.id)) throw new Error("PROJECT_ALREADY_EXISTS");
    const writes: Array<[NovelStoreName, DomainRecord | null]> = [
      ["projects", bundle.project],
      ["projectSeeds", bundle.seed],
      ["storyBibles", bundle.storyBible],
      ["characters", bundle.protagonist],
      ...(bundle.cast ?? []).map((record) => ["characters", record] as [NovelStoreName, DomainRecord]),
      ...(bundle.relationships ?? []).map((record) => ["relationships", record] as [NovelStoreName, DomainRecord]),
      ["worlds", bundle.world],
      ...(bundle.worldRules ?? []).map((record) => ["worldRules", record] as [NovelStoreName, DomainRecord]),
      ...(bundle.lore ?? []).map((record) => ["lore", record] as [NovelStoreName, DomainRecord]),
      ["storyStates", bundle.storyState],
      ["tasks", bundle.initialTask],
      ["readerStates", bundle.readerState],
      ["backups", bundle.initialBackup],
    ];
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
      let conversationArtifact: ConversationArtifact | undefined;
      let conversationApprovalTransaction: ConversationApprovalTransaction | undefined;
      const rpgTurnReceipt = replay.rpgTurnReceiptId
        ? await this.get<RpgTurnReceipt>("rpgTurnReceipts", replay.rpgTurnReceiptId)
        : undefined;
      if (replay.rpgTurnReceiptId && !rpgTurnReceipt) {
        throw new RepositoryOperationError("RPG_TURN_RECEIPT_REPLAY_INCOMPLETE");
      }
      if (input.conversationApproval) {
        conversationApprovalTransaction = (await this.list<ConversationApprovalTransaction>("conversationApprovalTransactions", input.projectId))
          .find((record) => record.idempotencyScope === `${input.projectId}:${input.conversationApproval!.idempotencyKey}`);
        if (!conversationApprovalTransaction) {
          throw new RepositoryOperationError("RPG_CONVERSATION_APPROVAL_REPLAY_INCOMPLETE");
        }
        const conversationPayloadFingerprint = await acceptedChoiceConversationApprovalPayloadFingerprint(input);
        assertAcceptedChoiceConversationApprovalReplay(input, conversationApprovalTransaction, conversationPayloadFingerprint);
        const [session, sourceMessage, artifact] = await Promise.all([
          this.get<ConversationSession>("conversationSessions", input.conversationApproval.sessionId),
          this.get<ConversationMessage>("conversationMessages", input.conversationApproval.sourceMessageId),
          this.get<ConversationArtifact>("conversationArtifacts", input.conversationApproval.artifactId),
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
          await this.conversationToolInvocationsForMessage(sourceMessage),
          await sha256Hex(artifact.candidateContent),
        );
        conversationArtifact = artifact;
      }
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
        rpgTurnReceipt: rpgTurnReceipt ?? undefined,
        conversationArtifact,
        conversationApprovalTransaction,
      };
    }
    const project = await this.get<NovelProject>("projects", input.projectId), chapter = await this.get<Chapter>("chapters", input.chapterId), candidate = await this.get<ChoiceCandidate>("candidates", input.candidateId), storyState = (await this.list<StoryState>("storyStates", input.projectId))[0] ?? null, storyBible = (await this.list<StoryBible>("storyBibles", input.projectId))[0] ?? null, parentBranch = input.parentBranchId ? await this.get<StoryBranch>("storyBranches", input.parentBranchId) : null;
    if (!project || !chapter || !candidate || !storyState || !storyBible) throw new RepositoryOperationError("ACCEPT_CHOICE_RECORD_MISSING");
    const records = buildAcceptedChoiceRecords(input, { project, chapter, candidate, storyState, storyBible, parentBranch });
    let conversationRecords: Awaited<ReturnType<typeof prepareAcceptedChoiceConversationApproval>> = null;
    if (input.conversationApproval) {
      const existingApproval = (await this.list<ConversationApprovalTransaction>("conversationApprovalTransactions", input.projectId))
        .find((record) => record.idempotencyScope === `${input.projectId}:${input.conversationApproval!.idempotencyKey}`);
      if (existingApproval) throw new RepositoryOperationError("RPG_CONVERSATION_APPROVAL_ALREADY_EXISTS");
      const [session, sourceMessage, artifact] = await Promise.all([
        this.get<ConversationSession>("conversationSessions", input.conversationApproval.sessionId),
        this.get<ConversationMessage>("conversationMessages", input.conversationApproval.sourceMessageId),
        this.get<ConversationArtifact>("conversationArtifacts", input.conversationApproval.artifactId),
      ]);
      const toolInvocations = await this.conversationToolInvocationsForMessage(sourceMessage);
      conversationRecords = await prepareAcceptedChoiceConversationApproval({
        request: input,
        currentChapter: chapter,
        approvedChapter: records.chapter,
        session,
        sourceMessage,
        artifact,
        toolInvocations,
      });
    }
    const before = new Map(NOVEL_STORES.map((name) => [name, new Map([...(this.stores.get(name)?.entries() ?? [])].map(([id, row]) => [id, structuredClone(row)]))]));
    try {
      for (const [store, row] of [["projects",records.project],["chapters",records.chapter],["candidates",records.candidate],["storyStates",records.storyState],["acceptedChoices",records.acceptedChoice],["storyBranches",records.branch],["storyBibles",records.storyBible],["storyBibleDeltas",records.storyBibleDelta],["approvalTransactions",records.approvalTransaction],["idempotencyRecords",records.idempotencyRecord],["operationJournal",records.journal]] as Array<[NovelStoreName, DomainRecord]>) this.stores.get(store)?.set(row.id, structuredClone(row));
      if (records.rpgTurnReceipt) {
        this.inject("before:rpgTurnReceipts");
        this.stores.get("rpgTurnReceipts")?.set(records.rpgTurnReceipt.id, structuredClone(records.rpgTurnReceipt));
        this.inject("after:rpgTurnReceipts");
      }
      if (conversationRecords) {
        this.inject("before:conversationArtifacts");
        this.stores.get("conversationArtifacts")?.set(conversationRecords.artifact.id, structuredClone(conversationRecords.artifact));
        this.inject("after:conversationArtifacts");
        this.inject("before:conversationApprovalTransactions");
        this.stores.get("conversationApprovalTransactions")?.set(conversationRecords.approvalTransaction.id, structuredClone(conversationRecords.approvalTransaction));
        this.inject("after:conversationApprovalTransactions");
        this.inject("before:conversationSummaryInvalidation");
        this.invalidateConversationSummaries(input.projectId, conversationRecords.approvalTransaction.approvedAt);
        this.inject("after:conversationSummaryInvalidation");
      }
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
    } catch (error) { this.stores = before; throw error; }
  }
  commitStudioCandidateTransaction(input: CommitStudioCandidateTransactionInput): Promise<CommitStudioCandidateTransactionResult> {
    const run = this.interactionQueue.then(() =>
      this.commitStudioCandidateTransactionInternal(input));
    this.interactionQueue = run.catch(() => undefined);
    return run;
  }
  private async commitStudioCandidateTransactionInternal(input: CommitStudioCandidateTransactionInput): Promise<CommitStudioCandidateTransactionResult> {
    const replay = (await this.list<StudioCandidateOperationJournal>("operationJournal", input.projectId))
      .find((record) => record.idempotencyKey === input.idempotencyKey);
    if (replay) {
      assertStudioCandidateReplay(input, replay);
      const chapter = await this.get<Chapter>("chapters", replay.chapterId);
      if (!chapter || chapter.revision < replay.resultingRevision) {
        throw new RepositoryOperationError("STUDIO_CANDIDATE_IDEMPOTENCY_REPLAY_INCOMPLETE");
      }
      return { replayed: true, chapter, journal: replay };
    }
    const current = await this.get<Chapter>("chapters", input.chapterId);
    if (!current) {
      throw new RepositoryOperationError("STUDIO_CANDIDATE_SOURCE_CHAPTER_NOT_FOUND");
    }
    const records = buildStudioCandidateCommitRecords(input, current);
    const beforeChapters = new Map(
      [...(this.stores.get("chapters")?.entries() ?? [])]
        .map(([id, row]) => [id, structuredClone(row)]),
    );
    const beforeJournal = new Map(
      [...(this.stores.get("operationJournal")?.entries() ?? [])]
        .map(([id, row]) => [id, structuredClone(row)]),
    );
    try {
      this.inject("before:studioCandidateChapter");
      this.stores.get("chapters")?.set(records.chapter.id, structuredClone(records.chapter));
      this.inject("after:studioCandidateChapter");
      this.inject("before:studioCandidateJournal");
      this.stores.get("operationJournal")?.set(records.journal.id, structuredClone(records.journal));
      this.inject("after:studioCandidateJournal");
      return { replayed: false, ...records };
    } catch (error) {
      this.stores.set("chapters", beforeChapters);
      this.stores.set("operationJournal", beforeJournal);
      throw error;
    }
  }
  approveConversationArtifactTransaction(input: ApproveConversationArtifactTransactionInput): Promise<ApproveConversationArtifactTransactionResult> {
    const run = this.interactionQueue.then(() => this.approveConversationArtifactTransactionInternal(input));
    this.interactionQueue = run.catch(() => undefined);
    return run;
  }
  private async conversationApprovalReplay(
    input: ConversationArtifactApprovalInput,
    payloadFingerprint: string,
  ): Promise<ApproveConversationArtifactTransactionResult | null> {
    const idempotencyScope = `${input.projectId}:${input.idempotencyKey}`;
    const replay = (await this.list<ConversationApprovalTransaction>("conversationApprovalTransactions", input.projectId))
      .find((record) => record.idempotencyScope === idempotencyScope);
    if (!replay) return null;
    assertConversationApprovalReplay(input, payloadFingerprint, replay);
    const [session, sourceMessage, artifact, canonicalRecord] = await Promise.all([
      this.get<ConversationSession>("conversationSessions", replay.sessionId),
      this.get<ConversationMessage>("conversationMessages", replay.sourceMessageId),
      this.get<ConversationArtifact>("conversationArtifacts", replay.artifactId),
      this.get<DomainRecord>(replay.targetStore as NovelStoreName, replay.targetRecordId),
    ]);
    if (
      !session
      || !sourceMessage
      || !artifact
      || !canonicalRecord
      || artifact.status !== "approved"
      || canonicalRecord.revision < replay.resultingRevision
    ) {
      throw new RepositoryOperationError("CONVERSATION_IDEMPOTENCY_REPLAY_INCOMPLETE");
    }
    assertConversationApprovalExecutionTruth(
      sourceMessage,
      artifact,
      await this.conversationToolInvocationsForMessage(sourceMessage),
      await sha256Hex(artifact.candidateContent),
    );
    return { replayed: true, session, sourceMessage, artifact, canonicalRecord, approvalTransaction: replay };
  }
  private async approveConversationArtifactTransactionInternal(
    input: ApproveConversationArtifactTransactionInput,
  ): Promise<ApproveConversationArtifactTransactionResult> {
    const payloadFingerprint = await conversationApprovalPayloadFingerprint(input);
    const replay = await this.conversationApprovalReplay(input, payloadFingerprint);
    if (replay) return replay;
    const [session, sourceMessage, artifact, canonicalRecord] = await Promise.all([
      this.get<ConversationSession>("conversationSessions", input.sessionId),
      this.get<ConversationMessage>("conversationMessages", input.sourceMessageId),
      this.get<ConversationArtifact>("conversationArtifacts", input.artifactId),
      this.get<DomainRecord>(input.targetStore as NovelStoreName, input.targetRecordId),
    ]);
    const candidateContentDigest = artifact
      ? await conversationContentDigest(artifact.candidateContent)
      : "";
    const toolInvocations = await this.conversationToolInvocationsForMessage(sourceMessage);
    assertConversationApprovalSource(
      input,
      {
        session,
        sourceMessage,
        artifact,
        canonicalRecord,
        toolInvocations,
        candidateRawContentDigest: artifact
          ? await sha256Hex(artifact.candidateContent)
          : undefined,
      },
      candidateContentDigest,
    );
    const nextCanonicalRecord = buildNextConversationCanonicalRecord(input, canonicalRecord, artifact!);
    const records = buildConversationApprovalRecords({
      request: input,
      artifact: artifact!,
      canonicalRecord: nextCanonicalRecord,
      payloadFingerprint,
      commitMode: "atomic_canonical",
      applicationMode: input.applicationMode,
      externalCommitId: null,
    });
    const before = new Map(NOVEL_STORES.map((name) => [
      name,
      new Map([...(this.stores.get(name)?.entries() ?? [])]
        .map(([id, row]) => [id, structuredClone(row)])),
    ]));
    try {
      this.inject(`before:${input.targetStore}`);
      this.stores.get(input.targetStore as NovelStoreName)?.set(nextCanonicalRecord.id, structuredClone(nextCanonicalRecord));
      this.inject(`after:${input.targetStore}`);
      this.inject("before:conversationArtifacts");
      this.stores.get("conversationArtifacts")?.set(records.artifact.id, structuredClone(records.artifact));
      this.inject("after:conversationArtifacts");
      this.inject("before:conversationApprovalTransactions");
      this.stores.get("conversationApprovalTransactions")?.set(records.approvalTransaction.id, structuredClone(records.approvalTransaction));
      this.inject("after:conversationApprovalTransactions");
      this.inject("before:conversationSummaryInvalidation");
      this.invalidateConversationSummaries(input.projectId, records.approvalTransaction.approvedAt);
      this.inject("after:conversationSummaryInvalidation");
      const approvedSession = this.stores.get("conversationSessions")?.get(input.sessionId) as ConversationSession | undefined;
      return {
        replayed: false,
        session: approvedSession ?? session!,
        sourceMessage: sourceMessage!,
        artifact: records.artifact,
        canonicalRecord: nextCanonicalRecord,
        approvalTransaction: records.approvalTransaction,
      };
    } catch (error) {
      this.stores = before;
      throw error;
    }
  }
  markConversationArtifactApprovedFromExternalCommit(
    input: MarkConversationArtifactApprovedFromExternalCommitInput,
  ): Promise<ApproveConversationArtifactTransactionResult> {
    const run = this.interactionQueue.then(() => this.markConversationArtifactApprovedFromExternalCommitInternal(input));
    this.interactionQueue = run.catch(() => undefined);
    return run;
  }
  private async markConversationArtifactApprovedFromExternalCommitInternal(
    input: MarkConversationArtifactApprovedFromExternalCommitInput,
  ): Promise<ApproveConversationArtifactTransactionResult> {
    const payloadFingerprint = await conversationApprovalPayloadFingerprint(input);
    const replay = await this.conversationApprovalReplay(input, payloadFingerprint);
    if (replay) return replay;
    const [session, sourceMessage, artifact, canonicalRecord] = await Promise.all([
      this.get<ConversationSession>("conversationSessions", input.sessionId),
      this.get<ConversationMessage>("conversationMessages", input.sourceMessageId),
      this.get<ConversationArtifact>("conversationArtifacts", input.artifactId),
      this.get<DomainRecord>(input.targetStore as NovelStoreName, input.targetRecordId),
    ]);
    const candidateContentDigest = artifact
      ? await conversationContentDigest(artifact.candidateContent)
      : "";
    const toolInvocations = await this.conversationToolInvocationsForMessage(sourceMessage);
    assertConversationApprovalSource(
      input,
      {
        session,
        sourceMessage,
        artifact,
        canonicalRecord,
        toolInvocations,
        candidateRawContentDigest: artifact
          ? await sha256Hex(artifact.candidateContent)
          : undefined,
      },
      candidateContentDigest,
      input.resultingRevision,
    );
    if (
      !canonicalRecord
      || input.resultingRevision !== input.expectedSourceRevision + 1
      || await conversationCanonicalRecordDigest(canonicalRecord) !== input.canonicalRecordDigest
      || !input.commitId.trim()
    ) {
      throw new RepositoryOperationError("CONVERSATION_EXTERNAL_COMMIT_INVALID");
    }
    const records = buildConversationApprovalRecords({
      request: input,
      artifact: artifact!,
      canonicalRecord,
      payloadFingerprint,
      commitMode: "external_canonical",
      applicationMode: "external_commit",
      externalCommitId: input.commitId,
    });
    const before = new Map(NOVEL_STORES.map((name) => [
      name,
      new Map([...(this.stores.get(name)?.entries() ?? [])]
        .map(([id, row]) => [id, structuredClone(row)])),
    ]));
    try {
      this.inject("before:conversationArtifacts");
      this.stores.get("conversationArtifacts")?.set(records.artifact.id, structuredClone(records.artifact));
      this.inject("after:conversationArtifacts");
      this.inject("before:conversationApprovalTransactions");
      this.stores.get("conversationApprovalTransactions")?.set(records.approvalTransaction.id, structuredClone(records.approvalTransaction));
      this.inject("after:conversationApprovalTransactions");
      this.inject("before:conversationSummaryInvalidation");
      this.invalidateConversationSummaries(input.projectId, records.approvalTransaction.approvedAt);
      this.inject("after:conversationSummaryInvalidation");
      const approvedSession = this.stores.get("conversationSessions")?.get(input.sessionId) as ConversationSession | undefined;
      return {
        replayed: false,
        session: approvedSession ?? session!,
        sourceMessage: sourceMessage!,
        artifact: records.artifact,
        canonicalRecord,
        approvalTransaction: records.approvalTransaction,
      };
    } catch (error) {
      this.stores = before;
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
  approveCharacterProposalTransaction(input: ApproveCharacterProposalInput): Promise<ApproveCharacterProposalResult> {
    const run = this.interactionQueue.then(() => this.approveCharacterProposalTransactionInternal(input));
    this.interactionQueue = run.catch(() => undefined);
    return run;
  }
  private async approveCharacterProposalTransactionInternal(input: ApproveCharacterProposalInput): Promise<ApproveCharacterProposalResult> {
    const idempotencyScope = `${input.projectId}:${input.idempotencyKey}`;
    const replay = (await this.list<CharacterAgentApprovalRecord>("characterAgentApprovals", input.projectId))
      .find((record) => record.idempotencyScope === idempotencyScope);
    if (replay) {
      if (replay.proposalId !== input.proposalId || replay.payloadFingerprint !== input.payloadFingerprint) {
        throw new RepositoryOperationError("CHARACTER_IDEMPOTENCY_PAYLOAD_MISMATCH");
      }
      const proposal = await this.get<CharacterProposalEnvelope>("characterProposals", replay.proposalId);
      if (!proposal) throw new RepositoryOperationError("CHARACTER_IDEMPOTENCY_REPLAY_INCOMPLETE");
      const canonicalStore: NovelStoreName = proposal.canonicalPatch.entityType === "character"
        ? "characters"
        : proposal.canonicalPatch.entityType === "relationship"
          ? "relationships"
          : "dramaScenes";
      const canonicalRecord = await this.get<DomainRecord>(canonicalStore, replay.canonicalEntityId);
      if (!canonicalRecord || canonicalRecord.revision !== replay.resultingCanonicalRevision) {
        throw new RepositoryOperationError("CHARACTER_IDEMPOTENCY_REPLAY_INCOMPLETE");
      }
      return { replayed: true, proposal, approval: replay, canonicalRecord };
    }
    const proposal = await this.get<CharacterProposalEnvelope>("characterProposals", input.proposalId);
    if (!proposal) throw new RepositoryOperationError("CHARACTER_PROPOSAL_NOT_FOUND");
    const [evaluation, project, storyBibles] = await Promise.all([
      this.get<CharacterAgentEvaluation>("characterAgentEvaluations", proposal.evaluationId),
      this.get<NovelProject>("projects", input.projectId),
      this.list<StoryBible>("storyBibles", input.projectId),
    ]);
    const storyBible = storyBibles[0] ?? null;
    if (!evaluation || !project || !storyBible) throw new RepositoryOperationError("CHARACTER_APPROVAL_SOURCE_MISSING");
    if (project.revision !== input.expectedSourceRevision || storyBible.revision !== input.expectedSourceStoryBibleVersion) {
      throw new RepositoryOperationError("CHARACTER_APPROVAL_SOURCE_STALE");
    }
    for (const [characterId, revision] of Object.entries(proposal.sourceCharacterRevisions)) {
      const character = await this.get<DomainRecord>("characters", characterId);
      if (!character || character.projectId !== input.projectId || character.revision !== revision) {
        throw new RepositoryOperationError("CHARACTER_APPROVAL_CHARACTER_STALE");
      }
    }
    const canonicalStore: NovelStoreName = proposal.canonicalPatch.entityType === "character"
      ? "characters"
      : proposal.canonicalPatch.entityType === "relationship"
        ? "relationships"
        : "dramaScenes";
    const canonicalRecord = await this.get<DomainRecord>(canonicalStore, proposal.canonicalPatch.entityId);
    if (!canonicalRecord) throw new RepositoryOperationError("CHARACTER_CANONICAL_TARGET_MISSING");
    const records = await buildCharacterApprovalRecords({ request: input, proposal, evaluation, canonicalRecord });
    const relationshipEvent = records.effects.relationshipEvent;
    if (relationshipEvent) {
      const duplicate = (await this.list("characterRelationshipEvents", input.projectId)).find((row) => {
        const event = row as DomainRecord & { idempotencyScope?: string; sourceEventScope?: string };
        return event.idempotencyScope === relationshipEvent.idempotencyScope || event.sourceEventScope === relationshipEvent.sourceEventScope;
      });
      if (duplicate) throw new RepositoryOperationError("DUPLICATE_RELATIONSHIP_EVENT");
      const currentEdge = await this.get<DomainRecord>("characterRelationships", relationshipEvent.relationshipId);
      if (!currentEdge || currentEdge.revision !== relationshipEvent.beforeRevision) throw new RepositoryOperationError("STALE_RELATIONSHIP_REVISION");
    }
    const before = new Map(NOVEL_STORES.map((name) => [name, new Map([...(this.stores.get(name)?.entries() ?? [])].map(([id, row]) => [id, structuredClone(row)]))]));
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
    try {
      for (const [store, row] of writes) {
        if (row.projectId !== input.projectId) throw new RepositoryOperationError("CHARACTER_APPROVAL_PROJECT_SCOPE_MISMATCH");
        this.inject(`before:${store}`);
        this.stores.get(store)?.set(row.id, structuredClone(row));
        this.inject(`after:${store}`);
      }
      return { replayed: false, proposal: records.proposal, approval: records.approval, canonicalRecord: records.canonicalRecord };
    } catch (error) {
      this.stores = before;
      throw error;
    }
  }
  rejectCharacterProposalTransaction(input: RejectCharacterProposalInput): Promise<RejectCharacterProposalResult> {
    const run = this.interactionQueue.then(() => this.rejectCharacterProposalTransactionInternal(input));
    this.interactionQueue = run.catch(() => undefined);
    return run;
  }
  private async rejectCharacterProposalTransactionInternal(input: RejectCharacterProposalInput): Promise<RejectCharacterProposalResult> {
    const proposal = await this.get<CharacterProposalEnvelope>("characterProposals", input.proposalId);
    if (!proposal) throw new RepositoryOperationError("CHARACTER_PROPOSAL_NOT_FOUND");
    const records = buildCharacterRejectionRecords({ request: input, proposal });
    const beforeProposals = new Map([...(this.stores.get("characterProposals")?.entries() ?? [])].map(([id, row]) => [id, structuredClone(row)]));
    const beforeAudit = new Map([...(this.stores.get("characterAgentAudit")?.entries() ?? [])].map(([id, row]) => [id, structuredClone(row)]));
    try {
      this.inject("before:characterProposals");
      this.stores.get("characterProposals")?.set(records.proposal.id, structuredClone(records.proposal));
      this.inject("after:characterProposals");
      this.inject("before:characterAgentAudit");
      this.stores.get("characterAgentAudit")?.set(records.audit.id, structuredClone(records.audit));
      this.inject("after:characterAgentAudit");
      return records;
    } catch (error) {
      this.stores.set("characterProposals", beforeProposals);
      this.stores.set("characterAgentAudit", beforeAudit);
      throw error;
    }
  }
  async listAcceptedChoices(projectId: string, chapterId?: string) { return (await this.list<AcceptedChoice>("acceptedChoices", projectId)).filter((item) => !chapterId || item.chapterId === chapterId); }
  async listStoryBranches(projectId: string, chapterId?: string) { return (await this.list<StoryBranch>("storyBranches", projectId)).filter((item) => !chapterId || item.chapterId === chapterId); }
  async deleteInteractionsByProject(projectId: string) { for (const store of ["acceptedChoices","storyBranches","storyBibleDeltas","approvalTransactions","idempotencyRecords","operationJournal","rpgTurnReceipts"] as NovelStoreName[]) for (const row of await this.list(store, projectId)) await this.remove(store, row.id); }
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

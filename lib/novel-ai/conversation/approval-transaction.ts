import { sha256Hex, stableStringify } from "../closed-ai-cache";
import type {
  Chapter,
  ConversationApprovalTransaction,
  ConversationArtifact,
  ConversationCanonicalTargetStore,
  ConversationClosedAgentApprovalBindingProof,
  ConversationMessage,
  ConversationSession,
  ConversationToolInvocation,
  DomainRecord,
} from "../domain";
import type {
  AcceptChoiceTransactionInput,
  ApproveConversationArtifactTransactionInput,
  MarkConversationArtifactApprovedFromExternalCommitInput,
} from "../repository/contracts";
import { RepositoryOperationError } from "../repository/contracts";
import { hasValidConversationClosedAgentCacheOriginProof } from "./closed-agent-cache-origin-proof";
import { isConversationClosedAgentInvocation } from "./closed-agent-lineage";
import { CONVERSATION_LOCAL_TOOL_IDS } from "./tool-registry";

export type ConversationArtifactApprovalInput =
  | ApproveConversationArtifactTransactionInput
  | MarkConversationArtifactApprovedFromExternalCommitInput;

export const CONVERSATION_CANONICAL_TARGET_STORES = new Set<ConversationCanonicalTargetStore>([
  "chapters",
  "storyBibles",
  "characters",
  "relationships",
  "worldRules",
  "lore",
  "timeline",
  "storyStates",
  "dramaProjects",
  "dramaSeasons",
  "dramaEpisodes",
  "dramaScenes",
  "dramaBeats",
  "learningImportSessions",
]);

export const STORY_WORKSPACE_FORBIDDEN_CANONICAL_TARGET_STORES = new Set<string>([
  "characters",
  "worldRules",
  "storyBibles",
  "relationships",
  "lore",
  "timeline",
  "worlds",
]);

export function isStoryWorkspaceForbiddenCanonicalTarget(targetStore: unknown) {
  return typeof targetStore === "string"
    && STORY_WORKSPACE_FORBIDDEN_CANONICAL_TARGET_STORES.has(targetStore);
}

export function assertStoryWorkspaceConversationApprovalTarget(targetStore: unknown) {
  if (isStoryWorkspaceForbiddenCanonicalTarget(targetStore)) {
    throw new RepositoryOperationError("CONVERSATION_STORY_CANON_MUTATION_FORBIDDEN");
  }
}

export async function conversationContentDigest(content: string) {
  return sha256Hex(content.normalize("NFKC"));
}

export async function conversationCanonicalRecordDigest(record: DomainRecord) {
  return sha256Hex(stableStringify(record));
}

export async function buildAcceptedChoiceConversationApprovalRequest(
  input: AcceptChoiceTransactionInput,
  chapter: DomainRecord,
): Promise<MarkConversationArtifactApprovedFromExternalCommitInput | null> {
  const approval = input.conversationApproval;
  if (!approval) return null;
  if (
    !approval.operationId.trim()
    || !approval.idempotencyKey.trim()
    || !approval.sessionId.trim()
    || !approval.artifactId.trim()
    || !approval.sourceMessageId.trim()
    || !/^[a-f0-9]{64}$/u.test(approval.candidateDigest)
    || !Number.isInteger(approval.expectedSessionRevision)
    || !Number.isInteger(approval.expectedArtifactRevision)
    || !Number.isInteger(approval.expectedSourceMessageRevision)
    || approval.expectedSourceRevision !== input.expectedChapterRevision
    || chapter.id !== input.chapterId
    || chapter.projectId !== input.projectId
    || chapter.revision !== input.expectedChapterRevision + 1
  ) {
    throw new RepositoryOperationError("RPG_CONVERSATION_APPROVAL_CONTRACT_INVALID");
  }
  return {
    ...approval,
    projectId: input.projectId,
    targetStore: "chapters",
    targetRecordId: input.chapterId,
    resultingRevision: chapter.revision,
    canonicalRecordDigest: await conversationCanonicalRecordDigest(chapter),
    commitId: input.operationId,
  };
}

export async function acceptedChoiceConversationApprovalPayloadFingerprint(
  input: AcceptChoiceTransactionInput,
) {
  if (!input.conversationApproval) {
    throw new RepositoryOperationError("RPG_CONVERSATION_APPROVAL_MISSING");
  }
  return sha256Hex(stableStringify({
    operationType: "accept_choice_with_conversation_approval",
    projectId: input.projectId,
    chapterId: input.chapterId,
    candidateId: input.candidateId,
    acceptChoiceOperationId: input.operationId,
    acceptChoiceIdempotencyKey: input.idempotencyKey,
    conversationApproval: input.conversationApproval,
  }));
}

export async function prepareAcceptedChoiceConversationApproval(input: {
  request: AcceptChoiceTransactionInput;
  currentChapter: DomainRecord;
  approvedChapter: DomainRecord;
  session: ConversationSession | null;
  sourceMessage: ConversationMessage | null;
  artifact: ConversationArtifact | null;
  toolInvocations: ConversationToolInvocation[];
}) {
  const request = await buildAcceptedChoiceConversationApprovalRequest(
    input.request,
    input.approvedChapter,
  );
  if (!request) return null;
  if (input.artifact?.artifactType !== "rpg") {
    throw new RepositoryOperationError("RPG_CONVERSATION_ARTIFACT_TYPE_INVALID");
  }
  try {
    const envelope = JSON.parse(input.artifact.candidateContent) as {
      schemaVersion?: string;
      candidate?: {
        story?: string;
        sourceChapterId?: string;
        sourceRevision?: number;
        canonicalMutationCount?: number;
      };
    };
    if (
      envelope.schemaVersion !== "conversation-rpg-candidate-v1"
      || envelope.candidate?.story !== input.request.acceptedText
      || envelope.candidate.sourceChapterId !== input.request.chapterId
      || envelope.candidate.sourceRevision !== input.request.expectedChapterRevision
      || envelope.candidate.canonicalMutationCount !== 0
    ) {
      throw new Error("RPG_CONVERSATION_ARTIFACT_BINDING_INVALID");
    }
  } catch {
    throw new RepositoryOperationError("RPG_CONVERSATION_ARTIFACT_BINDING_INVALID");
  }
  const candidateContentDigest = input.artifact
    ? await conversationContentDigest(input.artifact.candidateContent)
    : "";
  assertConversationApprovalSource(
    request,
    {
      session: input.session,
      sourceMessage: input.sourceMessage,
      artifact: input.artifact,
      canonicalRecord: input.currentChapter,
      toolInvocations: input.toolInvocations,
      candidateRawContentDigest: input.artifact
        ? await sha256Hex(input.artifact.candidateContent)
        : undefined,
    },
    candidateContentDigest,
    request.expectedSourceRevision,
  );
  const payloadFingerprint = await acceptedChoiceConversationApprovalPayloadFingerprint(input.request);
  return {
    request,
    ...buildConversationApprovalRecords({
      request,
      artifact: input.artifact!,
      canonicalRecord: input.approvedChapter,
      payloadFingerprint,
      commitMode: "external_canonical",
      applicationMode: "external_commit",
      externalCommitId: input.request.operationId,
    }),
  };
}

export function assertAcceptedChoiceConversationApprovalReplay(
  input: AcceptChoiceTransactionInput,
  replay: ConversationApprovalTransaction,
  payloadFingerprint: string,
) {
  const approval = input.conversationApproval;
  if (!approval) {
    throw new RepositoryOperationError("RPG_CONVERSATION_APPROVAL_MISSING");
  }
  if (
    replay.projectId !== input.projectId
    || replay.sessionId !== approval.sessionId
    || replay.sourceMessageId !== approval.sourceMessageId
    || replay.artifactId !== approval.artifactId
    || replay.operationId !== approval.operationId
    || replay.idempotencyKey !== approval.idempotencyKey
    || replay.idempotencyScope !== `${input.projectId}:${approval.idempotencyKey}`
    || replay.payloadFingerprint !== payloadFingerprint
    || replay.candidateDigest !== approval.candidateDigest
    || replay.targetStore !== "chapters"
    || replay.targetRecordId !== input.chapterId
    || replay.sourceRevision !== approval.expectedSourceRevision
    || replay.resultingRevision !== input.expectedChapterRevision + 1
    || replay.commitMode !== "external_canonical"
    || replay.applicationMode !== "external_commit"
    || replay.externalCommitId !== input.operationId
    || replay.canonicalMutationCount !== 1
    || replay.status !== "committed"
  ) {
    throw new RepositoryOperationError("RPG_CONVERSATION_APPROVAL_REPLAY_MISMATCH");
  }
}

export async function conversationApprovalPayloadFingerprint(
  input: ConversationArtifactApprovalInput,
) {
  const external = "commitId" in input;
  return sha256Hex(stableStringify({
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey,
    projectId: input.projectId,
    sessionId: input.sessionId,
    artifactId: input.artifactId,
    sourceMessageId: input.sourceMessageId,
    candidateDigest: input.candidateDigest,
    targetStore: input.targetStore,
    targetRecordId: input.targetRecordId,
    expectedSessionRevision: input.expectedSessionRevision,
    expectedArtifactRevision: input.expectedArtifactRevision,
    expectedSourceMessageRevision: input.expectedSourceMessageRevision,
    expectedSourceRevision: input.expectedSourceRevision,
    closedAgentApprovalBinding: input.closedAgentApprovalBinding ?? null,
    commitMode: external ? "external_canonical" : "atomic_canonical",
    applicationMode: external ? "external_commit" : input.applicationMode,
    ...(external
      ? {
          resultingRevision: input.resultingRevision,
          canonicalRecordDigest: input.canonicalRecordDigest,
          commitId: input.commitId,
        }
      : input.applicationMode === "record_replace"
        ? { nextCanonicalRecord: input.nextCanonicalRecord }
        : { chapterApplication: input.applicationMode }),
  }));
}

export function assertConversationApprovalReplay(
  input: ConversationArtifactApprovalInput,
  fingerprint: string,
  replay: ConversationApprovalTransaction,
) {
  const commitMode = "commitId" in input ? "external_canonical" : "atomic_canonical";
  if (
    replay.projectId !== input.projectId
    || replay.sessionId !== input.sessionId
    || replay.artifactId !== input.artifactId
    || replay.sourceMessageId !== input.sourceMessageId
    || replay.candidateDigest !== input.candidateDigest
    || replay.targetStore !== input.targetStore
    || replay.targetRecordId !== input.targetRecordId
    || replay.idempotencyScope !== `${input.projectId}:${input.idempotencyKey}`
    || replay.payloadFingerprint !== fingerprint
    || replay.commitMode !== commitMode
    || replay.applicationMode !== ("commitId" in input ? "external_commit" : input.applicationMode)
  ) {
    throw new RepositoryOperationError("CONVERSATION_IDEMPOTENCY_PAYLOAD_MISMATCH");
  }
}

export function assertConversationApprovalSource(
  input: ConversationArtifactApprovalInput,
  records: {
    session: ConversationSession | null | undefined;
    sourceMessage: ConversationMessage | null | undefined;
    artifact: ConversationArtifact | null | undefined;
    canonicalRecord: DomainRecord | null | undefined;
    toolInvocations: ConversationToolInvocation[];
    candidateRawContentDigest?: string;
  },
  candidateContentDigest: string,
  expectedCanonicalRevision = input.expectedSourceRevision,
) {
  assertStoryWorkspaceConversationApprovalTarget(input.targetStore);
  const { session, sourceMessage, artifact, canonicalRecord } = records;
  if (!session || !sourceMessage || !artifact) {
    throw new RepositoryOperationError("CONVERSATION_APPROVAL_SOURCE_MISSING");
  }
  if (
    session.id !== input.sessionId
    || session.projectId !== input.projectId
    || sourceMessage.projectId !== input.projectId
    || sourceMessage.sessionId !== input.sessionId
    || artifact.projectId !== input.projectId
    || artifact.sessionId !== input.sessionId
  ) {
    throw new RepositoryOperationError("CONVERSATION_APPROVAL_SCOPE_MISMATCH");
  }
  if (session.status === "deleted" || session.deletedAt) {
    throw new RepositoryOperationError("CONVERSATION_SESSION_DELETED");
  }
  if (
    session.revision !== input.expectedSessionRevision
    || sourceMessage.revision !== input.expectedSourceMessageRevision
    || artifact.revision !== input.expectedArtifactRevision
  ) {
    throw new RepositoryOperationError("CONVERSATION_APPROVAL_SOURCE_STALE");
  }
  if (artifact.status !== "candidate") {
    throw new RepositoryOperationError("CONVERSATION_ARTIFACT_ALREADY_DECIDED");
  }
  if (
    artifact.sourceMessageId !== input.sourceMessageId
    || artifact.targetStore !== input.targetStore
    || artifact.targetRecordId !== input.targetRecordId
    || artifact.sourceRevision !== input.expectedSourceRevision
    || artifact.candidateDigest !== input.candidateDigest
    || candidateContentDigest !== artifact.candidateDigest
  ) {
    throw new RepositoryOperationError("CONVERSATION_CANDIDATE_DIGEST_MISMATCH");
  }
  if (!CONVERSATION_CANONICAL_TARGET_STORES.has(input.targetStore)) {
    throw new RepositoryOperationError("CONVERSATION_CANONICAL_TARGET_NOT_ALLOWED");
  }
  const requiredInvocationId = assertConversationClosedAgentApprovalBindingProof(
    input.closedAgentApprovalBinding,
    session,
    sourceMessage,
    artifact,
    records.toolInvocations,
    records.candidateRawContentDigest,
  );
  assertConversationApprovalExecutionTruth(
    sourceMessage,
    artifact,
    records.toolInvocations,
    records.candidateRawContentDigest,
    requiredInvocationId,
  );
  const currentRevision = canonicalRecord?.revision ?? 0;
  if (currentRevision !== expectedCanonicalRevision) {
    throw new RepositoryOperationError("CONVERSATION_CANONICAL_REVISION_STALE");
  }
  if (canonicalRecord && (
    canonicalRecord.id !== input.targetRecordId
    || canonicalRecord.projectId !== input.projectId
  )) {
    throw new RepositoryOperationError("CONVERSATION_CANONICAL_SCOPE_MISMATCH");
  }
}

function assertConversationClosedAgentApprovalBindingProof(
  proof: ConversationClosedAgentApprovalBindingProof | undefined,
  session: ConversationSession,
  sourceMessage: ConversationMessage,
  artifact: ConversationArtifact,
  toolInvocations: ConversationToolInvocation[],
  candidateRawContentDigest?: string,
) {
  const linked = toolInvocations.filter((invocation) => (
    sourceMessage.toolInvocationIds.includes(invocation.id)
    && invocation.messageId === sourceMessage.id
  ));
  const closedCandidateIds = sourceMessage.candidateIds.filter((candidateId) => (
    candidateId.startsWith("closed-agent-candidate:")
  ));
  const suspiciousClosedInvocations = linked.filter(isConversationClosedAgentInvocation);
  const closedPlanInvocations = linked.filter((invocation) => (
    invocation.toolId === CONVERSATION_LOCAL_TOOL_IDS.closedAgentPlan
  ));
  const hasClosedLineage = closedCandidateIds.length > 0 || suspiciousClosedInvocations.length > 0;
  if (!hasClosedLineage) {
    if (proof !== undefined) {
      throw new RepositoryOperationError("CONVERSATION_CLOSED_APPROVAL_BINDING_UNEXPECTED");
    }
    return null;
  }
  const localEditInvocations = linked.filter((invocation) => (
    invocation.toolId === CONVERSATION_LOCAL_TOOL_IDS.localUserEdit
  ));
  const localEdit = localEditInvocations.length === 1
    ? localEditInvocations[0]
    : null;
  const localEditReceipt = localEdit?.executionReceipt;
  const localEditVerified = Boolean(
    proof === undefined
    && closedCandidateIds.length === 1
    && closedPlanInvocations.length === 1
    && localEdit
    && localEditReceipt
    && localEdit.status === "completed"
    && localEdit.actualExecutor === "local-user-edit"
    && localEdit.modelId === null
    && localEdit.modelDigest === null
    && localEdit.inputDigest === sourceMessage.contentDigest
    && localEdit.externalRequest === false
    && localEdit.dataLeftDevice === false
    && localEdit.canonicalMutationCount === 0
    && localEditReceipt.providerRunId === localEdit.taskId
    && localEditReceipt.modelId === null
    && localEditReceipt.modelDigest === null
    && localEditReceipt.contextDigest === localEdit.contextDigest
    && localEditReceipt.outputDigest === artifact.candidateDigest
    && localEditReceipt.externalRequest === false
    && localEditReceipt.dataLeftDevice === false
    && localEditReceipt.closedAgentSchemaVersion === undefined
    && localEditReceipt.closedAgentCacheOrigin === undefined
    && artifact.candidateDigest !== sourceMessage.contentDigest
    && sourceMessage.candidateIds.includes(artifact.id),
  );
  if (localEditVerified) return localEdit!.id;
  const invocation = closedPlanInvocations.length === 1
    ? closedPlanInvocations[0]
    : null;
  const receipt = invocation?.executionReceipt;
  const cacheOrigin = receipt?.closedAgentCacheOrigin;
  if (
    !proof
    || proof.schemaVersion !== "conversation-closed-agent-approval-binding-v1"
    || proof.sessionId !== session.id
    || proof.sessionRevision !== session.revision
    || closedCandidateIds.length !== 1
    || closedCandidateIds[0] !== proof.candidateId
    || !sourceMessage.candidateIds.includes(artifact.id)
    || !invocation
    || !receipt
    || invocation.id !== proof.invocationId
    || invocation.revision !== proof.invocationRevision
    || invocation.taskId !== proof.candidateTaskId
    || invocation.modelId !== proof.candidateModelId
    || invocation.modelDigest !== proof.candidateModelDigest
    || invocation.contextDigest !== proof.candidateContextDigest
    || receipt.closedAgentSchemaVersion !== "closed-agent-os-v2"
    || receipt.closedAgentBackendId !== proof.candidateBackendId
    || receipt.modelId !== proof.candidateModelId
    || receipt.modelDigest !== proof.candidateModelDigest
    || receipt.outputDigest !== proof.candidateRawContentDigest
    || receipt.normalizationReceiptId !== proof.normalizationReceiptId
    || receipt.traditionalChineseNormalizerVersion !== proof.normalizerVersion
    || sourceMessage.id !== proof.sourceMessageId
    || sourceMessage.revision !== proof.sourceMessageRevision
    || sourceMessage.contentDigest !== proof.sourceMessageContentDigest
    || artifact.id !== proof.artifactId
    || artifact.revision !== proof.artifactRevision
    || artifact.candidateDigest !== proof.artifactCandidateDigest
    || artifact.targetStore !== proof.targetStore
    || artifact.targetRecordId !== proof.targetRecordId
    || artifact.sourceRevision !== proof.targetSourceRevision
    || candidateRawContentDigest !== proof.candidateRawContentDigest
    || stableStringify(cacheOrigin ?? null) !== stableStringify(proof.cacheOrigin)
  ) {
    throw new RepositoryOperationError("CONVERSATION_CLOSED_APPROVAL_BINDING_INVALID");
  }
  return invocation.id;
}

function artifactOutputDigests(
  artifact: ConversationArtifact,
  candidateRawContentDigest?: string,
) {
  const digests = new Set([artifact.candidateDigest]);
  if (candidateRawContentDigest && /^[a-f0-9]{64}$/u.test(candidateRawContentDigest)) {
    digests.add(candidateRawContentDigest);
  }
  try {
    const parsed = JSON.parse(artifact.candidateContent) as {
      candidate?: { candidateDigest?: unknown };
    };
    if (
      typeof parsed.candidate?.candidateDigest === "string"
      && /^[a-f0-9]{64}$/u.test(parsed.candidate.candidateDigest)
    ) {
      digests.add(parsed.candidate.candidateDigest);
    }
  } catch {
    // Plain-text artifacts bind directly to artifact.candidateDigest.
  }
  return digests;
}

function hasValidApprovalExecutionTruth(
  sourceMessage: ConversationMessage,
  artifact: ConversationArtifact,
  invocation: ConversationToolInvocation,
  candidateRawContentDigest?: string,
) {
  const receipt = invocation.executionReceipt;
  const digestPattern = /^[a-f0-9]{64}$/u;
  const cacheOrigin = receipt?.closedAgentCacheOrigin;
  const verifiedClosedCacheHit = Boolean(
    invocation.actualExecutor === "not_executed"
    && receipt
    && invocation.toolId === CONVERSATION_LOCAL_TOOL_IDS.closedAgentPlan
    && receipt.closedAgentSchemaVersion === "closed-agent-os-v2"
    && receipt.closedAgentBackendId
    && ["browser-ai", "local-ollama", "private-ai-hub"]
      .includes(receipt.closedAgentBackendId)
    && receipt.providerRunId === null
    && receipt.modelId === invocation.modelId
    && receipt.modelDigest === invocation.modelDigest
    && receipt.normalizationReceiptId
    && receipt.traditionalChineseNormalizerVersion
    && hasValidConversationClosedAgentCacheOriginProof(cacheOrigin)
    && cacheOrigin?.originBackendId === receipt.closedAgentBackendId
    && cacheOrigin?.originModelId === receipt.modelId
    && cacheOrigin?.originModelDigest === receipt.modelDigest
    && cacheOrigin?.originContentDigest === receipt.outputDigest
    && cacheOrigin?.originNormalizationReceiptId === receipt.normalizationReceiptId
    && cacheOrigin?.originNormalizerVersion
      === receipt.traditionalChineseNormalizerVersion,
  );
  const verifiedClosedFreshExecution = Boolean(
    invocation.actualExecutor !== "not_executed"
    && receipt
    && invocation.toolId === CONVERSATION_LOCAL_TOOL_IDS.closedAgentPlan
    && receipt.closedAgentSchemaVersion === "closed-agent-os-v2"
    && invocation.actualExecutor === receipt.closedAgentBackendId
    && receipt.providerRunId === invocation.taskId
    && cacheOrigin === undefined,
  );
  if (
    invocation.projectId !== sourceMessage.projectId
    || invocation.sessionId !== sourceMessage.sessionId
    || invocation.messageId !== sourceMessage.id
    || !sourceMessage.toolInvocationIds.includes(invocation.id)
    || invocation.status !== "completed"
    || !invocation.completedAt
    || !invocation.taskId.trim()
    || !invocation.toolId.trim()
    || !invocation.taskType.trim()
    || !invocation.actualExecutor?.trim()
    || (invocation.actualExecutor === "not_executed" && !verifiedClosedCacheHit)
    || (invocation.actualExecutor !== "not_executed" && cacheOrigin !== undefined)
    || (receipt?.closedAgentSchemaVersion === "closed-agent-os-v2"
      && !verifiedClosedCacheHit
      && !verifiedClosedFreshExecution)
    || (
      ["external-ai", "openai", "gemini", "grok", "claude"].includes(invocation.actualExecutor)
      && (!invocation.externalRequest || !invocation.dataLeftDevice)
    )
    || !digestPattern.test(invocation.inputDigest)
    || !digestPattern.test(invocation.contextDigest)
    || !Number.isInteger(invocation.canonicalMutationCount)
    || invocation.canonicalMutationCount !== 0
    || !receipt
    || !receipt.receiptId.trim()
    || receipt.contextDigest !== invocation.contextDigest
    || !digestPattern.test(receipt.contextDigest)
    || !receipt.outputDigest
    || !digestPattern.test(receipt.outputDigest)
    || !artifactOutputDigests(artifact, candidateRawContentDigest).has(receipt.outputDigest)
    || receipt.modelId !== invocation.modelId
    || receipt.modelDigest !== invocation.modelDigest
    || (receipt.modelDigest !== null && !digestPattern.test(receipt.modelDigest))
    || (receipt.providerRunId !== null && !receipt.providerRunId.trim())
    || receipt.externalRequest !== invocation.externalRequest
    || receipt.dataLeftDevice !== invocation.dataLeftDevice
    || (invocation.dataLeftDevice && !invocation.externalRequest)
    || (receipt.latencyMs !== null && (!Number.isFinite(receipt.latencyMs) || receipt.latencyMs < 0))
  ) {
    return false;
  }
  return true;
}

export function assertConversationApprovalExecutionTruth(
  sourceMessage: ConversationMessage,
  artifact: ConversationArtifact,
  toolInvocations: ConversationToolInvocation[],
  candidateRawContentDigest?: string,
  requiredInvocationId?: string | null,
) {
  if (sourceMessage.status !== "completed" || !sourceMessage.completedAt) {
    throw new RepositoryOperationError("CONVERSATION_APPROVAL_SOURCE_MESSAGE_NOT_COMPLETED");
  }
  const linked = toolInvocations.filter((invocation) =>
    sourceMessage.toolInvocationIds.includes(invocation.id)
    && invocation.messageId === sourceMessage.id);
  const completedWithReceipt = linked.filter((invocation) =>
    invocation.status === "completed"
    && invocation.executionReceipt !== null
    && (!requiredInvocationId || invocation.id === requiredInvocationId));
  if (!completedWithReceipt.length) {
    throw new RepositoryOperationError("CONVERSATION_APPROVAL_EXECUTION_RECEIPT_REQUIRED");
  }
  if (!completedWithReceipt.some((invocation) =>
    hasValidApprovalExecutionTruth(
      sourceMessage,
      artifact,
      invocation,
      candidateRawContentDigest,
    ))) {
    throw new RepositoryOperationError("CONVERSATION_APPROVAL_EXECUTION_TRUTH_INVALID");
  }
}

export function buildConversationApprovalRecords(input: {
  request: ConversationArtifactApprovalInput;
  artifact: ConversationArtifact;
  canonicalRecord: DomainRecord;
  payloadFingerprint: string;
  commitMode: "atomic_canonical" | "external_canonical";
  applicationMode: ConversationApprovalTransaction["applicationMode"];
  externalCommitId: string | null;
}) {
  const now = new Date().toISOString();
  const transactionId = crypto.randomUUID();
  const artifact: ConversationArtifact = {
    ...input.artifact,
    status: "approved",
    approvedAt: now,
    approvedRevision: input.canonicalRecord.revision,
    parentRevision: input.artifact.revision,
    revision: input.artifact.revision + 1,
    updatedAt: now,
  };
  const approvalTransaction: ConversationApprovalTransaction = {
    schemaVersion: "novel-domain-v1",
    conversationSchemaVersion: "conversation-approval-transaction-v1",
    id: transactionId,
    transactionId,
    operationId: input.request.operationId,
    idempotencyKey: input.request.idempotencyKey,
    idempotencyScope: `${input.request.projectId}:${input.request.idempotencyKey}`,
    payloadFingerprint: input.payloadFingerprint,
    projectId: input.request.projectId,
    sessionId: input.request.sessionId,
    sourceMessageId: input.request.sourceMessageId,
    artifactId: input.request.artifactId,
    candidateDigest: input.request.candidateDigest,
    targetStore: input.request.targetStore,
    targetRecordId: input.request.targetRecordId,
    sourceRevision: input.request.expectedSourceRevision,
    resultingRevision: input.canonicalRecord.revision,
    actor: "user",
    canonicalMutationCount: 1,
    commitMode: input.commitMode,
    applicationMode: input.applicationMode,
    externalCommitId: input.externalCommitId,
    approvedAt: now,
    status: "committed",
    createdAt: now,
    updatedAt: now,
    revision: 1,
    source: "user",
    provenance: { source: "user", actor: "author", createdAt: now },
    deletedAt: null,
    parentRevision: null,
    migrationVersion: null,
  };
  return { artifact, approvalTransaction };
}

export function buildNextConversationCanonicalRecord(
  input: ApproveConversationArtifactTransactionInput,
  current: DomainRecord | null,
  artifact: ConversationArtifact,
) {
  if (input.applicationMode !== "record_replace") {
    if (input.targetStore !== "chapters" || !current) {
      throw new RepositoryOperationError("CONVERSATION_CHAPTER_APPLICATION_INVALID");
    }
    const chapter = current as Chapter;
    const separator = chapter.content.trim() ? "\n\n" : "";
    const nextChapter: Chapter = {
      ...chapter,
      content: input.applicationMode === "append"
        ? `${chapter.content}${separator}${artifact.candidateContent}`
        : input.applicationMode === "replace"
          ? artifact.candidateContent
          : chapter.content,
      summary: input.applicationMode === "summary"
        ? artifact.candidateContent
        : chapter.summary,
    };
    return {
      ...nextChapter,
      updatedAt: new Date().toISOString(),
      revision: chapter.revision + 1,
      parentRevision: chapter.revision,
    };
  }
  if (!input.nextCanonicalRecord) {
    throw new RepositoryOperationError("CONVERSATION_CANONICAL_PAYLOAD_MISSING");
  }
  if (
    input.nextCanonicalRecord.id !== input.targetRecordId
    || input.nextCanonicalRecord.projectId !== input.projectId
  ) {
    throw new RepositoryOperationError("CONVERSATION_CANONICAL_SCOPE_MISMATCH");
  }
  const now = new Date().toISOString();
  return {
    ...structuredClone(input.nextCanonicalRecord),
    schemaVersion: current?.schemaVersion ?? input.nextCanonicalRecord.schemaVersion,
    id: input.targetRecordId,
    projectId: input.projectId,
    createdAt: current?.createdAt ?? input.nextCanonicalRecord.createdAt ?? now,
    updatedAt: now,
    revision: (current?.revision ?? 0) + 1,
    parentRevision: current?.revision ?? null,
  } as DomainRecord;
}

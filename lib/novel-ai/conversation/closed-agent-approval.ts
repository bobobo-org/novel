import type {
  ConversationArtifact,
  ConversationClosedAgentApprovalBindingProof,
  ConversationMessage,
  ConversationSession,
  ConversationToolInvocation,
  DomainRecord,
} from "../domain";
import {
  sha256Hex,
  stableStringify,
} from "../closed-ai-cache";
import type { ClosedAgentCandidate } from "../closed-agent-os";
import { conversationContentDigest } from "./approval-transaction";
import {
  buildConversationClosedAgentCacheOriginProof,
  hasValidConversationClosedAgentCacheOriginProof,
} from "./closed-agent-cache-origin-proof";
import { CONVERSATION_LOCAL_TOOL_IDS } from "./tool-registry";

function approvalBindingError() {
  return Object.assign(new Error("Closed candidate approval binding is invalid."), {
    code: "CONVERSATION_CLOSED_CANDIDATE_BINDING_INVALID",
  });
}

export async function assertConversationClosedAgentApprovalBinding(input: {
  projectId: string;
  sessionId: string;
  session: ConversationSession;
  sourceMessage: ConversationMessage;
  artifact: ConversationArtifact;
  sourceMessageCandidateArtifacts: ConversationArtifact[];
  invocations: ConversationToolInvocation[];
  targetRecord: DomainRecord | null;
  candidate: ClosedAgentCandidate | null;
  candidateIntegrityVerified: boolean;
}) {
  const {
    artifact,
    candidate,
    session,
    sourceMessage,
  } = input;
  const closedCandidateIds = sourceMessage.candidateIds.filter((id) => (
    id.startsWith("closed-agent-candidate:")
  ));
  const candidateInvocations = input.invocations.filter((invocation) => (
    invocation.projectId === input.projectId
    && invocation.sessionId === input.sessionId
    && invocation.messageId === sourceMessage.id
    && sourceMessage.toolInvocationIds.includes(invocation.id)
    && invocation.status === "completed"
    && (artifact.artifactType === "rpg"
      ? invocation.toolId === CONVERSATION_LOCAL_TOOL_IDS.rpgTurn
        && invocation.executionReceipt?.providerRunId === candidate?.taskId
        && (
          invocation.executionReceipt?.closedAgentSchemaVersion !== "closed-agent-os-v2"
          || invocation.executionReceipt?.contextDigest === candidate?.contextDigest
        )
      : invocation.toolId === CONVERSATION_LOCAL_TOOL_IDS.closedAgentPlan
        && invocation.taskId === candidate?.taskId)
  ));
  const invocation = candidateInvocations.length === 1
    ? candidateInvocations[0]
    : null;
  const receipt = invocation?.executionReceipt;
  const rawCandidateDigest = candidate
    ? await sha256Hex(candidate.content)
    : null;
  const normalizedCandidateDigest = candidate
    ? await conversationContentDigest(candidate.content)
    : null;
  const normalizedArtifactDigest = await conversationContentDigest(
    artifact.candidateContent,
  );
  const normalizedMessageDigest = await conversationContentDigest(
    sourceMessage.content,
  );
  type RpgApprovalEnvelope = {
    schemaVersion?: unknown;
    candidate?: {
      schemaVersion?: unknown;
      taskId?: unknown;
      candidateId?: unknown;
      candidateDigest?: unknown;
      storyDigest?: unknown;
      model?: unknown;
      modelDigest?: unknown;
      sourceChapterId?: unknown;
      sourceRevision?: unknown;
      story?: unknown;
      canonicalMutationCount?: unknown;
      externalRequest?: unknown;
      dataLeftDevice?: unknown;
    };
  };
  let rpgEnvelope: RpgApprovalEnvelope | null = null;
  if (artifact.artifactType === "rpg") {
    try {
      rpgEnvelope = JSON.parse(artifact.candidateContent) as RpgApprovalEnvelope;
    } catch {
      rpgEnvelope = null;
    }
  }
  const rpg = rpgEnvelope?.candidate;
  const rpgArtifactBindingVerified = Boolean(
    candidate
    && artifact.artifactType === "rpg"
    && rpgEnvelope?.schemaVersion === "conversation-rpg-candidate-v1"
    && rpg?.schemaVersion === "rpg-chat-turn-v1"
    && rpg.taskId === candidate.taskId
    && rpg.candidateId === candidate.id
    && rpg.candidateDigest === candidate.contentDigest
    && (rpg.storyDigest === undefined || rpg.storyDigest === normalizedMessageDigest)
    && rpg.model === candidate.modelId
    && rpg.modelDigest === candidate.modelDigest
    && rpg.sourceChapterId === artifact.targetRecordId
    && rpg.sourceRevision === artifact.sourceRevision
    && rpg.story === sourceMessage.content
    && rpg.canonicalMutationCount === 0
    && rpg.externalRequest === false
    && rpg.dataLeftDevice === false,
  );
  const directArtifactBindingVerified = artifact.artifactType !== "rpg"
    && normalizedCandidateDigest === artifact.candidateDigest
    && sourceMessage.contentDigest === artifact.candidateDigest;
  const expectedCacheProof = candidate
    ? await buildConversationClosedAgentCacheOriginProof(candidate)
    : undefined;
  const persistedCacheProof = receipt?.closedAgentCacheOrigin;
  const freshExecutionVerified = Boolean(
    candidate?.executionReceipt
    && candidate.cacheOrigin === null
    && candidate.actualExecutor === candidate.backendId
    && invocation?.actualExecutor === candidate.backendId
    && persistedCacheProof === undefined
    && candidate.executionReceipt.taskId === candidate.taskId
    && candidate.executionReceipt.backendId === candidate.backendId
    && candidate.executionReceipt.actualExecutor === candidate.backendId
    && candidate.executionReceipt.modelId === candidate.modelId
    && candidate.executionReceipt.modelDigest === candidate.modelDigest
    && candidate.executionReceipt.contentDigest === candidate.contentDigest
    && candidate.executionReceipt.contextDigest === candidate.contextDigest
    && candidate.executionReceipt.externalRequest === false
    && candidate.executionReceipt.dataLeftDevice === false
    && stableStringify(candidate.executionReceipt.traditionalChineseNormalization)
      === stableStringify(candidate.traditionalChineseNormalization),
  );
  const cachedExecutionVerified = Boolean(
    candidate
    && candidate.executionReceipt === null
    && candidate.cacheOrigin
    && candidate.actualExecutor === "not_executed"
    && invocation?.actualExecutor === "not_executed"
    && hasValidConversationClosedAgentCacheOriginProof(persistedCacheProof)
    && stableStringify(persistedCacheProof) === stableStringify(expectedCacheProof),
  );
  const legacyRpgReceiptVerified = Boolean(
    artifact.artifactType === "rpg"
    && candidate
    && invocation
    && receipt
    && freshExecutionVerified
    && invocation.toolId === CONVERSATION_LOCAL_TOOL_IDS.rpgTurn
    && receipt.providerRunId === candidate.taskId
    && receipt.contextDigest === invocation.contextDigest
    && receipt.outputDigest === candidate.contentDigest
    && receipt.closedAgentSchemaVersion === undefined
    && receipt.closedAgentBackendId === undefined
    && receipt.normalizationReceiptId === undefined
    && receipt.traditionalChineseNormalizerVersion === undefined
    && receipt.closedAgentCacheOrigin === undefined,
  );
  const persistedReceiptProofVerified = Boolean(
    candidate
    && receipt
    && (
      legacyRpgReceiptVerified
      || (
        receipt.contextDigest === candidate.contextDigest
        && receipt.closedAgentSchemaVersion === candidate.schemaVersion
        && receipt.closedAgentBackendId === candidate.backendId
        && receipt.normalizationReceiptId
          === candidate.traditionalChineseNormalization.receiptId
        && receipt.traditionalChineseNormalizerVersion
          === candidate.traditionalChineseNormalization.normalizerVersion
      )
    ),
  );
  const invocationContextVerified = legacyRpgReceiptVerified
    || (artifact.artifactType === "rpg"
      ? receipt?.contextDigest === candidate?.contextDigest
      : invocation?.contextDigest === candidate?.contextDigest);
  const targetRevisionVerified = input.targetRecord
    ? input.targetRecord.id === artifact.targetRecordId
      && input.targetRecord.projectId === input.projectId
      && input.targetRecord.revision === artifact.sourceRevision
      && input.targetRecord.deletedAt === null
    : artifact.targetStore !== "chapters" && artifact.sourceRevision === 0;
  if (
    !candidate
    || !invocation
    || !receipt
    || !input.candidateIntegrityVerified
    || input.sourceMessageCandidateArtifacts.length !== 1
    || stableStringify(input.sourceMessageCandidateArtifacts[0])
      !== stableStringify(artifact)
    || session.id !== input.sessionId
    || session.projectId !== input.projectId
    || artifact.projectId !== input.projectId
    || artifact.sessionId !== input.sessionId
    || artifact.sourceMessageId !== sourceMessage.id
    || artifact.status !== "candidate"
    || !["chapters", "characters", "worldRules"].includes(artifact.targetStore)
    || !targetRevisionVerified
    || sourceMessage.projectId !== input.projectId
    || sourceMessage.sessionId !== input.sessionId
    || sourceMessage.status !== "completed"
    || !sourceMessage.completedAt
    || closedCandidateIds.length !== 1
    || closedCandidateIds[0] !== candidate.id
    || !sourceMessage.candidateIds.includes(artifact.id)
    || candidate.schemaVersion !== "closed-agent-os-v2"
    || candidate.status !== "awaiting-approval"
    || candidate.projectId !== input.projectId
    || candidate.namespace.projectId !== input.projectId
    || candidate.canonicalMutationCount !== 0
    || candidate.candidateOnly !== true
    || candidate.externalRequest !== false
    || candidate.dataLeftDevice !== false
    || candidate.sourceChapterId !== artifact.targetRecordId
    || candidate.sourceRevision !== artifact.sourceRevision
    || rawCandidateDigest !== candidate.contentDigest
    || candidate.traditionalChineseNormalization.outputDigest !== candidate.contentDigest
    || normalizedArtifactDigest !== artifact.candidateDigest
    || normalizedMessageDigest !== sourceMessage.contentDigest
    || (!directArtifactBindingVerified && !rpgArtifactBindingVerified)
    || invocation.modelId !== candidate.modelId
    || invocation.modelDigest !== candidate.modelDigest
    || !invocationContextVerified
    || invocation.externalRequest !== false
    || invocation.dataLeftDevice !== false
    || invocation.canonicalMutationCount !== 0
    || !invocation.completedAt
    || (freshExecutionVerified && receipt.providerRunId !== candidate.taskId)
    || (cachedExecutionVerified && receipt.providerRunId !== null)
    || receipt.modelId !== candidate.modelId
    || receipt.modelDigest !== candidate.modelDigest
    || receipt.outputDigest !== candidate.contentDigest
    || receipt.externalRequest !== false
    || receipt.dataLeftDevice !== false
    || !persistedReceiptProofVerified
    || (!freshExecutionVerified && !cachedExecutionVerified)
  ) {
    throw approvalBindingError();
  }
  return {
    artifact,
    candidate,
    invocation,
    session,
    sourceMessage,
    targetRecord: input.targetRecord,
  };
}

export type ConversationClosedAgentApprovalBinding = Awaited<
  ReturnType<typeof assertConversationClosedAgentApprovalBinding>
>;

export async function buildConversationClosedAgentApprovalBindingProof(
  binding: ConversationClosedAgentApprovalBinding,
): Promise<ConversationClosedAgentApprovalBindingProof> {
  const targetStore = binding.artifact.targetStore;
  if (targetStore !== "chapters" && targetStore !== "characters" && targetStore !== "worldRules") {
    throw approvalBindingError();
  }
  return {
    schemaVersion: "conversation-closed-agent-approval-binding-v1",
    candidateId: binding.candidate.id,
    candidateTaskId: binding.candidate.taskId,
    candidateBackendId: binding.candidate.backendId,
    candidateModelId: binding.candidate.modelId,
    candidateModelDigest: binding.candidate.modelDigest,
    candidateRawContentDigest: binding.candidate.contentDigest,
    candidateContextDigest: binding.candidate.contextDigest ?? "",
    normalizationReceiptId:
      binding.candidate.traditionalChineseNormalization.receiptId,
    normalizerVersion:
      binding.candidate.traditionalChineseNormalization.normalizerVersion,
    cacheOrigin:
      binding.invocation.executionReceipt?.closedAgentCacheOrigin ?? null,
    sessionId: binding.session.id,
    sessionRevision: binding.session.revision,
    sourceMessageId: binding.sourceMessage.id,
    sourceMessageRevision: binding.sourceMessage.revision,
    sourceMessageContentDigest: binding.sourceMessage.contentDigest,
    artifactId: binding.artifact.id,
    artifactRevision: binding.artifact.revision,
    artifactCandidateDigest: binding.artifact.candidateDigest,
    invocationId: binding.invocation.id,
    invocationRevision: binding.invocation.revision,
    targetStore,
    targetRecordId: binding.artifact.targetRecordId,
    targetSourceRevision: binding.artifact.sourceRevision,
  };
}

export function assertConversationClosedAgentApprovalSnapshotUnchanged(
  expected: ConversationClosedAgentApprovalBinding,
  current: ConversationClosedAgentApprovalBinding,
) {
  if (
    stableStringify(expected.session) !== stableStringify(current.session)
    || stableStringify(expected.sourceMessage) !== stableStringify(current.sourceMessage)
    || stableStringify(expected.artifact) !== stableStringify(current.artifact)
    || stableStringify(expected.invocation) !== stableStringify(current.invocation)
    || stableStringify(expected.targetRecord) !== stableStringify(current.targetRecord)
    || stableStringify(expected.candidate) !== stableStringify(current.candidate)
  ) {
    throw approvalBindingError();
  }
}

export function assertConversationClosedAgentApprovalCallbackCandidate(
  expected: ClosedAgentCandidate,
  candidate: ClosedAgentCandidate,
) {
  if (stableStringify(expected) !== stableStringify(candidate)) {
    throw approvalBindingError();
  }
}

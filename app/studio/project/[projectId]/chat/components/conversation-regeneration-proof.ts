import type {
  ConversationArtifact,
  ConversationMessage,
  ConversationToolInvocation,
} from "@/lib/novel-ai/domain";
import { hasValidConversationClosedAgentCacheOriginProof } from "@/lib/novel-ai/conversation/closed-agent-cache-origin-proof";
import { CONVERSATION_LOCAL_TOOL_IDS } from "@/lib/novel-ai/conversation/tool-registry";

const CLOSED_REGENERATION_EXECUTORS = new Set([
  "browser-ai",
  "local-ollama",
  "private-ai-hub",
]);

const SHA256_DIGEST = /^[a-f0-9]{64}$/iu;
const NORMALIZATION_RECEIPT = /^traditional-chinese-integrity:[a-f0-9]{64}$/u;

export type ClosedRegenerationProofStatus =
  | "verified"
  | "legacy_v1_unverifiable"
  | "invalid"
  | "not_applicable";

const CLOSED_PROOF_FIELDS = [
  "closedAgentSchemaVersion",
  "closedAgentBackendId",
  "normalizationReceiptId",
  "traditionalChineseNormalizerVersion",
  "closedAgentCacheOrigin",
] as const;

export function closedRegenerationProofStatus(input: {
  message: ConversationMessage;
  invocations: ConversationToolInvocation[];
  artifacts: ConversationArtifact[];
}): ClosedRegenerationProofStatus {
  const closedCandidateIds = input.message.candidateIds.filter((candidateId) => (
    candidateId.startsWith("closed-agent-candidate:")
  ));
  const closedInvocations = input.invocations.filter((invocation) => (
    invocation.toolId === CONVERSATION_LOCAL_TOOL_IDS.closedAgentPlan
    && invocation.messageId === input.message.id
    && input.message.toolInvocationIds.includes(invocation.id)
  ));
  if (closedCandidateIds.length === 0 && closedInvocations.length === 0) {
    return "not_applicable";
  }
  const normalizedCandidateBound = input.artifacts.length === 0
    || input.artifacts.some((artifact) => (
      artifact.sourceMessageId === input.message.id
      && (artifact.status === "candidate" || artifact.status === "rejected")
      && artifact.candidateDigest === input.message.contentDigest
      && SHA256_DIGEST.test(artifact.candidateDigest)
    ));
  if (closedCandidateIds.length !== 1 || !normalizedCandidateBound) return "invalid";
  const completedClosedInvocations = closedInvocations.filter((invocation) => (
    invocation.status === "completed"
  ));
  const hasAnyClosedProofField = completedClosedInvocations.some((invocation) => {
    const receipt = invocation.executionReceipt;
    return Boolean(receipt) && CLOSED_PROOF_FIELDS.some((field) => (
      Object.prototype.hasOwnProperty.call(receipt, field)
    ));
  });
  if (completedClosedInvocations.length > 0 && !hasAnyClosedProofField) {
    return "legacy_v1_unverifiable";
  }
  if (completedClosedInvocations.length !== 1) return "invalid";
  const verified = completedClosedInvocations.some((invocation) => {
    const receipt = invocation.executionReceipt;
    const backend = receipt?.closedAgentBackendId;
    const cacheOrigin = receipt?.closedAgentCacheOrigin;
    const freshExecutionVerified = backend
      && CLOSED_REGENERATION_EXECUTORS.has(backend)
      && invocation.actualExecutor === backend
      && receipt?.providerRunId === invocation.taskId
      && cacheOrigin === undefined;
    const cachedExecutionVerified = backend
      && CLOSED_REGENERATION_EXECUTORS.has(backend)
      && invocation.actualExecutor === "not_executed"
      && receipt?.providerRunId === null
      && hasValidConversationClosedAgentCacheOriginProof(cacheOrigin)
      && cacheOrigin?.originBackendId === backend
      && cacheOrigin?.originModelId === invocation.modelId
      && cacheOrigin?.originModelDigest === invocation.modelDigest
      && cacheOrigin?.originContentDigest === receipt?.outputDigest
      && cacheOrigin?.originNormalizationReceiptId === receipt?.normalizationReceiptId
      && cacheOrigin?.originNormalizerVersion
        === receipt?.traditionalChineseNormalizerVersion;
    return invocation.status === "completed"
      && invocation.toolId === CONVERSATION_LOCAL_TOOL_IDS.closedAgentPlan
      && Boolean(freshExecutionVerified || cachedExecutionVerified)
      && Boolean(invocation.modelId?.trim())
      && SHA256_DIGEST.test(invocation.modelDigest ?? "")
      && invocation.externalRequest === false
      && invocation.dataLeftDevice === false
      && invocation.canonicalMutationCount === 0
      && Boolean(receipt?.receiptId.trim())
      && receipt?.modelId === invocation.modelId
      && receipt?.modelDigest === invocation.modelDigest
      && receipt?.contextDigest === invocation.contextDigest
      && SHA256_DIGEST.test(receipt?.outputDigest ?? "")
      && receipt?.externalRequest === false
      && receipt?.dataLeftDevice === false
      && receipt?.closedAgentSchemaVersion === "closed-agent-os-v2"
      && NORMALIZATION_RECEIPT.test(receipt?.normalizationReceiptId ?? "")
      && receipt?.traditionalChineseNormalizerVersion
        === "opencc-js-1.4.1-cn-to-tw-single-pass-v1";
  });
  return verified ? "verified" : "invalid";
}

export function hasVerifiedClosedRegenerationProof(input: {
  message: ConversationMessage;
  invocations: ConversationToolInvocation[];
  artifacts: ConversationArtifact[];
}) {
  return closedRegenerationProofStatus(input) === "verified";
}

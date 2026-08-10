import type {
  ConversationArtifact,
  ConversationMessage,
  ConversationToolInvocation,
} from "@/lib/novel-ai/domain";

const CLOSED_REGENERATION_EXECUTORS = new Set([
  "browser-ai",
  "local-ollama",
  "private-ai-hub",
]);

const SHA256_DIGEST = /^[a-f0-9]{64}$/iu;

export function hasVerifiedClosedRegenerationProof(input: {
  message: ConversationMessage;
  invocations: ConversationToolInvocation[];
  artifacts: ConversationArtifact[];
}) {
  const closedCandidateIds = input.message.candidateIds.filter((candidateId) => (
    candidateId.startsWith("closed-agent-candidate:")
  ));
  const normalizedCandidateBound = input.artifacts.length === 0
    || input.artifacts.some((artifact) => (
      artifact.sourceMessageId === input.message.id
      && (artifact.status === "candidate" || artifact.status === "rejected")
      && artifact.candidateDigest === input.message.contentDigest
      && SHA256_DIGEST.test(artifact.candidateDigest)
    ));
  if (closedCandidateIds.length !== 1 || !normalizedCandidateBound) return false;
  return input.invocations.some((invocation) => {
    const receipt = invocation.executionReceipt;
    return invocation.status === "completed"
      && invocation.toolId.startsWith("closed-agent-os:")
      && CLOSED_REGENERATION_EXECUTORS.has(invocation.actualExecutor ?? "")
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
      && receipt?.providerRunId === invocation.taskId
      && receipt?.externalRequest === false
      && receipt?.dataLeftDevice === false;
  });
}

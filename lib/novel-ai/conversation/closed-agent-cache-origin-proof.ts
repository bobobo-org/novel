import type { ConversationClosedAgentCacheOriginProof } from "../domain";
import {
  sha256Hex,
  stableStringify,
} from "../closed-ai-cache";
import type { ClosedAgentCandidate } from "../closed-agent-os";

const CRYPTOGRAPHIC_DIGEST = /^[a-f0-9]{64}$/u;
const NORMALIZATION_RECEIPT = /^traditional-chinese-integrity:[a-f0-9]{64}$/u;
const CLOSED_BACKENDS = new Set([
  "browser-ai",
  "local-ollama",
  "private-ai-hub",
]);

function hasBoundedIdentifier(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}

export async function buildConversationClosedAgentCacheOriginProof(
  candidate: ClosedAgentCandidate,
): Promise<ConversationClosedAgentCacheOriginProof | undefined> {
  const origin = candidate.cacheOrigin;
  if (!origin) return undefined;
  return {
    schemaVersion: "conversation-closed-agent-cache-origin-v2",
    layer: origin.layer,
    entryId: origin.entryId,
    entryValueDigest: origin.entryValueDigest,
    originCandidateId: origin.originCandidateId,
    originTaskId: origin.originTaskId,
    originRequestId: origin.originRequestId,
    originLedgerId: origin.originLedgerId,
    originLedgerBlockHash: origin.originLedgerBlockHash,
    originBackendId: origin.originExecutionReceipt.backendId,
    originModelId: origin.originExecutionReceipt.modelId,
    originModelDigest: origin.originExecutionReceipt.modelDigest,
    originContentDigest: origin.originExecutionReceipt.contentDigest,
    originContextDigest: origin.originExecutionReceipt.contextDigest,
    originNormalizationReceiptId:
      origin.originExecutionReceipt.traditionalChineseNormalization.receiptId,
    originNormalizerVersion:
      origin.originExecutionReceipt.traditionalChineseNormalization.normalizerVersion,
    namespaceDigest: await sha256Hex(stableStringify(candidate.namespace)),
  };
}

export function hasValidConversationClosedAgentCacheOriginProof(
  proof: ConversationClosedAgentCacheOriginProof | undefined,
) {
  return Boolean(
    proof
    && proof.schemaVersion === "conversation-closed-agent-cache-origin-v2"
    && (proof.layer === "exact" || proof.layer === "semantic")
    && hasBoundedIdentifier(proof.entryId)
    && CRYPTOGRAPHIC_DIGEST.test(proof.entryValueDigest)
    && hasBoundedIdentifier(proof.originCandidateId)
    && proof.originCandidateId.startsWith("closed-agent-candidate:")
    && hasBoundedIdentifier(proof.originTaskId)
    && proof.originTaskId === proof.originRequestId
    && hasBoundedIdentifier(proof.originLedgerId)
    && CRYPTOGRAPHIC_DIGEST.test(proof.originLedgerBlockHash)
    && CLOSED_BACKENDS.has(proof.originBackendId)
    && hasBoundedIdentifier(proof.originModelId)
    && CRYPTOGRAPHIC_DIGEST.test(proof.originModelDigest)
    && CRYPTOGRAPHIC_DIGEST.test(proof.originContentDigest)
    && CRYPTOGRAPHIC_DIGEST.test(proof.originContextDigest)
    && NORMALIZATION_RECEIPT.test(proof.originNormalizationReceiptId)
    && hasBoundedIdentifier(proof.originNormalizerVersion)
    && CRYPTOGRAPHIC_DIGEST.test(proof.namespaceDigest),
  );
}

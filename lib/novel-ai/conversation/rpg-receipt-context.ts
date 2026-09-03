import type { ConversationExecutionReceipt } from "../domain";

const SHA256_DIGEST = /^[a-f0-9]{64}$/u;

type RpgContextCarrier = {
  contextDigest?: unknown;
  executionReceipt?: unknown;
};

function recordValue(value: unknown) {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function digestValue(value: unknown) {
  return typeof value === "string" && SHA256_DIGEST.test(value)
    ? value
    : null;
}

function hasOwn(record: Record<string, unknown> | null, key: string) {
  return Boolean(record && Object.prototype.hasOwnProperty.call(record, key));
}

/**
 * RPG candidates carry two deliberately distinct context identities:
 *
 * - the Closed Agent/provider context that is sealed by the model receipt; and
 * - the RPG snapshot context that protects Canon continuity.
 *
 * `withCausalKnowledgeReceipt()` retains both on the embedded receipt.  Never
 * substitute the RPG snapshot digest for the provider digest when projecting a
 * Closed Agent receipt into Conversation storage.
 */
export function inspectRpgCandidateReceiptContexts(candidate: RpgContextCarrier) {
  const embeddedReceipt = recordValue(candidate.executionReceipt);
  const hasUpstreamContext = hasOwn(embeddedReceipt, "upstreamContextDigest");
  const hasRpgContext = hasOwn(embeddedReceipt, "rpgContextDigest");
  const embeddedContextDigest = digestValue(embeddedReceipt?.contextDigest);
  const upstreamContextDigest = digestValue(embeddedReceipt?.upstreamContextDigest);
  const rpgSnapshotContextDigest = digestValue(candidate.contextDigest);
  const embeddedRpgContextDigest = digestValue(embeddedReceipt?.rpgContextDigest);
  const providerContextDigest = hasUpstreamContext
    ? upstreamContextDigest
    : embeddedContextDigest;

  return {
    hasCausalContextBinding: hasUpstreamContext && hasRpgContext,
    providerContextDigest,
    providerContextVerified: Boolean(
      providerContextDigest
      && embeddedContextDigest === providerContextDigest,
    ),
    rpgSnapshotContextDigest,
    rpgSnapshotContextVerified: Boolean(
      rpgSnapshotContextDigest
      && embeddedRpgContextDigest === rpgSnapshotContextDigest,
    ),
  };
}

export function isModernClosedAgentConversationReceipt(
  receipt: ConversationExecutionReceipt | null | undefined,
) {
  return receipt?.closedAgentSchemaVersion === "closed-agent-os-v2";
}

export function isModernRpgConversationReceiptContextBound(
  candidate: RpgContextCarrier,
  receipt: ConversationExecutionReceipt | null | undefined,
) {
  if (!isModernClosedAgentConversationReceipt(receipt)) return false;
  const contexts = inspectRpgCandidateReceiptContexts(candidate);
  return contexts.hasCausalContextBinding
    && contexts.providerContextVerified
    && contexts.rpgSnapshotContextVerified
    && receipt?.contextDigest === contexts.providerContextDigest;
}

/**
 * Detect only the historical projection bug: a fully modern receipt was
 * written with the verified RPG snapshot digest while the embedded candidate
 * still retains a valid, different provider digest.  Arbitrary receipt damage
 * is not repairable by this path and remains fail-closed.
 */
export function isRepairableModernRpgReceiptContextProjection(
  candidate: RpgContextCarrier,
  receipt: ConversationExecutionReceipt | null | undefined,
  authoritativeProviderContextDigest: string,
) {
  if (!isModernClosedAgentConversationReceipt(receipt)) return false;
  const contexts = inspectRpgCandidateReceiptContexts(candidate);
  return contexts.hasCausalContextBinding
    && contexts.providerContextVerified
    && contexts.rpgSnapshotContextVerified
    && contexts.providerContextDigest === authoritativeProviderContextDigest
    && contexts.rpgSnapshotContextDigest !== authoritativeProviderContextDigest
    && receipt?.contextDigest === contexts.rpgSnapshotContextDigest;
}

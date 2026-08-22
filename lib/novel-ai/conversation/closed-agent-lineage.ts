import type {
  ConversationMessage,
  ConversationToolInvocation,
} from "../domain";
import { CONVERSATION_LOCAL_TOOL_IDS } from "./tool-registry";

const CLOSED_AGENT_EXECUTORS = new Set([
  "browser-ai",
  "local-ollama",
  "private-ai-hub",
]);

export function isConversationClosedAgentInvocation(
  invocation: ConversationToolInvocation,
) {
  const receipt = invocation.executionReceipt;
  return invocation.toolId === CONVERSATION_LOCAL_TOOL_IDS.closedAgentPlan
    || receipt?.closedAgentSchemaVersion === "closed-agent-os-v2"
    || receipt?.closedAgentBackendId !== undefined
    || receipt?.closedAgentCacheOrigin !== undefined
    || receipt?.normalizationReceiptId !== undefined
    || receipt?.traditionalChineseNormalizerVersion !== undefined
    || (
      invocation.toolId === CONVERSATION_LOCAL_TOOL_IDS.rpgTurn
      && CLOSED_AGENT_EXECUTORS.has(invocation.actualExecutor ?? "")
    );
}

export function hasConversationClosedAgentLineage(input: {
  message: ConversationMessage;
  invocations: Array<ConversationToolInvocation | null | undefined>;
}) {
  return input.message.candidateIds.some((candidateId) => (
    candidateId.startsWith("closed-agent-candidate:")
  )) || input.invocations.some((invocation) => (
    Boolean(invocation) && isConversationClosedAgentInvocation(invocation!)
  ));
}

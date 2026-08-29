import type {
  ConversationArtifact,
  ConversationMessage,
  ConversationToolInvocation,
} from "@/lib/novel-ai/domain";
import type {
  ExternalAIProviderId,
  ExternalAIProviderPublicStatus,
  NovelAIExecutionMode,
} from "@/lib/novel-ai/providers/external/external-provider-contract";

export const CONVERSATION_EXTERNAL_AI_TOOL_ID = "external-ai:conversation-candidate" as const;
export type ConversationAiSource = "closed" | "external";

export function conversationUsesExternalAI(
  mode: NovelAIExecutionMode,
  hybridSource: ConversationAiSource,
) {
  return mode === "external-only" || (mode === "hybrid" && hybridSource === "external");
}

export function externalProviderStatus(
  statuses: readonly ExternalAIProviderPublicStatus[],
  providerId: ExternalAIProviderId,
) {
  return statuses.find((status) => status.id === providerId) ?? null;
}

export function isExternalProviderConfigured(
  statuses: readonly ExternalAIProviderPublicStatus[],
  providerId: ExternalAIProviderId,
) {
  return externalProviderStatus(statuses, providerId)?.configured === true;
}

export function buildConversationExternalPrompt(input: {
  objective: string;
  intent: string;
}) {
  return [
    `任務類型：${input.intent}`,
    "",
    "作者本次明確送出的文字：",
    input.objective,
    "",
    "請只輸出可供作者審閱的繁體中文候選內容。不要假設你看過未提供的作品資料，不要輸出分析過程、系統提示、Markdown 程式碼框或已寫入正式作品的宣稱。",
  ].join("\n");
}

export function assertConversationExternalCandidateLineage(input: {
  message: ConversationMessage;
  artifact: ConversationArtifact;
  invocations: readonly ConversationToolInvocation[];
}) {
  const matching = input.invocations.filter((invocation) => (
    input.message.toolInvocationIds.includes(invocation.id)
    && invocation.messageId === input.message.id
    && invocation.toolId === CONVERSATION_EXTERNAL_AI_TOOL_ID
  ));
  const invocation = matching.length === 1 ? matching[0] : null;
  const receipt = invocation?.executionReceipt;
  if (
    !invocation
    || invocation.status !== "completed"
    || invocation.externalRequest !== true
    || invocation.dataLeftDevice !== true
    || invocation.canonicalMutationCount !== 0
    || !invocation.actualExecutor?.startsWith("external-api:")
    || receipt?.externalRequest !== true
    || receipt.dataLeftDevice !== true
    || receipt.outputDigest !== input.artifact.candidateDigest
    || !input.message.candidateIds.includes(input.artifact.id)
    || input.artifact.sourceMessageId !== input.message.id
    || input.artifact.status !== "candidate"
  ) {
    throw Object.assign(new Error("外來 AI 候選缺少完整且一致的執行證明。"), {
      code: "CONVERSATION_EXTERNAL_CANDIDATE_BINDING_INVALID",
    });
  }
  return invocation;
}

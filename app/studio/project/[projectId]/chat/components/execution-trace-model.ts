import type { ConversationToolInvocation } from "@/lib/novel-ai/domain";
import { CONVERSATION_LOCAL_TOOL_IDS } from "@/lib/novel-ai/conversation/tool-registry";
import { CONVERSATION_EXTERNAL_AI_TOOL_ID } from "../external-ai";

export type ExecutionTraceStageState = "complete" | "active" | "used" | "skipped" | "failed";

export type ExecutionTraceStage = {
  id: "causal-contract" | "compute-selection" | "closed-ai-work" | "story-fallback";
  label: string;
  state: ExecutionTraceStageState;
  description: string;
};

export type ConversationExecutionTraceModel = {
  invocation: ConversationToolInvocation;
  summary: string;
  badge: string;
  stages: ExecutionTraceStage[];
  executorLabel: string;
  modelLabel: string;
  boundaryLabel: string;
  canonLabel: string;
};

export type FriendlyConversationError = {
  title: string;
  message: string;
};

const TRACE_TOOL_IDS = new Set<string>([
  CONVERSATION_LOCAL_TOOL_IDS.closedAgentPlan,
  CONVERSATION_LOCAL_TOOL_IDS.rpgChoicePlan,
  CONVERSATION_LOCAL_TOOL_IDS.rpgTurn,
  CONVERSATION_EXTERNAL_AI_TOOL_ID,
]);

const CLOSED_AI_EXECUTORS = new Set([
  "browser-ai",
  "local-ollama",
  "private-ai-hub",
]);

const ERROR_COPY: Record<string, FriendlyConversationError> = {
  RPG_CHAT_RULE_CHOICES_NOT_PLAYABLE: {
    title: "三條故事路線需要重新整理",
    message: "這次沒有建立出三個真正不同、可立即選擇的路線；正式故事與數值都維持原狀，請再試一次。",
  },
  RPG_CHAT_CHOICES_STALE: {
    title: "故事狀態已更新",
    message: "這張選擇卡使用的是較早版本；請重新產生本回合路線，避免套用到錯誤的故事狀態。",
  },
  RPG_CHAT_TURN_ALREADY_RUNNING: {
    title: "這一回合正在處理",
    message: "另一個操作仍在建立同一回合，請稍候完成，不需要重複點擊。",
  },
  RPG_CHAT_TURN_ALREADY_CREATED: {
    title: "這一回合已有候選",
    message: "同一張選擇卡已建立故事候選；請先查看、採用或放棄目前候選。",
  },
  RPG_FALLBACK_CLOSED_REVIEW_REQUIRED: {
    title: "正文尚未通過閉端 AI 複核",
    message: "內部後備草稿沒有顯示、沒有建立候選，也沒有寫入正式作品；請稍後重試這一回合。",
  },
  RPG_STORY_AI_TIMEOUT: {
    title: "閉端 AI 尚未完成正文",
    message: "未完成內容沒有顯示或寫入作品；系統只會在複核完成後建立候選，請稍後重試。",
  },
  NO_CLOSED_PROVIDER_AVAILABLE: {
    title: "目前沒有可完成複核的閉端模型",
    message: "內部草稿不會直接曝光或寫入作品；請在瀏覽器 AI 或本機 Ollama 可用後重試。",
  },
  CONVERSATION_CANCELLED: {
    title: "已停止這次生成",
    message: "未完成內容沒有寫入正式故事；你可以調整方向後重新嘗試。",
  },
  CONVERSATION_OPERATION_ALREADY_RUNNING: {
    title: "另一個分頁正在處理",
    message: "為避免同一作品被重複執行，這次操作沒有開始；請稍候或回到原分頁查看。",
  },
};

const INTERNAL_CODE = /\b(?:RPG|CONVERSATION|CLOSED_AI|CLOSED_AGENT|STUDIO)_[A-Z0-9_]+\b/u;

function invocationStatus(invocation: ConversationToolInvocation) {
  if (invocation.status === "completed") return "complete" as const;
  if (invocation.status === "running" || invocation.status === "pending") return "active" as const;
  return "failed" as const;
}

function executorLabel(actualExecutor: string | null) {
  if (actualExecutor?.startsWith("external-api:")) {
    const providerId = actualExecutor.slice("external-api:".length);
    const providerLabels: Record<string, string> = {
      openai: "OpenAI",
      gemini: "Gemini",
      grok: "Grok",
      claude: "Claude",
      "openai-compatible": "OpenAI-compatible／AI Gateway",
    };
    return `${providerLabels[providerId] ?? providerId} 外來 AI`;
  }
  if (actualExecutor === "browser-ai") return "瀏覽器閉端 AI";
  if (actualExecutor === "local-ollama") return "本機 Ollama";
  if (actualExecutor === "private-ai-hub") return "私有 AI Hub";
  if (actualExecutor === "deterministic-rule-fallback") return "本機規則後備";
  if (actualExecutor === "not_executed") return "已驗證本機快取";
  if (!actualExecutor) return "尚在選擇";
  return "本機受控工具";
}

function selectTraceInvocation(invocations: readonly ConversationToolInvocation[]) {
  for (let index = invocations.length - 1; index >= 0; index -= 1) {
    const invocation = invocations[index];
    if (TRACE_TOOL_IDS.has(invocation.toolId)) return invocation;
  }
  return null;
}

function safeVisibleMessage(message: string | undefined) {
  const value = message?.trim() ?? "";
  return value && !INTERNAL_CODE.test(value) && /[\u3400-\u9fff]/u.test(value)
    ? value
    : "這次操作沒有完成；未完成內容與正式故事都維持原狀，請稍後再試。";
}

export function friendlyConversationExecutionError(
  code: string | null | undefined,
  message?: string,
): FriendlyConversationError {
  const normalizedCode = code?.trim() ?? "";
  const embeddedCode = message?.match(INTERNAL_CODE)?.[0] ?? "";
  const known = ERROR_COPY[normalizedCode] ?? ERROR_COPY[embeddedCode];
  if (known) return known;
  if (normalizedCode === "CONVERSATION_RELOAD_INTERRUPTED") {
    return {
      title: "頁面重新載入，這次操作已停止",
      message: "未完成內容沒有寫入正式故事；請按下重試重新執行。",
    };
  }
  return {
    title: normalizedCode === "CONVERSATION_CANCELLED" ? "已停止這次操作" : "這次操作暫時沒有完成",
    message: safeVisibleMessage(message),
  };
}

export function friendlyFailedAssistantContent(
  content: string,
  safeErrorCode?: string | null,
) {
  if (!safeErrorCode && !INTERNAL_CODE.test(content)) return content;
  const friendly = friendlyConversationExecutionError(safeErrorCode, content);
  return `${friendly.title}。${friendly.message}`;
}

export function buildConversationExecutionTrace(
  invocations: readonly ConversationToolInvocation[],
): ConversationExecutionTraceModel | null {
  const invocation = selectTraceInvocation(invocations);
  if (!invocation) return null;

  const isRpgChoicePlan = invocation.toolId === CONVERSATION_LOCAL_TOOL_IDS.rpgChoicePlan;
  const isRpgTurn = invocation.toolId === CONVERSATION_LOCAL_TOOL_IDS.rpgTurn;
  const isRpg = isRpgChoicePlan || isRpgTurn;
  const isExternal = invocation.toolId === CONVERSATION_EXTERNAL_AI_TOOL_ID;
  const isFallback = invocation.actualExecutor === "deterministic-rule-fallback";
  const isCacheHit = invocation.actualExecutor === "not_executed"
    && Boolean(invocation.executionReceipt?.closedAgentCacheOrigin);
  const aiExecuted = invocation.status === "completed"
    && CLOSED_AI_EXECUTORS.has(invocation.actualExecutor ?? "");
  const externalExecuted = isExternal
    && invocation.status === "completed"
    && invocation.actualExecutor?.startsWith("external-api:");
  const status = invocationStatus(invocation);
  const selectedExecutorLabel = isRpgChoicePlan && isFallback
    ? "本機因果規則"
    : executorLabel(invocation.actualExecutor);
  const failedCopy = friendlyConversationExecutionError(
    invocation.safeErrorCode,
    invocation.safeProgress?.message,
  );

  const stages: ExecutionTraceStage[] = [
    {
      id: "causal-contract",
      label: "因果教師／規則契約",
      state: isRpg ? status : "skipped",
      description: isRpg
        ? status === "complete"
          ? "已套用受控因果規則、Canon 邊界與本回合可玩性契約。"
          : status === "active"
            ? "正在整理因果規則與本回合邊界。"
            : "本回合規則契約沒有完成，正式故事未變。"
        : "本次是一般作品任務，未建立 RPG 回合規則。",
    },
    {
      id: "compute-selection",
      label: "自動協調運算",
      state: status,
      description: status === "active"
        ? isExternal
          ? "正在連線到作者本次明確選擇的外來供應商。"
          : "正在選擇此裝置可用的閉端算力。"
        : status === "failed"
          ? failedCopy.message
          : isExternal
            ? `已依單次同意選用${selectedExecutorLabel}；不會自動改用其他來源。`
          : isRpgChoicePlan && isFallback
            ? "依即時選項契約選用本機規則引擎，不等待模型佇列。"
            : isFallback
              ? "閉端模型路徑未完成，已安全切換到本機規則後備。"
              : isCacheHit
                ? "找到已驗證的本機快取，本回合不重新執行模型。"
                : `已選用${selectedExecutorLabel}。`,
    },
    {
      id: "closed-ai-work",
      label: isExternal ? "外來 AI 候選內容" : "閉端 AI 正文／連貫性",
      state: externalExecuted || aiExecuted ? "complete" : status === "active" && !isRpgChoicePlan ? "active" : status === "failed" ? "failed" : "skipped",
      description: externalExecuted
        ? `已由${selectedExecutorLabel}產生候選；核准前不會寫入正式作品。`
        : aiExecuted
        ? `已由${selectedExecutorLabel}依作品脈絡產生候選，並通過本回合正文契約。`
        : isCacheHit
          ? "本回合沿用已驗證快取，沒有重新執行閉端模型。"
          : isRpgChoicePlan
            ? "這一步只建立三條路線，沒有執行正文生成。"
            : isFallback
              ? "本回合未由閉端 AI 產生正文；不會把規則後備標成 AI。"
              : status === "active"
                ? "等待自動協調器完成運算選擇。"
                : "閉端 AI 正文工作沒有完成。",
    },
    {
      id: "story-fallback",
      label: "完整故事規則後備",
      state: isRpgTurn && isFallback && status === "complete" ? "used" : status === "active" && isRpgTurn ? "active" : "skipped",
      description: isRpgTurn && isFallback && status === "complete"
        ? "已用本機規則產生完整、可閱讀的故事候選；這不是模型輸出。"
        : isRpgChoicePlan
          ? "這則訊息只建立選項，未啟用完整故事後備。"
          : externalExecuted
            ? "外來 AI 已完成候選，因此沒有啟用任何閉端或規則後備。"
          : aiExecuted
            ? "閉端 AI 已完成本回合，因此沒有使用規則後備。"
            : status === "active" && isRpgTurn
              ? "只有閉端模型無法完成時才會啟用。"
              : "本回合沒有使用完整故事規則後備。",
    },
  ];

  const summary = status === "active"
    ? "正在建立本回合候選"
    : status === "failed"
      ? failedCopy.title
      : isRpgTurn && isFallback
        ? "本回合由規則後備完成"
        : isRpgChoicePlan
          ? "三條路線由因果規則完成"
          : isCacheHit
            ? "本回合使用已驗證快取"
            : externalExecuted
              ? `本回合由${selectedExecutorLabel}建立候選`
            : aiExecuted
              ? `本回合由${selectedExecutorLabel}完成`
              : "本機受控任務已完成";

  return {
    invocation,
    summary,
    badge: status === "active"
      ? "進行中"
      : status === "failed"
        ? "未完成"
        : isRpgChoicePlan
          ? "因果規則"
          : isFallback
            ? "規則後備"
            : isCacheHit
              ? "本機快取"
              : externalExecuted
                ? "外來 AI"
              : aiExecuted
                ? "閉端 AI"
                : "本機工具",
    stages,
    executorLabel: selectedExecutorLabel,
    modelLabel: (aiExecuted || externalExecuted) && invocation.modelId
      ? invocation.modelId
      : isRpgChoicePlan && isFallback
        ? "三路線因果規則引擎"
        : isFallback
          ? "規則式故事引擎"
          : "本回合未重新執行模型",
    boundaryLabel: isExternal
      ? "內容已依本次單次同意外送"
      : invocation.externalRequest || invocation.dataLeftDevice ? "有外送記錄" : "資料留在此裝置",
    canonLabel: invocation.canonicalMutationCount === 0
      ? "候選階段未修改 Canon"
      : `已記錄 ${invocation.canonicalMutationCount} 次正式寫入`,
  };
}

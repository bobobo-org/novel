import type {
  ConversationArtifact,
  ConversationMessage,
  ConversationToolInvocation,
} from "@/lib/novel-ai/domain";
import type { RpgChatChoicePlan, RpgChatTurnCandidate } from "@/lib/novel-ai/web/rpg-chat-turn";
import { CONVERSATION_LOCAL_TOOL_IDS } from "@/lib/novel-ai/conversation/tool-registry";
import { isModernClosedAgentConversationReceipt, isModernRpgConversationReceiptContextBound } from "@/lib/novel-ai/conversation/rpg-receipt-context";
import type {
  ParsedRpgChoices,
  RpgChoiceEnvelope,
  RpgDisplayChoice,
} from "./conversation-types";

export const RPG_CHOICES_PREFIX = "[[NOVEL_RPG_CHOICES_V1]]\n";

export function formatConversationTime(value: string) {
  const time = new Date(value);
  return Number.isNaN(time.getTime())
    ? "時間未記錄"
    : time.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
}

export function conversationMessageLabel(role: ConversationMessage["role"]) {
  if (role === "user") return "你";
  if (role === "assistant") return "小說專案助手";
  if (role === "tool") return "本機工具";
  return "系統通知";
}

export function conversationStatusLabel(status: ConversationMessage["status"]) {
  const labels: Record<ConversationMessage["status"], string> = {
    pending: "等待執行",
    streaming: "產生中",
    completed: "已完成",
    failed: "未完成",
    cancelled: "已停止",
  };
  return labels[status];
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isExecutableRpgChoice(value: unknown): value is RpgChatChoicePlan["choices"][number] {
  const choice = objectValue(value);
  if (!choice) return false;
  return typeof choice.id === "string"
    && ["A", "B", "C"].includes(String(choice.key))
    && typeof choice.approach === "string"
    && typeof choice.primaryStat === "string"
    && typeof choice.secondaryStat === "string"
    && typeof choice.successChance === "number"
    && typeof choice.internalSuccessChance === "number"
    && typeof choice.risk === "number"
    && Array.isArray(choice.requirements)
    && Array.isArray(choice.missingRequirements)
    && Array.isArray(choice.knownCosts)
    && Array.isArray(choice.costLabels)
    && Array.isArray(choice.impactLabels)
    && Array.isArray(choice.delayedConsequenceRefs)
    && Boolean(objectValue(choice.effect))
    && Boolean(objectValue(choice.immediateEffect))
    && Boolean(objectValue(choice.failureEffect))
    && Boolean(objectValue(choice.partialSuccessEffect))
    && Boolean(objectValue(choice.successEffect))
    && Boolean(objectValue(choice.criticalSuccessEffect))
    && Boolean(objectValue(choice.sourceSnapshot))
    && Boolean(objectValue(choice.encounter));
}

export function parseRpgChoices(value: string): ParsedRpgChoices | null {
  if (!value.startsWith(RPG_CHOICES_PREFIX)) return null;
  try {
    const parsed = objectValue(JSON.parse(value.slice(RPG_CHOICES_PREFIX.length)));
    const plan = objectValue(parsed?.plan);
    const rawChoices = Array.isArray(plan?.choices) ? plan.choices : [];
    if (parsed?.schemaVersion !== "conversation-rpg-choices-v1" || rawChoices.length !== 3) {
      return null;
    }
    const rows = rawChoices.map((value, index) => {
      const choice = objectValue(value);
      const key = choice?.key === "A" || choice?.key === "B" || choice?.key === "C"
        ? choice.key
        : null;
      if (!choice || !key) return null;
      const executable = isExecutableRpgChoice(choice);
      const fallbackRisk = [1, 3, 5][index] as 1 | 3 | 5;
      const numericRisk = Number(choice.risk);
      const risk = Math.max(1, Math.min(5, Number.isFinite(numericRisk) ? Math.round(numericRisk) : fallbackRisk)) as 1 | 2 | 3 | 4 | 5;
      const knownCosts = Array.isArray(choice.knownCosts)
        ? choice.knownCosts.flatMap((cost) => {
          const label = nullableText(objectValue(cost)?.label);
          return label ? [{ label }] : [];
        })
        : [];
      return {
        key,
        strategyLabel: nonEmptyText(choice.strategyLabel, ["穩健／觀察", "資源／關係", "高風險／突破"][index]),
        title: nonEmptyText(choice.title, `選項 ${key}`),
        description: nonEmptyText(choice.description, "這是舊版保存的故事選項。"),
        displayedChanceBand: nonEmptyText(choice.displayedChanceBand, "舊版未記錄機率"),
        risk,
        knownCosts,
        consequenceTeaser: nonEmptyText(choice.consequenceTeaser, nonEmptyText(choice.consequence, "部分後果仍未知。")),
        irreversibleWarning: nullableText(choice.irreversibleWarning),
        disabledReason: executable
          ? nullableText(choice.disabledReason)
          : "舊版選項僅供查看，請重新產生本回合。",
      } satisfies RpgDisplayChoice;
    });
    if (rows.some((choice) => !choice)) return null;
    const choices = rows as RpgDisplayChoice[];
    if (new Set(choices.map((choice) => choice.key)).size !== 3) return null;
    const executable = rawChoices.every(isExecutableRpgChoice)
      && typeof parsed.chapterId === "string"
      && Number.isInteger(parsed.chapterRevision)
      && Number.isInteger(parsed.storyStateRevision)
      && typeof parsed.contextRevisionDigest === "string"
      && parsed.contextRevisionDigest.length === 64
      && plan?.schemaVersion === "rpg-chat-turn-v1"
      && typeof plan.candidateId === "string"
      && plan.contextRevisionDigest === parsed.contextRevisionDigest
      && objectValue(plan.contextRevisionGuard)?.schemaVersion === "rpg-context-revision-guard-v1"
      && objectValue(plan.contextRevisionGuard)?.digest === parsed.contextRevisionDigest;
    return {
      envelope: executable ? parsed as unknown as RpgChoiceEnvelope : null,
      choices,
    };
  } catch {
    return null;
  }
}

export function serializeRpgChoices(input: RpgChoiceEnvelope) {
  return `${RPG_CHOICES_PREFIX}${JSON.stringify(input)}`;
}

export function parseRpgCandidate(artifact: ConversationArtifact) {
  if (artifact.artifactType !== "rpg") return null;
  try {
    const parsed = JSON.parse(artifact.candidateContent) as {
      schemaVersion?: string;
      candidate?: RpgChatTurnCandidate;
    };
    return parsed.schemaVersion === "conversation-rpg-candidate-v1" && parsed.candidate
      ? parsed.candidate
      : null;
  } catch {
    return null;
  }
}

export function rpgCandidateInvocation(
  artifact: ConversationArtifact,
  invocations: readonly ConversationToolInvocation[],
) {
  const candidate = parseRpgCandidate(artifact);
  if (!candidate) return null;
  return invocations.find((invocation) => (
    invocation.messageId === artifact.sourceMessageId
    && invocation.toolId === CONVERSATION_LOCAL_TOOL_IDS.rpgTurn
    && invocation.status === "completed"
    && invocation.executionReceipt?.providerRunId === candidate.taskId
    && invocation.executionReceipt.outputDigest === candidate.candidateDigest
    && (
      !isModernClosedAgentConversationReceipt(invocation.executionReceipt)
      || isModernRpgConversationReceiptContextBound(candidate, invocation.executionReceipt)
    )
  )) ?? null;
}

export function rpgCandidateRequiresClosedReview(
  artifact: ConversationArtifact,
  invocations: readonly ConversationToolInvocation[],
) {
  return rpgCandidateApprovalState(artifact, invocations)
    === "closed_review_required";
}

export function rpgCandidateApprovalState(
  artifact: ConversationArtifact,
  invocations: readonly ConversationToolInvocation[],
) {
  if (!parseRpgCandidate(artifact)) return "ready" as const;
  const invocation = rpgCandidateInvocation(artifact, invocations);
  if (!invocation) return "settling" as const;
  return invocation.actualExecutor === "deterministic-rule-fallback"
    ? "closed_review_required" as const
    : "ready" as const;
}

export function rpgChoiceSelectionDisabled(input: {
  busy: boolean;
  consumed: boolean;
  abandoned: boolean;
  hasEnvelope: boolean;
  closedReviewRequired: boolean;
  closedAiReady: boolean;
}) {
  return input.busy
    || input.consumed
    || input.abandoned
    || !input.hasEnvelope
    || (input.closedReviewRequired && !input.closedAiReady);
}

export function parseLearningImportCandidate(artifact: ConversationArtifact) {
  if (artifact.artifactType !== "learning_rule") return null;
  try {
    const parsed = JSON.parse(artifact.candidateContent) as {
      schemaVersion?: string;
      importSessionId?: string;
      manifestDigest?: string;
      totalParts?: number;
      completedParts?: number;
      globalSynthesis?: unknown;
      rawContentRetained?: boolean;
      dataLeftDevice?: boolean;
    };
    return parsed.schemaVersion === "conversation-learning-import-candidate-v1"
      && parsed.importSessionId
      && parsed.manifestDigest
      && parsed.rawContentRetained === false
      && parsed.dataLeftDevice === false
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function artifactStory(artifact: ConversationArtifact) {
  const learningCandidate = parseLearningImportCandidate(artifact);
  if (learningCandidate) {
    return [
      `整份匯入候選：${learningCandidate.completedParts ?? 0}/${learningCandidate.totalParts ?? 0} 部分已完成`,
      "正式學習庫尚未修改；採用後才會原子提交抽象規則。",
      JSON.stringify(learningCandidate.globalSynthesis, null, 2),
    ].join("\n\n");
  }
  return parseRpgCandidate(artifact)?.story ?? artifact.candidateContent;
}

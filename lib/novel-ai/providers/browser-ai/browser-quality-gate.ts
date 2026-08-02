import type { PlatformTaskType } from "../../router/platform-types";
import { estimateBrowserTokens } from "./browser-performance-policy";

export const BROWSER_QUALITY_GATE_VERSION = "browser-quality-gate-v2" as const;

export type BrowserQualityGateResult = {
  schemaVersion: typeof BROWSER_QUALITY_GATE_VERSION;
  decision: "pass" | "revise" | "escalate" | "block";
  score: number;
  threshold: number;
  scores: {
    traditionalChinese: number;
    canonCompliance: number;
    characterVoice: number;
    continuity: number;
    specificity: number;
    repetition: number;
    structuredOutput: number;
    taskUsefulness: number;
    lengthCompliance: number;
  };
  reasonCodes: string[];
  userMessage: string | null;
  allowedActions: Array<
    | "adjust-and-retry"
    | "use-local-ollama"
    | "use-private-hub"
    | "abandon"
  >;
  candidateOnly: true;
  canonicalMutationCount: 0;
  rawChainOfThoughtStored: false;
};

const SIMPLIFIED_ONLY_MARKERS = /[这为发后里时会还让从与个们说对开关无过达应见实体么]/gu;

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function repetitionScore(content: string) {
  const normalized = content.replace(/\s+/gu, "").trim();
  if (normalized.length < 24) return 0.82;
  const grams = new Map<string, number>();
  for (let index = 0; index <= normalized.length - 8; index += 4) {
    const gram = normalized.slice(index, index + 8);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  const total = [...grams.values()].reduce((sum, count) => sum + count, 0);
  const repeated = [...grams.values()].reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0,
  );
  return clamp(1 - (total ? repeated / total : 0));
}

function specificityScore(content: string) {
  const concreteSignals = (
    content.match(/[，。！？：；「」『』\d]|[東西南北上下前後]|[門窗桌椅劍刀書信雨雪風火]/gu)
    ?? []
  ).length;
  return clamp(0.42 + concreteSignals / Math.max(20, content.length * 0.18));
}

function usefulnessScore(content: string) {
  const emptyOrMeta = /^(?:無法|不能|作為 AI|以下是|當然可以)[\s\S]{0,30}$/u.test(content.trim());
  if (emptyOrMeta) return 0.15;
  const clauses = content.split(/[。！？\n]/u).filter((value) => value.trim().length >= 4);
  return clamp(0.45 + clauses.length / 12);
}

const DIRECT_NARRATIVE_TASKS = new Set<PlatformTaskType>([
  "chapter.continue",
  "chapter.rewrite",
  "chapter.expand",
  "character.dialogue",
  "drama.dialogue",
]);

function narrativeTaskFormMismatch(
  taskType: PlatformTaskType,
  content: string,
) {
  if (!DIRECT_NARRATIVE_TASKS.has(taskType)) return false;
  const numberedItems = content.match(/(?:^|[\n\r]|\s)\d{1,2}[.．、)]\s*/gu)?.length ?? 0;
  const questions = content.match(/[？?]/gu)?.length ?? 0;
  const explicitEditorialFrame = /(?:爭議環節|問題清單|以下(?:問題|分析|建議)|請(?:提問|分析)|創作建議|修訂建議)/u.test(content);
  return explicitEditorialFrame || (numberedItems >= 3 && questions >= 3);
}

function traditionalChineseScore(content: string) {
  const markers = content.match(SIMPLIFIED_ONLY_MARKERS)?.length ?? 0;
  return clamp(1 - markers / Math.max(8, content.length * 0.06));
}

function structuredOutputScore(content: string, required: boolean) {
  if (!required) return 1;
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" ? 1 : 0;
  } catch {
    return 0;
  }
}

function round(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

export function evaluateBrowserCandidateQuality(input: {
  taskType: PlatformTaskType;
  content: string;
  expectedMinTokens?: number;
  expectedMaxTokens?: number;
  requiresStructuredOutput?: boolean;
  canonConflictCount?: number;
  continuityIssueCount?: number;
  characterBoundaryLeakCount?: number;
  characterVoiceScore?: number;
  threshold?: number;
}): BrowserQualityGateResult {
  const content = input.content.trim();
  const tokenCount = estimateBrowserTokens(content);
  const expectedMin = Math.max(1, input.expectedMinTokens ?? 24);
  const expectedMax = Math.max(expectedMin, input.expectedMaxTokens ?? 1_024);
  const characterBoundaryLeakCount = Math.max(
    0,
    input.characterBoundaryLeakCount ?? 0,
  );
  const taskFormMismatch = narrativeTaskFormMismatch(input.taskType, content);
  const scores = {
    traditionalChinese: traditionalChineseScore(content),
    canonCompliance: clamp(1 - (input.canonConflictCount ?? 0) * 0.34),
    characterVoice: clamp(input.characterVoiceScore ?? 0.82),
    continuity: clamp(1 - (input.continuityIssueCount ?? 0) * 0.25),
    specificity: specificityScore(content),
    repetition: repetitionScore(content),
    structuredOutput: structuredOutputScore(
      content,
      Boolean(input.requiresStructuredOutput),
    ),
    taskUsefulness: taskFormMismatch ? 0.05 : usefulnessScore(content),
    lengthCompliance: tokenCount >= expectedMin && tokenCount <= expectedMax
      ? 1
      : tokenCount < expectedMin
        ? clamp(tokenCount / expectedMin)
        : clamp(expectedMax / tokenCount),
  };
  const weights = {
    traditionalChinese: 0.12,
    canonCompliance: 0.18,
    characterVoice: 0.12,
    continuity: 0.14,
    specificity: 0.1,
    repetition: 0.1,
    structuredOutput: 0.1,
    taskUsefulness: 0.08,
    lengthCompliance: 0.06,
  } as const;
  const score = round(Object.entries(scores).reduce(
    (sum, [key, value]) => sum + value * weights[key as keyof typeof weights],
    0,
  ));
  const threshold = input.threshold ?? 0.76;
  const reasonCodes: string[] = [];
  for (const [name, value] of Object.entries(scores)) {
    if (value < 0.65) reasonCodes.push(`QUALITY_${name.toUpperCase()}_LOW`);
  }
  if (!content) reasonCodes.push("QUALITY_EMPTY_CANDIDATE");
  if (taskFormMismatch) reasonCodes.push("QUALITY_TASK_FORM_MISMATCH");
  if (characterBoundaryLeakCount > 0) {
    reasonCodes.push("CHARACTER_KNOWLEDGE_BOUNDARY_LEAK");
  }
  const block = !content
    || characterBoundaryLeakCount > 0
    || taskFormMismatch
    || scores.structuredOutput === 0
    || scores.canonCompliance < 0.5;
  const decision = block
    ? "block" as const
    : score >= threshold
      ? "pass" as const
      : score >= threshold - 0.12
        ? "revise" as const
        : "escalate" as const;
  return {
    schemaVersion: BROWSER_QUALITY_GATE_VERSION,
    decision,
    score,
    threshold,
    scores: Object.fromEntries(
      Object.entries(scores).map(([key, value]) => [key, round(value)]),
    ) as BrowserQualityGateResult["scores"],
    reasonCodes,
    userMessage: decision === "pass"
      ? null
      : "這個瀏覽器版本品質不足。請調整要求後再試，或明確選擇其他閉端算力。",
    allowedActions: decision === "pass"
      ? []
      : ["adjust-and-retry", "use-local-ollama", "use-private-hub", "abandon"],
    candidateOnly: true,
    canonicalMutationCount: 0,
    rawChainOfThoughtStored: false,
  };
}

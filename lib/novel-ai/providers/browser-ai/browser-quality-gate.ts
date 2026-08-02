import type { PlatformTaskType } from "../../router/platform-types";
import {
  currentChapterContext,
  extractNarrativeCharacterAnchors,
} from "../closed/continuity-anchors";
import { estimateBrowserTokens } from "./browser-performance-policy";

export const BROWSER_QUALITY_GATE_VERSION = "browser-quality-gate-v5" as const;

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
  const metaIntroduction = /^(?:我將|以下|接下來)[\s\S]{0,80}(?:續寫|故事|小說|選擇)/u.test(content.trim());
  const leakedInstruction = /(?:(?:關於|針對)[\s\S]{0,40}(?:爭議|分析|建議)[\s\S]{0,40}(?:不適合|禁止|不應)[\s\S]{0,50}(?:輸出|插入)|(?:僅|只)輸出[\s\S]{0,50}(?:正文|文本))/u.test(content);
  return explicitEditorialFrame
    || metaIntroduction
    || leakedInstruction
    || (numberedItems >= 3 && questions >= 3);
}

const CONTEXT_BIGRAM_STOP_WORDS = new Set([
  "一個", "這個", "那個", "自己", "他們", "她們", "沒有", "不是", "可以",
  "已經", "仍然", "如果", "因為", "所以", "但是", "然而", "現在", "開始",
  "最後", "可能", "需要", "必須", "主角", "故事", "人物", "目前", "其中",
  "聲音", "事情", "危險", "家人", "時間", "今天", "發生", "立刻", "一樣",
  "地方", "知道", "感到", "發現", "回家", "收到",
]);

const CONTEXT_TRIGRAM_STOP_WORDS = new Set([
  "一個人", "這個人", "那個人", "他們的", "她們的", "自己的", "沒有了",
  "不知道", "不可能", "有一天", "這一天", "就在這", "這時候", "那時候",
  "故事中", "主角的", "目前的", "最後的", "開始了", "決定要", "必須要",
]);

function hanSegments(value: string) {
  return value.match(/[\p{Script=Han}]{2,}/gu) ?? [];
}

function contextAnchorMissing(input: {
  taskType: PlatformTaskType;
  content: string;
  approvedContext?: string[];
}) {
  if (!DIRECT_NARRATIVE_TASKS.has(input.taskType)) return false;
  const currentChapter = currentChapterContext(input.approvedContext);
  if (!currentChapter || currentChapter.length < 60) return false;

  const bigramCounts = new Map<string, number>();
  const trigrams = new Set<string>();
  for (const segment of hanSegments(currentChapter)) {
    for (let index = 0; index <= segment.length - 2; index += 1) {
      const gram = segment.slice(index, index + 2);
      bigramCounts.set(gram, (bigramCounts.get(gram) ?? 0) + 1);
    }
    for (let index = 0; index <= segment.length - 3; index += 1) {
      const gram = segment.slice(index, index + 3);
      if (!CONTEXT_TRIGRAM_STOP_WORDS.has(gram)) trigrams.add(gram);
    }
  }
  const repeatedBigrams = [...bigramCounts.entries()]
    .filter(([gram, count]) => count >= 2 && !CONTEXT_BIGRAM_STOP_WORDS.has(gram))
    .map(([gram]) => gram);
  const candidate = input.content.replace(/\s+/gu, "");
  const carriesRepeatedAnchor = repeatedBigrams.some((gram) => candidate.includes(gram));
  const carriesSpecificAnchor = [...trigrams].some((gram) => candidate.includes(gram));
  return !carriesRepeatedAnchor && !carriesSpecificAnchor;
}

function contextCharacterAnchorMissing(input: {
  taskType: PlatformTaskType;
  content: string;
  approvedContext?: string[];
}) {
  if (!DIRECT_NARRATIVE_TASKS.has(input.taskType)) return false;
  const currentChapter = currentChapterContext(input.approvedContext);
  if (!currentChapter) return false;
  const anchors = extractNarrativeCharacterAnchors(currentChapter);
  if (!anchors.length) return false;
  const normalized = input.content.replace(/\s+/gu, "");
  const firstMatch = anchors.reduce((earliest, anchor) => {
    const index = normalized.indexOf(anchor);
    return index < 0 ? earliest : Math.min(earliest, index);
  }, Number.POSITIVE_INFINITY);
  return !Number.isFinite(firstMatch)
    || firstMatch > Math.max(80, Math.floor(normalized.length * 0.35));
}

function outputAppearsTruncated(taskType: PlatformTaskType, content: string) {
  if (!DIRECT_NARRATIVE_TASKS.has(taskType)) return false;
  const normalized = content.trim();
  if (normalized.length < 40) return false;
  return !/[。！？…」』）】]$/u.test(normalized);
}

const CONTINUATION_TASKS = new Set<PlatformTaskType>([
  "chapter.continue",
  "chapter.expand",
]);

function normalizedHan(value: string) {
  return (value.match(/[\p{Script=Han}]/gu) ?? []).join("");
}

function contextNovelty(input: {
  taskType: PlatformTaskType;
  content: string;
  approvedContext?: string[];
}) {
  if (!CONTINUATION_TASKS.has(input.taskType)) {
    return {
      excessiveReuse: false,
      missingProgress: false,
      reuseRatio: 0,
      novelTrigramCount: 0,
    };
  }
  const currentChapter = currentChapterContext(input.approvedContext);
  const chapterHan = normalizedHan(currentChapter ?? "");
  const candidateHan = normalizedHan(input.content);
  if (chapterHan.length < 60 || candidateHan.length < 3) {
    return {
      excessiveReuse: false,
      missingProgress: false,
      reuseRatio: 0,
      novelTrigramCount: 0,
    };
  }

  const contextTrigrams = new Set<string>();
  for (let index = 0; index <= chapterHan.length - 3; index += 1) {
    contextTrigrams.add(chapterHan.slice(index, index + 3));
  }
  let reused = 0;
  let novel = 0;
  const candidateTrigramCount = Math.max(0, candidateHan.length - 2);
  for (let index = 0; index <= candidateHan.length - 3; index += 1) {
    if (contextTrigrams.has(candidateHan.slice(index, index + 3))) reused += 1;
    else novel += 1;
  }
  const reuseRatio = candidateTrigramCount ? reused / candidateTrigramCount : 0;
  const leadingSample = candidateHan.slice(0, Math.min(24, candidateHan.length));
  const leadingCopied = leadingSample.length >= 12 && chapterHan.includes(leadingSample);
  return {
    excessiveReuse: reuseRatio >= 0.68 || leadingCopied,
    missingProgress: novel < 24 || reuseRatio >= 0.78,
    reuseRatio,
    novelTrigramCount: novel,
  };
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
  approvedContext?: string[];
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
  const missingContextAnchor = contextAnchorMissing({
    taskType: input.taskType,
    content,
    approvedContext: input.approvedContext,
  });
  const missingContextCharacter = contextCharacterAnchorMissing({
    taskType: input.taskType,
    content,
    approvedContext: input.approvedContext,
  });
  const truncatedOutput = outputAppearsTruncated(input.taskType, content);
  const narrativeTooShort = CONTINUATION_TASKS.has(input.taskType)
    && tokenCount < expectedMin;
  const novelty = contextNovelty({
    taskType: input.taskType,
    content,
    approvedContext: input.approvedContext,
  });
  const scores = {
    traditionalChinese: traditionalChineseScore(content),
    canonCompliance: clamp(1 - (input.canonConflictCount ?? 0) * 0.34),
    characterVoice: clamp(input.characterVoiceScore ?? 0.82),
    continuity: missingContextAnchor || missingContextCharacter
      ? 0.15
      : clamp(1 - (input.continuityIssueCount ?? 0) * 0.25),
    specificity: specificityScore(content),
    repetition: repetitionScore(content),
    structuredOutput: structuredOutputScore(
      content,
      Boolean(input.requiresStructuredOutput),
    ),
    taskUsefulness: taskFormMismatch
      || novelty.excessiveReuse
      || novelty.missingProgress
      || truncatedOutput
      ? 0.05
      : usefulnessScore(content),
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
  if (missingContextAnchor) reasonCodes.push("QUALITY_CONTEXT_ANCHOR_MISSING");
  if (missingContextCharacter) {
    reasonCodes.push("QUALITY_CONTEXT_CHARACTER_MISSING");
  }
  if (truncatedOutput) reasonCodes.push("QUALITY_OUTPUT_TRUNCATED");
  if (narrativeTooShort) reasonCodes.push("QUALITY_NARRATIVE_TOO_SHORT");
  if (novelty.excessiveReuse) {
    reasonCodes.push("QUALITY_CONTEXT_COPY_EXCESSIVE");
  }
  if (novelty.missingProgress) {
    reasonCodes.push("QUALITY_NARRATIVE_PROGRESS_MISSING");
  }
  if (characterBoundaryLeakCount > 0) {
    reasonCodes.push("CHARACTER_KNOWLEDGE_BOUNDARY_LEAK");
  }
  const block = !content
    || characterBoundaryLeakCount > 0
    || taskFormMismatch
    || missingContextAnchor
    || missingContextCharacter
    || truncatedOutput
    || narrativeTooShort
    || novelty.excessiveReuse
    || novelty.missingProgress
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

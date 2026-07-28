import { DramaOsError, throwIfCancelled } from "./errors";
import type {
  DramaProjectionInput,
  DramaSourceReference,
  EvidenceSupport,
  NarrativeAnalysis,
  NarrativeFact,
} from "./types";

const MAX_EXCERPT = 260;
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all|previous)\s+instructions/i,
  /system\s*prompt/i,
  /system\s*:/i,
  /developer\s+message/i,
  /tool\s*:/i,
  /忽略(?:以上|先前|所有)指示/u,
  /改寫系統規則/u,
];

function firstNonEmptySentence(content: string): string | null {
  return content
    .split(/(?<=[。！？!?])|\r?\n/u)
    .map((value) => value.trim())
    .find(Boolean) ?? null;
}

function locateExcerpt(input: DramaProjectionInput, excerpt: string, support: EvidenceSupport = "SUPPORTED"): DramaSourceReference[] {
  if (!excerpt) return [];
  for (const chapter of input.chapters) {
    const textStart = chapter.content.indexOf(excerpt);
    if (textStart >= 0) {
      const clippedExcerpt = excerpt.slice(0, MAX_EXCERPT);
      return [{
        storyId: input.storyId,
        chapterId: chapter.id,
        chunkId: input.sourceChunkIds[0] ?? null,
        excerpt: clippedExcerpt,
        textStart,
        textEnd: textStart + clippedExcerpt.length,
        sourceRevision: chapter.revision,
        support,
      }];
    }
  }
  return [];
}

function fact<T>(value: T | null, references: DramaSourceReference[], risk: string | null = null): NarrativeFact<T> {
  return {
    value,
    support: references.length > 0 ? "SUPPORTED" : value === null ? "UNKNOWN" : "INFERRED",
    sourceReferences: references,
    risk,
  };
}

function findCharacterEvidence(input: DramaProjectionInput, name: string): DramaSourceReference[] {
  for (const chapter of input.chapters) {
    const start = chapter.content.indexOf(name);
    if (start >= 0) {
      const sentence = firstNonEmptySentence(chapter.content.slice(start)) ?? name;
      return locateExcerpt(input, sentence.slice(0, MAX_EXCERPT));
    }
  }
  return [];
}

function extractSentences(input: DramaProjectionInput, pattern: RegExp, limit: number): string[] {
  const values: string[] = [];
  for (const chapter of input.chapters) {
    const sentences = chapter.content.split(/(?<=[。！？!?])|\r?\n/u).map((value) => value.trim()).filter(Boolean);
    for (const sentence of sentences) {
      pattern.lastIndex = 0;
      if (pattern.test(sentence) && !values.includes(sentence)) values.push(sentence.slice(0, MAX_EXCERPT));
      if (values.length >= limit) return values;
    }
  }
  return values;
}

export function validateProjectionInput(input: DramaProjectionInput): void {
  throwIfCancelled(input.signal);
  if (input.chapters.length === 0 || input.chapters.every((chapter) => chapter.content.trim().length === 0)) {
    throw new DramaOsError("DRAMA_SOURCE_EMPTY", "小說內容不足，尚不能建立短劇候選。");
  }
  const sourceChars = input.chapters.reduce((total, chapter) => total + chapter.content.length, 0);
  const maxSourceChars = input.resourceBudget?.maxSourceChars ?? 500_000;
  if (sourceChars > maxSourceChars) {
    throw new DramaOsError("DRAMA_RESOURCE_LIMIT_EXCEEDED", `來源內容超過本次處理上限（${sourceChars}/${maxSourceChars}）。`);
  }
  if (input.adultMode && (!input.adultConsent || !input.allCharactersConfirmedAdult)) {
    throw new DramaOsError("DRAMA_ADULT_CONSENT_REQUIRED", "成人作品需要主動同意，且所有相關角色必須確認成年。");
  }
}

export function analyzeNarrative(input: DramaProjectionInput): NarrativeAnalysis {
  validateProjectionInput(input);
  const namedCharacters = input.characters.filter((character) =>
    input.chapters.some((chapter) => chapter.content.includes(character.name)),
  );
  const primary = namedCharacters[0] ?? input.characters[0] ?? null;
  const primaryRefs = primary ? findCharacterEvidence(input, primary.name) : [];
  const eventSentences = extractSentences(input, /決定|發現|失去|得到|死亡|離開|抵達|戰|救|揭露|背叛|承諾/u, 12);
  const irreversible = eventSentences.filter((value) => /死亡|摧毀|失去|永遠|不可逆/u.test(value));
  const reversible = eventSentences.filter((value) => !irreversible.includes(value));
  const injectionRisk = input.chapters.some((chapter) =>
    PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(chapter.content)),
  );
  const firstSentence = firstNonEmptySentence(input.chapters[0]?.content ?? "");
  const firstRefs = firstSentence ? locateExcerpt(input, firstSentence) : [];
  const conflictSentences = extractSentences(input, /衝突|危機|追殺|敵|阻止|威脅|必須|不能|失敗/u, 8);
  const risks = [
    ...(injectionRisk ? ["來源含疑似提示注入文字，已視為小說內容而非系統指令。"] : []),
    ...(primaryRefs.length === 0 ? ["主角缺少可定位的原文證據。"] : []),
    ...(conflictSentences.length === 0 ? ["主要衝突未明確，需要創作者確認。"] : []),
  ];

  return {
    primaryProtagonist: fact(primary?.name ?? null, primaryRefs, primaryRefs.length ? null : "無明確出場證據"),
    secondaryProtagonists: fact(namedCharacters.slice(1).map((character) => character.name), namedCharacters.slice(1).flatMap((character) => findCharacterEvidence(input, character.name))),
    antagonisticForces: fact(conflictSentences.slice(0, 3), conflictSentences.flatMap((value) => locateExcerpt(input, value))),
    characterGoals: fact(Object.fromEntries(input.characters.filter((character) => character.goal).map((character) => [character.name, character.goal!])), primaryRefs),
    characterObstacles: fact(primary ? { [primary.name]: conflictSentences.slice(0, 3) } : {}, conflictSentences.flatMap((value) => locateExcerpt(input, value))),
    stakes: fact(conflictSentences, conflictSentences.flatMap((value) => locateExcerpt(input, value))),
    majorEvents: fact(eventSentences, eventSentences.flatMap((value) => locateExcerpt(input, value))),
    reversibleEvents: fact(reversible, reversible.flatMap((value) => locateExcerpt(input, value))),
    irreversibleEvents: fact(irreversible, irreversible.flatMap((value) => locateExcerpt(input, value))),
    foreshadowing: fact(input.storyBible.foreshadowing, firstRefs, input.storyBible.foreshadowing.length ? null : "尚無伏筆資料"),
    unresolvedQuestions: fact(input.storyBible.unresolvedThreads, firstRefs, input.storyBible.unresolvedThreads.length ? null : "尚無未解線索"),
    worldConstraints: fact(input.worldRules.map((rule) => `${rule.title}：${rule.description}`), firstRefs),
    timelineConstraints: fact(input.timeline.map((event) => `${event.storyTime ?? "時間未定"}：${event.title}`), firstRefs),
    adaptationRisks: risks,
  };
}

export function assertEvidenceSpans(input: DramaProjectionInput, references: DramaSourceReference[]): void {
  for (const reference of references) {
    const chapter = input.chapters.find((value) => value.id === reference.chapterId);
    const actual = chapter?.content.slice(reference.textStart, reference.textEnd);
    if (!chapter || actual !== reference.excerpt) {
      throw new DramaOsError("DRAMA_EVIDENCE_INVALID", `短劇候選引用的原文證據無法驗證：${reference.chapterId}:${reference.textStart}-${reference.textEnd}`);
    }
  }
}

import { estimateBrowserTokens } from "./browser-performance-policy";
import {
  CLOSED_OUTPUT_PINNED_SPECIAL_TOKENS,
  CLOSED_OUTPUT_PINNED_SPECIAL_TOKENS_SOURCE_REVISION,
  closedOutputSafetyCode,
  type ClosedOutputSafetyCode,
} from "../../security/closed-output-safety";

export const BROWSER_PROSE_MINIMUM_HAN_CHARACTERS = 220;
export const BROWSER_PROSE_MAXIMUM_HAN_CHARACTERS = 320;
export const BROWSER_PROSE_CONTINUATION_ANCHOR_CHARACTERS = 24;
export const BROWSER_PROSE_MINIMUM_CONTINUATION_BASE_HAN_CHARACTERS = 48;
export const BROWSER_PROSE_MAXIMUM_ESTIMATED_TOKENS = 384;
export const BROWSER_PROSE_MAXIMUM_CODE_POINTS = 640;

export type BrowserProseSafetyCode = ClosedOutputSafetyCode;

export const BROWSER_WEBLLM_PINNED_SPECIAL_TOKENS_SOURCE_REVISION =
  CLOSED_OUTPUT_PINNED_SPECIAL_TOKENS_SOURCE_REVISION;
export const BROWSER_WEBLLM_PINNED_SPECIAL_TOKENS =
  CLOSED_OUTPUT_PINNED_SPECIAL_TOKENS;

function normalizedOutput(value: string) {
  return value.replace(/\r\n?/gu, "\n").trim();
}

function continuationAnchor(value: string) {
  return Array.from(normalizedOutput(value).replace(/\s+/gu, " "))
    .slice(-BROWSER_PROSE_CONTINUATION_ANCHOR_CHARACTERS)
    .join("")
    .trim();
}

function continuationPromptAnchor(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

function similarityText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-Hant")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function characterTrigrams(value: string) {
  const characters = Array.from(similarityText(value));
  const grams = new Set<string>();
  for (let index = 0; index <= characters.length - 3; index += 1) {
    grams.add(characters.slice(index, index + 3).join(""));
  }
  return grams;
}

function trigramSimilarity(left: string, right: string) {
  const leftGrams = characterTrigrams(left);
  const rightGrams = characterTrigrams(right);
  if (!leftGrams.size || !rightGrams.size) return 0;
  let intersection = 0;
  for (const gram of leftGrams) if (rightGrams.has(gram)) intersection += 1;
  return intersection / (leftGrams.size + rightGrams.size - intersection);
}

function containsRepeatedBaseWindow(base: string, suffix: string, windowSize = 16) {
  const normalizedBase = similarityText(base);
  const normalizedSuffix = similarityText(suffix);
  const characters = Array.from(normalizedSuffix);
  if (characters.length < windowSize) return false;
  for (let index = 0; index <= characters.length - windowSize; index += 1) {
    if (normalizedBase.includes(characters.slice(index, index + windowSize).join(""))) {
      return true;
    }
  }
  return false;
}

const PROSE_DELIMITER_PAIRS = new Map<string, string>([
  ["「", "」"],
  ["『", "』"],
  ["“", "”"],
  ["‘", "’"],
  ["（", "）"],
  ["【", "】"],
  ["《", "》"],
  ["〈", "〉"],
  ["〔", "〕"],
  ["［", "］"],
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
] as const);
const PROSE_DELIMITER_OPEN_BY_CLOSE = new Map<string, string>(
  [...PROSE_DELIMITER_PAIRS].map(([open, close]) => [close, open] as const),
);
const PROSE_SYMMETRIC_DELIMITERS = new Set(["\""]);

function isProseDelimiterCloser(value: string) {
  return PROSE_DELIMITER_OPEN_BY_CLOSE.has(value)
    || PROSE_SYMMETRIC_DELIMITERS.has(value);
}

function hasBalancedProseDelimiters(value: string) {
  const stack: string[] = [];
  const characters = Array.from(value);
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const previousIsWord = /[\p{L}\p{N}]/u.test(characters[index - 1] ?? "");
    const nextIsWord = /[\p{L}\p{N}]/u.test(characters[index + 1] ?? "");
    if (PROSE_SYMMETRIC_DELIMITERS.has(character)) {
      if (stack.at(-1) === character) stack.pop();
      else stack.push(character);
      continue;
    }
    if (
      (character === "‘" || character === "’")
      && previousIsWord
      && nextIsWord
    ) continue;
    if (
      character === "’"
      && stack.at(-1) !== "‘"
      && (previousIsWord || nextIsWord)
    ) continue;
    if (PROSE_DELIMITER_PAIRS.has(character)) {
      stack.push(character);
      continue;
    }
    const expectedOpen = PROSE_DELIMITER_OPEN_BY_CLOSE.get(character);
    if (expectedOpen && stack.pop() !== expectedOpen) return false;
  }
  return stack.length === 0;
}

export function browserProseSafetyCode(value: string): BrowserProseSafetyCode | null {
  return closedOutputSafetyCode(value);
}

export function countBrowserProseHanCharacters(value: string) {
  return (value.match(/\p{Script=Han}/gu) ?? []).length;
}

export function hasExplicitBrowserProseLengthRequest(value: string) {
  const normalized = value.normalize("NFKC");
  if (/\d{2,5}\s*(?:至|到|[-~～])?\s*\d{0,5}\s*(?:個)?(?:繁體中文)?字(?:左右|上下|以內|以上|以下|即可|就好|的(?:正文|故事|小說|內容|篇幅|章節|文章|場景))?(?!\p{Script=Han})/iu.test(normalized)) {
    return true;
  }
  if (/^\s*(?:約|大約)?[零〇一二兩三四五六七八九十百千萬]+\s*(?:至|到|[-~～])?\s*[零〇一二兩三四五六七八九十百千萬]*\s*(?:個)?(?:繁體中文)?字(?:左右|上下|以內|以上|以下|即可|就好)?\s*$/iu.test(normalized)) {
    return true;
  }
  return /(?:篇幅|字數|寫|輸出|至少|最少|最多|至多|約|大約|控制在|限制在)[^。！？\n]{0,12}[零〇一二兩三四五六七八九十百千萬]+\s*(?:至|到|[-~～])?\s*[零〇一二兩三四五六七八九十百千萬]*\s*(?:個)?(?:繁體中文)?字(?:左右|上下|以內|以上|以下|即可|就好|的(?:正文|故事|小說|內容|篇幅|章節|文章|場景))?(?!\p{Script=Han})/iu.test(normalized);
}

export function shouldEnforceDefaultBrowserProseContract(input: {
  taskType: string;
  authorObjective: string;
}) {
  return input.taskType === "chapter.continue"
    && !hasExplicitBrowserProseLengthRequest(input.authorObjective);
}

export function shouldRunBrowserProseExtension(input: {
  taskType: string;
  explicitLengthRequested: boolean;
  contractSatisfied: boolean;
  safetyCode: string | null;
  observedHanCharacters: number;
  finishReason: string | null | undefined;
  qualityReasonCodes: string[];
}) {
  const lengthOnly = input.qualityReasonCodes.every((reason) =>
    reason === "QUALITY_LENGTHCOMPLIANCE_LOW"
    || reason === "QUALITY_NARRATIVE_TOO_SHORT");
  return input.taskType === "chapter.continue"
    && !input.explicitLengthRequested
    && !input.contractSatisfied
    && !input.safetyCode
    && input.observedHanCharacters
      >= BROWSER_PROSE_MINIMUM_CONTINUATION_BASE_HAN_CHARACTERS
    && input.observedHanCharacters < BROWSER_PROSE_MINIMUM_HAN_CHARACTERS
    && input.finishReason === "stop"
    && lengthOnly;
}

export function assessBrowserProseCompletion(
  value: string,
  window = {
    minimumHanCharacters: BROWSER_PROSE_MINIMUM_HAN_CHARACTERS,
    maximumHanCharacters: BROWSER_PROSE_MAXIMUM_HAN_CHARACTERS,
  },
) {
  const normalized = normalizedOutput(value);
  const safetyCode = browserProseSafetyCode(normalized);
  const minimum = Math.max(1, Math.floor(window.minimumHanCharacters));
  const maximum = Math.max(minimum, Math.floor(window.maximumHanCharacters));
  const observedHanCharacters = countBrowserProseHanCharacters(normalized);
  const observedEstimatedTokens = estimateBrowserTokens(normalized);
  const observedCodePoints = Array.from(normalized).length;
  const rawBudgetExceeded =
    observedEstimatedTokens > BROWSER_PROSE_MAXIMUM_ESTIMATED_TOKENS
    || observedCodePoints > BROWSER_PROSE_MAXIMUM_CODE_POINTS;
  if (safetyCode) {
    return {
      content: null,
      salvageableContent: null,
      contractSatisfied: false,
      safetyCode,
      failureCode: null,
      rawBudgetExceeded,
      selectedHanCharacters: 0,
      selectedEstimatedTokens: 0,
      selectedCodePoints: 0,
      observedHanCharacters,
      observedEstimatedTokens,
      observedCodePoints,
      minimumHanCharacters: minimum,
      maximumHanCharacters: maximum,
    };
  }
  // Keep the default prose contract aligned with the quality gate's accepted
  // complete endings. Consume repeated ellipses and every trailing closer so
  // the selected candidate never drops a balanced quote/bracket.
  const sentenceEnd = /(?:[。！？]|…+)/gu;
  let selectedContent: string | null = null;
  let selectedHanCharacters = 0;
  let selectedEstimatedTokens = 0;
  let selectedCodePoints = 0;
  let candidateExceededBudget = false;
  for (const match of normalized.matchAll(sentenceEnd)) {
    let end = (match.index ?? 0) + match[0].length;
    while (end < normalized.length) {
      const codePoint = normalized.codePointAt(end);
      if (codePoint === undefined) break;
      const nextCharacter = String.fromCodePoint(codePoint);
      if (!isProseDelimiterCloser(nextCharacter)) break;
      end += nextCharacter.length;
    }
    const candidate = normalized.slice(0, end).trim();
    const hanCharacters = countBrowserProseHanCharacters(candidate);
    if (hanCharacters > maximum) break;
    if (hanCharacters >= minimum && hasBalancedProseDelimiters(candidate)) {
      const estimatedTokens = estimateBrowserTokens(candidate);
      const codePoints = Array.from(candidate).length;
      if (
        estimatedTokens > BROWSER_PROSE_MAXIMUM_ESTIMATED_TOKENS
        || codePoints > BROWSER_PROSE_MAXIMUM_CODE_POINTS
      ) {
        candidateExceededBudget = true;
        break;
      }
      selectedContent = candidate;
      selectedHanCharacters = hanCharacters;
      selectedEstimatedTokens = estimatedTokens;
      selectedCodePoints = codePoints;
    }
  }
  const acceptedContent = rawBudgetExceeded ? null : selectedContent;
  return {
    content: acceptedContent,
    salvageableContent: rawBudgetExceeded ? selectedContent : null,
    contractSatisfied: acceptedContent !== null,
    safetyCode: null,
    failureCode: rawBudgetExceeded || candidateExceededBudget
        ? "output-budget-exceeded"
        : acceptedContent
          ? null
          : observedHanCharacters < minimum
          ? "minimum-length-unmet"
          : "complete-sentence-unavailable",
    rawBudgetExceeded,
    selectedHanCharacters,
    selectedEstimatedTokens,
    selectedCodePoints,
    observedHanCharacters,
    observedEstimatedTokens,
    observedCodePoints,
    minimumHanCharacters: minimum,
    maximumHanCharacters: maximum,
  };
}

export function buildBrowserProseContinuationSeed(input: {
  baseContent: string;
  baseDigest: string;
}) {
  const baseContent = normalizedOutput(input.baseContent);
  if (
    browserProseSafetyCode(baseContent)
    || !/^[a-f0-9]{64}$/u.test(input.baseDigest)
    || countBrowserProseHanCharacters(baseContent) < 8
  ) return null;
  const anchor = continuationAnchor(baseContent);
  if (!anchor || anchor !== anchor.trim()) return null;
  return {
    anchor,
    baseDigest: input.baseDigest,
    baseHanCharacters: countBrowserProseHanCharacters(baseContent),
    minimumCombinedHanCharacters: BROWSER_PROSE_MINIMUM_HAN_CHARACTERS,
    maximumCombinedHanCharacters: BROWSER_PROSE_MAXIMUM_HAN_CHARACTERS,
  };
}

export function mergeBrowserProseContinuation(input: {
  baseContent: string;
  continuationContent: string;
  anchor: string;
}) {
  const baseContent = normalizedOutput(input.baseContent);
  const continuationContent = normalizedOutput(input.continuationContent);
  const safetyCode = browserProseSafetyCode(baseContent)
    ?? browserProseSafetyCode(continuationContent);
  if (safetyCode) {
    return { content: null, contractSatisfied: false, reason: safetyCode } as const;
  }
  const expectedAnchor = continuationAnchor(baseContent);
  if (input.anchor !== expectedAnchor) {
    return {
      content: null,
      contractSatisfied: false,
      reason: "seed-anchor-invalid",
    } as const;
  }
  const promptAnchor = continuationPromptAnchor(input.anchor);
  if (!input.anchor || !continuationContent) {
    return {
      content: null,
      contractSatisfied: false,
      reason: "suffix-empty",
    } as const;
  }
  const suffix = continuationContent;
  if (suffix.includes(input.anchor) || suffix.includes(promptAnchor)) {
    return {
      content: null,
      contractSatisfied: false,
      reason: "anchor-repeated",
    } as const;
  }
  const normalizedBase = similarityText(baseContent);
  const normalizedSuffix = similarityText(suffix);
  const basePrefix = normalizedBase.slice(0, Math.min(24, normalizedBase.length));
  if (
    (basePrefix.length >= 12 && normalizedSuffix.includes(basePrefix))
    || containsRepeatedBaseWindow(baseContent, suffix)
    || trigramSimilarity(baseContent, suffix) >= 0.72
  ) {
    return {
      content: null,
      contractSatisfied: false,
      reason: "base-repeated",
    } as const;
  }
  const completion = assessBrowserProseCompletion(`${baseContent}${suffix}`);
  if (!completion.contractSatisfied || !completion.content) {
    return {
      content: null,
      contractSatisfied: false,
      reason: completion.safetyCode
        ?? (completion.failureCode === "output-budget-exceeded"
          ? "output-budget-exceeded"
          : "combined-contract-unsatisfied"),
      observedHanCharacters: completion.observedHanCharacters,
    } as const;
  }
  return {
    content: completion.content,
    contractSatisfied: true,
    reason: null,
    selectedHanCharacters: completion.selectedHanCharacters,
  } as const;
}

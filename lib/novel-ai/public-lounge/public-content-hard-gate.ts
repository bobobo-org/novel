import type { PublicLoungeOfficialChapterInput } from "./types";

export const PUBLIC_LOUNGE_MINIMUM_LONG_FORM_CHARACTERS = 8_000;
export const PUBLIC_LOUNGE_MINIMUM_SHORT_FORM_CHAPTERS = 3;
export const PUBLIC_LOUNGE_MINIMUM_SHORT_FORM_CHARACTERS = 1_500;
export const PUBLIC_LOUNGE_MINIMUM_PUBLIC_CHAPTER_CHARACTERS = 20;

export type PublicLoungePublicContentGateCode =
  | "work_too_short"
  | "public_chapter_missing"
  | "public_chapter_too_short"
  | "public_chapter_count_mismatch"
  | "public_word_count_mismatch"
  | "public_chapter_duplicate"
  | "hidden_draft_residue"
  | "private_payload_residue"
  | "interactive_fragment_residue";

export type PublicLoungePublicContentGateResult = Readonly<{
  passed: boolean;
  reasons: readonly PublicLoungePublicContentGateCode[];
}>;

const HIDDEN_DRAFT_RESIDUE = /(?:hidden[_ -]?draft|pending[_ -]?chapter|候選草稿|未核准候選|方案\s*[ABCＡＢＣ一二三1-3]\s*[:：])/iu;
const PRIVATE_PAYLOAD_RESIDUE = /(?:model[_ -]?receipt|(?:completion[_ -]?fingerprint|model[_ -]?(?:digest|fingerprint))\s*[:=：]\s*[a-f0-9_-]{16,}|private[_ -]?canon|prompt[_ -]?payload|trace[_ -]?(?:id|payload)|外送\s*receipt|評鑑\s*receipt|(?:system[_ -]?prompt|story[_ -]?bible|canon)\s*[:=：]\s*[\[{"'])/iu;
const INTERACTIVE_FRAGMENT_RESIDUE = /(?:NEXT\s*TURN|下一步選擇|請選擇\s*[ABCＡＢＣ]|尚未選擇候選|等待核准候選)/iu;

function normalizedBody(value: string) {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function nonWhitespaceCharacters(value: string) {
  return value.replace(/\s/gu, "").length;
}

/**
 * A deterministic, server-repeatable public payload gate. It is deliberately
 * narrower than the closed-AI literary/safety review: this gate catches
 * publication packaging failures and private workflow residue, but never
 * claims to understand the whole novel or replace a model review.
 */
export function evaluatePublicLoungePublicContentGate(input: {
  chapterCount: number;
  wordCount: number;
  publicChapters: readonly PublicLoungeOfficialChapterInput[];
  fullSynopsis: string;
}): PublicLoungePublicContentGateResult {
  const reasons = new Set<PublicLoungePublicContentGateCode>();
  if (input.publicChapters.length < 1) reasons.add("public_chapter_missing");

  const bodies = input.publicChapters.map((chapter) => normalizedBody(chapter.body));
  const bodyCharacterCounts = input.publicChapters.map((chapter) => nonWhitespaceCharacters(chapter.body));
  const publicBodyCharacters = bodyCharacterCounts.reduce((total, count) => total + count, 0);
  if (bodyCharacterCounts.some((count) => count < PUBLIC_LOUNGE_MINIMUM_PUBLIC_CHAPTER_CHARACTERS)) {
    reasons.add("public_chapter_too_short");
  }
  if (input.publicChapters.length > input.chapterCount) reasons.add("public_chapter_count_mismatch");
  if (publicBodyCharacters > input.wordCount) reasons.add("public_word_count_mismatch");

  const longFormEligible = input.wordCount >= PUBLIC_LOUNGE_MINIMUM_LONG_FORM_CHARACTERS;
  const completeShortFormCoverage = input.chapterCount >= PUBLIC_LOUNGE_MINIMUM_SHORT_FORM_CHAPTERS
    && input.publicChapters.length === input.chapterCount;
  if (!longFormEligible && completeShortFormCoverage && input.wordCount !== publicBodyCharacters) {
    reasons.add("public_word_count_mismatch");
  }
  const shortFormEligible = completeShortFormCoverage
    && publicBodyCharacters >= PUBLIC_LOUNGE_MINIMUM_SHORT_FORM_CHARACTERS
    && input.wordCount === publicBodyCharacters;
  if (!longFormEligible && !shortFormEligible) reasons.add("work_too_short");

  if (new Set(bodies).size !== bodies.length) reasons.add("public_chapter_duplicate");

  const publicText = [
    input.fullSynopsis,
    ...input.publicChapters.flatMap((chapter) => [chapter.title, chapter.body]),
  ].join("\n");
  if (HIDDEN_DRAFT_RESIDUE.test(publicText)) reasons.add("hidden_draft_residue");
  if (PRIVATE_PAYLOAD_RESIDUE.test(publicText)) reasons.add("private_payload_residue");
  if (INTERACTIVE_FRAGMENT_RESIDUE.test(publicText)) reasons.add("interactive_fragment_residue");

  const ordered = [...reasons].sort();
  return Object.freeze({ passed: ordered.length === 0, reasons: Object.freeze(ordered) });
}

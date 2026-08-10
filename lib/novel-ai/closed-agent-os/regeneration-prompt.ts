import type { ClosedAIRegenerationContract } from "./types";

export function closedAIRegenerationPromptContext(
  regeneration: ClosedAIRegenerationContract | undefined,
) {
  if (!regeneration) return [];
  const direction = regeneration.direction
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 600);
  return [
    [
      "[EXPLICIT_REGENERATION_BOUNDARY]",
      `direction=${direction}`,
      `previousCandidateDigest=${regeneration.previousCandidateDigest}`,
      `regenerationAttempt=${regeneration.regenerationAttempt}`,
      "Generate a materially distinct candidate. Do not reuse, paraphrase, or lightly punctuate the previous candidate.",
      "Return a candidate only; do not mutate Canon.",
    ].join("\n"),
  ];
}

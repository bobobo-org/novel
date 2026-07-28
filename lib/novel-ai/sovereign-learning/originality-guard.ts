import { fingerprintOverlap } from "./hashing";
import type { SovereignLearningRepository } from "./repository";

export const LEARNING_ORIGINALITY_GUARD_VERSION = "closed-ai-originality-guard-v1" as const;

export async function evaluateLearningOriginality(input: {
  repository: SovereignLearningRepository;
  projectId: string;
  output: string;
}) {
  const sources = (await input.repository.listSources(input.projectId))
    .filter((source) => source.status === "active");
  const comparisons = sources.map((source) => {
    const result = fingerprintOverlap(input.output, source.fingerprint);
    return {
      sourceId: source.id,
      title: source.title,
      overlapScore: result.score,
      matchedShingles: result.matchedShingles,
      testedShingles: result.testedShingles,
    };
  }).sort((left, right) =>
    right.overlapScore - left.overlapScore
    || right.matchedShingles - left.matchedShingles);
  const highest = comparisons[0] ?? null;
  const blocked = Boolean(
    highest
    && (
      (highest.overlapScore >= 0.28 && highest.matchedShingles >= 2)
      || (highest.overlapScore >= 0.12 && highest.matchedShingles >= 4)
    ),
  );
  return {
    schemaVersion: LEARNING_ORIGINALITY_GUARD_VERSION,
    passed: !blocked,
    risk: blocked
      ? "high"
      : highest && highest.overlapScore >= 0.08
        ? "review"
        : "low",
    highest,
    comparisons,
    rawSourceContentRead: false,
    dataLeftDevice: false,
    externalRequestCount: 0,
    errorCode: blocked ? "LEARNING_OUTPUT_SOURCE_OVERLAP_BLOCKED" : null,
  };
}

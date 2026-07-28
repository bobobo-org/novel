import { makeDramaRecord } from "./record-factory";
import type { DramaEpisode, DramaEvaluation, DramaProjectionInput, NarrativeAnalysis } from "./types";

export function evaluateDramaProject(
  input: DramaProjectionInput,
  dramaProjectId: string,
  episodes: DramaEpisode[],
  analysis: NarrativeAnalysis,
): DramaEvaluation {
  const record = makeDramaRecord(input.storyId, input.providerId, input.requestId);
  const blocking = episodes.flatMap((episode) => episode.continuityConstraints).filter((constraint) => constraint.severity === "blocking");
  const issues = [
    ...blocking.map((constraint) => ({
      code: "DRAMA_CONTINUITY_BLOCKING",
      severity: "blocking" as const,
      message: constraint.description,
      entityId: dramaProjectId,
      sourceReferences: analysis.primaryProtagonist.sourceReferences,
    })),
    ...analysis.adaptationRisks.map((risk) => ({
      code: "DRAMA_ADAPTATION_RISK",
      severity: "warning" as const,
      message: risk,
      entityId: dramaProjectId,
      sourceReferences: [],
    })),
  ];
  const hookScore = episodes.every((episode) => episode.openingHook.deadlineSeconds <= 10) ? 95 : 70;
  const pacingScore = episodes.every((episode) => episode.beatIds.length >= 4) ? 90 : 65;
  const continuityScore = blocking.length === 0 ? 100 : Math.max(0, 100 - blocking.length * 35);
  const emotionScore = episodes.every((episode) => episode.emotionCurve.length >= 4) ? 90 : 70;
  const score = Math.round((hookScore + pacingScore + continuityScore + emotionScore) / 4);
  return {
    ...record,
    id: record.id,
    evaluationId: record.id,
    dramaProjectId,
    sourceRevision: input.sourceRevision,
    score,
    hookScore,
    pacingScore,
    continuityScore,
    emotionScore,
    issues,
    blockingIssueCount: blocking.length,
    status: blocking.length ? "blocked" : issues.length ? "needs_review" : "passed",
  };
}

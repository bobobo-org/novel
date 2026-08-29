import { makeDramaRecord } from "./record-factory";
import { getDramaFormatProfile } from "./format-profiles";
import type { DramaBeat, DramaEpisode, DramaEvaluation, DramaProjectionInput, NarrativeAnalysis } from "./types";

export function evaluateDramaProject(
  input: DramaProjectionInput,
  dramaProjectId: string,
  episodes: DramaEpisode[],
  beats: DramaBeat[],
  analysis: NarrativeAnalysis,
): DramaEvaluation {
  const record = makeDramaRecord(input.storyId, input.providerId, input.requestId);
  const blocking = episodes.flatMap((episode) => episode.continuityConstraints).filter((constraint) => constraint.severity === "blocking");
  const payoffFailures = episodes.flatMap((episode) => {
    const episodeBeats = beats.filter((beat) => beat.episodeId === episode.episodeId);
    const profile = getDramaFormatProfile(input.formatProfile);
    const payoffIndexes = episodeBeats
      .map((beat, index) => beat.beatType === "PAYOFF" ? index : -1)
      .filter((index) => index >= 0);
    const cliffhangerIndex = episodeBeats.findIndex((beat) => beat.beatType === "CLIFFHANGER");
    const failures: Array<{ code: string; message: string }> = [];
    if (payoffIndexes.length < profile.minimumPayoffCount) {
      failures.push({
        code: "DRAMA_PAYOFF_MISSING",
        message: `單集 ${episode.episodeId} 只有 ${payoffIndexes.length} 個 Payoff，低於格式要求 ${profile.minimumPayoffCount} 個。`,
      });
    }
    if (cliffhangerIndex >= 0 && payoffIndexes.some((index) => index >= cliffhangerIndex)) {
      failures.push({
        code: "DRAMA_PAYOFF_AFTER_CLIFFHANGER",
        message: `單集 ${episode.episodeId} 的 Payoff 未在結尾懸念前落地。`,
      });
    }
    return failures;
  });
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
    ...payoffFailures.map((failure) => ({
      ...failure,
      severity: "blocking" as const,
      entityId: dramaProjectId,
      sourceReferences: [],
    })),
  ];
  const hookScore = episodes.every((episode) => episode.openingHook.deadlineSeconds <= 10) ? 95 : 70;
  const pacingScore = episodes.every((episode) => episode.beatIds.length >= 4) && payoffFailures.length === 0 ? 90 : 55;
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
    blockingIssueCount: blocking.length + payoffFailures.length,
    status: blocking.length || payoffFailures.length ? "blocked" : issues.length ? "needs_review" : "passed",
  };
}

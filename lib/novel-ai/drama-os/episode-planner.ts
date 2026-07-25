import { buildBeatSheet } from "./beat-sheet-builder";
import { buildCliffhanger } from "./cliffhanger-engine";
import { buildContinuityConstraints } from "./continuity-bridge";
import { buildEmotionCurve } from "./emotion-curve-engine";
import { getDramaFormatProfile } from "./format-profiles";
import { buildOpeningHook } from "./hook-engine";
import { makeDramaRecord } from "./record-factory";
import type {
  DramaBeat,
  DramaEpisode,
  DramaPayoff,
  DramaProjectionInput,
  NarrativeAnalysis,
} from "./types";

function recommendedEpisodeCount(input: DramaProjectionInput): number {
  const profile = getDramaFormatProfile(input.formatProfile);
  const byDuration = profile.targetDurationSeconds <= 180
    ? 1
    : profile.targetDurationSeconds <= 600
      ? 2
      : profile.targetDurationSeconds <= 1800
        ? 4
        : 8;
  return Math.min(input.resourceBudget?.maxEpisodes ?? 12, Math.max(1, Math.min(byDuration, input.chapters.length * 2)));
}

function buildPayoff(analysis: NarrativeAnalysis, beats: DramaBeat[]): DramaPayoff {
  const source = analysis.majorEvents.value?.[0] ?? "角色面對核心衝突";
  const payoffBeat = beats.find((beat) => beat.beatType === "PAYOFF") ?? beats.at(-2) ?? beats.at(-1)!;
  return {
    type: analysis.irreversibleEvents.value?.length ? "TRUTH_REVEAL" : "STRATEGIC_VICTORY",
    setup: `先建立「${source}」的代價。`,
    pressure: payoffBeat.pressure,
    trigger: payoffBeat.trigger,
    payoff: payoffBeat.payoff,
    consequence: payoffBeat.consequence,
    futureHook: payoffBeat.futureHook,
  };
}

export function planEpisodes(
  input: DramaProjectionInput,
  seasonId: string,
  analysis: NarrativeAnalysis,
): { episodes: DramaEpisode[]; beats: DramaBeat[] } {
  const profile = getDramaFormatProfile(input.formatProfile);
  const episodeCount = recommendedEpisodeCount(input);
  const allBeats: DramaBeat[] = [];
  const episodes = Array.from({ length: episodeCount }, (_, index) => {
    const record = makeDramaRecord(input.storyId, input.providerId, input.requestId);
    const sourceChapter = input.chapters[index % input.chapters.length];
    const beats = buildBeatSheet(input, analysis, profile, record.id);
    allBeats.push(...beats);
    const continuityConstraints = buildContinuityConstraints(input, analysis);
    return {
      ...record,
      id: record.id,
      episodeId: record.id,
      seasonId,
      storyId: input.storyId,
      sourceRevision: input.sourceRevision,
      sourceChapterIds: [sourceChapter.id],
      episodeNumber: index + 1,
      formatProfile: profile.id,
      estimatedDurationSeconds: profile.targetDurationSeconds,
      openingHook: buildOpeningHook(analysis, profile),
      episodeGoal: analysis.characterGoals.value && Object.values(analysis.characterGoals.value)[0]
        ? Object.values(analysis.characterGoals.value)[0]
        : `讓${analysis.primaryProtagonist.value ?? "主角"}對核心事件採取行動。`,
      majorConflict: analysis.stakes.value?.[index % Math.max(1, analysis.stakes.value.length)] ?? "選擇與代價逐步升高。",
      beatIds: beats.map((beat) => beat.beatId),
      sceneIds: [],
      emotionCurve: buildEmotionCurve(beats, analysis, input),
      turningPoint: analysis.majorEvents.value?.[index % Math.max(1, analysis.majorEvents.value.length)] ?? "新的資訊改變原先判斷。",
      payoff: buildPayoff(analysis, beats),
      cliffhanger: buildCliffhanger(analysis, beats),
      sourceReferences: analysis.majorEvents.sourceReferences,
      continuityConstraints,
      status: input.mode === "private_simulation" ? "private_simulation" : "awaiting_approval",
    } satisfies DramaEpisode;
  });
  return { episodes, beats: allBeats };
}

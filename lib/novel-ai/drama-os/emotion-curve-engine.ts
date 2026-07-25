import type { DramaBeat, DramaProjectionInput, EmotionPoint, NarrativeAnalysis } from "./types";

export function buildEmotionCurve(beats: DramaBeat[], analysis: NarrativeAnalysis, input?: DramaProjectionInput): EmotionPoint[] {
  const protagonist = input?.characters.find((character) => character.name === analysis.primaryProtagonist.value)?.id ?? null;
  return beats.map((beat, index) => ({
    timestampRatio: Number((index / Math.max(1, beats.length - 1)).toFixed(3)),
    emotion: beat.beatType === "PAYOFF" ? "釋放" : beat.beatType === "CLIFFHANGER" ? "震驚" : index < beats.length / 2 ? "壓迫" : "決心",
    intensity: beat.intensity,
    characterId: protagonist,
    causeBeatId: beat.beatId,
  }));
}

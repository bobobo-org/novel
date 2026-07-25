import type { CliffhangerType, DramaBeat, NarrativeAnalysis } from "./types";

export function buildCliffhanger(analysis: NarrativeAnalysis, beats: DramaBeat[]): {
  type: CliffhangerType;
  text: string;
  sourceBeatId: string;
} {
  const sourceBeat = beats.at(-1)!;
  const question = analysis.unresolvedQuestions.value?.[0];
  return {
    type: question ? "UNANSWERED_REVELATION" : "IMPOSSIBLE_CHOICE",
    text: question ? `答案即將揭露：${question}` : "主角必須在兩個都會付出代價的選項間立即決定。",
    sourceBeatId: sourceBeat.beatId,
  };
}

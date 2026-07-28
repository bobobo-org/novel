import type { CandidateIntent } from "../generation-loop/types";
import type { StoryContext } from "../story-intelligence";

export function generatePlotHypothesis(intent: CandidateIntent, context: StoryContext) {
  const labels = {
    steady_continuation: "延續既有因果，讓角色主動處理最近的未解問題。",
    conflict_escalation: "提高既有衝突的代價，但不新增無來源規則。",
    unexpected_turn: "使用已存在的伏筆形成轉折，而非憑空加入解答。",
  };
  return {
    intent,
    hypothesis: labels[intent],
    supportingMemoryIds: [
      ...context.currentScene,
      ...context.plotContext,
      ...context.foreshadowingContext,
    ].slice(0, 8).map((row) => row.memoryId),
  };
}

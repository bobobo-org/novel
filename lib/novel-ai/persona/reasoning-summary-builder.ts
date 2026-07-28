import type { StoryContext } from "../story-intelligence";
import type { ReasoningSummaryInput } from "./reasoning-output-formatter";

export function buildReasoningSummary(input: {
  objective: string;
  plan: string[];
  context: StoryContext;
  risks: string[];
  confidence: { level: string; uncertaintyRequired: boolean };
}): ReasoningSummaryInput {
  const used = [
    ...input.context.characterContext.map((row) => row.text.slice(0, 80)),
    ...input.context.worldContext.map((row) => row.text.slice(0, 80)),
    ...input.context.plotContext.map((row) => row.text.slice(0, 80)),
    ...input.context.foreshadowingContext.map((row) => row.text.slice(0, 80)),
  ];
  return {
    understanding: input.objective,
    mainPlan: input.plan,
    usedSettings: used,
    keyRisks: input.risks,
    recommendationReason: "候選依目前章節、可追溯作品設定與一致性檢查結果排序。",
    uncertainties: input.confidence.uncertaintyRequired ? [`目前信心等級：${input.confidence.level}`] : [],
  };
}

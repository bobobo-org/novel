import type { ReversalPlan } from "./viral-story-types";
export function detectShockWithoutConsequence(reversal: ReversalPlan) {
  return !reversal.consequence || reversal.consequence.length < 12;
}

import type { ViralTrope } from "./viral-story-types";
export function detectTropeFatigue(tropes: ViralTrope[]) {
  return tropes.length > 6 || tropes.reduce((sum, trope) => sum + trope.fatigueWeight, 0) > 18;
}

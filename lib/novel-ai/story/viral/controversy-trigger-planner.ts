import type { TropeMixResult } from "./viral-story-types";
export function planControversyTriggers(mix: TropeMixResult) {
  return mix.selectedTropes.filter((trope) => trope.controversyWeight >= 3).map((trope) => `${trope.displayName} needs visible consequence`);
}

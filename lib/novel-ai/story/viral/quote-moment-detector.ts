import type { ViralHookSet } from "./viral-story-types";
export function detectQuoteMoments(hooks: ViralHookSet) {
  return hooks.quoteCandidates;
}

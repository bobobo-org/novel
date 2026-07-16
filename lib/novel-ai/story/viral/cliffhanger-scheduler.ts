import type { ViralHookSet } from "./viral-story-types";
export function scheduleCliffhangers(hooks: ViralHookSet) {
  return [hooks.endCliffhanger, hooks.nextEpisodeHook].filter(Boolean);
}

import type { ViralHookSet } from "./viral-story-types";
export function detectScreenshotMoments(hooks: ViralHookSet) {
  return [hooks.screenshotMoment, hooks.argumentTrigger].filter(Boolean);
}

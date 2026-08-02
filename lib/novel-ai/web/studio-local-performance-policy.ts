import type { BrowserComputePolicy } from "../router/platform-types";

export type StudioTaskPerformanceProfile = {
  targetLength: number;
  maxTokens: number;
  timeoutMs: number;
  qualityMode: "fast" | "balanced" | "deep";
};

/**
 * Balanced Studio work performs both a draft and a revision pass. Keep each
 * explicit Local Ollama pass inside the Local Bridge deadline instead of
 * allowing one oversized request to time out after the author has waited.
 */
export function adaptStudioProfileForExplicitLocalCompute<
  T extends StudioTaskPerformanceProfile,
>(
  profile: T,
  options: {
    browserComputePolicy: BrowserComputePolicy;
    externalSelected: boolean;
  },
): T {
  if (
    options.browserComputePolicy !== "quality-first"
    || options.externalSelected
  ) {
    return profile;
  }

  const fast = profile.qualityMode === "fast";
  const deep = profile.qualityMode === "deep";
  return {
    ...profile,
    targetLength: Math.min(profile.targetLength, fast ? 420 : 480),
    maxTokens: Math.min(profile.maxTokens, fast ? 160 : deep ? 256 : 192),
    timeoutMs: Math.max(
      profile.timeoutMs,
      fast ? 150_000 : deep ? 370_000 : 250_000,
    ),
  };
}

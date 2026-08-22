import type { BrowserComputePolicy } from "../router/platform-types";

export const STUDIO_AI_SETTINGS_KEY = "novel_p2_ai_settings";
export const STUDIO_AUTOMATIC_CLOSED_COMPUTE_POLICY = "balanced" as const;

/**
 * Studio exposes one Closed AI automatic coordinator. The coordinator may use
 * Browser AI, Local Ollama or Private Hub according to the task and verified
 * runtime availability; authors no longer choose a compute backend per task.
 */
export type StudioClosedComputePolicy = typeof STUDIO_AUTOMATIC_CLOSED_COMPUTE_POLICY;

type SettingsStorage = Pick<Storage, "getItem">;

export function normalizeStudioClosedComputePolicy(
  _value: unknown,
): StudioClosedComputePolicy {
  void _value;
  return STUDIO_AUTOMATIC_CLOSED_COMPUTE_POLICY;
}

export function readStudioClosedComputePolicy(
  _storage?: SettingsStorage | null,
): StudioClosedComputePolicy {
  void _storage;
  // Deliberately ignore legacy browser-first / quality-first localStorage.
  // A stale browser preference must never override the current coordinator.
  return STUDIO_AUTOMATIC_CLOSED_COMPUTE_POLICY;
}

export function resolveStudioClosedComputePolicy(
  _explicitPolicy?: BrowserComputePolicy,
): BrowserComputePolicy {
  void _explicitPolicy;
  return STUDIO_AUTOMATIC_CLOSED_COMPUTE_POLICY;
}

export function hasExplicitLocalComputeAuthorization(
  policy: BrowserComputePolicy,
) {
  return policy === "quality-first" || policy === "balanced";
}

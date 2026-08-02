import type { BrowserComputePolicy } from "../router/platform-types";

export const STUDIO_AI_SETTINGS_KEY = "novel_p2_ai_settings";

export type StudioClosedComputePolicy = Extract<
  BrowserComputePolicy,
  "browser-first" | "quality-first"
>;

type SettingsStorage = Pick<Storage, "getItem">;

export function normalizeStudioClosedComputePolicy(
  value: unknown,
): StudioClosedComputePolicy {
  return value === "quality-first" ? "quality-first" : "browser-first";
}

export function readStudioClosedComputePolicy(
  storage?: SettingsStorage | null,
): StudioClosedComputePolicy {
  const availableStorage = storage ?? (
    typeof window !== "undefined" ? window.localStorage : null
  );
  if (!availableStorage) return "browser-first";
  try {
    const saved = JSON.parse(
      availableStorage.getItem(STUDIO_AI_SETTINGS_KEY) || "null",
    ) as { closedComputePolicy?: unknown } | null;
    return normalizeStudioClosedComputePolicy(saved?.closedComputePolicy);
  } catch {
    return "browser-first";
  }
}

export function resolveStudioClosedComputePolicy(
  explicitPolicy?: BrowserComputePolicy,
): BrowserComputePolicy {
  return explicitPolicy ?? readStudioClosedComputePolicy();
}

export function hasExplicitLocalComputeAuthorization(
  policy: BrowserComputePolicy,
) {
  return policy === "quality-first" || policy === "balanced";
}

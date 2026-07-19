export type FeatureFlag = "browserAIRuntime" | "privateAIHubRuntime" | "advancedImport" | "legacyMigration" | "gameEffects" | "experimentalLongContext";
export type FeatureFlagState = "disabled" | "internal" | "preview" | "enabled";
const defaults: Record<FeatureFlag, FeatureFlagState> = { browserAIRuntime: "disabled", privateAIHubRuntime: "disabled", advancedImport: "enabled", legacyMigration: "preview", gameEffects: "preview", experimentalLongContext: "preview" };
export function featureFlags(): Record<FeatureFlag, FeatureFlagState> {
  const raw = process.env.NOVEL_FEATURE_FLAGS;
  if (!raw) return { ...defaults };
  try {
    const parsed = JSON.parse(raw) as Partial<Record<FeatureFlag, FeatureFlagState>>;
    const result = { ...defaults };
    for (const [key, value] of Object.entries(parsed)) {
      if (key in defaults && ["disabled", "internal", "preview", "enabled"].includes(String(value))) result[key as FeatureFlag] = value as FeatureFlagState;
    }
    return result;
  } catch {
    // A malformed deployment variable must not make the consumer workspace unavailable.
    return { ...defaults };
  }
}
export function isFeatureEnabled(flag: FeatureFlag) { return featureFlags()[flag] === "enabled"; }

import crypto from "node:crypto";

export const PREFERENCE_PIPELINE_VERSION = "p23-preference-learning-v1" as const;
export type PreferenceMethod = "dpo" | "orpo" | "kto";

export type PreferencePair = {
  pairId: string;
  promptHash: string;
  preferred: string;
  rejected: string;
  reason: string;
  category: "accepted_rejected" | "original_user_edit" | "consistent_inconsistent" | "style" | "adult_policy";
  adultMode: boolean;
  approved: boolean;
};

export function createPreferencePair(input: Omit<PreferencePair, "pairId" | "promptHash"> & { prompt: string }) {
  if (input.preferred.trim() === input.rejected.trim()) throw Object.assign(new Error("偏好樣本兩側不可相同。"), { code: "PREFERENCE_PAIR_IDENTICAL" });
  const promptHash = crypto.createHash("sha256").update(input.prompt).digest("hex");
  return {
    pairId: `preference_${crypto.createHash("sha256").update(`${promptHash}|${input.preferred}|${input.rejected}`).digest("hex").slice(0, 24)}`,
    promptHash,
    preferred: input.preferred,
    rejected: input.rejected,
    reason: input.reason,
    category: input.category,
    adultMode: input.adultMode,
    approved: input.approved,
  } satisfies PreferencePair;
}

export function validatePreferenceDataset(pairs: PreferencePair[], method: PreferenceMethod, minimumPairs = 20) {
  const approved = pairs.filter((pair) => pair.approved);
  const adultModes = new Set(approved.map((pair) => pair.adultMode));
  const categories = new Set(approved.map((pair) => pair.category));
  return {
    method,
    valid: approved.length >= minimumPairs && adultModes.size <= 1 && categories.size >= 2,
    approvedPairs: approved.length,
    balancedCategories: categories.size,
    adultNamespaceMixed: adultModes.size > 1,
    errorCode: approved.length < minimumPairs ? "PREFERENCE_DATA_INSUFFICIENT" : adultModes.size > 1 ? "PREFERENCE_ADULT_NAMESPACE_MIXED" : categories.size < 2 ? "PREFERENCE_DATA_UNBALANCED" : null,
  };
}

export const REWARD_SCHEMA_VERSION = "p23-reward-v1" as const;

export type RewardWeights = {
  continuityReward: number;
  characterConsistencyReward: number;
  timelineReward: number;
  worldRuleReward: number;
  plotCoherenceReward: number;
  styleReward: number;
  repetitionPenalty: number;
  hallucinationPenalty: number;
  citationReward: number;
  userPreferenceReward: number;
};

export function validateRewardWeights(weights: RewardWeights) {
  const values = Object.values(weights);
  const valid = values.every((value) => Number.isFinite(value) && value >= -10 && value <= 10)
    && weights.hallucinationPenalty <= 0
    && weights.repetitionPenalty <= 0;
  return { valid, errorCode: valid ? null : "REWARD_WEIGHTS_INVALID" };
}

export function computeOfflineReward(input: {
  weights: RewardWeights;
  metrics: Record<keyof RewardWeights, number>;
}) {
  const validation = validateRewardWeights(input.weights);
  if (!validation.valid) throw Object.assign(new Error("Reward 權重無效。"), validation);
  const components = Object.fromEntries(Object.entries(input.weights).map(([key, weight]) => [key, weight * (input.metrics[key as keyof RewardWeights] ?? 0)])) as Record<keyof RewardWeights, number>;
  return {
    schemaVersion: REWARD_SCHEMA_VERSION,
    components,
    total: Object.values(components).reduce((sum, value) => sum + value, 0),
    offlineSimulationOnly: true,
  };
}

export function detectRewardHacking(input: { reward: number; deterministicPassRate: number; humanPreferenceRate: number }) {
  const suspected = input.reward > 80 && (input.deterministicPassRate < 0.7 || input.humanPreferenceRate < 0.55);
  return { suspected, errorCode: suspected ? "REWARD_HACKING_SUSPECTED" : null };
}

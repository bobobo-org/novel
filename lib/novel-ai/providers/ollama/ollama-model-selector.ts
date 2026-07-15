import type { LocalHardwareReport } from "../../../../local-runtime/hardware-profile";
import type { OllamaModelProfile } from "./ollama-capabilities";
import { buildOllamaModelPolicy, scoreOllamaModel } from "./ollama-model-policy";

export type OllamaModelSelection = {
  status: "no_models" | "selected";
  primaryModel?: OllamaModelProfile;
  secondaryModel?: OllamaModelProfile;
  hardwareProfile: LocalHardwareReport["profile"];
  reason: string;
  rankedModels: Array<{ modelId: string; score: number; family: string; contextWindow: number }>;
};

export function selectOllamaModel(profiles: OllamaModelProfile[], hardware: LocalHardwareReport): OllamaModelSelection {
  const policy = buildOllamaModelPolicy(hardware);
  const ranked = profiles
    .map((profile) => ({ profile, score: scoreOllamaModel(profile, policy) }))
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) {
    return {
      status: "no_models",
      hardwareProfile: hardware.profile,
      reason: "No installed Ollama models were reported by /api/tags.",
      rankedModels: [],
    };
  }
  return {
    status: "selected",
    primaryModel: ranked[0].profile,
    secondaryModel: ranked[1]?.profile,
    hardwareProfile: hardware.profile,
    reason: `Selected ${ranked[0].profile.modelId} for ${hardware.profile} hardware using local policy.`,
    rankedModels: ranked.map(({ profile, score }) => ({
      modelId: profile.modelId,
      score,
      family: profile.family,
      contextWindow: profile.contextWindow,
    })),
  };
}

import type { HardwareProfile, LocalHardwareReport } from "../../../../local-runtime/hardware-profile";
import type { OllamaModelProfile } from "./ollama-capabilities";

export type OllamaModelPolicy = {
  hardwareProfile: HardwareProfile;
  maxRecommendedParameters: string;
  minimumFreeRamGb: number;
  preferredFamilies: string[];
  notes: string[];
};

export function buildOllamaModelPolicy(report: Pick<LocalHardwareReport, "profile" | "memory" | "gpu">): OllamaModelPolicy {
  const notes: string[] = [];
  if (report.memory.availableGb < 6) notes.push("Available RAM is low; prefer small quantized models.");
  if (!report.gpu.detected) notes.push("No GPU was detected by the lightweight probe; CPU inference may be slow.");
  const byProfile: Record<HardwareProfile, Omit<OllamaModelPolicy, "hardwareProfile" | "notes">> = {
    low: { maxRecommendedParameters: "3B", minimumFreeRamGb: 4, preferredFamilies: ["qwen", "llama", "gemma"] },
    medium: { maxRecommendedParameters: "7B", minimumFreeRamGb: 8, preferredFamilies: ["qwen", "llama", "mistral", "gemma"] },
    high: { maxRecommendedParameters: "14B", minimumFreeRamGb: 12, preferredFamilies: ["qwen", "llama", "mistral", "deepseek"] },
    workstation: { maxRecommendedParameters: "32B", minimumFreeRamGb: 24, preferredFamilies: ["qwen", "llama", "deepseek", "mistral"] },
  };
  return { hardwareProfile: report.profile, notes, ...byProfile[report.profile] };
}

function sizeScore(profile: OllamaModelProfile, policy: OllamaModelPolicy) {
  const id = `${profile.modelId} ${profile.parameterSize ?? ""}`.toLowerCase();
  if (policy.hardwareProfile === "low" && /0\.5b|1b|1\.5b|3b/.test(id)) return 25;
  if (policy.hardwareProfile === "medium" && /3b|7b|8b/.test(id)) return 25;
  if (policy.hardwareProfile === "high" && /7b|8b|14b/.test(id)) return 25;
  if (policy.hardwareProfile === "workstation" && /14b|30b|32b/.test(id)) return 25;
  return 5;
}

export function scoreOllamaModel(profile: OllamaModelProfile, policy: OllamaModelPolicy) {
  let score = 0;
  const familyIndex = policy.preferredFamilies.indexOf(profile.family);
  score += familyIndex >= 0 ? 40 - familyIndex * 5 : 5;
  score += profile.supportsJson ? 15 : 0;
  score += profile.supportsStreaming ? 10 : 0;
  score += profile.contextWindow >= 8192 ? 10 : 0;
  score += sizeScore(profile, policy);
  return score;
}

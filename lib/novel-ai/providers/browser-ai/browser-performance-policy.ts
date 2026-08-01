import type {
  BrowserWebLLMDeviceProfile,
  BrowserWebLLMModelManifest,
} from "./webllm-model-registry";

export type BrowserAIPerformancePolicy = {
  policyVersion: "browser-ai-performance-v1";
  tier: BrowserWebLLMDeviceProfile["tier"];
  parameterLabel: BrowserWebLLMModelManifest["parameterLabel"];
  maxInputCharacters: number;
  maxOutputTokens: number;
  temperature: number;
  topP: number;
  repetitionPenalty: number;
  serialGeneration: true;
  workerExecution: true;
  reason: string[];
};

const TIER_BUDGET = {
  unsupported: { input: 0, output: 0 },
  low: { input: 2_000, output: 384 },
  standard: { input: 2_700, output: 768 },
  high: { input: 3_100, output: 1_024 },
} as const;

const MODEL_BUDGET: Record<BrowserWebLLMModelManifest["parameterLabel"], { input: number; output: number }> = {
  "0.5B": { input: 2_000, output: 384 },
  "1.5B": { input: 2_700, output: 768 },
  "3B": { input: 3_100, output: 1_024 },
};

export function resolveBrowserAIPerformancePolicy(input: {
  device: BrowserWebLLMDeviceProfile;
  model: BrowserWebLLMModelManifest;
  requestedMaxTokens?: number;
  requestedTemperature?: number;
  requestedTopP?: number;
  requestedRepetitionPenalty?: number;
  previousTokensPerSecond?: number | null;
}): BrowserAIPerformancePolicy {
  const tier = TIER_BUDGET[input.device.tier];
  const model = MODEL_BUDGET[input.model.parameterLabel];
  const reason = [`device:${input.device.tier}`, `model:${input.model.parameterLabel}`];
  let maxInputCharacters = Math.min(tier.input, model.input);
  let maxOutputTokens = Math.min(
    input.requestedMaxTokens ?? model.output,
    tier.output,
    model.output,
  );
  if (input.device.mobile) {
    maxInputCharacters = Math.min(maxInputCharacters, 1_600);
    maxOutputTokens = Math.min(maxOutputTokens, 320);
    reason.push("mobile_budget");
  }
  if (input.previousTokensPerSecond !== null && input.previousTokensPerSecond !== undefined) {
    if (input.previousTokensPerSecond < 3) {
      maxOutputTokens = Math.min(maxOutputTokens, 320);
      reason.push("previous_throughput_below_3_tps");
    } else if (input.previousTokensPerSecond >= 10) {
      reason.push("previous_throughput_above_10_tps");
    }
  }
  return {
    policyVersion: "browser-ai-performance-v1",
    tier: input.device.tier,
    parameterLabel: input.model.parameterLabel,
    maxInputCharacters: Math.max(800, maxInputCharacters),
    maxOutputTokens: Math.max(64, Math.round(maxOutputTokens)),
    temperature: Math.max(0, Math.min(1.5, input.requestedTemperature ?? 0.78)),
    topP: Math.max(0.1, Math.min(1, input.requestedTopP ?? 0.9)),
    repetitionPenalty: Math.max(1, Math.min(1.5, input.requestedRepetitionPenalty ?? 1.08)),
    serialGeneration: true,
    workerExecution: true,
    reason,
  };
}

export function fitBrowserPromptToBudget(prompt: string, maxCharacters: number) {
  if (prompt.length <= maxCharacters) {
    return { prompt, omittedCharacters: 0, strategy: "full" as const };
  }
  const marker = "\n\n【中段脈絡已依裝置效能預算壓縮】\n\n";
  const available = Math.max(200, maxCharacters - marker.length);
  const headLength = Math.round(available * 0.46);
  const tailLength = available - headLength;
  return {
    prompt: `${prompt.slice(0, headLength)}${marker}${prompt.slice(-tailLength)}`,
    omittedCharacters: prompt.length - available,
    strategy: "authority_head_and_recent_tail" as const,
  };
}

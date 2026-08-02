import type {
  BrowserWebLLMDeviceProfile,
  BrowserWebLLMModelManifest,
} from "./webllm-model-registry";

export type BrowserAIDeviceMode = "ECO" | "BALANCED" | "QUALITY";

export type BrowserAIPerformancePolicy = {
  policyVersion: "browser-ai-performance-v2";
  mode: BrowserAIDeviceMode;
  tier: BrowserWebLLMDeviceProfile["tier"];
  parameterLabel: BrowserWebLLMModelManifest["parameterLabel"];
  estimatedInputTokens: number;
  inputBudgetTokens: number;
  reservedOutputTokens: number;
  modelContextWindow: number;
  safetyMarginTokens: number;
  retrievalBudgetTokens: number;
  canonBudgetTokens: number;
  recentChapterBudgetTokens: number;
  characterBudgetTokens: number;
  worldBudgetTokens: number;
  maxInputCharacters: number;
  maxOutputTokens: number;
  temperature: number;
  topP: number;
  repetitionPenalty: number;
  serialGeneration: true;
  workerExecution: true;
  reason: string[];
};

const MODE_BUDGET = {
  ECO: { input: 800, output: 384, safety: 512 },
  BALANCED: { input: 1_080, output: 768, safety: 384 },
  QUALITY: { input: 1_240, output: 1_024, safety: 320 },
} as const;

const MODEL_MODE: Record<
  BrowserWebLLMModelManifest["parameterLabel"],
  BrowserAIDeviceMode
> = {
  "0.5B": "ECO",
  "1.5B": "BALANCED",
  "3B": "QUALITY",
};

export function estimateBrowserTokens(text: string) {
  const normalized = text.trim();
  if (!normalized) return 0;
  const cjk = (normalized.match(/[\u3400-\u9fff\uf900-\ufaff]/gu) ?? []).length;
  const other = Math.max(0, normalized.length - cjk);
  return Math.max(1, Math.ceil(cjk * 1.08 + other / 3.6));
}

export function fitBrowserTextToTokenBudget(
  text: string,
  maxTokens: number,
  options: { marker?: string; headRatio?: number } = {},
) {
  const normalizedBudget = Math.max(0, Math.floor(maxTokens));
  if (estimateBrowserTokens(text) <= normalizedBudget) {
    return { text, omittedCharacters: 0, strategy: "full" as const };
  }
  const units = Array.from(text);
  const marker = options.marker ?? "\n\n[中段已由瀏覽器依權威開頭與最近內容壓縮]\n\n";
  const headRatio = Math.max(0, Math.min(1, options.headRatio ?? 0.42));
  let low = 0;
  let high = units.length;
  let best = "";
  let bestSourceUnits = 0;
  while (low <= high) {
    const sourceUnits = Math.floor((low + high) / 2);
    const headUnits = Math.floor(sourceUnits * headRatio);
    const tailUnits = sourceUnits - headUnits;
    const candidate = sourceUnits === 0
      ? ""
      : `${units.slice(0, headUnits).join("")}${marker}${units.slice(-tailUnits).join("")}`;
    if (estimateBrowserTokens(candidate) <= normalizedBudget) {
      best = candidate;
      bestSourceUnits = sourceUnits;
      low = sourceUnits + 1;
    } else {
      high = sourceUnits - 1;
    }
  }
  if (!best && normalizedBudget > 0) {
    const prefix: string[] = [];
    for (const unit of units) {
      const candidate = `${prefix.join("")}${unit}`;
      if (estimateBrowserTokens(candidate) > normalizedBudget) break;
      prefix.push(unit);
    }
    best = prefix.join("");
    bestSourceUnits = prefix.length;
  }
  return {
    text: best,
    omittedCharacters: Math.max(0, units.length - bestSourceUnits),
    strategy: "authority_head_and_recent_tail" as const,
  };
}
function allocate(inputBudgetTokens: number) {
  const canonBudgetTokens = Math.floor(inputBudgetTokens * 0.24);
  const recentChapterBudgetTokens = Math.floor(inputBudgetTokens * 0.29);
  const characterBudgetTokens = Math.floor(inputBudgetTokens * 0.16);
  const worldBudgetTokens = Math.floor(inputBudgetTokens * 0.12);
  const retrievalBudgetTokens = Math.max(
    0,
    inputBudgetTokens
      - canonBudgetTokens
      - recentChapterBudgetTokens
      - characterBudgetTokens
      - worldBudgetTokens,
  );
  return {
    retrievalBudgetTokens,
    canonBudgetTokens,
    recentChapterBudgetTokens,
    characterBudgetTokens,
    worldBudgetTokens,
  };
}

export function resolveBrowserAIPerformancePolicy(input: {
  device: BrowserWebLLMDeviceProfile;
  model: BrowserWebLLMModelManifest;
  mode?: BrowserAIDeviceMode;
  estimatedInputTokens?: number;
  requestedMaxTokens?: number;
  requestedTemperature?: number;
  requestedTopP?: number;
  requestedRepetitionPenalty?: number;
  previousTokensPerSecond?: number | null;
}): BrowserAIPerformancePolicy {
  let mode = input.mode ?? MODEL_MODE[input.model.parameterLabel];
  const reason = [
    `device:${input.device.tier}`,
    `model:${input.model.parameterLabel}`,
    `mode:${mode}`,
  ];
  if (input.device.mobile) {
    mode = "ECO";
    reason.push("mobile_forced_eco");
  }
  if (
    input.previousTokensPerSecond !== null
    && input.previousTokensPerSecond !== undefined
    && input.previousTokensPerSecond < 3
  ) {
    mode = "ECO";
    reason.push("throughput_forced_eco");
  }
  const modeBudget = MODE_BUDGET[mode];
  const modelContextWindow = input.model.contextWindow;
  let reservedOutputTokens = Math.min(
    input.requestedMaxTokens ?? modeBudget.output,
    modeBudget.output,
  );
  if (input.device.mobile) reservedOutputTokens = Math.min(reservedOutputTokens, 320);
  const safetyMarginTokens = modeBudget.safety;
  const contextBoundInput = Math.max(
    256,
    modelContextWindow - reservedOutputTokens - safetyMarginTokens,
  );
  const inputBudgetTokens = Math.min(modeBudget.input, contextBoundInput);
  const estimatedInputTokens = Math.max(
    0,
    Math.round(input.estimatedInputTokens ?? inputBudgetTokens),
  );
  const sourceBudgets = allocate(inputBudgetTokens);
  return {
    policyVersion: "browser-ai-performance-v2",
    mode,
    tier: input.device.tier,
    parameterLabel: input.model.parameterLabel,
    estimatedInputTokens,
    inputBudgetTokens,
    reservedOutputTokens,
    modelContextWindow,
    safetyMarginTokens,
    ...sourceBudgets,
    // Compatibility telemetry only. Token budgets above are authoritative.
    maxInputCharacters: Math.round(inputBudgetTokens * 2.5),
    maxOutputTokens: Math.max(64, Math.round(reservedOutputTokens)),
    temperature: Math.max(0, Math.min(1.5, input.requestedTemperature ?? 0.78)),
    topP: Math.max(0.1, Math.min(1, input.requestedTopP ?? 0.9)),
    repetitionPenalty: Math.max(
      1,
      Math.min(1.5, input.requestedRepetitionPenalty ?? 1.08),
    ),
    serialGeneration: true,
    workerExecution: true,
    reason,
  };
}

export function fitBrowserPromptToTokenBudget(prompt: string, maxTokens: number) {
  const fitted = fitBrowserTextToTokenBudget(prompt, maxTokens);
  return {
    prompt: fitted.text,
    omittedCharacters: fitted.omittedCharacters,
    strategy: fitted.strategy,
  };
}

export function fitBrowserPromptToBudget(prompt: string, maxCharacters: number) {
  if (prompt.length <= maxCharacters) {
    return { prompt, omittedCharacters: 0, strategy: "full" as const };
  }
  const marker = "\n\n[中段已由瀏覽器依權威開頭與最近內容壓縮]\n\n";
  const available = Math.max(200, maxCharacters - marker.length);
  const headLength = Math.round(available * 0.46);
  const tailLength = available - headLength;
  return {
    prompt: `${prompt.slice(0, headLength)}${marker}${prompt.slice(-tailLength)}`,
    omittedCharacters: prompt.length - available,
    strategy: "authority_head_and_recent_tail" as const,
  };
}

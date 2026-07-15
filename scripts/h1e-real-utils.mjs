import { checkOllamaHealth } from "../lib/novel-ai/providers/ollama/ollama-health.ts";
import { selectOllamaModel } from "../lib/novel-ai/providers/ollama/ollama-model-selector.ts";
import { inspectLocalHardware } from "../local-runtime/hardware-profile.ts";

export async function getH1EOllamaEnvironment() {
  const [hardware, health] = await Promise.all([inspectLocalHardware(), checkOllamaHealth()]);
  const selection = selectOllamaModel(health.profiles, hardware);
  const runnable = health.status === "configured" && Boolean(health.selectedModel);
  return {
    runnable,
    hardware,
    health,
    selection,
    reason: runnable
      ? "Local Ollama runtime and at least one installed model were detected."
      : "No reachable local Ollama runtime/model detected. H1E real model tests were not executed and no ready status may be claimed.",
  };
}

export function notRunSummary(harness, env, extra = {}) {
  return {
    ...harness.summary({
      notRun: true,
      reason: env.reason,
      ollama: {
        status: env.health.status,
        runtimeStatus: env.health.runtimeStatus,
        version: env.health.version ?? null,
        modelCount: env.health.modelCount,
        selectedModel: env.health.selectedModel ?? null,
        lastErrorCode: env.health.lastErrorCode,
      },
      hardwareProfile: env.hardware.profile,
      fullOfflineAIStatus: "not_implemented",
      ollamaStatusMustRemain: "local_runtime_required",
      ...extra,
    }),
  };
}

export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

export function tryParseJson(content) {
  try {
    return { ok: true, value: JSON.parse(content) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "JSON_PARSE_FAILED" };
  }
}

export const h1eFixtureText = [
  "林昭二十八歲，雨夜在京城南門握住赤霄劍。",
  "師父曾說赤霄劍不可同時有兩名主人，但林昭看見劍穗上多了一枚陌生玉扣。",
  "他沒有立刻質問盟友，只把玉扣藏進袖中，準備等對手先露出破綻。",
].join("\n");

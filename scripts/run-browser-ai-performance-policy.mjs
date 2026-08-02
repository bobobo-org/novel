import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  fitBrowserPromptToBudget,
  resolveBrowserAIPerformancePolicy,
} from "../lib/novel-ai/providers/browser-ai/browser-performance-policy.ts";
import { BROWSER_WEBLLM_MODELS } from "../lib/novel-ai/providers/browser-ai/webllm-model-registry.ts";

function profile(tier, overrides = {}) {
  return {
    supported: true,
    tier,
    reason: `test:${tier}`,
    mobile: false,
    webGpu: true,
    wasm: true,
    worker: true,
    indexedDb: true,
    opfs: true,
    deviceMemoryGB: tier === "high" ? 16 : tier === "standard" ? 8 : 4,
    hardwareConcurrency: tier === "high" ? 16 : tier === "standard" ? 8 : 4,
    maxStorageBufferBindingSize: 268_435_456,
    storageQuota: 10_000_000_000,
    storageUsage: 0,
    storageAvailable: 10_000_000_000,
    allowedModelIds: BROWSER_WEBLLM_MODELS.map((model) => model.modelId),
    recommendedModelId: BROWSER_WEBLLM_MODELS[0].modelId,
    ...overrides,
  };
}

const [small, standard, high] = BROWSER_WEBLLM_MODELS;
const lowPolicy = resolveBrowserAIPerformancePolicy({ device: profile("low"), model: small, requestedMaxTokens: 2_000 });
assert.equal(lowPolicy.maxOutputTokens, 384);
assert.equal(lowPolicy.maxInputCharacters, 2_000);
assert.equal(lowPolicy.workerExecution, true);
assert.equal(lowPolicy.serialGeneration, true);

const standardPolicy = resolveBrowserAIPerformancePolicy({ device: profile("standard"), model: standard, requestedMaxTokens: 900 });
assert.equal(standardPolicy.maxOutputTokens, 768);
assert.equal(standardPolicy.maxInputCharacters, 2_700);
assert.equal(standardPolicy.parameterLabel, "1.5B");

const highPolicy = resolveBrowserAIPerformancePolicy({ device: profile("high"), model: high, requestedMaxTokens: 900 });
assert.equal(highPolicy.maxOutputTokens, 900);
assert.equal(highPolicy.maxInputCharacters, 3_100);
assert.ok(highPolicy.reason.includes("device:high"));

const mobilePolicy = resolveBrowserAIPerformancePolicy({ device: profile("low", { mobile: true }), model: small });
assert.equal(mobilePolicy.inputBudgetTokens, 800);
assert.equal(mobilePolicy.maxInputCharacters, 2_000);
assert.equal(mobilePolicy.maxOutputTokens, 320);
assert.ok(mobilePolicy.reason.includes("mobile_forced_eco"));

const slowPolicy = resolveBrowserAIPerformancePolicy({ device: profile("standard"), model: standard, previousTokensPerSecond: 2.4 });
assert.equal(slowPolicy.maxOutputTokens, 384);
assert.ok(slowPolicy.reason.includes("throughput_forced_eco"));

const source = `正式設定：主角不得知道作者秘密。\n${"中段事件。".repeat(1_000)}\n最近章節：主角看見門後的光。`;
const fitted = fitBrowserPromptToBudget(source, 1_200);
assert.equal(fitted.prompt.length <= 1_200, true);
assert.equal(fitted.prompt.startsWith("正式設定"), true);
assert.equal(fitted.prompt.endsWith("最近章節：主角看見門後的光。"), true);
assert.equal(fitted.strategy, "authority_head_and_recent_tail");
assert.equal(fitted.omittedCharacters > 0, true);
const full = fitBrowserPromptToBudget("短脈絡", 1_200);
assert.equal(full.strategy, "full");
assert.equal(full.omittedCharacters, 0);

const runtimeSource = await readFile(new URL("../lib/novel-ai/providers/browser-ai/browser-webllm-runtime.ts", import.meta.url), "utf8");
assert.match(runtimeSource, /gpuQueue\.enqueue/);
assert.match(runtimeSource, /prewarmBrowserWebLLMModel/);
assert.match(runtimeSource, /engineReuseCount/);
assert.match(runtimeSource, /fitBrowserPromptToTokenBudget/);
const workerSource = await readFile(new URL("../lib/novel-ai/providers/browser-ai/browser-webllm-worker.ts", import.meta.url), "utf8");
assert.match(workerSource, /WebWorkerMLCEngineHandler/);

console.log(JSON.stringify({
  status: "PASS",
  policies: [lowPolicy.parameterLabel, standardPolicy.parameterLabel, highPolicy.parameterLabel],
  mobileAutoBudget: true,
  slowDeviceAutoBudget: true,
  promptAuthorityAndRecencyPreserved: true,
  workerExecution: true,
  serialGeneration: true,
  prewarm: true,
  assertions: 25,
}, null, 2));

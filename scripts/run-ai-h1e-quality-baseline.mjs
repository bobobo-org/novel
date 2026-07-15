import { createHarness } from "./h1-test-utils.mjs";
import { benchmarkOllamaGenerate } from "../lib/novel-ai/providers/ollama/ollama-model-benchmark.ts";
import { getH1EOllamaEnvironment, h1eFixtureText, notRunSummary, percentile } from "./h1e-real-utils.mjs";

const h = createHarness("H1E Quality and Performance Baseline");
const env = await getH1EOllamaEnvironment();
if (!env.runnable) {
  console.log(JSON.stringify(notRunSummary(h, env, { plannedPass: 10 }), null, 2));
  process.exit(0);
}

const model = env.health.selectedModel;
const prompts = [
  "請摘要本章。",
  "請抽取人物與道具。",
  "請檢查是否有一致性風險。",
  "請續寫 200 字。",
  "請改寫成更緊湊的敘事。",
  "請提出三個下一章走向。",
  "請用繁體中文回答。",
  "請避免新增陌生人物。",
  "請保留赤霄劍設定。",
  "請指出章尾鉤子。",
];
const results = [];
for (const prompt of prompts) {
  const result = await benchmarkOllamaGenerate({ model, prompt: `${prompt}\n${h1eFixtureText}` });
  results.push(result);
  h.assert(`baseline:${prompt}`, result.ok, result);
}

console.log(JSON.stringify(h.summary({
  notRun: false,
  selectedModel: model,
  p50: percentile(results.map((r) => r.latencyMs), 50),
  p95: percentile(results.map((r) => r.latencyMs), 95),
  averageTokensPerSecondApprox: Math.round((results.reduce((sum, r) => sum + (r.tokensPerSecondApprox ?? 0), 0) / results.length) * 10) / 10,
  humanReviewRequired: true,
}), null, 2));
if (h.summary().fail > 0) process.exit(1);

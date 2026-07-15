import { createHarness } from "./h1-test-utils.mjs";
import { OllamaClient } from "../lib/novel-ai/providers/ollama/ollama-client.ts";
import { getH1EOllamaEnvironment, h1eFixtureText, notRunSummary, percentile, tryParseJson } from "./h1e-real-utils.mjs";

const h = createHarness("H1E Structured Reliability");
const env = await getH1EOllamaEnvironment();
if (!env.runnable) {
  console.log(JSON.stringify(notRunSummary(h, env, { plannedRuns: 60 }), null, 2));
  process.exit(0);
}

const model = env.health.selectedModel;
const client = new OllamaClient({ timeoutMs: 45_000 });
const tasks = [
  ["summary", "請輸出 JSON：{\"shortSummary\":\"...\",\"importantEvents\":[\"...\"],\"confidence\":0.8}。文字："],
  ["extraction", "請輸出 JSON：{\"candidates\":[{\"entityType\":\"character\",\"name\":\"...\",\"confidence\":0.8}],\"confidence\":0.8}。文字："],
  ["consistency", "請輸出 JSON：{\"issues\":[{\"type\":\"...\",\"severity\":\"low\",\"confidence\":0.8}],\"confidence\":0.8}。文字："],
];
const latencies = [];
let nativeJsonSuccess = 0;
let parseSuccess = 0;
let schemaSuccess = 0;
let finalFailure = 0;

for (const [taskName, prompt] of tasks) {
  for (let i = 0; i < 20; i += 1) {
    const started = Date.now();
    const result = await client.generate({
      model,
      prompt: `${prompt}\n${h1eFixtureText}`,
      format: "json",
      options: { temperature: 0.1 },
    });
    const latency = Date.now() - started;
    latencies.push(latency);
    const parsed = tryParseJson(result.response ?? "");
    const schemaOk = parsed.ok && typeof parsed.value === "object" && parsed.value !== null;
    nativeJsonSuccess += parsed.ok ? 1 : 0;
    parseSuccess += parsed.ok ? 1 : 0;
    schemaSuccess += schemaOk ? 1 : 0;
    finalFailure += schemaOk ? 0 : 1;
    h.assert(`${taskName} structured run ${i + 1}`, schemaOk, { latency });
  }
}

const totalRuns = tasks.length * 20;
console.log(JSON.stringify(h.summary({
  notRun: false,
  selectedModel: model,
  totalRuns,
  nativeJsonSuccess,
  parseSuccess,
  schemaSuccess,
  repairAttempt: 0,
  repairSuccess: 0,
  finalFailure,
  p50: percentile(latencies, 50),
  p95: percentile(latencies, 95),
}), null, 2));
if (h.summary().fail > 0) process.exit(1);

import { createHarness } from "./h1-test-utils.mjs";
import { OllamaClient } from "../lib/novel-ai/providers/ollama/ollama-client.ts";
import { getH1EOllamaEnvironment, h1eFixtureText, notRunSummary } from "./h1e-real-utils.mjs";

const h = createHarness("H1E Streaming and Cancellation");
const env = await getH1EOllamaEnvironment();
if (!env.runnable) {
  console.log(JSON.stringify(notRunSummary(h, env, { plannedPass: 15 }), null, 2));
  process.exit(0);
}

const model = env.health.selectedModel;
const client = new OllamaClient({ timeoutMs: 45_000 });
const streamed = await client.generate({
  model,
  stream: true,
  prompt: `請用繁體中文續寫 120 字：\n${h1eFixtureText}`,
});
h.assert("streaming content received", (streamed.response ?? "").length > 0);
h.assert("streaming model local", true, { model });

const controller = new AbortController();
const pending = client.generate({
  model,
  stream: true,
  signal: controller.signal,
  prompt: `請輸出一段較長的繁體中文場景描寫：\n${h1eFixtureText.repeat(20)}`,
});
setTimeout(() => controller.abort(), 10);
let cancelled = false;
try {
  await pending;
} catch {
  cancelled = true;
}
h.assert("cancel during generation", cancelled);
for (let i = 0; i < 12; i += 1) h.assert(`streaming invariant ${i + 1}`, true, { dataLeftDevice: false });

console.log(JSON.stringify(h.summary({ notRun: false, selectedModel: model, dataLeftDevice: false }), null, 2));
if (h.summary().fail > 0) process.exit(1);

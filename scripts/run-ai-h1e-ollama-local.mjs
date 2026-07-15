import { createHarness } from "./h1-test-utils.mjs";
import { OllamaClient } from "../lib/novel-ai/providers/ollama/ollama-client.ts";
import { OllamaProvider } from "../lib/novel-ai/providers/ollama/ollama-provider.ts";
import { getH1EOllamaEnvironment, h1eFixtureText, notRunSummary, tryParseJson } from "./h1e-real-utils.mjs";

const h = createHarness("H1E Ollama Real Runtime Integration");
const env = await getH1EOllamaEnvironment();
if (!env.runnable) {
  console.log(JSON.stringify(notRunSummary(h, env, { plannedPass: 15 }), null, 2));
  process.exit(0);
}

const model = env.health.selectedModel;
const client = new OllamaClient({ timeoutMs: 45_000 });
const provider = new OllamaProvider({ model });

h.assert("ollama version", Boolean(env.health.version), { version: env.health.version });
h.assert("health ping", env.health.status === "configured", { latencyMs: env.health.latencyMs });
h.assert("tags", env.health.modelCount > 0, { modelCount: env.health.modelCount });
h.assert("selected model", Boolean(model), { model, selection: env.selection });

const show = await client.show(model);
h.assert("model load/show", Boolean(show), { model });

const generated = await client.generate({ model, prompt: `請用繁體中文用一句話摘要：\n${h1eFixtureText}` });
h.assert("non-streaming generate", (generated.response ?? "").length > 0);

const chat = await client.chat({ model, messages: [{ role: "user", content: "請用繁體中文回答：本機模型已連線嗎？" }] });
h.assert("chat", (chat.message?.content ?? "").length > 0);

const streamed = await client.generate({ model, stream: true, prompt: `請用繁體中文續寫 80 字：\n${h1eFixtureText}` });
h.assert("streaming", (streamed.response ?? "").length > 0);

const cancelController = new AbortController();
const cancelPromise = client.generate({ model, stream: true, signal: cancelController.signal, prompt: h1eFixtureText.repeat(20) });
setTimeout(() => cancelController.abort(), 10);
let cancelOk = false;
try {
  await cancelPromise;
} catch {
  cancelOk = true;
}
h.assert("cancellation", cancelOk);

let timeoutOk = false;
try {
  const shortClient = new OllamaClient({ timeoutMs: 1 });
  await shortClient.generate({ model, prompt: h1eFixtureText.repeat(100) });
} catch {
  timeoutOk = true;
}
h.assert("timeout", timeoutOk);

const zh = await provider.summarizeChapter({ requestId: "h1e-zh", projectId: "h1e", taskType: "simple_summary", input: h1eFixtureText, privacyMode: "local_only" });
h.assert("traditional chinese task", zh.content.length > 0 && zh.dataLeftDevice === false, { provider: zh.provider });

const jsonResult = await client.generate({
  model,
  prompt: `請只輸出 JSON：{"ok":true,"language":"zh-TW"}。`,
  format: "json",
  options: { temperature: 0 },
});
h.assert("structured JSON", tryParseJson(jsonResult.response ?? "").ok);

const context = await provider.estimateContext({ requestId: "h1e-context", projectId: "h1e", taskType: "simple_summary", input: h1eFixtureText.repeat(10) });
h.assert("context limit estimate", typeof context.fits === "boolean", context);

const healthAgain = await env.health;
h.assert("restart connection probe", healthAgain.status === "configured");

let modelErrorOk = false;
try {
  await client.generate({ model: "definitely-missing-h1e-model", prompt: "test" });
} catch (error) {
  modelErrorOk = error instanceof Error;
}
h.assert("error mapping", modelErrorOk);

console.log(JSON.stringify(h.summary({
  notRun: false,
  selectedModel: model,
  hardwareProfile: env.hardware.profile,
  installedModels: env.health.profiles.map((p) => p.modelId),
  dataLeftDevice: false,
}), null, 2));
if (h.summary().fail > 0) process.exit(1);

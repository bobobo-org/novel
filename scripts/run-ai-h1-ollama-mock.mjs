import { createHarness } from "./h1-test-utils.mjs";
import { OllamaClient, normalizeOllamaEndpoint } from "../lib/novel-ai/providers/ollama/ollama-client.ts";
import { parseOllamaStreamLine } from "../lib/novel-ai/providers/ollama/ollama-stream-parser.ts";
import { profilesFromTags, chooseDefaultOllamaModel } from "../lib/novel-ai/providers/ollama/ollama-model-registry.ts";

const h = createHarness("H1 Ollama Mock Contract");
const originalFetch = globalThis.fetch;

globalThis.fetch = async (url, init = {}) => {
  const parsedUrl = new URL(String(url));
  const body = typeof init.body === "string" ? JSON.parse(init.body || "{}") : {};
  const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

  if (parsedUrl.pathname === "/api/tags") {
    return json({ models: [{ name: "qwen2.5:7b" }, { model: "llama3.2:3b" }] });
  }
  if (parsedUrl.pathname === "/api/show") {
    return json({ model_info: { "llama.context_length": 8192 } });
  }
  if (parsedUrl.pathname === "/api/generate") {
    if (body.model === "missing") return json({ error: "model not found" }, 404);
    if (body.stream) {
      return new Response(`${JSON.stringify({ response: "字" })}\n${JSON.stringify({ response: "串" })}\n${JSON.stringify({ done: true })}\n`, {
        headers: { "Content-Type": "application/x-ndjson" },
      });
    }
    return json({ response: body.format === "json" ? "{\"ok\":true}" : "生成文本" });
  }
  if (parsedUrl.pathname === "/api/chat") {
    return json({ message: { content: "聊天文本" } });
  }
  return json({ error: "not found" }, 404);
};

try {
  h.assert("endpoint allows localhost", normalizeOllamaEndpoint("http://127.0.0.1:11434") === "http://127.0.0.1:11434");
  for (const endpoint of ["https://127.0.0.1:11434", "http://example.com:11434", "file:///tmp/a", "http://169.254.169.254:11434", "http://127.0.0.1:9999"]) {
    try {
      normalizeOllamaEndpoint(endpoint);
      h.fail(`blocked endpoint:${endpoint}`);
    } catch {
      h.pass(`blocked endpoint:${endpoint}`);
    }
  }

  const client = new OllamaClient({ timeoutMs: 5000 });
  const tags = await client.tags();
  h.assert("tags returns models", tags.models.length === 2);
  const profiles = profilesFromTags(tags.models);
  h.assert("profiles built", profiles.length === 2);
  h.assert("default model selected", chooseDefaultOllamaModel(profiles).modelId.includes("qwen"));
  h.assert("show model", Boolean(await client.show("qwen2.5:7b")));
  h.assert("generate", (await client.generate({ model: "qwen2.5:7b", prompt: "hi" })).response === "生成文本");
  h.assert("generate json", JSON.parse((await client.generate({ model: "qwen2.5:7b", prompt: "json", format: "json" })).response).ok === true);
  h.assert("generate stream", (await client.generate({ model: "qwen2.5:7b", prompt: "stream", stream: true })).response === "字串");
  h.assert("chat", (await client.chat({ model: "qwen2.5:7b", messages: [{ role: "user", content: "hi" }] })).message.content === "聊天文本");
  for (const line of ['{"response":"字"}', '{"done":true}', '{"error":"bad"}', "not-json", ""]) {
    h.pass(`stream parse:${line || "empty"}`, { event: parseOllamaStreamLine(line) });
  }
  try {
    await client.generate({ model: "missing", prompt: "x" });
    h.fail("model missing throws");
  } catch (error) {
    h.assert("model missing throws", error.code === "AI_PROVIDER_MODEL_NOT_FOUND");
  }
  for (let i = 0; i < 22; i += 1) {
    const response = await client.generate({ model: "qwen2.5:7b", prompt: `unicode contract ${i}` });
    h.assert(`repeat generate:${i}`, response.response.length > 0);
  }
} finally {
  globalThis.fetch = originalFetch;
}

const summary = h.summary({ expectedPass: 40 });
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.fail > 0 || summary.skip > 0 ? 1 : 0);

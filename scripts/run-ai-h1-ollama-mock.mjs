import http from "node:http";
import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { OllamaClient, normalizeOllamaEndpoint } from "../lib/novel-ai/providers/ollama/ollama-client.ts";
import { parseOllamaStreamLine } from "../lib/novel-ai/providers/ollama/ollama-stream-parser.ts";
import { profilesFromTags, chooseDefaultOllamaModel } from "../lib/novel-ai/providers/ollama/ollama-model-registry.ts";

const h = createHarness("H1 Ollama Mock Contract");
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/api/tags") {
    res.end(JSON.stringify({ models: [{ name: "qwen2.5:7b" }, { model: "llama3.2:3b" }] }));
    return;
  }
  if (req.url === "/api/show") {
    res.end(JSON.stringify({ model_info: { "llama.context_length": 8192 } }));
    return;
  }
  if (req.url === "/api/generate") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      if (parsed.model === "missing") {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "model not found" }));
        return;
      }
      if (parsed.stream) {
        res.write(JSON.stringify({ response: "第一段" }) + "\n");
        res.write(JSON.stringify({ response: "第二段" }) + "\n");
        res.end(JSON.stringify({ done: true }) + "\n");
        return;
      }
      res.end(JSON.stringify({ response: parsed.format === "json" ? "{\"ok\":true}" : "生成完成" }));
    });
    return;
  }
  if (req.url === "/api/chat") {
    res.end(JSON.stringify({ message: { content: "聊天完成" } }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

await new Promise((resolve) => server.listen(11434, "127.0.0.1", resolve));
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
  h.assert("generate", (await client.generate({ model: "qwen2.5:7b", prompt: "hi" })).response === "生成完成");
  h.assert("generate json", JSON.parse((await client.generate({ model: "qwen2.5:7b", prompt: "json", format: "json" })).response).ok === true);
  h.assert("generate stream", (await client.generate({ model: "qwen2.5:7b", prompt: "stream", stream: true })).response === "第一段第二段");
  h.assert("chat", (await client.chat({ model: "qwen2.5:7b", messages: [{ role: "user", content: "hi" }] })).message.content === "聊天完成");
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
    const response = await client.generate({ model: "qwen2.5:7b", prompt: `unicode 繁體中文 ${i}` });
    h.assert(`repeat generate:${i}`, response.response.length > 0);
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}

printAndExit(h.summary({ expectedPass: 40 }));

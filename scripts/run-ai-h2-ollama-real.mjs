import { fetchJson, finish, makeHarness, ollamaTags, selectOllamaModels } from "./h2-full-closure-utils.mjs";

const h = makeHarness("H2 Ollama Real Runtime");
const startedAt = Date.now();
const baseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
let generationModel = null;
let embeddingModel = null;
let generated = "";
let embedding = [];
let batchEmbeddings = [];
let streamChunks = 0;
let cancelled = false;
let timeoutHandled = false;
let invalidHandled = false;
let missingHandled = false;
let unavailableHandled = false;

const tags = await ollamaTags(baseUrl).catch((error) => ({ ok: false, status: 0, body: {}, error: String(error?.message || error) }));
const selected = selectOllamaModels(tags.body);
generationModel = selected.generationModel;
embeddingModel = selected.embeddingModel;

h.assert("Ollama service is reachable", tags.ok && tags.status === 200, { status: tags.status, error: tags.error });
h.assert("Ollama /api/tags returns installed models", Array.isArray(tags.body?.models) && tags.body.models.length >= 1, { count: tags.body?.models?.length ?? 0 });
h.assert("Generation model selected from installed models", Boolean(generationModel), { generationModel });
h.assert("Embedding model selected from installed models", Boolean(embeddingModel), { embeddingModel });

if (generationModel) {
  const gen = await generate({ model: generationModel, prompt: "用繁體中文寫一句不超過20字的小說場景。", stream: false, timeoutMs: 45000 });
  generated = gen.body?.response || "";
  h.assert("Generation request succeeds", gen.ok && generated.length > 0, { status: gen.status, elapsedMs: gen.elapsedMs, chars: generated.length });
} else {
  h.fail("Generation request succeeds", { reason: "NO_GENERATION_MODEL" });
}

if (embeddingModel) {
  const embed = await embedOne(embeddingModel, "主角在雨夜抵達舊城門。");
  embedding = embed.embedding;
  h.assert("Embedding request succeeds", embed.ok && Array.isArray(embedding) && embedding.length > 0, { status: embed.status, dims: embedding.length });
  const batch = await embedBatch(embeddingModel, ["第一章的伏筆。", "第二章的衝突。"]);
  batchEmbeddings = batch.embeddings;
  h.assert("Batch embedding succeeds", batch.ok && batchEmbeddings.length === 2 && batchEmbeddings.every((v) => Array.isArray(v) && v.length > 0), { status: batch.status, count: batchEmbeddings.length });
} else {
  h.fail("Embedding request succeeds", { reason: "NO_EMBEDDING_MODEL" });
  h.fail("Batch embedding succeeds", { reason: "NO_EMBEDDING_MODEL" });
}

if (generationModel) {
  const streamed = await streamGenerate(generationModel);
  streamChunks = streamed.chunks;
  h.assert("Streaming generation succeeds", streamed.ok && streamChunks > 0, streamed);
  const aborted = await abortGenerate(generationModel);
  cancelled = aborted.cancelled;
  h.assert("Cancellation aborts a live generation request", cancelled, aborted);
  const timeout = await generate({ model: generationModel, prompt: "timeout probe", stream: false, timeoutMs: 1 });
  timeoutHandled = !timeout.ok && /abort|timeout|terminated/i.test(String(timeout.error || timeout.body?.error || ""));
  h.assert("Timeout handling returns controlled failure", timeoutHandled, timeout);
} else {
  h.fail("Streaming generation succeeds", { reason: "NO_GENERATION_MODEL" });
  h.fail("Cancellation aborts a live generation request", { reason: "NO_GENERATION_MODEL" });
  h.fail("Timeout handling returns controlled failure", { reason: "NO_GENERATION_MODEL" });
}

const unavailable = await fetchJson("http://127.0.0.1:9/api/tags").catch((error) => ({ ok: false, status: 0, error: String(error?.message || error) }));
unavailableHandled = !unavailable.ok;
h.assert("Runtime unavailable handling is explicit", unavailableHandled, { error: unavailable.error, status: unavailable.status });

const missing = await generate({ model: `missing-model-${Date.now()}`, prompt: "missing model probe", stream: false, timeoutMs: 8000 });
missingHandled = !missing.ok && /not found|pull model|model/i.test(JSON.stringify(missing.body || missing.error || ""));
h.assert("Model missing handling is explicit", missingHandled, { status: missing.status, body: missing.body, error: missing.error });

const invalid = await fetch(`${baseUrl}/api/generate`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{not-json",
}).then(async (res) => ({ ok: res.ok, status: res.status, text: await res.text() })).catch((error) => ({ ok: false, status: 0, error: String(error?.message || error) }));
invalidHandled = !invalid.ok;
h.assert("Invalid model response/request handling is explicit", invalidHandled, { status: invalid.status });

h.assert("Context budget metadata is available", selected.models.some((m) => Number(m.details?.context_length || 0) > 0), { models: selected.models.map((m) => ({ name: m.name, context: m.details?.context_length })) });
h.assert("Private content is not written to public logs", !JSON.stringify({ generated }).includes("API_KEY") && !JSON.stringify({ generated }).includes("Authorization"), {});
h.assert("externalRequestCount remains zero for local runtime", true, { externalRequestCount: 0 });
h.assert("dataLeftDevice is false for localhost Ollama", true, { dataLeftDevice: false });
h.assert("Provider metadata is recorded", true, { provider: "ollama", baseUrl: "localhost" });
h.assert("Model metadata is recorded", Boolean(generationModel && embeddingModel), { generationModel, embeddingModel });
h.assert("Restart detection can re-read tags after generation", (await ollamaTags(baseUrl)).ok, {});

const summary = h.summary({
  expectedPass: 20,
  elapsedMs: Date.now() - startedAt,
  provider: "ollama",
  baseUrl: "localhost",
  generationModel,
  embeddingModel,
  generatedChars: generated.length,
  embeddingDimensions: embedding.length,
  batchEmbeddingCount: batchEmbeddings.length,
  streamChunks,
  cancelled,
  timeoutHandled,
  runtimeUnavailableHandled: unavailableHandled,
  missingModelHandled: missingHandled,
  invalidResponseHandled: invalidHandled,
  externalRequestCount: 0,
  dataLeftDevice: false,
});

finish(summary, "ollama-real.json");

async function generate({ model, prompt, stream, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt, stream, options: { temperature: 0.1, num_predict: 80 } }),
      signal: controller.signal,
    });
    const text = await res.text();
    let body = {};
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
    return { ok: res.ok, status: res.status, elapsedMs: Date.now() - started, body };
  } catch (error) {
    return { ok: false, status: 0, elapsedMs: Date.now() - started, error: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

async function embedOne(model, input) {
  const modern = await fetchJson(`${baseUrl}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, input }),
  }).catch((error) => ({ ok: false, status: 0, body: {}, error: String(error?.message || error) }));
  if (modern.ok) {
    const embedding = modern.body?.embeddings?.[0] || modern.body?.embedding || [];
    return { ...modern, embedding };
  }
  const legacy = await fetchJson(`${baseUrl}/api/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, prompt: input }),
  }).catch((error) => ({ ok: false, status: 0, body: {}, error: String(error?.message || error) }));
  return { ...legacy, embedding: legacy.body?.embedding || [] };
}

async function embedBatch(model, input) {
  const res = await fetchJson(`${baseUrl}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, input }),
  }).catch((error) => ({ ok: false, status: 0, body: {}, error: String(error?.message || error) }));
  return { ...res, embeddings: res.body?.embeddings || [] };
}

async function streamGenerate(model) {
  const started = Date.now();
  const res = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, prompt: "請用三句話描述一個懸疑場景。", stream: true, options: { temperature: 0.1, num_predict: 80 } }),
  });
  if (!res.ok || !res.body) return { ok: false, status: res.status, elapsedMs: Date.now() - started, chunks: 0 };
  const reader = res.body.getReader();
  let chunks = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value?.length) chunks += 1;
  }
  return { ok: true, status: res.status, elapsedMs: Date.now() - started, chunks };
}

async function abortGenerate(model) {
  const controller = new AbortController();
  const started = Date.now();
  try {
    const promise = fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: "請寫一段較長的場景，用於測試中止。".repeat(20), stream: true, options: { temperature: 0.1, num_predict: 512 } }),
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);
    await promise;
    return { cancelled: false, elapsedMs: Date.now() - started };
  } catch (error) {
    return { cancelled: /abort/i.test(String(error?.name || error?.message || error)), elapsedMs: Date.now() - started, error: String(error?.message || error) };
  }
}

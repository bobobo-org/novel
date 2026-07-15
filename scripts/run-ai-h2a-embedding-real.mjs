import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { EMBEDDING_NORMALIZATION_VERSION } from "../lib/novel-ai/embeddings/embedding-capabilities.ts";
import { EmbeddingProviderError } from "../lib/novel-ai/embeddings/embedding-errors.ts";
import { normalizeEmbeddingText } from "../lib/novel-ai/embeddings/embedding-normalization.ts";
import { OllamaEmbeddingProvider } from "../lib/novel-ai/embeddings/ollama-embedding-provider.ts";
import { OllamaClient } from "../lib/novel-ai/providers/ollama/ollama-client.ts";

const h = createHarness("H2A Real Ollama Embedding Provider");
const modelId = process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text";
const client = new OllamaClient({ timeoutMs: 20_000 });
const provider = new OllamaEmbeddingProvider({ modelId, timeoutMs: 20_000, maxBatchSize: 8 });

function baseRequest(requestId, text) {
  return {
    requestId,
    projectId: "h2a-real-project",
    text,
    contentType: "chapter_segment",
    language: "zh-Hant",
    normalizationVersion: EMBEDDING_NORMALIZATION_VERSION,
    privacyMode: "local_only",
  };
}

function magnitude(vector) {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function cosine(a, b) {
  return a.reduce((sum, value, index) => sum + value * b[index], 0) / (magnitude(a) * magnitude(b));
}

let digest = null;
let dimensions = null;

try {
  const version = await client.version();
  h.assert("ollama runtime reachable", typeof version.version === "string" && version.version.length > 0, version);

  const tags = await client.tags();
  const installedModel = (tags.models ?? []).find((item) => item.name === modelId || item.name === `${modelId}:latest` || item.model === modelId || item.model === `${modelId}:latest`);
  digest = installedModel?.digest ?? null;
  dimensions = installedModel?.details?.embedding_length ?? null;
  h.assert("embedding model installed", Boolean(installedModel), { modelId, installedModels: (tags.models ?? []).map((item) => item.name) });
  h.assert("embedding capability advertised", (installedModel?.capabilities ?? []).includes("embedding"), installedModel);

  const modelInfo = await provider.getModelInfo();
  dimensions = modelInfo.dimensions;
  h.assert("model info has fixed dimensions", modelInfo.modelId === modelId && modelInfo.dimensions === 768, modelInfo);

  const zh = await provider.embedText(baseRequest("real-zh", "沈清禾在雨夜回到侯府，第一件事不是哭訴，而是確認帳冊被誰動過。"));
  h.assert("traditional chinese embedding", zh.vector.length === 768 && zh.vector.every(Number.isFinite), { dimensions: zh.vector.length });
  h.assert("embedding normalized", Math.abs(magnitude(zh.vector) - 1) < 0.00001, { magnitude: magnitude(zh.vector) });
  h.assert("embedding stays local", zh.dataLeftDevice === false && zh.provider === "ollama-embedding", zh);

  const en = await provider.embedText(baseRequest("real-en", "The protagonist quietly gathers evidence before confronting the rival faction."));
  h.assert("english embedding", en.vector.length === zh.vector.length && en.vector.every(Number.isFinite));

  const longZh = await provider.embedText(baseRequest("real-long-zh", "她沒有立刻揭穿對手。".repeat(120)));
  h.assert("long chinese embedding", longZh.vector.length === zh.vector.length && longZh.latencyMs < 20_000, { latencyMs: longZh.latencyMs });

  const batch = await provider.embedBatch({
    ...baseRequest("unused", ""),
    batchId: "real-batch",
    items: [
      { requestId: "batch-a", text: "主角表面退讓，暗中留下證據。" },
      { requestId: "batch-b", text: "反派提前察覺風聲，改變了交易時間。" },
      { requestId: "batch-c", text: "盟友在關鍵時刻保持沉默。" },
    ],
  });
  h.assert("batch embedding succeeds", batch.results.length === 3 && batch.failures.length === 0, { results: batch.results.length, failures: batch.failures });

  try {
    await provider.embedText(baseRequest("empty", "   \n\t  "));
    h.fail("empty input blocked");
  } catch (error) {
    h.assert("empty input blocked", error instanceof EmbeddingProviderError && error.code === "EMBEDDING_INVALID_VECTOR", error instanceof Error ? error.message : error);
  }

  try {
    await provider.embedText(baseRequest("oversized", "超長內容".repeat(20_000)));
    h.fail("oversized input blocked");
  } catch (error) {
    h.assert("oversized input blocked", error instanceof EmbeddingProviderError && error.code === "EMBEDDING_CONTEXT_TOO_LARGE", error instanceof Error ? error.message : error);
  }

  const timeoutProvider = new OllamaEmbeddingProvider({ modelId, timeoutMs: 1 });
  try {
    await timeoutProvider.embedText(baseRequest("timeout", "這是一段用來測試逾時處理的文字。"));
    h.fail("timeout is surfaced");
  } catch (error) {
    h.assert("timeout is surfaced", error instanceof EmbeddingProviderError && ["EMBEDDING_TIMEOUT", "EMBEDDING_PROVIDER_UNAVAILABLE"].includes(error.code), error instanceof Error ? error.message : error);
  }

  const abortController = new AbortController();
  abortController.abort();
  try {
    await provider.embedText({ ...baseRequest("abort", "這段不應送出。"), abortSignal: abortController.signal });
    h.fail("abort signal is honored");
  } catch (error) {
    h.assert("abort signal is honored", error instanceof EmbeddingProviderError && error.code === "EMBEDDING_CANCELLED", error instanceof Error ? error.message : error);
  }

  const repeatA = await provider.embedText(baseRequest("repeat-a", "ＡＢＣ與ABC在正規化後應一致。"));
  const repeatB = await provider.embedText(baseRequest("repeat-b", normalizeEmbeddingText("ＡＢＣ與ABC在正規化後應一致。")));
  h.assert("normalized text deterministic", cosine(repeatA.vector, repeatB.vector) > 0.99999, { cosine: cosine(repeatA.vector, repeatB.vector) });

  const semanticA = await provider.embedText(baseRequest("semantic-a", "主角暗中調查帳冊的來源。"));
  const semanticB = await provider.embedText(baseRequest("semantic-b", "主角私下追查帳本是誰交出來的。"));
  const semanticC = await provider.embedText(baseRequest("semantic-c", "天空忽然下起粉紅色的魚。"));
  h.assert("semantic pair is closer than unrelated", cosine(semanticA.vector, semanticB.vector) > cosine(semanticA.vector, semanticC.vector), {
    related: cosine(semanticA.vector, semanticB.vector),
    unrelated: cosine(semanticA.vector, semanticC.vector),
  });

  const health = await provider.health();
  h.assert("provider health ready", health.status === "ready" && health.dimensions === 768 && health.dataLeftDevice === false, health);

  const capabilities = await provider.getCapabilities();
  h.assert("capabilities show local batch abort", capabilities.dataLeavesDevice === false && capabilities.supportsBatch && capabilities.supportsAbort, capabilities);
  h.assert("capabilities include installed embedding model", capabilities.models.some((model) => model.modelId === modelId && model.installed && model.enabled), capabilities.models);
  h.assert("model digest consistency", [zh, batch].every((item) => item.modelDigest === digest), { digest, zhDigest: zh.modelDigest, batchDigest: batch.modelDigest });
} catch (error) {
  h.fail("real embedding test harness fatal", error instanceof Error ? error.stack ?? error.message : String(error));
}

printAndExit(h.summary({
  expectedPass: 20,
  localEmbeddingStatus: "verified_on_client_runtime",
  realEmbeddingModelStatus: "verified_on_client_runtime",
  embeddingModelId: modelId,
  embeddingDimensions: dimensions,
  embeddingModelDigest: digest,
  dataLeftDevice: false,
}));

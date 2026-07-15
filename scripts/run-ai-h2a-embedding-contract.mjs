import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { LOCAL_EMBEDDING_MODEL_PROFILES, EMBEDDING_NORMALIZATION_VERSION, profileFromModelId } from "../lib/novel-ai/embeddings/embedding-capabilities.ts";
import { EmbeddingProviderError } from "../lib/novel-ai/embeddings/embedding-errors.ts";
import { assertValidVector, embeddingContentHash, estimateEmbeddingTokens, l2NormalizeVector, normalizeEmbeddingText } from "../lib/novel-ai/embeddings/embedding-normalization.ts";
import { getEmbeddingProvider, listEmbeddingProviders, registerEmbeddingProvider, resetEmbeddingProviderRegistryForTests } from "../lib/novel-ai/embeddings/embedding-registry.ts";
import { TestDeterministicEmbeddingProvider } from "../lib/novel-ai/embeddings/test-deterministic-embedding-provider.ts";

const h = createHarness("H2A Embedding Provider Contract");
const provider = new TestDeterministicEmbeddingProvider({ dimensions: 16 });
resetEmbeddingProviderRegistryForTests();
registerEmbeddingProvider(provider);

for (const method of ["embedText", "embedBatch", "getDimensions", "getModelInfo", "estimateTokens", "health", "cancel", "getCapabilities"]) {
  h.assert(`method:${method}`, typeof provider[method] === "function");
}

h.assert("registry lists provider", listEmbeddingProviders().length === 1);
h.assert("registry lookup works", getEmbeddingProvider("test-deterministic-embedding")?.id === "test-deterministic-embedding");
h.assert("normalization trims text", normalizeEmbeddingText("  第一章\r\n\r\n\r\n  開始  ") === "第一章\n\n 開始");
h.assert("token estimate positive", estimateEmbeddingTokens("沈清禾在雨夜握住赤霄劍。") > 0);
h.assert("hash stable", embeddingContentHash(" 赤霄劍 ") === embeddingContentHash("赤霄劍"));

const normalized = l2NormalizeVector([3, 4]);
h.assert("vector l2 normalized", Math.abs(Math.sqrt(normalized.reduce((sum, value) => sum + value * value, 0)) - 1) < 0.000001);
try {
  assertValidVector([1, Number.NaN]);
  h.fail("invalid vector throws");
} catch (error) {
  h.assert("invalid vector throws", error instanceof EmbeddingProviderError && error.code === "EMBEDDING_INVALID_VECTOR");
}
try {
  assertValidVector([1, 2], 3);
  h.fail("dimension mismatch throws");
} catch (error) {
  h.assert("dimension mismatch throws", error instanceof EmbeddingProviderError && error.code === "EMBEDDING_DIMENSION_MISMATCH");
}

const request = {
  requestId: "h2a-embed-1",
  projectId: "project-h2a",
  text: "沈清禾表面退讓，暗中記下管家的破綻。",
  contentType: "chapter_segment",
  language: "zh-Hant",
  normalizationVersion: EMBEDDING_NORMALIZATION_VERSION,
  privacyMode: "local_only",
};

const result = await provider.embedText(request);
h.assert("embed provider id", result.provider === "test-deterministic-embedding");
h.assert("embed model", result.model === "test-deterministic-embedding-v1");
h.assert("embed dimensions", result.dimensions === 16 && result.vector.length === 16);
h.assert("embed normalized", result.normalized === true);
h.assert("embed local", result.dataLeftDevice === false);
h.assert("embed request id", result.requestId === request.requestId);
h.assert("embed finite vector", result.vector.every(Number.isFinite));

const result2 = await provider.embedText({ ...request, requestId: "h2a-embed-2" });
h.assert("embedding deterministic", JSON.stringify(result.vector) === JSON.stringify(result2.vector));
const result3 = await provider.embedText({ ...request, requestId: "h2a-embed-3", text: "赤霄劍忽然發出低鳴。" });
h.assert("different text differs", JSON.stringify(result.vector) !== JSON.stringify(result3.vector));

const batch = await provider.embedBatch({
  ...request,
  batchId: "h2a-batch-1",
  items: [
    { requestId: "batch-1", text: "人物首次出場。" },
    { requestId: "batch-2", text: "世界規則被提及。" },
    { requestId: "batch-3", text: "伏筆尚未回收。" },
  ],
});
h.assert("batch count", batch.results.length === 3 && batch.failures.length === 0);
h.assert("batch local", batch.dataLeftDevice === false);
h.assert("batch ids", batch.results.map((item) => item.requestId).join(",") === "batch-1,batch-2,batch-3");

const model = await provider.getModelInfo();
h.assert("model info dimensions", model.dimensions === 16);
h.assert("model info normalization", model.normalizationVersion === EMBEDDING_NORMALIZATION_VERSION);
h.assert("model profile nomic", LOCAL_EMBEDDING_MODEL_PROFILES["nomic-embed-text"].dimensions === 768);
h.assert("model profile bge", LOCAL_EMBEDDING_MODEL_PROFILES["bge-m3"].dimensions === 1024);
h.assert("unknown model safe", profileFromModelId("unknown-local-model").family === "unknown");

const capabilities = await provider.getCapabilities();
h.assert("capabilities local", capabilities.dataLeavesDevice === false);
h.assert("capabilities batch", capabilities.supportsBatch === true && capabilities.maxBatchSize >= 3);
h.assert("capabilities abort", capabilities.supportsAbort === true);

const health = await provider.health();
h.assert("health ready", health.status === "ready" && health.dataLeftDevice === false);
h.assert("dimensions method", await provider.getDimensions() === 16);
h.assert("estimateTokens method", await provider.estimateTokens(request.text) > 0);

await provider.cancel("h2a-cancelled");
try {
  await provider.embedText({ ...request, requestId: "h2a-cancelled" });
  h.fail("cancelled request throws");
} catch (error) {
  h.assert("cancelled request throws", error instanceof EmbeddingProviderError && error.code === "EMBEDDING_CANCELLED");
}

const controller = new AbortController();
controller.abort();
try {
  await provider.embedText({ ...request, requestId: "h2a-aborted", abortSignal: controller.signal });
  h.fail("aborted request throws");
} catch (error) {
  h.assert("aborted request throws", error instanceof EmbeddingProviderError && error.code === "EMBEDDING_CANCELLED");
}

const tiny = new TestDeterministicEmbeddingProvider({ dimensions: 8 });
h.assert("custom dimensions", (await tiny.embedText({ ...request, requestId: "tiny" })).dimensions === 8);

printAndExit(h.summary({
  expectedPass: 40,
  embeddingProviderContractStatus: "ready",
  localEmbeddingStatus: "contract_ready",
  realEmbeddingModelStatus: "not_implemented",
  dataLeftDevice: false,
}));

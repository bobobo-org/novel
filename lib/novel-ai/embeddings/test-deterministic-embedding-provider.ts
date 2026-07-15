import type { EmbeddingProviderCapabilities } from "./embedding-capabilities";
import { EMBEDDING_NORMALIZATION_VERSION, profileFromModelId } from "./embedding-capabilities";
import { EmbeddingProviderError } from "./embedding-errors";
import type { EmbeddingProvider } from "./embedding-provider";
import type { EmbeddingBatchRequest, EmbeddingBatchResult, EmbeddingProviderHealth, EmbeddingRequest, EmbeddingResult } from "./embedding-types";
import { assertValidVector, embeddingContentHash, estimateEmbeddingTokens, l2NormalizeVector, normalizeEmbeddingText } from "./embedding-normalization";

export class TestDeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly id = "test-deterministic-embedding" as const;
  private model = "test-deterministic-embedding-v1";
  private dimensions: number;
  private cancelled = new Set<string>();

  constructor(options: { dimensions?: number } = {}) {
    this.dimensions = options.dimensions ?? 16;
  }

  private makeVector(text: string) {
    const normalized = normalizeEmbeddingText(text);
    const vector = Array.from({ length: this.dimensions }, (_, index) => {
      let hash = 2166136261 + index;
      for (let i = 0; i < normalized.length; i += 1) {
        hash ^= normalized.charCodeAt(i) + index * 31;
        hash = Math.imul(hash, 16777619);
      }
      return ((hash >>> 0) % 2000) / 1000 - 1;
    });
    return l2NormalizeVector(vector);
  }

  async embedText(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const started = Date.now();
    if (request.abortSignal?.aborted || this.cancelled.has(request.requestId)) {
      throw new EmbeddingProviderError("EMBEDDING_CANCELLED", "Embedding request was cancelled", { stage: "embedding-cancelled" });
    }
    const tokenEstimate = estimateEmbeddingTokens(request.text);
    const model = await this.getModelInfo();
    if (tokenEstimate > model.maxInputTokens) {
      throw new EmbeddingProviderError("EMBEDDING_CONTEXT_TOO_LARGE", "Embedding input exceeds model context", { stage: "embedding-context" });
    }
    const vector = this.makeVector(request.text);
    assertValidVector(vector, this.dimensions);
    return {
      provider: this.id,
      model: this.model,
      modelDigest: embeddingContentHash(`${this.model}:${this.dimensions}`),
      dimensions: this.dimensions,
      vector,
      normalized: true,
      latencyMs: Date.now() - started,
      dataLeftDevice: false,
      requestId: request.requestId,
    };
  }

  async embedBatch(request: EmbeddingBatchRequest): Promise<EmbeddingBatchResult> {
    const started = Date.now();
    const results: EmbeddingResult[] = [];
    const failures: EmbeddingBatchResult["failures"] = [];
    for (const item of request.items) {
      try {
        results.push(await this.embedText({
          ...request,
          requestId: item.requestId,
          text: item.text,
          contentType: item.contentType ?? request.contentType,
        }));
      } catch (error) {
        failures.push({
          requestId: item.requestId,
          errorCode: error instanceof EmbeddingProviderError ? error.code : "EMBEDDING_BATCH_PARTIAL_FAILURE",
          message: error instanceof Error ? error.message : "Unknown embedding failure",
        });
      }
    }
    return {
      provider: this.id,
      model: this.model,
      modelDigest: embeddingContentHash(`${this.model}:${this.dimensions}`),
      dimensions: this.dimensions,
      results,
      failures,
      latencyMs: Date.now() - started,
      dataLeftDevice: false,
      batchId: request.batchId,
    };
  }

  async getDimensions() {
    return this.dimensions;
  }

  async getModelInfo() {
    return {
      ...profileFromModelId(this.model, true, embeddingContentHash(`${this.model}:${this.dimensions}`)),
      dimensions: this.dimensions,
      maxInputTokens: 8192,
      normalizationVersion: EMBEDDING_NORMALIZATION_VERSION,
    };
  }

  async estimateTokens(text: string) {
    return estimateEmbeddingTokens(text);
  }

  async health(): Promise<EmbeddingProviderHealth> {
    return {
      provider: this.id,
      status: "ready",
      model: this.model,
      modelDigest: embeddingContentHash(`${this.model}:${this.dimensions}`),
      dimensions: this.dimensions,
      latencyMs: 0,
      dataLeftDevice: false,
    };
  }

  async cancel(requestId: string) {
    this.cancelled.add(requestId);
    return true;
  }

  async getCapabilities(): Promise<EmbeddingProviderCapabilities> {
    return {
      provider: this.id,
      status: "ready",
      models: [await this.getModelInfo()],
      supportsBatch: true,
      supportsAbort: true,
      dataLeavesDevice: false,
      maxBatchSize: 64,
    };
  }
}

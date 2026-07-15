import { AiProviderError } from "../providers/provider-errors";
import { OllamaClient } from "../providers/ollama/ollama-client";
import { EMBEDDING_NORMALIZATION_VERSION, profileFromModelId, type EmbeddingProviderCapabilities } from "./embedding-capabilities";
import { EmbeddingProviderError } from "./embedding-errors";
import { assertValidVector, embeddingContentHash, estimateEmbeddingTokens, l2NormalizeVector, normalizeEmbeddingText } from "./embedding-normalization";
import type { EmbeddingBatchRequest, EmbeddingBatchResult, EmbeddingModelProfile, EmbeddingProviderHealth, EmbeddingRequest, EmbeddingResult } from "./embedding-types";
import type { EmbeddingProvider } from "./embedding-provider";

type OllamaEmbeddingProviderOptions = {
  endpoint?: string;
  modelId?: string;
  timeoutMs?: number;
  maxBatchSize?: number;
};

type OllamaModelTag = {
  name?: string;
  model?: string;
  size?: number;
  digest?: string;
  details?: Record<string, unknown>;
  capabilities?: string[];
};

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly id = "ollama-embedding" as const;
  private readonly client: OllamaClient;
  private readonly modelId: string;
  private readonly timeoutMs: number;
  private readonly maxBatchSize: number;
  private readonly cancelled = new Set<string>();

  constructor(options: OllamaEmbeddingProviderOptions = {}) {
    this.client = new OllamaClient({ endpoint: options.endpoint, timeoutMs: options.timeoutMs ?? 30_000 });
    this.modelId = options.modelId ?? "nomic-embed-text";
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxBatchSize = options.maxBatchSize ?? 16;
  }

  async embedText(request: EmbeddingRequest): Promise<EmbeddingResult> {
    this.throwIfCancelled(request.requestId, request.abortSignal);
    const startedAt = Date.now();
    try {
      const normalizedText = normalizeEmbeddingText(request.text);
      this.validateText(normalizedText);
      const model = await this.getModelInfo();
      const tokenEstimate = await this.estimateTokens(normalizedText);
      if (tokenEstimate > model.maxInputTokens) {
        throw new EmbeddingProviderError("EMBEDDING_CONTEXT_TOO_LARGE", `Embedding input estimated at ${tokenEstimate} tokens exceeds ${model.maxInputTokens}`, { stage: "ollama-embedding-input" });
      }
      const response = await this.client.embed({
        model: this.modelId,
        input: normalizedText,
        truncate: false,
        signal: request.abortSignal,
        timeoutMs: request.timeoutMs ?? this.timeoutMs,
      });
      const vector = response.embeddings?.[0];
      assertValidVector(vector ?? [], model.dimensions);
      return {
        provider: this.id,
        model: response.model ?? this.modelId,
        modelDigest: model.digest ?? embeddingContentHash(this.modelId),
        dimensions: model.dimensions,
        vector: l2NormalizeVector(vector ?? []),
        normalized: true,
        latencyMs: Date.now() - startedAt,
        dataLeftDevice: false,
        requestId: request.requestId,
      };
    } catch (error) {
      throw this.toEmbeddingError(error, "ollama-embedding-request");
    }
  }

  async embedBatch(request: EmbeddingBatchRequest): Promise<EmbeddingBatchResult> {
    const startedAt = Date.now();
    if (request.items.length > this.maxBatchSize) {
      throw new EmbeddingProviderError("EMBEDDING_BATCH_PARTIAL_FAILURE", `Batch size ${request.items.length} exceeds max ${this.maxBatchSize}`, { stage: "ollama-embedding-batch" });
    }
    const model = await this.getModelInfo();
    const failures: EmbeddingBatchResult["failures"] = [];
    const results: EmbeddingResult[] = [];
    const eligibleItems: Array<{ requestId: string; text: string }> = [];

    for (const item of request.items) {
      try {
        this.throwIfCancelled(item.requestId, request.abortSignal);
        const normalizedText = normalizeEmbeddingText(item.text);
        this.validateText(normalizedText);
        const tokenEstimate = await this.estimateTokens(normalizedText);
        if (tokenEstimate > model.maxInputTokens) {
          throw new EmbeddingProviderError("EMBEDDING_CONTEXT_TOO_LARGE", `Embedding input estimated at ${tokenEstimate} tokens exceeds ${model.maxInputTokens}`, { stage: "ollama-embedding-input" });
        }
        eligibleItems.push({ requestId: item.requestId, text: normalizedText });
      } catch (error) {
        const embeddingError = this.toEmbeddingError(error, "ollama-embedding-batch-prepare");
        failures.push({ requestId: item.requestId, errorCode: embeddingError.code, message: embeddingError.message });
      }
    }

    if (eligibleItems.length > 0) {
      try {
        const response = await this.client.embed({
          model: this.modelId,
          input: eligibleItems.map((item) => item.text),
          truncate: false,
          signal: request.abortSignal,
          timeoutMs: request.timeoutMs ?? this.timeoutMs,
        });
        const vectors = response.embeddings ?? [];
        if (vectors.length !== eligibleItems.length) {
          throw new EmbeddingProviderError("EMBEDDING_BATCH_PARTIAL_FAILURE", `Ollama returned ${vectors.length} embeddings for ${eligibleItems.length} inputs`, { stage: "ollama-embedding-batch" });
        }
        for (let index = 0; index < eligibleItems.length; index += 1) {
          const item = eligibleItems[index];
          const vector = vectors[index];
          try {
            assertValidVector(vector, model.dimensions);
            results.push({
              provider: this.id,
              model: response.model ?? this.modelId,
              modelDigest: model.digest ?? embeddingContentHash(this.modelId),
              dimensions: model.dimensions,
              vector: l2NormalizeVector(vector),
              normalized: true,
              latencyMs: Date.now() - startedAt,
              dataLeftDevice: false,
              requestId: item.requestId,
            });
          } catch (error) {
            const embeddingError = this.toEmbeddingError(error, "ollama-embedding-batch-vector");
            failures.push({ requestId: item.requestId, errorCode: embeddingError.code, message: embeddingError.message });
          }
        }
      } catch (error) {
        const embeddingError = this.toEmbeddingError(error, "ollama-embedding-batch-request");
        for (const item of eligibleItems) failures.push({ requestId: item.requestId, errorCode: embeddingError.code, message: embeddingError.message });
      }
    }

    return {
      provider: this.id,
      model: this.modelId,
      modelDigest: model.digest ?? embeddingContentHash(this.modelId),
      dimensions: model.dimensions,
      results,
      failures,
      latencyMs: Date.now() - startedAt,
      dataLeftDevice: false,
      batchId: request.batchId,
    };
  }

  async getDimensions() {
    return (await this.getModelInfo()).dimensions;
  }

  async getModelInfo(): Promise<EmbeddingModelProfile> {
    const tag = await this.findInstalledEmbeddingModel();
    if (!tag) {
      throw new EmbeddingProviderError("EMBEDDING_MODEL_NOT_FOUND", `Ollama embedding model ${this.modelId} is not installed`, { retryable: false, stage: "ollama-embedding-model" });
    }
    return profileFromOllamaTag(tag, this.modelId);
  }

  async estimateTokens(text: string) {
    return estimateEmbeddingTokens(text);
  }

  async health(): Promise<EmbeddingProviderHealth> {
    const startedAt = Date.now();
    try {
      const model = await this.getModelInfo();
      return {
        provider: this.id,
        status: "ready",
        model: model.modelId,
        modelDigest: model.digest,
        dimensions: model.dimensions,
        latencyMs: Date.now() - startedAt,
        dataLeftDevice: false,
      };
    } catch (error) {
      const embeddingError = this.toEmbeddingError(error, "ollama-embedding-health");
      return {
        provider: this.id,
        status: embeddingError.code === "EMBEDDING_MODEL_NOT_FOUND" ? "model_not_installed" : "unavailable",
        latencyMs: Date.now() - startedAt,
        dataLeftDevice: false,
        errorCode: embeddingError.code,
      };
    }
  }

  async cancel(requestId: string) {
    this.cancelled.add(requestId);
    return true;
  }

  async getCapabilities(): Promise<EmbeddingProviderCapabilities> {
    const models = await this.getAvailableModelProfiles();
    return {
      provider: this.id,
      status: models.some((model) => model.enabled) ? "ready" : "model_not_installed",
      models,
      supportsBatch: true,
      supportsAbort: true,
      dataLeavesDevice: false,
      maxBatchSize: this.maxBatchSize,
    };
  }

  private async getAvailableModelProfiles() {
    try {
      const tags = await this.client.tags();
      const models = tags.models ?? [];
      return ["nomic-embed-text", "bge-m3", "multilingual-e5"].map((modelId) => {
        const tag = findModelTag(models, modelId);
        return tag ? profileFromOllamaTag(tag, modelId) : profileFromModelId(modelId, false);
      });
    } catch {
      return ["nomic-embed-text", "bge-m3", "multilingual-e5"].map((modelId) => profileFromModelId(modelId, false));
    }
  }

  private async findInstalledEmbeddingModel() {
    const tags = await this.client.tags();
    const tag = findModelTag(tags.models ?? [], this.modelId);
    if (!tag || !(tag.capabilities ?? []).includes("embedding")) return null;
    return tag;
  }

  private validateText(text: string) {
    if (!text) {
      throw new EmbeddingProviderError("EMBEDDING_INVALID_VECTOR", "Embedding input text is empty after normalization", { stage: "ollama-embedding-input" });
    }
  }

  private throwIfCancelled(requestId: string, signal?: AbortSignal) {
    if (this.cancelled.has(requestId) || signal?.aborted) {
      throw new EmbeddingProviderError("EMBEDDING_CANCELLED", "Embedding request was cancelled", { stage: "ollama-embedding-cancel" });
    }
  }

  private toEmbeddingError(error: unknown, stage: string) {
    if (error instanceof EmbeddingProviderError) return error;
    if (error instanceof AiProviderError) {
      if (error.code === "AI_PROVIDER_TIMEOUT") return new EmbeddingProviderError("EMBEDDING_TIMEOUT", error.message, { retryable: true, stage });
      if (error.code === "AI_PROVIDER_MODEL_NOT_FOUND") return new EmbeddingProviderError("EMBEDDING_MODEL_NOT_FOUND", error.message, { retryable: false, stage });
      return new EmbeddingProviderError("EMBEDDING_PROVIDER_UNAVAILABLE", error.message, { retryable: error.retryable, stage });
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      return new EmbeddingProviderError("EMBEDDING_CANCELLED", "Embedding request was cancelled", { retryable: false, stage });
    }
    return new EmbeddingProviderError("EMBEDDING_PROVIDER_UNAVAILABLE", error instanceof Error ? error.message : "Ollama embedding provider failed", { retryable: true, stage });
  }
}

function findModelTag(models: OllamaModelTag[], modelId: string) {
  return models.find((model) => model.model === modelId || model.name === modelId || model.model === `${modelId}:latest` || model.name === `${modelId}:latest`);
}

function profileFromOllamaTag(tag: OllamaModelTag, requestedModelId: string) {
  const modelId = stripLatestTag(tag.model ?? tag.name ?? requestedModelId);
  const profile = profileFromModelId(modelId, true, tag.digest);
  const dimensions = Number(tag.details?.embedding_length ?? profile.dimensions);
  const maxInputTokens = Number(tag.details?.context_length ?? profile.maxInputTokens);
  return {
    ...profile,
    modelId,
    dimensions: Number.isFinite(dimensions) && dimensions > 0 ? dimensions : profile.dimensions,
    maxInputTokens: Number.isFinite(maxInputTokens) && maxInputTokens > 0 ? maxInputTokens : profile.maxInputTokens,
    installed: true,
    enabled: (tag.capabilities ?? []).includes("embedding"),
    digest: tag.digest,
    normalizationVersion: EMBEDDING_NORMALIZATION_VERSION,
  };
}

function stripLatestTag(modelId: string) {
  return modelId.endsWith(":latest") ? modelId.slice(0, -":latest".length) : modelId;
}

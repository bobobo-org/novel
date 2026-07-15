import type { EmbeddingModelProfile, EmbeddingProviderId } from "./embedding-types";

export type EmbeddingProviderCapabilities = {
  provider: EmbeddingProviderId;
  status: "ready" | "configured" | "unavailable" | "model_not_installed" | "not_implemented";
  models: EmbeddingModelProfile[];
  supportsBatch: boolean;
  supportsAbort: boolean;
  dataLeavesDevice: boolean;
  maxBatchSize: number;
};

export const EMBEDDING_NORMALIZATION_VERSION = "embedding-normalization-v1";

export const LOCAL_EMBEDDING_MODEL_PROFILES: Record<string, Omit<EmbeddingModelProfile, "installed" | "enabled" | "digest">> = {
  "nomic-embed-text": {
    modelId: "nomic-embed-text",
    family: "nomic",
    dimensions: 768,
    maxInputTokens: 8192,
    multilingual: true,
    recommendedChunkSize: 700,
    normalizationVersion: EMBEDDING_NORMALIZATION_VERSION,
  },
  "bge-m3": {
    modelId: "bge-m3",
    family: "bge",
    dimensions: 1024,
    maxInputTokens: 8192,
    multilingual: true,
    recommendedChunkSize: 800,
    normalizationVersion: EMBEDDING_NORMALIZATION_VERSION,
  },
  "multilingual-e5": {
    modelId: "multilingual-e5",
    family: "e5",
    dimensions: 1024,
    maxInputTokens: 512,
    multilingual: true,
    recommendedChunkSize: 450,
    normalizationVersion: EMBEDDING_NORMALIZATION_VERSION,
  },
};

export function profileFromModelId(modelId: string, installed = false, digest?: string): EmbeddingModelProfile {
  const base = LOCAL_EMBEDDING_MODEL_PROFILES[modelId] ?? {
    modelId,
    family: "unknown" as const,
    dimensions: 768,
    maxInputTokens: 2048,
    multilingual: false,
    recommendedChunkSize: 500,
    normalizationVersion: EMBEDDING_NORMALIZATION_VERSION,
  };
  return { ...base, installed, enabled: installed, digest };
}

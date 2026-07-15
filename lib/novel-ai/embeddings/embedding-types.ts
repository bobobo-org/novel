import type { EmbeddingErrorCode } from "./embedding-errors";

export type EmbeddingProviderId = "ollama-embedding" | "browser-ai-embedding" | "test-deterministic-embedding";
export type EmbeddingPrivacyMode = "local_only" | "local_first" | "external_allowed";
export type EmbeddingContentType =
  | "chapter_summary"
  | "chapter_segment"
  | "scene"
  | "paragraph_group"
  | "dialogue_block"
  | "canonical_entity"
  | "canonical_field"
  | "event"
  | "timeline_entry"
  | "foreshadow"
  | "open_thread"
  | "source_excerpt"
  | "generation_draft";

export type EmbeddingModelProfile = {
  modelId: string;
  family: "nomic" | "bge" | "e5" | "unknown";
  dimensions: number;
  maxInputTokens: number;
  multilingual: boolean;
  recommendedChunkSize: number;
  installed: boolean;
  enabled: boolean;
  digest?: string;
  normalizationVersion: string;
};

export type EmbeddingRequest = {
  requestId: string;
  projectId: string;
  text: string;
  contentType: EmbeddingContentType;
  language?: string;
  normalizationVersion: string;
  privacyMode: EmbeddingPrivacyMode;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
};

export type EmbeddingBatchRequest = Omit<EmbeddingRequest, "text" | "requestId"> & {
  batchId: string;
  items: Array<{ requestId: string; text: string; contentType?: EmbeddingContentType }>;
};

export type EmbeddingResult = {
  provider: EmbeddingProviderId;
  model: string;
  modelDigest?: string;
  dimensions: number;
  vector: number[];
  normalized: boolean;
  latencyMs: number;
  dataLeftDevice: boolean;
  requestId: string;
};

export type EmbeddingBatchResult = {
  provider: EmbeddingProviderId;
  model: string;
  modelDigest?: string;
  dimensions: number;
  results: EmbeddingResult[];
  failures: Array<{ requestId: string; errorCode: EmbeddingErrorCode; message: string }>;
  latencyMs: number;
  dataLeftDevice: boolean;
  batchId: string;
};

export type EmbeddingProviderHealth = {
  provider: EmbeddingProviderId;
  status: "ready" | "configured" | "unavailable" | "model_not_installed" | "not_implemented";
  model?: string;
  modelDigest?: string;
  dimensions?: number;
  latencyMs: number;
  dataLeftDevice: boolean;
  errorCode?: EmbeddingErrorCode;
};

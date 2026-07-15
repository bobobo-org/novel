import type { EmbeddingProviderCapabilities } from "./embedding-capabilities";
import type { EmbeddingBatchRequest, EmbeddingBatchResult, EmbeddingProviderHealth, EmbeddingRequest, EmbeddingResult } from "./embedding-types";

export interface EmbeddingProvider {
  readonly id: EmbeddingProviderCapabilities["provider"];
  embedText(request: EmbeddingRequest): Promise<EmbeddingResult>;
  embedBatch(request: EmbeddingBatchRequest): Promise<EmbeddingBatchResult>;
  getDimensions(): Promise<number>;
  getModelInfo(): Promise<EmbeddingProviderCapabilities["models"][number]>;
  estimateTokens(text: string): Promise<number>;
  health(): Promise<EmbeddingProviderHealth>;
  cancel(requestId: string): Promise<boolean>;
  getCapabilities(): Promise<EmbeddingProviderCapabilities>;
}

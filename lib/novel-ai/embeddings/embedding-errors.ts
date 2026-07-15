export type EmbeddingErrorCode =
  | "EMBEDDING_PROVIDER_UNAVAILABLE"
  | "EMBEDDING_MODEL_NOT_FOUND"
  | "EMBEDDING_CONTEXT_TOO_LARGE"
  | "EMBEDDING_INVALID_VECTOR"
  | "EMBEDDING_DIMENSION_MISMATCH"
  | "EMBEDDING_TIMEOUT"
  | "EMBEDDING_CANCELLED"
  | "EMBEDDING_BATCH_PARTIAL_FAILURE"
  | "EMBEDDING_MODEL_CHANGED";

export class EmbeddingProviderError extends Error {
  code: EmbeddingErrorCode;
  retryable: boolean;
  stage: string;

  constructor(code: EmbeddingErrorCode, message: string, options: { retryable?: boolean; stage?: string } = {}) {
    super(message);
    this.name = "EmbeddingProviderError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.stage = options.stage ?? "embedding-provider";
  }

  toJSON() {
    return {
      errorCode: this.code,
      errorType: this.name,
      stage: this.stage,
      retryable: this.retryable,
      userMessage: this.message,
    };
  }
}

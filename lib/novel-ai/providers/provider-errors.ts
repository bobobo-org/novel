export type AiProviderErrorCode =
  | "AI_PROVIDER_UNAVAILABLE"
  | "AI_PROVIDER_TIMEOUT"
  | "AI_PROVIDER_CONNECTION_FAILED"
  | "AI_PROVIDER_MODEL_NOT_FOUND"
  | "AI_PROVIDER_CONTEXT_TOO_LARGE"
  | "AI_PROVIDER_INVALID_RESPONSE"
  | "AI_PROVIDER_SCHEMA_MISMATCH"
  | "AI_PROVIDER_CANCELLED"
  | "AI_PROVIDER_PERMISSION_DENIED"
  | "AI_PROVIDER_RATE_LIMITED"
  | "AI_PROVIDER_CONFIGURATION_INVALID"
  | "AI_NO_ALLOWED_PROVIDER"
  | "AI_LOCAL_PROVIDER_REQUIRED"
  | "AI_EXTERNAL_PROVIDER_BLOCKED";

export class AiProviderError extends Error {
  code: AiProviderErrorCode;
  retryable: boolean;
  stage: string;

  constructor(code: AiProviderErrorCode, message: string, options: { retryable?: boolean; stage?: string } = {}) {
    super(message);
    this.name = "AiProviderError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.stage = options.stage ?? "provider";
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

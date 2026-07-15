import { AiProviderError } from "../provider-errors";

export class OllamaSecurityError extends AiProviderError {
  constructor(message: string) {
    super("AI_PROVIDER_PERMISSION_DENIED", message, { stage: "ollama-security" });
  }
}

export class OllamaConnectionError extends AiProviderError {
  constructor(message: string) {
    super("AI_PROVIDER_CONNECTION_FAILED", message, { retryable: true, stage: "ollama-client" });
  }
}

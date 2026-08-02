export const NOVEL_AI_EXECUTION_MODES = ["closed-only", "hybrid", "external-only"] as const;
export type NovelAIExecutionMode = (typeof NOVEL_AI_EXECUTION_MODES)[number];

export const EXTERNAL_AI_PROVIDER_IDS = ["openai", "gemini", "grok", "claude"] as const;
export type ExternalAIProviderId = (typeof EXTERNAL_AI_PROVIDER_IDS)[number];

export const EXTERNAL_AI_PROVIDER_VERIFICATION_STATES = [
  "not_configured",
  "configured_unverified",
  "verified",
  "failed",
] as const;
export type ExternalAIProviderVerificationState =
  (typeof EXTERNAL_AI_PROVIDER_VERIFICATION_STATES)[number];

export type ExternalAIProviderPublicStatus = {
  id: ExternalAIProviderId;
  label: string;
  configured: boolean;
  verification: ExternalAIProviderVerificationState;
  verificationCode: string;
  verifiedAt: string | null;
  checkedAt: string | null;
  modelId: string;
  keyEnvironmentVariable: string;
  modelEnvironmentVariable: string;
  apiStyle: string;
  dataLeavesDevice: true;
  serverSideCredentialOnly: true;
};

export type ExternalAIGenerationRequest = {
  executionMode: NovelAIExecutionMode;
  providerId: ExternalAIProviderId;
  externalConsent: boolean;
  prompt: string;
  systemInstruction?: string;
  requestId?: string;
  maxOutputTokens?: number;
  temperature?: number;
  /** Server-derived, privacy-preserving identifier. Browser input is ignored. */
  safetyIdentifier?: string;
  signal?: AbortSignal;
};

export type ExternalAIGenerationResult = {
  requestId: string;
  providerId: ExternalAIProviderId;
  modelId: string;
  text: string;
  candidateOnly: true;
  dataLeavesDevice: true;
  externalRequest: true;
  serverStoredByApplication: false;
  elapsedMs: number;
  generatedTokenEvents: number;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
};

export type ExternalAIStreamEvent =
  | {
      type: "start";
      requestId: string;
      providerId: ExternalAIProviderId;
      modelId: string;
    }
  | {
      type: "delta";
      delta: string;
      generatedTokenEvents: number;
    }
  | {
      type: "complete";
      result: ExternalAIGenerationResult;
    };

export function isNovelAIExecutionMode(value: unknown): value is NovelAIExecutionMode {
  return typeof value === "string" && NOVEL_AI_EXECUTION_MODES.includes(value as NovelAIExecutionMode);
}

export function isExternalAIProviderId(value: unknown): value is ExternalAIProviderId {
  return typeof value === "string" && EXTERNAL_AI_PROVIDER_IDS.includes(value as ExternalAIProviderId);
}

function isFiniteNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

export function isExternalAIGenerationResult(value: unknown): value is ExternalAIGenerationResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  const usage = result.usage;
  if (!usage || typeof usage !== "object") return false;
  const tokenUsage = usage as Record<string, unknown>;
  return typeof result.requestId === "string"
    && result.requestId.length > 0
    && isExternalAIProviderId(result.providerId)
    && typeof result.modelId === "string"
    && result.modelId.length > 0
    && typeof result.text === "string"
    && result.text.trim().length > 0
    && result.candidateOnly === true
    && result.dataLeavesDevice === true
    && result.externalRequest === true
    && result.serverStoredByApplication === false
    && typeof result.elapsedMs === "number"
    && Number.isFinite(result.elapsedMs)
    && result.elapsedMs >= 0
    && typeof result.generatedTokenEvents === "number"
    && Number.isInteger(result.generatedTokenEvents)
    && result.generatedTokenEvents >= 0
    && isFiniteNumberOrNull(tokenUsage.inputTokens)
    && isFiniteNumberOrNull(tokenUsage.outputTokens)
    && isFiniteNumberOrNull(tokenUsage.totalTokens);
}

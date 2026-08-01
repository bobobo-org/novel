export const NOVEL_AI_EXECUTION_MODES = ["closed-only", "hybrid", "external-only"] as const;
export type NovelAIExecutionMode = (typeof NOVEL_AI_EXECUTION_MODES)[number];

export const EXTERNAL_AI_PROVIDER_IDS = ["openai", "gemini", "grok", "claude"] as const;
export type ExternalAIProviderId = (typeof EXTERNAL_AI_PROVIDER_IDS)[number];

export type ExternalAIProviderPublicStatus = {
  id: ExternalAIProviderId;
  label: string;
  configured: boolean;
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

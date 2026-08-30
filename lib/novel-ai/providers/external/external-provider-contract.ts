import type { ExternalRpgConsentAssertion } from "./external-rpg-consent-contract";

export const NOVEL_AI_EXECUTION_MODES = ["closed-only", "hybrid", "external-only"] as const;
export type NovelAIExecutionMode = (typeof NOVEL_AI_EXECUTION_MODES)[number];

export const EXTERNAL_AI_PROVIDER_IDS = [
  "openai",
  "gemini",
  "grok",
  "claude",
  "openai-compatible",
] as const;
export type ExternalAIProviderId = (typeof EXTERNAL_AI_PROVIDER_IDS)[number];

export const EXTERNAL_AI_PROVIDER_LABELS: Record<ExternalAIProviderId, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  grok: "Grok",
  claude: "Claude",
  "openai-compatible": "OpenAI-compatible／AI Gateway",
};

export const EXTERNAL_AI_CONNECTION_CATALOG = [
  {
    group: "原生直連",
    route: "native",
    providers: ["OpenAI／ChatGPT API", "Google Gemini", "xAI Grok", "Anthropic Claude"],
  },
  {
    group: "OpenAI 相容雲端",
    route: "openai-compatible",
    providers: [
      "OpenRouter",
      "Groq",
      "Together AI",
      "DeepSeek",
      "Mistral AI",
      "Fireworks AI",
      "Perplexity",
      "Qwen／DashScope",
      "Kimi／Moonshot",
      "SiliconFlow",
      "Hugging Face Inference",
      "NVIDIA NIM",
      "Cerebras",
      "SambaNova",
    ],
  },
  {
    group: "AI Gateway／企業雲",
    route: "gateway",
    providers: [
      "Vercel AI Gateway",
      "LiteLLM",
      "Portkey",
      "Cloudflare AI Gateway",
      "Helicone Gateway",
      "Azure OpenAI",
      "Google Vertex AI",
      "AWS Bedrock",
      "IBM watsonx.ai",
      "Oracle OCI Generative AI",
      "Cohere",
    ],
  },
  {
    group: "自架／私有 HTTPS 端點",
    route: "openai-compatible",
    providers: [
      "vLLM",
      "SGLang",
      "Hugging Face TGI",
      "LocalAI",
      "LM Studio",
      "llama.cpp server",
      "Ollama OpenAI compatibility",
      "自訂 OpenAI-compatible Gateway",
    ],
  },
] as const;

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
  endpointEnvironmentVariable?: string;
  apiStyle: string;
  connectionRoute: "native" | "openai-compatible" | "gateway";
  dataLeavesDevice: true;
  serverSideCredentialOnly: true;
};

export type ExternalAIGenerationRequest = {
  executionMode: NovelAIExecutionMode;
  providerId: ExternalAIProviderId;
  externalConsent: boolean;
  /** Declares the narrower server-side validation path for this operation. */
  operation?: "generic-candidate" | "rpg-turn";
  /** Exact, short-lived single-run binding required for bounded RPG egress. */
  rpgConsentAssertion?: ExternalRpgConsentAssertion;
  rpgProjectId?: string;
  rpgFieldManifestDigest?: string;
  /** Canonical, server-revalidated bounded reader-visible RPG context. */
  rpgPublicPayload?: unknown;
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

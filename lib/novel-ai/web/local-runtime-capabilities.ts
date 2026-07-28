export const WEB_LOCAL_RUNTIME_PROTOCOL_VERSION = "novel-local-runtime-v1";
export const WEB_LOCAL_RUNTIME_CLIENT_VERSION = "h2w1r1-resilient-web-local-runtime-client";

export type WebRuntimeCapability =
  | "generation"
  | "embedding"
  | "sqlite"
  | "ollama"
  | "local-rule"
  | "task-queue"
  | "streaming"
  | "cancellation"
  | "scenario-discovery";

export type WebRuntimeCapabilityInput = WebRuntimeCapability | "cancel";

const CAPABILITIES = new Set<WebRuntimeCapability>([
  "generation",
  "embedding",
  "sqlite",
  "ollama",
  "local-rule",
  "task-queue",
  "streaming",
  "cancellation",
  "scenario-discovery",
]);

export function normalizeWebRuntimeCapabilities(input: unknown): WebRuntimeCapability[] {
  if (!Array.isArray(input)) return [];
  const normalized = input
    .map((value) => value === "cancel" ? "cancellation" : value)
    .filter((value): value is WebRuntimeCapability => typeof value === "string" && CAPABILITIES.has(value as WebRuntimeCapability));
  return [...new Set(normalized)];
}

export type WebRuntimeStatus = "unknown" | "discovering" | "ready" | "auth_required" | "unavailable" | "version_mismatch" | "error";

export type WebRuntimeHealth = {
  localRuntimeStatus: string;
  localRuntimeVersion?: string;
  localRuntimeProtocolVersion?: string;
  localRuntimeAuthStatus?: string;
  selectedStorage?: string;
  ollamaStatus?: string;
  installedModels?: string[];
  selectedModel?: string | null;
  dataLeftDevice?: boolean;
  handshake?: WebRuntimeHandshake;
};

export type WebRuntimeHandshake = {
  runtimeVersion: string;
  protocolVersion: string;
  capabilities: WebRuntimeCapabilityInput[];
  selectedStorage: string;
  ollamaStatus: string;
  installedModels: string[];
  sessionId?: string;
  serverNonce?: string;
  clientNonceRequired: boolean;
  authenticated: boolean;
  expiresAt?: string;
};

export type WebRuntimeSnapshot = {
  clientVersion: string;
  status: WebRuntimeStatus;
  protocolVersion: string;
  runtimeVersion: string;
  runtimeUrl: string;
  ollamaStatus: string;
  selectedModel: string;
  selectedStorage: string;
  capabilities: WebRuntimeCapability[];
  dataLeftDevice: boolean;
  externalFallbackAllowed: boolean;
  lastHealthCheckAt: string;
  lastErrorCode: string | null;
};

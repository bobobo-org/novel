export const WEB_LOCAL_RUNTIME_PROTOCOL_VERSION = "novel-local-runtime-v1";
export const WEB_LOCAL_RUNTIME_CLIENT_VERSION = "h2w1-web-local-runtime-client";

export type WebRuntimeCapability =
  | "sqlite"
  | "ollama"
  | "local-rule"
  | "task-queue"
  | "streaming"
  | "cancellation"
  | "scenario-discovery";

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
  capabilities: WebRuntimeCapability[];
  selectedStorage: string;
  ollamaStatus: string;
  installedModels: string[];
  sessionId: string;
  serverNonce: string;
  clientNonceRequired: boolean;
  authenticated: boolean;
  expiresAt: string;
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

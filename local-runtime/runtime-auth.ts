import crypto from "crypto";
import type { IncomingMessage } from "http";
import type { LocalRuntimeConfig } from "./runtime-config";
import { LOCAL_RUNTIME_PROTOCOL_VERSION, LOCAL_RUNTIME_VERSION } from "./runtime-config";
import { LocalRuntimeError } from "./runtime-errors";

export type LocalRuntimeSession = {
  sessionId?: string;
  serverNonce?: string;
  authenticated: boolean;
  expiresAt?: string;
};

export function allowedLocalRuntimeOrigin(req: IncomingMessage, config: LocalRuntimeConfig) {
  const origin = String(req.headers.origin || "");
  if (!origin) return "";
  let normalized = "";
  try {
    const parsed = new URL(origin);
    if (parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) throw new Error("invalid origin");
    normalized = parsed.origin;
  } catch {
    throw new LocalRuntimeError("LOCAL_RUNTIME_ORIGIN_BLOCKED", "Origin is not allowed for local runtime.", 403);
  }
  if (origin !== normalized || !config.allowedOrigins.includes(normalized)) {
    throw new LocalRuntimeError("LOCAL_RUNTIME_ORIGIN_BLOCKED", "Origin is not allowed for local runtime.", 403);
  }
  return normalized;
}

export function validateLocalRuntimeRequest(req: IncomingMessage, config: LocalRuntimeConfig) {
  allowedLocalRuntimeOrigin(req, config);
  const token = String(req.headers["x-novel-local-token"] || "");
  if (token !== config.token) {
    throw new LocalRuntimeError("LOCAL_RUNTIME_AUTH_REQUIRED", "Local runtime token is missing or invalid.", 401);
  }
}

export function createHandshake(config: LocalRuntimeConfig, details: { ollamaStatus: string; installedModels: string[]; selectedStorage: string }, options: { authenticated?: boolean } = {}): LocalRuntimeSession & {
  runtimeVersion: string;
  protocolVersion: string;
  capabilities: string[];
  selectedStorage: string;
  ollamaStatus: string;
  installedModels: string[];
  clientNonceRequired: boolean;
} {
  const authenticated = options.authenticated === true;
  const handshake = {
    runtimeVersion: LOCAL_RUNTIME_VERSION,
    protocolVersion: LOCAL_RUNTIME_PROTOCOL_VERSION,
    capabilities: ["generation", "sqlite", "ollama", "local-rule", "task-queue", "streaming", "cancellation"],
    selectedStorage: details.selectedStorage,
    ollamaStatus: details.ollamaStatus,
    installedModels: details.installedModels,
    clientNonceRequired: false,
    authenticated,
  };
  if (!authenticated) return handshake;
  return {
    ...handshake,
    sessionId: crypto.randomUUID(),
    serverNonce: crypto.randomBytes(16).toString("hex"),
    expiresAt: new Date(Date.now() + config.sessionTtlMs).toISOString(),
  };
}

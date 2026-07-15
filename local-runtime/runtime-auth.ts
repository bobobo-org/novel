import crypto from "crypto";
import type { IncomingMessage } from "http";
import type { LocalRuntimeConfig } from "./runtime-config";
import { LOCAL_RUNTIME_PROTOCOL_VERSION, LOCAL_RUNTIME_VERSION } from "./runtime-config";
import { LocalRuntimeError } from "./runtime-errors";

export type LocalRuntimeSession = {
  sessionId: string;
  serverNonce: string;
  authenticated: boolean;
  expiresAt: string;
};

export function validateLocalRuntimeRequest(req: IncomingMessage, config: LocalRuntimeConfig) {
  const origin = String(req.headers.origin || "");
  if (origin && !config.allowedOrigins.some((allowed) => origin.startsWith(allowed))) {
    throw new LocalRuntimeError("LOCAL_RUNTIME_ORIGIN_BLOCKED", "Origin is not allowed for local runtime.", 403);
  }
  const token = String(req.headers["x-novel-local-token"] || "");
  if (token !== config.token) {
    throw new LocalRuntimeError("LOCAL_RUNTIME_AUTH_REQUIRED", "Local runtime token is missing or invalid.", 401);
  }
}

export function createHandshake(config: LocalRuntimeConfig, details: { ollamaStatus: string; installedModels: string[]; selectedStorage: string }): LocalRuntimeSession & {
  runtimeVersion: string;
  protocolVersion: string;
  capabilities: string[];
  selectedStorage: string;
  ollamaStatus: string;
  installedModels: string[];
  clientNonceRequired: boolean;
} {
  return {
    runtimeVersion: LOCAL_RUNTIME_VERSION,
    protocolVersion: LOCAL_RUNTIME_PROTOCOL_VERSION,
    capabilities: ["sqlite", "ollama", "local-rule", "task-queue", "streaming", "cancellation"],
    selectedStorage: details.selectedStorage,
    ollamaStatus: details.ollamaStatus,
    installedModels: details.installedModels,
    sessionId: crypto.randomUUID(),
    serverNonce: crypto.randomBytes(16).toString("hex"),
    clientNonceRequired: true,
    authenticated: true,
    expiresAt: new Date(Date.now() + config.sessionTtlMs).toISOString(),
  };
}

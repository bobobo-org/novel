import {
  normalizeWebRuntimeCapabilities,
  WEB_LOCAL_RUNTIME_PROTOCOL_VERSION,
  type WebRuntimeHandshake,
  type WebRuntimeHealth,
} from "./local-runtime-capabilities";
import { WebLocalRuntimeError } from "./local-runtime-errors";
import { createClientNonce, type WebLocalRuntimeSession } from "./local-runtime-session";

export function validateRuntimeUrl(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:") {
    throw new WebLocalRuntimeError("LOCAL_RUNTIME_URL_INVALID", "Local runtime URL must use HTTP on the loopback interface.");
  }
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new WebLocalRuntimeError("LOCAL_RUNTIME_HOST_NOT_ALLOWED", "Local runtime URL must use localhost or 127.0.0.1.");
  }
  if (parsed.searchParams.has("token") || parsed.searchParams.has("auth")) {
    throw new WebLocalRuntimeError("LOCAL_RUNTIME_TOKEN_IN_URL_BLOCKED", "Local runtime tokens must not be sent in query strings.");
  }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new WebLocalRuntimeError("LOCAL_RUNTIME_URL_INVALID", "Local runtime URL must contain only a loopback origin.");
  }
  return parsed;
}

export function validateHandshake(health: WebRuntimeHealth, options: { requireAuthenticated?: boolean } = {}): WebRuntimeHandshake {
  const handshake = health.handshake;
  if (!handshake) throw new WebLocalRuntimeError("LOCAL_RUNTIME_AUTH_FAILED", "Local runtime did not return a handshake.");
  if (handshake.protocolVersion !== WEB_LOCAL_RUNTIME_PROTOCOL_VERSION) {
    throw new WebLocalRuntimeError("LOCAL_RUNTIME_VERSION_MISMATCH", `Expected ${WEB_LOCAL_RUNTIME_PROTOCOL_VERSION}, got ${handshake.protocolVersion}.`);
  }
  if (!handshake.runtimeVersion || !handshake.selectedStorage || !Array.isArray(handshake.installedModels)) {
    throw new WebLocalRuntimeError("LOCAL_RUNTIME_SCHEMA_MISMATCH", "Local runtime returned an incomplete handshake.");
  }
  const capabilities = normalizeWebRuntimeCapabilities(handshake.capabilities);
  if (!capabilities.length) {
    throw new WebLocalRuntimeError("LOCAL_RUNTIME_SCHEMA_MISMATCH", "Local runtime returned no recognized capabilities.");
  }
  if (options.requireAuthenticated && (
    handshake.authenticated !== true
    || !handshake.sessionId
    || !handshake.serverNonce
    || !handshake.expiresAt
  )) {
    throw new WebLocalRuntimeError("LOCAL_RUNTIME_AUTH_FAILED", "Local runtime session was not authenticated.");
  }
  return { ...handshake, capabilities };
}

export function createWebRuntimeSession(handshake: WebRuntimeHandshake, token?: string): WebLocalRuntimeSession {
  if (!handshake.authenticated || !handshake.sessionId || !handshake.serverNonce || !handshake.expiresAt) {
    throw new WebLocalRuntimeError("LOCAL_RUNTIME_AUTH_FAILED", "Cannot create a client session from an unauthenticated handshake.");
  }
  return {
    sessionId: handshake.sessionId,
    serverNonce: handshake.serverNonce,
    clientNonce: createClientNonce(),
    tokenPresent: Boolean(token),
    expiresAt: handshake.expiresAt,
  };
}

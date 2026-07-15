import { WEB_LOCAL_RUNTIME_PROTOCOL_VERSION, type WebRuntimeHandshake, type WebRuntimeHealth } from "./local-runtime-capabilities";
import { WebLocalRuntimeError } from "./local-runtime-errors";
import { createClientNonce, type WebLocalRuntimeSession } from "./local-runtime-session";

export function validateRuntimeUrl(url: string) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new WebLocalRuntimeError("LOCAL_RUNTIME_HOST_NOT_ALLOWED", "Local runtime URL must use localhost or 127.0.0.1.");
  }
  if (parsed.searchParams.has("token") || parsed.searchParams.has("auth")) {
    throw new WebLocalRuntimeError("LOCAL_RUNTIME_TOKEN_IN_URL_BLOCKED", "Local runtime tokens must not be sent in query strings.");
  }
  return parsed;
}

export function validateHandshake(health: WebRuntimeHealth): WebRuntimeHandshake {
  const handshake = health.handshake;
  if (!handshake) throw new WebLocalRuntimeError("LOCAL_RUNTIME_AUTH_FAILED", "Local runtime did not return a handshake.");
  if (handshake.protocolVersion !== WEB_LOCAL_RUNTIME_PROTOCOL_VERSION) {
    throw new WebLocalRuntimeError("LOCAL_RUNTIME_VERSION_MISMATCH", `Expected ${WEB_LOCAL_RUNTIME_PROTOCOL_VERSION}, got ${handshake.protocolVersion}.`);
  }
  return handshake;
}

export function createWebRuntimeSession(handshake: WebRuntimeHandshake, token?: string): WebLocalRuntimeSession {
  return {
    sessionId: handshake.sessionId,
    serverNonce: handshake.serverNonce,
    clientNonce: createClientNonce(),
    tokenPresent: Boolean(token),
    expiresAt: handshake.expiresAt,
  };
}

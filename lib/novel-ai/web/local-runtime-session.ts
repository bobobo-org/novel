import crypto from "crypto";

export type WebLocalRuntimeSession = {
  sessionId: string;
  clientNonce: string;
  serverNonce: string;
  tokenPresent: boolean;
  expiresAt: string;
};

export function createClientNonce() {
  return crypto.randomBytes(16).toString("hex");
}

export function sessionExpired(session: WebLocalRuntimeSession | null, now = Date.now()) {
  if (!session) return true;
  const expiresAt = Date.parse(session.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

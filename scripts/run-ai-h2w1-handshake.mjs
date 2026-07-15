import { WEB_LOCAL_RUNTIME_CLIENT_VERSION, WEB_LOCAL_RUNTIME_PROTOCOL_VERSION } from "../lib/novel-ai/web/local-runtime-capabilities.ts";
import { validateHandshake, validateRuntimeUrl, createWebRuntimeSession } from "../lib/novel-ai/web/local-runtime-handshake.ts";
import { createClientNonce, sessionExpired } from "../lib/novel-ai/web/local-runtime-session.ts";
import { WebLocalRuntimeError } from "../lib/novel-ai/web/local-runtime-errors.ts";
import { createHarness, goodHealth } from "./run-ai-h2w1-test-utils.mjs";

const t = createHarness("H2W1 handshake");
const handshake = validateHandshake(goodHealth);
t.equal(WEB_LOCAL_RUNTIME_PROTOCOL_VERSION, "novel-local-runtime-v1", "protocol constant");
t.equal(WEB_LOCAL_RUNTIME_CLIENT_VERSION, "h2w1-web-local-runtime-client", "client version constant");
t.equal(handshake.sessionId, "session-test", "server session accepted");
t.equal(handshake.serverNonce, "server-nonce", "server nonce accepted");
t.ok(handshake.capabilities.includes("streaming"), "streaming capability exchanged");
t.ok(handshake.capabilities.includes("cancel"), "cancel capability exchanged");
t.equal(validateRuntimeUrl("http://localhost:43117").hostname, "localhost", "localhost allowed");
t.equal(validateRuntimeUrl("http://127.0.0.1:43117").hostname, "127.0.0.1", "127.0.0.1 allowed");

const session = createWebRuntimeSession(handshake, "token");
t.equal(session.sessionId, "session-test", "session id copied");
t.equal(session.serverNonce, "server-nonce", "server nonce copied");
t.ok(session.clientNonce.length >= 24, "client nonce generated");
t.equal(session.tokenPresent, true, "token presence tracked");
t.equal(sessionExpired(session), false, "fresh session not expired");
t.equal(sessionExpired({ ...session, expiresAt: new Date(Date.now() - 1000).toISOString() }), true, "expired session detected");
t.equal(sessionExpired(null), true, "missing session treated expired");
t.ok(createClientNonce() !== createClientNonce(), "client nonce is unique");

for (const url of ["http://evil.example:43117", "http://10.0.0.1:43117", "http://localhost:43117?auth=x", "http://localhost:43117?token=x"]) {
  try {
    validateRuntimeUrl(url);
    t.ok(false, `unsafe runtime URL rejected ${url}`);
  } catch (error) {
    t.ok(error instanceof WebLocalRuntimeError, `unsafe runtime URL rejected ${url}`);
  }
}

for (const health of [{}, { handshake: {} }, { handshake: { protocolVersion: "x" } }]) {
  try {
    validateHandshake(health);
    t.ok(false, "invalid handshake rejected");
  } catch (error) {
    t.ok(error instanceof WebLocalRuntimeError, "invalid handshake rejected");
  }
}

t.finish();

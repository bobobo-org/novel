import assert from "node:assert/strict";
import { parseLocalBridgeJson, validateLocalBridgeEvent } from "../../lib/novel-ai/providers/local-ollama/local-bridge-client.ts";

assert.throws(() => parseLocalBridgeJson("{"), (error) => error.code === "OLLAMA_INVALID_RESPONSE");
assert.throws(() => parseLocalBridgeJson("[]"), (error) => error.code === "OLLAMA_INVALID_RESPONSE");
const state = { started: false, completed: false };
assert.equal(validateLocalBridgeEvent({ type: "started", requestId: "request-1" }, "request-1", state).type, "started");
assert.throws(() => validateLocalBridgeEvent({ type: "token", requestId: "stale-request" }, "request-1", state), (error) => error.code === "LOCAL_REQUEST_IDENTITY_MISMATCH");
assert.equal(validateLocalBridgeEvent({ type: "completed", requestId: "request-1" }, "request-1", state).type, "completed");
assert.throws(() => validateLocalBridgeEvent({ type: "completed", requestId: "request-1" }, "request-1", state), (error) => error.code === "OLLAMA_INVALID_RESPONSE");
console.log(JSON.stringify({ suite: "r1k-local-bridge-response-validation", pass: 6, fail: 0, skip: 0 }));

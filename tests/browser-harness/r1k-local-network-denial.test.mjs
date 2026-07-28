import assert from "node:assert/strict";
import { classifyBridgeConnectivityError } from "../../lib/novel-ai/providers/local-ollama/local-bridge-client.ts";

const activeSignal = new AbortController().signal;
const timeoutController = new AbortController();
timeoutController.abort("timeout");

const denied = await classifyBridgeConnectivityError(new TypeError("Failed to fetch"), activeSignal, async () => "denied");
assert.equal(denied.code, "LOCAL_NETWORK_PERMISSION_DENIED");
assert.equal(denied.retryable, false);
assert.equal(denied.stage, "local-network-permission");

const timedOut = await classifyBridgeConnectivityError(new DOMException("aborted", "AbortError"), timeoutController.signal, async () => "prompt");
assert.equal(timedOut.code, "REQUEST_TIMEOUT");

const unreachable = await classifyBridgeConnectivityError(new TypeError("Failed to fetch"), activeSignal, async () => "unsupported");
assert.equal(unreachable.code, "BRIDGE_PROCESS_UNREACHABLE");

console.log(JSON.stringify({ suite: "r1k-local-network-denial", pass: 9, fail: 0, permissionDeniedCode: denied.code }));

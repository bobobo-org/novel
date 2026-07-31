import assert from "node:assert/strict";
import {
  LOCAL_BRIDGE_CONTROL_TIMEOUT_MS,
  LOCAL_BRIDGE_MODEL_VERIFICATION_TIMEOUT_MS,
  LOCAL_BRIDGE_PROTOCOL,
  LocalBridgeClient,
} from "../lib/novel-ai/providers/local-ollama/local-bridge-client.ts";
import {
  PRIVATE_HUB_CONTROL_TIMEOUT_MS,
  PRIVATE_HUB_MODEL_VERIFICATION_TIMEOUT_MS,
  PRIVATE_HUB_PROTOCOL,
  PrivateHubClient,
} from "../lib/novel-ai/providers/private-ai-hub/private-hub-client.ts";
import {
  LOCAL_BRIDGE_MODEL_DISCOVERY_SERVER_TIMEOUT_MS,
  LOCAL_BRIDGE_MODEL_INFERENCE_SERVER_TIMEOUT_MS,
} from "../local-ai/bridge/server.mjs";
import {
  PRIVATE_HUB_MODEL_DISCOVERY_SERVER_TIMEOUT_MS,
  PRIVATE_HUB_MODEL_INFERENCE_SERVER_TIMEOUT_MS,
} from "../local-ai/private-hub/server.mjs";

const SCALE_DIVISOR = 1_000;
const MODEL_RESPONSE_DELAY_MS = 10;
const originalFetch = globalThis.fetch;
const originalTimeout = AbortSignal.timeout;
const requestedTimeouts = [];

function scaledTimeout(timeoutMs) {
  requestedTimeouts.push(timeoutMs);
  const controller = new AbortController();
  setTimeout(
    () => controller.abort(new DOMException("The operation timed out.", "TimeoutError")),
    Math.max(1, Math.round(timeoutMs / SCALE_DIVISOR)),
  );
  return controller.signal;
}

async function delayWithSignal(delayMs, signal) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function localProof(modelId, instanceId) {
  return {
    proofVersion: "local-model-inference-proof-v1",
    state: "inference_verified",
    providerKind: "local_ollama",
    instanceId,
    modelId,
    modelDigest: "local-model-digest",
    verifiedAt: new Date().toISOString(),
    latencyMs: MODEL_RESPONSE_DELAY_MS,
    outputDigest: "a".repeat(64),
    outputBytes: 12,
    evalCount: 4,
    externalRequest: false,
    dataLeftDevice: false,
  };
}

function privateHubProof(modelId, instanceId) {
  return {
    proofVersion: "private-hub-model-inference-proof-v1",
    state: "inference_verified",
    providerKind: "private_ai_hub",
    deploymentKind: "self_hosted_loopback_private_node",
    instanceId,
    modelId,
    modelDigest: "private-model-digest",
    verifiedAt: new Date().toISOString(),
    latencyMs: MODEL_RESPONSE_DELAY_MS,
    outputDigest: "b".repeat(64),
    outputBytes: 12,
    evalCount: 4,
    externalRequest: false,
    dataLeftDevice: false,
  };
}

const localInstanceId = "local-timeout-regression";
const privateInstanceId = "private-timeout-regression";
const modelId = "qwen2.5:3b";

globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  if (href.endsWith("/health")) {
    return Response.json({
      protocolVersion: href.includes(":3217")
        ? LOCAL_BRIDGE_PROTOCOL
        : PRIVATE_HUB_PROTOCOL,
      instanceId: href.includes(":3217")
        ? localInstanceId
        : privateInstanceId,
    });
  }
  if (href.endsWith("/model/verify")) {
    await delayWithSignal(MODEL_RESPONSE_DELAY_MS, init.signal);
    return Response.json(
      href.includes(":3217")
        ? localProof(modelId, localInstanceId)
        : privateHubProof(modelId, privateInstanceId),
    );
  }
  throw new Error(`Unexpected timeout regression request: ${href}`);
};

AbortSignal.timeout = scaledTimeout;

try {
  assert.equal(LOCAL_BRIDGE_CONTROL_TIMEOUT_MS, 5_000);
  assert.equal(PRIVATE_HUB_CONTROL_TIMEOUT_MS, 5_000);
  assert.equal(LOCAL_BRIDGE_MODEL_VERIFICATION_TIMEOUT_MS, 60_000);
  assert.equal(PRIVATE_HUB_MODEL_VERIFICATION_TIMEOUT_MS, 60_000);
  assert.ok(
    LOCAL_BRIDGE_MODEL_VERIFICATION_TIMEOUT_MS
      > LOCAL_BRIDGE_MODEL_DISCOVERY_SERVER_TIMEOUT_MS
        + LOCAL_BRIDGE_MODEL_INFERENCE_SERVER_TIMEOUT_MS,
  );
  assert.ok(
    PRIVATE_HUB_MODEL_VERIFICATION_TIMEOUT_MS
      > PRIVATE_HUB_MODEL_DISCOVERY_SERVER_TIMEOUT_MS
        + PRIVATE_HUB_MODEL_INFERENCE_SERVER_TIMEOUT_MS,
  );

  const local = new LocalBridgeClient({
    origin: "https://preview.example",
    session: {
      token: "local-timeout-token",
      csrf: "local-timeout-csrf",
      instanceId: localInstanceId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  });
  await local.health();
  assert.equal(requestedTimeouts.at(-1), LOCAL_BRIDGE_CONTROL_TIMEOUT_MS);
  const localVerification = await local.verifyModel(modelId);
  assert.equal(localVerification.state, "inference_verified");
  assert.equal(
    requestedTimeouts.at(-1),
    LOCAL_BRIDGE_MODEL_VERIFICATION_TIMEOUT_MS,
  );

  const privateHub = new PrivateHubClient({
    origin: "https://preview.example",
    session: {
      token: "private-timeout-token",
      csrf: "private-timeout-csrf",
      instanceId: privateInstanceId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  });
  await privateHub.health();
  assert.equal(requestedTimeouts.at(-1), PRIVATE_HUB_CONTROL_TIMEOUT_MS);
  const privateVerification = await privateHub.verifyModel(modelId);
  assert.equal(privateVerification.state, "inference_verified");
  assert.equal(
    requestedTimeouts.at(-1),
    PRIVATE_HUB_MODEL_VERIFICATION_TIMEOUT_MS,
  );

  console.log(JSON.stringify({
    suite: "closed-ai-model-verification-timeout",
    status: "PASS",
    controlTimeoutMs: LOCAL_BRIDGE_CONTROL_TIMEOUT_MS,
    modelVerificationTimeoutMs: LOCAL_BRIDGE_MODEL_VERIFICATION_TIMEOUT_MS,
    localBridgeServerRouteBudgetMs:
      LOCAL_BRIDGE_MODEL_DISCOVERY_SERVER_TIMEOUT_MS
        + LOCAL_BRIDGE_MODEL_INFERENCE_SERVER_TIMEOUT_MS,
    privateHubServerRouteBudgetMs:
      PRIVATE_HUB_MODEL_DISCOVERY_SERVER_TIMEOUT_MS
        + PRIVATE_HUB_MODEL_INFERENCE_SERVER_TIMEOUT_MS,
    scaledModelResponseDelayMs: MODEL_RESPONSE_DELAY_MS,
    localBridge: "PASS",
    privateHub: "PASS",
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  AbortSignal.timeout = originalTimeout;
}

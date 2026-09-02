import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { BRIDGE_PROTOCOL } from "../local-ai/bridge/bridge-core.mjs";
import { createBridgeServer } from "../local-ai/bridge/server.mjs";

const origin = "http://127.0.0.1:3000";
const originalFetch = globalThis.fetch;
const encoder = new TextEncoder();
const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "novel-bridge-verify-"));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function reservePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function createScenario({
  modelId,
  digest,
  delayMs,
  tagsDelayMs = 0,
  tagsStatus = 200,
  tagsPaddingBytes = 0,
  outputPaddingBytes = 0,
}) {
  return {
    modelId,
    digest,
    delayMs,
    tagsDelayMs,
    tagsStatus,
    tagsPaddingBytes,
    outputPaddingBytes,
    started: deferred(),
    tagsStarted: deferred(),
    upstreamActive: 0,
    upstreamAborted: 0,
    upstreamCompleted: 0,
    tagsActive: 0,
    tagsAborted: 0,
    tagsCompleted: 0,
  };
}

function delayedJsonResponse(scenario, signal, kind) {
  const isTags = kind === "tags";
  const activeKey = isTags ? "tagsActive" : "upstreamActive";
  const abortedKey = isTags ? "tagsAborted" : "upstreamAborted";
  const completedKey = isTags ? "tagsCompleted" : "upstreamCompleted";
  const delayMs = isTags ? scenario.tagsDelayMs : scenario.delayMs;
  scenario[activeKey] += 1;
  const body = JSON.stringify(isTags ? {
    models: [{
      name: scenario.modelId,
      model: scenario.modelId,
      digest: scenario.digest,
      size: 1_000,
      details: { family: "qwen2", parameter_size: "3B", quantization_level: "Q4_K_M" },
    }],
    padding: "x".repeat(scenario.tagsPaddingBytes),
  } : {
    response: "verification-ok",
    done: true,
    eval_count: 4,
    padding: "x".repeat(scenario.outputPaddingBytes),
  });
  return new Response(new ReadableStream({
    start(controller) {
      let settled = false;
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        scenario[activeKey] -= 1;
        scenario[abortedKey] += 1;
        controller.error(new DOMException("aborted", "AbortError"));
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        scenario[activeKey] -= 1;
        scenario[completedKey] += 1;
        controller.enqueue(encoder.encode(body));
        controller.close();
      }, delayMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    },
  }), {
    status: isTags ? scenario.tagsStatus : 200,
    headers: { "Content-Type": "application/json" },
  });
}

let scenario = createScenario({
  modelId: "verify-normal:latest",
  digest: "a".repeat(64),
  delayMs: 0,
});
let postBodyHook = null;

globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  if (href === "http://127.0.0.1:11434/api/version") {
    return new Response(JSON.stringify({ version: "test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (href === "http://127.0.0.1:11434/api/tags") {
    scenario.tagsStarted.resolve();
    return delayedJsonResponse(scenario, init.signal, "tags");
  }
  if (href === "http://127.0.0.1:11434/api/generate") {
    scenario.started.resolve();
    return delayedJsonResponse(scenario, init.signal, "verification");
  }
  if (href === "http://127.0.0.1:11434/api/show") {
    return new Response(JSON.stringify({ capabilities: ["completion"] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return originalFetch(url, init);
};

const port = await reservePort();
const bridge = createBridgeServer({
  port,
  testMode: true,
  runtimeDir,
  modelDiscoveryTimeoutMs: 200,
  modelVerificationTimeoutMs: 200,
  modelVerificationTestHooks: {
    async afterBody({ modelId, signal }) {
      if (!postBodyHook || postBodyHook.modelId !== modelId || postBodyHook.used) return;
      postBodyHook.used = true;
      postBodyHook.signal = signal;
      postBodyHook.entered.resolve();
      await postBodyHook.release.promise;
    },
  },
  pairingOptions: { sessionTtlMs: 10_000 },
});
await bridge.start();
const base = `http://127.0.0.1:${port}`;
const baseHeaders = {
  Origin: origin,
  "X-Bridge-Protocol": BRIDGE_PROTOCOL,
};

async function createAuth() {
  const response = await originalFetch(`${base}/session/auto`, {
    method: "POST",
    headers: { ...baseHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ intent: "closed-ai-connect" }),
  });
  assert.equal(response.status, 200);
  const session = await response.json();
  return {
    ...baseHeaders,
    Authorization: `Bearer ${session.token}`,
    "X-Bridge-CSRF": session.csrf,
    "Content-Type": "application/json",
  };
}

async function verifyModel(auth, modelId) {
  const response = await originalFetch(`${base}/model/verify`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ model: modelId }),
  });
  return { response, body: await response.json() };
}

function startVerifyRequest(auth, modelId) {
  const requestBody = JSON.stringify({ model: modelId });
  const clientRequest = http.request({
    hostname: "127.0.0.1",
    port,
    path: "/model/verify",
    method: "POST",
    headers: {
      ...auth,
      "Content-Length": Buffer.byteLength(requestBody),
    },
  });
  clientRequest.on("error", () => undefined);
  clientRequest.on("response", (incoming) => incoming.resume());
  clientRequest.end(requestBody);
  return clientRequest;
}

function startGetRequest(requestPath, requestHeaders) {
  const clientRequest = http.request({
    hostname: "127.0.0.1",
    port,
    path: requestPath,
    method: "GET",
    headers: requestHeaders,
  });
  clientRequest.on("error", () => undefined);
  clientRequest.on("response", (incoming) => incoming.resume());
  clientRequest.end();
  return clientRequest;
}

const results = [];
const auth = await createAuth();
const beginCase = (name) => process.stderr.write(`[closed-ai-bridge-model-verification-lifecycle] ${name}\n`);

try {
  beginCase("normal-body");
  const normal = await verifyModel(auth, scenario.modelId);
  assert.equal(normal.response.status, 200, JSON.stringify(normal.body));
  assert.equal(normal.body.state, "inference_verified");
  assert.equal(scenario.upstreamCompleted, 1);
  assert.equal(scenario.upstreamActive, 0);
  assert.ok(bridge.logs.some((row) => row.taskType === "model.verify" && row.modelId === scenario.modelId && row.status === "completed"));
  results.push({ case: "normal-body", status: "PASS" });

  beginCase("health-full-body-timeout-and-retry");
  scenario = createScenario({
    modelId: "health-tags-timeout:latest",
    digest: "1".repeat(64),
    delayMs: 0,
    tagsDelayMs: 800,
  });
  const healthStartedAt = performance.now();
  const healthTimedOutResponse = await originalFetch(`${base}/health`, { headers: baseHeaders });
  const healthTimedOutBody = await healthTimedOutResponse.json();
  const healthElapsedMs = Math.round(performance.now() - healthStartedAt);
  assert.equal(healthTimedOutResponse.status, 200);
  assert.equal(healthTimedOutBody.ollamaReachable, false);
  assert.ok(healthElapsedMs < 600, `health probe exceeded bounded timeout: ${healthElapsedMs}ms`);
  assert.equal(scenario.tagsAborted, 1);
  assert.equal(scenario.tagsActive, 0);
  scenario.tagsDelayMs = 0;
  scenario.tagsStarted = deferred();
  const healthRetryResponse = await originalFetch(`${base}/health`, { headers: baseHeaders });
  const healthRetryBody = await healthRetryResponse.json();
  assert.equal(healthRetryResponse.status, 200);
  assert.equal(healthRetryBody.ollamaReachable, true);
  results.push({ case: "health-full-body-timeout-and-retry", status: "PASS", healthElapsedMs });

  beginCase("health-client-close-aborts-upstream-body");
  scenario = createScenario({
    modelId: "health-client-close:latest",
    digest: "2".repeat(64),
    delayMs: 0,
    tagsDelayMs: 1_000,
  });
  const healthClient = startGetRequest("/health", baseHeaders);
  await withTimeout(scenario.tagsStarted.promise, 500, "health model discovery did not start");
  healthClient.destroy();
  await withTimeout((async () => {
    while (scenario.tagsAborted !== 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  })(), 500, "health client disconnect did not abort model discovery");
  assert.equal(scenario.tagsActive, 0);
  const disconnectedHealthAccess = bridge.accessLogs.findLast((row) => row.path === "/health" && row.failure_code === "CLIENT_DISCONNECTED");
  assert.equal(disconnectedHealthAccess?.response_status, 499);
  results.push({ case: "health-client-close-aborts-upstream-body", status: "PASS" });

  beginCase("model-detail-oversized-tags-body-rejected");
  scenario = createScenario({
    modelId: "model-detail-oversized:latest",
    digest: "3".repeat(64),
    delayMs: 0,
    tagsPaddingBytes: 1_100_000,
  });
  const oversizedDetailResponse = await originalFetch(
    `${base}/models/${encodeURIComponent(scenario.modelId)}`,
    { headers: auth },
  );
  const oversizedDetailBody = await oversizedDetailResponse.json();
  assert.equal(oversizedDetailResponse.status, 502);
  assert.equal(oversizedDetailBody.errorCode, "OLLAMA_INVALID_RESPONSE");
  assert.equal(scenario.tagsActive, 0);
  results.push({ case: "model-detail-oversized-tags-body-rejected", status: "PASS" });

  beginCase("non-2xx-error-body-is-byte-bounded-and-sanitized");
  scenario = createScenario({
    modelId: "verify-non-2xx-oversized:latest",
    digest: "4".repeat(64),
    delayMs: 0,
    tagsStatus: 500,
    tagsPaddingBytes: 20_000,
  });
  const nonOk = await verifyModel(auth, scenario.modelId);
  assert.equal(nonOk.response.status, 502);
  assert.equal(nonOk.body.errorCode, "OLLAMA_INVALID_RESPONSE");
  assert.equal(JSON.stringify(nonOk.body).includes("x".repeat(64)), false);
  assert.equal(scenario.tagsActive, 0);
  results.push({ case: "non-2xx-error-body-is-byte-bounded-and-sanitized", status: "PASS" });

  beginCase("tags-headers-immediate-body-stalled");
  scenario = createScenario({
    modelId: "verify-tags-timeout:latest",
    digest: "d".repeat(64),
    delayMs: 0,
    tagsDelayMs: 800,
  });
  const discoveryStartedAt = performance.now();
  const discoveryTimedOut = await verifyModel(auth, scenario.modelId);
  const discoveryElapsedMs = Math.round(performance.now() - discoveryStartedAt);
  assert.equal(discoveryTimedOut.response.status, 408);
  assert.equal(discoveryTimedOut.body.errorCode, "OLLAMA_TIMEOUT");
  assert.ok(discoveryElapsedMs < 600, `model discovery exceeded bounded timeout: ${discoveryElapsedMs}ms`);
  assert.equal(scenario.tagsAborted, 1);
  assert.equal(scenario.tagsActive, 0);
  assert.equal(scenario.upstreamCompleted, 0);
  scenario.tagsDelayMs = 0;
  scenario.tagsStarted = deferred();
  const discoveryRetry = await verifyModel(auth, scenario.modelId);
  assert.equal(discoveryRetry.response.status, 200);
  assert.equal(discoveryRetry.body.state, "inference_verified");
  results.push({ case: "tags-headers-immediate-body-stalled", status: "PASS", discoveryElapsedMs });

  beginCase("oversized-verification-body-rejected-without-cache");
  scenario = createScenario({
    modelId: "verify-oversized:latest",
    digest: "e".repeat(64),
    delayMs: 0,
    outputPaddingBytes: 70_000,
  });
  const oversized = await verifyModel(auth, scenario.modelId);
  assert.equal(oversized.response.status, 502);
  assert.equal(oversized.body.errorCode, "OLLAMA_INVALID_RESPONSE");
  assert.equal(scenario.upstreamActive, 0);
  assert.equal(
    bridge.logs.some((row) => row.taskType === "model.verify" && row.modelId === scenario.modelId && row.status === "completed"),
    false,
  );
  scenario.outputPaddingBytes = 0;
  scenario.started = deferred();
  const oversizedRetry = await verifyModel(auth, scenario.modelId);
  assert.equal(oversizedRetry.response.status, 200);
  assert.equal(oversizedRetry.body.state, "inference_verified");
  assert.equal(scenario.upstreamCompleted, 2);
  results.push({ case: "oversized-verification-body-rejected-without-cache", status: "PASS" });

  beginCase("headers-immediate-body-stalled");
  scenario = createScenario({
    modelId: "verify-timeout:latest",
    digest: "b".repeat(64),
    delayMs: 800,
  });
  const timeoutStartedAt = performance.now();
  const timedOut = await verifyModel(auth, scenario.modelId);
  const timeoutElapsedMs = Math.round(performance.now() - timeoutStartedAt);
  assert.equal(timedOut.response.status, 408);
  assert.equal(timedOut.body.errorCode, "OLLAMA_TIMEOUT");
  assert.ok(timeoutElapsedMs < 600, `verification exceeded bounded timeout: ${timeoutElapsedMs}ms`);
  assert.equal(scenario.upstreamAborted, 1);
  assert.equal(scenario.upstreamActive, 0);
  assert.ok(bridge.logs.some((row) => row.taskType === "model.verify" && row.modelId === scenario.modelId && row.errorCode === "OLLAMA_TIMEOUT"));
  results.push({ case: "headers-immediate-body-stalled", status: "PASS", timeoutElapsedMs });

  beginCase("shared-waiter-disconnect-does-not-cancel-survivor");
  scenario = createScenario({
    modelId: "verify-shared-survivor:latest",
    digest: "5".repeat(64),
    delayMs: 150,
  });
  const sharedFirst = startVerifyRequest(auth, scenario.modelId);
  await withTimeout(scenario.started.promise, 500, "shared verification upstream did not start");
  const sharedSurvivor = verifyModel(auth, scenario.modelId);
  await withTimeout((async () => {
    while (scenario.tagsCompleted < 2) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  })(), 500, "second shared waiter did not finish discovery");
  await new Promise((resolve) => setTimeout(resolve, 20));
  sharedFirst.destroy();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(scenario.upstreamAborted, 0);
  const sharedSurvivorResult = await sharedSurvivor;
  assert.equal(sharedSurvivorResult.response.status, 200);
  assert.equal(sharedSurvivorResult.body.state, "inference_verified");
  assert.equal(scenario.upstreamCompleted, 1);
  results.push({ case: "shared-waiter-disconnect-does-not-cancel-survivor", status: "PASS" });

  beginCase("shared-last-waiter-disconnect-cancels-upstream");
  scenario = createScenario({
    modelId: "verify-shared-last-close:latest",
    digest: "6".repeat(64),
    delayMs: 1_000,
  });
  const sharedLastFirst = startVerifyRequest(auth, scenario.modelId);
  await withTimeout(scenario.started.promise, 500, "shared-last verification upstream did not start");
  const sharedLastSecond = startVerifyRequest(auth, scenario.modelId);
  await withTimeout((async () => {
    while (scenario.tagsCompleted < 2) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  })(), 500, "second shared-last waiter did not finish discovery");
  await new Promise((resolve) => setTimeout(resolve, 20));
  sharedLastFirst.destroy();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(scenario.upstreamAborted, 0);
  sharedLastSecond.destroy();
  await withTimeout((async () => {
    while (scenario.upstreamAborted !== 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  })(), 500, "last shared waiter disconnect did not abort upstream");
  assert.equal(scenario.upstreamActive, 0);
  results.push({ case: "shared-last-waiter-disconnect-cancels-upstream", status: "PASS" });

  beginCase("client-close-cancels-and-cleans-up");
  scenario = createScenario({
    modelId: "verify-client-close:latest",
    digest: "c".repeat(64),
    delayMs: 1_000,
  });
  const clientRequest = startVerifyRequest(auth, scenario.modelId);
  await withTimeout(scenario.started.promise, 500, "verification upstream did not start");
  clientRequest.destroy();
  await withTimeout((async () => {
    while (scenario.upstreamAborted !== 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  })(), 500, "client disconnect did not abort verification upstream");
  await withTimeout((async () => {
    while (!bridge.logs.some((row) => row.taskType === "model.verify" && row.modelId === scenario.modelId && row.errorCode === "OLLAMA_CANCELLED")) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  })(), 500, "client disconnect did not emit terminal verification telemetry");
  const disconnectedAccess = bridge.accessLogs.findLast((row) => row.path === "/model/verify" && row.failure_code === "CLIENT_DISCONNECTED");
  assert.equal(disconnectedAccess?.request_state, "CLIENT_DISCONNECTED");
  assert.equal(disconnectedAccess?.response_status, 499);
  assert.equal(scenario.upstreamActive, 0);

  scenario.delayMs = 0;
  scenario.started = deferred();
  const retried = await verifyModel(auth, scenario.modelId);
  assert.equal(retried.response.status, 200);
  assert.equal(retried.body.state, "inference_verified");
  assert.equal(scenario.upstreamCompleted, 1);
  results.push({ case: "client-close-cancels-and-cleans-up", status: "PASS" });

  beginCase("post-body-abort-entry-is-replaced-without-stale-cache");
  scenario = createScenario({
    modelId: "verify-post-body-close:latest",
    digest: "f".repeat(64),
    delayMs: 0,
  });
  postBodyHook = {
    modelId: scenario.modelId,
    used: false,
    signal: null,
    entered: deferred(),
    release: deferred(),
  };
  const postBodyClient = startVerifyRequest(auth, scenario.modelId);
  await withTimeout(postBodyHook.entered.promise, 500, "post-body verification hook was not reached");
  postBodyClient.destroy();
  await withTimeout((async () => {
    while (!postBodyHook.signal?.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  })(), 500, "post-body client close did not abort the verification entry");

  scenario.started = deferred();
  const replacement = await verifyModel(auth, scenario.modelId);
  assert.equal(replacement.response.status, 200);
  assert.equal(replacement.body.state, "inference_verified");
  postBodyHook.release.resolve();
  await withTimeout((async () => {
    while (!bridge.logs.some((row) => row.taskType === "model.verify" && row.modelId === scenario.modelId && row.errorCode === "OLLAMA_CANCELLED")) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  })(), 500, "post-body cancellation did not emit terminal telemetry");
  const completedBeforeCacheProbe = scenario.upstreamCompleted;
  const cachedAfterReplacement = await verifyModel(auth, scenario.modelId);
  assert.equal(cachedAfterReplacement.response.status, 200);
  assert.equal(cachedAfterReplacement.body.state, "inference_verified");
  assert.equal(scenario.upstreamCompleted, completedBeforeCacheProbe);
  assert.equal(
    bridge.logs.filter((row) => row.taskType === "model.verify" && row.modelId === scenario.modelId && row.status === "completed").length,
    1,
  );
  results.push({ case: "post-body-abort-entry-is-replaced-without-stale-cache", status: "PASS" });
  postBodyHook = null;

  console.log(JSON.stringify({
    suite: "closed-ai-bridge-model-verification-lifecycle",
    status: "PASS",
    externalAiCalls: 0,
    results,
  }, null, 2));
} finally {
  postBodyHook?.release.resolve();
  globalThis.fetch = originalFetch;
  await bridge.stop();
  await rm(runtimeDir, { recursive: true, force: true });
}

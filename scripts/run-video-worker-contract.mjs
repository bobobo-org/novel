import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  VIDEO_WORKER_CANCEL_SCHEMA_VERSION,
  VIDEO_WORKER_HEALTH_SCHEMA_VERSION,
  VIDEO_WORKER_JOB_SCHEMA_VERSION,
  VIDEO_WORKER_PROVIDER_ID,
  VIDEO_WORKER_SUBMIT_SCHEMA_VERSION,
  VideoWorkerError,
  createVideoWorkerAdapter,
} from "../lib/novel-ai/media-extension/server/video-worker-protocol.ts";
import {
  createVideoWorkerServerAdapter,
  probeVideoWorkerServer,
  publicVideoWorkerServerStatus,
  readVideoWorkerServerConfiguration,
} from "../lib/novel-ai/media-extension/server/video-worker.server.ts";

const token = "server-only-test-token-that-must-not-leak";
const baseUrl = "https://video-worker.example.invalid/runtime";
const model = "wan2.2-test-model";
const timestamp = new Date(0).toISOString();
const sha256 = "a".repeat(64);

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

function health(overrides = {}) {
  return {
    schemaVersion: VIDEO_WORKER_HEALTH_SCHEMA_VERSION,
    status: "ready",
    workerId: "gpu-worker-1",
    model,
    capabilities: {
      maxDurationSeconds: 30,
      resolutions: ["720p"],
      ratios: ["16:9", "9:16"],
      generatesAudio: false,
      supportsCancellation: true,
    },
    ...overrides,
  };
}

function job(overrides = {}) {
  return {
    schemaVersion: VIDEO_WORKER_JOB_SCHEMA_VERSION,
    jobId: "job-1",
    model,
    status: "queued",
    progressPercent: 0,
    artifact: null,
    failureCode: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

assert.deepEqual(readVideoWorkerServerConfiguration({}), {
  configured: false,
  baseUrl: "",
  token: "",
  model: "",
  production: false,
  allowInsecureLocal: false,
  blockedReason: "VIDEO_WORKER_BASE_URL_MISSING",
});
assert.equal(readVideoWorkerServerConfiguration({
  NOVEL_VIDEO_WORKER_BASE_URL: baseUrl,
  NOVEL_VIDEO_WORKER_MODEL: model,
}).blockedReason, "VIDEO_WORKER_TOKEN_MISSING");
assert.equal(readVideoWorkerServerConfiguration({
  NOVEL_VIDEO_WORKER_BASE_URL: baseUrl,
  NOVEL_VIDEO_WORKER_TOKEN: token,
}).blockedReason, "VIDEO_WORKER_MODEL_MISSING");

const productionHttp = readVideoWorkerServerConfiguration({
  NODE_ENV: "production",
  NOVEL_VIDEO_WORKER_BASE_URL: "http://localhost:9100",
  NOVEL_VIDEO_WORKER_TOKEN: token,
  NOVEL_VIDEO_WORKER_MODEL: model,
  NOVEL_VIDEO_WORKER_ALLOW_INSECURE_LOCAL: "1",
});
assert.equal(productionHttp.configured, false, "production must reject HTTP even for localhost");
assert.equal(productionHttp.blockedReason, "VIDEO_WORKER_CONFIGURATION_INVALID");

const implicitDevelopmentHttp = readVideoWorkerServerConfiguration({
  NODE_ENV: "development",
  NOVEL_VIDEO_WORKER_BASE_URL: "http://localhost:9100",
  NOVEL_VIDEO_WORKER_TOKEN: token,
  NOVEL_VIDEO_WORKER_MODEL: model,
});
assert.equal(implicitDevelopmentHttp.configured, false, "development HTTP needs an explicit opt-in");

const nonLocalDevelopmentHttp = readVideoWorkerServerConfiguration({
  NODE_ENV: "development",
  NOVEL_VIDEO_WORKER_BASE_URL: "http://worker.internal:9100",
  NOVEL_VIDEO_WORKER_TOKEN: token,
  NOVEL_VIDEO_WORKER_MODEL: model,
  NOVEL_VIDEO_WORKER_ALLOW_INSECURE_LOCAL: "1",
});
assert.equal(nonLocalDevelopmentHttp.configured, false, "development HTTP must stay loopback-only");

const localDevelopmentEnvironment = {
  NODE_ENV: "development",
  NOVEL_VIDEO_WORKER_BASE_URL: "http://127.0.0.1:9100/",
  NOVEL_VIDEO_WORKER_TOKEN: token,
  NOVEL_VIDEO_WORKER_MODEL: model,
  NOVEL_VIDEO_WORKER_ALLOW_INSECURE_LOCAL: "1",
};
const localDevelopment = readVideoWorkerServerConfiguration(localDevelopmentEnvironment);
assert.equal(localDevelopment.configured, true);
assert.equal(localDevelopment.baseUrl, "http://127.0.0.1:9100");

for (const unsafeUrl of [
  "https://user:password@video-worker.example.invalid",
  "https://video-worker.example.invalid?token=secret",
  "https://video-worker.example.invalid/#fragment",
]) {
  assert.equal(readVideoWorkerServerConfiguration({
    NODE_ENV: "production",
    NOVEL_VIDEO_WORKER_BASE_URL: unsafeUrl,
    NOVEL_VIDEO_WORKER_TOKEN: token,
    NOVEL_VIDEO_WORKER_MODEL: model,
  }).configured, false);
}

const environment = {
  NODE_ENV: "production",
  NOVEL_VIDEO_WORKER_BASE_URL: baseUrl,
  NOVEL_VIDEO_WORKER_TOKEN: token,
  NOVEL_VIDEO_WORKER_MODEL: model,
};
const publicStatus = publicVideoWorkerServerStatus(environment);
assert.equal(publicStatus.configured, true);
assert.equal(publicStatus.providerId, VIDEO_WORKER_PROVIDER_ID);
assert.equal(publicStatus.executionProviderId, VIDEO_WORKER_PROVIDER_ID);
assert.equal(publicStatus.model, model);
assert(!Object.hasOwn(publicStatus, "baseUrl"));
assert(!Object.hasOwn(publicStatus, "token"));
assert(!JSON.stringify(publicStatus).includes(token));
assert(!JSON.stringify(publicStatus).includes(baseUrl));

const requests = [];
const adapter = createVideoWorkerServerAdapter(environment, {
  fetchImpl: async (url, init) => {
    const headers = new Headers(init.headers);
    requests.push({
      url: String(url),
      method: init.method,
      body: init.body,
      authorization: headers.get("authorization"),
      cache: init.cache,
      redirect: init.redirect,
    });
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/v1/health")) return jsonResponse(health());
    if (path.endsWith("/v1/jobs/job-1/cancel")) {
      return jsonResponse(job({
        status: "cancelled",
        progressPercent: 36,
        failureCode: "CANCELLED_BY_USER",
      }));
    }
    if (path.endsWith("/v1/jobs/job-1")) {
      return jsonResponse(job({
        status: "succeeded",
        progressPercent: 100,
        artifact: {
          downloadUrl: "https://private-artifacts.example.invalid/job-1.mp4?signature=test",
          mimeType: "video/mp4",
          byteLength: 1_024,
          sha256,
        },
      }));
    }
    return jsonResponse(job());
  },
});
assert.deepEqual(adapter.status(), {
  configured: true,
  providerId: VIDEO_WORKER_PROVIDER_ID,
  model,
});
assert(!JSON.stringify(adapter.status()).includes(token));
assert(!JSON.stringify(adapter.status()).includes(baseUrl));

const workerHealth = await adapter.health();
assert.equal(workerHealth.status, "ready");
assert.equal(workerHealth.workerId, "gpu-worker-1");
const created = await adapter.createTask({
  idempotencyKey: "story-1:shot-1:revision-2",
  prompt: "主角在雨夜推門，鏡頭保持人物連續性。",
  durationSeconds: 8,
  resolution: "720p",
  ratio: "9:16",
});
assert.equal(created.status, "queued");
const polled = await adapter.pollTask("job-1");
assert.equal(polled.status, "succeeded");
assert.equal(polled.artifact?.mimeType, "video/mp4");
const cancelled = await adapter.cancelTask("job-1");
assert.equal(cancelled.status, "cancelled");

assert.deepEqual(requests.map(({ url, method }) => ({ url, method })), [
  { url: `${baseUrl}/v1/health`, method: "GET" },
  { url: `${baseUrl}/v1/jobs`, method: "POST" },
  { url: `${baseUrl}/v1/jobs/job-1`, method: "GET" },
  { url: `${baseUrl}/v1/jobs/job-1/cancel`, method: "POST" },
]);
assert(requests.every((request) => request.authorization === `Bearer ${token}`));
assert(requests.every((request) => request.cache === "no-store"));
assert(requests.every((request) => request.redirect === "error"));
assert.deepEqual(JSON.parse(requests[1].body), {
  schemaVersion: VIDEO_WORKER_SUBMIT_SCHEMA_VERSION,
  idempotencyKey: "story-1:shot-1:revision-2",
  model,
  prompt: "主角在雨夜推門，鏡頭保持人物連續性。",
  durationSeconds: 8,
  resolution: "720p",
  ratio: "9:16",
  generateAudio: true,
  watermark: true,
});
assert.deepEqual(JSON.parse(requests[3].body), {
  schemaVersion: VIDEO_WORKER_CANCEL_SCHEMA_VERSION,
});

let invalidInputNetworkCalls = 0;
const validationAdapter = createVideoWorkerAdapter({
  baseUrl,
  token,
  model,
  production: true,
  fetchImpl: async () => {
    invalidInputNetworkCalls += 1;
    throw new Error("MUST_NOT_CALL");
  },
});
await assert.rejects(
  () => validationAdapter.createTask({
    idempotencyKey: "bad key with spaces",
    prompt: "test",
    durationSeconds: 8,
    resolution: "720p",
    ratio: "16:9",
  }),
  (error) => error instanceof VideoWorkerError && error.code === "VIDEO_WORKER_REQUEST_INVALID",
);
await assert.rejects(
  () => validationAdapter.pollTask("../unsafe"),
  (error) => error instanceof VideoWorkerError && error.code === "VIDEO_WORKER_REQUEST_INVALID",
);
assert.equal(invalidInputNetworkCalls, 0, "invalid requests must fail before fetch");

for (const invalidPayload of [
  health({ model: "unexpected-model" }),
  { ...health(), unexpected: true },
  job({ status: "succeeded", progressPercent: 100, artifact: null }),
  job({ status: "mystery" }),
  job({ failureCode: "unsafe failure text" }),
]) {
  const invalidResponseAdapter = createVideoWorkerAdapter({
    baseUrl,
    token,
    model,
    production: true,
    fetchImpl: async (url) => String(url).endsWith("/v1/health")
      ? jsonResponse(invalidPayload)
      : jsonResponse(invalidPayload),
  });
  const operation = invalidPayload.schemaVersion === VIDEO_WORKER_HEALTH_SCHEMA_VERSION
    ? () => invalidResponseAdapter.health()
    : () => invalidResponseAdapter.pollTask("job-1");
  await assert.rejects(
    operation,
    (error) => error instanceof VideoWorkerError && error.code === "VIDEO_WORKER_RESPONSE_INVALID",
  );
}

const nonJsonAdapter = createVideoWorkerAdapter({
  baseUrl,
  token,
  model,
  production: true,
  fetchImpl: async () => new Response("not json", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  }),
});
await assert.rejects(
  () => nonJsonAdapter.health(),
  (error) => error instanceof VideoWorkerError && error.code === "VIDEO_WORKER_RESPONSE_INVALID",
);

const unsafeProviderBody = `raw-provider-detail-${token}`;
const rejectedAdapter = createVideoWorkerAdapter({
  baseUrl,
  token,
  model,
  production: true,
  fetchImpl: async () => jsonResponse({ message: unsafeProviderBody }, { status: 401 }),
});
await assert.rejects(
  () => rejectedAdapter.health(),
  (error) => error instanceof VideoWorkerError
    && error.code === "VIDEO_WORKER_AUTH_REJECTED"
    && !error.message.includes(token)
    && !error.message.includes(unsafeProviderBody),
);

const notFoundAdapter = createVideoWorkerAdapter({
  baseUrl,
  token,
  model,
  production: true,
  fetchImpl: async () => jsonResponse({ message: unsafeProviderBody }, { status: 404 }),
});
await assert.rejects(
  () => notFoundAdapter.pollTask("job-1"),
  (error) => error instanceof VideoWorkerError
    && error.code === "VIDEO_WORKER_JOB_NOT_FOUND"
    && !error.message.includes(unsafeProviderBody),
);

function abortingFetch(_url, init) {
  return new Promise((_resolve, reject) => {
    const signal = init.signal;
    const rejectAbort = () => reject(new Error("mock fetch aborted"));
    if (signal.aborted) rejectAbort();
    else signal.addEventListener("abort", rejectAbort, { once: true });
  });
}

const timeoutAdapter = createVideoWorkerAdapter({
  baseUrl,
  token,
  model,
  production: true,
  timeoutMs: 25,
  fetchImpl: abortingFetch,
});
await assert.rejects(
  () => timeoutAdapter.health(),
  (error) => error instanceof VideoWorkerError && error.code === "VIDEO_WORKER_TIMEOUT",
);

const abortController = new AbortController();
abortController.abort("test cancellation");
const abortAdapter = createVideoWorkerAdapter({
  baseUrl,
  token,
  model,
  production: true,
  fetchImpl: abortingFetch,
});
await assert.rejects(
  () => abortAdapter.health(abortController.signal),
  (error) => error instanceof VideoWorkerError && error.code === "VIDEO_WORKER_ABORTED",
);

const publicProbe = await probeVideoWorkerServer(environment, {
  fetchImpl: async () => jsonResponse(health()),
});
assert.equal(publicProbe.runtimeReady, true);
assert.equal(publicProbe.workerStatus, "ready");
assert(!Object.hasOwn(publicProbe, "baseUrl"));
assert(!Object.hasOwn(publicProbe, "token"));
assert(!JSON.stringify(publicProbe).includes(token));
assert(!JSON.stringify(publicProbe).includes(baseUrl));

const protocolSource = await readFile("lib/novel-ai/media-extension/server/video-worker-protocol.ts", "utf8");
const serverSource = await readFile("lib/novel-ai/media-extension/server/video-worker.server.ts", "utf8");
const environmentExample = await readFile(".env.example", "utf8");
assert.match(protocolSource, /^import "server-only";/u);
assert.match(serverSource, /^import "server-only";/u);
assert.match(environmentExample, /NOVEL_VIDEO_WORKER_BASE_URL=/u);
assert.match(environmentExample, /NOVEL_VIDEO_WORKER_TOKEN=/u);
assert.match(environmentExample, /NOVEL_VIDEO_WORKER_MODEL=/u);
assert.doesNotMatch(`${protocolSource}\n${serverSource}\n${environmentExample}`, /NEXT_PUBLIC_NOVEL_VIDEO_WORKER/u);

console.log("PASS provider-neutral self-hosted GPU video worker server contract");

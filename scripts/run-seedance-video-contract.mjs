import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BYTEPLUS_LAS_SEEDANCE_ENDPOINT,
  BYTEPLUS_SEEDANCE_MODEL,
  BYTEPLUS_SEEDANCE_TASK_PATH,
  BytePlusSeedanceError,
  createBytePlusSeedanceAdapter,
} from "../lib/novel-ai/media-extension/server/byteplus-seedance-protocol.ts";
import {
  VIDEO_SUBMISSION_SCHEMA_VERSION,
  VideoRuntimeError,
  pollVideoGenerationJob,
  submitVideoGenerationJob,
} from "../lib/novel-ai/media-extension/server/video-job-service.ts";
import {
  publicBytePlusSeedanceHealth,
  readBytePlusSeedanceServerConfiguration,
} from "../lib/novel-ai/media-extension/server/byteplus-seedance.server.ts";

const secret = "test-secret-that-must-not-leak";

assert.equal(BYTEPLUS_LAS_SEEDANCE_ENDPOINT, "https://operator.las.ap-southeast-1.bytepluses.com");
assert.equal(BYTEPLUS_SEEDANCE_MODEL, "dreamina-seedance-2-5-260628");
assert.deepEqual(publicBytePlusSeedanceHealth({}), {
  configured: false,
  model: BYTEPLUS_SEEDANCE_MODEL,
  credentialConfigured: false,
  jobStoreConfigured: false,
  artifactStoreConfigured: false,
});
const credentialOnlyHealth = publicBytePlusSeedanceHealth({ BYTEPLUS_LAS_API_KEY: secret });
assert.deepEqual(credentialOnlyHealth, {
  configured: false,
  model: BYTEPLUS_SEEDANCE_MODEL,
  credentialConfigured: true,
  jobStoreConfigured: false,
  artifactStoreConfigured: false,
});
assert(!JSON.stringify(credentialOnlyHealth).includes(secret), "public health must never contain the API key");
assert.equal(readBytePlusSeedanceServerConfiguration({
  BYTEPLUS_LAS_API_KEY: secret,
  BYTEPLUS_LAS_BASE_URL: "https://example.com",
}).credentialConfigured, false, "non-allowlisted endpoint must fail closed");
assert.throws(
  () => createBytePlusSeedanceAdapter({ apiKey: secret, endpoint: "https://example.com" }),
  (error) => error instanceof BytePlusSeedanceError && error.code === "BYTEPLUS_CONFIGURATION_INVALID",
);
assert.throws(
  () => createBytePlusSeedanceAdapter({ apiKey: secret, model: "another-model" }),
  (error) => error instanceof BytePlusSeedanceError && error.code === "BYTEPLUS_CONFIGURATION_INVALID",
);

const requests = [];
const adapter = createBytePlusSeedanceAdapter({
  apiKey: secret,
  fetchImpl: async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: "task-123" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
});
assert.deepEqual(adapter.status(), {
  configured: true,
  providerId: "byteplus-las",
  model: BYTEPLUS_SEEDANCE_MODEL,
  endpoint: BYTEPLUS_LAS_SEEDANCE_ENDPOINT,
});
assert(!JSON.stringify(adapter.status()).includes(secret), "adapter status must never contain the API key");
const created = await adapter.createTask({
  prompt: "A continuous cinematic scene",
  durationSeconds: 8,
  resolution: "720p",
  ratio: "16:9",
});
assert.deepEqual(created, { providerTaskId: "task-123", status: "queued" });
assert.equal(requests.length, 1);
assert.equal(requests[0].url, `${BYTEPLUS_LAS_SEEDANCE_ENDPOINT}${BYTEPLUS_SEEDANCE_TASK_PATH}`);
assert.equal(requests[0].init.method, "POST");
assert.equal(requests[0].init.headers.Authorization, `Bearer ${secret}`);
assert.deepEqual(JSON.parse(requests[0].init.body), {
  model: BYTEPLUS_SEEDANCE_MODEL,
  content: [{ type: "text", text: "A continuous cinematic scene" }],
  duration: 8,
  resolution: "720p",
  ratio: "16:9",
  generate_audio: true,
  watermark: true,
  execution_expires_after: 3_600,
});

let invalidNetworkCalls = 0;
const validationAdapter = createBytePlusSeedanceAdapter({
  apiKey: secret,
  fetchImpl: async () => {
    invalidNetworkCalls += 1;
    throw new Error("MUST_NOT_CALL");
  },
});
await assert.rejects(
  () => validationAdapter.createTask({ prompt: "test", durationSeconds: 31, resolution: "720p", ratio: "16:9" }),
  (error) => error instanceof BytePlusSeedanceError && error.code === "BYTEPLUS_REQUEST_INVALID",
);
assert.equal(invalidNetworkCalls, 0, "invalid provider input must fail before fetch");

for (const status of ["queued", "running", "cancelled", "failed", "expired", "succeeded"]) {
  const pollingAdapter = createBytePlusSeedanceAdapter({
    apiKey: secret,
    fetchImpl: async () => new Response(JSON.stringify({
      id: "task-123",
      status,
      ...(status === "succeeded" ? { content: { video_url: "https://example-cdn.invalid/video.mp4" } } : {}),
    }), { status: 200 }),
  });
  const job = await pollingAdapter.pollTask("task-123");
  assert.equal(job.status, status);
  assert.equal(job.failureCode, status === "failed"
    ? "PROVIDER_TASK_FAILED"
    : status === "cancelled"
      ? "PROVIDER_TASK_CANCELLED"
      : status === "expired"
        ? "PROVIDER_TASK_EXPIRED"
        : null);
}

const unsafeProviderBody = `raw-provider-detail-${secret}`;
const rejectedAdapter = createBytePlusSeedanceAdapter({
  apiKey: secret,
  fetchImpl: async () => new Response(JSON.stringify({ message: unsafeProviderBody }), { status: 401 }),
});
await assert.rejects(
  () => rejectedAdapter.createTask({ prompt: "test", durationSeconds: 8, resolution: "720p", ratio: "16:9" }),
  (error) => error instanceof BytePlusSeedanceError
    && error.code === "BYTEPLUS_AUTH_REJECTED"
    && !error.message.includes(secret)
    && !error.message.includes(unsafeProviderBody),
);

const validSubmission = {
  schemaVersion: VIDEO_SUBMISSION_SCHEMA_VERSION,
  idempotencyKey: "seedance:drama-1:2:first-shot",
  projectId: "project-1",
  approvedDrama: {
    dramaProjectId: "drama-1",
    storyId: "project-1",
    revision: 2,
    status: "approved",
    sourceStoryRevision: 4,
    sourceStoryBibleVersion: 3,
    projectionOutputHash: "sha256-output-hash",
  },
  mediaPrompt: "An approved first shot",
  durationSeconds: 8,
  resolution: "720p",
  ratio: "16:9",
  adultNamespace: "general",
  externalConsent: true,
  costConfirmed: true,
};

let adapterFactoryCalls = 0;
let providerCreateCalls = 0;
let providerPollCalls = 0;
const fakeAdapter = {
  providerId: "byteplus-las",
  model: BYTEPLUS_SEEDANCE_MODEL,
  status() {
    return { configured: true, providerId: "byteplus-las", model: BYTEPLUS_SEEDANCE_MODEL, endpoint: BYTEPLUS_LAS_SEEDANCE_ENDPOINT };
  },
  async createTask() {
    providerCreateCalls += 1;
    return { providerTaskId: "provider-task-1", status: "queued" };
  },
  async pollTask(providerTaskId) {
    providerPollCalls += 1;
    return { providerTaskId, status: "running", videoUrl: null, failureCode: null };
  },
};
const fakeStore = {
  configured: true,
  async submit(input, createProviderTask) {
    await createProviderTask();
    return { jobId: "job-1", projectId: input.projectId, status: "queued", model: BYTEPLUS_SEEDANCE_MODEL, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() };
  },
  async poll(jobId, pollProviderTask) {
    const provider = await pollProviderTask("provider-task-1");
    return { jobId, projectId: "project-1", status: provider.status, model: BYTEPLUS_SEEDANCE_MODEL, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() };
  },
};
const dependencies = (overrides = {}) => ({
  providerConfigured: true,
  durableStore: fakeStore,
  artifactStoreConfigured: true,
  createAdapter: () => {
    adapterFactoryCalls += 1;
    return fakeAdapter;
  },
  ...overrides,
});

async function rejectsWithoutProvider(input, deps, expectedCode) {
  const factoriesBefore = adapterFactoryCalls;
  const createsBefore = providerCreateCalls;
  await assert.rejects(
    () => submitVideoGenerationJob(input, deps),
    (error) => error instanceof VideoRuntimeError && error.code === expectedCode,
  );
  assert.equal(adapterFactoryCalls, factoriesBefore, `${expectedCode} must not create an adapter`);
  assert.equal(providerCreateCalls, createsBefore, `${expectedCode} must not call the provider`);
}

await rejectsWithoutProvider({ ...validSubmission, approvedDrama: { ...validSubmission.approvedDrama, status: "candidate" } }, dependencies(), "VIDEO_APPROVED_DRAMA_REQUIRED");
await rejectsWithoutProvider({ ...validSubmission, approvedDrama: { ...validSubmission.approvedDrama, storyId: "project-2" } }, dependencies(), "VIDEO_APPROVED_DRAMA_REQUIRED");
await rejectsWithoutProvider({ ...validSubmission, externalConsent: false }, dependencies(), "VIDEO_EXTERNAL_CONSENT_REQUIRED");
await rejectsWithoutProvider({ ...validSubmission, costConfirmed: false }, dependencies(), "VIDEO_COST_CONFIRMATION_REQUIRED");
await rejectsWithoutProvider(validSubmission, dependencies({ providerConfigured: false }), "VIDEO_PROVIDER_NOT_CONFIGURED");
await rejectsWithoutProvider(validSubmission, dependencies({ durableStore: null }), "VIDEO_DURABLE_STORE_NOT_CONFIGURED");
await rejectsWithoutProvider(validSubmission, dependencies({ artifactStoreConfigured: false }), "VIDEO_ARTIFACT_STORE_NOT_CONFIGURED");

const pollFactoriesBefore = adapterFactoryCalls;
const pollsBefore = providerPollCalls;
await assert.rejects(
  () => pollVideoGenerationJob("job-1", dependencies({ durableStore: null })),
  (error) => error instanceof VideoRuntimeError && error.code === "VIDEO_DURABLE_STORE_NOT_CONFIGURED",
);
assert.equal(adapterFactoryCalls, pollFactoriesBefore, "poll without a durable store must not create an adapter");
assert.equal(providerPollCalls, pollsBefore, "poll without a durable store must not call the provider");

const submitted = await submitVideoGenerationJob(validSubmission, dependencies());
assert.equal(submitted.jobId, "job-1");
assert.equal(providerCreateCalls, 1);
const polled = await pollVideoGenerationJob("job-1", dependencies());
assert.equal(polled.status, "running");
assert.equal(providerPollCalls, 1);

const serverSource = await readFile("lib/novel-ai/media-extension/server/byteplus-seedance.server.ts", "utf8");
const healthRoute = await readFile("app/api/media/video/health/route.ts", "utf8");
const submitRoute = await readFile("app/api/media/video/jobs/route.ts", "utf8");
const pollRoute = await readFile("app/api/media/video/jobs/[jobId]/route.ts", "utf8");
const uiSource = await readFile("app/studio/project/[projectId]/drama/drama-workspace.tsx", "utf8");
const environmentExample = await readFile(".env.example", "utf8");

assert.match(serverSource, /^import "server-only";/u);
const protocolSource = await readFile("lib/novel-ai/media-extension/server/byteplus-seedance-protocol.ts", "utf8");
assert.match(protocolSource, /^import "server-only";/u);
assert.match(serverSource, /const DURABLE_VIDEO_JOB_STORE:[\s\S]*= null;/u);
assert.match(serverSource, /configured: credentialConfigured && jobStoreConfigured && artifactStoreConfigured/u);
assert.match(serverSource, /const VALIDATED_PRIVATE_VIDEO_ARTIFACT_STORE_CONFIGURED = false/u);
assert.doesNotMatch(`${serverSource}\n${environmentExample}\n${uiSource}`, /NEXT_PUBLIC_[A-Z_]*BYTEPLUS|NEXT_PUBLIC_BYTEPLUS/u);
assert.match(healthRoute, /publicBytePlusSeedanceHealth\(\)/u);
assert.match(healthRoute, /VIDEO_SAFE_RESPONSE_HEADERS/u);
assert.match(submitRoute, /assertExternalAIRequestOrigin\(request\)/u);
assert.match(submitRoute, /readExternalAIJsonBody\(request\)/u);
assert.match(submitRoute, /submitVideoGenerationJob\(body, serverVideoJobDependencies\(\)\)/u);
assert.match(pollRoute, /pollVideoGenerationJob\(jobId, serverVideoJobDependencies\(\)\)/u);
assert.match(uiSource, /\/api\/media\/video\/health/u);
assert.match(uiSource, /videoRuntimeReady[\s\S]*externalVideoConsent[\s\S]*videoCostConfirmed/u);
assert.match(uiSource, /送出 Seedance 2\.5 測試工作/u);
assert.match(uiSource, /下載 JSON 交接資料（非影片）/u);
assert.match(uiSource, /providerExecution: "not_connected"/u);
assert.match(uiSource, /installedAdapters: \["byteplus-las-seedance-2\.5-server-contract"\]/u);

console.log("PASS Seedance 2.5 server-only and fail-closed contract");

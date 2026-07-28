import { WebLocalRuntimeClient } from "../lib/novel-ai/web/local-runtime-client.ts";
import { WebLocalRuntimeError } from "../lib/novel-ai/web/local-runtime-errors.ts";
import { discoverStudioClosedAI, runStudioClosedAI, studioPlatformTaskType } from "../lib/novel-ai/web/studio-closed-ai.ts";
import { createHarness, goodPublicHealth, goodSessionHealth, mockFetch } from "./run-ai-h2w1-test-utils.mjs";

const t = createHarness("H2W1 runtime-client");
const calls = [];
const fetchImpl = mockFetch([
  { path: "/health", body: goodPublicHealth },
  { path: "/session", body: goodSessionHealth },
  {
    path: "/tasks",
    method: "POST",
    body: { taskId: "task-1", status: "completed", provider: "ollama", model: "qwen2.5:3b", content: "候選正文", dataLeftDevice: false, warnings: [] },
  },
  { path: "/tasks/task-1/cancel", method: "POST", body: { taskId: "task-1", cancelled: true } },
], calls);

const client = new WebLocalRuntimeClient({ runtimeUrl: "http://127.0.0.1:43117", token: "session-token", fetchImpl, timeoutMs: 1000 });
const snapshot = await client.discover();
t.equal(snapshot.status, "ready", "discover returns ready");
t.equal(snapshot.protocolVersion, "novel-local-runtime-v1", "protocol recorded");
t.equal(snapshot.runtimeVersion, "h2w1-test-runtime", "runtime version recorded");
t.equal(snapshot.ollamaStatus, "ready", "ollama status recorded");
t.equal(snapshot.selectedModel, "qwen2.5:3b", "selected model recorded");
t.equal(snapshot.selectedStorage, "sqlite-local", "sqlite storage recorded");
t.equal(snapshot.dataLeftDevice, false, "data-left-device is false");
t.equal(snapshot.externalFallbackAllowed, false, "external fallback disabled by default");
t.ok(snapshot.capabilities.includes("generation"), "capabilities include generation");
t.equal(calls[0].options.headers["x-novel-local-token"], undefined, "public health does not receive token");
t.includes(calls[1].options.headers["x-novel-local-token"], "session-token", "protected session receives token");

const result = await client.runTask({ projectId: "project-1", taskType: "continue-writing", input: "下一章" });
t.equal(result.content, "候選正文", "task returns candidate content");
t.equal(result.dataLeftDevice, false, "task result stays local");
t.includes(calls[2].options.headers["x-novel-local-token"], "session-token", "session token sent in header");
t.notIncludes(calls[2].url, "session-token", "session token is not in URL");
t.notIncludes(calls[2].url, "token=", "no token query string");

const events = client.buildTaskEvents(result);
t.equal(events[0].type, "start", "events start with start");
t.ok(events.some((event) => event.type === "structured_result"), "events include structured_result");
t.equal(events.at(-1).type, "completed", "events finish with completed");

const cancelled = client.buildTaskEvents({ taskId: "task-2", status: "cancelled" });
t.equal(cancelled.at(-1).type, "cancelled", "cancelled result emits cancelled");
t.equal((await client.cancelTask("task-1")).cancelled, true, "cancelTask calls local runtime");

for (const badUrl of ["https://example.com", "http://192.168.1.10:43117", "http://127.0.0.1:43117?token=abc", "https://localhost:43117", "http://localhost:43117/path"]) {
  try {
    new WebLocalRuntimeClient({ runtimeUrl: badUrl, fetchImpl });
    t.ok(false, `blocked unsafe URL ${badUrl}`);
  } catch (error) {
    t.ok(error instanceof WebLocalRuntimeError, `unsafe URL throws typed error ${badUrl}`);
  }
}

const mismatchClient = new WebLocalRuntimeClient({
  runtimeUrl: "http://localhost:43117",
  fetchImpl: mockFetch([{ path: "/health", body: { ...goodPublicHealth, handshake: { ...goodPublicHealth.handshake, protocolVersion: "wrong" } } }]),
});
t.equal((await mismatchClient.discover()).status, "version_mismatch", "protocol mismatch reported");

const authClient = new WebLocalRuntimeClient({
  runtimeUrl: "http://localhost:43117",
  fetchImpl: mockFetch([{ path: "/health", body: goodPublicHealth }]),
});
t.equal((await authClient.discover()).status, "auth_required", "missing token reported before protected session call");

let transientHealthCalls = 0;
const retryClient = new WebLocalRuntimeClient({
  runtimeUrl: "http://localhost:43117",
  token: "session-token",
  discoveryAttempts: 2,
  retryDelayMs: 0,
  fetchImpl: async (url) => {
    if (String(url).endsWith("/health")) {
      transientHealthCalls += 1;
      if (transientHealthCalls === 1) throw new TypeError("temporary loopback refusal");
      return new Response(JSON.stringify(goodPublicHealth), { status: 200 });
    }
    return new Response(JSON.stringify(goodSessionHealth), { status: 200 });
  },
});
t.equal((await retryClient.discover()).status, "ready", "transient discovery failure recovers");
t.equal(transientHealthCalls, 2, "transient health request retried once");

let renewalSessionCalls = 0;
let renewalTaskCalls = 0;
const renewalClient = new WebLocalRuntimeClient({
  runtimeUrl: "http://localhost:43117",
  token: "session-token",
  retryDelayMs: 0,
  fetchImpl: async (url, options = {}) => {
    const path = new URL(String(url)).pathname;
    if (path === "/health") return new Response(JSON.stringify(goodPublicHealth), { status: 200 });
    if (path === "/session") {
      renewalSessionCalls += 1;
      const expiresAt = renewalSessionCalls === 1
        ? new Date(Date.now() - 1_000).toISOString()
        : new Date(Date.now() + 60_000).toISOString();
      return new Response(JSON.stringify({
        ...goodSessionHealth,
        handshake: { ...goodSessionHealth.handshake, sessionId: `renewed-${renewalSessionCalls}`, expiresAt },
      }), { status: 200 });
    }
    if (path === "/tasks" && (options.method ?? "GET") === "POST") {
      renewalTaskCalls += 1;
      return new Response(JSON.stringify({
        taskId: "renew-task",
        status: "completed",
        provider: "local-rule",
        model: "local-rule",
        content: "renewed",
        dataLeftDevice: false,
        warnings: [],
      }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  },
});
await renewalClient.discover();
await renewalClient.runTask({ projectId: "renew", taskType: "summary", input: "text" });
t.equal(renewalSessionCalls, 2, "expired session is renewed before task");
t.equal(renewalTaskCalls, 1, "renewed task is submitted exactly once");

let failedPostCalls = 0;
const noPostRetryClient = new WebLocalRuntimeClient({
  runtimeUrl: "http://localhost:43117",
  token: "session-token",
  discoveryAttempts: 3,
  retryDelayMs: 0,
  fetchImpl: async (url, options = {}) => {
    const path = new URL(String(url)).pathname;
    if (path === "/health") return new Response(JSON.stringify(goodPublicHealth), { status: 200 });
    if (path === "/session") return new Response(JSON.stringify(goodSessionHealth), { status: 200 });
    if (path === "/tasks" && (options.method ?? "GET") === "POST") {
      failedPostCalls += 1;
      return new Response(JSON.stringify({ errorCode: "TEMPORARY_FAILURE" }), { status: 503 });
    }
    return new Response("{}", { status: 404 });
  },
});
await noPostRetryClient.discover();
try {
  await noPostRetryClient.runTask({ projectId: "no-retry", taskType: "summary", input: "text" });
  t.ok(false, "failed task POST is surfaced");
} catch (error) {
  t.ok(error instanceof WebLocalRuntimeError, "failed task POST is surfaced");
}
t.equal(failedPostCalls, 1, "task POST is never automatically retried");

t.equal(studioPlatformTaskType("branch_choice"), "chapter.continue", "branch choice maps to closed chapter continuation");
t.equal(studioPlatformTaskType("dialogue_boost"), "character.dialogue", "dialogue helper maps to character dialogue");
t.equal(studioPlatformTaskType("topic_recommendation"), "creation.genreSuggestions", "topic helper maps to genre suggestions");

const providerFixture = (id, status, modelId = null) => ({
  id,
  status,
  modelId,
  maxContext: 32768,
  capabilities: ["text", "structured", "streaming", "offline"],
  local: true,
  requiresInternet: false,
});
const unifiedReady = await discoverStudioClosedAI(undefined, async () => [
  providerFixture("browser-ai", "runtime_unavailable"),
  providerFixture("local-ollama", "ready", "qwen2.5:3b"),
]);
t.equal(unifiedReady.status, "ollama_ready", "Studio discovers paired local Ollama");
t.equal(unifiedReady.modelId, "qwen2.5:3b", "Studio reports the active local model");
const unifiedBrowser = await discoverStudioClosedAI(undefined, async () => [
  providerFixture("browser-ai", "ready", "browser-model"),
  providerFixture("local-ollama", "runtime_unavailable"),
]);
t.equal(unifiedBrowser.status, "browser_ready", "Studio can use browser closed AI when available");
const unifiedAuth = await discoverStudioClosedAI(undefined, async () => [
  providerFixture("browser-ai", "runtime_unavailable"),
  providerFixture("local-ollama", "auth_required"),
]);
t.equal(unifiedAuth.status, "auth_required", "Studio surfaces provider authorization requirement");

let routedRequest = null;
const unifiedResult = await runStudioClosedAI({
  projectId: "unified-project",
  task: "continue_story",
  input: "continue locally",
  targetLength: 500,
}, async (request) => {
  routedRequest = request;
  return {
    requestId: request.requestId,
    providerId: "local-ollama",
    modelId: "qwen2.5:3b",
    modelDigest: "sha256:model",
    content: "本機候選正文",
    candidateOnly: true,
    externalRequest: false,
    dataLeavesDevice: false,
    elapsedMs: 10,
    provenance: {
      providerId: "local-ollama",
      modelId: "qwen2.5:3b",
      privacyMode: "strict-local",
      reason: "test",
      contextSources: [],
      externalRequest: false,
      dataLeavesDevice: false,
      fallbackChain: [],
      warnings: [],
    },
  };
});
t.equal(routedRequest.taskType, "chapter.continue", "Studio task uses platform task vocabulary");
t.equal(routedRequest.privacyLevel, "device_only", "Studio task is device-only");
t.equal(routedRequest.closedOnly, true, "Studio task is closed-provider-only");
t.equal(routedRequest.externalConsent, false, "Studio never grants external consent");
t.equal(routedRequest.preferredProvider, "local-ollama", "Studio prefers paired local Ollama");
t.includes(routedRequest.input, "500", "target length reaches closed provider request");
t.equal(unifiedResult.content, "本機候選正文", "unified Studio route returns local candidate");
t.equal(unifiedResult.dataLeftDevice, false, "unified Studio result stays on device");

try {
  await runStudioClosedAI({ projectId: "boundary", task: "story_seed", input: "x" }, async (request) => ({
    requestId: request.requestId,
    providerId: "openai",
    modelId: "external",
    content: "blocked",
    candidateOnly: true,
    externalRequest: true,
    dataLeavesDevice: true,
    elapsedMs: 1,
    provenance: {
      providerId: "openai",
      modelId: "external",
      privacyMode: "strict-local",
      reason: "invalid test route",
      contextSources: [],
      externalRequest: true,
      dataLeavesDevice: true,
      fallbackChain: [],
      warnings: [],
    },
  }));
  t.ok(false, "external result is blocked by Studio boundary");
} catch (error) {
  t.equal(error.code, "CLOSED_AI_BOUNDARY_VIOLATION", "external result is blocked by Studio boundary");
}

t.finish();

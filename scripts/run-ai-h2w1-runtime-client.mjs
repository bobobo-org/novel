import { WebLocalRuntimeClient } from "../lib/novel-ai/web/local-runtime-client.ts";
import { WebLocalRuntimeError } from "../lib/novel-ai/web/local-runtime-errors.ts";
import { createHarness, goodHealth, mockFetch } from "./run-ai-h2w1-test-utils.mjs";

const t = createHarness("H2W1 runtime-client");
const calls = [];
const fetchImpl = mockFetch([
  { path: "/health", body: goodHealth },
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

const result = await client.runTask({ projectId: "project-1", taskType: "continue-writing", input: "下一章" });
t.equal(result.content, "候選正文", "task returns candidate content");
t.equal(result.dataLeftDevice, false, "task result stays local");
t.includes(calls[1].options.headers["x-novel-local-token"], "session-token", "session token sent in header");
t.notIncludes(calls[1].url, "session-token", "session token is not in URL");
t.notIncludes(calls[1].url, "token=", "no token query string");

const events = client.buildTaskEvents(result);
t.equal(events[0].type, "start", "events start with start");
t.ok(events.some((event) => event.type === "structured_result"), "events include structured_result");
t.equal(events.at(-1).type, "completed", "events finish with completed");

const cancelled = client.buildTaskEvents({ taskId: "task-2", status: "cancelled" });
t.equal(cancelled.at(-1).type, "cancelled", "cancelled result emits cancelled");
t.equal((await client.cancelTask("task-1")).cancelled, true, "cancelTask calls local runtime");

for (const badUrl of ["https://example.com", "http://192.168.1.10:43117", "http://127.0.0.1:43117?token=abc"]) {
  try {
    new WebLocalRuntimeClient({ runtimeUrl: badUrl, fetchImpl });
    t.ok(false, `blocked unsafe URL ${badUrl}`);
  } catch (error) {
    t.ok(error instanceof WebLocalRuntimeError, `unsafe URL throws typed error ${badUrl}`);
  }
}

const mismatchClient = new WebLocalRuntimeClient({
  runtimeUrl: "http://localhost:43117",
  fetchImpl: mockFetch([{ path: "/health", body: { ...goodHealth, handshake: { ...goodHealth.handshake, protocolVersion: "wrong" } } }]),
});
t.equal((await mismatchClient.discover()).status, "version_mismatch", "protocol mismatch reported");

const authClient = new WebLocalRuntimeClient({
  runtimeUrl: "http://localhost:43117",
  fetchImpl: mockFetch([{ path: "/health", body: { ...goodHealth, handshake: null } }]),
});
t.equal((await authClient.discover()).status, "auth_required", "missing handshake reported");

t.finish();

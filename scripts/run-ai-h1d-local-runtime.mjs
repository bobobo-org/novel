import fs from "node:fs";
import path from "node:path";
import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { createLocalRuntimeServer } from "../local-runtime/server.ts";

const h = createHarness("H1D Local Runtime");
const storageDir = path.join(process.cwd(), "data", "h1d-runtime-tests");
fs.rmSync(storageDir, { recursive: true, force: true });
const runtime = createLocalRuntimeServer({ port: 43127, token: "test-token", storageDir, allowedOrigins: ["http://127.0.0.1", "https://novel-orcin.vercel.app"] });
await runtime.listen();
const base = "http://127.0.0.1:43127";

async function json(pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

try {
  const health = await json("/health");
  h.assert("health ready", health.body.localRuntimeStatus === "ready");
  h.assert("protocol version", health.body.localRuntimeProtocolVersion === "novel-local-runtime-v1");
  h.assert("handshake authenticated", health.body.handshake.authenticated === true);
  h.assert("token not exposed", !JSON.stringify(health.body).includes("test-token"));
  h.assert("bind host config", runtime.config.host === "127.0.0.1");

  const unauth = await json("/providers");
  h.assert("unauth blocked", unauth.response.status === 401);
  const badOrigin = await json("/providers", { headers: { "x-novel-local-token": "test-token", Origin: "http://evil.test" } });
  h.assert("bad origin blocked", badOrigin.response.status === 403);
  const providers = await json("/providers", { headers: { "x-novel-local-token": "test-token", Origin: "http://127.0.0.1" } });
  h.assert("providers listed", providers.body.providers.length >= 2);
  h.assert("provider data sanitized", !JSON.stringify(providers.body).includes("API_KEY"));

  const task = await json("/tasks", {
    method: "POST",
    headers: { "content-type": "application/json", "x-novel-local-token": "test-token" },
    body: JSON.stringify({ projectId: "h1d-project", taskType: "continue_writing", input: "主角在雨夜握住赤霄劍。" }),
  });
  h.assert("task completed", task.body.status === "completed");
  h.assert("task local provider", task.body.dataLeftDevice === false);
  h.assert("task has content", task.body.content.length > 0);
  const detail = await json(`/tasks/${task.body.taskId}?projectId=h1d-project`, { headers: { "x-novel-local-token": "test-token" } });
  h.assert("task detail persisted", detail.body.taskId === task.body.taskId);
  h.assert("wrong project isolated", (await json(`/tasks/${task.body.taskId}?projectId=other`, { headers: { "x-novel-local-token": "test-token" } })).response.status === 404);
  const cancel = await json(`/tasks/${task.body.taskId}/cancel`, { method: "POST", headers: { "x-novel-local-token": "test-token" } });
  h.assert("cancel endpoint safe", cancel.response.status === 200 && cancel.body.cancelled === false);
  const stream = await fetch(`${base}/tasks/${task.body.taskId}/stream`, { headers: { "x-novel-local-token": "test-token" } });
  h.assert("stream endpoint", stream.ok && (await stream.text()).includes("event: completed"));

  const analyze = await json("/projects/h1d-project/analyze", { method: "POST", headers: { "content-type": "application/json", "x-novel-local-token": "test-token" }, body: JSON.stringify({ chapterText: "林昭發現赤霄劍，也發現一個未解承諾。" }) });
  h.assert("project analyze", analyze.body.status === "completed");
  const cont = await json("/projects/h1d-project/continue", { method: "POST", headers: { "content-type": "application/json", "x-novel-local-token": "test-token" }, body: JSON.stringify({ input: "續寫下一幕。" }) });
  h.assert("project continue", cont.body.status === "completed");
  const rewrite = await json("/projects/h1d-project/rewrite", { method: "POST", headers: { "content-type": "application/json", "x-novel-local-token": "test-token" }, body: JSON.stringify({ input: "改寫這段。" }) });
  h.assert("project rewrite", rewrite.body.status === "completed");

  for (let i = 0; i < 14; i += 1) {
    const result = await json("/tasks", { method: "POST", headers: { "content-type": "application/json", "x-novel-local-token": "test-token" }, body: JSON.stringify({ projectId: "h1d-project", taskType: i % 2 ? "simple_summary" : "plot_brainstorm", input: `測試任務 ${i}` }) });
    h.assert(`queue task:${i}`, result.body.status === "completed" && result.body.dataLeftDevice === false);
  }
} finally {
  await runtime.close();
}

printAndExit(h.summary({ expectedPass: 30 }));

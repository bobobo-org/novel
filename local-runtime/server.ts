import http, { type IncomingMessage, type ServerResponse } from "http";
import { URL } from "url";
import { defaultProviderCapabilities } from "../lib/novel-ai/providers/default-providers";
import { checkOllamaHealth } from "../lib/novel-ai/providers/ollama/ollama-health";
import { createHandshake, validateLocalRuntimeRequest } from "./runtime-auth";
import { createLocalRuntimeConfig, type LocalRuntimeConfig } from "./runtime-config";
import { publicRuntimeError, LocalRuntimeError } from "./runtime-errors";
import { localRuntimeHealth } from "./runtime-health";
import { shutdownLocalRuntime } from "./runtime-shutdown";
import { cancelRuntimeTask, runRuntimeTask } from "./task-queue";
import { AiTaskSQLiteStore } from "./ai-task-store";

async function readJson(req: IncomingMessage, maxBytes: number) {
  let size = 0;
  let body = "";
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > maxBytes) throw new LocalRuntimeError("LOCAL_RUNTIME_REQUEST_TOO_LARGE", "Request body is too large.", 413);
    body += chunk;
  }
  return body ? JSON.parse(body) : {};
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
  });
  res.end(JSON.stringify(body));
}

export function createLocalRuntimeServer(config: Partial<LocalRuntimeConfig> = {}) {
  const runtimeConfig = createLocalRuntimeConfig(config);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${runtimeConfig.host}:${runtimeConfig.port}`);
      if (req.method === "GET" && url.pathname === "/health") {
        const health = await localRuntimeHealth();
        send(res, 200, {
          ...health,
          handshake: createHandshake(runtimeConfig, {
            ollamaStatus: health.ollamaStatus,
            installedModels: health.installedModels,
            selectedStorage: health.selectedStorage,
          }),
        });
        return;
      }
      validateLocalRuntimeRequest(req, runtimeConfig);
      if (req.method === "GET" && url.pathname === "/providers") {
        send(res, 200, { providers: await defaultProviderCapabilities() });
        return;
      }
      if (req.method === "GET" && url.pathname === "/ollama/health") {
        send(res, 200, await checkOllamaHealth());
        return;
      }
      if (req.method === "GET" && url.pathname === "/ollama/models") {
        const health = await checkOllamaHealth();
        send(res, 200, { status: health.status, models: health.profiles });
        return;
      }
      if (req.method === "POST" && url.pathname === "/tasks") {
        const body = await readJson(req, runtimeConfig.maxRequestBytes);
        const result = await runRuntimeTask({
          projectId: body.projectId || "local-runtime-project",
          taskType: body.taskType || "simple_summary",
          input: body.input || "",
          storageDir: runtimeConfig.storageDir,
          targetLength: body.targetLength,
        });
        send(res, 200, result);
        return;
      }
      const taskMatch = url.pathname.match(/^\/tasks\/([^/]+)$/);
      if (req.method === "GET" && taskMatch) {
        const projectId = url.searchParams.get("projectId") || "local-runtime-project";
        const store = await AiTaskSQLiteStore.open(projectId, runtimeConfig.storageDir);
        const task = store.getTask(taskMatch[1], projectId);
        store.close();
        if (!task) throw new LocalRuntimeError("LOCAL_RUNTIME_TASK_NOT_FOUND", "Task was not found.", 404);
        send(res, 200, task);
        return;
      }
      const cancelMatch = url.pathname.match(/^\/tasks\/([^/]+)\/cancel$/);
      if (req.method === "POST" && cancelMatch) {
        send(res, 200, { taskId: cancelMatch[1], cancelled: cancelRuntimeTask(cancelMatch[1]) });
        return;
      }
      const streamMatch = url.pathname.match(/^\/tasks\/([^/]+)\/stream$/);
      if (req.method === "GET" && streamMatch) {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
        res.write(`event: start\ndata: ${JSON.stringify({ taskId: streamMatch[1] })}\n\n`);
        res.write(`event: completed\ndata: ${JSON.stringify({ taskId: streamMatch[1], note: "stream history endpoint placeholder for completed tasks" })}\n\n`);
        res.end();
        return;
      }
      const projectTaskMatch = url.pathname.match(/^\/projects\/([^/]+)\/(analyze|continue|rewrite)$/);
      if (req.method === "POST" && projectTaskMatch) {
        const body = await readJson(req, runtimeConfig.maxRequestBytes);
        const action = projectTaskMatch[2];
        const taskType = action === "analyze" ? "story_bible_extraction" : action === "continue" ? "continue_writing" : "rewrite";
        const result = await runRuntimeTask({
          projectId: projectTaskMatch[1],
          taskType,
          input: body.input || body.chapterText || "",
          storageDir: runtimeConfig.storageDir,
        });
        send(res, 200, result);
        return;
      }
      throw new LocalRuntimeError("LOCAL_RUNTIME_ROUTE_NOT_FOUND", "Route not found.", 404);
    } catch (error) {
      const status = error instanceof LocalRuntimeError ? error.status : 500;
      send(res, status, publicRuntimeError(error));
    }
  });
  return {
    server,
    config: runtimeConfig,
    async listen() {
      await new Promise<void>((resolve) => server.listen(runtimeConfig.port, runtimeConfig.host, resolve));
      return `http://${runtimeConfig.host}:${runtimeConfig.port}`;
    },
    async close() {
      await shutdownLocalRuntime(server);
    },
  };
}

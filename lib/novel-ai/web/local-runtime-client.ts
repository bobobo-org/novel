import { WEB_LOCAL_RUNTIME_CLIENT_VERSION, WEB_LOCAL_RUNTIME_PROTOCOL_VERSION, type WebRuntimeHealth, type WebRuntimeSnapshot } from "./local-runtime-capabilities";
import { runtimeEvent, type WebRuntimeEvent } from "./local-runtime-events";
import { WebLocalRuntimeError } from "./local-runtime-errors";
import { createWebRuntimeSession, validateHandshake, validateRuntimeUrl } from "./local-runtime-handshake";
import { sessionExpired, type WebLocalRuntimeSession } from "./local-runtime-session";

export type WebLocalRuntimeClientOptions = {
  runtimeUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  externalFallbackAllowed?: boolean;
};

export type WebRuntimeTaskInput = {
  projectId: string;
  taskType: string;
  input: string;
  targetLength?: number;
};

export class WebLocalRuntimeClient {
  readonly runtimeUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly token?: string;
  private readonly externalFallbackAllowed: boolean;
  private session: WebLocalRuntimeSession | null = null;
  private health: WebRuntimeHealth | null = null;
  private lastErrorCode: string | null = null;

  constructor(options: WebLocalRuntimeClientOptions = {}) {
    const parsed = validateRuntimeUrl(options.runtimeUrl ?? "http://127.0.0.1:43117");
    this.runtimeUrl = parsed.origin;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.token = options.token;
    this.externalFallbackAllowed = Boolean(options.externalFallbackAllowed);
  }

  async discover() {
    try {
      const health = await this.request<WebRuntimeHealth>("/health", { auth: false });
      this.health = health;
      const handshake = validateHandshake(health);
      this.session = createWebRuntimeSession(handshake, this.token);
      this.lastErrorCode = null;
      return this.snapshot("ready");
    } catch (error) {
      this.lastErrorCode = error instanceof WebLocalRuntimeError ? error.code : "LOCAL_RUNTIME_NOT_FOUND";
      if (error instanceof WebLocalRuntimeError) {
        if (error.code === "LOCAL_RUNTIME_VERSION_MISMATCH") return this.snapshot("version_mismatch");
        if (error.code === "LOCAL_RUNTIME_AUTH_FAILED") return this.snapshot("auth_required");
      }
      return this.snapshot("unavailable");
    }
  }

  async runTask(input: WebRuntimeTaskInput) {
    this.ensureSession();
    return this.request<{
      taskId: string;
      status: string;
      provider: string;
      model: string;
      content: string;
      dataLeftDevice: boolean;
      warnings: string[];
    }>("/tasks", {
      method: "POST",
      body: JSON.stringify(input),
      auth: true,
    });
  }

  async cancelTask(taskId: string) {
    this.ensureSession();
    return this.request<{ taskId: string; cancelled: boolean }>(`/tasks/${encodeURIComponent(taskId)}/cancel`, { method: "POST", auth: true });
  }

  buildTaskEvents(result: { taskId: string; status: string; content?: string; warnings?: string[]; dataLeftDevice?: boolean }) {
    const events: WebRuntimeEvent[] = [
      runtimeEvent("start", { taskId: result.taskId, message: "Task accepted by local runtime." }),
      runtimeEvent("progress", { taskId: result.taskId, message: `Status: ${result.status}` }),
    ];
    for (const warning of result.warnings ?? []) events.push(runtimeEvent("warning", { taskId: result.taskId, message: warning }));
    if (result.content) events.push(runtimeEvent("structured_result", { taskId: result.taskId, payload: { contentLength: result.content.length, dataLeftDevice: result.dataLeftDevice } }));
    events.push(runtimeEvent(result.status === "cancelled" ? "cancelled" : "completed", { taskId: result.taskId, message: result.status }));
    return events;
  }

  snapshot(status: WebRuntimeSnapshot["status"] = this.health ? "ready" : "unknown"): WebRuntimeSnapshot {
    const handshake = this.health?.handshake;
    return {
      clientVersion: WEB_LOCAL_RUNTIME_CLIENT_VERSION,
      status,
      protocolVersion: handshake?.protocolVersion ?? WEB_LOCAL_RUNTIME_PROTOCOL_VERSION,
      runtimeVersion: handshake?.runtimeVersion ?? this.health?.localRuntimeVersion ?? "unknown",
      runtimeUrl: this.runtimeUrl,
      ollamaStatus: this.health?.ollamaStatus ?? handshake?.ollamaStatus ?? "unknown",
      selectedModel: this.health?.selectedModel ?? handshake?.installedModels?.[0] ?? "unknown",
      selectedStorage: this.health?.selectedStorage ?? handshake?.selectedStorage ?? "unknown",
      capabilities: handshake?.capabilities ?? [],
      dataLeftDevice: Boolean(this.health?.dataLeftDevice),
      externalFallbackAllowed: this.externalFallbackAllowed,
      lastHealthCheckAt: new Date().toISOString(),
      lastErrorCode: this.lastErrorCode,
    };
  }

  private ensureSession() {
    if (sessionExpired(this.session)) throw new WebLocalRuntimeError("LOCAL_RUNTIME_AUTH_FAILED", "Local runtime session is missing or expired.");
  }

  private async request<T>(path: string, options: { method?: string; body?: string; auth?: boolean }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (options.auth && this.token) headers["x-novel-local-token"] = this.token;
      const response = await this.fetchImpl(`${this.runtimeUrl}${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body,
        signal: controller.signal,
      });
      if (!response.ok) {
        const status = response.status;
        const code = status === 401 || status === 403 ? "LOCAL_RUNTIME_AUTH_FAILED" : "LOCAL_RUNTIME_REQUEST_FAILED";
        throw new WebLocalRuntimeError(code, `Local runtime request failed with HTTP ${status}.`, status);
      }
      return await response.json() as T;
    } catch (error) {
      if (error instanceof WebLocalRuntimeError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") throw new WebLocalRuntimeError("TASK_TIMEOUT", "Local runtime request timed out.");
      throw new WebLocalRuntimeError("LOCAL_RUNTIME_NOT_FOUND", error instanceof Error ? error.message : "Local runtime is unavailable.");
    } finally {
      clearTimeout(timer);
    }
  }
}

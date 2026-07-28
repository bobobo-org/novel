import {
  normalizeWebRuntimeCapabilities,
  WEB_LOCAL_RUNTIME_CLIENT_VERSION,
  WEB_LOCAL_RUNTIME_PROTOCOL_VERSION,
  type WebRuntimeHealth,
  type WebRuntimeSnapshot,
} from "./local-runtime-capabilities";
import { runtimeEvent, type WebRuntimeEvent } from "./local-runtime-events";
import { WebLocalRuntimeError } from "./local-runtime-errors";
import { createWebRuntimeSession, validateHandshake, validateRuntimeUrl } from "./local-runtime-handshake";
import { sessionExpired, type WebLocalRuntimeSession } from "./local-runtime-session";

export type WebLocalRuntimeClientOptions = {
  runtimeUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  discoveryAttempts?: number;
  retryDelayMs?: number;
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
  private readonly discoveryAttempts: number;
  private readonly retryDelayMs: number;
  private readonly token?: string;
  private readonly externalFallbackAllowed: boolean;
  private session: WebLocalRuntimeSession | null = null;
  private health: WebRuntimeHealth | null = null;
  private lastErrorCode: string | null = null;
  private lastHealthCheckAt: string | null = null;

  constructor(options: WebLocalRuntimeClientOptions = {}) {
    const parsed = validateRuntimeUrl(options.runtimeUrl ?? "http://127.0.0.1:43117");
    this.runtimeUrl = parsed.origin;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.discoveryAttempts = Math.max(1, Math.floor(options.discoveryAttempts ?? 2));
    this.retryDelayMs = Math.max(0, Math.floor(options.retryDelayMs ?? 150));
    this.token = options.token?.trim() || undefined;
    this.externalFallbackAllowed = Boolean(options.externalFallbackAllowed);
  }

  async discover() {
    this.session = null;
    try {
      const health = await this.requestWithRetry<WebRuntimeHealth>("/health", { auth: false });
      this.health = health;
      this.lastHealthCheckAt = new Date().toISOString();
      validateHandshake(health);
      if (!this.token) {
        throw new WebLocalRuntimeError("LOCAL_RUNTIME_AUTH_FAILED", "Local runtime authorization is required.");
      }
      const authenticatedHealth = await this.requestWithRetry<WebRuntimeHealth>("/session", { auth: true });
      this.health = authenticatedHealth;
      const handshake = validateHandshake(authenticatedHealth, { requireAuthenticated: true });
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
    await this.ensureSession();
    try {
      return await this.request<{
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
    } catch (error) {
      this.invalidateSessionOnAuthError(error);
      throw error;
    }
  }

  async cancelTask(taskId: string) {
    await this.ensureSession();
    try {
      return await this.request<{ taskId: string; cancelled: boolean }>(`/tasks/${encodeURIComponent(taskId)}/cancel`, { method: "POST", auth: true });
    } catch (error) {
      this.invalidateSessionOnAuthError(error);
      throw error;
    }
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
      capabilities: normalizeWebRuntimeCapabilities(handshake?.capabilities),
      dataLeftDevice: Boolean(this.health?.dataLeftDevice),
      externalFallbackAllowed: this.externalFallbackAllowed,
      lastHealthCheckAt: this.lastHealthCheckAt ?? new Date().toISOString(),
      lastErrorCode: this.lastErrorCode,
    };
  }

  private async ensureSession() {
    if (!sessionExpired(this.session)) return;
    const snapshot = await this.discover();
    if (snapshot.status === "ready") return;
    if (snapshot.status === "version_mismatch") {
      throw new WebLocalRuntimeError("LOCAL_RUNTIME_VERSION_MISMATCH", "Local runtime protocol is incompatible.");
    }
    if (snapshot.status === "auth_required") {
      throw new WebLocalRuntimeError("LOCAL_RUNTIME_AUTH_FAILED", "Local runtime authorization is missing or expired.");
    }
    throw new WebLocalRuntimeError("LOCAL_RUNTIME_NOT_FOUND", "Local runtime is unavailable.");
  }

  private invalidateSessionOnAuthError(error: unknown) {
    if (error instanceof WebLocalRuntimeError && error.code === "LOCAL_RUNTIME_AUTH_FAILED") {
      this.session = null;
      this.lastErrorCode = error.code;
    }
  }

  private async requestWithRetry<T>(path: string, options: { method?: string; body?: string; auth?: boolean }) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.discoveryAttempts; attempt += 1) {
      try {
        return await this.request<T>(path, options);
      } catch (error) {
        lastError = error;
        if (attempt >= this.discoveryAttempts || !this.retryableDiscoveryError(error)) throw error;
        if (this.retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
      }
    }
    throw lastError;
  }

  private retryableDiscoveryError(error: unknown) {
    if (!(error instanceof WebLocalRuntimeError)) return false;
    if (error.code === "LOCAL_RUNTIME_NOT_FOUND" || error.code === "TASK_TIMEOUT") return true;
    return error.code === "LOCAL_RUNTIME_REQUEST_FAILED"
      && Boolean(error.status === 408 || error.status === 429 || (error.status && error.status >= 500));
  }

  private async request<T>(path: string, options: { method?: string; body?: string; auth?: boolean }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {};
      if (options.body !== undefined) headers["Content-Type"] = "application/json";
      if (options.auth && this.token) headers["x-novel-local-token"] = this.token;
      const response = await this.fetchImpl(`${this.runtimeUrl}${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body,
        signal: controller.signal,
        cache: "no-store",
        credentials: "omit",
      });
      if (!response.ok) {
        const status = response.status;
        const code = status === 401 || status === 403 ? "LOCAL_RUNTIME_AUTH_FAILED" : "LOCAL_RUNTIME_REQUEST_FAILED";
        throw new WebLocalRuntimeError(code, `Local runtime request failed with HTTP ${status}.`, status);
      }
      return await response.json() as T;
    } catch (error) {
      if (error instanceof WebLocalRuntimeError) throw error;
      if (controller.signal.aborted || (error && typeof error === "object" && "name" in error && error.name === "AbortError")) {
        throw new WebLocalRuntimeError("TASK_TIMEOUT", "Local runtime request timed out.");
      }
      throw new WebLocalRuntimeError("LOCAL_RUNTIME_NOT_FOUND", error instanceof Error ? error.message : "Local runtime is unavailable.");
    } finally {
      clearTimeout(timer);
    }
  }
}

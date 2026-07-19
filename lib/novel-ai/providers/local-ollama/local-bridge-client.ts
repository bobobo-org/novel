import { AiProviderError } from "../provider-errors";

export const LOCAL_BRIDGE_PROTOCOL = "novel-local-bridge/v1";
const DEFAULT_ENDPOINT = "http://127.0.0.1:3217";

export type LocalBridgeSession = { token: string; csrf: string; instanceId: string; expiresAt: string };
export type LocalBridgeEvent = { type: "started" | "token" | "metadata" | "completed" | "cancelled" | "failed"; requestId?: string; text?: string; errorCode?: string; [key: string]: unknown };

function normalizeBridgeEndpoint(value = DEFAULT_ENDPOINT) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== "3217" || url.pathname !== "/" || url.search || url.hash) {
    throw new AiProviderError("LOCAL_SECURITY_POLICY_VIOLATION", "Local Bridge endpoint must be exactly http://127.0.0.1:3217", { retryable: false });
  }
  return url.origin;
}

export class LocalBridgeClient {
  readonly endpoint: string;
  readonly origin: string;
  private session: LocalBridgeSession | null = null;

  constructor(options: { endpoint?: string; origin?: string; session?: LocalBridgeSession } = {}) {
    this.endpoint = normalizeBridgeEndpoint(options.endpoint);
    this.origin = options.origin ?? "https://novel-orcin.vercel.app";
    this.session = options.session ?? null;
  }

  setSession(session: LocalBridgeSession | null) { this.session = session; }
  getSessionMetadata() { return this.session ? { instanceId: this.session.instanceId, expiresAt: this.session.expiresAt } : null; }

  private headers(authenticated = false, write = false) {
    const headers: Record<string, string> = { "X-Bridge-Protocol": LOCAL_BRIDGE_PROTOCOL, Origin: this.origin };
    if (authenticated) {
      if (!this.session) throw new AiProviderError("BRIDGE_NOT_PAIRED", "Local Bridge is not paired.", { retryable: false });
      headers.Authorization = `Bearer ${this.session.token}`;
      if (write) headers["X-Bridge-CSRF"] = this.session.csrf;
    }
    return headers;
  }

  private async parse(response: Response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new AiProviderError(body.errorCode || "LOCAL_PROVIDER_NOT_READY", body.message || `Local Bridge HTTP ${response.status}`, { retryable: Boolean(body.retryable), stage: "local-bridge" });
    return body;
  }

  async health(signal?: AbortSignal) {
    try {
      return this.parse(await fetch(`${this.endpoint}/health`, { headers: this.headers(), signal, cache: "no-store" }));
    } catch (error) {
      if (signal?.aborted) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return this.parse(await fetch(`${this.endpoint}/health`, { headers: this.headers(), signal, cache: "no-store" }));
    }
  }

  async requestPairing(signal?: AbortSignal) {
    return this.parse(await fetch(`${this.endpoint}/pair/request`, { method: "POST", headers: { ...this.headers(), "Content-Type": "application/json" }, body: "{}", signal }));
  }

  async confirmPairing(pairingId: string, code: string, signal?: AbortSignal) {
    const session = await this.parse(await fetch(`${this.endpoint}/pair/confirm`, { method: "POST", headers: { ...this.headers(), "Content-Type": "application/json" }, body: JSON.stringify({ pairingId, code }), signal })) as LocalBridgeSession;
    this.session = session;
    return session;
  }

  async revoke(signal?: AbortSignal) {
    const result = await this.parse(await fetch(`${this.endpoint}/pair/revoke`, { method: "POST", headers: { ...this.headers(true, true), "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }), signal }));
    this.session = null;
    return result;
  }

  async models(signal?: AbortSignal) {
    return this.parse(await fetch(`${this.endpoint}/models`, { headers: this.headers(true), signal, cache: "no-store" }));
  }

  async inspectModel(modelId: string, signal?: AbortSignal) {
    return this.parse(await fetch(`${this.endpoint}/models/${encodeURIComponent(modelId)}`, { headers: this.headers(true), signal, cache: "no-store" }));
  }

  async cancel(requestId: string, signal?: AbortSignal) {
    return this.parse(await fetch(`${this.endpoint}/cancel`, { method: "POST", headers: { ...this.headers(true, true), "Content-Type": "application/json" }, body: JSON.stringify({ requestId }), signal }));
  }

  async *generate(input: { requestId: string; model: string; prompt?: string; messages?: Array<{ role: string; content: string }>; systemInstruction?: string; taskType: string; timeoutMs?: number; options?: Record<string, unknown>; signal?: AbortSignal }): AsyncGenerator<LocalBridgeEvent> {
    const abort = () => { void this.cancel(input.requestId).catch(() => undefined); };
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetch(`${this.endpoint}/generate`, { method: "POST", headers: { ...this.headers(true, true), "Content-Type": "application/json", "Idempotency-Key": input.requestId }, body: JSON.stringify(input), signal: input.signal });
      if (!response.ok) { await this.parse(response); return; }
      const reader = response.body?.getReader();
      if (!reader) throw new AiProviderError("OLLAMA_INVALID_RESPONSE", "Local Bridge returned no stream.", { retryable: true });
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) if (line.trim()) yield JSON.parse(line) as LocalBridgeEvent;
      }
      if (buffer.trim()) yield JSON.parse(buffer) as LocalBridgeEvent;
    } finally { input.signal?.removeEventListener("abort", abort); }
  }
}

let configuredClient: LocalBridgeClient | null = null;
let configuredModelId: string | null = null;
export function configureLocalBridgeClient(client: LocalBridgeClient | null) { configuredClient = client; }
export function getConfiguredLocalBridgeClient() { return configuredClient; }
export function configureLocalBridgeModel(modelId: string | null) { configuredModelId = modelId; }
export function getConfiguredLocalBridgeModel() { return configuredModelId; }

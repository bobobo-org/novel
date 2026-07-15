import { AiProviderError } from "../provider-errors";
import { OllamaConnectionError, OllamaSecurityError } from "./ollama-errors";
import { collectOllamaStream } from "./ollama-stream-parser";

export type OllamaClientOptions = { endpoint?: string; timeoutMs?: number };
export type OllamaGenerateRequest = { model: string; prompt: string; stream?: boolean; format?: "json"; options?: Record<string, unknown>; signal?: AbortSignal };

export function normalizeOllamaEndpoint(endpoint = "http://127.0.0.1:11434") {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new OllamaSecurityError("Invalid Ollama endpoint URL");
  }
  if (!["http:"].includes(url.protocol)) throw new OllamaSecurityError("Only http:// localhost Ollama endpoints are allowed");
  const host = url.hostname.toLowerCase();
  const allowedHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (!allowedHosts.has(host)) throw new OllamaSecurityError("Ollama endpoint must be localhost, 127.0.0.1, or ::1");
  if (url.port && url.port !== "11434") throw new OllamaSecurityError("Ollama endpoint port must be 11434");
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export class OllamaClient {
  endpoint: string;
  timeoutMs: number;

  constructor(options: OllamaClientOptions = {}) {
    this.endpoint = normalizeOllamaEndpoint(options.endpoint);
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  private async request(path: string, init: RequestInit = {}, signal?: AbortSignal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetch(`${this.endpoint}${path}`, {
        ...init,
        redirect: "error",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", ...(init.headers || {}) },
      });
      if (!response.ok) throw new AiProviderError(response.status === 404 ? "AI_PROVIDER_MODEL_NOT_FOUND" : "AI_PROVIDER_CONNECTION_FAILED", `Ollama HTTP ${response.status}`, { retryable: response.status >= 500 });
      return response;
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") throw new AiProviderError("AI_PROVIDER_TIMEOUT", "Ollama request timed out or was cancelled", { retryable: true, stage: "ollama-fetch" });
      throw new OllamaConnectionError(error instanceof Error ? error.message : "Ollama connection failed");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  async tags(signal?: AbortSignal) {
    const response = await this.request("/api/tags", { method: "GET" }, signal);
    return response.json() as Promise<{ models?: Array<{ name?: string; model?: string }> }>;
  }

  async show(model: string, signal?: AbortSignal) {
    const response = await this.request("/api/show", { method: "POST", body: JSON.stringify({ model }) }, signal);
    return response.json();
  }

  async generate(input: OllamaGenerateRequest) {
    const response = await this.request("/api/generate", {
      method: "POST",
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        stream: input.stream ?? false,
        format: input.format,
        options: input.options,
      }),
    }, input.signal);
    if (input.stream) return { response: await collectOllamaStream(response, input.signal) };
    return response.json() as Promise<{ response?: string }>;
  }

  async chat(input: { model: string; messages: Array<{ role: string; content: string }>; stream?: boolean; signal?: AbortSignal }) {
    const response = await this.request("/api/chat", {
      method: "POST",
      body: JSON.stringify({ model: input.model, messages: input.messages, stream: input.stream ?? false }),
    }, input.signal);
    if (input.stream) return { message: { content: await collectOllamaStream(response, input.signal) } };
    return response.json() as Promise<{ message?: { content?: string } }>;
  }
}

import type { PlatformAIRequest, PlatformAIResult, PlatformProviderSnapshot, PlatformRouterDecision } from "../../router/platform-types";

function endpoint(value = "http://127.0.0.1:11434") { const url = new URL(value); if (!["localhost","127.0.0.1","::1","[::1]"].includes(url.hostname)) throw Object.assign(new Error("本機 AI 位址必須使用 localhost 或 loopback。"), { code: "OLLAMA_NON_LOOPBACK_BLOCKED" }); return url.origin; }

export async function probeLocalOllama(base?: string, signal?: AbortSignal): Promise<PlatformProviderSnapshot> {
  const started = performance.now();
  try { const response = await fetch(`${endpoint(base)}/api/tags`, { signal, cache: "no-store" }); if (!response.ok) throw new Error(`HTTP_${response.status}`); const body = await response.json(), models = Array.isArray(body.models) ? body.models.map((m: { name?: string }) => m.name).filter(Boolean) : []; return { id: "local-ollama", status: models.length ? "ready" : "runtime_not_installed", capabilities: ["text","structured","streaming","embedding","offline","long-context"], modelId: models[0] ?? null, maxContext: 32768, local: true, requiresInternet: false, latencyMs: Math.round(performance.now() - started) }; } catch { return { id: "local-ollama", status: "runtime_unavailable", capabilities: ["text","structured","streaming","embedding","offline","long-context"], modelId: null, maxContext: 0, local: true, requiresInternet: false, latencyMs: Math.round(performance.now() - started) }; }
}

export async function runLocalOllama(request: PlatformAIRequest, decision: PlatformRouterDecision, base?: string): Promise<PlatformAIResult> {
  const started = performance.now(), response = await fetch(`${endpoint(base)}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: request.signal, body: JSON.stringify({ model: decision.modelId, prompt: ["請使用繁體中文。產出候選內容，不得直接修改正式作品。", ...request.context, request.input].join("\n\n"), stream: false }) });
  if (!response.ok) throw Object.assign(new Error(`本機 AI 回應失敗（${response.status}）`), { code: "OLLAMA_GENERATION_FAILED", retryable: response.status >= 500 }); const body = await response.json();
  return { requestId: request.requestId, providerId: "local-ollama", modelId: decision.modelId, content: String(body.response || ""), candidateOnly: true, externalRequest: false, dataLeavesDevice: false, elapsedMs: Math.round(performance.now() - started), provenance: decision };
}

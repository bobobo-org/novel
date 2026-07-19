import type { PlatformAIRequest, PlatformProviderId, PlatformProviderSnapshot, PlatformRouterDecision } from "./platform-types";

const external = new Set<PlatformProviderId>(["openai", "gemini", "grok"]);
const privateHub = new Set<PlatformProviderId>(["private-ai-hub"]);
const defaultOrder: PlatformProviderId[] = ["browser-ai", "local-ollama", "private-ai-hub", "deterministic-local", "gemini", "openai", "grok"];

export class PlatformRouterError extends Error { code: string; retryable: boolean; constructor(code: string, message: string, retryable = false) { super(message); this.name = "PlatformRouterError"; this.code = code; this.retryable = retryable; } }

function allowed(id: PlatformProviderId, request: PlatformAIRequest) {
  if (external.has(id)) return request.privacyMode === "external-allowed" && request.externalConsent;
  if (privateHub.has(id)) return request.privacyMode === "private-hub-allowed";
  return true;
}

export function resolvePlatformProvider(request: PlatformAIRequest, providers: PlatformProviderSnapshot[]): PlatformRouterDecision {
  const byId = new Map(providers.map((provider) => [provider.id, provider])), warnings: string[] = [];
  const order = [...new Set([request.preferredProvider, ...defaultOrder].filter(Boolean) as PlatformProviderId[])];
  const viable = order.filter((id) => {
    const provider = byId.get(id);
    if (!provider) return false;
    if (!allowed(id, request)) { warnings.push(`${id}: blocked_by_privacy_policy`); return false; }
    if (provider.status !== "ready") { warnings.push(`${id}: ${provider.status}`); return false; }
    if (request.requiresStreaming && !provider.capabilities.includes("streaming")) return false;
    if (request.requiresStructured && !provider.capabilities.includes("structured")) return false;
    return true;
  });
  const providerId = viable[0];
  if (!providerId) throw new PlatformRouterError("NO_ALLOWED_PROVIDER", "目前沒有符合隱私設定與任務需求的可用執行方式。", true);
  const provider = byId.get(providerId)!;
  return { providerId, modelId: provider.modelId, privacyMode: request.privacyMode, reason: `${providerId} is the first ready provider allowed by ${request.privacyMode}`, contextSources: request.context.map((_, index) => `context-${index + 1}`), externalRequest: external.has(providerId) || privateHub.has(providerId), dataLeavesDevice: external.has(providerId) || privateHub.has(providerId), fallbackChain: viable.slice(1), warnings };
}

export function assertFallbackAllowed(from: PlatformProviderId, to: PlatformProviderId, request: PlatformAIRequest) {
  if (!allowed(to, request)) throw new PlatformRouterError("FALLBACK_PRIVACY_BOUNDARY_BLOCKED", `禁止從 ${from} 無聲切換至 ${to}。`, false);
}

import type { PlatformAIRequest, PlatformProviderCapability, PlatformProviderId, PlatformProviderSnapshot, PlatformRouterDecision } from "./platform-types";

const external = new Set<PlatformProviderId>(["openai", "gemini", "grok"]);
const privateHub = new Set<PlatformProviderId>(["private-ai-hub"]);
const modelBackedClosed = new Set<PlatformProviderId>(["browser-ai", "local-ollama", "private-ai-hub"]);
const defaultOrder: PlatformProviderId[] = ["browser-ai", "local-ollama", "private-ai-hub", "deterministic-local", "gemini", "openai", "grok"];

export class PlatformRouterError extends Error {
  code: string;
  retryable: boolean;
  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "PlatformRouterError";
    this.code = code;
    this.retryable = retryable;
  }
}

function allowed(id: PlatformProviderId, request: PlatformAIRequest) {
  if (request.closedOnly && !modelBackedClosed.has(id)) return false;
  if (request.offlineRequired && (external.has(id) || privateHub.has(id))) return false;
  if (request.privacyLevel === "device_only") return id === "browser-ai" || id === "local-ollama";
  if (request.privacyLevel === "private_infrastructure_only") return modelBackedClosed.has(id);
  if (external.has(id)) return request.privacyMode === "external-allowed" && request.externalConsent;
  if (privateHub.has(id)) return request.privacyMode === "private-hub-allowed";
  return true;
}

function requiredCapabilities(request: PlatformAIRequest): PlatformProviderCapability[] {
  return Array.from(new Set([
    ...(request.requiredCapabilities ?? []),
    ...(request.requiresStreaming ? ["streaming" as const] : []),
    ...(request.requiresStructured ? ["structured" as const] : []),
  ]));
}

export function resolvePlatformProvider(request: PlatformAIRequest, providers: PlatformProviderSnapshot[]): PlatformRouterDecision {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const warnings: string[] = [];
  const rejectedCandidates: Array<{ providerId: PlatformProviderId; reason: string }> = [];
  const order = [...new Set([request.preferredProvider, ...defaultOrder].filter(Boolean) as PlatformProviderId[])];
  const required = requiredCapabilities(request);
  const viable = order.filter((id) => {
    const provider = byId.get(id);
    if (!provider) return false;
    if (!allowed(id, request)) {
      warnings.push(`${id}: blocked_by_privacy_policy`);
      rejectedCandidates.push({ providerId: id, reason: "blocked_by_privacy_policy" });
      return false;
    }
    if (provider.status !== "ready") {
      warnings.push(`${id}: ${provider.status}`);
      rejectedCandidates.push({ providerId: id, reason: provider.status });
      return false;
    }
    if (request.offlineRequired && provider.requiresInternet) {
      rejectedCandidates.push({ providerId: id, reason: "offline_required" });
      return false;
    }
    if ((request.estimatedContextSize ?? request.input.length) > provider.maxContext) {
      rejectedCandidates.push({ providerId: id, reason: "context_too_large" });
      return false;
    }
    if (!required.every((capability) => provider.capabilities.includes(capability))) {
      rejectedCandidates.push({ providerId: id, reason: "missing_capability" });
      return false;
    }
    return true;
  });
  const providerId = viable[0];
  if (!providerId) {
    throw new PlatformRouterError(
      request.closedOnly ? "NO_CLOSED_PROVIDER_AVAILABLE" : "NO_ALLOWED_PROVIDER",
      request.closedOnly ? "No closed AI provider is available for this request." : "No allowed provider is available for this request.",
      true,
    );
  }
  const provider = byId.get(providerId)!;
  return {
    providerId,
    modelId: provider.modelId,
    privacyMode: request.privacyMode,
    reason: `${providerId} is the first ready provider allowed by ${request.privacyLevel ?? request.privacyMode}`,
    contextSources: request.context.map((_, index) => `context-${index + 1}`),
    externalRequest: external.has(providerId) || privateHub.has(providerId),
    dataLeavesDevice: external.has(providerId) || privateHub.has(providerId),
    fallbackChain: viable.slice(1),
    warnings,
    rejectedCandidates,
    privacyValidation: "passed",
    capabilityValidation: "passed",
    noRouteReason: null,
    auditMetadata: { requestId: request.requestId, idempotencyKey: request.idempotencyKey, closedOnly: Boolean(request.closedOnly), offlineRequired: Boolean(request.offlineRequired), decidedAt: new Date().toISOString() },
  };
}

export function assertFallbackAllowed(from: PlatformProviderId, to: PlatformProviderId, request: PlatformAIRequest) {
  if (!allowed(to, request)) throw new PlatformRouterError("FALLBACK_PRIVACY_BOUNDARY_BLOCKED", `Fallback from ${from} to ${to} violates the request privacy boundary.`, false);
}

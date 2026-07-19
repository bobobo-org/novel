import type { PlatformAIRequest, PlatformProviderSnapshot, PlatformRouterDecision } from "./platform-types";
import { PlatformRouterError, resolvePlatformProvider } from "./platform-router";

export const CLOSED_ROUTER_AUDIT_VERSION = "closed-router-audit-v1";
export type ClosedRouterAudit = {
  schemaVersion: typeof CLOSED_ROUTER_AUDIT_VERSION;
  requestId: string;
  selectedProvider: string | null;
  rejectedProviders: Array<{ providerId: string; reason: string }>;
  privacyDecision: "passed" | "blocked";
  capabilityDecision: "passed" | "blocked";
  fallbackOrder: string[];
  closedOnly: boolean;
  finalErrorCode: string | null;
  createdAt: string;
};

export function resolveClosedAIWithAudit(request: PlatformAIRequest, providers: PlatformProviderSnapshot[]): { decision: PlatformRouterDecision | null; audit: ClosedRouterAudit } {
  try {
    const decision = resolvePlatformProvider(request, providers);
    return { decision, audit: { schemaVersion: CLOSED_ROUTER_AUDIT_VERSION, requestId: request.requestId, selectedProvider: decision.providerId, rejectedProviders: decision.rejectedCandidates ?? [], privacyDecision: decision.privacyValidation ?? "passed", capabilityDecision: decision.capabilityValidation ?? "passed", fallbackOrder: decision.fallbackChain, closedOnly: Boolean(request.closedOnly), finalErrorCode: null, createdAt: new Date().toISOString() } };
  } catch (error) {
    const errorCode = error instanceof PlatformRouterError ? error.code : "CLOSED_ROUTER_UNKNOWN_ERROR";
    return { decision: null, audit: { schemaVersion: CLOSED_ROUTER_AUDIT_VERSION, requestId: request.requestId, selectedProvider: null, rejectedProviders: providers.map((provider) => ({ providerId: provider.id, reason: provider.status === "ready" ? "blocked_by_policy_or_capability" : provider.status })), privacyDecision: errorCode === "NO_CLOSED_PROVIDER_AVAILABLE" ? "blocked" : "passed", capabilityDecision: "blocked", fallbackOrder: [], closedOnly: Boolean(request.closedOnly), finalErrorCode: errorCode, createdAt: new Date().toISOString() } };
  }
}

export function validateClosedRouterAudit(value: ClosedRouterAudit) {
  if (value.schemaVersion !== CLOSED_ROUTER_AUDIT_VERSION) return { valid: false, errorCode: "CLOSED_ROUTER_AUDIT_SCHEMA_UNSUPPORTED" };
  if (!value.requestId) return { valid: false, errorCode: "CLOSED_ROUTER_AUDIT_REQUEST_REQUIRED" };
  if (!value.selectedProvider && !value.finalErrorCode) return { valid: false, errorCode: "CLOSED_ROUTER_AUDIT_OUTCOME_REQUIRED" };
  return { valid: true, errorCode: null };
}

export function migrateClosedRouterAudit(value: Record<string, unknown>): ClosedRouterAudit | null {
  if (value.schemaVersion === CLOSED_ROUTER_AUDIT_VERSION) return value as ClosedRouterAudit;
  return null;
}

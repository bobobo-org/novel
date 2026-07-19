import type { PlatformAIRequest, PlatformAIResult, PlatformProviderCapability, PlatformProviderSnapshot, PlatformRouterDecision } from "../../router/platform-types";

export const CLOSED_PROVIDER_SCHEMA_VERSION = "closed-provider-v1";
export type ClosedAIProviderKind = "browser" | "local_ollama" | "private_hub";
export type ClosedAIContractStatus = "not_implemented" | "contract_only" | "test_only" | "partial" | "runtime_ready" | "production_ready" | "unsupported";

export type ClosedAIModelProfile = { modelId: string; version?: string; contextLimit: number; outputLimit: number; capabilities: PlatformProviderCapability[] };
export type ClosedAIProviderDescriptor = {
  schemaVersion: typeof CLOSED_PROVIDER_SCHEMA_VERSION;
  providerId: PlatformProviderSnapshot["id"];
  providerKind: ClosedAIProviderKind;
  status: ClosedAIContractStatus;
  modelProfile: ClosedAIModelProfile | null;
  privacyBoundary: "device" | "private_infrastructure";
  executionLocation: "browser" | "loopback" | "private_network";
  streamingSupport: boolean;
  structuredOutputSupport: boolean;
  toolSupport: boolean;
  embeddingSupport: boolean;
  cancellationSupport: boolean;
  timeoutMs: number;
};

export interface ClosedAIProviderContract {
  readonly descriptor: ClosedAIProviderDescriptor;
  healthProbe(signal?: AbortSignal): Promise<PlatformProviderSnapshot>;
  generate(request: PlatformAIRequest, decision: PlatformRouterDecision): Promise<PlatformAIResult>;
  embed?(input: string[], signal?: AbortSignal): Promise<number[][]>;
  cancel(requestId: string): Promise<boolean>;
}

export function validateClosedAIProviderDescriptor(value: ClosedAIProviderDescriptor) {
  if (value.schemaVersion !== CLOSED_PROVIDER_SCHEMA_VERSION) return { valid: false, errorCode: "CLOSED_PROVIDER_SCHEMA_UNSUPPORTED" };
  if (!value.providerId || !value.providerKind) return { valid: false, errorCode: "CLOSED_PROVIDER_IDENTITY_MISSING" };
  if (value.modelProfile && (value.modelProfile.contextLimit <= 0 || value.modelProfile.outputLimit <= 0)) return { valid: false, errorCode: "CLOSED_PROVIDER_MODEL_PROFILE_INVALID" };
  if (value.providerKind === "browser" && value.executionLocation !== "browser") return { valid: false, errorCode: "CLOSED_PROVIDER_LOCATION_MISMATCH" };
  if (value.providerKind === "local_ollama" && value.executionLocation !== "loopback") return { valid: false, errorCode: "CLOSED_PROVIDER_LOCATION_MISMATCH" };
  if (value.providerKind === "private_hub" && value.executionLocation !== "private_network") return { valid: false, errorCode: "CLOSED_PROVIDER_LOCATION_MISMATCH" };
  return { valid: true, errorCode: null };
}

export function migrateClosedAIProviderDescriptor(value: Record<string, unknown>): ClosedAIProviderDescriptor | null {
  if (value.schemaVersion === CLOSED_PROVIDER_SCHEMA_VERSION) return value as ClosedAIProviderDescriptor;
  return null;
}

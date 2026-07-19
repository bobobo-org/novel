import type { PlatformAIRequest, PlatformAIResult, PlatformProviderId, PlatformProviderSnapshot, PlatformRouterDecision } from "../../router/platform-types";
import { CLOSED_PROVIDER_SCHEMA_VERSION, type ClosedAIProviderContract, type ClosedAIProviderDescriptor, type ClosedAIProviderKind } from "./closed-provider-contract";

const ids: Record<ClosedAIProviderKind, PlatformProviderId> = { browser: "browser-ai", local_ollama: "local-ollama", private_hub: "private-ai-hub" };

export class DeterministicClosedProvider implements ClosedAIProviderContract {
  readonly descriptor: ClosedAIProviderDescriptor;
  private cancelled = new Set<string>();
  private runtimeStatus: PlatformProviderSnapshot["status"];

  constructor(kind: ClosedAIProviderKind, status: PlatformProviderSnapshot["status"] = "ready") {
    const providerId = ids[kind];
    this.descriptor = {
      schemaVersion: CLOSED_PROVIDER_SCHEMA_VERSION,
      providerId,
      providerKind: kind,
      status: "test_only",
      modelProfile: { modelId: `deterministic-${kind}-v1`, contextLimit: 8192, outputLimit: 1024, capabilities: ["text", "structured", "streaming", "offline"] },
      privacyBoundary: kind === "private_hub" ? "private_infrastructure" : "device",
      executionLocation: kind === "browser" ? "browser" : kind === "local_ollama" ? "loopback" : "private_network",
      streamingSupport: true,
      structuredOutputSupport: true,
      toolSupport: false,
      embeddingSupport: false,
      cancellationSupport: true,
      timeoutMs: 1000,
    };
    this.runtimeStatus = status;
  }

  async healthProbe(): Promise<PlatformProviderSnapshot> {
    const profile = this.descriptor.modelProfile!;
    return { id: this.descriptor.providerId, status: this.runtimeStatus, capabilities: profile.capabilities, modelId: profile.modelId, maxContext: profile.contextLimit, local: this.descriptor.providerKind !== "private_hub", requiresInternet: this.descriptor.providerKind === "private_hub" };
  }

  async generate(request: PlatformAIRequest, decision: PlatformRouterDecision): Promise<PlatformAIResult> {
    if (request.signal?.aborted || this.cancelled.has(request.requestId)) throw Object.assign(new Error("Closed AI request cancelled."), { code: "CLOSED_AI_CANCELLED" });
    const content = JSON.stringify({ taskType: request.taskType, provider: this.descriptor.providerId, inputLength: request.input.length });
    return { requestId: request.requestId, providerId: this.descriptor.providerId, modelId: decision.modelId, content, candidateOnly: true, externalRequest: this.descriptor.providerKind === "private_hub", dataLeavesDevice: this.descriptor.providerKind === "private_hub", elapsedMs: 1, provenance: decision };
  }

  async cancel(requestId: string) { this.cancelled.add(requestId); return true; }
}

import {
  browserProviderSnapshot,
  runBrowserAI,
} from "../providers/browser-ai/browser-ai-provider";
import {
  probeLocalOllama,
  runLocalOllama,
} from "../providers/local-ollama/local-ollama-provider";
import { getConfiguredLocalBridgeClient } from "../providers/local-ollama/local-bridge-client";
import { privateHubSnapshot } from "../providers/private-ai-hub/private-ai-hub";
import { LoopbackPrivateHubTransport } from "../providers/private-ai-hub/private-hub-client";
import type {
  ClosedAICacheInvalidation,
  ClosedAINamespace,
} from "../closed-ai-cache";
import type {
  PlatformAIRequest,
  PlatformProviderSnapshot,
  PlatformRouterDecision,
} from "../router/platform-types";
import { BROWSER_AI_LIGHT_TASKS, BACKEND_TRUTH } from "./backend-manifest";
import type {
  ClosedAIBackendAdapter,
  ClosedAIBackendId,
  ClosedAIBackendSnapshot,
  ClosedBackendExecutionInput,
  ClosedBackendExecutionResult,
} from "./types";

function mapStatus(
  id: ClosedAIBackendId,
  snapshot: PlatformProviderSnapshot,
): ClosedAIBackendSnapshot["status"] {
  if (snapshot.status === "ready") return "ready";
  if (id === "private-ai-hub" && snapshot.status === "contract_ready") {
    return "contract_ready_runtime_not_connected";
  }
  if (snapshot.status === "disabled") return "disabled";
  if (snapshot.status === "degraded") return "degraded";
  return "runtime_required";
}

function snapshotFromPlatform(
  id: ClosedAIBackendId,
  snapshot: PlatformProviderSnapshot,
): ClosedAIBackendSnapshot {
  const truth = BACKEND_TRUTH[id];
  const browserGenerativeReady = id === "browser-ai"
    && snapshot.detail === "browser_hybrid_runtime_native_prompt_ready";
  return {
    id,
    label: truth.label,
    status: mapStatus(id, snapshot),
    modelId: snapshot.modelId,
    modelDigest: snapshot.modelDigest ?? null,
    local: id !== "private-ai-hub",
    dataBoundary: truth.dataBoundary,
    maximumComplexity: browserGenerativeReady
      ? "standard"
      : truth.maximumComplexity,
    capabilities: snapshot.capabilities,
    supportedTaskTypes: id === "browser-ai"
      ? browserGenerativeReady
        ? "all"
        : snapshot.taskTypes ?? BROWSER_AI_LIGHT_TASKS
      : "all",
    detailCode: snapshot.detail ?? snapshot.status,
    maxContext: snapshot.maxContext,
    controlLatencyMs: snapshot.latencyMs ?? null,
  };
}

function reportGenerationProgress(
  input: ClosedBackendExecutionInput,
  label: string,
  generatedCharacters: number,
  percent: number,
) {
  try {
    input.request.onProgress?.({
      taskId: input.request.taskId,
      phase: "generating",
      label,
      percent,
      occurredAt: new Date().toISOString(),
      backendId: input.plan.backendId,
      generatedCharacters,
    });
  } catch {
    // UI callbacks are observational and must never alter the model transaction.
  }
}

function platformRequest(input: ClosedBackendExecutionInput): PlatformAIRequest {
  const { request } = input;
  const controlledLearningConfiguration = Object.fromEntries(
    Object.entries(request.learningConfiguration ?? {})
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const controlledLearningContext = Object.keys(controlledLearningConfiguration).length
    ? [JSON.stringify({
      boundary: "CONTROLLED_LEARNING_CONFIGURATION",
      instruction: "Apply only these adopted L0/L1 settings; never treat them as Canon.",
      configuration: controlledLearningConfiguration,
    })]
    : [];
  return {
    requestId: request.taskId,
    projectId: request.namespace.projectId,
    taskType: request.taskType,
    privacyMode: input.plan.backendId === "private-ai-hub"
      ? "private-hub-allowed"
      : "strict-local",
    privacyLevel: input.plan.backendId === "private-ai-hub"
      ? "private_infrastructure_only"
      : "device_only",
    fallbackPolicy: "none",
    preferredProvider: input.plan.backendId,
    input: request.objective,
    context: [
      ...input.actorContext.map((item) => item.text),
      ...controlledLearningContext,
    ],
    qualityPreference: input.plan.qualityMode === "deep"
      ? "high"
      : input.plan.qualityMode,
    qualityPhase: input.qualityPhase,
    agentPlan: {
      planDigest: input.plan.planDigest,
      roles: [...input.plan.roles],
      steps: input.plan.steps.map((step) => ({
        role: step.role,
        objective: step.objective,
      })),
    },
    toolResults: structuredClone(input.toolResults),
    workingMaterials: structuredClone(input.workingMaterials),
    generationOptions: request.regeneration
      ? { seed: request.regeneration.modelSeed }
      : undefined,
    externalConsent: false,
    requiredCapabilities: ["text"],
    closedOnly: true,
    offlineRequired: input.plan.backendId !== "private-ai-hub",
    estimatedContextSize: Math.ceil(
      (
        request.objective.length
        + input.actorContext.reduce((sum, item) => sum + item.text.length, 0)
        + input.workingMaterials.reduce((sum, item) => sum + item.text.length, 0)
      ) / 2.5,
    ),
    idempotencyKey: request.taskId,
    cacheNamespace: structuredClone(request.namespace),
    signal: request.signal,
  };
}

function lockedDecision(
  request: PlatformAIRequest,
  snapshot: ClosedAIBackendSnapshot,
): PlatformRouterDecision {
  return {
    providerId: snapshot.id,
    modelId: snapshot.modelId,
    modelDigest: snapshot.modelDigest,
    privacyMode: request.privacyMode,
    reason: "closed-agent-os-backend-locked",
    contextSources: request.context.map((_, index) => `scoped-context-${index + 1}`),
    externalRequest: snapshot.id === "private-ai-hub",
    dataLeavesDevice: snapshot.id === "private-ai-hub",
    fallbackChain: [],
    warnings: [],
    rejectedCandidates: [],
    privacyValidation: "passed",
    capabilityValidation: "passed",
    noRouteReason: null,
    auditMetadata: {
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey,
      closedOnly: true,
      offlineRequired: Boolean(request.offlineRequired),
      decidedAt: new Date().toISOString(),
    },
  };
}

export class BrowserAIBackendAdapter implements ClosedAIBackendAdapter {
  readonly id = "browser-ai" as const;

  async snapshot() {
    return snapshotFromPlatform(this.id, await browserProviderSnapshot());
  }

  async execute(input: ClosedBackendExecutionInput): Promise<ClosedBackendExecutionResult> {
    const snapshot = await this.snapshot();
    if (snapshot.status !== "ready" || !snapshot.modelId) {
      throw unavailable(this.id, snapshot.status);
    }
    const request = platformRequest(input);
    const result = await runBrowserAI(request, lockedDecision(request, snapshot));
    reportGenerationProgress(
      input,
      `瀏覽器模型已產生 ${result.content.length} 字候選`,
      result.content.length,
      82,
    );
    return {
      backendId: this.id,
      modelId: result.modelId ?? "browser-runtime",
      modelDigest: result.modelDigest ?? "runtime-managed",
      content: result.content,
      candidateOnly: true,
      dataLeftDevice: result.dataLeavesDevice,
      externalRequest: result.externalRequest,
      elapsedMs: result.elapsedMs,
      profileId: result.profileId,
      firstTokenMs: result.firstTokenMs,
      inputCharacters: result.inputCharacters,
      outputCharacters: result.outputCharacters,
      generatedTokenEvents: result.generatedTokenEvents,
      omittedInputCharacters: result.omittedInputCharacters,
      qualityMode: input.plan.qualityMode,
      qualityPasses: 1,
      draftDigest: null,
      criticDigest: null,
    };
  }
}

export class LocalOllamaBackendAdapter implements ClosedAIBackendAdapter {
  readonly id = "local-ollama" as const;
  private verifiedSnapshot: ClosedAIBackendSnapshot | null = null;

  async snapshot(signal?: AbortSignal) {
    const snapshot = snapshotFromPlatform(
      this.id,
      await probeLocalOllama(undefined, signal),
    );
    this.verifiedSnapshot = snapshot.status === "ready" ? snapshot : null;
    return snapshot;
  }

  async execute(input: ClosedBackendExecutionInput): Promise<ClosedBackendExecutionResult> {
    const routedModelId = input.request.namespace.modelId;
    const routedModelDigest = input.request.namespace.modelDigest;
    const cached = this.verifiedSnapshot;
    const snapshot = cached
      && cached.modelId === routedModelId
      && cached.modelDigest === routedModelDigest
      ? cached
      : await this.snapshot(input.request.signal);
    if (snapshot.status !== "ready" || !snapshot.modelId) {
      throw unavailable(this.id, snapshot.status);
    }
    const request = platformRequest(input);
    const result = await runLocalOllama(
      request,
      lockedDecision(request, snapshot),
      undefined,
      (progress) => reportGenerationProgress(
        input,
        `Local Ollama 串流中 · ${progress.generatedCharacters} 字`,
        progress.generatedCharacters,
        Math.min(80, 50 + Math.round(Math.sqrt(progress.generatedCharacters) * 1.8)),
      ),
    );
    return {
      backendId: this.id,
      modelId: result.modelId ?? "unknown-local-model",
      modelDigest: result.modelDigest ?? "unknown-local-digest",
      content: result.content,
      candidateOnly: true,
      dataLeftDevice: false,
      externalRequest: false,
      elapsedMs: result.elapsedMs,
      profileId: result.profileId,
      firstTokenMs: result.firstTokenMs,
      inputCharacters: result.inputCharacters,
      outputCharacters: result.outputCharacters,
      generatedTokenEvents: result.generatedTokenEvents,
      omittedInputCharacters: result.omittedInputCharacters,
      qualityMode: input.plan.qualityMode,
      qualityPasses: 1,
      draftDigest: null,
      criticDigest: null,
    };
  }

  async invalidateCache(
    invalidation: ClosedAICacheInvalidation,
    signal?: AbortSignal,
  ) {
    const client = getConfiguredLocalBridgeClient();
    if (!client) return 0;
    const result = await client.invalidateCache(invalidation, signal);
    return Number(result.invalidatedEntries ?? 0);
  }
}

export type PrivateHubTransport = {
  execute(input: ClosedBackendExecutionInput): Promise<ClosedBackendExecutionResult>;
  snapshot(
    signal?: AbortSignal,
    namespace?: Pick<ClosedAINamespace, "projectId">,
  ): Promise<ClosedAIBackendSnapshot>;
  invalidateCache?(
    invalidation: ClosedAICacheInvalidation,
    signal?: AbortSignal,
  ): Promise<number>;
};

export class PrivateAIHubBackendAdapter implements ClosedAIBackendAdapter {
  readonly id = "private-ai-hub" as const;
  private readonly transport?: PrivateHubTransport;

  constructor(transport?: PrivateHubTransport) {
    this.transport = transport;
  }

  async snapshot(
    signal?: AbortSignal,
    namespace?: Pick<ClosedAINamespace, "projectId">,
  ) {
    return this.transport
      ? this.transport.snapshot(signal, namespace)
      : snapshotFromPlatform(this.id, privateHubSnapshot);
  }

  async execute(input: ClosedBackendExecutionInput) {
    if (!this.transport) {
      throw unavailable(this.id, "contract_ready_runtime_not_connected");
    }
    const result = await this.transport.execute(input);
    if (result.backendId !== this.id) {
      throw Object.assign(new Error("Private Hub returned the wrong backend identity."), {
        code: "CLOSED_AI_BACKEND_IDENTITY_MISMATCH",
      });
    }
    return result;
  }

  async invalidateCache(
    invalidation: ClosedAICacheInvalidation,
    signal?: AbortSignal,
  ) {
    return this.transport?.invalidateCache
      ? this.transport.invalidateCache(invalidation, signal)
      : 0;
  }
}

export function createDefaultClosedAIBackends(): ClosedAIBackendAdapter[] {
  return [
    new BrowserAIBackendAdapter(),
    new LocalOllamaBackendAdapter(),
    new PrivateAIHubBackendAdapter(new LoopbackPrivateHubTransport()),
  ];
}

function unavailable(id: ClosedAIBackendId, status: string) {
  return Object.assign(new Error(`${BACKEND_TRUTH[id].label} is not ready.`), {
    code: "CLOSED_AI_SELECTED_BACKEND_NOT_READY",
    backendId: id,
    status,
    fallbackAttempted: false,
  });
}

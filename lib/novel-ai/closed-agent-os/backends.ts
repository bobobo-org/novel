import {
  browserProviderSnapshot,
  detectBrowserAI,
  getBrowserAIInferenceProof,
} from "../providers/browser-ai/browser-ai-provider";
import {
  finalizeBrowserAssistedBackendResult,
  prepareBrowserAssistedBackendInput,
} from "../providers/browser-ai/browser-assisted-postprocessor";
import {
  BROWSER_T1_TASKS,
  BROWSER_T1_T2_HYBRID_TASKS,
  BROWSER_T2_TASKS,
} from "../providers/browser-ai/browser-task-eligibility";
import { browserWebLLMModel } from "../providers/browser-ai/webllm-model-registry";
import {
  probeLocalOllama,
  runLocalOllama,
} from "../providers/local-ollama/local-ollama-provider";
import { getConfiguredLocalBridgeClient } from "../providers/local-ollama/local-bridge-client";
import { privateHubSnapshot } from "../providers/private-ai-hub/private-ai-hub";
import { LoopbackPrivateHubTransport } from "../providers/private-ai-hub/private-hub-client";
import { serializeClosedActorContext } from "../providers/closed/continuity-anchors";
import type {
  ClosedAICacheInvalidation,
  ClosedAINamespace,
} from "../closed-ai-cache";
import type {
  PlatformAIRequest,
  PlatformAIResult,
  PlatformProviderSnapshot,
  PlatformRouterDecision,
} from "../router/platform-types";
import { BROWSER_AI_LIGHT_TASKS, BACKEND_TRUTH } from "./backend-manifest";
import { isCryptographicClosedAIModelDigest } from "./types";
import { closedAIRegenerationPromptContext } from "./regeneration-prompt";
import type {
  ClosedAIBackendAdapter,
  ClosedAIBackendId,
  ClosedAIBackendRuntimeTruth,
  ClosedAIBackendSnapshot,
  ClosedBackendExecutionInput,
  ClosedBackendRawExecutionResult,
} from "./types";

function mapStatus(
  id: ClosedAIBackendId,
  snapshot: PlatformProviderSnapshot,
  runtimeTruth: ClosedAIBackendRuntimeTruth,
): ClosedAIBackendSnapshot["status"] {
  if (runtimeTruth.generationVerified) return "ready";
  if (snapshot.detail?.includes("preparing")) return "preparing";
  if (snapshot.status === "disabled") return "unsupported";
  if (snapshot.status === "contract_ready") return "unreachable";
  if (snapshot.status === "runtime_unavailable") return "unreachable";
  if (snapshot.status === "runtime_not_installed" || snapshot.status === "auth_required") {
    return "setup_required";
  }
  if (snapshot.status === "degraded") return "degraded";
  if (runtimeTruth.runtimeVerified || runtimeTruth.modelAvailable) return "available";
  return id === "browser-ai" ? "unsupported" : "setup_required";
}

function runtimeTruthFromPlatform(
  id: ClosedAIBackendId,
  snapshot: PlatformProviderSnapshot,
  proof: { verifiedAt?: string | null } | null = null,
): ClosedAIBackendRuntimeTruth {
  const reachable = ![
    "runtime_unavailable",
    "disabled",
    "contract_ready",
  ].includes(snapshot.status);
  const configured = Boolean(snapshot.modelId);
  const modelAvailable = Boolean(
    snapshot.modelId
    && isCryptographicClosedAIModelDigest(snapshot.modelDigest),
  );
  const runtimeVerified = reachable
    && configured
    && (snapshot.maxContext > 0 || Boolean(proof));
  const generationVerified = Boolean(
    proof
    && snapshot.status === "ready"
    && snapshot.modelId
    && isCryptographicClosedAIModelDigest(snapshot.modelDigest),
  );
  return {
    installed: reachable && snapshot.status !== "runtime_not_installed",
    configured,
    reachable,
    modelAvailable,
    runtimeVerified,
    generationVerified,
    verificationSource: generationVerified
      ? id === "local-ollama"
        ? "local-bridge-generation"
        : id === "private-ai-hub"
          ? "private-hub-generation"
          : "browser-runtime-generation"
      : "none",
    verifiedAt: generationVerified ? proof?.verifiedAt ?? null : null,
  };
}

function snapshotFromPlatform(
  id: ClosedAIBackendId,
  snapshot: PlatformProviderSnapshot,
  runtimeTruth = runtimeTruthFromPlatform(id, snapshot),
  statusOverride?: ClosedAIBackendSnapshot["status"],
): ClosedAIBackendSnapshot {
  const truth = BACKEND_TRUTH[id];
  const browserGenerativeReady = id === "browser-ai"
    && [
      "browser_hybrid_runtime_native_prompt_ready",
      "browser_hybrid_runtime_webllm_ready",
    ].includes(snapshot.detail ?? "");
  const browserModel = id === "browser-ai"
    ? browserWebLLMModel(snapshot.modelId)
    : null;
  return {
    id,
    label: truth.label,
    status: statusOverride ?? mapStatus(id, snapshot, runtimeTruth),
    runtimeTruth,
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
        ? [...new Set([
          ...BROWSER_T1_TASKS,
          ...BROWSER_T1_T2_HYBRID_TASKS,
          ...BROWSER_T2_TASKS,
        ])]
        : snapshot.taskTypes ?? BROWSER_AI_LIGHT_TASKS
      : "all",
    detailCode: snapshot.detail ?? snapshot.status,
    maxContext: snapshot.maxContext,
    controlLatencyMs: snapshot.latencyMs ?? null,
    qualityClass: id === "browser-ai"
      ? browserModel?.parameterLabel === "3B"
        ? "quality_local_browser"
        : browserModel?.parameterLabel === "1.5B"
          ? "balanced"
          : "fast"
      : id === "private-ai-hub"
        ? "heavy"
        : "standard",
  };
}

function reportGenerationProgress(
  input: ClosedBackendExecutionInput,
  label: string,
  generatedCharacters: number,
  percent: number,
  stream?: { generatedTokenEvents?: number },
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
      generatedTokenEvents: stream?.generatedTokenEvents,
    });
  } catch {
    // UI callbacks are observational and must never alter the model transaction.
  }
}

export function closedBackendPlatformRequest(
  input: ClosedBackendExecutionInput,
): PlatformAIRequest {
  const { request } = input;
  const generationOptions = {
    ...(request.generationOptions ?? {}),
    ...(request.regeneration
      ? { seed: request.regeneration.modelSeed }
      : {}),
  };
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
  const regenerationContext = closedAIRegenerationPromptContext(
    request.regeneration,
  );
  const promptInput = [...regenerationContext, request.objective].join("\n\n");
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
    input: promptInput,
    context: [
      ...serializeClosedActorContext(input.actorContext, request.taskType),
      ...controlledLearningContext,
    ],
    qualityPreference: input.plan.qualityMode === "deep"
      ? "high"
      : input.plan.qualityMode,
    browserComputePolicy: request.browserComputePolicy ?? "browser-first",
    allowPreAuthorizedClosedEscalation:
      request.allowPreAuthorizedClosedEscalation ?? false,
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
    generationOptions: Object.keys(generationOptions).length
      ? generationOptions
      : undefined,
    externalConsent: false,
    requiredCapabilities: ["text"],
    closedOnly: true,
    offlineRequired: input.plan.backendId !== "private-ai-hub",
    estimatedContextSize: Math.ceil(
      (
        promptInput.length
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

const LOCAL_BOUNDED_QUALITY_REPAIR_TASKS = new Set<PlatformAIRequest["taskType"]>([
  "chapter.continue",
  "chapter.expand",
  "chapter.rewrite",
  "character.dialogue",
  "drama.dialogue",
]);

const LOCAL_BOUNDED_QUALITY_REPAIR_REASONS = new Set([
  "QUALITY_TASK_FORM_MISMATCH",
  "QUALITY_CONTEXT_ANCHOR_MISSING",
  "QUALITY_CONTEXT_CHARACTER_MISSING",
  "QUALITY_OUTPUT_TRUNCATED",
  "QUALITY_NARRATIVE_TOO_SHORT",
  "QUALITY_CONTEXT_COPY_EXCESSIVE",
  "QUALITY_NARRATIVE_PROGRESS_MISSING",
  "QUALITY_WORLD_REGISTER_DRIFT",
]);

const LOCAL_BOUNDED_QUALITY_DIAGNOSTIC_REASONS = new Set([
  "QUALITY_TRADITIONALCHINESE_LOW",
  "QUALITY_CHARACTERVOICE_LOW",
  "QUALITY_CONTINUITY_LOW",
  "QUALITY_SPECIFICITY_LOW",
  "QUALITY_REPETITION_LOW",
  "QUALITY_TASKUSEFULNESS_LOW",
  "QUALITY_LENGTHCOMPLIANCE_LOW",
]);

function localQualityReasonCodes(error: unknown) {
  if (!error || typeof error !== "object") return [];
  const values = (error as { qualityReasonCodes?: unknown }).qualityReasonCodes;
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string =>
    typeof value === "string"
    && (
      /^QUALITY_[A-Z0-9_]+$/u.test(value)
      || value === "CHARACTER_KNOWLEDGE_BOUNDARY_LEAK"
    )))];
}

export function shouldRunBoundedLocalQualityRepair(input: {
  request: PlatformAIRequest;
  error: unknown;
}) {
  const errorCode = String((input.error as { code?: unknown })?.code ?? "");
  const reasons = localQualityReasonCodes(input.error);
  const repairableReasons = reasons.filter((reason) =>
    LOCAL_BOUNDED_QUALITY_REPAIR_REASONS.has(reason));
  return errorCode === "BROWSER_ASSISTED_QUALITY_BLOCKED"
    && input.request.qualityPhase === "revision"
    && LOCAL_BOUNDED_QUALITY_REPAIR_TASKS.has(input.request.taskType)
    && repairableReasons.length > 0
    && reasons.every((reason) =>
      LOCAL_BOUNDED_QUALITY_REPAIR_REASONS.has(reason)
      || LOCAL_BOUNDED_QUALITY_DIAGNOSTIC_REASONS.has(reason));
}

export function boundedLocalQualityRepairRequest(
  request: PlatformAIRequest,
  reasonCodes: string[],
): PlatformAIRequest {
  const initialSeed = request.generationOptions?.seed ?? 0;
  const repairSeed = ((Math.abs(Math.trunc(initialSeed)) + 97) % 2_147_483_646) + 1;
  const substantiveScene = request.taskType === "chapter.continue"
    && request.generationOptions?.substantiveScene === true;
  const replacementRequirement = substantiveScene
    ? "硬性要求：重新寫出完整替代場景；正文需有 900 至 1,600 個中文字，標題後寫恰好 10 個完整段落，不加分節標題，每段約 130 至 155 個中文字，總長以 1,050 至 1,450 字為安全目標；承接既有人物、場景與未解事件，至少推進一個事件並造成一項可觀察後果；只輸出小說正文，最後一句必須完整。"
    : "硬性要求：承接既有人物、場景與最後一個未解事件；只寫新的情節，不得重抄或摘要既有章節；至少推進一個事件並造成一項可觀察後果；輸出二百二十至三百二十個繁體中文字；最後一句必須完整，並以句號、驚嘆號、問號或閉合引號收尾。";
  return {
    ...request,
    requestId: `${request.requestId}:bounded-local-quality-repair`,
    input: [
      request.input,
      "前一版終稿未通過本機品質檢查，請重新輸出一份完整替代正文。",
      `需修正的安全品質代碼：${reasonCodes.join("、")}。`,
      replacementRequirement,
    ].join("\n"),
    qualityPreference: "high",
    qualityPhase: "revision",
    generationOptions: {
      ...request.generationOptions,
      seed: repairSeed,
      temperature: Math.min(
        Math.max(request.generationOptions?.temperature ?? 0.68, 0.66),
        0.76,
      ),
      topP: Math.min(
        Math.max(request.generationOptions?.topP ?? 0.88, 0.86),
        0.92,
      ),
      maxTokens: substantiveScene ? 1_792 : 360,
      repetitionPenalty: Math.max(
        request.generationOptions?.repetitionPenalty ?? 1.08,
        1.12,
      ),
    },
    idempotencyKey: `${request.idempotencyKey ?? request.requestId}:bounded-local-quality-repair`,
  };
}

function localExecutionResult(
  result: PlatformAIResult,
  input: ClosedBackendExecutionInput,
  qualityPasses = 1,
): ClosedBackendRawExecutionResult {
  if (
    !result.modelId
    || !isCryptographicClosedAIModelDigest(result.modelDigest)
  ) {
    throw Object.assign(new Error("Local Ollama returned no verified model identity."), {
      code: "CLOSED_AI_MODEL_IDENTITY_MISMATCH",
    });
  }
  return {
    backendId: "local-ollama",
    modelId: result.modelId,
    modelDigest: result.modelDigest,
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
    qualityPasses,
    draftDigest: null,
    criticDigest: null,
    actualExecutor: "local-ollama",
  };
}

export class BrowserAIBackendAdapter implements ClosedAIBackendAdapter {
  readonly id = "browser-ai" as const;

  async snapshot() {
    const capability = await detectBrowserAI();
    const platform = await browserProviderSnapshot(capability);
    const proof = getBrowserAIInferenceProof();
    const generationVerified = Boolean(
      proof?.inferenceMode === "generative-model"
      && capability.generativeModelReady
      && proof.modelId === capability.modelId
      && proof.modelDigest === capability.modelDigest
      && isCryptographicClosedAIModelDigest(proof?.modelDigest)
      && isCryptographicClosedAIModelDigest(capability.modelDigest),
    );
    const nativePromptSupported = capability.promptAvailability !== "unavailable";
    const runtimeTruth: ClosedAIBackendRuntimeTruth = {
      installed: capability.generativeModelReady,
      configured: capability.generativeModelReady && Boolean(capability.modelId),
      reachable: capability.webLlmSupported || nativePromptSupported,
      modelAvailable: capability.generativeModelReady,
      runtimeVerified: capability.generativeModelReady,
      generationVerified,
      verificationSource: generationVerified
        ? "browser-runtime-generation"
        : "none",
      verifiedAt: generationVerified ? proof?.verifiedAt ?? null : null,
    };
    const status: ClosedAIBackendSnapshot["status"] = generationVerified
      ? "ready"
      : capability.webLlmStatus === "installing"
        ? "preparing"
        : capability.generativeModelReady
          ? "available"
          : capability.webLlmSupported || nativePromptSupported
            ? "setup_required"
            : "unsupported";
    return snapshotFromPlatform(this.id, platform, runtimeTruth, status);
  }

  async execute(input: ClosedBackendExecutionInput): Promise<ClosedBackendRawExecutionResult> {
    const snapshot = await this.snapshot();
    if (snapshot.status !== "ready" || !snapshot.modelId) {
      throw unavailable(this.id, snapshot.status);
    }
    const { executeBrowserSovereignFabric } = await import(
      "../browser-fabric/orchestrator"
    );
    const request = closedBackendPlatformRequest(input);
    const compute = await executeBrowserSovereignFabric({
      request,
      decision: lockedDecision(request, snapshot),
      deferTraditionalChineseNormalization: true,
      onProgress: (progress) => reportGenerationProgress(
        input,
        `瀏覽器 AI 已生成 ${progress.generatedCharacters} 字`,
        progress.generatedCharacters,
        Math.min(80, 50 + Math.round(Math.sqrt(progress.generatedCharacters) * 1.8)),
        {
          generatedTokenEvents: progress.generatedTokenEvents,
        },
      ),
    });
    const result = compute.result;
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
      actualExecutor: this.id,
      browserComputeReceiptId: result.browserCompute?.receiptId,
      browserFabricReceiptId: compute.fabric.receipt.receiptId,
      browserFabricPlannedGraph: compute.fabric.plannedGraph,
      browserContextTokensBefore: result.browserCompute?.contextTokensBefore,
      browserContextTokensAfter: result.browserCompute?.contextTokensAfter,
      browserTokensSaved: result.browserCompute?.tokensSaved,
    };
  }
}

export class LocalOllamaBackendAdapter implements ClosedAIBackendAdapter {
  readonly id = "local-ollama" as const;
  private verifiedSnapshot: ClosedAIBackendSnapshot | null = null;

  async snapshot(signal?: AbortSignal) {
    const platform = await probeLocalOllama(undefined, signal);
    const proof = platform.modelId
      ? getConfiguredLocalBridgeClient()?.getModelVerification(platform.modelId) ?? null
      : null;
    const snapshot = snapshotFromPlatform(
      this.id,
      platform,
      runtimeTruthFromPlatform(this.id, platform, proof),
    );
    this.verifiedSnapshot = snapshot.status === "ready" ? snapshot : null;
    return snapshot;
  }

  async execute(input: ClosedBackendExecutionInput): Promise<ClosedBackendRawExecutionResult> {
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
    const browserAssisted = await prepareBrowserAssistedBackendInput(input);
    const request = closedBackendPlatformRequest(browserAssisted.input);
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
      {
        deferTraditionalChineseNormalization: true,
      },
    );
    let execution = localExecutionResult(result, input);
    let assisted: Awaited<ReturnType<typeof finalizeBrowserAssistedBackendResult>>;
    try {
      assisted = await finalizeBrowserAssistedBackendResult({
        preparation: browserAssisted,
        result: execution,
        executor: this.id,
      });
    } catch (error) {
      if (!shouldRunBoundedLocalQualityRepair({ request, error })) throw error;
      const reasonCodes = localQualityReasonCodes(error);
      const repairRequest = boundedLocalQualityRepairRequest(request, reasonCodes);
      const repairResult = await runLocalOllama(
        repairRequest,
        lockedDecision(repairRequest, snapshot),
        undefined,
        (progress) => reportGenerationProgress(
          input,
          `Local Ollama 有界補修中 · ${progress.generatedCharacters} 字`,
          progress.generatedCharacters,
          Math.min(94, 78 + Math.round(Math.sqrt(progress.generatedCharacters) * 0.9)),
        ),
        {
          boundedQualityRepair: true,
          deferTraditionalChineseNormalization: true,
        },
      );
      if (
        repairResult.modelId !== result.modelId
        || repairResult.modelDigest !== result.modelDigest
        || repairResult.providerId !== "local-ollama"
      ) {
        throw Object.assign(new Error("Bounded Local repair changed executor identity."), {
          code: "CLOSED_AI_BACKEND_IDENTITY_MISMATCH",
        });
      }
      const repairedExecution = localExecutionResult(
        repairResult,
        input,
        2,
      );
      execution = {
        ...repairedExecution,
        elapsedMs: result.elapsedMs + repairResult.elapsedMs,
        firstTokenMs: result.elapsedMs + (repairResult.firstTokenMs ?? 0),
        inputCharacters:
          (result.inputCharacters ?? 0) + (repairResult.inputCharacters ?? 0),
        outputCharacters: repairResult.content.length,
        generatedTokenEvents:
          (result.generatedTokenEvents ?? 0)
          + (repairResult.generatedTokenEvents ?? 0),
        omittedInputCharacters:
          (result.omittedInputCharacters ?? 0)
          + (repairResult.omittedInputCharacters ?? 0),
        profileId: `${repairResult.profileId ?? "local-ollama"}:bounded-same-model-quality-repair`,
      };
      assisted = await finalizeBrowserAssistedBackendResult({
        preparation: browserAssisted,
        result: execution,
        executor: this.id,
      });
    }
    return {
      ...execution,
      browserComputeReceiptId: assisted.receipt.receiptId,
      browserContextTokensBefore: assisted.contextMetrics.originalContextTokens,
      browserContextTokensAfter:
        assisted.contextMetrics.browserCompressedContextTokens,
      browserTokensSaved: assisted.contextMetrics.tokensSaved,
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
  execute(input: ClosedBackendExecutionInput): Promise<ClosedBackendRawExecutionResult>;
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
      throw unavailable(this.id, "unreachable");
    }
    const browserAssisted = await prepareBrowserAssistedBackendInput(input);
    const result = await this.transport.execute(browserAssisted.input);
    if (result.backendId !== this.id) {
      throw Object.assign(new Error("Private Hub returned the wrong backend identity."), {
        code: "CLOSED_AI_BACKEND_IDENTITY_MISMATCH",
      });
    }
    const assisted = await finalizeBrowserAssistedBackendResult({
      preparation: browserAssisted,
      result,
      executor: this.id,
    });
    return {
      ...result,
      actualExecutor: this.id,
      browserComputeReceiptId: assisted.receipt.receiptId,
      browserContextTokensBefore: assisted.contextMetrics.originalContextTokens,
      browserContextTokensAfter:
        assisted.contextMetrics.browserCompressedContextTokens,
      browserTokensSaved: assisted.contextMetrics.tokensSaved,
    };
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

import type {
  PlatformAIRequest,
  PlatformAIResult,
  PlatformRouterDecision,
} from "../../router/platform-types";
import { sha256Hex } from "../../closed-ai-cache";
import {
  BROWSER_LANGUAGE_MODEL_ID,
  detectBrowserAI,
  getBrowserAIInferenceProof,
  runBrowserAI,
  type BrowserAIStreamProgress,
} from "./browser-ai-provider";
import {
  composeBrowserContextPack,
  type BrowserContextSource,
} from "./browser-context-compressor";
import { readBrowserDeviceBenchmark } from "./browser-device-benchmark";
import {
  createBrowserExecutionReceipt,
  recordBrowserExecutionReceipt,
  type BrowserExecutionReceipt,
} from "./browser-offload-metrics";
import {
  resolveBrowserAIPerformancePolicy,
  estimateBrowserTokens,
} from "./browser-performance-policy";
import { evaluateBrowserCandidateQuality } from "./browser-quality-gate";
import {
  browserEligibilityContextTokens,
  resolveBrowserTaskEligibility,
  type BrowserTaskEligibility,
} from "./browser-task-eligibility";
import {
  browserSemanticRuntimeSnapshot,
  rankWithBrowserSemanticModel,
} from "./browser-semantic-runtime";
import { browserWebLLMRuntimeSnapshot } from "./browser-webllm-runtime";
import {
  BROWSER_WEBLLM_MODELS,
  browserWebLLMModel,
} from "./webllm-model-registry";

export const BROWSER_COMPUTE_ORCHESTRATOR_VERSION =
  "browser-compute-orchestrator-v2" as const;

export { executeBrowserDeterministicOperation } from "./browser-deterministic-runtime";

export type BrowserComputeExecution = {
  schemaVersion: typeof BROWSER_COMPUTE_ORCHESTRATOR_VERSION;
  result: PlatformAIResult;
  eligibility: BrowserTaskEligibility;
  quality: ReturnType<typeof evaluateBrowserCandidateQuality>;
  receipt: BrowserExecutionReceipt;
  contextMetrics: {
    originalContextTokens: number;
    browserCompressedContextTokens: number;
    tokensSaved: number;
    compressionRatio: number;
    retrievalPrecision: number;
  };
};

type VerifiedBrowserExecutor = "webllm-worker" | "chromium-prompt-api";

function assertVerifiedExecutor(
  result: PlatformAIResult,
  requiredExecutor: VerifiedBrowserExecutor,
) {
  if (result.executor === requiredExecutor) return;
  throw Object.assign(
    new Error("T2 executor mismatch; no alternate Browser executor was accepted."),
    {
      code: "BROWSER_AI_T2_EXECUTOR_MISMATCH",
      plannedExecutor: requiredExecutor,
      actualExecutor: result.executor ?? "browser-task-model",
      fallbackAttempted: false,
      canonicalMutationCount: 0,
    },
  );
}

function passSeed(seed: number | undefined, offset: number) {
  return seed === undefined ? undefined : (seed + offset) >>> 0;
}

function compactPipelineMaterial(value: string, limit: number) {
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  if (normalized.length <= limit) return normalized;
  const head = Math.max(1, Math.floor(limit * 0.72));
  const tail = Math.max(1, limit - head - 21);
  return `${normalized.slice(0, head)}\n[中段已壓縮]\n${normalized.slice(-tail)}`;
}

const BOUNDED_SAME_MODEL_REPAIR_TASKS = new Set<PlatformAIRequest["taskType"]>([
  "chapter.continue",
  "chapter.expand",
]);

const BOUNDED_SAME_MODEL_REPAIR_REASONS = new Set([
  "QUALITY_NARRATIVE_TOO_SHORT",
  "QUALITY_CONTEXT_COPY_EXCESSIVE",
  "QUALITY_NARRATIVE_PROGRESS_MISSING",
]);

function minimumCandidateTokens(
  taskType: PlatformAIRequest["taskType"],
  tier: BrowserTaskEligibility["tier"],
) {
  if (BOUNDED_SAME_MODEL_REPAIR_TASKS.has(taskType)) return 140;
  return tier === "T1" ? 6 : 24;
}

// Retained as a legacy receipt decoder reference. RC5 executes one model pass
// per Closed Agent OS node and never invokes this nested quality pipeline.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function runBrowserThreeBQualityPipeline(input: {
  request: PlatformAIRequest;
  decision: PlatformRouterDecision;
  requiredExecutor: VerifiedBrowserExecutor;
  onProgress?: (progress: BrowserAIStreamProgress) => void;
  started: number;
}): Promise<PlatformAIResult> {
  const commonOptions = {
    requiredGenerativeExecutor: input.requiredExecutor,
  } as const;
  const planner = await runBrowserAI(
    {
      ...input.request,
      requestId: `${input.request.requestId}:planner`,
      taskType: "assistant.general",
      input: [
        "請為下列小說任務建立精簡、可執行的創作計畫。",
        "只輸出角色分工與步驟，不輸出內部推理，也不要撰寫正文。",
        input.request.input,
      ].join("\n"),
      qualityPhase: "draft",
      workingMaterials: [],
      generationOptions: {
        ...input.request.generationOptions,
        seed: passSeed(input.request.generationOptions?.seed, 0),
        temperature: 0.2,
        topP: 0.82,
        maxTokens: Math.min(input.request.generationOptions?.maxTokens ?? 160, 160),
      },
    },
    input.decision,
    undefined,
    commonOptions,
  );
  assertVerifiedExecutor(planner, input.requiredExecutor);
  const plannerText = compactPipelineMaterial(planner.content, 1_200);
  const planDigest = await sha256Hex(plannerText);
  const agentPlan = {
    planDigest,
    roles: ["planner", "drafter", "critic", "reviser", "evaluator"],
    steps: [{
      role: "planner",
      objective: plannerText,
    }],
  };

  const draft = await runBrowserAI(
    {
      ...input.request,
      requestId: `${input.request.requestId}:draft`,
      qualityPhase: "draft",
      agentPlan,
      workingMaterials: [],
      generationOptions: {
        ...input.request.generationOptions,
        seed: passSeed(input.request.generationOptions?.seed, 1),
      },
    },
    input.decision,
    undefined,
    commonOptions,
  );
  assertVerifiedExecutor(draft, input.requiredExecutor);
  const draftText = compactPipelineMaterial(draft.content, 5_200);
  const draftDigest = await sha256Hex(draftText);

  const critic = await runBrowserAI(
    {
      ...input.request,
      requestId: `${input.request.requestId}:critic`,
      taskType: "assistant.critique",
      input: [
        "依原任務、已核准脈絡與草稿，列出可直接執行的修訂意見。",
        "檢查角色一致性、時間線、世界規則、重複內容與任務完成度。",
        "不要重述草稿，不輸出內部推理。",
        `原任務：${input.request.input}`,
      ].join("\n"),
      qualityPhase: "critic",
      agentPlan,
      workingMaterials: [{
        kind: "draft",
        text: draftText,
        digest: draftDigest,
      }],
      generationOptions: {
        ...input.request.generationOptions,
        seed: passSeed(input.request.generationOptions?.seed, 2),
        temperature: 0.25,
        topP: 0.86,
        maxTokens: Math.min(input.request.generationOptions?.maxTokens ?? 240, 240),
      },
    },
    input.decision,
    undefined,
    commonOptions,
  );
  assertVerifiedExecutor(critic, input.requiredExecutor);
  const criticText = compactPipelineMaterial(critic.content, 1_800);
  const criticDigest = await sha256Hex(criticText);

  const revisionStarted = performance.now();
  const revision = await runBrowserAI(
    {
      ...input.request,
      requestId: `${input.request.requestId}:revision`,
      qualityPhase: "revision",
      agentPlan,
      workingMaterials: [
        { kind: "draft", text: draftText, digest: draftDigest },
        { kind: "critic", text: criticText, digest: criticDigest },
      ],
      generationOptions: {
        ...input.request.generationOptions,
        seed: passSeed(input.request.generationOptions?.seed, 3),
      },
    },
    input.decision,
    input.onProgress,
    commonOptions,
  );
  assertVerifiedExecutor(revision, input.requiredExecutor);

  const passes = [planner, draft, critic, revision];
  return {
    ...revision,
    requestId: input.request.requestId,
    elapsedMs: Math.round(performance.now() - input.started),
    firstTokenMs: Math.round(
      revisionStarted - input.started + (revision.firstTokenMs ?? 0),
    ),
    inputCharacters: passes.reduce(
      (sum, pass) => sum + (pass.inputCharacters ?? 0),
      0,
    ),
    outputCharacters: revision.content.length,
    generatedTokenEvents: passes.reduce(
      (sum, pass) => sum + (pass.generatedTokenEvents ?? 0),
      0,
    ),
    omittedInputCharacters: passes.reduce(
      (sum, pass) => sum + (pass.omittedInputCharacters ?? 0),
      0,
    ),
    queueWaitMs: passes.reduce((sum, pass) => sum + (pass.queueWaitMs ?? 0), 0),
    runtimeStats: [
      revision.runtimeStats,
      "pipeline=planner,draft,critic,revision,deterministic-evaluator",
      "intermediate-content=pipeline-memory-only",
      `plan-digest=${planDigest}`,
      `draft-digest=${draftDigest}`,
      `critic-digest=${criticDigest}`,
    ].filter(Boolean).join("; "),
    provenance: {
      ...revision.provenance,
      warnings: [
        ...revision.provenance.warnings,
        "3B Browser quality pipeline ran Planner, Draft, Critic and Revision on the verified executor; intermediate text was not persisted.",
      ],
    },
  };
}

function explicitEscalationError(
  eligibility: BrowserTaskEligibility,
  code = "BROWSER_EXPLICIT_ESCALATION_REQUIRED",
) {
  return Object.assign(
    new Error("此工作超過目前瀏覽器已驗證能力；系統沒有暗中切換其他模型。"),
    {
      code,
      taskTier: eligibility.tier,
      reasonCode: eligibility.reasonCode,
      recommendedProvider: eligibility.recommendedProvider,
      allowedActions: [
        "adjust-and-retry",
        "use-local-ollama",
        "use-private-hub",
        "abandon",
      ],
      fallbackAttempted: false,
      canonicalMutationCount: 0,
    },
  );
}

async function contextSources(
  request: PlatformAIRequest,
  semanticReady: boolean,
): Promise<BrowserContextSource[]> {
  if (!request.cacheNamespace) {
    throw Object.assign(new Error("Browser Compute Plane requires a complete cache namespace."), {
      code: "BROWSER_COMPUTE_NAMESPACE_REQUIRED",
    });
  }
  const base: BrowserContextSource[] = request.context.map((text, index) => ({
    id: `context-${index + 1}`,
    kind: index === 0 ? "canon-authority" : "story-bible",
    text,
    namespace: structuredClone(request.cacheNamespace!),
    visibility: "both",
    approved: true,
    revision: request.cacheNamespace!.storyBibleRevision,
    authority: index === 0 ? 1 : 0.65,
    relevance: 0.65,
  }));
  if (!semanticReady || !request.context.length) return base;
  try {
    const ranked = await rankWithBrowserSemanticModel({
      namespace: request.cacheNamespace,
      query: request.input,
      items: base
        .filter((source) => source.kind !== "user-instruction")
        .map((source) => ({ id: source.id, text: source.text })),
      signal: request.signal,
    });
    const scoreMap = new Map(ranked.scores.map((score) => [score.id, score.score]));
    return base.map((source) => ({
      ...source,
      relevance: Math.max(
        0,
        Math.min(1, (scoreMap.get(source.id) ?? 0) * 0.5 + 0.5),
      ),
    }));
  } catch {
    // Semantic failure is explicit in the receipt pipeline, but deterministic
    // context composition remains available and never changes provider.
    return base;
  }
}

export async function executeBrowserCompute(input: {
  request: PlatformAIRequest;
  decision: PlatformRouterDecision;
  onProgress?: (progress: BrowserAIStreamProgress) => void;
}): Promise<BrowserComputeExecution> {
  const started = performance.now();
  const policy = input.request.browserComputePolicy ?? "browser-first";
  const [capability, webLlm, semantic] = await Promise.all([
    detectBrowserAI(),
    browserWebLLMRuntimeSnapshot().catch(() => null),
    browserSemanticRuntimeSnapshot().catch(() => null),
  ]);
  const selected = webLlm?.models.find((model) => model.modelId === webLlm.selectedModelId) ?? null;
  const selectedManifest = browserWebLLMModel(selected?.modelId)
    ?? BROWSER_WEBLLM_MODELS[0];
  const benchmark = selected?.shardIntegrityVerified
    ? await readBrowserDeviceBenchmark(
      selected.modelId,
      selected.modelDigest,
    ).catch(() => null)
    : null;
  const proof = getBrowserAIInferenceProof();
  const inferenceProofVerified = capability.generativeRuntime === "webllm-worker"
    ? Boolean(selected?.shardIntegrityVerified && benchmark?.benchmarkPassed)
    : Boolean(
      capability.generativeRuntime === "chromium-prompt-api"
      && (
      proof?.state === "inference_verified"
      && proof.inferenceMode === "generative-model"
      && proof.modelId === BROWSER_LANGUAGE_MODEL_ID
      )
    );
  const rawContextTokens = estimateBrowserTokens(
    [...input.request.context, input.request.input].join("\n\n"),
  );
  const performancePolicy = resolveBrowserAIPerformancePolicy({
    device: webLlm?.device ?? {
      supported: true,
      tier: "standard",
      reason: "native_browser_runtime",
      mobile: false,
      webGpu: capability.webGpu,
      wasm: capability.wasm,
      worker: capability.worker,
      indexedDb: typeof indexedDB !== "undefined",
      opfs: false,
      deviceMemoryGB: null,
      hardwareConcurrency: null,
      maxStorageBufferBindingSize: null,
      storageQuota: capability.storageQuota,
      storageUsage: capability.storageUsage,
      storageAvailable: null,
      allowedModelIds: [],
      recommendedModelId: null,
    },
    model: selectedManifest,
    mode: input.request.latencyPreference === "low"
      || input.request.qualityPreference === "fast"
      ? "ECO"
      : input.request.qualityPreference === "high"
        ? "QUALITY"
        : "BALANCED",
    estimatedInputTokens: rawContextTokens,
    requestedMaxTokens: input.request.generationOptions?.maxTokens,
    requestedTemperature: input.request.generationOptions?.temperature,
    requestedTopP: input.request.generationOptions?.topP,
    requestedRepetitionPenalty: input.request.generationOptions?.repetitionPenalty,
    previousTokensPerSecond: selected?.averageTokensPerSecond,
  });
  const sources = await contextSources(
    input.request,
    semantic?.model.cacheVerified ?? false,
  );
  const contextPack = await composeBrowserContextPack({
    namespace: input.request.cacheNamespace!,
    audience: "actor",
    sources,
    performancePolicy,
  });
  const preparedContextTokens = browserEligibilityContextTokens({
    rawContextTokens,
    compressedContextTokens: contextPack.metrics.browserCompressedContextTokens,
    objectiveTokens: estimateBrowserTokens(input.request.input),
  });
  const eligibility = resolveBrowserTaskEligibility({
    taskType: input.request.taskType,
    policy,
    manualProvider: input.request.preferredProvider,
    generativeModelReady: capability.generativeModelReady,
    generativeRuntime: capability.generativeRuntime,
    inferenceProofVerified,
    semanticModelReady: semantic?.model.cacheVerified ?? false,
    modelParameterLabel: selectedManifest.parameterLabel,
    benchmark: capability.generativeRuntime === "chromium-prompt-api"
      && inferenceProofVerified
      ? { benchmarkPassed: true }
      : benchmark,
    contextTokens: preparedContextTokens,
    outputTokens: performancePolicy.reservedOutputTokens,
    qualityPreference: input.request.qualityPreference,
    allowPreAuthorizedClosedEscalation:
      input.request.allowPreAuthorizedClosedEscalation ?? false,
  });
  if (!eligibility.eligible) throw explicitEscalationError(eligibility);
  const executionRequest: PlatformAIRequest = {
    ...input.request,
    input: input.request.input,
    context: contextPack.items.map((item) => `[${item.kind}]\n${item.text}`),
  };
  const requiredGenerativeExecutor = eligibility.tier === "T2"
    && (
      eligibility.browserExecutor === "webllm-worker"
      || eligibility.browserExecutor === "chromium-prompt-api"
    )
    ? eligibility.browserExecutor
    : undefined;
  if (eligibility.tier === "T2" && !requiredGenerativeExecutor) {
    throw explicitEscalationError(
      eligibility,
      "BROWSER_AI_T2_EXECUTOR_NOT_VERIFIED",
    );
  }
  // Closed Agent OS owns planning, critique and revision. A browser task node
  // normally performs one model pass. Direct continuation tasks may run one
  // bounded repair on the same verified executor when the first output ends
  // early or merely copies context; this never switches providers or mutates Canon.
  let result = await runBrowserAI(
    executionRequest,
    input.decision,
    input.onProgress,
    {
      preferLightweightRuntime: eligibility.tier === "T1",
      requiredGenerativeExecutor,
    },
  );
  const expectedMinTokens = minimumCandidateTokens(
    input.request.taskType,
    eligibility.tier,
  );
  let quality = evaluateBrowserCandidateQuality({
    taskType: input.request.taskType,
    content: result.content,
    expectedMinTokens,
    expectedMaxTokens: performancePolicy.reservedOutputTokens,
    requiresStructuredOutput: input.request.requiresStructured,
    approvedContext: executionRequest.context,
    threshold: eligibility.tier === "T1" ? 0.58 : 0.7,
  });
  const repairReasonCodes = quality.reasonCodes.filter((reason) =>
    BOUNDED_SAME_MODEL_REPAIR_REASONS.has(reason));
  if (
    requiredGenerativeExecutor
    && BOUNDED_SAME_MODEL_REPAIR_TASKS.has(input.request.taskType)
    && repairReasonCodes.length > 0
  ) {
    const initialResult = result;
    const initialDigest = await sha256Hex(initialResult.content);
    const repairResult = await runBrowserAI(
      {
        ...executionRequest,
        requestId: `${input.request.requestId}:bounded-same-model-repair`,
        input: [
          input.request.input,
          "前一版未通過續寫品質檢查，請重新輸出一份完整替代正文。",
          "硬性要求：只寫目前章節最後一句之後的新情節；不得摘錄、縮寫或重排原章節；使用既有人物與場景，至少推進一個新事件並造成一項新後果；輸出二百二十至三百六十個繁體中文字。",
        ].join("\n"),
        qualityPhase: "revision",
        workingMaterials: [{
          kind: "draft",
          text: compactPipelineMaterial(initialResult.content, 1_200),
          digest: initialDigest,
        }],
        generationOptions: {
          ...input.request.generationOptions,
          seed: passSeed(input.request.generationOptions?.seed, 97),
          temperature: Math.max(
            input.request.generationOptions?.temperature ?? 0.72,
            0.78,
          ),
          topP: Math.max(input.request.generationOptions?.topP ?? 0.9, 0.92),
          maxTokens: Math.max(
            input.request.generationOptions?.maxTokens ?? 0,
            420,
          ),
          repetitionPenalty: Math.max(
            input.request.generationOptions?.repetitionPenalty ?? 1.08,
            1.15,
          ),
        },
      },
      input.decision,
      input.onProgress,
      {
        preferLightweightRuntime: false,
        requiredGenerativeExecutor,
      },
    );
    assertVerifiedExecutor(repairResult, requiredGenerativeExecutor);
    result = {
      ...repairResult,
      requestId: input.request.requestId,
      elapsedMs: (initialResult.elapsedMs ?? 0) + (repairResult.elapsedMs ?? 0),
      firstTokenMs: (initialResult.elapsedMs ?? 0) + (repairResult.firstTokenMs ?? 0),
      inputCharacters:
        (initialResult.inputCharacters ?? 0) + (repairResult.inputCharacters ?? 0),
      outputCharacters: repairResult.content.length,
      generatedTokenEvents:
        (initialResult.generatedTokenEvents ?? 0)
        + (repairResult.generatedTokenEvents ?? 0),
      omittedInputCharacters:
        (initialResult.omittedInputCharacters ?? 0)
        + (repairResult.omittedInputCharacters ?? 0),
      queueWaitMs:
        (initialResult.queueWaitMs ?? 0) + (repairResult.queueWaitMs ?? 0),
      runtimeStats: [
        repairResult.runtimeStats,
        "bounded-same-model-repair=1",
        `initial-output-digest=${initialDigest}`,
        `initial-quality-reasons=${repairReasonCodes.join(",")}`,
        "intermediate-content=pipeline-memory-only",
      ].filter(Boolean).join("; "),
      provenance: {
        ...repairResult.provenance,
        warnings: [
          ...repairResult.provenance.warnings,
          "One bounded repair pass ran on the same verified Browser executor; the rejected draft was not persisted and no provider fallback occurred.",
        ],
      },
    };
    quality = evaluateBrowserCandidateQuality({
      taskType: input.request.taskType,
      content: result.content,
      expectedMinTokens,
      expectedMaxTokens: performancePolicy.reservedOutputTokens,
      requiresStructuredOutput: input.request.requiresStructured,
      approvedContext: executionRequest.context,
      threshold: eligibility.tier === "T1" ? 0.58 : 0.7,
    });
  }
  const actualExecutor = result.executor ?? "browser-task-model";
  if (requiredGenerativeExecutor) {
    assertVerifiedExecutor(result, requiredGenerativeExecutor);
  }
  const receipt = await createBrowserExecutionReceipt({
    taskIdentity: `${input.request.projectId}:${input.request.requestId}`,
    taskType: input.request.taskType,
    plannedPipeline: eligibility.plannedPipeline,
    actualExecutor: actualExecutor as BrowserExecutionReceipt["actualExecutor"],
    modelId: result.modelId,
    modelDigest: result.modelDigest ?? null,
    browserPrecomputeUsed: true,
    browserGenerationUsed: actualExecutor === "webllm-worker"
      || actualExecutor === "chromium-prompt-api",
    localOllamaUsed: false,
    privateHubUsed: false,
    externalAIUsed: false,
    dataLeftDevice: false,
    contextTokensBefore: contextPack.metrics.originalContextTokens,
    contextTokensAfter: contextPack.metrics.browserCompressedContextTokens,
    tokensSaved: contextPack.metrics.tokensSaved,
    remoteModelInputTokensSaved: 0,
    remoteModelOutputRepairAvoided: 0,
    remoteModelCallsAvoided: 0,
    privateHubJobsAvoided: 0,
    localOllamaCallsAvoided: eligibility.tier === "T2" ? 1 : 0,
    elapsedMs: Math.round(performance.now() - started),
  });
  await recordBrowserExecutionReceipt(receipt);
  if (quality.decision === "block" || quality.decision === "escalate") {
    throw Object.assign(explicitEscalationError(
      eligibility,
      "BROWSER_AI_QUALITY_INSUFFICIENT",
    ), {
      qualityScore: quality.score,
      qualityDecision: quality.decision,
      qualityReasonCodes: quality.reasonCodes,
      receiptId: receipt.receiptId,
    });
  }
  result.browserCompute = {
    policy,
    tier: eligibility.tier,
    plannedPipeline: eligibility.plannedPipeline,
    actualExecutor,
    qualityDecision: quality.decision,
    qualityScore: quality.score,
    contextTokensBefore: contextPack.metrics.originalContextTokens,
    contextTokensAfter: contextPack.metrics.browserCompressedContextTokens,
    tokensSaved: contextPack.metrics.tokensSaved,
    receiptId: receipt.receiptId,
    inferenceProof: eligibility.tier === "T2" ? "verified" : "not_required",
    canonicalMutationCount: 0,
  };
  return {
    schemaVersion: BROWSER_COMPUTE_ORCHESTRATOR_VERSION,
    result,
    eligibility,
    quality,
    receipt,
    contextMetrics: {
      originalContextTokens: contextPack.metrics.originalContextTokens,
      browserCompressedContextTokens: contextPack.metrics.browserCompressedContextTokens,
      tokensSaved: contextPack.metrics.tokensSaved,
      compressionRatio: contextPack.metrics.compressionRatio,
      retrievalPrecision: contextPack.metrics.retrievalPrecision,
    },
  };
}

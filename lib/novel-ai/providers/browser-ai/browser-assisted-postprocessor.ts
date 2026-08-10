import type {
  ClosedAIContextItem,
  ClosedBackendExecutionInput,
  ClosedBackendRawExecutionResult,
} from "../../closed-agent-os/types";
import type { PlatformProviderId } from "../../router/platform-types";
import {
  composeBrowserContextPack,
  type BrowserContextKind,
  type BrowserContextSource,
} from "./browser-context-compressor";
import {
  createBrowserExecutionReceipt,
  recordBrowserExecutionReceipt,
} from "./browser-offload-metrics";
import { resolveBrowserAIPerformancePolicy } from "./browser-performance-policy";
import { evaluateBrowserCandidateQuality } from "./browser-quality-gate";
import { BROWSER_WEBLLM_MODELS } from "./webllm-model-registry";

export const BROWSER_ASSISTED_POSTPROCESSOR_VERSION =
  "browser-assisted-postprocessor-v3" as const;

const CONTEXT_KIND: Record<ClosedAIContextItem["kind"], BrowserContextKind> = {
  canon: "canon-authority",
  "story-bible": "story-bible",
  retrieval: "story-bible",
  memory: "approved-learning-rule",
  "author-note": "user-instruction",
  "evaluator-note": "approved-learning-rule",
};

export type BrowserAssistedPreparation = {
  schemaVersion: typeof BROWSER_ASSISTED_POSTPROCESSOR_VERSION;
  input: ClosedBackendExecutionInput;
  contextMetrics: {
    originalContextTokens: number;
    browserCompressedContextTokens: number;
    tokensSaved: number;
    compressionRatio: number;
    retrievalPrecision: number;
  };
  plannedPipeline: string[];
};

export type BrowserAssistedQualityEnforcement = {
  qualityPhase: ClosedBackendExecutionInput["qualityPhase"];
  terminalCandidate: boolean;
  hardSafetyBlock: boolean;
  shouldBlock: boolean;
  deferredToClosedAgentRevision: boolean;
};

/**
 * Balanced/deep Local and Hub drafts are intermediate material owned by the
 * Closed Agent OS quality transaction. Repairable prose findings must reach
 * the revision node. Final/fast output remains fully blocking, while empty,
 * boundary-leaking, structurally invalid, or canon-conflicting output is
 * rejected at every phase.
 */
export function resolveBrowserAssistedQualityEnforcement(input: {
  preparation: BrowserAssistedPreparation;
  quality: ReturnType<typeof evaluateBrowserCandidateQuality>;
}): BrowserAssistedQualityEnforcement {
  const qualityPhase = input.preparation.input.qualityPhase;
  const terminalCandidate = qualityPhase === "revision"
    || (
      qualityPhase === "draft"
      && input.preparation.input.plan.qualityMode === "fast"
    );
  const hardSafetyBlock = input.quality.reasonCodes.includes(
    "QUALITY_EMPTY_CANDIDATE",
  )
    || input.quality.reasonCodes.includes(
      "CHARACTER_KNOWLEDGE_BOUNDARY_LEAK",
    )
    || input.quality.scores.structuredOutput === 0
    || input.quality.scores.canonCompliance < 0.5;
  const qualityBlocked = input.quality.decision === "block";
  const shouldBlock = qualityBlocked && (terminalCandidate || hardSafetyBlock);
  return {
    qualityPhase,
    terminalCandidate,
    hardSafetyBlock,
    shouldBlock,
    deferredToClosedAgentRevision: qualityBlocked && !shouldBlock,
  };
}

/**
 * A conservative budgeting profile used only to divide an already-approved
 * Local/Hub context. It is never persisted or presented as measured hardware.
 */
function browserAssistedContextBudgetProfile() {
  return {
    supported: true,
    tier: "standard" as const,
    reason: "reference_profile_not_device_evidence",
    mobile: false,
    webGpu: false,
    wasm: true,
    worker: true,
    indexedDb: typeof indexedDB !== "undefined",
    opfs: typeof navigator !== "undefined" && Boolean(navigator.storage?.getDirectory),
    deviceMemoryGB: null,
    hardwareConcurrency: typeof navigator === "undefined"
      ? null
      : navigator.hardwareConcurrency ?? null,
    maxStorageBufferBindingSize: null,
    storageQuota: null,
    storageUsage: null,
    storageAvailable: null,
    allowedModelIds: [],
    recommendedModelId: null,
  };
}

/** Compress approved, namespace-matching context without changing the backend. */
export async function prepareBrowserAssistedBackendInput(
  input: ClosedBackendExecutionInput,
): Promise<BrowserAssistedPreparation> {
  const policy = resolveBrowserAIPerformancePolicy({
    device: browserAssistedContextBudgetProfile(),
    model: BROWSER_WEBLLM_MODELS[1],
    mode: input.plan.qualityMode === "deep" ? "QUALITY" : "BALANCED",
    requestedMaxTokens: input.request.generationOptions?.maxTokens,
  });
  const sources: BrowserContextSource[] = input.actorContext.map((item) => ({
    id: item.id,
    kind: CONTEXT_KIND[item.kind],
    text: item.text,
    namespace: structuredClone(input.request.namespace),
    visibility: item.visibility,
    approved: item.approved,
    revision: input.request.namespace.storyBibleRevision,
    authority: item.kind === "canon" ? 1 : 0.72,
    relevance: item.kind === "retrieval" ? 0.82 : 0.7,
  }));
  const contextPack = await composeBrowserContextPack({
    namespace: input.request.namespace,
    audience: "actor",
    sources,
    performancePolicy: policy,
  });
  const packedById = new Map(contextPack.items.map((item) => [item.id, item.text]));
  const actorContext = input.actorContext
    .filter((item) => packedById.has(item.id))
    .map((item) => ({ ...item, text: packedById.get(item.id)! }));
  return {
    schemaVersion: BROWSER_ASSISTED_POSTPROCESSOR_VERSION,
    input: { ...input, actorContext },
    contextMetrics: {
      originalContextTokens: contextPack.metrics.originalContextTokens,
      browserCompressedContextTokens:
        contextPack.metrics.browserCompressedContextTokens,
      tokensSaved: contextPack.metrics.tokensSaved,
      compressionRatio: contextPack.metrics.compressionRatio,
      retrievalPrecision: contextPack.metrics.retrievalPrecision,
    },
    plannedPipeline: [
      "browser-context-isolation",
      "browser-context-compression",
      "browser-semantic-rerank-when-ready",
      input.plan.backendId,
      "browser-quality-gate",
      "browser-approval-preview",
    ],
  };
}

/** Record browser-side deterministic checks without storing prompt or output. */
export async function finalizeBrowserAssistedBackendResult(input: {
  preparation: BrowserAssistedPreparation;
  result: ClosedBackendRawExecutionResult;
  executor: Extract<PlatformProviderId, "local-ollama" | "private-ai-hub">;
}) {
  const quality = evaluateBrowserCandidateQuality({
    taskType: input.preparation.input.request.taskType,
    content: input.result.content,
    expectedMinTokens: input.preparation.input.qualityPhase === "critic" ? 6 : 24,
    expectedMaxTokens:
      input.preparation.input.request.generationOptions?.maxTokens ?? 4_096,
    threshold: 0.7,
  });
  const enforcement = resolveBrowserAssistedQualityEnforcement({
    preparation: input.preparation,
    quality,
  });
  const metrics = input.preparation.contextMetrics;
  const receipt = await createBrowserExecutionReceipt({
    taskIdentity:
      `${input.preparation.input.request.namespace.projectId}:`
      + `${input.preparation.input.request.taskId}:${input.executor}`,
    taskType: input.preparation.input.request.taskType,
    plannedPipeline: input.preparation.plannedPipeline,
    actualExecutor: input.executor,
    modelId: input.result.modelId,
    modelDigest: input.result.modelDigest,
    browserPrecomputeUsed: true,
    browserGenerationUsed: false,
    localOllamaUsed: input.executor === "local-ollama",
    privateHubUsed: input.executor === "private-ai-hub",
    externalAIUsed: false,
    dataLeftDevice: input.result.dataLeftDevice,
    contextTokensBefore: metrics.originalContextTokens,
    contextTokensAfter: metrics.browserCompressedContextTokens,
    tokensSaved: metrics.tokensSaved,
    remoteModelInputTokensSaved: metrics.tokensSaved,
    remoteModelOutputRepairAvoided: 0,
    remoteModelCallsAvoided: 0,
    privateHubJobsAvoided: 0,
    localOllamaCallsAvoided: 0,
    elapsedMs: input.result.elapsedMs,
  });
  await recordBrowserExecutionReceipt(receipt);
  if (enforcement.shouldBlock) {
    throw Object.assign(new Error("瀏覽器品質閘拒絕空白、越界或無效候選。"), {
      code: "BROWSER_ASSISTED_QUALITY_BLOCKED",
      qualityReasonCodes: quality.reasonCodes,
      qualityScore: quality.score,
      qualityPhase: enforcement.qualityPhase,
      qualityDeferredToRevision: false,
      receiptId: receipt.receiptId,
      fallbackAttempted: false,
      canonicalMutationCount: 0,
    });
  }
  return { quality, enforcement, receipt, contextMetrics: metrics };
}

import type { PlatformAIRequest, PlatformAIResult, PlatformProviderSnapshot, PlatformRouterDecision } from "../../router/platform-types";
import type {
  BrowserContextAttestationRequirement,
} from "../../security/browser-final-model-context-proof";
import {
  BROWSER_TASK_MODEL,
  isNativeBrowserSummaryTask,
  runPackagedBrowserTaskModel,
} from "./browser-task-model";
import { taskComplexity } from "../../closed-agent-os/backend-manifest";
import { isCryptographicClosedAIModelDigest } from "../../closed-agent-os/types";
import { safeClosedAgentBrowserRuntimeCauseCode } from "../../closed-agent-os/safe-runtime-diagnostics";
import {
  buildClosedAIModelPrompt,
  getClosedAIModelProfile,
} from "../closed/task-profile";
import {
  browserWebLLMRuntimeSnapshot,
  cancelBrowserWebLLMGeneration,
  generateWithBrowserWebLLM,
  type BrowserWebLLMOutputConstraint,
  type BrowserWebLLMSetupBoundary,
} from "./browser-webllm-runtime";
import type {
  BrowserWebLLMCacheBackend,
  BrowserWebLLMDeviceTier,
  BrowserWebLLMModelId,
} from "./webllm-model-registry";
import { browserWebLLMModel } from "./webllm-model-registry";
import {
  evaluateBrowserDeviceBenchmark,
  isCanonicalBrowserDeviceBenchmark,
  persistBrowserDeviceBenchmark,
  readBrowserDeviceBenchmark,
  type BrowserDeviceBenchmark,
} from "./browser-device-benchmark";
import {
  BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY,
  BROWSER_PROSE_CANDIDATE_V2_IDENTITY,
  BROWSER_PROSE_CANDIDATE_V2_PROMPT_PROFILE_VERSION,
  BROWSER_PROSE_CANDIDATE_V2_SYSTEM_INSTRUCTION,
  assertBrowserProseCandidateV2SafeOutput,
  type BrowserProseCandidateV2SegmentRequest,
  type BrowserProseCandidateV2SegmentResponse,
} from "./browser-prose-candidate-v2";
import {
  createBrowserProseCandidateV2SegmentCallReceipt,
  type BrowserProseCandidateV2SegmentCallReceipt,
} from "./browser-prose-candidate-v2-receipt";
import {
  assertBrowserProseTierProductionQualified,
  browserProseModelTierFromModelId,
} from "./browser-prose-capability-policy";

const BROWSER_GENERATION_VERIFICATION_SEED = 0x52433632;
const BROWSER_GENERATION_VERIFICATION_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    status: { type: "string", minLength: 1 },
  },
  required: ["status"],
  additionalProperties: false,
});

export type BrowserAIManifest = { id: string; version: string; files: Array<{ url: string; bytes: number; sha256: string }>; minMemoryGb: number; requiresWebGpu: boolean };
export type BrowserAICapability = {
  webGpu: boolean;
  wasm: boolean;
  worker: boolean;
  storageQuota: number | null;
  storageUsage: number | null;
  status: PlatformProviderSnapshot["status"];
  reason: string;
  summaryAvailability: string;
  promptAvailability: string;
  generativeModelReady: boolean;
  generativeRuntime: "webllm-worker" | "chromium-prompt-api" | null;
  webLlmSupported: boolean;
  webLlmInstalled: boolean;
  webLlmStatus:
    | "ready"
    | "install_required"
    | "installing"
    | "unsupported"
    | "error";
  webLlmModelId: BrowserWebLLMModelId | null;
  webLlmModelDigest: string | null;
  webLlmDeviceTier: BrowserWebLLMDeviceTier;
  webLlmCacheBackend: BrowserWebLLMCacheBackend | null;
  modelId:
    | typeof BROWSER_TASK_MODEL.modelId
    | typeof BROWSER_LANGUAGE_MODEL_ID
    | BrowserWebLLMModelId
    | null;
  modelDigest: string | null;
};
export type BrowserAIInferenceProof = {
  proofVersion: "browser-ai-inference-proof-v1";
  state: "inference_verified";
  inferenceMode: "generative-model" | "task-model";
  modelId:
    | "chrome-built-in-summarizer"
    | typeof BROWSER_LANGUAGE_MODEL_ID
    | typeof BROWSER_TASK_MODEL.modelId
    | BrowserWebLLMModelId;
  modelDigest: string;
  verifiedAt: string;
  latencyMs: number;
  outputDigest: string;
  outputBytes: number;
  externalRequest: false;
  dataLeftDevice: false;
};

export type BrowserAIStreamProgress = {
  generatedCharacters: number;
  generatedTokenEvents: number;
  delta: string;
  elapsedMs: number;
};

export type BrowserAIExecutionOptions = {
  /** Keep T1 work on semantic/summarizer/packaged runtimes instead of WebLLM. */
  preferLightweightRuntime?: boolean;
  /** Fresh T1 compute pins the immutable packaged task model. */
  requiredTaskExecutor?: "browser-task-model";
  /** Declared before inference; a returned proof can never choose this mode. */
  contextAttestation?: BrowserContextAttestationRequirement;
  /**
   * T2 uses exactly the executor selected by eligibility. When set, failure or
   * unavailability is surfaced to the caller and can never become a packaged
   * task-model result.
   */
  requiredGenerativeExecutor?: "webllm-worker" | "chromium-prompt-api";
  /** Internal adapter control: OS owns normalization after final selection. */
  deferTraditionalChineseNormalization?: boolean;
  /** Internal-only terminal recovery constraint; never accepted from PlatformAIRequest. */
  outputConstraint?: BrowserWebLLMOutputConstraint;
  /** Internal-only, in-memory suffix anchor. Never accepted from PlatformAIRequest. */
  unapprovedContinuationSeed?: {
    anchor: string;
    baseDigest: string;
    baseHanCharacters: number;
    minimumCombinedHanCharacters: number;
    maximumCombinedHanCharacters: number;
  };
};

export type BrowserAICandidateV2SegmentExecution = {
  response: BrowserProseCandidateV2SegmentResponse;
  callReceipt: BrowserProseCandidateV2SegmentCallReceipt;
};

export type BrowserAICandidateV2RuntimeDependencies = Readonly<Partial<{
  runtimeSnapshot: typeof browserWebLLMRuntimeSnapshot;
  readBenchmark: typeof readBrowserDeviceBenchmark;
  generate: typeof generateWithBrowserWebLLM;
}>>;

function validStructuredBenchmarkOutput(content: string) {
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");
  try {
    const parsed = JSON.parse(normalized) as { status?: unknown };
    return typeof parsed.status === "string" && parsed.status.trim().length > 0;
  } catch {
    return false;
  }
}

type BrowserSummarizer = {
  summarize(text: string, options?: { context?: string; signal?: AbortSignal }): Promise<string>;
  destroy?(): void;
};

type BrowserSummarizerFactory = {
  availability(options?: Record<string, unknown>): Promise<string>;
  create(options?: Record<string, unknown>): Promise<BrowserSummarizer>;
};

type BrowserLanguageModelSession = {
  prompt(
    input: string,
    options?: { signal?: AbortSignal },
  ): Promise<string>;
  destroy?(): void;
};

type BrowserLanguageModelFactory = {
  availability(options?: Record<string, unknown>): Promise<string>;
  create(options?: Record<string, unknown>): Promise<BrowserLanguageModelSession>;
};

export const BROWSER_LANGUAGE_MODEL_ID =
  "chrome-built-in-language-model" as const;
const BROWSER_MANAGED_MODEL_DIGEST =
  "browser-managed-model-digest-unavailable";

const BROWSER_LIGHT_TASKS: PlatformAIRequest["taskType"][] = [
  "chapter.compress",
  "story.summary",
  "story.chapterReview",
  "story.consistencyCheck",
  "story.timelineCheck",
  "story.characterCheck",
  "story.worldRuleCheck",
  "story.foreshadowingCheck",
  "story.retrieval",
  "story.plotAnalysis",
  "story.pacingCheck",
  "story.originalityCheck",
  "drama.chapterClassify",
  "drama.sceneClassify",
  "drama.characterPresence",
  "drama.emotionCurve",
  "drama.shortSummary",
  "drama.beatSuggestion",
  "character.nameExtract",
  "character.traitClassify",
  "character.voiceClassify",
  "character.emotionClassify",
  "character.relationshipEventClassify",
  "character.dialogueConsistency",
  "game.stateEvaluation",
];

const BROWSER_CONTROL_TIMEOUT_MS = 1_500;
const BROWSER_INFERENCE_TIMEOUT_MS = 15_000;

let browserInferenceProof: BrowserAIInferenceProof | null = null;

async function withBrowserDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  code: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error("瀏覽器 AI 操作逾時，已改用安全的封裝模型。"), {
        code,
        retryable: true,
      }));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function browserSummarizerAvailability(factory: BrowserSummarizerFactory) {
  try {
    return await withBrowserDeadline(
      factory.availability({ type: "key-points", format: "plain-text", length: "medium" }),
      BROWSER_CONTROL_TIMEOUT_MS,
      "BROWSER_AI_AVAILABILITY_TIMEOUT",
    );
  } catch {
    return "unavailable";
  }
}

async function browserLanguageModelAvailability(
  factory: BrowserLanguageModelFactory,
) {
  try {
    return await withBrowserDeadline(
      factory.availability(),
      BROWSER_CONTROL_TIMEOUT_MS,
      "BROWSER_AI_PROMPT_AVAILABILITY_TIMEOUT",
    );
  } catch {
    return "unavailable";
  }
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function recordInferenceProof(
  output: string,
  startedAt: number,
  modelId: BrowserAIInferenceProof["modelId"],
  modelDigest: string,
  inferenceMode: BrowserAIInferenceProof["inferenceMode"] = "task-model",
) {
  const content = output.trim();
  if (!content) {
    throw Object.assign(new Error("瀏覽器模型沒有傳回可驗證內容。"), {
      code: "BROWSER_AI_INVALID_RESPONSE",
      retryable: true,
    });
  }
  if (
    inferenceMode === "generative-model"
    && !isCryptographicClosedAIModelDigest(modelDigest)
  ) {
    throw Object.assign(
      new Error("瀏覽器生成模型沒有可驗證的 SHA-256 模型摘要，不能標記為正式可用。"),
      {
        code: "BROWSER_AI_MODEL_DIGEST_NOT_VERIFIABLE",
        retryable: false,
      },
    );
  }
  browserInferenceProof = {
    proofVersion: "browser-ai-inference-proof-v1",
    state: "inference_verified",
    inferenceMode,
    modelId,
    modelDigest,
    verifiedAt: new Date().toISOString(),
    latencyMs: Math.round(performance.now() - startedAt),
    outputDigest: await sha256Hex(content),
    outputBytes: new TextEncoder().encode(content).byteLength,
    externalRequest: false,
    dataLeftDevice: false,
  };
  return { ...browserInferenceProof };
}

export function getBrowserAIInferenceProof() {
  return browserInferenceProof ? { ...browserInferenceProof } : null;
}

export async function verifyBrowserAI(
  signal?: AbortSignal,
  setupVerification?: BrowserWebLLMSetupBoundary,
) {
  browserInferenceProof = null;
  const capability = await detectBrowserAI();
  const stagedSetupModel = setupVerification
    ? browserWebLLMModel(setupVerification.modelId)
    : null;
  if (capability.status !== "ready" && !stagedSetupModel) {
    const nativePromptAvailable = capability.promptAvailability === "available"
      || capability.promptAvailability === "readily";
    const digestNotVerifiable = nativePromptAvailable
      && !capability.webLlmSupported;
    throw Object.assign(new Error(
      digestNotVerifiable
        ? "瀏覽器內建 Prompt API 沒有可驗證的模型摘要，不能作為正式閉端生成後端。"
        : capability.status === "runtime_not_installed"
        ? "此裝置支援瀏覽器 AI，但模型尚未下載完成。"
        : "此裝置目前不支援瀏覽器內建 AI。",
    ), {
      code: digestNotVerifiable
        ? "BROWSER_AI_MODEL_DIGEST_NOT_VERIFIABLE"
        : capability.status === "runtime_not_installed"
          ? "BROWSER_AI_MODEL_NOT_READY"
          : "BROWSER_AI_UNSUPPORTED",
      retryable: capability.status === "runtime_not_installed",
    });
  }
  const startedAt = performance.now();
  if (
    stagedSetupModel
    || (
      capability.webLlmInstalled
      && capability.webLlmModelId
      && capability.webLlmModelDigest
    )
  ) {
    try {
      const result = await generateWithBrowserWebLLM({
        systemInstruction: "你是裝置內繁體中文小說助理。只輸出有效 JSON，不要 Markdown。",
        prompt: "只回覆這個結構並填入繁體中文短句：{\"status\":\"...\"}",
        jsonMode: true,
        jsonSchema: BROWSER_GENERATION_VERIFICATION_SCHEMA,
        seed: BROWSER_GENERATION_VERIFICATION_SEED,
        temperature: 0.2,
        maxTokens: 64,
        setupVerification,
        signal,
      });
      const runtime = await browserWebLLMRuntimeSnapshot();
      const model = browserWebLLMModel(result.modelId);
      if (model) {
        const queue = runtime.performance;
        const benchmark = evaluateBrowserDeviceBenchmark({
          model,
          device: runtime.device,
          samples: [{
            initializationMs: result.engineReused
              ? 0
              : result.firstTokenMs ?? result.elapsedMs,
            firstTokenMs: result.firstTokenMs ?? result.elapsedMs,
            tokensPerSecond: result.tokensPerSecond ?? 0,
            peakEstimatedMemoryMB: result.estimatedVramMB,
            workerCrashCount: queue.workerRestartCount,
            gpuDeviceLostCount: queue.gpuDeviceLostCount,
            outputFailureRate: result.content.trim() ? 0 : 1,
            structuredOutputSuccessRate:
              validStructuredBenchmarkOutput(result.content) ? 1 : 0,
            completedAt: new Date().toISOString(),
          }],
        });
        await persistBrowserDeviceBenchmark(benchmark, runtime.device.tier);
        if (!benchmark.benchmarkPassed) {
          throw Object.assign(
            new Error("WebLLM 真實裝置 Benchmark 未達到此模型的執行門檻。"),
            {
              code: "BROWSER_WEBLLM_BENCHMARK_FAILED",
              failureReasons: benchmark.failureReasons,
            },
          );
        }
      }
      return recordInferenceProof(
        result.content,
        startedAt,
        result.modelId,
        result.modelDigest,
        "generative-model",
      );
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      if ((error as { code?: unknown } | null)?.code === "BROWSER_WEBLLM_BENCHMARK_FAILED") {
        throw error;
      }
      throw Object.assign(
        new Error("已安裝的 WebLLM 模型未通過真實推理測試。"),
        {
          code: "BROWSER_WEBLLM_INFERENCE_FAILED",
          retryable: true,
          cause: error,
        },
      );
    }
  }
  throw Object.assign(
    new Error("瀏覽器沒有通過可驗證模型摘要約束的生成 runtime。"),
    {
      code: "BROWSER_AI_GENERATIVE_PROOF_UNAVAILABLE",
      retryable: false,
    },
  );
}

function summarizerFactory(): BrowserSummarizerFactory | null {
  const value = (globalThis as unknown as { Summarizer?: BrowserSummarizerFactory }).Summarizer;
  return value && typeof value.availability === "function" && typeof value.create === "function" ? value : null;
}

function languageModelFactory(): BrowserLanguageModelFactory | null {
  const scope = globalThis as unknown as {
    LanguageModel?: BrowserLanguageModelFactory;
    ai?: { languageModel?: BrowserLanguageModelFactory };
  };
  const value = scope.LanguageModel ?? scope.ai?.languageModel;
  return value
    && typeof value.availability === "function"
    && typeof value.create === "function"
    ? value
    : null;
}

export async function detectBrowserAI(): Promise<BrowserAICapability> {
  if (typeof window === "undefined") return {
    webGpu: false,
    wasm: false,
    worker: false,
    storageQuota: null,
    storageUsage: null,
    status: "runtime_unavailable",
    reason: "browser_required",
    summaryAvailability: "unavailable",
    promptAvailability: "unavailable",
    generativeModelReady: false,
    generativeRuntime: null,
    webLlmSupported: false,
    webLlmInstalled: false,
    webLlmStatus: "unsupported",
    webLlmModelId: null,
    webLlmModelDigest: null,
    webLlmDeviceTier: "unsupported",
    webLlmCacheBackend: null,
    modelId: null,
    modelDigest: null,
  };
  const webGpu = "gpu" in navigator;
  const wasm = typeof WebAssembly !== "undefined";
  const worker = typeof Worker !== "undefined";
  const estimate: StorageEstimate = navigator.storage?.estimate
    ? await withBrowserDeadline(
      navigator.storage.estimate(),
      BROWSER_CONTROL_TIMEOUT_MS,
      "BROWSER_AI_STORAGE_ESTIMATE_TIMEOUT",
    ).catch(() => ({} as StorageEstimate))
    : {};
  const factory = summarizerFactory();
  const summaryAvailability = factory
    ? await browserSummarizerAvailability(factory)
    : "unavailable";
  const languageFactory = languageModelFactory();
  const promptAvailability = languageFactory
    ? await browserLanguageModelAvailability(languageFactory)
    : "unavailable";
  const nativePromptAvailable = promptAvailability === "available"
    || promptAvailability === "readily";
  const webLlm = await withBrowserDeadline(
    browserWebLLMRuntimeSnapshot(),
    BROWSER_CONTROL_TIMEOUT_MS,
    "BROWSER_WEBLLM_PROBE_TIMEOUT",
  ).catch(() => null);
  const selectedWebLlm = webLlm?.models.find((model) => (
    model.modelId === webLlm.selectedModelId
  )) ?? null;
  const webLlmInstalling = selectedWebLlm?.installStatus === "installing";
  const webLlmInstalled = selectedWebLlm?.installStatus === "ready"
    && selectedWebLlm.cacheVerified
    && selectedWebLlm.generationVerified
    && isCryptographicClosedAIModelDigest(selectedWebLlm.modelDigest);
  const webLlmModelId = webLlmInstalled ? selectedWebLlm.modelId : null;
  const webLlmModelDigest = webLlmInstalled ? selectedWebLlm.modelDigest : null;
  // Chromium Prompt API does not expose a verifiable immutable model digest.
  // It remains an availability signal only; production generation readiness
  // is limited to a verified WebLLM model with a SHA-256 identity.
  const generativeModelReady = webLlmInstalled;
  const generativeRuntime = webLlmInstalled
    ? "webllm-worker" as const
    : null;
  const ready = summaryAvailability === "available" || summaryAvailability === "readily";
  const downloadable = summaryAvailability === "downloadable" || summaryAvailability === "after-download";
  return {
    webGpu,
    wasm,
    worker,
    storageQuota: estimate.quota ?? null,
    storageUsage: estimate.usage ?? null,
    status: webLlmInstalled
      ? "ready"
      : webLlmInstalling || webLlm?.supported
        ? "runtime_not_installed"
        : "degraded",
    reason: webLlmInstalled
      ? "browser_hybrid_runtime_webllm_ready"
      : webLlmInstalling
        ? "browser_hybrid_runtime_webllm_preparing"
        : webLlm?.supported
          ? "browser_hybrid_runtime_webllm_install_required"
        : nativePromptAvailable
          ? "browser_native_prompt_digest_not_verifiable"
        : ready
          ? "browser_hybrid_runtime_native_summary_task_only"
        : languageFactory && (
          promptAvailability === "downloadable"
          || promptAvailability === "downloading"
          || promptAvailability === "after-download"
        )
          ? "browser_hybrid_runtime_native_prompt_download_required"
          : "browser_hybrid_runtime_packaged_task_only",
    summaryAvailability: ready
      ? summaryAvailability
      : downloadable
        ? `${summaryAvailability}:packaged-fallback-ready`
        : "packaged-task-runtime-ready",
    promptAvailability,
    generativeModelReady,
    generativeRuntime,
    webLlmSupported: Boolean(webLlm?.supported),
    webLlmInstalled,
    webLlmStatus: webLlmInstalled
      ? "ready"
      : webLlmInstalling
        ? "installing"
      : webLlm?.supported
        ? "install_required"
        : webLlm
          ? "unsupported"
          : "error",
    webLlmModelId,
    webLlmModelDigest,
    webLlmDeviceTier: webLlm?.device.tier ?? "unsupported",
    webLlmCacheBackend: webLlm?.cacheBackend ?? null,
    modelId: webLlmModelId
      ?? BROWSER_TASK_MODEL.modelId,
    modelDigest: webLlmModelDigest
      ?? BROWSER_TASK_MODEL.modelDigest,
  };
}

export async function browserProviderSnapshot(
  capability?: BrowserAICapability,
): Promise<PlatformProviderSnapshot> {
  const resolvedCapability = capability ?? await detectBrowserAI();
  const productionGenerationReady = resolvedCapability.generativeModelReady
    && resolvedCapability.generativeRuntime === "webllm-worker"
    && resolvedCapability.webLlmInstalled
    && isCryptographicClosedAIModelDigest(resolvedCapability.modelDigest);
  const providerStatus: PlatformProviderSnapshot["status"] = productionGenerationReady
    ? "ready"
    : resolvedCapability.status === "runtime_unavailable"
      ? "runtime_unavailable"
      : resolvedCapability.webLlmSupported
        ? "runtime_not_installed"
        : "degraded";
  return {
    id: "browser-ai",
    status: providerStatus,
    capabilities: [
      "text",
      "offline",
      ...(resolvedCapability.webLlmInstalled ? ["streaming" as const] : []),
      ...(productionGenerationReady ? ["structured" as const] : []),
    ],
    modelId: resolvedCapability.modelId,
    modelDigest: productionGenerationReady ? resolvedCapability.modelDigest : null,
    maxContext: productionGenerationReady
      ? 4_096
      : 0,
    local: true,
    requiresInternet: false,
    taskTypes: productionGenerationReady ? undefined : BROWSER_LIGHT_TASKS,
    detail: resolvedCapability.reason,
  };
}

function isAbortError(error: unknown, signal?: AbortSignal) {
  return Boolean(
    signal?.aborted
    || (error instanceof DOMException && error.name === "AbortError")
    || (error instanceof Error && error.name === "AbortError"),
  );
}

function browserProseCandidateV2SriHex(value: string): string | null {
  if (!value.startsWith("sha256-")) return null;
  try {
    return [...atob(value.slice("sha256-".length))]
      .map((character) => character.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

export async function runBrowserAICandidateV2Segment(input: {
  request: PlatformAIRequest;
  decision: PlatformRouterDecision;
  segment: BrowserProseCandidateV2SegmentRequest;
  contributorIndex: 0 | 1 | 2;
  invocationRequestId: string;
  contextDigest: string;
  onProgress?: (progress: BrowserAIStreamProgress) => void;
  /** Focused contract seam. Product callers always use the default runtime dependencies. */
  runtimeDependencies?: BrowserAICandidateV2RuntimeDependencies;
}): Promise<BrowserAICandidateV2SegmentExecution> {
  const { request, decision, segment } = input;
  const expected = BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY.segmentPlan[
    input.contributorIndex
  ];
  if (
    !expected
    || segment.segmentId !== expected.id
    || segment.ordinal !== input.contributorIndex + 1
    || segment.maxOutputTokens !== expected.maxOutputTokens
    || segment.candidateIdentityDigest
      !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.candidateIdentityDigest
    || segment.temperature !== 0
    || segment.topP !== 1
    || segment.requestFullProse !== false
  ) {
    throw Object.assign(new Error("BROWSER_PROSE_CANDIDATE_V2_SEGMENT_REQUEST_INVALID"), {
      code: "BROWSER_PROSE_CANDIDATE_V2_SEGMENT_REQUEST_INVALID",
      fallbackAttempted: false,
    });
  }
  if (
    request.privacyMode !== "strict-local"
    || !["chapter.continue", "chapter.expand"].includes(request.taskType)
    || request.externalConsent !== false
    || request.closedOnly !== true
    || request.offlineRequired !== true
    || request.fallbackPolicy !== "none"
    || decision.providerId !== "browser-ai"
    || decision.privacyMode !== "strict-local"
    || decision.modelId !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelId
    || decision.modelDigest !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelDigest
    || decision.externalRequest !== false
    || decision.dataLeavesDevice !== false
    || decision.fallbackChain.length !== 0
  ) {
    throw Object.assign(new Error("BROWSER_PROSE_CANDIDATE_V2_EXECUTION_BOUNDARY_INVALID"), {
      code: "BROWSER_PROSE_CANDIDATE_V2_EXECUTION_BOUNDARY_INVALID",
      fallbackAttempted: false,
    });
  }
  const snapshot = await (
    input.runtimeDependencies?.runtimeSnapshot ?? browserWebLLMRuntimeSnapshot
  )();
  const selectedModel = snapshot.models.find((model) => model.selected) ?? null;
  const selectedManifest = browserWebLLMModel(BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelId);
  if (
    snapshot.selectedModelId !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelId
    || selectedModel?.modelId !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelId
    || selectedModel.modelDigest !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelDigest
    || selectedModel.installStatus !== "ready"
    || selectedModel.cacheVerified !== true
    || selectedModel.generationVerified !== true
    || selectedManifest?.sourceRevision !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelRevision
    || browserProseCandidateV2SriHex(selectedManifest?.integrity.model_lib ?? "")
      !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelLibDigest
  ) {
    throw Object.assign(new Error("BROWSER_PROSE_CANDIDATE_V2_MODEL_NOT_READY"), {
      code: "BROWSER_PROSE_CANDIDATE_V2_MODEL_NOT_READY",
      fallbackAttempted: false,
    });
  }
  const benchmark = await (
    input.runtimeDependencies?.readBenchmark ?? readBrowserDeviceBenchmark
  )(
    BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelId,
    BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelDigest,
    snapshot.device.tier,
  ).catch(() => null) as BrowserDeviceBenchmark | null;
  if (
    !selectedManifest
    || !benchmark
    || benchmark.benchmarkPassed !== true
    || !isCanonicalBrowserDeviceBenchmark(benchmark, {
      model: selectedManifest,
      currentDeviceTier: snapshot.device.tier,
    })
  ) {
    throw Object.assign(
      new Error("BROWSER_PROSE_CANDIDATE_V2_BENCHMARK_NOT_READY"),
      {
        code: "BROWSER_PROSE_CANDIDATE_V2_BENCHMARK_NOT_READY",
        fallbackAttempted: false,
        retryAttempted: false,
        modelCallClaimed: false,
      },
    );
  }
  const started = performance.now();
  try {
    const generated = await (
      input.runtimeDependencies?.generate ?? generateWithBrowserWebLLM
    )({
      systemInstruction: BROWSER_PROSE_CANDIDATE_V2_SYSTEM_INSTRUCTION,
      prompt: segment.prompt,
      trustedClosedPrompt: true,
      temperature: segment.temperature,
      topP: segment.topP,
      maxTokens: segment.maxOutputTokens,
      retryBudget: 0,
      expectedModelIdentity: {
        modelId: BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelId,
        modelDigest: BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelDigest,
      },
      invocationRequestId: input.invocationRequestId,
      signal: request.signal,
      onToken: (event) => input.onProgress?.({
        generatedCharacters: event.content.length,
        generatedTokenEvents: event.generatedTokenEvents,
        delta: event.delta,
        elapsedMs: event.elapsedMs,
      }),
    });
    if (
      generated.modelId !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelId
      || generated.modelDigest !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelDigest
      || generated.finishReason !== "stop"
      || generated.externalRequest !== false
      || generated.dataLeftDevice !== false
      || generated.omittedInputCharacters !== 0
      || !generated.content.trim()
    ) {
      throw Object.assign(new Error("BROWSER_PROSE_CANDIDATE_V2_GENERATION_RESULT_INVALID"), {
        code: "BROWSER_PROSE_CANDIDATE_V2_GENERATION_RESULT_INVALID",
      });
    }
    assertBrowserProseCandidateV2SafeOutput(
      generated.content,
      `segment-${segment.segmentId}`,
    );
    await recordInferenceProof(
      generated.content,
      started,
      generated.modelId,
      generated.modelDigest,
      "generative-model",
    );
    const result: PlatformAIResult = {
      requestId: input.invocationRequestId,
      providerId: "browser-ai",
      modelId: generated.modelId,
      modelDigest: generated.modelDigest,
      content: generated.content,
      candidateOnly: true,
      externalRequest: false,
      dataLeavesDevice: false,
      elapsedMs: generated.elapsedMs,
      provenance: {
        ...decision,
        warnings: [
          ...decision.warnings,
          "Candidate V2 segment generated by the required on-device WebLLM worker.",
        ],
      },
      profileId: BROWSER_PROSE_CANDIDATE_V2_PROMPT_PROFILE_VERSION,
      firstTokenMs: generated.firstTokenMs,
      inputCharacters: generated.inputCharacters,
      outputCharacters: generated.outputCharacters,
      generatedTokenEvents: generated.generatedTokenEvents,
      omittedInputCharacters: generated.omittedInputCharacters,
      runtimeStats: generated.runtimeStats,
      tokensPerSecond: generated.tokensPerSecond,
      estimatedMemoryMB: generated.estimatedVramMB,
      executor: "webllm-worker",
      performancePolicy: generated.performancePolicy,
      queueWaitMs: generated.queueWaitMs,
      engineReused: generated.engineReused,
      generationFinishReason: generated.finishReason,
      completionTokens: generated.completionTokens,
      rawOutputCharacters: generated.outputCharacters,
    };
    const callReceipt = await createBrowserProseCandidateV2SegmentCallReceipt({
      outerRequestId: request.requestId,
      outerTaskType: request.taskType,
      outerQualityPhase: request.qualityPhase ?? "draft",
      invocationRequestId: input.invocationRequestId,
      contributorIndex: input.contributorIndex,
      contextDigest: input.contextDigest,
      segment,
      systemInstruction: BROWSER_PROSE_CANDIDATE_V2_SYSTEM_INSTRUCTION,
      result,
      executionSource: "browser-webllm-runtime",
    });
    return {
      response: {
        segmentId: segment.segmentId,
        content: generated.content,
        finishReason: generated.finishReason,
      },
      callReceipt,
    };
  } catch (error) {
    cancelBrowserWebLLMGeneration();
    if (isAbortError(error, request.signal)) throw error;
    throw Object.assign(
      new Error("Candidate V2 WebLLM segment failed; no fallback or retry was used."),
      {
        code: "BROWSER_PROSE_CANDIDATE_V2_SEGMENT_EXECUTION_FAILED",
        fallbackAttempted: false,
        retryAttempted: false,
        causeCode: safeClosedAgentBrowserRuntimeCauseCode(error),
        cause: error,
      },
    );
  }
}

export async function runBrowserAI(
  request: PlatformAIRequest,
  decision: PlatformRouterDecision,
  onProgress?: (progress: BrowserAIStreamProgress) => void,
  options: BrowserAIExecutionOptions = {},
): Promise<PlatformAIResult> {
  const started = performance.now();
  const decisionManifest = browserWebLLMModel(decision.modelId);
  assertBrowserProseTierProductionQualified({
    taskType: request.taskType,
    selectedModelTier: browserProseModelTierFromModelId(decision.modelId),
    selectedModelId: decision.modelId,
    selectedModelDigest: decision.modelDigest,
    executor: decisionManifest ? "webllm-worker" : "chromium-prompt-api",
  });
  const sourceText = [...request.context, request.input].join("\n\n");
  const contextAttestation = options.contextAttestation
    ?? request.contextAttestation;
  const hasFinalContextBoundary = [
    request.browserFinalContextExpectations,
    request.browserFinalContextOuterRequestId,
    request.browserFinalContextOuterTaskType,
    request.browserFinalContextOuterQualityPhase,
    request.browserFinalContextPipelineKind,
    request.browserFinalContextInnerStage,
    request.browserFinalContextInnerIndex,
  ].some((value) => value !== undefined);
  if (
    options.contextAttestation !== undefined
    && request.contextAttestation !== undefined
    && options.contextAttestation !== request.contextAttestation
  ) {
    throw Object.assign(new Error("BROWSER_FINAL_CONTEXT_BINDING_MISMATCH"), {
      code: "BROWSER_FINAL_CONTEXT_BINDING_MISMATCH",
    });
  }
  if (
    contextAttestation === "required"
    && (
      options.requiredGenerativeExecutor !== "webllm-worker"
      || request.browserFinalContextExpectations === undefined
    )
  ) {
    throw Object.assign(new Error("BROWSER_FINAL_CONTEXT_PROOF_REQUIRED"), {
      code: "BROWSER_FINAL_CONTEXT_PROOF_REQUIRED",
    });
  }
  const invalidProofFreeBoundary = contextAttestation === "not_required"
    && (
      hasFinalContextBoundary
      || sourceText.includes("[[CTX3:")
      || sourceText.includes("<approved-model-context>")
    );
  const invalidTaskPin = options.requiredTaskExecutor === "browser-task-model"
    && (
      contextAttestation !== "not_required"
      || options.requiredGenerativeExecutor !== undefined
    );
  if (
    invalidProofFreeBoundary
    || contextAttestation === undefined && hasFinalContextBoundary
    || invalidTaskPin
  ) {
    throw Object.assign(new Error("BROWSER_FINAL_CONTEXT_BINDING_MISMATCH"), {
      code: "BROWSER_FINAL_CONTEXT_BINDING_MISMATCH",
    });
  }
  const normalizeGeneratedContent = async (input: {
    value: string;
    modelId: string | null;
    modelDigest: string | null;
  }) => {
    if (options.deferTraditionalChineseNormalization) {
      return { content: input.value };
    }
    const { normalizeTraditionalChinesePreservingProperNouns } = await import(
      "../../language/traditional-chinese"
    );
    return {
      content: normalizeTraditionalChinesePreservingProperNouns(
        input.value,
        sourceText,
      ),
    };
  };
  let webLlmFailureWarning: string | null = null;
  const webLlm = await browserWebLLMRuntimeSnapshot().catch(() => null);
  const selectedWebLlm = webLlm?.models.find((model) => (
    model.modelId === webLlm.selectedModelId
  )) ?? null;
  const webLlmReady = selectedWebLlm?.installStatus === "ready"
    && selectedWebLlm.cacheVerified;
  if (options.requiredGenerativeExecutor === "webllm-worker" && !webLlmReady) {
    throw Object.assign(
      new Error("The verified WebLLM worker selected for this T2 task is unavailable."),
      {
        code: "BROWSER_AI_REQUIRED_GENERATIVE_EXECUTOR_UNAVAILABLE",
        requiredExecutor: options.requiredGenerativeExecutor,
        fallbackAttempted: false,
      },
    );
  }
  if (
    !options.preferLightweightRuntime
    && webLlmReady
    && (!options.requiredGenerativeExecutor
      || options.requiredGenerativeExecutor === "webllm-worker")
    && taskComplexity(request.taskType) !== "heavy"
  ) {
    const profile = getClosedAIModelProfile(request.taskType, "browser-ai");
    const prompt = buildClosedAIModelPrompt({
      objective: request.input,
      context: request.context,
      browserFinalContextExpectations: request.browserFinalContextExpectations,
      profile,
      qualityPhase: request.qualityPhase,
      agentPlan: request.agentPlan,
      toolResults: request.toolResults,
      workingMaterials: request.workingMaterials,
      unapprovedContinuationSeed: options.unapprovedContinuationSeed,
    });
    try {
      const generated = await generateWithBrowserWebLLM({
        systemInstruction: profile.systemInstruction,
        prompt: prompt.prompt,
        trustedClosedPrompt: true,
        jsonMode: request.requiresStructured === true,
        jsonSchema: request.outputSchema,
        outputConstraint: options.outputConstraint,
        temperature: request.generationOptions?.temperature,
        topP: request.generationOptions?.topP,
        maxTokens: request.generationOptions?.maxTokens,
        repetitionPenalty: request.generationOptions?.repetitionPenalty,
        seed: request.generationOptions?.seed,
        contextAttestation,
        finalContextExpectations: request.browserFinalContextExpectations,
        finalContextOuterRequestId: request.browserFinalContextOuterRequestId,
        finalContextOuterTaskType: request.browserFinalContextOuterTaskType,
        finalContextOuterQualityPhase: request.browserFinalContextOuterQualityPhase,
        finalContextPipelineKind: request.browserFinalContextPipelineKind,
        finalContextInnerStage: request.browserFinalContextInnerStage,
        finalContextInnerIndex: request.browserFinalContextInnerIndex,
        invocationRequestId: request.requestId,
        signal: request.signal,
        onToken: (event) => onProgress?.({
          generatedCharacters: event.content.length,
          generatedTokenEvents: event.generatedTokenEvents,
          delta: event.delta,
          elapsedMs: event.elapsedMs,
        }),
      });
      const normalizedResult = await normalizeGeneratedContent({
        value: generated.content,
        modelId: generated.modelId,
        modelDigest: generated.modelDigest,
      });
      const normalized = normalizedResult.content;
      await recordInferenceProof(
        normalized,
        started,
        generated.modelId,
        generated.modelDigest,
        "generative-model",
      );
      return {
        requestId: request.requestId,
        providerId: "browser-ai",
        modelId: generated.modelId,
        modelDigest: generated.modelDigest,
        content: normalized,
        candidateOnly: true,
        externalRequest: false,
        dataLeavesDevice: false,
        elapsedMs: generated.elapsedMs,
        provenance: {
          ...decision,
          modelId: generated.modelId,
          modelDigest: generated.modelDigest,
          warnings: [
            ...decision.warnings,
            "WebLLM WebGPU Worker generated this candidate on device.",
          ],
        },
        profileId: profile.profileId,
        firstTokenMs: generated.firstTokenMs,
        inputCharacters: generated.inputCharacters,
        outputCharacters: normalized.length,
        generatedTokenEvents: generated.generatedTokenEvents,
        omittedInputCharacters: prompt.omittedCharacters + generated.omittedInputCharacters,
        runtimeStats: [
          generated.runtimeStats,
          `finish-reason=${generated.finishReason ?? "unavailable"}`,
          `completion-tokens=${generated.completionTokens ?? "unavailable"}`,
          `raw-output-characters=${generated.outputCharacters}`,
          options.deferTraditionalChineseNormalization
            ? "traditional-chinese-normalization=deferred-to-closed-agent-os"
            : `normalized-output-characters=${normalized.length}`,
        ].filter(Boolean).join("; "),
        tokensPerSecond: generated.tokensPerSecond,
        estimatedMemoryMB: generated.estimatedVramMB,
        executor: "webllm-worker",
        performancePolicy: generated.performancePolicy,
        queueWaitMs: generated.queueWaitMs,
        engineReused: generated.engineReused,
        generationFinishReason: generated.finishReason,
        completionTokens: generated.completionTokens,
        rawOutputCharacters: generated.outputCharacters,
        normalizedOutputCharacters:
          options.deferTraditionalChineseNormalization
            ? undefined
            : normalized.length,
        browserModelContextInvocationProof:
          generated.browserModelContextInvocationProof,
        contextAttestation,
      };
    } catch (error) {
      cancelBrowserWebLLMGeneration();
      if (isAbortError(error, request.signal)) throw error;
      const causeCode = safeClosedAgentBrowserRuntimeCauseCode(error);
      if (options.requiredGenerativeExecutor === "webllm-worker") {
        throw Object.assign(
          new Error("The required WebLLM worker failed; no alternate executor was used."),
          {
            code: "BROWSER_AI_REQUIRED_GENERATIVE_EXECUTION_FAILED",
            requiredExecutor: options.requiredGenerativeExecutor,
            fallbackAttempted: false,
            causeCode,
            cause: error,
          },
        );
      }
      webLlmFailureWarning = "WebLLM generation failed; no rule output was presented as an LLM result.";
      if (!BROWSER_LIGHT_TASKS.includes(request.taskType)) {
        const languageFactory = languageModelFactory();
        const availability = languageFactory
          ? await browserLanguageModelAvailability(languageFactory)
          : "unavailable";
        if (!languageFactory || !["available", "readily"].includes(availability)) {
          throw Object.assign(
            new Error("Browser WebLLM 執行失敗；請重試較小模型或明確升級到 Local Ollama。"),
            {
              code: "BROWSER_AI_ESCALATE_LOCAL_OLLAMA",
              retryable: true,
              causeCode,
              cause: error,
            },
          );
        }
      }
    }
  }
  const languageFactory = languageModelFactory();
  const promptAvailability = languageFactory
    ? await browserLanguageModelAvailability(languageFactory)
    : "unavailable";
  const nativeGenerativeReady = Boolean(
    languageFactory
    && (promptAvailability === "available" || promptAvailability === "readily"),
  );
  if (
    options.requiredGenerativeExecutor === "chromium-prompt-api"
    && !nativeGenerativeReady
  ) {
    throw Object.assign(
      new Error("The verified Chromium Prompt API selected for this T2 task is unavailable."),
      {
        code: "BROWSER_AI_REQUIRED_GENERATIVE_EXECUTOR_UNAVAILABLE",
        requiredExecutor: options.requiredGenerativeExecutor,
        fallbackAttempted: false,
      },
    );
  }
  if (
    !options.preferLightweightRuntime
    && nativeGenerativeReady
    && (!options.requiredGenerativeExecutor
      || options.requiredGenerativeExecutor === "chromium-prompt-api")
    && taskComplexity(request.taskType) !== "heavy"
  ) {
    const profile = getClosedAIModelProfile(request.taskType, "browser-ai");
    const prompt = buildClosedAIModelPrompt({
      objective: request.input,
      context: request.context,
      profile,
      qualityPhase: request.qualityPhase,
      agentPlan: request.agentPlan,
      toolResults: request.toolResults,
      workingMaterials: request.workingMaterials,
    });
    let session: BrowserLanguageModelSession | null = null;
    try {
      session = await withBrowserDeadline(
        languageFactory!.create({
          initialPrompts: [{
            role: "system",
            content: profile.systemInstruction,
          }],
          signal: request.signal,
        }),
        BROWSER_INFERENCE_TIMEOUT_MS,
        "BROWSER_AI_PROMPT_CREATE_TIMEOUT",
      );
      const content = await withBrowserDeadline(
        session.prompt(prompt.prompt, { signal: request.signal }),
        profile.timeoutMs,
        "BROWSER_AI_PROMPT_INFERENCE_TIMEOUT",
      );
      const normalizedResult = await normalizeGeneratedContent({
        value: content.trim(),
        modelId: BROWSER_LANGUAGE_MODEL_ID,
        modelDigest: BROWSER_MANAGED_MODEL_DIGEST,
      });
      const normalized = normalizedResult.content;
      const elapsedMs = Math.round(performance.now() - started);
      onProgress?.({
        generatedCharacters: normalized.length,
        generatedTokenEvents: 1,
        delta: normalized,
        elapsedMs,
      });
      await recordInferenceProof(
        normalized,
        started,
        BROWSER_LANGUAGE_MODEL_ID,
        BROWSER_MANAGED_MODEL_DIGEST,
        "generative-model",
      );
      return {
        requestId: request.requestId,
        providerId: "browser-ai",
        modelId: BROWSER_LANGUAGE_MODEL_ID,
        modelDigest: BROWSER_MANAGED_MODEL_DIGEST,
        content: normalized,
        candidateOnly: true,
        externalRequest: false,
        dataLeavesDevice: false,
        elapsedMs,
        provenance: {
          ...decision,
          modelId: BROWSER_LANGUAGE_MODEL_ID,
          modelDigest: BROWSER_MANAGED_MODEL_DIGEST,
          warnings: [
            ...decision.warnings,
            "Chrome/Edge on-device Prompt API generative model used.",
          ],
        },
        profileId: profile.profileId,
        firstTokenMs: elapsedMs,
        inputCharacters: prompt.inputCharacters,
        outputCharacters: normalized.length,
        generatedTokenEvents: 1,
        omittedInputCharacters: prompt.omittedCharacters,
        executor: "chromium-prompt-api",
      };
    } catch (error) {
      if (options.requiredGenerativeExecutor === "chromium-prompt-api") {
        throw Object.assign(
          new Error("The required Chromium Prompt API failed; no alternate executor was used."),
          {
            code: "BROWSER_AI_REQUIRED_GENERATIVE_EXECUTION_FAILED",
            requiredExecutor: options.requiredGenerativeExecutor,
            fallbackAttempted: false,
            cause: error,
          },
        );
      }
      if (!BROWSER_LIGHT_TASKS.includes(request.taskType)) {
        throw Object.assign(
          new Error("瀏覽器內建生成模型執行失敗，沒有改用規則模板冒充生成結果。"),
          {
            code: "BROWSER_AI_GENERATION_FAILED",
            retryable: true,
            cause: error,
          },
        );
      }
    } finally {
      session?.destroy?.();
    }
  }
  if (options.requiredGenerativeExecutor) {
    throw Object.assign(
      new Error("The required T2 generative executor did not produce a candidate."),
      {
        code: "BROWSER_AI_REQUIRED_GENERATIVE_EXECUTION_FAILED",
        requiredExecutor: options.requiredGenerativeExecutor,
        fallbackAttempted: false,
      },
    );
  }
  if (!BROWSER_LIGHT_TASKS.includes(request.taskType)) {
    throw Object.assign(
      new Error("此瀏覽器只有輕量任務模型；續寫等工作需要 Local Ollama，或支援 Prompt API 的桌面瀏覽器。"),
      { code: "BROWSER_AI_TASK_NOT_SUPPORTED", retryable: false },
    );
  }
  const factory = summarizerFactory();
  const runPackagedFallback = async (warning: string): Promise<PlatformAIResult> => {
    const packagedTaskType = request.taskType === "story.retrieval"
      ? "story.summary"
      : request.taskType;
    const result = runPackagedBrowserTaskModel(packagedTaskType, sourceText);
    const normalizedResult = await normalizeGeneratedContent({
      value: result.content,
      modelId: result.modelId,
      modelDigest: result.modelDigest,
    });
    const normalized = normalizedResult.content;
    const elapsedMs = Math.round(performance.now() - started);
    onProgress?.({
      generatedCharacters: normalized.length,
      generatedTokenEvents: 1,
      delta: normalized,
      elapsedMs,
    });
    await recordInferenceProof(
      normalized,
      started,
      result.modelId,
      result.modelDigest,
    );
    return {
      requestId: request.requestId,
      providerId: "browser-ai",
      modelId: result.modelId,
      modelDigest: result.modelDigest,
      content: normalized,
      candidateOnly: true,
      externalRequest: false,
      dataLeavesDevice: false,
      elapsedMs,
        provenance: {
          ...decision,
          modelId: result.modelId,
          modelDigest: result.modelDigest,
        warnings: [
          ...decision.warnings,
          ...(webLlmFailureWarning ? [webLlmFailureWarning] : []),
          warning,
        ],
      },
      profileId: "closed-browser-ai-light-task-v2",
      firstTokenMs: elapsedMs,
      inputCharacters: sourceText.length,
      outputCharacters: normalized.length,
      generatedTokenEvents: 1,
      omittedInputCharacters: 0,
      executor: "browser-task-model",
      contextAttestation,
    };
  };
  if (options.requiredTaskExecutor === "browser-task-model") {
    return runPackagedFallback(
      "Pinned deterministic packaged browser task model used for this T1 task.",
    );
  }
  if (!isNativeBrowserSummaryTask(request.taskType)) {
    return runPackagedFallback(
      "Deterministic packaged browser task model used for this light task.",
    );
  }
  const availability = factory
    ? await browserSummarizerAvailability(factory)
    : "unavailable";
  if (!factory || (availability !== "available" && availability !== "readily")) {
    return runPackagedFallback(
      "Chrome Summarizer unavailable; packaged browser task model used.",
    );
  }
  let summarizer: BrowserSummarizer | null = null;
  try {
    summarizer = await withBrowserDeadline(
      factory.create({
        type: "key-points",
        format: "plain-text",
        length: "medium",
        sharedContext: "請以繁體中文摘要小說章節，保留人物、事件、地點、衝突與未解線索。",
      }),
      BROWSER_INFERENCE_TIMEOUT_MS,
      "BROWSER_AI_CREATE_TIMEOUT",
    );
    const content = await withBrowserDeadline(
      summarizer.summarize(sourceText, {
        context: "只輸出摘要，不新增原文不存在的事實。",
        signal: request.signal,
      }),
      BROWSER_INFERENCE_TIMEOUT_MS,
      "BROWSER_AI_INFERENCE_TIMEOUT",
    );
    await recordInferenceProof(
      content,
      started,
      "chrome-built-in-summarizer",
      "browser-managed-model-digest-unavailable",
    );
    const normalizedResult = await normalizeGeneratedContent({
      value: content.trim(),
      modelId: "chrome-built-in-summarizer",
      modelDigest: "browser-managed-model-digest-unavailable",
    });
    const normalized = normalizedResult.content;
    const elapsedMs = Math.round(performance.now() - started);
    onProgress?.({
      generatedCharacters: normalized.length,
      generatedTokenEvents: 1,
      delta: normalized,
      elapsedMs,
    });
    return {
      requestId: request.requestId,
      providerId: "browser-ai",
      modelId: "chrome-built-in-summarizer",
      modelDigest: "browser-managed-model-digest-unavailable",
      content: normalized,
      candidateOnly: true,
      externalRequest: false,
      dataLeavesDevice: false,
      elapsedMs,
      provenance: {
        ...decision,
        modelId: "chrome-built-in-summarizer",
        modelDigest: "browser-managed-model-digest-unavailable",
        warnings: [
          ...decision.warnings,
          ...(webLlmFailureWarning ? [webLlmFailureWarning] : []),
          "Chrome/Edge on-device Summarizer used for this light task.",
        ],
      },
      profileId: "closed-browser-ai-native-summary-v2",
      firstTokenMs: elapsedMs,
      inputCharacters: sourceText.length,
      outputCharacters: normalized.length,
      generatedTokenEvents: 1,
      omittedInputCharacters: 0,
      executor: "chromium-summarizer",
      contextAttestation,
    };
  } catch {
    return runPackagedFallback(
      "Chrome Summarizer failed or timed out; packaged browser task model used.",
    );
  } finally {
    summarizer?.destroy?.();
  }
}

export class BrowserAIProvider {
  async generate(request: PlatformAIRequest, decision: PlatformRouterDecision): Promise<PlatformAIResult> {
    return runBrowserAI(request, decision);
  }
}

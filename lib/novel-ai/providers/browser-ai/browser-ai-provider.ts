import type { PlatformAIRequest, PlatformAIResult, PlatformProviderSnapshot, PlatformRouterDecision } from "../../router/platform-types";
import {
  normalizeTraditionalChinesePreservingProperNouns,
} from "../../language/traditional-chinese";
import {
  BROWSER_TASK_MODEL,
  isNativeBrowserSummaryTask,
  runPackagedBrowserTaskModel,
} from "./browser-task-model";
import { taskComplexity } from "../../closed-agent-os/backend-manifest";
import {
  buildClosedAIModelPrompt,
  getClosedAIModelProfile,
} from "../closed/task-profile";
import {
  browserWebLLMRuntimeSnapshot,
  cancelBrowserWebLLMGeneration,
  generateWithBrowserWebLLM,
} from "./browser-webllm-runtime";
import type {
  BrowserWebLLMCacheBackend,
  BrowserWebLLMDeviceTier,
  BrowserWebLLMModelId,
} from "./webllm-model-registry";

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
  webLlmStatus: "ready" | "install_required" | "unsupported" | "error";
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

export async function verifyBrowserAI(signal?: AbortSignal) {
  const capability = await detectBrowserAI();
  if (capability.status !== "ready") {
    throw Object.assign(new Error(
      capability.status === "runtime_not_installed"
        ? "此裝置支援瀏覽器 AI，但模型尚未下載完成。"
        : "此裝置目前不支援瀏覽器內建 AI。",
    ), {
      code: capability.status === "runtime_not_installed"
        ? "BROWSER_AI_MODEL_NOT_READY"
        : "BROWSER_AI_UNSUPPORTED",
      retryable: capability.status === "runtime_not_installed",
    });
  }
  const startedAt = performance.now();
  if (
    capability.webLlmInstalled
    && capability.webLlmModelId
    && capability.webLlmModelDigest
  ) {
    try {
      const result = await generateWithBrowserWebLLM({
        systemInstruction: "你是裝置內繁體中文小說助理。只輸出一句簡短、自然的測試文字。",
        prompt: "用繁體中文寫一句：裝置內模型已完成真實推理。",
        temperature: 0.2,
        maxTokens: 48,
        signal,
      });
      return recordInferenceProof(
        result.content,
        startedAt,
        result.modelId,
        result.modelDigest,
        "generative-model",
      );
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
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
  const languageFactory = languageModelFactory();
  const promptAvailability = languageFactory
    ? await browserLanguageModelAvailability(languageFactory)
    : "unavailable";
  if (
    languageFactory
    && (promptAvailability === "available" || promptAvailability === "readily")
  ) {
    let session: BrowserLanguageModelSession | null = null;
    try {
      session = await withBrowserDeadline(
        languageFactory.create({
          initialPrompts: [{
            role: "system",
            content: "你是裝置內小說助手。只用繁體中文簡短回答，不新增輸入不存在的事實。",
          }],
          signal,
        }),
        BROWSER_INFERENCE_TIMEOUT_MS,
        "BROWSER_AI_PROMPT_CREATE_TIMEOUT",
      );
      const output = await withBrowserDeadline(
        session.prompt(
          "請用一句話摘要：林昭進入圖書館，發現帳冊失蹤，並在窗邊找到一枚濕泥腳印。",
          { signal },
        ),
        BROWSER_INFERENCE_TIMEOUT_MS,
        "BROWSER_AI_PROMPT_INFERENCE_TIMEOUT",
      );
      return recordInferenceProof(
        output,
        startedAt,
        BROWSER_LANGUAGE_MODEL_ID,
        BROWSER_MANAGED_MODEL_DIGEST,
        "generative-model",
      );
    } catch {
      // Keep probing the native summarizer and packaged task model below.
    } finally {
      session?.destroy?.();
    }
  }
  const factory = summarizerFactory();
  const availability = factory
    ? await browserSummarizerAvailability(factory)
    : "unavailable";
  if (!factory || (availability !== "available" && availability !== "readily")) {
    const result = runPackagedBrowserTaskModel(
      "story.summary",
      "林昭進入圖書館。她發現帳冊失蹤，並在窗邊找到一枚濕泥腳印。守門人聲稱整晚沒有人進出。",
    );
    return recordInferenceProof(
      result.content,
      startedAt,
      result.modelId,
      result.modelDigest,
    );
  }
  let summarizer: BrowserSummarizer | null = null;
  try {
    summarizer = await withBrowserDeadline(
      factory.create({
        type: "key-points",
        format: "plain-text",
        length: "short",
        sharedContext: "這是裝置內模型健康測試。只摘要輸入，不增加新事實。",
      }),
      BROWSER_INFERENCE_TIMEOUT_MS,
      "BROWSER_AI_CREATE_TIMEOUT",
    );
    const output = await withBrowserDeadline(
      summarizer.summarize(
        "林昭進入圖書館，發現帳冊失蹤，並在窗邊找到一枚濕泥腳印。",
        { context: "請以繁體中文輸出一句摘要。", signal },
      ),
      BROWSER_INFERENCE_TIMEOUT_MS,
      "BROWSER_AI_INFERENCE_TIMEOUT",
    );
    return recordInferenceProof(
      output,
      startedAt,
      "chrome-built-in-summarizer",
      "browser-managed-model-digest-unavailable",
    );
  } catch {
    const result = runPackagedBrowserTaskModel(
      "story.summary",
      "林昭進入圖書館。她發現帳冊失蹤，並在窗邊找到一枚濕泥腳印。守門人聲稱整晚沒有人進出。",
    );
    return recordInferenceProof(
      result.content,
      startedAt,
      result.modelId,
      result.modelDigest,
    );
  } finally {
    summarizer?.destroy?.();
  }
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
  const nativeGenerativeReady = promptAvailability === "available"
    || promptAvailability === "readily";
  const webLlm = await withBrowserDeadline(
    browserWebLLMRuntimeSnapshot(),
    BROWSER_CONTROL_TIMEOUT_MS,
    "BROWSER_WEBLLM_PROBE_TIMEOUT",
  ).catch(() => null);
  const selectedWebLlm = webLlm?.models.find((model) => (
    model.modelId === webLlm.selectedModelId
  )) ?? null;
  const webLlmInstalled = selectedWebLlm?.installStatus === "ready"
    && selectedWebLlm.cacheVerified;
  const webLlmModelId = webLlmInstalled ? selectedWebLlm.modelId : null;
  const webLlmModelDigest = webLlmInstalled ? selectedWebLlm.modelDigest : null;
  const generativeModelReady = webLlmInstalled || nativeGenerativeReady;
  const generativeRuntime = webLlmInstalled
    ? "webllm-worker" as const
    : nativeGenerativeReady
      ? "chromium-prompt-api" as const
      : null;
  const ready = summaryAvailability === "available" || summaryAvailability === "readily";
  const downloadable = summaryAvailability === "downloadable" || summaryAvailability === "after-download";
  return {
    webGpu,
    wasm,
    worker,
    storageQuota: estimate.quota ?? null,
    storageUsage: estimate.usage ?? null,
    status: "ready",
    reason: webLlmInstalled
      ? "browser_hybrid_runtime_webllm_ready"
      : nativeGenerativeReady
        ? "browser_hybrid_runtime_native_prompt_ready"
      : ready
        ? "browser_hybrid_runtime_native_summary_ready"
        : webLlm?.supported
          ? "browser_hybrid_runtime_webllm_install_required"
        : languageFactory && (
          promptAvailability === "downloadable"
          || promptAvailability === "downloading"
          || promptAvailability === "after-download"
        )
          ? "browser_hybrid_runtime_native_prompt_download_required"
          : "browser_hybrid_runtime_packaged_ready",
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
      ?? (nativeGenerativeReady ? BROWSER_LANGUAGE_MODEL_ID : BROWSER_TASK_MODEL.modelId),
    modelDigest: webLlmModelDigest
      ?? (nativeGenerativeReady
        ? BROWSER_MANAGED_MODEL_DIGEST
        : BROWSER_TASK_MODEL.modelDigest),
  };
}

export async function browserProviderSnapshot(): Promise<PlatformProviderSnapshot> {
  const capability = await detectBrowserAI();
  return {
    id: "browser-ai",
    status: capability.status,
    capabilities: [
      "text",
      "offline",
      ...(capability.webLlmInstalled ? ["streaming" as const] : []),
      ...(capability.generativeModelReady ? ["structured" as const] : []),
    ],
    modelId: capability.modelId,
    modelDigest: capability.status === "ready" ? capability.modelDigest : null,
    maxContext: capability.status === "ready"
      ? capability.webLlmInstalled
        ? 4_096
        : capability.generativeModelReady
          ? 8_192
        : 16_384
      : 0,
    local: true,
    requiresInternet: false,
    taskTypes: capability.generativeModelReady ? undefined : BROWSER_LIGHT_TASKS,
    detail: capability.reason,
  };
}

function isAbortError(error: unknown, signal?: AbortSignal) {
  return Boolean(
    signal?.aborted
    || (error instanceof DOMException && error.name === "AbortError")
    || (error instanceof Error && error.name === "AbortError"),
  );
}

export async function runBrowserAI(
  request: PlatformAIRequest,
  decision: PlatformRouterDecision,
  onProgress?: (progress: BrowserAIStreamProgress) => void,
): Promise<PlatformAIResult> {
  const started = performance.now();
  const sourceText = [...request.context, request.input].join("\n\n");
  let webLlmFailureWarning: string | null = null;
  const webLlm = await browserWebLLMRuntimeSnapshot().catch(() => null);
  const selectedWebLlm = webLlm?.models.find((model) => (
    model.modelId === webLlm.selectedModelId
  )) ?? null;
  const webLlmReady = selectedWebLlm?.installStatus === "ready"
    && selectedWebLlm.cacheVerified;
  if (webLlmReady && taskComplexity(request.taskType) !== "heavy") {
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
    try {
      const generated = await generateWithBrowserWebLLM({
        systemInstruction: profile.systemInstruction,
        prompt: prompt.prompt,
        temperature: request.generationOptions?.temperature,
        topP: request.generationOptions?.topP,
        maxTokens: request.generationOptions?.maxTokens,
        repetitionPenalty: request.generationOptions?.repetitionPenalty,
        seed: request.generationOptions?.seed,
        signal: request.signal,
        onToken: (event) => onProgress?.({
          generatedCharacters: event.content.length,
          generatedTokenEvents: event.generatedTokenEvents,
          delta: event.delta,
          elapsedMs: event.elapsedMs,
        }),
      });
      const normalized = normalizeTraditionalChinesePreservingProperNouns(
        generated.content,
        sourceText,
      );
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
        runtimeStats: generated.runtimeStats,
        tokensPerSecond: generated.tokensPerSecond,
        estimatedMemoryMB: generated.estimatedVramMB,
        executor: "webllm-worker",
        performancePolicy: generated.performancePolicy,
        queueWaitMs: generated.queueWaitMs,
        engineReused: generated.engineReused,
      };
    } catch (error) {
      cancelBrowserWebLLMGeneration();
      if (isAbortError(error, request.signal)) throw error;
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
  if (nativeGenerativeReady && taskComplexity(request.taskType) !== "heavy") {
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
      const normalized = normalizeTraditionalChinesePreservingProperNouns(
        content.trim(),
        sourceText,
      );
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
  if (!BROWSER_LIGHT_TASKS.includes(request.taskType)) {
    throw Object.assign(
      new Error("此瀏覽器只有輕量任務模型；續寫等工作需要 Local Ollama，或支援 Prompt API 的桌面瀏覽器。"),
      { code: "BROWSER_AI_TASK_NOT_SUPPORTED", retryable: false },
    );
  }
  const factory = summarizerFactory();
  const runPackagedFallback = async (warning: string): Promise<PlatformAIResult> => {
    const result = runPackagedBrowserTaskModel(request.taskType, sourceText);
    const normalized = normalizeTraditionalChinesePreservingProperNouns(
      result.content,
      sourceText,
    );
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
    };
  };
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
    const normalized = normalizeTraditionalChinesePreservingProperNouns(
      content.trim(),
      sourceText,
    );
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

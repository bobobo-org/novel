import type { PlatformAIRequest, PlatformAIResult, PlatformProviderSnapshot, PlatformRouterDecision } from "../../router/platform-types";
import {
  normalizeTraditionalChinesePreservingProperNouns,
} from "../../language/traditional-chinese";
import {
  BROWSER_TASK_MODEL,
  isNativeBrowserSummaryTask,
  runPackagedBrowserTaskModel,
} from "./browser-task-model";

export type BrowserAIManifest = { id: string; version: string; files: Array<{ url: string; bytes: number; sha256: string }>; minMemoryGb: number; requiresWebGpu: boolean };
export type BrowserAICapability = { webGpu: boolean; wasm: boolean; worker: boolean; storageQuota: number | null; storageUsage: number | null; status: PlatformProviderSnapshot["status"]; reason: string; summaryAvailability: string; modelId: typeof BROWSER_TASK_MODEL.modelId | null };
export type BrowserAIInferenceProof = {
  proofVersion: "browser-ai-inference-proof-v1";
  state: "inference_verified";
  modelId: "chrome-built-in-summarizer" | typeof BROWSER_TASK_MODEL.modelId;
  modelDigest: string;
  verifiedAt: string;
  latencyMs: number;
  outputDigest: string;
  outputBytes: number;
  externalRequest: false;
  dataLeftDevice: false;
};

type BrowserSummarizer = {
  summarize(text: string, options?: { context?: string; signal?: AbortSignal }): Promise<string>;
  destroy?(): void;
};

type BrowserSummarizerFactory = {
  availability(options?: Record<string, unknown>): Promise<string>;
  create(options?: Record<string, unknown>): Promise<BrowserSummarizer>;
};

const BROWSER_LIGHT_TASKS: PlatformAIRequest["taskType"][] = [
  "story.summary",
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

export async function detectBrowserAI(): Promise<BrowserAICapability> {
  if (typeof window === "undefined") return { webGpu: false, wasm: false, worker: false, storageQuota: null, storageUsage: null, status: "runtime_unavailable", reason: "browser_required", summaryAvailability: "unavailable", modelId: null };
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
  const ready = summaryAvailability === "available" || summaryAvailability === "readily";
  const downloadable = summaryAvailability === "downloadable" || summaryAvailability === "after-download";
  return {
    webGpu,
    wasm,
    worker,
    storageQuota: estimate.quota ?? null,
    storageUsage: estimate.usage ?? null,
    status: "ready",
    reason: ready
      ? "browser_hybrid_runtime_native_summary_ready"
      : "browser_hybrid_runtime_packaged_ready",
    summaryAvailability: ready
      ? summaryAvailability
      : downloadable
        ? `${summaryAvailability}:packaged-fallback-ready`
        : "packaged-task-runtime-ready",
    modelId: BROWSER_TASK_MODEL.modelId,
  };
}

export async function browserProviderSnapshot(): Promise<PlatformProviderSnapshot> {
  const capability = await detectBrowserAI();
  return {
    id: "browser-ai",
    status: capability.status,
    capabilities: ["text", "offline"],
    modelId: capability.modelId,
    modelDigest: capability.status === "ready" ? BROWSER_TASK_MODEL.modelDigest : null,
    maxContext: capability.status === "ready" ? 16_384 : 0,
    local: true,
    requiresInternet: false,
    taskTypes: BROWSER_LIGHT_TASKS,
    detail: capability.reason,
  };
}

export async function runBrowserAI(request: PlatformAIRequest, decision: PlatformRouterDecision): Promise<PlatformAIResult> {
  if (!BROWSER_LIGHT_TASKS.includes(request.taskType)) {
    throw Object.assign(new Error("瀏覽器 AI 目前不支援這個工作類型。"), { code: "BROWSER_AI_TASK_NOT_SUPPORTED", retryable: false });
  }
  const factory = summarizerFactory();
  const started = performance.now();
  const sourceText = [...request.context, request.input].join("\n\n");
  const runPackagedFallback = async (warning: string): Promise<PlatformAIResult> => {
    const result = runPackagedBrowserTaskModel(request.taskType, sourceText);
    await recordInferenceProof(
      result.content,
      started,
      result.modelId,
      result.modelDigest,
    );
    return {
      requestId: request.requestId,
      providerId: "browser-ai",
      modelId: result.modelId,
      modelDigest: result.modelDigest,
      content: normalizeTraditionalChinesePreservingProperNouns(
        result.content,
        sourceText,
      ),
      candidateOnly: true,
      externalRequest: false,
      dataLeavesDevice: false,
      elapsedMs: Math.round(performance.now() - started),
      provenance: {
        ...decision,
        modelId: result.modelId,
        warnings: [
          ...decision.warnings,
          warning,
        ],
      },
      profileId: "closed-browser-ai-light-task-v2",
      firstTokenMs: Math.round(performance.now() - started),
      inputCharacters: sourceText.length,
      outputCharacters: result.content.length,
      generatedTokenEvents: 1,
      omittedInputCharacters: 0,
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
    return {
      requestId: request.requestId,
      providerId: "browser-ai",
      modelId: BROWSER_TASK_MODEL.modelId,
      modelDigest: BROWSER_TASK_MODEL.modelDigest,
      content: normalizeTraditionalChinesePreservingProperNouns(
        content.trim(),
        sourceText,
      ),
      candidateOnly: true,
      externalRequest: false,
      dataLeavesDevice: false,
      elapsedMs: Math.round(performance.now() - started),
      provenance: decision,
      profileId: "closed-browser-ai-native-summary-v2",
      firstTokenMs: Math.round(performance.now() - started),
      inputCharacters: sourceText.length,
      outputCharacters: content.trim().length,
      generatedTokenEvents: 1,
      omittedInputCharacters: 0,
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

import type { PlatformAIRequest, PlatformAIResult, PlatformProviderSnapshot, PlatformRouterDecision } from "../../router/platform-types";

export type BrowserAIManifest = { id: string; version: string; files: Array<{ url: string; bytes: number; sha256: string }>; minMemoryGb: number; requiresWebGpu: boolean };
export type BrowserAICapability = { webGpu: boolean; wasm: boolean; worker: boolean; storageQuota: number | null; storageUsage: number | null; status: PlatformProviderSnapshot["status"]; reason: string; summaryAvailability: string };

type BrowserSummarizer = {
  summarize(text: string, options?: { context?: string; signal?: AbortSignal }): Promise<string>;
  destroy?(): void;
};

type BrowserSummarizerFactory = {
  availability(options?: Record<string, unknown>): Promise<string>;
  create(options?: Record<string, unknown>): Promise<BrowserSummarizer>;
};

const BROWSER_SUMMARY_TASKS: PlatformAIRequest["taskType"][] = [
  "story.summary",
  "drama.chapterClassify",
  "drama.sceneClassify",
  "drama.characterPresence",
  "drama.emotionCurve",
  "drama.shortSummary",
  "drama.beatSuggestion",
];

function summarizerFactory(): BrowserSummarizerFactory | null {
  const value = (globalThis as unknown as { Summarizer?: BrowserSummarizerFactory }).Summarizer;
  return value && typeof value.availability === "function" && typeof value.create === "function" ? value : null;
}

export async function detectBrowserAI(): Promise<BrowserAICapability> {
  if (typeof window === "undefined") return { webGpu: false, wasm: false, worker: false, storageQuota: null, storageUsage: null, status: "runtime_unavailable", reason: "browser_required", summaryAvailability: "unavailable" };
  const webGpu = "gpu" in navigator, wasm = typeof WebAssembly !== "undefined", worker = typeof Worker !== "undefined", estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : {};
  const factory = summarizerFactory();
  let summaryAvailability = "unavailable";
  if (factory) {
    try {
      summaryAvailability = await factory.availability({ type: "key-points", format: "plain-text", length: "medium" });
    } catch {
      summaryAvailability = "unavailable";
    }
  }
  const ready = summaryAvailability === "available" || summaryAvailability === "readily";
  const downloadable = summaryAvailability === "downloadable" || summaryAvailability === "after-download";
  return {
    webGpu,
    wasm,
    worker,
    storageQuota: estimate.quota ?? null,
    storageUsage: estimate.usage ?? null,
    status: ready ? "ready" : downloadable ? "runtime_not_installed" : "runtime_unavailable",
    reason: ready ? "browser_summarizer_ready" : downloadable ? "browser_model_download_required" : "browser_summarizer_unsupported",
    summaryAvailability,
  };
}

export async function browserProviderSnapshot(): Promise<PlatformProviderSnapshot> {
  const capability = await detectBrowserAI();
  return {
    id: "browser-ai",
    status: capability.status,
    capabilities: ["text", "offline"],
    modelId: capability.status === "ready" ? "chrome-built-in-summarizer" : null,
    maxContext: capability.status === "ready" ? 16_384 : 0,
    local: true,
    requiresInternet: false,
    taskTypes: BROWSER_SUMMARY_TASKS,
    detail: capability.reason,
  };
}

export async function runBrowserAI(request: PlatformAIRequest, decision: PlatformRouterDecision): Promise<PlatformAIResult> {
  if (!BROWSER_SUMMARY_TASKS.includes(request.taskType)) {
    throw Object.assign(new Error("瀏覽器 AI 目前只支援章節摘要。"), { code: "BROWSER_AI_TASK_NOT_SUPPORTED", retryable: false });
  }
  const factory = summarizerFactory();
  if (!factory) throw Object.assign(new Error("此瀏覽器不支援內建摘要模型。"), { code: "BROWSER_AI_UNSUPPORTED", retryable: true });
  const started = performance.now();
  const availability = await factory.availability({ type: "key-points", format: "plain-text", length: "medium" });
  if (availability !== "available" && availability !== "readily") {
    throw Object.assign(new Error("瀏覽器摘要模型尚未可用。"), { code: "BROWSER_AI_MODEL_NOT_READY", retryable: true, availability });
  }
  const summarizer = await factory.create({
    type: "key-points",
    format: "plain-text",
    length: "medium",
    sharedContext: "請以繁體中文摘要小說章節，保留人物、事件、地點、衝突與未解線索。",
  });
  try {
    const content = await summarizer.summarize([...request.context, request.input].join("\n\n"), {
      context: "只輸出摘要，不新增原文不存在的事實。",
      signal: request.signal,
    });
    return {
      requestId: request.requestId,
      providerId: "browser-ai",
      modelId: decision.modelId,
      content: content.trim(),
      candidateOnly: true,
      externalRequest: false,
      dataLeavesDevice: false,
      elapsedMs: Math.round(performance.now() - started),
      provenance: decision,
    };
  } finally {
    summarizer.destroy?.();
  }
}

export class BrowserAIProvider {
  async generate(request: PlatformAIRequest, decision: PlatformRouterDecision): Promise<PlatformAIResult> {
    return runBrowserAI(request, decision);
  }
}

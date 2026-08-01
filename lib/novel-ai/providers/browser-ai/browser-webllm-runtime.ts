import type {
  InitProgressReport,
  WebWorkerMLCEngine,
} from "@mlc-ai/web-llm";
import {
  BROWSER_WEBLLM_MODELS,
  browserWebLLMAppConfig,
  browserWebLLMModel,
  chooseBrowserWebLLMCacheBackend,
  detectBrowserWebLLMDevice,
  type BrowserWebLLMCacheBackend,
  type BrowserWebLLMDeviceProfile,
  type BrowserWebLLMModelId,
} from "./webllm-model-registry";
import {
  fitBrowserPromptToBudget,
  resolveBrowserAIPerformancePolicy,
  type BrowserAIPerformancePolicy,
} from "./browser-performance-policy";

const METADATA_DB = "novel-browser-webllm-v1";
const METADATA_STORE = "runtime-records";
const SELECTED_MODEL_KEY = "selected-model";

export type BrowserWebLLMInstallStatus =
  | "not_installed"
  | "installing"
  | "ready"
  | "error";

export type BrowserWebLLMModelMetadata = {
  key: string;
  kind: "model";
  modelId: BrowserWebLLMModelId;
  modelDigest: string;
  sourceRevision: string;
  cacheBackend: BrowserWebLLMCacheBackend;
  installStatus: BrowserWebLLMInstallStatus;
  cacheVerified: boolean;
  installedAt: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
  generationCount?: number;
  averageFirstTokenMs?: number | null;
  averageTokensPerSecond?: number | null;
};

type SelectedModelRecord = {
  key: typeof SELECTED_MODEL_KEY;
  kind: "setting";
  modelId: BrowserWebLLMModelId;
};

type MetadataRecord = BrowserWebLLMModelMetadata | SelectedModelRecord;

export type BrowserWebLLMProgress = {
  modelId: BrowserWebLLMModelId;
  phase: "checking" | "downloading" | "loading" | "ready" | "error";
  progress: number;
  text: string;
};

export type BrowserWebLLMRuntimeSnapshot = {
  runtime: "webllm-worker";
  supported: boolean;
  reason: string;
  device: BrowserWebLLMDeviceProfile;
  cacheBackend: BrowserWebLLMCacheBackend;
  selectedModelId: BrowserWebLLMModelId | null;
  activeModelId: BrowserWebLLMModelId | null;
  lastGeneration: {
    modelId: BrowserWebLLMModelId;
    modelDigest: string;
    completedAt: string;
    elapsedMs: number;
    firstTokenMs: number | null;
    generatedTokenEvents: number;
    tokensPerSecond: number | null;
    gpuVendor: string | null;
    estimatedVramMB: number;
    runtimeStats: string;
    inputCharacters: number;
    outputCharacters: number;
    omittedInputCharacters: number;
    queueWaitMs: number;
    engineReused: boolean;
    performancePolicy: BrowserAIPerformancePolicy;
    externalRequest: false;
    dataLeftDevice: false;
  } | null;
  performance: {
    engineWarm: boolean;
    activeGeneration: boolean;
    queuedGenerations: number;
    engineReuseCount: number;
    warmupCount: number;
    lastWarmupAt: string | null;
    lastWarmupMs: number | null;
    workerExecution: true;
    serialGeneration: true;
  };
  models: Array<{
    modelId: BrowserWebLLMModelId;
    modelDigest: string;
    installStatus: BrowserWebLLMInstallStatus;
    cacheVerified: boolean;
    selected: boolean;
    allowed: boolean;
    installedAt: string | null;
    lastUsedAt: string | null;
    lastError: string | null;
    generationCount: number;
    averageFirstTokenMs: number | null;
    averageTokensPerSecond: number | null;
  }>;
};

export type BrowserWebLLMGenerationInput = {
  systemInstruction: string;
  prompt: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  repetitionPenalty?: number;
  seed?: number;
  signal?: AbortSignal;
  onToken?: (event: {
    delta: string;
    content: string;
    generatedTokenEvents: number;
    elapsedMs: number;
  }) => void;
};

export type BrowserWebLLMGenerationResult = {
  content: string;
  modelId: BrowserWebLLMModelId;
  modelDigest: string;
  firstTokenMs: number | null;
  elapsedMs: number;
  generatedTokenEvents: number;
  runtimeStats: string;
  tokensPerSecond: number | null;
  gpuVendor: string | null;
  estimatedVramMB: number;
  inputCharacters: number;
  outputCharacters: number;
  omittedInputCharacters: number;
  queueWaitMs: number;
  engineReused: boolean;
  performancePolicy: BrowserAIPerformancePolicy;
  externalRequest: false;
  dataLeftDevice: false;
};

let activeEngine: WebWorkerMLCEngine | null = null;
let activeWorker: Worker | null = null;
let activeModelId: BrowserWebLLMModelId | null = null;
let activeCacheBackend: BrowserWebLLMCacheBackend | null = null;
let currentProgress: BrowserWebLLMProgress | null = null;
let lastGeneration: BrowserWebLLMRuntimeSnapshot["lastGeneration"] = null;
let generationTail: Promise<void> = Promise.resolve();
let activeGeneration = false;
let queuedGenerations = 0;
let engineReuseCount = 0;
let warmupCount = 0;
let lastWarmupAt: string | null = null;
let lastWarmupMs: number | null = null;
const progressListeners = new Set<(progress: BrowserWebLLMProgress) => void>();

function runtimeError(code: string, message: string, cause?: unknown) {
  return Object.assign(new Error(message), { code, retryable: true, cause });
}

function openMetadataDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(runtimeError(
      "BROWSER_WEBLLM_INDEXEDDB_UNAVAILABLE",
      "IndexedDB 不可用，無法建立 Browser AI 模型索引。",
    ));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(METADATA_DB, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(METADATA_STORE)) {
        database.createObjectStore(METADATA_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? runtimeError(
      "BROWSER_WEBLLM_INDEXEDDB_OPEN_FAILED",
      "無法開啟 Browser AI 模型索引。",
    ));
  });
}

async function readMetadataRecords(): Promise<MetadataRecord[]> {
  const database = await openMetadataDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(METADATA_STORE, "readonly");
      const request = transaction.objectStore(METADATA_STORE).getAll();
      request.onsuccess = () => resolve(request.result as MetadataRecord[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function putMetadataRecord(record: MetadataRecord) {
  const database = await openMetadataDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(METADATA_STORE, "readwrite");
      transaction.objectStore(METADATA_STORE).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function deleteMetadataRecord(key: string) {
  const database = await openMetadataDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(METADATA_STORE, "readwrite");
      transaction.objectStore(METADATA_STORE).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function modelMetadataKey(modelId: BrowserWebLLMModelId) {
  return `model:${modelId}`;
}

function reportProgress(progress: BrowserWebLLMProgress) {
  currentProgress = progress;
  for (const listener of progressListeners) {
    try {
      listener(progress);
    } catch {
      // Progress observers never participate in the model transaction.
    }
  }
}

function installProgressPhase(report: InitProgressReport): BrowserWebLLMProgress["phase"] {
  const text = report.text.toLowerCase();
  if (report.progress >= 1) return "ready";
  if (/fetch|download|cache|shard|weight/u.test(text)) return "downloading";
  return "loading";
}

function parseTokensPerSecond(runtimeStats: string) {
  const matches = [...runtimeStats.matchAll(/(\d+(?:\.\d+)?)\s*(?:tokens?\s*\/\s*s|tokens?\s*per\s*second)/giu)];
  if (!matches.length) return null;
  return Number(matches.at(-1)?.[1] ?? 0) || null;
}

async function releaseActiveEngine() {
  const engine = activeEngine;
  const worker = activeWorker;
  activeEngine = null;
  activeWorker = null;
  activeModelId = null;
  activeCacheBackend = null;
  try {
    await engine?.unload();
  } finally {
    worker?.terminate();
  }
}

async function createEngine(
  modelId: BrowserWebLLMModelId,
  cacheBackend: BrowserWebLLMCacheBackend,
  onProgress?: (progress: BrowserWebLLMProgress) => void,
  signal?: AbortSignal,
) {
  if (activeEngine && activeModelId === modelId && activeCacheBackend === cacheBackend) {
    return activeEngine;
  }
  await releaseActiveEngine();
  const webllm = await import("@mlc-ai/web-llm");
  const worker = new Worker(
    new URL("./browser-webllm-worker.ts", import.meta.url),
    { type: "module", name: "novel-browser-webllm" },
  );
  if (signal?.aborted) {
    worker.terminate();
    throw new DOMException("已取消模型載入。", "AbortError");
  }
  const publish = (report: InitProgressReport) => {
    const progress: BrowserWebLLMProgress = {
      modelId,
      phase: installProgressPhase(report),
      progress: Math.max(0, Math.min(1, report.progress)),
      text: report.text,
    };
    reportProgress(progress);
    onProgress?.(progress);
  };
  let rejectAbort: ((reason: DOMException) => void) | null = null;
  const abort = () => {
    worker.terminate();
    rejectAbort?.(new DOMException("已取消模型載入。", "AbortError"));
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const createOperation = webllm.CreateWebWorkerMLCEngine(
      worker,
      modelId,
      {
        appConfig: browserWebLLMAppConfig(cacheBackend),
        initProgressCallback: publish,
        logLevel: "WARN",
      },
    );
    const abortOperation = signal
      ? new Promise<never>((_, reject) => {
        rejectAbort = reject;
      })
      : null;
    const engine = await (abortOperation
      ? Promise.race([createOperation, abortOperation])
      : createOperation);
    if (signal?.aborted) {
      worker.terminate();
      throw new DOMException("已取消模型載入。", "AbortError");
    }
    activeEngine = engine;
    activeWorker = worker;
    activeModelId = modelId;
    activeCacheBackend = cacheBackend;
    return engine;
  } catch (error) {
    worker.terminate();
    throw error;
  } finally {
    rejectAbort = null;
    signal?.removeEventListener("abort", abort);
  }
}

export function subscribeBrowserWebLLMProgress(
  listener: (progress: BrowserWebLLMProgress) => void,
) {
  progressListeners.add(listener);
  if (currentProgress) listener(currentProgress);
  return () => progressListeners.delete(listener);
}

export function getBrowserWebLLMProgress() {
  return currentProgress ? { ...currentProgress } : null;
}

export async function browserWebLLMRuntimeSnapshot(): Promise<BrowserWebLLMRuntimeSnapshot> {
  const device = await detectBrowserWebLLMDevice();
  const cacheBackend = chooseBrowserWebLLMCacheBackend(device);
  let records: MetadataRecord[] = [];
  if (device.indexedDb) {
    records = await readMetadataRecords().catch(() => []);
  }
  const selected = records.find((record): record is SelectedModelRecord => (
    record.kind === "setting" && record.key === SELECTED_MODEL_KEY
  ));
  const selectedModelId = browserWebLLMModel(selected?.modelId)
    ? selected!.modelId
    : device.recommendedModelId;
  const modelRecords = new Map(
    records
      .filter((record): record is BrowserWebLLMModelMetadata => record.kind === "model")
      .map((record) => [record.modelId, record]),
  );
  return {
    runtime: "webllm-worker",
    supported: device.supported,
    reason: device.reason,
    device,
    cacheBackend,
    selectedModelId,
    activeModelId,
    lastGeneration: lastGeneration ? { ...lastGeneration } : null,
    performance: {
      engineWarm: Boolean(activeEngine && activeModelId),
      activeGeneration,
      queuedGenerations,
      engineReuseCount,
      warmupCount,
      lastWarmupAt,
      lastWarmupMs,
      workerExecution: true,
      serialGeneration: true,
    },
    models: BROWSER_WEBLLM_MODELS.map((model) => {
      const record = modelRecords.get(model.modelId);
      return {
        modelId: model.modelId,
        modelDigest: model.modelDigest,
        installStatus: record?.installStatus ?? "not_installed",
        cacheVerified: Boolean(record?.cacheVerified),
        selected: selectedModelId === model.modelId,
        allowed: device.allowedModelIds.includes(model.modelId),
        installedAt: record?.installedAt ?? null,
        lastUsedAt: record?.lastUsedAt ?? null,
        lastError: record?.lastError ?? null,
        generationCount: record?.generationCount ?? 0,
        averageFirstTokenMs: record?.averageFirstTokenMs ?? null,
        averageTokensPerSecond: record?.averageTokensPerSecond ?? null,
      };
    }),
  };
}

export async function selectBrowserWebLLMModel(modelId: BrowserWebLLMModelId) {
  const model = browserWebLLMModel(modelId);
  if (!model) throw runtimeError("BROWSER_WEBLLM_MODEL_UNKNOWN", "未知的 Browser AI 模型。");
  await putMetadataRecord({ key: SELECTED_MODEL_KEY, kind: "setting", modelId });
  return browserWebLLMRuntimeSnapshot();
}

export async function installBrowserWebLLMModel(
  modelId: BrowserWebLLMModelId,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: BrowserWebLLMProgress) => void;
  } = {},
) {
  const model = browserWebLLMModel(modelId);
  if (!model) throw runtimeError("BROWSER_WEBLLM_MODEL_UNKNOWN", "未知的 Browser AI 模型。");
  const device = await detectBrowserWebLLMDevice();
  if (!device.supported || !device.allowedModelIds.includes(modelId)) {
    throw runtimeError(
      "BROWSER_WEBLLM_DEVICE_GATE_FAILED",
      "此模型未通過目前裝置的 WebGPU、記憶體與儲存空間 Gate。",
    );
  }
  if (options.signal?.aborted) throw new DOMException("已取消模型安裝。", "AbortError");
  const cacheBackend = chooseBrowserWebLLMCacheBackend(device);
  const installing: BrowserWebLLMModelMetadata = {
    key: modelMetadataKey(modelId),
    kind: "model",
    modelId,
    modelDigest: model.modelDigest,
    sourceRevision: model.sourceRevision,
    cacheBackend,
    installStatus: "installing",
    cacheVerified: false,
    installedAt: null,
    lastUsedAt: null,
    lastError: null,
  };
  await putMetadataRecord(installing);
  reportProgress({
    modelId,
    phase: "checking",
    progress: 0,
    text: "正在檢查模型快取與裝置相容性。",
  });
  try {
    const engine = await createEngine(
      modelId,
      cacheBackend,
      options.onProgress,
      options.signal,
    );
    if (options.signal?.aborted) {
      engine.interruptGenerate();
      throw new DOMException("已取消模型安裝。", "AbortError");
    }
    const webllm = await import("@mlc-ai/web-llm");
    const cacheVerified = await webllm.hasModelInCache(
      modelId,
      browserWebLLMAppConfig(cacheBackend),
    );
    if (!cacheVerified) {
      throw runtimeError(
        "BROWSER_WEBLLM_CACHE_INCOMPLETE",
        "模型已載入，但離線權重快取尚未完整，未標記為可離線使用。",
      );
    }
    const installedAt = new Date().toISOString();
    await putMetadataRecord({
      ...installing,
      installStatus: "ready",
      cacheVerified: true,
      installedAt,
    });
    await putMetadataRecord({ key: SELECTED_MODEL_KEY, kind: "setting", modelId });
    reportProgress({ modelId, phase: "ready", progress: 1, text: "模型已安裝並完成快取驗證。" });
    return browserWebLLMRuntimeSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await putMetadataRecord({
      ...installing,
      installStatus: "error",
      lastError: message.slice(0, 300),
    });
    reportProgress({ modelId, phase: "error", progress: 0, text: message });
    throw runtimeError("BROWSER_WEBLLM_INSTALL_FAILED", "Browser AI 模型安裝失敗。", error);
  }
}

export async function deleteBrowserWebLLMModel(modelId: BrowserWebLLMModelId) {
  const model = browserWebLLMModel(modelId);
  if (!model) throw runtimeError("BROWSER_WEBLLM_MODEL_UNKNOWN", "未知的 Browser AI 模型。");
  const snapshot = await browserWebLLMRuntimeSnapshot();
  if (activeModelId === modelId) await releaseActiveEngine();
  const webllm = await import("@mlc-ai/web-llm");
  await webllm.deleteModelAllInfoInCache(
    modelId,
    browserWebLLMAppConfig(snapshot.cacheBackend),
  );
  await deleteMetadataRecord(modelMetadataKey(modelId));
  if (snapshot.selectedModelId === modelId) {
    await deleteMetadataRecord(SELECTED_MODEL_KEY);
  }
  if (lastGeneration?.modelId === modelId) lastGeneration = null;
  currentProgress = null;
  return browserWebLLMRuntimeSnapshot();
}

export function cancelBrowserWebLLMGeneration() {
  activeEngine?.interruptGenerate();
}

async function readyModel(signal?: AbortSignal) {
  const snapshot = await browserWebLLMRuntimeSnapshot();
  const modelId = snapshot.selectedModelId;
  const state = snapshot.models.find((model) => model.modelId === modelId);
  if (!modelId || state?.installStatus !== "ready" || !state.cacheVerified) {
    throw runtimeError(
      "BROWSER_WEBLLM_MODEL_NOT_INSTALLED",
      "尚未安裝可離線使用的 Browser AI 生成模型。",
    );
  }
  const model = browserWebLLMModel(modelId)!;
  const engineReused = Boolean(
    activeEngine
    && activeModelId === modelId
    && activeCacheBackend === snapshot.cacheBackend,
  );
  const engine = await createEngine(modelId, snapshot.cacheBackend, undefined, signal);
  return { snapshot, model, engine, engineReused };
}

export async function prewarmBrowserWebLLMModel(signal?: AbortSignal) {
  const started = performance.now();
  const { model, engineReused } = await readyModel(signal);
  if (signal?.aborted) throw new DOMException("已取消模型預熱。", "AbortError");
  lastWarmupMs = Math.round(performance.now() - started);
  lastWarmupAt = new Date().toISOString();
  warmupCount += 1;
  if (engineReused) engineReuseCount += 1;
  return {
    modelId: model.modelId,
    engineReused,
    warmupMs: lastWarmupMs,
    snapshot: await browserWebLLMRuntimeSnapshot(),
  };
}

async function runBrowserWebLLMGeneration(
  input: BrowserWebLLMGenerationInput,
  queueWaitMs: number,
): Promise<BrowserWebLLMGenerationResult> {
  const started = performance.now();
  const { snapshot, model, engine, engineReused } = await readyModel(input.signal);
  if (input.signal?.aborted) throw new DOMException("已取消生成。", "AbortError");
  if (engineReused) engineReuseCount += 1;
  const previousTelemetry = snapshot.models.find((item) => item.modelId === model.modelId);
  const performancePolicy = resolveBrowserAIPerformancePolicy({
    device: snapshot.device,
    model,
    requestedMaxTokens: input.maxTokens,
    requestedTemperature: input.temperature,
    requestedTopP: input.topP,
    requestedRepetitionPenalty: input.repetitionPenalty,
    previousTokensPerSecond: previousTelemetry?.averageTokensPerSecond,
  });
  const systemCharacters = input.systemInstruction.length;
  const promptBudget = Math.max(600, performancePolicy.maxInputCharacters - systemCharacters);
  const fittedPrompt = fitBrowserPromptToBudget(input.prompt, promptBudget);
  const interrupt = () => engine.interruptGenerate();
  input.signal?.addEventListener("abort", interrupt, { once: true });
  let content = "";
  let generatedTokenEvents = 0;
  let firstTokenMs: number | null = null;
  try {
    const chunks = await engine.chat.completions.create({
      model: model.modelId,
      messages: [
        { role: "system", content: input.systemInstruction },
        { role: "user", content: fittedPrompt.prompt },
      ],
      stream: true,
      stream_options: { include_usage: true },
      temperature: performancePolicy.temperature,
      top_p: performancePolicy.topP,
      max_tokens: performancePolicy.maxOutputTokens,
      repetition_penalty: performancePolicy.repetitionPenalty,
      seed: input.seed,
    });
    for await (const chunk of chunks) {
      if (input.signal?.aborted) {
        engine.interruptGenerate();
        throw new DOMException("已取消生成。", "AbortError");
      }
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (!delta) continue;
      if (firstTokenMs === null) firstTokenMs = Math.round(performance.now() - started);
      content += delta;
      generatedTokenEvents += 1;
      input.onToken?.({
        delta,
        content,
        generatedTokenEvents,
        elapsedMs: Math.round(performance.now() - started),
      });
    }
    const trimmed = content.trim();
    if (!trimmed) {
      throw runtimeError("BROWSER_WEBLLM_EMPTY_RESPONSE", "Browser AI 沒有產生可用內容。");
    }
    const [runtimeStats, gpuVendor] = await Promise.all([
      engine.runtimeStatsText(model.modelId).catch(() => ""),
      engine.getGPUVendor().catch(() => ""),
    ]);
    const records = await readMetadataRecords();
    const metadata = records.find((record): record is BrowserWebLLMModelMetadata => (
      record.kind === "model" && record.modelId === model.modelId
    ));
    if (metadata) {
      const generationCount = (metadata.generationCount ?? 0) + 1;
      const rolling = (previous: number | null | undefined, next: number | null) => {
        if (next === null) return previous ?? null;
        if (previous === null || previous === undefined) return next;
        return Math.round(((previous * (generationCount - 1)) + next) / generationCount * 100) / 100;
      };
      const tokensPerSecond = parseTokensPerSecond(runtimeStats);
      await putMetadataRecord({
        ...metadata,
        lastUsedAt: new Date().toISOString(),
        generationCount,
        averageFirstTokenMs: rolling(metadata.averageFirstTokenMs, firstTokenMs),
        averageTokensPerSecond: rolling(metadata.averageTokensPerSecond, tokensPerSecond),
      });
    }
    const result: BrowserWebLLMGenerationResult = {
      content: trimmed,
      modelId: model.modelId,
      modelDigest: model.modelDigest,
      firstTokenMs,
      elapsedMs: Math.round(performance.now() - started),
      generatedTokenEvents,
      runtimeStats,
      tokensPerSecond: parseTokensPerSecond(runtimeStats),
      gpuVendor: gpuVendor || null,
      estimatedVramMB: model.estimatedVramMB,
      inputCharacters: systemCharacters + fittedPrompt.prompt.length,
      outputCharacters: trimmed.length,
      omittedInputCharacters: fittedPrompt.omittedCharacters,
      queueWaitMs,
      engineReused,
      performancePolicy,
      externalRequest: false,
      dataLeftDevice: false,
    };
    lastGeneration = {
      modelId: result.modelId,
      modelDigest: result.modelDigest,
      completedAt: new Date().toISOString(),
      elapsedMs: result.elapsedMs,
      firstTokenMs: result.firstTokenMs,
      generatedTokenEvents: result.generatedTokenEvents,
      tokensPerSecond: result.tokensPerSecond,
      gpuVendor: result.gpuVendor,
      estimatedVramMB: result.estimatedVramMB,
      runtimeStats: result.runtimeStats,
      inputCharacters: result.inputCharacters,
      outputCharacters: result.outputCharacters,
      omittedInputCharacters: result.omittedInputCharacters,
      queueWaitMs: result.queueWaitMs,
      engineReused: result.engineReused,
      performancePolicy: result.performancePolicy,
      externalRequest: false,
      dataLeftDevice: false,
    };
    return result;
  } finally {
    input.signal?.removeEventListener("abort", interrupt);
  }
}

export function generateWithBrowserWebLLM(
  input: BrowserWebLLMGenerationInput,
): Promise<BrowserWebLLMGenerationResult> {
  const enqueuedAt = performance.now();
  queuedGenerations += 1;
  const operation = generationTail.then(async () => {
    queuedGenerations = Math.max(0, queuedGenerations - 1);
    activeGeneration = true;
    try {
      if (input.signal?.aborted) throw new DOMException("已取消生成。", "AbortError");
      return await runBrowserWebLLMGeneration(
        input,
        Math.round(performance.now() - enqueuedAt),
      );
    } finally {
      activeGeneration = false;
    }
  });
  generationTail = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function resetBrowserWebLLMForTests() {
  await releaseActiveEngine();
  currentProgress = null;
  lastGeneration = null;
  generationTail = Promise.resolve();
  activeGeneration = false;
  queuedGenerations = 0;
  engineReuseCount = 0;
  warmupCount = 0;
  lastWarmupAt = null;
  lastWarmupMs = null;
  progressListeners.clear();
}

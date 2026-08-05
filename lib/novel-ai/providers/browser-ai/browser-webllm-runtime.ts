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
  estimateBrowserTokens,
  fitBrowserPromptToTokenBudget,
  resolveBrowserAIPerformancePolicy,
  type BrowserAIPerformancePolicy,
} from "./browser-performance-policy";
import {
  inspectBrowserModelShardCache,
  verifyBrowserModelShards,
} from "./browser-model-installer";
import { BrowserGPUQueue } from "./browser-gpu-queue";

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
  shardIntegrityVerified: boolean;
  shardManifestDigest: string | null;
  shardVerifiedAt: string | null;
  verifiedShardCount: number;
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
  phase: "checking" | "downloading" | "loading" | "verifying" | "ready" | "error";
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
    workerRestartCount: number;
    gpuDeviceLostCount: number;
    rejectedForBackpressure: number;
    activeMemoryBudgetMB: number;
  };
  models: Array<{
    modelId: BrowserWebLLMModelId;
    modelDigest: string;
    installStatus: BrowserWebLLMInstallStatus;
    cacheVerified: boolean;
    shardIntegrityVerified: boolean;
    shardManifestDigest: string | null;
    shardVerifiedAt: string | null;
    verifiedShardCount: number;
    cachedShardCount: number;
    expectedShardCount: number;
    cachedBytes: number;
    cachePresent: boolean;
    cacheComplete: boolean;
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
  jsonMode?: boolean;
  jsonSchema?: Record<string, unknown>;
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
let activeGeneration = false;
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
  if (/from cache|cache\[/u.test(text)) return "loading";
  if (/fetch|download/u.test(text)) return "downloading";
  return "loading";
}

export function browserWebLLMProgressText(report: Pick<InitProgressReport, "text">) {
  if (/from cache|cache\[/iu.test(report.text)) {
    return `正在從此裝置快取載入顯存（不重新下載）· ${report.text}`;
  }
  if (/fetch|download/iu.test(report.text)) {
    return `正在下載缺少的模型檔案 · ${report.text}`;
  }
  return report.text;
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

function createGPUQueue() {
  return new BrowserGPUQueue({
    maxQueuedJobs: 8,
    maxMemoryMB: 4_096,
    // Keep the selected 0.5B/1.5B engine warm long enough for a writing
    // session. Switching models still unloads GPU memory immediately, while
    // CacheStorage remains untouched.
    idleReleaseMs: 600_000,
    onRecover: releaseActiveEngine,
    onIdleRelease: releaseActiveEngine,
  });
}

let gpuQueue = createGPUQueue();

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
      text: browserWebLLMProgressText(report),
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
  const persistedModel = browserWebLLMModel(selected?.modelId);
  const selectedModelId = persistedModel?.productionQualified
    && device.allowedModelIds.includes(persistedModel.modelId)
    ? persistedModel.modelId
    : device.recommendedModelId;
  const modelRecords = new Map(
    records
      .filter((record): record is BrowserWebLLMModelMetadata => record.kind === "model")
      .map((record) => [record.modelId, record]),
  );
  const cacheInspections = new Map(
    await Promise.all(
      BROWSER_WEBLLM_MODELS.map(async (model) => [
        model.modelId,
        await inspectBrowserModelShardCache(model.modelId).catch(() => ({
          modelId: model.modelId,
          shardCount: 0,
          cachedShardCount: 0,
          totalBytes: 0,
          cachedBytes: 0,
          complete: false,
        })),
      ] as const),
    ),
  );
  const queue = gpuQueue.snapshot();
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
      activeGeneration: Boolean(queue.activeJobId) || activeGeneration,
      queuedGenerations: queue.queuedJobs,
      engineReuseCount,
      warmupCount,
      lastWarmupAt,
      lastWarmupMs,
      workerExecution: true,
      serialGeneration: true,
      workerRestartCount: queue.workerRestartCount,
      gpuDeviceLostCount: queue.gpuDeviceLostCount,
      rejectedForBackpressure: queue.rejectedForBackpressure,
      activeMemoryBudgetMB: queue.activeMemoryBudgetMB,
    },
    models: BROWSER_WEBLLM_MODELS.map((model) => {
      const record = modelRecords.get(model.modelId);
      const cache = cacheInspections.get(model.modelId)!;
      const verifiedForCurrentCache = Boolean(
        record?.cacheVerified
        && record.cacheBackend === cacheBackend
        && record.shardIntegrityVerified
        && cache.complete,
      );
      return {
        modelId: model.modelId,
        modelDigest: model.modelDigest,
        installStatus: record?.installStatus === "ready"
          && verifiedForCurrentCache
          ? "ready"
          : record?.installStatus === "installing"
            ? "installing"
            : record?.installStatus === "error"
              ? "error"
              : "not_installed",
        cacheVerified: verifiedForCurrentCache,
        shardIntegrityVerified: Boolean(record?.shardIntegrityVerified),
        shardManifestDigest: record?.shardManifestDigest ?? null,
        shardVerifiedAt: record?.shardVerifiedAt ?? null,
        verifiedShardCount: record?.verifiedShardCount ?? 0,
        cachedShardCount: cache.cachedShardCount,
        expectedShardCount: cache.shardCount,
        cachedBytes: cache.cachedBytes,
        cachePresent: cache.cachedShardCount > 0,
        cacheComplete: cache.complete,
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
  const device = await detectBrowserWebLLMDevice();
  if (!model.productionQualified || !device.allowedModelIds.includes(modelId)) {
    throw runtimeError(
      "BROWSER_WEBLLM_DEVICE_GATE_FAILED",
      model.usePolicy === "research-only"
        ? "此模型授權僅限研究，正式版不會啟用。"
        : "此模型未通過目前裝置 Gate。",
    );
  }
  await putMetadataRecord({ key: SELECTED_MODEL_KEY, kind: "setting", modelId });
  return browserWebLLMRuntimeSnapshot();
}

/**
 * Repairs legacy metadata from a complete local cache. This path performs no
 * download and is therefore safe to run automatically on page startup.
 */
export async function repairSelectedBrowserWebLLMCache(options: {
  onProgress?: (progress: BrowserWebLLMProgress) => void;
} = {}) {
  const snapshot = await browserWebLLMRuntimeSnapshot();
  const modelId = snapshot.selectedModelId;
  const state = snapshot.models.find((item) => item.modelId === modelId);
  const model = browserWebLLMModel(modelId);
  if (
    !modelId
    || !model
    || !model.productionQualified
    || !state?.allowed
    || state.installStatus === "ready"
    || !state.cacheComplete
  ) {
    return snapshot;
  }
  const existing = (await readMetadataRecords()).find(
    (record): record is BrowserWebLLMModelMetadata => (
      record.kind === "model" && record.modelId === modelId
    ),
  );
  const cacheBackend = snapshot.cacheBackend;
  const webllm = await import("@mlc-ai/web-llm");
  if (!await webllm.hasModelInCache(
    modelId,
    browserWebLLMAppConfig(cacheBackend),
  )) {
    return snapshot;
  }
  const checking: BrowserWebLLMProgress = {
    modelId,
    phase: "verifying",
    progress: 0,
    text: "偵測到完整本機快取，正在一次性恢復驗證（不重新下載）。",
  };
  reportProgress(checking);
  options.onProgress?.(checking);
  const verification = await verifyBrowserModelShards({
    modelId,
    onProgress: (progress) => {
      const update: BrowserWebLLMProgress = {
        modelId,
        phase: "verifying",
        progress: progress.verifiedShardCount / progress.shardCount,
        text: `從本機快取驗證 ${progress.verifiedShardCount}/${progress.shardCount}（0 網路下載）`,
      };
      reportProgress(update);
      options.onProgress?.(update);
    },
  });
  if (!verification.verified) return browserWebLLMRuntimeSnapshot();
  await putMetadataRecord({
    key: modelMetadataKey(modelId),
    kind: "model",
    modelId,
    modelDigest: model.modelDigest,
    sourceRevision: model.sourceRevision,
    cacheBackend,
    installStatus: "ready",
    cacheVerified: true,
    shardIntegrityVerified: true,
    shardManifestDigest: verification.manifestDigest,
    shardVerifiedAt: verification.verifiedAt,
    verifiedShardCount: verification.verifiedShardCount,
    installedAt: existing?.installedAt ?? new Date().toISOString(),
    lastUsedAt: existing?.lastUsedAt ?? null,
    lastError: null,
    generationCount: existing?.generationCount ?? 0,
    averageFirstTokenMs: existing?.averageFirstTokenMs ?? null,
    averageTokensPerSecond: existing?.averageTokensPerSecond ?? null,
  });
  const ready: BrowserWebLLMProgress = {
    modelId,
    phase: "ready",
    progress: 1,
    text: "本機模型快取已恢復並通過完整性驗證；不需重新下載。",
  };
  reportProgress(ready);
  options.onProgress?.(ready);
  return browserWebLLMRuntimeSnapshot();
}

export async function installBrowserWebLLMModel(
  modelId: BrowserWebLLMModelId,
  options: {
    userInitiated: true;
    signal?: AbortSignal;
    onProgress?: (progress: BrowserWebLLMProgress) => void;
  },
) {
  if (options.userInitiated !== true) {
    throw Object.assign(new Error("Browser model installation requires an explicit user action."), {
      code: "BROWSER_MODEL_EXPLICIT_INSTALL_REQUIRED",
      automaticDownloadAllowed: false,
    });
  }
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
  const previous = (await readMetadataRecords()).find(
    (record): record is BrowserWebLLMModelMetadata => (
      record.kind === "model" && record.modelId === modelId
    ),
  );
  await navigator.storage?.persist?.().catch(() => false);
  const installing: BrowserWebLLMModelMetadata = {
    key: modelMetadataKey(modelId),
    kind: "model",
    modelId,
    modelDigest: model.modelDigest,
    sourceRevision: model.sourceRevision,
    cacheBackend,
    installStatus: "installing",
    cacheVerified: false,
    shardIntegrityVerified: false,
    shardManifestDigest: null,
    shardVerifiedAt: null,
    verifiedShardCount: 0,
    installedAt: previous?.installedAt ?? null,
    lastUsedAt: previous?.lastUsedAt ?? null,
    lastError: null,
    generationCount: previous?.generationCount ?? 0,
    averageFirstTokenMs: previous?.averageFirstTokenMs ?? null,
    averageTokensPerSecond: previous?.averageTokensPerSecond ?? null,
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
    reportProgress({
      modelId,
      phase: "verifying",
      progress: 0.96,
      text: "正在逐一驗證不可變模型權重分片。",
    });
    const shardVerification = await verifyBrowserModelShards({
      modelId,
      signal: options.signal,
      onProgress: (progress) => {
        const update: BrowserWebLLMProgress = {
          modelId,
          phase: "verifying",
          progress: Math.min(
            0.999,
            0.96 + (progress.verifiedShardCount / progress.shardCount) * 0.039,
          ),
          text: `驗證 ${progress.shardPath}（${progress.verifiedShardCount}/${progress.shardCount}）`,
        };
        reportProgress(update);
        options.onProgress?.(update);
      },
    });
    if (!shardVerification.verified) {
      await releaseActiveEngine();
      await webllm.deleteModelAllInfoInCache(
        modelId,
        browserWebLLMAppConfig(cacheBackend),
      );
      throw Object.assign(
        new Error("模型權重分片完整性驗證失敗，失敗快取已隔離並刪除。"),
        {
          code: "MODEL_INTEGRITY_FAILED",
          failures: shardVerification.failures.map((failure) => ({
            path: failure.path,
            reason: failure.reason,
          })),
        },
      );
    }
    const installedAt = new Date().toISOString();
    await putMetadataRecord({
      ...installing,
      installStatus: "ready",
      cacheVerified: true,
      shardIntegrityVerified: true,
      shardManifestDigest: shardVerification.manifestDigest,
      shardVerifiedAt: shardVerification.verifiedAt,
      verifiedShardCount: shardVerification.verifiedShardCount,
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
    if ((error as { code?: unknown } | null)?.code === "MODEL_INTEGRITY_FAILED") {
      throw error;
    }
    throw runtimeError("BROWSER_WEBLLM_INSTALL_FAILED", "Browser AI 模型安裝失敗。", error);
  }
}

export async function deleteBrowserWebLLMModel(
  modelId: BrowserWebLLMModelId,
  options: { userConfirmed: true },
) {
  if (options.userConfirmed !== true) {
    throw Object.assign(new Error("Browser model deletion requires explicit user confirmation."), {
      code: "BROWSER_MODEL_DELETION_CONFIRMATION_REQUIRED",
    });
  }
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
  if (
    !modelId
    || state?.installStatus !== "ready"
    || !state.cacheVerified
    || !state.shardIntegrityVerified
    || !state.allowed
  ) {
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
    mode: typeof document !== "undefined" && document.visibilityState === "hidden"
      ? "ECO"
      : undefined,
    requestedMaxTokens: input.maxTokens,
    requestedTemperature: input.temperature,
    requestedTopP: input.topP,
    requestedRepetitionPenalty: input.repetitionPenalty,
    previousTokensPerSecond: previousTelemetry?.averageTokensPerSecond,
  });
  const systemTokens = estimateBrowserTokens(input.systemInstruction);
  const promptBudget = Math.max(
    128,
    performancePolicy.inputBudgetTokens - systemTokens,
  );
  const fittedPrompt = fitBrowserPromptToTokenBudget(input.prompt, promptBudget);
  const interrupt = () => engine.interruptGenerate();
  input.signal?.addEventListener("abort", interrupt, { once: true });
  let content = "";
  let generatedTokenEvents = 0;
  let firstTokenMs: number | null = null;
  try {
    const structuredInstruction = input.jsonMode
      ? `\n\nReturn one JSON value only. It must satisfy this JSON Schema:\n${JSON.stringify(input.jsonSchema ?? { type: "object" })}`
      : "";
    const chunks = await engine.chat.completions.create({
      model: model.modelId,
      messages: [
        { role: "system", content: `${input.systemInstruction}${structuredInstruction}` },
        { role: "user", content: fittedPrompt.prompt },
      ],
      response_format: input.jsonMode
        ? { type: "json_object", schema: JSON.stringify(input.jsonSchema ?? { type: "object" }) }
        : { type: "text" },
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
      inputCharacters: input.systemInstruction.length + structuredInstruction.length + fittedPrompt.prompt.length,
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

export async function generateWithBrowserWebLLM(
  input: BrowserWebLLMGenerationInput,
): Promise<BrowserWebLLMGenerationResult> {
  const enqueuedAt = performance.now();
  const snapshot = await browserWebLLMRuntimeSnapshot();
  const selected = BROWSER_WEBLLM_MODELS.find(
    (model) => model.modelId === snapshot.selectedModelId,
  );
  if (!selected) {
    throw runtimeError(
      "BROWSER_WEBLLM_MODEL_NOT_SELECTED",
      "尚未選擇可執行的 Browser AI 模型。",
    );
  }
  return gpuQueue.enqueue({
    id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `browser-generation-${Date.now()}`,
    priority: typeof document !== "undefined" && document.visibilityState === "hidden"
      ? "background"
      : "interactive",
    timeoutMs: 180_000,
    memoryBudgetMB: selected.estimatedVramMB,
    signal: input.signal,
    execute: async ({ signal }) => {
      activeGeneration = true;
      try {
        if (signal.aborted) {
          throw new DOMException("已取消生成。", "AbortError");
        }
        return await runBrowserWebLLMGeneration(
          { ...input, signal },
          Math.round(performance.now() - enqueuedAt),
        );
      } finally {
        activeGeneration = false;
      }
    },
  });
}

export async function resetBrowserWebLLMForTests() {
  await releaseActiveEngine();
  currentProgress = null;
  lastGeneration = null;
  gpuQueue = createGPUQueue();
  activeGeneration = false;
  engineReuseCount = 0;
  warmupCount = 0;
  lastWarmupAt = null;
  lastWarmupMs = null;
  progressListeners.clear();
}

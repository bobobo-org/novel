import type { ClosedAINamespace } from "../../closed-ai-cache";
import { sha256Hex, stableStringify } from "../../closed-ai-cache";
import {
  BROWSER_SEMANTIC_CACHE_KEY,
  BROWSER_SEMANTIC_MODEL,
  detectBrowserSemanticDevice,
  semanticModelFileUrl,
  type BrowserSemanticDevice,
  type BrowserSemanticDeviceProfile,
} from "./browser-semantic-model-registry";

const METADATA_DB = "novel-browser-semantic-v1";
const METADATA_STORE = "runtime-records";
const RANK_CACHE_STORE = "rank-cache";
const MODEL_RECORD_KEY = "semantic-model";
const DEFAULT_RANK_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const BROWSER_SEMANTIC_RUNTIME_REVISION = "browser-semantic-runtime-v3";

export type BrowserSemanticInstallStatus =
  | "not_installed"
  | "installing"
  | "ready"
  | "error";

type BrowserSemanticModelRecord = {
  key: typeof MODEL_RECORD_KEY;
  runtimeRevision?: string;
  installStatus: BrowserSemanticInstallStatus;
  modelId: typeof BROWSER_SEMANTIC_MODEL.modelId;
  modelDigest: typeof BROWSER_SEMANTIC_MODEL.modelDigest;
  sourceRevision: typeof BROWSER_SEMANTIC_MODEL.sourceRevision;
  device: BrowserSemanticDevice | null;
  cacheVerified: boolean;
  installedAt: string | null;
  lastUsedAt: string | null;
  lastErrorCode?: string | null;
  lastError: string | null;
};

type BrowserSemanticRankCacheRecord = {
  key: string;
  namespace: ClosedAINamespace;
  modelId: typeof BROWSER_SEMANTIC_MODEL.modelId;
  modelDigest: typeof BROWSER_SEMANTIC_MODEL.modelDigest;
  queryDigest: string;
  itemDigest: string;
  scores: Array<{ id: string; score: number }>;
  createdAt: string;
  expiresAt: string;
  hitCount: number;
  candidateOnly: true;
  memoryMutation: false;
  learningMutation: false;
  canonicalMutation: false;
  rawTextStored: false;
};

export type BrowserSemanticProgress = {
  phase: "checking" | "downloading" | "loading" | "verifying" | "ready" | "error";
  progress: number;
  text: string;
  loadedBytes: number | null;
  totalBytes: number | null;
};

export type BrowserSemanticRuntimeSnapshot = {
  runtime: "transformers-js-worker";
  supported: boolean;
  reason: string;
  device: BrowserSemanticDeviceProfile;
  model: {
    modelId: typeof BROWSER_SEMANTIC_MODEL.modelId;
    modelDigest: typeof BROWSER_SEMANTIC_MODEL.modelDigest;
    sourceRevision: typeof BROWSER_SEMANTIC_MODEL.sourceRevision;
    runtimeRevision: string | null;
    repairRequired: boolean;
    installStatus: BrowserSemanticInstallStatus;
    device: BrowserSemanticDevice | null;
    cacheVerified: boolean;
    active: boolean;
    installedAt: string | null;
    lastUsedAt: string | null;
    lastErrorCode: string | null;
    lastError: string | null;
  };
  cache: {
    backend: "CacheStorage+IndexedDB";
    entries: number;
    candidateOnly: true;
    rawTextStored: false;
    canonicalMutation: false;
  };
  lastRanking: {
    completedAt: string;
    elapsedMs: number;
    items: number;
    cacheHit: boolean;
    device: BrowserSemanticDevice;
    dataLeftDevice: false;
  } | null;
};

export type BrowserSemanticRankInput = {
  namespace: ClosedAINamespace;
  query: string;
  items: Array<{ id: string; text: string; priority?: number }>;
  ttlMs?: number;
  signal?: AbortSignal;
};

export type BrowserSemanticRankResult = {
  scores: Array<{ id: string; score: number; priority: number }>;
  modelId: typeof BROWSER_SEMANTIC_MODEL.modelId;
  modelDigest: typeof BROWSER_SEMANTIC_MODEL.modelDigest;
  device: BrowserSemanticDevice;
  elapsedMs: number;
  cacheHit: boolean;
  cacheLayer: "semantic";
  candidateOnly: true;
  externalRequest: false;
  dataLeftDevice: false;
  rawTextStored: false;
  canonicalMutation: false;
};

export type BrowserSemanticEmbeddingResult = {
  vectors: number[][];
  dimensions: number;
  modelId: typeof BROWSER_SEMANTIC_MODEL.modelId;
  modelDigest: typeof BROWSER_SEMANTIC_MODEL.modelDigest;
  device: BrowserSemanticDevice;
  externalRequest: false;
  dataLeftDevice: false;
  rawTextStored: false;
};

type WorkerPending = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
  onProgress?: (progress: BrowserSemanticProgress) => void;
};

let activeWorker: Worker | null = null;
let activeDevice: BrowserSemanticDevice | null = null;
let currentProgress: BrowserSemanticProgress | null = null;
let lastRanking: BrowserSemanticRuntimeSnapshot["lastRanking"] = null;
const pending = new Map<string, WorkerPending>();
const progressListeners = new Set<(progress: BrowserSemanticProgress) => void>();

function runtimeError(code: string, message: string, cause?: unknown) {
  return Object.assign(new Error(message), { code, retryable: true, cause });
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(runtimeError(
      "BROWSER_SEMANTIC_INDEXEDDB_UNAVAILABLE",
      "IndexedDB 無法使用，不能安全保存 Browser AI 語意模型狀態。",
    ));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(METADATA_DB, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(METADATA_STORE)) {
        database.createObjectStore(METADATA_STORE, { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains(RANK_CACHE_STORE)) {
        database.createObjectStore(RANK_CACHE_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? runtimeError(
      "BROWSER_SEMANTIC_INDEXEDDB_OPEN_FAILED",
      "無法開啟 Browser AI 語意索引。",
    ));
  });
}

async function getRecord<T>(storeName: string, key: string): Promise<T | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function getAllRecords<T>(storeName: string): Promise<T[]> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function putRecord(storeName: string, record: object) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function deleteRecords(storeName: string, keys: string[]) {
  if (!keys.length) return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      for (const key of keys) store.delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function publishProgress(progress: BrowserSemanticProgress) {
  currentProgress = progress;
  for (const listener of progressListeners) {
    try {
      listener(progress);
    } catch {
      // Progress observers never participate in the model transaction.
    }
  }
}

function transformerProgress(value: unknown): BrowserSemanticProgress {
  const progress = value as {
    status?: string;
    file?: string;
    progress?: number;
    loaded?: number;
    total?: number;
  };
  const raw = Number(progress.progress ?? 0);
  const normalized = raw > 1 ? raw / 100 : raw;
  const ready = progress.status === "ready";
  const downloading = progress.status === "download" || progress.status === "progress"
    || progress.status === "progress_total";
  return {
    phase: ready ? "ready" : downloading ? "downloading" : "loading",
    progress: ready ? 1 : Math.max(0, Math.min(0.94, normalized * 0.94)),
    text: progress.file
      ? `${progress.status ?? "loading"}: ${progress.file}`
      : progress.status ?? "loading",
    loadedBytes: Number.isFinite(progress.loaded) ? Number(progress.loaded) : null,
    totalBytes: Number.isFinite(progress.total) ? Number(progress.total) : null,
  };
}

function releaseWorker(
  reason = "BROWSER_SEMANTIC_WORKER_RELEASED",
  message = "Browser AI 語意工作已停止。",
) {
  activeWorker?.terminate();
  activeWorker = null;
  activeDevice = null;
  for (const operation of pending.values()) {
    operation.reject(runtimeError(reason, message));
  }
  pending.clear();
}

function ensureWorker(device: BrowserSemanticDevice) {
  if (activeWorker && activeDevice === device) return activeWorker;
  releaseWorker();
  const worker = new Worker(
    new URL("./browser-semantic-worker.ts", import.meta.url),
    { type: "module", name: "novel-browser-semantic" },
  );
  worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
    const id = String(event.data.id ?? "");
    const operation = pending.get(id);
    if (!operation) return;
    if (event.data.type === "progress") {
      const progress = transformerProgress(event.data.progress);
      publishProgress(progress);
      operation.onProgress?.(progress);
      return;
    }
    pending.delete(id);
    if (event.data.type === "error") {
      const message = String(
        event.data.message
        ?? event.data.code
        ?? "Browser AI 語意模型執行失敗。",
      );
      operation.reject(runtimeError(
        String(event.data.code ?? "BROWSER_SEMANTIC_WORKER_FAILED"),
        message,
      ));
      return;
    }
    operation.resolve(event.data);
  };
  worker.onerror = (event) => releaseWorker(
    "BROWSER_SEMANTIC_WORKER_CRASHED",
    event.message || "Browser AI 語意 Worker 發生未處理錯誤。",
  );
  worker.onmessageerror = () => releaseWorker(
    "BROWSER_SEMANTIC_WORKER_MESSAGE_FAILED",
    "Browser AI 語意 Worker 回傳了無法解析的訊息。",
  );
  activeWorker = worker;
  activeDevice = device;
  return worker;
}

function requestWorker(
  device: BrowserSemanticDevice,
  request: Record<string, unknown>,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: BrowserSemanticProgress) => void;
  } = {},
) {
  if (options.signal?.aborted) {
    return Promise.reject(new DOMException("操作已取消。", "AbortError"));
  }
  const worker = ensureWorker(device);
  const id = crypto.randomUUID();
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const abort = () => {
      pending.delete(id);
      releaseWorker("BROWSER_SEMANTIC_ABORTED");
      reject(new DOMException("操作已取消。", "AbortError"));
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    pending.set(id, {
      resolve: (value) => {
        options.signal?.removeEventListener("abort", abort);
        resolve(value);
      },
      reject: (reason) => {
        options.signal?.removeEventListener("abort", abort);
        reject(reason);
      },
      onProgress: options.onProgress,
    });
    worker.postMessage({ id, ...request });
  });
}

async function loadWorkerModel(
  device: BrowserSemanticDevice,
  allowRemote: boolean,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: BrowserSemanticProgress) => void;
  } = {},
) {
  return requestWorker(device, { type: "load", allowRemote, device }, options);
}

function semanticDeviceCandidates(
  profile: BrowserSemanticDeviceProfile,
  preferred: BrowserSemanticDevice | null = profile.device,
) {
  const candidates: BrowserSemanticDevice[] = [];
  const add = (device: BrowserSemanticDevice | null) => {
    if (!device || candidates.includes(device)) return;
    if (device === "webgpu" && !profile.webGpu) return;
    if (device === "wasm" && !profile.wasm) return;
    candidates.push(device);
  };
  add(preferred);
  add(profile.device);
  add(profile.webGpu ? "webgpu" : null);
  // Q8 is the Transformers.js default for WASM. Keep it as the deterministic
  // fallback when a WebGPU adapter exists but cannot execute this ONNX graph.
  add(profile.wasm ? "wasm" : null);
  return candidates;
}

async function validateSemanticInference(
  device: BrowserSemanticDevice,
  signal?: AbortSignal,
) {
  const response = await requestWorker(device, {
    type: "embed",
    texts: [
      "主角追查失蹤帳冊背後的秘密線索",
      "午後天空晴朗，廚房正在準備水果。",
    ],
  }, { signal });
  const vectors = response.vectors as unknown;
  const dimensions = Number(response.dimensions ?? 0);
  if (
    !Array.isArray(vectors)
    || vectors.length !== 2
    || dimensions !== BROWSER_SEMANTIC_MODEL.embeddingDimensions
    || vectors.some((vector) =>
      !Array.isArray(vector)
      || vector.length !== dimensions
      || vector.some((value) => !Number.isFinite(value)))
  ) {
    throw runtimeError(
      "BROWSER_SEMANTIC_SELF_TEST_FAILED",
      "語意模型雖已載入，但真實向量推理未通過維度與有限值檢查。",
    );
  }
}

async function persistModelDevice(device: BrowserSemanticDevice) {
  const record = await getRecord<BrowserSemanticModelRecord>(
    METADATA_STORE,
    MODEL_RECORD_KEY,
  ).catch(() => null);
  if (
    record?.modelId !== BROWSER_SEMANTIC_MODEL.modelId
    || record.modelDigest !== BROWSER_SEMANTIC_MODEL.modelDigest
    || record.sourceRevision !== BROWSER_SEMANTIC_MODEL.sourceRevision
  ) return;
  await putRecord(METADATA_STORE, {
    ...record,
    device,
    lastError: null,
  } satisfies BrowserSemanticModelRecord);
}

async function embedWithDeviceFallback(
  device: BrowserSemanticDevice,
  texts: string[],
  signal?: AbortSignal,
) {
  try {
    const response = await requestWorker(device, { type: "embed", texts }, { signal });
    return { device, response };
  } catch (error) {
    if (device !== "webgpu" || typeof WebAssembly === "undefined") throw error;
    releaseWorker();
    publishProgress({
      phase: "loading",
      progress: 0.98,
      text: "WebGPU 推理不相容，已自動切換 WASM",
      loadedBytes: BROWSER_SEMANTIC_MODEL.estimatedDownloadBytes,
      totalBytes: BROWSER_SEMANTIC_MODEL.estimatedDownloadBytes,
    });
    await loadWorkerModel("wasm", false, { signal });
    const response = await requestWorker("wasm", { type: "embed", texts }, { signal });
    await persistModelDevice("wasm");
    return { device: "wasm" as const, response };
  }
}

function bytesToHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyCachedFile(path: string, expectedSize: number, expectedSha256: string) {
  const cache = await caches.open(BROWSER_SEMANTIC_CACHE_KEY);
  const response = await cache.match(semanticModelFileUrl(path));
  if (!response) return { path, ok: false, reason: "missing" };
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== expectedSize) {
    return { path, ok: false, reason: "size_mismatch" };
  }
  const digest = bytesToHex(await crypto.subtle.digest("SHA-256", buffer));
  return {
    path,
    ok: digest === expectedSha256,
    reason: digest === expectedSha256 ? "verified" : "digest_mismatch",
  };
}

async function verifyModelCache() {
  const results = [];
  for (let index = 0; index < BROWSER_SEMANTIC_MODEL.files.length; index += 1) {
    const file = BROWSER_SEMANTIC_MODEL.files[index];
    publishProgress({
      phase: "verifying",
      progress: 0.94 + ((index + 1) / BROWSER_SEMANTIC_MODEL.files.length) * 0.05,
      text: `驗證 ${file.path}`,
      loadedBytes: file.sizeBytes,
      totalBytes: file.sizeBytes,
    });
    results.push(await verifyCachedFile(file.path, file.sizeBytes, file.sha256));
  }
  return { ok: results.every((result) => result.ok), results };
}

async function clearSemanticModelCacheFiles() {
  if (typeof caches === "undefined") return 0;
  const cache = await caches.open(BROWSER_SEMANTIC_CACHE_KEY);
  const marker = `/${BROWSER_SEMANTIC_MODEL.modelId}/resolve/${BROWSER_SEMANTIC_MODEL.sourceRevision}/`;
  const requests = (await cache.keys()).filter((request) => request.url.includes(marker));
  const deleted = await Promise.all(requests.map((request) => cache.delete(request)));
  return deleted.filter(Boolean).length;
}

function recordMatchesNamespace(
  namespace: ClosedAINamespace,
  filter: Partial<ClosedAINamespace>,
) {
  return Object.entries(filter).every(([key, value]) =>
    value === undefined || namespace[key as keyof ClosedAINamespace] === value);
}

async function rankCacheKey(input: BrowserSemanticRankInput) {
  const queryDigest = await sha256Hex(input.query.trim());
  const itemDigest = await sha256Hex(stableStringify(input.items.map((item) => ({
    id: item.id,
    text: item.text,
    priority: item.priority ?? 0,
  }))));
  const keyDigest = await sha256Hex(stableStringify({
    namespace: input.namespace,
    semanticModelId: BROWSER_SEMANTIC_MODEL.modelId,
    semanticModelDigest: BROWSER_SEMANTIC_MODEL.modelDigest,
    queryDigest,
    itemDigest,
  }));
  return { key: `semantic-rank:${keyDigest}`, queryDigest, itemDigest };
}

function dotProduct(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  let sum = 0;
  for (let index = 0; index < length; index += 1) sum += left[index] * right[index];
  return Math.max(-1, Math.min(1, sum));
}

export function subscribeBrowserSemanticProgress(
  listener: (progress: BrowserSemanticProgress) => void,
) {
  progressListeners.add(listener);
  if (currentProgress) listener(currentProgress);
  return () => progressListeners.delete(listener);
}

export function getBrowserSemanticProgress() {
  return currentProgress ? { ...currentProgress } : null;
}

export async function browserSemanticRuntimeSnapshot(): Promise<BrowserSemanticRuntimeSnapshot> {
  const device = await detectBrowserSemanticDevice();
  const record = device.indexedDb
    ? await getRecord<BrowserSemanticModelRecord>(METADATA_STORE, MODEL_RECORD_KEY).catch(() => null)
    : null;
  const rankRecords = device.indexedDb
    ? await getAllRecords<BrowserSemanticRankCacheRecord>(RANK_CACHE_STORE).catch(() => [])
    : [];
  const now = Date.now();
  const expired = rankRecords.filter((item) => Date.parse(item.expiresAt) <= now);
  if (expired.length) {
    await deleteRecords(RANK_CACHE_STORE, expired.map((item) => item.key)).catch(() => undefined);
  }
  const identityValid = record?.modelId === BROWSER_SEMANTIC_MODEL.modelId
    && record.modelDigest === BROWSER_SEMANTIC_MODEL.modelDigest
    && record.sourceRevision === BROWSER_SEMANTIC_MODEL.sourceRevision;
  const runtimeValid = Boolean(
    identityValid
    && record?.runtimeRevision === BROWSER_SEMANTIC_RUNTIME_REVISION,
  );
  const repairRequired = Boolean(identityValid && record && !runtimeValid);
  return {
    runtime: "transformers-js-worker",
    supported: device.supported,
    reason: device.reason,
    device,
    model: {
      modelId: BROWSER_SEMANTIC_MODEL.modelId,
      modelDigest: BROWSER_SEMANTIC_MODEL.modelDigest,
      sourceRevision: BROWSER_SEMANTIC_MODEL.sourceRevision,
      runtimeRevision: identityValid ? record!.runtimeRevision ?? null : null,
      repairRequired,
      installStatus: runtimeValid
        ? record!.installStatus
        : repairRequired
          ? "error"
          : "not_installed",
      device: identityValid ? record!.device : null,
      cacheVerified: Boolean(runtimeValid && record?.cacheVerified),
      active: activeWorker !== null,
      installedAt: identityValid ? record!.installedAt : null,
      lastUsedAt: identityValid ? record!.lastUsedAt : null,
      lastErrorCode: repairRequired
        ? "BROWSER_SEMANTIC_RUNTIME_UPGRADE_REQUIRED"
        : runtimeValid
          ? record!.lastErrorCode ?? null
          : null,
      lastError: repairRequired
        ? "偵測到舊版失敗快取，系統會自動清除並重建語意模型。"
        : runtimeValid
          ? record!.lastError
          : null,
    },
    cache: {
      backend: "CacheStorage+IndexedDB",
      entries: rankRecords.length - expired.length,
      candidateOnly: true,
      rawTextStored: false,
      canonicalMutation: false,
    },
    lastRanking: lastRanking ? { ...lastRanking } : null,
  };
}

export async function installBrowserSemanticModel(options: {
  signal?: AbortSignal;
  onProgress?: (progress: BrowserSemanticProgress) => void;
} = {}) {
  const device = await detectBrowserSemanticDevice();
  if (!device.supported || !device.device) {
    throw runtimeError(
      "BROWSER_SEMANTIC_DEVICE_GATE_FAILED",
      `此裝置未通過語意模型 Gate：${device.reason}`,
    );
  }
  const previous = await getRecord<BrowserSemanticModelRecord>(
    METADATA_STORE,
    MODEL_RECORD_KEY,
  ).catch(() => null);
  const previousIdentityValid = previous?.modelId === BROWSER_SEMANTIC_MODEL.modelId
    && previous.modelDigest === BROWSER_SEMANTIC_MODEL.modelDigest
    && previous.sourceRevision === BROWSER_SEMANTIC_MODEL.sourceRevision;
  const rebuildFailedCache = Boolean(
    previousIdentityValid
    && (
      previous?.installStatus === "error"
      || previous?.runtimeRevision !== BROWSER_SEMANTIC_RUNTIME_REVISION
    ),
  );
  const installing: BrowserSemanticModelRecord = {
    key: MODEL_RECORD_KEY,
    runtimeRevision: BROWSER_SEMANTIC_RUNTIME_REVISION,
    installStatus: "installing",
    modelId: BROWSER_SEMANTIC_MODEL.modelId,
    modelDigest: BROWSER_SEMANTIC_MODEL.modelDigest,
    sourceRevision: BROWSER_SEMANTIC_MODEL.sourceRevision,
    device: device.device,
    cacheVerified: false,
    installedAt: null,
    lastUsedAt: null,
    lastErrorCode: null,
    lastError: null,
  };
  await putRecord(METADATA_STORE, installing);
  publishProgress({
    phase: "checking",
    progress: 0,
    text: "檢查模型版本、儲存空間與裝置能力",
    loadedBytes: 0,
    totalBytes: BROWSER_SEMANTIC_MODEL.estimatedDownloadBytes,
  });
  let cacheRebuilt = false;
  if (rebuildFailedCache) {
    releaseWorker();
    const deletedFiles = await clearSemanticModelCacheFiles();
    cacheRebuilt = true;
    publishProgress({
      phase: "checking",
      progress: 0.005,
      text: `已清除 ${deletedFiles} 個舊版或失敗快取檔，正在重新下載固定版本`,
      loadedBytes: 0,
      totalBytes: BROWSER_SEMANTIC_MODEL.estimatedDownloadBytes,
    });
  }
  let selectedDevice: BrowserSemanticDevice | null = null;
  try {
    const candidates = semanticDeviceCandidates(device);
    let latestError: unknown = null;
    const passes = cacheRebuilt ? 1 : 2;
    for (let pass = 0; pass < passes && !selectedDevice; pass += 1) {
      let integrityVerified = false;
      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        try {
          publishProgress({
            phase: "checking",
            progress: 0.01,
            text: `正在以 ${candidate.toUpperCase()} 載入固定版本模型`,
            loadedBytes: 0,
            totalBytes: BROWSER_SEMANTIC_MODEL.estimatedDownloadBytes,
          });
          await loadWorkerModel(candidate, true, options);
          if (!integrityVerified) {
            const verification = await verifyModelCache();
            if (!verification.ok) {
              throw runtimeError(
                "BROWSER_SEMANTIC_INTEGRITY_FAILED",
                `模型完整性驗證失敗：${verification.results.filter((item) => !item.ok).map((item) => `${item.path}:${item.reason}`).join(", ")}`,
              );
            }
            integrityVerified = true;
          }
          releaseWorker();
          await loadWorkerModel(candidate, false, options);
          await validateSemanticInference(candidate, options.signal);
          selectedDevice = candidate;
          break;
        } catch (error) {
          latestError = error;
          releaseWorker();
          if (
            options.signal?.aborted
            || (error instanceof DOMException && error.name === "AbortError")
          ) throw error;
          const code = String((error as { code?: string })?.code ?? "");
          if (code === "BROWSER_SEMANTIC_INTEGRITY_FAILED") break;
          if (index < candidates.length - 1) {
            publishProgress({
              phase: "checking",
              progress: 0.01,
              text: `${candidate.toUpperCase()} 不相容，正在切換 ${candidates[index + 1].toUpperCase()}`,
              loadedBytes: null,
              totalBytes: BROWSER_SEMANTIC_MODEL.estimatedDownloadBytes,
            });
          }
        }
      }
      if (!selectedDevice && !cacheRebuilt) {
        const deletedFiles = await clearSemanticModelCacheFiles();
        cacheRebuilt = true;
        publishProgress({
          phase: "checking",
          progress: 0.005,
          text: `首次載入失敗，已自動清除 ${deletedFiles} 個快取檔並完整重試`,
          loadedBytes: 0,
          totalBytes: BROWSER_SEMANTIC_MODEL.estimatedDownloadBytes,
        });
      }
    }
    if (!selectedDevice) throw latestError ?? runtimeError(
      "BROWSER_SEMANTIC_NO_EXECUTION_DEVICE",
      "WebGPU 與 WASM 都無法執行此語意模型。",
    );
    const installedAt = new Date().toISOString();
    await putRecord(METADATA_STORE, {
      ...installing,
      device: selectedDevice,
      installStatus: "ready",
      cacheVerified: true,
      installedAt,
    } satisfies BrowserSemanticModelRecord);
    publishProgress({
      phase: "ready",
      progress: 1,
      text: `語意模型已安裝、雜湊已驗證，${selectedDevice.toUpperCase()} 離線推理通過`,
      loadedBytes: BROWSER_SEMANTIC_MODEL.estimatedDownloadBytes,
      totalBytes: BROWSER_SEMANTIC_MODEL.estimatedDownloadBytes,
    });
    return browserSemanticRuntimeSnapshot();
  } catch (error) {
    releaseWorker();
    const message = error instanceof Error ? error.message : String(error);
    const errorCode = String(
      (error as { code?: string } | null)?.code
      ?? "BROWSER_SEMANTIC_INSTALL_FAILED",
    );
    await putRecord(METADATA_STORE, {
      ...installing,
      device: selectedDevice ?? installing.device,
      installStatus: "error",
      lastErrorCode: errorCode,
      lastError: `${errorCode}: ${message}`.slice(0, 500),
    } satisfies BrowserSemanticModelRecord);
    publishProgress({
      phase: "error",
      progress: 0,
      text: `${errorCode}: ${message}`,
      loadedBytes: null,
      totalBytes: BROWSER_SEMANTIC_MODEL.estimatedDownloadBytes,
    });
    throw runtimeError("BROWSER_SEMANTIC_INSTALL_FAILED", message, error);
  }
}

export async function repairStaleBrowserSemanticRuntime(options: {
  signal?: AbortSignal;
  onProgress?: (progress: BrowserSemanticProgress) => void;
} = {}) {
  const snapshot = await browserSemanticRuntimeSnapshot();
  if (!snapshot.model.repairRequired) return snapshot;
  return installBrowserSemanticModel(options);
}

export async function deleteBrowserSemanticModel() {
  releaseWorker();
  await clearSemanticModelCacheFiles();
  await deleteRecords(METADATA_STORE, [MODEL_RECORD_KEY]).catch(() => undefined);
  const rankRecords = await getAllRecords<BrowserSemanticRankCacheRecord>(RANK_CACHE_STORE).catch(() => []);
  await deleteRecords(RANK_CACHE_STORE, rankRecords.map((item) => item.key)).catch(() => undefined);
  currentProgress = null;
  lastRanking = null;
  return browserSemanticRuntimeSnapshot();
}

export function cancelBrowserSemanticOperation() {
  releaseWorker("BROWSER_SEMANTIC_ABORTED");
}

async function readySemanticModel(signal?: AbortSignal) {
  const snapshot = await browserSemanticRuntimeSnapshot();
  if (
    snapshot.model.installStatus !== "ready"
    || !snapshot.model.cacheVerified
    || !snapshot.device.device
  ) {
    throw runtimeError(
      "BROWSER_SEMANTIC_MODEL_NOT_INSTALLED",
      "請先在閉端 AI 指揮中心明確安裝並驗證語意模型。",
    );
  }
  const candidates = semanticDeviceCandidates(snapshot.device, snapshot.model.device);
  let latestError: unknown = null;
  for (const candidate of candidates) {
    try {
      await loadWorkerModel(candidate, false, { signal });
      if (candidate !== snapshot.model.device) await persistModelDevice(candidate);
      return candidate;
    } catch (error) {
      latestError = error;
      releaseWorker();
    }
  }
  throw latestError ?? runtimeError(
    "BROWSER_SEMANTIC_OFFLINE_LOAD_FAILED",
    "已驗證的語意模型快取無法離線載入。",
  );
}

export async function embedWithBrowserSemanticModel(
  texts: string[],
  signal?: AbortSignal,
): Promise<BrowserSemanticEmbeddingResult> {
  const normalized = texts.map((text) => text.trim()).filter(Boolean);
  if (!normalized.length) {
    throw runtimeError("BROWSER_SEMANTIC_INPUT_EMPTY", "語意向量工作缺少內容。");
  }
  let device = await readySemanticModel(signal);
  const embedded = await embedWithDeviceFallback(device, normalized, signal);
  device = embedded.device;
  const vectors = embedded.response.vectors as number[][];
  const dimensions = Number(embedded.response.dimensions ?? 0);
  if (
    !Array.isArray(vectors)
    || vectors.length !== normalized.length
    || dimensions !== BROWSER_SEMANTIC_MODEL.embeddingDimensions
    || vectors.some((vector) => (
      !Array.isArray(vector)
      || vector.length !== dimensions
      || vector.some((value) => !Number.isFinite(value))
    ))
  ) {
    throw runtimeError(
      "BROWSER_SEMANTIC_VECTOR_INVALID",
      "語意模型回傳的向量維度或有限值驗證失敗。",
    );
  }
  return {
    vectors,
    dimensions,
    modelId: BROWSER_SEMANTIC_MODEL.modelId,
    modelDigest: BROWSER_SEMANTIC_MODEL.modelDigest,
    device,
    externalRequest: false,
    dataLeftDevice: false,
    rawTextStored: false,
  };
}

export async function rankWithBrowserSemanticModel(
  input: BrowserSemanticRankInput,
): Promise<BrowserSemanticRankResult> {
  const started = performance.now();
  const query = input.query.trim();
  const items = input.items.filter((item) => item.id && item.text.trim());
  if (!query || !items.length) {
    throw runtimeError("BROWSER_SEMANTIC_INPUT_EMPTY", "語意排序缺少查詢或內容。" );
  }
  const cacheIdentity = await rankCacheKey({ ...input, query, items });
  const cached = await getRecord<BrowserSemanticRankCacheRecord>(
    RANK_CACHE_STORE,
    cacheIdentity.key,
  ).catch(() => null);
  if (cached && Date.parse(cached.expiresAt) > Date.now()) {
    await putRecord(RANK_CACHE_STORE, { ...cached, hitCount: cached.hitCount + 1 });
    const snapshot = await browserSemanticRuntimeSnapshot();
    const device = snapshot.model.device ?? snapshot.device.device ?? "wasm";
    const elapsedMs = Math.round(performance.now() - started);
    lastRanking = {
      completedAt: new Date().toISOString(),
      elapsedMs,
      items: items.length,
      cacheHit: true,
      device,
      dataLeftDevice: false,
    };
    return {
      scores: cached.scores.map((score) => ({
        ...score,
        priority: items.find((item) => item.id === score.id)?.priority ?? 0,
      })),
      modelId: BROWSER_SEMANTIC_MODEL.modelId,
      modelDigest: BROWSER_SEMANTIC_MODEL.modelDigest,
      device,
      elapsedMs,
      cacheHit: true,
      cacheLayer: "semantic",
      candidateOnly: true,
      externalRequest: false,
      dataLeftDevice: false,
      rawTextStored: false,
      canonicalMutation: false,
    };
  }

  let device = await readySemanticModel(input.signal);
  const scores: Array<{ id: string; score: number; priority: number }> = [];
  for (let offset = 0; offset < items.length; offset += 48) {
    const chunk = items.slice(offset, offset + 48);
    const embedded = await embedWithDeviceFallback(
      device,
      [query, ...chunk.map((item) => item.text)],
      input.signal,
    );
    device = embedded.device;
    const response = embedded.response;
    const vectors = response.vectors as number[][];
    const queryVector = vectors[0];
    if (!queryVector || vectors.length !== chunk.length + 1) {
      throw runtimeError("BROWSER_SEMANTIC_VECTOR_INVALID", "語意模型回傳的向量維度不正確。" );
    }
    chunk.forEach((item, index) => {
      scores.push({
        id: item.id,
        score: Number(dotProduct(queryVector, vectors[index + 1]).toFixed(6)),
        priority: item.priority ?? 0,
      });
    });
  }
  scores.sort((left, right) => right.score - left.score || right.priority - left.priority || left.id.localeCompare(right.id));
  const now = new Date();
  await putRecord(RANK_CACHE_STORE, {
    key: cacheIdentity.key,
    namespace: structuredClone(input.namespace),
    modelId: BROWSER_SEMANTIC_MODEL.modelId,
    modelDigest: BROWSER_SEMANTIC_MODEL.modelDigest,
    queryDigest: cacheIdentity.queryDigest,
    itemDigest: cacheIdentity.itemDigest,
    scores: scores.map(({ id, score }) => ({ id, score })),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + Math.max(60_000, input.ttlMs ?? DEFAULT_RANK_CACHE_TTL_MS)).toISOString(),
    hitCount: 0,
    candidateOnly: true,
    memoryMutation: false,
    learningMutation: false,
    canonicalMutation: false,
    rawTextStored: false,
  } satisfies BrowserSemanticRankCacheRecord);
  const modelRecord = await getRecord<BrowserSemanticModelRecord>(METADATA_STORE, MODEL_RECORD_KEY);
  if (modelRecord) {
    await putRecord(METADATA_STORE, { ...modelRecord, lastUsedAt: new Date().toISOString() });
  }
  const elapsedMs = Math.round(performance.now() - started);
  lastRanking = {
    completedAt: new Date().toISOString(),
    elapsedMs,
    items: items.length,
    cacheHit: false,
    device,
    dataLeftDevice: false,
  };
  return {
    scores,
    modelId: BROWSER_SEMANTIC_MODEL.modelId,
    modelDigest: BROWSER_SEMANTIC_MODEL.modelDigest,
    device,
    elapsedMs,
    cacheHit: false,
    cacheLayer: "semantic",
    candidateOnly: true,
    externalRequest: false,
    dataLeftDevice: false,
    rawTextStored: false,
    canonicalMutation: false,
  };
}

export async function invalidateBrowserSemanticCache(
  filter: Partial<ClosedAINamespace>,
) {
  const records = await getAllRecords<BrowserSemanticRankCacheRecord>(RANK_CACHE_STORE);
  const targets = records.filter((record) => recordMatchesNamespace(record.namespace, filter));
  await deleteRecords(RANK_CACHE_STORE, targets.map((record) => record.key));
  return { invalidated: targets.length, remaining: records.length - targets.length };
}

export async function resetBrowserSemanticRuntimeForTests() {
  releaseWorker();
  currentProgress = null;
  lastRanking = null;
  if (typeof indexedDB !== "undefined") {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(METADATA_DB);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }
}

export const BROWSER_SEMANTIC_CACHE_KEY = "novel-browser-semantic-models-v1";

export const BROWSER_SEMANTIC_MODEL = {
  modelId: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  displayName: "多語小說語意檢索器",
  purpose: "章節、Story Bible、角色、世界規則與伏筆的裝置端語意排序",
  sourceRevision: "018218219718cc217663562b0a65b5ffd1339d47",
  license: "Apache-2.0",
  dtype: "q8",
  embeddingDimensions: 384,
  estimatedDownloadBytes: 135_391_039,
  modelDigest: "4756329f24d3fa38bbf832ab5c6a67d7e221bbf4440064fc850f2a3352842d74",
  files: [
    {
      path: "onnx/model_quantized.onnx",
      sizeBytes: 118_308_126,
      sha256: "66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc",
    },
    {
      path: "tokenizer.json",
      sizeBytes: 17_082_913,
      sha256: "b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441",
    },
  ],
  integrityScope: {
    immutableRevision: true,
    weightSha256: true,
    tokenizerSha256: true,
    auxiliaryFilesPinnedByRevision: true,
    onFailure: "error",
  },
  sourceUrl:
    "https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2",
} as const;

export type BrowserSemanticDevice = "webgpu" | "wasm";

export type BrowserSemanticDeviceProfile = {
  supported: boolean;
  reason: string;
  device: BrowserSemanticDevice | null;
  webGpu: boolean;
  wasm: boolean;
  worker: boolean;
  indexedDb: boolean;
  cacheStorage: boolean;
  storageQuota: number | null;
  storageUsage: number | null;
  storageAvailable: number | null;
};

type SemanticNavigator = Navigator & {
  gpu?: { requestAdapter(): Promise<unknown | null> };
};

export async function detectBrowserSemanticDevice(): Promise<BrowserSemanticDeviceProfile> {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      supported: false,
      reason: "browser_required",
      device: null,
      webGpu: false,
      wasm: false,
      worker: false,
      indexedDb: false,
      cacheStorage: false,
      storageQuota: null,
      storageUsage: null,
      storageAvailable: null,
    };
  }

  const current = navigator as SemanticNavigator;
  const webGpu = Boolean(current.gpu?.requestAdapter);
  const wasm = typeof WebAssembly !== "undefined";
  const worker = typeof Worker !== "undefined";
  const indexedDb = typeof indexedDB !== "undefined";
  const cacheStorage = typeof caches !== "undefined";
  const estimate = current.storage?.estimate
    ? await current.storage.estimate().catch(() => ({} as StorageEstimate))
    : {} as StorageEstimate;
  const storageQuota = estimate.quota ?? null;
  const storageUsage = estimate.usage ?? null;
  const storageAvailable = storageQuota === null || storageUsage === null
    ? null
    : Math.max(0, storageQuota - storageUsage);
  const enoughStorage = storageAvailable === null
    || storageAvailable >= Math.ceil(BROWSER_SEMANTIC_MODEL.estimatedDownloadBytes * 1.15);
  const supported = wasm && worker && indexedDb && cacheStorage && enoughStorage;

  return {
    supported,
    reason: !wasm
      ? "missing:WebAssembly"
      : !worker
        ? "missing:WebWorker"
        : !indexedDb
          ? "missing:IndexedDB"
          : !cacheStorage
            ? "missing:CacheStorage"
            : !enoughStorage
              ? "insufficient_storage"
              : webGpu
                ? "webgpu_ready"
                : "wasm_ready",
    device: supported ? (webGpu ? "webgpu" : "wasm") : null,
    webGpu,
    wasm,
    worker,
    indexedDb,
    cacheStorage,
    storageQuota,
    storageUsage,
    storageAvailable,
  };
}

export function semanticModelFileUrl(path: string) {
  return `https://huggingface.co/${BROWSER_SEMANTIC_MODEL.modelId}/resolve/${BROWSER_SEMANTIC_MODEL.sourceRevision}/${path}`;
}

import type {
  AppConfig,
  ModelRecord,
} from "@mlc-ai/web-llm";

export type BrowserWebLLMCacheBackend = NonNullable<AppConfig["cacheBackend"]>;

export type BrowserWebLLMDeviceTier = "unsupported" | "low" | "standard" | "high";

export const BROWSER_PROSE_QUALIFICATION_SCHEMA_VERSION =
  "browser-prose-production-qualification-v1" as const;

export type BrowserProseQualifiedTask =
  | "chapter.continue"
  | "chapter.expand";

export type BrowserProseQualificationArtifact = Readonly<{
  schemaVersion: typeof BROWSER_PROSE_QUALIFICATION_SCHEMA_VERSION;
  modelId: string;
  modelDigest: string;
  candidateIdentityDigest: string;
  generationPolicyDigest: string;
  liveQualificationEvidenceDigest: string;
  formalApprovalDigest: string;
  qualifiedTasks: readonly BrowserProseQualifiedTask[];
}>;

export type BrowserWebLLMModelManifest = {
  modelId: string;
  displayName: string;
  parameterLabel: "0.5B" | "1.5B" | "3B";
  tier: Exclude<BrowserWebLLMDeviceTier, "unsupported">;
  license: "Apache-2.0" | "Qwen-Research";
  licenseUrl: string;
  usePolicy: "production" | "research-only";
  productionQualified: boolean;
  proseQualification: BrowserProseQualificationArtifact | null;
  sourceModel: string;
  sourceRevision: string;
  modelUrl: string;
  modelLibRevision: string;
  modelLibUrl: string;
  estimatedDownloadBytes: number;
  estimatedVramMB: number;
  contextWindow: 4096;
  modelDigest: string;
  integrity: {
    config: string;
    tokenizer: Record<string, string>;
    model_lib: string;
    onFailure: "error";
  };
  integrityScope: {
    immutableWeightRevision: true;
    configSRI: true;
    tokenizerSRI: true;
    modelLibSRI: true;
    perWeightShardSRI: true;
  };
};

const MODEL_LIB_REVISION = "025bcaf3780fa8254f5e5efd3bfea0a5397248f4";
const TOKENIZER_SRI = "sha256-wDghF+oynN8JcEETL21zWSS2l5JNb2/DlFcT6WzodTk=";

export const BROWSER_WEBLLM_MODELS = [
  {
    modelId: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    displayName: "Qwen2.5 0.5B · 輕量離線",
    parameterLabel: "0.5B",
    tier: "low",
    license: "Apache-2.0",
    licenseUrl: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/blob/main/LICENSE",
    usePolicy: "production",
    productionQualified: true,
    proseQualification: null,
    sourceModel: "mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    sourceRevision: "32ff081fe7e4dfe4ffb167b94c66fdf11e02b8ad",
    modelUrl: "https://huggingface.co/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC/resolve/32ff081fe7e4dfe4ffb167b94c66fdf11e02b8ad/",
    modelLibRevision: MODEL_LIB_REVISION,
    modelLibUrl: `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/${MODEL_LIB_REVISION}/web-llm-models/v0_2_84/base/Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm`,
    estimatedDownloadBytes: 294_543_984,
    estimatedVramMB: 944.62,
    contextWindow: 4096,
    modelDigest: "48103ffe61f8df6c708f3daa0e3c311c8e202480c6fc856722d2ace93e465989",
    integrity: {
      config: "sha256-VDnAO99O58/g+Kl6ZYgBiwFE3BKAxxu66ihTzbq4dLk=",
      tokenizer: { "tokenizer.json": TOKENIZER_SRI },
      model_lib: "sha256-YRtYT9RK8niUFjlWA5Zaa8B08hJxiK9Zf03aAW+9qxk=",
      onFailure: "error",
    },
    integrityScope: {
      immutableWeightRevision: true,
      configSRI: true,
      tokenizerSRI: true,
      modelLibSRI: true,
      perWeightShardSRI: true,
    },
  },
  {
    modelId: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    displayName: "Qwen2.5 1.5B · 中文寫作",
    parameterLabel: "1.5B",
    tier: "standard",
    license: "Apache-2.0",
    licenseUrl: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct/blob/main/LICENSE",
    usePolicy: "production",
    productionQualified: true,
    proseQualification: null,
    sourceModel: "mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    sourceRevision: "9bd564b064631febf14deadcac492efb761d60c3",
    modelUrl: "https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC/resolve/9bd564b064631febf14deadcac492efb761d60c3/",
    modelLibRevision: MODEL_LIB_REVISION,
    modelLibUrl: `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/${MODEL_LIB_REVISION}/web-llm-models/v0_2_84/base/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm`,
    estimatedDownloadBytes: 885_515_020,
    estimatedVramMB: 1629.75,
    contextWindow: 4096,
    modelDigest: "664d1a6498af539e1919c34bf04101ff9d3ac39eaa0f1f1c3ed1b46c7d87b168",
    integrity: {
      config: "sha256-faSVQhLT8hqRzD5pPRefYyE/1XNWeWhH9l1/lUeKH54=",
      tokenizer: { "tokenizer.json": TOKENIZER_SRI },
      model_lib: "sha256-D861C7r0fv3DH86WtywRXct/UiHIWr5qn8At2p0db8M=",
      onFailure: "error",
    },
    integrityScope: {
      immutableWeightRevision: true,
      configSRI: true,
      tokenizerSRI: true,
      modelLibSRI: true,
      perWeightShardSRI: true,
    },
  },
  {
    modelId: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    displayName: "Qwen2.5 3B · 研究授權（未開放正式使用）",
    parameterLabel: "3B",
    tier: "high",
    license: "Qwen-Research",
    licenseUrl: "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct/blob/main/LICENSE",
    usePolicy: "research-only",
    productionQualified: false,
    proseQualification: null,
    sourceModel: "mlc-ai/Qwen2.5-3B-Instruct-q4f16_1-MLC",
    sourceRevision: "7690aaaa46df36b1be0fe93b9c9abac0497eff6c",
    modelUrl: "https://huggingface.co/mlc-ai/Qwen2.5-3B-Instruct-q4f16_1-MLC/resolve/7690aaaa46df36b1be0fe93b9c9abac0497eff6c/",
    modelLibRevision: MODEL_LIB_REVISION,
    modelLibUrl: `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/${MODEL_LIB_REVISION}/web-llm-models/v0_2_84/base/Qwen2.5-3B-Instruct-q4f16_1_cs1k-webgpu.wasm`,
    estimatedDownloadBytes: 1_753_300_000,
    estimatedVramMB: 2504.76,
    contextWindow: 4096,
    modelDigest: "d9eac2dddca497d38595365d3c02131cf9b09a709a75b54b33125eb5c79d4e61",
    integrity: {
      config: "sha256-ysRYq+802EnVYJedSVWbttjzirfFZpOLoRfdLu2xKgI=",
      tokenizer: { "tokenizer.json": TOKENIZER_SRI },
      model_lib: "sha256-uuim0nGPUuLtIy8GnBdbCFjjC5Dr/itWyi7ctL1AMFo=",
      onFailure: "error",
    },
    integrityScope: {
      immutableWeightRevision: true,
      configSRI: true,
      tokenizerSRI: true,
      modelLibSRI: true,
      perWeightShardSRI: true,
    },
  },
] as const satisfies readonly BrowserWebLLMModelManifest[];

export type BrowserWebLLMModelId = (typeof BROWSER_WEBLLM_MODELS)[number]["modelId"];

export type BrowserWebLLMDeviceProfile = {
  supported: boolean;
  tier: BrowserWebLLMDeviceTier;
  reason: string;
  mobile: boolean;
  webGpu: boolean;
  wasm: boolean;
  worker: boolean;
  indexedDb: boolean;
  opfs: boolean;
  deviceMemoryGB: number | null;
  hardwareConcurrency: number | null;
  maxStorageBufferBindingSize: number | null;
  storageQuota: number | null;
  storageUsage: number | null;
  storageAvailable: number | null;
  allowedModelIds: BrowserWebLLMModelId[];
  recommendedModelId: BrowserWebLLMModelId | null;
};

type BrowserNavigator = Navigator & {
  deviceMemory?: number;
  gpu?: {
    requestAdapter(): Promise<{
      limits?: { maxStorageBufferBindingSize?: number };
    } | null>;
  };
  storage?: StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  };
};

export function browserWebLLMModel(
  modelId: string | null | undefined,
): (typeof BROWSER_WEBLLM_MODELS)[number] | null {
  return BROWSER_WEBLLM_MODELS.find((model) => model.modelId === modelId) ?? null;
}

export function browserWebLLMAppConfig(cacheBackend: BrowserWebLLMCacheBackend): AppConfig {
  const model_list: ModelRecord[] = BROWSER_WEBLLM_MODELS.map((model) => ({
    model: model.modelUrl,
    model_id: model.modelId,
    model_lib: model.modelLibUrl,
    vram_required_MB: model.estimatedVramMB,
    low_resource_required: model.tier === "low",
    overrides: { context_window_size: model.contextWindow },
    integrity: model.integrity,
  }));
  return { model_list, cacheBackend };
}

function hasStorageFor(
  available: number | null,
  model: (typeof BROWSER_WEBLLM_MODELS)[number],
) {
  return available === null || available >= Math.ceil(model.estimatedDownloadBytes * 1.15);
}

export async function detectBrowserWebLLMDevice(): Promise<BrowserWebLLMDeviceProfile> {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      supported: false,
      tier: "unsupported",
      reason: "browser_required",
      mobile: false,
      webGpu: false,
      wasm: false,
      worker: false,
      indexedDb: false,
      opfs: false,
      deviceMemoryGB: null,
      hardwareConcurrency: null,
      maxStorageBufferBindingSize: null,
      storageQuota: null,
      storageUsage: null,
      storageAvailable: null,
      allowedModelIds: [],
      recommendedModelId: null,
    };
  }

  const current = navigator as BrowserNavigator;
  const webGpuApi = typeof current.gpu?.requestAdapter === "function";
  const wasm = typeof WebAssembly !== "undefined";
  const worker = typeof Worker !== "undefined";
  const indexedDb = typeof indexedDB !== "undefined";
  const opfs = typeof current.storage?.getDirectory === "function";
  const mobile = /Android|iPhone|iPad|iPod|Mobile/iu.test(current.userAgent);
  const deviceMemoryGB = Number.isFinite(current.deviceMemory)
    ? Number(current.deviceMemory)
    : null;
  const hardwareConcurrency = Number.isFinite(current.hardwareConcurrency)
    ? Number(current.hardwareConcurrency)
    : null;
  const estimate = current.storage?.estimate
    ? await current.storage.estimate().catch(() => ({} as StorageEstimate))
    : {} as StorageEstimate;
  const storageQuota = estimate.quota ?? null;
  const storageUsage = estimate.usage ?? null;
  const storageAvailable = storageQuota === null || storageUsage === null
    ? null
    : Math.max(0, storageQuota - storageUsage);
  let adapter: Awaited<ReturnType<NonNullable<BrowserNavigator["gpu"]>["requestAdapter"]>> = null;
  let webGpuFailureReason: "missing:WebGPU" | "webgpu_adapter_unavailable" | "webgpu_adapter_request_failed" | null = webGpuApi
    ? null
    : "missing:WebGPU";
  if (webGpuApi) {
    try {
      adapter = await current.gpu!.requestAdapter();
      if (!adapter) webGpuFailureReason = "webgpu_adapter_unavailable";
    } catch {
      adapter = null;
      webGpuFailureReason = "webgpu_adapter_request_failed";
    }
  }
  const webGpu = adapter !== null;
  const maxStorageBufferBindingSize = Number(
    adapter?.limits?.maxStorageBufferBindingSize ?? 0,
  ) || null;

  const baseSupported = webGpu && wasm && worker && indexedDb;
  if (!baseSupported) {
    const missing = [
      !webGpu && "WebGPU",
      !wasm && "WebAssembly",
      !worker && "Web Worker",
      !indexedDb && "IndexedDB",
    ].filter(Boolean).join("、");
    return {
      supported: false,
      tier: "unsupported",
      reason: webGpuFailureReason ?? `missing:${missing}`,
      mobile,
      webGpu,
      wasm,
      worker,
      indexedDb,
      opfs,
      deviceMemoryGB,
      hardwareConcurrency,
      maxStorageBufferBindingSize,
      storageQuota,
      storageUsage,
      storageAvailable,
      allowedModelIds: [],
      recommendedModelId: null,
    };
  }

  const allowedModelIds: BrowserWebLLMModelId[] = [];
  const [low, standard, high] = BROWSER_WEBLLM_MODELS;
  if (hasStorageFor(storageAvailable, low)) allowedModelIds.push(low.modelId);
  if (
    !mobile
    && (deviceMemoryGB ?? 0) >= 8
    && hasStorageFor(storageAvailable, standard)
  ) {
    allowedModelIds.push(standard.modelId);
  }
  const passedHighMemoryGate = high.productionQualified
    && !mobile
    && (deviceMemoryGB ?? 0) >= 12
    && (maxStorageBufferBindingSize ?? 0) >= 134_217_728
    && hasStorageFor(storageAvailable, high);
  if (passedHighMemoryGate) allowedModelIds.push(high.modelId);

  const recommendedModelId = allowedModelIds.at(-1) ?? null;
  const tier: BrowserWebLLMDeviceTier = recommendedModelId === high.modelId
    ? "high"
    : recommendedModelId === standard.modelId
      ? "standard"
      : recommendedModelId === low.modelId
        ? "low"
        : "unsupported";
  return {
    supported: recommendedModelId !== null,
    tier,
    reason: recommendedModelId
      ? `device_gate_passed:${tier}`
      : "insufficient_storage_for_low_tier_model",
    mobile,
    webGpu,
    wasm,
    worker,
    indexedDb,
    opfs,
    deviceMemoryGB,
    hardwareConcurrency,
    maxStorageBufferBindingSize,
    storageQuota,
    storageUsage,
    storageAvailable,
    allowedModelIds,
    recommendedModelId,
  };
}

export function chooseBrowserWebLLMCacheBackend(
  _profile: Pick<BrowserWebLLMDeviceProfile, "opfs" | "indexedDb">,
): BrowserWebLLMCacheBackend {
  void _profile;
  // CacheStorage exposes every immutable weight shard for post-download
  // SHA-256 verification. The general Service Worker does not own this scope.
  return "cache";
}

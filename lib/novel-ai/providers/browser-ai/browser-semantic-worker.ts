import { BertTokenizer, env, pipeline } from "@huggingface/transformers";
import {
  BROWSER_SEMANTIC_CACHE_KEY,
  BROWSER_SEMANTIC_MODEL,
  semanticModelFileUrl,
  type BrowserSemanticDevice,
} from "./browser-semantic-model-registry";

type SemanticExtractor = {
  (
    texts: string[],
    options: { pooling: "mean"; normalize: true },
  ): Promise<{ data: Float32Array | number[]; dims: number[] }>;
  dispose(): Promise<void>;
};

type WorkerRequest =
  | {
    id: string;
    type: "load";
    allowRemote: boolean;
    device: BrowserSemanticDevice;
  }
  | { id: string; type: "embed"; texts: string[] }
  | { id: string; type: "dispose" };

let extractor: SemanticExtractor | null = null;
let activeDevice: BrowserSemanticDevice | null = null;

function respond(id: string, payload: Record<string, unknown>) {
  globalThis.postMessage({ id, ...payload });
}

async function disposeExtractor() {
  const current = extractor;
  extractor = null;
  activeDevice = null;
  await current?.dispose().catch(() => undefined);
}

async function loadPinnedJson(path: string, allowRemote: boolean) {
  const url = semanticModelFileUrl(path);
  const cache = await caches.open(BROWSER_SEMANTIC_CACHE_KEY);
  let response = await cache.match(url);
  if (!response && allowRemote) {
    const remote = await fetch(url);
    if (!remote.ok) {
      throw new Error(`SEMANTIC_PINNED_FILE_DOWNLOAD_FAILED:${path}:${remote.status}`);
    }
    await cache.put(url, remote.clone());
    response = remote;
  }
  if (!response) throw new Error(`SEMANTIC_OFFLINE_FILE_MISSING:${path}`);
  return response.json() as Promise<Record<string, unknown>>;
}

async function ensureTokenizerCallability(
  loaded: unknown,
  allowRemote: boolean,
) {
  const semanticPipeline = loaded as {
    tokenizer?: unknown;
  };
  if (typeof semanticPipeline.tokenizer === "function") return "native" as const;
  let tokenizer = semanticPipeline.tokenizer as {
    _call?: (...args: unknown[]) => unknown;
  } | null | undefined;
  if (typeof tokenizer?._call !== "function") {
    // Transformers.js 4.x can omit the tokenizer from a pipeline when its
    // metadata preflight does not recognise an older Xenova repository. Load
    // the pinned tokenizer explicitly; it uses the same verified cache and
    // the same offline-only policy as the model.
    const [tokenizerJson, tokenizerConfig] = await Promise.all([
      loadPinnedJson("tokenizer.json", allowRemote),
      loadPinnedJson("tokenizer_config.json", allowRemote),
    ]);
    tokenizer = new BertTokenizer(tokenizerJson, tokenizerConfig) as unknown as typeof tokenizer;
    semanticPipeline.tokenizer = tokenizer;
  }
  if (typeof semanticPipeline.tokenizer === "function") return "explicit" as const;
  if (typeof tokenizer?._call !== "function") {
    throw new Error("SEMANTIC_TOKENIZER_NOT_CALLABLE");
  }
  // Some bundlers preserve the Transformers.js tokenizer instance but lose
  // the callable function returned by its constructor. FeatureExtractionPipeline
  // only needs the public call operation, so restore it without changing the
  // tokenizer implementation or model data.
  semanticPipeline.tokenizer = (...args: unknown[]) => tokenizer._call!(...args);
  return "explicit_callability_restored" as const;
}

async function loadExtractor(
  id: string,
  allowRemote: boolean,
  device: BrowserSemanticDevice,
) {
  if (extractor && activeDevice === device) {
    respond(id, { type: "loaded", device, reused: true });
    return;
  }
  await disposeExtractor();
  // Transformers.js 4.x rejects `local_files_only=true` while local models are
  // disabled before it gets a chance to inspect CacheStorage. During the
  // verified offline reload we therefore enable the local/cache lookup but
  // disable remote models. A cache miss can only fall back to the same-origin
  // local path and then fails closed; it cannot contact Hugging Face.
  env.allowLocalModels = !allowRemote;
  env.allowRemoteModels = allowRemote;
  env.useBrowserCache = true;
  env.cacheKey = BROWSER_SEMANTIC_CACHE_KEY;
  const loaded = await pipeline(
    "feature-extraction",
    BROWSER_SEMANTIC_MODEL.modelId,
    {
      revision: BROWSER_SEMANTIC_MODEL.sourceRevision,
      dtype: BROWSER_SEMANTIC_MODEL.dtype,
      device,
      local_files_only: !allowRemote,
      progress_callback: (progress) => {
        respond(id, { type: "progress", progress });
      },
    },
  );
  const tokenizerCompatibility = await ensureTokenizerCallability(loaded, allowRemote);
  extractor = loaded as unknown as SemanticExtractor;
  activeDevice = device;
  respond(id, {
    type: "loaded",
    device,
    reused: false,
    tokenizerCompatibility,
  });
}

async function embed(id: string, texts: string[]) {
  if (!extractor) throw new Error("SEMANTIC_MODEL_NOT_LOADED");
  if (!texts.length || texts.length > 64) throw new Error("SEMANTIC_BATCH_OUT_OF_RANGE");
  const normalized = texts.map((text) => text.trim().slice(0, 8_000));
  if (normalized.some((text) => !text)) throw new Error("SEMANTIC_TEXT_EMPTY");
  const output = await extractor(normalized, { pooling: "mean", normalize: true });
  const dimensions = output.dims.at(-1) ?? BROWSER_SEMANTIC_MODEL.embeddingDimensions;
  const flat = Array.from(output.data);
  const vectors = normalized.map((_, index) =>
    flat.slice(index * dimensions, (index + 1) * dimensions));
  respond(id, { type: "embedded", vectors, dimensions });
}

globalThis.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  void (async () => {
    try {
      if (request.type === "load") {
        await loadExtractor(request.id, request.allowRemote, request.device);
      } else if (request.type === "embed") {
        await embed(request.id, request.texts);
      } else {
        await disposeExtractor();
        respond(request.id, { type: "disposed" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      respond(request.id, {
        type: "error",
        code: message.includes("local_files_only")
          ? "BROWSER_SEMANTIC_OFFLINE_CACHE_MISS"
          : message.includes("Invalid configuration detected")
            ? "BROWSER_SEMANTIC_CACHE_CONFIGURATION_INVALID"
            : "BROWSER_SEMANTIC_WORKER_FAILED",
        message,
        device: request.type === "load" ? request.device : activeDevice,
      });
    }
  })();
};

export {};

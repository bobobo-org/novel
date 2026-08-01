import { env, pipeline } from "@huggingface/transformers";
import {
  BROWSER_SEMANTIC_CACHE_KEY,
  BROWSER_SEMANTIC_MODEL,
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
  env.allowLocalModels = false;
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
  extractor = loaded as unknown as SemanticExtractor;
  activeDevice = device;
  respond(id, { type: "loaded", device, reused: false });
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
      respond(request.id, {
        type: "error",
        code: error instanceof Error ? error.message : "SEMANTIC_WORKER_FAILED",
      });
    }
  })();
};

export {};

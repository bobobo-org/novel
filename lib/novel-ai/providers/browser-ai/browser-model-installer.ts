import shardManifestJson from "./model-shard-manifest.json" with { type: "json" };
import { sha256Hex, stableStringify } from "../../closed-ai-cache";
import type { BrowserWebLLMModelId } from "./webllm-model-registry";

export const BROWSER_MODEL_SHARD_CACHE = "webllm/model" as const;

export type BrowserModelShard = {
  path: string;
  url: string;
  bytes: number;
  sha256: string;
  revision: string;
  modelId: BrowserWebLLMModelId;
};

export type BrowserModelShardRecord = {
  modelId: BrowserWebLLMModelId;
  sourceModel: string;
  revision: string;
  shardCount: number;
  totalBytes: number;
  shards: BrowserModelShard[];
};

export type BrowserModelShardManifest = {
  schemaVersion: "browser-model-shard-manifest-v1";
  source: string;
  generatedAt: string;
  models: BrowserModelShardRecord[];
};

export type BrowserModelShardVerification = {
  schemaVersion: "browser-model-shard-verification-v1";
  modelId: BrowserWebLLMModelId;
  revision: string;
  manifestDigest: string;
  shardCount: number;
  verifiedShardCount: number;
  totalBytes: number;
  verifiedBytes: number;
  verified: boolean;
  failures: Array<{
    path: string;
    reason: "missing" | "size_mismatch" | "digest_mismatch" | "read_failed";
    expectedBytes: number;
    actualBytes: number | null;
  }>;
  verifiedAt: string;
};

export type BrowserModelShardCacheInspection = {
  modelId: BrowserWebLLMModelId;
  shardCount: number;
  cachedShardCount: number;
  totalBytes: number;
  cachedBytes: number;
  complete: boolean;
};

const manifest = shardManifestJson as BrowserModelShardManifest;

function isHexDigest(value: string) {
  return /^[a-f0-9]{64}$/u.test(value);
}

export function validateBrowserModelShardManifest(
  value: BrowserModelShardManifest = manifest,
) {
  const errors: string[] = [];
  if (value.schemaVersion !== "browser-model-shard-manifest-v1") {
    errors.push("schema_version");
  }
  const seenModels = new Set<string>();
  for (const model of value.models) {
    if (seenModels.has(model.modelId)) errors.push(`duplicate_model:${model.modelId}`);
    seenModels.add(model.modelId);
    if (!/^[a-f0-9]{40}$/u.test(model.revision)) {
      errors.push(`invalid_revision:${model.modelId}`);
    }
    if (model.shardCount !== model.shards.length) {
      errors.push(`shard_count:${model.modelId}`);
    }
    const totalBytes = model.shards.reduce((sum, shard) => sum + shard.bytes, 0);
    if (totalBytes !== model.totalBytes) errors.push(`total_bytes:${model.modelId}`);
    const seenPaths = new Set<string>();
    for (const shard of model.shards) {
      if (seenPaths.has(shard.path)) errors.push(`duplicate_path:${model.modelId}:${shard.path}`);
      seenPaths.add(shard.path);
      if (shard.modelId !== model.modelId) errors.push(`model_identity:${shard.path}`);
      if (shard.revision !== model.revision) errors.push(`revision_identity:${shard.path}`);
      if (!isHexDigest(shard.sha256)) errors.push(`digest:${shard.path}`);
      if (!Number.isSafeInteger(shard.bytes) || shard.bytes <= 0) errors.push(`bytes:${shard.path}`);
      if (!shard.url.includes(`/${model.revision}/${shard.path}`)) {
        errors.push(`immutable_url:${shard.path}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function browserModelShardRecord(modelId: string) {
  return manifest.models.find((model) => model.modelId === modelId) ?? null;
}

export async function browserModelShardManifestDigest() {
  return sha256Hex(stableStringify(manifest));
}

/**
 * Reads only CacheStorage keys. It never downloads or hashes model bytes, so
 * the UI can distinguish a retained on-device cache from a new download.
 */
export async function inspectBrowserModelShardCache(
  modelId: BrowserWebLLMModelId,
): Promise<BrowserModelShardCacheInspection> {
  const model = browserModelShardRecord(modelId);
  if (!model) {
    throw Object.assign(new Error("No immutable shard manifest exists for this model."), {
      code: "MODEL_SHARD_MANIFEST_MISSING",
      modelId,
    });
  }
  if (typeof caches === "undefined") {
    return {
      modelId,
      shardCount: model.shardCount,
      cachedShardCount: 0,
      totalBytes: model.totalBytes,
      cachedBytes: 0,
      complete: false,
    };
  }
  const cache = await caches.open(BROWSER_MODEL_SHARD_CACHE);
  const present = await Promise.all(model.shards.map(async (shard) => ({
    shard,
    cached: Boolean(await cache.match(new Request(shard.url))),
  })));
  const cached = present.filter((item) => item.cached);
  return {
    modelId,
    shardCount: model.shardCount,
    cachedShardCount: cached.length,
    totalBytes: model.totalBytes,
    cachedBytes: cached.reduce((sum, item) => sum + item.shard.bytes, 0),
    complete: cached.length === model.shardCount,
  };
}

function bytesToHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyBrowserModelShards(input: {
  modelId: BrowserWebLLMModelId;
  signal?: AbortSignal;
  onProgress?: (progress: {
    modelId: BrowserWebLLMModelId;
    shardPath: string;
    verifiedShardCount: number;
    shardCount: number;
    verifiedBytes: number;
    totalBytes: number;
  }) => void | Promise<void>;
}): Promise<BrowserModelShardVerification> {
  const validation = validateBrowserModelShardManifest();
  if (!validation.valid) {
    throw Object.assign(new Error("Browser model shard manifest is invalid."), {
      code: "MODEL_SHARD_MANIFEST_INVALID",
      errors: validation.errors,
    });
  }
  const model = browserModelShardRecord(input.modelId);
  if (!model) {
    throw Object.assign(new Error("No immutable shard manifest exists for this model."), {
      code: "MODEL_SHARD_MANIFEST_MISSING",
      modelId: input.modelId,
    });
  }
  if (typeof caches === "undefined" || !crypto?.subtle) {
    throw Object.assign(new Error("CacheStorage and Web Crypto are required for shard verification."), {
      code: "MODEL_INTEGRITY_RUNTIME_UNAVAILABLE",
    });
  }
  const cache = await caches.open(BROWSER_MODEL_SHARD_CACHE);
  const failures: BrowserModelShardVerification["failures"] = [];
  let verifiedBytes = 0;
  let verifiedShardCount = 0;
  for (const shard of model.shards) {
    if (input.signal?.aborted) throw new DOMException("操作已取消。", "AbortError");
    let response: Response | undefined;
    try {
      response = await cache.match(new Request(shard.url));
      if (!response) {
        failures.push({
          path: shard.path,
          reason: "missing",
          expectedBytes: shard.bytes,
          actualBytes: null,
        });
        continue;
      }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength !== shard.bytes) {
        failures.push({
          path: shard.path,
          reason: "size_mismatch",
          expectedBytes: shard.bytes,
          actualBytes: buffer.byteLength,
        });
        await cache.delete(new Request(shard.url));
        continue;
      }
      const digest = bytesToHex(await crypto.subtle.digest("SHA-256", buffer));
      if (digest !== shard.sha256) {
        failures.push({
          path: shard.path,
          reason: "digest_mismatch",
          expectedBytes: shard.bytes,
          actualBytes: buffer.byteLength,
        });
        await cache.delete(new Request(shard.url));
        continue;
      }
      verifiedShardCount += 1;
      verifiedBytes += shard.bytes;
      const callbackResult = input.onProgress?.({
        modelId: input.modelId,
        shardPath: shard.path,
        verifiedShardCount,
        shardCount: model.shardCount,
        verifiedBytes,
        totalBytes: model.totalBytes,
      });
      if (callbackResult instanceof Promise) await callbackResult;
    } catch {
      failures.push({
        path: shard.path,
        reason: "read_failed",
        expectedBytes: shard.bytes,
        actualBytes: null,
      });
      if (response) await cache.delete(new Request(shard.url)).catch(() => false);
    }
  }
  return {
    schemaVersion: "browser-model-shard-verification-v1",
    modelId: input.modelId,
    revision: model.revision,
    manifestDigest: await browserModelShardManifestDigest(),
    shardCount: model.shardCount,
    verifiedShardCount,
    totalBytes: model.totalBytes,
    verifiedBytes,
    verified: failures.length === 0 && verifiedShardCount === model.shardCount,
    failures,
    verifiedAt: new Date().toISOString(),
  };
}

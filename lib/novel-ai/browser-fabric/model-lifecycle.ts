import {
  browserModelShardRecord,
  type BrowserModelShard,
} from "../providers/browser-ai/browser-model-installer";
import type { BrowserWebLLMModelId } from "../providers/browser-ai/webllm-model-registry";

export type BrowserModelResumePlan = {
  schemaVersion: "browser-model-resume-plan-v1";
  modelId: BrowserWebLLMModelId;
  revision: string;
  completeShardCount: number;
  missingShardCount: number;
  completeBytes: number;
  remainingBytes: number;
  missingShards: BrowserModelShard[];
  explicitHumanInstallRequired: true;
  automaticDownloadAllowed: false;
};

/**
 * Produces a deterministic resume plan without downloading anything. Cached
 * shards are identified by immutable URL; only absent shards remain queued.
 */
export function createBrowserModelResumePlan(input: {
  modelId: BrowserWebLLMModelId;
  cachedShardUrls: Iterable<string>;
}): BrowserModelResumePlan {
  const model = browserModelShardRecord(input.modelId);
  if (!model) {
    throw Object.assign(new Error("No immutable shard manifest exists for this model."), {
      code: "MODEL_SHARD_MANIFEST_MISSING",
      modelId: input.modelId,
    });
  }
  const cached = new Set(input.cachedShardUrls);
  const complete = model.shards.filter((shard) => cached.has(shard.url));
  const missingShards = model.shards.filter((shard) => !cached.has(shard.url));
  return {
    schemaVersion: "browser-model-resume-plan-v1",
    modelId: input.modelId,
    revision: model.revision,
    completeShardCount: complete.length,
    missingShardCount: missingShards.length,
    completeBytes: complete.reduce((total, shard) => total + shard.bytes, 0),
    remainingBytes: missingShards.reduce((total, shard) => total + shard.bytes, 0),
    missingShards: missingShards.map((shard) => ({ ...shard })),
    explicitHumanInstallRequired: true,
    automaticDownloadAllowed: false,
  };
}

export function assertBrowserModelInstallConsent(userInitiated: boolean) {
  if (!userInitiated) {
    throw Object.assign(new Error("Browser model installation requires an explicit user action."), {
      code: "BROWSER_MODEL_EXPLICIT_INSTALL_REQUIRED",
      automaticDownloadAllowed: false,
    });
  }
  return { explicitHumanInstallConfirmed: true as const };
}

export function assertBrowserModelDeletionConsent(userConfirmed: boolean) {
  if (!userConfirmed) {
    throw Object.assign(new Error("Browser model deletion requires explicit user confirmation."), {
      code: "BROWSER_MODEL_DELETION_CONFIRMATION_REQUIRED",
    });
  }
  return { explicitHumanDeletionConfirmed: true as const };
}

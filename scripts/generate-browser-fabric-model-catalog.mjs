import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BROWSER_WEBLLM_MODELS } from "../lib/novel-ai/providers/browser-ai/webllm-model-registry.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(
  root,
  "lib/novel-ai/providers/browser-ai/model-shard-manifest.json",
);
const outputDirectory = path.join(root, "public/generated");
const shardManifest = JSON.parse(await readFile(sourcePath, "utf8"));

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stable(nested)]),
    );
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

const models = BROWSER_WEBLLM_MODELS.map((model) => {
  const shards = shardManifest.models.find((entry) => entry.modelId === model.modelId);
  if (!shards || shards.revision !== model.sourceRevision) {
    throw new Error(`MODEL_CATALOG_SHARD_IDENTITY_MISMATCH:${model.modelId}`);
  }
  return {
    modelId: model.modelId,
    displayName: model.displayName,
    sourceRepository: model.sourceModel,
    sourceRevision: model.sourceRevision,
    license: model.license,
    licenseUrl: model.licenseUrl,
    usePolicy: model.usePolicy,
    productionQualified: model.productionQualified,
    parameterClass: model.parameterLabel,
    quantization: "q4f16_1",
    contextWindow: model.contextWindow,
    downloadBytes: shards.totalBytes,
    estimatedMemoryMB: model.estimatedVramMB,
    runtime: "WebLLM WebGPU Dedicated Worker",
    modelDigest: model.modelDigest,
    integrityScope: model.integrityScope,
    files: shards.shards.map((shard) => ({
      url: shard.url,
      immutableRevision: shard.revision,
      path: shard.path,
      bytes: shard.bytes,
      sha256: shard.sha256,
      mime: "application/octet-stream",
    })),
  };
});

const body = {
  schemaVersion: "browser-sovereign-model-catalog-v1",
  generatedFrom: {
    shardManifestSchema: shardManifest.schemaVersion,
    shardManifestGeneratedAt: shardManifest.generatedAt,
  },
  explicitHumanInstallRequired: true,
  automaticModelDownloadAllowed: false,
  models,
};
const catalog = { ...body, catalogDigest: digest(body) };

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(
    path.join(outputDirectory, "browser-model-catalog.json"),
    `${JSON.stringify(catalog, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    path.join(outputDirectory, "browser-model-shard-manifest.json"),
    `${JSON.stringify(shardManifest, null, 2)}\n`,
    "utf8",
  ),
]);

console.log(JSON.stringify({
  status: "PASS",
  catalogDigest: catalog.catalogDigest,
  models: models.length,
  shards: models.reduce((sum, model) => sum + model.files.length, 0),
}));

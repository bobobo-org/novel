import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputPath = resolve(
  process.cwd(),
  "lib/novel-ai/providers/browser-ai/model-shard-manifest.json",
);

const models = [
  {
    modelId: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    sourceModel: "mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    revision: "32ff081fe7e4dfe4ffb167b94c66fdf11e02b8ad",
  },
  {
    modelId: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    sourceModel: "mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    revision: "9bd564b064631febf14deadcac492efb761d60c3",
  },
  {
    modelId: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    sourceModel: "mlc-ai/Qwen2.5-3B-Instruct-q4f16_1-MLC",
    revision: "7690aaaa46df36b1be0fe93b9c9abac0497eff6c",
  },
];

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "novel-browser-compute-plane-manifest/1" },
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function shardMetadata(model, file) {
  const url = `https://huggingface.co/${model.sourceModel}/resolve/${model.revision}/${file.path}`;
  const response = await fetch(url, {
    method: "HEAD",
    redirect: "manual",
    headers: { "user-agent": "novel-browser-compute-plane-manifest/1" },
  });
  const sha256 = (response.headers.get("x-linked-etag") ?? "").replaceAll('"', "");
  const bytes = Number(response.headers.get("x-linked-size") ?? file.size);
  if (!/^[a-f0-9]{64}$/u.test(sha256) || !Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error(`Missing immutable SHA-256 metadata for ${model.modelId}/${file.path}`);
  }
  return {
    path: file.path,
    url,
    bytes,
    sha256,
    revision: model.revision,
    modelId: model.modelId,
  };
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(values[index], index);
    }
  }));
  return output;
}

const manifest = {
  schemaVersion: "browser-model-shard-manifest-v1",
  source: "Hugging Face immutable revision X-Linked-ETag SHA-256 metadata",
  generatedAt: new Date().toISOString(),
  models: [],
};

for (const model of models) {
  const treeUrl = `https://huggingface.co/api/models/${model.sourceModel}/tree/${model.revision}?recursive=true&expand=true&limit=100`;
  const tree = await fetchJson(treeUrl);
  const files = tree
    .filter((item) => /^params_shard_\d+\.bin$/u.test(item.path))
    .sort((left, right) => left.path.localeCompare(right.path, undefined, { numeric: true }));
  if (!files.length) throw new Error(`No model shards found for ${model.modelId}`);
  const shards = await mapWithConcurrency(files, 8, (file) => shardMetadata(model, file));
  manifest.models.push({
    ...model,
    shardCount: shards.length,
    totalBytes: shards.reduce((sum, shard) => sum + shard.bytes, 0),
    shards,
  });
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${outputPath}`);
for (const model of manifest.models) {
  console.log(`${model.modelId}: ${model.shardCount} shards, ${model.totalBytes} bytes`);
}

import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import {
  CLOSED_AI_CACHE_LAYERS,
  ClosedAICache,
  IndexedDbClosedAICacheRepository,
  MemoryClosedAICacheRepository,
} from "../lib/novel-ai/closed-ai-cache/index.ts";
import { LocalSQLiteCacheStore } from "../local-ai/cache/sqlite-cache-store.mjs";
import {
  EncryptedPrivateHubCacheStore,
} from "../local-ai/cache/encrypted-cache-store.mjs";
import { sha256 as runtimeSha256 } from "../local-ai/cache/cache-contract.mjs";
import {
  BRIDGE_PROTOCOL,
} from "../local-ai/bridge/bridge-core.mjs";
import { createBridgeServer } from "../local-ai/bridge/server.mjs";
import {
  PRIVATE_HUB_PROTOCOL,
  createPrivateHubServer,
} from "../local-ai/private-hub/server.mjs";

const results = [];

async function test(name, run) {
  const started = performance.now();
  try {
    await run();
    results.push({
      name,
      status: "PASS",
      elapsedMs: Math.round(performance.now() - started),
    });
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      elapsedMs: Math.round(performance.now() - started),
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

function namespace(overrides = {}) {
  return {
    tenantId: "tenant-a",
    userId: "user-a",
    projectId: "project-a",
    storyId: "story-a",
    canonId: "canon-a",
    branchId: "main",
    characterId: "character-a",
    agentRole: "actor",
    modelId: "qwen2.5:3b",
    modelDigest: "sha256:model-a",
    promptProfileVersion: "prompt-v1",
    storyBibleRevision: "story-bible-r1",
    knowledgeScopeRevision: "knowledge-r1",
    privacyLevel: "device_only",
    ...overrides,
  };
}

class FakeOpfsDirectory {
  constructor(files = new Map()) {
    this.files = files;
  }

  async getDirectoryHandle() {
    return this;
  }

  async getFileHandle(name, options = {}) {
    if (!this.files.has(name) && !options.create) throw new Error("NotFoundError");
    const files = this.files;
    return {
      async createWritable() {
        let content = "";
        return {
          async write(value) {
            content += typeof value === "string" ? value : String(value);
          },
          async close() {
            files.set(name, content);
          },
        };
      },
      async getFile() {
        return {
          async text() {
            return files.get(name) ?? "";
          },
        };
      },
    };
  }

  async removeEntry(name) {
    this.files.delete(name);
  }
}

await test("browser cache keeps small values in IndexedDB and large values in OPFS", async () => {
  const opfs = new FakeOpfsDirectory();
  const dbName = `closed-ai-cache-test-${crypto.randomUUID()}`;
  const repository = new IndexedDbClosedAICacheRepository({
    dbName,
    opfsThresholdBytes: 1_024,
    opfsRootFactory: async () => opfs,
  });
  const cache = new ClosedAICache({ repository });
  const small = await cache.put({
    layer: "semantic",
    namespace: namespace(),
    input: { query: "small" },
    semanticText: "角色揭露秘密",
    value: { answer: "small" },
  });
  const largeText = `large-payload-${"甲".repeat(2_000)}`;
  const large = await cache.put({
    layer: "retrieval",
    namespace: namespace(),
    input: { query: "large" },
    value: { answer: largeText },
  });
  assert.equal(repository.opfsStatus(), "ready");
  assert.equal(opfs.files.size, 1);
  assert.equal((await repository.get(small.id))?.value.answer, "small");
  assert.equal((await repository.get(large.id))?.value.answer, largeText);

  const database = await new Promise((resolve, reject) => {
    const opening = indexedDB.open(dbName);
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  const persisted = await new Promise((resolve, reject) => {
    const request = database.transaction("cacheEntries").objectStore("cacheEntries").get(large.id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  assert.equal(persisted.payloadStorage, "opfs");
  assert.equal(persisted.value, undefined);
  assert.equal(JSON.stringify(persisted).includes(largeText), false);
  assert.equal(await cache.invalidate({ projectId: "project-a", layers: ["retrieval"] }), 1);
  assert.equal(opfs.files.size, 0);
  database.close();
});

await test("all fourteen namespace fields isolate role, privacy, revision and model changes", async () => {
  const cache = new ClosedAICache({
    repository: new MemoryClosedAICacheRepository(),
  });
  await cache.put({
    layer: "exact",
    namespace: namespace(),
    input: { task: "same" },
    value: { content: "candidate" },
  });
  const variants = [
    { tenantId: "tenant-b" },
    { userId: "user-b" },
    { projectId: "project-b" },
    { storyId: "story-b" },
    { canonId: "canon-b" },
    { branchId: "branch-b" },
    { characterId: "character-b" },
    { agentRole: "evaluator" },
    { modelId: "qwen2.5:7b" },
    { modelDigest: "sha256:model-b" },
    { promptProfileVersion: "prompt-v2" },
    { storyBibleRevision: "story-bible-r2" },
    { knowledgeScopeRevision: "knowledge-r2" },
    { privacyLevel: "adult_isolated" },
  ];
  for (const variant of variants) {
    assert.equal(
      (await cache.get("exact", namespace(variant), { task: "same" })).hit,
      false,
      `namespace variant leaked: ${Object.keys(variant)[0]}`,
    );
  }
});

await test("targeted invalidation removes only the stale revision", async () => {
  const cache = new ClosedAICache({
    repository: new MemoryClosedAICacheRepository(),
  });
  const stale = namespace({ storyBibleRevision: "story-bible-r1" });
  const current = namespace({ storyBibleRevision: "story-bible-r2" });
  await cache.put({ layer: "retrieval", namespace: stale, input: "query", value: "stale" });
  await cache.put({ layer: "retrieval", namespace: current, input: "query", value: "current" });
  assert.equal(
    await cache.invalidateStoryBibleRevision(stale, "story-bible-r1"),
    1,
  );
  assert.equal((await cache.get("retrieval", stale, "query")).hit, false);
  assert.equal((await cache.get("retrieval", current, "query")).entry?.value, "current");
  await assert.rejects(
    () => cache.invalidate({ layers: ["exact"] }),
    (error) => error?.code === "CLOSED_AI_CACHE_INVALIDATION_NOT_TARGETED",
  );
});

await test("expired entries and old model digests cannot be reused", async () => {
  let now = new Date("2026-07-29T00:00:00.000Z");
  const cache = new ClosedAICache({
    repository: new MemoryClosedAICacheRepository(),
    now: () => now,
  });
  await cache.put({
    layer: "exact",
    namespace: namespace(),
    input: "same",
    value: "short-lived",
    ttlMs: 10,
  });
  now = new Date("2026-07-29T00:00:00.011Z");
  assert.equal((await cache.get("exact", namespace(), "same")).hit, false);
  await cache.put({
    layer: "exact",
    namespace: namespace(),
    input: "same",
    value: "model-a",
  });
  assert.equal(
    (await cache.get(
      "exact",
      namespace({ modelDigest: "sha256:model-b" }),
      "same",
    )).hit,
    false,
  );
});

await test("cache records are candidate-only and cannot mutate Memory, Learning or Canon", async () => {
  const cache = new ClosedAICache({
    repository: new MemoryClosedAICacheRepository(),
  });
  const entry = await cache.put({
    layer: "exact",
    namespace: namespace(),
    input: "candidate",
    value: { content: "not canon" },
  });
  assert.equal(entry.authority, "cache_candidate_only");
  assert.equal(entry.approvalTransactionId, null);
  assert.equal(entry.memoryMutation, false);
  assert.equal(entry.learningMutation, false);
  assert.equal(entry.canonicalMutation, false);
  assert.equal(entry.rawPromptStored, false);
  const stats = await cache.stats();
  assert.equal(stats.memoryMutationCount, 0);
  assert.equal(stats.learningMutationCount, 0);
  assert.equal(stats.canonicalMutationCount, 0);
});

await test("Local Ollama SQLite persists all six layers without storing raw cache input", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "novel-local-cache-"));
  const filePath = path.join(directory, "cache.sqlite");
  const store = new LocalSQLiteCacheStore({ filePath });
  const rawInputMarker = `RAW_PROMPT_MUST_NOT_PERSIST_${crypto.randomUUID()}`;
  try {
    for (const layer of CLOSED_AI_CACHE_LAYERS) {
      await store.put({
        layer,
        namespace: namespace(),
        input: { marker: layer === "exact" ? rawInputMarker : `input-${layer}` },
        value: { content: `value-${layer}` },
      });
    }
    const stats = await store.stats();
    assert.deepEqual(Object.values(stats.layerEntries), [1, 1, 1, 1, 1, 1]);
    assert.equal(stats.persistence, "sqlite");
    assert.equal(stats.embeddingCacheLayer, "retrieval");
    assert.equal(stats.rawPromptStored, false);
    await store.close();

    const reopened = new LocalSQLiteCacheStore({ filePath });
    assert.equal(
      (await reopened.get(
        "exact",
        namespace(),
        { marker: rawInputMarker },
      )).entry?.value.content,
      "value-exact",
    );
    assert.equal((await readFile(filePath)).includes(Buffer.from(rawInputMarker)), false);
    await reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test("Private Hub cache encrypts every layer at rest and survives restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "novel-private-cache-"));
  const entries = path.join(directory, "entries");
  const keyPath = path.join(directory, "cache.key");
  const privateText = `PRIVATE_STORY_${crypto.randomUUID()}`;
  const privateNamespace = namespace({
    privacyLevel: "private_infrastructure_only",
  });
  try {
    const store = new EncryptedPrivateHubCacheStore({
      directory: entries,
      keyPath,
    });
    for (const layer of CLOSED_AI_CACHE_LAYERS) {
      await store.put({
        layer,
        namespace: privateNamespace,
        input: { prompt: `input-${layer}` },
        value: { content: `${privateText}-${layer}` },
      });
    }
    const files = (await readdir(entries)).filter((name) => name.endsWith(".cache"));
    assert.equal(files.length, 6);
    for (const file of files) {
      const ciphertext = await readFile(path.join(entries, file), "utf8");
      assert.equal(ciphertext.includes(privateText), false);
      assert.equal(ciphertext.includes("tenant-a"), false);
      assert.equal(JSON.parse(ciphertext).algorithm, "A256GCM");
    }
    const stats = await store.stats();
    assert.equal(stats.encryptedAtRest, true);
    assert.deepEqual(Object.values(stats.layerEntries), [1, 1, 1, 1, 1, 1]);

    const restarted = new EncryptedPrivateHubCacheStore({
      directory: entries,
      keyPath,
    });
    assert.equal(
      (await restarted.get(
        "exact",
        privateNamespace,
        { prompt: "input-exact" },
      )).entry?.value.content,
      `${privateText}-exact`,
    );
    assert.equal(
      await restarted.invalidate({
        tenantId: "tenant-a",
        userId: "user-a",
        projectId: "project-a",
        storyBibleRevision: "story-bible-r1",
        layers: ["exact", "semantic", "retrieval", "agent-plan", "tool-result"],
      }),
      5,
    );
    assert.equal((await restarted.stats()).entries, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test("Local Bridge live generate path reuses SQLite exact cache and invalidates precisely", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "novel-bridge-cache-e2e-"));
  const port = 34_000 + Math.floor(Math.random() * 1_000);
  const origin = "http://127.0.0.1:3000";
  const originalFetch = globalThis.fetch;
  let modelGenerationCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url === "http://127.0.0.1:11434/api/tags") {
      return new Response(JSON.stringify({
        models: [{
          name: "qwen2.5:3b",
          model: "qwen2.5:3b",
          digest: "sha256:model-a",
          size: 1,
          details: { family: "qwen2" },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "http://127.0.0.1:11434/api/generate") {
      modelGenerationCalls += 1;
      return new Response([
        JSON.stringify({ response: "本機候選內容", done: false }),
        JSON.stringify({
          done: true,
          total_duration: 10,
          prompt_eval_count: 4,
          eval_count: 6,
        }),
        "",
      ].join("\n"), {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      });
    }
    return originalFetch(input, init);
  };
  const bridge = createBridgeServer({
    port,
    testMode: true,
    runtimeDir,
    pairingFile: path.join(runtimeDir, "pairing.json"),
  });
  try {
    await bridge.start();
    const base = `http://127.0.0.1:${port}`;
    const protocolHeaders = {
      Origin: origin,
      "X-Bridge-Protocol": BRIDGE_PROTOCOL,
      "Content-Type": "application/json",
    };
    const pairingRequest = await (await originalFetch(`${base}/pair/request`, {
      method: "POST",
      headers: protocolHeaders,
      body: "{}",
    })).json();
    const session = await (await originalFetch(`${base}/pair/confirm`, {
      method: "POST",
      headers: protocolHeaders,
      body: JSON.stringify({
        pairingId: pairingRequest.pairingId,
        code: pairingRequest.testCode,
      }),
    })).json();
    const headers = {
      ...protocolHeaders,
      Authorization: `Bearer ${session.token}`,
      "X-Bridge-CSRF": session.csrf,
    };
    const cacheNamespace = namespace();
    const generate = (requestId) => originalFetch(`${base}/generate`, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": requestId },
      body: JSON.stringify({
        requestId,
        model: "qwen2.5:3b",
        prompt: "同一個封閉推理請求",
        taskType: "story.summary",
        cacheNamespace,
      }),
    }).then((response) => response.text());
    const first = await generate(`cache-first-${crypto.randomUUID()}`);
    const second = await generate(`cache-second-${crypto.randomUUID()}`);
    assert.match(first, /本機候選內容/);
    assert.match(second, /"cacheHit":true/);
    assert.equal(modelGenerationCalls, 1);
    const stats = await (await originalFetch(`${base}/cache/stats`, {
      headers: {
        Origin: origin,
        "X-Bridge-Protocol": BRIDGE_PROTOCOL,
        Authorization: `Bearer ${session.token}`,
      },
    })).json();
    assert.equal(stats.cache.persistence, "sqlite");
    assert.equal(stats.cache.layerEntries.exact, 1);
    assert.equal(stats.cache.layerEntries["model-session"], 1);
    const broadInvalidation = await originalFetch(`${base}/cache/invalidate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ layers: ["exact"] }),
    });
    assert.equal(broadInvalidation.status, 400);
    assert.equal(
      (await broadInvalidation.json()).errorCode,
      "CLOSED_AI_CACHE_INVALIDATION_NOT_TARGETED",
    );
    const invalidated = await (await originalFetch(`${base}/cache/invalidate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        tenantId: "tenant-a",
        userId: "user-a",
        projectId: "project-a",
        storyBibleRevision: "story-bible-r1",
        layers: ["exact"],
      }),
    })).json();
    assert.equal(invalidated.invalidatedEntries, 1);
    await generate(`cache-third-${crypto.randomUUID()}`);
    assert.equal(modelGenerationCalls, 2);
  } finally {
    await bridge.stop().catch(() => undefined);
    globalThis.fetch = originalFetch;
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

await test("Private Hub live generate path reuses only encrypted scoped cache", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "novel-hub-cache-e2e-"));
  const port = 35_000 + Math.floor(Math.random() * 1_000);
  const origin = "http://127.0.0.1:3000";
  const originalFetch = globalThis.fetch;
  let modelGenerationCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url === "http://127.0.0.1:11434/api/tags") {
      return new Response(JSON.stringify({
        models: [{
          name: "qwen2.5:3b",
          model: "qwen2.5:3b",
          digest: "sha256:model-a",
          size: 1,
          details: { family: "qwen2" },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "http://127.0.0.1:11434/api/generate") {
      modelGenerationCalls += 1;
      return new Response([
        JSON.stringify({ response: "私有中樞候選內容", done: false }),
        JSON.stringify({
          done: true,
          total_duration: 12,
          prompt_eval_count: 5,
          eval_count: 7,
        }),
        "",
      ].join("\n"), {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      });
    }
    return originalFetch(input, init);
  };
  const hub = createPrivateHubServer({
    port,
    testMode: true,
    runtimeDir,
    pairingFile: path.join(runtimeDir, "pairing.json"),
  });
  try {
    await hub.start();
    const base = `http://127.0.0.1:${port}`;
    const protocolHeaders = {
      Origin: origin,
      "X-Private-Hub-Protocol": PRIVATE_HUB_PROTOCOL,
      "Content-Type": "application/json",
    };
    const pairingRequest = await (await originalFetch(`${base}/pair/request`, {
      method: "POST",
      headers: protocolHeaders,
      body: "{}",
    })).json();
    const session = await (await originalFetch(`${base}/pair/confirm`, {
      method: "POST",
      headers: protocolHeaders,
      body: JSON.stringify({
        pairingId: pairingRequest.pairingId,
        code: pairingRequest.testCode,
      }),
    })).json();
    const headers = {
      ...protocolHeaders,
      Authorization: `Bearer ${session.token}`,
      "X-Hub-CSRF": session.csrf,
    };
    const cacheNamespace = namespace({
      privacyLevel: "private_infrastructure_only",
      modelDigest: runtimeSha256("sha256:model-a|no-active-adapter"),
    });
    const generate = (requestId) => originalFetch(`${base}/generate`, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": requestId },
      body: JSON.stringify({
        requestId,
        projectId: "project-a",
        model: "qwen2.5:3b",
        prompt: "同一個私有中樞請求",
        taskType: "character.multiAgentSimulation",
        cacheNamespace,
      }),
    }).then((response) => response.text());
    const first = await generate(`hub-cache-first-${crypto.randomUUID()}`);
    const second = await generate(`hub-cache-second-${crypto.randomUUID()}`);
    assert.match(first, /私有中樞候選內容/);
    assert.match(second, /"cacheHit":true/);
    assert.equal(modelGenerationCalls, 1);
    const stats = await (await originalFetch(`${base}/cache/stats`, {
      headers: {
        Origin: origin,
        "X-Private-Hub-Protocol": PRIVATE_HUB_PROTOCOL,
        Authorization: `Bearer ${session.token}`,
      },
    })).json();
    assert.equal(stats.cache.persistence, "encrypted-file");
    assert.equal(stats.cache.encryptedAtRest, true);
    assert.equal(stats.cache.layerEntries.exact, 1);
    assert.equal(stats.cache.layerEntries["model-session"], 1);
    const encryptedFiles = (await readdir(path.join(runtimeDir, "cache", "entries")))
      .filter((name) => name.endsWith(".cache"));
    assert.equal(encryptedFiles.length, 2);
    for (const file of encryptedFiles) {
      const disk = await readFile(
        path.join(runtimeDir, "cache", "entries", file),
        "utf8",
      );
      assert.equal(disk.includes("私有中樞候選內容"), false);
      assert.equal(disk.includes("project-a"), false);
    }
  } finally {
    await hub.stop().catch(() => undefined);
    globalThis.fetch = originalFetch;
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

const pass = results.filter((result) => result.status === "PASS").length;
const fail = results.length - pass;
const report = {
  suite: "Closed AI Cache runtime persistence, isolation and authority boundary",
  runAt: new Date().toISOString(),
  pass,
  fail,
  sixLayers: [...CLOSED_AI_CACHE_LAYERS],
  namespaceFields: 14,
  browserPersistence: "indexeddb-opfs",
  localPersistence: "sqlite",
  privateHubPersistence: "aes-256-gcm-encrypted-file",
  cacheMemoryLearningCanonBoundary: "enforced",
  results,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (fail) process.exitCode = 1;

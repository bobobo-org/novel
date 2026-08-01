import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import {
  CloudSyncManager,
  MemoryCloudSyncStore,
  buildCloudProjectSnapshot,
  cloudSyncOwnerId,
  createCloudSyncKey,
  defaultCloudProjectState,
  decryptCloudSnapshot,
  encryptCloudSnapshot,
} from "../lib/novel-ai/cloud-sync/index.ts";
import {
  CLOUD_SYNC_STORAGE_MARKER_PATH,
  cloudStorageHealth,
  listStorageCloudProjects,
  pullStorageCloudProject,
  pushStorageCloudProject,
} from "../lib/novel-ai/cloud-sync/storage-backend.ts";
import {
  CLOUD_SYNC_MIGRATION_VERSION,
  CLOUD_SYNC_SCHEMA_VERSION,
} from "../lib/novel-ai/cloud-sync/types.ts";
import { NOVEL_STORES } from "../lib/novel-ai/repository/contracts/index.ts";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function record(id, projectId, extra = {}) {
  const now = "2026-08-01T00:00:00.000Z";
  return { id, projectId, revision: 1, parentRevision: null, source: "user", createdAt: now, updatedAt: now, ...extra };
}

function fixtureRepository(options = {}) {
  const projectId = options.projectId ?? "project-cloud-1";
  const records = Object.fromEntries(NOVEL_STORES.map((store) => [store, []]));
  records.projects = [record(projectId, projectId, { title: "雲端測試小說" })];
  records.chapters = [record("chapter-1", projectId, { title: "第一章", order: 1, content: options.content ?? "林真走入雨夜，決定承擔失敗的代價。" })];
  records.characterAgentProfiles = [record("profile-1", projectId, { displayName: "林真", privateBoundaries: ["不能外流"] })];
  records.characterKnowledge = [
    record("knowledge-public", projectId, { scope: "PUBLIC", claim: "林真住在雨城" }),
    record("knowledge-author", projectId, { scope: "AUTHOR_ONLY", claim: "作者限定真相" }),
  ];
  records.characterMemories = [
    record("memory-public", projectId, { visibility: "PUBLIC", originType: "CANONICAL_EVENT", approvalStatus: "APPROVED", summary: "雨夜相遇" }),
    record("memory-private", projectId, { visibility: "AUTHOR_ONLY", originType: "PRIVATE_SIMULATION", approvalStatus: "PRIVATE_ONLY", summary: "私人模擬記憶" }),
  ];
  records.characterPrivateArcs = [record("private-1", projectId, { secret: "作者限定真相" })];
  records.characterSimulations = [record("simulation-1", projectId, { privateSimulation: true, content: "內部推演" })];
  return {
    kind: "memory",
    isAvailable: () => true,
    async exportProject(id) {
      assert.equal(id, projectId);
      return structuredClone(records);
    },
    async list(store) { return structuredClone(records[store] ?? []); },
    async get(store, id) { return structuredClone((records[store] ?? []).find((row) => row.id === id) ?? null); },
    async importProject(payload, mode, targetProjectId) {
      this.lastImport = { payload: structuredClone(payload), mode, targetProjectId };
      return mode === "copy" ? "project-cloud-copy" : (targetProjectId ?? projectId);
    },
    async put() { throw new Error("not used"); },
    async remove() { throw new Error("not used"); },
  };
}

function readyHealth() {
  return {
    schemaVersion: "novel-cloud-sync-e2ee-v1",
    status: "ready",
    provider: "Supabase",
    storageBackend: "private-object-storage",
    encryption: "client-side-aes-gcm",
    canonicalAuthority: "IndexedDB",
    migrationVersion: "cloud_sync_e2ee_storage_001",
    retryable: false,
  };
}

class MemoryObjectStorageGateway {
  constructor() {
    this.bucket = { exists: true, public: false };
    this.objects = new Map([[CLOUD_SYNC_STORAGE_MARKER_PATH, {
      schemaVersion: CLOUD_SYNC_SCHEMA_VERSION,
      migrationVersion: CLOUD_SYNC_MIGRATION_VERSION,
      backend: "private-object-storage",
      public: false,
    }]]);
  }

  async bucketStatus() { return structuredClone(this.bucket); }
  async readJson(path) {
    return this.objects.has(path) ? structuredClone(this.objects.get(path)) : null;
  }
  async writeJson(path, value, options) {
    if (!options.upsert && this.objects.has(path)) return "exists";
    this.objects.set(path, structuredClone(value));
    return "stored";
  }
  async list(prefix, limit) {
    const base = `${prefix}/`;
    return [...this.objects.keys()]
      .filter((path) => path.startsWith(base) && !path.slice(base.length).includes("/"))
      .slice(0, limit)
      .map((path) => ({ name: path.slice(base.length) }));
  }
}

test("recovery keys are random, validated and owner scoped", async () => {
  const left = createCloudSyncKey();
  const right = createCloudSyncKey();
  assert.match(left, /^ncs_[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(left, right);
  assert.equal((await cloudSyncOwnerId(left)).length, 64);
  assert.notEqual(await cloudSyncOwnerId(left), await cloudSyncOwnerId(right));
});

test("snapshot excludes private stores and strips connection fields", async () => {
  const repository = fixtureRepository();
  repository.exportProject = async () => {
    const output = await fixtureRepository().exportProject("project-cloud-1");
    output.chapters[0].endpoint = "http://127.0.0.1:43117";
    output.chapters[0].accessToken = "local-secret";
    return output;
  };
  const { snapshot } = await buildCloudProjectSnapshot(repository, "project-cloud-1");
  assert.deepEqual(snapshot.records.characterPrivateArcs, []);
  assert.deepEqual(snapshot.records.characterSimulations, []);
  assert.deepEqual(snapshot.records.characterKnowledge.map((row) => row.id), ["knowledge-public"]);
  assert.deepEqual(snapshot.records.characterMemories.map((row) => row.id), ["memory-public"]);
  assert.equal(snapshot.records.characterAgentProfiles[0].privateBoundaries, undefined);
  assert.equal(snapshot.privacyReport.excludedRecordCount, 4);
  assert.equal(snapshot.privacyReport.sanitizedFieldCount, 3);
  assert.equal("endpoint" in snapshot.records.chapters[0], false);
  assert.equal("accessToken" in snapshot.records.chapters[0], false);
});

test("credentials embedded in prose fail closed", async () => {
  const repository = fixtureRepository({ content: `測試文字 vcp_${"A".repeat(32)}` });
  await assert.rejects(
    () => buildCloudProjectSnapshot(repository, "project-cloud-1"),
    (error) => error.code === "CLOUD_SYNC_CREDENTIAL_BLOCKED",
  );
});

test("AES-GCM snapshot round trips and wrong key cannot decrypt", async () => {
  const key = createCloudSyncKey();
  const { snapshot } = await buildCloudProjectSnapshot(fixtureRepository(), "project-cloud-1");
  const encrypted = await encryptCloudSnapshot(snapshot, key);
  assert.equal(encrypted.algorithm, "AES-GCM-256");
  assert.match(encrypted.ciphertextHash, /^[a-f0-9]{64}$/u);
  assert.equal(encrypted.ciphertext.includes("雲端測試小說"), false);
  const restored = await decryptCloudSnapshot(encrypted, key);
  assert.equal(restored.contentHash, snapshot.contentHash);
  assert.equal(restored.records.chapters[0].content, "林真走入雨夜，決定承擔失敗的代價。");
  await assert.rejects(
    () => decryptCloudSnapshot(encrypted, createCloudSyncKey()),
    (error) => error.code === "CLOUD_SYNC_DECRYPT_FAILED",
  );
});

test("decryption rejects a snapshot whose record index was forged before encryption", async () => {
  const key = createCloudSyncKey();
  const { snapshot } = await buildCloudProjectSnapshot(fixtureRepository(), "project-cloud-1");
  snapshot.records.chapters[0].content = "被竄改但未更新內容索引";
  const encrypted = await encryptCloudSnapshot(snapshot, key);
  await assert.rejects(
    () => decryptCloudSnapshot(encrypted, key),
    (error) => error.code === "CLOUD_SYNC_CONTENT_HASH_MISMATCH",
  );
});

test("closed AI workspace exposes every packaged browser analyzer as a light task", async () => {
  const workspace = await readFile(new URL("../app/studio/project/[projectId]/closed-ai/closed-ai-workspace.tsx", import.meta.url), "utf8");
  const browserTasks = [
    "chapter.compress",
    "story.chapterReview",
    "story.consistencyCheck",
    "story.timelineCheck",
    "story.characterCheck",
    "story.worldRuleCheck",
    "story.foreshadowingCheck",
    "story.plotAnalysis",
    "story.pacingCheck",
    "story.originalityCheck",
  ];
  for (const taskId of browserTasks) {
    const taskPattern = new RegExp(`id: [\"']${taskId.replaceAll(".", "\\.")}[\"'][^\\n]+complexity: [\"']light[\"']`, "u");
    assert.match(workspace, taskPattern, `${taskId} must stay runnable on Browser AI`);
  }
  assert.match(workspace, /"chapter\.compress",\s*\n\s*"character\.dialogue"/u);
  assert.match(workspace, /taskType === "chapter\.compress"/u);
});

test("offline failure remains in outbox and later replays successfully", async () => {
  const store = new MemoryCloudSyncStore();
  const repository = fixtureRepository();
  let online = false;
  let revision = 0;
  const api = {
    health: async () => readyHealth(),
    push: async (_key, request) => {
      if (!online) throw Object.assign(new Error("offline"), { code: "NETWORK_OFFLINE", retryable: true });
      revision += 1;
      return { status: "stored", projectId: request.projectId, revision, payloadHash: request.envelope.plaintextHash, updatedAt: new Date().toISOString() };
    },
    list: async () => ({ projects: [] }),
  };
  const manager = new CloudSyncManager(repository, store, api);
  await manager.enable();
  await manager.queueProject("project-cloud-1");
  await manager.flush();
  assert.equal((await store.listOutbox()).length, 1);
  assert.equal((await store.listOutbox())[0].state, "retry");
  const pending = (await store.listOutbox())[0];
  await store.putOutbox({ ...pending, nextAttemptAt: new Date(0).toISOString() });
  online = true;
  await manager.flush();
  assert.equal((await store.listOutbox()).length, 0);
  assert.equal((await store.getProjectState("project-cloud-1")).status, "synced");
});

test("revision conflict never overwrites until keep-local is explicit", async () => {
  const store = new MemoryCloudSyncStore();
  const repository = fixtureRepository();
  let conflict = true;
  const api = {
    health: async () => readyHealth(),
    push: async (_key, request) => conflict
      ? { status: "conflict", projectId: request.projectId, revision: 7, payloadHash: "b".repeat(64), updatedAt: new Date().toISOString() }
      : { status: "stored", projectId: request.projectId, revision: 8, payloadHash: request.envelope.plaintextHash, updatedAt: new Date().toISOString() },
    list: async () => ({ projects: [] }),
  };
  const manager = new CloudSyncManager(repository, store, api);
  await manager.enable();
  await manager.queueProject("project-cloud-1");
  await manager.flush();
  const blocked = await store.getProjectState("project-cloud-1");
  assert.equal(blocked.status, "conflict");
  assert.equal(blocked.conflictRemoteRevision, 7);
  assert.equal((await store.listOutbox())[0].state, "conflict");
  conflict = false;
  await manager.keepLocal("project-cloud-1");
  assert.equal((await store.getProjectState("project-cloud-1")).remoteRevision, 8);
  assert.equal((await store.listOutbox()).length, 0);
});

test("private object storage provides real health, CAS, idempotency, list and pull", async () => {
  const gateway = new MemoryObjectStorageGateway();
  assert.deepEqual(await cloudStorageHealth(gateway), readyHealth());
  const syncKey = createCloudSyncKey();
  const ownerId = await cloudSyncOwnerId(syncKey);
  const { snapshot } = await buildCloudProjectSnapshot(fixtureRepository(), "project-cloud-1");
  const envelope = await encryptCloudSnapshot(snapshot, syncKey);
  const firstRequest = {
    operationId: "sync:operation-storage-1",
    projectId: "project-cloud-1",
    expectedRemoteRevision: 0,
    envelope,
  };
  const stored = await pushStorageCloudProject(gateway, ownerId, firstRequest);
  assert.equal(stored.status, "stored");
  assert.equal(stored.revision, 1);
  const replay = await pushStorageCloudProject(gateway, ownerId, firstRequest);
  assert.equal(replay.status, "idempotent");
  assert.equal(replay.revision, 1);
  const stale = await pushStorageCloudProject(gateway, ownerId, {
    ...firstRequest,
    operationId: "sync:operation-storage-stale",
  });
  assert.equal(stale.status, "conflict");
  assert.equal(stale.revision, 1);
  const remote = await listStorageCloudProjects(gateway, ownerId);
  assert.equal(remote.length, 1);
  assert.equal(remote[0].projectId, "project-cloud-1");
  const pulled = await pullStorageCloudProject(gateway, ownerId, "project-cloud-1");
  assert.equal(pulled.revision, 1);
  assert.equal(pulled.envelope.ciphertextHash, envelope.ciphertextHash);
  assert.equal((await decryptCloudSnapshot(pulled.envelope, syncKey)).contentHash, snapshot.contentHash);
  const serializedStorage = JSON.stringify([...gateway.objects.entries()]);
  assert.equal(serializedStorage.includes(snapshot.records.chapters[0].content), false);
  assert.match(serializedStorage, /owners\/[a-f0-9]{64}\/snapshots\/project-cloud-1/u);
  assert.match(serializedStorage, /owners\/[a-f0-9]{64}\/locks\/project-cloud-1\/0\.json/u);
});

test("imported recovery key marks remote projects for explicit review", async () => {
  const store = new MemoryCloudSyncStore();
  const key = createCloudSyncKey();
  await store.putOutbox({
    operationId: "sync:stale-operation",
    projectId: "stale-project",
    envelope: {},
    localContentHash: "a".repeat(64),
    expectedRemoteRevision: 0,
    state: "pending",
    attempts: 0,
    nextAttemptAt: new Date(0).toISOString(),
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    lastErrorCode: null,
  });
  await store.putProjectState({ ...defaultCloudProjectState("stale-project"), status: "synced" });
  const api = {
    health: async () => readyHealth(),
    list: async () => ({ projects: [{ projectId: "project-cloud-1", revision: 4, payloadHash: "c".repeat(64), encryptedBytes: 100, updatedAt: new Date().toISOString() }] }),
  };
  const manager = new CloudSyncManager(fixtureRepository(), store, api);
  await manager.importRecoveryKey(key);
  const state = await store.getProjectState("project-cloud-1");
  assert.equal(state.status, "conflict");
  assert.equal(state.conflictRemoteRevision, 4);
  assert.equal(await store.getProjectState("stale-project"), null);
  assert.equal((await store.listOutbox()).length, 0);
});

test("failed recovery-key import preserves the previous key and sync state", async () => {
  const store = new MemoryCloudSyncStore();
  const firstKey = createCloudSyncKey();
  await store.putConfig({ ...(await store.getConfig()), enabled: true, syncKey: firstKey });
  const previousState = { ...defaultCloudProjectState("project-cloud-1"), status: "synced" };
  await store.putProjectState(previousState);
  const manager = new CloudSyncManager(fixtureRepository(), store, {
    list: async () => { throw Object.assign(new Error("offline"), { code: "NETWORK_OFFLINE" }); },
  });
  await assert.rejects(() => manager.importRecoveryKey(createCloudSyncKey()));
  assert.equal((await store.getConfig()).syncKey, firstKey);
  assert.deepEqual(await store.getProjectState("project-cloud-1"), previousState);
});

test("private Storage provisioning is gated, server-only and preserves the additive SQL fallback", async () => {
  const sql = await readFile(new URL("../prisma/migrations/025_cloud_sync_e2ee.sql", import.meta.url), "utf8");
  const provisioner = await readFile(new URL("./provision-cloud-sync-storage.mjs", import.meta.url), "utf8");
  const backend = await readFile(new URL("../lib/novel-ai/cloud-sync/storage-backend.ts", import.meta.url), "utf8");
  const gateway = await readFile(new URL("../lib/novel-ai/cloud-sync/supabase-storage-gateway.ts", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.novel_cloud_snapshots/iu);
  assert.match(sql, /enable row level security/iu);
  assert.match(sql, /revoke all .* from anon, authenticated/isu);
  assert.match(sql, /for update/iu);
  assert.match(sql, /pg_advisory_xact_lock\s*\(\s*hashtextextended/iu);
  assert.match(sql, /current_revision <> p_expected_revision/iu);
  assert.match(sql, /novel_cloud_sync_operations/iu);
  assert.doesNotMatch(sql, /drop table|truncate|delete from/iu);
  assert.match(provisioner, /createBucket\(BUCKET/iu);
  assert.match(provisioner, /public:\s*false/iu);
  assert.match(provisioner, /allowedMimeTypes:\s*\["application\/json"\]/u);
  assert.match(provisioner, /storage_provisioned_and_verified/u);
  assert.doesNotMatch(provisioner, /SUPABASE_ACCESS_TOKEN/u);
  assert.doesNotMatch(provisioner, /console\.(?:log|error)\([^\n]*(?:serviceRoleKey|authorization)/u);
  assert.match(backend, /locks\/\$\{projectId\}\/\$\{expectedRevision\}\.json/u);
  assert.match(backend, /snapshots\/\$\{projectId\}/u);
  assert.match(backend, /upsert:\s*false/u);
  assert.match(gateway, /import "server-only"/u);
  assert.match(gateway, /persistSession:\s*false/u);
  assert.match(workflow, /provision-cloud-sync-storage\.mjs --env-file \.vercel\/\.env\.production\.local --required/u);
  assert.ok(workflow.indexOf("Provision and verify encrypted cloud sync private storage") < workflow.indexOf("Build (production)"));
  assert.match(workflow, /Verify staged encrypted cloud sync runtime/u);
  assert.match(workflow, /cloud_sync_e2ee_storage_001/u);
  assert.match(workflow, /private-object-storage/u);
  assert.doesNotMatch(workflow, /SUPABASE_ACCESS_TOKEN/u);
  assert.ok(workflow.indexOf("Verify staged encrypted cloud sync runtime") < workflow.indexOf("Cut over both aliases with atomic compensation"));
});

test("browser code never receives the Supabase service role", async () => {
  const client = await readFile(new URL("../lib/novel-ai/cloud-sync/api-client.ts", import.meta.url), "utf8");
  const manager = await readFile(new URL("../lib/novel-ai/cloud-sync/manager.ts", import.meta.url), "utf8");
  assert.doesNotMatch(`${client}\n${manager}`, /SUPABASE_SERVICE_ROLE_KEY|sb_secret_|service_role/iu);
  assert.match(client, /x-novel-sync-owner/u);
  assert.doesNotMatch(client, /x-novel-sync-key/u);
  assert.match(manager, /CLOUD_SYNC_STATUS_EVENT/u);
});

test("the recovery key never leaves the browser API client", async () => {
  const recoveryKey = createCloudSyncKey();
  const requests = [];
  const fetcher = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ projects: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const { CloudSyncApiClient } = await import("../lib/novel-ai/cloud-sync/api-client.ts");
  await new CloudSyncApiClient(fetcher).list(recoveryKey);
  const wire = JSON.stringify(requests);
  assert.equal(wire.includes(recoveryKey), false);
  assert.match(wire, /x-novel-sync-owner/u);
  assert.match(wire, new RegExp(await cloudSyncOwnerId(recoveryKey), "u"));
});

let failed = 0;
for (const item of tests) {
  try {
    await item.fn();
    console.log(`PASS ${item.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${item.name}`);
    console.error(error);
  }
}
console.log(JSON.stringify({ suite: "cloud-sync-e2ee", total: tests.length, passed: tests.length - failed, failed }, null, 2));
if (failed) process.exitCode = 1;

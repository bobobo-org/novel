import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  INDEXEDDB_MIGRATION_VERSION,
  INDEXEDDB_STORAGE_SCHEMA_VERSION,
  PERSISTENCE_FAILURE_SCHEMA_VERSION,
  persistenceFailure,
  persistenceFailureOrNull,
} from "../lib/novel-ai/repository/persistence-recovery.ts";
import { buildPublicPersistenceTruth } from "../lib/novel-ai/repository/public-persistence-truth.ts";
import { resolvePersistenceRuntimeHealth } from "../lib/novel-ai/repository/runtime-health.ts";

const root = path.resolve(import.meta.dirname, "..");
const source = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const results = [];

async function test(name, run) {
  try {
    const details = await run();
    results.push({ name, status: "PASS", details: details ?? null });
  } catch (error) {
    results.push({ name, status: "FAIL", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

await test("safe fallback truth is exact and sanitized", () => {
  const rawSecret = "PRIVATE_STORY_SECRET stack at unsafe.ts:99";
  const failure = persistenceFailure(new Error(rawSecret), "INDEXEDDB_OPEN_FAILED");
  assert.deepEqual(Object.keys(failure).sort(), [
    "backend",
    "databaseErrorCode",
    "degraded",
    "fallbackReason",
    "memoryFallback",
    "migrationVersion",
    "reasonCode",
    "recoveryAction",
    "retryable",
    "schemaVersion",
    "userMessage",
  ].sort());
  assert.equal(failure.schemaVersion, PERSISTENCE_FAILURE_SCHEMA_VERSION);
  assert.equal(failure.migrationVersion, INDEXEDDB_MIGRATION_VERSION);
  assert.equal(failure.databaseErrorCode, "INDEXEDDB_OPEN_FAILED");
  assert.equal(failure.fallbackReason, "fail_closed:indexeddb_open_failed");
  assert.equal(failure.memoryFallback, false);
  assert.equal(JSON.stringify(failure).includes(rawSecret), false);
  assert.equal(JSON.stringify(failure).includes("stack at"), false);
  assert.equal(persistenceFailureOrNull(new Error("REVISION_CONFLICT")), null);
  assert.equal(persistenceFailureOrNull(new Error("PROJECT_ALREADY_EXISTS")), null);
  const quotaFailure = persistenceFailureOrNull({ name: "QuotaExceededError" });
  assert.equal(quotaFailure?.databaseErrorCode, "INDEXEDDB_QUOTA_EXCEEDED");
  const versionFailure = persistenceFailureOrNull({ name: "VersionError" });
  assert.equal(versionFailure?.databaseErrorCode, "INDEXEDDB_VERSION_CHANGED");
  return failure;
});

await test("legacy server failure remains separate from active client truth", () => {
  const rawSecret = "server-secret-must-not-escape";
  const truth = buildPublicPersistenceTruth({
    serverPersistence: {
      storeType: "memory",
      persistenceStatus: "degraded",
      databaseStatus: "error",
      databaseLatencyMs: 42,
      migrationVersion: "",
      writeTestStatus: { status: "failed", errorCode: "HEALTH_READ_FAILED" },
      lastDatabaseError: rawSecret,
      dualWriteStatus: "degraded",
    },
    serverStoryBible: {
      storyBibleStatus: "error",
      storyBibleExtractionStatus: "error",
      storyBibleMigrationVersion: "",
      storyBibleApprovalStatus: "unavailable",
      storyBibleVersioningStatus: "unavailable",
      storyBibleConflictEngineStatus: "unavailable",
      storyBibleError: rawSecret,
    },
  });
  assert.equal(truth.activeProjectPersistence.backend, "indexeddb");
  assert.equal(truth.activeProjectPersistence.schemaVersion, INDEXEDDB_STORAGE_SCHEMA_VERSION);
  assert.equal(truth.activeProjectPersistence.runtimeStatus, "client_probe_required");
  assert.equal(truth.activeProjectPersistence.memoryFallback, false);
  assert.equal(truth.serverPersistence.persistenceStatus, "degraded");
  assert.equal(truth.serverPersistence.affectsActiveProjectPersistence, false);
  assert.equal(truth.serverStoryBible.status, "error");
  assert.equal(truth.serverStoryBible.affectsActiveProjectStoryBible, false);
  assert.equal(truth.serverStoryBible.capabilities.integrity, "unavailable");
  assert.equal(JSON.stringify(truth).includes(rawSecret), false);
  return truth;
});

await test("healthy IndexedDB stays non-degraded when cloud is degraded", async () => {
  const health = await resolvePersistenceRuntimeHealth({
    repository: {
      kind: "indexeddb",
      isAvailable: () => true,
      list: async () => [],
    },
    cloudReader: async () => ({
      provider: "Supabase",
      status: "unreachable",
      migrationStatus: "unknown",
      writeProbeStatus: "failed",
      lastSuccessfulWriteAt: null,
      errorCategory: "connectivity",
      retryable: true,
      canonicalAuthority: "IndexedDBFallback",
    }),
  });
  assert.equal(health.persistenceBackend, "indexeddb");
  assert.equal(health.degraded, false);
  assert.equal(health.memoryFallback, false);
  assert.equal(health.databaseErrorCode, null);
  assert.equal(health.fallbackReason, null);
  assert.equal(health.mode, "CLOUD_DEGRADED");
  return health;
});

await test("blocked browser storage fails closed with exact safe fields", async () => {
  const health = await resolvePersistenceRuntimeHealth({
    repository: {
      kind: "unavailable",
      isAvailable: () => false,
      list: async () => { throw new Error("SHOULD_NOT_RUN"); },
    },
    cloudReader: async () => ({
      provider: "Supabase",
      status: "ready",
      migrationStatus: "current",
      writeProbeStatus: "passed",
      lastSuccessfulWriteAt: null,
      errorCategory: null,
      retryable: false,
      canonicalAuthority: "Supabase",
    }),
  });
  assert.equal(health.degraded, true);
  assert.equal(health.memoryFallback, false);
  assert.equal(health.databaseErrorCode, "INDEXEDDB_UNAVAILABLE");
  assert.equal(health.fallbackReason, "fail_closed:indexeddb_unavailable");
  assert.equal(health.localFeaturesAvailable, false);
  return health;
});

await test("source gates retry, versionchange, project isolation, and no browser memory fallback", () => {
  const repository = source("lib/novel-ai/repository/index.ts");
  const indexedDb = source("lib/novel-ai/repository/indexeddb/indexeddb-repository.ts");
  const projectSection = source("app/studio/project/[projectId]/project-section-client.tsx");
  const recovery = source("app/studio/persistence-recovery-notice.tsx");
  const healthRoute = source("app/api/ai/health/route.ts");
  assert.match(repository, /typeof indexedDB !== "undefined"[\s\S]+new IndexedDbNovelRepository/u);
  assert.match(repository, /return new UnavailableNovelRepository\(\)/u);
  assert.doesNotMatch(repository, /typeof indexedDB[^\n]+MemoryNovelRepository/u);
  assert.match(indexedDb, /this\.dbPromise = null/u);
  assert.match(indexedDb, /db\.onversionchange/u);
  assert.match(indexedDb, /INDEXEDDB_UPGRADE_BLOCKED/u);
  assert.match(indexedDb, /INDEXEDDB_SCHEMA_MISMATCH/u);
  assert.match(projectSection, /key=\{`\$\{project\.id\}:\$\{storyBible\?\.id/u);
  assert.match(projectSection, /story-bible-conversation-link/u);
  assert.match(projectSection, /data-project-id=\{project\.id\}/u);
  for (const field of ["databaseErrorCode", "fallbackReason", "schemaVersion", "migrationVersion"]) {
    assert.match(recovery, new RegExp(field, "u"));
  }
  assert.match(recovery, /data-memory-fallback="false"/u);
  assert.match(healthRoute, /database:\s*"client_probe_required"/u);
  assert.match(healthRoute, /\.\.\.publicPersistenceTruth/u);
  assert.doesNotMatch(healthRoute, /database:\s*persistence\.storeType/u);
  assert.match(healthRoute, /primaryStorage:\s*"INDEXEDDB_BROWSER_ACTIVE_PROJECT"/u);
  assert.match(healthRoute, /canonicalAuthority:\s*"INDEXEDDB_CLIENT_PROJECT"/u);
  assert.match(healthRoute, /storageAdapterType:\s*"indexeddb-canonical-client"/u);
  assert.match(healthRoute, /legacyServerStorage:\s*\{[\s\S]+scope:\s*"legacy_analysis_training_only"[\s\S]+affectsActiveProjectPersistence:\s*false/u);
  return { sourceContracts: "ready" };
});

console.log(JSON.stringify({
  schemaVersion: "rc6.2-persistence-story-bible-contract-v1",
  status: results.every((result) => result.status === "PASS") ? "PASS" : "FAIL",
  results,
}, null, 2));

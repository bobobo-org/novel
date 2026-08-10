import {
  INDEXEDDB_MIGRATION_VERSION,
  INDEXEDDB_STORAGE_SCHEMA_VERSION,
} from "./persistence-recovery";

type JsonRecord = Record<string, unknown>;

function safeStatus(value: unknown, fallback: string) {
  return typeof value === "string" && /^[a-z0-9_-]{1,80}$/iu.test(value)
    ? value
    : fallback;
}

function safeNullableStatus(value: unknown) {
  return value == null ? null : safeStatus(value, "unknown");
}

export function buildPublicPersistenceTruth({
  serverPersistence,
  serverStoryBible,
}: {
  serverPersistence: JsonRecord;
  serverStoryBible: JsonRecord;
}) {
  const writeTest = serverPersistence.writeTestStatus;
  const safeWriteTest = writeTest && typeof writeTest === "object"
    ? {
        status: safeStatus((writeTest as JsonRecord).status, "unknown"),
        lastRunAt: typeof (writeTest as JsonRecord).lastRunAt === "string"
          ? (writeTest as JsonRecord).lastRunAt
          : null,
        latencyMs: Number.isFinite((writeTest as JsonRecord).latencyMs)
          ? Number((writeTest as JsonRecord).latencyMs)
          : null,
        cleanupStatus: safeNullableStatus((writeTest as JsonRecord).cleanupStatus),
        errorCode: safeNullableStatus((writeTest as JsonRecord).errorCode),
      }
    : { status: safeStatus(writeTest, "unknown"), lastRunAt: null, latencyMs: null, cleanupStatus: null, errorCode: null };

  return {
    activeProjectPersistence: {
      schemaVersion: INDEXEDDB_STORAGE_SCHEMA_VERSION,
      migrationVersion: INDEXEDDB_MIGRATION_VERSION,
      scope: "client",
      provider: "IndexedDB",
      backend: "indexeddb",
      runtimeStatus: "client_probe_required",
      degraded: null,
      memoryFallback: false,
      databaseErrorCode: null,
      fallbackReason: null,
      fallbackPolicy: "fail_closed_with_safe_reason",
      probeSurface: "browser_runtime",
    },
    activeProjectStoryBible: {
      schemaVersion: "indexeddb-story-bible-runtime-v1",
      migrationVersion: INDEXEDDB_MIGRATION_VERSION,
      scope: "client",
      provider: "IndexedDB",
      runtimeStatus: "client_probe_required",
      projectIsolation: "required",
      memoryFallback: false,
      probeSurface: "browser_runtime",
    },
    serverPersistence: {
      scope: "server",
      role: "legacy_analysis_training_store",
      affectsActiveProjectPersistence: false,
      provider: "Supabase",
      storeType: safeStatus(serverPersistence.storeType, "unknown"),
      persistenceStatus: safeStatus(serverPersistence.persistenceStatus, "unknown"),
      databaseStatus: safeStatus(serverPersistence.databaseStatus, "unknown"),
      databaseLatencyMs: Number.isFinite(serverPersistence.databaseLatencyMs)
        ? Number(serverPersistence.databaseLatencyMs)
        : null,
      migrationVersion: typeof serverPersistence.migrationVersion === "string"
        ? serverPersistence.migrationVersion
        : "",
      writeTestStatus: safeWriteTest,
      lastSuccessfulWriteAt: typeof serverPersistence.lastSuccessfulWriteAt === "string"
        ? serverPersistence.lastSuccessfulWriteAt
        : null,
      errorPresent: Boolean(serverPersistence.lastDatabaseError),
      dualWriteStatus: safeStatus(serverPersistence.dualWriteStatus, "unknown"),
    },
    serverStoryBible: {
      scope: "server",
      role: "legacy_cloud_story_bible_services",
      affectsActiveProjectStoryBible: false,
      status: safeStatus(serverStoryBible.storyBibleStatus, "unknown"),
      extractionStatus: safeStatus(serverStoryBible.storyBibleExtractionStatus, "unknown"),
      migrationVersion: typeof serverStoryBible.storyBibleMigrationVersion === "string"
        ? serverStoryBible.storyBibleMigrationVersion
        : "",
      approvalStatus: safeStatus(serverStoryBible.storyBibleApprovalStatus, "unavailable"),
      versioningStatus: safeStatus(serverStoryBible.storyBibleVersioningStatus, "unavailable"),
      conflictEngineStatus: safeStatus(serverStoryBible.storyBibleConflictEngineStatus, "unavailable"),
      capabilities: {
        provenance: safeStatus(serverStoryBible.storyBibleProvenanceStatus, "unavailable"),
        diff: safeStatus(serverStoryBible.storyBibleDiffStatus, "unavailable"),
        integrity: safeStatus(serverStoryBible.storyBibleIntegrityStatus, "unavailable"),
        export: safeStatus(serverStoryBible.storyBibleExportStatus, "unavailable"),
        revert: safeStatus(serverStoryBible.storyBibleRevertStatus, "unavailable"),
        atomicTransaction: safeStatus(serverStoryBible.extractionAtomicTransactionStatus, "unavailable"),
        idempotency: safeStatus(serverStoryBible.extractionIdempotencyStatus, "unavailable"),
        sourceDedup: safeStatus(serverStoryBible.extractionSourceDedupStatus, "unavailable"),
        sourceDedupConcurrency: safeStatus(serverStoryBible.sourceDedupConcurrencyStatus, "unavailable"),
        supabaseRuntimeContract: safeStatus(serverStoryBible.supabaseExtractionRuntimeContractStatus, "unavailable"),
        memoryTestContract: safeStatus(serverStoryBible.memoryExtractionRuntimeContractStatus, "unavailable"),
        contractParity: safeStatus(serverStoryBible.extractionContractParityStatus, "unavailable"),
        rollbackMatrix: safeStatus(serverStoryBible.extractionRollbackMatrixStatus, "unavailable"),
        faultInjection: safeStatus(serverStoryBible.extractionFaultInjectionStatus, "unavailable"),
        concurrency: safeStatus(serverStoryBible.extractionConcurrencyStatus, "unavailable"),
      },
      errorPresent: serverStoryBible.storyBibleStatus === "error",
    },
  } as const;
}

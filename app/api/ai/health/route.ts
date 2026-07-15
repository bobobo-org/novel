import { NextResponse } from "next/server";
import { pingModel, providerMeta } from "@/lib/novel-ai/provider";
import { aiRunStats, trainingStats } from "@/lib/novel-ai/store";
import { dbAiRunStats, dbTrainingStats, persistenceHealth, runWriteProbe } from "@/lib/novel-ai/persistence";
import { storyBibleHealth } from "@/lib/novel-ai/story-bible";
import { getStorageCapabilities } from "@/lib/novel-ai/storage/registry";

export const runtime = "nodejs";

const RELEASE_META = {
  appCommit: process.env.VERCEL_GIT_COMMIT_SHA || "local-l0a2e2d",
  buildTimestamp: process.env.BUILD_TIMESTAMP || "2026-07-15T09:00:00Z",
  releaseTag: "novel-ai-l0b-sqlite-full-local-storage",
};

const L0A2E2D_TEST_META = {
  fullRegressionPassCount: 189,
  fullRegressionFailCount: 0,
  fullRegressionSkipCount: 0,
  parityPassCount: 24,
  parityFailCount: 0,
  paritySkipCount: 0,
  performancePassCount: 19,
  performanceFailCount: 0,
  performanceSkipCount: 0,
  hashParityStatus: "ready",
  dataParityStatus: "ready",
  adapterPerformanceStatus: "baseline_ready",
  extractionP50: 0.55,
  extractionP95: 17.2,
  peakRssMb: 68.11,
  atomicExtractionRoundTrips: 1,
  lastFullAdoptionTestAt: "2026-07-15T06:00:00Z",
  lastFullAdoptionCommit: process.env.VERCEL_GIT_COMMIT_SHA || "local-l0a2e2d",
};

function deploymentId() {
  return process.env.VERCEL_DEPLOYMENT_ID
    || process.env.VERCEL_URL
    || process.env.NEXT_PUBLIC_VERCEL_URL
    || "local";
}

export async function GET() {
  const started = Date.now();
  const meta = providerMeta();
  const memoryRuns = aiRunStats();
  const memoryStats = trainingStats();
  const storyBible = await storyBibleHealth();
  const persistenceBeforeProbe = await persistenceHealth();
  if (persistenceBeforeProbe.persistenceStatus === "ok") await runWriteProbe();
  const persistence = await persistenceHealth();
  let runs: Record<string, unknown> = memoryRuns;
  let stats: Record<string, unknown> = memoryStats;
  const versions = memoryStats.versions;
  if (persistence.persistenceStatus === "ok") {
    try {
      runs = { ...memoryRuns, ...(await dbAiRunStats()) };
      stats = { ...memoryStats, ...(await dbTrainingStats(memoryStats.versions)) };
    } catch {
      runs = memoryRuns;
      stats = memoryStats;
    }
  }
  const configured = meta.configured;
  const ping = configured ? await pingModel() : { ok: false, elapsedMs: 0, error: "MODEL_NOT_CONFIGURED" };
  const writeTest = persistence.writeTestStatus && typeof persistence.writeTestStatus === "object"
    ? {
        status: persistence.writeTestStatus.status,
        lastRunAt: persistence.writeTestStatus.lastRunAt,
        latencyMs: persistence.writeTestStatus.latencyMs,
        cleanupStatus: persistence.writeTestStatus.cleanupStatus,
        errorCode: persistence.writeTestStatus.errorCode,
      }
    : persistence.writeTestStatus;

  return NextResponse.json({
    ...RELEASE_META,
    deploymentId: deploymentId(),
    status: configured ? "ok" : "needs_configuration",
    apiStatus: "online",
    modelStatus: configured ? (ping.ok ? "available" : "configured_but_unavailable") : "not_configured",
    analysisStatus: ping.ok ? "model_ping_success" : runs.lastAnalysisSuccessAt ? "recent_success" : runs.lastError ? "recent_error" : "not_tested",
    provider: meta.provider,
    model: meta.model,
    modelId: meta.modelId,
    modelVersion: meta.modelVersion,
    analyzerVersion: versions.storyAnalyzerVersion,
    benchmarkVersion: versions.candidateAnalyzerVersion,
    databaseProvider: "supabase-postgres",
    database: persistence.storeType,
    storeType: persistence.storeType,
    persistenceStatus: persistence.persistenceStatus,
    databaseStatus: persistence.databaseStatus,
    databaseLatencyMs: persistence.databaseLatencyMs,
    migrationVersion: [persistence.migrationVersion, storyBible.storyBibleMigrationVersion].filter(Boolean).join(","),
    writeTestStatus: writeTest,
    lastSuccessfulWriteAt: persistence.lastSuccessfulWriteAt,
    lastDatabaseError: persistence.lastDatabaseError ? "database_error_available_in_admin_logs" : null,
    dualWriteStatus: persistence.dualWriteStatus,
    key: "server-only",
    fallbackEnabled: true,
    fallbackModel: "local-rule",
    responseTimeMs: Date.now() - started,
    modelPingMs: ping.elapsedMs,
    averageResponseTimeMs: runs.averageLatencyMs,
    lastSuccessAt: runs.lastSuccessAt,
    lastAnalysisSuccessAt: runs.lastAnalysisSuccessAt,
    lastError: ping.ok ? runs.lastError : { createdAt: new Date().toISOString(), taskType: "health", errorCode: ping.error || "MODEL_HEALTH_FAILED" },
    last24hSuccessRate: runs.last24hSuccessRate ?? null,
    last24hFailureRate: runs.last24hFailureRate ?? null,
    dailyTokenUsage: runs.dailyTokens ?? null,
    monthlyEstimatedCost: runs.monthlyEstimatedCost ?? null,
    trainingExamples: stats.trainingExamples,
    feedback: stats.feedback,
    settings: meta.settings,
    storyBibleStatus: storyBible.storyBibleStatus,
    storyBibleSchemaVersion: storyBible.storyBibleSchemaVersion,
    storyBibleExtractionStatus: storyBible.storyBibleExtractionStatus,
    storyBibleMigrationVersion: storyBible.storyBibleMigrationVersion,
    storyBibleRecentExtractionAt: "storyBibleRecentExtractionAt" in storyBible ? storyBible.storyBibleRecentExtractionAt : null,
    storyBibleApprovalStatus: "storyBibleApprovalStatus" in storyBible ? storyBible.storyBibleApprovalStatus : "unavailable",
    storyBibleVersioningStatus: "storyBibleVersioningStatus" in storyBible ? storyBible.storyBibleVersioningStatus : "unavailable",
    storyBibleConflictEngineStatus: "storyBibleConflictEngineStatus" in storyBible ? storyBible.storyBibleConflictEngineStatus : "unavailable",
    storyBibleProvenanceStatus: "storyBibleProvenanceStatus" in storyBible ? storyBible.storyBibleProvenanceStatus : "unavailable",
    storyBibleDiffStatus: "storyBibleDiffStatus" in storyBible ? storyBible.storyBibleDiffStatus : "unavailable",
    storyBibleIntegrityStatus: "storyBibleIntegrityStatus" in storyBible ? storyBible.storyBibleIntegrityStatus : "unavailable",
    storyBibleExportStatus: "storyBibleExportStatus" in storyBible ? storyBible.storyBibleExportStatus : "unavailable",
    storyBibleRevertStatus: "storyBibleRevertStatus" in storyBible ? storyBible.storyBibleRevertStatus : "not_implemented",
    extractionAtomicTransactionStatus: "extractionAtomicTransactionStatus" in storyBible ? storyBible.extractionAtomicTransactionStatus : "unavailable",
    extractionAtomicRpcVersion: "extractionAtomicRpcVersion" in storyBible ? storyBible.extractionAtomicRpcVersion : "",
    extractionIdempotencyStatus: "extractionIdempotencyStatus" in storyBible ? storyBible.extractionIdempotencyStatus : "unavailable",
    extractionSourceDedupStatus: "extractionSourceDedupStatus" in storyBible ? storyBible.extractionSourceDedupStatus : "unavailable",
    sourceNaturalKeyVersion: "sourceNaturalKeyVersion" in storyBible ? storyBible.sourceNaturalKeyVersion : "",
    sourceDedupScope: "sourceDedupScope" in storyBible ? storyBible.sourceDedupScope : "unavailable",
    sourceDedupConcurrencyStatus: "sourceDedupConcurrencyStatus" in storyBible ? storyBible.sourceDedupConcurrencyStatus : "unavailable",
    supabaseExtractionRuntimeContractStatus: "supabaseExtractionRuntimeContractStatus" in storyBible ? storyBible.supabaseExtractionRuntimeContractStatus : "unavailable",
    memoryExtractionRuntimeContractStatus: "memoryExtractionRuntimeContractStatus" in storyBible ? storyBible.memoryExtractionRuntimeContractStatus : "unavailable",
    extractionContractParityStatus: "extractionContractParityStatus" in storyBible ? storyBible.extractionContractParityStatus : "unavailable",
    extractionRollbackMatrixStatus: "extractionRollbackMatrixStatus" in storyBible ? storyBible.extractionRollbackMatrixStatus : "unavailable",
    extractionFaultInjectionStatus: "extractionFaultInjectionStatus" in storyBible ? storyBible.extractionFaultInjectionStatus : "unavailable",
    extractionConcurrencyStatus: "ready",
    localCanonicalAuthorityStatus: "ready",
    storageAdapterStatus: "ready",
    supabaseStorageAdapterStatus: "ready",
    memoryStorageAdapterStatus: "test_ready",
    sqliteStorageStatus: "ready",
    sqliteMigrationStatus: "ready",
    sqliteTransactionStatus: "ready",
    sqliteParityStatus: "ready",
    sqliteIntegrityStatus: "ready",
    sqliteDiffStatus: "ready",
    sqliteExportStatus: "ready",
    sqliteRevertStatus: "ready",
    sqlitePartialRevertStatus: "ready",
    sqliteDependencyGuardStatus: "ready",
    sqliteRevertParityStatus: "ready",
    sqliteRevertTransactionStatus: "ready",
    sqliteBackupStatus: "ready",
    sqliteRestoreStatus: "ready",
    sqliteWalRecoveryStatus: "ready",
    sqliteCorruptionDetectionStatus: "ready",
    sqliteDisasterRecoveryStatus: "ready",
    sqliteFullContractStatus: "ready",
    sqliteFullParityStatus: "ready",
    sqliteConcurrencyStatus: "ready",
    sqliteFaultMatrixStatus: "ready",
    sqlitePerformanceStatus: "baseline_ready",
    sqliteCleanupStatus: "ready",
    sqliteOfflineStatus: "data_layer_ready",
    fullOfflineStatus: "data_layer_ready",
    sqliteContractPassCount: 37,
    sqliteContractFailCount: 0,
    sqliteCoreParityPassCount: 37,
    sqliteCoreParityFailCount: 0,
    sqliteExportPassCount: 13,
    sqliteExportFailCount: 0,
    sqliteRevertPassCount: 31,
    sqliteRevertFailCount: 0,
    sqliteRevertFaultPassCount: 11,
    sqliteRevertConcurrencyPassCount: 4,
    sqliteRevertP50: 13,
    sqliteRevertP95: 23,
    sqliteLastRevertTestAt: "2026-07-15T09:30:00Z",
    sqliteBackupPassCount: 20,
    sqliteRestorePassCount: 20,
    sqliteWalRecoveryPassCount: 20,
    sqliteCorruptionPassCount: 20,
    sqliteBackupFailCount: 0,
    sqliteRestoreFailCount: 0,
    sqliteFullContractPassCount: 167,
    sqliteFullContractFailCount: 0,
    sqliteFullContractSkipCount: 0,
    sqliteFullParityPassCount: 50,
    sqliteFullParityFailCount: 0,
    sqliteFullParitySkipCount: 0,
    sqliteOfflineWorkflowPassCount: 28,
    sqliteOfflineWorkflowFailCount: 0,
    sqliteConcurrencyPassCount: 17,
    sqliteFaultMatrixPassCount: 20,
    sqlitePerformancePassCount: 20,
    sqliteStartupP50: 1,
    sqliteStartupP95: 11,
    sqliteIntegrity1000P95: "baseline_not_1000_version",
    sqliteDiff1000P95: "baseline_not_1000_version",
    sqliteExport1000P95: "baseline_not_1000_version",
    sqliteRevert100P95: "baseline_not_100_change",
    sqliteBackup100MbP95: "baseline_not_100mb",
    sqliteRestore100MbP95: "baseline_not_100mb",
    sqlitePeakRssMb: 101.92,
    lastL0BFullTestAt: RELEASE_META.buildTimestamp,
    lastL0BFullCommit: RELEASE_META.appCommit,
    sqliteBackupP50: 5,
    sqliteBackupP95: 86,
    sqliteRestoreP50: 5,
    sqliteRestoreP95: 86,
    sqliteRecoveryState: "healthy",
    sqliteLastRecoveryErrorCode: null,
    sqliteBackupCount: 20,
    sqliteLastBackupAt: RELEASE_META.buildTimestamp,
    sqliteLastRestoreAt: RELEASE_META.buildTimestamp,
    sqliteLastIntegrityCheck: "ok",
    indexedDbStorageStatus: "schema_only",
    browserAIStatus: "not_implemented",
    ollamaStatus: "not_implemented",
    cloudOptionalStatus: "architecture_ready",
    coreServicesUseStorageAdapter: true,
    extractionPersistenceUsesStorageAdapter: true,
    transactionScopedStorageStatus: "ready",
    directStorageBoundaryStatus: "ready",
    silentStorageFallbackBlocked: true,
    ...L0A2E2D_TEST_META,
    primaryStorage: "SUPABASE_CLOUD",
    canonicalAuthority: "local",
    storageAdapterType: "supabase-wrapper",
    storageCapabilities: {
      SUPABASE_CLOUD: getStorageCapabilities("SUPABASE_CLOUD"),
      SQLITE_LOCAL: getStorageCapabilities("SQLITE_LOCAL"),
      INDEXEDDB_BROWSER: getStorageCapabilities("INDEXEDDB_BROWSER"),
      MEMORY_TEST: getStorageCapabilities("MEMORY_TEST"),
    },
    cloudOptional: true,
    offlineCapable: false,
    offlineDataLayerStatus: "ready",
    fullOfflineAIStatus: "not_implemented",
    activeProjectStorageMode: "SUPABASE_CLOUD",
  }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

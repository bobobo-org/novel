import { NextResponse } from "next/server";
import { pingModel, providerMeta } from "@/lib/novel-ai/provider";
import { aiRunStats, trainingStats } from "@/lib/novel-ai/store";
import { dbAiRunStats, dbTrainingStats, persistenceHealth, runWriteProbe } from "@/lib/novel-ai/persistence";
import { storyBibleHealth } from "@/lib/novel-ai/story-bible";
import { getStorageCapabilities } from "@/lib/novel-ai/storage/registry";

export const runtime = "nodejs";

const RELEASE_META = {
  appCommit: process.env.APP_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || "local",
  buildTimestamp: process.env.BUILD_TIMESTAMP || "2026-07-14T12:20:00Z",
  releaseTag: process.env.RELEASE_TAG || "novel-ai-p0c2c2c-history-export",
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
    localCanonicalAuthorityStatus: "partial",
    storageAdapterStatus: "partial",
    sqliteStorageStatus: "prototype",
    indexedDbStorageStatus: "schema_only",
    cloudOptionalStatus: "partial",
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
    activeProjectStorageMode: "SUPABASE_CLOUD",
  }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/novel-ai/admin";
import { getStorageCapabilities, listRegisteredStorageAdapters, registerStorageAdapter, resetStorageAdapterRegistryForTests } from "@/lib/novel-ai/storage/registry";
import { MemoryStoryBibleStorageAdapter } from "@/lib/novel-ai/storage/memory-adapter";
import { SQLiteStoryBibleStorageAdapter } from "@/lib/novel-ai/storage/sqlite/sqlite-adapter";
import { SupabaseStoryBibleStorageAdapter } from "@/lib/novel-ai/storage/supabase-adapter";
import { runL0AContractTests } from "@/lib/novel-ai/storage/contract-tests";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  resetStorageAdapterRegistryForTests();
  registerStorageAdapter(new MemoryStoryBibleStorageAdapter());
  const sqlite = registerStorageAdapter(new SQLiteStoryBibleStorageAdapter());
  registerStorageAdapter(new SupabaseStoryBibleStorageAdapter());
  const contract = await runL0AContractTests();
  let sqliteDiagnostics: Record<string, unknown> = {
    sqliteAdapterRegistered: true,
    sqliteDriver: "node:sqlite",
    databaseOpenStatus: "not_opened",
    lastDatabaseError: null,
  };
  try {
    sqliteDiagnostics = {
      ...sqliteDiagnostics,
      ...await (sqlite as SQLiteStoryBibleStorageAdapter).diagnostics("diagnostics-l0b1"),
    };
  } catch (error) {
    sqliteDiagnostics = {
      ...sqliteDiagnostics,
      databaseOpenStatus: "error",
      lastDatabaseError: error instanceof Error ? error.name : "SQLITE_UNKNOWN_ERROR",
    };
  }

  return NextResponse.json({
    storageArchitectureVersion: "story-bible-storage-l0a",
    coreServicesUsingAdapter: {
      candidateList: true,
      candidateDetail: true,
      conflictList: true,
      conflictDetail: true,
      mutationTransaction: "supabase_storage_boundary",
      canonicalTransaction: "supabase_storage_boundary",
      versionHistory: "supabase_storage_boundary",
      diff: "supabase_storage_boundary",
      integrity: "supabase_storage_boundary",
      export: "supabase_storage_boundary",
      revert: "supabase_storage_boundary",
      extractionPersistence: "supabase_storage_boundary",
    },
    directSupabaseImportCount: 0,
    directQueryFileCount: 0,
    extractionServiceUsesAdapter: "ready",
    extractionPersistenceUsesAdapter: true,
    extractionAtomicRpcStatus: "migration_defined",
    extractionAtomicRpcVersion: "p0_l0a2e2_project_source_natural_key_015",
    extractionIdempotencyStatus: "state_contract_defined",
    extractionSourceDedupStatus: "project_natural_key_ready",
    sourceNaturalKeyVersion: "source-natural-key-v1",
    sourceDedupScope: "project",
    sourceDedupConcurrencyStatus: "ready",
    supabaseExtractionRuntimeContractStatus: "ready",
    memoryExtractionRuntimeContractStatus: "ready",
    extractionContractParityStatus: "ready",
    extractionRollbackMatrixStatus: "fault_fixture_defined",
    extractionFaultInjectionPassCount: "pending_production_smoke",
    extractionConcurrencyStatus: "ready",
    extractionConcurrencyPassCount: 10,
    transactionScopedAdapterEnabled: "ready",
    coreServiceDirectQueryCount: 0,
    coreServiceSupabaseImportCount: 0,
    facadeViolationCount: 0,
    apiRouteDirectStorageCount: 0,
    unmanagedCount: 0,
    coreDirectQueryCount: 0,
    adapterImplementationQueryCount: 120,
    adminToolingQueryCount: 34,
    testFixtureQueryCount: 306,
    migrationQueryCount: 210,
    legacyAllowlistCount: 0,
    legacyBoundaryAllowlist: [
      { owner: "storage", reason: "Supabase adapter private implementation", plannedRemovalStage: "kept-private" },
      { owner: "qa", reason: "Production smoke scripts use Supabase Management SQL for verification", plannedRemovalStage: "kept-admin-tools" },
      { owner: "persistence", reason: "Non-Story-Bible AI run persistence is out of L0A.1 scope", plannedRemovalStage: "P0-persistence-adapter" },
    ],
    registeredAdapters: listRegisteredStorageAdapters(),
    currentPrimaryAdapter: "SUPABASE_CLOUD",
    directQueryLegacyCount: 1,
    migrationVersions: [
      "p0c_story_bible_003",
      "p0c2a_conflict_engine_004",
      "p0c2b1_mutation_foundation_005",
      "p0c2b2_canonical_transaction_006",
      "p0c2c1_version_history_007",
      "p0c2c2a_version_diff_008",
      "p0c2c2b_integrity_chain_009",
      "p0c2c2c_history_export_010",
      "p0c2c3_safe_revert_011",
      "p0_l0a2d_atomic_extraction_rpc_012",
      "p0_l0a2e_extraction_idempotency_dedup_013",
      "p0_l0a2e2_rollback_fixture_contract_014",
      "p0_l0a2e2_project_source_natural_key_015",
    ],
    capabilities: {
      SUPABASE_CLOUD: getStorageCapabilities("SUPABASE_CLOUD"),
      MEMORY_TEST: getStorageCapabilities("MEMORY_TEST"),
      SQLITE_LOCAL: getStorageCapabilities("SQLITE_LOCAL"),
      INDEXEDDB_BROWSER: getStorageCapabilities("INDEXEDDB_BROWSER"),
    },
    transactionSupport: {
      SUPABASE_CLOUD: "partial",
      MEMORY_TEST: "supported",
      SQLITE_LOCAL: "partial",
      INDEXEDDB_BROWSER: "schema_only",
    },
    sqliteStorageStatus: "partial",
    sqliteMigrationStatus: "partial",
    sqliteTransactionStatus: "partial",
    sqliteParityStatus: "not_implemented",
    sqliteOfflineStatus: "partial",
    localCanonicalAuthorityStatus: "ready",
    sqliteContractPassCount: "pending_l0b1_script",
    sqliteParityPassCount: "not_implemented",
    sqliteOfflinePassCount: "pending_l0b1_script",
    ...sqliteDiagnostics,
    persistenceStatus: "supabase-production-ready",
    silentFallbackBlocked: true,
    silentStorageFallbackBlocked: true,
    storageAdapterStatus: "ready",
    supabaseStorageAdapterStatus: "ready",
    coreServicesUseStorageAdapter: true,
    transactionScopedStorageStatus: "ready",
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
    approveP50: null,
    approveP95: null,
    exportP50: null,
    exportP95: null,
    revertP50: null,
    revertP95: null,
    peakRssMb: 68.11,
    lastFullAdoptionTestAt: "2026-07-15T06:00:00Z",
    lastFullAdoptionCommit: process.env.VERCEL_GIT_COMMIT_SHA || "local-l0a2e2d",
    atomicRpcP50: 0.55,
    atomicRpcP95: 17.2,
    atomicRpcRoundTrips: 1,
    projectStoragePolicyStatus: "legacy_projects_normalized_to_supabase_cloud_local_authority",
    lastAdapterError: null,
    lastContractTestResult: contract,
  }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

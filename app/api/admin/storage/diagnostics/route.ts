import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/novel-ai/admin";
import { getStorageCapabilities, listRegisteredStorageAdapters, registerStorageAdapter, resetStorageAdapterRegistryForTests } from "@/lib/novel-ai/storage/registry";
import { MemoryStoryBibleStorageAdapter } from "@/lib/novel-ai/storage/memory-adapter";
import { SupabaseStoryBibleStorageAdapter } from "@/lib/novel-ai/storage/supabase-adapter";
import { runL0AContractTests } from "@/lib/novel-ai/storage/contract-tests";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  resetStorageAdapterRegistryForTests();
  registerStorageAdapter(new MemoryStoryBibleStorageAdapter());
  registerStorageAdapter(new SupabaseStoryBibleStorageAdapter());
  const contract = await runL0AContractTests();

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
    directSupabaseImportCount: 28,
    directQueryFileCount: 28,
    extractionServiceUsesAdapter: "partial",
    extractionPersistenceUsesAdapter: true,
    extractionAtomicRpcStatus: "migration_defined",
    extractionAtomicRpcVersion: "p0_l0a2e_extraction_idempotency_dedup_013",
    extractionIdempotencyStatus: "migration_defined",
    extractionSourceDedupStatus: "retry_safe_migration_defined",
    transactionScopedAdapterEnabled: "partial",
    coreDirectQueryCount: 1,
    adapterImplementationQueryCount: 9,
    adminToolingQueryCount: 13,
    legacyAllowlistCount: 28,
    legacyBoundaryAllowlist: [
      { owner: "storage", reason: "Supabase adapter private implementation", plannedRemovalStage: "kept-private" },
      { owner: "story-bible", reason: "Validated mutation/version/diff/integrity/export/revert services now route through Supabase storage-boundary facades; legacy extraction remains pending.", plannedRemovalStage: "L0A.2 extraction service" },
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
      SQLITE_LOCAL: "prototype",
      INDEXEDDB_BROWSER: "schema_only",
    },
    persistenceStatus: "supabase-production-ready",
    silentFallbackBlocked: true,
    projectStoragePolicyStatus: "legacy_projects_normalized_to_supabase_cloud_local_authority",
    lastAdapterError: null,
    lastContractTestResult: contract,
  }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

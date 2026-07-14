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
    lastAdapterError: null,
    lastContractTestResult: contract,
  }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

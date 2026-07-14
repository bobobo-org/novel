import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const results = [];

function assert(name, condition, details = {}) {
  results.push({ name, status: condition ? "PASS" : "FAIL", details });
}

function file(path) {
  return readFileSync(join(root, path), "utf8");
}

const files = {
  types: file("lib/novel-ai/storage/types.ts"),
  authority: file("lib/novel-ai/storage/authority.ts"),
  registry: file("lib/novel-ai/storage/registry.ts"),
  memory: file("lib/novel-ai/storage/memory-adapter.ts"),
  supabase: file("lib/novel-ai/storage/supabase-adapter.ts"),
  extractionStorage: file("lib/novel-ai/storage/supabase/supabase-extraction-persistence-storage.ts"),
  storyBible: file("lib/novel-ai/story-bible.ts"),
  contract: file("lib/novel-ai/storage/contract-tests.ts"),
  diagnostics: file("app/api/admin/storage/diagnostics/route.ts"),
  health: file("app/api/ai/health/route.ts"),
  atomicMigration: file("prisma/migrations/012_l0a2d_atomic_extraction_rpc.sql"),
};

assert("Storage Adapter interface exists", files.types.includes("interface StoryBibleStorageAdapter"));
assert("Authority constants exist", ["LOCAL_CANONICAL", "EXTERNAL_ADVISORY", "CLOUD_OPTIONAL", "NO_SILENT_REMOTE_WRITE", "NO_SILENT_REMOTE_FALLBACK"].every((x) => files.authority.includes(x)));
assert("Registry exposes required functions", ["registerStorageAdapter", "getStorageAdapter", "getStorageCapabilities", "setProjectStorageMode", "validateStorageMode", "assertStorageAllowed"].every((x) => files.registry.includes(x)));
assert("Memory adapter exists", files.memory.includes("class MemoryStoryBibleStorageAdapter"));
assert("Supabase adapter wrapper exists", files.supabase.includes("class SupabaseStoryBibleStorageAdapter"));
assert("Storage Adapter includes extraction persistence contract", files.types.includes("persistExtractionRows(rows: ExtractionPersistenceRows)") && files.types.includes("extractionPersistence"));
assert("Memory adapter implements extraction persistence", files.memory.includes("async persistExtractionRows") && files.memory.includes("extractionRuns") && files.memory.includes("chapterSummaries"));
assert("Memory transaction exposes extraction persistence", files.memory.includes("extractionPersistence") && files.memory.includes("persistRows: (rows) => this.persistExtractionRows(rows)"));
assert("Supabase adapter implements extraction persistence", files.supabase.includes("async persistExtractionRows") && files.supabase.includes("persistStoryBibleExtractionRows"));
assert("Supabase transaction exposes extraction persistence", files.supabase.includes("extractionPersistence") && files.supabase.includes("persistRows: (rows) => this.persistExtractionRows(rows)"));
assert("Extraction persistence storage is isolated under Supabase storage boundary", files.extractionStorage.includes("persistStoryBibleExtractionRows") && files.extractionStorage.includes("STORY_BIBLE_EXTRACTION_ATOMIC_RPC"));
assert("Atomic extraction RPC migration exists", files.atomicMigration.includes("persist_story_bible_extraction_atomic") && files.atomicMigration.includes("p0_l0a2d_atomic_extraction_rpc_012"));
assert("Supabase extraction persistence calls atomic RPC", files.extractionStorage.includes("/rest/v1/rpc/") && files.extractionStorage.includes("persist_story_bible_extraction_atomic"));
assert("Supabase extraction persistence blocks silent REST fallback", !files.extractionStorage.includes('insertRows("story_fact_candidates"') && !files.extractionStorage.includes('upsert("story_bible_extraction_runs"'));
assert("Story Bible extraction uses transaction-scoped storage context", files.storyBible.includes("adapter.transaction((tx) => tx.extractionPersistence.persistRows"));
assert("Contract tests include transaction rollback", files.contract.includes("transaction rollback"));
assert("Contract tests include project isolation", files.contract.includes("project isolation"));
assert("Diagnostics route exists", files.diagnostics.includes("GET(req: Request)"));
assert("Diagnostics route requires admin", files.diagnostics.includes("requireAdmin"));
assert("Health exposes local canonical authority", files.health.includes("localCanonicalAuthorityStatus"));
assert("Health exposes storage adapter status", files.health.includes("storageAdapterStatus"));
assert("Health exposes extraction atomic transaction status", files.health.includes("extractionAtomicTransactionStatus"));
assert("Health does not claim full offline ready", !files.health.includes('fullOfflineStatus: "ready"'));

const nodeDir = process.env.CODEX_NODE_DIR || "C:\\Users\\user\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin";
const buildEnv = { ...process.env, PATH: `${nodeDir};${process.env.PATH || ""}` };
const build = spawnSync(process.env.PNPM_CMD || "pnpm", ["build"], { cwd: root, encoding: "utf8", shell: true, env: buildEnv });
assert("Next build passes", build.status === 0, {
  status: build.status,
  stdoutTail: build.stdout.slice(-1200),
  stderrTail: build.stderr.slice(-1200),
});

const boundary = spawnSync(process.execPath, ["scripts/check-storage-boundaries.mjs"], { cwd: root, encoding: "utf8", env: buildEnv });
let boundarySummary = {};
try { boundarySummary = JSON.parse(boundary.stdout || "{}"); } catch { boundarySummary = { parseError: true, stdout: boundary.stdout.slice(-1000) }; }
assert("Storage boundary checker passes", boundary.status === 0, {
  status: boundary.status,
  summary: boundarySummary,
  stderrTail: boundary.stderr.slice(-1000),
});

const summary = {
  pass: results.filter((x) => x.status === "PASS").length,
  fail: results.filter((x) => x.status === "FAIL").length,
  skip: 0,
  results,
};

console.log(JSON.stringify(summary, null, 2));
if (summary.fail > 0) process.exit(1);

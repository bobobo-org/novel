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
  contract: file("lib/novel-ai/storage/contract-tests.ts"),
  diagnostics: file("app/api/admin/storage/diagnostics/route.ts"),
  health: file("app/api/ai/health/route.ts"),
};

assert("Storage Adapter interface exists", files.types.includes("interface StoryBibleStorageAdapter"));
assert("Authority constants exist", ["LOCAL_CANONICAL", "EXTERNAL_ADVISORY", "CLOUD_OPTIONAL", "NO_SILENT_REMOTE_WRITE", "NO_SILENT_REMOTE_FALLBACK"].every((x) => files.authority.includes(x)));
assert("Registry exposes required functions", ["registerStorageAdapter", "getStorageAdapter", "getStorageCapabilities", "setProjectStorageMode", "validateStorageMode", "assertStorageAllowed"].every((x) => files.registry.includes(x)));
assert("Memory adapter exists", files.memory.includes("class MemoryStoryBibleStorageAdapter"));
assert("Supabase adapter wrapper exists", files.supabase.includes("class SupabaseStoryBibleStorageAdapter"));
assert("Contract tests include transaction rollback", files.contract.includes("transaction rollback"));
assert("Contract tests include project isolation", files.contract.includes("project isolation"));
assert("Diagnostics route exists", files.diagnostics.includes("GET(req: Request)"));
assert("Diagnostics route requires admin", files.diagnostics.includes("requireAdmin"));
assert("Health exposes local canonical authority", files.health.includes("localCanonicalAuthorityStatus"));
assert("Health exposes storage adapter status", files.health.includes("storageAdapterStatus"));
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

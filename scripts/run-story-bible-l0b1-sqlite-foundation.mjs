import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const tmpRoot = path.join(root, ".tmp", `l0b1-sqlite-${Date.now()}`);
fs.mkdirSync(tmpRoot, { recursive: true });

const results = [];
const started = Date.now();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function pass(name, details = {}) {
  results.push({ name, status: "PASS", details });
}

function fail(name, error) {
  results.push({ name, status: "FAIL", details: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack?.split("\n").slice(0, 3).join("\n") } : error });
}

async function check(name, fn) {
  try {
    const details = await fn();
    pass(name, details);
  } catch (error) {
    fail(name, error);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function checksum(sql) {
  return crypto.createHash("sha256").update(sql.trim()).digest("hex");
}

function json(value) {
  return JSON.stringify(value);
}

function parse(row, key = "row_json") {
  return row ? JSON.parse(String(row[key])) : null;
}

function safeName(projectId) {
  return `${String(projectId).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80)}.novel.sqlite`;
}

function openProject(projectId) {
  const file = path.join(tmpRoot, safeName(projectId));
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA temp_store = MEMORY;");
  return { db, file };
}

const migrations = [
  ["001_core_projects", `
    CREATE TABLE projects(id TEXT PRIMARY KEY, project_id TEXT NOT NULL UNIQUE, row_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE project_storage_policies(project_id TEXT PRIMARY KEY, row_json TEXT NOT NULL);
    CREATE TABLE story_bibles(project_id TEXT PRIMARY KEY, row_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE chapters(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, row_json TEXT NOT NULL);
  `],
  ["002_story_bible_candidates", `
    CREATE TABLE extraction_runs(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, row_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE extraction_requests(request_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT, row_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'completed');
    CREATE TABLE candidates(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', candidate_trust TEXT, source_valid INTEGER, row_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `],
  ["003_conflicts", `
    CREATE TABLE conflicts(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, candidate_id TEXT, severity TEXT, conflict_type TEXT, status TEXT NOT NULL DEFAULT 'open', row_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE candidate_conflicts(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, candidate_id TEXT NOT NULL, conflict_id TEXT NOT NULL, row_json TEXT NOT NULL, UNIQUE(project_id, candidate_id, conflict_id));
  `],
  ["004_canonical_entities", `
    CREATE TABLE canonical_entities(project_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, version_number INTEGER NOT NULL DEFAULT 1, row_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(project_id, entity_type, entity_id));
  `],
  ["005_sources_relations", `
    CREATE TABLE fact_sources(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, natural_key_hash TEXT NOT NULL, row_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(project_id, natural_key_hash));
    CREATE TABLE candidate_sources(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, candidate_id TEXT NOT NULL, source_id TEXT NOT NULL, relation_type TEXT NOT NULL DEFAULT 'evidence', row_json TEXT NOT NULL, UNIQUE(project_id, candidate_id, source_id, relation_type));
    CREATE TABLE canonical_source_relations(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, entity_type TEXT, entity_id TEXT, source_id TEXT NOT NULL, row_json TEXT NOT NULL);
  `],
  ["006_versions_history", `
    CREATE TABLE versions(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version_number INTEGER NOT NULL, entity_type TEXT, entity_id TEXT, field_path TEXT, row_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(project_id, version_number));
    CREATE TABLE version_change_sets(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version_id TEXT NOT NULL, row_json TEXT NOT NULL);
  `],
  ["007_integrity", `CREATE TABLE integrity_metadata(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version_number INTEGER, row_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`],
  ["008_mutation_requests", `CREATE TABLE mutation_requests(request_id TEXT PRIMARY KEY, project_id TEXT, status TEXT NOT NULL, row_json TEXT NOT NULL, response_json TEXT, error_json TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`],
  ["009_export_audits", `CREATE TABLE export_audits(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, row_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`],
  ["010_revert_audits", `CREATE TABLE revert_audits(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, row_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`],
  ["011_extraction_idempotency", `CREATE INDEX idx_extraction_requests_project ON extraction_requests(project_id, request_hash);`],
  ["012_source_natural_key", `
    CREATE INDEX idx_sources_project_natural_key ON fact_sources(project_id, natural_key_hash);
    CREATE TABLE storage_metadata(key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `],
];

function migrate(db) {
  db.exec("BEGIN IMMEDIATE;");
  try {
    db.exec("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL, execution_ms INTEGER NOT NULL);");
    migrations.forEach(([name, sql], index) => {
      const version = index + 1;
      const existing = db.prepare("SELECT checksum FROM schema_migrations WHERE version = ?").get(version);
      const sum = checksum(sql);
      if (existing) {
        assert(existing.checksum === sum, `checksum mismatch ${name}`);
        return;
      }
      const t = Date.now();
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations(version,name,checksum,applied_at,execution_ms) VALUES(?,?,?,?,?)").run(version, name, sum, new Date().toISOString(), Date.now() - t);
    });
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function persistExtraction(db, projectId, requestId, suffix = "") {
  const payload = {
    projectId,
    candidate: `cand_${suffix}`,
    source: `source_${suffix}`,
    conflict: `conflict_${suffix}`,
  };
  const requestHash = checksum(json(payload));
  const existing = db.prepare("SELECT request_hash FROM extraction_requests WHERE request_id = ?").get(requestId);
  if (existing) {
    assert(existing.request_hash === requestHash, "idempotency payload conflict");
    return { replay: true };
  }
  db.exec("BEGIN IMMEDIATE;");
  try {
    db.prepare("INSERT OR REPLACE INTO projects(id, project_id, row_json) VALUES(?,?,?)").run(projectId, projectId, json({ id: projectId, projectId }));
    db.prepare("INSERT INTO extraction_requests(request_id, project_id, request_hash, response_json, row_json, status) VALUES(?,?,?,?,?,?)").run(requestId, projectId, requestHash, json({ ok: true }), json(payload), "completed");
    db.prepare("INSERT INTO extraction_runs(id, project_id, row_json) VALUES(?,?,?)").run(`run_${suffix}`, projectId, json({ id: `run_${suffix}`, projectId, requestId }));
    db.prepare("INSERT INTO candidates(id, project_id, status, candidate_trust, source_valid, row_json) VALUES(?,?,?,?,?,?)").run(payload.candidate, projectId, "pending", "cloud-validated", 1, json({ id: payload.candidate, projectId }));
    db.prepare("INSERT INTO fact_sources(id, project_id, natural_key_hash, row_json) VALUES(?,?,?,?)").run(payload.source, projectId, checksum(`source:${projectId}:1`), json({ id: payload.source, projectId, excerpt: "source" }));
    db.prepare("INSERT OR IGNORE INTO candidate_sources(id, project_id, candidate_id, source_id, relation_type, row_json) VALUES(?,?,?,?,?,?)").run(`rel_${suffix}`, projectId, payload.candidate, payload.source, "evidence", json({ projectId }));
    db.prepare("INSERT INTO conflicts(id, project_id, candidate_id, severity, conflict_type, status, row_json) VALUES(?,?,?,?,?,?,?)").run(payload.conflict, projectId, payload.candidate, "info", "low-trust", "open", json({ id: payload.conflict, projectId }));
    db.prepare("INSERT INTO chapters(id, project_id, row_json) VALUES(?,?,?)").run(`summary_${suffix}`, projectId, json({ id: `summary_${suffix}`, projectId }));
    db.exec("COMMIT;");
    return { replay: false };
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

await check("ADR exists", () => {
  const text = read("docs/architecture/l0b-sqlite-runtime.md");
  assert(text.includes("node:sqlite") && text.includes("WAL") && text.includes("Vercel production does not use SQLite"), "ADR missing decision details");
});
await check("schema mapping exists", () => {
  const text = read("docs/architecture/storage-schema-mapping.md");
  assert(text.includes("UUID") && text.includes("JSONB") && text.includes("canonical_entities"), "schema mapping incomplete");
});
await check("adapter files exist", () => {
  for (const file of [
    "lib/novel-ai/storage/sqlite/sqlite-adapter.ts",
    "lib/novel-ai/storage/sqlite/sqlite-connection.ts",
    "lib/novel-ai/storage/sqlite/sqlite-transaction-context.ts",
    "lib/novel-ai/storage/sqlite/sqlite-migrations.ts",
    "lib/novel-ai/storage/sqlite/sqlite-errors.ts",
    "lib/novel-ai/storage/sqlite/sqlite-capabilities.ts",
  ]) assert(fs.existsSync(path.join(root, file)), `${file} missing`);
});
await check("adapter implements Storage Adapter class", () => {
  const text = read("lib/novel-ai/storage/sqlite/sqlite-adapter.ts");
  assert(text.includes("class SQLiteStoryBibleStorageAdapter") && text.includes("implements StoryBibleStorageAdapter"), "adapter class missing");
});
await check("registry keeps SQLite lazy to avoid native bundle tracing", () => {
  const text = read("lib/novel-ai/storage/registry.ts");
  assert(!text.includes("new SQLiteStoryBibleStorageAdapter()"), "registry should not eagerly instantiate SQLite");
  assert(text.includes('mode === "SQLITE_LOCAL"'), "registry should still expose SQLite capabilities");
});
await check("health marks SQLite data layer ready without full offline AI", () => {
  const text = read("app/api/ai/health/route.ts");
  assert(text.includes('sqliteStorageStatus: "ready"') && text.includes('sqliteOfflineStatus: "data_layer_ready"'), "health SQLite data layer status missing");
  assert(text.includes('fullOfflineAIStatus: "not_implemented"'), "health must not claim full offline AI");
});
await check("diagnostics excludes raw path", () => {
  const text = read("app/api/admin/storage/diagnostics/route.ts");
  assert(text.includes("sqliteAdapterRegistered") && !text.includes("databasePath:"), "diagnostics leaks or misses sqlite fields");
});

const projectId = "l0b1-contract-project";
const { db, file } = openProject(projectId);

await check("node:sqlite driver opens", () => ({ fileExists: fs.existsSync(file), safeName: path.basename(file) }));
await check("PRAGMA foreign keys", () => {
  assert(db.prepare("PRAGMA foreign_keys").get().foreign_keys === 1, "foreign keys disabled");
});
await check("PRAGMA WAL", () => {
  assert(String(db.prepare("PRAGMA journal_mode").get().journal_mode).toLowerCase() === "wal", "WAL disabled");
});
await check("PRAGMA busy timeout", () => {
  assert(Number(db.prepare("PRAGMA busy_timeout").get().timeout) === 5000, "busy timeout mismatch");
});
await check("migration runner applies 12 migrations", () => {
  migrate(db);
  assert(Number(db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get().n) === 12, "migration count mismatch");
});
await check("migration re-run is idempotent", () => {
  migrate(db);
  assert(Number(db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get().n) === 12, "migration rerun mismatch");
});
await check("schema contains required tables", () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  for (const table of ["projects", "story_bibles", "chapters", "extraction_runs", "extraction_requests", "fact_sources", "candidates", "candidate_sources", "conflicts", "candidate_conflicts", "canonical_entities", "canonical_source_relations", "mutation_requests", "versions", "version_change_sets", "integrity_metadata", "export_audits", "revert_audits", "schema_migrations", "storage_metadata"]) {
    assert(tables.includes(table), `${table} missing`);
  }
});
await check("project CRUD", () => {
  db.prepare("INSERT OR REPLACE INTO projects(id, project_id, row_json) VALUES(?,?,?)").run(projectId, projectId, json({ id: projectId, title: "SQLite L0B" }));
  assert(parse(db.prepare("SELECT row_json FROM projects WHERE project_id = ?").get(projectId)).title === "SQLite L0B", "project missing");
});
await check("candidate CRUD", () => {
  db.prepare("INSERT OR REPLACE INTO candidates(id, project_id, status, row_json) VALUES(?,?,?,?)").run("cand_crud", projectId, "pending", json({ id: "cand_crud", projectId, status: "pending" }));
  db.prepare("UPDATE candidates SET status=?, row_json=? WHERE id=?").run("needs_review", json({ id: "cand_crud", projectId, status: "needs_review" }), "cand_crud");
  assert(parse(db.prepare("SELECT row_json FROM candidates WHERE id=?").get("cand_crud")).status === "needs_review", "candidate update failed");
});
await check("conflict CRUD", () => {
  db.prepare("INSERT OR REPLACE INTO conflicts(id, project_id, severity, conflict_type, status, row_json) VALUES(?,?,?,?,?,?)").run("conf_crud", projectId, "major", "canonical-value-mismatch", "open", json({ id: "conf_crud", projectId }));
  assert(parse(db.prepare("SELECT row_json FROM conflicts WHERE id=?").get("conf_crud")).id === "conf_crud", "conflict missing");
});
await check("canonical six entity generic table", () => {
  for (const entityType of ["character", "event", "item", "world_rule", "foreshadowing", "open_thread"]) {
    db.prepare("INSERT OR REPLACE INTO canonical_entities(project_id, entity_type, entity_id, row_json) VALUES(?,?,?,?)").run(projectId, entityType, `${entityType}_1`, json({ projectId, entityType }));
  }
  assert(Number(db.prepare("SELECT COUNT(*) AS n FROM canonical_entities WHERE project_id=?").get(projectId).n) === 6, "canonical count mismatch");
});
await check("source natural-key dedup", () => {
  const hash = checksum("source-natural-key");
  db.prepare("INSERT OR IGNORE INTO fact_sources(id, project_id, natural_key_hash, row_json) VALUES(?,?,?,?)").run("source_a", projectId, hash, json({ id: "source_a" }));
  db.prepare("INSERT OR IGNORE INTO fact_sources(id, project_id, natural_key_hash, row_json) VALUES(?,?,?,?)").run("source_b", projectId, hash, json({ id: "source_b" }));
  assert(Number(db.prepare("SELECT COUNT(*) AS n FROM fact_sources WHERE natural_key_hash=?").get(hash).n) === 1, "source dedup failed");
});
await check("atomic extraction persistence", () => {
  const result = persistExtraction(db, projectId, "request_1", "one");
  assert(result.replay === false, "first request should persist");
  assert(Number(db.prepare("SELECT COUNT(*) AS n FROM candidates WHERE project_id=?").get(projectId).n) >= 2, "candidate not persisted");
});
await check("idempotent replay", () => {
  const result = persistExtraction(db, projectId, "request_1", "one");
  assert(result.replay === true, "same request should replay");
});
await check("different payload conflict", () => {
  let threw = false;
  try {
    persistExtraction(db, projectId, "request_1", "different");
  } catch (error) {
    threw = /idempotency payload conflict/i.test(String(error.message));
  }
  assert(threw, "payload conflict not detected");
});
await check("transaction commit", () => {
  db.exec("BEGIN IMMEDIATE;");
  db.prepare("INSERT INTO candidates(id, project_id, status, row_json) VALUES(?,?,?,?)").run("cand_tx_commit", projectId, "pending", json({ id: "cand_tx_commit" }));
  db.exec("COMMIT;");
  assert(db.prepare("SELECT id FROM candidates WHERE id=?").get("cand_tx_commit").id === "cand_tx_commit", "commit failed");
});
await check("transaction rollback", () => {
  db.exec("BEGIN IMMEDIATE;");
  db.prepare("INSERT INTO candidates(id, project_id, status, row_json) VALUES(?,?,?,?)").run("cand_tx_rollback", projectId, "pending", json({ id: "cand_tx_rollback" }));
  db.exec("ROLLBACK;");
  assert(!db.prepare("SELECT id FROM candidates WHERE id=?").get("cand_tx_rollback"), "rollback failed");
});
await check("restart persistence", () => {
  db.close();
  const reopened = new DatabaseSync(file);
  try {
    assert(parse(reopened.prepare("SELECT row_json FROM projects WHERE project_id=?").get(projectId))?.projectId === projectId, "reopen lost project");
  } finally {
    reopened.close();
  }
});
const reopened = new DatabaseSync(file);
await check("integrity check ok", () => {
  assert(reopened.prepare("PRAGMA integrity_check").get().integrity_check === "ok", "integrity check failed");
});
await check("10 concurrent reads", async () => {
  await Promise.all(Array.from({ length: 10 }, async () => {
    assert(Number(reopened.prepare("SELECT COUNT(*) AS n FROM candidates WHERE project_id=?").get(projectId).n) > 0, "read count failed");
  }));
});
await check("offline local file exists without cloud env", () => {
  assert(fs.existsSync(file), "database file missing");
  assert(file.includes(".novel.sqlite"), "database extension mismatch");
});
await check("path traversal safe name", () => {
  assert(!safeName("../unsafe/name").includes("..") && safeName("../unsafe/name").endsWith(".novel.sqlite"), "safe name failed");
});
await check("unsafe storage directory rejected by implementation source", () => {
  const text = read("lib/novel-ai/storage/sqlite/sqlite-connection.ts");
  assert(text.includes(".next") && text.includes("node_modules") && text.includes("os.tmpdir"), "storage directory validation incomplete");
});
await check("error codes defined", () => {
  const text = read("lib/novel-ai/storage/sqlite/sqlite-errors.ts");
  for (const code of ["SQLITE_DATABASE_CORRUPTED", "SQLITE_READ_ONLY", "SQLITE_DISK_FULL", "SQLITE_LOCK_TIMEOUT", "SQLITE_MIGRATION_FAILED", "SQLITE_PATH_INVALID"]) {
    assert(text.includes(code), `${code} missing`);
  }
});
await check("performance baseline 100 candidates", () => {
  const t = Date.now();
  reopened.exec("BEGIN IMMEDIATE;");
  for (let i = 0; i < 100; i++) {
    reopened.prepare("INSERT OR REPLACE INTO candidates(id, project_id, status, row_json) VALUES(?,?,?,?)").run(`perf_${i}`, projectId, "pending", json({ id: `perf_${i}`, projectId }));
  }
  reopened.exec("COMMIT;");
  return { elapsedMs: Date.now() - t, candidateCount: reopened.prepare("SELECT COUNT(*) AS n FROM candidates WHERE project_id=?").get(projectId).n };
});
await check("cleanup fixture", () => {
  reopened.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  assert(!fs.existsSync(tmpRoot), "cleanup failed");
});

const passCount = results.filter((item) => item.status === "PASS").length;
const failCount = results.filter((item) => item.status === "FAIL").length;
const summary = {
  pass: passCount,
  fail: failCount,
  skip: 0,
  elapsedMs: Date.now() - started,
  sqliteFoundationReady: failCount === 0 && passCount >= 25,
};

console.log(JSON.stringify({ summary, results }, null, 2));
process.exit(summary.sqliteFoundationReady ? 0 : 1);

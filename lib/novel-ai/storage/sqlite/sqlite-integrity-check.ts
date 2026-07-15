import crypto from "crypto";
import fs from "fs";
import { sqliteError } from "./sqlite-errors";
import { SQLITE_MIGRATIONS, SQLITE_SCHEMA_VERSION } from "./sqlite-migrations";

type Database = {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: Array<string | number | bigint | Buffer | null>): Record<string, unknown> | undefined;
    all(...params: Array<string | number | bigint | Buffer | null>): Record<string, unknown>[];
  };
  close(): void;
};
type DatabaseCtor = new (fileName: string) => Database;

let DatabaseSync: DatabaseCtor | null = null;

async function loadDatabaseCtor(): Promise<DatabaseCtor> {
  if (DatabaseSync) return DatabaseSync;
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<{ DatabaseSync: DatabaseCtor }>;
  DatabaseSync = (await dynamicImport("node:sqlite")).DatabaseSync;
  return DatabaseSync;
}

export function sha256File(filePath: string) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function sqliteMagicHeader(filePath: string) {
  if (!fs.existsSync(filePath)) throw sqliteError("SQLITE_DATABASE_NOT_FOUND", "SQLite database file does not exist.");
  const header = Buffer.alloc(16);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, header, 0, 16, 0);
  } finally {
    fs.closeSync(fd);
  }
  return header.toString("utf8") === "SQLite format 3\0";
}

function requiredTablesPresent(tables: string[]) {
  return ["projects", "canonical_entities", "versions", "integrity_metadata", "mutation_requests", "revert_audits"].every((table) => tables.includes(table));
}

export async function inspectSQLiteDatabaseFile(filePath: string, expectedProjectId?: string) {
  const started = Date.now();
  if (!sqliteMagicHeader(filePath)) throw sqliteError("SQLITE_DATABASE_CORRUPTED", "SQLite magic header is invalid.");
  const Ctor = await loadDatabaseCtor();
  const db = new Ctor(filePath);
  try {
    const quick = String((db.prepare("PRAGMA quick_check;").get() || {}).quick_check || "");
    if (quick !== "ok") throw sqliteError("SQLITE_DATABASE_CORRUPTED", "SQLite quick_check failed.");
    const integrity = String((db.prepare("PRAGMA integrity_check;").get() || {}).integrity_check || "");
    if (integrity !== "ok") throw sqliteError("SQLITE_DATABASE_CORRUPTED", "SQLite integrity_check failed.");
    const migrationRows = db.prepare("SELECT version, checksum FROM schema_migrations ORDER BY version ASC").all();
    if (migrationRows.length !== SQLITE_MIGRATIONS.length) throw sqliteError("SQLITE_SCHEMA_INCOMPATIBLE", "SQLite migration count does not match this application.");
    for (const migration of SQLITE_MIGRATIONS) {
      const row = migrationRows.find((item) => Number(item.version) === migration.version);
      if (!row || String(row.checksum) !== migration.checksum) throw sqliteError("SQLITE_SCHEMA_INCOMPATIBLE", `SQLite migration checksum mismatch for ${migration.name}.`);
    }
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => String(row.name));
    if (!requiredTablesPresent(tables)) throw sqliteError("SQLITE_SCHEMA_INCOMPATIBLE", "SQLite database is missing required Story Bible tables.");
    const projectRows = db.prepare("SELECT project_id FROM projects LIMIT 10").all().map((row) => String(row.project_id));
    if (expectedProjectId && !projectRows.includes(expectedProjectId)) throw sqliteError("SQLITE_PROJECT_MISMATCH", "SQLite backup belongs to a different project.");
    const currentVersion = db.prepare("SELECT MAX(version_number) AS n FROM versions").get();
    const currentIntegrity = db.prepare("SELECT row_json FROM integrity_metadata ORDER BY version_number DESC LIMIT 1").get();
    return {
      ok: true,
      schemaVersion: SQLITE_SCHEMA_VERSION,
      migrationCount: migrationRows.length,
      projectIds: projectRows,
      currentVersionNumber: Number(currentVersion?.n || 0),
      currentIntegrityHash: currentIntegrity ? JSON.parse(String(currentIntegrity.row_json || "{}")).integrityHash || null : null,
      databaseSizeBytes: fs.statSync(filePath).size,
      checksum: sha256File(filePath),
      elapsedMs: Date.now() - started,
    };
  } finally {
    db.close();
  }
}


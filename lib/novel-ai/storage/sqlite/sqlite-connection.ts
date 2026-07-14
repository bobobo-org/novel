import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { mapSQLiteError, sqliteError } from "./sqlite-errors";
import { SQLITE_MIGRATIONS, SQLITE_SCHEMA_VERSION } from "./sqlite-migrations";

type SQLiteValue = string | number | bigint | Buffer | null;
type Statement = {
  run(...params: SQLiteValue[]): unknown;
  get(...params: SQLiteValue[]): Record<string, unknown> | undefined;
  all(...params: SQLiteValue[]): Record<string, unknown>[];
};
type Database = {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
};
type DatabaseCtor = new (fileName: string) => Database;

export type SQLiteConnectionOptions = {
  projectId: string;
  storageDir?: string;
};

export type SQLiteConnectionDiagnostics = {
  sqliteDriver: "node:sqlite";
  sqliteSchemaVersion: string;
  sqliteMigrationCount: number;
  journalMode: string;
  foreignKeysEnabled: boolean;
  synchronousMode: string;
  busyTimeoutMs: number;
  databaseOpenStatus: "open" | "closed";
  lastIntegrityCheck: string;
  databaseFileExists: boolean;
  databaseFileSizeBytes: number;
  storageDirectoryWritable: boolean;
  safeDatabaseName: string;
};

let DatabaseSync: DatabaseCtor | null = null;

async function loadDatabaseCtor(): Promise<DatabaseCtor> {
  if (DatabaseSync) return DatabaseSync;
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<{ DatabaseSync: DatabaseCtor }>;
    const mod = await dynamicImport("node:sqlite");
    DatabaseSync = mod.DatabaseSync;
    return DatabaseSync;
  } catch (error) {
    throw sqliteError("SQLITE_DRIVER_UNAVAILABLE", "node:sqlite is unavailable in this runtime.", error);
  }
}

export function safeProjectDatabaseName(projectExportId: string) {
  const normalized = String(projectExportId || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  const safe = normalized.slice(0, 80) || `project-${crypto.createHash("sha256").update(projectExportId || "empty").digest("hex").slice(0, 16)}`;
  return `${safe}.novel.sqlite`;
}

export function resolveSQLiteStorageDirectory(storageDir?: string) {
  const dir = path.resolve(storageDir || process.env.NOVEL_SQLITE_STORAGE_DIR || path.join(process.cwd(), "data", "sqlite"));
  const lower = dir.toLowerCase();
  const temp = os.tmpdir().toLowerCase();
  if (lower.includes(`${path.sep}.next${path.sep}`) || lower.endsWith(`${path.sep}.next`)) {
    throw sqliteError("SQLITE_PATH_INVALID", "SQLite storage directory cannot be inside .next.");
  }
  if (lower.includes(`${path.sep}node_modules${path.sep}`) || lower.endsWith(`${path.sep}node_modules`)) {
    throw sqliteError("SQLITE_PATH_INVALID", "SQLite storage directory cannot be inside node_modules.");
  }
  if (lower === temp || lower.startsWith(`${temp}${path.sep}`)) {
    throw sqliteError("SQLITE_PATH_INVALID", "SQLite storage directory cannot be inside the OS temp directory.");
  }
  return dir;
}

export function resolveProjectDatabasePath(projectExportId: string, storageDir?: string) {
  const dir = resolveSQLiteStorageDirectory(storageDir);
  const safeName = safeProjectDatabaseName(projectExportId);
  const fullPath = path.resolve(dir, safeName);
  if (!fullPath.startsWith(`${dir}${path.sep}`)) throw sqliteError("SQLITE_PATH_INVALID", "Resolved SQLite path escaped storage directory.");
  return { dir, filePath: fullPath, safeName };
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export class SQLiteProjectConnection {
  private db: Database | null = null;
  private readonly filePath: string;
  readonly safeDatabaseName: string;
  readonly storageDir: string;
  private inTransaction = false;

  private constructor(options: { filePath: string; storageDir: string; safeName: string }) {
    this.filePath = options.filePath;
    this.storageDir = options.storageDir;
    this.safeDatabaseName = options.safeName;
  }

  static async open(options: SQLiteConnectionOptions) {
    const resolved = resolveProjectDatabasePath(options.projectId, options.storageDir);
    fs.mkdirSync(resolved.dir, { recursive: true });
    const realDir = fs.realpathSync.native(resolved.dir);
    if (!path.resolve(resolved.filePath).startsWith(`${realDir}${path.sep}`)) throw sqliteError("SQLITE_PATH_INVALID", "SQLite real path escaped storage directory.");
    const ctor = await loadDatabaseCtor();
    const connection = new SQLiteProjectConnection({ filePath: path.join(realDir, resolved.safeName), storageDir: realDir, safeName: resolved.safeName });
    try {
      connection.db = new ctor(connection.filePath);
      connection.applyPragmas();
      connection.runMigrations();
      return connection;
    } catch (error) {
      throw mapSQLiteError(error);
    }
  }

  private database() {
    if (!this.db) throw sqliteError("SQLITE_DATABASE_NOT_FOUND", "SQLite database is not open.");
    return this.db;
  }

  applyPragmas() {
    const db = this.database();
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = NORMAL;");
    db.exec("PRAGMA busy_timeout = 5000;");
    db.exec("PRAGMA temp_store = MEMORY;");
  }

  runMigrations() {
    const db = this.database();
    db.exec("BEGIN IMMEDIATE;");
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          checksum TEXT NOT NULL,
          applied_at TEXT NOT NULL,
          execution_ms INTEGER NOT NULL
        );
      `);
      for (const migration of SQLITE_MIGRATIONS) {
        const existing = db.prepare("SELECT checksum FROM schema_migrations WHERE version = ?").get(migration.version);
        if (existing) {
          if (String(existing.checksum) !== migration.checksum) throw sqliteError("SQLITE_SCHEMA_INCOMPATIBLE", `Migration checksum mismatch for ${migration.name}.`);
          continue;
        }
        const started = Date.now();
        db.exec(migration.sql);
        db.prepare("INSERT INTO schema_migrations(version, name, checksum, applied_at, execution_ms) VALUES(?,?,?,?,?)")
          .run(migration.version, migration.name, migration.checksum, new Date().toISOString(), Date.now() - started);
      }
      db.prepare("INSERT OR REPLACE INTO storage_metadata(key, value_json, updated_at) VALUES(?,?,?)")
        .run("schemaVersion", JSON.stringify({ schemaVersion: SQLITE_SCHEMA_VERSION }), new Date().toISOString());
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      if (error instanceof Error && error.name === "SQLITE_SCHEMA_INCOMPATIBLE") throw error;
      throw sqliteError("SQLITE_MIGRATION_FAILED", "SQLite migration failed and was rolled back.", error);
    }
  }

  exec(sql: string) {
    try {
      this.database().exec(sql);
    } catch (error) {
      throw mapSQLiteError(error);
    }
  }

  run(sql: string, params: SQLiteValue[] = []) {
    try {
      return this.database().prepare(sql).run(...params);
    } catch (error) {
      throw mapSQLiteError(error);
    }
  }

  get(sql: string, params: SQLiteValue[] = []) {
    try {
      return this.database().prepare(sql).get(...params);
    } catch (error) {
      throw mapSQLiteError(error);
    }
  }

  all(sql: string, params: SQLiteValue[] = []) {
    try {
      return this.database().prepare(sql).all(...params);
    } catch (error) {
      throw mapSQLiteError(error);
    }
  }

  beginImmediate() {
    if (this.inTransaction) throw sqliteError("STORAGE_TRANSACTION_FAILED", "Nested SQLite transactions are not supported in L0B.1.");
    this.exec("BEGIN IMMEDIATE;");
    this.inTransaction = true;
  }

  commit() {
    if (!this.inTransaction) return;
    this.exec("COMMIT;");
    this.inTransaction = false;
  }

  rollback() {
    if (!this.inTransaction) return;
    try {
      this.exec("ROLLBACK;");
    } finally {
      this.inTransaction = false;
    }
  }

  transaction<T>(callback: () => T): T {
    this.beginImmediate();
    try {
      const result = callback();
      this.commit();
      return result;
    } catch (error) {
      this.rollback();
      throw error;
    }
  }

  diagnostics(): SQLiteConnectionDiagnostics {
    const foreignKeys = this.get("PRAGMA foreign_keys;") as { foreign_keys?: number } | undefined;
    const journal = this.get("PRAGMA journal_mode;") as { journal_mode?: string } | undefined;
    const synchronous = this.get("PRAGMA synchronous;") as { synchronous?: number } | undefined;
    const busyTimeout = this.get("PRAGMA busy_timeout;") as { timeout?: number } | undefined;
    const integrity = this.get("PRAGMA integrity_check;") as { integrity_check?: string } | undefined;
    const stat = fs.existsSync(this.filePath) ? fs.statSync(this.filePath) : null;
    return {
      sqliteDriver: "node:sqlite",
      sqliteSchemaVersion: SQLITE_SCHEMA_VERSION,
      sqliteMigrationCount: SQLITE_MIGRATIONS.length,
      journalMode: String(journal?.journal_mode || "unknown"),
      foreignKeysEnabled: Number(foreignKeys?.foreign_keys || 0) === 1,
      synchronousMode: String(synchronous?.synchronous ?? "unknown"),
      busyTimeoutMs: Number(busyTimeout?.timeout || 5000),
      databaseOpenStatus: this.db ? "open" : "closed",
      lastIntegrityCheck: String(integrity?.integrity_check || "unknown"),
      databaseFileExists: Boolean(stat),
      databaseFileSizeBytes: stat?.size || 0,
      storageDirectoryWritable: isDirectoryWritable(this.storageDir),
      safeDatabaseName: this.safeDatabaseName,
    };
  }

  close() {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }

  requestHash(value: unknown) {
    return sha256(JSON.stringify(value));
  }
}

function isDirectoryWritable(dir: string) {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

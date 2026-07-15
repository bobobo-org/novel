import crypto from "crypto";
import fs from "fs";
import path from "path";
import { inspectSQLiteDatabaseFile, sha256File } from "./sqlite-integrity-check";
import { sqliteError } from "./sqlite-errors";
import type { SQLiteStoryBibleStorageAdapter } from "./sqlite-adapter";
import { SQLITE_SCHEMA_VERSION } from "./sqlite-migrations";

export const SQLITE_BACKUP_FORMAT_VERSION = "sqlite-story-bible-backup-v1";

type BackupOptions = {
  projectId: string;
  requestId?: string;
  reason?: string;
  protected?: boolean;
  retentionLimit?: number;
};

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sha256(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function assertInside(parent: string, child: string) {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  if (!resolvedChild.startsWith(`${resolvedParent}${path.sep}`)) throw sqliteError("SQLITE_PATH_INVALID", "Backup path escaped backup directory.");
}

export async function createSQLiteManualBackup(adapter: SQLiteStoryBibleStorageAdapter, options: BackupOptions) {
  const info = await adapter.getProjectFileInfo(options.projectId);
  if (!fs.existsSync(info.databasePath)) throw sqliteError("SQLITE_DATABASE_NOT_FOUND", "Cannot backup a missing SQLite database.");
  const checkpoint = await adapter.checkpointProject(options.projectId, "TRUNCATE");
  const inspected = await inspectSQLiteDatabaseFile(info.databasePath, options.projectId);
  const backupDir = path.join(info.storageDir, "backups", options.projectId.replace(/[^a-zA-Z0-9_-]+/g, "-"));
  fs.mkdirSync(backupDir, { recursive: true });
  const base = `${options.projectId.replace(/[^a-zA-Z0-9_-]+/g, "-")}.${nowStamp()}.novel.sqlite.bak`;
  const tempPath = path.join(backupDir, `${base}.tmp`);
  const backupPath = path.join(backupDir, base);
  const metadataPath = `${backupPath}.metadata.json`;
  assertInside(backupDir, tempPath);
  assertInside(backupDir, backupPath);
  fs.copyFileSync(info.databasePath, tempPath);
  if (!fs.readFileSync(tempPath).subarray(0, 16).toString("utf8").startsWith("SQLite format 3")) {
    fs.rmSync(tempPath, { force: true });
    throw sqliteError("SQLITE_BACKUP_INVALID", "Temporary backup has invalid SQLite header.");
  }
  fs.renameSync(tempPath, backupPath);
  const backupInspection = await inspectSQLiteDatabaseFile(backupPath, options.projectId);
  const metadata = {
    backupFormatVersion: SQLITE_BACKUP_FORMAT_VERSION,
    backupId: `sqlite_backup_${crypto.randomUUID()}`,
    projectId: options.projectId,
    projectExportId: options.projectId,
    sourceSchemaVersion: SQLITE_SCHEMA_VERSION,
    sourceMigrationVersion: inspected.migrationCount,
    sourceDatabaseChecksum: inspected.checksum,
    backupChecksum: backupInspection.checksum,
    backupCreatedAt: new Date().toISOString(),
    backupReason: options.reason || "manual",
    sourceVersionNumber: inspected.currentVersionNumber,
    sourceIntegrityHash: inspected.currentIntegrityHash,
    databaseSizeBytes: backupInspection.databaseSizeBytes,
    walCheckpointStatus: checkpoint.status,
    applicationCommit: process.env.VERCEL_GIT_COMMIT_SHA || "local",
    encryptionStatus: "not_encrypted",
    protected: Boolean(options.protected),
    storageLocation: "local_sqlite",
    canonicalAuthority: "local",
    dataLeftDevice: false,
    backupFileName: path.basename(backupPath),
    metadataHash: "",
  };
  metadata.metadataHash = sha256({ ...metadata, metadataHash: "" });
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  await adapter.createExportAudit({
    projectId: options.projectId,
    project_id: options.projectId,
    auditType: "sqlite_backup",
    backupId: metadata.backupId,
    backupFileName: metadata.backupFileName,
    backupChecksum: metadata.backupChecksum,
    status: "completed",
    createdAt: metadata.backupCreatedAt,
  });
  if (options.retentionLimit && options.retentionLimit > 0) await enforceSQLiteBackupRetention(adapter, options.projectId, options.retentionLimit);
  return { ok: true, backupPath, metadataPath, metadata };
}

export async function verifySQLiteBackup(_adapter: SQLiteStoryBibleStorageAdapter, backupPath: string, expectedProjectId?: string) {
  const metadataPath = `${backupPath}.metadata.json`;
  if (!fs.existsSync(backupPath) || !fs.existsSync(metadataPath)) throw sqliteError("SQLITE_BACKUP_INVALID", "Backup or metadata file is missing.");
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  const inspected = await inspectSQLiteDatabaseFile(backupPath, expectedProjectId || metadata.projectId);
  if (metadata.backupChecksum !== inspected.checksum) throw sqliteError("SQLITE_BACKUP_CHECKSUM_FAILED", "Backup checksum does not match metadata.");
  if (expectedProjectId && metadata.projectId !== expectedProjectId) throw sqliteError("SQLITE_PROJECT_MISMATCH", "Backup metadata project does not match target project.");
  return { ok: true, metadata, inspected };
}

export async function listSQLiteBackups(adapter: SQLiteStoryBibleStorageAdapter, projectId: string) {
  const info = await adapter.getProjectFileInfo(projectId);
  const backupDir = path.join(info.storageDir, "backups", projectId.replace(/[^a-zA-Z0-9_-]+/g, "-"));
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter((name) => name.endsWith(".novel.sqlite.bak"))
    .map((name) => {
      const backupPath = path.join(backupDir, name);
      const metadataPath = `${backupPath}.metadata.json`;
      const metadata = fs.existsSync(metadataPath) ? JSON.parse(fs.readFileSync(metadataPath, "utf8")) : {};
      return { backupPath, metadataPath, metadata };
    })
    .sort((a, b) => String(b.metadata.backupCreatedAt || "").localeCompare(String(a.metadata.backupCreatedAt || "")));
}

export async function deleteSQLiteBackup(adapter: SQLiteStoryBibleStorageAdapter, projectId: string, backupPath: string) {
  const info = await adapter.getProjectFileInfo(projectId);
  const backupDir = path.join(info.storageDir, "backups", projectId.replace(/[^a-zA-Z0-9_-]+/g, "-"));
  assertInside(backupDir, backupPath);
  fs.rmSync(backupPath, { force: true });
  fs.rmSync(`${backupPath}.metadata.json`, { force: true });
  return { ok: true };
}

export async function enforceSQLiteBackupRetention(adapter: SQLiteStoryBibleStorageAdapter, projectId: string, limit = 5) {
  const backups = await listSQLiteBackups(adapter, projectId);
  const removable = backups.filter((item) => !item.metadata.protected).slice(limit);
  for (const item of removable) await deleteSQLiteBackup(adapter, projectId, item.backupPath);
  return { ok: true, deleted: removable.length, remaining: backups.length - removable.length };
}


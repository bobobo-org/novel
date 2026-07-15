import fs from "fs";
import { inspectSQLiteDatabaseFile } from "./sqlite-integrity-check";
import type { SQLiteStoryBibleStorageAdapter } from "./sqlite-adapter";

export type SQLiteRecoveryState =
  | "healthy"
  | "degraded_read_only"
  | "backup_required"
  | "restore_required"
  | "corrupted"
  | "schema_incompatible"
  | "migration_failed"
  | "locked"
  | "disk_full";

export async function detectSQLiteRecoveryState(adapter: SQLiteStoryBibleStorageAdapter, projectId: string): Promise<{
  state: SQLiteRecoveryState;
  errorCode: string | null;
  writable: boolean;
  walExists: boolean;
  shmExists: boolean;
}> {
  const info = await adapter.getProjectFileInfo(projectId);
  const walExists = fs.existsSync(info.walPath);
  const shmExists = fs.existsSync(info.shmPath);
  let writable = true;
  try {
    fs.accessSync(info.storageDir, fs.constants.W_OK);
  } catch {
    writable = false;
  }
  if (!writable) return { state: "degraded_read_only", errorCode: "SQLITE_READ_ONLY", writable, walExists, shmExists };
  try {
    await inspectSQLiteDatabaseFile(info.databasePath, projectId);
    return { state: "healthy", errorCode: null, writable, walExists, shmExists };
  } catch (error) {
    const code = error instanceof Error ? error.name : "SQLITE_UNKNOWN";
    if (code === "SQLITE_SCHEMA_INCOMPATIBLE") return { state: "schema_incompatible", errorCode: code, writable, walExists, shmExists };
    if (code === "SQLITE_DATABASE_NOT_FOUND") return { state: "restore_required", errorCode: code, writable, walExists, shmExists };
    if (code === "SQLITE_DATABASE_CORRUPTED") return { state: "corrupted", errorCode: code, writable, walExists, shmExists };
    return { state: "backup_required", errorCode: code, writable, walExists, shmExists };
  }
}

export async function verifySQLiteWalRecovery(adapter: SQLiteStoryBibleStorageAdapter, projectId: string) {
  await adapter.checkpointProject(projectId, "PASSIVE");
  adapter.closeAll();
  const info = await adapter.getProjectFileInfo(projectId);
  const inspected = await inspectSQLiteDatabaseFile(info.databasePath, projectId);
  const integrity = await adapter.verifyStoredIntegrityFields(projectId);
  return {
    ok: integrity.ok,
    state: integrity.ok ? "healthy" : "restore_required",
    currentVersionNumber: inspected.currentVersionNumber,
    integrityChecked: integrity.checked,
    walExists: fs.existsSync(info.walPath),
    shmExists: fs.existsSync(info.shmPath),
  };
}


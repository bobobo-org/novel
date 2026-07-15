import fs from "fs";
import path from "path";
import { createSQLiteManualBackup, verifySQLiteBackup } from "./sqlite-backup";
import { inspectSQLiteDatabaseFile } from "./sqlite-integrity-check";
import { sqliteError } from "./sqlite-errors";
import type { SQLiteStoryBibleStorageAdapter } from "./sqlite-adapter";

type RestoreOptions = {
  projectId: string;
  requestId?: string;
  backupPath: string;
  reason?: string;
};

function assertInside(parent: string, child: string) {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  if (!resolvedChild.startsWith(`${resolvedParent}${path.sep}`)) throw sqliteError("SQLITE_PATH_INVALID", "Restore path escaped SQLite storage directory.");
}

export async function restoreSQLiteBackup(adapter: SQLiteStoryBibleStorageAdapter, options: RestoreOptions) {
  const info = await adapter.getProjectFileInfo(options.projectId);
  const verified = await verifySQLiteBackup(adapter, options.backupPath, options.projectId);
  const before = await inspectSQLiteDatabaseFile(info.databasePath, options.projectId);
  const preRestore = await createSQLiteManualBackup(adapter, {
    projectId: options.projectId,
    requestId: `${options.requestId || "restore"}_pre_restore`,
    reason: "pre-restore rollback copy",
    protected: true,
  });
  adapter.closeAll();
  const tempRestorePath = `${info.databasePath}.restore-${Date.now()}.tmp`;
  const rollbackPath = `${info.databasePath}.rollback-${Date.now()}.bak`;
  assertInside(info.storageDir, tempRestorePath);
  assertInside(info.storageDir, rollbackPath);
  try {
    fs.copyFileSync(options.backupPath, tempRestorePath);
    await inspectSQLiteDatabaseFile(tempRestorePath, options.projectId);
    if (fs.existsSync(info.databasePath)) fs.copyFileSync(info.databasePath, rollbackPath);
    fs.rmSync(info.walPath, { force: true });
    fs.rmSync(info.shmPath, { force: true });
    fs.renameSync(tempRestorePath, info.databasePath);
    const after = await inspectSQLiteDatabaseFile(info.databasePath, options.projectId);
    await adapter.diagnostics(options.projectId);
    const integrity = await adapter.verifyStoredIntegrityFields(options.projectId);
    if (!integrity.ok) throw sqliteError("SQLITE_RESTORE_FAILED", "Restored database failed Story Bible integrity validation.");
    return {
      ok: true,
      projectId: options.projectId,
      restoredFromBackup: verified.metadata.backupId,
      preRestoreBackupId: preRestore.metadata.backupId,
      beforeVersionNumber: before.currentVersionNumber,
      afterVersionNumber: after.currentVersionNumber,
      backupChecksum: verified.metadata.backupChecksum,
      recoveryState: "healthy",
      storageLocation: "local_sqlite",
    };
  } catch (error) {
    if (fs.existsSync(rollbackPath)) {
      fs.copyFileSync(rollbackPath, info.databasePath);
    }
    fs.rmSync(tempRestorePath, { force: true });
    throw error instanceof Error ? error : sqliteError("SQLITE_RESTORE_FAILED", "SQLite restore failed.");
  } finally {
    fs.rmSync(rollbackPath, { force: true });
  }
}


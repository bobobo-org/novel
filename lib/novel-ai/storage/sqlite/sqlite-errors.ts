export type SQLiteStorageErrorCode =
  | "SQLITE_DRIVER_UNAVAILABLE"
  | "SQLITE_DATABASE_NOT_FOUND"
  | "SQLITE_DATABASE_CORRUPTED"
  | "SQLITE_READ_ONLY"
  | "SQLITE_DISK_FULL"
  | "SQLITE_LOCK_TIMEOUT"
  | "SQLITE_MIGRATION_FAILED"
  | "SQLITE_SCHEMA_INCOMPATIBLE"
  | "SQLITE_BACKUP_FAILED"
  | "SQLITE_BACKUP_INVALID"
  | "SQLITE_BACKUP_CHECKSUM_FAILED"
  | "SQLITE_RESTORE_FAILED"
  | "SQLITE_PROJECT_MISMATCH"
  | "SQLITE_WAL_RECOVERY_FAILED"
  | "SQLITE_PATH_INVALID"
  | "STORAGE_TRANSACTION_FAILED"
  | "STORAGE_PERSISTENCE_FAILED";

export class SQLiteStorageError extends Error {
  readonly code: SQLiteStorageErrorCode;
  readonly retryable: boolean;

  constructor(code: SQLiteStorageErrorCode, message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(message);
    this.name = code;
    this.code = code;
    this.retryable = Boolean(options.retryable);
    if (options.cause) this.cause = options.cause;
  }
}

export function sqliteError(code: SQLiteStorageErrorCode, message: string, cause?: unknown) {
  return new SQLiteStorageError(code, message, { cause, retryable: code === "SQLITE_LOCK_TIMEOUT" });
}

export function mapSQLiteError(error: unknown): SQLiteStorageError {
  const message = error instanceof Error ? error.message : String(error);
  if (/SQLITE_BUSY|database is locked/i.test(message)) return sqliteError("SQLITE_LOCK_TIMEOUT", "SQLite database is busy.", error);
  if (/readonly|read-only/i.test(message)) return sqliteError("SQLITE_READ_ONLY", "SQLite storage is read-only.", error);
  if (/disk|full/i.test(message)) return sqliteError("SQLITE_DISK_FULL", "SQLite storage disk is full.", error);
  if (/malformed|corrupt/i.test(message)) return sqliteError("SQLITE_DATABASE_CORRUPTED", "SQLite database is corrupted.", error);
  return sqliteError("STORAGE_PERSISTENCE_FAILED", message, error);
}

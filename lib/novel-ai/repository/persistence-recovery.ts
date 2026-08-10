export const INDEXEDDB_ERROR_CODES = [
  "INDEXEDDB_UNAVAILABLE",
  "INDEXEDDB_OPEN_FAILED",
  "INDEXEDDB_UPGRADE_BLOCKED",
  "INDEXEDDB_SCHEMA_MISMATCH",
  "INDEXEDDB_VERSION_CHANGED",
  "INDEXEDDB_CONNECTION_INVALID",
  "INDEXEDDB_PERMISSION_DENIED",
  "INDEXEDDB_QUOTA_EXCEEDED",
  "INDEXEDDB_CONSTRAINT_FAILED",
  "INDEXEDDB_REQUEST_FAILED",
  "INDEXEDDB_TRANSACTION_ABORTED",
  "INDEXEDDB_TRANSACTION_FAILED",
  "INDEXEDDB_OPERATION_FAILED",
] as const;

export const INDEXEDDB_DATABASE_VERSION = 8;
export const INDEXEDDB_MIGRATION_VERSION = `indexeddb-v${INDEXEDDB_DATABASE_VERSION}` as const;
export const INDEXEDDB_STORAGE_SCHEMA_VERSION = "indexeddb-canonical-storage-v1" as const;
export const PERSISTENCE_FAILURE_SCHEMA_VERSION = "indexeddb-persistence-failure-v1" as const;

export type IndexedDbErrorCode = (typeof INDEXEDDB_ERROR_CODES)[number];

export type PersistenceRecoveryAction =
  | "retry_indexeddb"
  | "close_other_tabs_and_retry"
  | "restore_browser_storage_access"
  | "free_device_storage_and_retry"
  | "reload_and_retry";

export type PersistenceFailure = {
  schemaVersion: typeof PERSISTENCE_FAILURE_SCHEMA_VERSION;
  migrationVersion: typeof INDEXEDDB_MIGRATION_VERSION;
  backend: "indexeddb";
  degraded: true;
  memoryFallback: false;
  databaseErrorCode: IndexedDbErrorCode;
  fallbackReason: `fail_closed:${Lowercase<IndexedDbErrorCode>}`;
  reasonCode: IndexedDbErrorCode;
  userMessage: string;
  retryable: true;
  recoveryAction: PersistenceRecoveryAction;
};

const CODE_SET = new Set<string>(INDEXEDDB_ERROR_CODES);

const FAILURE_DETAILS: Record<IndexedDbErrorCode, Pick<PersistenceFailure, "userMessage" | "recoveryAction">> = {
  INDEXEDDB_UNAVAILABLE: {
    userMessage: "瀏覽器未提供本機作品庫。請允許此網站使用本機儲存空間後再試一次。",
    recoveryAction: "restore_browser_storage_access",
  },
  INDEXEDDB_OPEN_FAILED: {
    userMessage: "本機作品庫暫時無法開啟。既有資料未被改寫，請重新檢查後再試一次。",
    recoveryAction: "retry_indexeddb",
  },
  INDEXEDDB_UPGRADE_BLOCKED: {
    userMessage: "另一個分頁仍在使用舊版作品庫。請關閉本站的其他分頁，再回來重新檢查。",
    recoveryAction: "close_other_tabs_and_retry",
  },
  INDEXEDDB_SCHEMA_MISMATCH: {
    userMessage: "本機作品庫結構不完整。為保護既有內容，系統已停止寫入；請重新載入後再試一次。",
    recoveryAction: "reload_and_retry",
  },
  INDEXEDDB_VERSION_CHANGED: {
    userMessage: "本機作品庫已由另一個分頁更新。請重新載入這個頁面後再繼續。",
    recoveryAction: "reload_and_retry",
  },
  INDEXEDDB_CONNECTION_INVALID: {
    userMessage: "本機作品庫連線已失效。請重新載入頁面建立新的安全連線。",
    recoveryAction: "reload_and_retry",
  },
  INDEXEDDB_PERMISSION_DENIED: {
    userMessage: "瀏覽器拒絕本機作品庫存取。請允許本站儲存資料後再試一次。",
    recoveryAction: "restore_browser_storage_access",
  },
  INDEXEDDB_QUOTA_EXCEEDED: {
    userMessage: "裝置的本機儲存空間不足。請先釋放空間，再回來重新檢查。",
    recoveryAction: "free_device_storage_and_retry",
  },
  INDEXEDDB_CONSTRAINT_FAILED: {
    userMessage: "本機作品資料未通過一致性檢查，這次變更沒有被保存。請重新讀取後再試一次。",
    recoveryAction: "reload_and_retry",
  },
  INDEXEDDB_REQUEST_FAILED: {
    userMessage: "本機作品庫沒有完成這次讀寫。既有資料未被替換，請重新檢查後再試一次。",
    recoveryAction: "retry_indexeddb",
  },
  INDEXEDDB_TRANSACTION_ABORTED: {
    userMessage: "本機作品庫已安全取消這次變更，沒有改用暫存記憶。請重新讀取後再試一次。",
    recoveryAction: "reload_and_retry",
  },
  INDEXEDDB_TRANSACTION_FAILED: {
    userMessage: "本機作品庫沒有提交這次變更，沒有改用暫存記憶。請重新檢查後再試一次。",
    recoveryAction: "retry_indexeddb",
  },
  INDEXEDDB_OPERATION_FAILED: {
    userMessage: "本機作品庫未完成這次操作。既有資料未被覆寫，請重新檢查後再試一次。",
    recoveryAction: "retry_indexeddb",
  },
};

function errorName(cause: unknown) {
  return cause && typeof cause === "object" && typeof (cause as { name?: unknown }).name === "string"
    ? (cause as { name: string }).name
    : "";
}

function explicitCode(cause: unknown) {
  if (!cause || typeof cause !== "object") return "";
  const code = (cause as { code?: unknown }).code;
  if (typeof code === "string" && CODE_SET.has(code)) return code as IndexedDbErrorCode;
  const message = (cause as { message?: unknown }).message;
  return typeof message === "string" && CODE_SET.has(message)
    ? message as IndexedDbErrorCode
    : "";
}

export function isIndexedDbPersistenceError(cause: unknown) {
  if (cause instanceof IndexedDbRepositoryError || explicitCode(cause)) return true;
  return [
    "VersionError",
    "InvalidStateError",
    "SecurityError",
    "NotAllowedError",
    "QuotaExceededError",
    "ConstraintError",
    "AbortError",
  ].includes(errorName(cause));
}

export function indexedDbErrorCode(
  cause: unknown,
  fallback: IndexedDbErrorCode = "INDEXEDDB_OPERATION_FAILED",
): IndexedDbErrorCode {
  const explicit = explicitCode(cause);
  if (explicit) return explicit;
  switch (errorName(cause)) {
    case "VersionError": return "INDEXEDDB_VERSION_CHANGED";
    case "InvalidStateError": return "INDEXEDDB_CONNECTION_INVALID";
    case "SecurityError":
    case "NotAllowedError": return "INDEXEDDB_PERMISSION_DENIED";
    case "QuotaExceededError": return "INDEXEDDB_QUOTA_EXCEEDED";
    case "ConstraintError": return "INDEXEDDB_CONSTRAINT_FAILED";
    case "AbortError": return "INDEXEDDB_TRANSACTION_ABORTED";
    default: return fallback;
  }
}

export class IndexedDbRepositoryError extends Error {
  readonly code: IndexedDbErrorCode;
  readonly recovery: PersistenceFailure;

  constructor(code: IndexedDbErrorCode) {
    const detail = FAILURE_DETAILS[code];
    super(detail.userMessage);
    this.name = "IndexedDbRepositoryError";
    this.code = code;
    this.recovery = {
      schemaVersion: PERSISTENCE_FAILURE_SCHEMA_VERSION,
      migrationVersion: INDEXEDDB_MIGRATION_VERSION,
      backend: "indexeddb",
      degraded: true,
      memoryFallback: false,
      databaseErrorCode: code,
      fallbackReason: `fail_closed:${code.toLowerCase()}` as PersistenceFailure["fallbackReason"],
      reasonCode: code,
      userMessage: detail.userMessage,
      retryable: true,
      recoveryAction: detail.recoveryAction,
    };
  }
}

export function asIndexedDbRepositoryError(
  cause: unknown,
  fallback: IndexedDbErrorCode = "INDEXEDDB_OPERATION_FAILED",
) {
  return cause instanceof IndexedDbRepositoryError
    ? cause
    : new IndexedDbRepositoryError(indexedDbErrorCode(cause, fallback));
}

export function persistenceFailure(
  cause: unknown,
  fallback: IndexedDbErrorCode = "INDEXEDDB_OPERATION_FAILED",
): PersistenceFailure {
  return asIndexedDbRepositoryError(cause, fallback).recovery;
}

export function persistenceFailureOrNull(cause: unknown) {
  return isIndexedDbPersistenceError(cause) ? persistenceFailure(cause) : null;
}

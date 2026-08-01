export const CLOUD_SYNC_SCHEMA_VERSION = "novel-cloud-sync-e2ee-v1" as const;
export const CLOUD_SYNC_MIGRATION_VERSION = "cloud_sync_e2ee_storage_001" as const;

export type CloudSyncRuntimeStatus =
  | "disabled"
  | "checking"
  | "ready"
  | "syncing"
  | "synced"
  | "offline"
  | "configuration_required"
  | "migration_required"
  | "conflict"
  | "degraded";

export type CloudSyncConfig = {
  schemaVersion: typeof CLOUD_SYNC_SCHEMA_VERSION;
  enabled: boolean;
  autoSync: boolean;
  syncKey: string | null;
  createdAt: string | null;
  updatedAt: string;
};

export type CloudSyncPrivacyReport = {
  excludedStores: string[];
  excludedRecordCount: number;
  sanitizedFieldCount: number;
  credentialScan: "passed";
};

export type CloudProjectSnapshot = {
  schemaVersion: typeof CLOUD_SYNC_SCHEMA_VERSION;
  projectId: string;
  createdAt: string;
  contentHash: string;
  records: Record<string, unknown[]>;
  recordCounts: Record<string, number>;
  privacyReport: CloudSyncPrivacyReport;
};

export type EncryptedCloudSnapshot = {
  schemaVersion: typeof CLOUD_SYNC_SCHEMA_VERSION;
  projectId: string;
  algorithm: "AES-GCM-256";
  compression: "gzip" | "none";
  iv: string;
  ciphertext: string;
  ciphertextHash: string;
  plaintextHash: string;
  plaintextBytes: number;
  encryptedBytes: number;
};

export type CloudSyncOutboxEntry = {
  operationId: string;
  projectId: string;
  envelope: EncryptedCloudSnapshot;
  localContentHash: string;
  expectedRemoteRevision: number;
  state: "pending" | "retry" | "conflict";
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
  lastErrorCode: string | null;
};

export type CloudProjectSyncState = {
  projectId: string;
  status: CloudSyncRuntimeStatus;
  remoteRevision: number;
  lastLocalHash: string | null;
  lastRemoteHash: string | null;
  lastSyncedAt: string | null;
  conflictRemoteRevision: number | null;
  conflictRemoteHash: string | null;
  lastErrorCode: string | null;
  updatedAt: string;
};

export type CloudSyncHealth = {
  schemaVersion: typeof CLOUD_SYNC_SCHEMA_VERSION;
  status: "ready" | "configuration_required" | "migration_required" | "degraded";
  provider: "Supabase";
  storageBackend: "private-object-storage";
  encryption: "client-side-aes-gcm";
  canonicalAuthority: "IndexedDB";
  migrationVersion: string | null;
  retryable: boolean;
};

export type CloudProjectRemoteSummary = {
  projectId: string;
  revision: number;
  payloadHash: string;
  encryptedBytes: number;
  updatedAt: string;
};

export type CloudSyncPushRequest = {
  operationId: string;
  projectId: string;
  expectedRemoteRevision: number;
  envelope: EncryptedCloudSnapshot;
};

export type CloudSyncPushResult = {
  status: "stored" | "idempotent" | "conflict";
  projectId: string;
  revision: number;
  payloadHash: string;
  updatedAt: string;
};

export type CloudSyncPullResult = CloudProjectRemoteSummary & {
  envelope: EncryptedCloudSnapshot;
};

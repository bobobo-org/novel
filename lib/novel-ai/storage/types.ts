export type StorageSupport = "supported" | "partial" | "unsupported";

export type StorageMode = "SUPABASE_CLOUD" | "SQLITE_LOCAL" | "INDEXEDDB_BROWSER" | "MEMORY_TEST";

export type CanonicalAuthority = "local" | "advisory";

export type StorageLocation =
  | "browser"
  | "local_sqlite"
  | "local_closed_cloud"
  | "supabase_cloud"
  | "memory_test";

export type StoryBibleStorageCapabilities = {
  transactions: StorageSupport;
  optimisticLock: StorageSupport;
  advisoryLock: StorageSupport;
  fullTextSearch: StorageSupport;
  vectorSearch: StorageSupport;
  streaming: StorageSupport;
  batchWrite: StorageSupport;
  integrityChain: StorageSupport;
  export: StorageSupport;
  import: StorageSupport;
  offline: StorageSupport;
  browserCompatible: StorageSupport;
  maxRecommendedProjectSize: number;
  maxRecommendedVersionCount: number;
};

export type StoryBibleProjectPolicy = {
  primaryStorage: StorageMode;
  canonicalAuthority: "local";
  cloudSyncEnabled: boolean;
  cloudBackupEnabled: boolean;
  externalImportEnabled: boolean;
  fullOfflineRequired: boolean;
  encryptionRequired: boolean;
  storageSchemaVersion: string;
  lastMigrationAt?: string | null;
  lastVerifiedAt?: string | null;
};

export type StoryBibleDataLocationMetadata = {
  storageLocation: StorageLocation;
  inferenceLocation: "browser" | "local" | "cloud" | "none";
  canonicalAuthority: "local";
  dataLeftDevice: boolean;
  syncedToCloud: boolean;
  importedFromExternal: boolean;
  sourceProviderType: "none" | "gemini" | "chatgpt" | "grok" | "ollama" | "lm_studio" | "manual";
};

export type JsonRecord = Record<string, unknown>;

export type TransactionContext = {
  transactionId: string;
  extractionPersistence: {
    persistRows(rows: ExtractionPersistenceRows): Promise<void>;
  };
};

export type ExtractionPersistenceRows = {
  projectId: string;
  storyBibleRow: JsonRecord;
  extractionRunRow: JsonRecord;
  candidateRows: JsonRecord[];
  conflictRows: JsonRecord[];
  sourceRows: JsonRecord[];
  chapterSummaryRow: JsonRecord;
};

export interface StoryBibleStorageAdapter {
  readonly id: string;
  readonly mode: StorageMode;
  readonly label: string;
  readonly capabilities: StoryBibleStorageCapabilities;

  createProject(project: JsonRecord): Promise<JsonRecord>;
  getProject(projectId: string): Promise<JsonRecord | null>;
  updateProject(projectId: string, patch: JsonRecord): Promise<JsonRecord>;
  deleteTestProject(projectId: string): Promise<{ deleted: boolean }>;
  listProjects(limit?: number): Promise<JsonRecord[]>;

  createCandidate(candidate: JsonRecord): Promise<JsonRecord>;
  getCandidate(projectId: string, candidateId: string): Promise<JsonRecord | null>;
  listCandidates(projectId: string, limit?: number): Promise<JsonRecord[]>;
  updateCandidateStatus(projectId: string, candidateId: string, status: string, patch?: JsonRecord): Promise<JsonRecord>;
  lockCandidate(projectId: string, candidateId: string, lockId: string): Promise<JsonRecord>;
  saveCandidateAudit(audit: JsonRecord): Promise<JsonRecord>;

  createConflict(conflict: JsonRecord): Promise<JsonRecord>;
  getConflict(projectId: string, conflictId: string): Promise<JsonRecord | null>;
  listConflicts(projectId: string, limit?: number): Promise<JsonRecord[]>;
  updateConflictStatus(projectId: string, conflictId: string, status: string, patch?: JsonRecord): Promise<JsonRecord>;

  createCanonicalEntity(entityType: string, entity: JsonRecord): Promise<JsonRecord>;
  getCanonicalEntity(projectId: string, entityType: string, entityId: string): Promise<JsonRecord | null>;
  updateCanonicalEntity(projectId: string, entityType: string, entityId: string, patch: JsonRecord): Promise<JsonRecord>;
  listCanonicalEntities(projectId: string, entityType: string, limit?: number): Promise<JsonRecord[]>;
  deactivateCanonicalEntity(projectId: string, entityType: string, entityId: string, reason: string): Promise<JsonRecord>;
  getCurrentCanonicalState(projectId: string): Promise<JsonRecord>;

  createSource(source: JsonRecord): Promise<JsonRecord>;
  getSource(projectId: string, sourceId: string): Promise<JsonRecord | null>;
  listSources(projectId: string, limit?: number): Promise<JsonRecord[]>;
  createCanonicalSourceRelation(relation: JsonRecord): Promise<JsonRecord>;

  createVersion(version: JsonRecord): Promise<JsonRecord>;
  getVersion(projectId: string, versionId: string): Promise<JsonRecord | null>;
  listVersions(projectId: string, limit?: number): Promise<JsonRecord[]>;
  getCurrentVersion(projectId: string): Promise<JsonRecord | null>;
  getVersionRange(projectId: string, fromVersion: number, toVersion: number): Promise<JsonRecord[]>;
  getEntityHistory(projectId: string, entityType: string, entityId: string): Promise<JsonRecord[]>;
  getFieldHistory(projectId: string, entityType: string, entityId: string, fieldPath: string): Promise<JsonRecord[]>;

  saveIntegrityMetadata(metadata: JsonRecord): Promise<JsonRecord>;
  getIntegrityChain(projectId: string): Promise<JsonRecord[]>;
  verifyStoredIntegrityFields(projectId: string): Promise<{ ok: boolean; checked: number; errors: JsonRecord[] }>;

  beginMutationRequest(request: JsonRecord): Promise<JsonRecord>;
  getMutationRequest(requestId: string): Promise<JsonRecord | null>;
  completeMutationRequest(requestId: string, response: JsonRecord): Promise<JsonRecord>;
  failMutationRequest(requestId: string, error: JsonRecord): Promise<JsonRecord>;

  persistExtractionRows(rows: ExtractionPersistenceRows): Promise<void>;

  createExportAudit(audit: JsonRecord): Promise<JsonRecord>;
  createRevertAudit(audit: JsonRecord): Promise<JsonRecord>;
  saveRevertMetadata(metadata: JsonRecord): Promise<JsonRecord>;

  transaction<T>(callback: (ctx: TransactionContext) => Promise<T>): Promise<T>;
  advisoryLock(lockKey: string): Promise<{ lockKey: string; acquired: boolean }>;
  optimisticVersionCheck(projectId: string, expectedVersion: number): Promise<{ ok: boolean; currentVersion: number }>;
}

export function unsupportedCapability(adapterId: string, method: string): never {
  const err = new Error(`${adapterId}.${method} is unsupported by this storage adapter.`);
  err.name = "STORAGE_CAPABILITY_UNSUPPORTED";
  throw err;
}

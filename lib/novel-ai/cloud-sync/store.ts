import {
  CLOUD_SYNC_SCHEMA_VERSION,
  type CloudProjectSyncState,
  type CloudSyncConfig,
  type CloudSyncOutboxEntry,
} from "./types";

const DB_NAME = "novel-cloud-sync";
const DB_VERSION = 1;
const CONFIG_STORE = "config";
const OUTBOX_STORE = "outbox";
const PROJECT_STORE = "projects";

type StoredConfig = CloudSyncConfig & { id: "primary" };

export interface CloudSyncStore {
  getConfig(): Promise<CloudSyncConfig>;
  putConfig(config: CloudSyncConfig): Promise<void>;
  listOutbox(): Promise<CloudSyncOutboxEntry[]>;
  putOutbox(entry: CloudSyncOutboxEntry): Promise<void>;
  deleteOutbox(operationId: string): Promise<void>;
  deleteProjectOutbox(projectId: string): Promise<void>;
  clearSyncState(): Promise<void>;
  getProjectState(projectId: string): Promise<CloudProjectSyncState | null>;
  listProjectStates(): Promise<CloudProjectSyncState[]>;
  putProjectState(state: CloudProjectSyncState): Promise<void>;
}

export function defaultCloudSyncConfig(): CloudSyncConfig {
  return {
    schemaVersion: CLOUD_SYNC_SCHEMA_VERSION,
    enabled: false,
    autoSync: true,
    syncKey: null,
    createdAt: null,
    updatedAt: new Date().toISOString(),
  };
}

export function defaultCloudProjectState(projectId: string): CloudProjectSyncState {
  return {
    projectId,
    status: "disabled",
    remoteRevision: 0,
    lastLocalHash: null,
    lastRemoteHash: null,
    lastSyncedAt: null,
    conflictRemoteRevision: null,
    conflictRemoteHash: null,
    lastErrorCode: null,
    canonicalAuthority: "IndexedDBFallback",
    authorityVerifiedAt: null,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeCloudProjectState(
  state: CloudProjectSyncState,
): CloudProjectSyncState {
  return {
    ...defaultCloudProjectState(state.projectId),
    ...state,
    canonicalAuthority: state.canonicalAuthority
      ?? (state.status === "synced" ? "Supabase" : "IndexedDBFallback"),
    authorityVerifiedAt: state.authorityVerifiedAt
      ?? (state.status === "synced" ? state.lastSyncedAt : null),
  };
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("CLOUD_SYNC_INDEXEDDB_REQUEST_FAILED"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("CLOUD_SYNC_INDEXEDDB_TRANSACTION_ABORTED"));
    transaction.onerror = () => reject(transaction.error ?? new Error("CLOUD_SYNC_INDEXEDDB_TRANSACTION_FAILED"));
  });
}

export class IndexedDbCloudSyncStore implements CloudSyncStore {
  private database: Promise<IDBDatabase> | null = null;

  private open() {
    if (typeof indexedDB === "undefined") {
      return Promise.reject(Object.assign(new Error("IndexedDB unavailable."), {
        code: "CLOUD_SYNC_INDEXEDDB_UNAVAILABLE",
      }));
    }
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(CONFIG_STORE)) {
            database.createObjectStore(CONFIG_STORE, { keyPath: "id" });
          }
          if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
            const store = database.createObjectStore(OUTBOX_STORE, { keyPath: "operationId" });
            store.createIndex("projectId", "projectId", { unique: false });
            store.createIndex("nextAttemptAt", "nextAttemptAt", { unique: false });
          }
          if (!database.objectStoreNames.contains(PROJECT_STORE)) {
            database.createObjectStore(PROJECT_STORE, { keyPath: "projectId" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("CLOUD_SYNC_INDEXEDDB_OPEN_FAILED"));
        request.onblocked = () => reject(new Error("CLOUD_SYNC_INDEXEDDB_UPGRADE_BLOCKED"));
      });
    }
    return this.database;
  }

  async getConfig() {
    const database = await this.open();
    const stored = await idbRequest(
      database.transaction(CONFIG_STORE).objectStore(CONFIG_STORE).get("primary"),
    ) as StoredConfig | undefined;
    if (!stored) return defaultCloudSyncConfig();
    return {
      schemaVersion: stored.schemaVersion,
      enabled: stored.enabled,
      autoSync: stored.autoSync,
      syncKey: stored.syncKey,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    };
  }

  async putConfig(config: CloudSyncConfig) {
    const database = await this.open();
    const transaction = database.transaction(CONFIG_STORE, "readwrite");
    transaction.objectStore(CONFIG_STORE).put({ ...config, id: "primary" } satisfies StoredConfig);
    await transactionComplete(transaction);
  }

  async listOutbox() {
    const database = await this.open();
    return idbRequest(database.transaction(OUTBOX_STORE).objectStore(OUTBOX_STORE).getAll()) as Promise<CloudSyncOutboxEntry[]>;
  }

  async putOutbox(entry: CloudSyncOutboxEntry) {
    const database = await this.open();
    const transaction = database.transaction(OUTBOX_STORE, "readwrite");
    transaction.objectStore(OUTBOX_STORE).put(entry);
    await transactionComplete(transaction);
  }

  async deleteOutbox(operationId: string) {
    const database = await this.open();
    const transaction = database.transaction(OUTBOX_STORE, "readwrite");
    transaction.objectStore(OUTBOX_STORE).delete(operationId);
    await transactionComplete(transaction);
  }

  async deleteProjectOutbox(projectId: string) {
    const database = await this.open();
    const transaction = database.transaction(OUTBOX_STORE, "readwrite");
    const index = transaction.objectStore(OUTBOX_STORE).index("projectId");
    const keys = await idbRequest(index.getAllKeys(projectId));
    for (const key of keys) transaction.objectStore(OUTBOX_STORE).delete(key);
    await transactionComplete(transaction);
  }

  async clearSyncState() {
    const database = await this.open();
    const transaction = database.transaction([OUTBOX_STORE, PROJECT_STORE], "readwrite");
    transaction.objectStore(OUTBOX_STORE).clear();
    transaction.objectStore(PROJECT_STORE).clear();
    await transactionComplete(transaction);
  }

  async getProjectState(projectId: string) {
    const database = await this.open();
    const stored = await idbRequest(
      database.transaction(PROJECT_STORE).objectStore(PROJECT_STORE).get(projectId),
    ) as CloudProjectSyncState | undefined;
    return stored ? normalizeCloudProjectState(stored) : null;
  }

  async listProjectStates() {
    const database = await this.open();
    const stored = await idbRequest(
      database.transaction(PROJECT_STORE).objectStore(PROJECT_STORE).getAll(),
    ) as CloudProjectSyncState[];
    return stored.map(normalizeCloudProjectState);
  }

  async putProjectState(state: CloudProjectSyncState) {
    const database = await this.open();
    const transaction = database.transaction(PROJECT_STORE, "readwrite");
    transaction.objectStore(PROJECT_STORE).put(state);
    await transactionComplete(transaction);
  }
}

export class MemoryCloudSyncStore implements CloudSyncStore {
  private config = defaultCloudSyncConfig();
  private outbox = new Map<string, CloudSyncOutboxEntry>();
  private projects = new Map<string, CloudProjectSyncState>();

  async getConfig() { return structuredClone(this.config); }
  async putConfig(config: CloudSyncConfig) { this.config = structuredClone(config); }
  async listOutbox() { return [...this.outbox.values()].map((item) => structuredClone(item)); }
  async putOutbox(entry: CloudSyncOutboxEntry) { this.outbox.set(entry.operationId, structuredClone(entry)); }
  async deleteOutbox(operationId: string) { this.outbox.delete(operationId); }
  async deleteProjectOutbox(projectId: string) {
    for (const [operationId, entry] of this.outbox) {
      if (entry.projectId === projectId) this.outbox.delete(operationId);
    }
  }
  async clearSyncState() {
    this.outbox.clear();
    this.projects.clear();
  }
  async getProjectState(projectId: string) {
    const state = this.projects.get(projectId);
    return state ? normalizeCloudProjectState(structuredClone(state)) : null;
  }
  async listProjectStates() {
    return [...this.projects.values()].map((item) => normalizeCloudProjectState(structuredClone(item)));
  }
  async putProjectState(state: CloudProjectSyncState) { this.projects.set(state.projectId, structuredClone(state)); }
}

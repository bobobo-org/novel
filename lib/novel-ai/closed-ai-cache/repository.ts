import type { ClosedAICacheEntry } from "./types";

export interface ClosedAICacheRepository {
  readonly kind: "memory" | "indexeddb";
  get<T>(id: string): Promise<ClosedAICacheEntry<T> | null>;
  list<T>(): Promise<Array<ClosedAICacheEntry<T>>>;
  put<T>(entry: ClosedAICacheEntry<T>): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryClosedAICacheRepository implements ClosedAICacheRepository {
  readonly kind = "memory" as const;
  private readonly entries = new Map<string, ClosedAICacheEntry>();

  async get<T>(id: string) {
    const entry = this.entries.get(id);
    return entry ? structuredClone(entry) as ClosedAICacheEntry<T> : null;
  }

  async list<T>() {
    return [...this.entries.values()].map((entry) => structuredClone(entry) as ClosedAICacheEntry<T>);
  }

  async put<T>(entry: ClosedAICacheEntry<T>) {
    this.entries.set(entry.id, structuredClone(entry));
  }

  async remove(id: string) {
    this.entries.delete(id);
  }

  async clear() {
    this.entries.clear();
  }
}

const DB_NAME = "novel-closed-agent-os";
const DB_VERSION = 1;
const STORE = "cacheEntries";

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("CLOSED_AI_INDEXEDDB_REQUEST_FAILED"));
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("CLOSED_AI_INDEXEDDB_TRANSACTION_ABORTED"));
    transaction.onerror = () => reject(transaction.error ?? new Error("CLOSED_AI_INDEXEDDB_TRANSACTION_FAILED"));
  });
}

export class IndexedDbClosedAICacheRepository implements ClosedAICacheRepository {
  readonly kind = "indexeddb" as const;
  private database: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new Error("CLOSED_AI_INDEXEDDB_UNAVAILABLE"));
    }
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const opening = indexedDB.open(DB_NAME, DB_VERSION);
        opening.onupgradeneeded = () => {
          const database = opening.result;
          const store = database.objectStoreNames.contains(STORE)
            ? opening.transaction!.objectStore(STORE)
            : database.createObjectStore(STORE, { keyPath: "id" });
          if (!store.indexNames.contains("projectId")) {
            store.createIndex("projectId", "namespace.projectId", { unique: false });
          }
          if (!store.indexNames.contains("layer")) {
            store.createIndex("layer", "layer", { unique: false });
          }
        };
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error ?? new Error("CLOSED_AI_INDEXEDDB_OPEN_FAILED"));
        opening.onblocked = () => reject(new Error("CLOSED_AI_INDEXEDDB_UPGRADE_BLOCKED"));
      });
    }
    return this.database;
  }

  async get<T>(id: string) {
    const database = await this.open();
    const value = await request(database.transaction(STORE).objectStore(STORE).get(id));
    return (value as ClosedAICacheEntry<T> | undefined) ?? null;
  }

  async list<T>() {
    const database = await this.open();
    return request(database.transaction(STORE).objectStore(STORE).getAll()) as Promise<Array<ClosedAICacheEntry<T>>>;
  }

  async put<T>(entry: ClosedAICacheEntry<T>) {
    const database = await this.open();
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(entry);
    await complete(transaction);
  }

  async remove(id: string) {
    const database = await this.open();
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(id);
    await complete(transaction);
  }

  async clear() {
    const database = await this.open();
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).clear();
    await complete(transaction);
  }
}

export function createClosedAICacheRepository(): ClosedAICacheRepository {
  return typeof indexedDB === "undefined"
    ? new MemoryClosedAICacheRepository()
    : new IndexedDbClosedAICacheRepository();
}

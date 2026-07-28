import { estimateJsonBytes, sha256Hex } from "./hashing";
import type { ClosedAICacheEntry } from "./types";

export interface ClosedAICacheRepository {
  readonly kind: "memory" | "indexeddb-opfs";
  opfsStatus(): "ready" | "not_probed" | "runtime_unavailable" | "not_applicable";
  get<T>(id: string): Promise<ClosedAICacheEntry<T> | null>;
  list<T>(): Promise<Array<ClosedAICacheEntry<T>>>;
  put<T>(entry: ClosedAICacheEntry<T>): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryClosedAICacheRepository implements ClosedAICacheRepository {
  readonly kind = "memory" as const;
  private readonly entries = new Map<string, ClosedAICacheEntry>();

  opfsStatus() {
    return "not_applicable" as const;
  }

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
const DB_VERSION = 2;
const STORE = "cacheEntries";
const OPFS_DIRECTORY = "closed-ai-cache";
const DEFAULT_OPFS_THRESHOLD_BYTES = 64 * 1_024;

type PersistedClosedAICacheEntry<T = unknown> =
  Omit<ClosedAICacheEntry<T>, "value">
  & {
    value?: T;
    payloadStorage: "inline" | "opfs";
    payloadRef: string | null;
  };

type IndexedDbRepositoryOptions = {
  dbName?: string;
  opfsThresholdBytes?: number;
  opfsRootFactory?: () => Promise<FileSystemDirectoryHandle>;
};

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
  readonly kind = "indexeddb-opfs" as const;
  private readonly dbName: string;
  private readonly opfsThresholdBytes: number;
  private readonly opfsRootFactory?: () => Promise<FileSystemDirectoryHandle>;
  private database: Promise<IDBDatabase> | null = null;
  private opfsDirectory: Promise<FileSystemDirectoryHandle | null> | null = null;
  private opfsRuntimeStatus: "ready" | "not_probed" | "runtime_unavailable" = "not_probed";

  constructor(options: IndexedDbRepositoryOptions = {}) {
    this.dbName = options.dbName ?? DB_NAME;
    this.opfsThresholdBytes = Math.max(
      1_024,
      options.opfsThresholdBytes ?? DEFAULT_OPFS_THRESHOLD_BYTES,
    );
    this.opfsRootFactory = options.opfsRootFactory;
  }

  opfsStatus() {
    return this.opfsRuntimeStatus;
  }

  private open(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new Error("CLOSED_AI_INDEXEDDB_UNAVAILABLE"));
    }
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const opening = indexedDB.open(this.dbName, DB_VERSION);
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

  private directory(): Promise<FileSystemDirectoryHandle | null> {
    if (!this.opfsDirectory) {
      this.opfsDirectory = (async () => {
        try {
          const root = this.opfsRootFactory
            ? await this.opfsRootFactory()
            : await navigator.storage.getDirectory();
          const directory = await root.getDirectoryHandle(OPFS_DIRECTORY, { create: true });
          this.opfsRuntimeStatus = "ready";
          return directory;
        } catch {
          this.opfsRuntimeStatus = "runtime_unavailable";
          return null;
        }
      })();
    }
    return this.opfsDirectory;
  }

  private async payloadRef(id: string) {
    return `${await sha256Hex(id)}.json`;
  }

  private async writeOpfs<T>(id: string, value: T): Promise<string | null> {
    const directory = await this.directory();
    if (!directory) return null;
    const ref = await this.payloadRef(id);
    try {
      const file = await directory.getFileHandle(ref, { create: true });
      const writable = await file.createWritable();
      await writable.write(JSON.stringify(value));
      await writable.close();
      return ref;
    } catch {
      this.opfsRuntimeStatus = "runtime_unavailable";
      return null;
    }
  }

  private async readOpfs<T>(
    ref: string,
  ): Promise<{ found: true; value: T } | { found: false }> {
    const directory = await this.directory();
    if (!directory) return { found: false };
    try {
      const handle = await directory.getFileHandle(ref);
      return {
        found: true,
        value: JSON.parse(await (await handle.getFile()).text()) as T,
      };
    } catch {
      return { found: false };
    }
  }

  private async removeOpfs(ref: string | null | undefined) {
    if (!ref) return;
    const directory = await this.directory();
    if (!directory) return;
    await directory.removeEntry(ref).catch(() => undefined);
  }

  private async hydrate<T>(
    persisted: PersistedClosedAICacheEntry<T> | undefined,
  ): Promise<ClosedAICacheEntry<T> | null> {
    if (!persisted) return null;
    if (
      (persisted.payloadStorage === "inline" || persisted.payloadStorage === undefined)
      && Object.prototype.hasOwnProperty.call(persisted, "value")
    ) {
      const { payloadStorage: _payloadStorage, payloadRef: _payloadRef, ...entry } = persisted;
      void _payloadStorage;
      void _payloadRef;
      return structuredClone(entry) as ClosedAICacheEntry<T>;
    }
    if (persisted.payloadStorage === "opfs" && persisted.payloadRef) {
      const payload = await this.readOpfs<T>(persisted.payloadRef);
      if (!payload.found) return null;
      const {
        payloadStorage: _payloadStorage,
        payloadRef: _payloadRef,
        ...metadata
      } = persisted;
      void _payloadStorage;
      void _payloadRef;
      return { ...metadata, value: payload.value } as ClosedAICacheEntry<T>;
    }
    return null;
  }

  async get<T>(id: string) {
    const database = await this.open();
    const value = await request(database.transaction(STORE).objectStore(STORE).get(id));
    return this.hydrate(value as PersistedClosedAICacheEntry<T> | undefined);
  }

  async list<T>() {
    const database = await this.open();
    const persisted = await request(
      database.transaction(STORE).objectStore(STORE).getAll(),
    ) as Array<PersistedClosedAICacheEntry<T>>;
    const entries = await Promise.all(persisted.map((entry) => this.hydrate(entry)));
    return entries.filter((entry): entry is ClosedAICacheEntry<T> => entry !== null);
  }

  async put<T>(entry: ClosedAICacheEntry<T>) {
    const database = await this.open();
    const previous = await request(
      database.transaction(STORE).objectStore(STORE).get(entry.id),
    ) as PersistedClosedAICacheEntry<T> | undefined;
    const useOpfs = estimateJsonBytes(entry.value) >= this.opfsThresholdBytes;
    const payloadRef = useOpfs ? await this.writeOpfs(entry.id, entry.value) : null;
    const persisted: PersistedClosedAICacheEntry<T> = payloadRef
      ? {
        ...structuredClone(entry),
        value: undefined,
        payloadStorage: "opfs",
        payloadRef,
      }
      : {
        ...structuredClone(entry),
        payloadStorage: "inline",
        payloadRef: null,
      };
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(persisted);
    await complete(transaction);
    if (previous?.payloadRef && previous.payloadRef !== payloadRef) {
      await this.removeOpfs(previous.payloadRef);
    }
  }

  async remove(id: string) {
    const database = await this.open();
    const previous = await request(
      database.transaction(STORE).objectStore(STORE).get(id),
    ) as PersistedClosedAICacheEntry | undefined;
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(id);
    await complete(transaction);
    await this.removeOpfs(previous?.payloadRef);
  }

  async clear() {
    const database = await this.open();
    const entries = await request(
      database.transaction(STORE).objectStore(STORE).getAll(),
    ) as Array<PersistedClosedAICacheEntry>;
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).clear();
    await complete(transaction);
    await Promise.all(entries.map((entry) => this.removeOpfs(entry.payloadRef)));
  }
}

export function createClosedAICacheRepository(): ClosedAICacheRepository {
  return typeof indexedDB === "undefined"
    ? new MemoryClosedAICacheRepository()
    : new IndexedDbClosedAICacheRepository();
}

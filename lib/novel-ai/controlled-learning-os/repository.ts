import type {
  ControlledLearningRecord,
  ControlledLearningRecordKind,
} from "./types";

export interface ControlledLearningRepository {
  readonly kind: "memory" | "indexeddb";
  get<T extends ControlledLearningRecord>(id: string): Promise<T | null>;
  list<T extends ControlledLearningRecord>(
    projectId: string,
    kind?: ControlledLearningRecordKind,
  ): Promise<T[]>;
  put(record: ControlledLearningRecord): Promise<void>;
  remove(id: string): Promise<void>;
  clearProject(projectId: string): Promise<void>;
}

export class MemoryControlledLearningRepository implements ControlledLearningRepository {
  readonly kind = "memory" as const;
  private readonly records = new Map<string, ControlledLearningRecord>();

  async get<T extends ControlledLearningRecord>(id: string) {
    const record = this.records.get(id);
    return record ? structuredClone(record) as T : null;
  }

  async list<T extends ControlledLearningRecord>(
    projectId: string,
    kind?: ControlledLearningRecordKind,
  ) {
    return [...this.records.values()]
      .filter((record) => record.projectId === projectId && (!kind || record.kind === kind))
      .map((record) => structuredClone(record) as T);
  }

  async put(record: ControlledLearningRecord) {
    this.records.set(record.id, structuredClone(record));
  }

  async remove(id: string) {
    this.records.delete(id);
  }

  async clearProject(projectId: string) {
    for (const [id, record] of this.records) {
      if (record.projectId === projectId) this.records.delete(id);
    }
  }
}

const DB_NAME = "novel-controlled-learning-os";
const DB_VERSION = 1;
const STORE = "records";

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("CONTROLLED_LEARNING_DB_REQUEST_FAILED"));
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("CONTROLLED_LEARNING_DB_ABORTED"));
    transaction.onerror = () => reject(transaction.error ?? new Error("CONTROLLED_LEARNING_DB_FAILED"));
  });
}

export class IndexedDbControlledLearningRepository implements ControlledLearningRepository {
  readonly kind = "indexeddb" as const;
  private database: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new Error("CONTROLLED_LEARNING_INDEXEDDB_UNAVAILABLE"));
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
            store.createIndex("projectId", "projectId", { unique: false });
          }
          if (!store.indexNames.contains("kind")) {
            store.createIndex("kind", "kind", { unique: false });
          }
        };
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error ?? new Error("CONTROLLED_LEARNING_DB_OPEN_FAILED"));
        opening.onblocked = () => reject(new Error("CONTROLLED_LEARNING_DB_UPGRADE_BLOCKED"));
      });
    }
    return this.database;
  }

  async get<T extends ControlledLearningRecord>(id: string) {
    const database = await this.open();
    return (await request(database.transaction(STORE).objectStore(STORE).get(id)) as T | undefined) ?? null;
  }

  async list<T extends ControlledLearningRecord>(
    projectId: string,
    kind?: ControlledLearningRecordKind,
  ) {
    const database = await this.open();
    const records = await request(
      database.transaction(STORE).objectStore(STORE).index("projectId").getAll(projectId),
    ) as ControlledLearningRecord[];
    return records.filter((record) => !kind || record.kind === kind) as T[];
  }

  async put(record: ControlledLearningRecord) {
    const database = await this.open();
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(record);
    await complete(transaction);
  }

  async remove(id: string) {
    const database = await this.open();
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(id);
    await complete(transaction);
  }

  async clearProject(projectId: string) {
    const records = await this.list(projectId);
    const database = await this.open();
    const transaction = database.transaction(STORE, "readwrite");
    for (const record of records) transaction.objectStore(STORE).delete(record.id);
    await complete(transaction);
  }
}

export function createControlledLearningRepository(): ControlledLearningRepository {
  return typeof indexedDB === "undefined"
    ? new MemoryControlledLearningRepository()
    : new IndexedDbControlledLearningRepository();
}

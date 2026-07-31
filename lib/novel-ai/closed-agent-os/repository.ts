import type { ClosedAgentStateRecord } from "./types";

export interface ClosedAgentStateRepository {
  readonly kind: "memory" | "indexeddb";
  get<T extends ClosedAgentStateRecord>(id: string): Promise<T | null>;
  list<T extends ClosedAgentStateRecord>(projectId: string, kind?: T["kind"]): Promise<T[]>;
  put(record: ClosedAgentStateRecord): Promise<void>;
  putMany(records: ClosedAgentStateRecord[]): Promise<void>;
}

export class MemoryClosedAgentStateRepository implements ClosedAgentStateRepository {
  readonly kind = "memory" as const;
  private readonly records = new Map<string, ClosedAgentStateRecord>();
  private readonly faultInjector: ((point: string) => void) | null;

  constructor(options: { faultInjector?: (point: string) => void } = {}) {
    this.faultInjector = options.faultInjector ?? null;
  }

  private inject(point: string) {
    this.faultInjector?.(point);
  }

  async get<T extends ClosedAgentStateRecord>(id: string) {
    const record = this.records.get(id);
    return record ? structuredClone(record) as T : null;
  }

  async list<T extends ClosedAgentStateRecord>(projectId: string, kind?: T["kind"]) {
    return [...this.records.values()]
      .filter((record) => record.projectId === projectId && (!kind || record.kind === kind))
      .map((record) => structuredClone(record) as T);
  }

  async put(record: ClosedAgentStateRecord) {
    await this.putMany([record]);
  }

  async putMany(records: ClosedAgentStateRecord[]) {
    const before = new Map(this.records);
    try {
      for (const record of records) {
        this.inject(`before:${record.kind}`);
        this.records.set(record.id, structuredClone(record));
        this.inject(`after:${record.kind}`);
      }
    } catch (error) {
      this.records.clear();
      for (const [id, record] of before) this.records.set(id, record);
      throw error;
    }
  }
}

const DB_NAME = "novel-closed-agent-state";
const DB_VERSION = 1;
const STORE = "records";

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("CLOSED_AGENT_STATE_DB_REQUEST_FAILED"));
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("CLOSED_AGENT_STATE_DB_ABORTED"));
    transaction.onerror = () => reject(transaction.error ?? new Error("CLOSED_AGENT_STATE_DB_FAILED"));
  });
}

export class IndexedDbClosedAgentStateRepository implements ClosedAgentStateRepository {
  readonly kind = "indexeddb" as const;
  private database: Promise<IDBDatabase> | null = null;
  private readonly faultInjector: ((point: string) => void) | null;

  constructor(options: { faultInjector?: (point: string) => void } = {}) {
    this.faultInjector = options.faultInjector ?? null;
  }

  private inject(point: string) {
    this.faultInjector?.(point);
  }

  private open() {
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new Error("CLOSED_AGENT_STATE_INDEXEDDB_UNAVAILABLE"));
    }
    if (!this.database) {
      this.database = new Promise<IDBDatabase>((resolve, reject) => {
        const opening = indexedDB.open(DB_NAME, DB_VERSION);
        opening.onupgradeneeded = () => {
          const database = opening.result;
          const store = database.objectStoreNames.contains(STORE)
            ? opening.transaction!.objectStore(STORE)
            : database.createObjectStore(STORE, { keyPath: "id" });
          if (!store.indexNames.contains("projectId")) {
            store.createIndex("projectId", "projectId", { unique: false });
          }
        };
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error ?? new Error("CLOSED_AGENT_STATE_DB_OPEN_FAILED"));
        opening.onblocked = () => reject(new Error("CLOSED_AGENT_STATE_DB_UPGRADE_BLOCKED"));
      });
    }
    return this.database;
  }

  async get<T extends ClosedAgentStateRecord>(id: string) {
    const database = await this.open();
    return (await request(database.transaction(STORE).objectStore(STORE).get(id)) as T | undefined) ?? null;
  }

  async list<T extends ClosedAgentStateRecord>(projectId: string, kind?: T["kind"]) {
    const database = await this.open();
    const records = await request(
      database.transaction(STORE).objectStore(STORE).index("projectId").getAll(projectId),
    ) as ClosedAgentStateRecord[];
    return records.filter((record) => !kind || record.kind === kind) as T[];
  }

  async put(record: ClosedAgentStateRecord) {
    await this.putMany([record]);
  }

  async putMany(records: ClosedAgentStateRecord[]) {
    const database = await this.open();
    const transaction = database.transaction(STORE, "readwrite");
    try {
      const store = transaction.objectStore(STORE);
      for (const record of records) {
        this.inject(`before:${record.kind}`);
        store.put(record);
        this.inject(`after:${record.kind}`);
      }
      await complete(transaction);
    } catch (error) {
      try { transaction.abort(); } catch { /* transaction already completed */ }
      throw error;
    }
  }
}

export function createClosedAgentStateRepository(): ClosedAgentStateRepository {
  return typeof indexedDB === "undefined"
    ? new MemoryClosedAgentStateRepository()
    : new IndexedDbClosedAgentStateRepository();
}

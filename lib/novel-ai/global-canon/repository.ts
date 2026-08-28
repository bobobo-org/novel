import {
  GLOBAL_CANON_DATABASE_NAME,
  GLOBAL_CANON_DATABASE_VERSION,
  GLOBAL_CANON_STORES,
  cloneGlobalCanonRecord,
  type GlobalCanonStoredRecord,
  type GlobalCanonRecordByStore,
  type GlobalCanonStoreName,
} from "./types";

export class GlobalCanonRevisionConflictError extends Error {
  readonly expected: number;
  readonly actual: number;

  constructor(expected: number, actual: number) {
    super(`全域設定已被更新（預期版本 ${expected}，目前版本 ${actual}）`);
    this.name = "GlobalCanonRevisionConflictError";
    this.expected = expected;
    this.actual = actual;
  }
}

export class GlobalCanonRepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = "GlobalCanonRepositoryError";
    this.code = code;
  }
}

export type GlobalCanonRepositoryWrite = {
  [K in GlobalCanonStoreName]: {
    store: K;
    record: GlobalCanonRecordByStore[K];
    expectedRevision?: number;
  };
}[GlobalCanonStoreName];

export interface GlobalCanonRepository {
  readonly kind: "indexeddb" | "memory";
  isAvailable(): boolean;
  get<K extends GlobalCanonStoreName>(
    store: K,
    id: string,
  ): Promise<GlobalCanonRecordByStore[K] | null>;
  list<K extends GlobalCanonStoreName>(
    store: K,
  ): Promise<Array<GlobalCanonRecordByStore[K]>>;
  put<K extends GlobalCanonStoreName>(
    store: K,
    record: GlobalCanonRecordByStore[K],
    expectedRevision?: number,
  ): Promise<GlobalCanonRecordByStore[K]>;
  /** All writes succeed together or none of them are committed. */
  putBatch(writes: readonly GlobalCanonRepositoryWrite[]): Promise<GlobalCanonStoredRecord[]>;
  remove(store: GlobalCanonStoreName, id: string): Promise<void>;
}

const EXPECTED_RECORD_TYPE: Record<GlobalCanonStoreName, GlobalCanonStoredRecord["recordType"]> = {
  characters: "character",
  relationships: "relationship",
  worlds: "world",
  rules: "rule",
  memories: "memory",
  storyBibles: "story_bible",
  timelineTemplates: "timeline_template",
};

function assertStoreMatchesRecord(store: GlobalCanonStoreName, record: GlobalCanonStoredRecord) {
  if (EXPECTED_RECORD_TYPE[store] !== record.recordType) {
    throw new GlobalCanonRepositoryError(
      "GLOBAL_CANON_STORE_TYPE_MISMATCH",
      `資料類型 ${record.recordType} 不能寫入 ${store}`,
    );
  }
}

function nextRecord<T extends GlobalCanonStoredRecord>(record: T, current?: T): T {
  const now = new Date().toISOString();
  return cloneGlobalCanonRecord({
    ...record,
    createdAt: current?.createdAt ?? record.createdAt,
    updatedAt: now,
    revision: current ? current.revision + 1 : Math.max(1, record.revision),
  } as T);
}

function sortNewestFirst<T extends GlobalCanonStoredRecord>(records: T[]) {
  return records.sort((left, right) => {
    const updated = right.updatedAt.localeCompare(left.updatedAt);
    return updated || left.id.localeCompare(right.id);
  });
}

function assertBatchTargets(writes: readonly GlobalCanonRepositoryWrite[]) {
  const seen = new Set<string>();
  for (const write of writes) {
    assertStoreMatchesRecord(write.store, write.record);
    const target = `${write.store}:${write.record.id}`;
    if (seen.has(target)) {
      throw new GlobalCanonRepositoryError(
        "GLOBAL_CANON_BATCH_DUPLICATE_TARGET",
        `同一批次重複寫入 ${target}`,
      );
    }
    seen.add(target);
  }
}

export class MemoryGlobalCanonRepository implements GlobalCanonRepository {
  readonly kind = "memory" as const;
  private stores = new Map<GlobalCanonStoreName, Map<string, GlobalCanonStoredRecord>>(
    GLOBAL_CANON_STORES.map((store) => [store, new Map()]),
  );

  isAvailable() {
    return true;
  }

  async get<K extends GlobalCanonStoreName>(store: K, id: string) {
    const record = this.stores.get(store)?.get(id) as GlobalCanonRecordByStore[K] | undefined;
    return record ? cloneGlobalCanonRecord(record) : null;
  }

  async list<K extends GlobalCanonStoreName>(store: K) {
    const records = [...(this.stores.get(store)?.values() ?? [])]
      .map((record) => cloneGlobalCanonRecord(record as GlobalCanonRecordByStore[K]));
    return sortNewestFirst(records);
  }

  async put<K extends GlobalCanonStoreName>(
    store: K,
    record: GlobalCanonRecordByStore[K],
    expectedRevision?: number,
  ) {
    const [saved] = await this.putBatch([{
      store,
      record,
      expectedRevision,
    } as GlobalCanonRepositoryWrite]);
    return cloneGlobalCanonRecord(saved as GlobalCanonRecordByStore[K]);
  }

  async putBatch(writes: readonly GlobalCanonRepositoryWrite[]) {
    assertBatchTargets(writes);
    const prepared = writes.map((write) => {
      const records = this.stores.get(write.store)!;
      const current = records.get(write.record.id) as GlobalCanonStoredRecord | undefined;
      const actualRevision = current?.revision ?? 0;
      if (write.expectedRevision !== undefined && write.expectedRevision !== actualRevision) {
        throw new GlobalCanonRevisionConflictError(write.expectedRevision, actualRevision);
      }
      return {
        store: write.store,
        record: nextRecord(write.record, current as typeof write.record | undefined),
      };
    });
    // Build replacement maps off to the side. The single final assignment is
    // the in-memory transaction boundary, so a staging failure cannot leave a
    // partially mutated repository.
    const committed = prepared.map(({ store, record }) => ({
      store,
      record: cloneGlobalCanonRecord(record),
    }));
    const nextStores = new Map(this.stores);
    for (const store of new Set(committed.map((entry) => entry.store))) {
      nextStores.set(store, new Map(
        [...this.stores.get(store)!.entries()].map(([id, record]) => [
          id,
          cloneGlobalCanonRecord(record),
        ]),
      ));
    }
    for (const entry of committed) {
      nextStores.get(entry.store)!.set(entry.record.id, entry.record);
    }
    this.stores = nextStores;
    return committed.map(({ record }) => cloneGlobalCanonRecord(record));
  }

  async remove(store: GlobalCanonStoreName, id: string) {
    this.stores.get(store)?.delete(id);
  }
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(new GlobalCanonRepositoryError(
      "GLOBAL_CANON_INDEXEDDB_REQUEST_FAILED",
      value.error?.message || "全域設定資料庫讀寫失敗",
    ));
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new GlobalCanonRepositoryError(
      "GLOBAL_CANON_INDEXEDDB_TRANSACTION_ABORTED",
      transaction.error?.message || "全域設定資料庫交易已中止",
    ));
    transaction.onerror = () => reject(new GlobalCanonRepositoryError(
      "GLOBAL_CANON_INDEXEDDB_TRANSACTION_FAILED",
      transaction.error?.message || "全域設定資料庫交易失敗",
    ));
  });
}

export class IndexedDbGlobalCanonRepository implements GlobalCanonRepository {
  readonly kind = "indexeddb" as const;
  private dbPromise: Promise<IDBDatabase> | null = null;

  isAvailable() {
    return typeof indexedDB !== "undefined";
  }

  private open() {
    if (!this.isAvailable()) {
      return Promise.reject(new GlobalCanonRepositoryError(
        "GLOBAL_CANON_INDEXEDDB_UNAVAILABLE",
        "這個瀏覽器無法使用本機全域設定資料庫",
      ));
    }
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        let settled = false;
        const pending = indexedDB.open(
          GLOBAL_CANON_DATABASE_NAME,
          GLOBAL_CANON_DATABASE_VERSION,
        );
        pending.onupgradeneeded = () => {
          const database = pending.result;
          for (const name of GLOBAL_CANON_STORES) {
            if (database.objectStoreNames.contains(name)) continue;
            const store = database.createObjectStore(name, { keyPath: "id" });
            store.createIndex("updatedAt", "updatedAt", { unique: false });
            store.createIndex("recordType", "recordType", { unique: false });
          }
        };
        pending.onsuccess = () => {
          const database = pending.result;
          // A blocked request may later succeed after its caller has already
          // received the failure. Never leak that late database connection.
          if (settled) {
            database.close();
            return;
          }
          const missingStores = GLOBAL_CANON_STORES.filter(
            (name) => !database.objectStoreNames.contains(name),
          );
          if (missingStores.length) {
            database.close();
            this.dbPromise = null;
            settled = true;
            reject(new GlobalCanonRepositoryError(
              "GLOBAL_CANON_INDEXEDDB_SCHEMA_MISMATCH",
              `全域設定資料庫缺少：${missingStores.join("、")}`,
            ));
            return;
          }
          database.onversionchange = () => {
            database.close();
            this.dbPromise = null;
          };
          settled = true;
          resolve(database);
        };
        pending.onerror = () => {
          if (settled) return;
          settled = true;
          this.dbPromise = null;
          reject(new GlobalCanonRepositoryError(
            "GLOBAL_CANON_INDEXEDDB_OPEN_FAILED",
            pending.error?.message || "無法開啟全域設定資料庫",
          ));
        };
        pending.onblocked = () => {
          if (settled) return;
          settled = true;
          this.dbPromise = null;
          reject(new GlobalCanonRepositoryError(
            "GLOBAL_CANON_INDEXEDDB_UPGRADE_BLOCKED",
            "請關閉其他舊版本頁籤後再重試",
          ));
        };
      });
    }
    return this.dbPromise;
  }

  async get<K extends GlobalCanonStoreName>(store: K, id: string) {
    const database = await this.open();
    const record = await request(
      database.transaction(store).objectStore(store).get(id),
    ) as GlobalCanonRecordByStore[K] | undefined;
    return record ? cloneGlobalCanonRecord(record) : null;
  }

  async list<K extends GlobalCanonStoreName>(store: K) {
    const database = await this.open();
    const records = await request(
      database.transaction(store).objectStore(store).getAll(),
    ) as Array<GlobalCanonRecordByStore[K]>;
    return sortNewestFirst(records.map((record) => cloneGlobalCanonRecord(record)));
  }

  async put<K extends GlobalCanonStoreName>(
    store: K,
    record: GlobalCanonRecordByStore[K],
    expectedRevision?: number,
  ) {
    const [saved] = await this.putBatch([{
      store,
      record,
      expectedRevision,
    } as GlobalCanonRepositoryWrite]);
    return cloneGlobalCanonRecord(saved as GlobalCanonRecordByStore[K]);
  }

  async putBatch(writes: readonly GlobalCanonRepositoryWrite[]) {
    assertBatchTargets(writes);
    if (!writes.length) return [];
    const database = await this.open();
    const stores = [...new Set(writes.map((write) => write.store))];
    const transaction = database.transaction(stores, "readwrite");
    const transactionComplete = complete(transaction);
    try {
      // Queue every read before awaiting so the transaction remains active.
      const currents = await Promise.all(writes.map((write) => request(
        transaction.objectStore(write.store).get(write.record.id),
      ))) as Array<GlobalCanonStoredRecord | undefined>;
      const prepared = writes.map((write, index) => {
        const current = currents[index];
        const actualRevision = current?.revision ?? 0;
        if (write.expectedRevision !== undefined && write.expectedRevision !== actualRevision) {
          throw new GlobalCanonRevisionConflictError(write.expectedRevision, actualRevision);
        }
        return nextRecord(write.record, current as typeof write.record | undefined);
      });
      for (let index = 0; index < writes.length; index += 1) {
        transaction.objectStore(writes[index].store).put(prepared[index]);
      }
      await transactionComplete;
      return prepared.map((record) => cloneGlobalCanonRecord(record));
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already have aborted because of a request error.
      }
      await transactionComplete.catch(() => undefined);
      throw error;
    }
  }

  async remove(store: GlobalCanonStoreName, id: string) {
    const database = await this.open();
    const transaction = database.transaction(store, "readwrite");
    transaction.objectStore(store).delete(id);
    await complete(transaction);
  }
}

export function createGlobalCanonRepository(): GlobalCanonRepository {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined"
    ? new IndexedDbGlobalCanonRepository()
    : new MemoryGlobalCanonRepository();
}

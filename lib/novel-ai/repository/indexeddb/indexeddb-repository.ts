import type { DomainRecord, ProjectBundle } from "../../domain/index";
import { NOVEL_STORES, RevisionConflictError, type NovelRepository, type NovelStoreName } from "../contracts/index";
import { buildImportIdMap, remapImportedRecord, validateImportRecords } from "../import-remap";

const DB_NAME = "novel-intelligence-platform";
const DB_VERSION = 2;
const REQUEST_STORE = "requestLedger";

function request<T>(value: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error ?? new Error("INDEXEDDB_REQUEST_FAILED")); }); }
function complete(tx: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error("INDEXEDDB_TRANSACTION_ABORTED")); tx.onerror = () => reject(tx.error ?? new Error("INDEXEDDB_TRANSACTION_FAILED")); }); }

export class IndexedDbNovelRepository implements NovelRepository {
  readonly kind = "indexeddb" as const;
  private dbPromise: Promise<IDBDatabase> | null = null;
  isAvailable() { return typeof indexedDB !== "undefined"; }
  private open() {
    if (!this.isAvailable()) return Promise.reject(new Error("INDEXEDDB_UNAVAILABLE"));
    if (!this.dbPromise) this.dbPromise = new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => { const db = open.result; for (const name of [...NOVEL_STORES, REQUEST_STORE]) if (!db.objectStoreNames.contains(name)) { const store = db.createObjectStore(name, { keyPath: name === REQUEST_STORE ? "requestId" : "id" }); if (name !== REQUEST_STORE) store.createIndex("projectId", "projectId", { unique: false }); } };
      open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error ?? new Error("INDEXEDDB_OPEN_FAILED")); open.onblocked = () => reject(new Error("INDEXEDDB_UPGRADE_BLOCKED"));
    });
    return this.dbPromise;
  }
  async get<T extends DomainRecord>(store: NovelStoreName, id: string) { const db = await this.open(); return (await request(db.transaction(store).objectStore(store).get(id)) as T | undefined) ?? null; }
  async list<T extends DomainRecord>(store: NovelStoreName, projectId?: string) { const db = await this.open(), objectStore = db.transaction(store).objectStore(store); return await request((projectId ? objectStore.index("projectId").getAll(projectId) : objectStore.getAll()) as IDBRequest<T[]>); }
  async put<T extends DomainRecord>(store: NovelStoreName, record: T, expectedRevision?: number) {
    const db = await this.open(), tx = db.transaction(store, "readwrite"), objectStore = tx.objectStore(store), current = await request(objectStore.get(record.id)) as T | undefined;
    if (expectedRevision !== undefined && (current?.revision ?? 0) !== expectedRevision) { tx.abort(); throw new RevisionConflictError(expectedRevision, current?.revision ?? 0); }
    const next = { ...record, revision: current ? current.revision + 1 : record.revision, updatedAt: new Date().toISOString(), parentRevision: current?.revision ?? null } as T;
    objectStore.put(next); await complete(tx); return next;
  }
  async remove(store: NovelStoreName, id: string) { const db = await this.open(), tx = db.transaction(store, "readwrite"); tx.objectStore(store).delete(id); await complete(tx); }
  async createProject(bundle: ProjectBundle, requestId: string) {
    const db = await this.open(), names = ["projects","projectSeeds","storyBibles","characters","worlds","storyStates","tasks","readerStates","backups",REQUEST_STORE] as string[], tx = db.transaction(names, "readwrite"), ledger = tx.objectStore(REQUEST_STORE);
    const replay = await request(ledger.get(requestId)) as { requestId: string; bundle: ProjectBundle } | undefined;
    if (replay) { tx.abort(); return replay.bundle; }
    if (await request(tx.objectStore("projects").get(bundle.project.id))) { tx.abort(); throw new Error("PROJECT_ALREADY_EXISTS"); }
    const writes: Array<[string, DomainRecord | null]> = [["projects",bundle.project],["projectSeeds",bundle.seed],["storyBibles",bundle.storyBible],["characters",bundle.protagonist],["worlds",bundle.world],["storyStates",bundle.storyState],["tasks",bundle.initialTask],["readerStates",bundle.readerState],["backups",bundle.initialBackup]];
    for (const [store, record] of writes) if (record) tx.objectStore(store).put(record);
    ledger.put({ requestId, projectId: bundle.project.id, bundle, createdAt: new Date().toISOString() }); await complete(tx); return bundle;
  }
  async exportProject(projectId: string) {
    const db = await this.open(), tx = db.transaction([...NOVEL_STORES], "readonly"), output: Record<string, unknown[]> = {};
    await Promise.all(NOVEL_STORES.map(async (store) => { output[store] = await request(tx.objectStore(store).index("projectId").getAll(projectId)); }));
    await complete(tx); return output;
  }
  async importProject(payload: Record<string, unknown[]>, mode: "copy" | "replace", targetProjectId?: string) {
    const { sourceProjectId: sourceId } = validateImportRecords(payload);
    const nextProjectId = mode === "replace" ? (targetProjectId || sourceId) : crypto.randomUUID();
    const idMap = buildImportIdMap(payload, sourceId, nextProjectId);
    const db = await this.open();
    // Keep recovery points while replacing content. The caller deliberately creates a
    // safety backup before restore; deleting it in the same operation defeats recovery.
    const replaceStores = NOVEL_STORES.filter((store) => store !== "backups");
    const tx = db.transaction([...NOVEL_STORES], "readwrite");
    if (mode === "replace") for (const store of replaceStores) {
      const objectStore = tx.objectStore(store);
      const keys = await request(objectStore.index("projectId").getAllKeys(nextProjectId));
      for (const key of keys) objectStore.delete(key);
    }
    for (const store of NOVEL_STORES) {
      if (mode === "replace" && store === "backups") continue;
      for (const raw of payload[store] ?? []) {
      tx.objectStore(store).put(remapImportedRecord(raw as DomainRecord, nextProjectId, idMap, mode === "copy"));
      }
    }
    await complete(tx); return nextProjectId;
  }
}

export function indexedDbCapability() { return { supported: typeof indexedDB !== "undefined", database: DB_NAME, version: DB_VERSION, stores: [...NOVEL_STORES] }; }

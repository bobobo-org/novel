import type { ContentAddressedRecord, VerifiableLedgerBlock } from "./types";

export interface VerifiableLedgerRepository {
  readonly kind: "memory" | "indexeddb";
  append(block: VerifiableLedgerBlock): Promise<void>;
  list(ledgerId: string): Promise<VerifiableLedgerBlock[]>;
  putContent(record: ContentAddressedRecord): Promise<void>;
  getContent(contentAddress: string): Promise<ContentAddressedRecord | null>;
}

export class MemoryVerifiableLedgerRepository implements VerifiableLedgerRepository {
  readonly kind = "memory" as const;
  private readonly blocks = new Map<string, VerifiableLedgerBlock>();
  private readonly contents = new Map<string, ContentAddressedRecord>();

  async append(block: VerifiableLedgerBlock) {
    if (this.blocks.has(block.id)) {
      throw Object.assign(new Error("Append-only ledger block already exists."), {
        code: "LEDGER_APPEND_ONLY_VIOLATION",
      });
    }
    this.blocks.set(block.id, structuredClone(block));
  }

  async list(ledgerId: string) {
    return [...this.blocks.values()]
      .filter((block) => block.ledgerId === ledgerId)
      .sort((left, right) => left.sequence - right.sequence)
      .map((block) => structuredClone(block));
  }

  async putContent(record: ContentAddressedRecord) {
    const previous = this.contents.get(record.contentAddress);
    if (previous && JSON.stringify(previous.content) !== JSON.stringify(record.content)) {
      throw Object.assign(new Error("Content address collision."), {
        code: "CONTENT_ADDRESS_COLLISION",
      });
    }
    this.contents.set(record.contentAddress, structuredClone(record));
  }

  async getContent(contentAddress: string) {
    const record = this.contents.get(contentAddress);
    return record ? structuredClone(record) : null;
  }
}

const DB_NAME = "novel-verifiable-ledger";
const DB_VERSION = 1;
const BLOCK_STORE = "blocks";
const CONTENT_STORE = "contents";

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("VERIFIABLE_LEDGER_DB_REQUEST_FAILED"));
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("VERIFIABLE_LEDGER_DB_ABORTED"));
    transaction.onerror = () => reject(transaction.error ?? new Error("VERIFIABLE_LEDGER_DB_FAILED"));
  });
}

export class IndexedDbVerifiableLedgerRepository implements VerifiableLedgerRepository {
  readonly kind = "indexeddb" as const;
  private database: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new Error("VERIFIABLE_LEDGER_INDEXEDDB_UNAVAILABLE"));
    }
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const opening = indexedDB.open(DB_NAME, DB_VERSION);
        opening.onupgradeneeded = () => {
          const database = opening.result;
          const blockStore = database.objectStoreNames.contains(BLOCK_STORE)
            ? opening.transaction!.objectStore(BLOCK_STORE)
            : database.createObjectStore(BLOCK_STORE, { keyPath: "id" });
          if (!blockStore.indexNames.contains("ledgerId")) {
            blockStore.createIndex("ledgerId", "ledgerId", { unique: false });
          }
          if (!database.objectStoreNames.contains(CONTENT_STORE)) {
            database.createObjectStore(CONTENT_STORE, { keyPath: "contentAddress" });
          }
        };
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error ?? new Error("VERIFIABLE_LEDGER_DB_OPEN_FAILED"));
        opening.onblocked = () => reject(new Error("VERIFIABLE_LEDGER_DB_UPGRADE_BLOCKED"));
      });
    }
    return this.database;
  }

  async append(block: VerifiableLedgerBlock) {
    const database = await this.open();
    const transaction = database.transaction(BLOCK_STORE, "readwrite");
    transaction.objectStore(BLOCK_STORE).add(block);
    await complete(transaction);
  }

  async list(ledgerId: string) {
    const database = await this.open();
    const blocks = await request(
      database.transaction(BLOCK_STORE).objectStore(BLOCK_STORE).index("ledgerId").getAll(ledgerId),
    ) as VerifiableLedgerBlock[];
    return blocks.sort((left, right) => left.sequence - right.sequence);
  }

  async putContent(record: ContentAddressedRecord) {
    const database = await this.open();
    const previous = await this.getContent(record.contentAddress);
    if (previous && JSON.stringify(previous.content) !== JSON.stringify(record.content)) {
      throw Object.assign(new Error("Content address collision."), {
        code: "CONTENT_ADDRESS_COLLISION",
      });
    }
    const transaction = database.transaction(CONTENT_STORE, "readwrite");
    transaction.objectStore(CONTENT_STORE).put(record);
    await complete(transaction);
  }

  async getContent(contentAddress: string) {
    const database = await this.open();
    return (await request(
      database.transaction(CONTENT_STORE).objectStore(CONTENT_STORE).get(contentAddress),
    ) as ContentAddressedRecord | undefined) ?? null;
  }
}

export function createVerifiableLedgerRepository(): VerifiableLedgerRepository {
  return typeof indexedDB === "undefined"
    ? new MemoryVerifiableLedgerRepository()
    : new IndexedDbVerifiableLedgerRepository();
}

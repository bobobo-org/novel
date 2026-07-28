import { stableStringify } from "../closed-ai-cache";
import type { ContentAddressedRecord, VerifiableLedgerBlock } from "./types";

export type ContentAddressReadScope = {
  ledgerId: string;
  projectId: string;
  namespaceDigest: string;
};

export interface VerifiableLedgerRepository {
  readonly kind: "memory" | "indexeddb";
  append(block: VerifiableLedgerBlock): Promise<void>;
  list(ledgerId: string): Promise<VerifiableLedgerBlock[]>;
  putContent(record: ContentAddressedRecord): Promise<void>;
  getContent(
    contentRecordId: string,
    scope: ContentAddressReadScope,
  ): Promise<ContentAddressedRecord | null>;
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
    if (!record.namespaceDigest) {
      throw Object.assign(new Error("Scoped content namespace is required."), {
        code: "CONTENT_ADDRESS_SCOPE_REQUIRED",
      });
    }
    const previous = this.contents.get(record.id);
    if (
      previous
      && stableStringify(previous.content) !== stableStringify(record.content)
    ) {
      throw Object.assign(new Error("Content address collision."), {
        code: "CONTENT_ADDRESS_COLLISION",
      });
    }
    this.contents.set(record.id, structuredClone(record));
  }

  async getContent(contentRecordId: string, scope: ContentAddressReadScope) {
    const record = this.contents.get(contentRecordId);
    if (
      !record
      || record.ledgerId !== scope.ledgerId
      || record.projectId !== scope.projectId
      || (record.namespaceDigest !== undefined
        && record.namespaceDigest !== scope.namespaceDigest)
    ) {
      return null;
    }
    return structuredClone(record);
  }
}

const DB_NAME = "novel-verifiable-ledger";
const DB_VERSION = 2;
const BLOCK_STORE = "blocks";
const LEGACY_CONTENT_STORE = "contents";
const CONTENT_STORE = "contents_v2";

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
          if (!database.objectStoreNames.contains(LEGACY_CONTENT_STORE)) {
            database.createObjectStore(LEGACY_CONTENT_STORE, { keyPath: "contentAddress" });
          }
          if (!database.objectStoreNames.contains(CONTENT_STORE)) {
            database.createObjectStore(CONTENT_STORE, { keyPath: "id" });
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
    if (!record.namespaceDigest) {
      throw Object.assign(new Error("Scoped content namespace is required."), {
        code: "CONTENT_ADDRESS_SCOPE_REQUIRED",
      });
    }
    const previous = await this.getContent(record.id, {
      ledgerId: record.ledgerId,
      projectId: record.projectId,
      namespaceDigest: record.namespaceDigest,
    });
    if (
      previous
      && stableStringify(previous.content) !== stableStringify(record.content)
    ) {
      throw Object.assign(new Error("Content address collision."), {
        code: "CONTENT_ADDRESS_COLLISION",
      });
    }
    const transaction = database.transaction(CONTENT_STORE, "readwrite");
    transaction.objectStore(CONTENT_STORE).put(record);
    await complete(transaction);
  }

  async getContent(contentRecordId: string, scope: ContentAddressReadScope) {
    const database = await this.open();
    const current = await request(
      database.transaction(CONTENT_STORE).objectStore(CONTENT_STORE).get(contentRecordId),
    ) as ContentAddressedRecord | undefined;
    if (current) {
      return current.ledgerId === scope.ledgerId
        && current.projectId === scope.projectId
        && current.namespaceDigest === scope.namespaceDigest
        ? current
        : null;
    }
    if (!contentRecordId.startsWith("sha256:")) return null;
    const legacy = await request(
      database
        .transaction(LEGACY_CONTENT_STORE)
        .objectStore(LEGACY_CONTENT_STORE)
        .get(contentRecordId),
    ) as ContentAddressedRecord | undefined;
    return legacy?.ledgerId === scope.ledgerId && legacy.projectId === scope.projectId
      ? legacy
      : null;
  }
}

export function createVerifiableLedgerRepository(): VerifiableLedgerRepository {
  return typeof indexedDB === "undefined"
    ? new MemoryVerifiableLedgerRepository()
    : new IndexedDbVerifiableLedgerRepository();
}

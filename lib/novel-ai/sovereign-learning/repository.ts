import type {
  LearnedNarrativeRule,
  LearningAuditRecord,
  LearningFeedbackRecord,
  LearningPreferenceProfile,
  LearningSourceRecord,
} from "./types";

export const SOVEREIGN_LEARNING_DB_NAME = "novel-sovereign-learning";
export const SOVEREIGN_LEARNING_DB_VERSION = 1;

const STORE_NAMES = ["sources", "rules", "feedback", "profiles", "audit"] as const;
type LearningStoreName = (typeof STORE_NAMES)[number];

type StoreRecordMap = {
  sources: LearningSourceRecord;
  rules: LearnedNarrativeRule;
  feedback: LearningFeedbackRecord;
  profiles: LearningPreferenceProfile;
  audit: LearningAuditRecord;
};

export type LearningRepositoryCommit = {
  sources?: LearningSourceRecord[];
  rules?: LearnedNarrativeRule[];
  feedback?: LearningFeedbackRecord[];
  profiles?: LearningPreferenceProfile[];
  audit?: LearningAuditRecord[];
  remove?: Partial<Record<LearningStoreName, string[]>>;
};

export interface SovereignLearningRepository {
  readonly kind: "indexeddb" | "memory";
  isAvailable(): boolean;
  getSource(sourceId: string): Promise<LearningSourceRecord | null>;
  getRule(ruleId: string): Promise<LearnedNarrativeRule | null>;
  getProfile(projectId: string): Promise<LearningPreferenceProfile | null>;
  listSources(projectId: string): Promise<LearningSourceRecord[]>;
  listRules(projectId: string): Promise<LearnedNarrativeRule[]>;
  listFeedback(projectId: string): Promise<LearningFeedbackRecord[]>;
  listAudit(projectId: string): Promise<LearningAuditRecord[]>;
  commit(input: LearningRepositoryCommit): Promise<void>;
  clearProject(projectId: string): Promise<void>;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("LEARNING_INDEXEDDB_REQUEST_FAILED"));
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(
      transaction.error ?? new Error("LEARNING_INDEXEDDB_TRANSACTION_ABORTED"),
    );
    transaction.onerror = () => reject(
      transaction.error ?? new Error("LEARNING_INDEXEDDB_TRANSACTION_FAILED"),
    );
  });
}

export class IndexedDbSovereignLearningRepository implements SovereignLearningRepository {
  readonly kind = "indexeddb" as const;
  private databasePromise: Promise<IDBDatabase> | null = null;

  isAvailable() {
    return typeof indexedDB !== "undefined";
  }

  private open() {
    if (!this.isAvailable()) {
      return Promise.reject(new Error("LEARNING_INDEXEDDB_UNAVAILABLE"));
    }
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const open = indexedDB.open(SOVEREIGN_LEARNING_DB_NAME, SOVEREIGN_LEARNING_DB_VERSION);
        open.onupgradeneeded = () => {
          const database = open.result;
          for (const name of STORE_NAMES) {
            const store = database.objectStoreNames.contains(name)
              ? open.transaction!.objectStore(name)
              : database.createObjectStore(name, { keyPath: "id" });
            if (!store.indexNames.contains("projectId")) {
              store.createIndex("projectId", "projectId", { unique: false });
            }
            if (name === "rules" && !store.indexNames.contains("sourceId")) {
              store.createIndex("sourceId", "sourceId", { unique: false });
            }
            if (name === "sources" && !store.indexNames.contains("contentHash")) {
              store.createIndex("contentHash", "contentHash", { unique: false });
            }
          }
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error ?? new Error("LEARNING_INDEXEDDB_OPEN_FAILED"));
        open.onblocked = () => reject(new Error("LEARNING_INDEXEDDB_UPGRADE_BLOCKED"));
      });
    }
    return this.databasePromise;
  }

  private async get<K extends LearningStoreName>(
    store: K,
    id: string,
  ): Promise<StoreRecordMap[K] | null> {
    const database = await this.open();
    const row = await request(
      database.transaction(store).objectStore(store).get(id),
    ) as StoreRecordMap[K] | undefined;
    return row ?? null;
  }

  private async list<K extends LearningStoreName>(
    store: K,
    projectId: string,
  ): Promise<StoreRecordMap[K][]> {
    const database = await this.open();
    const rows = await request(
      database.transaction(store).objectStore(store).index("projectId").getAll(projectId),
    ) as StoreRecordMap[K][];
    return rows.map((row) => structuredClone(row));
  }

  getSource(sourceId: string) {
    return this.get("sources", sourceId);
  }

  getRule(ruleId: string) {
    return this.get("rules", ruleId);
  }

  getProfile(projectId: string) {
    return this.get("profiles", `learning-profile:${projectId}`);
  }

  listSources(projectId: string) {
    return this.list("sources", projectId);
  }

  listRules(projectId: string) {
    return this.list("rules", projectId);
  }

  listFeedback(projectId: string) {
    return this.list("feedback", projectId);
  }

  listAudit(projectId: string) {
    return this.list("audit", projectId);
  }

  async commit(input: LearningRepositoryCommit) {
    const touched = STORE_NAMES.filter((name) =>
      (input[name]?.length ?? 0) > 0 || (input.remove?.[name]?.length ?? 0) > 0);
    if (!touched.length) return;
    const database = await this.open();
    const transaction = database.transaction(touched, "readwrite");
    try {
      for (const name of touched) {
        const store = transaction.objectStore(name);
        for (const row of input[name] ?? []) store.put(structuredClone(row));
        for (const id of input.remove?.[name] ?? []) store.delete(id);
      }
      await complete(transaction);
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // Transaction already completed or aborted.
      }
      throw error;
    }
  }

  async clearProject(projectId: string) {
    const rows = await Promise.all(STORE_NAMES.map((name) => this.list(name, projectId)));
    await this.commit({
      remove: Object.fromEntries(
        STORE_NAMES.map((name, index) => [
          name,
          rows[index].map((row) => row.id),
        ]),
      ) as Record<LearningStoreName, string[]>,
    });
  }
}

export class MemorySovereignLearningRepository implements SovereignLearningRepository {
  readonly kind = "memory" as const;
  private stores: {
    [K in LearningStoreName]: Map<string, StoreRecordMap[K]>;
  } = {
    sources: new Map(),
    rules: new Map(),
    feedback: new Map(),
    profiles: new Map(),
    audit: new Map(),
  };

  isAvailable() {
    return true;
  }

  private get<K extends LearningStoreName>(store: K, id: string) {
    const row = this.stores[store].get(id);
    return Promise.resolve(row ? structuredClone(row) : null);
  }

  private list<K extends LearningStoreName>(store: K, projectId: string) {
    return Promise.resolve(
      [...this.stores[store].values()]
        .filter((row) => row.projectId === projectId)
        .map((row) => structuredClone(row)),
    );
  }

  getSource(sourceId: string) {
    return this.get("sources", sourceId);
  }

  getRule(ruleId: string) {
    return this.get("rules", ruleId);
  }

  getProfile(projectId: string) {
    return this.get("profiles", `learning-profile:${projectId}`);
  }

  listSources(projectId: string) {
    return this.list("sources", projectId);
  }

  listRules(projectId: string) {
    return this.list("rules", projectId);
  }

  listFeedback(projectId: string) {
    return this.list("feedback", projectId);
  }

  listAudit(projectId: string) {
    return this.list("audit", projectId);
  }

  async commit(input: LearningRepositoryCommit) {
    const before = {
      sources: new Map([...this.stores.sources.entries()].map(([id, row]) => [id, structuredClone(row)])),
      rules: new Map([...this.stores.rules.entries()].map(([id, row]) => [id, structuredClone(row)])),
      feedback: new Map([...this.stores.feedback.entries()].map(([id, row]) => [id, structuredClone(row)])),
      profiles: new Map([...this.stores.profiles.entries()].map(([id, row]) => [id, structuredClone(row)])),
      audit: new Map([...this.stores.audit.entries()].map(([id, row]) => [id, structuredClone(row)])),
    };
    try {
      for (const name of STORE_NAMES) {
        for (const row of input[name] ?? []) {
          (this.stores[name] as Map<string, typeof row>).set(row.id, structuredClone(row));
        }
        for (const id of input.remove?.[name] ?? []) this.stores[name].delete(id);
      }
    } catch (error) {
      this.stores = before;
      throw error;
    }
  }

  async clearProject(projectId: string) {
    for (const name of STORE_NAMES) {
      for (const [id, row] of this.stores[name]) {
        if (row.projectId === projectId) this.stores[name].delete(id);
      }
    }
  }
}

export function createSovereignLearningRepository(): SovereignLearningRepository {
  return typeof indexedDB === "undefined"
    ? new MemorySovereignLearningRepository()
    : new IndexedDbSovereignLearningRepository();
}

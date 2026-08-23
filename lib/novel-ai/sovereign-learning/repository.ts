import type {
  LearnedNarrativeRule,
  LearningAuditRecord,
  LearningFeedbackRecord,
  LearningPreferenceProfile,
  LearningSourceRecord,
} from "./types";

export const SOVEREIGN_LEARNING_DB_NAME = "novel-sovereign-learning";
export const SOVEREIGN_LEARNING_DB_VERSION = 3;

const STORE_NAMES = ["sources", "rules", "feedback", "profiles", "audit", "staging"] as const;
type LearningStoreName = (typeof STORE_NAMES)[number];

export type LearningImportStagingRecord = {
  id: string;
  projectId: string;
  manifestDigest: string;
  completedPartIndexes: number[];
  sources: LearningSourceRecord[];
  rules: LearnedNarrativeRule[];
  audit: LearningAuditRecord[];
  chunkManifest: Array<{
    attachmentId: string;
    chunkIndex: number;
    sourceSection: string;
    contentHash: string;
    previousOverlapDigest: string | null;
    nextOverlapDigest: string | null;
    volumeCount: number;
    chapterCount: number;
    paragraphCount: number;
    dialogueParagraphCount: number;
    characterCount: number;
  }>;
  globalSynthesis: {
    uniqueChunkCount: number;
    duplicateChunkCount: number;
    candidateRuleIds: string[];
    rejectedSourceOverlapRuleIds: string[];
    conflictKeys: string[];
    narrativeDna: {
      volumeCount: number;
      chapterCount: number;
      paragraphCount: number;
      dialogueParagraphRatio: number;
      averageParagraphCharacters: number;
    };
  } | null;
  formalCommit?: {
    sourceIds: string[];
    ruleIds: string[];
    auditIds: string[];
  } | null;
  rawContentRetained: false;
  createdAt: string;
  updatedAt: string;
  revision: number;
};

type StoreRecordMap = {
  sources: LearningSourceRecord;
  rules: LearnedNarrativeRule;
  feedback: LearningFeedbackRecord;
  profiles: LearningPreferenceProfile;
  audit: LearningAuditRecord;
  staging: LearningImportStagingRecord;
};

export type LearningRepositoryCommit = {
  sources?: LearningSourceRecord[];
  rules?: LearnedNarrativeRule[];
  feedback?: LearningFeedbackRecord[];
  profiles?: LearningPreferenceProfile[];
  audit?: LearningAuditRecord[];
  staging?: LearningImportStagingRecord[];
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
  listRulesBySource(sourceId: string): Promise<LearnedNarrativeRule[]>;
  queryApprovedRules(
    projectId: string,
    families: LearnedNarrativeRule["family"][],
    limitPerFamily: number,
  ): Promise<LearnedNarrativeRule[]>;
  queryApprovedRulesByDimension(
    projectId: string,
    families: LearnedNarrativeRule["family"][],
    limitPerDimension: number,
  ): Promise<LearnedNarrativeRule[]>;
  queryRuleSimilarityCandidates(
    projectId: string,
    family: LearnedNarrativeRule["family"],
    dimension: LearnedNarrativeRule["dimension"],
    statuses: LearnedNarrativeRule["status"][],
    limitPerStatus: number,
  ): Promise<LearnedNarrativeRule[]>;
  listFeedback(projectId: string): Promise<LearningFeedbackRecord[]>;
  listAudit(projectId: string): Promise<LearningAuditRecord[]>;
  getImportStaging(importSessionId: string): Promise<LearningImportStagingRecord | null>;
  listImportStaging(projectId: string): Promise<LearningImportStagingRecord[]>;
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

function collectCursor<T>(value: IDBRequest<IDBCursorWithValue | null>, limit: number): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const rows: T[] = [];
    value.onsuccess = () => {
      const cursor = value.result;
      if (!cursor || rows.length >= limit) {
        resolve(rows);
        return;
      }
      rows.push(structuredClone(cursor.value as T));
      cursor.continue();
    };
    value.onerror = () => reject(value.error ?? new Error("LEARNING_INDEXEDDB_CURSOR_FAILED"));
  });
}

function boundedQueryLimit(value: number, maximum = 32) {
  return Number.isFinite(value)
    ? Math.max(1, Math.min(maximum, Math.floor(value)))
    : 1;
}

const RULE_STATUSES = new Set<LearnedNarrativeRule["status"]>([
  "candidate",
  "approved",
  "rejected",
  "quarantined",
  "revoked",
]);
const RULE_DIMENSIONS: LearnedNarrativeRule["dimension"][] = [
  "viewpoint", "sentence_rhythm", "paragraph_rhythm", "dialogue_density",
  "opening_hook", "conflict_escalation", "reveal_cadence", "scene_transition",
  "ending_hook", "character_pressure", "relationship_movement", "world_rule_delivery",
  "foreshadow_payoff", "information_control", "tone", "other",
];

function normalizedRuleStatuses(statuses: LearnedNarrativeRule["status"][]) {
  return [...new Set(statuses)].filter((status) => RULE_STATUSES.has(status));
}

function ruleSimilarityScopeKey(rule: Pick<
  LearnedNarrativeRule,
  "projectId" | "family" | "dimension" | "status"
>) {
  return JSON.stringify([rule.projectId, rule.family, rule.dimension, rule.status]);
}

function compareRuleRank(left: LearnedNarrativeRule, right: LearnedNarrativeRule) {
  const leftConfidence = Number.isFinite(left.confidence) ? left.confidence : 0;
  const rightConfidence = Number.isFinite(right.confidence) ? right.confidence : 0;
  const leftAbstraction = Number.isFinite(left.abstractionScore) ? left.abstractionScore : 0;
  const rightAbstraction = Number.isFinite(right.abstractionScore) ? right.abstractionScore : 0;
  return rightConfidence - leftConfidence
    || rightAbstraction - leftAbstraction
    || left.id.localeCompare(right.id);
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
      let blocked = false;
      const attempt = new Promise<IDBDatabase>((resolve, reject) => {
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
            if (name === "rules" && !store.indexNames.contains("projectStatusFamilyConfidence")) {
              store.createIndex(
                "projectStatusFamilyConfidence",
                ["projectId", "status", "family", "confidence"],
                { unique: false },
              );
            }
            if (name === "rules" && !store.indexNames.contains("projectFamilyDimensionStatusConfidence")) {
              store.createIndex(
                "projectFamilyDimensionStatusConfidence",
                ["projectId", "family", "dimension", "status", "confidence"],
                { unique: false },
              );
            }
            if (name === "sources" && !store.indexNames.contains("contentHash")) {
              store.createIndex("contentHash", "contentHash", { unique: false });
            }
          }
        };
        open.onsuccess = () => {
          const database = open.result;
          if (blocked) {
            database.close();
            return;
          }
          database.onversionchange = () => {
            database.close();
            this.databasePromise = null;
          };
          resolve(database);
        };
        open.onerror = () => reject(open.error ?? new Error("LEARNING_INDEXEDDB_OPEN_FAILED"));
        open.onblocked = () => {
          blocked = true;
          reject(new Error("LEARNING_INDEXEDDB_UPGRADE_BLOCKED"));
        };
      });
      const guarded = attempt.catch((error) => {
        if (this.databasePromise === guarded) this.databasePromise = null;
        throw error;
      });
      this.databasePromise = guarded;
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

  async listRulesBySource(sourceId: string) {
    const database = await this.open();
    const rows = await request(
      database.transaction("rules").objectStore("rules").index("sourceId").getAll(sourceId),
    ) as LearnedNarrativeRule[];
    return rows.map((row) => structuredClone(row));
  }

  async queryApprovedRules(
    projectId: string,
    families: LearnedNarrativeRule["family"][],
    limitPerFamily: number,
  ) {
    const database = await this.open();
    const transaction = database.transaction("rules");
    const index = transaction.objectStore("rules").index("projectStatusFamilyConfidence");
    const boundedLimit = boundedQueryLimit(limitPerFamily);
    const rows = await Promise.all([...new Set(families)].map((family) => collectCursor<LearnedNarrativeRule>(
      index.openCursor(
        IDBKeyRange.bound(
          [projectId, "approved", family, 0],
          [projectId, "approved", family, 1],
        ),
        "prev",
      ),
      boundedLimit,
    )));
    return rows.flat();
  }

  async queryApprovedRulesByDimension(
    projectId: string,
    families: LearnedNarrativeRule["family"][],
    limitPerDimension: number,
  ) {
    const database = await this.open();
    const transaction = database.transaction("rules");
    const index = transaction.objectStore("rules").index("projectFamilyDimensionStatusConfidence");
    const boundedLimit = boundedQueryLimit(limitPerDimension, 4);
    const scopes = [...new Set(families)].flatMap((family) =>
      RULE_DIMENSIONS.map((dimension) => ({ family, dimension })));
    const rows = await Promise.all(scopes.map(({ family, dimension }) => collectCursor<LearnedNarrativeRule>(
      index.openCursor(
        IDBKeyRange.bound(
          [projectId, family, dimension, "approved", 0],
          [projectId, family, dimension, "approved", 1],
        ),
        "prev",
      ),
      boundedLimit,
    )));
    return rows.flat();
  }

  async queryRuleSimilarityCandidates(
    projectId: string,
    family: LearnedNarrativeRule["family"],
    dimension: LearnedNarrativeRule["dimension"],
    statuses: LearnedNarrativeRule["status"][],
    limitPerStatus: number,
  ) {
    const selectedStatuses = normalizedRuleStatuses(statuses);
    if (!selectedStatuses.length) return [];
    const database = await this.open();
    const transaction = database.transaction("rules");
    const index = transaction.objectStore("rules").index("projectFamilyDimensionStatusConfidence");
    const boundedLimit = boundedQueryLimit(limitPerStatus);
    const rows = await Promise.all(selectedStatuses.map((status) => collectCursor<LearnedNarrativeRule>(
      index.openCursor(
        IDBKeyRange.bound(
          [projectId, family, dimension, status, 0],
          [projectId, family, dimension, status, 1],
        ),
        "prev",
      ),
      boundedLimit,
    )));
    return rows.flat();
  }

  listFeedback(projectId: string) {
    return this.list("feedback", projectId);
  }

  listAudit(projectId: string) {
    return this.list("audit", projectId);
  }

  getImportStaging(importSessionId: string) {
    return this.get("staging", importSessionId);
  }

  listImportStaging(projectId: string) {
    return this.list("staging", projectId);
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
    staging: new Map(),
  };
  private readonly ruleSimilarityIndex = new Map<string, Map<string, LearnedNarrativeRule>>();

  private indexRule(rule: LearnedNarrativeRule) {
    const key = ruleSimilarityScopeKey(rule);
    const bucket = this.ruleSimilarityIndex.get(key) ?? new Map<string, LearnedNarrativeRule>();
    bucket.set(rule.id, rule);
    this.ruleSimilarityIndex.set(key, bucket);
  }

  private unindexRule(rule: LearnedNarrativeRule | undefined) {
    if (!rule) return;
    const key = ruleSimilarityScopeKey(rule);
    const bucket = this.ruleSimilarityIndex.get(key);
    bucket?.delete(rule.id);
    if (bucket?.size === 0) this.ruleSimilarityIndex.delete(key);
  }

  private rebuildRuleSimilarityIndex() {
    this.ruleSimilarityIndex.clear();
    for (const rule of this.stores.rules.values()) this.indexRule(rule);
  }

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

  listRulesBySource(sourceId: string) {
    return Promise.resolve([...this.stores.rules.values()]
      .filter((rule) => rule.sourceId === sourceId)
      .map((rule) => structuredClone(rule)));
  }

  async queryApprovedRules(
    projectId: string,
    families: LearnedNarrativeRule["family"][],
    limitPerFamily: number,
  ) {
    const familySet = new Set(families);
    const boundedLimit = boundedQueryLimit(limitPerFamily);
    const counts = new Map<LearnedNarrativeRule["family"], number>();
    return [...this.stores.rules.values()]
      .filter((rule) => rule.projectId === projectId && rule.status === "approved" && familySet.has(rule.family))
      .sort((left, right) => right.confidence - left.confidence || right.abstractionScore - left.abstractionScore || left.id.localeCompare(right.id))
      .filter((rule) => {
        const count = counts.get(rule.family) ?? 0;
        if (count >= boundedLimit) return false;
        counts.set(rule.family, count + 1);
        return true;
      })
      .map((rule) => structuredClone(rule));
  }

  async queryApprovedRulesByDimension(
    projectId: string,
    families: LearnedNarrativeRule["family"][],
    limitPerDimension: number,
  ) {
    const boundedLimit = boundedQueryLimit(limitPerDimension, 4);
    return [...new Set(families)].flatMap((family) => RULE_DIMENSIONS.flatMap((dimension) => {
      const bucket = this.ruleSimilarityIndex.get(ruleSimilarityScopeKey({
        projectId,
        family,
        dimension,
        status: "approved",
      }));
      if (!bucket) return [];
      return [...bucket.values()]
        .sort(compareRuleRank)
        .slice(0, boundedLimit)
        .map((rule) => structuredClone(rule));
    }));
  }

  async queryRuleSimilarityCandidates(
    projectId: string,
    family: LearnedNarrativeRule["family"],
    dimension: LearnedNarrativeRule["dimension"],
    statuses: LearnedNarrativeRule["status"][],
    limitPerStatus: number,
  ) {
    const boundedLimit = boundedQueryLimit(limitPerStatus);
    return normalizedRuleStatuses(statuses).flatMap((status) => {
      const bucket = this.ruleSimilarityIndex.get(ruleSimilarityScopeKey({
        projectId,
        family,
        dimension,
        status,
      }));
      if (!bucket) return [];
      return [...bucket.values()]
        .sort(compareRuleRank)
        .slice(0, boundedLimit)
        .map((rule) => structuredClone(rule));
    });
  }

  listFeedback(projectId: string) {
    return this.list("feedback", projectId);
  }

  listAudit(projectId: string) {
    return this.list("audit", projectId);
  }

  getImportStaging(importSessionId: string) {
    return this.get("staging", importSessionId);
  }

  listImportStaging(projectId: string) {
    return this.list("staging", projectId);
  }

  async commit(input: LearningRepositoryCommit) {
    const before = {
      sources: new Map([...this.stores.sources.entries()].map(([id, row]) => [id, structuredClone(row)])),
      rules: new Map([...this.stores.rules.entries()].map(([id, row]) => [id, structuredClone(row)])),
      feedback: new Map([...this.stores.feedback.entries()].map(([id, row]) => [id, structuredClone(row)])),
      profiles: new Map([...this.stores.profiles.entries()].map(([id, row]) => [id, structuredClone(row)])),
      audit: new Map([...this.stores.audit.entries()].map(([id, row]) => [id, structuredClone(row)])),
      staging: new Map([...this.stores.staging.entries()].map(([id, row]) => [id, structuredClone(row)])),
    };
    try {
      for (const row of input.rules ?? []) {
        this.unindexRule(this.stores.rules.get(row.id));
        const stored = structuredClone(row);
        this.stores.rules.set(row.id, stored);
        this.indexRule(stored);
      }
      for (const id of input.remove?.rules ?? []) {
        this.unindexRule(this.stores.rules.get(id));
        this.stores.rules.delete(id);
      }
      for (const name of STORE_NAMES) {
        if (name === "rules") continue;
        for (const row of input[name] ?? []) {
          (this.stores[name] as Map<string, typeof row>).set(row.id, structuredClone(row));
        }
        for (const id of input.remove?.[name] ?? []) this.stores[name].delete(id);
      }
    } catch (error) {
      this.stores = before;
      this.rebuildRuleSimilarityIndex();
      throw error;
    }
  }

  async clearProject(projectId: string) {
    for (const [id, rule] of this.stores.rules) {
      if (rule.projectId !== projectId) continue;
      this.unindexRule(rule);
      this.stores.rules.delete(id);
    }
    for (const name of STORE_NAMES) {
      if (name === "rules") continue;
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

import path from "node:path";
import { mkdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import {
  RUNTIME_CACHE_LAYERS,
  assertTargetedInvalidation,
  cacheIdentity,
  createRuntimeCacheEntry,
  emptyLayerCounts,
  isReusableRuntimeCacheEntry,
  runtimeEntryMatchesInvalidation,
  sameRuntimeCacheNamespace,
} from "./cache-contract.mjs";

const DEFAULT_TTL_MS = 30 * 60 * 1_000;

export class LocalSQLiteCacheStore {
  constructor({
    filePath,
    maximumEntries = 2_000,
    maximumBytes = 256 * 1024 * 1024,
    defaultTtlMs = DEFAULT_TTL_MS,
    now = () => new Date(),
  }) {
    if (!path.isAbsolute(filePath)) {
      throw Object.assign(new Error("Local cache SQLite path must be absolute."), {
        code: "CLOSED_AI_CACHE_PATH_INVALID",
      });
    }
    this.filePath = path.resolve(filePath);
    this.maximumEntries = maximumEntries;
    this.maximumBytes = maximumBytes;
    this.defaultTtlMs = defaultTtlMs;
    this.now = now;
    this.database = null;
    this.counters = {
      hits: 0,
      misses: 0,
      evictions: 0,
      invalidations: 0,
      corruptions: 0,
    };
  }

  async initialize() {
    if (this.database) return this;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const database = new DatabaseSync(this.filePath);
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = NORMAL");
    database.exec(`
      CREATE TABLE IF NOT EXISTS closed_ai_cache_entries (
        id TEXT PRIMARY KEY,
        layer TEXT NOT NULL,
        namespace_json TEXT NOT NULL,
        namespace_digest TEXT NOT NULL,
        input_digest TEXT NOT NULL,
        value_digest TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        hit_count INTEGER NOT NULL,
        byte_size INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_closed_ai_cache_expiry
        ON closed_ai_cache_entries(expires_at);
      CREATE INDEX IF NOT EXISTS idx_closed_ai_cache_namespace_layer
        ON closed_ai_cache_entries(namespace_digest, layer);
    `);
    this.database = database;
    return this;
  }

  db() {
    if (!this.database) {
      throw Object.assign(new Error("Local SQLite cache is not initialized."), {
        code: "CLOSED_AI_CACHE_NOT_INITIALIZED",
      });
    }
    return this.database;
  }

  decodeRow(row) {
    if (!row) return null;
    try {
      return JSON.parse(String(row.payload_json));
    } catch {
      this.counters.corruptions += 1;
      if (row.id) {
        this.db().prepare(
          "DELETE FROM closed_ai_cache_entries WHERE id = ?",
        ).run(String(row.id));
        this.counters.evictions += 1;
      }
      return null;
    }
  }

  async get(layer, namespace, input) {
    await this.initialize();
    const identity = cacheIdentity(layer, namespace, input);
    const row = this.db().prepare(
      "SELECT id, payload_json FROM closed_ai_cache_entries WHERE id = ?",
    ).get(identity.id);
    const entry = this.decodeRow(row);
    if (!entry || !sameRuntimeCacheNamespace(entry.namespace, namespace)) {
      this.counters.misses += 1;
      return { hit: false, entry: null };
    }
    if (!isReusableRuntimeCacheEntry(entry, namespace, this.now())) {
      this.db().prepare("DELETE FROM closed_ai_cache_entries WHERE id = ?").run(identity.id);
      this.counters.misses += 1;
      this.counters.evictions += 1;
      return { hit: false, entry: null };
    }
    entry.hitCount += 1;
    entry.lastAccessedAt = this.now().toISOString();
    this.writeEntry(entry);
    this.counters.hits += 1;
    return { hit: true, entry: structuredClone(entry) };
  }

  async put({
    layer,
    namespace,
    input,
    value,
    ttlMs = this.defaultTtlMs,
    tags = [],
  }) {
    await this.initialize();
    const entry = createRuntimeCacheEntry({
      layer,
      namespace,
      input,
      value,
      ttlMs,
      tags,
      now: this.now(),
    });
    this.writeEntry(entry);
    await this.enforceLimits();
    return structuredClone(entry);
  }

  writeEntry(entry) {
    const payload = JSON.stringify(entry);
    this.db().prepare(`
      INSERT INTO closed_ai_cache_entries (
        id, layer, namespace_json, namespace_digest, input_digest, value_digest,
        payload_json, tags_json, created_at, last_accessed_at, expires_at,
        hit_count, byte_size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        layer = excluded.layer,
        namespace_json = excluded.namespace_json,
        namespace_digest = excluded.namespace_digest,
        input_digest = excluded.input_digest,
        value_digest = excluded.value_digest,
        payload_json = excluded.payload_json,
        tags_json = excluded.tags_json,
        created_at = excluded.created_at,
        last_accessed_at = excluded.last_accessed_at,
        expires_at = excluded.expires_at,
        hit_count = excluded.hit_count,
        byte_size = excluded.byte_size
    `).run(
      entry.id,
      entry.layer,
      JSON.stringify(entry.namespace),
      entry.namespaceDigest,
      entry.inputDigest,
      entry.valueDigest,
      payload,
      JSON.stringify(entry.tags),
      entry.createdAt,
      entry.lastAccessedAt,
      entry.expiresAt,
      entry.hitCount,
      entry.byteSize,
    );
  }

  async list() {
    await this.initialize();
    return this.db().prepare(
      "SELECT id, payload_json FROM closed_ai_cache_entries ORDER BY last_accessed_at ASC",
    ).all().map((row) => this.decodeRow(row)).filter(Boolean);
  }

  async invalidate(invalidation) {
    await this.initialize();
    assertTargetedInvalidation(invalidation);
    const targets = (await this.list()).filter((entry) =>
      runtimeEntryMatchesInvalidation(entry, invalidation));
    const remove = this.db().prepare(
      "DELETE FROM closed_ai_cache_entries WHERE id = ?",
    );
    this.db().exec("BEGIN IMMEDIATE");
    try {
      for (const entry of targets) remove.run(entry.id);
      this.db().exec("COMMIT");
    } catch (error) {
      this.db().exec("ROLLBACK");
      throw error;
    }
    this.counters.invalidations += targets.length;
    return targets.length;
  }

  async purgeExpired() {
    await this.initialize();
    const result = this.db().prepare(
      "DELETE FROM closed_ai_cache_entries WHERE expires_at <= ?",
    ).run(this.now().toISOString());
    const count = Number(result.changes ?? 0);
    this.counters.evictions += count;
    return count;
  }

  async enforceLimits() {
    await this.purgeExpired();
    const rows = this.db().prepare(`
      SELECT id, byte_size
      FROM closed_ai_cache_entries
      ORDER BY last_accessed_at ASC
    `).all();
    let totalEntries = rows.length;
    let totalBytes = rows.reduce((sum, row) => sum + Number(row.byte_size), 0);
    const remove = this.db().prepare(
      "DELETE FROM closed_ai_cache_entries WHERE id = ?",
    );
    for (const row of rows) {
      if (
        totalEntries <= this.maximumEntries
        && totalBytes <= this.maximumBytes
      ) break;
      remove.run(String(row.id));
      totalEntries -= 1;
      totalBytes -= Number(row.byte_size);
      this.counters.evictions += 1;
    }
  }

  async stats() {
    await this.initialize();
    await this.purgeExpired();
    const rows = this.db().prepare(
      "SELECT layer, byte_size FROM closed_ai_cache_entries",
    ).all();
    const layerEntries = emptyLayerCounts();
    for (const row of rows) {
      if (RUNTIME_CACHE_LAYERS.includes(row.layer)) layerEntries[row.layer] += 1;
    }
    return {
      schemaVersion: "closed-ai-cache-v2",
      status: "ready",
      backend: "local-ollama",
      persistence: "sqlite",
      encryptedAtRest: false,
      entries: rows.length,
      bytes: rows.reduce((sum, row) => sum + Number(row.byte_size), 0),
      ...this.counters,
      layerEntries,
      candidateOnly: true,
      memoryMutationCount: 0,
      learningMutationCount: 0,
      canonicalMutationCount: 0,
      rawPromptStored: false,
      embeddingCacheLayer: "retrieval",
      modelSessionState: "runtime_handle_metadata_only",
      modelKvRuntimeStatus: "ollama_runtime_managed",
    };
  }

  async close() {
    this.database?.close();
    this.database = null;
  }
}

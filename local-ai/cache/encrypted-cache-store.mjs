import crypto from "node:crypto";
import path from "node:path";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  RUNTIME_CACHE_LAYERS,
  assertTargetedInvalidation,
  cacheIdentity,
  createRuntimeCacheEntry,
  emptyLayerCounts,
  isReusableRuntimeCacheEntry,
  runtimeEntryMatchesInvalidation,
  sameRuntimeCacheNamespace,
  sha256,
} from "./cache-contract.mjs";

const AAD = Buffer.from("novel-private-hub-cache-v1", "utf8");
const DEFAULT_TTL_MS = 30 * 60 * 1_000;

export class EncryptedPrivateHubCacheStore {
  constructor({
    directory,
    keyPath = path.join(path.dirname(directory), "cache.key"),
    maximumEntries = 4_000,
    maximumBytes = 512 * 1024 * 1024,
    defaultTtlMs = DEFAULT_TTL_MS,
    now = () => new Date(),
  }) {
    if (!path.isAbsolute(directory) || !path.isAbsolute(keyPath)) {
      throw Object.assign(new Error("Private Hub cache paths must be absolute."), {
        code: "CLOSED_AI_CACHE_PATH_INVALID",
      });
    }
    this.directory = path.resolve(directory);
    this.keyPath = path.resolve(keyPath);
    this.maximumEntries = maximumEntries;
    this.maximumBytes = maximumBytes;
    this.defaultTtlMs = defaultTtlMs;
    this.now = now;
    this.key = null;
    this.counters = {
      hits: 0,
      misses: 0,
      evictions: 0,
      invalidations: 0,
      corruptions: 0,
    };
  }

  async initialize() {
    if (this.key) return this;
    await mkdir(this.directory, { recursive: true });
    let key;
    try {
      key = await readFile(this.keyPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const generated = crypto.randomBytes(32);
      try {
        await writeFile(this.keyPath, generated, { flag: "wx", mode: 0o600 });
        key = generated;
      } catch (writeError) {
        if (writeError?.code !== "EEXIST") throw writeError;
        key = await readFile(this.keyPath);
      }
    }
    if (key.length !== 32) {
      throw Object.assign(new Error("Private Hub cache encryption key is invalid."), {
        code: "CLOSED_AI_CACHE_KEY_INVALID",
      });
    }
    await chmod(this.keyPath, 0o600).catch(() => undefined);
    this.key = key;
    return this;
  }

  filePath(id) {
    return path.join(this.directory, `${sha256(id)}.cache`);
  }

  encrypt(entry) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(entry), "utf8"),
      cipher.final(),
    ]);
    return JSON.stringify({
      version: 1,
      algorithm: "A256GCM",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    });
  }

  decrypt(envelopeText) {
    const envelope = JSON.parse(envelopeText);
    if (envelope.version !== 1 || envelope.algorithm !== "A256GCM") {
      throw new Error("Unsupported encrypted cache envelope.");
    }
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(envelope.iv, "base64"),
    );
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8"));
  }

  async readEntry(filePath) {
    try {
      return this.decrypt(await readFile(filePath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") {
        this.counters.corruptions += 1;
        this.counters.evictions += 1;
        await rm(filePath, { force: true });
      }
      return null;
    }
  }

  async writeEntry(entry) {
    const target = this.filePath(entry.id);
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, this.encrypt(entry), { mode: 0o600 });
    await rename(temporary, target);
    await chmod(target, 0o600).catch(() => undefined);
  }

  async get(layer, namespace, input) {
    await this.initialize();
    const identity = cacheIdentity(layer, namespace, input);
    const target = this.filePath(identity.id);
    const entry = await this.readEntry(target);
    if (!entry || !sameRuntimeCacheNamespace(entry.namespace, namespace)) {
      this.counters.misses += 1;
      return { hit: false, entry: null };
    }
    if (!isReusableRuntimeCacheEntry(entry, namespace, this.now())) {
      await rm(target, { force: true });
      this.counters.misses += 1;
      this.counters.evictions += 1;
      return { hit: false, entry: null };
    }
    entry.hitCount += 1;
    entry.lastAccessedAt = this.now().toISOString();
    await this.writeEntry(entry);
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
    await this.writeEntry(entry);
    await this.enforceLimits();
    return structuredClone(entry);
  }

  async list() {
    await this.initialize();
    const files = (await readdir(this.directory))
      .filter((name) => name.endsWith(".cache"));
    const entries = await Promise.all(
      files.map((name) => this.readEntry(path.join(this.directory, name))),
    );
    return entries.filter(Boolean);
  }

  async invalidate(invalidation) {
    await this.initialize();
    assertTargetedInvalidation(invalidation);
    const targets = (await this.list()).filter((entry) =>
      runtimeEntryMatchesInvalidation(entry, invalidation));
    await Promise.all(targets.map((entry) => rm(this.filePath(entry.id), { force: true })));
    this.counters.invalidations += targets.length;
    return targets.length;
  }

  async purgeExpired() {
    const entries = await this.list();
    const expired = entries.filter(
      (entry) => Date.parse(entry.expiresAt) <= this.now().getTime(),
    );
    await Promise.all(expired.map((entry) => rm(this.filePath(entry.id), { force: true })));
    this.counters.evictions += expired.length;
    return expired.length;
  }

  async enforceLimits() {
    await this.purgeExpired();
    const entries = (await this.list()).sort((left, right) =>
      Date.parse(left.lastAccessedAt) - Date.parse(right.lastAccessedAt));
    let totalEntries = entries.length;
    let totalBytes = entries.reduce((sum, entry) => sum + entry.byteSize, 0);
    for (const entry of entries) {
      if (
        totalEntries <= this.maximumEntries
        && totalBytes <= this.maximumBytes
      ) break;
      await rm(this.filePath(entry.id), { force: true });
      totalEntries -= 1;
      totalBytes -= entry.byteSize;
      this.counters.evictions += 1;
    }
  }

  async stats() {
    await this.initialize();
    await this.purgeExpired();
    const entries = await this.list();
    const layerEntries = emptyLayerCounts();
    for (const entry of entries) {
      if (RUNTIME_CACHE_LAYERS.includes(entry.layer)) layerEntries[entry.layer] += 1;
    }
    return {
      schemaVersion: "closed-ai-cache-v2",
      status: "ready",
      backend: "private-ai-hub",
      persistence: "encrypted-file",
      encryption: "AES-256-GCM",
      encryptedAtRest: true,
      entries: entries.length,
      bytes: entries.reduce((sum, entry) => sum + entry.byteSize, 0),
      ...this.counters,
      layerEntries,
      candidateOnly: true,
      memoryMutationCount: 0,
      learningMutationCount: 0,
      canonicalMutationCount: 0,
      rawPromptStored: false,
      gpuSessionState: "encrypted_runtime_handle_metadata_only",
      modelKvRuntimeStatus: "ollama_runtime_managed",
    };
  }
}

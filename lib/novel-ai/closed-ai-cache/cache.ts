import {
  estimateJsonBytes,
  jaccardSimilarity,
  semanticFingerprint,
  sha256Hex,
  stableStringify,
} from "./hashing";
import {
  assertClosedAINamespace,
  assertTargetedCacheInvalidation,
  closedAINamespaceDigest,
  namespaceMatchesInvalidation,
  sameClosedAINamespace,
} from "./namespace";
import {
  MemoryClosedAICacheRepository,
  type ClosedAICacheRepository,
} from "./repository";
import {
  CLOSED_AI_CACHE_LAYERS,
  CLOSED_AI_CACHE_SCHEMA_VERSION,
  type ClosedAICacheEntry,
  type ClosedAICacheInvalidation,
  type ClosedAICacheLayer,
  type ClosedAICacheLookup,
  type ClosedAICacheStats,
  type ClosedAINamespace,
} from "./types";

type CacheOptions = {
  repository?: ClosedAICacheRepository;
  maximumEntries?: number;
  maximumBytes?: number;
  defaultTtlMs?: number;
  semanticThreshold?: number;
  now?: () => Date;
};

type CachePutInput<T> = {
  layer: ClosedAICacheLayer;
  namespace: ClosedAINamespace;
  input: unknown;
  value: T;
  ttlMs?: number;
  tags?: string[];
  semanticText?: string;
};

const DEFAULT_TTL = 30 * 60 * 1_000;

export class ClosedAICache {
  readonly repository: ClosedAICacheRepository;
  private readonly maximumEntries: number;
  private readonly maximumBytes: number;
  private readonly defaultTtlMs: number;
  private readonly semanticThreshold: number;
  private readonly now: () => Date;
  private readonly inflight = new Map<string, Promise<unknown>>();
  private counters = {
    hits: 0,
    misses: 0,
    evictions: 0,
    invalidations: 0,
    singleFlightJoins: 0,
  };

  constructor(options: CacheOptions = {}) {
    this.repository = options.repository ?? new MemoryClosedAICacheRepository();
    this.maximumEntries = options.maximumEntries ?? 1_000;
    this.maximumBytes = options.maximumBytes ?? 64 * 1024 * 1024;
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL;
    this.semanticThreshold = options.semanticThreshold ?? 0.72;
    this.now = options.now ?? (() => new Date());
  }

  private async key(layer: ClosedAICacheLayer, namespace: ClosedAINamespace, input: unknown) {
    const [namespaceDigest, inputDigest] = await Promise.all([
      closedAINamespaceDigest(namespace),
      sha256Hex(stableStringify(input)),
    ]);
    return {
      namespaceDigest,
      inputDigest,
      id: `${layer}:${namespaceDigest}:${inputDigest}`,
    };
  }

  async put<T>(input: CachePutInput<T>): Promise<ClosedAICacheEntry<T>> {
    assertClosedAINamespace(input.namespace);
    const identity = await this.key(input.layer, input.namespace, input.input);
    const createdAt = this.now();
    const valueDigest = await sha256Hex(stableStringify(input.value));
    const entry: ClosedAICacheEntry<T> = {
      schemaVersion: CLOSED_AI_CACHE_SCHEMA_VERSION,
      id: identity.id,
      layer: input.layer,
      namespace: structuredClone(input.namespace),
      namespaceDigest: identity.namespaceDigest,
      inputDigest: identity.inputDigest,
      valueDigest,
      value: structuredClone(input.value),
      semanticFingerprint: input.layer === "semantic" && input.semanticText
        ? await semanticFingerprint(input.semanticText)
        : [],
      authority: "cache_candidate_only",
      candidateOnly: true,
      approvalTransactionId: null,
      memoryMutation: false,
      learningMutation: false,
      canonicalMutation: false,
      rawPromptStored: false,
      createdAt: createdAt.toISOString(),
      lastAccessedAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + Math.max(1, input.ttlMs ?? this.defaultTtlMs)).toISOString(),
      hitCount: 0,
      byteSize: 0,
      tags: [...new Set(input.tags ?? [])].sort(),
    };
    entry.byteSize = estimateJsonBytes(entry);
    await this.repository.put(entry);
    await this.enforceLimits();
    return entry;
  }

  async get<T>(
    layer: ClosedAICacheLayer,
    namespace: ClosedAINamespace,
    input: unknown,
  ): Promise<ClosedAICacheLookup<T>> {
    const identity = await this.key(layer, namespace, input);
    const entry = await this.repository.get<T>(identity.id);
    if (
      !entry
      || entry.schemaVersion !== CLOSED_AI_CACHE_SCHEMA_VERSION
      || entry.authority !== "cache_candidate_only"
      || entry.candidateOnly !== true
      || entry.approvalTransactionId !== null
      || entry.memoryMutation !== false
      || entry.learningMutation !== false
      || entry.canonicalMutation !== false
      || entry.rawPromptStored !== false
      || !sameClosedAINamespace(entry.namespace, namespace)
    ) {
      if (entry) await this.repository.remove(entry.id);
      this.counters.misses += 1;
      return { hit: false, layer, entry: null, similarity: null };
    }
    if (Date.parse(entry.expiresAt) <= this.now().getTime()) {
      await this.repository.remove(entry.id);
      this.counters.misses += 1;
      this.counters.evictions += 1;
      return { hit: false, layer, entry: null, similarity: null };
    }
    entry.hitCount += 1;
    entry.lastAccessedAt = this.now().toISOString();
    await this.repository.put(entry);
    this.counters.hits += 1;
    return { hit: true, layer, entry, similarity: 1 };
  }

  async getSemantic<T>(
    namespace: ClosedAINamespace,
    semanticText: string,
    threshold = this.semanticThreshold,
    acceptEntry?: (entry: ClosedAICacheEntry<T>) => boolean,
  ): Promise<ClosedAICacheLookup<T>> {
    assertClosedAINamespace(namespace);
    const fingerprint = await semanticFingerprint(semanticText);
    const now = this.now().getTime();
    const candidates = (await this.repository.list<T>())
      .filter((entry) =>
        entry.layer === "semantic"
        && entry.schemaVersion === CLOSED_AI_CACHE_SCHEMA_VERSION
        && entry.authority === "cache_candidate_only"
        && entry.candidateOnly === true
        && entry.approvalTransactionId === null
        && entry.memoryMutation === false
        && entry.learningMutation === false
        && entry.canonicalMutation === false
        && entry.rawPromptStored === false
        && sameClosedAINamespace(entry.namespace, namespace)
        && Date.parse(entry.expiresAt) > now
        && (!acceptEntry || acceptEntry(entry)))
      .map((entry) => ({
        entry,
        similarity: jaccardSimilarity(fingerprint, entry.semanticFingerprint),
      }))
      .sort((left, right) => right.similarity - left.similarity);
    const best = candidates[0];
    if (!best || best.similarity < threshold) {
      this.counters.misses += 1;
      return { hit: false, layer: "semantic", entry: null, similarity: best?.similarity ?? null };
    }
    best.entry.hitCount += 1;
    best.entry.lastAccessedAt = this.now().toISOString();
    await this.repository.put(best.entry);
    this.counters.hits += 1;
    return { hit: true, layer: "semantic", entry: best.entry, similarity: best.similarity };
  }

  async compute<T>(
    layer: ClosedAICacheLayer,
    namespace: ClosedAINamespace,
    input: unknown,
    factory: () => Promise<T>,
    options: Omit<CachePutInput<T>, "layer" | "namespace" | "input" | "value"> = {},
  ): Promise<{ value: T; cacheHit: boolean; entry: ClosedAICacheEntry<T> }> {
    const cached = await this.get<T>(layer, namespace, input);
    if (cached.hit && cached.entry) {
      return { value: cached.entry.value, cacheHit: true, entry: cached.entry };
    }
    const identity = await this.key(layer, namespace, input);
    const existing = this.inflight.get(identity.id) as Promise<{
      value: T;
      entry: ClosedAICacheEntry<T>;
    }> | undefined;
    if (existing) {
      this.counters.singleFlightJoins += 1;
      const result = await existing;
      return { ...result, cacheHit: true };
    }
    const running = (async () => {
      const value = await factory();
      const entry = await this.put({ layer, namespace, input, value, ...options });
      return { value, entry };
    })();
    this.inflight.set(identity.id, running);
    try {
      const result = await running;
      return { ...result, cacheHit: false };
    } finally {
      this.inflight.delete(identity.id);
    }
  }

  async invalidate(invalidation: ClosedAICacheInvalidation): Promise<number> {
    assertTargetedCacheInvalidation(invalidation);
    const entries = await this.repository.list();
    const selectedLayers = invalidation.layers ? new Set(invalidation.layers) : null;
    const selectedTags = invalidation.tags ? new Set(invalidation.tags) : null;
    const createdBefore = invalidation.createdBefore ? Date.parse(invalidation.createdBefore) : null;
    const targets = entries.filter((entry) =>
      namespaceMatchesInvalidation(entry.namespace, invalidation)
      && (!selectedLayers || selectedLayers.has(entry.layer))
      && (!selectedTags || entry.tags.some((tag) => selectedTags.has(tag)))
      && (createdBefore === null || Date.parse(entry.createdAt) < createdBefore));
    await Promise.all(targets.map((entry) => this.repository.remove(entry.id)));
    this.counters.invalidations += targets.length;
    return targets.length;
  }

  async invalidateStoryBibleRevision(
    namespace: Pick<ClosedAINamespace, "tenantId" | "userId" | "projectId" | "storyId" | "canonId">,
    previousRevision: string,
  ): Promise<number> {
    return this.invalidate({
      ...namespace,
      storyBibleRevision: previousRevision,
      layers: ["exact", "semantic", "retrieval", "agent-plan", "tool-result"],
    });
  }

  async invalidateKnowledgeScopeRevision(
    namespace: Pick<ClosedAINamespace, "tenantId" | "userId" | "projectId" | "storyId" | "canonId">,
    previousRevision: string,
  ): Promise<number> {
    return this.invalidate({
      ...namespace,
      knowledgeScopeRevision: previousRevision,
      layers: ["semantic", "retrieval", "agent-plan", "tool-result"],
    });
  }

  async invalidateModelDigest(
    namespace: Pick<ClosedAINamespace, "tenantId" | "userId" | "projectId">,
    previousModelDigest: string,
  ): Promise<number> {
    return this.invalidate({
      ...namespace,
      modelDigest: previousModelDigest,
      layers: [...CLOSED_AI_CACHE_LAYERS],
    });
  }

  async invalidateBranch(
    namespace: Pick<ClosedAINamespace, "tenantId" | "userId" | "projectId" | "storyId" | "canonId">,
    branchId: string,
  ): Promise<number> {
    return this.invalidate({
      ...namespace,
      branchId,
      layers: [...CLOSED_AI_CACHE_LAYERS],
    });
  }

  private async enforceLimits() {
    const entries = await this.repository.list();
    const sorted = [...entries].sort((left, right) =>
      Date.parse(left.lastAccessedAt) - Date.parse(right.lastAccessedAt));
    let totalBytes = sorted.reduce((sum, entry) => sum + entry.byteSize, 0);
    let totalEntries = sorted.length;
    for (const entry of sorted) {
      if (totalEntries <= this.maximumEntries && totalBytes <= this.maximumBytes) break;
      await this.repository.remove(entry.id);
      totalEntries -= 1;
      totalBytes -= entry.byteSize;
      this.counters.evictions += 1;
    }
  }

  async stats(): Promise<ClosedAICacheStats> {
    const entries = await this.repository.list();
    const layerEntries = Object.fromEntries(
      CLOSED_AI_CACHE_LAYERS.map((layer) => [
        layer,
        entries.filter((entry) => entry.layer === layer).length,
      ]),
    ) as Record<ClosedAICacheLayer, number>;
    return {
      schemaVersion: CLOSED_AI_CACHE_SCHEMA_VERSION,
      status: "ready",
      persistence: this.repository.kind,
      entries: entries.length,
      bytes: entries.reduce((sum, entry) => sum + entry.byteSize, 0),
      ...this.counters,
      layerEntries,
      candidateOnly: true,
      memoryMutationCount: 0,
      learningMutationCount: 0,
      canonicalMutationCount: 0,
      rawPromptStored: false,
      opfsLargePayloadStatus: this.repository.opfsStatus(),
      modelSessionState: "runtime_handle_metadata_only",
      modelKvRuntimeStatus: "adapter_ready_runtime_dependent",
    };
  }
}

export const CLOSED_AI_CACHE_HEALTH = {
  schemaVersion: CLOSED_AI_CACHE_SCHEMA_VERSION,
  status: "ready",
  exactCacheStatus: "ready",
  semanticCacheStatus: "ready",
  retrievalCacheStatus: "ready",
  agentPlanCacheStatus: "ready",
  toolResultCacheStatus: "ready",
  modelSessionCacheStatus: "adapter_ready_runtime_dependent",
  targetedInvalidationStatus: "ready",
  namespaceIsolationStatus: "ready",
  ttlLruByteBudgetStatus: "ready",
  singleFlightStatus: "ready",
  browserPersistence: "indexeddb-opfs",
  localOllamaPersistence: "sqlite",
  privateHubPersistence: "aes-256-gcm-encrypted-file",
  cacheMemoryLearningCanonBoundaryStatus: "approval_transaction_enforced",
  rawPromptStored: false,
  memoryMutationCount: 0,
  learningMutationCount: 0,
  canonicalMutationCount: 0,
} as const;

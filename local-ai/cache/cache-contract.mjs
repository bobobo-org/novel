import crypto from "node:crypto";

export const RUNTIME_CACHE_SCHEMA_VERSION = "closed-ai-cache-v2";

export const RUNTIME_CACHE_LAYERS = Object.freeze([
  "exact",
  "semantic",
  "retrieval",
  "agent-plan",
  "tool-result",
  "model-session",
]);

export const CACHE_NAMESPACE_FIELDS = Object.freeze([
  "tenantId",
  "userId",
  "projectId",
  "storyId",
  "canonId",
  "branchId",
  "characterId",
  "agentRole",
  "modelId",
  "modelDigest",
  "promptProfileVersion",
  "storyBibleRevision",
  "knowledgeScopeRevision",
  "privacyLevel",
]);

const PRIVACY_LEVELS = new Set([
  "device_only",
  "private_infrastructure_only",
  "author_only",
  "adult_isolated",
]);

export function stableStringify(value) {
  if (value === undefined) return '"__undefined__"';
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function assertRuntimeCacheLayer(layer) {
  if (!RUNTIME_CACHE_LAYERS.includes(layer)) {
    throw Object.assign(new Error(`Closed AI cache layer is invalid: ${layer}`), {
      code: "CLOSED_AI_CACHE_LAYER_INVALID",
      layer,
    });
  }
}

export function assertRuntimeCacheNamespace(namespace) {
  if (!namespace || typeof namespace !== "object" || Array.isArray(namespace)) {
    throw Object.assign(new Error("Closed AI cache namespace is required."), {
      code: "CLOSED_AI_NAMESPACE_INVALID",
    });
  }
  for (const field of CACHE_NAMESPACE_FIELDS) {
    const value = namespace[field];
    if (
      typeof value !== "string"
      || !value
      || value === "*"
      || value.trim() !== value
    ) {
      throw Object.assign(new Error(`Closed AI namespace field is invalid: ${field}`), {
        code: "CLOSED_AI_NAMESPACE_INVALID",
        field,
      });
    }
  }
  if (!PRIVACY_LEVELS.has(namespace.privacyLevel)) {
    throw Object.assign(new Error("Closed AI cache privacy level is invalid."), {
      code: "CLOSED_AI_NAMESPACE_INVALID",
      field: "privacyLevel",
    });
  }
  return namespace;
}

export function assertTargetedInvalidation(invalidation) {
  if (!invalidation || typeof invalidation !== "object" || Array.isArray(invalidation)) {
    throw Object.assign(new Error("A targeted cache invalidation selector is required."), {
      code: "CLOSED_AI_CACHE_INVALIDATION_NOT_TARGETED",
    });
  }
  const identityFields = CACHE_NAMESPACE_FIELDS.filter(
    (field) => invalidation[field] !== undefined,
  );
  if (!identityFields.length) {
    throw Object.assign(
      new Error("Cache invalidation must include at least one namespace identity field."),
      { code: "CLOSED_AI_CACHE_INVALIDATION_NOT_TARGETED" },
    );
  }
  for (const field of identityFields) {
    const value = invalidation[field];
    if (
      typeof value !== "string"
      || !value
      || value === "*"
      || value.trim() !== value
    ) {
      throw Object.assign(new Error(`Cache invalidation field is invalid: ${field}`), {
        code: "CLOSED_AI_CACHE_INVALIDATION_NOT_TARGETED",
        field,
      });
    }
  }
  for (const layer of invalidation.layers ?? []) assertRuntimeCacheLayer(layer);
  if (
    invalidation.createdBefore !== undefined
    && !Number.isFinite(Date.parse(invalidation.createdBefore))
  ) {
    throw Object.assign(new Error("Cache invalidation timestamp is invalid."), {
      code: "CLOSED_AI_CACHE_INVALIDATION_NOT_TARGETED",
      field: "createdBefore",
    });
  }
}

export function cacheIdentity(layer, namespace, input) {
  assertRuntimeCacheLayer(layer);
  assertRuntimeCacheNamespace(namespace);
  const namespaceDigest = sha256(stableStringify(namespace));
  const inputDigest = sha256(stableStringify(input));
  return {
    namespaceDigest,
    inputDigest,
    id: `${layer}:${namespaceDigest}:${inputDigest}`,
  };
}

export function sameRuntimeCacheNamespace(left, right) {
  return CACHE_NAMESPACE_FIELDS.every((field) => left?.[field] === right?.[field]);
}

export function runtimeNamespaceMatches(namespace, invalidation) {
  return CACHE_NAMESPACE_FIELDS.every((field) =>
    invalidation[field] === undefined || namespace[field] === invalidation[field]);
}

export function runtimeEntryMatchesInvalidation(entry, invalidation) {
  const selectedLayers = invalidation.layers ? new Set(invalidation.layers) : null;
  const selectedTags = invalidation.tags ? new Set(invalidation.tags) : null;
  const createdBefore = invalidation.createdBefore
    ? Date.parse(invalidation.createdBefore)
    : null;
  return runtimeNamespaceMatches(entry.namespace, invalidation)
    && (!selectedLayers || selectedLayers.has(entry.layer))
    && (!selectedTags || entry.tags.some((tag) => selectedTags.has(tag)))
    && (createdBefore === null || Date.parse(entry.createdAt) < createdBefore);
}

export function createRuntimeCacheEntry({
  layer,
  namespace,
  input,
  value,
  ttlMs,
  tags = [],
  now = new Date(),
}) {
  const identity = cacheIdentity(layer, namespace, input);
  const normalizedTags = [...new Set(
    tags.filter((tag) => typeof tag === "string" && tag.trim()).map((tag) => tag.trim()),
  )].sort();
  const entry = {
    schemaVersion: RUNTIME_CACHE_SCHEMA_VERSION,
    id: identity.id,
    layer,
    namespace: structuredClone(namespace),
    namespaceDigest: identity.namespaceDigest,
    inputDigest: identity.inputDigest,
    valueDigest: sha256(stableStringify(value)),
    value: structuredClone(value),
    authority: "cache_candidate_only",
    candidateOnly: true,
    approvalTransactionId: null,
    memoryMutation: false,
    learningMutation: false,
    canonicalMutation: false,
    rawPromptStored: false,
    createdAt: now.toISOString(),
    lastAccessedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + Math.max(1, ttlMs)).toISOString(),
    hitCount: 0,
    byteSize: 0,
    tags: normalizedTags,
  };
  entry.byteSize = Buffer.byteLength(stableStringify(entry), "utf8");
  return entry;
}

export function isReusableRuntimeCacheEntry(entry, namespace, now = new Date()) {
  return entry?.schemaVersion === RUNTIME_CACHE_SCHEMA_VERSION
    && entry.authority === "cache_candidate_only"
    && entry.candidateOnly === true
    && entry.approvalTransactionId === null
    && entry.memoryMutation === false
    && entry.learningMutation === false
    && entry.canonicalMutation === false
    && entry.rawPromptStored === false
    && sameRuntimeCacheNamespace(entry.namespace, namespace)
    && Date.parse(entry.expiresAt) > now.getTime();
}

export function emptyLayerCounts() {
  return Object.fromEntries(RUNTIME_CACHE_LAYERS.map((layer) => [layer, 0]));
}

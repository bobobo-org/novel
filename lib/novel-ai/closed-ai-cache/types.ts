export const CLOSED_AI_CACHE_SCHEMA_VERSION = "closed-ai-cache-v1" as const;

export const CLOSED_AI_CACHE_LAYERS = [
  "exact",
  "semantic",
  "retrieval",
  "agent-plan",
  "tool-result",
  "model-session",
] as const;

export type ClosedAICacheLayer = (typeof CLOSED_AI_CACHE_LAYERS)[number];

export type ClosedAIPrivacyLevel =
  | "device_only"
  | "private_infrastructure_only"
  | "author_only"
  | "adult_isolated";

/**
 * Every reusable AI artifact is bound to the complete execution identity.
 * Empty or wildcard values are deliberately forbidden.
 */
export type ClosedAINamespace = {
  tenantId: string;
  userId: string;
  projectId: string;
  storyId: string;
  canonId: string;
  branchId: string;
  characterId: string;
  agentRole: string;
  modelId: string;
  modelDigest: string;
  promptProfileVersion: string;
  storyBibleRevision: string;
  knowledgeScopeRevision: string;
  privacyLevel: ClosedAIPrivacyLevel;
};

export type ClosedAICacheEntry<T = unknown> = {
  schemaVersion: typeof CLOSED_AI_CACHE_SCHEMA_VERSION;
  id: string;
  layer: ClosedAICacheLayer;
  namespace: ClosedAINamespace;
  namespaceDigest: string;
  inputDigest: string;
  valueDigest: string;
  value: T;
  semanticFingerprint: string[];
  candidateOnly: true;
  canonicalMutation: false;
  createdAt: string;
  lastAccessedAt: string;
  expiresAt: string;
  hitCount: number;
  byteSize: number;
  tags: string[];
};

export type ClosedAICacheLookup<T = unknown> = {
  hit: boolean;
  layer: ClosedAICacheLayer;
  entry: ClosedAICacheEntry<T> | null;
  similarity: number | null;
};

export type ClosedAICacheInvalidation = Partial<ClosedAINamespace> & {
  layers?: ClosedAICacheLayer[];
  tags?: string[];
  createdBefore?: string;
};

export type ClosedAICacheStats = {
  schemaVersion: typeof CLOSED_AI_CACHE_SCHEMA_VERSION;
  status: "ready";
  persistence: "indexeddb" | "memory";
  entries: number;
  bytes: number;
  hits: number;
  misses: number;
  evictions: number;
  invalidations: number;
  singleFlightJoins: number;
  layerEntries: Record<ClosedAICacheLayer, number>;
  candidateOnly: true;
  canonicalMutationCount: 0;
  rawPromptStored: false;
  modelKvRuntimeStatus: "adapter_ready_runtime_dependent";
};

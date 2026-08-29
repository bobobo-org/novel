import type { CharacterPortrait } from "../domain";

export const GLOBAL_CANON_SCHEMA_VERSION = "global-canon-v1" as const;
export const GLOBAL_CANON_DATABASE_NAME = "novel-global-canon-library" as const;
export const GLOBAL_CANON_DATABASE_VERSION = 2 as const;

export const GLOBAL_CANON_STORES = [
  "characters",
  "relationships",
  "worlds",
  "rules",
  "memories",
  "storyBibles",
  "timelineTemplates",
] as const;

export type GlobalCanonStoreName = (typeof GLOBAL_CANON_STORES)[number];

export type GlobalCanonEraContext =
  | "modern"
  | "historical"
  | "cultivation"
  | "future"
  | "cross-era"
  | "other";

export type GlobalCanonProvenance = {
  origin: "author" | "system_catalog" | "private_import" | "public_domain" | "migration";
  sourceLabel: string;
  sourceId: string | null;
  sourceUrl: string | null;
  rightsBasis: string | null;
  createdAt: string;
  /** Global Canon records remain local unless a separate, explicit export is requested. */
  dataLeftDevice: false;
};

export type ProjectCanonSourceStore =
  | "characters"
  | "relationships"
  | "worlds"
  | "worldRules"
  | "lore"
  | "storyBibles"
  | "timeline";

/**
 * Immutable source coordinates for an explicit, local project -> global
 * import.  They make repeat imports idempotent without turning the global
 * library into a live alias of the source project.
 */
export type GlobalCanonProjectImportRef = {
  schemaVersion: "global-canon-project-import-ref-v1";
  projectId: string;
  projectTitle: string;
  sourceStore: ProjectCanonSourceStore;
  sourceRecordId: string;
  sourceRevision: number;
  sourceUpdatedAt: string;
  sourceFingerprint: string;
  importedAt: string;
  /** Importing makes a reusable global record; it never puts it on stage. */
  autoStaged: false;
};

export type GlobalCanonBaseRecord = {
  schemaVersion: typeof GLOBAL_CANON_SCHEMA_VERSION;
  id: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  provenance: GlobalCanonProvenance;
  projectImportRef?: GlobalCanonProjectImportRef;
};

export type GlobalCharacterAbilityKey =
  | "cultivation"
  | "martial"
  | "strategy"
  | "perception"
  | "medicine"
  | "crafting"
  | "leadership"
  | "influence";

export type GlobalCharacterAbilityProfile = {
  schemaVersion: "global-character-ability-profile-v1";
  source: "personal_hero" | "system_catalog";
  label: string;
  scaleMin: number;
  scaleMax: number;
  stats: Record<GlobalCharacterAbilityKey, number>;
};

export type GlobalCharacter = GlobalCanonBaseRecord & {
  recordType: "character";
  name: string;
  aliases: string[];
  identity: string | null;
  personality: string | null;
  goal: string | null;
  lifeStatus: "unknown" | "alive" | "dead";
  eraContext: GlobalCanonEraContext;
  age: number | null;
  fears: string[];
  privateSecrets: string[];
  factionIds: string[];
  values: string[];
  capabilities: string[];
  limitations: string[];
  abilityProfile: GlobalCharacterAbilityProfile | null;
  portrait: CharacterPortrait | null;
};

export type GlobalCharacterRelationship = GlobalCanonBaseRecord & {
  recordType: "relationship";
  fromGlobalCharacterId: string;
  toGlobalCharacterId: string;
  kind: string;
  summary: string;
  trust: number | null;
};

export type GlobalWorld = GlobalCanonBaseRecord & {
  recordType: "world";
  name: string;
  classificationId: string;
  classificationLabel: string;
  eraContext: GlobalCanonEraContext;
  eraLabel: string;
  summary: string;
  /** Required when eraContext is cross-era; null means the world cannot mix eras. */
  crossEraBridge: string | null;
  catalogWorldNumber: number | null;
  primaryTopicId: string | null;
  compatibleTopicIds: string[];
};

export type GlobalWorldRule = GlobalCanonBaseRecord & {
  recordType: "rule";
  title: string;
  description: string;
  immutable: boolean;
  eraContexts: GlobalCanonEraContext[];
  appliesToGlobalWorldIds: string[];
};

export type GlobalMemoryKind = "location" | "faction" | "item" | "secret" | "custom";

export type GlobalMemory = GlobalCanonBaseRecord & {
  recordType: "memory";
  kind: GlobalMemoryKind;
  title: string;
  content: string;
  eraContexts: GlobalCanonEraContext[];
  appliesToGlobalWorldIds: string[];
};

export type GlobalTimelineTemplate = GlobalCanonBaseRecord & {
  recordType: "timeline_template";
  title: string;
  storyTime: string | null;
  summary: string;
  eraContext: GlobalCanonEraContext;
  placementHint: string | null;
};

/**
 * A global Story Bible is a reusable formal-setting snapshot.  Its links
 * target the deterministic global records created by the same import, never
 * the mutable source-project rows.
 */
export type GlobalStoryBible = GlobalCanonBaseRecord & {
  recordType: "story_bible";
  title: string;
  theme: string | null;
  style: string | null;
  protagonistGlobalCharacterIds: string[];
  globalCharacterIds: string[];
  globalRelationshipIds: string[];
  globalWorldId: string | null;
  globalWorldRuleIds: string[];
  globalMemoryIds: string[];
  globalTimelineTemplateIds: string[];
  foreshadowing: string[];
  unresolvedThreads: string[];
  resolvedThreads: string[];
  forbiddenContradictions: string[];
  authorPreferences: string[];
};

export type GlobalCanonRecord =
  | GlobalCharacter
  | GlobalCharacterRelationship
  | GlobalWorld
  | GlobalWorldRule
  | GlobalMemory
  | GlobalTimelineTemplate;

/** UI-editable records plus import-only Story Bible snapshots. */
export type GlobalCanonStoredRecord = GlobalCanonRecord | GlobalStoryBible;

export type GlobalCanonRecordByStore = {
  characters: GlobalCharacter;
  relationships: GlobalCharacterRelationship;
  worlds: GlobalWorld;
  rules: GlobalWorldRule;
  memories: GlobalMemory;
  storyBibles: GlobalStoryBible;
  timelineTemplates: GlobalTimelineTemplate;
};

export type GlobalCanonSourceRef = {
  schemaVersion: "global-canon-source-ref-v1";
  globalStore: GlobalCanonStoreName;
  globalRecordId: string;
  globalRevision: number;
  globalUpdatedAt: string;
  sourceProvenance: GlobalCanonProvenance;
  copiedAt: string;
};

export type GlobalCanonCopyReceipt = {
  schemaVersion: "global-canon-copy-receipt-v1";
  projectId: string;
  targetStore: "characters" | "relationships" | "worlds" | "worldRules" | "lore" | "timeline";
  targetRecordId: string;
  sourceRef: GlobalCanonSourceRef;
  /** Copying only makes a project-local snapshot available for selection. */
  autoStaged: false;
};

export function createGlobalCanonProvenance(
  input: Partial<Omit<GlobalCanonProvenance, "createdAt" | "dataLeftDevice">> = {},
  now = new Date().toISOString(),
): GlobalCanonProvenance {
  return {
    origin: input.origin ?? "author",
    sourceLabel: input.sourceLabel?.trim() || "作者建立",
    sourceId: input.sourceId?.trim() || null,
    sourceUrl: input.sourceUrl?.trim() || null,
    rightsBasis: input.rightsBasis?.trim() || null,
    createdAt: now,
    dataLeftDevice: false,
  };
}

function fallbackId() {
  const random = Math.random().toString(36).slice(2);
  return `global-${Date.now().toString(36)}-${random}`;
}

export function createGlobalCanonId() {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : fallbackId();
}

export function createGlobalCanonBase(
  input: {
    id?: string;
    provenance?: Partial<Omit<GlobalCanonProvenance, "createdAt" | "dataLeftDevice">>;
  } = {},
  now = new Date().toISOString(),
): GlobalCanonBaseRecord {
  return {
    schemaVersion: GLOBAL_CANON_SCHEMA_VERSION,
    id: input.id?.trim() || createGlobalCanonId(),
    createdAt: now,
    updatedAt: now,
    revision: 1,
    provenance: createGlobalCanonProvenance(input.provenance, now),
  };
}

export function cloneGlobalCanonRecord<T extends GlobalCanonStoredRecord>(record: T): T {
  if (typeof structuredClone === "function") return structuredClone(record);
  return JSON.parse(JSON.stringify(record)) as T;
}

import type {
  Character,
  CharacterRelationship,
  DomainRecord,
  LoreEntry,
  NovelProject,
  OptionalValue,
  TimelineEvent,
  World,
  WorldRule,
} from "../domain";
import { NOVEL_DOMAIN_VERSION } from "../domain";
import type { NovelRepository, NovelStoreName } from "../repository";
import {
  cloneGlobalCanonRecord,
  createGlobalCanonId,
  type GlobalCanonCopyReceipt,
  type GlobalCanonEraContext,
  type GlobalCanonRecord,
  type GlobalCanonSourceRef,
  type GlobalCanonStoreName,
  type GlobalCharacter,
  type GlobalCharacterRelationship,
  type GlobalMemory,
  type GlobalTimelineTemplate,
  type GlobalWorld,
  type GlobalWorldRule,
} from "./types";

type GlobalCanonSnapshotMetadata = {
  globalCanonSourceRef: GlobalCanonSourceRef;
};

export type ProjectCharacterCanonSnapshot = Character & GlobalCanonSnapshotMetadata & {
  eraContext: GlobalCanonEraContext;
};

export type ProjectRelationshipCanonSnapshot = CharacterRelationship & GlobalCanonSnapshotMetadata;

export type ProjectWorldCanonSnapshot = World & GlobalCanonSnapshotMetadata & {
  globalClassificationId: string;
  globalClassificationLabel: string;
  eraContext: GlobalCanonEraContext;
  crossEraBridge: string | null;
};

export type ProjectWorldRuleCanonSnapshot = WorldRule & GlobalCanonSnapshotMetadata & {
  eraContexts: GlobalCanonEraContext[];
};

export type ProjectMemoryCanonSnapshot = LoreEntry & GlobalCanonSnapshotMetadata & {
  eraContexts: GlobalCanonEraContext[];
};

export type ProjectTimelineCanonSnapshot = TimelineEvent & GlobalCanonSnapshotMetadata & {
  eraContext: GlobalCanonEraContext;
  placementHint: string | null;
};

export type ProjectCanonSnapshot =
  | ProjectCharacterCanonSnapshot
  | ProjectRelationshipCanonSnapshot
  | ProjectWorldCanonSnapshot
  | ProjectWorldRuleCanonSnapshot
  | ProjectMemoryCanonSnapshot
  | ProjectTimelineCanonSnapshot;

export type ProjectCanonTargetStore = Extract<
  NovelStoreName,
  "characters" | "relationships" | "worlds" | "worldRules" | "lore" | "timeline"
>;

export type CopyGlobalCanonOptions = {
  targetId?: string;
  copiedAt?: string;
  relationshipCharacterIds?: {
    fromCharacterId: string;
    toCharacterId: string;
  };
};

export type PreparedProjectCanonCopy = {
  targetStore: ProjectCanonTargetStore;
  record: ProjectCanonSnapshot;
  receipt: GlobalCanonCopyReceipt;
};

export type PersistedProjectCanonCopy = PreparedProjectCanonCopy & {
  record: ProjectCanonSnapshot;
};

function projectRecordBase(
  projectId: string,
  id: string,
  copiedAt: string,
  source: GlobalCanonRecord,
): DomainRecord {
  return {
    schemaVersion: NOVEL_DOMAIN_VERSION,
    id,
    projectId,
    createdAt: copiedAt,
    updatedAt: copiedAt,
    revision: 1,
    source: "user",
    provenance: {
      source: "user",
      actor: "author",
      requestId: `global-canon:${source.recordType}:${source.id}@${source.revision}`,
      createdAt: copiedAt,
    },
    deletedAt: null,
    parentRevision: null,
    migrationVersion: null,
  };
}

function optionalText(value: string | null, copiedAt: string): OptionalValue<string> {
  return {
    value,
    status: value ? "user_defined" : "unset",
    source: value ? "user" : null,
    updatedAt: value ? copiedAt : null,
  };
}

function sourceRef(
  store: GlobalCanonStoreName,
  source: GlobalCanonRecord,
  copiedAt: string,
): GlobalCanonSourceRef {
  return {
    schemaVersion: "global-canon-source-ref-v1",
    globalStore: store,
    globalRecordId: source.id,
    globalRevision: source.revision,
    globalUpdatedAt: source.updatedAt,
    sourceProvenance: cloneGlobalCanonRecord(source).provenance,
    copiedAt,
  };
}

function receipt(
  projectId: string,
  targetStore: ProjectCanonTargetStore,
  targetRecordId: string,
  ref: GlobalCanonSourceRef,
): GlobalCanonCopyReceipt {
  return {
    schemaVersion: "global-canon-copy-receipt-v1",
    projectId,
    targetStore,
    targetRecordId,
    sourceRef: ref,
    autoStaged: false,
  };
}

function prepareCharacter(
  source: GlobalCharacter,
  projectId: string,
  id: string,
  copiedAt: string,
): PreparedProjectCanonCopy {
  const ref = sourceRef("characters", source, copiedAt);
  const record: ProjectCharacterCanonSnapshot = {
    ...projectRecordBase(projectId, id, copiedAt, source),
    name: source.name,
    aliases: [...source.aliases],
    identity: optionalText(source.identity, copiedAt),
    personality: optionalText(source.personality, copiedAt),
    goal: optionalText(source.goal, copiedAt),
    lifeStatus: source.lifeStatus,
    locationId: null,
    age: source.age,
    ageVerified: source.age === null ? undefined : true,
    fears: [...source.fears],
    privateSecrets: [...source.privateSecrets],
    factionIds: [...source.factionIds],
    values: [...source.values],
    capabilities: [...source.capabilities],
    limitations: [...source.limitations],
    portrait: source.portrait ? structuredCloneSafe(source.portrait) : null,
    eraContext: source.eraContext,
    globalCanonSourceRef: ref,
  };
  return {
    targetStore: "characters",
    record,
    receipt: receipt(projectId, "characters", id, ref),
  };
}

function prepareRelationship(
  source: GlobalCharacterRelationship,
  projectId: string,
  id: string,
  copiedAt: string,
  characterIds: CopyGlobalCanonOptions["relationshipCharacterIds"],
): PreparedProjectCanonCopy {
  if (!characterIds?.fromCharacterId || !characterIds.toCharacterId) {
    throw new Error("複製角色關係時，必須先指定兩端在目標作品中的角色 ID");
  }
  const ref = sourceRef("relationships", source, copiedAt);
  const record: ProjectRelationshipCanonSnapshot = {
    ...projectRecordBase(projectId, id, copiedAt, source),
    fromCharacterId: characterIds.fromCharacterId,
    toCharacterId: characterIds.toCharacterId,
    kind: source.kind,
    summary: source.summary,
    trust: source.trust,
    globalCanonSourceRef: ref,
  };
  return {
    targetStore: "relationships",
    record,
    receipt: receipt(projectId, "relationships", id, ref),
  };
}

function prepareWorld(
  source: GlobalWorld,
  projectId: string,
  id: string,
  copiedAt: string,
): PreparedProjectCanonCopy {
  const ref = sourceRef("worlds", source, copiedAt);
  const bridge = source.crossEraBridge
    ? `跨時代橋接：${source.crossEraBridge}`
    : null;
  const summary = [
    source.summary,
    source.classificationLabel ? `世界分類：${source.classificationLabel}` : "",
    bridge ?? "",
  ].filter(Boolean).join("\n");
  const record: ProjectWorldCanonSnapshot = {
    ...projectRecordBase(projectId, id, copiedAt, source),
    name: optionalText(source.name, copiedAt),
    era: optionalText(source.eraLabel, copiedAt),
    summary: optionalText(summary || null, copiedAt),
    globalClassificationId: source.classificationId,
    globalClassificationLabel: source.classificationLabel,
    eraContext: source.eraContext,
    crossEraBridge: source.crossEraBridge,
    globalCanonSourceRef: ref,
  };
  return {
    targetStore: "worlds",
    record,
    receipt: receipt(projectId, "worlds", id, ref),
  };
}

function prepareRule(
  source: GlobalWorldRule,
  projectId: string,
  id: string,
  copiedAt: string,
): PreparedProjectCanonCopy {
  const ref = sourceRef("rules", source, copiedAt);
  const record: ProjectWorldRuleCanonSnapshot = {
    ...projectRecordBase(projectId, id, copiedAt, source),
    title: source.title,
    description: source.description,
    immutable: source.immutable,
    eraContexts: [...source.eraContexts],
    globalCanonSourceRef: ref,
  };
  return {
    targetStore: "worldRules",
    record,
    receipt: receipt(projectId, "worldRules", id, ref),
  };
}

function prepareMemory(
  source: GlobalMemory,
  projectId: string,
  id: string,
  copiedAt: string,
): PreparedProjectCanonCopy {
  const ref = sourceRef("memories", source, copiedAt);
  const record: ProjectMemoryCanonSnapshot = {
    ...projectRecordBase(projectId, id, copiedAt, source),
    kind: source.kind,
    title: source.title,
    content: source.content,
    eraContexts: [...source.eraContexts],
    globalCanonSourceRef: ref,
  };
  return {
    targetStore: "lore",
    record,
    receipt: receipt(projectId, "lore", id, ref),
  };
}

function prepareTimeline(
  source: GlobalTimelineTemplate,
  projectId: string,
  id: string,
  copiedAt: string,
): PreparedProjectCanonCopy {
  const ref = sourceRef("timelineTemplates", source, copiedAt);
  const record: ProjectTimelineCanonSnapshot = {
    ...projectRecordBase(projectId, id, copiedAt, source),
    chapterId: null,
    storyTime: source.storyTime,
    title: source.title,
    summary: source.summary,
    eraContext: source.eraContext,
    placementHint: source.placementHint,
    globalCanonSourceRef: ref,
  };
  return {
    targetStore: "timeline",
    record,
    receipt: receipt(projectId, "timeline", id, ref),
  };
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export function prepareGlobalCanonCopy(
  source: GlobalCanonRecord,
  projectId: string,
  options: CopyGlobalCanonOptions = {},
): PreparedProjectCanonCopy {
  if (!projectId.trim()) throw new Error("必須指定要複製到哪一本作品");
  const copiedAt = options.copiedAt ?? new Date().toISOString();
  const id = options.targetId?.trim() || createGlobalCanonId();
  switch (source.recordType) {
    case "character":
      return prepareCharacter(source, projectId, id, copiedAt);
    case "relationship":
      return prepareRelationship(source, projectId, id, copiedAt, options.relationshipCharacterIds);
    case "world":
      return prepareWorld(source, projectId, id, copiedAt);
    case "rule":
      return prepareRule(source, projectId, id, copiedAt);
    case "memory":
      return prepareMemory(source, projectId, id, copiedAt);
    case "timeline_template":
      return prepareTimeline(source, projectId, id, copiedAt);
  }
}

/**
 * Performs one explicit copy into a project store. This function deliberately
 * never writes StoryBible or StoryState, so the snapshot is available to the
 * project's selector but cannot silently enter the current story.
 */
export async function copyGlobalCanonToProject(input: {
  repository: NovelRepository;
  projectId: string;
  source: GlobalCanonRecord;
  options?: CopyGlobalCanonOptions;
}): Promise<PersistedProjectCanonCopy> {
  const project = await input.repository.get<NovelProject>("projects", input.projectId);
  if (!project) throw new Error("找不到目標作品，未複製任何全域設定");
  const prepared = prepareGlobalCanonCopy(input.source, input.projectId, input.options);
  const saved = await input.repository.put(
    prepared.targetStore,
    prepared.record,
    0,
  ) as ProjectCanonSnapshot;
  return {
    ...prepared,
    record: saved,
    receipt: {
      ...prepared.receipt,
      targetRecordId: saved.id,
    },
  };
}

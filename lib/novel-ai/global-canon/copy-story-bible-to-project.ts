import type {
  CharacterRelationship,
  DomainRecord,
  NovelProject,
  OptionalValue,
  StoryBible,
} from "../domain";
import { NOVEL_DOMAIN_VERSION } from "../domain";
import type { NovelRepository, NovelStoreName } from "../repository";
import { copyGlobalCanonToProject } from "./copy-to-project";
import type { GlobalCanonRepository } from "./repository";
import {
  cloneGlobalCanonRecord,
  createGlobalCanonId,
  type GlobalCanonRecord,
  type GlobalCanonSourceRef,
  type GlobalCanonStoreName,
  type GlobalStoryBible,
} from "./types";

type TargetStore = Extract<NovelStoreName, "characters" | "relationships" | "worlds" | "worldRules" | "lore" | "timeline">;
type SourceAwareProjectRecord = DomainRecord & Partial<{
  globalCanonSourceRef: GlobalCanonSourceRef;
}>;

const TARGET_BY_GLOBAL: Record<Exclude<GlobalCanonStoreName, "storyBibles">, TargetStore> = {
  characters: "characters",
  relationships: "relationships",
  worlds: "worlds",
  rules: "worldRules",
  memories: "lore",
  timelineTemplates: "timeline",
};

function optionalText(value: string | null, at: string): OptionalValue<string> {
  return {
    value,
    status: value ? "user_defined" : "unset",
    source: value ? "user" : null,
    updatedAt: value ? at : null,
  };
}

function sourceRef(source: GlobalStoryBible, copiedAt: string): GlobalCanonSourceRef {
  return {
    schemaVersion: "global-canon-source-ref-v1",
    globalStore: "storyBibles",
    globalRecordId: source.id,
    globalRevision: source.revision,
    globalUpdatedAt: source.updatedAt,
    sourceProvenance: cloneGlobalCanonRecord(source).provenance,
    copiedAt,
  };
}

function projectRecordBase(projectId: string, id: string, copiedAt: string): DomainRecord {
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
      requestId: `global-story-bible:${id}`,
      createdAt: copiedAt,
    },
    deletedAt: null,
    parentRevision: null,
    migrationVersion: null,
  };
}

async function existingProjectRecordId(input: {
  projectRepository: NovelRepository;
  projectId: string;
  globalStore: Exclude<GlobalCanonStoreName, "storyBibles">;
  targetStore: TargetStore;
  globalRecord: GlobalCanonRecord;
  cache: Map<TargetStore, SourceAwareProjectRecord[]>;
  matches?: (record: SourceAwareProjectRecord) => boolean;
}) {
  let records = input.cache.get(input.targetStore);
  if (!records) {
    records = await input.projectRepository.list<SourceAwareProjectRecord>(input.targetStore, input.projectId);
    input.cache.set(input.targetStore, records);
  }
  return records.find((record) => (
    !record.deletedAt
    && record.projectId === input.projectId
    && record.globalCanonSourceRef?.globalStore === input.globalStore
    && record.globalCanonSourceRef.globalRecordId === input.globalRecord.id
    && record.globalCanonSourceRef.globalRevision === input.globalRecord.revision
    && (input.matches?.(record) ?? true)
  ))?.id ?? null;
}

function sameIds(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * Explicitly copies one complete global Story Bible bundle into a project as
 * a selectable candidate. It copies or reuses referenced snapshots first,
 * but deliberately does not change project.storyBibleId or StoryState.
 */
export async function copyGlobalStoryBibleToProject(input: {
  projectRepository: NovelRepository;
  globalRepository: GlobalCanonRepository;
  projectId: string;
  source: GlobalStoryBible;
  copiedAt?: string;
}) {
  const project = await input.projectRepository.get<NovelProject>("projects", input.projectId);
  if (!project || project.deletedAt) throw new Error("GLOBAL_STORY_BIBLE_TARGET_PROJECT_NOT_FOUND");
  const copiedAt = input.copiedAt ?? new Date().toISOString();
  const projectCache = new Map<TargetStore, SourceAwareProjectRecord[]>();
  const mapped = new Map<string, string>();

  const mappingKey = (store: Exclude<GlobalCanonStoreName, "storyBibles">, id: string) => `${store}:${id}`;
  const preloaded = new Map<string, GlobalCanonRecord>();
  const preload = async (
    globalStore: Exclude<GlobalCanonStoreName, "storyBibles">,
    globalId: string,
  ) => {
    const key = mappingKey(globalStore, globalId);
    const cached = preloaded.get(key);
    if (cached) return cached;
    const record = await input.globalRepository.get(globalStore, globalId);
    if (!record) throw new Error(`GLOBAL_STORY_BIBLE_REFERENCE_MISSING:${globalStore}:${globalId}`);
    preloaded.set(key, record);
    return record;
  };

  const relationshipRecords = await Promise.all(input.source.globalRelationshipIds.map(async (id) => {
    return preload("relationships", id) as Promise<GlobalCanonRecord & {
      fromGlobalCharacterId: string;
      toGlobalCharacterId: string;
    }>;
  }));
  const characterIds = [...new Set([
    ...input.source.protagonistGlobalCharacterIds,
    ...input.source.globalCharacterIds,
    ...relationshipRecords.flatMap((record) => [record.fromGlobalCharacterId, record.toGlobalCharacterId]),
  ])];

  // Resolve the complete bundle before the first project write. A broken
  // reference must not leave half of a Story Bible copied into the project.
  await Promise.all([
    ...characterIds.map((id) => preload("characters", id)),
    ...(input.source.globalWorldId ? [preload("worlds", input.source.globalWorldId)] : []),
    ...input.source.globalWorldRuleIds.map((id) => preload("rules", id)),
    ...input.source.globalMemoryIds.map((id) => preload("memories", id)),
    ...input.source.globalTimelineTemplateIds.map((id) => preload("timelineTemplates", id)),
  ]);

  const copySimple = async (
    globalStore: Exclude<GlobalCanonStoreName, "storyBibles" | "relationships">,
    globalId: string,
  ) => {
    const key = mappingKey(globalStore, globalId);
    if (mapped.has(key)) return mapped.get(key)!;
    const record = preloaded.get(key)!;
    const targetStore = TARGET_BY_GLOBAL[globalStore];
    const existing = await existingProjectRecordId({
      projectRepository: input.projectRepository,
      projectId: input.projectId,
      globalStore,
      targetStore,
      globalRecord: record,
      cache: projectCache,
    });
    if (existing) {
      mapped.set(key, existing);
      return existing;
    }
    const copied = await copyGlobalCanonToProject({
      repository: input.projectRepository,
      projectId: input.projectId,
      source: record,
      options: { copiedAt },
    });
    mapped.set(key, copied.record.id);
    projectCache.delete(targetStore);
    return copied.record.id;
  };

  for (const id of characterIds) await copySimple("characters", id);
  for (const relationship of relationshipRecords) {
    const fromCharacterId = mapped.get(mappingKey("characters", relationship.fromGlobalCharacterId))!;
    const toCharacterId = mapped.get(mappingKey("characters", relationship.toGlobalCharacterId))!;
    const existing = await existingProjectRecordId({
      projectRepository: input.projectRepository,
      projectId: input.projectId,
      globalStore: "relationships",
      targetStore: "relationships",
      globalRecord: relationship,
      cache: projectCache,
      matches: (record) => {
        const candidate = record as SourceAwareProjectRecord & Pick<
          CharacterRelationship,
          "fromCharacterId" | "toCharacterId"
        >;
        return candidate.fromCharacterId === fromCharacterId
          && candidate.toCharacterId === toCharacterId;
      },
    });
    if (existing) {
      mapped.set(mappingKey("relationships", relationship.id), existing);
      continue;
    }
    const copied = await copyGlobalCanonToProject({
      repository: input.projectRepository,
      projectId: input.projectId,
      source: relationship,
      options: {
        copiedAt,
        relationshipCharacterIds: {
          fromCharacterId,
          toCharacterId,
        },
      },
    });
    mapped.set(mappingKey("relationships", relationship.id), copied.record.id);
    projectCache.delete("relationships");
  }

  if (input.source.globalWorldId) await copySimple("worlds", input.source.globalWorldId);
  for (const id of input.source.globalWorldRuleIds) await copySimple("rules", id);
  for (const id of input.source.globalMemoryIds) await copySimple("memories", id);
  for (const id of input.source.globalTimelineTemplateIds) await copySimple("timelineTemplates", id);

  type ProjectStoryBibleCandidate = StoryBible & { globalCanonSourceRef: GlobalCanonSourceRef };
  const protagonistIds = input.source.protagonistGlobalCharacterIds
    .map((globalId) => mapped.get(mappingKey("characters", globalId))!)
    .filter(Boolean);
  const characterIdsForCandidate = input.source.globalCharacterIds
    .map((globalId) => mapped.get(mappingKey("characters", globalId))!)
    .filter(Boolean);
  const relationshipIds = input.source.globalRelationshipIds
    .map((globalId) => mapped.get(mappingKey("relationships", globalId))!)
    .filter(Boolean);
  const worldId = input.source.globalWorldId
    ? mapped.get(mappingKey("worlds", input.source.globalWorldId)) ?? null
    : null;
  const worldRuleIds = input.source.globalWorldRuleIds
    .map((globalId) => mapped.get(mappingKey("rules", globalId))!)
    .filter(Boolean);
  const loreIds = input.source.globalMemoryIds
    .map((globalId) => mapped.get(mappingKey("memories", globalId))!)
    .filter(Boolean);
  const timelineEventIds = input.source.globalTimelineTemplateIds
    .map((globalId) => mapped.get(mappingKey("timelineTemplates", globalId))!)
    .filter(Boolean);
  const existingCandidates = await input.projectRepository.list<ProjectStoryBibleCandidate>("storyBibles", input.projectId);
  const existing = existingCandidates.find((candidate) => (
    !candidate.deletedAt
    && candidate.projectId === input.projectId
    && candidate.globalCanonSourceRef?.globalStore === "storyBibles"
    && candidate.globalCanonSourceRef.globalRecordId === input.source.id
    && candidate.globalCanonSourceRef.globalRevision === input.source.revision
    && candidate.globalCanonSourceRef.globalUpdatedAt === input.source.updatedAt
    && candidate.theme.value === input.source.theme
    && candidate.style.value === input.source.style
    && sameIds(candidate.protagonistIds, protagonistIds)
    && sameIds(candidate.characterIds, characterIdsForCandidate)
    && sameIds(candidate.relationshipIds, relationshipIds)
    && candidate.worldId === worldId
    && sameIds(candidate.worldRuleIds, worldRuleIds)
    && sameIds(candidate.loreIds, loreIds)
    && sameIds(candidate.timelineEventIds, timelineEventIds)
    && sameIds(candidate.foreshadowing, input.source.foreshadowing)
    && sameIds(candidate.unresolvedThreads, input.source.unresolvedThreads)
    && sameIds(candidate.resolvedThreads ?? [], input.source.resolvedThreads)
    && sameIds(candidate.forbiddenContradictions, input.source.forbiddenContradictions)
    && sameIds(candidate.authorPreferences, input.source.authorPreferences)
  )) ?? null;
  if (existing) {
    return {
      schemaVersion: "global-story-bible-copy-receipt-v1" as const,
      projectId: input.projectId,
      storyBibleId: existing.id,
      copiedDependencyCount: mapped.size,
      autoStaged: false as const,
    };
  }

  const id = createGlobalCanonId();
  const candidate: ProjectStoryBibleCandidate = {
    ...projectRecordBase(input.projectId, id, copiedAt),
    theme: optionalText(input.source.theme, copiedAt),
    style: optionalText(input.source.style, copiedAt),
    protagonistIds,
    characterIds: characterIdsForCandidate,
    relationshipIds,
    worldId,
    worldRuleIds,
    loreIds,
    timelineEventIds,
    foreshadowing: [...input.source.foreshadowing],
    unresolvedThreads: [...input.source.unresolvedThreads],
    resolvedThreads: [...input.source.resolvedThreads],
    forbiddenContradictions: [...input.source.forbiddenContradictions],
    authorPreferences: [...input.source.authorPreferences],
    globalCanonSourceRef: sourceRef(input.source, copiedAt),
  };
  const saved = await input.projectRepository.put(
    "storyBibles",
    candidate,
    0,
  );
  return {
    schemaVersion: "global-story-bible-copy-receipt-v1" as const,
    projectId: input.projectId,
    storyBibleId: saved.id,
    copiedDependencyCount: mapped.size,
    autoStaged: false as const,
  };
}

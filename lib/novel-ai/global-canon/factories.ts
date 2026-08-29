import {
  createGlobalCanonBase,
  type GlobalCanonProvenance,
  type GlobalCharacter,
  type GlobalCharacterRelationship,
  type GlobalMemory,
  type GlobalStoryBible,
  type GlobalTimelineTemplate,
  type GlobalWorld,
  type GlobalWorldRule,
} from "./types";

type FactoryMeta = {
  id?: string;
  provenance?: Partial<Omit<GlobalCanonProvenance, "createdAt" | "dataLeftDevice">>;
};

export function createGlobalCharacter(
  input: Pick<GlobalCharacter, "name"> & Partial<Omit<GlobalCharacter, keyof ReturnType<typeof createGlobalCanonBase> | "recordType" | "name">>,
  meta: FactoryMeta = {},
): GlobalCharacter {
  return {
    ...createGlobalCanonBase(meta),
    recordType: "character",
    name: input.name.trim(),
    aliases: [...(input.aliases ?? [])],
    identity: input.identity?.trim() || null,
    personality: input.personality?.trim() || null,
    goal: input.goal?.trim() || null,
    lifeStatus: input.lifeStatus ?? "alive",
    eraContext: input.eraContext ?? "other",
    age: input.age ?? null,
    fears: [...(input.fears ?? [])],
    privateSecrets: [...(input.privateSecrets ?? [])],
    factionIds: [...(input.factionIds ?? [])],
    values: [...(input.values ?? [])],
    capabilities: [...(input.capabilities ?? [])],
    limitations: [...(input.limitations ?? [])],
    abilityProfile: input.abilityProfile ? {
      ...input.abilityProfile,
      stats: { ...input.abilityProfile.stats },
    } : null,
    portrait: input.portrait ?? null,
  };
}

export function createGlobalRelationship(
  input: Pick<GlobalCharacterRelationship, "fromGlobalCharacterId" | "toGlobalCharacterId" | "kind"> & Partial<Pick<GlobalCharacterRelationship, "summary" | "trust">>,
  meta: FactoryMeta = {},
): GlobalCharacterRelationship {
  return {
    ...createGlobalCanonBase(meta),
    recordType: "relationship",
    fromGlobalCharacterId: input.fromGlobalCharacterId,
    toGlobalCharacterId: input.toGlobalCharacterId,
    kind: input.kind.trim(),
    summary: input.summary?.trim() || "",
    trust: input.trust ?? null,
  };
}

export function createGlobalWorld(
  input: Pick<GlobalWorld, "name" | "classificationId" | "classificationLabel" | "eraContext" | "eraLabel"> & Partial<Pick<GlobalWorld, "summary" | "crossEraBridge" | "catalogWorldNumber" | "primaryTopicId" | "compatibleTopicIds">>,
  meta: FactoryMeta = {},
): GlobalWorld {
  const crossEraBridge = input.crossEraBridge?.trim() || null;
  if (input.eraContext === "cross-era" && !crossEraBridge) {
    throw new Error("跨時代世界必須寫明穿越、時間旅行或其他跨時代橋接規則");
  }
  return {
    ...createGlobalCanonBase(meta),
    recordType: "world",
    name: input.name.trim(),
    classificationId: input.classificationId.trim(),
    classificationLabel: input.classificationLabel.trim(),
    eraContext: input.eraContext,
    eraLabel: input.eraLabel.trim(),
    summary: input.summary?.trim() || "",
    crossEraBridge,
    catalogWorldNumber: input.catalogWorldNumber ?? null,
    primaryTopicId: input.primaryTopicId?.trim() || null,
    compatibleTopicIds: [...(input.compatibleTopicIds ?? [])],
  };
}

export function createGlobalWorldRule(
  input: Pick<GlobalWorldRule, "title" | "description"> & Partial<Pick<GlobalWorldRule, "immutable" | "eraContexts" | "appliesToGlobalWorldIds">>,
  meta: FactoryMeta = {},
): GlobalWorldRule {
  return {
    ...createGlobalCanonBase(meta),
    recordType: "rule",
    title: input.title.trim(),
    description: input.description.trim(),
    immutable: input.immutable ?? true,
    eraContexts: [...(input.eraContexts ?? [])],
    appliesToGlobalWorldIds: [...(input.appliesToGlobalWorldIds ?? [])],
  };
}

export function createGlobalMemory(
  input: Pick<GlobalMemory, "kind" | "title" | "content"> & Partial<Pick<GlobalMemory, "eraContexts" | "appliesToGlobalWorldIds">>,
  meta: FactoryMeta = {},
): GlobalMemory {
  return {
    ...createGlobalCanonBase(meta),
    recordType: "memory",
    kind: input.kind,
    title: input.title.trim(),
    content: input.content.trim(),
    eraContexts: [...(input.eraContexts ?? [])],
    appliesToGlobalWorldIds: [...(input.appliesToGlobalWorldIds ?? [])],
  };
}

export function createGlobalTimelineTemplate(
  input: Pick<GlobalTimelineTemplate, "title" | "summary" | "eraContext"> & Partial<Pick<GlobalTimelineTemplate, "storyTime" | "placementHint">>,
  meta: FactoryMeta = {},
): GlobalTimelineTemplate {
  return {
    ...createGlobalCanonBase(meta),
    recordType: "timeline_template",
    title: input.title.trim(),
    storyTime: input.storyTime?.trim() || null,
    summary: input.summary.trim(),
    eraContext: input.eraContext,
    placementHint: input.placementHint?.trim() || null,
  };
}

export function createGlobalStoryBible(
  input: Pick<GlobalStoryBible, "title"> & Partial<Omit<GlobalStoryBible, keyof ReturnType<typeof createGlobalCanonBase> | "recordType" | "title">>,
  meta: FactoryMeta = {},
): GlobalStoryBible {
  return {
    ...createGlobalCanonBase(meta),
    recordType: "story_bible",
    title: input.title.trim(),
    theme: input.theme?.trim() || null,
    style: input.style?.trim() || null,
    protagonistGlobalCharacterIds: [...(input.protagonistGlobalCharacterIds ?? [])],
    globalCharacterIds: [...(input.globalCharacterIds ?? [])],
    globalRelationshipIds: [...(input.globalRelationshipIds ?? [])],
    globalWorldId: input.globalWorldId?.trim() || null,
    globalWorldRuleIds: [...(input.globalWorldRuleIds ?? [])],
    globalMemoryIds: [...(input.globalMemoryIds ?? [])],
    globalTimelineTemplateIds: [...(input.globalTimelineTemplateIds ?? [])],
    foreshadowing: [...(input.foreshadowing ?? [])],
    unresolvedThreads: [...(input.unresolvedThreads ?? [])],
    resolvedThreads: [...(input.resolvedThreads ?? [])],
    forbiddenContradictions: [...(input.forbiddenContradictions ?? [])],
    authorPreferences: [...(input.authorPreferences ?? [])],
  };
}

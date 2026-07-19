import { makeRecord, optionalValue, type ProjectBundle, type ProjectCreationDraft, type ProjectSeed } from "./index";

export function createDraft(mode: ProjectCreationDraft["mode"] = "quick"): ProjectCreationDraft {
  const projectId = crypto.randomUUID();
  return { ...makeRecord(projectId), mode, step: 1, title: "", genrePackId: null, genreId: null, subgenreId: null, coreIdea: optionalValue(), protagonist: optionalValue(), style: optionalValue(), answers: {}, seedCandidate: null };
}

export function buildSeedCandidate(draft: ProjectCreationDraft): ProjectSeed {
  const hero = draft.protagonist.value?.trim() || null;
  const idea = draft.coreIdea.value?.trim() || null;
  return {
    ...makeRecord(draft.projectId, "system"),
    titleCandidates: [draft.title.trim() || "未命名作品"],
    logline: optionalValue(idea, idea ? "user_defined" : "deferred"),
    protagonist: optionalValue(hero, hero ? "user_defined" : "deferred"),
    goal: optionalValue(draft.answers.goal?.value ?? null, draft.answers.goal?.value ? "user_defined" : "deferred"),
    weakness: optionalValue<string>(null, "deferred"),
    world: optionalValue(draft.answers.worldRule?.value ?? null, draft.answers.worldRule?.value ? "user_defined" : "deferred"),
    worldRule: optionalValue(draft.answers.worldRule?.value ?? null, draft.answers.worldRule?.value ? "user_defined" : "deferred"),
    conflict: optionalValue(draft.answers.obstacle?.value ?? null, draft.answers.obstacle?.value ? "user_defined" : "deferred"),
    opposition: optionalValue<string>(null, "deferred"),
    opening: optionalValue(draft.answers.opening?.value ?? null, draft.answers.opening?.value ? "user_defined" : "deferred"),
    directions: [],
  };
}

export function buildProjectBundle(draft: ProjectCreationDraft): ProjectBundle {
  const seed = draft.seedCandidate ?? buildSeedCandidate(draft);
  const projectId = draft.projectId;
  const bibleRecord = makeRecord(projectId);
  const stateRecord = makeRecord(projectId);
  const title = draft.title.trim() || "未命名作品";
  const protagonist = seed.protagonist.value ? { ...makeRecord(projectId), name: seed.protagonist.value, aliases: [] as string[], identity: optionalValue<string>(), personality: optionalValue<string>(), goal: seed.goal, lifeStatus: "unknown" as const, locationId: null } : null;
  const world = seed.world.value ? { ...makeRecord(projectId), name: optionalValue<string>(null, "deferred"), era: optionalValue<string>(null, "deferred"), summary: seed.world } : null;
  const storyBible = { ...bibleRecord, theme: optionalValue<string>(null, "deferred"), style: draft.style, protagonistIds: protagonist ? [protagonist.id] : [], characterIds: protagonist ? [protagonist.id] : [], relationshipIds: [], worldId: world?.id ?? null, worldRuleIds: [], loreIds: [], timelineEventIds: [], foreshadowing: [], unresolvedThreads: [], forbiddenContradictions: [], authorPreferences: [] };
  const storyState = { ...stateRecord, protagonistStats: {}, resources: {}, money: null, inventory: [], relationships: {}, reputation: null, factionStanding: {}, worldFlags: {}, questStates: {}, achievementStates: {}, timeState: null, locationState: null, riskState: null };
  const project = { ...makeRecord(projectId), id: projectId, title, creationMode: draft.mode, genrePackId: draft.genrePackId, genreId: draft.genreId, subgenreId: draft.subgenreId, coreIdea: draft.coreIdea, narrativeStyle: draft.style, adultMode: false, activeChapterId: null, storyBibleId: storyBible.id, storyStateId: storyState.id };
  const initialTask = { ...makeRecord(projectId), title: "寫下第一章", kind: "writing" as const, status: "not_started" as const, progress: 0, target: 1 };
  const readerState = { ...makeRecord(projectId), chapterId: null, scrollTop: 0, percentage: 0, lastReadAt: null };
  const initialBackup = { ...makeRecord(projectId), formatVersion: "novel-backup-v2" as const, kind: "initial" as const, byteSize: 0, snapshot: { project, seed, storyBible, protagonist, world, storyState } };
  initialBackup.byteSize = new TextEncoder().encode(JSON.stringify(initialBackup.snapshot)).byteLength;
  return { project, seed, storyBible, protagonist, world, storyState, initialTask, readerState, initialBackup };
}

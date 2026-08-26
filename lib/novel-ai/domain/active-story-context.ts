import type {
  Character,
  CharacterRelationship,
  LoreEntry,
  StoryBible,
  StoryState,
  TimelineEvent,
  World,
  WorldRule,
} from "./index";

function selectedIds(explicitIds: string[] | undefined, fallbackIds: string[]) {
  return new Set(explicitIds === undefined ? fallbackIds : explicitIds);
}

export function activeStoryCharacters(
  characters: readonly Character[],
  storyState: StoryState | null | undefined,
  storyBible: StoryBible | null | undefined,
) {
  const fallbackIds = storyBible?.characterIds.length
    ? storyBible.characterIds
    : characters.map((character) => character.id);
  const ids = selectedIds(storyState?.activeCharacterIds, fallbackIds);
  for (const protagonistId of storyBible?.protagonistIds ?? []) ids.add(protagonistId);
  return characters.filter((character) => ids.has(character.id));
}

export function activeStoryRelationships(
  relationships: readonly CharacterRelationship[],
  characters: readonly Character[],
) {
  const ids = new Set(characters.map((character) => character.id));
  return relationships.filter((relationship) => (
    ids.has(relationship.fromCharacterId) && ids.has(relationship.toCharacterId)
  ));
}

export function activeStoryWorlds(
  worlds: readonly World[],
  storyState: StoryState | null | undefined,
  storyBible: StoryBible | null | undefined,
) {
  const activeId = storyState?.activeWorldId === undefined
    ? storyBible?.worldId
    : storyState.activeWorldId;
  if (!activeId) return [...worlds];
  return worlds.filter((world) => world.id === activeId);
}

export function activeStoryWorldRules(
  rules: readonly WorldRule[],
  storyState: StoryState | null | undefined,
  storyBible: StoryBible | null | undefined,
) {
  const fallbackIds = storyBible?.worldRuleIds.length
    ? storyBible.worldRuleIds
    : rules.map((rule) => rule.id);
  const ids = selectedIds(storyState?.activeWorldRuleIds, fallbackIds);
  for (const rule of rules) {
    if (rule.immutable) ids.add(rule.id);
  }
  return rules.filter((rule) => ids.has(rule.id));
}

export function activeStoryLore(
  lore: readonly LoreEntry[],
  storyState: StoryState | null | undefined,
  storyBible: StoryBible | null | undefined,
) {
  const fallbackIds = storyBible?.loreIds.length
    ? storyBible.loreIds
    : lore.map((entry) => entry.id);
  const ids = selectedIds(storyState?.activeLoreIds, fallbackIds);
  return lore.filter((entry) => ids.has(entry.id));
}

export function activeStoryTimeline(
  timeline: readonly TimelineEvent[],
  storyState: StoryState | null | undefined,
  storyBible: StoryBible | null | undefined,
) {
  const fallbackIds = storyBible?.timelineEventIds.length
    ? storyBible.timelineEventIds
    : timeline.map((event) => event.id);
  const ids = selectedIds(storyState?.activeTimelineEventIds, fallbackIds);
  return timeline.filter((event) => ids.has(event.id));
}

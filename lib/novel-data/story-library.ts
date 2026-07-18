import raw from "@/data/story-library.json";
import type { StoryLibrary, StoryTopic } from "./story-library-types";

export const STORY_LIBRARY = raw as StoryLibrary;
export const STORY_LIBRARY_SCHEMA_VERSION = STORY_LIBRARY.schemaVersion;

export function storyLibraryStats() {
  const classicTopics = STORY_LIBRARY.topics.filter((topic) => topic.classic && topic.enabled).length;
  const adultTopics = STORY_LIBRARY.topics.filter((topic) => topic.adultOnly && topic.enabled).length;
  return { packs: STORY_LIBRARY.packs.filter((pack) => pack.enabled).length, consumerGroups: STORY_LIBRARY.consumerGroups.filter((group) => group.enabled).length, classicTopics, adultTopics, playModes: STORY_LIBRARY.playModes.filter((mode) => mode.enabled).length, schemaVersion: STORY_LIBRARY.schemaVersion };
}

export function listStoryTopics(options: { groupId?:string; packId?:string; playModeId?:string; query?:string; includeAdult?:boolean; ageConfirmed?:boolean; limit?:number } = {}) {
  const query = options.query?.trim().toLocaleLowerCase("zh-TW");
  return STORY_LIBRARY.topics.filter((topic) => topic.enabled)
    .filter((topic) => !topic.adultOnly || (options.includeAdult && options.ageConfirmed))
    .filter((topic) => !options.groupId || topic.consumerGroupId === options.groupId)
    .filter((topic) => !options.packId || topic.packIds.includes(options.packId))
    .filter((topic) => !options.playModeId || topic.supportedPlayModes.includes(options.playModeId))
    .filter((topic) => !query || [topic.name, topic.description, ...topic.subCategories, ...topic.tags].join(" ").toLocaleLowerCase("zh-TW").includes(query))
    .slice(0, options.limit ?? Number.POSITIVE_INFINITY);
}

export function resolveStoryTopic(value?: string | null): StoryTopic | null {
  if (!value) return null;
  return STORY_LIBRARY.topics.find((topic) => topic.topicId === value || topic.name === value || topic.legacyAliases.includes(value)) ?? null;
}

export function recommendStoryTopics(input: { coreIdea?:string; groupId?:string; playModeId?:string; includeAdult?:boolean; ageConfirmed?:boolean }, limit = 8) {
  const words = (input.coreIdea ?? "").split(/[\s，。！？、；：]+/).filter((word) => word.length > 1);
  const topics = listStoryTopics({ groupId: input.groupId, playModeId: input.playModeId, includeAdult: input.includeAdult, ageConfirmed: input.ageConfirmed });
  return topics.map((topic, index) => ({ topic, score: words.reduce((score, word) => score + ([topic.name, ...topic.tags, ...topic.subCategories].join(" ").includes(word) ? 10 : 0), 0) - index / 1000 }))
    .sort((a, b) => b.score - a.score).slice(0, limit).map((result) => result.topic);
}

export function randomStoryTopic(options: Parameters<typeof listStoryTopics>[0] = {}) {
  const topics = listStoryTopics(options);
  if (!topics.length) return null;
  return topics[Math.floor(Math.random() * topics.length)];
}

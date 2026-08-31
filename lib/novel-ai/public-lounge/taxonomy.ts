import rawStoryLibrary from "../../../data/story-library.json" with { type: "json" };
import type { StoryLibrary, StoryTopic } from "../../novel-data/story-library-types";

const STORY_LIBRARY = rawStoryLibrary as StoryLibrary;
const STORY_LIBRARY_SCHEMA_VERSION = STORY_LIBRARY.schemaVersion;

export const PUBLIC_LOUNGE_MAX_TOPIC_TAGS = 3;

export type PublicLoungeShelf = Readonly<{
  shelfId: string;
  name: string;
  description: string;
  order: number;
}>;

export type PublicLoungeTopic = Readonly<{
  topicId: string;
  name: string;
  shelfId: string;
}>;

export type PublicLoungeTopicIds =
  | readonly [string]
  | readonly [string, string]
  | readonly [string, string, string];

export type PublicLoungeTaxonomySelection = Readonly<{
  storyLibrarySchemaVersion: string;
  shelfId: string;
  primaryTopicId: string;
  topicIds: PublicLoungeTopicIds;
}>;

export type PublicLoungeLegacyCategoryMigration =
  | Readonly<{
      status: "migrated";
      sourceCategory: string;
      matchedBy: "topicId" | "name" | "legacyAlias";
      selection: PublicLoungeTaxonomySelection;
    }>
  | Readonly<{
      status: "unmapped";
      sourceCategory: string | null;
      reason: "empty" | "unknown" | "ineligible" | "ambiguous";
    }>;

export type PublicLoungeTaxonomyErrorCode =
  | "PUBLIC_LOUNGE_TAXONOMY_INVARIANT"
  | "PUBLIC_LOUNGE_TOPIC_IDS_INVALID"
  | "PUBLIC_LOUNGE_TOPIC_COUNT_INVALID"
  | "PUBLIC_LOUNGE_TOPIC_DUPLICATE"
  | "PUBLIC_LOUNGE_TOPIC_NOT_PUBLIC"
  | "PUBLIC_LOUNGE_SHELF_NOT_PUBLIC";

export class PublicLoungeTaxonomyError extends Error {
  readonly code: PublicLoungeTaxonomyErrorCode;

  constructor(code: PublicLoungeTaxonomyErrorCode) {
    super(code);
    this.name = "PublicLoungeTaxonomyError";
    this.code = code;
  }
}

const ALL_TOPICS_BY_ID = new Map(
  STORY_LIBRARY.topics.map((topic) => [topic.topicId, topic] as const),
);
const PUBLIC_LOUNGE_SHELVES = Object.freeze(STORY_LIBRARY.consumerGroups
  .filter((group) => group.enabled)
  .sort((left, right) => left.order - right.order)
  .map((group) => Object.freeze({
    shelfId: group.groupId,
    name: group.name,
    description: group.description,
    order: group.order,
  })));
const PUBLIC_LOUNGE_SHELVES_BY_ID = new Map(
  PUBLIC_LOUNGE_SHELVES.map((shelf) => [shelf.shelfId, shelf] as const),
);
const CLASSIC_TOPICS = STORY_LIBRARY.topics.filter((topic) => topic.classic && !topic.adultOnly);
const PUBLIC_LOUNGE_TOPICS = Object.freeze(CLASSIC_TOPICS
  .filter((topic) => topic.enabled)
  .map((topic) => Object.freeze({
    topicId: topic.topicId,
    name: topic.name,
    shelfId: topic.consumerGroupId,
  })));
const PUBLIC_LOUNGE_TOPICS_BY_ID = new Map(
  PUBLIC_LOUNGE_TOPICS.map((topic) => [topic.topicId, topic] as const),
);

if (PUBLIC_LOUNGE_SHELVES.length !== 8 || CLASSIC_TOPICS.filter((topic) => topic.enabled).length !== 218) {
  throw new PublicLoungeTaxonomyError("PUBLIC_LOUNGE_TAXONOMY_INVARIANT");
}

function isPublicTopic(topic: StoryTopic | undefined): topic is StoryTopic {
  return Boolean(topic?.enabled && topic.classic && !topic.adultOnly);
}

function publicTopicById(topicId: string) {
  const topic = ALL_TOPICS_BY_ID.get(topicId);
  if (!isPublicTopic(topic)) {
    throw new PublicLoungeTaxonomyError("PUBLIC_LOUNGE_TOPIC_NOT_PUBLIC");
  }
  return topic;
}

export function listPublicLoungeShelves(): readonly PublicLoungeShelf[] {
  return PUBLIC_LOUNGE_SHELVES;
}

export function listPublicLoungeTopics(): readonly PublicLoungeTopic[] {
  return PUBLIC_LOUNGE_TOPICS;
}

export function isPublicLoungeShelfId(value: unknown): value is string {
  return typeof value === "string" && PUBLIC_LOUNGE_SHELVES_BY_ID.has(value);
}

export function publicLoungeShelfDisplayName(shelfId: string | null): string {
  return shelfId ? PUBLIC_LOUNGE_SHELVES_BY_ID.get(shelfId)?.name ?? "舊版未分類書架" : "舊版未分類書架";
}

export function publicLoungeTopicNames(topicIds: readonly string[]): string[] {
  return topicIds.map((topicId) => {
    const topic = PUBLIC_LOUNGE_TOPICS_BY_ID.get(topicId);
    if (!topic) throw new PublicLoungeTaxonomyError("PUBLIC_LOUNGE_TOPIC_NOT_PUBLIC");
    return topic.name;
  });
}

export function publicLoungeTopicDisplayNames(topicIds: readonly string[]): string[] {
  return topicIds.length ? publicLoungeTopicNames(topicIds) : ["舊版未分類"];
}

export function normalizePublicLoungeTopicIds(value: unknown): PublicLoungeTaxonomySelection {
  if (!Array.isArray(value) || value.some((topicId) => typeof topicId !== "string")) {
    throw new PublicLoungeTaxonomyError("PUBLIC_LOUNGE_TOPIC_IDS_INVALID");
  }
  if (value.length < 1 || value.length > PUBLIC_LOUNGE_MAX_TOPIC_TAGS) {
    throw new PublicLoungeTaxonomyError("PUBLIC_LOUNGE_TOPIC_COUNT_INVALID");
  }

  const topicIds = value.map((topicId) => topicId.trim());
  if (topicIds.some((topicId) => !topicId)) {
    throw new PublicLoungeTaxonomyError("PUBLIC_LOUNGE_TOPIC_IDS_INVALID");
  }
  if (new Set(topicIds).size !== topicIds.length) {
    throw new PublicLoungeTaxonomyError("PUBLIC_LOUNGE_TOPIC_DUPLICATE");
  }

  const primaryTopic = publicTopicById(topicIds[0]!);
  for (const topicId of topicIds.slice(1)) publicTopicById(topicId);
  if (!PUBLIC_LOUNGE_SHELVES_BY_ID.has(primaryTopic.consumerGroupId)) {
    throw new PublicLoungeTaxonomyError("PUBLIC_LOUNGE_SHELF_NOT_PUBLIC");
  }

  return Object.freeze({
    storyLibrarySchemaVersion: STORY_LIBRARY_SCHEMA_VERSION,
    shelfId: primaryTopic.consumerGroupId,
    primaryTopicId: primaryTopic.topicId,
    topicIds: Object.freeze([...topicIds]) as unknown as PublicLoungeTopicIds,
  });
}

export function migrateLegacyPublicLoungeCategory(value: unknown): PublicLoungeLegacyCategoryMigration {
  const sourceCategory = typeof value === "string" ? value.trim() : "";
  if (!sourceCategory) {
    return Object.freeze({ status: "unmapped", sourceCategory: null, reason: "empty" });
  }

  const matchedById = STORY_LIBRARY.topics.filter((topic) => topic.topicId === sourceCategory);
  const matchedByName = matchedById.length
    ? []
    : STORY_LIBRARY.topics.filter((topic) => topic.name === sourceCategory);
  const matchedByAlias = matchedById.length || matchedByName.length
    ? []
    : STORY_LIBRARY.topics.filter((topic) => topic.legacyAliases.includes(sourceCategory));
  const matches = matchedById.length ? matchedById : matchedByName.length ? matchedByName : matchedByAlias;

  if (matches.length > 1) {
    return Object.freeze({ status: "unmapped", sourceCategory, reason: "ambiguous" });
  }
  const topic = matches[0];

  if (!topic) {
    return Object.freeze({ status: "unmapped", sourceCategory, reason: "unknown" });
  }
  if (!isPublicTopic(topic)) {
    return Object.freeze({ status: "unmapped", sourceCategory, reason: "ineligible" });
  }

  return Object.freeze({
    status: "migrated",
    sourceCategory,
    matchedBy: matchedById.length ? "topicId" : matchedByName.length ? "name" : "legacyAlias",
    selection: normalizePublicLoungeTopicIds([topic.topicId]),
  });
}

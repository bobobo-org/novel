import { resolveStoryTopic, STORY_LIBRARY_SCHEMA_VERSION } from "./story-library";
import { blankOptional, setOptional, type OptionalField } from "./story-library-types";

export type MigratedStorySelection = { storyLibrarySchemaVersion:string; consumerGroupId:string|null; packId:string|null; topicId:string|null; topicName:string|null; selectedPlayModeId:string|null; adultMode:false; enabledStats:string[]; coreIdea:OptionalField; migrationWarnings:string[] };

export function migrateStorySelection(input: Record<string, unknown> = {}): MigratedStorySelection {
  const legacyTopic = String(input.topicId ?? input.genre ?? input.theme ?? input.topicName ?? "").trim();
  const topic = resolveStoryTopic(legacyTopic);
  const coreIdea = String(input.coreIdea ?? input.synopsis ?? "").trim();
  return {
    storyLibrarySchemaVersion: STORY_LIBRARY_SCHEMA_VERSION,
    consumerGroupId: String(input.consumerGroupId ?? topic?.consumerGroupId ?? "") || null,
    packId: String(input.packId ?? topic?.packId ?? "") || null,
    topicId: topic?.topicId ?? null,
    topicName: topic?.name ?? (legacyTopic || null),
    selectedPlayModeId: String(input.selectedPlayModeId ?? input.playModeId ?? "") || null,
    adultMode: false,
    enabledStats: Array.isArray(input.enabledStats) ? input.enabledStats.map(String) : [],
    coreIdea: coreIdea ? setOptional(coreIdea, "user_defined", "migration") : blankOptional("unset"),
    migrationWarnings: legacyTopic && !topic ? [`舊題材「${legacyTopic}」未對應正式 ID，已保留原文字。`] : [],
  };
}

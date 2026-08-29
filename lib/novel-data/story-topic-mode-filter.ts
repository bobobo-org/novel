import type { StoryTopic } from "./story-library-types";

export type StoryTopicModeFilter = "all" | "native";

export type StoryTopicPlayFit = "unselected" | "direct" | "adapted";

export function hasNativeStoryPlayMode(topic: Pick<StoryTopic, "supportedPlayModes">) {
  return topic.supportedPlayModes.some((mode) => mode.trim().length > 0);
}

/**
 * Browsing by native play mode never chooses a mode for the author.
 * Before a mode is selected, it only removes malformed topics that have no
 * native play-mode link. Once the author selects a mode, it becomes a real
 * compatibility filter for that exact mode.
 */
export function filterStoryTopicsByPlayMode<T extends Pick<StoryTopic, "supportedPlayModes">>(
  topics: readonly T[],
  modeFilter: StoryTopicModeFilter,
  activePlayMode: string | null,
) {
  if (modeFilter === "all") return [...topics];
  return topics.filter((topic) => activePlayMode
    ? topic.supportedPlayModes.includes(activePlayMode)
    : hasNativeStoryPlayMode(topic));
}

export function storyTopicPlayFit(
  topic: Pick<StoryTopic, "supportedPlayModes">,
  activePlayMode: string | null,
): StoryTopicPlayFit {
  if (!activePlayMode) return "unselected";
  return topic.supportedPlayModes.includes(activePlayMode) ? "direct" : "adapted";
}

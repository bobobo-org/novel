import type { StoryState } from "./index";

export const STORY_PLAY_MODE_IDS = [
  "general",
  "interactive",
  "rpg",
  "romance",
  "management",
] as const;

export type StoryPlayModeId = (typeof STORY_PLAY_MODE_IDS)[number];

export const STORY_PLAY_MODE_LABELS: Record<StoryPlayModeId, string> = {
  general: "一般章節寫作",
  interactive: "三選一互動",
  rpg: "RPG 養成",
  romance: "戀愛養成",
  management: "經營模擬",
};

export function isStoryPlayModeId(value: unknown): value is StoryPlayModeId {
  return typeof value === "string"
    && (STORY_PLAY_MODE_IDS as readonly string[]).includes(value);
}

export function selectedStoryPlayMode(
  answers: Record<string, { value?: string | null }> | null | undefined,
): StoryPlayModeId | null {
  const value = answers?.playMode?.value;
  return isStoryPlayModeId(value) ? value : null;
}

function hasGameState(state: StoryState) {
  const flags = state.worldFlags ?? {};
  return Object.keys(state.protagonistStats).some((key) => key.startsWith("rpg."))
    || Object.keys(state.resources).some((key) =>
      key.startsWith("rpg.")
      || key.startsWith("game.")
      || key.startsWith("management."))
    || flags["rpg.initialized"] === true
    || flags["game.initialized"] === true;
}

/**
 * Existing projects created before the play-mode lock did not carry a mode.
 * They are inferred once from durable StoryState; new projects always use the
 * explicit immutable flag written by buildProjectBundle.
 */
export function resolveStoryPlayMode(state: StoryState): StoryPlayModeId {
  const flags = state.worldFlags ?? {};
  const explicit = flags["story.playMode"];
  if (isStoryPlayModeId(explicit)) return explicit;
  const legacyRpgMode = flags["rpg.lastMode"];
  if (legacyRpgMode === "management") return "management";
  if (legacyRpgMode === "cultivation") return "romance";
  if (legacyRpgMode === "adventure") return "rpg";
  if (hasGameState(state)) {
    return flags["management.lastSettlement"] !== undefined
      || Object.keys(state.questStates).some((key) => key.startsWith("management."))
      ? "management"
      : "rpg";
  }
  return "general";
}

export function isGameStoryPlayMode(mode: StoryPlayModeId) {
  return mode !== "general";
}

export function storyPlayModeDashboardHref(projectId: string, mode: StoryPlayModeId) {
  const storyWorkspace = `/studio/project/${encodeURIComponent(projectId)}/chat`;
  return mode === "general" ? storyWorkspace : `${storyWorkspace}?mode=play`;
}

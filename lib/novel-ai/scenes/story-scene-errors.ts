export type StorySceneErrorCode =
  | "STORY_SCENE_PROFILE_NOT_FOUND"
  | "STORY_STAGE_TEMPLATE_NOT_FOUND"
  | "STORY_TOPIC_CONTRACT_NOT_FOUND"
  | "STORY_PROVIDER_POLICY_BLOCKED"
  | "STORY_SCENE_CONTRACT_INVALID";

export class StorySceneError extends Error {
  readonly code: StorySceneErrorCode;
  readonly details?: unknown;

  constructor(code: StorySceneErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = code;
    this.code = code;
    this.details = details;
  }
}

export function storySceneError(code: StorySceneErrorCode, message: string, details?: unknown) {
  return new StorySceneError(code, message, details);
}

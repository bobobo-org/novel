export type StoryGenerationErrorCode =
  | "STORY_GENERATION_PROVIDER_UNAVAILABLE"
  | "STORY_GENERATION_POLICY_BLOCKED"
  | "STORY_GENERATION_INVALID_CONTEXT"
  | "STORY_GENERATION_INVALID_OUTPUT"
  | "STORY_GENERATION_STAGE_NOT_FOUND";

export class StoryGenerationError extends Error {
  readonly code: StoryGenerationErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: StoryGenerationErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = code;
    this.code = code;
    this.details = details;
  }
}

export function storyGenerationError(code: StoryGenerationErrorCode, message: string, details?: Record<string, unknown>) {
  return new StoryGenerationError(code, message, details);
}

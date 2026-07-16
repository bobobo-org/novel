import { storyGenerationError } from "./story-generation-errors";
import type { StoryStageContext, StoryStageGenerationOutput } from "./story-stage-context";

export function validateStoryStageContext(context: StoryStageContext) {
  if (!context.projectId || !context.sceneId || !context.stageId) {
    throw storyGenerationError("STORY_GENERATION_INVALID_CONTEXT", "Project, scene, and stage IDs are required.");
  }
  if (!context.stageType) throw storyGenerationError("STORY_GENERATION_STAGE_NOT_FOUND", "Stage type is required.");
}

export function validateStoryStageOutput(output: StoryStageGenerationOutput) {
  if (!output.draftText.trim()) throw storyGenerationError("STORY_GENERATION_INVALID_OUTPUT", "Generated draft text is empty.");
  if (output.externalRequestCount !== 0 || output.dataLeftDevice !== false) {
    throw storyGenerationError("STORY_GENERATION_INVALID_OUTPUT", "Local stage generation must not use external requests.");
  }
  return { ok: true, warnings: output.warnings ?? [] };
}

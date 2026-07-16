import { StoryStageGenerator } from "./story-stage-generator";
import type { StoryStageContext, StoryStageGenerationOptions } from "./story-stage-context";

const generator = new StoryStageGenerator();

export function extendStage(context: StoryStageContext, options: StoryStageGenerationOptions = {}) {
  return generator.run("extendStage", context, { ...options, instruction: "Extend with concrete action, continuity, and consequence." });
}

export function increaseDetail(context: StoryStageContext, options: StoryStageGenerationOptions = {}) {
  return generator.run("increaseDetail", context, { ...options, instruction: "Increase useful details without adding unsupported canon." });
}

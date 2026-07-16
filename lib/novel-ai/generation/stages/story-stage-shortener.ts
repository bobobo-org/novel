import { StoryStageGenerator } from "./story-stage-generator";
import type { StoryStageContext, StoryStageGenerationOptions } from "./story-stage-context";

const generator = new StoryStageGenerator();

export function shortenStage(context: StoryStageContext, options: StoryStageGenerationOptions = {}) {
  return generator.run("shortenStage", context, { ...options, instruction: "Shorten while preserving outcome and continuity." });
}

export function decreaseDetail(context: StoryStageContext, options: StoryStageGenerationOptions = {}) {
  return generator.run("decreaseDetail", context, { ...options, instruction: "Remove excess detail while keeping causality clear." });
}

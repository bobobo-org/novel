import { StoryStageGenerator } from "./story-stage-generator";
import type { StoryStageContext, StoryStageGenerationOptions } from "./story-stage-context";

const generator = new StoryStageGenerator();

export function splitStage(context: StoryStageContext, instruction = "Split this stage into two coherent sub-beats.", options: StoryStageGenerationOptions = {}) {
  return generator.run("splitStage", context, { ...options, instruction });
}

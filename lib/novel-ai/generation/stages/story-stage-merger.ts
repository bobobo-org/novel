import { StoryStageGenerator } from "./story-stage-generator";
import type { StoryStageContext, StoryStageGenerationOptions } from "./story-stage-context";

const generator = new StoryStageGenerator();

export function mergeStages(context: StoryStageContext, instruction = "Merge selected stage material into one coherent stage draft.", options: StoryStageGenerationOptions = {}) {
  return generator.run("mergeStages", context, { ...options, instruction });
}

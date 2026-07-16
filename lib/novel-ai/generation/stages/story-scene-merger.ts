import { StoryStageGenerator } from "./story-stage-generator";
import type { StoryStageContext, StoryStageGenerationOptions } from "./story-stage-context";

const generator = new StoryStageGenerator();

export function mergeWholeScene(context: StoryStageContext, instruction = "Merge all accepted stage material into a whole-scene draft.", options: StoryStageGenerationOptions = {}) {
  return generator.run("mergeWholeScene", context, { ...options, instruction });
}

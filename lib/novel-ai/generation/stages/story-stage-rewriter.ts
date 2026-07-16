import { StoryStageGenerator } from "./story-stage-generator";
import type { StoryStageContext, StoryStageGenerationOptions, StoryStageOperation } from "./story-stage-context";

const generator = new StoryStageGenerator();

export function rewriteStage(context: StoryStageContext, instruction: string, options: StoryStageGenerationOptions = {}) {
  return generator.run("rewriteStage", context, { ...options, instruction });
}

export function changeTone(context: StoryStageContext, tone: string, options: StoryStageGenerationOptions = {}) {
  return generator.run("changeTone", { ...context, tone }, { ...options, instruction: `Change tone to ${tone}.` });
}

export function changePerspective(context: StoryStageContext, perspective: string, options: StoryStageGenerationOptions = {}) {
  return generator.run("changePerspective", { ...context, perspective }, { ...options, instruction: `Change perspective to ${perspective}.` });
}

export function changePacing(context: StoryStageContext, pacing: string, options: StoryStageGenerationOptions = {}) {
  return generator.run("changePacing", context, { ...options, instruction: `Change pacing to ${pacing}.` });
}

export function runStageTransform(operation: StoryStageOperation, context: StoryStageContext, instruction: string, options: StoryStageGenerationOptions = {}) {
  return generator.run(operation, context, { ...options, instruction });
}

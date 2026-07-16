import type { StoryStageGenerationOutput } from "./story-stage-context";

export function applyAdultContinuityExtension(output: StoryStageGenerationOutput) {
  return {
    trustState: output.continuityChanges.trustState ?? {},
    attractionState: output.continuityChanges.attractionState ?? {},
    consentState: output.continuityChanges.consentState ?? "active",
    withdrawalState: output.continuityChanges.withdrawalState ?? "none",
    boundaryChanges: output.continuityChanges.boundaryChanges ?? [],
  };
}

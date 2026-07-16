import type { StoryStageGenerationOutput } from "./story-stage-context";

export function extractAdultConsequenceExtension(output: StoryStageGenerationOutput) {
  return {
    trustDelta: output.continuityChanges.trustDelta ?? null,
    attractionDelta: output.continuityChanges.attractionDelta ?? null,
    resentmentDelta: output.continuityChanges.resentmentDelta ?? null,
    dependenceDelta: output.continuityChanges.dependenceDelta ?? null,
    secrecyDelta: output.continuityChanges.secrecyDelta ?? null,
    publicRiskDelta: output.continuityChanges.publicRiskDelta ?? null,
    powerBalanceDelta: output.continuityChanges.powerBalanceDelta ?? null,
    emotionalBondDelta: output.continuityChanges.emotionalBondDelta ?? null,
    boundaryChanges: output.continuityChanges.boundaryChanges ?? [],
  };
}

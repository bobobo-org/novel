import type { StoryStageContext, StoryStageGenerationOutput } from "./story-stage-context";

export function extractStoryConsequenceCandidate(context: StoryStageContext, output: StoryStageGenerationOutput) {
  return {
    candidateType: "stage_consequence",
    status: "candidate",
    plotStateDelta: output.plotProgress,
    characterGoalDelta: output.characterStateChanges,
    relationshipDelta: output.relationshipChanges,
    conflictDelta: output.continuityChanges.conflictState ?? "unknown",
    resourceDelta: output.continuityChanges.resourceDelta ?? [],
    factionDelta: output.continuityChanges.factionDelta ?? [],
    knowledgeDelta: output.newlyIntroducedFacts,
    unresolvedConsequences: output.unresolvedActions,
    trustDelta: output.continuityChanges.trustDelta ?? null,
    attractionDelta: output.continuityChanges.attractionDelta ?? null,
    resentmentDelta: output.continuityChanges.resentmentDelta ?? null,
    dependenceDelta: output.continuityChanges.dependenceDelta ?? null,
    secrecyDelta: output.continuityChanges.secrecyDelta ?? null,
    publicRiskDelta: output.continuityChanges.publicRiskDelta ?? null,
    powerBalanceDelta: output.continuityChanges.powerBalanceDelta ?? null,
    emotionalBondDelta: output.continuityChanges.emotionalBondDelta ?? null,
    boundaryChanges: output.continuityChanges.boundaryChanges ?? [],
    source: { projectId: context.projectId, sceneId: context.sceneId, stageId: context.stageId },
  };
}

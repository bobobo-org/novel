import type { StoryStageContext, StoryStageGenerationOutput } from "./story-stage-context";

export function updateStoryContinuity(context: StoryStageContext, output: StoryStageGenerationOutput) {
  return {
    participantPositions: output.continuityChanges.participantPositions ?? context.continuityState?.participantPositions ?? {},
    participantEmotions: output.continuityChanges.participantEmotions ?? {},
    relationshipState: output.continuityChanges.relationshipState ?? context.relationshipState ?? {},
    trustState: output.continuityChanges.trustState ?? {},
    attractionState: output.continuityChanges.attractionState ?? {},
    conflictState: output.continuityChanges.conflictState ?? context.continuityState?.conflictState ?? "developing",
    objectState: output.continuityChanges.objectState ?? {},
    clothingState: output.continuityChanges.clothingState ?? {},
    locationState: output.continuityChanges.locationState ?? context.continuityState?.locationState ?? "unspecified",
    timeState: output.continuityChanges.timeState ?? context.continuityState?.timeState ?? "unspecified",
    completedActions: [output.stageSummary],
    unresolvedActions: output.unresolvedActions,
    dialogueCommitments: output.continuityChanges.dialogueCommitments ?? [],
    forbiddenRepetitions: output.continuityChanges.forbiddenRepetitions ?? [],
    requiredNextBeat: output.nextStageRequirements[0] ?? context.requiredNextBeat ?? "",
    consentState: context.policy?.consentState ?? "unspecified",
    withdrawalState: context.policy?.withdrawalState ?? "none",
    narrativePurposeProgress: output.plotProgress,
  };
}

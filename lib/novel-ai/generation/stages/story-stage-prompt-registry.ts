import { buildStageTemplate } from "../../scenes/story-stage-template";
import { normalizeProfileId, type StoryStageContext, type StoryStageOperation } from "./story-stage-context";

export const STORY_STAGE_PROMPT_REGISTRY_VERSION = "story-stage-prompts-h2p4-v1";

const operationGuidance: Record<StoryStageOperation, string> = {
  planStages: "Plan the stage as a concrete beat without writing the whole scene.",
  generateStage: "Write this single stage as polished prose.",
  regenerateStage: "Regenerate this single stage with a fresh approach while preserving continuity.",
  rewriteStage: "Rewrite this single stage according to the instruction.",
  extendStage: "Extend the current stage with more concrete action and sensory continuity.",
  shortenStage: "Shorten the current stage while preserving outcome and continuity.",
  changeTone: "Change the tone without changing canonical outcome.",
  changePerspective: "Change narrative perspective without changing known facts.",
  changePacing: "Adjust pacing while preserving required events.",
  increaseDetail: "Add meaningful scene detail without introducing unsupported facts.",
  decreaseDetail: "Reduce excessive detail while preserving causality.",
  splitStage: "Split the stage into two coherent parts and return the most useful draftText.",
  mergeStages: "Merge adjacent stage material into one coherent stage.",
  branchFromStage: "Create an alternate branch candidate, preserving branch isolation.",
  rollbackStage: "Restore a prior stage direction as a new version.",
  mergeWholeScene: "Help merge stage content into the whole scene while avoiding duplicate headings.",
};

export function buildStoryStagePrompt(context: StoryStageContext, operation: StoryStageOperation, instruction = "") {
  const profileId = normalizeProfileId(context.profileId);
  const template = buildStageTemplate(profileId);
  const stageGoal = context.stageGoal || template.stageGoals[context.stageType] || `Write ${context.stageType}`;
  const payload = {
    contractVersion: STORY_STAGE_PROMPT_REGISTRY_VERSION,
    operation,
    operationGuidance: operationGuidance[operation],
    sceneProfile: profileId,
    stageTemplateId: template.templateId,
    stageTypes: template.stageTypes,
    currentStage: {
      stageId: context.stageId,
      stageType: context.stageType,
      goal: stageGoal,
      targetLength: context.targetLength ?? 220,
      tone: context.tone ?? "clear, grounded, story-forward",
      perspective: context.perspective ?? "third-person limited",
    },
    storyContext: {
      classificationPackId: context.classificationPackId,
      topicId: context.topicId,
      storyEngineId: context.storyEngineId,
      previousStageSummary: context.previousStageSummary ?? "",
      continuityState: context.continuityState ?? {},
      characterCanonical: context.characterCanonical ?? [],
      relationshipState: context.relationshipState ?? {},
      requiredEvents: context.requiredEvents ?? [],
      forbiddenEvents: context.forbiddenEvents ?? [],
      requiredNextBeat: context.requiredNextBeat ?? "",
      narrativePurpose: context.narrativePurpose ?? "",
    },
    instruction,
  };
  return [
    "You are a local-only long-form fiction stage generator.",
    "Return JSON only. No markdown. Do not write a whole chapter; write only the requested stage.",
    "Do not invent canonical facts beyond the provided context. Put uncertain facts in possibleCandidates.",
    "The JSON object must contain: draftText, stageSummary, continuityChanges, characterStateChanges, relationshipChanges, plotProgress, newlyIntroducedFacts, possibleCandidates, unresolvedActions, nextStageRequirements, warnings, usedContextIds.",
    JSON.stringify(payload),
  ].join("\n");
}

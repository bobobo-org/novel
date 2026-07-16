import { buildStageTemplate } from "../../scenes/story-stage-template";
import { normalizeProfileId, type StoryStageContext } from "./story-stage-context";

export function planStages(context: Pick<StoryStageContext, "profileId" | "projectId" | "sceneId" | "branchId">) {
  const profileId = normalizeProfileId(context.profileId);
  const template = buildStageTemplate(profileId);
  return template.stageTypes.map((stageType, index) => ({
    projectId: context.projectId,
    sceneId: context.sceneId,
    branchId: context.branchId ?? "main",
    stageId: `${context.sceneId}_${stageType}_${index + 1}`,
    profileId,
    stageType,
    stageGoal: template.stageGoals[stageType] ?? `Write ${stageType}`,
    ordinal: index + 1,
    required: template.dependencyRules[index]?.required ?? true,
    skippable: template.dependencyRules[index]?.skippable ?? false,
  }));
}

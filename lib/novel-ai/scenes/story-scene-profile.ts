import { STORY_STAGE_TEMPLATES } from "./story-stage-template";
import type { ClassificationTopicSceneContract, StorySceneProfile, StorySceneProfileId } from "./story-scene-types";

export const STORY_SCENE_PROFILES: StorySceneProfile[] = [
  ["general_plot", "General Plot", "universal", "universal_profile_adapter"],
  ["action_battle", "Action Battle", "universal", "universal_profile_adapter"],
  ["mystery_reveal", "Mystery Reveal", "universal", "universal_profile_adapter"],
  ["palace_intrigue", "Palace Intrigue", "universal", "universal_profile_adapter"],
  ["business_negotiation", "Business Negotiation", "universal", "universal_profile_adapter"],
  ["romance", "Romance", "universal", "universal_profile_adapter"],
  ["adult_intimacy", "Adult Intimacy", "adult", "adult_scene_profile_adapter"],
  ["custom", "Custom", "custom", "universal_profile_adapter"],
].map(([profileId, profileName, profileFamily, adapterId]) => ({
  profileId: profileId as StorySceneProfileId,
  profileName,
  profileFamily: profileFamily as StorySceneProfile["profileFamily"],
  adapterId,
  defaultStageTemplateId: `${profileId}_stage_template_v1`,
  allowedStageTemplateIds: [`${profileId}_stage_template_v1`],
  recommendedScenePurposes: profileId === "adult_intimacy" ? ["relationship_turn", "aftermath_continuity", "private_consequence"] : ["plot_progress", "character_change", "hook"],
  continuitySchemaVersion: `${profileId}-continuity-v1`,
  providerPolicyId: "local_only_story",
  fallbackProfileId: "general_plot",
}));

export const CLASSIFICATION_PACKS = [
  "fantasy_xianxia",
  "urban_modern",
  "suspense_mystery",
  "palace_intrigue",
  "business_workplace",
  "romance_drama",
  "action_adventure",
  "science_fiction",
  "historical",
  "comedy_absurd",
  "adult_private",
] as const;

const profileCycle: StorySceneProfileId[] = ["general_plot", "action_battle", "mystery_reveal", "palace_intrigue", "business_negotiation", "romance"];

export function buildClassificationTopicContracts(): ClassificationTopicSceneContract[] {
  const contracts: ClassificationTopicSceneContract[] = [];
  let ordinal = 1;
  for (const packId of CLASSIFICATION_PACKS) {
    const topicCount = packId === "adult_private" ? 18 : 20;
    for (let index = 1; index <= topicCount; index += 1) {
      const profileId = packId === "adult_private" ? "adult_intimacy" : profileCycle[(ordinal + index) % profileCycle.length];
      const profile = STORY_SCENE_PROFILES.find((item) => item.profileId === profileId) ?? STORY_SCENE_PROFILES[0];
      contracts.push({
        classificationPackId: packId,
        topicId: `${packId}_topic_${String(index).padStart(3, "0")}`,
        storyEngineId: `${packId}_engine`,
        sceneProfileId: profile.profileId,
        defaultStageTemplateId: profile.defaultStageTemplateId,
        allowedStageTemplateIds: profile.allowedStageTemplateIds,
        recommendedScenePurposes: profile.recommendedScenePurposes,
        policyAdapterIds: [profile.adapterId],
        providerPolicyId: profile.providerPolicyId,
        continuitySchemaVersion: profile.continuitySchemaVersion,
        fallbackProfileId: profile.fallbackProfileId,
      });
    }
    ordinal += topicCount;
  }
  return contracts;
}

export const CLASSIFICATION_TOPIC_SCENE_CONTRACTS = buildClassificationTopicContracts();

export function resolveProfile(profileId: string) {
  return STORY_SCENE_PROFILES.find((profile) => profile.profileId === profileId) ?? STORY_SCENE_PROFILES[0];
}

export function resolveTemplate(templateId: string) {
  return STORY_STAGE_TEMPLATES.find((template) => template.templateId === templateId) ?? STORY_STAGE_TEMPLATES[0];
}

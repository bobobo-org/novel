export const UNIVERSAL_SCENE_ENGINE_VERSION = "h2p3a-universal-scene-compatibility-v1";
export const UNIVERSAL_SCENE_MIGRATION_VERSION = "017_universal_story_scene_profiles";

export const STORY_SCENE_PROFILE_IDS = [
  "general_plot",
  "action_battle",
  "mystery_reveal",
  "palace_intrigue",
  "business_negotiation",
  "romance",
  "adult_intimacy",
  "custom",
] as const;

export type StorySceneProfileId = typeof STORY_SCENE_PROFILE_IDS[number];

export type StoryStageTemplate = {
  templateId: string;
  profileId: StorySceneProfileId;
  templateName: string;
  stageTypes: string[];
  stageGoals: Record<string, string>;
  dependencyRules: Array<{ stageType: string; dependsOn?: string; requiredStatus?: string; required: boolean; skippable: boolean }>;
  continuitySchemaVersion: string;
};

export type StorySceneProfile = {
  profileId: StorySceneProfileId;
  profileName: string;
  profileFamily: "universal" | "adult" | "custom";
  adapterId: string;
  defaultStageTemplateId: string;
  allowedStageTemplateIds: string[];
  recommendedScenePurposes: string[];
  continuitySchemaVersion: string;
  providerPolicyId: string;
  fallbackProfileId: StorySceneProfileId;
};

export type ClassificationTopicSceneContract = {
  classificationPackId: string;
  topicId: string;
  storyEngineId: string;
  sceneProfileId: StorySceneProfileId;
  defaultStageTemplateId: string;
  allowedStageTemplateIds: string[];
  recommendedScenePurposes: string[];
  policyAdapterIds: string[];
  providerPolicyId: string;
  continuitySchemaVersion: string;
  fallbackProfileId: StorySceneProfileId;
};

export type StoryProviderPolicy = {
  providerPolicyId: string;
  privacyMode: "local-only" | "local-first" | "external-allowed" | "external-preferred";
  allowedProviders: string[];
  blockedProviders: string[];
  externalFallbackAllowed: boolean;
  dataLeftDevice: false;
};

export type StorySceneProfileAdapter = {
  adapterId: string;
  adapterType: "universal" | "adult";
  sourceProfileId: StorySceneProfileId;
  targetEngine: "universal_scene_engine" | "intimacy_scene_state_machine";
  policyGate: Record<string, unknown>;
  compatibility: Record<string, unknown>;
};

export type UniversalSceneContractResult = {
  contract: ClassificationTopicSceneContract;
  profile: StorySceneProfile;
  template: StoryStageTemplate;
  providerPolicy: StoryProviderPolicy;
  adapter: StorySceneProfileAdapter;
  dataLeftDevice: false;
  externalRequestCount: 0;
};

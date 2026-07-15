import type { AdultRating, AdultRelationshipStage } from "../adult-policy-types";

export type AdultTaxonomyCategoryId =
  | "character_archetype"
  | "appearance_style"
  | "clothing_costume"
  | "occupation_identity"
  | "relationship_type"
  | "location"
  | "situation"
  | "emotional_tone"
  | "power_dynamic"
  | "narrative_device"
  | "pacing"
  | "explicitness"
  | "stage_pattern"
  | "plot_purpose"
  | "aftermath_type"
  | "version_type";

export type AdultTaxonomyCategory = {
  categoryId: AdultTaxonomyCategoryId;
  displayName: string;
  ordinal: number;
  enabled: boolean;
};

export type AdultTaxonomyTag = {
  tagId: string;
  categoryId: AdultTaxonomyCategoryId;
  displayName: string;
  aliases: string[];
  description: string;
  enabled: boolean;
  adultOnly: boolean;
  minimumRating: AdultRating;
  requiresTags: string[];
  excludesTags: string[];
  compatibleTags: string[];
  requiredRelationshipStages: AdultRelationshipStage[];
  requiredStoryFacts: string[];
  requiredPolicyFlags: string[];
  defaultWeight: number;
  preferenceWeight: number;
  noveltyWeight: number;
  repetitionWeight: number;
  createdAt?: string;
  updatedAt?: string;
};

export type AdultScenarioPack = {
  scenarioPackId: string;
  title: string;
  premise: string;
  participantRoles: string[];
  requiredRelationshipStages: AdultRelationshipStage[];
  requiredSetup: string[];
  locationOptions: string[];
  emotionalToneOptions: string[];
  stageTemplate: string[];
  narrativePurpose: string;
  consequenceTemplate: string;
  compatibleTags: string[];
  incompatibleTags: string[];
  ratingRange: [AdultRating, AdultRating];
  version: number;
  enabled: boolean;
};

export type ScenarioDiscoveryInput = {
  projectId: string;
  selectedTags?: string[];
  participantIds?: string[];
  relationshipStage?: AdultRelationshipStage;
  storyFacts?: string[];
  policyRating?: AdultRating;
  seed?: string;
  limit?: number;
  excludeRecentlyUsed?: boolean;
};

export type ScenarioProposal = {
  proposalId: string;
  scenarioPackId: string;
  selectedTags: string[];
  premise: string;
  participantRoles: string[];
  relationshipRequirements: AdultRelationshipStage[];
  location: string;
  emotionalTone: string;
  requiredSetup: string[];
  stagePlan: string[];
  narrativePurpose: string;
  consequencePlan: string;
  preferenceScore: number;
  compatibilityScore: number;
  noveltyScore: number;
  freshnessScore: number;
  repetitionPenalty: number;
  policyRisk: number;
  recommendationReasons: string[];
  policyStatus: "allowed" | "needs_policy_review" | "blocked_by_rating";
};

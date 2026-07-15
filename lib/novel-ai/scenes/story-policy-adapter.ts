import type { StoryProviderPolicy, StorySceneProfileAdapter } from "./story-scene-types";

export const STORY_PROVIDER_POLICIES: StoryProviderPolicy[] = [
  {
    providerPolicyId: "local_only_story",
    privacyMode: "local-only",
    allowedProviders: ["ollama-local", "local-rule"],
    blockedProviders: ["openai", "gemini", "grok", "supabase", "external-story-api"],
    externalFallbackAllowed: false,
    dataLeftDevice: false,
  },
  {
    providerPolicyId: "local_first_story",
    privacyMode: "local-first",
    allowedProviders: ["ollama-local", "local-rule"],
    blockedProviders: ["openai", "gemini", "grok"],
    externalFallbackAllowed: false,
    dataLeftDevice: false,
  },
];

export const STORY_PROFILE_ADAPTERS: StorySceneProfileAdapter[] = [
  {
    adapterId: "universal_profile_adapter",
    adapterType: "universal",
    sourceProfileId: "general_plot",
    targetEngine: "universal_scene_engine",
    policyGate: { requiresCanonicalWrite: false, generationImplemented: false },
    compatibility: { supportedProfiles: ["general_plot", "action_battle", "mystery_reveal", "palace_intrigue", "business_negotiation", "romance", "custom"] },
  },
  {
    adapterId: "adult_scene_profile_adapter",
    adapterType: "adult",
    sourceProfileId: "adult_intimacy",
    targetEngine: "intimacy_scene_state_machine",
    policyGate: {
      projectAdultPolicyRequired: true,
      participantVerificationRequired: true,
      activeConsentRequired: true,
      localOnlyProviderRequired: true,
      generationImplemented: false,
    },
    compatibility: { h2p3Migration: "016_segmented_scene_state_machine", explicitGeneration: "not_implemented" },
  },
];

export function resolveAdapter(adapterId: string) {
  return STORY_PROFILE_ADAPTERS.find((adapter) => adapter.adapterId === adapterId) ?? STORY_PROFILE_ADAPTERS[0];
}

export function resolveProviderPolicy(providerPolicyId: string) {
  return STORY_PROVIDER_POLICIES.find((policy) => policy.providerPolicyId === providerPolicyId) ?? STORY_PROVIDER_POLICIES[0];
}

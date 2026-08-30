import {
  ADULT_NARRATIVE_ACT_IDS,
  ADULT_NARRATIVE_CHANGE_DIMENSIONS,
  ADULT_NARRATIVE_ENGINE_IDS,
  ADULT_NARRATIVE_STRUCTURE_VERSION,
  ADULT_NARRATIVE_WORLD_ADAPTER_IDS,
} from "./adult-narrative-structure";

export const INTIMACY_RUNTIME_CONTRACT_VERSION = "h2p3-runtime-contract-v1";

export const INTIMACY_RUNTIME_ROUTES = [
  "/api/local/intimacy/scenes/plan",
  "/api/local/intimacy/scenes/:sceneId/stages/:stageId/transition",
  "/api/local/intimacy/scenes/:sceneId/stages/:stageId/versions",
  "/api/local/intimacy/scenes/:sceneId/branches",
  "/api/local/intimacy/scenes/:sceneId/continuity",
] as const;

export const INTIMACY_RUNTIME_GUARDS = {
  externalAiRequests: "blocked",
  explicitDraftGeneration: "not_implemented",
  participantVerification: "required",
  participantRevocableConsent: "required_each_transition",
  continuityWithdrawalCheck: "required_each_forward_transition",
  adultExperienceProfile: "project_adult_mode_and_fictional_adults_confirmed",
  adultStageEvidence: "validated_before_create_and_approve",
  branchIsolation: "required",
  continuitySnapshot: "required",
  localOnly: true,
} as const;

export const ADULT_NARRATIVE_RUNTIME_CONTRACT = {
  version: ADULT_NARRATIVE_STRUCTURE_VERSION,
  mode: "adult_only",
  outputKind: "structural_json",
  engineComposition: { primaryCount: 1, maximumSecondaryCount: 1 },
  engines: ADULT_NARRATIVE_ENGINE_IDS,
  mandatoryActs: ADULT_NARRATIVE_ACT_IDS,
  worldAdapters: ADULT_NARRATIVE_WORLD_ADAPTER_IDS,
  escalationMustChange: ADULT_NARRATIVE_CHANGE_DIMENSIONS,
  guards: {
    verifiedAdultsOnly: true,
    activeRevocableConsentRequired: true,
    projectAdultModeRequired: true,
    fictionalAdultsConfirmedRequired: true,
    fiveActRuntimeValidation: "required",
    materialStateChangeRuntimeValidation: "required",
    bloodIncestEnactment: "blocked",
    hiddenRecording: "blocked",
    glorifiedCoercion: "blocked",
    realCatalogCopying: "blocked",
    generalModeActivation: "blocked",
  },
} as const;

export function intimacyRuntimeContract() {
  return {
    version: INTIMACY_RUNTIME_CONTRACT_VERSION,
    routes: INTIMACY_RUNTIME_ROUTES,
    guards: INTIMACY_RUNTIME_GUARDS,
    narrativeStructure: ADULT_NARRATIVE_RUNTIME_CONTRACT,
    status: "contract_ready" as const,
  };
}

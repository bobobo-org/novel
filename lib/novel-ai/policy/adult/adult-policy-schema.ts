import type { AdultGenerationMode, AdultPacing, AdultPublicVersionMode, AdultRating, ProjectAdultPolicy } from "./adult-policy-types";
import { adultPolicyError } from "./adult-policy-errors";

export const ADULT_POLICY_SCHEMA_VERSION = "adult-policy-v1";
export const ADULT_RATINGS: AdultRating[] = ["E0", "E1", "E2", "E3", "E4", "E5"];
export const ADULT_PACING: AdultPacing[] = ["slow", "balanced", "fast"];
export const ADULT_PUBLIC_VERSION_MODES: AdultPublicVersionMode[] = ["none", "fade_to_black", "mature_summary", "public_romance"];
export const ADULT_GENERATION_MODES: AdultGenerationMode[] = ["disabled", "fade_to_black", "mature", "private_adult"];

export function defaultAdultPolicy(projectId: string): ProjectAdultPolicy {
  const now = new Date().toISOString();
  return {
    projectId,
    enabled: false,
    rating: "E0",
    explicitness: 0,
    directLanguage: false,
    fadeToBlack: true,
    pacing: "balanced",
    dialogueRatio: 35,
    sensoryDetail: 1,
    emotionalDetail: 3,
    psychologicalDetail: 3,
    defaultSceneLength: 600,
    aftermathLength: 150,
    publicVersionMode: "fade_to_black",
    generationMode: "disabled",
    policyVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeAdultPolicy(projectId: string, input: Partial<ProjectAdultPolicy> = {}): ProjectAdultPolicy {
  const base = defaultAdultPolicy(projectId);
  const policy: ProjectAdultPolicy = {
    ...base,
    ...input,
    projectId,
    enabled: Boolean(input.enabled ?? base.enabled),
    directLanguage: Boolean(input.directLanguage ?? base.directLanguage),
    fadeToBlack: Boolean(input.fadeToBlack ?? base.fadeToBlack),
    explicitness: clampNumber(input.explicitness ?? base.explicitness, 0, 5),
    dialogueRatio: clampNumber(input.dialogueRatio ?? base.dialogueRatio, 0, 100),
    sensoryDetail: clampNumber(input.sensoryDetail ?? base.sensoryDetail, 0, 5),
    emotionalDetail: clampNumber(input.emotionalDetail ?? base.emotionalDetail, 0, 5),
    psychologicalDetail: clampNumber(input.psychologicalDetail ?? base.psychologicalDetail, 0, 5),
    defaultSceneLength: Math.max(0, Math.floor(input.defaultSceneLength ?? base.defaultSceneLength)),
    aftermathLength: Math.max(0, Math.floor(input.aftermathLength ?? base.aftermathLength)),
    policyVersion: Math.max(1, Math.floor(input.policyVersion ?? base.policyVersion)),
    updatedAt: new Date().toISOString(),
  };
  assertAdultPolicy(policy);
  return policy;
}

export function assertAdultPolicy(policy: ProjectAdultPolicy) {
  if (!ADULT_RATINGS.includes(policy.rating)) throw adultPolicyError("ADULT_VALIDATION_INPUT_INVALID", `Invalid adult rating: ${policy.rating}`);
  if (!ADULT_PACING.includes(policy.pacing)) throw adultPolicyError("ADULT_VALIDATION_INPUT_INVALID", `Invalid adult pacing: ${policy.pacing}`);
  if (!ADULT_PUBLIC_VERSION_MODES.includes(policy.publicVersionMode)) throw adultPolicyError("ADULT_VALIDATION_INPUT_INVALID", `Invalid public version mode: ${policy.publicVersionMode}`);
  if (!ADULT_GENERATION_MODES.includes(policy.generationMode)) throw adultPolicyError("ADULT_VALIDATION_INPUT_INVALID", `Invalid generation mode: ${policy.generationMode}`);
  if (policy.generationMode === "private_adult" && ["E0", "E1", "E2"].includes(policy.rating)) {
    throw adultPolicyError("ADULT_RATING_TOO_LOW", "Private adult generation mode requires a mature/adult project rating.");
  }
  return true;
}

function clampNumber(value: number, min: number, max: number) {
  const numeric = Number.isFinite(value) ? Number(value) : min;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

import { storyGenerationError } from "./story-generation-errors";
import type { StoryStageContext } from "./story-stage-context";
import { AdultNarrativeStructureError, validateAdultNarrativeBlueprint } from "../../adult/scenes/adult-narrative-structure";
import { ADULT_EXPERIENCE_PROFILE_VERSION } from "../../../novel-data/adult-experience-profile";

export function assertAdultStagePolicy(context: StoryStageContext) {
  if (context.profileId !== "adult_intimacy") return { ok: true, issues: [] as string[] };
  const policy = context.policy ?? {};
  const issues: string[] = [];
  if (!policy.adultPolicyEnabled) issues.push("ADULT_POLICY_DISABLED");
  if (context.adultMode !== true) issues.push("ADULT_PROJECT_MODE_DISABLED");
  if (context.adultExperienceProfile?.version !== ADULT_EXPERIENCE_PROFILE_VERSION
    || context.adultExperienceProfile?.fictionalAdultsConfirmed !== true
    || context.adultExperienceProfile.consentContinuityRequired !== true
    || context.adultExperienceProfile.realPersonLikenessBlocked !== true) issues.push("ADULT_EXPERIENCE_PROFILE_UNCONFIRMED");
  if (!context.adultNarrativeBlueprint) issues.push("ADULT_STRUCTURAL_BLUEPRINT_REQUIRED");
  if (!policy.participantsVerifiedAdult) issues.push("ADULT_PARTICIPANT_NOT_VERIFIED");
  if (!policy.relationshipPermitted) issues.push("ADULT_RELATIONSHIP_RULE_BLOCKED");
  if (policy.consentState !== "active") issues.push("ADULT_CONSENT_NOT_ACTIVE");
  if (policy.consentRevocable !== true) issues.push("ADULT_CONSENT_NOT_REVOCABLE");
  if (policy.withdrawalState === "active") issues.push("ADULT_WITHDRAWAL_ACTIVE");
  if (!policy.ratingPermitted) issues.push("ADULT_RATING_NOT_PERMITTED");
  if (policy.providerMode && !["local-only", "local-first"].includes(policy.providerMode)) issues.push("ADULT_LOCAL_ONLY_REQUIRED");
  if (issues.length) {
    throw storyGenerationError("STORY_GENERATION_POLICY_BLOCKED", "Adult stage generation policy gate blocked this request.", { issues });
  }
  const blueprintValidation = validateAdultNarrativeBlueprint(context.adultNarrativeBlueprint!);
  if (!blueprintValidation.ok) throw new AdultNarrativeStructureError(blueprintValidation.issues);
  const mappedAct = context.adultNarrativeBlueprint!.acts.find((act) => act.actId === context.adultNarrativeActId);
  if (!mappedAct || mappedAct.stageType !== context.stageType || mappedAct.consentCheckpoint !== true) {
    throw storyGenerationError("STORY_GENERATION_POLICY_BLOCKED", "Adult stage generation requires an exact five-act structural mapping.", { issues: ["ADULT_STAGE_ACT_MAPPING_INVALID"] });
  }
  return { ok: true, issues };
}

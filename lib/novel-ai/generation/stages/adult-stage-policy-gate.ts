import { storyGenerationError } from "./story-generation-errors";
import type { StoryStageContext } from "./story-stage-context";

export function assertAdultStagePolicy(context: StoryStageContext) {
  if (context.profileId !== "adult_intimacy") return { ok: true, issues: [] as string[] };
  const policy = context.policy ?? {};
  const issues: string[] = [];
  if (!policy.adultPolicyEnabled) issues.push("ADULT_POLICY_DISABLED");
  if (!policy.participantsVerifiedAdult) issues.push("ADULT_PARTICIPANT_NOT_VERIFIED");
  if (!policy.relationshipPermitted) issues.push("ADULT_RELATIONSHIP_RULE_BLOCKED");
  if (policy.consentState !== "active") issues.push("ADULT_CONSENT_NOT_ACTIVE");
  if (policy.withdrawalState === "active") issues.push("ADULT_WITHDRAWAL_ACTIVE");
  if (!policy.ratingPermitted) issues.push("ADULT_RATING_NOT_PERMITTED");
  if (policy.providerMode && !["local-only", "local-first"].includes(policy.providerMode)) issues.push("ADULT_LOCAL_ONLY_REQUIRED");
  if (issues.length) {
    throw storyGenerationError("STORY_GENERATION_POLICY_BLOCKED", "Adult stage generation policy gate blocked this request.", { issues });
  }
  return { ok: true, issues };
}

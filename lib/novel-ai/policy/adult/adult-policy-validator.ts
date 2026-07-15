import type { AdultPolicyValidationContext, AdultPolicyValidationIssue, AdultPolicyValidationResult } from "./adult-policy-types";

const ORDER = ["E0", "E1", "E2", "E3", "E4", "E5"];

export function validateAdultPolicyContext(context: AdultPolicyValidationContext): AdultPolicyValidationResult {
  const issues: AdultPolicyValidationIssue[] = [];
  const policy = context.policy;

  if (!policy.enabled || policy.rating === "E0" || policy.generationMode === "disabled") {
    issues.push({
      code: "ADULT_POLICY_DISABLED",
      severity: "blocking",
      message: "Project adult policy is disabled for this request.",
    });
  }

  if (context.policyVersion && context.policyVersion !== policy.policyVersion) {
    issues.push({
      code: "ADULT_POLICY_VERSION_MISMATCH",
      severity: "blocking",
      message: "Request policy version does not match the current project policy.",
    });
  }

  if (context.requestedRating && ORDER.indexOf(context.requestedRating) > ORDER.indexOf(policy.rating)) {
    issues.push({
      code: "ADULT_RATING_TOO_LOW",
      severity: "blocking",
      message: "Requested rating exceeds the project policy rating.",
    });
  }

  for (const participant of context.participants) {
    if (participant.verificationStatus === "verified_minor") {
      issues.push({
        code: "ADULT_PARTICIPANT_NOT_VERIFIED",
        severity: "blocking",
        message: "A participant is verified as not eligible for adult-rated handling.",
        subjectId: participant.characterId,
      });
    } else if (participant.verificationStatus !== "verified_adult") {
      issues.push({
        code: participant.verificationStatus === "unknown" ? "ADULT_PARTICIPANT_AGE_UNKNOWN" : "ADULT_PARTICIPANT_NOT_VERIFIED",
        severity: "blocking",
        message: "A participant does not have verified adult status.",
        subjectId: participant.characterId,
      });
    }
  }

  if (context.consentState === "unspecified" || context.consentState === "not_applicable") {
    issues.push({
      code: "ADULT_CONSENT_UNSPECIFIED",
      severity: "blocking",
      message: "Consent state must be explicitly active before adult-rated handling.",
    });
  }
  if (context.consentState === "withdrawn" || context.consentState === "invalid") {
    issues.push({
      code: "ADULT_CONSENT_WITHDRAWN",
      severity: "blocking",
      message: "Consent state blocks this request.",
    });
  }

  if (context.relationshipRule && !context.relationshipRule.intimacyAllowed) {
    issues.push({
      code: "ADULT_RELATIONSHIP_RULE_BLOCKED",
      severity: "blocking",
      message: "Relationship policy blocks this request.",
      subjectId: context.relationshipRule.relationshipId,
    });
  }

  const allowed = issues.every((issue) => issue.severity !== "blocking");
  return {
    allowed,
    status: allowed ? "allowed" : "blocked",
    issues,
    policyVersion: policy.policyVersion,
    dataLeftDevice: false,
    externalRequestCount: 0,
  };
}

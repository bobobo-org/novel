import { intimacySceneError } from "./intimacy-scene-errors";
import type { IntimacyParticipantInput, IntimacyValidationResult } from "./intimacy-scene-types";

export function validateParticipants(participants: IntimacyParticipantInput[]): IntimacyValidationResult {
  const issues: IntimacyValidationResult["issues"] = [];
  if (!participants.length) issues.push({ code: "INTIMACY_PARTICIPANT_REQUIRED", severity: "blocking", message: "At least one participant is required." });
  for (const participant of participants) {
    if (participant.verifiedAdultStatus !== "verified_adult") {
      issues.push({ code: "INTIMACY_PARTICIPANT_INVALID", severity: "blocking", message: "Participant must have verified adult status for this structural scene plan.", subjectId: participant.characterId });
    }
    if (participant.consentState !== "active") {
      issues.push({ code: "INTIMACY_CONSENT_NOT_ACTIVE", severity: "blocking", message: "Consent state must be active before planning the scene.", subjectId: participant.characterId });
    }
  }
  return { ok: !issues.some((issue) => issue.severity === "blocking"), issues, dataLeftDevice: false, externalRequestCount: 0 };
}

export function assertValidation(result: IntimacyValidationResult) {
  if (!result.ok) throw intimacySceneError("INTIMACY_PARTICIPANT_INVALID", "Scene validation failed.", result);
}

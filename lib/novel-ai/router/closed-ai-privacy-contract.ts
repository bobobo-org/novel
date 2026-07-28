import type { ClosedAIFallbackPolicy, ClosedAIPrivacyLevel } from "./platform-types";

export const CLOSED_AI_PRIVACY_SCHEMA_VERSION = "closed-ai-privacy-v1";

export type ClosedAIPrivacyPolicy = {
  schemaVersion: typeof CLOSED_AI_PRIVACY_SCHEMA_VERSION;
  privacyLevel: ClosedAIPrivacyLevel;
  closedOnly: boolean;
  offlineRequired: boolean;
  externalConsent: boolean;
  fallbackPolicy: ClosedAIFallbackPolicy;
};

export function validateClosedAIPrivacyPolicy(value: ClosedAIPrivacyPolicy) {
  if (value.schemaVersion !== CLOSED_AI_PRIVACY_SCHEMA_VERSION) return { valid: false, errorCode: "CLOSED_PRIVACY_SCHEMA_UNSUPPORTED" };
  if (value.closedOnly && value.fallbackPolicy === "external-with-consent") return { valid: false, errorCode: "CLOSED_PRIVACY_EXTERNAL_FALLBACK_FORBIDDEN" };
  if (value.privacyLevel !== "external_allowed" && value.externalConsent) return { valid: false, errorCode: "CLOSED_PRIVACY_CONSENT_SCOPE_INVALID" };
  if (value.offlineRequired && value.privacyLevel === "external_allowed") return { valid: false, errorCode: "CLOSED_PRIVACY_OFFLINE_EXTERNAL_CONFLICT" };
  return { valid: true, errorCode: null };
}

export function migrateClosedAIPrivacyPolicy(value: Record<string, unknown>): ClosedAIPrivacyPolicy | null {
  if (value.schemaVersion === CLOSED_AI_PRIVACY_SCHEMA_VERSION) return value as ClosedAIPrivacyPolicy;
  return null;
}


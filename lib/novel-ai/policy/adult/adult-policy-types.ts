export type AdultRating = "E0" | "E1" | "E2" | "E3" | "E4" | "E5";
export type AdultPacing = "slow" | "balanced" | "fast";
export type AdultPublicVersionMode = "none" | "fade_to_black" | "mature_summary" | "public_romance";
export type AdultGenerationMode = "disabled" | "fade_to_black" | "mature" | "private_adult";
export type AdultVerificationStatus = "verified_adult" | "verified_minor" | "unknown" | "conflicting" | "revoked";
export type AdultConsentState = "not_applicable" | "unspecified" | "active" | "withdrawn" | "invalid";
export type AdultRelationshipStage =
  | "strangers"
  | "acquainted"
  | "distrust"
  | "attraction"
  | "emotional_bond"
  | "established"
  | "conflicted"
  | "separated"
  | "reconciled";

export type ProjectAdultPolicy = {
  projectId: string;
  enabled: boolean;
  rating: AdultRating;
  explicitness: number;
  directLanguage: boolean;
  fadeToBlack: boolean;
  pacing: AdultPacing;
  dialogueRatio: number;
  sensoryDetail: number;
  emotionalDetail: number;
  psychologicalDetail: number;
  defaultSceneLength: number;
  aftermathLength: number;
  publicVersionMode: AdultPublicVersionMode;
  generationMode: AdultGenerationMode;
  policyVersion: number;
  createdAt?: string;
  updatedAt?: string;
};

export type CharacterAdultAssertion = {
  id?: string;
  projectId: string;
  characterId: string;
  ageValue?: number;
  ageSource: "canonical" | "author_asserted" | "unknown" | "conflicting";
  verificationStatus: AdultVerificationStatus;
  canonicalEntityId?: string;
  verifiedAt?: string;
  verificationVersion?: number;
};

export type RelationshipIntimacyRule = {
  id?: string;
  projectId: string;
  relationshipId: string;
  participantIds: string[];
  relationshipType: string;
  relationshipStage: AdultRelationshipStage;
  intimacyAllowed: boolean;
  allowedFromChapter?: number;
  requiredEvents: string[];
  forbiddenEvents: string[];
  exclusivityRule?: string;
  publicRisk: number;
  trustLevel: number;
  attractionLevel: number;
  resentmentLevel: number;
  powerBalance?: string;
  consequenceProfile?: string;
};

export type AdultPolicyProfile = {
  profileId: string;
  projectId: string;
  title: string;
  enabled: boolean;
  policy: Omit<ProjectAdultPolicy, "projectId" | "policyVersion" | "createdAt" | "updatedAt">;
};

export type AdultPolicyPreference = {
  projectId: string;
  key: string;
  value: string;
};

export type AdultPolicyExclusion = {
  projectId: string;
  key: string;
  reason?: string;
};

export type AdultPolicyErrorCode =
  | "ADULT_POLICY_DISABLED"
  | "ADULT_PARTICIPANT_NOT_VERIFIED"
  | "ADULT_PARTICIPANT_AGE_UNKNOWN"
  | "ADULT_CONSENT_UNSPECIFIED"
  | "ADULT_CONSENT_WITHDRAWN"
  | "ADULT_RELATIONSHIP_RULE_BLOCKED"
  | "ADULT_POLICY_VERSION_MISMATCH"
  | "ADULT_RATING_TOO_LOW"
  | "ADULT_VALIDATION_INPUT_INVALID";

export type AdultPolicyValidationIssue = {
  code: AdultPolicyErrorCode;
  severity: "info" | "warning" | "blocking";
  message: string;
  subjectId?: string;
};

export type AdultPolicyValidationContext = {
  projectId: string;
  policy: ProjectAdultPolicy;
  participants: CharacterAdultAssertion[];
  relationshipRule?: RelationshipIntimacyRule;
  consentState: AdultConsentState;
  requestedRating?: AdultRating;
  policyVersion?: number;
};

export type AdultPolicyValidationResult = {
  allowed: boolean;
  status: "allowed" | "blocked";
  issues: AdultPolicyValidationIssue[];
  policyVersion: number;
  dataLeftDevice: false;
  externalRequestCount: 0;
};

export type AdultPolicyAuditInput = {
  projectId: string;
  policyVersion?: number;
  action: string;
  provider?: string;
  model?: string;
  promptTemplateVersion?: string;
  validationStatus: string;
  dataLeftDevice?: boolean;
  externalRequestCount?: number;
  outputHash?: string;
  details?: Record<string, unknown>;
};

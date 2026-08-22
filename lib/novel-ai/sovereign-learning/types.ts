export const SOVEREIGN_LEARNING_SCHEMA_VERSION = "closed-ai-sovereign-learning-v1" as const;
export const SOVEREIGN_LEARNING_SNAPSHOT_VERSION = "closed-ai-sovereign-learning-snapshot-v1" as const;

export type LearningSourceKind =
  | "project_creation"
  | "article"
  | "book_excerpt"
  | "ai_output"
  | "personal_note"
  | "public_domain_work"
  | "licensed_material"
  | "video_transcript"
  | "novel_app_export"
  | "classical_chinese_public_domain"
  | "web_research"
  | "shared_abstract_rules";

export type LearningWebSourceChannel = "article" | "youtube" | "novel_app" | "popular_web" | "classical_chinese";

export type LearningEngagementMetric =
  | "views"
  | "reads"
  | "installs"
  | "ratings"
  | "followers"
  | "monthly_visits";

export type LearningEngagementEvidence = {
  metric: LearningEngagementMetric;
  observedCount: number;
  minimumRequired: 100_000;
  thresholdPassed: true;
  verification: "operator_attested";
  evidenceReference: string;
  observedAt: string;
};

export type LearningWebSourceProfile = {
  channel: LearningWebSourceChannel;
  engagement: LearningEngagementEvidence | null;
};

export type LearningRightsBasis =
  | "owned_by_user"
  | "public_domain"
  | "licensed_for_analysis"
  | "lawful_private_reference"
  | "ai_output_authorized"
  | "public_abstract_research"
  | "user_supplied_abstract_research"
  | "abstract_idea";

export type LearningSourceStatus = "active" | "quarantined" | "revoked";
export type LearningRuleStatus = "candidate" | "approved" | "rejected" | "quarantined" | "revoked";

export type LearningRuleFamily =
  | "structure"
  | "pacing"
  | "character"
  | "relationship"
  | "dialogue"
  | "style"
  | "foreshadowing"
  | "worldbuilding"
  | "revision";

export type LearningRuleDimension =
  | "viewpoint"
  | "sentence_rhythm"
  | "paragraph_rhythm"
  | "dialogue_density"
  | "opening_hook"
  | "conflict_escalation"
  | "reveal_cadence"
  | "scene_transition"
  | "ending_hook"
  | "character_pressure"
  | "relationship_movement"
  | "world_rule_delivery"
  | "foreshadow_payoff"
  | "information_control"
  | "tone"
  | "other";

export type TextFingerprint = {
  algorithm: "fnv1a-bloom-v1";
  unit: "mixed-word-character-shingles";
  bloomBits: number;
  bloomHex: string;
  shingleCount: number;
  sampleHashes: string[];
};

export type LearningSourceRecord = {
  schemaVersion: typeof SOVEREIGN_LEARNING_SCHEMA_VERSION;
  id: string;
  projectId: string;
  title: string;
  author: string | null;
  sourceReference: string | null;
  sourceKind: LearningSourceKind;
  rightsBasis: LearningRightsBasis;
  rightsEvidenceHash: string;
  userConfirmedRights: true;
  localAnalysisOnly: boolean;
  rawContentRetained: false;
  contentHash: string;
  fingerprint: TextFingerprint;
  language: string;
  status: LearningSourceStatus;
  sanitizationStatus: "unchanged" | "sanitized" | "quarantined";
  warningCodes: string[];
  trustScore: number;
  deepExtractionAttempted: boolean;
  deepExtractionProvider: string | null;
  deepExtractionModel: string | null;
  dataLeftDevice?: boolean;
  externalRequestCount?: number;
  webProvenance?: {
    requestedUrl: string;
    finalUrl: string;
    fetchedAt: string;
    contentType: string;
    robotsPolicy: "allowed" | "not_present";
    redirects: number;
    sourceDigest: string;
    sourceProfile: LearningWebSourceProfile;
    rawContentRetained: false;
  } | null;
  teacherEvidence?: Array<{
    provider: "openai" | "gemini" | "grok";
    model: string;
    responseDigest: string;
    acceptedRuleCount: number;
    candidateOnly: true;
    rawResponseRetained: false;
  }>;
  createdAt: string;
  updatedAt: string;
  revision: number;
};

export type LearningRuleRecipe = {
  when: string;
  operation: string;
  constraint: string;
  evaluate: string;
};

export type LearningRuleDraft = {
  family: LearningRuleFamily;
  dimension: LearningRuleDimension;
  statement: string;
  tags: string[];
  parameters: Record<string, string | number | boolean>;
  recipe: LearningRuleRecipe;
  confidence: number;
  extractorKind: "deterministic_pattern" | "local_closed_ai" | "external_teacher_ai";
  extractorProvider: string;
  extractorModel: string | null;
  sourceOverlapScore: number;
  longestSourceMatch: number;
  abstractionScore: number;
  conflictKey: string | null;
};

export type LearnedNarrativeRule = LearningRuleDraft & {
  schemaVersion: typeof SOVEREIGN_LEARNING_SCHEMA_VERSION;
  id: string;
  projectId: string;
  sourceId: string;
  status: LearningRuleStatus;
  conflictRuleIds: string[];
  approvedAt: string | null;
  rejectedAt: string | null;
  revokedAt: string | null;
  supersededByRuleId: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
};

export type LearningFeedbackDecision = "accepted" | "edited" | "rejected";

export type LearningFeedbackRecord = {
  schemaVersion: typeof SOVEREIGN_LEARNING_SCHEMA_VERSION;
  id: string;
  projectId: string;
  decision: LearningFeedbackDecision;
  taskType: string;
  ruleIds: string[];
  outputHash: string | null;
  rawOutputRetained: false;
  reasonTags: string[];
  editDistance: number | null;
  provider: string | null;
  model: string | null;
  createdAt: string;
};

export type LearningPreferenceProfile = {
  schemaVersion: typeof SOVEREIGN_LEARNING_SCHEMA_VERSION;
  id: string;
  projectId: string;
  familyWeights: Partial<Record<LearningRuleFamily, number>>;
  ruleWeights: Record<string, number>;
  acceptedCount: number;
  editedCount: number;
  rejectedCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type LearningAuditAction =
  | "source_ingested"
  | "source_duplicate"
  | "source_quarantined"
  | "source_quarantine_cleared"
  | "source_revoked"
  | "rule_approved"
  | "rule_rejected"
  | "rule_replaced"
  | "feedback_recorded"
  | "snapshot_restored";

export type LearningAuditRecord = {
  schemaVersion: typeof SOVEREIGN_LEARNING_SCHEMA_VERSION;
  id: string;
  projectId: string;
  action: LearningAuditAction;
  sourceId: string | null;
  ruleId: string | null;
  detailCodes: string[];
  rawContentIncluded: false;
  createdAt: string;
};

export type DeepRuleExtractionRequest = {
  prompt: string;
  chunkIndex: number;
  chunkCount: number;
};

export type DeepRuleExtractionResult = {
  content: string;
  provider: string;
  model: string | null;
  externalRequest: boolean;
  dataLeftDevice: boolean;
};

export type DeepRuleExtractor = (
  request: DeepRuleExtractionRequest,
) => Promise<DeepRuleExtractionResult>;

export type SovereignLearningSnapshot = {
  schemaVersion: typeof SOVEREIGN_LEARNING_SNAPSHOT_VERSION;
  projectId: string;
  createdAt: string;
  sources: LearningSourceRecord[];
  rules: LearnedNarrativeRule[];
  feedback: LearningFeedbackRecord[];
  profile: LearningPreferenceProfile | null;
  audit: LearningAuditRecord[];
  rawSourceContentIncluded: false;
  contentHash: string;
};

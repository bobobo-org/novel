export const PUBLIC_STORY_RESEARCH_SCHEMA_VERSION = "public-story-research-seed-v1" as const;
export const PUBLIC_STORY_RESEARCH_SEED_VERSION = "2026-08-23.1" as const;

export const TEN_CAUSAL_DIMENSIONS = [
  "catalyst",
  "goal",
  "pressure",
  "leverage",
  "prop/resource",
  "relationship tension",
  "cost",
  "deadline",
  "reversal",
  "aftermath hook",
] as const;

export type TenCausalDimension = (typeof TEN_CAUSAL_DIMENSIONS)[number];

export const SHARED_STORY_EXPERIENCE_MODES = [
  "rpg",
  "romance",
  "management",
] as const;

export type SharedStoryExperienceMode = (typeof SHARED_STORY_EXPERIENCE_MODES)[number];

export const CAUSAL_RUNTIME_CONSUMERS = [
  "planner",
  "choice",
  "story",
  "continuity",
  "closure",
] as const;

export type CausalRuntimeConsumer = (typeof CAUSAL_RUNTIME_CONSUMERS)[number];

export type ResearchPlatform =
  | "project_gutenberg"
  | "royal_road"
  | "youtube"
  | "meta_facebook"
  | "meta_instagram"
  | "peer_reviewed_research"
  | "novel_product_policy";

export type ResearchSourceType =
  | "official_category_taxonomy"
  | "official_subject_metadata"
  | "official_automation_guidance"
  | "official_genre_tag_taxonomy"
  | "official_retention_analytics_guidance"
  | "official_recommendation_guidance"
  | "official_content_grouping_guidance"
  | "official_public_insights_metric_definition"
  | "peer_reviewed_original_research"
  | "local_product_safety_policy";

export type ResearchSourceFact = {
  factId: string;
  factKind: "official_platform_fact" | "study_method" | "study_result" | "product_requirement";
  summary: string;
};

export type ResearchSourceRecord = {
  sourceId: string;
  url: string;
  platform: ResearchPlatform;
  sourceType: ResearchSourceType;
  sourceFacts: readonly ResearchSourceFact[];
  rights: {
    basis:
      | "official_facts_and_metadata_only"
      | "scholarly_metadata_and_abstract_summary_only"
      | "open_access_research_facts_only"
      | "owned_product_policy";
    sourceTextCopied: false;
    storyExpressionUsed: false;
    redistributionClaimed: false;
  };
  robots: {
    policy: "no_runtime_fetch_static_reference_only";
    checkedForAutomatedCollection: false;
    automatedCollectionPerformed: false;
    robotsOrLoginBypass: false;
  };
  publicAccess: {
    sourcePage: "public_without_login" | "public_abstract_only" | "local_builtin";
    metricOrFullTextAccess: "not_needed" | "account_required" | "subscription_or_library_may_be_required";
    observedAt: string;
  };
  provenance: {
    publisher: string;
    citationTitle: string;
    authors: readonly string[];
    publishedYear: number | null;
    doi: string | null;
    reviewedAt: string;
    manuallySummarized: true;
  };
  retention: {
    rawSourceRetained: false;
    excerptRetained: false;
    transcriptRetained: false;
    postOrVideoBodyRetained: false;
    characterNamesRetained: false;
    dialogueRetained: false;
    reconstructablePlotRetained: false;
  };
};

export type CausalStateDeltaKind =
  | "information"
  | "relationship"
  | "resource"
  | "ability"
  | "opportunity"
  | "cost"
  | "time"
  | "position";

export type TenDimensionInstruction = {
  dimension: TenCausalDimension;
  basis: "baseline_causal_schema" | "rule_inference" | "product_safety_policy";
  operation: string;
  stateDeltaKinds: readonly CausalStateDeltaKind[];
};

export type TenDimensionRulePayload = {
  readonly [Dimension in TenCausalDimension]: TenDimensionInstruction;
};

export type RuleTriggerParameter = {
  key: string;
  valueType: "integer" | "ratio" | "boolean" | "enum";
  defaultValue: string | number | boolean;
  minimum?: number;
  maximum?: number;
  unit: "beat" | "choice" | "scene" | "ratio" | "state" | "flag";
  experimentOnly: true;
};

export type AbstractResearchInferenceRule = {
  ruleId: string;
  claimKind: "inference" | "experiment" | "product_safety_policy";
  mechanismClass:
    | "research_translation"
    | "popular_short_drama_experiment"
    | "cross_platform_measurement_experiment"
    | "anti_despair_policy"
    | "mode_specific_experiment";
  statement: string;
  rationale: string;
  sourceFactRefs: readonly string[];
  experienceModes: readonly SharedStoryExperienceMode[];
  consumerFits: readonly CausalRuntimeConsumer[];
  tags: readonly string[];
  triggerParameters: readonly RuleTriggerParameter[];
  tenDimensions: TenDimensionRulePayload;
  evaluationSignals: readonly string[];
  guardrails: readonly string[];
  candidateOnly: true;
  autoApprove: false;
  outcomeGuarantee: false;
  experimentRequired: true;
};

export type PublicStoryResearchSeed = {
  schemaVersion: typeof PUBLIC_STORY_RESEARCH_SCHEMA_VERSION;
  seedVersion: typeof PUBLIC_STORY_RESEARCH_SEED_VERSION;
  releasedAt: string;
  tenDimensionSchema: typeof TEN_CAUSAL_DIMENSIONS;
  supportedExperiences: typeof SHARED_STORY_EXPERIENCE_MODES;
  networkPolicy: {
    runtimeFetch: false;
    automatedCrawl: false;
    robotsBypass: false;
    loginBypass: false;
    staticResearchOnly: true;
  };
  retention: {
    sourceTextRetained: false;
    socialPostRetained: false;
    videoOrAudioRetained: false;
    transcriptRetained: false;
    storySpecificExpressionRetained: false;
  };
  sources: readonly ResearchSourceRecord[];
  inferenceRules: readonly AbstractResearchInferenceRule[];
};

export type PublicStoryResearchIndexEntry = {
  ruleId: string;
  experienceModes: readonly SharedStoryExperienceMode[];
  consumerFits: readonly CausalRuntimeConsumer[];
  dimensions: readonly TenCausalDimension[];
  sourceFactRefs: readonly string[];
  searchTokens: ReadonlySet<string>;
  priority: number;
};

export type PublicStoryResearchIndex = {
  schemaVersion: typeof PUBLIC_STORY_RESEARCH_SCHEMA_VERSION;
  seedVersion: typeof PUBLIC_STORY_RESEARCH_SEED_VERSION;
  abstractRuleCount: number;
  rawSourceDocumentCount: 0;
  entries: readonly PublicStoryResearchIndexEntry[];
  entryByRuleId: ReadonlyMap<string, PublicStoryResearchIndexEntry>;
  tokenPostings: ReadonlyMap<string, readonly string[]>;
  scopePostings: ReadonlyMap<string, readonly string[]>;
  rankedRuleIds: readonly string[];
};

export type SharedCausalResearchLibraryEntry = {
  rule: AbstractResearchInferenceRule;
  approvalStatus: "approved";
  abstractWeight: number;
  evidenceRefs: readonly string[];
  aggregateFeedback: {
    accepted: number;
    edited: number;
    rejected: number;
  };
  rawStoryRetained: false;
  chainOfThoughtRetained: false;
};
export type SharedCausalResearchLibrary = {
  libraryVersion: string;
  learningSemantics: "knowledge_retrieval_and_rule_weight_learning";
  modelWeightTraining: false;
  entries: readonly SharedCausalResearchLibraryEntry[];
};

export type ValidatedCausalResearchSnapshotEntry = {
  rule: AbstractResearchInferenceRule;
  abstractWeight: number;
  evidenceRefs: readonly string[];
};

export type ValidatedCausalResearchSnapshot = {
  snapshotVersion: string;
  sourceLibraryVersion: string;
  seedVersion: typeof PUBLIC_STORY_RESEARCH_SEED_VERSION;
  createdAt: string;
  validationStatus: "schema_provenance_and_rights_validated";
  runtimeSemantics: "knowledge_retrieval";
  teacherAdoption: "candidate_only";
  modelWeightTraining: false;
  maximumSnapshotRules: number;
  entries: readonly ValidatedCausalResearchSnapshotEntry[];
  rawSourceDocumentCount: 0;
  runtimeNetworkRequests: 0;
};

export type PublicStoryResearchHit = {
  rule: AbstractResearchInferenceRule;
  score: number;
  matchedTokens: readonly string[];
  provenanceSourceIds: readonly string[];
};

export type CausalTeacherResearchCandidate = {
  candidateId: string;
  seedVersion: typeof PUBLIC_STORY_RESEARCH_SEED_VERSION;
  experience: SharedStoryExperienceMode;
  consumer: CausalRuntimeConsumer;
  status: "candidate";
  inferenceKind: AbstractResearchInferenceRule["claimKind"];
  ruleId: string;
  statement: string;
  triggerParameters: readonly RuleTriggerParameter[];
  tenDimensions: TenDimensionRulePayload;
  evaluationSignals: readonly string[];
  guardrails: readonly string[];
  provenance: {
    sourceIds: readonly string[];
    factRefs: readonly string[];
    urls: readonly string[];
    rightsReviewed: true;
    rawSourceRetained: false;
  };
  autoApprove: false;
  outcomeGuarantee: false;
  humanReviewRequired: true;
  capabilitySemantics: "knowledge_retrieval_and_rule_weight_learning";
  modelWeightTraining: false;
};

export type AbstractCausalRuleFeedback = {
  ruleId: string;
  decision: "accepted" | "edited" | "rejected";
  aggregateWeightDelta: number;
  recordedAt: string;
  rawStoryRetained: false;
  chainOfThoughtRetained: false;
};

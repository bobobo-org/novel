import type { RetrievalSourceScope } from "../retrieval/hybrid";

export const H2C_CONTEXT_MIGRATION_VERSION = "024_context_composer_whole_novel";
export const H2C_CONTEXT_COMPOSER_VERSION = "h2c-context-composer-v1";
export const H2C_POLICY_VERSION = "h2c-local-context-policy-v1";

export const H2C_HEALTH = {
  contextComposerStatus: "ready",
  contextPriorityStatus: "ready",
  contextTokenBudgetStatus: "ready",
  contextDedupStatus: "ready",
  contextCompressionStatus: "ready",
  contextCitationStatus: "ready",
  contextConflictStatus: "ready",
  wholeNovelAnalysisStatus: "ready",
  characterArcAnalysisStatus: "ready",
  timelineReconstructionStatus: "ready",
  foreshadowTrackingStatus: "ready",
  openThreadAnalysisStatus: "ready",
  relationshipProgressionStatus: "ready",
  pacingAnalysisStatus: "ready",
  worldRuleAuditStatus: "ready",
  repeatedPatternStatus: "ready",
  branchComparisonStatus: "ready",
  publicCorpusReferenceStatus: "ready",
  retrievalAugmentedGenerationStatus: "ready",
  retrievalAugmentedTaskStatus: "ready",
  contextLocalRuntimeStatus: "ready",
  contextComposerVersion: H2C_CONTEXT_COMPOSER_VERSION,
  contextComposerMigrationVersion: H2C_CONTEXT_MIGRATION_VERSION,
  priorityProfileVersion: "h2c-priority-v1",
  tokenBudgetProfile: "h2c-token-budget-v1",
  contextJobCount: "runtime_query_required",
  wholeNovelJobCount: "runtime_query_required",
  citationCoverage: "runtime_query_required",
  unsupportedClaimRate: "runtime_query_required",
  tokenOverflowCount: 0,
  branchLeakageCount: 0,
  canonicalMutationCount: 0,
  publicCorpusOptInViolationCount: 0,
  citationCoverageTarget: 0.9,
  unsupportedClaimRateTarget: 0.05,
  contextExternalRequestCount: 0,
  contextDataLeftDevice: false,
  contextCanonicalMutationStatus: "blocked",
  contextBranchLeakageStatus: "blocked",
  contextPublicCorpusOptInStatus: "ready",
  h2FullClosureStatus: "not_implemented",
};

export type ContextSourceScope = RetrievalSourceScope | "CURRENT_CHAPTER" | "CURRENT_SCENE" | "CURRENT_STAGE" | "CURRENT_BRANCH";
export type ContextTaskType =
  | "continueWithRetrievedContext"
  | "rewriteWithRetrievedContext"
  | "generateSceneWithRetrievedContext"
  | "brainstormWithRetrievedContext"
  | "consistencyCheckWithRetrievedContext"
  | "adultStageWithRetrievedContext"
  | "viralPlanWithRetrievedContext";

export type ContextCanonicalStatus = "approved" | "current_branch" | "current_scene" | "approved_version" | "draft" | "candidate" | "historical" | "superseded" | "reverted" | "deleted";

export type ContextItem = {
  contextItemId: string;
  sourceScope: ContextSourceScope;
  sourceType: string;
  sourceId: string;
  chunkId?: string;
  projectId: string;
  branchId: string;
  versionId?: string;
  canonicalStatus: ContextCanonicalStatus;
  visibility: string;
  retrievalScore: number;
  selectedReason: string;
  priority: number;
  tokenCount: number;
  text: string;
  citationLabel: string;
  policyVersion: string;
};

export type ContextTokenBudgetProfile = {
  modelContextLimit: number;
  reservedOutputTokens: number;
  safetyMargin: number;
  hardConstraintBudget: number;
  canonicalBudget: number;
  currentSceneBudget: number;
  currentStageBudget: number;
  relationshipBudget: number;
  eventBudget: number;
  worldRuleBudget: number;
  retrievalBudget: number;
  userLibraryBudget: number;
  publicCorpusBudget: number;
  compressionThreshold: number;
};

export type ContextCompositionRequest = {
  projectId: string;
  branchId?: string;
  taskType: ContextTaskType;
  queryText: string;
  userTask?: string;
  includePublicCorpus?: boolean;
  includeUserLibrary?: boolean;
  modelContextLimit?: number;
  reservedOutputTokens?: number;
  sourceScopes?: ContextSourceScope[];
};

export type ContextCompositionResult = {
  jobId: string;
  projectId: string;
  branchId: string;
  contextItems: ContextItem[];
  usedContextIds: string[];
  omittedContext: Array<{ contextItemId: string; reason: string; tokenCount: number }>;
  citations: Array<{ citationId: string; contextItemId: string; citationLabel: string; sourceScope: string; sourceId: string }>;
  conflicts: Array<{ conflictId: string; severity: string; unresolved: boolean; selectedItem?: string; selectionReason: string }>;
  tokenBudget: {
    totalAvailableTokens: number;
    reservedTokens: number;
    usedTokens: number;
    omittedTokens: number;
    compressedTokens: number;
    utilization: number;
    overflowPrevented: boolean;
    budgetBreakdown: Record<string, number>;
  };
  validation: {
    citationCoverage: number;
    unsupportedClaimRate: number;
    tokenOverflowCount: number;
    branchLeakageCount: number;
    canonicalMutationCount: number;
    publicCorpusOptInViolationCount: number;
    warnings: string[];
  };
  outputText: string;
  externalRequestCount: number;
  dataLeftDevice: boolean;
};

export type WholeNovelAnalysisResult = {
  jobId: string;
  premise: string;
  majorArcs: string[];
  majorEvents: string[];
  characterChanges: string[];
  relationshipChanges: string[];
  unresolvedThreads: string[];
  foreshadowing: string[];
  worldRuleChanges: string[];
  pacingNotes: string[];
  evidence: string[];
  externalRequestCount: number;
  dataLeftDevice: boolean;
};

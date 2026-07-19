export const TRAINING_SYSTEM_SCHEMA_VERSION = "closed-ai-training-system-v1";
export const PREFERENCE_EVENT_SCHEMA_VERSION = "closed-ai-preference-event-v1";
export const DATASET_REGISTRY_SCHEMA_VERSION = "closed-ai-dataset-registry-v1";
export const MODEL_REGISTRY_SCHEMA_VERSION = "closed-ai-model-registry-v1";
export const TRAINING_RUN_SCHEMA_VERSION = "closed-ai-training-run-v1";
export const EVALUATOR_RECORD_SCHEMA_VERSION = "closed-ai-evaluator-v1";
export const PROMOTION_DECISION_SCHEMA_VERSION = "closed-ai-promotion-v1";

export type PreferenceStatus = "observed" | "validated" | "approved_for_personalization" | "approved_for_shared_training" | "rejected" | "deleted";
export type TrainingLifecycleStatus = "collected" | "validated" | "cleaned" | "deduplicated" | "reviewed" | "approved" | "versioned" | "exported" | "trained" | "evaluated" | "promoted" | "rejected" | "rolled_back" | "deleted";
export type CapabilityLayer = "base_model_capability" | "retrieval_augmented_capability" | "memory_augmented_capability" | "workflow_augmented_capability" | "fine_tuned_capability";

export type PreferenceEvent = {
  schemaVersion: typeof PREFERENCE_EVENT_SCHEMA_VERSION;
  preferenceEventId: string;
  subjectId: string;
  storyId: string;
  taskType: string;
  promptSnapshot: string;
  candidateOutputs: string[];
  acceptedCandidate: string | null;
  rejectedCandidates: string[];
  discardedCandidates: string[];
  userEditedFinalOutput: string | null;
  editDiff: string | null;
  rating: number | null;
  reasonTags: string[];
  occurredAt: string;
  providerId: string;
  modelId: string | null;
  status: PreferenceStatus;
  consent: { personalizationAllowed: boolean; sharedTrainingAllowed: boolean };
  trainingEligibility: { personalization: boolean; shared: boolean };
  retentionPolicy: "delete_on_withdrawal" | "fixed_term" | "retain_approved";
  provenance: { sourceType: "private_user_content" | "synthetic" | "public_domain" | "licensed"; sourceRecordId: string; copyrightStatus: "cleared" | "restricted" | "unknown" } | null;
  datasetVersion: string | null;
  idempotencyKey: string;
  rollbackEvent: boolean;
  testAccount: boolean;
  systemError: boolean;
  completedReview: boolean;
  deletionRequestedAt: string | null;
};

export type DatasetRegistryEntry = {
  schemaVersion: typeof DATASET_REGISTRY_SCHEMA_VERSION;
  datasetId: string;
  version: string;
  ownerScope: { type: "personal" | "shared"; subjectId: string | null };
  lifecycleStatus: TrainingLifecycleStatus;
  sourceRecordIds: string[];
  contentHash: string;
  provenanceValidated: boolean;
  qualityScore: number;
  contaminationFlags: string[];
  deduplicationFingerprint: string;
  createdAt: string;
};

export type ModelRegistryEntry = {
  schemaVersion: typeof MODEL_REGISTRY_SCHEMA_VERSION;
  modelId: string;
  baseModelId: string;
  version: string;
  providerCompatibility: Array<"browser" | "local_ollama" | "private_hub">;
  capabilities: string[];
  contextLimit: number;
  precision: string;
  trainingMethod: "base" | "prompt_workflow" | "rag_memory" | "lora" | "preference_optimization" | "distillation";
  datasetVersion: string | null;
  benchmarkResultId: string | null;
  safetyResultId: string | null;
  deploymentStatus: "candidate" | "evaluated" | "approved" | "staged" | "production" | "deprecated" | "rolled_back";
  rollbackVersion: string | null;
  createdAt: string;
};

export type TrainingRun = {
  schemaVersion: typeof TRAINING_RUN_SCHEMA_VERSION;
  trainingRunId: string;
  method: "prompt_workflow" | "rag_memory" | "lora" | "preference_optimization" | "distillation";
  datasetId: string;
  datasetVersion: string;
  baseModelId: string;
  baseModelVersion: string;
  hyperparameterProfile: string | null;
  hardwareProfile: string | null;
  checkpointId: string | null;
  evaluatorVersion: string;
  benchmarkVersion: string;
  status: "contract_only" | "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string;
};

export type EvaluatorRecord = {
  schemaVersion: typeof EVALUATOR_RECORD_SCHEMA_VERSION;
  evaluationId: string;
  evaluatorId: string;
  evaluatorVersion: string;
  methods: Array<"deterministic_rules" | "specialist_evaluator" | "human_review" | "multi_evaluator_aggregation">;
  targetType: "sample" | "dataset" | "training_run" | "model";
  targetId: string;
  datasetVersion: string | null;
  trainingRunId: string | null;
  benchmarkVersion: string;
  scores: Record<string, number>;
  privacyFailures: number;
  closedOnlyFailures: number;
  safetyFailures: number;
  createdAt: string;
};

export type PromotionDecision = {
  schemaVersion: typeof PROMOTION_DECISION_SCHEMA_VERSION;
  modelId: string;
  candidateVersion: string;
  currentProductionVersion: string | null;
  benchmarkDelta: number;
  worstCaseDelta: number;
  regressionFailures: number;
  privacyFailures: number;
  closedOnlyFailures: number;
  safetyFailures: number;
  latencyWithinLimit: boolean;
  memoryWithinLimit: boolean;
  gpuWithinLimit: boolean;
  humanApproved: boolean;
  datasetApproved: boolean;
  decision: "approved" | "rejected";
  errorCodes: string[];
};

const lifecycleOrder: TrainingLifecycleStatus[] = ["collected", "validated", "cleaned", "deduplicated", "reviewed", "approved", "versioned", "exported", "trained", "evaluated", "promoted"];

export function validatePreferenceEvent(value: PreferenceEvent) {
  if (value.schemaVersion !== PREFERENCE_EVENT_SCHEMA_VERSION) return { valid: false, errorCode: "PREFERENCE_SCHEMA_UNSUPPORTED" };
  if (!value.preferenceEventId || !value.subjectId || !value.storyId || !value.idempotencyKey) return { valid: false, errorCode: "PREFERENCE_IDENTITY_REQUIRED" };
  if (!value.provenance) return { valid: false, errorCode: "PREFERENCE_PROVENANCE_REQUIRED" };
  if (value.status === "deleted" || value.deletionRequestedAt) return { valid: false, errorCode: "PREFERENCE_DELETED" };
  if (value.status === "rejected") return { valid: false, errorCode: "PREFERENCE_REJECTED" };
  if (value.rollbackEvent || value.systemError || value.testAccount || !value.completedReview) return { valid: false, errorCode: "PREFERENCE_EVENT_INELIGIBLE" };
  if (value.providerId === "deterministic-local" || value.providerId.startsWith("test-")) return { valid: false, errorCode: "PREFERENCE_TEST_PROVIDER_INELIGIBLE" };
  if (value.trainingEligibility.personalization && !value.consent.personalizationAllowed) return { valid: false, errorCode: "PREFERENCE_PERSONAL_CONSENT_REQUIRED" };
  if (value.trainingEligibility.shared && (!value.consent.sharedTrainingAllowed || value.status !== "approved_for_shared_training")) return { valid: false, errorCode: "PREFERENCE_SHARED_CONSENT_REQUIRED" };
  if (value.provenance.sourceType === "private_user_content" && value.trainingEligibility.shared && value.provenance.copyrightStatus !== "cleared") return { valid: false, errorCode: "PREFERENCE_PRIVATE_EXPORT_FORBIDDEN" };
  return { valid: true, errorCode: null };
}

export function validateModelRegistryEntry(value: ModelRegistryEntry) {
  if (value.schemaVersion !== MODEL_REGISTRY_SCHEMA_VERSION) return { valid: false, errorCode: "MODEL_REGISTRY_SCHEMA_UNSUPPORTED" };
  if (!value.modelId || !value.baseModelId || !value.version) return { valid: false, errorCode: "MODEL_REGISTRY_IDENTITY_REQUIRED" };
  if (!value.providerCompatibility.length || !value.capabilities.length || value.contextLimit <= 0) return { valid: false, errorCode: "MODEL_REGISTRY_PROFILE_INVALID" };
  if (value.deploymentStatus === "production" && (!value.benchmarkResultId || !value.safetyResultId)) return { valid: false, errorCode: "MODEL_REGISTRY_PRODUCTION_EVIDENCE_REQUIRED" };
  return { valid: true, errorCode: null };
}

export function validateTrainingLifecycleTransition(from: TrainingLifecycleStatus, to: TrainingLifecycleStatus) {
  if (["rejected", "rolled_back", "deleted"].includes(to)) return { valid: true, errorCode: null };
  const fromIndex = lifecycleOrder.indexOf(from);
  const toIndex = lifecycleOrder.indexOf(to);
  if (fromIndex < 0 || toIndex !== fromIndex + 1) return { valid: false, errorCode: "TRAINING_LIFECYCLE_TRANSITION_INVALID" };
  return { valid: true, errorCode: null };
}

export function validateDatasetEntry(value: DatasetRegistryEntry) {
  if (value.schemaVersion !== DATASET_REGISTRY_SCHEMA_VERSION) return { valid: false, errorCode: "DATASET_SCHEMA_UNSUPPORTED" };
  if (!value.datasetId || !value.version || !value.contentHash || !value.sourceRecordIds.length) return { valid: false, errorCode: "DATASET_IDENTITY_REQUIRED" };
  if (!value.provenanceValidated) return { valid: false, errorCode: "DATASET_PROVENANCE_INVALID" };
  if (value.contaminationFlags.length) return { valid: false, errorCode: "DATASET_CONTAMINATION_DETECTED" };
  if (value.ownerScope.type === "personal" && !value.ownerScope.subjectId) return { valid: false, errorCode: "DATASET_OWNER_REQUIRED" };
  return { valid: true, errorCode: null };
}

export function assertImmutableRegistryVersion<T>(entries: T[], candidate: T, key: (value: T) => string, errorCode: string) {
  if (entries.some((entry) => key(entry) === key(candidate))) return { valid: false, errorCode };
  return { valid: true, errorCode: null };
}

export function canReadDataset(entry: DatasetRegistryEntry, subjectId: string) {
  return entry.ownerScope.type === "shared" || entry.ownerScope.subjectId === subjectId;
}

export function validateTrainingRun(value: TrainingRun) {
  if (value.schemaVersion !== TRAINING_RUN_SCHEMA_VERSION) return { valid: false, errorCode: "TRAINING_RUN_SCHEMA_UNSUPPORTED" };
  if (!value.trainingRunId || !value.datasetId || !value.datasetVersion) return { valid: false, errorCode: "TRAINING_RUN_DATASET_REQUIRED" };
  if (!value.baseModelId || !value.baseModelVersion) return { valid: false, errorCode: "TRAINING_RUN_BASE_MODEL_REQUIRED" };
  if (!value.evaluatorVersion || !value.benchmarkVersion) return { valid: false, errorCode: "TRAINING_RUN_EVALUATION_CONTRACT_REQUIRED" };
  return { valid: true, errorCode: null };
}

export function validateEvaluatorRecord(value: EvaluatorRecord) {
  if (value.schemaVersion !== EVALUATOR_RECORD_SCHEMA_VERSION) return { valid: false, errorCode: "EVALUATOR_SCHEMA_UNSUPPORTED" };
  if (!value.evaluationId || !value.evaluatorId || !value.evaluatorVersion || !value.targetId || !value.benchmarkVersion) return { valid: false, errorCode: "EVALUATOR_TRACE_REQUIRED" };
  if (!value.methods.length) return { valid: false, errorCode: "EVALUATOR_METHOD_REQUIRED" };
  return { valid: true, errorCode: null };
}

export function evaluatePromotionGate(input: Omit<PromotionDecision, "schemaVersion" | "decision" | "errorCodes">): PromotionDecision {
  const errorCodes: string[] = [];
  if (input.benchmarkDelta < 0 || input.worstCaseDelta < 0 || input.regressionFailures) errorCodes.push("PROMOTION_BENCHMARK_REGRESSION");
  if (input.privacyFailures) errorCodes.push("PROMOTION_PRIVACY_FAILURE");
  if (input.closedOnlyFailures) errorCodes.push("PROMOTION_CLOSED_ONLY_FAILURE");
  if (input.safetyFailures) errorCodes.push("PROMOTION_SAFETY_FAILURE");
  if (!input.latencyWithinLimit || !input.memoryWithinLimit || !input.gpuWithinLimit) errorCodes.push("PROMOTION_RESOURCE_LIMIT_EXCEEDED");
  if (!input.humanApproved || !input.datasetApproved) errorCodes.push("PROMOTION_APPROVAL_REQUIRED");
  return { ...input, schemaVersion: PROMOTION_DECISION_SCHEMA_VERSION, decision: errorCodes.length ? "rejected" : "approved", errorCodes };
}

export function validateRollbackTarget(current: ModelRegistryEntry, target: ModelRegistryEntry) {
  if (current.modelId !== target.modelId) return { valid: false, errorCode: "ROLLBACK_MODEL_MISMATCH" };
  if (!current.rollbackVersion || current.rollbackVersion !== target.version) return { valid: false, errorCode: "ROLLBACK_TARGET_MISMATCH" };
  if (!['approved', 'production', 'deprecated'].includes(target.deploymentStatus)) return { valid: false, errorCode: "ROLLBACK_TARGET_NOT_APPROVED" };
  return { valid: true, errorCode: null };
}

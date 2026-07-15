export const INTIMACY_SCHEMA_VERSION = "h2p3-segmented-scene-state-machine-v1";
export const INTIMACY_MIGRATION_VERSION = "016_segmented_scene_state_machine";

export const SCENE_STATUSES = ["planned", "ready", "active", "paused", "completed", "cancelled", "blocked", "archived"] as const;
export type IntimacySceneStatus = typeof SCENE_STATUSES[number];

export const STAGE_TYPES = ["setup", "approach", "consent", "escalation", "explicit", "peak", "deescalation", "aftermath"] as const;
export type IntimacyStageType = typeof STAGE_TYPES[number];

export const STAGE_STATUSES = ["planned", "ready", "active", "paused", "draft_ready", "approved", "rejected", "failed", "cancelled", "superseded", "archived", "skipped"] as const;
export type IntimacyStageStatus = typeof STAGE_STATUSES[number];

export const BRANCH_STATUSES = ["active", "paused", "completed", "rejected", "archived"] as const;
export type IntimacyBranchStatus = typeof BRANCH_STATUSES[number];

export const VERSION_OPERATIONS = ["initial", "rewrite", "regenerate", "extend", "shorten", "changeTone", "changePerspective", "changePacing", "split", "merge", "restore", "rollback"] as const;
export type IntimacyVersionOperation = typeof VERSION_OPERATIONS[number];

export type IntimacyParticipantInput = {
  characterId: string;
  role: string;
  verifiedAdultStatus: "verified_adult" | "unknown" | "verified_minor" | "conflicting" | "revoked";
  relationshipId?: string;
  relationshipStage?: string;
  consentState: "active" | "unspecified" | "withdrawn" | "invalid";
  required?: boolean;
};

export type IntimacyScene = {
  sceneId: string;
  projectId: string;
  chapterId?: string;
  branchId: string;
  scenarioPackId?: string;
  policyVersion: number;
  rating: string;
  explicitness: number;
  title: string;
  purpose: string;
  status: IntimacySceneStatus;
  currentStageId?: string;
  currentStageType?: IntimacyStageType;
  plannedStageCount: number;
  approvedStageCount: number;
  participantCount: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  version: number;
};

export type IntimacyStage = {
  stageId: string;
  sceneId: string;
  projectId: string;
  branchId: string;
  stageType: IntimacyStageType;
  ordinal: number;
  title: string;
  goal: string;
  targetLength: number;
  status: IntimacyStageStatus;
  currentVersionId?: string;
  previousStageId?: string;
  nextStageId?: string;
  required: boolean;
  skippable: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type IntimacyStageVersion = {
  versionId: string;
  stageId: string;
  sceneId: string;
  projectId: string;
  branchId: string;
  parentVersionId?: string;
  operation: IntimacyVersionOperation;
  status: "draft" | "current" | "approved" | "rejected" | "superseded" | "restored" | "archived";
  goalSnapshot: string;
  continuityInputHash: string;
  policyVersion: number;
  promptTemplateVersion: string;
  draftText: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  supersededAt?: string;
};

export type IntimacyContinuityState = {
  continuityId: string;
  projectId: string;
  sceneId: string;
  stageId?: string;
  versionId?: string;
  branchId: string;
  participantPositions: Record<string, string>;
  participantEmotions: Record<string, string>;
  relationshipState: Record<string, string>;
  trustState: Record<string, number>;
  attractionState: Record<string, number>;
  conflictState: string;
  objectState: Record<string, string>;
  locationState: string;
  timeState: string;
  dialogueCommitments: string[];
  completedActions: string[];
  unresolvedActions: string[];
  forbiddenRepetitions: string[];
  requiredNextBeat: string;
  consentState: string;
  withdrawalState: string;
  narrativePurposeProgress: string;
  continuityVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type IntimacyBranch = {
  branchId: string;
  sceneId: string;
  projectId: string;
  parentBranchId?: string;
  divergenceStageId?: string;
  divergenceVersionId?: string;
  branchName: string;
  branchStatus: IntimacyBranchStatus;
  continuitySnapshotId?: string;
  policyVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type IntimacyValidationResult = {
  ok: boolean;
  issues: Array<{ code: string; severity: "info" | "warning" | "blocking"; message: string; subjectId?: string }>;
  dataLeftDevice: false;
  externalRequestCount: 0;
};

export type IntimacyScenePlanInput = {
  projectId: string;
  chapterId?: string;
  scenarioPackId?: string;
  policyVersion: number;
  rating: string;
  explicitness: number;
  title: string;
  purpose: string;
  participants: IntimacyParticipantInput[];
  stageTypes?: IntimacyStageType[];
  narrativePurpose?: string;
  consequencePlan?: string;
};

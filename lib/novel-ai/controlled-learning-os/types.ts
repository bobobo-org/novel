import type { ClosedAINamespace } from "../closed-ai-cache";

export const CONTROLLED_LEARNING_SCHEMA_VERSION = "controlled-learning-os-v1" as const;

export type ControlledLearningLevel = "L0" | "L1" | "L2" | "L3";
export type ControlledLearningOutcome =
  | "accepted"
  | "rejected"
  | "edited"
  | "final_choice"
  | "consistency_result"
  | "tool_result"
  | "planner_result"
  | "approved_story_bible"
  | "approved_canon"
  | "abandoned";

export type ControlledLearningRecordKind =
  | "consent"
  | "kill-switch"
  | "experience"
  | "candidate"
  | "version"
  | "ab-test"
  | "dataset";

export type ControlledLearningConsent = {
  schemaVersion: typeof CONTROLLED_LEARNING_SCHEMA_VERSION;
  kind: "consent";
  id: string;
  projectId: string;
  namespace: ClosedAINamespace;
  enabled: boolean;
  allowedLevels: Array<"L0" | "L1">;
  allowedOutcomes: ControlledLearningOutcome[];
  consentedAt: string;
  expiresAt: string | null;
  revision: number;
};

export type ControlledLearningKillSwitch = {
  schemaVersion: typeof CONTROLLED_LEARNING_SCHEMA_VERSION;
  kind: "kill-switch";
  id: string;
  projectId: string;
  engaged: boolean;
  reasonCode: string | null;
  updatedAt: string;
  revision: number;
};

export type ControlledLearningExperience = {
  schemaVersion: typeof CONTROLLED_LEARNING_SCHEMA_VERSION;
  kind: "experience";
  id: string;
  projectId: string;
  namespace: ClosedAINamespace;
  outcome: ControlledLearningOutcome;
  outcomeLabel: "positive" | "negative" | "edited" | "verified";
  taskType: string;
  featureDigest: string;
  resultDigest: string | null;
  editDistance: number | null;
  score: number | null;
  tags: string[];
  sourceApprovalId: string | null;
  abandonedAsNegativeOnly: boolean;
  rawInputStored: false;
  rawOutputStored: false;
  rawChainOfThoughtStored: false;
  createdAt: string;
};

export type ControlledLearningCandidateStatus =
  | "candidate"
  | "evaluated"
  | "approved"
  | "testing"
  | "adopted"
  | "rejected"
  | "rolled_back";

export type ControlledLearningCandidate = {
  schemaVersion: typeof CONTROLLED_LEARNING_SCHEMA_VERSION;
  kind: "candidate";
  id: string;
  projectId: string;
  namespace: ClosedAINamespace;
  level: "L0" | "L1";
  candidateType:
    | "preference"
    | "planner-policy"
    | "tool-policy"
    | "retrieval-policy"
    | "approved-rule-pack"
    | "knowledge-rule-pack";
  status: ControlledLearningCandidateStatus;
  experienceIds: string[];
  proposal: Record<string, string | number | boolean>;
  proposalDigest: string;
  evaluation: {
    score: number;
    sampleCount: number;
    blockingCodes: string[];
    evaluatedAt: string;
  } | null;
  humanApproval: {
    approvedBy: string;
    approvalId: string;
    approvedAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
};

export type ControlledKnowledgeRule = {
  id: string;
  category:
    | "structure"
    | "character"
    | "world"
    | "pacing"
    | "dialogue"
    | "continuity"
    | "style"
    | "safety";
  statement: string;
};

export type ControlledKnowledgeTransformation = {
  candidate: ControlledLearningCandidate;
  sourceDigest: string;
  transformationDigest: string;
  ruleCount: number;
  sourceContentStored: false;
  verbatimCopyStored: false;
  copyingRiskCheck: "passed";
};

export type ControlledLearningVersion = {
  schemaVersion: typeof CONTROLLED_LEARNING_SCHEMA_VERSION;
  kind: "version";
  id: string;
  projectId: string;
  namespace: ClosedAINamespace;
  version: number;
  candidateId: string;
  status: "active" | "superseded" | "rolled_back";
  configuration: Record<string, string | number | boolean>;
  configurationDigest: string;
  parentVersionId: string | null;
  adoptedAt: string;
  rolledBackAt: string | null;
};

export type ControlledLearningABTest = {
  schemaVersion: typeof CONTROLLED_LEARNING_SCHEMA_VERSION;
  kind: "ab-test";
  id: string;
  projectId: string;
  namespace: ClosedAINamespace;
  candidateId: string;
  baselineVersionId: string | null;
  status: "running" | "passed" | "failed" | "cancelled";
  minimumSamples: number;
  requiredImprovement: number;
  baselineScores: number[];
  candidateScores: number[];
  createdAt: string;
  completedAt: string | null;
};

export type ControlledLearningDataset = {
  schemaVersion: typeof CONTROLLED_LEARNING_SCHEMA_VERSION;
  kind: "dataset";
  id: string;
  projectId: string;
  namespace: ClosedAINamespace;
  level: "L0" | "L1";
  experienceIds: string[];
  contentDigest: string;
  status: "candidate" | "approved" | "revoked";
  rawContentStored: false;
  createdAt: string;
  approvedAt: string | null;
  revokedAt: string | null;
};

export type ControlledLearningRecord =
  | ControlledLearningConsent
  | ControlledLearningKillSwitch
  | ControlledLearningExperience
  | ControlledLearningCandidate
  | ControlledLearningVersion
  | ControlledLearningABTest
  | ControlledLearningDataset;

export type ControlledLearningExport = {
  schemaVersion: typeof CONTROLLED_LEARNING_SCHEMA_VERSION;
  projectId: string;
  exportedAt: string;
  records: ControlledLearningRecord[];
  rawContentIncluded: false;
  contentDigest: string;
};

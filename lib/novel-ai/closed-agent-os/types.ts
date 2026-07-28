import type {
  ClosedAINamespace,
  ClosedAIPrivacyLevel,
} from "../closed-ai-cache";
import type { PlatformTaskType } from "../router/platform-types";

export const CLOSED_AGENT_OS_SCHEMA_VERSION = "closed-agent-os-v1" as const;

export const CLOSED_AI_BACKEND_IDS = [
  "browser-ai",
  "local-ollama",
  "private-ai-hub",
] as const;

export type ClosedAIBackendId = (typeof CLOSED_AI_BACKEND_IDS)[number];
export type ClosedAITaskComplexity = "light" | "standard" | "heavy";
export type ClosedAgentRole =
  | "planner"
  | "story-architect"
  | "actor"
  | "character-agent"
  | "world-agent"
  | "continuity-agent"
  | "critic"
  | "evaluator";

export type ClosedAIBackendStatus =
  | "ready"
  | "runtime_required"
  | "contract_ready_runtime_not_connected"
  | "disabled"
  | "degraded";

export type ClosedAIBackendSnapshot = {
  id: ClosedAIBackendId;
  label: string;
  status: ClosedAIBackendStatus;
  modelId: string | null;
  modelDigest: string | null;
  local: boolean;
  dataBoundary: "device" | "private-infrastructure";
  maximumComplexity: ClosedAITaskComplexity;
  capabilities: string[];
  supportedTaskTypes: PlatformTaskType[] | "all";
  detailCode: string;
};

export type ClosedAIContextItem = {
  id: string;
  kind: "canon" | "story-bible" | "retrieval" | "memory" | "author-note" | "evaluator-note";
  text: string;
  visibility: "actor" | "evaluator" | "both" | "author-only";
  privacyLevel: ClosedAIPrivacyLevel;
  approved: boolean;
};

export type ClosedAgentTaskRequest = {
  taskId: string;
  namespace: ClosedAINamespace;
  taskType: PlatformTaskType;
  objective: string;
  context: ClosedAIContextItem[];
  complexity?: ClosedAITaskComplexity;
  preferredBackend?: ClosedAIBackendId;
  allowedToolIds: string[];
  permissionScopes: string[];
  learningConfiguration?: Record<string, string | number | boolean>;
  signal?: AbortSignal;
};

export type ClosedAgentPlanStep = {
  index: number;
  role: ClosedAgentRole;
  objective: string;
  allowedToolIds: string[];
  inputVisibility: Array<ClosedAIContextItem["visibility"]>;
};

export type ClosedAgentPlan = {
  schemaVersion: typeof CLOSED_AGENT_OS_SCHEMA_VERSION;
  taskId: string;
  complexity: ClosedAITaskComplexity;
  backendId: ClosedAIBackendId;
  roles: ClosedAgentRole[];
  steps: ClosedAgentPlanStep[];
  planDigest: string;
  candidateOnly: true;
};

export type ClosedAgentTool = {
  id: string;
  label: string;
  capability:
    | "canon-read"
    | "story-bible-read"
    | "retrieval"
    | "candidate-transform"
    | "local-metadata";
  requiredScopes: string[];
  localOnly: true;
  projectBound: true;
  execute(input: {
    namespace: ClosedAINamespace;
    taskId: string;
    payload: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<unknown>;
};

export type ClosedBackendExecutionInput = {
  request: ClosedAgentTaskRequest;
  plan: ClosedAgentPlan;
  actorContext: ClosedAIContextItem[];
  toolResults: Array<{ toolId: string; value: unknown }>;
};

export type ClosedBackendExecutionResult = {
  backendId: ClosedAIBackendId;
  modelId: string;
  modelDigest: string;
  content: string;
  candidateOnly: true;
  dataLeftDevice: boolean;
  externalRequest: boolean;
  elapsedMs: number;
};

export interface ClosedAIBackendAdapter {
  readonly id: ClosedAIBackendId;
  snapshot(signal?: AbortSignal): Promise<ClosedAIBackendSnapshot>;
  execute(input: ClosedBackendExecutionInput): Promise<ClosedBackendExecutionResult>;
}

export type ClosedAgentEvaluation = {
  passed: boolean;
  score: number;
  blockingCodes: string[];
  warningCodes: string[];
  evaluatorInputDigest: string;
  rawChainOfThoughtStored: false;
};

export type ClosedAgentCandidate = {
  schemaVersion: typeof CLOSED_AGENT_OS_SCHEMA_VERSION;
  kind: "candidate";
  id: string;
  projectId: string;
  taskId: string;
  namespace: ClosedAINamespace;
  backendId: ClosedAIBackendId;
  modelId: string;
  modelDigest: string;
  content: string;
  contentDigest: string;
  planDigest: string;
  evaluation: ClosedAgentEvaluation;
  status: "awaiting-approval" | "approved" | "rejected" | "committed" | "rolled-back";
  candidateOnly: true;
  canonicalMutationCount: 0 | 1;
  createdAt: string;
  updatedAt: string;
};

export type ClosedAgentTaskRecord = {
  schemaVersion: typeof CLOSED_AGENT_OS_SCHEMA_VERSION;
  kind: "task";
  id: string;
  projectId: string;
  namespace: ClosedAINamespace;
  taskType: PlatformTaskType;
  backendId: ClosedAIBackendId | null;
  state: "queued" | "running" | "awaiting-approval" | "completed" | "failed" | "cancelled";
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ClosedAgentApprovalRecord = {
  schemaVersion: typeof CLOSED_AGENT_OS_SCHEMA_VERSION;
  kind: "approval";
  id: string;
  projectId: string;
  namespace: ClosedAINamespace;
  candidateId: string;
  approvedBy: string;
  approvalBlockHash: string;
  canonicalCommitId: string | null;
  approvedAt: string;
};

export type ClosedAgentMemoryRecord = {
  schemaVersion: typeof CLOSED_AGENT_OS_SCHEMA_VERSION;
  kind: "memory";
  id: string;
  projectId: string;
  namespace: ClosedAINamespace;
  candidateId: string;
  content: string;
  contentDigest: string;
  approvalId: string;
  approvedAt: string;
  canonical: boolean;
};

export type ClosedAgentStateRecord =
  | ClosedAgentCandidate
  | ClosedAgentTaskRecord
  | ClosedAgentApprovalRecord
  | ClosedAgentMemoryRecord;

export type ClosedAgentExecutionResult = {
  task: ClosedAgentTaskRecord;
  candidate: ClosedAgentCandidate;
  plan: ClosedAgentPlan;
  route: {
    backendId: ClosedAIBackendId;
    locked: true;
    automatic: boolean;
    reasonCode: string;
    fallbackAttempted: false;
  };
  cache: {
    candidateHit: boolean;
    planHit: boolean;
  };
  learning: {
    applied: boolean;
    versionId: string | null;
    configurationDigest: string | null;
    reasonCode: string | null;
  };
  ledgerHeadHash: string;
};

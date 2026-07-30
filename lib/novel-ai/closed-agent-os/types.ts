import type {
  ClosedAICacheInvalidation,
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
export type ClosedAIQualityMode = "fast" | "balanced" | "deep";
export type ClosedAIQualityPhase = "draft" | "critic" | "revision";
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
  maxContext?: number;
  controlLatencyMs?: number | null;
};

export type ClosedAIProgressPhase =
  | "queued"
  | "probing"
  | "routing"
  | "planning"
  | "retrieving"
  | "generating"
  | "critiquing"
  | "revising"
  | "evaluating"
  | "awaiting-approval"
  | "failed"
  | "cancelled";

export type ClosedAIProgressEvent = {
  taskId: string;
  phase: ClosedAIProgressPhase;
  label: string;
  percent: number;
  occurredAt: string;
  backendId?: ClosedAIBackendId;
  generatedCharacters?: number;
  cacheHit?: boolean;
};

export type ClosedAIContextItem = {
  id: string;
  kind: "canon" | "story-bible" | "retrieval" | "memory" | "author-note" | "evaluator-note";
  learningFacet?:
    | "character-knowledge"
    | "relationship-event"
    | "story-bible"
    | "general";
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
  qualityMode?: ClosedAIQualityMode;
  preferredBackend?: ClosedAIBackendId;
  allowedToolIds: string[];
  permissionScopes: string[];
  learningConfiguration?: Record<string, string | number | boolean>;
  contextDigest?: string;
  contextSourceSummary?: string;
  sourceChapterId?: string;
  sourceRevision?: number;
  signal?: AbortSignal;
  onProgress?: (event: ClosedAIProgressEvent) => void;
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
  qualityMode: ClosedAIQualityMode;
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
    taskType: PlatformTaskType;
    objective: string;
    approvedContext: ClosedAIContextItem[];
    payload: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<unknown>;
};

export type ClosedAIWorkingMaterial = {
  kind: "draft" | "critic";
  text: string;
  digest: string;
};

export type ClosedBackendExecutionInput = {
  request: ClosedAgentTaskRequest;
  plan: ClosedAgentPlan;
  actorContext: ClosedAIContextItem[];
  toolResults: Array<{ toolId: string; value: unknown }>;
  qualityPhase: ClosedAIQualityPhase;
  workingMaterials: ClosedAIWorkingMaterial[];
};

export type ClosedBackendExecutionResult = {
  backendId: ClosedAIBackendId;
  modelId: string;
  modelDigest: string;
  adapterId?: string | null;
  adapterDigest?: string | null;
  content: string;
  candidateOnly: true;
  dataLeftDevice: boolean;
  externalRequest: boolean;
  elapsedMs: number;
  profileId?: string;
  firstTokenMs?: number | null;
  inputCharacters?: number;
  outputCharacters?: number;
  generatedTokenEvents?: number;
  omittedInputCharacters?: number;
  qualityMode: ClosedAIQualityMode;
  qualityPasses: number;
  draftDigest: string | null;
  criticDigest: string | null;
};

export interface ClosedAIBackendAdapter {
  readonly id: ClosedAIBackendId;
  snapshot(
    signal?: AbortSignal,
    namespace?: Pick<ClosedAINamespace, "projectId">,
  ): Promise<ClosedAIBackendSnapshot>;
  execute(input: ClosedBackendExecutionInput): Promise<ClosedBackendExecutionResult>;
  invalidateCache?(
    invalidation: ClosedAICacheInvalidation,
    signal?: AbortSignal,
  ): Promise<number>;
}

export type ClosedAgentEvaluation = {
  passed: boolean;
  score: number;
  blockingCodes: string[];
  warningCodes: string[];
  evaluatorInputDigest: string;
  rawChainOfThoughtStored: false;
};

export type ClosedAIExecutionReceipt = {
  taskId: string;
  backendId: ClosedAIBackendId;
  modelId: string;
  modelDigest: string;
  startedAt: string;
  completedAt: string;
  generatedTokenEvents: number;
  outputCharacters: number;
  contentDigest: string;
  contextDigest: string;
  proofState: "verified";
  dataLeftDevice: boolean;
  externalRequest: boolean;
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
  adapterId?: string | null;
  adapterDigest?: string | null;
  content: string;
  contentDigest: string;
  sourceChapterId: string | null;
  sourceRevision: number | null;
  actualExecutor: ClosedAIBackendId | "not_executed";
  executionReceipt: ClosedAIExecutionReceipt | null;
  contextDigest?: string;
  contextSourceSummary?: string;
  dataLeftDevice?: boolean;
  externalRequest?: boolean;
  planDigest: string;
  evaluation: ClosedAgentEvaluation;
  status: "awaiting-approval" | "approved" | "rejected" | "committed" | "rolled-back";
  candidateOnly: true;
  canonicalMutationCount: 0 | 1;
  generationTelemetry?: {
    profileId: string;
    elapsedMs: number;
    firstTokenMs: number | null;
    inputCharacters: number;
    outputCharacters: number;
    generatedTokenEvents: number;
    omittedInputCharacters: number;
    qualityMode: ClosedAIQualityMode;
    qualityPasses: number;
    draftDigest: string | null;
    criticDigest: string | null;
  };
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

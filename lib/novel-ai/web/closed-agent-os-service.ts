import {
  ClosedAgentOS,
  taskComplexity,
  type ClosedAIBackendId,
  type ClosedAIContextItem,
  type ClosedAIProgressEvent,
  type ClosedAIQualityMode,
  type ClosedAgentExecutionResult,
} from "../closed-agent-os";
import type { ClosedAINamespace } from "../closed-ai-cache";
import type { PlatformTaskType } from "../router/platform-types";
import { createNovelRepository } from "../repository";
import {
  createStudioClosedAgentToolRegistry,
  STUDIO_CLOSED_AGENT_TOOL_IDS,
} from "./studio-closed-agent-tools";
import { ClosedAIRuntimeCoordinator } from "./closed-ai-runtime-coordinator";
import { composeProjectContext } from "./project-context-composer";

export const STUDIO_CLOSED_AGENT_PERMISSION_SCOPES = [
  "story:read",
  "story-bible:read",
  "candidate:write",
  "candidate:read",
  "evaluation:write",
  "character:read",
  "world:read",
] as const;

let studioClosedAgentOS: ClosedAgentOS | null = null;
let studioClosedAIRuntime:
  | { origin: string; coordinator: ClosedAIRuntimeCoordinator }
  | null = null;

export function getStudioClosedAgentOS() {
  studioClosedAgentOS ??= new ClosedAgentOS({
    tools: createStudioClosedAgentToolRegistry(),
  });
  return studioClosedAgentOS;
}

export function getStudioClosedAIRuntimeCoordinator(
  origin = typeof window === "undefined"
    ? "https://novel-orcin.vercel.app"
    : window.location.origin,
) {
  if (!studioClosedAIRuntime || studioClosedAIRuntime.origin !== origin) {
    const os = getStudioClosedAgentOS();
    studioClosedAIRuntime = {
      origin,
      coordinator: new ClosedAIRuntimeCoordinator({
        origin,
        snapshotReader: (signal, namespace) =>
          os.backendSnapshots(signal, namespace),
      }),
    };
  }
  return studioClosedAIRuntime.coordinator;
}

export type StudioClosedAgentContext = Omit<
  ClosedAIContextItem,
  "privacyLevel" | "approved"
> & {
  privacyLevel?: ClosedAIContextItem["privacyLevel"];
  approved?: boolean;
};

export type ExecuteStudioClosedAgentInput = {
  projectId: string;
  taskType: PlatformTaskType;
  objective: string;
  context?: StudioClosedAgentContext[];
  preferredBackend?: ClosedAIBackendId;
  qualityMode?: ClosedAIQualityMode;
  storyId?: string;
  canonId?: string;
  branchId?: string;
  characterId?: string;
  agentRole?: string;
  promptProfileVersion?: string;
  storyBibleRevision?: string | number;
  knowledgeScopeRevision?: string | number;
  taskId?: string;
  contextTokenBudget?: number;
  signal?: AbortSignal;
  onProgress?: (event: ClosedAIProgressEvent) => void;
};

export async function executeStudioClosedAgent(
  input: ExecuteStudioClosedAgentInput,
): Promise<ClosedAgentExecutionResult> {
  const os = getStudioClosedAgentOS();
  const complexity = taskComplexity(input.taskType);
  const privacyLevel = complexity === "heavy"
    ? "private_infrastructure_only"
    : "device_only";
  const namespace: ClosedAINamespace = {
    tenantId: "local-tenant",
    userId: "local-author",
    projectId: input.projectId,
    storyId: input.storyId ?? input.projectId,
    canonId: input.canonId ?? `canon:${input.projectId}`,
    branchId: input.branchId ?? "main",
    characterId: input.characterId ?? "shared",
    agentRole: input.agentRole ?? "closed-agent-os",
    modelId: "unrouted:runtime-managed",
    modelDigest: "unrouted:digest-runtime-managed",
    promptProfileVersion: input.promptProfileVersion ?? "studio-closed-agent-v3",
    storyBibleRevision: String(input.storyBibleRevision ?? "current"),
    knowledgeScopeRevision: String(input.knowledgeScopeRevision ?? "current"),
    privacyLevel,
  };
  const supplementalContext = (input.context ?? []).map((item) => ({
    ...item,
    privacyLevel: item.privacyLevel ?? privacyLevel,
    approved: item.approved ?? true,
  }));
  const composed = await composeProjectContext({
    repository: createNovelRepository(),
    taskType: input.taskType,
    projectId: input.projectId,
    storyId: input.storyId,
    canonId: input.canonId,
    branchId: input.branchId,
    characterId: input.characterId,
    revision: input.storyBibleRevision,
    privacyLevel,
    tokenBudget: input.contextTokenBudget,
    audience: "actor",
    supplementalContext,
  });

  return os.execute({
    taskId: input.taskId ?? `studio-closed-agent:${crypto.randomUUID()}`,
    namespace,
    taskType: input.taskType,
    objective: input.objective.trim(),
    context: composed.context,
    contextDigest: composed.contextDigest,
    contextSourceSummary: JSON.stringify(composed.contextSourceSummary),
    complexity,
    qualityMode: input.qualityMode,
    preferredBackend: input.preferredBackend,
    allowedToolIds: [...STUDIO_CLOSED_AGENT_TOOL_IDS],
    permissionScopes: [...STUDIO_CLOSED_AGENT_PERMISSION_SCOPES],
    signal: input.signal,
    onProgress: input.onProgress,
  });
}

export async function approveStudioClosedAgentCandidate(input: {
  candidateId: string;
  canonicalCommit?: Parameters<ClosedAgentOS["approveCandidate"]>[0]["canonicalCommit"];
}) {
  return getStudioClosedAgentOS().approveCandidate({
    candidateId: input.candidateId,
    approvedBy: "local-author",
    humanApproved: true,
    canonicalCommit: input.canonicalCommit,
  });
}

export function rejectStudioClosedAgentCandidate(candidateId: string) {
  return getStudioClosedAgentOS().rejectCandidate(candidateId);
}

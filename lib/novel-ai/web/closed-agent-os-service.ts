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
import {
  createStudioClosedAgentToolRegistry,
  STUDIO_CLOSED_AGENT_TOOL_IDS,
} from "./studio-closed-agent-tools";

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

export function getStudioClosedAgentOS() {
  studioClosedAgentOS ??= new ClosedAgentOS({
    tools: createStudioClosedAgentToolRegistry(),
  });
  return studioClosedAgentOS;
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
  signal?: AbortSignal;
  onProgress?: (event: ClosedAIProgressEvent) => void;
};

function automaticBackend(taskType: PlatformTaskType): ClosedAIBackendId {
  const complexity = taskComplexity(taskType);
  if (complexity === "heavy") return "private-ai-hub";
  if (complexity === "standard") return "local-ollama";
  return "browser-ai";
}

export async function executeStudioClosedAgent(
  input: ExecuteStudioClosedAgentInput,
): Promise<ClosedAgentExecutionResult> {
  const os = getStudioClosedAgentOS();
  const backendId = input.preferredBackend ?? automaticBackend(input.taskType);
  const privacyLevel = backendId === "private-ai-hub"
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
    modelId: `${backendId}:runtime-managed`,
    modelDigest: `${backendId}:digest-runtime-managed`,
    promptProfileVersion: input.promptProfileVersion ?? "studio-closed-agent-v3",
    storyBibleRevision: String(input.storyBibleRevision ?? "current"),
    knowledgeScopeRevision: String(input.knowledgeScopeRevision ?? "current"),
    privacyLevel,
  };

  return os.execute({
    taskId: input.taskId ?? `studio-closed-agent:${crypto.randomUUID()}`,
    namespace,
    taskType: input.taskType,
    objective: input.objective.trim(),
    context: (input.context ?? []).map((item) => ({
      ...item,
      privacyLevel: item.privacyLevel ?? privacyLevel,
      approved: item.approved ?? true,
    })),
    complexity: taskComplexity(input.taskType),
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

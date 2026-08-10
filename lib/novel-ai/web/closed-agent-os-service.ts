import {
  ClosedAgentOS,
  taskComplexity,
  type ClosedAIBackendId,
  type ClosedAIContextItem,
  type ClosedAIProgressEvent,
  type ClosedAIQualityMode,
  type ClosedAIRegenerationContract,
  type ClosedAgentExecutionResult,
} from "../closed-agent-os";
import type { ClosedAINamespace } from "../closed-ai-cache";
import { buildApprovedLearningContext } from "../sovereign-learning/combination-engine";
import {
  createSovereignLearningRepository,
  type SovereignLearningRepository,
} from "../sovereign-learning/repository";
import type {
  BrowserComputePolicy,
  PlatformAIRequest,
  PlatformTaskType,
} from "../router/platform-types";
import { createNovelRepository } from "../repository";
import {
  createStudioClosedAgentToolRegistry,
  STUDIO_CLOSED_AGENT_TOOL_IDS,
} from "./studio-closed-agent-tools";
import { ClosedAIRuntimeCoordinator } from "./closed-ai-runtime-coordinator";
import { ClosedAiBootstrapCoordinator } from "./closed-ai-bootstrap-coordinator";
import { composeProjectContext } from "./project-context-composer";
import {
  prewarmStudioProjectAICache,
  readPrewarmedStudioProjectContext,
} from "./studio-project-ai-cache";

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
let studioClosedAIBootstrap:
  | { origin: string; coordinator: ClosedAiBootstrapCoordinator }
  | null = null;

export function getStudioClosedAgentOS() {
  studioClosedAgentOS ??= new ClosedAgentOS({
    tools: createStudioClosedAgentToolRegistry(),
  });
  return studioClosedAgentOS;
}

export async function prewarmStudioProjectAIState(input: {
  projectId: string;
  taskTypes?: PlatformTaskType[];
  sourceChapterId?: string;
  sourceRevision?: number;
  signal?: AbortSignal;
}) {
  if (input.signal?.aborted) return [];
  const os = getStudioClosedAgentOS();
  const repository = createNovelRepository();
  const taskTypes = [...new Set(input.taskTypes ?? ["chapter.continue"])] as PlatformTaskType[];
  const results = [];
  for (const taskType of taskTypes) {
    if (input.signal?.aborted) break;
    const result = await prewarmStudioProjectAICache({
      cache: os.cache,
      repository,
      projectId: input.projectId,
      taskType,
      sourceChapterId: input.sourceChapterId,
      sourceRevision: input.sourceRevision,
      privacyLevel: "device_only",
    });
    if (result) results.push(result);
  }
  return results;
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
    studioClosedAIBootstrap = null;
  }
  return studioClosedAIRuntime.coordinator;
}

export function getStudioClosedAIBootstrapCoordinator(
  origin = typeof window === "undefined"
    ? "https://novel-orcin.vercel.app"
    : window.location.origin,
) {
  if (!studioClosedAIBootstrap || studioClosedAIBootstrap.origin !== origin) {
    studioClosedAIBootstrap = {
      origin,
      coordinator: new ClosedAiBootstrapCoordinator(
        getStudioClosedAIRuntimeCoordinator(origin),
      ),
    };
  }
  return studioClosedAIBootstrap.coordinator;
}

export type StudioClosedAgentContext = Omit<
  ClosedAIContextItem,
  "privacyLevel" | "approved"
> & {
  privacyLevel?: ClosedAIContextItem["privacyLevel"];
  approved?: boolean;
};

export async function loadApprovedConversationLearningRules(input: {
  repository: SovereignLearningRepository;
  projectId: string;
  taskType: PlatformTaskType;
  maximumRules?: number;
}) {
  if (!input.repository.isAvailable()) return [];
  const context = await buildApprovedLearningContext({
    repository: input.repository,
    projectId: input.projectId,
    taskType: input.taskType,
    maximumRules: input.maximumRules ?? 8,
  });
  return context.rules.map((rule, index) => ({
    id: rule.id,
    rule: context.instructions[index] ?? rule.statement,
    revision: rule.revision,
  }));
}

export type ExecuteStudioClosedAgentInput = {
  projectId: string;
  taskType: PlatformTaskType;
  objective: string;
  context?: StudioClosedAgentContext[];
  preferredBackend?: ClosedAIBackendId;
  qualityMode?: ClosedAIQualityMode;
  browserComputePolicy?: BrowserComputePolicy;
  allowPreAuthorizedClosedEscalation?: boolean;
  storyId?: string;
  canonId?: string;
  branchId?: string;
  characterId?: string;
  agentRole?: string;
  promptProfileVersion?: string;
  storyBibleRevision?: string | number;
  knowledgeScopeRevision?: string | number;
  sourceChapterId?: string;
  sourceRevision?: number;
  regeneration?: ClosedAIRegenerationContract;
  generationOptions?: PlatformAIRequest["generationOptions"];
  taskId?: string;
  contextTokenBudget?: number;
  conversationSessionId?: string;
  conversationRecentMessageLimit?: number;
  selectedAttachmentSummaries?: Array<{
    attachmentId: string;
    summary: string;
    contentDigest: string;
  }>;
  signal?: AbortSignal;
  onProgress?: (event: ClosedAIProgressEvent) => void;
};

export function shouldRestoreStudioLocalRuntime(
  input: Pick<
    ExecuteStudioClosedAgentInput,
    | "taskType"
    | "preferredBackend"
    | "browserComputePolicy"
    | "allowPreAuthorizedClosedEscalation"
  >,
) {
  if (taskComplexity(input.taskType) === "heavy") return false;
  if (input.preferredBackend === "local-ollama") return true;
  return input.allowPreAuthorizedClosedEscalation === true
    && (
      input.browserComputePolicy === "quality-first"
      || input.browserComputePolicy === "balanced"
    );
}

export async function executeStudioClosedAgent(
  input: ExecuteStudioClosedAgentInput,
): Promise<ClosedAgentExecutionResult> {
  const os = getStudioClosedAgentOS();
  const runtime = getStudioClosedAIRuntimeCoordinator();
  const taskId =
    input.taskId ?? `studio-closed-agent:${crypto.randomUUID()}`;
  runtime.beginExecution(input.projectId, input.taskType);
  // Project sections use full-page navigation so their module singletons are
  // intentionally recreated. The origin-bound Local Bridge session and model
  // proof survive inside this tab, but they must be restored into the new
  // coordinator before Closed Agent OS probes its backends. Only an explicit
  // quality/balanced policy (or a locked Local Ollama transaction such as
  // regeneration) authorizes this reconnect; browser-first routing remains
  // fail-closed and never escalates silently.
  if (shouldRestoreStudioLocalRuntime(input)) {
    await runtime.connectLocalAutomatically(input.signal);
  }
  const complexity = taskComplexity(input.taskType);
  if (
    typeof window !== "undefined"
    && complexity !== "heavy"
    && !input.preferredBackend
    && (input.browserComputePolicy ?? "browser-first") !== "quality-first"
  ) {
    const bootstrap = await getStudioClosedAIBootstrapCoordinator().bootstrap({
      projectId: input.projectId,
      taskType: input.taskType,
      signal: input.signal,
      onProgress: (progress) => input.onProgress?.({
        taskId,
        phase: progress.step === "model_download" || progress.step === "integrity_verify"
          ? "probing"
          : "routing",
        label: progress.message.trim(),
        percent: Math.min(45, Math.max(1, Math.round(progress.percent * 0.45))),
        occurredAt: new Date().toISOString(),
        backendId: "browser-ai",
      }),
    });
    if (bootstrap.readiness.generationVerifiedBackends < 1) {
      throw Object.assign(new Error(bootstrap.safeMessage), {
        code: bootstrap.status === "unsupported"
          ? "CLOSED_AI_BROWSER_UNSUPPORTED_SETUP_REQUIRED"
          : "CLOSED_AI_SETUP_REQUIRED",
        userActionRequired: true,
        externalFallback: false,
        setup: bootstrap.setup,
      });
    }
  }
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
  try {
    const repository = createNovelRepository();
    const approvedLearningRules = await loadApprovedConversationLearningRules({
      repository: createSovereignLearningRepository(),
      projectId: input.projectId,
      taskType: input.taskType,
    });
    const prewarmed = supplementalContext.length === 0
      && !input.conversationSessionId
      && !input.selectedAttachmentSummaries?.length
      && approvedLearningRules.length === 0
      ? await readPrewarmedStudioProjectContext({
        cache: os.cache,
        repository,
        projectId: input.projectId,
        taskType: input.taskType,
        sourceChapterId: input.sourceChapterId,
        sourceRevision: input.sourceRevision,
        privacyLevel,
      })
      : null;
    const composed = prewarmed ?? await composeProjectContext({
      repository,
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
      conversationSessionId: input.conversationSessionId,
      conversationRecentMessageLimit: input.conversationRecentMessageLimit,
      approvedLearningRules,
      selectedAttachmentSummaries: input.selectedAttachmentSummaries,
      supplementalContext,
      semanticQuery: input.objective,
      semanticRanker: typeof window === "undefined"
        ? undefined
        : async ({ query, items }) => {
          const { rankWithBrowserSemanticModel } = await import(
            "../providers/browser-ai/browser-semantic-runtime"
          );
          return rankWithBrowserSemanticModel({
            namespace,
            query,
            items,
            signal: input.signal,
          });
        },
    });

    const result = await os.execute({
      taskId,
      namespace,
      taskType: input.taskType,
      objective: input.objective.trim(),
      context: composed.context,
      contextDigest: composed.contextDigest,
      contextSourceSummary: JSON.stringify(composed.contextSourceSummary),
      sourceChapterId: input.sourceChapterId,
      sourceRevision: input.sourceRevision,
      regeneration: input.regeneration,
      generationOptions: input.generationOptions,
      complexity,
      qualityMode: input.qualityMode,
      browserComputePolicy: input.browserComputePolicy ?? "browser-first",
      allowPreAuthorizedClosedEscalation:
        input.allowPreAuthorizedClosedEscalation ?? false,
      preferredBackend: input.preferredBackend,
      allowedToolIds: [...STUDIO_CLOSED_AGENT_TOOL_IDS],
      permissionScopes: [...STUDIO_CLOSED_AGENT_PERMISSION_SCOPES],
      signal: input.signal,
      onProgress: input.onProgress,
    });
    if (result.candidate.executionReceipt) {
      runtime.recordExecutionReceipt(
        input.projectId,
        input.taskType,
        result.candidate.executionReceipt,
      );
    }
    return result;
  } catch (error) {
    runtime.beginExecution(input.projectId, input.taskType);
    throw error;
  }
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

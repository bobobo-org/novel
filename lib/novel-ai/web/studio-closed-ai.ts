import {
  executePlatformAI,
  localProviderSnapshots,
} from "../router/platform-executor";
import type {
  ClosedAIBackendId,
  ClosedAIExecutionReceipt,
  ClosedAIProgressEvent,
  ClosedAIQualityMode,
  ClosedAIRegenerationContract,
} from "../closed-agent-os";
import { isCryptographicClosedAIModelDigest } from "../closed-agent-os/types";
import type {
  PlatformAIRequest,
  PlatformAIResult,
  PlatformProviderId,
  PlatformProviderCapability,
  PlatformProviderSnapshot,
  PlatformTaskType,
} from "../router/platform-types";
import {
  executeStudioClosedAgent,
  rejectStudioClosedAgentCandidate,
} from "./closed-agent-os-service";
import {
  assessRegenerationDistinctness,
  createExplicitRegenerationContract,
  explicitRegenerationInstruction,
  type ExplicitRegenerationSource,
} from "./explicit-regeneration";
import {
  HUMANIZED_SERIAL_FICTION_PROFILE_VERSION,
  humanizedSerialFictionInstruction,
} from "./humanized-serial-fiction-profile";
import { getStudioClosedAIRuntimeCoordinator } from "./closed-agent-os-service";
import { getConfiguredLocalBridgeModel } from "../providers/local-ollama/local-bridge-client";
import {
  hasExplicitLocalComputeAuthorization,
  resolveStudioClosedComputePolicy,
} from "./studio-closed-compute-policy";

export type StudioClosedAIStatus =
  | "ollama_ready"
  | "browser_ready"
  | "auth_required"
  | "runtime_required";

export type StudioClosedAISnapshot = {
  status: StudioClosedAIStatus;
  /** Compatibility alias for plannedProviderId. This is not execution proof. */
  providerId: PlatformProviderId | null;
  plannedProviderId: PlatformProviderId | null;
  modelId: string | null;
  providers: PlatformProviderSnapshot[];
  actualExecutor: PlatformProviderId | "not_executed";
  executionStatus: "routable" | "not_executed";
  reasonCode?: string;
  recommendedNextAction?: string;
};

export type StudioClosedAITaskInput = {
  projectId: string;
  task: string;
  input: string;
  targetLength?: number;
  sourceChapterId?: string;
  sourceRevision?: number;
  regeneration?: ClosedAIRegenerationContract;
  preferredBackend?: ClosedAIBackendId;
  regenerationSourceModelId?: string;
  regenerationSourceModelDigest?: string;
  qualityMode?: ClosedAIQualityMode;
  browserComputePolicy?: PlatformAIRequest["browserComputePolicy"];
  generationOptions?: PlatformAIRequest["generationOptions"];
  signal?: AbortSignal;
  onProgress?: (event: ClosedAIProgressEvent) => void;
};

type SnapshotReader = (signal?: AbortSignal) => Promise<PlatformProviderSnapshot[]>;
type PlatformExecutor = (request: PlatformAIRequest) => Promise<PlatformAIResult>;

const INTERACTIVE_CHOICE_WARM_TTL_MS = 8 * 60 * 1_000;
const BROWSER_TO_LOCAL_RETRY_CODES = new Set([
  "BROWSER_EXPLICIT_ESCALATION_REQUIRED",
  "BROWSER_AI_ESCALATE_LOCAL_OLLAMA",
  "BROWSER_AI_QUALITY_INSUFFICIENT",
  "BROWSER_AI_REQUIRED_GENERATIVE_EXECUTOR_UNAVAILABLE",
  "BROWSER_AI_REQUIRED_GENERATIVE_EXECUTION_FAILED",
]);
const CLOSED_REGENERATION_BACKENDS = new Set<ClosedAIBackendId>([
  "browser-ai",
  "local-ollama",
  "private-ai-hub",
]);
const STRICT_LOCAL_PLATFORM_BACKENDS = new Set<ClosedAIBackendId>([
  "browser-ai",
  "local-ollama",
]);
let interactiveChoiceWarmModelId: string | null = null;
let interactiveChoiceWarmedAt = 0;
let interactiveChoiceWarmPromise: Promise<boolean> | null = null;

function callerAbortReason(signal: AbortSignal) {
  return signal.reason ?? Object.assign(
    new Error("The caller aborted the Closed AI operation."),
    { name: "AbortError", code: "ABORT_ERR" },
  );
}

/**
 * Settle the caller-facing operation as soon as its AbortSignal fires, even
 * when a shared discovery/connection promise was created by an earlier caller
 * and therefore cannot be cancelled by this signal. The underlying work still
 * receives the same signal wherever the provider supports cancellation.
 */
function settleOnCallerAbort<T>(
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
  onLateResolve?: (value: T) => void | Promise<void>,
): Promise<T> {
  if (!signal) return operation();
  if (signal.aborted) return Promise.reject(callerAbortReason(signal));

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(callerAbortReason(signal)));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }

    let pending: Promise<T>;
    try {
      pending = operation();
    } catch (error) {
      finish(() => reject(error));
      return;
    }
    pending.then(
      (value) => {
        if (settled) {
          void Promise.resolve(onLateResolve?.(value)).catch(() => undefined);
          return;
        }
        finish(() => resolve(value));
      },
      (error) => finish(() => reject(error)),
    );
  });
}

function studioClosedAIErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return String((error as { code?: unknown }).code ?? "");
}

/**
 * Starts a tiny verified inference while the author is reading the choices.
 * This is best-effort only: it never changes routing truth or turns a failed
 * runtime into a ready runtime.
 */
export function prewarmStudioInteractiveChoiceAI(signal?: AbortSignal) {
  const modelId = getConfiguredLocalBridgeModel();
  if (!modelId || signal?.aborted) return Promise.resolve(false);
  if (
    interactiveChoiceWarmModelId === modelId
    && Date.now() - interactiveChoiceWarmedAt < INTERACTIVE_CHOICE_WARM_TTL_MS
  ) {
    return Promise.resolve(true);
  }
  if (interactiveChoiceWarmPromise && interactiveChoiceWarmModelId === modelId) {
    return interactiveChoiceWarmPromise;
  }
  interactiveChoiceWarmModelId = modelId;
  const operation = getStudioClosedAIRuntimeCoordinator().localClient
    .verifyModel(modelId, signal)
    .then(() => {
      interactiveChoiceWarmedAt = Date.now();
      return true;
    })
    .catch(() => false)
    .finally(() => {
      if (interactiveChoiceWarmPromise === operation) {
        interactiveChoiceWarmPromise = null;
      }
    });
  interactiveChoiceWarmPromise = operation;
  return operation;
}

async function digestText(value: string) {
  return crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  ).then((digest) => [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(""));
}

export function studioPlatformTaskType(task: string): PlatformTaskType {
  if (task === "knowledge_rule_extraction") return "knowledge.ruleExtraction";
  if (task === "knowledge_rule_synthesis") return "knowledge.ruleSynthesis";
  if (task === "learning_preference_review") return "learning.preferenceReview";
  if (task === "first_chapter" || task === "continue_story" || task === "branch_choice") return "chapter.continue";
  if (task === "rewrite_selection" || task === "improve_settings") return "chapter.rewrite";
  if (task === "dialogue_boost") return "character.dialogue";
  if (task === "emotion_boost" || task === "pacing_tune") return "chapter.expand";
  if (task === "chapter_hook") return "chapter.endingCandidates";
  if (task === "three_choices") return "chapter.abcChoices";
  if (task === "plan_chapter") return "chapter.outline";
  if (task === "topic_recommendation") return "creation.genreSuggestions";
  if (task === "protagonist_recommendation") return "creation.protagonistCandidates";
  if (task === "world_recommendation") return "creation.worldCandidates";
  if (task === "conflict_recommendation") return "creation.conflictCandidates";
  if (task === "story_seed") return "creation.storySeed";
  if (task === "idea_directions" || task === "mode_recommendation") return "creation.guidedChoices";
  return "story.summary";
}

export function studioPromptProfileVersion(regeneration = false) {
  return regeneration
    ? `studio-explicit-regeneration-v5-${HUMANIZED_SERIAL_FICTION_PROFILE_VERSION}`
    : `studio-${HUMANIZED_SERIAL_FICTION_PROFILE_VERSION}`;
}

export async function discoverStudioClosedAI(
  signal?: AbortSignal,
  readSnapshots: SnapshotReader = localProviderSnapshots,
): Promise<StudioClosedAISnapshot> {
  if (readSnapshots === localProviderSnapshots) {
    const coordinator = getStudioClosedAIRuntimeCoordinator();
    // Discovery is a read-only status refresh. Public pages call it during
    // mount, so it must not trigger Local Network Access or probe loopback
    // Companion ports. Explicit settings and closed-AI execution paths own
    // connection discovery and retain the production-origin allowlist.
    const runtime = await coordinator.refresh({
      projectId: "studio-discovery",
      taskType: "chapter.continue",
      signal,
    });
    const providers = runtime.backends.map((provider) => ({
      id: provider.id,
      status: provider.status === "ready"
        ? "ready" as const
        : provider.status === "degraded"
          ? "degraded" as const
          : "runtime_unavailable" as const,
      capabilities: provider.capabilities as PlatformProviderCapability[],
      modelId: provider.modelId,
      modelDigest: provider.modelDigest,
      maxContext: provider.maxContext ?? 0,
      local: provider.local,
      requiresInternet: false,
      detail: provider.detailCode,
    }));
    if (runtime.route.executionStatus === "routable") {
      const providerId = runtime.route.backend.id;
      return {
        status: providerId === "local-ollama"
          ? "ollama_ready"
          : "browser_ready",
        providerId,
        plannedProviderId: providerId,
        modelId: runtime.plannedModel,
        providers,
        actualExecutor: runtime.actualExecutor,
        executionStatus: "routable",
        reasonCode: runtime.route.reasonCode,
        recommendedNextAction: runtime.nextAction,
      };
    }
    return {
      status: runtime.localNetworkPermission === "denied"
        ? "auth_required"
        : "runtime_required",
      providerId: null,
      plannedProviderId: null,
      modelId: null,
      providers,
      actualExecutor: "not_executed",
      executionStatus: "not_executed",
      reasonCode: runtime.route.reasonCode,
      recommendedNextAction: runtime.nextAction,
    };
  }
  const providers = await readSnapshots(signal);
  const localOllama = providers.find((provider) => provider.id === "local-ollama");
  const browserAI = providers.find((provider) => provider.id === "browser-ai");
  if (localOllama?.status === "ready") {
    return {
      status: "ollama_ready",
      providerId: localOllama.id,
      plannedProviderId: localOllama.id,
      modelId: localOllama.modelId,
      providers,
      actualExecutor: "not_executed",
      executionStatus: "routable",
    };
  }
  if (browserAI?.status === "ready") {
    return {
      status: "browser_ready",
      providerId: browserAI.id,
      plannedProviderId: browserAI.id,
      modelId: browserAI.modelId,
      providers,
      actualExecutor: "not_executed",
      executionStatus: "routable",
    };
  }
  if (localOllama?.status === "auth_required" || browserAI?.status === "auth_required") {
    return {
      status: "auth_required",
      providerId: null,
      plannedProviderId: null,
      modelId: null,
      providers,
      actualExecutor: "not_executed",
      executionStatus: "not_executed",
    };
  }
  return {
    status: "runtime_required",
    providerId: null,
    plannedProviderId: null,
    modelId: null,
    providers,
    actualExecutor: "not_executed",
    executionStatus: "not_executed",
  };
}

async function runStudioClosedAIUnsettled(
  input: StudioClosedAITaskInput,
  execute?: PlatformExecutor,
) {
  const requestId = `studio-closed-${crypto.randomUUID()}`;
  const taskType = studioPlatformTaskType(input.task);
  const targetInstruction = input.targetLength
    ? taskType === "chapter.continue"
      ? `\n\n請將候選正文寫到約 ${input.targetLength} 個中文字，至少 ${Math.ceil(input.targetLength * 0.6)} 字；必須完成本場景的新事件與直接後果。`
      : `\n\n請將候選內容控制在約 ${input.targetLength} 個中文字以內。`
    : "";
  const regenerationInstruction = input.regeneration
    ? explicitRegenerationInstruction(input.regeneration)
    : "";
  const humanizedInstruction = humanizedSerialFictionInstruction(
    taskType,
    input.targetLength,
  );
  const objective = `${input.input}${targetInstruction}${humanizedInstruction}${regenerationInstruction}`;
  const browserComputePolicy = resolveStudioClosedComputePolicy(
    input.browserComputePolicy,
  );
  const preferredRegenerationBackend: ClosedAIBackendId | undefined =
    input.regeneration ? input.preferredBackend : undefined;
  if (input.regeneration && (
    !preferredRegenerationBackend
    || !CLOSED_REGENERATION_BACKENDS.has(preferredRegenerationBackend)
    || !input.regenerationSourceModelId?.trim()
    || !isCryptographicClosedAIModelDigest(input.regenerationSourceModelDigest)
  )) {
    throw Object.assign(
      new Error("Explicit regeneration requires the verified source backend and model identity."),
      { code: "REGENERATION_SOURCE_IDENTITY_MISSING", fallbackAttempted: false },
    );
  }
  if (input.regeneration && execute) {
    throw Object.assign(
      new Error("Injected platform executors cannot prove persisted regeneration candidates."),
      {
        code: "REGENERATION_PLATFORM_EXECUTOR_UNVERIFIED",
        fallbackAttempted: false,
      },
    );
  }
  const allowPreAuthorizedClosedEscalation =
    hasExplicitLocalComputeAuthorization(browserComputePolicy);

  if (!execute) {
    const agentRequest = {
      projectId: input.projectId,
      taskType,
      objective,
      taskId: requestId,
      signal: input.signal,
      promptProfileVersion: studioPromptProfileVersion(Boolean(input.regeneration)),
      sourceChapterId: input.sourceChapterId,
      sourceRevision: input.sourceRevision,
      regeneration: input.regeneration,
      qualityMode: input.qualityMode,
      browserComputePolicy,
      allowPreAuthorizedClosedEscalation,
      preferredBackend: preferredRegenerationBackend,
      generationOptions: input.generationOptions,
      onProgress: input.onProgress,
    };
    let result;
    try {
      result = await executeStudioClosedAgent(agentRequest);
    } catch (error) {
      const mayRetryOnPairedLocalRuntime =
        allowPreAuthorizedClosedEscalation
        && !input.regeneration
        && !input.signal?.aborted
        && BROWSER_TO_LOCAL_RETRY_CODES.has(studioClosedAIErrorCode(error));
      if (!mayRetryOnPairedLocalRuntime) throw error;

      // A browser executor can disappear between readiness probing and actual
      // generation. For an explicitly authorised closed-compute policy, retry
      // once on the paired Local Ollama runtime instead of stranding the user
      // on BROWSER_EXPLICIT_ESCALATION_REQUIRED. This remains device-only and
      // still fails closed when Local Ollama is unavailable.
      result = await executeStudioClosedAgent({
        ...agentRequest,
        taskId: `${requestId}:local-retry`,
        browserComputePolicy: "quality-first",
        allowPreAuthorizedClosedEscalation: true,
        preferredBackend: "local-ollama",
      });
    }
    if (
      !CLOSED_REGENERATION_BACKENDS.has(result.candidate.backendId)
      || result.candidate.canonicalMutationCount !== 0
      || (input.regeneration && (
        result.candidate.backendId !== preferredRegenerationBackend
        || result.candidate.actualExecutor !== preferredRegenerationBackend
        || result.candidate.modelId !== input.regenerationSourceModelId
        || result.candidate.modelDigest !== input.regenerationSourceModelDigest
        || result.candidate.externalRequest
        || result.candidate.dataLeftDevice
        || result.cache.candidateHit
        || result.cache.bypassReason !== "explicit_regeneration"
        || !result.candidate.regeneration?.cacheBypassed
        || result.candidate.regeneration.previousCandidateId
          !== input.regeneration.previousCandidateId
        || result.candidate.regeneration.previousTaskId
          !== input.regeneration.previousTaskId
        || !result.candidate.executionReceipt
        || result.candidate.executionReceipt.proofState !== "verified"
        || result.candidate.executionReceipt.taskId !== result.candidate.taskId
        || result.candidate.executionReceipt.backendId !== preferredRegenerationBackend
        || result.candidate.executionReceipt.actualExecutor !== preferredRegenerationBackend
        || result.candidate.executionReceipt.modelId !== result.candidate.modelId
        || result.candidate.executionReceipt.modelDigest !== result.candidate.modelDigest
        || result.candidate.executionReceipt.contentDigest !== result.candidate.contentDigest
        || result.candidate.executionReceipt.contextDigest !== result.candidate.contextDigest
        || result.candidate.executionReceipt.externalRequest
        || result.candidate.executionReceipt.dataLeftDevice
      ))
    ) {
      throw Object.assign(
        new Error("Closed Agent OS returned a result outside the device-only candidate boundary."),
        { code: "CLOSED_AI_BOUNDARY_VIOLATION" },
      );
    }
    return {
      taskId: result.task.id,
      candidateId: result.candidate.id,
      status: "awaiting_approval" as const,
      provider: result.candidate.backendId,
      model: result.candidate.modelId,
      modelDigest: result.candidate.modelDigest,
      sourceChapterId: result.candidate.sourceChapterId,
      sourceRevision: result.candidate.sourceRevision,
      content: result.candidate.content,
      contentDigest: result.candidate.contentDigest,
      actualExecutor: result.candidate.actualExecutor,
      executionReceipt: result.candidate.executionReceipt,
      contextDigest: result.candidate.contextDigest ?? null,
      contextSourceSummary: result.candidate.contextSourceSummary ?? null,
      dataLeftDevice: result.candidate.dataLeftDevice ?? false,
      externalRequest: result.candidate.externalRequest ?? false,
      warnings: result.candidate.evaluation.warningCodes,
      toolExecutions: result.toolExecutions,
      ledgerHeadHash: result.ledgerHeadHash,
      canonicalMutationCount: result.candidate.canonicalMutationCount,
      regeneration: result.candidate.regeneration ?? null,
      cache: result.cache,
    };
  }

  if (input.signal?.aborted) throw callerAbortReason(input.signal);
  const startedAt = new Date().toISOString();
  input.onProgress?.({
    taskId: requestId,
    phase: "routing",
    label: "已完成前置檢查，正在選擇可用的裝置內模型。",
    percent: 35,
    occurredAt: startedAt,
  });
  const result = await execute({
    requestId,
    projectId: input.projectId,
    taskType,
    privacyMode: "strict-local",
    privacyLevel: "device_only",
    fallbackPolicy: "closed-only",
    browserComputePolicy,
    allowPreAuthorizedClosedEscalation,
    input: objective,
    context: [],
    preferredProvider: preferredRegenerationBackend,
    externalConsent: false,
    requiredCapabilities: ["text"],
    closedOnly: true,
    offlineRequired: false,
    estimatedContextSize: Math.ceil(input.input.length / 2.5),
    qualityPreference: input.qualityMode === "deep"
      ? "high"
      : input.qualityMode,
    generationOptions: {
      ...(input.generationOptions ?? {}),
      ...(input.regeneration
        ? { seed: input.regeneration.modelSeed }
        : {}),
    },
    idempotencyKey: requestId,
    signal: input.signal,
  });
  if (input.signal?.aborted) throw callerAbortReason(input.signal);
  const completedAt = new Date().toISOString();
  input.onProgress?.({
    taskId: requestId,
    phase: "evaluating",
    label: "裝置內模型已完成候選，正在檢查執行證明與輸出。",
    percent: 90,
    occurredAt: completedAt,
    backendId: STRICT_LOCAL_PLATFORM_BACKENDS.has(result.providerId as ClosedAIBackendId)
      ? result.providerId as ClosedAIBackendId
      : undefined,
    generatedCharacters: result.outputCharacters ?? result.content.length,
    generatedTokenEvents: result.generatedTokenEvents ?? 0,
  });
  if (
    !STRICT_LOCAL_PLATFORM_BACKENDS.has(result.providerId as ClosedAIBackendId)
    || result.externalRequest
    || result.dataLeavesDevice
    || (input.regeneration && result.providerId !== preferredRegenerationBackend)
  ) {
    throw Object.assign(
      new Error("Closed AI provider returned a result outside the device-only boundary."),
      { code: "CLOSED_AI_BOUNDARY_VIOLATION" },
    );
  }
  const contentDigest = await digestText(result.content);
  const contextDigest = await digestText(`${input.projectId}\n${taskType}\n${input.input}`);
  const modelId = result.modelId?.trim() ?? "";
  const modelDigest = result.modelDigest?.trim() ?? "";
  const outputCharacters = result.outputCharacters ?? result.content.length;
  const executionReceipt: ClosedAIExecutionReceipt | null =
    modelId
    && modelDigest
    && outputCharacters > 0
      ? {
        taskId: result.requestId,
        backendId: result.providerId as ClosedAIBackendId,
        modelId,
        modelDigest,
        startedAt,
        completedAt,
        generatedTokenEvents: result.generatedTokenEvents ?? 0,
        outputCharacters,
        contentDigest,
        contextDigest,
        proofState: "verified",
        dataLeftDevice: result.dataLeavesDevice,
        externalRequest: result.externalRequest,
        actualExecutor: result.providerId,
        browserComputeReceiptId: result.browserCompute?.receiptId,
        contextTokensBefore: result.browserCompute?.contextTokensBefore,
        contextTokensAfter: result.browserCompute?.contextTokensAfter,
        tokensSaved: result.browserCompute?.tokensSaved,
      }
      : null;
  if (input.regeneration && (
    !executionReceipt
    || executionReceipt.backendId !== preferredRegenerationBackend
    || executionReceipt.actualExecutor !== preferredRegenerationBackend
    || executionReceipt.modelId !== input.regenerationSourceModelId
    || executionReceipt.modelDigest !== input.regenerationSourceModelDigest
    || executionReceipt.externalRequest
    || executionReceipt.dataLeftDevice
  )) {
    throw Object.assign(
      new Error("Regeneration execution identity did not match the verified source candidate."),
      { code: "REGENERATION_EXECUTION_IDENTITY_MISMATCH", fallbackAttempted: false },
    );
  }
  return {
    taskId: result.requestId,
    candidateId: null,
    status: "completed" as const,
    provider: result.providerId,
    model: result.modelId ?? "unknown",
    modelDigest: result.modelDigest ?? null,
    content: result.content,
    contentDigest,
    actualExecutor: executionReceipt?.backendId ?? "not_executed",
    executionReceipt,
    contextDigest,
    sourceChapterId: input.sourceChapterId ?? null,
    sourceRevision: input.sourceRevision ?? null,
    canonicalMutationCount: 0,
    dataLeftDevice: result.dataLeavesDevice,
    externalRequest: result.externalRequest,
    warnings: result.provenance.warnings,
    toolExecutions: [],
    regeneration: input.regeneration
      ? {
        previousCandidateId: input.regeneration.previousCandidateId,
        previousTaskId: input.regeneration.previousTaskId,
        regenerationAttempt: input.regeneration.regenerationAttempt,
        previousCandidateDigest: input.regeneration.previousCandidateDigest,
        cacheBypassReason: input.regeneration.cacheBypassReason,
        cacheBypassed: true as const,
        previousContentReused: false as const,
        newCandidate: true as const,
        nonceStored: false as const,
      }
      : null,
    cache: {
      candidateHit: false,
      planHit: false,
      bypassReason: input.regeneration?.cacheBypassReason ?? null,
    },
  };
}

/**
 * Keeps the UI deadline authoritative even when a provider ignores AbortSignal.
 * A late persisted candidate is rejected because the caller has already moved
 * on and must never be able to approve that stale result.
 */
export function runStudioClosedAI(
  input: StudioClosedAITaskInput,
  execute?: PlatformExecutor,
) {
  return settleOnCallerAbort(
    input.signal,
    () => runStudioClosedAIUnsettled(input, execute),
    async (lateResult) => {
      if (lateResult.candidateId) {
        await rejectStudioClosedAgentCandidate(lateResult.candidateId);
      }
    },
  );
}

/**
 * Executes an AI-only creation candidate before a canonical project exists.
 *
 * The regular Studio Closed Agent route composes context from the canonical
 * project repository and therefore must only be used after project creation.
 * Creation onboarding has no canonical project yet, so it deliberately uses
 * the same strict-local platform router with an empty context. The returned
 * text remains an unpersisted suggestion until the author creates the project.
 */
export async function runStudioPreCreationClosedAI(
  input: StudioClosedAITaskInput & { task: "story_seed" },
  execute: PlatformExecutor = executePlatformAI,
) {
  return settleOnCallerAbort(input.signal, async () => {
    if (execute === executePlatformAI) {
      try {
        await getStudioClosedAIRuntimeCoordinator().connectLocalAutomatically(input.signal);
      } catch (error) {
        if (input.signal?.aborted) throw error;
        // Local Ollama is optional. The strict-local platform router may still
        // select an already verified Browser AI runtime; otherwise it fails
        // truthfully and the create page can offer its explicit device fallback.
      }
    }
    try {
      return await runStudioClosedAI(input, execute);
    } catch (error) {
      const mayRetryOnLocalOllama =
        hasExplicitLocalComputeAuthorization(
          resolveStudioClosedComputePolicy(input.browserComputePolicy),
        )
        && !input.signal?.aborted
        && BROWSER_TO_LOCAL_RETRY_CODES.has(studioClosedAIErrorCode(error));
      if (!mayRetryOnLocalOllama) throw error;

      // Creation has no canonical project yet, so it uses the context-free
      // platform executor. When Browser AI explicitly asks for Local Ollama,
      // preserve that empty-context boundary while locking the retry to the
      // already authorised device-local backend.
      return runStudioClosedAI(input, (request) => execute({
        ...request,
        preferredProvider: "local-ollama",
      }));
    }
  });
}

export async function regenerateStudioClosedAI(
  input: Omit<
    StudioClosedAITaskInput,
    | "regeneration"
    | "preferredBackend"
    | "regenerationSourceModelId"
    | "regenerationSourceModelDigest"
  >,
  previous: ExplicitRegenerationSource,
  options: {
    extraRequirement?: string;
    execute?: PlatformExecutor;
    rejectCandidate?: (candidateId: string) => Promise<unknown>;
  } = {},
) {
  if (!previous.taskId || !previous.candidateId) {
    throw Object.assign(
      new Error("Only a verified Closed Agent candidate can be regenerated."),
      { code: "REGENERATION_SOURCE_IDENTITY_MISSING" },
    );
  }
  if (
    !previous.backendId
    || !CLOSED_REGENERATION_BACKENDS.has(previous.backendId)
    || !previous.modelId?.trim()
    || !isCryptographicClosedAIModelDigest(previous.modelDigest)
  ) {
    throw Object.assign(
      new Error("Only a source candidate with verified closed model identity can be regenerated."),
      { code: "REGENERATION_SOURCE_IDENTITY_MISSING", fallbackAttempted: false },
    );
  }
  const previousCandidateDigest = previous.contentDigest
    ?? await digestText(previous.content);
  const rejectCandidate = options.rejectCandidate
    ?? rejectStudioClosedAgentCandidate;
  const regeneration = createExplicitRegenerationContract({
    previousCandidateId: previous.candidateId,
    previousTaskId: previous.taskId,
    previousCandidateDigest,
    regenerationAttempt: (previous.regenerationAttempt ?? 0) + 1,
    extraRequirement: options.extraRequirement,
  });
  const result = await runStudioClosedAI(
    {
      ...input,
      regeneration,
      preferredBackend: previous.backendId,
      regenerationSourceModelId: previous.modelId,
      regenerationSourceModelDigest: previous.modelDigest,
    },
    options.execute,
  );
  const distinctness = await assessRegenerationDistinctness(
    previous.content,
    result.content,
  );
  const postconditionPassed = distinctness.distinct
    && result.taskId !== previous.taskId
    && Boolean(result.candidateId && result.candidateId !== previous.candidateId)
    && CLOSED_REGENERATION_BACKENDS.has(result.provider as ClosedAIBackendId)
    && result.provider === previous.backendId
    && result.model === previous.modelId
    && result.modelDigest === previous.modelDigest
    && result.actualExecutor === previous.backendId
    && !result.externalRequest
    && !result.dataLeftDevice
    && result.canonicalMutationCount === 0
    && result.cache.candidateHit === false
    && result.cache.bypassReason === "explicit_regeneration";
  if (postconditionPassed) return { ...result, distinctness };
  if (result.candidateId) await rejectCandidate(result.candidateId);
  throw Object.assign(
    new Error("The regenerated candidate failed the closed execution postcondition."),
    {
      code: distinctness.distinct
        ? "REGENERATION_POSTCONDITION_FAILED"
        : "REGENERATION_NOT_DISTINCT",
      normalizedDigestDifferent: distinctness.normalizedDigestDifferent,
      similarityMetric: distinctness.similarityMetric,
      similarityScore: distinctness.similarityScore,
      attempts: 1,
    },
  );
}

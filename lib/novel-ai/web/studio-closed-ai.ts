import { localProviderSnapshots } from "../router/platform-executor";
import type {
  ClosedAIBackendId,
  ClosedAIExecutionReceipt,
  ClosedAIRegenerationContract,
} from "../closed-agent-os";
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
import { PASSWORDLESS_LOCAL_AI_ORIGINS } from "../providers/local-ollama/companion-release";

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
  signal?: AbortSignal;
};

type SnapshotReader = (signal?: AbortSignal) => Promise<PlatformProviderSnapshot[]>;
type PlatformExecutor = (request: PlatformAIRequest) => Promise<PlatformAIResult>;

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
    if (PASSWORDLESS_LOCAL_AI_ORIGINS.includes(
      coordinator.localClient.origin as (typeof PASSWORDLESS_LOCAL_AI_ORIGINS)[number],
    )) {
      await coordinator.connectAutomatically(signal).catch(() => null);
    }
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

export async function runStudioClosedAI(
  input: StudioClosedAITaskInput,
  execute?: PlatformExecutor,
) {
  const requestId = `studio-closed-${crypto.randomUUID()}`;
  const targetInstruction = input.targetLength
    ? `\n\n請將候選內容控制在約 ${input.targetLength} 個中文字以內。`
    : "";
  const regenerationInstruction = input.regeneration
    ? explicitRegenerationInstruction(input.regeneration)
    : "";
  const taskType = studioPlatformTaskType(input.task);
  const humanizedInstruction = humanizedSerialFictionInstruction(
    taskType,
    input.targetLength,
  );
  const objective = `${input.input}${targetInstruction}${humanizedInstruction}${regenerationInstruction}`;

  if (!execute) {
    const result = await executeStudioClosedAgent({
      projectId: input.projectId,
      taskType,
      objective,
      taskId: requestId,
      signal: input.signal,
      promptProfileVersion: studioPromptProfileVersion(Boolean(input.regeneration)),
      sourceChapterId: input.sourceChapterId,
      sourceRevision: input.sourceRevision,
      preferredBackend: input.regeneration ? "local-ollama" : undefined,
      regeneration: input.regeneration,
    });
    if (
      !["browser-ai", "local-ollama"].includes(result.candidate.backendId)
      || result.candidate.canonicalMutationCount !== 0
      || (input.regeneration && (
        result.candidate.backendId !== "local-ollama"
        || result.candidate.actualExecutor !== "local-ollama"
        || result.candidate.externalRequest
        || result.candidate.dataLeftDevice
        || result.cache.candidateHit
        || result.cache.bypassReason !== "explicit_regeneration"
        || !result.candidate.regeneration?.cacheBypassed
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
      ledgerHeadHash: result.ledgerHeadHash,
      canonicalMutationCount: result.candidate.canonicalMutationCount,
      regeneration: result.candidate.regeneration ?? null,
      cache: result.cache,
    };
  }

  const startedAt = new Date().toISOString();
  const result = await execute({
    requestId,
    projectId: input.projectId,
    taskType,
    privacyMode: "strict-local",
    privacyLevel: "device_only",
    fallbackPolicy: "closed-only",
    preferredProvider: "local-ollama",
    input: objective,
    context: [],
    externalConsent: false,
    requiredCapabilities: ["text"],
    closedOnly: true,
    offlineRequired: false,
    estimatedContextSize: Math.ceil(input.input.length / 2.5),
    generationOptions: input.regeneration
      ? { seed: input.regeneration.modelSeed }
      : undefined,
    idempotencyKey: requestId,
    signal: input.signal,
  });
  const completedAt = new Date().toISOString();
  if (
    !["browser-ai", "local-ollama"].includes(result.providerId)
    || result.externalRequest
    || result.dataLeavesDevice
    || (input.regeneration && result.providerId !== "local-ollama")
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
      }
      : null;
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
    regeneration: input.regeneration
      ? {
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

export async function regenerateStudioClosedAI(
  input: Omit<StudioClosedAITaskInput, "regeneration">,
  previous: ExplicitRegenerationSource,
  options: {
    extraRequirement?: string;
    maximumAttempts?: number;
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
  const previousCandidateDigest = previous.contentDigest
    ?? await digestText(previous.content);
  const maximumAttempts = Math.min(3, Math.max(1, options.maximumAttempts ?? 3));
  const rejectCandidate = options.rejectCandidate
    ?? rejectStudioClosedAgentCandidate;
  let lastDistinctness = await assessRegenerationDistinctness(
    previous.content,
    previous.content,
  );

  for (let offset = 1; offset <= maximumAttempts; offset += 1) {
    const regeneration = createExplicitRegenerationContract({
      previousCandidateDigest,
      regenerationAttempt: (previous.regenerationAttempt ?? 0) + offset,
      extraRequirement: options.extraRequirement,
    });
    const result = await runStudioClosedAI(
      { ...input, regeneration },
      options.execute,
    );
    lastDistinctness = await assessRegenerationDistinctness(
      previous.content,
      result.content,
    );
    const taskIdentityChanged = result.taskId !== previous.taskId;
    const candidateIdentityChanged = Boolean(
      result.candidateId && result.candidateId !== previous.candidateId,
    );
    if (
      lastDistinctness.distinct
      && taskIdentityChanged
      && candidateIdentityChanged
      && result.provider === "local-ollama"
      && result.actualExecutor === "local-ollama"
      && !result.externalRequest
      && !result.dataLeftDevice
      && result.canonicalMutationCount === 0
      && result.cache.candidateHit === false
      && result.cache.bypassReason === "explicit_regeneration"
    ) {
      return {
        ...result,
        distinctness: lastDistinctness,
      };
    }
    if (result.candidateId) {
      await rejectCandidate(result.candidateId);
    }
  }

  throw Object.assign(
    new Error("Local model repeatedly returned the previous candidate."),
    {
      code: "REGENERATION_NOT_DISTINCT",
      normalizedDigestDifferent: lastDistinctness.normalizedDigestDifferent,
      similarityMetric: lastDistinctness.similarityMetric,
      similarityScore: lastDistinctness.similarityScore,
      attempts: maximumAttempts,
    },
  );
}

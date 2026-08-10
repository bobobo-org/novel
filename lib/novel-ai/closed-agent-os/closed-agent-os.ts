import {
  ClosedAICache,
  assertClosedAINamespace,
  createClosedAICacheRepository,
  sameClosedAINamespace,
  sha256Hex,
  stableStringify,
  type ClosedAICacheInvalidation,
  type ClosedAINamespace,
} from "../closed-ai-cache";
import {
  ControlledLearningOS,
  createControlledLearningRepository,
  learningCacheTtl,
  learningPreferredTool,
  learningRetrievalWeight,
  learningSemanticThreshold,
  type ControlledLearningApprovalVerificationInput,
  type ControlledKnowledgeRule,
  type ControlledLearningOutcome,
  type ControlledLearningVersion,
} from "../controlled-learning-os";
import {
  VerifiableLedger,
  createVerifiableLedgerRepository,
} from "../verifiable-ledger";
import { createDefaultClosedAIBackends } from "./backends";
import { BACKEND_TRUTH } from "./backend-manifest";
import { evaluateClosedAgentCandidate } from "./evaluator";
import { createClosedAgentPlan } from "./planner";
import {
  createClosedAgentStateRepository,
  type ClosedAgentStateRepository,
} from "./repository";
import { selectClosedAIBackend } from "./router";
import {
  normalizeAbcChoicesCandidate,
  normalizeAbcChoicesExecutionContent,
} from "./structured-output";
import {
  assertClosedAgentPermission,
  ClosedAgentToolRegistry,
} from "./tool-registry";
import {
  CLOSED_AGENT_OS_SCHEMA_VERSION,
  hasVerifiedClosedAIGeneration,
  isCryptographicClosedAIModelDigest,
  type ClosedAIBackendAdapter,
  type ClosedAIBackendId,
  type ClosedAIBackendSnapshot,
  type ClosedAIProgressEvent,
  type ClosedAIProgressPhase,
  type ClosedAIQualityPhase,
  type ClosedAIExecutionReceipt,
  type ClosedAIWorkingMaterial,
  type ClosedAgentApprovalRecord,
  type ClosedAgentCandidate,
  type ClosedAgentExecutionResult,
  type ClosedAgentMemoryRecord,
  type ClosedAgentPlan,
  type ClosedAgentTaskRecord,
  type ClosedAgentTaskRequest,
  type ClosedAgentToolExecutionEvidence,
  type ClosedBackendExecutionResult,
} from "./types";
import {
  closedAgentBrowserRuntimeEvidenceProgress,
  isClosedAgentBrowserRuntimeDiagnosticCode,
} from "./safe-runtime-diagnostics";

type ClosedAgentOSOptions = {
  backends?: ClosedAIBackendAdapter[];
  cache?: ClosedAICache;
  learning?: ControlledLearningOS;
  ledger?: VerifiableLedger;
  state?: ClosedAgentStateRepository;
  tools?: ClosedAgentToolRegistry;
  now?: () => Date;
};

type ApprovalInput = {
  candidateId: string;
  approvedBy: string;
  humanApproved: boolean;
  canonicalCommit?: (input: {
    candidate: ClosedAgentCandidate;
    approvalId: string;
    idempotencyKey: string;
  }) => Promise<{ commitId: string; storyBibleRevision?: string }>;
};

function osError(code: string, message = code, details: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function assertClosedAIModelIdentity(
  routed: ClosedAIBackendSnapshot,
  execution: ClosedBackendExecutionResult,
) {
  const routedDigestVerified = isCryptographicClosedAIModelDigest(
    routed.modelDigest,
  );
  const executionDigestVerified = isCryptographicClosedAIModelDigest(
    execution.modelDigest,
  );
  if (
    !routed.modelId
    || !routedDigestVerified
    || !execution.modelId
    || !executionDigestVerified
    || execution.modelId !== routed.modelId
    || execution.modelDigest !== routed.modelDigest
  ) {
    throw osError("CLOSED_AI_MODEL_IDENTITY_MISMATCH", undefined, {
      backendId: routed.id,
      routedModelId: routed.modelId,
      executionModelId: execution.modelId,
      routedDigestVerified,
      executionDigestVerified,
      modelIdMatch: execution.modelId === routed.modelId,
      modelDigestMatch: execution.modelDigest === routed.modelDigest,
    });
  }
}

const REGENERATION_BACKENDS = new Set<ClosedAIBackendId>([
  "browser-ai",
  "local-ollama",
  "private-ai-hub",
]);

function hasVerifiedRegenerationSourceIdentity(
  candidate: ClosedAgentCandidate,
  task: ClosedAgentTaskRecord | null,
) {
  const receipt = candidate.executionReceipt;
  const adapterId = candidate.adapterId ?? null;
  const adapterDigest = candidate.adapterDigest ?? null;
  const adapterIdentityVerified = adapterId === null && adapterDigest === null
    || Boolean(adapterId && isCryptographicClosedAIModelDigest(adapterDigest));
  const startedAt = Date.parse(receipt?.startedAt ?? "");
  const completedAt = Date.parse(receipt?.completedAt ?? "");
  const candidateCreatedAt = Date.parse(candidate.createdAt);
  return candidate.schemaVersion === CLOSED_AGENT_OS_SCHEMA_VERSION
    && candidate.kind === "candidate"
    && task?.schemaVersion === CLOSED_AGENT_OS_SCHEMA_VERSION
    && task.kind === "task"
    && (candidate.status === "awaiting-approval" || candidate.status === "rejected")
    && candidate.candidateOnly
    && candidate.canonicalMutationCount === 0
    && candidate.actualExecutor === candidate.backendId
    && candidate.externalRequest === false
    && candidate.dataLeftDevice === false
    && Boolean(candidate.modelId.trim())
    && isCryptographicClosedAIModelDigest(candidate.modelDigest)
    && isCryptographicClosedAIModelDigest(candidate.contentDigest)
    && isCryptographicClosedAIModelDigest(candidate.contextDigest)
    && adapterIdentityVerified
    && task?.state === "awaiting-approval"
    && task.id === candidate.taskId
    && task.projectId === candidate.projectId
    && task.backendId === candidate.backendId
    && task.errorCode === null
    && receipt?.proofState === "verified"
    && receipt.taskId === candidate.taskId
    && receipt.backendId === candidate.backendId
    && receipt.actualExecutor === candidate.backendId
    && receipt.modelId === candidate.modelId
    && receipt.modelDigest === candidate.modelDigest
    && receipt.contentDigest === candidate.contentDigest
    && receipt.contextDigest === candidate.contextDigest
    && receipt.outputCharacters > 0
    && Number.isFinite(startedAt)
    && Number.isFinite(completedAt)
    && Number.isFinite(candidateCreatedAt)
    && startedAt <= completedAt
    && completedAt <= candidateCreatedAt
    && receipt.externalRequest === false
    && receipt.dataLeftDevice === false;
}

const REGENERATION_STABLE_NAMESPACE_FIELDS = [
  "tenantId",
  "userId",
  "projectId",
  "storyId",
  "canonId",
  "branchId",
  "characterId",
  "agentRole",
  "privacyLevel",
] as const satisfies ReadonlyArray<keyof ClosedAINamespace>;

function hasStableRegenerationNamespace(
  source: ClosedAINamespace,
  target: ClosedAINamespace,
) {
  return REGENERATION_STABLE_NAMESPACE_FIELDS.every(
    (field) => source[field] === target[field],
  );
}

function normalizeRegenerationContent(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-Hant")
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .trim();
}

function regenerationTrigrams(value: string) {
  const characters = Array.from(value);
  if (characters.length < 3) return new Set(characters);
  const grams = new Set<string>();
  for (let index = 0; index <= characters.length - 3; index += 1) {
    grams.add(characters.slice(index, index + 3).join(""));
  }
  return grams;
}

function regenerationSimilarity(left: string, right: string) {
  const leftGrams = regenerationTrigrams(normalizeRegenerationContent(left));
  const rightGrams = regenerationTrigrams(normalizeRegenerationContent(right));
  if (leftGrams.size === 0 && rightGrams.size === 0) return 1;
  let intersection = 0;
  for (const item of leftGrams) {
    if (rightGrams.has(item)) intersection += 1;
  }
  return intersection / (leftGrams.size + rightGrams.size - intersection || 1);
}

const CLOSED_AGENT_QUALITY_REASON_CODES = new Set([
  "QUALITY_TRADITIONALCHINESE_LOW",
  "QUALITY_CANONCOMPLIANCE_LOW",
  "QUALITY_CHARACTERVOICE_LOW",
  "QUALITY_CONTINUITY_LOW",
  "QUALITY_SPECIFICITY_LOW",
  "QUALITY_REPETITION_LOW",
  "QUALITY_STRUCTUREDOUTPUT_LOW",
  "QUALITY_TASKUSEFULNESS_LOW",
  "QUALITY_LENGTHCOMPLIANCE_LOW",
  "QUALITY_EMPTY_CANDIDATE",
  "QUALITY_TASK_FORM_MISMATCH",
  "QUALITY_CONTEXT_ANCHOR_MISSING",
  "QUALITY_CONTEXT_CHARACTER_MISSING",
  "QUALITY_OUTPUT_TRUNCATED",
  "QUALITY_OUTPUT_CONTROL_TOKEN",
  "QUALITY_OUTPUT_ROLE_ENVELOPE",
  "QUALITY_OUTPUT_INTERNAL_ENVELOPE",
  "QUALITY_NARRATIVE_TOO_SHORT",
  "QUALITY_CONTEXT_COPY_EXCESSIVE",
  "QUALITY_NARRATIVE_PROGRESS_MISSING",
  "QUALITY_WORLD_REGISTER_DRIFT",
  "QUALITY_CONTINUATION_CONTROL_TOKEN",
  "QUALITY_CONTINUATION_ROLE_ENVELOPE",
  "QUALITY_CONTINUATION_INTERNAL_ENVELOPE",
  "QUALITY_CONTINUATION_ANCHOR_INVALID",
  "QUALITY_CONTINUATION_ANCHOR_REPEATED",
  "QUALITY_CONTINUATION_SUFFIX_EMPTY",
  "QUALITY_CONTINUATION_BASE_REPEATED",
  "QUALITY_CONTINUATION_CONTRACT_UNSATISFIED",
  "CHARACTER_KNOWLEDGE_BOUNDARY_LEAK",
]);
const CLOSED_AGENT_EVALUATOR_BLOCKING_CODES = new Set([
  "CANDIDATE_EMPTY",
  "CANDIDATE_CREDENTIAL_LEAK",
  "CANDIDATE_RAW_REASONING_LEAK",
  "CANDIDATE_SIMPLIFIED_CHINESE_REMAINS",
  "CANDIDATE_PROPER_NOUN_DRIFT",
  "CANDIDATE_ONLY_CONTRACT_MISSING",
  "CANDIDATE_DEVICE_BOUNDARY_VIOLATION",
  "ABC_CHOICES_INVALID_STRUCTURE",
]);

export function closedAgentQualityReasonCodes(error: unknown): string[] {
  if (!error || typeof error !== "object") return [];
  const candidate = error as {
    qualityReasonCodes?: unknown;
    reasonCodes?: unknown;
    blockingCodes?: unknown;
    causeCode?: unknown;
  };
  const values = [
    ...(Array.isArray(candidate.qualityReasonCodes) ? candidate.qualityReasonCodes : []),
    ...(Array.isArray(candidate.reasonCodes) ? candidate.reasonCodes : []),
    ...(Array.isArray(candidate.blockingCodes) ? candidate.blockingCodes : []),
    candidate.causeCode,
  ];
  return [...new Set(values
    .filter((value): value is string => typeof value === "string")
    .filter((value) => CLOSED_AGENT_QUALITY_REASON_CODES.has(value)
      || CLOSED_AGENT_EVALUATOR_BLOCKING_CODES.has(value)
      || isClosedAgentBrowserRuntimeDiagnosticCode(value)))]
    .slice(0, 8);
}

const CLOSED_AI_BACKEND_PROBE_TIMEOUT_MS = 15_000;

function unavailableBackendSnapshot(
  backend: ClosedAIBackendAdapter,
  detailCode: "backend_probe_timeout" | "backend_probe_failed",
): ClosedAIBackendSnapshot {
  const truth = BACKEND_TRUTH[backend.id];
  return {
    id: backend.id,
    label: truth.label,
    status: "unreachable",
    runtimeTruth: {
      installed: false,
      configured: false,
      reachable: false,
      modelAvailable: false,
      runtimeVerified: false,
      generationVerified: false,
      verificationSource: "none",
      verifiedAt: null,
    },
    modelId: null,
    modelDigest: null,
    local: backend.id !== "private-ai-hub",
    dataBoundary: truth.dataBoundary,
    maximumComplexity: truth.maximumComplexity,
    capabilities: [],
    supportedTaskTypes: backend.id === "browser-ai" ? [] : "all",
    detailCode,
    controlLatencyMs: CLOSED_AI_BACKEND_PROBE_TIMEOUT_MS,
  };
}

async function probeBackendSnapshot(
  backend: ClosedAIBackendAdapter,
  signal?: AbortSignal,
  namespace?: Pick<ClosedAINamespace, "projectId">,
): Promise<ClosedAIBackendSnapshot> {
  if (signal?.aborted) {
    throw signal.reason ?? osError("CLOSED_AGENT_TASK_CANCELLED");
  }
  const controller = new AbortController();
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      const error = osError("CLOSED_AI_BACKEND_PROBE_TIMEOUT");
      controller.abort(error);
      reject(error);
    }, CLOSED_AI_BACKEND_PROBE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      backend.snapshot(controller.signal, namespace),
      deadline,
    ]);
  } catch (error) {
    if (signal?.aborted) {
      throw signal.reason ?? error;
    }
    return unavailableBackendSnapshot(
      backend,
      timedOut ? "backend_probe_timeout" : "backend_probe_failed",
    );
  } finally {
    if (timeout) clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

export class ClosedAgentOS {
  readonly cache: ClosedAICache;
  readonly learning: ControlledLearningOS;
  readonly ledger: VerifiableLedger;
  readonly state: ClosedAgentStateRepository;
  readonly tools: ClosedAgentToolRegistry;
  private readonly backends: Map<ClosedAIBackendAdapter["id"], ClosedAIBackendAdapter>;
  private readonly now: () => Date;
  private readonly projectQueues = new Map<string, Promise<unknown>>();
  private readonly approvalQueues = new Map<string, Promise<unknown>>();

  constructor(options: ClosedAgentOSOptions = {}) {
    this.cache = options.cache ?? new ClosedAICache({
      repository: createClosedAICacheRepository(),
    });
    this.ledger = options.ledger ?? new VerifiableLedger({
      repository: createVerifiableLedgerRepository(),
    });
    this.learning = options.learning ?? new ControlledLearningOS({
      repository: createControlledLearningRepository(),
      verifyApprovalTransaction: (input) =>
        this.verifyLearningApprovalTransaction(input),
    });
    this.state = options.state ?? createClosedAgentStateRepository();
    this.tools = options.tools ?? new ClosedAgentToolRegistry();
    this.backends = new Map(
      (options.backends ?? createDefaultClosedAIBackends()).map((backend) => [backend.id, backend]),
    );
    this.now = options.now ?? (() => new Date());
  }

  async backendSnapshots(
    signal?: AbortSignal,
    namespace?: Pick<ClosedAINamespace, "projectId">,
  ) {
    return Promise.all(
      [...this.backends.values()].map((backend) =>
        probeBackendSnapshot(backend, signal, namespace)
      ),
    );
  }

  execute(request: ClosedAgentTaskRequest): Promise<ClosedAgentExecutionResult> {
    const projectId = request.namespace.projectId;
    const previous = this.projectQueues.get(projectId) ?? Promise.resolve();
    this.emitProgress(request, "queued", "工作已進入此作品的安全佇列", 0);
    const operation = previous.then(() => this.executeInternal(request));
    this.projectQueues.set(projectId, operation.catch(() => undefined));
    return operation;
  }

  private async executeInternal(
    requestInput: ClosedAgentTaskRequest,
  ): Promise<ClosedAgentExecutionResult> {
    let request = requestInput;
    let regenerationSource: ClosedAgentCandidate | null = null;
    assertClosedAINamespace(request.namespace);
    if (!request.taskId || !request.objective.trim()) {
      throw osError("CLOSED_AGENT_TASK_INVALID");
    }
    if (request.regeneration) {
      const regeneration = request.regeneration;
      if (
        !regeneration.previousCandidateId?.trim()
        || !regeneration.previousTaskId?.trim()
        || regeneration.cacheBypassReason !== "explicit_regeneration"
        || !Number.isSafeInteger(regeneration.regenerationAttempt)
        || regeneration.regenerationAttempt < 1
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          regeneration.regenerationNonce,
        )
        || !/^[a-f0-9]{64}$/iu.test(regeneration.previousCandidateDigest)
        || !Number.isSafeInteger(regeneration.modelSeed)
        || regeneration.modelSeed < 1
        || regeneration.modelSeed > 0x7fffffff
        || !regeneration.direction.trim()
      ) {
        throw osError("CLOSED_AGENT_REGENERATION_CONTRACT_INVALID");
      }
      if (request.taskId === regeneration.previousTaskId) {
        throw osError("CLOSED_AGENT_REGENERATION_TASK_ID_REUSE", undefined, {
          fallbackAttempted: false,
        });
      }
      if (
        !request.preferredBackend
        || !REGENERATION_BACKENDS.has(request.preferredBackend)
      ) {
        throw osError("CLOSED_AGENT_REGENERATION_BACKEND_REQUIRED", undefined, {
          fallbackAttempted: false,
        });
      }
      const source = await this.state.get<ClosedAgentCandidate>(
        regeneration.previousCandidateId,
      );
      if (!source) {
        throw osError("CLOSED_AGENT_REGENERATION_SOURCE_NOT_FOUND", undefined, {
          fallbackAttempted: false,
        });
      }
      const sourceTask = await this.state.get<ClosedAgentTaskRecord>(source.taskId);
      const sourceContentDigest = await sha256Hex(source.content);
      const expectedAttempt = (source.regeneration?.regenerationAttempt ?? 0) + 1;
      const sourceLedgerId = `closed-agent:${source.projectId}:${source.taskId}`;
      const [sourceLedgerVerification, sourceLedgerBlocks] = await Promise.all([
        this.ledger.verify(sourceLedgerId),
        this.ledger.repository.list(sourceLedgerId),
      ]);
      const sourceGenerationBlock = sourceLedgerBlocks.find(
        (block) => block.eventType === "candidate-generated",
      );
      const sourceGenerationRecord = sourceGenerationBlock?.contentRecordId
        ? await this.ledger.repository.getContent(
            sourceGenerationBlock.contentRecordId,
            {
              ledgerId: sourceLedgerId,
              projectId: source.projectId,
              namespaceDigest: sourceGenerationBlock.namespaceDigest,
            },
          )
        : null;
      const sourceGeneration = sourceGenerationRecord?.content as {
        candidateId?: unknown;
        taskId?: unknown;
        backendId?: unknown;
        modelId?: unknown;
        modelDigest?: unknown;
        adapterId?: unknown;
        adapterDigest?: unknown;
        contentDigest?: unknown;
        contextDigest?: unknown;
        executionReceipt?: unknown;
      } | undefined;
      const sourceTelemetry = source.generationTelemetry;
      const legacyGenerationPayload = sourceTelemetry
        ? {
            taskId: source.taskId,
            backendId: source.backendId,
            modelId: source.modelId,
            modelDigest: source.modelDigest,
            adapterId: source.adapterId ?? null,
            adapterDigest: source.adapterDigest ?? null,
            contentDigest: source.contentDigest,
            candidateOnly: true,
            qualityMode: sourceTelemetry.qualityMode,
            qualityPasses: sourceTelemetry.qualityPasses,
            draftDigest: sourceTelemetry.draftDigest,
            criticDigest: sourceTelemetry.criticDigest,
          }
        : null;
      const legacyGenerationResultBase = sourceTelemetry
        ? {
            elapsedMs: sourceTelemetry.elapsedMs,
            dataLeftDevice: source.dataLeftDevice,
            externalRequest: source.externalRequest,
            firstTokenMs: sourceTelemetry.firstTokenMs,
            outputCharacters: sourceTelemetry.outputCharacters,
            omittedInputCharacters: sourceTelemetry.omittedInputCharacters,
            qualityMode: sourceTelemetry.qualityMode,
            qualityPasses: sourceTelemetry.qualityPasses,
            draftDigest: sourceTelemetry.draftDigest,
            criticDigest: sourceTelemetry.criticDigest,
            actualExecutor: source.actualExecutor,
            executionReceipt: source.executionReceipt,
            regeneration: source.regeneration
              ? {
                  regenerationAttempt: source.regeneration.regenerationAttempt,
                  previousCandidateDigest: source.regeneration.previousCandidateDigest,
                  cacheBypassReason: source.regeneration.cacheBypassReason,
                  cacheBypassed: true,
                  previousContentReused: false,
                  nonceStored: false,
                }
              : null,
          }
        : null;
      const legacyGenerationResults = legacyGenerationResultBase
        ? [
            [sourceTelemetry!.profileId, sourceTelemetry!.inputCharacters],
            [null, sourceTelemetry!.inputCharacters],
            [sourceTelemetry!.profileId, null],
            [null, null],
          ].map(([profileId, inputCharacters]) => ({
            ...legacyGenerationResultBase,
            profileId,
            inputCharacters,
          }))
        : [];
      const legacyLedgerProof = Boolean(
        sourceGenerationBlock
        && !sourceGenerationRecord
        && legacyGenerationPayload
        && legacyGenerationResults.length
        && sourceGenerationBlock.payloadDigest
          === await sha256Hex(stableStringify(legacyGenerationPayload))
        && (await Promise.all(legacyGenerationResults.map((result) => (
          sha256Hex(stableStringify(result))
        )))).includes(sourceGenerationBlock.resultDigest ?? ""),
      );
      const retainedLedgerProof = Boolean(
        sourceGenerationBlock
        && sourceGenerationRecord
        && sourceGeneration?.candidateId === source.id
        && sourceGeneration.taskId === source.taskId
        && sourceGeneration.backendId === source.backendId
        && sourceGeneration.modelId === source.modelId
        && sourceGeneration.modelDigest === source.modelDigest
        && sourceGeneration.adapterId === (source.adapterId ?? null)
        && sourceGeneration.adapterDigest === (source.adapterDigest ?? null)
        && sourceGeneration.contentDigest === source.contentDigest
        && sourceGeneration.contextDigest === source.contextDigest
        && stableStringify(sourceGeneration.executionReceipt)
          === stableStringify(source.executionReceipt),
      );
      if (
        source.id !== regeneration.previousCandidateId
        || source.id !== `closed-agent-candidate:${await sha256Hex(`${source.taskId}|${source.content}`)}`
        || source.taskId !== regeneration.previousTaskId
        || source.contentDigest !== regeneration.previousCandidateDigest
        || sourceContentDigest !== source.contentDigest
        || regeneration.regenerationAttempt !== expectedAttempt
        || !hasStableRegenerationNamespace(source.namespace, request.namespace)
        || !sourceTask
        || !hasStableRegenerationNamespace(sourceTask.namespace, request.namespace)
        || sourceTask.taskType !== request.taskType
        || source.sourceChapterId !== (request.sourceChapterId ?? null)
        || source.sourceRevision !== (request.sourceRevision ?? null)
        || !hasVerifiedRegenerationSourceIdentity(source, sourceTask)
        || !sourceLedgerVerification.valid
        || !sourceGenerationBlock
        || (!retainedLedgerProof && !legacyLedgerProof)
      ) {
        throw osError("CLOSED_AGENT_REGENERATION_SOURCE_NOT_VERIFIED", undefined, {
          fallbackAttempted: false,
        });
      }
      if (request.preferredBackend !== source.backendId) {
        throw osError("CLOSED_AGENT_REGENERATION_BACKEND_MISMATCH", undefined, {
          sourceBackend: source.backendId,
          requestedBackend: request.preferredBackend,
          fallbackAttempted: false,
        });
      }
      regenerationSource = source;
    }
    if (request.signal?.aborted) throw osError("CLOSED_AGENT_TASK_CANCELLED");
    const existing = await this.state.get<ClosedAgentTaskRecord>(request.taskId);
    if (request.regeneration && existing) {
      throw osError("CLOSED_AGENT_REGENERATION_TASK_ID_REUSE", undefined, {
        fallbackAttempted: false,
      });
    }
    if (existing && existing.state === "awaiting-approval") {
      const candidates = await this.state.list<ClosedAgentCandidate>(
        request.namespace.projectId,
        "candidate",
      );
      const candidate = candidates.find((item) => item.taskId === request.taskId);
      if (!candidate) throw osError("CLOSED_AGENT_IDEMPOTENCY_STATE_INCOMPLETE");
      const replayRequest = { ...request, namespace: candidate.namespace };
      const blocks = await this.ledger.repository.list(this.ledgerId(request));
      const planLookup = await this.cache.get<ClosedAgentPlan>(
        "agent-plan",
        candidate.namespace,
        this.planCacheInput(replayRequest, candidate.backendId),
      );
      if (!planLookup.entry) throw osError("CLOSED_AGENT_IDEMPOTENCY_PLAN_MISSING");
      const activeLearning = await this.learning.activeConfiguration(candidate.namespace);
      return {
        task: existing,
        candidate,
        plan: planLookup.entry.value,
        toolExecutions: structuredClone(candidate.toolExecutions ?? []),
        route: {
          backendId: candidate.backendId,
          locked: true,
          automatic: !request.preferredBackend,
          reasonCode: "IDEMPOTENT_REPLAY",
          fallbackAttempted: false,
        },
        cache: { candidateHit: true, planHit: true, bypassReason: null },
        learning: activeLearning,
        ledgerHeadHash: blocks.at(-1)?.blockHash ?? "",
      };
    }
    const createdAt = this.now().toISOString();
    let task: ClosedAgentTaskRecord = {
      schemaVersion: CLOSED_AGENT_OS_SCHEMA_VERSION,
      kind: "task",
      id: request.taskId,
      projectId: request.namespace.projectId,
      namespace: structuredClone(request.namespace),
      taskType: request.taskType,
      backendId: null,
      state: "queued",
      errorCode: null,
      createdAt,
      updatedAt: createdAt,
    };
    await this.state.put(task);
    await this.ledger.append({
      ledgerId: this.ledgerId(request),
      namespace: request.namespace,
      eventType: "task-accepted",
      payload: {
        taskId: request.taskId,
        taskType: request.taskType,
        objectiveDigest: await sha256Hex(request.objective),
      },
    });
    try {
      this.emitProgress(request, "probing", "正在核對三個閉端後端的真實狀態", 8);
      const routingLearning = await this.learning.activeConfiguration(request.namespace);
      request = {
        ...request,
        learningConfiguration: routingLearning.configuration,
      };
      const snapshots = await this.backendSnapshots(request.signal, request.namespace);
      const route = selectClosedAIBackend(request, snapshots);
      const backend = this.backends.get(route.backend.id);
      if (!backend) throw osError("CLOSED_AI_BACKEND_ADAPTER_MISSING");
      if (
        !route.backend.modelId
        || !isCryptographicClosedAIModelDigest(route.backend.modelDigest)
      ) {
        throw osError("CLOSED_AI_MODEL_IDENTITY_MISMATCH", undefined, {
          backendId: route.backend.id,
          routedModelId: route.backend.modelId,
          routedDigestVerified: false,
        });
      }
      if (regenerationSource && (
        route.backend.id !== regenerationSource.backendId
        || route.backend.modelId !== regenerationSource.modelId
        || route.backend.modelDigest !== regenerationSource.modelDigest
      )) {
        throw osError("CLOSED_AGENT_REGENERATION_MODEL_IDENTITY_MISMATCH", undefined, {
          sourceBackend: regenerationSource.backendId,
          routedBackend: route.backend.id,
          fallbackAttempted: false,
        });
      }
      this.emitProgress(
        request,
        "routing",
        `已鎖定 ${route.backend.label}，不會靜默切換`,
        18,
        { backendId: route.backend.id },
      );
      request = {
        ...request,
        namespace: {
          ...request.namespace,
          modelId: route.backend.modelId,
          modelDigest: route.backend.modelDigest,
        },
      };
      const activeLearning = await this.learning.activeConfiguration(request.namespace);
      request = {
        ...request,
        learningConfiguration: activeLearning.configuration,
      };
      task = {
        ...task,
        namespace: structuredClone(request.namespace),
        backendId: route.backend.id,
        state: "running",
        updatedAt: this.now().toISOString(),
      };
      await this.state.put(task);
      await this.ledger.append({
        ledgerId: this.ledgerId(request),
        namespace: request.namespace,
        eventType: "backend-selected",
        payload: {
          backendId: route.backend.id,
          automatic: route.automatic,
          reasonCode: route.reasonCode,
          fallbackAttempted: false,
          routingLearningApplied: routingLearning.applied,
          routingLearningVersionId: routingLearning.versionId,
          routingLearningConfigurationDigest: routingLearning.configurationDigest,
          controlledLearningApplied: activeLearning.applied,
          controlledLearningVersionId: activeLearning.versionId,
          controlledLearningConfigurationDigest: activeLearning.configurationDigest,
          controlledLearningReasonCode: activeLearning.reasonCode,
        },
      });

      const planInput = this.planCacheInput(request, route.backend.id);
      const planResult = await this.cache.compute(
        "agent-plan",
        request.namespace,
        planInput,
        () => createClosedAgentPlan({
          request,
          backendId: route.backend.id,
          complexity: route.complexity,
        }),
        {
          tags: ["closed-agent-plan", `task:${request.taskType}`],
          ttlMs: learningCacheTtl(request.learningConfiguration, "agent-plan"),
        },
      );
      const plan = planResult.value;
      this.emitProgress(
        request,
        "planning",
        planResult.cacheHit ? "已重用通過驗證的代理計畫" : "代理計畫已建立並完成權限檢查",
        28,
        {
          backendId: route.backend.id,
          cacheHit: planResult.cacheHit,
        },
      );
      for (const role of plan.roles) assertClosedAgentPermission({ request, role });
      await this.recordOperationalLearningSignal({
        request,
        outcome: "planner_result",
        score: 1,
        tags: [
          "planner-completed",
          `complexity:${route.complexity}`,
          ...plan.roles.map((role) => `role:${role}`),
        ],
        feature: {
          backendId: route.backend.id,
          planDigest: plan.planDigest,
          roleCount: plan.roles.length,
          plannerStrategy: String(
            request.learningConfiguration?.["planner.strategy"] ?? "standard",
          ),
        },
      });
      const { toolResults, toolExecutions } = await this.executeTools(request, plan);
      if (request.context.some((item) =>
        item.kind === "author-note"
        && item.visibility !== "author-only")) {
        throw osError("CLOSED_AGENT_AUTHOR_ONLY_LABEL_REQUIRED");
      }
      const actorNamespace = {
        ...request.namespace,
        agentRole: "actor",
      };
      this.emitProgress(
        request,
        "retrieving",
        "正在取得已核准且符合可見性邊界的脈絡",
        40,
        { backendId: route.backend.id },
      );
      const actorContextResult = await this.cache.compute(
        "retrieval",
        actorNamespace,
        {
          taskType: request.taskType,
          context: await Promise.all(request.context.map(async (item) => ({
            id: item.id,
            kind: item.kind,
            learningFacet: item.learningFacet ?? "general",
            visibility: item.visibility,
            privacyLevel: item.privacyLevel,
            approved: item.approved,
            textDigest: await sha256Hex(item.text),
          }))),
          learningConfiguration: request.learningConfiguration ?? {},
        },
        async () => request.context
          .map((item, index) => ({ item, index }))
          .filter(({ item }) =>
            item.approved
            && item.visibility !== "author-only"
            && item.visibility !== "evaluator"
            && item.privacyLevel === request.namespace.privacyLevel)
          .sort((left, right) =>
            learningRetrievalWeight(
              request.learningConfiguration,
              right.item.kind,
              right.item.learningFacet,
            ) - learningRetrievalWeight(
              request.learningConfiguration,
              left.item.kind,
              left.item.learningFacet,
            ) || left.index - right.index)
          .map(({ item }) => item),
        {
          tags: ["actor-context", `task:${request.taskType}`],
          ttlMs: learningCacheTtl(request.learningConfiguration, "retrieval"),
        },
      );
      const actorContext = actorContextResult.value;
      const candidateInput = {
        taskType: request.taskType,
        objectiveDigest: await sha256Hex(request.objective),
        actorContextDigests: await Promise.all(actorContext.map((item) => sha256Hex(item.text))),
        planDigest: plan.planDigest,
        qualityMode: plan.qualityMode,
        backendId: route.backend.id,
        learningConfiguration: request.learningConfiguration ?? {},
        toolResultDigests: await Promise.all(
          toolResults.map((item) => sha256Hex(stableStringify(item.value))),
        ),
        regeneration: request.regeneration
          ? {
            previousCandidateId: request.regeneration.previousCandidateId,
            previousTaskId: request.regeneration.previousTaskId,
            regenerationAttempt: request.regeneration.regenerationAttempt,
            regenerationNonce: request.regeneration.regenerationNonce,
            previousCandidateDigest: request.regeneration.previousCandidateDigest,
            cacheBypassReason: request.regeneration.cacheBypassReason,
            modelSeed: request.regeneration.modelSeed,
          }
          : null,
      };
      const semanticContextDigest = await sha256Hex(stableStringify({
        taskType: candidateInput.taskType,
        actorContextDigests: candidateInput.actorContextDigests,
        planDigest: candidateInput.planDigest,
        qualityMode: candidateInput.qualityMode,
        backendId: candidateInput.backendId,
        learningConfiguration: candidateInput.learningConfiguration,
        toolResultDigests: candidateInput.toolResultDigests,
      }));
      const semanticText = `${request.taskType}\n${request.objective}`;
      let execution: ClosedBackendExecutionResult;
      let candidateCacheHit = false;
      let executionStartedAt: string | null = null;
      let executionCompletedAt: string | null = null;
      const cacheBypassReason = request.regeneration?.cacheBypassReason ?? null;
      this.emitProgress(
        request,
        "generating",
        "模型已開始產生候選",
        50,
        { backendId: route.backend.id },
      );
      if (request.regeneration) {
        executionStartedAt = this.now().toISOString();
        execution = await this.executeQualityPipeline({
          backend,
          routedBackend: route.backend,
          request,
          plan,
          actorContext,
          toolResults,
        });
        executionCompletedAt = this.now().toISOString();
        assertClosedAIModelIdentity(route.backend, execution);
        this.emitProgress(
          request,
          "generating",
          "已依明確重新生成要求略過舊候選快取",
          80,
          {
            backendId: route.backend.id,
            cacheHit: false,
            generatedCharacters: execution.content.length,
          },
        );
      } else {
        const semanticLookup = await this.cache.getSemantic<{
          taskType: ClosedAgentTaskRequest["taskType"];
          qualityMode: ClosedAgentPlan["qualityMode"];
          semanticContextDigest: string;
          execution: ClosedBackendExecutionResult;
        }>(
          request.namespace,
          semanticText,
          learningSemanticThreshold(request.learningConfiguration),
          (entry) => entry.value.semanticContextDigest === semanticContextDigest,
        );
        if (
          semanticLookup.hit
          && semanticLookup.entry?.value.taskType === request.taskType
          && semanticLookup.entry.value.qualityMode === plan.qualityMode
          && semanticLookup.entry.value.execution.backendId === route.backend.id
        ) {
          execution = semanticLookup.entry.value.execution;
          assertClosedAIModelIdentity(route.backend, execution);
          candidateCacheHit = true;
          this.emitProgress(
            request,
            "generating",
            "命中同命名空間的語意候選快取",
            80,
            {
              backendId: route.backend.id,
              cacheHit: true,
              generatedCharacters: execution.content.length,
            },
          );
        } else {
          const exactResult = await this.cache.compute(
            "exact",
            request.namespace,
            candidateInput,
            async () => {
              executionStartedAt = this.now().toISOString();
              const generated = await this.executeQualityPipeline({
                backend,
                routedBackend: route.backend,
                request,
                plan,
                actorContext,
                toolResults,
              });
              executionCompletedAt = this.now().toISOString();
              assertClosedAIModelIdentity(route.backend, generated);
              return generated;
            },
            {
              tags: ["closed-agent-candidate", `task:${request.taskType}`],
              ttlMs: learningCacheTtl(request.learningConfiguration, "exact"),
            },
          );
          execution = exactResult.value;
          assertClosedAIModelIdentity(route.backend, execution);
          candidateCacheHit = exactResult.cacheHit;
          if (exactResult.cacheHit) {
            this.emitProgress(
              request,
              "generating",
              "命中完全相同輸入的候選快取",
              80,
              {
                backendId: route.backend.id,
                cacheHit: true,
                generatedCharacters: execution.content.length,
              },
            );
          }
          await this.cache.put({
            layer: "semantic",
            namespace: request.namespace,
            input: {
              taskType: request.taskType,
              candidateInput,
            },
            semanticText,
            value: {
              taskType: request.taskType,
              qualityMode: plan.qualityMode,
              semanticContextDigest,
              execution,
            },
            tags: ["closed-agent-semantic-candidate", `task:${request.taskType}`],
            ttlMs: learningCacheTtl(request.learningConfiguration, "semantic"),
          });
        }
      }
      if (request.taskType === "chapter.abcChoices") {
        const normalized = normalizeAbcChoicesExecutionContent(execution.content);
        if (!normalized.valid) {
          throw osError("ABC_CHOICES_INVALID_STRUCTURE", undefined, {
            extractedItemCount: normalized.extractedItemCount,
            materiallyDistinct: normalized.materiallyDistinct,
          });
        }
        execution = {
          ...execution,
          content: normalized.content,
        };
      }
      if (execution.backendId !== route.backend.id) {
        throw osError("CLOSED_AI_BACKEND_IDENTITY_MISMATCH", undefined, {
          selected: route.backend.id,
          actual: execution.backendId,
        });
      }
      assertClosedAIModelIdentity(route.backend, execution);
      if (regenerationSource && (
        execution.modelId !== regenerationSource.modelId
        || execution.modelDigest !== regenerationSource.modelDigest
        || (execution.adapterId ?? null) !== (regenerationSource.adapterId ?? null)
        || (execution.adapterDigest ?? null) !== (regenerationSource.adapterDigest ?? null)
      )) {
        throw osError("CLOSED_AGENT_REGENERATION_EXECUTION_IDENTITY_MISMATCH", undefined, {
          backendId: execution.backendId,
          fallbackAttempted: false,
        });
      }
      const contentDigest = await sha256Hex(execution.content);
      if (request.regeneration && regenerationSource) {
        const normalizedDigestReused = normalizeRegenerationContent(execution.content)
          === normalizeRegenerationContent(regenerationSource.content);
        const similarityScore = Number(regenerationSimilarity(
          regenerationSource.content,
          execution.content,
        ).toFixed(6));
        if (
          contentDigest === request.regeneration.previousCandidateDigest
          || normalizedDigestReused
          || similarityScore >= 0.95
        ) {
          throw osError("CLOSED_AGENT_REGENERATION_CONTENT_REUSED", undefined, {
            normalizedDigestDifferent: !normalizedDigestReused,
            similarityMetric: "character_trigram_jaccard",
            similarityScore,
            fallbackAttempted: false,
            canonicalMutationCount: 0,
          });
        }
      }
      const contextDigest = request.contextDigest ?? await sha256Hex(
        stableStringify(request.context.map((item) => ({
          id: item.id,
          kind: item.kind,
          visibility: item.visibility,
          privacyLevel: item.privacyLevel,
          approved: item.approved,
          text: item.text,
        }))),
      );
      const outputCharacters =
        execution.outputCharacters ?? execution.content.length;
      const executionReceipt: ClosedAIExecutionReceipt | null =
        !candidateCacheHit
        && executionStartedAt
        && executionCompletedAt
        && outputCharacters > 0
        && isCryptographicClosedAIModelDigest(execution.modelDigest)
          ? {
            taskId: request.taskId,
            backendId: execution.backendId,
            modelId: execution.modelId,
            modelDigest: execution.modelDigest,
            startedAt: executionStartedAt,
            completedAt: executionCompletedAt,
            generatedTokenEvents: execution.generatedTokenEvents ?? 0,
            outputCharacters,
            contentDigest,
            contextDigest,
            proofState: "verified",
            dataLeftDevice: execution.dataLeftDevice,
            externalRequest: execution.externalRequest,
            // Consumer-facing execution identity is the verified Closed AI
            // backend. Browser sub-runtime truth (WebLLM/Prompt API) remains
            // independently auditable through its compute and Fabric receipts.
            actualExecutor: execution.backendId,
            browserComputeReceiptId: execution.browserComputeReceiptId,
            browserFabricReceiptId: execution.browserFabricReceiptId,
            browserFabricPlannedGraph: execution.browserFabricPlannedGraph,
            contextTokensBefore: execution.browserContextTokensBefore,
            contextTokensAfter: execution.browserContextTokensAfter,
            tokensSaved: execution.browserTokensSaved,
          }
          : null;
      if (request.regeneration && (
        !executionReceipt
        || executionReceipt.taskId !== request.taskId
        || executionReceipt.backendId !== request.preferredBackend
        || executionReceipt.actualExecutor !== request.preferredBackend
        || executionReceipt.modelId !== execution.modelId
        || executionReceipt.modelDigest !== execution.modelDigest
        || executionReceipt.contentDigest !== contentDigest
        || executionReceipt.contextDigest !== contextDigest
        || executionReceipt.externalRequest
        || executionReceipt.dataLeftDevice
        || execution.externalRequest
        || execution.dataLeftDevice
      )) {
        throw osError("CLOSED_AGENT_REGENERATION_EXECUTION_RECEIPT_INVALID", undefined, {
          fallbackAttempted: false,
          canonicalMutationCount: 0,
        });
      }
      const candidateId = `closed-agent-candidate:${await sha256Hex(
        `${request.taskId}|${execution.content}`,
      )}`;
      this.emitProgress(
        request,
        "evaluating",
        "正在檢查語言、資料邊界、品質與憑證洩漏",
        86,
        {
          backendId: route.backend.id,
          generatedCharacters: execution.content.length,
          cacheHit: candidateCacheHit,
        },
      );
      const evaluation = await evaluateClosedAgentCandidate({ request, execution });
      if (request.regeneration && !evaluation.passed) {
        throw osError("CLOSED_AGENT_EVALUATION_BLOCKED", undefined, {
          blockingCodes: evaluation.blockingCodes,
          canonicalMutationCount: 0,
        });
      }
      // A runtime may finish after ignoring an AbortSignal. Cancellation must
      // still win before the first durable candidate/ledger write.
      if (request.signal?.aborted) {
        throw osError("CLOSED_AGENT_TASK_CANCELLED");
      }
      await this.ledger.append({
        ledgerId: this.ledgerId(request),
        namespace: request.namespace,
        eventType: "candidate-generated",
        payload: {
          candidateId,
          taskId: request.taskId,
          backendId: execution.backendId,
          modelId: execution.modelId,
          modelDigest: execution.modelDigest,
          adapterId: execution.adapterId ?? null,
          adapterDigest: execution.adapterDigest ?? null,
          contentDigest,
          contextDigest,
          executionReceipt,
          candidateOnly: true,
          qualityMode: execution.qualityMode,
          qualityPasses: execution.qualityPasses,
          draftDigest: execution.draftDigest,
          criticDigest: execution.criticDigest,
        },
        retainContent: true,
        result: {
          elapsedMs: execution.elapsedMs,
          dataLeftDevice: execution.dataLeftDevice,
          externalRequest: execution.externalRequest,
          profileId: execution.profileId ?? null,
          firstTokenMs: execution.firstTokenMs ?? null,
          inputCharacters: execution.inputCharacters ?? null,
          outputCharacters: execution.outputCharacters ?? execution.content.length,
          omittedInputCharacters: execution.omittedInputCharacters ?? 0,
          qualityMode: execution.qualityMode,
          qualityPasses: execution.qualityPasses,
          draftDigest: execution.draftDigest,
          criticDigest: execution.criticDigest,
          actualExecutor: executionReceipt?.actualExecutor
            ?? executionReceipt?.backendId
            ?? "not_executed",
          executionReceipt,
          regeneration: request.regeneration
            ? {
              previousCandidateId: request.regeneration.previousCandidateId,
              previousTaskId: request.regeneration.previousTaskId,
              regenerationAttempt: request.regeneration.regenerationAttempt,
              previousCandidateDigest: request.regeneration.previousCandidateDigest,
              cacheBypassReason: request.regeneration.cacheBypassReason,
              cacheBypassed: true,
              previousContentReused: false,
              nonceStored: false,
            }
            : null,
        },
      });
      await this.ledger.append({
        ledgerId: this.ledgerId(request),
        namespace: request.namespace,
        eventType: "candidate-evaluated",
        payload: {
          passed: evaluation.passed,
          score: evaluation.score,
          blockingCodes: evaluation.blockingCodes,
          warningCodes: evaluation.warningCodes,
          evaluatorInputDigest: evaluation.evaluatorInputDigest,
        },
      });
      await this.recordOperationalLearningSignal({
        request,
        outcome: "plot_continuity_result",
        score: evaluation.score,
        tags: [
          evaluation.passed ? "continuity-pass" : "continuity-blocked",
          ...evaluation.blockingCodes.map((code) => `block:${code}`),
          ...evaluation.warningCodes.map((code) => `warning:${code}`),
        ],
        feature: {
          evaluatorInputDigest: evaluation.evaluatorInputDigest,
          passed: evaluation.passed,
        },
      });
      if (
        String(request.taskType).includes("character")
        || plan.roles.includes("character-agent")
      ) {
        await this.recordOperationalLearningSignal({
          request,
          outcome: "character_consistency_result",
          score: evaluation.score,
          tags: [
            evaluation.passed ? "character-consistency-pass" : "character-consistency-blocked",
          ],
          feature: {
            evaluatorInputDigest: evaluation.evaluatorInputDigest,
            passed: evaluation.passed,
          },
        });
      }
      if (!evaluation.passed) {
        throw osError("CLOSED_AGENT_EVALUATION_BLOCKED", undefined, {
          blockingCodes: evaluation.blockingCodes,
        });
      }
      const updatedAt = this.now().toISOString();
      const candidate: ClosedAgentCandidate = {
        schemaVersion: CLOSED_AGENT_OS_SCHEMA_VERSION,
        kind: "candidate",
        id: candidateId,
        projectId: request.namespace.projectId,
        taskId: request.taskId,
        namespace: structuredClone(request.namespace),
        backendId: execution.backendId,
        modelId: execution.modelId,
        modelDigest: execution.modelDigest,
        adapterId: execution.adapterId ?? null,
        adapterDigest: execution.adapterDigest ?? null,
        content: execution.content,
        contentDigest,
        sourceChapterId: request.sourceChapterId ?? null,
        sourceRevision: request.sourceRevision ?? null,
        actualExecutor: executionReceipt?.actualExecutor
          ?? executionReceipt?.backendId
          ?? "not_executed",
        executionReceipt,
        toolExecutions: structuredClone(toolExecutions),
        contextDigest,
        contextSourceSummary: request.contextSourceSummary ?? stableStringify(
          Object.fromEntries(
            [...new Set(request.context.map((item) => item.kind))]
              .sort()
              .map((kind) => [
                kind,
                request.context.filter((item) => item.kind === kind).length,
              ]),
          ),
        ),
        dataLeftDevice: execution.dataLeftDevice,
        externalRequest: execution.externalRequest,
        planDigest: plan.planDigest,
        evaluation,
        status: "awaiting-approval",
        candidateOnly: true,
        canonicalMutationCount: 0,
        regeneration: request.regeneration
          ? {
            previousCandidateId: request.regeneration.previousCandidateId,
            previousTaskId: request.regeneration.previousTaskId,
            regenerationAttempt: request.regeneration.regenerationAttempt,
            previousCandidateDigest: request.regeneration.previousCandidateDigest,
            cacheBypassReason: request.regeneration.cacheBypassReason,
            cacheBypassed: true,
            previousContentReused: false,
            newCandidate: true,
            nonceStored: false,
          }
          : undefined,
        generationTelemetry: {
          profileId: execution.profileId ?? `${execution.backendId}-default-v1`,
          elapsedMs: execution.elapsedMs,
          firstTokenMs: execution.firstTokenMs ?? null,
          inputCharacters: execution.inputCharacters ?? 0,
          outputCharacters: execution.outputCharacters ?? execution.content.length,
          generatedTokenEvents: execution.generatedTokenEvents ?? 0,
          omittedInputCharacters: execution.omittedInputCharacters ?? 0,
          qualityMode: execution.qualityMode,
          qualityPasses: execution.qualityPasses,
          draftDigest: execution.draftDigest,
          criticDigest: execution.criticDigest,
          browserComputeReceiptId: execution.browserComputeReceiptId,
          browserFabricReceiptId: execution.browserFabricReceiptId,
          browserFabricPlannedGraph: execution.browserFabricPlannedGraph,
          contextTokensBefore: execution.browserContextTokensBefore,
          contextTokensAfter: execution.browserContextTokensAfter,
          tokensSaved: execution.browserTokensSaved,
        },
        createdAt: updatedAt,
        updatedAt,
      };
      task = {
        ...task,
        state: "awaiting-approval",
        updatedAt,
      };
      const verification = await this.ledger.verify(this.ledgerId(request));
      if (!verification.valid || !verification.headHash) {
        throw osError("CLOSED_AGENT_LEDGER_INTEGRITY_FAILED");
      }
      await this.state.putMany([candidate, task]);
      this.emitProgress(
        request,
        "awaiting-approval",
        "候選與證據鏈已完成，等待人工核准",
        100,
        {
          backendId: route.backend.id,
          generatedCharacters: execution.content.length,
          cacheHit: candidateCacheHit,
        },
      );
      return {
        task,
        candidate,
        plan,
        toolExecutions,
        route: {
          backendId: route.backend.id,
          locked: true,
          automatic: route.automatic,
          reasonCode: route.reasonCode,
          fallbackAttempted: false,
        },
        cache: {
          candidateHit: candidateCacheHit,
          planHit: planResult.cacheHit,
          bypassReason: cacheBypassReason,
        },
        learning: activeLearning,
        ledgerHeadHash: verification.headHash,
      };
    } catch (cause) {
      const code = String((cause as { code?: string })?.code || "CLOSED_AGENT_TASK_FAILED");
      const qualityReasonCodes = closedAgentQualityReasonCodes(cause);
      const qualityReasonSummary = qualityReasonCodes.length
        ? `：${qualityReasonCodes.join("、")}`
        : "";
      const browserRuntimeEvidence = closedAgentBrowserRuntimeEvidenceProgress(cause);
      const browserRuntimeEvidenceSummary = browserRuntimeEvidence
        ? ` ${browserRuntimeEvidence}`
        : "";
      task = {
        ...task,
        state: request.signal?.aborted
          || code === "CLOSED_AGENT_TASK_CANCELLED"
          || code === "OLLAMA_CANCELLED"
          ? "cancelled"
          : "failed",
        errorCode: code,
        updatedAt: this.now().toISOString(),
      };
      await this.state.put(task);
      this.emitProgress(
        request,
        task.state === "cancelled" ? "cancelled" : "failed",
        task.state === "cancelled"
          ? "工作已取消，未修改 Memory 或 Canon"
          : `工作安全停止（${code}${qualityReasonSummary}）${browserRuntimeEvidenceSummary}`,
        100,
        task.backendId ? { backendId: task.backendId } : {},
      );
      throw cause;
    }
  }

  approveCandidate(input: ApprovalInput) {
    const previous = this.approvalQueues.get(input.candidateId) ?? Promise.resolve();
    const operation = previous.then(() => this.approveCandidateInternal(input));
    this.approvalQueues.set(input.candidateId, operation.catch(() => undefined));
    return operation;
  }

  private async approveCandidateInternal(input: ApprovalInput) {
    const candidate = await this.state.get<ClosedAgentCandidate>(input.candidateId);
    if (!candidate) throw osError("CLOSED_AGENT_CANDIDATE_NOT_FOUND");
    if (!input.humanApproved) throw osError("CLOSED_AGENT_HUMAN_APPROVAL_REQUIRED");
    if (!candidate.evaluation.passed || candidate.status !== "awaiting-approval") {
      throw osError("CLOSED_AGENT_APPROVAL_GATE_FAILED");
    }
    const approvalId = `closed-agent-approval:${candidate.id}`;
    const ledgerId = `closed-agent:${candidate.namespace.projectId}:${candidate.taskId}`;
    const approvalPayload = {
      approvalId,
      candidateId: candidate.id,
      candidateDigest: candidate.contentDigest,
      approvedBy: input.approvedBy,
      humanApproved: true,
    };
    const approvalPayloadDigest = await sha256Hex(stableStringify(approvalPayload));
    const existingApprovalBlock = (await this.ledger.repository.list(ledgerId))
      .find((block) =>
        block.eventType === "approval-signed"
        && block.payloadDigest === approvalPayloadDigest
        && block.signature);
    const approvalBlock = existingApprovalBlock ?? await this.ledger.append({
      ledgerId,
      namespace: candidate.namespace,
      eventType: "approval-signed",
      payload: approvalPayload,
      signApproval: true,
    });
    let canonicalCommitId: string | null = null;
    let nextStoryBibleRevision: string | undefined;
    if (input.canonicalCommit) {
      const result = await input.canonicalCommit({
        candidate,
        approvalId,
        idempotencyKey: approvalId,
      });
      canonicalCommitId = result.commitId;
      nextStoryBibleRevision = result.storyBibleRevision;
      const canonicalPayload = {
        approvalId,
        candidateId: candidate.id,
        commitId: result.commitId,
        previousStoryBibleRevision: candidate.namespace.storyBibleRevision,
        resultingStoryBibleRevision: result.storyBibleRevision ?? null,
      };
      const canonicalPayloadDigest = await sha256Hex(stableStringify(canonicalPayload));
      const existingCanonicalBlock = (await this.ledger.repository.list(ledgerId))
        .find((block) =>
          block.eventType === "canonical-commit"
          && block.payloadDigest === canonicalPayloadDigest);
      if (!existingCanonicalBlock) {
        await this.ledger.append({
          ledgerId,
          namespace: candidate.namespace,
          eventType: "canonical-commit",
          payload: canonicalPayload,
        });
      }
    }
    const approvedAt = this.now().toISOString();
    const approval: ClosedAgentApprovalRecord = {
      schemaVersion: CLOSED_AGENT_OS_SCHEMA_VERSION,
      kind: "approval",
      id: approvalId,
      projectId: candidate.projectId,
      namespace: structuredClone(candidate.namespace),
      candidateId: candidate.id,
      approvedBy: input.approvedBy,
      approvalBlockHash: approvalBlock.blockHash,
      canonicalCommitId,
      approvedAt,
    };
    const memory: ClosedAgentMemoryRecord = {
      schemaVersion: CLOSED_AGENT_OS_SCHEMA_VERSION,
      kind: "memory",
      id: `closed-agent-memory:${candidate.id}`,
      projectId: candidate.projectId,
      namespace: structuredClone(candidate.namespace),
      candidateId: candidate.id,
      content: candidate.content,
      contentDigest: candidate.contentDigest,
      approvalId,
      approvedAt,
      canonical: Boolean(canonicalCommitId),
    };
    const updatedCandidate: ClosedAgentCandidate = {
      ...candidate,
      status: canonicalCommitId ? "committed" : "approved",
      canonicalMutationCount: canonicalCommitId ? 1 : 0,
      updatedAt: approvedAt,
    };
    const task = await this.state.get<ClosedAgentTaskRecord>(candidate.taskId);
    const stateRecords = [
      approval,
      memory,
      updatedCandidate,
      ...(task ? [{
        ...task,
        state: "completed",
        updatedAt: approvedAt,
      } as ClosedAgentTaskRecord] : []),
    ];
    try {
      await this.state.putMany(stateRecords);
    } catch (cause) {
      throw osError(
        "CLOSED_AGENT_APPROVAL_STATE_COMMIT_FAILED_RECOVERABLE",
        "The canonical operation is journaled and this approval can be retried safely.",
        {
          candidateId: candidate.id,
          approvalId,
          canonicalCommitId,
          causeCode: String((cause as { code?: string })?.code || "STATE_COMMIT_FAILED"),
        },
      );
    }
    if (nextStoryBibleRevision) {
      const count = await this.cache.invalidateStoryBibleRevision(
        candidate.namespace,
        candidate.namespace.storyBibleRevision,
      );
      let backendInvalidatedEntryCount = 0;
      let backendInvalidationStatus = "not_connected";
      const backend = this.backends.get(candidate.backendId);
      if (backend?.invalidateCache) {
        try {
          backendInvalidatedEntryCount = await backend.invalidateCache({
            tenantId: candidate.namespace.tenantId,
            userId: candidate.namespace.userId,
            projectId: candidate.namespace.projectId,
            storyId: candidate.namespace.storyId,
            canonId: candidate.namespace.canonId,
            storyBibleRevision: candidate.namespace.storyBibleRevision,
            layers: ["exact", "semantic", "retrieval", "agent-plan", "tool-result"],
          });
          backendInvalidationStatus = "completed";
        } catch {
          backendInvalidationStatus = "runtime_unavailable_revision_key_protected";
        }
      }
      await this.ledger.append({
        ledgerId,
        namespace: candidate.namespace,
        eventType: "cache-invalidated",
        payload: {
          invalidatedEntryCount: count,
          backendInvalidatedEntryCount,
          backendInvalidationStatus,
          previousStoryBibleRevision: candidate.namespace.storyBibleRevision,
          resultingStoryBibleRevision: nextStoryBibleRevision,
        },
      });
    }
    const learningSignal = await this.recordLearningOutcome({
      candidate: updatedCandidate,
      outcome: canonicalCommitId ? "approved_canon" : "accepted",
      sourceApprovalId: approvalId,
    });
    return {
      approval,
      memory,
      candidate: updatedCandidate,
      canonicalMutationCount: updatedCandidate.canonicalMutationCount,
      learningSignal,
    };
  }

  async rejectCandidate(candidateId: string) {
    const candidate = await this.state.get<ClosedAgentCandidate>(candidateId);
    if (!candidate) throw osError("CLOSED_AGENT_CANDIDATE_NOT_FOUND");
    if (candidate.status !== "awaiting-approval") {
      throw osError("CLOSED_AGENT_REJECTION_GATE_FAILED");
    }
    const task = await this.state.get<ClosedAgentTaskRecord>(candidate.taskId);
    const invalidatedCacheEntries = await this.cache.invalidate({
      ...candidate.namespace,
      layers: ["exact", "semantic"],
      ...(task ? { tags: [`task:${task.taskType}`] } : {}),
    });
    const updated: ClosedAgentCandidate = {
      ...candidate,
      status: "rejected",
      updatedAt: this.now().toISOString(),
    };
    await this.ledger.append({
      ledgerId: `closed-agent:${candidate.projectId}:${candidate.taskId}`,
      namespace: candidate.namespace,
      eventType: "cache-invalidated",
      payload: {
        reason: "candidate-rejected",
        layers: ["exact", "semantic"],
        taskType: task?.taskType ?? null,
        invalidatedCacheEntries,
        canonicalMutationCount: 0,
      },
    });
    await this.state.put(updated);
    await this.recordLearningOutcome({
      candidate: updated,
      outcome: "rejected",
      sourceApprovalId: null,
    });
    return updated;
  }

  async createKnowledgeRulePackCandidate(input: {
    namespace: Parameters<ControlledLearningOS["createKnowledgeRulePackCandidate"]>[0]["namespace"];
    sourceText: string;
    sourceTitle?: string;
    sourceType: "user-provided-article" | "ai-export" | "reference-notes";
    rules: ControlledKnowledgeRule[];
    humanConfirmedRights: boolean;
    sourceTenantId?: string;
    sourceUserId?: string;
    sourceProjectId?: string;
    sourceStoryId?: string;
    sourceCanonId?: string;
    sourceBranchId?: string;
    sourceCharacterId?: string;
  }) {
    const transformation = await this.learning.createKnowledgeRulePackCandidate(input);
    const ledgerId = this.learningLedgerId(
      transformation.candidate.projectId,
      transformation.candidate.id,
    );
    const block = await this.ledger.append({
      ledgerId,
      namespace: transformation.candidate.namespace,
      eventType: "learning-candidate",
      payload: {
        candidateId: transformation.candidate.id,
        candidateType: transformation.candidate.candidateType,
        sourceDigest: transformation.sourceDigest,
        transformationDigest: transformation.transformationDigest,
        proposalDigest: transformation.candidate.proposalDigest,
        ruleCount: transformation.ruleCount,
        sourceContentStored: false,
        verbatimCopyStored: false,
        copyingRiskCheck: transformation.copyingRiskCheck,
      },
    });
    return {
      ...transformation,
      ledgerId,
      ledgerHeadHash: block.blockHash,
    };
  }

  async approveLearningCandidate(input: {
    candidateId: string;
    score: number;
    blockingCodes?: string[];
    approvedBy: string;
    humanApproved: boolean;
  }) {
    if (!input.humanApproved) {
      throw osError("CONTROLLED_LEARNING_HUMAN_APPROVAL_REQUIRED");
    }
    const evaluated = await this.learning.evaluateCandidate(input.candidateId, {
      score: input.score,
      blockingCodes: input.blockingCodes,
      evidence: {
        evaluator: "closed-agent-os",
        evaluationScore: input.score,
      },
    });
    if (
      !evaluated.evaluation
      || evaluated.evaluation.score < 0.6
      || evaluated.evaluation.blockingCodes.length
    ) {
      throw osError("CONTROLLED_LEARNING_EVALUATION_GATE_FAILED");
    }
    const approvalId = `controlled-learning-approval:${crypto.randomUUID()}`;
    const ledgerId = this.learningLedgerId(evaluated.projectId, evaluated.id);
    const approvalBlock = await this.ledger.append({
      ledgerId,
      namespace: evaluated.namespace,
      eventType: "approval-signed",
      payload: {
        candidateId: evaluated.id,
        proposalDigest: evaluated.proposalDigest,
        evaluationEvidenceDigest: evaluated.evaluation?.evidenceDigest ?? null,
        evaluationScore: evaluated.evaluation?.score ?? null,
        blockingCodes: evaluated.evaluation?.blockingCodes ?? [],
        approvalId,
        approvedBy: input.approvedBy,
        humanApproved: true,
      },
      signApproval: true,
    });
    const approved = await this.learning.approveCandidate(evaluated.id, {
      approvedBy: input.approvedBy,
      approvalId,
      approvalTransactionId: approvalBlock.id,
      approvalTransactionDigest: approvalBlock.blockHash,
      humanApproved: true,
    });
    const dataset = await this.learning.createDataset(approved.id, true);
    const block = await this.ledger.append({
      ledgerId,
      namespace: approved.namespace,
      eventType: "learning-candidate",
      payload: {
        candidateId: approved.id,
        proposalDigest: approved.proposalDigest,
        evaluationScore: approved.evaluation?.score ?? null,
        blockingCodes: approved.evaluation?.blockingCodes ?? [],
        approvalId,
        approvalTransactionDigest: approvalBlock.blockHash,
        approvedBy: input.approvedBy,
        humanApproved: true,
        datasetId: dataset.id,
        datasetDigest: dataset.contentDigest,
        rawContentStored: false,
      },
    });
    return {
      candidate: approved,
      dataset,
      approvalId,
      ledgerId,
      ledgerHeadHash: block.blockHash,
    };
  }

  startLearningABTest(
    input: Parameters<ControlledLearningOS["startABTest"]>[0],
  ) {
    return this.learning.startABTest(input);
  }

  recordLearningABSample(
    testId: string,
    baselineScore: number,
    candidateScore: number,
  ) {
    return this.learning.recordABSample(testId, baselineScore, candidateScore);
  }

  async adoptLearningCandidate(candidateId: string, testId: string) {
    const version = await this.learning.adoptCandidate(candidateId, testId);
    const ledgerId = this.learningLedgerId(version.projectId, version.candidateId);
    const block = await this.ledger.append({
      ledgerId,
      namespace: version.namespace,
      eventType: "learning-adopted",
      payload: {
        candidateId: version.candidateId,
        versionId: version.id,
        version: version.version,
        configurationDigest: version.configurationDigest,
        parentVersionId: version.parentVersionId,
      },
    });
    return {
      version,
      ledgerId,
      ledgerHeadHash: block.blockHash,
    };
  }

  async rollbackLearningVersion(versionId: string) {
    const version = await this.learning.repository.get<ControlledLearningVersion>(versionId);
    if (!version) throw osError("CONTROLLED_LEARNING_VERSION_NOT_FOUND");
    const ledgerId = this.learningLedgerId(version.projectId, version.candidateId);
    const ledgerBlocks = await this.ledger.repository.list(ledgerId);
    const adoptedBlock = [...ledgerBlocks]
      .reverse()
      .find((candidate) => candidate.eventType === "learning-adopted");
    if (!adoptedBlock) throw osError("CONTROLLED_LEARNING_ADOPTION_LEDGER_NOT_FOUND");
    const restored = await this.learning.rollbackVersion(versionId);
    const block = await this.ledger.append({
      ledgerId,
      namespace: version.namespace,
      eventType: "rollback",
      payload: {
        versionId,
        candidateId: version.candidateId,
        restoredVersionId: restored?.id ?? null,
        resultingStatus: "rolled_back",
      },
      lineage: {
        rollbackTargetBlockId: adoptedBlock.id,
        causationId: versionId,
      },
    });
    return {
      rolledBackVersionId: versionId,
      restored,
      ledgerId,
      ledgerHeadHash: block.blockHash,
    };
  }

  async dashboard(
    projectId: string,
    knownBackends?: ClosedAIBackendSnapshot[],
  ) {
    const [backends, cache, learning, tasks, candidates, approvals, memories] = await Promise.all([
      knownBackends
        ? Promise.resolve(structuredClone(knownBackends))
        : this.backendSnapshots(),
      this.cache.stats(),
      this.learning.dashboard(projectId),
      this.state.list<ClosedAgentTaskRecord>(projectId, "task"),
      this.state.list<ClosedAgentCandidate>(projectId, "candidate"),
      this.state.list<ClosedAgentApprovalRecord>(projectId, "approval"),
      this.state.list<ClosedAgentMemoryRecord>(projectId, "memory"),
    ]);
    const generationVerifiedBackends = backends.filter(
      hasVerifiedClosedAIGeneration,
    );
    return {
      schemaVersion: CLOSED_AGENT_OS_SCHEMA_VERSION,
      status: generationVerifiedBackends.length > 0
        ? "ready" as const
        : "setup_required" as const,
      oneSharedSystem: true,
      backends,
      readyBackends: generationVerifiedBackends.length,
      generationVerifiedBackends: generationVerifiedBackends.length,
      externalFallback: false,
      cache,
      learning,
      queue: {
        queued: tasks.filter((task) => task.state === "queued").length,
        running: tasks.filter((task) => task.state === "running").length,
        awaitingApproval: tasks.filter((task) => task.state === "awaiting-approval").length,
      },
      candidates: candidates.length,
      approvals: approvals.length,
      approvedMemoryRecords: memories.length,
      canonicalMutationRequiresCallback: true,
      silentFallback: false,
      rawChainOfThoughtStored: false,
    };
  }

  private async executeQualityPipeline(input: {
    backend: ClosedAIBackendAdapter;
    routedBackend: ClosedAIBackendSnapshot;
    request: ClosedAgentTaskRequest;
    plan: ClosedAgentPlan;
    actorContext: ClosedAgentTaskRequest["context"];
    toolResults: Array<{ toolId: string; value: unknown }>;
  }): Promise<ClosedBackendExecutionResult> {
    const {
      backend,
      routedBackend,
      request,
      plan,
      actorContext,
      toolResults,
    } = input;
    const passResults: ClosedBackendExecutionResult[] = [];
    const ranges: Record<
      ClosedAIQualityPhase,
      { start: number; end: number; phase: ClosedAIProgressPhase; label: string }
    > = plan.qualityMode === "deep"
      ? {
        draft: { start: 50, end: 61, phase: "generating", label: "第一階段：建立完整草稿" },
        critic: { start: 62, end: 71, phase: "critiquing", label: "第二階段：反方檢查缺漏與矛盾" },
        revision: { start: 72, end: 82, phase: "revising", label: "第三階段：依檢查結果完成修訂" },
      }
      : plan.qualityMode === "balanced"
        ? {
          draft: { start: 50, end: 65, phase: "generating", label: "第一階段：建立完整草稿" },
          critic: { start: 65, end: 65, phase: "critiquing", label: "品質檢查" },
          revision: { start: 66, end: 82, phase: "revising", label: "第二階段：自我檢查並修訂" },
        }
        : {
          draft: { start: 50, end: 82, phase: "generating", label: "快速模式：建立候選" },
          critic: { start: 82, end: 82, phase: "critiquing", label: "品質檢查" },
          revision: { start: 82, end: 82, phase: "revising", label: "完成候選" },
        };

    const runPass = async (
      qualityPhase: ClosedAIQualityPhase,
      workingMaterials: ClosedAIWorkingMaterial[],
    ) => {
      if (request.signal?.aborted) throw osError("CLOSED_AGENT_TASK_CANCELLED");
      const range = ranges[qualityPhase];
      this.emitProgress(
        request,
        range.phase,
        range.label,
        range.start,
        { backendId: plan.backendId },
      );
      const passDigest = await sha256Hex(
        `${request.taskId}|${qualityPhase}|${passResults.length}`,
      );
      const passRequest: ClosedAgentTaskRequest = {
        ...request,
        taskId: `quality:${qualityPhase}:${passDigest.slice(0, 32)}`,
        onProgress: (event) => {
          const ratio = Math.max(0, Math.min(1, event.percent / 100));
          try {
            request.onProgress?.({
              ...event,
              taskId: request.taskId,
              phase: range.phase,
              label: `${range.label}｜${event.label}`,
              percent: Math.round(range.start + (range.end - range.start) * ratio),
            });
          } catch {
            // The quality transaction is not controlled by UI observers.
          }
        },
      };
      const result = await backend.execute({
        request: passRequest,
        plan,
        actorContext,
        toolResults,
        qualityPhase,
        workingMaterials,
      });
      if (request.signal?.aborted) {
        throw osError("CLOSED_AGENT_TASK_CANCELLED");
      }
      if (result.backendId !== routedBackend.id) {
        throw osError("CLOSED_AI_BACKEND_IDENTITY_MISMATCH", undefined, {
          selected: routedBackend.id,
          actual: result.backendId,
        });
      }
      assertClosedAIModelIdentity(routedBackend, result);
      if (!result.content.trim()) {
        throw osError("CLOSED_AGENT_QUALITY_PASS_EMPTY", undefined, {
          qualityPhase,
        });
      }
      const first = passResults[0];
      if (
        first
        && (
          result.backendId !== first.backendId
          || result.modelId !== first.modelId
          || result.modelDigest !== first.modelDigest
        )
      ) {
        throw osError("CLOSED_AI_QUALITY_IDENTITY_CHANGED", undefined, {
          qualityPhase,
        });
      }
      passResults.push(result);
      return result;
    };

    const draft = await runPass("draft", []);
    let critic: ClosedBackendExecutionResult | null = null;
    let final = draft;
    let draftDigest: string | null = null;
    let criticDigest: string | null = null;
    if (plan.qualityMode !== "fast") {
      draftDigest = await sha256Hex(draft.content);
      const draftMaterial: ClosedAIWorkingMaterial = {
        kind: "draft",
        text: draft.content,
        digest: draftDigest,
      };
      if (plan.qualityMode === "deep") {
        critic = await runPass("critic", [draftMaterial]);
        criticDigest = await sha256Hex(critic.content);
      }
      final = await runPass(
        "revision",
        critic
          ? [
            draftMaterial,
            {
              kind: "critic",
              text: critic.content,
              digest: criticDigest!,
            },
          ]
          : [draftMaterial],
      );
    }
    let selected = final;
    let selectedContent = final.content.trim();
    if (request.taskType === "chapter.abcChoices") {
      const structured = [final, draft]
        .map((result) => ({
          result,
          normalized: normalizeAbcChoicesExecutionContent(result.content),
        }))
        .find((item) => item.normalized.valid);
      if (!structured || !structured.normalized.valid) {
        const finalStructure = normalizeAbcChoicesCandidate(final.content);
        throw osError("ABC_CHOICES_INVALID_STRUCTURE", undefined, {
          extractedItemCount: finalStructure.extractedItemCount,
          materiallyDistinct: finalStructure.materiallyDistinct,
        });
      }
      selected = structured.result;
      selectedContent = structured.normalized.content;
    }
    return {
      ...selected,
      adapterId: selected.adapterId ?? draft.adapterId ?? null,
      adapterDigest: selected.adapterDigest ?? draft.adapterDigest ?? null,
      content: selectedContent,
      elapsedMs: passResults.reduce((sum, item) => sum + item.elapsedMs, 0),
      profileId: `${selected.profileId ?? `${selected.backendId}-default-v1`}:quality-${plan.qualityMode}-v1`,
      firstTokenMs: passResults[0]?.firstTokenMs ?? null,
      inputCharacters: passResults.reduce(
        (sum, item) => sum + (item.inputCharacters ?? 0),
        0,
      ),
      outputCharacters: passResults.reduce(
        (sum, item) => sum + (item.outputCharacters ?? item.content.length),
        0,
      ),
      generatedTokenEvents: passResults.reduce(
        (sum, item) => sum + (item.generatedTokenEvents ?? 0),
        0,
      ),
      omittedInputCharacters: passResults.reduce(
        (sum, item) => sum + (item.omittedInputCharacters ?? 0),
        0,
      ),
      dataLeftDevice: passResults.some((item) => item.dataLeftDevice),
      externalRequest: passResults.some((item) => item.externalRequest),
      qualityMode: plan.qualityMode,
      qualityPasses: passResults.length,
      draftDigest,
      criticDigest,
    };
  }

  private emitProgress(
    request: ClosedAgentTaskRequest,
    phase: ClosedAIProgressPhase,
    label: string,
    percent: number,
    detail: Partial<Pick<
      ClosedAIProgressEvent,
      "backendId" | "generatedCharacters" | "cacheHit"
    >> = {},
  ) {
    try {
      request.onProgress?.({
        taskId: request.taskId,
        phase,
        label,
        percent: Math.max(0, Math.min(100, Math.round(percent))),
        occurredAt: this.now().toISOString(),
        ...detail,
      });
    } catch {
      // Progress observers are non-authoritative and cannot fail the transaction.
    }
  }

  async invalidateCache(invalidation: ClosedAICacheInvalidation) {
    const browserEntries = await this.cache.invalidate(invalidation);
    const backendEntries: Partial<Record<ClosedAIBackendAdapter["id"], number>> = {};
    const unavailableBackends: ClosedAIBackendAdapter["id"][] = [];
    await Promise.all([...this.backends.values()].map(async (backend) => {
      if (!backend.invalidateCache) return;
      try {
        backendEntries[backend.id] = await backend.invalidateCache(invalidation);
      } catch {
        unavailableBackends.push(backend.id);
      }
    }));
    return {
      targeted: true as const,
      browserEntries,
      backendEntries,
      unavailableBackends,
      totalInvalidated: browserEntries
        + Object.values(backendEntries).reduce((sum, count) => sum + (count ?? 0), 0),
      staleReuseBlockedByNamespace: true as const,
      canonicalMutationCount: 0 as const,
    };
  }

  private async executeTools(request: ClosedAgentTaskRequest, plan: ClosedAgentPlan) {
    const results: Array<{ toolId: string; value: unknown }> = [];
    const executions: ClosedAgentToolExecutionEvidence[] = [];
    const preferredTool = learningPreferredTool(request.learningConfiguration);
    const toolIds = [...request.allowedToolIds].sort((left, right) =>
      Number(right === preferredTool) - Number(left === preferredTool)
      || left.localeCompare(right));
    for (const toolId of toolIds) {
      const tool = this.tools.get(toolId);
      if (!tool) throw osError("CLOSED_AGENT_TOOL_NOT_REGISTERED", undefined, { toolId });
      const role = plan.steps.find((step) => step.allowedToolIds.includes(toolId))?.role ?? "planner";
      assertClosedAgentPermission({ request, role, tool });
      try {
        const toolTaskId = `${request.taskId}:tool:${toolId}`;
        const approvedContext = request.context.filter((item) =>
          item.approved
          && item.visibility !== "author-only"
          && item.visibility !== "evaluator"
          && item.privacyLevel === request.namespace.privacyLevel);
        const objectiveDigest = await sha256Hex(request.objective);
        const contextDigest = await sha256Hex(stableStringify(
          await Promise.all(approvedContext.map(async (item) => ({
            id: item.id,
            kind: item.kind,
            visibility: item.visibility,
            privacyLevel: item.privacyLevel,
            textDigest: await sha256Hex(item.text),
          }))),
        ));
        const inputDigest = await sha256Hex(stableStringify({
          taskId: toolTaskId,
          parentTaskId: request.taskId,
          taskType: request.taskType,
          toolId,
          objectiveDigest,
          contextDigest,
        }));
        const startedAt = this.now().toISOString();
        const cacheResult = await this.cache.compute(
          "tool-result",
          request.namespace,
          {
            toolId,
            taskId: request.taskId,
            objectiveDigest,
            learningConfiguration: request.learningConfiguration ?? {},
          },
          () => tool.execute({
            namespace: request.namespace,
            taskId: request.taskId,
            taskType: request.taskType,
            objective: request.objective,
            approvedContext,
            payload: { taskType: request.taskType },
            signal: request.signal,
          }),
          {
            tags: ["closed-agent-tool", `tool:${toolId}`],
            ttlMs: learningCacheTtl(request.learningConfiguration, "tool-result"),
          },
        );
        const completedAt = this.now().toISOString();
        const outputDigest = await sha256Hex(stableStringify(cacheResult.value));
        const receiptDigest = await sha256Hex(stableStringify({
          taskId: toolTaskId,
          parentTaskId: request.taskId,
          toolId,
          inputDigest,
          contextDigest,
          outputDigest,
          startedAt,
          completedAt,
          cacheHit: cacheResult.cacheHit,
        }));
        results.push({ toolId, value: cacheResult.value });
        executions.push({
          schemaVersion: "closed-agent-tool-execution-v1",
          receiptId: `closed-agent-tool-receipt:${receiptDigest}`,
          taskId: toolTaskId,
          parentTaskId: request.taskId,
          taskType: request.taskType,
          toolId,
          role,
          status: "completed",
          inputDigest,
          contextDigest,
          outputDigest,
          startedAt,
          completedAt,
          latencyMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
          actualExecutor: cacheResult.cacheHit
            ? "closed-agent-os:tool-cache"
            : "closed-agent-os:tool-registry",
          cacheHit: cacheResult.cacheHit,
          externalRequest: false,
          dataLeftDevice: false,
          canonicalMutationCount: 0,
          rawInputStored: false,
          rawOutputStored: false,
        });
        await this.recordOperationalLearningSignal({
          request,
          outcome: "tool_result",
          score: 1,
          tags: [
            "tool-success",
            `tool:${toolId}`,
            cacheResult.cacheHit ? "tool-cache-hit" : "tool-cache-miss",
          ],
          feature: {
            toolId,
            role,
            resultDigest: outputDigest,
          },
        });
      } catch (cause) {
        await this.recordOperationalLearningSignal({
          request,
          outcome: "tool_result",
          score: 0,
          tags: [
            "tool-failure",
            `tool:${toolId}`,
            `error:${String((cause as { code?: string })?.code || "UNKNOWN")}`,
          ],
          feature: { toolId, role, success: false },
        });
        throw cause;
      }
    }
    return { toolResults: results, toolExecutions: executions };
  }

  private async recordOperationalLearningSignal(input: {
    request: ClosedAgentTaskRequest;
    outcome:
      | "planner_result"
      | "tool_result"
      | "character_consistency_result"
      | "plot_continuity_result";
    score: number;
    tags: string[];
    feature: Record<string, string | number | boolean>;
  }) {
    const collection = await this.learning.collectExperienceIfConsented({
      namespace: input.request.namespace,
      outcome: input.outcome,
      taskType: input.request.taskType,
      featureText: stableStringify(input.feature),
      score: input.score,
      tags: input.tags,
      sourceApprovalId: null,
    });
    if (!collection.collected) return collection;
    try {
      await this.ledger.append({
        ledgerId: this.ledgerId(input.request),
        namespace: input.request.namespace,
        eventType: "learning-experience",
        payload: {
          experienceId: collection.experience.id,
          outcome: collection.experience.outcome,
          outcomeLabel: collection.experience.outcomeLabel,
          sourceClass: collection.experience.sourceClass,
          featureDigest: collection.experience.featureDigest,
          resultDigest: collection.experience.resultDigest,
          score: collection.experience.score,
          rawInputStored: false,
          rawOutputStored: false,
          rawChainOfThoughtStored: false,
        },
      });
    } catch {
      // Learning evidence must never make an otherwise valid task fail.
    }
    return collection;
  }

  private async recordLearningOutcome(input: {
    candidate: ClosedAgentCandidate;
    outcome: ControlledLearningOutcome;
    sourceApprovalId: string | null;
  }) {
    const task = await this.state.get<ClosedAgentTaskRecord>(input.candidate.taskId);
    const collection = await this.learning.collectExperienceIfConsented({
      namespace: input.candidate.namespace,
      outcome: input.outcome,
      taskType: task?.taskType ?? "learning.preferenceReview",
      featureText: stableStringify({
        taskType: task?.taskType ?? "learning.preferenceReview",
        backendId: input.candidate.backendId,
        planDigest: input.candidate.planDigest,
      }),
      resultText: input.candidate.content,
      score: input.candidate.evaluation.score,
      tags: [
        `backend:${input.candidate.backendId}`,
        `task:${task?.taskType ?? "learning.preferenceReview"}`,
        `outcome:${input.outcome}`,
      ],
      sourceApprovalId: input.sourceApprovalId,
    });
    if (!collection.collected) {
      return {
        ...collection,
        ledgerRecorded: false,
        ledgerErrorCode: null,
      };
    }
    try {
      await this.ledger.append({
        ledgerId: `closed-agent:${input.candidate.projectId}:${input.candidate.taskId}`,
        namespace: input.candidate.namespace,
        eventType: "learning-experience",
        payload: {
          experienceId: collection.experience.id,
          outcome: collection.experience.outcome,
          outcomeLabel: collection.experience.outcomeLabel,
          featureDigest: collection.experience.featureDigest,
          resultDigest: collection.experience.resultDigest,
          sourceApprovalId: collection.experience.sourceApprovalId,
          rawInputStored: false,
          rawOutputStored: false,
          rawChainOfThoughtStored: false,
        },
      });
      return {
        ...collection,
        ledgerRecorded: true,
        ledgerErrorCode: null,
      };
    } catch {
      return {
        ...collection,
        ledgerRecorded: false,
        ledgerErrorCode: "CONTROLLED_LEARNING_LEDGER_APPEND_FAILED",
      };
    }
  }

  private ledgerId(request: ClosedAgentTaskRequest) {
    return `closed-agent:${request.namespace.projectId}:${request.taskId}`;
  }

  private learningLedgerId(projectId: string, candidateId: string) {
    return `closed-learning:${projectId}:${candidateId}`;
  }

  private async verifyLearningApprovalTransaction(
    input: ControlledLearningApprovalVerificationInput,
  ) {
    const ledgerId = this.learningLedgerId(
      input.candidate.projectId,
      input.candidate.id,
    );
    const blocks = await this.ledger.repository.list(ledgerId);
    const transaction = blocks.find((block) =>
      block.id === input.approvalTransactionId
      && block.blockHash === input.approvalTransactionDigest);
    if (
      !transaction
      || transaction.ledgerId !== ledgerId
      || transaction.eventType !== "approval-signed"
      || !transaction.signature
      || !sameClosedAINamespace(
        transaction.namespace,
        input.candidate.namespace,
      )
    ) {
      return false;
    }
    const expectedPayloadDigest = await sha256Hex(stableStringify({
      candidateId: input.candidate.id,
      proposalDigest: input.candidate.proposalDigest,
      evaluationEvidenceDigest:
        input.candidate.evaluation?.evidenceDigest ?? null,
      evaluationScore: input.candidate.evaluation?.score ?? null,
      blockingCodes: input.candidate.evaluation?.blockingCodes ?? [],
      approvalId: input.approvalId,
      approvedBy: input.approvedBy,
      humanApproved: true,
    }));
    if (transaction.payloadDigest !== expectedPayloadDigest) return false;
    const verification = await this.ledger.verify(ledgerId);
    return verification.valid && verification.signedApprovalCount >= 1;
  }

  private planCacheInput(
    request: ClosedAgentTaskRequest,
    backendId: ClosedAIBackendAdapter["id"],
  ) {
    return {
      taskType: request.taskType,
      backendId,
      complexity: request.complexity ?? "automatic",
      objectiveDigest: request.objective,
      qualityMode: request.qualityMode ?? "automatic",
      allowedToolIds: [...request.allowedToolIds].sort(),
      permissionScopes: [...request.permissionScopes].sort(),
      learningConfiguration: Object.fromEntries(
        Object.entries(request.learningConfiguration ?? {})
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    };
  }
}

export const CLOSED_AGENT_OS_HEALTH = {
  schemaVersion: CLOSED_AGENT_OS_SCHEMA_VERSION,
  status: "ready",
  oneSharedSystemStatus: "ready",
  threeBackendCoexistenceStatus: "ready",
  browserAIAdapterStatus: "ready_runtime_dependent",
  localOllamaAdapterStatus: "ready_runtime_dependent",
  privateAIHubAdapterStatus: "ready_runtime_dependent",
  routerStatus: "ready",
  plannerStatus: "ready",
  multiPassQualityPipelineStatus: "ready",
  transientCriticRevisionStatus: "ready",
  toolRegistryStatus: "ready",
  studioAcceptanceToolStatus: "ready",
  studioContextIndexToolStatus: "ready",
  permissionGatewayStatus: "ready",
  taskQueueStatus: "ready",
  storyMemoryStatus: "ready",
  evaluatorStatus: "ready",
  approvalTransactionStatus: "ready",
  cacheIntegrationStatus: "ready",
  controlledLearningIntegrationStatus: "ready",
  controlledLearningOutcomeCaptureStatus: "ready",
  adoptedLearningConfigurationStatus: "ready",
  knowledgeRulePackWorkflowStatus: "ready",
  learningDataLineageStatus: "ready",
  verifiableLedgerIntegrationStatus: "ready",
  noSilentFallbackStatus: "ready",
  agentDirectShellAccess: false,
  agentDirectDatabaseAccess: false,
  agentDirectFilesystemAccess: false,
  agentDirectNetworkAccess: false,
  rawChainOfThoughtStored: false,
} as const;

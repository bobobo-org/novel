import {
  ClosedAICache,
  assertClosedAINamespace,
  closedAINamespaceDigest,
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
  type ControlledLearningActiveConfiguration,
  type ControlledLearningApprovalVerificationInput,
  type ControlledKnowledgeRule,
  type ControlledLearningOutcome,
  type ControlledLearningVersion,
} from "../controlled-learning-os";
import {
  VerifiableLedger,
  createVerifiableLedgerRepository,
  type VerifiableLedgerBlock,
  type VerifiableLedgerEventType,
} from "../verifiable-ledger";
import { createDefaultClosedAIBackends } from "./backends";
import { BROWSER_T1_TASKS } from "../providers/browser-ai/browser-task-eligibility";
import { BROWSER_TASK_MODEL } from "../providers/browser-ai/browser-task-model";
import type {
  TraditionalChineseNormalizationPolicy,
} from "../language/traditional-chinese";
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
  type ClosedAgentCacheOriginEvidence,
  type ClosedAgentVerifiedExecutionReceipt,
  type ClosedAIWorkingMaterial,
  type ClosedAgentApprovalRecord,
  type ClosedAgentCandidate,
  type ClosedAgentExecutionResult,
  type ClosedAgentMemoryRecord,
  type ClosedAgentPlan,
  type ClosedAgentPlanningBinding,
  type ClosedAgentRejectionRecord,
  type ClosedAgentTaskRecord,
  type ClosedAgentTaskRequest,
  type ClosedAgentToolExecutionEvidence,
  type ClosedBackendExecutionResult,
  type ClosedBackendRawExecutionResult,
} from "./types";
import {
  closedAgentBrowserRuntimeEvidenceProgress,
  isClosedAgentFailureDiagnosticCode,
} from "./safe-runtime-diagnostics";
import {
  closedOutputSafetyCode,
  closedOutputSafetyReasonCode,
} from "../security/closed-output-safety";
import {
  BROWSER_CONTEXT_ATTESTATION_POLICY_VERSION,
  BROWSER_FINAL_MODEL_CONTEXT_ATTESTATION_VERSION,
  verifyBrowserFinalModelContextAttestation,
} from "../security/browser-final-model-context-proof";

type ClosedAgentOSOptions = {
  backends?: ClosedAIBackendAdapter[];
  cache?: ClosedAICache;
  learning?: ControlledLearningOS;
  ledger?: VerifiableLedger;
  state?: ClosedAgentStateRepository;
  tools?: ClosedAgentToolRegistry;
  now?: () => Date;
};

function loadTraditionalChineseRuntime() {
  return import("../language/traditional-chinese");
}

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

async function appendOrReuseExactLedgerPayload(input: {
  ledger: VerifiableLedger;
  ledgerId: string;
  namespace: ClosedAINamespace;
  eventType: VerifiableLedgerEventType;
  payload: unknown;
  result?: unknown;
  retainContent?: boolean;
}): Promise<VerifiableLedgerBlock> {
  const [namespaceDigest, payloadDigest, blocks] = await Promise.all([
    closedAINamespaceDigest(input.namespace),
    sha256Hex(stableStringify(input.payload)),
    input.ledger.repository.list(input.ledgerId),
  ]);
  const exact = blocks.filter((block) => (
    block.eventType === input.eventType
    && block.namespaceDigest === namespaceDigest
    && block.payloadDigest === payloadDigest
  ));
  if (exact.length > 1) {
    throw osError("CLOSED_AGENT_LEDGER_DUPLICATE_EXACT_EVENT");
  }
  const existing = exact[0];
  if (existing) {
    if (input.retainContent && (!existing.contentAddress || !existing.contentRecordId)) {
      throw osError("CLOSED_AGENT_LEDGER_RETAINED_CONTENT_MISSING");
    }
    return existing;
  }
  return input.ledger.append({
    ledgerId: input.ledgerId,
    namespace: input.namespace,
    eventType: input.eventType,
    payload: input.payload,
    result: input.result,
    retainContent: input.retainContent,
  });
}

function immutableGeneratedCandidateSnapshot(candidate: ClosedAgentCandidate) {
  return {
    ...candidate,
    status: "awaiting-approval" as const,
    canonicalMutationCount: 0 as const,
    updatedAt: candidate.createdAt,
  };
}

function retainedCandidateGeneratedPayload(candidate: ClosedAgentCandidate) {
  return {
    candidateSnapshot: immutableGeneratedCandidateSnapshot(candidate),
    candidateId: candidate.id,
    taskId: candidate.taskId,
    backendId: candidate.backendId,
    modelId: candidate.modelId,
    modelDigest: candidate.modelDigest,
    adapterId: candidate.adapterId ?? null,
    adapterDigest: candidate.adapterDigest ?? null,
    contentDigest: candidate.contentDigest,
    contextDigest: candidate.contextDigest,
    sourceChapterId: candidate.sourceChapterId,
    sourceRevision: candidate.sourceRevision,
    executionReceipt: candidate.executionReceipt,
    cacheOrigin: candidate.cacheOrigin,
    traditionalChineseNormalization:
      candidate.traditionalChineseNormalization,
    candidateOnly: candidate.candidateOnly,
    externalRequest: candidate.externalRequest,
    dataLeftDevice: candidate.dataLeftDevice,
    qualityMode: candidate.generationTelemetry!.qualityMode,
    qualityPasses: candidate.generationTelemetry!.qualityPasses,
    draftDigest: candidate.generationTelemetry!.draftDigest,
    criticDigest: candidate.generationTelemetry!.criticDigest,
  };
}

function retainedCandidateEvaluatedPayload(candidate: ClosedAgentCandidate) {
  return {
    candidateId: candidate.id,
    taskId: candidate.taskId,
    normalizationReceiptId:
      candidate.traditionalChineseNormalization.receiptId,
    passed: candidate.evaluation.passed,
    score: candidate.evaluation.score,
    blockingCodes: candidate.evaluation.blockingCodes,
    warningCodes: candidate.evaluation.warningCodes,
    evaluatorInputDigest: candidate.evaluation.evaluatorInputDigest,
  };
}

type ClosedAgentCachedExecutionArtifact = {
  schemaVersion: "closed-agent-cached-execution-v1";
  execution: ClosedBackendExecutionResult;
  originCandidateId: string;
  originTaskId: string;
  originLedgerId: string;
  originLedgerBlockHash: string;
  originExecutionReceipt: ClosedAgentVerifiedExecutionReceipt;
};

function osError(code: string, message = code, details: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

/**
 * Makes an abort authoritative at an injected/remote leaf boundary even when
 * that leaf ignores AbortSignal. The late promise remains observed, but its
 * value can no longer re-enter normalization, evaluation, cache, ledger, or
 * candidate persistence after this wrapper has rejected.
 */
function settleClosedAgentLeafOnAbort<T>(
  signal: AbortSignal | undefined,
  operation: () => T | PromiseLike<T>,
): Promise<T> {
  if (!signal) return Promise.resolve(operation());
  if (signal.aborted) {
    return Promise.reject(osError("CLOSED_AGENT_TASK_CANCELLED"));
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => {
      reject(osError("CLOSED_AGENT_TASK_CANCELLED"));
    });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }

    let pending: Promise<T>;
    try {
      pending = Promise.resolve(operation());
    } catch (error) {
      finish(() => reject(error));
      return;
    }
    pending.then(
      (value) => {
        if (settled) return;
        finish(() => resolve(value));
      },
      (error) => {
        if (settled) return;
        finish(() => reject(error));
      },
    );
  });
}

const CLOSED_AGENT_DECISION_FALLBACK_LOCKS = new Map<string, Promise<void>>();
const CLOSED_AGENT_REJECTION_RECORD_KEYS = [
  "cacheCausationId",
  "cacheEntryIds",
  "cacheLedgerBlockHash",
  "cachePlanDigest",
  "candidateContentDigest",
  "candidateId",
  "claimId",
  "canonicalMutationCount",
  "completedAt",
  "id",
  "kind",
  "learningCausationId",
  "learningLedgerBlockHash",
  "learningResult",
  "namespace",
  "namespaceDigest",
  "projectId",
  "rawChainOfThoughtStored",
  "rawOutputStored",
  "rawPromptStored",
  "requestContractDigest",
  "schemaVersion",
  "startedAt",
  "status",
  "taskId",
  "taskType",
] as const;

type NavigatorWithDecisionLocks = Navigator & {
  locks?: {
    request<T>(
      name: string,
      options: { mode: "exclusive" },
      callback: () => Promise<T>,
    ): Promise<T>;
  };
};

async function withClosedAgentCandidateDecisionLock<T>(
  candidateId: string,
  run: () => Promise<T>,
): Promise<T> {
  const name = `closed-agent-decision:${await sha256Hex(candidateId)}`;
  if (typeof navigator !== "undefined") {
    const locks = (navigator as NavigatorWithDecisionLocks).locks;
    if (locks?.request) {
      return locks.request(name, { mode: "exclusive" }, run);
    }
    if (typeof window !== "undefined") {
      throw osError(
        "CLOSED_AGENT_CROSS_CONTEXT_LOCK_UNAVAILABLE",
        "This browser cannot safely serialize an approval decision across tabs.",
      );
    }
  }
  const previous = CLOSED_AGENT_DECISION_FALLBACK_LOCKS.get(name)
    ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  CLOSED_AGENT_DECISION_FALLBACK_LOCKS.set(name, tail);
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (CLOSED_AGENT_DECISION_FALLBACK_LOCKS.get(name) === tail) {
      CLOSED_AGENT_DECISION_FALLBACK_LOCKS.delete(name);
    }
  }
}

const CLOSED_BROWSER_EXECUTION_RECEIPT_KEYS = [
  "actualExecutor",
  "backendId",
  "browserComputeReceiptId",
  "browserFabricPlannedGraph",
  "browserFabricReceiptId",
  "completedAt",
  "contentDigest",
  "contextAttestation",
  "contextDigest",
  "contextTokensAfter",
  "contextTokensBefore",
  "dataLeftDevice",
  "externalRequest",
  "finalModelContextAttestation",
  "generatedTokenEvents",
  "modelDigest",
  "modelId",
  "outputCharacters",
  "proofState",
  "startedAt",
  "taskId",
  "tokensSaved",
  "traditionalChineseNormalization",
] as const;

function hasExactClosedBrowserExecutionReceiptShape(
  receipt: ClosedAgentVerifiedExecutionReceipt,
  allowLegacyMissingBrowserAttestation: boolean,
) {
  if (receipt.backendId !== "browser-ai") return true;
  if (receipt.contextAttestation === undefined) {
    return allowLegacyMissingBrowserAttestation;
  }
  return Object.keys(receipt).sort().join(",")
    === [...CLOSED_BROWSER_EXECUTION_RECEIPT_KEYS].sort().join(",");
}

async function hasVerifiedBrowserModelContextAttestation(input: {
  backendId: ClosedAIBackendId;
  modelId: string;
  modelDigest: string;
  contextAttestation: ClosedBackendRawExecutionResult["contextAttestation"];
  attestation: ClosedBackendRawExecutionResult["finalModelContextAttestation"];
  allowLegacyMissingBrowserAttestation?: boolean;
}) {
  if (input.backendId !== "browser-ai") {
    return input.contextAttestation === undefined
      && input.attestation === undefined;
  }
  if (input.contextAttestation === "not_required") {
    return input.attestation === undefined;
  }
  if (input.contextAttestation !== "required") {
    return input.allowLegacyMissingBrowserAttestation === true
      && input.attestation === undefined;
  }
  if (!input.attestation) return false;
  return await verifyBrowserFinalModelContextAttestation(input.attestation)
    && input.attestation.contributingCalls.every((call) => (
      call.modelId === input.modelId
      && call.modelDigest === input.modelDigest
    ));
}

function closedBrowserTaskExecutionSnapshot(
  snapshot: ClosedAIBackendSnapshot,
  taskType: ClosedAgentTaskRequest["taskType"],
) {
  if (snapshot.id !== "browser-ai" || !BROWSER_T1_TASKS.has(taskType)) {
    return snapshot;
  }
  return {
    ...snapshot,
    modelId: BROWSER_TASK_MODEL.modelId,
    modelDigest: BROWSER_TASK_MODEL.modelDigest,
    runtimeTruth: {
      ...snapshot.runtimeTruth,
      generationVerified: false,
      verificationSource: "none" as const,
      verifiedAt: null,
    },
    detailCode: "packaged_browser_task_model_pinned",
  } satisfies ClosedAIBackendSnapshot;
}

function safeClosedAgentTaskErrorCode(cause: unknown) {
  const coded = (cause as { code?: unknown } | null)?.code;
  const message = cause instanceof Error ? cause.message.trim() : "";
  const code = [coded, message].find((value) => (
    typeof value === "string"
    && /^(?:(?:CLOSED_AGENT|CLOSED_AI|BROWSER_AI|BROWSER_WEBLLM|BROWSER_GPU|OLLAMA)_[A-Z0-9_]{1,80}|RPG_[A-Z0-9_]{1,100})$/u.test(value)
  ));
  // Only a bounded machine code may cross this diagnostics boundary. Never
  // persist a provider/validator message because it can contain story text.
  return typeof code === "string" ? code : "CLOSED_AGENT_TASK_FAILED";
}

const CLOSED_AGENT_PLANNER_STRATEGIES = new Set([
  "standard",
  "continuity-first",
  "critical-review",
  "character-depth",
]);

const IDEMPOTENT_BROWSER_TO_LOCAL_RETRY_CODES = new Set([
  "BROWSER_EXPLICIT_ESCALATION_REQUIRED",
  "BROWSER_AI_ESCALATE_LOCAL_OLLAMA",
  "BROWSER_AI_QUALITY_INSUFFICIENT",
  "BROWSER_AI_REQUIRED_GENERATIVE_EXECUTOR_UNAVAILABLE",
  "BROWSER_AI_REQUIRED_GENERATIVE_EXECUTION_FAILED",
]);

function closedAgentPlanningBindingPayload(
  binding: Omit<ClosedAgentPlanningBinding, "bindingDigest">,
) {
  return {
    schemaVersion: binding.schemaVersion,
    plannerStrategy: binding.plannerStrategy,
    controlledLearningApplied: binding.controlledLearningApplied,
    controlledLearningVersionId: binding.controlledLearningVersionId,
    controlledLearningConfigurationDigest:
      binding.controlledLearningConfigurationDigest,
    controlledLearningReasonCode: binding.controlledLearningReasonCode,
  };
}

async function createClosedAgentPlanningBinding(input: {
  plan: ClosedAgentPlan;
  learning: ControlledLearningActiveConfiguration;
}): Promise<ClosedAgentPlanningBinding> {
  const payload = closedAgentPlanningBindingPayload({
    schemaVersion: "closed-agent-planning-binding-v1",
    plannerStrategy: input.plan.plannerStrategy,
    controlledLearningApplied: input.learning.applied,
    controlledLearningVersionId: input.learning.versionId,
    controlledLearningConfigurationDigest: input.learning.configurationDigest,
    controlledLearningReasonCode: input.learning.reasonCode,
  });
  return {
    ...payload,
    bindingDigest: await sha256Hex(stableStringify(payload)),
  };
}

async function verifyClosedAgentPlanningBinding(
  binding: ClosedAgentPlanningBinding | undefined,
) {
  if (!binding) return false;
  const appliedIdentityValid = binding.controlledLearningApplied
    ? Boolean(
      binding.controlledLearningVersionId
      && isCryptographicClosedAIModelDigest(
        binding.controlledLearningConfigurationDigest,
      )
      && binding.controlledLearningReasonCode === null,
    )
    : (
      binding.controlledLearningVersionId === null
      || typeof binding.controlledLearningVersionId === "string"
        && binding.controlledLearningVersionId.length <= 192
    )
    && (
      binding.controlledLearningConfigurationDigest === null
      || isCryptographicClosedAIModelDigest(
        binding.controlledLearningConfigurationDigest,
      )
    )
    && (
      binding.controlledLearningReasonCode === null
      || /^CONTROLLED_LEARNING_[A-Z0-9_]{1,80}$/u.test(
        binding.controlledLearningReasonCode,
      )
    );
  return binding.schemaVersion === "closed-agent-planning-binding-v1"
    && CLOSED_AGENT_PLANNER_STRATEGIES.has(binding.plannerStrategy)
    && appliedIdentityValid
    && isCryptographicClosedAIModelDigest(binding.bindingDigest)
    && binding.bindingDigest === await sha256Hex(stableStringify(
      closedAgentPlanningBindingPayload(binding),
    ));
}

function planningLearningReceipt(binding: ClosedAgentPlanningBinding) {
  return {
    applied: binding.controlledLearningApplied,
    versionId: binding.controlledLearningVersionId,
    configurationDigest: binding.controlledLearningConfigurationDigest,
    reasonCode: binding.controlledLearningReasonCode,
  };
}

async function closedAgentRequestContractDigest(request: ClosedAgentTaskRequest) {
  return sha256Hex(stableStringify({
    domain: "closed-agent-request-contract-v1",
    taskId: request.taskId,
    namespace: request.namespace,
    taskType: request.taskType,
    objective: request.objective,
    context: request.context,
    complexity: request.complexity ?? null,
    qualityMode: request.qualityMode ?? null,
    browserComputePolicy: request.browserComputePolicy ?? null,
    allowPreAuthorizedClosedEscalation:
      request.allowPreAuthorizedClosedEscalation ?? false,
    preferredBackend: request.preferredBackend ?? null,
    allowedToolIds: request.allowedToolIds,
    permissionScopes: request.permissionScopes,
    learningConfiguration: request.learningConfiguration ?? null,
    contextDigest: request.contextDigest ?? null,
    contextSourceSummary: request.contextSourceSummary ?? null,
    sourceChapterId: request.sourceChapterId ?? null,
    sourceRevision: request.sourceRevision ?? null,
    generationOptions: request.generationOptions ?? null,
    ephemeralPrompt: request.ephemeralPrompt ?? false,
    applicationValidationBindingDigest:
      request.applicationValidationBindingDigest ?? null,
    regeneration: request.regeneration ?? null,
  }));
}

async function closedAgentTaskAcceptedPayload(
  request: ClosedAgentTaskRequest,
  requestContractDigest: string,
) {
  return {
    taskId: request.taskId,
    taskType: request.taskType,
    objectiveDigest: await sha256Hex(request.objective),
    requestContractDigest,
  };
}

async function closedAgentContextDigest(request: ClosedAgentTaskRequest) {
  return request.contextDigest ?? sha256Hex(stableStringify(
    request.context.map((item) => ({
      id: item.id,
      kind: item.kind,
      learningFacet: item.learningFacet ?? "general",
      visibility: item.visibility,
      privacyLevel: item.privacyLevel,
      approved: item.approved,
      text: item.text,
      composerAuthority: item.composerAuthority,
      modelContextSource: item.modelContextSource ?? null,
      canonicalIdentitySource: item.canonicalIdentitySource,
    })),
  ));
}

async function closedAgentRegenerationEvidence(
  request: ClosedAgentTaskRequest,
): Promise<ClosedAgentCandidate["regeneration"]> {
  return request.regeneration
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
      contractDigest: await sha256Hex(stableStringify({
        domain: "closed-agent-regeneration-contract-v1",
        contract: request.regeneration,
      })),
    }
    : undefined;
}

function assertClosedAIModelIdentity(
  routed: ClosedAIBackendSnapshot,
  execution: ClosedBackendRawExecutionResult,
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

async function assertClosedAgentTraditionalChineseIntegrity(input: {
  execution: ClosedBackendExecutionResult;
  policy: TraditionalChineseNormalizationPolicy;
  originRequestId?: string;
}) {
  const { verifyTraditionalChineseNormalizationIntegrity } =
    await loadTraditionalChineseRuntime();
  if (await verifyTraditionalChineseNormalizationIntegrity({
    content: input.execution.content,
    integrity: input.execution.traditionalChineseNormalization,
    policy: input.policy,
    originRequestId: input.originRequestId,
    providerId: input.execution.backendId,
    modelId: input.execution.modelId,
    modelDigest: input.execution.modelDigest,
  })) return;
  throw osError("CLOSED_AGENT_TRADITIONAL_CHINESE_INTEGRITY_INVALID", undefined, {
    canonicalMutationCount: 0,
  });
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
  const freshExecutionVerified = Boolean(
    receipt?.proofState === "verified"
    && candidate.cacheOrigin === null
    && candidate.actualExecutor === candidate.backendId
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
    && receipt.externalRequest === candidate.externalRequest
    && receipt.dataLeftDevice === candidate.dataLeftDevice,
  );
  const cachedExecutionVerified = Boolean(
    !receipt
    && candidate.cacheOrigin
    && candidate.actualExecutor === "not_executed"
    && candidate.cacheOrigin.originExecutionReceipt.backendId === candidate.backendId
    && candidate.cacheOrigin.originExecutionReceipt.modelId === candidate.modelId
    && candidate.cacheOrigin.originExecutionReceipt.modelDigest === candidate.modelDigest
    && candidate.cacheOrigin.originExecutionReceipt.contentDigest === candidate.contentDigest,
  );
  return candidate.schemaVersion === CLOSED_AGENT_OS_SCHEMA_VERSION
    && candidate.kind === "candidate"
    && task?.schemaVersion === CLOSED_AGENT_OS_SCHEMA_VERSION
    && task.kind === "task"
    && (candidate.status === "awaiting-approval" || candidate.status === "rejected")
    && candidate.candidateOnly
    && candidate.canonicalMutationCount === 0
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
    && (freshExecutionVerified || cachedExecutionVerified);
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
    .filter(isClosedAgentFailureDiagnosticCode))]
    .slice(0, 12);
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

  private async hasVerifiedPersistedCandidateIntegrity(
    candidate: ClosedAgentCandidate,
    allowCommitted = false,
    allowLegacyMissingBrowserAttestation = false,
  ) {
    const { verifyPersistedTraditionalChineseNormalizationIntegrity } =
      await loadTraditionalChineseRuntime();
    const normalization = candidate.traditionalChineseNormalization;
    const adapterIdentityVerified = (candidate.adapterId ?? null) === null
      && (candidate.adapterDigest ?? null) === null
      || Boolean(
        candidate.adapterId
        && isCryptographicClosedAIModelDigest(candidate.adapterDigest),
      );
    if (
      candidate.schemaVersion !== CLOSED_AGENT_OS_SCHEMA_VERSION
      || candidate.kind !== "candidate"
      || candidate.candidateOnly !== true
      || typeof candidate.modelId !== "string"
      || candidate.modelId.length === 0
      || candidate.modelId.length > 192
      || !isCryptographicClosedAIModelDigest(candidate.modelDigest)
      || !isCryptographicClosedAIModelDigest(candidate.requestContractDigest)
      || candidate.planningBinding !== undefined
        && !await verifyClosedAgentPlanningBinding(candidate.planningBinding)
      || candidate.applicationValidationBindingDigest !== undefined
        && candidate.applicationValidationBindingDigest !== null
        && !isCryptographicClosedAIModelDigest(
          candidate.applicationValidationBindingDigest,
        )
      || (candidate.taskType !== undefined && (
        candidate.taskType.length < 3
        || candidate.taskType.length > 120
        || !/^[A-Za-z0-9._:-]+$/u.test(candidate.taskType)
      ))
      || !new Set(["light", "standard", "heavy"] as const).has(
        candidate.planComplexity,
      )
      || !candidate.generationTelemetry
      || (allowCommitted
        ? candidate.canonicalMutationCount !== 0
          && candidate.canonicalMutationCount !== 1
        : candidate.canonicalMutationCount !== 0)
      || (allowCommitted && !(
        candidate.status === "awaiting-approval"
          && candidate.canonicalMutationCount === 0
        || candidate.status === "approved"
          && candidate.canonicalMutationCount === 0
        || candidate.status === "committed"
          && candidate.canonicalMutationCount === 1
        || candidate.status === "rejected"
          && candidate.canonicalMutationCount === 0
      ))
      || !adapterIdentityVerified
      || candidate.externalRequest !== false
      || candidate.dataLeftDevice !== false
      || candidate.contentDigest !== await sha256Hex(candidate.content)
      || !await verifyPersistedTraditionalChineseNormalizationIntegrity({
        content: candidate.content,
        integrity: candidate.traditionalChineseNormalization,
        providerId: candidate.backendId,
        modelId: candidate.modelId,
        modelDigest: candidate.modelDigest,
      })
    ) return false;
    if (candidate.executionReceipt) {
      const startedAt = Date.parse(candidate.executionReceipt.startedAt);
      const completedAt = Date.parse(candidate.executionReceipt.completedAt);
      return hasExactClosedBrowserExecutionReceiptShape(
        candidate.executionReceipt,
        allowLegacyMissingBrowserAttestation,
      ) && await hasVerifiedBrowserModelContextAttestation({
        backendId: candidate.executionReceipt.backendId,
        modelId: candidate.executionReceipt.modelId,
        modelDigest: candidate.executionReceipt.modelDigest,
        contextAttestation: candidate.executionReceipt.contextAttestation,
        attestation: candidate.executionReceipt.finalModelContextAttestation,
        allowLegacyMissingBrowserAttestation,
      })
        && candidate.cacheOrigin === null
        && candidate.actualExecutor === candidate.backendId
        && normalization.originRequestId === candidate.taskId
        && candidate.executionReceipt.taskId === candidate.taskId
        && candidate.executionReceipt.contentDigest === candidate.contentDigest
        && candidate.executionReceipt.backendId === candidate.backendId
        && candidate.executionReceipt.modelId === candidate.modelId
        && candidate.executionReceipt.modelDigest === candidate.modelDigest
        && candidate.executionReceipt.proofState === "verified"
        && candidate.executionReceipt.actualExecutor === candidate.backendId
        && candidate.executionReceipt.externalRequest === candidate.externalRequest
        && candidate.executionReceipt.dataLeftDevice === candidate.dataLeftDevice
        && Number.isFinite(startedAt)
        && Number.isFinite(completedAt)
        && startedAt <= completedAt
        && stableStringify(candidate.executionReceipt.traditionalChineseNormalization)
          === stableStringify(normalization);
    }
    const cacheOrigin = candidate.cacheOrigin;
    return Boolean(
      cacheOrigin
      && hasExactClosedBrowserExecutionReceiptShape(
        cacheOrigin.originExecutionReceipt,
        allowLegacyMissingBrowserAttestation,
      )
      && await hasVerifiedBrowserModelContextAttestation({
        backendId: cacheOrigin.originExecutionReceipt.backendId,
        modelId: cacheOrigin.originExecutionReceipt.modelId,
        modelDigest: cacheOrigin.originExecutionReceipt.modelDigest,
        contextAttestation:
          cacheOrigin.originExecutionReceipt.contextAttestation,
        attestation:
          cacheOrigin.originExecutionReceipt.finalModelContextAttestation,
        allowLegacyMissingBrowserAttestation,
      })
      && candidate.actualExecutor === "not_executed"
      && cacheOrigin.schemaVersion === "closed-agent-cache-origin-v1"
      && (cacheOrigin.layer === "exact" || cacheOrigin.layer === "semantic")
      && Boolean(cacheOrigin.entryId)
      && isCryptographicClosedAIModelDigest(cacheOrigin.entryValueDigest)
      && cacheOrigin.normalizationReceiptId === normalization.receiptId
      && cacheOrigin.originRequestId === normalization.originRequestId
      && cacheOrigin.originTaskId === normalization.originRequestId
      && cacheOrigin.originTaskId === cacheOrigin.originExecutionReceipt.taskId
      && cacheOrigin.originExecutionReceipt.contentDigest === candidate.contentDigest
      && cacheOrigin.originExecutionReceipt.backendId === candidate.backendId
      && cacheOrigin.originExecutionReceipt.modelId === candidate.modelId
      && cacheOrigin.originExecutionReceipt.modelDigest === candidate.modelDigest
      && cacheOrigin.originExecutionReceipt.externalRequest === candidate.externalRequest
      && cacheOrigin.originExecutionReceipt.dataLeftDevice === candidate.dataLeftDevice
      && stableStringify(cacheOrigin.originExecutionReceipt.traditionalChineseNormalization)
        === stableStringify(normalization)
    );
  }

  private async hasVerifiedCandidateLedgerIntegrity(
    candidate: ClosedAgentCandidate,
    allowCommitted = false,
    legacyReadOnly = false,
  ) {
    const allowLegacyCandidate = legacyReadOnly && candidate.taskType === undefined;
    if (!await this.hasVerifiedPersistedCandidateIntegrity(
      candidate,
      allowCommitted,
      allowLegacyCandidate,
    )) return false;
    const ledgerId = `closed-agent:${candidate.projectId}:${candidate.taskId}`;
    const [verification, blocks] = await Promise.all([
      this.ledger.verify(ledgerId),
      this.ledger.repository.list(ledgerId),
    ]);
    if (!verification.valid) return false;
    let matchCount = 0;
    let evaluationMatchCount = 0;
    const candidateNamespaceDigest = await closedAINamespaceDigest(candidate.namespace);
    const expectedGeneratedPayload = stableStringify(
      retainedCandidateGeneratedPayload(candidate),
    );
    const expectedEvaluatedPayload = stableStringify(
      retainedCandidateEvaluatedPayload(candidate),
    );
    for (const generated of blocks.filter((block) =>
      block.eventType === "candidate-generated" && block.contentRecordId)) {
      const retained = await this.ledger.repository.getContent(generated.contentRecordId!, {
        ledgerId,
        projectId: candidate.projectId,
        namespaceDigest: generated.namespaceDigest,
      });
      if (
        generated.namespaceDigest === candidateNamespaceDigest
        && sameClosedAINamespace(generated.namespace, candidate.namespace)
        && stableStringify(retained?.content) === expectedGeneratedPayload
      ) matchCount += 1;
    }
    for (const evaluated of blocks.filter((block) =>
      block.eventType === "candidate-evaluated" && block.contentRecordId)) {
      const retained = await this.ledger.repository.getContent(evaluated.contentRecordId!, {
        ledgerId,
        projectId: candidate.projectId,
        namespaceDigest: evaluated.namespaceDigest,
      });
      if (
        evaluated.namespaceDigest === candidateNamespaceDigest
        && sameClosedAINamespace(evaluated.namespace, candidate.namespace)
        && stableStringify(retained?.content) === expectedEvaluatedPayload
      ) evaluationMatchCount += 1;
    }
    if (matchCount !== 1 || evaluationMatchCount !== 1) return false;
    if (!candidate.cacheOrigin) return true;
    const origin = candidate.cacheOrigin;
    const originCandidate = await this.state.get<ClosedAgentCandidate>(
      origin.originCandidateId,
    );
    if (
      !originCandidate
      || originCandidate.id === candidate.id
      || originCandidate.taskId !== origin.originTaskId
      || originCandidate.projectId !== candidate.projectId
      || !sameClosedAINamespace(originCandidate.namespace, candidate.namespace)
      || originCandidate.cacheOrigin !== null
      || origin.originLedgerId
        !== `closed-agent:${originCandidate.projectId}:${originCandidate.taskId}`
      || stableStringify(originCandidate.executionReceipt)
        !== stableStringify(origin.originExecutionReceipt)
      || stableStringify(originCandidate.traditionalChineseNormalization)
        !== stableStringify(candidate.traditionalChineseNormalization)
      || !await this.hasVerifiedCandidateLedgerIntegrity(originCandidate, true)
    ) return false;
    const originBlocks = await this.ledger.repository.list(origin.originLedgerId);
    const exactOriginBlock = originBlocks.find((block) =>
      block.eventType === "candidate-generated"
      && block.blockHash === origin.originLedgerBlockHash);
    if (!exactOriginBlock?.contentRecordId) return false;
    const originRetained = await this.ledger.repository.getContent(
      exactOriginBlock.contentRecordId,
      {
        ledgerId: origin.originLedgerId,
        projectId: originCandidate.projectId,
        namespaceDigest: exactOriginBlock.namespaceDigest,
      },
    );
    const originPayload = originRetained?.content as {
      candidateId?: unknown;
      contentDigest?: unknown;
      executionReceipt?: unknown;
      traditionalChineseNormalization?: unknown;
    } | undefined;
    return originPayload?.candidateId === originCandidate.id
      && originPayload.contentDigest === originCandidate.contentDigest
      && stableStringify(originPayload.executionReceipt)
        === stableStringify(origin.originExecutionReceipt)
      && stableStringify(originPayload.traditionalChineseNormalization)
        === stableStringify(candidate.traditionalChineseNormalization);
  }

  private async retainedCandidateSnapshotForFailedTask(
    request: ClosedAgentTaskRequest,
  ): Promise<ClosedAgentCandidate | null> {
    const ledgerId = this.ledgerId(request);
    const [verification, blocks] = await Promise.all([
      this.ledger.verify(ledgerId),
      this.ledger.repository.list(ledgerId),
    ]);
    if (!verification.valid) return null;
    const candidates: ClosedAgentCandidate[] = [];
    for (const block of blocks) {
      if (block.eventType !== "candidate-generated" || !block.contentRecordId) continue;
      const retained = await this.ledger.repository.getContent(block.contentRecordId, {
        ledgerId,
        projectId: request.namespace.projectId,
        namespaceDigest: block.namespaceDigest,
      });
      const snapshot = (retained?.content as {
        candidateSnapshot?: unknown;
      } | undefined)?.candidateSnapshot;
      if (
        snapshot
        && typeof snapshot === "object"
        && (snapshot as { taskId?: unknown }).taskId === request.taskId
      ) candidates.push(snapshot as ClosedAgentCandidate);
    }
    if (candidates.length > 1) {
      throw osError("CLOSED_AGENT_LEDGER_DUPLICATE_CANDIDATE_EVENT");
    }
    return candidates[0] ?? null;
  }

  private async recoverCompletedCandidateFromLedger(input: {
    request: ClosedAgentTaskRequest;
    plan: ClosedAgentPlan;
    contextDigest: string;
    policy: TraditionalChineseNormalizationPolicy;
    regenerationEvidence: ClosedAgentCandidate["regeneration"];
    requestContractDigest: string;
  }): Promise<{
    candidate: ClosedAgentCandidate;
    ledgerHeadHash: string;
  } | null> {
    const { verifyTraditionalChineseNormalizationIntegrity } =
      await loadTraditionalChineseRuntime();
    const ledgerId = this.ledgerId(input.request);
    const [verification, blocks] = await Promise.all([
      this.ledger.verify(ledgerId),
      this.ledger.repository.list(ledgerId),
    ]);
    if (!verification.valid || !verification.headHash) return null;
    const candidates: Array<{
      candidate: ClosedAgentCandidate;
      block: VerifiableLedgerBlock;
      retainedContent: unknown;
    }> = [];
    for (const block of blocks) {
      if (block.eventType !== "candidate-generated" || !block.contentRecordId) continue;
      const retained = await this.ledger.repository.getContent(block.contentRecordId, {
        ledgerId,
        projectId: input.request.namespace.projectId,
        namespaceDigest: block.namespaceDigest,
      });
      const snapshot = (retained?.content as {
        candidateSnapshot?: unknown;
      } | undefined)?.candidateSnapshot;
      if (
        snapshot
        && typeof snapshot === "object"
        && (snapshot as { taskId?: unknown }).taskId === input.request.taskId
      ) {
        candidates.push({
          candidate: snapshot as ClosedAgentCandidate,
          block,
          retainedContent: retained?.content,
        });
      }
    }
    if (candidates.length > 1) {
      throw osError("CLOSED_AGENT_LEDGER_DUPLICATE_CANDIDATE_EVENT");
    }
    if (candidates.length === 0) return null;
    const recovered = candidates[0]!;
    const candidate = recovered.candidate;
    try {
      const candidateNamespaceDigest = await closedAINamespaceDigest(candidate.namespace);
      if (
        candidate.status !== "awaiting-approval"
        || candidate.projectId !== input.request.namespace.projectId
        || candidate.backendId !== input.plan.backendId
        || candidate.modelId !== candidate.namespace.modelId
        || candidate.modelDigest !== candidate.namespace.modelDigest
        || !sameClosedAINamespace(candidate.namespace, input.request.namespace)
        || candidate.contextDigest !== input.contextDigest
        || candidate.sourceChapterId !== (input.request.sourceChapterId ?? null)
        || candidate.sourceRevision !== (input.request.sourceRevision ?? null)
        || candidate.planDigest !== input.plan.planDigest
        || candidate.requestContractDigest !== input.requestContractDigest
        || (candidate.applicationValidationBindingDigest ?? null)
          !== (input.request.applicationValidationBindingDigest ?? null)
        || stableStringify(candidate.regeneration)
          !== stableStringify(input.regenerationEvidence)
        || candidate.evaluation.passed !== true
        || recovered.block.namespaceDigest !== candidateNamespaceDigest
        || !sameClosedAINamespace(recovered.block.namespace, candidate.namespace)
        || stableStringify(recovered.retainedContent)
          !== stableStringify(retainedCandidateGeneratedPayload(candidate))
        || !await this.hasVerifiedPersistedCandidateIntegrity(candidate)
        || !await verifyTraditionalChineseNormalizationIntegrity({
          content: candidate.content,
          integrity: candidate.traditionalChineseNormalization,
          policy: input.policy,
          providerId: candidate.backendId,
          modelId: candidate.modelId,
          modelDigest: candidate.modelDigest,
        })
      ) throw osError("CLOSED_AGENT_IDEMPOTENCY_CONFLICT");
      const expectedEvaluationPayload = retainedCandidateEvaluatedPayload(candidate);
      const expectedEvaluation = stableStringify(expectedEvaluationPayload);
      let evaluationMatchCount = 0;
      let evaluationConflictCount = 0;
      for (const block of blocks) {
        if (block.eventType !== "candidate-evaluated" || !block.contentRecordId) continue;
        const retained = await this.ledger.repository.getContent(block.contentRecordId, {
          ledgerId,
          projectId: candidate.projectId,
          namespaceDigest: block.namespaceDigest,
        });
        const retainedCandidateId = (retained?.content as {
          candidateId?: unknown;
        } | undefined)?.candidateId;
        if (retainedCandidateId !== candidate.id) continue;
        if (
          block.namespaceDigest === candidateNamespaceDigest
          && sameClosedAINamespace(block.namespace, candidate.namespace)
          && stableStringify(retained?.content) === expectedEvaluation
        ) {
          evaluationMatchCount += 1;
        } else {
          evaluationConflictCount += 1;
        }
      }
      if (evaluationConflictCount > 0 || evaluationMatchCount > 1) {
        throw osError("CLOSED_AGENT_LEDGER_EVALUATION_CONFLICT");
      }
      if (evaluationMatchCount === 0) {
        if (input.request.signal?.aborted) {
          throw osError("CLOSED_AGENT_TASK_CANCELLED");
        }
        await appendOrReuseExactLedgerPayload({
          ledger: this.ledger,
          ledgerId,
          namespace: candidate.namespace,
          eventType: "candidate-evaluated",
          payload: expectedEvaluationPayload,
          retainContent: true,
        });
      }
      if (!await this.hasVerifiedCandidateLedgerIntegrity(candidate)) {
        throw osError("CLOSED_AGENT_IDEMPOTENCY_CONFLICT");
      }
    } catch (error) {
      if ((error as { code?: unknown })?.code === "CLOSED_AGENT_TASK_CANCELLED") {
        throw error;
      }
      throw osError("CLOSED_AGENT_IDEMPOTENCY_CANDIDATE_INTEGRITY_INVALID");
    }
    const recoveredVerification = await this.ledger.verify(ledgerId);
    if (!recoveredVerification.valid || !recoveredVerification.headHash) {
      throw osError("CLOSED_AGENT_LEDGER_INTEGRITY_FAILED");
    }
    return { candidate, ledgerHeadHash: recoveredVerification.headHash };
  }

  private async verifiedCachedExecution(input: {
    layer: "exact" | "semantic";
    entry: {
      id: string;
      valueDigest: string;
      value: unknown;
    };
    artifact: ClosedAgentCachedExecutionArtifact;
    policy: TraditionalChineseNormalizationPolicy;
    routedBackend: ClosedAIBackendSnapshot;
    currentNamespace: ClosedAINamespace;
  }): Promise<{
    execution: ClosedBackendExecutionResult;
    cacheOrigin: ClosedAgentCacheOriginEvidence;
  } | null> {
    const { verifyTraditionalChineseNormalizationIntegrity } =
      await loadTraditionalChineseRuntime();
    const artifact = input.artifact;
    if (
      input.entry.valueDigest !== await sha256Hex(stableStringify(input.entry.value))
      || artifact?.schemaVersion !== "closed-agent-cached-execution-v1"
      || !await verifyTraditionalChineseNormalizationIntegrity({
        content: artifact.execution?.content,
        integrity: artifact.execution?.traditionalChineseNormalization,
        policy: input.policy,
        providerId: artifact.execution?.backendId,
        modelId: artifact.execution?.modelId,
        modelDigest: artifact.execution?.modelDigest,
      })
      || artifact.execution.backendId !== input.routedBackend.id
      || artifact.execution.modelId !== input.routedBackend.modelId
      || artifact.execution.modelDigest !== input.routedBackend.modelDigest
      || !hasExactClosedBrowserExecutionReceiptShape(
        artifact.originExecutionReceipt,
        false,
      )
      || !await hasVerifiedBrowserModelContextAttestation({
        backendId: artifact.execution.backendId,
        modelId: artifact.execution.modelId,
        modelDigest: artifact.execution.modelDigest,
        contextAttestation: artifact.execution.contextAttestation,
        attestation: artifact.execution.finalModelContextAttestation,
      })
      || !await hasVerifiedBrowserModelContextAttestation({
        backendId: artifact.originExecutionReceipt.backendId,
        modelId: artifact.originExecutionReceipt.modelId,
        modelDigest: artifact.originExecutionReceipt.modelDigest,
        contextAttestation:
          artifact.originExecutionReceipt.contextAttestation,
        attestation:
          artifact.originExecutionReceipt.finalModelContextAttestation,
      })
      || stableStringify(artifact.execution.finalModelContextAttestation)
        !== stableStringify(
          artifact.originExecutionReceipt.finalModelContextAttestation,
        )
      || artifact.execution.contextAttestation
        !== artifact.originExecutionReceipt.contextAttestation
      || artifact.execution.candidateOnly !== true
      || artifact.originTaskId !== artifact.originExecutionReceipt.taskId
      || artifact.originTaskId
        !== artifact.execution.traditionalChineseNormalization.originRequestId
      || artifact.originExecutionReceipt.contentDigest
        !== await sha256Hex(artifact.execution.content)
      || stableStringify(artifact.originExecutionReceipt.traditionalChineseNormalization)
        !== stableStringify(artifact.execution.traditionalChineseNormalization)
    ) return null;
    const originCandidate = await this.state.get<ClosedAgentCandidate>(
      artifact.originCandidateId,
    );
    if (
      !originCandidate
      || originCandidate.taskId !== artifact.originTaskId
      || originCandidate.status === "rejected"
      || originCandidate.status === "rolled-back"
      || !sameClosedAINamespace(originCandidate.namespace, input.currentNamespace)
      || artifact.originLedgerId
        !== `closed-agent:${originCandidate.projectId}:${artifact.originTaskId}`
      || originCandidate.cacheOrigin !== null
      || stableStringify(originCandidate.executionReceipt)
        !== stableStringify(artifact.originExecutionReceipt)
      || originCandidate.adapterId !== (artifact.execution.adapterId ?? null)
      || originCandidate.adapterDigest !== (artifact.execution.adapterDigest ?? null)
      || originCandidate.externalRequest !== artifact.execution.externalRequest
      || originCandidate.dataLeftDevice !== artifact.execution.dataLeftDevice
      || artifact.originExecutionReceipt.externalRequest
        !== artifact.execution.externalRequest
      || artifact.originExecutionReceipt.dataLeftDevice
        !== artifact.execution.dataLeftDevice
      || artifact.originExecutionReceipt.actualExecutor !== artifact.execution.backendId
      || !await this.hasVerifiedCandidateLedgerIntegrity(originCandidate, true)
    ) return null;
    const originBlocks = await this.ledger.repository.list(artifact.originLedgerId);
    const originBlock = originBlocks.find((block) =>
      block.eventType === "candidate-generated"
      && block.blockHash === artifact.originLedgerBlockHash);
    if (!originBlock?.contentRecordId) return null;
    const originRecord = await this.ledger.repository.getContent(
      originBlock.contentRecordId,
      {
        ledgerId: artifact.originLedgerId,
        projectId: originCandidate.projectId,
        namespaceDigest: originBlock.namespaceDigest,
      },
    );
    const originPayload = originRecord?.content as {
      candidateId?: unknown;
      taskId?: unknown;
      backendId?: unknown;
      modelId?: unknown;
      modelDigest?: unknown;
      adapterId?: unknown;
      adapterDigest?: unknown;
      contentDigest?: unknown;
      contextDigest?: unknown;
      sourceChapterId?: unknown;
      sourceRevision?: unknown;
      candidateOnly?: unknown;
      externalRequest?: unknown;
      dataLeftDevice?: unknown;
      executionReceipt?: unknown;
      cacheOrigin?: unknown;
      traditionalChineseNormalization?: unknown;
    } | undefined;
    if (
      originPayload?.candidateId !== originCandidate.id
      || originBlock.namespaceDigest
        !== await closedAINamespaceDigest(originCandidate.namespace)
      || !sameClosedAINamespace(originBlock.namespace, originCandidate.namespace)
      || originPayload.taskId !== originCandidate.taskId
      || originPayload.backendId !== originCandidate.backendId
      || originPayload.modelId !== originCandidate.modelId
      || originPayload.modelDigest !== originCandidate.modelDigest
      || originPayload.adapterId !== (originCandidate.adapterId ?? null)
      || originPayload.adapterDigest !== (originCandidate.adapterDigest ?? null)
      || originPayload.contentDigest !== originCandidate.contentDigest
      || originPayload.contextDigest !== originCandidate.contextDigest
      || originPayload.sourceChapterId !== originCandidate.sourceChapterId
      || originPayload.sourceRevision !== originCandidate.sourceRevision
      || originPayload.candidateOnly !== true
      || originPayload.externalRequest !== originCandidate.externalRequest
      || originPayload.dataLeftDevice !== originCandidate.dataLeftDevice
      || stableStringify(originPayload.executionReceipt)
        !== stableStringify(originCandidate.executionReceipt)
      || originPayload.cacheOrigin !== null
      || stableStringify(originPayload.traditionalChineseNormalization)
        !== stableStringify(originCandidate.traditionalChineseNormalization)
    ) return null;
    return {
      execution: artifact.execution,
      cacheOrigin: {
        schemaVersion: "closed-agent-cache-origin-v1",
        layer: input.layer,
        entryId: input.entry.id,
        entryValueDigest: input.entry.valueDigest,
        originCandidateId: artifact.originCandidateId,
        originTaskId: artifact.originTaskId,
        originRequestId:
          artifact.execution.traditionalChineseNormalization.originRequestId,
        originLedgerId: artifact.originLedgerId,
        originLedgerBlockHash: artifact.originLedgerBlockHash,
        originExecutionReceipt: artifact.originExecutionReceipt,
        normalizationReceiptId:
          artifact.execution.traditionalChineseNormalization.receiptId,
      },
    };
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

  async verifyCandidateIntegrity(candidateId: string) {
    const candidate = await this.state.get<ClosedAgentCandidate>(candidateId);
    if (
      !candidate
      || !await this.hasVerifiedCandidateLedgerIntegrity(candidate, true, true)
    ) return false;
    if (candidate.status !== "rejected") return true;
    const rejection = await this.state.get<ClosedAgentRejectionRecord>(
      await this.rejectionRecordId(candidate.id),
    );
    return rejection
      ? this.hasVerifiedCompletedRejectionRecord(candidate, rejection)
      : candidate.taskType === undefined;
  }

  execute(request: ClosedAgentTaskRequest): Promise<ClosedAgentExecutionResult> {
    const projectId = request.namespace.projectId;
    const previous = this.projectQueues.get(projectId) ?? Promise.resolve();
    this.emitProgress(request, "queued", "工作已進入此作品的安全佇列", 0);
    const operation = previous.then(() => {
      if (request.signal?.aborted) {
        throw osError("CLOSED_AGENT_TASK_CANCELLED");
      }
      return this.executeInternal(request);
    });
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
    const hasApplicationValidator = typeof request.validateBeforePersistence === "function";
    const hasApplicationValidationBinding = Boolean(
      request.applicationValidationBindingDigest,
    );
    if (
      hasApplicationValidator !== hasApplicationValidationBinding
      || (
        hasApplicationValidationBinding
        && !isCryptographicClosedAIModelDigest(
          request.applicationValidationBindingDigest,
        )
      )
    ) {
      throw osError("CLOSED_AGENT_TRANSIENT_VALIDATION_CONTRACT_INVALID");
    }
    const substantiveSceneBudget =
      request.generationOptions?.substantiveSceneBudget;
    if (
      substantiveSceneBudget !== undefined
      && (
        substantiveSceneBudget !== "rpg-application-minimum"
        || request.taskType !== "chapter.continue"
        || request.generationOptions?.substantiveScene !== true
        || request.ephemeralPrompt !== true
        || !hasApplicationValidator
        || !hasApplicationValidationBinding
      )
    ) {
      throw osError("CLOSED_AGENT_SUBSTANTIVE_SCENE_BUDGET_INVALID");
    }
    const {
      createTraditionalChineseNormalizationPolicy,
      TRADITIONAL_CHINESE_NORMALIZER_VERSION,
      verifyTraditionalChineseNormalizationIntegrity,
      verifyTraditionalChineseNormalizationPolicy,
    } = await loadTraditionalChineseRuntime();
    const requestContractDigest = await closedAgentRequestContractDigest(requestInput);
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
      const sourceIntegrityVerified =
        await this.hasVerifiedCandidateLedgerIntegrity(source);
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
        || !sourceIntegrityVerified
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
    if (
      existing?.state === "failed"
      && existing.requestContractDigest !== undefined
      && existing.requestContractDigest !== requestContractDigest
    ) {
      throw osError("CLOSED_AGENT_IDEMPOTENCY_CONFLICT");
    }
    const retryBackendValue: unknown = request.idempotentRetryBackend;
    const retryBackendSupplied = retryBackendValue !== undefined;
    const idempotentRetryBackend = retryBackendValue === "local-ollama"
      ? retryBackendValue
      : null;
    const retryPolicyAuthorizesLocal =
      request.allowPreAuthorizedClosedEscalation === true
      && (
        request.browserComputePolicy === "balanced"
        || request.browserComputePolicy === "quality-first"
      )
      && request.preferredBackend === undefined;
    if (retryBackendSupplied && (
      idempotentRetryBackend !== "local-ollama"
      || !retryPolicyAuthorizesLocal
      || request.regeneration
      || existing?.state !== "failed"
      || existing.backendId !== "browser-ai"
      || existing.requestContractDigest !== requestContractDigest
      || !IDEMPOTENT_BROWSER_TO_LOCAL_RETRY_CODES.has(existing.errorCode ?? "")
      || !await this.hasVerifiedTaskAcceptedRequestContract(
        request,
        requestContractDigest,
      )
    )) {
      throw osError("CLOSED_AGENT_IDEMPOTENCY_CONFLICT");
    }
    if (request.regeneration && existing && existing.state !== "failed") {
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
      if (candidate.status !== "awaiting-approval") {
        throw osError("CLOSED_AGENT_IDEMPOTENCY_CANDIDATE_INTEGRITY_INVALID");
      }
      const replayContextDigest = await closedAgentContextDigest(request);
      const replayNormalizationPolicy =
        await createTraditionalChineseNormalizationPolicy({
          objective: request.objective,
          privacyLevel: request.namespace.privacyLevel,
          context: request.context,
        });
      const expectedReplayNamespace = {
        ...request.namespace,
        modelId: candidate.modelId,
        modelDigest: candidate.modelDigest,
      };
      if (
        existing.schemaVersion !== CLOSED_AGENT_OS_SCHEMA_VERSION
        || existing.taskType !== request.taskType
        || existing.projectId !== candidate.projectId
        || existing.requestContractDigest !== undefined
          && existing.requestContractDigest !== requestContractDigest
        || !sameClosedAINamespace(candidate.namespace, expectedReplayNamespace)
        || !sameClosedAINamespace(existing.namespace, expectedReplayNamespace)
        || candidate.contextDigest !== replayContextDigest
        || candidate.requestContractDigest !== requestContractDigest
        || (candidate.applicationValidationBindingDigest ?? null)
          !== (request.applicationValidationBindingDigest ?? null)
        || candidate.sourceChapterId !== (request.sourceChapterId ?? null)
        || candidate.sourceRevision !== (request.sourceRevision ?? null)
        || !await verifyTraditionalChineseNormalizationPolicy(
          replayNormalizationPolicy,
        )
        || !await verifyTraditionalChineseNormalizationIntegrity({
          content: candidate.content,
          integrity: candidate.traditionalChineseNormalization,
          policy: replayNormalizationPolicy,
          providerId: candidate.backendId,
          modelId: candidate.modelId,
          modelDigest: candidate.modelDigest,
        })
      ) {
        throw osError("CLOSED_AGENT_IDEMPOTENCY_CONFLICT");
      }
      if (!await this.hasVerifiedCandidateLedgerIntegrity(candidate, true)) {
        throw osError("CLOSED_AGENT_IDEMPOTENCY_CANDIDATE_INTEGRITY_INVALID");
      }
      const planningBinding = candidate.planningBinding;
      if (planningBinding && !await verifyClosedAgentPlanningBinding(planningBinding)) {
        throw osError("CLOSED_AGENT_IDEMPOTENCY_PLAN_MISSING");
      }
      const activeLearning = await this.learning.activeConfiguration(candidate.namespace);
      const activeLearningMatchesBinding = Boolean(
        planningBinding
        && activeLearning.applied === planningBinding.controlledLearningApplied
        && activeLearning.versionId === planningBinding.controlledLearningVersionId
        && activeLearning.configurationDigest
          === planningBinding.controlledLearningConfigurationDigest,
      );
      const replayRequest = {
        ...request,
        namespace: candidate.namespace,
        learningConfiguration: planningBinding && !activeLearningMatchesBinding
          ? { "planner.strategy": planningBinding.plannerStrategy }
          : activeLearning.configuration,
      };
      const blocks = await this.ledger.repository.list(this.ledgerId(request));
      const boundReplayPlan = planningBinding
        ? await createClosedAgentPlan({
          request: replayRequest,
          backendId: candidate.backendId,
          complexity: candidate.planComplexity,
        })
        : null;
      let replayPlan: ClosedAgentPlan | null = boundReplayPlan;
      let replayPlanCacheHit = false;
      if (!request.ephemeralPrompt && !hasApplicationValidator) {
        const cachedReplayPlan = (await this.cache.get<ClosedAgentPlan>(
          "agent-plan",
          candidate.namespace,
          this.planCacheInput(replayRequest, candidate.backendId),
        )).entry?.value ?? null;
        replayPlanCacheHit = Boolean(
          cachedReplayPlan
          && (!boundReplayPlan
            || stableStringify(cachedReplayPlan) === stableStringify(boundReplayPlan)),
        );
        replayPlan = boundReplayPlan ?? cachedReplayPlan;
      }
      if (!replayPlan && (request.ephemeralPrompt || hasApplicationValidator)) {
        replayPlan = await createClosedAgentPlan({
          request: replayRequest,
          backendId: candidate.backendId,
          complexity: candidate.planComplexity,
        });
      }
      if (
        !replayPlan
        || replayPlan.schemaVersion !== CLOSED_AGENT_OS_SCHEMA_VERSION
        || replayPlan.taskId !== request.taskId
        || replayPlan.backendId !== candidate.backendId
        || replayPlan.planDigest !== candidate.planDigest
        || planningBinding
          && replayPlan.plannerStrategy !== planningBinding.plannerStrategy
      ) throw osError("CLOSED_AGENT_IDEMPOTENCY_PLAN_MISSING");
      return {
        task: existing,
        candidate,
        plan: replayPlan,
        toolExecutions: structuredClone(candidate.toolExecutions ?? []),
        route: {
          backendId: candidate.backendId,
          locked: true,
          automatic: !request.preferredBackend,
          reasonCode: "IDEMPOTENT_REPLAY",
          fallbackAttempted: false,
        },
        cache: {
          candidateHit: true,
          planHit: replayPlanCacheHit,
          bypassReason: null,
        },
        learning: planningBinding
          ? planningLearningReceipt(planningBinding)
          : activeLearning,
        ledgerHeadHash: blocks.at(-1)?.blockHash ?? "",
      };
    }
    if (existing?.state === "failed") {
      const snapshot = await this.retainedCandidateSnapshotForFailedTask(request);
      if (snapshot) {
        const expectedNamespace = {
          ...request.namespace,
          modelId: snapshot.modelId,
          modelDigest: snapshot.modelDigest,
        };
        if (
          existing.schemaVersion !== CLOSED_AGENT_OS_SCHEMA_VERSION
          || existing.taskType !== request.taskType
          || existing.projectId !== snapshot.projectId
          || existing.backendId !== snapshot.backendId
          || !sameClosedAINamespace(existing.namespace, snapshot.namespace)
          || !sameClosedAINamespace(snapshot.namespace, expectedNamespace)
          || request.preferredBackend
            && request.preferredBackend !== snapshot.backendId
          || snapshot.requestContractDigest !== requestContractDigest
          || (snapshot.applicationValidationBindingDigest ?? null)
            !== (request.applicationValidationBindingDigest ?? null)
        ) {
          throw osError("CLOSED_AGENT_IDEMPOTENCY_CONFLICT");
        }
        const recoveryPolicy = await createTraditionalChineseNormalizationPolicy({
          objective: request.objective,
          privacyLevel: request.namespace.privacyLevel,
          context: request.context,
        });
        if (!await verifyTraditionalChineseNormalizationPolicy(recoveryPolicy)) {
          throw osError("CLOSED_AGENT_TRADITIONAL_CHINESE_POLICY_INVALID");
        }
        const recoveryLearning = await this.learning.activeConfiguration(
          snapshot.namespace,
        );
        if (
          snapshot.planningBinding
          && !await verifyClosedAgentPlanningBinding(snapshot.planningBinding)
        ) {
          throw osError("CLOSED_AGENT_IDEMPOTENCY_PLAN_MISSING");
        }
        const recoveryLearningMatchesBinding = Boolean(
          snapshot.planningBinding
          && recoveryLearning.applied
            === snapshot.planningBinding.controlledLearningApplied
          && recoveryLearning.versionId
            === snapshot.planningBinding.controlledLearningVersionId
          && recoveryLearning.configurationDigest
            === snapshot.planningBinding.controlledLearningConfigurationDigest,
        );
        const recoveryRequest: ClosedAgentTaskRequest = {
          ...request,
          namespace: snapshot.namespace,
          learningConfiguration:
            snapshot.planningBinding && !recoveryLearningMatchesBinding
              ? { "planner.strategy": snapshot.planningBinding.plannerStrategy }
              : recoveryLearning.configuration,
        };
        const recoveryPlan = await createClosedAgentPlan({
          request: recoveryRequest,
          backendId: snapshot.backendId,
          complexity: snapshot.planComplexity,
        });
        const recovered = await this.recoverCompletedCandidateFromLedger({
          request: recoveryRequest,
          plan: recoveryPlan,
          contextDigest: await closedAgentContextDigest(request),
          policy: recoveryPolicy,
          regenerationEvidence: await closedAgentRegenerationEvidence(requestInput),
          requestContractDigest,
        });
        if (!recovered) {
          throw osError("CLOSED_AGENT_IDEMPOTENCY_CANDIDATE_INTEGRITY_INVALID");
        }
        if (request.signal?.aborted) {
          await this.state.put({
            ...existing,
            state: "cancelled",
            errorCode: "CLOSED_AGENT_TASK_CANCELLED",
            updatedAt: this.now().toISOString(),
          });
          throw osError("CLOSED_AGENT_TASK_CANCELLED");
        }
        const recoveredTask: ClosedAgentTaskRecord = {
          ...existing,
          state: "awaiting-approval",
          errorCode: null,
          updatedAt: this.now().toISOString(),
        };
        await this.state.putMany([recovered.candidate, recoveredTask]);
        this.emitProgress(
          recoveryRequest,
          "awaiting-approval",
          "已從完整證據鏈恢復候選，等待人工核准",
          100,
          {
            backendId: snapshot.backendId,
            generatedCharacters: snapshot.content.length,
            cacheHit: snapshot.generationTelemetry?.cacheHit ?? false,
          },
        );
        return {
          task: recoveredTask,
          candidate: recovered.candidate,
          plan: recoveryPlan,
          toolExecutions: structuredClone(recovered.candidate.toolExecutions ?? []),
          route: {
            backendId: snapshot.backendId,
            locked: true,
            automatic: !request.preferredBackend,
            reasonCode: "DURABLE_CANDIDATE_RECOVERY",
            fallbackAttempted: false,
          },
          cache: {
            candidateHit: snapshot.generationTelemetry?.cacheHit ?? false,
            planHit: false,
            bypassReason: request.regeneration?.cacheBypassReason ?? null,
          },
          learning: snapshot.planningBinding
            ? planningLearningReceipt(snapshot.planningBinding)
            : recoveryLearning,
          ledgerHeadHash: recovered.ledgerHeadHash,
        };
      }
    }
    const retryingFailedTask = existing?.state === "failed";
    const createdAt = retryingFailedTask
      ? existing.createdAt
      : this.now().toISOString();
    let task: ClosedAgentTaskRecord = {
      schemaVersion: CLOSED_AGENT_OS_SCHEMA_VERSION,
      kind: "task",
      id: request.taskId,
      projectId: request.namespace.projectId,
      namespace: structuredClone(request.namespace),
      taskType: request.taskType,
      backendId: null,
      requestContractDigest,
      state: "queued",
      errorCode: null,
      createdAt,
      updatedAt: createdAt,
    };
    await this.state.put(task);
    if (!retryingFailedTask) {
      await this.ledger.append({
        ledgerId: this.ledgerId(request),
        namespace: request.namespace,
        eventType: "task-accepted",
        payload: await closedAgentTaskAcceptedPayload(
          request,
          requestContractDigest,
        ),
      });
    }
    try {
      this.emitProgress(request, "probing", "正在核對三個閉端後端的真實狀態", 8);
      const routingLearning = await this.learning.activeConfiguration(request.namespace);
      request = {
        ...request,
        learningConfiguration: routingLearning.configuration,
      };
      const snapshots = await this.backendSnapshots(request.signal, request.namespace);
      const selectedRoute = selectClosedAIBackend(
        idempotentRetryBackend
          ? { ...request, preferredBackend: idempotentRetryBackend }
          : request,
        snapshots,
      );
      const route = {
        ...selectedRoute,
        backend: closedBrowserTaskExecutionSnapshot(
          selectedRoute.backend,
          request.taskType,
        ),
      };
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
      let plan: ClosedAgentPlan;
      let planCacheHit = false;
      if (request.ephemeralPrompt || hasApplicationValidator) {
        // The role objectives include the full caller prompt. Sensitive hidden
        // reviews and application-gated normal generations therefore stage the
        // plan in memory until the application accepts the model output.
        plan = await createClosedAgentPlan({
          request,
          backendId: route.backend.id,
          complexity: route.complexity,
        });
      } else {
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
        plan = planResult.value;
        planCacheHit = planResult.cacheHit;
        if (
          plan.schemaVersion !== CLOSED_AGENT_OS_SCHEMA_VERSION
          || plan.taskId !== request.taskId
          || plan.backendId !== route.backend.id
        ) {
          await this.cache.repository.remove(planResult.entry.id);
          plan = await createClosedAgentPlan({
            request,
            backendId: route.backend.id,
            complexity: route.complexity,
          });
          await this.cache.put({
            layer: "agent-plan",
            namespace: request.namespace,
            input: planInput,
            value: plan,
            tags: ["closed-agent-plan", `task:${request.taskType}`],
            ttlMs: learningCacheTtl(request.learningConfiguration, "agent-plan"),
          });
          planCacheHit = false;
        }
      }
      this.emitProgress(
        request,
        "planning",
        planCacheHit ? "已重用通過驗證的代理計畫" : "代理計畫已建立並完成權限檢查",
        28,
        {
          backendId: route.backend.id,
          cacheHit: planCacheHit,
        },
      );
      for (const role of plan.roles) assertClosedAgentPermission({ request, role });
      const planningBinding = await createClosedAgentPlanningBinding({
        plan,
        learning: activeLearning,
      });
      const recordPlannerLearning = () => this.recordOperationalLearningSignal({
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
          plannerStrategy: plan.plannerStrategy,
        },
      });
      if (!hasApplicationValidator) await recordPlannerLearning();
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
      const selectActorContext = () => request.context
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
        .map(({ item }) => item);
      const actorContextResult = hasApplicationValidator
        ? { value: selectActorContext(), cacheHit: false }
        : await this.cache.compute(
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
          async () => selectActorContext(),
          {
            tags: ["actor-context", `task:${request.taskType}`],
            ttlMs: learningCacheTtl(request.learningConfiguration, "retrieval"),
          },
        );
      const actorContext = actorContextResult.value;
      const traditionalChineseNormalizationPolicy =
        await createTraditionalChineseNormalizationPolicy({
          objective: request.objective,
          privacyLevel: request.namespace.privacyLevel,
          context: request.context,
        });
      if (!await verifyTraditionalChineseNormalizationPolicy(
        traditionalChineseNormalizationPolicy,
      )) {
        throw osError("CLOSED_AGENT_TRADITIONAL_CHINESE_POLICY_INVALID");
      }
      const contextDigest = await closedAgentContextDigest(request);
      const planSemanticDigest = await sha256Hex(stableStringify({
        schemaVersion: plan.schemaVersion,
        complexity: plan.complexity,
        qualityMode: plan.qualityMode,
        backendId: plan.backendId,
        roles: plan.roles,
        steps: plan.steps,
        candidateOnly: plan.candidateOnly,
      }));
      const candidateInput = {
        taskType: request.taskType,
        objectiveDigest: await sha256Hex(request.objective),
        actorContextDigests: await Promise.all(actorContext.map((item) => sha256Hex(item.text))),
        planDigest: planSemanticDigest,
        qualityMode: plan.qualityMode,
        backendId: route.backend.id,
        ...(route.backend.id === "browser-ai"
          ? {
            browserContextAttestationPolicyVersion:
              BROWSER_CONTEXT_ATTESTATION_POLICY_VERSION,
            browserFinalContextAttestationVersion:
              BROWSER_FINAL_MODEL_CONTEXT_ATTESTATION_VERSION,
            actorContextSourceDigests: await Promise.all(actorContext.map((item) =>
              sha256Hex(stableStringify({
                id: item.id,
                kind: item.kind,
                composerAuthority: item.composerAuthority ?? null,
                modelContextSource: item.modelContextSource ?? null,
              })))),
          }
          : {}),
        traditionalChineseNormalizerVersion:
          TRADITIONAL_CHINESE_NORMALIZER_VERSION,
        traditionalChineseSourceDigest:
          traditionalChineseNormalizationPolicy.sourceDigest,
        traditionalChineseProtectedTermsDigest:
          traditionalChineseNormalizationPolicy.protectedTermsDigest,
        traditionalChinesePolicyId:
          traditionalChineseNormalizationPolicy.policyId,
        browserComputePolicy: request.browserComputePolicy ?? null,
        allowPreAuthorizedClosedEscalation:
          request.allowPreAuthorizedClosedEscalation ?? false,
        generationOptions: {
          seed: request.generationOptions?.seed ?? null,
          temperature: request.generationOptions?.temperature ?? null,
          topP: request.generationOptions?.topP ?? null,
          maxTokens: request.generationOptions?.maxTokens ?? null,
          repetitionPenalty: request.generationOptions?.repetitionPenalty ?? null,
          substantiveScene: request.generationOptions?.substantiveScene ?? null,
          ...(request.generationOptions?.substantiveSceneBudget
            ? {
              substantiveSceneBudget:
                request.generationOptions.substantiveSceneBudget,
            }
            : {}),
        },
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
        ...(route.backend.id === "browser-ai"
          ? {
            actorContextSourceDigests: candidateInput.actorContextSourceDigests,
          }
          : {}),
        planDigest: candidateInput.planDigest,
        qualityMode: candidateInput.qualityMode,
        backendId: candidateInput.backendId,
        ...(route.backend.id === "browser-ai"
          ? {
            browserContextAttestationPolicyVersion:
              BROWSER_CONTEXT_ATTESTATION_POLICY_VERSION,
            browserFinalContextAttestationVersion:
              BROWSER_FINAL_MODEL_CONTEXT_ATTESTATION_VERSION,
          }
          : {}),
        traditionalChineseNormalizerVersion:
          candidateInput.traditionalChineseNormalizerVersion,
        traditionalChineseSourceDigest:
          candidateInput.traditionalChineseSourceDigest,
        traditionalChineseProtectedTermsDigest:
          candidateInput.traditionalChineseProtectedTermsDigest,
        traditionalChinesePolicyId: candidateInput.traditionalChinesePolicyId,
        browserComputePolicy: candidateInput.browserComputePolicy,
        allowPreAuthorizedClosedEscalation:
          candidateInput.allowPreAuthorizedClosedEscalation,
        generationOptions: candidateInput.generationOptions,
        learningConfiguration: candidateInput.learningConfiguration,
        toolResultDigests: candidateInput.toolResultDigests,
      }));
      const semanticText = `${request.taskType}\n${request.objective}`;
      const regenerationEvidence = await closedAgentRegenerationEvidence(requestInput);
      let execution: ClosedBackendExecutionResult;
      let candidateCacheHit = false;
      let cacheOrigin: ClosedAgentCacheOriginEvidence | null = null;
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
      if (request.regeneration || request.ephemeralPrompt) {
        executionStartedAt = this.now().toISOString();
        execution = await this.executeQualityPipeline({
          backend,
          routedBackend: route.backend,
          request,
          plan,
          actorContext,
          toolResults,
          traditionalChineseNormalizationPolicy,
        });
        executionCompletedAt = this.now().toISOString();
        assertClosedAIModelIdentity(route.backend, execution);
        this.emitProgress(
          request,
          "generating",
          request.ephemeralPrompt
            ? "敏感內部複核已略過提示與候選快取"
            : "已依明確重新生成要求略過舊候選快取",
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
          artifact: ClosedAgentCachedExecutionArtifact;
        }>(
          request.namespace,
          semanticText,
          learningSemanticThreshold(request.learningConfiguration),
          (entry) => Boolean(
            entry.value
            && typeof entry.value === "object"
            && (entry.value as { semanticContextDigest?: unknown })
              .semanticContextDigest === semanticContextDigest,
          ),
        );
        const semanticCached = (
          semanticLookup.hit
          && semanticLookup.entry?.value.taskType === request.taskType
          && semanticLookup.entry.value.qualityMode === plan.qualityMode
          && semanticLookup.entry.value.semanticContextDigest === semanticContextDigest
        ) ? await this.verifiedCachedExecution({
          layer: "semantic",
          entry: semanticLookup.entry,
          artifact: semanticLookup.entry.value.artifact,
          policy: traditionalChineseNormalizationPolicy,
          routedBackend: route.backend,
          currentNamespace: request.namespace,
        }) : null;
        if (semanticLookup.hit && semanticLookup.entry && !semanticCached) {
          await this.cache.repository.remove(semanticLookup.entry.id);
        }
        if (semanticCached) {
          execution = semanticCached.execution;
          cacheOrigin = semanticCached.cacheOrigin;
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
          const exactLookup = await this.cache.get<ClosedAgentCachedExecutionArtifact>(
            "exact",
            request.namespace,
            candidateInput,
          );
          const exactCached = exactLookup.hit && exactLookup.entry
            ? await this.verifiedCachedExecution({
              layer: "exact",
              entry: exactLookup.entry,
              artifact: exactLookup.entry.value,
              policy: traditionalChineseNormalizationPolicy,
              routedBackend: route.backend,
              currentNamespace: request.namespace,
            })
            : null;
          if (exactLookup.hit && exactLookup.entry && !exactCached) {
            await this.cache.repository.remove(exactLookup.entry.id);
          }
          if (exactCached) {
            execution = exactCached.execution;
            cacheOrigin = exactCached.cacheOrigin;
            assertClosedAIModelIdentity(route.backend, execution);
            candidateCacheHit = true;
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
          } else {
            executionStartedAt = this.now().toISOString();
            execution = await this.executeQualityPipeline({
              backend,
              routedBackend: route.backend,
              request,
              plan,
              actorContext,
              toolResults,
              traditionalChineseNormalizationPolicy,
            });
            executionCompletedAt = this.now().toISOString();
            assertClosedAIModelIdentity(route.backend, execution);
          }
        }
      }
      await assertClosedAgentTraditionalChineseIntegrity({
        execution,
        policy: traditionalChineseNormalizationPolicy,
      });
      if (request.taskType === "chapter.abcChoices") {
        const normalized = normalizeAbcChoicesExecutionContent(execution.content);
        if (!normalized.valid || normalized.content !== execution.content) {
          throw osError("ABC_CHOICES_INVALID_STRUCTURE", undefined, {
            extractedItemCount: normalized.extractedItemCount,
            materiallyDistinct: normalized.materiallyDistinct,
          });
        }
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
      const outputCharacters =
        execution.outputCharacters ?? execution.content.length;
      const executionReceipt: ClosedAgentVerifiedExecutionReceipt | null =
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
            traditionalChineseNormalization:
              execution.traditionalChineseNormalization,
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
            contextAttestation: execution.contextAttestation,
            finalModelContextAttestation:
              execution.finalModelContextAttestation,
          }
          : null;
      const candidateMetrics = candidateCacheHit
        ? {
          elapsedMs: 0,
          profileId: `${execution.backendId}-cache-origin-v1`,
          firstTokenMs: null,
          inputCharacters: 0,
          outputCharacters: 0,
          generatedTokenEvents: 0,
          omittedInputCharacters: 0,
        }
        : {
          elapsedMs: execution.elapsedMs,
          profileId: execution.profileId ?? `${execution.backendId}-default-v1`,
          firstTokenMs: execution.firstTokenMs ?? null,
          inputCharacters: execution.inputCharacters ?? 0,
          outputCharacters: execution.outputCharacters ?? execution.content.length,
          generatedTokenEvents: execution.generatedTokenEvents ?? 0,
          omittedInputCharacters: execution.omittedInputCharacters ?? 0,
        };
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
      const evaluation = await evaluateClosedAgentCandidate({
        request,
        execution,
        traditionalChineseNormalizationPolicy,
      });
      if (!evaluation.passed) {
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
      const updatedAt = this.now().toISOString();
      const candidate: ClosedAgentCandidate = {
        schemaVersion: CLOSED_AGENT_OS_SCHEMA_VERSION,
        kind: "candidate",
        id: candidateId,
        projectId: request.namespace.projectId,
        taskId: request.taskId,
        taskType: request.taskType,
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
        cacheOrigin,
        traditionalChineseNormalization:
          execution.traditionalChineseNormalization,
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
        planComplexity: plan.complexity,
        planDigest: plan.planDigest,
        planningBinding,
        requestContractDigest,
        applicationValidationBindingDigest:
          request.applicationValidationBindingDigest ?? null,
        evaluation,
        status: "awaiting-approval",
        candidateOnly: true,
        canonicalMutationCount: 0,
        regeneration: regenerationEvidence,
        generationTelemetry: {
          cacheHit: candidateCacheHit,
          profileId: candidateMetrics.profileId,
          elapsedMs: candidateMetrics.elapsedMs,
          firstTokenMs: candidateMetrics.firstTokenMs,
          inputCharacters: candidateMetrics.inputCharacters,
          outputCharacters: candidateMetrics.outputCharacters,
          generatedTokenEvents: candidateMetrics.generatedTokenEvents,
          omittedInputCharacters: candidateMetrics.omittedInputCharacters,
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
      if (request.validateBeforePersistence) {
        // The application validator receives a detached value and runs before
        // candidate-generated/evaluated, learning, state, or cache writes.  A
        // rejected echo therefore leaves only metadata-only task evidence; no
        // model output or hidden prompt can enter durable storage.
        await settleClosedAgentLeafOnAbort(
          request.signal,
          () => request.validateBeforePersistence!(structuredClone(candidate)),
        );
        if (request.signal?.aborted) {
          throw osError("CLOSED_AGENT_TASK_CANCELLED");
        }
        // Planner/tool learning is intentionally deferred until the application
        // gate accepts the model output. A rejected RPG/adult candidate must not
        // train the local learning store or leave prompt-derived cache entries.
        await recordPlannerLearning();
        for (const toolExecution of toolExecutions) {
          await this.recordOperationalLearningSignal({
            request,
            outcome: "tool_result",
            score: 1,
            tags: [
              "tool-success",
              `tool:${toolExecution.toolId}`,
              toolExecution.cacheHit ? "tool-cache-hit" : "tool-cache-miss",
            ],
            feature: {
              toolId: toolExecution.toolId,
              role: toolExecution.role,
              resultDigest: toolExecution.outputDigest,
            },
          });
        }
      }
      if (request.signal?.aborted) {
        throw osError("CLOSED_AGENT_TASK_CANCELLED");
      }
      const candidateGeneratedPayload = retainedCandidateGeneratedPayload(candidate);
      const candidateGeneratedResult = {
        elapsedMs: candidateMetrics.elapsedMs,
        dataLeftDevice: execution.dataLeftDevice,
        externalRequest: execution.externalRequest,
        cacheHit: candidateCacheHit,
        profileId: candidateMetrics.profileId,
        firstTokenMs: candidateMetrics.firstTokenMs,
        inputCharacters: candidateMetrics.inputCharacters,
        outputCharacters: candidateMetrics.outputCharacters,
        omittedInputCharacters: candidateMetrics.omittedInputCharacters,
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
      };
      const candidateGeneratedBlock = await appendOrReuseExactLedgerPayload({
        ledger: this.ledger,
        ledgerId: this.ledgerId(request),
        namespace: request.namespace,
        eventType: "candidate-generated",
        payload: candidateGeneratedPayload,
        retainContent: true,
        result: candidateGeneratedResult,
      });
      if (request.signal?.aborted) {
        throw osError("CLOSED_AGENT_TASK_CANCELLED");
      }
      const candidateEvaluatedPayload = retainedCandidateEvaluatedPayload(candidate);
      await appendOrReuseExactLedgerPayload({
        ledger: this.ledger,
        ledgerId: this.ledgerId(request),
        namespace: request.namespace,
        eventType: "candidate-evaluated",
        payload: candidateEvaluatedPayload,
        retainContent: true,
      });
      if (request.signal?.aborted) {
        throw osError("CLOSED_AGENT_TASK_CANCELLED");
      }
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
      task = {
        ...task,
        state: "awaiting-approval",
        updatedAt,
      };
      const verification = await this.ledger.verify(this.ledgerId(request));
      if (!verification.valid || !verification.headHash) {
        throw osError("CLOSED_AGENT_LEDGER_INTEGRITY_FAILED");
      }
      if (request.signal?.aborted) {
        throw osError("CLOSED_AGENT_TASK_CANCELLED");
      }
      await this.state.putMany([candidate, task]);
      if (
        !request.signal?.aborted
        && !candidateCacheHit
        && !request.regeneration
        && !request.ephemeralPrompt
        && executionReceipt
      ) {
        const artifact: ClosedAgentCachedExecutionArtifact = {
          schemaVersion: "closed-agent-cached-execution-v1",
          execution,
          originCandidateId: candidate.id,
          originTaskId: candidate.taskId,
          originLedgerId: this.ledgerId(request),
          originLedgerBlockHash: candidateGeneratedBlock.blockHash,
          originExecutionReceipt: executionReceipt,
        };
        try {
          await this.cache.put({
            layer: "exact",
            namespace: request.namespace,
            input: candidateInput,
            value: artifact,
            tags: ["closed-agent-candidate", `task:${request.taskType}`],
            ttlMs: learningCacheTtl(request.learningConfiguration, "exact"),
          });
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
              artifact,
            },
            tags: ["closed-agent-semantic-candidate", `task:${request.taskType}`],
            ttlMs: learningCacheTtl(request.learningConfiguration, "semantic"),
          });
        } catch {
          // Candidate/ledger/state are authoritative. Cache population is a
          // best-effort optimization and cannot roll back an accepted candidate.
        }
      }
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
          planHit: planCacheHit,
          bypassReason: cacheBypassReason,
        },
        learning: activeLearning,
        ledgerHeadHash: verification.headHash,
      };
    } catch (cause) {
      const code = safeClosedAgentTaskErrorCode(cause);
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
    return withClosedAgentCandidateDecisionLock(
      input.candidateId,
      () => this.approveCandidateInternal(input),
    );
  }

  private async approveCandidateInternal(input: ApprovalInput) {
    const candidate = await this.state.get<ClosedAgentCandidate>(input.candidateId);
    if (!candidate) throw osError("CLOSED_AGENT_CANDIDATE_NOT_FOUND");
    if (!input.humanApproved) throw osError("CLOSED_AGENT_HUMAN_APPROVAL_REQUIRED");
    if (!candidate.evaluation.passed || candidate.status !== "awaiting-approval") {
      throw osError("CLOSED_AGENT_APPROVAL_GATE_FAILED");
    }
    const candidateTask = await this.state.get<ClosedAgentTaskRecord>(candidate.taskId);
    if (
      candidateTask?.schemaVersion !== CLOSED_AGENT_OS_SCHEMA_VERSION
      || candidateTask.kind !== "task"
      || candidateTask.id !== candidate.taskId
      || candidateTask.projectId !== candidate.projectId
      || candidateTask.backendId !== candidate.backendId
      || candidateTask.requestContractDigest !== undefined
        && candidateTask.requestContractDigest !== candidate.requestContractDigest
      || candidateTask.state !== "awaiting-approval"
      || candidateTask.errorCode !== null
      || !sameClosedAINamespace(candidateTask.namespace, candidate.namespace)
    ) {
      throw osError("CLOSED_AGENT_APPROVAL_INTEGRITY_INVALID", undefined, {
        canonicalMutationCount: 0,
      });
    }
    if (!await this.hasVerifiedCandidateLedgerIntegrity(candidate)) {
      throw osError("CLOSED_AGENT_APPROVAL_INTEGRITY_INVALID", undefined, {
        canonicalMutationCount: 0,
      });
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
    const learningReceipt = await this.recordLearningOutcome({
      candidate: updatedCandidate,
      outcome: canonicalCommitId ? "approved_canon" : "accepted",
      sourceApprovalId: approvalId,
    });
    const { ledgerBlockHash: _ledgerBlockHash, ...learningSignal } = learningReceipt;
    void _ledgerBlockHash;
    return {
      approval,
      memory,
      candidate: updatedCandidate,
      canonicalMutationCount: updatedCandidate.canonicalMutationCount,
      learningSignal,
    };
  }

  rejectCandidate(candidateId: string) {
    return withClosedAgentCandidateDecisionLock(
      candidateId,
      () => this.rejectCandidateInternal(candidateId),
    );
  }

  async resumePendingRejections(projectId: string) {
    const pending = (await this.state.list<ClosedAgentRejectionRecord>(
      projectId,
      "rejection",
    )).filter((record) => record.status === "pending");
    let completed = 0;
    for (const snapshot of pending) {
      await withClosedAgentCandidateDecisionLock(snapshot.candidateId, async () => {
        const [candidate, record] = await Promise.all([
          this.state.get<ClosedAgentCandidate>(snapshot.candidateId),
          this.state.get<ClosedAgentRejectionRecord>(snapshot.id),
        ]);
        if (!candidate || !record) {
          throw osError("CLOSED_AGENT_REJECTION_RECOVERY_STATE_MISSING");
        }
        await this.assertRejectionRecord(candidate, record);
        if (record.status === "pending") {
          await this.resumeRejectedCandidate(candidate, record);
          completed += 1;
        }
      });
    }
    return { pending: pending.length, completed };
  }

  private async rejectCandidateInternal(candidateId: string) {
    let candidate = await this.state.get<ClosedAgentCandidate>(candidateId);
    if (!candidate) throw osError("CLOSED_AGENT_CANDIDATE_NOT_FOUND");
    const recordId = await this.rejectionRecordId(candidate.id);
    let rejection = await this.state.get<ClosedAgentRejectionRecord>(recordId);
    if (candidate.status === "rejected" && !rejection) {
      if (!await this.hasVerifiedCandidateLedgerIntegrity(candidate, true, true)) {
        throw osError("CLOSED_AGENT_REJECTION_CANDIDATE_INTEGRITY_FAILED");
      }
      if (candidate.taskType !== undefined) {
        throw osError("CLOSED_AGENT_REJECTION_RECORD_MISSING");
      }
      // Legacy rejected candidates predate the durable outbox. Their cache
      // sweep cannot be reconstructed, but their learning receipt remains
      // causation-idempotent and read-compatible.
      await this.ensureRejectedLearningOutcome(candidate, undefined, true);
      return candidate;
    }
    if (candidate.status !== "awaiting-approval" && candidate.status !== "rejected") {
      throw osError("CLOSED_AGENT_REJECTION_GATE_FAILED");
    }
    if (!rejection) {
      if (!await this.hasVerifiedCandidateLedgerIntegrity(candidate, false, true)) {
        throw osError("CLOSED_AGENT_REJECTION_CANDIDATE_INTEGRITY_FAILED");
      }
      const ledgerId = `closed-agent:${candidate.projectId}:${candidate.taskId}`;
      const approvalAlreadyStarted = (await this.ledger.repository.list(ledgerId))
        .some((block) => block.eventType === "approval-signed" && block.signature);
      if (approvalAlreadyStarted) {
        throw osError("CLOSED_AGENT_REJECTION_APPROVAL_ALREADY_STARTED");
      }
      const task = await this.state.get<ClosedAgentTaskRecord>(candidate.taskId);
      if (
        !task
        || task.kind !== "task"
        || task.id !== candidate.taskId
        || task.projectId !== candidate.projectId
        || !sameClosedAINamespace(task.namespace, candidate.namespace)
        || task.state !== "awaiting-approval"
        || (candidate.taskType !== undefined && task.taskType !== candidate.taskType)
      ) {
        throw osError("CLOSED_AGENT_REJECTION_TASK_INTEGRITY_FAILED");
      }
      const rejectionTaskType = candidate.taskType ?? task.taskType;
      const invalidation = this.rejectionCacheInvalidation(candidate, rejectionTaskType);
      const cacheEntryIds = await this.cache.planInvalidation(invalidation);
      const claimId = await sha256Hex(stableStringify({
        domain: "closed-agent-rejection-claim-v1",
        nonce: crypto.randomUUID(),
      }));
      const [
        namespaceDigest,
        cacheCausationId,
        learningCausationId,
      ] = await Promise.all([
        closedAINamespaceDigest(candidate.namespace),
        this.rejectionCausationId(candidate.id, "cache"),
        this.rejectionCausationId(candidate.id, "learning"),
      ]);
      const cachePlanDigest = await sha256Hex(stableStringify({
        domain: "closed-agent-rejection-cache-plan-v1",
        candidateId: candidate.id,
        taskId: candidate.taskId,
        taskType: rejectionTaskType,
        namespaceDigest,
        claimId,
        layers: ["exact", "semantic"],
        cacheEntryIds,
      }));
      const startedAt = this.now().toISOString();
      rejection = {
        schemaVersion: CLOSED_AGENT_OS_SCHEMA_VERSION,
        kind: "rejection",
        id: recordId,
        projectId: candidate.projectId,
        namespace: structuredClone(candidate.namespace),
        namespaceDigest,
        candidateId: candidate.id,
        claimId,
        taskId: candidate.taskId,
        taskType: rejectionTaskType,
        candidateContentDigest: candidate.contentDigest,
        requestContractDigest: candidate.requestContractDigest,
        cacheEntryIds,
        cachePlanDigest,
        cacheCausationId,
        learningCausationId,
        learningResult: null,
        status: "pending",
        cacheLedgerBlockHash: null,
        learningLedgerBlockHash: null,
        startedAt,
        completedAt: null,
        rawPromptStored: false,
        rawOutputStored: false,
        rawChainOfThoughtStored: false,
        canonicalMutationCount: 0,
      };
      candidate = {
        ...candidate,
        status: "rejected",
        updatedAt: startedAt,
      };
      // Candidate rejection and its replay plan share one state transaction.
      // A fault at either write rolls both back before cache/ledger mutation.
      await this.state.putMany([candidate, rejection]);
    }
    await this.assertRejectionRecord(candidate, rejection);
    return this.resumeRejectedCandidate(candidate, rejection);
  }

  private rejectionCacheInvalidation(
    candidate: ClosedAgentCandidate,
    taskType: ClosedAgentTaskRecord["taskType"] | null,
  ): ClosedAICacheInvalidation {
    return {
      ...candidate.namespace,
      layers: ["exact", "semantic"],
      ...(taskType ? { tags: [`task:${taskType}`] } : {}),
    };
  }

  private rejectionCacheLedgerPayload(record: ClosedAgentRejectionRecord) {
    return {
      reason: "candidate-rejected",
      claimId: record.claimId,
      layers: ["exact", "semantic"],
      taskType: record.taskType,
      cachePlanDigest: record.cachePlanDigest,
      plannedAtClaimCount: record.cacheEntryIds.length,
      verifiedAbsentCount: record.cacheEntryIds.length,
      sweepCompleted: true,
      originReuseBlockedByRejectedState: true,
      canonicalMutationCount: 0,
    };
  }

  private async rejectionRecordId(candidateId: string) {
    return `closed-agent-rejection:${await sha256Hex(stableStringify({
      domain: "closed-agent-rejection-record-v1",
      candidateId,
    }))}`;
  }

  private async rejectionCausationId(
    candidateId: string,
    effect: "cache" | "learning",
  ) {
    return sha256Hex(stableStringify({
      domain: effect === "cache"
        ? "closed-agent-rejected-cache-invalidation-v1"
        : "closed-agent-rejected-learning-outcome-v1",
      candidateId,
      outcome: "rejected",
    }));
  }

  private async assertRejectionRecord(
    candidate: ClosedAgentCandidate,
    record: ClosedAgentRejectionRecord,
  ) {
    const [
      expectedId,
      namespaceDigest,
      cacheCausationId,
      learningCausationId,
    ] = await Promise.all([
      this.rejectionRecordId(candidate.id),
      closedAINamespaceDigest(candidate.namespace),
      this.rejectionCausationId(candidate.id, "cache"),
      this.rejectionCausationId(candidate.id, "learning"),
    ]);
    const cachePlanDigest = await sha256Hex(stableStringify({
      domain: "closed-agent-rejection-cache-plan-v1",
      candidateId: candidate.id,
      taskId: candidate.taskId,
      taskType: record.taskType,
      namespaceDigest,
      claimId: record.claimId,
      layers: ["exact", "semantic"],
      cacheEntryIds: record.cacheEntryIds,
    }));
    const validIso = (value: string) => Number.isFinite(Date.parse(value))
      && new Date(value).toISOString() === value;
    const completed = record.status === "completed";
    const learningPayload = record.learningResult === null
      ? null
      : this.rejectionLearningPayload(
        candidate,
        record.learningResult,
        record.claimId,
      );
    const learningPayloadDigest = learningPayload === null
      ? null
      : await sha256Hex(stableStringify(learningPayload));
    const learningResult = record.learningResult;
    const validLearningResult = learningResult === null || (
      Object.keys(learningResult).sort().join(",")
        === [
          "collected",
          "experienceId",
          "featureDigest",
          "payloadDigest",
          "reasonCode",
          "resultDigest",
        ].join(",")
      && isCryptographicClosedAIModelDigest(learningResult.payloadDigest)
      && learningResult.payloadDigest === learningPayloadDigest
      && (learningResult.collected
        ? /^learning-experience:[a-f0-9]{64}$/u.test(learningResult.experienceId ?? "")
          && isCryptographicClosedAIModelDigest(learningResult.featureDigest)
          && isCryptographicClosedAIModelDigest(learningResult.resultDigest)
          && learningResult.reasonCode === null
        : learningResult.experienceId === null
          && learningResult.featureDigest === null
          && learningResult.resultDigest === null
          && typeof learningResult.reasonCode === "string"
          && /^CONTROLLED_LEARNING_[A-Z0-9_]{1,80}$/u.test(learningResult.reasonCode))
    );
    if (
      Object.keys(record).sort().join(",")
        !== [...CLOSED_AGENT_REJECTION_RECORD_KEYS].sort().join(",")
      || record.schemaVersion !== CLOSED_AGENT_OS_SCHEMA_VERSION
      || record.kind !== "rejection"
      || (record.status !== "pending" && record.status !== "completed")
      || record.id !== expectedId
      || record.projectId !== candidate.projectId
      || candidate.status !== "rejected"
      || candidate.updatedAt !== record.startedAt
      || record.candidateId !== candidate.id
      || !isCryptographicClosedAIModelDigest(record.claimId)
      || record.taskId !== candidate.taskId
      || record.candidateContentDigest !== candidate.contentDigest
      || record.requestContractDigest !== candidate.requestContractDigest
      || record.namespaceDigest !== namespaceDigest
      || !sameClosedAINamespace(record.namespace, candidate.namespace)
      || record.cacheCausationId !== cacheCausationId
      || record.learningCausationId !== learningCausationId
      || record.cachePlanDigest !== cachePlanDigest
      || (candidate.taskType !== undefined && record.taskType !== candidate.taskType)
      || !validLearningResult
      || (completed && learningResult === null)
      || (record.taskType !== null && (
        record.taskType.length < 3
        || record.taskType.length > 120
        || !/^[A-Za-z0-9._:-]+$/u.test(record.taskType)
      ))
      || record.cacheEntryIds.length > 1_000
      || new Set(record.cacheEntryIds).size !== record.cacheEntryIds.length
      || record.cacheEntryIds.some((id) => (
        !/^(?:exact|semantic):[a-f0-9]{64}:[a-f0-9]{64}$/u.test(id)
      ))
      || record.cacheEntryIds.some((id, index) => (
        index > 0 && record.cacheEntryIds[index - 1] >= id
      ))
      || !validIso(record.startedAt)
      || (completed
        ? !record.completedAt
          || !validIso(record.completedAt)
          || record.completedAt < record.startedAt
          || !isCryptographicClosedAIModelDigest(record.cacheLedgerBlockHash)
          || !isCryptographicClosedAIModelDigest(record.learningLedgerBlockHash)
        : record.completedAt !== null
          || record.cacheLedgerBlockHash !== null
          || record.learningLedgerBlockHash !== null)
      || record.rawPromptStored !== false
      || record.rawOutputStored !== false
      || record.rawChainOfThoughtStored !== false
      || record.canonicalMutationCount !== 0
    ) {
      throw osError("CLOSED_AGENT_REJECTION_RECORD_INVALID");
    }
  }

  private async resumeRejectedCandidate(
    candidate: ClosedAgentCandidate,
    record: ClosedAgentRejectionRecord,
  ) {
    if (!await this.hasVerifiedCandidateLedgerIntegrity(candidate, true, true)) {
      throw osError("CLOSED_AGENT_REJECTION_CANDIDATE_INTEGRITY_FAILED");
    }
    let currentRecord = record;
    const ledgerId = `closed-agent:${candidate.projectId}:${candidate.taskId}`;
    if (record.status === "completed") {
      if (!await this.hasVerifiedCompletedRejectionRecord(candidate, record)) {
        throw osError("CLOSED_AGENT_REJECTION_RECORD_LEDGER_MISMATCH");
      }
      return candidate;
    }
    const invalidation = this.rejectionCacheInvalidation(candidate, record.taskType);
    await this.cache.invalidatePlanned(invalidation, record.cacheEntryIds);
    const cacheBlock = await this.ledger.append({
      ledgerId,
      namespace: candidate.namespace,
      eventType: "cache-invalidated",
      payload: this.rejectionCacheLedgerPayload(record),
      lineage: { causationId: record.cacheCausationId },
    });
    if (currentRecord.learningResult === null) {
      currentRecord = {
        ...currentRecord,
        learningResult: await this.createRejectedLearningResult(
          candidate,
          currentRecord.learningCausationId,
          currentRecord.taskType ?? "learning.preferenceReview",
          currentRecord.claimId,
        ),
      };
      await this.assertRejectionRecord(candidate, currentRecord);
      await this.state.put(currentRecord);
    }
    const learningBlock = await this.ensureRejectedLearningOutcome(
      candidate,
      currentRecord.learningCausationId,
      false,
      currentRecord.taskType,
      currentRecord.learningResult ?? undefined,
      currentRecord.claimId,
    );
    if (
      currentRecord.cacheLedgerBlockHash !== null
      && currentRecord.cacheLedgerBlockHash !== cacheBlock.blockHash
      || currentRecord.learningLedgerBlockHash !== null
      && currentRecord.learningLedgerBlockHash !== learningBlock.blockHash
    ) {
      throw osError("CLOSED_AGENT_REJECTION_RECORD_LEDGER_MISMATCH");
    }
    if (
      cacheBlock.timestamp < currentRecord.startedAt
      || learningBlock.timestamp < currentRecord.startedAt
      || cacheBlock.sequence >= learningBlock.sequence
    ) {
      throw osError("LEDGER_CAUSATION_PRESEEDED");
    }
    const completed: ClosedAgentRejectionRecord = {
      ...currentRecord,
      status: "completed",
      cacheLedgerBlockHash: cacheBlock.blockHash,
      learningLedgerBlockHash: learningBlock.blockHash,
      completedAt: currentRecord.completedAt ?? this.now().toISOString(),
    };
    await this.assertRejectionRecord(candidate, completed);
    if (!(await this.ledger.verify(ledgerId)).valid) {
      throw osError("CLOSED_AGENT_REJECTION_RECORD_LEDGER_MISMATCH");
    }
    await this.state.put(completed);
    return candidate;
  }

  private async hasVerifiedCompletedRejectionRecord(
    candidate: ClosedAgentCandidate,
    record: ClosedAgentRejectionRecord,
  ) {
    try {
      await this.assertRejectionRecord(candidate, record);
    } catch {
      return false;
    }
    if (record.status !== "completed" || record.learningResult === null) return false;
    const ledgerId = `closed-agent:${candidate.projectId}:${candidate.taskId}`;
    const [verification, blocks, cacheEntries, expectedCachePayloadDigest] = await Promise.all([
      this.ledger.verify(ledgerId),
      this.ledger.repository.list(ledgerId),
      Promise.all(record.cacheEntryIds.map((id) => this.cache.repository.get(id))),
      sha256Hex(stableStringify(this.rejectionCacheLedgerPayload(record))),
    ]);
    const cacheBlocks = blocks.filter((block) => (
      block.eventType === "cache-invalidated"
      && block.lineage?.causationId === record.cacheCausationId
    ));
    const learningBlocks = blocks.filter((block) => (
      block.eventType === "learning-experience"
      && block.lineage?.causationId === record.learningCausationId
    ));
    return verification.valid
      && cacheBlocks.length === 1
      && learningBlocks.length === 1
      && cacheBlocks[0].blockHash === record.cacheLedgerBlockHash
      && cacheBlocks[0].payloadDigest === expectedCachePayloadDigest
      && learningBlocks[0].blockHash === record.learningLedgerBlockHash
      && learningBlocks[0].payloadDigest === record.learningResult.payloadDigest
      && cacheBlocks[0].timestamp >= record.startedAt
      && learningBlocks[0].timestamp >= record.startedAt
      && cacheBlocks[0].sequence < learningBlocks[0].sequence
      && cacheEntries.every((entry) => entry === null);
  }

  private rejectionLearningPayload(
    candidate: ClosedAgentCandidate,
    result: Pick<
      NonNullable<ClosedAgentRejectionRecord["learningResult"]>,
      "collected" | "experienceId" | "featureDigest" | "resultDigest" | "reasonCode"
    >,
    claimId?: string,
  ) {
    return {
      candidateId: candidate.id,
      ...(claimId ? { claimId } : {}),
      outcome: "rejected" as const,
      collected: result.collected,
      experienceId: result.experienceId,
      featureDigest: result.featureDigest,
      resultDigest: result.resultDigest,
      reasonCode: result.reasonCode,
      rawInputStored: false,
      rawOutputStored: false,
      rawChainOfThoughtStored: false,
    };
  }

  private async createRejectedLearningResult(
    candidate: ClosedAgentCandidate,
    causationId: string,
    taskType: ClosedAgentTaskRecord["taskType"],
    claimId: string,
  ): Promise<NonNullable<ClosedAgentRejectionRecord["learningResult"]>> {
    const collection = await this.collectCandidateLearningOutcome({
      candidate,
      outcome: "rejected",
      sourceApprovalId: null,
      causationId,
      taskType,
    });
    const result = collection.collected
      ? {
        collected: true,
        experienceId: collection.experience.id,
        featureDigest: collection.experience.featureDigest,
        resultDigest: collection.experience.resultDigest,
        reasonCode: null,
      }
      : {
        collected: false,
        experienceId: null,
        featureDigest: null,
        resultDigest: null,
        reasonCode: collection.reasonCode,
      };
    return {
      ...result,
      payloadDigest: await sha256Hex(stableStringify(
        this.rejectionLearningPayload(candidate, result, claimId),
      )),
    };
  }

  private async ensureRejectedLearningOutcome(
    candidate: ClosedAgentCandidate,
    knownCausationId?: string,
    allowLegacyExisting = false,
    frozenTaskType?: ClosedAgentRejectionRecord["taskType"],
    frozenLearningResult?: NonNullable<ClosedAgentRejectionRecord["learningResult"]>,
    claimId?: string,
  ): Promise<VerifiableLedgerBlock> {
    const ledgerId = `closed-agent:${candidate.projectId}:${candidate.taskId}`;
    const causationId = knownCausationId
      ?? await this.rejectionCausationId(candidate.id, "learning");
    const existing = (await this.ledger.repository.list(ledgerId)).filter((block) => (
      block.eventType === "learning-experience"
      && block.lineage?.causationId === causationId
    ));
    if (existing.length > 1) {
      throw osError("CLOSED_AGENT_LEARNING_OUTCOME_DUPLICATED");
    }
    if (allowLegacyExisting && existing.length === 1) return existing[0];
    if (frozenLearningResult) {
      const payload = this.rejectionLearningPayload(
        candidate,
        frozenLearningResult,
        claimId,
      );
      if (
        frozenLearningResult.payloadDigest
          !== await sha256Hex(stableStringify(payload))
      ) {
        throw osError("CLOSED_AGENT_REJECTION_LEARNING_RESULT_INVALID");
      }
      const block = await this.ledger.append({
        ledgerId,
        namespace: candidate.namespace,
        eventType: "learning-experience",
        payload,
        lineage: { causationId },
      });
      const recorded = (await this.ledger.repository.list(ledgerId)).filter((item) => (
        item.eventType === "learning-experience"
        && item.lineage?.causationId === causationId
      ));
      if (recorded.length !== 1 || recorded[0].blockHash !== block.blockHash) {
        throw osError("CLOSED_AGENT_LEARNING_OUTCOME_LEDGER_INVALID");
      }
      return recorded[0];
    }
    const learning = await this.recordLearningOutcome({
      candidate,
      outcome: "rejected",
      sourceApprovalId: null,
      causationId,
      ...(frozenTaskType !== undefined
        ? { taskType: frozenTaskType ?? "learning.preferenceReview" }
        : {}),
    });
    if (!learning.ledgerRecorded || !learning.ledgerBlockHash) {
      throw osError("CLOSED_AGENT_LEARNING_OUTCOME_LEDGER_PENDING");
    }
    const recorded = (await this.ledger.repository.list(ledgerId)).filter((block) => (
      block.eventType === "learning-experience"
      && block.lineage?.causationId === causationId
    ));
    if (recorded.length !== 1 || recorded[0].blockHash !== learning.ledgerBlockHash) {
      throw osError("CLOSED_AGENT_LEARNING_OUTCOME_LEDGER_INVALID");
    }
    return recorded[0];
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
    await this.resumePendingRejections(projectId);
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
    traditionalChineseNormalizationPolicy: TraditionalChineseNormalizationPolicy;
  }): Promise<ClosedBackendExecutionResult> {
    const {
      backend,
      routedBackend,
      request,
      plan,
      actorContext,
      toolResults,
      traditionalChineseNormalizationPolicy,
    } = input;
    const passResults: ClosedBackendRawExecutionResult[] = [];
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
        taskId:
          `${request.taskId}:quality:${qualityPhase}:${passDigest.slice(0, 32)}`,
        onProgress: (event) => {
          if (request.signal?.aborted) return;
          const ratio = Math.max(0, Math.min(1, event.percent / 100));
          try {
            request.onProgress?.({
              taskId: request.taskId,
              phase: range.phase,
              label: `${range.label}｜${event.label}`,
              percent: Math.round(range.start + (range.end - range.start) * ratio),
              occurredAt: event.occurredAt,
              backendId: event.backendId,
              generatedCharacters: event.generatedCharacters,
              generatedTokenEvents: event.generatedTokenEvents,
              cacheHit: event.cacheHit,
            });
          } catch {
            // The quality transaction is not controlled by UI observers.
          }
        },
      };
      const result = await settleClosedAgentLeafOnAbort(
        request.signal,
        () => backend.execute({
          request: passRequest,
          plan,
          actorContext,
          toolResults,
          qualityPhase,
          workingMaterials,
        }),
      );
      if ((result as ClosedBackendRawExecutionResult & {
        traditionalChineseNormalization?: unknown;
      }).traditionalChineseNormalization) {
        throw osError(
          "CLOSED_AGENT_PROVIDER_NORMALIZATION_NOT_DEFERRED",
          undefined,
          { canonicalMutationCount: 0 },
        );
      }
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
      if (result.backendId === "browser-ai") {
        const contextAttestation = result.contextAttestation;
        const attestation = result.finalModelContextAttestation;
        if (!contextAttestation) {
          throw osError("BROWSER_FINAL_CONTEXT_PROOF_REQUIRED", undefined, {
            qualityPhase,
            canonicalMutationCount: 0,
          });
        }
        const attestationVerified = await hasVerifiedBrowserModelContextAttestation({
          backendId: result.backendId,
          modelId: result.modelId,
          modelDigest: result.modelDigest,
          contextAttestation,
          attestation,
        });
        const requiredBindingInvalid = contextAttestation === "required"
          && (
            !attestation
            || attestation.outerRequestIdDigest
              !== await sha256Hex(passRequest.taskId)
            || attestation.outerTaskType !== request.taskType
            || attestation.outerQualityPhase !== qualityPhase
          );
        const proofFreeBindingInvalid = contextAttestation === "not_required"
          && (
            result.modelId !== BROWSER_TASK_MODEL.modelId
            || result.modelDigest !== BROWSER_TASK_MODEL.modelDigest
            || result.finalModelContextAttestation !== undefined
          );
        if (
          !attestationVerified
          || requiredBindingInvalid
          || proofFreeBindingInvalid
        ) {
          throw osError("BROWSER_FINAL_CONTEXT_BINDING_MISMATCH", undefined, {
            qualityPhase,
            canonicalMutationCount: 0,
          });
        }
      } else if (
        result.contextAttestation !== undefined
        || result.finalModelContextAttestation !== undefined
      ) {
        throw osError("BROWSER_FINAL_CONTEXT_BINDING_MISMATCH", undefined, {
          qualityPhase,
          canonicalMutationCount: 0,
        });
      }
      const adapterId = result.adapterId ?? null;
      const adapterDigest = result.adapterDigest ?? null;
      if (
        (adapterId === null) !== (adapterDigest === null)
        || adapterId !== null && (
          adapterId.length === 0
          || adapterId.length > 192
          || !isCryptographicClosedAIModelDigest(adapterDigest)
        )
      ) {
        throw osError("CLOSED_AI_QUALITY_ADAPTER_IDENTITY_INVALID", undefined, {
          qualityPhase,
        });
      }
      if (!result.content.trim()) {
        throw osError("CLOSED_AGENT_QUALITY_PASS_EMPTY", undefined, {
          qualityPhase,
        });
      }
      const outputSafetyCode = closedOutputSafetyCode(result.content);
      if (outputSafetyCode) {
        throw osError("CLOSED_AGENT_QUALITY_PASS_UNSAFE", undefined, {
          qualityPhase,
          qualityReasonCodes: [closedOutputSafetyReasonCode(outputSafetyCode)],
          canonicalMutationCount: 0,
        });
      }
      const first = passResults[0];
      if (
        first
        && (
          result.backendId !== first.backendId
          || result.modelId !== first.modelId
          || result.modelDigest !== first.modelDigest
          || adapterId !== (first.adapterId ?? null)
          || adapterDigest !== (first.adapterDigest ?? null)
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
    let critic: ClosedBackendRawExecutionResult | null = null;
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
    const { normalizeTraditionalChineseWithIntegrity } =
      await loadTraditionalChineseRuntime();
    let normalizedSelected;
    try {
      normalizedSelected = await normalizeTraditionalChineseWithIntegrity({
        value: selectedContent,
        policy: traditionalChineseNormalizationPolicy,
        requestId: request.taskId,
        providerId: selected.backendId,
        modelId: selected.modelId,
        modelDigest: selected.modelDigest,
        inputStage: "closed-agent-final-selected-content",
      });
    } catch {
      throw osError("CLOSED_AGENT_TRADITIONAL_CHINESE_INTEGRITY_INVALID", undefined, {
        canonicalMutationCount: 0,
      });
    }
    return {
      ...selected,
      adapterId: selected.adapterId ?? draft.adapterId ?? null,
      adapterDigest: selected.adapterDigest ?? draft.adapterDigest ?? null,
      content: normalizedSelected.content,
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
      draftDigest: null,
      criticDigest: null,
      traditionalChineseNormalization: normalizedSelected.integrity,
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
    if (request.signal?.aborted) return;
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
        const executeTool = () => settleClosedAgentLeafOnAbort(
          request.signal,
          () => tool.execute({
            namespace: request.namespace,
            taskId: request.taskId,
            taskType: request.taskType,
            objective: request.objective,
            approvedContext,
            payload: { taskType: request.taskType },
            signal: request.signal,
          }),
        );
        // acceptance-checklist can contain strict rules excerpted from the
        // objective. A hidden fallback review therefore executes tools only in
        // memory so no draft sentence can reach the tool-result cache.
        const cacheResult = request.ephemeralPrompt || request.validateBeforePersistence
          ? { value: await executeTool(), cacheHit: false }
          : await this.cache.compute(
            "tool-result",
            request.namespace,
            {
              toolId,
              taskId: request.taskId,
              objectiveDigest,
              learningConfiguration: request.learningConfiguration ?? {},
            },
            executeTool,
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
        if (!request.validateBeforePersistence) {
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
        }
      } catch (cause) {
        if (!request.validateBeforePersistence) {
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
        }
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

  private async collectCandidateLearningOutcome(input: {
    candidate: ClosedAgentCandidate;
    outcome: ControlledLearningOutcome;
    sourceApprovalId: string | null;
    causationId?: string;
    taskType?: ClosedAgentTaskRecord["taskType"];
  }) {
    const task = input.taskType === undefined
      ? await this.state.get<ClosedAgentTaskRecord>(input.candidate.taskId)
      : null;
    const taskType = input.taskType ?? task?.taskType ?? "learning.preferenceReview";
    return this.learning.collectExperienceIfConsented({
      namespace: input.candidate.namespace,
      outcome: input.outcome,
      taskType,
      featureText: stableStringify({
        taskType,
        backendId: input.candidate.backendId,
        planDigest: input.candidate.planDigest,
      }),
      resultText: input.candidate.content,
      score: input.candidate.evaluation.score,
      tags: [
        `backend:${input.candidate.backendId}`,
        `task:${taskType}`,
        `outcome:${input.outcome}`,
      ],
      sourceApprovalId: input.sourceApprovalId,
      ...(input.causationId
        ? {
          idempotencyKey: input.causationId,
          idempotencyCreatedAt: input.candidate.createdAt,
        }
          : {}),
    });
  }

  private async recordLearningOutcome(input: {
    candidate: ClosedAgentCandidate;
    outcome: ControlledLearningOutcome;
    sourceApprovalId: string | null;
    causationId?: string;
    taskType?: ClosedAgentTaskRecord["taskType"];
  }) {
    const collection = await this.collectCandidateLearningOutcome(input);
    const ledgerId = `closed-agent:${input.candidate.projectId}:${input.candidate.taskId}`;
    if (input.causationId) {
      const block = await this.ledger.append({
        ledgerId,
        namespace: input.candidate.namespace,
        eventType: "learning-experience",
        payload: {
          candidateId: input.candidate.id,
          outcome: input.outcome,
          collected: collection.collected,
          experienceId: collection.collected ? collection.experience.id : null,
          featureDigest: collection.collected
            ? collection.experience.featureDigest
            : null,
          resultDigest: collection.collected
            ? collection.experience.resultDigest
            : null,
          reasonCode: collection.collected ? null : collection.reasonCode,
          rawInputStored: false,
          rawOutputStored: false,
          rawChainOfThoughtStored: false,
        },
        lineage: { causationId: input.causationId },
      });
      return {
        ...collection,
        ledgerRecorded: true,
        ledgerErrorCode: null,
        ledgerBlockHash: block.blockHash,
      };
    }
    if (!collection.collected) {
      return {
        ...collection,
        ledgerRecorded: false,
        ledgerErrorCode: null,
        ledgerBlockHash: null,
      };
    }
    try {
      const block = await this.ledger.append({
        ledgerId,
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
        ledgerBlockHash: block.blockHash,
      };
    } catch {
      return {
        ...collection,
        ledgerRecorded: false,
        ledgerErrorCode: "CONTROLLED_LEARNING_LEDGER_APPEND_FAILED",
        ledgerBlockHash: null,
      };
    }
  }

  private ledgerId(request: ClosedAgentTaskRequest) {
    return `closed-agent:${request.namespace.projectId}:${request.taskId}`;
  }

  private async hasVerifiedTaskAcceptedRequestContract(
    request: ClosedAgentTaskRequest,
    requestContractDigest: string,
  ) {
    const ledgerId = this.ledgerId(request);
    const [verification, blocks, namespaceDigest, payloadDigest] = await Promise.all([
      this.ledger.verify(ledgerId),
      this.ledger.repository.list(ledgerId),
      closedAINamespaceDigest(request.namespace),
      closedAgentTaskAcceptedPayload(request, requestContractDigest)
        .then((payload) => sha256Hex(stableStringify(payload))),
    ]);
    const exact = blocks.filter((block) => (
      block.eventType === "task-accepted"
      && block.namespaceDigest === namespaceDigest
      && block.payloadDigest === payloadDigest
    ));
    return verification.valid && exact.length === 1;
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
      closedAgentSchemaVersion: CLOSED_AGENT_OS_SCHEMA_VERSION,
      taskId: request.taskId,
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

import type {
  PlatformAIRequest,
  PlatformAIResult,
  PlatformRouterDecision,
} from "../../router/platform-types";
import { sha256Hex } from "../../closed-ai-cache";
import { isCryptographicClosedAIModelDigest } from "../../closed-agent-os/types";
import type { ClosedAgentBrowserRuntimeEvidence } from "../../closed-agent-os/safe-runtime-diagnostics";
import {
  BROWSER_LANGUAGE_MODEL_ID,
  detectBrowserAI,
  getBrowserAIInferenceProof,
  runBrowserAI,
  type BrowserAIExecutionOptions,
  type BrowserAIStreamProgress,
} from "./browser-ai-provider";
import {
  composeBrowserContextPack,
  type BrowserContextSource,
} from "./browser-context-compressor";
import { readBrowserDeviceBenchmark } from "./browser-device-benchmark";
import {
  createBrowserExecutionReceipt,
  recordBrowserExecutionReceipt,
  type BrowserExecutionReceipt,
} from "./browser-offload-metrics";
import {
  resolveBrowserAIPerformancePolicy,
  estimateBrowserTokens,
} from "./browser-performance-policy";
import { evaluateBrowserCandidateQuality } from "./browser-quality-gate";
import {
  browserEligibilityContextTokens,
  resolveBrowserTaskEligibility,
  type BrowserTaskEligibility,
} from "./browser-task-eligibility";
import {
  browserSemanticRuntimeSnapshot,
  rankWithBrowserSemanticModel,
} from "./browser-semantic-runtime";
import { browserWebLLMRuntimeSnapshot } from "./browser-webllm-runtime";
import {
  assessBrowserProseCompletion,
  BROWSER_PROSE_MAXIMUM_CODE_POINTS,
  BROWSER_PROSE_MAXIMUM_ESTIMATED_TOKENS,
  BROWSER_PROSE_MAXIMUM_HAN_CHARACTERS,
  BROWSER_PROSE_MINIMUM_CONTINUATION_BASE_HAN_CHARACTERS,
  BROWSER_PROSE_MINIMUM_HAN_CHARACTERS,
  browserProseSafetyCode,
  buildBrowserProseContinuationSeed,
  mergeBrowserProseContinuation,
  shouldEnforceDefaultBrowserProseContract,
  shouldRunBrowserProseExtension,
  type BrowserProseSafetyCode,
} from "./browser-prose-extension";
import {
  BROWSER_WEBLLM_MODELS,
  browserWebLLMModel,
} from "./webllm-model-registry";

export const BROWSER_COMPUTE_ORCHESTRATOR_VERSION =
  "browser-compute-orchestrator-v2" as const;

export { executeBrowserDeterministicOperation } from "./browser-deterministic-runtime";

export type BrowserComputeExecution = {
  schemaVersion: typeof BROWSER_COMPUTE_ORCHESTRATOR_VERSION;
  result: PlatformAIResult;
  eligibility: BrowserTaskEligibility;
  quality: ReturnType<typeof evaluateBrowserCandidateQuality>;
  receipt: BrowserExecutionReceipt;
  contextMetrics: {
    originalContextTokens: number;
    browserCompressedContextTokens: number;
    tokensSaved: number;
    compressionRatio: number;
    retrievalPrecision: number;
  };
};

type VerifiedBrowserExecutor = "webllm-worker" | "chromium-prompt-api";

function assertVerifiedExecutor(
  result: PlatformAIResult,
  requiredExecutor: VerifiedBrowserExecutor,
) {
  if (result.executor === requiredExecutor) return;
  throw Object.assign(
    new Error("T2 executor mismatch; no alternate Browser executor was accepted."),
    {
      code: "BROWSER_AI_T2_EXECUTOR_MISMATCH",
      plannedExecutor: requiredExecutor,
      actualExecutor: result.executor ?? "browser-task-model",
      fallbackAttempted: false,
      canonicalMutationCount: 0,
    },
  );
}

function assertSameVerifiedBrowserModel(
  reference: PlatformAIResult,
  candidate: PlatformAIResult,
) {
  if (
    reference.modelId
    && reference.modelId === candidate.modelId
    && isCryptographicClosedAIModelDigest(reference.modelDigest)
    && reference.modelDigest === candidate.modelDigest
  ) return;
  throw Object.assign(
    new Error("Bounded Browser repair changed verified model identity."),
    {
      code: "BROWSER_AI_BOUNDED_REPAIR_MODEL_MISMATCH",
      fallbackAttempted: false,
      canonicalMutationCount: 0,
    },
  );
}

function hasVerifiedClosedWebLLMBoundary(
  result: PlatformAIResult,
  decision: PlatformRouterDecision,
  stageHardCap: number,
  expectedRequestId: string,
) {
  return result.requestId === expectedRequestId
    && decision.providerId === "browser-ai"
    && decision.privacyMode === "strict-local"
    && decision.externalRequest === false
    && decision.dataLeavesDevice === false
    && decision.fallbackChain.length === 0
    && result.providerId === "browser-ai"
    && result.candidateOnly === true
    && result.externalRequest === false
    && result.dataLeavesDevice === false
    && Boolean(result.modelId)
    && result.modelId === decision.modelId
    && isCryptographicClosedAIModelDigest(result.modelDigest)
    && result.modelDigest === decision.modelDigest
    && result.provenance.providerId === decision.providerId
    && result.provenance.modelId === result.modelId
    && result.provenance.modelDigest === result.modelDigest
    && result.provenance.externalRequest === false
    && result.provenance.dataLeavesDevice === false
    && result.provenance.privacyMode === decision.privacyMode
    && result.provenance.fallbackChain.length === 0
    && result.performancePolicy?.policyVersion === "browser-ai-performance-v2"
    && result.performancePolicy.workerExecution === true
    && result.performancePolicy.serialGeneration === true
    && Number.isSafeInteger(result.performancePolicy.maxOutputTokens)
    && result.performancePolicy.maxOutputTokens >= 1
    && result.performancePolicy.maxOutputTokens <= Math.floor(stageHardCap);
}

function assertVerifiedClosedWebLLMBoundary(
  result: PlatformAIResult,
  decision: PlatformRouterDecision,
  stageHardCap: number,
  expectedRequestId: string,
) {
  if (hasVerifiedClosedWebLLMBoundary(
    result,
    decision,
    stageHardCap,
    expectedRequestId,
  )) return;
  throw Object.assign(
    new Error("Bounded Browser repair violated the verified closed execution boundary."),
    {
      code: "BROWSER_AI_CLOSED_BOUNDARY_MISMATCH",
      fallbackAttempted: false,
      canonicalMutationCount: 0,
    },
  );
}

function passSeed(seed: number | undefined, offset: number) {
  return seed === undefined ? undefined : (seed + offset) >>> 0;
}

function compactPipelineMaterial(value: string, limit: number) {
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  if (normalized.length <= limit) return normalized;
  const head = Math.max(1, Math.floor(limit * 0.72));
  const tail = Math.max(1, limit - head - 21);
  return `${normalized.slice(0, head)}\n[中段已壓縮]\n${normalized.slice(-tail)}`;
}

const BOUNDED_SAME_MODEL_REPAIR_TASKS = new Set<PlatformAIRequest["taskType"]>([
  "chapter.continue",
  "chapter.expand",
]);
const BROWSER_BOUNDED_REPAIR_MAX_TOKENS = 360;
const BROWSER_BOUNDED_EXTENSION_MAX_TOKENS = 320;
const BROWSER_BOUNDED_FRESH_RECOVERY_MAX_TOKENS = 360;
const BROWSER_OUTPUT_SAFETY_REASON_CODE_BY_PROSE_CODE = {
  "credential": "QUALITY_OUTPUT_CREDENTIAL_LEAK",
  "raw-reasoning": "QUALITY_OUTPUT_RAW_REASONING_LEAK",
  "control-token": "QUALITY_OUTPUT_CONTROL_TOKEN",
  "role-envelope": "QUALITY_OUTPUT_ROLE_ENVELOPE",
  "internal-envelope": "QUALITY_OUTPUT_INTERNAL_ENVELOPE",
} as const satisfies Record<BrowserProseSafetyCode, string>;
const BROWSER_OUTPUT_SAFETY_REASON_CODES = new Set<string>(
  Object.values(BROWSER_OUTPUT_SAFETY_REASON_CODE_BY_PROSE_CODE),
);

function browserProseSafetyReasonCode(code: BrowserProseSafetyCode) {
  return BROWSER_OUTPUT_SAFETY_REASON_CODE_BY_PROSE_CODE[code];
}

function browserProseMergeReasonCode(reason: string | null) {
  switch (reason) {
    case "credential": return "QUALITY_OUTPUT_CREDENTIAL_LEAK";
    case "raw-reasoning": return "QUALITY_OUTPUT_RAW_REASONING_LEAK";
    case "control-token": return "QUALITY_CONTINUATION_CONTROL_TOKEN";
    case "role-envelope": return "QUALITY_CONTINUATION_ROLE_ENVELOPE";
    case "internal-envelope": return "QUALITY_CONTINUATION_INTERNAL_ENVELOPE";
    case "seed-anchor-invalid": return "QUALITY_CONTINUATION_ANCHOR_INVALID";
    case "anchor-repeated": return "QUALITY_CONTINUATION_ANCHOR_REPEATED";
    case "suffix-empty": return "QUALITY_CONTINUATION_SUFFIX_EMPTY";
    case "base-repeated": return "QUALITY_CONTINUATION_BASE_REPEATED";
    case "combined-contract-unsatisfied":
    case "output-budget-exceeded":
      return "QUALITY_CONTINUATION_CONTRACT_UNSATISFIED";
    default: return null;
  }
}

export function browserFreshRecoveryQualityReasonCodes(reasonCodes: string[]) {
  const finiteReasons = [...new Set(reasonCodes)];
  return finiteReasons.length > 0
    ? finiteReasons
    : ["QUALITY_SCORE_BELOW_THRESHOLD"];
}

export function buildBrowserFreshRecoveryObjective(authorObjective: string) {
  return [
    authorObjective.trim(),
    // Keep this internal target compact: the protected final contract owns
    // Traditional-Chinese, prose-only and hard 220–320 acceptance truth,
    // while the 448-token model still needs all approved story anchors.
    "目標240至300；硬限220至320字。",
  ].filter(Boolean).join("\n");
}

const BROWSER_TRUNCATED_FRESH_RECOVERY_REASONS = new Set([
  "QUALITY_LENGTHCOMPLIANCE_LOW",
  "QUALITY_NARRATIVE_TOO_SHORT",
  "QUALITY_OUTPUT_TRUNCATED",
  "QUALITY_TASKUSEFULNESS_LOW",
]);

const BROWSER_LENGTH_ONLY_FRESH_RECOVERY_REASONS = new Set([
  "QUALITY_LENGTHCOMPLIANCE_LOW",
  "QUALITY_NARRATIVE_TOO_SHORT",
]);

export function isBrowserTruncatedFreshRecoveryCandidate(input: {
  contractSatisfied: boolean;
  safetyCode: string | null;
  failureCode: string | null;
  rawBudgetExceeded: boolean;
  observedHanCharacters: number;
  finishReason: string | null | undefined;
  qualityReasonCodes: string[];
}) {
  return !input.contractSatisfied
    && !input.safetyCode
    && input.failureCode === "minimum-length-unmet"
    && !input.rawBudgetExceeded
    && input.observedHanCharacters
      >= BROWSER_PROSE_MINIMUM_CONTINUATION_BASE_HAN_CHARACTERS
    && input.observedHanCharacters < BROWSER_PROSE_MINIMUM_HAN_CHARACTERS
    && input.finishReason === "stop"
    && input.qualityReasonCodes.includes("QUALITY_OUTPUT_TRUNCATED")
    && input.qualityReasonCodes.includes("QUALITY_TASKUSEFULNESS_LOW")
    && input.qualityReasonCodes.every((reason) =>
      BROWSER_TRUNCATED_FRESH_RECOVERY_REASONS.has(reason));
}

export function isBrowserDegenerateInitialRepairFreshRecoveryCandidate(input: {
  initialContractSatisfied: boolean;
  initialSafetyCode: string | null;
  initialFailureCode: string | null;
  initialRawBudgetExceeded: boolean;
  initialObservedHanCharacters: number;
  initialFinishReason: string | null | undefined;
  repairContractSatisfied: boolean;
  repairSafetyCode: string | null;
  repairFailureCode: string | null;
  repairRawBudgetExceeded: boolean;
  repairObservedHanCharacters: number;
  repairFinishReason: string | null | undefined;
  repairQualityReasonCodes: string[];
}) {
  return !input.initialContractSatisfied
    && !input.initialSafetyCode
    && input.initialFailureCode === "minimum-length-unmet"
    && !input.initialRawBudgetExceeded
    && input.initialObservedHanCharacters
      < BROWSER_PROSE_MINIMUM_CONTINUATION_BASE_HAN_CHARACTERS
    && input.initialFinishReason === "stop"
    && !input.repairContractSatisfied
    && !input.repairSafetyCode
    && input.repairFailureCode === "minimum-length-unmet"
    && !input.repairRawBudgetExceeded
    && input.repairObservedHanCharacters
      >= BROWSER_PROSE_MINIMUM_CONTINUATION_BASE_HAN_CHARACTERS
    && input.repairObservedHanCharacters < BROWSER_PROSE_MINIMUM_HAN_CHARACTERS
    && input.repairFinishReason === "stop"
    && input.repairQualityReasonCodes.every((reason) =>
      BROWSER_LENGTH_ONLY_FRESH_RECOVERY_REASONS.has(reason));
}

export function isBrowserCollapsedRepairFreshRecoveryCandidate(input: {
  initialContractSatisfied: boolean;
  initialSafetyCode: string | null;
  initialFailureCode: string | null;
  initialRawBudgetExceeded: boolean;
  initialObservedHanCharacters: number;
  initialFinishReason: string | null | undefined;
  initialQualityReasonCodes: string[];
  repairContractSatisfied: boolean;
  repairSafetyCode: string | null;
  repairFailureCode: string | null;
  repairRawBudgetExceeded: boolean;
  repairObservedHanCharacters: number;
  repairFinishReason: string | null | undefined;
}) {
  return !input.initialContractSatisfied
    && !input.initialSafetyCode
    && input.initialFailureCode === "minimum-length-unmet"
    && !input.initialRawBudgetExceeded
    && input.initialObservedHanCharacters
      >= BROWSER_PROSE_MINIMUM_CONTINUATION_BASE_HAN_CHARACTERS
    && input.initialObservedHanCharacters < BROWSER_PROSE_MINIMUM_HAN_CHARACTERS
    && input.initialFinishReason === "stop"
    && input.initialQualityReasonCodes.length > 0
    && input.initialQualityReasonCodes.includes("QUALITY_LENGTHCOMPLIANCE_LOW")
    && input.initialQualityReasonCodes.every((reason) =>
      BROWSER_LENGTH_ONLY_FRESH_RECOVERY_REASONS.has(reason))
    && !input.repairContractSatisfied
    && !input.repairSafetyCode
    && input.repairFailureCode === "minimum-length-unmet"
    && !input.repairRawBudgetExceeded
    && input.repairObservedHanCharacters > 0
    && input.repairObservedHanCharacters
      < BROWSER_PROSE_MINIMUM_CONTINUATION_BASE_HAN_CHARACTERS
    && input.repairFinishReason === "stop";
}

export function isBrowserCappedInitialCollapsedRepairFreshRecoveryCandidate(input: {
  initialContractSatisfied: boolean;
  initialSafetyCode: string | null;
  initialFailureCode: string | null;
  initialRawBudgetExceeded: boolean;
  initialObservedHanCharacters: number;
  initialObservedEstimatedTokens: number;
  initialObservedCodePoints: number;
  initialFinishReason: string | null | undefined;
  initialCompletionTokens: number | null | undefined;
  initialRuntimeTokenCap: number;
  initialStageHardCap: number;
  repairContractSatisfied: boolean;
  repairSafetyCode: string | null;
  repairFailureCode: string | null;
  repairRawBudgetExceeded: boolean;
  repairObservedHanCharacters: number;
  repairObservedEstimatedTokens: number;
  repairObservedCodePoints: number;
  repairFinishReason: string | null | undefined;
  repairCompletionTokens: number | null | undefined;
  repairRuntimeTokenCap: number;
  repairStageHardCap: number;
}) {
  const initialCompletionTokens = input.initialCompletionTokens;
  const initialRuntimeTokenCap = Math.floor(input.initialRuntimeTokenCap);
  const initialStageHardCap = Math.floor(input.initialStageHardCap);
  const repairCompletionTokens = input.repairCompletionTokens;
  const repairRuntimeTokenCap = Math.floor(input.repairRuntimeTokenCap);
  const repairStageHardCap = Math.floor(input.repairStageHardCap);
  return !input.initialContractSatisfied
    && !input.initialSafetyCode
    && input.initialFailureCode === "minimum-length-unmet"
    && !input.initialRawBudgetExceeded
    && input.initialObservedHanCharacters
      >= BROWSER_PROSE_MINIMUM_CONTINUATION_BASE_HAN_CHARACTERS
    && input.initialObservedHanCharacters < BROWSER_PROSE_MINIMUM_HAN_CHARACTERS
    && input.initialFinishReason === "length"
    && Number.isSafeInteger(initialCompletionTokens)
    && Number.isSafeInteger(initialRuntimeTokenCap)
    && initialRuntimeTokenCap >= 1
    && Number.isSafeInteger(initialStageHardCap)
    && initialStageHardCap >= 1
    && initialRuntimeTokenCap <= initialStageHardCap
    && (initialCompletionTokens ?? 0)
      >= Math.max(1, initialRuntimeTokenCap - 8)
    && (initialCompletionTokens ?? 0) <= initialRuntimeTokenCap
    && Number.isSafeInteger(input.initialObservedEstimatedTokens)
    && input.initialObservedEstimatedTokens >= 1
    && input.initialObservedEstimatedTokens <= initialRuntimeTokenCap
    && Number.isSafeInteger(input.initialObservedCodePoints)
    && input.initialObservedCodePoints >= 1
    && input.initialObservedCodePoints
      <= (initialCompletionTokens ?? 0) * 4 + 128
    && !input.repairContractSatisfied
    && !input.repairSafetyCode
    && input.repairFailureCode === "minimum-length-unmet"
    && !input.repairRawBudgetExceeded
    && input.repairObservedHanCharacters > 0
    && input.repairObservedHanCharacters
      < BROWSER_PROSE_MINIMUM_CONTINUATION_BASE_HAN_CHARACTERS
    && input.repairFinishReason === "stop"
    && Number.isSafeInteger(repairCompletionTokens)
    && (repairCompletionTokens ?? 0) >= 1
    && Number.isSafeInteger(repairRuntimeTokenCap)
    && repairRuntimeTokenCap >= 1
    && Number.isSafeInteger(repairStageHardCap)
    && repairStageHardCap >= 1
    && repairRuntimeTokenCap <= repairStageHardCap
    && (repairCompletionTokens ?? 0) <= repairRuntimeTokenCap
    && Number.isSafeInteger(input.repairObservedEstimatedTokens)
    && input.repairObservedEstimatedTokens >= 1
    && input.repairObservedEstimatedTokens <= repairRuntimeTokenCap
    && Number.isSafeInteger(input.repairObservedCodePoints)
    && input.repairObservedCodePoints >= 1
    && input.repairObservedCodePoints
      <= (repairCompletionTokens ?? 0) * 4 + 128;
}

export function isBrowserTargetRangeOversizedRepairFreshRecoveryCandidate(input: {
  initialContractSatisfied: boolean;
  initialSafetyCode: string | null;
  initialFailureCode: string | null;
  initialRawBudgetExceeded: boolean;
  initialObservedHanCharacters: number;
  initialObservedEstimatedTokens: number;
  initialObservedCodePoints: number;
  initialFinishReason: string | null | undefined;
  initialCompletionTokens: number | null | undefined;
  initialRuntimeTokenCap: number;
  initialStageHardCap: number;
  initialContentCharacters: number;
  initialReportedRawOutputCharacters: number | null | undefined;
  initialReportedNormalizedOutputCharacters: number | null | undefined;
  repairContractSatisfied: boolean;
  repairSafetyCode: string | null;
  repairFailureCode: string | null;
  repairRawBudgetExceeded: boolean;
  repairObservedHanCharacters: number;
  repairObservedEstimatedTokens: number;
  repairObservedCodePoints: number;
  repairFinishReason: string | null | undefined;
  repairCompletionTokens: number | null | undefined;
  repairRuntimeTokenCap: number;
  repairStageHardCap: number;
  repairContentCharacters: number;
  repairReportedRawOutputCharacters: number | null | undefined;
  repairReportedNormalizedOutputCharacters: number | null | undefined;
}) {
  const initialCompletionTokens = input.initialCompletionTokens;
  const repairCompletionTokens = input.repairCompletionTokens;
  return !input.initialContractSatisfied
    && !input.initialSafetyCode
    && input.initialFailureCode === "minimum-length-unmet"
    && !input.initialRawBudgetExceeded
    && input.initialObservedHanCharacters
      >= BROWSER_PROSE_MINIMUM_CONTINUATION_BASE_HAN_CHARACTERS
    && input.initialObservedHanCharacters < BROWSER_PROSE_MINIMUM_HAN_CHARACTERS
    && input.initialFinishReason === "stop"
    && Number.isSafeInteger(initialCompletionTokens)
    && (initialCompletionTokens ?? 0) >= 1
    && Number.isSafeInteger(input.initialRuntimeTokenCap)
    && input.initialRuntimeTokenCap >= 1
    && Number.isSafeInteger(input.initialStageHardCap)
    && input.initialStageHardCap >= 1
    && input.initialStageHardCap <= BROWSER_PROSE_MAXIMUM_ESTIMATED_TOKENS
    && input.initialRuntimeTokenCap <= input.initialStageHardCap
    && (initialCompletionTokens ?? 0) <= input.initialRuntimeTokenCap
    && Number.isSafeInteger(input.initialObservedEstimatedTokens)
    && input.initialObservedEstimatedTokens >= 1
    && input.initialObservedEstimatedTokens
      <= BROWSER_PROSE_MAXIMUM_ESTIMATED_TOKENS
    && Number.isSafeInteger(input.initialObservedCodePoints)
    && input.initialObservedCodePoints >= input.initialObservedHanCharacters
    && input.initialObservedCodePoints <= BROWSER_PROSE_MAXIMUM_CODE_POINTS
    && input.initialObservedCodePoints
      <= (initialCompletionTokens ?? 0) * 4 + 128
    && Number.isSafeInteger(input.initialContentCharacters)
    && input.initialContentCharacters >= input.initialObservedCodePoints
    && input.initialReportedRawOutputCharacters === input.initialContentCharacters
    && input.initialReportedNormalizedOutputCharacters
      === input.initialContentCharacters
    && !input.repairContractSatisfied
    && !input.repairSafetyCode
    && input.repairFailureCode === "output-budget-exceeded"
    && input.repairRawBudgetExceeded
    && input.repairObservedHanCharacters >= BROWSER_PROSE_MINIMUM_HAN_CHARACTERS
    && input.repairObservedHanCharacters <= BROWSER_PROSE_MAXIMUM_HAN_CHARACTERS
    && input.repairFinishReason === "stop"
    && Number.isSafeInteger(repairCompletionTokens)
    && (repairCompletionTokens ?? 0) >= 1
    && Number.isSafeInteger(input.repairRuntimeTokenCap)
    && input.repairRuntimeTokenCap >= 1
    && Number.isSafeInteger(input.repairStageHardCap)
    && input.repairStageHardCap === BROWSER_BOUNDED_REPAIR_MAX_TOKENS
    && input.repairRuntimeTokenCap <= input.repairStageHardCap
    && (repairCompletionTokens ?? 0) <= input.repairRuntimeTokenCap
    && Number.isSafeInteger(input.repairObservedEstimatedTokens)
    && input.repairObservedEstimatedTokens >= 1
    && input.repairObservedEstimatedTokens <= 448
    && Number.isSafeInteger(input.repairObservedCodePoints)
    && input.repairObservedCodePoints >= input.repairObservedHanCharacters
    && input.repairObservedCodePoints <= 704
    && (
      input.repairObservedEstimatedTokens
        > BROWSER_PROSE_MAXIMUM_ESTIMATED_TOKENS
      || input.repairObservedCodePoints > BROWSER_PROSE_MAXIMUM_CODE_POINTS
    )
    && input.repairObservedCodePoints
      <= (repairCompletionTokens ?? 0) * 4 + 128
    && Number.isSafeInteger(input.repairContentCharacters)
    && input.repairContentCharacters >= input.repairObservedCodePoints
    && input.repairReportedRawOutputCharacters === input.repairContentCharacters
    && input.repairReportedNormalizedOutputCharacters
      === input.repairContentCharacters;
}

export function isBrowserOversizedStopIsolatedRepairCandidate(input: {
  contractSatisfied: boolean;
  safetyCode: string | null;
  failureCode: string | null;
  rawBudgetExceeded: boolean;
  observedHanCharacters: number;
  observedEstimatedTokens: number;
  observedCodePoints: number;
  finishReason: string | null | undefined;
  completionTokens: number | null | undefined;
  runtimeTokenCap: number;
  stageHardCap: number;
}) {
  const completionTokens = input.completionTokens;
  const runtimeTokenCap = Math.floor(input.runtimeTokenCap);
  const stageHardCap = Math.floor(input.stageHardCap);
  // This mirrors the deterministic raw-budget OR. The provider's public
  // character metric is UTF-16 length, so requiring the code-point branch
  // alone would strand valid oversized-Han traces containing astral glyphs.
  return !input.contractSatisfied
    && !input.safetyCode
    && input.failureCode === "output-budget-exceeded"
    && input.rawBudgetExceeded
    && input.observedHanCharacters > BROWSER_PROSE_MAXIMUM_HAN_CHARACTERS
    && (
      input.observedEstimatedTokens > BROWSER_PROSE_MAXIMUM_ESTIMATED_TOKENS
      || input.observedCodePoints > BROWSER_PROSE_MAXIMUM_CODE_POINTS
    )
    && input.finishReason === "stop"
    && Number.isSafeInteger(completionTokens)
    && (completionTokens ?? 0) >= 1
    && Number.isSafeInteger(runtimeTokenCap)
    && runtimeTokenCap >= 1
    && Number.isSafeInteger(stageHardCap)
    && stageHardCap >= 1
    && runtimeTokenCap <= stageHardCap
    && (completionTokens ?? 0) <= runtimeTokenCap
    && input.observedCodePoints <= (completionTokens ?? 0) * 4 + 128;
}

const BOUNDED_SAME_MODEL_REPAIR_REASONS = new Set([
  "QUALITY_NARRATIVE_TOO_SHORT",
  "QUALITY_CONTEXT_COPY_EXCESSIVE",
  "QUALITY_NARRATIVE_PROGRESS_MISSING",
  "QUALITY_CONTEXT_CHARACTER_MISSING",
  "QUALITY_WORLD_REGISTER_DRIFT",
  "QUALITY_OUTPUT_TRUNCATED",
]);

export function buildBrowserBoundedSameModelRepairPlan(input: {
  authorObjective: string;
  reasonCodes: string[];
}) {
  const reasonCodes = [...new Set(input.reasonCodes.filter((reason) =>
    BOUNDED_SAME_MODEL_REPAIR_REASONS.has(reason)
    || BROWSER_OUTPUT_SAFETY_REASON_CODES.has(reason)))];
  return {
    objective: [
      input.authorObjective.trim(),
      "補修後重寫完整正文。",
    ].filter(Boolean).join("\n"),
    reasonCodes,
  };
}

function minimumCandidateTokens(
  taskType: PlatformAIRequest["taskType"],
  tier: BrowserTaskEligibility["tier"],
) {
  if (BOUNDED_SAME_MODEL_REPAIR_TASKS.has(taskType)) return 140;
  return tier === "T1" ? 6 : 24;
}

function browserRuntimePassEvidence(
  stage: ClosedAgentBrowserRuntimeEvidence["stage"],
  result: PlatformAIResult,
  observedHanCharacters: number | null = null,
): ClosedAgentBrowserRuntimeEvidence {
  return {
    stage,
    finishReason: result.generationFinishReason ?? "unavailable",
    completionTokens: result.completionTokens ?? null,
    rawOutputCharacters: result.rawOutputCharacters
      ?? result.outputCharacters
      ?? result.content.length,
    normalizedOutputCharacters: result.normalizedOutputCharacters
      ?? result.outputCharacters
      ?? result.content.length,
    observedHanCharacters,
  };
}

function unavailableBrowserRuntimePassEvidence(
  stage: ClosedAgentBrowserRuntimeEvidence["stage"],
): ClosedAgentBrowserRuntimeEvidence {
  return {
    stage,
    finishReason: "unavailable",
    completionTokens: null,
    rawOutputCharacters: null,
    normalizedOutputCharacters: null,
    observedHanCharacters: null,
  };
}

function attachBrowserRuntimeEvidence(
  error: unknown,
  evidence: ClosedAgentBrowserRuntimeEvidence[],
) {
  if (error && typeof error === "object") {
    try {
      Object.assign(error, { browserRuntimeEvidence: evidence });
      return error;
    } catch {
      // Frozen provider errors are wrapped below without copying their message,
      // cause, runtime statistics, prompt, or model output.
    }
  }
  const unsafeCode = (error as { code?: unknown } | null)?.code;
  const code = unsafeCode === "BROWSER_AI_REQUIRED_GENERATIVE_EXECUTION_FAILED"
    || unsafeCode === "BROWSER_AI_QUALITY_INSUFFICIENT"
    || unsafeCode === "BROWSER_WEBLLM_GENERATION_FAILED"
    ? unsafeCode
    : "BROWSER_WEBLLM_GENERATION_FAILED";
  return Object.assign(new Error("Browser generation failed before safe runtime evidence was available."), {
    code,
    browserRuntimeEvidence: evidence,
  });
}

function selectVerifiedBrowserLengthSafePrefix(input: {
  completion: ReturnType<typeof assessBrowserProseCompletion>;
  result: PlatformAIResult;
  stageHardCap: number;
  requiredGenerativeExecutor: VerifiedBrowserExecutor | undefined;
}) {
  const completion = input.completion;
  if (
    !completion.rawBudgetExceeded
    || completion.contractSatisfied
    || !completion.salvageableContent
  ) return null;
  const runtimePerformancePolicy = input.result.performancePolicy;
  const runtimeCompletionTokenCap =
    runtimePerformancePolicy?.policyVersion === "browser-ai-performance-v2"
    && runtimePerformancePolicy.workerExecution === true
    && runtimePerformancePolicy.serialGeneration === true
    && Number.isSafeInteger(runtimePerformancePolicy.maxOutputTokens)
    && runtimePerformancePolicy.maxOutputTokens >= 1
    && runtimePerformancePolicy.maxOutputTokens
      <= Math.floor(input.stageHardCap)
      ? runtimePerformancePolicy.maxOutputTokens
      : null;
  const completionTokens = input.result.completionTokens;
  if (!(
    input.requiredGenerativeExecutor === "webllm-worker"
    && input.result.executor === "webllm-worker"
    && Boolean(input.result.modelId)
    && isCryptographicClosedAIModelDigest(input.result.modelDigest)
    && input.result.generationFinishReason === "length"
    && runtimeCompletionTokenCap !== null
    && Number.isSafeInteger(completionTokens)
    && (completionTokens ?? 0) >= Math.max(1, runtimeCompletionTokenCap - 8)
    && (completionTokens ?? 0) <= runtimeCompletionTokenCap
    && completion.selectedEstimatedTokens <= runtimeCompletionTokenCap
    && completion.observedCodePoints <= (completionTokens ?? 0) * 4 + 128
  )) return null;
  return {
    ...completion,
    content: completion.salvageableContent,
    contractSatisfied: true,
    failureCode: null,
  };
}

export async function executeBrowserInitialPass(input: {
  request: PlatformAIRequest;
  decision: PlatformRouterDecision;
  options: BrowserAIExecutionOptions;
  onProgress?: (progress: BrowserAIStreamProgress) => void;
  runPass?: typeof runBrowserAI;
}) {
  try {
    return await (input.runPass ?? runBrowserAI)(
      input.request,
      input.decision,
      input.onProgress,
      input.options,
    );
  } catch (error) {
    throw attachBrowserRuntimeEvidence(error, [
      unavailableBrowserRuntimePassEvidence("initial"),
    ]);
  }
}

// Retained as a legacy receipt decoder reference. RC5 executes one model pass
// per Closed Agent OS node and never invokes this nested quality pipeline.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function runBrowserThreeBQualityPipeline(input: {
  request: PlatformAIRequest;
  decision: PlatformRouterDecision;
  requiredExecutor: VerifiedBrowserExecutor;
  onProgress?: (progress: BrowserAIStreamProgress) => void;
  started: number;
}): Promise<PlatformAIResult> {
  const commonOptions = {
    requiredGenerativeExecutor: input.requiredExecutor,
  } as const;
  const planner = await runBrowserAI(
    {
      ...input.request,
      requestId: `${input.request.requestId}:planner`,
      taskType: "assistant.general",
      input: [
        "請為下列小說任務建立精簡、可執行的創作計畫。",
        "只輸出角色分工與步驟，不輸出內部推理，也不要撰寫正文。",
        input.request.input,
      ].join("\n"),
      qualityPhase: "draft",
      workingMaterials: [],
      generationOptions: {
        ...input.request.generationOptions,
        seed: passSeed(input.request.generationOptions?.seed, 0),
        temperature: 0.2,
        topP: 0.82,
        maxTokens: Math.min(input.request.generationOptions?.maxTokens ?? 160, 160),
      },
    },
    input.decision,
    undefined,
    commonOptions,
  );
  assertVerifiedExecutor(planner, input.requiredExecutor);
  const plannerText = compactPipelineMaterial(planner.content, 1_200);
  const planDigest = await sha256Hex(plannerText);
  const agentPlan = {
    planDigest,
    roles: ["planner", "drafter", "critic", "reviser", "evaluator"],
    steps: [{
      role: "planner",
      objective: plannerText,
    }],
  };

  const draft = await runBrowserAI(
    {
      ...input.request,
      requestId: `${input.request.requestId}:draft`,
      qualityPhase: "draft",
      agentPlan,
      workingMaterials: [],
      generationOptions: {
        ...input.request.generationOptions,
        seed: passSeed(input.request.generationOptions?.seed, 1),
      },
    },
    input.decision,
    undefined,
    commonOptions,
  );
  assertVerifiedExecutor(draft, input.requiredExecutor);
  const draftText = compactPipelineMaterial(draft.content, 5_200);
  const draftDigest = await sha256Hex(draftText);

  const critic = await runBrowserAI(
    {
      ...input.request,
      requestId: `${input.request.requestId}:critic`,
      taskType: "assistant.critique",
      input: [
        "依原任務、已核准脈絡與草稿，列出可直接執行的修訂意見。",
        "檢查角色一致性、時間線、世界規則、重複內容與任務完成度。",
        "不要重述草稿，不輸出內部推理。",
        `原任務：${input.request.input}`,
      ].join("\n"),
      qualityPhase: "critic",
      agentPlan,
      workingMaterials: [{
        kind: "draft",
        text: draftText,
        digest: draftDigest,
      }],
      generationOptions: {
        ...input.request.generationOptions,
        seed: passSeed(input.request.generationOptions?.seed, 2),
        temperature: 0.25,
        topP: 0.86,
        maxTokens: Math.min(input.request.generationOptions?.maxTokens ?? 240, 240),
      },
    },
    input.decision,
    undefined,
    commonOptions,
  );
  assertVerifiedExecutor(critic, input.requiredExecutor);
  const criticText = compactPipelineMaterial(critic.content, 1_800);
  const criticDigest = await sha256Hex(criticText);

  const revisionStarted = performance.now();
  const revision = await runBrowserAI(
    {
      ...input.request,
      requestId: `${input.request.requestId}:revision`,
      qualityPhase: "revision",
      agentPlan,
      workingMaterials: [
        { kind: "draft", text: draftText, digest: draftDigest },
        { kind: "critic", text: criticText, digest: criticDigest },
      ],
      generationOptions: {
        ...input.request.generationOptions,
        seed: passSeed(input.request.generationOptions?.seed, 3),
      },
    },
    input.decision,
    input.onProgress,
    commonOptions,
  );
  assertVerifiedExecutor(revision, input.requiredExecutor);

  const passes = [planner, draft, critic, revision];
  return {
    ...revision,
    requestId: input.request.requestId,
    elapsedMs: Math.round(performance.now() - input.started),
    firstTokenMs: Math.round(
      revisionStarted - input.started + (revision.firstTokenMs ?? 0),
    ),
    inputCharacters: passes.reduce(
      (sum, pass) => sum + (pass.inputCharacters ?? 0),
      0,
    ),
    outputCharacters: revision.content.length,
    generatedTokenEvents: passes.reduce(
      (sum, pass) => sum + (pass.generatedTokenEvents ?? 0),
      0,
    ),
    omittedInputCharacters: passes.reduce(
      (sum, pass) => sum + (pass.omittedInputCharacters ?? 0),
      0,
    ),
    queueWaitMs: passes.reduce((sum, pass) => sum + (pass.queueWaitMs ?? 0), 0),
    runtimeStats: [
      revision.runtimeStats,
      "pipeline=planner,draft,critic,revision,deterministic-evaluator",
      "intermediate-content=pipeline-memory-only",
      `plan-digest=${planDigest}`,
      `draft-digest=${draftDigest}`,
      `critic-digest=${criticDigest}`,
    ].filter(Boolean).join("; "),
    provenance: {
      ...revision.provenance,
      warnings: [
        ...revision.provenance.warnings,
        "3B Browser quality pipeline ran Planner, Draft, Critic and Revision on the verified executor; intermediate text was not persisted.",
      ],
    },
  };
}

function explicitEscalationError(
  eligibility: BrowserTaskEligibility,
  code = "BROWSER_EXPLICIT_ESCALATION_REQUIRED",
) {
  return Object.assign(
    new Error("此工作超過目前瀏覽器已驗證能力；系統沒有暗中切換其他模型。"),
    {
      code,
      taskTier: eligibility.tier,
      reasonCode: eligibility.reasonCode,
      recommendedProvider: eligibility.recommendedProvider,
      allowedActions: [
        "adjust-and-retry",
        "use-local-ollama",
        "use-private-hub",
        "abandon",
      ],
      fallbackAttempted: false,
      canonicalMutationCount: 0,
    },
  );
}

async function contextSources(
  request: PlatformAIRequest,
  semanticReady: boolean,
): Promise<BrowserContextSource[]> {
  if (!request.cacheNamespace) {
    throw Object.assign(new Error("Browser Compute Plane requires a complete cache namespace."), {
      code: "BROWSER_COMPUTE_NAMESPACE_REQUIRED",
    });
  }
  const base: BrowserContextSource[] = request.context.map((text, index) => {
    const currentChapter = /^\s*\[current-chapter\]/iu.test(text);
    return {
      id: `context-${index + 1}`,
      kind: currentChapter
        ? "current-chapter"
        : index === 0
          ? "canon-authority"
          : "story-bible",
      text,
      namespace: structuredClone(request.cacheNamespace!),
      visibility: "both",
      approved: true,
      revision: request.cacheNamespace!.storyBibleRevision,
      authority: currentChapter || index === 0 ? 1 : 0.65,
      relevance: currentChapter ? 1 : 0.65,
    };
  });
  if (!semanticReady || !request.context.length) return base;
  try {
    const ranked = await rankWithBrowserSemanticModel({
      namespace: request.cacheNamespace,
      query: request.input,
      items: base
        .filter((source) => source.kind !== "user-instruction")
        .map((source) => ({ id: source.id, text: source.text })),
      signal: request.signal,
    });
    const scoreMap = new Map(ranked.scores.map((score) => [score.id, score.score]));
    return base.map((source) => ({
      ...source,
      relevance: Math.max(
        0,
        Math.min(1, (scoreMap.get(source.id) ?? 0) * 0.5 + 0.5),
      ),
    }));
  } catch {
    // Semantic failure is explicit in the receipt pipeline, but deterministic
    // context composition remains available and never changes provider.
    return base;
  }
}

export async function executeBrowserBoundedQualityPasses(input: {
  request: PlatformAIRequest;
  decision: PlatformRouterDecision;
  executionRequest: PlatformAIRequest;
  initialResult: PlatformAIResult;
  eligibility: BrowserTaskEligibility;
  performancePolicy: ReturnType<typeof resolveBrowserAIPerformancePolicy>;
  requiredGenerativeExecutor?: VerifiedBrowserExecutor;
  onProgress?: (progress: BrowserAIStreamProgress) => void;
  runPass?: typeof runBrowserAI;
  deferTraditionalChineseNormalization?: boolean;
}) {
  const eligibility = input.eligibility;
  const executionRequest = input.executionRequest;
  const requiredGenerativeExecutor = input.requiredGenerativeExecutor;
  const performancePolicy = input.performancePolicy;
  const runPass = input.runPass ?? runBrowserAI;
  let result = input.initialResult;
  const defaultChapterProseContract = Boolean(
    requiredGenerativeExecutor
    && shouldEnforceDefaultBrowserProseContract({
      taskType: input.request.taskType,
      authorObjective: input.request.input,
    }),
  );
  let chapterProseContract = defaultChapterProseContract
    ? assessBrowserProseCompletion(result.content)
    : null;
  const initialSafetyCode = chapterProseContract?.safetyCode
    ?? browserProseSafetyCode(result.content);
  const initialSafetyReasonCode = initialSafetyCode
    ? browserProseSafetyReasonCode(initialSafetyCode)
    : null;
  const initialSafetyRepairReasonCode = Boolean(
    chapterProseContract?.safetyCode
    && requiredGenerativeExecutor === "webllm-worker"
    && result.generationFinishReason === "stop"
    && result.executor === requiredGenerativeExecutor
    && Boolean(result.modelId)
    && result.modelId === input.decision.modelId
    && isCryptographicClosedAIModelDigest(result.modelDigest)
    && result.modelDigest === input.decision.modelDigest
    && hasVerifiedClosedWebLLMBoundary(
      result,
      input.decision,
      performancePolicy.reservedOutputTokens,
      input.request.requestId,
    )
    && BOUNDED_SAME_MODEL_REPAIR_TASKS.has(input.request.taskType)
  )
    ? initialSafetyReasonCode
    : null;
  const initialStopBudgetRepairReasonCode = Boolean(
    defaultChapterProseContract
    && requiredGenerativeExecutor === "webllm-worker"
    && !initialSafetyReasonCode
    && chapterProseContract
    && isBrowserOversizedStopIsolatedRepairCandidate({
      contractSatisfied: chapterProseContract.contractSatisfied,
      safetyCode: chapterProseContract.safetyCode,
      failureCode: chapterProseContract.failureCode,
      rawBudgetExceeded: chapterProseContract.rawBudgetExceeded,
      observedHanCharacters: chapterProseContract.observedHanCharacters,
      observedEstimatedTokens: chapterProseContract.observedEstimatedTokens,
      observedCodePoints: chapterProseContract.observedCodePoints,
      finishReason: result.generationFinishReason,
      completionTokens: result.completionTokens,
      runtimeTokenCap: result.performancePolicy?.maxOutputTokens ?? 0,
      stageHardCap: performancePolicy.reservedOutputTokens,
    })
  )
    ? "QUALITY_OUTPUT_TRUNCATED"
    : null;
  const initialIsolatedRepairReasonCode =
    initialSafetyRepairReasonCode ?? initialStopBudgetRepairReasonCode;
  const browserRuntimeEvidence: ClosedAgentBrowserRuntimeEvidence[] = [
    browserRuntimePassEvidence(
      "initial",
      result,
      chapterProseContract?.observedHanCharacters ?? null,
    ),
  ];
  if (
    defaultChapterProseContract
    && requiredGenerativeExecutor === "webllm-worker"
    && result.generationFinishReason !== "stop"
    && result.generationFinishReason !== "length"
  ) {
    throw Object.assign(explicitEscalationError(
      eligibility,
      "BROWSER_AI_QUALITY_INSUFFICIENT",
    ), {
      qualityDecision: "block",
      qualityReasonCodes: ["QUALITY_OUTPUT_TRUNCATED"],
      browserRuntimeEvidence,
      fallbackAttempted: false,
      canonicalMutationCount: 0,
    });
  }
  if (initialSafetyReasonCode && !initialSafetyRepairReasonCode) {
    throw Object.assign(explicitEscalationError(
      eligibility,
      "BROWSER_AI_QUALITY_INSUFFICIENT",
    ), {
      qualityDecision: "block",
      qualityReasonCodes: [initialSafetyReasonCode],
      browserRuntimeEvidence,
      fallbackAttempted: false,
      canonicalMutationCount: 0,
    });
  }
  if (
    defaultChapterProseContract
    && requiredGenerativeExecutor === "webllm-worker"
    && !initialSafetyReasonCode
  ) {
    try {
      assertVerifiedExecutor(result, requiredGenerativeExecutor);
      assertVerifiedClosedWebLLMBoundary(
        result,
        input.decision,
        performancePolicy.reservedOutputTokens,
        input.request.requestId,
      );
    } catch (error) {
      throw attachBrowserRuntimeEvidence(error, browserRuntimeEvidence);
    }
  }
  // The provider inference proof attests the complete raw model generation.
  // This separate boundary selects the only text that may become an
  // authoritative candidate/receipt/ledger value; it does not rewrite or
  // reinterpret the raw-generation proof digest.
  if (
    !initialIsolatedRepairReasonCode
    && chapterProseContract?.rawBudgetExceeded
    && !chapterProseContract.contractSatisfied
  ) {
    const selectedCompletion = selectVerifiedBrowserLengthSafePrefix({
      completion: chapterProseContract,
      result,
      stageHardCap: performancePolicy.reservedOutputTokens,
      requiredGenerativeExecutor,
    });
    if (!selectedCompletion) {
      throw Object.assign(explicitEscalationError(
        eligibility,
        "BROWSER_AI_QUALITY_INSUFFICIENT",
      ), {
        qualityDecision: "block",
        qualityReasonCodes: ["QUALITY_OUTPUT_TRUNCATED"],
        observedHanCharacters: chapterProseContract.observedHanCharacters,
        requiredHanCharacters: [220, 320],
        browserRuntimeEvidence,
        fallbackAttempted: false,
        canonicalMutationCount: 0,
      });
    }
    chapterProseContract = selectedCompletion;
  }
  if (
    chapterProseContract
    && !chapterProseContract.contractSatisfied
    && result.generationFinishReason === "length"
    && chapterProseContract.observedHanCharacters >= 220
  ) {
    throw Object.assign(explicitEscalationError(
      eligibility,
      "BROWSER_AI_QUALITY_INSUFFICIENT",
    ), {
      qualityDecision: "block",
      qualityReasonCodes: ["QUALITY_OUTPUT_TRUNCATED"],
      observedHanCharacters: chapterProseContract.observedHanCharacters,
      requiredHanCharacters: [220, 320],
      browserRuntimeEvidence,
      fallbackAttempted: false,
      canonicalMutationCount: 0,
    });
  }
  if (chapterProseContract?.content) {
    result = {
      ...result,
      content: chapterProseContract.content,
      outputCharacters: chapterProseContract.content.length,
      ...(input.deferTraditionalChineseNormalization
        ? {}
        : { normalizedOutputCharacters: chapterProseContract.content.length }),
    };
  }
  const expectedMinTokens = minimumCandidateTokens(
    input.request.taskType,
    eligibility.tier,
  );
  let quality = initialIsolatedRepairReasonCode
    ? null
    : evaluateBrowserCandidateQuality({
      taskType: input.request.taskType,
      content: result.content,
      expectedMinTokens,
      expectedMaxTokens: performancePolicy.reservedOutputTokens,
      requiresStructuredOutput: input.request.requiresStructured,
      approvedContext: executionRequest.context,
      threshold: eligibility.tier === "T1" ? 0.58 : 0.7,
      deferTraditionalChineseQuality:
        input.deferTraditionalChineseNormalization,
    });
  const repairReasonCodes = [...new Set([
    ...(initialIsolatedRepairReasonCode
      ? [initialIsolatedRepairReasonCode]
      : (quality?.reasonCodes ?? []).filter((reason) =>
        BOUNDED_SAME_MODEL_REPAIR_REASONS.has(reason))),
    ...(chapterProseContract && !chapterProseContract.contractSatisfied
      ? [chapterProseContract.observedHanCharacters < 220
        ? "QUALITY_NARRATIVE_TOO_SHORT"
        : "QUALITY_OUTPUT_TRUNCATED"]
      : []),
  ])];
  if (
    requiredGenerativeExecutor
    && BOUNDED_SAME_MODEL_REPAIR_TASKS.has(input.request.taskType)
    && repairReasonCodes.length > 0
  ) {
    const initialResult = result;
    const initialDigest = initialIsolatedRepairReasonCode
      ? null
      : await sha256Hex(initialResult.content);
    const repairPlan = buildBrowserBoundedSameModelRepairPlan({
      authorObjective: input.request.input,
      reasonCodes: repairReasonCodes,
    });
    let repairResult: PlatformAIResult;
    try {
      const repairRequest: PlatformAIRequest = {
        ...executionRequest,
        requestId: `${input.request.requestId}:bounded-same-model-repair`,
        input: repairPlan.objective,
        qualityPhase: initialStopBudgetRepairReasonCode ? "draft" : "revision",
        agentPlan: initialIsolatedRepairReasonCode
          ? undefined
          : executionRequest.agentPlan,
        toolResults: initialIsolatedRepairReasonCode
          ? []
          : executionRequest.toolResults,
        workingMaterials: [],
        generationOptions: {
          ...input.request.generationOptions,
          seed: passSeed(input.request.generationOptions?.seed, 97),
          temperature: Math.min(
            Math.max(input.request.generationOptions?.temperature ?? 0.68, 0.66),
            0.74,
          ),
          topP: Math.min(
            Math.max(input.request.generationOptions?.topP ?? 0.88, 0.86),
            0.92,
          ),
          maxTokens: BROWSER_BOUNDED_REPAIR_MAX_TOKENS,
          repetitionPenalty: Math.max(
            input.request.generationOptions?.repetitionPenalty ?? 1.08,
            1.12,
          ),
        },
      };
      if (initialIsolatedRepairReasonCode) {
        Reflect.deleteProperty(repairRequest, "unapprovedContinuationSeed");
      }
      repairResult = await runPass(
        repairRequest,
        input.decision,
        input.onProgress,
        {
          preferLightweightRuntime: false,
          requiredGenerativeExecutor,
          deferTraditionalChineseNormalization:
            input.deferTraditionalChineseNormalization,
        },
      );
    } catch (error) {
      throw attachBrowserRuntimeEvidence(error, [
        ...browserRuntimeEvidence,
        unavailableBrowserRuntimePassEvidence("repair"),
      ]);
    }
    let repairCompletion = defaultChapterProseContract
      ? assessBrowserProseCompletion(repairResult.content)
      : null;
    browserRuntimeEvidence.push(browserRuntimePassEvidence(
      "repair",
      repairResult,
      repairCompletion?.observedHanCharacters ?? null,
    ));
    try {
      if (
        defaultChapterProseContract
        && requiredGenerativeExecutor === "webllm-worker"
      ) {
        assertVerifiedClosedWebLLMBoundary(
          repairResult,
          input.decision,
          BROWSER_BOUNDED_REPAIR_MAX_TOKENS,
          `${input.request.requestId}:bounded-same-model-repair`,
        );
      }
      assertVerifiedExecutor(repairResult, requiredGenerativeExecutor);
      assertSameVerifiedBrowserModel(initialResult, repairResult);
    } catch (error) {
      throw attachBrowserRuntimeEvidence(error, browserRuntimeEvidence);
    }
    const repairFinishReasonAccepted = initialStopBudgetRepairReasonCode
      ? repairResult.generationFinishReason === "stop"
      : repairResult.generationFinishReason === "stop"
        || repairResult.generationFinishReason === "length";
    if (
      repairCompletion
      && requiredGenerativeExecutor === "webllm-worker"
      && !repairFinishReasonAccepted
    ) {
      throw Object.assign(explicitEscalationError(
        eligibility,
        "BROWSER_AI_QUALITY_INSUFFICIENT",
      ), {
        qualityDecision: "block",
        qualityReasonCodes: ["QUALITY_OUTPUT_TRUNCATED"],
        browserRuntimeEvidence,
        fallbackAttempted: false,
        canonicalMutationCount: 0,
      });
    }
    const repairInternalEnvelopeRecovery = Boolean(
      repairCompletion?.safetyCode === "internal-envelope"
      && !repairCompletion.rawBudgetExceeded
      && !initialIsolatedRepairReasonCode
      && defaultChapterProseContract
      && requiredGenerativeExecutor === "webllm-worker"
      && repairResult.generationFinishReason === "stop"
      && chapterProseContract
      && !chapterProseContract.contractSatisfied
      && !chapterProseContract.safetyCode
      && !chapterProseContract.rawBudgetExceeded
      && initialResult.generationFinishReason === "stop"
      && initialResult.content.trim().length > 0
      && quality
    );
    if (repairCompletion?.safetyCode && !repairInternalEnvelopeRecovery) {
      const repairSafetyReasonCode = browserProseSafetyReasonCode(
        repairCompletion.safetyCode,
      );
      throw Object.assign(explicitEscalationError(
        eligibility,
        "BROWSER_AI_QUALITY_INSUFFICIENT",
      ), {
        qualityDecision: "block",
        qualityReasonCodes: [repairSafetyReasonCode],
        browserRuntimeEvidence,
        fallbackAttempted: false,
        canonicalMutationCount: 0,
      });
    }
    if (
      initialStopBudgetRepairReasonCode
      && repairCompletion
      && (
        repairResult.generationFinishReason !== "stop"
        || repairCompletion.rawBudgetExceeded
        || !repairCompletion.contractSatisfied
        || !repairCompletion.content
        || repairCompletion.observedHanCharacters
          < BROWSER_PROSE_MINIMUM_HAN_CHARACTERS
        || repairCompletion.observedHanCharacters
          > BROWSER_PROSE_MAXIMUM_HAN_CHARACTERS
        || repairCompletion.selectedHanCharacters
          !== repairCompletion.observedHanCharacters
        || repairCompletion.selectedCodePoints
          !== repairCompletion.observedCodePoints
      )
    ) {
      throw Object.assign(explicitEscalationError(
        eligibility,
        "BROWSER_AI_QUALITY_INSUFFICIENT",
      ), {
        qualityDecision: "block",
        qualityReasonCodes: repairCompletion.observedHanCharacters
          < BROWSER_PROSE_MINIMUM_HAN_CHARACTERS
          ? ["QUALITY_LENGTHCOMPLIANCE_LOW", "QUALITY_NARRATIVE_TOO_SHORT"]
          : ["QUALITY_OUTPUT_TRUNCATED"],
        observedHanCharacters: repairCompletion.observedHanCharacters,
        requiredHanCharacters: [
          BROWSER_PROSE_MINIMUM_HAN_CHARACTERS,
          BROWSER_PROSE_MAXIMUM_HAN_CHARACTERS,
        ],
        browserRuntimeEvidence,
        fallbackAttempted: false,
        canonicalMutationCount: 0,
      });
    }
    const targetRangeOversizedRepairFreshRecoveryCandidate = Boolean(
      defaultChapterProseContract
      && requiredGenerativeExecutor === "webllm-worker"
      && !repairInternalEnvelopeRecovery
      && !initialIsolatedRepairReasonCode
      && chapterProseContract
      && repairCompletion
      && isBrowserTargetRangeOversizedRepairFreshRecoveryCandidate({
        initialContractSatisfied: chapterProseContract.contractSatisfied,
        initialSafetyCode: chapterProseContract.safetyCode,
        initialFailureCode: chapterProseContract.failureCode,
        initialRawBudgetExceeded: chapterProseContract.rawBudgetExceeded,
        initialObservedHanCharacters:
          chapterProseContract.observedHanCharacters,
        initialObservedEstimatedTokens:
          chapterProseContract.observedEstimatedTokens,
        initialObservedCodePoints: chapterProseContract.observedCodePoints,
        initialFinishReason: initialResult.generationFinishReason,
        initialCompletionTokens: initialResult.completionTokens,
        initialRuntimeTokenCap:
          initialResult.performancePolicy?.maxOutputTokens ?? 0,
        initialStageHardCap: performancePolicy.reservedOutputTokens,
        initialContentCharacters: initialResult.content.length,
        initialReportedRawOutputCharacters:
          initialResult.rawOutputCharacters,
        initialReportedNormalizedOutputCharacters:
          initialResult.normalizedOutputCharacters,
        repairContractSatisfied: repairCompletion.contractSatisfied,
        repairSafetyCode: repairCompletion.safetyCode,
        repairFailureCode: repairCompletion.failureCode,
        repairRawBudgetExceeded: repairCompletion.rawBudgetExceeded,
        repairObservedHanCharacters: repairCompletion.observedHanCharacters,
        repairObservedEstimatedTokens: repairCompletion.observedEstimatedTokens,
        repairObservedCodePoints: repairCompletion.observedCodePoints,
        repairFinishReason: repairResult.generationFinishReason,
        repairCompletionTokens: repairResult.completionTokens,
        repairRuntimeTokenCap:
          repairResult.performancePolicy?.maxOutputTokens ?? 0,
        repairStageHardCap: BROWSER_BOUNDED_REPAIR_MAX_TOKENS,
        repairContentCharacters: repairResult.content.length,
        repairReportedRawOutputCharacters: repairResult.rawOutputCharacters,
        repairReportedNormalizedOutputCharacters:
          repairResult.normalizedOutputCharacters,
      }),
    );
    if (
      repairCompletion?.rawBudgetExceeded
      && !repairCompletion.contractSatisfied
      && !targetRangeOversizedRepairFreshRecoveryCandidate
    ) {
      const selectedCompletion = selectVerifiedBrowserLengthSafePrefix({
        completion: repairCompletion,
        result: repairResult,
        stageHardCap: BROWSER_BOUNDED_REPAIR_MAX_TOKENS,
        requiredGenerativeExecutor,
      });
      if (!selectedCompletion) {
        throw Object.assign(explicitEscalationError(
          eligibility,
          "BROWSER_AI_QUALITY_INSUFFICIENT",
        ), {
          qualityDecision: "block",
          qualityReasonCodes: ["QUALITY_OUTPUT_TRUNCATED"],
          observedHanCharacters: repairCompletion.observedHanCharacters,
          requiredHanCharacters: [220, 320],
          browserRuntimeEvidence,
          fallbackAttempted: false,
          canonicalMutationCount: 0,
        });
      }
      repairCompletion = selectedCompletion;
    }
    let acceptedResult: PlatformAIResult = initialResult;
    let repairQuality = quality!;
    if (
      !repairInternalEnvelopeRecovery
      && !targetRangeOversizedRepairFreshRecoveryCandidate
    ) {
      const acceptedRepairContent = repairCompletion?.content ?? repairResult.content;
      repairResult = {
        ...repairResult,
        content: acceptedRepairContent,
        outputCharacters: acceptedRepairContent.length,
        ...(input.deferTraditionalChineseNormalization
          ? {}
          : { normalizedOutputCharacters: acceptedRepairContent.length }),
      };
      acceptedResult = repairResult;
      repairQuality = evaluateBrowserCandidateQuality({
        taskType: input.request.taskType,
        content: acceptedRepairContent,
        expectedMinTokens,
        expectedMaxTokens: performancePolicy.reservedOutputTokens,
        requiresStructuredOutput: input.request.requiresStructured,
        approvedContext: executionRequest.context,
        threshold: eligibility.tier === "T1" ? 0.58 : 0.7,
        deferTraditionalChineseQuality:
          input.deferTraditionalChineseNormalization,
      });
    }
    const initialQualityReasonCodes = quality?.reasonCodes ?? [];
    const degenerateInitialRepairFreshRecoveryCandidate = Boolean(
      defaultChapterProseContract
      && requiredGenerativeExecutor === "webllm-worker"
      && initialResult.content.trim().length > 0
      && chapterProseContract
      && repairCompletion
      && isBrowserDegenerateInitialRepairFreshRecoveryCandidate({
        initialContractSatisfied: chapterProseContract.contractSatisfied,
        initialSafetyCode: chapterProseContract.safetyCode,
        initialFailureCode: chapterProseContract.failureCode,
        initialRawBudgetExceeded: chapterProseContract.rawBudgetExceeded,
        initialObservedHanCharacters: chapterProseContract.observedHanCharacters,
        initialFinishReason: initialResult.generationFinishReason,
        repairContractSatisfied: repairCompletion.contractSatisfied,
        repairSafetyCode: repairCompletion.safetyCode,
        repairFailureCode: repairCompletion.failureCode,
        repairRawBudgetExceeded: repairCompletion.rawBudgetExceeded,
        repairObservedHanCharacters: repairCompletion.observedHanCharacters,
        repairFinishReason: repairResult.generationFinishReason,
        repairQualityReasonCodes: repairQuality.reasonCodes,
      }),
    );
    const collapsedRepairFreshRecoveryCandidate = Boolean(
      defaultChapterProseContract
      && requiredGenerativeExecutor === "webllm-worker"
      && !repairInternalEnvelopeRecovery
      && !initialIsolatedRepairReasonCode
      && chapterProseContract
      && repairCompletion
      && isBrowserCollapsedRepairFreshRecoveryCandidate({
        initialContractSatisfied: chapterProseContract.contractSatisfied,
        initialSafetyCode: chapterProseContract.safetyCode,
        initialFailureCode: chapterProseContract.failureCode,
        initialRawBudgetExceeded: chapterProseContract.rawBudgetExceeded,
        initialObservedHanCharacters: chapterProseContract.observedHanCharacters,
        initialFinishReason: initialResult.generationFinishReason,
        initialQualityReasonCodes,
        repairContractSatisfied: repairCompletion.contractSatisfied,
        repairSafetyCode: repairCompletion.safetyCode,
        repairFailureCode: repairCompletion.failureCode,
        repairRawBudgetExceeded: repairCompletion.rawBudgetExceeded,
        repairObservedHanCharacters: repairCompletion.observedHanCharacters,
        repairFinishReason: repairResult.generationFinishReason,
      }),
    );
    const cappedInitialCollapsedRepairFreshRecoveryCandidate = Boolean(
      defaultChapterProseContract
      && requiredGenerativeExecutor === "webllm-worker"
      && !repairInternalEnvelopeRecovery
      && !initialIsolatedRepairReasonCode
      && chapterProseContract
      && repairCompletion
      && isBrowserCappedInitialCollapsedRepairFreshRecoveryCandidate({
        initialContractSatisfied: chapterProseContract.contractSatisfied,
        initialSafetyCode: chapterProseContract.safetyCode,
        initialFailureCode: chapterProseContract.failureCode,
        initialRawBudgetExceeded: chapterProseContract.rawBudgetExceeded,
        initialObservedHanCharacters:
          chapterProseContract.observedHanCharacters,
        initialObservedEstimatedTokens:
          chapterProseContract.observedEstimatedTokens,
        initialObservedCodePoints: chapterProseContract.observedCodePoints,
        initialFinishReason: initialResult.generationFinishReason,
        initialCompletionTokens: initialResult.completionTokens,
        initialRuntimeTokenCap:
          initialResult.performancePolicy?.maxOutputTokens ?? 0,
        initialStageHardCap: performancePolicy.reservedOutputTokens,
        repairContractSatisfied: repairCompletion.contractSatisfied,
        repairSafetyCode: repairCompletion.safetyCode,
        repairFailureCode: repairCompletion.failureCode,
        repairRawBudgetExceeded: repairCompletion.rawBudgetExceeded,
        repairObservedHanCharacters: repairCompletion.observedHanCharacters,
        repairObservedEstimatedTokens: repairCompletion.observedEstimatedTokens,
        repairObservedCodePoints: repairCompletion.observedCodePoints,
        repairFinishReason: repairResult.generationFinishReason,
        repairCompletionTokens: repairResult.completionTokens,
        repairRuntimeTokenCap:
          repairResult.performancePolicy?.maxOutputTokens ?? 0,
        repairStageHardCap: BROWSER_BOUNDED_REPAIR_MAX_TOKENS,
      }),
    );
    const extensionBaseCandidates: Array<{
      stage: "initial" | "repair";
      result: PlatformAIResult;
      completion: ReturnType<typeof assessBrowserProseCompletion>;
      quality: ReturnType<typeof evaluateBrowserCandidateQuality>;
    }> = [];
    if (
      !repairInternalEnvelopeRecovery
      && !degenerateInitialRepairFreshRecoveryCandidate
      && !collapsedRepairFreshRecoveryCandidate
      && !cappedInitialCollapsedRepairFreshRecoveryCandidate
      && !targetRangeOversizedRepairFreshRecoveryCandidate
      && !initialIsolatedRepairReasonCode
      && repairCompletion
      && shouldRunBrowserProseExtension({
        taskType: input.request.taskType,
        explicitLengthRequested: !defaultChapterProseContract,
        contractSatisfied: repairCompletion.contractSatisfied,
        safetyCode: repairCompletion.safetyCode,
        observedHanCharacters: repairCompletion.observedHanCharacters,
        finishReason: repairResult.generationFinishReason,
        qualityReasonCodes: repairQuality.reasonCodes,
      })
    ) {
      extensionBaseCandidates.push({
        stage: "repair",
        result: repairResult,
        completion: repairCompletion,
        quality: repairQuality,
      });
    }
    if (
      !repairInternalEnvelopeRecovery
      && !degenerateInitialRepairFreshRecoveryCandidate
      && !collapsedRepairFreshRecoveryCandidate
      && !cappedInitialCollapsedRepairFreshRecoveryCandidate
      && !targetRangeOversizedRepairFreshRecoveryCandidate
      && !initialIsolatedRepairReasonCode
      && repairCompletion
      && !repairCompletion.contractSatisfied
      && !repairCompletion.safetyCode
      && repairCompletion.observedHanCharacters
        < BROWSER_PROSE_MINIMUM_CONTINUATION_BASE_HAN_CHARACTERS
      && repairResult.generationFinishReason === "stop"
      && chapterProseContract
      && !chapterProseContract.rawBudgetExceeded
      && quality
      && initialQualityReasonCodes.length > 0
      && initialQualityReasonCodes.every((reason) =>
        reason === "QUALITY_LENGTHCOMPLIANCE_LOW"
        || reason === "QUALITY_NARRATIVE_TOO_SHORT")
      && shouldRunBrowserProseExtension({
        taskType: input.request.taskType,
        explicitLengthRequested: !defaultChapterProseContract,
        contractSatisfied: chapterProseContract.contractSatisfied,
        safetyCode: chapterProseContract.safetyCode,
        observedHanCharacters: chapterProseContract.observedHanCharacters,
        finishReason: initialResult.generationFinishReason,
        qualityReasonCodes: initialQualityReasonCodes,
      })
    ) {
      extensionBaseCandidates.push({
        stage: "initial",
        result: initialResult,
        completion: chapterProseContract,
        quality,
      });
    }
    extensionBaseCandidates.sort((left, right) =>
      right.completion.observedHanCharacters - left.completion.observedHanCharacters
      || right.quality.score - left.quality.score);
    const extensionBase = extensionBaseCandidates[0] ?? null;
    let extensionResult: PlatformAIResult | null = null;
    let recoveryResult: PlatformAIResult | null = null;
    let extensionBaseDigest: string | null = null;
    let extensionDigest: string | null = null;
    if (
      requiredGenerativeExecutor === "webllm-worker"
      && extensionBase
    ) {
      extensionBaseDigest = await sha256Hex(extensionBase.result.content);
      const continuationSeed = buildBrowserProseContinuationSeed({
        baseContent: extensionBase.result.content,
        baseDigest: extensionBaseDigest,
      });
      if (!continuationSeed) {
        throw Object.assign(explicitEscalationError(
          eligibility,
          "BROWSER_AI_QUALITY_INSUFFICIENT",
        ), {
          qualityDecision: "block",
          qualityReasonCodes: ["QUALITY_TASK_FORM_MISMATCH"],
          browserRuntimeEvidence,
          fallbackAttempted: false,
          canonicalMutationCount: 0,
        });
      }
      try {
        extensionResult = await runPass(
          {
            ...executionRequest,
            requestId: `${input.request.requestId}:bounded-prose-extension`,
            input: [
              input.request.input.trim(),
              "接續未核准短稿，補足同一場景的新行動與後果。",
            ].filter(Boolean).join("\n"),
            qualityPhase: "revision",
            agentPlan: undefined,
            toolResults: [],
            workingMaterials: [],
            generationOptions: {
              ...input.request.generationOptions,
              seed: passSeed(input.request.generationOptions?.seed, 194),
              temperature: Math.min(
                Math.max(input.request.generationOptions?.temperature ?? 0.68, 0.66),
                0.74,
              ),
              topP: Math.min(
                Math.max(input.request.generationOptions?.topP ?? 0.88, 0.86),
                0.92,
              ),
              maxTokens: BROWSER_BOUNDED_EXTENSION_MAX_TOKENS,
              repetitionPenalty: Math.max(
                input.request.generationOptions?.repetitionPenalty ?? 1.08,
                1.12,
              ),
            },
          },
          input.decision,
          input.onProgress,
          {
            preferLightweightRuntime: false,
            requiredGenerativeExecutor,
            unapprovedContinuationSeed: continuationSeed,
            deferTraditionalChineseNormalization:
              input.deferTraditionalChineseNormalization,
          },
        );
      } catch (error) {
        throw attachBrowserRuntimeEvidence(error, [
          ...browserRuntimeEvidence,
          unavailableBrowserRuntimePassEvidence("extension"),
        ]);
      }
      browserRuntimeEvidence.push(browserRuntimePassEvidence(
        "extension",
        extensionResult,
        assessBrowserProseCompletion(extensionResult.content).observedHanCharacters,
      ));
      try {
        assertVerifiedClosedWebLLMBoundary(
          extensionResult,
          input.decision,
          BROWSER_BOUNDED_EXTENSION_MAX_TOKENS,
          `${input.request.requestId}:bounded-prose-extension`,
        );
        assertVerifiedExecutor(extensionResult, requiredGenerativeExecutor);
        assertSameVerifiedBrowserModel(extensionBase.result, extensionResult);
      } catch (error) {
        throw attachBrowserRuntimeEvidence(error, browserRuntimeEvidence);
      }
      if (extensionResult.generationFinishReason !== "stop") {
        throw Object.assign(explicitEscalationError(
          eligibility,
          "BROWSER_AI_QUALITY_INSUFFICIENT",
        ), {
          qualityDecision: "block",
          qualityReasonCodes: ["QUALITY_OUTPUT_TRUNCATED"],
          browserRuntimeEvidence,
          fallbackAttempted: false,
          canonicalMutationCount: 0,
        });
      }
      const merged = mergeBrowserProseContinuation({
        baseContent: extensionBase.result.content,
        continuationContent: extensionResult.content,
        anchor: continuationSeed.anchor,
      });
      if (!merged.contractSatisfied || !merged.content) {
        const mergeReasonCode = browserProseMergeReasonCode(merged.reason);
        throw Object.assign(explicitEscalationError(
          eligibility,
          "BROWSER_AI_QUALITY_INSUFFICIENT",
        ), {
          qualityDecision: "block",
          qualityReasonCodes: merged.reason === "combined-contract-unsatisfied"
            && (merged.observedHanCharacters ?? 0) < 220
            ? [
              "QUALITY_LENGTHCOMPLIANCE_LOW",
              "QUALITY_NARRATIVE_TOO_SHORT",
              ...(mergeReasonCode ? [mergeReasonCode] : []),
            ]
            : [mergeReasonCode ?? "QUALITY_TASK_FORM_MISMATCH"],
          observedHanCharacters: merged.observedHanCharacters ?? null,
          requiredHanCharacters: [220, 320],
          browserRuntimeEvidence,
          fallbackAttempted: false,
          canonicalMutationCount: 0,
        });
      }
      extensionDigest = await sha256Hex(extensionResult.content);
      acceptedResult = {
        ...extensionResult,
        content: merged.content,
        outputCharacters: merged.content.length,
        ...(input.deferTraditionalChineseNormalization
          ? {}
          : { normalizedOutputCharacters: merged.content.length }),
      };
      repairQuality = evaluateBrowserCandidateQuality({
        taskType: input.request.taskType,
        content: merged.content,
        expectedMinTokens,
        expectedMaxTokens: performancePolicy.reservedOutputTokens,
        requiresStructuredOutput: input.request.requiresStructured,
        approvedContext: executionRequest.context,
        threshold: eligibility.tier === "T1" ? 0.58 : 0.7,
        deferTraditionalChineseQuality:
          input.deferTraditionalChineseNormalization,
      });
    }
    const repairTruncatedFreshRecoveryCandidate = Boolean(
      !repairInternalEnvelopeRecovery
      && repairCompletion
      && isBrowserTruncatedFreshRecoveryCandidate({
        ...repairCompletion,
        finishReason: repairResult.generationFinishReason,
        qualityReasonCodes: repairQuality.reasonCodes,
      }),
    );
    const initialTruncatedFreshRecoveryCandidate = Boolean(
      !repairInternalEnvelopeRecovery
      && chapterProseContract
      && quality
      && repairCompletion
      && repairCompletion.observedHanCharacters
        < BROWSER_PROSE_MINIMUM_CONTINUATION_BASE_HAN_CHARACTERS
      && isBrowserTruncatedFreshRecoveryCandidate({
        ...chapterProseContract,
        finishReason: initialResult.generationFinishReason,
        qualityReasonCodes: initialQualityReasonCodes,
      }),
    );
    const standardStopFreshRecoveryCandidate = Boolean(
      initialResult.generationFinishReason === "stop"
      && repairResult.generationFinishReason === "stop"
      && (
        repairInternalEnvelopeRecovery
        || targetRangeOversizedRepairFreshRecoveryCandidate
        || (
          !repairCompletion?.safetyCode
          && !repairCompletion?.rawBudgetExceeded
          && (
            repairTruncatedFreshRecoveryCandidate
            || initialTruncatedFreshRecoveryCandidate
            || degenerateInitialRepairFreshRecoveryCandidate
            || collapsedRepairFreshRecoveryCandidate
            || (
              chapterProseContract
              && repairCompletion
              && chapterProseContract.observedHanCharacters
                < BROWSER_PROSE_MINIMUM_CONTINUATION_BASE_HAN_CHARACTERS
              && repairCompletion.observedHanCharacters
                < BROWSER_PROSE_MINIMUM_CONTINUATION_BASE_HAN_CHARACTERS
            )
          )
        )
      )
    );
    const shouldRunFreshRecovery = Boolean(
      requiredGenerativeExecutor === "webllm-worker"
      && !initialIsolatedRepairReasonCode
      && defaultChapterProseContract
      && !extensionBase
      && !extensionResult
      && chapterProseContract
      && repairCompletion
      && !chapterProseContract.contractSatisfied
      && !repairCompletion.contractSatisfied
      && !chapterProseContract.safetyCode
      && !chapterProseContract.rawBudgetExceeded
      && initialResult.content.trim().length > 0
      && (
        repairInternalEnvelopeRecovery
        || targetRangeOversizedRepairFreshRecoveryCandidate
        || repairResult.content.trim().length > 0
      )
      && (
        cappedInitialCollapsedRepairFreshRecoveryCandidate
        || standardStopFreshRecoveryCandidate
      )
    );
    if (shouldRunFreshRecovery) {
      const recoveryRequestId = `${input.request.requestId}:bounded-fresh-recovery`;
      const recoveryRequest: PlatformAIRequest = {
        ...executionRequest,
        requestId: recoveryRequestId,
        input: buildBrowserFreshRecoveryObjective(input.request.input),
        qualityPhase: "draft",
        agentPlan: undefined,
        toolResults: [],
        workingMaterials: [],
        generationOptions: {
          ...input.request.generationOptions,
          seed: passSeed(input.request.generationOptions?.seed, 291),
          temperature: Math.min(
            Math.max(input.request.generationOptions?.temperature ?? 0.68, 0.66),
            0.74,
          ),
          topP: Math.min(
            Math.max(input.request.generationOptions?.topP ?? 0.88, 0.86),
            0.92,
          ),
          maxTokens: BROWSER_BOUNDED_FRESH_RECOVERY_MAX_TOKENS,
          repetitionPenalty: Math.max(
            input.request.generationOptions?.repetitionPenalty ?? 1.08,
            1.12,
          ),
        },
      };
      // A public or stale request shape must never activate or carry the
      // internal continuation-seed channel into a standalone recovery draft.
      Reflect.deleteProperty(recoveryRequest, "unapprovedContinuationSeed");
      try {
        recoveryResult = await runPass(
          recoveryRequest,
          input.decision,
          input.onProgress,
          {
            preferLightweightRuntime: false,
            requiredGenerativeExecutor,
            deferTraditionalChineseNormalization:
              input.deferTraditionalChineseNormalization,
          },
        );
      } catch (error) {
        throw attachBrowserRuntimeEvidence(error, [
          ...browserRuntimeEvidence,
          unavailableBrowserRuntimePassEvidence("recovery"),
        ]);
      }
      const recoveryCompletion = assessBrowserProseCompletion(recoveryResult.content);
      browserRuntimeEvidence.push(browserRuntimePassEvidence(
        "recovery",
        recoveryResult,
        recoveryCompletion.observedHanCharacters,
      ));
      try {
        assertVerifiedClosedWebLLMBoundary(
          recoveryResult,
          input.decision,
          BROWSER_BOUNDED_FRESH_RECOVERY_MAX_TOKENS,
          recoveryRequestId,
        );
        assertVerifiedExecutor(recoveryResult, requiredGenerativeExecutor);
        assertSameVerifiedBrowserModel(initialResult, recoveryResult);
      } catch (error) {
        throw attachBrowserRuntimeEvidence(error, browserRuntimeEvidence);
      }
      if (recoveryCompletion.safetyCode) {
        throw Object.assign(explicitEscalationError(
          eligibility,
          "BROWSER_AI_QUALITY_INSUFFICIENT",
        ), {
          qualityDecision: "block",
          qualityReasonCodes: [browserProseSafetyReasonCode(
            recoveryCompletion.safetyCode,
          )],
          browserRuntimeEvidence,
          fallbackAttempted: false,
          canonicalMutationCount: 0,
        });
      }
      if (
        recoveryResult.generationFinishReason !== "stop"
        || recoveryCompletion.rawBudgetExceeded
        || !recoveryCompletion.contractSatisfied
        || !recoveryCompletion.content
        || recoveryCompletion.observedHanCharacters
          > recoveryCompletion.maximumHanCharacters
        || recoveryCompletion.selectedHanCharacters
          !== recoveryCompletion.observedHanCharacters
        || recoveryCompletion.selectedCodePoints
          !== recoveryCompletion.observedCodePoints
      ) {
        throw Object.assign(explicitEscalationError(
          eligibility,
          "BROWSER_AI_QUALITY_INSUFFICIENT",
        ), {
          qualityDecision: "block",
          qualityReasonCodes:
            recoveryResult.generationFinishReason === "stop"
            && !recoveryCompletion.rawBudgetExceeded
            && recoveryCompletion.observedHanCharacters < 220
              ? ["QUALITY_LENGTHCOMPLIANCE_LOW", "QUALITY_NARRATIVE_TOO_SHORT"]
              : ["QUALITY_OUTPUT_TRUNCATED"],
          observedHanCharacters: recoveryCompletion.observedHanCharacters,
          requiredHanCharacters: [220, 320],
          browserRuntimeEvidence,
          fallbackAttempted: false,
          canonicalMutationCount: 0,
        });
      }
      const recoveredContent = recoveryCompletion.content;
      recoveryResult = {
        ...recoveryResult,
        content: recoveredContent,
        outputCharacters: recoveredContent.length,
        ...(input.deferTraditionalChineseNormalization
          ? {}
          : { normalizedOutputCharacters: recoveredContent.length }),
      };
      acceptedResult = recoveryResult;
      repairQuality = evaluateBrowserCandidateQuality({
        taskType: input.request.taskType,
        content: recoveredContent,
        expectedMinTokens,
        expectedMaxTokens: performancePolicy.reservedOutputTokens,
        requiresStructuredOutput: input.request.requiresStructured,
        approvedContext: executionRequest.context,
        threshold: eligibility.tier === "T1" ? 0.58 : 0.7,
        deferTraditionalChineseQuality:
          input.deferTraditionalChineseNormalization,
      });
      if (repairQuality.decision !== "pass") {
        throw Object.assign(explicitEscalationError(
          eligibility,
          "BROWSER_AI_QUALITY_INSUFFICIENT",
        ), {
          qualityScore: repairQuality.score,
          qualityDecision: repairQuality.decision,
          qualityReasonCodes: browserFreshRecoveryQualityReasonCodes(
            repairQuality.reasonCodes,
          ),
          browserRuntimeEvidence,
          fallbackAttempted: false,
          canonicalMutationCount: 0,
        });
      }
    }
    if (
      repairCompletion
      && !repairCompletion.contractSatisfied
      && !extensionResult
      && !recoveryResult
    ) {
      throw Object.assign(explicitEscalationError(
        eligibility,
        "BROWSER_AI_QUALITY_INSUFFICIENT",
      ), {
        qualityDecision: "block",
        qualityReasonCodes: repairResult.generationFinishReason !== "stop"
          ? ["QUALITY_OUTPUT_TRUNCATED"]
          : repairCompletion.observedHanCharacters < 220
            ? ["QUALITY_LENGTHCOMPLIANCE_LOW", "QUALITY_NARRATIVE_TOO_SHORT"]
            : ["QUALITY_OUTPUT_TRUNCATED"],
        observedHanCharacters: repairCompletion.observedHanCharacters,
        requiredHanCharacters: [220, 320],
        browserRuntimeEvidence,
        fallbackAttempted: false,
        canonicalMutationCount: 0,
      });
    }
    const passes = [
      initialResult,
      repairResult,
      ...(extensionResult ? [extensionResult] : []),
      ...(recoveryResult ? [recoveryResult] : []),
    ];
    const totalCompletionTokens = passes.every((pass) =>
      typeof pass.completionTokens === "number")
      ? passes.reduce((sum, pass) => sum + (pass.completionTokens ?? 0), 0)
      : null;
    result = {
      ...acceptedResult,
      requestId: input.request.requestId,
      elapsedMs: passes.reduce((sum, pass) => sum + (pass.elapsedMs ?? 0), 0),
      firstTokenMs: passes.slice(0, -1).reduce(
        (sum, pass) => sum + (pass.elapsedMs ?? 0),
        acceptedResult.firstTokenMs ?? 0,
      ),
      inputCharacters: passes.reduce(
        (sum, pass) => sum + (pass.inputCharacters ?? 0),
        0,
      ),
      outputCharacters: acceptedResult.content.length,
      generatedTokenEvents: passes.reduce(
        (sum, pass) => sum + (pass.generatedTokenEvents ?? 0),
        0,
      ),
      omittedInputCharacters: passes.reduce(
        (sum, pass) => sum + (pass.omittedInputCharacters ?? 0),
        0,
      ),
      queueWaitMs: passes.reduce((sum, pass) => sum + (pass.queueWaitMs ?? 0), 0),
      completionTokens: totalCompletionTokens,
      rawOutputCharacters: passes.reduce(
        (sum, pass) => sum + (pass.rawOutputCharacters ?? pass.outputCharacters ?? 0),
        0,
      ),
      ...(input.deferTraditionalChineseNormalization
        ? {}
        : { normalizedOutputCharacters: acceptedResult.content.length }),
      runtimeStats: [
        acceptedResult.runtimeStats,
        "bounded-same-model-repair=1",
        `bounded-prose-extension=${extensionResult ? "1" : "0"}`,
        `bounded-fresh-recovery=${recoveryResult ? "1" : "0"}`,
        `initial-finish=${initialResult.generationFinishReason ?? "unavailable"}`,
        `repair-finish=${repairResult.generationFinishReason ?? "unavailable"}`,
        ...(extensionResult
          ? [
            `extension-finish=${extensionResult.generationFinishReason ?? "unavailable"}`,
            `extension-base-stage=${extensionBase?.stage ?? "unavailable"}`,
          ]
          : []),
        ...(recoveryResult
          ? [`recovery-finish=${recoveryResult.generationFinishReason ?? "unavailable"}`]
          : []),
        ...(initialDigest
          ? [`initial-output-digest=${initialDigest}`]
          : [initialStopBudgetRepairReasonCode
            ? "initial-output-disposition=oversized-stop-rejected-memory-only"
            : "initial-output-disposition=safety-rejected-memory-only"]),
        ...(extensionDigest ? [`extension-output-digest=${extensionDigest}`] : []),
        ...(extensionBaseDigest
          ? [`extension-base-digest=${extensionBaseDigest}`]
          : []),
        ...(extensionResult && extensionBase?.stage === "initial"
          ? ["repair-output-disposition=shorter-intermediate-memory-only"]
          : []),
        ...(recoveryResult
          ? [
            "initial-output-disposition=rejected-intermediate-memory-only",
            "repair-output-disposition=rejected-intermediate-memory-only",
          ]
          : []),
        `initial-quality-reasons=${repairPlan.reasonCodes.join(",")}`,
        "intermediate-content=pipeline-memory-only",
      ].filter(Boolean).join("; "),
      provenance: {
        ...acceptedResult.provenance,
        warnings: [
          ...acceptedResult.provenance.warnings,
          initialSafetyRepairReasonCode
            ? "One isolated safety repair ran on the same verified Browser executor; rejected initial text remained in memory, was not reused as model input, and no provider fallback occurred."
            : initialStopBudgetRepairReasonCode
              ? "One isolated oversized-output repair ran on the same verified Browser executor; rejected initial text remained in memory, was not reused as model input, and no provider fallback occurred."
            : recoveryResult
              ? "One bounded repair and one fresh recovery draft ran on the same verified Browser executor; both rejected intermediate texts remained in memory, were not reused as model input, and no provider fallback occurred."
            : "One bounded repair and at most one normal-EOS suffix extension ran on the same verified Browser executor; rejected intermediate text remained in memory and no provider fallback occurred.",
        ],
      },
    };
    quality = repairQuality;
  }

  if (!quality) {
    throw Object.assign(explicitEscalationError(
      eligibility,
      "BROWSER_AI_QUALITY_INSUFFICIENT",
    ), {
      qualityDecision: "block",
      qualityReasonCodes: initialSafetyReasonCode
        ? [initialSafetyReasonCode]
        : ["QUALITY_TASK_FORM_MISMATCH"],
      browserRuntimeEvidence,
      fallbackAttempted: false,
      canonicalMutationCount: 0,
    });
  }
  return { result, quality, browserRuntimeEvidence };
}


export async function executeBrowserCompute(input: {
  request: PlatformAIRequest;
  decision: PlatformRouterDecision;
  deferTraditionalChineseNormalization?: boolean;
  onProgress?: (progress: BrowserAIStreamProgress) => void;
}): Promise<BrowserComputeExecution> {
  const started = performance.now();
  const policy = input.request.browserComputePolicy ?? "browser-first";
  const [capability, webLlm, semantic] = await Promise.all([
    detectBrowserAI(),
    browserWebLLMRuntimeSnapshot().catch(() => null),
    browserSemanticRuntimeSnapshot().catch(() => null),
  ]);
  const selected = webLlm?.models.find((model) => model.modelId === webLlm.selectedModelId) ?? null;
  const selectedManifest = browserWebLLMModel(selected?.modelId)
    ?? BROWSER_WEBLLM_MODELS[0];
  const benchmark = selected?.shardIntegrityVerified
    ? await readBrowserDeviceBenchmark(
      selected.modelId,
      selected.modelDigest,
    ).catch(() => null)
    : null;
  const proof = getBrowserAIInferenceProof();
  const inferenceProofVerified = capability.generativeRuntime === "webllm-worker"
    ? Boolean(selected?.shardIntegrityVerified && benchmark?.benchmarkPassed)
    : Boolean(
      capability.generativeRuntime === "chromium-prompt-api"
      && (
      proof?.state === "inference_verified"
      && proof.inferenceMode === "generative-model"
      && proof.modelId === BROWSER_LANGUAGE_MODEL_ID
      && isCryptographicClosedAIModelDigest(proof.modelDigest)
      )
    );
  const rawContextTokens = estimateBrowserTokens(
    [...input.request.context, input.request.input].join("\n\n"),
  );
  const performancePolicy = resolveBrowserAIPerformancePolicy({
    device: webLlm?.device ?? {
      supported: true,
      tier: "standard",
      reason: "native_browser_runtime",
      mobile: false,
      webGpu: capability.webGpu,
      wasm: capability.wasm,
      worker: capability.worker,
      indexedDb: typeof indexedDB !== "undefined",
      opfs: false,
      deviceMemoryGB: null,
      hardwareConcurrency: null,
      maxStorageBufferBindingSize: null,
      storageQuota: capability.storageQuota,
      storageUsage: capability.storageUsage,
      storageAvailable: null,
      allowedModelIds: [],
      recommendedModelId: null,
    },
    model: selectedManifest,
    mode: input.request.latencyPreference === "low"
      || input.request.qualityPreference === "fast"
      ? "ECO"
      : input.request.qualityPreference === "high"
        ? "QUALITY"
        : "BALANCED",
    estimatedInputTokens: rawContextTokens,
    requestedMaxTokens: input.request.generationOptions?.maxTokens,
    requestedTemperature: input.request.generationOptions?.temperature,
    requestedTopP: input.request.generationOptions?.topP,
    requestedRepetitionPenalty: input.request.generationOptions?.repetitionPenalty,
    previousTokensPerSecond: selected?.averageTokensPerSecond,
  });
  const sources = await contextSources(
    input.request,
    semantic?.model.cacheVerified ?? false,
  );
  const contextPack = await composeBrowserContextPack({
    namespace: input.request.cacheNamespace!,
    audience: "actor",
    sources,
    performancePolicy,
  });
  const preparedContextTokens = browserEligibilityContextTokens({
    rawContextTokens,
    compressedContextTokens: contextPack.metrics.browserCompressedContextTokens,
    objectiveTokens: estimateBrowserTokens(input.request.input),
  });
  const eligibility = resolveBrowserTaskEligibility({
    taskType: input.request.taskType,
    policy,
    manualProvider: input.request.preferredProvider,
    generativeModelReady: capability.generativeModelReady,
    generativeRuntime: capability.generativeRuntime,
    inferenceProofVerified,
    semanticModelReady: semantic?.model.cacheVerified ?? false,
    modelParameterLabel: selectedManifest.parameterLabel,
    benchmark: capability.generativeRuntime === "chromium-prompt-api"
      && inferenceProofVerified
      ? { benchmarkPassed: true }
      : benchmark,
    contextTokens: preparedContextTokens,
    outputTokens: performancePolicy.reservedOutputTokens,
    qualityPreference: input.request.qualityPreference,
    allowPreAuthorizedClosedEscalation:
      input.request.allowPreAuthorizedClosedEscalation ?? false,
  });
  if (!eligibility.eligible) throw explicitEscalationError(eligibility);
  const executionRequest: PlatformAIRequest = {
    ...input.request,
    input: input.request.input,
    context: contextPack.items.map((item) => `[${item.kind}]\n${item.text}`),
  };
  const requiredGenerativeExecutor = eligibility.tier === "T2"
    && (
      eligibility.browserExecutor === "webllm-worker"
      || eligibility.browserExecutor === "chromium-prompt-api"
    )
    ? eligibility.browserExecutor
    : undefined;
  if (eligibility.tier === "T2" && !requiredGenerativeExecutor) {
    throw explicitEscalationError(
      eligibility,
      "BROWSER_AI_T2_EXECUTOR_NOT_VERIFIED",
    );
  }
  // Closed Agent OS owns planning, critique and revision. A browser task node
  // normally performs one model pass. Direct continuation tasks may run one
  // bounded repair on the same verified executor when the first output ends
  // early, merely copies context, or contains a finite output-safety violation.
  // If both safe attempts are too short to continue, one final fresh draft may
  // use only the approved context and author objective. This never switches
  // providers, reuses rejected prose, or mutates Canon.
  let result = await executeBrowserInitialPass({
    request: executionRequest,
    decision: input.decision,
    onProgress: input.onProgress,
    options: {
      preferLightweightRuntime: eligibility.tier === "T1",
      requiredGenerativeExecutor,
      deferTraditionalChineseNormalization:
        input.deferTraditionalChineseNormalization,
    },
  });
  const qualityPasses = await executeBrowserBoundedQualityPasses({
    request: input.request,
    decision: input.decision,
    executionRequest,
    initialResult: result,
    eligibility,
    performancePolicy,
    requiredGenerativeExecutor,
    onProgress: input.onProgress,
    deferTraditionalChineseNormalization:
      input.deferTraditionalChineseNormalization,
  });
  result = qualityPasses.result;
  const quality = qualityPasses.quality;
  const actualExecutor = result.executor ?? "browser-task-model";
  if (requiredGenerativeExecutor) {
    assertVerifiedExecutor(result, requiredGenerativeExecutor);
  }
  const receipt = await createBrowserExecutionReceipt({
    taskIdentity: `${input.request.projectId}:${input.request.requestId}`,
    taskType: input.request.taskType,
    plannedPipeline: eligibility.plannedPipeline,
    actualExecutor: actualExecutor as BrowserExecutionReceipt["actualExecutor"],
    modelId: result.modelId,
    modelDigest: result.modelDigest ?? null,
    browserPrecomputeUsed: true,
    browserGenerationUsed: actualExecutor === "webllm-worker"
      || actualExecutor === "chromium-prompt-api",
    localOllamaUsed: false,
    privateHubUsed: false,
    externalAIUsed: false,
    dataLeftDevice: false,
    contextTokensBefore: contextPack.metrics.originalContextTokens,
    contextTokensAfter: contextPack.metrics.browserCompressedContextTokens,
    tokensSaved: contextPack.metrics.tokensSaved,
    remoteModelInputTokensSaved: 0,
    remoteModelOutputRepairAvoided: 0,
    remoteModelCallsAvoided: 0,
    privateHubJobsAvoided: 0,
    localOllamaCallsAvoided: eligibility.tier === "T2" ? 1 : 0,
    elapsedMs: Math.round(performance.now() - started),
  });
  await recordBrowserExecutionReceipt(receipt);
  if (quality.decision === "block" || quality.decision === "escalate") {
    throw Object.assign(explicitEscalationError(
      eligibility,
      "BROWSER_AI_QUALITY_INSUFFICIENT",
    ), {
      qualityScore: quality.score,
      qualityDecision: quality.decision,
      qualityReasonCodes: quality.reasonCodes,
      browserRuntimeEvidence: qualityPasses.browserRuntimeEvidence,
      receiptId: receipt.receiptId,
    });
  }
  result.browserCompute = {
    policy,
    tier: eligibility.tier,
    plannedPipeline: eligibility.plannedPipeline,
    actualExecutor,
    qualityDecision: quality.decision,
    qualityScore: quality.score,
    contextTokensBefore: contextPack.metrics.originalContextTokens,
    contextTokensAfter: contextPack.metrics.browserCompressedContextTokens,
    tokensSaved: contextPack.metrics.tokensSaved,
    receiptId: receipt.receiptId,
    inferenceProof: eligibility.tier === "T2" ? "verified" : "not_required",
    canonicalMutationCount: 0,
  };
  return {
    schemaVersion: BROWSER_COMPUTE_ORCHESTRATOR_VERSION,
    result,
    eligibility,
    quality,
    receipt,
    contextMetrics: {
      originalContextTokens: contextPack.metrics.originalContextTokens,
      browserCompressedContextTokens: contextPack.metrics.browserCompressedContextTokens,
      tokensSaved: contextPack.metrics.tokensSaved,
      compressionRatio: contextPack.metrics.compressionRatio,
      retrievalPrecision: contextPack.metrics.retrievalPrecision,
    },
  };
}

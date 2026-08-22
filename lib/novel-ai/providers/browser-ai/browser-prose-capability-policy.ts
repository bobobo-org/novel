import type { PlatformTaskType } from "../../router/platform-types";
import {
  BROWSER_PROSE_QUALIFICATION_SCHEMA_VERSION,
  browserWebLLMModel,
  type BrowserProseQualificationArtifact,
  type BrowserWebLLMModelManifest,
} from "./webllm-model-registry";
import {
  BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY_DIGEST,
  BROWSER_PROSE_CANDIDATE_V2_IDENTITY,
} from "./browser-prose-candidate-v2";

export const LOW_TIER_BROWSER_PROSE_NOT_PRODUCTION_QUALIFIED =
  "LOW_TIER_BROWSER_PROSE_NOT_PRODUCTION_QUALIFIED" as const;
export const BROWSER_PROSE_ROUTER_RUNTIME_IDENTITY_MISMATCH =
  "BROWSER_PROSE_ROUTER_RUNTIME_IDENTITY_MISMATCH" as const;

export const BROWSER_PROSE_TIER_PRIMARY_GUIDANCE =
  "Browser AI 的完整小說正文尚未取得正式資格。請明確選擇本機 Ollama 或私有 AI 中樞；Browser AI 的輕量創作功能仍可使用。" as const;

export const BROWSER_PROSE_TIER_CAPABILITY_DECISION_SCHEMA_VERSION =
  "p24b-rc6.4-browser-prose-tier-capability-decision-v1" as const;
export const BROWSER_PROSE_TIER_EXECUTION_DECISION_SCHEMA_VERSION =
  "p24b-rc6.4-browser-prose-tier-execution-decision-v1" as const;
export const BROWSER_PROSE_TIER_CAPABILITY_DECISION_DIGEST_DOMAIN =
  "p24b-rc6.4-browser-prose-tier-capability-decision-v1" as const;

export const BROWSER_LOW_TIER_ALLOWED_TASK_CATEGORIES = Object.freeze([
  "summary",
  "consistency-check",
  "timeline-check",
  "retrieval",
  "classification",
  "short-rewrite",
] as const);

export const BROWSER_LOW_TIER_FORBIDDEN_PROSE_TASKS = Object.freeze([
  "chapter.continue",
  "chapter.expand",
] as const satisfies readonly PlatformTaskType[]);

export const BROWSER_PROSE_TIER_CAPABILITY_DECISION_RECEIPT = Object.freeze({
  schemaVersion: BROWSER_PROSE_TIER_CAPABILITY_DECISION_SCHEMA_VERSION,
  decisionCode: LOW_TIER_BROWSER_PROSE_NOT_PRODUCTION_QUALIFIED,
  adjustmentRound: 2 as const,
  prosePassClaimed: false as const,
  lowTier: "0.5B" as const,
  // Historical RC6.4 qualification-lab floor retained solely to preserve the
  // pinned receipt digest. It is not a Product prose qualification claim.
  requiredProseTier: "1.5B" as const,
  allowedLowTierTaskCategories: BROWSER_LOW_TIER_ALLOWED_TASK_CATEGORIES,
  forbiddenLowTierBrowserProseTasks: BROWSER_LOW_TIER_FORBIDDEN_PROSE_TASKS,
});

// This digest is pinned to stableStringify({ domain, receipt }) and is checked
// by the focused Product capability gate. It contains no attempt identifiers,
// model output, prompt, project data, or live environment observations.
export const BROWSER_PROSE_TIER_CAPABILITY_DECISION_RECEIPT_DIGEST =
  "9a7ff2b58e6d634322db6932c66a1fd954ea18ae76ac9d0c82464d6a873b9b03" as const;

export type BrowserProseModelTier =
  BrowserWebLLMModelManifest["parameterLabel"] | null;

export type BrowserProseTierExecutionDecisionReceipt = Readonly<{
  schemaVersion: typeof BROWSER_PROSE_TIER_EXECUTION_DECISION_SCHEMA_VERSION;
  productDecisionReceiptDigest:
    typeof BROWSER_PROSE_TIER_CAPABILITY_DECISION_RECEIPT_DIGEST;
  taskType: PlatformTaskType;
  selectedModelTier: BrowserProseModelTier;
  disposition:
    | "not-applicable"
    | "prose-tier-qualified"
    | "blocked-low-tier-browser-prose";
  reasonCode:
    | "BROWSER_PROSE_TIER_NOT_APPLICABLE"
    | "BROWSER_PROSE_TIER_PRODUCTION_QUALIFIED"
    | typeof LOW_TIER_BROWSER_PROSE_NOT_PRODUCTION_QUALIFIED;
  eligible: boolean;
  modelCallClaimed: false;
  fallbackAttempted: false;
}>;

const PROSE_TASK_SET = new Set<PlatformTaskType>(
  BROWSER_LOW_TIER_FORBIDDEN_PROSE_TASKS,
);
const SHA256_HEX = /^[a-f0-9]{64}$/u;

export function isBrowserFullProseTask(
  taskType: PlatformTaskType,
): taskType is (typeof BROWSER_LOW_TIER_FORBIDDEN_PROSE_TASKS)[number] {
  return PROSE_TASK_SET.has(taskType);
}

export function browserProseModelTierFromModelId(
  modelId: string | null | undefined,
): BrowserProseModelTier {
  return browserWebLLMModel(modelId)?.parameterLabel ?? null;
}

export function browserModelIsProductionQualifiedForTask(input: Readonly<{
  taskType: PlatformTaskType;
  model: Pick<BrowserWebLLMModelManifest, "modelId" | "modelDigest">;
}>) {
  if (!isBrowserFullProseTask(input.taskType)) return true;
  const canonicalModel = browserWebLLMModel(input.model.modelId);
  return Boolean(
    canonicalModel
    && canonicalModel.modelDigest === input.model.modelDigest
    && canonicalModel.productionQualified
    && canonicalModel.usePolicy === "production"
    && browserProseQualificationArtifactMatchesModel({
      taskType: input.taskType,
      model: canonicalModel,
      artifact: canonicalModel.proseQualification,
    }),
  );
}

export function browserProseQualificationArtifactMatchesModel(input: Readonly<{
  taskType: PlatformTaskType;
  model: Pick<BrowserWebLLMModelManifest, "modelId" | "modelDigest">;
  artifact: BrowserProseQualificationArtifact | null;
}>) {
  return isBrowserFullProseTask(input.taskType)
    && input.artifact?.schemaVersion
      === BROWSER_PROSE_QUALIFICATION_SCHEMA_VERSION
    && input.artifact.modelId === input.model.modelId
    && input.artifact.modelDigest === input.model.modelDigest
    && input.artifact.candidateIdentityDigest
      === BROWSER_PROSE_CANDIDATE_V2_IDENTITY.candidateIdentityDigest
    && input.artifact.generationPolicyDigest
      === BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY_DIGEST
    && SHA256_HEX.test(input.artifact.liveQualificationEvidenceDigest)
    && SHA256_HEX.test(input.artifact.formalApprovalDigest)
    && input.artifact.qualifiedTasks.some((task) => task === input.taskType);
}

export function browserModelIdentityIsProductionQualifiedForTask(
  input: Readonly<{
    taskType: PlatformTaskType;
    modelId: string | null | undefined;
    modelDigest: string | null | undefined;
  }>,
) {
  const model = browserWebLLMModel(input.modelId);
  return Boolean(
    model
    && model.modelDigest === input.modelDigest
    && browserModelIsProductionQualifiedForTask({
      taskType: input.taskType,
      model,
    }),
  );
}

export function createBrowserProseTierExecutionDecision(input: Readonly<{
  taskType: PlatformTaskType;
  selectedModelTier: BrowserProseModelTier;
  selectedModelId?: string | null;
  selectedModelDigest?: string | null;
  executor: "webllm-worker" | "chromium-prompt-api" | null;
}>): BrowserProseTierExecutionDecisionReceipt {
  const proseTask = isBrowserFullProseTask(input.taskType);
  const selectedManifest = browserWebLLMModel(input.selectedModelId);
  const browserProseQualified = input.executor === "webllm-worker"
    && selectedManifest !== null
    && selectedManifest.modelDigest === input.selectedModelDigest
    && selectedManifest.parameterLabel === input.selectedModelTier
    && browserModelIdentityIsProductionQualifiedForTask({
      taskType: input.taskType,
      modelId: input.selectedModelId,
      modelDigest: input.selectedModelDigest,
    });
  const browserProseTierUnqualified = !browserProseQualified;
  if (proseTask && browserProseTierUnqualified) {
    return Object.freeze({
      schemaVersion: BROWSER_PROSE_TIER_EXECUTION_DECISION_SCHEMA_VERSION,
      productDecisionReceiptDigest:
        BROWSER_PROSE_TIER_CAPABILITY_DECISION_RECEIPT_DIGEST,
      taskType: input.taskType,
      selectedModelTier: input.selectedModelTier,
      disposition: "blocked-low-tier-browser-prose",
      reasonCode: LOW_TIER_BROWSER_PROSE_NOT_PRODUCTION_QUALIFIED,
      eligible: false,
      modelCallClaimed: false,
      fallbackAttempted: false,
    });
  }
  if (proseTask && browserProseQualified) {
    return Object.freeze({
      schemaVersion: BROWSER_PROSE_TIER_EXECUTION_DECISION_SCHEMA_VERSION,
      productDecisionReceiptDigest:
        BROWSER_PROSE_TIER_CAPABILITY_DECISION_RECEIPT_DIGEST,
      taskType: input.taskType,
      selectedModelTier: input.selectedModelTier,
      disposition: "prose-tier-qualified",
      reasonCode: "BROWSER_PROSE_TIER_PRODUCTION_QUALIFIED",
      eligible: true,
      modelCallClaimed: false,
      fallbackAttempted: false,
    });
  }
  return Object.freeze({
    schemaVersion: BROWSER_PROSE_TIER_EXECUTION_DECISION_SCHEMA_VERSION,
    productDecisionReceiptDigest:
      BROWSER_PROSE_TIER_CAPABILITY_DECISION_RECEIPT_DIGEST,
    taskType: input.taskType,
    selectedModelTier: input.selectedModelTier,
    disposition: "not-applicable",
    reasonCode: "BROWSER_PROSE_TIER_NOT_APPLICABLE",
    eligible: true,
    modelCallClaimed: false,
    fallbackAttempted: false,
  });
}

export function lowTierBrowserProseCapabilityError(
  receipt: BrowserProseTierExecutionDecisionReceipt,
) {
  return Object.assign(new Error(BROWSER_PROSE_TIER_PRIMARY_GUIDANCE), {
    code: LOW_TIER_BROWSER_PROSE_NOT_PRODUCTION_QUALIFIED,
    reasonCode: receipt.reasonCode,
    browserProseTierDecisionReceipt: receipt,
    browserProseTierCapabilityDecisionReceipt:
      BROWSER_PROSE_TIER_CAPABILITY_DECISION_RECEIPT,
    browserProseTierCapabilityDecisionReceiptDigest:
      BROWSER_PROSE_TIER_CAPABILITY_DECISION_RECEIPT_DIGEST,
    browserProseQualificationRequired: true as const,
    qualifiedBrowserProseAvailable: false as const,
    explicitClosedBackendRequired: true as const,
    fallbackAttempted: false as const,
    modelCallClaimed: false as const,
    canonicalMutationCount: 0 as const,
    retryable: false as const,
  });
}

export function browserProseRouterRuntimeIdentityError(
  receipt: BrowserProseTierExecutionDecisionReceipt,
) {
  return Object.assign(new Error(BROWSER_PROSE_TIER_PRIMARY_GUIDANCE), {
    code: BROWSER_PROSE_ROUTER_RUNTIME_IDENTITY_MISMATCH,
    reasonCode: BROWSER_PROSE_ROUTER_RUNTIME_IDENTITY_MISMATCH,
    browserProseTierDecisionReceipt: receipt,
    browserProseTierCapabilityDecisionReceipt:
      BROWSER_PROSE_TIER_CAPABILITY_DECISION_RECEIPT,
    browserProseTierCapabilityDecisionReceiptDigest:
      BROWSER_PROSE_TIER_CAPABILITY_DECISION_RECEIPT_DIGEST,
    fallbackAttempted: false as const,
    modelCallClaimed: false as const,
    canonicalMutationCount: 0 as const,
    retryable: false as const,
  });
}

export function assertBrowserProseTierProductionQualified(input: Readonly<{
  taskType: PlatformTaskType;
  selectedModelTier: BrowserProseModelTier;
  selectedModelId?: string | null;
  selectedModelDigest?: string | null;
  executor: "webllm-worker" | "chromium-prompt-api" | null;
}>) {
  const receipt = createBrowserProseTierExecutionDecision(input);
  if (!receipt.eligible) throw lowTierBrowserProseCapabilityError(receipt);
  return receipt;
}

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
  buildBrowserProseContinuationSeed,
  mergeBrowserProseContinuation,
  shouldEnforceDefaultBrowserProseContract,
  shouldRunBrowserProseExtension,
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
    BOUNDED_SAME_MODEL_REPAIR_REASONS.has(reason)))];
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
  const chapterProseContract = defaultChapterProseContract
    ? assessBrowserProseCompletion(result.content)
    : null;
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
  if (chapterProseContract?.safetyCode) {
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
  if (chapterProseContract?.content) {
    result = {
      ...result,
      content: chapterProseContract.content,
      outputCharacters: chapterProseContract.content.length,
      normalizedOutputCharacters: chapterProseContract.content.length,
    };
  }
  const expectedMinTokens = minimumCandidateTokens(
    input.request.taskType,
    eligibility.tier,
  );
  let quality = evaluateBrowserCandidateQuality({
    taskType: input.request.taskType,
    content: result.content,
    expectedMinTokens,
    expectedMaxTokens: performancePolicy.reservedOutputTokens,
    requiresStructuredOutput: input.request.requiresStructured,
    approvedContext: executionRequest.context,
    threshold: eligibility.tier === "T1" ? 0.58 : 0.7,
  });
  const repairReasonCodes = [...new Set([
    ...quality.reasonCodes.filter((reason) =>
      BOUNDED_SAME_MODEL_REPAIR_REASONS.has(reason)),
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
    const initialDigest = await sha256Hex(initialResult.content);
    const repairPlan = buildBrowserBoundedSameModelRepairPlan({
      authorObjective: input.request.input,
      reasonCodes: repairReasonCodes,
    });
    let repairResult: PlatformAIResult;
    try {
      repairResult = await runPass(
        {
          ...executionRequest,
          requestId: `${input.request.requestId}:bounded-same-model-repair`,
          input: repairPlan.objective,
          qualityPhase: "revision",
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
            maxTokens: 360,
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
        },
      );
    } catch (error) {
      throw attachBrowserRuntimeEvidence(error, [
        ...browserRuntimeEvidence,
        unavailableBrowserRuntimePassEvidence("repair"),
      ]);
    }
    assertVerifiedExecutor(repairResult, requiredGenerativeExecutor);
    assertSameVerifiedBrowserModel(initialResult, repairResult);
    const repairCompletion = defaultChapterProseContract
      ? assessBrowserProseCompletion(repairResult.content)
      : null;
    browserRuntimeEvidence.push(browserRuntimePassEvidence(
      "repair",
      repairResult,
      repairCompletion?.observedHanCharacters ?? null,
    ));
    if (
      repairCompletion
      && requiredGenerativeExecutor === "webllm-worker"
      && repairResult.generationFinishReason !== "stop"
      && repairResult.generationFinishReason !== "length"
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
    const acceptedRepairContent = repairCompletion?.content ?? repairResult.content;
    let acceptedResult: PlatformAIResult = {
      ...repairResult,
      content: acceptedRepairContent,
      outputCharacters: acceptedRepairContent.length,
      normalizedOutputCharacters: acceptedRepairContent.length,
    };
    let repairQuality = evaluateBrowserCandidateQuality({
      taskType: input.request.taskType,
      content: acceptedRepairContent,
      expectedMinTokens,
      expectedMaxTokens: performancePolicy.reservedOutputTokens,
      requiresStructuredOutput: input.request.requiresStructured,
      approvedContext: executionRequest.context,
      threshold: eligibility.tier === "T1" ? 0.58 : 0.7,
    });
    const runBoundedProseExtension = repairCompletion
      ? shouldRunBrowserProseExtension({
        taskType: input.request.taskType,
        explicitLengthRequested: !defaultChapterProseContract,
        contractSatisfied: repairCompletion.contractSatisfied,
        safetyCode: repairCompletion.safetyCode,
        observedHanCharacters: repairCompletion.observedHanCharacters,
        finishReason: repairResult.generationFinishReason,
        qualityReasonCodes: repairQuality.reasonCodes,
      })
      : false;
    let extensionResult: PlatformAIResult | null = null;
    let extensionDigest: string | null = null;
    if (
      requiredGenerativeExecutor === "webllm-worker"
      && runBoundedProseExtension
    ) {
      const repairDigest = await sha256Hex(repairResult.content);
      const continuationSeed = buildBrowserProseContinuationSeed({
        baseContent: repairResult.content,
        baseDigest: repairDigest,
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
              maxTokens: 320,
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
          },
        );
      } catch (error) {
        throw attachBrowserRuntimeEvidence(error, [
          ...browserRuntimeEvidence,
          unavailableBrowserRuntimePassEvidence("extension"),
        ]);
      }
      assertVerifiedExecutor(extensionResult, requiredGenerativeExecutor);
      assertSameVerifiedBrowserModel(repairResult, extensionResult);
      browserRuntimeEvidence.push(browserRuntimePassEvidence(
        "extension",
        extensionResult,
        assessBrowserProseCompletion(extensionResult.content).observedHanCharacters,
      ));
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
        baseContent: repairResult.content,
        continuationContent: extensionResult.content,
        anchor: continuationSeed.anchor,
      });
      if (!merged.contractSatisfied || !merged.content) {
        throw Object.assign(explicitEscalationError(
          eligibility,
          "BROWSER_AI_QUALITY_INSUFFICIENT",
        ), {
          qualityDecision: "block",
          qualityReasonCodes: merged.reason === "combined-contract-unsatisfied"
            && (merged.observedHanCharacters ?? 0) < 220
            ? ["QUALITY_LENGTHCOMPLIANCE_LOW", "QUALITY_NARRATIVE_TOO_SHORT"]
            : ["QUALITY_TASK_FORM_MISMATCH"],
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
        normalizedOutputCharacters: merged.content.length,
      };
      repairQuality = evaluateBrowserCandidateQuality({
        taskType: input.request.taskType,
        content: merged.content,
        expectedMinTokens,
        expectedMaxTokens: performancePolicy.reservedOutputTokens,
        requiresStructuredOutput: input.request.requiresStructured,
        approvedContext: executionRequest.context,
        threshold: eligibility.tier === "T1" ? 0.58 : 0.7,
      });
    }
    if (
      repairCompletion
      && !repairCompletion.contractSatisfied
      && !extensionResult
    ) {
      throw Object.assign(explicitEscalationError(
        eligibility,
        "BROWSER_AI_QUALITY_INSUFFICIENT",
      ), {
        qualityDecision: "block",
        qualityReasonCodes: repairResult.generationFinishReason !== "stop"
          ? ["QUALITY_OUTPUT_TRUNCATED"]
          : repairCompletion.safetyCode
          ? ["QUALITY_TASK_FORM_MISMATCH"]
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
    const passes = [initialResult, repairResult, ...(extensionResult ? [extensionResult] : [])];
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
      normalizedOutputCharacters: acceptedResult.content.length,
      runtimeStats: [
        acceptedResult.runtimeStats,
        "bounded-same-model-repair=1",
        `bounded-prose-extension=${extensionResult ? "1" : "0"}`,
        `initial-finish=${initialResult.generationFinishReason ?? "unavailable"}`,
        `repair-finish=${repairResult.generationFinishReason ?? "unavailable"}`,
        ...(extensionResult
          ? [`extension-finish=${extensionResult.generationFinishReason ?? "unavailable"}`]
          : []),
        `initial-output-digest=${initialDigest}`,
        ...(extensionDigest ? [`extension-output-digest=${extensionDigest}`] : []),
        `initial-quality-reasons=${repairPlan.reasonCodes.join(",")}`,
        "intermediate-content=pipeline-memory-only",
      ].filter(Boolean).join("; "),
      provenance: {
        ...acceptedResult.provenance,
        warnings: [
          ...acceptedResult.provenance.warnings,
          "One bounded repair and at most one normal-EOS suffix extension ran on the same verified Browser executor; rejected intermediate text remained in memory and no provider fallback occurred.",
        ],
      },
    };
    quality = repairQuality;
  }

  return { result, quality, browserRuntimeEvidence };
}


export async function executeBrowserCompute(input: {
  request: PlatformAIRequest;
  decision: PlatformRouterDecision;
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
  // early or merely copies context; this never switches providers or mutates Canon.
  let result = await executeBrowserInitialPass({
    request: executionRequest,
    decision: input.decision,
    onProgress: input.onProgress,
    options: {
      preferLightweightRuntime: eligibility.tier === "T1",
      requiredGenerativeExecutor,
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

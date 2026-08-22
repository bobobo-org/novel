import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY_DIGEST,
  BROWSER_PROSE_CANDIDATE_V2_IDENTITY,
  BROWSER_PROSE_CANDIDATE_V2_SYSTEM_INSTRUCTION,
  assertBrowserProseCandidateV2SafeMetric,
  buildBrowserProseCandidateV2SegmentRequests,
} from "../lib/novel-ai/providers/browser-ai/browser-prose-candidate-v2.ts";
import {
  assertBrowserProseCandidateV2ParsedContext,
  parseBrowserProseCandidateV2Context,
} from "../lib/novel-ai/providers/browser-ai/browser-prose-candidate-v2-context.ts";
import {
  BROWSER_PROSE_CANDIDATE_V2_QUALIFICATION_OBSERVATION_SCHEMA,
  assertBrowserProseCandidateV2RuntimeReceipt,
  assertBrowserProseCandidateV2SegmentCallReceipt,
  assertBrowserProseCandidateV2ThreeContributorAttestation,
  createBrowserProseCandidateV2SegmentCallReceipt,
  finalizeBrowserProseCandidateV2SafeMetric,
} from "../lib/novel-ai/providers/browser-ai/browser-prose-candidate-v2-receipt.ts";
import {
  executeBrowserProseCandidateV2Runtime,
} from "../lib/novel-ai/providers/browser-ai/browser-prose-candidate-v2-runtime.ts";
import {
  runBrowserAICandidateV2Segment,
} from "../lib/novel-ai/providers/browser-ai/browser-ai-provider.ts";
import {
  browserWebLLMMaxAttempts,
} from "../lib/novel-ai/providers/browser-ai/browser-webllm-runtime.ts";
import {
  BROWSER_PROSE_QUALIFICATION_SCHEMA_VERSION,
  browserWebLLMModel,
} from "../lib/novel-ai/providers/browser-ai/webllm-model-registry.ts";
import {
  LOW_TIER_BROWSER_PROSE_NOT_PRODUCTION_QUALIFIED,
  browserProseQualificationArtifactMatchesModel,
} from "../lib/novel-ai/providers/browser-ai/browser-prose-capability-policy.ts";
import {
  executeBrowserProseCandidateV2Product,
} from "../lib/novel-ai/router/platform-executor.ts";

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

async function expectRejected(fn, pattern) {
  await assert.rejects(fn, pattern);
}

const SEGMENT_CONTENT = {
  action: "雨夜裡，林岑握緊銅鑰，沿著舊港倉庫的裂牆向前走，趁巡燈轉開時推門進入暗室。她記得母親只在鐘聲停歇後行動的告誡，便抬手示意同行的周芷保持安靜，自己先踏過積水。",
  reaction: "門後的鐵鏈忽然震響，周芷立刻擋在林岑側後，低聲指出貨架底下新鮮的泥痕正通往封死的地窖。遠處巡燈提早折返，窗縫的白光掃過暗室，迫使兩人伏低身子，連呼吸也壓進潮濕木板的氣味裡。",
  consequence: "林岑掀開地窖蓋時，銅鑰竟與鎖孔一同發熱，因此牆內傳來三聲敲擊，原先沉寂的鐘樓隨即亮起紅燈。她終於明白母親留下的不是逃亡路線，而是喚醒證人的信號；巡兵也當場改變方向，朝倉庫包圍而來。",
};

function contextEntries() {
  return [
    `[CANONICAL_CHARACTER_IDENTITIES]\n${JSON.stringify([
      { name: "林岑", aliases: ["阿岑"] },
      { name: "周芷", aliases: [] },
    ])}`,
    `[APPROVED_STORY_BIBLE]\n${JSON.stringify({
      title: "舊港鐘影",
      genre: "mystery",
      world: "舊港",
      premise: "林岑追查母親失蹤真相。",
    })}`,
    `[ACTIVE_CHAPTER]\n${JSON.stringify({
      title: "舊港倉庫",
      content: "舊港的鐘聲停了。她們躲過巡兵，抵達封鎖多年的倉庫外。",
      revision: 4,
    })}`,
    `[WORLD_RULES]\n${JSON.stringify([
      { title: "銅鑰", description: "鐘聲停止後，封印只維持一刻鐘。" },
    ])}`,
  ];
}

async function parsedContext() {
  return parseBrowserProseCandidateV2Context({
    composerAuthority: "project-context-composer-v1",
    context: contextEntries(),
    nextActionGoal: "進入地窖並找到證人",
    genre: "mystery",
  });
}

function outerRequest() {
  return {
    requestId: "rc65-runtime-contract-outer",
    projectId: "project-contract",
    taskType: "chapter.continue",
    privacyMode: "strict-local",
    input: "進入地窖並找到證人",
    context: contextEntries(),
    preferredProvider: "browser-ai",
    externalConsent: false,
    closedOnly: true,
    offlineRequired: true,
    fallbackPolicy: "none",
    qualityPhase: "draft",
  };
}

function decision() {
  return {
    providerId: "browser-ai",
    modelId: BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelId,
    modelDigest: BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelDigest,
    privacyMode: "strict-local",
    reason: "candidate-v2-focused-contract",
    contextSources: ["project-context-composer-v1"],
    externalRequest: false,
    dataLeavesDevice: false,
    fallbackChain: [],
    warnings: [],
  };
}

function candidateRuntimeSnapshot() {
  return {
    selectedModelId: BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelId,
    device: { tier: "standard" },
    models: [{
      selected: true,
      modelId: BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelId,
      modelDigest: BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelDigest,
      installStatus: "ready",
      cacheVerified: true,
      generationVerified: true,
    }],
  };
}

function candidateBenchmark(measuredAt = new Date().toISOString()) {
  const model = browserWebLLMModel(BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelId);
  assert.ok(model);
  return {
    schemaVersion: "browser-device-benchmark-v1",
    key: `${model.modelId}:${model.modelDigest}`,
    modelId: model.modelId,
    modelDigest: model.modelDigest,
    parameterLabel: model.parameterLabel,
    deviceTier: "standard",
    sampleCount: 1,
    initializationMs: 100,
    firstTokenMs: 100,
    tokensPerSecond: 10,
    peakEstimatedMemoryMB: 100,
    workerCrashCount: 0,
    gpuDeviceLostCount: 0,
    outputFailureRate: 0,
    structuredOutputSuccessRate: 1,
    benchmarkPassed: true,
    failureReasons: [],
    measuredAt,
  };
}

function performancePolicy(segment) {
  return {
    policyVersion: "browser-ai-performance-policy-v3",
    tier: "medium",
    parameterLabel: "1.5B",
    maxInputCharacters: 12_000,
    maxOutputTokens: segment.maxOutputTokens,
    temperature: 0,
    topP: 1,
    repetitionPenalty: 1.08,
    serialGeneration: true,
    workerExecution: true,
    reason: ["candidate-v2-focused-contract"],
  };
}

function fakePlatformResult(input, overrides = {}) {
  const content = SEGMENT_CONTENT[input.segment.segmentId];
  return {
    requestId: input.invocationRequestId,
    providerId: "browser-ai",
    modelId: BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelId,
    modelDigest: BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelDigest,
    content,
    candidateOnly: true,
    externalRequest: false,
    dataLeavesDevice: false,
    elapsedMs: 10,
    provenance: input.decision,
    omittedInputCharacters: 0,
    executor: "webllm-worker",
    engineReused: input.contributorIndex > 0,
    generationFinishReason: "stop",
    completionTokens: 96,
    performancePolicy: performancePolicy(input.segment),
    ...overrides,
  };
}

async function fakeSegmentExecution(input, overrides = {}) {
  const result = fakePlatformResult(input, overrides);
  const callReceipt = await createBrowserProseCandidateV2SegmentCallReceipt({
    outerRequestId: input.request.requestId,
    outerTaskType: input.request.taskType,
    outerQualityPhase: input.request.qualityPhase ?? "draft",
    invocationRequestId: input.invocationRequestId,
    contributorIndex: input.contributorIndex,
    contextDigest: input.contextDigest,
    segment: input.segment,
    systemInstruction: BROWSER_PROSE_CANDIDATE_V2_SYSTEM_INSTRUCTION,
    result,
    executionSource: "test-double",
  });
  return {
    response: {
      segmentId: input.segment.segmentId,
      content: result.content,
      finishReason: result.generationFinishReason,
    },
    callReceipt,
  };
}

async function successfulRuntime(overrides = {}) {
  return executeBrowserProseCandidateV2Runtime({
    outerRequest: outerRequest(),
    decision: decision(),
    parsedContext: await parsedContext(),
    fixtureId: "rc65-development-03",
    partition: "development",
    executionMode: "cold",
    executeSegment: fakeSegmentExecution,
    ...overrides,
  });
}

test("trusted context parser binds exact composer labels and digest", async () => {
  const parsed = await parsedContext();
  await assertBrowserProseCandidateV2ParsedContext(parsed);
  assert.deepEqual(parsed.sourceLabels, [
    "APPROVED_STORY_BIBLE",
    "ACTIVE_CHAPTER",
    "CANONICAL_CHARACTER_IDENTITIES",
    "WORLD_RULES",
  ]);
  assert.deepEqual(parsed.context.characterAnchors.slice(0, 2), ["林岑", "阿岑"]);
  assert.ok(parsed.context.contextAnchors.includes("舊港倉庫"));
  assert.equal(parsed.rawContextStored, false);
});

test("context parser rejects missing, duplicate, malformed and mutated context", async () => {
  await expectRejected(
    () => parseBrowserProseCandidateV2Context({
      composerAuthority: "project-context-composer-v1",
      context: contextEntries().filter((row) => !row.startsWith("[WORLD_RULES]")),
      nextActionGoal: "前進",
      genre: "mystery",
    }),
    /REQUIRED_CONTEXT_MISSING/u,
  );
  await expectRejected(
    () => parseBrowserProseCandidateV2Context({
      composerAuthority: "project-context-composer-v1",
      context: [...contextEntries(), contextEntries()[0]],
      nextActionGoal: "前進",
      genre: "mystery",
    }),
    /CONTEXT_LABEL_DUPLICATED/u,
  );
  const malformed = contextEntries();
  malformed[1] = "[APPROVED_STORY_BIBLE]\n{";
  await expectRejected(
    () => parseBrowserProseCandidateV2Context({
      composerAuthority: "project-context-composer-v1",
      context: malformed,
      nextActionGoal: "前進",
      genre: "mystery",
    }),
    /CONTEXT_JSON_INVALID/u,
  );
  const parsed = await parsedContext();
  parsed.context.nextActionGoal = "遭竄改";
  await expectRejected(
    () => assertBrowserProseCandidateV2ParsedContext(parsed),
    /CONTEXT_DIGEST_MISMATCH/u,
  );
});

test("qualification schema binds Candidate V2 policy and evidence while registry stays null", () => {
  const model = browserWebLLMModel(BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelId);
  assert.ok(model);
  assert.equal(model.proseQualification, null);
  const artifact = {
    schemaVersion: BROWSER_PROSE_QUALIFICATION_SCHEMA_VERSION,
    modelId: model.modelId,
    modelDigest: model.modelDigest,
    candidateIdentityDigest: BROWSER_PROSE_CANDIDATE_V2_IDENTITY.candidateIdentityDigest,
    generationPolicyDigest: BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY_DIGEST,
    liveQualificationEvidenceDigest: "a".repeat(64),
    formalApprovalDigest: "b".repeat(64),
    qualifiedTasks: ["chapter.continue", "chapter.expand"],
  };
  assert.equal(browserProseQualificationArtifactMatchesModel({
    taskType: "chapter.continue",
    model,
    artifact,
  }), true);
  for (const [field, value] of [
    ["candidateIdentityDigest", "c".repeat(64)],
    ["generationPolicyDigest", "d".repeat(64)],
    ["liveQualificationEvidenceDigest", "not-a-digest"],
    ["formalApprovalDigest", "not-a-digest"],
  ]) {
    assert.equal(browserProseQualificationArtifactMatchesModel({
      taskType: "chapter.continue",
      model,
      artifact: { ...artifact, [field]: value },
    }), false, field);
  }
});

test("product executor fails before context or runtime while qualification is null", async () => {
  let parseCalls = 0;
  let runtimeCalls = 0;
  await expectRejected(
    () => executeBrowserProseCandidateV2Product(
      outerRequest(),
      decision(),
      {
        parseContext: async () => {
          parseCalls += 1;
          throw new Error("unexpected parser call");
        },
        executeRuntime: async () => {
          runtimeCalls += 1;
          throw new Error("unexpected runtime call");
        },
      },
    ),
    (error) => (
      error?.code === LOW_TIER_BROWSER_PROSE_NOT_PRODUCTION_QUALIFIED
      && error?.modelCallClaimed === false
      && error?.fallbackAttempted === false
    ),
  );
  assert.equal(parseCalls, 0);
  assert.equal(runtimeCalls, 0);
});

test("runtime makes exactly three serial segment calls and returns digest-only receipts", async () => {
  const order = [];
  let active = 0;
  let maximumActive = 0;
  const result = await successfulRuntime({
    executeSegment: async (input) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      order.push(input.segment.segmentId);
      await Promise.resolve();
      const execution = await fakeSegmentExecution(input);
      active -= 1;
      return execution;
    },
  });
  assert.deepEqual(order, ["action", "reaction", "consequence"]);
  assert.equal(maximumActive, 1);
  assert.equal(result.runtimeReceipt.modelResponseCount, 3);
  assert.equal(result.runtimeReceipt.modelRetryCount, 0);
  assert.equal(result.runtimeReceipt.monolithicGenerationAttempted, false);
  assert.equal(result.runtimeReceipt.repairAttempted, false);
  assert.equal(result.runtimeReceipt.extensionAttempted, false);
  assert.equal(result.runtimeReceipt.recoveryAttempted, false);
  assert.equal(result.runtimeReceipt.actualExecutor, "browser-ai");
  assert.equal(result.runtimeReceipt.underlyingExecutor, "webllm-worker");
  assert.equal(result.runtimeReceipt.syntheticObservedReceipt, true);
  assert.equal(result.runtimeReceipt.productionPassClaimed, false);
  assert.deepEqual(
    result.finalAttestation.contributors.map((row) => row.contributorStage),
    ["segment-action", "segment-reaction", "segment-consequence"],
  );
  assert.equal(result.finalAttestation.acceptedDisposition, "three-segment-composition");
  await assertBrowserProseCandidateV2RuntimeReceipt(result.runtimeReceipt);
  await assertBrowserProseCandidateV2ThreeContributorAttestation(result.finalAttestation);
  const serializedReceipt = JSON.stringify(result.runtimeReceipt);
  for (const raw of Object.values(SEGMENT_CONTENT)) assert.doesNotMatch(serializedReceipt, new RegExp(raw.slice(0, 12), "u"));
});

test("segment failure stops immediately with no retry and no later call", async () => {
  const calls = [];
  await expectRejected(
    () => successfulRuntime({
      executeSegment: async (input) => {
        calls.push(input.segment.segmentId);
        if (input.segment.segmentId === "reaction") {
          throw Object.assign(new Error("synthetic segment failure"), {
            code: "SYNTHETIC_SEGMENT_FAILURE",
          });
        }
        return fakeSegmentExecution(input);
      },
    }),
    /synthetic segment failure/u,
  );
  assert.deepEqual(calls, ["action", "reaction"]);
});

test("runtime rejects call receipt, response and identity drift", async () => {
  await expectRejected(
    () => successfulRuntime({
      executeSegment: async (input) => {
        const execution = await fakeSegmentExecution(input);
        execution.response.content += "竄改";
        return execution;
      },
    }),
    /SEGMENT_EXECUTION_MISMATCH/u,
  );
  await expectRejected(
    () => successfulRuntime({
      executeSegment: async (input) => {
        const execution = await fakeSegmentExecution(input);
        execution.callReceipt = {
          ...execution.callReceipt,
          candidateIdentity: {
            ...execution.callReceipt.candidateIdentity,
            modelDigest: "0".repeat(64),
          },
        };
        return execution;
      },
    }),
    /CALL_RECEIPT_REJECTED|CALL_RECEIPT_DIGEST_MISMATCH/u,
  );
  const wrongDecision = decision();
  wrongDecision.modelId = "wrong-model";
  await expectRejected(
    () => successfulRuntime({ decision: wrongDecision }),
    /RUNTIME_BOUNDARY_INVALID/u,
  );
});

test("attestation rejects missing, duplicate, reordered and blocked-pipeline contributors", async () => {
  const runtime = await successfulRuntime();
  const missing = structuredClone(runtime.finalAttestation);
  missing.contributors = missing.contributors.slice(0, 2);
  await expectRejected(
    () => assertBrowserProseCandidateV2ThreeContributorAttestation(missing),
    /ATTESTATION_REJECTED/u,
  );
  const duplicate = structuredClone(runtime.finalAttestation);
  duplicate.contributors[1].invocationRequestId = duplicate.contributors[0].invocationRequestId;
  await expectRejected(
    () => assertBrowserProseCandidateV2ThreeContributorAttestation(duplicate),
    /ATTESTATION_REJECTED|DIGEST_MISMATCH/u,
  );
  const reordered = structuredClone(runtime.finalAttestation);
  [reordered.contributors[0], reordered.contributors[1]] = [
    reordered.contributors[1],
    reordered.contributors[0],
  ];
  await expectRejected(
    () => assertBrowserProseCandidateV2ThreeContributorAttestation(reordered),
    /ATTESTATION_REJECTED/u,
  );
  const blockedReuse = structuredClone(runtime.runtimeReceipt);
  blockedReuse.repairAttempted = true;
  await expectRejected(
    () => assertBrowserProseCandidateV2RuntimeReceipt(blockedReuse),
    /RUNTIME_RECEIPT_REJECTED/u,
  );
});

test("non-stop, fallback executor and omitted prompt content fail closed", async () => {
  const context = await parsedContext();
  const [segment] = buildBrowserProseCandidateV2SegmentRequests(context.context);
  const baseInput = {
    request: outerRequest(),
    decision: decision(),
    segment,
    contributorIndex: 0,
    invocationRequestId: "invalid-call",
    contextDigest: context.contextDigest,
  };
  for (const overrides of [
    { generationFinishReason: "length" },
    { executor: "local-ollama" },
    { omittedInputCharacters: 1 },
    { externalRequest: true },
  ]) {
    await expectRejected(
      () => createBrowserProseCandidateV2SegmentCallReceipt({
        outerRequestId: baseInput.request.requestId,
        outerTaskType: baseInput.request.taskType,
        outerQualityPhase: "draft",
        invocationRequestId: baseInput.invocationRequestId,
        contributorIndex: 0,
        contextDigest: baseInput.contextDigest,
        segment,
        systemInstruction: BROWSER_PROSE_CANDIDATE_V2_SYSTEM_INSTRUCTION,
        result: fakePlatformResult(baseInput, overrides),
        executionSource: "test-double",
      }),
      /CALL_RESULT_INVALID/u,
    );
  }
  const wrongSystemReceipt = await createBrowserProseCandidateV2SegmentCallReceipt({
    outerRequestId: baseInput.request.requestId,
    outerTaskType: baseInput.request.taskType,
    outerQualityPhase: "draft",
    invocationRequestId: baseInput.invocationRequestId,
    contributorIndex: 0,
    contextDigest: baseInput.contextDigest,
    segment,
    systemInstruction: `${BROWSER_PROSE_CANDIDATE_V2_SYSTEM_INSTRUCTION}\nmutation`,
    result: fakePlatformResult(baseInput),
    executionSource: "test-double",
  });
  await expectRejected(
    () => assertBrowserProseCandidateV2SegmentCallReceipt(wrongSystemReceipt),
    /SYSTEM_INSTRUCTION_DIGEST_MISMATCH/u,
  );
});

test("qualification observation cannot turn synthetic execution into production PASS", async () => {
  const runtime = await successfulRuntime();
  const observation = {
    schemaVersion: BROWSER_PROSE_CANDIDATE_V2_QUALIFICATION_OBSERVATION_SCHEMA,
    runtimeReceiptDigest: runtime.runtimeReceipt.runtimeReceiptDigest,
    profileDisposed: true,
    edgeResidueCount: 0,
    workerResidueCount: 0,
    externalNetworkRequestCount: 0,
    dataEgressEventCount: 0,
    networkObservationComplete: true,
    canonicalMutationCount: 0,
    formalApprovalMutationCount: 0,
    rawOutputStored: false,
    rawPromptStored: false,
    rawStoryBibleStored: false,
    rawChapterStored: false,
    chainOfThoughtStored: false,
    cancelledSegment: null,
    cancelledPartialPersisted: false,
    retryReusedCancelledOutput: false,
    syntheticObservedReceipt: true,
    productionPassClaimed: false,
  };
  const metric = await finalizeBrowserProseCandidateV2SafeMetric({
    runtimeReceipt: runtime.runtimeReceipt,
    observation,
  });
  assert.equal(metric.syntheticObservedReceipt, true);
  assert.equal(metric.productionPassClaimed, false);
  assertBrowserProseCandidateV2SafeMetric(metric, { allowSyntheticObservedReceipt: true });
  assert.throws(() => assertBrowserProseCandidateV2SafeMetric(metric), /SAFE_METRIC_REJECTED/u);
  await expectRejected(
    () => finalizeBrowserProseCandidateV2SafeMetric({
      runtimeReceipt: runtime.runtimeReceipt,
      observation: { ...observation, productionPassClaimed: true },
    }),
    /QUALIFICATION_OBSERVATION_REJECTED/u,
  );
});

test("cancel-retry metric requires explicit segment and no partial reuse", async () => {
  const runtime = await successfulRuntime({
    executionMode: "cancel-retry",
    partition: "holdout",
    fixtureId: "rc65-holdout-01",
  });
  const observation = {
    schemaVersion: BROWSER_PROSE_CANDIDATE_V2_QUALIFICATION_OBSERVATION_SCHEMA,
    runtimeReceiptDigest: runtime.runtimeReceipt.runtimeReceiptDigest,
    profileDisposed: true,
    edgeResidueCount: 0,
    workerResidueCount: 0,
    externalNetworkRequestCount: 0,
    dataEgressEventCount: 0,
    networkObservationComplete: true,
    canonicalMutationCount: 0,
    formalApprovalMutationCount: 0,
    rawOutputStored: false,
    rawPromptStored: false,
    rawStoryBibleStored: false,
    rawChapterStored: false,
    chainOfThoughtStored: false,
    cancelledSegment: "action",
    cancelledPartialPersisted: false,
    retryReusedCancelledOutput: false,
    syntheticObservedReceipt: true,
    productionPassClaimed: false,
  };
  const metric = await finalizeBrowserProseCandidateV2SafeMetric({
    runtimeReceipt: runtime.runtimeReceipt,
    observation,
  });
  assert.equal(metric.cancelledSegment, "action");
  await expectRejected(
    () => finalizeBrowserProseCandidateV2SafeMetric({
      runtimeReceipt: runtime.runtimeReceipt,
      observation: { ...observation, cancelledSegment: null },
    }),
    /QUALIFICATION_OBSERVATION_REJECTED/u,
  );
  await expectRejected(
    () => finalizeBrowserProseCandidateV2SafeMetric({
      runtimeReceipt: runtime.runtimeReceipt,
      observation: { ...observation, retryReusedCancelledOutput: true },
    }),
    /QUALIFICATION_OBSERVATION_REJECTED/u,
  );
});

test("WebLLM V2 retry budget is exactly one attempt and legacy defaults do not drift", () => {
  assert.equal(browserWebLLMMaxAttempts({ retryBudget: 0 }), 1);
  assert.equal(browserWebLLMMaxAttempts({}), 2);
  assert.equal(browserWebLLMMaxAttempts({ contextAttestation: "required" }), 1);
  assert.equal(browserWebLLMMaxAttempts({ retryBudget: 1 }), 2);
  assert.throws(
    () => browserWebLLMMaxAttempts({ retryBudget: 2 }),
    (error) => error?.code === "BROWSER_WEBLLM_RETRY_BUDGET_INVALID",
  );
  assert.throws(
    () => browserWebLLMMaxAttempts({ contextAttestation: "required", retryBudget: 1 }),
    (error) => error?.code === "BROWSER_WEBLLM_ATTESTED_RETRY_FORBIDDEN",
  );
});

test("provider API rejects misrouting before any Browser model call", async () => {
  const context = await parsedContext();
  const [segment] = buildBrowserProseCandidateV2SegmentRequests(context.context);
  const misrouted = decision();
  misrouted.providerId = "local-ollama";
  await expectRejected(
    () => runBrowserAICandidateV2Segment({
      request: outerRequest(),
      decision: misrouted,
      segment,
      contributorIndex: 0,
      invocationRequestId: "misrouted-no-model-call",
      contextDigest: context.contextDigest,
    }),
    /EXECUTION_BOUNDARY_INVALID/u,
  );
});

test("provider rejects missing stale or noncanonical benchmark before model call", async () => {
  const context = await parsedContext();
  const [segment] = buildBrowserProseCandidateV2SegmentRequests(context.context);
  let modelCalls = 0;
  const staleMeasuredAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000)
    .toISOString();
  const invalidBenchmarks = [
    null,
    candidateBenchmark(staleMeasuredAt),
    { ...candidateBenchmark(), tokensPerSecond: 0.1 },
  ];
  for (const benchmark of invalidBenchmarks) {
    await expectRejected(
      () => runBrowserAICandidateV2Segment({
        request: outerRequest(),
        decision: decision(),
        segment,
        contributorIndex: 0,
        invocationRequestId: `benchmark-precall-${modelCalls}`,
        contextDigest: context.contextDigest,
        runtimeDependencies: {
          runtimeSnapshot: async () => candidateRuntimeSnapshot(),
          readBenchmark: async () => benchmark,
          generate: async () => {
            modelCalls += 1;
            throw new Error("model call must not occur");
          },
        },
      }),
      /BENCHMARK_NOT_READY/u,
    );
  }
  assert.equal(modelCalls, 0);
});

test("Phase A sources never import blocked monolithic or bounded retry pipelines", async () => {
  const sourceFiles = [
    "../lib/novel-ai/providers/browser-ai/browser-prose-candidate-v2-runtime.ts",
    "../lib/novel-ai/providers/browser-ai/browser-ai-provider.ts",
  ];
  for (const relative of sourceFiles) {
    const source = await readFile(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
    for (const forbidden of [
      /runBrowserProseProductPipeline\s*\(/u,
      /executeBrowserInitialPass\s*\(/u,
      /executeBrowserBoundedQualityPasses\s*\(/u,
      /from\s+["'][^"']*browser-prose-composer["']/u,
      /from\s+["'][^"']*browser-prose-product-pipeline["']/u,
    ]) assert.doesNotMatch(source, forbidden);
  }
  const providerSource = await readFile(fileURLToPath(new URL(
    "../lib/novel-ai/providers/browser-ai/browser-ai-provider.ts",
    import.meta.url,
  )), "utf8");
  assert.match(providerSource, /runBrowserAICandidateV2Segment/u);
  assert.match(providerSource, /retryBudget:\s*0/u);
  assert.match(providerSource, /readBrowserDeviceBenchmark/u);
  assert.match(providerSource, /assertBrowserProseCandidateV2SafeOutput/u);
  const plannerSource = await readFile(fileURLToPath(new URL(
    "../lib/novel-ai/closed-agent-os/planner.ts",
    import.meta.url,
  )), "utf8");
  assert.match(plannerSource, /selectedModelId:\s*selectedModel\?\.modelId \?\? null/u);
  assert.match(plannerSource, /selectedModelDigest:\s*selectedModel\?\.modelDigest \?\? null/u);
  const executorSource = await readFile(fileURLToPath(new URL(
    "../lib/novel-ai/router/platform-executor.ts",
    import.meta.url,
  )), "utf8");
  assert.match(executorSource, /executeBrowserProseCandidateV2Product/u);
  assert.match(executorSource, /partition:\s*"product"/u);
  assert.match(executorSource, /executionMode:\s*"product"/u);
});

let passed = 0;
for (const row of tests) {
  await row.fn();
  passed += 1;
  console.log(`PASS ${row.name}`);
}

console.log(JSON.stringify({
  schemaVersion: "p2.4b-rc6.5-browser-prose-candidate-v2-runtime-contract-result-v1",
  candidateIdentityDigest: BROWSER_PROSE_CANDIDATE_V2_IDENTITY.candidateIdentityDigest,
  passed,
  failed: 0,
  syntheticObservedReceipt: true,
  productionPassClaimed: false,
  edgeExecuted: false,
  modelExecuted: false,
  externalRequest: false,
  dataLeftDevice: false,
}, null, 2));

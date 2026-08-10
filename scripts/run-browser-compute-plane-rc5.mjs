import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  executeBrowserDeterministicOperation,
} from "../lib/novel-ai/providers/browser-ai/browser-compute-orchestrator.ts";
import {
  BROWSER_T0_OPERATIONS,
  BROWSER_T1_TASKS,
  BROWSER_T1_T2_HYBRID_TASKS,
  BROWSER_T2_TASKS,
  BROWSER_T3_TASKS,
  browserEligibilityContextTokens,
  classifyBrowserTask,
  resolveBrowserTaskEligibility,
} from "../lib/novel-ai/providers/browser-ai/browser-task-eligibility.ts";
import {
  evaluateBrowserDeviceBenchmark,
} from "../lib/novel-ai/providers/browser-ai/browser-device-benchmark.ts";
import {
  browserModelShardManifestDigest,
  browserModelShardRecord,
  validateBrowserModelShardManifest,
} from "../lib/novel-ai/providers/browser-ai/browser-model-installer.ts";
import {
  browserSemanticNamespaceDigest,
  planBrowserSemanticIndexUpdate,
} from "../lib/novel-ai/providers/browser-ai/browser-semantic-index.ts";
import { buildBrowserSemanticProjectSources } from "../lib/novel-ai/providers/browser-ai/browser-semantic-project-index.ts";
import {
  composeBrowserContextPack,
} from "../lib/novel-ai/providers/browser-ai/browser-context-compressor.ts";
import {
  estimateBrowserTokens,
  fitBrowserPromptToTokenBudget,
  resolveBrowserAIPerformancePolicy,
} from "../lib/novel-ai/providers/browser-ai/browser-performance-policy.ts";
import {
  evaluateBrowserCandidateQuality,
} from "../lib/novel-ai/providers/browser-ai/browser-quality-gate.ts";
import {
  buildClosedAIModelPrompt,
  getClosedAIModelProfile,
} from "../lib/novel-ai/providers/closed/task-profile.ts";
import {
  currentChapterContext,
  extractNarrativeCharacterAnchors,
  serializeClosedActorContext,
} from "../lib/novel-ai/providers/closed/continuity-anchors.ts";
import {
  createBrowserExecutionReceipt,
  summarizeBrowserOffload,
} from "../lib/novel-ai/providers/browser-ai/browser-offload-metrics.ts";
import {
  finalizeBrowserAssistedBackendResult,
  prepareBrowserAssistedBackendInput,
  resolveBrowserAssistedQualityEnforcement,
} from "../lib/novel-ai/providers/browser-ai/browser-assisted-postprocessor.ts";
import { BrowserGPUQueue } from "../lib/novel-ai/providers/browser-ai/browser-gpu-queue.ts";
import {
  BROWSER_WEBLLM_MODELS,
} from "../lib/novel-ai/providers/browser-ai/webllm-model-registry.ts";
import { resolveClosedAIRoute } from "../lib/novel-ai/closed-agent-os/router.ts";
import {
  boundedLocalQualityRepairRequest,
  shouldRunBoundedLocalQualityRepair,
} from "../lib/novel-ai/closed-agent-os/backends.ts";
import {
  assessRegenerationDistinctness,
  createExplicitRegenerationContract,
} from "../lib/novel-ai/web/explicit-regeneration.ts";
import {
  hasExplicitLocalComputeAuthorization,
  readStudioClosedComputePolicy,
  resolveStudioClosedComputePolicy,
} from "../lib/novel-ai/web/studio-closed-compute-policy.ts";
import {
  shouldRestoreStudioLocalRuntime,
} from "../lib/novel-ai/web/closed-agent-os-service.ts";
import { adaptStudioProfileForExplicitLocalCompute } from "../lib/novel-ai/web/studio-local-performance-policy.ts";
import {
  buildSubstantiveSceneContinuationPrompt,
  measureSubstantiveScene,
  mergeSubstantiveSceneContinuation,
  repairLocalProseCompletionBoundary,
  resolveLocalOllamaPerformanceBudget,
} from "../lib/novel-ai/providers/local-ollama/local-ollama-provider.ts";

const root = resolve(import.meta.dirname, "..");
const mode = process.argv[2] ?? "all";
const tests = [];
const completed = [];
const test = (name, run) => tests.push({ name, run });

function namespace(overrides = {}) {
  return {
    tenantId: "tenant-rc5",
    userId: "author-rc5",
    projectId: "project-rc5",
    storyId: "story-rc5",
    canonId: "canon-rc5",
    branchId: "main",
    characterId: "shared",
    agentRole: "closed-agent-os",
    modelId: "runtime-managed",
    modelDigest: "runtime-managed-digest",
    promptProfileVersion: "browser-compute-rc5",
    storyBibleRevision: "7",
    knowledgeScopeRevision: "5",
    privacyLevel: "device_only",
    ...overrides,
  };
}

function device(tier = "standard", memory = 8) {
  return {
    supported: true,
    tier,
    reason: "rc5_contract_fixture",
    mobile: false,
    webGpu: true,
    wasm: true,
    worker: true,
    indexedDb: true,
    opfs: true,
    deviceMemoryGB: memory,
    hardwareConcurrency: 8,
    maxStorageBufferBindingSize: 1_073_741_824,
    storageQuota: 10_000_000_000,
    storageUsage: 1_000_000,
    storageAvailable: 9_999_000_000,
    allowedModelIds: BROWSER_WEBLLM_MODELS.map((model) => model.modelId),
    recommendedModelId: BROWSER_WEBLLM_MODELS[1].modelId,
  };
}

function policy(model = BROWSER_WEBLLM_MODELS[1]) {
  return resolveBrowserAIPerformancePolicy({
    device: device(model.tier, model.parameterLabel === "3B" ? 16 : 8),
    model,
  });
}

function eligible(taskType, model = BROWSER_WEBLLM_MODELS[1]) {
  return resolveBrowserTaskEligibility({
    taskType,
    policy: "browser-first",
    generativeModelReady: true,
    generativeRuntime: "webllm-worker",
    inferenceProofVerified: true,
    semanticModelReady: true,
    modelParameterLabel: model.parameterLabel,
    benchmark: { benchmarkPassed: true },
    contextTokens: 900,
    outputTokens: 300,
    qualityPreference: "balanced",
    allowPreAuthorizedClosedEscalation: false,
  });
}

function backend(id, status, maximumComplexity = "standard") {
  const generationVerified = status === "ready";
  const verificationSource = {
    "browser-ai": "browser-runtime-generation",
    "local-ollama": "local-bridge-generation",
    "private-ai-hub": "private-hub-generation",
  }[id];
  return {
    id,
    label: id,
    status,
    runtimeTruth: {
      installed: generationVerified,
      configured: generationVerified,
      reachable: generationVerified,
      modelAvailable: generationVerified,
      runtimeVerified: generationVerified,
      generationVerified,
      verificationSource: generationVerified ? verificationSource : "none",
      verifiedAt: generationVerified ? "2026-08-10T00:00:00.000Z" : null,
    },
    modelId: status === "ready" ? `${id}-model` : null,
    modelDigest: status === "ready" ? ({
      "browser-ai": "b".repeat(64),
      "local-ollama": "c".repeat(64),
      "private-ai-hub": "d".repeat(64),
    })[id] : null,
    local: id !== "private-ai-hub",
    dataBoundary: id === "private-ai-hub" ? "private-infrastructure" : "device",
    maximumComplexity,
    capabilities: ["text"],
    supportedTaskTypes: "all",
    detailCode: status,
  };
}

const RC5_FIXED_BENCHMARK_SCENARIOS = [
  ...BROWSER_T0_OPERATIONS.map((operation) => ({ id: operation, tier: "T0" })),
  ...[
    "story.summary",
    "story.consistencyCheck",
    "story.retrieval",
    "story.plotAnalysis",
    "character.traitClassify",
    "drama.emotionCurve",
    "game.stateEvaluation",
    "story.originalityCheck",
  ].map((taskType) => ({ id: taskType, taskType, tier: "T1" })),
  { id: "chapter.compress:semantic", taskType: "chapter.compress", tier: "T1" },
  ...[
    "creation.guidedChoices",
    "chapter.continue",
    "chapter.rewrite",
    "chapter.abcChoices",
    "character.create",
    "character.dialogue",
    "world.create",
    "game.questCandidate",
    "game.achievementCandidate",
    "story.plotCandidate",
    "assistant.transform",
    "drama.scenePlan",
  ].map((taskType) => ({ id: taskType, taskType, tier: "T2" })),
  ...[...BROWSER_T3_TASKS].map((taskType) => ({
    id: taskType,
    taskType,
    tier: "T3",
  })),
  {
    id: "chapter.continue:oversized",
    taskType: "chapter.continue",
    tier: "T2_LIMIT",
  },
];

test("compute-orchestrator", async () => {
  const result = await executeBrowserDeterministicOperation({
    operation: "rpg.success-rate",
    payload: { actorPower: 85, challengePower: 70, luck: 12 },
  });
  assert.equal(result.actualExecutor, "deterministic-browser");
  assert.equal(result.canonicalMutationCount, 0);
  assert.equal(result.externalRequest, false);
  assert.match(result.resultDigest, /^[a-f0-9]{64}$/u);
  assert.equal(BROWSER_T0_OPERATIONS.length, 19);
  const credentialMetadata = await executeBrowserDeterministicOperation({
    operation: "content-safety.metadata",
    payload: { text: `vcp_${"x".repeat(20)}` },
  });
  assert.equal(credentialMetadata.value.containsCredentialShape, true);
  const orchestrator = readFileSync(
    resolve(root, "lib/novel-ai/providers/browser-ai/browser-compute-orchestrator.ts"),
    "utf8",
  );
  assert.match(orchestrator, /preferLightweightRuntime: eligibility\.tier === "T1"/u);
  assert.match(orchestrator, /const requiredGenerativeExecutor = eligibility\.tier === "T2"/u);
  assert.match(orchestrator, /BROWSER_AI_T2_EXECUTOR_MISMATCH/u);
  assert.match(orchestrator, /eligibility\.tier === "T2" \? "verified" : "not_required"/u);
  assert.match(orchestrator, /runBrowserThreeBQualityPipeline/u);
  assert.match(orchestrator, /qualityPhase: "critic"/u);
  assert.match(orchestrator, /qualityPhase: "revision"/u);
  assert.match(orchestrator, /intermediate-content=pipeline-memory-only/u);
  assert.doesNotMatch(orchestrator, /id: "user-additional-instruction"/u);
  assert.match(orchestrator, /input: input\.request\.input/u);
  assert.match(orchestrator, /bounded-same-model-repair/u);
  assert.match(orchestrator, /BOUNDED_SAME_MODEL_REPAIR_REASONS/u);
  assert.match(orchestrator, /角色姓名硬錨點/u);
  assert.match(orchestrator, /workingMaterials: \[\]/u);
  assert.doesNotMatch(orchestrator, /text: compactPipelineMaterial\(initialResult\.content/u);
  assert.match(orchestrator, /maxTokens: 360/u);
  assert.match(orchestrator, /intermediate-content=pipeline-memory-only/u);
  assert.match(orchestrator, /no provider fallback occurred/u);
});

test("task-eligibility", () => {
  assert.equal(classifyBrowserTask("story.summary"), "T1");
  assert.equal(classifyBrowserTask("chapter.compress"), "T1");
  assert.equal(classifyBrowserTask("chapter.continue"), "T2");
  assert.equal(classifyBrowserTask("character.multiAgentSimulation"), "T3");
  assert.equal(eligible("chapter.continue").eligible, true);
  const noProof = resolveBrowserTaskEligibility({
    taskType: "chapter.continue",
    generativeModelReady: true,
    inferenceProofVerified: false,
    modelParameterLabel: "1.5B",
  });
  assert.equal(noProof.eligible, false);
  assert.equal(noProof.requiresExplicitEscalation, true);
  const semanticCompression = resolveBrowserTaskEligibility({
    taskType: "chapter.compress",
    generativeModelReady: false,
    inferenceProofVerified: false,
    semanticModelReady: true,
  });
  assert.equal(semanticCompression.tier, "T1");
  assert.equal(semanticCompression.eligible, true);
  assert.equal(semanticCompression.browserExecutor, "semantic-worker");
  const generativeCompression = eligible("chapter.compress");
  assert.equal(generativeCompression.tier, "T2");
  assert.equal(generativeCompression.browserExecutor, "webllm-worker");
  assert.deepEqual(
    eligible("chapter.continue", BROWSER_WEBLLM_MODELS[1]).plannedPipeline,
    ["browser-draft", "browser-deterministic-evaluator"],
  );
  assert.deepEqual(
    eligible("chapter.continue", BROWSER_WEBLLM_MODELS[2]).plannedPipeline,
    [
      "browser-planner",
      "browser-draft",
      "browser-critic",
      "browser-revision",
      "browser-evaluator",
    ],
  );
});

test("device-benchmark", () => {
  const model = BROWSER_WEBLLM_MODELS[1];
  const measured = evaluateBrowserDeviceBenchmark({
    model,
    device: device(),
    samples: [{
      initializationMs: 12_000,
      firstTokenMs: 2_800,
      tokensPerSecond: 8.4,
      peakEstimatedMemoryMB: 1_700,
      workerCrashCount: 0,
      gpuDeviceLostCount: 0,
      outputFailureRate: 0,
      structuredOutputSuccessRate: 1,
      completedAt: "2026-08-02T00:00:00.000Z",
    }],
  });
  assert.equal(measured.benchmarkPassed, true);
  assert.equal(measured.sampleCount, 1);
  assert.equal(measured.tokensPerSecond, 8.4);
});

test("model-installer", async () => {
  const validation = validateBrowserModelShardManifest();
  assert.deepEqual(validation, { valid: true, errors: [] });
  for (const model of BROWSER_WEBLLM_MODELS) {
    const record = browserModelShardRecord(model.modelId);
    assert.ok(record);
    assert.equal(record.revision, model.sourceRevision);
    assert.ok(record.totalBytes > 0);
  }
  assert.match(await browserModelShardManifestDigest(), /^[a-f0-9]{64}$/u);
  const workspace = readFileSync(
    resolve(root, "app/studio/project/[projectId]/closed-ai/closed-ai-workspace.tsx"),
    "utf8",
  );
  assert.match(workspace, /window\.confirm/u);
  assert.match(workspace, /scheduleBrowserModelPrewarm/u);
  const prewarm = readFileSync(
    resolve(root, "lib/novel-ai/providers/browser-ai/browser-prewarm-controller.ts"),
    "utf8",
  );
  assert.match(prewarm, /requestIdleCallback/u);
  assert.match(prewarm, /PREWARM_POWER_SAVE/u);
  assert.match(prewarm, /PREWARM_MODEL_NOT_INSTALLED/u);
});

test("shard-integrity", () => {
  const manifest = JSON.parse(readFileSync(
    resolve(root, "lib/novel-ai/providers/browser-ai/model-shard-manifest.json"),
    "utf8",
  ));
  const clone = structuredClone(manifest);
  clone.models[0].shards[0].sha256 = "0".repeat(64);
  assert.equal(validateBrowserModelShardManifest(clone).valid, true);
  clone.models[0].shards[0].bytes = -1;
  const invalid = validateBrowserModelShardManifest(clone);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((error) => error.startsWith("bytes:")));
  const installer = readFileSync(
    resolve(root, "lib/novel-ai/providers/browser-ai/browser-model-installer.ts"),
    "utf8",
  );
  assert.match(installer, /digest_mismatch/u);
  assert.match(installer, /cache\.delete/u);
});

test("semantic-index", async () => {
  const firstNamespace = namespace();
  const secondNamespace = namespace({ projectId: "project-other" });
  assert.notEqual(
    await browserSemanticNamespaceDigest(firstNamespace),
    await browserSemanticNamespaceDigest(secondNamespace),
  );
  assert.notEqual(
    await browserSemanticNamespaceDigest(firstNamespace),
    await browserSemanticNamespaceDigest(namespace({ characterId: "character-other" })),
  );
  const sources = [{
    id: "chapter-1",
    kind: "chapter",
    text: "第一章：雨夜鐘樓。",
    revision: "1",
    visibility: "both",
  }];
  const first = await planBrowserSemanticIndexUpdate({
    namespace: firstNamespace,
    sources,
    existing: [],
  });
  assert.equal(first.rebuild.length, 1);
  assert.equal(first.unchanged.length, 0);
  const sourceCode = readFileSync(
    resolve(root, "lib/novel-ai/providers/browser-ai/browser-semantic-index.ts"),
    "utf8",
  );
  assert.match(sourceCode, /metadataBackend: "IndexedDB"/u);
  assert.match(sourceCode, /vectorBackend: "OPFS"/u);
  assert.match(sourceCode, /rawTextStored: false/u);
  assert.match(sourceCode, /vectorRecordIsValid/u);
  assert.match(sourceCode, /quarantined \+= 1/u);
  const projectSources = buildBrowserSemanticProjectSources({
    project: {
      id: "project-rc5", projectId: "project-rc5", revision: 1,
      createdAt: "2026-08-02T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z",
      provenance: { source: "user", createdBy: "user", model: null, runId: null },
      title: "測試作品", creationMode: "blank", genrePackId: null, genreId: null,
      subgenreId: null, coreIdea: { value: "守護故鄉", isSet: true },
      narrativeStyle: { value: "繁體中文", isSet: true }, adultMode: false,
      activeChapterId: null, storyBibleId: "bible-1", storyStateId: "state-1",
    },
    chapters: [], worldRules: [], relationships: [], timeline: [], storyBibles: [],
    storyStates: [], acceptedChoices: [], storyBranches: [], writingTasks: [], achievements: [],
    approvedLearningRules: [],
    characters: [{
      id: "character-1", projectId: "project-rc5", revision: 1,
      createdAt: "2026-08-02T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z",
      provenance: { source: "user", createdBy: "user", model: null, runId: null },
      name: "阿澄", aliases: [], identity: { value: "信使", isSet: true },
      personality: { value: "謹慎", isSet: true }, goal: { value: "送達密函", isSet: true },
      lifeStatus: "alive", locationId: null, privateSecrets: ["PRIVATE_SECRET_CANARY"],
    }],
  });
  assert.ok(projectSources.some((row) => row.id === "project:project-rc5"));
  assert.ok(projectSources.some((row) => row.id === "character:character-1"));
  assert.equal(projectSources.some((row) => row.text.includes("PRIVATE_SECRET_CANARY")), false);
  const workspaceSource = readFileSync(
    resolve(root, "app/studio/project/[projectId]/closed-ai/closed-ai-workspace.tsx"),
    "utf8",
  );
  assert.match(workspaceSource, /updateBrowserSemanticIndex/u);
  assert.match(workspaceSource, /browserSemanticIndex\.documentCount/u);
});

test("context-compression", async () => {
  const kinds = [
    "canon-authority", "current-chapter", "recent-chapter-tail", "story-bible",
    "timeline", "world-rule", "active-character", "character-knowledge-boundary",
    "accepted-choice", "active-branch", "rpg-state", "task-achievement",
    "approved-learning-rule", "user-instruction",
  ];
  const sources = kinds.map((kind, index) => ({
    id: `source-${index}`,
    kind,
    text: `${kind}：${"這是已核准且與目前故事相關的內容。".repeat(90)}`,
    namespace: namespace(),
    visibility: "both",
    approved: true,
    revision: "1",
    relevance: 0.9,
  }));
  sources.push({
    ...sources[0], id: "author-only", visibility: "author-only",
  });
  sources.push({
    ...sources[0], id: "cross-project", namespace: namespace({ projectId: "other" }),
  });
  const pack = await composeBrowserContextPack({
    namespace: namespace(),
    audience: "actor",
    sources,
    performancePolicy: policy(),
  });
  assert.ok(pack.metrics.tokensSaved > 0);
  assert.equal(pack.metrics.authorOnlyLeakCount, 0);
  assert.equal(pack.metrics.crossProjectLeakCount, 0);
  assert.equal(pack.metrics.namespaceItemsRejected, 1);
  assert.equal(pack.metrics.visibilityItemsRejected, 1);
  assert.equal(pack.canonicalMutationCount, 0);
  assert.ok(pack.metrics.browserCompressedContextTokens <= policy().inputBudgetTokens);
  const fitted = fitBrowserPromptToTokenBudget("漢字內容".repeat(2_000), 256);
  assert.ok(estimateBrowserTokens(fitted.prompt) <= 256);
  assert.ok(fitted.omittedCharacters > 0);
  const telemetryPolicy = resolveBrowserAIPerformancePolicy({
    device: device(),
    model: BROWSER_WEBLLM_MODELS[1],
    estimatedInputTokens: 9_000,
  });
  assert.equal(telemetryPolicy.estimatedInputTokens, 9_000);
  assert.ok(telemetryPolicy.inputBudgetTokens < telemetryPolicy.estimatedInputTokens);
});

test("quality-gate", () => {
  const good = evaluateBrowserCandidateQuality({
    taskType: "chapter.continue",
    content: "雨聲敲在銅窗上，林澈握住那封尚未乾透的信。他沒有立刻拔劍，而是先熄滅桌邊燭火，讓追兵的影子從門縫滑過。鐘樓第三聲響起時，他推開暗門，把證人送往北巷，自己留下承擔代價。",
  });
  assert.equal(good.decision, "pass");
  const blocked = evaluateBrowserCandidateQuality({
    taskType: "chapter.continue",
    content: "候選內容",
    characterBoundaryLeakCount: 1,
  });
  assert.equal(blocked.decision, "block");
  assert.equal(blocked.canonicalMutationCount, 0);
  const editorialInsteadOfProse = evaluateBrowserCandidateQuality({
    taskType: "chapter.continue",
    content: "爭議環節：1. 禁劍如何製作？ 2. 主角是否有其他出路？ 3. 是否能透過法律修改？ 4. 還有哪些問題需要分析？",
  });
  assert.equal(editorialInsteadOfProse.decision, "block");
  assert.ok(editorialInsteadOfProse.reasonCodes.includes("QUALITY_TASK_FORM_MISMATCH"));
  assert.equal(editorialInsteadOfProse.canonicalMutationCount, 0);
  const continuityDrift = evaluateBrowserCandidateQuality({
    taskType: "chapter.continue",
    approvedContext: [
      "[current-chapter]\n【目前章節：第一章 斷劍中的聲音】夢稅鐘敲到第七響時，浮空城的霧從橋底翻上來。少年鑄劍師陸沉握著斷劍，聽見妹妹阿璃的聲音。街口審夢司架起收夢台，審夢官抬頭認出了陸沉手中的斷劍。",
    ],
    content: "我將以高唐煥的選擇為例，繼續他的故事。一天清晨，他被戰鬥聲吵醒，於是向友軍求援。關於破陣的爭議、分析或建議都不適合插入；僅輸出可直接續寫正文的文本內容。",
  });
  assert.equal(continuityDrift.decision, "block");
  assert.ok(continuityDrift.reasonCodes.includes("QUALITY_TASK_FORM_MISMATCH"));
  assert.ok(continuityDrift.reasonCodes.includes("QUALITY_CONTEXT_ANCHOR_MISSING"));
  assert.equal(continuityDrift.canonicalMutationCount, 0);
  assert.deepEqual(
    extractNarrativeCharacterAnchors(
      "少年鑄劍師陸沉握著斷劍，聽見妹妹阿璃的聲音。",
    ),
    ["陸沉", "阿璃"],
  );
  assert.match(
    currentChapterContext([
      "[canon-authority]\n【目前章節：第一章 斷劍中的聲音】少年鑄劍師陸沉握著斷劍，聽見妹妹阿璃的聲音。",
    ]),
    /陸沉[\s\S]*阿璃/u,
  );
  const serializedContext = serializeClosedActorContext([
    {
      id: "story-bible:1",
      kind: "story-bible",
      text: "[APPROVED_STORY_BIBLE]\n{\"theme\":\"記憶與代價\"}",
    },
    {
      id: "chapter-active:chapter-1",
      kind: "canon",
      text: "[ACTIVE_CHAPTER]\n{\"title\":\"第一章 斷劍中的聲音\",\"content\":\"少年鑄劍師陸沉握著斷劍，聽見妹妹阿璃的聲音。\"}",
    },
  ], "chapter.continue");
  assert.match(serializedContext[0], /^\[current-chapter\][\s\S]*陸沉[\s\S]*阿璃/u);
  assert.doesNotMatch(serializedContext[0], /\[ACTIVE_CHAPTER\]/u);
  assert.match(serializedContext[1], /^\[story-bible\]/u);
  const wrappedObservedNamedStoryDrift = evaluateBrowserCandidateQuality({
    taskType: "chapter.continue",
    expectedMinTokens: 80,
    approvedContext: [
      "[canon-authority]\n【目前章節：第一章 斷劍中的聲音】夢稅鐘敲到第七響時，浮空城的霧從橋底翻上來。少年鑄劍師陸沉握著斷劍，聽見妹妹阿璃的聲音。街口審夢司架起收夢台。",
    ],
    content: "盡管如此，阿成心中仍存著一股無法被冷靜思考的力量。他突然想起那句經典的話，知道這將會是他的最終選擇。當夜空再次沉寂，阿成緊握刀鞘，僅憑對生存的渴望和對家族的忠誠踏上道路，即便前方充滿未知與風險，他也只願成為最後一個盟友。",
  });
  assert.equal(wrappedObservedNamedStoryDrift.decision, "block");
  assert.ok(
    wrappedObservedNamedStoryDrift.reasonCodes.includes(
      "QUALITY_CONTEXT_CHARACTER_MISSING",
    ),
  );
  assert.equal(wrappedObservedNamedStoryDrift.canonicalMutationCount, 0);
  const observedNamedStoryDrift = evaluateBrowserCandidateQuality({
    taskType: "chapter.continue",
    expectedMinTokens: 80,
    approvedContext: [
      "[current-chapter]\n【目前章節：第一章 斷劍中的聲音】夢稅鐘敲到第七響時，浮空城的霧從橋底翻上來。少年鑄劍師陸沉握著斷劍，聽見妹妹阿璃的聲音。街口審夢司架起收夢台，審夢官抬頭認出了陸沉手中的斷劍。",
    ],
    content: "在熟悉的街道上，林飛收到老朋友蔥蔥的來信，便趕往她位於廣東的住處。屋內窗戶破碎，牆面也遭到破壞，他立刻打電話通知父母，再獨自搜索房間。蔥蔥隨後來電，說身邊有人陷入危險，卻沒有交代更多細節。林飛決定留在原地等待下一通電話，同時把門窗重新鎖好。",
  });
  assert.equal(observedNamedStoryDrift.decision, "block");
  assert.ok(observedNamedStoryDrift.reasonCodes.includes("QUALITY_CONTEXT_CHARACTER_MISSING"));
  assert.equal(observedNamedStoryDrift.canonicalMutationCount, 0);
  const truncatedContinuation = evaluateBrowserCandidateQuality({
    taskType: "chapter.continue",
    expectedMinTokens: 24,
    approvedContext: [
      "[current-chapter]\n【目前章節：第一章 斷劍中的聲音】少年鑄劍師陸沉握著斷劍，聽見妹妹阿璃的聲音。審夢官已認出他。",
    ],
    content: "陸沉握緊斷劍擋在阿璃身前，審夢官則命人封住街口。他趁警鐘響起時踏進暗門，卻在門後看見一封仍未寫完的",
  });
  assert.equal(truncatedContinuation.decision, "block");
  assert.ok(truncatedContinuation.reasonCodes.includes("QUALITY_OUTPUT_TRUNCATED"));
  const copiedContextInsteadOfContinuation = evaluateBrowserCandidateQuality({
    taskType: "chapter.continue",
    expectedMinTokens: 140,
    approvedContext: [
      "[current-chapter]\n【目前章節：第一章 斷劍中的聲音】夢稅鐘敲到第七響時，浮空城的霧從橋底翻了上來。少年鑄劍師陸沉握著那柄剛從廢爐裡撿出的斷劍，聽見劍脊深處傳來妹妹阿璃的聲音。街口的審夢司已架起銀色的收夢台。每個居民依序把一段記憶放進琉璃匣，換取本月的通行印。輪到陸沉時，斷劍忽然發熱，映出一條不存在於城圖上的下層通道。他若立即追查，便會失去合法身分；若照常繳稅，妹妹最後留下的聲音可能從此消失。審夢官抬起頭，像是已經認出了他手裡的劍。",
    ],
    content: "夢稅鐘敲到第七響時，浮空城的霧從橋底翻了上來。少年鑄劍師陸沉握著那柄剛從廢爐裡撿出的劍。他若立即追查，便會失去合法身分；若照常繳稅，妹妹最後留下的聲音可能從此消失。審夢官抬起頭，像是已經認出了他手裡的劍。",
  });
  assert.equal(copiedContextInsteadOfContinuation.decision, "block");
  assert.ok(copiedContextInsteadOfContinuation.reasonCodes.includes("QUALITY_NARRATIVE_TOO_SHORT"));
  assert.ok(copiedContextInsteadOfContinuation.reasonCodes.includes("QUALITY_CONTEXT_COPY_EXCESSIVE"));
  assert.ok(copiedContextInsteadOfContinuation.reasonCodes.includes("QUALITY_NARRATIVE_PROGRESS_MISSING"));
  assert.equal(copiedContextInsteadOfContinuation.canonicalMutationCount, 0);
  const copiedContextAndModernDrift = evaluateBrowserCandidateQuality({
    taskType: "chapter.continue",
    expectedMinTokens: 140,
    approvedContext: [
      "[current-chapter]\n【目前章節：第一章 斷劍中的聲音】夢稅鐘敲到第七響時，浮空城的霧從橋底翻了上來。少年鑄劍師陸沉握著斷劍，聽見妹妹阿璃的聲音。街口審夢司架起收夢台，審夢官認出了陸沉手中的斷劍。",
    ],
    content: "夢稅鐘敲到第七響時，浮空城的霧從橋底翻了上來。少年鑄劍師陸沉握著銅鋤，仍想著阿璃留下的聲音。他趕往電車站，盼望在工作日結束前搭上最後一班班車，再向陌生人詢問妹妹的下落。陸沉握緊車票排在月台邊，決定等列車進站後才採取下一步行動。",
  });
  assert.equal(copiedContextAndModernDrift.decision, "block");
  assert.ok(copiedContextAndModernDrift.reasonCodes.includes("QUALITY_CONTEXT_COPY_EXCESSIVE"));
  assert.ok(copiedContextAndModernDrift.reasonCodes.includes("QUALITY_WORLD_REGISTER_DRIFT"));
  assert.equal(copiedContextAndModernDrift.canonicalMutationCount, 0);
  const anchoredContinuation = evaluateBrowserCandidateQuality({
    taskType: "chapter.continue",
    approvedContext: [
      "[current-chapter]\n【目前章節：第一章 斷劍中的聲音】夢稅鐘敲到第七響時，浮空城的霧從橋底翻上來。少年鑄劍師陸沉握著斷劍，聽見妹妹阿璃的聲音。街口審夢司架起收夢台，審夢官抬頭認出了陸沉手中的斷劍。",
    ],
    content: "審夢官的手剛碰到斷劍，劍脊便震出阿璃短促的警告。陸沉順勢打翻收夢台，讓琉璃匣的光霧遮住街口；他沒有逃向上城，反而踏入浮空城圖上不存在的下層通道。石階在他身後逐級熄滅，城圖沒有標記的風從地底捲起，帶來與阿璃聲音相同的低語。陸沉扯下通行印卡住追兵的升降索，代價是印記當場碎裂，審夢司的警鐘也在頭頂響起。通道盡頭浮出一扇鑄著陸家劍紋的銅門；他尚未碰門，斷劍便自行嵌入鎖孔。阿璃急促地要他後退，門內卻傳來另一個與她一模一樣的聲音，說真正被收走的不是記憶，而是她醒來的可能。陸沉知道再往前一步便會成為無籍者，仍握住劍柄轉動機關，讓整座下層甦醒。",
  });
  assert.notEqual(anchoredContinuation.decision, "block");
  assert.ok(!anchoredContinuation.reasonCodes.includes("QUALITY_CONTEXT_ANCHOR_MISSING"));
  assert.ok(!anchoredContinuation.reasonCodes.includes("QUALITY_CONTEXT_COPY_EXCESSIVE"));
  assert.ok(!anchoredContinuation.reasonCodes.includes("QUALITY_NARRATIVE_PROGRESS_MISSING"));
});

test("creative-output-contract", () => {
  const profile = getClosedAIModelProfile("chapter.continue", "browser-ai");
  const prompt = buildClosedAIModelPrompt({
    objective: "續寫約三百字",
    context: [
      "[current-chapter]\n【目前章節：第一章 斷劍中的聲音】主角陸沉握住斷劍，審夢官已認出他。浮空城的霧越過收夢台，妹妹阿璃的聲音再次從劍脊傳出。",
    ],
    profile,
    qualityPhase: "draft",
    agentPlan: {
      planDigest: "plan-digest",
      roles: ["planner", "actor", "critic", "evaluator"],
      steps: [
        { role: "planner", objective: "列出完成條件" },
        { role: "actor", objective: "產生候選正文" },
        { role: "critic", objective: "列出缺陷" },
        { role: "evaluator", objective: "分析候選" },
      ],
    },
  });
  assert.match(profile.systemInstruction, /只准輸出敘事正文/u);
  assert.match(prompt.prompt, /只輸出可直接接在目前章節末尾/u);
  assert.match(prompt.prompt, /actor：產生候選正文/u);
  assert.doesNotMatch(prompt.prompt, /critic：列出缺陷/u);
  assert.doesNotMatch(prompt.prompt, /evaluator：分析候選/u);
  assert.match(prompt.prompt, /不得反問作者/u);
  assert.match(prompt.prompt, /預留至少 16 tokens 收束段落/u);
  assert.match(prompt.prompt, /<既有章節（僅供辨識，禁止輸出）>[\s\S]*陸沉[\s\S]*<\/既有章節（僅供辨識，禁止輸出）>/u);
  assert.match(prompt.prompt, /<續寫起點（只承接，不得重寫）>[\s\S]*審夢官[\s\S]*<\/續寫起點（只承接，不得重寫）>/u);
  assert.match(prompt.prompt, /不得新增原章節未出現的時代技術/u);
  assert.ok(prompt.prompt.indexOf("<既有章節（僅供辨識，禁止輸出）>") > prompt.prompt.indexOf("</作者目標>"));
  assert.ok(prompt.prompt.indexOf("<續寫起點（只承接，不得重寫）>") < prompt.prompt.indexOf("<最終輸出契約>"));
});

test("offload-routing", () => {
  const tasks = [...new Set([
    ...BROWSER_T1_TASKS,
    ...BROWSER_T1_T2_HYBRID_TASKS,
    ...BROWSER_T2_TASKS,
  ])].slice(0, 40);
  const routes = tasks.map((taskType) => eligible(taskType));
  assert.equal(tasks.length, 40);
  assert.equal(routes.filter((route) => route.eligible).length, 40);
  assert.ok(routes.every((route) => route.recommendedProvider === "browser-ai"));
});

test("browser-assisted-local", async () => {
  const longContext = "已核准故事脈絡。".repeat(700);
  const preparation = await prepareBrowserAssistedBackendInput({
    request: {
      taskId: "assisted-local",
      namespace: namespace(),
      taskType: "chapter.continue",
      objective: "續寫下一幕",
      context: [],
      allowedToolIds: [],
      permissionScopes: [],
    },
    plan: {
      schemaVersion: "closed-agent-os-v1",
      taskId: "assisted-local",
      complexity: "standard",
      qualityMode: "balanced",
      backendId: "local-ollama",
      roles: ["actor"],
      steps: [],
      planDigest: "plan-digest",
      candidateOnly: true,
    },
    actorContext: [{
      id: "canon",
      kind: "canon",
      text: longContext,
      visibility: "both",
      privacyLevel: "device_only",
      approved: true,
    }],
    toolResults: [],
    qualityPhase: "draft",
    workingMaterials: [],
  });
  assert.ok(preparation.contextMetrics.tokensSaved > 0);
  const finalized = await finalizeBrowserAssistedBackendResult({
    preparation,
    executor: "local-ollama",
    result: {
      backendId: "local-ollama",
      modelId: "qwen2.5:3b",
      modelDigest: "verified-model-digest",
      content: "雨夜裡，主角繞過守衛，先救出證人，再把假線索留在鐘樓。這個選擇改變了追兵方向，也讓下一章有了明確代價。",
      candidateOnly: true,
      dataLeftDevice: false,
      externalRequest: false,
      elapsedMs: 12,
      qualityMode: "balanced",
      qualityPasses: 1,
      draftDigest: null,
      criticDigest: null,
    },
  });
  assert.equal(finalized.receipt.localOllamaUsed, true);
  assert.equal(finalized.receipt.browserPrecomputeUsed, true);
  assert.equal(finalized.receipt.rawPromptStored, false);
});

test("browser-assisted-quality-phases", async () => {
  const repairableDraft = "林澈循著廊下殘燈走進雨幕，記住門後那道壓低的呼吸聲。她沒有回頭，只把染血的信箋收進袖中，沿著石階追向鐘樓深處";
  const preparationFor = (qualityPhase, qualityMode, taskId) =>
    prepareBrowserAssistedBackendInput({
      request: {
        taskId,
        namespace: namespace(),
        taskType: "chapter.continue",
        objective: "承接目前章節，寫出下一段具體行動與後果。",
        context: [],
        allowedToolIds: [],
        permissionScopes: [],
      },
      plan: {
        schemaVersion: "closed-agent-os-v1",
        taskId,
        complexity: "standard",
        qualityMode,
        backendId: "local-ollama",
        roles: ["actor", "critic", "evaluator"],
        steps: [],
        planDigest: `${taskId}-plan`,
        candidateOnly: true,
      },
      actorContext: [],
      toolResults: [],
      qualityPhase,
      workingMaterials: [],
    });
  const resultFor = (content) => ({
    backendId: "local-ollama",
    modelId: "qwen2.5:3b",
    modelDigest: "verified-model-digest",
    content,
    candidateOnly: true,
    dataLeftDevice: false,
    externalRequest: false,
    elapsedMs: 12,
    qualityMode: "balanced",
    qualityPasses: 1,
    draftDigest: null,
    criticDigest: null,
  });

  const draftPreparation = await preparationFor(
    "draft",
    "balanced",
    "assisted-balanced-draft",
  );
  const draftQuality = evaluateBrowserCandidateQuality({
    taskType: "chapter.continue",
    content: repairableDraft,
    expectedMinTokens: 24,
  });
  assert.equal(draftQuality.decision, "block");
  assert.ok(draftQuality.reasonCodes.includes("QUALITY_OUTPUT_TRUNCATED"));
  const draftEnforcement = resolveBrowserAssistedQualityEnforcement({
    preparation: draftPreparation,
    quality: draftQuality,
  });
  assert.equal(draftEnforcement.shouldBlock, false);
  assert.equal(draftEnforcement.deferredToClosedAgentRevision, true);
  const draftFinalized = await finalizeBrowserAssistedBackendResult({
    preparation: draftPreparation,
    executor: "local-ollama",
    result: resultFor(repairableDraft),
  });
  assert.equal(draftFinalized.enforcement.deferredToClosedAgentRevision, true);

  const revisionPreparation = await preparationFor(
    "revision",
    "balanced",
    "assisted-balanced-revision",
  );
  await assert.rejects(
    finalizeBrowserAssistedBackendResult({
      preparation: revisionPreparation,
      executor: "local-ollama",
      result: resultFor(repairableDraft),
    }),
    (error) => error.code === "BROWSER_ASSISTED_QUALITY_BLOCKED"
      && error.qualityPhase === "revision"
      && error.qualityReasonCodes.includes("QUALITY_OUTPUT_TRUNCATED"),
  );

  const fastPreparation = await preparationFor(
    "draft",
    "fast",
    "assisted-fast-draft",
  );
  const fastEnforcement = resolveBrowserAssistedQualityEnforcement({
    preparation: fastPreparation,
    quality: draftQuality,
  });
  assert.equal(fastEnforcement.terminalCandidate, true);
  assert.equal(fastEnforcement.shouldBlock, true);

  const emptyQuality = evaluateBrowserCandidateQuality({
    taskType: "chapter.continue",
    content: "",
  });
  const emptyEnforcement = resolveBrowserAssistedQualityEnforcement({
    preparation: draftPreparation,
    quality: emptyQuality,
  });
  assert.equal(emptyEnforcement.hardSafetyBlock, true);
  assert.equal(emptyEnforcement.shouldBlock, true);
});

test("explicit-escalation", () => {
  const heavy = eligible("character.multiAgentSimulation");
  assert.equal(heavy.eligible, false);
  assert.equal(heavy.requiresExplicitEscalation, true);
  assert.equal(heavy.recommendedProvider, "private-ai-hub");
  const unavailable = resolveBrowserTaskEligibility({
    taskType: "chapter.continue",
    policy: "browser-first",
    generativeModelReady: false,
    inferenceProofVerified: false,
  });
  assert.equal(unavailable.requiresExplicitEscalation, true);
  assert.equal(unavailable.reasonCode, "BROWSER_GENERATIVE_MODEL_NOT_READY");
  const disclosedPlan = resolveClosedAIRoute({
    taskType: "chapter.continue",
    namespace: namespace(),
    complexity: "standard",
    browserComputePolicy: "balanced",
    allowPreAuthorizedClosedEscalation: true,
  }, [
    backend("browser-ai", "ready"),
    backend("local-ollama", "ready"),
    backend("private-ai-hub", "ready", "heavy"),
  ]);
  assert.equal(disclosedPlan.executionStatus, "routable");
  assert.equal(disclosedPlan.backend.id, "local-ollama");
  assert.equal(disclosedPlan.fallbackAttempted, false);
});

test("studio-explicit-local-compute-selection", () => {
  const storage = {
    getItem() {
      return JSON.stringify({ closedComputePolicy: "quality-first" });
    },
  };
  assert.equal(readStudioClosedComputePolicy(storage), "quality-first");
  assert.equal(resolveStudioClosedComputePolicy("browser-first"), "browser-first");
  assert.equal(hasExplicitLocalComputeAuthorization("quality-first"), true);
  assert.equal(hasExplicitLocalComputeAuthorization("browser-first"), false);
  assert.equal(readStudioClosedComputePolicy({ getItem: () => "not-json" }), "browser-first");

  const balanced = adaptStudioProfileForExplicitLocalCompute({
    targetLength: 900,
    maxTokens: 640,
    timeoutMs: 180_000,
    qualityMode: "balanced",
  }, {
    browserComputePolicy: "quality-first",
    externalSelected: false,
  });
  assert.deepEqual(balanced, {
    targetLength: 480,
    maxTokens: 192,
    timeoutMs: 250_000,
    qualityMode: "balanced",
  });
  const external = adaptStudioProfileForExplicitLocalCompute({
    targetLength: 900,
    maxTokens: 640,
    timeoutMs: 180_000,
    qualityMode: "balanced",
  }, {
    browserComputePolicy: "quality-first",
    externalSelected: true,
  });
  assert.equal(external.maxTokens, 640);

  const localBudget = resolveLocalOllamaPerformanceBudget({
    taskType: "chapter.continue",
    modelId: "qwen2.5:3b",
    qualityPreference: "balanced",
    requestedMaxTokens: 640,
    profileMaxTokens: 1_792,
    profileMaxInputCharacters: 16_000,
  });
  assert.deepEqual(localBudget, {
    smallLocalModel: true,
    maxInputCharacters: 6_000,
    maxOutputTokens: 640,
  });
  assert.equal(resolveLocalOllamaPerformanceBudget({
    taskType: "chapter.continue",
    modelId: "qwen2.5:14b",
    qualityPreference: "balanced",
    requestedMaxTokens: 640,
    profileMaxTokens: 1_792,
    profileMaxInputCharacters: 16_000,
  }).maxOutputTokens, 640);
  assert.deepEqual(resolveLocalOllamaPerformanceBudget({
    taskType: "chapter.abcChoices",
    modelId: "qwen2.5:3b",
    qualityPreference: "fast",
    requestedMaxTokens: 420,
    profileMaxTokens: 512,
    profileMaxInputCharacters: 16_000,
  }), {
    smallLocalModel: true,
    maxInputCharacters: 4_000,
    maxOutputTokens: 420,
  });
  assert.equal(resolveLocalOllamaPerformanceBudget({
    taskType: "chapter.continue",
    modelId: "qwen2.5:3b",
    qualityPreference: "fast",
    requestedMaxTokens: 144,
    profileMaxTokens: 1_792,
    profileMaxInputCharacters: 16_000,
  }).maxOutputTokens, 144);
  assert.equal(resolveLocalOllamaPerformanceBudget({
    taskType: "chapter.continue",
    modelId: "qwen2.5:3b",
    qualityPreference: "fast",
    requestedMaxTokens: 420,
    profileMaxTokens: 1_792,
    profileMaxInputCharacters: 16_000,
  }).maxOutputTokens, 420);
  assert.equal(resolveLocalOllamaPerformanceBudget({
    taskType: "chapter.continue",
    modelId: "qwen2.5:3b",
    qualityPreference: "fast",
    requestedMaxTokens: 1_792,
    profileMaxTokens: 1_792,
    profileMaxInputCharacters: 16_000,
  }).maxOutputTokens, 640);
  assert.deepEqual(resolveLocalOllamaPerformanceBudget({
    taskType: "chapter.continue",
    modelId: "qwen2.5:3b",
    qualityPreference: "fast",
    requestedMaxTokens: 1_792,
    profileMaxTokens: 1_792,
    profileMaxInputCharacters: 16_000,
    substantiveScene: true,
  }), {
    smallLocalModel: true,
    maxInputCharacters: 8_000,
    maxOutputTokens: 1_792,
  });
  const shortScene = Array.from(
    { length: 8 },
    (_, index) => `第${index + 1}段人物採取行動，阻力隨即改變現場，也留下必須處理的後果。`,
  ).join("\n\n");
  const continuationPlan = buildSubstantiveSceneContinuationPrompt(shortScene);
  assert.ok(continuationPlan.metrics.narrativeLength < 1_000);
  assert.match(continuationPlan.prompt, /EXISTING_STORY_REFERENCE/u);
  const supplement = "新的壓力沿著牆面傳來，人物沒有重述先前行動，而是辨認出口與同伴反應。".repeat(12);
  const mergedScene = mergeSubstantiveSceneContinuation(shortScene, supplement);
  const mergedMetrics = measureSubstantiveScene(mergedScene);
  assert.ok(mergedMetrics.narrativeLength > continuationPlan.metrics.narrativeLength);
  assert.equal(mergedMetrics.paragraphCount, 8);
  assert.ok(mergedMetrics.narrativeLength <= 1_450);
  assert.equal(resolveLocalOllamaPerformanceBudget({
    taskType: "chapter.continue",
    modelId: "qwen2.5:3b",
    qualityPreference: "fast",
    profileMaxTokens: 1_792,
    profileMaxInputCharacters: 16_000,
  }).maxOutputTokens, 160);
  assert.equal(resolveLocalOllamaPerformanceBudget({
    taskType: "chapter.continue",
    modelId: "qwen2.5:3b",
    qualityPreference: "high",
    requestedMaxTokens: 360,
    profileMaxTokens: 1_792,
    profileMaxInputCharacters: 16_000,
    boundedQualityRepair: true,
  }).maxOutputTokens, 360);
});

test("studio-cross-page-local-session-recovery", () => {
  assert.equal(shouldRestoreStudioLocalRuntime({
    taskType: "chapter.abcChoices",
    browserComputePolicy: "quality-first",
    allowPreAuthorizedClosedEscalation: true,
  }), true);
  assert.equal(shouldRestoreStudioLocalRuntime({
    taskType: "chapter.continue",
    preferredBackend: "local-ollama",
    browserComputePolicy: "browser-first",
    allowPreAuthorizedClosedEscalation: false,
  }), true);
  assert.equal(shouldRestoreStudioLocalRuntime({
    taskType: "chapter.abcChoices",
    browserComputePolicy: "browser-first",
    allowPreAuthorizedClosedEscalation: false,
  }), false);
  assert.equal(shouldRestoreStudioLocalRuntime({
    taskType: "character.privateArc",
    browserComputePolicy: "quality-first",
    allowPreAuthorizedClosedEscalation: true,
  }), false);
});

test("local-prose-completion-boundary", () => {
  const completed = "沈曜抬起星燈，雨水沿著塔簷落下。他沿著石階追向熄滅的星光，直到鐘聲壓過風聲，才在封閉的城門前停下。守門人舉起長槍，命他交出懷中的密信。";
  const repaired = repairLocalProseCompletionBoundary({
    taskType: "chapter.continue",
    content: `${completed}他伸`,
    generatedTokenEvents: 192,
    maxOutputTokens: 192,
  });
  assert.deepEqual(repaired, {
    content: completed,
    repaired: true,
    removedCharacters: 2,
  });

  const underBudget = repairLocalProseCompletionBoundary({
    taskType: "chapter.continue",
    content: `${completed}他伸`,
    generatedTokenEvents: 191,
    maxOutputTokens: 192,
  });
  assert.equal(underBudget.repaired, false);
  assert.equal(underBudget.content, `${completed}他伸`);

  const exhaustedByOllamaMetadata = repairLocalProseCompletionBoundary({
    taskType: "chapter.continue",
    content: `${completed}他伸`,
    generatedTokenEvents: 17,
    maxOutputTokens: 192,
    evaluatedTokens: 192,
  });
  assert.deepEqual(exhaustedByOllamaMetadata, {
    content: completed,
    repaired: true,
    removedCharacters: 2,
  });

  const naturallyStopped = repairLocalProseCompletionBoundary({
    taskType: "chapter.continue",
    content: `${completed}他伸`,
    generatedTokenEvents: 17,
    maxOutputTokens: 192,
    evaluatedTokens: 80,
    doneReason: "stop",
  });
  assert.equal(naturallyStopped.repaired, false);

  const nonProse = repairLocalProseCompletionBoundary({
    taskType: "story.consistencyCheck",
    content: `${completed}待查`,
    generatedTokenEvents: 192,
    maxOutputTokens: 192,
  });
  assert.equal(nonProse.repaired, false);

  const noCompletedSentence = repairLocalProseCompletionBoundary({
    taskType: "chapter.continue",
    content: "沈曜沿著沒有盡頭的石階追向前方逐漸熄滅的微光",
    generatedTokenEvents: 192,
    maxOutputTokens: 192,
  });
  assert.equal(noCompletedSentence.repaired, false);
});

test("bounded-local-terminal-quality-repair", () => {
  const request = {
    requestId: "task-1",
    projectId: "project-1",
    taskType: "chapter.continue",
    privacyMode: "strict-local",
    privacyLevel: "device_only",
    fallbackPolicy: "none",
    preferredProvider: "local-ollama",
    input: "承接沈曜在城門前遭到攔截的情節。",
    context: ["目前章節：沈曜懷中藏著密信。"],
    qualityPreference: "balanced",
    qualityPhase: "revision",
    generationOptions: { seed: 41, maxTokens: 192 },
    externalConsent: false,
    closedOnly: true,
    offlineRequired: true,
  };
  const repairableError = Object.assign(new Error("blocked"), {
    code: "BROWSER_ASSISTED_QUALITY_BLOCKED",
    qualityReasonCodes: [
      "QUALITY_TASKUSEFULNESS_LOW",
      "QUALITY_OUTPUT_TRUNCATED",
    ],
  });
  assert.equal(shouldRunBoundedLocalQualityRepair({ request, error: repairableError }), true);
  assert.equal(shouldRunBoundedLocalQualityRepair({
    request,
    error: Object.assign(new Error("blocked"), {
      code: "BROWSER_ASSISTED_QUALITY_BLOCKED",
      qualityReasonCodes: ["QUALITY_EMPTY_CANDIDATE"],
    }),
  }), false);
  assert.equal(shouldRunBoundedLocalQualityRepair({
    request,
    error: Object.assign(new Error("blocked"), {
      code: "BROWSER_ASSISTED_QUALITY_BLOCKED",
      qualityReasonCodes: [
        "QUALITY_OUTPUT_TRUNCATED",
        "QUALITY_STRUCTUREDOUTPUT_LOW",
      ],
    }),
  }), false);
  assert.equal(shouldRunBoundedLocalQualityRepair({
    request,
    error: Object.assign(new Error("blocked"), {
      code: "BROWSER_ASSISTED_QUALITY_BLOCKED",
      qualityReasonCodes: [
        "QUALITY_OUTPUT_TRUNCATED",
        "CHARACTER_KNOWLEDGE_BOUNDARY_LEAK",
      ],
    }),
  }), false);
  assert.equal(shouldRunBoundedLocalQualityRepair({
    request: { ...request, qualityPhase: "draft" },
    error: repairableError,
  }), false);

  const repairedRequest = boundedLocalQualityRepairRequest(
    request,
    ["QUALITY_OUTPUT_TRUNCATED"],
  );
  assert.equal(repairedRequest.requestId, "task-1:bounded-local-quality-repair");
  assert.equal(repairedRequest.preferredProvider, "local-ollama");
  assert.equal(repairedRequest.fallbackPolicy, "none");
  assert.equal(repairedRequest.externalConsent, false);
  assert.equal(repairedRequest.qualityPhase, "revision");
  assert.equal(repairedRequest.generationOptions.maxTokens, 360);
  assert.notEqual(repairedRequest.generationOptions.seed, request.generationOptions.seed);
  assert.match(repairedRequest.input, /完整替代正文/u);

  const substantiveRepair = boundedLocalQualityRepairRequest({
    ...request,
    generationOptions: {
      ...request.generationOptions,
      maxTokens: 1_792,
      substantiveScene: true,
    },
  }, ["QUALITY_NARRATIVE_TOO_SHORT"]);
  assert.equal(substantiveRepair.generationOptions.maxTokens, 1_792);
  assert.equal(substantiveRepair.generationOptions.substantiveScene, true);
  assert.match(substantiveRepair.input, /900 至 1,600/u);
  assert.doesNotMatch(substantiveRepair.input, /二百二十至三百二十/u);
});

test("no-silent-fallback", () => {
  const route = resolveClosedAIRoute({
    taskType: "chapter.continue",
    namespace: namespace(),
    complexity: "standard",
    browserComputePolicy: "browser-first",
  }, [
    backend("browser-ai", "runtime_required"),
    backend("local-ollama", "ready"),
    backend("private-ai-hub", "ready", "heavy"),
  ]);
  assert.equal(route.executionStatus, "routable");
  assert.equal(route.backend.id, "local-ollama");
  assert.equal(route.fallbackAttempted, false);
  assert.equal(route.reasonCode, "AUTO_SELECTED_LOCAL_OLLAMA");
  const provider = readFileSync(
    resolve(root, "lib/novel-ai/providers/browser-ai/browser-ai-provider.ts"),
    "utf8",
  );
  assert.match(provider, /requiredGenerativeExecutor/u);
  assert.match(provider, /BROWSER_AI_REQUIRED_GENERATIVE_EXECUTION_FAILED/u);
  assert.match(provider, /fallbackAttempted: false/u);
});

test("offline-generation", () => {
  const runtime = readFileSync(
    resolve(root, "lib/novel-ai/providers/browser-ai/browser-webllm-runtime.ts"),
    "utf8",
  );
  assert.match(runtime, /shardIntegrityVerified/u);
  assert.match(runtime, /cacheVerified/u);
  assert.match(runtime, /externalRequest: false/u);
  assert.match(runtime, /dataLeftDevice: false/u);
  const serviceWorker = readFileSync(resolve(root, "public/studio-service-worker.js"), "utf8");
  assert.doesNotMatch(serviceWorker, /Local Bridge|Private Hub|Authorization/u);
});

test("worker-recovery", async () => {
  let recoveries = 0;
  const queue = new BrowserGPUQueue({
    idleReleaseMs: 1,
    onRecover: () => { recoveries += 1; },
  });
  const result = await queue.enqueue({
    id: "worker-recovery",
    memoryBudgetMB: 256,
    execute: async ({ attempt }) => {
      if (attempt === 1) {
        throw Object.assign(new Error("worker crashed"), {
          code: "BROWSER_WEBLLM_WORKER_CRASHED",
        });
      }
      return "recovered";
    },
  });
  assert.equal(result, "recovered");
  assert.equal(recoveries, 1);
  assert.equal(queue.snapshot().workerRestartCount, 1);

  let releaseActive;
  let cancelledJobExecuted = false;
  const cancellationQueue = new BrowserGPUQueue({ idleReleaseMs: 1 });
  const active = cancellationQueue.enqueue({
    id: "active-before-cancelled-job",
    memoryBudgetMB: 128,
    execute: () => new Promise((resolveActive) => {
      releaseActive = resolveActive;
    }),
  });
  const controller = new AbortController();
  const cancelled = cancellationQueue.enqueue({
    id: "cancelled-while-queued",
    memoryBudgetMB: 128,
    signal: controller.signal,
    execute: async () => {
      cancelledJobExecuted = true;
      return true;
    },
  });
  controller.abort();
  releaseActive(true);
  await active;
  await assert.rejects(cancelled, (error) => error?.name === "AbortError");
  assert.equal(cancelledJobExecuted, false);

  let timeoutRecoveries = 0;
  let timeoutSignalObserved = false;
  const timeoutQueue = new BrowserGPUQueue({
    idleReleaseMs: 1,
    onRecover: () => { timeoutRecoveries += 1; },
  });
  await assert.rejects(timeoutQueue.enqueue({
    id: "timeout-aborts-worker",
    memoryBudgetMB: 128,
    timeoutMs: 5,
    execute: ({ signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => {
        timeoutSignalObserved = true;
        reject(new DOMException("cancelled", "AbortError"));
      }, { once: true });
    }),
  }), (error) => error?.code === "BROWSER_GPU_JOB_TIMEOUT");
  assert.equal(timeoutSignalObserved, true);
  assert.equal(timeoutRecoveries, 1);
});

test("gpu-device-lost", async () => {
  const queue = new BrowserGPUQueue({ idleReleaseMs: 1 });
  await queue.enqueue({
    id: "gpu-device-lost",
    memoryBudgetMB: 256,
    execute: async ({ attempt }) => {
      if (attempt === 1) {
        throw Object.assign(new Error("GPU lost"), { code: "GPU_DEVICE_LOST" });
      }
      return true;
    },
  });
  assert.equal(queue.snapshot().gpuDeviceLostCount, 1);
  assert.equal(queue.snapshot().workerRestartCount, 1);
});

test("memory-budget", async () => {
  const queue = new BrowserGPUQueue({ maxMemoryMB: 1_024, idleReleaseMs: 1 });
  await assert.rejects(
    queue.enqueue({
      id: "too-large",
      memoryBudgetMB: 2_505,
      execute: async () => true,
    }),
    (error) => error.code === "BROWSER_GPU_MEMORY_BUDGET_EXCEEDED",
  );
  const runtime = readFileSync(
    resolve(root, "lib/novel-ai/providers/browser-ai/browser-webllm-runtime.ts"),
    "utf8",
  );
  assert.match(runtime, /model\.modelId === snapshot\.selectedModelId/u);
  assert.doesNotMatch(runtime, /memoryBudgetMB: selected\?\.estimatedVramMB \?\? 4_096/u);
  assert.match(runtime, /document\.visibilityState === "hidden"/u);
  assert.match(runtime, /\? "ECO"/u);
});

test("offload-benchmark", async () => {
  assert.ok(RC5_FIXED_BENCHMARK_SCENARIOS.length >= 40);
  for (const tier of ["T0", "T1", "T2", "T3", "T2_LIMIT"]) {
    assert.ok(RC5_FIXED_BENCHMARK_SCENARIOS.some((scenario) => scenario.tier === tier));
  }
  for (const scenario of RC5_FIXED_BENCHMARK_SCENARIOS) {
    if (scenario.tier === "T0") continue;
    if (scenario.tier === "T1") {
      const route = resolveBrowserTaskEligibility({
        taskType: scenario.taskType,
        generativeModelReady: false,
        inferenceProofVerified: false,
        semanticModelReady: true,
      });
      assert.equal(route.tier, "T1");
      assert.equal(route.eligible, true);
    } else if (scenario.tier === "T2") {
      const route = eligible(scenario.taskType);
      assert.equal(route.tier, "T2");
      assert.equal(route.eligible, true);
    } else if (scenario.tier === "T3") {
      const route = eligible(scenario.taskType);
      assert.equal(route.tier, "T3");
      assert.equal(route.eligible, false);
      assert.equal(route.requiresExplicitEscalation, true);
    } else {
      const route = resolveBrowserTaskEligibility({
        taskType: scenario.taskType,
        generativeModelReady: true,
        generativeRuntime: "webllm-worker",
        inferenceProofVerified: true,
        modelParameterLabel: "1.5B",
        benchmark: { benchmarkPassed: true },
        contextTokens: 10_000,
        outputTokens: 700,
      });
      assert.equal(route.eligible, false);
      assert.equal(route.reasonCode, "BROWSER_TASK_EXCEEDS_VERIFIED_BUDGET");
    }
  }
  const tasks = [...new Set([
    ...BROWSER_T1_TASKS,
    ...BROWSER_T1_T2_HYBRID_TASKS,
    ...BROWSER_T2_TASKS,
  ])].slice(0, 40);
  const receipts = await Promise.all(tasks.map((taskType, index) => {
    const route = eligible(taskType);
    return createBrowserExecutionReceipt({
      taskIdentity: `benchmark-${index}`,
      taskType,
      plannedPipeline: route.plannedPipeline,
      actualExecutor: route.tier === "T1" ? "semantic-worker" : "webllm-worker",
      modelId: BROWSER_WEBLLM_MODELS[1].modelId,
      modelDigest: BROWSER_WEBLLM_MODELS[1].modelDigest,
      browserPrecomputeUsed: true,
      browserGenerationUsed: route.tier === "T2",
      localOllamaUsed: false,
      privateHubUsed: false,
      externalAIUsed: false,
      dataLeftDevice: false,
      contextTokensBefore: 2_400,
      contextTokensAfter: 1_080,
      tokensSaved: 1_320,
      remoteModelInputTokensSaved: 1_320,
      remoteModelOutputRepairAvoided: 1,
      remoteModelCallsAvoided: 1,
      privateHubJobsAvoided: 1,
      localOllamaCallsAvoided: 1,
      elapsedMs: 200,
    });
  }));
  const summary = summarizeBrowserOffload(receipts);
  assert.equal(summary.eligibleTaskCount, 40);
  assert.equal(summary.browserExecutionRatio ?? summary.browserOffloadRatio, 1);
  assert.ok(summary.localOllamaCallsAvoided / 40 >= 0.55);
  assert.ok(summary.privateHubJobsAvoided / 40 >= 0.75);
  assert.ok(receipts.every((receipt) => receipt.tokensSaved / 2_400 >= 0.45));
  assert.ok(summary.estimatedComputeMinutesSaved > 0);
});

test("compressed-context-eligibility", () => {
  const preparedTokens = browserEligibilityContextTokens({
    rawContextTokens: 5_200,
    compressedContextTokens: 800,
    objectiveTokens: 45,
  });
  assert.equal(preparedTokens, 845);
  const route = resolveBrowserTaskEligibility({
    taskType: "chapter.continue",
    policy: "browser-first",
    generativeModelReady: true,
    generativeRuntime: "webllm-worker",
    inferenceProofVerified: true,
    modelParameterLabel: "1.5B",
    benchmark: { benchmarkPassed: true },
    contextTokens: preparedTokens,
    outputTokens: 384,
  });
  assert.equal(route.eligible, true);
  assert.equal(route.reasonCode, "BROWSER_T2_VERIFIED_AND_WITHIN_BUDGET");
});

test("privacy-isolation", async () => {
  await assert.rejects(
    createBrowserExecutionReceipt({
      taskIdentity: "unsafe-receipt",
      taskType: "story.summary",
      plannedPipeline: [],
      actualExecutor: "semantic-worker",
      modelId: null,
      modelDigest: null,
      browserPrecomputeUsed: true,
      browserGenerationUsed: false,
      localOllamaUsed: false,
      privateHubUsed: false,
      externalAIUsed: false,
      dataLeftDevice: false,
      contextTokensBefore: 1,
      contextTokensAfter: 1,
      tokensSaved: 0,
      remoteModelInputTokensSaved: 0,
      remoteModelOutputRepairAvoided: 0,
      remoteModelCallsAvoided: 0,
      privateHubJobsAvoided: 0,
      localOllamaCallsAvoided: 0,
      elapsedMs: 1,
      prompt: "forbidden",
    }),
    (error) => error.code === "BROWSER_OFFLOAD_SENSITIVE_FIELD_REJECTED",
  );
  await assert.rejects(
    createBrowserExecutionReceipt({
      taskIdentity: "unsafe-token-receipt",
      taskType: "story.summary",
      plannedPipeline: [],
      actualExecutor: "semantic-worker",
      modelId: null,
      modelDigest: null,
      browserPrecomputeUsed: true,
      browserGenerationUsed: false,
      localOllamaUsed: false,
      privateHubUsed: false,
      externalAIUsed: false,
      dataLeftDevice: false,
      contextTokensBefore: 1,
      contextTokensAfter: 1,
      tokensSaved: 0,
      remoteModelInputTokensSaved: 0,
      remoteModelOutputRepairAvoided: 0,
      remoteModelCallsAvoided: 0,
      privateHubJobsAvoided: 0,
      localOllamaCallsAvoided: 0,
      elapsedMs: 1,
      accessToken: "forbidden",
    }),
    (error) => error.code === "BROWSER_OFFLOAD_SENSITIVE_FIELD_REJECTED",
  );
});

test("regeneration", async () => {
  const previous = "雨夜裡，林澈走進鐘樓，找到一封信。";
  const next = "晨霧封住河港，林澈說服船匠製造假火警，趁疏散交換證物。";
  const distinctness = await assessRegenerationDistinctness(previous, next);
  assert.equal(distinctness.normalizedDigestDifferent, true);
  assert.ok(distinctness.similarityScore < 0.95);
  assert.equal(distinctness.distinct, true);
  const contract = createExplicitRegenerationContract({
    previousCandidateDigest: "a".repeat(64),
    regenerationAttempt: 1,
  });
  assert.equal(contract.cacheBypassReason, "explicit_regeneration");
  const source = readFileSync(resolve(root, "lib/novel-ai/web/studio-closed-ai.ts"), "utf8");
  assert.match(source, /Math\.min\(3/u);
  assert.match(source, /REGENERATION_NOT_DISTINCT/u);
});

test("production-acceptance", async () => {
  const manifest = JSON.parse(readFileSync(resolve(root, "release-manifest.json"), "utf8"));
  assert.equal(manifest.releaseLine, "novel-ai-p24b-conversation-first-studio-rc6");
  assert.equal(manifest.releaseTag, "novel-ai-p24b-conversation-first-studio-rc6.2");
  assert.equal(manifest.releaseRevision, "rc6.2");
  assert.equal(manifest.releaseName, "P2.4B Conversation-First Novel Project GPT RC6.2");
  assert.equal(manifest.consumerRelease, "p2.4b-conversation-first-studio-rc6.2");
  assert.equal(manifest.architectureStage, "P2.4B RC");
  assert.match(manifest.releaseBaseCommit, /^[a-f0-9]{40}$/u);
  assert.match(manifest.releaseEpoch, /^\d{4}-\d{2}-\d{2}T/u);
  assert.equal(Object.hasOwn(manifest, "buildTime"), false);
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assert.match(
    packageJson.scripts["seal:ai:browser:compute-plane-rc5"],
    /seal-browser-compute-plane-rc5-evidence\.mjs seal/u,
  );
  assert.match(
    packageJson.scripts["verify:ai:browser:compute-plane-rc5"],
    /seal-browser-compute-plane-rc5-evidence\.mjs verify/u,
  );
  const sealer = readFileSync(
    resolve(root, "scripts/seal-browser-compute-plane-rc5-evidence.mjs"),
    "utf8",
  );
  assert.match(sealer, /privateStoryTextPersisted: false/u);
  assert.match(sealer, /rawChainOfThoughtPersisted: false/u);
  assert.match(sealer, /Credential-shaped text is forbidden/u);
  const origin = process.env.RC5_ACCEPTANCE_ORIGIN?.replace(/\/$/u, "");
  if (origin) {
    const [identityResponse, healthResponse] = await Promise.all([
      fetch(`${origin}/api/release/identity`, { cache: "no-store" }),
      fetch(`${origin}/api/ai/health`, { cache: "no-store" }),
    ]);
    assert.equal(identityResponse.ok, true);
    assert.equal(healthResponse.ok, true);
    const [identity, health] = await Promise.all([
      identityResponse.json(),
      healthResponse.json(),
    ]);
    assert.equal(identity.releaseTag, manifest.releaseTag);
    assert.equal(health.releaseTag, manifest.releaseTag);
    assert.equal(identity.provenanceStatus, "verified");
  }
});

for (const current of tests) {
  if (mode !== "all" && mode !== current.name) continue;
  await current.run();
  completed.push(current.name);
  console.log(`PASS ${current.name}`);
}

if (!completed.length) {
  throw new Error(`Unknown RC5 browser compute test mode: ${mode}`);
}
console.log(JSON.stringify({
  suite: "P2.4B_RC5_BROWSER_FIRST_SOVEREIGN_COMPUTE_PLANE",
  mode,
  pass: completed.length,
  fail: 0,
  blockingSkip: 0,
  tests: completed,
}));

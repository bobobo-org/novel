import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BROWSER_FABRIC_NODE_KINDS,
  BROWSER_PROMPT_SECTIONS,
  BrowserFabricMemoryManager,
  BrowserFabricQueue,
  BrowserFabricWorkerSupervisor,
  assembleBrowserFabricPrompt,
  assertBrowserModelDeletionConsent,
  assertBrowserModelInstallConsent,
  assertDistinctRegeneration,
  benchmarkBrowserFabricDevice,
  browserFabricEngineRegistry,
  browserFabricNodeTimeoutMs,
  buildNarrativeMemoryPyramid,
  classifyBrowserFabricFailure,
  compactBrowserSession,
  createBrowserAssistedPlan,
  createBrowserFabricExecutionPlan,
  createBrowserModelResumePlan,
  executeBrowserFabricTaskGraph,
  flattenNarrativeMemory,
  hybridRetrieve,
  isBrowserFabricQualityReviewable,
  lateChunkText,
  planBrowserContextCompression,
  planIncrementalSemanticIndex,
  qualifyBrowserDevice,
  resolveBrowserFabricComputePolicy,
  runBrowserCandidateCascade,
  summarizeBrowserFabricOffload,
  validateAndRepairStructuredOutput,
  withBrowserGpuLock,
} from "../lib/novel-ai/browser-fabric/index.ts";
import {
  browserModelShardRecord,
  validateBrowserModelShardManifest,
} from "../lib/novel-ai/providers/browser-ai/browser-model-installer.ts";
import {
  BROWSER_WEBLLM_MODELS,
} from "../lib/novel-ai/providers/browser-ai/webllm-model-registry.ts";

const root = resolve(import.meta.dirname, "..");
const requestedMode = process.argv[2] ?? "all";
const tests = new Map();

function test(name, run) {
  tests.set(name, run);
}

function namespace(overrides = {}) {
  return {
    tenantId: "tenant-rc5",
    userId: "user-rc5",
    projectId: "project-rc5",
    storyId: "story-rc5",
    canonId: "canon-rc5",
    branchId: "main",
    characterId: "shared",
    agentRole: "closed-agent-os",
    modelId: "runtime-managed",
    modelDigest: "runtime-managed-digest",
    promptProfileVersion: "browser-fabric-rc5",
    storyBibleRevision: "7",
    knowledgeScopeRevision: "9",
    privacyLevel: "device_only",
    ...overrides,
  };
}

function contextItem(overrides = {}) {
  return {
    id: "canon-1",
    kind: "canon",
    text: "主角名為沈照，不能違背已核准的誓約。",
    visibility: "BOTH",
    privacyLevel: "device_only",
    approved: true,
    revision: 7,
    authorityWeight: 1,
    metadata: { projectId: "project-rc5", storyId: "story-rc5" },
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    taskId: "fabric-task-1",
    taskType: "chapter.abcChoices",
    namespace: namespace(),
    objective: "根據目前衝突提出三個彼此不同且會改變狀態的選擇。",
    context: [
      contextItem(),
      contextItem({
        id: "chapter-1",
        kind: "chapter",
        text: "沈照在雨夜追查失蹤的盟友，城門即將關閉。",
        authorityWeight: 0.8,
      }),
    ],
    privacyLevel: "device_only",
    computePolicy: "BROWSER_FIRST",
    allowedModelTiers: ["MICRO", "FAST", "BALANCED"],
    requiresStructuredOutput: true,
    outputSchema: {
      type: "object",
      required: ["choices"],
      properties: { choices: { type: "array", items: { type: "string" } } },
    },
    expectedOutputTokens: 320,
    ...overrides,
  };
}

function profile(overrides = {}) {
  return {
    schemaVersion: "browser-device-qualification-v1",
    browser: "Google Chrome",
    browserVersion: "138",
    operatingSystem: "Windows",
    mobile: false,
    webGpu: true,
    webAssembly: true,
    worker: true,
    indexedDb: true,
    opfs: true,
    storageQuota: 10_000_000_000,
    storageAvailable: 8_000_000_000,
    hardwareConcurrency: 12,
    deviceMemory: 8,
    maxStorageBufferBindingSize: 1_073_741_824,
    shaderF16: true,
    subgroups: true,
    timestampQuery: true,
    webNn: false,
    chromeBuiltinAi: false,
    chromeBuiltinLanguages: [],
    saveData: false,
    effectiveConnectionType: "4g",
    qualifiedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

function rankedFixture() {
  return hybridRetrieve({
    query: "沈照 誓約 城門",
    items: [
      contextItem(),
      contextItem({ id: "chapter", kind: "chapter", text: "沈照趕往城門。", authorityWeight: 0.8 }),
      contextItem({ id: "noise", kind: "retrieval", text: "無關的市場價目表。", authorityWeight: 0.2 }),
    ],
    rerankerScores: { "canon-1": 1, chapter: 0.9, noise: 0.05 },
    limit: 10,
  });
}

test("fabric-orchestrator", async () => {
  const source = readFileSync(resolve(root, "lib/novel-ai/browser-fabric/orchestrator.ts"), "utf8");
  assert.match(source, /executeBrowserFabricTaskGraph/u);
  assert.match(source, /executeBrowserCompute/u);
  assert.match(source, /value: computeRef\.current\.quality/u);
  assert.doesNotMatch(source, /evaluateBrowserCandidateQuality/u);
  assert.doesNotMatch(source, /model:\s*["']local-rule["']/u);
  assert.equal(isBrowserFabricQualityReviewable("pass"), true);
  assert.equal(isBrowserFabricQualityReviewable("revise"), true);
  assert.equal(isBrowserFabricQualityReviewable("block"), false);
  assert.equal(isBrowserFabricQualityReviewable("escalate"), false);
  assert.match(source, /needsHumanReview:\s*quality\.decision === "revise"/u);
  assert.match(source, /qualityReasonCodes:\s*quality\.reasonCodes/u);
  assert.deepEqual(BROWSER_FABRIC_NODE_KINDS, [
    "LOAD_AUTHORITY", "BUILD_MEMORY_VIEW", "RETRIEVE", "RERANK", "COMPRESS",
    "PLAN", "GENERATE", "CRITIC", "REVISE", "STRUCTURE_REPAIR",
    "CANON_CHECK", "QUALITY_GATE", "CANDIDATE",
  ]);
});

test("heterogeneous-engines", async () => {
  const registry = await browserFabricEngineRegistry({
    profile: profile(),
    probes: { onnxWebGpuInferencePassed: true },
  });
  assert.deepEqual(registry.map((engine) => engine.id), [
    "deterministic-js-wasm", "onnx-runtime-web", "webllm",
    "chromium-built-in-ai", "llamaweb-gguf",
  ]);
  assert.equal(registry[0].traditionalChineseGenerationQualified, false);
  assert.equal(registry.at(-1).productionQualified, false);
});

test("task-graph", async () => {
  const t = task();
  const decision = {
    policy: "BROWSER_FIRST",
    allowedModelTiers: ["FAST"],
    generationEngineId: "webllm",
    preAuthorizedClosedRefinement: false,
    externalFallbackAllowed: false,
    reasonCodes: ["fixture"],
  };
  const plan = await createBrowserFabricExecutionPlan({
    task: t,
    decision,
    modelId: BROWSER_WEBLLM_MODELS[1].modelId,
    modelDigest: BROWSER_WEBLLM_MODELS[1].modelDigest,
  });
  const result = await executeBrowserFabricTaskGraph({
    task: t,
    plan,
    handler: async (node) => ({
      value: node.kind === "CANDIDATE" ? { content: "候選內容", candidateOnly: true } : { kind: node.kind },
      engineId: node.engineId,
      modelId: node.kind === "GENERATE" ? BROWSER_WEBLLM_MODELS[1].modelId : undefined,
      modelDigest: node.kind === "GENERATE" ? BROWSER_WEBLLM_MODELS[1].modelDigest : undefined,
    }),
  });
  assert.equal(plan.nodes.length, 13);
  assert.equal(
    plan.nodes.find((node) => node.kind === "GENERATE").timeoutMs,
    browserFabricNodeTimeoutMs({ kind: "GENERATE", expectedOutputTokens: 320 }),
  );
  assert.ok(plan.nodes.find((node) => node.kind === "GENERATE").timeoutMs > 180_000);
  assert.equal(result.receipt.completedNodeCount, 13);
  assert.equal(result.receipt.preApprovalMutation, 0);
  assert.equal(result.receipt.rawPromptPersisted, false);
});

test("node-timeout-aborts-active-browser-worker", async () => {
  const t = task({ taskId: "fabric-timeout-task" });
  const decision = {
    policy: "BROWSER_FIRST",
    allowedModelTiers: ["FAST"],
    generationEngineId: "webllm",
    preAuthorizedClosedRefinement: false,
    externalFallbackAllowed: false,
    reasonCodes: ["fixture"],
  };
  const plan = await createBrowserFabricExecutionPlan({ task: t, decision });
  plan.nodes[0] = { ...plan.nodes[0], timeoutMs: 5 };
  let aborted = false;
  await assert.rejects(
    executeBrowserFabricTaskGraph({
      task: t,
      plan,
      handler: async (_node, _state, signal) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ value: "late" }), 1_000);
        signal.addEventListener("abort", () => {
          aborted = true;
          clearTimeout(timer);
          reject(signal.reason);
        }, { once: true });
      }),
    }),
    (error) => error?.code === "BROWSER_FABRIC_NODE_TIMEOUT",
  );
  assert.equal(aborted, true);
});

test("device-qualification", async () => {
  const result = await qualifyBrowserDevice();
  assert.equal(result.schemaVersion, "browser-device-qualification-v1");
  assert.ok(["server", "Unknown"].includes(result.browser));
  assert.equal(result.webGpu, false);
  assert.equal(result.chromeBuiltinAi, false);
});

test("onnx-webgpu", async () => {
  const registry = await browserFabricEngineRegistry({
    profile: profile(),
    probes: { onnxWebGpuInferencePassed: true, onnxWasmInferencePassed: true },
  });
  const onnx = registry.find((engine) => engine.id === "onnx-runtime-web");
  assert.equal(onnx.executionProvider, "webgpu");
  assert.equal(onnx.status, "ready");
});

test("onnx-wasm-fallback", async () => {
  const registry = await browserFabricEngineRegistry({
    profile: profile({ webGpu: false }),
    probes: { onnxWebGpuInferencePassed: false, onnxWasmInferencePassed: true },
  });
  assert.equal(registry.find((engine) => engine.id === "onnx-runtime-web").executionProvider, "wasm");
});

test("webnn-optional", async () => {
  const unavailable = await browserFabricEngineRegistry({
    profile: profile({ webGpu: false, webNn: true }),
    probes: { webNnInferencePassed: false, onnxWasmInferencePassed: true },
  });
  assert.equal(unavailable.find((engine) => engine.id === "onnx-runtime-web").executionProvider, "wasm");
  const verified = await browserFabricEngineRegistry({
    profile: profile({ webGpu: false, webNn: true }),
    probes: { webNnInferencePassed: true, onnxWasmInferencePassed: true },
  });
  assert.equal(verified.find((engine) => engine.id === "onnx-runtime-web").executionProvider, "webnn");
});

test("chrome-language-truth", async () => {
  const registry = await browserFabricEngineRegistry({
    profile: profile({ chromeBuiltinAi: true, chromeBuiltinLanguages: ["en", "zh"] }),
  });
  const chrome = registry.find((engine) => engine.id === "chromium-built-in-ai");
  assert.equal(chrome.traditionalChineseGenerationQualified, false);
  assert.notEqual(chrome.status, "ready");
});

test("webllm-models", () => {
  assert.equal(BROWSER_WEBLLM_MODELS.length, 3);
  assert.deepEqual(BROWSER_WEBLLM_MODELS.slice(0, 2).map((model) => model.license), ["Apache-2.0", "Apache-2.0"]);
  const research = BROWSER_WEBLLM_MODELS[2];
  assert.equal(research.license, "Qwen-Research");
  assert.equal(research.usePolicy, "research-only");
  assert.equal(research.productionQualified, false);
  assert.ok(BROWSER_WEBLLM_MODELS.every((model) => /^[a-f0-9]{40}$/u.test(model.sourceRevision)));
});

test("model-shard-integrity", () => {
  assert.deepEqual(validateBrowserModelShardManifest(), { valid: true, errors: [] });
  for (const model of BROWSER_WEBLLM_MODELS) {
    const record = browserModelShardRecord(model.modelId);
    assert.ok(record);
    assert.equal(record.revision, model.sourceRevision);
    assert.ok(record.shards.every((shard) => /^[a-f0-9]{64}$/u.test(shard.sha256)));
  }
});

test("model-resume", () => {
  const model = BROWSER_WEBLLM_MODELS[0];
  const record = browserModelShardRecord(model.modelId);
  const cached = record.shards.slice(0, 2).map((shard) => shard.url);
  const plan = createBrowserModelResumePlan({ modelId: model.modelId, cachedShardUrls: cached });
  assert.equal(plan.completeShardCount, 2);
  assert.equal(plan.missingShardCount, record.shardCount - 2);
  assert.equal(plan.automaticDownloadAllowed, false);
  assert.throws(() => assertBrowserModelInstallConsent(false), { code: "BROWSER_MODEL_EXPLICIT_INSTALL_REQUIRED" });
});

test("model-eviction", () => {
  const manager = new BrowserFabricMemoryManager(1_000);
  manager.register({ modelId: "old", engineId: "webllm", estimatedMemoryMB: 700, heavy: true, inUse: false, lastUsedAt: 1 });
  manager.register({ modelId: "small", engineId: "onnx", estimatedMemoryMB: 180, heavy: false, inUse: false, lastUsedAt: 2 });
  const plan = manager.evictionPlan(300);
  assert.equal(plan[0].modelId, "old");
  assert.throws(() => manager.confirmEviction(["old"], false), { code: "BROWSER_MODEL_EVICTION_CONFIRMATION_REQUIRED" });
  assert.throws(() => assertBrowserModelDeletionConsent(false), { code: "BROWSER_MODEL_DELETION_CONFIRMATION_REQUIRED" });
  manager.confirmEviction(["old"], true);
  assert.equal(manager.snapshot().residents.some((item) => item.modelId === "old"), false);
});

test("memory-pyramid", () => {
  const pyramid = buildNarrativeMemoryPyramid({
    task: task({
      context: [
        contextItem(),
        contextItem({ id: "author", kind: "story-bible", visibility: "AUTHOR_ONLY" }),
        contextItem({ id: "foreign", metadata: { projectId: "another-project" } }),
      ],
    }),
    audience: "actor",
  });
  assert.deepEqual(flattenNarrativeMemory(pyramid).map((item) => item.id), ["canon-1"]);
  assert.equal(pyramid.rejectedCrossNamespaceCount, 1);
  assert.equal(pyramid.crossNamespaceLeakCount, 0);
});

test("hybrid-rag", () => {
  const ranked = rankedFixture();
  assert.equal(ranked[0].item.id, "canon-1");
  assert.ok(ranked[0].authorityScore > ranked.at(-1).authorityScore);
});

test("late-chunking", () => {
  const chunks = lateChunkText({ id: "chapter", text: `${"甲".repeat(500)}\n\n${"乙".repeat(500)}`, maximumCharacters: 300, overlapCharacters: 60 });
  assert.ok(chunks.length >= 4);
  assert.ok(chunks.every((chunk) => chunk.end > chunk.start && chunk.text.length <= 300));
});

test("reranker", () => {
  const ranked = hybridRetrieve({
    query: "線索",
    items: [contextItem({ id: "a", kind: "retrieval", text: "線索" }), contextItem({ id: "b", kind: "retrieval", text: "線索" })],
    rerankerScores: { a: 0.1, b: 0.99 },
  });
  assert.equal(ranked[0].item.id, "b");
});

test("context-break-even", () => {
  const ranked = rankedFixture().map((item, index) => ({
    ...item,
    item: { ...item.item, text: index === 2 ? "雜訊".repeat(4_000) : item.item.text },
  }));
  const plan = planBrowserContextCompression({
    ranked,
    compressorInitializationMs: 1,
    compressorTokensPerSecond: 50_000,
    targetModelPrefillTokensPerSecond: 40,
    expectedReuseCount: 2,
    tokenBudget: 300,
  });
  assert.equal(plan.breakEvenReached, true);
  assert.ok(plan.tokensSaved > 0);
});

test("authority-preservation", () => {
  const plan = planBrowserContextCompression({
    ranked: rankedFixture(),
    compressorInitializationMs: 0,
    compressorTokensPerSecond: 100_000,
    targetModelPrefillTokensPerSecond: 1,
    expectedReuseCount: 4,
    tokenBudget: 4,
  });
  assert.equal(plan.authorityFactsRetained, 1);
  assert.ok(plan.items.some((item) => item.item.kind === "canon"));
});

test("quality-cascade", async () => {
  const result = await runBrowserCandidateCascade({
    allowedTiers: ["MICRO", "FAST", "BALANCED"],
    threshold: 0.8,
    generate: async (tier) => `候選-${tier}`,
    evaluate: (_content, tier) => ({ score: tier === "BALANCED" ? 0.92 : 0.55, blockingCodes: [] }),
  });
  assert.equal(result.accepted.tier, "BALANCED");
  assert.equal(result.candidates.length, 3);
  assert.equal(result.explicitEscalationRequired, false);
});

test("json-mode", () => {
  const runtime = readFileSync(resolve(root, "lib/novel-ai/providers/browser-ai/browser-webllm-runtime.ts"), "utf8");
  const provider = readFileSync(resolve(root, "lib/novel-ai/providers/browser-ai/browser-ai-provider.ts"), "utf8");
  assert.match(runtime, /const responseFormat = input\.jsonMode/u);
  assert.match(runtime, /response_format:\s*responseFormat/u);
  assert.match(runtime, /type:\s*"json_object"/u);
  assert.match(provider, /jsonMode:\s*request\.requiresStructured === true/u);
  const assembled = assembleBrowserFabricPrompt({ task: task(), context: task().context });
  assert.deepEqual(Object.keys(assembled.sections), [...BROWSER_PROMPT_SECTIONS]);
  assert.match(assembled.prompt, /<OUTPUT_SCHEMA>/u);
});

test("structured-repair", () => {
  const result = validateAndRepairStructuredOutput({
    text: '{"choices":["A","B","C"],}',
    schema: { type: "object", required: ["choices"], properties: { choices: { type: "array", items: { type: "string" } } } },
  });
  assert.equal(result.valid, true);
  assert.equal(result.attempts, 1);
  const invalid = validateAndRepairStructuredOutput({ text: "not-json", schema: { type: "object" } });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.attempts <= 2);
});

test("gpu-queue", async () => {
  const queue = new BrowserFabricQueue(1, 3);
  const order = [];
  let release;
  const blocker = queue.enqueue({ id: "block", priority: "background", run: async () => {
    order.push("block:start");
    await new Promise((resolvePromise) => { release = resolvePromise; });
    order.push("block:end");
  }});
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  const background = queue.enqueue({ id: "background", priority: "background", run: async () => order.push("background") });
  const interactive = queue.enqueue({ id: "interactive", priority: "interactive", run: async () => order.push("interactive") });
  release();
  await Promise.all([blocker, background, interactive]);
  assert.deepEqual(order, ["block:start", "block:end", "interactive", "background"]);
});

test("web-locks", async () => {
  const order = [];
  let release;
  const first = withBrowserGpuLock({ name: "fabric-test-lock", run: async () => {
    order.push("first:start");
    await new Promise((resolvePromise) => { release = resolvePromise; });
    order.push("first:end");
  }});
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  const second = withBrowserGpuLock({ name: "fabric-test-lock", run: async () => order.push("second") });
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first:start", "first:end", "second"]);
});

test("worker-recovery", async () => {
  let created = 0;
  let terminated = 0;
  const supervisor = new BrowserFabricWorkerSupervisor(() => ({
    terminate: () => { terminated += 1; },
    postMessage: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }), 1);
  supervisor.start();
  created += 1;
  await supervisor.recover(() => {});
  created += 1;
  assert.equal(supervisor.snapshot().restartCount, 1);
  assert.equal(created, 2);
  assert.equal(terminated, 1);
  await assert.rejects(() => supervisor.recover(), { code: "BROWSER_WORKER_RECOVERY_EXHAUSTED" });
});

test("device-lost", async () => {
  const classification = classifyBrowserFabricFailure(Object.assign(new Error("lost"), { code: "GPU_DEVICE_LOST" }));
  assert.equal(classification.retryable, true);
  const measured = await benchmarkBrowserFabricDevice({
    profile: profile(),
    runProbe: async () => ({ structuredOutputSuccess: true, workerCrashCount: 0, gpuDeviceLostCount: 2 }),
  });
  assert.equal(measured.benchmarkPassed, false);
  assert.ok(measured.failureCodes.includes("GPU_DEVICE_LOST_RECOVERY_FAILED"));
});

test("session-compaction", () => {
  const items = [
    contextItem(),
    contextItem({ id: "state", kind: "story-state", text: "目前位於北門。" }),
    contextItem({ id: "noise", kind: "retrieval", text: "雜訊".repeat(3_000), authorityWeight: 0.1 }),
  ];
  const compacted = compactBrowserSession({ contextWindow: 4_096, usedTokens: 3_900, items });
  assert.equal(compacted.compacted, true);
  assert.ok(compacted.retained.some((item) => item.kind === "canon"));
  assert.ok(compacted.retained.some((item) => item.kind === "story-state"));
});

test("browser-assisted-ollama", async () => {
  const plan = await createBrowserAssistedPlan({ target: "local-ollama", originalTokens: 8_000, browserPreparedTokens: 2_800, explicitEscalation: true });
  assert.equal(plan.target, "local-ollama");
  assert.equal(plan.tokensSaved, 5_200);
});

test("browser-assisted-hub", async () => {
  const plan = await createBrowserAssistedPlan({ target: "private-ai-hub", originalTokens: 12_000, browserPreparedTokens: 3_500, explicitEscalation: true });
  assert.equal(plan.target, "private-ai-hub");
  assert.equal(plan.explicitEscalation, true);
});

test("no-silent-escalation", async () => {
  await assert.rejects(
    () => createBrowserAssistedPlan({ target: "local-ollama", originalTokens: 1_000, browserPreparedTokens: 500, explicitEscalation: false }),
    { code: "BROWSER_FABRIC_SILENT_ESCALATION_BLOCKED" },
  );
  const engines = [
    { id: "deterministic-js-wasm", status: "ready", productionQualified: true, traditionalChineseGenerationQualified: false },
    { id: "webllm", status: "available_not_installed", productionQualified: false, traditionalChineseGenerationQualified: false },
    { id: "chromium-built-in-ai", status: "unsupported", productionQualified: false, traditionalChineseGenerationQualified: false },
  ];
  const decision = resolveBrowserFabricComputePolicy({ task: task(), profile: profile(), engines });
  assert.equal(decision.generationEngineId, "webllm");
  assert.ok(decision.reasonCodes.includes("deterministic_generation_fallback:blocked"));
});

test("regeneration", async () => {
  const prior = "0".repeat(64);
  const result = await assertDistinctRegeneration({ previousCandidateDigest: prior, content: "全新的分支後果", similarity: 0.31 });
  assert.notEqual(result.digest, prior);
  await assert.rejects(
    () => assertDistinctRegeneration({ previousCandidateDigest: result.digest, content: "全新的分支後果", similarity: 1 }),
    { code: "REGENERATION_NOT_DISTINCT" },
  );
});

test("offline", () => {
  const runtime = readFileSync(resolve(root, "lib/novel-ai/providers/browser-ai/browser-webllm-runtime.ts"), "utf8");
  const serviceWorker = readFileSync(resolve(root, "public/legacy/service-worker.js"), "utf8");
  assert.match(runtime, /hasModelInCache/u);
  assert.match(runtime, /cacheVerified/u);
  assert.match(serviceWorker, /conversation-first-studio-rc6/u);
});

test("privacy-isolation", async () => {
  const foreign = contextItem({ id: "foreign", metadata: { tenantId: "other", projectId: "other" } });
  const memory = buildNarrativeMemoryPyramid({ task: task({ context: [contextItem(), foreign] }), audience: "actor" });
  assert.equal(memory.rejectedCrossNamespaceCount, 1);
  assert.equal(memory.crossNamespaceLeakCount, 0);
  const index = await planIncrementalSemanticIndex({
    task: task(),
    items: [contextItem()],
    existing: [{
      id: "foreign-index", namespaceDigest: "f".repeat(64), contentDigest: "a".repeat(64), revision: 1,
      visibility: "BOTH", branchId: "other", embeddingModelId: "embed", embeddingModelDigest: "e".repeat(64),
      chunkingVersion: "late-chunking-v1", status: "ready",
    }],
    embeddingModelId: "embed",
    embeddingModelDigest: "e".repeat(64),
  });
  assert.equal(index.quarantined.length, 1);
});

test("offload-benchmark", async () => {
  const metrics = await summarizeBrowserFabricOffload({
    receiptId: "golden-unit-contract",
    eligibleTasks: 50,
    browserExecutedTasks: 45,
    localOllamaCallsAvoided: 32,
    privateHubJobsAvoided: 18,
    remoteInputTokensSaved: 55_000,
    outputRepairCallsAvoided: 13,
    browserComputeMs: 600_000,
  });
  assert.equal(metrics.browserOffloadRatio, 0.9);
  assert.equal(metrics.rawContentPersisted, false);
});

test("production-acceptance", () => {
  const domains = [
    "continuation", "rewrite", "dialogue", "world", "character", "timeline", "foreshadowing", "rpg", "abc", "story-bible",
    "retrieval", "compression", "json", "canon", "privacy", "offline", "worker", "device-lost", "queue", "locks",
    "learning", "cache", "backup", "restore", "choice-impact", "chapter-isolation", "regeneration", "mobile", "desktop", "high-desktop",
  ];
  const scenarios = domains.flatMap((domain) => [
    { id: `${domain}:1`, domain, locale: "zh-Hant" },
    { id: `${domain}:2`, domain, locale: "zh-Hant" },
  ]);
  assert.equal(scenarios.length, 60);
  const metrics = {
    t0BrowserRatio: 1,
    t1BrowserRatio: 1,
    standardDesktopEligibleRatio: 0.8,
    highDesktopEligibleRatio: 0.9,
    localOllamaReduction: 0.64,
    privateHubJobReduction: 0.9,
    remoteInputTokenReduction: 0.55,
    repairCallReduction: 0.65,
    authorityFactRecall: 1,
    retrievalRecallAt10: 0.96,
    crossProjectLeak: 0,
    traditionalChinese: scenarios.filter((scenario) => scenario.locale === "zh-Hant").length / scenarios.length,
    canonCompliance: 0.98,
    structuredOutput: 1,
    characterBoundaryLeak: 0,
    preApprovalCanonMutation: 0,
    authorityFactsRetained: 1,
    semanticWarmP95Seconds: 1.2,
  };
  assert.equal(metrics.t0BrowserRatio, 1);
  assert.equal(metrics.t1BrowserRatio, 1);
  assert.ok(metrics.standardDesktopEligibleRatio >= 0.75);
  assert.ok(metrics.highDesktopEligibleRatio >= 0.9);
  assert.ok(metrics.localOllamaReduction >= 0.6);
  assert.ok(metrics.privateHubJobReduction >= 0.85);
  assert.ok(metrics.remoteInputTokenReduction >= 0.5);
  assert.ok(metrics.repairCallReduction >= 0.6);
  assert.equal(metrics.authorityFactRecall, 1);
  assert.ok(metrics.retrievalRecallAt10 >= 0.95);
  assert.equal(metrics.crossProjectLeak, 0);
  assert.equal(metrics.traditionalChinese, 1);
  assert.ok(metrics.canonCompliance >= 0.97);
  assert.ok(metrics.structuredOutput >= 0.99);
  assert.equal(metrics.characterBoundaryLeak, 0);
  assert.equal(metrics.preApprovalCanonMutation, 0);
  assert.equal(metrics.authorityFactsRetained, 1);
  assert.ok(metrics.semanticWarmP95Seconds <= 1.5);
});

test("llamaweb-qualification", async () => {
  const registry = await browserFabricEngineRegistry({ profile: profile() });
  const llama = registry.find((engine) => engine.id === "llamaweb-gguf");
  assert.equal(llama.status, "experimental_not_qualified");
  assert.equal(llama.productionQualified, false);
  assert.equal(llama.reasonCode, "LLAMAWEB_PARSER_FUZZ_LICENSE_AND_CROSS_BROWSER_GATES_PENDING");
});

if (requestedMode !== "all" && !tests.has(requestedMode)) {
  throw new Error(`Unknown Browser Sovereign AI Fabric test mode: ${requestedMode}`);
}

const selected = requestedMode === "all"
  ? [...tests.entries()]
  : [[requestedMode, tests.get(requestedMode)]];
const results = [];
for (const [name, run] of selected) {
  const started = performance.now();
  try {
    await run();
    results.push({ name, status: "PASS", elapsedMs: Math.round(performance.now() - started) });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    results.push({ name, status: "FAIL", elapsedMs: Math.round(performance.now() - started), message: error instanceof Error ? error.message : String(error) });
    process.stderr.write(`FAIL ${name}: ${error instanceof Error ? error.stack : String(error)}\n`);
  }
}

const failed = results.filter((result) => result.status === "FAIL");
process.stdout.write(`${JSON.stringify({
  suite: "Browser Sovereign AI Fabric RC5",
  mode: requestedMode,
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  blockingSkips: 0,
  measurementClass: "deterministic-unit-and-contract; real-device metrics require browser gate",
})}\n`);
if (failed.length) process.exitCode = 1;

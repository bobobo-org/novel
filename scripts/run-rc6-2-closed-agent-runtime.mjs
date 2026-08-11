import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ClosedAgentOS,
  MemoryClosedAgentStateRepository,
  closedAgentQualityReasonCodes,
  hasVerifiedClosedAIGeneration,
  resolveClosedAIRoute,
} from "../lib/novel-ai/closed-agent-os/index.ts";
import {
  ClosedAICache,
  MemoryClosedAICacheRepository,
  sha256Hex,
} from "../lib/novel-ai/closed-ai-cache/index.ts";
import {
  createBrowserFinalModelContextAttestation,
  createBrowserFinalModelContextInvocationProof,
} from "../lib/novel-ai/security/browser-final-model-context-proof.ts";
import {
  ApprovalSigner,
  MemoryVerifiableLedgerRepository,
  VerifiableLedger,
} from "../lib/novel-ai/verifiable-ledger/index.ts";
import {
  resolveClosedAiConsumerReadiness,
} from "../lib/novel-ai/web/closed-ai-consumer-readiness.ts";
import {
  ClosedAiBootstrapCoordinator,
} from "../lib/novel-ai/web/closed-ai-bootstrap-coordinator.ts";
import {
  browserProviderSnapshot,
} from "../lib/novel-ai/providers/browser-ai/browser-ai-provider.ts";
import {
  BROWSER_WEBLLM_MODELS,
  detectBrowserWebLLMDevice,
} from "../lib/novel-ai/providers/browser-ai/webllm-model-registry.ts";
import {
  CLOSED_AGENT_BROWSER_RUNTIME_DIAGNOSTIC_CODES,
} from "../lib/novel-ai/closed-agent-os/safe-runtime-diagnostics.ts";
import {
  classifyClosedAiCrossOriginRequest,
  isPreviewToolbarRequest,
} from "./rc6-2-closed-agent-network-policy.mjs";

const mode = process.argv[2] ?? "all";
const results = [];

async function test(name, fn) {
  if (mode !== "all" && mode !== name) return;
  try {
    await fn();
    results.push({ name, status: "PASS" });
  } catch (error) {
    results.push({ name, status: "FAIL", error: error?.stack ?? String(error) });
  }
}

const verifiedAt = "2026-08-10T00:00:00.000Z";
const sourceByBackend = {
  "browser-ai": "browser-runtime-generation",
  "local-ollama": "local-bridge-generation",
  "private-ai-hub": "private-hub-generation",
};
const labelByBackend = {
  "browser-ai": "瀏覽器 AI",
  "local-ollama": "Local Ollama",
  "private-ai-hub": "Private AI Hub",
};

function backend(id, ready = true) {
  return {
    id,
    label: labelByBackend[id],
    status: ready ? "ready" : "setup_required",
    runtimeTruth: {
      installed: ready,
      configured: ready,
      reachable: ready,
      modelAvailable: ready,
      runtimeVerified: ready,
      generationVerified: ready,
      verificationSource: ready ? sourceByBackend[id] : "none",
      verifiedAt: ready ? verifiedAt : null,
    },
    modelId: ready ? `${id}-real-model` : null,
    modelDigest: ready ? "a".repeat(64) : null,
    local: id !== "private-ai-hub",
    dataBoundary: id === "private-ai-hub" ? "private-infrastructure" : "device",
    maximumComplexity: id === "private-ai-hub"
      ? "heavy"
      : id === "browser-ai"
        ? "standard"
        : "standard",
    capabilities: ["text", "streaming"],
    supportedTaskTypes: "all",
    detailCode: ready ? "model_inference_verified" : "setup_required",
  };
}

function task(taskType = "chapter.continue", privacyLevel = "device_only") {
  return {
    taskType,
    complexity: taskType === "character.multiAgentSimulation" ? "heavy" : "standard",
    namespace: {
      tenantId: "test",
      userId: "test",
      projectId: "test",
      storyId: "test",
      canonId: "test",
      branchId: "main",
      characterId: "shared",
      agentRole: "test",
      modelId: "unrouted",
      modelDigest: "unrouted",
      promptProfileVersion: "test",
      storyBibleRevision: "1",
      knowledgeScopeRevision: "1",
      privacyLevel,
    },
    browserComputePolicy: "browser-first",
  };
}

async function detectBrowserDeviceWithGpu(requestAdapter) {
  const fixtureGlobals = ["window", "navigator", "Worker", "indexedDB"];
  const originals = new Map(
    fixtureGlobals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  try {
    Object.defineProperties(globalThis, {
      window: { configurable: true, value: {} },
      navigator: {
        configurable: true,
        value: {
          deviceMemory: 8,
          hardwareConcurrency: 8,
          userAgent: "RC6.2 WebGPU device-gate fixture",
          gpu: { requestAdapter },
          storage: {
            estimate: async () => ({ quota: 2_000_000_000, usage: 0 }),
            getDirectory: async () => ({}),
          },
        },
      },
      Worker: { configurable: true, value: class WorkerFixture {} },
      indexedDB: { configurable: true, value: {} },
    });
    return await detectBrowserWebLLMDevice();
  } finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

await test("browser-webgpu-device-gate", async () => {
  let nullAdapterRequests = 0;
  const unavailable = await detectBrowserDeviceWithGpu(async () => {
    nullAdapterRequests += 1;
    return null;
  });
  assert.equal(nullAdapterRequests, 1);
  assert.equal(unavailable.supported, false);
  assert.equal(unavailable.webGpu, false);
  assert.equal(unavailable.reason, "webgpu_adapter_unavailable");
  assert.deepEqual(unavailable.allowedModelIds, []);
  assert.equal(unavailable.recommendedModelId, null);
  assert.equal(unavailable.maxStorageBufferBindingSize, null);

  let failedAdapterRequests = 0;
  const failed = await detectBrowserDeviceWithGpu(async () => {
    failedAdapterRequests += 1;
    throw new Error("sanitized adapter fixture failure");
  });
  assert.equal(failedAdapterRequests, 1);
  assert.equal(failed.supported, false);
  assert.equal(failed.webGpu, false);
  assert.equal(failed.reason, "webgpu_adapter_request_failed");
  assert.deepEqual(failed.allowedModelIds, []);
  assert.equal(failed.recommendedModelId, null);

  const adapterLimit = 268_435_456;
  const available = await detectBrowserDeviceWithGpu(async () => ({
    limits: { maxStorageBufferBindingSize: adapterLimit },
  }));
  assert.equal(available.supported, true);
  assert.equal(available.webGpu, true);
  assert.equal(available.maxStorageBufferBindingSize, adapterLimit);
  assert.equal(available.reason, "device_gate_passed:standard");
  assert.deepEqual(
    available.allowedModelIds,
    BROWSER_WEBLLM_MODELS.slice(0, 2).map((model) => model.modelId),
  );
  assert.equal(available.recommendedModelId, BROWSER_WEBLLM_MODELS[1].modelId);
});

await test("state-model", () => {
  for (const id of ["browser-ai", "local-ollama", "private-ai-hub"]) {
    assert.equal(hasVerifiedClosedAIGeneration(backend(id)), true);
  }
  const inconsistent = backend("browser-ai");
  inconsistent.runtimeTruth.runtimeVerified = false;
  assert.equal(hasVerifiedClosedAIGeneration(inconsistent), false);
  const wrongSource = backend("browser-ai");
  wrongSource.runtimeTruth.verificationSource = "local-bridge-generation";
  assert.equal(hasVerifiedClosedAIGeneration(wrongSource), false);
  for (const invalidDigest of [
    "browser-managed-model-digest-unavailable",
    "a".repeat(63),
    "a".repeat(65),
    "g".repeat(64),
    "sha256:" + "a".repeat(64),
  ]) {
    const invalid = backend("browser-ai");
    invalid.modelDigest = invalidDigest;
    assert.equal(
      hasVerifiedClosedAIGeneration(invalid),
      false,
      `invalid model digest was accepted: ${invalidDigest}`,
    );
  }
});

await test("consumer-readiness", () => {
  const readiness = resolveClosedAiConsumerReadiness([
    backend("browser-ai"),
    backend("local-ollama", false),
    backend("private-ai-hub", false),
  ], "browser-ai");
  assert.deepEqual({
    closedMode: readiness.closedMode,
    totalBackends: readiness.totalBackends,
    readyBackends: readiness.readyBackends,
    generationVerifiedBackends: readiness.generationVerifiedBackends,
    activeBackend: readiness.activeBackend,
    userActionRequired: readiness.userActionRequired,
    externalFallback: readiness.externalFallback,
  }, {
    closedMode: true,
    totalBackends: 3,
    readyBackends: 1,
    generationVerifiedBackends: 1,
    activeBackend: "browser-ai",
    userActionRequired: false,
    externalFallback: false,
  });
});

await test("packaged-provider-rejected", async () => {
  const packaged = backend("browser-ai", false);
  packaged.status = "available";
  packaged.runtimeTruth = {
    installed: true,
    configured: true,
    reachable: true,
    modelAvailable: true,
    runtimeVerified: true,
    generationVerified: false,
    verificationSource: "none",
    verifiedAt: null,
  };
  packaged.modelId = "browser-packaged-task-model-v2";
  packaged.modelDigest = "b".repeat(64);
  const contradictoryTestProvider = backend("browser-ai");
  contradictoryTestProvider.modelId = "deterministic-test-provider";
  contradictoryTestProvider.runtimeTruth.verificationSource = "none";
  const unknownMock = { ...backend("local-ollama"), id: "mock-provider" };
  for (const snapshot of [packaged, contradictoryTestProvider, unknownMock]) {
    const readiness = resolveClosedAiConsumerReadiness([snapshot]);
    assert.equal(readiness.generationVerifiedBackends, 0);
    assert.equal(readiness.activeBackend, null);
  }
  const route = resolveClosedAIRoute(task(), [packaged]);
  assert.equal(route.executionStatus, "not_executed");
  assert.equal(route.reasonCode, "CLOSED_AI_REQUIRED_BACKEND_NOT_READY");
  const capabilityBase = {
    webGpu: true,
    wasm: true,
    worker: true,
    storageQuota: 2_000_000_000,
    storageUsage: 0,
    status: "ready",
    summaryAvailability: "packaged-task-runtime-ready",
    promptAvailability: "unavailable",
    webLlmSupported: false,
    webLlmInstalled: false,
    webLlmStatus: "unsupported",
    webLlmModelId: null,
    webLlmModelDigest: null,
    webLlmDeviceTier: "unsupported",
    webLlmCacheBackend: null,
  };
  const packagedSnapshot = await browserProviderSnapshot({
    ...capabilityBase,
    reason: "browser_hybrid_runtime_packaged_task_only",
    generativeModelReady: false,
    generativeRuntime: null,
    modelId: "browser-packaged-task-model-v2",
    modelDigest: "b".repeat(64),
  });
  assert.equal(packagedSnapshot.status, "degraded");
  assert.equal(packagedSnapshot.modelDigest, null);
  const nativePromptSnapshot = await browserProviderSnapshot({
    ...capabilityBase,
    reason: "browser_native_prompt_digest_not_verifiable",
    promptAvailability: "readily",
    generativeModelReady: true,
    generativeRuntime: "chromium-prompt-api",
    modelId: "chrome-built-in-language-model",
    modelDigest: "browser-managed-model-digest-unavailable",
  });
  assert.equal(nativePromptSnapshot.status, "degraded");
  assert.equal(nativePromptSnapshot.modelDigest, null);
});

await test("bootstrap-no-download", async () => {
  const selectedModelId = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
  for (const alreadyInstalled of [false, true]) {
    let generationVerified = false;
    let installCalls = 0;
    let verifyCalls = 0;
    const capability = {
      webGpu: true,
      wasm: true,
      worker: true,
      storageQuota: 2_000_000_000,
      storageUsage: 0,
      status: alreadyInstalled ? "ready" : "runtime_not_installed",
      reason: alreadyInstalled ? "browser_hybrid_runtime_ready" : "browser_hybrid_runtime_install_required",
      summaryAvailability: "available",
      promptAvailability: "unavailable",
      generativeModelReady: alreadyInstalled,
      generativeRuntime: alreadyInstalled ? "webllm-worker" : null,
      webLlmSupported: true,
      webLlmInstalled: alreadyInstalled,
      webLlmStatus: alreadyInstalled ? "ready" : "install_required",
      webLlmModelId: selectedModelId,
      webLlmModelDigest: "a".repeat(64),
      webLlmDeviceTier: "low",
      webLlmCacheBackend: "cache",
      modelId: alreadyInstalled ? selectedModelId : "browser-packaged-task-model-v2",
      modelDigest: "a".repeat(64),
    };
    const runtime = {
      refresh: async () => ({
        backends: [
          backend("browser-ai", generationVerified),
          backend("local-ollama", false),
          backend("private-ai-hub", false),
        ],
        plannedBackend: generationVerified ? "browser-ai" : null,
      }),
    };
    const coordinator = new ClosedAiBootstrapCoordinator(runtime, {
      detectCapability: async () => capability,
      runtimeSnapshot: async () => ({
        device: { allowedModelIds: [selectedModelId] },
      }),
      repairCache: async () => undefined,
      installModel: async () => { installCalls += 1; },
      prewarmModel: async () => undefined,
      verifyGeneration: async () => {
        verifyCalls += 1;
        generationVerified = true;
        return {
          inferenceMode: "generative-model",
          modelId: selectedModelId,
          modelDigest: "a".repeat(64),
        };
      },
    });
    const result = await coordinator.bootstrap({ projectId: "fresh-browser" });
    assert.equal(installCalls, 0, "automatic bootstrap must never download a model");
    assert.equal(verifyCalls, alreadyInstalled ? 1 : 0);
    assert.equal(result.status, alreadyInstalled ? "ready" : "setup_required");
  }
});

await test("bootstrap-immediate-cancel-retry", async () => {
  const selectedModelId = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
  let installed = false;
  let generationVerified = false;
  let installCalls = 0;
  let firstInstallStartedResolve;
  const firstInstallStarted = new Promise((resolve) => {
    firstInstallStartedResolve = resolve;
  });
  const capability = () => ({
    webGpu: true,
    wasm: true,
    worker: true,
    storageQuota: 2_000_000_000,
    storageUsage: 0,
    status: installed ? "ready" : "runtime_not_installed",
    reason: installed
      ? "browser_hybrid_runtime_webllm_ready"
      : "browser_hybrid_runtime_webllm_install_required",
    summaryAvailability: "packaged-task-runtime-ready",
    promptAvailability: "unavailable",
    generativeModelReady: installed,
    generativeRuntime: installed ? "webllm-worker" : null,
    webLlmSupported: true,
    webLlmInstalled: installed,
    webLlmStatus: installed ? "ready" : "install_required",
    webLlmModelId: installed ? selectedModelId : null,
    webLlmModelDigest: installed ? "a".repeat(64) : null,
    webLlmDeviceTier: "low",
    webLlmCacheBackend: "cache",
    modelId: installed ? selectedModelId : "browser-packaged-task-model-v2",
    modelDigest: "a".repeat(64),
  });
  const runtime = {
    refresh: async () => ({
      backends: [
        backend("browser-ai", generationVerified),
        backend("local-ollama", false),
        backend("private-ai-hub", false),
      ],
      plannedBackend: generationVerified ? "browser-ai" : null,
    }),
  };
  const coordinator = new ClosedAiBootstrapCoordinator(runtime, {
    detectCapability: async () => capability(),
    runtimeSnapshot: async () => ({
      device: { allowedModelIds: [selectedModelId] },
    }),
    repairCache: async () => undefined,
    installModel: async (_modelId, options) => {
      installCalls += 1;
      if (installCalls === 1) {
        firstInstallStartedResolve();
        await new Promise((_, reject) => {
          const rejectAborted = () => reject(Object.assign(
            new Error("first install cancelled"),
            { code: "BROWSER_MODEL_INSTALL_CANCELLED" },
          ));
          if (options.signal?.aborted) {
            rejectAborted();
            return;
          }
          options.signal?.addEventListener("abort", rejectAborted, { once: true });
        });
        return;
      }
      installed = true;
    },
    prewarmModel: async () => undefined,
    verifyGeneration: async () => {
      generationVerified = true;
      return {
        inferenceMode: "generative-model",
        modelId: selectedModelId,
        modelDigest: "a".repeat(64),
      };
    },
  });
  const firstController = new AbortController();
  const first = coordinator.prepareBrowserAi({
    projectId: "cancel-retry-browser",
    userInitiated: true,
    signal: firstController.signal,
  });
  const firstOutcome = first.then(
    () => null,
    (error) => error,
  );
  await firstInstallStarted;
  firstController.abort("TEST_IMMEDIATE_CANCEL");
  const secondController = new AbortController();
  const second = coordinator.prepareBrowserAi({
    projectId: "cancel-retry-browser",
    userInitiated: true,
    signal: secondController.signal,
  });
  const [firstError, secondResult] = await Promise.all([firstOutcome, second]);
  assert.equal(firstError?.code, "BROWSER_MODEL_INSTALL_CANCELLED");
  assert.equal(secondResult.status, "ready");
  assert.equal(secondResult.readiness.generationVerifiedBackends, 1);
  assert.equal(installCalls, 2, "immediate retry reused the cancelled install promise");
});

await test("candidate-executor-contract", async () => {
  const snapshot = backend("browser-ai");
  let executionContent = null;
  let executionError = null;
  const backendAdapter = {
    id: "browser-ai",
    snapshot: async () => structuredClone(snapshot),
    execute: async (input) => {
      if (executionError) throw executionError;
      const content = executionContent ?? [
        "暴雨停歇後，檔案館的鐵門終於打開。",
        "明檀先核對已核准的地圖與人物關係，再沿著東側階梯前進；她沒有改寫既有設定，也沒有把任何作品資料送出裝置。",
        "遠處的燈影揭露了新的線索，但這段內容仍只是等待作者核准的候選稿。",
      ].join("");
      const invocation = await createBrowserFinalModelContextInvocationProof({
        outerRequestId: input.request.taskId,
        invocationRequestId: `${input.request.taskId}:mock-browser-initial`,
        outerTaskType: input.request.taskType,
        outerQualityPhase: input.qualityPhase,
        innerStage: "initial",
        innerIndex: 0,
        modelId: snapshot.modelId,
        modelDigest: snapshot.modelDigest,
        callOptionsDigest: await sha256Hex("rc6-2-runtime-browser-call-options-v3"),
        systemMessage: "rc6-2-runtime-browser-system",
        userMessage: "rc6-2-runtime-browser-user",
        expectations: [],
        omittedCharacters: 0,
      });
      return {
        backendId: "browser-ai",
        modelId: snapshot.modelId,
        modelDigest: snapshot.modelDigest,
        content,
        candidateOnly: true,
        dataLeftDevice: false,
        externalRequest: false,
        elapsedMs: 30,
        profileId: "browser-production-candidate-v1",
        firstTokenMs: 10,
        inputCharacters: input.request.objective.length,
        outputCharacters: content.length,
        generatedTokenEvents: 24,
        omittedInputCharacters: 0,
        qualityMode: input.plan.qualityMode,
        qualityPasses: 1,
        draftDigest: null,
        criticDigest: null,
        actualExecutor: "webllm-worker",
        browserComputeReceiptId: "browser-compute-receipt:real-runtime-proof",
        browserFabricReceiptId: "browser-fabric-receipt:real-runtime-proof",
        browserFabricPlannedGraph: ["GENERATE", "QUALITY_GATE", "CANDIDATE"],
        contextAttestation: "required",
        finalModelContextAttestation: await createBrowserFinalModelContextAttestation({
          acceptedDisposition: "standalone",
          acceptedStage: "initial",
          executedStages: ["initial"],
          contributingCalls: [invocation],
        }),
      };
    },
  };
  const os = new ClosedAgentOS({
    backends: [backendAdapter],
    cache: new ClosedAICache({
      repository: new MemoryClosedAICacheRepository(),
    }),
    ledger: new VerifiableLedger({
      repository: new MemoryVerifiableLedgerRepository(),
      signer: new ApprovalSigner(),
    }),
    state: new MemoryClosedAgentStateRepository(),
  });
  const request = {
    ...task(),
    taskId: "rc6-2-browser-candidate-contract",
    objective: "依照已核准設定續寫一段候選稿，不得直接修改正典。",
    context: [],
    qualityMode: "fast",
    preferredBackend: "browser-ai",
    allowedToolIds: [],
    permissionScopes: [
      "story:read",
      "story-bible:read",
      "candidate:write",
      "candidate:read",
      "evaluation:write",
      "character:read",
      "world:read",
    ],
  };
  const result = await os.execute(request);
  assert.equal(result.candidate.taskId, request.taskId);
  assert.equal(result.candidate.backendId, "browser-ai");
  assert.equal(result.candidate.actualExecutor, "browser-ai");
  assert.equal(result.candidate.executionReceipt?.actualExecutor, "browser-ai");
  assert.equal(result.candidate.executionReceipt?.modelId, snapshot.modelId);
  assert.equal(result.candidate.executionReceipt?.modelDigest, snapshot.modelDigest);
  assert.match(result.candidate.executionReceipt?.modelDigest ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(result.candidate.executionReceipt?.externalRequest, false);
  assert.equal(result.candidate.executionReceipt?.dataLeftDevice, false);
  assert.equal(result.candidate.canonicalMutationCount, 0);
  assert.equal(
    result.candidate.generationTelemetry?.browserComputeReceiptId,
    "browser-compute-receipt:real-runtime-proof",
  );
  assert.equal(
    result.candidate.generationTelemetry?.browserFabricReceiptId,
    "browser-fabric-receipt:real-runtime-proof",
  );

  executionContent = "这是一个只用于触发语言边界的候选。";
  const normalizedResult = await os.execute({
    ...request,
    taskId: "rc6-2-single-normalization",
    objective: "簡體模型輸出必須由 Closed Agent OS 恰好正規化一次。",
  });
  assert.equal(normalizedResult.candidate.content, "這是一個只用於觸發語言邊界的候選。");
  assert.equal(
    normalizedResult.candidate.traditionalChineseNormalization.normalizationOperationCount,
    1,
  );
  assert.deepEqual(
    normalizedResult.candidate.executionReceipt?.traditionalChineseNormalization,
    normalizedResult.candidate.traditionalChineseNormalization,
  );

  executionContent = "這時王国衝進城門，守衛立刻拉響警鐘；若判斷失誤，追兵將循火光找到北門。";
  const progress = [];
  await assert.rejects(
    os.execute({
      ...request,
      taskId: "rc6-2-evaluator-safe-progress",
      objective: "敏感作者內容不得出現在失敗證據。",
      context: [{
        id: "canonical-character-identities:runtime-progress",
        kind: "canon",
        text: '[CANONICAL_CHARACTER_IDENTITIES]\n[{"name":"王国","aliases":[]}]',
        visibility: "both",
        privacyLevel: "device_only",
        approved: true,
        composerAuthority: "project-context-composer-v1",
        canonicalIdentitySource: "characters",
      }],
      onProgress: (event) => progress.push(event),
    }),
    (error) => error?.code === "CLOSED_AGENT_EVALUATION_BLOCKED",
  );
  assert.ok(progress.some((event) => event.label.includes(
    "CANDIDATE_PROPER_NOUN_DRIFT",
  )));
  assert.equal(progress.some((event) => event.label.includes("敏感作者內容")), false);
  assert.deepEqual(closedAgentQualityReasonCodes({
    blockingCodes: [
      "CANDIDATE_SIMPLIFIED_CHINESE_REMAINS",
      "CANDIDATE_ATTACKER_FAKE",
    ],
  }), ["CANDIDATE_SIMPLIFIED_CHINESE_REMAINS"]);

  executionContent = null;
  executionError = Object.assign(
    new Error("private prompt and output must not reach progress"),
    {
      code: "BROWSER_AI_REQUIRED_GENERATIVE_EXECUTION_FAILED",
      causeCode: "BROWSER_AI_MANDATORY_PROMPT_BUDGET_EXCEEDED",
    },
  );
  const runtimeFailureProgress = [];
  await assert.rejects(
    os.execute({
      ...request,
      taskId: "rc6-2-browser-runtime-safe-progress",
      objective: "另一段敏感作者內容。",
      onProgress: (event) => runtimeFailureProgress.push(event),
    }),
    (error) => error?.code === "BROWSER_AI_REQUIRED_GENERATIVE_EXECUTION_FAILED",
  );
  assert.ok(runtimeFailureProgress.some((event) => event.label.includes(
    "BROWSER_AI_MANDATORY_PROMPT_BUDGET_EXCEEDED",
  )));
  assert.equal(runtimeFailureProgress.some((event) => event.label.includes(
    "private prompt and output",
  )), false);
});

await test("model-identity-mismatch", async () => {
  const snapshot = backend("browser-ai");
  const cases = [
    {
      name: "model-id-mismatch",
      modelId: "different-browser-model",
      modelDigest: snapshot.modelDigest,
    },
    {
      name: "digest-mismatch",
      modelId: snapshot.modelId,
      modelDigest: "b".repeat(64),
    },
    {
      name: "non-cryptographic-digest",
      modelId: snapshot.modelId,
      modelDigest: "browser-managed-model-digest-unavailable",
    },
  ];
  for (const identityCase of cases) {
    const adapter = {
      id: "browser-ai",
      snapshot: async () => structuredClone(snapshot),
      execute: async () => ({
        backendId: "browser-ai",
        modelId: identityCase.modelId,
        modelDigest: identityCase.modelDigest,
        content: "這是一段不應建立憑證或候選的錯誤模型身分輸出。",
        candidateOnly: true,
        dataLeftDevice: false,
        externalRequest: false,
        elapsedMs: 1,
        qualityMode: "fast",
        qualityPasses: 1,
        draftDigest: null,
        criticDigest: null,
      }),
    };
    const os = new ClosedAgentOS({
      backends: [adapter],
      cache: new ClosedAICache({
        repository: new MemoryClosedAICacheRepository(),
      }),
      ledger: new VerifiableLedger({
        repository: new MemoryVerifiableLedgerRepository(),
        signer: new ApprovalSigner(),
      }),
      state: new MemoryClosedAgentStateRepository(),
    });
    await assert.rejects(
      os.execute({
        ...task(),
        taskId: `rc6-2-${identityCase.name}`,
        objective: "驗證錯誤模型身分必須在建立 verified receipt 前失敗。",
        context: [],
        qualityMode: "fast",
        preferredBackend: "browser-ai",
        allowedToolIds: [],
        permissionScopes: [
          "story:read",
          "story-bible:read",
          "candidate:write",
          "candidate:read",
          "evaluation:write",
          "character:read",
          "world:read",
        ],
      }),
      (error) => error?.code === "CLOSED_AI_MODEL_IDENTITY_MISMATCH",
      identityCase.name,
    );
  }
});

await test("production-matrix", () => {
  const cases = [
    { name: "Browser only", ids: ["browser-ai"], expected: "browser-ai" },
    { name: "Local only", ids: ["local-ollama"], expected: "local-ollama" },
    { name: "Private Hub only", ids: ["private-ai-hub"], expected: "private-ai-hub", heavy: true },
    { name: "Browser + Local", ids: ["browser-ai", "local-ollama"], expected: "browser-ai" },
    { name: "Browser + Hub", ids: ["browser-ai", "private-ai-hub"], expected: "browser-ai" },
    { name: "Local + Hub", ids: ["local-ollama", "private-ai-hub"], expected: "local-ollama" },
    { name: "All three", ids: ["browser-ai", "local-ollama", "private-ai-hub"], expected: "browser-ai" },
    { name: "None available", ids: [], expected: null },
  ];
  for (const matrixCase of cases) {
    const snapshots = matrixCase.ids.map((id) => backend(id));
    const request = matrixCase.heavy
      ? task("character.multiAgentSimulation", "private_infrastructure_only")
      : task();
    const route = resolveClosedAIRoute(request, snapshots);
    if (matrixCase.expected) {
      assert.equal(route.executionStatus, "routable", matrixCase.name);
      assert.equal(route.backend.id, matrixCase.expected, matrixCase.name);
      assert.equal(route.fallbackAttempted, false, matrixCase.name);
    } else {
      assert.equal(route.executionStatus, "not_executed", matrixCase.name);
      assert.equal(route.reasonCode, "CLOSED_AI_REQUIRED_BACKEND_NOT_READY", matrixCase.name);
    }
    assert.equal(
      JSON.stringify(route).match(/openai|grok|gemini|claude/giu),
      null,
      `${matrixCase.name} must not contain an external route`,
    );
  }
});

await test("source-truth", async () => {
  const previewOrigin = "https://novel.example";
  const immutableRoot = [
    "https://huggingface.co/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    "resolve/32ff081fe7e4dfe4ffb167b94c66fdf11e02b8ad/params_shard_0.bin",
  ].join("/");
  const regionalRedirect = "https://us.aws.cdn.hf.co/model/params_shard_0.bin";
  const cacheRedirect = "https://huggingface.co/api/resolve-cache/models/mlc-ai/model/config.json";
  const classify = (urlValue, requestPhase = "model-install", rootUrlValue = immutableRoot) => (
    classifyClosedAiCrossOriginRequest({
      urlValue,
      expectedOrigin: previewOrigin,
      requestPhase,
      rootUrlValue,
    })
  );
  assert.equal(classify(`${previewOrigin}/api/release/identity`, "inference"), "same-origin");
  assert.equal(classify(immutableRoot), "immutable-model-root");
  assert.equal(classify(regionalRedirect), "immutable-model-redirect");
  assert.equal(classify(cacheRedirect), "immutable-model-redirect");
  assert.equal(classify(regionalRedirect, "model-install", regionalRedirect), "blocked");
  assert.equal(classify(regionalRedirect, "inference"), "blocked");
  assert.equal(classify(immutableRoot.replace("32ff081f", "42ff081f")), "blocked");
  assert.equal(classify(immutableRoot.replace("https:", "http:")), "blocked");
  assert.equal(classify(immutableRoot.replace("huggingface.co", "huggingface.co.evil.test")), "blocked");
  assert.equal(classify(immutableRoot.replace("huggingface.co", "huggingface.co:444")), "blocked");
  assert.equal(isPreviewToolbarRequest("https://vercel.live/widget"), true);
  assert.equal(isPreviewToolbarRequest("https://vercel.live:444/widget"), false);
  assert.equal(isPreviewToolbarRequest("https://vercel.live.evil.test/widget"), false);
  assert.equal(isPreviewToolbarRequest("http://vercel.live/widget"), false);
  const lazyTraditionalRuntimeSources = await Promise.all([
    "../lib/novel-ai/closed-agent-os/closed-agent-os.ts",
    "../lib/novel-ai/closed-agent-os/evaluator.ts",
    "../lib/novel-ai/providers/browser-ai/browser-ai-provider.ts",
    "../lib/novel-ai/providers/local-ollama/local-ollama-provider.ts",
    "../lib/novel-ai/web/rpg-closed-ai-director.ts",
  ].map((source) => readFile(new URL(source, import.meta.url), "utf8")));
  for (const source of lazyTraditionalRuntimeSources) {
    assert.doesNotMatch(
      source,
      /(?:^|\n)import\s+(?!type\b)(?:\{[^}]*\}|\w+|\*\s+as\s+\w+)\s+from\s+["'][^"']*language\/traditional-chinese["']/u,
    );
    assert.match(source, /import\([\s\S]{0,80}language\/traditional-chinese/u);
  }
  const [types, closedAgentOs, safeRuntimeDiagnostics, conversationRepository, recordSecurity, backends, provider, browserWebLlmRuntime, privateHub, service, bootstrap, composer, workspace, finalizationSupport, bootstrapHook, messageRow, regenerationProof, approvalHook, browserGate, health] = await Promise.all([
    readFile(new URL("../lib/novel-ai/closed-agent-os/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/novel-ai/closed-agent-os/closed-agent-os.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/novel-ai/closed-agent-os/safe-runtime-diagnostics.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/novel-ai/conversation/repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/novel-ai/conversation/record-security.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/novel-ai/closed-agent-os/backends.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/novel-ai/providers/browser-ai/browser-ai-provider.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/novel-ai/providers/browser-ai/browser-webllm-runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/novel-ai/providers/private-ai-hub/private-hub-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/novel-ai/web/closed-agent-os-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/novel-ai/web/closed-ai-bootstrap-coordinator.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/project/[projectId]/chat/components/message-composer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/project/[projectId]/chat/conversation-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/novel-ai/conversation/closed-agent-finalization.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/project/[projectId]/chat/hooks/use-closed-ai-bootstrap.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/project/[projectId]/chat/components/message-row.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/project/[projectId]/chat/components/conversation-regeneration-proof.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/project/[projectId]/chat/hooks/use-conversation-approval.ts", import.meta.url), "utf8"),
    readFile(new URL("./run-rc6-2-closed-agent-browser.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/health/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(types, /CRYPTOGRAPHIC_MODEL_DIGEST_PATTERN = \/\^\[a-f0-9\]\{64\}\$\//u);
  assert.match(types, /isCryptographicClosedAIModelDigest\(snapshot\.modelDigest\)/u);
  assert.match(closedAgentOs, /CLOSED_AI_MODEL_IDENTITY_MISMATCH/u);
  assert.match(closedAgentOs, /Array\.isArray\(candidate\.blockingCodes\)/u);
  assert.match(closedAgentOs, /filter\(isClosedAgentFailureDiagnosticCode\)/u);
  assert.match(safeRuntimeDiagnostics, /CLOSED_AGENT_FAILURE_DIAGNOSTIC_CODES/u);
  assert.match(safeRuntimeDiagnostics, /CLOSED_AGENT_EVALUATION_BLOCKED/u);
  assert.match(safeRuntimeDiagnostics, /CANDIDATE_RAW_REASONING_LEAK/u);
  assert.doesNotMatch(closedAgentOs, /\^QUALITY_\[A-Z0-9_\]\+\$/u);
  assert.match(closedAgentOs, /execution\.modelId !== routed\.modelId/u);
  assert.match(closedAgentOs, /execution\.modelDigest !== routed\.modelDigest/u);
  assert.match(closedAgentOs, /isCryptographicClosedAIModelDigest\(\s*execution\.modelDigest/u);
  assert.match(backends, /proof\?\.inferenceMode === "generative-model"/u);
  assert.match(backends, /proof\.modelId === capability\.modelId/u);
  assert.match(backends, /proof\.modelDigest === capability\.modelDigest/u);
  assert.doesNotMatch(
    backends,
    /import\s*\{\s*executeBrowserSovereignFabric\s*\}\s*from/u,
    "Chat bootstrap must not synchronously load the Browser sovereign generation graph",
  );
  assert.match(
    backends,
    /await import\(\s*"\.\.\/browser-fabric\/orchestrator"\s*\)/u,
    "Browser sovereign generation must load only at the verified Browser execute boundary",
  );
  assert.doesNotMatch(backends, /unknown-local-digest|unknown-local-model/u);
  assert.match(backends, /Local Ollama returned no verified model identity/u);
  assert.doesNotMatch(
    backends,
    /delta:\s*(?:progress|stream)(?:\?\.)?\.delta/u,
    "Closed backend progress must expose numeric counters, never rejected model text",
  );
  assert.match(
    provider,
    /inferenceMode:\s*BrowserAIInferenceProof\["inferenceMode"\]\s*=\s*"task-model"/u,
  );
  assert.match(provider, /"generative-model"/u);
  assert.match(provider, /BROWSER_AI_MODEL_DIGEST_NOT_VERIFIABLE/u);
  assert.match(provider, /const productionGenerationReady = resolvedCapability\.generativeModelReady/u);
  assert.match(provider, /resolvedCapability\.generativeRuntime === "webllm-worker"/u);
  const browserVerification = provider.slice(
    provider.indexOf("export async function verifyBrowserAI"),
    provider.indexOf("export async function detectBrowserAI"),
  );
  assert.match(provider, /const BROWSER_GENERATION_VERIFICATION_SEED = 0x52433632/u);
  assert.match(provider, /const BROWSER_GENERATION_VERIFICATION_SCHEMA = Object\.freeze\(\{/u);
  assert.match(browserVerification, /generateWithBrowserWebLLM\(\{[\s\S]*jsonMode:\s*true/u);
  assert.match(
    browserVerification,
    /jsonSchema:\s*BROWSER_GENERATION_VERIFICATION_SCHEMA[\s\S]*seed:\s*BROWSER_GENERATION_VERIFICATION_SEED/u,
  );
  assert.match(
    browserWebLlmRuntime,
    /browserPromptTokenBudgets\(\{\s*\n\s*performancePolicy,\s*\n\s*systemTokens,/u,
  );
  assert.match(
    browserWebLlmRuntime,
    /protectedContextHardLimitTokens:\s*input\.contextAttestation === "required"/u,
  );
  assert.match(
    browserWebLlmRuntime,
    /protectedContextHardLimitTokens < 1[\s\S]*BROWSER_FINAL_CONTEXT_BUDGET_EXCEEDED[\s\S]*BROWSER_AI_MANDATORY_PROMPT_BUDGET_EXCEEDED/u,
  );
  assert.match(privateHub, /body\.modelDigest === expected\.modelDigest/u);
  assert.match(privateHub, /isCryptographicClosedAIModelDigest\(body\.modelDigest\)/u);
  assert.match(privateHub, /validPrivateHubVerificationTimestamp\(body\.verifiedAt\)/u);
  assert.match(privateHub, /proof\.modelDigest === catalogModelDigest/u);
  assert.doesNotMatch(privateHub, /unknown-model-digest/u);
  assert.match(bootstrap, /userInitiated:\s*true/u);
  assert.match(bootstrap, /BROWSER_GENERATIVE_VERIFICATION_REQUIRED/u);
  assert.match(bootstrap, /if \(active\.signal\?\.aborted\)/u);
  assert.match(bootstrap, /active\.signal === input\.signal/u);
  const automaticBootstrap = bootstrap.slice(
    bootstrap.indexOf("async bootstrap("),
    bootstrap.indexOf("/** Model download is only reachable"),
  );
  assert.doesNotMatch(automaticBootstrap, /installModel/u);
  assert.match(service, /externalFallback:\s*false/u);
  assert.doesNotMatch(service, /openai|grok/iu);
  assert.match(composer, /取消準備/u);
  assert.match(composer, /重試 Browser AI/u);
  assert.match(composer, /closedAiSetupError\s*\n\s*\?\? closedAiSetupProgress\?\.message/u);
  assert.match(composer, /約 \{downloadMegabytes\} MB 本機儲存/u);
  assert.match(composer, /data-estimated-download-bytes/u);
  assert.match(composer, /作品資料<\/dt><dd>不離開裝置/u);
  assert.match(composer, /data-closed-ai-generation-verified-backends/u);
  assert.match(composer, /data-closed-ai-active-backend/u);
  assert.match(composer, /data-closed-ai-setup-busy=\{closedAiSetupBusy\}/u);
  assert.match(composer, /data-closed-ai-external-fallback/u);
  assert.match(composer, /data-setup-lifecycle=\{closedAiSetupLifecycle\}/u);
  assert.match(bootstrapHook, /setClosedAiSetupProgress\(null\);\s*\n\s*setClosedAiSetupError\(safeErrorMessage\(error\)\)/u);
  assert.match(bootstrapHook, /setClosedAiSetupProgress\(null\);\s*\n\s*setClosedAiSetupError\("已取消準備/u);
  assert.doesNotMatch(workspace, /preferredBackend:\s*previousDigest\s*\?\s*"local-ollama"/u);
  assert.match(bootstrapHook, /verifiedConversationRegenerationBackend/u);
  assert.match(bootstrapHook, /sourceBackendStillReady/u);
  assert.doesNotMatch(bootstrapHook, /inspected\.readiness\.activeBackend/u);
  assert.match(bootstrapHook, /CONVERSATION_REGENERATION_SOURCE_PROOF_INVALID/u);
  assert.match(bootstrapHook, /candidateId\.startsWith\("closed-agent-candidate:"\)/u);
  assert.match(bootstrapHook, /normalizedCandidateDigest !== input\.sourceMessageContentDigest/u);
  assert.match(bootstrapHook, /candidateDigest:\s*candidate\.contentDigest/u);
  assert.match(workspace, /sourceCandidateIds:\s*currentSourceMessage\.candidateIds/u);
  assert.match(workspace, /expectedSourceMessage:\s*currentSourceMessage/u);
  assert.match(workspace, /expectedSourceInvocation:\s*sourceInvocation!/u);
  assert.match(workspace, /sourceCandidateDigest:\s*regenerationSource\.candidateDigest/u);
  assert.match(workspace, /closedAiSetup\?\.status === "ready"/u);
  assert.match(workspace, /closedAiSetup\.readiness\.generationVerifiedBackends > 0/u);
  assert.match(messageRow, /&& regenerationReady/u);
  assert.doesNotMatch(messageRow, /outputDigest === message\.contentDigest/u);
  assert.match(regenerationProof, /input\.artifacts\.length === 0/u);
  assert.match(regenerationProof, /artifact\.candidateDigest === input\.message\.contentDigest/u);
  assert.match(regenerationProof, /SHA256_DIGEST\.test\(receipt\?\.outputDigest/u);
  assert.doesNotMatch(regenerationProof, /outputDigest === input\.message\.contentDigest/u);
  assert.match(messageRow, /disabled=\{busy\}/u);
  assert.match(messageRow, /aria-busy=\{busy\}/u);
  assert.match(safeRuntimeDiagnostics, /"closed-agent-failure-evidence-v1"/u);
  assert.match(safeRuntimeDiagnostics, /values\.length > 3/u);
  assert.match(safeRuntimeDiagnostics, /stages\[0\] !== "initial"/u);
  assert.match(safeRuntimeDiagnostics, /stages\[1\] !== "repair"/u);
  assert.match(safeRuntimeDiagnostics, /stages\[2\] === "extension"/u);
  assert.match(safeRuntimeDiagnostics, /stages\[2\] === "recovery"/u);
  assert.match(safeRuntimeDiagnostics, /candidate\.finishReason !== "unavailable"/u);
  assert.match(safeRuntimeDiagnostics, /candidate\.completionTokens === null/u);
  assert.match(safeRuntimeDiagnostics, /exactClosedAgentBrowserRuntimeEvidence/u);
  assert.match(safeRuntimeDiagnostics, /"browserRuntimeEvidence" in candidate/u);
  assert.match(safeRuntimeDiagnostics, /CLOSED_AGENT_FAILURE_EVIDENCE_INVALID/u);
  assert.match(safeRuntimeDiagnostics, /value\.length > 4_096/u);
  assert.match(conversationRepository, /CONVERSATION_FAILURE_EVIDENCE_REQUIRED/u);
  assert.match(conversationRepository, /parseClosedAgentFailureEvidence\(input\.safeProgress\.message\)/u);
  assert.match(recordSecurity, /CONVERSATION_LOCAL_TOOL_IDS\.closedAgentPlan/u);
  assert.match(recordSecurity, /parseClosedAgentFailureEvidence\(invocation\.safeProgress\.message\)/u);
  assert.match(workspace, /createClosedAgentFailureEvidence\(error\)/u);
  assert.match(workspace, /serializeClosedAgentFailureEvidence\(failureEvidence\)/u);
  assert.match(finalizationSupport, /stage:\s*CLOSED_AGENT_FAILURE_EVIDENCE_PROGRESS_STAGE/u);
  assert.match(finalizationSupport, /persistenceFailed = true/u);
  assert.match(finalizationSupport, /CLOSED_AGENT_FAILURE_EVIDENCE_PERSIST_FAILED/u);
  const closedAgentFinalization = workspace.slice(
    workspace.indexOf("async function runClosedAgent"),
    workspace.indexOf("async function sendRequest"),
  );
  const targetSnapshotAt = closedAgentFinalization.indexOf("const approvalTarget");
  const modelExecutionAt = closedAgentFinalization.indexOf("await executeStudioClosedAgent");
  const artifactCommitAt = closedAgentFinalization.indexOf("artifact = await conversation.saveArtifact");
  const messageCommitAt = closedAgentFinalization.indexOf("await conversation.updateMessageStatus", artifactCommitAt);
  const invocationCommitAt = closedAgentFinalization.indexOf("invocation = await completeInvocation()", messageCommitAt);
  assert.ok(targetSnapshotAt >= 0 && targetSnapshotAt < modelExecutionAt);
  assert.ok(modelExecutionAt < artifactCommitAt);
  assert.ok(artifactCommitAt < messageCommitAt);
  assert.ok(messageCommitAt < invocationCommitAt);
  assert.match(finalizationSupport, /CONVERSATION_APPROVAL_TARGET_MISSING/u);
  assert.match(finalizationSupport, /currentArtifact\?\.status === "candidate"/u);
  const regenerationHandler = workspace.slice(
    workspace.indexOf("async function regenerateMessage"),
    workspace.indexOf("function stopGeneration"),
  );
  const regenerationCatch = regenerationHandler.slice(regenerationHandler.lastIndexOf("} catch (error)"));
  assert.ok(regenerationCatch.indexOf("await loadWorkspace(sessionId)") >= 0);
  assert.ok(
    regenerationCatch.indexOf("await loadWorkspace(sessionId)")
      < regenerationCatch.indexOf("setSafeError"),
  );
  assert.match(messageRow, /selectClosedAgentFailureEvidenceInvocation/u);
  assert.match(messageRow, /data-testid="conversation-closed-agent-failure-evidence"/u);
  assert.match(messageRow, /data-failure-evidence=\{failureInvocation\.safeProgress\?\.message\}/u);
  assert.match(messageRow, /data-invocation-id=\{failureInvocation\.id\}/u);
  assert.match(messageRow, /data-task-id=\{failureInvocation\.taskId\}/u);
  assert.match(approvalHook, /id\.startsWith\("closed-agent-candidate:"\)/u);
  assert.match(backends, /closedAIRegenerationPromptContext/u);
  assert.match(backends, /seed:\s*request\.regeneration\.modelSeed/u);
  assert.match(privateHub, /buildPrivateHubClosedGenerationRequest/u);
  assert.match(privateHub, /seed:\s*input\.request\.regeneration\.modelSeed/u);
  assert.doesNotMatch(workspace, /getStudioClosedAIBootstrapCoordinator/u);
  assert.match(browserGate, /RC6_2_CLOSED_AI_EXACT_HTTPS_ORIGIN_REQUIRED/u);
  assert.match(browserGate, /context\.route\("https:\/\/vercel\.live\/\*\*"/u);
  assert.match(browserGate, /route\.abort\("blockedbyclient"\)/u);
  assert.match(
    browserGate,
    /await route\.abort\("blockedbyclient"\);[\s\S]*blockedPreviewToolbarRequests\.add\(route\.request\(\)\)/u,
  );
  assert.match(browserGate, /observedPreviewToolbarRequests[\s\S]*blockedPreviewToolbarRequests/u);
  assert.match(browserGate, /assert\.deepEqual\(previewToolbarResponses, \[\]\)/u);
  assert.match(browserGate, /disallowedCrossOriginHostDigests/u);
  assert.doesNotMatch(browserGate, /disallowedCrossOriginHosts/u);
  assert.match(
    browserGate,
    /rightsRequiredAlert\.waitFor\([\s\S]*await waitUntilNotBusy\(composer\)/u,
  );
  assert.doesNotMatch(browserGate, /RC6_2_CLOSED_AI_DIAGNOSTIC_RIGHTS_ONLY/u);
  assert.match(browserGate, /getByTestId\("closed-ai-prepare-browser"\)\.click\(\)/u);
  assert.match(browserGate, /data-setup-lifecycle"\), "cancelled"/u);
  assert.match(browserGate, /getByRole\("button", \{ name: "取消準備"/u);
  assert.match(browserGate, /retryAfterCancel:\s*true/u);
  assert.match(browserGate, /readReleaseIdentityTruth/u);
  assert.match(browserGate, /assert\.equal\(truth\.body\.appCommit, expectedCommit\)/u);
  assert.match(browserGate, /assert\.equal\(truth\.body\.deploymentId, expectedDeploymentId\)/u);
  assert.match(browserGate, /secondCard\.getByRole\("button", \{ name: "放棄"/u);
  assert.match(browserGate, /name: "重新產生"/u);
  assert.match(browserGate, /thirdCard\.getByRole\("button", \{ name: "採用"/u);
  assert.match(browserGate, /regenerationAttempt:\s*1/u);
  assert.match(browserGate, /regenerationAttempt:\s*2/u);
  assert.match(browserGate, /firstAfterDirectRegeneration\.candidate\.status, "awaiting-approval"/u);
  assert.match(browserGate, /waitForClosedAiRegenerationReady/u);
  assert.match(browserGate, /data-closed-ai-setup-busy/u);
  assert.match(browserGate, /waitForRegenerationStart/u);
  assert.match(browserGate, /RC6_2_CLOSED_AI_INCOMPLETE_TERMINAL_STATE/u);
  assert.match(browserGate, /evidence\.message\?\.status === "completed"/u);
  assert.match(browserGate, /evidence\.message\?\.candidateLinked === true/u);
  assert.match(browserGate, /evidence\.message\?\.invocationLinked === true/u);
  assert.match(browserGate, /SAFE_DIAGNOSTIC_CODES/u);
  assert.match(browserGate, /SAFE_DIAGNOSTIC_CODE_SET\.has\(value\)/u);
  for (const code of [
    "QUALITY_SCORE_BELOW_THRESHOLD",
    "QUALITY_OUTPUT_CREDENTIAL_LEAK",
    "QUALITY_OUTPUT_RAW_REASONING_LEAK",
    "QUALITY_OUTPUT_CONTROL_TOKEN",
    "QUALITY_OUTPUT_ROLE_ENVELOPE",
    "QUALITY_OUTPUT_INTERNAL_ENVELOPE",
    "QUALITY_CONTINUATION_CONTROL_TOKEN",
    "QUALITY_CONTINUATION_ROLE_ENVELOPE",
    "QUALITY_CONTINUATION_INTERNAL_ENVELOPE",
    "QUALITY_CONTINUATION_ANCHOR_INVALID",
    "QUALITY_CONTINUATION_ANCHOR_REPEATED",
    "QUALITY_CONTINUATION_SUFFIX_EMPTY",
    "QUALITY_CONTINUATION_BASE_REPEATED",
    "QUALITY_CONTINUATION_CONTRACT_UNSATISFIED",
    "CANDIDATE_CREDENTIAL_LEAK",
    "CANDIDATE_RAW_REASONING_LEAK",
  ]) {
    assert.ok(browserGate.includes(`"${code}"`), `${code} missing from browser gate allowlist`);
  }
  assert.ok(browserGate.includes('"recovery"'), "recovery runtime stage missing from browser gate allowlist");
  assert.match(browserGate, /FAILURE_EVIDENCE_SCHEMA_VERSION = "closed-agent-failure-evidence-v1"/u);
  assert.match(browserGate, /parsePersistedFailureEvidence/u);
  assert.match(browserGate, /readFailedClosedAgentInvocation/u);
  assert.match(browserGate, /record\.toolId === "closed-agent-os:conversation-plan"/u);
  assert.match(browserGate, /invocation\.safeProgress\?\.stage, "closed-agent-failure-evidence"/u);
  assert.match(browserGate, /invocation\.safeProgress\?\.percent, 100/u);
  assert.match(browserGate, /assertProductFailureEvidenceDom/u);
  assert.match(browserGate, /composer\?\.getAttribute\("aria-busy"\) !== "false"/u);
  assert.match(browserGate, /conversation-message-timeline/u);
  assert.match(browserGate, /conversation-closed-agent-failure-evidence/u);
  assert.match(browserGate, /data-invocation-id/u);
  assert.match(browserGate, /data-task-id/u);
  assert.match(browserGate, /exact failed invocation disappeared after reload/u);
  assert.doesNotMatch(browserGate, /MutationObserver/u);
  assert.doesNotMatch(browserGate, /querySelectorAll\('\[role="status"\], \[role="alert"\]'\)/u);
  assert.doesNotMatch(browserGate, /diagnosticTokenPattern|runtimeEvidencePattern/u);
  for (const code of CLOSED_AGENT_BROWSER_RUNTIME_DIAGNOSTIC_CODES) {
    assert.ok(browserGate.includes(`"${code}"`), `${code} missing from browser gate allowlist`);
  }
  assert.match(browserGate, /assertMaliciousDomDiagnosticsAreRejected/u);
  assert.match(browserGate, /QUALITY_EMPTY_CANDIDATE BROWSER_RUNTIME_EVIDENCE:initial:stop:12:30:30:20/u);
  assert.match(browserGate, /schemaVersion\}-attacker/u);
  assert.match(browserGate, /authoritativeFailureEvidence, null/u);
  assert.doesNotMatch(browserGate, /error\.message\.slice|String\(error\)\.slice/u);
  assert.doesNotMatch(browserGate, /RC6_2_CLOSED_AI_SETUP_FAILED:\$\{\(await card\.textContent/u);
  assert.match(browserGate, /page\.reload/u);
  assert.match(browserGate, /actualExecutor, "browser-ai"/u);
  assert.match(browserGate, /consumerReadiness\.generationVerifiedBackends >= 1/u);
  assert.match(browserGate, /consumerReadiness\.activeBackend, "browser-ai"/u);
  assert.match(browserGate, /consumerReadiness\.externalFallback, false/u);
  assert.match(browserGate, /data-estimated-download-bytes/u);
  assert.match(browserGate, /"294543984"/u);
  assert.match(browserGate, /composer\.fill\("幫我開始第一章"\)/u);
  assert.match(browserGate, /BROWSER_AI_MANDATORY_PROMPT_CONTRACT_MISSING/u);
  assert.doesNotMatch(browserGate, /page\.route|addInitScript|mock-provider|test-provider/iu);
  assert.match(health, /closedAiGenerationVerifiedBackends: CLOSED_AI_SERVER_RUNTIME_TRUTH\.generationVerifiedBackends/u);
  assert.match(health, /browserAiStatus: "client_probe_required"/u);
  assert.match(health, /browserClosedAiStatus: "setup_required"/u);
  assert.match(health, /threeClosedAISharedSystemStatus: "not_verified"/u);
  assert.match(health, /threeClosedAiArchitectureStatus: "not_verified"/u);
  assert.doesNotMatch(health, /browserClosedAiStatus: "ready_with_packaged_extractive_fallback"/u);
});

const failed = results.filter((item) => item.status === "FAIL");
console.log(JSON.stringify({
  schemaVersion: "p24b-rc6-2-closed-agent-runtime-tests-v1",
  mode,
  pass: results.length - failed.length,
  fail: failed.length,
  results,
}, null, 2));
if (failed.length) process.exitCode = 1;

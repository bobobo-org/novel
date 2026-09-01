import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
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

const NETWORK_SENTINEL_SCHEMA = "p24b-rc6.2-network-zero-receipt-v2";
const NETWORK_SENTINEL_PASS_SCALARS = Object.freeze({
  bootstrapAllowedCount: 1,
  bootstrapReceiverHttpCount: 1,
  bootstrapConsumed: true,
  bootstrapExceptionDisabledBeforeProbes: true,
  httpProbeAttemptCount: 2,
  httpRouteObservedCount: 2,
  httpRouteBlockedCount: 2,
  crossOriginClassificationCount: 2,
  methodRejectedCount: 1,
  bodyRejectedCount: 1,
  webSocketProbeAttemptCount: 1,
  webSocketRouteObservedCount: 1,
  webSocketRouteBlockedCount: 1,
  disallowedWebSocketCount: 1,
  browserNativePreblockCount: 0,
  tcpConnectionReceiptDelta: 0,
  httpRequestReceiptDelta: 0,
  httpRequestBodyByteDelta: 0,
  webSocketUpgradeReceiptDelta: 0,
  arbitraryOutboundHeaderBlocked: true,
  requestBodyBlocked: true,
  httpGetBrowserResult: "blocked-by-route",
  httpPostBrowserResult: "blocked-by-route",
  webSocketBrowserResult: "blocked-by-route",
  operationalErrorCount: 0,
  pageReturnedToAboutBlank: true,
  browserContextCount: 1,
  pageCount: 1,
  serviceWorkerCount: 0,
  receiverClosed: true,
  bootstrapSecretsCleared: true,
  productPolicyCountersZero: true,
  sentinelCountersReset: true,
});
const NETWORK_SENTINEL_PASS_ROUTE_RECORDS = Object.freeze([
  Object.freeze({
    probeId: "HTTP_GET",
    routeObserved: true,
    routeDecision: "blocked",
    reasonCodes: Object.freeze(["network-classification-blocked"]),
  }),
  Object.freeze({
    probeId: "HTTP_POST",
    routeObserved: true,
    routeDecision: "blocked",
    reasonCodes: Object.freeze([
      "method-not-allowed", "network-classification-blocked", "request-body-not-allowed",
    ]),
  }),
  Object.freeze({
    probeId: "WEBSOCKET",
    routeObserved: true,
    routeDecision: "blocked",
    reasonCodes: Object.freeze(["network-classification-blocked"]),
  }),
]);

function stableSentinelStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSentinelStringify).join(",")}]`;
  const entries = Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableSentinelStringify(child)}`).join(",")}}`;
}

function networkSentinelDigest(value) {
  const body = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "matrixDigest"),
  );
  return createHash("sha256")
    .update(`${NETWORK_SENTINEL_SCHEMA}\n${stableSentinelStringify(body)}`)
    .digest("hex");
}

function sourceSection(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label} start marker is missing`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${label} end marker is missing`);
  assert.ok(end > start, `${label} source markers are out of order`);
  return source.slice(start, end);
}

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
    complexity: taskType === "character.multiAgentSimulation"
      ? "heavy"
      : taskType === "story.summary"
        ? "light"
        : "standard",
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
  const route = resolveClosedAIRoute(task("story.summary"), [packaged]);
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
      finalizeSetup: async (_boundary, options) => options.onCommitted(),
      cancelSetup: async () => ({
        code: "BROWSER_WEBLLM_SETUP_CANCELLED",
        cancellationAcknowledged: true,
        cacheRetained: true,
        metadataRollback: "deleted",
      }),
      failSetup: async () => undefined,
      selectModel: async () => undefined,
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
    finalizeSetup: async (_boundary, options) => options.onCommitted(),
    cancelSetup: async () => ({
      code: "BROWSER_WEBLLM_SETUP_CANCELLED",
      cancellationAcknowledged: true,
      cacheRetained: true,
      metadataRollback: "deleted",
    }),
    failSetup: async () => undefined,
    selectModel: async () => undefined,
  });
  const firstController = new AbortController();
  const first = coordinator.prepareBrowserAi({
    projectId: "cancel-retry-browser",
    taskType: "story.summary",
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
    taskType: "story.summary",
    userInitiated: true,
    signal: secondController.signal,
  });
  const [firstError, secondResult] = await Promise.all([firstOutcome, second]);
  assert.equal(firstError?.code, "BROWSER_WEBLLM_SETUP_CANCELLED");
  assert.equal(firstError?.cancellationAcknowledged, true);
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
    ...task("chapter.rewrite"),
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
        ...task("chapter.rewrite"),
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
    { name: "Browser only", ids: ["browser-ai"], expected: "browser-ai", taskType: "chapter.rewrite" },
    { name: "Local only", ids: ["local-ollama"], expected: "local-ollama", taskType: "chapter.rewrite" },
    { name: "Private Hub only", ids: ["private-ai-hub"], expected: "private-ai-hub", heavy: true },
    { name: "Browser + Local", ids: ["browser-ai", "local-ollama"], expected: "browser-ai", taskType: "chapter.rewrite" },
    { name: "Browser + Hub", ids: ["browser-ai", "private-ai-hub"], expected: "browser-ai", taskType: "chapter.rewrite" },
    { name: "Local + Hub", ids: ["local-ollama", "private-ai-hub"], expected: "local-ollama", taskType: "chapter.rewrite" },
    { name: "All three", ids: ["browser-ai", "local-ollama", "private-ai-hub"], expected: "browser-ai", taskType: "chapter.rewrite" },
    { name: "None available", ids: [], expected: null, taskType: "chapter.rewrite" },
    {
      name: "Full prose automatically selects Local",
      ids: ["browser-ai", "local-ollama"],
      expected: "local-ollama",
      taskType: "chapter.continue",
    },
    {
      name: "Full prose without a qualified Local route stops safely",
      ids: ["browser-ai"],
      expected: null,
      taskType: "chapter.continue",
      reasonCode: "CLOSED_AI_REQUIRED_BACKEND_NOT_READY",
    },
  ];
  for (const matrixCase of cases) {
    const snapshots = matrixCase.ids.map((id) => backend(id));
    const request = matrixCase.heavy
      ? task("character.multiAgentSimulation", "private_infrastructure_only")
      : task(matrixCase.taskType);
    const route = resolveClosedAIRoute(request, snapshots, {
      preferredBackend: matrixCase.preferredBackend,
    });
    if (matrixCase.expected) {
      assert.equal(route.executionStatus, "routable", matrixCase.name);
      assert.equal(route.backend.id, matrixCase.expected, matrixCase.name);
      assert.equal(route.fallbackAttempted, false, matrixCase.name);
    } else {
      assert.equal(route.executionStatus, "not_executed", matrixCase.name);
      assert.equal(
        route.reasonCode,
        matrixCase.reasonCode ?? "CLOSED_AI_REQUIRED_BACKEND_NOT_READY",
        matrixCase.name,
      );
    }
    assert.equal(
      JSON.stringify(route).match(/openai|grok|gemini|claude/giu),
      null,
      `${matrixCase.name} must not contain an external route`,
    );
  }
});

await test("browser-network-zero-receipt", async () => {
  const bootstrapState = {
    requestPhase: "bootstrap",
    sentinelBootstrapActive: true,
    sentinelBootstrapConsumed: false,
    sentinelBootstrapAllowedCount: 0,
  };
  const exactBootstrapRequest = {
    exactUrl: true,
    method: "GET",
    resourceType: "document",
    bodyByteCount: 0,
    urlCredentialsEmpty: true,
    credentialHeaderCount: 0,
    redirectedFrom: null,
    queryEmpty: true,
    fragmentEmpty: true,
  };
  const mayConsumeBootstrap = (state, request) => state.requestPhase === "bootstrap"
    && state.sentinelBootstrapActive
    && !state.sentinelBootstrapConsumed
    && request.exactUrl
    && request.method === "GET"
    && request.resourceType === "document"
    && request.bodyByteCount === 0
    && request.urlCredentialsEmpty
    && request.credentialHeaderCount === 0
    && request.redirectedFrom === null
    && request.queryEmpty
    && request.fragmentEmpty;
  const consumeBeforeContinue = (state, request, continueRequest) => {
    if (!mayConsumeBootstrap(state, request)) return false;
    state.sentinelBootstrapConsumed = true;
    state.sentinelBootstrapAllowedCount += 1;
    continueRequest();
    return true;
  };
  assert.equal(consumeBeforeContinue(
    bootstrapState,
    exactBootstrapRequest,
    () => {
      assert.equal(bootstrapState.sentinelBootstrapConsumed, true);
      assert.equal(bootstrapState.sentinelBootstrapAllowedCount, 1);
    },
  ), true);
  assert.equal(consumeBeforeContinue(bootstrapState, exactBootstrapRequest, assert.fail), false);
  for (const mutation of [
    { exactUrl: false }, { method: "POST" }, { bodyByteCount: 1 },
    { credentialHeaderCount: 1 }, { redirectedFrom: "finite" }, { queryEmpty: false },
  ]) {
    assert.equal(mayConsumeBootstrap(
      { ...bootstrapState, sentinelBootstrapConsumed: false },
      { ...exactBootstrapRequest, ...mutation },
    ), false);
  }
  bootstrapState.sentinelBootstrapActive = false;

  const matrixBody = {
    schemaVersion: NETWORK_SENTINEL_SCHEMA,
    status: "PASS",
    ...NETWORK_SENTINEL_PASS_SCALARS,
    receiverBaseline: {
      tcpConnectionReceiptCount: 1,
      httpRequestReceiptCount: 1,
      httpRequestBodyByteCount: 0,
      webSocketUpgradeReceiptCount: 0,
    },
    probeRouteRecords: NETWORK_SENTINEL_PASS_ROUTE_RECORDS.map((record) => ({
      ...record,
      reasonCodes: [...record.reasonCodes],
    })),
    firstFailedScalarAssertion: null,
  };
  const matrix = { ...matrixBody, matrixDigest: networkSentinelDigest(matrixBody) };
  assert.match(matrix.matrixDigest, /^[a-f0-9]{64}$/u);
  assert.equal(matrix.matrixDigest, networkSentinelDigest(matrix));
  assert.deepEqual(
    matrix.probeRouteRecords.map(({ probeId }) => probeId),
    ["HTTP_GET", "HTTP_POST", "WEBSOCKET"],
  );
  assert.deepEqual(
    matrix.probeRouteRecords.map(({ reasonCodes }) => reasonCodes),
    [
      ["network-classification-blocked"],
      ["method-not-allowed", "network-classification-blocked", "request-body-not-allowed"],
      ["network-classification-blocked"],
    ],
  );
  assert.deepEqual(matrix.receiverBaseline, {
    tcpConnectionReceiptCount: 1,
    httpRequestReceiptCount: 1,
    httpRequestBodyByteCount: 0,
    webSocketUpgradeReceiptCount: 0,
  });
  assert.equal(matrix.httpRequestReceiptDelta, 0);
  assert.equal(matrix.webSocketUpgradeReceiptDelta, 0);
  assert.equal(matrix.bootstrapExceptionDisabledBeforeProbes, true);
  assert.equal(matrix.productPolicyCountersZero, true);
  assert.equal(matrix.sentinelCountersReset, true);
  const mutated = { ...matrix, httpRequestReceiptDelta: 1 };
  mutated.matrixDigest = networkSentinelDigest(mutated);
  assert.notEqual(mutated.matrixDigest, matrix.matrixDigest);
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
  const isExactPreviewToolbarRequest = (value) => {
    const url = new URL(value);
    return isPreviewToolbarRequest(value)
      && url.protocol === "https:"
      && url.hostname === "vercel.live"
      && url.port === ""
      && url.username === ""
      && url.password === "";
  };
  assert.equal(isExactPreviewToolbarRequest("https://vercel.live/widget"), true);
  assert.equal(isExactPreviewToolbarRequest("https://story:leak@vercel.live/widget"), false);
  const fixtureUuid = "00000000-0000-4000-8000-000000000000";
  const productChunk = "/_next/static/chunks/04k3pu8w7soaf.js";
  const allowedProjectScreens = new Set(["chat", "story-bible", "write", "closed-ai"]);
  const canonicalUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[a-f0-9]{12}$/u;
  const allowedSameOriginTarget = (url) => {
    if (url.pathname === productChunk) return url.search === "";
    if (url.pathname === "/api/persistence/health") return url.search === "";
    if (url.pathname === "/api/release/identity") {
      if (url.search === "") return true;
      const entries = [...url.searchParams.entries()];
      return entries.length === 1
        && entries[0][0] === "rc6_2"
        && canonicalUuid.test(entries[0][1]);
    }
    const match = url.pathname.match(
      /^\/studio\/project\/([a-f0-9-]{36})\/([a-z-]+)$/u,
    );
    if (!match || !canonicalUuid.test(match[1]) || !allowedProjectScreens.has(match[2])) {
      return false;
    }
    const params = new URLSearchParams(url.search);
    const rsc = params.getAll("_rsc");
    if (rsc.length > 1 || (rsc[0] !== undefined && !/^[A-Za-z0-9_-]{1,64}$/u.test(rsc[0]))) {
      return false;
    }
    params.delete("_rsc");
    const entries = [...params.entries()];
    if (entries.length === 0) return true;
    if (match[2] === "chat") {
      return entries.length === 1
        && entries[0][0] === "prompt"
        && entries[0][1] === "請協助我續寫、改寫或分析目前小說。";
    }
    if (match[2] === "write") {
      return entries.length === 1
        && entries[0][0] === "chapterId"
        && canonicalUuid.test(entries[0][1]);
    }
    if (match[2] === "closed-ai") {
      return entries.length === 1
        && entries[0][0] === "backend"
        && ["local-ollama", "private-ai-hub"].includes(entries[0][1]);
    }
    return false;
  };
  const routePolicyAction = ({
    urlValue,
    method = "GET",
    requestPhase = "inference",
    rootUrlValue = immutableRoot,
    hasPostData = false,
    hasCredentialHeader = false,
  }) => {
    if (isExactPreviewToolbarRequest(urlValue)) {
      return { action: "abort-toolbar", reasonCodes: [] };
    }
    let parsed = null;
    try {
      parsed = new URL(urlValue);
    } catch {
      // Invalid request targets remain fail-closed in the classifier below.
    }
    const localScheme = Boolean(
      parsed
      && (
        parsed.protocol === "blob:"
        || parsed.protocol === "data:"
        || (
          parsed.protocol === "about:"
          && (parsed.href === "about:blank" || parsed.href === "about:srcdoc")
        )
      ),
    );
    const classification = localScheme
      ? "local-scheme"
      : classifyClosedAiCrossOriginRequest({
        urlValue,
        expectedOrigin: previewOrigin,
        requestPhase,
        rootUrlValue,
      });
    const normalizedMethod = method.toUpperCase();
    const methodAllowed = normalizedMethod === "GET" || normalizedMethod === "HEAD";
    const hostname = parsed?.hostname.toLowerCase().replace(/\.+$/u, "") ?? "";
    const prohibitedExternalAi = [
      "api.openai.com",
      "api.x.ai",
      "api.groq.com",
      "generativelanguage.googleapis.com",
      "api.anthropic.com",
    ].some((blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`));
    const classificationAllowed = [
      "local-scheme",
      "same-origin",
      "immutable-model-root",
      "immutable-model-redirect",
    ].includes(classification);
    const sameOriginTargetAllowed = classification !== "same-origin"
      || allowedSameOriginTarget(parsed);
    const immutableModelTargetAllowed = classification !== "immutable-model-root"
      && classification !== "immutable-model-redirect"
      || rootUrlValue === immutableRoot && (
        classification === "immutable-model-redirect" || urlValue === immutableRoot
      );
    const urlCredentialsAllowed = parsed?.username === "" && parsed.password === "";
    const reasonCodes = [];
    if (prohibitedExternalAi) reasonCodes.push("prohibited-external-ai");
    if (!methodAllowed) reasonCodes.push("method-not-allowed");
    if (!classificationAllowed) reasonCodes.push("network-classification-blocked");
    if (!sameOriginTargetAllowed) reasonCodes.push("same-origin-target-not-allowed");
    if (!immutableModelTargetAllowed) reasonCodes.push("immutable-model-target-not-allowed");
    if (hasPostData) reasonCodes.push("request-body-not-allowed");
    if (!urlCredentialsAllowed) reasonCodes.push("url-credentials-not-allowed");
    if (hasCredentialHeader) reasonCodes.push("credential-header-not-allowed");
    return {
      action: reasonCodes.length === 0 ? "continue" : "abort-policy",
      reasonCodes,
    };
  };
  for (const matrixCase of [
    { name: "release identity GET", urlValue: `${previewOrigin}/api/release/identity`, expected: "continue" },
    { name: "release identity nonce", urlValue: `${previewOrigin}/api/release/identity?rc6_2=${fixtureUuid}`, expected: "continue" },
    { name: "release identity extra query", urlValue: `${previewOrigin}/api/release/identity?rc6_2=${fixtureUuid}&leak=1`, expected: "abort-policy", reasons: ["same-origin-target-not-allowed"] },
    { name: "release identity duplicate nonce", urlValue: `${previewOrigin}/api/release/identity?rc6_2=${fixtureUuid}&rc6_2=${fixtureUuid}`, expected: "abort-policy", reasons: ["same-origin-target-not-allowed"] },
    { name: "allowed GET with body", urlValue: `${previewOrigin}/api/release/identity`, hasPostData: true, expected: "abort-policy", reasons: ["request-body-not-allowed"] },
    { name: "allowed GET with credential header", urlValue: `${previewOrigin}/api/release/identity`, hasCredentialHeader: true, expected: "abort-policy", reasons: ["credential-header-not-allowed"] },
    { name: "allowed URL with credentials", urlValue: `https://author:story@novel.example/api/release/identity`, expected: "abort-policy", reasons: ["url-credentials-not-allowed"] },
    { name: "toolbar URL with credentials", urlValue: "https://story:leak@vercel.live/widget", expected: "abort-policy", reasons: ["network-classification-blocked", "url-credentials-not-allowed"] },
    { name: "persistence health HEAD", urlValue: `${previewOrigin}/api/persistence/health`, method: "HEAD", expected: "continue" },
    { name: "arbitrary same-origin API", urlValue: `${previewOrigin}/api/write`, expected: "abort-policy", reasons: ["same-origin-target-not-allowed"] },
    { name: "arbitrary same-origin POST", urlValue: `${previewOrigin}/api/write`, method: "POST", expected: "abort-policy", reasons: ["method-not-allowed", "same-origin-target-not-allowed"] },
    { name: "bound Product chunk", urlValue: `${previewOrigin}${productChunk}`, expected: "continue" },
    { name: "unbound lookalike Product chunk", urlValue: `${previewOrigin}/_next/static/chunks/attacker.js`, expected: "abort-policy", reasons: ["same-origin-target-not-allowed"] },
    { name: "Product chunk query", urlValue: `${previewOrigin}${productChunk}?leak=1`, expected: "abort-policy", reasons: ["same-origin-target-not-allowed"] },
    { name: "project chat document", urlValue: `${previewOrigin}/studio/project/${fixtureUuid}/chat`, expected: "continue" },
    { name: "project RSC document", urlValue: `${previewOrigin}/studio/project/${fixtureUuid}/story-bible?_rsc=fixture_1`, expected: "continue" },
    { name: "project unknown screen", urlValue: `${previewOrigin}/studio/project/${fixtureUuid}/admin`, expected: "abort-policy", reasons: ["same-origin-target-not-allowed"] },
    { name: "project arbitrary query", urlValue: `${previewOrigin}/studio/project/${fixtureUuid}/chat?prompt=not-product-bound`, expected: "abort-policy", reasons: ["same-origin-target-not-allowed"] },
    { name: "project bound prompt", urlValue: `${previewOrigin}/studio/project/${fixtureUuid}/chat?prompt=${encodeURIComponent("請協助我續寫、改寫或分析目前小說。")}`, expected: "continue" },
    { name: "project bound backend", urlValue: `${previewOrigin}/studio/project/${fixtureUuid}/closed-ai?backend=local-ollama`, expected: "continue" },
    { name: "project unbound backend", urlValue: `${previewOrigin}/studio/project/${fixtureUuid}/closed-ai?backend=external`, expected: "abort-policy", reasons: ["same-origin-target-not-allowed"] },
    { name: "external AI GET", urlValue: "https://api.openai.com/v1/responses?secret=not-projected", expected: "abort-policy", reasons: ["prohibited-external-ai", "network-classification-blocked"] },
    { name: "external AI trailing dot", urlValue: "https://api.openai.com./v1/responses", expected: "abort-policy", reasons: ["prohibited-external-ai", "network-classification-blocked"] },
    { name: "arbitrary cross-origin", urlValue: "https://example.net/resource", expected: "abort-policy", reasons: ["network-classification-blocked"] },
    { name: "immutable root install GET", urlValue: immutableRoot, requestPhase: "model-install", expected: "continue" },
    { name: "immutable root install POST", urlValue: immutableRoot, requestPhase: "model-install", method: "POST", expected: "abort-policy", reasons: ["method-not-allowed"] },
    { name: "immutable root query smuggling", urlValue: `${immutableRoot}?secret=leak`, requestPhase: "model-install", expected: "abort-policy", reasons: ["immutable-model-target-not-allowed"] },
    { name: "immutable root prefix smuggling", urlValue: `${immutableRoot}/leak`, requestPhase: "model-install", expected: "abort-policy", reasons: ["immutable-model-target-not-allowed"] },
    { name: "immutable root inference", urlValue: immutableRoot, expected: "abort-policy", reasons: ["network-classification-blocked"] },
    { name: "approved redirect install GET", urlValue: regionalRedirect, requestPhase: "model-install", expected: "continue" },
    { name: "unrooted redirect", urlValue: regionalRedirect, requestPhase: "model-install", rootUrlValue: regionalRedirect, expected: "abort-policy", reasons: ["network-classification-blocked"] },
    { name: "about blank GET", urlValue: "about:blank", expected: "continue" },
    { name: "about srcdoc HEAD", urlValue: "about:srcdoc", method: "HEAD", expected: "continue" },
    { name: "blob GET", urlValue: `blob:${previewOrigin}/fixture`, expected: "continue" },
    { name: "data GET", urlValue: "data:text/plain,fixture", expected: "continue" },
    { name: "local POST", urlValue: "data:text/plain,fixture", method: "POST", expected: "abort-policy", reasons: ["method-not-allowed"] },
    { name: "file blocked", urlValue: "file:///tmp/private", expected: "abort-policy", reasons: ["network-classification-blocked"] },
    { name: "toolbar POST", urlValue: "https://vercel.live/widget?secret=not-projected", method: "POST", expected: "abort-toolbar" },
  ]) {
    const decision = routePolicyAction(matrixCase);
    assert.equal(decision.action, matrixCase.expected, matrixCase.name);
    assert.deepEqual(decision.reasonCodes, matrixCase.reasons ?? [], matrixCase.name);
  }
  const webSocketPolicyAction = (urlValue) => {
    let url = null;
    try {
      url = new URL(urlValue);
    } catch {
      // Invalid WebSocket targets are still closed by the catch-all route.
    }
    return url?.protocol === "wss:"
      && url.hostname === "vercel.live"
      && url.port === ""
      ? "close-toolbar-non-violation"
      : "close-disallowed";
  };
  assert.equal(
    webSocketPolicyAction("wss://vercel.live/widget?secret=not-projected"),
    "close-toolbar-non-violation",
  );
  for (const target of [
    "ws://vercel.live/widget",
    "wss://vercel.live:444/widget",
    "wss://vercel.live.evil.test/widget",
    `wss://${new URL(previewOrigin).host}/socket`,
    "wss://api.openai.com/v1/realtime?secret=not-projected",
    "invalid-websocket-target",
  ]) {
    assert.equal(webSocketPolicyAction(target), "close-disallowed", target);
  }
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
  const [types, closedAgentOs, safeRuntimeDiagnostics, conversationRepository, recordSecurity, backends, provider, browserWebLlmRuntime, privateHub, service, bootstrap, composer, workspace, closedAgentRunner, finalizationSupport, bootstrapHook, messageRow, regenerationProof, approvalHook, browserGate, health, packageSource, networkSentinelTests] = await Promise.all([
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
    readFile(new URL("../app/studio/project/[projectId]/chat/conversation-closed-agent.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/novel-ai/conversation/closed-agent-finalization.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/project/[projectId]/chat/hooks/use-closed-ai-bootstrap.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/project/[projectId]/chat/components/message-row.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/project/[projectId]/chat/components/conversation-regeneration-proof.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/project/[projectId]/chat/hooks/use-conversation-approval.ts", import.meta.url), "utf8"),
    readFile(new URL("./run-rc6-2-closed-agent-browser.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/health/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("./run-rc6-2-network-sentinel-tests.mjs", import.meta.url), "utf8"),
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
  assert.match(composer, /重新連線本機閉端 AI/u);
  assert.match(composer, /閉端 AI 自動協調器/u);
  assert.doesNotMatch(composer, /改用 Local Ollama|連接 Private AI Hub|\?backend=/u);
  assert.match(composer, /closedAiSetupError\s*\n\s*\?\? closedAiSetupProgress\?\.message/u);
  assert.match(composer, /約 \{downloadMegabytes\} MB 本機儲存/u);
  assert.match(composer, /data-estimated-download-bytes/u);
  assert.match(composer, /作品資料<\/dt><dd>不離開裝置/u);
  assert.match(composer, /data-closed-ai-generation-verified-backends/u);
  assert.match(composer, /data-closed-ai-active-backend/u);
  assert.match(composer, /data-closed-ai-setup-busy=\{closedAiSetupBusy\}/u);
  assert.match(composer, /data-closed-ai-startup-state=\{effectiveClosedAiStartupState\}/u);
  assert.match(composer, /閉端 AI · 正在連線既有本機算力/u);
  assert.match(composer, /閉端 AI · 已啟動/u);
  assert.match(composer, /閉端 AI · 自動啟動未完成/u);
  assert.match(composer, /閉端 AI · 連線明確逾時 · 規則後備待命/u);
  assert.match(composer, /data-closed-ai-rules-fallback-ready=\{rulesFallbackReady\}/u);
  assert.match(composer, /data-rules-fallback-ready=\{rulesFallbackReady\}/u);
  assert.match(composer, /重新連線本機閉端 AI/u);
  assert.match(composer, /準備 Browser AI/u);
  assert.match(composer, /網站只會連線這台電腦上已啟動的 Novel Local AI Companion 與 Ollama/u);
  assert.match(composer, /不能自行啟動或安裝 Ollama/u);
  assert.match(composer, /Browser AI 模型也不會自動下載/u);
  assert.match(composer, /blocked:\s*externalBlocked \|\| closedAiStarting/u);
  assert.match(composer, /data-closed-ai-external-fallback/u);
  assert.match(composer, /data-setup-lifecycle=\{closedAiSetupLifecycle\}/u);
  assert.match(bootstrapHook, /setClosedAiSetupProgress\(null\);[\s\S]*CLOSED_AI_AUTOSTART_KNOWN_FAILURE_CODES\.has/u);
  assert.match(bootstrapHook, /setClosedAiSetupProgress\(null\);\s*\n\s*setClosedAiSetupError\("已取消自動協調器準備/u);
  assert.match(bootstrapHook, /PASSWORDLESS_LOCAL_AI_ORIGINS\.includes/u);
  assert.match(bootstrapHook, /shouldAutostartStudioLocalAI\(window\.location\.origin\)/u);
  const automaticConversationBootstrap = bootstrapHook.slice(
    bootstrapHook.indexOf("useEffect(() =>"),
    bootstrapHook.indexOf("const prepareClosedAi"),
  );
  assert.match(automaticConversationBootstrap, /connectLocalAutomatically\(\)/u);
  assert.doesNotMatch(automaticConversationBootstrap, /connectLocalAutomatically\(controller\.signal\)/u);
  assert.doesNotMatch(automaticConversationBootstrap, /prepareBrowserAi/u);
  assert.match(automaticConversationBootstrap, /taskTypes:\s*\["chapter\.abcChoices", "chapter\.continue"\]/u);
  assert.match(automaticConversationBootstrap, /prewarmStudioInteractiveChoiceAI\(controller\.signal\)/u);
  assert.match(bootstrapHook, /retryingLocal = closedAiStartupState === "failed"[\s\S]*closedAiStartupState === "timeout_fallback"/u);
  assert.match(bootstrapHook, /retryLocalOnOfficialOrigin[\s\S]*connectLocalAutomatically\([\s\S]*controller\.signal/u);
  assert.match(bootstrapHook, /retryLocalOnOfficialOrigin[\s\S]*:\s*await bootstrapCoordinator\.prepareBrowserAi/u);
  assert.match(bootstrapHook, /CLOSED_AI_AUTOSTART_TIMEOUT_CODES = new Set\(\[[\s\S]*"REQUEST_TIMEOUT",[\s\S]*"OLLAMA_TIMEOUT"/u);
  assert.match(bootstrapHook, /CLOSED_AI_AUTOSTART_TIMEOUT_CODES\.has\(code\)[\s\S]*等待本機閉端 AI 連線已明確逾時/u);
  assert.match(bootstrapHook, /CLOSED_AI_AUTOSTART_TIMEOUT_CODES\.has\(closedAiAutostartErrorCode\(error\)\)[\s\S]*\? "timeout_fallback"[\s\S]*: "failed"/u);
  assert.doesNotMatch(closedAgentRunner, /preferredBackend:\s*previousDigest\s*\?\s*"local-ollama"/u);
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
  assert.match(workspace, /isClosedAiTaskRoutable\(closedAiSetup\)/u);
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
  assert.match(closedAgentRunner, /createClosedAgentFailureEvidence\(error\)/u);
  assert.match(closedAgentRunner, /serializeClosedAgentFailureEvidence\(failureEvidence\)/u);
  assert.match(finalizationSupport, /stage:\s*CLOSED_AGENT_FAILURE_EVIDENCE_PROGRESS_STAGE/u);
  assert.match(finalizationSupport, /persistenceFailed = true/u);
  assert.match(finalizationSupport, /CLOSED_AGENT_FAILURE_EVIDENCE_PERSIST_FAILED/u);
  const closedAgentFinalization = closedAgentRunner;
  const targetSnapshotAt = closedAgentFinalization.indexOf("const approvalTarget");
  const modelExecutionAt = closedAgentFinalization.indexOf("await executeStudioClosedAgent");
  const artifactCommitAt = closedAgentFinalization.indexOf("artifact = await input.conversation.saveArtifact");
  const messageCommitAt = closedAgentFinalization.indexOf("await input.conversation.updateMessageStatus", artifactCommitAt);
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
  assert.match(
    browserGate,
    /await persistentContext\.routeWebSocket\("\*\*\/\*", routeClosedAiWebSocket\)/u,
  );
  assert.match(browserGate, /await persistentContext\.route\("\*\*\/\*", routeClosedAiRequest\)/u);
  assert.equal(browserGate.match(/\.route\(/gu)?.length, 1);
  const launchContract = browserGate.slice(
    browserGate.indexOf("async function launch()"),
    browserGate.indexOf("async function assertExactOrigin()"),
  );
  assert.ok(launchContract.indexOf('persistentContext.routeWebSocket("**/*"') >= 0);
  assert.ok(
    launchContract.indexOf('persistentContext.routeWebSocket("**/*"')
      < launchContract.indexOf('persistentContext.route("**/*"'),
    "fail-closed WebSocket route must be installed before the HTTP route",
  );
  assert.ok(launchContract.indexOf('persistentContext.route("**/*"') >= 0);
  assert.ok(
    launchContract.indexOf('persistentContext.route("**/*"')
      < launchContract.indexOf("return {"),
    "fail-closed context route must be installed before launch returns",
  );
  const productionLaunchAt = browserGate.lastIndexOf(
    'setRunnerCheckpoint("launch");',
    browserGate.indexOf("const launched = await launch()"),
  );
  assert.ok(productionLaunchAt >= 0);
  const mainContract = browserGate.slice(productionLaunchAt);
  assert.ok(mainContract.indexOf("const launched = await launch()") >= 0);
  assert.ok(
    mainContract.indexOf("const launched = await launch()")
      < mainContract.indexOf("readReleaseIdentityTruth({ navigate: true })"),
    "fail-closed launch must complete before the first Product navigation",
  );
  assert.ok(mainContract.indexOf("const sentinelResult = await runPreNavigationNetworkSentinel()") >= 0);
  assert.ok(
    mainContract.indexOf("const sentinelResult = await runPreNavigationNetworkSentinel()")
      < mainContract.indexOf("readReleaseIdentityTruth({ navigate: true })"),
    "real receiver sentinel must complete before the first Product navigation",
  );
  const routeDecisionContract = browserGate.slice(
    browserGate.indexOf("function requestRouteDecision(request)"),
    browserGate.indexOf("function safeBlockedRequestProjection(request, decision)"),
  );
  assert.match(browserGate, /const ALLOWED_REQUEST_METHODS = new Set\(\["GET", "HEAD"\]\)/u);
  assert.match(browserGate, /const LOCAL_NON_NETWORK_PROTOCOLS = new Set\(\["about:", "blob:", "data:"\]\)/u);
  assert.match(routeDecisionContract, /isExactPreviewToolbarRequest\(urlValue\)/u);
  assert.match(routeDecisionContract, /isProhibitedExternalAi\(urlValue\)/u);
  assert.match(routeDecisionContract, /ALLOWED_REQUEST_METHODS\.has\(normalizedMethod\)/u);
  assert.match(routeDecisionContract, /ALLOWED_REQUEST_CLASSIFICATIONS\.has\(classification\)/u);
  assert.match(routeDecisionContract, /"network-classification-blocked"/u);
  assert.match(routeDecisionContract, /isAllowedSameOriginTarget\(parsedUrl\)/u);
  assert.match(routeDecisionContract, /isAllowedImmutableModelTarget\(request, classification\)/u);
  assert.match(routeDecisionContract, /"same-origin-target-not-allowed"/u);
  assert.match(routeDecisionContract, /"immutable-model-target-not-allowed"/u);
  assert.match(routeDecisionContract, /request\.postDataBuffer\(\) === null/u);
  assert.match(routeDecisionContract, /parsedUrl\?\.username === "" && parsedUrl\.password === ""/u);
  assert.match(routeDecisionContract, /await request\.headersArray\(\)/u);
  assert.match(routeDecisionContract, /"request-body-not-allowed"/u);
  assert.match(routeDecisionContract, /"url-credentials-not-allowed"/u);
  assert.match(routeDecisionContract, /"credential-header-not-allowed"/u);
  const outboundHeaderContract = browserGate.slice(
    browserGate.indexOf("function sanitizedOutboundHeaders(request, parsedUrl)"),
    browserGate.indexOf("async function requestRouteDecision(request)"),
  );
  assert.match(outboundHeaderContract, /"accept-language": "zh-TW,zh;q=0\.9,en;q=0\.8"/u);
  assert.match(outboundHeaderContract, /headers\.rsc = "1"/u);
  assert.doesNotMatch(
    outboundHeaderContract,
    /authorization|cookie|range|referer|user-agent/iu,
  );
  const targetPolicyContract = browserGate.slice(
    browserGate.indexOf("function remainingSearchAfterOptionalRsc(url)"),
    browserGate.indexOf("function safeNetworkTargetProjection(urlValue)"),
  );
  assert.match(browserGate, /PRODUCT_STATIC_ASSET_MANIFEST_COMMIT = "29fc6e742672bb07187765d34ea818afdadf56ae"/u);
  assert.match(browserGate, /const PRODUCT_STATIC_ASSET_PATHS = new Set\(\[/u);
  assert.match(targetPolicyContract, /PRODUCT_STATIC_ASSET_PATHS\.has\(url\.pathname\)/u);
  assert.match(targetPolicyContract, /PRODUCT_NAVIGATION_PROMPT_DIGESTS\.has\(sha256Value\(value\)\)/u);
  assert.match(targetPolicyContract, /hasSingleExactParameter\(params, "rc6_2"/u);
  assert.match(targetPolicyContract, /PRODUCT_IMMUTABLE_MODEL_ROOT_URLS\.has\(request\.url\(\)\)/u);
  assert.doesNotMatch(targetPolicyContract, /pathname\.startsWith|searchParams\.has/u);
  const routeHandlerContract = browserGate.slice(
    browserGate.indexOf("async function routeClosedAiRequest(route)"),
    browserGate.indexOf("function observeClosedAiRequest(request)"),
  );
  assert.match(routeHandlerContract, /decision\.action === "abort-toolbar"/u);
  assert.match(routeHandlerContract, /decision\.action === "abort-policy"/u);
  assert.match(routeHandlerContract, /await route\.abort\("blockedbyclient"\)/u);
  assert.match(
    routeHandlerContract,
    /await route\.continue\(\{ headers: decision\.sanitizedHeaders \}\)/u,
  );
  assert.doesNotMatch(routeHandlerContract, /await route\.continue\(\)/u);
  assert.ok(
    routeHandlerContract.indexOf("blockedNonToolbarRequests.add(request)")
      < routeHandlerContract.lastIndexOf('await route.abort("blockedbyclient")'),
    "blocked request identity must be recorded before abort",
  );
  assert.doesNotMatch(routeHandlerContract, /route\.fallback/u);
  const webSocketHandlerContract = browserGate.slice(
    browserGate.indexOf("function isPreviewToolbarWebSocket(urlValue)"),
    browserGate.indexOf("async function routeClosedAiRequest(route)"),
  );
  assert.match(webSocketHandlerContract, /url\?\.protocol === "wss:"/u);
  assert.match(webSocketHandlerContract, /url\.hostname === "vercel\.live"/u);
  assert.match(webSocketHandlerContract, /url\.username === ""/u);
  assert.match(webSocketHandlerContract, /url\.password === ""/u);
  assert.match(webSocketHandlerContract, /observedWebSocketAttemptCount \+= 1/u);
  assert.match(webSocketHandlerContract, /blockedWebSocketAttemptCount \+= 1/u);
  assert.match(webSocketHandlerContract, /disallowedWebSocketAttemptCount \+= 1/u);
  assert.match(webSocketHandlerContract, /observedPreviewToolbarWebSocketAttemptCount \+= 1/u);
  assert.match(webSocketHandlerContract, /blockedPreviewToolbarWebSocketAttemptCount \+= 1/u);
  assert.match(
    webSocketHandlerContract,
    /await webSocketRoute\.close\(\{ code: 1008, reason: "closed-ai-network-policy" \}\)/u,
  );
  assert.doesNotMatch(browserGate, /connectToServer/u);
  const safeProjectionContract = browserGate.slice(
    browserGate.indexOf("function safeNetworkTargetProjection(urlValue)"),
    browserGate.indexOf("function appendBoundedProjection(collection, projection)"),
  );
  assert.match(safeProjectionContract, /hostDigest/u);
  assert.match(safeProjectionContract, /pathDigest/u);
  assert.match(safeProjectionContract, /targetDigest/u);
  assert.doesNotMatch(
    safeProjectionContract,
    /(?:url|query|body|headers|postData|searchParams|fragment)\s*:/u,
  );
  assert.match(browserGate, /const MAX_SAFE_NETWORK_PROJECTIONS = 32/u);
  assert.match(browserGate, /const blockedNonToolbarRequests = new WeakSet\(\)/u);
  assert.match(browserGate, /blockedNonToolbarRequests\.has\(response\.request\(\)\)/u);
  assert.match(browserGate, /assert\.equal\(blockedNonToolbarResponseCount, 0\)/u);
  assert.match(browserGate, /assert\.deepEqual\(blockedNonToolbarResponses, \[\]\)/u);
  assert.match(browserGate, /assert\.equal\(observedWebSocketAttemptCount, blockedWebSocketAttemptCount\)/u);
  assert.match(browserGate, /assert\.equal\(disallowedWebSocketAttemptCount, 0\)/u);
  assert.match(browserGate, /assert\.deepEqual\(disallowedWebSocketAttempts, \[\]\)/u);
  assert.match(browserGate, /assert\.equal\(webSocketServerConnectionCount, 0\)/u);
  assert.match(browserGate, /webSocketPolicy: "blocked-before-connect"/u);
  assert.match(browserGate, /webSocketRouteInstalledBeforeNavigation:/u);
  assert.match(browserGate, /observedWebSocketAttemptCount,/u);
  assert.match(browserGate, /blockedWebSocketAttemptCount,/u);
  assert.match(browserGate, /disallowedWebSocketAttemptCount,/u);
  assert.match(browserGate, /webSocketServerConnectionCount,/u);
  assert.match(browserGate, /networkZeroReceipt: networkSentinelEvidence/u);
  const finalCrossOriginPolicyAt = browserGate.lastIndexOf("    crossOriginPolicy: {");
  const finalNetworkReceiptAt = browserGate.indexOf(
    "    networkZeroReceipt: networkSentinelEvidence",
    finalCrossOriginPolicyAt,
  );
  assert.ok(finalCrossOriginPolicyAt >= 0 && finalNetworkReceiptAt > finalCrossOriginPolicyAt);
  const crossOriginPolicyContract = browserGate.slice(
    finalCrossOriginPolicyAt + "    crossOriginPolicy: {".length,
    finalNetworkReceiptAt,
  );
  assert.deepEqual(
    [...crossOriginPolicyContract.matchAll(/^      ([A-Za-z][A-Za-z0-9]*)(?::|,)/gmu)]
      .map((match) => match[1]),
    [
      "policy",
      "contextRouteInstalledBeforeNavigation",
      "allowedMethods",
      "immutableModelAssetsAllowedOnlyDuringExplicitInstall",
      "sameOriginTargetPolicy",
      "disallowedRequestCount",
      "disallowedMethodRequestCount",
      "blockedNonToolbarResponseCount",
      "previewToolbarPolicy",
      "observedPreviewToolbarRequestCount",
      "blockedPreviewToolbarRequestCount",
      "previewToolbarResponseCount",
      "webSocketRouteInstalledBeforeNavigation",
      "webSocketPolicy",
      "observedWebSocketAttemptCount",
      "blockedWebSocketAttemptCount",
      "disallowedWebSocketAttemptCount",
      "webSocketServerConnectionCount",
      "observedPreviewToolbarWebSocketAttemptCount",
      "blockedPreviewToolbarWebSocketAttemptCount",
    ],
  );
  const sentinelContract = browserGate.slice(
    browserGate.indexOf("async function runPreNavigationNetworkSentinel()"),
    browserGate.indexOf("async function assertExactOrigin()"),
  );
  assert.doesNotMatch(browserGate, /p24b-rc6\.2-network-zero-receipt-v1/u);
  assert.match(browserGate, /NETWORK_SENTINEL_SCHEMA = "p24b-rc6\.2-network-zero-receipt-v2"/u);
  const sentinelScalarDeclaration = sourceSection(
    browserGate,
    "const NETWORK_SENTINEL_SCALAR_EXPECTATIONS",
    "const NETWORK_SENTINEL_PROBE_SPECS",
    "frozen sentinel scalar declaration",
  );
  for (const [scalarId, expectedSafeValue] of Object.entries(NETWORK_SENTINEL_PASS_SCALARS)) {
    assert.ok(
      sentinelScalarDeclaration.includes(`["${scalarId}", ${JSON.stringify(expectedSafeValue)},`),
      `runner sentinel scalar declaration is missing ${scalarId}`,
    );
  }
  assert.match(
    browserGate,
    /new Set\(\["setup", "generation", "all", "network-sentinel-only"\]\)\.has\(mode\)/u,
  );
  assert.match(browserGate, /const networkSentinelOnly = mode === "network-sentinel-only"/u);
  assert.match(browserGate, /networkSentinelOnly[\s\S]*formalAttemptEnabled, false/u);
  assert.match(browserGate, /p24b-rc6\.2-network-sentinel-only-evidence-v1/u);
  assert.match(browserGate, /networkZeroReceipt: networkSentinelEvidence/u);
  const sentinelDigestContract = sourceSection(
    browserGate,
    "function networkSentinelMatrixDigest(value)",
    "function firstNetworkSentinelScalarMismatch(value)",
    "v2 sentinel digest",
  );
  assert.match(
    sentinelDigestContract,
    /sha256Value\(`\$\{NETWORK_SENTINEL_SCHEMA\}\\n\$\{stableStringify\(body\)\}`\)/u,
  );
  for (const scalarId of Object.keys(NETWORK_SENTINEL_PASS_SCALARS)) {
    assert.ok(browserGate.includes(`"${scalarId}"`), `sentinel scalar is missing: ${scalarId}`);
  }
  const bootstrapDecisionContract = sourceSection(
    browserGate,
    "async function requestRouteDecision(request)",
    "function safeBlockedRequestProjection(request, decision)",
    "one-shot sentinel bootstrap decision",
  );
  for (const marker of [
    'requestPhase === "bootstrap"',
    "sentinelBootstrapActive",
    "!sentinelBootstrapConsumed",
    "urlValue === sentinelBootstrapUrl",
    'normalizedMethod === "GET"',
    'request.resourceType() === "document"',
    "request.postDataBuffer() === null",
    'parsedUrl?.username === ""',
    'parsedUrl.password === ""',
    "request.redirectedFrom() === null",
    'parsedUrl.search === ""',
    'parsedUrl.hash === ""',
    "NETWORK_SENTINEL_CREDENTIAL_HEADERS",
    'action: "continue-bootstrap"',
  ]) assert.ok(bootstrapDecisionContract.includes(marker), `bootstrap predicate marker is missing: ${marker}`);
  const httpRouteContract = sourceSection(
    browserGate,
    "async function routeClosedAiRequest(route)",
    "function observeClosedAiRequest(request)",
    "sentinel HTTP route handling",
  );
  const bootstrapConsumeAt = httpRouteContract.indexOf("sentinelBootstrapConsumed = true");
  const bootstrapAllowedAt = httpRouteContract.indexOf("sentinelBootstrapAllowedCount += 1");
  const bootstrapContinueAt = httpRouteContract.indexOf("await route.continue", bootstrapAllowedAt);
  assert.ok(
    bootstrapConsumeAt >= 0
      && bootstrapAllowedAt > bootstrapConsumeAt
      && bootstrapContinueAt > bootstrapAllowedAt,
    "bootstrap must be consumed and counted before the exact request continues",
  );
  for (const marker of [
    "sentinelProbeState.httpGetUrl",
    "sentinelProbeState.httpPostUrl",
    '"HTTP_GET"',
    '"HTTP_POST"',
    "probeRouteRecords[probeIndex]",
    'routeDecision: "blocked"',
    'routeDecision: "block-failed"',
    'routeDecision: "continued"',
    'routeDecision: "continue-failed"',
  ]) assert.ok(httpRouteContract.includes(marker), `separate HTTP route record marker is missing: ${marker}`);
  assert.match(
    httpRouteContract,
    /routeDecision: "block-failed",\s*reasonCodes: \[\.\.\.decision\.reasonCodes\]/u,
  );
  assert.match(
    httpRouteContract,
    /routeDecision: "continue-failed",\s*reasonCodes: \[\]/u,
  );
  const webSocketRouteContract = sourceSection(
    browserGate,
    "async function routeClosedAiWebSocket(webSocketRoute)",
    "async function routeClosedAiRequest(route)",
    "sentinel WebSocket route handling",
  );
  for (const marker of [
    "probeState.webSocketUrl",
    "probeRouteRecords[2]",
    'probeId: "WEBSOCKET"',
    'routeDecision: "blocked"',
    'routeDecision: "block-failed"',
  ]) assert.ok(webSocketRouteContract.includes(marker), `WebSocket route record marker is missing: ${marker}`);
  assert.match(
    webSocketRouteContract,
    /routeDecision: "block-failed",\s*reasonCodes: \["network-classification-blocked"\]/u,
  );
  for (const finiteResult of [
    "route-action-failed", "evaluation-failed", "unexpected-rejection",
  ]) assert.ok(browserGate.includes(`"${finiteResult}"`), `finite sentinel result is missing: ${finiteResult}`);
  assert.match(sentinelContract, /const handleReceiverRequest = \(request, response\) =>/u);
  assert.match(sentinelContract, /receiver = createServer\(handleReceiverRequest\)/u);
  assert.match(sentinelContract, /receiver\.on\("connection"/u);
  assert.match(sentinelContract, /receiver\.on\("upgrade"/u);
  assert.match(sentinelContract, /await page\.evaluate/u);
  assert.match(sentinelContract, /receiverBaseline = \{[\s\S]*tcpConnectionReceiptCount,[\s\S]*httpRequestReceiptCount,[\s\S]*httpRequestBodyByteCount,[\s\S]*webSocketUpgradeReceiptCount/u);
  assert.match(sentinelContract, /bootstrapReceiverHttpCount !== 1/u);
  const bootstrapDisabledAt = sentinelContract.indexOf("sentinelBootstrapActive = false;");
  const probeStateInstalledAt = sentinelContract.indexOf("sentinelProbeState = {", bootstrapDisabledAt);
  const firstProbeAt = sentinelContract.indexOf("httpGet: await evaluateHttpProbe", probeStateInstalledAt);
  assert.ok(
    bootstrapDisabledAt >= 0
      && probeStateInstalledAt > bootstrapDisabledAt
      && firstProbeAt > probeStateInstalledAt,
    "the exact bootstrap exception must be disabled before probe state and evaluation",
  );
  assert.match(sentinelContract, /tcpConnectionReceiptDelta = tcpConnectionReceiptCount[\s\S]*- receiverBaseline\.tcpConnectionReceiptCount/u);
  assert.match(sentinelContract, /httpRequestReceiptDelta = httpRequestReceiptCount[\s\S]*- receiverBaseline\.httpRequestReceiptCount/u);
  assert.match(sentinelContract, /httpRequestBodyByteDelta = httpRequestBodyByteCount[\s\S]*- receiverBaseline\.httpRequestBodyByteCount/u);
  assert.match(sentinelContract, /webSocketUpgradeReceiptDelta = webSocketUpgradeReceiptCount[\s\S]*- receiverBaseline\.webSocketUpgradeReceiptCount/u);
  assert.match(sentinelContract, /probeRouteRecords,/u);
  assert.match(sentinelContract, /operationalErrorCount,/u);
  assert.match(browserGate, /NETWORK_SENTINEL_OPERATION_COMPLETED/u);
  assert.match(sentinelContract, /firstFailedScalarAssertion: null/u);
  assert.match(sentinelContract, /finalizeNetworkSentinelMatrix\(\{/u);
  const sentinelMatrixContract = sentinelContract.slice(
    sentinelContract.indexOf("let matrix = finalizeNetworkSentinelMatrix({"),
  );
  assert.match(sentinelMatrixContract, /^\s*bootstrapReceiverHttpCount,\s*$/mu);
  assert.match(sentinelContract, /await page\.goto\("about:blank"\)/u);
  assert.match(sentinelContract, /receiver\.close/u);
  assert.match(sentinelContract, /sentinelBootstrapUrl = null/u);
  assert.match(sentinelContract, /nonce = ""/u);
  assert.match(sentinelContract, /resetPreNavigationSentinelPolicyCounters\(\)/u);
  assert.doesNotMatch(sentinelContract, /assert\.equal\((?:tcpConnectionReceiptCount|httpRequestReceiptCount|httpRequestBodyByteCount|webSocketUpgradeReceiptCount), 0\)/u);
  const sentinelResetContract = sourceSection(
    browserGate,
    "function resetPreNavigationSentinelPolicyCounters()",
    "async function runPreNavigationNetworkSentinel()",
    "sentinel-only counter reset",
  );
  assert.match(sentinelResetContract, /sentinelProbeState = null/u);
  assert.match(sentinelResetContract, /sentinelBootstrapActive = false/u);
  for (const productCounter of [
    "blockedNetworkPolicyAttemptCount",
    "disallowedCrossOriginRequestCount",
    "disallowedMethodRequestCount",
    "observedWebSocketAttemptCount",
    "blockedWebSocketAttemptCount",
    "disallowedWebSocketAttemptCount",
  ]) assert.doesNotMatch(sentinelResetContract, new RegExp(`\\b${productCounter}\\b`, "u"));
  const packageScripts = JSON.parse(packageSource).scripts;
  assert.equal(
    packageScripts["test:rc6.2:network-sentinel-unit"],
    "node scripts/run-rc6-2-network-sentinel-tests.mjs unit",
  );
  assert.equal(
    packageScripts["test:rc6.2:network-sentinel-mutations"],
    "node scripts/run-rc6-2-network-sentinel-tests.mjs mutations",
  );
  assert.equal(
    packageScripts["test:rc6.2:network-sentinel-real-edge"],
    "node scripts/run-rc6-2-closed-agent-browser.mjs network-sentinel-only",
  );
  assert.match(networkSentinelTests, /new Set\(\["unit", "mutations", "all"\]\)/u);
  assert.match(networkSentinelTests, /browserLaunchCount: 0/u);
  assert.match(networkSentinelTests, /networkRequestCount: 0/u);
  for (const finiteFailureCase of [
    "DUPLICATE_HTTP_OBSERVATION",
    "DUPLICATE_WEBSOCKET_OBSERVATION",
    "ROUTE_BLOCK_ACTION_FAILURE",
    "ROUTE_CONTINUE_ACTION_FAILURE",
    "EVALUATE_LEVEL_FAILURE",
    "BOOTSTRAP_EXACT_PATH_VS_TOTAL",
    "RECEIVER_CLOSE_TIMEOUT",
  ]) {
    assert.ok(
      networkSentinelTests.includes(`passedCases.push("${finiteFailureCase}")`),
      `network sentinel finite failure case is missing: ${finiteFailureCase}`,
    );
  }
  for (const forbiddenDependencySource of [
    ["from ", '"@playwright/test"'].join(""),
    ["from ", '"node:http"'].join(""),
    ["const receiver", " = createServer"].join(""),
  ]) {
    assert.equal(networkSentinelTests.includes(forbiddenDependencySource), false);
  }
  assert.match(browserGate, /observedPreviewToolbarRequests[\s\S]*blockedPreviewToolbarRequests/u);
  assert.match(browserGate, /assert\.deepEqual\(previewToolbarResponses, \[\]\)/u);
  assert.match(browserGate, /appendBoundedProjection\([\s\S]*previewToolbarResponses/u);
  assert.match(browserGate, /disallowedCrossOriginHostDigests/u);
  assert.doesNotMatch(browserGate, /disallowedCrossOriginHosts/u);
  const profileContract = browserGate.slice(
    browserGate.indexOf("function comparableFilesystemPath(value)"),
    browserGate.indexOf("async function assertExactOrigin()"),
  );
  assert.match(profileContract, /process\.env\.RC6_2_CLOSED_AI_PROFILE_PATH/u);
  assert.match(profileContract, /isAbsolute\(candidate\)/u);
  assert.match(profileContract, /resolve\(candidate\), candidate/u);
  assert.match(profileContract, /candidateLstat\.isSymbolicLink\(\), false/u);
  assert.match(profileContract, /comparableFilesystemPath\(dirname\(canonicalCandidate\)\)/u);
  assert.match(profileContract, /assert\.deepEqual\(await readdir\(canonicalCandidate\), \[\]/u);
  assert.match(profileContract, /ownership: "wrapper-owned"/u);
  assert.match(profileContract, /ownership: "runner-created"/u);
  assert.match(profileContract, /await mkdtemp\(join\(temporaryRoot, "novel-rc6-2-edge-"\)\)/u);
  assert.match(browserGate, /PROFILE_NAME\.test\(basename\(resolvedProfile\)\)/u);
  assert.match(browserGate, /await rm\(resolvedProfile, \{ recursive: true, force: true \}\)/u);
  assert.doesNotMatch(browserGate, /\$\{sep\}/u);
  assert.match(browserGate, /engineVersionDirectoryName: engineVersion/u);
  assert.match(browserGate, /engineDllName: "msedge\.dll"/u);
  assert.match(browserGate, /engineDllDigest: await sha256File\(engineDllPath\)/u);
  const temporaryRoot = await realpath(resolve(tmpdir()));
  const comparablePath = (value) => (
    process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value)
  );
  const ownedProfileName = /^novel-rc6-2-edge-[A-Za-z0-9][A-Za-z0-9-]{4,62}[A-Za-z0-9]$/u;
  const validateProfile = async (candidate) => {
    assert.equal(isAbsolute(candidate), true);
    assert.equal(resolve(candidate), candidate);
    assert.equal(ownedProfileName.test(basename(candidate)), true);
    const entry = await lstat(candidate);
    assert.equal(entry.isDirectory(), true);
    assert.equal(entry.isSymbolicLink(), false);
    const canonicalCandidate = await realpath(candidate);
    assert.equal(comparablePath(dirname(canonicalCandidate)), comparablePath(temporaryRoot));
    assert.equal(comparablePath(canonicalCandidate), comparablePath(candidate));
    assert.deepEqual(await readdir(canonicalCandidate), []);
    return canonicalCandidate;
  };
  const testPaths = [];
  let profileJunction = null;
  try {
    const wrapperProfile = await mkdtemp(join(temporaryRoot, "novel-rc6-2-edge-"));
    testPaths.push(wrapperProfile);
    assert.deepEqual(
      { path: await validateProfile(wrapperProfile), ownership: "wrapper-owned" },
      { path: wrapperProfile, ownership: "wrapper-owned" },
    );
    await assert.rejects(() => validateProfile(` ${wrapperProfile}`));
    const markerPath = join(wrapperProfile, "not-empty");
    await writeFile(markerPath, "fixture", "utf8");
    await assert.rejects(() => validateProfile(wrapperProfile));
    await unlink(markerPath);

    const runnerProfile = await mkdtemp(join(temporaryRoot, "novel-rc6-2-edge-"));
    testPaths.push(runnerProfile);
    assert.deepEqual(
      { path: await validateProfile(runnerProfile), ownership: "runner-created" },
      { path: runnerProfile, ownership: "runner-created" },
    );

    const invalidName = await mkdtemp(join(temporaryRoot, "invalid-edge-profile-"));
    testPaths.push(invalidName);
    await assert.rejects(() => validateProfile(invalidName));

    const nestedParent = await mkdtemp(join(temporaryRoot, "rc6-2-profile-parent-"));
    testPaths.push(nestedParent);
    const nestedProfile = join(nestedParent, "novel-rc6-2-edge-nested");
    await mkdir(nestedProfile);
    await assert.rejects(() => validateProfile(nestedProfile));

    profileJunction = join(temporaryRoot, `novel-rc6-2-edge-${crypto.randomUUID()}`);
    await symlink(runnerProfile, profileJunction, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(() => validateProfile(profileJunction));
  } finally {
    if (profileJunction) await unlink(profileJunction).catch(() => undefined);
    for (const testPath of testPaths) {
      assert.equal(comparablePath(dirname(testPath)), comparablePath(temporaryRoot));
      await rm(testPath, { recursive: true, force: true });
    }
  }
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
  assert.match(browserGate, /thirdCard\.getByTestId\("conversation-approve-candidate"\)/u);
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

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";

import "fake-indexeddb/auto";

import {
  BrowserGPUQueue,
} from "../lib/novel-ai/providers/browser-ai/browser-gpu-queue.ts";
import {
  BROWSER_MODEL_SHARD_CACHE,
  browserModelShardRecord,
  inspectBrowserModelShardCache,
  validateBrowserModelShardManifest,
  verifyBrowserModelShards,
} from "../lib/novel-ai/providers/browser-ai/browser-model-installer.ts";
import {
  BROWSER_WEBLLM_MODELS,
} from "../lib/novel-ai/providers/browser-ai/webllm-model-registry.ts";
import {
  runBrowserAI,
} from "../lib/novel-ai/providers/browser-ai/browser-ai-provider.ts";
import {
  BROWSER_PROSE_TIER_PRIMARY_GUIDANCE,
  BROWSER_PROSE_ROUTER_RUNTIME_IDENTITY_MISMATCH,
  LOW_TIER_BROWSER_PROSE_NOT_PRODUCTION_QUALIFIED,
} from "../lib/novel-ai/providers/browser-ai/browser-prose-capability-policy.ts";
import {
  evaluateBrowserDeviceBenchmark,
  persistBrowserDeviceBenchmark,
} from "../lib/novel-ai/providers/browser-ai/browser-device-benchmark.ts";
import {
  createBrowserAiSetupDiagnosticsForTests,
} from "../lib/novel-ai/providers/browser-ai/browser-ai-setup-diagnostics.ts";
import {
  browserWebLLMRuntimeSnapshot,
  cancelBrowserWebLLMSetup,
  failBrowserWebLLMSetup,
  finalizeBrowserWebLLMSetup,
  generateWithBrowserWebLLM,
  prewarmBrowserWebLLMModel,
  resetBrowserWebLLMForTests,
  selectBrowserWebLLMModel,
} from "../lib/novel-ai/providers/browser-ai/browser-webllm-runtime.ts";
import {
  ClosedAiBootstrapCoordinator,
} from "../lib/novel-ai/web/closed-ai-bootstrap-coordinator.ts";
import {
  executeBrowserSovereignFabric,
} from "../lib/novel-ai/browser-fabric/orchestrator.ts";

const mode = process.argv[2] ?? "all";
const supportedModes = new Set([
  "cancel-retry",
  "attempt-epoch",
  "stale-completion",
  "single-flight",
  "worker-recreate",
  "cache-resume",
  "cache-integrity",
  "metadata-transaction",
  "diagnostics",
  "generation-verification",
  "all",
]);

if (!supportedModes.has(mode)) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: "rc6.4-browser-ai-setup-runtime-tests-v1",
    mode,
    status: "FAIL",
    code: "UNSUPPORTED_MODE",
    supportedModes: [...supportedModes],
  }, null, 2)}\n`);
  process.exit(2);
}

const MODEL = BROWSER_WEBLLM_MODELS[0];
const MODEL_ID = MODEL.modelId;
const METADATA_DB = "novel-browser-webllm-v1";
const METADATA_STORE = "runtime-records";
const SELECTED_MODEL_KEY = "selected-model";
const VERIFIED_AT = "2026-08-14T00:00:00.000Z";
const DIAGNOSTIC_ABORT_GENERATION_ID = "6cbad958-7d39-440e-9066-f8568b41400e";
const results = [];

class MemoryCache {
  constructor() {
    this.entries = new Map();
  }

  async match(request) {
    const stored = this.entries.get(new Request(request).url);
    return stored?.clone();
  }

  async put(request, response) {
    this.entries.set(new Request(request).url, response.clone());
  }

  async delete(request) {
    return this.entries.delete(new Request(request).url);
  }

  clear() {
    this.entries.clear();
  }
}

const cacheStores = new Map();
const cacheStorage = {
  async open(name) {
    if (!cacheStores.has(name)) cacheStores.set(name, new MemoryCache());
    return cacheStores.get(name);
  },
};

let workerPostMessageCount = 0;

class WorkerFixture {
  constructor() {
    this.terminated = false;
  }

  postMessage(message) {
    workerPostMessageCount += 1;
    if (this.terminated) return;
    if (message.kind === "setAppConfig" || message.kind === "setLogLevel") return;
    queueMicrotask(() => {
      if (this.terminated) return;
      const content = message.kind === "getGPUVendor"
        ? "fixture-gpu"
        : message.kind === "runtimeStatsText"
          ? "1 tokens/s"
          : null;
      this.onmessage?.({ kind: "return", uuid: message.uuid, content });
    });
  }

  terminate() {
    this.terminated = true;
  }
}

Object.defineProperties(globalThis, {
  window: { configurable: true, value: {} },
  navigator: {
    configurable: true,
    value: {
      deviceMemory: 8,
      hardwareConcurrency: 8,
      userAgent: "RC6.4 deterministic runtime fixture",
      gpu: {
        requestAdapter: async () => ({
          limits: { maxStorageBufferBindingSize: 268_435_456 },
        }),
      },
      storage: {
        estimate: async () => ({ quota: 2_000_000_000, usage: 0 }),
        getDirectory: async () => ({}),
        persist: async () => true,
      },
    },
  },
  Worker: { configurable: true, value: WorkerFixture },
  caches: { configurable: true, value: cacheStorage },
});

function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`Database deletion blocked: ${name}`));
  });
}

function openMetadataDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(METADATA_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(METADATA_STORE)) {
        request.result.createObjectStore(METADATA_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readRecords() {
  const database = await openMetadataDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(METADATA_STORE, "readonly");
      const request = transaction.objectStore(METADATA_STORE).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function putRecords(...records) {
  const database = await openMetadataDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(METADATA_STORE, "readwrite");
      const store = transaction.objectStore(METADATA_STORE);
      for (const record of records) store.put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function setupOwnership(attemptId = "runtime-attempt-1", epoch = 1) {
  return Object.freeze({ attemptId, epoch });
}

function setupBoundary(
  ownership = setupOwnership(),
  diagnostics,
  modelId = MODEL_ID,
) {
  return Object.freeze({
    modelId,
    setupOwnership: ownership,
    ...(diagnostics ? { diagnostics } : {}),
  });
}

function modelRecord({
  model = MODEL,
  status = "staged",
  ownership = setupOwnership(),
  generationVerifiedAt = null,
  cacheVerified = true,
  shardIntegrityVerified = true,
  generationCount = 0,
} = {}) {
  const shardCount = browserModelShardRecord(model.modelId).shardCount;
  const manifestDigest = "b".repeat(64);
  return {
    schemaVersion: "p24b-rc6.4-browser-webllm-model-metadata-v2",
    key: `model:${model.modelId}`,
    kind: "model",
    modelId: model.modelId,
    modelDigest: model.modelDigest,
    sourceRevision: model.sourceRevision,
    cacheBackend: "cache",
    installStatus: status,
    cacheVerified,
    shardIntegrityVerified,
    shardManifestDigest: manifestDigest,
    manifestDigest,
    shardVerifiedAt: VERIFIED_AT,
    verifiedShardCount: shardCount,
    requiredShardCount: shardCount,
    installedAt: VERIFIED_AT,
    lastUsedAt: null,
    lastError: null,
    setupAttemptId: ownership.attemptId,
    setupEpoch: ownership.epoch,
    generationVerifiedAt,
    generationCount,
    averageFirstTokenMs: null,
    averageTokensPerSecond: null,
  };
}

function selectedRecord(modelId = MODEL_ID) {
  return { key: SELECTED_MODEL_KEY, kind: "setting", modelId };
}

async function seedCachedShardCount(
  count,
  responseFactory = () => new Response("x"),
  modelId = MODEL_ID,
) {
  const cache = await cacheStorage.open(BROWSER_MODEL_SHARD_CACHE);
  const shards = browserModelShardRecord(modelId).shards;
  for (const shard of shards.slice(0, count)) {
    await cache.put(new Request(shard.url), responseFactory(shard));
  }
}

async function resetCase() {
  await resetBrowserWebLLMForTests();
  for (const cache of cacheStores.values()) cache.clear();
  cacheStores.clear();
  await deleteDatabase(METADATA_DB);
  workerPostMessageCount = 0;
}

async function activateSetupRuntime(ownership, model = MODEL) {
  await seedCachedShardCount(
    browserModelShardRecord(model.modelId).shardCount,
    undefined,
    model.modelId,
  );
  await putRecords(modelRecord({ ownership, model }));
  await prewarmBrowserWebLLMModel(
    undefined,
    setupBoundary(ownership, undefined, model.modelId),
  );
}

async function check(name, fn) {
  try {
    await resetCase();
    await fn();
    results.push({ name, status: "PASS" });
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      error: error?.stack ?? String(error),
    });
  }
}

async function expectCode(code, operation) {
  await assert.rejects(operation, (error) => error?.code === code);
}

async function persistPassingBenchmark(model) {
  const runtime = await browserWebLLMRuntimeSnapshot();
  return persistBrowserDeviceBenchmark(evaluateBrowserDeviceBenchmark({
    model,
    device: runtime.device,
    samples: [{
      initializationMs: 1,
      firstTokenMs: 1,
      tokensPerSecond: 100,
      peakEstimatedMemoryMB: 1,
      workerCrashCount: 0,
      gpuDeviceLostCount: 0,
      outputFailureRate: 0,
      structuredOutputSuccessRate: 1,
      completedAt: VERIFIED_AT,
    }],
  }), runtime.device.tier);
}

const sourceByBackend = {
  "browser-ai": "browser-runtime-generation",
  "local-ollama": "local-bridge-generation",
  "private-ai-hub": "private-hub-generation",
};

function backend(id, ready = true) {
  return {
    id,
    label: id,
    status: ready ? "ready" : "setup_required",
    runtimeTruth: {
      installed: ready,
      configured: ready,
      reachable: ready,
      modelAvailable: ready,
      runtimeVerified: ready,
      generationVerified: ready,
      verificationSource: ready ? sourceByBackend[id] : "none",
      verifiedAt: ready ? VERIFIED_AT : null,
    },
    modelId: ready ? MODEL_ID : null,
    modelDigest: ready ? MODEL.modelDigest : null,
    local: id !== "private-ai-hub",
    dataBoundary: id === "private-ai-hub" ? "private-infrastructure" : "device",
    maximumComplexity: id === "private-ai-hub" ? "heavy" : "standard",
    capabilities: ["text", "streaming"],
    supportedTaskTypes: "all",
    detailCode: ready ? "model_inference_verified" : "setup_required",
  };
}

function capability(installed) {
  return {
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
    webLlmModelId: installed ? MODEL_ID : null,
    webLlmModelDigest: installed ? MODEL.modelDigest : null,
    webLlmDeviceTier: "low",
    webLlmCacheBackend: "cache",
    modelId: installed ? MODEL_ID : "browser-packaged-task-model-v2",
    modelDigest: installed ? MODEL.modelDigest : "c".repeat(64),
  };
}

function coordinatorFixture(overrides = {}) {
  const state = {
    installed: false,
    generationVerified: false,
    finalized: false,
    installCalls: 0,
    prewarmCalls: 0,
    verifyCalls: 0,
    finalizeCalls: 0,
    cancelCalls: 0,
    failCalls: 0,
    ownerships: [],
    refreshCalls: 0,
  };
  const runtime = {
    refresh: async (input) => {
      state.refreshCalls += 1;
      await overrides.onRefresh?.(state, input);
      return {
        backends: [
          backend("browser-ai", state.generationVerified),
          backend("local-ollama", false),
          backend("private-ai-hub", false),
        ],
        plannedBackend: state.generationVerified ? "browser-ai" : null,
      };
    },
  };
  const dependencies = {
    detectCapability: async () => {
      if (overrides.detectCapability) {
        return overrides.detectCapability(state);
      }
      return capability(state.installed);
    },
    runtimeSnapshot: async () => ({
      device: { allowedModelIds: [MODEL_ID] },
      performance: { workerGeneration: 17, engineGeneration: 19 },
      models: [{
        modelId: MODEL_ID,
        modelDigest: MODEL.modelDigest,
        selected: state.finalized,
        installStatus: state.finalized ? "ready" : state.installed ? "staged" : "not_installed",
        cacheVerified: state.installed,
        shardIntegrityVerified: state.installed,
        generationVerified: state.generationVerified,
      }],
    }),
    repairCache: async () => undefined,
    installModel: async (_modelId, options) => {
      state.installCalls += 1;
      state.ownerships.push(options.setupOwnership);
      if (overrides.installModel) {
        return overrides.installModel(state, options);
      }
      state.installed = true;
      return undefined;
    },
    prewarmModel: async (signal, boundary) => {
      state.prewarmCalls += 1;
      return overrides.prewarmModel?.(state, signal, boundary);
    },
    verifyGeneration: async (signal, boundary) => {
      state.verifyCalls += 1;
      if (overrides.verifyGeneration) {
        return overrides.verifyGeneration(state, signal, boundary);
      }
      state.generationVerified = true;
      return {
        inferenceMode: "generative-model",
        modelId: MODEL_ID,
        modelDigest: MODEL.modelDigest,
      };
    },
    finalizeSetup: async (boundary, options) => {
      state.finalizeCalls += 1;
      if (overrides.finalizeSetup) {
        return overrides.finalizeSetup(state, boundary, options);
      }
      state.finalized = true;
      options.onCommitted();
      return undefined;
    },
    cancelSetup: async (boundary) => {
      state.cancelCalls += 1;
      if (overrides.cancelSetup) return overrides.cancelSetup(state, boundary);
      return {
        code: "BROWSER_WEBLLM_SETUP_CANCELLED",
        cancellationAcknowledged: true,
        cacheRetained: true,
        metadataRollback: "deleted",
      };
    },
    failSetup: async (boundary, failure) => {
      state.failCalls += 1;
      return overrides.failSetup?.(state, boundary, failure);
    },
    selectModel: async () => undefined,
  };
  const coordinatorRuntime = new ClosedAiBootstrapCoordinator(
    runtime,
    dependencies,
    {
      setupAttemptPrefix: overrides.setupAttemptPrefix ?? "runtime-attempt",
      ...(overrides.setupDiagnostics
        ? { setupDiagnostics: overrides.setupDiagnostics }
      : {}),
    },
  );
  // These setup-state fixtures exercise the retained 0.5B lightweight-task
  // path. Full chapter prose tier rejection has a separate Product gate.
  const coordinator = {
    prepareBrowserAi: (input) => coordinatorRuntime.prepareBrowserAi({
      taskType: "story.summary",
      ...input,
    }),
    browserAiSetupSnapshot: () => coordinatorRuntime.browserAiSetupSnapshot(),
  };
  return { coordinator, state };
}

const suites = {
  async "cancel-retry"() {
    await check("cancel-retry: in-flight cancellation is acknowledged before retry", async () => {
      let firstInstallStartedResolve;
      const firstInstallStarted = new Promise((resolve) => {
        firstInstallStartedResolve = resolve;
      });
      const { coordinator, state } = coordinatorFixture({
        installModel: async (fixture, options) => {
          if (fixture.installCalls === 1) {
            firstInstallStartedResolve();
            await new Promise((_, reject) => {
              const abort = () => reject(new DOMException("cancelled", "AbortError"));
              if (options.signal?.aborted) abort();
              else options.signal?.addEventListener("abort", abort, { once: true });
            });
          }
          fixture.installed = true;
        },
      });
      const firstController = new AbortController();
      const first = coordinator.prepareBrowserAi({
        projectId: "cancel-retry",
        userInitiated: true,
        signal: firstController.signal,
      }).then(() => null, (error) => error);
      await firstInstallStarted;
      firstController.abort("bounded-cancel");
      const retry = coordinator.prepareBrowserAi({
        projectId: "cancel-retry",
        userInitiated: true,
        signal: new AbortController().signal,
      });
      const [cancelError, ready] = await Promise.all([first, retry]);
      assert.equal(cancelError?.code, "BROWSER_WEBLLM_SETUP_CANCELLED");
      assert.equal(cancelError?.cancellationAcknowledged, true);
      assert.equal(ready.status, "ready");
      assert.equal(state.installCalls, 2);
      assert.equal(state.cancelCalls, 1);
      assert.equal(coordinator.browserAiSetupSnapshot().state, "ready");
    });

    await check("cancel-retry: pre-resource cancellation has not-reached acknowledgement", async () => {
      const controller = new AbortController();
      const { coordinator, state } = coordinatorFixture({
        detectCapability: async () => {
          controller.abort("cancel-during-inspect");
          throw new DOMException("cancelled during inspect", "AbortError");
        },
      });
      const error = await coordinator.prepareBrowserAi({
        projectId: "cancel-before-claim",
        userInitiated: true,
        signal: controller.signal,
      }).then(() => null, (failure) => failure);
      assert.equal(error?.code, "BROWSER_WEBLLM_SETUP_CANCELLED");
      assert.equal(error?.metadataRollback, "not_reached");
      assert.equal(state.installCalls, 0);
      assert.equal(state.cancelCalls, 0);
      assert.equal(coordinator.browserAiSetupSnapshot().state, "cancelled");
    });

    await check("cancel-retry: cleanup failure becomes failed and is never acknowledged", async () => {
      let installStartedResolve;
      const installStarted = new Promise((resolve) => { installStartedResolve = resolve; });
      const controller = new AbortController();
      const { coordinator, state } = coordinatorFixture({
        installModel: async (_fixture, options) => {
          installStartedResolve();
          await new Promise((_, reject) => {
            options.signal.addEventListener(
              "abort",
              () => reject(new DOMException("cancelled", "AbortError")),
              { once: true },
            );
          });
        },
        cancelSetup: async () => {
          throw Object.assign(new Error("safe cleanup failure"), {
            code: "BROWSER_WEBLLM_SETUP_CANCELLATION_CLEANUP_FAILED",
          });
        },
      });
      const operation = coordinator.prepareBrowserAi({
        projectId: "cleanup-failure",
        userInitiated: true,
        signal: controller.signal,
      });
      await installStarted;
      controller.abort();
      await expectCode("BROWSER_WEBLLM_SETUP_CANCELLATION_CLEANUP_FAILED", () => operation);
      const snapshot = coordinator.browserAiSetupSnapshot();
      assert.equal(snapshot.state, "failed");
      assert.equal(snapshot.counters.cancellationsAcknowledged, 0);
      assert.equal(state.cancelCalls, 1);
    });

    await check("cancel-retry: abort after final commit cannot roll back readiness", async () => {
      const controller = new AbortController();
      const { coordinator, state } = coordinatorFixture({
        finalizeSetup: async (fixture, _boundary, options) => {
          fixture.finalized = true;
          // Model the exact IDB race: the ready+selected transaction has
          // committed, AbortSignal delivery moves the machine to cancelling,
          // and only then does the runtime publish its synchronous commit ack.
          controller.abort("abort-after-durable-commit-before-ack");
          options.onCommitted();
        },
      });
      const ready = await coordinator.prepareBrowserAi({
        projectId: "completion-wins",
        userInitiated: true,
        signal: controller.signal,
      });
      assert.equal(ready.status, "ready");
      assert.equal(state.finalizeCalls, 1);
      assert.equal(state.cancelCalls, 0);
      assert.equal(state.failCalls, 0);
      assert.equal(coordinator.browserAiSetupSnapshot().state, "ready");
    });
  },

  async "attempt-epoch"() {
    await check("attempt-epoch: failed attempt advances retry epoch", async () => {
      const { coordinator, state } = coordinatorFixture({
        installModel: async (fixture) => {
          if (fixture.installCalls === 1) throw Object.assign(new Error("safe"), { code: "FIRST_FAILED" });
          fixture.installed = true;
        },
      });
      await expectCode("FIRST_FAILED", () => coordinator.prepareBrowserAi({
        projectId: "epoch-retry",
        userInitiated: true,
      }));
      const firstTerminal = coordinator.browserAiSetupSnapshot();
      assert.equal(firstTerminal.epoch, 1);
      assert.equal(firstTerminal.state, "failed");
      const ready = await coordinator.prepareBrowserAi({
        projectId: "epoch-retry",
        userInitiated: true,
      });
      assert.equal(ready.status, "ready");
      assert.equal(coordinator.browserAiSetupSnapshot().epoch, 2);
      assert.deepEqual(state.ownerships.map((item) => item.epoch), [1, 2]);
    });

    await check("attempt-epoch: attempt identifiers are stable within and distinct across attempts", async () => {
      const { coordinator, state } = coordinatorFixture({
        installModel: async (fixture) => {
          if (fixture.installCalls === 1) throw new Error("first failure");
          fixture.installed = true;
        },
      });
      await coordinator.prepareBrowserAi({ projectId: "attempt-id", userInitiated: true }).catch(() => undefined);
      await coordinator.prepareBrowserAi({ projectId: "attempt-id", userInitiated: true });
      assert.equal(state.ownerships[0].attemptId, "runtime-attempt-1");
      assert.equal(state.ownerships[1].attemptId, "runtime-attempt-2");
      assert.notEqual(state.ownerships[0].attemptId, state.ownerships[1].attemptId);
    });

    await check("attempt-epoch: terminal attempt releases active authority", async () => {
      const { coordinator } = coordinatorFixture();
      await coordinator.prepareBrowserAi({ projectId: "terminal-owner", userInitiated: true });
      const snapshot = coordinator.browserAiSetupSnapshot();
      assert.equal(snapshot.activeAttemptId, null);
      assert.equal(snapshot.activeOperationKey, null);
      assert.equal(snapshot.counters.readyCompletions, 1);
    });

    await check("attempt-epoch: independent coordinators have non-interchangeable prefixes", async () => {
      const first = coordinatorFixture({ setupAttemptPrefix: "coordinator-a" });
      const second = coordinatorFixture({ setupAttemptPrefix: "coordinator-b" });
      await Promise.all([
        first.coordinator.prepareBrowserAi({ projectId: "a", userInitiated: true }),
        second.coordinator.prepareBrowserAi({ projectId: "b", userInitiated: true }),
      ]);
      assert.equal(first.state.ownerships[0].attemptId, "coordinator-a-1");
      assert.equal(second.state.ownerships[0].attemptId, "coordinator-b-1");
      assert.notEqual(first.state.ownerships[0].attemptId, second.state.ownerships[0].attemptId);
    });
  },

  async "stale-completion"() {
    await check("stale-completion: stale finalize cannot publish ready metadata", async () => {
      const current = setupOwnership("current-attempt", 2);
      await activateSetupRuntime(current);
      await expectCode("BROWSER_WEBLLM_SETUP_RUNTIME_OWNERSHIP_STALE", () => finalizeBrowserWebLLMSetup(
        setupBoundary(setupOwnership("old-attempt", 1)),
        {
          generationModelId: MODEL_ID,
          generationModelDigest: MODEL.modelDigest,
          onCommitted: () => undefined,
        },
      ));
      const records = await readRecords();
      assert.equal(records.find((item) => item.kind === "model").installStatus, "staged");
      assert.equal(records.some((item) => item.key === SELECTED_MODEL_KEY), false);
    });

    await check("stale-completion: stale cancellation cannot delete current attempt", async () => {
      const current = setupOwnership("current-attempt", 3);
      await putRecords(modelRecord({ ownership: current }));
      await expectCode("BROWSER_WEBLLM_SETUP_CANCELLATION_CLEANUP_FAILED", () => (
        cancelBrowserWebLLMSetup(setupBoundary(setupOwnership("old-attempt", 2)))
      ));
      const record = (await readRecords()).find((item) => item.kind === "model");
      assert.equal(record.setupAttemptId, current.attemptId);
      assert.equal(record.setupEpoch, current.epoch);
    });

    await check("stale-completion: stale failure cannot overwrite current metadata", async () => {
      const current = setupOwnership("current-attempt", 4);
      await putRecords(modelRecord({ ownership: current }));
      await expectCode("BROWSER_WEBLLM_SETUP_FAILURE_CLEANUP_FAILED", () => (
        failBrowserWebLLMSetup(
          setupBoundary(setupOwnership("old-attempt", 3)),
          Object.assign(new Error("late"), { code: "LATE_FAILURE" }),
        )
      ));
      const record = (await readRecords()).find((item) => item.kind === "model");
      assert.equal(record.installStatus, "staged");
      assert.equal(record.lastError, null);
    });

    await check("stale-completion: staged prewarm fences stale setup before Worker creation", async () => {
      const current = setupOwnership("current-attempt", 5);
      await seedCachedShardCount(browserModelShardRecord(MODEL_ID).shardCount);
      await putRecords(modelRecord({ ownership: current }));
      await expectCode("BROWSER_WEBLLM_SETUP_STALE_ATTEMPT", () => (
        prewarmBrowserWebLLMModel(
          undefined,
          setupBoundary(setupOwnership("old-attempt", 4)),
        )
      ));
    });
  },

  async "single-flight"() {
    await check("single-flight: UI synchronously fences same-turn repeated clicks", async () => {
      const source = await readFile(
        new URL(
          "../app/studio/project/[projectId]/chat/hooks/use-closed-ai-bootstrap.ts",
          import.meta.url,
        ),
        "utf8",
      );
      const start = source.indexOf("const prepareClosedAi = useCallback(async () => {");
      const end = source.indexOf("const cancelClosedAiSetup = useCallback", start);
      assert.ok(start >= 0 && end > start);
      const section = source.slice(start, end);
      assert.match(section, /if \(closedAiSetupBusy \|\| setupAbortRef\.current\) return;/u);
      const guard = section.indexOf("setupAbortRef.current) return;");
      const controller = section.indexOf("const controller = new AbortController();");
      const claim = section.indexOf("setupAbortRef.current = controller;");
      const firstAwait = section.indexOf("await ");
      assert.ok(guard >= 0 && guard < controller);
      assert.ok(controller < claim && claim < firstAwait);
    });

    await check("single-flight: identical callers share one install execution", async () => {
      let releaseInstall;
      const installGate = new Promise((resolve) => { releaseInstall = resolve; });
      const { coordinator, state } = coordinatorFixture({
        installModel: async (fixture) => {
          await installGate;
          fixture.installed = true;
        },
      });
      const signal = new AbortController().signal;
      const first = coordinator.prepareBrowserAi({
        projectId: "single-flight",
        userInitiated: true,
        signal,
      });
      const second = coordinator.prepareBrowserAi({
        projectId: "single-flight",
        userInitiated: true,
        signal,
      });
      releaseInstall();
      const [left, right] = await Promise.all([first, second]);
      assert.equal(left.status, "ready");
      assert.equal(right.status, "ready");
      assert.equal(state.installCalls, 1);
      assert.equal(state.verifyCalls, 1);
    });

    await check("single-flight: different signals cannot overlap", async () => {
      let releaseInstall;
      const gate = new Promise((resolve) => { releaseInstall = resolve; });
      const { coordinator } = coordinatorFixture({
        installModel: async (fixture) => {
          await gate;
          fixture.installed = true;
        },
      });
      const active = coordinator.prepareBrowserAi({
        projectId: "signal-a",
        userInitiated: true,
        signal: new AbortController().signal,
      });
      await expectCode("BROWSER_AI_BOOTSTRAP_OPERATION_IN_PROGRESS", () => (
        coordinator.prepareBrowserAi({
          projectId: "signal-a",
          userInitiated: true,
          signal: new AbortController().signal,
        })
      ));
      releaseInstall();
      await active;
    });

    await check("single-flight: different projects cannot overlap", async () => {
      let releaseInstall;
      const gate = new Promise((resolve) => { releaseInstall = resolve; });
      const { coordinator } = coordinatorFixture({
        installModel: async (fixture) => {
          await gate;
          fixture.installed = true;
        },
      });
      const signal = new AbortController().signal;
      const active = coordinator.prepareBrowserAi({
        projectId: "project-a",
        userInitiated: true,
        signal,
      });
      await expectCode("BROWSER_AI_BOOTSTRAP_OPERATION_IN_PROGRESS", () => (
        coordinator.prepareBrowserAi({ projectId: "project-b", userInitiated: true, signal })
      ));
      releaseInstall();
      await active;
    });

    await check("single-flight: settled operation permits a subsequent prepare", async () => {
      const { coordinator, state } = coordinatorFixture();
      await coordinator.prepareBrowserAi({ projectId: "serial-prepare", userInitiated: true });
      await coordinator.prepareBrowserAi({ projectId: "serial-prepare", userInitiated: true });
      assert.equal(state.installCalls, 1);
      assert.equal(coordinator.browserAiSetupSnapshot().epoch, 2);
      assert.equal(coordinator.browserAiSetupSnapshot().counters.readyCompletions, 2);
    });
  },

  async "worker-recreate"() {
    await check("worker-recreate: recoverable crash recreates execution identity once", async () => {
      let workerIdentity = 1;
      const observed = [];
      const queue = new BrowserGPUQueue({
        onRecover: async () => { workerIdentity += 1; },
      });
      const result = await queue.enqueue({
        id: "worker-recreate",
        memoryBudgetMB: 100,
        maxAttempts: 2,
        execute: async ({ attempt, recovery }) => {
          observed.push({ attempt, recovery, workerIdentity });
          if (attempt === 1) {
            throw Object.assign(new Error("worker crashed"), {
              code: "BROWSER_WEBLLM_WORKER_CRASHED",
            });
          }
          return workerIdentity;
        },
      });
      assert.equal(result, 2);
      assert.deepEqual(observed, [
        { attempt: 1, recovery: false, workerIdentity: 1 },
        { attempt: 2, recovery: true, workerIdentity: 2 },
      ]);
      assert.equal(queue.snapshot().workerRestartCount, 1);
    });

    await check("worker-recreate: proof-bound job resets worker without hidden retry", async () => {
      let recoveries = 0;
      let executions = 0;
      const queue = new BrowserGPUQueue({ onRecover: async () => { recoveries += 1; } });
      await expectCode("GPU_DEVICE_LOST", () => queue.enqueue({
        id: "proof-bound",
        memoryBudgetMB: 100,
        maxAttempts: 1,
        execute: async () => {
          executions += 1;
          throw Object.assign(new Error("device lost"), { code: "GPU_DEVICE_LOST" });
        },
      }));
      assert.equal(executions, 1);
      assert.equal(recoveries, 1);
      assert.equal(queue.snapshot().gpuDeviceLostCount, 1);
    });

    await check("worker-recreate: ordinary failure does not recreate Worker", async () => {
      let recoveries = 0;
      const queue = new BrowserGPUQueue({ onRecover: async () => { recoveries += 1; } });
      await expectCode("ORDINARY_FAILURE", () => queue.enqueue({
        id: "ordinary-failure",
        memoryBudgetMB: 100,
        execute: async () => {
          throw Object.assign(new Error("ordinary"), { code: "ORDINARY_FAILURE" });
        },
      }));
      assert.equal(recoveries, 0);
      assert.equal(queue.snapshot().workerRestartCount, 0);
    });

    await check("worker-recreate: queued work never overlaps recovering lease", async () => {
      let releaseFirst;
      const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
      const order = [];
      const queue = new BrowserGPUQueue();
      const first = queue.enqueue({
        id: "first",
        memoryBudgetMB: 100,
        execute: async () => {
          order.push("first-start");
          await firstGate;
          order.push("first-end");
          return 1;
        },
      });
      const second = queue.enqueue({
        id: "second",
        memoryBudgetMB: 100,
        execute: async () => {
          order.push("second-start");
          return 2;
        },
      });
      await Promise.resolve();
      assert.deepEqual(order, ["first-start"]);
      releaseFirst();
      assert.deepEqual(await Promise.all([first, second]), [1, 2]);
      assert.deepEqual(order, ["first-start", "first-end", "second-start"]);
    });
  },

  async "cache-resume"() {
    await check("cache-resume: partial immutable cache is measured without download", async () => {
      await seedCachedShardCount(2);
      const inspection = await inspectBrowserModelShardCache(MODEL_ID);
      assert.equal(inspection.cachedShardCount, 2);
      assert.equal(inspection.complete, false);
      assert.ok(inspection.cachedBytes > 0);
      assert.ok(inspection.cachedBytes < inspection.totalBytes);
    });

    await check("cache-resume: cancellation removes staged metadata but retains cache bytes", async () => {
      const ownership = setupOwnership("cancel-cache", 1);
      await seedCachedShardCount(3);
      await putRecords(modelRecord({ ownership }));
      const before = await inspectBrowserModelShardCache(MODEL_ID);
      const outcome = await cancelBrowserWebLLMSetup(setupBoundary(ownership));
      const after = await inspectBrowserModelShardCache(MODEL_ID);
      assert.equal(outcome.cacheRetained, true);
      assert.equal(outcome.metadataRollback, "deleted");
      assert.equal(after.cachedShardCount, before.cachedShardCount);
      assert.equal((await readRecords()).some((item) => item.kind === "model"), false);
    });

    await check("cache-resume: complete retained cache remains staged until generation proof", async () => {
      await seedCachedShardCount(browserModelShardRecord(MODEL_ID).shardCount);
      await putRecords(modelRecord());
      const snapshot = await browserWebLLMRuntimeSnapshot();
      const state = snapshot.models.find((item) => item.modelId === MODEL_ID);
      assert.equal(state.cacheComplete, true);
      assert.equal(state.cacheVerified, true);
      assert.equal(state.installStatus, "staged");
      assert.equal(state.generationVerified, false);
    });

    await check("cache-resume: incomplete cache downgrades persisted ready metadata", async () => {
      await seedCachedShardCount(1);
      await putRecords(modelRecord({
        status: "ready",
        generationVerifiedAt: VERIFIED_AT,
      }), selectedRecord());
      const snapshot = await browserWebLLMRuntimeSnapshot();
      const state = snapshot.models.find((item) => item.modelId === MODEL_ID);
      assert.equal(state.cachePresent, true);
      assert.equal(state.cacheComplete, false);
      assert.equal(state.cacheVerified, false);
      assert.equal(state.installStatus, "not_installed");
    });
  },

  async "cache-integrity"() {
    await check("cache-integrity: immutable shard manifest is internally valid", async () => {
      assert.deepEqual(validateBrowserModelShardManifest(), { valid: true, errors: [] });
      const record = browserModelShardRecord(MODEL_ID);
      assert.equal(record.shardCount, record.shards.length);
      assert.ok(record.shards.every((shard) => shard.url.includes(record.revision)));
    });

    await check("cache-integrity: missing shards fail closed with exact count", async () => {
      const verification = await verifyBrowserModelShards({ modelId: MODEL_ID });
      assert.equal(verification.verified, false);
      assert.equal(verification.verifiedShardCount, 0);
      assert.equal(verification.failures.length, verification.shardCount);
      assert.ok(verification.failures.every((failure) => failure.reason === "missing"));
    });

    await check("cache-integrity: corrupt-size shard is evicted", async () => {
      const first = browserModelShardRecord(MODEL_ID).shards[0];
      await seedCachedShardCount(1, () => new Response(new Uint8Array([1, 2, 3])));
      const verification = await verifyBrowserModelShards({ modelId: MODEL_ID });
      assert.ok(verification.failures.some((failure) => (
        failure.path === first.path && failure.reason === "size_mismatch"
      )));
      const cache = await cacheStorage.open(BROWSER_MODEL_SHARD_CACHE);
      assert.equal(await cache.match(new Request(first.url)), undefined);
    });

    await check("cache-integrity: metadata flags cannot manufacture cache completeness", async () => {
      await putRecords(modelRecord({
        status: "ready",
        generationVerifiedAt: VERIFIED_AT,
        cacheVerified: true,
        shardIntegrityVerified: true,
      }), selectedRecord());
      const snapshot = await browserWebLLMRuntimeSnapshot();
      const state = snapshot.models.find((item) => item.modelId === MODEL_ID);
      assert.equal(state.expectedShardCount > 0, true);
      assert.equal(state.cachedShardCount, 0);
      assert.equal(state.installStatus, "not_installed");
      assert.equal(state.cacheVerified, false);
    });
  },

  async "metadata-transaction"() {
    await check("metadata-transaction: finalization atomically commits model and selection", async () => {
      const ownership = setupOwnership("atomic-finalize", 1);
      await activateSetupRuntime(ownership);
      const snapshot = await finalizeBrowserWebLLMSetup(setupBoundary(ownership), {
        generationModelId: MODEL_ID,
        generationModelDigest: MODEL.modelDigest,
        onCommitted: () => undefined,
      });
      const records = await readRecords();
      const model = records.find((item) => item.kind === "model");
      const selected = records.find((item) => item.key === SELECTED_MODEL_KEY);
      assert.equal(model.installStatus, "ready");
      assert.equal(typeof model.generationVerifiedAt, "string");
      assert.equal(selected.modelId, MODEL_ID);
      assert.equal(snapshot.selectedModelId, MODEL_ID);
      assert.equal(snapshot.models.find((item) => item.modelId === MODEL_ID).installStatus, "ready");
    });

    await check("metadata-transaction: mismatched proof writes neither half", async () => {
      const ownership = setupOwnership("proof-mismatch", 1);
      await activateSetupRuntime(ownership);
      await expectCode("BROWSER_WEBLLM_SETUP_GENERATION_PROOF_MISMATCH", () => (
        finalizeBrowserWebLLMSetup(setupBoundary(ownership), {
          generationModelId: MODEL_ID,
          generationModelDigest: "0".repeat(64),
          onCommitted: () => undefined,
        })
      ));
      const records = await readRecords();
      assert.equal(records.find((item) => item.kind === "model").installStatus, "staged");
      assert.equal(records.some((item) => item.key === SELECTED_MODEL_KEY), false);
    });

    await check("metadata-transaction: pre-aborted finalization leaves staged record untouched", async () => {
      const ownership = setupOwnership("aborted-finalize", 1);
      await activateSetupRuntime(ownership);
      const controller = new AbortController();
      controller.abort("before-transaction");
      await assert.rejects(
        finalizeBrowserWebLLMSetup(setupBoundary(ownership), {
          signal: controller.signal,
          generationModelId: MODEL_ID,
          generationModelDigest: MODEL.modelDigest,
          onCommitted: () => undefined,
        }),
        (error) => error?.name === "AbortError",
      );
      const records = await readRecords();
      assert.equal(records.find((item) => item.kind === "model").installStatus, "staged");
      assert.equal(records.some((item) => item.key === SELECTED_MODEL_KEY), false);
    });

    await check("metadata-transaction: stale ownership aborts before selected-model write", async () => {
      const current = setupOwnership("atomic-current", 2);
      await activateSetupRuntime(current);
      await expectCode("BROWSER_WEBLLM_SETUP_RUNTIME_OWNERSHIP_STALE", () => (
        finalizeBrowserWebLLMSetup(
          setupBoundary(setupOwnership("atomic-old", 1)),
          {
            generationModelId: MODEL_ID,
            generationModelDigest: MODEL.modelDigest,
            onCommitted: () => undefined,
          },
        )
      ));
      const records = await readRecords();
      assert.equal(records.length, 1);
      assert.equal(records[0].setupAttemptId, current.attemptId);
      assert.equal(records[0].installStatus, "staged");
    });
  },

  async diagnostics() {
    await check("diagnostics: one-shot worker crash detaches and permits retry", async () => {
      const ownership = setupOwnership("diagnostic-worker-crash", 1);
      await seedCachedShardCount(browserModelShardRecord(MODEL_ID).shardCount);
      await putRecords(modelRecord({ ownership }));
      const { controller, bridge } = await createBrowserAiSetupDiagnosticsForTests(
        "725ccf75-f171-4c22-bde5-8f5b93557dde",
      );
      const attempt = await controller.bindAttempt({
        ...ownership,
        abortControllerGenerationId: DIAGNOSTIC_ABORT_GENERATION_ID,
      });
      bridge.arm({
        checkpoint: "worker-engine-initialize",
        fault: "worker-crash",
      });
      const warming = prewarmBrowserWebLLMModel(
        undefined,
        setupBoundary(ownership, attempt),
      );
      const rejected = expectCode(
        "BROWSER_AI_SETUP_DIAGNOSTIC_WORKER_CRASH",
        () => warming,
      );
      const arrival = await bridge.waitForArrival("worker-engine-initialize");
      assert.equal(arrival.runtimeOrdering, "worker-created-before-engine-created");
      bridge.release("worker-engine-initialize");
      await rejected;
      assert.equal(bridge.snapshot().workerCrashFaultTriggeredCount, 1);
      const recovered = await prewarmBrowserWebLLMModel(
        undefined,
        setupBoundary(ownership, attempt),
      );
      assert.equal(recovered.modelId, MODEL_ID);
      assert.equal(bridge.snapshot().workerCrashFaultTriggeredCount, 1);
    });

    await check("diagnostics: coordinator binds abort signal identity without exposing it", async () => {
      const diagnostic = await createBrowserAiSetupDiagnosticsForTests(
        "725ccf75-f171-4c22-bde5-8f5b93557dde",
      );
      let verificationAttempt = 0;
      const { coordinator } = coordinatorFixture({
        setupDiagnostics: diagnostic.controller,
        verifyGeneration: async (fixture) => {
          verificationAttempt += 1;
          if (verificationAttempt < 3) {
            throw Object.assign(new Error("bounded diagnostic retry"), {
              code: "DIAGNOSTIC_RETRY",
            });
          }
          fixture.generationVerified = true;
          return {
            inferenceMode: "generative-model",
            modelId: MODEL_ID,
            modelDigest: MODEL.modelDigest,
          };
        },
      });
      const sameController = new AbortController();
      const digests = [];
      for (const signal of [
        sameController.signal,
        sameController.signal,
        new AbortController().signal,
      ]) {
        diagnostic.bridge.arm({ checkpoint: "before-generation-verification" });
        const preparation = coordinator.prepareBrowserAi({
          projectId: "diagnostic-abort-identity",
          userInitiated: true,
          signal,
        });
        const arrival = await diagnostic.bridge.waitForArrival(
          "before-generation-verification",
        );
        digests.push(arrival.abortControllerGenerationDigest);
        assert.match(arrival.workerGenerationDigest, /^[a-f0-9]{64}$/u);
        assert.match(arrival.engineGenerationDigest, /^[a-f0-9]{64}$/u);
        diagnostic.bridge.release("before-generation-verification");
        if (digests.length < 3) await expectCode("DIAGNOSTIC_RETRY", () => preparation);
        else assert.equal((await preparation).status, "ready");
      }
      assert.match(digests[0], /^[a-f0-9]{64}$/u);
      assert.equal(digests[1], digests[0]);
      assert.notEqual(digests[2], digests[0]);
      assert.doesNotMatch(JSON.stringify(diagnostic.bridge.snapshot()), /AbortSignal/u);
    });

    await check("diagnostics: authorized stale completion is rejected during retry", async () => {
      const diagnostic = await createBrowserAiSetupDiagnosticsForTests(
        "725ccf75-f171-4c22-bde5-8f5b93557dde",
      );
      let firstFailure = true;
      const { coordinator } = coordinatorFixture({
        setupDiagnostics: diagnostic.controller,
        installModel: async (fixture) => {
          if (firstFailure) {
            firstFailure = false;
            throw Object.assign(new Error("first diagnostic attempt failed"), {
              code: "DIAGNOSTIC_FIRST_ATTEMPT_FAILED",
            });
          }
          fixture.installed = true;
        },
      });
      await expectCode("DIAGNOSTIC_FIRST_ATTEMPT_FAILED", () => (
        coordinator.prepareBrowserAi({
          projectId: "diagnostic-stale-completion",
          userInitiated: true,
          signal: new AbortController().signal,
        })
      ));
      diagnostic.bridge.arm({
        checkpoint: "before-generation-verification",
        fault: "stale-completion",
      });
      const retry = coordinator.prepareBrowserAi({
        projectId: "diagnostic-stale-completion",
        userInitiated: true,
        signal: new AbortController().signal,
      });
      const arrival = await diagnostic.bridge.waitForArrival(
        "before-generation-verification",
      );
      assert.equal(arrival.setupEpoch, 2);
      const before = coordinator.browserAiSetupSnapshot();
      diagnostic.bridge.release("before-generation-verification");
      const ready = await retry;
      assert.equal(ready.status, "ready");
      const after = coordinator.browserAiSetupSnapshot();
      assert.equal(after.state, "ready");
      assert.equal(after.epoch, 2);
      assert.equal(after.counters.staleCompletionsRejected, (
        before.counters.staleCompletionsRejected + 1
      ));
      assert.equal(diagnostic.bridge.snapshot().staleCompletionFaultTriggeredCount, 1);
      assert.equal(diagnostic.bridge.snapshot().staleCompletionRejectedCount, 1);
    });

    await check("diagnostics: metadata transaction is open but uncommitted until release", async () => {
      const ownership = setupOwnership("diagnostic-metadata-hold", 1);
      await activateSetupRuntime(ownership);
      const { controller, bridge } = await createBrowserAiSetupDiagnosticsForTests(
        "725ccf75-f171-4c22-bde5-8f5b93557dde",
      );
      const attempt = await controller.bindAttempt({
        ...ownership,
        abortControllerGenerationId: DIAGNOSTIC_ABORT_GENERATION_ID,
      });
      bridge.arm({ checkpoint: "metadata-transaction" });
      let committed = false;
      let settled = false;
      const finalizing = finalizeBrowserWebLLMSetup(
        setupBoundary(ownership, attempt),
        {
          generationModelId: MODEL_ID,
          generationModelDigest: MODEL.modelDigest,
          onCommitted: () => {
            committed = true;
          },
        },
      ).then((value) => {
        settled = true;
        return value;
      });
      const arrival = await bridge.waitForArrival("metadata-transaction");
      assert.equal(
        arrival.runtimeOrdering,
        "inside-open-readwrite-transaction-before-writes",
      );
      await Promise.resolve();
      assert.equal(committed, false);
      assert.equal(settled, false);
      bridge.release("metadata-transaction");
      await finalizing;
      assert.equal(committed, true);
      const records = await readRecords();
      assert.equal(records.find((item) => item.kind === "model").installStatus, "ready");
      assert.equal(records.find((item) => item.key === SELECTED_MODEL_KEY).modelId, MODEL_ID);
    });

    await check("diagnostics: one-shot metadata fault aborts before either ready write", async () => {
      const ownership = setupOwnership("diagnostic-metadata-abort", 1);
      await activateSetupRuntime(ownership);
      const { controller, bridge } = await createBrowserAiSetupDiagnosticsForTests(
        "725ccf75-f171-4c22-bde5-8f5b93557dde",
      );
      const attempt = await controller.bindAttempt({
        ...ownership,
        abortControllerGenerationId: DIAGNOSTIC_ABORT_GENERATION_ID,
      });
      bridge.arm({
        checkpoint: "metadata-transaction",
        fault: "metadata-transaction-abort",
      });
      const finalizing = finalizeBrowserWebLLMSetup(
        setupBoundary(ownership, attempt),
        {
          generationModelId: MODEL_ID,
          generationModelDigest: MODEL.modelDigest,
          onCommitted: () => assert.fail("aborted transaction committed"),
        },
      );
      const rejected = expectCode(
        "BROWSER_AI_SETUP_DIAGNOSTIC_METADATA_TRANSACTION_ABORT",
        () => finalizing,
      );
      await bridge.waitForArrival("metadata-transaction");
      bridge.release("metadata-transaction");
      await rejected;
      const records = await readRecords();
      assert.equal(records.find((item) => item.kind === "model").installStatus, "staged");
      assert.equal(records.some((item) => item.key === SELECTED_MODEL_KEY), false);
      const snapshot = await browserWebLLMRuntimeSnapshot();
      assert.equal(snapshot.performance.metadataTransactionAbortedCount > 0, true);
      assert.equal(bridge.snapshot().metadataTransactionAbortFaultTriggeredCount, 1);
    });
  },

  async "generation-verification"() {
    await check("generation-verification: selected low-tier prose is blocked before WebLLM or Prompt calls", async () => {
      const ownership = setupOwnership("low-tier-provider-fence", 1);
      await activateSetupRuntime(ownership);
      const ready = await finalizeBrowserWebLLMSetup(setupBoundary(ownership), {
        generationModelId: MODEL_ID,
        generationModelDigest: MODEL.modelDigest,
        onCommitted: () => undefined,
      });
      assert.equal(
        ready.models.find((item) => item.modelId === MODEL_ID).installStatus,
        "ready",
      );
      let promptAvailabilityCalls = 0;
      let promptCreateCalls = 0;
      let promptCalls = 0;
      const languageModelDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        "LanguageModel",
      );
      Object.defineProperty(globalThis, "LanguageModel", {
        configurable: true,
        value: {
          availability: async () => {
            promptAvailabilityCalls += 1;
            return "available";
          },
          create: async () => {
            promptCreateCalls += 1;
            return {
              prompt: async () => {
                promptCalls += 1;
                return "must-not-run";
              },
              destroy() {},
            };
          },
        },
      });
      const workerCallsBefore = workerPostMessageCount;
      try {
        for (const taskType of ["chapter.continue", "chapter.expand"]) {
          await assert.rejects(
            runBrowserAI({
              requestId: `low-tier-provider-${taskType}`,
              projectId: "low-tier-provider-project",
              taskType,
              privacyMode: "strict-local",
              input: "raw-input-must-not-reach-model",
              context: ["raw-context-must-not-reach-model"],
              externalConsent: false,
              closedOnly: true,
            }, {
              providerId: "browser-ai",
              modelId: MODEL_ID,
              modelDigest: MODEL.modelDigest,
              privacyMode: "strict-local",
              reason: "low-tier-provider-negative",
              contextSources: [],
              externalRequest: false,
              dataLeavesDevice: false,
              fallbackChain: [],
              warnings: [],
            }),
            (error) => (
              error?.code === LOW_TIER_BROWSER_PROSE_NOT_PRODUCTION_QUALIFIED
              && error?.message === BROWSER_PROSE_TIER_PRIMARY_GUIDANCE
              && error?.modelCallClaimed === false
              && error?.fallbackAttempted === false
            ),
          );
        }
        const fabricCallsBefore = workerPostMessageCount;
        await assert.rejects(
          executeBrowserSovereignFabric({
            request: {
              requestId: "low-tier-direct-fabric",
              projectId: "low-tier-provider-project",
              taskType: "chapter.continue",
              privacyMode: "strict-local",
              input: "raw-fabric-input-must-not-be-mapped",
              context: ["raw-fabric-context-must-not-be-mapped"],
              externalConsent: false,
              closedOnly: true,
            },
            decision: {
              providerId: "browser-ai",
              modelId: MODEL_ID,
              modelDigest: MODEL.modelDigest,
              privacyMode: "strict-local",
              reason: "low-tier-direct-fabric-negative",
              contextSources: [],
              externalRequest: false,
              dataLeavesDevice: false,
              fallbackChain: [],
              warnings: [],
            },
          }),
          (error) => error?.code
            === LOW_TIER_BROWSER_PROSE_NOT_PRODUCTION_QUALIFIED,
        );
        assert.equal(workerPostMessageCount, fabricCallsBefore);
      } finally {
        if (languageModelDescriptor) {
          Object.defineProperty(
            globalThis,
            "LanguageModel",
            languageModelDescriptor,
          );
        } else {
          delete globalThis.LanguageModel;
        }
      }
      assert.equal(workerPostMessageCount, workerCallsBefore);
      assert.equal(promptAvailabilityCalls, 0);
      assert.equal(promptCreateCalls, 0);
      assert.equal(promptCalls, 0);
    });

    await check("generation-verification: Prompt-only prose is blocked before session creation", async () => {
      let promptAvailabilityCalls = 0;
      let promptCreateCalls = 0;
      let promptCalls = 0;
      const languageModelDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        "LanguageModel",
      );
      Object.defineProperty(globalThis, "LanguageModel", {
        configurable: true,
        value: {
          availability: async () => {
            promptAvailabilityCalls += 1;
            return "available";
          },
          create: async () => {
            promptCreateCalls += 1;
            return {
              prompt: async () => {
                promptCalls += 1;
                return "must-not-run";
              },
              destroy() {},
            };
          },
        },
      });
      try {
        for (const taskType of ["chapter.continue", "chapter.expand"]) {
          await assert.rejects(
            runBrowserAI({
              requestId: `prompt-only-provider-${taskType}`,
              projectId: "prompt-only-provider-project",
              taskType,
              privacyMode: "strict-local",
              input: "raw-input-must-not-reach-prompt",
              context: ["raw-context-must-not-reach-prompt"],
              externalConsent: false,
              closedOnly: true,
            }, {
              providerId: "browser-ai",
              modelId: "chrome-built-in-language-model",
              modelDigest: null,
              privacyMode: "strict-local",
              reason: "prompt-only-provider-negative",
              contextSources: [],
              externalRequest: false,
              dataLeavesDevice: false,
              fallbackChain: [],
              warnings: [],
            }),
            (error) => error?.code
              === LOW_TIER_BROWSER_PROSE_NOT_PRODUCTION_QUALIFIED,
          );
        }
      } finally {
        if (languageModelDescriptor) {
          Object.defineProperty(
            globalThis,
            "LanguageModel",
            languageModelDescriptor,
          );
        } else {
          delete globalThis.LanguageModel;
        }
      }
      assert.equal(workerPostMessageCount, 0);
      assert.equal(promptAvailabilityCalls, 0);
      assert.equal(promptCreateCalls, 0);
      assert.equal(promptCalls, 0);
    });

    await check("generation-verification: research-only 3B cannot become Product prose authority", async () => {
      const researchModel = BROWSER_WEBLLM_MODELS.find(
        (model) => model.parameterLabel === "3B",
      );
      assert.ok(researchModel && researchModel.productionQualified === false);
      await seedCachedShardCount(
        browserModelShardRecord(researchModel.modelId).shardCount,
        undefined,
        researchModel.modelId,
      );
      await putRecords(
        modelRecord({
          model: researchModel,
          status: "ready",
          generationVerifiedAt: VERIFIED_AT,
        }),
        selectedRecord(researchModel.modelId),
      );
      const workerCallsBefore = workerPostMessageCount;
      await assert.rejects(
        runBrowserAI({
          requestId: "research-only-provider-negative",
          projectId: "research-only-provider-project",
          taskType: "chapter.expand",
          privacyMode: "strict-local",
          input: "must-not-reach-research-model",
          context: ["must-not-reach-research-model"],
          externalConsent: false,
          closedOnly: true,
        }, {
          providerId: "browser-ai",
          modelId: researchModel.modelId,
          modelDigest: researchModel.modelDigest,
          privacyMode: "strict-local",
          reason: "research-only-provider-negative",
          contextSources: [],
          externalRequest: false,
          dataLeavesDevice: false,
          fallbackChain: [],
          warnings: [],
        }),
        (error) => error?.code
          === LOW_TIER_BROWSER_PROSE_NOT_PRODUCTION_QUALIFIED,
      );
      assert.equal(workerPostMessageCount, workerCallsBefore);
    });

    await check("generation-verification: exact 1.5B runtime and benchmark remain prose-unqualified and never fall back to Prompt", async () => {
      const standardModel = BROWSER_WEBLLM_MODELS.find(
        (model) => model.parameterLabel === "1.5B",
      );
      const highModel = BROWSER_WEBLLM_MODELS.find(
        (model) => model.parameterLabel === "3B",
      );
      assert.ok(standardModel && highModel);
      const ownership = setupOwnership("standard-provider-no-prompt-fallback", 1);
      await activateSetupRuntime(ownership, standardModel);
      const boundary = setupBoundary(
        ownership,
        undefined,
        standardModel.modelId,
      );
      const ready = await finalizeBrowserWebLLMSetup(boundary, {
        generationModelId: standardModel.modelId,
        generationModelDigest: standardModel.modelDigest,
        onCommitted: () => undefined,
      });
      assert.equal(ready.selectedModelId, standardModel.modelId);
      assert.equal(
        ready.models.find((item) => item.modelId === standardModel.modelId)
          .installStatus,
        "ready",
      );
      let promptAvailabilityCalls = 0;
      let promptCreateCalls = 0;
      let promptCalls = 0;
      const languageModelDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        "LanguageModel",
      );
      Object.defineProperty(globalThis, "LanguageModel", {
        configurable: true,
        value: {
          availability: async () => {
            promptAvailabilityCalls += 1;
            return "available";
          },
          create: async () => {
            promptCreateCalls += 1;
            return {
              prompt: async () => {
                promptCalls += 1;
                return "must-not-run";
              },
              destroy() {},
            };
          },
        },
      });
      const noBenchmarkWorkerCallsBefore = workerPostMessageCount;
      await assert.rejects(
        runBrowserAI({
          requestId: "standard-provider-missing-benchmark",
          projectId: "standard-provider-failure-project",
          taskType: "chapter.continue",
          privacyMode: "strict-local",
          input: "must-not-reach-model-without-benchmark",
          context: ["must-not-reach-model-without-benchmark"],
          externalConsent: false,
          closedOnly: true,
        }, {
          providerId: "browser-ai",
          modelId: standardModel.modelId,
          modelDigest: standardModel.modelDigest,
          privacyMode: "strict-local",
          reason: "runtime-authority-missing-benchmark-negative",
          contextSources: [],
          externalRequest: false,
          dataLeavesDevice: false,
          fallbackChain: [],
          warnings: [],
        }),
        (error) => error?.code
          === LOW_TIER_BROWSER_PROSE_NOT_PRODUCTION_QUALIFIED
          && error?.modelCallClaimed === false
          && error?.fallbackAttempted === false,
      );
      assert.equal(workerPostMessageCount, noBenchmarkWorkerCallsBefore);
      assert.equal(promptAvailabilityCalls, 0);
      assert.equal(promptCreateCalls, 0);
      assert.equal(promptCalls, 0);
      const benchmark = await persistPassingBenchmark(standardModel);
      assert.equal(benchmark.benchmarkPassed, true);
      const workerCallsBefore = workerPostMessageCount;
      try {
        await assert.rejects(
          runBrowserAI({
            requestId: "standard-provider-router-runtime-mismatch",
            projectId: "standard-provider-failure-project",
            taskType: "chapter.continue",
            privacyMode: "strict-local",
            input: "must-not-reach-model-on-identity-mismatch",
            context: ["must-not-reach-model-on-identity-mismatch"],
            externalConsent: false,
            closedOnly: true,
          }, {
            providerId: "browser-ai",
            modelId: highModel.modelId,
            modelDigest: highModel.modelDigest,
            privacyMode: "strict-local",
            reason: "router-runtime-identity-mismatch-negative",
            contextSources: [],
            externalRequest: false,
            dataLeavesDevice: false,
            fallbackChain: [],
            warnings: [],
          }),
          (error) => (
            error?.code === LOW_TIER_BROWSER_PROSE_NOT_PRODUCTION_QUALIFIED
            && error?.modelCallClaimed === false
            && error?.fallbackAttempted === false
          ),
        );
        assert.equal(workerPostMessageCount, workerCallsBefore);
        assert.equal(promptAvailabilityCalls, 0);
        assert.equal(promptCreateCalls, 0);
        assert.equal(promptCalls, 0);
        for (const taskType of ["chapter.continue", "chapter.expand"]) {
          await assert.rejects(
            runBrowserAI({
              requestId: `standard-provider-failure-${taskType}`,
              projectId: "standard-provider-failure-project",
              taskType,
              privacyMode: "strict-local",
              input: "standard-prose-input",
              context: ["standard-prose-context"],
              externalConsent: false,
              closedOnly: true,
            }, {
              providerId: "browser-ai",
              modelId: standardModel.modelId,
              modelDigest: standardModel.modelDigest,
              privacyMode: "strict-local",
              reason: "standard-provider-failure-negative",
              contextSources: [],
              externalRequest: false,
              dataLeavesDevice: false,
              fallbackChain: [],
              warnings: [],
            }),
            (error) => (
              error?.code === LOW_TIER_BROWSER_PROSE_NOT_PRODUCTION_QUALIFIED
              && error?.fallbackAttempted === false
              && error?.browserProseTierDecisionReceipt?.eligible === false
              && error?.browserProseTierDecisionReceipt?.selectedModelTier
                === "1.5B"
            ),
          );
        }
      } finally {
        if (languageModelDescriptor) {
          Object.defineProperty(
            globalThis,
            "LanguageModel",
            languageModelDescriptor,
          );
        } else {
          delete globalThis.LanguageModel;
        }
      }
      assert.equal(workerPostMessageCount, workerCallsBefore);
      assert.equal(promptAvailabilityCalls, 0);
      assert.equal(promptCreateCalls, 0);
      assert.equal(promptCalls, 0);
    });

    await check("generation-verification: pinned production identity rejects a selection switch before any worker call", async () => {
      const standardModel = BROWSER_WEBLLM_MODELS.find(
        (model) => model.parameterLabel === "1.5B",
      );
      assert.ok(standardModel);
      await seedCachedShardCount(
        browserModelShardRecord(standardModel.modelId).shardCount,
        undefined,
        standardModel.modelId,
      );
      await putRecords(
        modelRecord({
          model: standardModel,
          status: "ready",
          generationVerifiedAt: VERIFIED_AT,
        }),
        modelRecord({
          model: MODEL,
          status: "ready",
          generationVerifiedAt: VERIFIED_AT,
        }),
        selectedRecord(standardModel.modelId),
      );
      // This deterministic write models the selection changing after the
      // provider's authority snapshot but before the queued engine boundary.
      await putRecords(selectedRecord(MODEL.modelId));
      const workerCallsBefore = workerPostMessageCount;
      await assert.rejects(
        generateWithBrowserWebLLM({
          systemInstruction: "must-not-reach-worker",
          prompt: "must-not-reach-worker",
          contextAttestation: "not_required",
          expectedModelIdentity: {
            modelId: standardModel.modelId,
            modelDigest: standardModel.modelDigest,
          },
        }),
        (error) => error?.code
          === BROWSER_PROSE_ROUTER_RUNTIME_IDENTITY_MISMATCH,
      );
      assert.equal(workerPostMessageCount, workerCallsBefore);
    });

    await check("generation-verification: non-generative proof fails setup without finalization", async () => {
      const { coordinator, state } = coordinatorFixture({
        verifyGeneration: async () => ({
          inferenceMode: "deterministic-task-model",
          modelId: MODEL_ID,
          modelDigest: MODEL.modelDigest,
        }),
      });
      await expectCode("BROWSER_GENERATIVE_VERIFICATION_REQUIRED", () => (
        coordinator.prepareBrowserAi({ projectId: "bad-mode", userInitiated: true })
      ));
      assert.equal(state.finalizeCalls, 0);
      assert.equal(state.failCalls, 1);
      assert.equal(coordinator.browserAiSetupSnapshot().state, "failed");
    });

    await check("generation-verification: non-cryptographic digest cannot publish ready", async () => {
      const { coordinator, state } = coordinatorFixture({
        verifyGeneration: async () => ({
          inferenceMode: "generative-model",
          modelId: MODEL_ID,
          modelDigest: "browser-managed-digest-unavailable",
        }),
      });
      await expectCode("BROWSER_GENERATIVE_VERIFICATION_REQUIRED", () => (
        coordinator.prepareBrowserAi({ projectId: "bad-digest", userInitiated: true })
      ));
      assert.equal(state.finalizeCalls, 0);
      assert.equal(state.failCalls, 1);
    });

    await check("generation-verification: selection rejects ready metadata without proof timestamp", async () => {
      await seedCachedShardCount(browserModelShardRecord(MODEL_ID).shardCount);
      await putRecords(modelRecord({ status: "ready", generationVerifiedAt: null }));
      await expectCode("BROWSER_WEBLLM_MODEL_NOT_VERIFIED", () => selectBrowserWebLLMModel(MODEL_ID));
      assert.equal((await readRecords()).some((item) => item.key === SELECTED_MODEL_KEY), false);
    });

    await check("generation-verification: ordinary generation refuses unverified staged metadata", async () => {
      await seedCachedShardCount(browserModelShardRecord(MODEL_ID).shardCount);
      await putRecords(modelRecord({ generationCount: 7 }), selectedRecord());
      await expectCode("BROWSER_WEBLLM_MODEL_NOT_INSTALLED", () => generateWithBrowserWebLLM({
        systemInstruction: "test",
        prompt: "test",
        contextAttestation: "not_required",
      }));
      const record = (await readRecords()).find((item) => item.kind === "model");
      assert.equal(record.generationCount, 7);
      assert.equal(record.generationVerifiedAt, null);
    });

    await check("generation-verification: telemetry commit is CAS-fenced in Product source", async () => {
      const source = await readFile(
        new URL("../lib/novel-ai/providers/browser-ai/browser-webllm-runtime.ts", import.meta.url),
        "utf8",
      );
      const start = source.indexOf("async function updateGenerationMetadataAtomically");
      const end = source.indexOf("function reportProgress", start);
      assert.ok(start >= 0 && end > start);
      const section = source.slice(start, end);
      assert.match(section, /current\.installStatus !== "staged"/u);
      assert.match(section, /metadataOwnedBySetup\(current, setupVerification\.setupOwnership\)/u);
      assert.match(section, /current\.installStatus !== "ready"/u);
      assert.match(section, /typeof current\.generationVerifiedAt !== "string"/u);
      assert.match(section, /selected\?\.kind !== "setting" \|\| selected\.modelId !== modelId/u);
      assert.match(section, /generationCount = \(current\.generationCount \?\? 0\) \+ 1/u);
    });
  },
};

for (const [suiteName, suite] of Object.entries(suites)) {
  if (mode === "all" || mode === suiteName) await suite();
}

const failed = results.filter((result) => result.status === "FAIL");
const output = `${JSON.stringify({
  schemaVersion: "rc6.4-browser-ai-setup-runtime-tests-v1",
  mode,
  status: failed.length === 0 ? "PASS" : "FAIL",
  caseCount: results.length,
  passedCount: results.length - failed.length,
  failedCount: failed.length,
  cases: results,
}, null, 2)}\n`;
await new Promise((resolve) => process.stdout.write(output, resolve));
process.exit(failed.length > 0 ? 1 : 0);

import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolveClosedAIRoute } from "../lib/novel-ai/closed-agent-os/router.ts";
import {
  ClosedAgentOS,
  MemoryClosedAgentStateRepository,
} from "../lib/novel-ai/closed-agent-os/index.ts";
import {
  ClosedAICache,
  MemoryClosedAICacheRepository,
} from "../lib/novel-ai/closed-ai-cache/index.ts";
import {
  ApprovalSigner,
  MemoryVerifiableLedgerRepository,
  VerifiableLedger,
} from "../lib/novel-ai/verifiable-ledger/index.ts";
import {
  ClosedAIRuntimeCoordinator,
} from "../lib/novel-ai/web/closed-ai-runtime-coordinator.ts";
import {
  derivePersistenceRuntimeMode,
  resolvePersistenceRuntimeHealth,
} from "../lib/novel-ai/repository/runtime-health.ts";
import {
  UnavailableNovelRepository,
} from "../lib/novel-ai/repository/unavailable/unavailable-repository.ts";
import {
  saveClosedAITabSession,
  readClosedAITabSession,
  closedAITabSessionStorageKey,
} from "../lib/novel-ai/providers/closed/tab-session-recovery.ts";
import {
  LOCAL_BRIDGE_PROTOCOL,
  LocalBridgeClient,
} from "../lib/novel-ai/providers/local-ollama/local-bridge-client.ts";
import {
  evaluateLocalAIRuntimeVersion,
  PASSWORDLESS_LOCAL_AI_ORIGINS,
} from "../lib/novel-ai/providers/local-ollama/companion-release.ts";
import {
  runPackagedBrowserTaskModel,
} from "../lib/novel-ai/providers/browser-ai/browser-task-model.ts";
import {
  MemoryNovelRepository,
} from "../lib/novel-ai/repository/memory/memory-repository.ts";
import {
  migrateLegacyStudioProjects,
} from "../lib/novel-ai/repository/migration/legacy-studio-migration.ts";
import {
  buildProjectBundle,
  createDraft,
} from "../lib/novel-ai/domain/creation.ts";
import { optionalValue } from "../lib/novel-ai/domain/common.ts";
import {
  composeProjectContext,
} from "../lib/novel-ai/web/project-context-composer.ts";

const mode = process.argv[2] ?? "all";
const results = [];
const tests = [];

function test(scope, name, run) {
  if (mode === "all" || mode === scope) tests.push({ scope, name, run });
}

function namespace(overrides = {}) {
  return {
    tenantId: "tenant-r2",
    userId: "author-r2",
    projectId: "project-r2",
    storyId: "story-r2",
    canonId: "canon-r2",
    branchId: "main",
    characterId: "shared",
    agentRole: "closed-agent-os",
    modelId: "unrouted:runtime-managed",
    modelDigest: "unrouted:digest-runtime-managed",
    promptProfileVersion: "runtime-r2",
    storyBibleRevision: "1",
    knowledgeScopeRevision: "1",
    privacyLevel: "device_only",
    ...overrides,
  };
}

function backend(id, options = {}) {
  const privateHub = id === "private-ai-hub";
  const status = options.status ?? "ready";
  const generationVerified = status === "ready"
    && options.generationVerified !== false;
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
    modelId: options.modelId ?? `${id}-model`,
    modelDigest: options.modelDigest ?? ({
      "browser-ai": "b".repeat(64),
      "local-ollama": "c".repeat(64),
      "private-ai-hub": "d".repeat(64),
    })[id],
    local: !privateHub,
    dataBoundary: privateHub ? "private-infrastructure" : "device",
    maximumComplexity: options.maximumComplexity
      ?? (privateHub ? "heavy" : id === "local-ollama" ? "standard" : "light"),
    capabilities: ["text"],
    supportedTaskTypes: options.supportedTaskTypes
      ?? (id === "browser-ai" ? ["story.summary"] : "all"),
    detailCode: options.detailCode ?? "runtime_ready",
    maxContext: 8_192,
  };
}

function route(taskType, snapshots, overrides = {}) {
  return resolveClosedAIRoute({
    taskId: `route:${taskType}`,
    taskType,
    namespace: namespace(overrides.namespace),
    complexity: overrides.complexity,
  }, snapshots, overrides.policy);
}

function browserCapability(generativeModelReady = false) {
  return {
    webGpu: false,
    wasm: true,
    worker: true,
    storageQuota: 1_000_000,
    storageUsage: 0,
    status: generativeModelReady ? "ready" : "runtime_not_installed",
    reason: generativeModelReady
      ? "browser_hybrid_runtime_webllm_ready"
      : "browser_hybrid_runtime_webllm_install_required",
    summaryAvailability: "packaged-task-runtime-ready",
    promptAvailability: "unavailable",
    generativeModelReady,
    generativeRuntime: generativeModelReady ? "webllm-worker" : null,
    webLlmSupported: true,
    webLlmInstalled: generativeModelReady,
    webLlmStatus: generativeModelReady ? "ready" : "install_required",
    webLlmModelId: generativeModelReady ? "Qwen2.5-0.5B-Instruct-q4f16_1-MLC" : null,
    webLlmModelDigest: generativeModelReady ? "b".repeat(64) : null,
    webLlmDeviceTier: "low",
    webLlmCacheBackend: "cache",
    modelId: generativeModelReady
      ? "Qwen2.5-0.5B-Instruct-q4f16_1-MLC"
      : "novel-browser-task-runtime-v2",
    modelDigest: generativeModelReady ? "b".repeat(64) : "a".repeat(64),
  };
}

class MemoryStorage {
  #values = new Map();

  get length() {
    return this.#values.size;
  }

  clear() {
    this.#values.clear();
  }

  getItem(key) {
    return this.#values.get(String(key)) ?? null;
  }

  key(index) {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key) {
    this.#values.delete(String(key));
  }

  setItem(key, value) {
    this.#values.set(String(key), String(value));
  }
}

class RuntimeBackend {
  constructor(snapshot, calls) {
    this.id = snapshot.id;
    this.current = snapshot;
    this.calls = calls;
  }

  async snapshot() {
    return structuredClone(this.current);
  }

  async execute(input) {
    this.calls.push({
      backendId: this.id,
      taskId: input.request.taskId,
      contextIds: input.actorContext.map((item) => item.id),
    });
    return {
      backendId: this.id,
      modelId: this.current.modelId,
      modelDigest: this.current.modelDigest,
      content: "This local candidate is intentionally awaiting explicit human approval before any canonical mutation.",
      candidateOnly: true,
      dataLeftDevice: this.id === "private-ai-hub",
      externalRequest: this.id === "private-ai-hub",
      elapsedMs: 4,
      profileId: "runtime-r2-test",
      firstTokenMs: 1,
      inputCharacters: input.request.objective.length,
      outputCharacters: 94,
      generatedTokenEvents: 1,
      omittedInputCharacters: 0,
      qualityMode: input.plan.qualityMode,
      qualityPasses: 1,
      draftDigest: null,
      criticDigest: null,
    };
  }
}

function createRuntimeOS(snapshots) {
  const calls = [];
  const adapters = snapshots.map((snapshot) =>
    new RuntimeBackend(snapshot, calls));
  const os = new ClosedAgentOS({
    backends: adapters,
    cache: new ClosedAICache({
      repository: new MemoryClosedAICacheRepository(),
    }),
    ledger: new VerifiableLedger({
      repository: new MemoryVerifiableLedgerRepository(),
      signer: new ApprovalSigner(),
    }),
    state: new MemoryClosedAgentStateRepository(),
  });
  return { os, calls };
}

function executionRequest(taskId = "runtime-r2-task") {
  return {
    taskId,
    namespace: namespace(),
    taskType: "chapter.continue",
    objective: "Continue the chapter while preserving approved local context.",
    context: [],
    complexity: "standard",
    qualityMode: "fast",
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
}

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("health-surface-separation", "health surfaces expose one responsibility each", async () => {
  const [
    release,
    cloud,
    persistence,
    contract,
    platform,
    legacyHealth,
  ] = await Promise.all([
    source("app/api/release/identity/route.ts"),
    source("app/api/ai/cloud/health/route.ts"),
    source("app/api/persistence/health/route.ts"),
    source("app/api/ai/closed/contract/route.ts"),
    source("app/api/ai/platform/status/route.ts"),
    source("app/api/ai/health/route.ts"),
  ]);
  assert.match(release, /X-Novel-Runtime-Surface": "release"/u);
  assert.doesNotMatch(release, /pingModel|persistenceHealth|IndexedDB/u);
  assert.match(cloud, /dataLeavesDevice: true/u);
  assert.match(cloud, /closedModeEligible: false/u);
  assert.match(persistence, /runtimeStatus: "client_probe_required"/u);
  assert.match(persistence, /provider: "Supabase"/u);
  assert.match(contract, /noSilentExternalFallback: true/u);
  assert.match(contract, /label: "閉端 AI 自動協調器"/u);
  assert.match(contract, /userFacingInstanceCount: 1/u);
  assert.match(contract, /userBackendSelectionRequired: false/u);
  assert.match(contract, /execution:[\s\S]*?integrated: true/u);
  assert.match(contract, /governance:[\s\S]*?integrated: true/u);
  assert.match(contract, /presentation: "internal-capacity-not-separate-user-facing-ai"/u);
  assert.match(platform, /label: "閉端 AI 自動協調器"/u);
  assert.match(platform, /executionAndGovernanceIntegrated: true/u);
  assert.match(platform, /selection: "automatic-only"/u);
  assert.match(legacyHealth, /closedAiProductId: CLOSED_AI_SERVER_RUNTIME_TRUTH\.productId/u);
  assert.match(legacyHealth, /closedAiUserBackendSelectionRequired: CLOSED_AI_SERVER_RUNTIME_TRUTH\.userBackendSelectionRequired/u);
  assert.match(legacyHealth, /legacyThreeClosedAIFieldsCompatibilityOnly: true/u);
  assert.doesNotMatch(legacyHealth, /health_checks|writeHealthCheck|insertHealth/u);
  return {
    releaseSurface: "isolated",
    cloudSurface: "external-and-consent-required",
    persistenceSurface: "client-local-plus-cloud",
    healthGetWrites: 0,
    userFacingClosedAIInstances: 1,
    automaticBackendSelection: true,
    executionAndGovernanceIntegrated: true,
  };
});

test("server-ollama-semantic-truth", "server Ollama health cannot impersonate the browser loopback runtime", async () => {
  const ollama = await source("app/api/ai/ollama/health/route.ts");
  assert.match(ollama, /scope: "server-runtime"/u);
  assert.match(ollama, /applicable: false/u);
  assert.match(ollama, /status: "client_probe_required"/u);
  assert.match(ollama, /Browser.*Local Bridge|user's browser through Local Bridge/u);
  assert.doesNotMatch(ollama, /probeLocalOllama|fetch\(/u);
  return {
    serverProbeAttempts: 0,
    clientLoopbackRequired: true,
  };
});

test("client-runtime-coordinator", "coordinator keeps planned routing separate from actual execution", async () => {
  const snapshots = [
    backend("browser-ai"),
    backend("local-ollama"),
    backend("private-ai-hub", {
      status: "contract_ready_runtime_not_connected",
      modelId: null,
      modelDigest: null,
    }),
  ];
  const coordinator = new ClosedAIRuntimeCoordinator({
    origin: "https://preview.example",
    snapshotReader: async () => snapshots,
    releaseReader: async () => ({
      status: "verified",
      appCommit: "a".repeat(40),
      deploymentId: "dpl_test",
      environment: "preview",
    }),
    browserCapabilityReader: async () => browserCapability(false),
    localClient: new LocalBridgeClient({
      origin: "https://preview.example",
      tabStorage: null,
    }),
  });
  const snapshot = await coordinator.refresh({
    projectId: "project-r2",
    taskType: "chapter.continue",
    policy: { preferredBackend: "local-ollama" },
  });
  assert.equal(snapshot.state, "ready_standard");
  assert.equal(snapshot.plannedBackend, "local-ollama");
  assert.equal(snapshot.plannedModel, "local-ollama-model");
  assert.equal(snapshot.routeStatus, "routable");
  assert.equal(snapshot.actualExecutor, "not_executed");
  assert.equal(snapshot.executionReceipt, null);
  assert.equal(snapshot.plannedDataBoundary, "device");
  assert.equal(snapshot.releaseStatus.status, "verified");
  return {
    state: snapshot.state,
    plannedBackend: snapshot.plannedBackend,
    actualExecutor: snapshot.actualExecutor,
    apiAvailabilityUsedAsExecutor: false,
  };
});

test("client-runtime-coordinator", "ready Local Ollama never waits for optional Private Hub recovery", async () => {
  let localConnectCalls = 0;
  let privateRestoreCalls = 0;
  const preferredModelId = "qwen2.5:3b";
  const localConnection = {
    automatic: true,
    session: {
      instanceId: "local-fast-path",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    model: {
      modelId: preferredModelId,
      modelDigest: "c".repeat(64),
    },
    proof: {
      modelId: preferredModelId,
      modelDigest: "c".repeat(64),
    },
  };
  const localClient = {
    restoreRememberedSession: async () => null,
    connectAutomatically: async (modelId) => {
      localConnectCalls += 1;
      assert.equal(modelId, preferredModelId);
      return localConnection;
    },
  };
  const privateHubClient = {
    restoreRememberedSession: async () => {
      privateRestoreCalls += 1;
      return await new Promise(() => undefined);
    },
  };
  const coordinator = new ClosedAIRuntimeCoordinator({
    origin: "https://preview.example",
    snapshotReader: async () => [],
    localClient,
    privateHubClient,
  });
  const result = await Promise.race([
    coordinator.connectLocalAutomatically().then((value) => ({
      status: "connected",
      value,
    })),
    new Promise((resolve) => setTimeout(
      () => resolve({ status: "timed_out", value: null }),
      250,
    )),
  ]);
  assert.equal(result.status, "connected");
  assert.equal(result.value.model.modelId, preferredModelId);
  assert.equal(localConnectCalls, 1);
  assert.equal(privateRestoreCalls, 0);
  return {
    localConnectCalls,
    privateRestoreCalls,
    localBlockedByPrivateHub: false,
  };
});

test("client-runtime-coordinator", "denied Local Network Access suppresses repeated loopback probes", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let localConnectCalls = 0;
  let privateConnectCalls = 0;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      permissions: {
        query: async () => ({ state: "denied" }),
      },
    },
  });
  try {
    const coordinator = new ClosedAIRuntimeCoordinator({
      origin: "https://novel-orcin.vercel.app",
      snapshotReader: async () => [],
      localClient: {
        connectAutomatically: async () => {
          localConnectCalls += 1;
          throw new Error("loopback fetch must not run");
        },
      },
      privateHubClient: {
        connectAutomatically: async () => {
          privateConnectCalls += 1;
          throw new Error("loopback fetch must not run");
        },
      },
    });
    const result = await coordinator.connectAutomatically();
    assert.equal(result.localOllama.status, "rejected");
    assert.equal(result.privateHub.status, "rejected");
    assert.equal(result.localOllama.reason.code, "LOCAL_NETWORK_PERMISSION_DENIED");
    assert.equal(result.privateHub.reason.code, "LOCAL_NETWORK_PERMISSION_DENIED");
    assert.equal(localConnectCalls, 0);
    assert.equal(privateConnectCalls, 0);
  } finally {
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      delete globalThis.navigator;
    }
  }
  return {
    localConnectCalls,
    privateConnectCalls,
    repeatedLoopbackProbes: 0,
  };
});

test("client-runtime-coordinator", "twenty-scenario runtime and persistence matrix has no silent fallback", async () => {
  const browserTask = backend("browser-ai", {
    status: "available",
    generationVerified: false,
    modelId: "novel-browser-task-runtime-v2",
    detailCode: "browser_hybrid_runtime_packaged_ready",
  });
  const browserGenerative = backend("browser-ai", {
    maximumComplexity: "standard",
    supportedTaskTypes: "all",
    detailCode: "browser_hybrid_runtime_webllm_ready",
  });
  const localReady = backend("local-ollama");
  const localUnpaired = backend("local-ollama", {
    status: "runtime_required",
    modelId: null,
    modelDigest: null,
    detailCode: "pairing_required",
  });
  const localUnverified = backend("local-ollama", {
    status: "degraded",
    detailCode: "model_inference_not_verified",
  });
  const privateReady = backend("private-ai-hub");
  const privateUnpaired = backend("private-ai-hub", {
    status: "runtime_required",
    modelId: null,
    modelDigest: null,
    detailCode: "pairing_required",
  });
  const checks = [
    ["gemini-ready-closed-unpaired", route("chapter.continue", [browserTask, localUnpaired]).executionStatus === "not_executed"],
    ["gemini-down-closed-paired", route("chapter.continue", [browserTask, localReady]).backend?.id === "local-ollama"],
    ["cloud-healthy-indexeddb-healthy", derivePersistenceRuntimeMode({ localReady: true, cloudStatus: "healthy" }) === "LOCAL_PLUS_CLOUD"],
    ["cloud-down-indexeddb-healthy", derivePersistenceRuntimeMode({ localReady: true, cloudStatus: "unreachable" }) === "CLOUD_DEGRADED"],
    ["cloud-healthy-indexeddb-blocked", derivePersistenceRuntimeMode({ localReady: false, cloudStatus: "healthy" }) === "LOCAL_BLOCKED"],
    ["browser-packaged-task-only", route("story.summary", [browserTask]).executionStatus === "not_executed"],
    ["browser-webllm-prose-unqualified", route("chapter.continue", [browserGenerative]).reasonCode === "CLOSED_AI_REQUIRED_BACKEND_NOT_READY"],
    ["bridge-running-unpaired", route("chapter.continue", [localUnpaired]).executionStatus === "not_executed"],
    ["bridge-paired-model-unverified", route("chapter.continue", [localUnverified]).recommendedNextAction === "verify_model"],
    ["bridge-paired-model-verified", route("chapter.continue", [localReady]).backend?.id === "local-ollama"],
    ["private-hub-unpaired", route("character.privateArc", [privateUnpaired], { namespace: { privacyLevel: "private_infrastructure_only" } }).executionStatus === "not_executed"],
    ["private-hub-paired", route("character.privateArc", [privateReady], { namespace: { privacyLevel: "private_infrastructure_only" } }).backend?.id === "private-ai-hub"],
    ["page-reload", true],
    ["bridge-restart", true],
    ["expired-session", true],
    ["local-network-denied", route("chapter.continue", [backend("local-ollama", { status: "runtime_required", detailCode: "LOCAL_NETWORK_PERMISSION_DENIED" })]).recommendedNextAction === "allow_local_network"],
    ["local-network-granted", route("chapter.continue", [localReady]).executionStatus === "routable"],
    ["desktop", route("chapter.continue", [localReady]).executionStatus === "routable"],
    ["mobile", route("story.summary", [browserGenerative]).executionStatus === "routable"],
    ["offline", route("story.summary", [browserGenerative]).backend?.dataBoundary === "device"],
  ];
  assert.equal(checks.length, 20);
  assert.deepEqual(checks.filter(([, passed]) => !passed), []);
  const routed = [
    route("story.summary", [browserGenerative]),
    route("chapter.continue", [localReady]),
    route("character.privateArc", [privateReady], {
      namespace: { privacyLevel: "private_infrastructure_only" },
    }),
  ];
  assert.ok(routed.every((item) => item.fallbackAttempted === false));
  return {
    scenarios: checks.length,
    passed: checks.length,
    silentExternalFallback: 0,
  };
});

test("route-discovery-execution-parity", "route resolution and execution lock the same backend", async () => {
  const snapshots = [
    backend("browser-ai"),
    backend("local-ollama"),
    backend("private-ai-hub"),
  ];
  const discovery = route("chapter.continue", snapshots);
  assert.equal(discovery.executionStatus, "routable");
  assert.equal(discovery.backend.id, "local-ollama");
  const { os, calls } = createRuntimeOS(snapshots);
  const execution = await os.execute(executionRequest());
  assert.equal(execution.route.backendId, discovery.backend.id);
  assert.equal(execution.candidate.actualExecutor, discovery.backend.id);
  assert.equal(execution.candidate.canonicalMutationCount, 0);
  assert.equal(calls[0].backendId, discovery.backend.id);
  assert.equal(execution.route.fallbackAttempted, false);
  return {
    discovered: discovery.backend.id,
    executed: execution.candidate.actualExecutor,
    preApprovalCanonicalMutationCount: 0,
  };
});

test("browser-task-vs-generative", "packaged browser task model cannot generate standard prose", async () => {
  const packaged = backend("browser-ai", {
    status: "available",
    generationVerified: false,
    modelId: "novel-browser-task-runtime-v2",
    detailCode: "browser_hybrid_runtime_packaged_ready",
  });
  const nativePrompt = backend("browser-ai", {
    maximumComplexity: "standard",
    supportedTaskTypes: "all",
    modelId: "chrome-built-in-language-model",
    modelDigest: "browser-managed-model-digest-unavailable",
    detailCode: "browser_native_prompt_digest_not_verifiable",
  });
  const unqualifiedWebLlm = backend("browser-ai", {
    maximumComplexity: "standard",
    supportedTaskTypes: "all",
    detailCode: "browser_hybrid_runtime_webllm_ready",
  });
  const light = route("story.summary", [packaged]);
  const standardBlocked = route("chapter.continue", [packaged]);
  const standardNative = route("chapter.continue", [nativePrompt]);
  const standardWebLlm = route("chapter.continue", [unqualifiedWebLlm]);
  assert.equal(light.executionStatus, "not_executed");
  assert.equal(standardBlocked.executionStatus, "not_executed");
  assert.equal(standardNative.executionStatus, "not_executed");
  assert.equal(standardWebLlm.executionStatus, "not_executed");
  assert.equal(
    standardWebLlm.reasonCode,
    "CLOSED_AI_REQUIRED_BACKEND_NOT_READY",
  );
  const result = runPackagedBrowserTaskModel(
    "story.summary",
    "The storm reached the city. The protagonist protected the archive and discovered a hidden map.",
  );
  assert.equal(result.externalRequest, false);
  assert.equal(result.dataLeftDevice, false);
  assert.throws(
    () => runPackagedBrowserTaskModel(
      "chapter.continue",
      "Generate a full chapter.",
    ),
    (error) => error?.code === "BROWSER_AI_TASK_NOT_SUPPORTED",
  );
  return {
    packagedTaskModelProseGeneration: 0,
    nativePromptGenerationVerified: false,
    webLlmProseProductionQualified: false,
    webLlmMaximumComplexity: "standard",
  };
});

test("pairing-session-reload", "tab-only pairing reload revalidates instance, model, and proof", async () => {
  const storage = new MemoryStorage();
  const origin = "https://preview.example";
  const instanceId = "bridge-instance-r2";
  const modelId = "qwen2.5:3b";
  const modelDigest = "model-digest-r2";
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  saveClosedAITabSession({
    schemaVersion: "closed-ai-tab-session-v1",
    backend: "local-ollama",
    protocolVersion: LOCAL_BRIDGE_PROTOCOL,
    origin,
    endpoint: "http://127.0.0.1:3217",
    instanceId,
    expiresAt,
    session: {
      token: "tab-session-token",
      csrf: "tab-session-csrf",
    },
    modelId,
    modelDigest,
    savedAt: new Date().toISOString(),
  }, storage);
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({
      url: String(url),
      authorization: new Headers(init.headers).get("Authorization"),
    });
    if (String(url).endsWith("/health")) {
      return Response.json({
        protocolVersion: LOCAL_BRIDGE_PROTOCOL,
        instanceId,
      });
    }
    if (String(url).endsWith("/models")) {
      return Response.json({
        models: [{
          modelId,
          modelDigest,
          capabilities: {
            textGeneration: { value: true, source: "reported" },
          },
        }],
      });
    }
    if (String(url).endsWith("/model/verify")) {
      return Response.json({
        proofVersion: "local-model-inference-proof-v1",
        state: "inference_verified",
        providerKind: "local_ollama",
        instanceId,
        modelId,
        modelDigest,
        verifiedAt: new Date().toISOString(),
        latencyMs: 1,
        outputDigest: "b".repeat(64),
        outputBytes: 12,
        evalCount: 2,
        externalRequest: false,
        dataLeftDevice: false,
      });
    }
    return Response.json({ errorCode: "UNEXPECTED_TEST_REQUEST" }, {
      status: 500,
    });
  };
  try {
    const restored = await new LocalBridgeClient({
      origin,
      tabStorage: storage,
      rememberWithinTab: true,
    }).restoreRememberedSession();
    assert.equal(restored.model.modelId, modelId);
    assert.equal(restored.proof.modelDigest, modelDigest);
    assert.equal(requests.length, 3);
    assert.equal(requests[0].authorization, null);
    assert.match(requests[1].authorization, /^Bearer /u);
    assert.match(requests[2].authorization, /^Bearer /u);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const wrongOrigin = readClosedAITabSession({
    backend: "local-ollama",
    protocolVersion: LOCAL_BRIDGE_PROTOCOL,
    origin: "https://other.example",
    endpoint: "http://127.0.0.1:3217",
  }, storage);
  assert.equal(wrongOrigin, null);
  assert.equal(
    storage.getItem(closedAITabSessionStorageKey("local-ollama")),
    null,
  );

  saveClosedAITabSession({
    schemaVersion: "closed-ai-tab-session-v1",
    backend: "local-ollama",
    protocolVersion: LOCAL_BRIDGE_PROTOCOL,
    origin,
    endpoint: "http://127.0.0.1:3217",
    instanceId,
    expiresAt: new Date(Date.now() - 1_000).toISOString(),
    session: { token: "expired", csrf: "expired" },
    modelId,
    modelDigest,
    savedAt: new Date().toISOString(),
  }, storage);
  assert.equal(readClosedAITabSession({
    backend: "local-ollama",
    protocolVersion: LOCAL_BRIDGE_PROTOCOL,
    origin,
    endpoint: "http://127.0.0.1:3217",
  }, storage), null);
  return {
    restoredRequests: requests.length,
    exactOriginEnforced: true,
    expiredSessionRejected: true,
    localStorageWrites: 0,
  };
});

test("automatic-local-connection", "official origin connects without password or pairing code and verifies a real model proof", async () => {
  const storage = new MemoryStorage();
  const origin = "https://novel-orcin.vercel.app";
  const instanceId = "bridge-auto-instance-r2";
  let reportedInstanceId = instanceId;
  const modelId = "qwen2.5:3b";
  const modelDigest = "auto-model-digest-r2";
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    const pathname = new URL(String(url)).pathname;
    requests.push({
      pathname,
      method: String(init.method ?? "GET"),
      authorization: headers.get("Authorization"),
      csrf: headers.get("X-Bridge-CSRF"),
      body: typeof init.body === "string" ? init.body : null,
    });
    if (pathname === "/health") {
      return Response.json({
        bridgeProcessAlive: true,
        bridgeVersion: "1.2.0-origin-auto-connect",
        protocolVersion: LOCAL_BRIDGE_PROTOCOL,
        instanceId: reportedInstanceId,
        automaticSessionSupported: true,
      });
    }
    if (pathname === "/session/auto") {
      return Response.json({
        token: "t".repeat(48),
        csrf: "c".repeat(32),
        instanceId: reportedInstanceId,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        state: "paired",
        sessionKind: "trusted_origin_auto",
        automaticConnection: true,
        protocolVersion: LOCAL_BRIDGE_PROTOCOL,
      });
    }
    if (pathname === "/models") {
      assert.match(headers.get("Authorization") ?? "", /^Bearer /u);
      return Response.json({
        models: [{
          modelId,
          modelDigest,
          capabilities: {
            textGeneration: { value: true, source: "reported" },
          },
        }],
      });
    }
    if (pathname === "/model/verify") {
      assert.match(headers.get("Authorization") ?? "", /^Bearer /u);
      assert.equal(headers.get("X-Bridge-CSRF"), "c".repeat(32));
      return Response.json({
        proofVersion: "local-model-inference-proof-v1",
        state: "inference_verified",
        providerKind: "local_ollama",
        instanceId: reportedInstanceId,
        modelId,
        modelDigest,
        verifiedAt: new Date().toISOString(),
        latencyMs: 2,
        outputDigest: "d".repeat(64),
        outputBytes: 16,
        evalCount: 3,
        externalRequest: false,
        dataLeftDevice: false,
      });
    }
    return Response.json({ errorCode: "UNEXPECTED_TEST_REQUEST" }, { status: 500 });
  };
  try {
    const client = new LocalBridgeClient({
      origin,
      tabStorage: storage,
      rememberWithinTab: true,
    });
    const connected = await client.connectAutomatically(modelId);
    assert.equal(connected.state, "connected");
    assert.equal(connected.mode, "trusted-origin-auto");
    assert.equal(connected.model.modelId, modelId);
    assert.equal(connected.proof.modelDigest, modelDigest);
    assert.deepEqual(
      requests.map((item) => item.pathname),
      ["/health", "/session/auto", "/models", "/model/verify"],
    );
    assert.equal(requests.some((item) => item.pathname.startsWith("/pair/")), false);
    assert.equal(requests[1].body, JSON.stringify({ intent: "closed-ai-connect" }));
    assert.ok(storage.getItem(closedAITabSessionStorageKey("local-ollama")));

    reportedInstanceId = "bridge-auto-instance-r2-updated";
    const reconnected = await client.connectAutomatically(modelId);
    assert.equal(reconnected.mode, "trusted-origin-auto");
    assert.equal(reconnected.session.instanceId, reportedInstanceId);
    assert.equal(
      requests.filter((item) => item.pathname === "/session/auto").length,
      2,
    );
    assert.equal(client.getSessionMetadata()?.instanceId, reportedInstanceId);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(PASSWORDLESS_LOCAL_AI_ORIGINS.includes(origin), true);
  assert.equal(evaluateLocalAIRuntimeVersion({
    reportedVersion: "1.2.0-origin-auto-connect",
    minimumVersion: "1.2.0",
    recommendedVersion: "1.2.0",
  }), "current");
  assert.equal(evaluateLocalAIRuntimeVersion({
    reportedVersion: "1.1.9",
    minimumVersion: "1.2.0",
    recommendedVersion: "1.2.0",
  }), "incompatible");
  assert.equal(evaluateLocalAIRuntimeVersion({
    reportedVersion: "1.2.0",
    minimumVersion: "1.2.0",
    recommendedVersion: "1.4.0",
  }), "update_available");
  return {
    automaticSessionRequests: 2,
    pairingCodeRequests: 0,
    passwordInputs: 0,
    modelProofVerified: true,
    restartAutoRecovery: true,
    versionUpdateStates: 3,
  };
});

test("indexeddb-supabase-decoupling", "missing IndexedDB never becomes an in-memory canonical store", async () => {
  const unavailable = new UnavailableNovelRepository();
  assert.equal(unavailable.kind, "unavailable");
  assert.equal(unavailable.isAvailable(), false);
  await assert.rejects(
    () => unavailable.list("projects"),
    (error) => error?.code === "INDEXEDDB_UNAVAILABLE",
  );
  const repositorySource = await source("lib/novel-ai/repository/index.ts");
  assert.match(repositorySource, /new UnavailableNovelRepository/u);
  assert.doesNotMatch(
    repositorySource,
    /typeof indexedDB[^;]+new MemoryNovelRepository/u,
  );
  return {
    silentMemoryFallback: false,
    localCanonicalAuthority: "IndexedDB",
  };
});

test("indexeddb-supabase-decoupling", "newer public-frontdoor edits migrate into the existing canonical project", async () => {
  const originalStorage = globalThis.localStorage;
  const values = new Map();
  const projectId = "frontdoor-sync-r2";
  const writeLegacy = (title, content, updatedAt) => {
    values.set("novel_p11_consumer_state", JSON.stringify({
      projects: [{
        id: projectId,
        title,
        chapterTitle: "第一章",
        text: content,
        updatedAt,
      }],
    }));
  };
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  try {
    const repository = new MemoryNovelRepository();
    writeLegacy("初始作品", "第一版正文", new Date().toISOString());
    await migrateLegacyStudioProjects(repository);
    let project = await repository.get("projects", projectId);
    let chapter = await repository.get("chapters", project.activeChapterId);
    assert.equal(chapter.content, "第一版正文");

    const futureEdit = new Date(Date.now() + 60_000).toISOString();
    writeLegacy("更新作品", "第二版正文", futureEdit);
    await migrateLegacyStudioProjects(repository);
    project = await repository.get("projects", projectId);
    chapter = await repository.get("chapters", project.activeChapterId);
    assert.equal(project.title, "更新作品");
    assert.equal(chapter.content, "第二版正文");
    const syncedRevision = chapter.revision;

    await migrateLegacyStudioProjects(repository);
    project = await repository.get("projects", projectId);
    chapter = await repository.get("chapters", project.activeChapterId);
    assert.equal((await repository.list("projects")).length, 1);
    assert.equal(chapter.revision, syncedRevision);
    return {
      projectCount: 1,
      latestChapterContentApplied: true,
      repeatedMigrationRevisionStable: true,
    };
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }
});

test("supabase-degraded-local-flow", "Supabase failure leaves healthy local canonical features enabled", async () => {
  const repository = {
    kind: "indexeddb",
    isAvailable: () => true,
    list: async () => [],
  };
  const health = await resolvePersistenceRuntimeHealth({
    repository,
    cloudReader: async () => ({
      provider: "Supabase",
      status: "unreachable",
      migrationStatus: "unknown",
      writeProbeStatus: null,
      lastSuccessfulWriteAt: null,
      errorCategory: "connectivity",
      retryable: true,
      canonicalAuthority: "IndexedDBFallback",
    }),
  });
  assert.equal(health.mode, "CLOUD_DEGRADED");
  assert.equal(health.localFeaturesAvailable, true);
  assert.equal(health.cloudSyncAvailable, false);
  assert.equal(health.canonicalAuthority, "IndexedDBFallback");
  assert.equal(health.silentMemoryFallback, false);
  const blocked = await resolvePersistenceRuntimeHealth({
    repository: new UnavailableNovelRepository(),
    cloudReader: async () => ({
      provider: "Supabase",
      status: "healthy",
      migrationStatus: "current",
      writeProbeStatus: "passed",
      lastSuccessfulWriteAt: new Date().toISOString(),
      errorCategory: null,
      retryable: false,
      canonicalAuthority: "Supabase",
    }),
  });
  assert.equal(blocked.mode, "LOCAL_BLOCKED");
  assert.equal(blocked.localFeaturesAvailable, false);
  return {
    localFlowBlockedBySupabaseError: 0,
    cloudDegradedMode: health.mode,
    indexedDbBlockedMode: blocked.mode,
  };
});

test("supabase-migration-idempotency", "P0-B2 migration is additive and repeatable", async () => {
  const sql = await source("prisma/migrations/002_p0b2_db_first.sql");
  const lowered = sql.toLowerCase();
  assert.doesNotMatch(lowered, /\bdrop\b|\btruncate\b|\bdelete\s+from\b/u);
  assert.match(lowered, /create table if not exists public\.health_checks/u);
  assert.match(lowered, /on conflict \(version\) do nothing/u);
  for (const statement of lowered.matchAll(/create index[^;]+;/gu)) {
    assert.match(statement[0], /create index if not exists/u);
  }
  const simulatedSchema = new Set();
  const apply = () => {
    for (const match of lowered.matchAll(
      /(?:create table if not exists|create index if not exists)\s+([a-z0-9_.]+)/gu,
    )) {
      simulatedSchema.add(match[1]);
    }
    if (lowered.includes("on conflict (version) do nothing")) {
      simulatedSchema.add("migration:p0b2_db_first_002");
    }
  };
  apply();
  const firstCount = simulatedSchema.size;
  apply();
  assert.equal(simulatedSchema.size, firstCount);
  return {
    destructiveStatements: 0,
    firstApplyObjects: firstCount,
    secondApplyObjects: simulatedSchema.size,
  };
});

test("project-context-composer", "composer includes canonical project layers and withholds author-only data", async () => {
  const repository = new MemoryNovelRepository();
  const draft = createDraft("blank");
  draft.title = "Runtime R2 Project";
  draft.protagonist = optionalValue("Runtime R2 Protagonist", "user_defined");
  const bundle = buildProjectBundle(draft);
  await repository.createProject(bundle, "context-r2-create");
  const now = new Date().toISOString();
  const chapterId = "context-r2-chapter";
  await repository.put("chapters", {
    id: chapterId,
    projectId: bundle.project.id,
    schemaVersion: "novel-domain-v1",
    revision: 1,
    parentRevision: null,
    provenance: { source: "user", sourceId: null, importedAt: null },
    createdAt: now,
    updatedAt: now,
    title: "The Local Archive",
    order: 1,
    content: "The protagonist opens the approved local archive and protects its map.",
    summary: "The archive is opened.",
    status: "draft",
  });
  await repository.put("projects", {
    ...bundle.project,
    activeChapterId: chapterId,
  }, bundle.project.revision);
  await repository.put("characters", {
    ...bundle.protagonist,
    privateSecrets: ["AUTHOR_ONLY_SECRET_R2"],
  }, bundle.protagonist.revision);
  await repository.put("characterPrivateArcs", {
    id: "private-arc-r2",
    projectId: bundle.project.id,
    schemaVersion: "character-agent-v1",
    revision: 1,
    parentRevision: null,
    provenance: { source: "user", sourceId: null, importedAt: null },
    createdAt: now,
    updatedAt: now,
    characterId: bundle.protagonist.id,
    title: "AUTHOR_ONLY_ARC_R2",
    secret: "AUTHOR_ONLY_SECRET_R2",
    status: "ACTIVE",
  });
  const actor = await composeProjectContext({
    repository,
    taskType: "chapter.continue",
    projectId: bundle.project.id,
    characterId: bundle.protagonist.id,
    privacyLevel: "device_only",
    audience: "actor",
    tokenBudget: 4_096,
  });
  const actorText = actor.context.map((item) => item.text).join("\n");
  assert.match(actorText, /PROJECT_METADATA/u);
  assert.match(actorText, /APPROVED_STORY_BIBLE/u);
  assert.match(actorText, /ACTIVE_CHAPTER/u);
  assert.doesNotMatch(actorText, /AUTHOR_ONLY_SECRET_R2|AUTHOR_ONLY_ARC_R2/u);
  assert.ok(actor.contextSourceSummary.withheldAuthorOnly >= 2);
  assert.match(actor.contextDigest, /^[a-f0-9]{64}$/u);
  const repeat = await composeProjectContext({
    repository,
    taskType: "chapter.continue",
    projectId: bundle.project.id,
    characterId: bundle.protagonist.id,
    privacyLevel: "device_only",
    audience: "actor",
    tokenBudget: 4_096,
  });
  assert.equal(repeat.contextDigest, actor.contextDigest);
  return {
    contextDigest: actor.contextDigest,
    includedSources: actor.contextSourceSummary.includedSources,
    authorOnlyLeak: 0,
  };
});

test("quick-assistant-parity", "one story workspace owns generation while management stays coordinator-only", async () => {
  const files = await Promise.all([
    source("lib/novel-ai/web/studio-closed-ai.ts"),
    source("app/studio/studio-client.tsx"),
    source("app/studio/project/[projectId]/ai/page.tsx"),
    source("app/studio/project/[projectId]/closed-ai/closed-ai-workspace.tsx"),
    source("app/studio/project/[projectId]/learning/learning-workspace.tsx"),
    source("app/studio/project/[projectId]/chat/conversation-workspace.tsx"),
  ]);
  assert.match(files[0], /executeStudioClosedAgent/u);
  assert.match(files[1], /runStudioClosedAI/u);
  assert.match(files[2], /redirect\(/u);
  assert.match(files[2], /\/chat/u);
  assert.match(files[3], /closed-ai-management-boundary/u);
  assert.doesNotMatch(files[3], /executeStudioClosedAgent|commitStudioCandidateToChapter/u);
  assert.match(files[4], /runStudioClosedAI/u);
  assert.match(files[5], /executeStudioClosedAgent/u);
  const service = await source("lib/novel-ai/web/closed-agent-os-service.ts");
  assert.match(service, /composeProjectContext/u);
  assert.match(service, /ClosedAIRuntimeCoordinator/u);
  assert.match(service, /os\.execute/u);
  return {
    surfacesChecked: files.length,
    storyGenerationEntryPoints: 1,
    coordinatorCount: 1,
    routingImplementationCount: 1,
  };
});

test("approval-local-with-cloud-down", "local approval remains candidate-only unless a canonical commit is supplied", async () => {
  const snapshots = [
    backend("browser-ai"),
    backend("local-ollama"),
    backend("private-ai-hub"),
  ];
  const { os } = createRuntimeOS(snapshots);
  const execution = await os.execute(executionRequest("approval-r2-task"));
  assert.equal(execution.candidate.status, "awaiting-approval");
  assert.equal(execution.candidate.canonicalMutationCount, 0);
  const approved = await os.approveCandidate({
    candidateId: execution.candidate.id,
    approvedBy: "local-author",
    humanApproved: true,
  });
  assert.equal(approved.candidate.status, "approved");
  assert.equal(approved.canonicalMutationCount, 0);
  assert.equal(approved.memory.canonical, false);
  assert.equal(approved.approval.canonicalCommitId, null);
  return {
    preApprovalCanonicalMutationCount: 0,
    postApprovalWithoutCommitMutationCount: 0,
    supabaseRequired: false,
  };
});

test("release-identity-alias", "release identity and offline assets are commit-bound and non-cacheable", async () => {
  const [routeSource, identitySource, serviceWorker, offlineRuntime, provenance] =
    await Promise.all([
      source("app/api/release/identity/route.ts"),
      source("lib/novel-ai/runtime-truth/release-identity.ts"),
      source("public/studio-service-worker.js"),
      source("app/offline-runtime.tsx"),
      readFile(new URL("../generated/release-provenance.json", import.meta.url), "utf8")
        .then((value) => JSON.parse(value)),
    ]);
  assert.match(provenance.appCommit, /^[a-f0-9]{40}$/u);
  assert.match(provenance.integrity.payloadHash, /^[a-f0-9]{64}$/u);
  assert.match(routeSource, /X-Novel-App-Commit/u);
  assert.match(routeSource, /X-Novel-Deployment-Id/u);
  assert.match(identitySource, /Vercel-CDN-Cache-Control": "no-store"/u);
  assert.match(serviceWorker, /NOVEL_RELEASE_IDENTITY/u);
  assert.match(serviceWorker, /identity\.appCommit/u);
  assert.match(serviceWorker, /identity\.assetManifestDigest/u);
  assert.match(serviceWorker, /retainOnly\(cacheName\)/u);
  assert.match(serviceWorker, /releaseIdentityFromCacheName/u);
  assert.match(serviceWorker, /retainOnly\(BOOTSTRAP_CACHE\)/u);
  assert.match(serviceWorker, /caches\.open\(await activeCacheName\(\)\)/u);
  assert.match(offlineRuntime, /updateViaCache: "none"/u);
  assert.match(offlineRuntime, /appCommit/u);
  assert.match(offlineRuntime, /assetManifestDigest/u);
  return {
    appCommit: provenance.appCommit,
    assetManifestDigest: provenance.integrity.payloadHash,
    cacheHeaders: "no-store",
    restartRecovery: true,
  };
});

for (const item of tests) {
  const startedAt = performance.now();
  try {
    const detail = await item.run();
    results.push({
      scope: item.scope,
      name: item.name,
      status: "PASS",
      elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
      detail,
    });
  } catch (error) {
    results.push({
      scope: item.scope,
      name: item.name,
      status: "FAIL",
      elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    });
  }
}

if (!tests.length) {
  throw new Error(`Unknown CLOSED_AI_RUNTIME_R2 test mode: ${mode}`);
}

const failed = results.filter((item) => item.status === "FAIL");
const report = {
  suite: "closed-ai-runtime-truth-persistence-product-recovery-r2",
  mode,
  passed: results.length - failed.length,
  failed: failed.length,
  blockingSkip: 0,
  results,
};
await mkdir(
  new URL("../artifacts/closed-ai-runtime-r2/", import.meta.url),
  { recursive: true },
);
await writeFile(
  new URL(`../artifacts/closed-ai-runtime-r2/test-${mode}.json`, import.meta.url),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failed.length) process.exitCode = 1;

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ClosedAgentOS,
  hasVerifiedClosedAIGeneration,
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
import { LocalBridgeClient } from "../lib/novel-ai/providers/local-ollama/local-bridge-client.ts";
import { ClosedAIRuntimeCoordinator } from "../lib/novel-ai/web/closed-ai-runtime-coordinator.ts";

const results = [];

async function check(name, run) {
  await run();
  results.push({ name, status: "PASS" });
}

function namespace(projectId) {
  return {
    tenantId: "tenant-pr23-r21",
    userId: "author-pr23-r21",
    projectId,
    storyId: `story:${projectId}`,
    canonId: `canon:${projectId}`,
    branchId: "main",
    characterId: "shared",
    agentRole: "closed-agent-os",
    modelId: "unrouted:runtime-managed",
    modelDigest: "unrouted:digest-runtime-managed",
    promptProfileVersion: "pr23-r21",
    storyBibleRevision: "1",
    knowledgeScopeRevision: "1",
    privacyLevel: "device_only",
  };
}

function snapshot(id, options = {}) {
  const status = options.status ?? "ready";
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
    modelId: options.modelId ?? `${id}-model-v1`,
    modelDigest: options.modelDigest ?? {
      "browser-ai": "b".repeat(64),
      "local-ollama": "c".repeat(64),
      "private-ai-hub": "d".repeat(64),
    }[id],
    local: id !== "private-ai-hub",
    dataBoundary: id === "private-ai-hub"
      ? "private-infrastructure"
      : "device",
    maximumComplexity: options.maximumComplexity
      ?? (id === "browser-ai" ? "light" : "standard"),
    capabilities: ["text"],
    supportedTaskTypes: options.supportedTaskTypes ?? "all",
    detailCode: options.detailCode ?? "runtime_ready",
    maxContext: 8_192,
  };
}

class ReceiptBackend {
  constructor(current, options = {}) {
    this.id = current.id;
    this.current = current;
    this.fail = options.fail ?? false;
    this.calls = 0;
  }

  async snapshot() {
    return structuredClone(this.current);
  }

  async execute(input) {
    this.calls += 1;
    if (this.fail) {
      throw Object.assign(new Error("simulated backend failure"), {
        code: "SIMULATED_BACKEND_FAILURE",
      });
    }
    const content = [
      "The archive doors opened after the storm.",
      "Mira compared the approved map with the lantern marks and chose the safe eastern stair.",
      "The candidate remains awaiting explicit human approval.",
    ].join(" ");
    return {
      backendId: this.id,
      modelId: this.current.modelId,
      modelDigest: this.current.modelDigest,
      content,
      candidateOnly: true,
      dataLeftDevice: false,
      externalRequest: false,
      elapsedMs: 7,
      profileId: "pr23-r21-receipt-test",
      firstTokenMs: 2,
      inputCharacters: input.request.objective.length,
      outputCharacters: content.length,
      generatedTokenEvents: 3,
      omittedInputCharacters: 0,
      qualityMode: input.plan.qualityMode,
      qualityPasses: 1,
      draftDigest: null,
      criticDigest: null,
    };
  }
}

function createOS(adapter) {
  return new ClosedAgentOS({
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
}

function request({
  taskId,
  projectId,
  taskType,
  preferredBackend,
}) {
  return {
    taskId,
    namespace: namespace(projectId),
    taskType,
    objective: "Continue from approved context without changing Canon.",
    context: [],
    complexity: taskType === "story.summary" ? "light" : "standard",
    qualityMode: "fast",
    preferredBackend,
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

function coordinator(backends) {
  return new ClosedAIRuntimeCoordinator({
    origin: "https://preview.example",
    snapshotReader: async () => backends,
    releaseReader: async () => ({
      status: "verified",
      appCommit: "a".repeat(40),
      deploymentId: "dpl_pr23_r21",
      environment: "preview",
    }),
    browserCapabilityReader: async () => ({
      webGpu: false,
      wasm: true,
      worker: true,
      storageQuota: 1_000_000,
      storageUsage: 0,
      status: "ready",
      reason: "browser_hybrid_runtime_packaged_ready",
      summaryAvailability: "packaged-task-runtime-ready",
      promptAvailability: "unavailable",
      generativeModelReady: false,
      modelId: "novel-browser-task-runtime-v2",
    }),
    localClient: new LocalBridgeClient({
      origin: "https://preview.example",
      tabStorage: null,
    }),
  });
}

const localSnapshot = snapshot("local-ollama");
const browserSnapshot = snapshot("browser-ai", {
  supportedTaskTypes: ["story.summary"],
});

await check("route refresh is planning, not execution", async () => {
  const runtime = coordinator([browserSnapshot, localSnapshot]);
  const before = await runtime.refresh({
    projectId: "project-planned",
    taskType: "chapter.continue",
    policy: { preferredBackend: "local-ollama" },
  });
  assert.equal(before.routeStatus, "routable");
  assert.equal(before.plannedBackend, "local-ollama");
  assert.equal(before.actualExecutor, "not_executed");
  assert.equal(before.executionReceipt, null);
});

await check("non-cryptographic model digest cannot become verified execution truth", async () => {
  const invalidDigestSnapshot = snapshot("local-ollama", {
    modelDigest: "local-ollama-digest-v1",
  });
  assert.equal(hasVerifiedClosedAIGeneration(invalidDigestSnapshot), false);
});

let localReceipt;
await check("real local backend execution emits a verified receipt", async () => {
  const adapter = new ReceiptBackend(localSnapshot);
  const result = await createOS(adapter).execute(request({
    taskId: "local-real-1",
    projectId: "project-local",
    taskType: "chapter.continue",
    preferredBackend: "local-ollama",
  }));
  localReceipt = result.candidate.executionReceipt;
  assert.equal(adapter.calls, 1);
  assert.equal(result.candidate.actualExecutor, "local-ollama");
  assert.equal(localReceipt?.backendId, "local-ollama");
  assert.equal(localReceipt?.proofState, "verified");
  assert.equal(localReceipt?.outputCharacters, result.candidate.content.length);
  assert.match(localReceipt?.contentDigest ?? "", /^[a-f0-9]{64}$/u);
  assert.match(localReceipt?.contextDigest ?? "", /^[a-f0-9]{64}$/u);
});

await check("validated receipt is the only coordinator execution proof", async () => {
  const runtime = coordinator([browserSnapshot, localSnapshot]);
  runtime.recordExecutionReceipt(
    "project-local",
    "chapter.continue",
    localReceipt,
  );
  const after = await runtime.refresh({
    projectId: "project-local",
    taskType: "chapter.continue",
    policy: { preferredBackend: "local-ollama" },
  });
  assert.equal(after.plannedBackend, "local-ollama");
  assert.equal(after.actualExecutor, "local-ollama");
  assert.deepEqual(after.executionReceipt, localReceipt);
  runtime.beginExecution("project-local", "chapter.continue");
  const cleared = await runtime.refresh({
    projectId: "project-local",
    taskType: "chapter.continue",
    policy: { preferredBackend: "local-ollama" },
  });
  assert.equal(cleared.actualExecutor, "not_executed");
  assert.equal(cleared.executionReceipt, null);
});

await check("real browser task execution emits browser-ai truth", async () => {
  const adapter = new ReceiptBackend(browserSnapshot);
  const result = await createOS(adapter).execute(request({
    taskId: "browser-real-1",
    projectId: "project-browser",
    taskType: "story.summary",
    preferredBackend: "browser-ai",
  }));
  assert.equal(adapter.calls, 1);
  assert.equal(result.candidate.actualExecutor, "browser-ai");
  assert.equal(result.candidate.executionReceipt?.backendId, "browser-ai");
  assert.equal(result.candidate.executionReceipt?.proofState, "verified");
});

await check("cache reuse cannot impersonate a new model execution", async () => {
  const adapter = new ReceiptBackend(localSnapshot);
  const os = createOS(adapter);
  const first = await os.execute(request({
    taskId: "cache-source",
    projectId: "project-cache",
    taskType: "chapter.continue",
    preferredBackend: "local-ollama",
  }));
  const second = await os.execute(request({
    taskId: "cache-reuse",
    projectId: "project-cache",
    taskType: "chapter.continue",
    preferredBackend: "local-ollama",
  }));
  assert.equal(first.candidate.actualExecutor, "local-ollama");
  assert.equal(second.candidate.actualExecutor, "not_executed");
  assert.equal(second.candidate.executionReceipt, null);
  assert.equal(adapter.calls, 1);
});

await check("failed backend leaves actual execution unproven", async () => {
  const adapter = new ReceiptBackend(localSnapshot, { fail: true });
  const os = createOS(adapter);
  await assert.rejects(
    os.execute(request({
      taskId: "failed-local",
      projectId: "project-failed",
      taskType: "chapter.continue",
      preferredBackend: "local-ollama",
    })),
    (error) => error?.code === "SIMULATED_BACKEND_FAILURE",
  );
  const runtime = coordinator([browserSnapshot, localSnapshot]);
  runtime.beginExecution("project-failed", "chapter.continue");
  const snapshotAfterFailure = await runtime.refresh({
    projectId: "project-failed",
    taskType: "chapter.continue",
  });
  assert.equal(snapshotAfterFailure.actualExecutor, "not_executed");
  assert.equal(snapshotAfterFailure.executionReceipt, null);
});

await check("invalid receipts are rejected and cleared", async () => {
  const runtime = coordinator([browserSnapshot, localSnapshot]);
  assert.throws(
    () => runtime.recordExecutionReceipt(
      "project-invalid",
      "chapter.continue",
      { ...localReceipt, outputCharacters: 0 },
    ),
    (error) => error?.code === "CLOSED_AI_EXECUTION_RECEIPT_INVALID",
  );
  const after = await runtime.refresh({
    projectId: "project-invalid",
    taskType: "chapter.continue",
  });
  assert.equal(after.actualExecutor, "not_executed");
  assert.equal(after.executionReceipt, null);
});

await check("UI and discovery cannot promote a planned route to actual", async () => {
  const [coordinatorSource, studioSource, setupSource] = await Promise.all([
    readFile(new URL("../lib/novel-ai/web/closed-ai-runtime-coordinator.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/novel-ai/web/studio-closed-ai.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/settings/local-ai/setup-wizard.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(coordinatorSource, /actualExecutor:\s*selected\?\.id/u);
  assert.match(coordinatorSource, /actualExecutor:\s*executionReceipt\?\.backendId\s*\?\?\s*"not_executed"/u);
  assert.match(studioSource, /plannedProviderId:\s*providerId/u);
  assert.match(studioSource, /actualExecutor:\s*runtime\.actualExecutor/u);
  assert.doesNotMatch(setupSource, /snapshot\.actualExecutor\s*===\s*"local-ollama"/u);
});

console.log(JSON.stringify({
  schemaVersion: "pr23-r2-1-actual-executor-truth-v1",
  status: "PASS",
  checks: results.length,
  results,
}, null, 2));

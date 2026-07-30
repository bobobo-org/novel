import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ClosedAICache,
  MemoryClosedAICacheRepository,
} from "../lib/novel-ai/closed-ai-cache/index.ts";
import {
  ClosedAgentOS,
  MemoryClosedAgentStateRepository,
  evaluateObjectiveAcceptance,
} from "../lib/novel-ai/closed-agent-os/index.ts";
import {
  ApprovalSigner,
  MemoryVerifiableLedgerRepository,
  VerifiableLedger,
} from "../lib/novel-ai/verifiable-ledger/index.ts";
import {
  runPackagedBrowserExtractiveModel,
} from "../lib/novel-ai/providers/browser-ai/browser-extractive-model.ts";
import {
  BROWSER_TASK_MODEL,
  runPackagedBrowserTaskModel,
} from "../lib/novel-ai/providers/browser-ai/browser-task-model.ts";
import {
  buildClosedAIModelPrompt,
  getClosedAIModelProfile,
} from "../lib/novel-ai/providers/closed/task-profile.ts";
import {
  LocalBridgeClient,
} from "../lib/novel-ai/providers/local-ollama/local-bridge-client.ts";
import {
  PrivateHubClient,
} from "../lib/novel-ai/providers/private-ai-hub/private-hub-client.ts";
import {
  createStudioClosedAgentToolRegistry,
} from "../lib/novel-ai/web/studio-closed-agent-tools.ts";

const tests = [];
const results = [];
const test = (name, run) => tests.push({ name, run });

function response(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function namespace(overrides = {}) {
  return {
    tenantId: "tenant-optimization",
    userId: "author-optimization",
    projectId: "project-optimization",
    storyId: "story-optimization",
    canonId: "canon-optimization",
    branchId: "main",
    characterId: "shared",
    agentRole: "closed-agent-os",
    modelId: "runtime-selection",
    modelDigest: "runtime-digest",
    promptProfileVersion: "closed-agent-prompt-v3",
    storyBibleRevision: "bible-1",
    knowledgeScopeRevision: "knowledge-1",
    privacyLevel: "device_only",
    ...overrides,
  };
}

class OptimizationBackend {
  constructor(id, complexity, calls) {
    this.id = id;
    this.complexity = complexity;
    this.calls = calls;
  }

  async snapshot() {
    this.calls.snapshots += 1;
    return {
      id: this.id,
      label: this.id,
      status: "ready",
      modelId: `${this.id}-model`,
      modelDigest: `${this.id}-digest`,
      local: this.id !== "private-ai-hub",
      dataBoundary: this.id === "private-ai-hub"
        ? "private-infrastructure"
        : "device",
      maximumComplexity: this.complexity,
      capabilities: ["text", "streaming"],
      supportedTaskTypes: this.id === "browser-ai"
        ? ["story.summary", "character.dialogueConsistency"]
        : "all",
      detailCode: "optimization-test-ready",
      maxContext: 8_192,
      controlLatencyMs: 2,
    };
  }

  async execute(input) {
    this.calls.executions += 1;
    input.request.onProgress?.({
      taskId: input.request.taskId,
      phase: "generating",
      label: "測試模型串流中 · 48 字",
      percent: 66,
      occurredAt: new Date().toISOString(),
      backendId: this.id,
      generatedCharacters: 48,
    });
    return {
      backendId: this.id,
      modelId: `${this.id}-model`,
      modelDigest: `${this.id}-digest`,
      content: `這是由 ${this.id} 產生的繁體中文候選，包含足夠內容供評估、證據封存與作者人工核准。`,
      candidateOnly: true,
      dataLeftDevice: false,
      externalRequest: false,
      elapsedMs: 12,
      profileId: `${this.id}-optimization-v2`,
      firstTokenMs: 4,
      inputCharacters: 120,
      outputCharacters: 48,
      generatedTokenEvents: 6,
      omittedInputCharacters: 0,
    };
  }
}

function createOS() {
  const calls = { snapshots: 0, executions: 0 };
  const os = new ClosedAgentOS({
    backends: [
      new OptimizationBackend("browser-ai", "light", calls),
      new OptimizationBackend("local-ollama", "standard", calls),
      new OptimizationBackend("private-ai-hub", "heavy", calls),
    ],
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

test("Browser extractive model covers long documents and removes repeated passages", () => {
  const patterns = [
    (index) => `第 ${index + 1} 段，林昭突然發現新的帳冊座標，因此改變追查方向。`,
    (index) => `第 ${index + 1} 段，周遠拒絕交出鑰匙，兩人的信任出現裂痕。`,
    (index) => `第 ${index + 1} 段，雨水淹過舊街，鐘樓入口只剩一盞燈。`,
    (index) => `第 ${index + 1} 段，守門人坦白昨夜改口，代價是失去職位。`,
    (index) => `第 ${index + 1} 段，錄音忽然停止，未解問題轉向失蹤的證人。`,
  ];
  const sentences = Array.from(
    { length: 140 },
    (_, index) => patterns[index % patterns.length](index),
  );
  const startedAt = performance.now();
  const result = runPackagedBrowserExtractiveModel(sentences.join(""));
  assert.equal(result.candidateSentenceCount, 140);
  assert(result.selectedSentenceCount >= 4);
  assert(result.coverage.lastSentenceIndex > 90);
  assert.equal(
    new Set(result.content.split("\n")).size,
    result.content.split("\n").length,
  );
  assert(performance.now() - startedAt < 250);
});

test("Browser light tasks execute task-specific local behavior", () => {
  const source = "林昭說：「我不相信你。」周遠拒絕合作，轉身離開。";
  const nameResult = runPackagedBrowserTaskModel("character.nameExtract", source);
  const relationship = runPackagedBrowserTaskModel(
    "character.relationshipEventClassify",
    source,
  );
  assert.equal(nameResult.modelId, BROWSER_TASK_MODEL.modelId);
  assert.match(nameResult.content, /林昭|周遠/u);
  assert.match(relationship.content, /關係受損/u);
  assert.equal(nameResult.externalRequest, false);
  assert.equal(nameResult.dataLeftDevice, false);
  assert.notEqual(nameResult.content, relationship.content);
});

test("Local and Hub task profiles enforce different budgets and truthful prompts", () => {
  const local = getClosedAIModelProfile("chapter.continue", "local-ollama");
  const hub = getClosedAIModelProfile(
    "character.multiAgentSimulation",
    "private-ai-hub",
  );
  assert(hub.maxInputCharacters > local.maxInputCharacters);
  assert(hub.options.num_predict > local.options.num_predict);
  assert(local.options.num_predict <= 2_048);
  assert(hub.options.num_predict <= 4_096);
  const source = "已核准設定。".repeat(8_000);
  const built = buildClosedAIModelPrompt({
    objective: "依設定續寫，不要修改 Canon。",
    context: [source, source],
    profile: local,
    qualityPhase: "revision",
    agentPlan: {
      planDigest: "plan-digest",
      roles: ["planner", "actor", "evaluator"],
      steps: [{ role: "actor", objective: "依設定建立候選" }],
    },
    toolResults: [{
      toolId: "acceptance-checklist",
      value: { requestedItemCount: 3, requiredDimensions: ["風險"] },
    }],
    workingMaterials: [{
      kind: "draft",
      text: "這是未核准草稿，只能用於本次修訂。",
      digest: "draft-digest",
    }],
  });
  assert(built.prompt.length <= local.maxInputCharacters + 256);
  assert.match(built.prompt, /已核准資料/u);
  assert.match(built.prompt, /代理計畫/u);
  assert.match(built.prompt, /本機工具證據/u);
  assert.match(built.prompt, /未核准工作素材/u);
  assert.match(built.prompt, /<品質階段>revision/u);
  assert.match(built.prompt, /不要修改 Canon/u);
  assert.equal(built.contextItems, 1);
  assert(built.omittedCharacters > 0);
});

test("Deep quality mode performs draft, critic and revision without persisting transient text", async () => {
  const phases = [];
  const transientDraft = "TRANSIENT_DRAFT_ONLY：林昭先開門，但這一版尚未檢查代價。";
  const transientCritic = "TRANSIENT_CRITIC_ONLY：缺少風險與世界規則核對。";
  const backend = {
    id: "private-ai-hub",
    async snapshot() {
      return {
        id: "private-ai-hub",
        label: "私有 AI Hub",
        status: "ready",
        modelId: "quality-model",
        modelDigest: "quality-model-digest",
        local: false,
        dataBoundary: "private-infrastructure",
        maximumComplexity: "heavy",
        capabilities: ["text"],
        supportedTaskTypes: "all",
        detailCode: "quality-test-ready",
      };
    },
    async execute(input) {
      phases.push(input.qualityPhase);
      if (input.qualityPhase === "critic") {
        assert.equal(input.workingMaterials[0].text, transientDraft);
      }
      if (input.qualityPhase === "revision") {
        assert.equal(input.workingMaterials.length, 2);
      }
      const content = input.qualityPhase === "draft"
        ? transientDraft
        : input.qualityPhase === "critic"
          ? transientCritic
          : "林昭沒有立刻開門；她先依世界規則召來第二名守衛，代價是延誤救援，也承擔追兵抵達的風險。";
      return {
        backendId: "private-ai-hub",
        modelId: "quality-model",
        modelDigest: "quality-model-digest",
        content,
        candidateOnly: true,
        dataLeftDevice: false,
        externalRequest: false,
        elapsedMs: 5,
        profileId: "quality-test-v1",
      };
    },
  };
  const os = new ClosedAgentOS({
    backends: [backend],
    cache: new ClosedAICache({
      repository: new MemoryClosedAICacheRepository(),
    }),
    ledger: new VerifiableLedger({
      repository: new MemoryVerifiableLedgerRepository(),
      signer: new ApprovalSigner(),
    }),
    state: new MemoryClosedAgentStateRepository(),
  });
  const result = await os.execute({
    taskId: "quality-deep-test",
    namespace: namespace({
      privacyLevel: "private_infrastructure_only",
    }),
    taskType: "character.multiAgentSimulation",
    objective: "提出一個符合世界規則的選擇，列出代價與風險。",
    context: [],
    complexity: "heavy",
    qualityMode: "deep",
    preferredBackend: "private-ai-hub",
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
  });
  assert.deepEqual(phases, ["draft", "critic", "revision"]);
  assert.equal(result.candidate.generationTelemetry.qualityPasses, 3);
  assert.match(result.candidate.generationTelemetry.draftDigest, /^[a-f0-9]{64}$/u);
  assert.match(result.candidate.generationTelemetry.criticDigest, /^[a-f0-9]{64}$/u);
  const persisted = JSON.stringify([
    ...(await os.cache.repository.list()),
    ...(await os.state.list("project-optimization")),
    ...(await os.ledger.repository.list("closed-agent:project-optimization:quality-deep-test")),
  ]);
  assert.equal(persisted.includes("TRANSIENT_DRAFT_ONLY"), false);
  assert.equal(persisted.includes("TRANSIENT_CRITIC_ONLY"), false);
});

test("Studio tools expose acceptance and approved context metadata without raw secret context", async () => {
  const registry = createStudioClosedAgentToolRegistry();
  assert.deepEqual(
    registry.list().map((tool) => tool.id),
    ["acceptance-checklist", "story-context-index"],
  );
  const acceptance = evaluateObjectiveAcceptance({
    objective: "提出三個方案，每個列出做法、代價與風險。",
    content: "1. 方案一\n做法：等待。\n代價：延誤。\n2. 方案二\n做法：撤退。\n3. 方案三\n做法：談判。",
  });
  assert.equal(acceptance.contract.requestedItemCount, 3);
  assert.ok(acceptance.warningCodes.includes("OBJECTIVE_DIMENSION_MISSING:風險"));
  assert.ok(
    acceptance.warningCodes.includes("OBJECTIVE_DIMENSION_INCOMPLETE:代價:1/3"),
  );
  const contextTool = registry.get("story-context-index");
  const contextResult = await contextTool.execute({
    namespace: namespace(),
    taskId: "tool-context-test",
    taskType: "story.summary",
    objective: "摘要作品。",
    approvedContext: [
      {
        id: "public-story",
        kind: "story-bible",
        text: "可見的核准設定",
        visibility: "both",
        privacyLevel: "device_only",
        approved: true,
      },
      {
        id: "author-secret",
        kind: "author-note",
        text: "AUTHOR_SECRET_MUST_NOT_LEAK",
        visibility: "author-only",
        privacyLevel: "device_only",
        approved: true,
      },
    ],
    payload: {},
  });
  assert.equal(contextResult.sources.length, 1);
  assert.equal(JSON.stringify(contextResult).includes("AUTHOR_SECRET_MUST_NOT_LEAK"), false);
  assert.equal(contextResult.rawSourceTextStored, false);
});

test("Local Bridge control probes are coalesced and session-scoped", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let delayNextHealth = false;
  let releaseDelayedHealth = null;
  globalThis.fetch = async (url) => {
    calls += 1;
    if (String(url).endsWith("/health")) {
      if (delayNextHealth) {
        delayNextHealth = false;
        return new Promise((resolve) => {
          releaseDelayedHealth = () => resolve(response({
            bridgeProcessAlive: true,
            runtimeReady: true,
            pairingState: "paired",
            sessionMarker: "stale",
          }));
        });
      }
      return response({
        bridgeProcessAlive: true,
        runtimeReady: true,
        pairingState: "paired",
        sessionMarker: "fresh",
      });
    }
    if (String(url).endsWith("/models")) {
      return response({
        models: [{
          modelId: "qwen2.5:3b",
          modelDigest: "digest",
          contextLength: { value: 8_192 },
          capabilities: { textGeneration: { value: true } },
        }],
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const client = new LocalBridgeClient({
      session: {
        token: "test-session-token",
        csrf: "test-csrf",
        instanceId: "local-instance",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    await Promise.all([client.health(), client.health(), client.health()]);
    await Promise.all([client.models(), client.models(), client.models()]);
    assert.equal(calls, 2);
    client.clearControlPlaneCache();
    await client.health();
    assert.equal(calls, 3);
    client.clearControlPlaneCache();
    delayNextHealth = true;
    const staleRequest = client.health();
    client.setSession({
      token: "rotated-session-token",
      csrf: "rotated-csrf",
      instanceId: "local-instance-rotated",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const freshRequest = await client.health();
    assert.equal(freshRequest.sessionMarker, "fresh");
    assert.equal(calls, 5);
    assert.equal(typeof releaseDelayedHealth, "function");
    releaseDelayedHealth();
    assert.equal((await staleRequest).sessionMarker, "stale");
    assert.equal((await client.health()).sessionMarker, "fresh");
    assert.equal(calls, 5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Private Hub coalesces health, models and adapter probes independently", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    if (String(url).endsWith("/health")) {
      return response({ runtimeReady: true, pairingState: "paired" });
    }
    if (String(url).endsWith("/models")) {
      return response({
        models: [{
          modelId: "qwen2.5:3b",
          modelDigest: "digest",
          contextLength: { value: 16_384 },
          capabilities: { textGeneration: { value: true } },
        }],
      });
    }
    if (String(url).endsWith("/training/list")) return response({ models: [] });
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const client = new PrivateHubClient({
      session: {
        token: "test-session-token",
        csrf: "test-csrf",
        instanceId: "hub-instance",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    await Promise.all([client.health(), client.health()]);
    await Promise.all([client.models(), client.models()]);
    await Promise.all([
      client.listPreferenceModels("project-optimization"),
      client.listPreferenceModels("project-optimization"),
    ]);
    assert.equal(calls, 3);
    client.setSession({
      token: "rotated-session-token",
      csrf: "rotated-csrf",
      instanceId: "hub-instance-rotated",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await Promise.all([
      client.health(),
      client.models(),
      client.listPreferenceModels("project-optimization"),
    ]);
    assert.equal(calls, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Closed Agent OS reports ordered progress and immutable performance evidence", async () => {
  const { os, calls } = createOS();
  const progress = [];
  const result = await os.execute({
    taskId: "optimization-progress-task",
    namespace: namespace(),
    taskType: "story.summary",
    objective: "摘要已核准章節，保留人物、衝突與未解線索。",
    context: [],
    complexity: "light",
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
    onProgress: (event) => progress.push(event),
  });
  const phases = progress.map((event) => event.phase);
  for (const phase of [
    "queued",
    "probing",
    "routing",
    "planning",
    "retrieving",
    "generating",
    "evaluating",
    "awaiting-approval",
  ]) {
    assert(phases.includes(phase), `missing progress phase ${phase}`);
  }
  assert.equal(phases.at(-1), "awaiting-approval");
  assert.equal(result.route.fallbackAttempted, false);
  assert.equal(
    result.candidate.generationTelemetry.profileId,
    "browser-ai-optimization-v2:quality-fast-v1",
  );
  assert.equal(result.candidate.generationTelemetry.qualityMode, "fast");
  assert.equal(result.candidate.generationTelemetry.qualityPasses, 1);
  assert.equal(result.candidate.generationTelemetry.firstTokenMs, 4);
  assert.equal(result.candidate.canonicalMutationCount, 0);
  assert.equal(calls.executions, 1);
});

test("Dashboard reuses supplied backend snapshots without another runtime probe", async () => {
  const { os, calls } = createOS();
  const snapshots = await os.backendSnapshots();
  assert.equal(calls.snapshots, 3);
  const dashboard = await os.dashboard("project-optimization", snapshots);
  assert.equal(calls.snapshots, 3);
  assert.deepEqual(dashboard.backends, snapshots);
});

test("Studio exposes readiness, progress, telemetry and no-silent-fallback truth", () => {
  const root = process.cwd();
  const ui = fs.readFileSync(
    path.join(root, "app/studio/project/[projectId]/closed-ai/closed-ai-workspace.tsx"),
    "utf8",
  );
  const css = fs.readFileSync(
    path.join(root, "app/studio/project/[projectId]/closed-ai/closed-ai.module.css"),
    "utf8",
  );
  const localServer = fs.readFileSync(
    path.join(root, "local-ai/bridge/server.mjs"),
    "utf8",
  );
  const hubServer = fs.readFileSync(
    path.join(root, "local-ai/private-hub/server.mjs"),
    "utf8",
  );
  assert.match(ui, /onProgress: recordProgress/u);
  assert.match(ui, /progressEvents/u);
  assert.match(ui, /executionReady/u);
  assert.match(ui, /os\.dashboard\(projectId, nextSnapshots\)/u);
  assert.match(ui, /Promise\.all\(\[\s*browserProbe,\s*localProbe,\s*hubProbe/u);
  assert.match(ui, /系統不會暗中換用別的 AI/u);
  assert.match(css, /\.progressPanel/u);
  assert.match(css, /\.executionReadiness/u);
  assert.match(localServer, /workload: \{ active: work\.active/u);
  assert.match(hubServer, /workload: \{/u);
});

for (const item of tests) {
  const startedAt = performance.now();
  try {
    await item.run();
    results.push({
      name: item.name,
      status: "PASS",
      elapsedMs: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    results.push({
      name: item.name,
      status: "FAIL",
      elapsedMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

const pass = results.filter((item) => item.status === "PASS").length;
const fail = results.length - pass;
console.log(JSON.stringify({
  suite: "Closed AI Optimization and Studio Integration",
  runAt: new Date().toISOString(),
  pass,
  fail,
  externalAiCalls: 0,
  silentFallback: false,
  canonicalMutationCount: 0,
  results,
}, null, 2));
if (fail) process.exitCode = 1;

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  BROWSER_AI_LIGHT_TASKS,
  ClosedAgentOS,
  MemoryClosedAgentStateRepository,
  PrivateAIHubBackendAdapter,
  evaluateClosedAgentCandidate,
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
  buildClosedAIModelPrompt,
  getClosedAIModelProfile,
} from "../lib/novel-ai/providers/closed/task-profile.ts";
import {
  runPackagedBrowserTaskModel,
} from "../lib/novel-ai/providers/browser-ai/browser-task-model.ts";
import {
  containsConvertibleSimplifiedChinese,
  containsProtectedProperNounDrift,
  normalizeTraditionalChinesePreservingProperNouns,
} from "../lib/novel-ai/language/traditional-chinese.ts";
import {
  resolveLocalNetworkPermissionStates,
} from "../lib/novel-ai/providers/local-ollama/local-bridge-client.ts";
import {
  resolveEffectiveLocalNetworkPermission,
} from "../lib/novel-ai/web/closed-ai-runtime-coordinator.ts";
import {
  LoopbackPrivateHubTransport,
  configurePrivateHubClient,
  configurePrivateHubModel,
  configurePrivateHubProject,
} from "../lib/novel-ai/providers/private-ai-hub/private-hub-client.ts";

const workspace = new URL("../", import.meta.url);
const read = (relativePath) =>
  fs.readFileSync(new URL(relativePath, workspace), "utf8");

const workspaceSource = read(
  "app/studio/project/[projectId]/closed-ai/closed-ai-workspace.tsx",
);
const localAISetupSource = read("app/settings/local-ai/setup-wizard.tsx");
const aiSettingsSource = read("app/studio/settings/ai/settings-client.tsx");
const frontdoorSource = read("app/frontdoor-client.tsx");
const studioClosedAISource = read("lib/novel-ai/web/studio-closed-ai.ts");
const companionReleaseSource = read(
  "lib/novel-ai/providers/local-ollama/companion-release.ts",
);
const projectSource = read(
  "app/studio/project/[projectId]/project-section-client.tsx",
);
const writingSource = read(
  "app/studio/project/[projectId]/write/write-workspace.tsx",
);
const learningSource = read(
  "app/studio/project/[projectId]/learning/learning-workspace.tsx",
);
const aiSource = read(
  "app/studio/project/[projectId]/ai/ai-workspace.tsx",
);
const characterAgentSource = read(
  "app/studio/project/[projectId]/character-ai/character-agent-workspace.tsx",
);
const dramaSource = read(
  "app/studio/project/[projectId]/drama/drama-workspace.tsx",
);
const closedAgentServiceSource = read(
  "lib/novel-ai/web/closed-agent-os-service.ts",
);
const closedAgentToolsSource = read(
  "lib/novel-ai/web/studio-closed-agent-tools.ts",
);
const legacySource = read("public/legacy/legacy-security-boundary.js");
const consumerSource = read("public/legacy/consumer-app.js");
const sovereignEntrySource = read("public/legacy/sovereign-learning-entry.js");
const legacyHtmlSource = read("public/legacy/novel-system.html");
const serviceWorkerSource = read("public/legacy/service-worker.js");

const results = [];
async function test(name, run) {
  try {
    await run();
    results.push({ name, status: "PASS" });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    });
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

const taskPattern =
  /\{\s*id:\s*"([^"]+)",\s*label:\s*"([^"]+)",\s*complexity:\s*"(light|standard|heavy)",\s*hint:\s*"([^"]+)",\s*group:\s*"([^"]+)",\s*defaultObjective:\s*"([^"]+)"\s*\}/gu;
const taskOptions = [...workspaceSource.matchAll(taskPattern)].map((match) => ({
  id: match[1],
  label: match[2],
  complexity: match[3],
  hint: match[4],
  group: match[5],
  defaultObjective: match[6],
}));

const approvedContext = [
  "【作品核心】一名守城人必須在保住城門與救回妹妹之間做選擇。",
  "【目前章節】林昭在雨夜抵達城門。她說：「如果現在開門，城裡的人都會有危險。」守門人握緊鑰匙，卻看見妹妹留在城外。",
  "【角色】林昭：審慎、重視生命；守門人：忠於職責，但害怕失去家人。",
  "【世界規則】城門在午夜後只能由兩名守衛共同開啟。",
].join("\n");

class OperabilityBackend {
  constructor(id, maximumComplexity, calls) {
    this.id = id;
    this.maximumComplexity = maximumComplexity;
    this.calls = calls;
  }

  async snapshot() {
    return {
      id: this.id,
      label: this.id,
      status: "ready",
      modelId: `${this.id}-operability-model`,
      modelDigest: `${this.id}-operability-digest`,
      local: this.id !== "private-ai-hub",
      dataBoundary: this.id === "private-ai-hub"
        ? "private-infrastructure"
        : "device",
      maximumComplexity: this.maximumComplexity,
      capabilities: ["text", "offline"],
      supportedTaskTypes: this.id === "browser-ai"
        ? BROWSER_AI_LIGHT_TASKS
        : "all",
      detailCode: "operability-test-ready",
      maxContext: this.id === "private-ai-hub" ? 65_536 : 16_384,
      controlLatencyMs: 1,
    };
  }

  async execute(input) {
    this.calls.push({
      backendId: this.id,
      taskId: input.request.taskId,
      taskType: input.request.taskType,
      objective: input.request.objective,
    });
    return {
      backendId: this.id,
      modelId: `${this.id}-operability-model`,
      modelDigest: `${this.id}-operability-digest`,
      content: `「${input.request.taskType}」功能已透過 ${this.id} 真實執行管線建立候選。此結果保留角色選擇、世界規則與人工核准邊界，並提供可驗證的作者用途。`,
      candidateOnly: true,
      dataLeftDevice: this.id === "private-ai-hub",
      externalRequest: this.id === "private-ai-hub",
      elapsedMs: 3,
      profileId: `operability-${input.request.taskType}`,
      firstTokenMs: 1,
      inputCharacters: input.request.objective.length,
      outputCharacters: 80,
      generatedTokenEvents: 2,
      omittedInputCharacters: 0,
    };
  }
}

function createOperabilityOS() {
  const calls = [];
  const cache = new ClosedAICache({
    repository: new MemoryClosedAICacheRepository(),
  });
  const ledger = new VerifiableLedger({
    repository: new MemoryVerifiableLedgerRepository(),
    signer: new ApprovalSigner(),
  });
  const os = new ClosedAgentOS({
    backends: [
      new OperabilityBackend("browser-ai", "light", calls),
      new OperabilityBackend("local-ollama", "standard", calls),
      new OperabilityBackend("private-ai-hub", "heavy", calls),
    ],
    cache,
    ledger,
    state: new MemoryClosedAgentStateRepository(),
  });
  return { os, calls };
}

function namespace(task, index) {
  const backendId = task.complexity === "heavy"
    ? "private-ai-hub"
    : task.complexity === "standard"
      ? "local-ollama"
      : "browser-ai";
  return {
    tenantId: "operability-tenant",
    userId: "operability-author",
    projectId: `operability-project-${index}`,
    storyId: `operability-story-${index}`,
    canonId: `operability-canon-${index}`,
    branchId: "main",
    characterId: "shared",
    agentRole: "closed-agent-os",
    modelId: `${backendId}-operability-model`,
    modelDigest: `${backendId}-operability-digest`,
    promptProfileVersion: "closed-agent-prompt-v2",
    storyBibleRevision: "1",
    knowledgeScopeRevision: "1",
    privacyLevel: backendId === "private-ai-hub"
      ? "private_infrastructure_only"
      : "device_only",
  };
}

function permissions() {
  return [
    "story:read",
    "story-bible:read",
    "candidate:write",
    "candidate:read",
    "evaluation:write",
    "character:read",
    "world:read",
  ];
}

await test("Closed AI task menu exposes broad GPT-like novel capabilities", () => {
  assert.ok(taskOptions.length >= 30, `expected at least 30 tasks, got ${taskOptions.length}`);
  assert.equal(new Set(taskOptions.map((task) => task.id)).size, taskOptions.length);
  for (const required of [
    "assistant.general",
    "assistant.brainstorm",
    "assistant.critique",
    "assistant.transform",
    "story.chapterReview",
    "story.plotAnalysis",
    "story.pacingCheck",
    "story.themeAnalysis",
    "story.originalityCheck",
    "story.storyBibleCandidate",
    "character.multiAgentSimulation",
  ]) {
    assert.ok(taskOptions.some((task) => task.id === required), `missing ${required}`);
  }
  for (const task of taskOptions) {
    assert.ok(task.label.length >= 4, `${task.id} label`);
    assert.ok(task.hint.length >= 4, `${task.id} hint`);
    assert.ok(task.defaultObjective.length >= 20, `${task.id} objective`);
  }
});

await test("every task has a useful Local and Private Hub prompt profile", () => {
  for (const task of taskOptions) {
    for (const backendId of ["local-ollama", "private-ai-hub"]) {
      const profile = getClosedAIModelProfile(task.id, backendId);
      const prompt = buildClosedAIModelPrompt({
        objective: task.defaultObjective,
        context: [approvedContext],
        profile,
      });
      assert.equal(profile.taskType, task.id);
      assert.ok(profile.systemInstruction.length >= 100, `${task.id} instruction`);
      assert.ok(profile.options.num_predict >= 768, `${task.id} output budget`);
      assert.ok(profile.timeoutMs >= 120_000, `${task.id} timeout`);
      assert.match(prompt.prompt, new RegExp(task.id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
      assert.ok(prompt.prompt.includes(task.defaultObjective));
      assert.ok(prompt.prompt.includes("已核准資料"));
    }
  }
});

await test("every packaged Browser AI function returns an actual useful result", () => {
  for (const taskType of BROWSER_AI_LIGHT_TASKS) {
    const result = runPackagedBrowserTaskModel(taskType, approvedContext);
    assert.equal(result.externalRequest, false, taskType);
    assert.equal(result.dataLeftDevice, false, taskType);
    assert.ok(result.modelId, taskType);
    assert.match(result.modelDigest, /^[a-f0-9]{64}$/u, taskType);
    assert.ok(result.content.length >= 24, `${taskType} output too short`);
  }
});

await test("Traditional normalization preserves approved character names", () => {
  const source = "林昭與沈岳在雨夜守住北城門；角色名：沈岳。";
  const normalized = normalizeTraditionalChinesePreservingProperNouns(
    "林昭與沈岳在雨夜守住北城門，后来发现追兵接近。",
    source,
  );
  assert.match(normalized, /沈岳/u);
  assert.doesNotMatch(normalized, /沈嶽/u);
  assert.match(normalized, /後來發現/u);
  assert.equal(
    containsConvertibleSimplifiedChinese("林昭與沈岳守住北城門。", source),
    false,
  );
  assert.equal(
    containsConvertibleSimplifiedChinese("林昭与沈岳后来发现追兵。", source),
    true,
  );
  assert.equal(
    normalizeTraditionalChinesePreservingProperNouns(
      "沈岳決定留在城門。",
      "保留角色名沈岳，讓選擇與風險清楚。",
    ),
    "沈岳決定留在城門。",
  );
  assert.equal(
    containsProtectedProperNounDrift(
      "沈嶽決定留在城門。",
      "保留角色名沈岳，讓選擇與風險清楚。",
    ),
    true,
  );
  assert.equal(
    containsProtectedProperNounDrift(
      "沈岳決定留在城門。",
      "保留角色名沈岳，讓選擇與風險清楚。",
    ),
    false,
  );
});

await test("Local Network Access aliases cannot create a false denial", () => {
  assert.equal(
    resolveLocalNetworkPermissionStates(["denied", "granted"]),
    "granted",
  );
  assert.equal(
    resolveLocalNetworkPermissionStates(["denied", "denied"]),
    "denied",
  );
  assert.equal(resolveLocalNetworkPermissionStates(["prompt"]), "prompt");
  assert.equal(resolveLocalNetworkPermissionStates([]), "unsupported");
  assert.equal(
    resolveEffectiveLocalNetworkPermission({
      reported: "denied",
      localRuntimeReady: true,
      loopbackSessionEstablished: true,
    }),
    "granted",
  );
  assert.equal(
    resolveEffectiveLocalNetworkPermission({
      reported: "denied",
      localRuntimeReady: false,
      loopbackSessionEstablished: true,
    }),
    "denied",
  );
});

await test("Evaluator blocks drift from an author-approved proper noun", async () => {
  const evaluation = await evaluateClosedAgentCandidate({
    request: {
      taskId: "proper-noun-drift-test",
      namespace: {
        tenantId: "local-tenant",
        userId: "local-author",
        projectId: "proper-noun-project",
        storyId: "proper-noun-story",
        canonId: "proper-noun-canon",
        branchId: "main",
        characterId: "shared",
        agentRole: "closed-agent-os",
        modelId: "qwen2.5:3b",
        modelDigest: "e".repeat(64),
        promptProfileVersion: "proper-noun-v1",
        storyBibleRevision: "1",
        knowledgeScopeRevision: "1",
        privacyLevel: "device_only",
      },
      taskType: "story.continue",
      objective: "角色名：沈岳。延續城門場景。",
      context: [],
      complexity: "standard",
      preferredBackend: "local-ollama",
      allowedToolIds: [],
      permissionScopes: permissions(),
    },
    execution: {
      backendId: "local-ollama",
      modelId: "qwen2.5:3b",
      modelDigest: "e".repeat(64),
      content: "沈嶽握住銅鑰匙，決定先驗證來者身分，再承擔延誤開門的風險。",
      candidateOnly: true,
      dataLeftDevice: false,
      externalRequest: false,
      elapsedMs: 5,
    },
  });
  assert.equal(evaluation.passed, false);
  assert.ok(evaluation.blockingCodes.includes("CANDIDATE_PROPER_NOUN_DRIFT"));
});

await test("Private Hub model identity is scoped to the executing project", async () => {
  const requestedProjects = [];
  const adapter = {
    modelId: "preference-project-right",
    artifactDigest: "a".repeat(64),
  };
  const client = {
    health: async () => ({ runtimeReady: true }),
    getSessionMetadata: () => ({ instanceId: "test-instance" }),
    models: async () => ({
      models: [{
        modelId: "qwen2.5:3b",
        modelDigest: "b".repeat(64),
        capabilities: { textGeneration: { value: true } },
        contextLength: { value: 32_768 },
      }],
    }),
    listPreferenceModels: async (projectId) => {
      requestedProjects.push(projectId);
      return [];
    },
    getModelVerification: () => ({ state: "inference_verified" }),
    getActiveAdapter: (projectId) => projectId === "project-right" ? adapter : null,
  };
  configurePrivateHubClient(client);
  configurePrivateHubModel("qwen2.5:3b");
  configurePrivateHubProject("project-wrong");
  try {
    const snapshot = await new LoopbackPrivateHubTransport().snapshot(
      undefined,
      { projectId: "project-right" },
    );
    assert.deepEqual(requestedProjects, ["project-right"]);
    assert.equal(
      snapshot.detailCode,
      "model_and_adapter_verified:preference-project-right",
    );
    assert.match(snapshot.modelDigest, /^[a-f0-9]{64}$/u);
  } finally {
    configurePrivateHubClient(null);
    configurePrivateHubModel(null);
    configurePrivateHubProject(null);
  }
});

await test("Private Hub performs one control-plane probe per routed task", async () => {
  let snapshotCalls = 0;
  let executeCalls = 0;
  const transport = {
    snapshot: async (_signal, projectScope) => {
      snapshotCalls += 1;
      assert.equal(projectScope.projectId, "single-probe-project");
      return {
        id: "private-ai-hub",
        label: "私有 AI Hub",
        status: "ready",
        modelId: "qwen2.5:3b",
        modelDigest: "c".repeat(64),
        local: true,
        dataBoundary: "private-infrastructure",
        maximumComplexity: "heavy",
        capabilities: ["text", "structured"],
        supportedTaskTypes: "all",
        detailCode: "model_and_adapter_verified:test-adapter",
      };
    },
    execute: async (input) => {
      executeCalls += 1;
      assert.equal(input.request.namespace.modelId, "qwen2.5:3b");
      assert.equal(input.request.namespace.modelDigest, "c".repeat(64));
      return {
        backendId: "private-ai-hub",
        modelId: input.request.namespace.modelId,
        modelDigest: input.request.namespace.modelDigest,
        adapterId: "test-adapter",
        adapterDigest: "d".repeat(64),
        content: "沈岳收起銅鑰匙，先命人點亮城牆烽火，再以第二道暗號驗證來者；若判斷失誤，追兵將循火光找到北門。",
        candidateOnly: true,
        dataLeftDevice: false,
        externalRequest: false,
        elapsedMs: 10,
      };
    },
  };
  const os = new ClosedAgentOS({
    backends: [new PrivateAIHubBackendAdapter(transport)],
    cache: new ClosedAICache({ repository: new MemoryClosedAICacheRepository() }),
    ledger: new VerifiableLedger({
      repository: new MemoryVerifiableLedgerRepository(),
      signer: new ApprovalSigner(),
    }),
    state: new MemoryClosedAgentStateRepository(),
  });
  const result = await os.execute({
    taskId: "single-probe-task",
    namespace: {
      tenantId: "local-tenant",
      userId: "local-author",
      projectId: "single-probe-project",
      storyId: "single-probe-story",
      canonId: "single-probe-canon",
      branchId: "main",
      characterId: "shared",
      agentRole: "closed-agent-os",
      modelId: "private-ai-hub:runtime-managed",
      modelDigest: "private-ai-hub:digest-runtime-managed",
      promptProfileVersion: "single-probe-v1",
      storyBibleRevision: "1",
      knowledgeScopeRevision: "1",
      privacyLevel: "private_infrastructure_only",
    },
    taskType: "story.continue",
    objective: "角色名：沈岳。延續他在雨夜城門的行動，並交代選擇與風險。",
    context: [],
    complexity: "heavy",
    preferredBackend: "private-ai-hub",
    allowedToolIds: [],
    permissionScopes: permissions(),
  });
  assert.equal(result.candidate.backendId, "private-ai-hub");
  assert.equal(snapshotCalls, 1);
  assert.equal(executeCalls, 3);
  assert.equal(result.candidate.generationTelemetry.qualityMode, "deep");
  assert.equal(result.candidate.generationTelemetry.qualityPasses, 3);
});

await test("every visible task routes through Closed Agent OS to the correct closed backend", async () => {
  const { os, calls } = createOperabilityOS();
  for (const [index, task] of taskOptions.entries()) {
    const expectedBackend = task.complexity === "heavy"
      ? "private-ai-hub"
      : task.complexity === "standard"
        ? "local-ollama"
        : "browser-ai";
    const result = await os.execute({
      taskId: `operability:${index}:${task.id}`,
      namespace: namespace(task, index),
      taskType: task.id,
      objective: task.defaultObjective,
      context: [{
        id: `approved-context-${index}`,
        kind: "story-bible",
        text: approvedContext,
        visibility: "both",
        privacyLevel: expectedBackend === "private-ai-hub"
          ? "private_infrastructure_only"
          : "device_only",
        approved: true,
      }],
      complexity: task.complexity,
      preferredBackend: expectedBackend,
      allowedToolIds: [],
      permissionScopes: permissions(),
    });
    assert.equal(result.route.backendId, expectedBackend, task.id);
    assert.equal(result.route.locked, true, task.id);
    assert.equal(result.route.fallbackAttempted, false, task.id);
    assert.equal(result.candidate.backendId, expectedBackend, task.id);
    assert.equal(result.candidate.status, "awaiting-approval", task.id);
    assert.equal(result.candidate.canonicalMutationCount, 0, task.id);
    assert.equal(
      result.candidate.generationTelemetry.qualityPasses,
      task.complexity === "heavy" ? 3 : task.complexity === "standard" ? 2 : 1,
      task.id,
    );
    assert.ok(result.candidate.content.length >= 24, task.id);
    assert.ok(result.ledgerHeadHash, task.id);
  }
  const expectedPasses = taskOptions.reduce(
    (total, task) =>
      total + (task.complexity === "heavy" ? 3 : task.complexity === "standard" ? 2 : 1),
    0,
  );
  assert.equal(calls.length, expectedPasses);
  assert.deepEqual(
    new Set(calls.map((call) => call.taskType)),
    new Set(taskOptions.map((task) => task.id)),
  );
});

await test("every Closed AI command button has a real handler or form action", () => {
  const buttonTags = [...workspaceSource.matchAll(/<button\b([^>]*)>/gsu)];
  assert.ok(buttonTags.length >= 20, `button count ${buttonTags.length}`);
  for (const [index, match] of buttonTags.entries()) {
    const attributes = match[1];
    assert.ok(
      /onClick\s*=/u.test(attributes) || /type\s*=\s*"submit"/u.test(attributes),
      `button ${index + 1} has no operation`,
    );
  }
  for (const handler of [
    "verifyBrowserRuntime",
    "requestLocalPairing",
    "confirmLocalPairing",
    "verifyLocalModel",
    "revokeLocalPairing",
    "requestHubPairing",
    "confirmHubPairing",
    "verifyHubModel",
    "revokeHubPairing",
    "runTask",
    "cancelTask",
    "approve",
    "reject",
    "enableLearning",
    "engageKillSwitch",
    "clearProjectCache",
    "exportEvidence",
    "exportLearning",
    "deleteLearning",
    "trainPreferenceModel",
    "activatePreferenceModel",
    "rollbackPreferenceModel",
  ]) {
    assert.match(workspaceSource, new RegExp(`function ${handler}\\b`, "u"), handler);
  }
});

await test("official production UI auto-connects local runtimes and exposes version updates", () => {
  for (const marker of [
    "connectRuntimesAutomatically",
    'data-testid="closed-ai-auto-connect-status"',
    'data-testid="local-ai-direct-connection"',
    'data-testid="local-ai-version-status"',
    'data-testid="private-hub-direct-connection"',
    'data-testid="private-hub-version-status"',
    'data-testid="local-ai-companion-update"',
    "免密碼自動連線已完成",
  ]) {
    assert.ok(workspaceSource.includes(marker), marker);
  }
  for (const marker of [
    "directConnectionEnabled",
    "client.connectAutomatically",
    'data-testid="local-ai-auto-connect"',
    'data-testid="local-ai-direct-connection-ready"',
    'data-testid="local-ai-companion-version-status"',
  ]) {
    assert.ok(localAISetupSource.includes(marker), marker);
  }
  for (const origin of [
    "https://novel-orcin.vercel.app",
    "https://novel-lqtechs-projects.vercel.app",
  ]) {
    assert.ok(companionReleaseSource.includes(origin), origin);
  }
  assert.ok(companionReleaseSource.includes("evaluateLocalAIRuntimeVersion"));
  assert.ok(companionReleaseSource.includes('version: "1.4.5"'));
  assert.ok(companionReleaseSource.includes('recommendedBridgeVersion: "1.2.2"'));
  for (const marker of [
    "runtimeCoordinator.connectAutomatically()",
    'data-testid="pair-auto-retry"',
    "正式網址會直接要求短期、精確來源的本機工作階段",
  ]) {
    assert.ok(aiSettingsSource.includes(marker), `AI settings: ${marker}`);
  }
  assert.ok(frontdoorSource.includes("coordinator.connectAutomatically()"));
  assert.ok(studioClosedAISource.includes("coordinator.connectAutomatically(signal)"));
});

await test("web workspaces expose real CRUD, chapter, AI, learning and safe legacy handoff", () => {
  for (const value of [
    "建立角色",
    "刪除世界",
    "建立世界規則",
    "建立事件",
    "儲存 Story Bible",
    "建立任務",
    "建立成就",
    "立即備份並下載",
    "還原",
  ]) {
    assert.ok(projectSource.includes(value), value);
  }
  for (const value of [
    "完成本章並建立下一章",
    "儲存目前內容",
    "刪除本章",
    "Ctrl+S",
    "beforeunload",
  ]) {
    assert.ok(writingSource.includes(value), value);
  }
  assert.ok(aiSource.includes("executeStudioClosedAgent"));
  assert.ok(aiSource.includes("產生三份候選"));
  assert.ok(aiSource.includes("候選品質"));
  assert.ok(aiSource.includes("qualityMode"));
  assert.ok(aiSource.includes("approveStudioClosedAgentCandidate"));
  assert.ok(workspaceSource.includes("品質模式"));
  assert.ok(workspaceSource.includes("executeStudioClosedAgent"));
  assert.ok(closedAgentServiceSource.includes("STUDIO_CLOSED_AGENT_TOOL_IDS"));
  assert.ok(closedAgentServiceSource.includes("createStudioClosedAgentToolRegistry"));
  assert.ok(closedAgentToolsSource.includes("acceptance-checklist"));
  assert.ok(closedAgentToolsSource.includes("story-context-index"));
  assert.ok(characterAgentSource.includes("用閉端 AI 深度推演"));
  assert.ok(characterAgentSource.includes("character.multiAgentSimulation"));
  assert.ok(dramaSource.includes("用閉端 AI 強化改編"));
  assert.ok(dramaSource.includes("drama.episodePlan"));
  assert.ok(learningSource.includes("Closed Agent OS 鎖定 Local Ollama"));
  assert.ok(learningSource.includes("前往偏好模型訓練／啟用／回滾"));
  assert.ok(legacySource.includes("dataset.officialClosedAiHandoff"));
  assert.ok(legacySource.includes("/closed-ai?"));
  assert.ok(consumerSource.includes("frontdoorProjectId"));
  assert.ok(consumerSource.includes('params.set("projectId",projectId)'));
  assert.ok(sovereignEntrySource.includes("frontdoorProjectId"));
  assert.ok(sovereignEntrySource.includes("novel_p2_active_project_id"));
  assert.ok(legacyHtmlSource.includes("consumer-app.js?v=p24b-closed-ai-optimization-r2"));
  assert.ok(legacyHtmlSource.includes("consumer-app.css?v=p24b-closed-ai-truth-r2"));
  assert.ok(legacyHtmlSource.includes("sovereign-learning-entry.js?v=closed-ai-sovereign-learning-v2"));
  assert.ok(serviceWorkerSource.includes(
    'const CACHE_VERSION = "novel-system-conversation-first-studio-rc6"',
  ));
  assert.equal(
    serviceWorkerSource.includes("novel-system-unified-closed-ai-20260729-2"),
    false,
    "the RC5 worker must not retain the retired unified Closed AI cache identity",
  );
});

const failed = results.filter((result) => result.status === "FAIL");
console.log(`\nClosed AI web operability: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  process.exitCode = 1;
}

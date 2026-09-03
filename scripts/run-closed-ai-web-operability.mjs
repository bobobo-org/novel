import assert from "node:assert/strict";
import fs from "node:fs";
import {
  BROWSER_AI_LIGHT_TASKS,
  ClosedAgentOS,
  MemoryClosedAgentStateRepository,
  PrivateAIHubBackendAdapter,
  evaluateClosedAgentCandidate,
} from "../lib/novel-ai/closed-agent-os/index.ts";
import { taskComplexity } from "../lib/novel-ai/closed-agent-os/backend-manifest.ts";
import {
  ClosedAICache,
  MemoryClosedAICacheRepository,
  sha256Hex,
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
  BROWSER_TASK_MODEL,
  runPackagedBrowserTaskModel,
} from "../lib/novel-ai/providers/browser-ai/browser-task-model.ts";
import { BROWSER_T1_TASKS } from "../lib/novel-ai/providers/browser-ai/browser-task-eligibility.ts";
import {
  createBrowserFinalModelContextAttestation,
  createBrowserFinalModelContextInvocationProof,
} from "../lib/novel-ai/security/browser-final-model-context-proof.ts";
import {
  containsConvertibleSimplifiedChinese,
  containsHighConfidenceSimplifiedChinese,
  containsProtectedProperNounDrift,
  createTraditionalChineseNormalizationPolicy,
  normalizeTraditionalChinese,
  normalizeTraditionalChinesePreservingProperNouns,
  normalizeTraditionalChineseWithIntegrity,
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
const aiRouteSource = read(
  "app/studio/project/[projectId]/ai/page.tsx",
);
const conversationSource = read(
  "app/studio/project/[projectId]/chat/conversation-workspace.tsx",
);
const conversationClosedAgentSource = read(
  "app/studio/project/[projectId]/chat/conversation-closed-agent.ts",
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
const taskProfileSource = read("lib/novel-ai/providers/closed/task-profile.ts");
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

const taskInstructionBlock = taskProfileSource.slice(
  taskProfileSource.indexOf("const TASK_INSTRUCTIONS"),
  taskProfileSource.indexOf("const BASE_INSTRUCTION"),
);
const taskPattern = /^\s*"([^"]+)":\s*"([^"]+)",?$/gmu;
const taskOptions = [...taskInstructionBlock.matchAll(taskPattern)]
  .map((match) => ({
    id: match[1],
    complexity: taskComplexity(match[1]),
    defaultObjective: match[2],
  }))
  // A/B/C has its own strict structured-output gate covered by the RPG suite.
  .filter((task) => task.id !== "chapter.abcChoices");

const approvedContext = [
  "【作品核心】一名守城人必須在保住城門與救回妹妹之間做選擇。",
  "【目前章節】林昭在雨夜抵達城門。她說：「如果現在開門，城裡的人都會有危險。」守門人握緊鑰匙，卻看見妹妹留在城外。",
  "【角色】林昭：審慎、重視生命；守門人：忠於職責，但害怕失去家人。",
  "【世界規則】城門在午夜後只能由兩名守衛共同開啟。",
].join("\n");

function modelDigestForBackend(id) {
  return {
    "browser-ai": "b".repeat(64),
    "local-ollama": "c".repeat(64),
    "private-ai-hub": "d".repeat(64),
  }[id];
}

function verificationSourceForBackend(id) {
  return {
    "browser-ai": "browser-runtime-generation",
    "local-ollama": "local-bridge-generation",
    "private-ai-hub": "private-hub-generation",
  }[id];
}

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
      runtimeTruth: {
        installed: true,
        configured: true,
        reachable: true,
        modelAvailable: true,
        runtimeVerified: true,
        generationVerified: true,
        verificationSource: verificationSourceForBackend(this.id),
        verifiedAt: "2026-08-10T00:00:00.000Z",
      },
      modelId: `${this.id}-operability-model`,
      modelDigest: modelDigestForBackend(this.id),
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
    const browserT1 = this.id === "browser-ai"
      && BROWSER_T1_TASKS.has(input.request.taskType);
    const modelId = browserT1
      ? BROWSER_TASK_MODEL.modelId
      : `${this.id}-operability-model`;
    const modelDigest = browserT1
      ? BROWSER_TASK_MODEL.modelDigest
      : modelDigestForBackend(this.id);
    const browserInvocation = this.id === "browser-ai" && !browserT1
      ? await createBrowserFinalModelContextInvocationProof({
        outerRequestId: input.request.taskId,
        invocationRequestId: `${input.request.taskId}:operability-initial`,
        outerTaskType: input.request.taskType,
        outerQualityPhase: input.qualityPhase,
        innerStage: "initial",
        innerIndex: 0,
        modelId,
        modelDigest,
        callOptionsDigest: await sha256Hex("web-operability-call-options-v3"),
        systemMessage: "web-operability-system",
        userMessage: "web-operability-user",
        expectations: [],
        omittedCharacters: 0,
      })
      : null;
    return {
      backendId: this.id,
      modelId,
      modelDigest,
      content: `「${input.request.taskType}」功能已透過 ${this.id} 真實執行管線建立候選。此結果保留角色選擇、世界規則與人工核准邊界，並提供可驗證的作者用途。`,
      candidateOnly: true,
      dataLeftDevice: false,
      externalRequest: false,
      elapsedMs: 3,
      profileId: `operability-${input.request.taskType}`,
      firstTokenMs: 1,
      inputCharacters: input.request.objective.length,
      outputCharacters: 80,
      generatedTokenEvents: 2,
      omittedInputCharacters: 0,
      ...(this.id === "browser-ai"
        ? browserT1
          ? { contextAttestation: "not_required" }
          : {
            contextAttestation: "required",
            finalModelContextAttestation:
              await createBrowserFinalModelContextAttestation({
                acceptedDisposition: "standalone",
                acceptedStage: "initial",
                executedStages: ["initial"],
                contributingCalls: [browserInvocation],
              }),
          }
        : {}),
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
    modelDigest: modelDigestForBackend(backendId),
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

await test("the automatic coordinator keeps a broad task profile catalog behind one story entry", () => {
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

await test("Traditional detector accepts shared-form prose after one pass and still blocks raw Simplified", async () => {
  const traditional = "那些守衛沒有離開，但是她可以先檢查門鎖，所以眾人決定留在原地，並承擔拖延帶來的風險。";
  const rawSimplified = "那些守卫没有离开，但是她可以先检查门锁，所以众人决定留在原地，并承担拖延带来的风险。";
  const policy = await createTraditionalChineseNormalizationPolicy({
    objective: "延續場景，交代守衛的選擇與風險。",
    privacyLevel: "device_only",
    context: [],
  });
  const normalized = await normalizeTraditionalChineseWithIntegrity({
    value: traditional,
    policy,
    requestId: "shared-form-traditional-test",
    providerId: "local-ollama",
    modelId: "qwen2.5:3b",
    modelDigest: "e".repeat(64),
    inputStage: "closed-agent-final-selected-content",
  });
  assert.equal(normalized.content, traditional);
  assert.equal(containsHighConfidenceSimplifiedChinese(traditional, []), false);
  assert.equal(containsHighConfidenceSimplifiedChinese(rawSimplified, []), true);
  for (const source of [
    "这是", "这个", "这些", "我们", "你们", "他们", "她们", "没有", "因为", "然后",
    "已经", "还是", "时候", "什么", "怎么", "为什么", "应该", "起来", "进去", "出来",
  ]) {
    assert.equal(containsHighConfidenceSimplifiedChinese(source, []), true);
    assert.equal(
      containsHighConfidenceSimplifiedChinese(
        normalizeTraditionalChinese(source),
        [],
      ),
      false,
    );
  }
  for (const source of Array.from(
    "这们国为个来说还进过发门问间见开无东乐书车马风气体头长亲爱边变点电动读话画让实写号听难类学术数应总处经认许从",
  )) {
    assert.equal(containsHighConfidenceSimplifiedChinese(source, []), true);
    assert.equal(
      containsHighConfidenceSimplifiedChinese(
        normalizeTraditionalChinese(source),
        [],
      ),
      false,
    );
  }
  for (const [source, expected] of [
    ["万俟", "万俟"],
    ["万旗", "万旗"],
    ["不可以道里计", "不可以道里計"],
    ["么凤士多", "么鳳士多"],
    ["占万", "佔万"],
    ["只可以", "只可以"],
    ["可以克制", "可以剋制"],
    ["叶叶琹", "葉叶琹"],
    ["叶恭弘", "叶恭弘"],
    ["叶音", "叶音"],
    ["叶韵", "叶韻"],
    ["夏虫不可以语冰", "夏蟲不可以語冰"],
    ["崖广", "崖广"],
    ["并可以", "並可以"],
    ["幺么小丑", "么麼小醜"],
    ["幺并矢", "么並矢"],
    ["幺麼小丑", "么麼小醜"],
    ["幺麽小丑", "么麼小醜"],
    ["广部", "广部"],
    ["才可以", "才可以"],
    ["梦兰叶吉", "夢蘭叶吉"],
    ["潭祉叶吉", "潭祉叶吉"],
  ]) {
    const onePassOutput = normalizeTraditionalChinese(source);
    assert.equal(onePassOutput, expected);
    assert.equal(containsHighConfidenceSimplifiedChinese(onePassOutput, []), false);
  }
  for (const [source, expected] of [
    ["万", "萬"],
    ["么", "麼"],
    ["叶", "葉"],
    ["广", "廣"],
  ]) {
    assert.equal(normalizeTraditionalChinese(source), expected);
  }
  for (const [index, source, expected] of [
    [0, "一出声", "一出聲"],
    [1, "万里", "萬里"],
    [2, "不干扰", "不干擾"],
    [3, "丑时", "丑時"],
  ]) {
    const once = await normalizeTraditionalChineseWithIntegrity({
      value: source,
      policy,
      requestId: `single-pass-non-idempotent-${index}`,
      providerId: "local-ollama",
      modelId: "qwen2.5:3b",
      modelDigest: "e".repeat(64),
      inputStage: "closed-agent-final-selected-content",
    });
    assert.equal(once.content, expected);
    assert.equal(once.integrity.normalizationOperationCount, 1);
    assert.equal(containsHighConfidenceSimplifiedChinese(once.content, []), false);
  }

  const request = {
    taskId: "shared-form-traditional-test",
    namespace: {
      tenantId: "local-tenant",
      userId: "local-author",
      projectId: "shared-form-project",
      storyId: "shared-form-story",
      canonId: "shared-form-canon",
      branchId: "main",
      characterId: "shared",
      agentRole: "closed-agent-os",
      modelId: "qwen2.5:3b",
      modelDigest: "e".repeat(64),
      promptProfileVersion: "shared-form-v1",
      storyBibleRevision: "1",
      knowledgeScopeRevision: "1",
      privacyLevel: "device_only",
    },
    taskType: "story.continue",
    objective: "延續場景，交代守衛的選擇與風險。",
    context: [],
    complexity: "standard",
    preferredBackend: "local-ollama",
    allowedToolIds: [],
    permissionScopes: permissions(),
  };
  const execution = {
    backendId: "local-ollama",
    modelId: "qwen2.5:3b",
    modelDigest: "e".repeat(64),
    content: normalized.content,
    traditionalChineseNormalization: normalized.integrity,
    candidateOnly: true,
    dataLeftDevice: false,
    externalRequest: false,
    elapsedMs: 5,
  };
  const accepted = await evaluateClosedAgentCandidate({
    request,
    execution,
    traditionalChineseNormalizationPolicy: policy,
  });
  assert.equal(accepted.passed, true);
  assert.doesNotMatch(
    accepted.blockingCodes.join("|"),
    /CANDIDATE_SIMPLIFIED_CHINESE_REMAINS/u,
  );

  const rawRejected = await evaluateClosedAgentCandidate({
    request,
    execution: { ...execution, content: rawSimplified },
    traditionalChineseNormalizationPolicy: policy,
  });
  assert.equal(rawRejected.passed, false);
  assert.ok(rawRejected.blockingCodes.includes(
    "CANDIDATE_TRADITIONAL_CHINESE_INTEGRITY_INVALID",
  ));
  assert.ok(rawRejected.blockingCodes.includes(
    "CANDIDATE_SIMPLIFIED_CHINESE_REMAINS",
  ));
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
  const policy = await createTraditionalChineseNormalizationPolicy({
    objective: "角色名：沈岳。延續城門場景。",
    privacyLevel: "device_only",
    context: [],
  });
  const normalized = await normalizeTraditionalChineseWithIntegrity({
    value: "沈岳握住銅鑰匙，決定先驗證來者身分，再承擔延誤開門的風險。",
    policy,
    requestId: "proper-noun-drift-test",
    providerId: "local-ollama",
    modelId: "qwen2.5:3b",
    modelDigest: "e".repeat(64),
    inputStage: "closed-agent-final-selected-content",
  });
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
      content: normalized.content,
      traditionalChineseNormalization: normalized.integrity,
      candidateOnly: true,
      dataLeftDevice: false,
      externalRequest: false,
      elapsedMs: 5,
    },
    traditionalChineseNormalizationPolicy: policy,
  });
  assert.equal(evaluation.passed, false);
  assert.ok(evaluation.blockingCodes.includes("CANDIDATE_PROPER_NOUN_DRIFT"));
});

await test("two-Han canonical ambiguity converts prose but fails closed on a bare subject", async () => {
  const context = [{
    id: "canonical-character-identities:two-han",
    kind: "canon",
    text: '[CANONICAL_CHARACTER_IDENTITIES]\n[{"name":"王国","aliases":[]},{"name":"开心","aliases":[]},{"name":"国王","aliases":[]},{"name":"长城","aliases":[]},{"name":"万里","aliases":[]}]',
    visibility: "both",
    privacyLevel: "device_only",
    approved: true,
    composerAuthority: "project-context-composer-v1",
    canonicalIdentitySource: "characters",
  }];
  const policy = await createTraditionalChineseNormalizationPolicy({
    objective: "延續已核准場景。",
    privacyLevel: "device_only",
    context,
  });
  const normalize = (value, requestId) => normalizeTraditionalChineseWithIntegrity({
    value,
    policy,
    requestId,
    providerId: "local-ollama",
    modelId: "qwen2.5:3b",
    modelDigest: "e".repeat(64),
    inputStage: "closed-agent-final-selected-content",
  });
  const ambiguous = await normalize(
    "王国走进城门，決定先詢問守衛，再承擔延誤會面的風險。",
    "two-han-ambiguous",
  );
  assert.match(ambiguous.content, /^王國走進城門/u);
  assert.equal(ambiguous.integrity.ambiguousCanonicalOccurrenceCount, 1);
  const evaluation = await evaluateClosedAgentCandidate({
    request: {
      taskId: "two-han-ambiguous",
      namespace: {
        tenantId: "local-tenant",
        userId: "local-author",
        projectId: "two-han-project",
        storyId: "two-han-story",
        canonId: "two-han-canon",
        branchId: "main",
        characterId: "shared",
        agentRole: "closed-agent-os",
        modelId: "qwen2.5:3b",
        modelDigest: "e".repeat(64),
        promptProfileVersion: "two-han-v1",
        storyBibleRevision: "1",
        knowledgeScopeRevision: "1",
        privacyLevel: "device_only",
      },
      taskType: "story.continue",
      objective: "延續已核准場景。",
      context,
      complexity: "standard",
      preferredBackend: "local-ollama",
      allowedToolIds: [],
      permissionScopes: permissions(),
    },
    execution: {
      backendId: "local-ollama",
      modelId: "qwen2.5:3b",
      modelDigest: "e".repeat(64),
      content: ambiguous.content,
      traditionalChineseNormalization: ambiguous.integrity,
      candidateOnly: true,
      dataLeftDevice: false,
      externalRequest: false,
      elapsedMs: 5,
    },
    traditionalChineseNormalizationPolicy: policy,
  });
  assert.ok(evaluation.blockingCodes.includes("CANDIDATE_PROPER_NOUN_DRIFT"));
  for (const [index, action] of [
    "衝進城門",
    "奔向鐘樓",
    "拔劍迎敵",
    "縱身躍下",
    "沉默不語",
    "閃身避開",
  ].entries()) {
    const unseenAction = await normalize(
      `王国${action}，仍必須承擔選擇造成的後果。`,
      `two-han-unseen-action-${index}`,
    );
    assert.equal(unseenAction.integrity.ambiguousCanonicalOccurrenceCount, 1);
  }
  for (const [index, sentence] of [
    "這時王国衝進城門，守衛立刻拉響警鐘。",
    "隨後王国拔劍迎敵，眾人退到長廊。",
    "轉眼間王国縱身躍下，落在城牆外。",
  ].entries()) {
    const unknownContext = await normalize(
      sentence,
      `two-han-unknown-context-${index}`,
    );
    assert.equal(unknownContext.integrity.ambiguousCanonicalOccurrenceCount, 1);
  }

  const prose = await normalize(
    "這個王国開始動亂，百姓只得關閉城門。",
    "two-han-common-prose",
  );
  assert.match(prose.content, /這個王國開始動亂/u);
  assert.equal(prose.integrity.ambiguousCanonicalOccurrenceCount, 0);
  for (const [index, value, expected] of [
    [0, "她很开心地笑了，決定先回家。", /很開心地笑了/u],
    [1, "百姓見到国王下令，便關閉城門。", /見到國王下令/u],
    [2, "他到长城後停下腳步，望向遠方。", /到長城後/u],
    [3, "他走了万里才抵達故鄉，鞋底早已磨破。", /走了萬里/u],
  ]) {
    const common = await normalize(value, `two-han-clear-common-${index}`);
    assert.match(common.content, expected);
    assert.equal(common.integrity.ambiguousCanonicalOccurrenceCount, 0);
  }
  const vocative = await normalize(
    "「王国，你回來了。」守衛鬆了一口氣。",
    "two-han-vocative",
  );
  assert.match(vocative.content, /「王国，你回來了。」/u);
  assert.equal(vocative.integrity.ambiguousCanonicalOccurrenceCount, 0);
  const objectMention = await normalize(
    "他看見王国，立刻把信交給對方。",
    "two-han-object",
  );
  assert.match(objectMention.content, /看見王国/u);
  assert.equal(objectMention.integrity.ambiguousCanonicalOccurrenceCount, 0);
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
    getModelVerification: () => ({
      proofVersion: "private-hub-model-inference-proof-v1",
      state: "inference_verified",
      providerKind: "private_ai_hub",
      deploymentKind: "self_hosted_loopback_private_node",
      instanceId: "test-instance",
      modelId: "qwen2.5:3b",
      modelDigest: "b".repeat(64),
      verifiedAt: new Date().toISOString(),
      latencyMs: 8,
      outputDigest: "c".repeat(64),
      outputBytes: 16,
      evalCount: 4,
      externalRequest: false,
      dataLeftDevice: false,
    }),
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
        runtimeTruth: {
          installed: true,
          configured: true,
          reachable: true,
          modelAvailable: true,
          runtimeVerified: true,
          generationVerified: true,
          verificationSource: "private-hub-generation",
          verifiedAt: "2026-08-10T00:00:00.000Z",
        },
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
        content: "守衛看見沈岳，便收起銅鑰匙，先命人點亮城牆烽火，再以第二道暗號驗證來者；若判斷失誤，追兵將循火光找到北門。",
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
    context: [{
      id: "canonical-character-identities:all",
      kind: "canon",
      text: '[CANONICAL_CHARACTER_IDENTITIES]\n[{"name":"沈岳"}]',
      visibility: "both",
      privacyLevel: "private_infrastructure_only",
      approved: true,
      composerAuthority: "project-context-composer-v1",
      canonicalIdentitySource: "characters",
    }],
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
    "enableLearning",
    "engageKillSwitch",
    "clearProjectCache",
    "exportGovernanceEvidence",
    "exportLearning",
    "deleteLearning",
    "trainPreferenceModel",
    "activatePreferenceModel",
    "rollbackPreferenceModel",
  ]) {
    assert.match(workspaceSource, new RegExp(`function ${handler}\\b`, "u"), handler);
  }
});

await test("official production UI connects local runtimes on demand and exposes version updates", () => {
  const count = (source, marker) => source.split(marker).length - 1;
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
  assert.ok(companionReleaseSource.includes('version: "1.4.7"'));
  assert.ok(companionReleaseSource.includes('minimumBridgeVersion: "1.2.4"'));
  assert.ok(companionReleaseSource.includes('recommendedBridgeVersion: "1.2.4"'));
  for (const marker of [
    "runtimeCoordinator.connectAutomatically()",
    'data-testid="pair-auto-retry"',
    "按下連線／檢查後，正式網址才會要求短期、精確來源的本機工作階段",
  ]) {
    assert.ok(aiSettingsSource.includes(marker), `AI settings: ${marker}`);
  }
  assert.equal(
    count(localAISetupSource, "void refresh()"),
    count(localAISetupSource, "onClick={() => void refresh()}"),
    "setup wizard must only probe loopback after an explicit click",
  );
  assert.ok(localAISetupSource.includes("等待你按下「檢查本機網路權限」"));
  assert.equal(
    count(aiSettingsSource, "void refresh()"),
    count(aiSettingsSource, "onClick={() => void refresh()}"),
    "AI settings must only probe loopback after an explicit click",
  );
  assert.ok(aiSettingsSource.includes('browser: "等待手動檢查"'));
  assert.equal(
    count(workspaceSource, "void connectRuntimesAutomatically()"),
    count(workspaceSource, "onClick={() => void connectRuntimesAutomatically()}"),
    "Closed AI workspace must only connect loopback runtimes after an explicit click",
  );
  assert.ok(workspaceSource.includes("等待你按下「連線／檢查」後"));
  assert.ok(localAISetupSource.includes("client.connectAutomatically"));
  assert.ok(aiSettingsSource.includes("runtimeCoordinator.connectAutomatically()"));
  assert.ok(workspaceSource.includes("runtimeCoordinator.connectLocalAutomatically()"));
  assert.ok(workspaceSource.includes("connectPrivateHubAutomatically()"));
  assert.ok(!workspaceSource.includes("reconnectAfterResume"));
  assert.ok(!workspaceSource.includes("automaticConnectionCheckedAt"));
  assert.ok(!frontdoorSource.includes("coordinator.connectAutomatically()"));
  assert.ok(frontdoorSource.includes("a public front door must never probe"));
  assert.ok(!studioClosedAISource.includes("coordinator.connectAutomatically(signal)"));
  const passiveDiscoveryStart = studioClosedAISource.indexOf("async function readPassiveStudioProviderSnapshots");
  const explicitExecutionStart = studioClosedAISource.indexOf("async function runStudioClosedAIUnsettled");
  assert.ok(passiveDiscoveryStart >= 0, "Studio mount discovery must have a passive provider reader");
  assert.ok(explicitExecutionStart > passiveDiscoveryStart, "passive discovery must stay before explicit execution");
  const passiveDiscoverySource = studioClosedAISource.slice(passiveDiscoveryStart, explicitExecutionStart);
  assert.ok(passiveDiscoverySource.includes("getSessionMetadata()"));
  assert.ok(passiveDiscoverySource.includes("getModelVerification()"));
  assert.ok(passiveDiscoverySource.includes("readPassiveStudioProviderSnapshots(signal)"));
  assert.doesNotMatch(
    passiveDiscoverySource,
    /\.refresh\(|restoreRememberedSession|backendSnapshots|connectAutomatically|connectLocalAutomatically|connectPrivateHubAutomatically/u,
    "public mount discovery must never restore, probe, or connect a Companion backend",
  );
  assert.ok(studioClosedAISource.includes("connectLocalAutomatically(deadline.signal)"));
  assert.ok(studioClosedAISource.includes("localClient.hasActiveOrRememberedSession()"));
  assert.ok(closedAgentServiceSource.includes("connectLocalAutomatically(input.signal)"));
  assert.ok(closedAgentServiceSource.includes("localClient.hasActiveOrRememberedSession()"));
  assert.ok(closedAgentServiceSource.includes("connectPrivateHubAutomatically(input.signal)"));
  assert.ok(closedAgentServiceSource.includes("privateHubClient.hasActiveOrRememberedSession()"));
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
  assert.ok(aiRouteSource.includes("/chat"));
  assert.ok(aiRouteSource.includes("redirect("));
  assert.ok(conversationSource.includes("runConversationClosedAgent"));
  assert.ok(conversationClosedAgentSource.includes("executeStudioClosedAgent"));
  assert.ok(conversationSource.includes("useConversationApprovalController"));
  assert.ok(workspaceSource.includes("前往唯一故事工作台"));
  assert.ok(workspaceSource.includes('data-testid="closed-ai-management-boundary"'));
  assert.ok(!workspaceSource.includes("executeStudioClosedAgent"));
  assert.ok(!workspaceSource.includes("commitStudioCandidateToChapter"));
  assert.ok(closedAgentServiceSource.includes("STUDIO_CLOSED_AGENT_TOOL_IDS"));
  assert.ok(closedAgentServiceSource.includes("createStudioClosedAgentToolRegistry"));
  assert.ok(closedAgentToolsSource.includes("acceptance-checklist"));
  assert.ok(closedAgentToolsSource.includes("story-context-index"));
  assert.ok(characterAgentSource.includes("由真正閉端 AI 試演小說段落"));
  assert.ok(characterAgentSource.includes("不會拿後備模板冒充"));
  assert.ok(characterAgentSource.includes("Canonical mutation = 0"));
  assert.ok(characterAgentSource.includes("character.multiAgentSimulation"));
  assert.ok(dramaSource.includes("用閉端 AI 強化改編"));
  assert.ok(dramaSource.includes("drama.episodePlan"));
  assert.ok(learningSource.includes("統合閉端 AI 自動協調器"));
  assert.ok(learningSource.includes("內建教師永遠可用；Local Ollama"));
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

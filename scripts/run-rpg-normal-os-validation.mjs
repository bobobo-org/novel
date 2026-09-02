import assert from "node:assert/strict";
import "fake-indexeddb/auto";

import {
  assertAdultNarrativeFadeToBlackOutput,
} from "../lib/novel-ai/adult/scenes/index.ts";
import {
  sha256Hex,
  stableStringify,
} from "../lib/novel-ai/closed-ai-cache/index.ts";
import {
  getStudioClosedAgentOS,
} from "../lib/novel-ai/web/closed-agent-os-service.ts";
import {
  runStudioClosedAI,
  studioPromptProfileVersion,
} from "../lib/novel-ai/web/studio-closed-ai.ts";
import {
  createRpgAdultRuntimeProductionFixture,
} from "./fixtures/rpg-adult-runtime-production-fixture.mjs";
import {
  buildProjectBundle,
  createDraft,
} from "../lib/novel-ai/domain/creation.ts";
import { optionalValue } from "../lib/novel-ai/domain/index.ts";
import {
  buildTopicWorldFamilyStageMatrix,
  serializeTopicWorldFamilyDraftSelection,
} from "../lib/novel-ai/game/topic-world-family-stage-matrix.ts";
import { createNovelRepository } from "../lib/novel-ai/repository/index.ts";

const MODEL_ID = "rpg-normal-validation-model";
const MODEL_DIGEST = "a".repeat(64);

class FixedNormalValidationBackend {
  id = "local-ollama";

  constructor(content) {
    this.content = content;
    this.executionCount = 0;
  }

  async snapshot() {
    return {
      id: this.id,
      label: "RPG normal pre-persistence validation fixture",
      status: "ready",
      runtimeTruth: {
        installed: true,
        configured: true,
        reachable: true,
        modelAvailable: true,
        runtimeVerified: true,
        generationVerified: true,
        verificationSource: "local-bridge-generation",
        verifiedAt: "2026-08-30T00:00:00.000Z",
      },
      modelId: MODEL_ID,
      modelDigest: MODEL_DIGEST,
      local: true,
      dataBoundary: "device",
      maximumComplexity: "standard",
      capabilities: ["text"],
      supportedTaskTypes: "all",
      detailCode: "normal-validation-test-ready",
    };
  }

  async execute(input) {
    this.executionCount += 1;
    return {
      backendId: this.id,
      modelId: MODEL_ID,
      modelDigest: MODEL_DIGEST,
      content: this.content,
      candidateOnly: true,
      dataLeftDevice: false,
      externalRequest: false,
      elapsedMs: 8,
      profileId: "rpg-normal-pre-persistence-validation-v1",
      firstTokenMs: 1,
      inputCharacters: input.request.objective.length,
      outputCharacters: this.content.length,
      generatedTokenEvents: Math.max(16, Math.ceil(this.content.length / 12)),
      omittedInputCharacters: 0,
      qualityMode: "balanced",
      qualityPasses: 1,
      draftDigest: null,
      criticDigest: null,
    };
  }
}

class BrowserQualityFailureBackend {
  id = "browser-ai";
  executionCount = 0;

  async snapshot() {
    return {
      id: this.id,
      label: "Browser quality failure fixture",
      status: "ready",
      runtimeTruth: {
        installed: true,
        configured: true,
        reachable: true,
        modelAvailable: true,
        runtimeVerified: true,
        generationVerified: true,
        verificationSource: "browser-runtime-generation",
        verifiedAt: "2026-08-30T00:00:00.000Z",
      },
      modelId: "browser-quality-failure-model",
      modelDigest: "f".repeat(64),
      local: true,
      dataBoundary: "device",
      maximumComplexity: "standard",
      capabilities: ["text"],
      supportedTaskTypes: "all",
      detailCode: "browser-quality-test-ready",
    };
  }

  async execute() {
    this.executionCount += 1;
    throw Object.assign(new Error("Browser quality gate rejected the candidate."), {
      code: "BROWSER_AI_QUALITY_INSUFFICIENT",
      qualityReasonCodes: ["QUALITY_NARRATIVE_TOO_SHORT"],
    });
  }
}

class DelayedLocalFallbackBackend extends FixedNormalValidationBackend {
  snapshotCount = 0;

  async snapshot() {
    this.snapshotCount += 1;
    if (this.snapshotCount === 1) {
      return {
        id: this.id,
        label: "Delayed Local fallback fixture",
        status: "runtime_unavailable",
        runtimeTruth: {
          installed: false,
          configured: false,
          reachable: false,
          modelAvailable: false,
          runtimeVerified: false,
          generationVerified: false,
          verificationSource: "none",
          verifiedAt: null,
        },
        modelId: null,
        modelDigest: null,
        local: true,
        dataBoundary: "device",
        maximumComplexity: "standard",
        capabilities: ["text"],
        supportedTaskTypes: "all",
        detailCode: "local-fallback-not-ready-on-first-probe",
      };
    }
    return super.snapshot();
  }
}

function routedNamespace(projectId) {
  return {
    tenantId: "local-tenant",
    userId: "local-author",
    projectId,
    storyId: projectId,
    canonId: `canon:${projectId}`,
    branchId: "main",
    characterId: "shared",
    agentRole: "closed-agent-os",
    modelId: MODEL_ID,
    modelDigest: MODEL_DIGEST,
    promptProfileVersion: studioPromptProfileVersion(false),
    storyBibleRevision: "current",
    knowledgeScopeRevision: "current",
    privacyLevel: "device_only",
  };
}

async function cacheEntriesFor(os, projectId) {
  return (await os.cache.repository.list())
    .filter((entry) => entry.namespace.projectId === projectId);
}

async function candidateLedgerWritesFor(os, projectId, taskId) {
  return (await os.ledger.repository.list(`closed-agent:${projectId}:${taskId}`))
    .filter((block) =>
      block.eventType === "candidate-generated"
      || block.eventType === "candidate-evaluated"
      || Boolean(block.contentRecordId));
}

async function assertNoTaskDurability(os, projectId, taskId, message) {
  assert.deepEqual(
    await os.state.list(projectId, "task"),
    [],
    `${message}: task state was written`,
  );
  assert.deepEqual(
    await os.state.list(projectId, "candidate"),
    [],
    `${message}: candidate state was written`,
  );
  assert.deepEqual(
    await os.ledger.repository.list(`closed-agent:${projectId}:${taskId}`),
    [],
    `${message}: ledger metadata was written`,
  );
}

async function createCanonicalProject(label) {
  const draft = createDraft("quick");
  draft.title = `Closed OS validation ${label}`;
  draft.genrePackId = "pack-6";
  draft.genreId = "classic-topic-009";
  draft.protagonist = optionalValue("林澄", "user_defined");
  draft.coreIdea = optionalValue("林澄必須在天亮前查明換封者並承擔追查代價。", "user_defined");
  draft.answers.playMode = optionalValue("rpg", "user_defined");
  const stageMatrix = buildTopicWorldFamilyStageMatrix({
    seed: `novel-project:${draft.projectId}:procedural-v1`,
    topicId: draft.genreId,
    playMode: "rpg",
  });
  draft.answers.stageFamily = optionalValue(
    serializeTopicWorldFamilyDraftSelection({
      matrix: stageMatrix,
      familyId: stageMatrix.stageFamilies[0].familyId,
    }),
    "user_defined",
  );
  const bundle = buildProjectBundle(draft);
  const repository = createNovelRepository();
  await repository.createProject(bundle, `create:rpg-normal-os-validation:${label}`);
  return bundle.project.id;
}

globalThis.window = {
  location: { origin: "http://localhost" },
  dispatchEvent: () => true,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};
const os = getStudioClosedAgentOS();
const fixture = createRpgAdultRuntimeProductionFixture();
const backend = new FixedNormalValidationBackend(fixture.story);
os.backends = new Map([[backend.id, backend]]);

const validProjectId = await createCanonicalProject(`valid-${crypto.randomUUID()}`);
await os.learning.setConsent({
  namespace: routedNamespace(validProjectId),
  enabled: true,
});
const validLearningBefore = await os.learning.repository.list(validProjectId);
let validGateCalled = false;
let validNormalizedContent = "";
const validTaskId = `rpg-normal-validation-valid-task-${crypto.randomUUID()}`;
const validResult = await runStudioClosedAI({
  projectId: validProjectId,
  task: "branch_choice",
  taskId: validTaskId,
  input: "依照鎖定結果續寫完整小說回合；此為一般、可持久化的閉端 AI 正文請求。",
  targetLength: 1_600,
  sourceChapterId: "chapter-normal-validation",
  sourceRevision: 1,
  qualityMode: "balanced",
  browserComputePolicy: "quality-first",
  applicationValidationBindingDigest: "b".repeat(64),
  validateBeforePersistence: async (candidate) => {
    validGateCalled = true;
    validNormalizedContent = candidate.content;
    assert.match(candidate.content, /〈雨夜封條〉/u);
    assert.equal(
      (await os.state.list(validProjectId, "candidate")).length,
      0,
      "normal candidate reached durable state before its application validator",
    );
    assert.deepEqual(
      await candidateLedgerWritesFor(os, validProjectId, validTaskId),
      [],
      "normal candidate reached durable ledger content before its application validator",
    );
    assert.equal(
      (await cacheEntriesFor(os, validProjectId)).length,
      0,
      "normal request wrote prompt/candidate caches before its application validator",
    );
    assert.equal(
      (await os.learning.repository.list(validProjectId)).length,
      validLearningBefore.length,
      "normal request wrote learning records before its application validator",
    );
  },
});
assert.equal(validGateCalled, true);
assert.ok(validResult.candidateId, "valid normal execution did not return a durable candidate");
assert.equal(validResult.content, validNormalizedContent);
assert.equal(
  validResult.applicationValidationBindingDigest,
  "b".repeat(64),
  "Studio result did not expose the digest-only application validation binding",
);
assert.equal((await os.state.list(validProjectId, "candidate")).length, 1);
const validStoredCandidate = await os.state.get(validResult.candidateId);
assert.equal(
  validStoredCandidate?.applicationValidationBindingDigest,
  "b".repeat(64),
  "authoritative candidate did not retain the request-contract-bound application digest",
);
assert.equal(
  await os.hasVerifiedCandidateLedgerIntegrity({
    ...validStoredCandidate,
    applicationValidationBindingDigest: "d".repeat(64),
  }),
  false,
  "a tampered application digest still matched the retained candidate ledger",
);
assert.ok(
  (await cacheEntriesFor(os, validProjectId)).some((entry) =>
    entry.layer === "exact" || entry.layer === "semantic"),
  "valid normal execution did not populate a reusable candidate cache after validation",
);
assert.ok(
  (await os.learning.repository.list(validProjectId)).length > validLearningBefore.length,
  "valid normal execution did not record deferred operational learning after validation",
);

const invalidProjectId = await createCanonicalProject(`adult-invalid-${crypto.randomUUID()}`);
await os.learning.setConsent({
  namespace: routedNamespace(invalidProjectId),
  enabled: true,
});
const invalidLearningBefore = await os.learning.repository.list(invalidProjectId);
backend.content = fixture.story.replace(
  "她沒有聲張，只把東側窄巷交給可信的人盯住。",
  "她沒有聲張；兩人脫去衣物，他反覆進入她體內直到高潮，之後才把東側窄巷交給可信的人盯住。",
);
let invalidGateCalled = false;
const invalidTaskId = `rpg-normal-validation-adult-invalid-task-${crypto.randomUUID()}`;
await assert.rejects(
  () => runStudioClosedAI({
    projectId: invalidProjectId,
    task: "branch_choice",
    taskId: invalidTaskId,
    input: "成人模式仍只准結構性淡出，不得輸出露骨性行為描寫。",
    targetLength: 1_600,
    sourceChapterId: "chapter-normal-validation-adult",
    sourceRevision: 1,
    qualityMode: "balanced",
    browserComputePolicy: "quality-first",
    applicationValidationBindingDigest: "c".repeat(64),
    validateBeforePersistence: async (candidate) => {
      invalidGateCalled = true;
      assertAdultNarrativeFadeToBlackOutput(candidate.content);
    },
  }),
  (error) => error?.code === "ADULT_NARRATIVE_EXPLICIT_OUTPUT_REJECTED",
  "adult explicit output escaped the normal Closed Agent application validator",
);
assert.equal(invalidGateCalled, true);
assert.equal(
  (await os.state.list(invalidProjectId, "candidate")).length,
  0,
  "rejected adult output left a durable candidate",
);
assert.deepEqual(
  await candidateLedgerWritesFor(os, invalidProjectId, invalidTaskId),
  [],
  "rejected adult output left durable candidate ledger content",
);
assert.deepEqual(
  await cacheEntriesFor(os, invalidProjectId),
  [],
  "rejected adult output left a durable cache entry",
);
assert.equal(
  (await os.learning.repository.list(invalidProjectId)).length,
  invalidLearningBefore.length,
  "rejected adult output left a durable learning record",
);

backend.content = fixture.story;
const validatorWithoutBindingProjectId = await createCanonicalProject(
  `validator-without-binding-${crypto.randomUUID()}`,
);
const validatorWithoutBindingTaskId =
  `validator-without-binding-task-${crypto.randomUUID()}`;
const executionsBeforeMissingValidatorBinding = backend.executionCount;
await assert.rejects(
  () => runStudioClosedAI({
    projectId: validatorWithoutBindingProjectId,
    task: "summary",
    taskId: validatorWithoutBindingTaskId,
    input: "這個 validator 缺少 digest，不得開始模型工作。",
    browserComputePolicy: "quality-first",
    validateBeforePersistence: async () => undefined,
  }),
  (error) => error?.code === "CLOSED_AGENT_TRANSIENT_VALIDATION_CONTRACT_INVALID",
);
assert.equal(
  backend.executionCount,
  executionsBeforeMissingValidatorBinding,
  "validator without binding executed a backend",
);
await assertNoTaskDurability(
  os,
  validatorWithoutBindingProjectId,
  validatorWithoutBindingTaskId,
  "validator without binding",
);

const bindingWithoutValidatorProjectId = await createCanonicalProject(
  `binding-without-validator-${crypto.randomUUID()}`,
);
const bindingWithoutValidatorTaskId =
  `binding-without-validator-task-${crypto.randomUUID()}`;
const executionsBeforeMissingValidator = backend.executionCount;
await assert.rejects(
  () => runStudioClosedAI({
    projectId: bindingWithoutValidatorProjectId,
    task: "summary",
    taskId: bindingWithoutValidatorTaskId,
    input: "這個 digest 缺少 validator，不得開始模型工作。",
    browserComputePolicy: "quality-first",
    applicationValidationBindingDigest: "1".repeat(64),
  }),
  (error) => error?.code === "CLOSED_AGENT_TRANSIENT_VALIDATION_CONTRACT_INVALID",
);
assert.equal(
  backend.executionCount,
  executionsBeforeMissingValidator,
  "binding without validator executed a backend",
);
await assertNoTaskDurability(
  os,
  bindingWithoutValidatorProjectId,
  bindingWithoutValidatorTaskId,
  "binding without validator",
);

const unauthorizedBudgetProjectId = await createCanonicalProject(
  `unauthorized-scene-budget-${crypto.randomUUID()}`,
);
const unauthorizedBudgetTaskId =
  `unauthorized-scene-budget-task-${crypto.randomUUID()}`;
const executionsBeforeUnauthorizedBudget = backend.executionCount;
await assert.rejects(
  () => runStudioClosedAI({
    projectId: unauthorizedBudgetProjectId,
    task: "branch_choice",
    taskId: unauthorizedBudgetTaskId,
    input: "沒有綁定應用驗證器的普通請求不得降低 provider 完成門檻。",
    targetLength: 1_600,
    browserComputePolicy: "quality-first",
    generationOptions: {
      maxTokens: 1_792,
      substantiveScene: true,
      substantiveSceneBudget: "rpg-application-minimum",
    },
  }),
  (error) => error?.code === "CLOSED_AGENT_SUBSTANTIVE_SCENE_BUDGET_INVALID",
);
assert.equal(
  backend.executionCount,
  executionsBeforeUnauthorizedBudget,
  "an unbound application-minimum request executed a backend",
);
await assertNoTaskDurability(
  os,
  unauthorizedBudgetProjectId,
  unauthorizedBudgetTaskId,
  "unauthorized application-minimum scene budget",
);

const sceneBudgetAuthorizationCases = [
  {
    name: "wrong-task-type",
    task: "summary",
    ephemeralPrompt: true,
    applicationValidationBindingDigest: "8".repeat(64),
    validateBeforePersistence: async () => undefined,
    substantiveScene: true,
    budget: "rpg-application-minimum",
    expectedCode: "CLOSED_AGENT_SUBSTANTIVE_SCENE_BUDGET_INVALID",
  },
  {
    name: "non-substantive-scene",
    task: "branch_choice",
    ephemeralPrompt: true,
    applicationValidationBindingDigest: "8".repeat(64),
    validateBeforePersistence: async () => undefined,
    substantiveScene: false,
    budget: "rpg-application-minimum",
    expectedCode: "CLOSED_AGENT_SUBSTANTIVE_SCENE_BUDGET_INVALID",
  },
  {
    name: "non-ephemeral-prompt",
    task: "branch_choice",
    ephemeralPrompt: false,
    applicationValidationBindingDigest: "8".repeat(64),
    validateBeforePersistence: async () => undefined,
    substantiveScene: true,
    budget: "rpg-application-minimum",
    expectedCode: "CLOSED_AGENT_SUBSTANTIVE_SCENE_BUDGET_INVALID",
  },
  {
    name: "missing-validator",
    task: "branch_choice",
    ephemeralPrompt: true,
    applicationValidationBindingDigest: "8".repeat(64),
    validateBeforePersistence: undefined,
    substantiveScene: true,
    budget: "rpg-application-minimum",
    expectedCode: "CLOSED_AGENT_TRANSIENT_VALIDATION_CONTRACT_INVALID",
  },
  {
    name: "missing-binding",
    task: "branch_choice",
    ephemeralPrompt: true,
    applicationValidationBindingDigest: undefined,
    validateBeforePersistence: async () => undefined,
    substantiveScene: true,
    budget: "rpg-application-minimum",
    expectedCode: "CLOSED_AGENT_TRANSIENT_VALIDATION_CONTRACT_INVALID",
  },
  {
    name: "unknown-runtime-enum",
    task: "branch_choice",
    ephemeralPrompt: true,
    applicationValidationBindingDigest: "8".repeat(64),
    validateBeforePersistence: async () => undefined,
    substantiveScene: true,
    budget: "unknown-runtime-value",
    expectedCode: "CLOSED_AGENT_SUBSTANTIVE_SCENE_BUDGET_INVALID",
  },
];
for (const authorizationCase of sceneBudgetAuthorizationCases) {
  const projectId = await createCanonicalProject(
    `scene-budget-${authorizationCase.name}-${crypto.randomUUID()}`,
  );
  const taskId = `scene-budget-${authorizationCase.name}-task-${crypto.randomUUID()}`;
  const executionsBeforeCase = backend.executionCount;
  await assert.rejects(
    () => runStudioClosedAI({
      projectId,
      task: authorizationCase.task,
      taskId,
      input: "受限的 RPG repair provider 提示不得離開其驗證邊界。",
      targetLength: 1_600,
      browserComputePolicy: "quality-first",
      ephemeralPrompt: authorizationCase.ephemeralPrompt,
      applicationValidationBindingDigest:
        authorizationCase.applicationValidationBindingDigest,
      validateBeforePersistence: authorizationCase.validateBeforePersistence,
      generationOptions: {
        maxTokens: 1_792,
        substantiveScene: authorizationCase.substantiveScene,
        substantiveSceneBudget: authorizationCase.budget,
      },
    }),
    (error) => error?.code === authorizationCase.expectedCode,
    `${authorizationCase.name} must fail before backend execution`,
  );
  assert.equal(
    backend.executionCount,
    executionsBeforeCase,
    `${authorizationCase.name} executed a backend`,
  );
  await assertNoTaskDurability(
    os,
    projectId,
    taskId,
    `scene budget authorization case ${authorizationCase.name}`,
  );
}

const authorizedBudgetProjectId = await createCanonicalProject(
  `authorized-scene-budget-${crypto.randomUUID()}`,
);
const authorizedBudgetTaskId =
  `authorized-scene-budget-task-${crypto.randomUUID()}`;
const authorizedBudgetInput = {
  projectId: authorizedBudgetProjectId,
  task: "branch_choice",
  taskId: authorizedBudgetTaskId,
  input: "以不可持久化的修復提示產生候選，並在寫入前通過綁定驗證。",
  targetLength: 1_600,
  sourceChapterId: "chapter-authorized-scene-budget",
  sourceRevision: 1,
  browserComputePolicy: "quality-first",
  qualityMode: "fast",
  ephemeralPrompt: true,
  applicationValidationBindingDigest: "9".repeat(64),
  validateBeforePersistence: async (candidate) => {
    assert.match(candidate.content, /〈雨夜封條〉/u);
  },
  generationOptions: {
    maxTokens: 1_792,
    substantiveScene: true,
    substantiveSceneBudget: "rpg-application-minimum",
  },
};
const authorizedBudgetResult = await runStudioClosedAI(authorizedBudgetInput);
assert.match(authorizedBudgetResult.requestContractDigest, /^[a-f0-9]{64}$/u);
const executionsAfterAuthorizedBudget = backend.executionCount;
await assert.rejects(
  () => runStudioClosedAI({
    ...authorizedBudgetInput,
    generationOptions: {
      maxTokens: 1_792,
      substantiveScene: true,
    },
  }),
  (error) => error?.code === "CLOSED_AGENT_IDEMPOTENCY_CONFLICT",
  "changing the sealed scene budget under the same task id must fail closed",
);
assert.equal(
  backend.executionCount,
  executionsAfterAuthorizedBudget,
  "a scene-budget request-contract mismatch re-executed the backend",
);

const learnedReplayProjectId = await createCanonicalProject(
  `learned-replay-${crypto.randomUUID()}`,
);
await os.learning.setConsent({
  namespace: routedNamespace(learnedReplayProjectId),
  enabled: true,
});
const originalActiveConfiguration = os.learning.activeConfiguration.bind(os.learning);
let learnedPlannerStrategy = "critical-review";
os.learning.activeConfiguration = async (namespace) => {
  if (namespace.projectId !== learnedReplayProjectId) {
    return originalActiveConfiguration(namespace);
  }
  const configuration = { "planner.strategy": learnedPlannerStrategy };
  return {
    applied: true,
    versionId: `controlled-learning-version:${learnedReplayProjectId}`,
    configurationDigest: await sha256Hex(stableStringify(configuration)),
    configuration,
    reasonCode: null,
  };
};
const learnedReplayTaskId = `learned-replay-task-${crypto.randomUUID()}`;
const learnedReplayInput = {
  projectId: learnedReplayProjectId,
  task: "summary",
  taskId: learnedReplayTaskId,
  input: "以核准脈絡產生一份可驗證的繁體中文摘要。",
  browserComputePolicy: "quality-first",
  qualityMode: "balanced",
  applicationValidationBindingDigest: "2".repeat(64),
  validateBeforePersistence: async (candidate) => {
    assert.match(candidate.content, /〈雨夜封條〉/u);
  },
};
const executionsBeforeLearnedReplay = backend.executionCount;
const learnedFirst = await runStudioClosedAI(learnedReplayInput);
assert.ok(backend.executionCount > executionsBeforeLearnedReplay);
const executionsAfterLearnedFirst = backend.executionCount;
const learnedCandidate = await os.state.get(learnedFirst.candidateId);
assert.equal(
  learnedCandidate?.planningBinding?.plannerStrategy,
  "critical-review",
  "first success did not retain the authoritative learned planner strategy",
);
assert.match(
  learnedCandidate?.planningBinding?.bindingDigest ?? "",
  /^[a-f0-9]{64}$/u,
);
const learnedBindingBeforeReplay = structuredClone(learnedCandidate.planningBinding);
learnedPlannerStrategy = "standard";
const learnedReplay = await runStudioClosedAI(learnedReplayInput);
assert.equal(learnedReplay.candidateId, learnedFirst.candidateId);
assert.equal(learnedReplay.content, learnedFirst.content);
assert.equal(
  learnedReplay.requestContractDigest,
  learnedFirst.requestContractDigest,
);
assert.equal(
  backend.executionCount,
  executionsAfterLearnedFirst,
  "learned-strategy replay executed the backend again",
);
assert.equal(learnedReplay.cache.candidateHit, true);
assert.equal(learnedReplay.cache.planHit, false);
assert.deepEqual(
  (await os.state.get(learnedFirst.candidateId)).planningBinding,
  learnedBindingBeforeReplay,
  "replay replaced the first success planning binding with mutable active learning",
);
os.learning.activeConfiguration = originalActiveConfiguration;

const unauthorizedRetryProjectId = await createCanonicalProject(
  `unauthorized-local-retry-${crypto.randomUUID()}`,
);
const unauthorizedRetryBrowser = new BrowserQualityFailureBackend();
const unauthorizedRetryLocal = new FixedNormalValidationBackend(fixture.story);
os.backends = new Map([
  [unauthorizedRetryBrowser.id, unauthorizedRetryBrowser],
  [unauthorizedRetryLocal.id, unauthorizedRetryLocal],
]);
const unauthorizedRetryTaskId = `unauthorized-local-retry-task-${crypto.randomUUID()}`;
const unauthorizedRetryRequest = {
  taskId: unauthorizedRetryTaskId,
  namespace: routedNamespace(unauthorizedRetryProjectId),
  taskType: "story.summary",
  objective: "Browser-first 且未授權 escalation；失敗後 caller 不得指定 Local 重試。",
  context: [],
  complexity: "light",
  qualityMode: "balanced",
  browserComputePolicy: "browser-first",
  allowPreAuthorizedClosedEscalation: false,
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
await assert.rejects(
  () => os.execute(unauthorizedRetryRequest),
  (error) => error?.code === "BROWSER_AI_QUALITY_INSUFFICIENT",
);
assert.equal(unauthorizedRetryBrowser.executionCount, 1);
assert.equal(unauthorizedRetryLocal.executionCount, 0);
const unauthorizedFailedTask = structuredClone(
  await os.state.get(unauthorizedRetryTaskId),
);
const unauthorizedFailedLedger = await os.ledger.repository.list(
  `closed-agent:${unauthorizedRetryProjectId}:${unauthorizedRetryTaskId}`,
);
assert.equal(unauthorizedFailedTask?.state, "failed");
assert.equal(unauthorizedFailedTask?.backendId, "browser-ai");
await assert.rejects(
  () => os.execute({
    ...unauthorizedRetryRequest,
    idempotentRetryBackend: "local-ollama",
  }),
  (error) => error?.code === "CLOSED_AGENT_IDEMPOTENCY_CONFLICT",
  "caller-supplied Local retry bypassed a contract with escalation disabled",
);
assert.equal(unauthorizedRetryBrowser.executionCount, 1);
assert.equal(unauthorizedRetryLocal.executionCount, 0);
assert.deepEqual(await os.state.get(unauthorizedRetryTaskId), unauthorizedFailedTask);
assert.deepEqual(
  await os.ledger.repository.list(
    `closed-agent:${unauthorizedRetryProjectId}:${unauthorizedRetryTaskId}`,
  ),
  unauthorizedFailedLedger,
);
await assert.rejects(
  () => os.execute({
    ...unauthorizedRetryRequest,
    idempotentRetryBackend: "private-ai-hub",
  }),
  (error) => error?.code === "CLOSED_AGENT_IDEMPOTENCY_CONFLICT",
  "runtime non-Local retry hint escaped literal validation",
);
assert.equal(unauthorizedRetryBrowser.executionCount, 1);
assert.equal(unauthorizedRetryLocal.executionCount, 0);
assert.deepEqual(await os.state.get(unauthorizedRetryTaskId), unauthorizedFailedTask);
assert.deepEqual(
  await os.ledger.repository.list(
    `closed-agent:${unauthorizedRetryProjectId}:${unauthorizedRetryTaskId}`,
  ),
  unauthorizedFailedLedger,
);

const fallbackProjectId = await createCanonicalProject(
  `browser-local-replay-${crypto.randomUUID()}`,
);
const browserFailureBackend = new BrowserQualityFailureBackend();
const localFallbackBackend = new DelayedLocalFallbackBackend(fixture.story);
os.backends = new Map([
  [browserFailureBackend.id, browserFailureBackend],
  [localFallbackBackend.id, localFallbackBackend],
]);
const fallbackTaskId = `browser-local-replay-task-${crypto.randomUUID()}`;
const fallbackStableInput = {
  projectId: fallbackProjectId,
  task: "summary",
  taskId: fallbackTaskId,
  input: "先由瀏覽器品質門檻檢查；若失敗，使用已授權的本機閉端模型完成摘要。",
  browserComputePolicy: "quality-first",
  qualityMode: "balanced",
};
const fallbackFirst = await runStudioClosedAI(fallbackStableInput);
assert.equal(fallbackFirst.provider, "local-ollama");
assert.equal(browserFailureBackend.executionCount, 1);
assert.ok(localFallbackBackend.executionCount > 0);
const localFallbackExecutionsAfterFirst = localFallbackBackend.executionCount;
const fallbackStoredCandidate = await os.state.get(fallbackFirst.candidateId);
const fallbackStoredTask = await os.state.get(fallbackTaskId);
assert.equal(
  fallbackStoredTask?.requestContractDigest,
  fallbackFirst.requestContractDigest,
  "fallback task did not retain the original stable request contract",
);
assert.equal(
  fallbackStoredCandidate?.requestContractDigest,
  fallbackFirst.requestContractDigest,
  "fallback candidate sealed a rewritten routing contract",
);
const fallbackLedgerBeforeReplay = await os.ledger.repository.list(
  `closed-agent:${fallbackProjectId}:${fallbackTaskId}`,
);
const fallbackReplay = await runStudioClosedAI(fallbackStableInput);
assert.equal(fallbackReplay.candidateId, fallbackFirst.candidateId);
assert.equal(fallbackReplay.content, fallbackFirst.content);
assert.equal(
  fallbackReplay.requestContractDigest,
  fallbackFirst.requestContractDigest,
);
assert.equal(browserFailureBackend.executionCount, 1);
assert.equal(
  localFallbackBackend.executionCount,
  localFallbackExecutionsAfterFirst,
);
assert.equal(fallbackReplay.cache.candidateHit, true);
assert.deepEqual(
  await os.ledger.repository.list(`closed-agent:${fallbackProjectId}:${fallbackTaskId}`),
  fallbackLedgerBeforeReplay,
  "stable fallback replay appended ledger events",
);

const failedSentinelProjectId = await createCanonicalProject(
  `failed-sentinel-${crypto.randomUUID()}`,
);
const failedSentinelBackend = new BrowserQualityFailureBackend();
os.backends = new Map([[failedSentinelBackend.id, failedSentinelBackend]]);
const failedSentinelTaskId = `failed-sentinel-task-${crypto.randomUUID()}`;
const RAW_FAILURE_SENTINEL = "RAW_PROMPT_PROSE_SENTINEL_7d8e6f";
await assert.rejects(
  () => runStudioClosedAI({
    projectId: failedSentinelProjectId,
    task: "summary",
    taskId: failedSentinelTaskId,
    input: `${RAW_FAILURE_SENTINEL} 此原始提示與正文片段不得進入失敗 metadata 或 ledger。`,
    browserComputePolicy: "browser-first",
    qualityMode: "balanced",
    ephemeralPrompt: true,
  }),
  (error) => error?.code === "CLOSED_AI_SELECTED_BACKEND_UNKNOWN",
);
assert.equal(failedSentinelBackend.executionCount, 1);
const failedTaskMetadata = await os.state.get(failedSentinelTaskId);
const failedTaskLedger = await os.ledger.repository.list(
  `closed-agent:${failedSentinelProjectId}:${failedSentinelTaskId}`,
);
assert.equal(failedTaskMetadata?.state, "failed");
assert.match(failedTaskMetadata?.requestContractDigest ?? "", /^[a-f0-9]{64}$/u);
assert.equal(
  JSON.stringify({ failedTaskMetadata, failedTaskLedger }).includes(
    RAW_FAILURE_SENTINEL,
  ),
  false,
  "failed metadata or ledger retained raw prompt/prose",
);
assert.deepEqual(
  await os.state.list(failedSentinelProjectId, "candidate"),
  [],
);

console.log(JSON.stringify({
  status: "PASS",
  realRunStudioClosedAIPath: true,
  normalCandidateValidatedBeforePersistence: true,
  validNormalCandidatePersisted: true,
  validatorBindingMismatchBackendExecutions: 0,
  validatorBindingMismatchStateWrites: 0,
  validatorBindingMismatchLedgerWrites: 0,
  unauthorizedRetryLocalExecutions: 0,
  runtimeNonLocalRetryExecutions: 0,
  learnedPlannerReplayBackendExecutions: 0,
  browserLocalStableReplayBackendExecutions: 0,
  failedMetadataRawSentinelRetained: false,
  invalidAdultCandidateWrites: 0,
  invalidAdultCacheWrites: 0,
  invalidAdultLearningWrites: 0,
}, null, 2));

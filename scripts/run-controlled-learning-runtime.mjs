import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import {
  sha256Hex,
  stableStringify,
} from "../lib/novel-ai/closed-ai-cache/index.ts";
import {
  CONTROLLED_LEARNING_HEALTH,
  CONTROLLED_LEARNING_SCHEMA_VERSION,
  ControlledLearningOS,
  IndexedDbControlledLearningRepository,
  MemoryControlledLearningRepository,
  assertControlledLearningProposal,
  learningCacheTtl,
  learningPreferredBackend,
  learningPreferredTool,
  learningRetrievalWeight,
  learningSemanticThreshold,
  migrateControlledLearningRecord,
} from "../lib/novel-ai/controlled-learning-os/index.ts";
import {
  createClosedAgentPlan,
  selectClosedAIBackend,
} from "../lib/novel-ai/closed-agent-os/index.ts";
import {
  CAPABILITY_TRUTH_MATRIX,
} from "../lib/novel-ai/capabilities/index.ts";

const tests = [];
const results = [];

function test(name, run) {
  tests.push({ name, run });
}

function namespace(overrides = {}) {
  return {
    tenantId: "tenant-a",
    userId: "user-a",
    projectId: "project-a",
    storyId: "story-a",
    canonId: "canon-a",
    branchId: "main",
    characterId: "shared",
    agentRole: "closed-agent-os",
    modelId: "runtime-selection",
    modelDigest: "runtime-digest",
    promptProfileVersion: "prompt-v1",
    storyBibleRevision: "bible-r1",
    knowledgeScopeRevision: "knowledge-r1",
    privacyLevel: "device_only",
    ...overrides,
  };
}

function errorCode(code, detailCode) {
  return (error) =>
    error?.code === code
    && (!detailCode || error?.detailCodes?.includes(detailCode));
}

async function learningWithConsent(overrides = {}) {
  const learning = new ControlledLearningOS({
    repository: new MemoryControlledLearningRepository(),
    verifyApprovalTransaction: async () => true,
  });
  const scopedNamespace = namespace(overrides);
  await learning.setConsent({ namespace: scopedNamespace, enabled: true });
  return { learning, scopedNamespace };
}

async function experience(learning, scopedNamespace, outcome = "accepted") {
  return learning.collectExperience({
    namespace: scopedNamespace,
    outcome,
    taskType: "chapter.continue",
    featureText: "只保存雜湊的測試訊號",
    sourceApprovalId: ["approved_story_bible", "approved_canon"].includes(outcome)
      ? `approval-${outcome}`
      : null,
  });
}

test("complete eligible signal catalog is labeled without raw content", async () => {
  const { learning, scopedNamespace } = await learningWithConsent();
  const outcomes = [
    "accepted",
    "rejected",
    "edited",
    "final_choice",
    "regenerated_final_choice",
    "consistency_result",
    "character_consistency_result",
    "plot_continuity_result",
    "tool_result",
    "planner_result",
    "explicit_style_preference",
    "approved_story_bible",
    "approved_canon",
    "abandoned",
  ];
  for (const outcome of outcomes) {
    const record = await experience(learning, scopedNamespace, outcome);
    assert.equal(record.privacyFilterStatus, "passed");
    assert.equal(record.outcomeLabelingStatus, "completed");
    assert.equal(record.evaluatorEligible, true);
    assert.equal(record.formalLearningData, false);
    assert.equal(record.rawInputStored, false);
    assert.equal(record.rawOutputStored, false);
    assert.equal(record.rawChainOfThoughtStored, false);
    assert.match(record.recordDigest, /^[a-f0-9]{64}$/u);
  }
  const records = await learning.repository.list("project-a", "experience");
  assert.deepEqual(
    new Set(records.map((record) => record.outcome)),
    new Set(outcomes),
  );
  assert.equal(
    records.find((record) => record.outcome === "abandoned")?.negativeSignalOnly,
    true,
  );
  assert.equal(
    records.find((record) => record.outcome === "approved_canon")?.sourceClass,
    "approved-authority",
  );
});

test("user edits, regenerated choices and style preferences become bounded signals", async () => {
  const { learning, scopedNamespace } = await learningWithConsent();
  const edited = await learning.recordUserEdit({
    namespace: scopedNamespace,
    taskType: "chapter.continue",
    beforeText: "角色立刻離開。",
    afterText: "角色沉默片刻後才離開。",
    finalSelected: true,
  });
  const regenerated = await learning.recordRegeneratedFinalChoice({
    namespace: scopedNamespace,
    taskType: "chapter.continue",
    selectedText: "第三次生成後選定的候選內容。",
    regenerationCount: 3,
  });
  const preference = await learning.recordExplicitStylePreference({
    namespace: scopedNamespace,
    preference: "偏好節奏均衡、角色先思考再行動。",
  });
  assert.ok(edited.edited.editDistance > 0);
  assert.equal(edited.finalChoice?.outcome, "final_choice");
  assert.equal(regenerated.outcome, "regenerated_final_choice");
  assert.equal(preference.outcome, "explicit_style_preference");
  const exported = await learning.exportProject("project-a");
  assert.equal(exported.rawContentIncluded, false);
  assert.equal(
    JSON.stringify(exported).includes("角色沉默片刻後才離開"),
    false,
  );
});

test("privacy filter blocks every prohibited learning source and cross-scope input", async () => {
  const { learning, scopedNamespace } = await learningWithConsent();
  const blocked = [
    [{ unapprovedDraft: true }, "LEARNING_UNAPPROVED_DRAFT_BLOCKED"],
    [{ authorOnly: true }, "LEARNING_AUTHOR_ONLY_BLOCKED"],
    [{ privateSimulation: true }, "LEARNING_PRIVATE_SIMULATION_BLOCKED"],
    [{ rawChainOfThought: true }, "LEARNING_RAW_CHAIN_OF_THOUGHT_BLOCKED"],
    [{ sensitiveData: true }, "LEARNING_SENSITIVE_DATA_BLOCKED"],
    [{ otherUserContent: true }, "LEARNING_OTHER_USER_CONTENT_BLOCKED"],
    [{ sourceTenantId: "tenant-b" }, "LEARNING_CROSS_TENANT_BLOCKED"],
    [{ sourceUserId: "user-b" }, "LEARNING_CROSS_USER_BLOCKED"],
    [{ sourceProjectId: "project-b" }, "LEARNING_CROSS_PROJECT_BLOCKED"],
    [{ sourceStoryId: "story-b" }, "LEARNING_CROSS_STORY_BLOCKED"],
    [{ sourceCanonId: "canon-b" }, "LEARNING_CROSS_CANON_BLOCKED"],
    [{ sourceBranchId: "branch-b" }, "LEARNING_CROSS_BRANCH_BLOCKED"],
    [{ sourceCharacterId: "character-b" }, "LEARNING_CROSS_CHARACTER_BLOCKED"],
  ];
  for (const [flags, detailCode] of blocked) {
    await assert.rejects(
      () => learning.collectExperience({
        namespace: scopedNamespace,
        outcome: "accepted",
        taskType: "chapter.continue",
        featureText: "安全測試內容",
        ...flags,
      }),
      errorCode("CONTROLLED_LEARNING_PRIVACY_FILTER_BLOCKED", detailCode),
    );
  }
  await assert.rejects(
    () => learning.collectExperience({
      namespace: scopedNamespace,
      outcome: "accepted",
      taskType: "chapter.continue",
      featureText: "password: example-secret-value",
    }),
    errorCode(
      "CONTROLLED_LEARNING_PRIVACY_FILTER_BLOCKED",
      "LEARNING_CREDENTIAL_BLOCKED",
    ),
  );
  await assert.rejects(
    () => learning.collectExperience({
      namespace: scopedNamespace,
      outcome: "approved_canon",
      taskType: "chapter.continue",
      sourceApprovalId: `vcp_${"x".repeat(32)}`,
    }),
    errorCode(
      "CONTROLLED_LEARNING_PRIVACY_FILTER_BLOCKED",
      "LEARNING_CREDENTIAL_BLOCKED",
    ),
  );
  await assert.rejects(
    () => learning.collectExperience({
      namespace: scopedNamespace,
      outcome: "accepted",
      taskType: "不應成為自由文字",
    }),
    errorCode("CONTROLLED_LEARNING_TASK_TYPE_INVALID"),
  );
  const negativeOnly = await learning.collectExperience({
    namespace: scopedNamespace,
    outcome: "abandoned",
    taskType: "chapter.continue",
    featureText: "未核准草稿只保留不可逆雜湊與負面標籤",
    unapprovedDraft: true,
  });
  assert.equal(negativeOnly.negativeSignalOnly, true);
  assert.equal(negativeOnly.formalLearningData, false);
});

test("L0 and L1 proposals use strict per-type allowlists", async () => {
  const { learning, scopedNamespace } = await learningWithConsent();
  const seed = await experience(learning, scopedNamespace);
  const l0 = await learning.createCandidate({
    namespace: scopedNamespace,
    level: "L0",
    candidateType: "cache-policy",
    experienceIds: [seed.id],
    proposal: {
      "cache.semanticThreshold": 0.84,
      "cache.exactTtlMs": 120_000,
    },
  });
  const l1 = await learning.createCandidate({
    namespace: scopedNamespace,
    level: "L1",
    candidateType: "retrieval-policy",
    experienceIds: [seed.id],
    proposal: {
      "retrieval.canonWeight": 1.7,
      "retrieval.storyBibleWeight": 1.5,
      "retrieval.characterKnowledgeWeight": 1.8,
      "retrieval.relationshipEventWeight": 1.6,
    },
  });
  assert.equal(l0.level, "L0");
  assert.equal(l1.level, "L1");
  await assert.rejects(
    () => learning.createCandidate({
      namespace: scopedNamespace,
      level: "L0",
      candidateType: "cache-policy",
      experienceIds: [seed.id],
      proposal: { "model.hiddenWeight": 1 },
    }),
    errorCode("CONTROLLED_LEARNING_PROPOSAL_KEY_NOT_ALLOWED"),
  );
  assert.throws(
    () => assertControlledLearningProposal({
      level: "L2",
      candidateType: "preference",
      proposal: { pacingWeight: 0.2 },
    }),
    errorCode("CONTROLLED_LEARNING_LEVEL_NOT_AVAILABLE"),
  );
  assert.throws(
    () => assertControlledLearningProposal({
      level: "L0",
      candidateType: "tool-policy",
      proposal: { "tool.preferredId": "story.lookup" },
    }),
    errorCode("CONTROLLED_LEARNING_LEVEL_TYPE_MISMATCH"),
  );
  await learning.repository.put({ ...seed, score: 0.1 });
  await assert.rejects(
    () => learning.evaluateCandidate(l0.id, { score: 0.9 }),
    errorCode("CONTROLLED_LEARNING_CANDIDATE_INTEGRITY_FAILED"),
  );
});

test("approval is fail-closed when no signed transaction verifier is attached", async () => {
  const learning = new ControlledLearningOS({
    repository: new MemoryControlledLearningRepository(),
  });
  const scopedNamespace = namespace({ projectId: "no-verifier-project" });
  await learning.setConsent({ namespace: scopedNamespace, enabled: true });
  await assert.rejects(
    () => learning.setConsent({
      namespace: scopedNamespace,
      enabled: true,
      expiresAt: "not-a-date",
    }),
    errorCode("CONTROLLED_LEARNING_CONSENT_EXPIRY_INVALID"),
  );
  const seed = await experience(learning, scopedNamespace);
  const candidate = await learning.createEvaluatedCandidate({
    namespace: scopedNamespace,
    level: "L0",
    candidateType: "preference",
    experienceIds: [seed.id],
    proposal: { pacingWeight: 0.2 },
    evaluation: { score: 0.9, evidence: { evaluator: "test" } },
  });
  await assert.rejects(
    () => learning.approveCandidate(candidate.id, {
      approvedBy: "author",
      approvalId: "approval-no-verifier-1",
      approvalTransactionId: "transaction-no-verifier-1",
      approvalTransactionDigest: "f".repeat(64),
      humanApproved: true,
    }),
    errorCode("CONTROLLED_LEARNING_APPROVAL_VERIFIER_UNAVAILABLE"),
  );
});

test("signed approval precedes dataset, A/B, adoption and rollback", async () => {
  const { learning, scopedNamespace } = await learningWithConsent();
  const seed = await experience(learning, scopedNamespace);
  const candidate = await learning.createEvaluatedCandidate({
    namespace: scopedNamespace,
    level: "L0",
    candidateType: "cache-policy",
    experienceIds: [seed.id],
    proposal: {
      "cache.semanticThreshold": 0.84,
      "cache.exactTtlMs": 120_000,
    },
    evaluation: {
      score: 0.91,
      evidence: { evaluator: "controlled-learning-runtime-test" },
    },
  });
  await assert.rejects(
    () => learning.approveCandidate(candidate.id, {
      approvedBy: "author",
      approvalId: "approval-runtime-1",
      approvalTransactionId: "",
      approvalTransactionDigest: "",
      humanApproved: true,
    }),
    errorCode("CONTROLLED_LEARNING_APPROVAL_TRANSACTION_INVALID"),
  );
  const approved = await learning.approveCandidate(candidate.id, {
    approvedBy: "author",
    approvalId: "approval-runtime-1",
    approvalTransactionId: "approval-transaction-runtime-1",
    approvalTransactionDigest: "c".repeat(64),
    humanApproved: true,
  });
  await assert.rejects(
    () => learning.startABTest({ candidateId: approved.id }),
    errorCode("CONTROLLED_LEARNING_APPROVED_DATASET_REQUIRED"),
  );
  const dataset = await learning.createDataset(approved.id, true);
  assert.equal(
    dataset.approvalTransactionDigest,
    approved.humanApproval.approvalTransactionDigest,
  );
  const ab = await learning.startABTest({
    candidateId: approved.id,
    minimumSamples: 2,
    requiredImprovement: 0.05,
  });
  await assert.rejects(
    () => learning.recordABSample(ab.id, Number.NaN, 0.8),
    errorCode("CONTROLLED_LEARNING_AB_SCORE_INVALID"),
  );
  await learning.recordABSample(ab.id, 0.5, 0.75);
  const passed = await learning.recordABSample(ab.id, 0.6, 0.85);
  assert.equal(passed.status, "passed");
  assert.equal(passed.baselineMean, 0.55);
  assert.equal(passed.candidateMean, 0.8);
  assert.equal(passed.measuredImprovement, 0.25);
  const concurrentAdoptions = await Promise.allSettled([
    learning.adoptCandidate(approved.id, passed.id),
    learning.adoptCandidate(approved.id, passed.id),
  ]);
  assert.equal(
    concurrentAdoptions.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    concurrentAdoptions.filter((result) => result.status === "rejected").length,
    1,
  );
  const version = concurrentAdoptions.find(
    (result) => result.status === "fulfilled",
  ).value;
  assert.equal(
    (await learning.repository.list("project-a", "version")).length,
    1,
  );
  const active = await learning.activeConfiguration(scopedNamespace);
  assert.equal(active.applied, true);
  assert.equal(active.versionId, version.id);
  assert.equal(active.configuration["cache.semanticThreshold"], 0.84);
  await learning.repository.put({
    ...version,
    configuration: { "cache.semanticThreshold": 0.9 },
    configurationDigest: await sha256Hex(stableStringify({
      "cache.semanticThreshold": 0.9,
    })),
  });
  assert.equal(
    (await learning.activeConfiguration(scopedNamespace)).applied,
    false,
  );
  await learning.repository.put(version);
  assert.equal(await learning.rollbackVersion(version.id), null);
  assert.equal(
    (await learning.activeConfiguration(scopedNamespace)).applied,
    false,
  );
});

test("rejecting an approved candidate revokes its approved dataset", async () => {
  const { learning, scopedNamespace } = await learningWithConsent({
    projectId: "project-reject",
  });
  const seed = await experience(learning, scopedNamespace);
  const candidate = await learning.createEvaluatedCandidate({
    namespace: scopedNamespace,
    level: "L0",
    candidateType: "router-policy",
    experienceIds: [seed.id],
    proposal: { "router.preferredBackend": "local-ollama" },
    evaluation: { score: 0.9, evidence: { evaluator: "test" } },
  });
  const approved = await learning.approveCandidate(candidate.id, {
    approvedBy: "author",
    approvalId: "approval-reject-1",
    approvalTransactionId: "approval-transaction-reject-1",
    approvalTransactionDigest: "d".repeat(64),
    humanApproved: true,
  });
  const dataset = await learning.createDataset(approved.id, true);
  await learning.rejectCandidate(approved.id);
  assert.equal(
    (await learning.repository.get(dataset.id)).status,
    "revoked",
  );
});

test("adopted L0/L1 policy changes router, planner, cache, retrieval and tool behavior", async () => {
  const configuration = {
    "router.preferredBackend": "local-ollama",
    "planner.strategy": "critical-review",
    "cache.semanticThreshold": 0.88,
    "cache.agentPlanTtlMs": 180_000,
    "retrieval.canonWeight": 1.8,
    "retrieval.characterKnowledgeWeight": 1.9,
    "retrieval.relationshipEventWeight": 1.6,
    "retrieval.memoryWeight": 0.4,
    "tool.preferredId": "story.lookup",
  };
  const request = {
    taskId: "runtime-policy-task",
    namespace: namespace(),
    taskType: "story.summary",
    objective: "建立候選摘要",
    context: [],
    complexity: "light",
    allowedToolIds: [],
    permissionScopes: [
      "story:read",
      "candidate:write",
      "candidate:read",
      "evaluation:write",
    ],
    learningConfiguration: configuration,
  };
  const snapshots = [
    {
      id: "browser-ai",
      label: "Browser AI",
      status: "ready",
      modelId: "browser-model",
      modelDigest: "browser-digest",
      local: true,
      dataBoundary: "device",
      maximumComplexity: "light",
      capabilities: ["text"],
      supportedTaskTypes: "all",
      detailCode: "ready",
    },
    {
      id: "local-ollama",
      label: "Local Ollama",
      status: "ready",
      modelId: "local-model",
      modelDigest: "local-digest",
      local: true,
      dataBoundary: "device",
      maximumComplexity: "standard",
      capabilities: ["text"],
      supportedTaskTypes: "all",
      detailCode: "ready",
    },
    {
      id: "private-ai-hub",
      label: "Private Hub",
      status: "ready",
      modelId: "private-model",
      modelDigest: "private-digest",
      local: false,
      dataBoundary: "private-infrastructure",
      maximumComplexity: "heavy",
      capabilities: ["text"],
      supportedTaskTypes: "all",
      detailCode: "ready",
    },
  ];
  const route = selectClosedAIBackend(request, snapshots);
  assert.equal(route.backend.id, "local-ollama");
  assert.equal(route.reasonCode, "LEARNED_L0_ROUTE_LOCAL_OLLAMA");
  const plan = await createClosedAgentPlan({
    request,
    backendId: route.backend.id,
    complexity: route.complexity,
  });
  assert.equal(plan.roles.includes("critic"), true);
  assert.equal(learningPreferredBackend(configuration), "local-ollama");
  assert.equal(learningSemanticThreshold(configuration), 0.88);
  assert.equal(learningCacheTtl(configuration, "agent-plan"), 180_000);
  assert.equal(learningRetrievalWeight(configuration, "canon"), 1.8);
  assert.equal(learningRetrievalWeight(configuration, "memory"), 0.4);
  assert.equal(
    learningRetrievalWeight(
      configuration,
      "story-bible",
      "character-knowledge",
    ),
    1.9,
  );
  assert.equal(
    learningRetrievalWeight(
      configuration,
      "retrieval",
      "relationship-event",
    ),
    1.6,
  );
  assert.equal(learningPreferredTool(configuration), "story.lookup");
});

test("legacy unsigned learning records migrate but cannot become active", async () => {
  const dbName = `controlled-learning-migration-${crypto.randomUUID()}`;
  const scopedNamespace = namespace({ projectId: "legacy-project" });
  const consentId = `learning-consent:${await sha256Hex(
    stableStringify(scopedNamespace),
  )}`;
  const legacyConsent = {
    schemaVersion: "controlled-learning-os-v1",
    kind: "consent",
    id: consentId,
    projectId: scopedNamespace.projectId,
    namespace: scopedNamespace,
    enabled: true,
    allowedLevels: ["L0", "L1"],
    allowedOutcomes: ["accepted"],
    consentedAt: "2026-07-01T00:00:00.000Z",
    expiresAt: null,
    revision: 1,
  };
  const legacyVersion = {
    schemaVersion: "controlled-learning-os-v1",
    kind: "version",
    id: "learning-version:legacy-unsigned",
    projectId: scopedNamespace.projectId,
    namespace: scopedNamespace,
    version: 1,
    candidateId: "learning-candidate:legacy",
    status: "active",
    configuration: { "router.preferredBackend": "local-ollama" },
    configurationDigest: "e".repeat(64),
    parentVersionId: null,
    adoptedAt: "2026-07-01T00:00:00.000Z",
    rolledBackAt: null,
  };
  const migrated = migrateControlledLearningRecord(legacyVersion);
  assert.equal(migrated.schemaVersion, CONTROLLED_LEARNING_SCHEMA_VERSION);
  assert.equal(migrated.approvalTransactionId, "");
  assert.equal(migrated.approvalTransactionDigest, "");
  const migratedExperience = migrateControlledLearningRecord({
    schemaVersion: "controlled-learning-os-v1",
    kind: "experience",
    id: "learning-experience:legacy",
    projectId: scopedNamespace.projectId,
    namespace: scopedNamespace,
    outcome: "accepted",
    outcomeLabel: "positive",
    taskType: "chapter.continue",
    featureDigest: "a".repeat(64),
    resultDigest: null,
    editDistance: null,
    score: 0.8,
    tags: [],
    sourceApprovalId: null,
    abandonedAsNegativeOnly: false,
    rawInputStored: false,
    rawOutputStored: false,
    rawChainOfThoughtStored: false,
    createdAt: "2026-07-01T00:00:00.000Z",
  });
  assert.equal(
    migratedExperience.privacyFilterStatus,
    "legacy-review-required",
  );
  assert.equal(migratedExperience.evaluatorEligible, false);

  await new Promise((resolve, reject) => {
    const opening = indexedDB.open(dbName, 1);
    opening.onupgradeneeded = () => {
      const store = opening.result.createObjectStore("records", {
        keyPath: "id",
      });
      store.createIndex("projectId", "projectId", { unique: false });
      store.createIndex("kind", "kind", { unique: false });
    };
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction("records", "readwrite");
      transaction.objectStore("records").put(legacyConsent);
      transaction.objectStore("records").put(legacyVersion);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  });
  const repository = new IndexedDbControlledLearningRepository({ dbName });
  const learning = new ControlledLearningOS({ repository });
  const active = await learning.activeConfiguration(scopedNamespace);
  assert.equal(active.applied, false);
  assert.equal(active.reasonCode, "CONTROLLED_LEARNING_NO_ACTIVE_VERSION");
  await learning.setConsent({ namespace: scopedNamespace, enabled: true });
  const persisted = await experience(learning, scopedNamespace);
  const reopened = new IndexedDbControlledLearningRepository({ dbName });
  assert.equal((await reopened.get(persisted.id)).id, persisted.id);
});

test("L2/L3 weight mutation, private training and distillation remain fail-closed", async () => {
  const { learning } = await learningWithConsent();
  assert.throws(
    () => learning.requestAdapterWeightTraining(),
    errorCode("CONTROLLED_LEARNING_L2_WEIGHT_TRAINING_NOT_STARTED"),
  );
  assert.throws(
    () => learning.requestPrivateModelTraining(),
    errorCode("CONTROLLED_LEARNING_L3_MODEL_TRAINING_NOT_STARTED"),
  );
  assert.throws(
    () => learning.requestDistillation(),
    errorCode("CONTROLLED_LEARNING_L3_DISTILLATION_NOT_STARTED"),
  );
  assert.equal(CONTROLLED_LEARNING_HEALTH.l2L3RuntimeGateStatus, "fail_closed");
  assert.equal(CONTROLLED_LEARNING_HEALTH.modelTraining, "not_started");
  assert.equal(CONTROLLED_LEARNING_HEALTH.distillation, "not_started");
  const dashboard = await learning.dashboard("project-a");
  assert.equal(dashboard.l0Status, "ready");
  assert.equal(dashboard.l1Status, "ready");
  assert.equal(dashboard.l2Status, "contract_only");
  assert.equal(dashboard.l3Status, "not_started");
  for (const id of [
    "learning.controlledOS",
    "learning.signalPipeline",
    "learning.runtimePolicyApplication",
    "learning.signedApprovalTransaction",
    "learning.l2l3Gate",
  ]) {
    assert.equal(
      CAPABILITY_TRUTH_MATRIX.find((record) => record.id === id)?.status,
      "verified",
    );
  }
  assert.equal(
    CAPABILITY_TRUTH_MATRIX.find((record) => record.id === "modelTraining")
      ?.status,
    "not_started",
  );
  assert.equal(
    CAPABILITY_TRUTH_MATRIX.find((record) => record.id === "distillation")
      ?.status,
    "not_started",
  );
});

for (const item of tests) {
  const started = performance.now();
  try {
    await item.run();
    results.push({
      name: item.name,
      status: "PASS",
      elapsedMs: Math.round(performance.now() - started),
    });
  } catch (error) {
    results.push({
      name: item.name,
      status: "FAIL",
      elapsedMs: Math.round(performance.now() - started),
      error: error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error),
    });
  }
}

for (const item of results) {
  if (item.status === "FAIL") process.stderr.write(`${item.name}: ${item.error}\n`);
}

const report = {
  suite: "Controlled Self-Learning v2 runtime and governance",
  runAt: new Date().toISOString(),
  pass: results.filter((result) => result.status === "PASS").length,
  fail: results.filter((result) => result.status === "FAIL").length,
  schemaVersion: CONTROLLED_LEARNING_SCHEMA_VERSION,
  pipeline: [
    "experience-collector",
    "privacy-filter",
    "outcome-labeling",
    "evaluator",
    "learning-candidate",
    "signed-human-approval",
    "versioned-learning-store",
    "ab-evaluation",
    "adopt-or-rollback",
  ],
  l0: "ready",
  l1: "ready",
  l2: "contract_only_not_started",
  modelTraining: "not_started",
  distillation: "not_started",
  results,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.fail) process.exitCode = 1;

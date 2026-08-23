import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { IDBKeyRange as FakeIDBKeyRange, indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { makeRecord, optionalValue } from "../lib/novel-ai/domain/index.ts";
import { buildProjectBundle, createDraft } from "../lib/novel-ai/domain/creation.ts";
import { resolveRpgChoice } from "../lib/novel-ai/game/progression/rpg-progression.ts";
import { ConversationRepositoryService } from "../lib/novel-ai/conversation/repository.ts";
import { CONVERSATION_LOCAL_TOOL_IDS } from "../lib/novel-ai/conversation/tool-registry.ts";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/memory/memory-repository.ts";
import {
  buildApprovedLearningContext,
  coordinateUnifiedClosedAI,
  getBaselineViralDramaCurriculum,
  ingestLearningSource,
  ingestSharedLearningSnapshot,
  IndexedDbSovereignLearningRepository,
  MemorySovereignLearningRepository,
  normalizePublicResearchUrl,
  normalizeSharedLearningRules,
  sha256Hex,
  stableStringify,
  VERIFIED_STORY_TEACHER_VERSION,
} from "../lib/novel-ai/sovereign-learning/index.ts";
import {
  approveRpgChatTurn,
  buildDeterministicRpgTurnStory,
  buildRpgRuleChoicePlan,
  buildRpgTurnCausalContract,
  loadLearningAwareRpgChatSnapshot,
  loadRpgChatSnapshot,
  RPG_SHARED_LEARNING_SYNC_WAIT_MS,
} from "../lib/novel-ai/web/rpg-chat-turn.ts";
import { initializeMingtanPreset } from "../lib/novel-ai/web/rpg-preset.ts";

assert.equal(
  normalizePublicResearchUrl("youtube.com/watch?v=public-example#comments"),
  "https://youtube.com/watch?v=public-example",
  "pasted public URLs without a scheme must be normalized immediately",
);
assert.throws(() => normalizePublicResearchUrl("http://example.com/story"), /HTTPS/u);
assert.throws(() => normalizePublicResearchUrl("https://127.0.0.1/story"), /公開網際網路/u);
assert.throws(() => normalizePublicResearchUrl("https://example.com/story?access_token=secret"), /憑證/u);

const story = `
主角原本只想守住家人的小店，卻在開門時收到一只無法偽造的舊印章。印章證明失蹤多年的合夥人仍在暗中控制供應商，也讓主角必須在日落前選擇公開帳本或保住唯一的合作關係。
他先找可信的夥伴核對帳本，交換條件是承諾日後公開自己的錯誤。對手發現查核後切斷貨源，迫使兩人利用印章進入倉庫；這個道具因此同時具有通行、證明與爭奪功能。
夥伴隱瞞自己曾替對手工作，直到倉庫裡的日期證據揭露真相。主角可以揭穿她、繼續合作或故意讓對手以為兩人決裂，每個選擇都改變信任、資源與下一步風險。
最後主角用先前留下的副本在眾人面前完成反證，但也因公開帳本失去短期收入。真相回收了印章與日期線索，代價則寫回店舖、關係與聲望；結尾停在合夥人親自出現並要求下一次交換的門檻。
`.repeat(3);

const manualRepository = new MemorySovereignLearningRepository();
const manual = await ingestLearningSource(manualRepository, {
  projectId: "teacher-upgraded-knowledge-layer",
  title: "使用者貼上文字",
  author: "使用者提供",
  sourceKind: "article",
  rightsBasis: "user_supplied_abstract_research",
  rightsEvidence: "user-initiated-transient-abstract-analysis",
  userConfirmedRights: true,
  content: story,
});
const teacherRules = manual.rules.filter((rule) => rule.extractorKind === "local_closed_ai");
assert.ok(teacherRules.length >= 12, "the original closed-AI knowledge layer must run the causal teacher automatically");
assert.ok(teacherRules.some((rule) => rule.tags.includes("關鍵道具")));
assert.ok(teacherRules.some((rule) => rule.tags.includes("爽點回收")));
assert.ok(teacherRules.some((rule) => rule.tags.includes("集尾鉤子")));
assert.ok(teacherRules.every((rule) => rule.longestSourceMatch < 18));
assert.ok(teacherRules.every((rule) => rule.sourceOverlapScore < 0.14));
assert.equal(manual.source.rawContentRetained, false);
assert.equal(JSON.stringify(manual).includes("失蹤多年的合夥人"), false);

const curriculum = await getBaselineViralDramaCurriculum();
const normalized = await normalizeSharedLearningRules({
  rules: curriculum,
  teacherVersion: VERIFIED_STORY_TEACHER_VERSION,
  observationCount: 7,
});
assert.ok(normalized.rules.length >= 12);
const snapshotFor = async (rules) => ({
  schemaVersion: "shared-abstract-learning-v1",
  libraryDigest: await sha256Hex(stableStringify(rules.map((rule) => rule.ruleHash))),
  generatedAt: "2026-08-22T00:00:00.000Z",
  rules,
  selection: {
    requestedLimit: 24,
    returnedCount: rules.length,
    databaseFetchLimit: 48,
    entireLibraryScanned: false,
    cacheTtlSeconds: 60,
  },
  persistenceStatus: "ready",
  privacy: {
    rawStoryIncluded: false,
    sourceSentencesIncluded: false,
    namedEntitiesIncluded: false,
    abstractRulesOnly: true,
  },
});

const sharedRepository = new MemorySovereignLearningRepository();
const firstShared = await ingestSharedLearningSnapshot(sharedRepository, {
  projectId: "shared-top-k-project",
  snapshot: await snapshotFor(normalized.rules),
});
assert.equal(firstShared.status, "synced");
assert.equal(firstShared.rules.every((rule) => rule.status === "approved"), true);
assert.ok(firstShared.rules.length <= 24);

const duplicateSharedRule = normalized.rules[0];
const learnedRuleTemplate = firstShared.rules.find(
  (rule) => rule.parameters.sharedRuleHash === duplicateSharedRule.ruleHash,
);
assert.ok(learnedRuleTemplate);
const similarityProjectId = "shared-governance-similarity-project";
const makeSimilarityRule = ({
  id,
  projectId = similarityProjectId,
  status = "candidate",
  dimension = learnedRuleTemplate.dimension,
  statement = learnedRuleTemplate.statement,
  confidence = 0.2,
}) => ({
  ...learnedRuleTemplate,
  id,
  projectId,
  sourceId: `local-source:${id}`,
  status,
  dimension,
  statement,
  confidence,
  parameters: { ...learnedRuleTemplate.parameters, sharedRuleHash: `local:${id}` },
  approvedAt: status === "approved" ? learnedRuleTemplate.approvedAt : null,
  rejectedAt: status === "rejected" ? learnedRuleTemplate.updatedAt : null,
  revokedAt: status === "revoked" ? learnedRuleTemplate.updatedAt : null,
  revision: 1,
});
const localDuplicateCandidate = makeSimilarityRule({
  id: "local-duplicate-candidate",
  confidence: 1,
});
const memorySimilarityRepository = new MemorySovereignLearningRepository();
await memorySimilarityRepository.commit({
  rules: [
    localDuplicateCandidate,
    ...Array.from({ length: 40 }, (_, index) => makeSimilarityRule({
      id: `memory-bounded-candidate:${index}`,
      statement: `不同的治理候選規則 ${index}`,
      confidence: 0.1,
    })),
    makeSimilarityRule({
      id: "memory-wrong-dimension",
      status: "approved",
      dimension: learnedRuleTemplate.dimension === "other" ? "tone" : "other",
      confidence: 1,
    }),
    makeSimilarityRule({
      id: "memory-rejected-duplicate",
      status: "rejected",
      confidence: 1,
    }),
  ],
});
const memoryInfiniteLimit = await memorySimilarityRepository.queryRuleSimilarityCandidates(
  similarityProjectId,
  learnedRuleTemplate.family,
  learnedRuleTemplate.dimension,
  ["candidate", "approved", "quarantined"],
  Number.POSITIVE_INFINITY,
);
assert.deepEqual(memoryInfiniteLimit.map((rule) => rule.id), [localDuplicateCandidate.id]);
const memoryNanLimit = await memorySimilarityRepository.queryRuleSimilarityCandidates(
  similarityProjectId,
  learnedRuleTemplate.family,
  learnedRuleTemplate.dimension,
  ["candidate"],
  Number.NaN,
);
assert.equal(memoryNanLimit.length, 1, "NaN must fall back to a finite one-row cursor bound");
const memoryMaximumLimit = await memorySimilarityRepository.queryRuleSimilarityCandidates(
  similarityProjectId,
  learnedRuleTemplate.family,
  learnedRuleTemplate.dimension,
  ["candidate"],
  10_000,
);
assert.equal(memoryMaximumLimit.length, 32, "governance similarity lookup must remain bounded");
const deduplicatedShared = await ingestSharedLearningSnapshot(memorySimilarityRepository, {
  projectId: similarityProjectId,
  snapshot: await snapshotFor([duplicateSharedRule]),
});
assert.equal(deduplicatedShared.rules.length, 0, "candidate governance rules must prevent a shared duplicate");

const governanceResyncProjectId = "shared-governance-resync-project";
const governanceResyncRepository = new MemorySovereignLearningRepository();
const governanceSnapshot = await snapshotFor([duplicateSharedRule]);
const initialGovernanceSync = await ingestSharedLearningSnapshot(governanceResyncRepository, {
  projectId: governanceResyncProjectId,
  snapshot: governanceSnapshot,
});
assert.equal(initialGovernanceSync.status, "synced");
assert.equal(initialGovernanceSync.rules.length, 1);
const laterLocalDuplicate = makeSimilarityRule({
  id: "later-local-duplicate",
  projectId: governanceResyncProjectId,
  confidence: 1,
});
await governanceResyncRepository.commit({ rules: [laterLocalDuplicate] });
const suppressedAfterLocalGovernance = await ingestSharedLearningSnapshot(governanceResyncRepository, {
  projectId: governanceResyncProjectId,
  snapshot: governanceSnapshot,
});
assert.equal(suppressedAfterLocalGovernance.status, "synced");
assert.equal(suppressedAfterLocalGovernance.rules.length, 0);
assert.equal(suppressedAfterLocalGovernance.removedRuleCount, 1);
assert.equal(
  (await governanceResyncRepository.listRulesBySource(initialGovernanceSync.source.id)).length,
  0,
  "a later local governance rule must remove the already-synced shared duplicate",
);
await governanceResyncRepository.commit({ remove: { rules: [laterLocalDuplicate.id] } });
const restoredAfterLocalGovernanceRemoval = await ingestSharedLearningSnapshot(governanceResyncRepository, {
  projectId: governanceResyncProjectId,
  snapshot: governanceSnapshot,
});
assert.equal(restoredAfterLocalGovernanceRemoval.status, "synced");
assert.equal(restoredAfterLocalGovernanceRemoval.rules.length, 1);
assert.equal(
  restoredAfterLocalGovernanceRemoval.rules[0].parameters.sharedRuleHash,
  duplicateSharedRule.ruleHash,
  "removing the local governance rule must restore the eligible shared rule",
);
const unchangedAfterGovernanceSettles = await ingestSharedLearningSnapshot(governanceResyncRepository, {
  projectId: governanceResyncProjectId,
  snapshot: governanceSnapshot,
});
assert.equal(unchangedAfterGovernanceSettles.status, "unchanged");
assert.equal(unchangedAfterGovernanceSettles.rules.length, 1);

const previousIndexedDb = globalThis.indexedDB;
const previousIdbKeyRange = globalThis.IDBKeyRange;
globalThis.indexedDB = fakeIndexedDB;
globalThis.IDBKeyRange = FakeIDBKeyRange;
try {
  const indexedSimilarityRepository = new IndexedDbSovereignLearningRepository();
  const indexedProjectId = "indexed-shared-governance-similarity-project";
  await indexedSimilarityRepository.commit({
    rules: Array.from({ length: 40 }, (_, index) => makeSimilarityRule({
      id: `indexed-bounded-candidate:${index}`,
      projectId: indexedProjectId,
      confidence: 1 - (index / 100),
    })),
  });
  const indexedInfiniteLimit = await indexedSimilarityRepository.queryRuleSimilarityCandidates(
    indexedProjectId,
    learnedRuleTemplate.family,
    learnedRuleTemplate.dimension,
    ["candidate"],
    Number.NEGATIVE_INFINITY,
  );
  assert.equal(indexedInfiniteLimit.length, 1, "Infinity must not create an unbounded IndexedDB cursor");
  const indexedNanLimit = await indexedSimilarityRepository.queryRuleSimilarityCandidates(
    indexedProjectId,
    learnedRuleTemplate.family,
    learnedRuleTemplate.dimension,
    ["candidate"],
    Number.NaN,
  );
  assert.equal(indexedNanLimit.length, 1, "NaN must not create an unbounded IndexedDB cursor");
  const indexedMaximumLimit = await indexedSimilarityRepository.queryRuleSimilarityCandidates(
    indexedProjectId,
    learnedRuleTemplate.family,
    learnedRuleTemplate.dimension,
    ["candidate"],
    10_000,
  );
  assert.equal(indexedMaximumLimit.length, 32, "IndexedDB governance lookup must cap every status cursor");
} finally {
  if (previousIndexedDb === undefined) Reflect.deleteProperty(globalThis, "indexedDB");
  else globalThis.indexedDB = previousIndexedDb;
  if (previousIdbKeyRange === undefined) Reflect.deleteProperty(globalThis, "IDBKeyRange");
  else globalThis.IDBKeyRange = previousIdbKeyRange;
}

const reducedRules = normalized.rules.slice(0, 8);
const reducedShared = await ingestSharedLearningSnapshot(sharedRepository, {
  projectId: "shared-top-k-project",
  snapshot: await snapshotFor(reducedRules),
});
assert.equal(reducedShared.status, "synced");
assert.equal(reducedShared.rules.length, 8);
assert.equal((await sharedRepository.listRules("shared-top-k-project")).length, 8, "sync replaces the prior Top-K instead of growing without bound");

const approvedContext = await buildApprovedLearningContext({
  repository: sharedRepository,
  projectId: "shared-top-k-project",
  taskType: "three_choices",
  maximumRules: 8,
});
assert.equal(approvedContext.rules.length, 8);
assert.equal(approvedContext.instructions.length, 8);

const legacyProjectId = "legacy-learning-repository-project";
const legacyRuleTemplate = approvedContext.rules[0];
const legacySourceTemplate = await sharedRepository.getSource(legacyRuleTemplate.sourceId);
assert.ok(legacySourceTemplate);
const legacySource = {
  ...legacySourceTemplate,
  projectId: legacyProjectId,
};
const noisyLegacyRules = Array.from({ length: 40 }, (_, index) => ({
  ...legacyRuleTemplate,
  id: `legacy-learning-rule:${String(index).padStart(2, "0")}`,
  projectId: legacyProjectId,
  sourceId: legacySource.id,
  confidence: 1 - (index / 100),
  revision: index + 1,
}));
let legacyFamilyQueryCount = 0;
const legacyQueryContext = await buildApprovedLearningContext({
  repository: {
    getProfile: async () => null,
    listSources: async (projectId) => projectId === legacyProjectId ? [legacySource] : [],
    queryApprovedRules: async (projectId, families, limitPerFamily) => {
      legacyFamilyQueryCount += 1;
      assert.equal(projectId, legacyProjectId);
      assert.ok(families.includes(legacyRuleTemplate.family));
      assert.equal(limitPerFamily, 32);
      return noisyLegacyRules;
    },
    listRules: async () => {
      throw new Error("LEGACY_QUERY_FALLBACK_MUST_NOT_SCAN_LIST_RULES");
    },
  },
  projectId: legacyProjectId,
  taskType: "three_choices",
  maximumRules: 8,
});
assert.equal(legacyFamilyQueryCount, 1);
assert.deepEqual(
  legacyQueryContext.selectedRuleIds,
  ["legacy-learning-rule:00", "legacy-learning-rule:01"],
  "legacy family-query repositories must still be bounded to two candidates per dimension",
);

let legacyListRuleCount = 0;
let legacyListSourceCount = 0;
const legacyListContext = await buildApprovedLearningContext({
  repository: {
    getProfile: async () => null,
    listRules: async (projectId) => {
      legacyListRuleCount += 1;
      assert.equal(projectId, legacyProjectId);
      return [
        ...noisyLegacyRules,
        { ...noisyLegacyRules[0], id: "legacy-cross-project", projectId: "another-project" },
        { ...noisyLegacyRules[0], id: "legacy-unapproved", status: "candidate" },
      ];
    },
    listSources: async (projectId) => {
      legacyListSourceCount += 1;
      return projectId === legacyProjectId ? [legacySource] : [];
    },
  },
  projectId: legacyProjectId,
  taskType: "three_choices",
  maximumRules: 8,
});
assert.equal(legacyListRuleCount, 1);
assert.equal(legacyListSourceCount, 1);
assert.deepEqual(
  legacyListContext.selectedRuleIds,
  ["legacy-learning-rule:00", "legacy-learning-rule:01"],
  "list-only repositories must exclude cross-project/unapproved rows and remain dimension-bounded",
);

const choicePlan = await buildRpgRuleChoicePlan({
  snapshot: {
    chapter: { id: "chapter-1", revision: 3 },
    storyState: { revision: 5 },
    directorContext: { conflict: "目前局勢" },
    causalKnowledge: {
      snapshotVersion: approvedContext.snapshotVersion,
      snapshotDigest: approvedContext.snapshotDigest,
      selectedRuleIds: approvedContext.selectedRuleIds,
      instructions: approvedContext.instructions,
      causalSignals: approvedContext.causalSignals,
      maximumRules: 8,
      entireLibraryScanned: false,
    },
    baseChoices: [
      { key: "A", title: "先查明線索", approach: "steady", disabledReason: null },
      { key: "B", title: "交換現有籌碼", approach: "resource", disabledReason: null },
      { key: "C", title: "承擔風險突破", approach: "bold", disabledReason: null },
    ],
  },
});
assert.deepEqual(choicePlan.choices.map((choice) => choice.key), ["A", "B", "C"]);
assert.equal(new Set(choicePlan.choices.map((choice) => choice.title)).size, 3);
assert.equal(choicePlan.actualExecutor, "deterministic-rule-fallback");
assert.equal(choicePlan.executionReceipt.choiceCount, 3);
assert.equal(choicePlan.executionReceipt.causalKnowledgeRuleCount, 8);
assert.equal(choicePlan.executionReceipt.causalKnowledgeSnapshotVersion, approvedContext.snapshotVersion);
assert.equal(choicePlan.executionReceipt.causalKnowledgeSnapshotDigest, approvedContext.snapshotDigest);
assert.deepEqual(choicePlan.executionReceipt.causalKnowledgeRuleIds, approvedContext.selectedRuleIds);

const legacySignalTemplate = approvedContext.causalSignals[0];
const legacySignals = Array.from({ length: 12 }, (_, index) => ({
  ...legacySignalTemplate,
  ruleId: `legacy-rule-${index + 1}`,
}));
const legacySelectedRuleIds = [
  ...legacySignals.map((signal) => signal.ruleId),
  legacySignals[0].ruleId,
  "unknown-rule",
];
const boundedLegacyPlan = await buildRpgRuleChoicePlan({
  snapshot: {
    chapter: { id: "legacy-chapter", revision: 1 },
    storyState: { revision: 1 },
    directorContext: { conflict: "舊存檔的規則快照" },
    causalKnowledge: {
      snapshotVersion: approvedContext.snapshotVersion,
      snapshotDigest: approvedContext.snapshotDigest,
      selectedRuleIds: legacySelectedRuleIds,
      instructions: Array.from({ length: 12 }, (_, index) => `舊規則指令 ${index + 1}`),
      causalSignals: legacySignals,
      maximumRules: 8,
      entireLibraryScanned: false,
    },
    baseChoices: [
      { key: "A", title: "盤點既有證據", approach: "steady", disabledReason: null },
      { key: "B", title: "調度手邊資源", approach: "resource", disabledReason: null },
      { key: "C", title: "突破目前封鎖", approach: "bold", disabledReason: null },
    ],
  },
});
assert.equal(boundedLegacyPlan.executionReceipt.causalKnowledgeRuleCount, 8);
assert.equal(new Set(boundedLegacyPlan.executionReceipt.causalKnowledgeRuleIds).size, 8);
assert.deepEqual(
  boundedLegacyPlan.executionReceipt.causalKnowledgeRuleIds,
  legacySignals.slice(0, 8).map((signal) => signal.ruleId),
  "legacy receipts and downstream contracts must share the same bounded Top-K IDs",
);

class RuntimeGuardLearningRepository extends MemorySovereignLearningRepository {
  runtime = false;
  queryCalls = [];
  listRulesCalls = 0;
  broadQueryCalls = 0;

  async listRules(...args) {
    if (this.runtime) {
      this.listRulesCalls += 1;
      throw new Error("RUNTIME_FULL_SCAN_FORBIDDEN");
    }
    return super.listRules(...args);
  }

  async queryApprovedRules(...args) {
    if (this.runtime) {
      this.broadQueryCalls += 1;
      throw new Error("RUNTIME_BROAD_QUERY_FORBIDDEN");
    }
    return super.queryApprovedRules(...args);
  }

  async queryApprovedRulesByDimension(projectId, families, limit) {
    if (this.runtime) this.queryCalls.push({ projectId, families, limit });
    return super.queryApprovedRulesByDimension(projectId, families, limit);
  }
}

const novelRepository = new MemoryNovelRepository();
const draft = createDraft("quick");
draft.title = "核准按鈕回歸測試";
draft.coreIdea = optionalValue("主角必須在對手逼近前守住傳承並查清失蹤線索。", "user_defined");
draft.protagonist = optionalValue("明檀", "user_defined");
const bundle = buildProjectBundle(draft);
await novelRepository.createProject(bundle, "create:approval-regression");
const chapter = await novelRepository.put("chapters", {
  ...makeRecord(bundle.project.id),
  title: "危機逼近",
  order: 1,
  content: "明檀站在殘破山門前，遠處追兵已經逼近。她必須先守住同伴，再查清失蹤者留下的印記。",
  summary: "追兵逼近山門。",
  status: "draft",
});
await novelRepository.put("projects", {
  ...bundle.project,
  activeChapterId: chapter.id,
}, bundle.project.revision);
await initializeMingtanPreset(novelRepository, bundle.project.id, { initialRealmLevel: 1 });
const approvalSnapshot = await loadRpgChatSnapshot(novelRepository, bundle.project.id);
const runtimeLearningRepository = new RuntimeGuardLearningRepository();
await ingestSharedLearningSnapshot(runtimeLearningRepository, {
  projectId: bundle.project.id,
  snapshot: await snapshotFor(normalized.rules),
});
runtimeLearningRepository.runtime = true;
const previousFetch = globalThis.fetch;
let runtimeFetchCalls = 0;
globalThis.fetch = async () => {
  runtimeFetchCalls += 1;
  throw new Error("RUNTIME_NETWORK_FORBIDDEN");
};
try {
  const learnedSnapshot = await loadRpgChatSnapshot(
    novelRepository,
    bundle.project.id,
    undefined,
    runtimeLearningRepository,
  );
  assert.ok(learnedSnapshot.causalKnowledge.selectedRuleIds.length > 0);
  assert.ok(learnedSnapshot.causalKnowledge.selectedRuleIds.length <= 8);
  assert.equal(
    learnedSnapshot.causalKnowledge.causalSignals.length,
    learnedSnapshot.causalKnowledge.selectedRuleIds.length,
  );
  assert.equal(learnedSnapshot.causalKnowledge.maximumRules, 8);
  assert.equal(learnedSnapshot.causalKnowledge.entireLibraryScanned, false);
  assert.match(learnedSnapshot.causalKnowledge.snapshotDigest, /^[a-f0-9]{64}$/u);
  assert.notEqual(
    learnedSnapshot.causalKnowledge.snapshotDigest,
    approvalSnapshot.causalKnowledge.snapshotDigest,
  );
  const safeSignalKeys = [
    "constraint", "dimension", "evaluate", "family", "operation", "ruleId", "statement",
  ];
  for (const signal of learnedSnapshot.causalKnowledge.causalSignals) {
    assert.deepEqual(Object.keys(signal).sort(), safeSignalKeys);
  }
  const serializedKnowledge = JSON.stringify(learnedSnapshot.causalKnowledge);
  assert.doesNotMatch(serializedKnowledge, /sourceId|sourceReference|rawContent|chainOfThought|reasoningTrace/u);

  const emptyContract = buildRpgTurnCausalContract({
    snapshot: approvalSnapshot,
    choice: approvalSnapshot.baseChoices[0],
  });
  const learnedContract = buildRpgTurnCausalContract({
    snapshot: learnedSnapshot,
    choice: learnedSnapshot.baseChoices[0],
  });
  assert.notEqual(learnedContract.contextSignature, emptyContract.contextSignature);
  assert.notEqual(
    stableStringify(learnedContract.inferenceDimensions),
    stableStringify(emptyContract.inferenceDimensions),
  );
  assert.ok(
    Object.values(learnedContract.inferenceDimensions).some((value) => value.includes("核准規則校準")),
    "approved abstract rules must change the ten-dimension causal contract semantically",
  );
  assert.deepEqual(
    learnedContract.causalKnowledge.appliedRuleIds,
    learnedSnapshot.causalKnowledge.selectedRuleIds,
  );
  assert.notDeepEqual(
    learnedSnapshot.baseChoices.map((choice) => choice.encounter.signature),
    approvalSnapshot.baseChoices.map((choice) => choice.encounter.signature),
  );
  assert.ok(
    learnedSnapshot.baseChoices.every((choice) => choice.encounter.signature.includes("learned-")),
  );
  const learnedPlan = await buildRpgRuleChoicePlan({ snapshot: learnedSnapshot });
  assert.equal(
    learnedPlan.executionReceipt.causalKnowledgeSnapshotVersion,
    learnedSnapshot.causalKnowledge.snapshotVersion,
  );
  assert.equal(
    learnedPlan.executionReceipt.causalKnowledgeSnapshotDigest,
    learnedSnapshot.causalKnowledge.snapshotDigest,
  );
  assert.deepEqual(
    learnedPlan.executionReceipt.causalKnowledgeRuleIds,
    learnedSnapshot.causalKnowledge.selectedRuleIds,
  );

  const rejectedStartedAt = performance.now();
  const rejectedSyncSnapshot = await loadLearningAwareRpgChatSnapshot({
    repository: novelRepository,
    projectId: bundle.project.id,
    learningRepository: runtimeLearningRepository,
    ensureSharedLearningReady: async () => { throw new Error("SYNC_FAILED"); },
  });
  const rejectedPlan = await buildRpgRuleChoicePlan({ snapshot: rejectedSyncSnapshot });
  assert.ok(performance.now() - rejectedStartedAt < RPG_SHARED_LEARNING_SYNC_WAIT_MS);
  assert.deepEqual(rejectedPlan.choices.map((choice) => choice.key), ["A", "B", "C"]);
  assert.equal(rejectedPlan.actualExecutor, "deterministic-rule-fallback");

  const stalledStartedAt = performance.now();
  const stalledSyncSnapshot = await loadLearningAwareRpgChatSnapshot({
    repository: novelRepository,
    projectId: bundle.project.id,
    learningRepository: runtimeLearningRepository,
    ensureSharedLearningReady: () => new Promise(() => undefined),
  });
  const stalledPlan = await buildRpgRuleChoicePlan({ snapshot: stalledSyncSnapshot });
  const stalledElapsedMs = performance.now() - stalledStartedAt;
  assert.ok(stalledElapsedMs < RPG_SHARED_LEARNING_SYNC_WAIT_MS + 300);
  assert.deepEqual(stalledPlan.choices.map((choice) => choice.key), ["A", "B", "C"]);
  assert.equal(stalledPlan.canonicalMutationCount, 0);
  assert.equal(stalledPlan.externalRequest, false);

  assert.ok(runtimeLearningRepository.queryCalls.length >= 3);
  assert.ok(runtimeLearningRepository.queryCalls.every((call) => call.limit === 2));
  assert.equal(runtimeLearningRepository.listRulesCalls, 0);
  assert.equal(runtimeLearningRepository.broadQueryCalls, 0);
  assert.equal(runtimeFetchCalls, 0);
} finally {
  if (previousFetch === undefined) Reflect.deleteProperty(globalThis, "fetch");
  else globalThis.fetch = previousFetch;
}
const approvalChoice = approvalSnapshot.baseChoices.find((choice) => !choice.disabledReason);
assert.ok(approvalChoice);
const approvalResolution = resolveRpgChoice(approvalChoice, {
  seed: "approval-click-regression",
  revision: approvalSnapshot.storyState.revision,
  recentEncounterSignatures: approvalSnapshot.progression.procedural.recentEncounterSignatures,
  turn: approvalSnapshot.progression.turn,
  storyState: approvalSnapshot.storyState,
});
const approvalStory = buildDeterministicRpgTurnStory({
  snapshot: approvalSnapshot,
  choice: approvalChoice,
  resolution: approvalResolution,
});
const approvalDigest = await sha256Hex(approvalStory.normalize("NFKC"));
const deterministicCandidate = {
  schemaVersion: "rpg-chat-turn-v1",
  taskId: `rules-rpg-turn:${approvalDigest.slice(0, 24)}`,
  candidateId: `rules-rpg-turn:${approvalDigest.slice(0, 24)}`,
  candidateDigest: approvalDigest,
  model: "closed-causal-teacher-rules",
  modelDigest: await sha256Hex("closed-causal-teacher-rules"),
  actualExecutor: "deterministic-rule-fallback",
  executionReceipt: { fallback: true },
  contextDigest: await sha256Hex(stableStringify(approvalSnapshot.directorContext)),
  sourceChapterId: approvalSnapshot.chapter.id,
  sourceRevision: approvalSnapshot.chapter.revision,
  choice: approvalChoice,
  resolution: approvalResolution,
  story: approvalStory,
  outcomeLines: approvalChoice.impactLabels,
  canonicalMutationCount: 0,
  dataLeftDevice: false,
  externalRequest: false,
};
const conversation = new ConversationRepositoryService(novelRepository);
const approvalSession = await conversation.createSession({
  projectId: bundle.project.id,
  title: "規則後備核准回歸",
  activeChapterId: approvalSnapshot.chapter.id,
});
const approvalMessage = await conversation.appendMessage({
  projectId: bundle.project.id,
  sessionId: approvalSession.id,
  role: "assistant",
  content: approvalStory,
  status: "completed",
  candidateIds: [deterministicCandidate.candidateId],
});
await conversation.saveToolInvocation({
  projectId: bundle.project.id,
  sessionId: approvalSession.id,
  messageId: approvalMessage.id,
  taskId: deterministicCandidate.taskId,
  toolId: CONVERSATION_LOCAL_TOOL_IDS.rpgTurn,
  taskType: "chapter.continue",
  inputDigest: await sha256Hex("deterministic-rpg-input"),
  contextDigest: deterministicCandidate.contextDigest,
  status: "completed",
  actualExecutor: deterministicCandidate.actualExecutor,
  modelId: deterministicCandidate.model,
  modelDigest: deterministicCandidate.modelDigest,
  executionReceipt: {
    receiptId: `rules-receipt:${approvalDigest.slice(0, 24)}`,
    modelId: deterministicCandidate.model,
    modelDigest: deterministicCandidate.modelDigest,
    providerRunId: deterministicCandidate.taskId,
    contextDigest: deterministicCandidate.contextDigest,
    outputDigest: deterministicCandidate.candidateDigest,
    externalRequest: false,
    dataLeftDevice: false,
    latencyMs: 0,
  },
  externalRequest: false,
  dataLeftDevice: false,
  canonicalMutationCount: 0,
});
const approvalArtifact = await conversation.saveArtifact({
  projectId: bundle.project.id,
  sessionId: approvalSession.id,
  sourceMessageId: approvalMessage.id,
  artifactType: "rpg",
  targetStore: "chapters",
  targetRecordId: approvalSnapshot.chapter.id,
  sourceRevision: approvalSnapshot.chapter.revision,
  candidateContent: JSON.stringify({
    schemaVersion: "conversation-rpg-candidate-v1",
    candidate: deterministicCandidate,
  }),
});
const currentApprovalMessage = await novelRepository.get(
  "conversationMessages",
  approvalMessage.id,
);
const currentApprovalSession = await novelRepository.get(
  "conversationSessions",
  approvalSession.id,
);
assert.ok(currentApprovalMessage);
assert.ok(currentApprovalSession);
const approval = await approveRpgChatTurn({
  repository: novelRepository,
  snapshot: approvalSnapshot,
  candidate: deterministicCandidate,
  conversationApproval: {
    operationId: `conversation-rpg-approval:${approvalArtifact.id}`,
    idempotencyKey: `conversation-rpg-approval:${approvalArtifact.id}:${approvalArtifact.candidateDigest}`,
    sessionId: approvalSession.id,
    artifactId: approvalArtifact.id,
    sourceMessageId: currentApprovalMessage.id,
    candidateDigest: approvalArtifact.candidateDigest,
    expectedSessionRevision: currentApprovalSession.revision,
    expectedArtifactRevision: approvalArtifact.revision,
    expectedSourceMessageRevision: currentApprovalMessage.revision,
    expectedSourceRevision: approvalSnapshot.chapter.revision,
  },
});
assert.equal(approval.approved.canonicalMutationCount, 1);
assert.ok(approval.transaction.chapter.content.includes(approvalStory));
assert.ok(approval.transaction.rpgTurnReceipt);
assert.equal(
  (await novelRepository.get("conversationArtifacts", approvalArtifact.id))?.status,
  "approved",
);

const [
  learningUi,
  sharedRoute,
  sharedServer,
  sharedSyncHook,
  chatWorkspace,
  learningRepository,
  learningService,
  learningCombination,
  closedAgentService,
  chatRpgController,
  rpgTurn,
  rpgApproval,
  rpgRedirect,
  chatPage,
  migration,
] = await Promise.all([
  readFile("app/studio/project/[projectId]/learning/learning-workspace.tsx", "utf8"),
  readFile("app/api/ai/learning/shared-library/route.ts", "utf8"),
  readFile("lib/novel-ai/sovereign-learning/shared-learning-library.server.ts", "utf8"),
  readFile("app/studio/project/[projectId]/chat/hooks/use-shared-learning-sync.ts", "utf8"),
  readFile("app/studio/project/[projectId]/chat/conversation-workspace.tsx", "utf8"),
  readFile("lib/novel-ai/sovereign-learning/repository.ts", "utf8"),
  readFile("lib/novel-ai/sovereign-learning/service.ts", "utf8"),
  readFile("lib/novel-ai/sovereign-learning/combination-engine.ts", "utf8"),
  readFile("lib/novel-ai/web/closed-agent-os-service.ts", "utf8"),
  readFile("app/studio/project/[projectId]/chat/hooks/use-conversation-rpg.ts", "utf8"),
  readFile("lib/novel-ai/web/rpg-chat-turn.ts", "utf8"),
  readFile("app/studio/project/[projectId]/chat/hooks/use-conversation-approval.ts", "utf8"),
  readFile("app/studio/project/[projectId]/rpg/page.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/chat/page.tsx", "utf8"),
  readFile("prisma/migrations/026_shared_abstract_learning_rules.sql", "utf8"),
]);
assert.match(learningUi, /不詢問標題、作者、出處或授權/u);
assert.doesNotMatch(learningUi, /checked=\{webRightsConfirmed\}|權利依據|授權證據或備註/u);
assert.match(learningUi, /閉端故事因果教師/u);
assert.match(learningUi, /\["openai", "gemini", "grok"\]/u);
assert.match(learningUi, /統合閉端 AI 自動協調器/u);
assert.match(learningUi, /沒有 API：用自己的 ChatGPT／Grok／Gemini 人工接力/u);
assert.match(learningUi, /建立公開網址研究包/u);
assert.match(learningUi, /交給閉端因果教師重新驗證/u);
assert.doesNotMatch(learningUi, /type TeacherMode|manualTeacherProviders|setManualTeacherProviders/u);
const publicCoordinator = coordinateUnifiedClosedAI({
  task: "public_story_research",
  verifiedExternalProviderIds: ["openai", "gemini", "openai"],
});
assert.equal(publicCoordinator.userSelectionRequired, false);
assert.deepEqual(publicCoordinator.roles.map((role) => role.id), [
  "causal_teacher",
  "knowledge_layer",
  "story_executor",
]);
assert.deepEqual(publicCoordinator.externalProviderIds, ["openai", "gemini"]);
const privateCoordinator = coordinateUnifiedClosedAI({
  task: "private_story_learning",
  verifiedExternalProviderIds: ["openai", "grok"],
});
assert.deepEqual(privateCoordinator.externalProviderIds, []);
assert.equal(privateCoordinator.privateContentStaysClosed, true);
const choiceCoordinator = coordinateUnifiedClosedAI({ task: "three_choices" });
assert.equal(choiceCoordinator.userSelectionRequired, false);
assert.equal(choiceCoordinator.externalAnalysisEnabled, false);
assert.match(sharedRoute, /limit=24|searchParams\.get\("limit"\)/u);
assert.match(sharedRoute, /fetchSite === "same-origin" \|\| fetchSite === "same-site"/u);
assert.match(sharedRoute, /SHARED_LEARNING_CONTENT_TYPE_REQUIRED/u);
assert.match(sharedServer, /SHARED_LEARNING_DATABASE_FETCH_LIMIT/u);
assert.match(sharedServer, /cache\.size >= 100/u);
assert.match(sharedServer, /slice\(0, input\.limit\)/u);
assert.match(sharedServer, /SHARED_LEARNING_FETCH_TIMEOUT_MS = 3_000/u);
assert.match(sharedServer, /Math\.min\(SHARED_LEARNING_FETCH_TIMEOUT_MS/u);
assert.equal(
  sharedServer.match(/signal: controller\.signal/gu)?.length,
  2,
  "both Supabase query and publish fetches must receive a bounded AbortSignal",
);
assert.match(
  sharedServer,
  /withinSharedLearningDeadline\(fetchImpl\([\s\S]*?SHARED_LEARNING_PUBLISH_TIMEOUT/u,
);
assert.match(
  sharedServer,
  /shared_abstract_learning_rules\?[\s\S]*?withinSharedLearningDeadline\([\s\S]*?response\.json\(\)[\s\S]*?SHARED_LEARNING_QUERY_TIMEOUT/u,
);
assert.match(sharedSyncHook, /\/api\/ai\/learning\/shared-library\?limit=24/u);
assert.match(sharedSyncHook, /REQUEST_TIMEOUT_MS = 1_600/u);
assert.match(sharedSyncHook, /ingestSharedLearningSnapshot/u);
assert.match(chatWorkspace, /await ensureSharedLearningReady\(input\.signal\)/u);
assert.match(chatWorkspace, /useConversationRpgController\(\{[\s\S]{0,500}learningRepository,[\s\S]{0,160}ensureSharedLearningReady,/u);
assert.match(chatWorkspace, /resolveStudioClosedComputePolicy\(\)/u);
assert.match(chatWorkspace, /hasExplicitLocalComputeAuthorization\(automaticComputePolicy\)/u);
assert.doesNotMatch(chatWorkspace, /browserComputePolicy:[\s\S]{0,80}"browser-first"/u);
assert.match(learningRepository, /projectStatusFamilyConfidence/u);
assert.match(learningRepository, /projectFamilyDimensionStatusConfidence/u);
assert.match(learningRepository, /queryApprovedRules/u);
assert.match(learningRepository, /queryApprovedRulesByDimension/u);
assert.match(learningRepository, /queryRuleSimilarityCandidates/u);
assert.match(learningService, /repository\.queryRuleSimilarityCandidates/u);
assert.doesNotMatch(learningService, /queryApprovedRules\(projectId, sharedFamilies/u);
assert.match(learningCombination, /repository\.queryApprovedRulesByDimension/u);
assert.match(learningCombination, /candidateLimitPerDimension = 2/u);
assert.doesNotMatch(learningCombination, /repository\.listRules\(input\.projectId\)/u);
assert.match(closedAgentService, /connectPrivateHubAutomatically/u);
assert.match(closedAgentService, /=== "browser-first"/u);
assert.match(chatRpgController, /const plan = await buildRpgRuleChoicePlan\(\{/u);
assert.match(chatRpgController, /loadLearningAwareRpgChatSnapshot\(\{/u);
assert.match(chatRpgController, /learningRepository,[\s\S]{0,100}ensureSharedLearningReady,/u);
assert.doesNotMatch(chatRpgController, /loadRpgChatSnapshot\(/u);
assert.match(chatRpgController, /fallbackReason: "RPG_CHOICE_RULE_PLAN_IMMEDIATE"/u);
assert.doesNotMatch(chatRpgController, /planRpgChatChoices\(/u);
assert.doesNotMatch(chatRpgController, /180_000|超過 180 秒/u);
assert.match(chatRpgController, /serializeRpgChoices\(envelope\)/u);
assert.match(rpgTurn, /assertThreePlayableChoices/u);
assert.match(rpgTurn, /closedCausalTeacherKnowledge/u);
assert.match(rpgTurn, /maximumRules: 8/u);
assert.match(rpgTurn, /causalKnowledgeSnapshotDigest/u);
assert.match(rpgTurn, /causalKnowledge: causalKnowledge\.selectedRuleIds\.length \?/u);
assert.match(rpgTurn, /RPG_SHARED_LEARNING_SYNC_WAIT_MS = 350/u);
assert.match(rpgTurn, /export const RPG_CHAT_CHOICE_AI_TIMEOUT_MS = 12_000/u);
assert.match(rpgTurn, /enhancementController\.abort\("RPG_CHOICE_AI_ENHANCEMENT_TIMEOUT"\)/u);
assert.match(rpgApproval, /await approveRpgChatTurn\(\{/u);
assert.match(rpgApproval, /conversation-rpg-approval/u);
assert.match(rpgRedirect, /redirect\(`\/studio\/project\/\$\{encodeURIComponent\(projectId\)\}\/chat\?mode=play`\)/u);
assert.match(chatPage, /first\(query\.mode\) === "play"/u);
assert.match(chatPage, /開始目前玩法的第一回合/u);
assert.match(migration, /create index if not exists idx_shared_learning_global_rank/u);
assert.doesNotMatch(migration, /raw_story|source_text|source_sentence|dialogue_text/u);

console.log(JSON.stringify({
  status: "PASS",
  automaticTeacherRuleCount: teacherRules.length,
  sharedTopKRuleCount: reducedShared.rules.length,
  rpgChoiceKeys: choicePlan.choices.map((choice) => choice.key),
  approvalCanonicalMutationCount: approval.approved.canonicalMutationCount,
  approvalReceiptWritten: Boolean(approval.transaction.rpgTurnReceipt),
  sourceTextRetained: false,
  entireLibraryScanned: false,
}, null, 2));

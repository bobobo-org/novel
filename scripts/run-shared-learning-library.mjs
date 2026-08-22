import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  MemorySovereignLearningRepository,
  normalizeSharedLearningRules,
  sha256Hex,
  stableStringify,
  VERIFIED_STORY_TEACHER_VERSION,
} from "../lib/novel-ai/sovereign-learning/index.ts";
import {
  approveRpgChatTurn,
  buildDeterministicRpgTurnStory,
  buildRpgRuleChoicePlan,
  loadRpgChatSnapshot,
} from "../lib/novel-ai/web/rpg-chat-turn.ts";
import { initializeMingtanPreset } from "../lib/novel-ai/web/rpg-preset.ts";

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

const choicePlan = await buildRpgRuleChoicePlan({
  snapshot: {
    chapter: { id: "chapter-1", revision: 3 },
    storyState: { revision: 5 },
    directorContext: { conflict: "目前局勢" },
    causalKnowledge: {
      selectedRuleIds: approvedContext.selectedRuleIds,
      instructions: approvedContext.instructions,
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
assert.match(chatRpgController, /const plan = await buildRpgRuleChoicePlan\(\{/u);
assert.match(chatRpgController, /fallbackReason: "RPG_CHOICE_RULE_PLAN_IMMEDIATE"/u);
assert.doesNotMatch(chatRpgController, /planRpgChatChoices\(/u);
assert.doesNotMatch(chatRpgController, /180_000|超過 180 秒/u);
assert.match(chatRpgController, /serializeRpgChoices\(envelope\)/u);
assert.match(rpgTurn, /assertThreePlayableChoices/u);
assert.match(rpgTurn, /closedCausalTeacherKnowledge/u);
assert.match(rpgTurn, /maximumRules: 8/u);
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

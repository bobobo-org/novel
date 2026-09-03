import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { makeRecord, optionalValue } from "../lib/novel-ai/domain/index.ts";
import { buildProjectBundle, createDraft } from "../lib/novel-ai/domain/creation.ts";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/memory/memory-repository.ts";
import {
  acceptStudioChoice,
  persistStudioChoiceCandidate,
} from "../lib/novel-ai/repository/studio-canonical.ts";
import {
  buildTopicWorldFamilyStageMatrix,
  serializeTopicWorldFamilyDraftSelection,
} from "../lib/novel-ai/game/topic-world-family-stage-matrix.ts";
import { buildRpgChoices } from "../lib/novel-ai/game/progression/rpg-progression.ts";
import {
  approveRpgChatTurn,
  assertFreshRpgChoiceExecutionProof,
  buildDeterministicRpgChatTurnCandidate,
  buildRpgRuleChoicePlan,
  loadRpgChatSnapshot,
  RPG_CHAT_FALLBACK_REPAIR_RETRY_TIMEOUT_MS,
  RPG_CHAT_FALLBACK_REVIEW_TIMEOUT_MS,
  RPG_CHAT_STORY_AI_TIMEOUT_MS,
  rpgChoiceRuleFallbackReason,
} from "../lib/novel-ai/web/rpg-chat-turn.ts";
import {
  buildCompactRpgResolutionDirectorPrompt,
  parseRpgChoiceDirectorOutput,
  rpgTextSimilarity,
} from "../lib/novel-ai/web/rpg-closed-ai-director.ts";
import { runStudioClosedAI } from "../lib/novel-ai/web/studio-closed-ai.ts";

assert.equal(RPG_CHAT_STORY_AI_TIMEOUT_MS, 360_000);
assert.equal(RPG_CHAT_FALLBACK_REVIEW_TIMEOUT_MS, 360_000);
assert.equal(RPG_CHAT_FALLBACK_REPAIR_RETRY_TIMEOUT_MS, 360_000);
const [
  rpgTurnSource,
  conversationRpgSource,
  rpgWorkspaceSource,
  messageComposerSource,
  externalCascadeSource,
  closedAgentOsSource,
] = await Promise.all([
  readFile(new URL("../lib/novel-ai/web/rpg-chat-turn.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/chat/hooks/use-conversation-rpg.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/rpg/rpg-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/chat/components/message-composer.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/novel-ai/web/rpg-external-cascade.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/novel-ai/closed-agent-os/closed-agent-os.ts", import.meta.url), "utf8"),
]);
assert.match(rpgTurnSource, /qualityMode: "fast"[\s\S]{0,120}browserComputePolicy: "quality-first"/u);
const choicePlannerStart = rpgTurnSource.indexOf("export async function planRpgChatChoices");
const choicePlannerEnd = rpgTurnSource.indexOf("\nexport ", choicePlannerStart + 1);
const choicePlannerSource = rpgTurnSource.slice(choicePlannerStart, choicePlannerEnd);
assert.ok(choicePlannerStart >= 0 && choicePlannerEnd > choicePlannerStart);
assert.match(
  choicePlannerSource,
  /task: "three_choices"[\s\S]{0,800}ephemeralPrompt: true[\s\S]{0,1300}assertFreshRpgChoiceExecutionProof/u,
  "A/B/C planning retries must bypass candidate caches and still require fresh verified model execution",
);
const choiceProofStart = rpgTurnSource.indexOf("export function assertFreshRpgChoiceExecutionProof");
const choiceProofEnd = rpgTurnSource.indexOf("\nexport ", choiceProofStart + 1);
const choiceProofSource = rpgTurnSource.slice(choiceProofStart, choiceProofEnd);
assert.ok(choiceProofStart >= 0 && choiceProofEnd > choiceProofStart);
assert.match(
  choiceProofSource,
  /!hasVerifiedExecutedStoryOutput\(result\)[\s\S]{0,160}result\.cache\.candidateHit[\s\S]{0,700}executionReceipt\.actualExecutor !== result\.provider[\s\S]{0,900}result\.sourceChapterId !== input\.chapter\.id/u,
  "fresh A/B/C proof must reject cache hits and mismatched receipt or chapter identity",
);
assert.match(rpgTurnSource, /RPG_CHAT_FALLBACK_REVIEW_TIMEOUT_MS = 360_000/u);
assert.match(rpgTurnSource, /RPG_CHAT_FALLBACK_REPAIR_RETRY_TIMEOUT_MS = 360_000/u);
assert.match(rpgTurnSource, /const generationDeadlineMs = Math\.max\([\s\S]{0,160}input\.generationDeadlineMs \?\? RPG_CHAT_STORY_AI_TIMEOUT_MS/u);
assert.match(rpgTurnSource, /const reviewDeadlineMs = Math\.min\([\s\S]{0,220}input\.fallbackReviewDeadlineMs \?\? RPG_CHAT_FALLBACK_REVIEW_TIMEOUT_MS/u);
assert.match(rpgTurnSource, /retryDispatchDeadlineMs: repairRetryDeadlineMs/u);
assert.match(rpgTurnSource, /actualExecutor === "deterministic-rule-fallback"[\s\S]{0,500}RPG_FALLBACK_CLOSED_REVIEW_REQUIRED/u);
assert.doesNotMatch(rpgTurnSource, /remainingTotalDeadlineMs|RPG_STORY_AI_TOTAL_TIMEOUT/u);
const userAbortGuard = rpgTurnSource.indexOf("if (input.signal?.aborted) throw error;");
const deterministicFallback = rpgTurnSource.indexOf("const draft = buildDeterministicRpgTurnStory", userAbortGuard);
assert.ok(userAbortGuard >= 0 && deterministicFallback > userAbortGuard, "user cancellation must escape before rules fallback");
assert.match(rpgTurnSource, /postFallbackClosedReview/u);
assert.match(rpgTurnSource, /reviewAttempts/u);
assert.match(rpgTurnSource, /RPG_FALLBACK_CLOSED_REVIEW_REQUIRED/u);
assert.match(rpgTurnSource, /cause: reviewError/u);
assert.match(rpgTurnSource, /generationFailureLeafCode: safeRpgFailureLeafCode\(generationError\)/u);
assert.match(conversationRpgSource, /safeErrorCode: rpgLeafErrorCode\(error\)/u);
assert.match(closedAgentOsSource, /RPG_\[A-Z0-9_\]\{1,100\}/u);
assert.match(closedAgentOsSource, /const message = cause instanceof Error \? cause\.message\.trim\(\) : ""/u);
assert.match(conversationRpgSource, /正文階段最長 360 秒[\s\S]{0,180}追加最多 360 秒閉端獨立合成複核[\s\S]{0,120}白名單內[\s\S]{0,80}安全修正重試[\s\S]{0,60}只重試一次/u);
assert.match(rpgWorkspaceSource, /正文階段最長等待 360 秒[\s\S]{0,180}追加最多 360 秒閉端獨立合成複核[\s\S]{0,120}白名單內[\s\S]{0,80}安全修正重試[\s\S]{0,60}只重試一次/u);
assert.match(messageComposerSource, /閉端 AI 正文最長 360 秒[\s\S]{0,100}隱藏複核則最多另加 360 秒[\s\S]{0,100}白名單內[\s\S]{0,100}只重試一次/u);
assert.match(externalCascadeSource, /最長 360 秒完整正文時限[\s\S]{0,100}獨立 360 秒隱藏複核[\s\S]{0,100}白名單內[\s\S]{0,100}只重試一次/u);
assert.match(
  rpgWorkspaceSource,
  /RPG_TURN_TIMEOUT_MS = \([\s\S]{0,120}RPG_CHAT_STORY_AI_TIMEOUT_MS[\s\S]{0,80}RPG_CHAT_FALLBACK_REVIEW_TIMEOUT_MS[\s\S]{0,80}RPG_CHAT_FALLBACK_REPAIR_RETRY_TIMEOUT_MS[\s\S]{0,80}RPG_TURN_COMPLETION_GRACE_MS/u,
  "the workspace safety guard must include generation, review, and the one bounded repair-retry deadline",
);
assert.doesNotMatch(rpgWorkspaceSource, /300_000|超過 300 秒/u);

const freshChoiceProof = {
  taskId: "choice-proof-task",
  candidateId: "choice-proof-candidate",
  status: "awaiting_approval",
  provider: "local-ollama",
  model: "qwen-choice-proof",
  modelDigest: "a".repeat(64),
  sourceChapterId: "choice-proof-chapter",
  sourceRevision: 3,
  content: "A 守住證據。\nB 交換資源。\nC 直取核心。",
  contentDigest: "b".repeat(64),
  actualExecutor: "local-ollama",
  executionReceipt: {
    taskId: "choice-proof-task",
    backendId: "local-ollama",
    modelId: "qwen-choice-proof",
    modelDigest: "a".repeat(64),
    startedAt: "2026-09-02T00:00:00.000Z",
    completedAt: "2026-09-02T00:00:01.000Z",
    generatedTokenEvents: 3,
    outputCharacters: 24,
    contentDigest: "b".repeat(64),
    contextDigest: "c".repeat(64),
    proofState: "verified",
    dataLeftDevice: false,
    externalRequest: false,
    actualExecutor: "local-ollama",
  },
  contextDigest: "c".repeat(64),
  dataLeftDevice: false,
  externalRequest: false,
  canonicalMutationCount: 0,
  warnings: [],
  toolExecutions: [],
  ledgerHeadHash: "d".repeat(64),
  requestContractDigest: "e".repeat(64),
  applicationValidationBindingDigest: null,
  regeneration: null,
  cache: { candidateHit: false, planHit: false, bypassReason: null },
};
const freshChoiceChapter = { id: "choice-proof-chapter", revision: 3 };
assert.equal(
  assertFreshRpgChoiceExecutionProof({
    result: freshChoiceProof,
    chapter: freshChoiceChapter,
  }).executionReceipt.taskId,
  freshChoiceProof.taskId,
);
for (const mutate of [
  (value) => { value.cache.candidateHit = true; value.actualExecutor = "not_executed"; value.executionReceipt = null; },
  (value) => { value.sourceChapterId = "wrong-chapter"; },
  (value) => { value.sourceRevision += 1; },
  (value) => { value.executionReceipt.modelDigest = "f".repeat(64); },
  (value) => { value.executionReceipt.contentDigest = "0".repeat(64); },
]) {
  const invalid = structuredClone(freshChoiceProof);
  mutate(invalid);
  assert.throws(
    () => assertFreshRpgChoiceExecutionProof({ result: invalid, chapter: freshChoiceChapter }),
    (error) => error?.code === "RPG_CHAT_CHOICE_PROOF_MISSING",
  );
}
assert.equal(
  rpgChoiceRuleFallbackReason({
    error: Object.assign(new Error("choice proof missing"), {
      code: "RPG_CHAT_CHOICE_PROOF_MISSING",
    }),
  }),
  null,
  "a proof failure must remain visible and must never become timeout fallback",
);

const companion145ChoicePayload = JSON.stringify({
  choices: [
    {
      key: "A",
      title: "先封住側門追查失蹤證人",
      description: "主角先封住研究院側門，請張家守門人核對失蹤證人的通行紀錄與最後目擊位置。",
      consequence: "會失去追趕先機，但能保住可追溯證據。",
      continuityReason: "承接研究院封鎖與證人失蹤。",
    },
    {
      key: "B",
      title: "以張家名義交換巡查密報",
      description: "主角請張家代表出面交涉，用一筆可公開核對的人情換取校方巡查紀錄與換班時限。",
      consequence: "人情債會留下，也可能暴露調查方向。",
      continuityReason: "延續張氏學術世家的資源與責任。",
    },
    {
      key: "C",
      title: "趁警戒交替潛入封存樓層",
      description: "主角趁警戒交替沿維修通道潛入封存樓層，在增援抵達前確認異常儀器的實際狀態。",
      consequence: "成功可逼近核心，失敗會暴露隊伍位置。",
      continuityReason: "推進封存樓層與異常儀器線索。",
    },
  ],
});
const parsedCompanion145Choices = parseRpgChoiceDirectorOutput(companion145ChoicePayload);
assert.deepEqual(parsedCompanion145Choices.map((choice) => choice.key), ["A", "B", "C"]);
assert.equal(parsedCompanion145Choices[0].consequenceTeaser, "會失去追趕先機，但能保住可追溯證據。");
assert.equal(
  Object.hasOwn(parsedCompanion145Choices[0], "continuityReason"),
  false,
  "the obsolete Companion-only continuity field must never reach the visible choice contract",
);
const conciseCompanion145ChoicePayload = JSON.stringify({
  choices: [
    {
      key: "A",
      title: "封側門",
      description: "主角封鎖側門，核對證人最後通行紀錄。".slice(0, 18),
      consequence: "會失去追趕先機。".slice(0, 8),
      continuityReason: "承接證人失蹤線索。".slice(0, 8),
    },
    {
      key: "B",
      title: "換密報",
      description: "主角以張家名義交涉，換取校方巡查時限。".slice(0, 18),
      consequence: "會留下公開人情債。".slice(0, 8),
      continuityReason: "延續張家資源責任。".slice(0, 8),
    },
    {
      key: "C",
      title: "潛封樓",
      description: "主角趁警戒交替潛入，確認異常儀器狀態。".slice(0, 18),
      consequence: "失敗會暴露隊伍位置。".slice(0, 8),
      continuityReason: "推進封樓儀器線索。".slice(0, 8),
    },
  ],
});
const conciseCompanion145Choices = parseRpgChoiceDirectorOutput(conciseCompanion145ChoicePayload);
assert.deepEqual(
  conciseCompanion145Choices.map((choice) => choice.title),
  ["封側門", "換密報", "潛封樓"],
  "the exact Companion 1.4.5 shape must accept its declared Chinese 3/18/8 minima",
);
for (const row of JSON.parse(conciseCompanion145ChoicePayload).choices) {
  assert.equal(row.title.length, 3);
  assert.equal(row.description.length, 18);
  assert.equal(row.consequence.length, 8);
  assert.equal(row.continuityReason.length, 8);
}
for (const [field, value] of [
  ["title", "太短"],
  ["description", "短".repeat(17)],
  ["consequence", "短".repeat(7)],
  ["continuityReason", "短".repeat(7)],
]) {
  const belowLegacyMinimum = JSON.parse(conciseCompanion145ChoicePayload);
  belowLegacyMinimum.choices[0][field] = value;
  assert.throws(
    () => parseRpgChoiceDirectorOutput(JSON.stringify(belowLegacyMinimum)),
    /RPG_AI_CHOICE_INCOMPLETE/u,
    `Companion 1.4.5 ${field} must reject values below its declared minimum`,
  );
}
const relaxedShapeWithExtraField = JSON.parse(conciseCompanion145ChoicePayload);
relaxedShapeWithExtraField.choices[0].unexpected = "must not activate legacy minima";
assert.throws(
  () => parseRpgChoiceDirectorOutput(JSON.stringify(relaxedShapeWithExtraField)),
  /RPG_AI_CHOICE_INCOMPLETE/u,
  "extra fields must not activate the Companion 1.4.5 compatibility minima",
);
const relaxedRootWithExtraField = JSON.parse(conciseCompanion145ChoicePayload);
relaxedRootWithExtraField.metadata = "must not activate legacy minima";
assert.throws(
  () => parseRpgChoiceDirectorOutput(JSON.stringify(relaxedRootWithExtraField)),
  /RPG_AI_CHOICE_INCOMPLETE/u,
  "extra root fields must not activate the Companion 1.4.5 compatibility minima",
);
const currentChoicePayload = JSON.parse(companion145ChoicePayload);
for (const choice of currentChoicePayload.choices) {
  choice.consequenceTeaser = choice.consequence;
}
currentChoicePayload.choices[0].consequenceTeaser = "目前網站欄位必須優先，不能被舊欄位覆蓋。";
assert.equal(
  parseRpgChoiceDirectorOutput(JSON.stringify(currentChoicePayload))[0].consequenceTeaser,
  "目前網站欄位必須優先，不能被舊欄位覆蓋。",
);
const invalidCanonicalChoicePayload = structuredClone(currentChoicePayload);
invalidCanonicalChoicePayload.choices[0].consequenceTeaser = null;
assert.throws(
  () => parseRpgChoiceDirectorOutput(JSON.stringify(invalidCanonicalChoicePayload)),
  /RPG_AI_CHOICE_INCOMPLETE/u,
  "an explicitly invalid canonical field must not be hidden by the legacy alias",
);
const shortLegacyChoicePayload = JSON.parse(companion145ChoicePayload);
shortLegacyChoicePayload.choices[0].consequence = "代價太短";
assert.throws(
  () => parseRpgChoiceDirectorOutput(JSON.stringify(shortLegacyChoicePayload)),
  /RPG_AI_CHOICE_INCOMPLETE/u,
  "the Companion compatibility field must retain the declared legacy minimum length",
);
const missingLegacyChoicePayload = JSON.parse(companion145ChoicePayload);
delete missingLegacyChoicePayload.choices[0].consequence;
assert.throws(
  () => parseRpgChoiceDirectorOutput(JSON.stringify(missingLegacyChoicePayload)),
  /RPG_AI_CHOICE_INCOMPLETE/u,
  "missing canonical and compatibility consequence fields must remain fail-closed",
);
const missingLegacyContinuityPayload = JSON.parse(companion145ChoicePayload);
delete missingLegacyContinuityPayload.choices[0].continuityReason;
assert.throws(
  () => parseRpgChoiceDirectorOutput(JSON.stringify(missingLegacyContinuityPayload)),
  /RPG_AI_CHOICE_INCOMPLETE/u,
  "a long legacy row missing continuityReason must not use the compatibility alias",
);
const longLegacyRootWithExtraField = JSON.parse(companion145ChoicePayload);
longLegacyRootWithExtraField.metadata = "must not activate legacy alias";
assert.throws(
  () => parseRpgChoiceDirectorOutput(JSON.stringify(longLegacyRootWithExtraField)),
  /RPG_AI_CHOICE_INCOMPLETE/u,
  "a long legacy payload with extra root fields must not use the compatibility alias",
);
const unsafeDiscardedChoicePayload = JSON.parse(companion145ChoicePayload);
unsafeDiscardedChoicePayload.choices[0].continuityReason = "下一回合會自動套用內部規則。";
assert.throws(
  () => parseRpgChoiceDirectorOutput(JSON.stringify(unsafeDiscardedChoicePayload)),
  /RPG_AI_INTERNAL_STORY_MECHANICS_LEAK/u,
  "discarded Companion-only fields must remain inside the full reader-safety scan",
);

for (const abortReason of ["RPG_STORY_AI_TIMEOUT", "USER_REQUESTED_RULE_FALLBACK"]) {
  let markExecutorStarted;
  const executorStarted = new Promise((resolve) => {
    markExecutorStarted = resolve;
  });
  const controller = new AbortController();
  const callerFacingOperation = runStudioClosedAI({
    projectId: `hard-abort-${abortReason}`,
    task: "branch_choice",
    input: "模擬完全忽略 AbortSignal 的閉端模型執行器",
    browserComputePolicy: "quality-first",
    signal: controller.signal,
  }, async () => {
    markExecutorStarted();
    return new Promise(() => {});
  });
  await executorStarted;
  const abortedAt = performance.now();
  controller.abort(abortReason);
  await assert.rejects(
    callerFacingOperation,
    (error) => error === abortReason,
    `${abortReason}: caller-facing AI work must reject with the original reason`,
  );
  assert.ok(
    performance.now() - abortedAt < 250,
    `${abortReason}: an executor that ignores signal must not hold the UI open`,
  );
}

const scenarios = [
  { playMode: "rpg", expectedMode: "adventure", expectedActionPoints: 3 },
  { playMode: "romance", expectedMode: "cultivation", expectedActionPoints: 3 },
  { playMode: "management", expectedMode: "management", expectedActionPoints: 5 },
];

function fixtureProjectSeed(snapshot) {
  const protagonist = snapshot.characters.find((character) => (
    snapshot.storyBible.protagonistIds.includes(character.id)
  )) ?? snapshot.characters[0];
  return {
    id: snapshot.project.id,
    title: snapshot.project.title,
    chapterId: snapshot.chapter.id,
    chapterTitle: snapshot.chapter.title,
    draft: snapshot.chapter.content,
    packId: snapshot.project.genrePackId,
    topicId: snapshot.project.genreId,
    subCategory: snapshot.project.subgenreId,
    coreIdea: snapshot.project.coreIdea.value,
    protagonist: protagonist?.name ?? null,
    goal: protagonist?.goal.value ?? null,
    worldRule: snapshot.worldRules[0]?.description ?? null,
    conflict: snapshot.conflict,
    style: snapshot.project.narrativeStyle.value,
    adultMode: snapshot.project.adultMode,
    adultExperienceProfile: snapshot.project.adultExperienceProfile ?? null,
  };
}

async function commitRulesFixture(repository, snapshot, candidate) {
  const saved = await persistStudioChoiceCandidate(
    repository,
    fixtureProjectSeed(snapshot),
    {
      optionKey: candidate.choice.key,
      text: `${candidate.choice.title}｜${candidate.choice.description}`,
      consequence: `${candidate.choice.consequence}；${candidate.resolution.outcomeLabel}`,
      effect: candidate.resolution.effect,
      providerId: "contract-test-fixture",
      modelId: "deterministic-hidden-draft-fixture",
      externalRequest: false,
      dataLeftDevice: false,
      rpgContextRevisionGuard: structuredClone(candidate.contextRevisionGuard),
      rpgSettlement: candidate.resolution.settlement,
    },
  );
  return acceptStudioChoice(
    repository,
    saved.candidate.id,
    candidate.story,
    `${candidate.choice.key}｜${candidate.choice.title}｜${candidate.resolution.outcomeLabel}`,
  );
}
const observations = [];
const deterministicChoiceCoverage = {
  sets: 0,
  maximumSimilarity: 0,
  repeatedOpportunitySeeds: [],
};

function assertMeaningfullyDistinctChoiceSet(choices, label) {
  assert.equal(new Set(choices.map((choice) => choice.description.slice(0, 28))).size, 3, `${label}: first concrete actions must differ`);
  const descriptionByApproach = Object.fromEntries(
    choices.map((choice) => [choice.approach, choice.description]),
  );
  assert.match(descriptionByApproach.steady, /先以.+封住退路.+分開保全/u, `${label}: steady must preserve evidence before pursuit`);
  assert.match(descriptionByApproach.resource, /當場交付.+作為籌碼.+換取/u, `${label}: resource must trade a concrete asset for access`);
  assert.match(descriptionByApproach.bold, /越過試探.+直取.+接受.+代價/u, `${label}: bold must force a breach and accept exposure`);
  let maximumSimilarity = 0;
  for (let left = 0; left < choices.length; left += 1) {
    for (let right = left + 1; right < choices.length; right += 1) {
      const similarity = rpgTextSimilarity(
        choices[left].description,
        choices[right].description,
      );
      maximumSimilarity = Math.max(maximumSimilarity, similarity);
      assert.ok(
        similarity < 0.72,
        `${label}: choices collapsed into shared copy; similarity=${similarity.toFixed(3)}; ${choices[left].description} || ${choices[right].description}`,
      );
    }
  }
  return maximumSimilarity;
}

for (const scenario of scenarios) {
  const repository = new MemoryNovelRepository();
  const draft = createDraft("quick");
  draft.title = `首回合-${scenario.playMode}`;
  draft.genrePackId = "pack-6";
  draft.genreId = "classic-topic-009";
  draft.protagonist = optionalValue("林澄", "user_defined");
  draft.coreIdea = optionalValue("林澄必須在夥伴離去前守住瀕危事業與彼此的承諾。", "user_defined");
  draft.answers.playMode = optionalValue(scenario.playMode, "user_defined");
  const stageMatrix = buildTopicWorldFamilyStageMatrix({
    seed: `novel-project:${draft.projectId}:procedural-v1`,
    topicId: draft.genreId,
    playMode: scenario.playMode,
  });
  draft.answers.stageFamily = optionalValue(
    serializeTopicWorldFamilyDraftSelection({
      matrix: stageMatrix,
      familyId: stageMatrix.stageFamilies[0].familyId,
    }),
    "user_defined",
  );
  const bundle = buildProjectBundle(draft);
  assert.ok(bundle.cast.length >= 4, `${scenario.playMode}: auto-family must provide at least four supporting characters`);
  const stageCompanionName = bundle.cast[0]?.name;
  assert.ok(stageCompanionName, `${scenario.playMode}: auto-family must provide a named on-stage companion`);
  await repository.createProject(bundle, `create:${scenario.playMode}`);
  const chapter = await repository.put("chapters", {
    ...makeRecord(bundle.project.id),
    title: "雨夜的最後期限",
    order: 1,
    content: "帳冊上的赤字和未拆的離職信同時壓在桌上，競爭者明早就會帶走最後一批客戶。林澄只能用現有團隊、承諾與資源作出選擇。",
    summary: "最後期限逼近。",
    status: "draft",
  });
  await repository.put("projects", {
    ...bundle.project,
    activeChapterId: chapter.id,
  }, bundle.project.revision);
  const storyBible = await repository.get("storyBibles", bundle.storyBible.id);
  assert.ok(storyBible);
  await repository.put("storyBibles", {
    ...storyBible,
    unresolvedThreads: [
      ...storyBible.unresolvedThreads,
      "青楓派巡察將於天亮封鎖最後通路",
    ],
  }, storyBible.revision);

  // Reproduce the legacy AAB shape: play mode is locked, but every gameplay
  // field is empty. A reload must repair this without touching prose or turn.
  const state = await repository.get("storyStates", bundle.storyState.id);
  assert.ok(state);
  const legacyState = await repository.put("storyStates", {
    ...state,
    protagonistStats: {},
    resources: {
      ...Object.fromEntries(
        Object.entries(state.resources).filter(([key]) => key.startsWith("status.")),
      ),
      "status.health": 100,
      "status.stamina": 100,
      "status.hp": 100,
    },
    money: null,
    relationships: {},
    reputation: null,
    worldFlags: Object.fromEntries(Object.entries(state.worldFlags).filter(([key]) => key.startsWith("story."))),
  }, state.revision);
  const chapterBefore = await repository.get("chapters", chapter.id);

  const snapshot = await loadRpgChatSnapshot(repository, bundle.project.id);
  assert.equal(snapshot.progressionMode, scenario.expectedMode);
  assert.deepEqual(snapshot.baseChoices.map((choice) => choice.key), ["A", "B", "C"]);
  assert.equal(
    snapshot.baseChoices.some((choice) => choice.disabledReason),
    false,
    `${scenario.playMode}: ${snapshot.baseChoices.map((choice) => choice.disabledReason).join(" | ")}`,
  );
  assert.equal(new Set(snapshot.baseChoices.map((choice) => choice.title)).size, 3);
  assert.equal(new Set(snapshot.baseChoices.map((choice) => choice.approach)).size, 3);
  assert.equal(new Set(snapshot.baseChoices.map((choice) => choice.encounter.signature)).size, 3);
  const compactSceneContract = buildCompactRpgResolutionDirectorPrompt({
    context: snapshot.directorContext,
    choice: snapshot.baseChoices[0],
    language: snapshot.language,
    resolution: {
      outcomeLabel: "部分成功",
      settlement: ["行動落地", "代價已鎖定", "正式數值只在核准後寫入"],
    },
  });
  assert.ok(compactSceneContract.length <= 1_600);
  assert.match(compactSceneContract, /RPG_SCENE_CONTRACT_V2/u);
  const protectedChoiceTitle = Array.from(
    snapshot.baseChoices[0].title.normalize("NFKC").replace(/\s+/gu, " ").trim(),
  ).slice(0, 32).join("");
  assert.match(compactSceneContract, new RegExp(protectedChoiceTitle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(
    compactSceneContract,
    /正文與人物台詞不得照抄或念出代號、標題或畫面文字/u,
  );
  assert.match(compactSceneContract, /開場必須緊接這段最近的正式正文/u);
  assert.match(compactSceneContract, /既有 Canon 包含/u);
  assert.match(compactSceneContract, /1100–1500/u);
  assert.match(compactSceneContract, /首段須(?:自然且逐字放入|承接)/u);
  assert.match(compactSceneContract, /具名說話/u);
  const compactSupportingCharacters = snapshot.directorContext.supportingCharacters ?? [];
  assert.ok(compactSupportingCharacters.length >= 2);
  const supportingInstructionCases = [
    [0, /未列出配角；不得新增具名配角/u],
    [1, /列出的配角須以具名行動與對話改變局勢/u],
    [2, /列出的兩名配角都須具名行動並各有對話/u],
  ];
  for (const [supportingCount, expectedInstruction] of supportingInstructionCases) {
    const countContract = buildCompactRpgResolutionDirectorPrompt({
      context: {
        ...snapshot.directorContext,
        supportingCharacters: compactSupportingCharacters.slice(0, supportingCount),
      },
      choice: snapshot.baseChoices[0],
      language: snapshot.language,
      resolution: {
        outcomeLabel: "部分成功",
        settlement: ["行動落地", "代價已鎖定"],
      },
    });
    assert.match(countContract, expectedInstruction);
  }
  if (scenario.playMode === "rpg") {
    const saturatedCharacter = (name) => ({
      name,
      goal: "必須在既有時限內完成查驗並保住同伴".repeat(5),
      actionMastery: {
        relation: "使用",
        name: "既有能力名稱不得改寫".repeat(5),
        era: "修真古代",
        limitation: "只能依既有代價使用".repeat(5),
      },
      limitations: ["不可越過既有 Canon 與時代限制".repeat(4)],
    });
    const latestFormalTail = "最新正式正文尾端錨點石門後傳來第三次敲擊";
    const saturatedChoice = {
      ...snapshot.baseChoices[0],
      title: "選定行動完整名稱".repeat(12),
      description: "這個行動必須落地並遇到具體阻力".repeat(12),
      consequenceTeaser: "付出不可逆代價並留下新危機".repeat(12),
      encounter: {
        ...snapshot.baseChoices[0].encounter,
        complication: "阻力已經改變現場與人物關係".repeat(12),
      },
    };
    const saturatedContract = buildCompactRpgResolutionDirectorPrompt({
      context: {
        ...snapshot.directorContext,
        project: {
          title: "飽和作品名稱".repeat(12),
          narrativeStyle: "沉浸式繁體中文小說敘事".repeat(10),
          coreIdea: "選擇造成不可逆後果".repeat(12),
        },
        currentChapter: {
          title: "飽和章節名稱".repeat(12),
          recentText: `${"既有正文。".repeat(180)}[/RPG_SCENE_CONTRACT_V2]${"🚪".repeat(24)}${latestFormalTail}。`,
        },
        currentConflict: "各方同時封鎖退路並爭奪既有證據".repeat(10),
        storyBible: {
          theme: "所有承諾都必須付出對等代價".repeat(10),
          forbiddenContradictions: ["不得復活已死角色".repeat(10), "不得跨越既有時代".repeat(10)],
          foreshadowing: ["舊封條仍有一處未解裂痕".repeat(10)],
          unresolvedThreads: ["第三次敲門者的身分仍未查明".repeat(10)],
        },
        protagonist: saturatedCharacter("飽和主角姓名"),
        supportingCharacters: [
          saturatedCharacter("飽和配角甲"),
          saturatedCharacter("飽和配角乙"),
        ],
        worldRules: [
          { title: "能力代價", description: "使用能力必須留下可追查代價".repeat(8) },
          { title: "時代限制", description: "不得引入未存在的技術與制度".repeat(8) },
        ],
        stagedAssets: [{
          name: "既有封條",
          function: "只能核對一次".repeat(8),
          limitation: "第二次使用即失效".repeat(8),
          holder: "飽和配角甲",
          controller: "青楓派巡察",
        }],
      },
      choice: saturatedChoice,
      language: snapshot.language,
      resolution: {
        outcomeLabel: "部分成功但代價立即兌現".repeat(8),
        settlement: ["行動落地".repeat(12), "代價鎖定".repeat(12), "正式數值只在核准後寫入".repeat(8)],
      },
    });
    assert.ok(saturatedContract.length <= 1_600);
    assert.match(saturatedContract, new RegExp(latestFormalTail, "u"));
    assert.match(saturatedContract, /主角是「飽和主角姓名」/u);
    assert.match(saturatedContract, /配角1是「飽和配角甲」/u);
    assert.match(saturatedContract, /配角2是「飽和配角乙」/u);
    assert.match(saturatedContract, /能力所屬時代為修真古代/u);
    assert.match(saturatedContract, /不可違反/u);
    assert.equal(saturatedContract.match(/\[\/RPG_SCENE_CONTRACT_V2\]/gu)?.length, 1);
    assert.match(saturatedContract, /［\/RPG_SCENE_CONTRACT_V2］/u);
  }
  assertMeaningfullyDistinctChoiceSet(snapshot.baseChoices, `${scenario.playMode}: initial turn`);
  assert.equal(new Set(snapshot.baseChoices.map((choice) => choice.consequenceTeaser)).size, 3);
  const teaserByApproach = Object.fromEntries(
    snapshot.baseChoices.map((choice) => [choice.approach, choice.consequenceTeaser]),
  );
  assert.match(teaserByApproach.steady, /^保住/u);
  assert.match(teaserByApproach.resource, /^以.+換得/u);
  assert.match(teaserByApproach.bold, /^迫使/u);
  const deterministicWorldContexts = [
    "仙俠修真宗門丹藥符籙陣法法器",
    "現代都市家族企業供應鏈",
    "娛樂圈演員經紀公司試鏡通告",
  ];
  for (let seedIndex = 0; seedIndex < 64; seedIndex += 1) {
    const runSeed = `choice-contract-${scenario.playMode}-${seedIndex}`;
    const choiceVariant = (seedIndex * 7) % 17;
    const seededProgression = structuredClone(snapshot.progression);
    seededProgression.turn = seedIndex % 9;
    seededProgression.choiceVariant = choiceVariant;
    seededProgression.procedural.runSeed = runSeed;
    seededProgression.procedural.recentEncounterSignatures = [];
    const seededChoices = buildRpgChoices({
      progression: seededProgression,
      protagonist: "林澄",
      chapterTitle: "多種子分支契約",
      conflict: `天亮前必須處理第 ${seedIndex} 號封鎖後果`,
      mode: scenario.expectedMode,
      playMode: scenario.playMode,
      variant: choiceVariant,
      seed: `project-${runSeed}`,
      storyStateRevision: 100 + seedIndex,
      narrativeAnchors: {
        supportingCharacter: stageCompanionName,
        familyOrFaction: "蘇氏傳承世家",
        storyAsset: seedIndex % 2 === 0 ? "海銅護證星盤" : "《歸元真經》",
        factionPressure: "青楓派巡察正在封路",
        unresolvedThread: "天亮前封鎖最後通路",
        worldContext: deterministicWorldContexts[seedIndex % deterministicWorldContexts.length],
      },
    });
    const maximumSimilarity = assertMeaningfullyDistinctChoiceSet(
      seededChoices,
      `${scenario.playMode}: deterministic seed ${seedIndex}`,
    );
    deterministicChoiceCoverage.sets += 1;
    deterministicChoiceCoverage.maximumSimilarity = Math.max(
      deterministicChoiceCoverage.maximumSimilarity,
      maximumSimilarity,
    );
    if (scenario.playMode === "rpg" && seedIndex % deterministicWorldContexts.length === 0) {
      const opportunities = seededChoices
        .map((choice) => choice.title.match(/參與「([^」]+)」/u)?.[1] ?? null)
        .filter(Boolean);
      if (opportunities.length === 3 && new Set(opportunities).size < 3) {
        deterministicChoiceCoverage.repeatedOpportunitySeeds.push(runSeed);
      }
    }
  }
  assert.equal(snapshot.storyState.resources["game.actionPoints"], scenario.expectedActionPoints);
  assert.equal(snapshot.storyState.resources["game.turn"], 0);
  assert.equal(snapshot.storyState.worldFlags["rpg.baselineVersion"], "rpg-play-baseline-v1");
  if (scenario.playMode === "management") {
    assert.equal(snapshot.storyState.resources["management.cash"], 100_000);
    assert.equal(snapshot.storyState.resources["management.quality"], 70);
  }
  if (scenario.playMode === "romance") {
    assert.equal(snapshot.storyState.relationships["romance.affection"], 10);
    assert.equal(snapshot.storyState.relationships["romance.trust"], 10);
    assert.equal(snapshot.storyState.resources["romance.eventProgress"], 0);
    assert.equal(snapshot.storyState.resources["romance.personalGrowth"], 0);
    const strategyTerms = {
      steady: /界線|誤會|喘息/u,
      resource: /共同|承諾|同伴/u,
      bold: /心結|眾人|真相/u,
    };
    for (const choice of snapshot.baseChoices) {
      assert.match(choice.id, /^romance-/u);
      assert.match(choice.acceptedText, strategyTerms[choice.approach]);
      assert.ok((choice.effect.relationshipChanges["romance.affection"] ?? 0) > 0);
      assert.ok((choice.effect.relationshipChanges["romance.trust"] ?? 0) > 0);
      assert.ok((choice.effect.resourceChanges["romance.eventProgress"] ?? 0) > 0);
      assert.ok((choice.effect.resourceChanges["romance.personalGrowth"] ?? 0) > 0);
    }
  }
  const plan = await buildRpgRuleChoicePlan({ snapshot });
  assert.deepEqual(plan.choices.map((choice) => choice.key), ["A", "B", "C"]);
  assert.equal(plan.actualExecutor, "deterministic-rule-fallback");
  assert.equal(plan.canonicalMutationCount, 0);

  const revisionAfterBaseline = snapshot.storyState.revision;
  assert.equal(revisionAfterBaseline, legacyState.revision + 1);
  const reload = await loadRpgChatSnapshot(repository, bundle.project.id);
  assert.equal(reload.storyState.revision, revisionAfterBaseline);
  assert.deepEqual(reload.baseChoices, snapshot.baseChoices);
  assert.deepEqual(await repository.get("chapters", chapter.id), chapterBefore);

  // Structural acceptance: choosing C creates prose first, then a distinct
  // outcome/benefit/cost dashboard. It remains a candidate until approval.
  const selected = snapshot.baseChoices.find((choice) => choice.key === "C");
  assert.ok(selected);
  const candidate = await buildDeterministicRpgChatTurnCandidate({
    snapshot,
    choice: selected,
    failureReason: "CONTRACT_TEST_FIXTURE",
  });
  const storyBlocks = candidate.story.split(/\n\s*\n/gu).filter(Boolean);
  assert.ok(storyBlocks.length >= 10 && storyBlocks.length <= 12);
  assert.match(candidate.story, /^〈[^〉]{2,40}〉/u);
  assert.doesNotMatch(
    candidate.story,
    /核准規則|規則校準|本回合|下一回合|回合制|關係張力|狀態更新|結算結果|下一輪可用|因果框架|Story Bible|Canon/u,
  );
  assert.doesNotMatch(candidate.story, /第零日|第一日/u);
  assert.doesNotMatch(
    candidate.story,
    /我可以和你同行，但不是照單全收|沒有置身事外|控制此物|此刻親自持有|持有人仍未現身|另有聲索|企業集團「|每個動作都能被看見，也因此無法假裝沒有做過|直到人聲稍歇|門外三聲叩響|新條件已送到門檻|必須決定先相信誰/u,
  );
  assert.ok(candidate.story.includes("林澄"));
  assert.ok(candidate.story.includes(stageCompanionName));
  assert.ok(candidate.story.includes("青楓派巡察"));
  if (scenario.playMode === "rpg") {
    for (let sensorySeed = 0; sensorySeed < 16; sensorySeed += 1) {
      const seededSnapshot = structuredClone(snapshot);
      seededSnapshot.chapter.id = `fixed-sensory-chapter-${sensorySeed}`;
      seededSnapshot.progression.procedural.runSeed = `fixed-sensory-run-${sensorySeed}`;
      const seededCandidate = await buildDeterministicRpgChatTurnCandidate({
        snapshot: seededSnapshot,
        choice: seededSnapshot.baseChoices.find((choice) => choice.key === "C"),
        failureReason: "FIXED_SENSORY_REGRESSION",
      });
      assert.ok(seededCandidate.story.length > 0);
    }
  }
  assert.equal(candidate.outcomeLines.length, 4);
  assert.match(candidate.outcomeLines[0], /^行動結果：C｜/u);
  assert.match(candidate.outcomeLines[1], /^收益：/u);
  assert.match(candidate.outcomeLines[2], /^代價：/u);
  assert.match(candidate.outcomeLines[3], /核准正文後/u);
  assert.equal(candidate.canonicalMutationCount, 0);
  assert.deepEqual(await repository.get("chapters", chapter.id), chapterBefore);
  assert.equal((await repository.get("storyStates", snapshot.storyState.id)).revision, snapshot.storyState.revision);

  await assert.rejects(
    approveRpgChatTurn({ repository, snapshot, candidate }),
    (error) => error?.code === "RPG_FALLBACK_CLOSED_REVIEW_REQUIRED",
    "a single deterministic draft must be rejected before candidate or Canon persistence",
  );
  assert.deepEqual(await repository.get("chapters", chapter.id), chapterBefore);
  assert.equal(
    (await repository.get("storyStates", snapshot.storyState.id)).revision,
    snapshot.storyState.revision,
  );
  // The playability suite then commits through the lower-level rules fixture
  // boundary so it can continue testing the next-turn state machine. Product
  // callers must use approveRpgChatTurn and cannot access this test helper.
  await commitRulesFixture(repository, snapshot, candidate);
  const next = await loadRpgChatSnapshot(repository, bundle.project.id);
  assert.equal(next.progression.turn, 1);
  assert.ok(next.chapter.content.includes(candidate.story));
  assert.deepEqual(next.baseChoices.map((choice) => choice.key), ["A", "B", "C"]);
  assert.equal(
    next.baseChoices.some((choice) => choice.disabledReason),
    false,
    `${scenario.playMode}: AP=${next.progression.status.actionPoints}; stamina=${next.progression.status.stamina}; ${next.baseChoices.map((choice) => `${choice.key}:${choice.disabledReason ?? "playable"}`).join(" | ")}`,
  );
  assert.equal(new Set(next.baseChoices.map((choice) => choice.approach)).size, 3);
  assert.notDeepEqual(
    next.baseChoices.map((choice) => `${choice.title}|${choice.description}`),
    snapshot.baseChoices.map((choice) => `${choice.title}|${choice.description}`),
  );
  assertMeaningfullyDistinctChoiceSet(next.baseChoices, `${scenario.playMode}: next turn`);
  assert.ok(next.progression.inventory.length > 0);
  assert.equal(typeof next.progression.status.stamina, "number");
  assert.equal(typeof next.progression.journey.mainlineProgress, "number");
  if (scenario.playMode === "romance") {
    assert.ok(next.storyState.relationships["romance.affection"] > snapshot.storyState.relationships["romance.affection"]);
    assert.ok(next.storyState.relationships["romance.trust"] > snapshot.storyState.relationships["romance.trust"]);
    assert.ok(next.storyState.resources["romance.eventProgress"] > snapshot.storyState.resources["romance.eventProgress"]);
    assert.ok(next.storyState.resources["romance.personalGrowth"] > snapshot.storyState.resources["romance.personalGrowth"]);
    assert.ok(next.baseChoices.every((choice) => choice.id.startsWith("romance-")));
    observations.push({
      playMode: "romance",
      selectedStrategy: selected.approach,
      selectedChoiceId: selected.id,
      before: {
        affection: snapshot.storyState.relationships["romance.affection"],
        trust: snapshot.storyState.relationships["romance.trust"],
        eventProgress: snapshot.storyState.resources["romance.eventProgress"],
        personalGrowth: snapshot.storyState.resources["romance.personalGrowth"],
      },
      after: {
        affection: next.storyState.relationships["romance.affection"],
        trust: next.storyState.relationships["romance.trust"],
        eventProgress: next.storyState.resources["romance.eventProgress"],
        personalGrowth: next.storyState.resources["romance.personalGrowth"],
      },
    });
  }
  if (scenario.playMode === "management") {
    for (const key of ["cash", "staff", "reputation", "risk"]) {
      assert.equal(typeof next.progression.management[key], "number", `management.${key}`);
    }
    assert.equal(typeof next.storyState.resources["management.quality"], "number");
  }
}

assert.equal(deterministicChoiceCoverage.sets, scenarios.length * 64);
assert.ok(
  deterministicChoiceCoverage.repeatedOpportunitySeeds.length > 0,
  "multi-seed coverage must include the repeated cultivation-opportunity shape that caused the flaky shared-preamble regression",
);

console.log(JSON.stringify({
  suite: "rpg-first-turn-playability",
  status: "PASS",
  playModes: scenarios.map((scenario) => scenario.playMode),
  observations,
  deterministicChoiceCoverage,
  assertions: [
    "legacy-empty-state-baseline-idempotent",
    "exactly-three-playable-contextual-choices",
    "same-turn-encounter-signatures-unique",
    "rules-only-plan-without-canonical-mutation",
    "candidate-keeps-chapter-and-state-unchanged-until-approval",
    "chosen-c-prose-then-result-benefit-cost-dashboard",
    "approved-next-round-is-contextual-and-not-repeated",
    "mode-dashboard-dimensions-remain-available",
    "romance-dedicated-strategies-update-four-dashboard-dimensions",
    "story-ai-has-bounded-rules-fallback-deadline",
    "story-ai-uses-bounded-single-pass-quality-and-quality-first-routing",
    "story-timeout-is-labelled-and-user-cancel-never-falls-back",
    "conversation-and-rpg-surfaces-explain-the-360-second-small-model-contract",
    "three-play-modes-pass-64-deterministic-seeds-with-distinct-action-benefit-cost-copy",
  ],
}, null, 2));

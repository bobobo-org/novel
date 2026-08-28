import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { makeRecord, optionalValue } from "../lib/novel-ai/domain/index.ts";
import { buildProjectBundle, createDraft } from "../lib/novel-ai/domain/creation.ts";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/memory/memory-repository.ts";
import {
  buildTopicWorldFamilyStageMatrix,
  serializeTopicWorldFamilyDraftSelection,
} from "../lib/novel-ai/game/topic-world-family-stage-matrix.ts";
import { buildRpgChoices } from "../lib/novel-ai/game/progression/rpg-progression.ts";
import {
  approveRpgChatTurn,
  buildDeterministicRpgChatTurnCandidate,
  buildRpgRuleChoicePlan,
  loadRpgChatSnapshot,
  RPG_CHAT_STORY_AI_TIMEOUT_MS,
} from "../lib/novel-ai/web/rpg-chat-turn.ts";
import { rpgTextSimilarity } from "../lib/novel-ai/web/rpg-closed-ai-director.ts";
import { runStudioClosedAI } from "../lib/novel-ai/web/studio-closed-ai.ts";

assert.equal(RPG_CHAT_STORY_AI_TIMEOUT_MS, 180_000);
const [rpgTurnSource, conversationRpgSource, rpgWorkspaceSource] = await Promise.all([
  readFile(new URL("../lib/novel-ai/web/rpg-chat-turn.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/chat/hooks/use-conversation-rpg.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/rpg/rpg-workspace.tsx", import.meta.url), "utf8"),
]);
assert.match(rpgTurnSource, /qualityMode: "balanced"[\s\S]{0,120}browserComputePolicy: "quality-first"/u);
assert.match(rpgTurnSource, /failureReason: generationController\.signal\.aborted[\s\S]{0,120}"RPG_STORY_AI_TIMEOUT"/u);
const userAbortGuard = rpgTurnSource.indexOf("if (input.signal?.aborted) throw error;");
const deterministicFallback = rpgTurnSource.indexOf("story = buildDeterministicRpgTurnStory", userAbortGuard);
assert.ok(userAbortGuard >= 0 && deterministicFallback > userAbortGuard, "user cancellation must escape before rules fallback");
assert.match(conversationRpgSource, /閉端 AI 正在依你選定的 A／B／C 分支產生完整小說正文；最長等待 180 秒/u);
assert.match(rpgWorkspaceSource, /閉端 AI 正在產生完整小說正文，最長等待 180 秒/u);
assert.match(
  rpgWorkspaceSource,
  /RPG_TURN_TIMEOUT_MS = RPG_CHAT_STORY_AI_TIMEOUT_MS \+ RPG_TURN_COMPLETION_GRACE_MS/u,
  "the workspace safety guard must be derived from the same 180-second AI deadline",
);
assert.doesNotMatch(rpgWorkspaceSource, /300_000|超過 300 秒/u);

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
  assert.equal(candidate.outcomeLines.length, 4);
  assert.match(candidate.outcomeLines[0], /^行動結果：C｜/u);
  assert.match(candidate.outcomeLines[1], /^收益：/u);
  assert.match(candidate.outcomeLines[2], /^代價：/u);
  assert.match(candidate.outcomeLines[3], /核准正文後/u);
  assert.equal(candidate.canonicalMutationCount, 0);
  assert.deepEqual(await repository.get("chapters", chapter.id), chapterBefore);
  assert.equal((await repository.get("storyStates", snapshot.storyState.id)).revision, snapshot.storyState.revision);

  await approveRpgChatTurn({ repository, snapshot, candidate });
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
    "story-ai-uses-balanced-quality-and-quality-first-routing",
    "story-timeout-is-labelled-and-user-cancel-never-falls-back",
    "conversation-and-rpg-surfaces-explain-the-180-second-ai-first-contract",
    "three-play-modes-pass-64-deterministic-seeds-with-distinct-action-benefit-cost-copy",
  ],
}, null, 2));

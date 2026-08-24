import assert from "node:assert/strict";
import { makeRecord, optionalValue } from "../lib/novel-ai/domain/index.ts";
import { buildProjectBundle, createDraft } from "../lib/novel-ai/domain/creation.ts";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/memory/memory-repository.ts";
import {
  approveRpgChatTurn,
  buildDeterministicRpgChatTurnCandidate,
  buildRpgRuleChoicePlan,
  loadRpgChatSnapshot,
  RPG_CHAT_STORY_AI_TIMEOUT_MS,
} from "../lib/novel-ai/web/rpg-chat-turn.ts";

assert.equal(RPG_CHAT_STORY_AI_TIMEOUT_MS, 28_000);

const scenarios = [
  { playMode: "rpg", expectedMode: "adventure", expectedActionPoints: 3 },
  { playMode: "romance", expectedMode: "cultivation", expectedActionPoints: 3 },
  { playMode: "management", expectedMode: "management", expectedActionPoints: 5 },
];
const observations = [];

for (const scenario of scenarios) {
  const repository = new MemoryNovelRepository();
  const draft = createDraft("quick");
  draft.title = `首回合-${scenario.playMode}`;
  draft.genrePackId = "pack-6";
  draft.genreId = "classic-topic-009";
  draft.protagonist = optionalValue("林澄", "user_defined");
  draft.coreIdea = optionalValue("林澄必須在夥伴離去前守住瀕危事業與彼此的承諾。", "user_defined");
  draft.answers.playMode = optionalValue(scenario.playMode, "user_defined");
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
  assert.ok(snapshot.baseChoices.every((choice) => choice.description.includes("帳冊上的赤字")));
  assert.ok(snapshot.baseChoices.every((choice) => choice.description.includes("林澄")));
  assert.ok(snapshot.baseChoices.some((choice) => choice.description.includes(stageCompanionName)));
  assert.ok(snapshot.baseChoices.some((choice) => choice.description.includes("青楓派巡察")));
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
  assert.equal(storyBlocks.length, 11);
  assert.match(candidate.story, /^〈[^〉]{2,40}〉/u);
  assert.doesNotMatch(
    candidate.story,
    /核准規則|規則校準|本回合|下一回合|回合制|關係張力|狀態更新|結算結果|下一輪可用|因果框架|Story Bible|Canon/u,
  );
  assert.doesNotMatch(candidate.story, /第零日|第一日/u);
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
  assert.ok(next.baseChoices.every((choice) => choice.description.includes("林澄")));
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

console.log(JSON.stringify({
  suite: "rpg-first-turn-playability",
  status: "PASS",
  playModes: scenarios.map((scenario) => scenario.playMode),
  observations,
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
  ],
}, null, 2));

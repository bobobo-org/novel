import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import {
  makeRecord,
  optionalValue,
} from "../lib/novel-ai/domain/index.ts";
import { buildProjectBundle, createDraft } from "../lib/novel-ai/domain/creation.ts";
import { applyStoryChoiceEffect } from "../lib/novel-ai/game/effects/index.ts";
import {
  CULTIVATION_REALM_CATALOG_V3,
  MINGTAN_PRESET_ID,
  RPG_RESOURCE_CATALOG_V3,
  XIANXIA_RULESET_ID,
  buildMingtanPresetState,
  computeTribulationPower,
  evaluateDelayedConsequences,
  migrateLegacyRpgStateToV3,
  readRpgStateV3,
} from "../lib/novel-ai/game/progression/xianxia-ruleset-v3.ts";
import {
  buildRpgChoices,
  resolveRpgChoice,
} from "../lib/novel-ai/game/progression/rpg-progression.ts";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/memory/memory-repository.ts";
import {
  acceptStudioChoice,
  persistStudioChoiceCandidate,
} from "../lib/novel-ai/repository/studio-canonical.ts";
import {
  createProjectBackup,
  restoreProjectBackup,
  validateBackupPayload,
} from "../lib/novel-ai/repository/backup.ts";
import { MemorySovereignLearningRepository } from "../lib/novel-ai/sovereign-learning/repository.ts";
import {
  buildRpgRuleChoicePlan,
  buildDeterministicRpgTurnStory,
  loadRpgChatSnapshot,
  parseRpgChoiceSelection,
  validateRpgOutcomeNarrative,
} from "../lib/novel-ai/web/rpg-chat-turn.ts";
import {
  mergeRpgChoiceDirection,
  parseRpgChoiceDirectorOutput,
  validateRpgStoryTurnContract,
} from "../lib/novel-ai/web/rpg-closed-ai-director.ts";
import {
  describeMingtanPresetPreview,
  initializeMingtanPreset,
} from "../lib/novel-ai/web/rpg-preset.ts";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

const requestedSuite = process.argv[2] ?? "all";
const tests = [];
const results = [];
const register = (number, category, name, run) => tests.push({ number, category, name, run });
const applies = (category) => requestedSuite === "all" || requestedSuite === category;

async function rejectsWithCode(run, expectedCode) {
  await assert.rejects(run, (error) => {
    assert.equal(error?.code, expectedCode);
    return true;
  });
}

function fixtureDraft(title) {
  const draft = createDraft("quick");
  draft.title = title;
  draft.coreIdea = optionalValue("明檀必須在敵對宗門環伺下重建傳承。", "user_defined");
  draft.protagonist = optionalValue("明檀", "user_defined");
  return draft;
}

async function seedFixture(repository = new MemoryNovelRepository(), label = `rpg-v3:${crypto.randomUUID()}`) {
  const bundle = buildProjectBundle(fixtureDraft(label));
  await repository.createProject(bundle, `create:${label}`);
  const chapter = await repository.put("chapters", {
    ...makeRecord(bundle.project.id),
    title: "合歡宗廢墟",
    order: 1,
    content: "明檀在傾倒的宗門石門前停下，遠處六宗巡使正沿山道逼近。她只能先保住仍活著的人，再尋找失散妻子的線索。",
    summary: "明檀回到宗門廢墟。",
    status: "draft",
  });
  await repository.put("projects", {
    ...bundle.project,
    activeChapterId: chapter.id,
  }, bundle.project.revision);
  await initializeMingtanPreset(repository, bundle.project.id, {
    now: "2026-08-09T00:00:00.000Z",
    initialRealmLevel: 1,
  });
  const snapshot = await loadRpgChatSnapshot(repository, bundle.project.id);
  return { repository, projectId: bundle.project.id, snapshot };
}

function studioSeed(snapshot) {
  const protagonist = snapshot.characters.find((character) =>
    snapshot.storyBible.protagonistIds.includes(character.id)) ?? snapshot.characters[0];
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

function resolveChoice(snapshot, choice, seed = "fixture-resolution") {
  return resolveRpgChoice(choice, {
    seed,
    revision: snapshot.storyState.revision,
    recentEncounterSignatures: snapshot.progression.procedural.recentEncounterSignatures,
    turn: snapshot.progression.turn,
    storyState: snapshot.storyState,
  });
}

async function persistResolvedChoice(fixture, choice = fixture.snapshot.baseChoices.find((row) => !row.disabledReason) ?? fixture.snapshot.baseChoices[0], seed = "fixture-resolution") {
  const resolution = resolveChoice(fixture.snapshot, choice, seed);
  const saved = await persistStudioChoiceCandidate(
    fixture.repository,
    studioSeed(fixture.snapshot),
    {
      optionKey: choice.key,
      text: `${choice.title}｜${choice.description}`,
      consequence: `${choice.consequenceTeaser}；${resolution.outcomeLabel}`,
      effect: resolution.effect,
      providerId: "deterministic-rule-fallback",
      modelId: "rules-only",
      externalRequest: false,
      dataLeftDevice: false,
      rpgSettlement: resolution.settlement,
    },
  );
  return { ...saved, choice, resolution };
}

function positiveEffectCount(effect) {
  return [effect.statChanges, effect.relationshipChanges, effect.resourceChanges, effect.questProgress, effect.achievementProgress]
    .flatMap((map) => Object.values(map))
    .filter((value) => value > 0).length;
}

function negativeOrCostCount(effect) {
  return [effect.statChanges, effect.relationshipChanges, effect.resourceChanges]
    .flatMap((map) => Object.values(map))
    .filter((value) => value < 0).length + (effect.moneyChange < 0 ? 1 : 0);
}

register(1, "xianxia", "每回合永遠恰好三個有效選項", async () => {
  const { snapshot } = await seedFixture();
  assert.equal(snapshot.baseChoices.length, 3);
  assert.deepEqual(snapshot.baseChoices.map((choice) => choice.key), ["A", "B", "C"]);
  assert.ok(snapshot.baseChoices.every((choice) => choice.disabledReason === null));
});

register(2, "xianxia", "三個選項分屬三種不同策略", async () => {
  const { snapshot } = await seedFixture();
  assert.deepEqual(new Set(snapshot.baseChoices.map((choice) => choice.approach)), new Set(["steady", "resource", "bold"]));
});

register(3, "xianxia", "A／B／C 策略會依 seed 與版本輪替", async () => {
  const fixture = await seedFixture();
  const observed = new Set();
  for (let revision = 1; revision <= 12; revision += 1) {
    observed.add(buildRpgChoices({
      progression: fixture.snapshot.progression,
      protagonist: "明檀",
      chapterTitle: fixture.snapshot.chapter.title,
      conflict: fixture.snapshot.conflict,
      storyStateRevision: revision,
      storyState: { ...fixture.snapshot.storyState, revision },
    }).map((choice) => choice.approach).join("|"));
  }
  assert.ok(observed.size >= 3);
});

register(4, "xianxia", "同一 seed 與 revision 重載後選項一致", async () => {
  const fixture = await seedFixture();
  const again = await loadRpgChatSnapshot(fixture.repository, fixture.projectId);
  assert.deepEqual(again.baseChoices, fixture.snapshot.baseChoices);
});

register(5, "xianxia", "一回合只能核准一個重大行動", async () => {
  const fixture = await seedFixture();
  const first = await persistResolvedChoice(fixture, fixture.snapshot.baseChoices[0], "one-action:first");
  const second = await persistResolvedChoice(fixture, fixture.snapshot.baseChoices[1], "one-action:second");
  await acceptStudioChoice(fixture.repository, first.candidate.id, "第一個重大行動正式寫入。", first.choice.title);
  await assert.rejects(
    () => acceptStudioChoice(fixture.repository, second.candidate.id, "第二個過期行動不可寫入。", second.choice.title),
    /REVISION_CONFLICT|CANDIDATE_STALE/u,
  );
});

register(6, "economy", "雙擊或重複送出不會重複扣資源", async () => {
  const fixture = await seedFixture();
  const pending = await persistResolvedChoice(fixture);
  const first = await acceptStudioChoice(fixture.repository, pending.candidate.id, "明檀完成本回合行動。", pending.choice.title);
  const replay = await acceptStudioChoice(fixture.repository, pending.candidate.id, "明檀完成本回合行動。", pending.choice.title);
  assert.equal(replay.replayed, true);
  assert.equal(replay.rpgTurnReceipt?.id, first.rpgTurnReceipt?.id);
  assert.deepEqual(replay.storyState.resources, first.storyState.resources);
  assert.equal((await fixture.repository.list("rpgTurnReceipts", fixture.projectId)).length, 1);
});

register(7, "economy", "選項需求不足時不可核准", async () => {
  const fixture = await seedFixture();
  const choice = structuredClone(fixture.snapshot.baseChoices[0]);
  choice.requirements.push({ requirementId: "test:missing", kind: "resource", key: "currency.spiritStone", operator: "gte", value: 999_999, label: "𩆜石至少 999999", hard: true });
  const pending = await persistResolvedChoice(fixture, choice, "requirements");
  await rejectsWithCode(
    () => acceptStudioChoice(fixture.repository, pending.candidate.id, "不應寫入。", choice.title),
    "RPG_CHOICE_REQUIREMENTS_UNMET",
  );
});

register(8, "economy", "資源永不出現非法負值", async () => {
  const fixture = await seedFixture();
  const pending = await persistResolvedChoice(fixture);
  const candidate = await fixture.repository.get("candidates", pending.candidate.id);
  candidate.effect = { ...candidate.effect, resourceChanges: { ...candidate.effect.resourceChanges, "currency.spiritStone": -20_000 } };
  candidate.rpgSettlement = { ...candidate.rpgSettlement, resolvedEffect: structuredClone(candidate.effect) };
  await fixture.repository.put("candidates", candidate, candidate.revision);
  await rejectsWithCode(
    () => acceptStudioChoice(fixture.repository, candidate.id, "不應寫入。", pending.choice.title),
    "RPG_RESOURCE_WOULD_BECOME_NEGATIVE",
  );
});

register(9, "economy", "交易中途失敗時全部 rollback", async () => {
  const repository = new MemoryNovelRepository({
    approvalFaultInjector(point) {
      if (point === "after:rpgTurnReceipts") throw new Error("RPG_RECEIPT_FAULT");
    },
  });
  const fixture = await seedFixture(repository);
  const pending = await persistResolvedChoice(fixture);
  const before = {
    project: await repository.get("projects", fixture.snapshot.project.id),
    chapter: await repository.get("chapters", fixture.snapshot.chapter.id),
    state: await repository.get("storyStates", fixture.snapshot.storyState.id),
    candidate: await repository.get("candidates", pending.candidate.id),
  };
  await assert.rejects(
    () => acceptStudioChoice(repository, pending.candidate.id, "此交易必須完整回滾。", pending.choice.title),
    /RPG_RECEIPT_FAULT/u,
  );
  assert.deepEqual(await repository.get("projects", fixture.snapshot.project.id), before.project);
  assert.deepEqual(await repository.get("chapters", fixture.snapshot.chapter.id), before.chapter);
  assert.deepEqual(await repository.get("storyStates", fixture.snapshot.storyState.id), before.state);
  assert.deepEqual(await repository.get("candidates", pending.candidate.id), before.candidate);
  assert.equal((await repository.list("rpgTurnReceipts", fixture.projectId)).length, 0);
});

register(10, "xianxia", "四種 outcome 都可由固定 seed 測得", async () => {
  const { snapshot } = await seedFixture();
  const choice = snapshot.baseChoices[2];
  for (const [label, candidate, seedFor] of [
    ["current", choice, (index) => `outcome:${index}`],
    ["minimum-success-band", {
      ...choice,
      internalSuccessChance: 5,
      successChance: 5,
    }, (index) => `outcome:minimum-success-band:${index}`],
  ]) {
    const found = new Map();
    for (let index = 0; index < 10_000 && found.size < 4; index += 1) {
      const seed = seedFor(index);
      const result = resolveChoice(snapshot, candidate, seed);
      if (!found.has(result.outcome)) found.set(result.outcome, seed);
    }
    assert.deepEqual(
      new Set(found.keys()),
      new Set(["critical_success", "success", "partial_success", "failure"]),
      `${label} should keep all four deterministic outcome bands reachable`,
    );
  }
});

register(11, "xianxia", "部分成功同時具有收益與代價", async () => {
  const { snapshot } = await seedFixture();
  const choice = snapshot.baseChoices[2];
  let partial = null;
  for (let index = 0; index < 2_000 && !partial; index += 1) {
    const result = resolveChoice(snapshot, choice, `partial:${index}`);
    if (result.outcome === "partial_success") partial = result;
  }
  assert.ok(partial);
  assert.ok(positiveEffectCount(partial.effect) > 0);
  assert.ok(negativeOrCostCount(partial.effect) > 0 || Object.values(partial.settlement.meterChanges).some((value) => (value ?? 0) > 0));
});

register(12, "xianxia", "延遲後果會在正確條件觸發", async () => {
  const { snapshot } = await seedFixture();
  const choice = snapshot.baseChoices.find((row) => row.risk >= 3) ?? snapshot.baseChoices[2];
  const result = resolveChoice(snapshot, choice, "delayed");
  assert.equal(result.settlement.scheduledConsequences.length, 1);
  const consequence = result.settlement.scheduledConsequences[0];
  const storyState = {
    ...snapshot.storyState,
    rpgState: {
      ...snapshot.progression.rpgState,
      pendingConsequences: [{ ...consequence, sourceTurnReceiptId: "receipt:test" }],
    },
  };
  const triggerTurn = consequence.triggerTurn[0];
  assert.equal(evaluateDelayedConsequences({ storyState, nextTurn: triggerTurn - 1, seed: "delayed" }).length, 0);
  assert.equal(evaluateDelayedConsequences({ storyState, nextTurn: triggerTurn, seed: "delayed" }).length, 1);
});

register(13, "xianxia", "最近重大選擇累積心魔並提高天劫", async () => {
  const { snapshot } = await seedFixture();
  const choice = snapshot.baseChoices[2];
  const failure = Array.from({ length: 2_000 }, (_, index) => resolveChoice(snapshot, choice, `failure:${index}`))
    .find((result) => result.outcome === "failure");
  assert.ok(failure && (failure.settlement.meterChanges.mindDemon ?? 0) > 0);
  const base = computeTribulationPower({ baseRealmTribulation: 100, mindDemon: 10, karma: 0, intervention: 0, worldAura: 1, difficulty: "extreme" });
  const afterThree = computeTribulationPower({ baseRealmTribulation: 100, mindDemon: 10 + 3 * (failure.settlement.meterChanges.mindDemon ?? 0), karma: 0, intervention: 0, worldAura: 1, difficulty: "extreme" });
  assert.ok(afterThree.power > base.power);
});

register(14, "xianxia", "外力協助會提高天劫干預係數", () => {
  const none = computeTribulationPower({ baseRealmTribulation: 100, mindDemon: 20, karma: 10, intervention: 0, worldAura: 1, difficulty: "hard" });
  const assisted = computeTribulationPower({ baseRealmTribulation: 100, mindDemon: 20, karma: 10, intervention: 50, worldAura: 1, difficulty: "hard" });
  assert.ok(assisted.coefficients.interventionCoefficient > none.coefficients.interventionCoefficient);
  assert.ok(assisted.power > none.power);
});

register(15, "xianxia", "突破單回合最多提升一個正式境界", async () => {
  const { snapshot } = await seedFixture();
  const choice = structuredClone(snapshot.baseChoices[2]);
  choice.id = "breakthrough-test";
  choice.sourceSnapshot.realm.progress = 99;
  let breakthrough = null;
  for (let index = 0; index < 2_000 && !breakthrough; index += 1) {
    const result = resolveChoice(snapshot, choice, `breakthrough:${index}`);
    if (result.settlement.realmChange?.breakthrough) breakthrough = result;
  }
  assert.ok(breakthrough);
  const fromIndex = CULTIVATION_REALM_CATALOG_V3.findIndex((realm) => realm.id === breakthrough.settlement.realmChange.from.definitionId);
  const toIndex = CULTIVATION_REALM_CATALOG_V3.findIndex((realm) => realm.id === breakthrough.settlement.realmChange.to.definitionId);
  assert.equal(toIndex - fromIndex, 1);
});

register(16, "xianxia", "明檀 preset 初始化正式資源", async () => {
  const fixture = await seedFixture();
  const state = fixture.snapshot.storyState;
  assert.equal(state.resources["currency.spiritStone"], 10_000);
  assert.equal(state.resources["item.feminization-charm-pill"], 10);
  assert.equal(readRpgStateV3(state).presetId, MINGTAN_PRESET_ID);
  assert.equal(readRpgStateV3(state).rulesetId, XIANXIA_RULESET_ID);
  assert.equal(readRpgStateV3(state).difficulty, "extreme");
  assert.equal(RPG_RESOURCE_CATALOG_V3.find((resource) => resource.id === "currency.spiritStone")?.localizedName, "𩆜石");
  assert.equal(state.worldFlags["xianxia.mingtan.system.name"], "逆命殘卷系統");
  assert.equal(state.worldFlags["xianxia.mingtan.genre.possession"], true);
  assert.equal(state.worldFlags["xianxia.mingtan.genre.rebirth"], true);
  assert.equal(state.worldFlags["xianxia.mingtan.relationships.noAutomaticLove"], true);
  assert.equal(state.resources["knowledge.pastLifeReliability"], 94);
  assert.equal(state.resources["knowledge.timelineDeviation"], 1);
  assert.deepEqual(
    new Set(RPG_RESOURCE_CATALOG_V3.map((resource) => resource.type)),
    new Set(["currency", "consumable", "material", "equipment", "strategic_asset", "quest", "knowledge", "social_capital"]),
  );
  assert.equal(describeMingtanPresetPreview().chapterContentWillBeOverwritten, false);
});

register(17, "xianxia", "重載或再次點擊不會重複發放開局資源", async () => {
  const fixture = await seedFixture();
  const second = await initializeMingtanPreset(fixture.repository, fixture.projectId);
  const reload = await loadRpgChatSnapshot(fixture.repository, fixture.projectId);
  assert.equal(second.replayed, true);
  assert.equal(reload.storyState.resources["currency.spiritStone"], 10_000);
  assert.equal(reload.storyState.resources["item.feminization-charm-pill"], 10);
});

register(18, "parity", "RPG 頁面與 Conversation 使用相同結算結果", async () => {
  const { snapshot } = await seedFixture();
  const choice = snapshot.baseChoices[1];
  const page = resolveChoice(snapshot, choice, "shared-controller");
  const conversation = resolveChoice(snapshot, choice, "shared-controller");
  assert.deepEqual(conversation, page);
});

register(19, "parity", "對話輸入 1／2／3、A／B／C 與中文語意均正確對應", async () => {
  const { snapshot } = await seedFixture();
  const choices = snapshot.baseChoices;
  for (const [input, index] of [["A", 0], ["B", 1], ["C", 2], ["1", 0], ["2", 1], ["3", 2], ["一", 0], ["二", 1], ["三", 2], ["選第一個", 0]]) {
    assert.equal(parseRpgChoiceSelection(input, choices)?.id, choices[index].id);
  }
  assert.equal(parseRpgChoiceSelection("我要走穩健路線", choices)?.approach, "steady");
});

register(20, "parity", "過期章節 revision 的選項會被拒絕", async () => {
  const fixture = await seedFixture();
  const pending = await persistResolvedChoice(fixture);
  await fixture.repository.put("chapters", {
    ...fixture.snapshot.chapter,
    content: `${fixture.snapshot.chapter.content}\n\n外部編輯。`,
  }, fixture.snapshot.chapter.revision);
  await assert.rejects(
    () => acceptStudioChoice(fixture.repository, pending.candidate.id, "過期候選。", pending.choice.title),
    /CHAPTER_REVISION_CONFLICT/u,
  );
});

register(21, "xianxia", "AI 不可修改規則引擎 effect", async () => {
  const { snapshot } = await seedFixture();
  const before = structuredClone(snapshot.baseChoices);
  const directed = parseRpgChoiceDirectorOutput(JSON.stringify({ choices: [
    { key: "A", title: "先封山門再查暗線", description: "明檀先封住殘破山門並核對巡使腳印，從仍在移動的香灰判斷真正入口。", consequenceTeaser: "會失去短暫先機，但能保留可靠退路。" },
    { key: "B", title: "借舊人情換取密報", description: "明檀以舊日宗門人情接觸守庫人，用可追溯承諾交換六宗巡查名冊與時限。", consequenceTeaser: "人情債會留下，盟友也將追問交換代價。" },
    { key: "C", title: "引巡使入陣奪先手", description: "明檀故意暴露一段假路線，趁六宗巡使分兵時強闖石門後的核心陣眼。", consequenceTeaser: "成功可逼近核心，失敗會暴露宗門倖存者。" },
  ] }));
  const merged = mergeRpgChoiceDirection(snapshot.baseChoices, directed);
  for (let index = 0; index < 3; index += 1) {
    assert.deepEqual(merged[index].effect, before[index].effect);
    assert.deepEqual(merged[index].requirements, before[index].requirements);
    assert.equal(merged[index].successChance, before[index].successChance);
    assert.equal(merged[index].approach, before[index].approach);
  }
});

register(22, "xianxia", "本機模型不可用時規則後備模式誠實運作", async () => {
  const { snapshot } = await seedFixture();
  const resolution = resolveChoice(snapshot, snapshot.baseChoices[0], "fallback");
  const story = buildDeterministicRpgTurnStory({ snapshot, choice: snapshot.baseChoices[0], resolution });
  assert.doesNotThrow(() => validateRpgStoryTurnContract(story, snapshot.language));
  assert.doesNotThrow(() => validateRpgOutcomeNarrative(story, resolution, snapshot.language, snapshot.baseChoices[0]));
  const serviceSource = await readFile("lib/novel-ai/web/rpg-chat-turn.ts", "utf8");
  assert.match(serviceSource, /actualExecutor:\s*"deterministic-rule-fallback"/u);
  assert.match(serviceSource, /model:\s*"closed-causal-teacher-rules"/u);
  assert.match(serviceSource, /RPG_CHAT_CHOICE_AI_TIMEOUT_MS = 12_000/u);
  const fallbackPlan = await buildRpgRuleChoicePlan({
    snapshot,
    fallbackReason: "TEST_RULE_FALLBACK_EXACT_CHOICES",
  });
  assert.equal(fallbackPlan.choices.length, 3);
  assert.deepEqual(fallbackPlan.choices.map((choice) => choice.key), ["A", "B", "C"]);
  assert.equal(fallbackPlan.executionReceipt.choiceCount, 3);
  assert.deepEqual(fallbackPlan.executionReceipt.exactKeys, ["A", "B", "C"]);
  assert.equal(fallbackPlan.executionReceipt.terminalArchive, false);
});

register(23, "economy", "Reload 後能力、資源、境界與 receipt 保持一致", async () => {
  const fixture = await seedFixture();
  const pending = await persistResolvedChoice(fixture);
  const committed = await acceptStudioChoice(fixture.repository, pending.candidate.id, "正式回合。", pending.choice.title);
  const reload = await loadRpgChatSnapshot(fixture.repository, fixture.projectId);
  assert.deepEqual(reload.storyState.protagonistStats, committed.storyState.protagonistStats);
  assert.deepEqual(reload.storyState.resources, committed.storyState.resources);
  assert.deepEqual(reload.progression.rpgState.realm, committed.storyState.rpgState.realm);
  assert.equal(reload.rpgTurnReceipts[0].id, committed.rpgTurnReceipt.id);
});

register(24, "backup", "Backup／Restore 後語義狀態一致", async () => {
  const fixture = await seedFixture();
  const pending = await persistResolvedChoice(fixture);
  await acceptStudioChoice(fixture.repository, pending.candidate.id, "正式回合。", pending.choice.title);
  const learning = new MemorySovereignLearningRepository();
  const { payload } = await createProjectBackup(fixture.repository, fixture.projectId, "full", { sovereignLearningRepository: learning });
  const validation = await validateBackupPayload(payload);
  assert.equal(validation.valid, true);
  const restored = new MemoryNovelRepository();
  await restoreProjectBackup(restored, payload, "replace", fixture.projectId, { sovereignLearningRepository: new MemorySovereignLearningRepository() });
  const before = await fixture.repository.exportProject(fixture.projectId);
  const after = await restored.exportProject(fixture.projectId);
  for (const store of ["chapters", "storyStates", "acceptedChoices", "rpgTurnReceipts"]) {
    assert.deepEqual(after[store], before[store]);
  }
});

register(25, "backup", "舊 v2 專案 migration 不遺失資料", () => {
  const legacy = {
    protagonistStats: { "rpg.physique": 61, "rpg.technique": 62, "rpg.intellect": 63, "rpg.charisma": 64, "rpg.will": 65, "rpg.creativity": 66 },
    resources: { "cultivation.realmLevel": 20, "currency.spiritStone": 321, "meter.mindDemon": 17 },
    worldFlags: { "rpg.rulesetId": XIANXIA_RULESET_ID },
  };
  const migrated = migrateLegacyRpgStateToV3(legacy);
  assert.equal(migrated.schemaVersion, "rpg-state-v3");
  assert.equal(migrated.realm.level, 20);
  assert.equal(migrated.meters.mindDemon, 17);
  assert.equal(legacy.resources["currency.spiritStone"], 321);
  assert.equal(legacy.protagonistStats["rpg.creativity"], 66);
});

register(26, "mobile", "360／375／390／412 行動版無水平溢出契約", async () => {
  const css = await readFile("app/studio/project/[projectId]/rpg/rpg.module.css", "utf8");
  assert.match(css, /@media\s*\(max-width:\s*680px\)/u);
  assert.match(css, /\.choiceGrid\s*\{\s*grid-template-columns:\s*1fr/u);
  assert.match(css, /overflow-x:\s*(?:clip|hidden)/u);
  for (const width of [360, 375, 390, 412]) assert.ok(width <= 680);
});

register(27, "mobile", "鍵盤與螢幕閱讀器可完成選擇與核准", async () => {
  const source = await readFile("app/studio/project/[projectId]/rpg/rpg-workspace.tsx", "utf8");
  assert.match(source, /event\.key === "Enter"/u);
  assert.match(source, /event\.key === "Escape"/u);
  assert.match(source, /normalized === "1"/u);
  assert.match(source, /data-testid="rpg-accept-choice"/u);
  assert.match(source, /aria-live="polite"/u);
  assert.match(source, /role="dialog"\s+aria-modal="true"/u);
});

register(28, "economy", "RPG canonical stats apply deltas on top of legacy aliases", async () => {
  const { snapshot } = await seedFixture();
  const canonicalStatKeys = [
    "rpg.physique",
    "rpg.technique",
    "rpg.intellect",
    "rpg.charisma",
    "rpg.will",
    "rpg.creativity",
  ];
  for (const key of canonicalStatKeys) {
    assert.ok(Number.isFinite(snapshot.storyState.protagonistStats[key]));
  }
  const next = applyStoryChoiceEffect({
    ...snapshot.storyState,
    protagonistStats: {
      "rpg.insight": 45,
      "rpg.craft": 47,
      "rpg.xp": 8,
    },
  }, {
    statChanges: {
      "rpg.intellect": 1,
      "rpg.technique": 2,
      "rpg.xp": 3,
    },
    relationshipChanges: {},
    resourceChanges: {},
    moneyChange: 0,
    worldFlags: {},
    questProgress: {},
    achievementProgress: {},
    timelineEvents: [],
  });
  assert.equal(next.protagonistStats["rpg.intellect"], 46);
  assert.equal(next.protagonistStats["rpg.technique"], 49);
  assert.equal(next.protagonistStats["rpg.xp"], 11);
  assert.equal(next.protagonistStats["rpg.insight"], 45);
  assert.equal(next.protagonistStats["rpg.craft"], 47);

  const repaired = buildMingtanPresetState({
    ...snapshot.storyState,
    protagonistStats: { "rpg.xp": 8 },
  }, {
    initialStats: {
      "rpg.physique": 44,
      "rpg.technique": 47,
      "rpg.intellect": 45,
      "rpg.charisma": 46,
      "rpg.will": 48,
      "rpg.creativity": 49,
    },
  });
  assert.equal(repaired.replayed, false);
  assert.equal(repaired.storyState.protagonistStats["rpg.intellect"], 45);
  const fromBaseline = applyStoryChoiceEffect(
    { ...repaired.storyState, protagonistStats: { "rpg.xp": 8 } },
    {
      statChanges: { "rpg.intellect": 1, "rpg.technique": 2 },
      relationshipChanges: {},
      resourceChanges: {},
      moneyChange: 0,
      worldFlags: {},
      questProgress: {},
      achievementProgress: {},
      timelineEvents: [],
    },
    repaired.storyState.protagonistStats,
  );
  assert.equal(fromBaseline.protagonistStats["rpg.intellect"], 46);
  assert.equal(fromBaseline.protagonistStats["rpg.technique"], 49);
});

register(29, "economy", "legacy RPG receipts normalize omitted effect maps for history and replay", async () => {
  const fixture = await seedFixture();
  const pending = await persistResolvedChoice(fixture, undefined, "legacy-receipt-maps");
  const candidate = await fixture.repository.get("candidates", pending.candidate.id);
  const legacyEffect = structuredClone(candidate.effect);
  for (const key of [
    "statChanges",
    "relationshipChanges",
    "resourceChanges",
    "questProgress",
    "achievementProgress",
    "worldFlags",
  ]) delete legacyEffect[key];
  const legacySettlement = structuredClone(candidate.rpgSettlement);
  legacySettlement.resolvedEffect = structuredClone(legacyEffect);
  await fixture.repository.put("candidates", {
    ...candidate,
    effect: legacyEffect,
    rpgSettlement: legacySettlement,
  }, candidate.revision);

  const accepted = await acceptStudioChoice(
    fixture.repository,
    candidate.id,
    "舊存檔效果欄位省略時仍可安全核准。",
    pending.choice.title,
  );
  assert.deepEqual(accepted.rpgTurnReceipt?.appliedStatChanges, {});
  assert.deepEqual(accepted.rpgTurnReceipt?.appliedResourceChanges, {});
  assert.deepEqual(accepted.rpgTurnReceipt?.appliedRelationshipChanges, {});
  const reloaded = await loadRpgChatSnapshot(fixture.repository, fixture.projectId);
  assert.deepEqual(reloaded.rpgTurnReceipts[0]?.appliedResourceChanges ?? {}, {});
});

for (const test of tests.filter((item) => applies(item.category))) {
  const startedAt = Date.now();
  try {
    await test.run();
    results.push({ number: test.number, category: test.category, name: test.name, status: "PASS", durationMs: Date.now() - startedAt });
  } catch (error) {
    results.push({
      number: test.number,
      category: test.category,
      name: test.name,
      status: "FAIL",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

const pass = results.filter((result) => result.status === "PASS").length;
const fail = results.length - pass;
console.log(JSON.stringify({
  schemaVersion: "rpg-xianxia-v3-test-results-v1",
  suite: requestedSuite,
  pass,
  fail,
  results,
}, null, 2));
if (fail) process.exitCode = 1;

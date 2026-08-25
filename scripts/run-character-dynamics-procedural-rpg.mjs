import assert from "node:assert/strict";
import { makeRecord, optionalValue } from "../lib/novel-ai/domain/index.ts";
import { CHARACTER_PORTRAIT_CATALOG } from "../lib/novel-ai/character-portraits/catalog.ts";
import {
  approveCharacterDynamicsProfile,
  buildCharacterDynamicsCandidate,
} from "../lib/novel-ai/character-agent/character-dynamics-engine.ts";
import { evaluateMatureNarrativeFormula } from "../lib/novel-ai/character-agent/mature-narrative-formula.ts";
import {
  buildProceduralEncounter,
  applyProceduralWorldPulse,
} from "../lib/novel-ai/game/procedural-world-director.ts";
import {
  generateProceduralPills,
  initialProceduralPillResources,
  resolveProceduralPillUse,
} from "../lib/novel-ai/game/procedural-pill-engine.ts";
import {
  XIANXIA_RULE_KIND_OPTIONS,
  calculateTribulationDifficulty,
  calculateXianxiaCraftingChance,
  generateXianxiaRuleCandidate,
} from "../lib/novel-ai/game/xianxia-procedural-rule-packs.ts";
import {
  RPG_FREE_WORLD_ACTIVITIES,
  buildRpgChoices,
  initialRpgResources,
  readRpgProgression,
  resolveRpgChoice,
} from "../lib/novel-ai/game/progression/rpg-progression.ts";

const results = [];
async function test(name, work) {
  try {
    const evidence = await work();
    results.push({ name, status: "PASS", evidence });
  } catch (error) {
    results.push({ name, status: "FAIL", error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
  }
}

function character(id, name, age = 24) {
  return {
    ...makeRecord("project-dynamics", "user"),
    id,
    name,
    aliases: [],
    identity: optionalValue(name === "映河" ? "流浪劍修" : name === "清晏" ? "丹理校驗師" : "宗門協調者", "user_defined"),
    personality: optionalValue(name === "映河" ? "不服輸但重視承諾" : name === "清晏" ? "冷靜細心" : "擅長連結不同立場", "user_defined"),
    goal: optionalValue("在不犧牲同伴自主的前提下改變命運", "user_defined"),
    lifeStatus: "alive",
    locationId: null,
    age,
    ageVerified: true,
    fears: ["無法挽回的代價"],
    privateSecrets: [],
    factionIds: [],
    values: ["自主", "承諾"],
    capabilities: ["觀察", "協作"],
    limitations: ["資源有限"],
  };
}

const characters = [character("char-a", "映河"), character("char-b", "清晏"), character("char-c", "懷序")];

await test("10,000 portrait catalog entries are unique and complete", () => {
  assert.equal(CHARACTER_PORTRAIT_CATALOG.length, 10_000);
  assert.equal(new Set(CHARACTER_PORTRAIT_CATALOG.map((item) => item.id)).size, 10_000);
  assert.ok(CHARACTER_PORTRAIT_CATALOG.every((item) => item.assetDigest.length === 64 && item.visualDescription.length > 8));
  assert.equal(new Set(CHARACTER_PORTRAIT_CATALOG.map((item) => item.visualVariant?.variant)).size, 100);
  return { count: 10_000, baseArt: 100, variantsPerBase: 100, themes: new Set(CHARACTER_PORTRAIT_CATALOG.map((item) => item.themeId)).size };
});

await test("character dynamics are deterministic per seed and distinct across playthroughs", () => {
  const first = buildCharacterDynamicsCandidate({ projectId: "project-dynamics", characters, playthroughSeed: "run-one", generatedAt: "2026-08-01T00:00:00.000Z" });
  const replay = buildCharacterDynamicsCandidate({ projectId: "project-dynamics", characters, playthroughSeed: "run-one", generatedAt: "2026-08-01T00:00:00.000Z" });
  const nextRun = buildCharacterDynamicsCandidate({ projectId: "project-dynamics", characters, playthroughSeed: "run-two", generatedAt: "2026-08-01T00:00:00.000Z" });
  assert.deepEqual(first, replay);
  assert.notDeepEqual(first.profiles, nextRun.profiles);
  assert.equal(first.canonicalMutation, 0);
  assert.ok(first.relationships.every((edge) => edge.fromCharacterId !== edge.toCharacterId));
  for (const profile of first.profiles) {
    const values = Object.values(profile.proposedRpgStats);
    assert.equal(values.reduce((sum, value) => sum + value, 0), 300);
    assert.ok(values.every((value) => value >= 20 && value <= 80));
  }
  const approved = approveCharacterDynamicsProfile(first.profiles[0], first.playthroughSeed, "2026-08-01T00:01:00.000Z");
  assert.equal(approved.rpgProfile.pointBudget, 300);
  assert.equal(approved.dynamicsProfile.approvedBy, "user");
  return { edges: first.relationships.length, complexity: first.complexity, nextRunChanged: true };
});

await test("procedural world de-duplicates recent encounters and records bounded consequences", () => {
  const first = buildProceduralEncounter({ runSeed: "world-a", mode: "cultivation", turn: 4, strategy: "steady" });
  const second = buildProceduralEncounter({ runSeed: "world-a", mode: "cultivation", turn: 4, strategy: "steady", recentSignatures: [first.signature] });
  assert.notEqual(first.signature, second.signature);
  const emptyEffect = { statChanges: {}, relationshipChanges: {}, resourceChanges: {}, moneyChange: 0, worldFlags: {}, questProgress: {}, achievementProgress: {}, timelineEvents: [] };
  const applied = applyProceduralWorldPulse({ effect: emptyEffect, encounter: first, outcome: "success", strategy: "steady", turn: 4 });
  assert.equal(applied.worldFlags["rpg.lastEncounterSignature"], first.signature);
  assert.equal(applied.relationshipChanges["rpg.partyTrust"], 2);
  assert.equal(applied.resourceChanges["world.choiceConsequences"], 1);
  return { first: first.templateId, replacement: second.templateId, mutationKeys: Object.keys(applied.worldFlags) };
});

await test("procedural pills vary by run but remain auditable within a run", () => {
  const pills = generateProceduralPills({ runSeed: "pill-run-a", cycle: 1, count: 6 });
  const replay = generateProceduralPills({ runSeed: "pill-run-a", cycle: 1, count: 6 });
  const nextRun = generateProceduralPills({ runSeed: "pill-run-b", cycle: 1, count: 6 });
  assert.deepEqual(pills, replay);
  assert.notDeepEqual(pills.map((pill) => pill.itemId), nextRun.map((pill) => pill.itemId));
  assert.equal(new Set(pills.map((pill) => pill.itemId)).size, 6);
  const resolution = resolveProceduralPillUse({
    pill: pills[0],
    runSeed: "pill-run-a",
    turn: 3,
    useIndex: 0,
    stats: { "rpg.physique": 50, "rpg.technique": 50, "rpg.intellect": 50, "rpg.charisma": 50, "rpg.will": 50, "rpg.creativity": 50 },
    health: 82,
    stress: 24,
  });
  assert.equal(resolution.effect.resourceChanges[`item.${pills[0].itemId}`], -1);
  assert.ok(resolution.compatibility >= 0 && resolution.compatibility <= 100);
  return { ids: pills.map((pill) => pill.itemId), result: resolution.result, compatibility: resolution.compatibility };
});

await test("mature narrative formula blocks minors and requires consent and boundaries", () => {
  const metrics = { trust: 80, affection: 70, attraction: 60, fear: 0, resentment: 0, loyalty: 50, debt: 0, dependency: 10, conflict: 5, powerBalance: 4 };
  const blocked = evaluateMatureNarrativeFormula({ projectAdultMode: true, from: character("minor", "未成年", 17), to: characters[0], metrics, explicitConsent: true, boundaryConfirmed: true });
  const eligible = evaluateMatureNarrativeFormula({ projectAdultMode: true, from: characters[0], to: characters[1], metrics, explicitConsent: true, boundaryConfirmed: true });
  assert.equal(blocked.eligible, false);
  assert.ok(blocked.blockers.some((item) => item.includes("成年驗證")));
  assert.equal(eligible.eligible, true);
  assert.equal(eligible.canonicalMutation, 0);
  return { blocked: blocked.blockers, eligibleTension: eligible.tension };
});

await test("all user-authored xianxia rule families produce safe reviewable candidates", () => {
  const candidates = XIANXIA_RULE_KIND_OPTIONS.map(({ kind }, index) => generateXianxiaRuleCandidate({ runSeed: "rules-a", kind, turn: index, adultMode: false }));
  assert.equal(candidates.length, 6);
  assert.ok(candidates.every((candidate) => candidate.canonicalMutation === 0));
  assert.ok(candidates.every((candidate) => candidate.preconditions.length && candidate.costs.length && candidate.risks.length && candidate.counters.length));
  assert.ok(candidates.every((candidate) => candidate.title !== "成年親密的界線選擇"));
  assert.ok(calculateXianxiaCraftingChance({ skill: 70, materialQuality: 65, control: 72, complexity: 55, fatigue: 20 }) <= 95);
  assert.ok(calculateTribulationDifficulty({ realmRank: 4, heartDemon: 60, karmaDebt: 25, externalInterference: 30, worldInstability: 40, foundation: 68 }) <= 99);
  return { candidates: candidates.map((candidate) => `${candidate.kindLabel}:${candidate.title}`) };
});

await test("RPG choices carry changing world encounters into approved effects", () => {
  const runSeed = "rpg-playthrough-a";
  const resources = { ...initialRpgResources(), ...initialProceduralPillResources(runSeed, 1, 6) };
  const progression = readRpgProgression({ protagonistStats: { "rpg.xp": 0 }, resources, money: 1200, inventory: [], worldFlags: { "rpg.runSeed": runSeed, "rpg.cycle": 1 } }, "fallback", "cultivation");
  const choices = buildRpgChoices({ progression, protagonist: "映河", chapterTitle: "試煉", conflict: "地脈改變", seed: runSeed });
  assert.equal(choices.length, 3);
  assert.equal(new Set(choices.map((choice) => choice.encounter.signature)).size, 3);
  const resolved = resolveRpgChoice(choices[0], { seed: runSeed, revision: 1, turn: progression.turn, recentEncounterSignatures: [] });
  assert.equal(resolved.effect.worldFlags["rpg.lastEncounterSignature"], choices[0].encounter.signature);
  assert.ok(resolved.acceptedText.includes("事件預兆"));
  assert.ok(resolved.effect.resourceChanges[`journey.path.${choices[0].approach}`] > 0);
  assert.ok(resolved.effect.resourceChanges["journey.mainlineMomentum"] > 0);
  assert.ok(resolved.effect.resourceChanges["journey.worldFreedom"] > 0);
  const nextResources = { ...resources };
  for (const [key, delta] of Object.entries(resolved.effect.resourceChanges)) {
    nextResources[key] = (nextResources[key] ?? 0) + delta;
  }
  const nextQuestStates = {};
  for (const [key, delta] of Object.entries(resolved.effect.questProgress)) {
    nextQuestStates[key] = (nextQuestStates[key] ?? 0) + delta;
  }
  const nextProgression = readRpgProgression({ protagonistStats: { "rpg.xp": 0 }, resources: nextResources, money: 1200, inventory: [], questStates: nextQuestStates, worldFlags: { "rpg.runSeed": runSeed, "rpg.cycle": 1 } }, "fallback", "cultivation");
  assert.equal(nextProgression.journey.identityStrategy, choices[0].approach);
  assert.ok(nextProgression.journey.mainlineProgress > 0);
  assert.ok(nextProgression.journey.worldFreedom > 0);
  assert.equal(RPG_FREE_WORLD_ACTIVITIES.adventure.length, 6);
  assert.equal(RPG_FREE_WORLD_ACTIVITIES.cultivation.length, 6);
  assert.equal(RPG_FREE_WORLD_ACTIVITIES.management.length, 6);
  return { choices: choices.map((choice) => ({ key: choice.key, encounter: choice.encounter.title })), outcome: resolved.outcome, identity: nextProgression.journey.identityLabel, freeWorldActivities: 18 };
});

const failed = results.filter((result) => result.status === "FAIL");
process.stdout.write(`${JSON.stringify({ suite: "character-dynamics-procedural-rpg", status: failed.length ? "FAIL" : "PASS", results }, null, 2)}\n`);
if (failed.length) process.exitCode = 1;

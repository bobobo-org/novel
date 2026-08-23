import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  PROCEDURAL_CAUSAL_DIMENSIONS,
  PROCEDURAL_CHARACTER_CAPACITY,
  PROCEDURAL_ORIGIN_POLICY,
  PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
  PROCEDURAL_STORY_LIBRARY_VERSION,
  PROCEDURAL_THEORETICAL_CROSS_RELATIONSHIP_SPACE,
  PROCEDURAL_TREASURE_CAPACITY,
  proceduralCharacterAt,
  proceduralCharacterTreasureScenarioAt,
  proceduralStoryLibraryCapacity,
  proceduralThreeRoleCastAt,
  proceduralTreasureAt,
} from "../lib/novel-ai/game/procedural-story-library.ts";
import {
  characterRpgPointTotal,
  characterRpgStatsForArchetype,
} from "../lib/novel-ai/game/character-rpg-profile.ts";

assert.equal(PROCEDURAL_STORY_LIBRARY_VERSION, "procedural-story-library-v1");
assert.equal(PROCEDURAL_ORIGIN_POLICY, "original-procedural-fiction-no-real-person-or-social-account");
assert.equal(PROCEDURAL_CHARACTER_CAPACITY, 100_000);
assert.equal(PROCEDURAL_TREASURE_CAPACITY, 100_000);
assert.equal(PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY, 1_000_000);
assert.equal(PROCEDURAL_THEORETICAL_CROSS_RELATIONSHIP_SPACE, 10_000_000_000);
assert.deepEqual(proceduralStoryLibraryCapacity(), {
  characters: 100_000,
  treasures: 100_000,
  relationshipScenarios: 1_000_000,
  theoreticalCharacterTreasurePairs: 10_000_000_000,
  causalDimensions: 10,
});

assert.equal(PROCEDURAL_CAUSAL_DIMENSIONS.length, 10);
assert.equal(new Set(PROCEDURAL_CAUSAL_DIMENSIONS.map((dimension) => dimension.id)).size, 10);
assert.equal(new Set(PROCEDURAL_CAUSAL_DIMENSIONS.map((dimension) => dimension.label)).size, 10);

const baseContext = {
  genre: "仙俠修行",
  playMode: "RPG 養成",
  protagonist: "測試主角",
  location: "斷脈藥谷",
  conflict: "宗門封鎖了救援藥材",
};
const firstCharacter = proceduralCharacterAt({ seed: "replay", ordinal: 42, context: baseContext });
const replayCharacter = proceduralCharacterAt({ seed: "replay", ordinal: 42, context: baseContext });
assert.deepEqual(replayCharacter, firstCharacter);
assert.equal(firstCharacter.fictional, true);
assert.equal(firstCharacter.storyProfileId, "xianxia");
assert.ok(firstCharacter.name.length >= 3);
assert.ok(firstCharacter.goal.length > 10);
assert.ok(firstCharacter.stance.length > 10);
assert.ok(firstCharacter.proactiveAction.includes(firstCharacter.name));
assert.ok(firstCharacter.refusalCondition.includes("若"));
assert.match(firstCharacter.directDialogue, /「.+」/u);
assert.match(firstCharacter.portrait.assetUri, /^\/character-portraits\//u);
assert.ok(firstCharacter.portrait.visualSeed.length > 12);
assert.ok(["balanced", "vanguard", "strategist", "diplomat", "mystic", "creator"].includes(firstCharacter.rpgArchetype));
assert.equal(characterRpgPointTotal(characterRpgStatsForArchetype(firstCharacter.rpgArchetype)), 300);

const firstTreasure = proceduralTreasureAt({ seed: "replay", ordinal: 42, context: baseContext });
const replayTreasure = proceduralTreasureAt({ seed: "replay", ordinal: 42, context: baseContext });
assert.deepEqual(replayTreasure, firstTreasure);
assert.equal(firstTreasure.fictional, true);
assert.equal(firstTreasure.storyProfileId, "xianxia");
for (const field of ["holderRelationship", "function", "limitation", "cost", "visualDescription"]) {
  assert.ok(firstTreasure[field].length > 10, `treasure.${field} must be substantive`);
}

// The full 100k capacities are decoded one record at a time. IDs and generated
// three-part names must remain collision-free without materializing a database.
const characterIds = new Set();
const characterNames = new Set();
const treasureIds = new Set();
const treasureNames = new Set();
for (let ordinal = 0; ordinal < 100_000; ordinal += 1) {
  const character = proceduralCharacterAt({ seed: "capacity-audit", ordinal, context: baseContext });
  const treasure = proceduralTreasureAt({ seed: "capacity-audit", ordinal, context: baseContext });
  characterIds.add(character.id);
  characterNames.add(character.name);
  assert.equal(characterRpgPointTotal(characterRpgStatsForArchetype(character.rpgArchetype)), 300);
  treasureIds.add(treasure.id);
  treasureNames.add(treasure.name);
}
assert.equal(characterIds.size, 100_000);
assert.equal(characterNames.size, 100_000);
assert.equal(treasureIds.size, 100_000);
assert.equal(treasureNames.size, 100_000);

const matchingCases = [
  [{ genre: "科幻未來", storyTags: ["星艦", "記憶"] }, "science-fiction"],
  [{ genre: "都會戀愛", playMode: "戀愛養成" }, "romance"],
  [{ genre: "職場", playMode: "經營模擬", conflict: "資金與品質危機" }, "management"],
  [{ genre: "現代懸疑", storyTags: ["推理", "冷案"] }, "mystery"],
];
for (const [context, expectedProfileId] of matchingCases) {
  assert.equal(proceduralCharacterAt({ seed: "match", ordinal: 9, context }).storyProfileId, expectedProfileId);
  assert.equal(proceduralTreasureAt({ seed: "match", ordinal: 9, context }).storyProfileId, expectedProfileId);
}

const firstScenario = proceduralCharacterTreasureScenarioAt({
  seed: "million-space",
  ordinal: 0,
  context: baseContext,
});
const replayScenario = proceduralCharacterTreasureScenarioAt({
  seed: "million-space",
  ordinal: 0,
  context: baseContext,
});
const lastScenario = proceduralCharacterTreasureScenarioAt({
  seed: "million-space",
  ordinal: 999_999,
  context: baseContext,
});
assert.deepEqual(replayScenario, firstScenario);
assert.notEqual(lastScenario.id, firstScenario.id);
assert.equal(firstScenario.combinationSpace, 1_000_000);
assert.equal(firstScenario.causalDimensions.length, 10);
assert.equal(new Set(firstScenario.causalDimensions.map((dimension) => dimension.id)).size, 10);
assert.equal(firstScenario.cast.members.length, 3);
assert.deepEqual(firstScenario.cast.members.map((member) => member.narrativeRole), ["catalyst", "counterforce", "witness"]);
assert.equal(new Set(firstScenario.cast.members.map((member) => member.id)).size, 3);
assert.equal(new Set(firstScenario.cast.members.map((member) => member.name)).size, 3);
assert.ok(firstScenario.cast.members.every((member) => member.storyFunction.length > 10));
assert.ok(firstScenario.causalDimensions.every((dimension) => dimension.signal.length > 8));
assert.ok(firstScenario.storyHook.includes(firstScenario.character.name));
assert.ok(firstScenario.storyHook.includes(firstScenario.treasure.name));
assert.ok(firstScenario.storyHook.includes(firstScenario.cast.counterforce.name));
assert.ok(firstScenario.storyHook.includes(firstScenario.cast.witness.name));
assert.throws(
  () => proceduralCharacterTreasureScenarioAt({ seed: "million-space", ordinal: 1_000_000 }),
  /RELATIONSHIP_SCENARIO_ORDINAL_OUT_OF_RANGE/u,
);

const scenarioIds = new Set();
for (let ordinal = 0; ordinal < 20_000; ordinal += 1) {
  const scenario = proceduralCharacterTreasureScenarioAt({
    seed: "relationship-sample",
    ordinal: (ordinal * 47_999) % 1_000_000,
    context: baseContext,
  });
  scenarioIds.add(scenario.id);
  assert.equal(scenario.fictional, true);
  assert.equal("socialHandle" in scenario.character, false);
  assert.equal("realPerson" in scenario.character, false);
}
assert.equal(scenarioIds.size, 20_000);

// Supporting characters must not merely receive different names while taking
// the same action. Audit three thousand deterministic ensembles per play mode
// after removing only the scene-specific name and location tokens.
const roleActionAuditContexts = [
  {
    label: "rpg",
    context: {
      genre: "仙俠修行",
      playMode: "RPG 養成",
      location: "斷脈藥谷",
      conflict: "宗門封鎖了救援藥材",
    },
  },
  {
    label: "romance",
    context: {
      genre: "都會戀愛",
      playMode: "戀愛養成",
      location: "打烊後的書店",
      conflict: "兩人必須在天亮前說清共同承諾",
    },
  },
  {
    label: "management",
    context: {
      genre: "職場經營",
      playMode: "經營模擬",
      location: "停電中的工作室",
      conflict: "現金與品質只能先守住其中一端",
    },
  },
];
const roleActionSemantics = {
  catalyst: /必須回應|回答這個人的目標|被忽視的代價/u,
  counterforce: /不同解法|真實取捨|無條件服從/u,
  witness: /追究承諾|兩邊都沒看見|行動的後果決定/u,
};
let auditedRoleActionScenarios = 0;
for (const { label, context } of roleActionAuditContexts) {
  for (let ordinal = 0; ordinal < 3_000; ordinal += 1) {
    const scenario = proceduralCharacterTreasureScenarioAt({
      seed: `role-action-audit-${label}`,
      ordinal: (ordinal * 47_999) % PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
      context,
    });
    const normalizedActions = scenario.cast.members.map((member) => {
      assert.ok(member.proactiveAction.includes(member.name), `${label}/${ordinal} action lost character name`);
      assert.ok(member.proactiveAction.includes(context.location), `${label}/${ordinal} action lost story location`);
      assert.match(
        member.proactiveAction,
        roleActionSemantics[member.narrativeRole],
        `${label}/${ordinal}/${member.narrativeRole} action lost its narrative-role intent`,
      );
      return member.proactiveAction
        .replaceAll(member.name, "<角色>")
        .replaceAll(context.location, "<場景>");
    });
    assert.equal(
      new Set(scenario.cast.members.map((member) => member.storyFunction)).size,
      3,
      `${label}/${ordinal} reused the same story function across cast roles`,
    );
    assert.equal(
      new Set(normalizedActions).size,
      3,
      `${label}/${ordinal} reused the same proactive action across cast roles`,
    );
    auditedRoleActionScenarios += 1;
  }
}
assert.equal(auditedRoleActionScenarios, 9_000);

const cast = proceduralThreeRoleCastAt({ seed: "cast-replay", ordinal: 888_888, context: baseContext });
assert.deepEqual(
  proceduralThreeRoleCastAt({ seed: "cast-replay", ordinal: 888_888, context: baseContext }),
  cast,
);
assert.equal(new Set(cast.members.map((member) => member.id)).size, 3);

const perfStart = performance.now();
for (let ordinal = 0; ordinal < 1_000; ordinal += 1) {
  proceduralCharacterTreasureScenarioAt({
    seed: "performance",
    ordinal: (ordinal * 997) % 1_000_000,
    context: matchingCases[ordinal % matchingCases.length][0],
  });
}
const perfMs = performance.now() - perfStart;
assert.ok(perfMs < 2_000, `1,000 O(1) decodes took ${perfMs.toFixed(2)}ms`);

console.log(JSON.stringify({
  ok: true,
  version: PROCEDURAL_STORY_LIBRARY_VERSION,
  capacity: proceduralStoryLibraryCapacity(),
  sampledScenarioIds: scenarioIds.size,
  auditedRoleActionScenarios,
  thousandDecodeMs: Number(perfMs.toFixed(2)),
}, null, 2));

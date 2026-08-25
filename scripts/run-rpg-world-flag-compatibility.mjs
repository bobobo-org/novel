import assert from "node:assert/strict";
import {
  applyStoryChoiceEffect,
  validateStoryChoiceEffect,
} from "../lib/novel-ai/game/effects/index.ts";
import {
  buildRpgChoices,
  readRpgProgression,
  resolveRpgChoice,
} from "../lib/novel-ai/game/progression/rpg-progression.ts";

const legacyWorldFlag = "rpg.consequenceTriggered.adv-forbidden-zone:turn-0:variant-0:adventure:fa8b1c2d3e4f";
const legacyEffect = {
  statChanges: {},
  relationshipChanges: {},
  resourceChanges: { "meter.pursuit": 4 },
  moneyChange: 0,
  worldFlags: { [legacyWorldFlag]: true },
  questProgress: {},
  achievementProgress: {},
  timelineEvents: ["舊版延遲後果被觸發"],
};

assert.ok(legacyWorldFlag.length > 64, "the fixture reproduces the old over-64-character world flag");
assert.equal(validateStoryChoiceEffect(legacyEffect).valid, true, "existing procedural saves remain approvable");
assert.equal(
  validateStoryChoiceEffect({ ...legacyEffect, worldFlags: { [`rpg.${"x".repeat(129)}`]: true } }).valid,
  false,
  "world flags remain length-bounded",
);
assert.equal(
  validateStoryChoiceEffect({ ...legacyEffect, worldFlags: { "rpg.invalid/key": true } }).valid,
  false,
  "unsafe key characters remain rejected",
);

const applied = applyStoryChoiceEffect({
  revision: 7,
  parentRevision: 6,
  updatedAt: new Date(0).toISOString(),
  protagonistStats: {},
  relationships: {},
  resources: {},
  money: 1_200,
  worldFlags: {},
  questStates: {},
  achievementStates: {},
}, legacyEffect);
assert.equal(applied.worldFlags[legacyWorldFlag], true, "a currently blocked candidate can be approved after the repair");

const sourceState = {
  protagonistStats: { "rpg.xp": 0 },
  resources: {
    "status.hp": 100,
    "status.stamina": 100,
    "status.spirit": 100,
    "game.actionPoints": 3,
  },
  relationships: {},
  money: 1_200,
  inventory: [],
  worldFlags: { "rpg.runSeed": "world-flag-regression", "rpg.cycle": 1 },
  questStates: {},
  achievementStates: {},
};
const progression = readRpgProgression(sourceState, "world-flag-regression", "adventure");
const riskyChoice = buildRpgChoices({
  progression,
  protagonist: "唐靜霄",
  chapterTitle: "禁區門前",
  conflict: "必須在追兵抵達前取得線索",
  mode: "adventure",
  seed: "world-flag-regression",
}).find((choice) => choice.risk >= 3);
assert.ok(riskyChoice, "the procedural choice set contains a delayed-consequence path");

const resolution = resolveRpgChoice(riskyChoice, {
  seed: "world-flag-regression",
  revision: 7,
  turn: progression.turn,
});
const scheduledEffect = resolution.settlement.scheduledConsequences[0]?.effects.storyEffect;
assert.ok(scheduledEffect, "the risky choice schedules a delayed consequence");
const generatedFlag = Object.keys(scheduledEffect.worldFlags ?? {})[0];
assert.match(generatedFlag, /^rpg\.consequenceTriggered\.[a-f0-9]{8}$/u);
assert.ok(generatedFlag.length <= 64, "new procedural consequence flags remain compact");
assert.equal(validateStoryChoiceEffect(scheduledEffect).valid, true);

const modernChoices = buildRpgChoices({
  progression,
  protagonist: "唐靜霄",
  chapterTitle: "深夜片場",
  conflict: "上一個選擇已讓拍攝合約曝光，投資方要求天亮前交代責任",
  mode: "adventure",
  playMode: "rpg",
  seed: "modern-continuity-regression",
  narrativeAnchors: {
    supportingCharacter: "周牧魚",
    familyOrFaction: "星瀾影業",
    storyAsset: "拍攝合約與門禁紀錄",
    factionPressure: "投資方正封鎖證人",
    unresolvedThread: "被剪去的監控去了哪裡",
    worldContext: "現代成人影視產業、都市懸疑、片場與經紀公司",
  },
});
const modernChoiceCopy = modernChoices.map((choice) => `${choice.title}\n${choice.description}`).join("\n");
for (const choice of modernChoices) {
  assert.match(choice.description, /上一個選擇已讓拍攝合約曝光/u, "every fallback route must begin from the accepted consequence");
}
assert.doesNotMatch(
  modernChoiceCopy,
  /青鋒靈刃|坊市|靈石|煉氣|築基|金丹|元嬰|宗門|修行/u,
  "a modern story must not inherit cultivation-only choice vocabulary",
);
assert.match(modernChoiceCopy, /周牧魚|星瀾影業|拍攝合約|投資方|監控/u, "fallback routes must use the current cast, faction, asset and unresolved clue");

console.log(JSON.stringify({
  suite: "rpg-world-flag-compatibility",
  status: "PASS",
  legacyFlagLength: legacyWorldFlag.length,
  generatedFlag,
  generatedFlagLength: generatedFlag.length,
  existingCandidateApprovable: true,
  futureFlagsCompacted: true,
  modernChoiceContinuity: true,
  crossGenreLeakageBlocked: true,
}, null, 2));

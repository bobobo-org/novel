import assert from "node:assert/strict";
import {
  evaluateLifeManagementEnding,
  evaluateTalentAssignment,
  evolvePowerRelation,
  ORGANIZATION_MANAGEMENT_DIMENSIONS,
  ORGANIZATION_SCALE_MILESTONES,
  readLifeManagementSnapshot,
} from "../lib/novel-ai/game/life-management-simulation.ts";
import {
  managementInvestmentCatalog,
  managementInvestmentStrategy,
  resolveManagementEra,
} from "../lib/novel-ai/game/management-investments.ts";
import {
  CULTIVATION_OPPORTUNITIES,
  selectCultivationOpportunity,
} from "../lib/novel-ai/game/cultivation-opportunities.ts";
import {
  buildRpgChoices,
  readRpgProgression,
} from "../lib/novel-ai/game/progression/rpg-progression.ts";
import {
  CULTIVATION_PROFESSIONS,
  FUTURE_ORGANIZATION_CATALOG,
  HISTORICAL_ORGANIZATION_CATALOG,
  HISTORICAL_PROFESSIONS,
  MODERN_PROFESSIONS,
  professionContinuityError,
  professionSuggestions,
  professionWorldContext,
} from "../lib/novel-ai/game/character-profession.ts";

const storyState = {
  resources: {
    "management.cash": 8_000_000,
    "management.staff": 38,
    "management.branches": 4,
    "management.reputation": 72,
    "management.marketShare": 31,
    "management.morale": 58,
    "management.employeeSkill": 68,
    "management.risk": 42,
    "status.health": 76,
    "status.fatigue": 22,
    "status.stress": 33,
    "life.family": 66,
    "life.legacy": 48,
  },
  relationships: {},
  protagonistStats: { "rpg.xp": 120 },
  money: 1200,
  inventory: [],
  questStates: {},
  achievementStates: {},
  worldFlags: { "rpg.runSeed": "management-life-test", "rpg.cycle": 1 },
};

const snapshot = readLifeManagementSnapshot(storyState);
assert.equal(snapshot.dailyTimeBudget, 12);
assert.ok(snapshot.phase.level >= 3);
assert.equal(Object.keys(snapshot.dimensions).length, 8);
assert.equal(ORGANIZATION_MANAGEMENT_DIMENSIONS.length, 8);
assert.equal(ORGANIZATION_SCALE_MILESTONES.at(-1)?.level, 100);
assert.ok(evaluateLifeManagementEnding(snapshot).name.length > 0);

const badManager = evaluateTalentAssignment({
  professionalAbility: 94,
  managementAbility: 38,
  loyalty: 70,
  ambition: 88,
  role: "manager",
});
assert.ok(badManager.warning);
assert.ok(badManager.teamDepartureRisk >= 40);

const changedPower = evolvePowerRelation({
  sourceId: "a",
  targetId: "b",
  friendliness: 0,
  interest: 0,
  fear: 0,
  competition: 0,
  alliance: 0,
  hatred: 0,
}, { sharedBenefit: 20, betrayal: 15 });
assert.notEqual(changedPower.alliance, 0);
assert.notEqual(changedPower.hatred, 0);

assert.equal(resolveManagementEra("古代王朝商號與田莊"), "ancient");
assert.equal(resolveManagementEra("修仙宗門靈田與坊市"), "cultivation");
assert.equal(managementInvestmentCatalog("現代企業新創").length, 4);
assert.match(managementInvestmentStrategy("修仙宗門", "bold").asset.name, /秘境|護山陣/u);

const professionProject = (signal) => ({
  genrePackId: null,
  genreId: null,
  subgenreId: null,
  coreIdea: { value: signal },
});
assert.equal(professionWorldContext(professionProject("古代王朝與江湖鏢局"), []), "historical");
assert.equal(professionWorldContext(professionProject("現代企業與家族財團"), []), "modern");
assert.equal(professionWorldContext(professionProject("修仙宗門與靈根境界"), []), "cultivation");
assert.equal(professionWorldContext(professionProject("未來星際殖民與星艦"), []), "future");
assert.equal(professionWorldContext(professionProject("現代律師穿越古代王朝"), []), "cross-era");
const legacyHistoricalIdentityOverlay = professionProject(
  "附身變身世界｜歷史宮廷。題材核心仍維持附身變身，不會被自動改寫成修仙故事。",
);
assert.equal(professionWorldContext(legacyHistoricalIdentityOverlay, []), "historical");
assert.ok(professionSuggestions(professionProject("古代王朝"), []).includes("仵作"));
assert.ok(professionSuggestions(professionProject("修仙宗門"), []).includes("煉丹師"));
assert.ok(professionSuggestions(professionProject("現代企業"), []).includes("會計師"));
assert.ok(HISTORICAL_PROFESSIONS.length >= 20);
assert.ok(MODERN_PROFESSIONS.length >= 20);
assert.ok(CULTIVATION_PROFESSIONS.length >= 16);
assert.ok(HISTORICAL_ORGANIZATION_CATALOG.length >= 4);
assert.ok(FUTURE_ORGANIZATION_CATALOG.length >= 3);
assert.match(professionContinuityError("醫生", professionProject("古代王朝"), []), /不屬於/u);
assert.equal(professionContinuityError("郎中", professionProject("古代王朝"), []), null);
assert.equal(professionContinuityError("工匠", legacyHistoricalIdentityOverlay, []), null);
assert.match(professionContinuityError("工程師", legacyHistoricalIdentityOverlay, []), /古代／歷史/u);

assert.ok(CULTIVATION_OPPORTUNITIES.length >= 12);
assert.equal(new Set(CULTIVATION_OPPORTUNITIES.map((item) => item.id)).size, CULTIVATION_OPPORTUNITIES.length);
for (const strategy of ["steady", "resource", "bold"]) {
  const opportunity = selectCultivationOpportunity({ seed: "sect-test", turn: 7, strategy });
  assert.ok(opportunity.rewards.length >= 3);
  assert.ok(opportunity.risks.length >= 3);
}

const progression = readRpgProgression(storyState, "management-test", "management");
const choices = buildRpgChoices({
  progression,
  protagonist: "顧明澄",
  chapterTitle: "第二家公司",
  conflict: "現金流與控制權衝突",
  mode: "management",
  playMode: "management",
  seed: "management-test",
  storyStateRevision: 1,
  narrativeAnchors: { worldContext: "古代王朝、商號、田莊與官府" },
});
assert.equal(choices.length, 3);
for (const choice of choices) {
  assert.match(choice.title, /投資/u);
  assert.ok(Object.keys(choice.effect.resourceChanges).some((key) => key.startsWith("management.investment.ancient.")));
  assert.ok(choice.effect.timelineEvents.some((event) => event.includes("投資決策")));
}

console.log(JSON.stringify({
  status: "PASS",
  phase: snapshot.phase,
  ending: evaluateLifeManagementEnding(snapshot),
  investmentChoices: choices.map((choice) => choice.title),
  cultivationOpportunities: CULTIVATION_OPPORTUNITIES.length,
}, null, 2));

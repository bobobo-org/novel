import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  CHARACTER_MASTERY_LIBRARY_VERSION,
  CHARACTER_MASTERY_MATERIALIZATION_POLICY,
  CHARACTER_MASTERY_PAGE_MAX,
  CULTIVATION_TECHNIQUE_CAPACITY_PER_ELEMENT,
  CULTIVATION_TECHNIQUE_TOTAL_CAPACITY,
  FIVE_PHASE_ELEMENTS,
  MASTERY_CATALOG_CAPACITY,
  characterMasteryDecisionFacts,
  characterMasteryNarrativeContext,
  characterMasteryProfileAt,
  cultivationTechniqueAt,
  cultivationTechniquePage,
  elementalInteraction,
  masteryCatalogPage,
  masteryCatalogRecordAt,
} from "../lib/novel-ai/game/character-mastery-library.ts";
import { DeterministicSocialMatrix } from "../lib/novel-ai/social-matrix/index.ts";

const storySeed = "character-mastery-focused-contract";
const ancientContext = {
  genre: "仙俠群像",
  storyTags: ["宗門", "五行修行"],
  location: "照影山",
};
const modernContext = {
  genre: "現代企業懸疑",
  storyTags: ["當代", "城市"],
  location: "濱海市",
};

assert.equal(CHARACTER_MASTERY_LIBRARY_VERSION, "character-mastery-library-v1");
assert.equal(CHARACTER_MASTERY_MATERIALIZATION_POLICY, "indexed-on-demand-no-bulk-materialization");
assert.equal(MASTERY_CATALOG_CAPACITY, 1_000);
assert.equal(CULTIVATION_TECHNIQUE_CAPACITY_PER_ELEMENT, 1_000);
assert.equal(CULTIVATION_TECHNIQUE_TOTAL_CAPACITY, 5_000);
assert.equal(CHARACTER_MASTERY_PAGE_MAX, 100);
assert.equal(FIVE_PHASE_ELEMENTS.length, 5);

assert.deepEqual(
  FIVE_PHASE_ELEMENTS.map((element) => [element.id, element.generates, element.controls]),
  [
    ["metal", "water", "wood"],
    ["wood", "fire", "earth"],
    ["water", "wood", "fire"],
    ["fire", "earth", "metal"],
    ["earth", "metal", "water"],
  ],
);
assert.deepEqual(elementalInteraction("wood", "fire"), {
  source: "wood",
  target: "fire",
  relation: "相生",
  multiplier: 1.18,
  explanation: "木生火，後者效果獲得供能加乘。",
});
assert.equal(elementalInteraction("wood", "earth").relation, "相剋");
assert.equal(elementalInteraction("wood", "earth").multiplier, 1.28);
assert.equal(elementalInteraction("wood", "metal").relation, "受剋");
assert.equal(elementalInteraction("wood", "metal").multiplier, 0.72);
assert.equal(elementalInteraction("wood", "wood").multiplier, 1.08);

for (const element of FIVE_PHASE_ELEMENTS) {
  const ids = new Set();
  const names = new Set();
  for (let ordinal = 0; ordinal < CULTIVATION_TECHNIQUE_CAPACITY_PER_ELEMENT; ordinal += 1) {
    const record = cultivationTechniqueAt({
      storySeed,
      element: element.id,
      ordinal,
      context: ancientContext,
    });
    ids.add(record.id);
    names.add(record.name);
    assert.equal(record.element, element.id);
    assert.equal(record.era, "ancient");
    assert.equal(record.isCrossEra, false);
    assert.ok(record.baseMultiplier >= 1.05 && record.baseMultiplier <= 1.4);
    assert.match(record.requirement, /前置|周天/u);
    assert.match(record.limitation, /0\.72|不得跳卷/u);
  }
  assert.equal(ids.size, 1_000, `${element.label}系功法 ID 必須有 1,000 種`);
  assert.equal(names.size, 1_000, `${element.label}系功法名稱必須有 1,000 種`);
}

const ancientProductionCatalogs = ["talisman", "formation", "weapon", "pill", "herb"];
for (const catalog of ancientProductionCatalogs) {
  const ids = new Set();
  const names = new Set();
  for (let ordinal = 0; ordinal < MASTERY_CATALOG_CAPACITY; ordinal += 1) {
    const record = masteryCatalogRecordAt({
      storySeed,
      catalog,
      ordinal,
      context: ancientContext,
    });
    ids.add(record.id);
    names.add(record.name);
    assert.equal(record.era, "ancient");
    assert.notEqual(record.element, null);
    assert.ok(record.successMultiplier >= 1.05 && record.successMultiplier <= 1.45);
    assert.ok(record.qualityMultiplier >= 1.02 && record.qualityMultiplier <= 1.3);
    assert.ok(record.riskMultiplier >= 0.72 && record.riskMultiplier <= 1.2);
    assert.match(record.cost, /×\d+\.\d{2}/u);
  }
  assert.equal(ids.size, 1_000, `${catalog} 必須可尋址 1,000 種`);
  assert.equal(names.size, 1_000, `${catalog} 必須有 1,000 個不同名稱`);
}

const modernCatalogs = ["combat", "profession", ...ancientProductionCatalogs];
for (const catalog of modernCatalogs) {
  for (const ordinal of [0, 1, 42, 511, 999]) {
    const record = masteryCatalogRecordAt({ storySeed, catalog, ordinal, context: modernContext });
    assert.equal(record.era, "modern");
    assert.equal(record.storyEra, "modern");
    assert.equal(record.element, null);
    assert.equal(record.isCrossEra, false);
    assert.doesNotMatch(record.name, /護身符|聚靈陣|療傷丹|續命靈芝|靈弓/u);
  }
}
assert.match(
  masteryCatalogRecordAt({ storySeed, catalog: "combat", ordinal: 42, context: modernContext }).catalogLabel,
  /現代戰技|功夫/u,
);
assert.match(
  masteryCatalogRecordAt({ storySeed, catalog: "profession", ordinal: 42, context: modernContext }).catalogLabel,
  /現代專業/u,
);

assert.throws(
  () => cultivationTechniqueAt({ storySeed, element: "fire", ordinal: 1, context: modernContext }),
  /CROSS_ERA_REQUIRES_EXPLICIT_STORY_SIGNAL/u,
);
assert.throws(
  () => masteryCatalogRecordAt({
    storySeed,
    catalog: "weapon",
    ordinal: 1,
    context: modernContext,
    sourceEra: "future",
  }),
  /CROSS_ERA_REQUIRES_EXPLICIT_STORY_SIGNAL/u,
);
const crossedTechnique = cultivationTechniqueAt({
  storySeed,
  element: "fire",
  ordinal: 1,
  context: { ...modernContext, storyTags: ["現代", "穿越"] },
});
assert.equal(crossedTechnique.storyEra, "modern");
assert.equal(crossedTechnique.era, "ancient");
assert.equal(crossedTechnique.isCrossEra, true);
assert.equal(crossedTechnique.compatibilityGate, "explicit-cross-era");

const techniquePage = cultivationTechniquePage({
  storySeed,
  element: "water",
  pageIndex: 2,
  pageSize: 17,
  context: ancientContext,
});
assert.equal(techniquePage.items.length, 17);
assert.equal(techniquePage.items[0].ordinal, 34);
assert.equal(techniquePage.total, 1_000);
assert.equal(techniquePage.totalPages, 59);
const catalogPage = masteryCatalogPage({
  storySeed,
  catalog: "pill",
  pageIndex: 58,
  pageSize: 17,
  context: modernContext,
});
assert.equal(catalogPage.items.length, 14);
assert.equal(catalogPage.items.at(-1).ordinal, 999);
assert.equal(catalogPage.total, 1_000);
assert.throws(
  () => masteryCatalogPage({ storySeed, catalog: "pill", pageIndex: 0, pageSize: 101, context: modernContext }),
  /PAGE_SIZE_INVALID/u,
);
assert.throws(
  () => masteryCatalogRecordAt({ storySeed, catalog: "pill", ordinal: 1_000, context: modernContext }),
  /ORDINAL_OUT_OF_RANGE/u,
);

const matrix = new DeterministicSocialMatrix({ seed: storySeed, context: ancientContext, cacheLimit: 32 });
const startedAt = performance.now();
const ancientProfile = characterMasteryProfileAt({
  storySeed,
  populationIndex: 42,
  context: ancientContext,
  socialMatrix: matrix,
});
const replay = characterMasteryProfileAt({
  storySeed,
  populationIndex: 42,
  context: ancientContext,
  socialMatrix: matrix,
});
assert.deepEqual(replay, ancientProfile);
assert.ok(performance.now() - startedAt < 2_000, "單一人物不得物化整批人物或專長目錄");
assert.equal(ancientProfile.heldTreasure.holder.characterId, ancientProfile.characterId);
assert.equal(ancientProfile.storyEra, "ancient");
assert.notEqual(ancientProfile.primaryElement, null);
assert.deepEqual(new Set(ancientProfile.assignments.map((item) => item.relation)), new Set([
  "uses", "makes", "cultivates", "holds",
]));
assert.ok(ancientProfile.assignments.some((item) => item.referenceType === "cultivation-technique"));
assert.ok(ancientProfile.assignments.every((item) => item.proficiency >= 1 && item.proficiency <= 100));
assert.ok(ancientProfile.assignments.every((item) => item.effectiveMultiplier > 0));

const modernProfile = characterMasteryProfileAt({
  storySeed,
  populationIndex: 42,
  context: modernContext,
});
assert.equal(modernProfile.storyEra, "modern");
assert.equal(modernProfile.primaryElement, null);
assert.ok(modernProfile.assignments.every((item) => item.era === "modern"));
assert.ok(modernProfile.assignments.every((item) => item.referenceType !== "cultivation-technique"));
assert.ok(modernProfile.assignments.some((item) => item.catalogLabel.includes("現代戰技")));
assert.ok(modernProfile.assignments.some((item) => item.catalogLabel.includes("現代專業")));

const finalIndexedProfile = characterMasteryProfileAt({
  storySeed,
  populationIndex: 99_999,
  context: { genre: "未來星際科幻", location: "軌道城" },
});
assert.equal(finalIndexedProfile.populationIndex, 99_999);
assert.equal(finalIndexedProfile.storyEra, "future");
assert.equal(finalIndexedProfile.heldTreasure.era.sourceEra, "future");
assert.ok(finalIndexedProfile.assignments.every((item) => item.era === "future"));

const facts = characterMasteryDecisionFacts(ancientProfile);
assert.ok(facts.length >= ancientProfile.assignments.length);
assert.ok(facts.some((fact) => fact.kind === "elemental" && fact.consequence.includes("受剋 ×0.72")));
assert.ok(facts.some((fact) => fact.kind === "ownership"));
assert.ok(facts.every((fact) => fact.statement.includes(ancientProfile.characterName)));
const narrativeContext = characterMasteryNarrativeContext(ancientProfile);
assert.match(narrativeContext, /人物修習與持有物/u);
assert.match(narrativeContext, /會使用/u);
assert.match(narrativeContext, /會製作/u);
assert.match(narrativeContext, /持有/u);
assert.match(narrativeContext, /栽培/u);
assert.match(narrativeContext, /不能把專長當成自動成功/u);
assert.ok(narrativeContext.length < 5_000, "閉端 AI／後備只應取得單一人物的緊湊事實區塊");

console.log(JSON.stringify({
  ok: true,
  version: CHARACTER_MASTERY_LIBRARY_VERSION,
  cultivationTechniques: CULTIVATION_TECHNIQUE_TOTAL_CAPACITY,
  perCatalog: MASTERY_CATALOG_CAPACITY,
  productionCatalogs: ancientProductionCatalogs.length,
  relations: [...new Set(ancientProfile.assignments.map((item) => item.relationLabel))],
  ancientAssignments: ancientProfile.assignments.length,
  modernAssignments: modernProfile.assignments.length,
  narrativeContextLength: narrativeContext.length,
}, null, 2));

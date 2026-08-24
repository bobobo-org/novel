import assert from "node:assert/strict";
import {
  CULTIVATION_REALM_ORDER,
  TOPIC_WORLD_CONTRACT_VERSION,
  listTopicWorldContractTopics,
  topicWorldContractAt,
} from "../lib/novel-ai/game/topic-world-contract.ts";
import {
  buildProjectBundle,
  createDraft,
} from "../lib/novel-ai/domain/creation.ts";
import { optionalValue } from "../lib/novel-ai/domain/index.ts";

const topics = listTopicWorldContractTopics();
assert.equal(topics.length, 218);
assert.equal(new Set(topics.map((topic) => topic.topicId)).size, 218);

const cultivation = topicWorldContractAt({
  seed: "xianxia-contract",
  topicId: "classic-topic-009",
  playMode: "rpg",
  worldOrdinal: 37,
});
const cultivationReplay = topicWorldContractAt({
  seed: "xianxia-contract",
  topicId: "classic-topic-009",
  playMode: "rpg",
  worldOrdinal: 37,
});
assert.deepEqual(cultivationReplay, cultivation);
assert.equal(cultivation.schemaVersion, TOPIC_WORLD_CONTRACT_VERSION);
assert.equal(cultivation.worldFamily, "cultivation");
assert.equal(cultivation.worldOrdinal, 37);
assert.ok(cultivation.displaySummary.includes("仙俠修真"));
assert.ok(cultivation.canonRules.some((rule) => rule.includes(CULTIVATION_REALM_ORDER.join(" → "))));
for (const realm of ["凡人", "煉氣", "築基", "金丹", "元嬰", "化神", "煉虛", "合體", "大乘", "渡劫"]) {
  assert.ok(cultivation.canonRules.some((rule) => rule.includes(realm)), `missing cultivation realm: ${realm}`);
}
for (const institution of ["宗門", "修行家族", "散修盟", "坊市與商會"]) {
  assert.ok(cultivation.institutions.some((entry) => entry.startsWith(`${institution}：`)), `missing institution: ${institution}`);
}
for (const asset of ["功法", "寶物", "丹藥", "符籙", "陣法", "武器／法器", "靈草", "秘境機緣"]) {
  assert.ok(cultivation.assets.some((entry) => entry.startsWith(`${asset}：`)), `missing cultivation asset: ${asset}`);
}
assert.equal(cultivation.institutions.length, 4);
assert.equal(cultivation.assets.length, 8);
assert.doesNotMatch(
  JSON.stringify({
    displaySummary: cultivation.displaySummary,
    canonRules: cultivation.canonRules,
    institutions: cultivation.institutions,
    assets: cultivation.assets,
  }),
  /移動城市|質押|公共稽核|公民裁決|跨區交通|基礎設施|交付窗口|現金安全線|供應鏈/u,
  "cultivation contracts must not leak generic civic or management-world vocabulary",
);

const differentWorld = topicWorldContractAt({
  seed: "xianxia-contract",
  topicId: "classic-topic-009",
  playMode: "rpg",
  worldOrdinal: 38,
});
assert.notEqual(differentWorld.contractId, cultivation.contractId);
assert.notEqual(differentWorld.displaySummary, cultivation.displaySummary);

// The cultivation adapter has its own 10 × 10 × 10 mixed-radix setting axes.
// Check all 1,000 settings rather than relying on IDs to claim uniqueness.
const cultivationContractIds = new Set();
const cultivationSettings = new Set();
for (let worldOrdinal = 0; worldOrdinal < 1_000; worldOrdinal += 1) {
  const contract = topicWorldContractAt({
    seed: "cultivation-thousand-worlds",
    topicId: "classic-topic-009",
    playMode: "general",
    worldOrdinal,
  });
  const cultivationText = JSON.stringify({
    displaySummary: contract.displaySummary,
    canonRules: contract.canonRules,
    institutions: contract.institutions,
    assets: contract.assets,
  });
  cultivationContractIds.add(contract.contractId);
  cultivationSettings.add(contract.displaySummary);
  assert.doesNotMatch(
    cultivationText,
    /移動城市|質押|公共稽核|公民裁決|跨區交通|基礎設施|交付窗口|現金安全線|供應鏈/u,
    `cultivation world ${worldOrdinal} leaked generic procedural vocabulary`,
  );
}
assert.equal(cultivationContractIds.size, 1_000);
assert.equal(cultivationSettings.size, 1_000, "cultivation settings must be semantically distinct without counting IDs");

const possession = topicWorldContractAt({
  seed: "possession-contract",
  topicId: "classic-topic-001",
  playMode: "general",
  worldOrdinal: 0,
});
assert.equal(possession.worldFamily, "topic-derived");
assert.ok(possession.displaySummary.includes("附身變身"));
assert.ok(
  [...possession.canonRules, ...possession.institutions, ...possession.assets]
    .some((entry) => entry.includes("男生附身女生")),
  "topic-derived contract must use its own subcategory signals",
);
assert.ok(!possession.canonRules.some((rule) => rule.includes("煉氣 → 築基")));

// Every official classic topic has a compact replayable contract that carries
// topic-specific data instead of merely swapping the displayed topic name.
const contractIds = new Set();
for (const topic of topics) {
  const contract = topicWorldContractAt({
    seed: "all-topic-contracts",
    topicId: topic.topicId,
    playMode: "general",
    worldOrdinal: 0,
  });
  contractIds.add(contract.contractId);
  assert.equal(contract.topicId, topic.topicId);
  assert.ok(contract.displaySummary.includes(topic.name));
  assert.ok(contract.canonRules.length >= 5);
  assert.ok(contract.institutions.length >= 4);
  assert.ok(contract.assets.length >= 4);
  const sourceTerms = [...topic.tags, ...topic.subCategories, ...topic.recommendedWorlds];
  assert.ok(
    sourceTerms.some((term) => [
      contract.displaySummary,
      ...contract.canonRules,
      ...contract.institutions,
      ...contract.assets,
    ].some((entry) => entry.includes(term))),
    `${topic.topicId} must retain topic-specific source signals`,
  );
  assert.deepEqual(
    topicWorldContractAt({
      seed: "all-topic-contracts",
      topicId: topic.topicId,
      playMode: "general",
      worldOrdinal: 0,
    }),
    contract,
  );
}
assert.equal(contractIds.size, 218);

const mechanics = Object.fromEntries(
  ["general", "rpg", "romance", "management"].map((playMode) => [
    playMode,
    topicWorldContractAt({
      seed: "play-overlay",
      topicId: "classic-topic-009",
      playMode,
      worldOrdinal: 12,
    }),
  ]),
);
assert.deepEqual(mechanics.rpg.playMechanics.dimensions, ["能力", "裝備", "任務", "體力／行動點"]);
assert.deepEqual(mechanics.romance.playMechanics.dimensions, ["關係", "信任", "事件進度", "人物成長"]);
assert.deepEqual(mechanics.management.playMechanics.dimensions, ["資金", "人力", "品質", "聲望", "風險"]);
assert.deepEqual(mechanics.general.playMechanics.dimensions, ["人物目標", "世界規則", "因果後果", "伏筆回收"]);
assert.deepEqual(mechanics.rpg.canonRules, mechanics.romance.canonRules);
assert.deepEqual(mechanics.rpg.institutions, mechanics.management.institutions);
assert.deepEqual(mechanics.rpg.assets, mechanics.general.assets);
assert.ok(!mechanics.rpg.playMechanics.dimensions.includes("信任"));
assert.ok(!mechanics.rpg.playMechanics.dimensions.includes("資金"));
assert.ok(!mechanics.romance.playMechanics.dimensions.includes("裝備"));
assert.ok(!mechanics.romance.playMechanics.dimensions.includes("品質"));
assert.ok(!mechanics.management.playMechanics.dimensions.includes("能力"));
assert.ok(!mechanics.management.playMechanics.dimensions.includes("信任"));
assert.doesNotMatch(JSON.stringify(mechanics.rpg.playMechanics), /關係|信任|事件進度|人物成長|資金|人力|品質|聲望|風險/u);
assert.doesNotMatch(JSON.stringify(mechanics.romance.playMechanics), /能力|裝備|任務|體力|行動點|資金|人力|品質|聲望|風險/u);
assert.doesNotMatch(JSON.stringify(mechanics.management.playMechanics), /能力|裝備|任務|體力|行動點|關係|信任|事件進度|人物成長/u);

const cultivationDraft = createDraft("quick");
cultivationDraft.title = "修仙世界合約整合驗證";
cultivationDraft.genreId = "classic-topic-009";
cultivationDraft.protagonist = optionalValue("沈星河", "user_defined");
cultivationDraft.answers.protagonist = cultivationDraft.protagonist;
cultivationDraft.answers.playMode = optionalValue("rpg", "user_defined");
cultivationDraft.answers.worldRule = optionalValue(
  "靈氣衰竭後，各宗門與修行家族爭奪殘存靈脈。",
  "user_defined",
);
const cultivationBundle = buildProjectBundle(cultivationDraft);
assert.equal(cultivationBundle.cast?.length, 6);
assert.equal(cultivationBundle.relationships?.length, 8);
assert.equal(cultivationBundle.storyBible.characterIds.length, 7);
assert.ok(cultivationBundle.world);
assert.ok(cultivationBundle.worldRules?.some((rule) => rule.description.includes("凡人 → 煉氣 → 築基")));
assert.equal(cultivationBundle.lore?.filter((entry) => entry.kind === "faction").length, 5);
assert.equal(cultivationBundle.lore?.filter((entry) => entry.kind === "item").length, 8);
for (const asset of ["功法", "寶物", "丹藥", "符籙", "陣法", "法器", "靈草", "秘境"]) {
  assert.ok(
    cultivationBundle.lore?.some((entry) => (
      entry.kind === "item" && entry.title.startsWith(`${asset}｜`)
    )),
    `project bundle missing ${asset}`,
  );
}
assert.equal(cultivationBundle.storyState.worldFlags["story.castReady"], true);
assert.equal(cultivationBundle.storyState.worldFlags["story.castSize"], 7);
assert.equal(cultivationBundle.storyState.worldFlags["story.topicWorldContract"], TOPIC_WORLD_CONTRACT_VERSION);
assert.equal(cultivationBundle.storyState.worldFlags["story.topicId"], "classic-topic-009");
assert.equal(cultivationBundle.storyState.worldFlags["story.worldFamily"], "cultivation");
assert.equal(cultivationBundle.storyState.worldFlags["story.playDimensions"], "能力、裝備、任務、體力／行動點");
assert.equal(cultivationBundle.storyState.worldFlags["story.organizationCount"], 4);
assert.equal(cultivationBundle.storyState.worldFlags["story.assetControlCount"], 8);
assert.equal(cultivationBundle.storyState.worldFlags["story.familyStageApproved"], true);
assert.equal(cultivationBundle.storyState.worldFlags["story.virtualCharacterCapacity"], 100_000);
assert.equal(cultivationBundle.storyState.worldFlags["story.virtualTreasureCapacity"], 100_000);
assert.equal(cultivationBundle.storyState.worldFlags["story.relationshipScenarioCapacity"], 1_000_000);
assert.deepEqual(
  cultivationBundle.initialBackup.snapshot.worldRules,
  cultivationBundle.worldRules,
);
assert.deepEqual(
  cultivationBundle.initialBackup.snapshot.lore,
  cultivationBundle.lore,
);

assert.throws(
  () => topicWorldContractAt({ seed: "", topicId: "classic-topic-009", playMode: "general" }),
  /TOPIC_WORLD_CONTRACT_SEED_REQUIRED/u,
);
assert.throws(
  () => topicWorldContractAt({ seed: "x", topicId: "missing", playMode: "general" }),
  /TOPIC_WORLD_CONTRACT_TOPIC_NOT_FOUND/u,
);
assert.throws(
  () => topicWorldContractAt({ seed: "x", topicId: "classic-topic-009", playMode: "general", worldOrdinal: 1_000 }),
  /TOPIC_WORLD_CONTRACT_WORLD_ORDINAL_OUT_OF_RANGE/u,
);

console.log(JSON.stringify({
  ok: true,
  schemaVersion: TOPIC_WORLD_CONTRACT_VERSION,
  topics: topics.length,
  cultivationWorlds: cultivationSettings.size,
  cultivationRealms: CULTIVATION_REALM_ORDER.length,
  playModes: Object.keys(mechanics),
}, null, 2));

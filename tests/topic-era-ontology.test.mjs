import assert from "node:assert/strict";
import {
  IDENTITY_MECHANISMS,
  STORY_ERAS,
  TOPIC_ERA_CAPACITY,
  createIdentityMechanismOverlay,
  listTopicEraProfiles,
  topicEraProfileAt,
} from "../lib/novel-ai/game/topic-era-ontology.ts";

const profiles = listTopicEraProfiles();
assert.equal(profiles.length, 218);
assert.equal(new Set(profiles.map((profile) => profile.topicId)).size, 218);

const internalCodePattern = /classic-topic-|(?:world|treasure)-[a-z0-9-]+|[・｜|]\s*(?=[A-Z0-9]{3,8}\s*[・｜|])(?=[A-Z0-9]*\d)[A-Z0-9]{3,8}/iu;
const requiredArrays = [
  "supportedEras",
  "settingTags",
  "addressTerms",
  "institutionTypes",
  "occupations",
  "resourceTypes",
  "identityMechanisms",
];

for (const profile of profiles) {
  assert.ok(profile.topicName.length > 0, `${profile.topicId}: topicName`);
  assert.ok(profile.premise.length > 30, `${profile.topicId}: premise`);
  assert.ok(STORY_ERAS.includes(profile.primaryEra), `${profile.topicId}: primaryEra`);
  for (const field of requiredArrays) {
    assert.ok(Array.isArray(profile[field]) && profile[field].length > 0, `${profile.topicId}: ${field}`);
  }
  assert.deepEqual(profile.identityMechanisms, [...IDENTITY_MECHANISMS]);
  assert.equal(profile.contentBoundary.originalCharactersOnly, true);
  assert.equal(profile.contentBoundary.consentRequired, true);
  assert.equal(profile.contentBoundary.nonExplicit, true);
  assert.ok(profile.contentBoundary.rules.length >= 3);

  const visiblePayload = JSON.stringify({
    topicName: profile.topicName,
    premise: profile.premise,
    settingTags: profile.settingTags,
    addressTerms: profile.addressTerms,
    institutionTypes: profile.institutionTypes,
    occupations: profile.occupations,
    resourceTypes: profile.resourceTypes,
    contentBoundary: profile.contentBoundary,
  });
  assert.doesNotMatch(visiblePayload, internalCodePattern, `${profile.topicId}: internal code leaked`);
}

const possession = topicEraProfileAt("classic-topic-001");
assert.equal(possession.topicName, "附身變身");
assert.deepEqual(new Set(possession.supportedEras), new Set(STORY_ERAS));

// The catalog title is authoritative for the primary ontology. These records
// intentionally contain cross-genre trap words in descriptions, tags or
// subcategories; those words may extend supported eras, but must not replace
// the topic's primary social vocabulary.
const urbanFantasy = topicEraProfileAt("都市奇幻");
assert.equal(urbanFantasy.primaryEra, "contemporary");
assert.ok(urbanFantasy.institutionTypes.includes("都市異常事件應變組"));
assert.ok(urbanFantasy.occupations.includes("異常調查員"));
assert.ok(!urbanFantasy.institutionTypes.includes("學校"));

const management = topicEraProfileAt("經營養成");
assert.equal(management.primaryEra, "contemporary");
assert.ok(management.institutionTypes.includes("營運團隊"));
assert.ok(management.resourceTypes.includes("品質"));
assert.ok(!management.resourceTypes.includes("功法"));

const scienceFuture = topicEraProfileAt("科幻未來");
assert.equal(scienceFuture.primaryEra, "future");
assert.ok(scienceFuture.institutionTypes.includes("星際聯盟"));
assert.ok(scienceFuture.occupations.includes("工程師"));
assert.ok(!scienceFuture.institutionTypes.includes("學校"));

const militaryWar = topicEraProfileAt("軍事戰爭");
assert.equal(militaryWar.primaryEra, "contemporary");
assert.ok(militaryWar.institutionTypes.includes("軍事單位"));
assert.ok(militaryWar.occupations.includes("軍官"));
assert.ok(!militaryWar.occupations.includes("醫師"));

const spaceOpera = topicEraProfileAt("星球冒險與太空歌劇");
assert.equal(spaceOpera.primaryEra, "future");
assert.ok(spaceOpera.settingTags.includes("太空站"));
assert.ok(spaceOpera.institutionTypes.includes("星際聯盟"));
assert.ok(!spaceOpera.institutionTypes.includes("軍事單位"));

const climateScienceFiction = topicEraProfileAt("氣候科幻");
assert.equal(climateScienceFiction.primaryEra, "future");
assert.ok(climateScienceFiction.institutionTypes.includes("研究院"));

const contexts = {
  school: createIdentityMechanismOverlay({
    topicIdOrName: "附身變身",
    mechanism: "mutual-body-swap",
    context: "school",
  }),
  corporate: createIdentityMechanismOverlay({
    topicIdOrName: "classic-topic-001",
    mechanism: "one-way-possession",
    context: "corporate",
  }),
  adult: createIdentityMechanismOverlay({
    topicIdOrName: "classic-topic-001",
    mechanism: "co-consciousness",
    context: "adult-industry",
  }),
  court: createIdentityMechanismOverlay({
    topicIdOrName: "classic-topic-001",
    mechanism: "role-identity-swap",
    context: "historical-court",
  }),
  cultivation: createIdentityMechanismOverlay({
    topicIdOrName: "classic-topic-001",
    mechanism: "transmigration-into-body",
    context: "cultivation",
  }),
};

assert.ok(contexts.school.occupations.includes("學生"));
assert.ok(contexts.corporate.addressTerms.includes("執行長"));
assert.ok(contexts.adult.occupations.includes("成年表演工作者"));
assert.ok(contexts.court.addressTerms.includes("君主"));
assert.ok(contexts.cultivation.addressTerms.includes("宗主"));
assert.doesNotMatch(
  JSON.stringify(contexts.school),
  /宗門|煉氣|築基|金丹|元嬰/u,
  "school possession must not silently become cultivation",
);
assert.doesNotMatch(
  JSON.stringify(contexts.corporate),
  /宗門|煉氣|築基|金丹|元嬰/u,
  "corporate possession must not silently become cultivation",
);
assert.equal(contexts.adult.contentBoundary.audience, "adult");
assert.ok(contexts.adult.contentBoundary.rules.some((rule) => rule.includes("成年")));
assert.ok(contexts.adult.contentBoundary.rules.some((rule) => rule.includes("原創角色")));
assert.ok(contexts.adult.contentBoundary.rules.some((rule) => rule.includes("可撤回同意")));
assert.ok(contexts.adult.contentBoundary.rules.some((rule) => rule.includes("非露骨")));

for (const overlay of Object.values(contexts)) {
  assert.ok(overlay.rolePairs.length >= 2);
  assert.ok(overlay.continuityRules.length >= 4);
  assert.doesNotMatch(JSON.stringify(overlay), internalCodePattern);
}

assert.deepEqual(TOPIC_ERA_CAPACITY, {
  classicTopicCount: 218,
  materializedProfileCount: 218,
  expandedVariantStorage: "seeded-on-demand",
  preStoredExpandedWorldRows: 0,
  disclosure:
    "本體規格逐一覆蓋 218 類經典題材；延伸世界依題材與種子按需組合，本模組沒有預存 218,000 筆世界資料。",
});
assert.match(TOPIC_ERA_CAPACITY.disclosure, /按需組合/u);
assert.match(TOPIC_ERA_CAPACITY.disclosure, /沒有預存/u);

assert.throws(() => topicEraProfileAt("不存在的題材"), /TOPIC_ERA_ONTOLOGY_TOPIC_NOT_FOUND/u);
assert.throws(
  () =>
    createIdentityMechanismOverlay({
      topicIdOrName: "不存在的題材",
      mechanism: "mutual-body-swap",
    }),
  /TOPIC_ERA_ONTOLOGY_TOPIC_NOT_FOUND/u,
);

console.log(
  JSON.stringify({
    status: "PASS",
    profiles: profiles.length,
    possessionContexts: Object.keys(contexts),
    capacity: TOPIC_ERA_CAPACITY,
  }),
);

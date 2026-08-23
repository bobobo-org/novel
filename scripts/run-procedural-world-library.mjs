import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  PROCEDURAL_WORLD_CAPACITY,
  PROCEDURAL_WORLD_CONFLICT_CAPACITY,
  PROCEDURAL_WORLD_CONFLICTS_PER_WORLD,
  PROCEDURAL_WORLD_FACTION_CAPACITY,
  PROCEDURAL_WORLD_FACTIONS_PER_WORLD,
  PROCEDURAL_WORLD_LIBRARY_VERSION,
  PROCEDURAL_WORLD_MATERIALIZATION_POLICY,
  PROCEDURAL_WORLD_RESEARCH_POLICY,
  PROCEDURAL_WORLD_RESOURCE_CAPACITY,
  PROCEDURAL_WORLD_RESOURCES_PER_WORLD,
  PROCEDURAL_WORLD_RULE_CAPACITY,
  PROCEDURAL_WORLD_RULES_PER_WORLD,
  PROCEDURAL_WORLD_TOPIC_CAPACITY,
  PROCEDURAL_WORLD_VARIANTS_PER_TOPIC,
  listProceduralWorldTopics,
  proceduralWorldAt,
  proceduralWorldAtGlobalOrdinal,
  proceduralWorldByAddress,
  proceduralWorldConflictIdAt,
  proceduralWorldFactionIdAt,
  proceduralWorldLibraryDiagnostics,
  proceduralWorldPage,
  proceduralWorldResourceIdAt,
  proceduralWorldRuleIdAt,
  proceduralWorldSemanticSignatureAt,
} from "../lib/novel-ai/game/procedural-world-library.ts";
import {
  PROCEDURAL_CAUSAL_DIMENSIONS,
  PROCEDURAL_ORIGIN_POLICY,
} from "../lib/novel-ai/game/procedural-story-library.ts";
import { proceduralTreasureRecordAt } from "../lib/novel-ai/game/procedural-treasure-library.ts";
import { DeterministicSocialMatrix } from "../lib/novel-ai/social-matrix/index.ts";

assert.equal(PROCEDURAL_WORLD_LIBRARY_VERSION, "procedural-world-library-v1");
assert.equal(PROCEDURAL_WORLD_MATERIALIZATION_POLICY, "indexed-on-demand-no-world-blobs");
assert.equal(PROCEDURAL_WORLD_RESEARCH_POLICY, "abstract-popular-story-mechanisms-original-output-only");
assert.equal(PROCEDURAL_WORLD_TOPIC_CAPACITY, 218);
assert.equal(PROCEDURAL_WORLD_VARIANTS_PER_TOPIC, 1_000);
assert.equal(PROCEDURAL_WORLD_CAPACITY, 218_000);
assert.equal(PROCEDURAL_WORLD_RULES_PER_WORLD, 5);
assert.equal(PROCEDURAL_WORLD_RULE_CAPACITY, 1_090_000);
assert.equal(PROCEDURAL_WORLD_FACTIONS_PER_WORLD, 4);
assert.equal(PROCEDURAL_WORLD_FACTION_CAPACITY, 872_000);
assert.equal(PROCEDURAL_WORLD_RESOURCES_PER_WORLD, 4);
assert.equal(PROCEDURAL_WORLD_RESOURCE_CAPACITY, 872_000);
assert.equal(PROCEDURAL_WORLD_CONFLICTS_PER_WORLD, 3);
assert.equal(PROCEDURAL_WORLD_CONFLICT_CAPACITY, 654_000);

const diagnostics = proceduralWorldLibraryDiagnostics();
assert.deepEqual(diagnostics, {
  schemaVersion: "procedural-world-library-v1",
  sourceStoryLibrarySchemaVersion: "story-library-v1",
  materializationPolicy: "indexed-on-demand-no-world-blobs",
  researchPolicy: "abstract-popular-story-mechanisms-original-output-only",
  originPolicy: "original-procedural-fiction-no-real-person-or-social-account",
  packs: 11,
  classicTopics: 218,
  worldsPerTopic: 1_000,
  addressableWorlds: 218_000,
  addressableWorldFactions: 872_000,
  addressableWorldRules: 1_090_000,
  addressableWorldResources: 872_000,
  addressableWorldConflicts: 654_000,
  materializedWorldBlobs: 0,
  characters: 100_000,
  treasures: 100_000,
  relationshipScenarios: 1_000_000,
  theoreticalCharacterTreasurePairs: 10_000_000_000,
  causalDimensions: 10,
});

const topics = listProceduralWorldTopics();
assert.equal(topics.length, 218);
assert.equal(new Set(topics.map((topic) => topic.topicId)).size, 218);
assert.ok(topics.every((topic) => topic.worlds >= 1_000));
assert.equal(new Set(topics.map((topic) => topic.topicOrdinal)).size, 218);

const context = {
  playMode: "RPG 養成",
  protagonist: "測試主角",
  location: "斷脈藥谷",
};
const topicId = topics[0].topicId;
const first = proceduralWorldAt({ seed: "world-replay", topicId, worldOrdinal: 0, context });
const replay = proceduralWorldAt({ seed: "world-replay", topicId, worldOrdinal: 0, context });
const lastInTopic = proceduralWorldAt({ seed: "world-replay", topicId, worldOrdinal: 999, context });
assert.deepEqual(replay, first);
assert.notEqual(first.id, lastInTopic.id);
assert.equal(first.fictional, true);
assert.equal(first.originPolicy, PROCEDURAL_ORIGIN_POLICY);
assert.equal(first.topic.topicId, topicId);
assert.equal(first.causalDimensions.length, 10);
assert.deepEqual(first.causalDimensions.map((dimension) => dimension.id), PROCEDURAL_CAUSAL_DIMENSIONS.map((dimension) => dimension.id));
assert.equal(first.factions.length, 4);
assert.equal(new Set(first.factions.map((faction) => faction.id)).size, 4);
assert.deepEqual(first.factions.map((faction) => faction.id), Array.from(
  { length: PROCEDURAL_WORLD_FACTIONS_PER_WORLD },
  (_, factionOrdinal) => proceduralWorldFactionIdAt({
    seed: "world-replay",
    globalOrdinal: first.globalOrdinal,
    factionOrdinal,
  }),
));
assert.equal(first.rules.length, 5);
assert.match(first.rules[0].id, /^world-rule-[0-9a-z]{28}-[0-9a-z]{5}-[0-9a-z]{28}$/u);
assert.deepEqual(first.rules.map((rule) => rule.id), Array.from(
  { length: PROCEDURAL_WORLD_RULES_PER_WORLD },
  (_, ruleOrdinal) => proceduralWorldRuleIdAt({
    seed: "world-replay",
    globalOrdinal: first.globalOrdinal,
    ruleOrdinal,
  }),
));
assert.equal(first.resources.length, 4);
assert.deepEqual(first.resources.map((resource) => resource.id), Array.from(
  { length: PROCEDURAL_WORLD_RESOURCES_PER_WORLD },
  (_, resourceOrdinal) => proceduralWorldResourceIdAt({
    seed: "world-replay",
    globalOrdinal: first.globalOrdinal,
    resourceOrdinal,
  }),
));
assert.equal(first.conflicts.length, 3);
assert.deepEqual(first.conflicts.map((conflict) => conflict.id), Array.from(
  { length: PROCEDURAL_WORLD_CONFLICTS_PER_WORLD },
  (_, conflictOrdinal) => proceduralWorldConflictIdAt({
    seed: "world-replay",
    globalOrdinal: first.globalOrdinal,
    conflictOrdinal,
  }),
));
assert.equal(first.characters.length, 3);
assert.equal(new Set(first.characters.map((character) => character.characterId)).size, 3);
assert.equal(first.treasures.length, 1);
assert.equal(first.treasures[0].holderCharacterId, first.characters[0].characterId);
assert.ok(first.anchors.continuityInvariant.includes(`${topicId}/0`));
assert.ok(first.narrativeSafeguards.characterAutonomy.includes("拒絕"));
assert.ok(first.narrativeSafeguards.originality.includes("不複製"));

// The world must reference the exact same root-seed character and treasure
// records exposed by SocialWorldLibrary. No cast/ensemble or prop seed fork is
// allowed to create look-alike IDs that cannot be resolved in those libraries.
const sharedMatrix = new DeterministicSocialMatrix({
  seed: "world-replay",
  context,
  cacheLimit: 0,
});
const sharedTreasure = proceduralTreasureRecordAt({
  storySeed: "world-replay",
  ordinal: first.treasures[0].treasureOrdinal,
  context,
  socialMatrix: sharedMatrix,
});
assert.deepEqual(
  first.characters.map((character) => character.characterId),
  sharedTreasure.crossMatrix.castCharacterIds,
);
for (const characterReference of first.characters) {
  const socialCharacter = sharedMatrix.getCharacterById(characterReference.characterId);
  assert.ok(socialCharacter, `world character must resolve in root social matrix: ${characterReference.characterId}`);
  assert.equal(characterReference.characterOrdinal, socialCharacter.populationIndex);
  assert.equal(characterReference.name, socialCharacter.name);
  assert.ok(characterReference.characterId.startsWith(`character-${sharedMatrix.seedTag}-`));
}
assert.equal(first.treasures[0].treasureId, sharedTreasure.id);
assert.ok(first.treasures[0].treasureId.startsWith(`treasure-${sharedMatrix.seedTag}-`));
assert.equal(first.treasures[0].holderCharacterId, sharedTreasure.holder.characterId);
assert.equal(first.treasures[0].holderCharacterName, sharedTreasure.holder.characterName);
assert.equal(first.relationshipScenario.scenarioId, sharedTreasure.crossMatrix.scenarioId);
assert.equal(first.relationshipScenario.scenarioOrdinal, sharedTreasure.crossMatrix.scenarioOrdinal);
assert.deepEqual(first.causalDimensions, sharedTreasure.causalDimensions);

const globalFirst = proceduralWorldAtGlobalOrdinal({ seed: "global", ordinal: 0 });
const globalLast = proceduralWorldAtGlobalOrdinal({ seed: "global", ordinal: 217_999 });
assert.equal(globalFirst.topicOrdinal, 0);
assert.equal(globalFirst.worldOrdinal, 0);
assert.equal(globalLast.topicOrdinal, 217);
assert.equal(globalLast.worldOrdinal, 999);
assert.notEqual(globalFirst.id, globalLast.id);

const allPage = proceduralWorldPage({ seed: "page", offset: 999, limit: 4 });
assert.equal(allPage.totalItems, 218_000);
assert.equal(allPage.items.length, 4);
assert.equal(allPage.items[0].worldOrdinal, 999);
assert.equal(allPage.items[1].worldOrdinal, 0);
assert.equal(allPage.hasPreviousPage, true);
assert.equal(allPage.hasNextPage, true);

const topicPage = proceduralWorldPage({ seed: "page", topicId, offset: 990, limit: 10 });
assert.equal(topicPage.totalItems, 1_000);
assert.equal(topicPage.items.length, 10);
assert.equal(topicPage.hasNextPage, false);
assert.ok(topicPage.items.every((world) => world.topic.topicId === topicId));

const packPage = proceduralWorldPage({ seed: "page", packId: "pack-11", offset: 217_998, limit: 2 });
assert.equal(packPage.totalItems, 218_000);
assert.equal(packPage.items.length, 2);
assert.equal(packPage.items[1].globalOrdinal, 217_999);
const byAddress = proceduralWorldByAddress({ seed: "page", packId: "pack-11", topicOrdinal: 0, worldOrdinal: 0 });
assert.equal(byAddress.topic.topicId, topics[0].topicId);

assert.throws(() => proceduralWorldAt({ seed: "x", topicId, worldOrdinal: 1_000 }), /WORLD_ORDINAL_OUT_OF_RANGE/u);
assert.throws(() => proceduralWorldAtGlobalOrdinal({ seed: "x", ordinal: 218_000 }), /GLOBAL_WORLD_ORDINAL_OUT_OF_RANGE/u);
assert.throws(() => proceduralWorldAt({ seed: "x", topicId: "missing", worldOrdinal: 0 }), /WORLD_TOPIC_NOT_FOUND/u);
assert.throws(() => proceduralWorldPage({ seed: "x", topicId, packId: "pack-1" }), /WORLD_PAGE_FILTER_CONFLICT/u);
assert.throws(() => proceduralWorldPage({ seed: "x", limit: 101 }), /WORLD_PAGE_LIMIT_INVALID/u);
assert.throws(() => proceduralWorldRuleIdAt({ seed: "x", globalOrdinal: 218_000, ruleOrdinal: 0 }), /GLOBAL_WORLD_ORDINAL_OUT_OF_RANGE/u);
assert.throws(() => proceduralWorldRuleIdAt({ seed: "x", globalOrdinal: 0, ruleOrdinal: 5 }), /WORLD_RULE_ORDINAL_OUT_OF_RANGE/u);
assert.throws(() => proceduralWorldFactionIdAt({ seed: "x", globalOrdinal: 0, factionOrdinal: 4 }), /WORLD_FACTION_ORDINAL_OUT_OF_RANGE/u);
assert.throws(() => proceduralWorldResourceIdAt({ seed: "x", globalOrdinal: 0, resourceOrdinal: 4 }), /WORLD_RESOURCE_ORDINAL_OUT_OF_RANGE/u);
assert.throws(() => proceduralWorldConflictIdAt({ seed: "x", globalOrdinal: 0, conflictOrdinal: 3 }), /WORLD_CONFLICT_ORDINAL_OUT_OF_RANGE/u);

// Every official classic topic is demonstrably addressable at both ends of
// its 1,000-world segment. This audits the full 218-topic index without
// materializing 218,000 records.
const sampledWorldIds = new Set();
const sampledRootMatrix = new DeterministicSocialMatrix({
  seed: "topic-capacity",
  cacheLimit: 0,
});
for (const topic of topics) {
  for (const worldOrdinal of [0, 499, 999]) {
    const world = proceduralWorldAt({ seed: "topic-capacity", topicId: topic.topicId, worldOrdinal });
    sampledWorldIds.add(world.id);
    assert.equal(world.topic.topicId, topic.topicId);
    assert.ok(world.title.includes(topic.name));
    const descriptionTerms = world.topic.description.split(/[、，；。／/:：]+/u).filter(Boolean);
    const topicTags = world.topic.tags.length > 0 ? world.topic.tags : [world.topic.name];
    assert.ok(descriptionTerms.some((term) => world.title.includes(term)), `${topic.topicId} title must use its description`);
    assert.ok(topicTags.some((tag) => world.title.includes(tag)), `${topic.topicId} title must use its tags`);
    for (const [label, content] of [
      ["logline", world.logline],
      ["anchors", JSON.stringify(world.anchors)],
      ["socialStructure", JSON.stringify(world.socialStructure)],
      ["factions", JSON.stringify(world.factions)],
      ["rules", JSON.stringify(world.rules)],
      ["resources", JSON.stringify(world.resources)],
      ["conflicts", JSON.stringify(world.conflicts)],
    ]) {
      assert.ok(content.includes(world.topic.name), `${topic.topicId} ${label} must use topic name`);
      assert.ok(content.includes(world.topic.description), `${topic.topicId} ${label} must use topic description`);
      assert.ok(topicTags.some((tag) => content.includes(tag)), `${topic.topicId} ${label} must use topic tags`);
    }
    assert.equal(world.causalDimensions.length, 10);
    assert.ok(world.characters.every((character) => character.characterId.startsWith("character-")));
    assert.ok(world.treasures.every((treasure) => treasure.treasureId.startsWith("treasure-")));
    for (const characterReference of world.characters) {
      const character = sampledRootMatrix.getCharacterById(characterReference.characterId);
      assert.ok(character, `sampled character must resolve in root matrix: ${characterReference.characterId}`);
      assert.equal(character.name, characterReference.name);
      assert.equal(character.populationIndex, characterReference.characterOrdinal);
    }
    const treasureReference = world.treasures[0];
    const treasure = proceduralTreasureRecordAt({
      storySeed: "topic-capacity",
      ordinal: treasureReference.treasureOrdinal,
      socialMatrix: sampledRootMatrix,
    });
    assert.equal(treasure.id, treasureReference.treasureId);
    assert.equal(treasure.holder.characterId, treasureReference.holderCharacterId);
    assert.equal(treasure.holder.characterName, treasureReference.holderCharacterName);
    assert.equal(treasure.crossMatrix.scenarioId, world.relationshipScenario.scenarioId);
    const serialized = JSON.stringify(world);
    assert.doesNotMatch(serialized, /https?:\/\//u);
    assert.doesNotMatch(serialized, /@[A-Za-z0-9_]{2,}/u);
  }
}
assert.equal(sampledWorldIds.size, 218 * 3);

// Full-capacity collision audit. Every rule ID carries the bijective linear
// address globalWorldOrdinal * 5 + ruleOrdinal; the content fingerprint is an
// additional content-addressed integrity suffix rather than the uniqueness
// mechanism. This enumerates all 1,090,000 canonical rule IDs without
// materializing any worlds.
const allRuleIds = new Set();
for (let globalOrdinal = 0; globalOrdinal < PROCEDURAL_WORLD_CAPACITY; globalOrdinal += 1) {
  for (let ruleOrdinal = 0; ruleOrdinal < PROCEDURAL_WORLD_RULES_PER_WORLD; ruleOrdinal += 1) {
    const ruleId = proceduralWorldRuleIdAt({ seed: "full-rule-address-audit", globalOrdinal, ruleOrdinal });
    const linearAddress = globalOrdinal * PROCEDURAL_WORLD_RULES_PER_WORLD + ruleOrdinal;
    const address = linearAddress.toString(36).padStart(5, "0");
    assert.equal(ruleId.split("-")[3], address, `rule ID must expose reversible address ${address}`);
    assert.equal(allRuleIds.has(ruleId), false, `rule ID collision at ${globalOrdinal}/${ruleOrdinal}`);
    allRuleIds.add(ruleId);
  }
}
assert.equal(allRuleIds.size, PROCEDURAL_WORLD_RULE_CAPACITY);
const auditedRuleIds = allRuleIds.size;
allRuleIds.clear();

function auditEntityIds({ kind, capacity, itemsPerWorld, idAt }) {
  const ids = new Set();
  for (let globalOrdinal = 0; globalOrdinal < PROCEDURAL_WORLD_CAPACITY; globalOrdinal += 1) {
    for (let itemOrdinal = 0; itemOrdinal < itemsPerWorld; itemOrdinal += 1) {
      const id = idAt(globalOrdinal, itemOrdinal);
      const linearAddress = globalOrdinal * itemsPerWorld + itemOrdinal;
      const address = linearAddress.toString(36).padStart(5, "0");
      assert.equal(id.split("-").at(-1), address, `${kind} ID must expose reversible address ${address}`);
      assert.equal(ids.has(id), false, `${kind} ID collision at ${globalOrdinal}/${itemOrdinal}`);
      ids.add(id);
    }
  }
  assert.equal(ids.size, capacity);
  const audited = ids.size;
  ids.clear();
  return audited;
}

const auditedFactionIds = auditEntityIds({
  kind: "faction",
  capacity: PROCEDURAL_WORLD_FACTION_CAPACITY,
  itemsPerWorld: PROCEDURAL_WORLD_FACTIONS_PER_WORLD,
  idAt: (globalOrdinal, factionOrdinal) => proceduralWorldFactionIdAt({
    seed: "full-entity-address-audit",
    globalOrdinal,
    factionOrdinal,
  }),
});
const auditedResourceIds = auditEntityIds({
  kind: "resource",
  capacity: PROCEDURAL_WORLD_RESOURCE_CAPACITY,
  itemsPerWorld: PROCEDURAL_WORLD_RESOURCES_PER_WORLD,
  idAt: (globalOrdinal, resourceOrdinal) => proceduralWorldResourceIdAt({
    seed: "full-entity-address-audit",
    globalOrdinal,
    resourceOrdinal,
  }),
});
const auditedConflictIds = auditEntityIds({
  kind: "conflict",
  capacity: PROCEDURAL_WORLD_CONFLICT_CAPACITY,
  itemsPerWorld: PROCEDURAL_WORLD_CONFLICTS_PER_WORLD,
  idAt: (globalOrdinal, conflictOrdinal) => proceduralWorldConflictIdAt({
    seed: "full-entity-address-audit",
    globalOrdinal,
    conflictOrdinal,
  }),
});

function semanticSignatureFromWorld(world) {
  return JSON.stringify({
    title: world.title,
    logline: world.logline,
    anchors: {
      era: world.anchors.era,
      geography: world.anchors.geography,
      publicPromise: world.anchors.publicPromise,
    },
    socialStructure: world.socialStructure,
    factions: world.factions.map((faction) => ({
      name: faction.name,
      kind: faction.kind,
      publicGoal: faction.publicGoal,
      leverage: faction.leverage,
      internalContradiction: faction.internalContradiction,
    })),
    rules: world.rules.map((rule) => ({
      statement: rule.statement,
      enforcement: rule.enforcement,
      consequence: rule.consequence,
      exception: rule.exception,
    })),
    resources: world.resources.map((resource) => ({
      name: resource.name,
      access: resource.access,
      scarcity: resource.scarcity,
      socialLeverage: resource.socialLeverage,
      failureEffect: resource.failureEffect,
    })),
    conflicts: world.conflicts.map((conflict) => ({
      pressure: conflict.pressure,
      trackableContradiction: conflict.trackableContradiction,
      escalation: conflict.escalation,
      closureCondition: conflict.closureCondition,
    })),
  });
}

assert.equal(
  proceduralWorldSemanticSignatureAt({ seed: "world-replay", topicId, worldOrdinal: 0 }),
  semanticSignatureFromWorld(first),
  "semantic-only audit must describe the exact materialized world without IDs, people or treasures",
);

let auditedSemanticWorlds = 0;
for (const topic of topics) {
  const semanticWorlds = new Set();
  for (let worldOrdinal = 0; worldOrdinal < PROCEDURAL_WORLD_VARIANTS_PER_TOPIC; worldOrdinal += 1) {
    const signature = proceduralWorldSemanticSignatureAt({
      seed: "semantic-capacity",
      topicId: topic.topicId,
      worldOrdinal,
    });
    assert.doesNotMatch(signature, /(?:world|character|treasure)-(?:faction|resource|conflict|rule|[0-9a-z])/u);
    semanticWorlds.add(signature);
  }
  assert.equal(semanticWorlds.size, PROCEDURAL_WORLD_VARIANTS_PER_TOPIC, `${topic.topicId} must expose 1,000 distinct narrative world settings`);
  auditedSemanticWorlds += semanticWorlds.size;
}
assert.equal(auditedSemanticWorlds, PROCEDURAL_WORLD_CAPACITY);

const performanceStart = performance.now();
for (let ordinal = 0; ordinal < 1_000; ordinal += 1) {
  proceduralWorldAtGlobalOrdinal({
    seed: "world-performance",
    ordinal: (ordinal * 47_999) % PROCEDURAL_WORLD_CAPACITY,
  });
}
const thousandDecodeMs = performance.now() - performanceStart;
assert.ok(thousandDecodeMs < 3_000, `1,000 O(1) world decodes took ${thousandDecodeMs.toFixed(2)}ms`);

console.log(JSON.stringify({
  ok: true,
  diagnostics,
  auditedTopicAddresses: sampledWorldIds.size,
  auditedRuleIds,
  auditedFactionIds,
  auditedResourceIds,
  auditedConflictIds,
  auditedSemanticWorlds,
  thousandDecodeMs: Number(thousandDecodeMs.toFixed(2)),
}, null, 2));

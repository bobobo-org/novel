import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  PROCEDURAL_TREASURE_CLASSIFICATION_VERSION,
  PROCEDURAL_TREASURE_KIND_DEFINITIONS,
  proceduralTreasureClassificationAt,
} from "../lib/novel-ai/game/procedural-treasure-classification.ts";
import {
  PROCEDURAL_TREASURE_ERA_VERSION,
  resolveProceduralTreasureStoryEra,
} from "../lib/novel-ai/game/procedural-treasure-era.ts";
import {
  PROCEDURAL_TREASURE_VISUAL_VARIANTS_PER_ASSET,
  PROCEDURAL_TREASURE_VISUAL_VERSION,
  proceduralTreasureVisualAt,
} from "../lib/novel-ai/game/procedural-treasure-visual.ts";
import {
  PROCEDURAL_CAUSAL_DIMENSIONS,
  PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
  PROCEDURAL_TREASURE_CAPACITY,
  proceduralTreasureAt,
} from "../lib/novel-ai/game/procedural-story-library.ts";
import {
  PROCEDURAL_TREASURE_CACHE_MAX,
  PROCEDURAL_TREASURE_LIBRARY_VERSION,
  PROCEDURAL_TREASURE_MATERIALIZATION_POLICY,
  PROCEDURAL_TREASURE_PAGE_MAX,
  PROCEDURAL_TREASURE_SCENARIO_VARIANTS_PER_TREASURE,
  createProceduralTreasureLibrary,
  proceduralTreasureRecordAt,
  proceduralTreasureScenarioBindingAt,
  proceduralTreasureScenarioBindingFromId,
  proceduralTreasureScenarioBindingFromOrdinal,
} from "../lib/novel-ai/game/procedural-treasure-library.ts";
import {
  PROCEDURAL_TREASURE_OWNERSHIP_PAGE_MAX,
  PROCEDURAL_TREASURE_OWNERSHIP_VERSION,
  treasureHolderPopulationIndex,
  treasureOrdinalsHeldByPopulationIndex,
  treasureStakeholderPopulationIndices,
} from "../lib/novel-ai/game/procedural-treasure-ownership.ts";
import { DeterministicSocialMatrix } from "../lib/novel-ai/social-matrix/index.ts";

const storySeed = "treasure-social-cross-matrix";
const context = {
  genre: "仙俠群像",
  playMode: "三選一互動",
  protagonist: "沈星河",
  location: "星砂礦區",
  conflict: "三個勢力同時追查失落陣眼",
};

assert.equal(PROCEDURAL_TREASURE_LIBRARY_VERSION, "procedural-treasure-library-v4");
assert.equal(
  PROCEDURAL_TREASURE_CLASSIFICATION_VERSION,
  "procedural-treasure-classification-v2",
);
assert.equal(PROCEDURAL_TREASURE_ERA_VERSION, "procedural-treasure-era-v1");
assert.equal(PROCEDURAL_TREASURE_VISUAL_VERSION, "procedural-treasure-visual-v1");
assert.equal(PROCEDURAL_TREASURE_VISUAL_VARIANTS_PER_ASSET, 96);
assert.equal(PROCEDURAL_TREASURE_KIND_DEFINITIONS.length, 10);
assert.deepEqual(new Set(PROCEDURAL_TREASURE_KIND_DEFINITIONS.map((item) => item.id)), new Set([
  "weapon", "artifact", "talisman", "pill", "herb", "formation", "armor", "material", "manual", "special-opportunity",
]));
assert.equal(PROCEDURAL_TREASURE_OWNERSHIP_VERSION, "procedural-treasure-ownership-v1");
assert.equal(PROCEDURAL_TREASURE_MATERIALIZATION_POLICY, "indexed-on-demand-bounded-lru");
assert.equal(PROCEDURAL_TREASURE_CAPACITY, 100_000);
assert.equal(PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY, 1_000_000);
assert.equal(PROCEDURAL_CAUSAL_DIMENSIONS.length, 10);
assert.equal(PROCEDURAL_TREASURE_PAGE_MAX, 100);
assert.equal(PROCEDURAL_TREASURE_OWNERSHIP_PAGE_MAX, 100);
assert.equal(PROCEDURAL_TREASURE_CACHE_MAX, 2_048);
assert.equal(PROCEDURAL_TREASURE_SCENARIO_VARIANTS_PER_TREASURE, 10);

const matrix = new DeterministicSocialMatrix({ seed: storySeed, context, cacheLimit: 0 });
const first = proceduralTreasureRecordAt({
  storySeed,
  ordinal: 42,
  context,
  socialMatrix: matrix,
});
const replay = proceduralTreasureRecordAt({
  storySeed,
  ordinal: 42,
  context,
  socialMatrix: matrix,
});
assert.deepEqual(replay, first);
assert.equal(first.id, proceduralTreasureAt({ seed: storySeed, ordinal: 42, context }).id);
assert.equal(first.fictional, true);
assert.equal(first.abilities.length, 2);
assert.ok(first.abilities.every((ability) => ability.effect.length > 18));
assert.ok(first.abilities.every((ability) => ability.activation.length >= 6));
assert.ok(first.cost.length > 18);
assert.ok(first.limitation.length > 18);
assert.ok(first.storyHook.includes(first.name));
assert.ok(first.storyHook.includes(first.holder.characterName));
assert.equal(first.era.storyEra, "ancient");
assert.equal(first.era.sourceEra, "ancient");
assert.equal(first.era.isCrossEra, false);
assert.equal(first.visual.baseAsset, `/item-icons/${first.kind}.webp`);
assert.equal(first.visual.variant >= 0 && first.visual.variant < 96, true);
assert.equal(first.visual.era, first.era.sourceEra);
assert.equal(first.stakeholders.length, 3);
assert.equal(new Set(first.stakeholders.map((entry) => entry.characterId)).size, 3);
assert.equal(first.causalDimensions.length, 10);
assert.deepEqual(
  first.causalDimensions.map((dimension) => dimension.id),
  PROCEDURAL_CAUSAL_DIMENSIONS.map((dimension) => dimension.id),
);
assert.ok(first.causalDimensions.every((dimension) => dimension.signal.length > 20));
assert.equal(first.crossMatrix.causalDimensionCount, 10);
assert.equal(first.crossMatrix.relationshipScenarioCapacity, 1_000_000);
assert.equal(first.crossMatrix.treasureOrdinal, first.ordinal);
assert.equal(first.crossMatrix.treasureId, first.id);
assert.ok(first.crossMatrix.scenarioOrdinal >= 0);
assert.ok(first.crossMatrix.scenarioOrdinal < 1_000_000);
assert.equal(
  Math.floor(
    first.crossMatrix.scenarioOrdinal
      / PROCEDURAL_TREASURE_SCENARIO_VARIANTS_PER_TREASURE,
  ),
  first.ordinal,
);
assert.equal(
  first.crossMatrix.scenarioOrdinal
    % PROCEDURAL_TREASURE_SCENARIO_VARIANTS_PER_TREASURE,
  first.crossMatrix.scenarioVariant,
);
assert.deepEqual(
  first.crossMatrix.castPopulationIndices,
  first.stakeholders.map((stakeholder) => stakeholder.populationIndex),
);
assert.deepEqual(
  first.crossMatrix.castCharacterIds,
  first.stakeholders.map((stakeholder) => stakeholder.characterId),
);
const bindingFromId = proceduralTreasureScenarioBindingFromId({
  storySeed,
  scenarioId: first.crossMatrix.scenarioId,
  context,
  socialMatrix: matrix,
});
assert.equal(bindingFromId.treasureOrdinal, first.ordinal);
assert.equal(bindingFromId.treasureId, first.id);
assert.deepEqual(bindingFromId.castCharacterIds, first.crossMatrix.castCharacterIds);
assert.deepEqual(
  proceduralTreasureScenarioBindingFromOrdinal({
    storySeed,
    scenarioOrdinal: first.crossMatrix.scenarioOrdinal,
    context,
    socialMatrix: matrix,
  }),
  bindingFromId,
);
assert.throws(
  () => proceduralTreasureScenarioBindingFromId({
    storySeed,
    scenarioId: `${first.crossMatrix.scenarioId.slice(0, -1)}${
      first.crossMatrix.scenarioId.endsWith("0") ? "1" : "0"
    }`,
    context,
    socialMatrix: matrix,
  }),
  /TREASURE_SCENARIO_ID_BINDING_MISMATCH/u,
);

const holderCharacter = matrix.getCharacter(first.holder.populationIndex);
assert.equal(first.holder.characterId, holderCharacter.characterId);
assert.equal(first.holder.factionId, holderCharacter.institutionId);
assert.equal(first.holder.familyId, holderCharacter.familyId);
assert.equal(
  first.holder.populationIndex,
  treasureHolderPopulationIndex({
    storySeed,
    treasureOrdinal: first.ordinal,
    populationSize: matrix.populationSize,
  }),
);
assert.deepEqual(
  first.crossMatrix.castPopulationIndices,
  Object.values(treasureStakeholderPopulationIndices({
    storySeed,
    treasureOrdinal: first.ordinal,
    populationSize: matrix.populationSize,
  })),
);

const variantBindings = Array.from(
  { length: PROCEDURAL_TREASURE_SCENARIO_VARIANTS_PER_TREASURE },
  (_, scenarioVariant) => proceduralTreasureScenarioBindingAt({
    storySeed,
    treasureOrdinal: first.ordinal,
    scenarioVariant,
    context,
    socialMatrix: matrix,
  }),
);
assert.equal(new Set(variantBindings.map((binding) => binding.scenarioId)).size, 10);
assert.deepEqual(
  variantBindings.map((binding) => binding.scenarioOrdinal),
  Array.from({ length: 10 }, (_, variant) => first.ordinal * 10 + variant),
);
assert.ok(variantBindings.every((binding) =>
  binding.treasureId === first.id
  && binding.castCharacterIds.join("|") === first.crossMatrix.castCharacterIds.join("|")));
const holderPage = treasureOrdinalsHeldByPopulationIndex({
  storySeed,
  populationIndex: first.holder.populationIndex,
  populationSize: matrix.populationSize,
});
assert.ok(holderPage.items.includes(first.ordinal));
const socialPossession = matrix.listCharacterPossessions(first.holder.populationIndex).items.find(
  (possession) => possession.treasureOrdinal === first.ordinal,
);
assert.ok(socialPossession);
assert.equal(socialPossession.treasureRef, first.id);
const expectedSocialKinds = [{
  weapon: "武器",
  artifact: "法寶",
  talisman: "符籙",
  pill: "丹藥",
  herb: "藥草",
  formation: "陣法",
  armor: "護具",
  material: "煉器材料",
  manual: "功法",
  "special-opportunity": "特殊機緣",
}[first.kind]];
assert.ok(expectedSocialKinds.includes(socialPossession.kind));

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const visuals = PROCEDURAL_TREASURE_KIND_DEFINITIONS.map((definition, ordinal) => proceduralTreasureVisualAt({
  storySeed,
  treasureId: `visual-${definition.id}`,
  ordinal,
  kind: definition.id,
  rarity: ordinal % 2 ? "common" : "legendary",
  era: "modern",
  eraLabel: "現代",
  isCrossEra: false,
}));
assert.equal(new Set(visuals.map((visual) => visual.baseAsset)).size, 8);
assert.ok(visuals.every((visual) => visual.baseAsset.startsWith("/item-icons/modern-")));
assert.ok(visuals.every((visual) => visual.assetCount === 18 && visual.variantsPerAsset === 96 && visual.assetTheme === "modern"));
assert.deepEqual(visuals, PROCEDURAL_TREASURE_KIND_DEFINITIONS.map((definition, ordinal) => proceduralTreasureVisualAt({
  storySeed,
  treasureId: `visual-${definition.id}`,
  ordinal,
  kind: definition.id,
  rarity: ordinal % 2 ? "common" : "legendary",
  era: "modern",
  eraLabel: "現代",
  isCrossEra: false,
})));
for (const visual of visuals) {
  await access(`${repoRoot}public${visual.baseAsset}`);
}
const ancientVisuals = PROCEDURAL_TREASURE_KIND_DEFINITIONS.map((definition, ordinal) => proceduralTreasureVisualAt({
  storySeed,
  treasureId: `ancient-visual-${definition.id}`,
  ordinal,
  kind: definition.id,
  rarity: "rare",
  era: "ancient",
  eraLabel: "古代／修行",
  isCrossEra: false,
}));
assert.equal(new Set(ancientVisuals.map((visual) => visual.baseAsset)).size, 10);
assert.ok(ancientVisuals.every((visual) => visual.assetTheme === "ancient" && !visual.baseAsset.includes("modern-")));
for (let index = 0; index < ancientVisuals.length; index += 1) {
  assert.notEqual(ancientVisuals[index].baseAsset, visuals[index].baseAsset);
  await access(`${repoRoot}public${ancientVisuals[index].baseAsset}`);
}

const modernContext = { ...context, genre: "現代企業懸疑", storyTags: ["當代城市"] };
assert.deepEqual(resolveProceduralTreasureStoryEra(modernContext), {
  era: "modern",
  eraLabel: "現代",
  allowsCrossEra: false,
});
const modernMatrix = new DeterministicSocialMatrix({ seed: `${storySeed}-modern`, context: modernContext, cacheLimit: 0 });
const modernRecords = Array.from({ length: 10 }, (_, ordinal) => proceduralTreasureRecordAt({
  storySeed: `${storySeed}-modern`,
  ordinal,
  context: modernContext,
  socialMatrix: modernMatrix,
}));
assert.equal(new Set(modernRecords.map((record) => record.kind)).size, 10);
assert.ok(modernRecords.every((record) => record.era.sourceEra === "modern" && !record.era.isCrossEra));
assert.ok(modernRecords.every((record) => /^[\p{Script=Han}A-Za-z／ ]+ [A-Z]{2}-\d{4}$/u.test(record.name)));
assert.ok(modernRecords.some((record) => /槍械|防衛/u.test(record.kindLabel)));
assert.ok(modernRecords.some((record) => /電子|晶片|實驗/u.test(record.kindLabel)));
assert.ok(modernRecords.some((record) => /醫藥/u.test(record.kindLabel)));
assert.ok(modernRecords.some((record) => /載具/u.test(record.kindLabel)));
assert.ok(modernRecords.some((record) => /文件|憑證/u.test(record.kindLabel)));

const crossEraContext = { ...modernContext, storyTags: ["現代城市", "穿越"] };
const crossEraMatrix = new DeterministicSocialMatrix({ seed: `${storySeed}-cross`, context: crossEraContext, cacheLimit: 0 });
const crossEraRecords = Array.from({ length: 44 }, (_, ordinal) => proceduralTreasureRecordAt({
  storySeed: `${storySeed}-cross`,
  ordinal,
  context: crossEraContext,
  socialMatrix: crossEraMatrix,
}));
assert.ok(crossEraRecords.some((record) => record.era.isCrossEra));
assert.ok(crossEraRecords.every((record) => record.era.sourceEra === "modern" || record.era.compatibilityGate === "explicit-cross-era"));

const socialWorldSource = await readFile(`${repoRoot}app/studio/project/[projectId]/social-world-library.tsx`, "utf8");
assert.match(socialWorldSource, /data-visual-variant/u);
assert.match(socialWorldSource, /data-badge="rarity"/u);
assert.match(socialWorldSource, /data-badge="era"/u);
assert.match(socialWorldSource, /mode = "reference-only"/u);
assert.match(socialWorldSource, /if \(!ensureHomeEdit\("核准寶物與持有人關係"\)\) return;/u);
const professionalSource = await readFile(`${repoRoot}app/professional/professional-client.tsx`, "utf8");
assert.match(professionalSource, /data-testid="professional-social-world-library"/u);
assert.match(professionalSource, /mode="home-edit"/u);
for (const store of ["characters", "lore", "operationJournal", "storyBibles", "worlds"]) {
  assert.ok(professionalSource.includes(`"${store}"`), `Professional home summary must load ${store}`);
}

// Prove the forward/reverse ownership contract exhaustively on a small prime
// capacity, then sample all boundary regions of the production 100k space.
const smallCapacity = 997;
const smallPopulation = 73;
const seenSmallTreasures = new Set();
for (let populationIndex = 0; populationIndex < smallPopulation; populationIndex += 1) {
  let cursor = null;
  do {
    const page = treasureOrdinalsHeldByPopulationIndex({
      storySeed,
      populationIndex,
      populationSize: smallPopulation,
      treasureCapacity: smallCapacity,
      cursor,
      limit: 11,
    });
    for (const ordinal of page.items) {
      assert.equal(
        treasureHolderPopulationIndex({
          storySeed,
          treasureOrdinal: ordinal,
          populationSize: smallPopulation,
          treasureCapacity: smallCapacity,
        }),
        populationIndex,
      );
      seenSmallTreasures.add(ordinal);
    }
    cursor = page.nextCursor;
  } while (cursor);
}
assert.equal(seenSmallTreasures.size, smallCapacity);

for (const ordinal of [0, 1, 99, 10_001, 49_999, 50_000, 99_998, 99_999]) {
  const populationIndex = treasureHolderPopulationIndex({
    storySeed,
    treasureOrdinal: ordinal,
    populationSize: 100_000,
  });
  const reverse = treasureOrdinalsHeldByPopulationIndex({
    storySeed,
    populationIndex,
    populationSize: 100_000,
  });
  assert.deepEqual(reverse.items, [ordinal]);
  assert.equal(reverse.total, 1);
}

const kinds = new Set();
const holderIds = new Set();
for (let ordinal = 0; ordinal < 100; ordinal += 1) {
  const record = proceduralTreasureRecordAt({
    storySeed,
    ordinal: (ordinal * 997) % PROCEDURAL_TREASURE_CAPACITY,
    context,
    socialMatrix: matrix,
  });
  kinds.add(record.kind);
  const classification = proceduralTreasureClassificationAt({
    storySeed,
    treasureOrdinal: record.ordinal,
  });
  assert.equal(record.kind, classification.kind);
  assert.equal(record.rarity, classification.rarity);
  holderIds.add(record.holder.characterId);
  assert.equal(record.id, proceduralTreasureAt({
    seed: storySeed,
    ordinal: record.ordinal,
    context,
  }).id);
  assert.equal(record.crossMatrix.treasureId, record.id);
  assert.equal(record.crossMatrix.treasureOrdinal, record.ordinal);
  assert.deepEqual(
    record.crossMatrix.castCharacterIds,
    record.stakeholders.map((stakeholder) => stakeholder.characterId),
  );
  assert.deepEqual(
    proceduralTreasureScenarioBindingFromId({
      storySeed,
      scenarioId: record.crossMatrix.scenarioId,
      context,
      socialMatrix: matrix,
    }).castPopulationIndices,
    record.crossMatrix.castPopulationIndices,
  );
}
assert.deepEqual(
  [...kinds].sort(),
  ["armor", "artifact", "formation", "herb", "manual", "material", "pill", "special-opportunity", "talisman", "weapon"],
);
assert.equal(holderIds.size, 100);

const library = createProceduralTreasureLibrary({
  storySeed,
  context,
  maxCacheEntries: 3,
});
assert.deepEqual(library.diagnostics(), {
  version: PROCEDURAL_TREASURE_LIBRARY_VERSION,
  capacity: 100_000,
  materializedEntries: 0,
  maxCacheEntries: 3,
  hits: 0,
  misses: 0,
});
library.at(0);
library.at(1);
library.at(2);
library.at(0);
library.at(3);
assert.deepEqual(library.diagnostics(), {
  version: PROCEDURAL_TREASURE_LIBRARY_VERSION,
  capacity: 100_000,
  materializedEntries: 3,
  maxCacheEntries: 3,
  hits: 1,
  misses: 4,
});
const page = library.page(2, 24);
assert.equal(page.items.length, 24);
assert.deepEqual(page.items.map((item) => item.ordinal), Array.from({ length: 24 }, (_, index) => 48 + index));
assert.equal(page.totalItems, 100_000);
assert.equal(page.totalPages, 4_167);
assert.equal(page.hasPreviousPage, true);
assert.equal(page.hasNextPage, true);
assert.equal(library.diagnostics().materializedEntries, 3);
const lastPage = library.page(4_166, 24);
assert.equal(lastPage.items.length, 16);
assert.equal(lastPage.items.at(-1).ordinal, 99_999);
assert.equal(lastPage.hasNextPage, false);
assert.equal(library.diagnostics().materializedEntries, 3);
library.clearCache();
assert.equal(library.diagnostics().materializedEntries, 0);

assert.throws(() => library.at(100_000), /TREASURE_LIBRARY_ORDINAL_OUT_OF_RANGE/u);
assert.throws(() => library.page(0, 101), /TREASURE_LIBRARY_PAGE_SIZE_INVALID/u);
assert.throws(() => library.page(4_167, 24), /TREASURE_LIBRARY_PAGE_INDEX_OUT_OF_RANGE/u);
assert.throws(
  () => createProceduralTreasureLibrary({ storySeed, maxCacheEntries: 2_049 }),
  /TREASURE_LIBRARY_CACHE_LIMIT_INVALID/u,
);
assert.throws(
  () => proceduralTreasureRecordAt({
    storySeed,
    ordinal: 0,
    socialMatrix: new DeterministicSocialMatrix({ seed: "another-seed" }),
  }),
  /TREASURE_LIBRARY_SOCIAL_MATRIX_SEED_MISMATCH/u,
);
assert.throws(
  () => treasureOrdinalsHeldByPopulationIndex({
    storySeed,
    populationIndex: 0,
    populationSize: 100,
    cursor: "invalid",
  }),
  /TREASURE_OWNERSHIP_CURSOR_INVALID/u,
);

const performanceLibrary = createProceduralTreasureLibrary({
  storySeed: "treasure-performance",
  context,
  maxCacheEntries: 32,
});
const startedAt = performance.now();
for (let ordinal = 0; ordinal < 1_000; ordinal += 1) {
  performanceLibrary.at((ordinal * 47_999) % PROCEDURAL_TREASURE_CAPACITY);
}
const thousandDecodeMs = performance.now() - startedAt;
assert.ok(thousandDecodeMs < 3_000, `1,000 treasure decodes took ${thousandDecodeMs.toFixed(2)}ms`);
assert.equal(performanceLibrary.diagnostics().materializedEntries, 32);

console.log(JSON.stringify({
  ok: true,
  version: PROCEDURAL_TREASURE_LIBRARY_VERSION,
  ownershipVersion: PROCEDURAL_TREASURE_OWNERSHIP_VERSION,
  treasureCapacity: PROCEDURAL_TREASURE_CAPACITY,
  relationshipScenarioCapacity: PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
  causalDimensions: PROCEDURAL_CAUSAL_DIMENSIONS.length,
  kinds: [...kinds].sort(),
  productionBoundarySamples: 8,
  exhaustiveOwnershipProofCapacity: smallCapacity,
  boundedCacheEntries: performanceLibrary.diagnostics().materializedEntries,
  thousandDecodeMs: Number(thousandDecodeMs.toFixed(2)),
}, null, 2));

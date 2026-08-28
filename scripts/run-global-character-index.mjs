import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { suggestedCatalogCharacterPortrait } from "../lib/novel-ai/character-portraits/assignment.ts";
import {
  createGlobalCharacterFromCatalog,
  GLOBAL_CHARACTER_CATALOG_CAPACITY,
  GLOBAL_CHARACTER_CATALOG_PAGE_SIZE,
  globalCatalogCharacterId,
  globalCatalogCharacterNumber,
} from "../lib/novel-ai/global-canon/index.ts";
import { globalIndexedWorldAt } from "../lib/novel-ai/game/global-world-index.ts";
import { characterMasteryProfileAt } from "../lib/novel-ai/game/character-mastery-library.ts";
import {
  buildStoryOrganizationBlueprints,
  buildStoryOrganizationDirectory,
  DeterministicSocialMatrix,
  organizationMatrixContext,
  resolveStoryOrganizationSetting,
} from "../lib/novel-ai/social-matrix/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const world = globalIndexedWorldAt({ ordinal: 1 });
const setting = resolveStoryOrganizationSetting({
  genre: world.classification.name,
  coreIdea: world.logline,
  worldEras: [world.eraLabel, world.blueprint.period],
  worldSummaries: [world.logline, ...world.blueprint.canonRules],
  sourceWorldId: world.id,
});
const context = organizationMatrixContext({
  setting,
  base: {
    genre: world.classification.name,
    playMode: "全域設定總編輯",
    storyTags: [world.eraLabel, world.primaryTopic.topicName],
  },
});
const seed = `global-canon:${world.id}`;
const blueprints = buildStoryOrganizationBlueprints({ seed, setting });
const matrix = new DeterministicSocialMatrix({
  seed,
  context,
  institutionCount: blueprints.length,
  institutionProfiles: blueprints,
  cacheLimit: 32,
});

assert.equal(GLOBAL_CHARACTER_CATALOG_CAPACITY, 100_000);
assert.equal(matrix.populationSize, GLOBAL_CHARACTER_CATALOG_CAPACITY);
assert.equal(GLOBAL_CHARACTER_CATALOG_PAGE_SIZE, 24);

const firstPage = matrix.listCharacters({ cursor: "characters:0", limit: GLOBAL_CHARACTER_CATALOG_PAGE_SIZE });
const finalPage = matrix.listCharacters({ cursor: "characters:99984", limit: GLOBAL_CHARACTER_CATALOG_PAGE_SIZE });
assert.equal(firstPage.total, 100_000);
assert.equal(firstPage.items.length, 24);
assert.equal(finalPage.items.length, 16);
assert.equal(finalPage.nextCursor, null);
assert.equal(firstPage.items[0].populationIndex, 0);
assert.equal(finalPage.items.at(-1)?.populationIndex, 99_999);
assert.equal(globalCatalogCharacterNumber(0), "第000001人物");
assert.equal(globalCatalogCharacterNumber(99_999), "第100000人物");
assert.equal(globalCatalogCharacterId(world.id, 0), `global-character:${world.id}:000001`);
assert.throws(() => globalCatalogCharacterId(world.id, 100_000), /GLOBAL_CHARACTER_CATALOG_INDEX_INVALID/u);

const sample = firstPage.items[7];
const signal = [
  world.classification.name,
  world.eraLabel,
  world.primaryTopic.topicName,
  world.logline,
  sample.name,
  sample.identity,
  sample.institutionRole,
  sample.familyRole,
  sample.storyAffinity,
  ...sample.personality.traits,
  ...sample.abilities.specialties,
].join("｜");
const portraitAsset = suggestedCatalogCharacterPortrait({
  stableId: `${world.id}:${sample.characterId}`,
  signal,
});
assert.equal(portraitAsset.assetUri.endsWith(".webp"), true, "catalog characters must use real WebP portrait atlases");
assert.equal(existsSync(join(root, "public", portraitAsset.assetUri.replace(/^\//u, ""))), true);
const approvedPortrait = {
  ...portraitAsset,
  approvedAt: "2026-08-28T00:00:00.000Z",
  approvedBy: "user",
  dataLeftDevice: false,
};
const mastery = characterMasteryProfileAt({
  storySeed: seed,
  populationIndex: sample.populationIndex,
  context,
  socialMatrix: matrix,
});
const saved = createGlobalCharacterFromCatalog({ character: sample, portrait: approvedPortrait, world, mastery });
assert.equal(saved.id, globalCatalogCharacterId(world.id, sample.populationIndex));
assert.equal(saved.provenance.origin, "system_catalog");
assert.equal(saved.provenance.dataLeftDevice, false);
assert.match(saved.provenance.sourceId ?? "", new RegExp(`${world.schemaVersion}.*${world.id}`));
assert.equal(saved.portrait?.assetUri.endsWith(".webp"), true);
assert.ok(saved.capabilities.length >= 10, "saved catalog character must retain specialties and numeric abilities");
assert.ok(saved.limitations.length >= 2, "saved catalog character must retain an explicit weakness boundary");
assert.ok(saved.capabilities.some((value) => /會使用|會製作|持有|栽培/u.test(value)), "saved character must retain mastery actions");
assert.ok(saved.limitations.some((value) => value.includes("代價")), "saved character must retain mastery costs");

const directory = buildStoryOrganizationDirectory({
  seed,
  setting,
  blueprints,
  institutions: blueprints.map((_, index) => matrix.getInstitution(index)),
});
assert.ok(
  directory.reduce((total, organization) => total + organization.currentMemberCount, 0) < GLOBAL_CHARACTER_CATALOG_CAPACITY,
  "organization rosters are a subset and must not replace the complete 100k index",
);

const source = readFileSync(join(root, "app/canon/canon-client.tsx"), "utf8");
const css = readFileSync(join(root, "app/canon/canon.module.css"), "utf8");
for (const marker of [
  'data-testid="global-character-index"',
  'data-testid="global-character-candidate-grid"',
  'data-testid="global-character-candidate"',
  "organizationCatalog.matrix.listCharacters",
  "GLOBAL_CHARACTER_CATALOG_CAPACITY",
  "保存為正式人物",
  "完整十萬人物引擎，不是組織名冊的子集",
  "修習／持有",
  "characterMasteryProfileAt",
  "characterCatalogOrdinal",
  "focusedCharacterIndex",
  'data-character-index={character.populationIndex}',
  'data-focused={focused}',
  'aria-busy={characterMasteryLoadedCount < characterCatalogPage.items.length}',
  'scrollIntoView({ behavior: "smooth", block: "center" })',
  "window.requestAnimationFrame(calculateNextPair)",
  "Math.min(items.length, cursor + 2)",
  'disabled={busy || !mastery}',
]) assert.ok(source.includes(marker), `global character UI missing ${marker}`);
assert.match(source, /人物索引<\/dt><dd>100,000/u);
assert.match(source, /每次只計算 \{GLOBAL_CHARACTER_CATALOG_PAGE_SIZE\} 人/u);
assert.ok(css.includes(".characterCatalogToolbar"));
assert.ok(css.includes('.recordCard[data-focused="true"]'), "exact character jump must have a visible focused state");
const mobile = css.slice(css.indexOf("@media (max-width: 720px)"), css.indexOf("@media (max-width: 380px)"));
assert.ok(mobile.includes(".characterCatalogToolbar { grid-template-columns: 1fr; }"));

console.log(JSON.stringify({
  suite: "global-character-index",
  status: "PASS",
  population: matrix.populationSize,
  pageSize: GLOBAL_CHARACTER_CATALOG_PAGE_SIZE,
  finalPageSize: finalPage.items.length,
  world: world.displayId,
  portrait: portraitAsset.id,
}, null, 2));

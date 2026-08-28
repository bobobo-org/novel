import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { proceduralTreasureRecordAt } from "../lib/novel-ai/game/procedural-treasure-library.ts";
import {
  createGlobalOrganizationMemory,
  createGlobalTreasureMemory,
} from "../lib/novel-ai/global-canon/catalog-memory.ts";
import {
  buildStoryOrganizationBlueprints,
  buildStoryOrganizationDirectory,
  DeterministicSocialMatrix,
  familyGenealogyPositionAt,
  familySurnameForOrganizationName,
  organizationMemberAtOffset,
  organizationMatrixContext,
  resolveStoryOrganizationSetting,
} from "../lib/novel-ai/social-matrix/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const storySeed = "global-canon-social-assets-contract";
const setting = resolveStoryOrganizationSetting({
  genre: "仙俠修真",
  coreIdea: "九峰宗門、修行世家與現代企業因明示時門協議共同治理一座城市。",
  worldEras: ["跨時代"],
  worldSummaries: ["宗門有峰堂、內外門、功法、符籙、丹藥與陣法。"],
  sourceWorldId: "global-world-000001",
});
const context = organizationMatrixContext({
  setting,
  base: { genre: "跨時代群像", playMode: "全域設定總編輯", storyTags: ["家族", "宗門", "企業"] },
});
const blueprints = buildStoryOrganizationBlueprints({ seed: storySeed, setting });
const matrix = new DeterministicSocialMatrix({
  seed: storySeed,
  context,
  institutionCount: blueprints.length,
  institutionProfiles: blueprints,
  cacheLimit: 24,
});
const directory = buildStoryOrganizationDirectory({
  seed: storySeed,
  setting,
  blueprints,
  institutions: blueprints.map((_, index) => matrix.getInstitution(index)),
});

for (const archetype of ["family", "sect", "enterprise"]) {
  const organization = directory.find((candidate) => candidate.archetype === archetype);
  assert.ok(organization, `missing ${archetype} organization`);
  assert.ok(organization.memberCapacity >= 1 && organization.memberCapacity <= 10_000);
  const saved = createGlobalOrganizationMemory({
    organization,
    catalogWorldId: "global-world-000001",
    catalogWorldLabel: "第000001世界",
  });
  assert.equal(saved.kind, "faction");
  assert.match(saved.id, /^global-organization:/u);
  assert.match(saved.content, /在籍：.+容量上限：.+10,000/u);
  assert.match(saved.content, /階層、房系與資產/u);
  if (archetype === "family") assert.match(saved.content, /家主|族長/u);
  if (archetype === "sect") assert.match(saved.content, /聖子|聖女/u);
  if (archetype === "enterprise") assert.match(saved.content, /董事長/u);
}

const familyOrganization = directory.find((candidate) => candidate.archetype === "family");
assert.ok(familyOrganization);
const familySurname = familySurnameForOrganizationName(familyOrganization.name);
for (let memberOffset = 0; memberOffset < Math.min(12, familyOrganization.currentMemberCount); memberOffset += 1) {
  const position = familyGenealogyPositionAt({
    organizationId: familyOrganization.organizationId,
    memberCount: familyOrganization.currentMemberCount,
    memberOffset,
  });
  const member = organizationMemberAtOffset({ matrix, organization: familyOrganization, memberOffset });
  if (position.lineageRole === "bloodline") {
    assert.ok(member.name.startsWith(familySurname));
    assert.equal(member.familyRole, "本姓血親");
  } else {
    assert.equal(member.name.startsWith(familySurname), false);
    assert.equal(member.familyRole, "外姓配偶（姻親入譜）");
  }
}

const ancient = proceduralTreasureRecordAt({
  storySeed,
  ordinal: 0,
  context: { genre: "古代修仙", playMode: "全域設定總編輯" },
});
const modern = proceduralTreasureRecordAt({
  storySeed,
  ordinal: 37,
  context: { genre: "現代企業懸疑", playMode: "全域設定總編輯" },
});
assert.equal(ancient.era.sourceEra, "ancient");
assert.equal(modern.era.sourceEra, "modern");
for (const treasure of [ancient, modern]) {
  assert.ok(existsSync(join(root, "public", treasure.visual.baseAsset.replace(/^\//u, ""))), `missing icon ${treasure.visual.baseAsset}`);
  const saved = createGlobalTreasureMemory({
    treasure,
    catalogWorldId: "global-world-000001",
    catalogWorldLabel: "第000001世界",
  });
  assert.equal(saved.kind, "item");
  assert.match(saved.id, /^global-treasure:/u);
  for (const field of ["類型：", "時代：", "持有人：", "持有組織：", "圖像資產："]) {
    assert.ok(saved.content.includes(field), `treasure memory missing ${field}`);
  }
}

const source = readFileSync(join(root, "app/canon/canon-client.tsx"), "utf8");
const css = readFileSync(join(root, "app/canon/canon.module.css"), "utf8");
for (const marker of [
  'id: "organizations"',
  'id: "treasures"',
  'data-testid="global-family-genealogy"',
  'data-testid="global-treasure-grid"',
  "saveOrganizationCandidate",
  "saveTreasureCandidate",
  "editSavedCatalogMemory",
  "copyRecord(saved)",
  "proceduralTreasureVisualCssVariables",
  "<Image src={treasure.visual.baseAsset}",
]) assert.ok(source.includes(marker), `canon UI missing ${marker}`);

const mobileStart = css.indexOf("@media (max-width: 720px)");
const mobileEnd = css.indexOf("@media (max-width: 380px)", mobileStart);
assert.ok(mobileStart >= 0 && mobileEnd > mobileStart, "mobile breakpoint missing");
const mobile = css.slice(mobileStart, mobileEnd);
for (const marker of [
  ".organizationBrowser { grid-template-columns: 1fr; }",
  ".organizationFacts, .genealogyGrid, .rosterGrid { grid-template-columns: 1fr; }",
  ".treasureGrid { grid-template-columns: 1fr; }",
  ".catalogActions { display: grid; grid-template-columns: 1fr; }",
]) assert.ok(mobile.includes(marker), `390px no-overflow contract missing ${marker}`);
assert.match(css, /\.shell\s*\{[\s\S]*?overflow-x:\s*clip;/u);

console.log(JSON.stringify({
  suite: "global-canon-social-assets",
  status: "PASS",
  organizations: directory.length,
  maximumOrganizationCapacity: Math.max(...directory.map((entry) => entry.memberCapacity)),
  treasureEras: [ancient.era.sourceEra, modern.era.sourceEra],
  iconAssets: [ancient.visual.baseAsset, modern.visual.baseAsset],
  mobileWidthContract: 390,
}, null, 2));

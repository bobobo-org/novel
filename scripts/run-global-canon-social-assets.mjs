import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { proceduralTreasureRecordAt } from "../lib/novel-ai/game/procedural-treasure-library.ts";
import { suggestedCatalogCharacterPortrait } from "../lib/novel-ai/character-portraits/assignment.ts";
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
assert.equal(directory.length, 30, "each indexed world must expose at least 30 organizations");
assert.equal(new Set(directory.map((organization) => organization.name)).size, 30);
assert.ok(new Set(directory.map((organization) => organization.era)).size > 1, "cross-era world must keep era-specific organizations");
assert.ok(new Set(directory.map((organization) => organization.specializationId)).size >= 10);
assert.equal(matrix.cacheStats().materializedCharacters, 0, "directory construction must remain lazy");
const relationshipNetwork = [...new Map(
  directory.flatMap((organization) => organization.relationships)
    .map((relationship) => [relationship.relationshipId, relationship]),
).values()];
assert.ok(directory.every((organization) => organization.relationships.length >= 2));
assert.ok(new Set(relationshipNetwork.map((relationship) => relationship.kind)).size >= 7);
assert.ok(relationshipNetwork.every((relationship) => (
  relationship.eraGate === "same-era"
  && relationship.classificationGate === "same-world-classification"
  && relationship.cause.length >= 12
  && relationship.history.length >= 12
  && relationship.currentStatus.length >= 12
  && relationship.publicStance.length >= 12
  && relationship.secretMotive.length >= 12
)));

for (const archetype of ["family", "sect", "enterprise"]) {
  const organization = directory.find((candidate) => candidate.archetype === archetype);
  assert.ok(organization, `missing ${archetype} organization`);
  assert.ok(organization.memberCapacity >= 1 && organization.memberCapacity <= 10_000);
  assert.ok(organization.specializationLabel.length >= 2);
  assert.ok(organization.hierarchy.children.some((node) => node.nodeId.endsWith(":node:specialization")));
  const saved = createGlobalOrganizationMemory({
    organization,
    organizationDirectory: directory,
    catalogWorldId: "global-world-000001",
    catalogWorldLabel: "第000001世界",
  });
  assert.equal(saved.kind, "faction");
  assert.match(saved.id, /^global-organization:/u);
  assert.match(saved.content, /在籍：.+容量上限：.+10,000/u);
  assert.match(saved.content, /階層、房系與資產/u);
  assert.match(saved.content, /專業定位：/u);
  assert.match(saved.content, /組織關係網：/u);
  assert.match(saved.content, /方向：.+(?:→|↔).+/u);
  assert.match(saved.content, /本組織立場：本組織為(?:作用發起方|作用承受方|雙向關係)/u);
  assert.match(saved.content, /起因：.+\n\s+歷史：.+\n\s+現況：/u);
  assert.doesNotMatch(saved.content, /對象：social-institution-/u, "saved relations should use readable organization names");
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
function portraitForOrganizationSurface(surfaceCharacter) {
  const canonicalCharacter = matrix.getCharacter(surfaceCharacter.populationIndex);
  return suggestedCatalogCharacterPortrait({
    stableId: `global-world-000001:${canonicalCharacter.characterId}`,
    signal: [
      setting.classificationLabel,
      setting.eraLabel,
      canonicalCharacter.name,
      canonicalCharacter.identity,
      canonicalCharacter.institutionRole,
      canonicalCharacter.familyRole,
      canonicalCharacter.storyAffinity,
      ...canonicalCharacter.personality.traits,
      ...canonicalCharacter.abilities.specialties,
    ].join("｜"),
  });
}

const firstFamilyMember = organizationMemberAtOffset({ matrix, organization: familyOrganization, memberOffset: 0 });
const firstFamilyPortrait = portraitForOrganizationSurface(firstFamilyMember);
assert.match(firstFamilyPortrait.assetUri, /^\/character-portraits\/atlas-.+\.webp$/u);
assert.ok(existsSync(join(root, "public", firstFamilyPortrait.assetUri.replace(/^\//u, ""))), "organization member portrait atlas must exist");
for (const organization of directory) {
  const sampledOffsets = [...new Set([0, Math.floor(organization.currentMemberCount / 2), organization.currentMemberCount - 1])]
    .filter((offset) => offset >= 0);
  for (const memberOffset of sampledOffsets) {
    const organizationMember = organizationMemberAtOffset({ matrix, organization, memberOffset });
    const canonicalMember = matrix.getCharacter(organizationMember.populationIndex);
    assert.equal(
      portraitForOrganizationSurface(organizationMember).id,
      portraitForOrganizationSurface(canonicalMember).id,
      `organization portrait must stay canonical for ${organization.organizationId}:${memberOffset}`,
    );
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
  'data-testid="global-organization-member-card"',
  'data-testid="global-organization-member-detail"',
  'data-testid="global-organization-relationships"',
  'data-testid="global-treasure-grid"',
  "saveOrganizationCandidate",
  "saveTreasureCandidate",
  "editSavedCatalogMemory",
  "copyRecord(saved)",
  "proceduralTreasureVisualCssVariables",
  "catalogCharacterPortraitForWorld",
  "const canonicalCharacter = matrix.getCharacter(character.populationIndex);",
  "<PortraitCrop portrait={portrait} className={styles.memberCardPortrait}",
  "<Image src={treasure.visual.baseAsset}",
  "relationship.directed",
  '`${source?.name ?? "未登錄組織"} → ${target?.name ?? "未登錄組織"}`',
  '`${source?.name ?? selectedOrganization.name} ↔ ${target?.name ?? counterpart?.name ?? "未登錄組織"}`',
  "本方角色",
  "本組織是作用發起方",
  "本組織是作用承受方",
  "本組織是雙向關係的一方",
]) assert.ok(source.includes(marker), `canon UI missing ${marker}`);

const mobileStart = css.indexOf("@media (max-width: 720px)");
const mobileEnd = css.indexOf("@media (max-width: 380px)", mobileStart);
assert.ok(mobileStart >= 0 && mobileEnd > mobileStart, "mobile breakpoint missing");
const mobile = css.slice(mobileStart, mobileEnd);
for (const marker of [
  ".organizationBrowser { grid-template-columns: 1fr; }",
  ".organizationFacts, .genealogyGrid, .rosterGrid, .organizationRelationGrid { grid-template-columns: 1fr; }",
  ".memberDialogBody { grid-template-columns: 1fr; padding: 10px; }",
  ".treasureGrid { grid-template-columns: 1fr; }",
  ".catalogActions { display: grid; grid-template-columns: 1fr; }",
]) assert.ok(mobile.includes(marker), `390px no-overflow contract missing ${marker}`);
assert.match(css, /\.shell\s*\{[\s\S]*?overflow-x:\s*clip;/u);

console.log(JSON.stringify({
  suite: "global-canon-social-assets",
  status: "PASS",
  organizations: directory.length,
  organizationRelationships: relationshipNetwork.length,
  maximumOrganizationCapacity: Math.max(...directory.map((entry) => entry.memberCapacity)),
  treasureEras: [ancient.era.sourceEra, modern.era.sourceEra],
  iconAssets: [ancient.visual.baseAsset, modern.visual.baseAsset],
  mobileWidthContract: 390,
}, null, 2));

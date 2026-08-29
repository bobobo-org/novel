import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildStoryOrganizationBlueprints,
  buildStoryOrganizationDirectory,
  cultivationProfileForOrganizationMember,
  DeterministicSocialMatrix,
  FAMILY_GENEALOGY_SEARCH_SCAN_MAX,
  FAMILY_GENEALOGY_VERSION,
  familyGenealogyBranches,
  familyGenealogyGenerationPage,
  familyGenealogyPositionAt,
  familyGenealogySearchPage,
  familySurnameForOrganizationName,
  organizationMatrixContext,
  organizationMemberAtOffset,
  organizationMemberPage,
  organizationMembershipForOffset,
  resolveActiveWorldOrganizationSetting,
  resolveStoryOrganizationSetting,
  storyOrganizationEraCompatible,
  STORY_ORGANIZATION_DIRECTORY_SIZE,
  STORY_ORGANIZATION_MEMBER_CAPACITY,
} from "../lib/novel-ai/social-matrix/index.ts";

function flattenHierarchy(root) {
  return [root, ...root.children.flatMap(flattenHierarchy)];
}

function uniqueOrganizationRelationships(directory) {
  return [...new Map(
    directory.flatMap((organization) => organization.relationships)
      .map((relationship) => [relationship.relationshipId, relationship]),
  ).values()];
}

function makeDirectory(seed, setting) {
  const blueprints = buildStoryOrganizationBlueprints({ seed, setting });
  const context = organizationMatrixContext({
    setting,
    base: {
      genre: setting.backgroundLabel,
      playMode: "三選一互動",
      storyTags: [setting.eraLabel],
    },
  });
  const matrix = new DeterministicSocialMatrix({
    seed,
    context,
    institutionCount: blueprints.length,
    institutionProfiles: blueprints,
    cacheLimit: 24,
  });
  const directory = buildStoryOrganizationDirectory({
    seed,
    setting,
    blueprints,
    institutions: blueprints.map((_, index) => matrix.getInstitution(index)),
  });
  return { blueprints, directory, matrix };
}

const cultivationSetting = resolveStoryOrganizationSetting({
  genre: "仙俠修真",
  coreIdea: "靈氣衰退後，宗門、修行世家與萬寶商會爭奪最後一條靈脈。",
  worldEras: ["架空修行時代"],
  worldSummaries: ["九峰並立，功法、符籙、丹藥與陣法都有正式傳承。"],
});
assert.equal(cultivationSetting.era, "cultivation");
assert.equal(cultivationSetting.allowsCrossEra, false);
assert.equal(cultivationSetting.sourceWorldId, null);

const activeModernWorldSetting = resolveActiveWorldOrganizationSetting({
  activeWorldId: "world-modern",
  worlds: [
    { id: "world-cultivation", era: "修仙時代", summary: "九峰宗門並立。" },
    { id: "world-modern", era: "現代", summary: "家族企業與董事會爭權。" },
  ],
  fallback: {
    genre: "仙俠修真",
    coreIdea: "fallback 不應蓋過上場世界",
  },
});
assert.equal(activeModernWorldSetting.era, "contemporary");
assert.equal(activeModernWorldSetting.sourceWorldId, "world-modern");
assert.match(activeModernWorldSetting.backgroundLabel, /家族企業/u);

const cultivation = makeDirectory("organization-hierarchy-test-seed", cultivationSetting);
assert.equal(cultivation.blueprints.length, STORY_ORGANIZATION_DIRECTORY_SIZE);
assert.equal(cultivation.directory.length, STORY_ORGANIZATION_DIRECTORY_SIZE);
assert.equal(STORY_ORGANIZATION_DIRECTORY_SIZE, 30);
assert.equal(new Set(cultivation.directory.map((entry) => entry.name)).size, STORY_ORGANIZATION_DIRECTORY_SIZE);
assert.equal(new Set(cultivation.directory.map((entry) => entry.specializationId)).size, 10);
assert.ok(cultivation.directory.every((entry) => entry.worldClassificationId === "cultivation-sects"));
assert.ok(cultivation.blueprints.some((entry) => entry.archetype === "sect"));
assert.ok(cultivation.blueprints.some((entry) => entry.archetype === "family"));
assert.ok(cultivation.blueprints.some((entry) => entry.archetype === "enterprise"));
assert.equal(cultivation.matrix.cacheStats().materializedCharacters, 0, "building 30 organizations must not eagerly materialize rosters");

const cultivationCapacities = cultivation.directory.map((organization) => organization.memberCapacity);
assert.equal(
  cultivationCapacities.reduce((sum, capacity) => sum + capacity, 0),
  cultivation.matrix.populationSize,
  "30 organization capacity buckets must partition the bounded 100,000-person catalog",
);
assert.ok(
  cultivationCapacities.filter((capacity) => capacity >= 5_000).length >= 2,
  "the directory needs real 5,000-10,000-person giant organizations",
);
assert.ok(
  Math.min(...cultivationCapacities) < 300,
  "giant organizations must be balanced by genuinely small organizations",
);
const allInstitutionPopulationIndexes = new Set();
for (let institutionIndex = 0; institutionIndex < cultivation.matrix.institutionCount; institutionIndex += 1) {
  const institutionMemberCount = cultivation.matrix.getInstitution(institutionIndex).memberCount;
  const sampledMemberOrdinals = new Set([
    0,
    Math.floor(institutionMemberCount / 2),
    institutionMemberCount - 1,
  ]);
  for (let memberOrdinal = 0; memberOrdinal < institutionMemberCount; memberOrdinal += 1) {
    const populationIndex = cultivation.matrix.institutionMemberPopulationIndexAt(institutionIndex, memberOrdinal);
    assert.equal(
      allInstitutionPopulationIndexes.has(populationIndex),
      false,
      `population index ${populationIndex} must belong to exactly one organization`,
    );
    allInstitutionPopulationIndexes.add(populationIndex);
    if (sampledMemberOrdinals.has(memberOrdinal)) {
      assert.equal(
        cultivation.matrix.getCharacter(populationIndex).institutionId,
        cultivation.matrix.institutionId(institutionIndex),
        "partition index and materialized character institution must agree",
      );
    }
  }
}
assert.equal(allInstitutionPopulationIndexes.size, cultivation.matrix.populationSize);
assert.equal(allInstitutionPopulationIndexes.has(0), true);
assert.equal(allInstitutionPopulationIndexes.has(cultivation.matrix.populationSize - 1), true);

for (const organization of cultivation.directory) {
  assert.ok(organization.memberCapacity >= 1);
  assert.ok(organization.memberCapacity <= STORY_ORGANIZATION_MEMBER_CAPACITY);
  assert.ok(organization.currentMemberCount >= 1);
  assert.ok(organization.currentMemberCount <= organization.memberCapacity);
  if (organization.memberCapacity > 1) {
    assert.ok(organization.currentMemberCount < organization.memberCapacity);
  }
  assert.equal(organization.era, "cultivation");
  assert.ok(storyOrganizationEraCompatible(cultivationSetting, organization.era));
  assert.equal(organization.hierarchy.memberCapacity, organization.memberCapacity);
  assert.equal(organization.hierarchy.currentMemberCount, organization.currentMemberCount);
  for (const hierarchyNode of flattenHierarchy(organization.hierarchy)) {
    assert.ok(hierarchyNode.currentMemberCount >= 0);
    assert.ok(hierarchyNode.currentMemberCount <= hierarchyNode.memberCapacity);
  }
  assert.equal(
    cultivation.matrix.getInstitution(organization.institutionIndex).name,
    organization.name,
  );
  const virtualInstitutionMembers = cultivation.matrix.getInstitution(
    organization.institutionIndex,
  ).memberCount;
  assert.equal(organization.memberCapacity, virtualInstitutionMembers);
  const hierarchyText = flattenHierarchy(organization.hierarchy)
    .flatMap((entry) => [entry.label, ...entry.roles, ...entry.assets])
    .join("｜");
  assert.ok(hierarchyText.includes(organization.specializationLabel));
  assert.ok(organization.hierarchy.children.some((node) => node.nodeId.endsWith(":node:specialization")));
}
assert.equal(
  cultivation.directory.reduce((sum, organization) => (
    sum + cultivation.matrix.getInstitution(organization.institutionIndex).memberCount
  ), 0),
  cultivation.matrix.populationSize,
);
assert.ok(
  cultivation.matrix.cacheStats().materializedCharacters <= cultivation.matrix.cacheLimit,
  "partition verification must remain cache-bounded",
);
const cultivationRelationships = uniqueOrganizationRelationships(cultivation.directory);
assert.ok(cultivationRelationships.length >= STORY_ORGANIZATION_DIRECTORY_SIZE * 2);
assert.deepEqual(
  new Set(cultivationRelationships.map((relationship) => relationship.kind)),
  new Set([
    "alliance",
    "rivalry",
    "vassalage",
    "schism",
    "marriage-kinship",
    "resource-dependence",
    "historic-blood-debt",
    "covert-cooperation",
  ]),
);
assert.ok(cultivation.directory.every((organization) => organization.relationships.length >= 2));
for (const relationship of cultivationRelationships) {
  const source = cultivation.directory.find((organization) => organization.organizationId === relationship.sourceOrganizationId);
  const target = cultivation.directory.find((organization) => organization.organizationId === relationship.targetOrganizationId);
  assert.ok(source && target);
  assert.equal(source.era, target.era);
  assert.equal(source.worldClassificationId, target.worldClassificationId);
  assert.equal(relationship.eraGate, "same-era");
  assert.equal(relationship.classificationGate, "same-world-classification");
  assert.ok(relationship.cause.includes(source.name) || relationship.cause.includes(target.name));
  for (const value of [relationship.history, relationship.currentStatus, relationship.publicStance, relationship.secretMotive]) {
    assert.ok(value.length >= 12);
  }
  assert.ok(relationship.intensity >= 35 && relationship.intensity <= 100);
  assert.ok(relationship.trust >= -100 && relationship.trust <= 100);
  if (relationship.kind === "marriage-kinship") {
    assert.equal(source.archetype, "family");
    assert.equal(target.archetype, "family");
  }
  if (relationship.kind === "schism") assert.equal(source.archetype, target.archetype);
}

const repeated = makeDirectory("organization-hierarchy-test-seed", cultivationSetting);
assert.deepEqual(repeated.blueprints, cultivation.blueprints);
assert.deepEqual(repeated.directory, cultivation.directory);

const sect = cultivation.directory.find((entry) => entry.archetype === "sect");
assert.ok(sect);
const sectText = flattenHierarchy(sect.hierarchy)
  .flatMap((entry) => [entry.label, ...entry.roles, ...entry.assets])
  .join("｜");
for (const required of ["掌門", "聖子", "聖女", "長老", "派系", "峰", "堂", "真傳", "內門", "外門", "功法", "符籙", "丹藥", "陣法"]) {
  assert.ok(sectText.includes(required), `sect hierarchy is missing ${required}`);
}

const family = cultivation.directory.find((entry) => entry.archetype === "family");
assert.ok(family);
const familyText = flattenHierarchy(family.hierarchy)
  .flatMap((entry) => [entry.label, ...entry.roles, ...entry.assets])
  .join("｜");
for (const required of ["家主", "族長", "族老", "繼承人", "房系", "支脈", "嫡系", "旁支", "家臣"]) {
  assert.ok(familyText.includes(required), `family hierarchy is missing ${required}`);
}

const familySurname = familySurnameForOrganizationName(family.name);
const familySampleSize = Math.min(24, family.currentMemberCount);
for (let memberOffset = 0; memberOffset < familySampleSize; memberOffset += 1) {
  const position = familyGenealogyPositionAt({
    organizationId: family.organizationId,
    memberCount: family.currentMemberCount,
    memberOffset,
  });
  const member = organizationMemberAtOffset({
    matrix: cultivation.matrix,
    organization: family,
    memberOffset,
  });
  if (position.lineageRole === "bloodline") {
    assert.ok(member.name.startsWith(familySurname), `${family.name} bloodline member must use ${familySurname} surname: ${member.name}`);
    assert.equal(member.familyRole, "本姓血親");
    assert.match(member.identity, new RegExp(`${familySurname}氏本姓血親`, "u"));
  } else {
    assert.equal(member.name.startsWith(familySurname), false, `${family.name} spouse must remain visibly external: ${member.name}`);
    assert.equal(member.familyRole, "外姓配偶（姻親入譜）");
    assert.match(member.identity, /外姓配偶（姻親入譜）/u);
  }
  assert.equal(member.familyId, family.organizationId);
}

const whiteFamily = {
  ...family,
  name: "白氏世家",
  hierarchy: { ...family.hierarchy, label: "白氏世家" },
};
const whiteBloodlineNames = Array.from(
  { length: Math.min(8, Math.ceil(whiteFamily.currentMemberCount / 2)) },
  (_, index) => organizationMemberAtOffset({
    matrix: cultivation.matrix,
    organization: whiteFamily,
    memberOffset: index * 2,
  }).name,
);
assert.ok(whiteBloodlineNames.length > 0);
assert.ok(whiteBloodlineNames.every((name) => name.startsWith("白")), `白氏世家核心血親不得混用鄭／王／易等姓氏：${whiteBloodlineNames.join("、")}`);

assert.equal(FAMILY_GENEALOGY_VERSION, "family-genealogy-v1");
const virtualClanSize = 10_000;
const genealogyOrganizationId = "organization:genealogy-contract";
const parentageSources = new Set();
for (let memberOffset = 0; memberOffset < virtualClanSize; memberOffset += 1) {
  const position = familyGenealogyPositionAt({
    organizationId: genealogyOrganizationId,
    memberCount: virtualClanSize,
    memberOffset,
  });
  assert.match(position.generationId, /:genealogy:generation:\d+$/u);
  assert.match(position.branchId, /:genealogy:branch:\d+$/u);
  assert.ok(position.parentMemberOffsets.every((parentOffset) => parentOffset < memberOffset));
  assert.ok(position.childMemberOffsets.every((childOffset) => childOffset > memberOffset || position.lineageRole === "spouse"));
  if (position.parentageId) {
    assert.equal(position.lineageRole, "bloodline");
    assert.equal(parentageSources.has(position.parentageId), false, "each person has exactly one unique parentage source");
    parentageSources.add(position.parentageId);
  }
  if (position.spouseMemberOffset !== null) {
    const spouse = familyGenealogyPositionAt({
      organizationId: genealogyOrganizationId,
      memberCount: virtualClanSize,
      memberOffset: position.spouseMemberOffset,
    });
    assert.equal(spouse.spouseMemberOffset, memberOffset);
    assert.equal(spouse.marriageId, position.marriageId);
    assert.equal(spouse.generation, position.generation);
  }
}
assert.equal(parentageSources.size, Math.ceil(virtualClanSize / 2) - 1);
const genealogyBranches = familyGenealogyBranches({ organizationId: genealogyOrganizationId, memberCount: virtualClanSize });
assert.deepEqual(genealogyBranches.map((branch) => branch.label), ["長房", "二房", "三房"]);
const firstBranchSecondGeneration = familyGenealogyGenerationPage({
  organizationId: genealogyOrganizationId,
  memberCount: virtualClanSize,
  generation: 2,
  branchCoupleIndex: 1,
  page: 0,
  pageSize: 6,
});
assert.equal(firstBranchSecondGeneration.positions.length, 6);
assert.ok(firstBranchSecondGeneration.positions.every((position) => position.generation === 2 && position.branchLabel === "長房"));
const boundedSearch = familyGenealogySearchPage({
  organizationId: genealogyOrganizationId,
  memberCount: virtualClanSize,
  query: "person 17",
  scanLimit: 180,
  resolve: (memberOffset) => ({ text: `person ${memberOffset}`, value: memberOffset }),
});
assert.ok(boundedSearch.scanned <= FAMILY_GENEALOGY_SEARCH_SCAN_MAX);
assert.ok(boundedSearch.items.length > 0);
assert.ok(boundedSearch.nextCursor !== null);

const familyFounder = organizationMemberAtOffset({ matrix: cultivation.matrix, organization: family, memberOffset: 0 });
assert.equal(familyFounder.institutionId, family.organizationId);
assert.ok(familyFounder.name.startsWith(familySurname));

const enterprise = cultivation.directory.find((entry) => entry.archetype === "enterprise");
assert.ok(enterprise);
const enterpriseText = flattenHierarchy(enterprise.hierarchy)
  .flatMap((entry) => [entry.label, ...entry.roles, ...entry.assets])
  .join("｜");
for (const required of ["董事長", "董事", "執行長", "事業群", "部門", "專案", "股權"]) {
  assert.ok(enterpriseText.includes(required), `enterprise hierarchy is missing ${required}`);
}

const firstPage = organizationMemberPage({
  matrix: cultivation.matrix,
  organization: sect,
  page: 0,
  pageSize: 6,
});
const firstPageAgain = organizationMemberPage({
  matrix: cultivation.matrix,
  organization: sect,
  page: 0,
  pageSize: 6,
});
assert.deepEqual(firstPage, firstPageAgain);
assert.equal(firstPage.total, sect.currentMemberCount);
assert.equal(firstPage.items.length, Math.min(6, sect.currentMemberCount));
assert.ok(firstPage.items.every((character) => character.institutionId === sect.organizationId));
assert.ok(firstPage.items.every((character) => character.hierarchyNodeId));
assert.ok(firstPage.items.every((character) => character.organizationUnit));
assert.ok(firstPage.items.every((character) => character.organizationRank));
assert.ok(firstPage.items.every((character) => character.organizationFaction));
assert.ok(firstPage.items.every((character) => character.identity.includes(character.organizationRank)));
assert.ok(firstPage.items.every((character) => character.storyAffinity === `${sect.eraLabel} · ${sect.kindLabel}`));
assert.ok(firstPage.items.every((character) => character.location.startsWith(`${sect.territory} · `)));
assert.ok(firstPage.items.every((character) => !/城市資料館|公共會議室|交通轉運站|地方服務中心/u.test(character.location)));
assert.deepEqual(
  organizationMembershipForOffset(sect, 0),
  organizationMembershipForOffset(sect, 0),
);

const innerRank = flattenHierarchy(sect.hierarchy).find((entry) => entry.label === "內門");
assert.ok(innerRank);
assert.ok(innerRank.currentMemberCount > 0);
const innerPage = organizationMemberPage({
  matrix: cultivation.matrix,
  organization: sect,
  page: 0,
  pageSize: 6,
  hierarchyNodeId: innerRank.nodeId,
});
assert.equal(innerPage.total, innerRank.currentMemberCount);
assert.ok(innerPage.items.length > 0);
assert.ok(innerPage.items.every((member) => member.hierarchyPathIds.includes(innerRank.nodeId)));
assert.ok(innerPage.items.every((member) => member.organizationRank === "內門弟子"));

const cultivationProfile = cultivationProfileForOrganizationMember({
  organization: sect,
  member: firstPage.items[0],
  approvedAt: "2026-08-26T00:00:00.000Z",
});
assert.ok(cultivationProfile);
assert.equal(cultivationProfile.schemaVersion, "character-cultivation-profile-v1");
assert.match(cultivationProfile.sectBranchId, new RegExp(`^${sect.organizationId}:branch:`));
assert.match(cultivationProfile.sectRankId, new RegExp(`^${sect.organizationId}:rank:`));
assert.ok(cultivationProfile.techniqueIds.length >= 1);

if (sect.currentMemberCount > 6) {
  const secondPage = organizationMemberPage({
    matrix: cultivation.matrix,
    organization: sect,
    page: 1,
    pageSize: 6,
  });
  assert.notDeepEqual(
    secondPage.items.map((entry) => entry.characterId),
    firstPage.items.map((entry) => entry.characterId),
  );
}
const beyondCapacity = organizationMemberPage({
  matrix: cultivation.matrix,
  organization: sect,
  page: Math.ceil(sect.currentMemberCount / 6),
  pageSize: 6,
});
assert.equal(beyondCapacity.items.length, 0);
assert.equal(beyondCapacity.nextCursor, null);

const contemporarySetting = resolveStoryOrganizationSetting({
  genre: "現代商戰職場",
  coreIdea: "家族企業面臨董事會改組與供應鏈危機。",
});
assert.equal(contemporarySetting.era, "contemporary");
const contemporary = makeDirectory("modern-organization-seed", contemporarySetting);
assert.ok(contemporary.directory.some((entry) => entry.archetype === "enterprise"));
assert.ok(contemporary.directory.some((entry) => entry.archetype === "family"));
assert.ok(contemporary.directory.every((entry) => entry.archetype !== "sect"));

const classificationCases = [
  { id: "contemporary-life", genre: "當代生活", era: "現代", summary: "社區、醫療與家庭服務共同處理地方危機。" },
  { id: "urban-workplace", genre: "都市職場", era: "現代", summary: "企業董事會、供應鏈與專業部門競逐市場。" },
  { id: "school-youth", genre: "校園青春", era: "現代", summary: "學校、學生自治、社團與校隊共同生活。" },
  { id: "mystery-justice", genre: "懸疑司法", era: "現代", summary: "刑偵、鑑識、證人保護與法庭程序維持證據鏈。" },
  { id: "historical-court", genre: "歷史宮廷", era: "歷史古代", summary: "朝廷官署、宗族、軍鎮與漕運互相制衡。" },
  { id: "wuxia-rivers", genre: "武俠江湖", era: "歷史古代", summary: "門派、鏢局、幫會、武館與地方官府並立。" },
  { id: "cultivation-sects", genre: "修仙宗門", era: "架空幻想", summary: "宗門、修行家族、坊市與散修盟競逐靈脈。" },
  { id: "mythic-otherworld", genre: "神話異界", era: "架空幻想", summary: "王國、神殿、魔法組織與異族議會共同定序。" },
  { id: "near-future-cyber", genre: "近未來賽博", era: "未來", summary: "人工智慧、義體企業與資料治理機構進入日常。" },
  { id: "deep-space-future", genre: "星際遠未來", era: "未來", summary: "星際議會、殖民政府、艦隊與跨星企業分治。" },
  { id: "post-apocalypse", genre: "末日災變", era: "未來", summary: "避難據點、救援配給與倖存者自治會重建文明。" },
];
const classificationSignatures = new Set();
for (const classificationCase of classificationCases) {
  const setting = resolveStoryOrganizationSetting({
    genre: classificationCase.genre,
    coreIdea: classificationCase.summary,
    worldEras: [classificationCase.era],
    worldSummaries: [classificationCase.summary],
    sourceWorldId: `global-world-${classificationCase.id}`,
  });
  const catalog = makeDirectory(`organization-profile:${classificationCase.id}`, setting);
  assert.equal(catalog.directory.length, 30, `${classificationCase.id} must expose at least 30 organizations`);
  assert.equal(
    catalog.directory.reduce((sum, organization) => sum + organization.memberCapacity, 0),
    catalog.matrix.populationSize,
    `${classificationCase.id} organization buckets must stay within the 100,000-person catalog`,
  );
  assert.ok(
    catalog.directory.some((organization) => organization.memberCapacity >= 5_000),
    `${classificationCase.id} must support a giant organization without duplicating members`,
  );
  assert.equal(new Set(catalog.directory.map((entry) => entry.name)).size, 30, `${classificationCase.id} organization names must be unique`);
  assert.ok(catalog.directory.every((entry) => entry.worldClassificationId === classificationCase.id));
  assert.ok(new Set(catalog.directory.map((entry) => entry.archetype)).size >= 4, `${classificationCase.id} needs multiple hierarchy archetypes`);
  assert.ok(catalog.directory.every((entry) => {
    const specialistNode = flattenHierarchy(entry.hierarchy).find((node) => node.nodeId.endsWith(":node:specialization"));
    return specialistNode
      && specialistNode.label.includes(entry.specializationLabel)
      && specialistNode.roles.length >= 2
      && specialistNode.assets.length >= 2;
  }), `${classificationCase.id} specialization must change roles and assets, not only names`);
  const relationships = uniqueOrganizationRelationships(catalog.directory);
  assert.ok(catalog.directory.every((organization) => organization.relationships.length >= 2));
  assert.ok(relationships.every((relationship) => (
    relationship.worldClassificationId === classificationCase.id
    && relationship.eraGate === "same-era"
    && relationship.classificationGate === "same-world-classification"
  )));
  assert.ok(relationships.some((relationship) => relationship.kind === "marriage-kinship"));
  assert.ok(relationships.some((relationship) => relationship.kind === "vassalage"));
  assert.equal(catalog.matrix.cacheStats().materializedCharacters, 0);
  classificationSignatures.add(catalog.directory
    .slice(0, 10)
    .map((entry) => `${entry.archetype}:${entry.specializationId}`)
    .join("|"));
}
assert.equal(classificationSignatures.size, classificationCases.length, "all 11 world classifications need a distinct organization mix");

const declaredModernSetting = resolveStoryOrganizationSetting({
  genre: "幻想隱喻",
  coreIdea: "這家公司被員工戲稱為宗門，升遷制度像內外門。",
  worldEras: ["現代"],
});
assert.equal(declaredModernSetting.era, "contemporary");

const crossEraSetting = resolveStoryOrganizationSetting({
  genre: "跨時代穿越",
  coreIdea: "現代企業與古代宗門因時空裂縫相遇。",
});
assert.equal(crossEraSetting.era, "cross-era");
assert.equal(crossEraSetting.allowsCrossEra, true);
const crossEra = makeDirectory("cross-era-organization-seed", crossEraSetting);
assert.equal(crossEra.directory.length, STORY_ORGANIZATION_DIRECTORY_SIZE);
assert.ok(crossEra.directory.some((entry) => entry.archetype === "sect"));
assert.ok(crossEra.directory.some((entry) => entry.archetype === "enterprise"));
assert.ok(new Set(crossEra.directory.map((entry) => entry.era)).size > 1);
assert.ok(crossEra.directory.every((entry) => storyOrganizationEraCompatible(crossEraSetting, entry.era)));
assert.equal(
  crossEra.directory.reduce((sum, organization) => sum + organization.memberCapacity, 0),
  crossEra.matrix.populationSize,
);

const [socialWorldSource, socialWorldStyles] = await Promise.all([
  readFile(new URL("../app/studio/project/[projectId]/social-world-library.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/social-world-library.module.css", import.meta.url), "utf8"),
]);
assert.match(socialWorldSource, /filter-hierarchy-/u);
assert.match(socialWorldSource, /character\.organizationUnit/u);
assert.match(socialWorldSource, /character\.organizationRank/u);
assert.match(socialWorldSource, /cultivationProfileForOrganizationMember/u);
assert.match(socialWorldSource, /beginSocialWorldApproval/u);
assert.match(socialWorldSource, /checkpointSocialWorldApproval/u);
assert.match(socialWorldSource, /data-testid="family-genealogy"/u);
assert.match(socialWorldSource, /data-materialization="lazy-paged"/u);
assert.match(socialWorldSource, /familyGenealogySearchPage/u);
const mobileStylesStart = socialWorldStyles.lastIndexOf("@media (max-width: 720px)");
const mobileStylesEnd = socialWorldStyles.indexOf("@media (max-width: 430px)", mobileStylesStart);
assert.ok(mobileStylesStart >= 0 && mobileStylesEnd > mobileStylesStart, "social world mobile style block must exist");
const mobileStyles = socialWorldStyles.slice(mobileStylesStart, mobileStylesEnd);
assert.match(mobileStyles, /--social-mobile-aux-size:\s*\.75rem/u, "mobile auxiliary labels must be at least 12px");
assert.match(mobileStyles, /--social-mobile-copy-size:\s*\.875rem/u, "mobile descriptive copy must be at least 14px");
for (const selector of [".hierarchyNodeButton span", ".treasureImageFrame > span", ".worldMetrics span"]) {
  assert.ok(mobileStyles.includes(selector), `${selector} must use the mobile auxiliary font floor`);
}
for (const selector of [".hierarchyBranch > p", ".characterCard header p", ".worldDetails dd"]) {
  assert.ok(mobileStyles.includes(selector), `${selector} must use the mobile descriptive font floor`);
}

console.log(JSON.stringify({
  status: "PASS",
  organizations: cultivation.directory.length,
  cultivationSizes: cultivation.directory.map((entry) => ({
    kind: entry.kindLabel,
    size: entry.sizeLabel,
    capacity: entry.memberCapacity,
    current: entry.currentMemberCount,
  })),
  firstOrganizationMembersMaterialized: firstPage.items.length,
  maximumPerOrganization: STORY_ORGANIZATION_MEMBER_CAPACITY,
}, null, 2));

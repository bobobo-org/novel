import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION,
  TOPIC_WORLD_STAGE_MATERIALIZATION_POLICY,
  TOPIC_WORLD_STAGE_MEMBER_COUNT,
  TOPIC_WORLD_STAGE_ORGANIZATION_COUNT,
  approveTopicWorldFamilyCanonCandidate,
  buildTopicWorldFamilyStageMatrix,
  createTopicWorldFamilyCanonCandidate,
  listTopicWorldFamilyStageCandidates,
  restoreTopicWorldFamilyDraftSelection,
  serializeTopicWorldFamilyDraftSelection,
} from "../lib/novel-ai/game/topic-world-family-stage-matrix.ts";
import {
  buildProjectBundle,
  createDraft,
} from "../lib/novel-ai/domain/creation.ts";
import { optionalValue } from "../lib/novel-ai/domain/index.ts";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/memory/memory-repository.ts";
import { proceduralTreasureRecordAt } from "../lib/novel-ai/game/procedural-treasure-library.ts";

const buildStartedAt = performance.now();
const cultivation = buildTopicWorldFamilyStageMatrix({
  seed: "family-stage-xianxia",
  topicId: "classic-topic-009",
  playMode: "rpg",
  worldOrdinal: 37,
});
const buildMs = performance.now() - buildStartedAt;
const cultivationReplay = buildTopicWorldFamilyStageMatrix({
  seed: "family-stage-xianxia",
  topicId: "classic-topic-009",
  playMode: "rpg",
  worldOrdinal: 37,
});

assert.deepEqual(cultivationReplay, cultivation);
assert.equal(cultivation.schemaVersion, TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION);
assert.equal(cultivation.worldFamily, "cultivation");
assert.equal(cultivation.canonicalStatus, "VIRTUAL_CANDIDATE");
assert.equal(cultivation.canonicalMutation, 0);
assert.equal(cultivation.organizations.length, TOPIC_WORLD_STAGE_ORGANIZATION_COUNT);
assert.equal(cultivation.stageFamilies.length, TOPIC_WORLD_STAGE_ORGANIZATION_COUNT);
assert.deepEqual(
  cultivation.organizations.map((organization) => organization.kindLabel),
  ["宗門", "修行家族", "散修盟", "坊市"],
);

for (const organization of cultivation.organizations) {
  assert.ok(organization.name.length >= 2);
  assert.ok(organization.contractStatement.length >= 12);
  assert.ok(organization.situationBrief.includes(organization.name));
  assert.ok(organization.situationBrief.includes(organization.publicGoal));
  assert.ok(organization.situationBrief.includes(organization.hiddenConflict));
  assert.equal(organization.allyOrganizationIds.length, 1);
  assert.equal(organization.rivalOrganizationIds.length, 1);
  const ally = cultivation.organizations.find((candidate) => (
    organization.allyOrganizationIds.includes(candidate.organizationId)
  ));
  const rival = cultivation.organizations.find((candidate) => (
    organization.rivalOrganizationIds.includes(candidate.organizationId)
  ));
  assert.ok(ally);
  assert.ok(rival);
  assert.ok(organization.situationBrief.includes(ally.name));
  assert.ok(organization.situationBrief.includes(rival.name));
  assert.ok(organization.memberCapacity > 0);
  assert.ok(organization.controlledAssetIds.length >= 1);
  assert.ok(organization.contestedAssetIds.length >= 1);
}
assert.ok(cultivation.worldSituation.includes("完整家族上場"));
for (const organization of cultivation.organizations) {
  assert.ok(cultivation.worldSituation.includes(organization.situationBrief));
}

const requiredStageRoles = [
  "男主角候選",
  "女主角候選",
  "家族長輩",
  "同輩骨幹",
  "盟友代表",
  "對手代表",
];
for (const family of cultivation.stageFamilies) {
  assert.equal(family.members.length, TOPIC_WORLD_STAGE_MEMBER_COUNT);
  assert.deepEqual(family.members.map((member) => member.stageRole), requiredStageRoles);
  assert.equal(new Set(family.members.map((member) => member.characterId)).size, TOPIC_WORLD_STAGE_MEMBER_COUNT);
  assert.equal(family.members[0].pronouns, "他");
  assert.equal(family.members[1].pronouns, "她");
  assert.equal(family.members[2].lifeStage, "長者");
  assert.equal(family.relationships.length, 7);
  assert.equal(new Set(family.relationships.map((relationship) => relationship.relationshipId)).size, 7);
  assert.ok(family.introduction.includes(family.organizationName));
  assert.ok(family.introduction.includes("上場六人"));
  assert.ok(family.assetControlIds.length >= 1);
  for (const member of family.members) {
    assert.equal(member.fictional, true);
    assert.equal(member.originPolicy, "original-procedural-fiction-no-real-person-or-social-account");
    assert.ok(member.identity.includes(family.name));
    assert.ok(member.goal.length > 0);
    assert.ok(member.secret.length > 0);
    assert.equal(member.personality.traits.length, 3);
    assert.equal(member.abilities.specialties.length, 3);
    assert.equal(member.portrait.source, "procedural-original-svg");
    assert.ok(member.portrait.description.startsWith("原創程序化人物肖像"));
    assert.ok(member.portrait.dataUrl.startsWith("data:image/svg+xml"));
  }
}

const requiredCultivationAssets = ["功法", "丹藥", "符籙", "陣法", "法器", "靈草", "秘境"];
for (const category of requiredCultivationAssets) {
  assert.ok(
    cultivation.assetControls.some((asset) => asset.category === category),
    `missing xianxia control relation for ${category}`,
  );
}
for (const asset of cultivation.assetControls) {
  const controller = cultivation.organizations.find(
    (organization) => organization.organizationId === asset.controllerOrganizationId,
  );
  const holderFamily = cultivation.stageFamilies.find(
    (family) => family.familyId === asset.holderFamilyId,
  );
  assert.ok(controller);
  assert.ok(holderFamily);
  assert.equal(asset.controllerOrganizationName, controller.name);
  assert.ok(holderFamily.members.some((member) => member.characterId === asset.holderCharacterId));
  assert.ok(["掌握", "持有", "控制", "共同保管", "爭奪中"].includes(asset.controlRelation));
  assert.ok(asset.storyHook.includes(controller.name));
  assert.ok(asset.storyHook.includes(asset.holderName));
  assert.ok(asset.catalogTreasureId.startsWith("treasure-"));
  assert.ok(asset.visualDescription.includes(asset.category));
  assert.ok(asset.visualDescription.includes(asset.name));
  assert.ok(asset.function.length > 20);
  assert.ok(asset.limitation.length > 20);
  assert.ok(asset.cost.length > 20);
}
assert.equal(
  cultivation.assetControls.find((asset) => asset.category === "功法").controlRelation,
  "掌握",
);
assert.equal(
  cultivation.assetControls.find((asset) => asset.category === "陣法").controlRelation,
  "控制",
);
assert.equal(
  cultivation.assetControls.find((asset) => asset.category === "法器").controlRelation,
  "持有",
);

assert.deepEqual(cultivation.playClassification.dimensions, ["能力", "裝備", "任務", "體力／行動點"]);
assert.equal(cultivation.playClassification.mode, "rpg");
assert.doesNotMatch(
  JSON.stringify(cultivation.playClassification),
  /關係|信任|事件進度|人物成長|資金|人力|品質|聲望|風險/u,
);
assert.deepEqual(cultivation.capacity, {
  characters: 100_000,
  treasures: 100_000,
  relationshipScenarios: 1_000_000,
  materializationPolicy: TOPIC_WORLD_STAGE_MATERIALIZATION_POLICY,
  materializedStageCharacters: 24,
  materializedStageAssets: 8,
});

// The creation page receives three deterministic family choices. Each choice
// still introduces the entire four-power world and every xianxia asset
// control/holder relation; choosing a family never erases the other powers.
const creationOptions = listTopicWorldFamilyStageCandidates({ matrix: cultivation });
assert.equal(creationOptions.length, 3);
assert.equal(new Set(creationOptions.map((option) => option.familyId)).size, 3);
assert.deepEqual(
  listTopicWorldFamilyStageCandidates({ matrix: cultivation }),
  creationOptions,
);
for (const option of creationOptions) {
  assert.equal(option.family.familyId, option.familyId);
  assert.deepEqual(
    option.worldOrganizations.map((organization) => organization.kindLabel),
    ["宗門", "修行家族", "散修盟", "坊市"],
  );
  for (const organization of option.worldOrganizations) {
    assert.ok(option.completeWorldIntroduction.includes(organization.name));
    assert.ok(option.completeWorldIntroduction.includes(organization.situationBrief));
  }
  for (const category of requiredCultivationAssets) {
    assert.ok(option.worldAssetControls.some((asset) => asset.category === category));
  }
  for (const asset of option.worldAssetControls) {
    assert.ok(option.completeWorldIntroduction.includes(asset.name));
    assert.ok(option.completeWorldIntroduction.includes(asset.controlRelation));
    assert.ok(option.completeWorldIntroduction.includes(asset.holderName));
  }
}
assert.throws(
  () => listTopicWorldFamilyStageCandidates({ matrix: cultivation, limit: 4 }),
  /TOPIC_WORLD_STAGE_CANDIDATE_LIMIT_INVALID/u,
);

// draft.answers only stores the seed-addressed selection. Replaying the JSON
// yields the same family and a zero-mutation Canon candidate without embedding
// 100k generated records or SVG portrait payloads in the draft.
const serializedSelection = serializeTopicWorldFamilyDraftSelection({
  matrix: cultivation,
  familyId: creationOptions[0].familyId,
});
assert.ok(serializedSelection.length < 1_000);
assert.doesNotMatch(serializedSelection, /data:image|portrait|organizations|members/u);
const restoredSelection = restoreTopicWorldFamilyDraftSelection(serializedSelection);
assert.deepEqual(restoredSelection.matrix, cultivation);
assert.equal(restoredSelection.family.familyId, creationOptions[0].familyId);
assert.equal(restoredSelection.canonCandidate.status, "PENDING_APPROVAL");
assert.equal(restoredSelection.canonCandidate.canonicalMutation, 0);
assert.equal(
  restoredSelection.canonCandidate.canonRecords.selectedFamily.familyId,
  creationOptions[0].familyId,
);
const tamperedSelection = JSON.parse(serializedSelection);
tamperedSelection.matrixId = `${tamperedSelection.matrixId}:tampered`;
assert.throws(
  () => restoreTopicWorldFamilyDraftSelection(JSON.stringify(tamperedSelection)),
  /TOPIC_WORLD_FAMILY_DRAFT_SELECTION_REPLAY_MISMATCH/u,
);
assert.throws(
  () => restoreTopicWorldFamilyDraftSelection("not-json"),
  /TOPIC_WORLD_FAMILY_DRAFT_SELECTION_INVALID_JSON/u,
);

const differentWorld = buildTopicWorldFamilyStageMatrix({
  seed: "family-stage-xianxia",
  topicId: "classic-topic-009",
  playMode: "rpg",
  worldOrdinal: 38,
});
assert.notEqual(differentWorld.matrixId, cultivation.matrixId);
assert.notEqual(differentWorld.worldSituation, cultivation.worldSituation);
assert.notDeepEqual(
  differentWorld.stageFamilies.map((family) => family.familyId),
  cultivation.stageFamilies.map((family) => family.familyId),
);

// Topic-derived worlds retain their own vocabulary and correctly distinguish
// native from deliberately overlaid play modes.
for (const sample of [
  { topicId: "classic-topic-001", playMode: "general", expected: "native", name: "附身變身" },
  { topicId: "classic-topic-002", playMode: "management", expected: "native", name: "都市奇幻" },
  { topicId: "classic-topic-003", playMode: "romance", expected: "native", name: "豪門權謀" },
  { topicId: "classic-topic-001", playMode: "management", expected: "cross-mode", name: "附身變身" },
]) {
  const matrix = buildTopicWorldFamilyStageMatrix({
    seed: `topic-derived-${sample.topicId}-${sample.playMode}`,
    topicId: sample.topicId,
    playMode: sample.playMode,
    worldOrdinal: 12,
  });
  assert.equal(matrix.worldFamily, "topic-derived");
  assert.equal(matrix.playClassification.compatibility, sample.expected);
  assert.ok(matrix.worldSituation.includes(sample.name));
  assert.equal(matrix.organizations.length, 4);
  assert.ok(matrix.organizations.every((organization) => organization.kindLabel !== "修行勢力"));
  assert.ok(matrix.stageFamilies.every((family) => family.members.length === 6));
  assert.ok(matrix.assetControls.length >= 4);
}

// Canon remains untouched until a family is explicitly approved. The review
// bundle carries the full world, organizations, selected cast, relationships,
// play mechanics and all asset-control lore needed for one atomic write.
const selectedFamily = cultivation.stageFamilies[2];
const candidate = createTopicWorldFamilyCanonCandidate({
  matrix: cultivation,
  familyId: selectedFamily.familyId,
});
assert.equal(candidate.status, "PENDING_APPROVAL");
assert.equal(candidate.canonicalMutation, 0);
assert.equal(candidate.selectedFamilyId, selectedFamily.familyId);
assert.equal(candidate.canonRecords.selectedFamily.familyId, selectedFamily.familyId);
assert.equal(candidate.canonRecords.organizations.length, 4);
assert.equal(candidate.canonRecords.characters.length, 6);
assert.equal(candidate.canonRecords.relationships.length, 7);
assert.equal(candidate.canonRecords.lore.length, 8);
assert.deepEqual(
  candidate.canonPatch.characterIds,
  selectedFamily.members.map((member) => member.characterId),
);
assert.deepEqual(
  candidate.canonPatch.loreIds,
  cultivation.assetControls.map((asset) => asset.loreId),
);
const approved = approveTopicWorldFamilyCanonCandidate({
  candidate,
  projectId: "project-family-stage-test",
  approvedBy: "acceptance-test",
  approvedAt: "2026-08-24T00:00:00.000Z",
});
assert.equal(approved.status, "APPROVED");
assert.equal(approved.canonicalMutation, 1);
assert.equal(approved.projectId, "project-family-stage-test");
assert.equal(approved.payloadFingerprint, candidate.payloadFingerprint);
assert.deepEqual(approved.canonPatch, candidate.canonPatch);
assert.deepEqual(approved.canonRecords, candidate.canonRecords);

assert.throws(
  () => createTopicWorldFamilyCanonCandidate({ matrix: cultivation, familyId: "missing-family" }),
  /TOPIC_WORLD_STAGE_FAMILY_NOT_FOUND/u,
);
assert.throws(
  () => approveTopicWorldFamilyCanonCandidate({
    candidate,
    projectId: "",
    approvedBy: "test",
  }),
  /TOPIC_WORLD_FAMILY_CANON_PROJECT_ID_REQUIRED/u,
);

// Domain integration writes one coherent ProjectBundle. Old drafts without a
// stageFamily address receive the deterministic first candidate; all four
// powers, the selected family, six approved people, seven links and all asset
// controls are already present in the initial backup and StoryBible.
const fallbackDraft = createDraft("quick");
fallbackDraft.title = "家族矩陣整合測試";
fallbackDraft.genreId = "classic-topic-009";
fallbackDraft.answers.playMode = optionalValue("rpg", "user_defined");
const fallbackBundle = buildProjectBundle(fallbackDraft);
const fallbackMatrix = buildTopicWorldFamilyStageMatrix({
  seed: `novel-project:${fallbackDraft.projectId}:procedural-v1`,
  topicId: fallbackDraft.genreId,
  playMode: "rpg",
});
const fallbackCharacters = [
  ...(fallbackBundle.protagonist ? [fallbackBundle.protagonist] : []),
  ...(fallbackBundle.cast ?? []),
];
assert.equal(fallbackCharacters.length, 6);
assert.equal(fallbackBundle.cast?.length, 5);
assert.equal(fallbackBundle.relationships?.length, 7);
assert.equal(fallbackBundle.lore?.filter((entry) => entry.kind === "faction").length, 5);
assert.equal(fallbackBundle.lore?.filter((entry) => entry.kind === "item").length, 8);
assert.equal(fallbackBundle.storyState.worldFlags["story.familyStageSelection"], "deterministic-fallback");
assert.equal(fallbackBundle.storyState.worldFlags["story.familyStageApproved"], true);
assert.equal(fallbackBundle.storyState.worldFlags["story.organizationCount"], 4);
assert.equal(fallbackBundle.storyState.worldFlags["story.assetControlCount"], 8);
assert.equal(fallbackBundle.storyState.worldFlags["story.virtualCharacterCapacity"], 100_000);
assert.equal(fallbackBundle.storyState.worldFlags["story.virtualTreasureCapacity"], 100_000);
assert.equal(fallbackBundle.storyState.worldFlags["story.relationshipScenarioCapacity"], 1_000_000);
assert.deepEqual(
  new Set(fallbackBundle.storyBible.characterIds),
  new Set(fallbackCharacters.map((character) => character.id)),
);
assert.deepEqual(
  new Set(fallbackBundle.storyBible.relationshipIds),
  new Set(fallbackBundle.relationships.map((relationship) => relationship.id)),
);
assert.deepEqual(
  new Set(fallbackBundle.storyBible.loreIds),
  new Set(fallbackBundle.lore.map((entry) => entry.id)),
);
assert.equal(fallbackBundle.world.id, fallbackBundle.storyBible.worldId);
assert.ok(fallbackBundle.world.proceduralWorldProfile);
assert.equal(fallbackBundle.world.proceduralWorldProfile.characterIds.length, 6);
assert.equal(fallbackBundle.world.proceduralWorldProfile.treasureIds.length, 8);
assert.equal(fallbackBundle.world.proceduralWorldProfile.causalDimensionIds.length, 10);
assert.ok(fallbackCharacters.every((character) => character.portrait?.source === "procedural"));
assert.ok(fallbackCharacters.every((character) => character.portrait?.assetDigest.length === 64));
assert.ok(fallbackCharacters.every((character) => character.socialMatrixProfile?.approvedBy === "user"));
const fallbackAssetByCatalogId = new Map(
  fallbackMatrix.assetControls.map((asset) => [asset.catalogTreasureId, asset]),
);
const fallbackCatalogStorySeed = [
  TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION,
  fallbackMatrix.contractId,
  fallbackMatrix.seed,
].join("|");
for (const character of fallbackCharacters) {
  const expectedCatalogIds = fallbackMatrix.assetControls
    .filter((asset) => asset.holderCharacterId === character.id)
    .map((asset) => asset.catalogTreasureId);
  assert.deepEqual(
    new Set(character.socialMatrixProfile?.treasureIds ?? []),
    new Set(expectedCatalogIds),
    `${character.name}: social matrix treasure IDs must use the catalog namespace`,
  );
  for (const treasureId of character.socialMatrixProfile?.treasureIds ?? []) {
    const control = fallbackAssetByCatalogId.get(treasureId);
    assert.ok(control, `${character.name}: ${treasureId} must resolve to one asset-control catalog item`);
    const catalogItem = proceduralTreasureRecordAt({
      storySeed: fallbackCatalogStorySeed,
      ordinal: control.treasureOrdinal,
    });
    assert.equal(catalogItem.id, treasureId);
    assert.equal(catalogItem.ordinal, control.treasureOrdinal);
  }
}
for (const faction of fallbackBundle.lore.filter((entry) => entry.kind === "faction").slice(0, 4)) {
  assert.match(faction.content, /公開目標/u);
  assert.match(faction.content, /隱藏衝突/u);
  assert.match(faction.content, /盟友/u);
  assert.match(faction.content, /對手/u);
  assert.match(faction.content, /控制/u);
  assert.match(faction.content, /爭奪/u);
}
for (const item of fallbackBundle.lore.filter((entry) => entry.kind === "item")) {
  assert.match(item.content, /控制勢力/u);
  assert.match(item.content, /持有人/u);
  assert.match(item.content, /聲索勢力/u);
  assert.match(item.content, /作用/u);
  assert.match(item.content, /限制/u);
  assert.match(item.content, /代價/u);
  assert.ok(item.proceduralTreasureProfile);
  assert.equal(item.proceduralTreasureProfile.causalDimensionIds.length, 10);
}
assert.deepEqual(
  fallbackBundle.initialBackup.snapshot.storyBible,
  fallbackBundle.storyBible,
);
assert.deepEqual(
  fallbackBundle.initialBackup.snapshot.storyState,
  fallbackBundle.storyState,
);

// The repository receives the already-validated bundle in one create call;
// no family-stage record is left as an unapproved side queue.
const fallbackRepository = new MemoryNovelRepository();
await fallbackRepository.createProject(fallbackBundle, "family-stage:fallback");
const persistedFallback = await fallbackRepository.exportProject(fallbackBundle.project.id);
assert.equal(persistedFallback.projects.length, 1);
assert.equal(persistedFallback.worlds.length, 1);
assert.equal(persistedFallback.storyBibles.length, 1);
assert.equal(persistedFallback.storyStates.length, 1);
assert.equal(persistedFallback.characters.length, 6);
assert.equal(persistedFallback.relationships.length, 7);
assert.equal(persistedFallback.worldRules.length, fallbackBundle.worldRules.length);
assert.equal(persistedFallback.lore.length, 13);
assert.equal(persistedFallback.backups.length, 1);

// An explicit compact address is strictly replayed and becomes authoritative.
const explicitDraft = createDraft("guided");
explicitDraft.title = "明確家族選擇";
explicitDraft.genreId = "classic-topic-009";
explicitDraft.answers.playMode = optionalValue("rpg", "user_defined");
const explicitMatrix = buildTopicWorldFamilyStageMatrix({
  seed: `novel-project:${explicitDraft.projectId}:procedural-v1`,
  topicId: explicitDraft.genreId,
  playMode: "rpg",
});
const explicitOptions = listTopicWorldFamilyStageCandidates({ matrix: explicitMatrix });
const explicitFamily = explicitOptions[1].family;
const explicitProtagonist = explicitFamily.members.find((member) => member.stageRole === "女主角候選");
explicitDraft.answers.stageFamily = optionalValue(
  serializeTopicWorldFamilyDraftSelection({
    matrix: explicitMatrix,
    familyId: explicitFamily.familyId,
    selectedProtagonistId: explicitProtagonist.characterId,
  }),
  "user_defined",
);
explicitDraft.protagonist = optionalValue("作者改名女主角", "user_defined");
const explicitSupporting = explicitFamily.members.filter(
  (member) => member.characterId !== explicitProtagonist.characterId,
);
explicitDraft.answers.cast = optionalValue(
  explicitSupporting.map((member, index) => (
    `作者改名配角${index + 1}｜${member.stageRole}｜自訂關係${index + 1}｜自訂人物目標${index + 1}`
  )).join("\n"),
  "user_defined",
);
const explicitBundle = buildProjectBundle(explicitDraft);
assert.equal(explicitBundle.storyState.worldFlags["story.familyStageSelection"], "explicit");
assert.equal(explicitBundle.storyState.worldFlags["story.selectedFamilyId"], explicitFamily.familyId);
assert.equal(explicitBundle.protagonist.name, explicitDraft.protagonist.value);
assert.equal(explicitBundle.protagonist.id, explicitProtagonist.characterId);
assert.equal(explicitBundle.cast.length, 5);
assert.deepEqual(
  explicitBundle.cast.map((character) => character.name),
  explicitSupporting.map((_, index) => `作者改名配角${index + 1}`),
);
assert.ok(explicitBundle.relationships.some((relationship) => /自訂關係/u.test(relationship.kind)));
assert.ok(explicitBundle.lore.some((entry) => /作者改名女主角/u.test(entry.content)));
assert.equal(explicitBundle.relationships.length, 7);
assert.ok(explicitBundle.lore.some((entry) => entry.id === explicitFamily.familyId));

// An author-supplied protagonist is never discarded. The six-person family is
// retained as the ensemble and receives one entry link from the outside lead.
const externalLeadDraft = createDraft("quick");
externalLeadDraft.title = "外部主角仍然保留";
externalLeadDraft.genreId = "classic-topic-009";
externalLeadDraft.answers.playMode = optionalValue("rpg", "user_defined");
externalLeadDraft.protagonist = optionalValue("作者自訂主角", "user_defined");
const externalLeadBundle = buildProjectBundle(externalLeadDraft);
assert.equal(externalLeadBundle.protagonist.name, "作者自訂主角");
assert.equal(externalLeadBundle.cast.length, 6);
assert.equal(externalLeadBundle.storyBible.characterIds.length, 7);
assert.equal(externalLeadBundle.relationships.length, 8);
assert.equal(Object.keys(externalLeadBundle.storyState.relationships).length, 7);
assert.equal(externalLeadBundle.storyState.relationships[externalLeadBundle.protagonist.id], 10);
assert.ok(externalLeadBundle.relationships.some((relationship) => (
  relationship.fromCharacterId === externalLeadBundle.protagonist.id
  && relationship.kind === "上場家族引介"
)));

const wrongWorldSelection = serializeTopicWorldFamilyDraftSelection({
  matrix: buildTopicWorldFamilyStageMatrix({
    seed: `novel-project:${explicitDraft.projectId}:procedural-v1`,
    topicId: explicitDraft.genreId,
    playMode: "rpg",
    worldOrdinal: (explicitMatrix.worldOrdinal + 1) % 1_000,
  }),
  familyId: buildTopicWorldFamilyStageMatrix({
    seed: `novel-project:${explicitDraft.projectId}:procedural-v1`,
    topicId: explicitDraft.genreId,
    playMode: "rpg",
    worldOrdinal: (explicitMatrix.worldOrdinal + 1) % 1_000,
  }).stageFamilies[0].familyId,
});
const mismatchedDraft = structuredClone(explicitDraft);
mismatchedDraft.answers.stageFamily = optionalValue(wrongWorldSelection, "user_defined");
assert.throws(
  () => buildProjectBundle(mismatchedDraft),
  (error) => error?.code === "PROJECT_STAGE_FAMILY_SELECTION_MISMATCH",
);

console.log(JSON.stringify({
  ok: true,
  schemaVersion: TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION,
  buildMs: Number(buildMs.toFixed(2)),
  organizations: cultivation.organizations.map((organization) => organization.kindLabel),
  stageFamilies: cultivation.stageFamilies.length,
  stageCharacters: cultivation.capacity.materializedStageCharacters,
  xianxiaAssets: cultivation.assetControls.map((asset) => asset.category),
  addressableCharacters: cultivation.capacity.characters,
  addressableTreasures: cultivation.capacity.treasures,
  canonCandidate: candidate.status,
  canonApproval: approved.status,
}, null, 2));

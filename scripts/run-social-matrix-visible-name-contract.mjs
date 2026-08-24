import assert from "node:assert/strict";
import rawStoryLibrary from "../data/story-library.json" with { type: "json" };
import {
  TOPIC_WORLD_STAGE_MATERIALIZATION_POLICY,
  TOPIC_WORLD_STAGE_MEMBER_COUNT,
  TOPIC_WORLD_STAGE_ORGANIZATION_COUNT,
  buildTopicWorldFamilyStageMatrix,
  listTopicWorldFamilyStageCandidates,
} from "../lib/novel-ai/game/topic-world-family-stage-matrix.ts";
import {
  PROCEDURAL_CHARACTER_CAPACITY,
  PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
  PROCEDURAL_TREASURE_CAPACITY,
} from "../lib/novel-ai/game/procedural-story-library.ts";
import { DeterministicSocialMatrix } from "../lib/novel-ai/social-matrix/index.ts";

const PLAY_MODES = new Set(["general", "rpg", "romance", "management"]);
const classicTopics = rawStoryLibrary.topics.filter((topic) => topic.enabled && topic.classic);

assert.equal(classicTopics.length, 218, "visible-name gate must cover the complete 218-topic catalog");

function mixedBase36Tokens(value) {
  return value
    .split(/[・·／/\\\s()[\]{}:：|]+/u)
    .filter((token) => (
      /^[a-z0-9]{3,8}$/iu.test(token)
      && /[a-z]/iu.test(token)
      && /\d/u.test(token)
    ));
}

function visibleNameLeaks(scope, value) {
  const findings = [];
  if (/(?:social|topic|classic|world|family|institution|character|treasure)[-_:][a-z0-9_-]+/iu.test(value)) {
    findings.push({ scope, value, reason: "internal-namespace" });
  }
  // encodeIndex() is a zero-padded four-character base36 address.  The old
  // visible contract appended it after a middle dot (for example `・009P`),
  // including the all-numeric part of the address space.
  const suffixedBase36 = /(?:^|[・·])([A-Z0-9]{4})(?=$|[・·])/u.exec(value);
  if (suffixedBase36) {
    findings.push({ scope, value, reason: `suffixed-base36-token:${suffixedBase36[1]}` });
  }
  for (const token of mixedBase36Tokens(value)) {
    findings.push({ scope, value, reason: `mixed-base36-token:${token}` });
  }
  return findings;
}

const findings = [];
const duplicateRawInstitutions = [];
const duplicateRawFamilies = [];

const rawSocialScenarios = [
  {
    label: "cultivation",
    seed: "visible-name-cultivation",
    context: {
      genre: "仙俠修真",
      playMode: "rpg",
      storyTags: ["宗門", "家族", "修行"],
      conflict: "兩個宗門爭奪秘境入口",
    },
  },
  {
    label: "campus",
    seed: "visible-name-campus",
    context: {
      genre: "校園青春",
      playMode: "romance",
      storyTags: ["學生", "社團", "校隊"],
      conflict: "校際競賽與研究署名同時出現爭議",
    },
  },
  {
    label: "business",
    seed: "visible-name-business",
    context: {
      genre: "企業商戰",
      playMode: "management",
      storyTags: ["企業", "職場", "供應鏈"],
      conflict: "家族企業面臨供應與繼承危機",
    },
  },
  {
    label: "science-fiction",
    seed: "visible-name-science-fiction",
    context: {
      genre: "星際科幻",
      playMode: "rpg",
      storyTags: ["太空", "殖民地", "機器人"],
      conflict: "深空殖民地的維生系統遭到未知訊號干擾",
    },
  },
  {
    label: "historical",
    seed: "visible-name-historical",
    context: {
      genre: "歷史權謀",
      playMode: "rpg",
      storyTags: ["朝堂", "古代", "漕運"],
      conflict: "漕運舊案牽動朝堂與邊境糧道",
    },
  },
];

const nativeGenreContracts = {
  campus: {
    role: /學生|社團|研究|校隊|導師|圖書館|實驗室|校務/u,
    familyRole: /社員|競賽|同組|學長姊|新生|指導老師/u,
    location: /圖書館|社團|實驗室|校隊|學生會|校園/u,
    specialty: /研究|簡報|實驗|程式|辯論|文獻|活動|運動/u,
    secret: /競賽|研究|社團|匿名|考場|校刊/u,
    possessionKind: /教材|器材|文件|憑證|研究資料/u,
    forbidden: /宗門|外門弟子|內門弟子|煉丹|符法|陣法|靈田|洞府|丹藥|符籙|法器|秘境|艦橋|反應爐|漕運/u,
  },
  business: {
    role: /營運|產品|財務|品質|法務|供應鏈|客戶|稽核/u,
    familyRole: /創業|董事|部門|專案|接班|顧問/u,
    location: /董事會|產品實驗室|港區倉庫|客戶簡報|品質稽核|供應鏈/u,
    specialty: /現金流|供應鏈|品質|合約|市場|產品|風險|客戶/u,
    secret: /供應商|財測|董事|缺陷|接班|客戶/u,
    possessionKind: /合約|設備|文件|數據|資源/u,
    forbidden: /宗門|外門弟子|內門弟子|煉丹|符法|陣法|靈田|洞府|丹藥|符籙|法器|秘境|艦橋|反應爐|漕運/u,
  },
  "science-fiction": {
    role: /艦長|導航|系統工程|生醫|科學家|通訊|殖民|救援/u,
    familyRole: /艦橋|科研|維生|殖民|航運|救援/u,
    location: /艦橋|維生艙|軌道|火星|外環|深空/u,
    specialty: /軌道|維生|訊號|外星|機器人|反應爐|低重力|殖民/u,
    secret: /維生|未知訊號|航道|人工智慧|樣本|撤離/u,
    possessionKind: /生醫製劑|航太模組|通行憑證|維生系統|異星樣本/u,
    forbidden: /宗門|外門弟子|內門弟子|煉丹|符法|陣法|靈田|洞府|丹藥|符籙|法器|秘境|漕運|翰林/u,
  },
  historical: {
    role: /史官|幕僚|校尉|掌櫃|漕運吏|醫官|使節|書吏/u,
    familyRole: /長房|旁房|門客|家臣|嫡系|姻親/u,
    location: /京畿|翰林|北境|江南|漕運|清河/u,
    specialty: /經史|軍陣|漕運|禮制|醫藥|公文|輿圖|情報/u,
    secret: /密奏|漕運|舊案|繼承|北境|賜婚/u,
    possessionKind: /藥材|兵器|文書|印信|輿圖/u,
    forbidden: /宗門|外門弟子|內門弟子|煉丹|符法|陣法|靈田|洞府|丹藥|符籙|法器|秘境|艦橋|反應爐|機器人/u,
  },
};

function sampledCharacters(matrix) {
  const indexes = [0, 17, 703, 9_999, PROCEDURAL_CHARACTER_CAPACITY - 1];
  const characters = indexes.map((index) => matrix.getCharacter(index));
  if (!characters.some((character) => character.possessions.length > 0)) {
    for (let index = 0; index < 256; index += 1) {
      const character = matrix.getCharacter(index);
      if (character.possessions.length > 0) {
        characters.push(character);
        break;
      }
    }
  }
  return characters;
}

function assertNativeGenre(scenario, matrix) {
  const contract = nativeGenreContracts[scenario.label];
  if (!contract) return;
  const characters = sampledCharacters(matrix);
  assert.ok(characters.some((character) => character.possessions.length > 0), `${scenario.label} sample must include a possession`);
  characters.forEach((character) => {
    assert.match(character.institutionRole, contract.role, `${scenario.label} role must use native vocabulary`);
    assert.match(character.familyRole, contract.familyRole, `${scenario.label} family role must use native vocabulary`);
    assert.match(character.location, contract.location, `${scenario.label} location must use native vocabulary`);
    assert.match(character.secret, contract.secret, `${scenario.label} secret must use native vocabulary`);
    character.abilities.specialties.forEach((specialty) => {
      assert.match(specialty, contract.specialty, `${scenario.label} specialty must use native vocabulary`);
    });
    const characterSurface = [
      character.institutionRole,
      character.familyRole,
      character.location,
      character.secret,
      ...character.abilities.specialties,
    ].join("｜");
    assert.doesNotMatch(characterSurface, contract.forbidden, `${scenario.label} character vocabulary was polluted by another genre`);
    character.possessions.forEach((possession) => {
      assert.match(possession.kind, contract.possessionKind, `${scenario.label} possession kind must use native vocabulary`);
      const possessionSurface = [
        possession.kind,
        possession.name,
        possession.function,
        possession.limitation,
        possession.cost,
        possession.storyHook,
      ].join("｜");
      assert.doesNotMatch(possessionSurface, contract.forbidden, `${scenario.label} possession vocabulary was polluted by another genre`);
    });
  });
}

// The complete raw virtual catalogs must expose unique, human-readable names
// while their stable IDs retain deterministic internal addresses.
for (const scenario of rawSocialScenarios) {
  const matrix = new DeterministicSocialMatrix({
    seed: scenario.seed,
    context: scenario.context,
    populationSize: PROCEDURAL_CHARACTER_CAPACITY,
    cacheLimit: 0,
  });
  const institutionNames = [];
  const familyNames = [];
  for (let index = 0; index < matrix.institutionCount; index += 1) {
    const name = matrix.getInstitution(index).name;
    institutionNames.push(name);
    findings.push(...visibleNameLeaks(
      `social-matrix:${scenario.label}:institution:${index}`,
      name,
    ));
  }
  for (let index = 0; index < matrix.familyCount; index += 1) {
    const name = matrix.getFamily(index).name;
    familyNames.push(name);
    findings.push(...visibleNameLeaks(
      `social-matrix:${scenario.label}:family:${index}`,
      name,
    ));
  }
  if (new Set(institutionNames).size !== institutionNames.length) {
    duplicateRawInstitutions.push({ label: scenario.label, names: institutionNames });
  }
  if (new Set(familyNames).size !== familyNames.length) {
    duplicateRawFamilies.push({ label: scenario.label, names: familyNames });
  }

  const metadata = matrix.indexMetadata();
  assert.equal(metadata.populationSize, PROCEDURAL_CHARACTER_CAPACITY);
  assert.equal(metadata.eagerlyMaterializedCharacters, 0);
  assert.equal(metadata.indexStrategy, "deterministic-invertible-virtual-index");
  assert.equal(matrix.getCharacter(PROCEDURAL_CHARACTER_CAPACITY - 1).populationIndex, 99_999);
  assertNativeGenre(scenario, matrix);
}

const duplicateOrganizations = [];
const duplicateFamilies = [];
const duplicateSelectableCandidates = [];
let stageMatricesChecked = 0;

function primaryPlayMode(topic) {
  const supported = topic.supportedPlayModes.filter((mode) => PLAY_MODES.has(mode));
  return supported.find((mode) => mode !== "general") ?? "general";
}

function inspectStageMatrix(topic, playMode, worldOrdinal) {
  const matrix = buildTopicWorldFamilyStageMatrix({
    seed: `visible-name-gate:${topic.topicId}:${playMode}:${worldOrdinal}`,
    topicId: topic.topicId,
    playMode,
    worldOrdinal,
  });
  stageMatricesChecked += 1;

  assert.equal(matrix.capacity.characters, PROCEDURAL_CHARACTER_CAPACITY);
  assert.equal(matrix.capacity.treasures, PROCEDURAL_TREASURE_CAPACITY);
  assert.equal(matrix.capacity.relationshipScenarios, PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY);
  assert.equal(matrix.capacity.materializationPolicy, TOPIC_WORLD_STAGE_MATERIALIZATION_POLICY);
  assert.equal(
    matrix.capacity.materializedStageCharacters,
    TOPIC_WORLD_STAGE_ORGANIZATION_COUNT * TOPIC_WORLD_STAGE_MEMBER_COUNT,
  );
  assert.equal(matrix.capacity.materializedStageAssets, matrix.assetControls.length);
  assert.ok(matrix.capacity.materializedStageCharacters < matrix.capacity.characters);
  assert.ok(matrix.capacity.materializedStageAssets < matrix.capacity.treasures);

  const organizationNames = matrix.organizations.map((organization) => organization.name);
  const familyNames = matrix.stageFamilies.map((family) => family.name);
  const selectableTitles = listTopicWorldFamilyStageCandidates({ matrix }).map((option) => option.title);
  if (new Set(organizationNames).size !== organizationNames.length) {
    duplicateOrganizations.push({ topicId: topic.topicId, playMode, worldOrdinal, names: organizationNames });
  }
  if (new Set(familyNames).size !== familyNames.length) {
    duplicateFamilies.push({ topicId: topic.topicId, playMode, worldOrdinal, names: familyNames });
  }
  if (new Set(selectableTitles).size !== selectableTitles.length) {
    duplicateSelectableCandidates.push({ topicId: topic.topicId, playMode, worldOrdinal, titles: selectableTitles });
  }

  matrix.organizations.forEach((organization, index) => {
    findings.push(...visibleNameLeaks(
      `topic-stage:${topic.topicId}:${playMode}:${worldOrdinal}:organization:${index}`,
      organization.name,
    ));
  });
  matrix.stageFamilies.forEach((family, familyIndex) => {
    findings.push(...visibleNameLeaks(
      `topic-stage:${topic.topicId}:${playMode}:${worldOrdinal}:family:${familyIndex}`,
      family.name,
    ));
    family.members.forEach((member, memberIndex) => {
      findings.push(...visibleNameLeaks(
        `topic-stage:${topic.topicId}:${playMode}:${worldOrdinal}:family:${familyIndex}:member:${memberIndex}`,
        member.name,
      ));
    });
  });
}

// Every classic topic is checked in its primary supported mode. Boundary-world
// replay is then checked across all four coordinator modes for representative
// catalog addresses without turning this focused gate into a full load test.
for (const topic of classicTopics) {
  inspectStageMatrix(topic, primaryPlayMode(topic), 0);
}
for (const topic of [classicTopics[0], classicTopics[8], classicTopics[108], classicTopics.at(-1)]) {
  for (const playMode of PLAY_MODES) {
    inspectStageMatrix(topic, playMode, 999);
  }
}

assert.deepEqual(findings, [], `visible names leaked internal identifiers:\n${JSON.stringify(findings.slice(0, 12), null, 2)}`);
assert.deepEqual(
  duplicateRawInstitutions,
  [],
  `all 256 raw institutions must have unique visible names:\n${JSON.stringify(duplicateRawInstitutions.slice(0, 12), null, 2)}`,
);
assert.deepEqual(
  duplicateRawFamilies,
  [],
  `all 4,096 raw families must have unique visible names:\n${JSON.stringify(duplicateRawFamilies.slice(0, 12), null, 2)}`,
);
assert.deepEqual(
  duplicateOrganizations,
  [],
  `same-page organizations must be distinguishable:\n${JSON.stringify(duplicateOrganizations.slice(0, 12), null, 2)}`,
);
assert.deepEqual(
  duplicateFamilies,
  [],
  `same-page stage families must be distinguishable:\n${JSON.stringify(duplicateFamilies.slice(0, 12), null, 2)}`,
);
assert.deepEqual(
  duplicateSelectableCandidates,
  [],
  `the three selectable family candidates must have distinct titles:\n${JSON.stringify(duplicateSelectableCandidates.slice(0, 12), null, 2)}`,
);

console.log(JSON.stringify({
  result: "PASS",
  catalogTopicsChecked: classicTopics.length,
  stageMatricesChecked,
  rawSocialInstitutionNamesChecked: rawSocialScenarios.length * 256,
  rawSocialFamilyNamesChecked: rawSocialScenarios.length * 4_096,
  visibleInternalIdentifierLeaks: findings.length,
  duplicateRawInstitutionCatalogs: duplicateRawInstitutions.length,
  duplicateRawFamilyCatalogs: duplicateRawFamilies.length,
  duplicateFourOrganizationPages: duplicateOrganizations.length,
  duplicateFourFamilyPages: duplicateFamilies.length,
  duplicateThreeCandidatePages: duplicateSelectableCandidates.length,
  capacity: {
    characters: PROCEDURAL_CHARACTER_CAPACITY,
    treasures: PROCEDURAL_TREASURE_CAPACITY,
    relationshipScenarios: PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
    materialization: TOPIC_WORLD_STAGE_MATERIALIZATION_POLICY,
  },
}, null, 2));

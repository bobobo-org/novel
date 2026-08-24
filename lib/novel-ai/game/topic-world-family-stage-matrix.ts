import rawStoryLibrary from "../../../data/story-library.json" with { type: "json" };
import type { StoryLibrary } from "../../novel-data/story-library-types";
import {
  DeterministicSocialMatrix,
  type SocialMatrixAbilities,
  type SocialMatrixCharacter,
  type SocialMatrixPersonality,
  type SocialMatrixPortrait,
  type SocialRelationshipKind,
} from "../social-matrix";
import {
  PROCEDURAL_CHARACTER_CAPACITY,
  PROCEDURAL_ORIGIN_POLICY,
  PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
  PROCEDURAL_TREASURE_CAPACITY,
  type ProceduralStoryContext,
} from "./procedural-story-library";
import { proceduralTreasureRecordAt } from "./procedural-treasure-library";
import {
  topicWorldContractAt,
  type TopicWorldContract,
  type TopicWorldPlayMode,
} from "./topic-world-contract";

const STORY_LIBRARY = rawStoryLibrary as StoryLibrary;
const TOPIC_BY_ID = new Map(
  STORY_LIBRARY.topics
    .filter((topic) => topic.enabled && topic.classic)
    .map((topic) => [topic.topicId, topic] as const),
);

if (TOPIC_BY_ID.size !== 218) {
  throw new Error(`TOPIC_WORLD_FAMILY_STAGE_TOPIC_CATALOG_MISMATCH:${TOPIC_BY_ID.size}`);
}

export const TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION =
  "topic-world-family-stage-matrix-v1" as const;
export const TOPIC_WORLD_STAGE_ORGANIZATION_COUNT = 4;
export const TOPIC_WORLD_STAGE_MEMBER_COUNT = 6;
export const TOPIC_WORLD_STAGE_MATERIALIZATION_POLICY =
  "deterministic-indexed-on-demand-no-eager-population-blob" as const;

export type TopicWorldStageRole =
  | "男主角候選"
  | "女主角候選"
  | "家族長輩"
  | "同輩骨幹"
  | "盟友代表"
  | "對手代表";

export type TopicWorldStageMember = {
  characterId: string;
  populationIndex: number;
  fictional: true;
  originPolicy: typeof PROCEDURAL_ORIGIN_POLICY;
  canonicalStatus: "VIRTUAL_CANDIDATE";
  stageRole: TopicWorldStageRole;
  name: string;
  pronouns: SocialMatrixCharacter["pronouns"];
  age: number;
  lifeStage: SocialMatrixCharacter["lifeStage"];
  familyRole: string;
  organizationRole: string;
  identity: string;
  goal: string;
  secret: string;
  personality: SocialMatrixPersonality;
  abilities: SocialMatrixAbilities;
  possessionNames: string[];
  portrait: SocialMatrixPortrait;
};

export type TopicWorldStageRelationship = {
  relationshipId: string;
  sourceCharacterId: string;
  targetCharacterId: string;
  kind: SocialRelationshipKind;
  trust: number;
  tension: number;
  obligation: number;
  historyHook: string;
};

export type TopicWorldStageOrganization = {
  organizationId: string;
  ordinal: number;
  kindLabel: string;
  name: string;
  territory: string;
  doctrine: string;
  influence: number;
  publicGoal: string;
  hiddenConflict: string;
  allyOrganizationIds: string[];
  rivalOrganizationIds: string[];
  memberCapacity: number;
  contractStatement: string;
  situationBrief: string;
  controlledAssetIds: string[];
  contestedAssetIds: string[];
};

export type TopicWorldStageFamily = {
  familyId: string;
  ordinal: number;
  name: string;
  organizationId: string;
  organizationName: string;
  organizationKind: string;
  home: string;
  reputation: string;
  inheritedTrait: string;
  memberCapacity: number;
  standing: string;
  stagePremise: string;
  introduction: string;
  members: TopicWorldStageMember[];
  relationships: TopicWorldStageRelationship[];
  assetControlIds: string[];
};

export type TopicWorldAssetControlRelation =
  | "掌握"
  | "持有"
  | "控制"
  | "共同保管"
  | "爭奪中";

export type TopicWorldStageAssetControl = {
  assetControlId: string;
  loreId: string;
  category: string;
  name: string;
  contractStatement: string;
  catalogTreasureId: string;
  treasureOrdinal: number;
  controllerOrganizationId: string;
  controllerOrganizationName: string;
  holderFamilyId: string;
  holderCharacterId: string;
  holderName: string;
  controlRelation: TopicWorldAssetControlRelation;
  claimantOrganizationId: string | null;
  claimantOrganizationName: string | null;
  function: string;
  limitation: string;
  cost: string;
  visualDescription: string;
  storyHook: string;
};

export type TopicWorldFamilyStageMatrix = {
  schemaVersion: typeof TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION;
  matrixId: string;
  seed: string;
  topicId: string;
  topicName: string;
  worldId: string;
  worldOrdinal: number;
  contractId: string;
  worldFamily: TopicWorldContract["worldFamily"];
  worldSituation: string;
  playClassification: {
    mode: TopicWorldPlayMode;
    label: string;
    compatibility: "native" | "cross-mode";
    dimensions: string[];
    rules: string[];
  };
  capacity: {
    characters: typeof PROCEDURAL_CHARACTER_CAPACITY;
    treasures: typeof PROCEDURAL_TREASURE_CAPACITY;
    relationshipScenarios: typeof PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY;
    materializationPolicy: typeof TOPIC_WORLD_STAGE_MATERIALIZATION_POLICY;
    materializedStageCharacters: number;
    materializedStageAssets: number;
  };
  worldContract: TopicWorldContract;
  organizations: TopicWorldStageOrganization[];
  stageFamilies: TopicWorldStageFamily[];
  assetControls: TopicWorldStageAssetControl[];
  canonicalStatus: "VIRTUAL_CANDIDATE";
  canonicalMutation: 0;
};

export type TopicWorldFamilyCanonCandidate = {
  schemaVersion: typeof TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION;
  candidateId: string;
  matrixId: string;
  contractId: string;
  topicId: string;
  worldId: string;
  selectedFamilyId: string;
  status: "PENDING_APPROVAL";
  canonicalMutation: 0;
  payloadFingerprint: string;
  canonPatch: TopicWorldFamilyCanonPatch;
  canonRecords: TopicWorldFamilyCanonRecords;
};

export type TopicWorldFamilyCanonPatch = {
  worldId: string;
  worldRuleIds: string[];
  organizationIds: string[];
  characterIds: string[];
  relationshipIds: string[];
  loreIds: string[];
};

export type TopicWorldFamilyCanonRecords = {
  world: {
    worldId: string;
    topicId: string;
    topicName: string;
    worldOrdinal: number;
    worldFamily: TopicWorldContract["worldFamily"];
    displaySummary: string;
    selectedFamilyId: string;
  };
  worldRules: Array<{ ruleId: string; statement: string }>;
  organizations: TopicWorldStageOrganization[];
  selectedFamily: TopicWorldStageFamily;
  characters: TopicWorldStageMember[];
  relationships: TopicWorldStageRelationship[];
  lore: TopicWorldStageAssetControl[];
  playMechanics: TopicWorldFamilyStageMatrix["playClassification"];
};

export type ApprovedTopicWorldFamilyCanon = Omit<
  TopicWorldFamilyCanonCandidate,
  "status" | "canonicalMutation"
> & {
  status: "APPROVED";
  canonicalMutation: 1;
  approvalId: string;
  projectId: string;
  approvedAt: string;
  approvedBy: string;
};

export type TopicWorldFamilyStageCandidateOption = {
  optionId: string;
  familyId: string;
  title: string;
  summary: string;
  family: TopicWorldStageFamily;
  worldOrganizations: TopicWorldStageOrganization[];
  worldAssetControls: TopicWorldStageAssetControl[];
  completeWorldIntroduction: string;
};

export type TopicWorldFamilyDraftSelection = {
  schemaVersion: typeof TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION;
  address: {
    seed: string;
    topicId: string;
    playMode: TopicWorldPlayMode;
    worldOrdinal: number;
  };
  matrixId: string;
  contractId: string;
  selectedFamilyId: string;
  /** Stable member identity retained even when the author later renames the protagonist. */
  selectedProtagonistId?: string;
};

const XIANXIA_ORGANIZATION_KINDS = [
  "宗門",
  "修行家族",
  "散修盟",
  "坊市",
] as const;

const XIANXIA_ASSET_CONTROL_RELATIONS: Record<string, TopicWorldAssetControlRelation> = {
  功法: "掌握",
  寶物: "共同保管",
  丹藥: "持有",
  符籙: "持有",
  陣法: "控制",
  法器: "持有",
  靈草: "持有",
  秘境: "控制",
};

const STAGE_ROLE_ORDER: TopicWorldStageRole[] = [
  "男主角候選",
  "女主角候選",
  "家族長輩",
  "同輩骨幹",
  "盟友代表",
  "對手代表",
];

function hashText(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function stableTag(value: string) {
  return hashText(value).toString(36).padStart(7, "0");
}

function stableScore(value: string, minimum: number, maximum: number) {
  return minimum + (hashText(value) % (maximum - minimum + 1));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizeAssetCategory(value: string) {
  const category = value.split(/[：｜]/u)[0]?.trim() || "題材資源";
  if (/武器|法器/u.test(category)) return "法器";
  if (/秘境/u.test(category)) return "秘境";
  return category;
}

function cultivationAssetSemantics(input: {
  category: string;
  name: string;
  matrixSeed: string;
  ordinal: number;
}) {
  const variant = hashText(`${input.matrixSeed}|cultivation-asset-semantics|${input.ordinal}`) % 3;
  const profiles: Record<string, Array<{
    visualDescription: string;
    function: string;
    limitation: string;
    cost: string;
  }>> = {
    功法: [
      {
        visualDescription: `功法「${input.name}」以分層心法、行氣圖與禁忌篇組成，每一層都留有前人修行後的校正記錄。`,
        function: "將靈力依固定週天運行，強化一項已掌握的修行能力，不能跳過境界。",
        limitation: "必須由師承或校驗過的殘篇引導；體質、靈根或行氣路徑不合者不得強練。",
        cost: "閉關期間會佔用時間與靈氣，強行運轉會留下可追蹤的經脈損傷。",
      },
      {
        visualDescription: `功法「${input.name}」分為口訣、勢圖與境界批註，真傳部分只能由已立誓者解讀。`,
        function: "穩定一種靈力性質並開啟後續術法分支，成效取決於日常累積。",
        limitation: "每個大境界只能校驗一次核心篇，未完成前不能同修衝突功法。",
        cost: "每次突破都必須提交完整行氣記錄，失敗時會暫時封閉一處靈竅。",
      },
      {
        visualDescription: `功法「${input.name}」保存於可驗真的傳承印記中，文字會隨修為顯露不同章節。`,
        function: "將一次明確的修行心得轉為可重複的術法基礎，並保留原有代價。",
        limitation: "只能解鎖修行者已經親身驗證的部分，不接受單憑轉述而來的領悟。",
        cost: "每次解鎖都會消耗一段神識與時間，且必須公開一項修行失敗記錄。",
      },
    ],
    丹藥: [{
      visualDescription: `丹藥「${input.name}」有獨立丹紋、藥性封蠟與爐次印記，可由丹師追溯來源。`,
      function: "在有限時間內調理靈力、穩住傷勢或輔助衝關，不能取代修行。",
      limitation: "需先核對體質、劑量與相克藥性；同類丹藥在藥性未散前不得重複服用。",
      cost: "服用後會留下丹毒或靈力透支，需以休息、靈草或後續療程化解。",
    }],
    符籙: [{
      visualDescription: `符籙「${input.name}」的符頭、符膽與落款完整，符紙邊緣留有一次性啟用印。`,
      function: "在符文規定的一個目標上觸發防護、遁行、封禁或傳訊效果。",
      limitation: "必須在符文失效前由有資格者注入靈力，不能同時覆蓋互相衝突的效果。",
      cost: "啟用後符籙會無法復原，並留下可被追查的靈力落款。",
    }],
    陣法: [{
      visualDescription: `陣法「${input.name}」由陣圖、陣眼、方位標記與維護錄組成，任一節點都有可核對的責任人。`,
      function: "在已勘定範圍內建立防護、傳送、聚靈或封禁等群體性效果。",
      limitation: "需完成地脈勘測、陣眼校準與人員分工；一處陣眼受損就會造成整體偏移。",
      cost: "啟動與維持都會持續消耗靈石、材料與守陣者體力。",
    }],
    法器: [{
      visualDescription: `法器「${input.name}」具有獨立器紋、鍛造落款與歷代持有痕跡，器靈反應可被驗證。`,
      function: "放大持有者一項已掌握的戰鬥、防護、移動或偵測能力。",
      limitation: "必須完成認主或借用契約，且不能超出持有者可承受的靈力負荷。",
      cost: "高強度使用會累積器損並暴露靈力氣息，需以稀缺材料維修。",
    }],
    靈草: [{
      visualDescription: `靈草「${input.name}」有可識別的葉脈、藥香與成熟週期，採集地點與日期都已入冊。`,
      function: "作為煉丹、療傷、布陣或調理體質的核心材料。",
      limitation: "只能在成熟窗口內依正確方式採集，過早、過晚或保存不當都會使藥性流失。",
      cost: "採集後原生地需要時間復原，濫採會降低地脈品質並引發勢力爭端。",
    }],
    秘境: [{
      visualDescription: `秘境「${input.name}」擁有獨立入口、開啟週期、試煉規則與離開條件，地圖只會隨實地探索更新。`,
      function: "提供一條可驗證的試煉、傳承或稀有資源路線，結果取決於人物行動。",
      limitation: "只在特定時間、信物或人數條件下開啟；進入後不能隨意重置地形與已發生的因果。",
      cost: "每次開啟都會消耗信物或改變入口穩定度，失敗後必須等待下一個週期。",
    }],
    寶物: [{
      visualDescription: `寶物「${input.name}」的材質、封印、磨損與持有權印記皆可辨識，來歷會隨調查逐步解封。`,
      function: "在特定情境中觸發一項稀有能力，但不能覆寫持有者的選擇與已發生後果。",
      limitation: "啟用條件、所有權與封印狀態必須同時成立，強行使用會使效果偏移。",
      cost: "每次啟用都會降低完整度或引來其他聲索者，無法無限次反覆使用。",
    }],
  };
  const candidates = profiles[input.category] ?? profiles.寶物!;
  return candidates[variant % candidates.length]!;
}

function assetDisplayName(statement: string, category: string, fallback: string) {
  const body = statement.split("：").slice(1).join("：").trim();
  if (!body) return fallback;
  const delimiters = category === "秘境"
    ? /；|，/u
    : /現由|由|須|可|含|生於|牽動|；|，/u;
  const candidate = body.split(delimiters)[0]?.trim();
  if (!candidate || candidate.length > 32) {
    return category === "秘境" ? `${fallback}秘境` : fallback;
  }
  return candidate;
}

function organizationName(statement: string, ordinal: number) {
  const body = statement.split("：").slice(1).join("：").trim();
  const candidate = body.split(/以|為|由|掌握|目前|；|，/u)[0]?.trim();
  return candidate || statement.split("：")[0]?.trim() || `題材勢力 ${ordinal + 1}`;
}

function topicDerivedOrganizationKind(statement: string) {
  const signal = statement.replaceAll("：", "");
  if (/家族|世家|宗族|氏/u.test(signal)) return "家族";
  if (/公司|企業|財團|財閥|集團/u.test(signal)) return "企業集團";
  if (/學校|學院|書院|研究/u.test(signal)) return "學術團體";
  if (/商會|市場|店|平台|交易/u.test(signal)) return "商業組織";
  if (/政府|王朝|宮廷|軍|警|府|議會/u.test(signal)) return "政權組織";
  if (/公會|協會|聯盟|社群|團隊/u.test(signal)) return "同盟組織";
  return "題材勢力";
}

function organizationKind(contract: TopicWorldContract, statement: string, ordinal: number) {
  return contract.worldFamily === "cultivation"
    ? XIANXIA_ORGANIZATION_KINDS[ordinal] ?? "修行勢力"
    : topicDerivedOrganizationKind(statement);
}

function familyDisplayName(input: {
  contract: TopicWorldContract;
  baseName: string;
  organizationName: string;
  organizationKind: string;
}) {
  if (input.contract.worldFamily === "cultivation") {
    if (input.organizationKind === "宗門") return `${input.baseName}・${input.organizationName}師承支`;
    if (input.organizationKind === "修行家族") return input.organizationName;
    if (input.organizationKind === "散修盟") return `${input.baseName}・${input.organizationName}同行家族`;
    return `${input.baseName}・${input.organizationName}商脈`;
  }
  if (input.organizationKind === "企業集團") return `${input.baseName}・經營家族`;
  if (input.organizationKind === "政權組織") return `${input.baseName}・權力家族`;
  if (input.organizationKind === "學術團體") return `${input.baseName}・師生家系`;
  return `${input.baseName}・${input.organizationName}關係網`;
}

function roleCandidate(
  members: SocialMatrixCharacter[],
  role: TopicWorldStageRole,
  used: Set<string>,
) {
  const unused = members.filter((member) => !used.has(member.characterId));
  if (role === "男主角候選") return unused.find((member) => member.pronouns === "他");
  if (role === "女主角候選") return unused.find((member) => member.pronouns === "她");
  if (role === "家族長輩") return unused.find((member) => member.lifeStage === "長者");
  if (role === "同輩骨幹") return unused.find((member) => member.lifeStage === "青年" || member.lifeStage === "壯年");
  if (role === "盟友代表") {
    return [...unused].sort((left, right) => right.personality.loyalty - left.personality.loyalty)[0];
  }
  return [...unused].sort((left, right) => right.personality.ambition - left.personality.ambition)[0];
}

function familySupportsStageRoles(members: SocialMatrixCharacter[]) {
  return members.some((member) => member.pronouns === "他")
    && members.some((member) => member.pronouns === "她")
    && members.some((member) => member.lifeStage === "長者");
}

function chooseStageFamily(input: {
  matrix: DeterministicSocialMatrix;
  matrixSeed: string;
  organizationOrdinal: number;
}) {
  const start = hashText(`${input.matrixSeed}|family|${input.organizationOrdinal}`)
    % input.matrix.familyCount;
  for (let attempt = 0; attempt < 96; attempt += 1) {
    const familyIndex = (start + attempt * 97) % input.matrix.familyCount;
    const page = input.matrix.listFamilyMembers(familyIndex, { limit: 100 });
    if (page.items.length >= TOPIC_WORLD_STAGE_MEMBER_COUNT && familySupportsStageRoles(page.items)) {
      return {
        family: input.matrix.getFamily(familyIndex),
        members: page.items,
      };
    }
  }
  throw new Error(`TOPIC_WORLD_STAGE_FAMILY_CAST_NOT_FOUND:${input.organizationOrdinal}`);
}

function stageMember(
  member: SocialMatrixCharacter,
  role: TopicWorldStageRole,
  familyName: string,
  organizationNameValue: string,
) : TopicWorldStageMember {
  return {
    characterId: member.characterId,
    populationIndex: member.populationIndex,
    fictional: true,
    originPolicy: member.originPolicy,
    canonicalStatus: "VIRTUAL_CANDIDATE",
    stageRole: role,
    name: member.name,
    pronouns: member.pronouns,
    age: member.age,
    lifeStage: member.lifeStage,
    familyRole: member.familyRole,
    organizationRole: member.institutionRole,
    identity: `${familyName}的${role}，同時隸屬${organizationNameValue}；${member.identity}`,
    goal: member.goal,
    secret: member.secret,
    personality: clone(member.personality),
    abilities: clone(member.abilities),
    possessionNames: member.possessions.map((possession) => possession.name),
    portrait: {
      ...clone(member.portrait),
      description: `原創程序化人物肖像：${member.portrait.description}`,
    },
  };
}

function stageRelationships(input: {
  matrixSeed: string;
  familyId: string;
  members: TopicWorldStageMember[];
}) {
  const byRole = new Map(input.members.map((member) => [member.stageRole, member] as const));
  const links: Array<{
    source: TopicWorldStageRole;
    target: TopicWorldStageRole;
    kind: SocialRelationshipKind;
    hook: string;
  }> = [
    { source: "家族長輩", target: "男主角候選", kind: "監護", hook: "曾替對方扛下一項會改變家族名聲的責任" },
    { source: "家族長輩", target: "女主角候選", kind: "師徒", hook: "掌握對方成長所需的傳承，也保留拒絕交出的理由" },
    { source: "男主角候選", target: "女主角候選", kind: "盟友", hook: "在同一危機中互相救過一次，卻對代價有不同理解" },
    { source: "同輩骨幹", target: "男主角候選", kind: "競爭", hook: "兩人都能承接家族任務，但只有一人能取得下一階段資源" },
    { source: "盟友代表", target: "女主角候選", kind: "救命之恩", hook: "欠下的人情尚未償還，履約方式會牽動另一個勢力" },
    { source: "對手代表", target: "男主角候選", kind: "宿敵", hook: "公開立場相反，私下卻共同保守一件不能曝光的往事" },
    { source: "對手代表", target: "盟友代表", kind: "交易", hook: "一紙尚未完成的交換條件使敵友界線隨時可能翻轉" },
  ];
  return links.map((link, ordinal): TopicWorldStageRelationship => {
    const source = byRole.get(link.source)!;
    const target = byRole.get(link.target)!;
    const key = `${input.matrixSeed}|${input.familyId}|relationship|${ordinal}`;
    return {
      relationshipId: `${TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION}:relationship:${stableTag(key)}`,
      sourceCharacterId: source.characterId,
      targetCharacterId: target.characterId,
      kind: link.kind,
      trust: stableScore(`${key}|trust`, 18, 82),
      tension: stableScore(`${key}|tension`, 24, 91),
      obligation: stableScore(`${key}|obligation`, 20, 88),
      historyHook: `${source.name}與${target.name}${link.hook}。`,
    };
  });
}

function stageFamily(input: {
  contract: TopicWorldContract;
  matrix: DeterministicSocialMatrix;
  matrixSeed: string;
  organization: TopicWorldStageOrganization;
}) : TopicWorldStageFamily {
  const selection = chooseStageFamily({
    matrix: input.matrix,
    matrixSeed: input.matrixSeed,
    organizationOrdinal: input.organization.ordinal,
  });
  const name = familyDisplayName({
    contract: input.contract,
    baseName: selection.family.name,
    organizationName: input.organization.name,
    organizationKind: input.organization.kindLabel,
  });
  const used = new Set<string>();
  const members = STAGE_ROLE_ORDER.map((role) => {
    const selected = roleCandidate(selection.members, role, used);
    if (!selected) throw new Error(`TOPIC_WORLD_STAGE_FAMILY_ROLE_NOT_FOUND:${role}`);
    used.add(selected.characterId);
    return stageMember(selected, role, name, input.organization.name);
  });
  const relationships = stageRelationships({
    matrixSeed: input.matrixSeed,
    familyId: selection.family.familyId,
    members,
  });
  const standing = `${selection.family.reputation}；以${selection.family.inheritedTrait}維持家族位置，對${input.organization.hiddenConflict}有直接利害。`;
  const stagePremise = `${name}將以一個家族而非單一主角上場：男女主角候選、長輩、同輩、盟友與對手都保有自己的目標與拒絕條件。`;
  const introduction = [
    `${name}位於${selection.family.home}，共 ${selection.family.memberCount} 名可按需解碼的原創家族成員。`,
    `其所屬勢力為${input.organization.kindLabel}「${input.organization.name}」；${input.organization.situationBrief}`,
    `上場六人為${members.map((member) => `${member.stageRole}${member.name}`).join("、")}。`,
    `關係核心：${relationships.slice(0, 3).map((relationship) => relationship.historyHook).join("；")}`,
    `目前家族位置：${standing}`,
  ].join("\n");
  return {
    familyId: selection.family.familyId,
    ordinal: selection.family.familyIndex,
    name,
    organizationId: input.organization.organizationId,
    organizationName: input.organization.name,
    organizationKind: input.organization.kindLabel,
    home: selection.family.home,
    reputation: selection.family.reputation,
    inheritedTrait: selection.family.inheritedTrait,
    memberCapacity: selection.family.memberCount,
    standing,
    stagePremise,
    introduction,
    members,
    relationships,
    assetControlIds: [],
  };
}

function buildOrganizations(input: {
  contract: TopicWorldContract;
  socialMatrix: DeterministicSocialMatrix;
  matrixSeed: string;
}) {
  const statements = input.contract.institutions.slice(0, TOPIC_WORLD_STAGE_ORGANIZATION_COUNT);
  if (statements.length !== TOPIC_WORLD_STAGE_ORGANIZATION_COUNT) {
    throw new Error(`TOPIC_WORLD_STAGE_ORGANIZATION_COUNT_INVALID:${statements.length}`);
  }
  const organizations = statements.map((statement, ordinal): TopicWorldStageOrganization => {
    const institutionIndex = hashText(`${input.matrixSeed}|organization|${ordinal}`)
      % input.socialMatrix.institutionCount;
    const source = input.socialMatrix.getInstitution(institutionIndex);
    const organizationId = `${TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION}:organization:${stableTag(`${input.contract.worldId}|${ordinal}`)}`;
    const name = organizationName(statement, ordinal);
    const kindLabel = organizationKind(input.contract, statement, ordinal);
    const allyOrganizationIds = [
      `${TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION}:organization:${stableTag(`${input.contract.worldId}|${(ordinal + 1) % TOPIC_WORLD_STAGE_ORGANIZATION_COUNT}`)}`,
    ];
    const rivalOrganizationIds = [
      `${TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION}:organization:${stableTag(`${input.contract.worldId}|${(ordinal + 2) % TOPIC_WORLD_STAGE_ORGANIZATION_COUNT}`)}`,
    ];
    const situationBrief = [
      `${kindLabel}「${name}」控制${source.territory}，以「${source.doctrine}」維持內部秩序。`,
      `公開目標是${source.publicGoal}；內部則因${source.hiddenConflict}承受壓力。`,
      `影響力 ${source.influence}/100；盟友與對手都會主動推進自己的計畫。`,
    ].join("");
    return {
      organizationId,
      ordinal,
      kindLabel,
      name,
      territory: source.territory,
      doctrine: source.doctrine,
      influence: source.influence,
      publicGoal: source.publicGoal,
      hiddenConflict: source.hiddenConflict,
      allyOrganizationIds,
      rivalOrganizationIds,
      memberCapacity: source.memberCount,
      contractStatement: statement,
      situationBrief,
      controlledAssetIds: [],
      contestedAssetIds: [],
    };
  });
  return organizations.map((organization) => {
    const ally = organizations.find((candidate) => (
      organization.allyOrganizationIds.includes(candidate.organizationId)
    ));
    const rival = organizations.find((candidate) => (
      organization.rivalOrganizationIds.includes(candidate.organizationId)
    ));
    return {
      ...organization,
      situationBrief: [
        organization.situationBrief,
        `目前與${ally?.kindLabel ?? "另一勢力"}「${ally?.name ?? "未公開盟友"}」互利結盟，`,
        `並和${rival?.kindLabel ?? "另一勢力"}「${rival?.name ?? "未公開對手"}」競逐同一批人脈與資源。`,
      ].join(""),
    };
  });
}

function buildAssetControls(input: {
  contract: TopicWorldContract;
  matrixSeed: string;
  socialMatrix: DeterministicSocialMatrix;
  organizations: TopicWorldStageOrganization[];
  families: TopicWorldStageFamily[];
}) {
  const usedOrdinals = new Set<number>();
  return input.contract.assets.map((statement, ordinal): TopicWorldStageAssetControl => {
    let treasureOrdinal = hashText(`${input.matrixSeed}|asset|${ordinal}`)
      % PROCEDURAL_TREASURE_CAPACITY;
    while (usedOrdinals.has(treasureOrdinal)) {
      treasureOrdinal = (treasureOrdinal + 1) % PROCEDURAL_TREASURE_CAPACITY;
    }
    usedOrdinals.add(treasureOrdinal);
    const treasure = proceduralTreasureRecordAt({
      storySeed: input.matrixSeed,
      ordinal: treasureOrdinal,
      context: {
        genre: input.contract.topicName,
        playMode: input.contract.playMechanics.mode,
        storyTags: input.contract.sourceSignals.tags,
        location: input.organizations[ordinal % input.organizations.length]!.territory,
        conflict: input.contract.canonRules.at(-1),
      },
      socialMatrix: input.socialMatrix,
    });
    const category = normalizeAssetCategory(statement);
    const organization = input.organizations[ordinal % input.organizations.length]!;
    const family = input.families[ordinal % input.families.length]!;
    const holder = family.members[ordinal % family.members.length]!;
    const claimant = input.organizations[(ordinal + 1) % input.organizations.length]!;
    const assetControlId = `${TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION}:asset-control:${stableTag(`${input.contract.worldId}|${ordinal}|${treasureOrdinal}`)}`;
    const controlRelation = input.contract.worldFamily === "cultivation"
      ? XIANXIA_ASSET_CONTROL_RELATIONS[category] ?? "爭奪中"
      : (["掌握", "持有", "控制", "共同保管"] as const)[ordinal % 4]!;
    const name = assetDisplayName(statement, category, treasure.name);
    const semantics = input.contract.worldFamily === "cultivation"
      ? cultivationAssetSemantics({ category, name, matrixSeed: input.matrixSeed, ordinal })
      : {
          function: treasure.abilities[0].effect,
          limitation: treasure.limitation,
          cost: treasure.cost,
          visualDescription: treasure.visualDescription,
        };
    return {
      assetControlId,
      loreId: `${TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION}:lore:${stableTag(`${assetControlId}|lore`)}`,
      category,
      name,
      contractStatement: statement,
      catalogTreasureId: treasure.id,
      treasureOrdinal,
      controllerOrganizationId: organization.organizationId,
      controllerOrganizationName: organization.name,
      holderFamilyId: family.familyId,
      holderCharacterId: holder.characterId,
      holderName: holder.name,
      controlRelation,
      claimantOrganizationId: claimant.organizationId,
      claimantOrganizationName: claimant.name,
      function: semantics.function,
      limitation: semantics.limitation,
      cost: semantics.cost,
      visualDescription: semantics.visualDescription,
      storyHook: `${organization.kindLabel}「${organization.name}」${controlRelation}${category}「${name}」，由${family.name}的${holder.name}直接負責；${claimant.kindLabel}「${claimant.name}」另有聲索。${statement}`,
    };
  });
}

function playCompatibility(topicId: string, playMode: TopicWorldPlayMode) {
  const topic = TOPIC_BY_ID.get(topicId);
  if (!topic) throw new RangeError(`TOPIC_WORLD_STAGE_TOPIC_NOT_FOUND:${topicId}`);
  return topic.supportedPlayModes.includes(playMode) ? "native" as const : "cross-mode" as const;
}

function materializationContext(contract: TopicWorldContract): ProceduralStoryContext {
  return {
    genre: contract.topicName,
    playMode: contract.playMechanics.mode,
    storyTags: contract.sourceSignals.tags,
    location: contract.displaySummary.split("\n")[0],
    conflict: contract.canonRules.at(-1),
  };
}

/**
 * Materializes only four on-stage organizations, four selectable families and
 * their six-role casts. The same seed, topic and world address always resolve
 * to the same records, while the 100k/100k backing indexes remain virtual.
 */
export function buildTopicWorldFamilyStageMatrix(input: {
  seed: string;
  topicId: string;
  playMode: TopicWorldPlayMode;
  worldOrdinal?: number;
}): TopicWorldFamilyStageMatrix {
  const contract = topicWorldContractAt(input);
  const matrixSeed = `${TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION}|${contract.contractId}|${contract.seed}`;
  const socialMatrix = new DeterministicSocialMatrix({
    seed: matrixSeed,
    context: materializationContext(contract),
    populationSize: PROCEDURAL_CHARACTER_CAPACITY,
    cacheLimit: 0,
  });
  const organizations = buildOrganizations({ contract, socialMatrix, matrixSeed });
  const stageFamilies = organizations.map((organization) => stageFamily({
    contract,
    matrix: socialMatrix,
    matrixSeed,
    organization,
  }));
  const assetControls = buildAssetControls({
    contract,
    matrixSeed,
    socialMatrix,
    organizations,
    families: stageFamilies,
  });
  const finalizedOrganizations = organizations.map((organization) => ({
    ...organization,
    controlledAssetIds: assetControls
      .filter((asset) => asset.controllerOrganizationId === organization.organizationId)
      .map((asset) => asset.assetControlId),
    contestedAssetIds: assetControls
      .filter((asset) => asset.claimantOrganizationId === organization.organizationId)
      .map((asset) => asset.assetControlId),
  }));
  const finalizedFamilies = stageFamilies.map((family) => ({
    ...family,
    assetControlIds: assetControls
      .filter((asset) => asset.holderFamilyId === family.familyId)
      .map((asset) => asset.assetControlId),
  }));
  const matrixId = `${TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION}:${contract.worldId}:${contract.playMechanics.mode}:${stableTag(matrixSeed)}`;
  return {
    schemaVersion: TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION,
    matrixId,
    seed: contract.seed,
    topicId: contract.topicId,
    topicName: contract.topicName,
    worldId: contract.worldId,
    worldOrdinal: contract.worldOrdinal,
    contractId: contract.contractId,
    worldFamily: contract.worldFamily,
    worldSituation: [
      contract.displaySummary,
      "本輪不是只選一名角色，而是選擇一個完整家族上場；四個勢力、家族成員與資產控制關係會一起進入故事。",
      ...finalizedOrganizations.map((organization) => organization.situationBrief),
    ].join("\n"),
    playClassification: {
      mode: contract.playMechanics.mode,
      label: contract.playMechanics.label,
      compatibility: playCompatibility(contract.topicId, contract.playMechanics.mode),
      dimensions: [...contract.playMechanics.dimensions],
      rules: [...contract.playMechanics.rules],
    },
    capacity: {
      characters: PROCEDURAL_CHARACTER_CAPACITY,
      treasures: PROCEDURAL_TREASURE_CAPACITY,
      relationshipScenarios: PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
      materializationPolicy: TOPIC_WORLD_STAGE_MATERIALIZATION_POLICY,
      materializedStageCharacters: finalizedFamilies.reduce(
        (total, family) => total + family.members.length,
        0,
      ),
      materializedStageAssets: assetControls.length,
    },
    worldContract: clone(contract),
    organizations: finalizedOrganizations,
    stageFamilies: finalizedFamilies,
    assetControls,
    canonicalStatus: "VIRTUAL_CANDIDATE",
    canonicalMutation: 0,
  };
}

/**
 * Returns the three creation-page choices without hiding the fourth world
 * institution. Every option carries the complete organization and asset map,
 * so choosing one family never makes the unselected powers disappear.
 */
export function listTopicWorldFamilyStageCandidates(input: {
  matrix: TopicWorldFamilyStageMatrix;
  limit?: number;
}): TopicWorldFamilyStageCandidateOption[] {
  const limit = input.limit ?? 3;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3) {
    throw new RangeError(`TOPIC_WORLD_STAGE_CANDIDATE_LIMIT_INVALID:${limit}`);
  }
  const start = hashText(`${input.matrix.matrixId}|creation-options`)
    % input.matrix.stageFamilies.length;
  const organizations = clone(input.matrix.organizations);
  const assetControls = clone(input.matrix.assetControls);
  const organizationIntroduction = organizations
    .map((organization) => `${organization.kindLabel}「${organization.name}」：${organization.situationBrief}`)
    .join("\n");
  const assetIntroduction = assetControls
    .map((asset) => `${asset.category}「${asset.name}」：${asset.controllerOrganizationName}${asset.controlRelation}，持有人為${asset.holderName}；${asset.claimantOrganizationName ?? "無其他聲索者"}另有聲索。`)
    .join("\n");
  return Array.from({ length: limit }, (_, offset) => {
    const family = input.matrix.stageFamilies[
      (start + offset) % input.matrix.stageFamilies.length
    ]!;
    const completeWorldIntroduction = [
      input.matrix.worldContract.displaySummary,
      "本輪選擇的是上場家族；未被選中的勢力仍會在世界中獨立行動。",
      "【完整勢力狀況】",
      organizationIntroduction,
      "【資產掌握／持有／控制狀況】",
      assetIntroduction,
      "【本選項上場家族】",
      family.introduction,
    ].join("\n");
    return {
      optionId: `${TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION}:option:${stableTag(`${input.matrix.matrixId}|${family.familyId}`)}`,
      familyId: family.familyId,
      title: `${family.organizationKind}｜${family.name}`,
      summary: family.stagePremise,
      family: clone(family),
      worldOrganizations: clone(organizations),
      worldAssetControls: clone(assetControls),
      completeWorldIntroduction,
    };
  });
}

/** Compact address stored in draft.answers; the 100k indexes stay virtual. */
export function serializeTopicWorldFamilyDraftSelection(input: {
  matrix: TopicWorldFamilyStageMatrix;
  familyId: string;
  selectedProtagonistId?: string;
}) {
  const family = input.matrix.stageFamilies.find((entry) => entry.familyId === input.familyId);
  if (!family) {
    throw new Error(`TOPIC_WORLD_STAGE_FAMILY_NOT_FOUND:${input.familyId}`);
  }
  if (
    input.selectedProtagonistId
    && !family.members.some((member) => member.characterId === input.selectedProtagonistId)
  ) {
    throw new Error(`TOPIC_WORLD_STAGE_PROTAGONIST_NOT_FOUND:${input.selectedProtagonistId}`);
  }
  const selection: TopicWorldFamilyDraftSelection = {
    schemaVersion: TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION,
    address: {
      seed: input.matrix.seed,
      topicId: input.matrix.topicId,
      playMode: input.matrix.playClassification.mode,
      worldOrdinal: input.matrix.worldOrdinal,
    },
    matrixId: input.matrix.matrixId,
    contractId: input.matrix.contractId,
    selectedFamilyId: input.familyId,
    ...(input.selectedProtagonistId
      ? { selectedProtagonistId: input.selectedProtagonistId }
      : {}),
  };
  return JSON.stringify(selection);
}

/** Replays and verifies a compact draft selection before bundle creation. */
export function restoreTopicWorldFamilyDraftSelection(serialized: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("TOPIC_WORLD_FAMILY_DRAFT_SELECTION_INVALID_JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("TOPIC_WORLD_FAMILY_DRAFT_SELECTION_INVALID");
  }
  const candidate = parsed as Partial<TopicWorldFamilyDraftSelection>;
  const address = candidate.address;
  if (
    candidate.schemaVersion !== TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION
    || !address
    || typeof address.seed !== "string"
    || typeof address.topicId !== "string"
    || !["general", "rpg", "romance", "management"].includes(address.playMode)
    || !Number.isSafeInteger(address.worldOrdinal)
    || typeof candidate.matrixId !== "string"
    || typeof candidate.contractId !== "string"
    || typeof candidate.selectedFamilyId !== "string"
  ) {
    throw new Error("TOPIC_WORLD_FAMILY_DRAFT_SELECTION_INVALID");
  }
  const matrix = buildTopicWorldFamilyStageMatrix({
    seed: address.seed,
    topicId: address.topicId,
    playMode: address.playMode,
    worldOrdinal: address.worldOrdinal,
  });
  if (matrix.matrixId !== candidate.matrixId || matrix.contractId !== candidate.contractId) {
    throw new Error("TOPIC_WORLD_FAMILY_DRAFT_SELECTION_REPLAY_MISMATCH");
  }
  const family = matrix.stageFamilies.find(
    (stageFamilyValue) => stageFamilyValue.familyId === candidate.selectedFamilyId,
  );
  if (!family) {
    throw new Error(`TOPIC_WORLD_STAGE_FAMILY_NOT_FOUND:${candidate.selectedFamilyId}`);
  }
  if (
    candidate.selectedProtagonistId !== undefined
    && (
      typeof candidate.selectedProtagonistId !== "string"
      || !family.members.some((member) => member.characterId === candidate.selectedProtagonistId)
    )
  ) {
    throw new Error(`TOPIC_WORLD_STAGE_PROTAGONIST_NOT_FOUND:${String(candidate.selectedProtagonistId)}`);
  }
  return {
    selection: candidate as TopicWorldFamilyDraftSelection,
    matrix,
    family,
    canonCandidate: createTopicWorldFamilyCanonCandidate({
      matrix,
      familyId: family.familyId,
    }),
  };
}

function canonRecords(
  matrix: TopicWorldFamilyStageMatrix,
  selectedFamily: TopicWorldStageFamily,
): TopicWorldFamilyCanonRecords {
  return {
    world: {
      worldId: matrix.worldId,
      topicId: matrix.topicId,
      topicName: matrix.topicName,
      worldOrdinal: matrix.worldOrdinal,
      worldFamily: matrix.worldFamily,
      displaySummary: matrix.worldSituation,
      selectedFamilyId: selectedFamily.familyId,
    },
    worldRules: matrix.worldContract.canonRules.map((statement, ordinal) => ({
      ruleId: `${TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION}:world-rule:${stableTag(`${matrix.worldId}|${ordinal}|${statement}`)}`,
      statement,
    })),
    organizations: clone(matrix.organizations),
    selectedFamily: clone(selectedFamily),
    characters: clone(selectedFamily.members),
    relationships: clone(selectedFamily.relationships),
    lore: clone(matrix.assetControls),
    playMechanics: clone(matrix.playClassification),
  };
}

/** Creates a zero-mutation review bundle; no Canon record is written here. */
export function createTopicWorldFamilyCanonCandidate(input: {
  matrix: TopicWorldFamilyStageMatrix;
  familyId: string;
}): TopicWorldFamilyCanonCandidate {
  const selectedFamily = input.matrix.stageFamilies.find(
    (family) => family.familyId === input.familyId,
  );
  if (!selectedFamily) throw new Error(`TOPIC_WORLD_STAGE_FAMILY_NOT_FOUND:${input.familyId}`);
  const records = canonRecords(input.matrix, selectedFamily);
  const patch: TopicWorldFamilyCanonPatch = {
    worldId: input.matrix.worldId,
    worldRuleIds: records.worldRules.map((rule) => rule.ruleId),
    organizationIds: records.organizations.map((organization) => organization.organizationId),
    characterIds: records.characters.map((character) => character.characterId),
    relationshipIds: records.relationships.map((relationship) => relationship.relationshipId),
    loreIds: records.lore.map((asset) => asset.loreId),
  };
  const payloadFingerprint = stableTag(JSON.stringify({ patch, records }));
  return {
    schemaVersion: TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION,
    candidateId: `${TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION}:candidate:${payloadFingerprint}`,
    matrixId: input.matrix.matrixId,
    contractId: input.matrix.contractId,
    topicId: input.matrix.topicId,
    worldId: input.matrix.worldId,
    selectedFamilyId: selectedFamily.familyId,
    status: "PENDING_APPROVAL",
    canonicalMutation: 0,
    payloadFingerprint,
    canonPatch: patch,
    canonRecords: records,
  };
}

/** Returns the exact approved payload a repository can atomically persist. */
export function approveTopicWorldFamilyCanonCandidate(input: {
  candidate: TopicWorldFamilyCanonCandidate;
  projectId: string;
  approvedBy: string;
  approvedAt?: string;
}): ApprovedTopicWorldFamilyCanon {
  const projectId = input.projectId.trim();
  const approvedBy = input.approvedBy.trim();
  if (!projectId) throw new Error("TOPIC_WORLD_FAMILY_CANON_PROJECT_ID_REQUIRED");
  if (!approvedBy) throw new Error("TOPIC_WORLD_FAMILY_CANON_APPROVER_REQUIRED");
  const approvedAt = input.approvedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(approvedAt))) {
    throw new Error("TOPIC_WORLD_FAMILY_CANON_APPROVED_AT_INVALID");
  }
  return {
    ...clone(input.candidate),
    status: "APPROVED",
    canonicalMutation: 1,
    approvalId: `${TOPIC_WORLD_FAMILY_STAGE_MATRIX_VERSION}:approval:${stableTag(`${projectId}|${input.candidate.candidateId}|${approvedAt}|${approvedBy}`)}`,
    projectId,
    approvedAt,
    approvedBy,
  };
}

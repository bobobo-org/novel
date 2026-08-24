import rawStoryLibrary from "../../../data/story-library.json" with { type: "json" };
import type { StoryLibrary, StoryTopic } from "../../novel-data/story-library-types";
import {
  PROCEDURAL_WORLD_VARIANTS_PER_TOPIC,
  proceduralWorldAt,
} from "./procedural-world-library";
import {
  IDENTITY_MECHANISMS,
  createIdentityMechanismOverlay,
  sanitizeVisibleText,
  topicEraProfileAt,
  type IdentityContext,
  type IdentityMechanismOverlay,
  type StoryEra,
  type TopicContentBoundary,
} from "./topic-era-ontology";

const STORY_LIBRARY = rawStoryLibrary as StoryLibrary;
const CLASSIC_TOPICS = STORY_LIBRARY.topics.filter((topic) => topic.enabled && topic.classic);
const TOPIC_BY_ID = new Map(CLASSIC_TOPICS.map((topic) => [topic.topicId, topic] as const));

if (CLASSIC_TOPICS.length !== 218 || TOPIC_BY_ID.size !== 218) {
  throw new Error(`TOPIC_WORLD_CONTRACT_CATALOG_MISMATCH:${CLASSIC_TOPICS.length}/${TOPIC_BY_ID.size}`);
}

export const TOPIC_WORLD_CONTRACT_VERSION = "topic-world-contract-v3" as const;

export const CULTIVATION_REALM_ORDER = [
  "凡人",
  "煉氣",
  "築基",
  "金丹",
  "元嬰",
  "化神",
  "煉虛",
  "合體",
  "大乘",
  "渡劫",
] as const;

export type TopicWorldPlayMode = "general" | "rpg" | "romance" | "management";

export type TopicWorldPlayMechanics = {
  mode: TopicWorldPlayMode;
  label: string;
  dimensions: string[];
  rules: string[];
};

export type TopicWorldContract = {
  schemaVersion: typeof TOPIC_WORLD_CONTRACT_VERSION;
  contractId: string;
  seed: string;
  topicId: string;
  topicName: string;
  worldId: string;
  worldOrdinal: number;
  worldFamily: "cultivation" | "topic-derived";
  eraProfile: {
    primaryEra: StoryEra;
    supportedEras: StoryEra[];
    premise: string;
    settingTags: string[];
    addressTerms: string[];
    institutionTypes: string[];
    occupations: string[];
    resourceTypes: string[];
    contentBoundary: TopicContentBoundary;
    identityOverlay?: IdentityMechanismOverlay;
  };
  displaySummary: string;
  canonRules: string[];
  institutions: string[];
  assets: string[];
  playMechanics: TopicWorldPlayMechanics;
  sourceSignals: {
    tags: string[];
    subCategories: string[];
    recommendedWorlds: string[];
  };
};

const PLAY_MECHANICS: Record<TopicWorldPlayMode, TopicWorldPlayMechanics> = {
  general: {
    mode: "general",
    label: "一般章節寫作",
    dimensions: ["人物目標", "世界規則", "因果後果", "伏筆回收"],
    rules: [
      "以章節、人物選擇與前後因果推進，不額外啟用遊戲數值。",
      "既有 Canon、人物承諾與已發生後果不可因換場而重置。",
    ],
  },
  rpg: {
    mode: "rpg",
    label: "RPG 養成",
    dimensions: ["能力", "裝備", "任務", "體力／行動點"],
    rules: [
      "能力成長、裝備取得與任務進度必須由可追蹤事件造成。",
      "每次行動消耗體力或行動點；不足時仍提供可恢復、可轉進的路線。",
    ],
  },
  romance: {
    mode: "romance",
    label: "戀愛養成",
    dimensions: ["關係", "信任", "事件進度", "人物成長"],
    rules: [
      "關係與信任只因雙方可觀察的選擇改變，不以一次事件瞬間跳滿。",
      "事件進度必須保留人物自主、拒絕條件與各自成長目標。",
    ],
  },
  management: {
    mode: "management",
    label: "經營模擬",
    dimensions: ["資金", "人力", "品質", "聲望", "風險"],
    rules: [
      "資金、人力與品質的調度必須留下可核對的收益及代價。",
      "聲望與風險由履約、失敗及外部觀察累積，不會因單次成功突然翻盤。",
    ],
  },
};

const CULTIVATION_ASSETS = [
  "功法",
  "寶物",
  "丹藥",
  "符籙",
  "陣法",
  "武器／法器",
  "靈草",
  "秘境機緣",
] as const;

// Cultivation worlds deliberately use a closed vocabulary instead of exposing
// the generic procedural world's modern civic institutions, exchange systems,
// or industrial resources. Three base-10 axes form exactly 1,000 distinct,
// replayable cultivation settings for every cultivation topic.
const CULTIVATION_DOMAINS = [
  "九峰環抱、靈脈沿天河分流的雲州",
  "浮島懸於罡風之上、只能御器往返的青霄域",
  "地火貫穿赤原、丹谷與劍嶺彼此制衡的炎州",
  "妖霧封住古道、山門依星燈辨路的北荒",
  "潮汐靈泉遍布群島、海宗與龍族共治的滄海境",
  "萬年冰脈沉於雪原、劍修守衛裂隙的玄寒州",
  "古木承載洞天、靈獸族群與藥谷共生的森羅域",
  "黃沙掩埋仙朝遺址、綠洲坊市逐靈泉遷徙的西漠",
  "陰陽兩界於鬼門交疊、鎮魂宗鎮守渡口的幽川",
  "天梯殘缺、下界宗門爭取飛升名額的中天界",
] as const;

const CULTIVATION_SPIRITUAL_STATES = [
  "主靈脈逐年衰竭，修士必須修復地脈才能穩定破境",
  "靈潮每十二年回返一次，錯過潮期便要等待下一輪",
  "天雷頻繁降臨，雷劫既是災厄也是淬體機緣",
  "地火甦醒改變丹材藥性，舊丹方必須重新驗證",
  "魔氣從封印滲出，吸收越快越容易留下心魔",
  "星力只在夜間凝聚，觀星術決定修煉與遠行時機",
  "妖脈與人族靈脈交纏，締盟或爭奪都會改變地勢",
  "上古禁制正在鬆動，每解除一層都會喚醒守關之物",
  "功德與因果可被天道感知，違背誓約會阻礙下一次破境",
  "飛升通道斷裂，高階修士必須重建天梯或另尋渡劫之法",
] as const;

const CULTIVATION_PRESSURES = [
  "正魔兩道爭奪一座能改寫靈根的上古洞府",
  "宗門繼承出現雙重信物，掌門之位牽動各峰存亡",
  "修行家族隱瞞血脈衰退，婚盟與丹方同時面臨破局",
  "秘境提前開啟，各方必須在封印崩潰前取回鎮界之器",
  "護宗大陣缺失一角，內應與外敵都在尋找陣眼",
  "失傳功法重現，修煉速度與走火風險同時倍增",
  "靈草產地遭妖獸占據，丹師、劍修與御獸宗意見相左",
  "飛升榜被人竄改，被奪名額者開始追查天命真相",
  "古老誓約要求一宗代另一宗承劫，年輕弟子拒絕延續舊債",
  "仙朝徵召高階修士鎮守界門，宗門必須在傳承與天下之間取捨",
] as const;

const CULTIVATION_SECT_ROOTS = ["太玄", "青霄", "歸元", "天衡", "玄霜", "赤霄", "雲台", "星河", "萬象", "長生"] as const;
const CULTIVATION_SECT_SUFFIXES = ["劍宗", "丹宗", "符宗", "陣宗", "御獸宗", "器宗", "道宮", "仙門", "靈谷", "書院"] as const;
const CULTIVATION_FAMILY_SURNAMES = ["沈", "顧", "謝", "蘇", "裴", "葉", "江", "洛", "寧", "溫"] as const;
const CULTIVATION_FAMILY_LEGACIES = ["丹脈", "劍脈", "符脈", "陣脈", "御獸一脈", "煉器一脈", "靈植一脈", "占星一脈", "體修一脈", "神魂一脈"] as const;
const CULTIVATION_MARKET_ROOTS = ["雲津", "望月", "赤霞", "玄水", "青木", "天衡", "九霄", "歸墟", "星落", "長風"] as const;
const CULTIVATION_ALLIANCE_ROOTS = ["四方", "百川", "孤峰", "星火", "問道", "同塵", "遠山", "守夜", "歸真", "渡劫"] as const;
const CULTIVATION_TECHNIQUE_ROOTS = ["太初", "歸元", "星河", "玄霜", "赤陽", "青木", "滄海", "天雷", "無相", "長生"] as const;
const CULTIVATION_TREASURE_ROOTS = ["鎮界印", "照魂鏡", "問天尺", "乾坤圖", "渡厄燈", "藏星盤", "山河鼎", "定海珠", "太虛鐘", "萬象輪"] as const;
const CULTIVATION_HERB_ROOTS = ["七曜芝", "寒月蓮", "赤炎參", "養魂木", "紫霄藤", "龍血果", "星露草", "地脈筍", "玄水花", "菩提葉"] as const;

function hashText(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function unique(items: readonly string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function visible(value: string) {
  return sanitizeVisibleText(value);
}

function visibleItems(items: readonly string[]) {
  return unique(items.map(visible));
}

function indexedItem<T>(items: readonly T[], index: number) {
  return items[index % items.length]!;
}

function requireTopic(topicId: string) {
  const topic = TOPIC_BY_ID.get(topicId);
  if (!topic) throw new RangeError(`TOPIC_WORLD_CONTRACT_TOPIC_NOT_FOUND:${topicId}`);
  return topic;
}

function isCultivationTopic(topic: StoryTopic) {
  const signals = [topic.name, topic.description, ...topic.tags, ...topic.subCategories].join("|");
  return /仙俠|修仙|修真|煉氣|靈根|宗門雜役|王朝修煉|修真文明/u.test(signals);
}

function isIdentityMechanismTopic(topic: StoryTopic) {
  const signals = [topic.name, topic.description, ...topic.tags, ...topic.subCategories].join("|");
  return /附身|變身|身體交換|靈魂交換|身分交換|身份交換/u.test(signals);
}

const IDENTITY_CONTEXTS: IdentityContext[] = [
  "school",
  "corporate",
  "adult-industry",
  "historical-court",
  "cultivation",
  "inherit-topic",
];

const IDENTITY_CONTEXT_ERAS: Partial<Record<IdentityContext, StoryEra>> = {
  school: "contemporary",
  corporate: "contemporary",
  "adult-industry": "contemporary",
  "historical-court": "historical",
  cultivation: "timeless-fantasy",
};

function topicInstitutionSignals(topic: StoryTopic) {
  const subCategories = unique(topic.subCategories).slice(0, 4);
  const worlds = unique(topic.recommendedWorlds).slice(0, 2);
  return unique([...subCategories, ...worlds]);
}

function topicAssetSignals(topic: StoryTopic) {
  return unique([
    ...topic.tags.slice(0, 4),
    ...topic.subCategories.slice(4, 8),
    ...topic.recommendedWorlds.slice(0, 2),
  ]);
}

type EraProfile = TopicWorldContract["eraProfile"];

function activeLexicon(profile: EraProfile) {
  return profile.identityOverlay ?? profile;
}

function buildTopicDerivedInstitutions(topic: StoryTopic, profile: EraProfile, worldOrdinal: number) {
  const lexicon = activeLexicon(profile);
  const signals = topicInstitutionSignals(topic);
  const institutions = lexicon.institutionTypes;
  return Array.from({ length: Math.max(4, institutions.length) }, (_, index) => {
    const institution = indexedItem(institutions, index);
    const occupation = indexedItem(lexicon.occupations, worldOrdinal + index);
    const address = indexedItem(lexicon.addressTerms, worldOrdinal + index);
    const setting = indexedItem(lexicon.settingTags, worldOrdinal + index);
    const signal = signals[index % signals.length] ?? topic.name;
    return `${institution}：由${address}與${occupation}在${setting}分配權責，並以「${signal}」推進題材衝突。`;
  });
}

function buildTopicDerivedAssets(topic: StoryTopic, profile: EraProfile, worldOrdinal: number) {
  const lexicon = activeLexicon(profile);
  const signals = topicAssetSignals(topic);
  return Array.from({ length: Math.max(4, lexicon.resourceTypes.length) }, (_, index) => {
    const resource = indexedItem(lexicon.resourceTypes, worldOrdinal + index);
    const occupation = indexedItem(lexicon.occupations, worldOrdinal + index);
    const institution = indexedItem(lexicon.institutionTypes, worldOrdinal + index);
    const signal = signals[index % signals.length] ?? topic.name;
    return `${resource}：由${occupation}在${institution}中管理；取得、移轉與耗用都要留下後果，並服務「${signal}」。`;
  });
}

type CultivationWorldProfile = {
  domain: string;
  spiritualState: string;
  centralPressure: string;
  topicFocus: string;
  sectName: string;
  familyName: string;
  allianceName: string;
  marketName: string;
  techniqueRoot: string;
  treasureName: string;
  herbName: string;
};

function buildCultivationProfile(topic: StoryTopic, world: ReturnType<typeof proceduralWorldAt>): CultivationWorldProfile {
  const worldOrdinal = world.worldOrdinal;
  const pickByIdentity = <T>(items: readonly T[], salt: string) => indexedItem(
    items,
    hashText(`${TOPIC_WORLD_CONTRACT_VERSION}|${world.id}|${salt}`),
  );
  const sectName = `${pickByIdentity(CULTIVATION_SECT_ROOTS, "sect-root")}${pickByIdentity(CULTIVATION_SECT_SUFFIXES, "sect-suffix")}`;
  const familyName = `${pickByIdentity(CULTIVATION_FAMILY_SURNAMES, "family-surname")}氏${pickByIdentity(CULTIVATION_FAMILY_LEGACIES, "family-legacy")}`;
  return {
    // These three axes are a mixed-radix address: 10 × 10 × 10 = 1,000.
    domain: indexedItem(CULTIVATION_DOMAINS, worldOrdinal),
    spiritualState: indexedItem(CULTIVATION_SPIRITUAL_STATES, Math.floor(worldOrdinal / 10)),
    centralPressure: indexedItem(CULTIVATION_PRESSURES, Math.floor(worldOrdinal / 100)),
    topicFocus: indexedItem(topic.subCategories.length ? topic.subCategories : [topic.name], worldOrdinal),
    sectName,
    familyName,
    allianceName: `${pickByIdentity(CULTIVATION_ALLIANCE_ROOTS, "alliance")}散修盟`,
    marketName: `${pickByIdentity(CULTIVATION_MARKET_ROOTS, "market")}坊市`,
    techniqueRoot: pickByIdentity(CULTIVATION_TECHNIQUE_ROOTS, "technique"),
    treasureName: pickByIdentity(CULTIVATION_TREASURE_ROOTS, "treasure"),
    herbName: pickByIdentity(CULTIVATION_HERB_ROOTS, "herb"),
  };
}

function buildCultivationInstitutions(profile: CultivationWorldProfile) {
  return [
    `宗門：${profile.sectName}以師承、功法、山門職責與宗門戒律分配地位，當前首務是處理「${profile.centralPressure}」`,
    `修行家族：${profile.familyName}以血脈、婚盟、祖產與護族承諾形成跨代關係，並掌握一部分破境傳承`,
    `散修盟：${profile.allianceName}為無宗門修士登記任務、情報、交易與最低互助，不受任一山門直接號令`,
    `坊市與商會：${profile.marketName}以靈石結算丹藥、符籙、法器與靈草，禁售品必須留下持有人與流向`,
  ];
}

function buildCultivationAssets(profile: CultivationWorldProfile) {
  const entries: Record<(typeof CULTIVATION_ASSETS)[number], string> = {
    功法: `《${profile.techniqueRoot}真經》由${profile.sectName}分卷傳承；境界、靈根與師承未達條件者不能修習後卷`,
    寶物: `${profile.treasureName}現由${profile.familyName}保管；認主、轉交與啟用都會留下可追查的因果印記`,
    丹藥: `${profile.techniqueRoot}破境丹須以${profile.herbName}為主藥；只能輔助瓶頸，不能取代修為與心境`,
    符籙: `${profile.techniqueRoot}鎮脈符可用於攻防、傳訊、鎮封、示警或遁行，每張符只能承載一項主效`,
    陣法: `${profile.sectName}護山陣含聚靈、困敵與傳送三層陣眼；陣眼受損會直接改變山門防線`,
    "武器／法器": `${profile.techniqueRoot}飛劍可煉成本命法器；威力受境界、神識與持有人契合度限制`,
    靈草: `${profile.herbName}生於${profile.domain}；成熟週期、採集時辰與守護靈獸共同決定取得風險`,
    秘境機緣: `${profile.centralPressure}牽動一處未開秘境；傳承與天材地寶必須經過不可跳過的試煉取得`,
  };
  return CULTIVATION_ASSETS.map((category) => `${category}：${entries[category]}`);
}

function buildCultivationRules(
  topic: StoryTopic,
  profile: CultivationWorldProfile,
) {
  return [
    `修行境界順序固定為：${CULTIVATION_REALM_ORDER.join(" → ")}。`,
    "破境必須滿足修為、功法、資源與心境等可追蹤條件；不得無代價跨階或因換場重置境界。",
    "宗門、修行家族、散修盟與坊市各自保有目標、盟約、資源與衝突，不能只作主角背景板。",
    "功法、丹藥、符籙、陣法、武器／法器、靈草與秘境機緣都要記錄來源、持有人、使用條件與後果。",
    `本世界位於${profile.domain}；${profile.spiritualState}。地理、靈氣與修煉限制不可因換場消失。`,
    `主線壓力固定為「${profile.centralPressure}」，並以「${profile.topicFocus}」呈現${topic.name}的題材承諾。`,
    "境界、宗門立場、寶物持有人與既有因果必須延續，不得因換場、換章或重新載入而重置。",
  ];
}

function buildCultivationDisplaySummary(
  topic: StoryTopic,
  profile: CultivationWorldProfile,
  playMechanics: TopicWorldPlayMechanics,
) {
  return [
    `${topic.name}世界｜${profile.domain}`,
    `${profile.spiritualState}；${profile.centralPressure}。${profile.sectName}、${profile.familyName}與${profile.allianceName}各自保有立場。`,
    `本世界以「${profile.topicFocus}」展開，採用「${playMechanics.label}」；只疊加${playMechanics.dimensions.join("、")}，不改寫修仙 Canon。`,
  ].join("\n");
}

function buildTopicDerivedRules(topic: StoryTopic, profile: EraProfile) {
  const lexicon = activeLexicon(profile);
  const topicSignals = unique([
    ...topic.tags.slice(0, 3),
    ...topic.subCategories.slice(0, 3),
    ...topic.recommendedWorlds.slice(0, 2),
  ]);
  return [
    `題材承諾固定為「${topic.name}」：${topic.description}。`,
    profile.identityOverlay?.premise ?? profile.premise,
    `場景以${lexicon.settingTags.join("、")}為主；稱謂採${lexicon.addressTerms.join("、")}，不得混入無關時代或題材的制度語彙。`,
    `制度與資源由${lexicon.institutionTypes.join("、")}及${lexicon.resourceTypes.join("、")}構成，並保留「${topicSignals.join("、")}」的題材訊號。`,
    "人物、制度、資源、身分與既有後果必須延續，不得因換場、換章或重新載入而重置。",
    ...(profile.identityOverlay?.continuityRules ?? []),
    ...profile.contentBoundary.rules,
  ];
}

function buildEraProfile(topic: StoryTopic, worldOrdinal: number): EraProfile {
  const ontology = topicEraProfileAt(topic.topicId);
  const identityContext = isIdentityMechanismTopic(topic)
    ? indexedItem(IDENTITY_CONTEXTS, Math.floor(worldOrdinal / IDENTITY_MECHANISMS.length))
    : undefined;
  const identityOverlay = isIdentityMechanismTopic(topic)
    ? createIdentityMechanismOverlay({
        topicIdOrName: topic.topicId,
        mechanism: indexedItem(IDENTITY_MECHANISMS, worldOrdinal),
        context: identityContext!,
      })
    : undefined;
  const boundary = identityOverlay?.contentBoundary ?? ontology.contentBoundary;
  return {
    primaryEra: identityContext
      ? (IDENTITY_CONTEXT_ERAS[identityContext] ?? ontology.primaryEra)
      : ontology.primaryEra,
    supportedEras: [...ontology.supportedEras],
    premise: visible(identityOverlay?.premise ?? ontology.premise),
    settingTags: visibleItems(identityOverlay?.settingTags ?? ontology.settingTags),
    addressTerms: visibleItems(identityOverlay?.addressTerms ?? ontology.addressTerms),
    institutionTypes: visibleItems(identityOverlay?.institutionTypes ?? ontology.institutionTypes),
    occupations: visibleItems(identityOverlay?.occupations ?? ontology.occupations),
    resourceTypes: visibleItems(identityOverlay?.resourceTypes ?? ontology.resourceTypes),
    contentBoundary: {
      ...boundary,
      rules: visibleItems(boundary.rules),
    },
    ...(identityOverlay
      ? {
          identityOverlay: {
            ...identityOverlay,
            topicName: visible(identityOverlay.topicName),
            mechanismLabel: visible(identityOverlay.mechanismLabel),
            contextLabel: visible(identityOverlay.contextLabel),
            premise: visible(identityOverlay.premise),
            rolePairs: identityOverlay.rolePairs.map(
              ([left, right]): [string, string] => [visible(left), visible(right)],
            ),
            settingTags: visibleItems(identityOverlay.settingTags),
            addressTerms: visibleItems(identityOverlay.addressTerms),
            institutionTypes: visibleItems(identityOverlay.institutionTypes),
            occupations: visibleItems(identityOverlay.occupations),
            resourceTypes: visibleItems(identityOverlay.resourceTypes),
            continuityRules: visibleItems(identityOverlay.continuityRules),
            contentBoundary: {
              ...identityOverlay.contentBoundary,
              rules: visibleItems(identityOverlay.contentBoundary.rules),
            },
          },
        }
      : {}),
  };
}

function copyPlayMechanics(mode: TopicWorldPlayMode): TopicWorldPlayMechanics {
  const mechanics = PLAY_MECHANICS[mode];
  return {
    ...mechanics,
    dimensions: [...mechanics.dimensions],
    rules: [...mechanics.rules],
  };
}

/**
 * Builds a compact, deterministic creation-time contract for one of the 218
 * classic topics. The heavy 218,000-world space remains indexed on demand;
 * only this selected world's Canon contract needs to be stored with a project.
 */
export function topicWorldContractAt(input: {
  seed: string;
  topicId: string;
  playMode: TopicWorldPlayMode;
  worldOrdinal?: number;
}): TopicWorldContract {
  const seed = input.seed.trim();
  if (!seed) throw new Error("TOPIC_WORLD_CONTRACT_SEED_REQUIRED");
  const topic = requireTopic(input.topicId);
  const worldOrdinal = input.worldOrdinal
    ?? (hashText(`${TOPIC_WORLD_CONTRACT_VERSION}|${seed}|${topic.topicId}`) % PROCEDURAL_WORLD_VARIANTS_PER_TOPIC);
  if (!Number.isSafeInteger(worldOrdinal) || worldOrdinal < 0 || worldOrdinal >= PROCEDURAL_WORLD_VARIANTS_PER_TOPIC) {
    throw new RangeError(`TOPIC_WORLD_CONTRACT_WORLD_ORDINAL_OUT_OF_RANGE:${worldOrdinal}`);
  }
  const world = proceduralWorldAt({ seed, topicId: topic.topicId, worldOrdinal });
  const eraProfile = buildEraProfile(topic, worldOrdinal);
  const cultivation = isCultivationTopic(topic);
  const cultivationProfile = cultivation ? buildCultivationProfile(topic, world) : null;
  const institutions = cultivation
    ? buildCultivationInstitutions(cultivationProfile!)
    : buildTopicDerivedInstitutions(topic, eraProfile, worldOrdinal);
  const assets = cultivation
    ? buildCultivationAssets(cultivationProfile!)
    : buildTopicDerivedAssets(topic, eraProfile, worldOrdinal);
  const canonRules = cultivation
    ? buildCultivationRules(topic, cultivationProfile!)
    : buildTopicDerivedRules(topic, eraProfile);
  const playMechanics = copyPlayMechanics(input.playMode);
  const displaySummary = cultivation
    ? buildCultivationDisplaySummary(topic, cultivationProfile!, playMechanics)
    : [
        `${topic.name}世界｜${eraProfile.identityOverlay?.contextLabel ?? eraProfile.settingTags[worldOrdinal % eraProfile.settingTags.length]}`,
        eraProfile.premise,
        `本作採用「${playMechanics.label}」；只疊加${playMechanics.dimensions.join("、")}，不改寫題材世界的 Canon。`,
      ].join("\n");

  return {
    schemaVersion: TOPIC_WORLD_CONTRACT_VERSION,
    contractId: `${TOPIC_WORLD_CONTRACT_VERSION}:${world.id}:${input.playMode}`,
    seed,
    topicId: topic.topicId,
    topicName: visible(topic.name),
    worldId: world.id,
    worldOrdinal,
    worldFamily: cultivation ? "cultivation" : "topic-derived",
    eraProfile,
    displaySummary: visible(displaySummary),
    canonRules: visibleItems(canonRules),
    institutions: visibleItems(institutions),
    assets: visibleItems(assets),
    playMechanics: {
      ...playMechanics,
      label: visible(playMechanics.label),
      dimensions: visibleItems(playMechanics.dimensions),
      rules: visibleItems(playMechanics.rules),
    },
    sourceSignals: {
      tags: visibleItems(topic.tags),
      subCategories: visibleItems(topic.subCategories),
      recommendedWorlds: visibleItems(topic.recommendedWorlds),
    },
  };
}

export function listTopicWorldContractTopics() {
  return CLASSIC_TOPICS.map((topic) => ({
    topicId: topic.topicId,
    name: topic.name,
    tags: [...topic.tags],
    subCategories: [...topic.subCategories],
    recommendedWorlds: [...topic.recommendedWorlds],
  }));
}

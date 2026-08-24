import rawStoryLibrary from "../../../data/story-library.json" with { type: "json" };
import type { StoryLibrary, StoryTopic } from "../../novel-data/story-library-types";

const STORY_LIBRARY = rawStoryLibrary as StoryLibrary;
const CLASSIC_TOPICS = STORY_LIBRARY.topics.filter((topic) => topic.enabled && topic.classic);
const CLASSIC_TOPIC_BY_ID = new Map(
  CLASSIC_TOPICS.map((topic) => [topic.topicId, topic] as const),
);

if (CLASSIC_TOPICS.length !== 218 || CLASSIC_TOPIC_BY_ID.size !== 218) {
  throw new Error(
    `TOPIC_ERA_ONTOLOGY_CATALOG_MISMATCH:${CLASSIC_TOPICS.length}/${CLASSIC_TOPIC_BY_ID.size}`,
  );
}

export const TOPIC_ERA_ONTOLOGY_VERSION = "topic-era-ontology-v1" as const;

export const STORY_ERAS = [
  "contemporary",
  "historical",
  "future",
  "cross-era",
  "timeless-fantasy",
] as const;

export type StoryEra = (typeof STORY_ERAS)[number];

export const IDENTITY_MECHANISMS = [
  "mutual-body-swap",
  "one-way-possession",
  "transmigration-into-body",
  "role-identity-swap",
  "co-consciousness",
] as const;

export type IdentityMechanism = (typeof IDENTITY_MECHANISMS)[number];

export type TopicContentBoundary = {
  audience: "general" | "teen" | "adult";
  originalCharactersOnly: true;
  consentRequired: true;
  nonExplicit: true;
  rules: string[];
};

export type TopicEraProfile = {
  schemaVersion: typeof TOPIC_ERA_ONTOLOGY_VERSION;
  topicId: string;
  topicName: string;
  premise: string;
  primaryEra: StoryEra;
  supportedEras: StoryEra[];
  settingTags: string[];
  addressTerms: string[];
  institutionTypes: string[];
  occupations: string[];
  resourceTypes: string[];
  identityMechanisms: IdentityMechanism[];
  contentBoundary: TopicContentBoundary;
};

export type IdentityContext =
  | "inherit-topic"
  | "school"
  | "corporate"
  | "adult-industry"
  | "historical-court"
  | "cultivation";

export type IdentityMechanismOverlay = {
  schemaVersion: typeof TOPIC_ERA_ONTOLOGY_VERSION;
  topicName: string;
  mechanism: IdentityMechanism;
  mechanismLabel: string;
  contextLabel: string;
  premise: string;
  rolePairs: [string, string][];
  settingTags: string[];
  addressTerms: string[];
  institutionTypes: string[];
  occupations: string[];
  resourceTypes: string[];
  continuityRules: string[];
  contentBoundary: TopicContentBoundary;
};

type LexiconProfileKey =
  | "general"
  | "urban-fantasy"
  | "management"
  | "school"
  | "corporate"
  | "adult-industry"
  | "entertainment"
  | "historical-court"
  | "cultivation"
  | "medical"
  | "legal"
  | "military-crime"
  | "science-fiction"
  | "survival-mystery"
  | "sports"
  | "community"
  | "publishing-platform"
  | "fantasy-adventure";

type LexiconProfile = {
  label: string;
  era: StoryEra;
  settingTags: string[];
  addressTerms: string[];
  institutionTypes: string[];
  occupations: string[];
  resourceTypes: string[];
};

const LEXICON_PROFILES: Record<LexiconProfileKey, LexiconProfile> = {
  general: {
    label: "通用社會",
    era: "contemporary",
    settingTags: ["地方社群", "家庭網絡", "專業團隊", "公共空間"],
    addressTerms: ["前輩", "夥伴", "負責人", "新人", "協調者"],
    institutionTypes: ["地方組織", "專業團隊", "家庭網絡", "公共機構"],
    occupations: ["調查者", "技術人員", "協調者", "經營者", "自由工作者"],
    resourceTypes: ["資金", "證據", "人脈", "時間", "公共信任"],
  },
  "urban-fantasy": {
    label: "現代都市奇幻",
    era: "contemporary",
    settingTags: ["現代都市", "異常事件", "怪談社區", "隱祕組織", "都市靈脈"],
    addressTerms: ["調查員", "術士", "目擊者", "社區代表", "異常處理人"],
    institutionTypes: ["都市異常事件應變組", "民間術士協會", "地方社群", "研究機構", "祕密結社"],
    occupations: ["異常調查員", "現代術士", "研究員", "社區工作者", "媒體記者"],
    resourceTypes: ["都市情報", "靈性媒介", "異常事件紀錄", "人脈", "安全據點"],
  },
  management: {
    label: "經營養成",
    era: "contemporary",
    settingTags: ["營運據點", "人才培育", "供應網絡", "成長里程碑", "市場變化"],
    addressTerms: ["經營者", "夥伴", "專案負責人", "顧問", "客戶代表"],
    institutionTypes: ["營運團隊", "合作組織", "供應網絡", "人才培育單位", "地方市場"],
    occupations: ["經營者", "營運主管", "培育顧問", "採購人員", "品牌企劃"],
    resourceTypes: ["資金", "人力", "品質", "聲望", "供應", "成長進度"],
  },
  school: {
    label: "校園社群",
    era: "contemporary",
    settingTags: ["校園", "教室", "社團", "宿舍", "校外活動"],
    addressTerms: ["學生", "導師", "社長", "學長姐", "校務主管"],
    institutionTypes: ["學校", "學生會", "社團", "校隊", "家長會"],
    occupations: ["學生", "教師", "輔導人員", "教練", "校務職員"],
    resourceTypes: ["學習時間", "社團名額", "獎學金", "校園聲望", "同儕信任"],
  },
  corporate: {
    label: "企業職場",
    era: "contemporary",
    settingTags: ["辦公室", "董事會", "產業市場", "商務會談", "企業家族"],
    addressTerms: ["執行長", "董事", "主管", "秘書", "專案負責人"],
    institutionTypes: ["企業", "董事會", "部門", "供應商聯盟", "產業協會"],
    occupations: ["執行長", "經理", "秘書", "顧問", "創業者"],
    resourceTypes: ["資金", "股權", "合約", "人力", "商譽", "市場情報"],
  },
  "adult-industry": {
    label: "成人影視產業",
    era: "contemporary",
    settingTags: ["成年演藝工作", "攝影棚", "經紀公司", "製作會議", "勞務契約"],
    addressTerms: ["成年演員", "經紀人", "導演", "製作人", "親密協調員"],
    institutionTypes: ["成人影視製作公司", "經紀公司", "工作者工會", "發行平台", "法律顧問團隊"],
    occupations: ["成年表演工作者", "經紀人", "導演", "製作人", "親密協調員"],
    resourceTypes: ["工作合約", "肖像授權", "拍攝時程", "隱私保護", "撤回同意紀錄"],
  },
  entertainment: {
    label: "演藝創作",
    era: "contemporary",
    settingTags: ["劇組", "錄音室", "直播現場", "經紀公司", "頒獎活動"],
    addressTerms: ["演員", "導演", "製作人", "經紀人", "編劇"],
    institutionTypes: ["製作公司", "經紀公司", "劇組", "媒體平台", "粉絲社群"],
    occupations: ["演員", "導演", "編劇", "歌手", "主持人", "剪輯師"],
    resourceTypes: ["檔期", "著作權", "宣傳資源", "觀眾口碑", "製作預算"],
  },
  "historical-court": {
    label: "歷史宮廷",
    era: "historical",
    settingTags: ["宮廷", "官署", "世家宅邸", "市井", "邊疆"],
    addressTerms: ["君主", "皇后", "太后", "王侯", "朝臣", "掌事"],
    institutionTypes: ["朝廷", "官署", "世家", "商會", "軍鎮"],
    occupations: ["官員", "女官", "將領", "幕僚", "商人", "工匠"],
    resourceTypes: ["官職", "封地", "糧秣", "家族聲望", "密奏", "盟約"],
  },
  cultivation: {
    label: "修行世界",
    era: "timeless-fantasy",
    settingTags: ["宗門", "修行家族", "散修盟", "坊市", "秘境"],
    addressTerms: ["宗主", "長老", "師父", "師兄姐", "弟子", "散修"],
    institutionTypes: ["正道宗門", "魔道宗派", "修行家族", "散修盟", "坊市商會"],
    occupations: ["煉丹師", "符師", "陣法師", "煉器師", "靈植師", "護法"],
    resourceTypes: ["功法", "丹藥", "符籙", "陣法", "法器", "靈草", "秘境機緣"],
  },
  medical: {
    label: "醫療體系",
    era: "contemporary",
    settingTags: ["醫院", "急診室", "診間", "研究中心", "社區照護"],
    addressTerms: ["醫師", "護理師", "主任", "病人", "家屬"],
    institutionTypes: ["醫院", "診所", "研究中心", "衛生機關", "救護單位"],
    occupations: ["醫師", "護理師", "藥師", "檢驗師", "救護員"],
    resourceTypes: ["病歷", "藥品", "手術時程", "研究證據", "醫療同意"],
  },
  legal: {
    label: "法律司法",
    era: "contemporary",
    settingTags: ["法院", "律師事務所", "調查現場", "調解室", "公共聽證"],
    addressTerms: ["法官", "律師", "檢察官", "當事人", "調查員"],
    institutionTypes: ["法院", "律師事務所", "檢察機關", "調查單位", "法律扶助組織"],
    occupations: ["法官", "律師", "檢察官", "調查員", "法務人員"],
    resourceTypes: ["證據", "卷宗", "證詞", "程序期限", "和解條件"],
  },
  "military-crime": {
    label: "軍警與犯罪調查",
    era: "contemporary",
    settingTags: ["行動基地", "犯罪現場", "情報站", "邊境", "安全會議"],
    addressTerms: ["指揮官", "隊長", "探員", "情報員", "線人"],
    institutionTypes: ["軍事單位", "警察機關", "情報組織", "犯罪集團", "民間救援隊"],
    occupations: ["軍官", "刑警", "鑑識人員", "情報員", "談判專家"],
    resourceTypes: ["情報", "行動權限", "裝備", "證物", "安全路線"],
  },
  "science-fiction": {
    label: "未來科技",
    era: "future",
    settingTags: ["太空站", "星艦", "未來都市", "研究設施", "虛擬空間"],
    addressTerms: ["艦長", "研究員", "工程師", "導航員", "系統管理者"],
    institutionTypes: ["星際聯盟", "科技企業", "研究院", "殖民地議會", "探索隊"],
    occupations: ["太空人", "工程師", "研究員", "機甲駕駛", "資料分析師"],
    resourceTypes: ["能源", "算力", "航行座標", "維修零件", "通訊權限"],
  },
  "survival-mystery": {
    label: "生存懸疑",
    era: "contemporary",
    settingTags: ["封閉場域", "災變區", "調查現場", "臨時避難所", "未知邊界"],
    addressTerms: ["領隊", "倖存者", "調查者", "目擊者", "守夜人"],
    institutionTypes: ["調查小組", "救援隊", "避難社群", "研究機構", "地方組織"],
    occupations: ["調查者", "救援員", "醫護人員", "技師", "紀錄者"],
    resourceTypes: ["安全時間", "補給", "線索", "避難空間", "通訊設備"],
  },
  sports: {
    label: "競技體育",
    era: "contemporary",
    settingTags: ["訓練場", "聯賽", "校隊", "職業戰隊", "媒體採訪區"],
    addressTerms: ["選手", "教練", "隊長", "經理", "裁判"],
    institutionTypes: ["球隊", "俱樂部", "校隊", "聯賽組織", "運動協會"],
    occupations: ["選手", "教練", "體能師", "隊醫", "戰術分析師"],
    resourceTypes: ["體能", "訓練時間", "戰術資料", "合約", "隊伍默契"],
  },
  community: {
    label: "地方生活",
    era: "contemporary",
    settingTags: ["小鎮", "鄉村", "社區店鋪", "農場", "地方節慶"],
    addressTerms: ["店主", "鄰居", "里長", "返鄉者", "老師傅"],
    institutionTypes: ["地方商會", "社區組織", "家族店鋪", "合作社", "志工隊"],
    occupations: ["店主", "農務工作者", "旅宿經營者", "廚師", "社區工作者"],
    resourceTypes: ["土地", "店面", "手藝", "地方人脈", "季節收成"],
  },
  "publishing-platform": {
    label: "出版與內容平台",
    era: "contemporary",
    settingTags: ["編輯部", "連載平台", "書店", "製作室", "讀者社群"],
    addressTerms: ["作者", "編輯", "製作人", "讀者", "平台營運者"],
    institutionTypes: ["出版社", "內容平台", "書店", "創作團隊", "讀者社群"],
    occupations: ["作者", "編輯", "譯者", "插畫家", "平台營運者"],
    resourceTypes: ["稿件", "著作權", "連載檔期", "讀者回饋", "發行資源"],
  },
  "fantasy-adventure": {
    label: "奇幻冒險",
    era: "timeless-fantasy",
    settingTags: ["異世界城邦", "冒險者據點", "古代遺跡", "迷宮", "魔法學院"],
    addressTerms: ["領主", "公會長", "冒險者", "學者", "守護者"],
    institutionTypes: ["冒險者公會", "王國議會", "魔法學院", "商隊", "守護組織"],
    occupations: ["冒險者", "魔法研究者", "工匠", "斥候", "治療者"],
    resourceTypes: ["魔法媒介", "遺跡線索", "裝備", "補給", "通行資格"],
  },
};

type LexiconClassifier = {
  key: LexiconProfileKey;
  pattern: RegExp;
  priority: number;
};

/**
 * Catalog titles are the authoritative genre signal. These overrides document
 * deliberately mixed titles whose descriptions and subcategories contain
 * vocabulary from several unrelated domains.
 */
const TOPIC_NAME_LEXICON_OVERRIDES: Readonly<Record<string, LexiconProfileKey>> = {
  都市奇幻: "urban-fantasy",
  經營養成: "management",
  科幻未來: "science-fiction",
  軍事戰爭: "military-crime",
  星球冒險與太空歌劇: "science-fiction",
};

/**
 * Priority is explicit and independent from array position. Only the catalog
 * title is matched here; description, tags and subcategories cannot steal the
 * primary lexicon merely because they happen to contain an earlier keyword.
 */
const TOPIC_NAME_LEXICON_CLASSIFIERS: LexiconClassifier[] = [
  { key: "adult-industry", pattern: /成人產業|成人影視|成人片|情色產業|AV\b/iu, priority: 160 },
  { key: "publishing-platform", pattern: /作者|書庫|讀者|平台|連載|寫作|榜單|書城|同人|分類|劇本|分鏡|出版|WebSerial|Webtoon|有聲書|聲音小說|廣播劇/iu, priority: 150 },
  { key: "science-fiction", pattern: /科幻|星際|太空|賽博|機甲|未來|星艦|行星|虛擬|人工智慧|AI\b|太陽龐克|CliFi|Xenofiction/iu, priority: 140 },
  { key: "military-crime", pattern: /軍事|戰爭|間諜|諜報|情報|刑偵|犯罪|警局|劫案|海盜|賞金|特勤/iu, priority: 130 },
  { key: "cultivation", pattern: /修仙|仙俠|修真|宗門|煉氣|築基|金丹|元嬰|靈脈|御獸|道門|東方玄幻|玄幻升級|高武|武俠仙俠玄幻/iu, priority: 120 },
  { key: "historical-court", pattern: /宮廷|宮鬥|王朝|皇室|王妃|侯府|嫡女|古代|架空歷史|歷史|仕途|衙門|朝堂|年代|宅鬥/iu, priority: 110 },
  { key: "medical", pattern: /醫療|醫師|醫院|急診|法醫|護理|病案|診所/iu, priority: 100 },
  { key: "legal", pattern: /律師|法律|司法|案件辯護|法庭|陪審團/iu, priority: 100 },
  { key: "sports", pattern: /體育|運動|足球|籃球|冰球|電競|戰隊|競技|SportsRomance/iu, priority: 90 },
  { key: "entertainment", pattern: /娛樂圈|偶像|演員|劇組|綜藝|直播|短劇|影視|漫畫/iu, priority: 80 },
  { key: "school", pattern: /校園|學院|學校|學生|社團|青春|畢業|導師|課堂|YA\b|青少年/iu, priority: 70 },
  { key: "survival-mystery", pattern: /末世|末日|求生|災難|怪談|詭|恐怖|懸疑|推理|克系|失蹤|命案|生存|驚悚|Mystery/iu, priority: 60 },
  { key: "community", pattern: /鄉村|種田|小鎮|農場|村落|旅館|咖啡館|書店|社區|地方生活|美食|海島/iu, priority: 50 },
  { key: "management", pattern: /經營|養成|模擬人生|帶貨|收益|簽約/iu, priority: 45 },
  { key: "corporate", pattern: /霸道總裁|霸總|豪門|公司|職場|商戰|董事會|創業|財閥|商業|品牌|辦公室/iu, priority: 40 },
  { key: "urban-fantasy", pattern: /都市奇幻|都市怪談|都市異能|都市腦洞|神秘復甦|玄學民俗/iu, priority: 35 },
  { key: "fantasy-adventure", pattern: /奇幻|魔法|巫師|龍族|神話|異世界|異世|迷宮|Dungeon|LitRPG|RPG|穿梭|快穿|武俠|冒險|神怪|魔幻|童話/iu, priority: 30 },
];

const STRUCTURED_EVIDENCE_CLASSIFIERS: LexiconClassifier[] = [
  ...TOPIC_NAME_LEXICON_CLASSIFIERS,
];

const ERA_LABELS: Record<StoryEra, string> = {
  contemporary: "現代",
  historical: "歷史",
  future: "未來",
  "cross-era": "跨時代",
  "timeless-fantasy": "架空幻想",
};

const MECHANISM_LABELS: Record<IdentityMechanism, string> = {
  "mutual-body-swap": "雙向身體交換",
  "one-way-possession": "單向附身",
  "transmigration-into-body": "異世入身",
  "role-identity-swap": "身分與權責互換",
  "co-consciousness": "雙意識共存",
};

const MECHANISM_PREMISES: Record<IdentityMechanism, string> = {
  "mutual-body-swap": "兩名角色互換身體後，必須分別承擔對方既有的社會關係與未完成責任，並尋找可撤回交換的方法。",
  "one-way-possession": "一名角色暫時進入另一人的身體，但原主的權利、記憶與意志仍需被獨立追蹤。",
  "transmigration-into-body": "角色進入不同時代或世界的既有身分，能力、制度與人際關係不會因換身自動理解。",
  "role-identity-swap": "角色的法律或社會身分被互換，外表未必改變，但權責、名聲與利益衝突立即重排。",
  "co-consciousness": "兩個意識共享同一身體與有限感官，任何重大行動都必須處理控制權、記憶邊界與共同責任。",
};

const CONTEXT_TO_LEXICON: Record<Exclude<IdentityContext, "inherit-topic">, LexiconProfileKey> = {
  school: "school",
  corporate: "corporate",
  "adult-industry": "adult-industry",
  "historical-court": "historical-court",
  cultivation: "cultivation",
};

function uniqueVisible(values: Array<string | null | undefined>, fallback: string[]): string[] {
  const result = values
    .map((value) => sanitizeVisibleText(value ?? ""))
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);
  return result.length > 0 ? result : [...fallback];
}

/**
 * Internal catalog IDs are useful as lookup keys, but must never leak into UI copy.
 */
export function sanitizeVisibleText(value: string): string {
  return value
    .replace(/\b(?:classic-topic|world|treasure)-[a-z0-9-]+\b/giu, "")
    .replace(/([・｜|]\s*)(?=[A-Z0-9]{3,8}(?:\s*[・｜|]))(?=[A-Z0-9]*\d)[A-Z0-9]{3,8}(\s*[・｜|])/gu, "$1$2")
    .replace(/\s{2,}/g, " ")
    .replace(/([・｜|])\s*\1+/g, "$1")
    .trim();
}

function topicSignal(topic: StoryTopic): string {
  return [
    topic.name,
    topic.description,
    ...topic.tags,
    ...topic.subCategories,
    ...topic.recommendedWorlds,
    ...topic.recommendedConflicts,
    ...topic.recommendedStyles,
  ].join("｜");
}

function compareLexiconClassifiers(left: LexiconClassifier, right: LexiconClassifier): number {
  return right.priority - left.priority || left.key.localeCompare(right.key, "en");
}

function structuredEvidenceScore(topic: StoryTopic, classifier: LexiconClassifier): number {
  const scoreMatches = (values: string[], weight: number) =>
    values.reduce(
      (score, value) => score + (classifier.pattern.test(sanitizeVisibleText(value)) ? weight : 0),
      0,
    );

  return (
    scoreMatches(topic.tags, 4) +
    scoreMatches(topic.subCategories, 3) +
    scoreMatches([topic.description], 2) +
    scoreMatches(
      [...topic.recommendedWorlds, ...topic.recommendedConflicts, ...topic.recommendedStyles],
      1,
    )
  );
}

function lexiconKeyFor(topic: StoryTopic): LexiconProfileKey {
  const topicName = sanitizeVisibleText(topic.name);
  const catalogOverride = TOPIC_NAME_LEXICON_OVERRIDES[topicName];
  if (catalogOverride) {
    return catalogOverride;
  }

  const titleMatch = TOPIC_NAME_LEXICON_CLASSIFIERS
    .filter((classifier) => classifier.pattern.test(topicName))
    .sort(compareLexiconClassifiers)[0];
  if (titleMatch) {
    return titleMatch.key;
  }

  // Some broad catalog titles intentionally carry little genre vocabulary.
  // For those only, score each structured field independently. This prevents
  // a single incidental word in a long concatenated payload from winning by
  // classifier order.
  const evidenceMatch = STRUCTURED_EVIDENCE_CLASSIFIERS
    .map((classifier) => ({
      classifier,
      score: structuredEvidenceScore(topic, classifier),
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || compareLexiconClassifiers(left.classifier, right.classifier),
    )[0];

  return evidenceMatch?.classifier.key ?? "general";
}

function supportedErasFor(topic: StoryTopic, lexiconKey: LexiconProfileKey): StoryEra[] {
  const signal = topicSignal(topic);
  const eras: StoryEra[] = [LEXICON_PROFILES[lexiconKey].era];

  if (/穿越|重生|快穿|諸天|跨時|時間|年代重生|古今|附身|變身|靈魂交換/iu.test(signal)) {
    eras.push("cross-era");
  }
  if (/古代|歷史|宮廷|王朝|武俠|民國|年代|朝堂/iu.test(signal)) {
    eras.push("historical");
  }
  if (/科幻|星際|太空|未來|賽博|機甲|末世|人工智慧/iu.test(signal)) {
    eras.push("future");
  }
  if (/修仙|仙俠|修真|玄幻|奇幻|魔法|異世界|神話|靈魂交換/iu.test(signal)) {
    eras.push("timeless-fantasy");
  }
  if (/現代|都市|校園|職場|醫療|娛樂圈|社區|直播|社群/iu.test(signal)) {
    eras.push("contemporary");
  }

  // Identity transformation is a mechanism, not a fixed period. Its base topic can
  // therefore be layered over every era without silently rewriting the host genre.
  if (/附身變身|男生附身女生|女生附身男生|靈魂交換/iu.test(signal)) {
    return [...STORY_ERAS];
  }

  return [...new Set(eras)];
}

function boundaryFor(topic: StoryTopic, lexiconKey: LexiconProfileKey): TopicContentBoundary {
  const isAdultContext = lexiconKey === "adult-industry" || topic.adultOnly;
  const isYouthContext = lexiconKey === "school" || /青少年|青春|校園|學生/iu.test(topicSignal(topic));
  return {
    audience: isAdultContext ? "adult" : isYouthContext ? "teen" : "general",
    originalCharactersOnly: true,
    consentRequired: true,
    nonExplicit: true,
    rules: isAdultContext
      ? [
          "僅使用已確認成年的原創角色，不採用真實人物或可辨識公眾人物。",
          "親密、表演、醫療與勞務行為必須保留可撤回同意，拒絕不會被視為失敗懲罰。",
          "內容維持非露骨，工作契約、隱私與身體自主分開記錄。",
        ]
      : [
          "只使用原創角色，不套用真實人物姓名、外貌或生平。",
          "附身、交換與共用身體不會取代任何角色對親密、醫療或契約行為的同意。",
          "內容維持非露骨，角色仍可拒絕、退出或尋求協助。",
        ],
  };
}

function profileFor(topic: StoryTopic): TopicEraProfile {
  const lexiconKey = lexiconKeyFor(topic);
  const lexicon = LEXICON_PROFILES[lexiconKey];
  const supportedEras = supportedErasFor(topic, lexiconKey);
  const settingTags = uniqueVisible(
    [...topic.subCategories.slice(0, 4), ...lexicon.settingTags],
    lexicon.settingTags,
  ).slice(0, 8);
  const description = sanitizeVisibleText(topic.description);

  return {
    schemaVersion: TOPIC_ERA_ONTOLOGY_VERSION,
    topicId: topic.topicId,
    topicName: sanitizeVisibleText(topic.name),
    premise: `${sanitizeVisibleText(topic.name)}以「${description}」為題材前提；故事可在${supportedEras
      .map((era) => ERA_LABELS[era])
      .join("、")}背景中，透過${lexicon.institutionTypes.slice(0, 3).join("、")}之間的責任、利益與關係推進。`,
    primaryEra: lexicon.era,
    supportedEras,
    settingTags,
    addressTerms: uniqueVisible(lexicon.addressTerms, ["角色", "夥伴"]),
    institutionTypes: uniqueVisible(lexicon.institutionTypes, ["地方組織"]),
    occupations: uniqueVisible(lexicon.occupations, ["行動者"]),
    resourceTypes: uniqueVisible(lexicon.resourceTypes, ["時間", "人脈"]),
    identityMechanisms: [...IDENTITY_MECHANISMS],
    contentBoundary: boundaryFor(topic, lexiconKey),
  };
}

const PROFILES = CLASSIC_TOPICS.map(profileFor);
const PROFILE_BY_ID = new Map(PROFILES.map((profile) => [profile.topicId, profile] as const));
const PROFILE_BY_NAME = new Map(PROFILES.map((profile) => [profile.topicName, profile] as const));

export const TOPIC_ERA_CAPACITY = Object.freeze({
  classicTopicCount: 218,
  materializedProfileCount: PROFILES.length,
  expandedVariantStorage: "seeded-on-demand" as const,
  preStoredExpandedWorldRows: 0,
  disclosure:
    "本體規格逐一覆蓋 218 類經典題材；延伸世界依題材與種子按需組合，本模組沒有預存 218,000 筆世界資料。",
});

export function listTopicEraProfiles(): TopicEraProfile[] {
  return PROFILES.map((profile) => structuredClone(profile));
}

export function topicEraProfileAt(topicIdOrName: string): TopicEraProfile {
  const profile = PROFILE_BY_ID.get(topicIdOrName) ?? PROFILE_BY_NAME.get(topicIdOrName);
  if (!profile) {
    throw new Error("TOPIC_ERA_ONTOLOGY_TOPIC_NOT_FOUND");
  }
  return structuredClone(profile);
}

function topicFor(topicIdOrName: string): StoryTopic {
  const byId = CLASSIC_TOPIC_BY_ID.get(topicIdOrName);
  if (byId) return byId;
  const profile = PROFILE_BY_NAME.get(topicIdOrName);
  const topic = profile ? CLASSIC_TOPIC_BY_ID.get(profile.topicId) : undefined;
  if (!topic) throw new Error("TOPIC_ERA_ONTOLOGY_TOPIC_NOT_FOUND");
  return topic;
}

export function createIdentityMechanismOverlay(input: {
  topicIdOrName: string;
  mechanism: IdentityMechanism;
  context?: IdentityContext;
}): IdentityMechanismOverlay {
  if (!IDENTITY_MECHANISMS.includes(input.mechanism)) {
    throw new Error("TOPIC_ERA_ONTOLOGY_MECHANISM_NOT_FOUND");
  }

  const topic = topicFor(input.topicIdOrName);
  const topicProfile = topicEraProfileAt(topic.topicId);
  const inheritedKey = lexiconKeyFor(topic);
  const context = input.context ?? "inherit-topic";
  const lexiconKey = context === "inherit-topic" ? inheritedKey : CONTEXT_TO_LEXICON[context];
  const lexicon = LEXICON_PROFILES[lexiconKey];
  const boundary = boundaryFor(topic, lexiconKey);
  const mechanismLabel = MECHANISM_LABELS[input.mechanism];
  const rolePairs: [string, string][] = [
    [lexicon.occupations[0], lexicon.occupations[1]],
    [lexicon.addressTerms[0], lexicon.addressTerms[1]],
  ];

  return {
    schemaVersion: TOPIC_ERA_ONTOLOGY_VERSION,
    topicName: topicProfile.topicName,
    mechanism: input.mechanism,
    mechanismLabel,
    contextLabel: lexicon.label,
    premise: `${mechanismLabel}發生在${lexicon.settingTags.slice(0, 2).join("與")}之間。${MECHANISM_PREMISES[input.mechanism]}題材核心仍維持「${topicProfile.topicName}」，不會被自動改寫成修仙故事。`,
    rolePairs,
    settingTags: [...lexicon.settingTags],
    addressTerms: [...lexicon.addressTerms],
    institutionTypes: [...lexicon.institutionTypes],
    occupations: [...lexicon.occupations],
    resourceTypes: [...lexicon.resourceTypes],
    continuityRules: [
      "身體、意識、記憶、法律身分、社會關係與資源權限分開追蹤。",
      "交換或附身不會自動授予對方的專業能力、祕密知識、財產權或同意。",
      "每次變更都必須延續已發生的因果、承諾與可見後果，不因換身重置故事。",
      "恢復、退出與續篇條件必須由故事事件建立，不以作者旁白任意解除。",
    ],
    contentBoundary: boundary,
  };
}

import rawStoryLibrary from "../../../data/story-library.json" with { type: "json" };
import type { StoryLibrary, StoryTopic } from "../../novel-data/story-library-types";
import { topicWorldContractAt, type TopicWorldContract } from "./topic-world-contract";
import {
  STORY_ERAS,
  listTopicEraProfiles,
  topicEraProfileAt,
  type StoryEra,
  type TopicEraProfile,
} from "./topic-era-ontology";

const STORY_LIBRARY = rawStoryLibrary as StoryLibrary;
const CLASSIC_TOPICS = STORY_LIBRARY.topics
  .filter((topic) => topic.enabled && topic.classic)
  .sort((left, right) => left.topicId.localeCompare(right.topicId, "en"));
const ACTIVE_PACKS = STORY_LIBRARY.packs.filter((pack) => pack.enabled);
const PROFILE_BY_ID = new Map(
  listTopicEraProfiles().map((profile) => [profile.topicId, profile] as const),
);

if (CLASSIC_TOPICS.length !== 218 || PROFILE_BY_ID.size !== 218) {
  throw new Error(`GLOBAL_WORLD_INDEX_CATALOG_MISMATCH:${CLASSIC_TOPICS.length}/${PROFILE_BY_ID.size}`);
}

export const GLOBAL_WORLD_INDEX_VERSION = "global-world-index-v2" as const;
export const GLOBAL_WORLD_INDEX_CAPACITY = 100_000;
export const GLOBAL_WORLD_INDEX_PAGE_MAX = 24;
export const GLOBAL_WORLD_INDEX_MATERIALIZATION_POLICY = "fixed-address-on-demand-no-100k-blobs" as const;
const GLOBAL_WORLD_CANON_SEED = `${GLOBAL_WORLD_INDEX_VERSION}|canonical`;

export const GLOBAL_WORLD_CLASSIFICATIONS = [
  { id: "contemporary-life", name: "當代生活", eras: ["contemporary"] as StoryEra[], period: "智慧手機、大眾運輸與現代公共服務普及的當代", technology: "現代民生科技", magic: "無；若有異常能力，必須以隱性規則限制", institutions: ["地方政府", "社區組織", "家庭與民間團體"] },
  { id: "urban-workplace", name: "都市職場", eras: ["contemporary"] as StoryEra[], period: "企業、媒體與公共機構並存的都會年代", technology: "現代產業與資訊系統", magic: "無；都市異常不得取代契約與職務責任", institutions: ["企業董事會", "專業部門", "產業協會"] },
  { id: "school-youth", name: "校園青春", eras: ["contemporary"] as StoryEra[], period: "現代教育制度、社團與社群媒體並存的學年", technology: "現代校園科技", magic: "無；校園奇幻必須保留課業、年齡與監護邊界", institutions: ["學校", "學生自治組織", "社團與校隊"] },
  { id: "mystery-justice", name: "懸疑司法", eras: ["contemporary", "historical"] as StoryEra[], period: "存在可查驗證據、調查程序與責任歸屬的社會", technology: "依選定年代受限", magic: "不得替代證據鏈、證詞與合理推理", institutions: ["調查機構", "司法或仲裁機構", "證據保管單位"] },
  { id: "historical-court", name: "歷史宮廷", eras: ["historical"] as StoryEra[], period: "前工業王朝、官署與世族政治並行的年代", technology: "前工業工藝與驛傳", magic: "無或低奇幻；不得出現未授權的現代制度與器材", institutions: ["朝廷與官署", "宗族與世家", "商會與軍鎮"] },
  { id: "wuxia-rivers", name: "武俠江湖", eras: ["historical", "timeless-fantasy"] as StoryEra[], period: "驛道、門派、鏢局與地方政權交錯的冷兵器年代", technology: "冷兵器與傳統工藝", magic: "以內力、輕功與武學上限為準", institutions: ["門派", "鏢局與幫會", "地方官府"] },
  { id: "cultivation-sects", name: "修仙宗門", eras: ["timeless-fantasy"] as StoryEra[], period: "宗門、坊市、修行家族與散修共同競逐的架空紀元", technology: "煉器、丹道、符籙與陣法工藝", magic: "依境界、靈根、功法與代價運作的顯性修行體系", institutions: ["宗門與各峰", "修行家族", "散修盟與坊市"] },
  { id: "mythic-otherworld", name: "神話異界", eras: ["timeless-fantasy"] as StoryEra[], period: "神話秩序、異族文明與凡人社會並存的架空紀元", technology: "架空工藝", magic: "神術、魔法或異界法則必須有來源、限制與代價", institutions: ["王國與城邦", "神殿或魔法組織", "種族議會"] },
  { id: "near-future-cyber", name: "近未來賽博", eras: ["future"] as StoryEra[], period: "高密度網路、人工智慧與義體剛進入日常的近未來", technology: "人工智慧、義體、沉浸網路與基因技術", magic: "無；超常效果必須能由科技或明示異常規則解釋", institutions: ["科技企業", "資料治理機構", "城市自治網路"] },
  { id: "deep-space-future", name: "星際遠未來", eras: ["future"] as StoryEra[], period: "跨行星航行、殖民政治與星際外交成熟的遠未來", technology: "星艦、機甲、人工智慧與跨星系通訊", magic: "無；宇宙異常必須有可追蹤規則", institutions: ["星際議會", "殖民地政府", "艦隊與跨星企業"] },
  { id: "post-apocalypse", name: "末日災變", eras: ["contemporary", "future"] as StoryEra[], period: "原有秩序崩解後、倖存社群正在重建的年代", technology: "殘存、回收與再造技術", magic: "依災變來源受限；生存代價不得被能力跳過", institutions: ["避難據點", "救援與配給組織", "倖存者自治會"] },
] as const;

export type GlobalWorldClassification = (typeof GLOBAL_WORLD_CLASSIFICATIONS)[number];
export type GlobalWorldClassificationId = GlobalWorldClassification["id"];
export type GlobalTopicRole = "foundation" | "conflict" | "relationship" | "mechanism" | "format";

export type CrossEraBridge = {
  sourceEra: StoryEra;
  targetEra: StoryEra;
  direction: "one-way" | "two-way";
  mechanism: string;
  canonSourceId: string;
  approvedBy: "user";
};

const ERA_LABELS: Record<StoryEra, string> = {
  contemporary: "現代",
  historical: "歷史",
  future: "未來",
  "cross-era": "跨時代",
  "timeless-fantasy": "架空幻想",
};

const CLASSIFICATION_PATTERNS: Record<GlobalWorldClassificationId, RegExp> = {
  "contemporary-life": /現代|都市|生活|家庭|社區|鄉村|職場|醫療|運動|娛樂|藝術|出版|書店|飲食|療癒|寫實|人文|文化|旅行/u,
  "urban-workplace": /職場|企業|公司|商戰|商業|金融|創業|董事|總裁|娛樂圈|經紀|媒體|直播|品牌|辦公室|醫院|律師|設計|製作/u,
  "school-youth": /校園|學校|學生|青春|社團|學院|青少年|YA|同桌|畢業|校隊|學園/u,
  "mystery-justice": /懸疑|推理|司法|法律|法庭|犯罪|刑偵|法醫|間諜|諜報|劫案|怪談|祕密|謎案|調查|證據|案件|驚悚/u,
  "historical-court": /古代|歷史|宮廷|王朝|朝廷|皇|王侯|世家|宅鬥|官場|架空歷史|絲路|江山|戰國|三國/u,
  "wuxia-rivers": /武俠|江湖|武林|門派|鏢局|刀客|劍客|國術|武道|俠義/u,
  "cultivation-sects": /修仙|修真|仙俠|宗門|靈根|飛升|渡劫|煉丹|符籙|陣法|玄幻升級|東方玄幻/u,
  "mythic-otherworld": /奇幻|幻想|異界|異世|神話|魔法|龍族|精靈|妖|神祇|怪物|地下城|童話|克系|人外/u,
  "near-future-cyber": /近未來|賽博|AI|人工智慧|虛擬|基因|量子|演算法|科技|資料|網路|仿生|義體|太陽龐克/u,
  "deep-space-future": /星際|星艦|太空|行星|銀河|宇宙|殖民星|機甲|外星|星球|星門/u,
  "post-apocalypse": /末日|末世|災變|災難|求生|倖存|避難|喪屍|天災|氣候危機|文明重建|感染|大停電/u,
};

const FORMAT_PATTERN = /工具|平台|書城|書庫|排行|連載|分鏡|劇本|有聲|廣播劇|影視漫畫|書信日記體|互動選擇|視覺小說|遊戲書|讀者社群|成長系統/u;
const MECHANISM_PATTERN = /附身|變身|交換|穿梭|快穿|系統|LitRPG|數值流|重生|時間迴圈|平行世界|多結局/u;
const RELATIONSHIP_PATTERN = /言情|戀愛|婚|家庭|親情|療癒|女性成長|耽美|百合|團寵|萌寶|情感/u;
const CONFLICT_PATTERN = /懸疑|推理|犯罪|權謀|商戰|戰爭|復仇|求生|驚悚|災難|劫案/u;

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value.normalize("NFKC")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function topicSignals(topic: StoryTopic, profile: TopicEraProfile) {
  return [topic.name, topic.description, ...topic.tags, ...topic.subCategories,
    ...topic.recommendedWorlds, profile.premise, ...profile.settingTags,
    ...profile.institutionTypes, ...profile.resourceTypes].join("|");
}

function topicRole(topic: StoryTopic, profile: TopicEraProfile): GlobalTopicRole {
  const signals = topicSignals(topic, profile);
  if (FORMAT_PATTERN.test(signals)) return "format";
  if (MECHANISM_PATTERN.test(signals)) return "mechanism";
  if (RELATIONSHIP_PATTERN.test(signals)) return "relationship";
  if (CONFLICT_PATTERN.test(signals)) return "conflict";
  return "foundation";
}

function directEras(profile: TopicEraProfile, classification: GlobalWorldClassification) {
  return profile.supportedEras.filter(
    (era) => era !== "cross-era" && classification.eras.includes(era),
  );
}

function fallbackClassificationIds(profile: TopicEraProfile): GlobalWorldClassificationId[] {
  const ids: GlobalWorldClassificationId[] = [];
  if (profile.supportedEras.includes("contemporary")) ids.push("contemporary-life");
  if (profile.supportedEras.includes("historical")) ids.push("historical-court");
  if (profile.supportedEras.includes("future")) ids.push("near-future-cyber");
  if (profile.supportedEras.includes("timeless-fantasy")) ids.push("mythic-otherworld");
  return ids.length ? ids : ["mythic-otherworld"];
}

function buildCompatibilityManifest() {
  return new Map(CLASSIC_TOPICS.map((topic) => {
    const profile = PROFILE_BY_ID.get(topic.topicId)!;
    const signals = topicSignals(topic, profile);
    const role = topicRole(topic, profile);
    const direct = GLOBAL_WORLD_CLASSIFICATIONS.filter((classification) => (
      directEras(profile, classification).length > 0
      && (CLASSIFICATION_PATTERNS[classification.id].test(signals)
        || role === "format" || role === "mechanism")
    )).map((classification) => classification.id);
    const ids = direct.length ? direct : fallbackClassificationIds(profile);
    return [topic.topicId, Object.freeze([...new Set(ids)])] as const;
  }));
}

/** Versioned semantic compatibility table: 218 topics x 11 world classes. */
export const TOPIC_CLASS_COMPATIBILITY_MANIFEST = buildCompatibilityManifest();

export type WorldTopicCompatibility = {
  allowed: boolean;
  worldEra: StoryEra;
  topicId: string;
  topicName: string;
  classificationId: GlobalWorldClassificationId;
  crossEraBridge: CrossEraBridge | null;
  reasonCode: "DIRECT_COMPATIBLE" | "CROSS_ERA_CANON" | "ERA_BLOCKED" | "CLASS_BLOCKED";
  reason: string;
};

export type GlobalIndexedWorldSummary = {
  schemaVersion: typeof GLOBAL_WORLD_INDEX_VERSION;
  id: string;
  displayId: string;
  ordinal: number;
  classification: GlobalWorldClassification;
  era: Exclude<StoryEra, "cross-era">;
  eraLabel: string;
  primaryTopic: { topicId: string; topicName: string; role: GlobalTopicRole };
  title: string;
  logline: string;
  compatibleTopicCount: number;
  guard: { crossEraRequired: false; incompatibleTopicCount: number; statement: string };
};

export type GlobalIndexedWorld = GlobalIndexedWorldSummary & {
  canonicalSeed: string;
  compatibleTopicIds: string[];
  compatibleTopicPreview: Array<{ topicId: string; topicName: string; role: GlobalTopicRole }>;
  compatiblePacks: Array<{ packId: string; name: string; topicCount: number }>;
  contract: TopicWorldContract;
  blueprint: {
    period: string;
    technology: string;
    magic: string;
    institutions: readonly string[];
    canonRules: string[];
  };
};

function requireOrdinal(ordinal: number) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > GLOBAL_WORLD_INDEX_CAPACITY) {
    throw new RangeError(`GLOBAL_WORLD_INDEX_ORDINAL_INVALID:${ordinal}`);
  }
}

export function formatGlobalWorldId(ordinal: number) {
  requireOrdinal(ordinal);
  return `第${String(ordinal).padStart(6, "0")}世界`;
}

export function evaluateWorldTopicCompatibility(input: {
  worldEra: StoryEra;
  classificationId: GlobalWorldClassificationId;
  topicIdOrName: string;
  crossEraBridge?: CrossEraBridge | null;
}): WorldTopicCompatibility {
  if (!STORY_ERAS.includes(input.worldEra)) throw new Error(`GLOBAL_WORLD_ERA_INVALID:${input.worldEra}`);
  const profile = topicEraProfileAt(input.topicIdOrName);
  const classification = GLOBAL_WORLD_CLASSIFICATIONS.find((item) => item.id === input.classificationId);
  if (!classification) throw new Error(`GLOBAL_WORLD_CLASSIFICATION_INVALID:${input.classificationId}`);
  const eraDirect = input.worldEra !== "cross-era" && profile.supportedEras.includes(input.worldEra);
  const classDirect = TOPIC_CLASS_COMPATIBILITY_MANIFEST.get(profile.topicId)?.includes(input.classificationId) === true;
  const bridge = input.crossEraBridge ?? null;
  const bridgeValid = bridge !== null && bridge.approvedBy === "user"
    && bridge.canonSourceId.trim().length > 0 && bridge.mechanism.trim().length > 0
    && (bridge.targetEra === input.worldEra || bridge.direction === "two-way")
    && (profile.supportedEras.includes(bridge.sourceEra) || profile.supportedEras.includes("cross-era"));
  const reasonCode = eraDirect
    ? classDirect ? "DIRECT_COMPATIBLE" : "CLASS_BLOCKED"
    : bridgeValid ? "CROSS_ERA_CANON" : "ERA_BLOCKED";
  return {
    allowed: (eraDirect && classDirect) || bridgeValid,
    worldEra: input.worldEra,
    topicId: profile.topicId,
    topicName: profile.topicName,
    classificationId: input.classificationId,
    crossEraBridge: bridgeValid ? bridge : null,
    reasonCode,
    reason: reasonCode === "DIRECT_COMPATIBLE"
      ? `「${profile.topicName}」與${classification.name}的${ERA_LABELS[input.worldEra]}制度、科技與題材語彙相容。`
      : reasonCode === "CROSS_ERA_CANON"
        ? `已由正式 Canon「${bridge!.canonSourceId}」以「${bridge!.mechanism}」連接${ERA_LABELS[bridge!.sourceEra]}與${ERA_LABELS[bridge!.targetEra]}。`
        : reasonCode === "CLASS_BLOCKED"
          ? `「${profile.topicName}」的時代可用，但制度、科技或魔法規則不屬於「${classification.name}」。`
          : `「${profile.topicName}」不支援${ERA_LABELS[input.worldEra]}；必須更換題材，或先建立具名跨時代 Canon。`,
  };
}

function indexedAddress(ordinal: number) {
  const zeroBased = ordinal - 1;
  const topic = CLASSIC_TOPICS[zeroBased % CLASSIC_TOPICS.length]!;
  const profile = PROFILE_BY_ID.get(topic.topicId)!;
  const compatibleIds = TOPIC_CLASS_COMPATIBILITY_MANIFEST.get(topic.topicId)!;
  const classificationId = compatibleIds[
    Math.floor(zeroBased / CLASSIC_TOPICS.length) % compatibleIds.length
  ]!;
  const classification = GLOBAL_WORLD_CLASSIFICATIONS.find((item) => item.id === classificationId)!;
  const eras = directEras(profile, classification);
  const era = (eras[stableHash(`${GLOBAL_WORLD_CANON_SEED}|${ordinal}|era`) % eras.length]
    ?? classification.eras[0]) as Exclude<StoryEra, "cross-era">;
  const worldOrdinal = Math.floor(zeroBased / CLASSIC_TOPICS.length) % 1_000;
  return { topic, profile, classification, era, worldOrdinal };
}

const COMPATIBLE_TOPICS_CACHE = new Map<string, StoryTopic[]>();

function compatibleTopicsForWorld(era: StoryEra, classificationId: GlobalWorldClassificationId) {
  const cacheKey = `${era}|${classificationId}`;
  const cached = COMPATIBLE_TOPICS_CACHE.get(cacheKey);
  if (cached) return cached;
  const compatible = CLASSIC_TOPICS.filter((topic) => (
    PROFILE_BY_ID.get(topic.topicId)!.supportedEras.includes(era)
    && TOPIC_CLASS_COMPATIBILITY_MANIFEST.get(topic.topicId)!.includes(classificationId)
  ));
  COMPATIBLE_TOPICS_CACHE.set(cacheKey, compatible);
  return compatible;
}

function buildSummary(ordinal: number): GlobalIndexedWorldSummary {
  requireOrdinal(ordinal);
  const { topic, profile, classification, era, worldOrdinal } = indexedAddress(ordinal);
  const compatibleTopicCount = compatibleTopicsForWorld(era, classification.id).length;
  const displayId = formatGlobalWorldId(ordinal);
  const role = topicRole(topic, profile);
  const location = profile.settingTags[worldOrdinal % profile.settingTags.length] ?? classification.name;
  return {
    schemaVersion: GLOBAL_WORLD_INDEX_VERSION,
    id: `global-world-${String(ordinal).padStart(6, "0")}`,
    displayId,
    ordinal,
    classification,
    era,
    eraLabel: ERA_LABELS[era],
    primaryTopic: { topicId: topic.topicId, topicName: profile.topicName, role },
    title: `${displayId}・${classification.name}｜${profile.topicName}`,
    logline: `${classification.period}，以「${profile.topicName}」作為${role === "foundation" ? "世界基底" : role === "format" ? "敘事載體" : role === "mechanism" ? "故事機制" : role === "relationship" ? "關係主軸" : "核心衝突"}；主要舞台位於${location}。`,
    compatibleTopicCount,
    guard: {
      crossEraRequired: false,
      incompatibleTopicCount: CLASSIC_TOPICS.length - compatibleTopicCount,
      statement: `固定為${ERA_LABELS[era]}的「${classification.name}」世界；只允許 ${compatibleTopicCount}/218 類經時代、制度、科技與魔法規則檢查後相容的題材。跨時代內容必須另建具名 Canon 橋。`,
    },
  };
}

export function globalIndexedWorldSummaryAt(ordinal: number) {
  return buildSummary(ordinal);
}

export function globalIndexedWorldAt(input: { ordinal: number }): GlobalIndexedWorld {
  const summary = buildSummary(input.ordinal);
  const { topic, classification, worldOrdinal } = indexedAddress(input.ordinal);
  const compatibleTopics = compatibleTopicsForWorld(summary.era, classification.id);
  const canonicalSeed = `${GLOBAL_WORLD_CANON_SEED}|${summary.id}`;
  const contract = topicWorldContractAt({
    seed: canonicalSeed,
    topicId: topic.topicId,
    playMode: "general",
    worldOrdinal,
  });
  const compatiblePacks = ACTIVE_PACKS.map((pack) => {
    const topicCount = compatibleTopics.filter((item) => item.packIds.includes(pack.packId)).length;
    return { packId: pack.packId, name: pack.name, topicCount };
  }).filter((pack) => pack.topicCount > 0);
  return {
    ...summary,
    canonicalSeed,
    compatibleTopicIds: compatibleTopics.map((item) => item.topicId),
    compatibleTopicPreview: compatibleTopics.slice(0, 12).map((item) => {
      const profile = PROFILE_BY_ID.get(item.topicId)!;
      return { topicId: item.topicId, topicName: profile.topicName, role: topicRole(item, profile) };
    }),
    compatiblePacks,
    contract,
    blueprint: {
      period: classification.period,
      technology: classification.technology,
      magic: classification.magic,
      institutions: classification.institutions,
      canonRules: [
        `年代鎖定：${classification.period}。未經具名跨時代 Canon，不得帶入其他年代的人物、制度或物件。`,
        `科技邊界：${classification.technology}。超出上限的工具必須有作品內來源與可追蹤代價。`,
        `超常邊界：${classification.magic}。能力不得取消人物選擇、證據鏈或既有後果。`,
        ...contract.canonRules.slice(0, 5),
      ],
    },
  };
}

export function globalIndexedWorldPage(input: { offset?: number; limit?: number }) {
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 12;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= GLOBAL_WORLD_INDEX_CAPACITY) {
    throw new RangeError(`GLOBAL_WORLD_INDEX_OFFSET_INVALID:${offset}`);
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > GLOBAL_WORLD_INDEX_PAGE_MAX) {
    throw new RangeError(`GLOBAL_WORLD_INDEX_LIMIT_INVALID:${limit}`);
  }
  const items = Array.from(
    { length: Math.min(limit, GLOBAL_WORLD_INDEX_CAPACITY - offset) },
    (_, index) => buildSummary(offset + index + 1),
  );
  return {
    schemaVersion: GLOBAL_WORLD_INDEX_VERSION,
    materializationPolicy: GLOBAL_WORLD_INDEX_MATERIALIZATION_POLICY,
    offset,
    limit,
    totalItems: GLOBAL_WORLD_INDEX_CAPACITY,
    hasPreviousPage: offset > 0,
    hasNextPage: offset + items.length < GLOBAL_WORLD_INDEX_CAPACITY,
    classifications: GLOBAL_WORLD_CLASSIFICATIONS.map(({ id, name }) => ({ id, name })),
    topicPacks: ACTIVE_PACKS.map((pack) => ({ packId: pack.packId, name: pack.name })),
    classicTopics: CLASSIC_TOPICS.length,
    items,
  } as const;
}

export function globalWorldIndexDiagnostics() {
  const manifestRows = [...TOPIC_CLASS_COMPATIBILITY_MANIFEST.values()];
  return {
    schemaVersion: GLOBAL_WORLD_INDEX_VERSION,
    materializationPolicy: GLOBAL_WORLD_INDEX_MATERIALIZATION_POLICY,
    worldCount: GLOBAL_WORLD_INDEX_CAPACITY,
    worldClassificationCount: GLOBAL_WORLD_CLASSIFICATIONS.length,
    packCount: ACTIVE_PACKS.length,
    classicTopicCount: CLASSIC_TOPICS.length,
    topicsWithoutCompatibleClassification: manifestRows.filter((ids) => ids.length === 0).length,
    canonicalAddressesIgnoreProjectSeed: true,
  } as const;
}

import rawStoryLibrary from "../../../data/story-library.json" with { type: "json" };
import type { StoryLibrary, StoryTopic } from "../../novel-data/story-library-types";
import {
  DeterministicSocialMatrix,
} from "../social-matrix";
import {
  PROCEDURAL_CAUSAL_DIMENSIONS,
  PROCEDURAL_CHARACTER_CAPACITY,
  PROCEDURAL_ORIGIN_POLICY,
  PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
  PROCEDURAL_TREASURE_CAPACITY,
  proceduralStoryLibraryCapacity,
  type ProceduralCausalDimension,
  type ProceduralStoryContext,
} from "./procedural-story-library";
import { proceduralTreasureRecordAt } from "./procedural-treasure-library";

const STORY_LIBRARY = rawStoryLibrary as StoryLibrary;

export const PROCEDURAL_WORLD_LIBRARY_VERSION = "procedural-world-library-v1" as const;
export const PROCEDURAL_WORLD_VARIANTS_PER_TOPIC = 1_000;
export const PROCEDURAL_WORLD_TOPIC_CAPACITY = 218;
export const PROCEDURAL_WORLD_CAPACITY =
  PROCEDURAL_WORLD_TOPIC_CAPACITY * PROCEDURAL_WORLD_VARIANTS_PER_TOPIC;
export const PROCEDURAL_WORLD_RULES_PER_WORLD = 5;
export const PROCEDURAL_WORLD_RULE_CAPACITY =
  PROCEDURAL_WORLD_CAPACITY * PROCEDURAL_WORLD_RULES_PER_WORLD;
export const PROCEDURAL_WORLD_FACTIONS_PER_WORLD = 4;
export const PROCEDURAL_WORLD_FACTION_CAPACITY =
  PROCEDURAL_WORLD_CAPACITY * PROCEDURAL_WORLD_FACTIONS_PER_WORLD;
export const PROCEDURAL_WORLD_RESOURCES_PER_WORLD = 4;
export const PROCEDURAL_WORLD_RESOURCE_CAPACITY =
  PROCEDURAL_WORLD_CAPACITY * PROCEDURAL_WORLD_RESOURCES_PER_WORLD;
export const PROCEDURAL_WORLD_CONFLICTS_PER_WORLD = 3;
export const PROCEDURAL_WORLD_CONFLICT_CAPACITY =
  PROCEDURAL_WORLD_CAPACITY * PROCEDURAL_WORLD_CONFLICTS_PER_WORLD;
export const PROCEDURAL_WORLD_PAGE_MAX = 100;
export const PROCEDURAL_WORLD_MATERIALIZATION_POLICY =
  "indexed-on-demand-no-world-blobs" as const;
export const PROCEDURAL_WORLD_RESEARCH_POLICY =
  "abstract-popular-story-mechanisms-original-output-only" as const;

export type ProceduralWorldFaction = {
  id: string;
  ordinal: number;
  name: string;
  kind: string;
  publicGoal: string;
  leverage: string;
  internalContradiction: string;
  socialMatrixInstitutionOrdinal: number;
};

export type ProceduralWorldRule = {
  id: string;
  statement: string;
  enforcement: string;
  consequence: string;
  exception: string;
};

export type ProceduralWorldResource = {
  id: string;
  name: string;
  access: string;
  scarcity: string;
  socialLeverage: string;
  failureEffect: string;
};

export type ProceduralWorldConflict = {
  id: string;
  pressure: string;
  trackableContradiction: string;
  escalation: string;
  closureCondition: string;
};

export type ProceduralWorldCharacterReference = {
  characterId: string;
  characterOrdinal: number;
  name: string;
  narrativeRole: string;
  agency: string;
  refusalCondition: string;
};

export type ProceduralWorldTreasureReference = {
  treasureId: string;
  treasureOrdinal: number;
  name: string;
  category: string;
  holderCharacterId: string;
  holderCharacterName: string;
  holderRelationship: string;
};

export type ProceduralWorld = {
  schemaVersion: typeof PROCEDURAL_WORLD_LIBRARY_VERSION;
  materializationPolicy: typeof PROCEDURAL_WORLD_MATERIALIZATION_POLICY;
  researchPolicy: typeof PROCEDURAL_WORLD_RESEARCH_POLICY;
  fictional: true;
  originPolicy: typeof PROCEDURAL_ORIGIN_POLICY;
  id: string;
  seed: string;
  globalOrdinal: number;
  topicOrdinal: number;
  worldOrdinal: number;
  topic: {
    topicId: string;
    name: string;
    description: string;
    primaryPackId: string;
    packIds: string[];
    tags: string[];
  };
  title: string;
  logline: string;
  anchors: {
    era: string;
    geography: string;
    publicPromise: string;
    continuityInvariant: string;
  };
  socialStructure: {
    hierarchy: string;
    socialNorm: string;
    mobility: string;
    justice: string;
    dailyLife: string;
  };
  factions: ProceduralWorldFaction[];
  rules: ProceduralWorldRule[];
  resources: ProceduralWorldResource[];
  conflicts: ProceduralWorldConflict[];
  characters: ProceduralWorldCharacterReference[];
  treasures: ProceduralWorldTreasureReference[];
  relationshipScenario: {
    scenarioId: string;
    scenarioOrdinal: number;
    arrangement: string;
    hook: string;
  };
  causalDimensions: ProceduralCausalDimension[];
  narrativeSafeguards: {
    characterAutonomy: string;
    coherence: string;
    diversity: string;
    controllability: string;
    originality: string;
  };
};

export type ProceduralWorldPage = {
  topicId: string | null;
  packId: string | null;
  offset: number;
  limit: number;
  totalItems: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  items: ProceduralWorld[];
};

const CLASSIC_TOPICS = STORY_LIBRARY.topics.filter((topic) => topic.enabled && topic.classic);
const ACTIVE_PACKS = STORY_LIBRARY.packs.filter((pack) => pack.enabled);

if (CLASSIC_TOPICS.length !== PROCEDURAL_WORLD_TOPIC_CAPACITY) {
  throw new Error(`PROCEDURAL_WORLD_TOPIC_CAPACITY_MISMATCH:${CLASSIC_TOPICS.length}`);
}

const ERAS = [
  "舊秩序崩解後的第七年", "兩種曆法重疊的交界期", "長期和平即將到期的年代",
  "新技術剛進入民間的十年間", "王權與地方自治並存的轉型期", "大遷徙後重新定居的第三代",
] as const;
const GEOGRAPHIES = [
  "由十二座橋城連成的河谷共同體", "被季風分成內外兩圈的群島", "依山脈高度劃分權利的階梯國度",
  "沿古老運輸線生長的七個自治城", "中央盆地與四座邊境門戶互相制衡的國土", "在廢墟上重建、每季改變道路的移動城市群",
] as const;
const HIERARCHIES = [
  "血緣、技藝與公共服務三條晉升路徑互不等價", "中央議會只定底線，地方行會控制日常資源",
  "名義爵位仍存在，實際權力由掌握基礎設施的人取得", "每個成年人同時隸屬家族、職業組織與居住地，三者互相否決",
  "知識傳承者享有聲望，卻必須接受公開稽核", "戰時功勳可以換取地位，但不能直接繼承給下一代",
] as const;
const NORMS = [
  "公開承諾必須留下兩名不同立場的見證者", "所有重要交換都保留撤回期，但撤回者必須補償已發生的成本",
  "個人可以拒絕家族安排，代價是暫時失去共同資源", "持有稀缺能力者不得同時裁定自己的爭議",
  "救援優先於追責，事件穩定後才開始歸責", "祕密可以被保留，但利用祕密取得權力會觸發公開審查",
] as const;
const MOBILITY = [
  "完成跨群體服務即可取得新的身分擔保", "只有師徒與公開考核雙重認證才能改變階層",
  "遷居容易，取得當地決策權必須累積三次公共信用", "財富能購買工具但不能購買職位，職位由輪值與能力共同決定",
] as const;
const JUSTICE = [
  "爭議先由受影響者陳述，再由隨機公民與專業者共同裁決", "審理以可復核證據為核心，拒絕把名望當成證明",
  "地方先處理修復，跨域法庭再判定責任與補償", "契約可以挑戰，但提出挑戰者必須交出同等風險的擔保",
] as const;
const DAILY_LIFE = [
  "居民以公共鐘聲安排交易、學習與照護時段", "每個街區輪流維護水、能源與訊息網路",
  "市場白日交換物資，夜間則交換技藝與情報", "家庭與行會共同照顧幼者、傷者及暫時失去工作的人",
] as const;
const FACTION_SUFFIX = ["議會", "同盟", "行會", "學宮", "聯社", "巡守團", "工坊聯席", "記錄院"] as const;
const FACTION_KINDS = ["地方政體", "技藝組織", "商業聯盟", "知識共同體", "救援網路", "改革派系"] as const;
const FACTION_GOALS = ["維持公共資源可用", "改寫不公平的繼承規則", "守住跨域交通", "公開被壟斷的知識", "保護被忽略的居民", "證明新的合作制度可行"] as const;
const LEVERAGES = ["控制交通節點", "掌握專業人才與培訓", "保管歷年契約證據", "能動員跨區救援", "擁有稀缺材料的配給權", "掌握公開傳播與聲望"] as const;
const CONTRADICTIONS = ["公開理想與內部特權互相衝突", "改革速度快於成員能承受的代價", "需要敵對勢力的資源才能實現自身目標", "領導層守成而基層要求立即改變", "過去的成功方法正在製造新的受害者", "保密能保護成員，也使錯誤無法被查驗"] as const;
const RULE_STATEMENTS = [
  "任何跨區能力都必須以可追蹤的媒介為錨", "資源只能被重新分配，不能無代價生成",
  "改變身分必須同時獲得個人同意與公共見證", "知識可以複製，但控制權不能因此自動轉移",
  "封鎖只能延緩危機，不能抹除已經發生的因果", "預測只能顯示可能後果，不能替人物作出決定",
] as const;
const ENFORCEMENTS = ["由三方記錄交叉驗證", "由持有不同利益的兩個機構共同執行", "透過公開帳本與現場見證維持", "由環境本身留下不可偽造的變化"] as const;
const RULE_CONSEQUENCES = ["違規者會失去下一次優先取用權", "相關能力暫時封存直到補償完成", "原本的盟友取得一次否決權", "違規紀錄會改變後續交易與信任"] as const;
const RULE_EXCEPTIONS = ["立即救命時可先行，但事後必須完整說明", "當所有受影響者一致同意時可限時豁免", "只有在原規則本身造成更大傷害時才能挑戰", "未成年人與無法表意者由互相獨立的照護者共同代理"] as const;
const RESOURCE_NAMES = ["可驗證信用", "跨域通行時數", "修復材料", "公共知識席位", "安全庇護名額", "季節能源配額", "中立調解權", "記憶證據容量"] as const;
const RESOURCE_ACCESS = ["由完成公共任務的人優先取得", "按急迫性與既有消耗共同排序", "由三個不同群體輪流保管", "必須以等值服務而非金錢交換"] as const;
const RESOURCE_SCARCITY = ["每季只能恢復固定數量", "使用後需要三個故事節點才能再生", "總量不減，但可信版本很難取得", "分布不均，運送本身就是主要風險"] as const;
const RESOURCE_FAILURES = ["交通與救援會先失效", "弱勢群體會最先承擔代價", "錯誤訊息會取代可靠紀錄", "地方衝突會升級成跨域封鎖"] as const;
const PRESSURES = ["一項維持日常的制度突然失效", "舊盟約到期而新方案尚未取得信任", "稀缺資源被證明曾遭系統性挪用", "兩個都合理的群體同時需要唯一通道", "一名持有關鍵能力的人拒絕再被當作工具", "外部危機揭露內部長期被掩蓋的裂縫"] as const;
const ESCALATIONS = ["三個公共節點後封鎖會擴大", "下一次資源分配將使中立者被迫選邊", "證據若不能及時公開就會失去可驗證性", "一旦有人先使用暴力，合作成本將永久提高"] as const;
const CLOSURES = ["建立可被反對者共同驗證的新流程", "讓受影響者取得真實選擇並完成補償", "找出資源流失的責任鏈並恢復最低運作", "在不抹除舊傷的前提下形成限期新盟約"] as const;
const WORLD_STAGES = [
  "秩序初次鬆動", "公開承諾遭到質疑", "舊盟友開始分裂", "資源窗口即將關閉", "沉默者被迫表態",
  "被掩蓋的代價浮現", "兩套規則正面碰撞", "中立地帶失去安全", "修復方案接受試煉", "新秩序等待定名",
] as const;
const WORLD_TENSION_AXES = [
  "身分與歸屬", "信任與證據", "自由與照護", "傳承與改革", "速度與品質",
  "安全與真相", "私密與公共責任", "個人願望與群體存續", "記憶與可驗證紀錄", "權力與可撤回同意",
] as const;
const WORLD_TRANSFORMATION_PATHS = [
  "公開見證", "交換人質", "限期共治", "失敗復盤", "跨派系救援",
  "規則重寫", "祕密揭露", "資源再分配", "關係修復", "承諾驗收",
] as const;

function hashText(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function token(value: string) {
  return hashText(value).toString(36).padStart(7, "0");
}

function longToken(value: string) {
  return ["a", "b", "c", "d"]
    .map((salt) => token(`${salt}|${value}`))
    .join("");
}

function itemAt<T>(items: readonly T[], value: number, divisor = 1) {
  return items[Math.floor(value / divisor) % items.length];
}

function requireInteger(value: number, minimum: number, maximumExclusive: number, label: string) {
  if (!Number.isSafeInteger(value) || value < minimum || value >= maximumExclusive) {
    throw new RangeError(`${label}_ORDINAL_OUT_OF_RANGE:${value}`);
  }
}

function topicAt(topicId: string) {
  const topicOrdinal = CLASSIC_TOPICS.findIndex((topic) => topic.topicId === topicId);
  if (topicOrdinal < 0) throw new RangeError(`WORLD_TOPIC_NOT_FOUND:${topicId}`);
  return { topic: CLASSIC_TOPICS[topicOrdinal], topicOrdinal };
}

function topicTerms(topic: StoryTopic) {
  const descriptionTerms = topic.description
    .split(/[、，；。／/:：]+/u)
    .map((term) => term.trim())
    .filter(Boolean);
  const tags = topic.tags.map((tag) => tag.trim()).filter(Boolean);
  const institutions = topic.subCategories.map((category) => category.trim()).filter(Boolean);
  return {
    descriptionTerms: descriptionTerms.length > 0 ? descriptionTerms : [topic.description],
    tags: tags.length > 0 ? tags : [topic.name],
    institutions: institutions.length > 0 ? institutions : descriptionTerms.length > 0 ? descriptionTerms : [topic.name],
  };
}

function semanticCoordinates(worldOrdinal: number) {
  return {
    stage: WORLD_STAGES[Math.floor(worldOrdinal / 100)],
    tension: WORLD_TENSION_AXES[Math.floor(worldOrdinal / 10) % WORLD_TENSION_AXES.length],
    transformation: WORLD_TRANSFORMATION_PATHS[worldOrdinal % WORLD_TRANSFORMATION_PATHS.length],
  };
}

function topicProfile(topic: StoryTopic, worldOrdinal: number, offset = 0) {
  const terms = topicTerms(topic);
  const value = worldOrdinal + offset;
  return {
    motif: itemAt(terms.descriptionTerms, value),
    tag: itemAt(terms.tags, value, 3),
    institution: itemAt(terms.institutions, value, 7),
    ...semanticCoordinates(worldOrdinal),
  };
}

function worldTitle(topic: StoryTopic, worldOrdinal: number) {
  const profile = topicProfile(topic, worldOrdinal);
  return `${topic.name}・${profile.motif}（${profile.tag}）：${profile.stage}／${profile.tension}／${profile.transformation}`;
}

function entityId(input: {
  kind: "faction" | "resource" | "conflict";
  seed: string;
  globalOrdinal: number;
  itemOrdinal: number;
  itemsPerWorld: number;
}) {
  const linearAddress = input.globalOrdinal * input.itemsPerWorld + input.itemOrdinal;
  return `world-${input.kind}-${longToken(input.seed)}-${linearAddress.toString(36).padStart(5, "0")}`;
}

function validateEntityAddress(input: {
  seed: string;
  globalOrdinal: number;
  itemOrdinal: number;
  itemLabel: string;
  itemsPerWorld: number;
}) {
  const seed = input.seed.trim();
  if (!seed) throw new Error("PROCEDURAL_WORLD_SEED_REQUIRED");
  requireInteger(input.globalOrdinal, 0, PROCEDURAL_WORLD_CAPACITY, "GLOBAL_WORLD");
  requireInteger(input.itemOrdinal, 0, input.itemsPerWorld, input.itemLabel);
  return seed;
}

/** Canonical faction ID: root-seed fingerprint plus a reversible 0..871,999 address. */
export function proceduralWorldFactionIdAt(input: {
  seed: string;
  globalOrdinal: number;
  factionOrdinal: number;
}) {
  const seed = validateEntityAddress({
    ...input,
    itemOrdinal: input.factionOrdinal,
    itemLabel: "WORLD_FACTION",
    itemsPerWorld: PROCEDURAL_WORLD_FACTIONS_PER_WORLD,
  });
  return entityId({
    kind: "faction",
    seed,
    globalOrdinal: input.globalOrdinal,
    itemOrdinal: input.factionOrdinal,
    itemsPerWorld: PROCEDURAL_WORLD_FACTIONS_PER_WORLD,
  });
}

/** Canonical resource ID: root-seed fingerprint plus a reversible 0..871,999 address. */
export function proceduralWorldResourceIdAt(input: {
  seed: string;
  globalOrdinal: number;
  resourceOrdinal: number;
}) {
  const seed = validateEntityAddress({
    ...input,
    itemOrdinal: input.resourceOrdinal,
    itemLabel: "WORLD_RESOURCE",
    itemsPerWorld: PROCEDURAL_WORLD_RESOURCES_PER_WORLD,
  });
  return entityId({
    kind: "resource",
    seed,
    globalOrdinal: input.globalOrdinal,
    itemOrdinal: input.resourceOrdinal,
    itemsPerWorld: PROCEDURAL_WORLD_RESOURCES_PER_WORLD,
  });
}

/** Canonical conflict ID: root-seed fingerprint plus a reversible 0..653,999 address. */
export function proceduralWorldConflictIdAt(input: {
  seed: string;
  globalOrdinal: number;
  conflictOrdinal: number;
}) {
  const seed = validateEntityAddress({
    ...input,
    itemOrdinal: input.conflictOrdinal,
    itemLabel: "WORLD_CONFLICT",
    itemsPerWorld: PROCEDURAL_WORLD_CONFLICTS_PER_WORLD,
  });
  return entityId({
    kind: "conflict",
    seed,
    globalOrdinal: input.globalOrdinal,
    itemOrdinal: input.conflictOrdinal,
    itemsPerWorld: PROCEDURAL_WORLD_CONFLICTS_PER_WORLD,
  });
}

function buildFactions(seed: string, topic: StoryTopic, globalOrdinal: number): ProceduralWorldFaction[] {
  const worldOrdinal = globalOrdinal % PROCEDURAL_WORLD_VARIANTS_PER_TOPIC;
  return Array.from({ length: PROCEDURAL_WORLD_FACTIONS_PER_WORLD }, (_, offset) => {
    const value = hashText(`${seed}|${topic.topicId}|${globalOrdinal}|faction|${offset}`);
    const profile = topicProfile(topic, worldOrdinal, offset * 11);
    const socialMatrixInstitutionOrdinal = value % 256;
    return {
      id: proceduralWorldFactionIdAt({ seed, globalOrdinal, factionOrdinal: offset }),
      ordinal: offset,
      name: `${profile.institution}${itemAt(FACTION_SUFFIX, value, 13)}`,
      kind: `${topic.name}世界的${itemAt(FACTION_KINDS, value, 29)}（${profile.tag}）`,
      publicGoal: `在「${topic.description}」的題材承諾下，以${profile.transformation}完成「${itemAt(FACTION_GOALS, value, 43)}」。`,
      leverage: `掌握${profile.motif}相關網路，並${itemAt(LEVERAGES, value, 61)}。`,
      internalContradiction: `${profile.stage}時，${topic.name}的${profile.tension}使「${itemAt(CONTRADICTIONS, value, 79)}」。`,
      socialMatrixInstitutionOrdinal,
    };
  });
}

function ruleContent(seed: string, topic: StoryTopic, globalOrdinal: number, ruleOrdinal: number) {
  const value = hashText(`${seed}|${topic.topicId}|${globalOrdinal}|rule|${ruleOrdinal}`);
  const worldOrdinal = globalOrdinal % PROCEDURAL_WORLD_VARIANTS_PER_TOPIC;
  const profile = topicProfile(topic, worldOrdinal, ruleOrdinal * 13);
  return {
    statement: `${topic.name}以「${profile.motif}」為制度焦點：${itemAt(RULE_STATEMENTS, value)}`,
    enforcement: `依「${topic.description}」與${profile.tag}的公開承諾，${itemAt(ENFORCEMENTS, value, 17)}。`,
    consequence: `${profile.stage}期間若破壞${profile.tension}的平衡，${itemAt(RULE_CONSEQUENCES, value, 31)}。`,
    exception: `只有能推進${profile.transformation}時例外：${itemAt(RULE_EXCEPTIONS, value, 47)}。`,
  };
}

function worldRuleId(input: {
  seed: string;
  globalOrdinal: number;
  ruleOrdinal: number;
  content: ReturnType<typeof ruleContent>;
}) {
  const linearAddress = input.globalOrdinal * PROCEDURAL_WORLD_RULES_PER_WORLD + input.ruleOrdinal;
  const address = linearAddress.toString(36).padStart(5, "0");
  const contentAddress = longToken([
    input.content.statement,
    input.content.enforcement,
    input.content.consequence,
    input.content.exception,
  ].join("\u001f"));
  return `world-rule-${longToken(input.seed)}-${address}-${contentAddress}`;
}

/**
 * Returns the exact canonical rule ID without materializing its world. The
 * fixed-width linear address is a bijection over all 1,090,000 rule slots for
 * one root seed; the trailing 128-bit fingerprint addresses the rule content.
 */
export function proceduralWorldRuleIdAt(input: {
  seed: string;
  globalOrdinal: number;
  ruleOrdinal: number;
}) {
  const seed = input.seed.trim();
  if (!seed) throw new Error("PROCEDURAL_WORLD_SEED_REQUIRED");
  requireInteger(input.globalOrdinal, 0, PROCEDURAL_WORLD_CAPACITY, "GLOBAL_WORLD");
  requireInteger(input.ruleOrdinal, 0, PROCEDURAL_WORLD_RULES_PER_WORLD, "WORLD_RULE");
  const topicOrdinal = Math.floor(input.globalOrdinal / PROCEDURAL_WORLD_VARIANTS_PER_TOPIC);
  const topic = CLASSIC_TOPICS[topicOrdinal];
  const content = ruleContent(seed, topic, input.globalOrdinal, input.ruleOrdinal);
  return worldRuleId({
    seed,
    globalOrdinal: input.globalOrdinal,
    ruleOrdinal: input.ruleOrdinal,
    content,
  });
}

function buildRules(seed: string, topic: StoryTopic, globalOrdinal: number): ProceduralWorldRule[] {
  return Array.from({ length: PROCEDURAL_WORLD_RULES_PER_WORLD }, (_, ruleOrdinal) => {
    const content = ruleContent(seed, topic, globalOrdinal, ruleOrdinal);
    return {
      id: worldRuleId({ seed, globalOrdinal, ruleOrdinal, content }),
      ...content,
    };
  });
}

function buildResources(seed: string, topic: StoryTopic, globalOrdinal: number): ProceduralWorldResource[] {
  const worldOrdinal = globalOrdinal % PROCEDURAL_WORLD_VARIANTS_PER_TOPIC;
  return Array.from({ length: PROCEDURAL_WORLD_RESOURCES_PER_WORLD }, (_, offset) => {
    const value = hashText(`${seed}|${topic.topicId}|${globalOrdinal}|resource|${offset}`);
    const profile = topicProfile(topic, worldOrdinal, offset * 17);
    return {
      id: proceduralWorldResourceIdAt({ seed, globalOrdinal, resourceOrdinal: offset }),
      name: `${profile.motif}・${itemAt(RESOURCE_NAMES, value)}`,
      access: `${topic.name}以${profile.tag}為資格線索，${itemAt(RESOURCE_ACCESS, value, 19)}。`,
      scarcity: `「${topic.description}」使此資源受限：${itemAt(RESOURCE_SCARCITY, value, 37)}。`,
      socialLeverage: `在${profile.tension}爭議中可用來${itemAt(LEVERAGES, value, 53)}，也能推進${profile.transformation}。`,
      failureEffect: `${profile.stage}時若供應失守，${itemAt(RESOURCE_FAILURES, value, 71)}。`,
    };
  });
}

function buildConflicts(seed: string, topic: StoryTopic, globalOrdinal: number): ProceduralWorldConflict[] {
  const worldOrdinal = globalOrdinal % PROCEDURAL_WORLD_VARIANTS_PER_TOPIC;
  return Array.from({ length: PROCEDURAL_WORLD_CONFLICTS_PER_WORLD }, (_, offset) => {
    const value = hashText(`${seed}|${topic.topicId}|${globalOrdinal}|conflict|${offset}`);
    const recommended = topic.recommendedConflicts[offset % Math.max(1, topic.recommendedConflicts.length)];
    const profile = topicProfile(topic, worldOrdinal, offset * 19);
    return {
      id: proceduralWorldConflictIdAt({ seed, globalOrdinal, conflictOrdinal: offset }),
      pressure: `${topic.name}的「${profile.motif}」制度遭遇壓力：${recommended || itemAt(PRESSURES, value)}`,
      trackableContradiction: `題材承諾「${topic.description}」與${profile.tag}陣營正面衝突：${itemAt(CONTRADICTIONS, value, 23)}。`,
      escalation: `${profile.stage}若未處理${profile.tension}，${itemAt(ESCALATIONS, value, 41)}。`,
      closureCondition: `必須經過${profile.transformation}，並${itemAt(CLOSURES, value, 67)}。`,
    };
  });
}

type ProceduralWorldSemanticCore = Pick<
  ProceduralWorld,
  "title" | "logline" | "anchors" | "socialStructure" | "factions" | "rules" | "resources" | "conflicts"
>;

function buildWorldSemanticCore(input: {
  seed: string;
  topic: StoryTopic;
  globalOrdinal: number;
  worldOrdinal: number;
}): ProceduralWorldSemanticCore {
  const mixed = hashText(`${PROCEDURAL_WORLD_LIBRARY_VERSION}|${input.seed}|${input.topic.topicId}|${input.worldOrdinal}`);
  const profile = topicProfile(input.topic, input.worldOrdinal);
  const recommendedGeography = input.topic.recommendedWorlds[
    input.worldOrdinal % Math.max(1, input.topic.recommendedWorlds.length)
  ];
  const geography = `${profile.motif}成為公共焦點的${recommendedGeography || itemAt(GEOGRAPHIES, mixed, 7)}`;
  const factions = buildFactions(input.seed, input.topic, input.globalOrdinal);
  const rules = buildRules(input.seed, input.topic, input.globalOrdinal);
  const resources = buildResources(input.seed, input.topic, input.globalOrdinal);
  const conflicts = buildConflicts(input.seed, input.topic, input.globalOrdinal);

  return {
    title: worldTitle(input.topic, input.worldOrdinal),
    logline: `在${geography}，「${input.topic.description}」不再只是背景；${profile.tag}陣營於${profile.stage}面對${profile.tension}，必須在${resources[0].name}耗盡前以${profile.transformation}改寫${input.topic.name}的新秩序。`,
    anchors: {
      era: `${input.topic.name}進入${profile.stage}的${itemAt(ERAS, mixed)}`,
      geography,
      publicPromise: `以「${input.topic.description}」為核心，讓${profile.tag}、${profile.tension}與${profile.transformation}都透過人物選擇留下可追蹤後果。`,
      continuityInvariant: `世界規則、資源流向、人物承諾與已發生後果都以 ${input.topic.topicId}/${input.worldOrdinal} 為連續性錨點，不因換場而重置。`,
    },
    socialStructure: {
      hierarchy: `${input.topic.name}以${profile.institution}分配地位；${itemAt(HIERARCHIES, mixed, 11)}。`,
      socialNorm: `「${input.topic.description}」被寫成共同生活承諾，並要求${itemAt(NORMS, mixed, 19)}。`,
      mobility: `${profile.tag}成員若要跨越${profile.tension}的界線，${itemAt(MOBILITY, mixed, 31)}。`,
      justice: `${profile.motif}爭議必須接受${profile.transformation}，且${itemAt(JUSTICE, mixed, 43)}。`,
      dailyLife: `${profile.stage}中的居民每天都會接觸${profile.institution}；${itemAt(DAILY_LIFE, mixed, 59)}。`,
    },
    factions,
    rules,
    resources,
    conflicts,
  };
}

function semanticSignature(core: ProceduralWorldSemanticCore) {
  return JSON.stringify({
    title: core.title,
    logline: core.logline,
    anchors: {
      era: core.anchors.era,
      geography: core.anchors.geography,
      publicPromise: core.anchors.publicPromise,
    },
    socialStructure: core.socialStructure,
    factions: core.factions.map((faction) => ({
      name: faction.name,
      kind: faction.kind,
      publicGoal: faction.publicGoal,
      leverage: faction.leverage,
      internalContradiction: faction.internalContradiction,
    })),
    rules: core.rules.map((rule) => ({
      statement: rule.statement,
      enforcement: rule.enforcement,
      consequence: rule.consequence,
      exception: rule.exception,
    })),
    resources: core.resources.map((resource) => ({
      name: resource.name,
      access: resource.access,
      scarcity: resource.scarcity,
      socialLeverage: resource.socialLeverage,
      failureEffect: resource.failureEffect,
    })),
    conflicts: core.conflicts.map((conflict) => ({
      pressure: conflict.pressure,
      trackableContradiction: conflict.trackableContradiction,
      escalation: conflict.escalation,
      closureCondition: conflict.closureCondition,
    })),
  });
}

/**
 * Materializes only the narrative setting layer. The signature deliberately
 * excludes IDs, characters and treasures, so 1,000 distinct values prove
 * actual setting variation rather than address or cast variation.
 */
export function proceduralWorldSemanticSignatureAt(input: {
  seed: string;
  topicId: string;
  worldOrdinal: number;
}) {
  const seed = input.seed.trim();
  if (!seed) throw new Error("PROCEDURAL_WORLD_SEED_REQUIRED");
  requireInteger(input.worldOrdinal, 0, PROCEDURAL_WORLD_VARIANTS_PER_TOPIC, "WORLD");
  const { topic, topicOrdinal } = topicAt(input.topicId);
  const globalOrdinal = topicOrdinal * PROCEDURAL_WORLD_VARIANTS_PER_TOPIC + input.worldOrdinal;
  return semanticSignature(buildWorldSemanticCore({
    seed,
    topic,
    globalOrdinal,
    worldOrdinal: input.worldOrdinal,
  }));
}

function buildWorld(input: {
  seed: string;
  topic: StoryTopic;
  topicOrdinal: number;
  worldOrdinal: number;
  context?: ProceduralStoryContext;
}): ProceduralWorld {
  const seed = input.seed.trim();
  if (!seed) throw new Error("PROCEDURAL_WORLD_SEED_REQUIRED");
  requireInteger(input.worldOrdinal, 0, PROCEDURAL_WORLD_VARIANTS_PER_TOPIC, "WORLD");
  const globalOrdinal = input.topicOrdinal * PROCEDURAL_WORLD_VARIANTS_PER_TOPIC + input.worldOrdinal;
  const semanticCore = buildWorldSemanticCore({
    seed,
    topic: input.topic,
    globalOrdinal,
    worldOrdinal: input.worldOrdinal,
  });
  const socialMatrix = new DeterministicSocialMatrix({
    seed,
    context: input.context,
    cacheLimit: 0,
  });
  const treasureOrdinal = (
    globalOrdinal * 47_999
    + hashText(`${seed}|world-treasure`)
  ) % PROCEDURAL_TREASURE_CAPACITY;
  const treasure = proceduralTreasureRecordAt({
    storySeed: seed,
    ordinal: treasureOrdinal,
    context: input.context,
    socialMatrix,
  });
  const characters = treasure.crossMatrix.castCharacterIds.map((characterId) => {
    const character = socialMatrix.getCharacterById(characterId);
    if (!character) throw new Error(`PROCEDURAL_WORLD_CHARACTER_REFERENCE_INVALID:${characterId}`);
    return character;
  });
  return {
    schemaVersion: PROCEDURAL_WORLD_LIBRARY_VERSION,
    materializationPolicy: PROCEDURAL_WORLD_MATERIALIZATION_POLICY,
    researchPolicy: PROCEDURAL_WORLD_RESEARCH_POLICY,
    fictional: true,
    originPolicy: PROCEDURAL_ORIGIN_POLICY,
    id: `world-${token(seed)}-${input.topic.topicId}-${input.worldOrdinal.toString(36).padStart(2, "0")}`,
    seed,
    globalOrdinal,
    topicOrdinal: input.topicOrdinal,
    worldOrdinal: input.worldOrdinal,
    topic: {
      topicId: input.topic.topicId,
      name: input.topic.name,
      description: input.topic.description,
      primaryPackId: input.topic.packId,
      packIds: [...input.topic.packIds],
      tags: [...input.topic.tags],
    },
    ...semanticCore,
    characters: characters.map((character, index) => ({
      characterId: character.characterId,
      characterOrdinal: character.populationIndex,
      name: character.name,
      narrativeRole: ["寶物持有人", "獨立聲索者", "證據見證者"][index],
      agency: `${character.name}會以「${character.goal}」為目標先行採取行動，不等待主角指令。`,
      refusalCondition: `若行動要求犧牲「${character.personality.privateNeed}」，${character.name}便會拒絕。`,
    })),
    treasures: [{
      treasureId: treasure.id,
      treasureOrdinal: treasure.ordinal,
      name: treasure.name,
      category: treasure.kindLabel,
      holderCharacterId: treasure.holder.characterId,
      holderCharacterName: treasure.holder.characterName,
      holderRelationship: treasure.holder.relationship,
    }],
    relationshipScenario: {
      scenarioId: treasure.crossMatrix.scenarioId,
      scenarioOrdinal: treasure.crossMatrix.scenarioOrdinal,
      arrangement: `${treasure.holder.characterName}持有，${treasure.stakeholders[1].characterName}提出聲索，${treasure.stakeholders[2].characterName}保管可復核證據。`,
      hook: `${treasure.storyHook} 三方都保留自身目標、拒絕條件與後續行動。`,
    },
    causalDimensions: treasure.causalDimensions,
    narrativeSafeguards: {
      characterAutonomy: "每名人物保留自己的目標、先行行動與拒絕條件，不成為只等主角指令的工具。",
      coherence: "全域錨點、社會規則、稀缺資源與可追蹤矛盾在每次續寫時共同約束結果。",
      diversity: "題材承諾固定，勢力排列、制度、資源、人物與衝突依種子重組，避免只換名稱。",
      controllability: "作者可用 topicId、worldOrdinal 與 seed 精確重播或切換世界，不依賴不可追蹤亂數。",
      originality: "只吸收通用敘事機制；不複製小說、影片、社群帳號、人物、照片、台詞或段落。",
    },
  };
}

export function proceduralWorldAt(input: {
  seed: string;
  topicId: string;
  worldOrdinal: number;
  context?: ProceduralStoryContext;
}) {
  const { topic, topicOrdinal } = topicAt(input.topicId);
  return buildWorld({ ...input, topic, topicOrdinal });
}

export function proceduralWorldAtGlobalOrdinal(input: {
  seed: string;
  ordinal: number;
  context?: ProceduralStoryContext;
}) {
  requireInteger(input.ordinal, 0, PROCEDURAL_WORLD_CAPACITY, "GLOBAL_WORLD");
  const topicOrdinal = Math.floor(input.ordinal / PROCEDURAL_WORLD_VARIANTS_PER_TOPIC);
  const worldOrdinal = input.ordinal % PROCEDURAL_WORLD_VARIANTS_PER_TOPIC;
  return buildWorld({
    seed: input.seed,
    topic: CLASSIC_TOPICS[topicOrdinal],
    topicOrdinal,
    worldOrdinal,
    context: input.context,
  });
}

export function proceduralWorldByAddress(input: {
  seed: string;
  packId: string;
  topicOrdinal: number;
  worldOrdinal: number;
  context?: ProceduralStoryContext;
}) {
  const pack = ACTIVE_PACKS.find((candidate) => candidate.packId === input.packId);
  if (!pack) throw new RangeError(`WORLD_PACK_NOT_FOUND:${input.packId}`);
  const topics = CLASSIC_TOPICS.filter((topic) => topic.packIds.includes(input.packId));
  requireInteger(input.topicOrdinal, 0, topics.length, "PACK_TOPIC");
  return proceduralWorldAt({
    seed: input.seed,
    topicId: topics[input.topicOrdinal].topicId,
    worldOrdinal: input.worldOrdinal,
    context: input.context,
  });
}

export function proceduralWorldPage(input: {
  seed: string;
  topicId?: string;
  packId?: string;
  offset?: number;
  limit?: number;
  context?: ProceduralStoryContext;
}): ProceduralWorldPage {
  if (input.topicId && input.packId) throw new Error("WORLD_PAGE_FILTER_CONFLICT");
  const topics = input.topicId
    ? [topicAt(input.topicId).topic]
    : input.packId
      ? (() => {
        if (!ACTIVE_PACKS.some((pack) => pack.packId === input.packId)) throw new RangeError(`WORLD_PACK_NOT_FOUND:${input.packId}`);
        return CLASSIC_TOPICS.filter((topic) => topic.packIds.includes(input.packId!));
      })()
      : CLASSIC_TOPICS;
  const totalItems = topics.length * PROCEDURAL_WORLD_VARIANTS_PER_TOPIC;
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 24;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > totalItems) throw new RangeError(`WORLD_PAGE_OFFSET_INVALID:${offset}`);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > PROCEDURAL_WORLD_PAGE_MAX) throw new RangeError(`WORLD_PAGE_LIMIT_INVALID:${limit}`);
  const itemCount = Math.min(limit, totalItems - offset);
  const items = Array.from({ length: itemCount }, (_, index) => {
    const filteredOrdinal = offset + index;
    const topic = topics[Math.floor(filteredOrdinal / PROCEDURAL_WORLD_VARIANTS_PER_TOPIC)];
    const worldOrdinal = filteredOrdinal % PROCEDURAL_WORLD_VARIANTS_PER_TOPIC;
    return proceduralWorldAt({ seed: input.seed, topicId: topic.topicId, worldOrdinal, context: input.context });
  });
  return {
    topicId: input.topicId ?? null,
    packId: input.packId ?? null,
    offset,
    limit,
    totalItems,
    hasPreviousPage: offset > 0,
    hasNextPage: offset + items.length < totalItems,
    items,
  };
}

export function proceduralWorldLibraryDiagnostics() {
  const base = proceduralStoryLibraryCapacity();
  return {
    schemaVersion: PROCEDURAL_WORLD_LIBRARY_VERSION,
    sourceStoryLibrarySchemaVersion: STORY_LIBRARY.schemaVersion,
    materializationPolicy: PROCEDURAL_WORLD_MATERIALIZATION_POLICY,
    researchPolicy: PROCEDURAL_WORLD_RESEARCH_POLICY,
    originPolicy: PROCEDURAL_ORIGIN_POLICY,
    packs: ACTIVE_PACKS.length,
    classicTopics: CLASSIC_TOPICS.length,
    worldsPerTopic: PROCEDURAL_WORLD_VARIANTS_PER_TOPIC,
    addressableWorlds: PROCEDURAL_WORLD_CAPACITY,
    addressableWorldFactions: PROCEDURAL_WORLD_FACTION_CAPACITY,
    addressableWorldRules: PROCEDURAL_WORLD_RULE_CAPACITY,
    addressableWorldResources: PROCEDURAL_WORLD_RESOURCE_CAPACITY,
    addressableWorldConflicts: PROCEDURAL_WORLD_CONFLICT_CAPACITY,
    materializedWorldBlobs: 0,
    characters: PROCEDURAL_CHARACTER_CAPACITY,
    treasures: PROCEDURAL_TREASURE_CAPACITY,
    relationshipScenarios: PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
    theoreticalCharacterTreasurePairs: base.theoreticalCharacterTreasurePairs,
    causalDimensions: PROCEDURAL_CAUSAL_DIMENSIONS.length,
  } as const;
}

export function listProceduralWorldTopics() {
  return CLASSIC_TOPICS.map((topic, topicOrdinal) => ({
    topicId: topic.topicId,
    topicOrdinal,
    name: topic.name,
    packId: topic.packId,
    packIds: [...topic.packIds],
    worlds: PROCEDURAL_WORLD_VARIANTS_PER_TOPIC,
  }));
}

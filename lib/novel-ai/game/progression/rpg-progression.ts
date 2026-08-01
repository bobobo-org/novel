import type { StoryChoiceEffect, StoryState } from "../../domain";
import {
  generateProceduralPills,
  type ProceduralPillProfile,
} from "../procedural-pill-engine";
import {
  applyProceduralWorldPulse,
  buildProceduralEncounter,
  parseRecentEncounterSignatures,
  type ProceduralEncounter,
} from "../procedural-world-director";

export const RPG_FORMULA_VERSION = "novel-rpg-unified-v2" as const;

export type RpgMode = "adventure" | "cultivation" | "management";
export type RpgChoiceKey = "A" | "B" | "C" | "custom";
export type RpgChoiceStrategy = "steady" | "resource" | "bold";
export type RpgOutcome = "critical_success" | "success" | "partial_success" | "failure";

export const RPG_MODE_DEFINITIONS: Record<RpgMode, {
  label: string;
  shortLabel: string;
  description: string;
  primaryCurrency: string;
  dailyActionPoints: number;
}> = {
  adventure: {
    label: "冒險 RPG",
    shortLabel: "冒險",
    description: "戰鬥、任務、裝備、地圖與世界分支",
    primaryCurrency: "金幣",
    dailyActionPoints: 3,
  },
  cultivation: {
    label: "角色養成",
    shortLabel: "養成",
    description: "有限時間內培養能力、關係與人生路線",
    primaryCurrency: "靈石",
    dailyActionPoints: 3,
  },
  management: {
    label: "經營模擬",
    shortLabel: "經營",
    description: "在資金、人力、品質、聲望與風險間持續取捨",
    primaryCurrency: "營運資金",
    dailyActionPoints: 5,
  },
};

export const RPG_STAT_DEFINITIONS = [
  {
    key: "rpg.physique",
    label: "體能",
    labels: { adventure: "力量／體質", cultivation: "體魄", management: "健康體力" },
    description: "生命、防禦、搬運、持久力與承受高強度工作的基礎。",
  },
  {
    key: "rpg.technique",
    label: "技巧",
    labels: { adventure: "敏捷／技巧", cultivation: "武技", management: "執行技巧" },
    description: "速度、精準、戰鬥技術、生產與實際執行能力。",
  },
  {
    key: "rpg.intellect",
    label: "智慧",
    labels: { adventure: "智力／洞察", cultivation: "悟性", management: "企劃洞察" },
    description: "推理、研究、學習、機關、企劃與資訊判讀能力。",
  },
  {
    key: "rpg.charisma",
    label: "魅力",
    labels: { adventure: "魅力／共感", cultivation: "氣質", management: "溝通領導" },
    description: "交涉、說服、理解人物、領導與建立長期關係的能力。",
  },
  {
    key: "rpg.will",
    label: "意志",
    labels: { adventure: "意志／勇氣", cultivation: "心性", management: "抗壓自律" },
    description: "精神防禦、承擔代價、抗壓、自律與持續行動的能力。",
  },
  {
    key: "rpg.creativity",
    label: "創造",
    labels: { adventure: "創造／靈性", cultivation: "靈力", management: "創新能力" },
    description: "創意、靈感、魔力、特殊解法、研發與突破既有規則的能力。",
  },
] as const;

export type RpgStatKey = typeof RPG_STAT_DEFINITIONS[number]["key"];

const LEGACY_STAT_KEYS: Record<RpgStatKey, string> = {
  "rpg.physique": "rpg.resilience",
  "rpg.technique": "rpg.craft",
  "rpg.intellect": "rpg.insight",
  "rpg.charisma": "rpg.empathy",
  "rpg.will": "rpg.courage",
  "rpg.creativity": "rpg.renown",
};

export type RpgRuleSettings = {
  growthPace: "fast" | "standard" | "realistic";
  randomness: "story" | "balanced" | "high_risk";
  choicePreview: "full" | "partial";
  eventFrequency: 3 | 4 | 5;
};

export const DEFAULT_RPG_RULE_SETTINGS: RpgRuleSettings = {
  growthPace: "standard",
  randomness: "balanced",
  choicePreview: "partial",
  eventFrequency: 4,
};

export function normalizeRpgRuleSettings(input: unknown): RpgRuleSettings {
  const value = input && typeof input === "object" ? input as Partial<RpgRuleSettings> : {};
  return {
    growthPace: ["fast", "standard", "realistic"].includes(String(value.growthPace))
      ? value.growthPace as RpgRuleSettings["growthPace"]
      : DEFAULT_RPG_RULE_SETTINGS.growthPace,
    randomness: ["story", "balanced", "high_risk"].includes(String(value.randomness))
      ? value.randomness as RpgRuleSettings["randomness"]
      : DEFAULT_RPG_RULE_SETTINGS.randomness,
    choicePreview: value.choicePreview === "full" ? "full" : "partial",
    eventFrequency: [3, 4, 5].includes(Number(value.eventFrequency))
      ? Number(value.eventFrequency) as 3 | 4 | 5
      : DEFAULT_RPG_RULE_SETTINGS.eventFrequency,
  };
}

export type RpgDerivedStats = {
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  insight: number;
  negotiation: number;
  leadership: number;
  carryCapacity: number;
};

export type RpgStatusSnapshot = {
  hp: number;
  stamina: number;
  spirit: number;
  fatigue: number;
  stress: number;
  mood: number;
  health: number;
  focus: number;
  actionPoints: number;
};

export type ManagementSnapshot = {
  cash: number;
  staff: number;
  morale: number;
  reputation: number;
  satisfaction: number;
  technology: number;
  risk: number;
  marketShare: number;
  socialImpact: number;
  employeeEfficiency: number;
  expectedDemand: number;
  expectedSales: number;
  expectedRevenue: number;
  expectedNetProfit: number;
  annualScore: number;
};

export type RpgJourneySnapshot = {
  mainlineQuestId: string;
  mainlineGoal: string;
  mainlineProgress: number;
  identityStrategy: RpgChoiceStrategy | "unformed";
  identityLabel: string;
  identityCommitment: number;
  identityScores: Record<RpgChoiceStrategy, number>;
  worldFreedom: number;
  gates: {
    power: { ready: boolean; current: number; required: number };
    information: { ready: boolean; current: number; required: number };
    item: { ready: boolean; current: number; required: number };
  };
};

export const RPG_FREE_WORLD_ACTIVITIES: Record<RpgMode, ReadonlyArray<{
  id: string;
  label: string;
  description: string;
  action: string;
}>> = {
  adventure: [
    { id: "explore", label: "探索", description: "找地點、線索與隱藏道路", action: "離開安全區，調查一條尚未標記的道路與沿途線索" },
    { id: "hunt", label: "討伐", description: "處理威脅並取得材料", action: "追蹤附近正在威脅旅人的敵對生物，但先確認退路" },
    { id: "commission", label: "委託", description: "以任務換取信用與報酬", action: "在聚落尋找一項能真正改善當地處境的委託" },
    { id: "craft", label: "製作", description: "把材料變成工具與裝備", action: "盤點手邊材料，製作能解決目前困局的實用工具" },
    { id: "social", label: "社交", description: "建立情報與人際網絡", action: "與目前最可能掌握內情的人交談，先理解他的立場與代價" },
    { id: "boss", label: "挑戰頭目", description: "高風險推進世界危機", action: "追查章節頭目的弱點與前置條件，再決定是否正式挑戰" },
  ],
  cultivation: [
    { id: "practice", label: "修練", description: "累積熟練與身心底盤", action: "針對目前最薄弱的能力完成一輪可檢驗的基礎修練" },
    { id: "mentor", label: "拜師", description: "建立師承、門規與長期承諾", action: "尋找一位理念相容的導師，先完成考驗再決定是否拜師" },
    { id: "study", label: "研習", description: "把知識轉成自己的理解", action: "研讀一份與目前瓶頸相關的典籍，整理出可實作的心得" },
    { id: "alchemy", label: "煉製", description: "以材料、技術與風險換成果", action: "用現有材料設計一份可追溯配方，進行小規模試煉" },
    { id: "bond", label: "同修", description: "讓能力與關係共同成長", action: "邀請可信任的人共同修練，交換彼此的觀察與限制" },
    { id: "breakthrough", label: "突破", description: "承擔代價跨越成長門檻", action: "先檢查健康、疲勞與資源，再評估是否挑戰下一階段" },
  ],
  management: [
    { id: "trade", label: "經商", description: "在價格、需求與信用間取捨", action: "調查真正需求後完成一筆有利但不透支信譽的交易" },
    { id: "produce", label: "生產", description: "平衡品質、成本與產能", action: "找出目前生產瓶頸，改善一項最影響品質的流程" },
    { id: "recruit", label: "招募", description: "補足團隊能力與文化缺口", action: "依目前團隊缺口尋找合適人才，明確說明責任與回報" },
    { id: "research", label: "研發", description: "投入資源建立長期差異", action: "選擇一個可小規模驗證的新產品方向，限制本輪研發成本" },
    { id: "network", label: "結盟", description: "建立供應、客戶與地方網絡", action: "拜訪一個可能長期合作的組織，先確認雙方真正需求" },
    { id: "territory", label: "經營領地", description: "讓組織影響世界而非只看營收", action: "盤點領地的安全、民生與資源，選出最急迫的一項改善" },
  ],
};

export type RpgInventoryItem = {
  itemId: string;
  name: string;
  category: "consumable" | "weapon" | "armor" | "treasure" | "material" | "quest";
  rarity: "common" | "uncommon" | "rare" | "epic";
  description: string;
  effectDescription: string;
  weight: number;
  value: number;
  slot: "weapon" | "armor" | "treasure" | null;
  statBonuses: Partial<Record<RpgStatKey, number>>;
  useEffect?: Record<string, number>;
  proceduralPill?: ProceduralPillProfile;
};

export const RPG_ITEM_CATALOG: RpgInventoryItem[] = [
  { itemId: "healing-potion", name: "赤晶治療藥", category: "consumable", rarity: "common", description: "冒險者公會的標準急救藥。", effectDescription: "使用後 HP +35、健康 +5。", weight: 0.3, value: 80, slot: null, statBonuses: {}, useEffect: { "status.hp": 35, "status.health": 5 } },
  { itemId: "focus-elixir", name: "凝神露", category: "consumable", rarity: "uncommon", description: "壓低雜念並恢復精神的清苦藥液。", effectDescription: "使用後精神 +30、專注 +20、壓力 -8。", weight: 0.2, value: 160, slot: null, statBonuses: {}, useEffect: { "status.spirit": 30, "status.focus": 20, "status.stress": -8 } },
  { itemId: "iron-sword", name: "銘紋鐵劍", category: "weapon", rarity: "uncommon", description: "耐用的單手劍，護手刻有穩定靈力的紋路。", effectDescription: "裝備後技巧 +5、體能 +2。", weight: 4.2, value: 620, slot: "weapon", statBonuses: { "rpg.technique": 5, "rpg.physique": 2 } },
  { itemId: "traveler-armor", name: "逐風旅甲", category: "armor", rarity: "uncommon", description: "兼顧防護與長途移動的輕甲。", effectDescription: "裝備後體能 +5、意志 +2。", weight: 6.5, value: 840, slot: "armor", statBonuses: { "rpg.physique": 5, "rpg.will": 2 } },
  { itemId: "moon-pendant", name: "月蝕墜飾", category: "treasure", rarity: "rare", description: "月光下會浮現另一條世界線的殘影。", effectDescription: "裝備後智慧 +4、創造 +5，隱藏事件發現率提高。", weight: 0.1, value: 2400, slot: "treasure", statBonuses: { "rpg.intellect": 4, "rpg.creativity": 5 } },
  { itemId: "spirit-shard", name: "淬靈碎晶", category: "material", rarity: "common", description: "可用於修煉、鍛造或交易的基礎靈性材料。", effectDescription: "8 枚可在養成事件中精煉成 1 枚靈石。", weight: 0.1, value: 35, slot: null, statBonuses: {} },
  { itemId: "royal-pass", name: "王城通行證", category: "quest", rarity: "rare", description: "記錄持有人身分與王城許可的任務物品。", effectDescription: "可解除王城關卡的部分前置條件，不可直接消耗。", weight: 0, value: 0, slot: null, statBonuses: {} },
  { itemId: "contract-seal", name: "星火商契印", category: "treasure", rarity: "epic", description: "能驗證契約版本與承諾來源的古老印章。", effectDescription: "裝備後魅力 +4、智慧 +3；經營談判獲得額外加成。", weight: 0.8, value: 4800, slot: "treasure", statBonuses: { "rpg.charisma": 4, "rpg.intellect": 3 } },
];

export type RpgInventoryStack = RpgInventoryItem & {
  quantity: number;
  equipped: boolean;
};

export type RpgProgressionSnapshot = {
  formulaVersion: typeof RPG_FORMULA_VERSION;
  mode: RpgMode;
  baseStats: Record<RpgStatKey, number>;
  equipmentBonuses: Record<RpgStatKey, number>;
  stats: Record<RpgStatKey, number>;
  derived: RpgDerivedStats;
  status: RpgStatusSnapshot;
  management: ManagementSnapshot;
  journey: RpgJourneySnapshot;
  inventory: RpgInventoryStack[];
  currencies: { gold: number; spiritStone: number; guildToken: number };
  xp: number;
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  levelProgress: number;
  powerScore: number;
  day: number;
  turn: number;
  choiceVariant: number;
  fatePoints: number;
  carryWeight: number;
  procedural: {
    runSeed: string;
    cycle: number;
    recentEncounterSignatures: string[];
    currentAspect: string | null;
    currentLocationVariant: string | null;
  };
};

export type RpgChoice = {
  id: string;
  key: RpgChoiceKey;
  title: string;
  approach: RpgChoiceStrategy;
  strategyLabel: string;
  description: string;
  consequence: string;
  primaryStat: RpgStatKey;
  secondaryStat: RpgStatKey;
  risk: 1 | 2 | 3 | 4 | 5;
  successChance: number;
  xpGain: number;
  actionCost: number;
  costLabels: string[];
  impactLabels: string[];
  effect: StoryChoiceEffect;
  acceptedText: string;
  encounter: ProceduralEncounter;
};

export type RpgChoiceResolution = {
  choice: RpgChoice;
  outcome: RpgOutcome;
  outcomeLabel: string;
  roll: number;
  successChance: number;
  effect: StoryChoiceEffect;
  acceptedText: string;
  summary: string;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

const numberFrom = (value: unknown, fallback: number) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

function hashText(value: string) {
  let hash = 2166136261;
  for (const character of value.normalize("NFKC")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function experienceForLevel(level: number) {
  const normalized = clamp(Math.floor(level), 1, 99);
  return 100 * (normalized - 1) ** 2;
}

export function levelFromExperience(xp: number) {
  return clamp(Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1, 1, 99);
}

export function initialRpgStats(seed = ""): Record<RpgStatKey, number> {
  const hash = hashText(seed);
  return Object.fromEntries(RPG_STAT_DEFINITIONS.map((definition, index) => {
    const offset = ((hash >>> ((index % 4) * 8)) % 11) - 5;
    return [definition.key, 50 + offset];
  })) as Record<RpgStatKey, number>;
}

export function initialRpgResources() {
  return {
    "status.hp": 100,
    "status.stamina": 100,
    "status.spirit": 100,
    "status.fatigue": 10,
    "status.stress": 10,
    "status.mood": 70,
    "status.health": 100,
    "status.focus": 70,
    "game.actionPoints": 3,
    "game.day": 1,
    "game.turn": 0,
    "game.choiceVariant": 0,
    "game.fatePoints": 2,
    "journey.mainlineMomentum": 0,
    "journey.path.steady": 0,
    "journey.path.resource": 0,
    "journey.path.bold": 0,
    "journey.worldFreedom": 0,
    "currency.spiritStone": 24,
    "currency.guildToken": 3,
    "item.healing-potion": 3,
    "item.focus-elixir": 1,
    "item.iron-sword": 1,
    "item.traveler-armor": 1,
    "item.moon-pendant": 0,
    "item.spirit-shard": 8,
    "item.royal-pass": 0,
    "item.contract-seal": 1,
    "management.cash": 100_000,
    "management.staff": 3,
    "management.employeeSkill": 52,
    "management.jobFit": 60,
    "management.staffStamina": 72,
    "management.morale": 65,
    "management.reputation": 20,
    "management.satisfaction": 50,
    "management.technology": 20,
    "management.risk": 10,
    "management.marketShare": 5,
    "management.socialImpact": 10,
    "management.baseDemand": 120,
    "management.inventory": 100,
    "management.capacity": 90,
    "management.unitPrice": 120,
    "management.marketPrice": 120,
    "management.unitCost": 55,
    "management.fixedCost": 2500,
    "management.marketingFactor": 1,
    "management.facilityFactor": 1,
    "management.teamFactor": 1,
  };
}

function readCoreStats(
  protagonistStats: Record<string, number>,
  seed: string,
) {
  const defaults = initialRpgStats(seed);
  return Object.fromEntries(RPG_STAT_DEFINITIONS.map(({ key }) => {
    const direct = protagonistStats[key];
    const legacy = protagonistStats[LEGACY_STAT_KEYS[key]];
    return [key, clamp(Math.round(direct ?? legacy ?? defaults[key]), 0, 100)];
  })) as Record<RpgStatKey, number>;
}

function equipmentBonuses(
  worldFlags: Record<string, boolean | string | number>,
  resources: Record<string, number>,
) {
  const result = Object.fromEntries(RPG_STAT_DEFINITIONS.map(({ key }) => [key, 0])) as Record<RpgStatKey, number>;
  const equippedIds = new Set([
    worldFlags["rpg.equipped.weapon"],
    worldFlags["rpg.equipped.armor"],
    worldFlags["rpg.equipped.treasure"],
  ].filter((value): value is string => typeof value === "string"));
  for (const item of RPG_ITEM_CATALOG) {
    if (!equippedIds.has(item.itemId) || numberFrom(resources[`item.${item.itemId}`], 0) < 1) continue;
    for (const [key, value] of Object.entries(item.statBonuses)) {
      result[key as RpgStatKey] += value ?? 0;
    }
  }
  return result;
}

export function computePowerScore(
  stats: Record<RpgStatKey, number>,
  level: number,
) {
  const weighted =
    stats["rpg.physique"] * 0.18
    + stats["rpg.technique"] * 0.18
    + stats["rpg.intellect"] * 0.2
    + stats["rpg.charisma"] * 0.16
    + stats["rpg.will"] * 0.18
    + stats["rpg.creativity"] * 0.1;
  return Math.round(weighted * (1 + (Math.max(1, level) - 1) * 0.04));
}

export function computeSuccessChance(input: {
  primary: number;
  secondary: number;
  level: number;
  risk: number;
  temporaryModifier?: number;
  equipmentBonus?: number;
  teamBonus?: number;
}) {
  return clamp(Math.round(
    24
    + input.primary * 0.48
    + input.secondary * 0.18
    + input.level * 1.2
    + (input.temporaryModifier ?? 0)
    + (input.equipmentBonus ?? 0)
    + (input.teamBonus ?? 0)
    - input.risk * 8,
  ), 5, 95);
}

function computeDerivedStats(stats: Record<RpgStatKey, number>, level: number): RpgDerivedStats {
  return {
    maxHp: Math.round(70 + stats["rpg.physique"] * 2.6 + level * 5),
    attack: Math.round(stats["rpg.physique"] * 0.42 + stats["rpg.technique"] * 0.4 + level * 2.2),
    defense: Math.round(stats["rpg.physique"] * 0.48 + stats["rpg.will"] * 0.32 + level * 1.8),
    speed: Math.round(stats["rpg.technique"] * 0.65 + stats["rpg.physique"] * 0.2 + level),
    insight: Math.round(stats["rpg.intellect"] * 0.65 + stats["rpg.creativity"] * 0.25 + level),
    negotiation: Math.round(stats["rpg.charisma"] * 0.65 + stats["rpg.intellect"] * 0.25 + level),
    leadership: Math.round(stats["rpg.charisma"] * 0.45 + stats["rpg.will"] * 0.3 + stats["rpg.intellect"] * 0.25),
    carryCapacity: Math.round(12 + stats["rpg.physique"] * 0.45),
  };
}

function readInventory(
  resources: Record<string, number>,
  inventory: string[],
  worldFlags: Record<string, boolean | string | number>,
  runSeed: string,
  cycle: number,
): RpgInventoryStack[] {
  const legacyCounts = inventory.reduce<Record<string, number>>((counts, itemId) => {
    counts[itemId] = (counts[itemId] ?? 0) + 1;
    return counts;
  }, {});
  const equipped = new Set(Object.entries(worldFlags)
    .filter(([key, value]) => key.startsWith("rpg.equipped.") && typeof value === "string")
    .map(([, value]) => String(value)));
  const proceduralPills = generateProceduralPills({ runSeed, cycle, count: 6 });
  return [...RPG_ITEM_CATALOG, ...proceduralPills].map((item) => ({
    ...item,
    quantity: Math.max(0, Math.round(
      resources[`item.${item.itemId}`] ?? legacyCounts[item.itemId] ?? 0,
    )),
    equipped: equipped.has(item.itemId),
  })).filter((item) => item.quantity > 0);
}

function readManagement(resources: Record<string, number>): ManagementSnapshot {
  const get = (key: string, fallback: number) => numberFrom(resources[key], fallback);
  const employeeEfficiency = clamp(
    get("management.employeeSkill", 52) * 0.4
    + get("management.morale", 65) * 0.25
    + get("management.staffStamina", 72) * 0.2
    + get("management.jobFit", 60) * 0.15,
    0,
    100,
  );
  const reputationFactor = clamp(0.75 + get("management.reputation", 20) / 200, 0.5, 1.35);
  const priceAttraction = clamp(
    2 - get("management.unitPrice", 120) / Math.max(1, get("management.marketPrice", 120)),
    0.4,
    1.4,
  );
  const expectedDemand = Math.round(
    get("management.baseDemand", 120)
    * get("management.marketingFactor", 1)
    * reputationFactor
    * priceAttraction,
  );
  const actualCapacity = Math.round(
    get("management.capacity", 90)
    * employeeEfficiency / 100
    * get("management.facilityFactor", 1)
    * get("management.teamFactor", 1),
  );
  const expectedSales = Math.max(0, Math.min(
    expectedDemand,
    Math.round(get("management.inventory", 100)),
    actualCapacity,
  ));
  const expectedRevenue = expectedSales * get("management.unitPrice", 120);
  const variableCost = expectedSales * get("management.unitCost", 55);
  const managementComplexity = 1
    + Math.max(0, get("management.branches", 0)) * 0.08
    + Math.max(0, get("management.staff", 3)) * 0.01;
  const expectedNetProfit = Math.round(
    expectedRevenue - variableCost - get("management.fixedCost", 2500) * managementComplexity,
  );
  const annualScore = Math.round(
    clamp(50 + expectedNetProfit / 1000, 0, 100) * 0.3
    + get("management.satisfaction", 50) * 0.25
    + get("management.morale", 65) * 0.2
    + get("management.technology", 20) * 0.15
    + get("management.socialImpact", 10) * 0.1,
  );
  return {
    cash: Math.round(get("management.cash", 100_000)),
    staff: Math.max(0, Math.round(get("management.staff", 3))),
    morale: clamp(Math.round(get("management.morale", 65)), 0, 100),
    reputation: clamp(Math.round(get("management.reputation", 20)), 0, 100),
    satisfaction: clamp(Math.round(get("management.satisfaction", 50)), 0, 100),
    technology: clamp(Math.round(get("management.technology", 20)), 0, 100),
    risk: clamp(Math.round(get("management.risk", 10)), 0, 100),
    marketShare: clamp(Math.round(get("management.marketShare", 5)), 0, 100),
    socialImpact: clamp(Math.round(get("management.socialImpact", 10)), 0, 100),
    employeeEfficiency: Math.round(employeeEfficiency),
    expectedDemand,
    expectedSales,
    expectedRevenue,
    expectedNetProfit,
    annualScore,
  };
}

type StoryStateInput = Pick<StoryState, "protagonistStats"> & Partial<
  Pick<StoryState, "resources" | "money" | "inventory" | "worldFlags" | "questStates">
>;

function readJourney(
  mode: RpgMode,
  resources: Record<string, number>,
  questStates: Record<string, string>,
  inventory: RpgInventoryStack[],
  powerScore: number,
): RpgJourneySnapshot {
  const mainlineQuestId = mode === "management"
    ? "management.survive90"
    : mode === "cultivation"
      ? "growth.main"
      : "rpg.mainArc";
  const mainlineGoal = mode === "management"
    ? "讓組織跨過生存期，建立可持續的秩序"
    : mode === "cultivation"
      ? "形成不可被輕易重置的師承、能力與人生道路"
      : "追查世界危機，取得進入下一章所需的力量、情報與關鍵物";
  const identityScores = {
    steady: Math.max(0, Math.round(numberFrom(resources["journey.path.steady"], 0))),
    resource: Math.max(0, Math.round(numberFrom(resources["journey.path.resource"], 0))),
    bold: Math.max(0, Math.round(numberFrom(resources["journey.path.bold"], 0))),
  };
  const rankedIdentity = (Object.entries(identityScores) as Array<[RpgChoiceStrategy, number]>)
    .sort((left, right) => right[1] - left[1])[0];
  const identityStrategy = rankedIdentity[1] > 0 ? rankedIdentity[0] : "unformed";
  const identityLabel = {
    unformed: "尚未定型的旅人",
    steady: "守序遠行者",
    resource: "結盟織網者",
    bold: "破界冒險者",
  }[identityStrategy];
  const information = Math.max(0, Math.round(
    numberFrom(resources["adventure.clues"], 0)
    + numberFrom(resources["adventure.mapProgress"], 0),
  ));
  const keyItems = inventory.filter((item) =>
    item.quantity > 0 && (item.category === "quest" || item.itemId === "royal-pass"),
  ).reduce((sum, item) => sum + item.quantity, 0)
    + Math.max(0, Math.round(numberFrom(resources["adventure.tools"], 0)));
  const mainlineProgress = clamp(
    Math.round(numberFrom(questStates[mainlineQuestId], 0)),
    0,
    100,
  );
  const requiredPower = 52 + Math.floor(mainlineProgress / 25) * 6;
  return {
    mainlineQuestId,
    mainlineGoal,
    mainlineProgress,
    identityStrategy,
    identityLabel,
    identityCommitment: rankedIdentity[1],
    identityScores,
    worldFreedom: clamp(Math.round(numberFrom(resources["journey.worldFreedom"], 0)), 0, 100),
    gates: {
      power: { ready: powerScore >= requiredPower, current: powerScore, required: requiredPower },
      information: { ready: information >= 3, current: information, required: 3 },
      item: { ready: keyItems >= 1, current: keyItems, required: 1 },
    },
  };
}

export function readRpgProgression(
  storyState: StoryStateInput,
  seed = "",
  mode: RpgMode = "adventure",
): RpgProgressionSnapshot {
  const resources = storyState.resources ?? {};
  const worldFlags = storyState.worldFlags ?? {};
  const runSeed = typeof worldFlags["rpg.runSeed"] === "string" && worldFlags["rpg.runSeed"]
    ? String(worldFlags["rpg.runSeed"])
    : seed || "default-playthrough";
  const cycle = Math.max(1, Math.round(numberFrom(worldFlags["rpg.cycle"], 1)));
  const baseStats = readCoreStats(storyState.protagonistStats, seed);
  const bonuses = equipmentBonuses(worldFlags, resources);
  const stats = Object.fromEntries(RPG_STAT_DEFINITIONS.map(({ key }) => [
    key,
    clamp(baseStats[key] + bonuses[key], 0, 100),
  ])) as Record<RpgStatKey, number>;
  const xp = Math.max(0, Math.round(storyState.protagonistStats["rpg.xp"] ?? 0));
  const level = levelFromExperience(xp);
  const currentLevelXp = experienceForLevel(level);
  const nextLevelXp = level >= 99 ? currentLevelXp : experienceForLevel(level + 1);
  const status = {
    hp: clamp(Math.round(numberFrom(resources["status.hp"], 100)), 0, 100),
    stamina: clamp(Math.round(numberFrom(resources["status.stamina"], 100)), 0, 100),
    spirit: clamp(Math.round(numberFrom(resources["status.spirit"], 100)), 0, 100),
    fatigue: clamp(Math.round(numberFrom(resources["status.fatigue"], 10)), 0, 100),
    stress: clamp(Math.round(numberFrom(resources["status.stress"], 10)), 0, 100),
    mood: clamp(Math.round(numberFrom(resources["status.mood"], 70)), 0, 100),
    health: clamp(Math.round(numberFrom(resources["status.health"], 100)), 0, 100),
    focus: clamp(Math.round(numberFrom(resources["status.focus"], 70)), 0, 100),
    actionPoints: clamp(Math.round(numberFrom(resources["game.actionPoints"], RPG_MODE_DEFINITIONS[mode].dailyActionPoints)), 0, 5),
  };
  const inventory = readInventory(resources, storyState.inventory ?? [], worldFlags, runSeed, cycle);
  const carryWeight = Math.round(inventory.reduce((sum, item) => sum + item.weight * item.quantity, 0) * 10) / 10;
  const powerScore = computePowerScore(stats, level);
  return {
    formulaVersion: RPG_FORMULA_VERSION,
    mode,
    baseStats,
    equipmentBonuses: bonuses,
    stats,
    derived: computeDerivedStats(stats, level),
    status,
    management: readManagement(resources),
    journey: readJourney(mode, resources, storyState.questStates ?? {}, inventory, powerScore),
    inventory,
    currencies: {
      gold: Math.round(storyState.money ?? 1_200),
      spiritStone: Math.max(0, Math.round(numberFrom(resources["currency.spiritStone"], 24))),
      guildToken: Math.max(0, Math.round(numberFrom(resources["currency.guildToken"], 3))),
    },
    xp,
    level,
    currentLevelXp,
    nextLevelXp,
    levelProgress: level >= 99
      ? 100
      : Math.round((xp - currentLevelXp) / Math.max(1, nextLevelXp - currentLevelXp) * 100),
    powerScore,
    day: Math.max(1, Math.round(numberFrom(resources["game.day"], 1))),
    turn: Math.max(0, Math.round(numberFrom(resources["game.turn"], 0))),
    choiceVariant: Math.max(0, Math.round(numberFrom(resources["game.choiceVariant"], 0))),
    fatePoints: Math.max(0, Math.round(numberFrom(resources["game.fatePoints"], 2))),
    carryWeight,
    procedural: {
      runSeed,
      cycle,
      recentEncounterSignatures: parseRecentEncounterSignatures(worldFlags["rpg.recentEncounterSignatures"]),
      currentAspect: typeof worldFlags["world.currentAspect"] === "string" ? worldFlags["world.currentAspect"] : null,
      currentLocationVariant: typeof worldFlags["world.currentLocationVariant"] === "string" ? worldFlags["world.currentLocationVariant"] : null,
    },
  };
}

type ChoiceBlueprint = {
  id: string;
  mode: RpgMode;
  strategy: RpgChoiceStrategy;
  title: string;
  description: string;
  consequence: string;
  primaryStat: RpgStatKey;
  secondaryStat: RpgStatKey;
  risk: 1 | 2 | 3 | 4 | 5;
  actionCost: number;
  staminaCost: number;
  fatigueDelta: number;
  stressDelta: number;
  moneyChange?: number;
  statRewards: Partial<Record<RpgStatKey, number>>;
  resourceRewards: Record<string, number>;
  relationshipRewards?: Record<string, number>;
  questId: string;
  achievementId: string;
};

const CHOICE_POOL: ChoiceBlueprint[] = [
  { id: "adv-scout", mode: "adventure", strategy: "steady", title: "偵察地形與敵情", description: "先確認巡邏、退路與可利用的環境，再用最少代價推進。", consequence: "低風險並累積線索；拖延可能讓機會縮小。", primaryStat: "rpg.intellect", secondaryStat: "rpg.technique", risk: 1, actionCost: 1, staminaCost: 5, fatigueDelta: 2, stressDelta: -1, statRewards: { "rpg.intellect": 3, "rpg.technique": 1 }, resourceRewards: { "adventure.clues": 2 }, questId: "rpg.mainArc", achievementId: "rpg.scout" },
  { id: "adv-formation", mode: "adventure", strategy: "steady", title: "穩住隊伍與陣形", description: "優先保護受傷者並重新分配站位，讓隊伍保留後續戰力。", consequence: "隊伍信任穩定成長；短期推進速度較慢。", primaryStat: "rpg.will", secondaryStat: "rpg.physique", risk: 1, actionCost: 1, staminaCost: 4, fatigueDelta: -2, stressDelta: -3, statRewards: { "rpg.will": 3, "rpg.physique": 1 }, resourceRewards: { "adventure.supplies": 1 }, relationshipRewards: { "rpg.partyTrust": 3 }, questId: "rpg.mainArc", achievementId: "rpg.guardian" },
  { id: "adv-safe-route", mode: "adventure", strategy: "steady", title: "沿安全路線推進", description: "避開最危險的路段，逐步取得位置與時間上的優勢。", consequence: "資源消耗較少；可能錯過罕見戰利品。", primaryStat: "rpg.technique", secondaryStat: "rpg.intellect", risk: 2, actionCost: 1, staminaCost: 7, fatigueDelta: 3, stressDelta: 0, statRewards: { "rpg.technique": 3, "rpg.intellect": 1 }, resourceRewards: { "adventure.mapProgress": 2 }, questId: "rpg.mainArc", achievementId: "rpg.pathfinder" },
  { id: "adv-negotiate", mode: "adventure", strategy: "resource", title: "交換情報與承諾", description: "找出各方真正需要的籌碼，以可信的交換改變眼前局勢。", consequence: "關係與情報收益較高；承諾會成為後續義務。", primaryStat: "rpg.charisma", secondaryStat: "rpg.intellect", risk: 2, actionCost: 1, staminaCost: 2, fatigueDelta: 1, stressDelta: 2, moneyChange: -80, statRewards: { "rpg.charisma": 4, "rpg.intellect": 1 }, resourceRewards: { "adventure.clues": 2 }, relationshipRewards: { "rpg.partyTrust": 4 }, questId: "rpg.mainArc", achievementId: "rpg.diplomat" },
  { id: "adv-craft", mode: "adventure", strategy: "resource", title: "製作臨時工具破局", description: "利用現有材料設計一個不必正面衝突的實際解法。", consequence: "可保存生命與體力；會消耗材料並留下可追查痕跡。", primaryStat: "rpg.creativity", secondaryStat: "rpg.technique", risk: 2, actionCost: 1, staminaCost: 5, fatigueDelta: 2, stressDelta: 1, statRewards: { "rpg.creativity": 4, "rpg.technique": 2 }, resourceRewards: { "adventure.tools": 1, "item.spirit-shard": -1 }, questId: "rpg.mainArc", achievementId: "rpg.inventor" },
  { id: "adv-bounty", mode: "adventure", strategy: "resource", title: "完成委託取得補給", description: "順手處理一項可驗證的小型委託，換取資金、補給與地方信用。", consequence: "資源回報穩定；主要目標會稍微延後。", primaryStat: "rpg.technique", secondaryStat: "rpg.charisma", risk: 2, actionCost: 1, staminaCost: 8, fatigueDelta: 4, stressDelta: 1, moneyChange: 180, statRewards: { "rpg.technique": 2, "rpg.charisma": 2 }, resourceRewards: { "item.healing-potion": 1 }, questId: "rpg.mainArc", achievementId: "rpg.contract" },
  { id: "adv-breakthrough", mode: "adventure", strategy: "bold", title: "正面突破封鎖", description: "抓住守備變化的瞬間，以速度與力量直接打開缺口。", consequence: "推進最快、風險最高；失敗會消耗大量狀態。", primaryStat: "rpg.physique", secondaryStat: "rpg.technique", risk: 4, actionCost: 2, staminaCost: 18, fatigueDelta: 9, stressDelta: 5, statRewards: { "rpg.physique": 4, "rpg.technique": 3 }, resourceRewards: { "adventure.momentum": 3 }, questId: "rpg.mainArc", achievementId: "rpg.bold" },
  { id: "adv-forbidden-zone", mode: "adventure", strategy: "bold", title: "追入禁區奪取先機", description: "在敵人重整前追入未知區域，冒險換取稀有情報與世界線優勢。", consequence: "可能開啟隱藏路線；也可能受傷或觸發追捕。", primaryStat: "rpg.will", secondaryStat: "rpg.intellect", risk: 5, actionCost: 2, staminaCost: 16, fatigueDelta: 8, stressDelta: 8, statRewards: { "rpg.will": 5, "rpg.intellect": 2 }, resourceRewards: { "adventure.hiddenRoute": 1 }, questId: "rpg.mainArc", achievementId: "rpg.fatebreaker" },
  { id: "adv-duel", mode: "adventure", strategy: "bold", title: "挑戰關鍵強敵", description: "把衝突集中到一場可判定的對決，阻止局勢繼續擴散。", consequence: "成功可大幅提高聲望；失敗仍會產生可補救的新支線。", primaryStat: "rpg.technique", secondaryStat: "rpg.will", risk: 4, actionCost: 2, staminaCost: 20, fatigueDelta: 10, stressDelta: 6, statRewards: { "rpg.technique": 5, "rpg.will": 2 }, resourceRewards: { "adventure.renown": 4 }, questId: "rpg.mainArc", achievementId: "rpg.challenger" },

  { id: "grow-rest", mode: "cultivation", strategy: "steady", title: "調息與完整休養", description: "停下一次高強度行程，修復健康並整理最近的成長。", consequence: "能力成長較少，但能避免過勞與崩壞路線。", primaryStat: "rpg.will", secondaryStat: "rpg.physique", risk: 1, actionCost: 1, staminaCost: -18, fatigueDelta: -20, stressDelta: -12, statRewards: { "rpg.will": 1, "rpg.physique": 1 }, resourceRewards: { "status.health": 8, "status.mood": 6 }, questId: "growth.main", achievementId: "growth.balance" },
  { id: "grow-practice", mode: "cultivation", strategy: "steady", title: "基礎訓練與複盤", description: "針對最薄弱的環節反覆練習，建立可長期累積的穩定底盤。", consequence: "可靠、風險低；高能力階段的成長會自然遞減。", primaryStat: "rpg.technique", secondaryStat: "rpg.will", risk: 1, actionCost: 1, staminaCost: 10, fatigueDelta: 5, stressDelta: 1, statRewards: { "rpg.technique": 4, "rpg.will": 1 }, resourceRewards: { "growth.mastery": 3 }, questId: "growth.main", achievementId: "growth.discipline" },
  { id: "grow-study", mode: "cultivation", strategy: "steady", title: "研讀典籍與整理心得", description: "把新知識轉成自己的理解，避免只記住答案卻不懂規則。", consequence: "智慧與專注穩定提升；需要犧牲一段可社交的時間。", primaryStat: "rpg.intellect", secondaryStat: "rpg.creativity", risk: 1, actionCost: 1, staminaCost: 5, fatigueDelta: 3, stressDelta: -1, statRewards: { "rpg.intellect": 4, "rpg.creativity": 1 }, resourceRewards: { "status.focus": 4 }, questId: "growth.main", achievementId: "growth.scholar" },
  { id: "grow-bond", mode: "cultivation", strategy: "resource", title: "與重要人物共同修行", description: "用一次真實合作交換理解，讓能力與關係同時留下記憶。", consequence: "關係收益高；重複相同行動的效果會逐步降低。", primaryStat: "rpg.charisma", secondaryStat: "rpg.will", risk: 2, actionCost: 1, staminaCost: 7, fatigueDelta: 4, stressDelta: -2, statRewards: { "rpg.charisma": 4, "rpg.will": 2 }, resourceRewards: { "growth.bondEvents": 1 }, relationshipRewards: { "rpg.partyTrust": 5 }, questId: "growth.main", achievementId: "growth.companion" },
  { id: "grow-alchemy", mode: "cultivation", strategy: "resource", title: "精煉碎晶與藥材", description: "投入材料完成一次可驗證的煉製，交換靈石與後續修行資源。", consequence: "取得可交易資源；失敗會損耗材料但留下熟練度。", primaryStat: "rpg.creativity", secondaryStat: "rpg.intellect", risk: 3, actionCost: 1, staminaCost: 8, fatigueDelta: 5, stressDelta: 3, statRewards: { "rpg.creativity": 4, "rpg.intellect": 2 }, resourceRewards: { "item.spirit-shard": -2, "currency.spiritStone": 2, "growth.alchemy": 3 }, questId: "growth.main", achievementId: "growth.alchemist" },
  { id: "grow-performance", mode: "cultivation", strategy: "resource", title: "公開展示近期成果", description: "接受外界評價，以一次演出、比試或作品發表驗證成長。", consequence: "能提高聲望與機會；狀態不佳時壓力會快速累積。", primaryStat: "rpg.charisma", secondaryStat: "rpg.technique", risk: 3, actionCost: 1, staminaCost: 12, fatigueDelta: 7, stressDelta: 7, statRewards: { "rpg.charisma": 4, "rpg.technique": 2 }, resourceRewards: { "growth.popularity": 4, "currency.guildToken": 1 }, questId: "growth.main", achievementId: "growth.stage" },
  { id: "grow-breakthrough", mode: "cultivation", strategy: "bold", title: "挑戰境界突破", description: "在身心接近極限時整合全部修行成果，衝擊下一個成長階段。", consequence: "高風險、高成長；疲勞或健康不足時不會成為必勝選項。", primaryStat: "rpg.will", secondaryStat: "rpg.creativity", risk: 5, actionCost: 2, staminaCost: 22, fatigueDelta: 12, stressDelta: 10, statRewards: { "rpg.will": 5, "rpg.creativity": 4 }, resourceRewards: { "growth.realm": 5, "currency.spiritStone": -3 }, questId: "growth.main", achievementId: "growth.breakthrough" },
  { id: "grow-secret-route", mode: "cultivation", strategy: "bold", title: "追查隱藏成長路線", description: "放棄標準課表，追隨一條尚未被驗證但可能更適合角色的道路。", consequence: "可能開啟專屬路線；也可能浪費本階段的有限時間。", primaryStat: "rpg.intellect", secondaryStat: "rpg.will", risk: 4, actionCost: 2, staminaCost: 14, fatigueDelta: 8, stressDelta: 8, statRewards: { "rpg.intellect": 5, "rpg.will": 2 }, resourceRewards: { "growth.hiddenRoute": 1 }, questId: "growth.main", achievementId: "growth.pathmaker" },
  { id: "grow-crisis", mode: "cultivation", strategy: "bold", title: "在危機中實戰成長", description: "主動承擔高壓任務，把平時訓練轉成真正能改變局勢的能力。", consequence: "成長與故事推進最快；會消耗健康、體力與心理餘裕。", primaryStat: "rpg.physique", secondaryStat: "rpg.technique", risk: 4, actionCost: 2, staminaCost: 20, fatigueDelta: 11, stressDelta: 9, statRewards: { "rpg.physique": 5, "rpg.technique": 3 }, resourceRewards: { "status.health": -4, "growth.fieldExperience": 4 }, questId: "growth.main", achievementId: "growth.tempered" },

  { id: "biz-operations", mode: "management", strategy: "steady", title: "優化日常營運流程", description: "先修正瓶頸、排班與品質檢查，降低長期錯誤成本。", consequence: "短期收入有限；效率、士氣與穩定性會提高。", primaryStat: "rpg.intellect", secondaryStat: "rpg.will", risk: 1, actionCost: 1, staminaCost: 6, fatigueDelta: 3, stressDelta: 1, statRewards: { "rpg.intellect": 3, "rpg.will": 1 }, resourceRewards: { "management.employeeSkill": 2, "management.morale": 2, "management.risk": -2 }, questId: "management.survive90", achievementId: "management.system" },
  { id: "biz-service", mode: "management", strategy: "steady", title: "改善顧客服務與售後", description: "處理抱怨根因，讓一次修正能變成可重複的服務標準。", consequence: "投入時間換取滿意度與品牌信任。", primaryStat: "rpg.charisma", secondaryStat: "rpg.intellect", risk: 1, actionCost: 1, staminaCost: 5, fatigueDelta: 3, stressDelta: 2, statRewards: { "rpg.charisma": 3, "rpg.intellect": 1 }, resourceRewards: { "management.satisfaction": 5, "management.reputation": 2 }, questId: "management.survive90", achievementId: "management.service" },
  { id: "biz-training", mode: "management", strategy: "steady", title: "安排員工訓練與休整", description: "犧牲部分產能，換取團隊能力、士氣與留任率。", consequence: "今天少賺一些；未來產出與危機韌性更好。", primaryStat: "rpg.will", secondaryStat: "rpg.charisma", risk: 1, actionCost: 1, staminaCost: 4, fatigueDelta: 1, stressDelta: -2, statRewards: { "rpg.will": 2, "rpg.charisma": 2 }, resourceRewards: { "management.cash": -1800, "management.employeeSkill": 4, "management.morale": 4, "management.staffStamina": 5 }, questId: "management.survive90", achievementId: "management.mentor" },
  { id: "biz-client", mode: "management", strategy: "resource", title: "親自拜訪關鍵客戶", description: "用洞察與承諾換取訂單、情報及長期合作條件。", consequence: "可提高成交與聲望；過度承諾會增加後續壓力。", primaryStat: "rpg.charisma", secondaryStat: "rpg.intellect", risk: 2, actionCost: 1, staminaCost: 8, fatigueDelta: 5, stressDelta: 4, statRewards: { "rpg.charisma": 4, "rpg.intellect": 1 }, resourceRewards: { "management.cash": 5200, "management.reputation": 3, "management.risk": 1 }, questId: "management.survive90", achievementId: "management.deal" },
  { id: "biz-research", mode: "management", strategy: "resource", title: "研發新商品與服務", description: "投入資金與時間建立差異化，而不是只靠降價競爭。", consequence: "研發成功會提高技術與需求；失敗仍會留下可用知識。", primaryStat: "rpg.creativity", secondaryStat: "rpg.intellect", risk: 3, actionCost: 2, staminaCost: 10, fatigueDelta: 6, stressDelta: 5, statRewards: { "rpg.creativity": 4, "rpg.intellect": 2 }, resourceRewards: { "management.cash": -8000, "management.technology": 6, "management.baseDemand": 8 }, questId: "management.survive90", achievementId: "management.innovation" },
  { id: "biz-marketing", mode: "management", strategy: "resource", title: "推出精準行銷方案", description: "聚焦真正適合的客群，測試訊息、價格與轉換。", consequence: "可提高需求與市占；若產品品質不足會放大負評。", primaryStat: "rpg.creativity", secondaryStat: "rpg.charisma", risk: 3, actionCost: 2, staminaCost: 8, fatigueDelta: 5, stressDelta: 4, statRewards: { "rpg.creativity": 3, "rpg.charisma": 3 }, resourceRewards: { "management.cash": -5000, "management.marketShare": 3, "management.reputation": 2, "management.risk": 2 }, questId: "management.survive90", achievementId: "management.brand" },
  { id: "biz-expansion", mode: "management", strategy: "bold", title: "開設新據點擴張市場", description: "在現金流尚可時提前搶占位置，建立下一階段的成長空間。", consequence: "成功可大幅提高市占；管理複雜度與固定成本同步增加。", primaryStat: "rpg.charisma", secondaryStat: "rpg.will", risk: 5, actionCost: 3, staminaCost: 18, fatigueDelta: 10, stressDelta: 10, statRewards: { "rpg.charisma": 4, "rpg.will": 3 }, resourceRewards: { "management.cash": -25_000, "management.branches": 1, "management.marketShare": 6, "management.risk": 8 }, questId: "management.survive90", achievementId: "management.expansion" },
  { id: "biz-price-war", mode: "management", strategy: "bold", title: "正面迎戰價格戰", description: "短期讓利守住市場，再用效率與差異化爭取主導權。", consequence: "市占可能快速上升；毛利、品牌與現金流承受壓力。", primaryStat: "rpg.will", secondaryStat: "rpg.intellect", risk: 4, actionCost: 2, staminaCost: 14, fatigueDelta: 8, stressDelta: 9, statRewards: { "rpg.will": 4, "rpg.intellect": 2 }, resourceRewards: { "management.cash": -12_000, "management.marketShare": 5, "management.risk": 6, "management.reputation": -2 }, questId: "management.survive90", achievementId: "management.competitor" },
  { id: "biz-crisis", mode: "management", strategy: "bold", title: "親自接管重大危機", description: "集中權限處理客訴、供應中斷或公關事件，阻止損失擴大。", consequence: "成功可挽回信任；失敗仍會開啟重整與補救路線。", primaryStat: "rpg.will", secondaryStat: "rpg.charisma", risk: 5, actionCost: 3, staminaCost: 20, fatigueDelta: 12, stressDelta: 12, statRewards: { "rpg.will": 5, "rpg.charisma": 2 }, resourceRewards: { "management.cash": -6000, "management.risk": -12, "management.reputation": 5, "management.satisfaction": 4 }, questId: "management.survive90", achievementId: "management.crisis" },
];

const STRATEGY_LABELS: Record<RpgChoiceStrategy, string> = {
  steady: "穩健型",
  resource: "關係／資源型",
  bold: "冒險型",
};

function growthMultiplier(value: number, pace: RpgRuleSettings["growthPace"]) {
  const diminishing = value < 40 ? 1.2 : value < 60 ? 1 : value < 80 ? 0.75 : value < 90 ? 0.5 : 0.25;
  const paceMultiplier = pace === "fast" ? 1.25 : pace === "realistic" ? 0.75 : 1;
  return diminishing * paceMultiplier;
}

function statusModifier(snapshot: RpgProgressionSnapshot) {
  let modifier = 0;
  if (snapshot.status.fatigue >= 80) modifier -= 12;
  else if (snapshot.status.fatigue >= 60) modifier -= 6;
  if (snapshot.status.stress >= 70) modifier -= 5;
  if (snapshot.status.health < 30) modifier -= 10;
  if (snapshot.status.mood >= 75) modifier += 3;
  if (snapshot.status.focus >= 80) modifier += 3;
  return modifier;
}

function riskAdjustment(settings: RpgRuleSettings) {
  if (settings.randomness === "story") return -1;
  if (settings.randomness === "high_risk") return 1;
  return 0;
}

function canAfford(blueprint: ChoiceBlueprint, snapshot: RpgProgressionSnapshot) {
  if (blueprint.staminaCost > snapshot.status.stamina) return false;
  if ((blueprint.moneyChange ?? 0) < 0 && snapshot.currencies.gold < Math.abs(blueprint.moneyChange ?? 0)) return false;
  for (const [key, delta] of Object.entries(blueprint.resourceRewards)) {
    if (delta >= 0) continue;
    if (key === "management.cash" && snapshot.management.cash < Math.abs(delta)) return false;
    if (key === "currency.spiritStone" && snapshot.currencies.spiritStone < Math.abs(delta)) return false;
    if (key.startsWith("item.") && (snapshot.inventory.find((item) => `item.${item.itemId}` === key)?.quantity ?? 0) < Math.abs(delta)) return false;
  }
  return true;
}

function makeEffect(
  blueprint: ChoiceBlueprint,
  snapshot: RpgProgressionSnapshot,
  settings: RpgRuleSettings,
) {
  const statChanges = Object.fromEntries(Object.entries(blueprint.statRewards).map(([key, delta]) => [
    key,
    Math.max(1, Math.round((delta ?? 0) * growthMultiplier(snapshot.baseStats[key as RpgStatKey], settings.growthPace))),
  ]));
  const xpGain = Math.round(18 + blueprint.risk * 12 + snapshot.powerScore / 20);
  const daily = RPG_MODE_DEFINITIONS[blueprint.mode].dailyActionPoints;
  const remaining = snapshot.status.actionPoints - blueprint.actionCost;
  const dayAdvanced = remaining <= 0;
  const actionPointDelta = dayAdvanced
    ? daily - snapshot.status.actionPoints
    : -blueprint.actionCost;
  const resourceChanges: Record<string, number> = {
    ...blueprint.resourceRewards,
    "journey.mainlineMomentum": blueprint.mode === "adventure"
      ? 2 + blueprint.risk
      : 1 + Math.ceil(blueprint.risk / 2),
    [`journey.path.${blueprint.strategy}`]: 2 + blueprint.risk,
    "journey.worldFreedom": blueprint.strategy === "resource"
      ? 3
      : blueprint.strategy === "bold"
        ? 2
        : 1,
    "status.stamina": -blueprint.staminaCost,
    "status.fatigue": blueprint.fatigueDelta,
    "status.stress": blueprint.stressDelta,
    "game.actionPoints": actionPointDelta,
    "game.turn": 1,
    ...(dayAdvanced ? { "game.day": 1, "status.stamina": Math.max(-blueprint.staminaCost, 18 - blueprint.staminaCost) } : {}),
  };
  const effect: StoryChoiceEffect = {
    statChanges: { ...statChanges, "rpg.xp": xpGain },
    relationshipChanges: blueprint.relationshipRewards ?? {},
    resourceChanges,
    moneyChange: blueprint.moneyChange ?? 0,
    worldFlags: {
      "rpg.lastChoiceId": blueprint.id,
      "rpg.lastChoiceStrategy": blueprint.strategy,
      "rpg.lastMode": blueprint.mode,
      "rpg.journey.lastActivity": blueprint.id,
    },
    questProgress: { [blueprint.questId]: 6 + blueprint.risk * 2 },
    achievementProgress: { [blueprint.achievementId]: 16 + blueprint.risk * 4 },
    timelineEvents: [`第 ${snapshot.day} 日：${blueprint.title}`],
  };
  return { effect, xpGain };
}

function costLabels(blueprint: ChoiceBlueprint) {
  const labels = [`行動點 -${blueprint.actionCost}`];
  if (blueprint.staminaCost > 0) labels.push(`體力 -${blueprint.staminaCost}`);
  if (blueprint.staminaCost < 0) labels.push(`體力 +${Math.abs(blueprint.staminaCost)}`);
  if ((blueprint.moneyChange ?? 0) < 0) labels.push(`金幣 -${Math.abs(blueprint.moneyChange ?? 0)}`);
  for (const [key, delta] of Object.entries(blueprint.resourceRewards)) {
    if (delta >= 0) continue;
    if (key === "management.cash") labels.push(`資金 -${Math.abs(delta).toLocaleString("zh-TW")}`);
    if (key === "currency.spiritStone") labels.push(`靈石 -${Math.abs(delta)}`);
    if (key.startsWith("item.")) labels.push(`道具 -${Math.abs(delta)}`);
  }
  return labels;
}

function impactLabels(blueprint: ChoiceBlueprint, xpGain: number) {
  const labels = [`EXP +${xpGain}`];
  for (const [key, delta] of Object.entries(blueprint.statRewards)) {
    const label = RPG_STAT_DEFINITIONS.find((item) => item.key === key)?.label ?? key;
    labels.push(`${label} +${delta}`);
  }
  if (blueprint.relationshipRewards && Object.keys(blueprint.relationshipRewards).length) labels.push("人物關係");
  if (Object.keys(blueprint.resourceRewards).some((key) => key.startsWith("management."))) labels.push("公司狀態");
  return labels.slice(0, 4);
}

function blueprintToChoice(
  blueprint: ChoiceBlueprint,
  key: "A" | "B" | "C",
  snapshot: RpgProgressionSnapshot,
  settings: RpgRuleSettings,
  protagonist: string,
  chapterTitle: string,
) {
  const risk = clamp(blueprint.risk + riskAdjustment(settings), 1, 5) as 1 | 2 | 3 | 4 | 5;
  const successChance = computeSuccessChance({
    primary: snapshot.stats[blueprint.primaryStat],
    secondary: snapshot.stats[blueprint.secondaryStat],
    level: snapshot.level,
    risk,
    temporaryModifier: statusModifier(snapshot),
    teamBonus: Math.round((snapshot.management.morale - 50) / 20),
  });
  const { effect, xpGain } = makeEffect({ ...blueprint, risk }, snapshot, settings);
  return {
    id: blueprint.id,
    key,
    title: blueprint.title,
    approach: blueprint.strategy,
    strategyLabel: STRATEGY_LABELS[blueprint.strategy],
    description: blueprint.description,
    consequence: blueprint.consequence,
    primaryStat: blueprint.primaryStat,
    secondaryStat: blueprint.secondaryStat,
    risk,
    successChance,
    xpGain,
    actionCost: blueprint.actionCost,
    costLabels: costLabels(blueprint),
    impactLabels: impactLabels(blueprint, xpGain),
    effect,
    acceptedText: `【互動分支 ${key}｜${blueprint.title}】\n\n${protagonist}在「${chapterTitle}」選擇了${blueprint.description}`,
  } satisfies Omit<RpgChoice, "encounter">;
}

export function buildRpgChoices(input: {
  progression: RpgProgressionSnapshot;
  protagonist: string;
  chapterTitle: string;
  conflict: string;
  mode?: RpgMode;
  variant?: number;
  seed?: string;
  rules?: RpgRuleSettings;
}): RpgChoice[] {
  const mode = input.mode ?? input.progression.mode;
  const rules = normalizeRpgRuleSettings(input.rules);
  const protagonist = input.protagonist.trim() || "主角";
  const chapterTitle = input.chapterTitle.trim() || "目前章節";
  const seed = `${input.seed ?? ""}|${mode}|${input.progression.turn}|${input.variant ?? input.progression.choiceVariant}|${input.conflict}`;
  const strategies: RpgChoiceStrategy[] = ["steady", "resource", "bold"];
  const usedPrimaryStats = new Set<RpgStatKey>();
  return strategies.map((strategy, index) => {
    const candidates = CHOICE_POOL.filter((item) =>
      item.mode === mode && item.strategy === strategy && canAfford(item, input.progression));
    const fallback = CHOICE_POOL.filter((item) => item.mode === mode && item.strategy === strategy);
    const pool = candidates.length ? candidates : fallback;
    const start = (hashText(`${seed}|${strategy}`) + index) % pool.length;
    const blueprint = Array.from({ length: pool.length }, (_, offset) => pool[(start + offset) % pool.length])
      .find((candidate) => !usedPrimaryStats.has(candidate.primaryStat))
      ?? pool[start];
    usedPrimaryStats.add(blueprint.primaryStat);
    const baseChoice = blueprintToChoice(
      blueprint,
      (["A", "B", "C"] as const)[index],
      input.progression,
      rules,
      protagonist,
      chapterTitle,
    );
    const encounter = buildProceduralEncounter({
      runSeed: input.progression.procedural.runSeed,
      mode,
      turn: input.progression.turn,
      strategy,
      variant: input.variant ?? input.progression.choiceVariant,
      recentSignatures: input.progression.procedural.recentEncounterSignatures,
    });
    return {
      ...baseChoice,
      encounter,
      description: `${baseChoice.description} ${encounter.complication}`,
      acceptedText: `${baseChoice.acceptedText}\n\n事件預兆：${encounter.telegraph}\n世界變化：${encounter.locationShift}／${encounter.worldAspect}`,
    };
  });
}

export function buildCustomRpgChoice(input: {
  progression: RpgProgressionSnapshot;
  action: string;
  protagonist: string;
  chapterTitle: string;
  conflict: string;
  rules?: RpgRuleSettings;
}): RpgChoice {
  const action = input.action.trim();
  if (!action) throw Object.assign(new Error("請先輸入你想採取的行動。"), { code: "RPG_CUSTOM_ACTION_REQUIRED" });
  const statIndex = hashText(action) % RPG_STAT_DEFINITIONS.length;
  const secondaryIndex = (statIndex + 2 + hashText(`${action}|secondary`) % 3) % RPG_STAT_DEFINITIONS.length;
  const blueprint: ChoiceBlueprint = {
    id: `custom-${hashText(action).toString(16)}`,
    mode: input.progression.mode,
    strategy: "resource",
    title: action.length > 24 ? `${action.slice(0, 24)}…` : action,
    description: `${input.protagonist || "主角"}嘗試自訂行動：「${action}」，規則引擎會先計算代價與判定，再允許寫入故事。`,
    consequence: `自訂行動仍受「${input.conflict || "目前局勢"}」與正式 StoryState 約束，不會讓 AI 任意改數值。`,
    primaryStat: RPG_STAT_DEFINITIONS[statIndex].key,
    secondaryStat: RPG_STAT_DEFINITIONS[secondaryIndex].key,
    risk: 3,
    actionCost: 1,
    staminaCost: 8,
    fatigueDelta: 4,
    stressDelta: 3,
    statRewards: { [RPG_STAT_DEFINITIONS[statIndex].key]: 3 },
    resourceRewards: { "adventure.customActions": 1 },
    questId: input.progression.mode === "management" ? "management.survive90" : input.progression.mode === "cultivation" ? "growth.main" : "rpg.mainArc",
    achievementId: "rpg.freeWill",
  };
  const base = blueprintToChoice(
    blueprint,
    "A",
    input.progression,
    normalizeRpgRuleSettings(input.rules),
    input.protagonist,
    input.chapterTitle,
  );
  const encounter = buildProceduralEncounter({
    runSeed: input.progression.procedural.runSeed,
    mode: input.progression.mode,
    turn: input.progression.turn,
    strategy: "resource",
    variant: input.progression.choiceVariant + hashText(action),
    recentSignatures: input.progression.procedural.recentEncounterSignatures,
  });
  return {
    ...base,
    key: "custom",
    encounter,
    description: `${base.description} ${encounter.complication}`,
    acceptedText: `${base.acceptedText}\n\n事件預兆：${encounter.telegraph}\n世界變化：${encounter.locationShift}／${encounter.worldAspect}`,
  };
}

function scalePositiveMap(
  values: Record<string, number>,
  multiplier: number,
  preservePositive: (key: string) => boolean = () => false,
) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => {
    if (value <= 0 || preservePositive(key)) return [key, value];
    return [key, Math.max(multiplier > 0 ? 1 : 0, Math.round(value * multiplier))];
  }));
}

export function resolveRpgChoice(
  choice: RpgChoice,
  input: { seed: string; revision: number; recentEncounterSignatures?: string[]; turn?: number },
): RpgChoiceResolution {
  const roll = hashText(`${input.seed}|${input.revision}|${choice.id}|${choice.key}`) % 100 + 1;
  const criticalThreshold = Math.max(5, Math.round(choice.successChance * 0.12));
  const outcome: RpgOutcome = roll <= criticalThreshold
    ? "critical_success"
    : roll <= choice.successChance
      ? "success"
      : roll <= Math.min(98, choice.successChance + 15)
        ? "partial_success"
        : "failure";
  const multiplier = outcome === "critical_success" ? 1.45 : outcome === "success" ? 1 : outcome === "partial_success" ? 0.55 : 0.18;
  const outcomeLabel = {
    critical_success: "大成功",
    success: "成功",
    partial_success: "部分成功",
    failure: "失敗但故事繼續",
  }[outcome];
  const scaledEffect: StoryChoiceEffect = {
    ...choice.effect,
    statChanges: scalePositiveMap(choice.effect.statChanges, multiplier),
    relationshipChanges: scalePositiveMap(choice.effect.relationshipChanges, multiplier),
    resourceChanges: scalePositiveMap(
      choice.effect.resourceChanges,
      multiplier,
      (key) => key.startsWith("game.")
        || key === "status.fatigue"
        || key === "status.stress"
        || key === "management.risk",
    ),
    moneyChange: choice.effect.moneyChange > 0
      ? Math.round(choice.effect.moneyChange * multiplier)
      : choice.effect.moneyChange,
    worldFlags: {
      ...choice.effect.worldFlags,
      "rpg.lastOutcome": outcome,
      "rpg.lastRoll": roll,
    },
    questProgress: scalePositiveMap(choice.effect.questProgress, outcome === "failure" ? 0.2 : multiplier),
    achievementProgress: scalePositiveMap(choice.effect.achievementProgress, outcome === "failure" ? 0.2 : multiplier),
  };
  const effect = applyProceduralWorldPulse({
    effect: scaledEffect,
    encounter: choice.encounter,
    outcome,
    strategy: choice.approach,
    turn: input.turn ?? 0,
    recentSignatures: input.recentEncounterSignatures,
  });
  const continuation = {
    critical_success: "局勢比預期更快鬆動。主角不只取得原定成果，還看見一條先前被遮蔽的新路；這份額外優勢也讓下一個選擇更具分量。",
    success: "行動按照計畫產生效果，但新的結果同時改變了人物立場與世界狀態。主角必須根據這次真正留下的變化決定下一步。",
    partial_success: "目標只完成了一部分，代價卻已經付出。主角保住了能繼續前進的成果，也多出一個必須在後續處理的新問題。",
    failure: "原定目標沒有達成，付出的資源也無法收回；然而失敗揭露了新的線索與補救方向，故事不會在這裡被隨機切斷。",
  }[outcome];
  const acceptedText = [
    `【互動分支 ${choice.key === "custom" ? "自由行動" : choice.key}｜${choice.title}】`,
    `規則引擎判定：${outcomeLabel}（擲骰 ${roll}／成功率 ${choice.successChance}%）`,
    choice.description,
    `事件預兆：${choice.encounter.telegraph}`,
    `世界變化：${choice.encounter.locationShift}／${choice.encounter.worldAspect}`,
    continuation,
    `【本回合結算】${choice.costLabels.join("、")}；${choice.impactLabels.join("、")}。`,
  ].join("\n\n");
  return {
    choice,
    outcome,
    outcomeLabel,
    roll,
    successChance: choice.successChance,
    effect,
    acceptedText,
    summary: `${choice.title}：${outcomeLabel}（${roll}/${choice.successChance}）`,
  };
}

export function buildManagementSettlementEffect(snapshot: RpgProgressionSnapshot): StoryChoiceEffect {
  const management = snapshot.management;
  return {
    statChanges: { "rpg.xp": Math.max(8, Math.round(management.annualScore / 5)) },
    relationshipChanges: {},
    resourceChanges: {
      "management.cash": management.expectedNetProfit,
      "management.inventory": -management.expectedSales,
      "management.lastRevenue": management.expectedRevenue,
      "management.lastProfit": management.expectedNetProfit,
      "management.reputation": management.satisfaction >= 60 ? 1 : 0,
      "management.risk": management.expectedNetProfit < 0 ? 3 : -1,
      "journey.mainlineMomentum": 1,
      "journey.path.steady": 1,
      "journey.worldFreedom": 1,
      "game.day": 1,
      "game.turn": 1,
      "game.actionPoints": RPG_MODE_DEFINITIONS.management.dailyActionPoints - snapshot.status.actionPoints,
      "status.stamina": 12,
      "status.fatigue": -8,
    },
    moneyChange: 0,
    worldFlags: {
      "management.lastSettlement": `day-${snapshot.day}`,
      "management.cashFlowPositive": management.expectedNetProfit >= 0,
    },
    questProgress: { "management.survive90": 1 },
    achievementProgress: { "management.profitable": management.expectedNetProfit > 0 ? 3 : 0 },
    timelineEvents: [`第 ${snapshot.day} 日經營結算：淨利 ${management.expectedNetProfit}`],
  };
}

export function statLabel(key: string, mode: RpgMode = "adventure") {
  const definition = RPG_STAT_DEFINITIONS.find((item) => item.key === key);
  return definition?.labels[mode] ?? definition?.label ?? key;
}

export function rpgFormulaExplanation() {
  return {
    level: "等級 = floor(√(總經驗值 ÷ 100)) + 1，最高 99 級。",
    nextLevel: "到達等級 N 的累積經驗門檻 = 100 ×（N - 1）²。",
    power: "綜合戰力 = 加權能力值 × [1 + (等級 - 1) × 4%]；智慧 20%，體能／技巧／意志各 18%，魅力 16%，創造 10%。",
    success: "成功率 = 24 + 主能力×0.48 + 副能力×0.18 + 等級×1.2 + 狀態／裝備／團隊修正 - 風險×8，限制在 5%～95%。",
    growth: "能力成長採遞減倍率：0～39 ×1.2、40～59 ×1、60～79 ×0.75、80～89 ×0.5、90～99 ×0.25。",
    employee: "員工效率 = 技能×0.40 + 士氣×0.25 + 體力×0.20 + 職位適性×0.15。",
    demand: "實際需求 = 基礎需求 × 行銷係數 × 聲望係數 × 價格吸引力；銷量取需求、庫存與產能的最小值。",
    governance: "AI 只負責創作候選；規則引擎負責擲骰與數值。玩家核准後，正文、能力、任務、成就與分支才在同一筆 Approval Transaction 寫入。",
  };
}

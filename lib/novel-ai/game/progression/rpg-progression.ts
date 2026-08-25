import {
  RPG_FORMULA_V3,
  type ChoiceRequirement,
  type CultivationRealmState,
  type DelayedConsequence,
  type ResourceDelta,
  type RpgDerivedCultivationStats,
  type RpgStateV3,
  type RpgTurnSettlement,
  type StoryChoiceEffect,
  type StoryState,
} from "../../domain";
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
import {
  CULTIVATION_REALM_CATALOG_V3,
  buildRpgTurnSnapshot,
  computeCultivationDerivedStats,
  emptyRpgEffect,
  evaluateDelayedConsequences,
  mergeStoryEffects,
  readRpgStateV3,
} from "./xianxia-ruleset-v3";
import type { StoryPlayModeId } from "../../domain/play-mode";
import { managementInvestmentStrategy } from "../management-investments";
import { selectCultivationOpportunity } from "../cultivation-opportunities";

export const RPG_FORMULA_VERSION = RPG_FORMULA_V3;

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
  { itemId: "spirit-market-blade", name: "青鋒靈刃", category: "weapon", rarity: "rare", description: "坊市鑄師以五枚靈石標價的輕靈短刃，劍脊刻有導引靈力的細紋。", effectDescription: "取得後立即裝備；技巧 +7、靈力 +3，攻擊、速度與戰力依公式重新計算。", weight: 2.8, value: 1_250, slot: "weapon", statBonuses: { "rpg.technique": 7, "rpg.creativity": 3 } },
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
  cultivationDerived: RpgDerivedCultivationStats;
  rpgState: RpgStateV3;
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
  consequenceTeaser: string;
  requirements: ChoiceRequirement[];
  missingRequirements: ChoiceRequirement[];
  knownCosts: ResourceDelta[];
  internalSuccessChance: number;
  displayedChanceBand: string;
  primaryStat: RpgStatKey;
  secondaryStat: RpgStatKey;
  risk: 1 | 2 | 3 | 4 | 5;
  successChance: number;
  xpGain: number;
  actionCost: number;
  costLabels: string[];
  impactLabels: string[];
  effect: StoryChoiceEffect;
  immediateEffect: StoryChoiceEffect;
  failureEffect: StoryChoiceEffect;
  partialSuccessEffect: StoryChoiceEffect;
  successEffect: StoryChoiceEffect;
  criticalSuccessEffect: StoryChoiceEffect;
  delayedConsequenceRefs: string[];
  irreversibleWarning: string | null;
  hiddenInformationLevel: "none" | "partial" | "high";
  disabledReason: string | null;
  sourceSnapshot: import("../../domain").RpgTurnSnapshot;
  rulesetId: string;
  presetId: string | null;
  turnNumber: number;
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
  settlement: RpgTurnSettlement;
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

export function rpgConsequenceWorldFlagKey(choiceId: string) {
  return `rpg.consequenceTriggered.${hashText(choiceId).toString(16).padStart(8, "0")}`;
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
    "item.spirit-market-blade": 0,
    "item.traveler-armor": 1,
    "item.moon-pendant": 0,
    "item.spirit-shard": 8,
    "item.royal-pass": 0,
    "item.contract-seal": 1,
    "romance.eventProgress": 0,
    "romance.personalGrowth": 0,
    "management.cash": 100_000,
    "management.staff": 3,
    "management.employeeSkill": 52,
    "management.jobFit": 60,
    "management.staffStamina": 72,
    "management.morale": 65,
    "management.reputation": 20,
    "management.satisfaction": 50,
    "management.quality": 70,
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

export const RPG_PLAY_BASELINE_VERSION = "rpg-play-baseline-v1" as const;

/**
 * Materialize the same deterministic values that the read model previously
 * supplied only in memory.  A choice preview and the approval transaction must
 * evaluate the exact same resources; otherwise a fresh (or legacy empty)
 * StoryState can advertise a playable route that later fails as if every
 * resource were zero.
 *
 * Existing values always win.  The function is idempotent and deliberately
 * does not change revisions; repositories own that write boundary.
 */
export function materializeRpgStoryStateBaseline(
  storyState: StoryState,
  seed: string,
  mode: RpgMode,
): StoryState {
  const existingWorldFlags = storyState.worldFlags ?? {};
  const resourceDefaults = {
    ...initialRpgResources(),
    "game.actionPoints": RPG_MODE_DEFINITIONS[mode].dailyActionPoints,
  };
  const statDefaults = initialRpgStats(seed);
  const protagonistStats = {
    ...statDefaults,
    ...storyState.protagonistStats,
  };
  const resources = {
    ...resourceDefaults,
    ...storyState.resources,
  };
  const relationships = {
    "rpg.partyTrust": 10,
    "romance.affection": 10,
    "romance.trust": 10,
    ...storyState.relationships,
  };
  const worldFlags = {
    "rpg.initialized": true,
    "game.initialized": true,
    "rpg.runSeed": seed || "default-playthrough",
    "rpg.lastMode": mode,
    ...existingWorldFlags,
    "rpg.baselineVersion": RPG_PLAY_BASELINE_VERSION,
  };
  const changed = storyState.money === null
    || storyState.reputation === null
    || Object.keys(statDefaults).some((key) => storyState.protagonistStats[key] === undefined)
    || Object.keys(resourceDefaults).some((key) => storyState.resources[key] === undefined)
    || Object.keys(relationships).some((key) => storyState.relationships[key] === undefined)
    || existingWorldFlags["rpg.baselineVersion"] !== RPG_PLAY_BASELINE_VERSION;
  if (!changed) return storyState;
  return {
    ...storyState,
    protagonistStats,
    resources,
    money: storyState.money ?? 1_200,
    relationships,
    reputation: storyState.reputation ?? 20,
    worldFlags,
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
  realmLevel?: number;
  injury?: number;
  fatigue?: number;
  daoHeart?: number;
  mindDemon?: number;
  fate?: number;
  informationBonus?: number;
  terrainModifier?: number;
  oppositionGap?: number;
  difficulty?: "story" | "standard" | "hard" | "extreme";
}) {
  const difficultyPenalty = ({ story: -5, standard: 0, hard: 7, extreme: 14 } as const)[input.difficulty ?? "standard"];
  return clamp(Math.round(
    24
    + input.primary * 0.48
    + input.secondary * 0.18
    + input.level * 1.2
    + (input.temporaryModifier ?? 0)
    + (input.equipmentBonus ?? 0)
    + (input.teamBonus ?? 0)
    + (input.realmLevel ?? 0) * 0.65
    - (input.injury ?? 0) * 0.16
    - (input.fatigue ?? 0) * 0.1
    + ((input.daoHeart ?? 50) - 50) * 0.08
    - (input.mindDemon ?? 0) * 0.08
    + ((input.fate ?? 50) - 50) * 0.05
    + (input.informationBonus ?? 0)
    + (input.terrainModifier ?? 0)
    - (input.oppositionGap ?? 0)
    - difficultyPenalty
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
  Pick<StoryState, "resources" | "money" | "inventory" | "worldFlags" | "questStates" | "rpgState">
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
  const rpgState = readRpgStateV3({
    rpgState: storyState.rpgState,
    resources,
    worldFlags,
    protagonistStats: storyState.protagonistStats,
  });
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
    cultivationDerived: computeCultivationDerivedStats({
      stats,
      realm: rpgState.realm,
      meters: rpgState.meters,
    }),
    rpgState,
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
  worldFlags?: Record<string, boolean | string | number>;
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
  { id: "adv-market-blade", mode: "adventure", strategy: "resource", title: "到坊市購入青鋒靈刃", description: "向鑄師確認刃身、靈紋與來源後，以五枚靈石完成交易並立即換裝。", consequence: "靈石減少，青鋒靈刃進入背包並成為目前武器；攻擊、速度與綜合戰力會依裝備加成重新計算。", primaryStat: "rpg.intellect", secondaryStat: "rpg.charisma", risk: 1, actionCost: 1, staminaCost: 2, fatigueDelta: 1, stressDelta: -1, statRewards: { "rpg.intellect": 1 }, resourceRewards: { "currency.spiritStone": -5, "item.spirit-market-blade": 1 }, worldFlags: { "rpg.equipped.weapon": "spirit-market-blade", "rpg.lastEquipmentChange": "spirit-market-blade" }, questId: "rpg.mainArc", achievementId: "rpg.firstRareWeapon" },
  { id: "adv-black-market-intel", mode: "adventure", strategy: "resource", title: "潛入黑市交換禁忌情報", description: "以可追溯的金幣與身分風險換取稀缺情報，同時準備應付尾隨、假消息與勢力設局。", consequence: "即使交易成功也會累積黑市暴露，並在後續回合觸發追查或反情報危機。", primaryStat: "rpg.charisma", secondaryStat: "rpg.intellect", risk: 4, actionCost: 1, staminaCost: 7, fatigueDelta: 4, stressDelta: 6, moneyChange: -160, statRewards: { "rpg.charisma": 2, "rpg.intellect": 3 }, resourceRewards: { "knowledge.blackMarketIntel": 1, "risk.blackMarketExposure": 4 }, worldFlags: { "xianxia.blackMarketContacted": true }, questId: "rpg.mainArc", achievementId: "rpg.blackMarketWitness" },
  { id: "adv-breakthrough", mode: "adventure", strategy: "bold", title: "正面突破封鎖", description: "抓住守備變化的瞬間，以速度與力量直接打開缺口。", consequence: "推進最快、風險最高；失敗會消耗大量狀態。", primaryStat: "rpg.physique", secondaryStat: "rpg.technique", risk: 4, actionCost: 2, staminaCost: 18, fatigueDelta: 9, stressDelta: 5, statRewards: { "rpg.physique": 4, "rpg.technique": 3 }, resourceRewards: { "adventure.momentum": 3 }, questId: "rpg.mainArc", achievementId: "rpg.bold" },
  { id: "adv-forbidden-zone", mode: "adventure", strategy: "bold", title: "追入禁區奪取先機", description: "在敵人重整前追入未知區域，冒險換取稀有情報與世界線優勢。", consequence: "可能開啟隱藏路線；也可能受傷或觸發追捕。", primaryStat: "rpg.will", secondaryStat: "rpg.intellect", risk: 5, actionCost: 2, staminaCost: 16, fatigueDelta: 8, stressDelta: 8, statRewards: { "rpg.will": 5, "rpg.intellect": 2 }, resourceRewards: { "adventure.hiddenRoute": 1 }, questId: "rpg.mainArc", achievementId: "rpg.fatebreaker" },
  { id: "adv-duel", mode: "adventure", strategy: "bold", title: "挑戰關鍵強敵", description: "把衝突集中到一場可判定的對決，阻止局勢繼續擴散。", consequence: "成功可大幅提高聲望；失敗仍會產生可補救的新支線。", primaryStat: "rpg.technique", secondaryStat: "rpg.will", risk: 4, actionCost: 2, staminaCost: 20, fatigueDelta: 10, stressDelta: 6, statRewards: { "rpg.technique": 5, "rpg.will": 2 }, resourceRewards: { "adventure.renown": 4 }, questId: "rpg.mainArc", achievementId: "rpg.challenger" },

  { id: "grow-rest", mode: "cultivation", strategy: "steady", title: "調息與完整休養", description: "停下一次高強度行程，修復健康並整理最近的成長。", consequence: "能力成長較少，但能避免過勞與崩壞路線。", primaryStat: "rpg.will", secondaryStat: "rpg.physique", risk: 1, actionCost: 1, staminaCost: -18, fatigueDelta: -20, stressDelta: -12, statRewards: { "rpg.will": 1, "rpg.physique": 1 }, resourceRewards: { "status.health": 8, "status.mood": 6 }, questId: "growth.main", achievementId: "growth.balance" },
  { id: "grow-practice", mode: "cultivation", strategy: "steady", title: "基礎訓練與複盤", description: "針對最薄弱的環節反覆練習，建立可長期累積的穩定底盤。", consequence: "可靠、風險低；高能力階段的成長會自然遞減。", primaryStat: "rpg.technique", secondaryStat: "rpg.will", risk: 1, actionCost: 1, staminaCost: 10, fatigueDelta: 5, stressDelta: 1, statRewards: { "rpg.technique": 4, "rpg.will": 1 }, resourceRewards: { "growth.mastery": 3 }, questId: "growth.main", achievementId: "growth.discipline" },
  { id: "grow-study", mode: "cultivation", strategy: "steady", title: "研讀典籍與整理心得", description: "把新知識轉成自己的理解，避免只記住答案卻不懂規則。", consequence: "智慧與專注穩定提升；需要犧牲一段可社交的時間。", primaryStat: "rpg.intellect", secondaryStat: "rpg.creativity", risk: 1, actionCost: 1, staminaCost: 5, fatigueDelta: 3, stressDelta: -1, statRewards: { "rpg.intellect": 4, "rpg.creativity": 1 }, resourceRewards: { "status.focus": 4 }, questId: "growth.main", achievementId: "growth.scholar" },
  { id: "grow-bond", mode: "cultivation", strategy: "resource", title: "與重要人物共同修行", description: "用一次真實合作交換理解，讓能力與關係同時留下記憶。", consequence: "關係收益高；重複相同行動的效果會逐步降低。", primaryStat: "rpg.charisma", secondaryStat: "rpg.will", risk: 2, actionCost: 1, staminaCost: 7, fatigueDelta: 4, stressDelta: -2, statRewards: { "rpg.charisma": 4, "rpg.will": 2 }, resourceRewards: { "growth.bondEvents": 1 }, relationshipRewards: { "rpg.partyTrust": 5 }, questId: "growth.main", achievementId: "growth.companion" },
  { id: "grow-market-blade", mode: "cultivation", strategy: "resource", title: "到坊市購入青鋒靈刃", description: "向鑄師確認刃身、靈紋與來源後，以五枚靈石完成交易並立即換裝。", consequence: "靈石減少，青鋒靈刃進入背包並成為目前武器；攻擊、速度與綜合戰力會依裝備加成重新計算。", primaryStat: "rpg.intellect", secondaryStat: "rpg.charisma", risk: 1, actionCost: 1, staminaCost: 2, fatigueDelta: 1, stressDelta: -1, statRewards: { "rpg.intellect": 1 }, resourceRewards: { "currency.spiritStone": -5, "item.spirit-market-blade": 1 }, worldFlags: { "rpg.equipped.weapon": "spirit-market-blade", "rpg.lastEquipmentChange": "spirit-market-blade" }, questId: "growth.main", achievementId: "growth.firstRareWeapon" },
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

/**
 * Romance keeps the legacy `cultivation` progression mode for saved-project
 * compatibility, but its playable actions must advance the relationship
 * dashboard rather than silently selecting cultivation/equipment actions.
 */
const ROMANCE_CHOICE_POOL: ChoiceBlueprint[] = [
  { id: "career-rest-plan", mode: "cultivation", strategy: "steady", title: "重排日程並完整休息", description: "取消一項低價值行程，安排體能恢復與下週排程，避免疲勞拖垮通告與重要關係。", consequence: "短期少一次曝光；健康、情緒與後續表現更穩定。", primaryStat: "rpg.will", secondaryStat: "rpg.intellect", risk: 1, actionCost: 1, staminaCost: -12, fatigueDelta: -14, stressDelta: -10, statRewards: { "rpg.will": 2, "rpg.intellect": 1 }, resourceRewards: { "career.scheduleControl": 4, "career.publicImage": 1 }, relationshipRewards: { "romance.trust": 2 }, questId: "growth.main", achievementId: "career.balance" },
  { id: "career-training", mode: "cultivation", strategy: "steady", title: "安排專項訓練與驗收", description: "在歌唱、演技、舞蹈或鏡頭表現中挑一項弱點，完成訓練並用一次公開驗收確認成長。", consequence: "能力穩定上升；會占用本週可接通告的時間。", primaryStat: "rpg.technique", secondaryStat: "rpg.will", risk: 1, actionCost: 1, staminaCost: 8, fatigueDelta: 5, stressDelta: 1, statRewards: { "rpg.technique": 4, "rpg.will": 1 }, resourceRewards: { "career.skillGrowth": 5, "career.portfolio": 1 }, questId: "growth.main", achievementId: "career.training" },
  { id: "career-audition", mode: "cultivation", strategy: "resource", title: "參加試鏡並經營作品履歷", description: "研究製作需求、準備合適片段並完成試鏡；不論結果都留下可核對的評語、人脈與履歷。", consequence: "可能獲得通告與人氣；落選也會增加疲勞和自我懷疑。", primaryStat: "rpg.charisma", secondaryStat: "rpg.technique", risk: 3, actionCost: 1, staminaCost: 10, fatigueDelta: 7, stressDelta: 5, statRewards: { "rpg.charisma": 4, "rpg.technique": 2 }, resourceRewards: { "career.auditions": 1, "career.popularity": 4, "career.portfolio": 2 }, relationshipRewards: { "career.industryTrust": 3 }, questId: "growth.main", achievementId: "career.audition" },
  { id: "career-contract", mode: "cultivation", strategy: "resource", title: "談判通告與經紀合約", description: "逐條核對片酬、檔期、肖像授權、解約與保密條款，再決定簽約、修改或拒絕。", consequence: "能換取資源與曝光；不利條款會形成長期工作與關係債務。", primaryStat: "rpg.intellect", secondaryStat: "rpg.charisma", risk: 3, actionCost: 1, staminaCost: 5, fatigueDelta: 2, stressDelta: 4, statRewards: { "rpg.intellect": 4, "rpg.charisma": 3 }, resourceRewards: { "career.income": 5, "career.popularity": 3, "career.contractRisk": 2 }, relationshipRewards: { "career.industryTrust": 4 }, questId: "growth.main", achievementId: "career.contract" },
  { id: "career-live-stage", mode: "cultivation", strategy: "bold", title: "接下高曝光現場演出", description: "在準備時間不足的情況下接下直播、首演或大型活動，靠臨場表現爭取跨級曝光。", consequence: "成功可大幅提高人氣與作品機會；失誤也會被媒體與觀眾放大。", primaryStat: "rpg.creativity", secondaryStat: "rpg.charisma", risk: 5, actionCost: 2, staminaCost: 18, fatigueDelta: 12, stressDelta: 10, statRewards: { "rpg.creativity": 5, "rpg.charisma": 4 }, resourceRewards: { "career.popularity": 10, "career.publicImage": 5, "career.scandalRisk": 5 }, relationshipRewards: { "career.industryTrust": 3 }, questId: "growth.main", achievementId: "career.breakthrough" },
  { id: "career-public-romance", mode: "cultivation", strategy: "bold", title: "面對事業與感情的公開選擇", description: "在媒體、粉絲與合作方施壓時，和重要對象確認公開程度、界線與共同承擔的後果。", consequence: "真誠可能深化關係；人氣、合約與隱私也會同時承受壓力。", primaryStat: "rpg.will", secondaryStat: "rpg.charisma", risk: 4, actionCost: 2, staminaCost: 12, fatigueDelta: 7, stressDelta: 9, statRewards: { "rpg.will": 5, "rpg.charisma": 3 }, resourceRewards: { "career.publicImage": 4, "career.scandalRisk": 4, "romance.eventProgress": 8 }, relationshipRewards: { "romance.affection": 6, "romance.trust": 7 }, questId: "growth.main", achievementId: "career.boundaries" },
  { id: "romance-boundaries", mode: "cultivation", strategy: "steady", title: "坦白彼此界線", description: "選一個不受打擾的時刻說清楚期待與不能接受的事，再確認對方真正願意承擔的範圍。", consequence: "信任會穩定增加；被迴避的分歧也會因此浮上檯面。", primaryStat: "rpg.charisma", secondaryStat: "rpg.will", risk: 1, actionCost: 1, staminaCost: 4, fatigueDelta: 1, stressDelta: -3, statRewards: { "rpg.charisma": 3, "rpg.will": 2 }, resourceRewards: { "romance.eventProgress": 4, "romance.personalGrowth": 4 }, relationshipRewards: { "romance.affection": 3, "romance.trust": 6 }, questId: "growth.main", achievementId: "romance.honesty" },
  { id: "romance-repair", mode: "cultivation", strategy: "steady", title: "修補尚未解開的誤會", description: "先復述對方的感受，再為自己造成的傷害負責，提出一件今天就能做到的補救。", consequence: "關係重新取得安全感；必須放下立即辯解自己的衝動。", primaryStat: "rpg.will", secondaryStat: "rpg.charisma", risk: 1, actionCost: 1, staminaCost: 5, fatigueDelta: 2, stressDelta: -2, statRewards: { "rpg.will": 3, "rpg.charisma": 2 }, resourceRewards: { "romance.eventProgress": 6, "romance.personalGrowth": 4 }, relationshipRewards: { "romance.affection": 4, "romance.trust": 5 }, questId: "growth.main", achievementId: "romance.repair" },
  { id: "romance-space", mode: "cultivation", strategy: "steady", title: "給彼此一段喘息空間", description: "暫停追問與逼迫，把選擇權交還給對方，同時用一個明確約定保留下一次對話。", consequence: "壓力降低且界線更清楚；短期內不會立刻得到答案。", primaryStat: "rpg.intellect", secondaryStat: "rpg.will", risk: 1, actionCost: 1, staminaCost: 3, fatigueDelta: -1, stressDelta: -4, statRewards: { "rpg.intellect": 2, "rpg.will": 3 }, resourceRewards: { "romance.eventProgress": 4, "romance.personalGrowth": 5 }, relationshipRewards: { "romance.affection": 3, "romance.trust": 5 }, questId: "growth.main", achievementId: "romance.respect" },

  { id: "romance-shared-problem", mode: "cultivation", strategy: "resource", title: "共同處理眼前難題", description: "把兩人掌握的線索與資源攤開，分工完成一件任何一方獨自都做不到的事。", consequence: "共同經歷與默契同步累積；失敗時雙方也得一起承擔後果。", primaryStat: "rpg.intellect", secondaryStat: "rpg.charisma", risk: 2, actionCost: 1, staminaCost: 7, fatigueDelta: 4, stressDelta: 1, statRewards: { "rpg.intellect": 3, "rpg.charisma": 3 }, resourceRewards: { "romance.eventProgress": 8, "romance.personalGrowth": 5 }, relationshipRewards: { "romance.affection": 5, "romance.trust": 5 }, questId: "growth.main", achievementId: "romance.teamwork" },
  { id: "romance-promise", mode: "cultivation", strategy: "resource", title: "交換一項可兌現的承諾", description: "各自提出一項具體承諾、期限與退出條件，讓感情不只停留在沒有代價的漂亮話。", consequence: "親密感明顯提升；未履行的承諾會成為後續關係債務。", primaryStat: "rpg.charisma", secondaryStat: "rpg.will", risk: 2, actionCost: 1, staminaCost: 6, fatigueDelta: 3, stressDelta: 2, statRewards: { "rpg.charisma": 4, "rpg.will": 2 }, resourceRewards: { "romance.eventProgress": 7, "romance.personalGrowth": 5 }, relationshipRewards: { "romance.affection": 6, "romance.trust": 4 }, questId: "growth.main", achievementId: "romance.promise" },
  { id: "romance-ally", mode: "cultivation", strategy: "resource", title: "向可信同伴尋求協助", description: "邀請一位尊重雙方隱私的同伴提供情報或居中協調，但不把決定責任交給第三人。", consequence: "能打破僵局並補足盲點；兩人的秘密邊界必須重新確認。", primaryStat: "rpg.intellect", secondaryStat: "rpg.creativity", risk: 2, actionCost: 1, staminaCost: 5, fatigueDelta: 2, stressDelta: 1, statRewards: { "rpg.intellect": 3, "rpg.creativity": 3 }, resourceRewards: { "romance.eventProgress": 8, "romance.personalGrowth": 4 }, relationshipRewards: { "romance.affection": 4, "romance.trust": 6 }, questId: "growth.main", achievementId: "romance.support" },

  { id: "romance-heartbreak", mode: "cultivation", strategy: "bold", title: "直面最深的未解心結", description: "停止繞開最痛的那件事，說出害怕失去什麼，也讓對方有拒絕、沉默或離開的權利。", consequence: "可能讓關係跨過長期門檻；也可能確認彼此暫時無法同行。", primaryStat: "rpg.will", secondaryStat: "rpg.charisma", risk: 4, actionCost: 2, staminaCost: 14, fatigueDelta: 8, stressDelta: 7, statRewards: { "rpg.will": 5, "rpg.charisma": 3 }, resourceRewards: { "romance.eventProgress": 10, "romance.personalGrowth": 6 }, relationshipRewards: { "romance.affection": 6, "romance.trust": 5 }, questId: "growth.main", achievementId: "romance.courage" },
  { id: "romance-public-choice", mode: "cultivation", strategy: "bold", title: "在眾人面前表明立場", description: "當外界逼迫兩人互相切割時，公開承認自己的選擇，同時不替對方決定是否回應。", consequence: "關係獲得明確位置；聲望、家族或陣營壓力也會隨之逼近。", primaryStat: "rpg.charisma", secondaryStat: "rpg.will", risk: 4, actionCost: 2, staminaCost: 12, fatigueDelta: 7, stressDelta: 8, statRewards: { "rpg.charisma": 5, "rpg.will": 3 }, resourceRewards: { "romance.eventProgress": 9, "romance.personalGrowth": 6 }, relationshipRewards: { "romance.affection": 7, "romance.trust": 4 }, questId: "growth.main", achievementId: "romance.stand" },
  { id: "romance-truth", mode: "cultivation", strategy: "bold", title: "追問改變關係的真相", description: "抓住矛盾證詞中的破綻追問到底，承諾先聽完答案，再決定原諒、合作或分開。", consequence: "能終結長期猜疑並推進事件；真相可能徹底改寫彼此的距離。", primaryStat: "rpg.intellect", secondaryStat: "rpg.will", risk: 4, actionCost: 2, staminaCost: 13, fatigueDelta: 7, stressDelta: 8, statRewards: { "rpg.intellect": 5, "rpg.will": 4 }, resourceRewards: { "romance.eventProgress": 10, "romance.personalGrowth": 7 }, relationshipRewards: { "romance.affection": 5, "romance.trust": 7 }, questId: "growth.main", achievementId: "romance.truth" },
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

function availableResourceAmount(
  snapshot: RpgProgressionSnapshot,
  key: string,
): number | null {
  const statusKey = key.startsWith("status.")
    ? key.slice("status.".length) as keyof RpgStatusSnapshot
    : null;
  if (statusKey && statusKey in snapshot.status) return snapshot.status[statusKey];
  if (key === "game.actionPoints") return snapshot.status.actionPoints;
  if (key === "currency.gold") return snapshot.currencies.gold;
  if (key === "currency.spiritStone") return snapshot.currencies.spiritStone;
  if (key === "currency.guildToken") return snapshot.currencies.guildToken;
  const managementKey = key.startsWith("management.")
    ? key.slice("management.".length) as keyof ManagementSnapshot
    : null;
  if (managementKey && managementKey in snapshot.management) {
    return snapshot.management[managementKey];
  }
  if (key.startsWith("item.")) {
    return snapshot.inventory.find((item) => `item.${item.itemId}` === key)?.quantity ?? 0;
  }
  return null;
}

function canAfford(blueprint: ChoiceBlueprint, snapshot: RpgProgressionSnapshot) {
  if (blueprint.actionCost > snapshot.status.actionPoints) return false;
  if (blueprint.staminaCost > snapshot.status.stamina) return false;
  if ((blueprint.moneyChange ?? 0) < 0 && snapshot.currencies.gold < Math.abs(blueprint.moneyChange ?? 0)) return false;
  for (const [key, delta] of Object.entries(blueprint.resourceRewards)) {
    if (delta >= 0) continue;
    const available = availableResourceAmount(snapshot, key);
    if (available !== null && available < Math.abs(delta)) return false;
  }
  return true;
}

function affordableFallback(
  blueprint: ChoiceBlueprint,
  snapshot: RpgProgressionSnapshot,
): ChoiceBlueprint {
  return {
    ...blueprint,
    id: `${blueprint.id}-resource-safe-fallback`,
    title: blueprint.strategy === "steady"
      ? "收束風險整理退路"
      : blueprint.strategy === "resource"
        ? "盤點現有籌碼再布局"
        : "孤注一擲尋找破口",
    description: blueprint.strategy === "steady"
      ? "先收束眼前風險、整理情報與退路，在不透支資源的前提下穩定推進。"
      : blueprint.strategy === "resource"
        ? "重新盤點手邊可用的人情、情報與物資，以不新增負債的方式建立下一步布局。"
        : "在資源不足時改以決斷與現場判斷尋找唯一破口，保留失敗後仍可補救的退路。",
    consequence: blueprint.strategy === "bold"
      ? "風險仍高，但不會暗中透支現有資源。"
      : "進展較慢，但不會讓任何正式資源成為負數。",
    actionCost: Math.min(blueprint.actionCost, snapshot.status.actionPoints),
    staminaCost: blueprint.staminaCost > 0
      ? Math.min(blueprint.staminaCost, snapshot.status.stamina)
      : blueprint.staminaCost,
    moneyChange: Math.max(0, blueprint.moneyChange ?? 0),
    resourceRewards: Object.fromEntries(
      Object.entries(blueprint.resourceRewards).filter(([, delta]) => delta >= 0),
    ),
  };
}

function choiceRequirements(
  blueprint: ChoiceBlueprint,
): ChoiceRequirement[] {
  const requirements: ChoiceRequirement[] = [];
  if (blueprint.actionCost > 0) requirements.push({
    requirementId: `${blueprint.id}:action-points`,
    kind: "resource",
    key: "game.actionPoints",
    operator: "gte",
    value: blueprint.actionCost,
    label: `行動點至少 ${blueprint.actionCost}`,
    hard: true,
  });
  if (blueprint.staminaCost > 0) requirements.push({
    requirementId: `${blueprint.id}:stamina`,
    kind: "resource",
    key: "status.stamina",
    operator: "gte",
    value: blueprint.staminaCost,
    label: `體力至少 ${blueprint.staminaCost}`,
    hard: true,
  });
  if ((blueprint.moneyChange ?? 0) < 0) requirements.push({
    requirementId: `${blueprint.id}:money`,
    kind: "money",
    key: "money",
    operator: "gte",
    value: Math.abs(blueprint.moneyChange ?? 0),
    label: `金幣至少 ${Math.abs(blueprint.moneyChange ?? 0)}`,
    hard: true,
  });
  for (const [key, delta] of Object.entries(blueprint.resourceRewards)) {
    if (delta >= 0) continue;
    requirements.push({
      requirementId: `${blueprint.id}:${key}`,
      kind: "resource",
      key,
      operator: "gte",
      value: Math.abs(delta),
      label: `${key} 至少 ${Math.abs(delta)}`,
      hard: true,
    });
  }
  return requirements;
}

function missingRequirements(
  requirements: readonly ChoiceRequirement[],
  snapshot: RpgProgressionSnapshot,
) {
  return requirements.filter((requirement) => {
    const actual = requirement.kind === "money"
      ? snapshot.currencies.gold
      : availableResourceAmount(snapshot, requirement.key) ?? 0;
    const expected = Number(requirement.value);
    return requirement.operator === "gte"
      ? actual < expected
      : requirement.operator === "lte"
        ? actual > expected
        : actual !== expected;
  });
}

function knownCosts(blueprint: ChoiceBlueprint): ResourceDelta[] {
  const costs: ResourceDelta[] = [];
  if (blueprint.actionCost > 0) costs.push({ resourceId: "game.actionPoints", amount: -blueprint.actionCost, label: `行動點 -${blueprint.actionCost}`, reason: "本回合重大行動" });
  if (blueprint.staminaCost > 0) costs.push({ resourceId: "status.stamina", amount: -blueprint.staminaCost, label: `體力 -${blueprint.staminaCost}`, reason: "行動消耗" });
  if ((blueprint.moneyChange ?? 0) < 0) costs.push({ resourceId: "money", amount: blueprint.moneyChange ?? 0, label: `金幣 ${blueprint.moneyChange}`, reason: "已知交易成本" });
  for (const [key, delta] of Object.entries(blueprint.resourceRewards)) {
    if (delta >= 0) continue;
    costs.push({ resourceId: key, amount: delta, label: `${key} ${delta}`, reason: "已知資源成本" });
  }
  return costs;
}

function onlyImmediateCosts(effect: StoryChoiceEffect): StoryChoiceEffect {
  return {
    ...emptyRpgEffect(),
    statChanges: Object.fromEntries(Object.entries(effect.statChanges).filter(([, value]) => value < 0)),
    relationshipChanges: Object.fromEntries(Object.entries(effect.relationshipChanges).filter(([, value]) => value < 0)),
    resourceChanges: Object.fromEntries(Object.entries(effect.resourceChanges).filter(([key, value]) =>
      value < 0 || key.startsWith("game."))),
    moneyChange: Math.min(0, effect.moneyChange),
    worldFlags: effect.worldFlags,
    timelineEvents: effect.timelineEvents,
  };
}

function outcomeEffects(effect: StoryChoiceEffect, risk: number) {
  const scaled = (multiplier: number, outcome: RpgOutcome): StoryChoiceEffect => ({
    ...effect,
    statChanges: scalePositiveMap(effect.statChanges, multiplier),
    relationshipChanges: scalePositiveMap(effect.relationshipChanges, multiplier),
    resourceChanges: {
      ...scalePositiveMap(
        effect.resourceChanges,
        multiplier,
        (key) => key.startsWith("game.")
          || key === "status.fatigue"
          || key === "status.stress"
          || key === "management.risk",
      ),
      ...(outcome === "partial_success" ? {
        "status.stress": (effect.resourceChanges["status.stress"] ?? 0) + Math.max(1, risk),
        "meter.pursuit": Math.max(1, risk - 1),
      } : {}),
      ...(outcome === "failure" ? {
        "status.health": (effect.resourceChanges["status.health"] ?? 0) - Math.max(2, risk * 2),
        "status.stress": (effect.resourceChanges["status.stress"] ?? 0) + Math.max(2, risk * 2),
        "meter.injury": Math.max(1, risk * 2),
        "meter.pursuit": Math.max(1, risk),
      } : {}),
    },
    moneyChange: effect.moneyChange > 0 ? Math.round(effect.moneyChange * multiplier) : effect.moneyChange,
    questProgress: scalePositiveMap(effect.questProgress, outcome === "failure" ? 0.2 : multiplier),
    achievementProgress: scalePositiveMap(effect.achievementProgress, outcome === "failure" ? 0.2 : multiplier),
    worldFlags: { ...effect.worldFlags, "rpg.plannedOutcomeProfile": outcome },
  });
  return {
    failureEffect: scaled(0.18, "failure"),
    partialSuccessEffect: scaled(0.55, "partial_success"),
    successEffect: scaled(1, "success"),
    criticalSuccessEffect: scaled(1.45, "critical_success"),
  };
}

function displayedChanceBand(chance: number) {
  if (chance >= 80) return "很有把握（80% 以上）";
  if (chance >= 60) return "偏有利（60%～79%）";
  if (chance >= 40) return "勝負未定（40%～59%）";
  if (chance >= 20) return "偏不利（20%～39%）";
  return "機會渺茫（5%～19%）";
}

function boundedText(value: string, minimum: number, maximum: number, suffix: string) {
  const compact = value.replace(/\s+/gu, " ").trim();
  const characters = Array.from(compact);
  if (characters.length > maximum) return characters.slice(0, maximum).join("").replace(/[，、：；。]$/u, "");
  if (characters.length >= minimum) return compact;
  return Array.from(`${compact}${suffix}`).slice(0, maximum).join("");
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
      ...(blueprint.worldFlags ?? {}),
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
  sourceSnapshot: import("../../domain").RpgTurnSnapshot,
) {
  const risk = clamp(blueprint.risk + riskAdjustment(settings), 1, 5) as 1 | 2 | 3 | 4 | 5;
  const successChance = computeSuccessChance({
    primary: snapshot.stats[blueprint.primaryStat],
    secondary: snapshot.stats[blueprint.secondaryStat],
    level: snapshot.level,
    risk,
    temporaryModifier: statusModifier(snapshot),
    teamBonus: Math.round((snapshot.management.morale - 50) / 20),
    realmLevel: snapshot.rpgState.realm?.level ?? 0,
    injury: snapshot.rpgState.meters.injury,
    fatigue: snapshot.status.fatigue,
    daoHeart: snapshot.rpgState.meters.daoHeart,
    mindDemon: snapshot.rpgState.meters.mindDemon,
    fate: snapshot.rpgState.meters.fate,
    informationBonus: Math.min(8, snapshot.journey.gates.information.current),
    difficulty: snapshot.rpgState.difficulty,
  });
  const { effect, xpGain } = makeEffect({ ...blueprint, risk }, snapshot, settings);
  const requirements = choiceRequirements(blueprint);
  const missing = missingRequirements(requirements, snapshot);
  const outcomes = outcomeEffects(effect, risk);
  const consequenceTeaser = boundedText(blueprint.consequence, 12, 40, "，後續代價將由規則結算。");
  return {
    id: blueprint.id,
    key,
    title: boundedText(blueprint.title, 8, 18, "並承擔後果"),
    approach: blueprint.strategy,
    strategyLabel: STRATEGY_LABELS[blueprint.strategy],
    description: boundedText(blueprint.description, 30, 80, "，並依目前狀態承擔可驗證的代價與後續變化。"),
    consequence: consequenceTeaser,
    consequenceTeaser,
    requirements,
    missingRequirements: missing,
    knownCosts: knownCosts(blueprint),
    internalSuccessChance: successChance,
    displayedChanceBand: displayedChanceBand(successChance),
    primaryStat: blueprint.primaryStat,
    secondaryStat: blueprint.secondaryStat,
    risk,
    successChance,
    xpGain,
    actionCost: blueprint.actionCost,
    costLabels: costLabels(blueprint),
    impactLabels: impactLabels(blueprint, xpGain),
    effect,
    immediateEffect: onlyImmediateCosts(effect),
    ...outcomes,
    delayedConsequenceRefs: risk >= 3 ? [`delayed:${blueprint.id}`] : [],
    irreversibleWarning: risk >= 5 ? "此路線可能造成已明示的重大損失或長期敵對。" : null,
    hiddenInformationLevel: risk >= 4 ? "high" : risk >= 2 ? "partial" : "none",
    disabledReason: missing.length ? missing.map((item) => item.label).join("、") : null,
    sourceSnapshot,
    rulesetId: snapshot.rpgState.rulesetId,
    presetId: snapshot.rpgState.presetId,
    turnNumber: snapshot.turn + 1,
    acceptedText: `【互動分支 ${key}｜${blueprint.title}】\n\n${protagonist}在「${chapterTitle}」選擇了${blueprint.description}`,
  } satisfies Omit<RpgChoice, "encounter">;
}

export function buildRpgChoices(input: {
  progression: RpgProgressionSnapshot;
  protagonist: string;
  chapterTitle: string;
  conflict: string;
  mode?: RpgMode;
  playMode?: StoryPlayModeId;
  variant?: number;
  seed?: string;
  rules?: RpgRuleSettings;
  storyStateRevision?: number;
  storyState?: StoryState;
  narrativeAnchors?: {
    supportingCharacter?: string | null;
    unresolvedThread?: string | null;
    familyOrFaction?: string | null;
    storyAsset?: string | null;
    factionPressure?: string | null;
    worldContext?: string | null;
  };
  causalKnowledgeDigest?: string;
}): RpgChoice[] {
  const mode = input.mode ?? input.progression.mode;
  const rules = normalizeRpgRuleSettings(input.rules);
  const protagonist = input.protagonist.trim() || "主角";
  const chapterTitle = input.chapterTitle.trim() || "目前章節";
  const stateRevision = input.storyStateRevision ?? 0;
  const seed = `${input.seed ?? input.progression.procedural.runSeed}|${input.playMode ?? mode}|${input.progression.turn}|${stateRevision}|${input.variant ?? input.progression.choiceVariant}|${input.conflict}`;
  const permutations: readonly (readonly RpgChoiceStrategy[])[] = [
    ["steady", "resource", "bold"],
    ["steady", "bold", "resource"],
    ["resource", "steady", "bold"],
    ["resource", "bold", "steady"],
    ["bold", "steady", "resource"],
    ["bold", "resource", "steady"],
  ];
  const strategies = permutations[hashText(`${input.progression.procedural.runSeed}|${input.progression.turn}|${stateRevision}`) % permutations.length];
  const sourceSnapshot = input.storyState
    ? buildRpgTurnSnapshot({
        ...input.storyState,
        protagonistStats: {
          ...input.storyState.protagonistStats,
          ...input.progression.baseStats,
        },
      })
    : {
        schemaVersion: "rpg-turn-snapshot-v1" as const,
        storyStateRevision: stateRevision,
        turnNumber: input.progression.turn,
        realm: structuredClone(input.progression.rpgState.realm),
        meters: structuredClone(input.progression.rpgState.meters),
        stats: structuredClone(input.progression.baseStats),
        resources: {},
        relationships: {},
        strategicAssets: structuredClone(input.progression.rpgState.strategicAssets),
        pendingConsequences: structuredClone(input.progression.rpgState.pendingConsequences),
      };
  const usedPrimaryStats = new Set<RpgStatKey>();
  const usedEncounterSignatures = new Set(
    input.progression.procedural.recentEncounterSignatures,
  );
  const conflictFocus = input.conflict.trim().replace(/\s+/g, " ").slice(0, 36)
    || `${chapterTitle}目前的阻力`;
  const strategyMarkers: Record<RpgChoiceStrategy, string> = {
    steady: "穩守",
    resource: "借勢",
    bold: "突破",
  };
  const supportingCharacter = input.narrativeAnchors?.supportingCharacter?.trim();
  const unresolvedThread = input.narrativeAnchors?.unresolvedThread?.trim();
  const familyOrFaction = input.narrativeAnchors?.familyOrFaction?.trim();
  const storyAsset = input.narrativeAnchors?.storyAsset?.trim();
  const factionPressure = input.narrativeAnchors?.factionPressure?.trim();
  const worldContext = input.narrativeAnchors?.worldContext?.trim() ?? "";
  const cultivationWorld = /修仙|仙俠|修真|宗門|煉氣|築基|金丹|元嬰|靈脈|坊市|玄幻/iu.test(worldContext);
  const entertainmentWorld = /明星|演藝|娛樂圈|經紀公司|偶像|歌手|演員|試鏡|通告|戲班|樂坊/iu.test(worldContext);
  const availableInventory = input.progression.inventory.find((item) => item.quantity > 0)?.name;
  const choicePool = input.playMode === "romance" ? ROMANCE_CHOICE_POOL : CHOICE_POOL;
  const storyProps: Record<RpgMode, Record<RpgChoiceStrategy, string>> = {
    adventure: {
      steady: familyOrFaction
        ? `${familyOrFaction}與${supportingCharacter || "同行者"}守住的退路`
        : supportingCharacter ? `${supportingCharacter}的態度與現場退路` : "現場線索與退路",
      resource: storyAsset || availableInventory || "現有裝備",
      bold: factionPressure
        ? `勢力暗流「${factionPressure}」${unresolvedThread ? `與未解線索「${unresolvedThread}」` : ""}`
        : unresolvedThread ? `未解線索「${unresolvedThread}」` : "對手剛暴露的破綻",
    },
    cultivation: {
      steady: familyOrFaction
        ? `${familyOrFaction}與${supportingCharacter || "同行者"}目前願意交付的信任`
        : supportingCharacter ? `${supportingCharacter}目前願意交付的信任` : "彼此已建立的信任",
      resource: storyAsset || availableInventory || "尚未兌現的承諾",
      bold: factionPressure
        ? `勢力暗流「${factionPressure}」${unresolvedThread ? `與尚未說清的心結「${unresolvedThread}」` : ""}`
        : unresolvedThread ? `尚未說清的心結「${unresolvedThread}」` : "關係轉折的關鍵時機",
    },
    management: {
      steady: familyOrFaction
        ? `${familyOrFaction}與${supportingCharacter || "團隊代表"}共同守住的品質標準`
        : supportingCharacter ? `${supportingCharacter}與現有團隊的品質標準` : "現有團隊與品質標準",
      resource: storyAsset
        ? `${storyAsset}與可調度資金 ${input.progression.management.cash.toLocaleString("zh-TW")}`
        : `可調度資金 ${input.progression.management.cash.toLocaleString("zh-TW")} 與 ${input.progression.management.staff} 名人力`,
      bold: factionPressure
        ? `勢力暗流「${factionPressure}」${unresolvedThread ? `與尚未化解的營運危機「${unresolvedThread}」` : ""}`
        : unresolvedThread ? `尚未化解的營運危機「${unresolvedThread}」` : "市場窗口與品牌聲量",
    },
  };
  const fallbackAction: Record<RpgChoiceStrategy, { title: string; description: string }> = {
    steady: {
      title: supportingCharacter
        ? `與${supportingCharacter}守住現場證據`
        : `守住現場與既有證據`,
      description: familyOrFaction
        ? `請${familyOrFaction}先保住退路與目擊者，逐一核對剛才行動留下的結果，不讓對手趁混亂抹去證據`
        : `先保住退路與目擊者，逐一核對剛才行動留下的結果，不讓對手趁混亂抹去證據`,
    },
    resource: {
      title: `調度${storyAsset || (cultivationWorld ? availableInventory : null) || "已登錄資源"}換取主動`,
      description: `動用${storyProps[mode].resource}與${supportingCharacter || "可信同伴"}交涉，換取能處理眼前後果的時間、情報或公開承諾`,
    },
    bold: {
      title: unresolvedThread
        ? `逼近「${unresolvedThread}」的破口`
        : `逼迫對手當場露出破口`,
      description: factionPressure
        ? `趁「${factionPressure}」尚未完成布局，沿本回合新出現的痕跡正面施壓，迫使真正阻力提前現身`
        : `沿本回合新出現的痕跡正面施壓，迫使真正阻力提前現身並承擔可見後果`,
    },
  };
  if (mode === "management") {
    for (const strategy of ["steady", "resource", "bold"] as const) {
      const investment = managementInvestmentStrategy(worldContext, strategy);
      fallbackAction[strategy] = {
        title: `${strategyMarkers[strategy]}投資「${investment.asset.name}」`,
        description: `${investment.action}；流動性${investment.asset.liquidity}、收益週期${investment.asset.returnCycle}，並同步記錄${investment.asset.stakeholders}的權利與代價`,
      };
    }
  }
  if (cultivationWorld && mode !== "management" && input.playMode !== "romance") {
    for (const strategy of ["steady", "resource", "bold"] as const) {
      const opportunity = selectCultivationOpportunity({
        seed,
        turn: input.progression.turn,
        strategy,
      });
      fallbackAction[strategy] = {
        title: `${strategyMarkers[strategy]}參與「${opportunity.name}」`,
        description: `先核對${opportunity.entryCost}與境界資格，再以${storyProps[mode][strategy]}參與「${opportunity.name}」；可能取得${opportunity.rewards.slice(0, 2).join("、")}，也會承擔${opportunity.risks.slice(0, 2).join("、")}`,
      };
    }
  }
  return strategies.map((strategy, index) => {
    const storyCompatible = (item: ChoiceBlueprint) => cultivationWorld || ![
      "adv-market-blade",
      "adv-craft",
      "adv-bounty",
      "grow-market-blade",
      "grow-alchemy",
      "grow-breakthrough",
    ].includes(item.id);
    const topicCompatible = (item: ChoiceBlueprint) => !item.id.startsWith("career-") || entertainmentWorld;
    const candidates = choicePool.filter((item) =>
      item.mode === mode && item.strategy === strategy && storyCompatible(item) && topicCompatible(item) && canAfford(item, input.progression));
    const fallback = choicePool.filter((item) =>
      item.mode === mode && item.strategy === strategy && storyCompatible(item) && topicCompatible(item));
    const pool = candidates.length ? candidates : fallback;
    const start = (hashText(`${seed}|${strategy}`) + index) % pool.length;
    const selected = Array.from({ length: pool.length }, (_, offset) => pool[(start + offset) % pool.length])
      .find((candidate) => !usedPrimaryStats.has(candidate.primaryStat))
      ?? pool[start];
    const blueprint = canAfford(selected, input.progression)
      ? selected
      : affordableFallback(selected, input.progression);
    usedPrimaryStats.add(blueprint.primaryStat);
    const baseChoice = blueprintToChoice(
      blueprint,
      (["A", "B", "C"] as const)[index],
      input.progression,
      rules,
      protagonist,
      chapterTitle,
      sourceSnapshot,
    );
    const encounter = buildProceduralEncounter({
      runSeed: input.progression.procedural.runSeed,
      mode,
      turn: input.progression.turn,
      strategy,
      variant: input.variant ?? input.progression.choiceVariant,
      recentSignatures: [...usedEncounterSignatures],
      causalKnowledgeDigest: input.causalKnowledgeDigest,
    });
    usedEncounterSignatures.add(encounter.signature);
    const contextualTitle = `${strategyMarkers[strategy]}｜${encounter.title}：${fallbackAction[strategy].title}`;
    const pressureLead = factionPressure ? `面對「${factionPressure}」時，` : "";
    const threadLead = unresolvedThread ? `處理「${unresolvedThread}」時，` : "";
    const strategicAnchor = strategy === "resource"
      ? storyAsset || familyOrFaction
      : familyOrFaction || storyAsset;
    const castLead = supportingCharacter
      ? `${protagonist}與${supportingCharacter}`
      : protagonist;
    const anchorLead = strategicAnchor
      ? `${castLead}以「${strategicAnchor}」為本次行動核心，`
      : `${castLead}先承接眼前局勢，`;
    const contextualDescription = `${anchorLead}承接「${conflictFocus}」，${pressureLead}${threadLead}${fallbackAction[strategy].description}；${encounter.complication}`;
    const managementInvestment = mode === "management"
      ? managementInvestmentStrategy(worldContext, strategy)
      : null;
    const contextualEffect = managementInvestment ? {
      ...baseChoice.effect,
      resourceChanges: {
        ...baseChoice.effect.resourceChanges,
        [`management.investment.${managementInvestment.asset.id}`]: 1,
      },
      worldFlags: {
        ...baseChoice.effect.worldFlags,
        "management.investment.lastId": managementInvestment.asset.id,
        "management.investment.lastLiquidity": managementInvestment.asset.liquidity,
        "management.investment.returnCycle": managementInvestment.asset.returnCycle,
      },
      timelineEvents: [
        ...baseChoice.effect.timelineEvents,
        `投資決策：${managementInvestment.asset.name}；持有人、利害關係人、流動性與退出條件已登錄。`,
      ],
    } : baseChoice.effect;
    return {
      ...baseChoice,
      id: `${baseChoice.id}:turn-${input.progression.turn}:variant-${input.variant ?? input.progression.choiceVariant}:${encounter.signature.slice(0, 12)}`,
      title: boundedText(contextualTitle, 8, 24, "並承擔後果"),
      encounter,
      description: boundedText(contextualDescription, 30, 100, "，結果將由規則引擎先行結算。"),
      effect: contextualEffect,
      impactLabels: managementInvestment
        ? [...baseChoice.impactLabels.filter((item) => item !== "公司狀態"), `${managementInvestment.asset.category}資產`].slice(0, 4)
        : baseChoice.impactLabels,
      acceptedText: `${baseChoice.acceptedText}\n\n事件預兆：${encounter.telegraph}\n世界變化：${encounter.locationShift}／${encounter.worldAspect}${managementInvestment ? `\n投資標的：${managementInvestment.asset.name}｜流動性 ${managementInvestment.asset.liquidity}｜收益週期 ${managementInvestment.asset.returnCycle}` : ""}`,
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
  storyState?: StoryState;
  causalKnowledgeDigest?: string;
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
    input.storyState
      ? buildRpgTurnSnapshot(input.storyState)
      : {
          schemaVersion: "rpg-turn-snapshot-v1",
          storyStateRevision: 0,
          turnNumber: input.progression.turn,
          realm: structuredClone(input.progression.rpgState.realm),
          meters: structuredClone(input.progression.rpgState.meters),
          stats: structuredClone(input.progression.baseStats),
          resources: {},
          relationships: {},
          strategicAssets: structuredClone(input.progression.rpgState.strategicAssets),
          pendingConsequences: structuredClone(input.progression.rpgState.pendingConsequences),
        },
  );
  const encounter = buildProceduralEncounter({
    runSeed: input.progression.procedural.runSeed,
    mode: input.progression.mode,
    turn: input.progression.turn,
    strategy: "resource",
    variant: input.progression.choiceVariant + hashText(action),
    recentSignatures: input.progression.procedural.recentEncounterSignatures,
    causalKnowledgeDigest: input.causalKnowledgeDigest,
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
  input: {
    seed: string;
    revision: number;
    recentEncounterSignatures?: string[];
    turn?: number;
    storyState?: StoryState;
  },
): RpgChoiceResolution {
  const roll = hashText(`${input.seed}|${input.revision}|${choice.id}|${choice.key}`) % 100 + 1;
  // Keep every advertised outcome reachable, including at the 5% minimum
  // success chance.  A fixed 5-point critical floor used to consume the whole
  // success band (`1..5`), so an otherwise valid deterministic roll could
  // never produce ordinary success.  The roll itself is unchanged: identical
  // seed/revision/choice inputs therefore remain reproducible.
  const criticalThreshold = Math.max(
    1,
    Math.min(
      choice.successChance - 1,
      Math.max(5, Math.round(choice.successChance * 0.12)),
    ),
  );
  const outcome: RpgOutcome = roll <= criticalThreshold
    ? "critical_success"
    : roll <= choice.successChance
      ? "success"
      : roll <= Math.min(98, choice.successChance + 15)
        ? "partial_success"
        : "failure";
  const outcomeLabel = {
    critical_success: "大成功",
    success: "成功",
    partial_success: "部分成功",
    failure: "失敗但故事繼續",
  }[outcome];
  const isPostArcAction = Boolean(choice.encounter.arcNextAction);
  const outcomeEffect = outcome === "critical_success"
    ? choice.criticalSuccessEffect
    : outcome === "success"
      ? choice.successEffect
      : outcome === "partial_success"
        ? choice.partialSuccessEffect
        : choice.failureEffect;
  const nextTurn = (input.turn ?? choice.sourceSnapshot.turnNumber) + 1;
  const triggeredConsequences = input.storyState && !isPostArcAction
    ? evaluateDelayedConsequences({ storyState: input.storyState, nextTurn, seed: input.seed })
    : [];
  const triggeredEffects = triggeredConsequences.map((item) => item.effects.storyEffect);
  const governedEffect = mergeStoryEffects([
    {
      ...outcomeEffect,
      worldFlags: {
        ...outcomeEffect.worldFlags,
        "rpg.lastOutcome": outcome,
        "rpg.lastRoll": roll,
      },
    },
    ...triggeredEffects,
  ]);
  const effect = applyProceduralWorldPulse({
    effect: governedEffect,
    encounter: choice.encounter,
    outcome,
    strategy: choice.approach,
    turn: input.turn ?? 0,
    recentSignatures: input.recentEncounterSignatures,
  });
  const sourceRealm = choice.sourceSnapshot.realm;
  const isBreakthrough = choice.id.includes("breakthrough");
  const realmChange = (() => {
    if (isPostArcAction) return null;
    if (!isBreakthrough || !sourceRealm) return null;
    const progressDelta = outcome === "critical_success"
      ? 90
      : outcome === "success"
        ? 65
        : outcome === "partial_success"
          ? 28
          : -12;
    if (outcome === "failure") {
      const progress = Math.max(0, sourceRealm.progress + progressDelta);
      return {
        from: structuredClone(sourceRealm),
        to: {
          ...sourceRealm,
          progress,
          stage: (progress >= 85 ? "peak" : progress >= 60 ? "late" : progress >= 30 ? "middle" : "early") as CultivationRealmState["stage"],
          foundationIntegrity: Math.max(0, sourceRealm.foundationIntegrity - choice.risk * 3),
        },
        progressDelta,
        breakthrough: false,
      };
    }
    const accumulated = sourceRealm.progress + progressDelta;
    if (accumulated < 100 || outcome === "partial_success") {
      const progress = Math.min(outcome === "partial_success" ? 99 : 100, accumulated);
      return {
        from: structuredClone(sourceRealm),
        to: {
          ...sourceRealm,
          progress,
          stage: (progress >= 85 ? "peak" : progress >= 60 ? "late" : progress >= 30 ? "middle" : "early") as CultivationRealmState["stage"],
        },
        progressDelta,
        breakthrough: false,
      };
    }
    const currentIndex = Math.max(0, CULTIVATION_REALM_CATALOG_V3.findIndex((item) => item.id === sourceRealm.definitionId));
    const nextDefinition = CULTIVATION_REALM_CATALOG_V3[Math.min(currentIndex + 1, CULTIVATION_REALM_CATALOG_V3.length - 1)];
    const level = nextDefinition.id === sourceRealm.definitionId
      ? sourceRealm.level + 1
      : nextDefinition.levelRange[0];
    return {
      from: structuredClone(sourceRealm),
      to: {
        definitionId: nextDefinition.id,
        level,
        stage: "early" as const,
        progress: Math.min(35, accumulated - 100),
        foundationIntegrity: Math.max(1, Math.min(100, sourceRealm.foundationIntegrity + (outcome === "critical_success" ? 4 : 0))),
        lastBreakthroughTurn: nextTurn,
      },
      progressDelta,
      breakthrough: nextDefinition.id !== sourceRealm.definitionId,
    };
  })();
  const outcomeMeterChanges: Partial<Record<keyof import("../../domain").NarrativeMeterState, number>> = isPostArcAction
    ? {}
    : outcome === "critical_success"
    ? { daoHeart: 3, fate: 2, injury: -Math.max(1, choice.risk - 1), mindDemon: -1 }
    : outcome === "success"
      ? { daoHeart: 1, fate: 1, injury: -1 }
      : outcome === "partial_success"
        ? { daoHeart: 1, mindDemon: 2, pursuit: Math.max(1, choice.risk - 1), injury: Math.max(1, choice.risk - 2) }
        : { mindDemon: Math.max(2, choice.risk), pursuit: Math.max(1, choice.risk), injury: Math.max(2, choice.risk * 2), daoHeart: -1 };
  if (choice.approach === "bold") outcomeMeterChanges.worldAttention = (outcomeMeterChanges.worldAttention ?? 0) + choice.risk;
  if (choice.approach === "resource") outcomeMeterChanges.sectReputation = (outcomeMeterChanges.sectReputation ?? 0) + (outcome === "failure" ? -2 : 1);
  for (const consequence of triggeredConsequences) {
    for (const [key, value] of Object.entries(consequence.effects.meterChanges)) {
      const meter = key as keyof import("../../domain").NarrativeMeterState;
      outcomeMeterChanges[meter] = (outcomeMeterChanges[meter] ?? 0) + (value ?? 0);
    }
  }
  const scheduledConsequences: DelayedConsequence[] = !isPostArcAction && choice.risk >= 3 ? [{
    consequenceId: `consequence:${hashText(`${input.seed}|${choice.id}|${nextTurn}`).toString(16)}`,
    sourceTurnReceiptId: "pending",
    triggerType: "turn_range",
    triggerTurn: [nextTurn + 2, nextTurn + 5],
    triggerCondition: { sourceChoiceId: choice.id, chance: choice.approach === "bold" ? 0.7 : 0.45 },
    visibility: choice.hiddenInformationLevel === "high" ? "foreshadowed" : "known",
    status: "pending",
    effects: {
      storyEffect: {
        ...emptyRpgEffect(),
        resourceChanges: { "meter.pursuit": Math.max(1, choice.risk - 1) },
        worldFlags: { [rpgConsequenceWorldFlagKey(choice.id)]: true },
        timelineEvents: [`延遲後果：${choice.title}`],
      },
      meterChanges: choice.approach === "bold"
        ? { pursuit: choice.risk, worldAttention: Math.max(1, choice.risk - 1) }
        : { mindDemon: 1, karma: 1 },
    },
    narrativeHint: choice.approach === "bold"
      ? "高風險行動留下的痕跡，可能在兩至五回合內引來追索。"
      : "這次交換形成了尚未清償的義務，後續可能有人要求回報。",
    createdAt: "pending",
    resolvedAt: null,
  }] : [];
  const settlement: RpgTurnSettlement = {
    schemaVersion: "rpg-turn-settlement-v1",
    formulaVersion: RPG_FORMULA_VERSION,
    rulesetId: choice.rulesetId,
    presetId: choice.presetId,
    turnNumber: nextTurn,
    choiceKey: choice.key,
    choiceId: choice.id,
    choiceTitle: choice.title,
    selectedStrategy: choice.approach,
    requirements: structuredClone(choice.requirements),
    outcome,
    roll,
    successChance: choice.successChance,
    beforeSnapshot: structuredClone(choice.sourceSnapshot),
    resolvedEffect: structuredClone(effect),
    meterChanges: outcomeMeterChanges,
    realmChange,
    triggeredConsequences: structuredClone(triggeredConsequences),
    scheduledConsequences,
  };
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
    settlement,
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

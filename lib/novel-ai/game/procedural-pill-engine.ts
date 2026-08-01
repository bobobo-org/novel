import type { CharacterRpgStatKey, StoryChoiceEffect } from "../domain";

export const PROCEDURAL_PILL_ENGINE_VERSION = "xianxia-pill-formula-v1" as const;

export type PillFamily = "recovery" | "breakthrough" | "body" | "spirit" | "insight" | "antidote" | "fate" | "concealment";
export type PillGrade = "凡品" | "靈品" | "玄品" | "地品" | "天品" | "禁品";

export type ProceduralPillProfile = {
  formulaVersion: typeof PROCEDURAL_PILL_ENGINE_VERSION;
  batchId: string;
  family: PillFamily;
  grade: PillGrade;
  potency: number;
  stability: number;
  shelfLife: number;
  primaryEffect: string;
  secondaryEffect: string;
  sideEffect: string;
  contraindication: string;
  originFaction: string;
  storyHook: string;
};

export type ProceduralPillItem = {
  itemId: string;
  name: string;
  category: "consumable";
  rarity: "common" | "uncommon" | "rare" | "epic";
  description: string;
  effectDescription: string;
  weight: number;
  value: number;
  slot: null;
  statBonuses: Partial<Record<CharacterRpgStatKey, number>>;
  proceduralPill: ProceduralPillProfile;
};

export type ProceduralPillResolution = {
  result: "perfect" | "effective" | "unstable" | "adverse";
  resultLabel: string;
  compatibility: number;
  potencyMultiplier: number;
  sideEffectTriggered: boolean;
  effect: StoryChoiceEffect;
  summary: string;
};

const PREFIXES = ["太乙", "星辰", "月華", "玄冰", "赤霄", "青冥", "紫府", "金剛", "九轉", "回元", "靈犀", "鎮心", "龍脈", "鳳髓", "無相", "長生", "清虛", "破境"];
const CORES = ["凝露", "養魂", "淬體", "定命", "回氣", "洗髓", "明心", "渡厄", "藏息", "化靈", "續脈", "觀微", "歸元", "拓脈", "護心", "解毒"];
const SUFFIXES = ["丹", "丸", "散", "靈液", "真丹"];
const ORIGINS = ["正道丹谷", "流浪丹師", "妖域藥庭", "古遺跡丹房", "星海商盟", "仙城藥局", "隱世家族", "宗門試煉庫"];
const STORY_HOOKS = [
  "配方中有一味材料會隨月相改變藥性。",
  "同批丹藥出現兩種丹紋，真假尚待驗證。",
  "原持有者留下了尚未完成的交換承諾。",
  "丹香會吸引某種只在本周目出現的靈獸。",
  "煉製紀錄缺少最後一段火候，需要使用者自行判斷。",
  "服用後可能短暫看見另一條世界線，但不保證是真實預言。",
  "丹藥與目前地脈互相呼應，離開此地後效果會改變。",
  "一個勢力正在追查這批丹藥的來源。",
];

const FAMILY_RULES: Record<PillFamily, {
  label: string;
  primaryEffect: string;
  secondaryEffect: string;
  sideEffect: string;
  contraindication: string;
  stat: CharacterRpgStatKey;
  resource: string;
}> = {
  recovery: { label: "恢復", primaryEffect: "恢復生命與元氣", secondaryEffect: "降低疲勞", sideEffect: "短暫遲鈍", contraindication: "重複服用會降低效果", stat: "rpg.physique", resource: "status.hp" },
  breakthrough: { label: "突破", primaryEffect: "提高突破與成長機會", secondaryEffect: "增加經驗", sideEffect: "經脈反衝與壓力上升", contraindication: "健康或意志過低時不可強行服用", stat: "rpg.will", resource: "growth.realm" },
  body: { label: "淬體", primaryEffect: "強化體魄與承傷能力", secondaryEffect: "短暫提高防禦", sideEffect: "肌肉與經脈疼痛", contraindication: "傷勢未穩定時效果可能逆轉", stat: "rpg.physique", resource: "status.health" },
  spirit: { label: "養魂", primaryEffect: "恢復精神與穩定心境", secondaryEffect: "降低壓力", sideEffect: "夢境過度鮮明", contraindication: "不可與強刺激藥物同服", stat: "rpg.will", resource: "status.spirit" },
  insight: { label: "悟性", primaryEffect: "提高洞察與學習效率", secondaryEffect: "增加專注", sideEffect: "短暫過度分析", contraindication: "疲勞過高時可能只得到雜訊", stat: "rpg.intellect", resource: "status.focus" },
  antidote: { label: "解毒", primaryEffect: "減輕毒性與異常狀態", secondaryEffect: "穩定健康", sideEffect: "藥性相剋時引發噁心", contraindication: "未知毒物需先鑑定", stat: "rpg.intellect", resource: "status.health" },
  fate: { label: "命運", primaryEffect: "增加一次改變事件排列的機會", secondaryEffect: "補充命運點", sideEffect: "世界不穩定度上升", contraindication: "同一日不可連續服用", stat: "rpg.creativity", resource: "game.fatePoints" },
  concealment: { label: "藏息", primaryEffect: "降低暴露並改變追蹤線索", secondaryEffect: "提高技巧", sideEffect: "短暫降低魅力與存在感", contraindication: "需要交涉時不建議服用", stat: "rpg.technique", resource: "adventure.concealment" },
};

const FAMILIES = Object.keys(FAMILY_RULES) as PillFamily[];
const GRADES: PillGrade[] = ["凡品", "靈品", "玄品", "地品", "天品", "禁品"];
const clamp = (value: number, minimum = 0, maximum = 100) => Math.max(minimum, Math.min(maximum, Math.round(value)));

function hashText(value: string) {
  let hash = 2166136261;
  for (const character of value.normalize("NFKC")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function seededRandom(seed: string) {
  let state = hashText(seed) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function gradeRarity(grade: PillGrade): ProceduralPillItem["rarity"] {
  if (grade === "凡品") return "common";
  if (grade === "靈品" || grade === "玄品") return "uncommon";
  if (grade === "地品") return "rare";
  return "epic";
}

export function generateProceduralPills(input: {
  runSeed: string;
  cycle?: number;
  count?: number;
}): ProceduralPillItem[] {
  const count = Math.max(1, Math.min(12, Math.round(input.count ?? 6)));
  return Array.from({ length: count }, (_, index) => {
    const random = seededRandom(`${input.runSeed}|pill|${input.cycle ?? 1}|${index}`);
    const family = FAMILIES[Math.floor(random() * FAMILIES.length)];
    const rule = FAMILY_RULES[family];
    const gradeIndex = Math.min(GRADES.length - 1, Math.floor(random() ** 1.8 * GRADES.length));
    const grade = GRADES[gradeIndex];
    const potency = clamp(28 + gradeIndex * 11 + random() * 24, 20, 96);
    const stability = clamp(92 - gradeIndex * 7 + (random() - 0.5) * 24, 32, 98);
    const shelfLife = Math.max(1, Math.round(4 + random() * 26 - gradeIndex));
    const batchId = `pill-${hashText(`${input.runSeed}|${input.cycle ?? 1}|${index}`).toString(16)}`;
    const name = `${PREFIXES[Math.floor(random() * PREFIXES.length)]}${CORES[Math.floor(random() * CORES.length)]}${SUFFIXES[Math.floor(random() * SUFFIXES.length)]}`;
    const originFaction = ORIGINS[Math.floor(random() * ORIGINS.length)];
    const storyHook = STORY_HOOKS[Math.floor(random() * STORY_HOOKS.length)];
    const profile: ProceduralPillProfile = {
      formulaVersion: PROCEDURAL_PILL_ENGINE_VERSION,
      batchId,
      family,
      grade,
      potency,
      stability,
      shelfLife,
      primaryEffect: rule.primaryEffect,
      secondaryEffect: rule.secondaryEffect,
      sideEffect: rule.sideEffect,
      contraindication: rule.contraindication,
      originFaction,
      storyHook,
    };
    return {
      itemId: batchId,
      name,
      category: "consumable",
      rarity: gradeRarity(grade),
      description: `${grade} · ${rule.label}系。來源：${originFaction}。${storyHook}`,
      effectDescription: `藥力 ${potency}／穩定 ${stability}；${rule.primaryEffect}。副作用：${rule.sideEffect}。`,
      weight: 0.05,
      value: Math.round(60 * (gradeIndex + 1) ** 2 * (0.7 + potency / 100)),
      slot: null,
      statBonuses: {},
      proceduralPill: profile,
    };
  });
}

export function initialProceduralPillResources(runSeed: string, cycle = 1, count = 6) {
  return Object.fromEntries(generateProceduralPills({ runSeed, cycle, count }).map((pill, index) => [
    `item.${pill.itemId}`,
    index < 3 ? 2 : 1,
  ]));
}

export function resolveProceduralPillUse(input: {
  pill: ProceduralPillItem;
  runSeed: string;
  turn: number;
  useIndex: number;
  stats: Record<CharacterRpgStatKey, number>;
  health: number;
  stress: number;
}): ProceduralPillResolution {
  const profile = input.pill.proceduralPill;
  const rule = FAMILY_RULES[profile.family];
  const random = seededRandom(`${input.runSeed}|${profile.batchId}|${input.turn}|${input.useIndex}`);
  const relevantStat = input.stats[rule.stat] ?? 50;
  const physicalReadiness = (input.health + (100 - input.stress)) / 2;
  const compatibility = clamp(relevantStat * 0.55 + physicalReadiness * 0.25 + random() * 20);
  const potencyMultiplier = Math.round((0.62 + compatibility / 160 + (random() - 0.5) * 0.24) * 100) / 100;
  const adverseThreshold = clamp(100 - profile.stability + Math.max(0, 45 - compatibility) * 0.45, 2, 62);
  const sideEffectTriggered = random() * 100 < adverseThreshold;
  const perfect = compatibility >= 78 && !sideEffectTriggered && random() > 0.45;
  const result: ProceduralPillResolution["result"] = perfect ? "perfect" : sideEffectTriggered ? (compatibility < 42 ? "adverse" : "unstable") : "effective";
  const resultLabel = { perfect: "完美吸收", effective: "藥效成立", unstable: "藥效不穩", adverse: "明顯反噬" }[result];
  const baseGain = Math.max(1, Math.round(profile.potency / 11 * potencyMultiplier));
  const beneficialGain = result === "adverse" ? Math.max(1, Math.round(baseGain * 0.25)) : result === "unstable" ? Math.max(1, Math.round(baseGain * 0.6)) : baseGain;
  const statGain = profile.family === "antidote" || profile.family === "recovery" ? 0 : Math.min(5, Math.max(1, Math.round(beneficialGain / 4)));
  const resourceChanges: Record<string, number> = { [rule.resource]: beneficialGain };
  if (profile.family === "recovery") resourceChanges["status.fatigue"] = -Math.max(2, Math.round(beneficialGain / 2));
  if (profile.family === "spirit") resourceChanges["status.stress"] = -Math.max(2, Math.round(beneficialGain / 2));
  if (profile.family === "fate") resourceChanges["world.instability"] = sideEffectTriggered ? 4 : 1;
  if (sideEffectTriggered) {
    resourceChanges["status.stress"] = (resourceChanges["status.stress"] ?? 0) + (result === "adverse" ? 12 : 5);
    resourceChanges["status.health"] = (resourceChanges["status.health"] ?? 0) - (result === "adverse" ? 8 : 2);
  }
  const effect: StoryChoiceEffect = {
    statChanges: statGain ? { [rule.stat]: statGain } : {},
    relationshipChanges: {},
    resourceChanges: {
      [`item.${input.pill.itemId}`]: -1,
      [`pill.use.${profile.family}`]: 1,
      ...resourceChanges,
    },
    moneyChange: 0,
    worldFlags: {
      "pill.formulaVersion": PROCEDURAL_PILL_ENGINE_VERSION,
      "pill.lastBatchId": profile.batchId,
      "pill.lastResult": result,
      "pill.lastCompatibility": compatibility,
      "pill.lastUseTurn": input.turn,
    },
    questProgress: {},
    achievementProgress: { "rpg.pillKnowledge": result === "perfect" ? 8 : 3 },
    timelineEvents: [`服用${input.pill.name}：${resultLabel}（契合 ${compatibility}／藥力倍率 ${potencyMultiplier}）`],
  };
  return {
    result,
    resultLabel,
    compatibility,
    potencyMultiplier,
    sideEffectTriggered,
    effect,
    summary: `${input.pill.name}產生「${resultLabel}」；同一配方會因人物能力、健康、壓力、服用時機與周目 seed 產生不同結果。`,
  };
}

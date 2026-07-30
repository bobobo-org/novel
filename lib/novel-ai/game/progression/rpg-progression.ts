import type { StoryChoiceEffect, StoryState } from "../../domain";

export const RPG_FORMULA_VERSION = "novel-rpg-growth-v1" as const;

export const RPG_STAT_DEFINITIONS = [
  { key: "rpg.courage", label: "勇氣", description: "面對威脅、承擔代價與正面突破的能力。" },
  { key: "rpg.insight", label: "洞察", description: "辨識線索、推理真相與看穿局勢的能力。" },
  { key: "rpg.empathy", label: "共感", description: "理解人物、建立信任與影響關係的能力。" },
  { key: "rpg.craft", label: "技藝", description: "執行計畫、解決問題與精準創造的能力。" },
  { key: "rpg.resilience", label: "韌性", description: "承受壓力、恢復狀態與持續行動的能力。" },
  { key: "rpg.renown", label: "聲望", description: "角色在世界中的影響力、名聲與號召力。" },
] as const;

export type RpgStatKey = typeof RPG_STAT_DEFINITIONS[number]["key"];
export type RpgChoiceKey = "A" | "B" | "C";

export type RpgProgressionSnapshot = {
  formulaVersion: typeof RPG_FORMULA_VERSION;
  stats: Record<RpgStatKey, number>;
  xp: number;
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  levelProgress: number;
  powerScore: number;
};

export type RpgChoice = {
  key: RpgChoiceKey;
  title: string;
  approach: "bold" | "bond" | "strategy";
  description: string;
  consequence: string;
  primaryStat: RpgStatKey;
  secondaryStat: RpgStatKey;
  risk: 1 | 2 | 3;
  successChance: number;
  xpGain: number;
  effect: StoryChoiceEffect;
  acceptedText: string;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

export function experienceForLevel(level: number) {
  const normalized = clamp(Math.floor(level), 1, 99);
  return 100 * (normalized - 1) ** 2;
}

export function levelFromExperience(xp: number) {
  return clamp(Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1, 1, 99);
}

export function initialRpgStats(seed = ""): Record<RpgStatKey, number> {
  let hash = 2166136261;
  for (const character of seed.normalize("NFKC")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return Object.fromEntries(RPG_STAT_DEFINITIONS.map((definition, index) => {
    const offset = ((hash >>> ((index % 4) * 8)) % 11) - 5;
    return [definition.key, 50 + offset];
  })) as Record<RpgStatKey, number>;
}

export function computePowerScore(
  stats: Record<RpgStatKey, number>,
  level: number,
) {
  const weighted =
    stats["rpg.courage"] * 0.18
    + stats["rpg.insight"] * 0.2
    + stats["rpg.empathy"] * 0.16
    + stats["rpg.craft"] * 0.18
    + stats["rpg.resilience"] * 0.18
    + stats["rpg.renown"] * 0.1;
  return Math.round(weighted * (1 + (Math.max(1, level) - 1) * 0.04));
}

export function computeSuccessChance(input: {
  primary: number;
  secondary: number;
  level: number;
  risk: number;
}) {
  return clamp(Math.round(
    24
    + input.primary * 0.48
    + input.secondary * 0.18
    + input.level * 1.2
    - input.risk * 8,
  ), 5, 95);
}

export function readRpgProgression(
  storyState: Pick<StoryState, "protagonistStats">,
  seed = "",
): RpgProgressionSnapshot {
  const defaults = initialRpgStats(seed);
  const stats = Object.fromEntries(RPG_STAT_DEFINITIONS.map(({ key }) => [
    key,
    clamp(Math.round(storyState.protagonistStats[key] ?? defaults[key]), 0, 100),
  ])) as Record<RpgStatKey, number>;
  const xp = Math.max(0, Math.round(storyState.protagonistStats["rpg.xp"] ?? 0));
  const level = levelFromExperience(xp);
  const currentLevelXp = experienceForLevel(level);
  const nextLevelXp = level >= 99 ? currentLevelXp : experienceForLevel(level + 1);
  return {
    formulaVersion: RPG_FORMULA_VERSION,
    stats,
    xp,
    level,
    currentLevelXp,
    nextLevelXp,
    levelProgress: level >= 99
      ? 100
      : Math.round((xp - currentLevelXp) / Math.max(1, nextLevelXp - currentLevelXp) * 100),
    powerScore: computePowerScore(stats, level),
  };
}

const CHOICE_BLUEPRINTS = [
  {
    key: "A",
    title: "迎向衝突",
    approach: "bold",
    primaryStat: "rpg.courage",
    secondaryStat: "rpg.resilience",
    risk: 3,
    statChanges: { "rpg.courage": 4, "rpg.resilience": 2 },
    resourceChanges: { momentum: 2 },
  },
  {
    key: "B",
    title: "建立羈絆",
    approach: "bond",
    primaryStat: "rpg.empathy",
    secondaryStat: "rpg.renown",
    risk: 2,
    statChanges: { "rpg.empathy": 4, "rpg.renown": 2 },
    resourceChanges: { trust: 2 },
  },
  {
    key: "C",
    title: "觀察佈局",
    approach: "strategy",
    primaryStat: "rpg.insight",
    secondaryStat: "rpg.craft",
    risk: 1,
    statChanges: { "rpg.insight": 4, "rpg.craft": 2 },
    resourceChanges: { clues: 2 },
  },
] as const;

export function buildRpgChoices(input: {
  progression: RpgProgressionSnapshot;
  protagonist: string;
  chapterTitle: string;
  conflict: string;
}): RpgChoice[] {
  const protagonist = input.protagonist.trim() || "主角";
  const chapterTitle = input.chapterTitle.trim() || "目前章節";
  const conflict = input.conflict.trim() || "眼前尚未解決的局勢";
  return CHOICE_BLUEPRINTS.map((blueprint) => {
    const successChance = computeSuccessChance({
      primary: input.progression.stats[blueprint.primaryStat],
      secondary: input.progression.stats[blueprint.secondaryStat],
      level: input.progression.level,
      risk: blueprint.risk,
    });
    const xpGain = Math.round(
      18 + blueprint.risk * 12 + input.progression.powerScore / 20,
    );
    const effect: StoryChoiceEffect = {
      statChanges: {
        ...blueprint.statChanges,
        "rpg.xp": xpGain,
      },
      relationshipChanges: blueprint.approach === "bond"
        ? { "rpg.partyTrust": 4 }
        : {},
      resourceChanges: blueprint.resourceChanges,
      moneyChange: 0,
      worldFlags: {
        [`rpg.lastChoice.${blueprint.approach}`]: true,
      },
      questProgress: { "rpg.mainArc": 8 + blueprint.risk * 2 },
      achievementProgress: {
        [`rpg.${blueprint.approach}`]: 20,
      },
      timelineEvents: [`${chapterTitle}：${blueprint.title}`],
    };
    const descriptions = {
      bold: `${protagonist}正面承擔「${conflict}」的壓力，以行動打破僵局。`,
      bond: `${protagonist}先理解各方真正想要什麼，嘗試以承諾、交換或信任改變局勢。`,
      strategy: `${protagonist}暫緩出手，從細節、規則與破綻中建立一條勝率更高的路。`,
    } as const;
    const consequences = {
      bold: "成長最快、風險最高；容易獲得主動權，也可能立刻付出代價。",
      bond: "關係收益較高；需要承擔承諾，且可能被對方誤解或利用。",
      strategy: "風險較低並獲得線索；若拖延過久，機會可能轉瞬即逝。",
    } as const;
    return {
      ...blueprint,
      description: descriptions[blueprint.approach],
      consequence: consequences[blueprint.approach],
      successChance,
      xpGain,
      effect,
      acceptedText: [
        `【互動分支 ${blueprint.key}｜${blueprint.title}】`,
        descriptions[blueprint.approach],
        `${protagonist}知道這不是沒有代價的選擇，仍決定把下一步建立在自己的判斷上。局勢因此出現新的推進，也留下必須在後續章節面對的結果。`,
      ].join("\n\n"),
    };
  });
}

export function rpgFormulaExplanation() {
  return {
    level: "等級 = floor(√(總經驗值 ÷ 100)) + 1，最高 99 級。",
    nextLevel: "到下一級的累積經驗門檻 = 100 × 目前等級²。",
    power: "綜合戰力 = 加權能力值 × [1 + (等級 - 1) × 4%]；洞察 20%，勇氣／技藝／韌性各 18%，共感 16%，聲望 10%。",
    success: "成功率 = 24 + 主能力×0.48 + 副能力×0.18 + 等級×1.2 - 風險級別×8，最後限制在 5%～95%。",
    growth: "每次選擇只產生候選；按下確認後才會透過 Approval Transaction 寫入章節、能力、任務與成就。",
  };
}

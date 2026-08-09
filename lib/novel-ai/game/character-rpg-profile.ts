import type {
  CharacterRpgArchetype,
  CharacterRpgProfile,
  CharacterRpgStatKey,
} from "../domain";

export const CHARACTER_RPG_POINT_BUDGET = 300 as const;
export const CHARACTER_RPG_STAT_MIN = 20;
export const CHARACTER_RPG_STAT_MAX = 80;

export const CHARACTER_RPG_STAT_LABELS: Record<CharacterRpgStatKey, string> = {
  "rpg.physique": "體能",
  "rpg.technique": "技巧",
  "rpg.intellect": "智慧",
  "rpg.charisma": "魅力",
  "rpg.will": "意志",
  "rpg.creativity": "創造",
};

export const CHARACTER_RPG_ARCHETYPES: Array<{
  id: CharacterRpgArchetype;
  label: string;
  description: string;
}> = [
  { id: "balanced", label: "均衡型", description: "六項能力平均，適合尚未決定發展方向的角色。" },
  { id: "vanguard", label: "先鋒型", description: "體能與技巧突出，擅長直接承擔風險。" },
  { id: "strategist", label: "策士型", description: "智慧與意志突出，擅長推理、規劃與研究。" },
  { id: "diplomat", label: "交涉型", description: "魅力、智慧與意志突出，擅長關係與領導。" },
  { id: "mystic", label: "靈能型", description: "創造、智慧與意志突出，適合法術與特殊能力。" },
  { id: "creator", label: "創作者型", description: "創造與技巧突出，擅長製作、研發與藝術。" },
  { id: "custom", label: "自訂配點", description: "自由分配 300 點，每項能力必須介於 20 到 80。" },
];

const PRESETS: Record<Exclude<CharacterRpgArchetype, "custom">, Record<CharacterRpgStatKey, number>> = {
  balanced: { "rpg.physique": 50, "rpg.technique": 50, "rpg.intellect": 50, "rpg.charisma": 50, "rpg.will": 50, "rpg.creativity": 50 },
  vanguard: { "rpg.physique": 70, "rpg.technique": 65, "rpg.intellect": 35, "rpg.charisma": 40, "rpg.will": 55, "rpg.creativity": 35 },
  strategist: { "rpg.physique": 35, "rpg.technique": 45, "rpg.intellect": 75, "rpg.charisma": 50, "rpg.will": 55, "rpg.creativity": 40 },
  diplomat: { "rpg.physique": 35, "rpg.technique": 40, "rpg.intellect": 55, "rpg.charisma": 75, "rpg.will": 55, "rpg.creativity": 40 },
  mystic: { "rpg.physique": 35, "rpg.technique": 40, "rpg.intellect": 60, "rpg.charisma": 40, "rpg.will": 60, "rpg.creativity": 65 },
  creator: { "rpg.physique": 40, "rpg.technique": 50, "rpg.intellect": 55, "rpg.charisma": 45, "rpg.will": 45, "rpg.creativity": 65 },
};

export function characterRpgStatsForArchetype(
  archetype: CharacterRpgArchetype,
  current?: Record<CharacterRpgStatKey, number>,
) {
  return { ...(archetype === "custom" ? current ?? PRESETS.balanced : PRESETS[archetype]) };
}
export function characterRpgPointTotal(stats: Record<CharacterRpgStatKey, number>) {
  return Object.values(stats).reduce((total, value) => total + Math.round(value), 0);
}

export function validateCharacterRpgStats(stats: Record<CharacterRpgStatKey, number>) {
  for (const [key, value] of Object.entries(stats) as Array<[CharacterRpgStatKey, number]>) {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`${CHARACTER_RPG_STAT_LABELS[key]}必須是整數。`);
    }
    if (value < CHARACTER_RPG_STAT_MIN || value > CHARACTER_RPG_STAT_MAX) {
      throw new Error(`${CHARACTER_RPG_STAT_LABELS[key]}必須介於 ${CHARACTER_RPG_STAT_MIN} 到 ${CHARACTER_RPG_STAT_MAX}。`);
    }
  }
  const total = characterRpgPointTotal(stats);
  if (total !== CHARACTER_RPG_POINT_BUDGET) {
    throw new Error(`RPG 初始能力必須正好分配 ${CHARACTER_RPG_POINT_BUDGET} 點，目前為 ${total} 點。`);
  }
  return stats;
}

export function createCharacterRpgProfile(input: {
  archetype: CharacterRpgArchetype;
  stats: Record<CharacterRpgStatKey, number>;
  approvedAt?: string;
}): CharacterRpgProfile {
  return {
    schemaVersion: "character-rpg-profile-v1",
    formulaVersion: "novel-rpg-unified-v3",
    archetype: input.archetype,
    stats: { ...validateCharacterRpgStats(input.stats) },
    pointBudget: CHARACTER_RPG_POINT_BUDGET,
    approvedAt: input.approvedAt ?? new Date().toISOString(),
  };
}

export function suggestCharacterRpgArchetype(values: string[]) {
  const text = values.join(" ");
  if (/劍|騎士|將軍|護衛|獵人|巡守|運動員|戰|武|斥候/u.test(text)) return "vanguard" as const;
  if (/外交|律師|記者|教師|領袖|組織|商|貴族|顧問|談判/u.test(text)) return "diplomat" as const;
  if (/藝術|音樂|設計|發明|鍊金|廚|花藝|機械|工匠|創業/u.test(text)) return "creator" as const;
  if (/法師|靈|仙|祭|預言|祕術|驅魔|藥劑/u.test(text)) return "mystic" as const;
  if (/學者|醫|教授|科學|工程|策士|偵探|調查|研究|智慧/u.test(text)) return "strategist" as const;
  return "balanced" as const;
}

import type {
  GlobalCharacterAbilityKey,
  GlobalCharacterAbilityProfile,
} from "./types";

export const GLOBAL_PERSONAL_HERO_ABILITY_MIN = 0 as const;
export const GLOBAL_PERSONAL_HERO_ABILITY_MAX = 200 as const;
export const GLOBAL_CATALOG_CHARACTER_ABILITY_MIN = 0 as const;
export const GLOBAL_CATALOG_CHARACTER_ABILITY_MAX = 100 as const;

export const GLOBAL_CHARACTER_ABILITY_KEYS = [
  "cultivation",
  "martial",
  "strategy",
  "perception",
  "medicine",
  "crafting",
  "leadership",
  "influence",
] as const satisfies readonly GlobalCharacterAbilityKey[];

export const GLOBAL_CHARACTER_ABILITY_LABELS: Record<GlobalCharacterAbilityKey, string> = {
  cultivation: "修行",
  martial: "武力",
  strategy: "謀略",
  perception: "洞察",
  medicine: "醫藥",
  crafting: "技藝",
  leadership: "領導",
  influence: "影響力",
};

export const DEFAULT_GLOBAL_PERSONAL_HERO_ABILITIES: Readonly<Record<GlobalCharacterAbilityKey, number>> = Object.freeze({
  cultivation: 100,
  martial: 100,
  strategy: 100,
  perception: 100,
  medicine: 100,
  crafting: 100,
  leadership: 100,
  influence: 100,
});

function copyStats(stats: Record<GlobalCharacterAbilityKey, number>) {
  return Object.fromEntries(
    GLOBAL_CHARACTER_ABILITY_KEYS.map((key) => [key, stats[key]]),
  ) as Record<GlobalCharacterAbilityKey, number>;
}

function validateStats(
  stats: Record<GlobalCharacterAbilityKey, number>,
  input: { min: number; max: number; integer: boolean; subject: string },
) {
  for (const key of GLOBAL_CHARACTER_ABILITY_KEYS) {
    const value = stats[key];
    const label = GLOBAL_CHARACTER_ABILITY_LABELS[key];
    if (!Number.isFinite(value) || (input.integer && !Number.isInteger(value))) {
      throw new Error(`${input.subject}${label}必須是整數。`);
    }
    if (value < input.min || value > input.max) {
      throw new Error(`${input.subject}${label}必須介於 ${input.min} 到 ${input.max}。`);
    }
  }
}

/**
 * Manual Global Canon creation is the author's personal hero path. It is not
 * bound to the procedural catalog's 0-100 scale or to a shared point budget.
 */
export function createGlobalPersonalHeroAbilityProfile(
  stats: Record<GlobalCharacterAbilityKey, number>,
): GlobalCharacterAbilityProfile {
  validateStats(stats, {
    min: GLOBAL_PERSONAL_HERO_ABILITY_MIN,
    max: GLOBAL_PERSONAL_HERO_ABILITY_MAX,
    integer: true,
    subject: "個人英雄的",
  });
  return {
    schemaVersion: "global-character-ability-profile-v1",
    source: "personal_hero",
    label: "個人英雄（手動建立）",
    scaleMin: GLOBAL_PERSONAL_HERO_ABILITY_MIN,
    scaleMax: GLOBAL_PERSONAL_HERO_ABILITY_MAX,
    stats: copyStats(stats),
  };
}

/** Creates an isolated snapshot; the frozen procedural candidate is untouched. */
export function createGlobalCatalogCharacterAbilityProfile(
  stats: Record<GlobalCharacterAbilityKey, number>,
): GlobalCharacterAbilityProfile {
  validateStats(stats, {
    min: GLOBAL_CATALOG_CHARACTER_ABILITY_MIN,
    max: GLOBAL_CATALOG_CHARACTER_ABILITY_MAX,
    integer: false,
    subject: "系統候選的",
  });
  return {
    schemaVersion: "global-character-ability-profile-v1",
    source: "system_catalog",
    label: "系統候選人物",
    scaleMin: GLOBAL_CATALOG_CHARACTER_ABILITY_MIN,
    scaleMax: GLOBAL_CATALOG_CHARACTER_ABILITY_MAX,
    stats: copyStats(stats),
  };
}

export function globalCharacterAbilitySummary(profile: GlobalCharacterAbilityProfile) {
  return GLOBAL_CHARACTER_ABILITY_KEYS
    .map((key) => ({ key, value: profile.stats[key] }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 3)
    .map(({ key, value }) => `${GLOBAL_CHARACTER_ABILITY_LABELS[key]} ${Number.isInteger(value) ? value : value.toFixed(1)}/${profile.scaleMax}`)
    .join("、");
}

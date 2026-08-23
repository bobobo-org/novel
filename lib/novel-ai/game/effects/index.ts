import type { StoryChoiceEffect, StoryState } from "../../domain/index";

const SAFE_KEY = /^[a-zA-Z0-9_.:\-\u4e00-\u9fff]{1,64}$/;
export type EffectValidation = { valid: boolean; errors: string[] };

export function validateStoryChoiceEffect(effect: StoryChoiceEffect): EffectValidation {
  const errors: string[] = [];
  const maps = [
    effect.statChanges,
    effect.relationshipChanges,
    effect.resourceChanges,
    effect.questProgress,
    effect.achievementProgress,
  ];
  for (const map of maps) {
    if (map !== undefined && (map === null || typeof map !== "object" || Array.isArray(map))) {
      errors.push("狀態變化格式無效");
      continue;
    }
    for (const [key, value] of Object.entries(map ?? {})) {
      if (!SAFE_KEY.test(key)) errors.push(`不允許的狀態名稱：${key}`);
      if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) {
        errors.push(`不合理的狀態變化：${key}`);
      }
    }
  }
  if (!Number.isFinite(effect.moneyChange) || Math.abs(effect.moneyChange) > 1_000_000_000) {
    errors.push("金錢變化超出安全範圍");
  }
  if (
    effect.worldFlags !== undefined
    && (effect.worldFlags === null || typeof effect.worldFlags !== "object" || Array.isArray(effect.worldFlags))
  ) {
    errors.push("世界狀態格式無效");
  }
  for (const key of Object.keys(effect.worldFlags ?? {})) {
    if (!SAFE_KEY.test(key)) errors.push(`不允許的世界狀態：${key}`);
  }
  return { valid: errors.length === 0, errors };
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

function addNumericMap(
  base: Record<string, number>,
  changes: Record<string, number>,
  normalize?: (key: string, value: number) => number,
) {
  const safeBase = base ?? {};
  const safeChanges = changes ?? {};
  return Object.fromEntries(
    [...new Set([...Object.keys(safeBase), ...Object.keys(safeChanges)])].map((key) => {
      const next = (safeBase[key] ?? 0) + (safeChanges[key] ?? 0);
      return [key, normalize ? normalize(key, next) : next];
    }),
  );
}

function normalizeRpgStat(key: string, value: number) {
  if (key === "rpg.xp") return Math.max(0, Math.round(value));
  if (key.startsWith("rpg.")) return clamp(Math.round(value), 0, 100);
  return value;
}

const RPG_STAT_LEGACY_ALIASES: Record<string, string> = {
  "rpg.physique": "rpg.resilience",
  "rpg.technique": "rpg.craft",
  "rpg.intellect": "rpg.insight",
  "rpg.charisma": "rpg.empathy",
  "rpg.will": "rpg.courage",
  "rpg.creativity": "rpg.renown",
};

function addProtagonistStats(
  base: Record<string, number>,
  changes: Record<string, number>,
  baselines: Record<string, number>,
) {
  const next = { ...(base ?? {}) };
  for (const [key, baseline] of Object.entries(baselines ?? {})) {
    if (!(key in RPG_STAT_LEGACY_ALIASES) || next[key] !== undefined) continue;
    const legacyKey = RPG_STAT_LEGACY_ALIASES[key];
    next[key] = normalizeRpgStat(key, next[legacyKey] ?? baseline);
  }
  for (const [key, change] of Object.entries(changes ?? {})) {
    const legacyKey = RPG_STAT_LEGACY_ALIASES[key];
    const current = next[key]
      ?? (legacyKey ? next[legacyKey] : undefined)
      ?? baselines[key]
      ?? 0;
    next[key] = normalizeRpgStat(key, current + change);
  }
  return next;
}

function normalizeResource(key: string, value: number) {
  if (
    key.startsWith("status.")
    || key === "romance.eventProgress"
    || key === "romance.personalGrowth"
    || [
      "management.morale",
      "management.reputation",
      "management.satisfaction",
      "management.technology",
      "management.risk",
      "management.marketShare",
      "management.socialImpact",
      "management.employeeSkill",
      "management.jobFit",
      "management.staffStamina",
    ].includes(key)
  ) return clamp(Math.round(value), 0, 100);
  if (key === "game.actionPoints") return clamp(Math.round(value), 0, 5);
  if (
    key.startsWith("game.")
    || key.startsWith("currency.")
    || key.startsWith("item.")
    || key === "management.staff"
    || key === "management.inventory"
  ) return Math.max(0, Math.round(value));
  if (key.startsWith("management.")) return Math.round(value);
  return value;
}

function addProgress(
  base: Record<string, string>,
  changes: Record<string, number>,
) {
  const safeBase = base ?? {};
  const safeChanges = changes ?? {};
  const keys = [...new Set([...Object.keys(safeBase), ...Object.keys(safeChanges)])];
  return Object.fromEntries(keys.map((key) => {
    const current = Number(safeBase[key]) || 0;
    return [key, String(clamp(Math.round(current + (safeChanges[key] ?? 0)), 0, 100))];
  }));
}

export function applyStoryChoiceEffect(
  state: StoryState,
  effect: StoryChoiceEffect,
  statBaselines: Record<string, number> = {},
): StoryState {
  const validation = validateStoryChoiceEffect(effect);
  if (!validation.valid) throw new Error(validation.errors.join("；"));
  return {
    ...state,
    revision: state.revision + 1,
    parentRevision: state.revision,
    updatedAt: new Date().toISOString(),
    protagonistStats: addProtagonistStats(
      state.protagonistStats ?? {},
      effect.statChanges ?? {},
      statBaselines,
    ),
    relationships: addNumericMap(
      state.relationships ?? {},
      effect.relationshipChanges ?? {},
      (_key, value) => clamp(Math.round(value), -100, 100),
    ),
    resources: addNumericMap(
      state.resources ?? {},
      effect.resourceChanges ?? {},
      normalizeResource,
    ),
    money: (state.money ?? 0) + effect.moneyChange,
    worldFlags: { ...state.worldFlags, ...effect.worldFlags },
    questStates: addProgress(state.questStates ?? {}, effect.questProgress ?? {}),
    achievementStates: addProgress(
      state.achievementStates ?? {},
      effect.achievementProgress ?? {},
    ),
  };
}

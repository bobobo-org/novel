import type { StoryChoiceEffect, StoryState } from "../../domain/index";
const SAFE_KEY = /^[a-zA-Z0-9_.:\-\u4e00-\u9fff]{1,64}$/;
export type EffectValidation = { valid: boolean; errors: string[] };

export function validateStoryChoiceEffect(effect: StoryChoiceEffect): EffectValidation {
  const errors: string[] = [], maps = [effect.statChanges,effect.relationshipChanges,effect.resourceChanges,effect.questProgress,effect.achievementProgress];
  for (const map of maps) for (const [key, value] of Object.entries(map)) { if (!SAFE_KEY.test(key)) errors.push(`不允許的狀態名稱：${key}`); if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) errors.push(`不合理的狀態變化：${key}`); }
  if (!Number.isFinite(effect.moneyChange) || Math.abs(effect.moneyChange) > 1_000_000_000) errors.push("金錢變化超出安全範圍");
  for (const key of Object.keys(effect.worldFlags)) if (!SAFE_KEY.test(key)) errors.push(`不允許的世界狀態：${key}`);
  return { valid: errors.length === 0, errors };
}

export function applyStoryChoiceEffect(state: StoryState, effect: StoryChoiceEffect): StoryState {
  const validation = validateStoryChoiceEffect(effect); if (!validation.valid) throw new Error(validation.errors.join("；"));
  const add = (base: Record<string, number>, changes: Record<string, number>) => Object.fromEntries(new Set([...Object.keys(base),...Object.keys(changes)]).values().map((key) => [key, (base[key] ?? 0) + (changes[key] ?? 0)]));
  return { ...state, revision: state.revision + 1, parentRevision: state.revision, updatedAt: new Date().toISOString(), protagonistStats: add(state.protagonistStats, effect.statChanges), relationships: add(state.relationships, effect.relationshipChanges), resources: add(state.resources, effect.resourceChanges), money: (state.money ?? 0) + effect.moneyChange, worldFlags: { ...state.worldFlags, ...effect.worldFlags }, questStates: { ...state.questStates, ...Object.fromEntries(Object.entries(effect.questProgress).map(([k,v]) => [k, String(v)])) }, achievementStates: { ...state.achievementStates, ...Object.fromEntries(Object.entries(effect.achievementProgress).map(([k,v]) => [k, String(v)])) } };
}

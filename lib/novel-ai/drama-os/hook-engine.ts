import type { DramaFormatProfile, HookType, NarrativeAnalysis } from "./types";

export function buildOpeningHook(analysis: NarrativeAnalysis, profile: DramaFormatProfile): {
  type: HookType;
  text: string;
  deadlineSeconds: number;
} {
  const protagonist = analysis.primaryProtagonist.value ?? "主角";
  const stake = analysis.stakes.value?.[0] ?? analysis.majorEvents.value?.[0] ?? "必須立刻做出選擇";
  const type: HookType = analysis.irreversibleEvents.value?.length ? "DANGER_HOOK" : "CONFLICT_HOOK";
  return {
    type,
    text: `${protagonist}一開場便面對「${stake}」，結果將改變接下來的一切。`,
    deadlineSeconds: Math.min(profile.openingHookDeadlineSeconds, Math.max(1, Math.round(profile.targetDurationSeconds * 0.08))),
  };
}

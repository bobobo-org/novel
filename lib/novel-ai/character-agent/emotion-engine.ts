import { clampScore } from "./record-factory";

export function projectEmotionalState(
  current: Record<string, number>,
  observations: string[],
  relationshipSignals: { trust?: number; fear?: number; conflict?: number } = {},
) {
  const text = observations.join(" ");
  const danger = /危險|威脅|追|死|背叛|danger|threat|betray/iu.test(text) ? 20 : 0;
  const relief = /安全|救|和解|信任|safe|rescue|reconcile/iu.test(text) ? 15 : 0;
  return {
    neutral: clampScore((current.neutral ?? 50) - danger + Math.round(relief / 2), 0, 100),
    fear: clampScore((current.fear ?? 0) + danger + Math.max(0, relationshipSignals.fear ?? 0), 0, 100),
    anger: clampScore((current.anger ?? 0) + Math.max(0, relationshipSignals.conflict ?? 0), 0, 100),
    trust: clampScore((current.trust ?? 0) + Math.max(0, relationshipSignals.trust ?? 0) + relief, 0, 100),
  };
}

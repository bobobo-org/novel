import type { Character } from "../domain";
import type { RelationshipMetrics } from "./types";

export const MATURE_NARRATIVE_FORMULA_VERSION = "mature-narrative-consent-v1" as const;

export type MatureNarrativeFormula = {
  formulaVersion: typeof MATURE_NARRATIVE_FORMULA_VERSION;
  eligible: boolean;
  blockers: string[];
  canonicalMutation: 0;
  tension: number;
  trustRequirement: number;
  powerImbalance: number;
  vulnerability: number;
  boundarySafety: number;
  suggestedBeat: string;
  consequenceRule: string;
};

const clamp = (value: number, minimum = 0, maximum = 100) => Math.max(minimum, Math.min(maximum, Math.round(value)));

/**
 * Converts mature-story themes into non-explicit, consent-first narrative rules.
 * It deliberately rejects coercion, incapacity, unknown age and unapproved use.
 */
export function evaluateMatureNarrativeFormula(input: {
  projectAdultMode: boolean;
  from: Character;
  to: Character;
  metrics: RelationshipMetrics;
  explicitConsent: boolean;
  boundaryConfirmed: boolean;
  impairedOrCoerced?: boolean;
}): MatureNarrativeFormula {
  const blockers: string[] = [];
  if (!input.projectAdultMode) blockers.push("作品尚未啟用 Adult Mode");
  if (!input.from.ageVerified || (input.from.age ?? 0) < 18) blockers.push(`${input.from.name}尚未完成成年驗證`);
  if (!input.to.ageVerified || (input.to.age ?? 0) < 18) blockers.push(`${input.to.name}尚未完成成年驗證`);
  if (!input.explicitConsent) blockers.push("雙方尚未明確同意");
  if (!input.boundaryConfirmed) blockers.push("尚未確認界線與可撤回方式");
  if (input.impairedOrCoerced) blockers.push("存在失去判斷能力或權力脅迫");
  const powerImbalance = clamp(Math.abs(input.metrics.powerBalance));
  const trustRequirement = clamp(42 + powerImbalance * 0.38 + Math.max(0, input.metrics.conflict) * 0.2);
  if (input.metrics.trust < trustRequirement) blockers.push(`信任不足（需要 ${trustRequirement}，目前 ${input.metrics.trust}）`);
  const tension = clamp(
    Math.max(0, input.metrics.attraction) * 0.38
    + Math.max(0, input.metrics.affection) * 0.25
    + Math.max(0, input.metrics.conflict) * 0.16
    + Math.max(0, input.metrics.trust) * 0.21,
  );
  const vulnerability = clamp((100 - Math.max(-100, input.metrics.trust)) * 0.28 + Math.max(0, input.metrics.dependency) * 0.32 + powerImbalance * 0.4);
  const boundarySafety = clamp(100 - powerImbalance * 0.35 - Math.max(0, input.metrics.fear) * 0.35 - Math.max(0, input.metrics.resentment) * 0.3);
  const eligible = blockers.length === 0;
  return {
    formulaVersion: MATURE_NARRATIVE_FORMULA_VERSION,
    eligible,
    blockers,
    canonicalMutation: 0,
    tension,
    trustRequirement,
    powerImbalance,
    vulnerability,
    boundarySafety,
    suggestedBeat: eligible
      ? tension >= 70
        ? "先確認彼此真正想要的關係，再以非露骨的親密場景推進信任與選擇代價。"
        : "以對話、照顧、坦白秘密或共同承擔風險累積親密張力。"
      : "保留為關係候選；先處理成年、同意、界線、脅迫或信任問題。",
    consequenceRule: "親密選擇必須同時留下關係、界線、權力平衡與事後影響；任何一方撤回即停止，不以失去自主作為獎勵。",
  };
}

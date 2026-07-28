import type { ReasoningTaskClass } from "./types";

export const DELIBERATIVE_PLANNER_VERSION = "p23a-deliberative-planner-v1" as const;

export function buildDeliberativePlan(input: {
  taskClass: ReasoningTaskClass;
  instruction: string;
  availableTools: string[];
  maxHypotheses?: number;
}) {
  const maxHypotheses = Math.max(1, Math.min(5, input.maxHypotheses ?? 3));
  const evidenceFirst = input.taskClass === "fact" || input.taskClass === "research" || input.taskClass === "high_risk_real_world";
  const hypotheses = Array.from({ length: maxHypotheses }, (_, index) => ({
    hypothesisId: `hypothesis-${index + 1}`,
    purpose: index === 0
      ? "主要解法"
      : index === 1
        ? "反方或替代解法"
        : "壓力測試與失敗情境",
    status: "unverified" as const,
  }));
  return {
    plannerVersion: DELIBERATIVE_PLANNER_VERSION,
    objective: input.instruction.trim(),
    taskClass: input.taskClass,
    hypotheses,
    toolCandidates: [...new Set(input.availableTools)],
    verificationGates: [
      evidenceFirst ? "每個事實主張都必須有可定位來源。" : "每個情節主張都必須符合 Story Bible。",
      "保留互相矛盾的來源，不自行抹除。",
      "列出主要替代方案與不確定事項。",
      "最終答案必須直接回應原任務。",
    ],
    maxCritiqueRounds: 1 as const,
    rawInternalReasoningExposed: false as const,
  };
}

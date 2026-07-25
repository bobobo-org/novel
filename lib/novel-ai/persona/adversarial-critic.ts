import type { GenerationEvaluation } from "../generation-loop/types";
import type { ReturnTypeOfRigorousLanguage } from "./types-internal";

export function buildAdversarialCritique(
  evaluation: GenerationEvaluation,
  language: ReturnTypeOfRigorousLanguage,
) {
  const risks = [
    ...evaluation.continuityReport.issues.map((issue) => issue.explanation),
    ...evaluation.disagreements.map((row) => `${row.dimension} 的模型評估與規則結果不一致。`),
    ...language.issues.map((issue) => issue.explanation),
  ];
  return {
    critiqueRound: 1 as const,
    risks: [...new Set(risks)].slice(0, 12),
    requiresRevision: !evaluation.passed || language.score < 70,
    blockedByEvidence: evaluation.continuityReport.issues.some((issue) => issue.severity === "blocking"),
  };
}

export function rankReasonedCandidates<T extends {
  evaluation: { continuityReport: { score: number }; characterReport: { score: number }; plotReport: { score: number }; styleReport: { score: number } };
  languageEvaluation: { score: number };
  confidence: number;
}>(candidates: T[]) {
  return [...candidates].sort((a, b) => {
    const score = (row: T) => (
      row.evaluation.continuityReport.score
      + row.evaluation.characterReport.score
      + row.evaluation.plotReport.score
      + row.evaluation.styleReport.score
      + row.languageEvaluation.score
      + row.confidence
    ) / 6;
    return score(b) - score(a);
  });
}

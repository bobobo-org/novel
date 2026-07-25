export function calibrateConfidence(input: {
  sourceCount: number;
  blockingIssues: number;
  majorIssues: number;
  evaluatorDisagreements: number;
  languageScore: number;
}) {
  const raw = 55
    + Math.min(25, input.sourceCount * 3)
    + Math.max(-25, (input.languageScore - 70) / 2)
    - input.blockingIssues * 35
    - input.majorIssues * 12
    - input.evaluatorDisagreements * 8;
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return {
    score,
    level: score >= 85 ? "high_confidence" as const : score >= 65 ? "medium_confidence" as const : score >= 40 ? "low_confidence" as const : "insufficient_evidence" as const,
    uncertaintyRequired: score < 85,
  };
}

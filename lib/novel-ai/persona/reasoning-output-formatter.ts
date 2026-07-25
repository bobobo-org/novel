export type ReasoningSummaryInput = {
  understanding: string;
  mainPlan: string[];
  usedSettings: string[];
  keyRisks: string[];
  recommendationReason: string;
  uncertainties: string[];
};

export type PublicReasoningSummary = {
  aiUnderstanding: string;
  mainPlan: string[];
  usedStorySettings: string[];
  keyRisks: string[];
  recommendationReason: string;
  uncertainties: string[];
};

export function formatReasoningSummary(summary: ReasoningSummaryInput): PublicReasoningSummary {
  return {
    aiUnderstanding: summary.understanding,
    mainPlan: summary.mainPlan.slice(0, 8),
    usedStorySettings: summary.usedSettings.slice(0, 12),
    keyRisks: summary.keyRisks.slice(0, 8),
    recommendationReason: summary.recommendationReason,
    uncertainties: summary.uncertainties.slice(0, 8),
  };
}

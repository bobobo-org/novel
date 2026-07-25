export type RetrievalRiskSignals = {
  semanticSimilarity: number;
  sourceTrust: number;
  revisionFreshness: number;
  citationIntegrity: number;
  duplicatePenalty: number;
  poisoningRisk: number;
  storyScopeMatch: number;
};

export function scorePoisoningAwareRetrieval(signals: RetrievalRiskSignals) {
  const score = signals.semanticSimilarity * 0.3
    + signals.sourceTrust * 0.2
    + signals.revisionFreshness * 0.12
    + signals.citationIntegrity * 0.13
    + signals.storyScopeMatch * 0.2
    - signals.duplicatePenalty * 0.025
    - signals.poisoningRisk * 0.025;
  return {
    score: Math.max(0, Math.min(1, score)),
    blocked: signals.storyScopeMatch < 1 || signals.citationIntegrity < 0.5 || signals.poisoningRisk >= 0.9,
    warnings: [
      signals.duplicatePenalty > 0.5 ? "DUPLICATE_FLOOD_SUSPECTED" : null,
      signals.poisoningRisk > 0.5 ? "KNOWLEDGE_POISONING_SUSPECTED" : null,
      signals.storyScopeMatch < 1 ? "CROSS_STORY_RETRIEVAL_BLOCKED" : null,
      signals.citationIntegrity < 0.5 ? "CITATION_INTEGRITY_BLOCKED" : null,
    ].filter((value): value is string => Boolean(value)),
  };
}

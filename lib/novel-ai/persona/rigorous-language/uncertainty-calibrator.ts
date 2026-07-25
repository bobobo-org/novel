export function calibrateUncertainty(input: { confidence: number; hasDirectEvidence: boolean; claimKind: string }) {
  const confidence = Math.max(0, Math.min(1, input.confidence));
  const disclosureRequired = confidence < 0.85 || !input.hasDirectEvidence || input.claimKind === "inference";
  return {
    confidence,
    disclosureRequired,
    recommendedPrefix: disclosureRequired ? (confidence < 0.5 ? "目前證據不足，" : "依現有證據，") : "",
  };
}

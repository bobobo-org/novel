export function checkReasoningEvidence(input: {
  claims: Array<{ claim: string; evidenceRefs: string[]; kind: "fact" | "inference" | "opinion" | "fiction" }>;
  availableRefs: string[];
}) {
  const available = new Set(input.availableRefs);
  const results = input.claims.map((claim) => {
    const validRefs = claim.evidenceRefs.filter((ref) => available.has(ref));
    const supported = claim.kind !== "fact" || validRefs.length > 0;
    return { ...claim, validRefs, supported };
  });
  return {
    results,
    passed: results.every((result) => result.supported),
    unsupportedClaims: results.filter((result) => !result.supported).map((result) => result.claim),
  };
}

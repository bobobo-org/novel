export const SOURCE_GROUNDED_SYNTHESIS_VERSION = "p23a-source-grounded-synthesis-v1" as const;

export type SynthesisSource = {
  sourceRef: string;
  revision: string;
  title: string;
  text: string;
};

export type SynthesisClaim = {
  claim: string;
  evidenceRefs: string[];
  kind: "fact" | "inference" | "opinion" | "fiction_plan";
};

export function buildSourceGroundedSynthesis(input: {
  question: string;
  sources: SynthesisSource[];
  claims: SynthesisClaim[];
}) {
  const sourceMap = new Map(input.sources.map((source) => [source.sourceRef, source]));
  const claims = input.claims.map((claim) => {
    const evidence = claim.evidenceRefs
      .map((sourceRef) => sourceMap.get(sourceRef))
      .filter((source): source is SynthesisSource => Boolean(source));
    const requiresEvidence = claim.kind === "fact";
    return {
      ...claim,
      evidence: evidence.map((source) => ({
        sourceRef: source.sourceRef,
        revision: source.revision,
        title: source.title,
      })),
      supported: !requiresEvidence || evidence.length > 0,
      missingEvidenceRefs: claim.evidenceRefs.filter((sourceRef) => !sourceMap.has(sourceRef)),
    };
  });
  const factualClaims = claims.filter((claim) => claim.kind === "fact");
  const supportedFacts = factualClaims.filter((claim) => claim.supported);
  const normalized = new Map<string, typeof claims>();
  for (const claim of claims) {
    const key = claim.claim.replace(/(?:不是|並非|沒有|不會|不可)/g, "").replace(/\s+/g, "");
    normalized.set(key, [...(normalized.get(key) ?? []), claim]);
  }
  const contradictions = [...normalized.entries()]
    .filter(([, rows]) => rows.length > 1 && rows.some((row) => /(?:不是|並非|沒有|不會|不可)/.test(row.claim)) && rows.some((row) => !/(?:不是|並非|沒有|不會|不可)/.test(row.claim)))
    .map(([subject, rows]) => ({ subject, claims: rows.map((row) => row.claim), resolution: "unresolved" as const }));
  return {
    synthesisVersion: SOURCE_GROUNDED_SYNTHESIS_VERSION,
    question: input.question,
    claims,
    sourceCount: input.sources.length,
    citationCoverage: factualClaims.length ? supportedFacts.length / factualClaims.length : 1,
    unsupportedFactCount: factualClaims.length - supportedFacts.length,
    contradictions,
    unansweredQuestions: claims.filter((claim) => !claim.supported).map((claim) => `缺少「${claim.claim}」的可驗證來源。`),
    rawInternalReasoningExposed: false as const,
  };
}

import { browserFabricDigest } from "./execution-receipt";
import type { BrowserFabricModelTier } from "./types";

export type BrowserQualityCandidate = {
  tier: BrowserFabricModelTier;
  content: string;
  score: number;
  blockingCodes: string[];
  digest: string;
};

const CASCADE: BrowserFabricModelTier[] = ["MICRO", "FAST", "BALANCED", "QUALITY"];

export async function runBrowserCandidateCascade(input: {
  allowedTiers: BrowserFabricModelTier[];
  threshold: number;
  generate: (tier: BrowserFabricModelTier, previous: BrowserQualityCandidate | null) => Promise<string>;
  evaluate: (content: string, tier: BrowserFabricModelTier) => { score: number; blockingCodes: string[] };
}) {
  const candidates: BrowserQualityCandidate[] = [];
  let previous: BrowserQualityCandidate | null = null;
  for (const tier of CASCADE.filter((candidate) => input.allowedTiers.includes(candidate))) {
    const content = await input.generate(tier, previous);
    const evaluation = input.evaluate(content, tier);
    const candidate: BrowserQualityCandidate = {
      tier,
      content,
      score: evaluation.score,
      blockingCodes: evaluation.blockingCodes,
      digest: await browserFabricDigest(content.normalize("NFKC").trim()),
    };
    candidates.push(candidate);
    if (!candidate.blockingCodes.length && candidate.score >= input.threshold) {
      return { accepted: candidate, candidates, explicitEscalationRequired: false };
    }
    previous = candidate;
  }
  return { accepted: null, candidates, explicitEscalationRequired: true };
}

export async function assertDistinctRegeneration(input: {
  previousCandidateDigest: string;
  content: string;
  similarity: number;
}) {
  const digest = await browserFabricDigest(input.content.normalize("NFKC").trim());
  if (digest === input.previousCandidateDigest || input.similarity >= 0.95) {
    throw Object.assign(new Error("Regenerated candidate was not distinct."), {
      code: "REGENERATION_NOT_DISTINCT",
      normalizedDigestDifferent: digest !== input.previousCandidateDigest,
      similarity: input.similarity,
      canonicalMutationCount: 0,
    });
  }
  return { digest, normalizedDigestDifferent: true, similarity: input.similarity };
}

import { stableHash, type StoryOutcomeSnapshot, type StoryVersionCreateInput } from "./story-version-types";

function unique(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

export function createOutcomeSnapshot(input: StoryVersionCreateInput, contentHash = stableHash(input.contentText)): StoryOutcomeSnapshot {
  return {
    sceneOutcome: input.summary || input.plotConsequences?.[0] || "Scene outcome captured for version parity.",
    requiredEvents: unique(input.requiredEvents || []),
    characterChanges: unique(input.characterChanges || []),
    relationshipChanges: unique(input.relationshipChanges || []),
    plotConsequences: unique(input.plotConsequences || []),
    unresolvedConsequences: unique(input.unresolvedConsequences || []),
    canonicalFactsReferenced: unique(input.canonicalFactsReferenced || []),
    candidateFactsIntroduced: unique(input.candidateFactsIntroduced || []),
    branchId: input.branchId || "main",
    continuityVersion: "h2p5-continuity-v1",
    consequenceCandidateIds: unique(input.consequenceCandidateIds || []),
    contentHash,
  };
}


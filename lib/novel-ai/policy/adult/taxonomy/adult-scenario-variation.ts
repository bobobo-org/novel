import type { ScenarioProposal } from "./adult-taxonomy-types";

export function createAdultScenarioVariation(proposal: ScenarioProposal, seed = "default") {
  const variant = stablePick(["quiet", "charged", "guarded", "reflective"], `${proposal.proposalId}|${seed}|style`);
  const focus = stablePick(proposal.selectedTags.length ? proposal.selectedTags : ["relationship_turn"], `${proposal.proposalId}|${seed}|focus`);
  return {
    ...proposal,
    proposalId: `${proposal.proposalId}_${stableHash(seed).slice(0, 6)}`,
    recommendationReasons: [...proposal.recommendationReasons, `Variation style: ${variant}`, `Variation focus: ${focus}`],
    stagePlan: proposal.stagePlan.map((step, index) => `${step}: ${variant} beat ${index + 1}`),
  };
}

function stablePick(values: string[], seed: string) {
  return values[Number.parseInt(stableHash(seed).slice(0, 8), 16) % values.length];
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

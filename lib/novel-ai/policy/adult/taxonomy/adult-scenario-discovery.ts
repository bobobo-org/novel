import { ADULT_SCENARIO_PACKS } from "./adult-taxonomy-registry";
import { rankAdultScenarios, type ScenarioRankingContext } from "./adult-scenario-ranking";

export function discoverAdultScenarios(context: ScenarioRankingContext) {
  return rankAdultScenarios(ADULT_SCENARIO_PACKS, context);
}

export function surpriseAdultScenario(context: ScenarioRankingContext) {
  const proposals = discoverAdultScenarios({ ...context, limit: Math.max(context.limit ?? 1, 8) });
  if (!proposals.length) return null;
  const seed = context.seed ?? context.projectId;
  return proposals[stableIndex(seed, proposals.length)];
}

function stableIndex(seed: string, size: number) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % size;
}

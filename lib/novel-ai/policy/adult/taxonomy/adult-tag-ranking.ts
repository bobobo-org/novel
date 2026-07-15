import type { AdultScenarioPack, AdultTaxonomyTag } from "./adult-taxonomy-types";

export type TagRankingInput = {
  preferredTagWeights?: Record<string, number>;
  excludedTagIds?: string[];
  recentlyUsedScenarioIds?: string[];
  favoriteScenarioIds?: string[];
};

export function scoreTag(tag: AdultTaxonomyTag, input: TagRankingInput = {}) {
  if (input.excludedTagIds?.includes(tag.tagId)) return Number.NEGATIVE_INFINITY;
  const preference = input.preferredTagWeights?.[tag.tagId] ?? 0;
  return tag.defaultWeight + preference * tag.preferenceWeight + tag.noveltyWeight - Math.max(0, preference - 3) * tag.repetitionWeight;
}

export function scoreScenarioTags(pack: AdultScenarioPack, input: TagRankingInput = {}) {
  if (pack.compatibleTags.some((tagId) => input.excludedTagIds?.includes(tagId))) return Number.NEGATIVE_INFINITY;
  const preferenceScore = pack.compatibleTags.reduce((sum, tagId) => sum + (input.preferredTagWeights?.[tagId] ?? 0), 0);
  const favoriteBoost = input.favoriteScenarioIds?.includes(pack.scenarioPackId) ? 4 : 0;
  const repetitionPenalty = input.recentlyUsedScenarioIds?.includes(pack.scenarioPackId) ? 5 : 0;
  return preferenceScore + favoriteBoost - repetitionPenalty;
}

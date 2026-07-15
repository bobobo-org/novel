import type { AdultRating } from "../adult-policy-types";
import { ADULT_TAXONOMY_TAGS } from "./adult-taxonomy-registry";
import { scoreScenarioTags } from "./adult-tag-ranking";
import type { AdultScenarioPack, ScenarioDiscoveryInput, ScenarioProposal } from "./adult-taxonomy-types";

const RATING_ORDER: AdultRating[] = ["E0", "E1", "E2", "E3", "E4", "E5"];

export type ScenarioRankingContext = ScenarioDiscoveryInput & {
  preferredTagWeights?: Record<string, number>;
  excludedTagIds?: string[];
  recentlyUsedScenarioIds?: string[];
  favoriteScenarioIds?: string[];
  hiddenScenarioIds?: string[];
};

export function rankAdultScenarios(packs: AdultScenarioPack[], context: ScenarioRankingContext): ScenarioProposal[] {
  const selectedTags = new Set(context.selectedTags ?? []);
  const policyRating = context.policyRating ?? "E0";
  const result = packs
    .filter((pack) => pack.enabled)
    .filter((pack) => !context.hiddenScenarioIds?.includes(pack.scenarioPackId))
    .filter((pack) => !context.excludeRecentlyUsed || !context.recentlyUsedScenarioIds?.includes(pack.scenarioPackId))
    .map((pack) => {
      const policyStatus = ratingAllowed(pack.ratingRange[0], policyRating) ? "allowed" : "blocked_by_rating";
      const selectedMatch = pack.compatibleTags.filter((tagId) => selectedTags.has(tagId)).length;
      const stageMatch = context.relationshipStage && pack.requiredRelationshipStages.includes(context.relationshipStage) ? 2 : 0;
      const preferenceScore = scoreScenarioTags(pack, context);
      const compatibilityScore = selectedMatch * 2 + stageMatch + storyFactScore(pack, context.storyFacts ?? []);
      const repetitionPenalty = context.recentlyUsedScenarioIds?.includes(pack.scenarioPackId) ? 5 : 0;
      const freshnessScore = repetitionPenalty ? 0 : 3;
      const noveltyScore = pack.compatibleTags.some((tagId) => !selectedTags.has(tagId)) ? 1 : 0;
      const proposal = toProposal(pack, {
        context,
        preferenceScore,
        compatibilityScore,
        noveltyScore,
        freshnessScore,
        repetitionPenalty,
        policyStatus,
      });
      return { proposal, score: preferenceScore + compatibilityScore + noveltyScore + freshnessScore - repetitionPenalty - (policyStatus === "blocked_by_rating" ? 100 : 0) };
    })
    .filter((item) => item.score > Number.NEGATIVE_INFINITY)
    .sort((a, b) => b.score - a.score || a.proposal.scenarioPackId.localeCompare(b.proposal.scenarioPackId))
    .map((item) => item.proposal);
  return result.slice(0, context.limit ?? 8);
}

function toProposal(pack: AdultScenarioPack, input: {
  context: ScenarioRankingContext;
  preferenceScore: number;
  compatibilityScore: number;
  noveltyScore: number;
  freshnessScore: number;
  repetitionPenalty: number;
  policyStatus: ScenarioProposal["policyStatus"];
}): ScenarioProposal {
  const seed = input.context.seed ?? input.context.projectId;
  const location = pick(pack.locationOptions, `${seed}|${pack.scenarioPackId}|location`);
  const emotionalTone = pick(pack.emotionalToneOptions, `${seed}|${pack.scenarioPackId}|tone`);
  const names = pack.compatibleTags.map((tagId) => ADULT_TAXONOMY_TAGS.find((tag) => tag.tagId === tagId)?.displayName ?? tagId);
  return {
    proposalId: `proposal_${stableHash(`${input.context.projectId}|${pack.scenarioPackId}|${seed}`).slice(0, 16)}`,
    scenarioPackId: pack.scenarioPackId,
    selectedTags: pack.compatibleTags,
    premise: pack.premise,
    participantRoles: pack.participantRoles,
    relationshipRequirements: pack.requiredRelationshipStages,
    location,
    emotionalTone,
    requiredSetup: pack.requiredSetup,
    stagePlan: pack.stageTemplate,
    narrativePurpose: pack.narrativePurpose,
    consequencePlan: pack.consequenceTemplate,
    preferenceScore: input.preferenceScore,
    compatibilityScore: input.compatibilityScore,
    noveltyScore: input.noveltyScore,
    freshnessScore: input.freshnessScore,
    repetitionPenalty: input.repetitionPenalty,
    policyRisk: input.policyStatus === "blocked_by_rating" ? 5 : 0,
    recommendationReasons: [`Scenario tags: ${names.join(", ")}`, `Location candidate: ${location}`, `Tone candidate: ${emotionalTone}`],
    policyStatus: input.policyStatus,
  };
}

function storyFactScore(pack: AdultScenarioPack, storyFacts: string[]) {
  const text = storyFacts.join(" ").toLowerCase();
  return pack.compatibleTags.reduce((sum, tag) => sum + (text.includes(tag.replace(/_/g, " ")) ? 1 : 0), 0);
}

function ratingAllowed(required: AdultRating, policy: AdultRating) {
  return RATING_ORDER.indexOf(policy) >= RATING_ORDER.indexOf(required);
}

function pick(values: string[], seed: string) {
  if (!values.length) return "";
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

import { assertCharacterCanAct, type TimelineActivityMode } from "./temporal-query";
import type {
  CharacterActionCandidate,
  CharacterActorContext,
  CharacterAgentProfile,
  CharacterAgentState,
  CharacterBelief,
  CharacterGoalPlan,
  CharacterRelationshipEdge,
} from "./types";

function candidateId(seed: string, key: "A" | "B" | "C") {
  return `action:${seed}:${key}`;
}

export function planActionCandidates(input: {
  seed: string;
  actorContext: CharacterActorContext;
  profile: CharacterAgentProfile;
  state: CharacterAgentState;
  goalPlan: CharacterGoalPlan;
  beliefs: CharacterBelief[];
  relationships: CharacterRelationshipEdge[];
  mode?: TimelineActivityMode;
}): CharacterActionCandidate[] {
  assertCharacterCanAct({ lifeStatus: input.state.lifeStatus, mode: input.mode ?? "PRESENT_ACTION" });
  const goal = input.goalPlan.selectedGoal ?? "先觀察現況";
  const target = input.actorContext.relationshipView[0]?.toCharacterId ?? null;
  const knownIds = input.actorContext.allowedKnowledge.map((record) => record.knowledgeId);
  const supportedCapabilities = input.profile.capabilities.support === "SUPPORTED" ? (input.profile.capabilities.value ?? []) : [];
  const capability = supportedCapabilities[0] ?? "一般觀察與溝通";
  const falseBelief = input.beliefs.find((belief) =>
    belief.characterId === input.profile.characterId
    && (belief.beliefStatus === "BELIEVED_FALSE" || belief.beliefStatus === "BELIEVED_TRUE")
    && belief.beliefStrength >= 60);
  const base = {
    characterId: input.profile.characterId,
    knowledgeIds: knownIds,
    capabilityRequirements: [capability],
    locationId: input.state.locationId,
    timelinePosition: input.state.timelinePosition,
    canonicalMutation: 0 as const,
  };
  const relationship = (trust: number, conflict: number) => target
    ? { [target]: { trust, conflict } }
    : {};
  return [
    {
      ...base,
      candidateId: candidateId(input.seed, "A"),
      key: "A",
      label: "穩健推進",
      action: `留在${input.state.locationId ?? "目前位置"}，先以${capability}確認可見線索，再推進「${goal}」。`,
      rationale: "符合目前目標、位置、生命狀態與已支持能力。",
      relationshipImpact: relationship(2, -1),
      futureRisk: 20,
      influencedByBeliefIds: [],
    },
    {
      ...base,
      candidateId: candidateId(input.seed, "B"),
      key: "B",
      label: "提高壓力",
      action: `在不離開${input.state.locationId ?? "目前場景"}的前提下，公開提出質疑，迫使阻力方立即回應「${goal}」。`,
      rationale: "仍在角色能力內，但會提高衝突與後續風險。",
      relationshipImpact: relationship(-4, 8),
      futureRisk: 68,
      influencedByBeliefIds: [],
    },
    {
      ...base,
      candidateId: candidateId(input.seed, "C"),
      key: "C",
      label: "受私人判斷影響",
      action: falseBelief
        ? `因仍相信「${falseBelief.proposition}」，選擇暫緩直接表態，改以可觀察行動驗證這項判斷。`
        : `因私人界線與未確定動機，先保留關鍵立場，改以低風險試探確認對方反應。`,
      rationale: falseBelief ? "此選項明確受到角色信念影響，但不把信念當成 Canonical Truth。" : "此選項反映私人動機與不確定性。",
      relationshipImpact: relationship(-1, 3),
      futureRisk: 48,
      influencedByBeliefIds: falseBelief ? [falseBelief.beliefId] : [],
    },
  ];
}

export function materiallyDistinctActions(candidates: CharacterActionCandidate[]) {
  return candidates.length === 3
    && new Set(candidates.map((candidate) => candidate.key)).size === 3
    && new Set(candidates.map((candidate) => candidate.action.trim())).size === 3
    && new Set(candidates.map((candidate) => candidate.futureRisk)).size === 3;
}

import type { CharacterAgentProfile, CharacterAgentState, CharacterBelief, CharacterGoalPlan } from "./types";

export function planCharacterGoal(input: {
  profile: CharacterAgentProfile;
  state: CharacterAgentState;
  beliefs: CharacterBelief[];
  observations: string[];
}): CharacterGoalPlan {
  if (input.state.lifeStatus === "dead") {
    return {
      selectedGoal: null,
      activeGoals: [],
      goalPriorities: {},
      plan: [],
      conflicts: ["角色已死亡，不能規劃新的主動行動。"],
      sourceReferenceIds: [],
    };
  }
  const supportedGoals = input.profile.goals.support === "SUPPORTED" ? (input.profile.goals.value ?? []) : [];
  const activeGoals = [...new Set([...input.state.activeGoals, ...supportedGoals])];
  const goalPriorities = Object.fromEntries(activeGoals.map((goal, index) => [
    goal,
    input.state.goalPriorities[goal] ?? Math.max(1, 100 - index * 10),
  ]));
  const selectedGoal = [...activeGoals].sort((a, b) => goalPriorities[b] - goalPriorities[a] || a.localeCompare(b))[0] ?? null;
  const suspicious = input.beliefs.find((belief) => belief.beliefStatus === "SUSPICIOUS" || belief.beliefStatus === "BELIEVED_FALSE");
  const plan = selectedGoal
    ? [
        `先確認目前場景中與「${selectedGoal}」直接相關的可觀察事實。`,
        suspicious ? `保留對「${suspicious.proposition}」的疑慮，不把它當成正式真相。` : "依角色目前確知的資訊選擇可執行步驟。",
        "採取不超出角色能力、位置與資源的行動，並觀察後果。",
      ]
    : [];
  return {
    selectedGoal,
    activeGoals,
    goalPriorities,
    plan,
    conflicts: activeGoals.filter((goal) => input.profile.privateBoundaries.some((boundary) => goal.includes(boundary))),
    sourceReferenceIds: input.profile.goals.sourceReferences.map((reference) => reference.referenceId),
  };
}

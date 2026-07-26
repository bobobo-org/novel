export const CHARACTER_AGENT_STORE_NAMES = [
  "characterAgentProfiles",
  "characterAgentStates",
  "characterKnowledge",
  "characterBeliefs",
  "characterMemories",
  "characterRelationships",
  "characterRelationshipEvents",
  "characterPrivateArcs",
  "characterSimulations",
  "characterSimulationTurns",
  "characterAgentEvaluations",
  "characterProposals",
  "characterAgentApprovals",
  "characterAgentAudit",
] as const;

export type CharacterAgentStoreName = (typeof CHARACTER_AGENT_STORE_NAMES)[number];

import type { Character, StoryState } from "../domain";
import type {
  CharacterAgentProfile,
  CharacterAgentState,
  CharacterBelief,
  CharacterMemory,
  CharacterPrivateArc,
  CharacterRelationshipEdge,
  CharacterCanonContext,
} from "./types";
import { makeCharacterAgentRecord } from "./record-factory";

export function projectCharacterAgentState(input: {
  projectId: string;
  sourceRevision: number;
  timelinePosition: string;
  character: Character;
  canonContext: CharacterCanonContext;
  profile: CharacterAgentProfile;
  storyState?: StoryState | null;
  beliefs?: CharacterBelief[];
  memories?: CharacterMemory[];
  relationships?: CharacterRelationshipEdge[];
  privateArcs?: CharacterPrivateArc[];
  knownKnowledgeIds?: string[];
  emotionalState?: Record<string, number>;
}): CharacterAgentState {
  const record = makeCharacterAgentRecord(input.projectId, "system");
  const supportedGoals = input.profile.goals.support === "SUPPORTED" ? (input.profile.goals.value ?? []) : [];
  const supportedCapabilities = input.profile.capabilities.support === "SUPPORTED" ? (input.profile.capabilities.value ?? []) : [];
  return {
    ...record,
    id: record.id,
    stateId: record.id,
    characterId: input.character.id,
    canonContextId: input.canonContext.canonContextId,
    sourceRevision: input.sourceRevision,
    timelinePosition: input.timelinePosition,
    locationId: input.character.locationId,
    lifeStatus: input.character.lifeStatus,
    physicalCondition: [],
    emotionalState: { neutral: 50, ...(input.emotionalState ?? {}) },
    activeGoals: supportedGoals,
    goalPriorities: Object.fromEntries(supportedGoals.map((goal, index) => [goal, Math.max(1, 100 - index * 10)])),
    availableResources: supportedCapabilities,
    inventoryReferences: [...(input.storyState?.inventory ?? [])],
    commitments: [],
    currentConflicts: [],
    relationshipEdgeIds: (input.relationships ?? []).filter((edge) => edge.fromCharacterId === input.character.id).map((edge) => edge.id),
    knownKnowledgeIds: [...(input.knownKnowledgeIds ?? [])],
    beliefIds: (input.beliefs ?? []).filter((belief) => belief.characterId === input.character.id).map((belief) => belief.id),
    memoryIds: (input.memories ?? []).filter((memory) => memory.characterId === input.character.id).map((memory) => memory.id),
    privateArcIds: (input.privateArcs ?? []).filter((arc) => arc.characterId === input.character.id).map((arc) => arc.id),
    status: "DERIVED",
    effectiveFromTimelinePosition: input.timelinePosition,
    effectiveToTimelinePosition: null,
    canonicalMutation: 0,
  };
}

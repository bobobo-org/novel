import type {
  CharacterActorContext,
  CharacterBelief,
  CharacterCanonContext,
  CharacterEvaluatorContext,
  CharacterKnowledgeRecord,
  CharacterMemory,
  CharacterPerspectiveContext,
  CharacterRelationshipEdge,
} from "./types";
import { buildKnowledgeScopedContext, selectAllowedKnowledge } from "./knowledge-gateway";
import { canUseCharacterMemory } from "./memory-promotion-gate";
import { beliefsAsOf, relationshipsAsOf } from "./temporal-query";

export async function buildActorPerspectiveContext(input: {
  projectId: string;
  characterId: string;
  timelinePosition: string;
  knowledge: CharacterKnowledgeRecord[];
  factionIdsAtTimeline?: string[];
  revealedConditionIds?: string[];
  canonContext: CharacterCanonContext;
}) {
  const context = await buildKnowledgeScopedContext({
    ...input,
    records: input.knowledge,
    kind: "ACTOR",
    canonContextId: input.canonContext.canonContextId,
    sourceCanonContextId: input.canonContext.sourceCanonContextId,
  });
  return { context, knowledge: selectAllowedKnowledge(context, input.knowledge) };
}

export async function buildEvaluatorPerspectiveContext(input: {
  projectId: string;
  characterId: string;
  timelinePosition: string;
  knowledge: CharacterKnowledgeRecord[];
  evaluatorAuthorized: boolean;
  canonContext: CharacterCanonContext;
}): Promise<{ context: CharacterPerspectiveContext; knowledge: CharacterKnowledgeRecord[] }> {
  const context = await buildKnowledgeScopedContext({
    ...input,
    records: input.knowledge,
    kind: "EVALUATOR",
    canonContextId: input.canonContext.canonContextId,
    sourceCanonContextId: input.canonContext.sourceCanonContextId,
  });
  return { context, knowledge: selectAllowedKnowledge(context, input.knowledge) };
}

export async function buildCharacterActorContext(input: {
  canonContext: CharacterCanonContext;
  characterId: string;
  knowledge: CharacterKnowledgeRecord[];
  beliefs: CharacterBelief[];
  memories: CharacterMemory[];
  goals: string[];
  relationships: CharacterRelationshipEdge[];
  observableEvents: string[];
  allowedWorldRules: string[];
  allowedSceneData: string[];
  factionIdsAtTimeline?: string[];
  revealedConditionIds?: string[];
}): Promise<CharacterActorContext> {
  const scoped = await buildActorPerspectiveContext({
    projectId: input.canonContext.projectId,
    characterId: input.characterId,
    timelinePosition: input.canonContext.timelinePosition,
    knowledge: input.knowledge,
    factionIdsAtTimeline: input.factionIdsAtTimeline,
    revealedConditionIds: input.revealedConditionIds,
    canonContext: input.canonContext,
  });
  const allowedIds = new Set(scoped.context.allowedKnowledgeIds);
  return {
    contextId: scoped.context.contextId,
    canonContext: structuredClone(input.canonContext),
    characterId: input.characterId,
    observableEvents: [...input.observableEvents],
    allowedKnowledge: input.knowledge.filter((record) => allowedIds.has(record.knowledgeId)),
    beliefs: beliefsAsOf(input.beliefs, input.canonContext.timelinePosition).filter((belief) =>
      belief.projectId === input.canonContext.projectId
      && belief.characterId === input.characterId
      && (belief.canonContextId === input.canonContext.canonContextId || belief.canonContextId === input.canonContext.sourceCanonContextId)),
    memories: input.memories.filter((memory) =>
      memory.projectId === input.canonContext.projectId
      && memory.characterId === input.characterId
      && canUseCharacterMemory({
        memory,
        canonContext: input.canonContext,
        characterId: input.characterId,
        privateSimulationSessionId: input.canonContext.privateSimulationSessionId,
      })),
    goals: [...input.goals],
    relationshipView: relationshipsAsOf(input.relationships, input.canonContext.timelinePosition).filter((relationship) =>
      relationship.projectId === input.canonContext.projectId
      && relationship.fromCharacterId === input.characterId
      && (relationship.canonContextId === input.canonContext.canonContextId || relationship.canonContextId === input.canonContext.sourceCanonContextId)),
    allowedWorldRules: [...input.allowedWorldRules],
    allowedSceneData: [...input.allowedSceneData],
    informationFlowTrace: scoped.context.informationFlowTrace,
  };
}

export async function buildCharacterEvaluatorContext(input: {
  canonContext: CharacterCanonContext;
  characterId: string;
  knowledge: CharacterKnowledgeRecord[];
  futureForeshadowing: string[];
  globalTimeline: string[];
  privateCharacterData: string[];
  consistencyConstraints: string[];
  evaluatorAuthorized: boolean;
}): Promise<CharacterEvaluatorContext> {
  const scoped = await buildEvaluatorPerspectiveContext({
    projectId: input.canonContext.projectId,
    characterId: input.characterId,
    timelinePosition: input.canonContext.timelinePosition,
    knowledge: input.knowledge,
    evaluatorAuthorized: input.evaluatorAuthorized,
    canonContext: input.canonContext,
  });
  return {
    contextId: scoped.context.contextId,
    canonContext: structuredClone(input.canonContext),
    characterId: input.characterId,
    canonicalTruth: scoped.knowledge,
    authorOnlyKnowledge: scoped.knowledge.filter((record) => record.scope === "AUTHOR_ONLY"),
    futureForeshadowing: [...input.futureForeshadowing],
    globalTimeline: [...input.globalTimeline],
    privateCharacterData: [...input.privateCharacterData],
    consistencyConstraints: [...input.consistencyConstraints],
    informationFlowTrace: scoped.context.informationFlowTrace,
  };
}

export function actorContextSemanticProjection(context: CharacterActorContext) {
  return {
    characterId: context.characterId,
    observableEvents: context.observableEvents,
    allowedKnowledgeIds: context.allowedKnowledge.map((record) => record.knowledgeId),
    beliefs: context.beliefs.map((belief) => belief.beliefId),
    memories: context.memories.map((memory) => memory.memoryId),
    goals: context.goals,
    relationships: context.relationshipView.map((relationship) => relationship.relationshipId),
    allowedWorldRules: context.allowedWorldRules,
    allowedSceneData: context.allowedSceneData,
  };
}

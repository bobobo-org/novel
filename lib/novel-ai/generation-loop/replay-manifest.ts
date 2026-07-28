import { stableId, type StoryContext } from "../story-intelligence";

export const GENERATION_REPLAY_SCHEMA_VERSION = "p23-generation-replay-v1" as const;
export const GENERATION_EVALUATOR_VERSION = "p23-generation-evaluator-v1" as const;

export type GenerationReplayManifest = {
  schemaVersion: typeof GENERATION_REPLAY_SCHEMA_VERSION;
  taskId: string;
  storyRevision: number;
  provider: string;
  modelName: string;
  modelDigest: string | null;
  promptProfileVersion: string;
  personaProfileVersion: string;
  storyBibleVersion: string;
  retrievalQueryHash: string;
  retrievedChunkIds: string[];
  contextHash: string;
  generationParameters: Record<string, string | number | boolean | null>;
  seed: number | null;
  evaluatorVersion: string;
  revisionRound: number;
  candidateHash: string;
};

function contextMemories(context: StoryContext) {
  return [
    ...context.currentScene,
    ...context.recentContext,
    ...context.characterContext,
    ...context.worldContext,
    ...context.plotContext,
    ...context.foreshadowingContext,
  ];
}

export function buildGenerationReplayManifest(input: {
  taskId: string;
  storyRevision: number;
  provider: string;
  modelName: string;
  modelDigest?: string | null;
  promptProfileVersion: string;
  personaProfileVersion: string;
  storyBibleVersion: string;
  retrievalQuery: string;
  context: StoryContext;
  generationParameters?: Record<string, string | number | boolean | null>;
  seed?: number | null;
  revisionRound: number;
  candidate: string;
}): GenerationReplayManifest {
  const memories = contextMemories(input.context);
  return {
    schemaVersion: GENERATION_REPLAY_SCHEMA_VERSION,
    taskId: input.taskId,
    storyRevision: input.storyRevision,
    provider: input.provider,
    modelName: input.modelName,
    modelDigest: input.modelDigest ?? null,
    promptProfileVersion: input.promptProfileVersion,
    personaProfileVersion: input.personaProfileVersion,
    storyBibleVersion: input.storyBibleVersion,
    retrievalQueryHash: stableId("retrieval-query", input.retrievalQuery),
    retrievedChunkIds: memories.map((memory) => memory.memoryId),
    contextHash: stableId("context", memories.map((memory) => ({
      memoryId: memory.memoryId,
      revision: memory.source.sourceRevision,
      contentHash: memory.metadata.taint?.contentHash ?? null,
    }))),
    generationParameters: { ...(input.generationParameters ?? {}) },
    seed: input.seed ?? null,
    evaluatorVersion: GENERATION_EVALUATOR_VERSION,
    revisionRound: input.revisionRound,
    candidateHash: stableId("candidate-content", input.candidate),
  };
}

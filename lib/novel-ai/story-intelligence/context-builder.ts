import { rankMemories } from "./memory-ranker";
import { applyTokenBudget, estimateTokens } from "./token-budgeter";
import { P22_STORY_INTELLIGENCE_VERSION, type RankedMemory, type StoryContext, type TraceableMemory } from "./types";

function uniqueSources(memories: RankedMemory[]) {
  const seen = new Set<string>();
  return memories.map((memory) => memory.source).filter((source) => {
    const key = `${source.sourceChapterId}:${source.sourceRevision}:${source.start}:${source.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function group(memories: RankedMemory[], kinds: TraceableMemory["kind"][]) {
  return memories.filter((memory) => kinds.includes(memory.kind));
}

export function buildStoryContext(input: {
  task: string;
  authorInstruction: string;
  memories: TraceableMemory[];
  constraints?: string[];
  styleProfile?: string[];
  tokenLimit?: number;
  reservedOutput?: number;
}): StoryContext {
  const ranked = rankMemories(`${input.task} ${input.authorInstruction}`, input.memories);
  const fixedTokens = estimateTokens([
    input.task,
    input.authorInstruction,
    ...(input.constraints ?? []),
    ...(input.styleProfile ?? []),
  ].join("\n"));
  const { selected, budget } = applyTokenBudget(ranked, {
    limit: input.tokenLimit ?? 8192,
    reservedOutput: input.reservedOutput ?? 1800,
    fixedTokens,
  });
  return {
    schemaVersion: P22_STORY_INTELLIGENCE_VERSION,
    task: `${input.task}\n${input.authorInstruction}`.trim(),
    currentScene: group(selected, ["current_scene"]),
    recentContext: group(selected, ["recent_chapter", "accepted_choice"]),
    characterContext: group(selected, ["character", "relationship"]),
    worldContext: group(selected, ["world_rule"]),
    plotContext: group(selected, ["event", "plot_thread", "note"]),
    foreshadowingContext: group(selected, ["foreshadowing"]),
    constraints: input.constraints ?? [],
    styleProfile: input.styleProfile ?? [],
    tokenBudget: budget,
    sourceReferences: uniqueSources(selected),
  };
}

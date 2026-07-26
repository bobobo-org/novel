import type { KnowledgeScope } from "../drama-os/knowledge-scope";
import { timelineAtOrBefore } from "./temporal-query";
import type { CharacterCanonContext, CharacterMemory } from "./types";

export type MemorySelectionInput = {
  projectId: string;
  characterId: string;
  timelinePosition: string;
  currentGoal: string | null;
  currentSceneId: string | null;
  relatedCharacterIds: string[];
  emotionalState: Record<string, number>;
  allowedKnowledgeScopes?: KnowledgeScope[];
  limit?: number;
  now?: string;
  canonContext: CharacterCanonContext;
  privateSimulationSessionId?: string | null;
};

function tokenSet(value: string) {
  return new Set(value.toLocaleLowerCase().split(/[\s,，。；;：:、!?！？]+/u).filter(Boolean));
}

function overlap(left: string, right: string) {
  if (!left || !right) return 0;
  const a = tokenSet(left);
  const b = tokenSet(right);
  return [...a].filter((token) => b.has(token)).length;
}

export function selectCharacterMemories(memories: CharacterMemory[], input: MemorySelectionInput) {
  const emotionalIntensity = Object.values(input.emotionalState).reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  const allowedScopes = new Set(input.allowedKnowledgeScopes ?? ["PUBLIC", "CHARACTER_KNOWN", "FACTION_KNOWN", "FUTURE_REVEAL"]);
  const now = Date.parse(input.now ?? new Date().toISOString());
  return memories
    .filter((memory) =>
      memory.projectId === input.projectId
      && memory.characterId === input.characterId
      && (memory.canonContextId === input.canonContext.canonContextId || memory.canonContextId === input.canonContext.sourceCanonContextId)
      && timelineAtOrBefore(memory.timelinePosition, input.timelinePosition)
      && timelineAtOrBefore(memory.usableAfterTimelinePosition, input.timelinePosition)
      && allowedScopes.has(memory.visibility)
      && (
        memory.approvalStatus === "APPROVED"
        || (
          input.canonContext.canonType === "PRIVATE_SIMULATION"
          && memory.approvalStatus === "PRIVATE_ONLY"
          && memory.privateSimulationSessionId === input.privateSimulationSessionId
        )
      )
      && !(memory.originType === "RUMOR" && memory.truthStatus === "TRUE" && memory.sourceEventIds.length === 0))
    .map((memory) => {
      const ageDays = Math.max(0, (now - Date.parse(memory.updatedAt)) / 86_400_000);
      const recency = Math.max(0, 20 - Math.log2(ageDays + 1) * 4);
      const goal = overlap(memory.summary, input.currentGoal ?? "") * 8;
      const scene = input.currentSceneId && memory.sourceSceneId === input.currentSceneId ? 18 : 0;
      const relationship = memory.relatedCharacterIds.some((id) => input.relatedCharacterIds.includes(id)) ? 15 : 0;
      const emotion = emotionalIntensity > 50 ? Math.abs(memory.emotionalValence) / 10 : 0;
      const score = memory.salience * 0.45 + recency + goal + scene + relationship + emotion;
      return { memory, score: Math.round(score * 100) / 100 };
    })
    .sort((a, b) => b.score - a.score || b.memory.updatedAt.localeCompare(a.memory.updatedAt) || a.memory.id.localeCompare(b.memory.id))
    .slice(0, Math.max(1, Math.min(input.limit ?? 8, 30)));
}

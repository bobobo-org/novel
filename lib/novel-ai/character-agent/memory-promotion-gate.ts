import { CharacterAgentError } from "./errors";
import { timelineAtOrBefore } from "./temporal-query";
import type { CharacterCanonContext, CharacterMemory } from "./types";

export function canUseCharacterMemory(input: {
  memory: CharacterMemory;
  canonContext: CharacterCanonContext;
  characterId: string;
  privateSimulationSessionId?: string | null;
}) {
  const { memory, canonContext } = input;
  if (
    memory.projectId !== canonContext.projectId
    || memory.characterId !== input.characterId
    || memory.freshnessStatus !== "CURRENT"
    || (memory.canonContextId !== canonContext.canonContextId && memory.canonContextId !== canonContext.sourceCanonContextId)
    || !memory.usableInCanonTypes.includes(canonContext.canonType)
    || !timelineAtOrBefore(memory.timelinePosition, canonContext.timelinePosition)
    || !timelineAtOrBefore(memory.usableAfterTimelinePosition, canonContext.timelinePosition)
  ) return false;
  if (memory.approvalStatus === "APPROVED") return true;
  return canonContext.canonType === "PRIVATE_SIMULATION"
    && memory.approvalStatus === "PRIVATE_ONLY"
    && memory.privateSimulationSessionId === input.privateSimulationSessionId;
}

export function promoteCharacterMemory(memory: CharacterMemory, approvedByUser: boolean) {
  if (!approvedByUser) throw new CharacterAgentError("MEMORY_APPROVAL_REQUIRED", "AI 產生的記憶需要使用者核准。");
  if (memory.freshnessStatus !== "CURRENT") throw new CharacterAgentError("STALE_MEMORY_PROMOTION_BLOCKED", "記憶來源版本已更新，請重新產生。");
  if (memory.originType === "PRIVATE_SIMULATION" || memory.approvalStatus === "PRIVATE_ONLY") {
    throw new CharacterAgentError("PRIVATE_MEMORY_CANON_PROMOTION_BLOCKED", "私人模擬記憶不得寫入正式角色記憶。");
  }
  if (memory.originType === "RUMOR" && memory.truthStatus === "TRUE" && !memory.sourceEventIds.length) {
    throw new CharacterAgentError("RUMOR_TRUTH_PROMOTION_BLOCKED", "傳聞需要 Canonical 事件證實才可標為 TRUE。");
  }
  return {
    ...memory,
    approvalStatus: "APPROVED" as const,
    parentRevision: memory.revision,
    revision: memory.revision + 1,
    updatedAt: new Date().toISOString(),
  };
}

export function assertNoSelfReinforcingMemoryLoop(input: {
  candidate: CharacterMemory;
  sourceMemories: CharacterMemory[];
}) {
  if (
    input.candidate.originType === "AGENT_GENERATED"
    && input.candidate.sourceEventIds.some((id) => input.sourceMemories.some((memory) =>
      memory.memoryId === id && memory.originType === "AGENT_GENERATED" && memory.approvalStatus !== "APPROVED"))
  ) {
    throw new CharacterAgentError("SELF_REINFORCING_MEMORY_LOOP_BLOCKED", "未核准的 Agent 記憶不能因自我引用而提高可信度。");
  }
  return true;
}

import type { RankedMemory } from "./types";

export function estimateTokens(text: string) {
  const han = (text.match(/\p{Script=Han}/gu) ?? []).length;
  const other = Math.max(0, text.length - han);
  return Math.max(1, Math.ceil(han / 1.6 + other / 4));
}

export function applyTokenBudget(memories: RankedMemory[], options: {
  limit: number;
  reservedOutput: number;
  fixedTokens?: number;
}) {
  const available = Math.max(0, options.limit - options.reservedOutput - (options.fixedTokens ?? 0));
  const selected: RankedMemory[] = [];
  const omittedMemoryIds: string[] = [];
  let used = 0;
  for (const memory of memories) {
    const tokens = memory.estimatedTokens || estimateTokens(memory.text);
    if (used + tokens <= available) {
      selected.push({ ...memory, estimatedTokens: tokens });
      used += tokens;
    } else {
      omittedMemoryIds.push(memory.memoryId);
    }
  }
  return {
    selected,
    budget: {
      limit: options.limit,
      reservedOutput: options.reservedOutput,
      used: used + (options.fixedTokens ?? 0),
      remaining: Math.max(0, options.limit - options.reservedOutput - used - (options.fixedTokens ?? 0)),
      omittedMemoryIds,
    },
  };
}

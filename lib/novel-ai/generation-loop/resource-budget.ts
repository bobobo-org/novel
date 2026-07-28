import type { GenerationLoopInput } from "./types";

export const GENERATION_RESOURCE_POLICY_VERSION = "p23-generation-resource-policy-v1" as const;
export type GenerationResourceBudget = {
  maxInputBytes: number;
  maxMemories: number;
  maxConcurrentPerProject: number;
  maxCritiqueRounds: 1;
};

export const DEFAULT_GENERATION_RESOURCE_BUDGET: GenerationResourceBudget = {
  maxInputBytes: 2_000_000,
  maxMemories: 5000,
  maxConcurrentPerProject: 2,
  maxCritiqueRounds: 1,
};

const activeByProject = new Map<string, number>();

export function assertGenerationResourceBudget(
  input: GenerationLoopInput,
  budget: GenerationResourceBudget = DEFAULT_GENERATION_RESOURCE_BUDGET,
) {
  const inputBytes = new TextEncoder().encode([
    input.authorInstruction,
    input.currentText,
    ...input.memories.map((memory) => memory.text),
  ].join("\n")).byteLength;
  if (inputBytes > budget.maxInputBytes) throw Object.assign(new Error("Generation input exceeds the resource budget."), { code: "GENERATION_INPUT_TOO_LARGE" });
  if (input.memories.length > budget.maxMemories) throw Object.assign(new Error("Generation memory count exceeds the resource budget."), { code: "GENERATION_MEMORY_LIMIT_EXCEEDED" });
  if ((input.maxCritiqueRounds ?? 1) > budget.maxCritiqueRounds) throw Object.assign(new Error("Critique rounds exceed the resource budget."), { code: "GENERATION_CRITIQUE_LIMIT_EXCEEDED" });
}

export function acquireGenerationSlot(projectId: string, budget: GenerationResourceBudget = DEFAULT_GENERATION_RESOURCE_BUDGET) {
  const active = activeByProject.get(projectId) ?? 0;
  if (active >= budget.maxConcurrentPerProject) {
    throw Object.assign(new Error("Generation concurrency limit reached."), { code: "GENERATION_CONCURRENCY_LIMIT" });
  }
  activeByProject.set(projectId, active + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = Math.max(0, (activeByProject.get(projectId) ?? 1) - 1);
    if (remaining) activeByProject.set(projectId, remaining);
    else activeByProject.delete(projectId);
  };
}

import type { ContextItem, ContextTokenBudgetProfile } from "./context-composer-types";

export const DEFAULT_CONTEXT_BUDGET: ContextTokenBudgetProfile = {
  modelContextLimit: 8192,
  reservedOutputTokens: 1600,
  safetyMargin: 512,
  hardConstraintBudget: 800,
  canonicalBudget: 1400,
  currentSceneBudget: 900,
  currentStageBudget: 700,
  relationshipBudget: 500,
  eventBudget: 700,
  worldRuleBudget: 500,
  retrievalBudget: 1300,
  userLibraryBudget: 350,
  publicCorpusBudget: 250,
  compressionThreshold: 0.85,
};

export function estimateContextTokens(text: string) {
  return Math.max(1, Math.ceil([...String(text || "")].length / 3));
}

export function buildTokenBudget(items: ContextItem[], profile: Partial<ContextTokenBudgetProfile> = {}) {
  const overrides = Object.fromEntries(Object.entries(profile).filter(([, value]) => value !== undefined));
  const budget = { ...DEFAULT_CONTEXT_BUDGET, ...overrides };
  const totalAvailableTokens = Math.max(0, budget.modelContextLimit - budget.reservedOutputTokens - budget.safetyMargin);
  let usedTokens = 0;
  let omittedTokens = 0;
  const selected: ContextItem[] = [];
  const omitted: Array<{ contextItemId: string; reason: string; tokenCount: number }> = [];
  for (const item of items) {
    if (usedTokens + item.tokenCount <= totalAvailableTokens) {
      selected.push(item);
      usedTokens += item.tokenCount;
    } else {
      omitted.push({ contextItemId: item.contextItemId, reason: "token_budget", tokenCount: item.tokenCount });
      omittedTokens += item.tokenCount;
    }
  }
  return {
    selected,
    omitted,
    totalAvailableTokens,
    reservedTokens: budget.reservedOutputTokens + budget.safetyMargin,
    usedTokens,
    omittedTokens,
    compressedTokens: 0,
    utilization: totalAvailableTokens ? Number((usedTokens / totalAvailableTokens).toFixed(4)) : 0,
    overflowPrevented: omitted.length > 0,
    budgetBreakdown: {
      hardConstraints: budget.hardConstraintBudget,
      canonical: budget.canonicalBudget,
      currentScene: budget.currentSceneBudget,
      retrieval: budget.retrievalBudget,
      userLibrary: budget.userLibraryBudget,
      publicCorpus: budget.publicCorpusBudget,
    },
  };
}

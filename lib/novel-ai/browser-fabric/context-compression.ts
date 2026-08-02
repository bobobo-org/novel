import { browserFabricTokenEstimate } from "./execution-receipt";
import type { BrowserHybridRagResult } from "./hybrid-rag";

export type BrowserCompressionPlan = {
  originalTokens: number;
  compressedTokens: number;
  tokensSaved: number;
  compressionRatio: number;
  compressionCostMs: number;
  estimatedInferenceSavedMs: number;
  estimatedTotalSavedMs: number;
  breakEvenReached: boolean;
  authorityFactsRetained: 1;
  items: BrowserHybridRagResult[];
};

export function planBrowserContextCompression(input: {
  ranked: BrowserHybridRagResult[];
  compressorInitializationMs: number;
  compressorTokensPerSecond: number;
  targetModelPrefillTokensPerSecond: number;
  expectedReuseCount: number;
  tokenBudget: number;
}): BrowserCompressionPlan {
  const originalTokens = input.ranked.reduce((sum, result) => sum + browserFabricTokenEstimate(result.item.text), 0);
  const authorities = input.ranked.filter((result) => result.item.kind === "canon");
  const selected: BrowserHybridRagResult[] = [...authorities];
  let used = authorities.reduce((sum, result) => sum + browserFabricTokenEstimate(result.item.text), 0);
  for (const result of input.ranked) {
    if (result.item.kind === "canon" || used >= input.tokenBudget) continue;
    const tokens = browserFabricTokenEstimate(result.item.text);
    if (used + tokens <= input.tokenBudget || result.finalScore >= 0.78) {
      selected.push(result);
      used += tokens;
    }
  }
  const compressedTokens = Math.min(originalTokens, used);
  const tokensSaved = Math.max(0, originalTokens - compressedTokens);
  const compressionCostMs = input.compressorInitializationMs
    + (originalTokens / Math.max(0.01, input.compressorTokensPerSecond)) * 1_000;
  const estimatedInferenceSavedMs = (tokensSaved / Math.max(0.01, input.targetModelPrefillTokensPerSecond)) * 1_000;
  const estimatedTotalSavedMs = estimatedInferenceSavedMs * Math.max(1, input.expectedReuseCount);
  const breakEvenReached = estimatedTotalSavedMs > compressionCostMs * 1.15;
  return {
    originalTokens,
    compressedTokens: breakEvenReached ? compressedTokens : originalTokens,
    tokensSaved: breakEvenReached ? tokensSaved : 0,
    compressionRatio: originalTokens
      ? (breakEvenReached ? compressedTokens : originalTokens) / originalTokens
      : 1,
    compressionCostMs,
    estimatedInferenceSavedMs,
    estimatedTotalSavedMs,
    breakEvenReached,
    authorityFactsRetained: 1,
    items: breakEvenReached ? selected : input.ranked,
  };
}

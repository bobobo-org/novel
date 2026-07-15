import { estimateEmbeddingTokens } from "../embeddings/embedding-normalization";

export const CHUNK_TOKEN_BUDGET = {
  minTokens: 80,
  targetTokens: 360,
  maxTokens: 500,
  overlapTokens: 0,
};

export function estimateChunkTokens(text: string) {
  return estimateEmbeddingTokens(text);
}

export function isWithinChunkTokenBudget(text: string) {
  const tokens = estimateChunkTokens(text);
  return tokens <= CHUNK_TOKEN_BUDGET.maxTokens;
}

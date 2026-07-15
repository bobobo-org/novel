import { EmbeddingProviderError } from "./embedding-errors";

export function normalizeEmbeddingText(text: string) {
  return text
    .normalize("NFKC")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function estimateEmbeddingTokens(text: string) {
  const normalized = normalizeEmbeddingText(text);
  const latinWords = normalized.match(/[A-Za-z0-9_]+/g)?.length ?? 0;
  const nonWhitespace = normalized.replace(/\s/g, "").length;
  return Math.max(1, Math.ceil(latinWords + (nonWhitespace - latinWords) / 1.8));
}

export function l2NormalizeVector(vector: number[]) {
  assertValidVector(vector);
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) throw new EmbeddingProviderError("EMBEDDING_INVALID_VECTOR", "Embedding vector magnitude is zero", { stage: "embedding-normalization" });
  return vector.map((value) => value / magnitude);
}

export function assertValidVector(vector: number[], expectedDimensions?: number) {
  if (!Array.isArray(vector) || vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
    throw new EmbeddingProviderError("EMBEDDING_INVALID_VECTOR", "Embedding vector must be a non-empty finite number array", { stage: "embedding-validation" });
  }
  if (expectedDimensions !== undefined && vector.length !== expectedDimensions) {
    throw new EmbeddingProviderError("EMBEDDING_DIMENSION_MISMATCH", `Expected ${expectedDimensions} dimensions, received ${vector.length}`, { stage: "embedding-validation" });
  }
}

export function embeddingContentHash(text: string) {
  let hash = 2166136261;
  for (const char of normalizeEmbeddingText(text)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

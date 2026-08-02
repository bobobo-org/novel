import type { BrowserFabricContextItem } from "./types";

export type BrowserHybridRagResult = {
  item: BrowserFabricContextItem;
  lexicalRank: number | null;
  denseRank: number | null;
  fusedScore: number;
  rerankerScore: number;
  authorityScore: number;
  finalScore: number;
};

function terms(text: string) {
  const normalized = text.normalize("NFKC").toLocaleLowerCase();
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const cjk = [...normalized.replace(/[^\p{Script=Han}]/gu, "")];
  return [...new Set([...words, ...cjk])];
}

function lexicalScore(query: string, text: string) {
  const queryTerms = terms(query);
  const documentTerms = terms(text);
  if (!queryTerms.length || !documentTerms.length) return 0;
  const frequencies = new Map<string, number>();
  for (const term of documentTerms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  return queryTerms.reduce((score, term) => {
    const frequency = frequencies.get(term) ?? 0;
    return score + (frequency ? (frequency * 2.2) / (frequency + 1.2) : 0);
  }, 0) / Math.sqrt(documentTerms.length + 1);
}

function cosine(left: number[], right: number[]) {
  const size = Math.min(left.length, right.length);
  if (!size) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < size; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  return leftMagnitude && rightMagnitude
    ? dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude))
    : 0;
}

function rankMap(values: Array<{ id: string; score: number }>) {
  return new Map(
    [...values]
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .map((value, index) => [value.id, index + 1]),
  );
}

export function hybridRetrieve(input: {
  query: string;
  items: BrowserFabricContextItem[];
  queryEmbedding?: number[];
  embeddings?: Record<string, number[]>;
  rerankerScores?: Record<string, number>;
  limit?: number;
}): BrowserHybridRagResult[] {
  const lexical = input.items.map((item) => ({ id: item.id, score: lexicalScore(input.query, item.text) }));
  const dense = input.items.map((item) => ({
    id: item.id,
    score: input.queryEmbedding && input.embeddings?.[item.id]
      ? cosine(input.queryEmbedding, input.embeddings[item.id])
      : 0,
  }));
  const lexicalRanks = rankMap(lexical);
  const denseRanks = rankMap(dense);
  const lexicalScores = new Map(lexical.map((item) => [item.id, item.score]));
  const denseScores = new Map(dense.map((item) => [item.id, item.score]));
  return input.items.map((item) => {
    const lexicalRank = lexicalRanks.get(item.id) ?? null;
    const denseRank = denseScores.get(item.id) ? denseRanks.get(item.id) ?? null : null;
    const fusedScore = (lexicalRank ? 1 / (60 + lexicalRank) : 0)
      + (denseRank ? 1 / (60 + denseRank) : 0);
    const rerankerScore = input.rerankerScores?.[item.id]
      ?? Math.min(1, (lexicalScores.get(item.id) ?? 0) * 0.5 + Math.max(0, denseScores.get(item.id) ?? 0) * 0.5);
    const authorityScore = item.kind === "canon"
      ? 1
      : item.kind === "story-bible"
        ? 0.85
        : item.kind === "chapter"
          ? 0.75
          : item.kind === "accepted-choice"
            ? 0.8
            : item.authorityWeight ?? 0.5;
    return {
      item,
      lexicalRank,
      denseRank,
      fusedScore,
      rerankerScore,
      authorityScore,
      finalScore: fusedScore * 18 + rerankerScore * 0.47 + authorityScore * 0.35,
    };
  }).sort((left, right) => right.finalScore - left.finalScore || left.item.id.localeCompare(right.item.id))
    .slice(0, input.limit ?? 10);
}

export function lateChunkText(input: {
  id: string;
  text: string;
  maximumCharacters?: number;
  overlapCharacters?: number;
}) {
  const maximum = Math.max(240, input.maximumCharacters ?? 900);
  const overlap = Math.min(maximum - 1, Math.max(0, input.overlapCharacters ?? 120));
  const paragraphs = input.text.replace(/\r\n?/gu, "\n").split(/\n{2,}/u).filter(Boolean);
  const chunks: Array<{ id: string; text: string; start: number; end: number }> = [];
  let cursor = 0;
  for (const paragraph of paragraphs.length ? paragraphs : [input.text]) {
    const startInDocument = input.text.indexOf(paragraph, cursor);
    for (let offset = 0; offset < paragraph.length; offset += maximum - overlap) {
      const text = paragraph.slice(offset, offset + maximum);
      if (!text.trim()) continue;
      const start = Math.max(0, startInDocument) + offset;
      chunks.push({ id: `${input.id}:${chunks.length + 1}`, text, start, end: start + text.length });
      if (offset + maximum >= paragraph.length) break;
    }
    cursor = Math.max(cursor, startInDocument + paragraph.length);
  }
  return chunks;
}

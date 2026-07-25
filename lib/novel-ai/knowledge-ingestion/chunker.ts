import { knowledgeHash } from "./deduplicator";
import type { KnowledgeChunk } from "./types";

export function chunkKnowledgeText(input: {
  sourceId: string;
  text: string;
  language: string;
  maxChars?: number;
  overlapChars?: number;
  metadata?: KnowledgeChunk["metadata"];
}) {
  const maxChars = Math.max(300, input.maxChars ?? 1200);
  const overlap = Math.max(0, Math.min(maxChars / 3, input.overlapChars ?? 120));
  const chunks: KnowledgeChunk[] = [];
  let start = 0;
  while (start < input.text.length) {
    let end = Math.min(input.text.length, start + maxChars);
    if (end < input.text.length) {
      const boundary = input.text.lastIndexOf("\n", end);
      if (boundary > start + maxChars * 0.55) end = boundary;
    }
    const text = input.text.slice(start, end).trim();
    if (text) {
      const chunkHash = knowledgeHash(text);
      chunks.push({
        chunkId: `${input.sourceId}:chunk:${chunks.length + 1}:${chunkHash.slice(0, 12)}`,
        sourceId: input.sourceId,
        chunkHash,
        text,
        order: chunks.length,
        start,
        end,
        language: input.language,
        metadata: input.metadata ?? {},
      });
    }
    if (end >= input.text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

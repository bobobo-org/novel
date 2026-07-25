import type { KnowledgeChunk, KnowledgeSource } from "./types";

export function resolveKnowledgeCitation(input: {
  source: KnowledgeSource;
  chunk: KnowledgeChunk;
  excerpt: string;
}) {
  const offset = input.chunk.text.indexOf(input.excerpt);
  if (offset < 0) throw Object.assign(new Error("引用文字不存在於原始知識切片。"), { code: "KNOWLEDGE_CITATION_NOT_FOUND" });
  return {
    sourceId: input.source.sourceId,
    chunkId: input.chunk.chunkId,
    sourceLocation: input.source.sourceLocation,
    excerpt: input.excerpt,
    start: input.chunk.start + offset,
    end: input.chunk.start + offset + input.excerpt.length,
    contentHash: input.source.contentHash,
    chunkHash: input.chunk.chunkHash,
  };
}

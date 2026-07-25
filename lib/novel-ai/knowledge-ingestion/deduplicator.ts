import crypto from "node:crypto";
import type { KnowledgeChunk } from "./types";

export function knowledgeHash(value: string) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function deduplicateKnowledgeChunks(chunks: KnowledgeChunk[]) {
  const hashes = new Set<string>();
  const unique: KnowledgeChunk[] = [];
  const duplicateChunkIds: string[] = [];
  for (const chunk of chunks) {
    if (hashes.has(chunk.chunkHash)) duplicateChunkIds.push(chunk.chunkId);
    else {
      hashes.add(chunk.chunkHash);
      unique.push(chunk);
    }
  }
  return { unique, duplicateChunkIds };
}

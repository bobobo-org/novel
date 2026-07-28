import { knowledgeHash } from "./deduplicator";
import type { KnowledgeChunk } from "./types";
import { createTaintEnvelope, propagateTaint, type TaintEnvelope } from "../security";

export function chunkKnowledgeText(input: {
  sourceId: string;
  text: string;
  language: string;
  maxChars?: number;
  overlapChars?: number;
  metadata?: KnowledgeChunk["metadata"];
  taint?: TaintEnvelope;
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
      const chunkId = `${input.sourceId}:chunk:${chunks.length + 1}:${chunkHash.slice(0, 12)}`;
      const parentTaint = input.taint ?? createTaintEnvelope({
        sourceId: input.sourceId,
        sourceType: "knowledge_source",
        content: input.text,
        trustLevel: "untrusted",
        taintLabels: ["UNTRUSTED_DOCUMENT", "EXTERNAL_TRANSFER_RESTRICTED", "TRAINING_EXCLUDED"],
      });
      chunks.push({
        chunkId,
        sourceId: input.sourceId,
        chunkHash,
        text,
        order: chunks.length,
        start,
        end,
        language: input.language,
        metadata: input.metadata ?? {},
        taint: propagateTaint({ stage: "knowledge_chunk", content: text, parents: [parentTaint] }),
      });
    }
    if (end >= input.text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

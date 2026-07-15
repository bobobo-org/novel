import { createHash } from "node:crypto";
import { compactChunkWhitespace } from "./chunk-normalization";

export function sha256Hex(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

export function chunkContentHash(text: string) {
  return sha256Hex(compactChunkWhitespace(text));
}

export function createStableChunkId(input: {
  projectId: string;
  chapterId?: string;
  sceneId?: string;
  contentType: string;
  ordinal: number;
  normalizedText: string;
  chunkingVersion: string;
}) {
  return `chunk_${sha256Hex([
    input.projectId,
    input.chapterId ?? "",
    input.sceneId ?? "",
    input.contentType,
    String(input.ordinal),
    chunkContentHash(input.normalizedText),
    input.chunkingVersion,
  ].join("|")).slice(0, 24)}`;
}

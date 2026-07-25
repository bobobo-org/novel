import crypto from "node:crypto";
import type { KnowledgeChunk, KnowledgeVersion } from "./types";

export function createKnowledgeVersion(input: {
  sourceId: string;
  contentHash: string;
  chunks: KnowledgeChunk[];
  previous?: KnowledgeVersion | null;
}) {
  const version = (input.previous?.version ?? 0) + 1;
  const versionId = `knowledge_version_${crypto.createHash("sha256").update(`${input.sourceId}|${version}|${input.contentHash}`).digest("hex").slice(0, 24)}`;
  const current: KnowledgeVersion = {
    versionId,
    sourceId: input.sourceId,
    version,
    contentHash: input.contentHash,
    chunkHashes: input.chunks.map((chunk) => chunk.chunkHash),
    parentVersionId: input.previous?.versionId ?? null,
    createdAt: new Date().toISOString(),
    status: "active",
  };
  const previous = input.previous ? { ...input.previous, status: "superseded" as const } : null;
  return { current, previous };
}

export function revokeKnowledgeVersion(version: KnowledgeVersion) {
  return { ...version, status: "revoked" as const };
}

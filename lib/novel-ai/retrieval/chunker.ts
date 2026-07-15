import { CHUNKING_VERSION, type ChunkMetadata, type ChunkTextPiece, type RetrievalChunk, type StructuredChunkRequest } from "./chunk-types";
import { createStableChunkId, chunkContentHash } from "./chunk-hash";
import { compactChunkWhitespace } from "./chunk-normalization";
import { estimateChunkTokens } from "./chunk-token-budget";

export function makeRetrievalChunks(input: {
  projectId: string;
  chapterId?: string;
  pieces: ChunkTextPiece[];
  metadata: ChunkMetadata;
  now?: string;
}): RetrievalChunk[] {
  const now = input.now ?? new Date().toISOString();
  return input.pieces.map((piece, index) => {
    const normalizedText = compactChunkWhitespace(piece.text);
    const ordinal = index + 1;
    const contentHash = chunkContentHash(normalizedText);
    return {
      chunkId: createStableChunkId({
        projectId: input.projectId,
        chapterId: input.chapterId,
        sceneId: piece.sceneId,
        contentType: piece.contentType,
        ordinal,
        normalizedText,
        chunkingVersion: CHUNKING_VERSION,
      }),
      projectId: input.projectId,
      chapterId: input.chapterId,
      sceneId: piece.sceneId,
      contentType: piece.contentType,
      ordinal,
      startOffset: piece.startOffset,
      endOffset: piece.endOffset,
      normalizedText,
      contentHash,
      tokenEstimate: estimateChunkTokens(normalizedText),
      entityIds: input.metadata.entityIds ?? [],
      eventIds: input.metadata.eventIds ?? [],
      sourceIds: input.metadata.sourceIds ?? [],
      timelineStart: input.metadata.timelineStart,
      timelineEnd: input.metadata.timelineEnd,
      chunkingVersion: CHUNKING_VERSION,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
  });
}

export function chunkStructuredRecord(request: StructuredChunkRequest): RetrievalChunk[] {
  return makeRetrievalChunks({
    projectId: request.projectId,
    chapterId: request.chapterId,
    pieces: [{
      text: request.text,
      startOffset: 0,
      endOffset: request.text.length,
      contentType: request.contentType,
      sceneId: request.sceneId,
    }],
    metadata: request,
    now: request.now,
  });
}

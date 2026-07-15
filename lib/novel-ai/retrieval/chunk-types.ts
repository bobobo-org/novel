import type { EmbeddingContentType } from "../embeddings/embedding-types";

export const CHUNKING_VERSION = "novel-chunking-v1";

export type RetrievalChunkStatus = "active" | "stale" | "deleted";

export type RetrievalChunk = {
  chunkId: string;
  projectId: string;
  chapterId?: string;
  sceneId?: string;
  contentType: EmbeddingContentType;
  ordinal: number;
  startOffset: number;
  endOffset: number;
  normalizedText: string;
  contentHash: string;
  tokenEstimate: number;
  entityIds: string[];
  eventIds: string[];
  sourceIds: string[];
  timelineStart?: string;
  timelineEnd?: string;
  chunkingVersion: string;
  status: RetrievalChunkStatus;
  createdAt: string;
  updatedAt: string;
};

export type ChunkMetadata = {
  entityIds?: string[];
  eventIds?: string[];
  sourceIds?: string[];
  timelineStart?: string;
  timelineEnd?: string;
};

export type ChapterChunkRequest = ChunkMetadata & {
  projectId: string;
  chapterId: string;
  sceneId?: string;
  text: string;
  now?: string;
};

export type StructuredChunkRequest = ChunkMetadata & {
  projectId: string;
  chapterId?: string;
  sceneId?: string;
  contentType: EmbeddingContentType;
  recordId: string;
  text: string;
  now?: string;
};

export type ChunkTextPiece = {
  text: string;
  startOffset: number;
  endOffset: number;
  contentType: EmbeddingContentType;
  sceneId?: string;
};

export const RETRIEVAL_INDEXABLE_CONTENT_TYPES: EmbeddingContentType[] = [
  "chapter_segment",
  "scene",
  "paragraph_group",
  "dialogue_block",
  "canonical_entity",
  "event",
  "foreshadow",
  "open_thread",
];

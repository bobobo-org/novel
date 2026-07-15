import { isWithinChunkTokenBudget, estimateChunkTokens, CHUNK_TOKEN_BUDGET } from "./chunk-token-budget";
import { splitLongPiece } from "./chunk-boundaries";
import { splitSceneIntoParagraphPieces } from "./dialogue-chunker";
import { splitIntoScenePieces } from "./scene-chunker";
import { makeRetrievalChunks } from "./chunker";
import type { ChapterChunkRequest, ChunkMetadata, ChunkTextPiece, RetrievalChunk } from "./chunk-types";

export function chunkChapter(request: ChapterChunkRequest): RetrievalChunk[] {
  if (!request.text.trim()) return [];
  const scenes = splitIntoScenePieces(request.text, request.sceneId);
  const pieces = scenes.flatMap((scene) => splitSceneIntoParagraphPieces(scene)).flatMap(splitLongPiece);
  const combined = combineSmallPieces(pieces);
  return makeRetrievalChunks({
    projectId: request.projectId,
    chapterId: request.chapterId,
    pieces: combined,
    metadata: request,
    now: request.now,
  });
}

function combineSmallPieces(pieces: ChunkTextPiece[]): ChunkTextPiece[] {
  const combined: ChunkTextPiece[] = [];
  let current: ChunkTextPiece | null = null;

  for (const piece of pieces) {
    if (!piece.text.trim()) continue;
    if (!current) {
      current = { ...piece };
      continue;
    }
    const sameScene = current.sceneId === piece.sceneId;
    const nextText: string = `${current.text}\n\n${piece.text}`;
    if (sameScene && estimateChunkTokens(current.text) < CHUNK_TOKEN_BUDGET.minTokens && isWithinChunkTokenBudget(nextText)) {
      current = {
        ...current,
        text: nextText,
        endOffset: piece.endOffset,
        contentType: current.contentType === "dialogue_block" && piece.contentType === "dialogue_block" ? "dialogue_block" : "paragraph_group",
      };
    } else {
      combined.push(current);
      current = { ...piece };
    }
  }
  if (current) combined.push(current);
  return combined;
}

export function chunkTextAsSingleStructuredPiece(input: {
  projectId: string;
  chapterId?: string;
  sceneId?: string;
  contentType: RetrievalChunk["contentType"];
  text: string;
  metadata?: ChunkMetadata;
  now?: string;
}) {
  if (!input.text.trim()) return [];
  const piece: ChunkTextPiece = {
    text: input.text,
    startOffset: 0,
    endOffset: input.text.length,
    contentType: input.contentType,
    sceneId: input.sceneId,
  };
  return makeRetrievalChunks({
    projectId: input.projectId,
    chapterId: input.chapterId,
    pieces: splitLongPiece(piece),
    metadata: input.metadata ?? {},
    now: input.now,
  });
}

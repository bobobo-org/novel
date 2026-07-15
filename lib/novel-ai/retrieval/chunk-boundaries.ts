import type { ChunkTextPiece } from "./chunk-types";
import { estimateChunkTokens, CHUNK_TOKEN_BUDGET } from "./chunk-token-budget";

export function isSceneSeparator(line: string) {
  const trimmed = line.trim();
  return /^(---|\*\*\*|第[一二三四五六七八九十百千\d]+[章节幕場场]|[一二三四五六七八九十百千\d]+、)/.test(trimmed);
}

export function isDialogueLine(line: string) {
  const trimmed = line.trim();
  return /^(「|『|"|“|—|——|[\u4e00-\u9fffA-Za-z0-9_]{1,12}[：:])/.test(trimmed) && /[？?。！!」』"]?$/.test(trimmed);
}

export function splitLongPiece(piece: ChunkTextPiece): ChunkTextPiece[] {
  if (estimateChunkTokens(piece.text) <= CHUNK_TOKEN_BUDGET.maxTokens) return [piece];
  const sentenceMatches = Array.from(piece.text.matchAll(/[^。！？!?；;]+[。！？!?；;]?/g));
  if (sentenceMatches.length <= 1) return splitByCharacters(piece);

  const pieces: ChunkTextPiece[] = [];
  let current = "";
  let currentStart = piece.startOffset;
  for (const match of sentenceMatches) {
    const sentence = match[0];
    const sentenceStart = piece.startOffset + (match.index ?? 0);
    if (current && estimateChunkTokens(current + sentence) > CHUNK_TOKEN_BUDGET.maxTokens) {
      pieces.push({ ...piece, text: current, startOffset: currentStart, endOffset: sentenceStart });
      current = sentence;
      currentStart = sentenceStart;
    } else {
      if (!current) currentStart = sentenceStart;
      current += sentence;
    }
  }
  if (current.trim()) pieces.push({ ...piece, text: current, startOffset: currentStart, endOffset: piece.endOffset });
  return pieces.flatMap((item) => estimateChunkTokens(item.text) > CHUNK_TOKEN_BUDGET.maxTokens ? splitByCharacters(item) : [item]);
}

function splitByCharacters(piece: ChunkTextPiece): ChunkTextPiece[] {
  const chunks: ChunkTextPiece[] = [];
  const maxChars = 650;
  for (let start = 0; start < piece.text.length; start += maxChars) {
    const text = piece.text.slice(start, start + maxChars);
    chunks.push({ ...piece, text, startOffset: piece.startOffset + start, endOffset: piece.startOffset + start + text.length });
  }
  return chunks;
}

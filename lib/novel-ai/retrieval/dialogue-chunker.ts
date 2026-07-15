import type { ChunkTextPiece } from "./chunk-types";
import { isDialogueLine } from "./chunk-boundaries";

export function splitSceneIntoParagraphPieces(scene: ChunkTextPiece): ChunkTextPiece[] {
  const paragraphMatches = Array.from(scene.text.matchAll(/(?:[^\n]|\n(?!\n))+/g));
  const pieces: ChunkTextPiece[] = [];
  let dialogueBuffer: ChunkTextPiece[] = [];

  const flushDialogue = () => {
    if (dialogueBuffer.length === 0) return;
    pieces.push({
      text: dialogueBuffer.map((piece) => piece.text).join("\n"),
      startOffset: dialogueBuffer[0].startOffset,
      endOffset: dialogueBuffer[dialogueBuffer.length - 1].endOffset,
      contentType: "dialogue_block",
      sceneId: scene.sceneId,
    });
    dialogueBuffer = [];
  };

  for (const match of paragraphMatches) {
    const raw = match[0];
    const start = scene.startOffset + (match.index ?? 0);
    const end = start + raw.length;
    const lines = raw.split("\n").filter((line) => line.trim());
    const dialogueHeavy = lines.length > 0 && lines.filter(isDialogueLine).length / lines.length >= 0.6;
    const piece: ChunkTextPiece = {
      text: raw,
      startOffset: start,
      endOffset: end,
      contentType: dialogueHeavy ? "dialogue_block" : "paragraph_group",
      sceneId: scene.sceneId,
    };
    if (dialogueHeavy) {
      dialogueBuffer.push(piece);
      if (dialogueBuffer.length >= 4) flushDialogue();
    } else {
      flushDialogue();
      pieces.push(piece);
    }
  }
  flushDialogue();
  return pieces;
}

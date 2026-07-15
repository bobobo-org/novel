import type { ChunkTextPiece } from "./chunk-types";
import { isSceneSeparator } from "./chunk-boundaries";

export function splitIntoScenePieces(text: string, baseSceneId?: string): ChunkTextPiece[] {
  if (!text.trim()) return [];
  const lines = Array.from(text.matchAll(/[^\n]*(?:\n|$)/g)).filter((match) => match[0].length > 0);
  const scenes: ChunkTextPiece[] = [];
  let sceneStart = 0;
  let sceneIndex = 0;
  for (const lineMatch of lines) {
    const line = lineMatch[0];
    const lineStart = lineMatch.index ?? 0;
    if (lineStart > sceneStart && isSceneSeparator(line)) {
      scenes.push(makeScene(text, sceneStart, lineStart, baseSceneId, sceneIndex));
      sceneStart = lineStart;
      sceneIndex += 1;
    }
  }
  scenes.push(makeScene(text, sceneStart, text.length, baseSceneId, sceneIndex));
  return scenes.filter((scene) => scene.text.trim());
}

function makeScene(text: string, start: number, end: number, baseSceneId: string | undefined, index: number): ChunkTextPiece {
  return {
    text: text.slice(start, end),
    startOffset: start,
    endOffset: end,
    contentType: "scene",
    sceneId: baseSceneId ?? `scene_${index + 1}`,
  };
}

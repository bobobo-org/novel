import type { ChapterInput, StoryIntelligenceCandidate } from "./types";
import { candidate } from "./extractor-helpers";

export function extractForeshadowing(chapter: ChapterInput): StoryIntelligenceCandidate[] {
  const output: StoryIntelligenceCandidate[] = [];
  const regex = /(?:伏筆|線索|異樣|不祥|秘密)[：:]?\s*([^。！？\n]{3,100})/gu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(chapter.content))) {
    output.push(candidate({
      chapter,
      entityType: "foreshadowing",
      entityId: `foreshadowing:${chapter.chapterId}:${output.length + 1}`,
      field: "clue",
      value: match[1].trim(),
      start: match.index,
      end: match.index + match[0].length,
      confidence: 0.76,
      needsReview: true,
      reasons: ["語意線索不得自動視為作者正式伏筆"],
    }));
  }
  return output;
}

import type { ChapterInput, StoryIntelligenceCandidate } from "./types";
import { candidate } from "./extractor-helpers";

export function extractPlotThreads(chapter: ChapterInput): StoryIntelligenceCandidate[] {
  const output: StoryIntelligenceCandidate[] = [];
  const regex = /(?:必須|答應|承諾|還要|尚未|仍未)([^。！？\n]{3,90})/gu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(chapter.content))) {
    output.push(candidate({
      chapter,
      entityType: "plot_thread",
      entityId: `thread:${chapter.chapterId}:${output.length + 1}`,
      field: "openThread",
      value: match[0].trim(),
      start: match.index,
      end: match.index + match[0].length,
      confidence: 0.82,
      needsReview: true,
      reasons: ["句型表示未完成事項，仍需作者確認其是否為正式承諾"],
    }));
  }
  return output;
}

import type { ChapterInput, StoryIntelligenceCandidate } from "./types";
import { candidate } from "./extractor-helpers";

export function extractTimeline(chapter: ChapterInput): StoryIntelligenceCandidate[] {
  const output: StoryIntelligenceCandidate[] = [];
  const regex = /(隔天|翌日|三天後|數日後|一週後|一個月後|多年後|同日|當晚|清晨|正午|深夜)[，,：:\s]*([^。！？\n]{3,100})/gu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(chapter.content))) {
    output.push(candidate({
      chapter,
      entityType: "event",
      entityId: `event:${chapter.chapterId}:${output.length + 1}`,
      field: "storyTimeAndEvent",
      value: `${match[1]}：${match[2].trim()}`,
      start: match.index,
      end: match.index + match[0].length,
      confidence: match[1] === "多年後" || match[1] === "數日後" ? 0.78 : 0.9,
      factType: match[1] === "多年後" || match[1] === "數日後" ? "inferred" : "explicit",
      needsReview: match[1] === "多年後" || match[1] === "數日後",
      reasons: match[1] === "多年後" || match[1] === "數日後" ? ["相對時間無法正規化為精確日期"] : [],
    }));
  }
  return output;
}

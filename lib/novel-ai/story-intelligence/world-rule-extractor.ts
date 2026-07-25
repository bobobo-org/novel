import type { ChapterInput, StoryIntelligenceCandidate } from "./types";
import { candidate } from "./extractor-helpers";

export function extractWorldRules(chapter: ChapterInput): StoryIntelligenceCandidate[] {
  const output: StoryIntelligenceCandidate[] = [];
  const regex = /(?:世界規則|律法|鐵律|禁令)[：:]\s*([^。！？\n]{4,120})/gu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(chapter.content))) {
    output.push(candidate({
      chapter,
      entityType: "world_rule",
      entityId: `world-rule:${output.length + 1}`,
      field: "description",
      value: match[1].trim(),
      start: match.index,
      end: match.index + match[0].length,
      confidence: 0.98,
    }));
  }
  return output;
}

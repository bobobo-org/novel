import type { ChapterInput, StoryIntelligenceCandidate } from "./types";
import { candidate, entitySlug } from "./extractor-helpers";

export function extractRelationships(chapter: ChapterInput): StoryIntelligenceCandidate[] {
  const output: StoryIntelligenceCandidate[] = [];
  const regex = /([\p{Script=Han}]{2,4})是([\p{Script=Han}]{2,4})的(父親|母親|哥哥|姊姊|弟弟|妹妹|師父|弟子|盟友|敵人)/gu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(chapter.content))) {
    output.push(candidate({
      chapter,
      entityType: "relationship",
      entityId: `relationship:${entitySlug(match[1])}:${entitySlug(match[2])}`,
      field: "kind",
      value: match[3],
      start: match.index,
      end: match.index + match[0].length,
      confidence: 0.96,
    }));
  }
  return output;
}

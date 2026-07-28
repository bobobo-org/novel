import type { ChapterInput, StoryIntelligenceCandidate } from "./types";
import { candidate, entitySlug } from "./extractor-helpers";

const NAME = String.raw`([\p{Script=Han}]{2,4})`;

export function extractCharacterStates(chapter: ChapterInput): StoryIntelligenceCandidate[] {
  const output: StoryIntelligenceCandidate[] = [];
  const patterns = [
    { field: "age", regex: new RegExp(`${NAME}(?:今年|年約|已經)?\\s*([一二三四五六七八九十百兩\\d]{1,3})\\s*歲`, "gu"), value: (m: RegExpExecArray) => m[2] },
    { field: "lifeStatus", regex: new RegExp(`${NAME}(?:已經|當場|就此)?\\s*(死去|死亡|身亡|斷氣)`, "gu"), value: () => "dead" },
    { field: "lifeStatus", regex: new RegExp(`${NAME}(?:仍然|依舊)?\\s*(活著|生還)`, "gu"), value: () => "alive" },
    { field: "location", regex: new RegExp(`${NAME}(?:目前|此刻|現在)?\\s*(?:位於|身在|來到|抵達)\\s*([^，。！？\\n]{2,16})`, "gu"), value: (m: RegExpExecArray) => m[2].trim() },
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(chapter.content))) {
      output.push(candidate({
        chapter,
        entityType: "character",
        entityId: `character:${entitySlug(match[1])}`,
        field: pattern.field,
        value: pattern.value(match),
        start: match.index,
        end: match.index + match[0].length,
        confidence: 0.94,
      }));
    }
  }
  return output;
}

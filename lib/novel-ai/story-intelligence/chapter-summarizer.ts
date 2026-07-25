import type { ChapterInput } from "./types";

function sentences(text: string) {
  return text
    .split(/(?<=[。！？!?])\s*/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function summarizeChapter(chapter: ChapterInput, maxCharacters = 480) {
  const rows = sentences(chapter.content);
  if (rows.length <= 3) return chapter.content.trim().slice(0, maxCharacters);
  const terms = new Map<string, number>();
  for (const sentence of rows) {
    for (const term of sentence.match(/[\p{Script=Han}]{2,4}|[A-Za-z]{3,}/gu) ?? []) {
      terms.set(term, (terms.get(term) ?? 0) + 1);
    }
  }
  const ranked = rows.map((text, index) => ({
    text,
    index,
    score: [...terms].reduce((score, [term, count]) => score + (text.includes(term) ? count : 0), 0)
      + (index === 0 || index === rows.length - 1 ? 4 : 0),
  }));
  const selected = ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .sort((a, b) => a.index - b.index)
    .map((row) => row.text)
    .join("");
  return selected.slice(0, maxCharacters);
}

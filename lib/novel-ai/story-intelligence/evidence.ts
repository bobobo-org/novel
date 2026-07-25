import crypto from "crypto";
import type { ChapterInput, StorySource } from "./types";

export function stableId(prefix: string, value: unknown) {
  return `${prefix}_${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 20)}`;
}

export function sourceFromMatch(chapter: ChapterInput, start: number, end: number): StorySource {
  return {
    sourceChapterId: chapter.chapterId,
    sourceRevision: chapter.sourceRevision,
    evidenceExcerpt: chapter.content.slice(start, end),
    start,
    end,
  };
}

export function validateSource(source: StorySource, chapter: ChapterInput) {
  return source.sourceChapterId === chapter.chapterId
    && source.sourceRevision === chapter.sourceRevision
    && source.start >= 0
    && source.end >= source.start
    && chapter.content.slice(source.start, source.end) === source.evidenceExcerpt;
}

export function findEvidence(chapter: ChapterInput, excerpt: string): StorySource | null {
  const start = chapter.content.indexOf(excerpt);
  return start < 0 ? null : sourceFromMatch(chapter, start, start + excerpt.length);
}

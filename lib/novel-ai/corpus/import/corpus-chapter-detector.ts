import crypto from "crypto";
import type { CorpusDetectedChapter } from "./corpus-import-types";

function id(value: string) {
  return `corpus_chapter_${crypto.createHash("sha1").update(value).digest("hex").slice(0, 16)}`;
}

const CHAPTER_RE = /(^|\n)\s*((第[一二三四五六七八九十百千\d]+[章回節]|Chapter\s+\d+|CHAPTER\s+[IVXLCDM]+|Part\s+\w+|Book\s+\w+|Prologue|Epilogue|楔子|序章|終章|番外)[^\n]*)/gi;

export function detectCorpusChapters(text: string): CorpusDetectedChapter[] {
  const matches = Array.from(text.matchAll(CHAPTER_RE));
  if (!matches.length) {
    return [{
      chapterId: id(`chapter:1:${text.slice(0, 64)}`),
      title: "全文",
      ordinal: 1,
      startOffset: 0,
      endOffset: text.length,
      confidence: 0.55,
      detectionRule: "no-chapter-fallback",
      warnings: ["no_chapter_heading_detected"],
      text,
    }];
  }
  return matches.map((match, index) => {
    const startOffset = match.index ?? 0;
    const endOffset = matches[index + 1]?.index ?? text.length;
    const title = (match[2] ?? `Chapter ${index + 1}`).trim();
    return {
      chapterId: id(`${index + 1}:${title}:${startOffset}`),
      title,
      ordinal: index + 1,
      startOffset,
      endOffset,
      confidence: 0.88,
      detectionRule: /Chapter|CHAPTER|Part|Book|Prologue|Epilogue/i.test(title) ? "western-heading" : "cjk-heading",
      warnings: [],
      text: text.slice(startOffset, endOffset).trim(),
    };
  });
}

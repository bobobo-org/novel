import crypto from "crypto";
import type { CorpusImportRequest, CorpusLanguage, CorpusMetadataMatch } from "./corpus-import-types";

function slug(value: string) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 14);
}

export function matchCorpusMetadata(request: CorpusImportRequest, language: CorpusLanguage): CorpusMetadataMatch {
  const author = request.authorName?.trim() || "Unknown Author";
  const title = request.title?.trim() || request.file.fileName.replace(/\.[^.]+$/, "");
  const base = `${author}:${title}:${language}`;
  return {
    authorId: `corpus_author_${slug(author)}`,
    workId: `corpus_work_${slug(base)}`,
    editionId: `corpus_edition_${slug(`${base}:${request.sourceId ?? request.file.fileName}`)}`,
    matchConfidence: request.title && request.authorName ? 0.9 : 0.62,
    matchReasons: [request.title ? "title_declared" : "title_from_filename", request.authorName ? "author_declared" : "author_unknown"],
    possibleDuplicates: [],
    manualReviewRequired: !(request.title && request.authorName),
  };
}

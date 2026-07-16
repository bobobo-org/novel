import type { CorpusDetectedChapter } from "./corpus-import-types";
import { chunkChapter } from "../../retrieval/chapter-chunker";

export function chunkCorpusChapters(input: {
  projectId: string;
  sourceScope: string;
  workId: string;
  editionId: string;
  language: string;
  licenseType: string;
  visibility: string;
  chapters: CorpusDetectedChapter[];
}) {
  return input.chapters.flatMap((chapter) => chunkChapter({
    projectId: input.projectId,
    chapterId: chapter.chapterId,
    text: chapter.text,
  }).map((chunk, index) => ({
    ...chunk,
    chunkIndex: index,
    corpusChapter: chapter,
    corpusMetadata: {
      corpusWorkId: input.workId,
      editionId: input.editionId,
      language: input.language,
      licenseType: input.licenseType,
      visibility: input.visibility,
      sourceScope: input.sourceScope,
    },
  })));
}

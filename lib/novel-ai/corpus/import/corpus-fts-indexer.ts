import crypto from "crypto";

export function createCorpusFtsDocument(input: {
  jobId: string;
  sourceScope: string;
  workId: string;
  editionId: string;
  chapterId: string;
  language: string;
  title: string;
  body: string;
  licenseType: string;
  visibility: string;
}) {
  return {
    ...input,
    ftsDocumentId: `fts_${crypto.createHash("sha1").update(`${input.jobId}:${input.chapterId}`).digest("hex").slice(0, 16)}`,
    contentHash: crypto.createHash("sha256").update(input.body).digest("hex"),
  };
}

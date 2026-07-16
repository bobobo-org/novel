import crypto from "crypto";
import { corpusId, type CorpusImportRepository } from "./corpus-import-repository";

export function saveCorpusImportCheckpoint(repository: CorpusImportRepository, input: {
  jobId: string;
  currentStep: string;
  lastCompletedStep?: string;
  processedBytes: number;
  processedChapters: number;
  processedChunks: number;
  embeddedChunks: number;
  indexedChunks: number;
  retryCount?: number;
}) {
  const checkpointHash = crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const checkpointId = corpusId("checkpoint", { jobId: input.jobId, checkpointHash });
  repository.insertCheckpoint({ ...input, checkpointId, checkpointHash, row: { ...input, checkpointHash } });
  return { checkpointId, checkpointHash };
}

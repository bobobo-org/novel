import { corpusId, type CorpusImportRepository } from "./corpus-import-repository";

export function recordCorpusImportRollback(repository: CorpusImportRepository, jobId: string, rolledBackRows: number, rollbackStatus = "completed") {
  const rollbackId = corpusId("rollback", { jobId, rolledBackRows, rollbackStatus });
  repository.insertRollback({ rollbackId, jobId, rollbackStatus, rolledBackRows, row: { jobId, rolledBackRows, rollbackStatus } });
  return { rollbackId, rollbackStatus, rolledBackRows };
}

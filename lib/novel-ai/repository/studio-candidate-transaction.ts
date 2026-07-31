import {
  NOVEL_DOMAIN_VERSION,
  type Chapter,
} from "../domain";
import {
  RepositoryOperationError,
  type CommitStudioCandidateTransactionInput,
  type StudioCandidateOperationJournal,
} from "./contracts";

export function assertStudioCandidateReplay(
  input: CommitStudioCandidateTransactionInput,
  journal: StudioCandidateOperationJournal,
) {
  if (
    journal.operationType !== "studio_candidate_commit"
    || journal.projectId !== input.projectId
    || journal.chapterId !== input.chapterId
    || journal.taskId !== input.taskId
    || journal.payloadFingerprint !== input.payloadFingerprint
    || journal.acceptedContentDigest !== input.acceptedContentDigest
    || journal.commitId !== input.commitId
  ) {
    throw new RepositoryOperationError(
      "STUDIO_CANDIDATE_IDEMPOTENCY_PAYLOAD_MISMATCH",
    );
  }
}

export function buildStudioCandidateCommitRecords(
  input: CommitStudioCandidateTransactionInput,
  current: Chapter,
  now = new Date().toISOString(),
) {
  if (
    current.projectId !== input.projectId
    || current.id !== input.chapterId
  ) {
    throw new RepositoryOperationError(
      "STUDIO_CANDIDATE_SOURCE_CHAPTER_NOT_FOUND",
    );
  }
  if (current.revision !== input.expectedChapterRevision) {
    throw Object.assign(
      new RepositoryOperationError("GENERATION_SOURCE_REVISION_STALE"),
      {
        expectedRevision: input.expectedChapterRevision,
        actualRevision: current.revision,
      },
    );
  }
  const chapter: Chapter = {
    ...current,
    content: input.nextContent,
    summary: input.nextSummary,
    revision: current.revision + 1,
    parentRevision: current.revision,
    updatedAt: now,
  };
  const journal: StudioCandidateOperationJournal = {
    schemaVersion: NOVEL_DOMAIN_VERSION,
    id: input.operationId,
    projectId: input.projectId,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    source: "system",
    provenance: {
      source: "system",
      actor: "local-rule",
      requestId: input.operationId,
      createdAt: now,
    },
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey,
    operationType: "studio_candidate_commit",
    payloadFingerprint: input.payloadFingerprint,
    chapterId: input.chapterId,
    taskId: input.taskId,
    mode: input.mode,
    sourceRevision: input.expectedChapterRevision,
    resultingRevision: chapter.revision,
    acceptedContentDigest: input.acceptedContentDigest,
    resultContentDigest: input.resultContentDigest,
    commitId: input.commitId,
    completedAt: now,
  };
  return { chapter, journal };
}

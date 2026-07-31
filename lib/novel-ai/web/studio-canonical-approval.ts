import type { Chapter } from "../domain";
import { sha256Hex, stableStringify } from "../closed-ai-cache";
import type {
  NovelRepository,
  StudioCandidateOperationJournal,
} from "../repository";
import { mirrorChapterToLegacyStudio } from "../repository/migration/legacy-studio-migration";

export type StudioCanonicalApplyMode = "append" | "replace" | "summary";

export type StudioCanonicalApplyInput = {
  repository: NovelRepository;
  projectId: string;
  chapterId: string;
  sourceRevision: number;
  taskId: string;
  idempotencyKey?: string;
  content: string;
  mode: StudioCanonicalApplyMode;
};

export type StudioCanonicalApplyResult = {
  chapter: Chapter;
  commitId: string;
  contentDigest: string;
  sourceRevision: number;
  resultingRevision: number;
  replayed: boolean;
};

function staleRevision(expected: number, actual: number | null) {
  return Object.assign(
    new Error("候選內容建立後，來源章節已變更；請重新產生候選再核准。"),
    {
      code: "GENERATION_SOURCE_REVISION_STALE",
      expectedRevision: expected,
      actualRevision: actual,
    },
  );
}

export async function commitStudioCandidateToChapter(
  input: StudioCanonicalApplyInput,
): Promise<StudioCanonicalApplyResult> {
  const acceptedContent = input.content.trim();
  if (!acceptedContent) {
    throw Object.assign(new Error("不能核准空白內容。"), {
      code: "STUDIO_CANDIDATE_CONTENT_EMPTY",
    });
  }
  const idempotencyKey = input.idempotencyKey
    ?? `studio-candidate:${input.projectId}:${input.chapterId}:${input.sourceRevision}:${input.taskId}`;
  const operationId = `studio-candidate-operation:${await sha256Hex(idempotencyKey)}`;
  const acceptedContentDigest = await sha256Hex(acceptedContent);
  const replay = (await input.repository.list<StudioCandidateOperationJournal>(
    "operationJournal",
    input.projectId,
  )).find((record) => record.idempotencyKey === idempotencyKey);
  if (replay) {
    if (
      replay.operationType !== "studio_candidate_commit"
      || replay.id !== operationId
      || replay.chapterId !== input.chapterId
      || replay.taskId !== input.taskId
      || replay.mode !== input.mode
      || replay.sourceRevision !== input.sourceRevision
      || replay.acceptedContentDigest !== acceptedContentDigest
    ) {
      throw Object.assign(new Error("The canonical retry payload does not match its journal."), {
        code: "STUDIO_CANDIDATE_IDEMPOTENCY_PAYLOAD_MISMATCH",
      });
    }
    const chapter = await input.repository.get<Chapter>("chapters", input.chapterId);
    if (!chapter || chapter.revision < replay.resultingRevision) {
      throw Object.assign(new Error("The canonical recovery journal is incomplete."), {
        code: "STUDIO_CANDIDATE_IDEMPOTENCY_REPLAY_INCOMPLETE",
      });
    }
    mirrorChapterToLegacyStudio(input.projectId, chapter.title, chapter.content);
    return {
      chapter,
      commitId: replay.commitId,
      contentDigest: replay.resultContentDigest,
      sourceRevision: replay.sourceRevision,
      resultingRevision: replay.resultingRevision,
      replayed: true,
    };
  }
  const current = await input.repository.get<Chapter>(
    "chapters",
    input.chapterId,
  );
  if (!current || current.projectId !== input.projectId) {
    throw Object.assign(new Error("找不到候選所屬的來源章節。"), {
      code: "STUDIO_CANDIDATE_SOURCE_CHAPTER_NOT_FOUND",
    });
  }
  if (current.revision !== input.sourceRevision) {
    throw staleRevision(input.sourceRevision, current.revision);
  }
  const nextContent = input.mode === "replace"
    ? acceptedContent
    : input.mode === "summary"
      ? current.content
      : `${current.content.trim()}${current.content.trim() ? "\n\n" : ""}${acceptedContent}`;
  const nextSummary = input.mode === "summary"
    ? acceptedContent
    : current.summary;
  const contentDigest = await sha256Hex(stableStringify({
    content: nextContent,
    summary: nextSummary,
  }));
  const payloadFingerprint = await sha256Hex(stableStringify({
    projectId: input.projectId,
    chapterId: input.chapterId,
    sourceRevision: input.sourceRevision,
    taskId: input.taskId,
    mode: input.mode,
    acceptedContent,
    contentDigest,
  }));
  const commitId = [
    "studio-chapter",
    current.id,
    `revision-${current.revision + 1}`,
    `task-${input.taskId}`,
    contentDigest,
  ].join(":");
  const transaction = await input.repository.commitStudioCandidateTransaction({
    operationId,
    idempotencyKey,
    payloadFingerprint,
    projectId: input.projectId,
    chapterId: input.chapterId,
    taskId: input.taskId,
    mode: input.mode,
    expectedChapterRevision: input.sourceRevision,
    nextContent,
    nextSummary,
    acceptedContentDigest,
    resultContentDigest: contentDigest,
    commitId,
  });
  const saved = transaction.chapter;
  mirrorChapterToLegacyStudio(
    input.projectId,
    saved.title,
    saved.content,
  );
  return {
    chapter: saved,
    commitId: transaction.journal.commitId,
    contentDigest,
    sourceRevision: input.sourceRevision,
    resultingRevision: transaction.journal.resultingRevision,
    replayed: transaction.replayed,
  };
}

export async function applyWritingAidTransaction(
  input: StudioCanonicalApplyInput,
) {
  const committed = await commitStudioCandidateToChapter(input);
  return {
    ...committed,
    provenance: {
      sourceType: "local-writing-aid" as const,
      aiGenerated: false as const,
      modelId: null,
      modelDigest: null,
      modelProof: null,
    },
  };
}

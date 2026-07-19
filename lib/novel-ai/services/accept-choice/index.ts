import { applyStoryChoiceEffect, validateStoryChoiceEffect } from "../../game/effects";
import { makeRecord, type AcceptedChoice, type Chapter, type ChoiceCandidate, type NovelProject, type OperationJournal, type StoryBranch, type StoryState } from "../../domain";
import { RepositoryOperationError, type AcceptChoiceTransactionInput } from "../../repository/contracts";

export type AcceptChoiceCurrent = {
  project: NovelProject;
  chapter: Chapter;
  candidate: ChoiceCandidate;
  storyState: StoryState;
  parentBranch: StoryBranch | null;
};

export function assertAcceptChoiceInput(input: AcceptChoiceTransactionInput, current: AcceptChoiceCurrent) {
  const { project, chapter, candidate, storyState, parentBranch } = current;
  if (chapter.projectId !== input.projectId || candidate.projectId !== input.projectId || storyState.projectId !== input.projectId) throw new RepositoryOperationError("PROJECT_SCOPE_MISMATCH");
  if (candidate.chapterId !== input.chapterId) throw new RepositoryOperationError("CANDIDATE_CHAPTER_MISMATCH");
  if (candidate.status !== "pending") throw new RepositoryOperationError("CANDIDATE_ALREADY_ACCEPTED");
  if (project.revision !== input.expectedProjectRevision) throw new RepositoryOperationError("PROJECT_REVISION_CONFLICT");
  if (chapter.revision !== input.expectedChapterRevision) throw new RepositoryOperationError("CHAPTER_REVISION_CONFLICT");
  if (candidate.revision !== input.expectedCandidateRevision || candidate.inputRevision !== input.expectedProjectRevision) throw new RepositoryOperationError("CANDIDATE_STALE");
  if (storyState.revision !== input.expectedStoryStateRevision || candidate.storyStateRevision !== input.expectedStoryStateRevision) throw new RepositoryOperationError("STORY_STATE_REVISION_CONFLICT");
  if (candidate.chapterRevision !== input.expectedChapterRevision) throw new RepositoryOperationError("CANDIDATE_STALE");
  if (input.parentBranchId && (!parentBranch || parentBranch.projectId !== input.projectId || parentBranch.chapterId !== input.chapterId)) throw new RepositoryOperationError("PARENT_BRANCH_INVALID");
  const validation = validateStoryChoiceEffect(candidate.effect);
  if (!validation.valid) throw new RepositoryOperationError("INVALID_STORY_EFFECT", validation.errors.join("; "));
  if (!input.acceptedText.trim()) throw new RepositoryOperationError("ACCEPTED_TEXT_EMPTY");
}

export function buildAcceptedChoiceRecords(input: AcceptChoiceTransactionInput, current: AcceptChoiceCurrent) {
  assertAcceptChoiceInput(input, current);
  const now = new Date().toISOString();
  const acceptedBase = makeRecord(input.projectId, "user");
  const branchBase = makeRecord(input.projectId, "user");
  const acceptedChoiceId = acceptedBase.id;
  const branchId = branchBase.id;
  const nextContent = `${current.chapter.content}${current.chapter.content ? "\n\n" : ""}${input.acceptedText}`.trim();
  const project: NovelProject = { ...current.project, revision: current.project.revision + 1, parentRevision: current.project.revision, updatedAt: now, activeChapterId: current.chapter.id };
  const chapter: Chapter = { ...current.chapter, revision: current.chapter.revision + 1, parentRevision: current.chapter.revision, updatedAt: now, content: nextContent };
  const candidate: ChoiceCandidate = { ...current.candidate, revision: current.candidate.revision + 1, parentRevision: current.candidate.revision, updatedAt: now, status: "accepted" };
  const storyState = applyStoryChoiceEffect(current.storyState, current.candidate.effect);
  const acceptedChoice: AcceptedChoice = {
    ...acceptedBase,
    id: acceptedChoiceId,
    acceptedChoiceId,
    chapterId: chapter.id,
    sceneId: current.candidate.sceneId ?? null,
    candidateId: candidate.id,
    branchId,
    choiceKey: candidate.optionKey,
    choiceLabel: input.choiceLabel ?? null,
    acceptedText: input.acceptedText,
    inputRevision: input.expectedProjectRevision,
    resultingRevision: project.revision,
    storyStateRevisionBefore: current.storyState.revision,
    storyStateRevisionAfter: storyState.revision,
    effectOperationId: input.operationId,
    appliedEffect: candidate.effect,
    acceptedAt: now,
    provenance: current.candidate.provenance,
  };
  const branch: StoryBranch = {
    ...branchBase,
    id: branchId,
    branchId,
    parentBranchId: input.parentBranchId ?? null,
    sourceCandidateId: candidate.id,
    acceptedChoiceId,
    chapterId: chapter.id,
    sceneId: current.candidate.sceneId ?? null,
    status: "active",
    name: input.choiceLabel || candidate.text,
    headRevision: project.revision,
  };
  const journalBase = makeRecord(input.projectId, "system");
  const journal: OperationJournal = {
    ...journalBase,
    id: input.operationId,
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey,
    operationType: "accept_choice",
    candidateId: candidate.id,
    acceptedChoiceId,
    branchId,
    resultRevision: project.revision,
    completedAt: now,
  };
  return { project, chapter, candidate, storyState, acceptedChoice, branch, journal };
}

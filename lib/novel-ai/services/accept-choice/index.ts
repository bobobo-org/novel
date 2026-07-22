import { applyStoryChoiceEffect, validateStoryChoiceEffect } from "../../game/effects";
import { makeRecord, type AcceptedChoice, type ApprovalTransaction, type Chapter, type ChoiceCandidate, type IdempotencyRecord, type NovelProject, type OperationJournal, type StoryBible, type StoryBibleDelta, type StoryBranch, type StoryState } from "../../domain";
import { RepositoryOperationError, type AcceptChoiceTransactionInput } from "../../repository/contracts";

export type AcceptChoiceCurrent = {
  project: NovelProject;
  chapter: Chapter;
  candidate: ChoiceCandidate;
  storyState: StoryState;
  storyBible: StoryBible;
  parentBranch: StoryBranch | null;
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function acceptChoicePayloadFingerprint(input: AcceptChoiceTransactionInput) {
  const serialized = stableStringify({
    projectId: input.projectId, chapterId: input.chapterId, candidateId: input.candidateId,
    parentBranchId: input.parentBranchId ?? null, acceptedText: input.acceptedText,
    choiceLabel: input.choiceLabel ?? null, expectedProjectRevision: input.expectedProjectRevision,
    expectedChapterRevision: input.expectedChapterRevision, expectedCandidateRevision: input.expectedCandidateRevision,
    expectedStoryStateRevision: input.expectedStoryStateRevision,
    expectedStoryBibleRevision: input.expectedStoryBibleRevision ?? null,
  });
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(serialized)) { hash ^= byte; hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

export function assertAcceptChoiceInput(input: AcceptChoiceTransactionInput, current: AcceptChoiceCurrent) {
  const { project, chapter, candidate, storyState, storyBible, parentBranch } = current;
  if (chapter.projectId !== input.projectId || candidate.projectId !== input.projectId || storyState.projectId !== input.projectId) throw new RepositoryOperationError("PROJECT_SCOPE_MISMATCH");
  if (candidate.chapterId !== input.chapterId) throw new RepositoryOperationError("CANDIDATE_CHAPTER_MISMATCH");
  if (candidate.status !== "pending") throw new RepositoryOperationError("CANDIDATE_ALREADY_ACCEPTED");
  if (project.revision !== input.expectedProjectRevision) throw new RepositoryOperationError("PROJECT_REVISION_CONFLICT");
  if (chapter.revision !== input.expectedChapterRevision) throw new RepositoryOperationError("CHAPTER_REVISION_CONFLICT");
  if (candidate.revision !== input.expectedCandidateRevision || candidate.inputRevision !== input.expectedProjectRevision) throw new RepositoryOperationError("CANDIDATE_STALE");
  if (storyState.revision !== input.expectedStoryStateRevision || candidate.storyStateRevision !== input.expectedStoryStateRevision) throw new RepositoryOperationError("STORY_STATE_REVISION_CONFLICT");
  if (candidate.chapterRevision !== input.expectedChapterRevision) throw new RepositoryOperationError("CANDIDATE_STALE");
  if (storyBible.projectId !== input.projectId) throw new RepositoryOperationError("PROJECT_SCOPE_MISMATCH");
  if (input.expectedStoryBibleRevision !== undefined && (storyBible.revision !== input.expectedStoryBibleRevision || candidate.storyBibleRevision !== input.expectedStoryBibleRevision)) throw new RepositoryOperationError("STORY_BIBLE_REVISION_CONFLICT");
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
  const payloadFingerprint = acceptChoicePayloadFingerprint(input);
  const nextContent = `${current.chapter.content}${current.chapter.content ? "\n\n" : ""}${input.acceptedText}`.trim();
  const project: NovelProject = { ...current.project, revision: current.project.revision + 1, parentRevision: current.project.revision, updatedAt: now, activeChapterId: current.chapter.id };
  const chapter: Chapter = { ...current.chapter, revision: current.chapter.revision + 1, parentRevision: current.chapter.revision, updatedAt: now, content: nextContent };
  const candidate: ChoiceCandidate = { ...current.candidate, revision: current.candidate.revision + 1, parentRevision: current.candidate.revision, updatedAt: now, status: "accepted" };
  const storyState = applyStoryChoiceEffect(current.storyState, current.candidate.effect);
  const storyBibleDeltaBase = makeRecord(input.projectId, "user");
  const storyBibleDelta: StoryBibleDelta = {
    ...storyBibleDeltaBase, deltaId: storyBibleDeltaBase.id, transactionId: input.operationId,
    chapterId: chapter.id, sceneId: current.candidate.sceneId ?? null, candidateId: candidate.id,
    acceptedChoiceId, baseRevision: current.storyBible.revision, resultingRevision: current.storyBible.revision + 1,
    kind: "accepted_choice", acceptedText: input.acceptedText, appliedEffect: current.candidate.effect,
    status: "committed", deltaSchemaVersion: "story-bible-delta-v1",
  };
  const storyBible: StoryBible = {
    ...current.storyBible, revision: current.storyBible.revision + 1, parentRevision: current.storyBible.revision,
    updatedAt: now, interactionDeltaIds: [...(current.storyBible.interactionDeltaIds ?? []), storyBibleDelta.id],
  };
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
    payloadFingerprint,
    completedAt: now,
  };
  const approvalBase = makeRecord(input.projectId, "system");
  const approvalTransaction: ApprovalTransaction = {
    ...approvalBase, id: input.operationId, transactionId: input.operationId, operationId: input.operationId,
    idempotencyKey: input.idempotencyKey, payloadFingerprint, expectedRevision: input.expectedProjectRevision,
    baseRevision: current.project.revision, resultingRevision: project.revision, actor: input.actor ?? "user",
    origin: input.origin ?? "repository", workId: input.projectId, chapterId: input.chapterId,
    sceneId: current.candidate.sceneId ?? null, candidateId: candidate.id, selectedChoiceId: candidate.optionKey,
    timestamp: now, transactionSchemaVersion: "approval-transaction-v1", transactionStatus: "committed",
    acceptedChoiceId, branchId, storyBibleDeltaId: storyBibleDelta.id,
  };
  const idempotencyBase = makeRecord(input.projectId, "system");
  const idempotencyRecord: IdempotencyRecord = {
    ...idempotencyBase, id: input.idempotencyKey, idempotencyKey: input.idempotencyKey,
    operationType: "accept_choice", payloadFingerprint, transactionId: input.operationId,
    operationId: input.operationId, candidateId: candidate.id, acceptedChoiceId, branchId,
    storyBibleDeltaId: storyBibleDelta.id, resultRevision: project.revision, status: "committed",
    idempotencySchemaVersion: "idempotency-record-v1",
  };
  return { project, chapter, candidate, storyState, acceptedChoice, branch, storyBible, storyBibleDelta, approvalTransaction, idempotencyRecord, journal };
}

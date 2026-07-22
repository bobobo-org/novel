import type { AcceptedChoice, ApprovalTransaction, Chapter, ChoiceCandidate, DomainRecord, IdempotencyRecord, NovelProject, ProjectBundle, StoryBible, StoryBibleDelta, StoryBranch, StoryState } from "../../domain/index";

export const NOVEL_STORES = ["projects","creationDrafts","projectSeeds","chapters","scenes","characters","relationships","worlds","worldRules","lore","timeline","storyStates","candidates","acceptedChoices","storyBranches","storyBibles","storyBibleDeltas","approvalTransactions","idempotencyRecords","tasks","achievements","readerStates","readerNotes","readerBookmarks","backups","settings","aiJobs","migrationJournal","operationJournal"] as const;
export type NovelStoreName = (typeof NOVEL_STORES)[number];

export class RevisionConflictError extends Error {
  readonly expected: number;
  readonly actual: number;
  constructor(expected: number, actual: number) { super(`資料版本已變更（預期 ${expected}，目前 ${actual}）`); this.name = "RevisionConflictError"; this.expected = expected; this.actual = actual; }
}

export class RepositoryOperationError extends Error {
  readonly code: string;
  constructor(code: string, message = code) { super(message); this.name = "RepositoryOperationError"; this.code = code; }
}

export type AcceptChoiceTransactionInput = {
  operationId: string;
  idempotencyKey: string;
  projectId: string;
  chapterId: string;
  candidateId: string;
  parentBranchId?: string | null;
  acceptedText: string;
  choiceLabel?: string | null;
  expectedProjectRevision: number;
  expectedChapterRevision: number;
  expectedCandidateRevision: number;
  expectedStoryStateRevision: number;
  expectedStoryBibleRevision?: number;
  actor?: "user";
  origin?: "studio" | "repository";
};

export type AcceptChoiceTransactionResult = {
  replayed: boolean;
  project: NovelProject;
  chapter: Chapter;
  candidate: ChoiceCandidate;
  storyState: StoryState;
  acceptedChoice: AcceptedChoice;
  branch: StoryBranch;
  storyBible: StoryBible;
  storyBibleDelta: StoryBibleDelta;
  approvalTransaction: ApprovalTransaction;
  idempotencyRecord: IdempotencyRecord;
};

export interface NovelRepository {
  readonly kind: "indexeddb" | "memory";
  isAvailable(): boolean;
  get<T extends DomainRecord>(store: NovelStoreName, id: string): Promise<T | null>;
  list<T extends DomainRecord>(store: NovelStoreName, projectId?: string): Promise<T[]>;
  put<T extends DomainRecord>(store: NovelStoreName, record: T, expectedRevision?: number): Promise<T>;
  remove(store: NovelStoreName, id: string): Promise<void>;
  createProject(bundle: ProjectBundle, requestId: string): Promise<ProjectBundle>;
  acceptChoiceTransaction(input: AcceptChoiceTransactionInput): Promise<AcceptChoiceTransactionResult>;
  listAcceptedChoices(projectId: string, chapterId?: string): Promise<AcceptedChoice[]>;
  listStoryBranches(projectId: string, chapterId?: string): Promise<StoryBranch[]>;
  deleteInteractionsByProject(projectId: string): Promise<void>;
  exportProject(projectId: string): Promise<Record<string, unknown[]>>;
  importProject(payload: Record<string, unknown[]>, mode: "copy" | "replace", targetProjectId?: string): Promise<string>;
}

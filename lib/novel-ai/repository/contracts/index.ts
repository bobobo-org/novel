import type { AcceptedChoice, ApprovalTransaction, Chapter, ChoiceCandidate, DomainRecord, IdempotencyRecord, NovelProject, ProjectBundle, StoryBible, StoryBibleDelta, StoryBranch, StoryState } from "../../domain/index";
import type { ApproveDramaProjectionInput, ApproveDramaProjectionResult, DramaProjectionPackage, MarkDramaProjectionsStaleInput, MarkDramaProjectionsStaleResult } from "../../drama-os/types";
import { CHARACTER_AGENT_STORE_NAMES } from "../../character-agent/repository";
import type {
  ApproveCharacterProposalInput,
  ApproveCharacterProposalResult,
  RejectCharacterProposalInput,
  RejectCharacterProposalResult,
} from "../../character-agent/types";

export const LEGACY_NOVEL_STORES = ["projects","creationDrafts","projectSeeds","chapters","scenes","characters","relationships","worlds","worldRules","lore","timeline","storyStates","candidates","acceptedChoices","storyBranches","storyBibles","storyBibleDeltas","approvalTransactions","idempotencyRecords","tasks","achievements","readerStates","readerNotes","readerBookmarks","backups","settings","aiJobs","migrationJournal","operationJournal"] as const;
export const DRAMA_STORES = ["dramaProjects","dramaSeasons","dramaEpisodes","dramaScenes","dramaBeats","dramaBranchCandidates","dramaEvaluations","dramaApprovals","narrativeCanonLinks"] as const;
export const CHARACTER_AGENT_STORES = CHARACTER_AGENT_STORE_NAMES;
export const NOVEL_STORES = [...LEGACY_NOVEL_STORES, ...DRAMA_STORES, ...CHARACTER_AGENT_STORES] as const;
export type NovelStoreName = (typeof NOVEL_STORES)[number];
export const REQUIRED_RESTORE_STORES = NOVEL_STORES.filter((store) => !["backups", "settings", "aiJobs", "migrationJournal", "operationJournal"].includes(store));
export const P24A_REQUIRED_RESTORE_STORES = [...LEGACY_NOVEL_STORES, ...DRAMA_STORES].filter((store) => !["backups", "settings", "aiJobs", "migrationJournal", "operationJournal"].includes(store));
export const LEGACY_REQUIRED_RESTORE_STORES = LEGACY_NOVEL_STORES.filter((store) => !["backups", "settings", "aiJobs", "migrationJournal", "operationJournal"].includes(store));

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
  expectedStoryBibleRevision: number;
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

export type CommitStudioCandidateTransactionInput = {
  operationId: string;
  idempotencyKey: string;
  payloadFingerprint: string;
  projectId: string;
  chapterId: string;
  taskId: string;
  mode: "append" | "replace" | "summary";
  expectedChapterRevision: number;
  nextContent: string;
  nextSummary: string | null;
  acceptedContentDigest: string;
  resultContentDigest: string;
  commitId: string;
};

export type StudioCandidateOperationJournal = DomainRecord & {
  operationId: string;
  idempotencyKey: string;
  operationType: "studio_candidate_commit";
  payloadFingerprint: string;
  chapterId: string;
  taskId: string;
  mode: CommitStudioCandidateTransactionInput["mode"];
  sourceRevision: number;
  resultingRevision: number;
  acceptedContentDigest: string;
  resultContentDigest: string;
  commitId: string;
  completedAt: string;
};

export type CommitStudioCandidateTransactionResult = {
  replayed: boolean;
  chapter: Chapter;
  journal: StudioCandidateOperationJournal;
};

export interface NovelRepository {
  readonly kind: "indexeddb" | "memory" | "unavailable";
  isAvailable(): boolean;
  get<T extends DomainRecord>(store: NovelStoreName, id: string): Promise<T | null>;
  list<T extends DomainRecord>(store: NovelStoreName, projectId?: string): Promise<T[]>;
  put<T extends DomainRecord>(store: NovelStoreName, record: T, expectedRevision?: number): Promise<T>;
  remove(store: NovelStoreName, id: string): Promise<void>;
  createProject(bundle: ProjectBundle, requestId: string): Promise<ProjectBundle>;
  acceptChoiceTransaction(input: AcceptChoiceTransactionInput): Promise<AcceptChoiceTransactionResult>;
  commitStudioCandidateTransaction(
    input: CommitStudioCandidateTransactionInput,
  ): Promise<CommitStudioCandidateTransactionResult>;
  saveDramaProjectionTransaction(input: DramaProjectionPackage): Promise<void>;
  approveDramaProjectionTransaction(input: ApproveDramaProjectionInput): Promise<ApproveDramaProjectionResult>;
  markDramaProjectionsStaleTransaction(input: MarkDramaProjectionsStaleInput): Promise<MarkDramaProjectionsStaleResult>;
  approveCharacterProposalTransaction(input: ApproveCharacterProposalInput): Promise<ApproveCharacterProposalResult>;
  rejectCharacterProposalTransaction(input: RejectCharacterProposalInput): Promise<RejectCharacterProposalResult>;
  listAcceptedChoices(projectId: string, chapterId?: string): Promise<AcceptedChoice[]>;
  listStoryBranches(projectId: string, chapterId?: string): Promise<StoryBranch[]>;
  deleteInteractionsByProject(projectId: string): Promise<void>;
  exportProject(projectId: string): Promise<Record<string, unknown[]>>;
  importProject(payload: Record<string, unknown[]>, mode: "copy" | "replace", targetProjectId?: string): Promise<string>;
}

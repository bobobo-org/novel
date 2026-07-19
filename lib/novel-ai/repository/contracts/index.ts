import type { DomainRecord, ProjectBundle } from "../../domain/index";

export const NOVEL_STORES = ["projects","creationDrafts","projectSeeds","chapters","scenes","characters","relationships","worlds","worldRules","lore","timeline","storyStates","candidates","storyBibles","tasks","achievements","readerStates","backups","settings","aiJobs","migrationJournal"] as const;
export type NovelStoreName = (typeof NOVEL_STORES)[number];

export class RevisionConflictError extends Error {
  readonly expected: number;
  readonly actual: number;
  constructor(expected: number, actual: number) { super(`資料版本已變更（預期 ${expected}，目前 ${actual}）`); this.name = "RevisionConflictError"; this.expected = expected; this.actual = actual; }
}

export interface NovelRepository {
  readonly kind: "indexeddb" | "memory";
  isAvailable(): boolean;
  get<T extends DomainRecord>(store: NovelStoreName, id: string): Promise<T | null>;
  list<T extends DomainRecord>(store: NovelStoreName, projectId?: string): Promise<T[]>;
  put<T extends DomainRecord>(store: NovelStoreName, record: T, expectedRevision?: number): Promise<T>;
  remove(store: NovelStoreName, id: string): Promise<void>;
  createProject(bundle: ProjectBundle, requestId: string): Promise<ProjectBundle>;
  exportProject(projectId: string): Promise<Record<string, unknown[]>>;
}

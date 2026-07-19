import type { CapabilityStatus } from "./capability-status";

export type CapabilityDefinition = {
  id: string;
  contractStatus: CapabilityStatus;
  runtimeStatus: CapabilityStatus;
  evidence: string[];
  limitations?: string[];
};

export const CAPABILITY_REGISTRY: CapabilityDefinition[] = [
  { id: "indexedDb.core", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["IndexedDbNovelRepository schema v3"] },
  { id: "indexedDb.projects", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["projects store and projectId index"] },
  { id: "indexedDb.reader", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["readerStates, readerNotes, readerBookmarks stores"] },
  { id: "indexedDb.backups", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["novel-backup-v3 repository export/import"] },
  { id: "indexedDb.acceptedChoices", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["acceptedChoices store, schema v3"] },
  { id: "indexedDb.storyBranches", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["storyBranches store, schema v3"] },
  { id: "indexedDb.fullAdoption", contractStatus: "partial", runtimeStatus: "partial", evidence: ["Studio canonical interaction data uses IndexedDB"], limitations: ["Legacy compatibility metadata remains in localStorage"] },
  { id: "backup.repository", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["NovelRepository exportProject/importProject"] },
  { id: "backup.create", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["createProjectBackup"] },
  { id: "backup.export", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["novel-backup-v3 manifest and SHA-256"] },
  { id: "backup.importCopy", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["recursive ID remap"] },
  { id: "backup.restoreReplace", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["single IndexedDB replace transaction"] },
  { id: "backup.hashValidation", contractStatus: "ready", runtimeStatus: "ready", evidence: ["SHA-256 contentHash validation"] },
  { id: "backup.safeRestorePoint", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["backups store excluded from replace deletion"] },
  { id: "backup.acceptedChoices", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["acceptedChoices included in NOVEL_STORES"] },
  { id: "backup.storyBranches", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["storyBranches included in NOVEL_STORES"] },
  { id: "backup.legacyFormatImport", contractStatus: "partial", runtimeStatus: "partial", evidence: ["Legacy project migration preview"], limitations: ["Ambiguous legacy interactions require manual review"] },
];

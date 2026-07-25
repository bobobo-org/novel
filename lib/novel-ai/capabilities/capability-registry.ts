import type { CapabilityStatus } from "./capability-status";

export type CapabilityDefinition = {
  id: string;
  contractStatus: CapabilityStatus;
  runtimeStatus: CapabilityStatus;
  evidence: string[];
  limitations?: string[];
};

export const CAPABILITY_REGISTRY: CapabilityDefinition[] = [
  { id: "indexedDb.core", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["IndexedDbNovelRepository schema v5"] },
  { id: "indexedDb.projects", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["projects store and projectId index"] },
  { id: "indexedDb.reader", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["readerStates, readerNotes, readerBookmarks stores"] },
  { id: "indexedDb.backups", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["novel-backup-v4 repository export/import"] },
  { id: "indexedDb.acceptedChoices", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["acceptedChoices store, schema v4"] },
  { id: "indexedDb.storyBranches", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["storyBranches store, schema v4"] },
  { id: "indexedDb.fullAdoption", contractStatus: "partial", runtimeStatus: "partial", evidence: ["Studio canonical interaction data uses IndexedDB"], limitations: ["Legacy compatibility metadata remains in localStorage"] },
  { id: "backup.repository", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["NovelRepository exportProject/importProject"] },
  { id: "backup.create", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["createProjectBackup"] },
  { id: "backup.export", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["novel-backup-v4 manifest and SHA-256"] },
  { id: "backup.importCopy", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["recursive ID remap"] },
  { id: "backup.restoreReplace", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["single IndexedDB replace transaction"] },
  { id: "backup.hashValidation", contractStatus: "ready", runtimeStatus: "ready", evidence: ["SHA-256 contentHash validation"] },
  { id: "backup.safeRestorePoint", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["backups store excluded from replace deletion"] },
  { id: "backup.acceptedChoices", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["acceptedChoices included in NOVEL_STORES"] },
  { id: "backup.storyBranches", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["storyBranches included in NOVEL_STORES"] },
  { id: "repository.approvalTransaction", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["IndexedDB v4 atomic acceptance transaction"] },
  { id: "repository.revisionGuard", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["project, chapter, candidate, story state, Story Bible revision guards"] },
  { id: "repository.idempotency", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["payload-bound idempotencyRecords store"] },
  { id: "backup.approvalTransactions", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["approvalTransactions included in backup manifest"] },
  { id: "backup.idempotencyRecords", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["idempotencyRecords included in backup manifest"] },
  { id: "browser.permissionGateway", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["R1K automated browser permission matrix"], limitations: ["Permission verification does not imply Browser AI runtime availability"] },
  { id: "browser.aiRuntime", contractStatus: "ready", runtimeStatus: "not_implemented", evidence: ["Provider contract only"], limitations: ["No installed browser model runtime"] },
  { id: "dramaOsCore", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["drama-os-v1 project, episode, scene and evaluation contracts"] },
  { id: "novelToDramaProjection", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["projectNovelToDrama source-grounded candidate pipeline"] },
  { id: "episodePlanner", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["Format-aware episode planner"] },
  { id: "scenePlanner", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["Beat-linked scene planner"] },
  { id: "beatSheet", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["Profile-constrained beat sheet"] },
  { id: "hookEngine", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["Opening hook and cliffhanger engines"] },
  { id: "emotionCurve", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["Event-linked emotion curve"] },
  { id: "interactiveDramaCandidates", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["Distinct A/B/C creator candidates; canonicalMutation=0"] },
  { id: "dramaApproval", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["Atomic Drama Adaptation approval transaction with revision and idempotency guards"] },
  { id: "dramaBackup", contractStatus: "ready", runtimeStatus: "client_dependent", evidence: ["novel-backup-v4 includes Drama OS stores and accepts v3"] },
  { id: "characterAgent", contractStatus: "not_implemented", runtimeStatus: "not_implemented", evidence: [], limitations: ["Scheduled for P2.4B"] },
  { id: "audienceVoting", contractStatus: "not_implemented", runtimeStatus: "not_implemented", evidence: [], limitations: ["Scheduled for P2.4D"] },
  { id: "audienceLearning", contractStatus: "not_implemented", runtimeStatus: "not_implemented", evidence: [], limitations: ["Scheduled for P2.4D"] },
  { id: "visualCharacterBible", contractStatus: "not_implemented", runtimeStatus: "not_implemented", evidence: [], limitations: ["Scheduled for P2.4C"] },
  { id: "storyboard", contractStatus: "not_implemented", runtimeStatus: "not_implemented", evidence: [], limitations: ["Scheduled for P2.4C"] },
  { id: "realVideoGeneration", contractStatus: "contract_only", runtimeStatus: "not_connected", evidence: ["Generic media provider contract only"], limitations: ["Scheduled for P2.4E"] },
  { id: "privateAiHub", contractStatus: "contract_only", runtimeStatus: "not_connected", evidence: ["Private hub job contract"], limitations: ["No runtime connected"] },
  { id: "modelTraining", contractStatus: "contract_only", runtimeStatus: "not_implemented", evidence: ["Governance contract only"], limitations: ["Not started"] },
  { id: "distillation", contractStatus: "contract_only", runtimeStatus: "not_implemented", evidence: ["Governance contract only"], limitations: ["Not started"] },
  { id: "media.storyboard", contractStatus: "contract_only", runtimeStatus: "not_connected", evidence: ["story-media-extension-v1 source-bound candidate contract"], limitations: ["No media generation runtime is connected"] },
  { id: "media.videoPrompt", contractStatus: "contract_only", runtimeStatus: "not_connected", evidence: ["story-media-extension-v1 prompt package"], limitations: ["Output remains an approval candidate"] },
  { id: "media.videoGeneration", contractStatus: "contract_only", runtimeStatus: "not_connected", evidence: ["generic video provider adapter contract"], limitations: ["No Seedance or other video provider is installed or authorized"] },
  { id: "backup.legacyFormatImport", contractStatus: "partial", runtimeStatus: "partial", evidence: ["Legacy project migration preview"], limitations: ["Ambiguous legacy interactions require manual review"] },
];

import type { DomainRecord, OptionalValue, Provenance } from "./common";
import type { AdultExperienceProfile } from "../../novel-data/adult-experience-profile";
import type { RpgStateV3, RpgTurnSettlement } from "./rpg";
export * from "./common";
export * from "./rpg";

export type ProjectSeed = DomainRecord & {
  titleCandidates: string[];
  logline: OptionalValue<string>;
  protagonist: OptionalValue<string>;
  goal: OptionalValue<string>;
  weakness: OptionalValue<string>;
  world: OptionalValue<string>;
  worldRule: OptionalValue<string>;
  conflict: OptionalValue<string>;
  opposition: OptionalValue<string>;
  opening: OptionalValue<string>;
  directions: string[];
};

export type NovelProject = DomainRecord & {
  title: string;
  /** Immutable root for all on-demand people/world/treasure indexes. */
  proceduralRootSeed?: string | null;
  creationMode: "quick" | "guided" | "blank" | "legacy";
  genrePackId: string | null;
  genreId: string | null;
  subgenreId: string | null;
  coreIdea: OptionalValue<string>;
  narrativeStyle: OptionalValue<string>;
  adultMode: boolean;
  adultExperienceProfile?: AdultExperienceProfile | null;
  activeChapterId: string | null;
  storyBibleId: string;
  storyStateId: string;
};

export type ProjectCreationDraft = DomainRecord & {
  mode: NovelProject["creationMode"];
  step: number;
  title: string;
  genrePackId: string | null;
  genreId: string | null;
  subgenreId: string | null;
  coreIdea: OptionalValue<string>;
  protagonist: OptionalValue<string>;
  style: OptionalValue<string>;
  answers: Record<string, OptionalValue<string>>;
  seedCandidate: ProjectSeed | null;
};

export type Chapter = DomainRecord & { title: string; order: number; content: string; summary: string | null; status: "draft" | "completed" };
export type Scene = DomainRecord & { chapterId: string; order: number; title: string; content: string; summary: string | null };
export type CharacterPortraitAtlasCrop = {
  width: number;
  height: number;
  columns: number;
  rows: number;
  column: number;
  row: number;
};
export type CharacterPortraitAsset = {
  id: string;
  source: "catalog" | "upload" | "procedural";
  assetUri: string;
  assetDigest: string;
  atlas?: CharacterPortraitAtlasCrop;
  themeId: string;
  themeLabel: string;
  role: string;
  visualDescription: string;
  traits: string[];
  generatedBy: "openai-image-generation" | "user-upload" | "procedural-story-engine";
  visualVariant?: {
    variant: number;
    hueRotate: number;
    saturation: number;
    brightness: number;
    contrast: number;
    accentLabel: string;
  };
};
export type CharacterPortrait = CharacterPortraitAsset & {
  approvedAt: string;
  approvedBy: "user";
  dataLeftDevice: false;
};
export type CharacterRpgStatKey =
  | "rpg.physique"
  | "rpg.technique"
  | "rpg.intellect"
  | "rpg.charisma"
  | "rpg.will"
  | "rpg.creativity";
export type CharacterRpgArchetype =
  | "balanced"
  | "vanguard"
  | "strategist"
  | "diplomat"
  | "mystic"
  | "creator"
  | "custom";
export type CharacterRpgProfile = {
  schemaVersion: "character-rpg-profile-v1";
  formulaVersion: "novel-rpg-unified-v2" | "novel-rpg-unified-v3";
  archetype: CharacterRpgArchetype;
  stats: Record<CharacterRpgStatKey, number>;
  pointBudget: 300;
  approvedAt: string;
};
export type CharacterPersonalityAxis =
  | "curiosity"
  | "empathy"
  | "ambition"
  | "caution"
  | "loyalty"
  | "volatility";
export type CharacterDynamicsProfile = {
  schemaVersion: "character-dynamics-profile-v1";
  engineVersion: "browser-character-dynamics-v1";
  playthroughSeed: string;
  archetypeId: string;
  archetypeLabel: string;
  personalityAxes: Record<CharacterPersonalityAxis, number>;
  personalityTraits: string[];
  socialRole: string;
  relationshipNeeds: string[];
  behavioralTendencies: string[];
  approvedAt: string;
  approvedBy: "user";
};
export type CharacterSocialMatrixProfile = {
  schemaVersion: "novel-social-matrix-v1";
  sourceCharacterId: string;
  populationIndex: number;
  institutionId: string;
  familyId: string;
  relationshipIds: string[];
  treasureIds: string[];
  candidateFingerprint: string;
  approvedAt: string;
  approvedBy: "user";
};
export type CharacterCultivationProfile = {
  schemaVersion: "character-cultivation-profile-v1";
  spiritRootId: string;
  realmId: string;
  realmStage: "初期" | "中期" | "後期" | "圓滿";
  sectBranchId: string;
  sectRankId: string;
  techniqueIds: string[];
  approvedAt: string;
};
export type Character = DomainRecord & {
  name: string;
  aliases: string[];
  identity: OptionalValue<string>;
  personality: OptionalValue<string>;
  goal: OptionalValue<string>;
  lifeStatus: "unknown" | "alive" | "dead";
  locationId: string | null;
  age?: number | null;
  ageVerified?: boolean;
  fears?: string[];
  privateSecrets?: string[];
  factionIds?: string[];
  values?: string[];
  capabilities?: string[];
  limitations?: string[];
  portrait?: CharacterPortrait | null;
  rpgProfile?: CharacterRpgProfile | null;
  dynamicsProfile?: CharacterDynamicsProfile | null;
  socialMatrixProfile?: CharacterSocialMatrixProfile | null;
  cultivationProfile?: CharacterCultivationProfile | null;
  voiceStyle?: {
    formality: number;
    directness: number;
    emotionalExpressiveness: number;
    sentenceLength: "short" | "mixed" | "long";
    preferredAddressTerms: string[];
  };
};
export type CharacterRelationship = DomainRecord & { fromCharacterId: string; toCharacterId: string; kind: string; summary: string; trust: number | null };
export type ProceduralWorldProfile = {
  schemaVersion: "procedural-world-profile-v1";
  sourceWorldId: string;
  topicId: string;
  topicOrdinal: number;
  worldOrdinal: number;
  relationshipScenarioId: string;
  characterIds: string[];
  treasureIds: string[];
  causalDimensionIds: string[];
  approvedAt: string;
  approvedBy: "user";
};
export type World = DomainRecord & {
  name: OptionalValue<string>;
  era: OptionalValue<string>;
  summary: OptionalValue<string>;
  proceduralWorldProfile?: ProceduralWorldProfile | null;
};
export type WorldRule = DomainRecord & { title: string; description: string; immutable: boolean };
export type ProceduralTreasureLoreProfile = {
  schemaVersion: "procedural-treasure-lore-v1";
  ordinal: number;
  holderCharacterId: string;
  stakeholderCharacterIds: string[];
  relationshipScenarioId: string;
  causalDimensionIds: string[];
  approvedAt: string;
  approvedBy: "user";
};
export type LoreEntry = DomainRecord & {
  kind: "location" | "faction" | "item" | "secret" | "custom";
  title: string;
  content: string;
  proceduralTreasureProfile?: ProceduralTreasureLoreProfile | null;
};
export type TimelineEvent = DomainRecord & { chapterId: string | null; storyTime: string | null; title: string; summary: string };

export type StoryState = DomainRecord & {
  protagonistStats: Record<string, number>;
  resources: Record<string, number>;
  money: number | null;
  inventory: string[];
  relationships: Record<string, number>;
  reputation: number | null;
  factionStanding: Record<string, number>;
  worldFlags: Record<string, boolean | string | number>;
  questStates: Record<string, string>;
  achievementStates: Record<string, string>;
  timeState: string | null;
  locationState: string | null;
  riskState: string | null;
  rpgState?: RpgStateV3;
};

export type StoryChoiceEffect = import("./rpg").RpgCanonicalEffect;
export type ChoiceCandidate = Omit<DomainRecord, "provenance"> & {
  provenance: AIProvenance;
  prompt: string;
  optionKey: "A" | "B" | "C" | "custom";
  text: string;
  consequence: string;
  effect: StoryChoiceEffect;
  status: "pending" | "accepted" | "rejected";
  chapterId: string;
  sceneId?: string | null;
  inputRevision: number;
  chapterRevision: number;
  storyStateRevision: number;
  storyBibleRevision?: number;
  rpgSettlement?: RpgTurnSettlement;
};
export type AcceptedChoice = Omit<DomainRecord, "provenance"> & {
  provenance: AIProvenance;
  acceptedChoiceId: string;
  chapterId: string;
  sceneId?: string | null;
  candidateId: string;
  branchId: string;
  choiceKey: "A" | "B" | "C" | "custom";
  choiceLabel?: string | null;
  acceptedText: string;
  inputRevision: number;
  resultingRevision: number;
  storyStateRevisionBefore: number;
  storyStateRevisionAfter: number;
  effectOperationId: string;
  appliedEffect: StoryChoiceEffect;
  acceptedAt: string;
  rpgTurnReceiptId?: string | null;
};
export type StoryBranch = DomainRecord & {
  branchId: string;
  parentBranchId: string | null;
  sourceCandidateId: string;
  acceptedChoiceId: string;
  chapterId: string;
  sceneId?: string | null;
  status: "active" | "superseded" | "archived";
  name: string;
  headRevision: number;
};
export type OperationJournal = DomainRecord & {
  operationId: string;
  idempotencyKey: string;
  operationType: "accept_choice";
  candidateId: string;
  acceptedChoiceId: string;
  branchId: string;
  resultRevision: number;
  payloadFingerprint: string;
  completedAt: string;
  rpgTurnReceiptId?: string | null;
};
export type StoryBible = DomainRecord & { theme: OptionalValue<string>; style: OptionalValue<string>; protagonistIds: string[]; characterIds: string[]; relationshipIds: string[]; worldId: string | null; worldRuleIds: string[]; loreIds: string[]; timelineEventIds: string[]; foreshadowing: string[]; unresolvedThreads: string[]; resolvedThreads?: string[]; forbiddenContradictions: string[]; authorPreferences: string[]; interactionDeltaIds?: string[] };
export type StoryBibleDelta = DomainRecord & {
  deltaId: string;
  transactionId: string;
  chapterId: string;
  sceneId: string | null;
  candidateId: string;
  acceptedChoiceId: string;
  baseRevision: number;
  resultingRevision: number;
  kind: "accepted_choice";
  acceptedText: string;
  appliedEffect: StoryChoiceEffect;
  status: "committed";
  deltaSchemaVersion: "story-bible-delta-v1";
};
export type ApprovalTransaction = DomainRecord & {
  transactionId: string;
  operationId: string;
  idempotencyKey: string;
  payloadFingerprint: string;
  expectedRevision: number;
  baseRevision: number;
  resultingRevision: number;
  actor: "user";
  origin: "studio" | "repository";
  workId: string;
  chapterId: string;
  sceneId: string | null;
  candidateId: string;
  selectedChoiceId: string;
  timestamp: string;
  transactionSchemaVersion: "approval-transaction-v1";
  transactionStatus: "committed";
  acceptedChoiceId: string;
  branchId: string;
  storyBibleDeltaId: string;
  rpgTurnReceiptId?: string | null;
};
export type IdempotencyRecord = DomainRecord & {
  idempotencyKey: string;
  operationType: "accept_choice";
  payloadFingerprint: string;
  transactionId: string;
  operationId: string;
  candidateId: string;
  acceptedChoiceId: string;
  branchId: string;
  storyBibleDeltaId: string;
  resultRevision: number;
  status: "committed";
  idempotencySchemaVersion: "idempotency-record-v1";
  rpgTurnReceiptId?: string | null;
};
export type WritingTask = DomainRecord & { title: string; kind: "main" | "side" | "character" | "world" | "writing" | "exploration" | "relationship"; status: "not_started" | "active" | "completed" | "paused"; progress: number; target: number };
export type Achievement = DomainRecord & { title: string; progress: number; target: number; unlockedAt: string | null };
export type ReaderState = DomainRecord & {
  chapterId: string | null;
  positionType: "anchor" | "ratio" | "legacy_scroll";
  positionValue: string | number | null;
  contentAnchor: string | null;
  scrollTop: number;
  percentage: number;
  theme: "light" | "night" | "eye" | "paper";
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  paragraphSpacing: number;
  lastReadAt: string | null;
};
export type ReaderNote = DomainRecord & { chapterId: string; anchor: string; excerpt: string; content: string; needsRelocation: boolean };
export type ReaderBookmark = DomainRecord & { chapterId: string; anchor: string; excerpt: string; label: string | null; needsRelocation: boolean };
export type BackupManifest = {
  format: "novel-project-backup";
  formatVersion: "novel-backup-v3" | "novel-backup-v4" | "novel-backup-v5" | "novel-backup-v6";
  backupId: string;
  projectId: string;
  projectSchemaVersion: string;
  createdAt: string;
  appCommit: string | null;
  releaseProductCommit: string | null;
  releaseBaseCommit: string | null;
  releaseTag: string | null;
  releaseRevision: string | null;
  releaseBuild: string | null;
  sourceDevice: "browser";
  contentHash: string;
  recordCounts: Record<string, number>;
  includedStores: string[];
  compression: "none";
  encryption: "none";
};
export type ProjectBackup = DomainRecord & {
  formatVersion: "novel-backup-v2" | "novel-backup-v3" | "novel-backup-v4" | "novel-backup-v5" | "novel-backup-v6";
  kind: "initial" | "quick" | "full" | "safety";
  byteSize: number;
  snapshot: Record<string, unknown>;
  sovereignLearningSnapshot?: import("../sovereign-learning/backup").SovereignLearningBackupSnapshot;
  manifest?: BackupManifest;
};
export type AIProvenance = Provenance & { providerId: string; modelId: string | null; taskType: string; externalRequest: boolean; dataLeftDevice: boolean; contextSources: string[]; elapsedMs: number | null };

export type ConversationSessionStatus = "active" | "archived" | "deleted";
export type ConversationMessageRole = "user" | "assistant" | "tool" | "system_notice";
export type ConversationMessageStatus = "pending" | "streaming" | "completed" | "failed" | "cancelled";
export type ConversationArtifactStatus = "candidate" | "approved" | "rejected" | "superseded";
export type ConversationArtifactTargetStore =
  | "chapters"
  | "storyBibles"
  | "characters"
  | "relationships"
  | "worldRules"
  | "lore"
  | "timeline"
  | "storyStates"
  | "dramaProjects"
  | "dramaSeasons"
  | "dramaEpisodes"
  | "dramaScenes"
  | "dramaBeats"
  | "learningImportSessions"
  | "controlledLearning"
  | "none";
export type ConversationCanonicalTargetStore = Exclude<ConversationArtifactTargetStore, "controlledLearning" | "none">;

export type ConversationSession = DomainRecord & {
  conversationSchemaVersion: "conversation-session-v1";
  title: string;
  status: ConversationSessionStatus;
  activeChapterId: string | null;
  lastMessageAt: string | null;
  summaryDigest: string | null;
  parentSessionId: string | null;
  branchedFromMessageId: string | null;
};

export type ConversationMessage = DomainRecord & {
  conversationSchemaVersion: "conversation-message-v1";
  sessionId: string;
  role: ConversationMessageRole;
  content: string;
  contentDigest: string;
  status: ConversationMessageStatus;
  parentMessageId: string | null;
  sourceMessageId: string | null;
  candidateIds: string[];
  toolInvocationIds: string[];
  attachmentIds: string[];
  completedAt: string | null;
};

export type ConversationExecutionReceipt = {
  receiptId: string;
  modelId: string | null;
  modelDigest: string | null;
  providerRunId: string | null;
  contextDigest: string;
  outputDigest: string | null;
  externalRequest: boolean;
  dataLeftDevice: boolean;
  latencyMs: number | null;
  closedAgentSchemaVersion?: "closed-agent-os-v2";
  closedAgentBackendId?: "browser-ai" | "local-ollama" | "private-ai-hub";
  normalizationReceiptId?: string;
  traditionalChineseNormalizerVersion?: string;
  closedAgentCacheOrigin?: ConversationClosedAgentCacheOriginProof;
};

export type ConversationClosedAgentCacheOriginProof = {
  schemaVersion: "conversation-closed-agent-cache-origin-v2";
  layer: "exact" | "semantic";
  entryId: string;
  entryValueDigest: string;
  originCandidateId: string;
  originTaskId: string;
  originRequestId: string;
  originLedgerId: string;
  originLedgerBlockHash: string;
  originBackendId: "browser-ai" | "local-ollama" | "private-ai-hub";
  originModelId: string;
  originModelDigest: string;
  originContentDigest: string;
  originContextDigest: string;
  originNormalizationReceiptId: string;
  originNormalizerVersion: string;
  namespaceDigest: string;
};

export type ConversationClosedAgentApprovalBindingProof = {
  schemaVersion: "conversation-closed-agent-approval-binding-v1";
  candidateId: string;
  candidateTaskId: string;
  candidateBackendId: "browser-ai" | "local-ollama" | "private-ai-hub";
  candidateModelId: string;
  candidateModelDigest: string;
  candidateRawContentDigest: string;
  candidateContextDigest: string;
  normalizationReceiptId: string;
  normalizerVersion: string;
  cacheOrigin: ConversationClosedAgentCacheOriginProof | null;
  sessionId: string;
  sessionRevision: number;
  sourceMessageId: string;
  sourceMessageRevision: number;
  sourceMessageContentDigest: string;
  artifactId: string;
  artifactRevision: number;
  artifactCandidateDigest: string;
  invocationId: string;
  invocationRevision: number;
  targetStore: "chapters" | "characters" | "worldRules";
  targetRecordId: string;
  targetSourceRevision: number;
};

export type ConversationToolInvocation = DomainRecord & {
  conversationSchemaVersion: "conversation-tool-invocation-v1";
  sessionId: string;
  messageId: string;
  taskId: string;
  toolId: string;
  taskType: string;
  inputDigest: string;
  contextDigest: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  completedAt: string | null;
  actualExecutor: string | null;
  modelId: string | null;
  modelDigest: string | null;
  executionReceipt: ConversationExecutionReceipt | null;
  externalRequest: boolean;
  dataLeftDevice: boolean;
  canonicalMutationCount: number;
  safeProgress: { stage: string; percent: number | null; message: string } | null;
  safeErrorCode: string | null;
};

export type ConversationAttachment = DomainRecord & {
  conversationSchemaVersion: "conversation-attachment-v1";
  sessionId: string;
  displayName: string;
  safeSourceAlias: string;
  format: "txt" | "markdown" | "html" | "json" | "pdf" | "docx";
  byteLength: number;
  contentHash: string;
  rightsBasis: string;
  rightsEvidenceHash: string;
  /** Optional only for legacy read compatibility; fresh records always set both. */
  userConfirmedRights?: true;
  rightsConfirmationSchemaVersion?:
    "conversation-attachment-rights-confirmation-v1";
  localAnalysisOnly: true;
  rawContentRetained: false;
  parsingStatus: "pending" | "parsing" | "completed" | "failed" | "cancelled" | "ocr_required";
  warnings?: string[];
};

export type ConversationArtifact = DomainRecord & {
  conversationSchemaVersion: "conversation-artifact-v1";
  sessionId: string;
  sourceMessageId: string;
  artifactType: "novel" | "drama" | "rpg" | "character" | "world_rule" | "story_bible" | "learning_rule" | "diff" | "attachment_analysis";
  targetStore: ConversationArtifactTargetStore;
  targetRecordId: string;
  sourceRevision: number;
  candidateContent: string;
  candidateDigest: string;
  status: ConversationArtifactStatus;
  approvedAt: string | null;
  approvedRevision: number | null;
};

export type ConversationSummary = DomainRecord & {
  conversationSchemaVersion: "conversation-summary-v1";
  sessionId: string;
  sourceMessageIds: string[];
  content: string;
  contentDigest: string;
  canonRevisionDigest: string;
  invalidatedAt: string | null;
};

export type ConversationApprovalTransaction = DomainRecord & {
  conversationSchemaVersion: "conversation-approval-transaction-v1";
  transactionId: string;
  operationId: string;
  idempotencyKey: string;
  idempotencyScope: string;
  payloadFingerprint: string;
  sessionId: string;
  sourceMessageId: string;
  artifactId: string;
  candidateDigest: string;
  targetStore: ConversationCanonicalTargetStore;
  targetRecordId: string;
  sourceRevision: number;
  resultingRevision: number;
  actor: "user";
  canonicalMutationCount: 1;
  commitMode: "atomic_canonical" | "external_canonical";
  applicationMode: "append" | "replace" | "summary" | "record_replace" | "external_commit";
  externalCommitId: string | null;
  approvedAt: string;
  status: "committed";
};

export type LearningImportSession = DomainRecord & {
  learningImportSchemaVersion: "learning-import-session-v1";
  importSessionId: string;
  sessionId: string;
  attachmentIds: string[];
  totalParts: number;
  completedParts: number;
  failedParts: number;
  status: "staging" | "processing" | "cancelled" | "failed" | "ready_to_finalize" | "committed" | "rolled_back";
  mode: "atomic_document" | "partial";
  manifestDigest: string;
  startedAt: string;
  completedAt: string | null;
  stagingNamespace: string;
  retryablePartIndexes: number[];
};

export type ProjectBundle = {
  project: NovelProject;
  seed: ProjectSeed;
  storyBible: StoryBible;
  protagonist: Character | null;
  /** Supporting cast materialized with the project so prose generation starts as an ensemble. */
  cast?: Character[];
  /** Canonical links between the protagonist and the initial supporting cast. */
  relationships?: CharacterRelationship[];
  world: World | null;
  /** Topic-specific rules selected during creation. */
  worldRules?: WorldRule[];
  /** Topic-specific institutions, resources and assets that may enter the story. */
  lore?: LoreEntry[];
  storyState: StoryState;
  initialTask: WritingTask;
  readerState: ReaderState;
  initialBackup: ProjectBackup;
};

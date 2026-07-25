import type { DomainRecord } from "../domain";
import type { PlatformProviderId } from "../router/platform-types";
import type {
  CharacterStateReference,
  CreationPreferenceReference,
  NarrativePlanReference,
  StoryBlueprintReference,
  WorldStateReference,
} from "./upstream-references";

export const DRAMA_OS_SCHEMA_VERSION = "drama-os-v1" as const;
export const DRAMA_OS_MIGRATION_VERSION = "p24a-drama-os-core-v1" as const;

export type DramaFormatProfileId =
  | "DRAMA_60_SECONDS"
  | "DRAMA_90_SECONDS"
  | "DRAMA_3_MINUTES"
  | "DRAMA_10_MINUTES"
  | "DRAMA_30_MINUTES"
  | "DRAMA_90_TO_120_MINUTES";

export type DramaCandidateStatus =
  | "draft"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "stale"
  | "private_simulation";

export type EvidenceSupport = "SUPPORTED" | "INFERRED" | "UNKNOWN" | "CONFLICTING";
export type ProjectionStatus = "current" | "stale" | "approved" | "rejected";
export type DramaBranchMode = "creator_candidate" | "private_simulation";

export type DramaSourceReference = {
  storyId: string;
  chapterId: string;
  chunkId: string | null;
  excerpt: string;
  textStart: number;
  textEnd: number;
  sourceRevision: number;
  support: EvidenceSupport;
};

export type ContinuityConstraint = {
  kind: "character" | "world_rule" | "timeline" | "location" | "relationship" | "source";
  description: string;
  sourceReferenceIds: string[];
  severity: "info" | "warning" | "blocking";
};

export type DramaFormatProfile = {
  id: DramaFormatProfileId;
  targetDurationSeconds: number;
  openingHookDeadlineSeconds: number;
  conflictIntervalSeconds: number;
  reversalIntervalSeconds: number;
  minimumPayoffCount: number;
  maximumSceneCount: number;
  dialogueDensity: number;
  visualActionDensity: number;
  cliffhangerRequired: boolean;
  recommendedBeatRange: readonly [number, number];
  structure: "single_turn" | "micro_arc" | "multi_scene" | "chapter_arc" | "feature_arc";
};

export type NarrativeFact<T> = {
  value: T | null;
  support: EvidenceSupport;
  sourceReferences: DramaSourceReference[];
  risk: string | null;
};

export type NarrativeAnalysis = {
  primaryProtagonist: NarrativeFact<string>;
  secondaryProtagonists: NarrativeFact<string[]>;
  antagonisticForces: NarrativeFact<string[]>;
  characterGoals: NarrativeFact<Record<string, string>>;
  characterObstacles: NarrativeFact<Record<string, string[]>>;
  stakes: NarrativeFact<string[]>;
  majorEvents: NarrativeFact<string[]>;
  reversibleEvents: NarrativeFact<string[]>;
  irreversibleEvents: NarrativeFact<string[]>;
  foreshadowing: NarrativeFact<string[]>;
  unresolvedQuestions: NarrativeFact<string[]>;
  worldConstraints: NarrativeFact<string[]>;
  timelineConstraints: NarrativeFact<string[]>;
  adaptationRisks: string[];
};

export type DramaBeatType =
  | "OPENING_HOOK"
  | "SETUP"
  | "INCITING_INCIDENT"
  | "PRESSURE"
  | "ESCALATION"
  | "REVELATION"
  | "REVERSAL"
  | "CHOICE"
  | "PAYOFF"
  | "CONSEQUENCE"
  | "CLIFFHANGER"
  | "ENDING";

export type PayoffType =
  | "IDENTITY_REVEAL"
  | "PUBLIC_REVERSAL"
  | "REVENGE"
  | "POWER_UP"
  | "RESCUE"
  | "ROMANTIC_PROGRESS"
  | "TRUTH_REVEAL"
  | "ASSET_RECOVERY"
  | "ENEMY_DEFEAT"
  | "STATUS_ASCENSION"
  | "MORAL_VICTORY"
  | "STRATEGIC_VICTORY";

export type HookType =
  | "VISUAL_HOOK"
  | "CONFLICT_HOOK"
  | "QUESTION_HOOK"
  | "IDENTITY_HOOK"
  | "DANGER_HOOK"
  | "EMOTIONAL_HOOK";

export type CliffhangerType =
  | "UNANSWERED_REVELATION"
  | "IMMEDIATE_DANGER"
  | "IMPOSSIBLE_CHOICE"
  | "IDENTITY_DISCOVERY"
  | "BETRAYAL"
  | "POWER_SHIFT"
  | "RELATIONSHIP_BREAK"
  | "WORLD_RULE_DISCOVERY";

export type DramaPayoff = {
  type: PayoffType;
  setup: string;
  pressure: string;
  trigger: string;
  payoff: string;
  consequence: string;
  futureHook: string;
};

export type EmotionPoint = {
  timestampRatio: number;
  emotion: string;
  intensity: number;
  characterId: string | null;
  causeBeatId: string;
};

export type DialogueBlock = {
  characterId: string | null;
  speakerName: string;
  line: string;
  intention: string;
  sourceSupport: EvidenceSupport;
};

export type DramaProject = DomainRecord & {
  dramaOsSchemaVersion: typeof DRAMA_OS_SCHEMA_VERSION;
  dramaProjectId: string;
  storyId: string;
  sourceStoryRevision: number;
  sourceStoryBibleVersion: number;
  title: string;
  formatProfile: DramaFormatProfileId;
  seasonIds: string[];
  canonicalAdaptationRevision: number;
  status: DramaCandidateStatus;
  projectionTrace: DramaProjectionTrace;
  creationPreferenceRef?: CreationPreferenceReference;
  storyBlueprintRef?: StoryBlueprintReference;
  worldStateRefs?: WorldStateReference[];
  characterStateRefs?: CharacterStateReference[];
  narrativePlanRef?: NarrativePlanReference;
};

export type DramaSeason = DomainRecord & {
  seasonId: string;
  dramaProjectId: string;
  seasonNumber: number;
  sourceChapterIds: string[];
  episodeIds: string[];
  seasonGoal: string;
  mainConflict: string;
  characterArcs: Record<string, string>;
  openingPromise: string;
  midpointShift: string;
  finalPayoff: string;
  endingHook: string;
  status: DramaCandidateStatus;
};

export type DramaEpisode = DomainRecord & {
  episodeId: string;
  seasonId: string;
  storyId: string;
  sourceRevision: number;
  sourceChapterIds: string[];
  episodeNumber: number;
  formatProfile: DramaFormatProfileId;
  estimatedDurationSeconds: number;
  openingHook: { type: HookType; text: string; deadlineSeconds: number };
  episodeGoal: string;
  majorConflict: string;
  beatIds: string[];
  sceneIds: string[];
  emotionCurve: EmotionPoint[];
  turningPoint: string;
  payoff: DramaPayoff;
  cliffhanger: { type: CliffhangerType; text: string; sourceBeatId: string };
  sourceReferences: DramaSourceReference[];
  continuityConstraints: ContinuityConstraint[];
  status: DramaCandidateStatus;
};

export type DramaScene = DomainRecord & {
  sceneId: string;
  episodeId: string;
  sceneNumber: number;
  locationId: string | null;
  timelinePosition: string | null;
  participatingCharacterIds: string[];
  pointOfViewCharacterId: string | null;
  sceneGoal: string;
  conflict: string;
  visualAction: string;
  dialogueBlocks: DialogueBlock[];
  emotionStart: number;
  emotionEnd: number;
  storyFunction: string;
  sourceReferences: DramaSourceReference[];
  continuityConstraints: ContinuityConstraint[];
  status: DramaCandidateStatus;
};

export type DramaBeat = DomainRecord & {
  beatId: string;
  episodeId: string;
  sceneId: string | null;
  beatType: DramaBeatType;
  setup: string;
  pressure: string;
  trigger: string;
  payoff: string;
  consequence: string;
  futureHook: string;
  intensity: number;
  sourceReferences: DramaSourceReference[];
};

export type DramaBranchChoice = {
  key: "A" | "B" | "C";
  label: string;
  action: string;
  consequence: string;
  effects: {
    characterGoal?: string;
    relationshipState?: string;
    risk?: number;
    resource?: number;
    timeline?: string;
    futureScene?: string;
    endingProbability?: number;
  };
};

export type DramaBranchCandidate = DomainRecord & {
  branchCandidateId: string;
  episodeId: string;
  sourceRevision: number;
  choicePointId: string;
  choices: DramaBranchChoice[];
  predictedConsequences: string[];
  continuityRisks: string[];
  mode: DramaBranchMode;
  status: DramaCandidateStatus;
  approvalTransactionId: string | null;
};

export type DramaEvaluationIssue = {
  code: string;
  severity: "info" | "warning" | "blocking";
  message: string;
  entityId: string | null;
  sourceReferences: DramaSourceReference[];
};

export type DramaEvaluation = DomainRecord & {
  evaluationId: string;
  dramaProjectId: string;
  sourceRevision: number;
  score: number;
  hookScore: number;
  pacingScore: number;
  continuityScore: number;
  emotionScore: number;
  issues: DramaEvaluationIssue[];
  blockingIssueCount: number;
  status: "passed" | "needs_review" | "blocked";
};

export type DramaApprovalRecord = DomainRecord & {
  approvalId: string;
  dramaProjectId: string;
  idempotencyKey: string;
  payloadFingerprint: string;
  expectedDramaProjectRevision: number;
  sourceStoryRevision: number;
  sourceStoryBibleVersion: number;
  resultingAdaptationRevision: number;
  approvedEntityIds: string[];
  approvedBy: string;
  approvedAt: string;
  status: "committed";
};

export type NarrativeCanonLink = DomainRecord & {
  canonLinkId: string;
  dramaProjectId: string;
  sourceStoryRevision: number;
  sourceStoryBibleVersion: number;
  dramaAdaptationRevision: number;
  sourceChapterIds: string[];
  episodeIds: string[];
  projectionStatus: ProjectionStatus;
  staleReason: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
};

export type DramaProjectionTrace = {
  storyId: string;
  sourceRevision: number;
  sourceChapterIds: string[];
  sourceChunkIds: string[];
  storyBibleVersion: number;
  retrievalTraceId: string;
  contextCompositionId: string;
  providerRunId: string;
  providerId: PlatformProviderId;
  promptHash: string;
  outputHash: string;
  taintTraceId: string;
};

export type DramaProjectionInput = {
  requestId: string;
  storyId: string;
  storyTitle: string;
  sourceRevision: number;
  storyBibleVersion: number;
  currentStoryRevision?: number;
  currentStoryBibleVersion?: number;
  creationPreferenceRef?: CreationPreferenceReference;
  storyBlueprintRef?: StoryBlueprintReference;
  worldStateRefs?: WorldStateReference[];
  characterStateRefs?: CharacterStateReference[];
  narrativePlanRef?: NarrativePlanReference;
  currentReferenceRevisions?: Record<string, number>;
  formatProfile: DramaFormatProfileId;
  chapters: Array<{ id: string; title: string; content: string; revision: number }>;
  characters: Array<{ id: string; name: string; aliases?: string[]; goal?: string | null; lifeStatus?: "unknown" | "alive" | "dead"; locationId?: string | null }>;
  worldRules: Array<{ id: string; title: string; description: string; immutable?: boolean }>;
  timeline: Array<{ id: string; chapterId?: string | null; storyTime?: string | null; title: string; summary: string }>;
  storyBible: {
    foreshadowing: string[];
    unresolvedThreads: string[];
    forbiddenContradictions: string[];
  };
  sourceChunkIds: string[];
  retrievalTraceId: string;
  contextCompositionId: string;
  providerRunId: string;
  providerId: PlatformProviderId;
  promptHash: string;
  adultMode: boolean;
  adultConsent: boolean;
  allCharactersConfirmedAdult: boolean;
  mode?: DramaBranchMode;
  signal?: AbortSignal;
  resourceBudget?: { maxSourceChars: number; maxEpisodes: number; maxScenes: number; timeoutMs: number };
};

export type DramaProjectionPackage = {
  project: DramaProject;
  seasons: DramaSeason[];
  episodes: DramaEpisode[];
  scenes: DramaScene[];
  beats: DramaBeat[];
  branchCandidates: DramaBranchCandidate[];
  evaluations: DramaEvaluation[];
  canonLinks: NarrativeCanonLink[];
  analysis: NarrativeAnalysis;
  canonicalMutation: 0;
};

export type ApproveDramaProjectionInput = {
  projectId: string;
  dramaProjectId: string;
  idempotencyKey: string;
  expectedDramaProjectRevision: number;
  expectedSourceStoryRevision: number;
  expectedStoryBibleVersion: number;
  approvedBy: string;
  payloadFingerprint: string;
};

export type MarkDramaProjectionsStaleInput = {
  projectId: string;
  currentStoryRevision: number;
  currentStoryBibleVersion: number;
};

export type MarkDramaProjectionsStaleResult = {
  staleDramaProjectIds: string[];
  staleCanonLinkIds: string[];
};

export type ApproveDramaProjectionResult = {
  replayed: boolean;
  project: DramaProject;
  approval: DramaApprovalRecord;
  canonLink: NarrativeCanonLink;
};

export const P22_STORY_INTELLIGENCE_VERSION = "p22-story-intelligence-v1" as const;

export type StorySource = {
  sourceChapterId: string;
  sourceRevision: string;
  evidenceExcerpt: string;
  start: number;
  end: number;
};

export type IntelligenceFactType = "explicit" | "inferred" | "unknown" | "conflicted";
export type IntelligenceEntityType =
  | "work"
  | "character"
  | "relationship"
  | "world_rule"
  | "location"
  | "faction"
  | "event"
  | "plot_thread"
  | "foreshadowing"
  | "secret"
  | "conflict"
  | "promise"
  | "style";

export type StoryIntelligenceFact = {
  factId: string;
  entityType: IntelligenceEntityType;
  entityId: string;
  field: string;
  value: string | number | boolean | string[] | null;
  factType: IntelligenceFactType;
  sources: StorySource[];
  confidence: number;
  createdAt: string;
  updatedAt: string;
};

export type StoryIntelligenceCandidate = StoryIntelligenceFact & {
  candidateStatus: "validated_candidate" | "needs_review" | "rejected";
  validationReasons: string[];
};

export type ChapterInput = {
  projectId: string;
  chapterId: string;
  sourceRevision: string;
  title: string;
  content: string;
  order?: number;
};

export type ChapterIntelligence = {
  schemaVersion: typeof P22_STORY_INTELLIGENCE_VERSION;
  chapterId: string;
  sourceRevision: string;
  summary: string;
  candidates: StoryIntelligenceCandidate[];
  warnings: string[];
  createdAt: string;
};

export type StoryBibleIntelligence = {
  schemaVersion: typeof P22_STORY_INTELLIGENCE_VERSION;
  projectId: string;
  facts: StoryIntelligenceFact[];
  chapterSummaries: Array<{
    chapterId: string;
    sourceRevision: string;
    summary: string;
    sources: StorySource[];
  }>;
  forbiddenContradictions: string[];
  updatedAt: string;
};

export type MemoryKind =
  | "current_scene"
  | "recent_chapter"
  | "character"
  | "relationship"
  | "world_rule"
  | "event"
  | "plot_thread"
  | "foreshadowing"
  | "note"
  | "accepted_choice";

export type TraceableMemory = {
  memoryId: string;
  kind: MemoryKind;
  text: string;
  source: StorySource;
  metadata: {
    projectId: string;
    branchId?: string;
    entityIds?: string[];
    chapterOrder?: number;
    canonical?: boolean;
    visibility?: "private" | "project";
  };
  keywordScore?: number;
  vectorScore?: number;
  recencyScore?: number;
};

export type RankedMemory = TraceableMemory & {
  score: number;
  selectedReason: string[];
  estimatedTokens: number;
};

export type StoryContext = {
  schemaVersion: typeof P22_STORY_INTELLIGENCE_VERSION;
  task: string;
  currentScene: RankedMemory[];
  recentContext: RankedMemory[];
  characterContext: RankedMemory[];
  worldContext: RankedMemory[];
  plotContext: RankedMemory[];
  foreshadowingContext: RankedMemory[];
  constraints: string[];
  styleProfile: string[];
  tokenBudget: {
    limit: number;
    reservedOutput: number;
    used: number;
    remaining: number;
    omittedMemoryIds: string[];
  };
  sourceReferences: StorySource[];
};

export type ContinuityIssueType =
  | "dead_character_reappeared"
  | "name_mismatch"
  | "ability_limit"
  | "location_conflict"
  | "timeline_conflict"
  | "world_rule_violation"
  | "consumed_item_reappeared"
  | "viewpoint_drift"
  | "repeated_content"
  | "canonical_mutation";

export type ContinuityIssue = {
  issueId: string;
  type: ContinuityIssueType;
  severity: "info" | "warning" | "major" | "blocking";
  explanation: string;
  sources: StorySource[];
  confidence: number;
  deterministic: boolean;
};

export type ContinuityReport = {
  score: number;
  passed: boolean;
  issues: ContinuityIssue[];
  checkedRules: ContinuityIssueType[];
};

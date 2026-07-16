export const HYBRID_RETRIEVAL_MIGRATION_VERSION = "021_hybrid_retrieval";
export const HYBRID_RETRIEVAL_ENGINE_VERSION = "h2b-hybrid-retrieval-v1";

export type RetrievalSourceScope =
  | "PRIVATE_PROJECT" | "STORY_BIBLE" | "CHAPTERS" | "SCENES" | "STAGES" | "VERSIONS" | "CONSEQUENCE_CANDIDATES"
  | "USER_IMPORTED_LIBRARY" | "PUBLIC_CORPUS";

export type RetrievalDocumentType =
  | "project" | "story_bible_fact" | "character" | "relationship" | "world_rule" | "event" | "chapter" | "scene"
  | "stage" | "stage_version" | "branch" | "consequence_candidate" | "viral_plan" | "reversal_plan" | "clue" | "reveal_schedule";

export type RetrievalCanonicalStatus = "approved" | "current_branch" | "current_scene" | "approved_version" | "draft" | "candidate" | "historical" | "superseded" | "reverted" | "deleted";
export type RetrievalVisibility = "private" | "project_only" | "local_library" | "export_allowed" | "public_ready";
export type RetrievalRankProfile =
  | "exact_fact" | "continue_writing" | "consistency_check" | "character_analysis" | "relationship_analysis" | "timeline"
  | "foreshadowing" | "unresolved_threads" | "viral_reversal" | "adult_scene_continuity" | "general_search";

export type RetrievalDocumentInput = {
  documentId: string;
  projectId: string;
  sourceScope: RetrievalSourceScope;
  documentType: RetrievalDocumentType;
  title?: string;
  body: string;
  canonicalStatus?: RetrievalCanonicalStatus;
  branchId?: string;
  versionId?: string;
  chapterId?: string;
  sceneId?: string;
  stageId?: string;
  visibility?: RetrievalVisibility;
  characterIds?: string[];
  relationshipIds?: string[];
  eventIds?: string[];
  topicId?: string;
  classificationPackId?: string;
  sceneType?: string;
  stageType?: string;
  rating?: string;
  adultOnly?: boolean;
  unresolved?: boolean;
  archived?: boolean;
  reverted?: boolean;
  deleted?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type RetrievalQuery = {
  queryText: string;
  projectId: string;
  branchId?: string;
  sourceScopes?: RetrievalSourceScope[];
  topK?: number;
  rankProfile?: RetrievalRankProfile;
  canonicalOnly?: boolean;
  adultMode?: "include" | "exclude" | "only";
  includeDrafts?: boolean;
  includeCandidates?: boolean;
  includeHistorical?: boolean;
  explain?: boolean;
  filters?: {
    chapterRange?: [number, number];
    characterIds?: string[];
    relationshipIds?: string[];
    eventIds?: string[];
    classificationPackId?: string;
    topicId?: string;
    sceneType?: string;
    stageType?: string;
    rating?: string;
    adultOnly?: boolean;
    excludeAdult?: boolean;
    canonicalOnly?: boolean;
    unresolvedOnly?: boolean;
    visibility?: RetrievalVisibility[];
    versionType?: string;
    beforeChapter?: number;
    afterChapter?: number;
    sourceScope?: RetrievalSourceScope[];
  };
};

export type RetrievalScoreBreakdown = {
  keywordScore: number;
  semanticScore: number;
  metadataScore: number;
  canonicalScore: number;
  entityScore: number;
  eventScore: number;
  relationshipScore: number;
  recencyScore: number;
  continuityScore: number;
  sourcePriorityScore: number;
  branchScore: number;
  visibilityScore: number;
  diversityPenalty: number;
  duplicatePenalty: number;
  revertedPenalty: number;
  deletedPenalty: number;
  policyPenalty: number;
};

export type RetrievalResult = {
  documentId: string;
  chunkId: string;
  textExcerpt: string;
  sourceType: RetrievalDocumentType;
  sourceId: string;
  branchId: string;
  canonicalStatus: RetrievalCanonicalStatus;
  visibility: RetrievalVisibility;
  finalScore: number;
  scoreBreakdown: RetrievalScoreBreakdown;
  matchedTerms: string[];
  matchedEntities: string[];
  matchedEvents: string[];
  explanation: string[];
  warnings: string[];
};

export type RetrievalResponse = {
  results: RetrievalResult[];
  totalCandidates: number;
  filteredCount: number;
  queryEmbeddingModel: string;
  rankProfile: RetrievalRankProfile;
  branchId: string;
  sourceScopes: RetrievalSourceScope[];
  executionTime: number;
  externalRequestCount: number;
  dataLeftDevice: boolean;
};

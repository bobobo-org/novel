import type {
  ContinuityReport,
  StoryContext,
  StoryIntelligenceFact,
  StorySource,
  TraceableMemory,
} from "../story-intelligence";
import type {
  AdultFictionContext,
  PersonaProfile,
  PersonaProfileId,
  PublicReasoningSummary,
  ReturnTypeOfRigorousLanguage,
} from "../persona";
import type { TaintLabel } from "../security";
import type { LayeredEvaluatorResult } from "./layered-evaluator";
import type { GenerationReplayManifest } from "./replay-manifest";
import type { GenerationResourceBudget } from "./resource-budget";

export const P22_GENERATION_LOOP_VERSION = "p22-generation-loop-v1" as const;

export type GenerationTaskType =
  | "continue_writing"
  | "rewrite"
  | "dialogue_generation"
  | "scene_expansion"
  | "outline_generation";

export type CandidateIntent = "steady_continuation" | "conflict_escalation" | "unexpected_turn";

export type GenerationProviderRequest = {
  requestId: string;
  projectId: string;
  taskType: GenerationTaskType | "planning" | "evaluation" | "revision";
  instruction: string;
  context: StoryContext;
  draft?: string;
  intent?: CandidateIntent;
  signal?: AbortSignal;
  maxOutputTokens: number;
  structured: boolean;
};

export type GenerationProviderResponse = {
  provider: "browser-ai" | "local-ollama" | "private-ai-hub" | "local-rule";
  model: string;
  text: string;
  structuredOutput?: unknown;
  latencyMs: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  externalRequest: boolean;
  warnings: string[];
  modelDigest?: string | null;
  generationParameters?: Record<string, string | number | boolean | null>;
};

export interface ClosedGenerationProvider {
  generate(request: GenerationProviderRequest): Promise<GenerationProviderResponse>;
}

export type GenerationProgressStage =
  | "task_understanding"
  | "problem_decomposition"
  | "memory_retrieval"
  | "hypothesis_generation"
  | "counterexample_check"
  | "planning"
  | "draft_generation"
  | "continuity_evaluation"
  | "character_evaluation"
  | "plot_evaluation"
  | "style_evaluation"
  | "adversarial_critique"
  | "rigorous_language_evaluation"
  | "revision"
  | "candidate_packaging";

export type GenerationProgressEvent = {
  stage: GenerationProgressStage;
  status: "running" | "success" | "failed" | "skipped";
  candidateIntent?: CandidateIntent;
  message: string;
  at: string;
};

export type QualityDimension =
  | "continuity"
  | "character_consistency"
  | "plot_coherence"
  | "pacing"
  | "dialogue_quality"
  | "style_consistency"
  | "repetition"
  | "foreshadowing_use"
  | "reader_engagement";

export type QualityScore = {
  dimension: QualityDimension;
  score: number;
  reasons: string[];
  sources: StorySource[];
  evaluator: "deterministic" | "model";
};

export type GenerationEvaluation = {
  continuityReport: ContinuityReport;
  characterReport: QualityScore;
  plotReport: QualityScore;
  styleReport: QualityScore;
  modelScores: QualityScore[];
  disagreements: Array<{
    dimension: QualityDimension;
    deterministicScore: number;
    modelScore: number;
    resolution: "deterministic_wins" | "flag_for_review";
  }>;
  passed: boolean;
};

export type GenerationLoopInput = {
  requestId: string;
  projectId: string;
  branchId: string;
  taskType: GenerationTaskType;
  authorInstruction: string;
  currentText: string;
  currentChapterId: string;
  sourceRevision: string;
  storyRevision: number;
  memories: TraceableMemory[];
  canonicalFacts: StoryIntelligenceFact[];
  constraints?: string[];
  styleProfile?: string[];
  expectedViewpoint?: "first_person" | "third_person" | null;
  multiCandidate?: boolean;
  qualityThreshold?: number;
  signal?: AbortSignal;
  getCurrentSourceRevision?: () => string | Promise<string>;
  onProgress?: (event: GenerationProgressEvent) => void;
  personaProfile?: PersonaProfile | PersonaProfileId;
  adultFictionContext?: AdultFictionContext;
  maxCritiqueRounds?: 0 | 1;
  promptProfileVersion?: string;
  storyBibleVersion?: string;
  seed?: number | null;
  resourceBudget?: GenerationResourceBudget;
};

export type GenerationCandidate = {
  schemaVersion: typeof P22_GENERATION_LOOP_VERSION;
  candidateId: string;
  requestId: string;
  projectId: string;
  branchId: string;
  taskType: GenerationTaskType;
  intent: CandidateIntent;
  plan: string[];
  draft: string;
  retrievedMemory: StoryContext;
  evaluation: GenerationEvaluation;
  layeredEvaluation: LayeredEvaluatorResult;
  personaProfile: PersonaProfile;
  reasoningSummary: PublicReasoningSummary;
  languageEvaluation: ReturnTypeOfRigorousLanguage;
  differenceSummary: string;
  riskHints: string[];
  confidence: number;
  revisionNotes: string[];
  finalCandidate: string;
  provider: string;
  model: string;
  modelDigest: string | null;
  latency: number;
  tokenEstimate: { input: number; output: number };
  sourceRevision: string;
  storyRevision: number;
  status: "awaiting_approval" | "quality_rejected" | "cancelled";
  canonicalMutationCount: 0;
  taintSummary: {
    labels: TaintLabel[];
    quarantinedMemoryIds: string[];
    privilegedUsageBlocked: true;
  };
  replayManifest: GenerationReplayManifest;
  createdAt: string;
};

export type GenerationLoopResult = {
  schemaVersion: typeof P22_GENERATION_LOOP_VERSION;
  requestId: string;
  taskUnderstanding: {
    taskType: GenerationTaskType;
    objective: string;
    constraints: string[];
  };
  candidates: GenerationCandidate[];
  rankedCandidateIds: string[];
  recommendedCandidateId: string | null;
  selectedProvider: string;
  fallbackUsed: boolean;
  externalRequestCount: number;
  canonicalMutationCount: 0;
};

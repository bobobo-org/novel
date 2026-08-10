export type PlatformProviderId = "browser-ai" | "local-ollama" | "private-ai-hub" | "deterministic-local" | "openai" | "gemini" | "grok" | "claude";
export type PrivacyMode = "strict-local" | "private-hub-allowed" | "external-allowed";
export type ClosedAIPrivacyLevel = "device_only" | "private_infrastructure_only" | "external_allowed";
export type ClosedAIFallbackPolicy = "none" | "closed-only" | "external-with-consent";
export type BrowserComputePolicy = "browser-first" | "balanced" | "quality-first" | "manual";
export type PlatformTaskType =
  | "assistant.general" | "assistant.brainstorm" | "assistant.critique" | "assistant.transform"
  | "creation.genreSuggestions" | "creation.titleCandidates" | "creation.coreIdeaCandidates" | "creation.protagonistCandidates" | "creation.worldCandidates" | "creation.conflictCandidates" | "creation.storySeed" | "creation.guidedChoices"
  | "chapter.outline" | "chapter.continue" | "chapter.rewrite" | "chapter.expand" | "chapter.compress" | "chapter.abcChoices" | "chapter.endingCandidates"
  | "story.summary" | "story.consistencyCheck" | "story.timelineCheck" | "story.characterCheck" | "story.worldRuleCheck" | "story.foreshadowingCheck" | "story.retrieval" | "story.storyBibleCandidate"
  | "story.plotAnalysis" | "story.pacingCheck" | "story.themeAnalysis" | "story.originalityCheck" | "story.chapterReview" | "story.plotCandidate" | "story.endingPlan"
  | "knowledge.ruleExtraction" | "knowledge.ruleSynthesis" | "learning.preferenceReview"
  | "character.create" | "character.dialogue" | "character.relationshipAnalysis" | "character.arcCandidate"
  | "character.nameExtract" | "character.traitClassify" | "character.voiceClassify" | "character.emotionClassify" | "character.relationshipEventClassify" | "character.dialogueConsistency"
  | "character.actionPlan" | "character.privateArc" | "character.multiAgentSimulation" | "character.evaluate" | "character.relationshipImpact"
  | "world.create" | "world.ruleCandidate" | "world.locationCandidate" | "world.factionCandidate"
  | "game.stateEvaluation" | "game.rewardCandidate" | "game.questCandidate" | "game.achievementCandidate"
  | "drama.chapterClassify" | "drama.sceneClassify" | "drama.characterPresence" | "drama.emotionCurve" | "drama.shortSummary" | "drama.beatSuggestion"
  | "drama.episodePlan" | "drama.scenePlan" | "drama.dialogue" | "drama.branchCandidate" | "drama.ending" | "drama.continuity";

export type PlatformProviderStatus = "ready" | "contract_ready" | "runtime_not_installed" | "runtime_unavailable" | "auth_required" | "disabled" | "degraded";
export type PlatformProviderCapability = "text" | "structured" | "streaming" | "embedding" | "long-context" | "offline";
export type PlatformProviderSnapshot = { id: PlatformProviderId; status: PlatformProviderStatus; capabilities: PlatformProviderCapability[]; modelId: string | null; modelDigest?: string | null; maxContext: number; local: boolean; requiresInternet: boolean; latencyMs?: number; taskTypes?: PlatformTaskType[]; detail?: string };
export type PlatformAIRequest = {
  requestId: string;
  projectId: string;
  taskType: PlatformTaskType;
  privacyMode: PrivacyMode;
  input: string;
  context: string[];
  preferredProvider?: PlatformProviderId;
  externalConsent: boolean;
  requiresStreaming?: boolean;
  requiresStructured?: boolean;
  outputSchema?: Record<string, unknown>;
  requiredCapabilities?: PlatformProviderCapability[];
  closedOnly?: boolean;
  offlineRequired?: boolean;
  privacyLevel?: ClosedAIPrivacyLevel;
  fallbackPolicy?: ClosedAIFallbackPolicy;
  estimatedContextSize?: number;
  latencyPreference?: "low" | "balanced" | "quality";
  qualityPreference?: "fast" | "balanced" | "high";
  browserComputePolicy?: BrowserComputePolicy;
  allowPreAuthorizedClosedEscalation?: boolean;
  qualityPhase?: "draft" | "critic" | "revision";
  agentPlan?: {
    planDigest: string;
    roles: string[];
    steps: Array<{ role: string; objective: string }>;
  };
  toolResults?: Array<{ toolId: string; value: unknown }>;
  workingMaterials?: Array<{
    kind: "draft" | "critic";
    text: string;
    digest: string;
  }>;
  generationOptions?: {
    seed?: number;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    repetitionPenalty?: number;
    /** Opt in to a bounded long-form scene budget with an application-level validator. */
    substantiveScene?: boolean;
  };
  idempotencyKey?: string;
  cacheNamespace?: ClosedAINamespace;
  signal?: AbortSignal;
};
export type PlatformRouterRejection = { providerId: PlatformProviderId; reason: string };
export type PlatformRouterDecision = { providerId: PlatformProviderId; modelId: string | null; modelDigest?: string | null; privacyMode: PrivacyMode; reason: string; contextSources: string[]; externalRequest: boolean; dataLeavesDevice: boolean; fallbackChain: PlatformProviderId[]; warnings: string[]; rejectedCandidates?: PlatformRouterRejection[]; privacyValidation?: "passed" | "blocked"; capabilityValidation?: "passed" | "blocked"; noRouteReason?: string | null; auditMetadata?: { requestId: string; idempotencyKey?: string; closedOnly: boolean; offlineRequired: boolean; decidedAt: string } };
export type PlatformAIResult = {
  requestId: string;
  providerId: PlatformProviderId;
  modelId: string | null;
  modelDigest?: string | null;
  content: string;
  candidateOnly: true;
  externalRequest: boolean;
  dataLeavesDevice: boolean;
  elapsedMs: number;
  provenance: PlatformRouterDecision;
  profileId?: string;
  firstTokenMs?: number | null;
  inputCharacters?: number;
  outputCharacters?: number;
  generatedTokenEvents?: number;
  omittedInputCharacters?: number;
  runtimeStats?: string;
  tokensPerSecond?: number | null;
  estimatedMemoryMB?: number | null;
  executor?: "webllm-worker" | "chromium-prompt-api" | "browser-task-model" | string;
  queueWaitMs?: number;
  engineReused?: boolean;
  generationFinishReason?: "stop" | "length" | "tool_calls" | "abort" | null;
  completionTokens?: number | null;
  rawOutputCharacters?: number;
  normalizedOutputCharacters?: number;
  performancePolicy?: {
    policyVersion: string;
    tier: string;
    parameterLabel: string;
    maxInputCharacters: number;
    maxOutputTokens: number;
    temperature: number;
    topP: number;
    repetitionPenalty: number;
    serialGeneration: true;
    workerExecution: true;
    reason: string[];
    mode?: "ECO" | "BALANCED" | "QUALITY";
    estimatedInputTokens?: number;
    inputBudgetTokens?: number;
    reservedOutputTokens?: number;
    modelContextWindow?: number;
    safetyMarginTokens?: number;
    retrievalBudgetTokens?: number;
    canonBudgetTokens?: number;
    recentChapterBudgetTokens?: number;
    characterBudgetTokens?: number;
    worldBudgetTokens?: number;
  };
  browserCompute?: {
    policy: BrowserComputePolicy;
    tier: "T0" | "T1" | "T2" | "T3";
    plannedPipeline: string[];
    actualExecutor: string;
    qualityDecision: "pass" | "revise" | "escalate" | "block";
    qualityScore: number;
    contextTokensBefore: number;
    contextTokensAfter: number;
    tokensSaved: number;
    receiptId: string;
    inferenceProof: "verified" | "not_required";
    canonicalMutationCount: 0;
  };
};
import type { ClosedAINamespace } from "../closed-ai-cache";

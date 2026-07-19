export type PlatformProviderId = "browser-ai" | "local-ollama" | "private-ai-hub" | "deterministic-local" | "openai" | "gemini" | "grok";
export type PrivacyMode = "strict-local" | "private-hub-allowed" | "external-allowed";
export type ClosedAIPrivacyLevel = "device_only" | "private_infrastructure_only" | "external_allowed";
export type ClosedAIFallbackPolicy = "none" | "closed-only" | "external-with-consent";
export type PlatformTaskType =
  | "creation.genreSuggestions" | "creation.titleCandidates" | "creation.coreIdeaCandidates" | "creation.protagonistCandidates" | "creation.worldCandidates" | "creation.conflictCandidates" | "creation.storySeed" | "creation.guidedChoices"
  | "chapter.outline" | "chapter.continue" | "chapter.rewrite" | "chapter.expand" | "chapter.compress" | "chapter.abcChoices" | "chapter.endingCandidates"
  | "story.summary" | "story.consistencyCheck" | "story.timelineCheck" | "story.characterCheck" | "story.worldRuleCheck" | "story.foreshadowingCheck" | "story.retrieval" | "story.storyBibleCandidate"
  | "character.create" | "character.dialogue" | "character.relationshipAnalysis" | "character.arcCandidate"
  | "world.create" | "world.ruleCandidate" | "world.locationCandidate" | "world.factionCandidate"
  | "game.stateEvaluation" | "game.rewardCandidate" | "game.questCandidate" | "game.achievementCandidate";

export type PlatformProviderStatus = "ready" | "contract_ready" | "runtime_not_installed" | "runtime_unavailable" | "auth_required" | "disabled" | "degraded";
export type PlatformProviderCapability = "text" | "structured" | "streaming" | "embedding" | "long-context" | "offline";
export type PlatformProviderSnapshot = { id: PlatformProviderId; status: PlatformProviderStatus; capabilities: PlatformProviderCapability[]; modelId: string | null; maxContext: number; local: boolean; requiresInternet: boolean; latencyMs?: number };
export type PlatformAIRequest = { requestId: string; projectId: string; taskType: PlatformTaskType; privacyMode: PrivacyMode; input: string; context: string[]; preferredProvider?: PlatformProviderId; externalConsent: boolean; requiresStreaming?: boolean; requiresStructured?: boolean; requiredCapabilities?: PlatformProviderCapability[]; closedOnly?: boolean; offlineRequired?: boolean; privacyLevel?: ClosedAIPrivacyLevel; fallbackPolicy?: ClosedAIFallbackPolicy; estimatedContextSize?: number; latencyPreference?: "low" | "balanced" | "quality"; qualityPreference?: "fast" | "balanced" | "high"; idempotencyKey?: string; signal?: AbortSignal };
export type PlatformRouterRejection = { providerId: PlatformProviderId; reason: string };
export type PlatformRouterDecision = { providerId: PlatformProviderId; modelId: string | null; privacyMode: PrivacyMode; reason: string; contextSources: string[]; externalRequest: boolean; dataLeavesDevice: boolean; fallbackChain: PlatformProviderId[]; warnings: string[]; rejectedCandidates?: PlatformRouterRejection[]; privacyValidation?: "passed" | "blocked"; capabilityValidation?: "passed" | "blocked"; noRouteReason?: string | null; auditMetadata?: { requestId: string; idempotencyKey?: string; closedOnly: boolean; offlineRequired: boolean; decidedAt: string } };
export type PlatformAIResult = { requestId: string; providerId: PlatformProviderId; modelId: string | null; content: string; candidateOnly: true; externalRequest: boolean; dataLeavesDevice: boolean; elapsedMs: number; provenance: PlatformRouterDecision };

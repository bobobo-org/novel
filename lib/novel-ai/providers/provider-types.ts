export type AiProviderId = "local-rule" | "ollama-local" | "google-gemini" | "openai" | "grok";

export type AiTaskType =
  | "task_classification"
  | "simple_summary"
  | "keyword_extraction"
  | "chapter_metadata"
  | "deterministic_validation"
  | "candidate_post_validation"
  | "story_bible_extraction"
  | "character_analysis"
  | "event_analysis"
  | "conflict_detection"
  | "consistency_check"
  | "foreshadow_tracking"
  | "open_thread_tracking"
  | "continue_writing"
  | "rewrite"
  | "dialogue_generation"
  | "scene_expansion"
  | "outline_generation"
  | "plot_brainstorm"
  | "long_context_analysis"
  | "multi_chapter_consistency"
  | "character_arc_analysis"
  | "timeline_reconstruction"
  | "whole_book_review";

export type AiPrivacyMode = "local_only" | "local_first" | "external_allowed" | "external_preferred";
export type AiStorageMode = "SQLITE_LOCAL" | "SUPABASE_CLOUD" | "INDEXEDDB_BROWSER" | "MEMORY_TEST";
export type AiProviderHealthStatus = "ready" | "configured" | "unavailable" | "model_not_installed" | "partial" | "not_implemented";

export type AiProviderRequest = {
  requestId: string;
  projectId: string;
  taskType: AiTaskType;
  input: string;
  recentContext?: string;
  storyBibleContext?: unknown;
  constraints?: Record<string, unknown>;
  outputSchema?: unknown;
  language?: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  temperature?: number;
  privacyMode?: AiPrivacyMode;
  providerPreference?: AiProviderId[];
  allowExternalProvider?: boolean;
  abortSignal?: AbortSignal;
};

export type AiTaskCapability =
  | "text"
  | "structured_json"
  | "streaming"
  | "local_only"
  | "story_bible"
  | "generative_writing"
  | "consistency_check";

export type AiTaskPolicy = {
  taskType: AiTaskType;
  requiredCapabilities: AiTaskCapability[];
  preferredProviderOrder: AiProviderId[];
  externalProviderAllowed: boolean;
  localOnlySupported: boolean;
  structuredOutputRequired: boolean;
  maxRecommendedContext: number;
  timeoutClass: "short" | "medium" | "long";
  retryPolicy: "none" | "once" | "bounded";
  fallbackPolicy: "none" | "local-rule" | "local-first" | "external-with-consent";
};

import type { AiProviderId, AiTaskCapability, AiTaskPolicy, AiTaskType } from "./provider-types";

export type AiProviderCapabilities = {
  provider: AiProviderId;
  status: "ready" | "configured" | "unavailable" | "model_not_installed" | "not_implemented";
  models: string[];
  capabilities: AiTaskCapability[];
  maxContextTokens: number;
  supportsAbort: boolean;
  supportsStreaming: boolean;
  dataLeavesDevice: boolean;
};

const lowRisk: AiTaskType[] = ["task_classification", "simple_summary", "keyword_extraction", "chapter_metadata", "deterministic_validation", "candidate_post_validation"];
const structured: AiTaskType[] = ["story_bible_extraction", "character_analysis", "event_analysis", "conflict_detection", "consistency_check", "foreshadow_tracking", "open_thread_tracking"];
const generative: AiTaskType[] = ["continue_writing", "rewrite", "dialogue_generation", "scene_expansion", "outline_generation", "plot_brainstorm"];
const heavy: AiTaskType[] = ["long_context_analysis", "multi_chapter_consistency", "character_arc_analysis", "timeline_reconstruction", "whole_book_review"];

export const TASK_POLICIES: Record<AiTaskType, AiTaskPolicy> = Object.fromEntries([
  ...lowRisk.map((taskType) => [taskType, {
    taskType,
    requiredCapabilities: ["text"],
    preferredProviderOrder: ["local-rule", "ollama-local", "google-gemini"],
    externalProviderAllowed: false,
    localOnlySupported: true,
    structuredOutputRequired: taskType !== "simple_summary",
    maxRecommendedContext: 4000,
    timeoutClass: "short",
    retryPolicy: "none",
    fallbackPolicy: "local-rule",
  } satisfies AiTaskPolicy]),
  ...structured.map((taskType) => [taskType, {
    taskType,
    requiredCapabilities: ["text", "structured_json"],
    preferredProviderOrder: ["ollama-local", "local-rule", "google-gemini"],
    externalProviderAllowed: taskType !== "candidate_post_validation",
    localOnlySupported: true,
    structuredOutputRequired: true,
    maxRecommendedContext: 12000,
    timeoutClass: "medium",
    retryPolicy: "once",
    fallbackPolicy: "local-first",
  } satisfies AiTaskPolicy]),
  ...generative.map((taskType) => [taskType, {
    taskType,
    requiredCapabilities: ["text", "generative_writing"],
    preferredProviderOrder: ["ollama-local", "google-gemini", "local-rule"],
    externalProviderAllowed: true,
    localOnlySupported: taskType !== "dialogue_generation",
    structuredOutputRequired: false,
    maxRecommendedContext: 16000,
    timeoutClass: "long",
    retryPolicy: "bounded",
    fallbackPolicy: "external-with-consent",
  } satisfies AiTaskPolicy]),
  ...heavy.map((taskType) => [taskType, {
    taskType,
    requiredCapabilities: ["text", "structured_json", "consistency_check"],
    preferredProviderOrder: ["ollama-local", "google-gemini"],
    externalProviderAllowed: true,
    localOnlySupported: false,
    structuredOutputRequired: true,
    maxRecommendedContext: 32000,
    timeoutClass: "long",
    retryPolicy: "bounded",
    fallbackPolicy: "external-with-consent",
  } satisfies AiTaskPolicy]),
]) as Record<AiTaskType, AiTaskPolicy>;

export function providerSupports(capabilities: AiProviderCapabilities, required: AiTaskCapability[]) {
  return required.every((item) => capabilities.capabilities.includes(item));
}

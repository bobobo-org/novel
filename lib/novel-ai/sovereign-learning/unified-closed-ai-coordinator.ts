import type { ControlledTeacherProvider } from "./web-knowledge-contract";

export const UNIFIED_CLOSED_AI_COORDINATOR_VERSION =
  "unified-closed-ai-coordinator-v1" as const;

export const UNIFIED_CLOSED_AI_ROLES = [
  {
    id: "causal_teacher",
    label: "故事因果教師",
    responsibility: "分類故事機制、補齊因果鏈，並產生不可還原的抽象規則。",
  },
  {
    id: "knowledge_layer",
    label: "共享知識層",
    responsibility: "去重、索引、快取並以固定上限 Top-K 取回最相關規則。",
  },
  {
    id: "story_executor",
    label: "故事執行層",
    responsibility: "把相關規則轉成續寫、三選一、狀態結算與待核准正文。",
  },
] as const;

export const UNIFIED_CLOSED_AI_COMPUTE_SOURCES = [
  {
    id: "browser-ai",
    label: "裝置內瀏覽器算力",
    boundary: "device",
    maximumComplexity: "light",
  },
  {
    id: "local-ollama",
    label: "個人本機算力",
    boundary: "device",
    maximumComplexity: "standard",
  },
  {
    id: "private-ai-hub",
    label: "私有中樞算力",
    boundary: "private_infrastructure",
    maximumComplexity: "heavy",
  },
] as const;

export const UNIFIED_CLOSED_AI_GOVERNANCE = [
  "namespaced_cache",
  "approval_before_canon",
  "shared_abstract_learning",
  "provenance_receipts",
  "versioned_rollback",
] as const;

export type UnifiedClosedAITask =
  | "public_story_research"
  | "private_story_learning"
  | "story_generation"
  | "three_choices"
  | "canonical_approval"
  | "governance";

type CoordinateUnifiedClosedAIInput = {
  task: UnifiedClosedAITask;
  verifiedExternalProviderIds?: readonly ControlledTeacherProvider[];
};

const PUBLIC_RESEARCH_PROVIDERS = new Set<ControlledTeacherProvider>([
  "openai",
  "gemini",
  "grok",
]);

export function coordinateUnifiedClosedAI({
  task,
  verifiedExternalProviderIds = [],
}: CoordinateUnifiedClosedAIInput) {
  const publicResearch = task === "public_story_research";
  const externalProviderIds = publicResearch
    ? [...new Set(verifiedExternalProviderIds)]
      .filter((provider): provider is ControlledTeacherProvider =>
        PUBLIC_RESEARCH_PROVIDERS.has(provider))
    : [];

  return {
    coordinatorId: "unified_closed_ai",
    coordinatorVersion: UNIFIED_CLOSED_AI_COORDINATOR_VERSION,
    automatic: true as const,
    userSelectionRequired: false as const,
    roles: UNIFIED_CLOSED_AI_ROLES,
    computeSources: UNIFIED_CLOSED_AI_COMPUTE_SOURCES,
    governance: UNIFIED_CLOSED_AI_GOVERNANCE,
    task,
    externalProviderIds,
    externalAnalysisEnabled: externalProviderIds.length > 0,
    externalAnalysisScope: publicResearch ? "public_source_only" as const : "disabled" as const,
    privateContentStaysClosed: !publicResearch,
    executionRouter: "closed_agent_os_runtime_coordinator" as const,
  };
}

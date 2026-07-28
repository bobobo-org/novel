export const CLOSED_AI_TASK_CATALOG_VERSION = "closed-ai-task-catalog-v1";
export const CLOSED_AI_TASKS = ["summarize", "classify", "extract_story_facts", "rewrite", "proofread", "generate_names", "generate_choices", "continue_scene", "generate_chapter", "plan_story", "analyze_character", "check_continuity", "retrieve_context", "embed_text", "rank_context", "full_novel_analysis", "evaluate_output", "revise_output"] as const;
export type ClosedAITaskType = typeof CLOSED_AI_TASKS[number];
export type ClosedAITaskDefinition = { schemaVersion: typeof CLOSED_AI_TASK_CATALOG_VERSION; taskType: ClosedAITaskType; requiredCapabilities: Array<"text" | "structured" | "streaming" | "embedding" | "long-context" | "offline">; browserEligible: boolean; ollamaEligible: boolean; privateHubEligible: boolean; externalEligible: boolean; fallback: "none" | "closed-only" | "external-with-consent" };

const structured = new Set<ClosedAITaskType>(["extract_story_facts", "analyze_character", "check_continuity", "evaluate_output"]);
const embedding = new Set<ClosedAITaskType>(["embed_text", "rank_context"]);
const heavy = new Set<ClosedAITaskType>(["generate_chapter", "full_novel_analysis", "revise_output"]);

export const CLOSED_AI_TASK_CATALOG: Record<ClosedAITaskType, ClosedAITaskDefinition> = Object.fromEntries(CLOSED_AI_TASKS.map((taskType) => [taskType, { schemaVersion: CLOSED_AI_TASK_CATALOG_VERSION, taskType, requiredCapabilities: embedding.has(taskType) ? ["embedding"] : heavy.has(taskType) ? ["text", "long-context"] : structured.has(taskType) ? ["text", "structured"] : ["text"], browserEligible: !heavy.has(taskType), ollamaEligible: true, privateHubEligible: true, externalEligible: false, fallback: "closed-only" }])) as Record<ClosedAITaskType, ClosedAITaskDefinition>;

export function validateClosedAITaskDefinition(value: ClosedAITaskDefinition) {
  if (value.schemaVersion !== CLOSED_AI_TASK_CATALOG_VERSION) return { valid: false, errorCode: "CLOSED_TASK_SCHEMA_UNSUPPORTED" };
  if (!CLOSED_AI_TASKS.includes(value.taskType)) return { valid: false, errorCode: "CLOSED_TASK_TYPE_UNSUPPORTED" };
  if (!value.requiredCapabilities.length) return { valid: false, errorCode: "CLOSED_TASK_CAPABILITY_REQUIRED" };
  return { valid: true, errorCode: null };
}

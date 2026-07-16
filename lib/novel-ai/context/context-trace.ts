export type ContextTraceEvent =
  | "retrieval_started"
  | "retrieval_completed"
  | "filtering"
  | "deduplicating"
  | "compressing"
  | "budgeting"
  | "context_ready"
  | "generation_started"
  | "token"
  | "validation"
  | "citation_ready"
  | "completed"
  | "cancelled"
  | "failed";

export function contextTrace(event: ContextTraceEvent, details: Record<string, unknown> = {}) {
  return { event, details, at: new Date().toISOString() };
}

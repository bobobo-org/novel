import type { ContextItem } from "./context-composer-types";

export const CONTEXT_PRIORITY_ORDER = [
  "HARD_CONSTRAINTS",
  "CANONICAL_FACTS",
  "PROJECT_POLICY",
  "CURRENT_BRANCH",
  "CURRENT_SCENE",
  "CURRENT_STAGE",
  "CURRENT_RELATIONSHIP_STATE",
  "CURRENT_CHARACTER_STATES",
  "RELEVANT_EVENTS",
  "WORLD_RULES",
  "UNRESOLVED_THREADS",
  "RETRIEVED_EVIDENCE",
  "STYLE_EXAMPLES",
  "USER_IMPORTED_LIBRARY",
  "PUBLIC_CORPUS",
] as const;

export function priorityForContext(item: Pick<ContextItem, "sourceScope" | "sourceType" | "canonicalStatus">) {
  if (item.sourceType === "hard_constraint") return 1;
  if (item.canonicalStatus === "approved" || item.sourceScope === "STORY_BIBLE") return 2;
  if (item.sourceScope === "CURRENT_BRANCH") return 4;
  if (item.sourceScope === "CURRENT_SCENE" || item.sourceScope === "SCENES") return 5;
  if (item.sourceScope === "CURRENT_STAGE" || item.sourceScope === "STAGES") return 6;
  if (item.sourceType === "relationship") return 7;
  if (item.sourceType === "character") return 8;
  if (item.sourceType === "event") return 9;
  if (item.sourceType === "world_rule") return 10;
  if (item.sourceType === "open_thread" || item.sourceType === "foreshadow") return 11;
  if (item.sourceScope === "USER_IMPORTED_LIBRARY") return 14;
  if (item.sourceScope === "PUBLIC_CORPUS") return 15;
  return 12;
}

export function sortContextItems<T extends ContextItem>(items: T[]) {
  return [...items].sort((a, b) => a.priority - b.priority || b.retrievalScore - a.retrievalScore || a.contextItemId.localeCompare(b.contextItemId));
}

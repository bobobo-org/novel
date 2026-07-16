import type { ContextItem } from "./context-composer-types";

export function filterContextByBranch<T extends ContextItem>(items: T[], branchId = "main") {
  return items.filter((item) => item.branchId === branchId || item.branchId === "main" || item.sourceScope === "STORY_BIBLE");
}

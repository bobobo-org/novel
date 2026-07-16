import type { ContextItem } from "./context-composer-types";

export function filterContextByVisibility<T extends ContextItem>(items: T[]) {
  return items.filter((item) => item.visibility !== "blocked" && item.visibility !== "public" && item.visibility !== "public_reference");
}

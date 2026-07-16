import type { ContextItem, ContextSourceScope } from "./context-composer-types";

export function filterContextByScope<T extends ContextItem>(items: T[], scopes?: ContextSourceScope[]) {
  if (!scopes?.length) return items;
  const allowed = new Set(scopes);
  return items.filter((item) => allowed.has(item.sourceScope));
}

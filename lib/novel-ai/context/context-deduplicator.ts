import type { ContextItem } from "./context-composer-types";

export function deduplicateContextItems<T extends ContextItem>(items: T[]) {
  const seen = new Set<string>();
  const deduped: T[] = [];
  const omitted: Array<{ contextItemId: string; reason: string; tokenCount: number }> = [];
  for (const item of items) {
    const key = `${item.sourceScope}:${item.sourceId}:${item.chunkId ?? ""}:${item.text.slice(0, 80)}`;
    if (seen.has(key)) {
      omitted.push({ contextItemId: item.contextItemId, reason: "duplicate_context", tokenCount: item.tokenCount });
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return { deduped, omitted };
}

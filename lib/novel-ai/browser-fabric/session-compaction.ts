import type { BrowserFabricContextItem } from "./types";

export function compactBrowserSession(input: {
  contextWindow: number;
  usedTokens: number;
  items: BrowserFabricContextItem[];
}) {
  const threshold = Math.floor(input.contextWindow * 0.8);
  if (input.usedTokens < threshold) {
    return { compacted: false, threshold, retained: input.items, evictedIds: [] as string[] };
  }
  const authorities = input.items.filter((item) => item.kind === "canon" || item.kind === "story-state");
  const flexible = input.items
    .filter((item) => !authorities.includes(item))
    .sort((left, right) =>
      (right.authorityWeight ?? 0) - (left.authorityWeight ?? 0)
      || (right.revision ?? 0) - (left.revision ?? 0));
  const retained = [...authorities];
  let estimated = authorities.reduce((sum, item) => sum + Math.ceil(item.text.length / 2.5), 0);
  for (const item of flexible) {
    const tokens = Math.ceil(item.text.length / 2.5);
    if (estimated + tokens > Math.floor(input.contextWindow * 0.65)) continue;
    retained.push(item);
    estimated += tokens;
  }
  const retainedIds = new Set(retained.map((item) => item.id));
  return {
    compacted: true,
    threshold,
    retained,
    evictedIds: input.items.filter((item) => !retainedIds.has(item.id)).map((item) => item.id),
  };
}

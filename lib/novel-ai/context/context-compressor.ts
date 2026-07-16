import crypto from "crypto";
import type { ContextItem } from "./context-composer-types";
import { estimateContextTokens } from "./context-token-budget";

export function compressContextItem(item: ContextItem, targetTokens = 220) {
  if (item.tokenCount <= targetTokens) return { item, compression: null as null | Record<string, unknown> };
  const maxChars = targetTokens * 3;
  const shortened = item.text.slice(0, maxChars).replace(/\s+\S*$/, "").trim();
  const compressed: ContextItem = { ...item, text: shortened, tokenCount: estimateContextTokens(shortened), selectedReason: `${item.selectedReason}; compressed` };
  return {
    item: compressed,
    compression: {
      sourceItemIds: [item.contextItemId],
      originalTokenCount: item.tokenCount,
      compressedTokenCount: compressed.tokenCount,
      compressionMethod: "extractive_head",
      preservedFacts: [shortened.slice(0, 120)],
      omittedFacts: item.text.length > shortened.length ? ["tail_omitted"] : [],
      warnings: [],
      contentHash: crypto.createHash("sha256").update(shortened).digest("hex"),
    },
  };
}

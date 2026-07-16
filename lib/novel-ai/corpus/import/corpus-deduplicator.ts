import crypto from "crypto";
import type { CorpusDedupResult } from "./corpus-import-types";

export function deduplicateCorpusText(normalizedTextHash: string, existingHashes: string[] = []): CorpusDedupResult {
  if (existingHashes.includes(normalizedTextHash)) {
    return {
      duplicateStatus: "duplicate",
      duplicateGroupId: `dedup_${normalizedTextHash.slice(0, 16)}`,
      relationshipType: "same_edition_duplicate",
      confidence: 1,
      reviewRequired: true,
    };
  }
  return {
    duplicateStatus: "unique",
    duplicateGroupId: `dedup_${crypto.createHash("sha1").update(normalizedTextHash).digest("hex").slice(0, 16)}`,
    confidence: 0.92,
    reviewRequired: false,
  };
}

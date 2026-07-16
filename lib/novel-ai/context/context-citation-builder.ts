import crypto from "crypto";
import type { ContextItem } from "./context-composer-types";

export function buildContextCitations(jobId: string, items: ContextItem[]) {
  return items.map((item, index) => ({
    citationId: `citation_${jobId}_${index + 1}`,
    contextItemId: item.contextItemId,
    citationLabel: item.citationLabel || `[C${index + 1}]`,
    sourceScope: item.sourceScope,
    sourceId: item.sourceId,
    evidenceHash: crypto.createHash("sha256").update(item.text).digest("hex"),
  }));
}

export function citationCoverage(claimCount: number, citedClaimCount: number) {
  if (claimCount <= 0) return 1;
  return Number((citedClaimCount / claimCount).toFixed(4));
}

import type { ContextItem } from "./context-composer-types";

export function detectContextConflicts(jobId: string, items: ContextItem[]) {
  const bySource = new Map<string, ContextItem[]>();
  for (const item of items) {
    const key = `${item.sourceType}:${item.sourceId}`;
    bySource.set(key, [...(bySource.get(key) ?? []), item]);
  }
  const conflicts: Array<{ conflictId: string; severity: string; unresolved: boolean; selectedItem?: string; selectionReason: string; competingItems: string[]; suggestedReview: string }> = [];
  let i = 0;
  for (const [, group] of bySource) {
    const statuses = new Set(group.map((item) => item.canonicalStatus));
    if (statuses.has("candidate") && statuses.has("approved")) {
      const selected = group.find((item) => item.canonicalStatus === "approved") ?? group[0];
      conflicts.push({
        conflictId: `context_conflict_${jobId}_${++i}`,
        severity: "warning",
        unresolved: true,
        selectedItem: selected.contextItemId,
        selectionReason: "approved canonical outranks candidate",
        competingItems: group.map((item) => item.contextItemId),
        suggestedReview: "Review candidate before using as canonical context.",
      });
    }
  }
  return conflicts;
}

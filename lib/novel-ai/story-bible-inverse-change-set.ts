import crypto from "crypto";
import type { NormalizedChangeSet } from "./story-bible-change-sets";

export type InverseChange = {
  changeId: string;
  originalChangeId: string;
  entityType: string;
  entityId: string;
  entityDisplayName: string;
  fieldPath: string;
  operation: "restored" | "removed" | "appended" | "deactivated";
  previousValue: unknown;
  newValue: unknown;
  candidateId: string | null;
  mutationRequestId: string | null;
  sourceRefs: Record<string, unknown>[];
  reason: string;
  humanEdited: boolean;
  sourceMode: "author-declared";
};

function hash(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex").slice(0, 20);
}

export function invertChange(change: NormalizedChangeSet): InverseChange {
  const base = {
    changeId: `inverse_${hash({ changeId: change.changeId, version: change.versionNumber })}`,
    originalChangeId: change.changeId,
    entityType: change.entityType,
    entityId: change.entityId,
    entityDisplayName: change.entityDisplayName,
    fieldPath: change.fieldPath,
    candidateId: change.candidateId,
    mutationRequestId: change.mutationRequestId,
    sourceRefs: change.sourceRefs,
    reason: `Revert change ${change.changeId} from version ${change.versionNumber}`,
    humanEdited: false,
    sourceMode: "author-declared" as const,
  };
  if (change.operation === "created") {
    return { ...base, operation: "deactivated", previousValue: change.newValue, newValue: { active: false, status: "reverted" } };
  }
  if (change.operation === "appended") {
    return { ...base, operation: "removed", previousValue: change.newValue, newValue: change.newValue };
  }
  if (change.operation === "removed" || change.operation === "deleted") {
    return { ...base, operation: "appended", previousValue: change.previousValue, newValue: change.previousValue };
  }
  return { ...base, operation: "restored", previousValue: change.newValue, newValue: change.previousValue };
}

export function buildInverseChangeSet(changes: NormalizedChangeSet[]) {
  return changes.map(invertChange);
}

export function requiredAtomicChangeIds(changes: NormalizedChangeSet[], selectedChangeIds: string[]) {
  const selected = new Set(selectedChangeIds);
  const required = new Set<string>();
  const relatedGroups = [
    ["status", "payoffChapterId"],
    ["status", "resolvedChapterId"],
    ["currentOwnerCharacterId", "history"],
    ["lifeStatus", "deathEventId"],
  ];
  for (const group of relatedGroups) {
    const hits = changes.filter((change) => group.some((field) => change.fieldPath.endsWith(field)));
    const selectedHits = hits.filter((change) => selected.has(change.changeId));
    if (selectedHits.length > 0 && selectedHits.length < hits.length) {
      hits.forEach((change) => required.add(change.changeId));
    }
  }
  return [...required].filter((id) => !selected.has(id));
}

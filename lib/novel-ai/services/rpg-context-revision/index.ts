import { sha256Hex, stableStringify } from "../../closed-ai-cache";
import type {
  DomainRecord,
  RpgContextRevisionEntry,
  RpgContextRevisionGuard,
  RpgContextRevisionVector,
} from "../../domain";
import { RepositoryOperationError } from "../../repository/contracts";

export const RPG_CONTEXT_REVISION_STORE_NAMES = [
  "projects",
  "chapters",
  "storyStates",
  "storyBibles",
  "characters",
  "relationships",
  "worlds",
  "worldRules",
  "lore",
  "timeline",
  "acceptedChoices",
  "rpgTurnReceipts",
] as const;

export type RpgContextRevisionStoreName = (typeof RPG_CONTEXT_REVISION_STORE_NAMES)[number];

export type RpgContextRevisionRecords = {
  [Store in RpgContextRevisionStoreName]: readonly DomainRecord[];
};

function revisionEntry(record: DomainRecord): RpgContextRevisionEntry {
  return {
    id: record.id,
    revision: record.revision,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt ?? null,
  };
}

function normalizedEntries(records: readonly DomainRecord[]) {
  return [...records]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(revisionEntry);
}

export function buildRpgContextRevisionVector(
  records: RpgContextRevisionRecords,
): RpgContextRevisionVector {
  return Object.fromEntries(RPG_CONTEXT_REVISION_STORE_NAMES.map((store) => (
    [store, normalizedEntries(records[store])]
  ))) as RpgContextRevisionVector;
}

export async function buildRpgContextRevisionGuard(
  records: RpgContextRevisionRecords,
): Promise<RpgContextRevisionGuard> {
  const vector = buildRpgContextRevisionVector(records);
  return {
    schemaVersion: "rpg-context-revision-guard-v1",
    digest: await sha256Hex(stableStringify(vector)),
    vector,
  };
}

export async function assertRpgContextRevisionGuardIntegrity(
  guard: RpgContextRevisionGuard,
) {
  if (
    guard.schemaVersion !== "rpg-context-revision-guard-v1"
    || guard.digest !== await sha256Hex(stableStringify(guard.vector))
  ) {
    throw new RepositoryOperationError("RPG_CONTEXT_REVISION_GUARD_INVALID");
  }
}

export function assertRpgContextRevisionGuard(
  expected: RpgContextRevisionGuard,
  currentRecords: RpgContextRevisionRecords,
) {
  if (
    expected.schemaVersion !== "rpg-context-revision-guard-v1"
    || !expected.digest
    || stableStringify(expected.vector)
      !== stableStringify(buildRpgContextRevisionVector(currentRecords))
  ) {
    throw new RepositoryOperationError(
      "RPG_CONTEXT_REVISION_CONFLICT",
      "角色、關係、世界、規則、記憶或故事進度已改變，請重新建立本回合選項。",
    );
  }
}

export function sameRpgContextRevisionGuard(
  left: RpgContextRevisionGuard | undefined,
  right: RpgContextRevisionGuard | undefined,
) {
  return left === undefined && right === undefined
    ? true
    : Boolean(left && right && stableStringify(left) === stableStringify(right));
}

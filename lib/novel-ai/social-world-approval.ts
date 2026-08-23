import { sha256Hex, stableStringify } from "./closed-ai-cache";
import type {
  DomainRecord,
  NovelProject,
  StoryBible,
} from "./domain";
import { makeRecord } from "./domain";
import type { NovelRepository } from "./repository";

export const SOCIAL_WORLD_APPROVAL_VERSION = "social-world-approval-v1" as const;

export type SocialWorldApprovalKind = "character" | "treasure" | "world";

export type SocialWorldApprovalJournal = DomainRecord & {
  operationId: string;
  idempotencyKey: string;
  operationType: typeof SOCIAL_WORLD_APPROVAL_VERSION;
  approvalKind: SocialWorldApprovalKind;
  sourceId: string;
  proceduralRootSeed: string;
  payloadFingerprint: string;
  completedStages: string[];
  resultingRecordIds: string[];
  status: "in_progress" | "completed";
  completedAt: string | null;
};

/**
 * The project id is immutable and already survives project renames, genre edits,
 * backup/restore and play-mode changes. New projects persist this value, while
 * an older project can derive exactly the same value until its first write-back.
 */
export function defaultProjectProceduralRootSeed(projectId: string) {
  return `novel-project:${projectId}:procedural-v1`;
}

export function resolveProjectProceduralRootSeed(
  project: Pick<NovelProject, "id" | "proceduralRootSeed">,
) {
  return project.proceduralRootSeed?.trim()
    || defaultProjectProceduralRootSeed(project.id);
}

/** Persist the immutable root once. Concurrent first-use tabs converge safely. */
export async function ensureProjectProceduralRootSeed(
  repository: NovelRepository,
  project: NovelProject,
) {
  const fallback = resolveProjectProceduralRootSeed(project);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await repository.get<NovelProject>("projects", project.id);
    if (!current) throw new Error("SOCIAL_WORLD_PROJECT_NOT_FOUND");
    const persisted = current.proceduralRootSeed?.trim();
    if (persisted) return persisted;
    try {
      const next = await repository.put<NovelProject>("projects", {
        ...current,
        proceduralRootSeed: fallback,
      }, current.revision);
      return resolveProjectProceduralRootSeed(next);
    } catch (cause) {
      lastError = cause;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("SOCIAL_WORLD_ROOT_SEED_PERSIST_FAILED");
}

function approvalIdentity(input: {
  projectId: string;
  approvalKind: SocialWorldApprovalKind;
  sourceId: string;
  proceduralRootSeed: string;
}) {
  return {
    version: SOCIAL_WORLD_APPROVAL_VERSION,
    projectId: input.projectId,
    approvalKind: input.approvalKind,
    sourceId: input.sourceId,
    proceduralRootSeed: input.proceduralRootSeed,
  };
}

function assertSameApproval(
  journal: SocialWorldApprovalJournal,
  input: {
    projectId: string;
    approvalKind: SocialWorldApprovalKind;
    sourceId: string;
    proceduralRootSeed: string;
    payloadFingerprint: string;
  },
) {
  if (
    journal.operationType !== SOCIAL_WORLD_APPROVAL_VERSION
    || journal.projectId !== input.projectId
    || journal.approvalKind !== input.approvalKind
    || journal.sourceId !== input.sourceId
    || journal.proceduralRootSeed !== input.proceduralRootSeed
    || journal.payloadFingerprint !== input.payloadFingerprint
  ) {
    throw new Error("SOCIAL_WORLD_APPROVAL_IDEMPOTENCY_PAYLOAD_MISMATCH");
  }
}

/**
 * Starts or resumes a deterministic approval operation. The journal is a
 * recovery checkpoint; canonical writes still perform semantic existence
 * checks, so a completed or partially completed retry does not create a new
 * revision merely because the button was pressed again.
 */
export async function beginSocialWorldApproval(
  repository: NovelRepository,
  input: {
    projectId: string;
    approvalKind: SocialWorldApprovalKind;
    sourceId: string;
    proceduralRootSeed: string;
  },
) {
  const identity = approvalIdentity(input);
  const payloadFingerprint = await sha256Hex(stableStringify(identity));
  const operationId = `social-world-operation:${payloadFingerprint}`;
  const idempotencyKey = `social-world:${payloadFingerprint}`;
  const existing = await repository.get<SocialWorldApprovalJournal>(
    "operationJournal",
    operationId,
  );
  if (existing) {
    assertSameApproval(existing, { ...input, payloadFingerprint });
    return existing;
  }
  const base = makeRecord(input.projectId, "system");
  const journal: SocialWorldApprovalJournal = {
    ...base,
    id: operationId,
    operationId,
    idempotencyKey,
    operationType: SOCIAL_WORLD_APPROVAL_VERSION,
    approvalKind: input.approvalKind,
    sourceId: input.sourceId,
    proceduralRootSeed: input.proceduralRootSeed,
    payloadFingerprint,
    completedStages: [],
    resultingRecordIds: [],
    status: "in_progress",
    completedAt: null,
  };
  try {
    return await repository.put<SocialWorldApprovalJournal>(
      "operationJournal",
      journal,
    );
  } catch (cause) {
    // Another tab may have inserted the same unique idempotency key first.
    const replay = await repository.get<SocialWorldApprovalJournal>(
      "operationJournal",
      operationId,
    );
    if (!replay) throw cause;
    assertSameApproval(replay, { ...input, payloadFingerprint });
    return replay;
  }
}

export async function checkpointSocialWorldApproval(
  repository: NovelRepository,
  operationId: string,
  stage: string,
  resultingRecordIds: string[] = [],
  complete = false,
) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await repository.get<SocialWorldApprovalJournal>(
      "operationJournal",
      operationId,
    );
    if (!current) throw new Error("SOCIAL_WORLD_APPROVAL_JOURNAL_MISSING");
    const hasStage = current.completedStages.includes(stage);
    const missingIds = resultingRecordIds.filter(
      (recordId) => !current.resultingRecordIds.includes(recordId),
    );
    const alreadyComplete = !complete || current.status === "completed";
    if (hasStage && missingIds.length === 0 && alreadyComplete) return current;
    const completedAt = complete
      ? current.completedAt ?? new Date().toISOString()
      : current.completedAt;
    try {
      return await repository.put<SocialWorldApprovalJournal>(
        "operationJournal",
        {
          ...current,
          completedStages: hasStage
            ? current.completedStages
            : [...current.completedStages, stage],
          resultingRecordIds: [
            ...current.resultingRecordIds,
            ...missingIds,
          ],
          status: complete ? "completed" : current.status,
          completedAt,
        },
        current.revision,
      );
    } catch (cause) {
      lastError = cause;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("SOCIAL_WORLD_APPROVAL_CHECKPOINT_FAILED");
}

function appendUnique(current: string[], additions: string[]) {
  const values = new Set(current);
  for (const addition of additions) values.add(addition);
  return [...values];
}

export function storyBibleWithCharacterApproval(
  storyBible: StoryBible,
  input: {
    characterId: string;
    relationshipIds: string[];
    loreIds: string[];
  },
) {
  return {
    ...storyBible,
    characterIds: appendUnique(storyBible.characterIds, [input.characterId]),
    relationshipIds: appendUnique(
      storyBible.relationshipIds,
      input.relationshipIds,
    ),
    loreIds: appendUnique(storyBible.loreIds, input.loreIds),
  };
}

export function storyBibleWithTreasureApproval(
  storyBible: StoryBible,
  treasureId: string,
) {
  return {
    ...storyBible,
    loreIds: appendUnique(storyBible.loreIds, [treasureId]),
  };
}

/** A newly approved world replaces, rather than accumulates, active rules. */
export function storyBibleWithWorldApproval(
  storyBible: StoryBible,
  worldId: string,
  worldRuleIds: string[],
) {
  return {
    ...storyBible,
    worldId,
    worldRuleIds: [...new Set(worldRuleIds)],
  };
}

export function storyBibleApprovalChanged(
  current: StoryBible,
  next: StoryBible,
) {
  return stableStringify({
    characterIds: current.characterIds,
    relationshipIds: current.relationshipIds,
    loreIds: current.loreIds,
    worldId: current.worldId,
    worldRuleIds: current.worldRuleIds,
  }) !== stableStringify({
    characterIds: next.characterIds,
    relationshipIds: next.relationshipIds,
    loreIds: next.loreIds,
    worldId: next.worldId,
    worldRuleIds: next.worldRuleIds,
  });
}

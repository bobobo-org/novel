import { sha256Hex } from "../closed-ai-cache";

export type RpgLogicalTurnProviderStage =
  | "external-generation"
  | "generation"
  | "fallback-review"
  | "fallback-repair";

export const RPG_CONTINUITY_REPAIR_FAILURE_ORDER = [
  "length",
  "paragraphs",
  "dialogue",
  "dialogue_attribution",
  "continuity_anchor",
  "active_character",
  "offstage_character",
  "narrative_scene",
  "action_progression",
  "sensory_detail",
  "report_style",
  "causality",
  "foreshadowing",
  "serial_hook",
  "repetition",
] as const;

export type RpgContinuityRepairFailure =
  typeof RPG_CONTINUITY_REPAIR_FAILURE_ORDER[number];

export type RpgLogicalTurnProviderTaskIdentity = {
  logicalRoot: string;
  stage: RpgLogicalTurnProviderStage;
  attempt: number;
  taskId: string;
  legacy: boolean;
  repairFailures: RpgContinuityRepairFailure[] | null;
};

export function rpgContinuityRepairFailureToken(
  failures: readonly RpgContinuityRepairFailure[],
) {
  const unique = [...new Set(failures)];
  if (!unique.length) throw new Error("RPG_CONTINUITY_REPAIR_FAILURES_REQUIRED");
  let mask = 0;
  for (const failure of unique) {
    const index = RPG_CONTINUITY_REPAIR_FAILURE_ORDER.indexOf(failure);
    if (index < 0) throw new Error("RPG_CONTINUITY_REPAIR_FAILURE_INVALID");
    mask |= (1 << index);
  }
  return mask.toString(16).padStart(4, "0");
}

export function parseRpgContinuityRepairFailureToken(token: string) {
  if (!/^[a-f0-9]{4}$/u.test(token)) return null;
  const mask = Number.parseInt(token, 16);
  if (!Number.isSafeInteger(mask) || mask <= 0 || mask >= (1 << 15)) return null;
  return RPG_CONTINUITY_REPAIR_FAILURE_ORDER.filter((_, index) => (
    (mask & (1 << index)) !== 0
  ));
}

function assertRpgLogicalTurnAttempt(attempt: number) {
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 1_000_000) {
    throw new Error("RPG_LOGICAL_TURN_ATTEMPT_INVALID");
  }
}

export async function rpgLogicalTurnTaskRoot(logicalTurnId: string) {
  const normalized = logicalTurnId.normalize("NFKC").trim();
  if (!normalized) throw new Error("RPG_LOGICAL_TURN_ID_REQUIRED");
  const digest = await sha256Hex(`rpg-logical-turn-v1|${normalized}`);
  return `rpg-turn:${digest.slice(0, 32)}`;
}

export async function rpgLogicalTurnGenerationTaskId(
  logicalTurnId: string,
  attempt = 1,
) {
  assertRpgLogicalTurnAttempt(attempt);
  return `${await rpgLogicalTurnTaskRoot(logicalTurnId)}:generation:attempt-${attempt}`;
}

export async function rpgLogicalTurnExternalGenerationTaskId(
  logicalTurnId: string,
  attempt = 1,
) {
  assertRpgLogicalTurnAttempt(attempt);
  return `${await rpgLogicalTurnTaskRoot(logicalTurnId)}:external-generation:attempt-${attempt}`;
}

export async function rpgLogicalTurnFallbackReviewTaskId(
  logicalTurnId: string,
  attempt = 1,
) {
  assertRpgLogicalTurnAttempt(attempt);
  return `${await rpgLogicalTurnTaskRoot(logicalTurnId)}:fallback-review:attempt-${attempt}`;
}

export async function rpgLogicalTurnFallbackRepairTaskId(
  logicalTurnId: string,
  failures: readonly RpgContinuityRepairFailure[],
  attempt = 1,
) {
  assertRpgLogicalTurnAttempt(attempt);
  const failureToken = rpgContinuityRepairFailureToken(failures);
  return `${await rpgLogicalTurnTaskRoot(logicalTurnId)}:fallback-repair:quality-${failureToken}:attempt-${attempt}`;
}

/**
 * Authenticates a durable provider run against one logical RPG turn.  Legacy
 * pre-attempt receipts remain replayable, while all new runs carry a distinct,
 * deterministic stage/attempt identity. Product generation dispatches attempt
 * 1 on first dispatch; fallback review has its own identity instead of
 * silently creating a second generation task. Generation-stage attempt values
 * identify explicit author retries. Fallback stages reserve two deterministic
 * slots per author attempt (odd primary, even bounded repetition-only retry),
 * preserving immutable ledger entries without colliding with the next author
 * retry.
 */
export async function parseRpgLogicalTurnProviderTaskId(
  logicalTurnId: string,
  providerTaskId: string,
): Promise<RpgLogicalTurnProviderTaskIdentity | null> {
  const taskId = providerTaskId.normalize("NFKC").trim();
  if (!taskId) return null;
  const logicalRoot = await rpgLogicalTurnTaskRoot(logicalTurnId);
  const suffix = taskId.startsWith(`${logicalRoot}:`)
    ? taskId.slice(logicalRoot.length + 1)
    : "";
  const repair = /^fallback-repair:quality-([a-f0-9]{4}):attempt-([1-9]\d{0,6})$/u.exec(suffix);
  if (repair) {
    const repairFailures = parseRpgContinuityRepairFailureToken(repair[1]!);
    const attempt = Number(repair[2]);
    if (
      !repairFailures
      || !Number.isSafeInteger(attempt)
      || attempt < 1
      || attempt > 1_000_000
    ) return null;
    return {
      logicalRoot,
      stage: "fallback-repair",
      attempt,
      taskId,
      legacy: false,
      repairFailures,
    };
  }
  const current = /^(external-generation|generation|fallback-review):attempt-([1-9]\d{0,6})$/u.exec(suffix);
  if (current) {
    const attempt = Number(current[2]);
    if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 1_000_000) return null;
    return {
      logicalRoot,
      stage: current[1] as RpgLogicalTurnProviderStage,
      attempt,
      taskId,
      legacy: false,
      repairFailures: null,
    };
  }
  if (
    suffix === "external-generation"
    || suffix === "generation"
    || suffix === "fallback-review"
    || suffix === "fallback-repair"
  ) {
    return {
      logicalRoot,
      stage: suffix,
      attempt: 1,
      taskId,
      legacy: true,
      repairFailures: null,
    };
  }
  return null;
}

export async function isRpgLogicalTurnProviderTaskId(
  logicalTurnId: string,
  providerTaskId: string | null | undefined,
) {
  return Boolean(providerTaskId && await parseRpgLogicalTurnProviderTaskId(
    logicalTurnId,
    providerTaskId,
  ));
}

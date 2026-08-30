import { sha256Hex } from "../closed-ai-cache";

export type RpgLogicalTurnProviderStage = "external-generation" | "generation" | "fallback-review";

export type RpgLogicalTurnProviderTaskIdentity = {
  logicalRoot: string;
  stage: RpgLogicalTurnProviderStage;
  attempt: number;
  taskId: string;
  legacy: boolean;
};

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

/**
 * Authenticates a durable provider run against one logical RPG turn.  Legacy
 * pre-attempt receipts remain replayable, while all new runs carry a distinct,
 * deterministic attempt identity so a rejected first candidate cannot poison
 * the second attempt through ClosedAgentOS idempotency replay.
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
    };
  }
  if (
    suffix === "external-generation"
    || suffix === "generation"
    || suffix === "fallback-review"
  ) {
    return {
      logicalRoot,
      stage: suffix,
      attempt: 1,
      taskId,
      legacy: true,
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

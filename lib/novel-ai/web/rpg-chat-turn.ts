import type { ClosedAIProgressEvent } from "../closed-agent-os";
import type {
  AcceptedChoice,
  Chapter,
  Character,
  CharacterRelationship,
  ExternalAttemptProvenance,
  LoreEntry,
  NovelProject,
  RpgContextRevisionGuard,
  RpgTurnReceipt,
  StoryBible,
  StoryState,
  TimelineEvent,
  World,
  WorldRule,
} from "../domain";
import { buildRpgContextRevisionGuard } from "../services/rpg-context-revision";
import {
  activeStoryCast,
  activeStoryLore,
  activeStoryRelationships,
  activeStoryTimeline,
  activeStoryWorldRules,
} from "../domain/active-story-context";
import { resolveProjectStoryBible } from "../domain/story-bible-selection";
import { sha256Hex, stableStringify } from "../closed-ai-cache";
import {
  parseRpgLogicalTurnProviderTaskId,
  RPG_CONTINUITY_REPAIR_FAILURE_ORDER,
  rpgContinuityRepairFailureToken,
  rpgLogicalTurnFallbackRepairTaskId,
  rpgLogicalTurnFallbackReviewTaskId,
  rpgLogicalTurnGenerationTaskId,
  type RpgContinuityRepairFailure,
} from "../conversation/rpg-logical-turn";
import {
  isGameStoryPlayMode,
  STORY_PLAY_MODE_LABELS,
  resolveStoryPlayMode,
  type StoryPlayModeId,
} from "../domain/play-mode";
import {
  DEFAULT_RPG_RULE_SETTINGS,
  buildCustomRpgChoice,
  buildRpgChoices,
  materializeRpgStoryStateBaseline,
  readRpgProgression,
  resolveRpgChoice,
  type RpgChoice,
  type RpgChoiceResolution,
  type RpgMode,
  type RpgProgressionSnapshot,
  type RpgRuleSettings,
} from "../game/progression/rpg-progression";
import { RPG_RESOURCE_CATALOG_V3 } from "../game/progression/xianxia-ruleset-v3";
import {
  adaptProceduralEncounterForRomance,
  buildProceduralCausalFrame,
  romanceSafeProceduralText,
} from "../game/procedural-world-director";
import {
  PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
  proceduralCharacterTreasureScenarioAt,
  type ProceduralCharacterCandidate,
  type ProceduralCastRole,
  type ProceduralCausalDimensionId,
} from "../game/procedural-story-library";
import {
  bindStoryArcToChoices,
  readStoryArcRuntime,
} from "../game/story-arc-runtime";
import type { AcceptChoiceConversationApprovalInput, NovelRepository } from "../repository";
import { createProjectBackup } from "../repository/backup";
import {
  APPROVED_LEARNING_CONTEXT_SNAPSHOT_VERSION,
  buildApprovedLearningContext,
  type ApprovedLearningCausalSignal,
  type SovereignLearningRepository,
} from "../sovereign-learning";
import {
  acceptStudioChoice,
  persistStudioChoiceCandidate,
  type StudioProjectSeed,
} from "../repository/studio-canonical";
import {
  approveStudioClosedAgentCandidate,
  rejectStudioClosedAgentCandidate,
} from "./closed-agent-os-service";
import {
  buildCompactRpgResolutionDirectorPrompt,
  buildRpgReaderSafeChoicePayload,
  buildRpgChoiceDirectorPrompt,
  buildRpgResolutionDirectorPrompt,
  cleanRpgContinuation,
  mergeRpgChoiceDirection,
  parseRpgChoiceDirectorOutput,
  rpgTextSimilarity,
  toRpgReaderSafePromptPayload,
  validateRpgContinuationNovelty,
  validateRpgStoryTurnContract,
  type RpgDirectedChoice,
  type StoryOutputLanguage,
} from "./rpg-closed-ai-director";
import {
  probePreCreationProviderAvailability,
  runStudioClosedAI,
  type PreCreationProviderAvailability,
} from "./studio-closed-ai";
import {
  evaluateNovelContinuityGate,
  hasVerifiedExecutedStoryOutput,
  type NovelContinuityGateFailure,
} from "./story-output-quality";
import {
  verifyExternalRpgExecutionReceipt,
  verifyExternalRpgFailureLineage,
} from "./rpg-external-receipt";
import {
  assertAdultNarrativeFadeToBlackOutput,
  assertAdultNarrativeParticipantsAuthorized,
  bindAdultNarrativeRuntime,
  formatAdultNarrativeRuntimePromptBinding,
  type AdultNarrativeRuntimeBindingInput,
} from "../adult/scenes/adult-narrative-runtime-binding";
import {
  bindRpgAdultApplicationValidationDigest,
  createRpgAdultRuntimePolicyBindingDigests,
  sealRpgAdultRuntimePolicyReceipt,
  verifyRpgAdultRuntimePolicyReceipt,
} from "./rpg-adult-runtime-receipt";

export {
  normalizeRpgChoiceWireText,
  parseRpgChoiceSelection,
  rpgChoiceWireText,
} from "./rpg-chat-wire";

export const RPG_CHAT_TURN_SCHEMA_VERSION = "rpg-chat-turn-v1" as const;
export const RPG_CHAT_CHOICE_AI_TIMEOUT_MS = 180_000;
export const RPG_CHAT_STORY_AI_TIMEOUT_MS = 360_000;
export const RPG_CHAT_FALLBACK_REVIEW_TIMEOUT_MS = 360_000;
export const RPG_CHAT_STORY_AI_RETRY_BACKOFF_MS = 750;
export const RPG_SHARED_LEARNING_SYNC_WAIT_MS = 350;

const RPG_CHOICE_RULE_FALLBACK_TIMEOUT_CODES = new Set([
  "REQUEST_TIMEOUT",
  "OLLAMA_TIMEOUT",
  "RPG_CHOICE_AI_ENHANCEMENT_TIMEOUT",
]);

const RPG_STORY_RULE_FALLBACK_TIMEOUT_CODES = new Set([
  "RPG_STORY_AI_TIMEOUT",
  "REQUEST_TIMEOUT",
  "OLLAMA_TIMEOUT",
]);

export function rpgChoiceRuleFallbackReason(input: {
  error: unknown;
  requestAbortReason?: unknown;
  enhancementAbortReason?: unknown;
}) {
  if (input.requestAbortReason === "USER_REQUESTED_RULE_FALLBACK") {
    return "USER_REQUESTED_RULE_FALLBACK";
  }
  if (input.enhancementAbortReason === "RPG_CHOICE_AI_ENHANCEMENT_TIMEOUT") {
    return "RPG_CHOICE_AI_ENHANCEMENT_TIMEOUT";
  }
  const code = String((input.error as { code?: unknown } | null)?.code ?? "");
  return RPG_CHOICE_RULE_FALLBACK_TIMEOUT_CODES.has(code) ? code : null;
}

export function rpgStoryRuleFallbackReason(error: unknown) {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  return RPG_STORY_RULE_FALLBACK_TIMEOUT_CODES.has(code) ? code : null;
}

export type RpgClosedAIDeadlineDependencies = {
  now?: () => number;
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  probeAvailability?: (signal?: AbortSignal) => Promise<PreCreationProviderAvailability>;
  retryBackoffMs?: number;
};

function safeRpgFailureLeafCode(error: unknown) {
  let current = error;
  let leaf: string | null = null;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^RPG_[A-Z0-9_]{1,100}$/u.test(code)) leaf = code;
    const message = current instanceof Error ? current.message.trim() : "";
    if (/^RPG_[A-Z0-9_]{1,100}$/u.test(message)) leaf = message;
    current = (current as { cause?: unknown }).cause;
  }
  return leaf;
}

const RPG_NOVEL_CONTINUITY_FAILURES = new Set<NovelContinuityGateFailure>([
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
]);

const RPG_NOVEL_REPETITION_LEAF_CODES = new Set([
  "RPG_AI_CONTINUATION_REPETITIVE",
  "RPG_AI_CONTINUATION_WHOLE_SCENE_LOOP",
  "RPG_AI_CONTINUATION_INTERNAL_PARAGRAPH_LOOP",
]);

function rpgNovelContinuityFailures(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth += 1) {
    const candidate = current as {
      code?: unknown;
      continuityFailures?: unknown;
      cause?: unknown;
    };
    if (
      candidate.code === "RPG_NOVEL_CONTINUITY_GATE_FAILED"
      && Array.isArray(candidate.continuityFailures)
      && candidate.continuityFailures.length > 0
      && candidate.continuityFailures.every((failure) => (
        typeof failure === "string"
        && RPG_NOVEL_CONTINUITY_FAILURES.has(failure as NovelContinuityGateFailure)
      ))
    ) {
      return [...new Set(candidate.continuityFailures)] as NovelContinuityGateFailure[];
    }
    current = candidate.cause;
  }
  if (RPG_NOVEL_REPETITION_LEAF_CODES.has(safeRpgFailureLeafCode(error) ?? "")) {
    return ["repetition"] satisfies NovelContinuityGateFailure[];
  }
  return null;
}

function rpgClosedAITimeoutError(attempts: number, cause?: unknown) {
  return Object.assign(new Error("The RPG closed-AI generation deadline expired."), {
    code: "RPG_STORY_AI_TIMEOUT",
    retryable: false,
    attempts,
    cause,
  });
}

function raceRpgClosedAIOperation<T>(input: {
  operation: (signal: AbortSignal) => Promise<T>;
  remainingMs: number;
  callerSignal?: AbortSignal;
  attempts: number;
}) {
  if (input.callerSignal?.aborted) {
    return Promise.reject(input.callerSignal.reason);
  }
  const controller = new AbortController();
  const relayAbort = () => controller.abort(input.callerSignal?.reason);
  input.callerSignal?.addEventListener("abort", relayAbort, { once: true });
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.callerSignal?.removeEventListener("abort", relayAbort);
      callback();
    };
    const timeout = setTimeout(() => {
      const error = rpgClosedAITimeoutError(input.attempts);
      controller.abort(error);
      finish(() => reject(error));
    }, Math.max(1, input.remainingMs));
    controller.signal.addEventListener("abort", () => {
      if (!input.callerSignal?.aborted) return;
      finish(() => reject(input.callerSignal?.reason));
    }, { once: true });
    // The caller may abort in the narrow window between the first check and
    // listener registration. AbortSignal does not replay that event, so check
    // once more before invoking a provider that may ignore cancellation.
    if (input.callerSignal?.aborted) {
      controller.abort(input.callerSignal.reason);
      finish(() => reject(input.callerSignal?.reason));
      return;
    }
    Promise.resolve()
      .then(() => input.operation(controller.signal))
      .then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
  });
}

function waitForRpgClosedAIRetry(delayMs: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Keeps readiness polling and closed-model dispatch inside one caller-owned
 * deadline. Loading/unknown/unavailable states never create a provider task.
 * The default remains exactly one request. A caller may explicitly authorize
 * one additional dispatch for a narrowly classified application rejection;
 * both requests still share the original deadline and strict validators.
 */
export async function runRpgClosedAIUntilDeadline<T>(input: {
  execute: (attempt: number, signal: AbortSignal) => Promise<T>;
  deadlineMs?: number;
  /** First deterministic provider-attempt number, used when replaying a receipt. */
  startAttempt?: number;
  /** Defaults to one. Only a reviewed repair path may explicitly authorize two. */
  maximumDispatches?: 1 | 2;
  retryAfterDispatch?: (event: {
    attempt: number;
    remainingMs: number;
    error: unknown;
  }) => boolean;
  signal?: AbortSignal;
  onRetry?: (event: {
    attempt: number;
    availability: PreCreationProviderAvailability;
    remainingMs: number;
    error: unknown;
  }) => void;
  dependencies?: RpgClosedAIDeadlineDependencies;
}) {
  const now = input.dependencies?.now ?? Date.now;
  const wait = input.dependencies?.wait ?? waitForRpgClosedAIRetry;
  const probeAvailability = input.dependencies?.probeAvailability
    ?? (async (signal?: AbortSignal) => (
      await probePreCreationProviderAvailability(signal)
    ).availability);
  const retryBackoffMs = Math.max(
    1,
    input.dependencies?.retryBackoffMs ?? RPG_CHAT_STORY_AI_RETRY_BACKOFF_MS,
  );
  const deadlineMs = Math.max(1, input.deadlineMs ?? RPG_CHAT_STORY_AI_TIMEOUT_MS);
  const startedAt = now();
  const startAttempt = input.startAttempt ?? 1;
  if (!Number.isSafeInteger(startAttempt) || startAttempt < 1 || startAttempt > 1_000_000) {
    throw Object.assign(new Error("Invalid RPG closed-AI retry attempt."), {
      code: "RPG_STORY_AI_ATTEMPT_INVALID",
    });
  }
  const maximumDispatches = input.maximumDispatches ?? 1;
  if (maximumDispatches !== 1 && maximumDispatches !== 2) {
    throw Object.assign(new Error("Invalid RPG closed-AI dispatch limit."), {
      code: "RPG_STORY_AI_DISPATCH_LIMIT_INVALID",
    });
  }
  let attempt = startAttempt;
  let poll = 0;
  let lastError: unknown = null;
  const remaining = () => deadlineMs - (now() - startedAt);
  const waitForNextProbe = async (
    availability: PreCreationProviderAvailability,
    error: unknown,
  ) => {
    const remainingMs = remaining();
    if (remainingMs <= 0) throw rpgClosedAITimeoutError(attempt, error);
    input.onRetry?.({ attempt, availability, remainingMs, error });
    poll += 1;
    const exponentialBackoff = retryBackoffMs * (2 ** Math.min(poll - 1, 6));
    const maximumBackoff = Math.max(retryBackoffMs, 12_000);
    await wait(
      Math.min(exponentialBackoff, maximumBackoff, remainingMs),
      input.signal,
    );
  };

  while (true) {
    while (true) {
      if (input.signal?.aborted) throw input.signal.reason ?? lastError;
      const remainingBeforeProbe = remaining();
      if (remainingBeforeProbe <= 0) {
        throw rpgClosedAITimeoutError(attempt, lastError);
      }
      let availability: PreCreationProviderAvailability = "unknown";
      try {
        availability = await raceRpgClosedAIOperation({
          operation: probeAvailability,
          remainingMs: remainingBeforeProbe,
          callerSignal: input.signal,
          attempts: attempt,
        });
      } catch (probeError) {
        if (input.signal?.aborted) throw input.signal.reason ?? probeError;
        if (probeError && typeof probeError === "object" && "code" in probeError
          && (probeError as { code?: unknown }).code === "RPG_STORY_AI_TIMEOUT") {
          throw probeError;
        }
        lastError = probeError;
      }
      if (availability === "ready") break;
      lastError = lastError ?? Object.assign(
        new Error(`Closed AI provider is not ready (${availability}).`),
        { code: "RPG_STORY_AI_NOT_READY", availability },
      );
      await waitForNextProbe(availability, lastError);
    }

    if (input.signal?.aborted) throw input.signal.reason ?? lastError;
    const remainingBeforeAttempt = remaining();
    if (remainingBeforeAttempt <= 0) {
      throw rpgClosedAITimeoutError(attempt, lastError);
    }
    try {
      return {
        value: await raceRpgClosedAIOperation({
          operation: (signal) => input.execute(attempt, signal),
          remainingMs: remainingBeforeAttempt,
          callerSignal: input.signal,
          attempts: attempt,
        }),
        attempts: attempt,
      };
    } catch (error) {
      if (input.signal?.aborted) throw input.signal.reason ?? error;
      const dispatched = attempt - startAttempt + 1;
      const remainingMs = remaining();
      const retryAuthorized = dispatched < maximumDispatches
        && remainingMs > 0
        && input.retryAfterDispatch?.({ attempt, remainingMs, error }) === true;
      if (!retryAuthorized) {
        // The default single-dispatch contract preserves the original provider
        // or application error. Extra dispatches are opt-in and bounded above.
        throw error;
      }
      // The next attempt owns its own readiness diagnosis. Do not let the
      // rejected prose from the previous dispatch masquerade as a later probe
      // timeout when no second provider request was actually submitted.
      lastError = null;
      attempt += 1;
      poll = 0;
    }
  }
}

export type RpgChatSnapshot = {
  schemaVersion: typeof RPG_CHAT_TURN_SCHEMA_VERSION;
  project: NovelProject;
  chapter: Chapter;
  chapters: Chapter[];
  storyState: StoryState;
  storyBible: StoryBible;
  characters: Character[];
  relationships: CharacterRelationship[];
  worldRules: WorldRule[];
  lore: LoreEntry[];
  timeline: TimelineEvent[];
  acceptedChoices: AcceptedChoice[];
  rpgTurnReceipts: RpgTurnReceipt[];
  playMode: StoryPlayModeId;
  progressionMode: RpgMode;
  language: StoryOutputLanguage;
  progression: RpgProgressionSnapshot;
  conflict: string;
  directorContext: Record<string, unknown>;
  /** Digest of the one immutable, reader-safe context used by every executor. */
  contextDigest: string;
  /** Canonical record revision vector used to reject approvals from stale tabs. */
  contextRevisionDigest: string;
  /** Full vector atomically compared by the repository during acceptance. */
  contextRevisionGuard: RpgContextRevisionGuard;
  causalKnowledge: {
    snapshotVersion: typeof APPROVED_LEARNING_CONTEXT_SNAPSHOT_VERSION;
    snapshotDigest: string;
    selectedRuleIds: string[];
    instructions: string[];
    causalSignals: ApprovedLearningCausalSignal[];
    maximumRules: 8;
    entireLibraryScanned: false;
  };
  baseChoices: RpgChoice[];
};

export type RpgChatChoicePlan = {
  schemaVersion: typeof RPG_CHAT_TURN_SCHEMA_VERSION;
  choices: RpgDirectedChoice[];
  taskId: string;
  candidateId: string;
  contentDigest: string;
  model: string;
  modelDigest: string;
  actualExecutor: string;
  executionReceipt: unknown;
  contextDigest: string | null;
  contextRevisionDigest: string;
  contextRevisionGuard: RpgContextRevisionGuard;
  canonicalMutationCount: 0;
  dataLeftDevice: false;
  externalRequest: false;
};

function latestAcceptedChoices(
  choices: readonly AcceptedChoice[],
  maximum = 8,
) {
  return [...choices]
    .sort((left, right) => (
      right.acceptedAt.localeCompare(left.acceptedAt)
      || left.id.localeCompare(right.id)
    ))
    .slice(0, maximum)
    .reverse();
}

function stableRecordOrder<T extends { id: string }>(records: readonly T[]) {
  return [...records].sort((left, right) => left.id.localeCompare(right.id));
}

function stableChapterOrder(chapters: readonly Chapter[]) {
  return [...chapters].sort((left, right) => (
    left.order - right.order || left.id.localeCompare(right.id)
  ));
}

function stableTimelineOrder(timeline: readonly TimelineEvent[]) {
  return [...timeline].sort((left, right) => (
    (left.storyTime ?? left.createdAt).localeCompare(right.storyTime ?? right.createdAt)
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id)
  ));
}

function stableAcceptedChoiceOrder(choices: readonly AcceptedChoice[]) {
  return [...choices].sort((left, right) => (
    right.acceptedAt.localeCompare(left.acceptedAt)
    || left.id.localeCompare(right.id)
  ));
}

function stableRpgTurnReceiptOrder(receipts: readonly RpgTurnReceipt[]) {
  return [...receipts].sort((left, right) => (
    right.turnNumber - left.turnNumber || left.id.localeCompare(right.id)
  ));
}

async function loadCurrentRpgContextRevisionDigest(
  repository: NovelRepository,
  projectId: string,
) {
  const [project, chapters, states, bibles, characters, relationships, worlds, worldRules, lore, timeline, acceptedChoices, rpgTurnReceipts] = await Promise.all([
    repository.get<NovelProject>("projects", projectId),
    repository.list<Chapter>("chapters", projectId),
    repository.list<StoryState>("storyStates", projectId),
    repository.list<StoryBible>("storyBibles", projectId),
    repository.list<Character>("characters", projectId),
    repository.list<CharacterRelationship>("relationships", projectId),
    repository.list<World>("worlds", projectId),
    repository.list<WorldRule>("worldRules", projectId),
    repository.list<LoreEntry>("lore", projectId),
    repository.list<TimelineEvent>("timeline", projectId),
    repository.listAcceptedChoices(projectId),
    repository.list<RpgTurnReceipt>("rpgTurnReceipts", projectId),
  ]);
  if (!project || project.deletedAt) return null;
  return (await buildRpgContextRevisionGuard({
    projects: [project],
    chapters,
    storyStates: states,
    storyBibles: bibles,
    characters,
    relationships,
    worlds,
    worldRules,
    lore,
    timeline,
    acceptedChoices,
    rpgTurnReceipts,
  })).digest;
}

function freezeRpgDirectorContext<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    freezeRpgDirectorContext(child);
  }
  return Object.freeze(value);
}

/**
 * Canonical chronological continuity window: latest chapter tails followed by
 * the latest accepted turns. Repository listing order is never trusted.
 */
export function selectRecentRpgContinuityTexts(
  snapshot: Pick<RpgChatSnapshot, "chapter" | "chapters" | "acceptedChoices">,
  acceptedMaximum = 8,
) {
  const chapterById = new Map(
    [...(snapshot.chapters ?? []), snapshot.chapter]
      .map((chapter) => [chapter.id, chapter] as const),
  );
  const chapterTails = [...chapterById.values()]
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .slice(-4)
    .flatMap((chapter) => {
      const content = chapter.content?.trim();
      if (!content) return [];
      return [Array.from(content).slice(-1_800).join("")];
    });
  const acceptedTexts = latestAcceptedChoices(
    snapshot.acceptedChoices ?? [],
    acceptedMaximum,
  )
    .map((choice) => choice.acceptedText?.trim())
    .filter((content): content is string => Boolean(content));
  return { chapterTails, acceptedTexts };
}

function assertThreePlayableChoices(choices: readonly RpgDirectedChoice[]) {
  const keys = choices.map((choice) => choice.key);
  const titles = new Set(choices.map((choice) => choice.title.trim().toLocaleLowerCase()));
  const approaches = new Set(choices.map((choice) => choice.approach));
  if (
    choices.length !== 3
    || keys.join("") !== "ABC"
    || titles.size !== 3
    || approaches.size !== 3
    || choices.some((choice) => Boolean(choice.disabledReason))
  ) {
    throw Object.assign(new Error("閉端規則引擎沒有建立恰好三個可玩的不同選項。"), {
      code: "RPG_CHAT_RULE_CHOICES_NOT_PLAYABLE",
    });
  }
}

function isPostArcChoiceSet(choices: readonly RpgDirectedChoice[]) {
  return choices.length === 3
    && choices.map((choice) => choice.key).join("") === "ABC"
    && choices.every((choice) => Boolean(choice.encounter?.arcNextAction));
}

function storyWorldFlags(storyState: StoryState): Record<string, unknown> {
  const flags = storyState.worldFlags;
  return flags && typeof flags === "object" ? flags : {};
}

function normalizedCausalKnowledge(snapshot: RpgChatSnapshot) {
  const knowledge = snapshot.causalKnowledge;
  const validSignals = (Array.isArray(knowledge?.causalSignals)
    ? knowledge.causalSignals
    : []).filter((signal): signal is ApprovedLearningCausalSignal => Boolean(
      signal
      && typeof signal === "object"
      && typeof signal.ruleId === "string"
      && typeof signal.statement === "string"
      && typeof signal.operation === "string"
      && typeof signal.constraint === "string"
      && typeof signal.evaluate === "string",
    ));
  const seenSignalIds = new Set<string>();
  const causalSignals: ApprovedLearningCausalSignal[] = [];
  for (const signal of validSignals) {
    const ruleId = signal.ruleId.trim();
    if (!ruleId || seenSignalIds.has(ruleId)) {
      continue;
    }
    seenSignalIds.add(ruleId);
    causalSignals.push({ ...signal, ruleId });
    if (causalSignals.length === 8) {
      break;
    }
  }
  const signalRuleIds = new Set(causalSignals.map((signal) => signal.ruleId));
  const snapshotDigest = typeof knowledge?.snapshotDigest === "string"
    && knowledge.snapshotDigest.trim()
    ? knowledge.snapshotDigest
    : null;
  const selectedRuleIds = snapshotDigest && Array.isArray(knowledge?.selectedRuleIds)
    ? [...new Set(knowledge.selectedRuleIds
        .filter((ruleId): ruleId is string => typeof ruleId === "string")
        .map((ruleId) => ruleId.trim())
        .filter((ruleId) => Boolean(ruleId) && signalRuleIds.has(ruleId)))]
        .slice(0, 8)
    : [];
  const instructions = selectedRuleIds.length && Array.isArray(knowledge?.instructions)
    ? [...new Set(knowledge.instructions
        .filter((instruction): instruction is string => typeof instruction === "string")
        .map((instruction) => instruction.trim())
        .filter(Boolean))]
        .slice(0, 8)
    : [];
  return {
    snapshotVersion: knowledge?.snapshotVersion === APPROVED_LEARNING_CONTEXT_SNAPSHOT_VERSION
      ? knowledge.snapshotVersion
      : APPROVED_LEARNING_CONTEXT_SNAPSHOT_VERSION,
    snapshotDigest: selectedRuleIds.length && snapshotDigest
      ? snapshotDigest
      : "no-approved-learning",
    selectedRuleIds,
    instructions,
    causalSignals: selectedRuleIds.length
      ? causalSignals.filter((signal) => selectedRuleIds.includes(signal.ruleId))
      : [],
    maximumRules: 8 as const,
    entireLibraryScanned: false as const,
  };
}

function assertRuleChoiceState(snapshot: RpgChatSnapshot) {
  const flags = storyWorldFlags(snapshot.storyState);
  const archived = flags["story.arc.archived"] === true;
  if (archived) {
    if (snapshot.baseChoices.length !== 0) {
      throw Object.assign(new Error("已封存的結局不能再產生故事行動。"), {
        code: "RPG_CHAT_ARCHIVED_CHOICES_PRESENT",
      });
    }
    return;
  }
  if (!isPostArcChoiceSet(snapshot.baseChoices)) {
    assertThreePlayableChoices(snapshot.baseChoices);
    return;
  }
  const titles = new Set(snapshot.baseChoices.map((choice) => choice.title.trim().toLocaleLowerCase()));
  const approaches = new Set(snapshot.baseChoices.map((choice) => choice.approach));
  const invalidDisabledChoice = snapshot.baseChoices.some((choice) =>
    Boolean(choice.disabledReason)
    && !(
      choice.encounter?.arcNextAction === "epilogue"
      && flags["story.arc.epilogueRead"] === true
    ));
  if (titles.size !== 3 || approaches.size !== 3 || invalidDisabledChoice) {
    throw Object.assign(new Error("結案後續必須保留尾聲、續篇與封存三種專用行為。"), {
      code: "RPG_CHAT_POST_ARC_CHOICES_INVALID",
    });
  }
}

function withCausalKnowledgeReceipt(receipt: unknown, snapshot: RpgChatSnapshot) {
  const upstream = receipt && typeof receipt === "object"
    ? receipt as Record<string, unknown>
    : { upstreamReceipt: receipt ?? null };
  const knowledge = normalizedCausalKnowledge(snapshot);
  return {
    ...upstream,
    upstreamContextDigest: typeof upstream.contextDigest === "string"
      ? upstream.contextDigest
      : null,
    rpgContextDigest: snapshot.contextDigest,
    rpgContextRevisionDigest: snapshot.contextRevisionDigest,
    causalKnowledgeSnapshotVersion: knowledge?.snapshotVersion
      ?? APPROVED_LEARNING_CONTEXT_SNAPSHOT_VERSION,
    causalKnowledgeSnapshotDigest: knowledge?.snapshotDigest ?? "no-approved-learning",
    causalKnowledgeRuleIds: [...(knowledge?.selectedRuleIds ?? [])],
    causalKnowledgeRuleCount: knowledge?.selectedRuleIds.length ?? 0,
    causalKnowledgeMaximumRules: knowledge?.maximumRules ?? 8,
    entireLibraryScanned: false,
  };
}

export async function buildRpgRuleChoicePlan(input: {
  snapshot: RpgChatSnapshot;
  fallbackReason?: string;
}): Promise<RpgChatChoicePlan> {
  assertRuleChoiceState(input.snapshot);
  const knowledge = normalizedCausalKnowledge(input.snapshot);
  const flags = storyWorldFlags(input.snapshot.storyState);
  const fallbackBody = {
    schemaVersion: RPG_CHAT_TURN_SCHEMA_VERSION,
    sourceChapterId: input.snapshot.chapter.id,
    sourceRevision: input.snapshot.chapter.revision,
    storyStateRevision: input.snapshot.storyState.revision,
    choices: input.snapshot.baseChoices.map((choice) => ({
      key: choice.key,
      title: choice.title,
      description: choice.description,
      consequenceTeaser: choice.consequenceTeaser,
      strategy: choice.approach,
      successChance: choice.successChance,
    })),
    fallbackReason: input.fallbackReason || "RPG_RULE_FIRST_IMMEDIATE_PLAN",
    rpgContextRevisionDigest: input.snapshot.contextRevisionDigest,
    causalKnowledgeSnapshotVersion: knowledge.snapshotVersion,
    causalKnowledgeSnapshotDigest: knowledge.snapshotDigest,
    causalKnowledgeRuleIds: knowledge.selectedRuleIds,
  };
  const contentDigest = await sha256Hex(stableStringify(fallbackBody));
  const contextDigest = input.snapshot.contextDigest;
  const modelDigest = await sha256Hex("closed-causal-teacher:rules-only:xianxia-cultivation-v3");
  const taskId = `rules-choice-plan:${contentDigest.slice(0, 24)}`;
  return {
    schemaVersion: RPG_CHAT_TURN_SCHEMA_VERSION,
    choices: structuredClone(input.snapshot.baseChoices),
    taskId,
    candidateId: taskId,
    contentDigest,
    model: "closed-causal-teacher-rules",
    modelDigest,
    actualExecutor: "deterministic-rule-fallback",
    executionReceipt: {
      receiptId: `rules-receipt:${contentDigest.slice(0, 24)}`,
      fallback: true,
      fallbackReason: fallbackBody.fallbackReason,
      choiceCount: input.snapshot.baseChoices.length,
      exactKeys: input.snapshot.baseChoices.map((choice) => choice.key),
      terminalArchive: flags["story.arc.archived"] === true,
      causalKnowledgeRuleCount: knowledge.selectedRuleIds.length,
      causalKnowledgeRuleIds: knowledge.selectedRuleIds,
      causalKnowledgeSnapshotVersion: knowledge.snapshotVersion,
      causalKnowledgeSnapshotDigest: knowledge.snapshotDigest,
      causalKnowledgeSelection: "approved-indexed-top-k",
      rpgContextDigest: input.snapshot.contextDigest,
      rpgContextRevisionDigest: input.snapshot.contextRevisionDigest,
      entireLibraryScanned: false,
      externalRequest: false,
      dataLeftDevice: false,
    },
    contextDigest,
    contextRevisionDigest: input.snapshot.contextRevisionDigest,
    contextRevisionGuard: structuredClone(input.snapshot.contextRevisionGuard),
    canonicalMutationCount: 0,
    dataLeftDevice: false,
    externalRequest: false,
  };
}

export type RpgChatTurnCandidate = {
  schemaVersion: typeof RPG_CHAT_TURN_SCHEMA_VERSION;
  taskId: string;
  candidateId: string;
  /** Digest of the authoritative provider output kept by Closed Agent OS. */
  candidateDigest: string;
  /** Digest of the application-validated story that is eligible for Canon. */
  storyDigest?: string;
  model: string;
  modelDigest: string;
  actualExecutor: string;
  executionReceipt: unknown;
  contextDigest: string | null;
  contextRevisionDigest: string;
  contextRevisionGuard: RpgContextRevisionGuard;
  sourceChapterId: string;
  sourceRevision: number;
  choice: RpgChoice;
  resolution: RpgChoiceResolution;
  story: string;
  outcomeLines: string[];
  canonicalMutationCount: 0;
  dataLeftDevice: boolean;
  externalRequest: boolean;
};

function progressionMode(playMode: StoryPlayModeId): RpgMode {
  if (playMode === "management") return "management";
  if (playMode === "romance") return "cultivation";
  return "adventure";
}

function storyLanguage(storyState: StoryState): StoryOutputLanguage {
  const value = storyWorldFlags(storyState)["story.language"];
  return value === "zh-CN" || value === "en" ? value : "zh-TW";
}

function projectSeed(snapshot: RpgChatSnapshot): StudioProjectSeed {
  const protagonist = snapshot.characters.find((character) =>
    snapshot.storyBible.protagonistIds.includes(character.id))
    ?? snapshot.characters[0];
  return {
    id: snapshot.project.id,
    title: snapshot.project.title,
    chapterId: snapshot.chapter.id,
    chapterTitle: snapshot.chapter.title,
    draft: snapshot.chapter.content,
    packId: snapshot.project.genrePackId,
    topicId: snapshot.project.genreId,
    subCategory: snapshot.project.subgenreId,
    coreIdea: snapshot.project.coreIdea.value,
    protagonist: protagonist?.name ?? null,
    goal: protagonist?.goal.value ?? null,
    worldRule: snapshot.worldRules[0]?.description ?? null,
    conflict: snapshot.conflict,
    style: snapshot.project.narrativeStyle.value,
    adultMode: snapshot.project.adultMode,
    adultExperienceProfile: snapshot.project.adultExperienceProfile ?? null,
  };
}

const FAMILY_STAGE_INTERNAL_LORE_PATTERN = /(?:世界契約|題材契約|所屬家族\s*ID|contractStatement|canonicalStatus|VIRTUAL_CANDIDATE|schemaVersion|十因果維度)/iu;

function loreDisplayParts(entry: LoreEntry) {
  const [prefix, ...rest] = entry.title.split("｜").map((value) => value.trim()).filter(Boolean);
  return {
    prefix: prefix || entry.kind,
    name: rest.join("｜") || prefix || entry.title,
  };
}

function readerSafeLoreContent(value: string) {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !FAMILY_STAGE_INTERNAL_LORE_PATTERN.test(line))
    .join("\n")
    .replace(/(?:social-(?:family|institution)-[^\s，。；、)）]+|[\da-f]{8,}-[\da-f-]{20,})/giu, "既有勢力")
    .trim();
}

export function readerSafeOrganizationLoreContent(value: string) {
  const lines = readerSafeLoreContent(value).split(/\r?\n/u);
  const safeLines: string[] = [];
  let relationshipBlock: string[] | null = null;
  const flushRelationship = () => {
    if (!relationshipBlock) return;
    const hidden = relationshipBlock.some((line) => /強度\s*[：:].*未公開/u.test(line));
    if (!hidden) {
      safeLines.push(...relationshipBlock.filter((line) => (
        !/^(?:幕後動機|強度)\s*[：:]/u.test(line)
      )));
    }
    relationshipBlock = null;
  };
  for (const line of lines) {
    if (/^-\s*[^\n]+\uff5c對象\s*[：:]/u.test(line)) {
      flushRelationship();
      relationshipBlock = [line];
      continue;
    }
    if (relationshipBlock && /^(?:階層、房系與資產|名冊規則)\s*[：:]/u.test(line)) {
      flushRelationship();
      safeLines.push(line);
      continue;
    }
    if (relationshipBlock) {
      relationshipBlock.push(line);
      continue;
    }
    if (/^(?:幕後動機|隱藏衝突)\s*[：:]/u.test(line)) continue;
    safeLines.push(line);
  }
  flushRelationship();
  return safeLines.join("\n").trim();
}

function loreField(content: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = content.match(new RegExp(`(?:^|[；;\\n])\\s*${escaped}\\s*[：:]\\s*([^；;\\n。]+)`, "u"));
  return match?.[1]?.trim() || null;
}

function firstLoreNarrativeLine(content: string) {
  return content.split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line && !/^[^：:]{1,12}[：:]/u.test(line)) ?? "";
}

function cleanLoreEntityName(value: string | null | undefined) {
  return value
    ?.replace(/（[^）]*）/gu, "")
    .replace(/[。；;，,：:\s]+$/gu, "")
    .trim() || null;
}

type FamilyStageOrganizationNarrative = {
  id: string;
  kind: string;
  name: string;
  situation: string;
  territory: string | null;
  doctrine: string | null;
  publicGoal: string | null;
  hiddenConflict: string | null;
  allies: string | null;
  rivals: string | null;
  controlledAssets: string | null;
  contestedAssets: string | null;
  relationships: Array<{
    kind: string;
    counterpart: string;
    cause: string | null;
    history: string | null;
    currentStatus: string | null;
    publicStance: string | null;
    secretMotive: string | null;
    publiclyKnown: boolean;
  }>;
};

function organizationRelationshipLore(content: string): FamilyStageOrganizationNarrative["relationships"] {
  const blocks = content.split(/(?=^-\s*[^\n]+\uff5c對象\s*[：:])/gmu);
  return blocks.flatMap((block) => {
    const heading = block.match(/^-\s*([^\uff5c\n]+)\uff5c對象\s*[：:]\s*([^\n]+)/mu);
    if (!heading) return [];
    const visibility = loreField(block, "強度") ?? "";
    return [{
      kind: heading[1]!.trim(),
      counterpart: heading[2]!.trim(),
      cause: loreField(block, "起因"),
      history: loreField(block, "歷史"),
      currentStatus: loreField(block, "現況"),
      publicStance: loreField(block, "公開立場"),
      secretMotive: loreField(block, "幕後動機"),
      publiclyKnown: !visibility.includes("未公開"),
    }];
  }).slice(0, 8);
}

type FamilyStageAssetNarrative = {
  id: string;
  category: string;
  name: string;
  storyHook: string;
  controller: string | null;
  holder: string | null;
  claimant: string | null;
  function: string | null;
  limitation: string | null;
  cost: string | null;
  visualDescription: string | null;
  holderCharacterId: string | null;
  stakeholderCharacterIds: string[];
  controllerOrganizationId: string | null;
  claimantOrganizationId: string | null;
};

function buildFamilyStageNarrativeContext(input: {
  lore: readonly LoreEntry[];
  storyState: StoryState;
}) {
  const loreById = new Map(input.lore.map((entry) => [entry.id, entry] as const));
  const flags = storyWorldFlags(input.storyState);
  const selectedFamilyId = typeof flags["story.selectedFamilyId"] === "string"
    ? String(flags["story.selectedFamilyId"])
    : null;
  const factionLore = input.lore.filter((entry) => entry.kind === "faction");
  const selectedFamilyLore = (selectedFamilyId ? loreById.get(selectedFamilyId) : null)
    ?? factionLore.find((entry) => loreDisplayParts(entry).prefix === "上場家族")
    ?? null;
  const organizationLore = factionLore.filter((entry) => entry.id !== selectedFamilyLore?.id);
  const organizations: FamilyStageOrganizationNarrative[] = organizationLore.map((entry) => {
    const safeContent = readerSafeLoreContent(entry.content);
    const modelSafeContent = readerSafeOrganizationLoreContent(entry.content);
    const parts = loreDisplayParts(entry);
    return {
      id: entry.id,
      kind: parts.prefix,
      name: parts.name,
      situation: firstLoreNarrativeLine(modelSafeContent),
      territory: loreField(modelSafeContent, "領域"),
      doctrine: loreField(modelSafeContent, "內部準則"),
      publicGoal: loreField(modelSafeContent, "公開目標"),
      hiddenConflict: null,
      allies: loreField(modelSafeContent, "盟友"),
      rivals: loreField(modelSafeContent, "對手"),
      controlledAssets: loreField(modelSafeContent, "控制"),
      contestedAssets: loreField(modelSafeContent, "爭奪"),
      relationships: organizationRelationshipLore(safeContent)
        .filter((relationship) => relationship.publiclyKnown)
        .map((relationship) => ({ ...relationship, secretMotive: null })),
    };
  });
  const organizationByName = new Map(organizations.map((organization) => [organization.name, organization] as const));
  const assets: FamilyStageAssetNarrative[] = input.lore
    .filter((entry) => entry.kind === "item")
    .map((entry) => {
      const safeContent = readerSafeLoreContent(entry.content);
      const parts = loreDisplayParts(entry);
      const controller = cleanLoreEntityName(loreField(safeContent, "控制勢力"));
      const claimant = cleanLoreEntityName(loreField(safeContent, "聲索勢力"));
      return {
        id: entry.id,
        category: parts.prefix,
        name: parts.name,
        storyHook: firstLoreNarrativeLine(safeContent),
        controller,
        holder: cleanLoreEntityName(loreField(safeContent, "持有人")),
        claimant,
        function: loreField(safeContent, "作用"),
        limitation: loreField(safeContent, "限制"),
        cost: loreField(safeContent, "代價"),
        visualDescription: loreField(safeContent, "外觀"),
        holderCharacterId: entry.proceduralTreasureProfile?.holderCharacterId ?? null,
        stakeholderCharacterIds: entry.proceduralTreasureProfile?.stakeholderCharacterIds ?? [],
        controllerOrganizationId: controller ? organizationByName.get(controller)?.id ?? null : null,
        claimantOrganizationId: claimant ? organizationByName.get(claimant)?.id ?? null : null,
      };
    });
  const selectedStageFamily = selectedFamilyLore ? {
    id: selectedFamilyLore.id,
    name: loreDisplayParts(selectedFamilyLore).name,
    introduction: firstLoreNarrativeLine(readerSafeLoreContent(selectedFamilyLore.content)),
    standing: loreField(readerSafeLoreContent(selectedFamilyLore.content), "家族位置"),
    stagePremise: loreField(readerSafeLoreContent(selectedFamilyLore.content), "上場前提"),
    controlledAssets: loreField(readerSafeLoreContent(selectedFamilyLore.content), "掌握資產"),
  } : null;
  const prioritizedLore = [
    ...organizationLore,
    ...(selectedFamilyLore ? [selectedFamilyLore] : []),
    ...input.lore.filter((entry) => entry.kind === "item"),
    ...input.lore.filter((entry) => entry.kind !== "faction" && entry.kind !== "item").slice(-7),
  ].filter((entry, index, values) => values.findIndex((candidate) => candidate.id === entry.id) === index);
  return {
    loreById,
    selectedStageFamily,
    organizations,
    assets,
    readerSafeLore: prioritizedLore.slice(0, 20).map((entry) => ({
      kind: entry.kind,
      title: entry.title,
      content: entry.kind === "faction"
        ? readerSafeOrganizationLoreContent(entry.content)
        : readerSafeLoreContent(entry.content),
    })),
  };
}

function qualitativeCapabilityScore(score: number) {
  if (score >= 90) return "已臻專精";
  if (score >= 75) return "高度熟練";
  if (score >= 60) return "能穩定運用";
  if (score >= 40) return "具備實用基礎";
  return "仍在入門階段";
}

function qualitativeCapabilityEffect(multiplier: number) {
  if (multiplier >= 1.25) return "能形成顯著助力";
  if (multiplier >= 1.08) return "能形成有利助力";
  if (multiplier >= 0.95) return "通常能穩定發揮";
  if (multiplier >= 0.8) return "在此條件下略受限制";
  return "在此條件下明顯受制";
}

function readerSafeCharacterNarrativeFact(value: string | null | undefined) {
  if (!value?.trim()) return "";
  return value.trim()
    .replace(/力量層級\s*[：:]\s*([^；;，,\n]+)/gu, (_match, tier: string) => `整體實戰經驗已達${tier.trim()}層次`)
    .replace(/(修行|武力|謀略|洞察|醫藥|技藝|領導|影響力)\s*[：:]?\s*(-?\d+)\s*\/\s*100/gu, (_match, label: string, score: string) => `${label}${qualitativeCapabilityScore(Number(score))}`)
    .replace(/熟練\s*[：:]?\s*(-?\d+)\s*\/\s*100/gu, (_match, score: string) => `熟練程度${qualitativeCapabilityScore(Number(score))}`)
    .replace(/實效\s*[：:]?\s*[×x]\s*(\d+(?:\.\d+)?)/giu, (_match, multiplier: string) => `實際運用時${qualitativeCapabilityEffect(Number(multiplier))}`)
    .replace(/((?:五行)?(?:同屬|相生|相剋|受生|受剋))\s*[：:]?\s*[×x]\s*(\d+(?:\.\d+)?)/giu, (_match, relation: string, multiplier: string) => `${relation}${qualitativeCapabilityEffect(Number(multiplier))}`)
    .replace(/時代\s*[：:]?\s*ancient/giu, "適用於古代背景")
    .replace(/時代\s*[：:]?\s*early-modern/giu, "適用於近代背景")
    .replace(/時代\s*[：:]?\s*modern/giu, "適用於現代背景")
    .replace(/時代\s*[：:]?\s*future/giu, "適用於未來背景")
    .replace(/五行\s*[：:]?\s*([金木水火土])/gu, "五行屬$1")
    .replace(/-?\d+\s*\/\s*100/gu, "已依既有程度判斷")
    .replace(/[×x]\s*\d+(?:\.\d+)?/giu, "依條件增減")
    .replace(/；\s*；/gu, "；")
    .replace(/^[；;，,\s]+|[；;，,\s]+$/gu, "")
    .trim();
}

export function buildRpgReaderSafeCharacterContext(character: Character) {
  return {
    capabilities: [...new Set((character.capabilities ?? [])
      .map((capability) => readerSafeCharacterNarrativeFact(capability))
      .filter(Boolean))],
    limitations: [...new Set((character.limitations ?? [])
      .map((limitation) => readerSafeCharacterNarrativeFact(limitation))
      .filter(Boolean))],
    actionMastery: characterNarrativeMastery(character),
  };
}

const RPG_ACTIVE_CHARACTER_FLAG_KEYS = [
  "story.activeSupportingCharacterId",
  "story.activeCounterforceCharacterId",
  "story.activeWitnessCharacterId",
  "story.activeStageAssetHolderCharacterId",
] as const;

function characterMentioned(character: Character, value: string) {
  return [character.name, ...(character.aliases ?? [])]
    .map((name) => name.trim())
    .filter((name) => name.length >= 2)
    .some((name) => value.includes(name));
}

/**
 * Selects prompt-visible supporting actors by story relevance instead of
 * repository order. All comparator dimensions end in the immutable record id,
 * so shuffled IndexedDB listings produce the same cast window.
 */
export function selectRpgDirectorSupportingCharacters(input: {
  characters: readonly Character[];
  protagonistId?: string | null;
  storyState: StoryState;
  relationships: readonly CharacterRelationship[];
  chapter: Chapter;
  timeline: readonly TimelineEvent[];
  acceptedChoices: readonly AcceptedChoice[];
  maximum?: number;
}) {
  const flags = storyWorldFlags(input.storyState);
  const explicitlyActiveIds: string[] = [];
  const addActiveId = (value: unknown) => {
    if (typeof value !== "string") return;
    for (const id of value.split("|").map((item) => item.trim()).filter(Boolean)) {
      if (!explicitlyActiveIds.includes(id)) explicitlyActiveIds.push(id);
    }
  };
  for (const key of RPG_ACTIVE_CHARACTER_FLAG_KEYS) addActiveId(flags[key]);
  addActiveId(flags["story.recentSupportingActors"]);
  const stagedIds = [...new Set(input.storyState.activeCharacterIds ?? [])];
  const recentChoiceTexts = latestAcceptedChoices(input.acceptedChoices, 12)
    .reverse()
    .map((choice) => `${choice.choiceLabel ?? ""}\n${choice.acceptedText}`);
  const recentAppearanceTexts = [
    input.chapter.content.slice(-2_400),
    ...stableTimelineOrder(input.timeline).slice(-12).reverse()
      .map((event) => `${event.title}\n${event.summary}`),
    ...recentChoiceTexts,
  ].filter(Boolean);
  const connectedTo = new Set([
    ...(input.protagonistId ? [input.protagonistId] : []),
    ...explicitlyActiveIds,
  ]);
  const score = (character: Character) => {
    const explicitIndex = explicitlyActiveIds.indexOf(character.id);
    const choiceMentionIndex = recentChoiceTexts.findIndex((text) =>
      characterMentioned(character, text));
    const recentMentionIndex = recentAppearanceTexts.findIndex((text) =>
      characterMentioned(character, text));
    const stagedIndex = stagedIds.indexOf(character.id);
    let relationshipWeight = 0;
    for (const relationship of input.relationships) {
      const otherId = relationship.fromCharacterId === character.id
        ? relationship.toCharacterId
        : relationship.toCharacterId === character.id
          ? relationship.fromCharacterId
          : null;
      if (!otherId) continue;
      relationshipWeight += connectedTo.has(otherId) ? 4 : 1;
      if (otherId === input.protagonistId) relationshipWeight += 4;
    }
    return {
      explicitIndex,
      choiceMentionIndex,
      recentMentionIndex,
      stagedIndex,
      relationshipWeight,
    };
  };
  const ranked = input.characters
    .filter((character) => character.id !== input.protagonistId)
    .map((character) => ({ character, score: score(character) }))
    .sort((left, right) => {
      const compareOptionalIndex = (a: number, b: number) => (
        (a < 0 ? Number.MAX_SAFE_INTEGER : a)
        - (b < 0 ? Number.MAX_SAFE_INTEGER : b)
      );
      return compareOptionalIndex(left.score.explicitIndex, right.score.explicitIndex)
        || compareOptionalIndex(left.score.choiceMentionIndex, right.score.choiceMentionIndex)
        || compareOptionalIndex(left.score.recentMentionIndex, right.score.recentMentionIndex)
        || right.score.relationshipWeight - left.score.relationshipWeight
        || compareOptionalIndex(left.score.stagedIndex, right.score.stagedIndex)
        || left.character.id.localeCompare(right.character.id);
    });
  return ranked.slice(0, Math.max(0, input.maximum ?? 10)).map(({ character }) => character);
}

function buildDirectorContext(input: {
  project: NovelProject;
  chapter: Chapter;
  chapters: Chapter[];
  storyState: StoryState;
  storyBible: StoryBible;
  characters: Character[];
  relationships: CharacterRelationship[];
  worldRules: WorldRule[];
  lore: LoreEntry[];
  timeline: TimelineEvent[];
  acceptedChoices: AcceptedChoice[];
  rpgTurnReceipts: RpgTurnReceipt[];
  playMode: StoryPlayModeId;
  progressionMode: RpgMode;
  language: StoryOutputLanguage;
  progression: RpgProgressionSnapshot;
  conflict: string;
}) {
  const worldFlags = storyWorldFlags(input.storyState);
  const familyStage = buildFamilyStageNarrativeContext({
    lore: input.lore,
    storyState: input.storyState,
  });
  const protagonist = input.characters.find((character) =>
    input.storyBible.protagonistIds.includes(character.id))
    ?? input.characters[0]
    ?? null;
  const protagonistStoryProfile = protagonist
    ? buildRpgReaderSafeCharacterContext(protagonist)
    : null;
  const nameById = new Map(input.characters.map((character) => [character.id, character.name]));
  const supportingCharacters = selectRpgDirectorSupportingCharacters({
    characters: input.characters,
    protagonistId: protagonist?.id,
    storyState: input.storyState,
    relationships: input.relationships,
    chapter: input.chapter,
    timeline: input.timeline,
    acceptedChoices: input.acceptedChoices,
    maximum: 10,
  });
  const stagedCharacters = [
    ...(protagonist ? [protagonist] : []),
    ...supportingCharacters,
  ].slice(0, 14);
  const stagedFamilyMap = new Map<string, {
    family: string | null;
    faction: string | null;
    members: string[];
  }>();
  for (const character of stagedCharacters) {
    const affiliation = characterNarrativeAffiliation(character, familyStage.loreById);
    if (!affiliation.affiliationKey) continue;
    const current = stagedFamilyMap.get(affiliation.affiliationKey) ?? {
      family: affiliation.familyLabel,
      faction: affiliation.factionLabel,
      members: [],
    };
    if (!current.members.includes(character.name)) current.members.push(character.name);
    stagedFamilyMap.set(affiliation.affiliationKey, current);
  }
  return {
    project: {
      title: input.project.title,
      coreIdea: input.project.coreIdea.value,
      genre: input.project.genreId,
      narrativeStyle: input.project.narrativeStyle.value,
      language: input.language,
      fixedPlayMode: input.playMode,
      fixedPlayModeLabel: STORY_PLAY_MODE_LABELS[input.playMode],
    },
    currentChapter: {
      id: input.chapter.id,
      title: input.chapter.title,
      order: input.chapter.order,
      revision: input.chapter.revision,
      recentText: input.chapter.content.trim()
        ? input.chapter.content.slice(-1_200)
        : "故事尚無正文。",
    },
    currentConflict: input.conflict,
    previousChapters: [...input.chapters]
      .filter((item) => item.order <= input.chapter.order)
      .sort((left, right) => left.order - right.order)
      .slice(-3)
      .map((item) => ({
        id: item.id,
        order: item.order,
        title: item.title,
        status: item.status,
        recentText: item.content.slice(-700),
      })),
    storyBible: {
      theme: input.storyBible.theme.value,
      style: input.storyBible.style.value,
      foreshadowing: input.storyBible.foreshadowing.slice(-8),
      unresolvedThreads: input.storyBible.unresolvedThreads.slice(-10),
      forbiddenContradictions: input.storyBible.forbiddenContradictions.slice(-10),
      authorPreferences: input.storyBible.authorPreferences.slice(-8),
    },
    protagonist: protagonist ? {
      name: protagonist.name,
      identity: protagonist.identity.value,
      personality: protagonist.personality.value,
      goal: protagonist.goal.value,
      values: protagonist.values ?? [],
      capabilities: protagonistStoryProfile?.capabilities ?? [],
      limitations: protagonistStoryProfile?.limitations ?? [],
      actionMastery: protagonistStoryProfile?.actionMastery ?? null,
      family: characterNarrativeAffiliation(protagonist, familyStage.loreById).familyLabel,
      faction: characterNarrativeAffiliation(protagonist, familyStage.loreById).factionLabel,
    } : null,
    supportingCharacters: supportingCharacters
      .map((character) => {
        const affiliation = characterNarrativeAffiliation(character, familyStage.loreById);
        const storyProfile = buildRpgReaderSafeCharacterContext(character);
        return {
          name: character.name,
          identity: character.identity.value,
          personality: character.personality.value,
          goal: character.goal.value,
          capabilities: storyProfile.capabilities.slice(0, 5),
          limitations: storyProfile.limitations.slice(0, 3),
          actionMastery: storyProfile.actionMastery,
          family: affiliation.familyLabel,
          faction: affiliation.factionLabel,
        };
      }),
    stagedFamilies: [...stagedFamilyMap.values()].slice(0, 8),
    selectedStageFamily: familyStage.selectedStageFamily ? {
      name: familyStage.selectedStageFamily.name,
      introduction: familyStage.selectedStageFamily.introduction,
      standing: familyStage.selectedStageFamily.standing,
      stagePremise: familyStage.selectedStageFamily.stagePremise,
      controlledAssets: familyStage.selectedStageFamily.controlledAssets,
    } : null,
    stagedOrganizations: familyStage.organizations.map((organization) => {
      const { id, hiddenConflict, relationships, ...serializedOrganization } = organization;
      void id;
      void hiddenConflict;
      return {
        ...serializedOrganization,
        relationships: relationships.map(({ secretMotive, ...readerSafeRelationship }) => {
          void secretMotive;
          return readerSafeRelationship;
        }),
      };
    }),
    stagedAssets: familyStage.assets.map((asset) => ({
      category: asset.category,
      name: asset.name,
      storyHook: asset.storyHook,
      controller: asset.controller,
      holder: asset.holder,
      claimant: asset.claimant,
      function: asset.function,
      limitation: asset.limitation,
      cost: asset.cost,
      visualDescription: asset.visualDescription,
    })),
    relationships: input.relationships.slice(-16).map((relationship) => ({
      from: nameById.get(relationship.fromCharacterId) ?? "未登錄人物",
      to: nameById.get(relationship.toCharacterId) ?? "未登錄人物",
      kind: relationship.kind,
      summary: relationship.summary,
      trust: relationship.trust,
    })),
    worldRules: input.worldRules.map((rule) => ({
      title: rule.title,
      description: rule.description,
      immutable: rule.immutable,
    })),
    lore: familyStage.readerSafeLore,
    timeline: stableTimelineOrder(input.timeline).slice(-12).map((event) => ({
      storyTime: event.storyTime,
      title: event.title,
      summary: event.summary,
    })),
    recentAcceptedChoices: latestAcceptedChoices(input.acceptedChoices, 8).map((choice) => ({
      label: choice.choiceLabel,
      text: choice.acceptedText.slice(0, 520),
    })),
    recentRpgTurnReceipts: input.rpgTurnReceipts.slice(0, 3).map((receipt) => ({
      receiptId: receipt.receiptId,
      turnNumber: receipt.turnNumber,
      choiceKey: receipt.choiceKey,
      choiceTitle: receipt.choiceTitle,
      strategy: receipt.selectedStrategy,
      outcome: receipt.outcome,
      successChance: receipt.successChance,
      appliedResourceChanges: receipt.appliedResourceChanges ?? {},
      appliedMeterChanges: receipt.appliedMeterChanges,
      realmChange: receipt.appliedRealmChanges,
    })),
    lockedStoryState: {
      time: input.storyState.timeState,
      location: input.storyState.locationState,
      risk: input.storyState.riskState,
      money: input.storyState.money,
      reputation: input.storyState.reputation,
      stats: input.progression.stats,
      status: input.progression.status,
      currencies: input.progression.currencies,
      inventory: input.progression.inventory
        .filter((item) => item.quantity > 0)
        .map((item) => ({ id: item.itemId, name: item.name, quantity: item.quantity, usable: Boolean(item.useEffect || item.proceduralPill), effect: item.effectDescription })),
      quests: input.storyState.questStates,
      revision: input.storyState.revision,
      rawResources: input.storyState.resources,
      relationships: input.storyState.relationships,
      realm: input.progression.rpgState.realm,
      realmProgress: input.progression.rpgState.realm?.progress ?? 0,
      cultivationDerived: input.progression.cultivationDerived,
      narrativeMeters: input.progression.rpgState.meters,
      strategicAssets: input.progression.rpgState.strategicAssets,
      pendingConsequences: input.progression.rpgState.pendingConsequences,
      factionFlags: Object.fromEntries(Object.entries(worldFlags)
        .filter(([key]) => key.startsWith("faction."))),
      contentMechanics: Object.fromEntries(Object.entries(worldFlags)
        .filter(([key]) => key.startsWith("xianxia.mingtan."))),
      factionStandings: input.storyState.factionStanding,
      resourceConstraints: RPG_RESOURCE_CATALOG_V3.map((resource) => ({
        id: resource.id,
        name: resource.localizedName,
        type: resource.type,
        nonNegative: resource.nonNegative,
      })),
      day: input.progression.day,
      turn: input.progression.turn,
      fixedPlayMode: input.playMode,
      progressionMode: input.progressionMode,
    },
  };
}

export async function loadRpgChatSnapshot(
  repository: NovelRepository,
  projectId: string,
  rules: RpgRuleSettings = DEFAULT_RPG_RULE_SETTINGS,
  learningRepository?: SovereignLearningRepository,
): Promise<RpgChatSnapshot> {
  const project = await repository.get<NovelProject>("projects", projectId);
  if (!project || project.deletedAt) {
    throw Object.assign(new Error("找不到這個作品。"), {
      code: "RPG_CHAT_PROJECT_NOT_FOUND",
    });
  }
  const [rawChapters, rawStates, rawBibles, rawCharacters, rawRelationships, rawWorlds, rawWorldRules, rawLore, rawTimeline, rawAcceptedChoices, rawRpgTurnReceipts] = await Promise.all([
    repository.list<Chapter>("chapters", projectId),
    repository.list<StoryState>("storyStates", projectId),
    repository.list<StoryBible>("storyBibles", projectId),
    repository.list<Character>("characters", projectId),
    repository.list<CharacterRelationship>("relationships", projectId),
    repository.list<World>("worlds", projectId),
    repository.list<WorldRule>("worldRules", projectId),
    repository.list<LoreEntry>("lore", projectId),
    repository.list<TimelineEvent>("timeline", projectId),
    repository.listAcceptedChoices(projectId),
    repository.list<RpgTurnReceipt>("rpgTurnReceipts", projectId),
  ]);
  // IndexedDB and imported repositories do not promise list order. Establish
  // one canonical set before any recent-window slicing or prompt composition.
  const chapters = stableChapterOrder(rawChapters);
  const states = stableRecordOrder(rawStates);
  const bibles = stableRecordOrder(rawBibles);
  const allCharacters = stableRecordOrder(rawCharacters);
  const allRelationships = stableRecordOrder(rawRelationships);
  const allWorlds = stableRecordOrder(rawWorlds);
  const allWorldRules = stableRecordOrder(rawWorldRules);
  const allLore = stableRecordOrder(rawLore);
  const allTimeline = stableTimelineOrder(rawTimeline);
  const acceptedChoices = stableAcceptedChoiceOrder(rawAcceptedChoices);
  const rpgTurnReceipts = stableRpgTurnReceiptOrder(rawRpgTurnReceipts);
  const chapter = chapters.find((item) => item.id === project.activeChapterId)
    ?? [...chapters].sort((left, right) => left.order - right.order).at(-1)
    ?? null;
  let storyState = states.find((item) => item.id === project.storyStateId) ?? states[0] ?? null;
  const storyBible = resolveProjectStoryBible(project, bibles);
  if (!chapter || !storyState || !storyBible) {
    throw Object.assign(new Error("作品缺少章節、故事狀態或 Story Bible。"), {
      code: "RPG_CHAT_CANON_CONTEXT_INCOMPLETE",
    });
  }
  const { characters } = activeStoryCast({
    project,
    storyBible,
    storyState,
    worldRules: allWorldRules,
    worlds: allWorlds,
    characters: allCharacters,
  });
  const relationships = activeStoryRelationships(allRelationships, characters);
  const worldRules = activeStoryWorldRules(allWorldRules, storyState, storyBible);
  const lore = activeStoryLore(allLore, storyState, storyBible);
  const timeline = activeStoryTimeline(allTimeline, storyState, storyBible);
  const playMode = resolveStoryPlayMode(storyState);
  const mode = progressionMode(playMode);
  const protagonist = characters.find((character) =>
    storyBible.protagonistIds.includes(character.id)) ?? characters[0] ?? null;
  const baselineSeed = `${project.title}|${protagonist?.name ?? ""}`;
  const materialized = isGameStoryPlayMode(playMode)
    ? materializeRpgStoryStateBaseline(storyState, baselineSeed, mode)
    : storyState;
  if (materialized !== storyState) {
    try {
      storyState = await repository.put("storyStates", materialized, storyState.revision);
    } catch (error) {
      // React development retries or two tabs may race this idempotent migration.
      // Re-read once: a completed baseline is success; a newer incomplete state
      // receives one normal optimistic-concurrency retry. Storage failures still
      // surface instead of being disguised as a playable snapshot.
      const latest = await repository.get<StoryState>("storyStates", storyState.id);
      if (!latest || latest.revision === storyState.revision) throw error;
      const latestMaterialized = materializeRpgStoryStateBaseline(latest, baselineSeed, mode);
      storyState = latestMaterialized === latest
        ? latest
        : await repository.put("storyStates", latestMaterialized, latest.revision);
    }
  }
  const progression = readRpgProgression(
    storyState,
    baselineSeed,
    mode,
  );
  const conflict = extractLastCompleteNarrativeSentences(
    chapter.content,
    chapter.summary?.trim()
      || storyBible.unresolvedThreads.at(-1)?.trim()
      || project.coreIdea.value?.trim()
      || "目前局勢",
    420,
  );
  const language = storyLanguage(storyState);
  const emptyCausalKnowledge = {
    snapshotVersion: APPROVED_LEARNING_CONTEXT_SNAPSHOT_VERSION,
    snapshotDigest: await sha256Hex(stableStringify({
      snapshotVersion: APPROVED_LEARNING_CONTEXT_SNAPSHOT_VERSION,
      projectId,
      taskType: "three_choices",
      maximumRules: 8,
      selectedRuleIds: [],
    })),
    selectedRuleIds: [],
    instructions: [],
    causalSignals: [],
    maximumRules: 8 as const,
    entireLibraryScanned: false as const,
  };
  const causalKnowledge = learningRepository?.isAvailable()
    ? await buildApprovedLearningContext({
      repository: learningRepository,
      projectId,
      taskType: "three_choices",
      maximumRules: 8,
    }).then((context) => ({
      snapshotVersion: context.snapshotVersion,
      snapshotDigest: context.snapshotDigest,
      selectedRuleIds: context.selectedRuleIds,
      instructions: context.instructions,
      causalSignals: context.causalSignals,
      maximumRules: 8 as const,
      entireLibraryScanned: false as const,
    })).catch(() => emptyCausalKnowledge)
    : emptyCausalKnowledge;
  const directorContext = freezeRpgDirectorContext({
    ...buildDirectorContext({
    project,
    chapter,
    chapters,
    storyState,
    storyBible,
    characters,
    relationships,
    worldRules,
    lore,
    timeline,
    acceptedChoices,
    rpgTurnReceipts,
    playMode,
    progressionMode: mode,
    language,
    progression,
    conflict,
    }),
    closedCausalTeacherKnowledge: {
      snapshotVersion: causalKnowledge.snapshotVersion,
      snapshotDigest: causalKnowledge.snapshotDigest,
      instructions: [...causalKnowledge.instructions],
      selectedRuleIds: [...causalKnowledge.selectedRuleIds],
      selectedRuleCount: causalKnowledge.selectedRuleIds.length,
      selection: "approved-indexed-top-k",
      maximumRules: causalKnowledge.maximumRules,
      entireLibraryScanned: false,
    },
  });
  const contextDigest = await sha256Hex(stableStringify(directorContext));
  const contextRevisionGuard = await buildRpgContextRevisionGuard({
    projects: [project],
    chapters,
    storyStates: [...states.filter((item) => item.id !== storyState.id), storyState],
    storyBibles: bibles,
    characters: allCharacters,
    relationships: allRelationships,
    worlds: allWorlds,
    worldRules: allWorldRules,
    lore: allLore,
    timeline: allTimeline,
    acceptedChoices,
    rpgTurnReceipts,
  });
  const contextRevisionDigest = contextRevisionGuard.digest;
  const fallbackThread = storyBible.unresolvedThreads.at(-1)?.trim()
    || "先前留下的承諾仍未得到回答";
  const storyArc = readStoryArcRuntime({
    storyState,
    projectId: project.id,
    progressionTurn: progression.turn,
    fallbackGoal: conflict,
    fallbackThread,
  });
  const remainingThread = storyBible.unresolvedThreads
    .find((thread) => thread.trim() && thread.trim() !== storyArc.thread)?.trim();
  const familyStageNarrative = buildFamilyStageNarrativeContext({ lore, storyState });
  const firstStagedOrganization = familyStageNarrative.organizations[0] ?? null;
  const firstStagedAsset = familyStageNarrative.assets[0] ?? null;
  const latestTurnReceipt = rpgTurnReceipts[0] ?? null;
  const recentStoryBeat = chapter.content.trim()
    ? extractLastCompleteNarrativeSentences(chapter.content, conflict, 180)
    : conflict;
  const latestOutcomeLabel = latestTurnReceipt
    ? ({
        critical_success: "關鍵成功",
        success: "成功",
        partial_success: "部分成功",
        failure: "失敗但留下新線索",
      } as const)[latestTurnReceipt.outcome]
    : null;
  const evolvingConflict = latestTurnReceipt
    ? `上一個選擇「${latestTurnReceipt.choiceTitle}」已造成${latestOutcomeLabel}的具體後果；${recentStoryBeat}`
    : recentStoryBeat;
  const activeSupportingName = typeof storyState.worldFlags?.["story.activeSupportingCharacterName"] === "string"
    ? String(storyState.worldFlags["story.activeSupportingCharacterName"]).trim()
    : "";
  const continuation = storyArc.resolved ? {
    thread: remainingThread ?? "結案後果引發的新責任、新對手與下一個期限",
    goal: remainingThread
      ? `在不重開舊結局的前提下，處理「${remainingThread}」`
      : "承接已完成結局留下的關係與局勢後果，建立下一卷的新目標",
  } : undefined;
  const generatedBaseChoices = buildRpgChoices({
    progression,
    protagonist: protagonist?.name ?? "主角",
    chapterTitle: chapter.title,
    // The arc goal stays locked in the encounter contract.  Choice copy must
    // instead start from the latest accepted consequence, otherwise every
    // round reprints the first-round problem with different decorative nouns.
    conflict: storyArc.resolved ? conflict : evolvingConflict,
    mode,
    playMode,
    variant: progression.choiceVariant,
    seed: `${project.id}|${storyState.revision}|${causalKnowledge.selectedRuleIds.join("|")}`,
    rules,
    storyStateRevision: storyState.revision,
    storyState,
    narrativeAnchors: {
      supportingCharacter: activeSupportingName
        || characters.find((character) =>
          !storyBible.protagonistIds.includes(character.id))?.name
        || null,
      familyOrFaction: familyStageNarrative.selectedStageFamily?.name
        ?? firstStagedOrganization?.name
        ?? null,
      storyAsset: firstStagedAsset?.name ?? null,
      factionPressure: firstStagedOrganization?.hiddenConflict
        ?? firstStagedOrganization?.rivals
        ?? firstStagedAsset?.claimant
        ?? null,
      unresolvedThread: storyArc.resolved
        ? storyBible.unresolvedThreads.find((thread) => thread.trim() !== storyArc.thread) ?? null
        : storyArc.thread,
      worldContext: [
        project.genrePackId,
        project.genreId,
        project.subgenreId,
        project.coreIdea.value,
        storyBible.theme.value,
      ].filter(Boolean).join("｜"),
    },
    causalKnowledgeDigest: causalKnowledge.selectedRuleIds.length
      ? causalKnowledge.snapshotDigest
      : undefined,
  });
  const arcBoundChoices = bindStoryArcToChoices(generatedBaseChoices, storyArc, continuation);
  const baseChoices = playMode === "romance"
    ? arcBoundChoices.map((choice) => ({
        ...choice,
        title: romanceSafeProceduralText(choice.title),
        description: romanceSafeProceduralText(choice.description),
        acceptedText: romanceSafeProceduralText(choice.acceptedText),
        consequenceTeaser: romanceSafeProceduralText(choice.consequenceTeaser),
        impactLabels: choice.impactLabels.map(romanceSafeProceduralText),
        costLabels: choice.costLabels.map(romanceSafeProceduralText),
        encounter: adaptProceduralEncounterForRomance(choice.encounter),
      }))
    : arcBoundChoices;
  return {
    schemaVersion: RPG_CHAT_TURN_SCHEMA_VERSION,
    project,
    chapter,
    chapters,
    storyState,
    storyBible,
    characters,
    relationships,
    worldRules,
    lore,
    timeline,
    acceptedChoices,
    rpgTurnReceipts,
    playMode,
    progressionMode: mode,
    language,
    progression,
    conflict,
    directorContext,
    contextDigest,
    contextRevisionDigest,
    contextRevisionGuard,
    causalKnowledge,
    baseChoices,
  };
}

export async function loadLearningAwareRpgChatSnapshot(input: {
  repository: NovelRepository;
  projectId: string;
  rules?: RpgRuleSettings;
  learningRepository: SovereignLearningRepository;
  ensureSharedLearningReady?: (signal?: AbortSignal) => Promise<unknown>;
  signal?: AbortSignal;
}) {
  if (input.ensureSharedLearningReady) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    await Promise.race([
      Promise.resolve()
        .then(() => input.ensureSharedLearningReady?.(input.signal))
        .catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, RPG_SHARED_LEARNING_SYNC_WAIT_MS);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }
  return loadRpgChatSnapshot(
    input.repository,
    input.projectId,
    input.rules ?? DEFAULT_RPG_RULE_SETTINGS,
    input.learningRepository,
  );
}

export async function planRpgChatChoices(input: {
  snapshot: RpgChatSnapshot;
  signal?: AbortSignal;
  onProgress?: (event: ClosedAIProgressEvent) => void;
  /** Complete deadline reserved for closed-AI choice planning. Defaults to 180 seconds. */
  choiceDeadlineMs?: number;
  closedAIInvoker?: (
    request: Parameters<typeof runStudioClosedAI>[0],
  ) => ReturnType<typeof runStudioClosedAI>;
}): Promise<RpgChatChoicePlan> {
  const flags = storyWorldFlags(input.snapshot.storyState);
  if (
    flags["story.arc.archived"] === true
    || isPostArcChoiceSet(input.snapshot.baseChoices)
  ) {
    return buildRpgRuleChoicePlan({
      snapshot: input.snapshot,
      fallbackReason: flags["story.arc.archived"] === true
        ? "STORY_ARC_ARCHIVED_TERMINAL"
        : "STORY_ARC_POST_CLOSURE_ACTIONS",
    });
  }
  assertThreePlayableChoices(input.snapshot.baseChoices);
  const seed = (
    input.snapshot.storyState.revision * 997
    + input.snapshot.progression.turn * 131
    + input.snapshot.progression.choiceVariant * 17
  ) >>> 0;
  const enhancementController = new AbortController();
  const relayAbort = () => enhancementController.abort(input.signal?.reason);
  if (input.signal?.aborted) relayAbort();
  else input.signal?.addEventListener("abort", relayAbort, { once: true });
  const choiceDeadlineMs = Math.max(
    1,
    input.choiceDeadlineMs ?? RPG_CHAT_CHOICE_AI_TIMEOUT_MS,
  );
  const enhancementTimeout = setTimeout(() => {
    enhancementController.abort("RPG_CHOICE_AI_ENHANCEMENT_TIMEOUT");
  }, choiceDeadlineMs);
  const invokeClosedAI = input.closedAIInvoker ?? ((request: Parameters<typeof runStudioClosedAI>[0]) => (
    runStudioClosedAI(request)
  ));
  try {
    const readerSafeCausalContracts = input.snapshot.baseChoices.map((choice) => ({
      key: choice.key,
      contract: buildRpgReaderSafeCausalPayload({ snapshot: input.snapshot, choice }),
    }));
    const result = await invokeClosedAI({
      projectId: input.snapshot.project.id,
      task: "three_choices",
      input: buildRpgChoiceDirectorPrompt({
        context: input.snapshot.directorContext,
        baseChoices: input.snapshot.baseChoices,
        language: input.snapshot.language,
        readerSafeCausalContracts,
      }),
      sourceChapterId: input.snapshot.chapter.id,
      sourceRevision: input.snapshot.chapter.revision,
      // A playable A/B/C card claims that this request reached a real closed
      // model. A verified candidate-cache hit truthfully reports
      // actualExecutor=not_executed, so it cannot satisfy that claim. Bypass
      // prompt/candidate caches here and require retries after navigation to
      // reach the model again; the proof gate below remains fail-closed.
      ephemeralPrompt: true,
      qualityMode: "fast",
      browserComputePolicy: "balanced",
      generationOptions: {
        maxTokens: 520,
        temperature: 0.82,
        topP: 0.94,
        repetitionPenalty: 1.16,
        seed,
      },
      signal: enhancementController.signal,
      onProgress: input.onProgress,
    });
    let proof: ReturnType<typeof assertFreshRpgChoiceExecutionProof>;
    try {
      proof = assertFreshRpgChoiceExecutionProof({
        result,
        chapter: input.snapshot.chapter,
      });
    } catch (error) {
      if (result.candidateId) {
        await rejectStudioClosedAgentCandidate(result.candidateId).catch(() => undefined);
      }
      throw error;
    }
    let choices: RpgDirectedChoice[];
    try {
      choices = mergeRpgChoiceDirection(
        input.snapshot.baseChoices,
        parseRpgChoiceDirectorOutput(result.content),
      );
    } catch (error) {
      await rejectStudioClosedAgentCandidate(proof.candidateId).catch(() => undefined);
      throw error;
    }
    return {
      schemaVersion: RPG_CHAT_TURN_SCHEMA_VERSION,
      choices,
      taskId: result.taskId,
      candidateId: proof.candidateId,
      contentDigest: result.contentDigest,
      model: result.model,
      modelDigest: proof.modelDigest,
      actualExecutor: result.actualExecutor,
      executionReceipt: withCausalKnowledgeReceipt(proof.executionReceipt, input.snapshot),
      contextDigest: input.snapshot.contextDigest,
      contextRevisionDigest: input.snapshot.contextRevisionDigest,
      contextRevisionGuard: structuredClone(input.snapshot.contextRevisionGuard),
      canonicalMutationCount: 0,
      dataLeftDevice: false,
      externalRequest: false,
    };
  } catch (error) {
    const errorCode = String((error as { code?: unknown } | null)?.code ?? "");
    if (
      errorCode === "CLOSED_AI_REQUIRED_BACKEND_NOT_READY"
      && !enhancementController.signal.aborted
    ) {
      // A temporarily unavailable local backend is not permission to fabricate
      // an immediate rules result. Keep the same operation pending so the
      // existing UI control can explicitly request fallback, while the existing
      // 180-second deadline remains the only automatic fallback path.
      await new Promise<void>((resolve) => {
        enhancementController.signal.addEventListener("abort", () => resolve(), { once: true });
      });
    }
    const fallbackReason = rpgChoiceRuleFallbackReason({
      error,
      requestAbortReason: input.signal?.reason,
      enhancementAbortReason: enhancementController.signal.reason,
    });
    if (!fallbackReason) throw error;
    return buildRpgRuleChoicePlan({
      snapshot: input.snapshot,
      fallbackReason,
    });
  } finally {
    clearTimeout(enhancementTimeout);
    input.signal?.removeEventListener("abort", relayAbort);
  }
}

export function assertFreshRpgChoiceExecutionProof(input: {
  result: Awaited<ReturnType<typeof runStudioClosedAI>>;
  chapter: Pick<Chapter, "id" | "revision">;
}) {
  const { result } = input;
  const executionReceipt = result.executionReceipt;
  if (
    !hasVerifiedExecutedStoryOutput(result)
    || result.cache.candidateHit
    || !result.candidateId
    || !result.modelDigest
    || !executionReceipt
    || executionReceipt.proofState !== "verified"
    || executionReceipt.taskId !== result.taskId
    || executionReceipt.backendId !== result.provider
    || executionReceipt.actualExecutor !== result.provider
    || executionReceipt.modelId !== result.model
    || executionReceipt.modelDigest !== result.modelDigest
    || executionReceipt.contentDigest !== result.contentDigest
    || executionReceipt.outputCharacters <= 0
    || executionReceipt.externalRequest
    || executionReceipt.dataLeftDevice
    || result.sourceChapterId !== input.chapter.id
    || result.sourceRevision !== input.chapter.revision
    || result.canonicalMutationCount !== 0
    || result.externalRequest
    || result.dataLeftDevice
  ) {
    throw Object.assign(new Error("閉端 AI 選項缺少真實模型或來源章節證明。"), {
      code: "RPG_CHAT_CHOICE_PROOF_MISSING",
    });
  }
  return {
    candidateId: result.candidateId,
    modelDigest: result.modelDigest,
    executionReceipt,
  };
}

export function buildRpgChatCustomAction(input: {
  snapshot: RpgChatSnapshot;
  action: string;
  rules?: RpgRuleSettings;
}) {
  if (!input.snapshot.progression.rpgState.customActionEnabled) {
    throw Object.assign(new Error("目前預設已關閉自訂行動，請從正式三選一中選擇。"), {
      code: "RPG_CUSTOM_ACTION_DISABLED",
    });
  }
  const protagonist = input.snapshot.characters.find((character) =>
    input.snapshot.storyBible.protagonistIds.includes(character.id))
    ?? input.snapshot.characters[0]
    ?? null;
  const causalKnowledge = normalizedCausalKnowledge(input.snapshot);
  return buildCustomRpgChoice({
    progression: input.snapshot.progression,
    action: input.action,
    protagonist: protagonist?.name ?? "主角",
    chapterTitle: input.snapshot.chapter.title,
    conflict: input.snapshot.conflict,
    rules: input.rules ?? DEFAULT_RPG_RULE_SETTINGS,
    storyState: input.snapshot.storyState,
    causalKnowledgeDigest: causalKnowledge.selectedRuleIds.length
      ? causalKnowledge.snapshotDigest
      : undefined,
  });
}

export function validateRpgOutcomeNarrative(
  story: string,
  resolution: Pick<RpgChoiceResolution, "outcome" | "effect" | "settlement">,
  language: StoryOutputLanguage,
  choice?: Pick<RpgChoice, "title" | "description">,
) {
  const forbiddenNumberClaim = /(?:靈石|灵石|金幣|金币|行動點|行动点|經驗值|经验值|生命值|HP|氣運|气运|道心|心魔)\s*(?:增加|減少|减少|獲得|获得|失去|消耗|[+＋-－])?\s*\d+/iu;
  if (forbiddenNumberClaim.test(story)) {
    throw Object.assign(new Error("RPG_AI_STORY_INVENTED_NUMERIC_EFFECT"), {
      code: "RPG_AI_STORY_INVENTED_NUMERIC_EFFECT",
    });
  }
  const normalizedStory = story.normalize("NFKC").toLocaleLowerCase();
  const containsAny = (patterns: readonly string[]) => patterns.some((value) => normalizedStory.includes(value));
  if (choice && language !== "zh-CN") {
    const normalizedAction = `${choice.title} ${choice.description}`.normalize("NFKC").toLocaleLowerCase();
    const actionTokens = normalizedAction
      .split(/[\s，,。.!！?？、:：；;｜|／/()（）「」『』]+/gu)
      .flatMap((part) => {
        const characters = Array.from(part);
        if (characters.length < 3) return [];
        return Array.from({ length: Math.max(1, characters.length - 2) }, (_, index) =>
          characters.slice(index, index + 3).join(""));
      })
      .filter((token) => token.length >= 3);
    if (actionTokens.length && !actionTokens.some((token) => normalizedStory.includes(token))) {
      throw new Error("RPG_AI_STORY_SELECTED_ACTION_MISSING");
    }
  }
  if (resolution.outcome === "failure" && !containsAny(
    language === "en"
      ? ["failed", "did not", "could not", "fell short", "blocked"]
      : ["失敗", "失败", "未能", "沒能", "没能", "落空", "受阻"],
  )) throw new Error("RPG_AI_STORY_OUTCOME_MISMATCH");
  if (resolution.outcome === "partial_success" && !containsAny(
    language === "en"
      ? ["partial", "only part", "cost", "but", "not fully"]
      : ["部分", "只完成", "代價", "代价", "卻", "却", "未能全"],
  )) throw new Error("RPG_AI_STORY_OUTCOME_MISMATCH");
  if (
    (resolution.outcome === "success" || resolution.outcome === "critical_success")
    && containsAny(language === "en"
      ? ["complete failure", "nothing was achieved", "entirely failed"]
      : ["徹底失敗", "彻底失败", "一無所獲", "一无所获", "完全落空"])
  ) throw new Error("RPG_AI_STORY_OUTCOME_MISMATCH");
  const claimsRealmAdvancement = (
    /(?:突破|晉升|晋升|踏入|升至|升到)(?:到了|進入|进入|成為|成为|了|至|到|入|為|为)?(?:煉體|炼体|煉氣|炼气|練氣|练气|開脈|开脉|築基|筑基|金丹|元嬰|元婴|化神|煉虛|炼虚|返虛|返虚|合體|合体|大乘|渡劫|真仙|天仙|玄仙|金仙|仙王|仙帝)(?:境|期)?/u.test(story)
    || /(?:突破|晉升|晋升|踏入|升至|升到)(?:到了|進入|进入|成為|成为|了|至|到|入|為|为)?(?:修為|修为|境界|下一(?:個|个)?境|更高(?:的)?境|新境|階位|阶位|等級|等级|層次|层次)/u.test(story)
  );
  if (claimsRealmAdvancement && !resolution.settlement.realmChange?.breakthrough) {
    throw new Error("RPG_AI_STORY_UNAPPROVED_REALM_ADVANCEMENT");
  }
  const claimsNewFormalItem = /(?:獲得|获得|取得|拾得|煉成|炼成|領到|领到).{0,18}(?:丹|劍|剑|法寶|法宝|靈石|灵石|符|陣旗|阵旗)/u.test(story);
  const hasApprovedItemGain = Object.entries(resolution.effect.resourceChanges ?? {})
    .some(([key, value]) => value > 0 && (key.startsWith("item.") || key.startsWith("currency.") || key.startsWith("material.")));
  if (claimsNewFormalItem && !hasApprovedItemGain) {
    throw new Error("RPG_AI_STORY_UNAPPROVED_FORMAL_ITEM");
  }
  return true;
}

const CONTEXT_INSTRUCTION_LEAK_PATTERN = /(?:NEXT TURN|下一步選擇|可能收益\s*[：:]|已知代價\s*[：:]|規則校準|本回合(?:目標|結算)|隊伍正在觀察主角是否願意承擔選擇後果|若唯一方案需要剝奪第三方的選擇權|若行動只服務個人勝負而非原定目標|若主角要求隱瞞無辜者會承受的代價)/iu;
const CONTEXT_DATABASE_LEAK_PATTERN = /(?:組織關係網|公開立場|幕後動機|力量層級|能力值|熟練|實效|倍率|加成|增益|衰減)\s*[：:]|(?:五行)?(?:同屬|相生|相剋|受生|受剋)\s*[：:]?\s*x\s*\d|(?:^|\D)-?\d+\s*\/\s*100|×\s*\d+(?:\.\d+)?/iu;

function safeNarrativeFallback(value: string | null | undefined, maximum: number) {
  const compact = value?.normalize("NFC").replace(/\s+/gu, " ").trim() ?? "";
  if (
    compact
    && compact.length <= maximum
    && !CONTEXT_INSTRUCTION_LEAK_PATTERN.test(compact)
    && !/^[，。、；：」』）】的了著而與及並卻]/u.test(compact)
  ) return compact.replace(/[。！？!?]+$/u, "");
  return "眼前局勢已經發生變化";
}

/**
 * Returns only complete reader-facing sentences from the end of accepted
 * prose.  It never starts an RPG turn from an arbitrary character offset.
 */
export function extractLastCompleteNarrativeSentences(
  value: string | null | undefined,
  fallback = "眼前局勢已經發生變化",
  maximum = 420,
) {
  const boundedMaximum = Math.max(24, maximum);
  const completeSentences = (value?.normalize("NFC") ?? "")
    .replace(/```[\s\S]*?```/gu, " ")
    .match(/[^\n。！？!?]+[。！？!?][」』”"]?/gu)
    ?.map((sentence) => sentence.replace(/\s+/gu, " ").trim())
    .filter((sentence) => (
      sentence.length >= 8
      && sentence.length <= boundedMaximum
      && !/^〈[^〉]+〉$/u.test(sentence)
      && !CONTEXT_INSTRUCTION_LEAK_PATTERN.test(sentence)
      && !/^[，。、；：」』）】的了著而與及並卻]/u.test(sentence)
    )) ?? [];
  const selected: string[] = [];
  let length = 0;
  for (let index = completeSentences.length - 1; index >= 0; index -= 1) {
    const sentence = completeSentences[index]!;
    if (length + sentence.length > boundedMaximum) break;
    selected.unshift(sentence);
    length += sentence.length;
    if (selected.length >= 2) break;
  }
  return selected.join("") || safeNarrativeFallback(fallback, boundedMaximum);
}

function narrativeFact(value: string | null | undefined, fallback: string, maximum = 56) {
  const compact = value?.replace(/\s+/gu, " ").trim() || fallback;
  return Array.from(compact).slice(0, maximum).join("");
}

function embeddedNarrativeFact(value: string) {
  return value.replace(/[。！？!?；;：:]+$/u, "").trim();
}

function quotationSafeNarrativeFact(value: string) {
  return embeddedNarrativeFact(value)
    .replace(/[「」『』“”"]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function readableAffiliationName(value: string | null | undefined) {
  const compact = value?.replace(/\s+/gu, " ").trim() ?? "";
  if (
    !compact
    || compact.length > 32
    || compact.includes(":")
    || /^social-(?:family|institution)-/iu.test(compact)
    || /^[\da-f]{8,}(?:-[\da-f-]+)?$/iu.test(compact)
  ) return null;
  return narrativeFact(compact, "", 32) || null;
}

function affiliationNameFromLore(
  affiliationId: string | null,
  loreById?: ReadonlyMap<string, LoreEntry>,
) {
  if (!affiliationId) return null;
  const lore = loreById?.get(affiliationId);
  if (!lore || lore.kind !== "faction") return null;
  return loreDisplayParts(lore).name || null;
}

function inferredFamilyName(
  character: Character,
  familyId: string,
  loreById?: ReadonlyMap<string, LoreEntry>,
) {
  const canonical = affiliationNameFromLore(familyId, loreById);
  if (canonical) return canonical;
  const readable = readableAffiliationName(familyId);
  if (readable) return readable;
  const firstHan = Array.from(character.name).find((letter) => /[\u3400-\u9fff]/u.test(letter));
  return firstHan ? `${firstHan}氏家族` : `${narrativeFact(character.name, "該角色", 16)}家族`;
}

function inferredFactionName(
  character: Character,
  factionId: string,
  loreById?: ReadonlyMap<string, LoreEntry>,
) {
  const canonical = affiliationNameFromLore(factionId, loreById);
  if (canonical) return canonical;
  const readable = readableAffiliationName(factionId);
  if (readable) return readable;
  const identity = character.identity?.value?.replace(/\s+/gu, " ").trim() ?? "";
  const identityFaction = identity.match(/同時隸屬([^，。；、]{2,18})/u)?.[1]?.trim()
    ?? identity.match(/^([^，。；、]{2,18}?)(?:的|門下|所屬|成員|弟子|代表)/u)?.[1]?.trim();
  return identityFaction && identityFaction !== character.name
    ? identityFaction
    : null;
}

function characterNarrativeAffiliation(
  character: Character | null | undefined,
  loreById?: ReadonlyMap<string, LoreEntry>,
) {
  const familyId = character?.socialMatrixProfile?.familyId?.trim() || null;
  const factionId = character?.socialMatrixProfile?.institutionId?.trim()
    || character?.factionIds?.find((value) => value.trim() && value !== familyId)?.trim()
    || null;
  const familyLabel = character && familyId
    ? inferredFamilyName(character, familyId, loreById)
    : null;
  const factionLabel = character && factionId
    ? inferredFactionName(character, factionId, loreById)
    : null;
  return {
    familyId,
    factionId,
    familyLabel,
    factionLabel,
    affiliationKey: familyId
      ? `family:${familyId}`
      : factionId
        ? `faction:${factionId}`
        : null,
  };
}

function stageDistinctAffiliations(
  characters: readonly Character[],
  turn: number,
  loreById?: ReadonlyMap<string, LoreEntry>,
) {
  if (!characters.length) return [];
  const rotated = characters.map((_, index) => characters[(turn + index) % characters.length]);
  const staged: Character[] = [];
  const stagedIds = new Set<string>();
  const affiliationKeys = new Set<string>();
  for (const character of rotated) {
    const key = characterNarrativeAffiliation(character, loreById).affiliationKey;
    if (!key || affiliationKeys.has(key)) continue;
    staged.push(character);
    stagedIds.add(character.id);
    affiliationKeys.add(key);
    if (staged.length === 3) return staged;
  }
  for (const character of rotated) {
    if (stagedIds.has(character.id)) continue;
    staged.push(character);
    stagedIds.add(character.id);
    if (staged.length === 3) break;
  }
  return staged;
}

function relationshipNarrativeBetween(
  relationships: readonly CharacterRelationship[] | undefined,
  firstId: string | undefined,
  secondId: string | undefined,
) {
  if (!firstId || !secondId) return null;
  const relationship = (relationships ?? []).find((candidate) => (
    candidate.fromCharacterId === firstId && candidate.toCharacterId === secondId
  ) || (
    candidate.fromCharacterId === secondId && candidate.toCharacterId === firstId
  ));
  if (!relationship) return null;
  const summary = narrativeFact(relationship.summary || relationship.kind, relationship.kind, 44);
  return CONTEXT_DATABASE_LEAK_PATTERN.test(summary)
    ? narrativeFact(relationship.kind, "彼此仍有一筆未清的舊帳", 28)
    : summary;
}

function naturalRoleDialogue(name: string, narrativeRole: ProceduralCastRole) {
  const lines: Record<ProceduralCastRole, readonly string[]> = {
    catalyst: [
      `${name}低聲說：「傷者先走，我留在這裡。」隨即將側門鑰匙推到桌邊。`,
      `${name}說：「給我一點時間，別讓他們碰那只箱子。」說完已經捲起衣袖。`,
      `${name}壓低聲音說：「先看門口。剛才少了一雙鞋。」`,
    ],
    counterforce: [
      `${name}喝道：「停手，你漏看了一個人。」同時用鞋尖抵住門閂。`,
      `${name}說：「這條路不對，墨還沒有乾。」隨即把證詞翻到背面。`,
      `${name}問道：「先回答，代價會落在誰身上？」說完仍沒有讓開。`,
    ],
    witness: [
      `${name}說：「封泥是新的。」並攤開掌心裡的碎屑。`,
      `${name}低聲說：「兩份口供差了一刻鐘。」隨即把那一行圈了出來。`,
      `${name}說：「我看見他換過袖套。」同時指向窗下留下的水痕。`,
    ],
  };
  return chooseDeterministicProse(`${name}|${narrativeRole}|voice`, lines[narrativeRole]);
}

function existingCharacterAsCandidate(
  character: Character | null | undefined,
  fallback: ProceduralCharacterCandidate,
  narrativeRole: ProceduralCastRole,
): ProceduralCharacterCandidate {
  if (!character) return fallback;
  const name = embeddedNarrativeFact(narrativeFact(character.name, fallback.name, 24)) || fallback.name;
  const goal = quotationSafeNarrativeFact(narrativeFact(
    readerSafeCharacterNarrativeFact(character.goal?.value),
    fallback.goal,
    36,
  ));
  const personality = readerSafeCharacterNarrativeFact(character.personality?.value) || fallback.personality;
  const limitation = quotationSafeNarrativeFact(narrativeFact(
    readerSafeCharacterNarrativeFact(character.limitations?.find((value) => value.trim())),
    fallback.refusalCondition,
    40,
  ));
  return {
    ...fallback,
    id: character.id,
    name,
    personality,
    goal,
    refusalCondition: limitation,
    proactiveAction: fallback.proactiveAction.replace(fallback.name, name),
    directDialogue: naturalRoleDialogue(name, narrativeRole),
    portrait: character.portrait ? {
      baseId: character.portrait.id,
      assetUri: character.portrait.assetUri,
      atlasCell: character.portrait.atlas
        ? character.portrait.atlas.row * character.portrait.atlas.columns + character.portrait.atlas.column
        : 0,
      visualSeed: character.portrait.assetDigest,
      visualDescription: character.portrait.visualDescription,
    } : fallback.portrait,
  };
}

type CharacterNarrativeMastery = {
  relation: "使用" | "製作" | "持有" | "栽培" | "專長";
  name: string;
  era: "ancient" | "early-modern" | "modern" | "future" | null;
  element: "金" | "木" | "水" | "火" | "土" | null;
  proficiency: string | null;
  practicalEffect: string | null;
  limitation: string | null;
};

function characterNarrativeMastery(
  character: Character | null | undefined,
): CharacterNarrativeMastery | null {
  if (!character) return null;
  const structured = (character.capabilities ?? []).map((capability) => ({
    capability,
    match: capability.match(/^(會使用|會製作|持有|栽培)[^「]{0,40}「([^」]{1,80})」/u),
  })).find((candidate) => candidate.match);
  if (structured?.match) {
    const relation = structured.match[1] === "會使用"
      ? "使用"
      : structured.match[1] === "會製作"
        ? "製作"
        : structured.match[1] === "持有"
          ? "持有"
          : "栽培";
    const name = structured.match[2]!.trim();
    const eraMatch = structured.capability.match(/；\s*時代\s+(ancient|early-modern|modern|future)(?:；|$)/iu);
    const elementMatch = structured.capability.match(/；\s*五行\s+([金木水火土])(?:；|$)/u);
    const proficiencyMatch = structured.capability.match(/熟練\s*(-?\d+)\s*\/\s*100/u);
    const effectMatch = structured.capability.match(/實效\s*[×x]\s*(\d+(?:\.\d+)?)/iu);
    const limitation = (character.limitations ?? []).find((candidate) => candidate.includes(name)) ?? null;
    return {
      relation,
      name,
      era: (eraMatch?.[1]?.toLowerCase() as CharacterNarrativeMastery["era"] | undefined) ?? null,
      element: (elementMatch?.[1] as CharacterNarrativeMastery["element"] | undefined) ?? null,
      proficiency: proficiencyMatch
        ? qualitativeCapabilityScore(Number(proficiencyMatch[1]))
        : null,
      practicalEffect: effectMatch
        ? qualitativeCapabilityEffect(Number(effectMatch[1]))
        : null,
      limitation: limitation ? readerSafeCharacterNarrativeFact(limitation) : null,
    };
  }
  const plain = (character.capabilities ?? []).find((capability) => (
    capability.trim().length >= 2
    && !/(?:力量層級|\d+\s*\/\s*100|實效\s*[×x])/u.test(capability)
  ));
  return plain ? {
    relation: "專長",
    name: narrativeFact(readerSafeCharacterNarrativeFact(plain), plain, 42),
    era: null,
    element: null,
    proficiency: null,
    practicalEffect: null,
    limitation: character.limitations?.[0]
      ? readerSafeCharacterNarrativeFact(character.limitations[0])
      : null,
  } : null;
}

function deterministicTurnContext(snapshot: RpgChatSnapshot) {
  const flags = storyWorldFlags(snapshot.storyState);
  const familyStage = buildFamilyStageNarrativeContext({
    lore: snapshot.lore ?? [],
    storyState: snapshot.storyState,
  });
  const protagonist = snapshot.characters.find((character) =>
    snapshot.storyBible.protagonistIds.includes(character.id))
    ?? snapshot.characters[0]
    ?? null;
  const existingSupporting = snapshot.characters.filter((character) => character.id !== protagonist?.id);
  const explicitlyActiveSupportingId = typeof flags["story.activeSupportingCharacterId"] === "string"
    ? String(flags["story.activeSupportingCharacterId"]).trim()
    : "";
  const explicitlyActiveSupportingName = typeof flags["story.activeSupportingCharacterName"] === "string"
    ? String(flags["story.activeSupportingCharacterName"]).trim()
    : "";
  const explicitlyActiveSupporting = existingSupporting.find((character) => (
    (explicitlyActiveSupportingId && character.id === explicitlyActiveSupportingId)
    || (explicitlyActiveSupportingName && character.name === explicitlyActiveSupportingName)
  )) ?? null;
  const inventory = snapshot.progression.inventory.find((item) => item.quantity > 0) ?? null;
  const location = narrativeFact(snapshot.storyState.locationState, "目前場景");
  const arcGoal = narrativeFact(
    typeof flags["story.arc.goal"] === "string"
      ? String(flags["story.arc.goal"])
      : snapshot.conflict,
    `${snapshot.chapter.title}仍有必須處理的阻力`,
  );
  // snapshot.conflict already carries the last accepted choice and the tail of
  // the current chapter. Prefer it for the scene in front of the reader; the
  // arc goal remains available separately for continuity. Reusing arcGoal here
  // made every fallback chapter reopen the original problem.
  const conflict = narrativeFact(snapshot.conflict, arcGoal, 64);
  const turn = Math.max(0, Math.trunc(snapshot.progression.turn));
  const scenario = proceduralCharacterTreasureScenarioAt({
    seed: `${snapshot.project.id}|${snapshot.chapter.id}|${snapshot.playMode}`,
    ordinal: (Math.floor(turn / 3) * 7_919 + existingSupporting.length * 101) % PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
    context: {
      genre: [snapshot.project.genrePackId, snapshot.project.genreId, snapshot.project.subgenreId]
        .filter(Boolean).join(" "),
      playMode: snapshot.playMode,
      storyTags: snapshot.lore?.slice(0, 6).map((entry) => `${entry.kind}:${entry.title}`) ?? [],
      protagonist: protagonist?.name,
      location,
      conflict,
    },
  });
  const affiliationStagedSupporting = stageDistinctAffiliations(
    existingSupporting,
    turn,
    familyStage.loreById,
  );
  const stagedExisting = explicitlyActiveSupporting
    ? [
        explicitlyActiveSupporting,
        ...affiliationStagedSupporting.filter(
          (character) => character.id !== explicitlyActiveSupporting.id,
        ),
      ].slice(0, 3)
    : affiliationStagedSupporting;
  const rotatedProcedural = scenario.cast.members.map((_, index) =>
    scenario.cast.members[(turn + index) % scenario.cast.members.length]);
  const supporting = existingCharacterAsCandidate(stagedExisting[0], rotatedProcedural[0], "catalyst");
  const counterforce = existingCharacterAsCandidate(stagedExisting[1], rotatedProcedural[1], "counterforce");
  const witness = existingCharacterAsCandidate(stagedExisting[2], rotatedProcedural[2], "witness");
  const castAffiliations = {
    supporting: characterNarrativeAffiliation(stagedExisting[0], familyStage.loreById),
    counterforce: characterNarrativeAffiliation(stagedExisting[1], familyStage.loreById),
    witness: characterNarrativeAffiliation(stagedExisting[2], familyStage.loreById),
  };
  const castRelationships = {
    supporting: relationshipNarrativeBetween(
      snapshot.relationships,
      protagonist?.id,
      stagedExisting[0]?.id,
    ),
    counterforce: relationshipNarrativeBetween(
      snapshot.relationships,
      protagonist?.id,
      stagedExisting[1]?.id,
    ),
    witness: relationshipNarrativeBetween(
      snapshot.relationships,
      protagonist?.id,
      stagedExisting[2]?.id,
    ),
  };
  const stagedCharacterIds = new Set([
    protagonist?.id,
    ...stagedExisting.map((character) => character.id),
  ].filter((value): value is string => Boolean(value)));
  const stagedAssetCandidates = familyStage.assets.filter((asset) =>
    Boolean(asset.holderCharacterId && stagedCharacterIds.has(asset.holderCharacterId)));
  const assetPool = stagedAssetCandidates.length ? stagedAssetCandidates : familyStage.assets;
  const stageAsset = assetPool.length
    ? assetPool[(turn + existingSupporting.length) % assetPool.length]!
    : null;
  const stageAssetLore = stageAsset ? familyStage.loreById.get(stageAsset.id) : null;
  const holderRelationship = stageAsset
    ? [
        stageAsset.controller ? `${stageAsset.controller}掌控` : null,
        stageAsset.holder ? `${stageAsset.holder}持有` : null,
        stageAsset.claimant && stageAsset.claimant !== "無其他聲索者"
          ? `${stageAsset.claimant}另有聲索`
          : null,
      ].filter(Boolean).join("，")
    : null;
  const treasure = stageAsset ? {
    ...scenario.treasure,
    id: stageAsset.id,
    ordinal: stageAssetLore?.proceduralTreasureProfile?.ordinal ?? scenario.treasure.ordinal,
    name: stageAsset.name,
    category: stageAsset.category,
    holderRelationship: holderRelationship || scenario.treasure.holderRelationship,
    function: stageAsset.function || scenario.treasure.function,
    limitation: stageAsset.limitation || scenario.treasure.limitation,
    cost: stageAsset.cost || scenario.treasure.cost,
    visualDescription: stageAsset.visualDescription || scenario.treasure.visualDescription,
  } : scenario.treasure;
  const activeFamilyIds = [
    familyStage.selectedStageFamily?.id,
    ...Object.values(castAffiliations).map((affiliation) => affiliation.familyId),
  ].filter((value): value is string => Boolean(value));
  const activeFactionIds = [
    stageAsset?.controllerOrganizationId,
    stageAsset?.claimantOrganizationId,
    ...Object.values(castAffiliations).map((affiliation) => affiliation.factionId),
  ].filter((value): value is string => Boolean(value));
  return {
    protagonist: protagonist?.name
      ?? (snapshot.language === "en" ? "The protagonist" : "主角"),
    protagonistMastery: characterNarrativeMastery(protagonist),
    supporting: supporting.name,
    supportingCharacter: supporting,
    counterforce,
    witness,
    castAffiliations,
    castRelationships,
    activeFamilyIds,
    activeFactionIds,
    selectedStageFamily: familyStage.selectedStageFamily,
    stagedOrganizations: familyStage.organizations,
    stageAsset,
    scenario,
    conflict,
    arcGoal,
    unresolved: narrativeFact(
      typeof flags["story.arc.thread"] === "string"
        ? String(flags["story.arc.thread"])
        : snapshot.storyBible.unresolvedThreads.at(-1),
      "先前留下的承諾仍未得到回答",
    ),
    location,
    inventory: inventory?.name ?? "現有資源",
    storyProp: stageAsset?.name ?? inventory?.name ?? scenario.treasure.name,
    treasure,
  };
}

function countConsecutiveRpgSetbacks(receipts: readonly RpgTurnReceipt[]) {
  let count = 0;
  for (const receipt of receipts) {
    if (receipt.outcome === "failure" || receipt.outcome === "partial_success") count += 1;
    else break;
  }
  return count;
}

type RpgCausalInferenceDimension = keyof ReturnType<
  typeof buildProceduralCausalFrame
>["inferenceDimensions"];

const STORY_LIBRARY_CAUSAL_TARGET: Record<
  ProceduralCausalDimensionId,
  RpgCausalInferenceDimension
> = {
  trigger: "catalyst",
  desire: "goal",
  agency: "pressure",
  relationship: "leverage",
  resource: "resourceProp",
  stance: "relationshipTension",
  price: "cost",
  constraint: "deadline",
  refusal: "reversal",
  consequence: "aftermath",
};

/** One causal contract is shared by closed-AI direction and rules fallback. */
export function buildRpgTurnCausalContract(input: {
  snapshot: RpgChatSnapshot;
  choice: RpgChoice;
  outcome?: RpgChoiceResolution["outcome"];
}) {
  const context = deterministicTurnContext(input.snapshot);
  const causalKnowledge = normalizedCausalKnowledge(input.snapshot);
  const causalSignals = input.snapshot.playMode === "romance"
    ? (causalKnowledge?.causalSignals ?? []).map((signal) => ({
        ...signal,
        statement: romanceSafeProceduralText(signal.statement),
        operation: romanceSafeProceduralText(signal.operation),
        constraint: romanceSafeProceduralText(signal.constraint),
        evaluate: romanceSafeProceduralText(signal.evaluate),
      }))
    : causalKnowledge?.causalSignals ?? [];
  const arc = readStoryArcRuntime({
    storyState: input.snapshot.storyState,
    projectId: input.snapshot.project.id,
    progressionTurn: input.snapshot.progression.turn,
    fallbackGoal: context.conflict,
    fallbackThread: context.unresolved,
  });
  const crossCausalDimensions = Object.fromEntries(
    context.scenario.causalDimensions.map((dimension) => [
      STORY_LIBRARY_CAUSAL_TARGET[dimension.id],
      dimension.signal,
    ]),
  ) as Partial<ReturnType<typeof buildProceduralCausalFrame>["inferenceDimensions"]>;
  return buildProceduralCausalFrame({
    encounter: input.choice.encounter,
    protagonist: context.protagonist,
    supportingCharacter: context.supporting,
    location: context.location,
    conflict: input.choice.encounter.arcGoal ?? context.conflict,
    unresolvedThread: input.choice.encounter.arcThread ?? context.unresolved,
    availableResource: context.inventory,
    outcome: input.outcome,
    consecutiveSetbacks: countConsecutiveRpgSetbacks(input.snapshot.rpgTurnReceipts ?? []),
    arcKey: input.choice.encounter.arcKey ?? arc.key,
    turn: input.choice.encounter.arcLocalTurn ?? arc.localTurn,
    arcHorizon: input.choice.encounter.arcHorizon ?? arc.horizon,
    approvedEnding: arc.ending.isEnding,
    relationshipScenarioId: context.scenario.id,
    crossCausalDimensions,
    causalKnowledge: causalKnowledge.selectedRuleIds.length ? {
      snapshotVersion: causalKnowledge.snapshotVersion,
      snapshotDigest: causalKnowledge.snapshotDigest,
      selectedRuleIds: causalKnowledge.selectedRuleIds,
      signals: causalSignals,
      maximumRules: causalKnowledge.maximumRules,
      entireLibraryScanned: false,
    } : undefined,
  });
}

/**
 * The rules engine keeps the complete bounded-arc contract internally.  Closed
 * AI receives only reader-visible continuity, prose dimensions, and directions
 * that are already available on the current screen.
 */
export function buildRpgReaderSafeCausalPayload(input: {
  snapshot: RpgChatSnapshot;
  choice: RpgChoice;
  outcome?: RpgChoiceResolution["outcome"];
}) {
  const contract = buildRpgTurnCausalContract(input);
  const disclosure = contract.persistentArc.readerDisclosure;
  const mayRevealCurrentDirections = disclosure.mayRevealClosureChoices
    || disclosure.mayRevealPostEndingActions;
  const currentDirections = mayRevealCurrentDirections
    ? input.snapshot.baseChoices.map((choice) => {
        const safeChoice = buildRpgReaderSafeChoicePayload(choice);
        return {
          key: safeChoice.key,
          title: safeChoice.title,
          description: safeChoice.description,
          consequenceTeaser: safeChoice.consequenceTeaser,
        };
      })
    : [];
  const consequence = mayRevealCurrentDirections
    ? `${contract.inferenceDimensions.reversal}${contract.inferenceDimensions.aftermath}${disclosure.readerBeat}`
    : contract.consequenceBeat;
  return toRpgReaderSafePromptPayload({
    continuity: {
      goal: contract.persistentArc.goal,
      unresolvedThread: contract.persistentArc.unresolvedThread,
      currentStoryBeat: disclosure.readerBeat,
      currentDirections,
    },
    narrativeDimensions: contract.inferenceDimensions,
    sceneBeats: {
      inciting: contract.incitingBeat,
      pressure: contract.pressureBeat,
      opportunity: contract.opportunityBeat,
      consequence,
    },
    progressSupport: {
      progress: contract.hopeGuard.progressBeat,
      recovery: contract.hopeGuard.recoveryBeat,
    },
  });
}

export function buildRpgOutcomeLines(choice: RpgChoice, resolution: RpgChoiceResolution) {
  return [
    `行動結果：${choice.key === "custom" ? "自由行動" : choice.key}｜${choice.title}｜${resolution.outcomeLabel}`,
    `收益：${choice.impactLabels.join("、") || "保留可繼續推進的線索"}`,
    `代價：${choice.costLabels.join("、") || choice.consequenceTeaser}`,
    `規則判定：${resolution.roll}/${resolution.successChance}；正式數值只會在你核准正文後一次寫入。`,
  ];
}

function compactDeterministicCausalDimension(value: string, maximum = 44) {
  const normalized = value
    .normalize("NFC")
    .replace(/核准規則校準\s*[：:]\s*/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized || CONTEXT_INSTRUCTION_LEAK_PATTERN.test(normalized)) return "";
  if (normalized.length <= maximum) return embeddedNarrativeFact(normalized);
  const completeClause = normalized
    .split(/(?<=[。！？!?；;])/u)
    .map((clause) => clause.trim())
    .find((clause) => clause.length >= 8 && clause.length <= maximum);
  if (completeClause) return embeddedNarrativeFact(completeClause);
  const prefix = sliceDeterministicText(normalized, maximum);
  const boundary = Math.max(
    prefix.lastIndexOf("，"),
    prefix.lastIndexOf(","),
    prefix.lastIndexOf("、"),
    prefix.lastIndexOf("；"),
    prefix.lastIndexOf(";"),
  );
  return boundary >= 12 ? embeddedNarrativeFact(prefix.slice(0, boundary)) : "";
}

function sliceDeterministicText(value: string, maximum: number) {
  let output = "";
  for (const character of value) {
    if (output.length + character.length > maximum) break;
    output += character;
  }
  return output;
}

function compactDeterministicCausalDimensions(
  dimensions: ReturnType<typeof buildRpgTurnCausalContract>["inferenceDimensions"],
) {
  return {
    catalyst: compactDeterministicCausalDimension(dimensions.catalyst),
    goal: compactDeterministicCausalDimension(dimensions.goal),
    pressure: compactDeterministicCausalDimension(dimensions.pressure),
    leverage: compactDeterministicCausalDimension(dimensions.leverage),
    resourceProp: compactDeterministicCausalDimension(dimensions.resourceProp),
    relationshipTension: compactDeterministicCausalDimension(dimensions.relationshipTension),
    cost: compactDeterministicCausalDimension(dimensions.cost),
    deadline: compactDeterministicCausalDimension(dimensions.deadline),
    reversal: compactDeterministicCausalDimension(dimensions.reversal),
    aftermath: compactDeterministicCausalDimension(dimensions.aftermath),
  };
}

function finishDeterministicParagraph(value: string, language: StoryOutputLanguage) {
  const normalized = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return language === "en"
      ? "The immediate consequence remained visible and could not be reset."
      : language === "zh-CN"
        ? "眼前后果仍然有效，不能回到选择之前。"
        : "眼前後果仍然有效，不能回到選擇之前。";
  }
  const hasTerminalPunctuation = language === "en"
    ? /(?:[.!?]|…)["'’”)]?$/u.test(normalized)
    : /(?:[。！？!?]|……|…)[」』）》】"]?$/u.test(normalized);
  if (hasTerminalPunctuation) return normalized;
  return `${normalized.replace(/[，,；;：:、…—.\-\s]+$/gu, "")}${language === "en" ? "." : "。"}`;
}

function pendingQuotationClosers(value: string) {
  const openingToClosing = new Map([
    ["「", "」"],
    ["『", "』"],
    ["“", "”"],
    ["（", "）"],
    ["《", "》"],
    ["【", "】"],
  ]);
  const closing = new Set(openingToClosing.values());
  const stack: string[] = [];
  for (const character of Array.from(value)) {
    const expectedClosing = openingToClosing.get(character);
    if (expectedClosing) {
      stack.push(expectedClosing);
    } else if (closing.has(character) && stack.at(-1) === character) {
      stack.pop();
    }
  }
  return stack.reverse().join("");
}

function closeDeterministicQuotation(value: string, maximum: number) {
  let body = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const closers = pendingQuotationClosers(body);
    if (!closers) return body;
    if (Array.from(body).length + Array.from(closers).length <= maximum) {
      return `${body}${closers}`;
    }
    body = sliceDeterministicText(body, maximum - Array.from(closers).length);
  }
  return body;
}

function truncateDeterministicParagraph(
  value: string,
  maximum: number,
  language: StoryOutputLanguage,
) {
  const normalized = finishDeterministicParagraph(value, language);
  if (normalized.length <= maximum) return normalized;
  const prefix = sliceDeterministicText(normalized, maximum - 2);
  const sentenceBoundary = Math.max(
    prefix.lastIndexOf("。"),
    prefix.lastIndexOf("！"),
    prefix.lastIndexOf("？"),
    prefix.lastIndexOf("!"),
    prefix.lastIndexOf("?"),
    prefix.lastIndexOf("."),
  );
  if (sentenceBoundary >= Math.floor(maximum * 0.78)) {
    return closeDeterministicQuotation(
      finishDeterministicParagraph(prefix.slice(0, sentenceBoundary + 1), language),
      maximum,
    );
  }
  let body = prefix.replace(/[，,；;：:、…—.\-\s]+$/gu, "").trim();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const closers = pendingQuotationClosers(body);
    const ending = `${language === "en" ? "…" : "……"}${closers}`;
    const remaining = maximum - Array.from(ending).length;
    const clipped = sliceDeterministicText(body, remaining)
      .replace(/[，,；;：:、…—.\-\s]+$/gu, "")
      .trim();
    if (clipped === body) return `${body}${ending}`;
    body = clipped;
  }
  return closeDeterministicQuotation(body, maximum);
}

function deterministicStoryLength(title: string, paragraphs: readonly string[]) {
  return [title, ...paragraphs].join("").replace(/\s+/gu, "").length;
}

function finalizeDeterministicRpgStory(input: {
  title: string;
  paragraphs: readonly string[];
  language: StoryOutputLanguage;
}) {
  const paragraphMaximum = input.language === "en" ? 208 : 150;
  const titleMaximum = input.language === "en" ? 90 : 64;
  const minimumLength = input.language === "en" ? 950 : 900;
  const targetMinimum = minimumLength + 24;
  const title = sliceDeterministicText(
    input.title.normalize("NFC").replace(/\s+/gu, " ").trim(),
    titleMaximum,
  );
  const paragraphs = input.paragraphs.map((paragraph) =>
    truncateDeterministicParagraph(paragraph, paragraphMaximum, input.language));
  const padding: readonly string[] = input.language === "en"
    ? [
        "Everyone checked the conditions still available before moving again.",
        "That confirmation preserved the cost and did not reset the result.",
        "Outside the room, approaching footsteps made the changed situation impossible to ignore.",
      ]
    : input.language === "zh-CN"
      ? [
          "众人重新核对仍可动用的条件，没有把愿望误当成已经完成的结果。",
          "这份确认没有抹去代价，只让后续能够承接已经发生的变化。",
          "门外逐渐逼近的脚步声，让已经发生的变化再也无法被忽略。",
        ]
      : [];
  // Traditional-Chinese prose is authored to the required length by the scene
  // renderer itself. Repeating three generic sentences until a quota was met
  // made the fallback read like filler and raised similarity between turns.
  for (
    let attempt = 0;
    padding.length > 0 && deterministicStoryLength(title, paragraphs) < targetMinimum && attempt < 40;
    attempt += 1
  ) {
    const indexes = paragraphs
      .map((paragraph, index) => ({ index, length: paragraph.length }))
      .sort((left, right) => left.length - right.length || left.index - right.index);
    const supplement = padding[attempt % padding.length];
    const target = indexes.find(({ length }) => length + supplement.length + 1 <= paragraphMaximum);
    if (!target) break;
    paragraphs[target.index] = finishDeterministicParagraph(
      `${paragraphs[target.index]} ${supplement}`,
      input.language,
    );
  }
  return `${title}\n\n${paragraphs.join("\n\n")}`;
}

function deterministicPostArcOutcome(
  resolution: RpgChoiceResolution,
  language: StoryOutputLanguage,
) {
  if (language === "en") {
    if (resolution.outcome === "failure") {
      return "The attempt failed to arrange every detail, but it did not undo the ending or reopen the resolved conflict.";
    }
    if (resolution.outcome === "partial_success") {
      return "Only part of the intended arrangement was secured, but the cost remained visible and the ending stayed final.";
    }
    return resolution.outcome === "critical_success"
      ? "The arrangement succeeded beyond expectation while leaving the completed ending intact."
      : "The arrangement succeeded, and every retained consequence remained attached to the completed ending.";
  }
  if (language === "zh-CN") {
    if (resolution.outcome === "failure") {
      return "这次安置未能顾全每个细节，但失败没有撤销结局，也没有重新打开已经解决的冲突。";
    }
    if (resolution.outcome === "partial_success") {
      return "这次只完成部分安置，代价仍清楚保留，已经落定的结局也没有因此失效。";
    }
    return resolution.outcome === "critical_success"
      ? "这次安置取得超出预期的成功，同时完整保留已经落定的结局。"
      : "这次安置成功完成，所有留下的后果仍然归属于已经落定的结局。";
  }
  if (resolution.outcome === "failure") {
    return "這次安置未能顧全每個細節，但失敗沒有撤銷結局，也沒有重新打開已經解決的衝突。";
  }
  if (resolution.outcome === "partial_success") {
    return "這次只完成部分安置，代價仍清楚保留，已經落定的結局也沒有因此失效。";
  }
  return resolution.outcome === "critical_success"
    ? "這次安置取得超出預期的成功，同時完整保留已經落定的結局。"
    : "這次安置成功完成，所有留下的後果仍然歸屬於已經落定的結局。";
}

function deterministicProseHash(value: string) {
  let hash = 0x811c9dc5;
  for (const character of value.normalize("NFC")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function recentRpgStoryTexts(snapshot: RpgChatSnapshot) {
  const selected = selectRecentRpgContinuityTexts(snapshot, 8);
  return [...selected.chapterTails, ...selected.acceptedTexts];
}

function chooseDeterministicProse<T>(seed: string, values: readonly T[], offset = 0) {
  return values[(deterministicProseHash(`${seed}|${offset}`) + offset) % values.length];
}

function spokenByCharacter(value: string, protagonist: string) {
  const rendered = value.replace(/主角/gu, protagonist);
  // Procedural cast lines are stored as 「speech」Name+action.  Render them
  // with an explicit speaker before the quote so the published prose never
  // leaves dialogue ownership to guesswork.
  const quoteFirst = rendered.match(
    /^([「『][^」』]{2,}[」』])([\p{Script=Han}A-Za-z·・]{2,24})(?=(?:將|把|已經|橫過|彈了|指向|圈出|收起|擋下))/u,
  );
  if (!quoteFirst) return rendered;
  const [matched, quotation, speaker] = quoteFirst;
  return `${speaker}開口說：${quotation}${rendered.slice(matched.length)}`;
}

/**
 * Reader-facing Traditional Chinese fallback. The causal contract, rolls,
 * state deltas and learning-rule receipts stay outside the novel body.  This
 * function renders only scene, character agency, dialogue, action and result.
 */
function buildTraditionalNovelFallback(input: {
  snapshot: RpgChatSnapshot;
  choice: RpgChoice;
  resolution: RpgChoiceResolution;
  context: ReturnType<typeof deterministicTurnContext>;
  turn: number;
  variation?: number;
}) {
  const { snapshot, choice, resolution, context } = input;
  const protagonist = context.protagonist;
  const ally = context.supportingCharacter;
  const counterforce = context.counterforce;
  const witness = context.witness;
  const treasure = context.treasure;
  const stageAsset = context.stageAsset;
  const causalFrame = buildRpgTurnCausalContract({ snapshot, choice, outcome: resolution.outcome });
  const dimensions = compactDeterministicCausalDimensions(causalFrame.inferenceDimensions);
  const seed = stableStringify({
    projectId: snapshot.project.id,
    chapterId: snapshot.chapter.id,
    turn: input.turn,
    playMode: snapshot.playMode,
    choice: choice.title,
    outcome: resolution.outcome,
    scenario: context.scenario.id,
    learnedShape: causalFrame.inferenceDimensions,
    ...(input.variation ? { variation: input.variation } : {}),
  });
  const novelBeat = (value: string) => {
    const compact = compactDeterministicCausalDimension(
      spokenByCharacter(value, protagonist)
      .replace(/核准規則校準\s*[：:]\s*/gu, "")
      .replace(/本回合目標是/gu, "")
      .replace(/本回合/gu, "此刻")
      .replace(/關係張力來自/gu, "")
      .replace(/規則引擎/gu, "局勢")
      .replace(/故事狀態/gu, "眼前局面")
      .replace(/下一回合/gu, "往後")
      .replace(/\s+/gu, " ")
      .trim(),
      52,
    );
    if (
      !compact
      || CONTEXT_INSTRUCTION_LEAK_PATTERN.test(compact)
      || CONTEXT_DATABASE_LEAK_PATTERN.test(compact)
    ) return "";
    return embeddedNarrativeFact(compact);
  };
  // The contract may append approved craft hints to these fields. Those hints
  // still affect the seed and validation, while the novel itself starts from
  // the encounter's concrete event sentence so it never prints an instruction
  // or a clipped list of writing rules as narration.
  const narrativeBeat = (value: string | undefined, fallback: string) => novelBeat(value ?? "") || fallback;
  const catalyst = narrativeBeat(choice.encounter.catalyst ?? dimensions.catalyst, "門外的腳步忽然停住，原有退路也在同一刻失效");
  const goal = narrativeBeat(choice.encounter.goal ?? dimensions.goal, "最迫切的人與證據只能先保住一邊");
  const pressure = narrativeBeat(choice.encounter.pressure ?? dimensions.pressure, "守在外面的人開始收窄包圍");
  const leverage = narrativeBeat(choice.encounter.leverage ?? dimensions.leverage, "可反用對方重複留下的腳印與封痕設下誤導");
  const resourceProp = narrativeBeat(choice.encounter.resourceProp ?? dimensions.resourceProp, "既有物件被改作標記，沒有憑空多出新的寶物");
  const relationshipTension = narrativeBeat(
    choice.encounter.relationshipTension ?? dimensions.relationshipTension,
    "先前沒有說清的分歧，終於落到同一個具體決定上",
  );
  const cost = narrativeBeat(choice.encounter.cost ?? dimensions.cost, "原本安全的退路必須放棄");
  const deadline = narrativeBeat(choice.encounter.deadline ?? dimensions.deadline, "窗外第二次鐘響以前，痕跡就會被雨水沖散");
  const reversal = narrativeBeat(choice.encounter.reversal ?? dimensions.reversal, "阻路者慌忙收回的一張字條");
  const aftermath = narrativeBeat(choice.encounter.aftermath ?? dimensions.aftermath, "眾人得到一條新路，也欠下一份必須回應的人情");
  const nextLocation = narrativeFact(
    choice.encounter.locationShift.split("・")[0]?.trim(),
    context.location,
    32,
  );
  const weather = chooseDeterministicProse(seed, [
    "窗縫灌進來的風把紙角吹得不停顫動",
    "遠處的鐘聲被雨幕磨得低沉而急促",
    "屋簷落水一滴接一滴，像有人在暗處計時",
    "燈芯爆出細小火花，牆上的影子也跟著一縮",
    "門外忽然安靜下來，反而襯得室內每次呼吸都格外清楚",
  ]);
  const sensory = chooseDeterministicProse(seed, [
    "潮濕木料、舊紙與冷茶的氣味混在一起",
    "石地留下凌亂水痕，冰冷鞋底每移一步都發出短促摩擦聲",
    "未散的藥香貼在衣袖上，苦味一直壓到舌根",
    "桌面殘留一圈乾涸墨色，幾張被反覆折過的紙壓在搖晃燈影下",
    "外頭聲音忽近忽遠，偶爾夾著車輪或金屬碰撞的聲響",
  ], 1);
  const visiblePressure = chooseDeterministicProse(seed, [
    "守在外面的人再次催促，聲音已從商量變成命令",
    "一名陌生人從窗前折返，這次停在能看清桌面的角度",
    "原本答應中立的人忽然撤走，空出的位置立刻被另一方占住",
    "後門的燈無聲熄滅，熟悉的退路只剩下一道模糊輪廓",
    "剛送到的消息少了一行關鍵內容，封口卻多出一枚陌生印記",
  ], 2);
  const allySpeech = spokenByCharacter(ally.directDialogue, protagonist);
  const counterSpeech = spokenByCharacter(counterforce.directDialogue, protagonist);
  const witnessSpeech = spokenByCharacter(witness.directDialogue, protagonist);
  const allyGroup = context.castAffiliations.supporting.familyLabel
    ?? context.castAffiliations.supporting.factionLabel;
  const counterGroup = context.castAffiliations.counterforce.familyLabel
    ?? context.castAffiliations.counterforce.factionLabel;
  const witnessGroup = context.castAffiliations.witness.familyLabel
    ?? context.castAffiliations.witness.factionLabel;
  const terminalAction = choice.encounter.arcNextAction
    ?? (choice.encounter.arcPhase === "resolution" ? "resolution" : null);
  const embeddedConflict = quotationSafeNarrativeFact(
    extractLastCompleteNarrativeSentences(context.conflict, "眼前局勢已經發生變化", 220),
  );
  const embeddedArcGoal = quotationSafeNarrativeFact(
    safeNarrativeFallback(context.arcGoal, 64),
  );
  const embeddedUnresolved = quotationSafeNarrativeFact(
    safeNarrativeFallback(context.unresolved, 96),
  );
  const arcProgress = embeddedArcGoal !== embeddedConflict
    ? `關於${embeddedArcGoal}的追查，也因此有了可驗證的進展。`
    : "";
  const masteryAction = context.protagonistMastery
    ? context.protagonistMastery.relation === "使用"
      ? `${protagonist}只取「${quotationSafeNarrativeFact(context.protagonistMastery.name)}」中最熟的一式處理眼前破口，沒有把熟練當成必然成功。`
      : context.protagonistMastery.relation === "製作"
        ? `${protagonist}依「${quotationSafeNarrativeFact(context.protagonistMastery.name)}」的製作次序逐一核對接點，寧可慢一步，也不跳過會留下後患的工序。`
        : context.protagonistMastery.relation === "持有"
          ? `${protagonist}讓自己持有的「${quotationSafeNarrativeFact(context.protagonistMastery.name)}」只露出足以驗證的一角，所有權因此成了籌碼，也成了會被追索的痕跡。`
          : context.protagonistMastery.relation === "栽培"
            ? `${protagonist}憑栽培「${quotationSafeNarrativeFact(context.protagonistMastery.name)}」留下的經驗辨認環境差異，先排除一條看似安全、實則會毀掉材料的路。`
            : `${protagonist}把「${quotationSafeNarrativeFact(context.protagonistMastery.name)}」用在最需要判斷的細節上；那項專長只能改變方法，不能替結果作保。`
    : "";
  const chosenMove = snapshot.playMode === "management"
    ? choice.approach === "steady"
      ? `${protagonist}先停下尚未交付的批次，封存原單並讓經手者留在現場，誰也不能趁亂改寫時間。`
      : choice.approach === "resource"
        ? `${protagonist}把${context.inventory}與${context.storyProp}擺上桌，請能簽字的人當面換取一段查證時間。`
        : `${protagonist}打開會議室的門，要求對方真正能負責的人進來回答，並把撤單風險留在自己名下。`
    : snapshot.playMode === "romance"
      ? choice.approach === "steady"
        ? `${protagonist}沒有追問答案，只先把能離開的路讓出來，再說清自己願意承擔與不能越過的界線。`
        : choice.approach === "resource"
          ? `${protagonist}把${context.storyProp}留在兩人中間，以共同見過的細節換一次不被打斷的坦白。`
          : `${protagonist}當面指出那句被迴避的話，寧可承受拒絕，也不再讓沉默替任何人作決定。`
      : choice.approach === "steady"
        ? `${protagonist}先用${context.inventory}標出能撤退的位置，再把剛出現的痕跡逐一封住，讓追來的人無法抹除。`
        : choice.approach === "resource"
          ? `${protagonist}拆開${context.storyProp}可用的一部分作為誘餌，以現有線索換取看清敵方調度的時間。`
          : `${protagonist}放棄最安全的藏身處，沿著對手剛暴露的破綻逼近，迫使真正下令的人提前現身。`;
  const choiceTitleForProse = quotationSafeNarrativeFact(choice.title)
    .split(/[｜|・]/u, 1)[0]
    ?.trim();
  const choiceDecision = choiceTitleForProse
    && choiceTitleForProse.length >= 3
    && choiceTitleForProse.length <= 28
    && !CONTEXT_INSTRUCTION_LEAK_PATTERN.test(choiceTitleForProse)
      ? `${protagonist}決定${choiceTitleForProse}。`
      : "";
  const opening = chooseDeterministicProse(seed, [
    `${context.location}的光被來往人影切成幾段。${embeddedConflict}。${catalyst}；${weather}，${sensory}。`,
    `${context.location}裡沒有人先開口。${embeddedConflict}，已經再也拖不得。${catalyst}，迫使${protagonist}收回原先盤算；${weather}，${sensory}。`,
    `${context.location}留下的聲音忽然有了次序。${embeddedConflict}就在其中。${catalyst}，${protagonist}只能立刻回應；${weather}，${sensory}。`,
  ], 4);
  const actionParagraph = `${choiceDecision}${protagonist}沒有再解釋，立刻動手。${chosenMove}${masteryAction}手邊可用的仍只有${context.inventory}；${leverage}。${resourceProp}。${deadline}`;
  const allyAction = chooseDeterministicProse(seed, [
    `${ally.name}搶在爭論前把側門鑰匙交給傷者，自己留在最容易被追問的位置。`,
    `${ally.name}將散落線索按先後排開，又把最可疑的一件推到燈下，拒絕讓任何人代答。`,
    `${ally.name}先遣走無關的人，隨後堵住唯一能悄悄離場的窄門，把自己的退路也一併押上。`,
  ], 5);
  const allyParagraph = `${allyAction}${allySpeech}${context.castRelationships.supporting ? `兩人那段「${quotationSafeNarrativeFact(context.castRelationships.supporting)}」的舊關係，第一次有了必須當場兌現的重量。` : `${ally.name}不是來替${protagonist}補位，而是帶著自己的盤算留在現場。`}`;
  const groupActions = [
    context.selectedStageFamily
      ? `${context.selectedStageFamily.name}派來接應的人先護住門外傷者，沒有替任何一方搶走決定。`
      : null,
    allyGroup ? `${allyGroup}留下兩人看守退路。` : null,
    counterGroup ? `${counterGroup}換下原本的哨位，把出口握在手中。` : null,
    witnessGroup ? `${witnessGroup}送到的兩份證詞彼此矛盾，逼得在場者重新查驗。` : null,
  ].filter((value): value is string => Boolean(value));
  const groupParagraph = groupActions.length
    ? chooseDeterministicProse(seed, groupActions, 10)
    : null;
  const assetActors = stageAsset?.holder
    ? `${stageAsset.holder}用袖口墊著${treasure.name}，始終沒讓它離開視線。`
    : `${witness.name}隔著布把${treasure.name}放在眾人之間，先讓每個人看清原有磨損。`;
  const controllerAction = stageAsset?.controller
    ? `${stageAsset.controller}派來的監證人守在桌側，逐一記下伸手者的姓名。`
    : "";
  const claimantAction = stageAsset?.claimant && stageAsset.claimant !== "無其他聲索者"
    ? `${stageAsset.claimant}的信使堵住後門，要求在天亮前看見查驗結果。`
    : "";
  const assetParagraph = `${assetActors}${controllerAction}${claimantAction}${protagonist}只讓${treasure.name}完成一次核對；第二次觸碰時，表面紋路已經暗下去，沒有人敢把它當成能反覆使用的退路。誰先碰過什麼、又避開了什麼，都留下可追索的次序。`;
  const organizationAction = `${counterforce.name}帶來的人無聲散開，把最容易走的方向封死。`;
  const counterAction = chooseDeterministicProse(seed, [
    `${counterforce.name}先踢開藏在桌腳下的空匣，讓一條被忽略的搬運路線露出來。`,
    `${counterforce.name}抽走最上面那張證詞，當眾指出墨色與其他頁不同。`,
    `${counterforce.name}把門閂橫在兩人之間，要求先說明失敗會落到誰身上。`,
  ], 6);
  const counterParagraph = `${organizationAction}${counterAction}${counterSpeech}${visiblePressure}；${pressure}`;
  const witnessAction = chooseDeterministicProse(seed, [
    `${witness.name}從袖中取出一小截封條，缺口恰好能和桌上的殘片咬合。`,
    `${witness.name}把兩份說法逐字對讀，終於圈出同一個被刻意跳過的時刻。`,
    `${witness.name}走到窗邊辨認來人的鞋印，回身時已把真正的出入口畫在紙背。`,
  ], 7);
  const witnessParagraph = `${witnessAction}${witnessSpeech}${relationshipTension}，因此合作不再只是口頭上的同意。`;
  const outcomeProse = resolution.outcome === "critical_success"
    ? `${goal}不只完成，還比預期多保住一項證據。${arcProgress}${protagonist}把前後痕跡連起來時，${reversal}；原本躲在別人身後的決策者，第一次被迫留下能追查的署記。`
    : resolution.outcome === "success"
      ? `${goal}終於做成。${arcProgress}${protagonist}守住最迫切的一端，也讓${reversal}；成功沒有抹平分歧，卻把眾人從猜測推到一個不能撤回的事實上。`
      : resolution.outcome === "partial_success"
        ? `${goal}只完成最不能放手的一半。${arcProgress}${protagonist}保住證人與痕跡，另一條退路卻當場失效；${reversal}，每個人都得承認局面已越過原來的界線。`
        : `${goal}在最後一步落空。${arcProgress}${protagonist}沒能保住原先選定的結果，卻藉那次失手看見${reversal}；阻路的人留下真實手勢，失敗因此改變了追查方向。`;
  const treasureCost = narrativeBeat(treasure.cost || dimensions.cost, "這件物件再也不能被當作隨時可用的退路");
  const consequenceParagraph = `${cost}不再只是事前警告；${treasureCost}也在此刻兌現。原本通往${context.location}的安全位置被迫改向${nextLocation}，${aftermath}；這些變化留在現場，也留在人物之間。`;
  const titleImage = chooseDeterministicProse(seed, [
    `${context.location}未熄的燈`,
    `${treasure.name}留下的影子`,
    `${counterforce.name}推開的門`,
    `${snapshot.chapter.title}的雨聲`,
    `${ally.name}沒有說完的話`,
  ], 3);
  const activeEnding = chooseDeterministicProse(seed, [
    `${witness.name}把新畫出的路線壓在${treasure.name}下，終點正是${nextLocation}。那裡能解開未解的疑問「${embeddedUnresolved}」，卻只容一組人先抵達；${protagonist}必須在對手收網前決定帶誰同行。`,
    `${counterforce.name}離開前，把沾著同樣封蠟的碎片留給${protagonist}。碎片證明未解的疑問「${embeddedUnresolved}」已牽動另一處據點；若立刻追去，${ally.name}就得獨自守住眼前成果。`,
    `${ally.name}在殘頁背面找到一個通往${nextLocation}的舊記號，${witness.name}認出那是對方故意留下的邀請；未解的疑問「${embeddedUnresolved}」終於有了方向，追查與保全卻成了兩條不能同時走完的路，${protagonist}必須在鐘聲再響前選擇先守哪一邊。`,
  ], 8);
  const endingParagraph = terminalAction === "archive-ending"
    ? `${protagonist}最後關上門，讓${titleImage}停在身後。「${embeddedUnresolved}」已有不能推翻的答案，${ally.name}、${counterforce.name}與${witness.name}各自帶走應負責任；門扇合攏後，故事真正安靜了。`
    : terminalAction === "epilogue"
      ? `天色慢慢越過${context.location}，${titleImage}不再催促任何人。「${embeddedUnresolved}」已被說清，三人各自安置傷痕、承諾與未完成的工作；即使旅程停在此處，他們也已有完整去向。`
      : terminalAction === "new-arc"
        ? `${titleImage}在清晨重新顯出輪廓。「${embeddedUnresolved}」已留下答案，${ally.name}保留的證據卻指向另一個從未回答的問題；${protagonist}帶著已承擔的一切走向${nextLocation}，另一段故事由此開始。下一刻，門外有人喊出只有上一卷見證者才知道的暗號。`
        : terminalAction === "resolution"
          ? `${titleImage}終於安定。「${embeddedUnresolved}」有了不能撤回的答案，${protagonist}只與三人確認誰留下、誰離開，以及什麼已不能挽回。最後一個人走出${context.location}時，這段紛爭抵達真正終點。`
          : activeEnding;
  const sceneShapes = [
    [actionParagraph, allyParagraph, groupParagraph, assetParagraph, counterParagraph, witnessParagraph],
    [counterParagraph, actionParagraph, groupParagraph, allyParagraph, witnessParagraph, assetParagraph],
    [assetParagraph, witnessParagraph, actionParagraph, allyParagraph, groupParagraph, counterParagraph],
  ];
  const risingAction = chooseDeterministicProse(seed, sceneShapes, 9).filter(
    (paragraph): paragraph is string => Boolean(paragraph),
  );
  const paragraphs = [opening, ...risingAction, outcomeProse, consequenceParagraph, endingParagraph];
  return finalizeDeterministicRpgStory({ title: `〈${titleImage}〉`, paragraphs, language: "zh-TW" });
}

function buildDeterministicPostArcStory(input: {
  snapshot: RpgChatSnapshot;
  choice: RpgChoice;
  resolution: RpgChoiceResolution;
  context: ReturnType<typeof deterministicTurnContext>;
  turn: number;
}) {
  const nextAction = input.choice.encounter.arcNextAction
    ?? (input.choice.encounter.arcPhase === "resolution" ? "resolution" : null);
  if (!nextAction) return null;
  const flags = storyWorldFlags(input.snapshot.storyState);
  const oldThread = narrativeFact(
    typeof flags["story.arc.resolvedThread"] === "string"
      ? String(flags["story.arc.resolvedThread"])
      : input.context.unresolved,
    input.context.unresolved,
  );
  const newThread = narrativeFact(
    input.choice.encounter.arcThread,
    input.snapshot.language === "en"
      ? "a consequence left by the completed ending"
      : input.snapshot.language === "zh-CN"
        ? "由既有结局后果形成的续篇命题"
        : "由既有結局後果形成的續篇命題",
  );
  const newGoal = narrativeFact(
    input.choice.encounter.arcGoal,
    input.snapshot.language === "en"
      ? "define and answer the next volume's central responsibility"
      : input.snapshot.language === "zh-CN"
        ? "确认并回应下一卷必须承担的核心责任"
        : "確認並回應下一卷必須承擔的核心責任",
  );
  const result = deterministicPostArcOutcome(input.resolution, input.snapshot.language);

  if (input.snapshot.language === "en") {
    const actionToken = nextAction === "epilogue"
      ? "閱讀尾聲"
      : nextAction === "new-arc"
        ? "開啟續篇"
        : "封存結局";
    const title = nextAction === "epilogue"
      ? `Round ${input.turn} | Epilogue after the settled ending`
      : nextAction === "new-arc"
        ? `Round ${input.turn} | The next volume begins`
        : `Round ${input.turn} | The ending is archived`;
    const paragraphs = nextAction === "epilogue"
      ? [
          `${actionToken} named the chosen action, but it did not become another crisis. The resolved conflict stayed closed while the scene moved quietly through the people, promises, and material consequences left behind by the ending.`,
          `At the established location, the protagonist checked what could actually be carried forward. No lost time returned, no spent supply reappeared, and no convenient discovery replaced the price already paid to finish the former arc.`,
          `The nearest companion answered with measured honesty. Trust retained the exact distance earned before the ending, so gratitude could coexist with caution and affection could remain present without erasing an unresolved personal boundary.`,
          `Each surviving character received a concrete place in the aftermath. Their decisions were described through work, departure, recovery, or continued responsibility rather than through a promise that everything had suddenly become perfect.`,
          `${result} The important fact was not a fresh victory, but the preservation of a truthful ending whose gains and losses could still be recognized by everyone involved.`,
          `The closure record remained unchanged. Its arc key, settled goal, resolved thread, resolution kind, and original completion turn stayed fixed, so reading this epilogue could not consume the ending twice.`,
          `Canon, relationships, abilities, equipment, funds, and timeline history all kept their established values. The epilogue interpreted those facts as lived consequences without silently granting a new reward or applying a second gameplay cost.`,
          `The former thread remained resolved and could not return under a renamed disguise. Any future volume would need a different causal question drawn from another established clue or from a consequence that this ending genuinely created.`,
          `For now, the final image belonged to rest and recognition. The characters understood what had ended, what they had kept, and what they would carry even if no further volume were ever opened.`,
          `The epilogue closed on that complete image. It offered space to remember the journey and preserved the possibility of a sequel, yet it created no ordinary crisis choices and demanded no replay of the settled conflict.`,
        ]
      : nextAction === "new-arc"
        ? [
            `${actionToken} marked a genuine continuation rather than a reset. The completed arc remained in the ledger, while a distinct causal question took shape from a surviving Canon clue or a consequence created by the ending.`,
            `Nothing about the former resolution was revoked. Its settled thread stayed closed, its costs stayed paid, and its witnesses retained the knowledge and relationships earned before the opening of this volume.`,
            `The protagonist entered the new volume with the same abilities, equipment, funds, obligations, and personal history. Continuity therefore shaped the opening conditions instead of serving as decoration around a fresh blank state.`,
            `The new thread and goal were recorded as a separate contract. They defined one bounded responsibility for this volume and prevented the director from recycling the former hook merely because it was familiar.`,
            `The nearest companion recognized both continuity and change. Their existing trust affected how they responded, but the new problem still required a fresh decision instead of automatic loyalty or an unexplained reversal.`,
            `${result} The meaningful success was the clean handoff between volumes: the old ending remained immutable while the new setup gained a clear subject, pressure, and reachable conclusion.`,
            `The story advanced to the real opening of this volume. Reading an epilogue beforehand could not make the sequel skip the first encounter with its new responsibility or erase the choices that shaped that encounter.`,
            `No resolved thread returned to the unresolved list. If no older open clue was available, the system used a visible consequence of the ending to form a new proposition with a different key, goal, and responsibility.`,
            `The location, cast, and retained resources now established the first causal frame. Pressure could rise from that frame, but every later turn would still have to advance, transform, or settle this specific new thread.`,
            `The next volume was now genuinely open. Three contextual approaches waited at its first decision point, each tied to the preserved state and none pretending that the completed ending had never happened.`,
          ]
        : [
            `${actionToken} was the final authorized act for this arc. The archive preserved the completed ending exactly as approved and did not reinterpret closure as a temporary pause before another automatic emergency.`,
            `The former goal remained complete and its thread remained resolved. Evidence, relationships, resources, and losses stayed attached to the characters who had carried them through the ending.`,
            `The protagonist did not search for another door at the edge of the scene. Instead, the final place was allowed to keep its silence, its visible repairs, and the marks left by decisions that could not be taken back.`,
            `The nearest companion acknowledged the same boundary. Their final gesture neither promised a hidden continuation nor erased the distance that remained between them after the cost of closure.`,
            `${result} Archiving did not grant another reward, repeat a settlement, or change the immutable completion record; it only confirmed that the work would remain at its complete endpoint.`,
            `The closure ledger kept its original arc key, goal, resolved thread, resolution kind, and completion turn. Repeating the archive request therefore could not create a second receipt or rewrite history.`,
            `Canon and all retained state remained available for reading, export, or a separately authorized future project action. None of those preservation operations counted as a new story turn inside this archived arc.`,
            `No ordinary branch cards were generated after the terminal flag was written. There was no concealed fourth route, no renamed copy of the resolved hook, and no automatic opening of another volume.`,
            `The final image held long enough for every consequence to become legible. What was saved, what was lost, and who accepted responsibility could be understood without another conflict being attached to it.`,
            `The archive closed there as a complete endpoint. The story remained readable and its history remained intact, but this arc had no further playable action and consumed no additional choice.`,
          ];
    return finalizeDeterministicRpgStory({ title, paragraphs, language: input.snapshot.language });
  }

  if (input.snapshot.language === "zh-CN") {
    const title = nextAction === "epilogue"
      ? `第 ${input.turn} 回合｜尾声：安置人物与成果`
      : nextAction === "new-arc"
        ? `第 ${input.turn} 回合｜开启续篇／下一卷`
        : `第 ${input.turn} 回合｜封存结局：完整终点`;
    const paragraphs = nextAction === "epilogue"
      ? [
          `选择“阅读尾声”之后，现场没有再长出一场危机。已经解决的因果链保持关闭，叙事只沿着人物、承诺、资源与环境留下的余波缓慢移动。`,
          `主角在原来的地点逐项核对能够保留的事物。失去的时间没有倒转，消耗的资源没有恢复，已经承担的责任也没有被一段温柔文字轻易抹去。`,
          `同行者以克制而诚实的态度回应。信任停在此前真正累积的位置，感谢可以存在，警戒也可以保留，关系不因结局就突然变成毫无裂缝的圆满。`,
          `其他人物也获得明确安置：有人继续修复，有人带着职责离开，有人选择留下照看后果。他们的去向来自既有选择，而不是临时编造的奖励。`,
          `${result}这次行动的价值不在于制造新胜利，而在于让所有人都能辨认这段旅程真正得到、失去并承担了什么。`,
          `结案记录保持不变。故事弧编号、目标、已解决线索、结案方式与原完成回合都固定保存，阅读尾声不会把同一个结局再结算一次。`,
          `作品设定、人物关系、能力、装备、资金与时间线全都沿用原值。尾声只把这些事实转化为生活后果，不暗中增加奖励，也不支付第二次代价。`,
          `旧线索不会换个名称回到未解清单。若未来开启续篇，必须采用另一条既有线索，或由当前结局造成的明确后果建立全新因果命题。`,
          `此刻的画面属于休息与确认。人物知道什么已经结束、什么被保留下来，也知道即使没有下一卷，他们仍会带着这些经历继续生活。`,
          `尾声最终停在完整画面上。它保留未来开启续篇的可能，却不会产生普通危机路线，也不会要求人物重新处理已经解决的冲突。`,
        ]
      : nextAction === "new-arc"
        ? [
            `选择“开启续篇／下一卷”不是重新开始，而是让另一条因果链从既有结局之后成立。旧弧仍留在结案记录中，新命题来自作品原有线索或真实后果。`,
            `旧结局没有被撤销。已经关闭的线索继续关闭，支付过的代价仍然有效，见证者也保留他们在上一卷获得的知识与关系位置。`,
            `主角带着同一份作品设定、能力、装备、资金、关系与时间线进入续篇。连续性直接决定开场条件，不会只当作装饰摆在一张空白地图旁边。`,
            `新线索与新目标以独立契约保存。它们规定本卷必须回应的核心责任，也阻止系统因为熟悉而把上一卷的问题改名重复。`,
            `同行者同时认得延续与变化。既有信任会影响他的反应，但新问题仍需要新的判断，不能靠自动忠诚或突然翻转替主角完成。`,
            `${result}真正完成的是两卷之间的交接：旧结局保持不可更改，新阶段则取得明确主题、压力与能够抵达的收束方向。`,
            `作品推进到续篇真实开始的位置。先阅读尾声不会让下一卷跳过人物首次面对新责任的场景，也不会抹去塑造这次相遇的旧选择。`,
            `已解决线索不会回到未解清单。若没有其他旧线索，系统会从结局留下的可见后果形成不同编号、目标与责任的新命题。`,
            `地点、人物与保留资源共同组成续篇第一份因果框架。以后每个回合都必须推进、转化或回收这条新线索，不能无限增加无关伏笔。`,
            `下一卷至此正式开启。第一个决策点出现三种符合当前状态的方法，各自具有不同后果，也都承认上一卷确实已经完成。`,
          ]
        : [
            `选择“封存结局”是目前故事弧最后一次有效行动。系统保存已经核准的完整终点，不把结案曲解成下一场自动危机之前的短暂停顿。`,
            `原目标继续维持完成，旧线索继续维持解决。证据、关系、资源与损失仍属于一路承担它们的人物，没有任何内容被归零。`,
            `主角没有在场景边缘寻找另一扇门，而是让最后地点保留安静、修复痕迹与那些无法撤回的选择。故事因此拥有真正停下来的权利。`,
            `同行者也承认同一条边界。他最后的动作没有暗示隐藏续集，也没有抹去结案代价留在两人之间的真实距离。`,
            `${result}封存不会再次发奖、重复结算或修改不可变记录，只确认作品停在已经完成的终点。`,
            `结案台账保留原故事弧编号、目标、已解决线索、结案方式与完成回合。重复提出封存请求不会产生第二张凭证，也不会重写历史。`,
            `作品设定与所有保留状态仍可阅读、导出或备份。这些保存操作不是本故事弧的新回合，也不会改变人物已经承担的后果。`,
            `终止标记写入后，系统不会再建立普通分支卡。这里没有隐藏的第四条路，没有旧线索的改名复制，也不会自动开启下一卷。`,
            `最后画面停留到每项后果都清楚可见。保住了什么、失去了什么、谁愿意负责，都能在不追加冲突的情况下被理解。`,
            `封存最终停在完整终点。故事仍然可以阅读，历史仍然完整，但本弧已经没有可执行行动，也不会再消耗任何选择。`,
          ];
    return finalizeDeterministicRpgStory({ title, paragraphs, language: input.snapshot.language });
  }

  const title = nextAction === "epilogue"
    ? `第 ${input.turn} 回合｜尾聲：安置人物與成果`
    : nextAction === "new-arc"
      ? `第 ${input.turn} 回合｜開啟續篇／下一卷`
      : `第 ${input.turn} 回合｜封存結局：完整終點`;
  const paragraphs = nextAction === "epilogue"
    ? [
        `選擇「閱讀尾聲」之後，現場沒有再長出一場危機。已經解決的因果鏈保持關閉，敘事只沿著人物、承諾、資源與環境留下的餘波緩慢移動。`,
        `${input.context.protagonist}在${input.context.location}逐項核對能夠保留的事物。失去的時間沒有倒轉，消耗的${input.context.inventory}沒有恢復，已經承擔的責任也沒有被一段溫柔文字輕易抹去。`,
        `${input.context.supporting}以克制而誠實的態度回應。信任停在此前真正累積的位置，感謝可以存在，警戒也可以保留，關係不因結局就突然變成毫無裂縫的圓滿。`,
        `其他人物也獲得明確安置：有人繼續修復，有人帶著職責離開，有人選擇留下照看後果。他們的去向來自既有選擇，而不是臨時編造的獎勵。`,
        `${result}這次行動的價值不在製造新勝利，而在讓所有人都能辨認這段旅程真正得到、失去並承擔了什麼。`,
        `結案紀錄保持不變。故事弧編號、目標、已解決線索「${oldThread}」、結案方式與原完成回合都固定保存，閱讀尾聲不會把同一個結局再結算一次。`,
        `作品 Canon、人物關係、能力、裝備、資金與時間線全都沿用原值。尾聲只把這些事實轉化為生活後果，不暗中增加獎勵，也不支付第二次代價。`,
        `舊線索不會換個名稱回到未解清單。若未來開啟續篇，必須採用另一條既有線索，或由目前結局造成的明確後果建立全新因果命題。`,
        `此刻的畫面屬於休息與確認。人物知道什麼已經結束、什麼被保留下來，也知道即使沒有下一卷，他們仍會帶著這些經歷繼續生活。`,
        `尾聲最終停在完整畫面上。它保留未來開啟續篇的可能，卻不會產生普通危機路線，也不會要求人物重新處理已經解決的衝突。`,
      ]
    : nextAction === "new-arc"
      ? [
          `選擇「開啟續篇／下一卷」不是重新開始，而是讓另一條因果鏈從既有結局之後成立。舊弧仍留在結案紀錄中，新命題「${newThread}」來自作品原有線索或真實後果。`,
          `舊結局沒有被撤銷。已經關閉的線索「${oldThread}」繼續關閉，支付過的代價仍然有效，見證者也保留他們在上一卷取得的知識與關係位置。`,
          `${input.context.protagonist}帶著同一份 Canon、能力、裝備、資金、關係與時間線進入續篇。連續性直接決定開場條件，不會只當作裝飾擺在一張空白地圖旁邊。`,
          `新目標「${newGoal}」以獨立契約保存。它規定本卷必須回應的核心責任，也阻止系統因為熟悉而把上一卷的問題改名重複。`,
          `${input.context.supporting}同時認得延續與變化。既有信任會影響回應，但新問題仍需要新的判斷，不能靠自動忠誠或突然翻轉替${input.context.protagonist}完成。`,
          `${result}真正完成的是兩卷之間的交接：舊結局保持不可更改，新階段則取得明確主題、壓力與能夠抵達的收束方向。`,
          `作品推進到續篇真實開始的位置。先閱讀尾聲不會讓下一卷跳過人物首次面對新責任的場景，也不會抹去塑造這次相遇的舊選擇。`,
          `已解決線索不會回到未解清單。若沒有其他舊線索，系統會從結局留下的可見後果形成不同編號、目標與責任的新命題。`,
          `${input.context.location}、既有人物與保留資源共同組成續篇第一份因果框架。往後每回合都必須推進、轉化或回收這條新線索，不能無限增加無關伏筆。`,
          `下一卷至此正式開啟。第一個決策點出現三種符合目前狀態的方法，各自具有不同後果，也都承認上一卷確實已經完成。`,
        ]
      : [
          `選擇「封存結局」是目前故事弧最後一次有效行動。系統保存已經核准的完整終點，不把結案曲解成下一場自動危機之前的短暫停頓。`,
          `原目標繼續維持完成，舊線索「${oldThread}」繼續維持解決。證據、關係、資源與損失仍屬於一路承擔它們的人物，沒有任何內容被歸零。`,
          `${input.context.protagonist}沒有在${input.context.location}邊緣尋找另一扇門，而是讓最後地點保留安靜、修復痕跡與那些無法撤回的選擇。故事因此擁有真正停下來的權利。`,
          `${input.context.supporting}也承認同一條邊界。最後的動作沒有暗示隱藏續集，也沒有抹去結案代價留在彼此之間的真實距離。`,
          `${result}封存不會再次發獎、重複結算或修改不可變紀錄，只確認作品停在已經完成的終點。`,
          `結案台帳保留原故事弧編號、目標、已解決線索、結案方式與完成回合。重複提出封存要求不會產生第二張憑證，也不會重寫歷史。`,
          `作品 Canon 與所有保留狀態仍可閱讀、匯出或備份。這些保存操作不是本故事弧的新回合，也不會改變人物已經承擔的後果。`,
          `終止標記寫入後，系統不會再建立普通分支卡。這裡沒有隱藏的第四條路，沒有舊線索的改名複製，也不會自動開啟下一卷。`,
          `最後畫面停留到每項後果都清楚可見。保住了什麼、失去了什麼、誰願意負責，都能在不追加衝突的情況下被理解。`,
          `封存最終停在完整終點。故事仍然可以閱讀，歷史仍然完整，但本弧已經沒有可執行行動，也不會再消耗任何選擇。`,
        ];
  return finalizeDeterministicRpgStory({ title, paragraphs, language: input.snapshot.language });
}

export function buildDeterministicRpgTurnStory(input: {
  snapshot: RpgChatSnapshot;
  choice: RpgChoice;
  resolution: RpgChoiceResolution;
  variation?: number;
}) {
  const context = deterministicTurnContext(input.snapshot);
  const protagonist = context.protagonist;
  const turn = input.snapshot.progression.turn + 1;
  if (input.snapshot.language === "zh-TW") {
    return buildTraditionalNovelFallback({ ...input, context, turn });
  }
  const postArcStory = buildDeterministicPostArcStory({
    ...input,
    context,
    turn,
  });
  if (postArcStory) return postArcStory;
  if (input.snapshot.language === "en") {
    const result = input.resolution.outcome === "critical_success"
      ? "The action succeeded beyond its immediate aim and exposed an additional opening."
      : input.resolution.outcome === "success"
        ? "The action succeeded, although the changed situation still demanded attention."
        : input.resolution.outcome === "partial_success"
          ? "Only part of the aim was secured, and the cost arrived before the remaining problem could be solved."
          : "The attempt failed to achieve its intended aim, but the obstruction revealed a concrete way to continue.";
    const paragraphs = [
      `At ${context.location}, ${protagonist} chose “${input.choice.title}” to answer the immediate conflict: ${context.conflict}. The decision began with ${context.storyProp}, the resource already present, rather than an advantage invented after the fact.`,
      `${context.supporting} moved first, not as an obedient helper but to protect a separate goal: ${context.supportingCharacter.goal}. The two agreed on what each would do, and on the line ${context.supporting} would refuse to cross.`,
      `${context.counterforce.name} reacted before the arrangement was complete. Seeking ${context.counterforce.goal}, the opposing figure shifted the pressure toward ${context.unresolved} and forced the chosen action to become visible to every witness.`,
      `${context.treasure.name} became the center of the dispute. It could ${context.treasure.function}, but ${context.treasure.limitation}; ownership, access, and responsibility therefore mattered as much as possession.`,
      `${protagonist} used ${context.inventory} to carry out the selected approach. ${input.choice.encounter.complication} The action consumed the promised time and position, so retreat could no longer restore the scene to its earlier state.`,
      `${result} ${input.choice.encounter.locationShift} The outcome answered the chosen action specifically and left a visible fact that no later explanation could erase.`,
      `${context.witness.name} checked what remained and recorded who had acted first. ${context.supporting} kept cooperating, but the response made clear that trust now depended on how ${protagonist} handled the cost already paid.`,
      `${input.choice.encounter.worldAspect} changed the meaning of ${context.location}. The opposition could no longer pretend nothing had happened, while the protagonists could no longer rely on the route or neutrality they had before this turn.`,
      `Evidence from the action exposed a new edge of “${context.unresolved}.” It pointed back to ${context.counterforce.name} and explained why ${context.conflict} had intensified now, carrying the same story forward instead of reopening its beginning.`,
      `${protagonist} ended the turn with three concrete facts: what the choice achieved, what it cost, and who now controlled ${context.treasure.name}. The next decision must begin from those facts; none of the unchosen paths has occurred.`,
    ];
    return finalizeDeterministicRpgStory({
      title: `Round ${turn} | ${input.choice.title}`,
      paragraphs,
      language: input.snapshot.language,
    });
  }
  if (input.snapshot.language === "zh-CN") {
    const result = input.resolution.outcome === "critical_success"
      ? "这次行动不但成功完成原定目标，还揭开了一条额外通路。"
      : input.resolution.outcome === "success"
        ? "这次行动成功达成目标，但改变后的局势仍需要马上处理。"
        : input.resolution.outcome === "partial_success"
          ? "目标只完成了一部分，代价却先一步落下，剩余问题仍在逼近。"
          : "这次尝试未能达成原定目标，行动失败了，但阻力也暴露出可以继续追查的具体方向。";
    const paragraphs = [
      `${protagonist}在${context.location}选定“${input.choice.title}”，正面回应“${context.conflict}”。第一步只动用现场已有的${context.storyProp}，没有临时获得不属于自己的能力或资源。`,
      `${context.supporting}先移到侧面接应，却没有盲目服从。为了${context.supportingCharacter.goal}，两人当场分清各自负责的行动，也说定一旦碰到${context.supportingCharacter.refusalCondition}便立即停手。`,
      `${context.counterforce.name}察觉安排后抢先改变位置。此人要守住的是${context.counterforce.goal}，于是把压力推向“${context.unresolved}”，迫使这次选择暴露在所有目击者面前。`,
      `${context.treasure.name}随即成为争夺中心。它可以${context.treasure.function}，却受限于${context.treasure.limitation}；谁持有、谁有权动用、谁承担代价，必须分别说清。`,
      `${protagonist}带着${context.inventory}执行既定方案。${input.choice.encounter.complication}行动占用了已经承诺的时间与位置，退回原处也无法把一切恢复成选择之前。`,
      `${result}${input.choice.encounter.locationShift}这项结果明确回应了刚才的行动，也留下任何人都无法靠事后解释抹去的证据。`,
      `${context.witness.name}核对现场并记下谁先采取行动。${context.supporting}仍愿意合作，却把信任系在${protagonist}接下来是否承担已付代价之上，没有因为一次成败突然改变态度。`,
      `${input.choice.encounter.worldAspect}改变了${context.location}的意义。对手不能再假装无事发生，${protagonist}一方也失去了原先那条退路与中立位置，故事因此真正向前移动。`,
      `行动留下的痕迹揭开“${context.unresolved}”的新一角，并指向${context.counterforce.name}先前避开的地方。它解释了“${context.conflict}”为何此刻恶化，却没有把已完成的行动重新再演一次。`,
      `${protagonist}最后确认三件事：刚才完成了什么、付出了什么，以及${context.treasure.name}目前由谁控制。接下来的故事只能从这些事实继续，未选择的两条路线都没有发生。`,
    ];
    return finalizeDeterministicRpgStory({
      title: `${context.location}｜${context.treasure.name}`,
      paragraphs,
      language: input.snapshot.language,
    });
  }
  const result = input.resolution.outcome === "critical_success"
    ? "這次行動不只成功完成原定目標，還揭開了一條額外通路。"
    : input.resolution.outcome === "success"
      ? "這次行動成功達成目標，但改變後的局勢仍需要立刻處理。"
      : input.resolution.outcome === "partial_success"
      ? "目標只完成了一部分，代價卻先一步落下，剩餘問題仍在逼近。"
      : "這次嘗試未能達成原定目標，行動失敗了，但阻力也暴露出可以繼續追查的具體方向。";
  const causalFrame = buildRpgTurnCausalContract({
    snapshot: input.snapshot,
    choice: input.choice,
    outcome: input.resolution.outcome,
  });
  const dimensions = compactDeterministicCausalDimensions(causalFrame.inferenceDimensions);
  const commonOpening = `${dimensions.catalyst}${dimensions.goal}${protagonist}在${context.location}面對「${context.conflict}」，選定「${input.choice.title}」後立刻行動，沒有重開故事或重演未選路線。`;
  const commonResources = `${dimensions.leverage}${dimensions.resourceProp}`;
  const commonRelationship = dimensions.relationshipTension;
  const commonResistance = `${dimensions.pressure}${dimensions.deadline}`;
  const commonCost = dimensions.cost;
  const commonResult = `${result}${causalFrame.hopeGuard.progressBeat}${dimensions.reversal}${protagonist}清楚區分已完成與仍未解決的部分。`;
  const commonAftermath = `${dimensions.aftermath}${causalFrame.hopeGuard.recoveryBeat}`;
  const modeParagraphs: Record<StoryPlayModeId, string[]> = {
    rpg: [
      commonOpening,
      `${commonResources}${protagonist}先確認${context.inventory}仍可使用，再沿退路探查阻力來源。裝備不是萬能答案，任務也不會自行完成；他只能把既有條件落成旁人看得見的動作。`,
      `${commonRelationship}${context.supporting}察覺意圖後移到側面掩護，卻沒有盲目服從。對方用一句急促提醒指出最危險的位置，使合作有了具體作用，也留下稍後必須說清的責任。`,
      `${commonResistance}光影、腳步與壓低的呼吸持續升高。每次停頓都會讓對手收窄空間，每次冒進也可能過早暴露意圖，行動只能服從已選方法。`,
      `${commonCost}當退路在身後收窄，代價便無法撤回。${protagonist}付出行動要求的體力、行動點與既定資源，沒有靠突然出現的寶物解圍；風險也留下可追查的痕跡。`,
      commonResult,
      `${context.supporting}沒有因一次結果就完全改變立場，只在看見${protagonist}承擔後果後多給了一點合作空間。那份克制讓關係變化顯得真實：信任可以累積，警戒也仍在，下一次同行必須繼續用行動證明。`,
      `${commonAftermath}${input.choice.encounter.locationShift}使場景重新排列，${input.choice.encounter.worldAspect}也不再只是背景。新的路線暴露在視線中，原先安全的角落失去中立。`,
      `未解線索「${context.unresolved}」在變動中露出新的邊角，卻沒有立刻得到答案。它與本次選擇留下的後果扣在一起，形成下一回合能追查、能防守也可能反過來利用的具體危機。`,
      `${protagonist}在新的局勢邊緣停下。眼前已出現三種互不相同的策略：先穩住傷害、調度現有裝備與盟友，或冒險逼近未解線索；他不能同時完成三者，只能帶著本回合結算後的狀態作出下一次決定。`,
    ],
    romance: [
      commonOpening,
      `${commonResources}${protagonist}先確認可用條件只剩${context.inventory}，沒有替${context.supporting}決定感受，而是把目的、限制與可能代價說清。關係推進建立在對方知道自己能拒絕的前提上。`,
      `${commonRelationship}${context.supporting}沉默片刻才回應，語氣裡同時有信任與保留。那句話沒有讓關係突然圓滿，卻指出事件進度下一個可確認的門檻。`,
      `${commonResistance}光影、距離與壓低的聲音持續升高。每次停頓都可能讓誤會加深，每句回答也必須服從彼此已說明的界線，不能靠強迫或巧合抹去。`,
      `${commonCost}氣氛升高時，${protagonist}仍守住彼此已說明的界線。代價落在時間、信任與錯過其他機會上；人物成長是願意在不確定中說真話並接受答案。`,
      commonResult,
      `${context.supporting}根據實際結果調整了距離：願意保留下一次談話的入口，卻沒有忘記尚未兌現的部分。關係因此前進了一小步，也留下新的疑問，信任、事件進度與個人成長將在後續回合分別累積。`,
      `${commonAftermath}${input.choice.encounter.locationShift}讓兩人的相處位置改變，${input.choice.encounter.worldAspect}則把私人的決定推向更大的外部壓力。旁人的目光與有限時間同時逼近。`,
      `未解心結「${context.unresolved}」被本次行動重新照亮。它沒有被一句承諾消除，反而成為下一次必須面對的事件節點：可以先修補信任、共同處理外患，或冒險追問一直避開的真相。`,
      `${protagonist}看著${context.supporting}留下的反應，知道下一步不能只重複同一句告白。新的三條路必須分別改變關係、事件與人物成長，而且每條路都有不同代價；故事停在雙方仍有選擇權的位置。`,
    ],
    management: [
      commonOpening,
      `${commonResources}${protagonist}攤開帳冊，先確認${context.inventory}與現有人力、品質承諾後才下令。每項調度都會占用團隊時間與體力，也會改變聲望、風險和下回合能動用的資源。`,
      `${commonRelationship}${context.supporting}代表團隊提出反對，指出速度與品質無法同時拉滿。${protagonist}要求對方標出最可能失守的環節，使人力配置成為可驗證的選擇。`,
      `${commonResistance}通知、腳步與帳頁翻動聲持續升高。每次停頓都會縮短交付窗口，每次冒進也可能提早暴露品質缺口，調度只能依照已選策略執行。`,
      `${commonCost}窗口一旦關閉，投入就無法全數收回。資金、工時與信用都沿著決策流出；即使成功，也必須支付維持品質與履行承諾的成本。`,
      commonResult,
      `${context.supporting}根據結算結果重新安排人手，沒有因一次勝負就讓組織突然翻身。團隊看見${protagonist}是否承擔責任，士氣與信任因此小幅移動；這種變化會影響下一輪執行，而不是只留在對話裡。`,
      `${commonAftermath}${input.choice.encounter.locationShift}改變了客戶與競爭者的判斷，${input.choice.encounter.worldAspect}也讓聲望不再只是面板數字。市場開始形成下一回合的實際壓力。`,
      `尚未化解的營運危機「${context.unresolved}」在帳冊上留下新的缺口。它可以靠保守止損、重新調度資金人力，或抓住市場窗口正面突破，但三者會分別牽動品質、聲望與風險。`,
      `${protagonist}合上帳冊時，新的三條策略已經清楚分開。他必須以更新後的資金、人力、品質、聲望與風險選下一步，不能回到第一回合，也不能把剛才的三個選項原樣再印一次。`,
    ],
    interactive: [],
    general: [],
  };
  const paragraphs = modeParagraphs[input.snapshot.playMode].length
    ? modeParagraphs[input.snapshot.playMode]
    : modeParagraphs.rpg;
  return finalizeDeterministicRpgStory({
    title: `第 ${turn} 回合｜${input.choice.title}`,
    paragraphs,
    language: input.snapshot.language,
  });
}

function assertRpgArcActionAvailable(snapshot: RpgChatSnapshot, choice: RpgChoice) {
  const flags = storyWorldFlags(snapshot.storyState);
  if (flags["story.arc.archived"] === true) {
    throw Object.assign(new Error("這個結局已封存；目前故事弧沒有可再消耗的行動。"), {
      code: "STORY_ARC_ARCHIVED",
    });
  }
  if (
    choice.disabledReason
    || (
      choice.encounter.arcNextAction === "epilogue"
      && flags["story.arc.epilogueRead"] === true
    )
  ) {
    throw Object.assign(new Error(choice.disabledReason || "尾聲已閱讀；請開啟續篇或封存結局。"), {
      code: "STORY_ARC_EPILOGUE_ALREADY_READ",
    });
  }
}

function attachProceduralSceneReceipt(
  snapshot: RpgChatSnapshot,
  resolution: RpgChoiceResolution,
): RpgChoiceResolution {
  const context = deterministicTurnContext(snapshot);
  const previousActors = typeof snapshot.storyState.worldFlags?.["story.recentSupportingActors"] === "string"
    ? String(snapshot.storyState.worldFlags["story.recentSupportingActors"])
        .split("|").map((value) => value.trim()).filter(Boolean)
    : [];
  const recentActors = [
    context.supportingCharacter.id,
    context.counterforce.id,
    context.witness.id,
    ...previousActors,
  ]
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 9);
  const activeFamilyIds = context.activeFamilyIds
    .filter((value, index, all) => all.indexOf(value) === index);
  const activeFactionIds = context.activeFactionIds
    .filter((value, index, all) => all.indexOf(value) === index);
  const effect = {
    ...resolution.effect,
    worldFlags: {
      ...(resolution.effect.worldFlags ?? {}),
      "story.activeSupportingCharacterId": context.supportingCharacter.id,
      "story.activeSupportingCharacterName": context.supportingCharacter.name,
      "story.activeCounterforceCharacterId": context.counterforce.id,
      "story.activeCounterforceCharacterName": context.counterforce.name,
      "story.activeWitnessCharacterId": context.witness.id,
      "story.activeWitnessCharacterName": context.witness.name,
      "story.activeFamilyIds": activeFamilyIds.join("|"),
      "story.activeFactionIds": activeFactionIds.join("|"),
      "story.activeTreasureId": context.treasure.id,
      "story.activeTreasureName": context.treasure.name,
      ...(context.stageAsset ? {
        "story.activeStageAssetLoreId": context.stageAsset.id,
        ...(context.stageAsset.holderCharacterId
          ? { "story.activeStageAssetHolderCharacterId": context.stageAsset.holderCharacterId }
          : {}),
        ...(context.stageAsset.controllerOrganizationId
          ? { "story.activeStageAssetControllerOrganizationId": context.stageAsset.controllerOrganizationId }
          : {}),
        ...(context.stageAsset.claimantOrganizationId
          ? { "story.activeStageAssetClaimantOrganizationId": context.stageAsset.claimantOrganizationId }
          : {}),
      } : {}),
      "story.relationshipScenarioId": context.scenario.id,
      "story.recentSupportingActors": recentActors.join("|"),
    },
  };
  return {
    ...resolution,
    effect,
    settlement: {
      ...resolution.settlement,
      resolvedEffect: structuredClone(effect),
    },
  };
}

export function resolveRpgChatTurnLockedResult(
  snapshot: RpgChatSnapshot,
  choice: RpgChoice,
) {
  assertRpgArcActionAvailable(snapshot, choice);
  return attachProceduralSceneReceipt(snapshot, resolveRpgChoice(choice, {
    seed: `${snapshot.progression.procedural.runSeed}|${snapshot.chapter.id}|${snapshot.progression.turn}`,
    revision: snapshot.storyState.revision,
    recentEncounterSignatures: snapshot.progression.procedural.recentEncounterSignatures,
    turn: snapshot.progression.turn,
    storyState: snapshot.storyState,
  }));
}

export async function buildDeterministicRpgChatTurnCandidate(input: {
  snapshot: RpgChatSnapshot;
  choice: RpgChoice;
  resolution?: RpgChoiceResolution;
  failureReason?: string;
}): Promise<RpgChatTurnCandidate> {
  assertRpgArcActionAvailable(input.snapshot, input.choice);
  const fallbackStartedAt = performance.now();
  const resolution = input.resolution
    ? attachProceduralSceneReceipt(input.snapshot, input.resolution)
    : resolveRpgChatTurnLockedResult(input.snapshot, input.choice);
  const rawStory = buildDeterministicRpgTurnStory({
    snapshot: input.snapshot,
    choice: input.choice,
    resolution,
  });
  const story = await validateRpgStoryCandidateBeforePersistence({
    snapshot: input.snapshot,
    choice: input.choice,
    resolution,
    rawStory,
  });
  const candidateDigest = await sha256Hex(story.normalize("NFKC"));
  const contextDigest = input.snapshot.contextDigest;
  const modelDigest = await sha256Hex("rules-only:immersive-story-turn-contract-v1");
  const taskId = `rules-rpg-turn:${candidateDigest.slice(0, 24)}`;
  const fallbackGenerationMs = Math.max(0, performance.now() - fallbackStartedAt);
  return {
    schemaVersion: RPG_CHAT_TURN_SCHEMA_VERSION,
    taskId,
    candidateId: taskId,
    candidateDigest,
    storyDigest: candidateDigest,
    model: "rules-only",
    modelDigest,
    actualExecutor: "deterministic-rule-fallback",
    executionReceipt: withCausalKnowledgeReceipt({
      receiptId: `rules-receipt:${candidateDigest.slice(0, 24)}`,
      fallback: true,
      handoffReason: input.failureReason ?? "RPG_STORY_AI_UNAVAILABLE",
      fallbackGenerationMs,
      reason: input.failureReason ?? "RPG_STORY_AI_UNAVAILABLE",
      externalRequest: false,
      dataLeftDevice: false,
    }, input.snapshot),
    contextDigest,
    contextRevisionDigest: input.snapshot.contextRevisionDigest,
    contextRevisionGuard: structuredClone(input.snapshot.contextRevisionGuard),
    sourceChapterId: input.snapshot.chapter.id,
    sourceRevision: input.snapshot.chapter.revision,
    choice: input.choice,
    resolution,
    story,
    outcomeLines: buildRpgOutcomeLines(input.choice, resolution),
    canonicalMutationCount: 0,
    dataLeftDevice: false,
    externalRequest: false,
  };
}

export type DeterministicRpgFallbackDraftCandidate = Readonly<{
  key: string;
  story: string;
  digest: string;
}>;

const POST_FALLBACK_CLOSED_REVIEW_SCHEMA = "rpg-post-fallback-closed-review-v1" as const;

type PostFallbackClosedReviewReceiptBody = {
  schemaVersion: typeof POST_FALLBACK_CLOSED_REVIEW_SCHEMA;
  required: true;
  passed: true;
  /** Absent only on receipts created before the bounded continuity-repair stage existed. */
  reviewStage?: "fallback-review" | "fallback-repair";
  triggerReason: string;
  lockedOutcome: RpgChoiceResolution["outcome"];
  lockedEffectDigest: string;
  draftCount: 3;
  draftDigests: [string, string, string];
  reviewAttempts: number;
  reviewRequestDigest: string;
  applicationValidationBindingDigest: string;
  selectionRewriteEvidence: {
    taskId: string;
    candidateId: string;
    candidateContentDigest: string;
    provider: string;
    model: string;
    modelDigest: string;
    actualExecutor: string;
    attempts: number;
    requestContractDigest: string;
    upstreamExecutionReceiptDigest: string;
  };
};

type PostFallbackClosedReviewReceipt = PostFallbackClosedReviewReceiptBody & {
  receiptDigest: string;
};

function cryptographicDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

async function sealPostFallbackClosedReviewReceipt(
  body: PostFallbackClosedReviewReceiptBody,
): Promise<PostFallbackClosedReviewReceipt> {
  return {
    ...body,
    receiptDigest: await sha256Hex(stableStringify(body)),
  };
}

function invalidPostFallbackReceipt() {
  return Object.assign(new Error("後備複核收據與閉端候選證據不一致。"), {
    code: "RPG_FALLBACK_REVIEW_RECEIPT_INVALID",
  });
}

export async function verifyPostFallbackClosedReviewReceipt(input: {
  candidate: RpgChatTurnCandidate;
}) {
  const envelope = input.candidate.executionReceipt;
  const raw = envelope && typeof envelope === "object"
    ? (envelope as Record<string, unknown>).postFallbackClosedReview
    : null;
  const expected = /:fallback-(?:review(?::attempt-[1-9]\d{0,6})?|repair(?::quality-[a-f0-9]{4})?(?::attempt-[1-9]\d{0,6})?)$/u.test(
    input.candidate.taskId,
  ) || Boolean(raw);
  if (!expected) return null;
  if (!raw || typeof raw !== "object") throw invalidPostFallbackReceipt();
  const receipt = raw as PostFallbackClosedReviewReceipt;
  const { receiptDigest, ...body } = receipt;
  const evidence = receipt.selectionRewriteEvidence;
  const reviewStage = receipt.reviewStage ?? "fallback-review";
  if (
    receipt.schemaVersion !== POST_FALLBACK_CLOSED_REVIEW_SCHEMA
    || receipt.required !== true
    || receipt.passed !== true
    || receipt.draftCount !== 3
    || !Array.isArray(receipt.draftDigests)
    || receipt.draftDigests.length !== 3
    || !receipt.draftDigests.every(cryptographicDigest)
    || !Number.isSafeInteger(receipt.reviewAttempts)
    || receipt.reviewAttempts < 1
    || !cryptographicDigest(receipt.lockedEffectDigest)
    || !cryptographicDigest(receipt.reviewRequestDigest)
    || !cryptographicDigest(receipt.applicationValidationBindingDigest)
    || !cryptographicDigest(receiptDigest)
    || await sha256Hex(stableStringify(body)) !== receiptDigest
    || !evidence
    || !["fallback-review", "fallback-repair"].includes(reviewStage)
    || !(reviewStage === "fallback-repair"
      ? /:fallback-repair(?::quality-[a-f0-9]{4})?(?::attempt-[1-9]\d{0,6})?$/u.test(
          input.candidate.taskId,
        )
      : /:fallback-review(?::attempt-[1-9]\d{0,6})?$/u.test(
          input.candidate.taskId,
        ))
    || evidence.taskId !== input.candidate.taskId
    || evidence.candidateId !== input.candidate.candidateId
    || evidence.candidateContentDigest !== input.candidate.candidateDigest
    || evidence.model !== input.candidate.model
    || evidence.modelDigest !== input.candidate.modelDigest
    || evidence.actualExecutor !== input.candidate.actualExecutor
    || evidence.attempts !== receipt.reviewAttempts
    || !cryptographicDigest(evidence.requestContractDigest)
    || !cryptographicDigest(evidence.upstreamExecutionReceiptDigest)
    || receipt.lockedOutcome !== input.candidate.resolution.outcome
    || receipt.lockedEffectDigest !== await sha256Hex(
      stableStringify(input.candidate.resolution.effect),
    )
    || receipt.applicationValidationBindingDigest !== await sha256Hex(stableStringify({
      domain: reviewStage === "fallback-repair"
        ? "rpg-fallback-repair-application-validation-v1"
        : "rpg-fallback-review-application-validation-v1",
      reviewRequestDigest: receipt.reviewRequestDigest,
      sourceChapterId: input.candidate.sourceChapterId,
      sourceRevision: input.candidate.sourceRevision,
      lockedOutcome: receipt.lockedOutcome,
      lockedEffectDigest: receipt.lockedEffectDigest,
      draftDigests: receipt.draftDigests,
    }))
  ) throw invalidPostFallbackReceipt();
  return receipt;
}

function normalizedFallbackDraftText(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

/**
 * Deterministic stories are hidden source drafts, never reader-facing output.
 * A closed model must independently synthesize a new scene from the protected
 * turn contract. The three hidden drafts remain lineage evidence and are used
 * only to reject an unchanged or near-copy result; their prose is never placed
 * in the small-model prompt.
 */
export async function reviewDeterministicRpgFallbackDrafts(input: {
  drafts: readonly DeterministicRpgFallbackDraftCandidate[];
  recentAcceptedTexts: string[];
  language: StoryOutputLanguage;
  reviewer: (drafts: readonly DeterministicRpgFallbackDraftCandidate[]) => Promise<string>;
}) {
  if (input.drafts.length !== 3) {
    throw Object.assign(new Error("Closed RPG fallback review requires exactly three hidden drafts."), {
      code: "RPG_FALLBACK_DRAFT_COUNT_INVALID",
    });
  }
  const distinctDrafts = new Set<string>();
  const distinctDigests = new Set<string>();
  const validatedDrafts: string[] = [];
  for (const draft of input.drafts) {
    validateRpgContinuationNovelty(draft.story, input.recentAcceptedTexts);
    validateRpgStoryTurnContract(draft.story, input.language);
    const normalizedDraft = normalizedFallbackDraftText(draft.story);
    const expectedDigest = await sha256Hex(draft.story.normalize("NFKC"));
    if (!draft.key.trim() || draft.digest !== expectedDigest) {
      throw Object.assign(new Error("A hidden RPG fallback draft has invalid identity evidence."), {
        code: "RPG_FALLBACK_DRAFT_EVIDENCE_INVALID",
      });
    }
    distinctDrafts.add(normalizedDraft);
    distinctDigests.add(draft.digest);
    validatedDrafts.push(normalizedDraft);
  }
  if (distinctDrafts.size !== 3 || distinctDigests.size !== 3) {
    throw Object.assign(new Error("Closed RPG fallback review requires three distinct hidden drafts."), {
      code: "RPG_FALLBACK_DRAFT_VARIANTS_INSUFFICIENT",
    });
  }
  for (let left = 0; left < validatedDrafts.length; left += 1) {
    for (let right = left + 1; right < validatedDrafts.length; right += 1) {
      if (rpgTextSimilarity(validatedDrafts[left]!, validatedDrafts[right]!) >= 0.94) {
        throw Object.assign(new Error("Closed RPG fallback review requires meaningfully different hidden drafts."), {
          code: "RPG_FALLBACK_DRAFT_VARIANTS_INSUFFICIENT",
        });
      }
    }
  }
  const rawReview = await input.reviewer(input.drafts);
  if (!rawReview?.trim()) {
    throw Object.assign(new Error("Closed AI did not synthesize an independent RPG fallback scene."), {
      code: "RPG_FALLBACK_CLOSED_REVIEW_REQUIRED",
    });
  }
  const reviewedStory = await cleanRpgContinuation(rawReview, input.recentAcceptedTexts, input.language);
  const normalizedReviewedStory = normalizedFallbackDraftText(reviewedStory);
  if (
    distinctDrafts.has(normalizedReviewedStory)
    || validatedDrafts.some((draft) => rpgTextSimilarity(normalizedReviewedStory, draft) >= 0.94)
  ) {
    throw Object.assign(new Error("Closed AI returned an unchanged fallback draft instead of an independent scene."), {
      code: "RPG_FALLBACK_CLOSED_REVIEW_UNCHANGED",
    });
  }
  return reviewedStory;
}

function buildRpgFallbackReviewPrompt(input: {
  sceneContract: string;
}) {
  const prompt = [
    "[RPG_FALLBACK_INDEPENDENT_SYNTHESIS_V1]",
    "三份規則草稿僅留在應用程式內作血緣與近似度檢查，正文不會放進模型提示。請依下列受保護契約獨立寫出一份全新完整場景；只輸出標題與正文。",
    input.sceneContract,
    "[/RPG_FALLBACK_INDEPENDENT_SYNTHESIS_V1]",
  ].join("\n");
  if (prompt.length > 1_950) {
    throw Object.assign(new Error("RPG_FALLBACK_SYNTHESIS_PROMPT_BUDGET_EXCEEDED"), {
      code: "RPG_FALLBACK_SYNTHESIS_PROMPT_BUDGET_EXCEEDED",
      inputCharacters: prompt.length,
      maximumCharacters: 1_950,
    });
  }
  return prompt;
}

function buildRpgFallbackContinuityRepairPrompt(input: {
  sceneContract: string;
  failures: readonly RpgContinuityRepairFailure[];
  continuityExcerpt: string;
  activeCharacterNames: readonly string[];
}) {
  const requirementLabels: Record<RpgContinuityRepairFailure, string> = {
    length: "1200–1450字",
    paragraphs: "正文10個空行分隔段落",
    dialogue: "至少兩句完整「」對話",
    dialogue_attribution: "對話同段用具名人物說道／問道／答道",
    continuity_anchor: "首段逐字重用指定承接短句",
    active_character: "正文明寫指定主角名",
    offstage_character: "只用契約列出的人物",
    narrative_scene: "場景詞含門外與火光",
    action_progression: "動作詞含推開、握住、轉身",
    sensory_detail: "感官詞含聽見與冰冷",
    report_style: "只寫小說且不用清單或欄位標籤",
    causality: "正文明寫因此形成因果",
    foreshadowing: "正文明寫線索",
    serial_hook: "末220字含門外突然傳來聲音",
    repetition: "各段事件與句式不得重複",
  };
  const uniqueFailures = [...new Set(input.failures)];
  if (!uniqueFailures.length || uniqueFailures.some((failure) => (
    !RPG_CONTINUITY_REPAIR_FAILURE_ORDER.includes(failure)
  ))) {
    throw Object.assign(new Error("RPG_CONTINUITY_REPAIR_FAILURES_INVALID"), {
      code: "RPG_CONTINUITY_REPAIR_FAILURES_INVALID",
    });
  }
  const anchorRuns = input.continuityExcerpt.match(/[\p{Script=Han}]{4,}/gu) ?? [];
  const anchorSource = anchorRuns.at(-1) ?? "";
  const continuityAnchor = Array.from(anchorSource).slice(-8).join("");
  const activeCharacter = input.activeCharacterNames.find((name) => name.trim().length >= 2)?.trim()
    ?? "主角";
  const repairLine = `本次必補:${uniqueFailures.map((failure) => (
    requirementLabels[failure]
  )).join("；")}`;
  const visibleEvidenceLines = [
    `正文第一段須自然且逐字放入「${continuityAnchor || "最近正式正文尾"}」與「${activeCharacter}」。`,
    "場景中須自然寫出門外與火光；人物須依次推開、握住並轉身，也須聽見聲響並碰到冰冷物件。",
    `至少一段使用${activeCharacter}說道：「完整對話。」的句型；前因後果中須明寫「因此」，並留下明寫為「線索」的未解事物。`,
    "正文須有10個空行分隔段落；末220字須自然寫出「門外突然傳來聲音」，並以完整小說句號收尾。",
    "不得輸出「本次必補」、修復格式、規則、檢核、欄位或上述指令文字。",
  ];
  const contractLines = input.sceneContract.split("\n");
  const contractEndIndex = contractLines.lastIndexOf("[/RPG_SCENE_CONTRACT_V2]");
  if (contractEndIndex < 0) {
    throw Object.assign(new Error("RPG_FALLBACK_REPAIR_SCENE_CONTRACT_INVALID"), {
      code: "RPG_FALLBACK_REPAIR_SCENE_CONTRACT_INVALID",
    });
  }
  contractLines.splice(contractEndIndex, 0, repairLine, ...visibleEvidenceLines);
  let repairSceneContract = contractLines.join("\n");
  for (const optionalPrefix of ["既有資產:", "作品:", "場景:"]) {
    if (repairSceneContract.length <= 1_600) break;
    const optionalIndex = contractLines.findIndex((line) => line.startsWith(optionalPrefix));
    if (optionalIndex >= 0) contractLines.splice(optionalIndex, 1);
    repairSceneContract = contractLines.join("\n");
  }
  if (repairSceneContract.length > 1_600) {
    throw Object.assign(new Error("RPG_FALLBACK_REPAIR_SCENE_CONTRACT_BUDGET_EXCEEDED"), {
      code: "RPG_FALLBACK_REPAIR_SCENE_CONTRACT_BUDGET_EXCEEDED",
      inputCharacters: repairSceneContract.length,
      maximumCharacters: 1_600,
    });
  }
  const prompt = [
    "[RPG_FALLBACK_CONTINUITY_REPAIR_V1]",
    "前一份模型正文未通過連貫性檢查，已丟棄且不會提供。只依下列受保護契約重新獨立寫出全新場景。",
    "契約末行列出本次實際缺項；每一項都必須在正文中可直接辨認。只輸出標題與小說正文。",
    repairSceneContract,
    "[/RPG_FALLBACK_CONTINUITY_REPAIR_V1]",
  ].join("\n");
  if (prompt.length > 1_950) {
    throw Object.assign(new Error("RPG_FALLBACK_REPAIR_PROMPT_BUDGET_EXCEEDED"), {
      code: "RPG_FALLBACK_REPAIR_PROMPT_BUDGET_EXCEEDED",
      inputCharacters: prompt.length,
      maximumCharacters: 1_950,
    });
  }
  return prompt;
}

function rpgCandidateActiveCharacterNames(snapshot: RpgChatSnapshot) {
  const names = snapshot.characters.flatMap((character) => [
    character.name,
    ...(character.aliases ?? []),
  ]);
  return [...new Set(names.map((name) => name.trim()).filter((name) => name.length >= 2))];
}

/**
 * Side-effect-free application boundary shared by every RPG story executor.
 * It returns the one cleaned story that may proceed toward persistence; callers
 * must never persist the raw candidate before this promise resolves.
 *
 * `snapshot.characters` is already the era-compatible active StoryState cast.
 * The snapshot deliberately does not carry the project-wide inactive library,
 * so we do not guess offstage names and accidentally reject a legitimate
 * entrance by a newly staged actor.
 */
export async function validateRpgStoryCandidateBeforePersistence(input: {
  snapshot: RpgChatSnapshot;
  choice: RpgChoice;
  resolution: RpgChoiceResolution;
  rawStory: string;
  recentAcceptedTexts?: string[];
  prompt?: string;
  /** Safe display-name allowlist derived from scope-bound adult runtime evidence. */
  adultParticipantDisplayNames?: readonly string[];
}) {
  const recentAcceptedTexts = input.recentAcceptedTexts
    ?? recentRpgStoryTexts(input.snapshot);
  const story = await cleanRpgContinuation(
    input.rawStory,
    recentAcceptedTexts,
    input.snapshot.language,
    input.prompt,
  );
  if (input.snapshot.project.adultMode) {
    if (!input.adultParticipantDisplayNames?.length) {
      throw Object.assign(new Error("成人 RPG 正文缺少當回合安全證據綁定。"), {
        code: "RPG_ADULT_RUNTIME_EVIDENCE_REQUIRED",
      });
    }
    assertAdultNarrativeFadeToBlackOutput(story);
    assertAdultNarrativeParticipantsAuthorized({
      story,
      allowedParticipantDisplayNames: input.adultParticipantDisplayNames,
      knownCharacterDisplayNames: rpgCandidateActiveCharacterNames(input.snapshot),
    });
  }
  const continuityWindow = selectRecentRpgContinuityTexts(input.snapshot, 8);
  const continuityExcerpt = [
    ...continuityWindow.chapterTails,
    ...continuityWindow.acceptedTexts,
  ].at(-1) ?? "";
  const nextAction = input.choice.encounter.arcNextAction
    ?? (input.choice.encounter.arcPhase === "resolution" ? "resolution" : null);
  const terminalClosure = nextAction === "resolution"
    || nextAction === "epilogue"
    || nextAction === "archive-ending";
  const continuityGate = evaluateNovelContinuityGate({
    prose: story,
    language: input.snapshot.language,
    minimumHanCharacters: input.snapshot.language === "en" ? 0 : 760,
    minimumCharacters: input.snapshot.language === "en" ? 950 : 900,
    minimumParagraphs: 8,
    minimumDialogueCount: 1,
    continuityExcerpt,
    activeCharacterNames: rpgCandidateActiveCharacterNames(input.snapshot),
    // Offstage is intentionally empty: only the active cast is available in an
    // immutable RPG snapshot, and absence from that subset is not proof that a
    // character cannot enter this scene.
    offstageCharacterNames: [],
    requireForeshadowing: !terminalClosure,
    requireSerialHook: !terminalClosure,
  });
  if (!continuityGate.passed) {
    throw Object.assign(new Error("RPG_NOVEL_CONTINUITY_GATE_FAILED"), {
      code: "RPG_NOVEL_CONTINUITY_GATE_FAILED",
      continuityFailures: continuityGate.failures,
      qualityReasonCodes: [...new Set(continuityGate.failures.map((failure) => {
        if (failure === "length") return "QUALITY_NARRATIVE_TOO_SHORT";
        if (failure === "continuity_anchor") return "QUALITY_CONTEXT_ANCHOR_MISSING";
        if (failure === "active_character") return "QUALITY_CONTEXT_CHARACTER_MISSING";
        if (failure === "repetition") return "QUALITY_REPETITION_LOW";
        return "QUALITY_CONTINUITY_LOW";
      }))],
      ...continuityGate.metrics,
    });
  }
  validateRpgContinuationNovelty(story, recentAcceptedTexts);
  validateRpgStoryTurnContract(story, input.snapshot.language);
  validateRpgOutcomeNarrative(
    story,
    input.resolution,
    input.snapshot.language,
    input.choice,
  );
  return story;
}

export async function generateRpgChatTurnCandidate(input: {
  snapshot: RpgChatSnapshot;
  choice: RpgChoice;
  /** Stable identity used to replay the same durable Closed Agent candidate after a UI crash. */
  logicalTurnId?: string;
  /** Exact completed provider task to replay; fallback receipts must bypass the generation stage. */
  resumeProviderTaskId?: string;
  signal?: AbortSignal;
  onProgress?: (event: ClosedAIProgressEvent) => void;
  coordinationDependencies?: RpgClosedAIDeadlineDependencies;
  /** Complete deadline reserved for closed-AI story generation. Defaults to 360 seconds. */
  generationDeadlineMs?: number;
  /** Independent hidden fallback-review deadline. Defaults to 360 seconds. */
  fallbackReviewDeadlineMs?: number;
  /** Explicit, scope-bound adult structural request. Never inferred from adultMode alone. */
  adultNarrativeRuntime?: Omit<
    AdultNarrativeRuntimeBindingInput,
    "project" | "characters" | "scopeId" | "executionSource" | "evaluatedAt"
  > | null;
  /** Adapter-owned clock. Caller-provided evidence timestamps never control evaluation time. */
  adultNarrativeRuntimeClock?: () => Date;
  closedAIInvoker?: (
    request: Parameters<typeof runStudioClosedAI>[0],
  ) => ReturnType<typeof runStudioClosedAI>;
}): Promise<RpgChatTurnCandidate> {
  assertRpgArcActionAvailable(input.snapshot, input.choice);
  const resolution = resolveRpgChatTurnLockedResult(input.snapshot, input.choice);
  const outcomeLines = buildRpgOutcomeLines(input.choice, resolution);
  const logicalTurnId = input.logicalTurnId?.normalize("NFKC").trim() ?? "";
  if (input.snapshot.project.adultMode && !input.adultNarrativeRuntime) {
    throw Object.assign(new Error("成人 RPG 必須先取得當回合、可撤回且仍有效的本機安全證據。"), {
      code: "RPG_ADULT_RUNTIME_EVIDENCE_REQUIRED",
    });
  }
  const adultRuntimeEvaluationDate = input.adultNarrativeRuntime
    ? (input.adultNarrativeRuntimeClock?.() ?? new Date())
    : null;
  const adultRuntimeEvaluatedAt = adultRuntimeEvaluationDate
    && Number.isFinite(adultRuntimeEvaluationDate.getTime())
    ? adultRuntimeEvaluationDate.toISOString()
    : "invalid-adapter-clock";
  const adultRuntimeBinding = input.adultNarrativeRuntime
    ? bindAdultNarrativeRuntime({
        ...input.adultNarrativeRuntime,
        project: input.snapshot.project,
        characters: input.snapshot.characters,
        scopeId: logicalTurnId || [
          "rpg-adult-runtime",
          input.snapshot.project.id,
          input.snapshot.chapter.id,
          input.snapshot.chapter.revision,
          input.choice.key,
        ].join(":"),
        executionSource: "closed-ai",
        evaluatedAt: adultRuntimeEvaluatedAt,
      })
    : null;
  if (input.adultNarrativeRuntime && !adultRuntimeBinding?.applicable) {
    throw Object.assign(new Error("成人敘事結構只可用於已啟用且通過當回合安全證據的成人作品。"), {
      code: "ADULT_NARRATIVE_RUNTIME_NOT_APPLICABLE",
    });
  }
  const adultRuntimePrompt = adultRuntimeBinding
    ? formatAdultNarrativeRuntimePromptBinding(adultRuntimeBinding)
    : null;
  const adultRuntimePolicyDigests = adultRuntimeBinding?.applicable
    && adultRuntimePrompt
    ? await createRpgAdultRuntimePolicyBindingDigests({
        binding: adultRuntimeBinding,
        promptBinding: adultRuntimePrompt,
      })
    : null;
  const readerSafeCausalContract = buildRpgReaderSafeCausalPayload({
    snapshot: input.snapshot,
    choice: input.choice,
    outcome: resolution.outcome,
  });
  const fullDirectorPrompt = buildRpgResolutionDirectorPrompt({
    context: input.snapshot.directorContext,
    choice: input.choice,
    language: input.snapshot.language,
    turnNumber: input.snapshot.progression.turn + 1,
    resolution: {
      outcomeLabel: resolution.outcomeLabel,
      roll: resolution.roll,
      successChance: resolution.successChance,
      settlement: outcomeLines,
    },
    readerSafeCausalContract,
  });
  const fullDirectorContractDigest = await sha256Hex(fullDirectorPrompt);
  const baseDirectorPrompt = buildCompactRpgResolutionDirectorPrompt({
    context: input.snapshot.directorContext,
    choice: input.choice,
    language: input.snapshot.language,
    resolution: {
      outcomeLabel: resolution.outcomeLabel,
      settlement: outcomeLines,
    },
  });
  const rpgProseContractDigest = await sha256Hex(baseDirectorPrompt);
  const directorPrompt = adultRuntimePrompt
    ? `${baseDirectorPrompt}\n\n${adultRuntimePrompt}`
    : baseDirectorPrompt;
  const recentContinuity = selectRecentRpgContinuityTexts(input.snapshot, 8);
  const recentAcceptedTexts = [
    ...recentContinuity.chapterTails,
    ...recentContinuity.acceptedTexts,
  ];
  const fallbackReviewContinuityTexts = [
    ...recentContinuity.chapterTails.slice(-1),
    ...recentContinuity.acceptedTexts.slice(-3),
  ];
  const baseSeed = (
    input.snapshot.storyState.revision * 1009
    + input.snapshot.progression.turn * 149
    + resolution.roll * 23
  ) >>> 0;
  const invokeClosedAI = input.closedAIInvoker ?? ((request: Parameters<typeof runStudioClosedAI>[0]) => (
    runStudioClosedAI(request)
  ));
  const generationRunRoot = logicalTurnId ? "" : `rpg-turn:${crypto.randomUUID()}`;
  const resumeProviderTaskId = input.resumeProviderTaskId?.normalize("NFKC").trim() ?? "";
  const resumeIdentity = resumeProviderTaskId && logicalTurnId
    ? await parseRpgLogicalTurnProviderTaskId(logicalTurnId, resumeProviderTaskId)
    : null;
  if (resumeProviderTaskId && !resumeIdentity) {
    throw Object.assign(new Error("RPG logical-turn recovery receipt has an unexpected provider task."), {
      code: "RPG_CHAT_RECOVERY_PROVIDER_TASK_MISMATCH",
    });
  }
  const resumeReviewStage = resumeIdentity?.stage === "fallback-review"
    || resumeIdentity?.stage === "fallback-repair"
      ? resumeIdentity.stage
      : null;
  const resumeClosedReview = Boolean(resumeReviewStage);
  const logicalAttempt = resumeIdentity?.attempt ?? 1;
  const generationStartAttempt = resumeClosedReview
    ? 1
    : logicalAttempt;
  // Each explicit author attempt owns two non-overlapping fallback slots: the
  // odd slot is the primary review/repair and the following even slot is the
  // single bounded repetition-only retry. A later author retry therefore
  // cannot reuse a failed internal repair task id.
  const fallbackReviewStartAttempt = resumeClosedReview
    ? logicalAttempt
    : logicalAttempt * 2 - 1;
  const providerTaskId = async (
    stage: "generation" | "fallback-review" | "fallback-repair",
    attempt: number,
    repairFailures?: readonly RpgContinuityRepairFailure[],
  ) => {
    if (
      resumeIdentity
      && resumeIdentity.stage === stage
      && resumeIdentity.attempt === attempt
    ) return resumeIdentity.taskId;
    if (logicalTurnId) {
      if (stage === "generation") {
        return rpgLogicalTurnGenerationTaskId(logicalTurnId, attempt);
      }
      return stage === "fallback-repair"
        ? rpgLogicalTurnFallbackRepairTaskId(
            logicalTurnId,
            repairFailures ?? (() => { throw new Error(
              "RPG_CONTINUITY_REPAIR_FAILURES_REQUIRED",
            ); })(),
            attempt,
          )
        : rpgLogicalTurnFallbackReviewTaskId(logicalTurnId, attempt);
    }
    if (stage === "fallback-repair") {
      const failureToken = rpgContinuityRepairFailureToken(
        repairFailures ?? (() => { throw new Error(
          "RPG_CONTINUITY_REPAIR_FAILURES_REQUIRED",
        ); })(),
      );
      return `${generationRunRoot}:${stage}:quality-${failureToken}:attempt-${attempt}`;
    }
    return `${generationRunRoot}:${stage}:attempt-${attempt}`;
  };
  let generated: Awaited<ReturnType<typeof runStudioClosedAI>> | null = null;
  let story = "";
  let generationError: unknown = null;
  let fallbackReviewReceipt: PostFallbackClosedReviewReceipt | null = null;
  let acceptedAdultApplicationValidationBaseDigest: string | null = null;
  try {
    if (resumeClosedReview) {
      throw Object.assign(new Error("Resume the durable closed-review provider task."), {
        code: resumeReviewStage === "fallback-repair"
          ? "RPG_STORY_AI_RESUME_FALLBACK_REPAIR"
          : "RPG_STORY_AI_RESUME_FALLBACK_REVIEW",
      });
    }
    const generationDeadlineMs = Math.max(
      1,
      input.generationDeadlineMs ?? RPG_CHAT_STORY_AI_TIMEOUT_MS,
    );
    const coordinated = await runRpgClosedAIUntilDeadline({
      deadlineMs: generationDeadlineMs,
      startAttempt: generationStartAttempt,
      signal: input.signal,
      dependencies: input.coordinationDependencies,
      execute: async (attempt, attemptSignal) => {
        let prevalidatedStory = "";
        const attemptPrompt = directorPrompt;
        const attemptTaskId = await providerTaskId("generation", attempt);
        const baseApplicationValidationBindingDigest = await sha256Hex(stableStringify({
          domain: "rpg-story-application-validation-v1",
          promptDigest: await sha256Hex(attemptPrompt),
          fullDirectorContractDigest,
          rpgProseContractDigest,
          contextDigest: input.snapshot.contextDigest,
          contextRevisionDigest: input.snapshot.contextRevisionDigest,
          causalKnowledgeSnapshotDigest: input.snapshot.causalKnowledge.snapshotDigest,
          projectId: input.snapshot.project.id,
          sourceChapterId: input.snapshot.chapter.id,
          sourceRevision: input.snapshot.chapter.revision,
          storyStateRevision: input.snapshot.storyState.revision,
          choiceKey: input.choice.key,
          lockedOutcome: resolution.outcome,
          lockedEffectDigest: await sha256Hex(stableStringify(resolution.effect)),
          recentAcceptedTextDigests: await Promise.all(
            recentAcceptedTexts.map((text) => sha256Hex(text)),
          ),
          activeCharacterIdentityDigest: await sha256Hex(stableStringify(
            rpgCandidateActiveCharacterNames(input.snapshot),
          )),
          adultOutputPolicy: input.snapshot.project.adultMode
            ? "structural-fade-to-black-v1"
            : "standard-rpg-prose-v1",
        }));
        const applicationValidationBindingDigest = adultRuntimePolicyDigests
          ? await bindRpgAdultApplicationValidationDigest({
              baseApplicationValidationDigest:
                baseApplicationValidationBindingDigest,
              policyDigests: adultRuntimePolicyDigests,
            })
          : baseApplicationValidationBindingDigest;
        const attemptResult = await invokeClosedAI({
          projectId: input.snapshot.project.id,
          task: "branch_choice",
          taskId: attemptTaskId,
          input: attemptPrompt,
          targetLength: input.snapshot.language === "en" ? 1_700 : 1_600,
          sourceChapterId: input.snapshot.chapter.id,
          sourceRevision: input.snapshot.chapter.revision,
          // A substantive RPG turn already uses the same local model's bounded
          // supplement pass and then crosses the RPG application validator
          // before persistence. Running the generic balanced pipeline would
          // ask a CPU-bound local model for a second complete 900+ character
          // scene and exceed this turn's explicit 360-second deadline.
          qualityMode: "fast",
          browserComputePolicy: "quality-first",
          applicationValidationBindingDigest,
          validateBeforePersistence: async (candidate) => {
            prevalidatedStory = await validateRpgStoryCandidateBeforePersistence({
              snapshot: input.snapshot,
              choice: input.choice,
              resolution,
              rawStory: candidate.content,
              recentAcceptedTexts,
              prompt: attemptPrompt,
              adultParticipantDisplayNames: adultRuntimeBinding?.applicable
                ? adultRuntimeBinding.participantDisplayNames
                : undefined,
            });
          },
          generationOptions: {
            maxTokens: 1_792,
            temperature: attempt === 1 ? 0.72 : 0.66,
            topP: attempt === 1 ? 0.92 : 0.88,
            repetitionPenalty: 1.18,
            seed: (baseSeed + (attempt - 1) * 104_729) >>> 0,
            substantiveScene: true,
          },
          signal: attemptSignal,
          onProgress: input.onProgress,
        });
        try {
          // Injected integration invokers do not necessarily execute the OS
          // pre-persistence callback. They still cross the identical boundary
          // here before their content can become a returned chat candidate.
          const attemptStory = prevalidatedStory || await validateRpgStoryCandidateBeforePersistence({
            snapshot: input.snapshot,
            choice: input.choice,
            resolution,
            rawStory: attemptResult.content,
            recentAcceptedTexts,
            prompt: attemptPrompt,
            adultParticipantDisplayNames: adultRuntimeBinding?.applicable
              ? adultRuntimeBinding.participantDisplayNames
              : undefined,
          });
          if (
            !hasVerifiedExecutedStoryOutput(attemptResult)
            || !attemptResult.candidateId
            || !attemptResult.modelDigest
            || attemptResult.taskId !== attemptTaskId
            || attemptResult.executionReceipt?.taskId !== attemptTaskId
            || attemptResult.sourceChapterId !== input.snapshot.chapter.id
            || attemptResult.sourceRevision !== input.snapshot.chapter.revision
            || attemptResult.canonicalMutationCount !== 0
            || attemptResult.externalRequest
            || attemptResult.dataLeftDevice
            || attemptResult.applicationValidationBindingDigest
              !== applicationValidationBindingDigest
          ) {
            throw Object.assign(new Error("閉端 AI 本回合內容缺少模型、章節或執行證明。"), {
              code: "RPG_CHAT_TURN_PROOF_MISSING",
            });
          }
          return {
            generated: attemptResult,
            story: attemptStory,
            baseApplicationValidationBindingDigest,
          };
        } catch (error) {
          if (attemptResult.candidateId) {
            await rejectStudioClosedAgentCandidate(attemptResult.candidateId).catch(() => undefined);
          }
          throw error;
        }
      },
    });
    generated = coordinated.value.generated;
    story = coordinated.value.story;
    acceptedAdultApplicationValidationBaseDigest = adultRuntimePolicyDigests
      ? coordinated.value.baseApplicationValidationBindingDigest
      : null;
  } catch (error) {
    if (input.signal?.aborted) throw error;
    generationError = error;
    if (generated?.candidateId) {
      await rejectStudioClosedAgentCandidate(generated.candidateId).catch(() => undefined);
    }
    generated = null;
    const triggerReason = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "RPG_STORY_AI_UNAVAILABLE")
      : "RPG_STORY_AI_UNAVAILABLE";
    const generationContinuityFailures = rpgNovelContinuityFailures(error);
    if (
      !resumeClosedReview
      && !rpgStoryRuleFallbackReason(error)
      && !generationContinuityFailures
    ) {
      throw error;
    }
    const reviewStage: "fallback-review" | "fallback-repair" =
      resumeReviewStage
      ?? (generationContinuityFailures ? "fallback-repair" : "fallback-review");
    const repairFailures: RpgContinuityRepairFailure[] | null =
      reviewStage === "fallback-repair"
        ? (
            resumeIdentity?.repairFailures
            ?? generationContinuityFailures
            ?? [...RPG_CONTINUITY_REPAIR_FAILURE_ORDER]
          )
        : null;
    const drafts: DeterministicRpgFallbackDraftCandidate[] = [];
    const seenDraftDigests = new Set<string>();
    const seenDraftStories: string[] = [];
    for (let variation = 0; variation < 24 && drafts.length < 3; variation += 1) {
      try {
        const draft = buildDeterministicRpgTurnStory({
          snapshot: input.snapshot,
          choice: input.choice,
          resolution,
          variation,
        });
        validateRpgContinuationNovelty(draft, recentAcceptedTexts);
        validateRpgStoryTurnContract(draft, input.snapshot.language);
        validateRpgOutcomeNarrative(draft, resolution, input.snapshot.language, input.choice);
        const digest = await sha256Hex(draft.normalize("NFKC"));
        const normalizedDraft = normalizedFallbackDraftText(draft);
        if (
          seenDraftDigests.has(digest)
          || seenDraftStories.some((previous) => rpgTextSimilarity(previous, normalizedDraft) >= 0.94)
        ) continue;
        seenDraftDigests.add(digest);
        seenDraftStories.push(normalizedDraft);
        drafts.push({
          key: `draft-${drafts.length + 1}`,
          story: draft,
          digest,
        });
      } catch {
        // Invalid internal drafts are discarded silently and can never become
        // reader-facing candidates or be persisted by the caller.
      }
    }
    if (drafts.length !== 3) {
      throw Object.assign(new Error("無法建立三份通過品質閘門的內部草稿，沒有產生可顯示正文。請重試。"), {
        code: "RPG_FALLBACK_DRAFT_VARIANTS_INSUFFICIENT",
        generationFailure: triggerReason,
        draftCount: drafts.length,
      });
    }
    const draftDigests = drafts.map((draft) => draft.digest) as [string, string, string];
    const lockedEffectDigest = await sha256Hex(stableStringify(resolution.effect));
    let latestReviewContinuityFailures: RpgContinuityRepairFailure[] | null = null;
    try {
      if (input.signal?.aborted) {
        throw input.signal.reason ?? generationError;
      }
      const reviewDeadlineMs = Math.min(
        RPG_CHAT_FALLBACK_REVIEW_TIMEOUT_MS,
        Math.max(
          1,
          input.fallbackReviewDeadlineMs ?? RPG_CHAT_FALLBACK_REVIEW_TIMEOUT_MS,
        ),
      );
      const baseReviewPrompt = reviewStage === "fallback-repair"
        ? buildRpgFallbackContinuityRepairPrompt({
            sceneContract: baseDirectorPrompt,
            failures: repairFailures ?? [...RPG_CONTINUITY_REPAIR_FAILURE_ORDER],
            continuityExcerpt: fallbackReviewContinuityTexts.at(-1) ?? "",
            activeCharacterNames: rpgCandidateActiveCharacterNames(input.snapshot),
          })
        : buildRpgFallbackReviewPrompt({
            sceneContract: baseDirectorPrompt,
          });
      const reviewPrompt = adultRuntimePrompt
        ? `${baseReviewPrompt}\n\n${adultRuntimePrompt}`
        : baseReviewPrompt;
      const reviewRequestDigest = await sha256Hex(reviewPrompt);
      const baseApplicationValidationBindingDigest = await sha256Hex(stableStringify({
        domain: reviewStage === "fallback-repair"
          ? "rpg-fallback-repair-application-validation-v1"
          : "rpg-fallback-review-application-validation-v1",
        reviewRequestDigest,
        sourceChapterId: input.snapshot.chapter.id,
        sourceRevision: input.snapshot.chapter.revision,
        lockedOutcome: resolution.outcome,
        lockedEffectDigest,
        draftDigests,
      }));
      const applicationValidationBindingDigest = adultRuntimePolicyDigests
        ? await bindRpgAdultApplicationValidationDigest({
            baseApplicationValidationDigest:
              baseApplicationValidationBindingDigest,
            policyDigests: adultRuntimePolicyDigests,
          })
        : baseApplicationValidationBindingDigest;
      const reviewed = await runRpgClosedAIUntilDeadline({
        deadlineMs: reviewDeadlineMs,
        startAttempt: fallbackReviewStartAttempt,
        maximumDispatches:
          reviewStage === "fallback-repair"
          && repairFailures?.length === 1
          && repairFailures[0] === "repetition"
          && fallbackReviewStartAttempt % 2 === 1
            ? 2
            : 1,
        retryAfterDispatch: ({ error }) => {
          if (
            reviewStage !== "fallback-repair"
            || repairFailures?.length !== 1
            || repairFailures[0] !== "repetition"
          ) return false;
          const retryFailures = rpgNovelContinuityFailures(error);
          const retryAuthorized = retryFailures?.length === 1
            && retryFailures[0] === "repetition";
          if (retryAuthorized) {
            // A fresh readiness phase has no application-validation result yet.
            // Clear the rejected attempt now, before the next execute callback,
            // so a probe timeout cannot surface stale repetition diagnostics.
            latestReviewContinuityFailures = null;
          }
          return retryAuthorized;
        },
        signal: input.signal,
        dependencies: input.coordinationDependencies,
        execute: async (attempt, attemptSignal) => {
          latestReviewContinuityFailures = null;
          let prevalidatedStory = "";
          const reviewTaskId = await providerTaskId(
            reviewStage,
            attempt,
            repairFailures ?? undefined,
          );
          const reviewResult = await invokeClosedAI({
            projectId: input.snapshot.project.id,
            task: "branch_choice",
            taskId: reviewTaskId,
            input: reviewPrompt,
            targetLength: input.snapshot.language === "en" ? 1_700 : 1_600,
            sourceChapterId: input.snapshot.chapter.id,
            sourceRevision: input.snapshot.chapter.revision,
            // The hidden-draft path still requires a verified closed-model
            // rewrite and the identical RPG application validator. Keep it to
            // one bounded quality pipeline so the review deadline is
            // truthful instead of starting an impossible second full rewrite.
            qualityMode: "fast",
            browserComputePolicy: "quality-first",
            ephemeralPrompt: true,
            applicationValidationBindingDigest,
            validateBeforePersistence: async (candidate) => {
              if (
                !candidate.executionReceipt
                || candidate.executionReceipt.proofState !== "verified"
                || candidate.executionReceipt.taskId !== candidate.taskId
                || candidate.executionReceipt.contentDigest !== candidate.contentDigest
                || candidate.executionReceipt.modelDigest !== candidate.modelDigest
                || candidate.sourceChapterId !== input.snapshot.chapter.id
                || candidate.sourceRevision !== input.snapshot.chapter.revision
                || candidate.canonicalMutationCount !== 0
                || candidate.externalRequest
                || candidate.dataLeftDevice
              ) {
                throw Object.assign(new Error("規則草稿缺少閉端 AI 複核證明。"), {
                  code: "RPG_FALLBACK_CLOSED_REVIEW_PROOF_MISSING",
                });
              }
              try {
                prevalidatedStory = await reviewDeterministicRpgFallbackDrafts({
                  drafts,
                  recentAcceptedTexts: fallbackReviewContinuityTexts,
                  language: input.snapshot.language,
                  reviewer: async () => candidate.content,
                });
                prevalidatedStory = await validateRpgStoryCandidateBeforePersistence({
                  snapshot: input.snapshot,
                  choice: input.choice,
                  resolution,
                  rawStory: prevalidatedStory,
                  recentAcceptedTexts: fallbackReviewContinuityTexts,
                  prompt: reviewPrompt,
                  adultParticipantDisplayNames: adultRuntimeBinding?.applicable
                    ? adultRuntimeBinding.participantDisplayNames
                    : undefined,
                });
              } catch (validationError) {
                latestReviewContinuityFailures = rpgNovelContinuityFailures(validationError);
                throw validationError;
              }
            },
            generationOptions: {
              maxTokens: 1_792,
              temperature: Math.min(0.78, 0.62 + (attempt - 1) * 0.03),
              topP: 0.9,
              repetitionPenalty: 1.2,
              seed: (baseSeed + 7_919 + (attempt - 1) * 104_729) >>> 0,
              substantiveScene: true,
            },
            signal: attemptSignal,
            onProgress: input.onProgress,
          });
          try {
            if (
              !hasVerifiedExecutedStoryOutput(reviewResult)
              || !reviewResult.candidateId
              || !reviewResult.modelDigest
              || reviewResult.taskId !== reviewTaskId
              || reviewResult.executionReceipt?.taskId !== reviewTaskId
              || reviewResult.sourceChapterId !== input.snapshot.chapter.id
              || reviewResult.sourceRevision !== input.snapshot.chapter.revision
              || reviewResult.canonicalMutationCount !== 0
              || reviewResult.externalRequest
              || reviewResult.dataLeftDevice
              || reviewResult.applicationValidationBindingDigest
                !== applicationValidationBindingDigest
            ) {
              throw Object.assign(new Error("規則草稿缺少閉端 AI 複核證明。"), {
                code: "RPG_FALLBACK_CLOSED_REVIEW_PROOF_MISSING",
              });
            }
            // Injected invokers are unpersisted test/integration seams and do
            // not execute the OS pre-persistence callback. They still pass the
            // exact same application validator before leaving this function.
            const reviewedStory = prevalidatedStory || await reviewDeterministicRpgFallbackDrafts({
              drafts,
              recentAcceptedTexts: fallbackReviewContinuityTexts,
              language: input.snapshot.language,
              reviewer: async () => reviewResult.content,
            });
            const validatedReviewedStory = prevalidatedStory || await validateRpgStoryCandidateBeforePersistence({
              snapshot: input.snapshot,
              choice: input.choice,
              resolution,
              rawStory: reviewedStory,
              recentAcceptedTexts: fallbackReviewContinuityTexts,
              prompt: reviewPrompt,
              adultParticipantDisplayNames: adultRuntimeBinding?.applicable
                ? adultRuntimeBinding.participantDisplayNames
                : undefined,
            });
            return {
              generated: reviewResult,
              story: validatedReviewedStory,
              reviewRequestDigest,
              baseApplicationValidationBindingDigest,
              applicationValidationBindingDigest,
            };
          } catch (reviewError) {
            if (reviewResult.candidateId) {
              await rejectStudioClosedAgentCandidate(reviewResult.candidateId).catch(() => undefined);
            }
            throw reviewError;
          }
        },
      });
      generated = reviewed.value.generated;
      story = reviewed.value.story;
      acceptedAdultApplicationValidationBaseDigest = adultRuntimePolicyDigests
        ? reviewed.value.baseApplicationValidationBindingDigest
        : null;
      const requestContractDigest = (generated as {
        requestContractDigest?: unknown;
      }).requestContractDigest;
      if (!cryptographicDigest(requestContractDigest)) {
        throw Object.assign(new Error("規則草稿缺少閉端 AI 請求契約證明。"), {
          code: "RPG_FALLBACK_CLOSED_REVIEW_PROOF_MISSING",
        });
      }
      const upstreamExecutionReceiptDigest = await sha256Hex(
        stableStringify(generated.executionReceipt),
      );
      fallbackReviewReceipt = await sealPostFallbackClosedReviewReceipt({
        schemaVersion: POST_FALLBACK_CLOSED_REVIEW_SCHEMA,
        required: true,
        passed: true,
        reviewStage,
        triggerReason,
        lockedOutcome: resolution.outcome,
        lockedEffectDigest,
        draftCount: 3,
        draftDigests,
        reviewAttempts: reviewed.attempts,
        reviewRequestDigest: reviewed.value.reviewRequestDigest,
        applicationValidationBindingDigest:
          reviewed.value.applicationValidationBindingDigest,
        selectionRewriteEvidence: {
          taskId: generated.taskId,
          candidateId: generated.candidateId,
          candidateContentDigest: generated.contentDigest,
          provider: generated.provider,
          model: generated.model,
          modelDigest: generated.modelDigest,
          actualExecutor: generated.actualExecutor,
          attempts: reviewed.attempts,
          requestContractDigest,
          upstreamExecutionReceiptDigest,
        },
      });
    } catch (reviewError) {
      if (input.signal?.aborted) {
        throw input.signal.reason ?? reviewError;
      }
      throw Object.assign(new Error("閉端 AI 未完成本回合品質複核，沒有產生可顯示的正文。請重試。"), {
        code: "RPG_FALLBACK_CLOSED_REVIEW_REQUIRED",
        cause: reviewError,
        reviewFailureCode: reviewError && typeof reviewError === "object" && "code" in reviewError
          ? String((reviewError as { code?: unknown }).code ?? "RPG_FALLBACK_REVIEW_FAILED")
          : "RPG_FALLBACK_REVIEW_FAILED",
        reviewFailureLeafCode: safeRpgFailureLeafCode(reviewError),
        generationFailureLeafCode: safeRpgFailureLeafCode(generationError),
        reviewContinuityFailures:
          latestReviewContinuityFailures
          ?? rpgNovelContinuityFailures(reviewError)
          ?? [],
        generationContinuityFailures: rpgNovelContinuityFailures(generationError) ?? [],
        generationFailure: triggerReason,
        draftCount: 3,
      });
    }
  }
  if (!generated || !story) throw generationError ?? new Error("RPG_AI_CONTINUATION_EMPTY");
  const generatedReceipt = generated.executionReceipt && typeof generated.executionReceipt === "object"
    ? generated.executionReceipt as Record<string, unknown>
    : { upstreamReceipt: generated.executionReceipt ?? null };
  const adultPolicyReceipt = adultRuntimeBinding?.applicable && adultRuntimePrompt
    ? await sealRpgAdultRuntimePolicyReceipt({
        binding: adultRuntimeBinding,
        promptBinding: adultRuntimePrompt,
        baseApplicationValidationDigest:
          acceptedAdultApplicationValidationBaseDigest
          ?? (() => { throw Object.assign(
            new Error("成人 RPG 候選缺少應用層安全綁定。"),
            { code: "RPG_ADULT_RUNTIME_POLICY_RECEIPT_INVALID" },
          ); })(),
        candidate: generated,
      })
    : null;
  const finalCandidate: RpgChatTurnCandidate = {
    schemaVersion: RPG_CHAT_TURN_SCHEMA_VERSION,
    taskId: generated.taskId,
    candidateId: generated.candidateId,
    candidateDigest: generated.contentDigest,
    storyDigest: await sha256Hex(story.normalize("NFKC")),
    model: generated.model,
    modelDigest: generated.modelDigest,
    actualExecutor: generated.actualExecutor,
    executionReceipt: withCausalKnowledgeReceipt({
      ...generatedReceipt,
      rpgProseContractDigest,
      ...(fallbackReviewReceipt ? { postFallbackClosedReview: fallbackReviewReceipt } : {}),
      ...(adultPolicyReceipt ? { adultNarrativeRuntime: adultPolicyReceipt } : {}),
    }, input.snapshot),
    contextDigest: input.snapshot.contextDigest,
    contextRevisionDigest: input.snapshot.contextRevisionDigest,
    contextRevisionGuard: structuredClone(input.snapshot.contextRevisionGuard),
    sourceChapterId: input.snapshot.chapter.id,
    sourceRevision: input.snapshot.chapter.revision,
    choice: input.choice,
    resolution,
    story,
    outcomeLines,
    canonicalMutationCount: 0,
    dataLeftDevice: false,
    externalRequest: false,
  };
  await verifyRpgAdultRuntimePolicyReceipt({
    candidate: finalCandidate,
    snapshot: input.snapshot,
    authoritativeClosedCandidate: generated,
  });
  return finalCandidate;
}

export async function approveRpgChatTurn(input: {
  repository: NovelRepository;
  snapshot: RpgChatSnapshot;
  candidate: RpgChatTurnCandidate;
  conversationApproval?: AcceptChoiceConversationApprovalInput;
  afterCanonicalCommit?: (result: {
    commitId: string;
    resultingRevision: number;
  }) => Promise<void>;
}) {
  if (input.conversationApproval && input.afterCanonicalCommit) {
    throw Object.assign(new Error("RPG conversation approval must use exactly one commit boundary."), {
      code: "RPG_CHAT_APPROVAL_BOUNDARY_AMBIGUOUS",
    });
  }
  // Authenticate sealed hidden-review evidence before touching canonical
  // storage or evaluating newer context identity fields.
  const fallbackReviewReceipt = await verifyPostFallbackClosedReviewReceipt({
    candidate: input.candidate,
  });
  const adultPolicyReceipt = await verifyRpgAdultRuntimePolicyReceipt({
    candidate: input.candidate,
    snapshot: input.snapshot,
  });
  if (input.candidate.externalRequest !== input.candidate.dataLeftDevice) {
    throw Object.assign(new Error("RPG 候選的外送事實不一致。"), {
      code: "RPG_CHAT_EXTERNAL_PROVENANCE_INVALID",
    });
  }
  const externalReceipt = input.candidate.externalRequest
    ? await verifyExternalRpgExecutionReceipt(input.candidate)
    : null;
  const externalFailureLineage = input.candidate.externalRequest
    ? null
    : await verifyExternalRpgFailureLineage(input.candidate);
  const externalFailureTaskIdentity = externalFailureLineage
    ? await parseRpgLogicalTurnProviderTaskId(
        externalFailureLineage.logicalRequestId,
        input.candidate.taskId,
      )
    : null;
  let externalAttempt: ExternalAttemptProvenance | undefined;
  if (externalFailureLineage) {
    if (!externalFailureLineage.receiptDigest || !externalFailureTaskIdentity) {
      throw Object.assign(new Error("外來 AI 失敗沿革與閉端候選不屬於同一個回合。"), {
        code: "RPG_CHAT_EXTERNAL_PROVENANCE_INVALID",
      });
    }
    externalAttempt = {
      schemaVersion: "external-attempt-provenance-v1",
      attempted: externalFailureLineage.attempted,
      providerId: externalFailureLineage.providerId,
      dispatchState: externalFailureLineage.dispatchState,
      dataLeftDevice: externalFailureLineage.dataLeftDevice,
      failureCode: externalFailureLineage.failureCode,
      receiptDigest: externalFailureLineage.receiptDigest,
    };
  }
  // A rules-only result is an internal draft source, never an approvable
  // reader-facing candidate. The only valid post-fallback candidate is the
  // separately persisted Closed AI selection/rewrite carrying a sealed
  // postFallbackClosedReview receipt. Enforce this before any candidate or
  // Canon write so legacy/direct callers cannot bypass the hidden review.
  if (input.candidate.actualExecutor === "deterministic-rule-fallback") {
    throw Object.assign(new Error(
      input.snapshot.project.adultMode
        ? "成人 RPG 規則草稿未經閉端複核，不得寫入作品。"
        : "規則後備草稿未經閉端 AI 選擇與改寫，不得顯示或寫入作品。",
    ), {
      code: input.snapshot.project.adultMode
        ? "RPG_ADULT_RUNTIME_CLOSED_REVIEW_REQUIRED"
        : "RPG_FALLBACK_CLOSED_REVIEW_REQUIRED",
    });
  }
  const candidateReceipt = input.candidate.executionReceipt
    && typeof input.candidate.executionReceipt === "object"
    ? input.candidate.executionReceipt as Record<string, unknown>
    : null;
  const immutableContextDigest = await sha256Hex(
    stableStringify(input.snapshot.directorContext),
  );
  assertRpgArcActionAvailable(input.snapshot, input.candidate.choice);
  if (
    input.candidate.sourceChapterId !== input.snapshot.chapter.id
    || input.candidate.sourceRevision !== input.snapshot.chapter.revision
    || input.candidate.canonicalMutationCount !== 0
    || input.candidate.contextDigest !== input.snapshot.contextDigest
    || input.candidate.contextRevisionDigest !== input.snapshot.contextRevisionDigest
    || stableStringify(input.candidate.contextRevisionGuard)
      !== stableStringify(input.snapshot.contextRevisionGuard)
    || immutableContextDigest !== input.snapshot.contextDigest
    || candidateReceipt?.rpgContextDigest !== input.snapshot.contextDigest
    || candidateReceipt?.rpgContextRevisionDigest !== input.snapshot.contextRevisionDigest
    || (externalReceipt && externalReceipt.projectId !== input.snapshot.project.id)
  ) {
    throw Object.assign(new Error("RPG 對話候選來源已過期。"), {
      code: "RPG_CHAT_TURN_SOURCE_STALE",
    });
  }
  const currentRevisionDigest = await loadCurrentRpgContextRevisionDigest(
    input.repository,
    input.snapshot.project.id,
  );
  if (currentRevisionDigest !== input.snapshot.contextRevisionDigest) {
    throw Object.assign(new Error("RPG 對話候選來源已過期。"), {
      code: "RPG_CHAT_TURN_SOURCE_STALE",
    });
  }
  const defensivelyValidatedStory = await validateRpgStoryCandidateBeforePersistence({
    snapshot: input.snapshot,
    choice: input.candidate.choice,
    resolution: input.candidate.resolution,
    rawStory: input.candidate.story,
    adultParticipantDisplayNames: adultPolicyReceipt?.participantDisplayNames,
  });
  if (defensivelyValidatedStory !== input.candidate.story) {
    throw Object.assign(new Error("RPG 候選正文沒有通過核准前的內容身分重驗。"), {
      code: "RPG_CHAT_RESULT_STORY_MISMATCH",
    });
  }
  const defensivelyValidatedDigest = await sha256Hex(
    defensivelyValidatedStory.normalize("NFKC"),
  );
  // Closed Agent OS binds its receipt to the exact raw provider output, while
  // the RPG application intentionally strips wrappers and validates the story
  // before it can reach Canon. Keep those two identities separate. Legacy
  // candidates did not carry storyDigest and are bound below by reloading the
  // authoritative Closed Agent candidate and reproducing the same cleaning.
  if (
    input.candidate.storyDigest !== undefined
    && defensivelyValidatedDigest !== input.candidate.storyDigest
  ) {
    throw Object.assign(new Error("RPG 候選正文摘要與執行證明不一致。"), {
      code: "RPG_CHAT_RESULT_IDENTITY_MISMATCH",
    });
  }
  let saved: Awaited<ReturnType<typeof persistStudioChoiceCandidate>> | null = null;
  const persistValidatedChoice = async () => {
    if (saved) return saved;
    const persisted = await persistStudioChoiceCandidate(
      input.repository,
      projectSeed(input.snapshot),
      {
        optionKey: input.candidate.choice.key,
        text: `${input.candidate.choice.title}｜${input.candidate.choice.description}`,
        consequence: `${input.candidate.choice.consequence}；${input.candidate.resolution.outcomeLabel}`,
        effect: input.candidate.resolution.effect,
        providerId: input.candidate.actualExecutor === "local-ollama"
          ? "ollama"
          : input.candidate.actualExecutor,
        modelId: input.candidate.model,
        externalRequest: input.candidate.externalRequest,
        dataLeftDevice: input.candidate.dataLeftDevice,
        externalAttempt,
        rpgContextRevisionGuard: structuredClone(input.candidate.contextRevisionGuard),
        rpgSettlement: input.candidate.resolution.settlement,
      },
    );
    saved = persisted;
    return persisted;
  };
  // Adult candidates remain entirely non-durable until the authoritative
  // Closed Agent candidate has revalidated the sealed policy binding.
  if (!adultPolicyReceipt) await persistValidatedChoice();
  let canonical: Awaited<ReturnType<typeof acceptStudioChoice>> | null = null;
  const commitVerifiedStory = async (verifiedStory: string) => {
    const latestRevisionDigest = await loadCurrentRpgContextRevisionDigest(
      input.repository,
      input.snapshot.project.id,
    );
    if (latestRevisionDigest !== input.snapshot.contextRevisionDigest) {
      throw Object.assign(new Error("RPG 對話候選來源已過期。"), {
        code: "RPG_CHAT_TURN_SOURCE_STALE",
      });
    }
    const commitReadyStory = await validateRpgStoryCandidateBeforePersistence({
      snapshot: input.snapshot,
      choice: input.candidate.choice,
      resolution: input.candidate.resolution,
      rawStory: verifiedStory,
      adultParticipantDisplayNames: adultPolicyReceipt?.participantDisplayNames,
    });
    if (commitReadyStory !== defensivelyValidatedStory) {
      throw Object.assign(new Error("RPG 候選正文在正式寫入前發生變化。"), {
        code: "RPG_CHAT_RESULT_STORY_MISMATCH",
      });
    }
    if (input.conversationApproval) {
      await createProjectBackup(input.repository, input.snapshot.project.id, "safety");
    }
    const persisted = await persistValidatedChoice();
    canonical = await acceptStudioChoice(
      input.repository,
      persisted.candidate.id,
      commitReadyStory,
      `${input.candidate.choice.key === "custom" ? "自由行動" : input.candidate.choice.key}｜${input.candidate.choice.title}｜${input.candidate.resolution.outcomeLabel}`,
      input.conversationApproval,
    );
    return canonical;
  };
  let approved: { canonicalMutationCount: number; [key: string]: unknown };
  if (externalReceipt) {
    const verifiedDigest = await sha256Hex(input.candidate.story.normalize("NFKC"));
    if (
      verifiedDigest !== (input.candidate.storyDigest ?? input.candidate.candidateDigest)
      || externalReceipt.candidateDigest !== verifiedDigest
      || input.candidate.actualExecutor !== `external:${externalReceipt.providerId}`
    ) {
      throw Object.assign(new Error("外來 RPG 候選內容或供應商證明不一致。"), {
        code: "RPG_CHAT_RESULT_IDENTITY_MISMATCH",
      });
    }
    const transaction = await commitVerifiedStory(input.candidate.story);
    approved = {
      candidateId: input.candidate.candidateId,
      status: "approved",
      actualExecutor: input.candidate.actualExecutor,
      canonicalMutationCount: 1,
      commitId: transaction.acceptedChoice.effectOperationId,
    };
  } else {
    approved = await approveStudioClosedAgentCandidate({
      candidateId: input.candidate.candidateId,
      canonicalCommit: async ({ candidate }) => {
        await verifyRpgAdultRuntimePolicyReceipt({
          candidate: input.candidate,
          snapshot: input.snapshot,
          authoritativeClosedCandidate: candidate,
        });
        if (
          candidate.taskId !== input.candidate.taskId
          || candidate.contentDigest !== input.candidate.candidateDigest
          || candidate.modelId !== input.candidate.model
          || candidate.modelDigest !== input.candidate.modelDigest
          || candidate.sourceChapterId !== input.snapshot.chapter.id
          || candidate.sourceRevision !== input.snapshot.chapter.revision
          || (fallbackReviewReceipt && (
            candidate.backendId
              !== fallbackReviewReceipt.selectionRewriteEvidence.provider
            || candidate.requestContractDigest
              !== fallbackReviewReceipt.selectionRewriteEvidence.requestContractDigest
            || await sha256Hex(stableStringify(candidate.executionReceipt))
              !== fallbackReviewReceipt.selectionRewriteEvidence.upstreamExecutionReceiptDigest
          ))
        ) {
          throw Object.assign(new Error("RPG 候選與閉端 AI 執行證明不一致。"), {
            code: "RPG_CHAT_RESULT_IDENTITY_MISMATCH",
          });
        }
        const verifiedStory = await cleanRpgContinuation(
          candidate.content,
          selectRecentRpgContinuityTexts(input.snapshot, 8).acceptedTexts,
          input.snapshot.language,
        );
        if (verifiedStory !== input.candidate.story) {
          throw Object.assign(new Error("RPG 候選正文與閉端 AI 證明不一致。"), {
            code: "RPG_CHAT_RESULT_STORY_MISMATCH",
          });
        }
        if (
          await sha256Hex(verifiedStory.normalize("NFKC"))
            !== (input.candidate.storyDigest ?? defensivelyValidatedDigest)
        ) {
          throw Object.assign(new Error("RPG 候選正文摘要與閉端 AI 證明不一致。"), {
            code: "RPG_CHAT_RESULT_IDENTITY_MISMATCH",
          });
        }
        const transaction = await commitVerifiedStory(verifiedStory);
        return { commitId: transaction.acceptedChoice.effectOperationId };
      },
    });
  }
  if (!canonical || approved.canonicalMutationCount !== 1) {
    throw Object.assign(new Error("RPG 本回合沒有完成唯一一次正式交易。"), {
      code: "RPG_CHAT_CANONICAL_COMMIT_MISSING",
    });
  }
  const transaction = canonical as Awaited<ReturnType<typeof acceptStudioChoice>>;
  if (
    !transaction.rpgTurnReceipt
    || transaction.rpgTurnReceipt.acceptedChoiceId !== transaction.acceptedChoice.id
    || transaction.acceptedChoice.rpgTurnReceiptId !== transaction.rpgTurnReceipt.id
  ) {
    throw Object.assign(new Error("RPG 正式交易缺少同筆寫入的回合收據。"), {
      code: "RPG_CHAT_TURN_RECEIPT_MISSING",
    });
  }
  const result = {
    approved,
    transaction,
    commitId: transaction.acceptedChoice.effectOperationId,
    resultingRevision: transaction.chapter.revision,
  };
  if (
    input.conversationApproval
    && (
      !transaction.conversationArtifact
      || !transaction.conversationApprovalTransaction
      || transaction.conversationArtifact.id !== input.conversationApproval.artifactId
      || transaction.conversationArtifact.status !== "approved"
      || transaction.conversationApprovalTransaction.idempotencyKey !== input.conversationApproval.idempotencyKey
    )
  ) {
    throw Object.assign(new Error("RPG conversation approval was not committed with Canon."), {
      code: "RPG_CHAT_CONVERSATION_APPROVAL_MISSING",
    });
  }
  await input.afterCanonicalCommit?.({
    commitId: result.commitId,
    resultingRevision: result.resultingRevision,
  });
  return result;
}

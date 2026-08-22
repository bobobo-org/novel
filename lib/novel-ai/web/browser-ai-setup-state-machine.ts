export const BROWSER_AI_SETUP_STATE_MACHINE_SCHEMA_VERSION =
  "browser-ai-setup-state-machine-v1" as const;

export type BrowserAiSetupState =
  | "idle"
  | "preparing"
  | "downloading"
  | "verifying"
  | "initializing"
  | "warming"
  | "generation-verifying"
  | "ready"
  | "cancelling"
  | "cancelled"
  | "failed";

export type BrowserAiSetupOperationKey = Readonly<{
  kind: "bootstrap" | "prepare";
  projectId: string;
  taskType: string;
}>;

/**
 * This value is an ownership capability, not merely an identifier. Callers
 * must retain the exact object returned by acquire(); a copied object is not
 * accepted as the owner even if every visible field is identical.
 */
export type BrowserAiSetupAttemptOwnership = Readonly<{
  attemptId: string;
  epoch: number;
  operationKey: string;
}>;

export type BrowserAiSetupTransition = Readonly<{
  sequence: number;
  attemptId: string;
  epoch: number;
  from: BrowserAiSetupState;
  to: BrowserAiSetupState;
  reason: string;
}>;

export type BrowserAiSetupCounters = Readonly<{
  attemptsStarted: number;
  singleFlightReuses: number;
  singleFlightRejections: number;
  transitionsCommitted: number;
  cancellationRequests: number;
  cancellationsAcknowledged: number;
  readyCompletions: number;
  failureCompletions: number;
  staleTransitionsRejected: number;
  staleCompletionsRejected: number;
  staleFailuresRejected: number;
  invalidTransitionsRejected: number;
}>;

export type BrowserAiSetupStateSnapshot = Readonly<{
  schemaVersion: typeof BROWSER_AI_SETUP_STATE_MACHINE_SCHEMA_VERSION;
  state: BrowserAiSetupState;
  epoch: number;
  activeAttemptId: string | null;
  activeOperationKey: string | null;
  counters: BrowserAiSetupCounters;
  transitions: readonly BrowserAiSetupTransition[];
}>;

export type BrowserAiSetupAcquisition = Readonly<{
  disposition: "started" | "reused";
  ownership: BrowserAiSetupAttemptOwnership;
}>;

type MutableCounters = {
  -readonly [Key in keyof BrowserAiSetupCounters]: BrowserAiSetupCounters[Key];
};

type ActiveAttempt = {
  ownership: BrowserAiSetupAttemptOwnership;
  key: BrowserAiSetupOperationKey;
};

type StateMachineErrorCode =
  | "BROWSER_AI_SETUP_OPERATION_IN_PROGRESS"
  | "BROWSER_AI_SETUP_STALE_OWNERSHIP"
  | "BROWSER_AI_SETUP_STALE_COMPLETION"
  | "BROWSER_AI_SETUP_STALE_FAILURE"
  | "BROWSER_AI_SETUP_INVALID_TRANSITION";

export class BrowserAiSetupStateMachineError extends Error {
  readonly code: StateMachineErrorCode;
  readonly retryable: boolean;

  constructor(code: StateMachineErrorCode, message: string, retryable = true) {
    super(message);
    this.name = "BrowserAiSetupStateMachineError";
    this.code = code;
    this.retryable = retryable;
  }
}

const RUNNING_STATES = new Set<BrowserAiSetupState>([
  "preparing",
  "downloading",
  "verifying",
  "initializing",
  "warming",
  "generation-verifying",
]);

const ALLOWED_TRANSITIONS: Readonly<Record<BrowserAiSetupState, ReadonlySet<BrowserAiSetupState>>> = {
  idle: new Set(["preparing"]),
  preparing: new Set([
    "downloading",
    "verifying",
    "initializing",
    "warming",
    "generation-verifying",
    "ready",
    "cancelling",
    "failed",
  ]),
  downloading: new Set([
    "verifying",
    "initializing",
    "warming",
    "generation-verifying",
    "ready",
    "cancelling",
    "failed",
  ]),
  verifying: new Set([
    "initializing",
    "warming",
    "generation-verifying",
    "ready",
    "cancelling",
    "failed",
  ]),
  initializing: new Set([
    "warming",
    "generation-verifying",
    "ready",
    "cancelling",
    "failed",
  ]),
  warming: new Set([
    "generation-verifying",
    "ready",
    "cancelling",
    "failed",
  ]),
  "generation-verifying": new Set(["ready", "cancelling", "failed"]),
  ready: new Set(["preparing"]),
  // A durable ready+selected metadata transaction is the setup linearization
  // point. If that commit wins the AbortSignal race, its explicit committed
  // completion must be able to overtake a merely requested cancellation.
  cancelling: new Set(["ready", "cancelled", "failed"]),
  cancelled: new Set(["preparing"]),
  failed: new Set(["preparing"]),
};

const EMPTY_COUNTERS = (): MutableCounters => ({
  attemptsStarted: 0,
  singleFlightReuses: 0,
  singleFlightRejections: 0,
  transitionsCommitted: 0,
  cancellationRequests: 0,
  cancellationsAcknowledged: 0,
  readyCompletions: 0,
  failureCompletions: 0,
  staleTransitionsRejected: 0,
  staleCompletionsRejected: 0,
  staleFailuresRejected: 0,
  invalidTransitionsRejected: 0,
});

function operationKey(key: BrowserAiSetupOperationKey) {
  return `${key.kind}\u0000${key.projectId}\u0000${key.taskType}`;
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

/**
 * Attempt-scoped state for Browser AI setup. It deliberately contains no
 * browser APIs, timers, promises, or storage so the ownership rules remain
 * deterministic and can be exercised in a pure Node process.
 */
export class BrowserAiSetupStateMachine {
  private state: BrowserAiSetupState = "idle";
  private epoch = 0;
  private active: ActiveAttempt | null = null;
  private sequence = 0;
  private readonly counters = EMPTY_COUNTERS();
  private readonly transitionHistory: BrowserAiSetupTransition[] = [];
  private readonly historyLimit: number;
  private readonly attemptIdPrefix: string;
  private readonly attemptIdFactory: (epoch: number) => string;

  constructor(options: {
    historyLimit?: number;
    attemptIdPrefix?: string;
    attemptIdFactory?: (epoch: number) => string;
  } = {}) {
    this.historyLimit = Math.max(1, Math.floor(options.historyLimit ?? 64));
    this.attemptIdPrefix = options.attemptIdPrefix ?? "browser-ai-setup";
    this.attemptIdFactory = options.attemptIdFactory
      ?? ((epoch) => `${this.attemptIdPrefix}-${epoch}`);
  }

  acquire(key: BrowserAiSetupOperationKey): BrowserAiSetupAcquisition {
    const keyValue = operationKey(key);
    if (this.active) {
      if (this.active.ownership.operationKey === keyValue) {
        this.counters.singleFlightReuses += 1;
        return Object.freeze({
          disposition: "reused" as const,
          ownership: this.active.ownership,
        });
      }
      this.counters.singleFlightRejections += 1;
      throw new BrowserAiSetupStateMachineError(
        "BROWSER_AI_SETUP_OPERATION_IN_PROGRESS",
        "A different Browser AI setup operation already owns the active attempt.",
      );
    }

    this.epoch += 1;
    const attemptId = this.attemptIdFactory(this.epoch);
    if (!attemptId || attemptId.length > 200) {
      throw new BrowserAiSetupStateMachineError(
        "BROWSER_AI_SETUP_INVALID_TRANSITION",
        "Browser AI setup attemptId factory returned an invalid identifier.",
        false,
      );
    }
    const ownership = Object.freeze({
      attemptId,
      epoch: this.epoch,
      operationKey: keyValue,
    });
    this.active = { ownership, key: Object.freeze({ ...key }) };
    this.counters.attemptsStarted += 1;
    this.commitTransition(ownership, "preparing", "attempt-started");
    return Object.freeze({ disposition: "started" as const, ownership });
  }

  transition(
    ownership: BrowserAiSetupAttemptOwnership,
    next: Exclude<BrowserAiSetupState, "idle" | "ready" | "cancelled" | "failed">,
    reason = "progress",
  ) {
    this.assertOwner(ownership, "transition");
    if (next === "cancelling") return this.requestCancellation(ownership, reason);
    if (!RUNNING_STATES.has(next)) {
      this.counters.invalidTransitionsRejected += 1;
      throw new BrowserAiSetupStateMachineError(
        "BROWSER_AI_SETUP_INVALID_TRANSITION",
        `State ${next} is not a progress state.`,
        false,
      );
    }
    this.commitTransition(ownership, next, reason);
    return this.snapshot();
  }

  requestCancellation(
    ownership: BrowserAiSetupAttemptOwnership,
    reason = "abort-requested",
  ) {
    this.assertOwner(ownership, "transition");
    if (this.state === "cancelling") return this.snapshot();
    if (!RUNNING_STATES.has(this.state)) {
      this.counters.invalidTransitionsRejected += 1;
      throw new BrowserAiSetupStateMachineError(
        "BROWSER_AI_SETUP_INVALID_TRANSITION",
        `Cannot request cancellation from ${this.state}.`,
        false,
      );
    }
    this.counters.cancellationRequests += 1;
    this.commitTransition(ownership, "cancelling", reason);
    return this.snapshot();
  }

  acknowledgeCancellation(
    ownership: BrowserAiSetupAttemptOwnership,
    reason = "abort-acknowledged",
  ) {
    this.assertOwner(ownership, "transition");
    if (this.state !== "cancelling") {
      this.counters.invalidTransitionsRejected += 1;
      throw new BrowserAiSetupStateMachineError(
        "BROWSER_AI_SETUP_INVALID_TRANSITION",
        `Cannot acknowledge cancellation from ${this.state}.`,
        false,
      );
    }
    this.counters.cancellationsAcknowledged += 1;
    this.commitTransition(ownership, "cancelled", reason);
    this.active = null;
    return this.snapshot();
  }

  failCancellation(
    ownership: BrowserAiSetupAttemptOwnership,
    error: unknown,
    reason = "cancellation-cleanup-failed",
  ) {
    this.assertOwner(ownership, "transition");
    if (this.state !== "cancelling") {
      this.counters.invalidTransitionsRejected += 1;
      throw new BrowserAiSetupStateMachineError(
        "BROWSER_AI_SETUP_INVALID_TRANSITION",
        `Cannot fail cancellation from ${this.state}.`,
        false,
      );
    }
    const code = errorCode(error);
    this.commitTransition(
      ownership,
      "failed",
      code ? `${reason}:${code}` : reason,
    );
    this.counters.failureCompletions += 1;
    this.active = null;
    return this.snapshot();
  }

  completeReady(
    ownership: BrowserAiSetupAttemptOwnership,
    reason = "generation-verified",
  ) {
    this.assertCompletionOwner(ownership, "completion");
    this.commitTransition(ownership, "ready", reason);
    this.counters.readyCompletions += 1;
    this.active = null;
    return this.snapshot();
  }

  completeCommittedReady(
    ownership: BrowserAiSetupAttemptOwnership,
    reason = "generation-verified-commit-won",
  ) {
    if (this.active?.ownership !== ownership) {
      this.counters.staleCompletionsRejected += 1;
      throw new BrowserAiSetupStateMachineError(
        "BROWSER_AI_SETUP_STALE_COMPLETION",
        "Rejected a stale committed Browser AI setup completion.",
        false,
      );
    }
    this.commitTransition(ownership, "ready", reason);
    this.counters.readyCompletions += 1;
    this.active = null;
    return this.snapshot();
  }

  completeFailure(
    ownership: BrowserAiSetupAttemptOwnership,
    error: unknown,
    reason = "attempt-failed",
  ) {
    this.assertCompletionOwner(ownership, "failure");
    const code = errorCode(error);
    this.commitTransition(
      ownership,
      "failed",
      code ? `${reason}:${code}` : reason,
    );
    this.counters.failureCompletions += 1;
    this.active = null;
    return this.snapshot();
  }

  owns(ownership: BrowserAiSetupAttemptOwnership) {
    return this.active?.ownership === ownership;
  }

  snapshot(): BrowserAiSetupStateSnapshot {
    return Object.freeze({
      schemaVersion: BROWSER_AI_SETUP_STATE_MACHINE_SCHEMA_VERSION,
      state: this.state,
      epoch: this.epoch,
      activeAttemptId: this.active?.ownership.attemptId ?? null,
      activeOperationKey: this.active?.ownership.operationKey ?? null,
      counters: Object.freeze({ ...this.counters }),
      transitions: Object.freeze(this.transitionHistory.map((entry) => (
        Object.freeze({ ...entry })
      ))),
    });
  }

  private assertOwner(
    ownership: BrowserAiSetupAttemptOwnership,
    operation: "transition",
  ): asserts ownership is BrowserAiSetupAttemptOwnership {
    if (this.active?.ownership === ownership) return;
    this.counters.staleTransitionsRejected += 1;
    throw new BrowserAiSetupStateMachineError(
      "BROWSER_AI_SETUP_STALE_OWNERSHIP",
      `Rejected a stale Browser AI setup ${operation}.`,
      false,
    );
  }

  private assertCompletionOwner(
    ownership: BrowserAiSetupAttemptOwnership,
    operation: "completion" | "failure",
  ) {
    const counter = operation === "completion"
      ? "staleCompletionsRejected" as const
      : "staleFailuresRejected" as const;
    const code = operation === "completion"
      ? "BROWSER_AI_SETUP_STALE_COMPLETION" as const
      : "BROWSER_AI_SETUP_STALE_FAILURE" as const;
    if (this.active?.ownership !== ownership || this.state === "cancelling") {
      this.counters[counter] += 1;
      throw new BrowserAiSetupStateMachineError(
        code,
        `Rejected a stale Browser AI setup ${operation}.`,
        false,
      );
    }
  }

  private commitTransition(
    ownership: BrowserAiSetupAttemptOwnership,
    next: BrowserAiSetupState,
    reason: string,
  ) {
    if (this.state === next) return;
    if (!ALLOWED_TRANSITIONS[this.state].has(next)) {
      this.counters.invalidTransitionsRejected += 1;
      throw new BrowserAiSetupStateMachineError(
        "BROWSER_AI_SETUP_INVALID_TRANSITION",
        `Browser AI setup cannot transition from ${this.state} to ${next}.`,
        false,
      );
    }
    const transition = Object.freeze({
      sequence: ++this.sequence,
      attemptId: ownership.attemptId,
      epoch: ownership.epoch,
      from: this.state,
      to: next,
      reason,
    });
    this.state = next;
    this.counters.transitionsCommitted += 1;
    this.transitionHistory.push(transition);
    if (this.transitionHistory.length > this.historyLimit) {
      this.transitionHistory.splice(0, this.transitionHistory.length - this.historyLimit);
    }
  }
}

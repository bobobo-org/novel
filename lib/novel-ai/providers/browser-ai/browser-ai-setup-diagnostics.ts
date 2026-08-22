import { sha256Hex, stableStringify } from "../../closed-ai-cache";

export const BROWSER_AI_SETUP_DIAGNOSTIC_SCHEMA_VERSION =
  "p24b-rc6.4-browser-ai-setup-diagnostics-v1" as const;

export const BROWSER_AI_SETUP_DIAGNOSTIC_CHECKPOINTS = Object.freeze([
  "before-first-immutable-request",
  "model-config-download",
  "shard-manifest-download",
  "first-shard-download",
  "multiple-shards-mid-download",
  "all-shards-before-integrity-verify",
  "integrity-verify",
  "worker-engine-initialize",
  "warmup",
  "before-verified-metadata-transaction",
  "metadata-transaction",
  "before-generation-verification",
] as const);

export type BrowserAiSetupDiagnosticCheckpoint =
  (typeof BROWSER_AI_SETUP_DIAGNOSTIC_CHECKPOINTS)[number];

export const BROWSER_AI_SETUP_DIAGNOSTIC_FAULTS = Object.freeze([
  "worker-crash",
  "metadata-transaction-abort",
  "stale-completion",
] as const);

export type BrowserAiSetupDiagnosticFault =
  (typeof BROWSER_AI_SETUP_DIAGNOSTIC_FAULTS)[number];

export type BrowserAiSetupDiagnosticRuntimeOrdering =
  | "not-applicable"
  | "before-worker-construction"
  | "worker-created-before-engine-created"
  | "engine-created-before-custom-integrity"
  | "inside-open-readwrite-transaction-before-writes";

export type BrowserAiSetupDiagnosticOwnership = Readonly<{
  attemptId: string;
  epoch: number;
  abortControllerGenerationId: string;
}>;

type DiagnosticRuntimeGeneration = Readonly<{
  workerGeneration?: number | null;
  engineGeneration?: number | null;
  ordering?: BrowserAiSetupDiagnosticRuntimeOrdering;
}>;

export type BrowserAiSetupDiagnosticArrivalReceipt = Readonly<{
  schemaVersion: typeof BROWSER_AI_SETUP_DIAGNOSTIC_SCHEMA_VERSION;
  sequence: number;
  checkpoint: BrowserAiSetupDiagnosticCheckpoint;
  fault: BrowserAiSetupDiagnosticFault | null;
  attemptIdDigest: string;
  setupEpoch: number;
  controllerGenerationDigest: string;
  singleFlightGenerationDigest: string;
  abortControllerGenerationDigest: string;
  workerGenerationDigest: string | null;
  engineGenerationDigest: string | null;
  runtimeOrdering: BrowserAiSetupDiagnosticRuntimeOrdering;
}>;

export type BrowserAiSetupDiagnosticCheckpointOutcome = Readonly<{
  disposition: "not-armed" | "released";
  fault: BrowserAiSetupDiagnosticFault | null;
}>;

export type BrowserAiSetupDiagnosticCleanupReceipt = Readonly<{
  schemaVersion: typeof BROWSER_AI_SETUP_DIAGNOSTIC_SCHEMA_VERSION;
  attemptIdDigest: string;
  setupEpoch: number;
  abortControllerGenerationDigest: string;
  cleanupAcknowledged: boolean;
  engineOwnershipMatched: boolean;
  engineDetached: boolean;
  workerDisposeAcknowledged: boolean;
  metadataCleanupAcknowledged: boolean;
}>;

export type BrowserAiSetupDiagnosticSnapshot = Readonly<{
  schemaVersion: typeof BROWSER_AI_SETUP_DIAGNOSTIC_SCHEMA_VERSION;
  enabled: true;
  authorizationIdDigest: string;
  abortControllerGenerationDigest: string | null;
  armedCheckpoint: BrowserAiSetupDiagnosticCheckpoint | null;
  armedFault: BrowserAiSetupDiagnosticFault | null;
  armState: "idle" | "armed" | "arrived";
  arrivalCount: number;
  releaseCount: number;
  staleCompletionRejectedCount: number;
  lateFailureRejectedCount: number;
  workerCrashFaultTriggeredCount: number;
  metadataTransactionAbortFaultTriggeredCount: number;
  staleCompletionFaultTriggeredCount: number;
  lastArrival: BrowserAiSetupDiagnosticArrivalReceipt | null;
  lastCleanup: BrowserAiSetupDiagnosticCleanupReceipt | null;
}>;

export type BrowserAiSetupDiagnosticBridge = Readonly<{
  schemaVersion: typeof BROWSER_AI_SETUP_DIAGNOSTIC_SCHEMA_VERSION;
  checkpoints: readonly BrowserAiSetupDiagnosticCheckpoint[];
  faults: readonly BrowserAiSetupDiagnosticFault[];
  arm(input: Readonly<{
    checkpoint: BrowserAiSetupDiagnosticCheckpoint;
    fault?: BrowserAiSetupDiagnosticFault | null;
  }>): Readonly<{
    armed: true;
    checkpoint: BrowserAiSetupDiagnosticCheckpoint;
    fault: BrowserAiSetupDiagnosticFault | null;
  }>;
  waitForArrival(
    checkpoint: BrowserAiSetupDiagnosticCheckpoint,
  ): Promise<BrowserAiSetupDiagnosticArrivalReceipt>;
  release(checkpoint: BrowserAiSetupDiagnosticCheckpoint): Readonly<{
    released: true;
    checkpoint: BrowserAiSetupDiagnosticCheckpoint;
  }>;
  snapshot(): BrowserAiSetupDiagnosticSnapshot;
}>;

export type BrowserAiSetupDiagnosticAttempt = Readonly<{
  checkpoint(
    checkpoint: BrowserAiSetupDiagnosticCheckpoint,
    runtime?: DiagnosticRuntimeGeneration,
  ): Promise<BrowserAiSetupDiagnosticCheckpointOutcome>;
  acknowledgeCleanup(input: Readonly<{
    engineOwnershipMatched: boolean;
    engineDetached: boolean;
    workerDisposeAcknowledged: boolean;
    metadataCleanupAcknowledged: boolean;
  }>): BrowserAiSetupDiagnosticCleanupReceipt;
  recordStaleCompletion(): void;
  recordLateFailure(): void;
}>;

export type BrowserAiSetupDiagnosticControllerHandle = Readonly<{
  bindAttempt(
    ownership: BrowserAiSetupDiagnosticOwnership,
  ): Promise<BrowserAiSetupDiagnosticAttempt>;
  snapshot(): BrowserAiSetupDiagnosticSnapshot;
}>;

type AttemptToken = Readonly<{
  ownership: BrowserAiSetupDiagnosticOwnership;
  attemptIdDigest: string;
  controllerGenerationDigest: string;
  singleFlightGenerationDigest: string;
  abortControllerGenerationDigest: string;
}>;

type ArmedCheckpoint = {
  checkpoint: BrowserAiSetupDiagnosticCheckpoint;
  fault: BrowserAiSetupDiagnosticFault | null;
  attempt: AttemptToken | null;
  consumed: boolean;
  released: boolean;
  state: "armed" | "arrived";
  arrival: Promise<BrowserAiSetupDiagnosticArrivalReceipt>;
  resolveArrival: (receipt: BrowserAiSetupDiagnosticArrivalReceipt) => void;
  release: Promise<void>;
  resolveRelease: () => void;
};

const CHECKPOINT_SET = new Set<string>(BROWSER_AI_SETUP_DIAGNOSTIC_CHECKPOINTS);
const FAULT_SET = new Set<string>(BROWSER_AI_SETUP_DIAGNOSTIC_FAULTS);
const RUNTIME_ORDERING_SET = new Set<BrowserAiSetupDiagnosticRuntimeOrdering>([
  "not-applicable",
  "before-worker-construction",
  "worker-created-before-engine-created",
  "engine-created-before-custom-integrity",
  "inside-open-readwrite-transaction-before-writes",
]);
const AUTHORIZATION_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

function diagnosticError(code: string) {
  return Object.assign(new Error(code), { code, retryable: false });
}

function exactCheckpoint(value: unknown): value is BrowserAiSetupDiagnosticCheckpoint {
  return typeof value === "string" && CHECKPOINT_SET.has(value);
}

function exactFault(value: unknown): value is BrowserAiSetupDiagnosticFault {
  return typeof value === "string" && FAULT_SET.has(value);
}

function faultAllowedAtCheckpoint(
  fault: BrowserAiSetupDiagnosticFault | null,
  checkpoint: BrowserAiSetupDiagnosticCheckpoint,
) {
  return fault === null
    || (fault === "worker-crash" && checkpoint === "worker-engine-initialize")
    || (
      fault === "metadata-transaction-abort"
      && checkpoint === "metadata-transaction"
    )
    || (
      fault === "stale-completion"
      && checkpoint === "before-generation-verification"
    );
}

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function generationDigest(input: Readonly<{
  domain: string;
  attemptIdDigest: string;
  setupEpoch: number;
  generation: number;
}>) {
  return sha256Hex(stableStringify(input));
}

class BrowserAiSetupDiagnosticController
  implements BrowserAiSetupDiagnosticControllerHandle {
  private readonly authorizationIdDigest: string;
  private armed: ArmedCheckpoint | null = null;
  private sequence = 0;
  private controllerGeneration = 0;
  private singleFlightGeneration = 0;
  private arrivalCount = 0;
  private releaseCount = 0;
  private staleCompletionRejectedCount = 0;
  private lateFailureRejectedCount = 0;
  private workerCrashFaultTriggeredCount = 0;
  private metadataTransactionAbortFaultTriggeredCount = 0;
  private staleCompletionFaultTriggeredCount = 0;
  private lastArrival: BrowserAiSetupDiagnosticArrivalReceipt | null = null;
  private lastCleanup: BrowserAiSetupDiagnosticCleanupReceipt | null = null;
  private activeAttempt: AttemptToken | null = null;

  private constructor(authorizationIdDigest: string) {
    this.authorizationIdDigest = authorizationIdDigest;
  }

  static async create(authorizationId: string) {
    if (!AUTHORIZATION_ID.test(authorizationId)) {
      throw diagnosticError("BROWSER_AI_SETUP_DIAGNOSTIC_AUTHORIZATION_INVALID");
    }
    return new BrowserAiSetupDiagnosticController(await sha256Hex(
      `p24b-rc6.4-browser-ai-diagnostic-authorization-v1\n${authorizationId}`,
    ));
  }

  async bindAttempt(
    ownership: BrowserAiSetupDiagnosticOwnership,
  ): Promise<BrowserAiSetupDiagnosticAttempt> {
    if (
      typeof ownership?.attemptId !== "string"
      || ownership.attemptId.length < 1
      || ownership.attemptId.length > 200
      || !Number.isSafeInteger(ownership.epoch)
      || ownership.epoch < 1
      || !AUTHORIZATION_ID.test(ownership.abortControllerGenerationId)
    ) throw diagnosticError("BROWSER_AI_SETUP_DIAGNOSTIC_OWNERSHIP_INVALID");
    // Allocate and publish the latest-token fence before the first await. Two
    // concurrent bindAttempt() calls must be ordered by invocation, not by
    // whichever SHA-256 promise happens to settle last.
    const controllerGeneration = ++this.controllerGeneration;
    const singleFlightGeneration = ++this.singleFlightGeneration;
    this.activeAttempt = null;
    const owned = Object.freeze({
      attemptId: ownership.attemptId,
      epoch: ownership.epoch,
      abortControllerGenerationId: ownership.abortControllerGenerationId,
    });
    const attemptIdDigest = await sha256Hex(
      `p24b-rc6.4-browser-ai-diagnostic-attempt-v1\n${owned.attemptId}`,
    );
    const token: AttemptToken = Object.freeze({
      ownership: owned,
      attemptIdDigest,
      controllerGenerationDigest: await generationDigest({
        domain: "p24b-rc6.4-browser-ai-controller-generation-v1",
        attemptIdDigest,
        setupEpoch: owned.epoch,
        generation: controllerGeneration,
      }),
      singleFlightGenerationDigest: await generationDigest({
        domain: "p24b-rc6.4-browser-ai-single-flight-generation-v1",
        attemptIdDigest,
        setupEpoch: owned.epoch,
        generation: singleFlightGeneration,
      }),
      abortControllerGenerationDigest: await sha256Hex(stableStringify({
        domain: "p24b-rc6.4-browser-ai-abort-controller-generation-v1",
        authorizationIdDigest: this.authorizationIdDigest,
        abortControllerGenerationId: owned.abortControllerGenerationId,
      })),
    });
    if (
      controllerGeneration === this.controllerGeneration
      && singleFlightGeneration === this.singleFlightGeneration
    ) {
      this.activeAttempt = token;
    }
    return Object.freeze({
      checkpoint: (checkpoint, runtime) => this.checkpoint(token, checkpoint, runtime),
      acknowledgeCleanup: (input) => this.acknowledgeCleanup(token, input),
      recordStaleCompletion: () => {
        this.staleCompletionRejectedCount += 1;
      },
      recordLateFailure: () => {
        this.lateFailureRejectedCount += 1;
      },
    });
  }

  bridge(): BrowserAiSetupDiagnosticBridge {
    return Object.freeze({
      schemaVersion: BROWSER_AI_SETUP_DIAGNOSTIC_SCHEMA_VERSION,
      checkpoints: Object.freeze([...BROWSER_AI_SETUP_DIAGNOSTIC_CHECKPOINTS]),
      faults: Object.freeze([...BROWSER_AI_SETUP_DIAGNOSTIC_FAULTS]),
      arm: (input) => this.arm(input),
      waitForArrival: (checkpoint) => this.waitForArrival(checkpoint),
      release: (checkpoint) => this.release(checkpoint),
      snapshot: () => this.snapshot(),
    });
  }

  snapshot(): BrowserAiSetupDiagnosticSnapshot {
    return Object.freeze({
      schemaVersion: BROWSER_AI_SETUP_DIAGNOSTIC_SCHEMA_VERSION,
      enabled: true,
      authorizationIdDigest: this.authorizationIdDigest,
      abortControllerGenerationDigest:
        this.activeAttempt?.abortControllerGenerationDigest ?? null,
      armedCheckpoint: this.armed?.checkpoint ?? null,
      armedFault: this.armed?.fault ?? null,
      armState: this.armed?.state ?? "idle",
      arrivalCount: this.arrivalCount,
      releaseCount: this.releaseCount,
      staleCompletionRejectedCount: this.staleCompletionRejectedCount,
      lateFailureRejectedCount: this.lateFailureRejectedCount,
      workerCrashFaultTriggeredCount: this.workerCrashFaultTriggeredCount,
      metadataTransactionAbortFaultTriggeredCount:
        this.metadataTransactionAbortFaultTriggeredCount,
      staleCompletionFaultTriggeredCount: this.staleCompletionFaultTriggeredCount,
      lastArrival: this.lastArrival,
      lastCleanup: this.lastCleanup,
    });
  }

  private arm(input: Readonly<{
    checkpoint: BrowserAiSetupDiagnosticCheckpoint;
    fault?: BrowserAiSetupDiagnosticFault | null;
  }>) {
    if (this.armed) throw diagnosticError("BROWSER_AI_SETUP_DIAGNOSTIC_ALREADY_ARMED");
    const checkpoint = input?.checkpoint;
    if (!exactCheckpoint(checkpoint)) {
      throw diagnosticError("BROWSER_AI_SETUP_DIAGNOSTIC_CHECKPOINT_INVALID");
    }
    const fault = input?.fault ?? null;
    if ((fault !== null && !exactFault(fault)) || !faultAllowedAtCheckpoint(
      fault,
      checkpoint,
    )) throw diagnosticError("BROWSER_AI_SETUP_DIAGNOSTIC_FAULT_INVALID");
    const arrival = deferred<BrowserAiSetupDiagnosticArrivalReceipt>();
    const release = deferred<void>();
    this.armed = {
      checkpoint,
      fault,
      attempt: null,
      consumed: false,
      released: false,
      state: "armed",
      arrival: arrival.promise,
      resolveArrival: arrival.resolve,
      release: release.promise,
      resolveRelease: () => release.resolve(),
    };
    return Object.freeze({ armed: true as const, checkpoint, fault });
  }

  private waitForArrival(checkpoint: BrowserAiSetupDiagnosticCheckpoint) {
    if (!exactCheckpoint(checkpoint) || this.armed?.checkpoint !== checkpoint) {
      throw diagnosticError("BROWSER_AI_SETUP_DIAGNOSTIC_NOT_ARMED");
    }
    return this.armed.arrival;
  }

  private release(checkpoint: BrowserAiSetupDiagnosticCheckpoint) {
    if (
      !exactCheckpoint(checkpoint)
      || this.armed?.checkpoint !== checkpoint
      || this.armed.state !== "arrived"
      || this.armed.released
    ) throw diagnosticError("BROWSER_AI_SETUP_DIAGNOSTIC_NOT_ARRIVED");
    this.armed.released = true;
    this.releaseCount += 1;
    this.armed.resolveRelease();
    return Object.freeze({ released: true as const, checkpoint });
  }

  private async checkpoint(
    token: AttemptToken,
    checkpoint: BrowserAiSetupDiagnosticCheckpoint,
    runtime: DiagnosticRuntimeGeneration = {},
  ): Promise<BrowserAiSetupDiagnosticCheckpointOutcome> {
    if (!exactCheckpoint(checkpoint)) {
      throw diagnosticError("BROWSER_AI_SETUP_DIAGNOSTIC_CHECKPOINT_INVALID");
    }
    const armed = this.armed;
    if (!armed || armed.checkpoint !== checkpoint) {
      return Object.freeze({ disposition: "not-armed" as const, fault: null });
    }
    if (this.activeAttempt !== token) {
      this.staleCompletionRejectedCount += 1;
      throw diagnosticError("BROWSER_AI_SETUP_DIAGNOSTIC_STALE_ATTEMPT");
    }
    if (armed.attempt && armed.attempt !== token) {
      this.staleCompletionRejectedCount += 1;
      throw diagnosticError("BROWSER_AI_SETUP_DIAGNOSTIC_STALE_ATTEMPT");
    }
    if (!runtime || typeof runtime !== "object") {
      throw diagnosticError("BROWSER_AI_SETUP_DIAGNOSTIC_RUNTIME_INVALID");
    }
    const runtimeOrdering = runtime.ordering ?? "not-applicable";
    if (!RUNTIME_ORDERING_SET.has(runtimeOrdering)) {
      throw diagnosticError("BROWSER_AI_SETUP_DIAGNOSTIC_RUNTIME_INVALID");
    }
    const workerGenerationDigest = typeof runtime.workerGeneration === "number"
      && Number.isSafeInteger(runtime.workerGeneration)
      && runtime.workerGeneration > 0
      ? await generationDigest({
          domain: "p24b-rc6.4-browser-ai-worker-generation-v1",
          attemptIdDigest: token.attemptIdDigest,
          setupEpoch: token.ownership.epoch,
          generation: runtime.workerGeneration,
        })
      : null;
    const engineGenerationDigest = typeof runtime.engineGeneration === "number"
      && Number.isSafeInteger(runtime.engineGeneration)
      && runtime.engineGeneration > 0
      ? await generationDigest({
          domain: "p24b-rc6.4-browser-ai-engine-generation-v1",
          attemptIdDigest: token.attemptIdDigest,
          setupEpoch: token.ownership.epoch,
          generation: runtime.engineGeneration,
        })
      : null;
    // Hashing is asynchronous. Re-assert both the latest attempt and the
    // currently armed object immediately before the first observable mutation
    // so an older epoch cannot consume the checkpoint after a retry binds.
    if (this.activeAttempt !== token || this.armed !== armed) {
      this.staleCompletionRejectedCount += 1;
      throw diagnosticError("BROWSER_AI_SETUP_DIAGNOSTIC_STALE_ATTEMPT");
    }
    if (armed.attempt && armed.attempt !== token) {
      this.staleCompletionRejectedCount += 1;
      throw diagnosticError("BROWSER_AI_SETUP_DIAGNOSTIC_STALE_ATTEMPT");
    }
    if (armed.consumed) {
      throw diagnosticError("BROWSER_AI_SETUP_DIAGNOSTIC_CHECKPOINT_DUPLICATE");
    }
    armed.attempt = token;
    armed.consumed = true;
    if (armed.state === "armed") {
      const receipt = Object.freeze({
        schemaVersion: BROWSER_AI_SETUP_DIAGNOSTIC_SCHEMA_VERSION,
        sequence: ++this.sequence,
        checkpoint,
        fault: armed.fault,
        attemptIdDigest: token.attemptIdDigest,
        setupEpoch: token.ownership.epoch,
        controllerGenerationDigest: token.controllerGenerationDigest,
        singleFlightGenerationDigest: token.singleFlightGenerationDigest,
        abortControllerGenerationDigest: token.abortControllerGenerationDigest,
        workerGenerationDigest,
        engineGenerationDigest,
        runtimeOrdering,
      });
      armed.state = "arrived";
      this.arrivalCount += 1;
      this.lastArrival = receipt;
      armed.resolveArrival(receipt);
    }
    await armed.release;
    // release() is the harness acknowledgement, not authorization for a stale
    // epoch to inject a fault. Clear the consumed arm, then fence once more
    // before changing any fault counters or returning the fault to Product.
    if (this.armed === armed) this.armed = null;
    if (this.activeAttempt !== token) {
      this.staleCompletionRejectedCount += 1;
      throw diagnosticError("BROWSER_AI_SETUP_DIAGNOSTIC_STALE_ATTEMPT");
    }
    const fault = armed.fault;
    if (fault === "worker-crash") this.workerCrashFaultTriggeredCount += 1;
    if (fault === "metadata-transaction-abort") {
      this.metadataTransactionAbortFaultTriggeredCount += 1;
    }
    if (fault === "stale-completion") {
      this.staleCompletionFaultTriggeredCount += 1;
    }
    return Object.freeze({ disposition: "released" as const, fault });
  }

  private acknowledgeCleanup(
    token: AttemptToken,
    input: Readonly<{
      engineOwnershipMatched: boolean;
      engineDetached: boolean;
      workerDisposeAcknowledged: boolean;
      metadataCleanupAcknowledged: boolean;
    }>,
  ) {
    if (this.activeAttempt !== token) {
      this.staleCompletionRejectedCount += 1;
      throw diagnosticError("BROWSER_AI_SETUP_DIAGNOSTIC_STALE_ATTEMPT");
    }
    const receipt = Object.freeze({
      schemaVersion: BROWSER_AI_SETUP_DIAGNOSTIC_SCHEMA_VERSION,
      attemptIdDigest: token.attemptIdDigest,
      setupEpoch: token.ownership.epoch,
      abortControllerGenerationDigest: token.abortControllerGenerationDigest,
      cleanupAcknowledged: input.engineDetached === true
        && input.engineOwnershipMatched === true
        && input.workerDisposeAcknowledged === true
        && input.metadataCleanupAcknowledged === true,
      engineOwnershipMatched: input.engineOwnershipMatched === true,
      engineDetached: input.engineDetached === true,
      workerDisposeAcknowledged: input.workerDisposeAcknowledged === true,
      metadataCleanupAcknowledged: input.metadataCleanupAcknowledged === true,
    });
    this.lastCleanup = receipt;
    return receipt;
  }
}

const BOOTSTRAP_GLOBAL = "__NOVEL_RC6_4_BROWSER_SETUP_DIAGNOSTIC_BOOTSTRAP__";
const BRIDGE_GLOBAL = "__NOVEL_RC6_4_BROWSER_SETUP_DIAGNOSTICS__";

type DiagnosticWindow = Window & Record<string, unknown>;

let browserControllerPromise: Promise<BrowserAiSetupDiagnosticController | null> | null = null;

function consumeBootstrap(target: DiagnosticWindow): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(target, BOOTSTRAP_GLOBAL);
  // Only a disposable own data property can serve as the one-use capability.
  // Inherited accessors and non-configurable values are never evaluated or
  // accepted. A malformed value is still consumed before it is validated.
  if (!descriptor || descriptor.configurable !== true) return undefined;
  if (!Reflect.deleteProperty(target, BOOTSTRAP_GLOBAL)) return undefined;
  return "value" in descriptor ? descriptor.value : undefined;
}

function exactBootstrap(value: unknown): value is Readonly<{
  schemaVersion: typeof BROWSER_AI_SETUP_DIAGNOSTIC_SCHEMA_VERSION;
  authorizationId: string;
}> {
  if (!value || typeof value !== "object") return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.keys(descriptors).sort().join(",") !== "authorizationId,schemaVersion") {
      return false;
    }
    const schemaVersion = descriptors.schemaVersion;
    const authorizationId = descriptors.authorizationId;
    return schemaVersion !== undefined
      && authorizationId !== undefined
      && "value" in schemaVersion
      && "value" in authorizationId
      && schemaVersion.value === BROWSER_AI_SETUP_DIAGNOSTIC_SCHEMA_VERSION
      && typeof authorizationId.value === "string"
      && AUTHORIZATION_ID.test(authorizationId.value);
  } catch {
    return false;
  }
}

export function browserAiSetupDiagnosticController():
  | Promise<BrowserAiSetupDiagnosticControllerHandle | null>
  | null {
  if (process.env.NEXT_PUBLIC_RC6_4_BROWSER_SETUP_DIAGNOSTICS !== "1") {
    return null;
  }
  if (typeof window === "undefined") return null;
  if (browserControllerPromise) return browserControllerPromise;
  browserControllerPromise = (async () => {
    try {
      const target = window as unknown as DiagnosticWindow;
      const bootstrap = consumeBootstrap(target);
      if (!exactBootstrap(bootstrap)) return null;
      if (Object.prototype.hasOwnProperty.call(target, BRIDGE_GLOBAL)) return null;
      const controller = await BrowserAiSetupDiagnosticController.create(
        bootstrap.authorizationId,
      );
      Object.defineProperty(target, BRIDGE_GLOBAL, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: controller.bridge(),
      });
      return controller;
    } catch {
      return null;
    }
  })();
  return browserControllerPromise;
}

export async function createBrowserAiSetupDiagnosticsForTests(
  authorizationId: string,
): Promise<Readonly<{
  controller: BrowserAiSetupDiagnosticControllerHandle;
  bridge: BrowserAiSetupDiagnosticBridge;
}>> {
  const controller = await BrowserAiSetupDiagnosticController.create(authorizationId);
  return Object.freeze({
    controller,
    bridge: controller.bridge(),
  });
}

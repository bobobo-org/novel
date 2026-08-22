import { sha256Hex, stableStringify } from "../closed-ai-cache";

export const BROWSER_PROSE_DIAGNOSTIC_BOOTSTRAP_GLOBAL =
  "__NOVEL_RC6_4_BROWSER_PROSE_DIAGNOSTIC_BOOTSTRAP__" as const;
export const BROWSER_PROSE_DIAGNOSTIC_BRIDGE_GLOBAL =
  "__NOVEL_RC6_4_BROWSER_PROSE_DIAGNOSTIC__" as const;

export const BROWSER_PROSE_DIAGNOSTIC_BOOTSTRAP_VERSION =
  "rc6.4-browser-prose-diagnostic-bootstrap-v1" as const;
export const BROWSER_PROSE_DIAGNOSTIC_BRIDGE_VERSION =
  "rc6.4-browser-prose-diagnostic-bridge-v1" as const;
export const BROWSER_PROSE_DIAGNOSTIC_ARM_RESULT_VERSION =
  "rc6.4-browser-prose-diagnostic-arm-result-v1" as const;
export const BROWSER_PROSE_DIAGNOSTIC_CONSUME_RESULT_VERSION =
  "rc6.4-browser-prose-diagnostic-consume-result-v1" as const;
export const BROWSER_PROSE_DIAGNOSTIC_SNAPSHOT_VERSION =
  "rc6.4-browser-prose-diagnostic-snapshot-v1" as const;

export const BROWSER_PROSE_DIAGNOSTIC_MATRIX_DIGEST_DOMAIN =
  "rc6.4-browser-prose-diagnostic-matrix-v1" as const;
export const BROWSER_PROSE_DIAGNOSTIC_AUTHORIZATION_DIGEST_DOMAIN =
  "rc6.4-browser-prose-diagnostic-authorization-v1" as const;
export const BROWSER_PROSE_DIAGNOSTIC_TUPLE_DIGEST_DOMAIN =
  "rc6.4-browser-prose-diagnostic-tuple-v1" as const;
export const BROWSER_PROSE_DIAGNOSTIC_REQUEST_BINDING_DIGEST_DOMAIN =
  "rc6.4-browser-prose-diagnostic-request-binding-v1" as const;

export const BROWSER_PROSE_DIAGNOSTIC_CONTEXT_IDS = Object.freeze([
  "context-01",
  "context-02",
  "context-03",
  "context-04",
] as const);
export const BROWSER_PROSE_DIAGNOSTIC_BASE_SEEDS = Object.freeze([
  17_041,
  27_043,
  37_049,
] as const);

export const BROWSER_PROSE_DIAGNOSTICS_COMPILED =
  process.env.NEXT_PUBLIC_RC6_4_BROWSER_PROSE_DIAGNOSTICS === "1";

type TupleValue<T extends readonly unknown[]> = T[number];

export type BrowserProseDiagnosticContextId =
  TupleValue<typeof BROWSER_PROSE_DIAGNOSTIC_CONTEXT_IDS>;
export type BrowserProseDiagnosticBaseSeed =
  TupleValue<typeof BROWSER_PROSE_DIAGNOSTIC_BASE_SEEDS>;

export type BrowserProseDiagnosticBootstrap = Readonly<{
  schemaVersion: typeof BROWSER_PROSE_DIAGNOSTIC_BOOTSTRAP_VERSION;
  authorizationId: string;
  matrixDigest: string;
}>;

export type BrowserProseDiagnosticMatrixEntry = Readonly<{
  contextId: BrowserProseDiagnosticContextId;
  consumerOrdinal: number;
  baseSeed: BrowserProseDiagnosticBaseSeed;
}>;

export type BrowserProseDiagnosticArmInput = BrowserProseDiagnosticMatrixEntry &
  Readonly<{ tupleDigest: string }>;

export type BrowserProseDiagnosticArmCode =
  | "ARMED"
  | "ARM_INPUT_INVALID"
  | "TUPLE_DIGEST_MISMATCH"
  | "BRIDGE_ALREADY_ARMED"
  | "BRIDGE_ALREADY_CONSUMED";

export type BrowserProseDiagnosticConsumeCode =
  | "SEED_APPLIED"
  | "BRIDGE_NOT_ARMED"
  | "REQUEST_BINDING_INVALID"
  | "BRIDGE_ALREADY_CONSUMED";

export type BrowserProseDiagnosticCode =
  | "INITIALIZED"
  | BrowserProseDiagnosticArmCode
  | BrowserProseDiagnosticConsumeCode;

export type BrowserProseDiagnosticArmResult = Readonly<{
  schemaVersion: typeof BROWSER_PROSE_DIAGNOSTIC_ARM_RESULT_VERSION;
  status: "armed" | "rejected";
  code: BrowserProseDiagnosticArmCode;
  authorizationDigest: string;
  matrixDigest: string;
  tupleDigest: string | null;
  state: "idle" | "armed" | "consumed";
  armAttempts: number;
  armAccepted: 0 | 1;
  rejectedAttempts: number;
}>;

export type BrowserProseDiagnosticConsumeInput = Readonly<{
  projectId: string;
  sessionId: string;
  taskType: "chapter.continue";
  requestId: string;
}>;

export type BrowserProseDiagnosticConsumeResult = Readonly<{
  schemaVersion: typeof BROWSER_PROSE_DIAGNOSTIC_CONSUME_RESULT_VERSION;
  status: "applied" | "rejected";
  code: BrowserProseDiagnosticConsumeCode;
  authorizationDigest: string;
  matrixDigest: string;
  tupleDigest: string | null;
  requestBindingDigest: string | null;
  baseSeed: BrowserProseDiagnosticBaseSeed | null;
  consumeAttempts: number;
  consumeAccepted: 0 | 1;
  rejectedAttempts: number;
}>;

export type BrowserProseDiagnosticSnapshot = Readonly<{
  schemaVersion: typeof BROWSER_PROSE_DIAGNOSTIC_SNAPSHOT_VERSION;
  state: "idle" | "armed" | "consumed";
  lastCode: BrowserProseDiagnosticCode;
  authorizationDigest: string;
  matrixDigest: string;
  tupleDigest: string | null;
  requestBindingDigest: string | null;
  contextId: BrowserProseDiagnosticContextId | null;
  consumerOrdinal: number | null;
  baseSeed: BrowserProseDiagnosticBaseSeed | null;
  armAttempts: number;
  armAccepted: 0 | 1;
  consumeAttempts: number;
  consumeAccepted: 0 | 1;
  rejectedAttempts: number;
}>;

export type BrowserProseDiagnosticBridge = Readonly<{
  schemaVersion: typeof BROWSER_PROSE_DIAGNOSTIC_BRIDGE_VERSION;
  authorizationDigest: string;
  matrixDigest: string;
  arm: (
    input: BrowserProseDiagnosticArmInput,
  ) => Promise<BrowserProseDiagnosticArmResult>;
  snapshot: () => BrowserProseDiagnosticSnapshot;
}>;

type DiagnosticHost = object;

type BridgeState = {
  authorizationId: string;
  authorizationDigest: string;
  matrixDigest: string;
  state: "idle" | "armed" | "consumed";
  lastCode: BrowserProseDiagnosticCode;
  tupleDigest: string | null;
  requestBindingDigest: string | null;
  contextId: BrowserProseDiagnosticContextId | null;
  consumerOrdinal: number | null;
  baseSeed: BrowserProseDiagnosticBaseSeed | null;
  armAttempts: number;
  armAccepted: 0 | 1;
  consumeAttempts: number;
  consumeAccepted: 0 | 1;
  api: BrowserProseDiagnosticBridge | null;
};

const DIGEST = /^[a-f0-9]{64}$/u;
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/u;
const initializedHosts = new WeakSet<DiagnosticHost>();
const bridgeStates = new WeakMap<DiagnosticHost, BridgeState>();

function browserHost(): DiagnosticHost | null {
  return typeof window === "undefined" ? null : window;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Reflect.ownKeys(value).length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isContextId(value: unknown): value is BrowserProseDiagnosticContextId {
  return typeof value === "string"
    && BROWSER_PROSE_DIAGNOSTIC_CONTEXT_IDS.includes(
      value as BrowserProseDiagnosticContextId,
    );
}

function isBaseSeed(value: unknown): value is BrowserProseDiagnosticBaseSeed {
  return typeof value === "number"
    && BROWSER_PROSE_DIAGNOSTIC_BASE_SEEDS.includes(
      value as BrowserProseDiagnosticBaseSeed,
    );
}

function isConsumerOrdinal(value: unknown) {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 1
    && value <= 12;
}

function validMatrixEntry(value: unknown): value is BrowserProseDiagnosticMatrixEntry {
  return isPlainRecord(value)
    && exactKeys(value, ["contextId", "consumerOrdinal", "baseSeed"])
    && isContextId(value.contextId)
    && isConsumerOrdinal(value.consumerOrdinal)
    && isBaseSeed(value.baseSeed);
}

function validArmInput(value: unknown): value is BrowserProseDiagnosticArmInput {
  return isPlainRecord(value)
    && exactKeys(value, [
      "contextId",
      "consumerOrdinal",
      "baseSeed",
      "tupleDigest",
    ])
    && isContextId(value.contextId)
    && isConsumerOrdinal(value.consumerOrdinal)
    && isBaseSeed(value.baseSeed)
    && typeof value.tupleDigest === "string"
    && DIGEST.test(value.tupleDigest);
}

function validBootstrap(value: unknown): value is BrowserProseDiagnosticBootstrap {
  return isPlainRecord(value)
    && exactKeys(value, ["schemaVersion", "authorizationId", "matrixDigest"])
    && value.schemaVersion === BROWSER_PROSE_DIAGNOSTIC_BOOTSTRAP_VERSION
    && typeof value.authorizationId === "string"
    && UUID_V4.test(value.authorizationId)
    && typeof value.matrixDigest === "string"
    && DIGEST.test(value.matrixDigest);
}

function validConsumeInput(value: unknown): value is BrowserProseDiagnosticConsumeInput {
  return isPlainRecord(value)
    && exactKeys(value, ["projectId", "sessionId", "taskType", "requestId"])
    && typeof value.projectId === "string"
    && REQUEST_ID.test(value.projectId)
    && typeof value.sessionId === "string"
    && REQUEST_ID.test(value.sessionId)
    && value.taskType === "chapter.continue"
    && typeof value.requestId === "string"
    && REQUEST_ID.test(value.requestId);
}

function rejectedAttempts(state: BridgeState) {
  return state.armAttempts - state.armAccepted
    + state.consumeAttempts - state.consumeAccepted;
}

function snapshot(state: BridgeState): BrowserProseDiagnosticSnapshot {
  return Object.freeze({
    schemaVersion: BROWSER_PROSE_DIAGNOSTIC_SNAPSHOT_VERSION,
    state: state.state,
    lastCode: state.lastCode,
    authorizationDigest: state.authorizationDigest,
    matrixDigest: state.matrixDigest,
    tupleDigest: state.tupleDigest,
    requestBindingDigest: state.requestBindingDigest,
    contextId: state.contextId,
    consumerOrdinal: state.consumerOrdinal,
    baseSeed: state.baseSeed,
    armAttempts: state.armAttempts,
    armAccepted: state.armAccepted,
    consumeAttempts: state.consumeAttempts,
    consumeAccepted: state.consumeAccepted,
    rejectedAttempts: rejectedAttempts(state),
  });
}

function armResult(
  state: BridgeState,
  status: "armed" | "rejected",
  code: BrowserProseDiagnosticArmCode,
): BrowserProseDiagnosticArmResult {
  return Object.freeze({
    schemaVersion: BROWSER_PROSE_DIAGNOSTIC_ARM_RESULT_VERSION,
    status,
    code,
    authorizationDigest: state.authorizationDigest,
    matrixDigest: state.matrixDigest,
    tupleDigest: status === "armed" ? state.tupleDigest : null,
    state: state.state,
    armAttempts: state.armAttempts,
    armAccepted: state.armAccepted,
    rejectedAttempts: rejectedAttempts(state),
  });
}

function consumeResult(
  state: BridgeState,
  status: "applied" | "rejected",
  code: BrowserProseDiagnosticConsumeCode,
): BrowserProseDiagnosticConsumeResult {
  return Object.freeze({
    schemaVersion: BROWSER_PROSE_DIAGNOSTIC_CONSUME_RESULT_VERSION,
    status,
    code,
    authorizationDigest: state.authorizationDigest,
    matrixDigest: state.matrixDigest,
    tupleDigest: state.tupleDigest,
    requestBindingDigest: status === "applied"
      ? state.requestBindingDigest
      : null,
    baseSeed: status === "applied" ? state.baseSeed : null,
    consumeAttempts: state.consumeAttempts,
    consumeAccepted: state.consumeAccepted,
    rejectedAttempts: rejectedAttempts(state),
  });
}

export async function digestBrowserProseDiagnosticMatrix(
  entries: readonly BrowserProseDiagnosticMatrixEntry[],
) {
  if (
    !Array.isArray(entries)
    || entries.length !== 12
    || entries.some((entry) => !validMatrixEntry(entry))
    || entries.some((entry, index) => entry.consumerOrdinal !== index + 1)
    || new Set(entries.map((entry) => (
      `${entry.contextId}:${entry.baseSeed}`
    ))).size !== entries.length
    || BROWSER_PROSE_DIAGNOSTIC_CONTEXT_IDS.some((contextId) => (
      BROWSER_PROSE_DIAGNOSTIC_BASE_SEEDS.some((baseSeed) => (
        !entries.some((entry) => (
          entry.contextId === contextId && entry.baseSeed === baseSeed
        ))
      ))
    ))
  ) throw new Error("BROWSER_PROSE_DIAGNOSTIC_MATRIX_INVALID");
  return sha256Hex(stableStringify({
    domain: BROWSER_PROSE_DIAGNOSTIC_MATRIX_DIGEST_DOMAIN,
    entries,
  }));
}

export async function digestBrowserProseDiagnosticAuthorization(
  bootstrap: BrowserProseDiagnosticBootstrap,
) {
  if (!validBootstrap(bootstrap)) {
    throw new Error("BROWSER_PROSE_DIAGNOSTIC_BOOTSTRAP_INVALID");
  }
  return sha256Hex(stableStringify({
    domain: BROWSER_PROSE_DIAGNOSTIC_AUTHORIZATION_DIGEST_DOMAIN,
    schemaVersion: bootstrap.schemaVersion,
    authorizationId: bootstrap.authorizationId,
    matrixDigest: bootstrap.matrixDigest,
  }));
}

export async function digestBrowserProseDiagnosticTuple(input: Readonly<{
  authorizationId: string;
  matrixDigest: string;
  contextId: BrowserProseDiagnosticContextId;
  consumerOrdinal: number;
  baseSeed: BrowserProseDiagnosticBaseSeed;
}>) {
  if (
    !isPlainRecord(input)
    || !exactKeys(input, [
      "authorizationId",
      "matrixDigest",
      "contextId",
      "consumerOrdinal",
      "baseSeed",
    ])
    || typeof input.authorizationId !== "string"
    || !UUID_V4.test(input.authorizationId)
    || typeof input.matrixDigest !== "string"
    || !DIGEST.test(input.matrixDigest)
    || !isContextId(input.contextId)
    || !isConsumerOrdinal(input.consumerOrdinal)
    || !isBaseSeed(input.baseSeed)
  ) throw new Error("BROWSER_PROSE_DIAGNOSTIC_TUPLE_INVALID");
  return sha256Hex(stableStringify({
    domain: BROWSER_PROSE_DIAGNOSTIC_TUPLE_DIGEST_DOMAIN,
    authorizationId: input.authorizationId,
    matrixDigest: input.matrixDigest,
    contextId: input.contextId,
    consumerOrdinal: input.consumerOrdinal,
    baseSeed: input.baseSeed,
  }));
}

export async function digestBrowserProseDiagnosticRequestBinding(
  input: BrowserProseDiagnosticConsumeInput & Readonly<{
    authorizationDigest: string;
    matrixDigest: string;
    tupleDigest: string;
  }>,
) {
  if (
    !isPlainRecord(input)
    || !exactKeys(input, [
      "authorizationDigest",
      "matrixDigest",
      "tupleDigest",
      "projectId",
      "sessionId",
      "taskType",
      "requestId",
    ])
    || typeof input.authorizationDigest !== "string"
    || !DIGEST.test(input.authorizationDigest)
    || typeof input.matrixDigest !== "string"
    || !DIGEST.test(input.matrixDigest)
    || typeof input.tupleDigest !== "string"
    || !DIGEST.test(input.tupleDigest)
    || !validConsumeInput({
      projectId: input.projectId,
      sessionId: input.sessionId,
      taskType: input.taskType,
      requestId: input.requestId,
    })
  ) throw new Error("BROWSER_PROSE_DIAGNOSTIC_REQUEST_BINDING_INVALID");
  return sha256Hex(stableStringify({
    domain: BROWSER_PROSE_DIAGNOSTIC_REQUEST_BINDING_DIGEST_DOMAIN,
    authorizationDigest: input.authorizationDigest,
    matrixDigest: input.matrixDigest,
    tupleDigest: input.tupleDigest,
    projectId: input.projectId,
    sessionId: input.sessionId,
    taskType: input.taskType,
    requestId: input.requestId,
  }));
}

function consumeBootstrap(host: DiagnosticHost) {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(
      host,
      BROWSER_PROSE_DIAGNOSTIC_BOOTSTRAP_GLOBAL,
    );
  } catch {
    return null;
  }
  if (!descriptor) return null;
  const value = "value" in descriptor ? descriptor.value : null;
  try {
    if (!Reflect.deleteProperty(host, BROWSER_PROSE_DIAGNOSTIC_BOOTSTRAP_GLOBAL)) {
      return null;
    }
  } catch {
    return null;
  }
  return validBootstrap(value) ? value : null;
}

async function armBridge(
  state: BridgeState,
  input: BrowserProseDiagnosticArmInput,
) {
  state.armAttempts += 1;
  if (state.state === "armed") {
    state.lastCode = "BRIDGE_ALREADY_ARMED";
    return armResult(state, "rejected", "BRIDGE_ALREADY_ARMED");
  }
  if (state.state === "consumed") {
    state.lastCode = "BRIDGE_ALREADY_CONSUMED";
    return armResult(state, "rejected", "BRIDGE_ALREADY_CONSUMED");
  }
  if (!validArmInput(input)) {
    state.lastCode = "ARM_INPUT_INVALID";
    return armResult(state, "rejected", "ARM_INPUT_INVALID");
  }
  const expectedTupleDigest = await digestBrowserProseDiagnosticTuple({
    authorizationId: state.authorizationId,
    matrixDigest: state.matrixDigest,
    contextId: input.contextId,
    consumerOrdinal: input.consumerOrdinal,
    baseSeed: input.baseSeed,
  });
  if (input.tupleDigest !== expectedTupleDigest) {
    state.lastCode = "TUPLE_DIGEST_MISMATCH";
    return armResult(state, "rejected", "TUPLE_DIGEST_MISMATCH");
  }
  state.state = "armed";
  state.lastCode = "ARMED";
  state.tupleDigest = input.tupleDigest;
  state.contextId = input.contextId;
  state.consumerOrdinal = input.consumerOrdinal;
  state.baseSeed = input.baseSeed;
  state.armAccepted = 1;
  return armResult(state, "armed", "ARMED");
}

function bridgeDescriptor(host: DiagnosticHost) {
  try {
    return Object.getOwnPropertyDescriptor(
      host,
      BROWSER_PROSE_DIAGNOSTIC_BRIDGE_GLOBAL,
    );
  } catch {
    return undefined;
  }
}

export async function initializeBrowserProseDiagnosticBridge(
  host: DiagnosticHost | null = browserHost(),
  enabled = BROWSER_PROSE_DIAGNOSTICS_COMPILED,
): Promise<BrowserProseDiagnosticBridge | null> {
  if (!enabled || !host) return null;
  if (initializedHosts.has(host)) {
    consumeBootstrap(host);
    const state = bridgeStates.get(host);
    const descriptor = bridgeDescriptor(host);
    return state?.api && descriptor?.value === state.api ? state.api : null;
  }
  initializedHosts.add(host);
  const bootstrap = consumeBootstrap(host);
  if (!bootstrap) return null;
  const authorizationDigest = await digestBrowserProseDiagnosticAuthorization(
    bootstrap,
  );
  const state: BridgeState = {
    authorizationId: bootstrap.authorizationId,
    authorizationDigest,
    matrixDigest: bootstrap.matrixDigest,
    state: "idle",
    lastCode: "INITIALIZED",
    tupleDigest: null,
    requestBindingDigest: null,
    contextId: null,
    consumerOrdinal: null,
    baseSeed: null,
    armAttempts: 0,
    armAccepted: 0,
    consumeAttempts: 0,
    consumeAccepted: 0,
    api: null,
  };
  const api: BrowserProseDiagnosticBridge = Object.freeze({
    schemaVersion: BROWSER_PROSE_DIAGNOSTIC_BRIDGE_VERSION,
    authorizationDigest,
    matrixDigest: bootstrap.matrixDigest,
    arm: (input: BrowserProseDiagnosticArmInput) => armBridge(state, input),
    snapshot: () => snapshot(state),
  });
  state.api = api;
  try {
    if (bridgeDescriptor(host)) return null;
    Object.defineProperty(host, BROWSER_PROSE_DIAGNOSTIC_BRIDGE_GLOBAL, {
      value: api,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  } catch {
    return null;
  }
  bridgeStates.set(host, state);
  return api;
}

export async function consumeBrowserProseDiagnosticSeed(
  input: BrowserProseDiagnosticConsumeInput,
  host: DiagnosticHost | null = browserHost(),
  enabled = BROWSER_PROSE_DIAGNOSTICS_COMPILED,
): Promise<BrowserProseDiagnosticConsumeResult | null> {
  if (!enabled || !host) return null;
  const state = bridgeStates.get(host);
  const descriptor = bridgeDescriptor(host);
  if (!state?.api || descriptor?.value !== state.api) return null;
  state.consumeAttempts += 1;
  if (state.state === "consumed") {
    state.lastCode = "BRIDGE_ALREADY_CONSUMED";
    return consumeResult(state, "rejected", "BRIDGE_ALREADY_CONSUMED");
  }
  if (state.state !== "armed") {
    state.lastCode = "BRIDGE_NOT_ARMED";
    return consumeResult(state, "rejected", "BRIDGE_NOT_ARMED");
  }
  if (!validConsumeInput(input) || !state.tupleDigest) {
    state.state = "consumed";
    state.lastCode = "REQUEST_BINDING_INVALID";
    state.baseSeed = null;
    return consumeResult(state, "rejected", "REQUEST_BINDING_INVALID");
  }
  state.requestBindingDigest = await digestBrowserProseDiagnosticRequestBinding({
    authorizationDigest: state.authorizationDigest,
    matrixDigest: state.matrixDigest,
    tupleDigest: state.tupleDigest,
    projectId: input.projectId,
    sessionId: input.sessionId,
    taskType: input.taskType,
    requestId: input.requestId,
  });
  state.state = "consumed";
  state.lastCode = "SEED_APPLIED";
  state.consumeAccepted = 1;
  return consumeResult(state, "applied", "SEED_APPLIED");
}

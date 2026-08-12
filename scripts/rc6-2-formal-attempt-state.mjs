import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const FORMAL_ATTEMPT_SCHEMA_VERSION = "1";
export const FORMAL_ATTEMPT_STATES = Object.freeze([
  "PREPARED",
  "PREFLIGHT_PASSED",
  "PRECHECK_FAILED",
  "LAUNCH_COMMITTED",
  "RUNNER_STARTED",
  "BROWSER_STARTED",
  "TERMINAL_PASS",
  "TERMINAL_FAIL",
  "TERMINAL_ABORTED",
]);
export const FORMAL_ATTEMPT_EVENT_TYPES = Object.freeze([
  "ATTEMPT_PREPARED",
  "PREFLIGHT_PASSED",
  "PREFLIGHT_FAILED",
  "LAUNCH_COMMITTED",
  "RUNNER_STARTED",
  "BROWSER_STARTED",
  "RUNNER_COMPLETED",
  "TERMINAL_PASS",
  "TERMINAL_FAIL",
  "TERMINAL_ABORTED",
  "CLEANUP_COMPLETED",
]);
export const FORMAL_ATTEMPT_FILES = Object.freeze({
  authorization: "attempt-authorization.json",
  initialLease: "attempt-lease-initial.json",
  journal: "attempt-events.jsonl",
  liveLease: "attempt-lease.json",
});
export const FormalProductionBrowserAttemptLease = Object.freeze({
  schemaVersion: FORMAL_ATTEMPT_SCHEMA_VERSION,
  states: FORMAL_ATTEMPT_STATES,
  requiredFields: Object.freeze([
    "schemaVersion",
    "attemptId",
    "authorizationId",
    "authorizationDigest",
    "productCommit",
    "controlCommit",
    "deploymentId",
    "productionOrigin",
    "releaseTag",
    "releaseRevision",
    "runtimeReceiptDigest",
    "wrapperDigest",
    "runnerDigest",
    "contractDigest",
    "createdAt",
    "updatedAt",
    "state",
    "revision",
    "attemptConsumed",
    "runnerStarted",
    "browserStarted",
    "runnerCompleted",
    "runnerOutcome",
    "cleanupCompleted",
    "terminalStatus",
    "lastEventSequence",
    "lastEventDigest",
    "leaseDigest",
  ]),
});

const EVENT_DIGEST_DOMAIN = "p24b-rc6.2-formal-attempt-event-v1";
const LEASE_DIGEST_DOMAIN = "p24b-rc6.2-formal-attempt-lease-v1";
const AUTHORIZATION_DIGEST_DOMAIN = "p24b-rc6.2-formal-attempt-authorization-v1";
const AUTHORIZATION_CLAIM_DIGEST_DOMAIN = "p24b-rc6.2-formal-attempt-authorization-claim-v1";
const LOCK_OWNER_DIGEST_DOMAIN = "p24b-rc6.2-formal-attempt-lock-owner-v1";
const MAX_CLI_INPUT_BYTES = 64 * 1024;
const ORPHAN_LOCK_GRACE_MS = 30_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const ATTEMPT_ID_PATTERN = /^C7-PROD-BROWSER-\d{8}T\d{9}Z-[a-f0-9]{32}$/u;
const AUTHORIZATION_ID_PATTERN = /^C7-PROD-BROWSER-AUTH-\d{8}T\d{9}Z-[a-f0-9]{32}$/u;
const EVENT_KEYS = Object.freeze([
  "schemaVersion",
  "attemptId",
  "sequence",
  "eventType",
  "occurredAt",
  "previousEventDigest",
  "eventBody",
  "eventDigest",
]);
const AUTHORIZATION_KEYS = Object.freeze([
  "schemaVersion",
  "authorizationId",
  "authorizedControlCommit",
  "authorizedProductCommit",
  "authorizedDeploymentId",
  "authorizedAt",
  "maxFormalAttempts",
  "authorizationDigest",
]);
const ATTEMPT_AUTHORIZATION_BINDING_KEYS = Object.freeze([
  ...AUTHORIZATION_KEYS,
  "attemptId",
  "productionOrigin",
  "claimedAt",
  "claimDigest",
]);
const AUTHORIZATION_CLAIM_KEYS = Object.freeze([
  "schemaVersion",
  "authorizationId",
  "authorizationDigest",
  "attemptId",
  "productionOrigin",
  "claimedAt",
  "attemptRootDigest",
  "stagingName",
  "claimDigest",
]);
const ATTEMPT_PREPARED_BODY_KEYS = Object.freeze([
  "authorizationId",
  "authorizationDigest",
  "productCommit",
  "controlCommit",
  "deploymentId",
  "productionOrigin",
  "releaseTag",
  "releaseRevision",
  "runtimeReceiptDigest",
  "wrapperDigest",
  "runnerDigest",
  "contractDigest",
]);
const PROJECTION_OVERRIDE_KEYS = new Set([
  "state",
  "revision",
  "attemptConsumed",
  "runnerStarted",
  "browserStarted",
  "runnerCompleted",
  "runnerOutcome",
  "cleanupCompleted",
  "terminalStatus",
  "lastEventSequence",
  "lastEventDigest",
  "leaseDigest",
]);
const CLI_ERROR_CODES = new Set([
  "ATTEMPT_ALREADY_EXISTS",
  "ATTEMPT_CREATION_RECOVERY_FAILED",
  "ATTEMPT_DIRECTORY_INVALID",
  "ATTEMPT_ID_INVALID",
  "ATTEMPT_ID_MISMATCH",
  "ATTEMPT_LOCKED",
  "ATTEMPT_TERMINAL_BEFORE_EXPECTED_STATE",
  "ATTEMPT_WAIT_TIMEOUT",
  "AUTHORIZATION_ALREADY_CONSUMED",
  "AUTHORIZATION_ALREADY_EXISTS",
  "AUTHORIZATION_DIGEST_MISMATCH",
  "AUTHORIZATION_ID_INVALID",
  "AUTHORIZATION_NOT_FOUND",
  "AUTHORIZATION_SCOPE_MISMATCH",
  "CLI_COMMAND_INVALID",
  "CLI_INPUT_INVALID",
  "CLI_INPUT_TOO_LARGE",
  "EVENT_BODY_INVALID",
  "EVENT_DIGEST_MISMATCH",
  "EVENT_JOURNAL_INVALID",
  "EVENT_SEQUENCE_INVALID",
  "IDENTITY_MISMATCH",
  "IDEMPOTENT_TRANSITION_MISMATCH",
  "LEASE_DIGEST_MISMATCH",
  "LEASE_PROJECTION_INVALID",
  "LEASE_PROJECTION_STALE",
  "LEASE_PROJECTION_WRITE_FAILED",
  "REVISION_MISMATCH",
  "STATE_MISMATCH",
  "TRANSITION_INVALID",
]);

export class FormalAttemptError extends Error {
  constructor(code, message = code, options) {
    super(message, options);
    this.name = "FormalAttemptError";
    this.code = code;
  }
}

function fail(code, message = code, options) {
  throw new FormalAttemptError(code, message, options);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("CLI_INPUT_INVALID", "Canonical JSON rejects non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) fail("CLI_INPUT_INVALID", "Canonical JSON requires plain objects");
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) fail("CLI_INPUT_INVALID", "Canonical JSON rejects undefined values");
    result[key] = canonicalize(value[key]);
  }
  return result;
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function domainDigest(domain, value) {
  return sha256Hex(`${domain}\n${stableStringify(value)}`);
}

export function computeFormalAttemptEventDigest(eventWithoutDigest) {
  return domainDigest(EVENT_DIGEST_DOMAIN, eventWithoutDigest);
}

export function computeFormalAttemptLeaseDigest(leaseWithoutDigest) {
  return domainDigest(LEASE_DIGEST_DOMAIN, leaseWithoutDigest);
}

export function computeFormalAttemptAuthorizationDigest(authorizationWithoutDigest) {
  return domainDigest(AUTHORIZATION_DIGEST_DOMAIN, authorizationWithoutDigest);
}

function compactUtc(date = new Date()) {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(".", "");
}

export function generateFormalAttemptId({ now = new Date(), random = randomBytes(16) } = {}) {
  if (!Buffer.isBuffer(random) || random.byteLength !== 16) fail("ATTEMPT_ID_INVALID");
  const attemptId = `C7-PROD-BROWSER-${compactUtc(now)}-${random.toString("hex")}`;
  assertAttemptId(attemptId);
  return attemptId;
}

export function generateFormalAuthorizationId({ now = new Date(), random = randomBytes(16) } = {}) {
  if (!Buffer.isBuffer(random) || random.byteLength !== 16) fail("AUTHORIZATION_ID_INVALID");
  const authorizationId = `C7-PROD-BROWSER-AUTH-${compactUtc(now)}-${random.toString("hex")}`;
  assertAuthorizationId(authorizationId);
  return authorizationId;
}

function assertAttemptId(attemptId) {
  if (typeof attemptId !== "string" || !ATTEMPT_ID_PATTERN.test(attemptId)) fail("ATTEMPT_ID_INVALID");
}

function assertAuthorizationId(authorizationId) {
  if (typeof authorizationId !== "string" || !AUTHORIZATION_ID_PATTERN.test(authorizationId)) {
    fail("AUTHORIZATION_ID_INVALID");
  }
}

function assertDigest(value, code = "IDENTITY_MISMATCH", { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) fail(code);
}

function assertCommit(value) {
  if (typeof value !== "string" || !COMMIT_PATTERN.test(value)) fail("IDENTITY_MISMATCH");
}

function assertNonEmptyString(value, code = "IDENTITY_MISMATCH") {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) fail(code);
}

function assertIsoUtc(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail("EVENT_BODY_INVALID");
  }
}

function assertAbsoluteDirectory(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048 || !path.isAbsolute(value)) {
    fail("ATTEMPT_DIRECTORY_INVALID");
  }
  return path.resolve(value);
}

function assertProductionOrigin(value) {
  assertNonEmptyString(value);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("IDENTITY_MISMATCH");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    fail("IDENTITY_MISMATCH");
  }
}

function assertEventBody(eventBody) {
  if (!isPlainObject(eventBody)) fail("EVENT_BODY_INVALID");
  for (const key of Object.keys(eventBody)) {
    if (PROJECTION_OVERRIDE_KEYS.has(key)) fail("EVENT_BODY_INVALID");
  }
}

function omitDigest(value, digestKey) {
  const copy = { ...value };
  delete copy[digestKey];
  return copy;
}

function withLeaseDigest(leaseWithoutDigest) {
  return {
    ...leaseWithoutDigest,
    leaseDigest: computeFormalAttemptLeaseDigest(leaseWithoutDigest),
  };
}

export function validateFormalAttemptAuthorization(authorization) {
  if (!isPlainObject(authorization) || authorization.schemaVersion !== FORMAL_ATTEMPT_SCHEMA_VERSION) {
    fail("AUTHORIZATION_DIGEST_MISMATCH");
  }
  assertExactKeys(authorization, AUTHORIZATION_KEYS, "AUTHORIZATION_DIGEST_MISMATCH");
  assertAuthorizationId(authorization.authorizationId);
  assertCommit(authorization.authorizedControlCommit);
  assertCommit(authorization.authorizedProductCommit);
  assertNonEmptyString(authorization.authorizedDeploymentId, "AUTHORIZATION_SCOPE_MISMATCH");
  assertIsoUtc(authorization.authorizedAt);
  if (authorization.maxFormalAttempts !== 1) fail("AUTHORIZATION_SCOPE_MISMATCH");
  assertDigest(authorization.authorizationDigest, "AUTHORIZATION_DIGEST_MISMATCH");
  const expected = computeFormalAttemptAuthorizationDigest(omitDigest(authorization, "authorizationDigest"));
  if (authorization.authorizationDigest !== expected) fail("AUTHORIZATION_DIGEST_MISMATCH");
  return authorization;
}

function writeAll(fd, value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  let offset = 0;
  while (offset < buffer.byteLength) offset += writeSync(fd, buffer, offset, buffer.byteLength - offset);
}

function writeDurableNewFile(file, contents, existsCode) {
  let fd;
  try {
    fd = openSync(file, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
    writeAll(fd, contents);
    fsyncSync(fd);
  } catch (error) {
    if (error?.code === "EEXIST") fail(existsCode, existsCode, { cause: error });
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function writeDurableNewJson(file, value, existsCode) {
  writeDurableNewFile(file, `${stableStringify(value)}\n`, existsCode);
}

function readJson(file, code) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!isPlainObject(parsed)) fail(code);
    return parsed;
  } catch (error) {
    if (error instanceof FormalAttemptError) throw error;
    fail(code, code, { cause: error });
  }
}

function registryRecordPath(registryRoot, kind, authorizationId) {
  const root = assertAbsoluteDirectory(registryRoot);
  assertAuthorizationId(authorizationId);
  const key = sha256Hex(authorizationId);
  return path.join(root, kind, `${key}.json`);
}

function ensureRegistryDirectories(registryRoot) {
  const root = assertAbsoluteDirectory(registryRoot);
  mkdirSync(path.join(root, "authorizations"), { recursive: true });
  mkdirSync(path.join(root, "claims"), { recursive: true });
  return root;
}

export function createAttemptAuthorization({
  registryRoot,
  authorizationId = generateFormalAuthorizationId(),
  authorizedControlCommit,
  authorizedProductCommit,
  authorizedDeploymentId,
  authorizedAt = new Date().toISOString(),
} = {}) {
  ensureRegistryDirectories(registryRoot);
  assertAuthorizationId(authorizationId);
  assertCommit(authorizedControlCommit);
  assertCommit(authorizedProductCommit);
  assertNonEmptyString(authorizedDeploymentId, "AUTHORIZATION_SCOPE_MISMATCH");
  assertIsoUtc(authorizedAt);
  const body = {
    schemaVersion: FORMAL_ATTEMPT_SCHEMA_VERSION,
    authorizationId,
    authorizedControlCommit,
    authorizedProductCommit,
    authorizedDeploymentId,
    authorizedAt,
    maxFormalAttempts: 1,
  };
  const authorization = {
    ...body,
    authorizationDigest: computeFormalAttemptAuthorizationDigest(body),
  };
  validateFormalAttemptAuthorization(authorization);
  writeDurableNewJson(
    registryRecordPath(registryRoot, "authorizations", authorizationId),
    authorization,
    "AUTHORIZATION_ALREADY_EXISTS",
  );
  return authorization;
}

export function readAttemptAuthorization({ registryRoot, authorizationId } = {}) {
  const file = registryRecordPath(registryRoot, "authorizations", authorizationId);
  if (!existsSync(file)) fail("AUTHORIZATION_NOT_FOUND");
  return validateFormalAttemptAuthorization(readJson(file, "AUTHORIZATION_DIGEST_MISMATCH"));
}

function claimAuthorization({
  registryRoot,
  authorization,
  attemptId,
  productionOrigin,
  claimedAt,
  attemptRoot,
  stagingName,
}) {
  const resolvedAttemptRoot = assertAbsoluteDirectory(attemptRoot);
  assertProductionOrigin(productionOrigin);
  if (typeof stagingName !== "string"
      || path.basename(stagingName) !== stagingName
      || !new RegExp(`^\\.creating-${attemptId}-[a-f0-9]{32}$`, "u").test(stagingName)) {
    fail("ATTEMPT_CREATION_RECOVERY_FAILED");
  }
  const body = {
    schemaVersion: FORMAL_ATTEMPT_SCHEMA_VERSION,
    authorizationId: authorization.authorizationId,
    authorizationDigest: authorization.authorizationDigest,
    attemptId,
    productionOrigin,
    claimedAt,
    attemptRootDigest: sha256Hex(resolvedAttemptRoot),
    stagingName,
  };
  const claim = {
    ...body,
    claimDigest: domainDigest(AUTHORIZATION_CLAIM_DIGEST_DOMAIN, body),
  };
  writeDurableNewJson(
    registryRecordPath(registryRoot, "claims", authorization.authorizationId),
    claim,
    "AUTHORIZATION_ALREADY_CONSUMED",
  );
  return claim;
}

function validateAuthorizationClaim(claim) {
  if (!isPlainObject(claim)) fail("ATTEMPT_CREATION_RECOVERY_FAILED");
  assertExactKeys(claim, AUTHORIZATION_CLAIM_KEYS, "ATTEMPT_CREATION_RECOVERY_FAILED");
  if (claim.schemaVersion !== FORMAL_ATTEMPT_SCHEMA_VERSION) fail("ATTEMPT_CREATION_RECOVERY_FAILED");
  assertAuthorizationId(claim.authorizationId);
  assertDigest(claim.authorizationDigest, "AUTHORIZATION_DIGEST_MISMATCH");
  assertAttemptId(claim.attemptId);
  assertProductionOrigin(claim.productionOrigin);
  assertIsoUtc(claim.claimedAt);
  assertDigest(claim.attemptRootDigest, "ATTEMPT_CREATION_RECOVERY_FAILED");
  if (typeof claim.stagingName !== "string"
      || path.basename(claim.stagingName) !== claim.stagingName
      || !new RegExp(`^\\.creating-${claim.attemptId}-[a-f0-9]{32}$`, "u").test(claim.stagingName)) {
    fail("ATTEMPT_CREATION_RECOVERY_FAILED");
  }
  assertDigest(claim.claimDigest, "ATTEMPT_CREATION_RECOVERY_FAILED");
  if (claim.claimDigest !== domainDigest(AUTHORIZATION_CLAIM_DIGEST_DOMAIN, omitDigest(claim, "claimDigest"))) {
    fail("ATTEMPT_CREATION_RECOVERY_FAILED");
  }
  return claim;
}

function readAuthorizationClaim({ registryRoot, authorizationId }) {
  const file = registryRecordPath(registryRoot, "claims", authorizationId);
  if (!existsSync(file)) fail("ATTEMPT_CREATION_RECOVERY_FAILED");
  return validateAuthorizationClaim(readJson(file, "ATTEMPT_CREATION_RECOVERY_FAILED"));
}

function validateAttemptBindings(bindings, { allowNullRuntimeReceipt = true } = {}) {
  assertAttemptId(bindings.attemptId);
  assertAuthorizationId(bindings.authorizationId);
  assertDigest(bindings.authorizationDigest, "AUTHORIZATION_DIGEST_MISMATCH");
  assertCommit(bindings.productCommit);
  assertCommit(bindings.controlCommit);
  assertNonEmptyString(bindings.deploymentId);
  assertProductionOrigin(bindings.productionOrigin);
  assertNonEmptyString(bindings.releaseTag);
  assertNonEmptyString(bindings.releaseRevision);
  assertDigest(bindings.runtimeReceiptDigest, "IDENTITY_MISMATCH", { nullable: allowNullRuntimeReceipt });
  assertDigest(bindings.wrapperDigest);
  assertDigest(bindings.runnerDigest);
  assertDigest(bindings.contractDigest);
}

function createAttemptAuthorizationBinding({ authorization, attemptId, productionOrigin, claimedAt }) {
  validateFormalAttemptAuthorization(authorization);
  assertAttemptId(attemptId);
  assertProductionOrigin(productionOrigin);
  assertIsoUtc(claimedAt);
  const body = {
    ...authorization,
    attemptId,
    productionOrigin,
    claimedAt,
  };
  return { ...body, claimDigest: domainDigest(AUTHORIZATION_CLAIM_DIGEST_DOMAIN, body) };
}

function validateAttemptAuthorizationBinding(binding) {
  if (!isPlainObject(binding)) fail("AUTHORIZATION_DIGEST_MISMATCH");
  assertExactKeys(binding, ATTEMPT_AUTHORIZATION_BINDING_KEYS, "AUTHORIZATION_DIGEST_MISMATCH");
  const authorization = {
    schemaVersion: binding.schemaVersion,
    authorizationId: binding.authorizationId,
    authorizedControlCommit: binding.authorizedControlCommit,
    authorizedProductCommit: binding.authorizedProductCommit,
    authorizedDeploymentId: binding.authorizedDeploymentId,
    authorizedAt: binding.authorizedAt,
    maxFormalAttempts: binding.maxFormalAttempts,
    authorizationDigest: binding.authorizationDigest,
  };
  validateFormalAttemptAuthorization(authorization);
  assertAttemptId(binding.attemptId);
  assertProductionOrigin(binding.productionOrigin);
  assertIsoUtc(binding.claimedAt);
  assertDigest(binding.claimDigest, "AUTHORIZATION_DIGEST_MISMATCH");
  const expected = domainDigest(AUTHORIZATION_CLAIM_DIGEST_DOMAIN, omitDigest(binding, "claimDigest"));
  if (binding.claimDigest !== expected) fail("AUTHORIZATION_DIGEST_MISMATCH");
  return binding;
}

function createEvent({ attemptId, sequence, eventType, occurredAt, previousEventDigest, eventBody }) {
  assertAttemptId(attemptId);
  if (!Number.isSafeInteger(sequence) || sequence < 1) fail("EVENT_SEQUENCE_INVALID");
  if (!FORMAL_ATTEMPT_EVENT_TYPES.includes(eventType)) fail("TRANSITION_INVALID");
  assertIsoUtc(occurredAt);
  if (previousEventDigest !== null) assertDigest(previousEventDigest, "EVENT_DIGEST_MISMATCH");
  assertEventBody(eventBody);
  const body = {
    schemaVersion: FORMAL_ATTEMPT_SCHEMA_VERSION,
    attemptId,
    sequence,
    eventType,
    occurredAt,
    previousEventDigest,
    eventBody,
  };
  return { ...body, eventDigest: computeFormalAttemptEventDigest(body) };
}

function initialLeaseFromEvent(event) {
  if (event.sequence !== 1 || event.eventType !== "ATTEMPT_PREPARED" || event.previousEventDigest !== null) {
    fail("EVENT_SEQUENCE_INVALID");
  }
  assertExactKeys(event.eventBody, ATTEMPT_PREPARED_BODY_KEYS, "EVENT_BODY_INVALID");
  const bindings = { attemptId: event.attemptId, ...event.eventBody };
  validateAttemptBindings(bindings);
  if (bindings.runtimeReceiptDigest !== null) fail("EVENT_BODY_INVALID");
  return withLeaseDigest({
    schemaVersion: FORMAL_ATTEMPT_SCHEMA_VERSION,
    ...bindings,
    createdAt: event.occurredAt,
    updatedAt: event.occurredAt,
    state: "PREPARED",
    revision: 1,
    attemptConsumed: false,
    runnerStarted: false,
    browserStarted: false,
    runnerCompleted: false,
    runnerOutcome: null,
    cleanupCompleted: false,
    terminalStatus: null,
    lastEventSequence: 1,
    lastEventDigest: event.eventDigest,
  });
}

function requireReasonCode(eventBody) {
  if (typeof eventBody.reasonCode !== "string" || !/^[A-Z][A-Z0-9_]{2,127}$/u.test(eventBody.reasonCode)) {
    fail("EVENT_BODY_INVALID");
  }
}

function assertProjectionInvariants(lease) {
  if (!FORMAL_ATTEMPT_STATES.includes(lease.state)) fail("LEASE_PROJECTION_INVALID");
  if (lease.revision !== lease.lastEventSequence || !Number.isSafeInteger(lease.revision) || lease.revision < 1) {
    fail("LEASE_PROJECTION_INVALID");
  }
  assertDigest(lease.lastEventDigest, "LEASE_PROJECTION_INVALID");
  const preLaunch = new Set(["PREPARED", "PREFLIGHT_PASSED", "PRECHECK_FAILED"]);
  if (preLaunch.has(lease.state) && (lease.attemptConsumed || lease.runnerStarted || lease.browserStarted)) {
    fail("LEASE_PROJECTION_INVALID");
  }
  if (lease.state === "PRECHECK_FAILED" && lease.terminalStatus !== "FAIL") fail("LEASE_PROJECTION_INVALID");
  if (lease.state === "PREFLIGHT_PASSED" && lease.runtimeReceiptDigest === null) fail("LEASE_PROJECTION_INVALID");
  if (lease.state === "PREPARED" && lease.runtimeReceiptDigest !== null) fail("LEASE_PROJECTION_INVALID");
  if (["LAUNCH_COMMITTED", "RUNNER_STARTED", "BROWSER_STARTED", "TERMINAL_PASS", "TERMINAL_FAIL", "TERMINAL_ABORTED"].includes(lease.state)
      && !lease.attemptConsumed) fail("LEASE_PROJECTION_INVALID");
  if (["LAUNCH_COMMITTED", "RUNNER_STARTED", "BROWSER_STARTED", "TERMINAL_PASS", "TERMINAL_FAIL", "TERMINAL_ABORTED"].includes(lease.state)) {
    assertDigest(lease.runtimeReceiptDigest, "LEASE_PROJECTION_INVALID");
  }
  if (["RUNNER_STARTED", "BROWSER_STARTED", "TERMINAL_PASS"].includes(lease.state) && !lease.runnerStarted) {
    fail("LEASE_PROJECTION_INVALID");
  }
  if (["BROWSER_STARTED", "TERMINAL_PASS"].includes(lease.state) && !lease.browserStarted) {
    fail("LEASE_PROJECTION_INVALID");
  }
  if (lease.browserStarted && !lease.runnerStarted) fail("LEASE_PROJECTION_INVALID");
  if (lease.runnerCompleted !== (lease.runnerOutcome !== null)) fail("LEASE_PROJECTION_INVALID");
  if (lease.cleanupCompleted
      && !["LAUNCH_COMMITTED", "RUNNER_STARTED", "BROWSER_STARTED", "TERMINAL_PASS", "TERMINAL_FAIL", "TERMINAL_ABORTED"].includes(lease.state)) {
    fail("LEASE_PROJECTION_INVALID");
  }
  if (lease.state === "TERMINAL_PASS"
      && (lease.terminalStatus !== "PASS" || !lease.runnerCompleted || lease.runnerOutcome !== "PASS"
        || !lease.cleanupCompleted)) {
    fail("LEASE_PROJECTION_INVALID");
  }
  if (lease.state === "TERMINAL_FAIL" && lease.terminalStatus !== "FAIL") fail("LEASE_PROJECTION_INVALID");
  if (lease.state === "TERMINAL_ABORTED" && lease.terminalStatus !== "ABORTED") fail("LEASE_PROJECTION_INVALID");
  if (!["PRECHECK_FAILED", "TERMINAL_PASS", "TERMINAL_FAIL", "TERMINAL_ABORTED"].includes(lease.state)
      && lease.terminalStatus !== null) fail("LEASE_PROJECTION_INVALID");
  const expectedDigest = computeFormalAttemptLeaseDigest(omitDigest(lease, "leaseDigest"));
  if (lease.leaseDigest !== expectedDigest) fail("LEASE_DIGEST_MISMATCH");
  return lease;
}

export function validateFormalProductionBrowserAttemptLease(lease) {
  if (!isPlainObject(lease) || lease.schemaVersion !== FORMAL_ATTEMPT_SCHEMA_VERSION) {
    fail("LEASE_PROJECTION_INVALID");
  }
  for (const field of FormalProductionBrowserAttemptLease.requiredFields) {
    if (!Object.hasOwn(lease, field)) fail("LEASE_PROJECTION_INVALID");
  }
  assertExactKeys(lease, FormalProductionBrowserAttemptLease.requiredFields, "LEASE_PROJECTION_INVALID");
  validateAttemptBindings(lease);
  assertIsoUtc(lease.createdAt);
  assertIsoUtc(lease.updatedAt);
  if (Date.parse(lease.updatedAt) < Date.parse(lease.createdAt)) fail("LEASE_PROJECTION_INVALID");
  for (const field of ["attemptConsumed", "runnerStarted", "browserStarted", "runnerCompleted", "cleanupCompleted"]) {
    if (typeof lease[field] !== "boolean") fail("LEASE_PROJECTION_INVALID");
  }
  if (![null, "PASS", "FAIL", "ABORTED"].includes(lease.terminalStatus)) fail("LEASE_PROJECTION_INVALID");
  if (![null, "PASS", "FAIL"].includes(lease.runnerOutcome)) fail("LEASE_PROJECTION_INVALID");
  return assertProjectionInvariants(lease);
}

function applyEvent(previousLease, event) {
  if (previousLease === null) return assertProjectionInvariants(initialLeaseFromEvent(event));
  if (event.attemptId !== previousLease.attemptId) fail("ATTEMPT_ID_MISMATCH");
  if (event.sequence !== previousLease.lastEventSequence + 1) fail("EVENT_SEQUENCE_INVALID");
  if (event.previousEventDigest !== previousLease.lastEventDigest) fail("EVENT_DIGEST_MISMATCH");
  if (Date.parse(event.occurredAt) < Date.parse(previousLease.updatedAt)) fail("EVENT_SEQUENCE_INVALID");
  if (previousLease.cleanupCompleted
      && !["TERMINAL_PASS", "TERMINAL_FAIL", "TERMINAL_ABORTED"].includes(event.eventType)) {
    fail("TRANSITION_INVALID");
  }
  assertEventBody(event.eventBody);
  const next = {
    ...omitDigest(previousLease, "leaseDigest"),
    updatedAt: event.occurredAt,
    revision: event.sequence,
    lastEventSequence: event.sequence,
    lastEventDigest: event.eventDigest,
  };
  switch (event.eventType) {
    case "PREFLIGHT_PASSED": {
      if (previousLease.state !== "PREPARED") fail("TRANSITION_INVALID");
      assertExactKeys(event.eventBody,
        ["runtimeReceiptDigest", "wrapperDigest", "runnerDigest", "contractDigest"],
        "EVENT_BODY_INVALID");
      for (const key of ["runtimeReceiptDigest", "wrapperDigest", "runnerDigest", "contractDigest"]) {
        assertDigest(event.eventBody[key], "EVENT_BODY_INVALID");
      }
      if (event.eventBody.wrapperDigest !== previousLease.wrapperDigest
          || event.eventBody.runnerDigest !== previousLease.runnerDigest
          || event.eventBody.contractDigest !== previousLease.contractDigest) fail("IDENTITY_MISMATCH");
      next.runtimeReceiptDigest = event.eventBody.runtimeReceiptDigest;
      next.state = "PREFLIGHT_PASSED";
      break;
    }
    case "PREFLIGHT_FAILED": {
      if (!new Set(["PREPARED", "PREFLIGHT_PASSED"]).has(previousLease.state)) fail("TRANSITION_INVALID");
      if (previousLease.state === "PREFLIGHT_PASSED" && event.eventBody.runtimeReceiptDigest !== undefined) {
        fail("EVENT_BODY_INVALID");
      }
      const failureKeys = event.eventBody.runtimeReceiptDigest === undefined
        ? ["reasonCode"]
        : ["reasonCode", "runtimeReceiptDigest"];
      assertExactKeys(event.eventBody, failureKeys, "EVENT_BODY_INVALID");
      requireReasonCode(event.eventBody);
      if (event.eventBody.runtimeReceiptDigest !== undefined) {
        assertDigest(event.eventBody.runtimeReceiptDigest, "EVENT_BODY_INVALID", { nullable: true });
        next.runtimeReceiptDigest = event.eventBody.runtimeReceiptDigest;
      }
      next.state = "PRECHECK_FAILED";
      next.terminalStatus = "FAIL";
      break;
    }
    case "LAUNCH_COMMITTED": {
      if (previousLease.state !== "PREFLIGHT_PASSED") fail("TRANSITION_INVALID");
      assertExactKeys(event.eventBody, [], "EVENT_BODY_INVALID");
      assertDigest(previousLease.runtimeReceiptDigest, "TRANSITION_INVALID");
      next.state = "LAUNCH_COMMITTED";
      next.attemptConsumed = true;
      break;
    }
    case "RUNNER_STARTED": {
      if (previousLease.state !== "LAUNCH_COMMITTED") fail("TRANSITION_INVALID");
      assertExactKeys(event.eventBody, ["runnerPid"], "EVENT_BODY_INVALID");
      if (!Number.isSafeInteger(event.eventBody.runnerPid) || event.eventBody.runnerPid <= 0) fail("EVENT_BODY_INVALID");
      next.state = "RUNNER_STARTED";
      next.runnerStarted = true;
      break;
    }
    case "BROWSER_STARTED": {
      if (previousLease.state !== "RUNNER_STARTED") fail("TRANSITION_INVALID");
      assertExactKeys(event.eventBody,
        ["persistentContextEstablished", "networkRoutesInstalled", "productInteractionStarted"],
        "EVENT_BODY_INVALID");
      if (event.eventBody.persistentContextEstablished !== true
          || event.eventBody.networkRoutesInstalled !== true
          || event.eventBody.productInteractionStarted !== false) fail("EVENT_BODY_INVALID");
      next.state = "BROWSER_STARTED";
      next.browserStarted = true;
      break;
    }
    case "RUNNER_COMPLETED": {
      if (previousLease.state !== "BROWSER_STARTED" || previousLease.runnerCompleted) fail("TRANSITION_INVALID");
      assertExactKeys(event.eventBody, ["outcome", "exitCode", "runnerEvidenceDigest"], "EVENT_BODY_INVALID");
      if (!new Set(["PASS", "FAIL"]).has(event.eventBody.outcome)) fail("EVENT_BODY_INVALID");
      if (!Number.isSafeInteger(event.eventBody.exitCode)
          || event.eventBody.exitCode < -2_147_483_648
          || event.eventBody.exitCode > 4_294_967_295) fail("EVENT_BODY_INVALID");
      assertDigest(event.eventBody.runnerEvidenceDigest, "EVENT_BODY_INVALID");
      next.runnerCompleted = true;
      next.runnerOutcome = event.eventBody.outcome;
      break;
    }
    case "TERMINAL_PASS": {
      assertExactKeys(event.eventBody, [], "EVENT_BODY_INVALID");
      if (previousLease.state !== "BROWSER_STARTED" || !previousLease.runnerCompleted
          || previousLease.runnerOutcome !== "PASS" || !previousLease.cleanupCompleted) fail("TRANSITION_INVALID");
      next.state = "TERMINAL_PASS";
      next.terminalStatus = "PASS";
      break;
    }
    case "TERMINAL_FAIL": {
      if (!new Set(["LAUNCH_COMMITTED", "RUNNER_STARTED", "BROWSER_STARTED"]).has(previousLease.state)) {
        fail("TRANSITION_INVALID");
      }
      assertExactKeys(event.eventBody, ["reasonCode"], "EVENT_BODY_INVALID");
      requireReasonCode(event.eventBody);
      next.state = "TERMINAL_FAIL";
      next.terminalStatus = "FAIL";
      break;
    }
    case "TERMINAL_ABORTED": {
      if (!new Set(["LAUNCH_COMMITTED", "RUNNER_STARTED", "BROWSER_STARTED"]).has(previousLease.state)) {
        fail("TRANSITION_INVALID");
      }
      assertExactKeys(event.eventBody, ["reasonCode"], "EVENT_BODY_INVALID");
      requireReasonCode(event.eventBody);
      next.state = "TERMINAL_ABORTED";
      next.terminalStatus = "ABORTED";
      break;
    }
    case "CLEANUP_COMPLETED": {
      if (!new Set(["LAUNCH_COMMITTED", "RUNNER_STARTED", "BROWSER_STARTED"]).has(previousLease.state)) {
        fail("TRANSITION_INVALID");
      }
      assertExactKeys(event.eventBody, ["profileCleanupDigest", "processCleanupDigest"], "EVENT_BODY_INVALID");
      assertDigest(event.eventBody.profileCleanupDigest, "EVENT_BODY_INVALID");
      assertDigest(event.eventBody.processCleanupDigest, "EVENT_BODY_INVALID");
      next.cleanupCompleted = true;
      break;
    }
    case "ATTEMPT_PREPARED":
    default:
      fail("TRANSITION_INVALID");
  }
  return validateFormalProductionBrowserAttemptLease(withLeaseDigest(next));
}

function assertExactKeys(value, keys, code) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
}

function validateStoredEvent(event) {
  if (!isPlainObject(event)) fail("EVENT_JOURNAL_INVALID");
  assertExactKeys(event, EVENT_KEYS, "EVENT_JOURNAL_INVALID");
  if (event.schemaVersion !== FORMAL_ATTEMPT_SCHEMA_VERSION) fail("EVENT_JOURNAL_INVALID");
  assertAttemptId(event.attemptId);
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) fail("EVENT_SEQUENCE_INVALID");
  if (!FORMAL_ATTEMPT_EVENT_TYPES.includes(event.eventType)) fail("TRANSITION_INVALID");
  assertIsoUtc(event.occurredAt);
  if (event.previousEventDigest !== null) assertDigest(event.previousEventDigest, "EVENT_DIGEST_MISMATCH");
  assertEventBody(event.eventBody);
  assertDigest(event.eventDigest, "EVENT_DIGEST_MISMATCH");
  if (event.eventDigest !== computeFormalAttemptEventDigest(omitDigest(event, "eventDigest"))) {
    fail("EVENT_DIGEST_MISMATCH");
  }
  return event;
}

function parseJournal(attemptDirectory) {
  const journal = path.join(attemptDirectory, FORMAL_ATTEMPT_FILES.journal);
  let text;
  try {
    text = readFileSync(journal, "utf8");
  } catch (error) {
    fail("EVENT_JOURNAL_INVALID", "EVENT_JOURNAL_INVALID", { cause: error });
  }
  if (!text || !text.endsWith("\n")) fail("EVENT_JOURNAL_INVALID");
  return text.slice(0, -1).split("\n").map((line) => {
    try {
      return validateStoredEvent(JSON.parse(line));
    } catch (error) {
      if (error instanceof FormalAttemptError) throw error;
      fail("EVENT_JOURNAL_INVALID", "EVENT_JOURNAL_INVALID", { cause: error });
    }
  });
}

function verifyAuthorizationCopy(attemptDirectory, lease) {
  const authorization = validateAttemptAuthorizationBinding(readJson(
    path.join(attemptDirectory, FORMAL_ATTEMPT_FILES.authorization),
    "AUTHORIZATION_DIGEST_MISMATCH",
  ));
  if (authorization.authorizationId !== lease.authorizationId
      || authorization.authorizationDigest !== lease.authorizationDigest
      || authorization.authorizedControlCommit !== lease.controlCommit
      || authorization.authorizedProductCommit !== lease.productCommit
      || authorization.authorizedDeploymentId !== lease.deploymentId
      || authorization.attemptId !== lease.attemptId
      || authorization.productionOrigin !== lease.productionOrigin) fail("AUTHORIZATION_SCOPE_MISMATCH");
  return authorization;
}

function verifyExpectedIdentity(lease, expected = {}) {
  const fields = {
    expectedAttemptId: "attemptId",
    expectedControlCommit: "controlCommit",
    expectedProductCommit: "productCommit",
    expectedDeploymentId: "deploymentId",
    expectedProductionOrigin: "productionOrigin",
    expectedAuthorizationDigest: "authorizationDigest",
    expectedAuthorizationId: "authorizationId",
    expectedReleaseTag: "releaseTag",
    expectedReleaseRevision: "releaseRevision",
    expectedRuntimeReceiptDigest: "runtimeReceiptDigest",
    expectedWrapperDigest: "wrapperDigest",
    expectedRunnerDigest: "runnerDigest",
    expectedContractDigest: "contractDigest",
  };
  for (const [expectedKey, leaseKey] of Object.entries(fields)) {
    if (expected[expectedKey] !== undefined && expected[expectedKey] !== lease[leaseKey]) fail("IDENTITY_MISMATCH");
  }
}

export function verifyAttemptJournal({ attemptDirectory, ...expected } = {}) {
  const directory = assertAbsoluteDirectory(attemptDirectory);
  const events = parseJournal(directory);
  let lease = null;
  for (const event of events) lease = applyEvent(lease, event);
  verifyExpectedIdentity(lease, expected);
  verifyAuthorizationCopy(directory, lease);
  const initialLease = readJson(path.join(directory, FORMAL_ATTEMPT_FILES.initialLease), "LEASE_PROJECTION_INVALID");
  const expectedInitial = initialLeaseFromEvent(events[0]);
  if (stableStringify(initialLease) !== stableStringify(expectedInitial)) fail("LEASE_PROJECTION_INVALID");
  return { valid: true, eventCount: events.length, events, lease };
}

function readLiveProjection(attemptDirectory) {
  const lease = readJson(path.join(attemptDirectory, FORMAL_ATTEMPT_FILES.liveLease), "LEASE_PROJECTION_INVALID");
  return validateFormalProductionBrowserAttemptLease(lease);
}

function atomicWriteProjection(attemptDirectory, lease, { faultInjection } = {}) {
  const live = path.join(attemptDirectory, FORMAL_ATTEMPT_FILES.liveLease);
  const temporary = path.join(attemptDirectory, `.attempt-lease-${randomBytes(16).toString("hex")}.tmp`);
  let temporaryCreated = false;
  try {
    writeDurableNewJson(temporary, lease, "LEASE_PROJECTION_WRITE_FAILED");
    temporaryCreated = true;
    if (faultInjection === "before-projection-replace") fail("LEASE_PROJECTION_WRITE_FAILED");
    renameSync(temporary, live);
    temporaryCreated = false;
    const readBack = readLiveProjection(attemptDirectory);
    if (stableStringify(readBack) !== stableStringify(lease)) fail("LEASE_PROJECTION_WRITE_FAILED");
  } catch (error) {
    if (error instanceof FormalAttemptError) throw error;
    fail("LEASE_PROJECTION_WRITE_FAILED", "LEASE_PROJECTION_WRITE_FAILED", { cause: error });
  } finally {
    if (temporaryCreated) {
      try {
        unlinkSync(temporary);
      } catch {
        // A uniquely named temporary projection is never authoritative.
      }
    }
  }
}

function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function createLockOwner() {
  const body = {
    schemaVersion: FORMAL_ATTEMPT_SCHEMA_VERSION,
    pid: process.pid,
    nonce: randomBytes(16).toString("hex"),
    acquiredAt: new Date().toISOString(),
  };
  return { ...body, ownerDigest: domainDigest(LOCK_OWNER_DIGEST_DOMAIN, body) };
}

function readLockOwner(lockDirectory) {
  try {
    const owner = readJson(path.join(lockDirectory, "owner.json"), "ATTEMPT_LOCKED");
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0
        || typeof owner.nonce !== "string" || !/^[a-f0-9]{32}$/u.test(owner.nonce)
        || typeof owner.ownerDigest !== "string"
        || owner.ownerDigest !== domainDigest(LOCK_OWNER_DIGEST_DOMAIN, omitDigest(owner, "ownerDigest"))) {
      fail("ATTEMPT_LOCKED");
    }
    if (typeof owner.acquiredAt !== "string"
        || Number.isNaN(Date.parse(owner.acquiredAt))
        || new Date(owner.acquiredAt).toISOString() !== owner.acquiredAt) fail("ATTEMPT_LOCKED");
    return owner;
  } catch (error) {
    if (error instanceof FormalAttemptError) throw error;
    fail("ATTEMPT_LOCKED", "ATTEMPT_LOCKED", { cause: error });
  }
}

function acquireAttemptLock(attemptDirectory) {
  const lockDirectory = path.join(attemptDirectory, ".formal-attempt-transition.lock");
  for (let pass = 0; pass < 3; pass += 1) {
    const owner = createLockOwner();
    try {
      mkdirSync(lockDirectory);
      writeDurableNewJson(path.join(lockDirectory, "owner.json"), owner, "ATTEMPT_LOCKED");
      return { lockDirectory, owner };
    } catch (error) {
      if (error?.code !== "EEXIST" && error?.code !== "ATTEMPT_LOCKED") throw error;
    }
    let stale = false;
    try {
      const existingOwner = readLockOwner(lockDirectory);
      stale = !isProcessAlive(existingOwner.pid);
    } catch (error) {
      if (error?.code !== "ATTEMPT_LOCKED") throw error;
      try {
        stale = Date.now() - statSync(lockDirectory).mtimeMs >= ORPHAN_LOCK_GRACE_MS;
      } catch {
        continue;
      }
    }
    if (!stale) fail("ATTEMPT_LOCKED");
    const tombstone = path.join(attemptDirectory, `.formal-attempt-stale-lock-${randomBytes(16).toString("hex")}`);
    try {
      renameSync(lockDirectory, tombstone);
      rmSync(tombstone, { recursive: true, force: true });
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "EEXIST") continue;
      fail("ATTEMPT_LOCKED", "ATTEMPT_LOCKED", { cause: error });
    }
  }
  fail("ATTEMPT_LOCKED");
}

function releaseAttemptLock({ lockDirectory, owner }) {
  try {
    const current = readLockOwner(lockDirectory);
    if (current.nonce !== owner.nonce || current.pid !== owner.pid) fail("ATTEMPT_LOCKED");
    rmSync(lockDirectory, { recursive: true, force: false });
  } catch (error) {
    if (error instanceof FormalAttemptError) throw error;
    fail("ATTEMPT_LOCKED", "ATTEMPT_LOCKED", { cause: error });
  }
}

function withAttemptLock(attemptDirectory, operation) {
  const lock = acquireAttemptLock(attemptDirectory);
  let result;
  let operationError;
  try {
    result = operation();
  } catch (error) {
    operationError = error;
  }
  try {
    releaseAttemptLock(lock);
  } catch (unlockError) {
    if (!operationError) throw unlockError;
  }
  if (operationError) throw operationError;
  return result;
}

function assertProjectionCurrent(attemptDirectory, reconstructed) {
  const live = readLiveProjection(attemptDirectory);
  if (stableStringify(live) !== stableStringify(reconstructed)) fail("LEASE_PROJECTION_STALE");
  return live;
}

function appendDurableEvent(attemptDirectory, event) {
  const journal = path.join(attemptDirectory, FORMAL_ATTEMPT_FILES.journal);
  let fd;
  try {
    fd = openSync(journal, fsConstants.O_WRONLY | fsConstants.O_APPEND);
    writeAll(fd, `${stableStringify(event)}\n`);
    fsyncSync(fd);
  } catch (error) {
    fail("EVENT_JOURNAL_INVALID", "EVENT_JOURNAL_INVALID", { cause: error });
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function loadAttempt({ attemptDirectory, rebuildProjection = false, ...expected } = {}) {
  const directory = assertAbsoluteDirectory(attemptDirectory);
  const verified = verifyAttemptJournal({ attemptDirectory: directory, ...expected });
  try {
    assertProjectionCurrent(directory, verified.lease);
    return verified.lease;
  } catch (error) {
    if (!rebuildProjection || error?.code !== "LEASE_PROJECTION_STALE") throw error;
    return recoverAttemptLease({ attemptDirectory: directory, ...expected }).lease;
  }
}

export function recoverAttemptLease({ attemptDirectory, ...expected } = {}) {
  const directory = assertAbsoluteDirectory(attemptDirectory);
  return withAttemptLock(directory, () => {
    const verified = verifyAttemptJournal({ attemptDirectory: directory, ...expected });
    atomicWriteProjection(directory, verified.lease);
    return { recovered: true, eventCount: verified.eventCount, lease: verified.lease };
  });
}

export function transitionAttempt({
  attemptDirectory,
  eventType,
  eventBody = {},
  occurredAt = new Date().toISOString(),
  expectedRevision,
  expectedState,
  faultInjection,
  ...expected
} = {}) {
  const directory = assertAbsoluteDirectory(attemptDirectory);
  return withAttemptLock(directory, () => {
    const verified = verifyAttemptJournal({ attemptDirectory: directory, ...expected });
    const current = assertProjectionCurrent(directory, verified.lease);
    if (expectedRevision !== undefined && expectedRevision !== current.revision) fail("REVISION_MISMATCH");
    if (expectedState !== undefined && expectedState !== current.state) fail("STATE_MISMATCH");
    const event = createEvent({
      attemptId: current.attemptId,
      sequence: current.lastEventSequence + 1,
      eventType,
      occurredAt,
      previousEventDigest: current.lastEventDigest,
      eventBody,
    });
    const lease = applyEvent(current, event);
    appendDurableEvent(directory, event);
    atomicWriteProjection(directory, lease, { faultInjection });
    return { event, lease };
  });
}

function replayEventPrefix(events, length) {
  let lease = null;
  for (let index = 0; index < length; index += 1) lease = applyEvent(lease, events[index]);
  return lease;
}

function exactIdempotentSuccessor({ verified, eventType, eventBody, expectedRevision, expectedState }) {
  if (verified.events.length < 2 || verified.lease.revision !== expectedRevision + 1) {
    fail("IDEMPOTENT_TRANSITION_MISMATCH");
  }
  const event = verified.events.at(-1);
  const predecessor = replayEventPrefix(verified.events, verified.events.length - 1);
  if (
    predecessor === null
    || predecessor.revision !== expectedRevision
    || predecessor.state !== expectedState
    || event.sequence !== expectedRevision + 1
    || event.eventType !== eventType
    || stableStringify(event.eventBody) !== stableStringify(eventBody)
  ) fail("IDEMPOTENT_TRANSITION_MISMATCH");
  return event;
}

function repairProjectionToVerifiedJournal(attemptDirectory, lease) {
  try {
    assertProjectionCurrent(attemptDirectory, lease);
    return false;
  } catch (error) {
    if (!(error instanceof FormalAttemptError)) throw error;
    atomicWriteProjection(attemptDirectory, lease);
    assertProjectionCurrent(attemptDirectory, lease);
    return true;
  }
}

export function transitionAttemptIdempotent({
  attemptDirectory,
  eventType,
  eventBody = {},
  occurredAt = new Date().toISOString(),
  expectedRevision,
  expectedState,
  faultInjection,
  ...expected
} = {}) {
  const directory = assertAbsoluteDirectory(attemptDirectory);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1
      || !FORMAL_ATTEMPT_STATES.includes(expectedState)) fail("CLI_INPUT_INVALID");
  return withAttemptLock(directory, () => {
    let verified = verifyAttemptJournal({ attemptDirectory: directory, ...expected });
    const projectionRepairedBeforeTransition = repairProjectionToVerifiedJournal(directory, verified.lease);

    if (verified.lease.revision === expectedRevision + 1) {
      const event = exactIdempotentSuccessor({
        verified,
        eventType,
        eventBody,
        expectedRevision,
        expectedState,
      });
      return {
        event,
        lease: verified.lease,
        eventAppended: false,
        exactSuccessorRecovered: true,
        projectionRepaired: projectionRepairedBeforeTransition,
      };
    }
    if (verified.lease.revision !== expectedRevision) fail("REVISION_MISMATCH");
    if (verified.lease.state !== expectedState) fail("STATE_MISMATCH");

    const event = createEvent({
      attemptId: verified.lease.attemptId,
      sequence: expectedRevision + 1,
      eventType,
      occurredAt,
      previousEventDigest: verified.lease.lastEventDigest,
      eventBody,
    });
    const lease = applyEvent(verified.lease, event);
    try {
      appendDurableEvent(directory, event);
      atomicWriteProjection(directory, lease, { faultInjection });
      return {
        event,
        lease,
        eventAppended: true,
        exactSuccessorRecovered: false,
        projectionRepaired: projectionRepairedBeforeTransition,
      };
    } catch (error) {
      verified = verifyAttemptJournal({ attemptDirectory: directory, ...expected });
      if (verified.lease.revision === expectedRevision && verified.lease.state === expectedState) {
        throw error;
      }
      const recoveredEvent = exactIdempotentSuccessor({
        verified,
        eventType,
        eventBody,
        expectedRevision,
        expectedState,
      });
      repairProjectionToVerifiedJournal(directory, verified.lease);
      return {
        event: recoveredEvent,
        lease: verified.lease,
        eventAppended: true,
        exactSuccessorRecovered: true,
        projectionRepaired: true,
      };
    }
  });
}

export async function waitForAttemptState({
  attemptDirectory,
  state,
  timeoutMs = 30_000,
  pollMs = 50,
  ...expected
} = {}) {
  if (!FORMAL_ATTEMPT_STATES.includes(state)) fail("STATE_MISMATCH");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 30_000
      || !Number.isSafeInteger(pollMs) || pollMs < 10 || pollMs > 1_000) fail("CLI_INPUT_INVALID");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const lease = loadAttempt({ attemptDirectory, rebuildProjection: false, ...expected });
      if (lease.state === state) return lease;
      if (["PRECHECK_FAILED", "TERMINAL_PASS", "TERMINAL_FAIL", "TERMINAL_ABORTED"].includes(lease.state)) {
        fail("ATTEMPT_TERMINAL_BEFORE_EXPECTED_STATE");
      }
    } catch (error) {
      if (error?.code !== "ATTEMPT_LOCKED") throw error;
    }
    if (Date.now() >= deadline) fail("ATTEMPT_WAIT_TIMEOUT");
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - Date.now()))));
  }
}

export async function commitBrowserStartedOrClose({ persistentContext, transition } = {}) {
  if (!persistentContext || typeof persistentContext.close !== "function" || typeof transition !== "function") {
    fail("CLI_INPUT_INVALID");
  }
  try {
    return await transition();
  } catch (transitionError) {
    try {
      await persistentContext.close();
    } catch {
      // The transition failure remains primary; the caller must terminalize the attempt as FAIL.
    }
    throw transitionError;
  }
}

export function createFormalProductionBrowserAttempt({
  attemptRoot,
  registryRoot,
  attemptId = generateFormalAttemptId(),
  authorizationId,
  authorizationDigest,
  productCommit,
  controlCommit,
  deploymentId,
  productionOrigin,
  releaseTag,
  releaseRevision,
  wrapperDigest,
  runnerDigest,
  contractDigest,
  createdAt = new Date().toISOString(),
  faultInjection,
} = {}) {
  const root = assertAbsoluteDirectory(attemptRoot);
  ensureRegistryDirectories(registryRoot);
  assertAttemptId(attemptId);
  assertIsoUtc(createdAt);
  const finalDirectory = path.join(root, attemptId);
  if (existsSync(finalDirectory)) fail("ATTEMPT_ALREADY_EXISTS");
  const authorization = readAttemptAuthorization({ registryRoot, authorizationId });
  assertDigest(authorizationDigest, "AUTHORIZATION_DIGEST_MISMATCH");
  if (authorization.authorizationDigest !== authorizationDigest) fail("AUTHORIZATION_DIGEST_MISMATCH");
  if (authorization.authorizedControlCommit !== controlCommit
      || authorization.authorizedProductCommit !== productCommit
      || authorization.authorizedDeploymentId !== deploymentId) fail("AUTHORIZATION_SCOPE_MISMATCH");
  const bindings = {
    authorizationId,
    authorizationDigest,
    productCommit,
    controlCommit,
    deploymentId,
    productionOrigin,
    releaseTag,
    releaseRevision,
    runtimeReceiptDigest: null,
    wrapperDigest,
    runnerDigest,
    contractDigest,
  };
  validateAttemptBindings({ attemptId, ...bindings });
  mkdirSync(root, { recursive: true });
  const stagingDirectory = path.join(root, `.creating-${attemptId}-${randomBytes(16).toString("hex")}`);
  mkdirSync(stagingDirectory);
  let published = false;
  let authorizationClaimed = false;
  try {
    const event = createEvent({
      attemptId,
      sequence: 1,
      eventType: "ATTEMPT_PREPARED",
      occurredAt: createdAt,
      previousEventDigest: null,
      eventBody: bindings,
    });
    const lease = initialLeaseFromEvent(event);
    const authorizationBinding = createAttemptAuthorizationBinding({
      authorization,
      attemptId,
      productionOrigin,
      claimedAt: createdAt,
    });
    writeDurableNewJson(
      path.join(stagingDirectory, FORMAL_ATTEMPT_FILES.authorization),
      authorizationBinding,
      "ATTEMPT_ALREADY_EXISTS",
    );
    writeDurableNewFile(
      path.join(stagingDirectory, FORMAL_ATTEMPT_FILES.journal),
      `${stableStringify(event)}\n`,
      "ATTEMPT_ALREADY_EXISTS",
    );
    writeDurableNewJson(path.join(stagingDirectory, FORMAL_ATTEMPT_FILES.initialLease), lease, "ATTEMPT_ALREADY_EXISTS");
    writeDurableNewJson(path.join(stagingDirectory, FORMAL_ATTEMPT_FILES.liveLease), lease, "ATTEMPT_ALREADY_EXISTS");
    claimAuthorization({
      registryRoot,
      authorization: authorizationBinding,
      attemptId,
      productionOrigin,
      claimedAt: createdAt,
      attemptRoot: root,
      stagingName: path.basename(stagingDirectory),
    });
    authorizationClaimed = true;
    if (faultInjection === "after-authorization-claim") fail("ATTEMPT_CREATION_RECOVERY_FAILED");
    try {
      renameSync(stagingDirectory, finalDirectory);
    } catch (error) {
      if (error?.code === "EEXIST" || error?.code === "ENOTEMPTY") fail("ATTEMPT_ALREADY_EXISTS");
      throw error;
    }
    published = true;
    const verified = verifyAttemptJournal({
      attemptDirectory: finalDirectory,
      expectedAttemptId: attemptId,
      expectedControlCommit: controlCommit,
      expectedProductCommit: productCommit,
      expectedDeploymentId: deploymentId,
      expectedProductionOrigin: productionOrigin,
      expectedAuthorizationDigest: authorizationDigest,
    });
    assertProjectionCurrent(finalDirectory, verified.lease);
    return { attemptDirectory: finalDirectory, authorization, event, lease: verified.lease };
  } finally {
    if (!published && !authorizationClaimed) {
      try {
        rmSync(stagingDirectory, { recursive: true, force: true });
      } catch {
        // A staging directory is never treated as a formal attempt.
      }
    }
  }
}

export function recoverFormalProductionBrowserAttemptCreation({
  attemptRoot,
  registryRoot,
  authorizationId,
  ...expected
} = {}) {
  const root = assertAbsoluteDirectory(attemptRoot);
  const authorization = readAttemptAuthorization({ registryRoot, authorizationId });
  const claim = readAuthorizationClaim({ registryRoot, authorizationId });
  if (claim.authorizationDigest !== authorization.authorizationDigest
      || claim.attemptRootDigest !== sha256Hex(root)) fail("ATTEMPT_CREATION_RECOVERY_FAILED");
  const finalDirectory = path.join(root, claim.attemptId);
  const stagingDirectory = path.join(root, claim.stagingName);
  const identity = {
    expectedAttemptId: claim.attemptId,
    expectedAuthorizationId: authorizationId,
    expectedAuthorizationDigest: authorization.authorizationDigest,
    expectedProductionOrigin: claim.productionOrigin,
    ...expected,
  };
  if (!existsSync(finalDirectory)) {
    if (!existsSync(stagingDirectory)) fail("ATTEMPT_CREATION_RECOVERY_FAILED");
    verifyAttemptJournal({ attemptDirectory: stagingDirectory, ...identity });
    assertProjectionCurrent(stagingDirectory, verifyAttemptJournal({
      attemptDirectory: stagingDirectory,
      ...identity,
    }).lease);
    try {
      renameSync(stagingDirectory, finalDirectory);
    } catch (error) {
      fail("ATTEMPT_CREATION_RECOVERY_FAILED", "ATTEMPT_CREATION_RECOVERY_FAILED", { cause: error });
    }
  }
  const verified = verifyAttemptJournal({ attemptDirectory: finalDirectory, ...identity });
  assertProjectionCurrent(finalDirectory, verified.lease);
  return { recovered: true, attemptDirectory: finalDirectory, lease: verified.lease };
}

function safeSummary(lease) {
  return {
    attemptId: lease.attemptId,
    state: lease.state,
    revision: lease.revision,
    attemptConsumed: lease.attemptConsumed,
    runnerStarted: lease.runnerStarted,
    browserStarted: lease.browserStarted,
    runnerCompleted: lease.runnerCompleted,
    runnerOutcome: lease.runnerOutcome,
    cleanupCompleted: lease.cleanupCompleted,
    terminalStatus: lease.terminalStatus,
    lastEventSequence: lease.lastEventSequence,
    lastEventDigest: lease.lastEventDigest,
    leaseDigest: lease.leaseDigest,
  };
}

async function readBoundedStdin() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.byteLength;
    if (bytes > MAX_CLI_INPUT_BYTES) fail("CLI_INPUT_TOO_LARGE");
    chunks.push(chunk);
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    fail("CLI_INPUT_INVALID", "CLI_INPUT_INVALID", { cause: error });
  }
  if (!isPlainObject(payload)) fail("CLI_INPUT_INVALID");
  return payload;
}

async function runCli(command, payload) {
  switch (command) {
    case "create-authorization": {
      const authorization = createAttemptAuthorization(payload);
      return {
        authorizationId: authorization.authorizationId,
        authorizationDigest: authorization.authorizationDigest,
        maxFormalAttempts: authorization.maxFormalAttempts,
      };
    }
    case "read-authorization": {
      const authorization = readAttemptAuthorization(payload);
      return {
        authorizationId: authorization.authorizationId,
        authorizationDigest: authorization.authorizationDigest,
        authorizedControlCommit: authorization.authorizedControlCommit,
        authorizedProductCommit: authorization.authorizedProductCommit,
        authorizedDeploymentId: authorization.authorizedDeploymentId,
        maxFormalAttempts: authorization.maxFormalAttempts,
      };
    }
    case "create-attempt": {
      const result = createFormalProductionBrowserAttempt(payload);
      return safeSummary(result.lease);
    }
    case "transition": {
      const result = transitionAttempt(payload);
      return safeSummary(result.lease);
    }
    case "transition-idempotent": {
      const result = transitionAttemptIdempotent(payload);
      return {
        ...safeSummary(result.lease),
        eventAppended: result.eventAppended,
        exactSuccessorRecovered: result.exactSuccessorRecovered,
        projectionRepaired: result.projectionRepaired,
      };
    }
    case "verify": {
      const result = verifyAttemptJournal(payload);
      return { valid: true, eventCount: result.eventCount, ...safeSummary(result.lease) };
    }
    case "recover": {
      const result = recoverAttemptLease(payload);
      return { recovered: true, eventCount: result.eventCount, ...safeSummary(result.lease) };
    }
    case "recover-creation": {
      const result = recoverFormalProductionBrowserAttemptCreation(payload);
      return { recovered: true, ...safeSummary(result.lease) };
    }
    case "wait-state": {
      return safeSummary(await waitForAttemptState(payload));
    }
    default:
      fail("CLI_COMMAND_INVALID");
  }
}

async function main() {
  const command = process.argv[2];
  try {
    const result = await runCli(command, await readBoundedStdin());
    process.stdout.write(`${stableStringify(result)}\n`);
  } catch (error) {
    const code = CLI_ERROR_CODES.has(error?.code) ? error.code : "INTERNAL_ERROR";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

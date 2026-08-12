import { randomBytes } from "node:crypto";
import { link, open, lstat, mkdir, readFile, readdir, realpath, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { collectCredentialValues, scanCredentialBytes } from "./scan-sealed-production-artifact.mjs";
import {
  FORMAL_ATTEMPT_SCHEMA_VERSION,
  FORMAL_ATTEMPT_STATES,
  FormalAttemptError,
  computeFormalAttemptAuthorizationDigest,
  computeFormalAttemptEventDigest,
  computeFormalAttemptLeaseDigest,
  createAttemptAuthorization,
  createFormalProductionBrowserAttempt,
  generateFormalAttemptId,
  generateFormalAuthorizationId,
  sha256Hex,
  stableStringify,
  transitionAttempt,
  verifyAttemptJournal,
} from "./rc6-2-formal-attempt-state.mjs";

export {
  computeFormalAttemptAuthorizationDigest,
  computeFormalAttemptEventDigest,
  computeFormalAttemptLeaseDigest,
  sha256Hex,
  stableStringify,
};

export const RC6_2_PRODUCT_COMMIT = "29fc6e742672bb07187765d34ea818afdadf56ae";
export const RC6_2_DEPLOYMENT_ID = "dpl_8pqTpwAgQQAqmLKNzZNCzSfPuqNn";
export const RC6_2_PRODUCTION_ORIGIN = "https://novel-eexnlr77y-lqtechs-projects.vercel.app";
export const RC6_2_RELEASE_TAG = "novel-ai-p24b-conversation-first-studio-rc6.2";
export const RC6_2_RELEASE_REVISION = "rc6.2";

export const TERMINAL_MANIFEST_SCHEMA = "p24b-rc6.2-formal-production-browser-terminal-manifest-v1";
export const TERMINAL_MANIFEST_FILE = "terminal-evidence-manifest.json";
export const TERMINAL_MANIFEST_SHA_FILE = "terminal-evidence-manifest.sha256";
export const TERMINAL_EMERGENCY_FILE = "emergency-terminal-failure.json";

const AUTHORIZATION_SCHEMA = FORMAL_ATTEMPT_SCHEMA_VERSION;
const LEASE_SCHEMA = FORMAL_ATTEMPT_SCHEMA_VERSION;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const ATTEMPT_ID_PATTERN = /^C7-PROD-BROWSER-\d{8}T\d{9}Z-[a-f0-9]{32}$/u;
const AUTHORIZATION_ID_PATTERN = /^C7-PROD-BROWSER-AUTH-\d{8}T\d{9}Z-[a-f0-9]{32}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SAFE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,127}$/u;
const SAFE_VERSION_PATTERN = /^[0-9A-Za-z.+-]{1,64}$/u;
const UTC_MILLISECONDS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_JSON_BYTES = 2_097_152;
const MAX_JOURNAL_BYTES = 4_194_304;
const AUTHORIZATION_CLAIM_DIGEST_DOMAIN = "p24b-rc6.2-formal-attempt-authorization-claim-v1";
const AUTHORIZATION_KEYS = [
  "schemaVersion",
  "authorizationId",
  "authorizedControlCommit",
  "authorizedProductCommit",
  "authorizedDeploymentId",
  "authorizedAt",
  "maxFormalAttempts",
  "authorizationDigest",
  "attemptId",
  "productionOrigin",
  "claimedAt",
  "claimDigest",
];
const LEASE_KEYS = [
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
];
const TERMINAL_STATES = new Set(["PRECHECK_FAILED", "TERMINAL_PASS", "TERMINAL_FAIL", "TERMINAL_ABORTED"]);
const ATTEMPT_STATES = new Set(FORMAL_ATTEMPT_STATES);

export const TERMINAL_EVIDENCE_FILES = Object.freeze([
  "attempt-authorization.json",
  "attempt-lease-initial.json",
  "attempt-events.jsonl",
  "attempt-lease-terminal.json",
  "runtime-receipt.json",
  "toolchain-receipt.json",
  "wrapper-result.json",
  "runner-result.json",
  "runner-failure.json",
  "browser-result.json",
  "browser-failure.json",
  "network-receipt.json",
  "model-metadata.json",
  "persistence-truth.json",
  "story-bible-truth.json",
  "candidate-lineage.json",
  "approval-receipt.json",
  "profile-cleanup.json",
  "process-cleanup.json",
]);

const FILE_PROJECTION_KEYS = Object.freeze({
  "runtime-receipt.json": "runtimeReceipt",
  "toolchain-receipt.json": "toolchainReceipt",
  "wrapper-result.json": "wrapperResult",
  "runner-result.json": "runnerResult",
  "runner-failure.json": "runnerFailure",
  "browser-result.json": "browserResult",
  "browser-failure.json": "browserFailure",
  "network-receipt.json": "networkReceipt",
  "model-metadata.json": "modelMetadata",
  "persistence-truth.json": "persistenceTruth",
  "story-bible-truth.json": "storyBibleTruth",
  "candidate-lineage.json": "candidateLineage",
  "approval-receipt.json": "approvalReceipt",
  "profile-cleanup.json": "profileCleanup",
  "process-cleanup.json": "processCleanup",
});
const FILE_PROJECTION_SCHEMAS = Object.freeze({
  "wrapper-result.json": "p24b-rc6.2-formal-wrapper-result-v1",
  "runner-result.json": "p24b-rc6.2-formal-runner-result-v1",
  "runner-failure.json": "p24b-rc6.2-formal-runner-failure-v1",
  "browser-result.json": "p24b-rc6.2-formal-browser-result-v1",
  "browser-failure.json": "p24b-rc6.2-formal-browser-failure-v1",
  "network-receipt.json": "p24b-rc6.2-formal-network-receipt-v1",
  "model-metadata.json": "p24b-rc6.2-formal-model-metadata-v1",
  "persistence-truth.json": "p24b-rc6.2-formal-persistence-truth-v1",
  "story-bible-truth.json": "p24b-rc6.2-formal-story-bible-truth-v1",
  "candidate-lineage.json": "p24b-rc6.2-formal-candidate-lineage-v1",
  "approval-receipt.json": "p24b-rc6.2-formal-approval-receipt-v1",
  "profile-cleanup.json": "p24b-rc6.2-formal-profile-cleanup-v1",
  "process-cleanup.json": "p24b-rc6.2-formal-process-cleanup-v1",
});

const FINITE_CODES = new Set([
  "TERMINAL_EVIDENCE_INPUT_INVALID",
  "TERMINAL_EVIDENCE_PATH_INVALID",
  "TERMINAL_EVIDENCE_SOURCE_MISSING",
  "TERMINAL_EVIDENCE_SOURCE_INVALID",
  "TERMINAL_EVIDENCE_AUTHORIZATION_INVALID",
  "TERMINAL_EVIDENCE_LEASE_INVALID",
  "TERMINAL_EVIDENCE_EVENT_CHAIN_INVALID",
  "TERMINAL_EVIDENCE_EVENT_STATE_INVALID",
  "TERMINAL_EVIDENCE_IDENTITY_INVALID",
  "TERMINAL_EVIDENCE_PROJECTION_INVALID",
  "TERMINAL_EVIDENCE_REQUIRED_FILE_MISSING",
  "TERMINAL_EVIDENCE_UNEXPECTED_FILE",
  "TERMINAL_EVIDENCE_DIGEST_MISMATCH",
  "TERMINAL_EVIDENCE_MANIFEST_INVALID",
  "TERMINAL_EVIDENCE_MANIFEST_SHA_INVALID",
  "TERMINAL_EVIDENCE_CREDENTIAL_VALUE_DETECTED",
  "TERMINAL_EVIDENCE_FORMAL_PASS_INVALID",
  "TERMINAL_EVIDENCE_RUNTIME_RECEIPT_INVALID",
  "TERMINAL_EVIDENCE_TOOLCHAIN_RECEIPT_INVALID",
  "TERMINAL_EVIDENCE_BROWSER_TRUTH_INVALID",
  "TERMINAL_EVIDENCE_PERSISTENCE_TRUTH_INVALID",
  "TERMINAL_EVIDENCE_STORY_BIBLE_TRUTH_INVALID",
  "TERMINAL_EVIDENCE_CANDIDATE_APPROVAL_INVALID",
  "TERMINAL_EVIDENCE_CLEANUP_INVALID",
  "TERMINAL_EVIDENCE_FINALIZATION_FAILED",
  "TERMINAL_EVIDENCE_SIMULATION_INVALID",
  "TERMINAL_EVIDENCE_CLI_MODE_INVALID",
]);

export class TerminalEvidenceError extends Error {
  constructor(code, options = {}) {
    const safeCode = FINITE_CODES.has(code) ? code : "TERMINAL_EVIDENCE_INPUT_INVALID";
    super(safeCode, options);
    this.name = "TerminalEvidenceError";
    this.code = safeCode;
  }
}

function reject(code) {
  throw new TerminalEvidenceError(code);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireObject(value, code = "TERMINAL_EVIDENCE_INPUT_INVALID") {
  if (!isPlainObject(value)) reject(code);
  return value;
}

function requireExactKeys(value, keys, code) {
  requireObject(value, code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) reject(code);
}

function requireBoolean(value, code) {
  if (typeof value !== "boolean") reject(code);
}

function requireSha256(value, code) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) reject(code);
}

function requireTimestamp(value, code) {
  const timestamp = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (
    typeof value !== "string"
    || !UTC_MILLISECONDS_PATTERN.test(value)
    || !Number.isFinite(timestamp)
    || new Date(timestamp).toISOString() !== value
  ) reject(code);
  return timestamp;
}

function digestDomain(schemaVersion, body) {
  return sha256Hex(`${schemaVersion}\n${stableStringify(body)}`);
}

function withoutKey(value, key) {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

function strictUtf8(buffer, code) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    reject(code);
  }
}

function parseCanonicalJsonBytes(bytes, code, { allowFinalNewline = true } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_JSON_BYTES) reject(code);
  const raw = strictUtf8(bytes, code);
  if (raw.startsWith("\uFEFF") || raw.includes("\0") || raw.includes("\uFFFD") || raw.includes("\r")) reject(code);
  const source = allowFinalNewline && raw.endsWith("\n") ? raw.slice(0, -1) : raw;
  if (!source || source.includes("\n")) reject(code);
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    reject(code);
  }
  if (stableStringify(parsed) !== source) reject(code);
  return { parsed, canonical: source };
}

function canonicalBytes(value) {
  requireObject(value);
  return Buffer.from(stableStringify(value), "utf8");
}

async function assertRegularFile(path, code) {
  let truth;
  try {
    truth = await lstat(path);
  } catch {
    reject(code);
  }
  if (!truth.isFile() || truth.isSymbolicLink()) reject(code);
  return truth;
}

async function assertDirectory(path, code) {
  let truth;
  try {
    truth = await lstat(path);
  } catch {
    reject(code);
  }
  if (!truth.isDirectory() || truth.isSymbolicLink()) reject(code);
  return truth;
}

function assertAbsoluteSafePath(path) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) reject("TERMINAL_EVIDENCE_PATH_INVALID");
  const normalized = resolve(path);
  if (normalized !== path && normalized.toLowerCase() !== path.toLowerCase()) reject("TERMINAL_EVIDENCE_PATH_INVALID");
  return normalized;
}

function isPathWithin(parent, child) {
  const delta = relative(parent, child);
  return delta !== "" && delta !== ".." && !delta.startsWith(`..${sep}`) && !isAbsolute(delta);
}

async function assertNoReparseResolution(path, code = "TERMINAL_EVIDENCE_PATH_INVALID") {
  let observed;
  try {
    observed = resolve(await realpath(path));
  } catch {
    reject(code);
  }
  const matches = process.platform === "win32"
    ? observed.toLowerCase() === resolve(path).toLowerCase()
    : observed === resolve(path);
  if (!matches) reject(code);
}

async function readCanonicalJsonFile(path, code = "TERMINAL_EVIDENCE_SOURCE_INVALID") {
  await assertRegularFile(path, code);
  const bytes = await readFile(path);
  return { ...parseCanonicalJsonBytes(bytes, code), bytes };
}

async function readCanonicalJournal(path) {
  await assertRegularFile(path, "TERMINAL_EVIDENCE_SOURCE_MISSING");
  const bytes = await readFile(path);
  if (bytes.length === 0 || bytes.length > MAX_JOURNAL_BYTES) reject("TERMINAL_EVIDENCE_EVENT_CHAIN_INVALID");
  const raw = strictUtf8(bytes, "TERMINAL_EVIDENCE_EVENT_CHAIN_INVALID");
  if (raw.startsWith("\uFEFF") || raw.includes("\0") || raw.includes("\uFFFD") || raw.includes("\r")) {
    reject("TERMINAL_EVIDENCE_EVENT_CHAIN_INVALID");
  }
  const lines = raw.endsWith("\n") ? raw.slice(0, -1).split("\n") : raw.split("\n");
  if (lines.length === 0 || lines.some((line) => !line)) reject("TERMINAL_EVIDENCE_EVENT_CHAIN_INVALID");
  const events = lines.map((line) => {
    const parsed = parseCanonicalJsonBytes(Buffer.from(line, "utf8"), "TERMINAL_EVIDENCE_EVENT_CHAIN_INVALID", {
      allowFinalNewline: false,
    }).parsed;
    return parsed;
  });
  return { events, canonical: `${lines.join("\n")}\n`, bytes };
}

function validateIdentity(value, expectedControlCommit = null) {
  if (value.productCommit !== RC6_2_PRODUCT_COMMIT) reject("TERMINAL_EVIDENCE_IDENTITY_INVALID");
  if (
    typeof value.controlCommit !== "string"
    || !COMMIT_PATTERN.test(value.controlCommit)
    || value.controlCommit === RC6_2_PRODUCT_COMMIT
    || (expectedControlCommit !== null && value.controlCommit !== expectedControlCommit)
    || value.deploymentId !== RC6_2_DEPLOYMENT_ID
    || value.productionOrigin !== RC6_2_PRODUCTION_ORIGIN
  ) reject("TERMINAL_EVIDENCE_IDENTITY_INVALID");
}

function requireExpectedControlCommit(value) {
  if (typeof value !== "string" || !COMMIT_PATTERN.test(value) || value === RC6_2_PRODUCT_COMMIT) {
    reject("TERMINAL_EVIDENCE_IDENTITY_INVALID");
  }
  return value;
}

function validateAuthorization(authorization, expectedControlCommit = null) {
  requireExactKeys(authorization, AUTHORIZATION_KEYS, "TERMINAL_EVIDENCE_AUTHORIZATION_INVALID");
  if (
    authorization.schemaVersion !== AUTHORIZATION_SCHEMA
    || typeof authorization.authorizationId !== "string"
    || !AUTHORIZATION_ID_PATTERN.test(authorization.authorizationId)
    || authorization.maxFormalAttempts !== 1
    || authorization.authorizedProductCommit !== RC6_2_PRODUCT_COMMIT
    || !COMMIT_PATTERN.test(authorization.authorizedControlCommit)
    || authorization.authorizedControlCommit === RC6_2_PRODUCT_COMMIT
    || (expectedControlCommit !== null && authorization.authorizedControlCommit !== expectedControlCommit)
    || authorization.authorizedDeploymentId !== RC6_2_DEPLOYMENT_ID
    || typeof authorization.attemptId !== "string"
    || !ATTEMPT_ID_PATTERN.test(authorization.attemptId)
    || authorization.productionOrigin !== RC6_2_PRODUCTION_ORIGIN
  ) reject("TERMINAL_EVIDENCE_AUTHORIZATION_INVALID");
  requireTimestamp(authorization.authorizedAt, "TERMINAL_EVIDENCE_AUTHORIZATION_INVALID");
  requireTimestamp(authorization.claimedAt, "TERMINAL_EVIDENCE_AUTHORIZATION_INVALID");
  requireSha256(authorization.authorizationDigest, "TERMINAL_EVIDENCE_AUTHORIZATION_INVALID");
  requireSha256(authorization.claimDigest, "TERMINAL_EVIDENCE_AUTHORIZATION_INVALID");
  const expectedDigest = computeFormalAttemptAuthorizationDigest({
    schemaVersion: authorization.schemaVersion,
    authorizationId: authorization.authorizationId,
    authorizedControlCommit: authorization.authorizedControlCommit,
    authorizedProductCommit: authorization.authorizedProductCommit,
    authorizedDeploymentId: authorization.authorizedDeploymentId,
    authorizedAt: authorization.authorizedAt,
    maxFormalAttempts: authorization.maxFormalAttempts,
  });
  if (authorization.authorizationDigest !== expectedDigest) reject("TERMINAL_EVIDENCE_AUTHORIZATION_INVALID");
  const expectedClaimDigest = digestDomain(
    AUTHORIZATION_CLAIM_DIGEST_DOMAIN,
    withoutKey(authorization, "claimDigest"),
  );
  if (authorization.claimDigest !== expectedClaimDigest) reject("TERMINAL_EVIDENCE_AUTHORIZATION_INVALID");
  return authorization;
}

function validateLeaseShape(lease, expectedControlCommit = null) {
  requireExactKeys(lease, LEASE_KEYS, "TERMINAL_EVIDENCE_LEASE_INVALID");
  if (
    lease.schemaVersion !== LEASE_SCHEMA
    || typeof lease.attemptId !== "string"
    || !ATTEMPT_ID_PATTERN.test(lease.attemptId)
    || typeof lease.authorizationId !== "string"
    || !AUTHORIZATION_ID_PATTERN.test(lease.authorizationId)
    || !ATTEMPT_STATES.has(lease.state)
    || !Number.isSafeInteger(lease.revision)
    || lease.revision < 1
    || !Number.isSafeInteger(lease.lastEventSequence)
    || lease.lastEventSequence < 1
  ) reject("TERMINAL_EVIDENCE_LEASE_INVALID");
  validateIdentity(lease, expectedControlCommit);
  if (lease.releaseTag !== RC6_2_RELEASE_TAG || lease.releaseRevision !== RC6_2_RELEASE_REVISION) {
    reject("TERMINAL_EVIDENCE_IDENTITY_INVALID");
  }
  requireSha256(lease.authorizationDigest, "TERMINAL_EVIDENCE_LEASE_INVALID");
  if (lease.runtimeReceiptDigest !== null) requireSha256(lease.runtimeReceiptDigest, "TERMINAL_EVIDENCE_LEASE_INVALID");
  for (const field of ["wrapperDigest", "runnerDigest", "contractDigest", "lastEventDigest", "leaseDigest"]) {
    requireSha256(lease[field], "TERMINAL_EVIDENCE_LEASE_INVALID");
  }
  requireTimestamp(lease.createdAt, "TERMINAL_EVIDENCE_LEASE_INVALID");
  requireTimestamp(lease.updatedAt, "TERMINAL_EVIDENCE_LEASE_INVALID");
  for (const field of ["attemptConsumed", "runnerStarted", "browserStarted", "runnerCompleted", "cleanupCompleted"]) {
    requireBoolean(lease[field], "TERMINAL_EVIDENCE_LEASE_INVALID");
  }
  if (![null, "PASS", "FAIL"].includes(lease.runnerOutcome)) reject("TERMINAL_EVIDENCE_LEASE_INVALID");
  if (![null, "PASS", "FAIL", "ABORTED"].includes(lease.terminalStatus)) {
    reject("TERMINAL_EVIDENCE_LEASE_INVALID");
  }
  const expectedDigest = computeFormalAttemptLeaseDigest(withoutKey(lease, "leaseDigest"));
  if (lease.leaseDigest !== expectedDigest) reject("TERMINAL_EVIDENCE_LEASE_INVALID");
  return lease;
}

function validateAttemptDocuments(
  { authorization, initialLease, terminalLease, events, stateVerification },
  expectedControlCommit = null,
) {
  validateAuthorization(authorization, expectedControlCommit);
  validateLeaseShape(initialLease, expectedControlCommit);
  validateLeaseShape(terminalLease, expectedControlCommit);
  const attemptId = initialLease.attemptId;
  if (
    terminalLease.attemptId !== attemptId
    || authorization.attemptId !== attemptId
    || initialLease.authorizationId !== authorization.authorizationId
    || terminalLease.authorizationId !== authorization.authorizationId
    || initialLease.authorizationDigest !== authorization.authorizationDigest
    || terminalLease.authorizationDigest !== authorization.authorizationDigest
    || authorization.authorizedControlCommit !== initialLease.controlCommit
    || authorization.authorizedProductCommit !== initialLease.productCommit
    || authorization.authorizedDeploymentId !== initialLease.deploymentId
    || authorization.productionOrigin !== initialLease.productionOrigin
    || authorization.claimedAt !== initialLease.createdAt
    || initialLease.productCommit !== terminalLease.productCommit
    || initialLease.controlCommit !== terminalLease.controlCommit
    || initialLease.deploymentId !== terminalLease.deploymentId
    || initialLease.productionOrigin !== terminalLease.productionOrigin
    || initialLease.releaseTag !== terminalLease.releaseTag
    || initialLease.releaseRevision !== terminalLease.releaseRevision
    || initialLease.wrapperDigest !== terminalLease.wrapperDigest
    || initialLease.runnerDigest !== terminalLease.runnerDigest
    || initialLease.contractDigest !== terminalLease.contractDigest
  ) reject("TERMINAL_EVIDENCE_AUTHORIZATION_INVALID");
  if (
    initialLease.state !== "PREPARED"
    || initialLease.attemptConsumed !== false
    || initialLease.runnerStarted !== false
    || initialLease.browserStarted !== false
    || initialLease.runnerCompleted !== false
    || initialLease.runnerOutcome !== null
    || initialLease.cleanupCompleted !== false
    || initialLease.terminalStatus !== null
    || initialLease.runtimeReceiptDigest !== null
    || initialLease.revision !== 1
  ) reject("TERMINAL_EVIDENCE_LEASE_INVALID");
  if (!TERMINAL_STATES.has(terminalLease.state)) reject("TERMINAL_EVIDENCE_LEASE_INVALID");
  if (
    (terminalLease.state === "TERMINAL_PASS" && terminalLease.cleanupCompleted !== true)
    || (terminalLease.state === "PRECHECK_FAILED" && terminalLease.cleanupCompleted !== false)
  ) reject("TERMINAL_EVIDENCE_LEASE_INVALID");
  if (terminalLease.state !== "PRECHECK_FAILED") {
    requireSha256(terminalLease.runtimeReceiptDigest, "TERMINAL_EVIDENCE_LEASE_INVALID");
  }
  if (terminalLease.createdAt !== initialLease.createdAt || terminalLease.revision < initialLease.revision) {
    reject("TERMINAL_EVIDENCE_LEASE_INVALID");
  }
  if (
    !stateVerification?.valid
    || stableStringify(stateVerification.events) !== stableStringify(events)
    || stableStringify(stateVerification.lease) !== stableStringify(terminalLease)
  ) reject("TERMINAL_EVIDENCE_LEASE_INVALID");
  return attemptId;
}

function requiredForState(path, lease) {
  if (new Set([
    "attempt-authorization.json",
    "attempt-lease-initial.json",
    "attempt-events.jsonl",
    "attempt-lease-terminal.json",
    "wrapper-result.json",
  ]).has(path)) return true;
  if (
    lease.state === "PRECHECK_FAILED"
    && new Set(["runtime-receipt.json", "toolchain-receipt.json"]).has(path)
  ) return lease.runtimeReceiptDigest !== null;
  if (lease.state === "PRECHECK_FAILED") return false;
  if (new Set(["runtime-receipt.json", "toolchain-receipt.json", "process-cleanup.json"]).has(path)) return true;
  if (path === "profile-cleanup.json") return lease.attemptConsumed;
  // Runner evidence describes the durable RUNNER_COMPLETED truth, not the
  // later wrapper/terminal outcome. A runner PASS can truthfully precede a
  // terminal FAIL/ABORTED when cleanup or an outer proof/CAS step fails.
  if (path === "runner-result.json") return lease.runnerOutcome === "PASS";
  if (path === "runner-failure.json") return lease.runnerOutcome !== "PASS";
  if (path === "browser-result.json") return lease.state === "TERMINAL_PASS";
  if (path === "browser-failure.json") return lease.state === "TERMINAL_FAIL" && lease.runnerStarted;
  if (new Set([
    "network-receipt.json",
    "model-metadata.json",
    "persistence-truth.json",
    "story-bible-truth.json",
    "candidate-lineage.json",
    "approval-receipt.json",
  ]).has(path)) return lease.state === "TERMINAL_PASS";
  return false;
}

function notReachedReason(path, lease) {
  if (path === "runner-failure.json" && lease.runnerOutcome === "PASS") {
    return "RUNNER_PASS_NO_FAILURE_ARTIFACT";
  }
  if (path.endsWith("-failure.json") && lease.state === "TERMINAL_PASS") return "SUCCESS_PATH_NO_FAILURE_ARTIFACT";
  if (
    lease.state === "PRECHECK_FAILED"
    && new Set(["runtime-receipt.json", "toolchain-receipt.json"]).has(path)
    && lease.runtimeReceiptDigest === null
  ) return "PREFLIGHT_RECEIPT_NOT_REACHED";
  if (lease.state === "PRECHECK_FAILED") return "LAUNCH_NOT_REACHED";
  if (!lease.runnerStarted && path.startsWith("runner-")) return "RUNNER_NOT_REACHED";
  if (!lease.browserStarted && path.startsWith("browser-")) return "BROWSER_NOT_REACHED";
  if (!lease.browserStarted && new Set([
    "network-receipt.json",
    "model-metadata.json",
    "persistence-truth.json",
    "story-bible-truth.json",
    "candidate-lineage.json",
    "approval-receipt.json",
  ]).has(path)) return "BROWSER_STAGE_NOT_REACHED";
  if (!lease.attemptConsumed && path === "profile-cleanup.json") return "LAUNCH_NOT_REACHED";
  if (lease.state !== "TERMINAL_PASS") return "FORMAL_SUCCESS_STAGE_NOT_REACHED";
  return "NOT_APPLICABLE";
}

async function writeCreateNewAtomic(path, bytes) {
  const parent = dirname(path);
  await assertDirectory(parent, "TERMINAL_EVIDENCE_PATH_INVALID");
  const temporaryPath = join(parent, `.terminal-${randomBytes(16).toString("hex")}.tmp`);
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    const temporaryBytes = await readFile(temporaryPath);
    if (!temporaryBytes.equals(bytes)) reject("TERMINAL_EVIDENCE_DIGEST_MISMATCH");
    await link(temporaryPath, path);
    const published = await readFile(path);
    if (!published.equals(bytes)) reject("TERMINAL_EVIDENCE_DIGEST_MISMATCH");
  } catch (error) {
    if (error instanceof TerminalEvidenceError) throw error;
    reject("TERMINAL_EVIDENCE_PATH_INVALID");
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

function scanForCredentialValues(entries, credentialEnvironment = process.env) {
  const credentials = collectCredentialValues({ env: credentialEnvironment, envFiles: [] });
  let hitCount = 0;
  for (const [path, bytes] of entries) {
    hitCount += scanCredentialBytes(bytes, { ...credentials, sourcePath: path }).length;
  }
  return hitCount;
}

function credentialEnvironmentWithProcessTruth(extraEnvironment) {
  if (extraEnvironment === undefined || extraEnvironment === process.env) return process.env;
  requireObject(extraEnvironment, "TERMINAL_EVIDENCE_INPUT_INVALID");
  const merged = { ...process.env };
  let index = 0;
  for (const value of Object.values(extraEnvironment)) {
    if (typeof value !== "string") reject("TERMINAL_EVIDENCE_INPUT_INVALID");
    merged[`RC6_2_TERMINAL_EXTRA_CREDENTIAL_${index}`] = value;
    index += 1;
  }
  return merged;
}

function manifestDigest(bodyWithoutDigest) {
  return digestDomain(TERMINAL_MANIFEST_SCHEMA, bodyWithoutDigest);
}

function safeResult(manifest, manifestFileSha256) {
  return {
    schemaVersion: "p24b-rc6.2-terminal-evidence-safe-result-v1",
    status: "PASS",
    attemptIdFingerprint: sha256Hex(manifest.attemptId).slice(0, 16),
    attemptState: manifest.attemptState,
    terminalStatus: manifest.terminalStatus,
    manifestBodyDigest: manifest.manifestBodyDigest,
    manifestFileSha256,
    containsCredentialValues: manifest.containsCredentialValues,
  };
}

function verifyStateAuthority(attemptDirectory, expectedControlCommit) {
  try {
    return verifyAttemptJournal({
      attemptDirectory,
      ...(expectedControlCommit === null ? {} : { expectedControlCommit }),
      expectedProductCommit: RC6_2_PRODUCT_COMMIT,
      expectedDeploymentId: RC6_2_DEPLOYMENT_ID,
      expectedProductionOrigin: RC6_2_PRODUCTION_ORIGIN,
    });
  } catch (error) {
    if (!(error instanceof FormalAttemptError)) throw error;
    if (error.code.startsWith("AUTHORIZATION_")) reject("TERMINAL_EVIDENCE_AUTHORIZATION_INVALID");
    if (new Set(["IDENTITY_MISMATCH", "ATTEMPT_ID_MISMATCH", "ATTEMPT_ID_INVALID"]).has(error.code)) {
      reject("TERMINAL_EVIDENCE_IDENTITY_INVALID");
    }
    if (error.code.startsWith("LEASE_")) reject("TERMINAL_EVIDENCE_LEASE_INVALID");
    if (new Set(["TRANSITION_INVALID", "STATE_MISMATCH", "EVENT_BODY_INVALID"]).has(error.code)) {
      reject("TERMINAL_EVIDENCE_EVENT_STATE_INVALID");
    }
    reject("TERMINAL_EVIDENCE_EVENT_CHAIN_INVALID");
  }
}

async function readAttemptDocuments(attemptDirectory, expectedControlCommit) {
  await assertDirectory(attemptDirectory, "TERMINAL_EVIDENCE_SOURCE_MISSING");
  const authorization = await readCanonicalJsonFile(
    join(attemptDirectory, "attempt-authorization.json"),
    "TERMINAL_EVIDENCE_SOURCE_MISSING",
  );
  const initialLease = await readCanonicalJsonFile(
    join(attemptDirectory, "attempt-lease-initial.json"),
    "TERMINAL_EVIDENCE_SOURCE_MISSING",
  );
  const terminalLease = await readCanonicalJsonFile(
    join(attemptDirectory, "attempt-lease.json"),
    "TERMINAL_EVIDENCE_SOURCE_MISSING",
  );
  const journal = await readCanonicalJournal(join(attemptDirectory, "attempt-events.jsonl"));
  const stateVerification = verifyStateAuthority(attemptDirectory, expectedControlCommit);
  if (
    stableStringify(stateVerification.events) !== stableStringify(journal.events)
    || stableStringify(stateVerification.lease) !== stableStringify(terminalLease.parsed)
  ) reject("TERMINAL_EVIDENCE_LEASE_INVALID");
  validateAttemptDocuments({
    authorization: authorization.parsed,
    initialLease: initialLease.parsed,
    terminalLease: terminalLease.parsed,
    events: journal.events,
    stateVerification,
  }, expectedControlCommit);
  return { authorization, initialLease, terminalLease, journal };
}

function normalizeProjection(value, path) {
  if (value === undefined || value === null) return null;
  if (Buffer.isBuffer(value)) return parseCanonicalJsonBytes(value, "TERMINAL_EVIDENCE_PROJECTION_INVALID").parsed;
  if (typeof value === "string") {
    return parseCanonicalJsonBytes(Buffer.from(value, "utf8"), "TERMINAL_EVIDENCE_PROJECTION_INVALID").parsed;
  }
  if (!isPlainObject(value)) reject("TERMINAL_EVIDENCE_PROJECTION_INVALID");
  const clone = structuredClone(value);
  if (
    typeof clone.schemaVersion !== "string"
    || (FILE_PROJECTION_SCHEMAS[path] && clone.schemaVersion !== FILE_PROJECTION_SCHEMAS[path])
  ) reject("TERMINAL_EVIDENCE_PROJECTION_INVALID");
  if (!new Set(["runtime-receipt.json", "toolchain-receipt.json"]).has(path) && !clone.attemptId) {
    reject("TERMINAL_EVIDENCE_PROJECTION_INVALID");
  }
  if (typeof path !== "string") reject("TERMINAL_EVIDENCE_PROJECTION_INVALID");
  return clone;
}

function validateEvidenceEventBindings(events, evidenceBytes, terminalLease) {
  const runnerEvents = events.filter(({ eventType }) => eventType === "RUNNER_COMPLETED");
  const cleanupEvents = events.filter(({ eventType }) => eventType === "CLEANUP_COMPLETED");
  if (runnerEvents.length !== (terminalLease.runnerCompleted ? 1 : 0)) {
    reject("TERMINAL_EVIDENCE_EVENT_STATE_INVALID");
  }
  if (cleanupEvents.length !== (terminalLease.cleanupCompleted ? 1 : 0)) {
    reject("TERMINAL_EVIDENCE_EVENT_STATE_INVALID");
  }
  if (runnerEvents.length === 1) {
    const event = runnerEvents[0];
    if (event.eventBody.outcome !== terminalLease.runnerOutcome) {
      reject("TERMINAL_EVIDENCE_EVENT_STATE_INVALID");
    }
    const path = event.eventBody.outcome === "PASS" ? "runner-result.json" : "runner-failure.json";
    const bytes = evidenceBytes.get(path);
    if (!bytes || sha256Hex(bytes) !== event.eventBody.runnerEvidenceDigest) {
      reject("TERMINAL_EVIDENCE_PROJECTION_INVALID");
    }
    const projection = parseCanonicalJsonBytes(bytes, "TERMINAL_EVIDENCE_PROJECTION_INVALID").parsed;
    if (
      projection.exitCode !== event.eventBody.exitCode
      || (event.eventBody.outcome === "PASS" && projection.status !== "PASS")
      || (event.eventBody.outcome === "FAIL" && !new Set(["FAIL", "ABORTED"]).has(projection.status))
    ) reject("TERMINAL_EVIDENCE_PROJECTION_INVALID");
  }
  if (cleanupEvents.length === 1) {
    const event = cleanupEvents[0];
    const profileBytes = evidenceBytes.get("profile-cleanup.json");
    const processBytes = evidenceBytes.get("process-cleanup.json");
    if (
      !profileBytes
      || !processBytes
      || sha256Hex(profileBytes) !== event.eventBody.profileCleanupDigest
      || sha256Hex(processBytes) !== event.eventBody.processCleanupDigest
    ) reject("TERMINAL_EVIDENCE_CLEANUP_INVALID");
  }
}

export function computeTerminalEvidenceProjectionBindings(input = {}) {
  requireObject(input, "TERMINAL_EVIDENCE_PROJECTION_INVALID");
  const allowedKeys = new Set(["runnerResult", "runnerFailure", "profileCleanup", "processCleanup"]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    reject("TERMINAL_EVIDENCE_PROJECTION_INVALID");
  }
  const runnerResult = normalizeProjection(input.runnerResult, "runner-result.json");
  const runnerFailure = normalizeProjection(input.runnerFailure, "runner-failure.json");
  const profileCleanup = normalizeProjection(input.profileCleanup, "profile-cleanup.json");
  const processCleanup = normalizeProjection(input.processCleanup, "process-cleanup.json");
  if ((runnerResult && runnerFailure) || Boolean(profileCleanup) !== Boolean(processCleanup)) {
    reject("TERMINAL_EVIDENCE_PROJECTION_INVALID");
  }
  const runner = runnerResult ?? runnerFailure;
  const attemptIds = new Set(
    [runnerResult, runnerFailure, profileCleanup, processCleanup].filter(Boolean).map(({ attemptId }) => attemptId),
  );
  if (attemptIds.size > 1) reject("TERMINAL_EVIDENCE_PROJECTION_INVALID");
  if (
    (runnerResult && runnerResult.status !== "PASS")
    || (runnerFailure && !new Set(["FAIL", "ABORTED"]).has(runnerFailure.status))
  ) reject("TERMINAL_EVIDENCE_PROJECTION_INVALID");
  if (
    runner
    && (
      !Number.isSafeInteger(runner.exitCode)
      || runner.exitCode < -2_147_483_648
      || runner.exitCode > 4_294_967_295
    )
  ) reject("TERMINAL_EVIDENCE_PROJECTION_INVALID");
  return {
    schemaVersion: "p24b-rc6.2-terminal-evidence-projection-bindings-v1",
    runnerOutcome: runnerResult ? "PASS" : runnerFailure ? "FAIL" : null,
    exitCode: runner?.exitCode ?? null,
    runnerEvidenceDigest: runner ? sha256Hex(canonicalBytes(runner)) : null,
    profileCleanupDigest: profileCleanup ? sha256Hex(canonicalBytes(profileCleanup)) : null,
    processCleanupDigest: processCleanup ? sha256Hex(canonicalBytes(processCleanup)) : null,
  };
}

async function writeEmergencySidecar(bundleDirectory, causeCode, attemptId = null) {
  try {
    await assertDirectory(bundleDirectory, "TERMINAL_EVIDENCE_PATH_INVALID");
    const emergency = {
      schemaVersion: "p24b-rc6.2-terminal-evidence-emergency-v1",
      status: "FAIL",
      safeErrorCode: "TERMINAL_EVIDENCE_FINALIZATION_FAILED",
      causeCode: SAFE_CODE_PATTERN.test(causeCode) ? causeCode : "TERMINAL_EVIDENCE_INPUT_INVALID",
      attemptIdFingerprint: typeof attemptId === "string" ? sha256Hex(attemptId).slice(0, 16) : null,
      rawCredentialValuesStored: false,
    };
    await writeCreateNewAtomic(join(bundleDirectory, TERMINAL_EMERGENCY_FILE), canonicalBytes(emergency));
  } catch {
    // The finite CLI error remains the authoritative emergency signal.
  }
}

async function finalizeCore(input, context) {
  requireObject(input);
  const expectedControlCommit = requireExpectedControlCommit(input.expectedControlCommit);
  const attemptDirectory = assertAbsoluteSafePath(input.attemptDirectory);
  const bundleDirectory = assertAbsoluteSafePath(input.bundleDirectory);
  const expectedBundleDirectory = join(attemptDirectory, "terminal-evidence");
  if (
    (process.platform === "win32"
      ? bundleDirectory.toLowerCase() !== expectedBundleDirectory.toLowerCase()
      : bundleDirectory !== expectedBundleDirectory)
    || !isPathWithin(attemptDirectory, bundleDirectory)
  ) {
    reject("TERMINAL_EVIDENCE_PATH_INVALID");
  }
  await assertDirectory(attemptDirectory, "TERMINAL_EVIDENCE_PATH_INVALID");
  await assertNoReparseResolution(attemptDirectory);
  try {
    await mkdir(bundleDirectory, { recursive: false, mode: 0o700 });
  } catch {
    reject("TERMINAL_EVIDENCE_PATH_INVALID");
  }
  context.bundleCreated = true;
  await assertDirectory(bundleDirectory, "TERMINAL_EVIDENCE_PATH_INVALID");
  await assertNoReparseResolution(bundleDirectory);
  const documents = await readAttemptDocuments(attemptDirectory, expectedControlCommit);
  const terminalLease = documents.terminalLease.parsed;
  const attemptId = terminalLease.attemptId;
  context.attemptId = attemptId;
  const startedAt = input.startedAt ?? documents.initialLease.parsed.createdAt;
  const completedAt = input.completedAt ?? terminalLease.updatedAt;
  const startedTimestamp = requireTimestamp(startedAt, "TERMINAL_EVIDENCE_INPUT_INVALID");
  const completedTimestamp = requireTimestamp(completedAt, "TERMINAL_EVIDENCE_INPUT_INVALID");
  if (
    completedTimestamp < startedTimestamp
    || completedTimestamp < Date.parse(terminalLease.updatedAt)
  ) reject("TERMINAL_EVIDENCE_INPUT_INVALID");

  const sourceEntries = new Map([
    ["attempt-authorization.json", documents.authorization.bytes],
    ["attempt-lease-initial.json", documents.initialLease.bytes],
    ["attempt-events.jsonl", documents.journal.bytes],
    ["attempt-lease-terminal.json", documents.terminalLease.bytes],
  ]);
  for (const [path, key] of Object.entries(FILE_PROJECTION_KEYS)) {
    const projection = normalizeProjection(input[key], path);
    if (projection) {
      if (
        !new Set(["runtime-receipt.json", "toolchain-receipt.json"]).has(path)
        && projection.attemptId !== attemptId
      ) reject("TERMINAL_EVIDENCE_PROJECTION_INVALID");
      sourceEntries.set(path, canonicalBytes(projection));
    }
  }
  if (sourceEntries.has("runner-result.json") && sourceEntries.has("runner-failure.json")) {
    reject("TERMINAL_EVIDENCE_PROJECTION_INVALID");
  }
  if (sourceEntries.has("browser-result.json") && sourceEntries.has("browser-failure.json")) {
    reject("TERMINAL_EVIDENCE_PROJECTION_INVALID");
  }
  const credentialEnvironment = credentialEnvironmentWithProcessTruth(input.credentialEnvironment);
  const credentialHits = scanForCredentialValues([...sourceEntries], credentialEnvironment);
  if (credentialHits !== 0) reject("TERMINAL_EVIDENCE_CREDENTIAL_VALUE_DETECTED");
  validateEvidenceEventBindings(documents.journal.events, sourceEntries, terminalLease);

  const records = [];
  const missingRequiredFiles = [];
  for (const path of TERMINAL_EVIDENCE_FILES) {
    const bytes = sourceEntries.get(path) ?? null;
    const required = requiredForState(path, terminalLease);
    if (required && bytes === null) missingRequiredFiles.push(path);
    records.push(bytes === null ? {
      path,
      bytes: null,
      sha256: null,
      requiredForState: required,
      present: false,
      status: "NOT_REACHED",
      notReached: true,
      reasonCode: notReachedReason(path, terminalLease),
    } : {
      path,
      bytes: bytes.length,
      sha256: sha256Hex(bytes),
      requiredForState: required,
      present: true,
      status: "PRESENT",
      notReached: false,
      reasonCode: null,
    });
  }
  if (missingRequiredFiles.length !== 0) reject("TERMINAL_EVIDENCE_REQUIRED_FILE_MISSING");

  for (const [path, bytes] of sourceEntries) {
    await writeCreateNewAtomic(join(bundleDirectory, path), bytes);
  }
  if (input.faultInjection === "before-manifest" && process.env.RC6_2_TERMINAL_EVIDENCE_TEST_MODE === "1") {
    reject("TERMINAL_EVIDENCE_PATH_INVALID");
  }
  const manifestBody = {
    schemaVersion: TERMINAL_MANIFEST_SCHEMA,
    attemptId,
    productCommit: terminalLease.productCommit,
    controlCommit: terminalLease.controlCommit,
    deploymentId: terminalLease.deploymentId,
    productionOrigin: terminalLease.productionOrigin,
    attemptState: terminalLease.state,
    attemptConsumed: terminalLease.attemptConsumed,
    runnerStarted: terminalLease.runnerStarted,
    browserStarted: terminalLease.browserStarted,
    terminalStatus: terminalLease.terminalStatus,
    startedAt,
    completedAt,
    files: records,
    missingRequiredFiles,
    unexpectedFiles: [],
    digestMismatches: [],
    containsCredentialValues: false,
  };
  const manifest = { ...manifestBody, manifestBodyDigest: manifestDigest(manifestBody) };
  const manifestBytes = canonicalBytes(manifest);
  if (scanForCredentialValues([[TERMINAL_MANIFEST_FILE, manifestBytes]], credentialEnvironment) !== 0) {
    reject("TERMINAL_EVIDENCE_CREDENTIAL_VALUE_DETECTED");
  }
  await writeCreateNewAtomic(join(bundleDirectory, TERMINAL_MANIFEST_FILE), manifestBytes);
  const manifestFileSha256 = sha256Hex(manifestBytes);
  await writeCreateNewAtomic(
    join(bundleDirectory, TERMINAL_MANIFEST_SHA_FILE),
    Buffer.from(`${manifestFileSha256}\n`, "ascii"),
  );
  return { manifest, manifestFileSha256, safeResult: safeResult(manifest, manifestFileSha256) };
}

export async function finalizeFormalProductionBrowserTerminalEvidence(input) {
  let bundleDirectory = null;
  const context = { bundleCreated: false, attemptId: null };
  try {
    bundleDirectory = assertAbsoluteSafePath(input?.bundleDirectory);
    const result = await finalizeCore(input, context);
    return result;
  } catch (error) {
    const causeCode = error instanceof TerminalEvidenceError ? error.code : "TERMINAL_EVIDENCE_INPUT_INVALID";
    if (bundleDirectory && context.bundleCreated) {
      await writeEmergencySidecar(bundleDirectory, causeCode, context.attemptId);
    }
    const terminalError = new TerminalEvidenceError("TERMINAL_EVIDENCE_FINALIZATION_FAILED");
    terminalError.causeCode = causeCode;
    throw terminalError;
  }
}

function validateManifestShape(manifest, expectedControlCommit) {
  requireExactKeys(manifest, [
    "schemaVersion",
    "attemptId",
    "productCommit",
    "controlCommit",
    "deploymentId",
    "productionOrigin",
    "attemptState",
    "attemptConsumed",
    "runnerStarted",
    "browserStarted",
    "terminalStatus",
    "startedAt",
    "completedAt",
    "files",
    "missingRequiredFiles",
    "unexpectedFiles",
    "digestMismatches",
    "containsCredentialValues",
    "manifestBodyDigest",
  ], "TERMINAL_EVIDENCE_MANIFEST_INVALID");
  if (
    manifest.schemaVersion !== TERMINAL_MANIFEST_SCHEMA
    || !ATTEMPT_ID_PATTERN.test(manifest.attemptId)
    || !TERMINAL_STATES.has(manifest.attemptState)
    || !Array.isArray(manifest.files)
    || manifest.files.length !== TERMINAL_EVIDENCE_FILES.length
  ) reject("TERMINAL_EVIDENCE_MANIFEST_INVALID");
  validateIdentity(manifest, expectedControlCommit);
  requireTimestamp(manifest.startedAt, "TERMINAL_EVIDENCE_MANIFEST_INVALID");
  requireTimestamp(manifest.completedAt, "TERMINAL_EVIDENCE_MANIFEST_INVALID");
  if (Date.parse(manifest.completedAt) < Date.parse(manifest.startedAt)) reject("TERMINAL_EVIDENCE_MANIFEST_INVALID");
  for (const field of ["attemptConsumed", "runnerStarted", "browserStarted", "containsCredentialValues"]) {
    requireBoolean(manifest[field], "TERMINAL_EVIDENCE_MANIFEST_INVALID");
  }
  for (const field of ["missingRequiredFiles", "unexpectedFiles", "digestMismatches"]) {
    if (!Array.isArray(manifest[field]) || manifest[field].some((item) => typeof item !== "string")) {
      reject("TERMINAL_EVIDENCE_MANIFEST_INVALID");
    }
  }
  requireSha256(manifest.manifestBodyDigest, "TERMINAL_EVIDENCE_MANIFEST_INVALID");
  if (manifest.manifestBodyDigest !== manifestDigest(withoutKey(manifest, "manifestBodyDigest"))) {
    reject("TERMINAL_EVIDENCE_MANIFEST_INVALID");
  }
  const observedPaths = new Set();
  for (let index = 0; index < manifest.files.length; index += 1) {
    const record = manifest.files[index];
    requireExactKeys(record, [
      "path", "bytes", "sha256", "requiredForState", "present", "status", "notReached", "reasonCode",
    ], "TERMINAL_EVIDENCE_MANIFEST_INVALID");
    if (record.path !== TERMINAL_EVIDENCE_FILES[index] || observedPaths.has(record.path)) {
      reject("TERMINAL_EVIDENCE_MANIFEST_INVALID");
    }
    observedPaths.add(record.path);
    requireBoolean(record.requiredForState, "TERMINAL_EVIDENCE_MANIFEST_INVALID");
    requireBoolean(record.present, "TERMINAL_EVIDENCE_MANIFEST_INVALID");
    requireBoolean(record.notReached, "TERMINAL_EVIDENCE_MANIFEST_INVALID");
    if (record.present) {
      if (
        record.status !== "PRESENT"
        || record.notReached !== false
        || record.reasonCode !== null
        || !Number.isSafeInteger(record.bytes)
        || record.bytes < 1
      ) reject("TERMINAL_EVIDENCE_MANIFEST_INVALID");
      requireSha256(record.sha256, "TERMINAL_EVIDENCE_MANIFEST_INVALID");
    } else if (
      record.status !== "NOT_REACHED"
      || record.notReached !== true
      || typeof record.reasonCode !== "string"
      || !SAFE_CODE_PATTERN.test(record.reasonCode)
      || record.bytes !== null
      || record.sha256 !== null
      || record.requiredForState
    ) reject("TERMINAL_EVIDENCE_MANIFEST_INVALID");
  }
}

async function loadAndValidateBundle(bundleDirectory, expectedControlCommit = null, credentialEnvironment = process.env) {
  const effectiveCredentialEnvironment = credentialEnvironmentWithProcessTruth(credentialEnvironment);
  const root = assertAbsoluteSafePath(bundleDirectory);
  const attemptDirectory = dirname(root);
  const expectedRoot = join(attemptDirectory, "terminal-evidence");
  if (
    (process.platform === "win32" ? root.toLowerCase() !== expectedRoot.toLowerCase() : root !== expectedRoot)
    || basename(root) !== "terminal-evidence"
  ) reject("TERMINAL_EVIDENCE_PATH_INVALID");
  await assertDirectory(attemptDirectory, "TERMINAL_EVIDENCE_PATH_INVALID");
  await assertNoReparseResolution(attemptDirectory);
  await assertDirectory(root, "TERMINAL_EVIDENCE_PATH_INVALID");
  await assertNoReparseResolution(root);
  const manifestSource = await readCanonicalJsonFile(
    join(root, TERMINAL_MANIFEST_FILE),
    "TERMINAL_EVIDENCE_MANIFEST_INVALID",
  );
  const manifest = manifestSource.parsed;
  validateManifestShape(manifest, expectedControlCommit);
  const sidecarPath = join(root, TERMINAL_MANIFEST_SHA_FILE);
  await assertRegularFile(sidecarPath, "TERMINAL_EVIDENCE_MANIFEST_SHA_INVALID");
  const sidecarBytes = await readFile(sidecarPath);
  const sidecarText = strictUtf8(sidecarBytes, "TERMINAL_EVIDENCE_MANIFEST_SHA_INVALID");
  const manifestFileSha256 = sha256Hex(manifestSource.bytes);
  if (sidecarText !== `${manifestFileSha256}\n`) reject("TERMINAL_EVIDENCE_MANIFEST_SHA_INVALID");

  const expectedPresent = new Set([
    TERMINAL_MANIFEST_FILE,
    TERMINAL_MANIFEST_SHA_FILE,
    ...manifest.files.filter((record) => record.present).map((record) => record.path),
  ]);
  const directoryEntries = await readdir(root, { withFileTypes: true });
  const unexpectedFiles = directoryEntries
    .filter((entry) => !expectedPresent.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (unexpectedFiles.length !== 0 || manifest.unexpectedFiles.length !== 0) {
    reject("TERMINAL_EVIDENCE_UNEXPECTED_FILE");
  }
  const loaded = new Map();
  const digestMismatches = [];
  const missingRequiredFiles = [];
  for (const record of manifest.files) {
    const path = join(root, record.path);
    if (!record.present) {
      try {
        await lstat(path);
        reject("TERMINAL_EVIDENCE_UNEXPECTED_FILE");
      } catch (error) {
        if (error instanceof TerminalEvidenceError) throw error;
      }
      continue;
    }
    let truth;
    try {
      truth = await lstat(path);
    } catch {
      if (record.requiredForState) missingRequiredFiles.push(record.path);
      continue;
    }
    if (!truth.isFile() || truth.isSymbolicLink()) reject("TERMINAL_EVIDENCE_PATH_INVALID");
    const bytes = await readFile(path);
    if (bytes.length !== record.bytes || sha256Hex(bytes) !== record.sha256) digestMismatches.push(record.path);
    loaded.set(record.path, bytes);
  }
  if (
    missingRequiredFiles.length !== 0
    || manifest.missingRequiredFiles.length !== 0
  ) reject("TERMINAL_EVIDENCE_REQUIRED_FILE_MISSING");
  if (digestMismatches.length !== 0 || manifest.digestMismatches.length !== 0) {
    reject("TERMINAL_EVIDENCE_DIGEST_MISMATCH");
  }
  const credentialEntries = [...loaded, [TERMINAL_MANIFEST_FILE, manifestSource.bytes], [TERMINAL_MANIFEST_SHA_FILE, sidecarBytes]];
  if (
    manifest.containsCredentialValues !== false
    || scanForCredentialValues(credentialEntries, effectiveCredentialEnvironment) !== 0
  ) reject("TERMINAL_EVIDENCE_CREDENTIAL_VALUE_DETECTED");
  return { root, manifest, manifestFileSha256, loaded };
}

function parseBundleJson(loaded, path) {
  const bytes = loaded.get(path);
  if (!bytes) return null;
  return parseCanonicalJsonBytes(bytes, "TERMINAL_EVIDENCE_PROJECTION_INVALID").parsed;
}

function validateRuntimeBridgeHealth(value) {
  requireExactKeys(value, [
    "status", "processAlive", "pid", "protocolVersion", "bindAddress", "modelAvailable",
    "active", "queued", "serverDigest", "coreDigest",
  ], "TERMINAL_EVIDENCE_RUNTIME_RECEIPT_INVALID");
  if (
    value.status !== "PASS"
    || value.processAlive !== true
    || !Number.isSafeInteger(value.pid)
    || value.pid < 1
    || value.protocolVersion !== "novel-local-bridge/v1"
    || value.bindAddress !== "127.0.0.1"
    || value.modelAvailable !== true
    || value.active !== 0
    || value.queued !== 0
  ) reject("TERMINAL_EVIDENCE_RUNTIME_RECEIPT_INVALID");
  requireSha256(value.serverDigest, "TERMINAL_EVIDENCE_RUNTIME_RECEIPT_INVALID");
  requireSha256(value.coreDigest, "TERMINAL_EVIDENCE_RUNTIME_RECEIPT_INVALID");
}

function validateRuntimeHubHealth(value) {
  requireExactKeys(value, [
    "status", "processAlive", "pid", "protocolVersion", "bindAddress", "modelAvailable",
    "active", "queued", "serverDigest",
  ], "TERMINAL_EVIDENCE_RUNTIME_RECEIPT_INVALID");
  if (
    value.status !== "PASS"
    || value.processAlive !== true
    || !Number.isSafeInteger(value.pid)
    || value.pid < 1
    || value.protocolVersion !== "novel-private-hub/v1"
    || value.bindAddress !== "127.0.0.1"
    || value.modelAvailable !== true
    || value.active !== 0
    || value.queued !== 0
  ) reject("TERMINAL_EVIDENCE_RUNTIME_RECEIPT_INVALID");
  requireSha256(value.serverDigest, "TERMINAL_EVIDENCE_RUNTIME_RECEIPT_INVALID");
}

function validateRuntimeOllamaHealth(value) {
  requireExactKeys(value, [
    "status", "processAlive", "bindAddress", "version", "idle", "runningModelCount", "modelInstalled",
  ], "TERMINAL_EVIDENCE_RUNTIME_RECEIPT_INVALID");
  if (
    value.status !== "PASS"
    || value.processAlive !== true
    || value.bindAddress !== "127.0.0.1"
    || typeof value.version !== "string"
    || !SAFE_VERSION_PATTERN.test(value.version)
    || value.idle !== true
    || value.runningModelCount !== 0
    || value.modelInstalled !== true
  ) reject("TERMINAL_EVIDENCE_RUNTIME_RECEIPT_INVALID");
}

function validateRuntimeReceipt(receipt, lease) {
  requireObject(receipt, "TERMINAL_EVIDENCE_RUNTIME_RECEIPT_INVALID");
  requireExactKeys(receipt, [
    "schemaVersion", "preflightRunId", "executionMode", "productCommit", "controlCommit",
    "productionDeploymentId", "productionOrigin", "releaseTag", "releaseRevision", "createdAt",
    "bridgeHealth", "hubHealth", "ollamaHealth", "ollamaPid", "modelId", "modelDigest",
    "toolchainReceiptDigest", "readOnly", "mutationCount", "source", "digest",
  ], "TERMINAL_EVIDENCE_RUNTIME_RECEIPT_INVALID");
  if (
    receipt.schemaVersion !== "p24b-rc6.2-production-browser-runtime-receipt-v2"
    || typeof receipt.preflightRunId !== "string"
    || !/^[a-f0-9]{32}$/u.test(receipt.preflightRunId)
    || receipt.executionMode !== "FormalBrowserGate"
    || receipt.productCommit !== lease.productCommit
    || receipt.controlCommit !== lease.controlCommit
    || receipt.productionDeploymentId !== lease.deploymentId
    || receipt.productionOrigin !== lease.productionOrigin
    || receipt.releaseTag !== lease.releaseTag
    || receipt.releaseRevision !== lease.releaseRevision
    || receipt.source !== "production-browser-preflight-read-only-v1"
    || !Number.isSafeInteger(receipt.ollamaPid)
    || receipt.ollamaPid < 1
    || receipt.modelId !== "qwen2.5:3b"
    || receipt.readOnly !== true
    || receipt.mutationCount !== 0
  ) reject("TERMINAL_EVIDENCE_RUNTIME_RECEIPT_INVALID");
  requireTimestamp(receipt.createdAt, "TERMINAL_EVIDENCE_RUNTIME_RECEIPT_INVALID");
  requireSha256(receipt.modelDigest, "TERMINAL_EVIDENCE_RUNTIME_RECEIPT_INVALID");
  requireSha256(receipt.toolchainReceiptDigest, "TERMINAL_EVIDENCE_RUNTIME_RECEIPT_INVALID");
  validateRuntimeBridgeHealth(receipt.bridgeHealth);
  validateRuntimeHubHealth(receipt.hubHealth);
  validateRuntimeOllamaHealth(receipt.ollamaHealth);
  requireSha256(receipt.digest, "TERMINAL_EVIDENCE_RUNTIME_RECEIPT_INVALID");
  const expected = digestDomain(receipt.schemaVersion, withoutKey(receipt, "digest"));
  if (receipt.digest !== expected || lease.runtimeReceiptDigest !== receipt.digest) {
    reject("TERMINAL_EVIDENCE_RUNTIME_RECEIPT_INVALID");
  }
  return receipt;
}

function validateToolchainReceipt(receipt) {
  requireObject(receipt, "TERMINAL_EVIDENCE_TOOLCHAIN_RECEIPT_INVALID");
  requireExactKeys(receipt, [
    "schemaVersion", "packageJsonDigest", "pnpmLockDigest", "dependencies", "dependencyLinks", "edge", "proofDigest",
  ], "TERMINAL_EVIDENCE_TOOLCHAIN_RECEIPT_INVALID");
  if (receipt.schemaVersion !== "p24b-rc6.2-production-browser-toolchain-receipt-v1") {
    reject("TERMINAL_EVIDENCE_TOOLCHAIN_RECEIPT_INVALID");
  }
  requireSha256(receipt.packageJsonDigest, "TERMINAL_EVIDENCE_TOOLCHAIN_RECEIPT_INVALID");
  requireSha256(receipt.pnpmLockDigest, "TERMINAL_EVIDENCE_TOOLCHAIN_RECEIPT_INVALID");
  if (!Array.isArray(receipt.dependencies)) reject("TERMINAL_EVIDENCE_TOOLCHAIN_RECEIPT_INVALID");
  requireObject(receipt.dependencyLinks, "TERMINAL_EVIDENCE_TOOLCHAIN_RECEIPT_INVALID");
  requireObject(receipt.edge, "TERMINAL_EVIDENCE_TOOLCHAIN_RECEIPT_INVALID");
  requireSha256(receipt.proofDigest, "TERMINAL_EVIDENCE_TOOLCHAIN_RECEIPT_INVALID");
  if (receipt.proofDigest !== digestDomain(receipt.schemaVersion, withoutKey(receipt, "proofDigest"))) {
    reject("TERMINAL_EVIDENCE_TOOLCHAIN_RECEIPT_INVALID");
  }
  return receipt;
}

function validateBoundRuntimeAndToolchainReceipts(loaded, terminalLease) {
  const runtimeDocument = parseBundleJson(loaded, "runtime-receipt.json");
  const toolchainDocument = parseBundleJson(loaded, "toolchain-receipt.json");
  if (runtimeDocument === null && toolchainDocument === null && terminalLease.state === "PRECHECK_FAILED") return;
  if (runtimeDocument === null || toolchainDocument === null) {
    reject("TERMINAL_EVIDENCE_REQUIRED_FILE_MISSING");
  }
  const runtimeReceipt = validateRuntimeReceipt(runtimeDocument, terminalLease);
  const toolchainReceipt = validateToolchainReceipt(toolchainDocument);
  if (runtimeReceipt.toolchainReceiptDigest !== toolchainReceipt.proofDigest) {
    reject("TERMINAL_EVIDENCE_TOOLCHAIN_RECEIPT_INVALID");
  }
}

function requireAttemptProjection(document, attemptId, status = null) {
  requireObject(document, "TERMINAL_EVIDENCE_PROJECTION_INVALID");
  if (document.attemptId !== attemptId || typeof document.schemaVersion !== "string") {
    reject("TERMINAL_EVIDENCE_PROJECTION_INVALID");
  }
  if (status !== null && document.status !== status) reject("TERMINAL_EVIDENCE_PROJECTION_INVALID");
}

function validateFormalTruth({ manifest, loaded }) {
  const attemptId = manifest.attemptId;
  const runner = parseBundleJson(loaded, "runner-result.json");
  const browser = parseBundleJson(loaded, "browser-result.json");
  const network = parseBundleJson(loaded, "network-receipt.json");
  const model = parseBundleJson(loaded, "model-metadata.json");
  const persistence = parseBundleJson(loaded, "persistence-truth.json");
  const storyBible = parseBundleJson(loaded, "story-bible-truth.json");
  const candidate = parseBundleJson(loaded, "candidate-lineage.json");
  const approval = parseBundleJson(loaded, "approval-receipt.json");
  const profile = parseBundleJson(loaded, "profile-cleanup.json");
  const processCleanup = parseBundleJson(loaded, "process-cleanup.json");
  requireAttemptProjection(runner, attemptId, "PASS");
  requireAttemptProjection(browser, attemptId, "PASS");
  requireAttemptProjection(network, attemptId, "PASS");
  requireAttemptProjection(model, attemptId, "PASS");
  if (
    browser.backendId !== "browser-ai"
    || browser.actualExecutor !== "browser-ai"
    || browser.webLlmGenerationObserved !== true
    || browser.browserExecutionReceiptVerified !== true
    || browser.externalRequest !== false
    || browser.dataLeftDevice !== false
    || browser.prohibitedExternalAiRequestCount !== 0
    || browser.candidateGenerated !== true
    || model.backendId !== "browser-ai"
    || model.actualExecutor !== "browser-ai"
    || model.webLlmGenerationObserved !== true
    || model.browserExecutionReceiptVerified !== true
    || network.externalRequest !== false
    || network.dataLeftDevice !== false
    || network.prohibitedExternalAiRequestCount !== 0
  ) reject("TERMINAL_EVIDENCE_BROWSER_TRUTH_INVALID");
  requireSha256(browser.browserExecutionReceiptDigest, "TERMINAL_EVIDENCE_BROWSER_TRUTH_INVALID");
  requireAttemptProjection(persistence, attemptId, "PASS");
  if (
    persistence.source !== "browser-evidence"
    || persistence.sourceEvidenceDigest !== browser.browserExecutionReceiptDigest
    || !isPlainObject(persistence.persistence)
    || persistence.persistence.backend !== "indexeddb"
    || persistence.persistence.degraded !== false
    || persistence.persistence.databaseName !== "novel-intelligence-platform"
    || persistence.persistence.requiredStoresVerified !== true
    || persistence.persistence.writeVerified !== true
    || persistence.persistence.reloadVerified !== true
    || persistence.persistence.memoryFallbackUsed !== false
  ) reject("TERMINAL_EVIDENCE_PERSISTENCE_TRUTH_INVALID");
  requireAttemptProjection(storyBible, attemptId, "PASS");
  if (
    storyBible.source !== "browser-evidence"
    || storyBible.sourceEvidenceDigest !== browser.browserExecutionReceiptDigest
    || !isPlainObject(storyBible.storyBible)
    || storyBible.storyBible.status !== "ready"
    || storyBible.storyBible.approvedRecordCreated !== true
    || storyBible.storyBible.approvedRecordReloadVerified !== true
    || storyBible.storyBible.modelContextBindingVerified !== true
    || storyBible.storyBible.crossProjectLeakCount !== 0
  ) reject("TERMINAL_EVIDENCE_STORY_BIBLE_TRUTH_INVALID");
  requireAttemptProjection(candidate, attemptId, "PASS");
  requireAttemptProjection(approval, attemptId, "PASS");
  if (
    typeof candidate.candidateId !== "string"
    || !SAFE_ID_PATTERN.test(candidate.candidateId)
    || !SHA256_PATTERN.test(candidate.candidateDigest)
    || candidate.generatedBy !== "browser-ai"
    || candidate.persistedBeforeApproval !== false
    || candidate.approvalState !== "candidate"
    || approval.candidateId !== candidate.candidateId
    || approval.candidateDigest !== candidate.candidateDigest
    || approval.approvalTransactionVerified !== true
    || approval.approvedRecordCreated !== true
    || approval.persistedAfterApproval !== true
  ) reject("TERMINAL_EVIDENCE_CANDIDATE_APPROVAL_INVALID");
  requireAttemptProjection(profile, attemptId, "PASS");
  requireAttemptProjection(processCleanup, attemptId, "PASS");
  if (
    profile.profileDisposed !== true
    || profile.edgeResidueCount !== 0
    || processCleanup.runnerResidueCount !== 0
    || processCleanup.edgeResidueCount !== 0
  ) reject("TERMINAL_EVIDENCE_CLEANUP_INVALID");
  if (parseBundleJson(loaded, "runner-failure.json") || parseBundleJson(loaded, "browser-failure.json")) {
    reject("TERMINAL_EVIDENCE_FORMAL_PASS_INVALID");
  }
}

export async function validateTerminalEvidenceBundle({
  bundleDirectory,
  expectedControlCommit = null,
  credentialEnvironment = process.env,
  requireFormalPass = false,
} = {}) {
  const requiredControlCommit = requireExpectedControlCommit(expectedControlCommit);
  const bundle = await loadAndValidateBundle(bundleDirectory, requiredControlCommit, credentialEnvironment);
  const authorization = parseBundleJson(bundle.loaded, "attempt-authorization.json");
  const initialLease = parseBundleJson(bundle.loaded, "attempt-lease-initial.json");
  const terminalLease = parseBundleJson(bundle.loaded, "attempt-lease-terminal.json");
  const journalBytes = bundle.loaded.get("attempt-events.jsonl");
  if (!journalBytes) reject("TERMINAL_EVIDENCE_SOURCE_MISSING");
  const journalText = strictUtf8(journalBytes, "TERMINAL_EVIDENCE_EVENT_CHAIN_INVALID");
  const events = journalText.trimEnd().split("\n").map((line) => (
    parseCanonicalJsonBytes(Buffer.from(line, "utf8"), "TERMINAL_EVIDENCE_EVENT_CHAIN_INVALID", {
      allowFinalNewline: false,
    }).parsed
  ));
  const stateVerification = verifyStateAuthority(bundle.root, requiredControlCommit);
  validateAttemptDocuments({
    authorization,
    initialLease,
    terminalLease,
    events,
    stateVerification,
  }, requiredControlCommit);
  for (const record of bundle.manifest.files) {
    if (record.requiredForState !== requiredForState(record.path, terminalLease)) {
      reject("TERMINAL_EVIDENCE_MANIFEST_INVALID");
    }
    if (!record.present && record.reasonCode !== notReachedReason(record.path, terminalLease)) {
      reject("TERMINAL_EVIDENCE_MANIFEST_INVALID");
    }
  }
  validateEvidenceEventBindings(events, bundle.loaded, terminalLease);
  for (const path of Object.keys(FILE_PROJECTION_SCHEMAS)) {
    const projection = parseBundleJson(bundle.loaded, path);
    if (projection === null) continue;
    requireAttemptProjection(projection, terminalLease.attemptId);
    if (projection.schemaVersion !== FILE_PROJECTION_SCHEMAS[path]) {
      reject("TERMINAL_EVIDENCE_PROJECTION_INVALID");
    }
  }
  if (
    (bundle.loaded.has("runner-result.json") && bundle.loaded.has("runner-failure.json"))
    || (bundle.loaded.has("browser-result.json") && bundle.loaded.has("browser-failure.json"))
  ) reject("TERMINAL_EVIDENCE_PROJECTION_INVALID");
  if (
    bundle.manifest.attemptId !== terminalLease.attemptId
    || bundle.manifest.productCommit !== terminalLease.productCommit
    || bundle.manifest.controlCommit !== terminalLease.controlCommit
    || bundle.manifest.deploymentId !== terminalLease.deploymentId
    || bundle.manifest.productionOrigin !== terminalLease.productionOrigin
    || bundle.manifest.attemptState !== terminalLease.state
    || bundle.manifest.attemptConsumed !== terminalLease.attemptConsumed
    || bundle.manifest.runnerStarted !== terminalLease.runnerStarted
    || bundle.manifest.browserStarted !== terminalLease.browserStarted
    || bundle.manifest.terminalStatus !== terminalLease.terminalStatus
    || Date.parse(bundle.manifest.completedAt) < Date.parse(terminalLease.updatedAt)
  ) reject("TERMINAL_EVIDENCE_MANIFEST_INVALID");
  const wrapper = parseBundleJson(bundle.loaded, "wrapper-result.json");
  requireAttemptProjection(wrapper, terminalLease.attemptId);
  const expectedWrapperStatus = terminalLease.state === "TERMINAL_PASS"
    ? "PASS"
    : terminalLease.state === "TERMINAL_ABORTED" ? "ABORTED" : "FAIL";
  if (wrapper.status !== expectedWrapperStatus) reject("TERMINAL_EVIDENCE_PROJECTION_INVALID");
  validateBoundRuntimeAndToolchainReceipts(bundle.loaded, terminalLease);
  if (requireFormalPass) {
    if (
      terminalLease.state !== "TERMINAL_PASS"
      || terminalLease.terminalStatus !== "PASS"
      || terminalLease.attemptConsumed !== true
      || terminalLease.runnerStarted !== true
      || terminalLease.browserStarted !== true
    ) reject("TERMINAL_EVIDENCE_FORMAL_PASS_INVALID");
    validateFormalTruth({
      manifest: bundle.manifest,
      loaded: bundle.loaded,
    });
  }
  return {
    schemaVersion: "p24b-rc6.2-terminal-evidence-validation-v1",
    status: "PASS",
    formalPass: requireFormalPass,
    attemptId: terminalLease.attemptId,
    attemptState: terminalLease.state,
    terminalStatus: terminalLease.terminalStatus,
    manifestBodyDigest: bundle.manifest.manifestBodyDigest,
    manifestFileSha256: bundle.manifestFileSha256,
    containsCredentialValues: false,
  };
}

export async function validateFormalProductionBrowserTerminalEvidence(input = {}) {
  return validateTerminalEvidenceBundle({ ...input, requireFormalPass: true });
}

function isoAt(base, offset) {
  return new Date(Date.parse(base) + offset).toISOString();
}

function makeReceipt(schemaVersion, body, digestName) {
  return { ...body, [digestName]: digestDomain(schemaVersion, body) };
}

function makeSimulationToolchainReceipt(seed) {
  return makeReceipt(
    "p24b-rc6.2-production-browser-toolchain-receipt-v1",
    {
      schemaVersion: "p24b-rc6.2-production-browser-toolchain-receipt-v1",
      packageJsonDigest: sha256Hex(`${seed}:package`),
      pnpmLockDigest: sha256Hex(`${seed}:lock`),
      dependencies: [],
      dependencyLinks: {},
      edge: {},
    },
    "proofDigest",
  );
}

function makeSimulationEvidenceBindingProjections(attemptId, scenario) {
  if (scenario.startsWith("PRECHECK_FAIL")) return {};
  const common = { attemptId };
  const projections = {
    profileCleanup: {
      schemaVersion: "p24b-rc6.2-formal-profile-cleanup-v1",
      ...common,
      status: "PASS",
      profileDisposed: true,
      edgeResidueCount: 0,
    },
    processCleanup: {
      schemaVersion: "p24b-rc6.2-formal-process-cleanup-v1",
      ...common,
      status: "PASS",
      runnerResidueCount: 0,
      edgeResidueCount: 0,
    },
  };
  if (new Set(["PASS", "POST_RUN_CAS_FAILURE"]).has(scenario)) {
    projections.runnerResult = {
      schemaVersion: "p24b-rc6.2-formal-runner-result-v1",
      ...common,
      status: "PASS",
      exitCode: 0,
    };
  } else {
    projections.runnerFailure = {
      schemaVersion: "p24b-rc6.2-formal-runner-failure-v1",
      ...common,
      status: scenario === "RUNNER_CRASH" ? "ABORTED" : "FAIL",
      reasonCode: scenario === "RUNNER_CRASH" ? "RUNNER_CRASHED" : "FORMAL_RUNNER_FAILED",
      exitCode: scenario === "RUNNER_CRASH" ? 137 : 1,
    };
  }
  return projections;
}

async function createSimulatedAttempt({ rootDirectory, scenario, controlCommit, seed }) {
  const baseTime = "2026-08-12T08:00:00.000Z";
  const timestamp = new Date(baseTime);
  const attemptId = generateFormalAttemptId({
    now: timestamp,
    random: Buffer.from(sha256Hex(`${seed}:attempt`).slice(0, 32), "hex"),
  });
  const authorizationId = generateFormalAuthorizationId({
    now: timestamp,
    random: Buffer.from(sha256Hex(`${seed}:authorization`).slice(0, 32), "hex"),
  });
  const registryRoot = join(rootDirectory, "registry");
  const attemptRoot = join(rootDirectory, "attempts");
  await mkdir(registryRoot, { recursive: false, mode: 0o700 });
  await mkdir(attemptRoot, { recursive: false, mode: 0o700 });

  const authorization = createAttemptAuthorization({
    registryRoot,
    authorizationId,
    authorizedControlCommit: controlCommit,
    authorizedProductCommit: RC6_2_PRODUCT_COMMIT,
    authorizedDeploymentId: RC6_2_DEPLOYMENT_ID,
    authorizedAt: baseTime,
  });
  const toolchainReceipt = makeSimulationToolchainReceipt(seed);
  const runtimeReceiptBody = {
    schemaVersion: "p24b-rc6.2-production-browser-runtime-receipt-v2",
    preflightRunId: sha256Hex(`${seed}:preflight`).slice(0, 32),
    executionMode: "FormalBrowserGate",
    productCommit: RC6_2_PRODUCT_COMMIT,
    controlCommit,
    productionDeploymentId: RC6_2_DEPLOYMENT_ID,
    productionOrigin: RC6_2_PRODUCTION_ORIGIN,
    releaseTag: RC6_2_RELEASE_TAG,
    releaseRevision: RC6_2_RELEASE_REVISION,
    createdAt: isoAt(baseTime, 1_000),
    bridgeHealth: {
      status: "PASS",
      processAlive: true,
      pid: process.pid,
      protocolVersion: "novel-local-bridge/v1",
      bindAddress: "127.0.0.1",
      modelAvailable: true,
      active: 0,
      queued: 0,
      serverDigest: sha256Hex(`${seed}:bridge-server`),
      coreDigest: sha256Hex(`${seed}:bridge-core`),
    },
    hubHealth: {
      status: "PASS",
      processAlive: true,
      pid: process.pid,
      protocolVersion: "novel-private-hub/v1",
      bindAddress: "127.0.0.1",
      modelAvailable: true,
      active: 0,
      queued: 0,
      serverDigest: sha256Hex(`${seed}:hub-server`),
    },
    ollamaHealth: {
      status: "PASS",
      processAlive: true,
      bindAddress: "127.0.0.1",
      version: "0.12.0",
      idle: true,
      runningModelCount: 0,
      modelInstalled: true,
    },
    ollamaPid: 101,
    modelId: "qwen2.5:3b",
    modelDigest: sha256Hex(`${seed}:model`),
    toolchainReceiptDigest: toolchainReceipt.proofDigest,
    source: "production-browser-preflight-read-only-v1",
    readOnly: true,
    mutationCount: 0,
  };
  const runtimeReceipt = {
    ...runtimeReceiptBody,
    digest: digestDomain(runtimeReceiptBody.schemaVersion, runtimeReceiptBody),
  };
  const evidenceBindingProjections = makeSimulationEvidenceBindingProjections(attemptId, scenario);
  const bindings = {
    attemptId,
    authorizationId,
    authorizationDigest: authorization.authorizationDigest,
    productCommit: RC6_2_PRODUCT_COMMIT,
    controlCommit,
    deploymentId: RC6_2_DEPLOYMENT_ID,
    productionOrigin: RC6_2_PRODUCTION_ORIGIN,
    releaseTag: RC6_2_RELEASE_TAG,
    releaseRevision: RC6_2_RELEASE_REVISION,
    wrapperDigest: sha256Hex(`${seed}:wrapper`),
    runnerDigest: sha256Hex(`${seed}:runner`),
    contractDigest: sha256Hex(`${seed}:contract`),
    createdAt: baseTime,
  };
  const created = createFormalProductionBrowserAttempt({
    attemptRoot,
    registryRoot,
    ...bindings,
  });
  let terminalLease = created.lease;
  let eventOffset = 1;
  const transition = (eventType, eventBody = {}) => {
    eventOffset += 1;
    const result = transitionAttempt({
      attemptDirectory: created.attemptDirectory,
      eventType,
      eventBody,
      occurredAt: isoAt(baseTime, eventOffset * 1_000),
      expectedRevision: terminalLease.revision,
      expectedState: terminalLease.state,
      expectedAttemptId: attemptId,
      expectedControlCommit: controlCommit,
      expectedProductCommit: RC6_2_PRODUCT_COMMIT,
      expectedDeploymentId: RC6_2_DEPLOYMENT_ID,
      expectedProductionOrigin: RC6_2_PRODUCTION_ORIGIN,
      expectedAuthorizationDigest: authorization.authorizationDigest,
    });
    terminalLease = result.lease;
  };

  if (scenario === "PRECHECK_FAIL") {
    transition("PREFLIGHT_FAILED", { reasonCode: "PREFLIGHT_SIMULATION_FAILED" });
  } else if (scenario === "PRECHECK_FAIL_AFTER_RECEIPT") {
    transition("PREFLIGHT_PASSED", {
      runtimeReceiptDigest: runtimeReceipt.digest,
      wrapperDigest: bindings.wrapperDigest,
      runnerDigest: bindings.runnerDigest,
      contractDigest: bindings.contractDigest,
    });
    transition("PREFLIGHT_FAILED", { reasonCode: "POST_RECEIPT_PREFLIGHT_SIMULATION_FAILED" });
  } else {
    transition("PREFLIGHT_PASSED", {
      runtimeReceiptDigest: runtimeReceipt.digest,
      wrapperDigest: bindings.wrapperDigest,
      runnerDigest: bindings.runnerDigest,
      contractDigest: bindings.contractDigest,
    });
    transition("LAUNCH_COMMITTED");
    transition("RUNNER_STARTED", { runnerPid: process.pid });
    if (!new Set(["RUNNER_CRASH", "BROWSER_LAUNCH_FAILURE"]).has(scenario)) {
      transition("BROWSER_STARTED", {
        persistentContextEstablished: true,
        networkRoutesInstalled: true,
        productInteractionStarted: false,
      });
      const runnerPassed = new Set(["PASS", "POST_RUN_CAS_FAILURE"]).has(scenario);
      const runnerProjection = runnerPassed
        ? evidenceBindingProjections.runnerResult
        : evidenceBindingProjections.runnerFailure;
      transition("RUNNER_COMPLETED", {
        outcome: runnerPassed ? "PASS" : "FAIL",
        exitCode: runnerProjection.exitCode,
        runnerEvidenceDigest: sha256Hex(canonicalBytes(runnerProjection)),
      });
    }
    transition("CLEANUP_COMPLETED", {
      profileCleanupDigest: sha256Hex(canonicalBytes(evidenceBindingProjections.profileCleanup)),
      processCleanupDigest: sha256Hex(canonicalBytes(evidenceBindingProjections.processCleanup)),
    });
    if (scenario === "PASS") {
      transition("TERMINAL_PASS");
    } else if (scenario === "POST_RUN_CAS_FAILURE") {
      transition("TERMINAL_FAIL", { reasonCode: "POST_RUN_CAS_FAILED" });
    } else if (scenario === "RUNNER_CRASH") {
      transition("TERMINAL_ABORTED", { reasonCode: "RUNNER_CRASHED" });
    } else if (scenario === "BROWSER_LAUNCH_FAILURE") {
      transition("TERMINAL_FAIL", { reasonCode: "BROWSER_LAUNCH_FAILED" });
    } else {
      transition("TERMINAL_FAIL", { reasonCode: "FORMAL_SIMULATION_FAILED" });
    }
  }

  const verified = verifyAttemptJournal({
    attemptDirectory: created.attemptDirectory,
    expectedAttemptId: attemptId,
    expectedControlCommit: controlCommit,
    expectedProductCommit: RC6_2_PRODUCT_COMMIT,
    expectedDeploymentId: RC6_2_DEPLOYMENT_ID,
    expectedProductionOrigin: RC6_2_PRODUCTION_ORIGIN,
    expectedAuthorizationDigest: authorization.authorizationDigest,
  });
  if (stableStringify(verified.lease) !== stableStringify(terminalLease)) {
    reject("TERMINAL_EVIDENCE_SIMULATION_INVALID");
  }
  return {
    attemptDirectory: created.attemptDirectory,
    attemptId,
    authorization,
    terminalLease,
    events: verified.events,
    runtimeReceipt,
    toolchainReceipt,
    evidenceBindingProjections,
    baseTime,
  };
}

function makeSimulationProjections(simulation, scenario) {
  const { attemptId, runtimeReceipt, baseTime } = simulation;
  const browserDigest = sha256Hex(`${attemptId}:browser-evidence`);
  const candidateDigest = sha256Hex(`${attemptId}:candidate`);
  const common = { attemptId };
  const projections = {
    wrapperResult: {
      schemaVersion: "p24b-rc6.2-formal-wrapper-result-v1",
      ...common,
      status: scenario === "PASS" ? "PASS" : scenario === "RUNNER_CRASH" ? "ABORTED" : "FAIL",
      completedAt: isoAt(baseTime, 20_000),
    },
  };
  if (scenario !== "PRECHECK_FAIL") {
    projections.runtimeReceipt = runtimeReceipt;
    projections.toolchainReceipt = simulation.toolchainReceipt;
  }
  if (scenario === "PASS") {
    Object.assign(projections, {
      browserResult: {
        schemaVersion: "p24b-rc6.2-formal-browser-result-v1",
        ...common,
        status: "PASS",
        backendId: "browser-ai",
        actualExecutor: "browser-ai",
        webLlmGenerationObserved: true,
        browserExecutionReceiptVerified: true,
        browserExecutionReceiptDigest: browserDigest,
        externalRequest: false,
        dataLeftDevice: false,
        prohibitedExternalAiRequestCount: 0,
        candidateGenerated: true,
      },
      networkReceipt: {
        schemaVersion: "p24b-rc6.2-formal-network-receipt-v1",
        ...common,
        status: "PASS",
        externalRequest: false,
        dataLeftDevice: false,
        prohibitedExternalAiRequestCount: 0,
      },
      modelMetadata: {
        schemaVersion: "p24b-rc6.2-formal-model-metadata-v1",
        ...common,
        status: "PASS",
        backendId: "browser-ai",
        actualExecutor: "browser-ai",
        webLlmGenerationObserved: true,
        browserExecutionReceiptVerified: true,
      },
      persistenceTruth: {
        schemaVersion: "p24b-rc6.2-formal-persistence-truth-v1",
        ...common,
        status: "PASS",
        source: "browser-evidence",
        sourceEvidenceDigest: browserDigest,
        persistence: {
          backend: "indexeddb",
          degraded: false,
          databaseName: "novel-intelligence-platform",
          requiredStoresVerified: true,
          writeVerified: true,
          reloadVerified: true,
          memoryFallbackUsed: false,
        },
      },
      storyBibleTruth: {
        schemaVersion: "p24b-rc6.2-formal-story-bible-truth-v1",
        ...common,
        status: "PASS",
        source: "browser-evidence",
        sourceEvidenceDigest: browserDigest,
        storyBible: {
          status: "ready",
          approvedRecordCreated: true,
          approvedRecordReloadVerified: true,
          modelContextBindingVerified: true,
          crossProjectLeakCount: 0,
        },
      },
      candidateLineage: {
        schemaVersion: "p24b-rc6.2-formal-candidate-lineage-v1",
        ...common,
        status: "PASS",
        candidateId: "candidate-1",
        candidateDigest,
        generatedBy: "browser-ai",
        persistedBeforeApproval: false,
        approvalState: "candidate",
      },
      approvalReceipt: {
        schemaVersion: "p24b-rc6.2-formal-approval-receipt-v1",
        ...common,
        status: "PASS",
        candidateId: "candidate-1",
        candidateDigest,
        approvalTransactionVerified: true,
        approvedRecordCreated: true,
        persistedAfterApproval: true,
      },
    });
  } else if (!scenario.startsWith("PRECHECK_FAIL")) {
    if (scenario === "BROWSER_LAUNCH_FAILURE") {
      projections.browserFailure = {
        schemaVersion: "p24b-rc6.2-formal-browser-failure-v1",
        ...common,
        status: "FAIL",
        reasonCode: "BROWSER_LAUNCH_FAILED",
      };
    } else if (new Set(["FAIL", "POST_RUN_CAS_FAILURE"]).has(scenario)) {
      projections.browserFailure = {
        schemaVersion: "p24b-rc6.2-formal-browser-failure-v1",
        ...common,
        status: "FAIL",
        reasonCode: scenario === "POST_RUN_CAS_FAILURE"
          ? "POST_RUN_CAS_FAILED"
          : "FORMAL_BROWSER_ASSERTION_FAILED",
      };
    }
  }
  return { ...projections, ...simulation.evidenceBindingProjections };
}

export async function simulateFormalProductionBrowserTerminalEvidence({
  rootDirectory,
  scenario,
  controlCommit,
  seed = `${scenario}-fixture`,
} = {}) {
  if (!new Set([
    "PASS", "FAIL", "POST_RUN_CAS_FAILURE", "RUNNER_CRASH", "BROWSER_LAUNCH_FAILURE",
    "PRECHECK_FAIL", "PRECHECK_FAIL_AFTER_RECEIPT",
  ]).has(scenario)) {
    reject("TERMINAL_EVIDENCE_SIMULATION_INVALID");
  }
  if (typeof controlCommit !== "string" || !COMMIT_PATTERN.test(controlCommit) || controlCommit === RC6_2_PRODUCT_COMMIT) {
    reject("TERMINAL_EVIDENCE_SIMULATION_INVALID");
  }
  const root = assertAbsoluteSafePath(rootDirectory);
  await assertDirectory(root, "TERMINAL_EVIDENCE_PATH_INVALID");
  const suffix = sha256Hex(`${seed}:${randomBytes(8).toString("hex")}`).slice(0, 16);
  const simulationRoot = join(root, `simulation-${suffix}`);
  await mkdir(simulationRoot, { recursive: false, mode: 0o700 });
  const simulation = await createSimulatedAttempt({
    rootDirectory: simulationRoot,
    scenario,
    controlCommit,
    seed: `${seed}:${suffix}`,
  });
  const bundleDirectory = join(simulation.attemptDirectory, "terminal-evidence");
  const projections = makeSimulationProjections(simulation, scenario);
  const finalized = await finalizeFormalProductionBrowserTerminalEvidence({
    attemptDirectory: simulation.attemptDirectory,
    bundleDirectory,
    expectedControlCommit: controlCommit,
    startedAt: simulation.baseTime,
    completedAt: simulation.terminalLease.updatedAt,
    ...projections,
  });
  const validation = scenario === "PASS"
    ? await validateFormalProductionBrowserTerminalEvidence({ bundleDirectory, expectedControlCommit: controlCommit })
    : await validateTerminalEvidenceBundle({ bundleDirectory, expectedControlCommit: controlCommit });
  return {
    scenario,
    attemptDirectory: simulation.attemptDirectory,
    bundleDirectory,
    attemptId: simulation.attemptId,
    manifest: finalized.manifest,
    manifestFileSha256: finalized.manifestFileSha256,
    safeResult: finalized.safeResult,
    validation,
  };
}

async function readStructuredStdin() {
  const chunks = [];
  let byteCount = 0;
  for await (const chunk of process.stdin) {
    byteCount += chunk.byteLength;
    if (byteCount > MAX_JSON_BYTES) reject("TERMINAL_EVIDENCE_INPUT_INVALID");
    chunks.push(chunk);
  }
  if (byteCount === 0) reject("TERMINAL_EVIDENCE_INPUT_INVALID");
  const bytes = Buffer.concat(chunks, byteCount);
  const raw = strictUtf8(bytes, "TERMINAL_EVIDENCE_INPUT_INVALID");
  if (raw.startsWith("\uFEFF") || raw.includes("\0") || raw.includes("\uFFFD")) {
    reject("TERMINAL_EVIDENCE_INPUT_INVALID");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    reject("TERMINAL_EVIDENCE_INPUT_INVALID");
  }
  requireObject(parsed, "TERMINAL_EVIDENCE_INPUT_INVALID");
  stableStringify(parsed);
  return parsed;
}

export async function runTerminalEvidenceCli() {
  const mode = process.argv[2];
  const input = await readStructuredStdin();
  if (mode === "finalize") {
    const result = await finalizeFormalProductionBrowserTerminalEvidence(input);
    process.stdout.write(stableStringify(result.safeResult));
    return;
  }
  if (mode === "validate" || mode === "validate-formal") {
    const validation = mode === "validate-formal"
      ? await validateFormalProductionBrowserTerminalEvidence(input)
      : await validateTerminalEvidenceBundle(input);
    process.stdout.write(stableStringify({
      schemaVersion: "p24b-rc6.2-terminal-evidence-safe-validation-v1",
      status: validation.status,
      formalPass: validation.formalPass,
      attemptIdFingerprint: sha256Hex(validation.attemptId).slice(0, 16),
      attemptState: validation.attemptState,
      terminalStatus: validation.terminalStatus,
      manifestBodyDigest: validation.manifestBodyDigest,
      manifestFileSha256: validation.manifestFileSha256,
      containsCredentialValues: false,
    }));
    return;
  }
  if (mode === "simulate") {
    const simulation = await simulateFormalProductionBrowserTerminalEvidence(input);
    process.stdout.write(stableStringify(simulation.safeResult));
    return;
  }
  if (mode === "bind-projections") {
    process.stdout.write(stableStringify(computeTerminalEvidenceProjectionBindings(input)));
    return;
  }
  reject("TERMINAL_EVIDENCE_CLI_MODE_INVALID");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runTerminalEvidenceCli().catch((error) => {
    const code = typeof error?.code === "string" ? error.code : "TERMINAL_EVIDENCE_INPUT_INVALID";
    process.stderr.write(`${FINITE_CODES.has(code) ? code : "TERMINAL_EVIDENCE_INPUT_INVALID"}\n`);
    process.exitCode = 2;
  });
}

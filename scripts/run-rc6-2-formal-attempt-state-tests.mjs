import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync as pathExists,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FORMAL_ATTEMPT_FILES,
  computeFormalAttemptEventDigest,
  computeFormalAttemptLeaseDigest,
  commitBrowserStartedOrClose,
  createAttemptAuthorization,
  createFormalProductionBrowserAttempt,
  generateFormalAttemptId,
  generateFormalAuthorizationId,
  loadAttempt,
  recoverFormalProductionBrowserAttemptCreation,
  recoverAttemptLease,
  stableStringify,
  transitionAttempt,
  transitionAttemptIdempotent,
  validateFormalProductionBrowserAttemptLease,
  verifyAttemptJournal,
  waitForAttemptState,
} from "./rc6-2-formal-attempt-state.mjs";

const STATE_MODULE = fileURLToPath(new URL("./rc6-2-formal-attempt-state.mjs", import.meta.url));
const PRODUCT_COMMIT = "29fc6e742672bb07187765d34ea818afdadf56ae";
const CONTROL_COMMIT = "b326c2fc9925798ffbc750ae37db847f0c8b5625";
const DEPLOYMENT_ID = "dpl_8pqTpwAgQQAqmLKNzZNCzSfPuqNn";
const PRODUCTION_ORIGIN = "https://novel-eexnlr77y-lqtechs-projects.vercel.app";
const RELEASE_TAG = "novel-ai-p24b-conversation-first-studio-rc6.2";
const RELEASE_REVISION = "rc6.2";
const RUNTIME_DIGEST = "1".repeat(64);
const WRAPPER_DIGEST = "2".repeat(64);
const RUNNER_DIGEST = "3".repeat(64);
const CONTRACT_DIGEST = "4".repeat(64);
const RUNNER_EVIDENCE_DIGEST = "5".repeat(64);
const PROFILE_CLEANUP_DIGEST = "6".repeat(64);
const PROCESS_CLEANUP_DIGEST = "7".repeat(64);

const tests = [];
const temporaryRoots = [];
let fixtureSequence = 0;
const scenarioNames = new Set();

function test(name, operation) {
  tests.push({ name, operation });
  const scenario = /^([A-J])\./u.exec(name)?.[1];
  if (scenario) scenarioNames.add(scenario);
}

function expectCode(code, operation) {
  assert.throws(operation, (error) => error?.code === code, `expected ${code}`);
}

async function expectCodeAsync(code, operation) {
  await assert.rejects(operation, (error) => error?.code === code, `expected ${code}`);
}

function fixtureTime(fixture, offsetSeconds) {
  return new Date(fixture.baseTime + offsetSeconds * 1_000).toISOString();
}

function createFixture() {
  fixtureSequence += 1;
  const root = mkdtempSync(path.join(tmpdir(), "novel-rc6-c7-attempt-"));
  temporaryRoots.push(root);
  const registryRoot = path.join(root, "registry");
  const attemptRoot = path.join(root, "attempts");
  const baseTime = Date.parse("2026-08-12T00:00:00.000Z") + fixtureSequence * 60_000;
  const authRandom = Buffer.alloc(16, (fixtureSequence * 2) % 256);
  const attemptRandom = Buffer.alloc(16, (fixtureSequence * 2 + 1) % 256);
  const authorizedAt = new Date(baseTime).toISOString();
  const authorization = createAttemptAuthorization({
    registryRoot,
    authorizationId: generateFormalAuthorizationId({ now: new Date(baseTime), random: authRandom }),
    authorizedControlCommit: CONTROL_COMMIT,
    authorizedProductCommit: PRODUCT_COMMIT,
    authorizedDeploymentId: DEPLOYMENT_ID,
    authorizedAt,
  });
  const attemptId = generateFormalAttemptId({ now: new Date(baseTime), random: attemptRandom });
  const created = createFormalProductionBrowserAttempt({
    attemptRoot,
    registryRoot,
    attemptId,
    authorizationId: authorization.authorizationId,
    authorizationDigest: authorization.authorizationDigest,
    productCommit: PRODUCT_COMMIT,
    controlCommit: CONTROL_COMMIT,
    deploymentId: DEPLOYMENT_ID,
    productionOrigin: PRODUCTION_ORIGIN,
    releaseTag: RELEASE_TAG,
    releaseRevision: RELEASE_REVISION,
    wrapperDigest: WRAPPER_DIGEST,
    runnerDigest: RUNNER_DIGEST,
    contractDigest: CONTRACT_DIGEST,
    createdAt: authorizedAt,
  });
  return {
    root,
    registryRoot,
    attemptRoot,
    baseTime,
    authorization,
    attemptId,
    attemptDirectory: created.attemptDirectory,
    lease: created.lease,
  };
}

function transition(fixture, eventType, eventBody = {}, options = {}) {
  const current = loadAttempt({ attemptDirectory: fixture.attemptDirectory });
  return transitionAttempt({
    attemptDirectory: fixture.attemptDirectory,
    eventType,
    eventBody,
    occurredAt: fixtureTime(fixture, current.revision),
    expectedRevision: current.revision,
    expectedState: current.state,
    expectedAttemptId: fixture.attemptId,
    expectedControlCommit: CONTROL_COMMIT,
    expectedProductCommit: PRODUCT_COMMIT,
    expectedDeploymentId: DEPLOYMENT_ID,
    expectedProductionOrigin: PRODUCTION_ORIGIN,
    expectedAuthorizationDigest: fixture.authorization.authorizationDigest,
    expectedAuthorizationId: fixture.authorization.authorizationId,
    expectedReleaseTag: RELEASE_TAG,
    expectedReleaseRevision: RELEASE_REVISION,
    expectedRuntimeReceiptDigest: current.runtimeReceiptDigest,
    expectedWrapperDigest: WRAPPER_DIGEST,
    expectedRunnerDigest: RUNNER_DIGEST,
    expectedContractDigest: CONTRACT_DIGEST,
    ...options,
  });
}

function transitionIdempotent(
  fixture,
  eventType,
  eventBody,
  { expectedRevision, expectedState, ...options },
) {
  return transitionAttemptIdempotent({
    attemptDirectory: fixture.attemptDirectory,
    eventType,
    eventBody,
    occurredAt: fixtureTime(fixture, expectedRevision),
    expectedRevision,
    expectedState,
    expectedAttemptId: fixture.attemptId,
    expectedControlCommit: CONTROL_COMMIT,
    expectedProductCommit: PRODUCT_COMMIT,
    expectedDeploymentId: DEPLOYMENT_ID,
    expectedProductionOrigin: PRODUCTION_ORIGIN,
    expectedAuthorizationDigest: fixture.authorization.authorizationDigest,
    expectedAuthorizationId: fixture.authorization.authorizationId,
    expectedReleaseTag: RELEASE_TAG,
    expectedReleaseRevision: RELEASE_REVISION,
    expectedRuntimeReceiptDigest: RUNTIME_DIGEST,
    expectedWrapperDigest: WRAPPER_DIGEST,
    expectedRunnerDigest: RUNNER_DIGEST,
    expectedContractDigest: CONTRACT_DIGEST,
    ...options,
  });
}

function passPreflight(fixture, options) {
  return transition(fixture, "PREFLIGHT_PASSED", {
    runtimeReceiptDigest: RUNTIME_DIGEST,
    wrapperDigest: WRAPPER_DIGEST,
    runnerDigest: RUNNER_DIGEST,
    contractDigest: CONTRACT_DIGEST,
  }, options);
}

function launchRunner(fixture) {
  passPreflight(fixture);
  transition(fixture, "LAUNCH_COMMITTED");
  transition(fixture, "RUNNER_STARTED", { runnerPid: 4242 });
}

function launchBrowser(fixture) {
  launchRunner(fixture);
  transition(fixture, "BROWSER_STARTED", {
    persistentContextEstablished: true,
    networkRoutesInstalled: true,
    productInteractionStarted: false,
  });
}

function completePass(fixture) {
  launchBrowser(fixture);
  transition(fixture, "RUNNER_COMPLETED", {
    outcome: "PASS",
    exitCode: 0,
    runnerEvidenceDigest: RUNNER_EVIDENCE_DIGEST,
  });
  transition(fixture, "CLEANUP_COMPLETED", {
    profileCleanupDigest: PROFILE_CLEANUP_DIGEST,
    processCleanupDigest: PROCESS_CLEANUP_DIGEST,
  });
  transition(fixture, "TERMINAL_PASS");
  return loadAttempt({ attemptDirectory: fixture.attemptDirectory });
}

function rewriteLiveLease(fixture, mutate) {
  const live = path.join(fixture.attemptDirectory, FORMAL_ATTEMPT_FILES.liveLease);
  const lease = JSON.parse(readFileSync(live, "utf8"));
  mutate(lease);
  delete lease.leaseDigest;
  lease.leaseDigest = computeFormalAttemptLeaseDigest(lease);
  writeFileSync(live, `${stableStringify(lease)}\n`, "utf8");
  return lease;
}

function rewriteJournal(fixture, mutate) {
  const journal = path.join(fixture.attemptDirectory, FORMAL_ATTEMPT_FILES.journal);
  const events = readFileSync(journal, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
  mutate(events);
  writeFileSync(journal, `${events.map(stableStringify).join("\n")}\n`, "utf8");
}

function runCli(command, payload) {
  return spawnSync(process.execPath, [STATE_MODULE, command], {
    input: stableStringify(payload),
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
}

test("128-bit attempt and authorization IDs include UTC and never use timestamp alone", () => {
  const now = new Date("2026-08-12T01:02:03.004Z");
  const first = generateFormalAttemptId({ now, random: Buffer.alloc(16, 0xaa) });
  const second = generateFormalAttemptId({ now, random: Buffer.alloc(16, 0xbb) });
  assert.match(first, /^C7-PROD-BROWSER-20260812T010203004Z-[a-f0-9]{32}$/u);
  assert.notEqual(first, second);
  assert.match(generateFormalAuthorizationId({ now, random: Buffer.alloc(16, 0xcc) }),
    /^C7-PROD-BROWSER-AUTH-20260812T010203004Z-[a-f0-9]{32}$/u);
});

test("PREPARED creates the four durable files and exact initial projection", () => {
  const fixture = createFixture();
  const names = [
    FORMAL_ATTEMPT_FILES.authorization,
    FORMAL_ATTEMPT_FILES.initialLease,
    FORMAL_ATTEMPT_FILES.journal,
    FORMAL_ATTEMPT_FILES.liveLease,
  ];
  for (const name of names) assert.ok(readFileSync(path.join(fixture.attemptDirectory, name)).byteLength > 0);
  assert.deepEqual({
    state: fixture.lease.state,
    revision: fixture.lease.revision,
    attemptConsumed: fixture.lease.attemptConsumed,
    runnerStarted: fixture.lease.runnerStarted,
    browserStarted: fixture.lease.browserStarted,
    terminalStatus: fixture.lease.terminalStatus,
    runtimeReceiptDigest: fixture.lease.runtimeReceiptDigest,
  }, {
    state: "PREPARED",
    revision: 1,
    attemptConsumed: false,
    runnerStarted: false,
    browserStarted: false,
    terminalStatus: null,
    runtimeReceiptDigest: null,
  });
  assert.equal(validateFormalProductionBrowserAttemptLease(fixture.lease), fixture.lease);
});

test("authorization is scoped and atomically consumable only once", () => {
  const fixture = createFixture();
  const secondId = generateFormalAttemptId({
    now: new Date(fixture.baseTime + 1_000),
    random: Buffer.alloc(16, 0xfe),
  });
  expectCode("AUTHORIZATION_ALREADY_CONSUMED", () => createFormalProductionBrowserAttempt({
    attemptRoot: fixture.attemptRoot,
    registryRoot: fixture.registryRoot,
    attemptId: secondId,
    authorizationId: fixture.authorization.authorizationId,
    authorizationDigest: fixture.authorization.authorizationDigest,
    productCommit: PRODUCT_COMMIT,
    controlCommit: CONTROL_COMMIT,
    deploymentId: DEPLOYMENT_ID,
    productionOrigin: PRODUCTION_ORIGIN,
    releaseTag: RELEASE_TAG,
    releaseRevision: RELEASE_REVISION,
    wrapperDigest: WRAPPER_DIGEST,
    runnerDigest: RUNNER_DIGEST,
    contractDigest: CONTRACT_DIGEST,
    createdAt: fixtureTime(fixture, 1),
  }));
});

test("duplicate invocation never overwrites an existing attempt directory", () => {
  const fixture = createFixture();
  const before = readFileSync(path.join(fixture.attemptDirectory, FORMAL_ATTEMPT_FILES.journal), "utf8");
  expectCode("ATTEMPT_ALREADY_EXISTS", () => createFormalProductionBrowserAttempt({
    attemptRoot: fixture.attemptRoot,
    registryRoot: fixture.registryRoot,
    attemptId: fixture.attemptId,
  }));
  assert.equal(readFileSync(path.join(fixture.attemptDirectory, FORMAL_ATTEMPT_FILES.journal), "utf8"), before);
});

test("authorization identity mismatch is rejected before an attempt exists", () => {
  fixtureSequence += 1;
  const root = mkdtempSync(path.join(tmpdir(), "novel-rc6-c7-auth-scope-"));
  temporaryRoots.push(root);
  const registryRoot = path.join(root, "registry");
  const attemptRoot = path.join(root, "attempts");
  const now = new Date("2026-08-12T03:00:00.000Z");
  const authorization = createAttemptAuthorization({
    registryRoot,
    authorizationId: generateFormalAuthorizationId({ now, random: Buffer.alloc(16, 9) }),
    authorizedControlCommit: CONTROL_COMMIT,
    authorizedProductCommit: PRODUCT_COMMIT,
    authorizedDeploymentId: DEPLOYMENT_ID,
    authorizedAt: now.toISOString(),
  });
  expectCode("AUTHORIZATION_SCOPE_MISMATCH", () => createFormalProductionBrowserAttempt({
    attemptRoot,
    registryRoot,
    attemptId: generateFormalAttemptId({ now, random: Buffer.alloc(16, 10) }),
    authorizationId: authorization.authorizationId,
    authorizationDigest: authorization.authorizationDigest,
    productCommit: "a".repeat(40),
    controlCommit: CONTROL_COMMIT,
    deploymentId: DEPLOYMENT_ID,
    productionOrigin: PRODUCTION_ORIGIN,
    releaseTag: RELEASE_TAG,
    releaseRevision: RELEASE_REVISION,
    wrapperDigest: WRAPPER_DIGEST,
    runnerDigest: RUNNER_DIGEST,
    contractDigest: CONTRACT_DIGEST,
    createdAt: now.toISOString(),
  }));
});

test("A. preflight PASS remains unconsumed until LAUNCH_COMMITTED", () => {
  const fixture = createFixture();
  const lease = passPreflight(fixture).lease;
  assert.deepEqual([lease.state, lease.attemptConsumed, lease.runnerStarted, lease.browserStarted, lease.terminalStatus],
    ["PREFLIGHT_PASSED", false, false, false, null]);
  assert.equal(lease.runtimeReceiptDigest, RUNTIME_DIGEST);
});

test("B. preflight FAIL closes the ID without consuming the formal attempt", () => {
  const fixture = createFixture();
  const lease = transition(fixture, "PREFLIGHT_FAILED", { reasonCode: "RUNTIME_RECEIPT_INVALID" }).lease;
  assert.deepEqual([lease.state, lease.attemptConsumed, lease.runnerStarted, lease.browserStarted, lease.terminalStatus],
    ["PRECHECK_FAILED", false, false, false, "FAIL"]);
  expectCode("TRANSITION_INVALID", () => transition(fixture, "PREFLIGHT_PASSED", {
    runtimeReceiptDigest: RUNTIME_DIGEST,
    wrapperDigest: WRAPPER_DIGEST,
    runnerDigest: RUNNER_DIGEST,
    contractDigest: CONTRACT_DIGEST,
  }));
});

test("C. runner spawn failure is consumed but runner/browser remain false", () => {
  const fixture = createFixture();
  passPreflight(fixture);
  transition(fixture, "LAUNCH_COMMITTED");
  const lease = transition(fixture, "TERMINAL_FAIL", { reasonCode: "RUNNER_SPAWN_FAILED" }).lease;
  assert.deepEqual([lease.state, lease.attemptConsumed, lease.runnerStarted, lease.browserStarted, lease.terminalStatus],
    ["TERMINAL_FAIL", true, false, false, "FAIL"]);
});

test("D. browser launch failure records a started runner but no browser", () => {
  const fixture = createFixture();
  launchRunner(fixture);
  const lease = transition(fixture, "TERMINAL_FAIL", { reasonCode: "BROWSER_LAUNCH_FAILED" }).lease;
  assert.deepEqual([lease.state, lease.attemptConsumed, lease.runnerStarted, lease.browserStarted, lease.terminalStatus],
    ["TERMINAL_FAIL", true, true, false, "FAIL"]);
});

test("E. runner timeout has an explicit aborted terminal classification", () => {
  const fixture = createFixture();
  launchRunner(fixture);
  const lease = transition(fixture, "TERMINAL_ABORTED", { reasonCode: "RUNNER_TIMEOUT" }).lease;
  assert.deepEqual([lease.state, lease.attemptConsumed, lease.runnerStarted, lease.browserStarted, lease.terminalStatus],
    ["TERMINAL_ABORTED", true, true, false, "ABORTED"]);
});

test("F. formal PASS requires runner completion PASS and browser start", () => {
  const fixture = createFixture();
  const lease = completePass(fixture);
  assert.deepEqual([lease.state, lease.attemptConsumed, lease.runnerStarted, lease.browserStarted, lease.terminalStatus],
    ["TERMINAL_PASS", true, true, true, "PASS"]);
  assert.equal(lease.cleanupCompleted, true);
});

test("G. formal FAIL after browser start stays a terminal failure", () => {
  const fixture = createFixture();
  launchBrowser(fixture);
  transition(fixture, "RUNNER_COMPLETED", {
    outcome: "FAIL",
    exitCode: 1,
    runnerEvidenceDigest: RUNNER_EVIDENCE_DIGEST,
  });
  transition(fixture, "CLEANUP_COMPLETED", {
    profileCleanupDigest: PROFILE_CLEANUP_DIGEST,
    processCleanupDigest: PROCESS_CLEANUP_DIGEST,
  });
  const lease = transition(fixture, "TERMINAL_FAIL", { reasonCode: "RUNNER_REPORTED_FAIL" }).lease;
  assert.deepEqual([lease.state, lease.attemptConsumed, lease.runnerStarted, lease.browserStarted, lease.terminalStatus],
    ["TERMINAL_FAIL", true, true, true, "FAIL"]);
});

test("H. projection writer failure leaves a durable event and requires explicit recovery", () => {
  const fixture = createFixture();
  expectCode("LEASE_PROJECTION_WRITE_FAILED", () => passPreflight(fixture, {
    faultInjection: "before-projection-replace",
  }));
  expectCode("LEASE_PROJECTION_STALE", () => loadAttempt({ attemptDirectory: fixture.attemptDirectory }));
  const recovered = recoverAttemptLease({ attemptDirectory: fixture.attemptDirectory });
  assert.equal(recovered.lease.state, "PREFLIGHT_PASSED");
  assert.equal(recovered.lease.revision, 2);
});

test("I. stale CAS revision/state and a concurrent lock fail closed", () => {
  const fixture = createFixture();
  expectCode("REVISION_MISMATCH", () => transitionAttempt({
    attemptDirectory: fixture.attemptDirectory,
    eventType: "PREFLIGHT_FAILED",
    eventBody: { reasonCode: "STALE_CALL" },
    occurredAt: fixtureTime(fixture, 1),
    expectedRevision: 99,
    expectedState: "PREPARED",
  }));
  expectCode("STATE_MISMATCH", () => transitionAttempt({
    attemptDirectory: fixture.attemptDirectory,
    eventType: "PREFLIGHT_FAILED",
    eventBody: { reasonCode: "STALE_CALL" },
    occurredAt: fixtureTime(fixture, 1),
    expectedRevision: 1,
    expectedState: "PREFLIGHT_PASSED",
  }));
});

test("I. live lock owner blocks mutation and a crashed owner lock is recovered", async () => {
  const fixture = createFixture();
  const lockDirectory = path.join(fixture.attemptDirectory, ".formal-attempt-transition.lock");
  const child = spawn(process.execPath, ["-e", `
    const { mkdirSync, writeFileSync } = require("node:fs");
    const { createHash } = require("node:crypto");
    const lock = process.argv[1];
    const body = {schemaVersion:"1",pid:process.pid,nonce:"${"a".repeat(32)}",acquiredAt:new Date().toISOString()};
    const stable=(value)=>JSON.stringify(value,Object.keys(value).sort());
    body.ownerDigest=createHash("sha256").update("p24b-rc6.2-formal-attempt-lock-owner-v1\\n"+stable(body)).digest("hex");
    mkdirSync(lock); writeFileSync(lock+"/owner.json",JSON.stringify(body)+"\\n");
    process.stdout.write("ready\\n"); setTimeout(()=>{},30000);
  `, lockDirectory], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("lock owner did not start")), 5_000);
    child.stdout.once("data", () => { clearTimeout(timer); resolve(); });
    child.once("error", reject);
  });
  expectCode("ATTEMPT_LOCKED", () => transitionAttempt({
    attemptDirectory: fixture.attemptDirectory,
    eventType: "PREFLIGHT_FAILED",
    eventBody: { reasonCode: "CONCURRENT_CALL" },
  }));
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
  const lease = transition(fixture, "PREFLIGHT_FAILED", { reasonCode: "OWNER_CRASH_RECOVERED" }).lease;
  assert.equal(lease.state, "PRECHECK_FAILED");
});

test("J. stale but valid lease projection rebuilds exactly from the journal", () => {
  const fixture = createFixture();
  const initial = readFileSync(path.join(fixture.attemptDirectory, FORMAL_ATTEMPT_FILES.liveLease), "utf8");
  passPreflight(fixture);
  writeFileSync(path.join(fixture.attemptDirectory, FORMAL_ATTEMPT_FILES.liveLease), initial, "utf8");
  expectCode("LEASE_PROJECTION_STALE", () => loadAttempt({ attemptDirectory: fixture.attemptDirectory }));
  const recovered = loadAttempt({ attemptDirectory: fixture.attemptDirectory, rebuildProjection: true });
  assert.equal(recovered.state, "PREFLIGHT_PASSED");
  assert.equal(recovered.revision, 2);
  assert.equal(recovered.leaseDigest, verifyAttemptJournal({ attemptDirectory: fixture.attemptDirectory }).lease.leaseDigest);
});

test("authorization claim crash seam has a durable recoverable attempt", () => {
  fixtureSequence += 1;
  const root = mkdtempSync(path.join(tmpdir(), "novel-rc6-c7-create-recovery-"));
  temporaryRoots.push(root);
  const registryRoot = path.join(root, "registry");
  const attemptRoot = path.join(root, "attempts");
  const now = new Date("2026-08-12T03:30:00.000Z");
  const authorization = createAttemptAuthorization({
    registryRoot,
    authorizationId: generateFormalAuthorizationId({ now, random: Buffer.alloc(16, 0x21) }),
    authorizedControlCommit: CONTROL_COMMIT,
    authorizedProductCommit: PRODUCT_COMMIT,
    authorizedDeploymentId: DEPLOYMENT_ID,
    authorizedAt: now.toISOString(),
  });
  const attemptId = generateFormalAttemptId({ now, random: Buffer.alloc(16, 0x22) });
  const input = {
    attemptRoot,
    registryRoot,
    attemptId,
    authorizationId: authorization.authorizationId,
    authorizationDigest: authorization.authorizationDigest,
    productCommit: PRODUCT_COMMIT,
    controlCommit: CONTROL_COMMIT,
    deploymentId: DEPLOYMENT_ID,
    productionOrigin: PRODUCTION_ORIGIN,
    releaseTag: RELEASE_TAG,
    releaseRevision: RELEASE_REVISION,
    wrapperDigest: WRAPPER_DIGEST,
    runnerDigest: RUNNER_DIGEST,
    contractDigest: CONTRACT_DIGEST,
    createdAt: now.toISOString(),
  };
  expectCode("ATTEMPT_CREATION_RECOVERY_FAILED", () => createFormalProductionBrowserAttempt({
    ...input,
    faultInjection: "after-authorization-claim",
  }));
  assert.equal(pathExists(path.join(attemptRoot, attemptId)), false);
  const recovered = recoverFormalProductionBrowserAttemptCreation({
    attemptRoot,
    registryRoot,
    authorizationId: authorization.authorizationId,
    expectedControlCommit: CONTROL_COMMIT,
    expectedProductCommit: PRODUCT_COMMIT,
    expectedDeploymentId: DEPLOYMENT_ID,
    expectedReleaseTag: RELEASE_TAG,
    expectedReleaseRevision: RELEASE_REVISION,
    expectedWrapperDigest: WRAPPER_DIGEST,
    expectedRunnerDigest: RUNNER_DIGEST,
    expectedContractDigest: CONTRACT_DIGEST,
  });
  assert.equal(recovered.lease.state, "PREPARED");
  assert.equal(recovered.lease.attemptId, attemptId);
  assert.ok(pathExists(path.join(attemptRoot, attemptId)));
  const cliRecovery = runCli("recover-creation", {
    attemptRoot,
    registryRoot,
    authorizationId: authorization.authorizationId,
    expectedAttemptId: attemptId,
    expectedControlCommit: CONTROL_COMMIT,
    expectedProductCommit: PRODUCT_COMMIT,
  });
  assert.equal(cliRecovery.status, 0, cliRecovery.stderr);
  assert.equal(JSON.parse(cliRecovery.stdout).state, "PREPARED");
  expectCode("AUTHORIZATION_ALREADY_CONSUMED", () => createFormalProductionBrowserAttempt({
    ...input,
    attemptId: generateFormalAttemptId({ now: new Date(now.getTime() + 1_000), random: Buffer.alloc(16, 0x23) }),
    createdAt: new Date(now.getTime() + 1_000).toISOString(),
  }));
});

test("event journal sequence and digest chain verify across a full PASS", () => {
  const fixture = createFixture();
  completePass(fixture);
  const verified = verifyAttemptJournal({ attemptDirectory: fixture.attemptDirectory });
  assert.equal(verified.valid, true);
  assert.deepEqual(verified.events.map((event) => event.sequence), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (let index = 0; index < verified.events.length; index += 1) {
    const event = verified.events[index];
    assert.equal(event.previousEventDigest, index === 0 ? null : verified.events[index - 1].eventDigest);
    const withoutDigest = { ...event };
    delete withoutDigest.eventDigest;
    assert.equal(event.eventDigest, computeFormalAttemptEventDigest(withoutDigest));
  }
});

test("journal sequence gap mutation fails behaviorally", () => {
  const fixture = createFixture();
  passPreflight(fixture);
  rewriteJournal(fixture, (events) => {
    events[1].sequence = 3;
    const withoutDigest = { ...events[1] };
    delete withoutDigest.eventDigest;
    events[1].eventDigest = computeFormalAttemptEventDigest(withoutDigest);
  });
  expectCode("EVENT_SEQUENCE_INVALID", () => verifyAttemptJournal({ attemptDirectory: fixture.attemptDirectory }));
});

test("journal previous digest mutation fails behaviorally", () => {
  const fixture = createFixture();
  passPreflight(fixture);
  rewriteJournal(fixture, (events) => {
    events[1].previousEventDigest = "f".repeat(64);
    const withoutDigest = { ...events[1] };
    delete withoutDigest.eventDigest;
    events[1].eventDigest = computeFormalAttemptEventDigest(withoutDigest);
  });
  expectCode("EVENT_DIGEST_MISMATCH", () => verifyAttemptJournal({ attemptDirectory: fixture.attemptDirectory }));
});

test("projection cannot claim attemptConsumed before LAUNCH_COMMITTED", () => {
  const fixture = createFixture();
  rewriteLiveLease(fixture, (lease) => { lease.attemptConsumed = true; });
  expectCode("LEASE_PROJECTION_INVALID", () => loadAttempt({ attemptDirectory: fixture.attemptDirectory }));
});

test("projection cannot clear attemptConsumed after LAUNCH_COMMITTED", () => {
  const fixture = createFixture();
  passPreflight(fixture);
  transition(fixture, "LAUNCH_COMMITTED");
  rewriteLiveLease(fixture, (lease) => { lease.attemptConsumed = false; });
  expectCode("LEASE_PROJECTION_INVALID", () => loadAttempt({ attemptDirectory: fixture.attemptDirectory }));
});

test("projection cannot claim browserStarted without runnerStarted", () => {
  const fixture = createFixture();
  passPreflight(fixture);
  transition(fixture, "LAUNCH_COMMITTED");
  rewriteLiveLease(fixture, (lease) => {
    lease.browserStarted = true;
    lease.runnerStarted = false;
  });
  expectCode("LEASE_PROJECTION_INVALID", () => loadAttempt({ attemptDirectory: fixture.attemptDirectory }));
});

test("projection cannot claim TERMINAL_PASS without browserStarted", () => {
  const fixture = createFixture();
  completePass(fixture);
  rewriteLiveLease(fixture, (lease) => { lease.browserStarted = false; });
  expectCode("LEASE_PROJECTION_INVALID", () => loadAttempt({ attemptDirectory: fixture.attemptDirectory }));
});

test("runner FAIL can never transition to TERMINAL_PASS", () => {
  const fixture = createFixture();
  launchBrowser(fixture);
  transition(fixture, "RUNNER_COMPLETED", {
    outcome: "FAIL",
    exitCode: 1,
    runnerEvidenceDigest: RUNNER_EVIDENCE_DIGEST,
  });
  transition(fixture, "CLEANUP_COMPLETED", {
    profileCleanupDigest: PROFILE_CLEANUP_DIGEST,
    processCleanupDigest: PROCESS_CLEANUP_DIGEST,
  });
  expectCode("TRANSITION_INVALID", () => transition(fixture, "TERMINAL_PASS"));
});

test("TERMINAL_PASS is forbidden until cleanup completes and terminal is the final event", () => {
  const fixture = createFixture();
  launchBrowser(fixture);
  transition(fixture, "RUNNER_COMPLETED", {
    outcome: "PASS",
    exitCode: 0,
    runnerEvidenceDigest: RUNNER_EVIDENCE_DIGEST,
  });
  expectCode("TRANSITION_INVALID", () => transition(fixture, "TERMINAL_PASS"));
  transition(fixture, "CLEANUP_COMPLETED", {
    profileCleanupDigest: PROFILE_CLEANUP_DIGEST,
    processCleanupDigest: PROCESS_CLEANUP_DIGEST,
  });
  const terminal = transition(fixture, "TERMINAL_PASS").lease;
  assert.equal(terminal.cleanupCompleted, true);
  expectCode("TRANSITION_INVALID", () => transition(fixture, "CLEANUP_COMPLETED", {
    profileCleanupDigest: PROFILE_CLEANUP_DIGEST,
    processCleanupDigest: PROCESS_CLEANUP_DIGEST,
  }));
  const events = verifyAttemptJournal({ attemptDirectory: fixture.attemptDirectory }).events;
  assert.equal(events.at(-1).eventType, "TERMINAL_PASS");
});

test("LAUNCH_COMMITTED is forbidden before preflight binds the runtime receipt", () => {
  const fixture = createFixture();
  expectCode("TRANSITION_INVALID", () => transition(fixture, "LAUNCH_COMMITTED"));
});

test("PREFLIGHT_PASSED rejects a mismatched controller digest", () => {
  const fixture = createFixture();
  expectCode("IDENTITY_MISMATCH", () => transition(fixture, "PREFLIGHT_PASSED", {
    runtimeReceiptDigest: RUNTIME_DIGEST,
    wrapperDigest: "9".repeat(64),
    runnerDigest: RUNNER_DIGEST,
    contractDigest: CONTRACT_DIGEST,
  }));
});

test("PREFLIGHT_FAILED may terminalize a published preflight before launch", () => {
  const fixture = createFixture();
  passPreflight(fixture);
  const lease = transition(fixture, "PREFLIGHT_FAILED", { reasonCode: "WRAPPER_PUBLICATION_FAILED" }).lease;
  assert.equal(lease.state, "PRECHECK_FAILED");
  assert.equal(lease.runtimeReceiptDigest, RUNTIME_DIGEST);
  assert.equal(lease.attemptConsumed, false);
  assert.equal(lease.terminalStatus, "FAIL");
  const second = createFixture();
  passPreflight(second);
  expectCode("EVENT_BODY_INVALID", () => transition(second, "PREFLIGHT_FAILED", {
    reasonCode: "MUST_NOT_CLEAR_BOUND_RECEIPT",
    runtimeReceiptDigest: null,
  }));
});

test("every optional identity binding rejects a mismatch", () => {
  const fixture = createFixture();
  passPreflight(fixture);
  const mutations = {
    expectedAuthorizationId: generateFormalAuthorizationId({
      now: new Date(fixture.baseTime),
      random: Buffer.alloc(16, 0xef),
    }),
    expectedReleaseTag: `${RELEASE_TAG}-wrong`,
    expectedReleaseRevision: `${RELEASE_REVISION}-wrong`,
    expectedRuntimeReceiptDigest: "8".repeat(64),
    expectedWrapperDigest: "8".repeat(64),
    expectedRunnerDigest: "8".repeat(64),
    expectedContractDigest: "8".repeat(64),
  };
  for (const [key, value] of Object.entries(mutations)) {
    expectCode("IDENTITY_MISMATCH", () => loadAttempt({
      attemptDirectory: fixture.attemptDirectory,
      [key]: value,
    }));
  }
});

test("event bodies cannot self-assert projection fields", () => {
  const fixture = createFixture();
  expectCode("EVENT_BODY_INVALID", () => transition(fixture, "PREFLIGHT_FAILED", {
    reasonCode: "NEGATIVE_TEST",
    attemptConsumed: false,
  }));
});

test("BROWSER_STARTED requires the pre-interaction route/context attestations", () => {
  const fixture = createFixture();
  launchRunner(fixture);
  expectCode("EVENT_BODY_INVALID", () => transition(fixture, "BROWSER_STARTED", {
    persistentContextEstablished: true,
    networkRoutesInstalled: false,
    productInteractionStarted: false,
  }));
});

test("RUNNER_COMPLETED and CLEANUP_COMPLETED bind exact evidence digests", () => {
  const fixture = createFixture();
  launchBrowser(fixture);
  expectCode("EVENT_BODY_INVALID", () => transition(fixture, "RUNNER_COMPLETED", {
    outcome: "PASS",
    exitCode: 0,
  }));
  transition(fixture, "RUNNER_COMPLETED", {
    outcome: "PASS",
    exitCode: 0,
    runnerEvidenceDigest: RUNNER_EVIDENCE_DIGEST,
  });
  expectCode("EVENT_BODY_INVALID", () => transition(fixture, "CLEANUP_COMPLETED", {
    profileCleanupDigest: PROFILE_CLEANUP_DIGEST,
  }));
  transition(fixture, "CLEANUP_COMPLETED", {
    profileCleanupDigest: PROFILE_CLEANUP_DIGEST,
    processCleanupDigest: PROCESS_CLEANUP_DIGEST,
  });
  assert.equal(transition(fixture, "TERMINAL_PASS").lease.state, "TERMINAL_PASS");
});

test("BROWSER_STARTED commit failure closes fake context once without navigation", async () => {
  let closeCount = 0;
  let navigationCount = 0;
  const expected = new Error("projection write failed");
  const persistentContext = {
    async close() { closeCount += 1; },
    async navigate() { navigationCount += 1; },
  };
  await assert.rejects(() => commitBrowserStartedOrClose({
    persistentContext,
    async transition() { throw expected; },
  }), (error) => error === expected);
  assert.equal(closeCount, 1);
  assert.equal(navigationCount, 0);
});

test("runner can wait only a bounded time for the wrapper RUNNER_STARTED projection", async () => {
  const fixture = createFixture();
  launchRunner(fixture);
  const ready = await waitForAttemptState({
    attemptDirectory: fixture.attemptDirectory,
    state: "RUNNER_STARTED",
    timeoutMs: 100,
    pollMs: 10,
    expectedAttemptId: fixture.attemptId,
    expectedControlCommit: CONTROL_COMMIT,
    expectedProductCommit: PRODUCT_COMMIT,
  });
  assert.equal(ready.state, "RUNNER_STARTED");
  await expectCodeAsync("ATTEMPT_WAIT_TIMEOUT", () => waitForAttemptState({
    attemptDirectory: fixture.attemptDirectory,
    state: "BROWSER_STARTED",
    timeoutMs: 20,
    pollMs: 10,
  }));
});

test("runner wait refuses a journal event whose projection was not atomically published", async () => {
  const fixture = createFixture();
  expectCode("LEASE_PROJECTION_WRITE_FAILED", () => passPreflight(fixture, {
    faultInjection: "before-projection-replace",
  }));
  await expectCodeAsync("LEASE_PROJECTION_STALE", () => waitForAttemptState({
    attemptDirectory: fixture.attemptDirectory,
    state: "PREFLIGHT_PASSED",
    timeoutMs: 100,
    pollMs: 10,
  }));
});

test("idempotent transition reconciles an externally appended BROWSER_STARTED before appending once", () => {
  const fixture = createFixture();
  launchRunner(fixture);
  expectCode("LEASE_PROJECTION_WRITE_FAILED", () => transition(fixture, "BROWSER_STARTED", {
    persistentContextEstablished: true,
    networkRoutesInstalled: true,
    productInteractionStarted: false,
  }, { faultInjection: "before-projection-replace" }));
  expectCode("LEASE_PROJECTION_STALE", () => loadAttempt({ attemptDirectory: fixture.attemptDirectory }));

  const result = transitionIdempotent(fixture, "RUNNER_COMPLETED", {
    outcome: "PASS",
    exitCode: 0,
    runnerEvidenceDigest: RUNNER_EVIDENCE_DIGEST,
  }, { expectedRevision: 5, expectedState: "BROWSER_STARTED" });
  assert.equal(result.eventAppended, true);
  assert.equal(result.exactSuccessorRecovered, false);
  assert.equal(result.projectionRepaired, true);
  assert.equal(result.lease.revision, 6);
  assert.equal(loadAttempt({ attemptDirectory: fixture.attemptDirectory }).runnerCompleted, true);
  const events = verifyAttemptJournal({ attemptDirectory: fixture.attemptDirectory }).events;
  assert.equal(events.filter(({ eventType }) => eventType === "BROWSER_STARTED").length, 1);
  assert.equal(events.filter(({ eventType }) => eventType === "RUNNER_COMPLETED").length, 1);
});

test("idempotent transition recovers its own projection fault without duplicating the event", () => {
  const fixture = createFixture();
  launchBrowser(fixture);
  const eventBody = {
    outcome: "PASS",
    exitCode: 0,
    runnerEvidenceDigest: RUNNER_EVIDENCE_DIGEST,
  };
  const recovered = transitionIdempotent(fixture, "RUNNER_COMPLETED", eventBody, {
    expectedRevision: 5,
    expectedState: "BROWSER_STARTED",
    faultInjection: "before-projection-replace",
  });
  assert.equal(recovered.eventAppended, true);
  assert.equal(recovered.exactSuccessorRecovered, true);
  assert.equal(recovered.projectionRepaired, true);
  const repeated = transitionIdempotent(fixture, "RUNNER_COMPLETED", eventBody, {
    expectedRevision: 5,
    expectedState: "BROWSER_STARTED",
  });
  assert.equal(repeated.eventAppended, false);
  assert.equal(repeated.exactSuccessorRecovered, true);
  assert.equal(repeated.lease.revision, 6);
  assert.equal(
    verifyAttemptJournal({ attemptDirectory: fixture.attemptDirectory }).events
      .filter(({ eventType }) => eventType === "RUNNER_COMPLETED").length,
    1,
  );
});

test("idempotent transition rejects a concurrent same-state successor with a different event", () => {
  const fixture = createFixture();
  launchBrowser(fixture);
  expectCode("LEASE_PROJECTION_WRITE_FAILED", () => transition(fixture, "CLEANUP_COMPLETED", {
    profileCleanupDigest: PROFILE_CLEANUP_DIGEST,
    processCleanupDigest: PROCESS_CLEANUP_DIGEST,
  }, { faultInjection: "before-projection-replace" }));
  expectCode("IDEMPOTENT_TRANSITION_MISMATCH", () => transitionIdempotent(
    fixture,
    "RUNNER_COMPLETED",
    { outcome: "PASS", exitCode: 0, runnerEvidenceDigest: RUNNER_EVIDENCE_DIGEST },
    { expectedRevision: 5, expectedState: "BROWSER_STARTED" },
  ));
  const verified = verifyAttemptJournal({ attemptDirectory: fixture.attemptDirectory });
  assert.equal(verified.events.at(-1).eventType, "CLEANUP_COMPLETED");
  assert.equal(verified.events.some(({ eventType }) => eventType === "RUNNER_COMPLETED"), false);
  assert.equal(loadAttempt({ attemptDirectory: fixture.attemptDirectory }).revision, 6);
});

test("idempotent transition never repairs or accepts a tampered recovery journal", () => {
  const fixture = createFixture();
  launchBrowser(fixture);
  expectCode("LEASE_PROJECTION_WRITE_FAILED", () => transition(fixture, "RUNNER_COMPLETED", {
    outcome: "PASS",
    exitCode: 0,
    runnerEvidenceDigest: RUNNER_EVIDENCE_DIGEST,
  }, { faultInjection: "before-projection-replace" }));
  rewriteJournal(fixture, (events) => { events.at(-1).eventDigest = "8".repeat(64); });
  expectCode("EVENT_DIGEST_MISMATCH", () => transitionIdempotent(fixture, "RUNNER_COMPLETED", {
    outcome: "PASS",
    exitCode: 0,
    runnerEvidenceDigest: RUNNER_EVIDENCE_DIGEST,
  }, { expectedRevision: 5, expectedState: "BROWSER_STARTED" }));
  const live = JSON.parse(readFileSync(
    path.join(fixture.attemptDirectory, FORMAL_ATTEMPT_FILES.liveLease),
    "utf8",
  ));
  assert.equal(live.revision, 5);
  assert.equal(live.runnerCompleted, false);
});

test("CLI create/transition/verify/recover use stdin JSON and safe bounded summaries", () => {
  fixtureSequence += 1;
  const root = mkdtempSync(path.join(tmpdir(), "novel-rc6-c7-cli-"));
  temporaryRoots.push(root);
  const registryRoot = path.join(root, "secret-registry-path");
  const attemptRoot = path.join(root, "secret-attempt-path");
  const now = new Date("2026-08-12T04:00:00.000Z");
  const authorizationId = generateFormalAuthorizationId({ now, random: Buffer.alloc(16, 0x31) });
  let result = runCli("create-authorization", {
    registryRoot,
    authorizationId,
    authorizedControlCommit: CONTROL_COMMIT,
    authorizedProductCommit: PRODUCT_COMMIT,
    authorizedDeploymentId: DEPLOYMENT_ID,
    authorizedAt: now.toISOString(),
  });
  assert.equal(result.status, 0, result.stderr);
  const authorizationSummary = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(authorizationSummary).sort(),
    ["authorizationDigest", "authorizationId", "maxFormalAttempts"].sort());
  result = runCli("read-authorization", { registryRoot, authorizationId });
  assert.equal(result.status, 0, result.stderr);
  const readSummary = JSON.parse(result.stdout);
  assert.deepEqual(readSummary, {
    authorizationId,
    authorizationDigest: authorizationSummary.authorizationDigest,
    authorizedControlCommit: CONTROL_COMMIT,
    authorizedProductCommit: PRODUCT_COMMIT,
    authorizedDeploymentId: DEPLOYMENT_ID,
    maxFormalAttempts: 1,
  });
  const attemptId = generateFormalAttemptId({ now, random: Buffer.alloc(16, 0x32) });
  result = runCli("create-attempt", {
    attemptRoot,
    registryRoot,
    attemptId,
    authorizationId,
    authorizationDigest: authorizationSummary.authorizationDigest,
    productCommit: PRODUCT_COMMIT,
    controlCommit: CONTROL_COMMIT,
    deploymentId: DEPLOYMENT_ID,
    productionOrigin: PRODUCTION_ORIGIN,
    releaseTag: RELEASE_TAG,
    releaseRevision: RELEASE_REVISION,
    wrapperDigest: WRAPPER_DIGEST,
    runnerDigest: RUNNER_DIGEST,
    contractDigest: CONTRACT_DIGEST,
    createdAt: now.toISOString(),
  });
  assert.equal(result.status, 0, result.stderr);
  const attemptDirectory = path.join(attemptRoot, attemptId);
  assert.equal(JSON.parse(result.stdout).state, "PREPARED");
  assert.ok(!result.stdout.includes(root));
  result = runCli("transition-idempotent", {
    attemptDirectory,
    eventType: "PREFLIGHT_PASSED",
    eventBody: {
      runtimeReceiptDigest: RUNTIME_DIGEST,
      wrapperDigest: WRAPPER_DIGEST,
      runnerDigest: RUNNER_DIGEST,
      contractDigest: CONTRACT_DIGEST,
    },
    occurredAt: new Date(now.getTime() + 1_000).toISOString(),
    expectedRevision: 1,
    expectedState: "PREPARED",
  });
  assert.equal(result.status, 0, result.stderr);
  const transitionSummary = JSON.parse(result.stdout);
  assert.equal(transitionSummary.state, "PREFLIGHT_PASSED");
  assert.equal(transitionSummary.eventAppended, true);
  assert.equal(transitionSummary.exactSuccessorRecovered, false);
  assert.equal(transitionSummary.projectionRepaired, false);
  result = runCli("verify", { attemptDirectory, expectedAttemptId: attemptId });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).eventCount, 2);
  const initial = readFileSync(path.join(attemptDirectory, FORMAL_ATTEMPT_FILES.initialLease), "utf8");
  writeFileSync(path.join(attemptDirectory, FORMAL_ATTEMPT_FILES.liveLease), initial, "utf8");
  result = runCli("recover", { attemptDirectory, expectedAttemptId: attemptId });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).recovered, true);
  result = runCli("transition", {
    attemptDirectory,
    eventType: "LAUNCH_COMMITTED",
    expectedRevision: 1,
    expectedState: "PREFLIGHT_PASSED",
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "REVISION_MISMATCH\n");
  assert.ok(!result.stderr.includes(root));
});

test("CLI rejects oversized or malformed input with finite error codes", () => {
  let result = spawnSync(process.execPath, [STATE_MODULE, "verify"], {
    input: `{"padding":"${"x".repeat(70_000)}"}`,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "CLI_INPUT_TOO_LARGE\n");
  result = spawnSync(process.execPath, [STATE_MODULE, "unknown"], {
    input: "{}",
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "CLI_COMMAND_INVALID\n");
});

let passed = 0;
const failures = [];
try {
  const requestedMode = process.argv[2] ?? "all";
  if (requestedMode !== "all") throw new Error(`unsupported test mode: ${requestedMode}`);
  for (const { name, operation } of tests) {
    try {
      await operation();
      passed += 1;
      process.stdout.write(`PASS ${name}\n`);
    } catch (error) {
      failures.push({ name, error });
      process.stderr.write(`FAIL ${name}: ${error instanceof Error ? error.stack : String(error)}\n`);
    }
  }
} finally {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
}

const summary = {
  schemaVersion: "1",
  suite: "P2.4B_RC6_2_C7_FORMAL_ATTEMPT_STATE_MACHINE",
  total: tests.length,
  passed,
  failed: failures.length,
  blockingSkipped: 0,
  stateMachineScenarioCount: scenarioNames.size,
  stateMachineScenarios: [...scenarioNames].sort(),
};
process.stdout.write(`${JSON.stringify(summary)}\n`);
if (failures.length > 0) process.exitCode = 1;

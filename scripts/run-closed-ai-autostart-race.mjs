import assert from "node:assert/strict";

import { raceClosedAiAutostartRoutes } from "../lib/novel-ai/web/closed-ai-autostart-race.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function ready(id) {
  return { id, routable: true };
}

function notReady(id) {
  return { id, routable: false };
}

const isRoutable = (result) => Boolean(result?.routable);

async function assertStillPending(promise) {
  const marker = Symbol("pending");
  const observed = await Promise.race([
    promise.then(() => "settled"),
    new Promise((resolve) => setTimeout(() => resolve(marker), 10)),
  ]);
  assert.equal(observed, marker);
}

async function testLocalFirst() {
  const browser = deferred();
  const controller = new AbortController();
  const outcome = await raceClosedAiAutostartRoutes({
    browserBootstrap: browser.promise,
    localConnection: Promise.resolve(),
    inspectAfterLocal: async () => ready("local"),
    isRoutable,
    signal: controller.signal,
  });
  assert.equal(outcome?.winner, "local");
  assert.equal(outcome?.result?.id, "local");
  browser.resolve(ready("browser-late"));
}

async function testBrowserFirst() {
  const local = deferred();
  const controller = new AbortController();
  let localInspections = 0;
  const outcome = await raceClosedAiAutostartRoutes({
    browserBootstrap: Promise.resolve(ready("browser")),
    localConnection: local.promise,
    inspectAfterLocal: async () => {
      localInspections += 1;
      return ready("local-late");
    },
    isRoutable,
    signal: controller.signal,
  });
  assert.equal(outcome?.winner, "browser");
  assert.equal(outcome?.result?.id, "browser");
  assert.equal(localInspections, 0);
  local.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(localInspections, 0);
}

async function testFirstFailureDoesNotMaskSecondReady() {
  const local = deferred();
  const controller = new AbortController();
  const race = raceClosedAiAutostartRoutes({
    browserBootstrap: Promise.reject(Object.assign(new Error("browser failed"), {
      code: "BROWSER_GENERATIVE_VERIFICATION_REQUIRED",
    })),
    localConnection: local.promise,
    inspectAfterLocal: async () => ready("local-after-browser-failure"),
    isRoutable,
    signal: controller.signal,
  });
  await assertStillPending(race);
  local.resolve();
  const outcome = await race;
  assert.equal(outcome?.winner, "local");
  assert.equal(outcome?.result?.id, "local-after-browser-failure");
  assert.equal(outcome?.error, null);
}

async function testFirstNonRoutableDoesNotMaskSecondReady() {
  const local = deferred();
  const controller = new AbortController();
  const race = raceClosedAiAutostartRoutes({
    browserBootstrap: Promise.resolve(notReady("browser-not-ready")),
    localConnection: local.promise,
    inspectAfterLocal: async () => ready("local-after-browser-not-ready"),
    isRoutable,
    signal: controller.signal,
  });
  await assertStillPending(race);
  local.resolve();
  const outcome = await race;
  assert.equal(outcome?.winner, "local");
  assert.equal(outcome?.result?.id, "local-after-browser-not-ready");
}

async function testBothFailPrefersActionableLocalTimeout() {
  const local = deferred();
  const controller = new AbortController();
  const localTimeout = Object.assign(new Error("local timed out"), {
    code: "REQUEST_TIMEOUT",
  });
  const race = raceClosedAiAutostartRoutes({
    browserBootstrap: Promise.reject(new Error("browser failed")),
    localConnection: local.promise,
    inspectAfterLocal: async () => {
      throw new Error("must not inspect a failed connection");
    },
    isRoutable,
    signal: controller.signal,
  });
  await assertStillPending(race);
  local.reject(localTimeout);
  const outcome = await race;
  assert.equal(outcome?.winner, null);
  assert.equal(outcome?.result, null);
  assert.equal(outcome?.error, localTimeout);
}

async function testPendingBrowserDeadlinePreservesLocalTimeout() {
  const browser = deferred();
  const controller = new AbortController();
  const localTimeout = Object.assign(new Error("local timed out"), {
    code: "REQUEST_TIMEOUT",
  });
  const outcome = await raceClosedAiAutostartRoutes({
    browserBootstrap: browser.promise,
    localConnection: Promise.reject(localTimeout),
    inspectAfterLocal: async () => ready("must-not-inspect"),
    isRoutable,
    signal: controller.signal,
    timeoutMs: 15,
  });
  assert.equal(outcome?.winner, null);
  assert.equal(outcome?.result, null);
  assert.equal(outcome?.error, localTimeout);
  browser.resolve(ready("browser-after-deadline"));
}

async function testPendingBrowserDeadlinePreservesLocalNonTimeoutFailure() {
  const browser = deferred();
  const controller = new AbortController();
  const localUnavailable = Object.assign(new Error("local unavailable"), {
    code: "BRIDGE_PROCESS_UNREACHABLE",
  });
  const outcome = await raceClosedAiAutostartRoutes({
    browserBootstrap: browser.promise,
    localConnection: Promise.reject(localUnavailable),
    inspectAfterLocal: async () => ready("must-not-inspect"),
    isRoutable,
    signal: controller.signal,
    timeoutMs: 15,
  });
  assert.equal(outcome?.winner, null);
  assert.equal(outcome?.result, null);
  assert.equal(outcome?.error, localUnavailable);
  browser.resolve(ready("browser-after-deadline"));
}

async function testDeadlineWithoutKnownFailureCreatesExplicitTimeout() {
  const browser = deferred();
  const local = deferred();
  const controller = new AbortController();
  const outcome = await raceClosedAiAutostartRoutes({
    browserBootstrap: browser.promise,
    localConnection: local.promise,
    inspectAfterLocal: async () => ready("must-not-inspect"),
    isRoutable,
    signal: controller.signal,
    timeoutMs: 15,
  });
  assert.equal(outcome?.winner, null);
  assert.equal(outcome?.result, null);
  assert.equal(outcome?.error?.code, "REQUEST_TIMEOUT");
  browser.resolve(ready("browser-after-deadline"));
  local.resolve();
}

async function testAbortDoesNotCommitStaleState() {
  const browser = deferred();
  const local = deferred();
  const controller = new AbortController();
  let localInspections = 0;
  let stateWrites = 0;
  const race = raceClosedAiAutostartRoutes({
    browserBootstrap: browser.promise,
    localConnection: local.promise,
    inspectAfterLocal: async () => {
      localInspections += 1;
      return ready("stale-local");
    },
    isRoutable,
    signal: controller.signal,
  }).then((outcome) => {
    if (outcome && !controller.signal.aborted) stateWrites += 1;
    return outcome;
  });
  controller.abort("UNMOUNTED");
  assert.equal(await race, null);
  browser.resolve(ready("stale-browser"));
  local.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(localInspections, 0);
  assert.equal(stateWrites, 0);
}

await testLocalFirst();
await testBrowserFirst();
await testFirstFailureDoesNotMaskSecondReady();
await testFirstNonRoutableDoesNotMaskSecondReady();
await testBothFailPrefersActionableLocalTimeout();
await testPendingBrowserDeadlinePreservesLocalTimeout();
await testPendingBrowserDeadlinePreservesLocalNonTimeoutFailure();
await testDeadlineWithoutKnownFailureCreatesExplicitTimeout();
await testAbortDoesNotCommitStaleState();

console.log(JSON.stringify({
  schemaVersion: "closed-ai-autostart-race-test-v1",
  status: "PASS",
  scenarios: [
    "local-first",
    "browser-first",
    "first-failure-second-ready",
    "first-non-routable-second-ready",
    "both-fail-local-timeout",
    "pending-browser-deadline-preserves-local-timeout",
    "pending-browser-deadline-preserves-local-non-timeout",
    "deadline-without-known-failure-is-timeout",
    "unmount-no-stale-state",
  ],
}, null, 2));

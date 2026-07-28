import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import path from "node:path";
import {
  runBrowserLossSmoke,
  waitForOperator,
} from "../../scripts/r5-2-desktop/local-cdp-adapter.mjs";
import {
  correlateBridgeTraffic,
  validateBrowserLiveness,
} from "../../scripts/r5-2-desktop/browser-liveness.mjs";

const artifactDirectory = path.resolve("artifacts/closed-ai-phase1-1r5-2r1h");
await mkdir(artifactDirectory, { recursive: true });
const results = [];
const evidence = {
  staleContinue: null,
  bridgeCorrelation: null,
};
async function test(name, operation) {
  try {
    await operation();
    results.push({ name, status: "PASS" });
  } catch (error) {
    results.push({ name, status: "FAIL", error: error.message, errorCode: error.code || null });
  }
}

const expected = {
  browserPid: 42,
  profilePath: "C:\\test\\chrome-grant",
  previewUrl: "https://preview.example/studio/settings/ai",
  origin: "https://preview.example",
};
const alive = {
  harnessPid: 7,
  harnessProcessAlive: true,
  browserPid: 42,
  browserProcessAlive: true,
  executableIdentityMatches: true,
  sessionMatches: true,
  userMatches: true,
  profilePath: expected.profilePath,
  profileMatches: true,
  commandLineCompliant: true,
  controlChannelResponsive: true,
  cdpIdentityMatches: true,
  browserContextConnected: true,
  previewPageOpen: true,
  previewUrl: expected.previewUrl,
  previewUrlExact: true,
  visibleWindowPresent: true,
  bridgeProcessAlive: true,
  bridgeLoopbackOnly: true,
  originEnrolled: true,
  enrolledOrigin: expected.origin,
};

await test("healthy operator state passes", () => {
  assert.equal(validateBrowserLiveness(alive, expected).status, "ALIVE");
});

for (const scenario of [
  ["browser process disappears", { browserProcessAlive: false, browserPid: null }, "BROWSER_PROCESS_LOST_DURING_OPERATOR_WAIT"],
  ["browser process replacement is rejected", { browserPid: 99 }, "BROWSER_PROCESS_LOST_DURING_OPERATOR_WAIT"],
  ["browser identity change is rejected", { executableIdentityMatches: false }, "BROWSER_PROCESS_LOST_DURING_OPERATOR_WAIT"],
  ["browser session mismatch is rejected", { sessionMatches: false }, "BROWSER_PROCESS_LOST_DURING_OPERATOR_WAIT"],
  ["browser user mismatch is rejected", { userMatches: false }, "BROWSER_PROCESS_LOST_DURING_OPERATOR_WAIT"],
  ["profile mismatch is rejected", { profileMatches: false }, "BROWSER_PROFILE_MISMATCH_DURING_OPERATOR_WAIT"],
  ["CDP loss is rejected", { controlChannelResponsive: false }, "BROWSER_CONTROL_CHANNEL_LOST_DURING_OPERATOR_WAIT"],
  ["CDP identity mismatch is rejected", { cdpIdentityMatches: false }, "BROWSER_CONTROL_CHANNEL_LOST_DURING_OPERATOR_WAIT"],
  ["Preview page loss is rejected", { previewPageOpen: false }, "PREVIEW_PAGE_LOST_DURING_OPERATOR_WAIT"],
  ["Preview URL change is rejected", { previewUrlExact: false, previewUrl: "https://preview.example/other" }, "PREVIEW_URL_CHANGED_DURING_OPERATOR_WAIT"],
  ["visible window loss is rejected", { visibleWindowPresent: false }, "VISIBLE_BROWSER_WINDOW_LOST_DURING_OPERATOR_WAIT"],
  ["Bridge loss is rejected", { bridgeProcessAlive: false }, "BRIDGE_PROCESS_LOST_DURING_OPERATOR_WAIT"],
  ["non-loopback Bridge is rejected", { bridgeLoopbackOnly: false }, "BRIDGE_PROCESS_LOST_DURING_OPERATOR_WAIT"],
  ["origin enrollment loss is rejected", { originEnrolled: false, enrolledOrigin: null }, "ORIGIN_ENROLLMENT_LOST_DURING_OPERATOR_WAIT"],
]) {
  await test(scenario[0], () => {
    assert.throws(() => validateBrowserLiveness({ ...alive, ...scenario[1] }, expected), { code: scenario[2] });
  });
}

await test("browser loss exits WAITING_FOR_OPERATOR with NOT operator-abort", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let probes = 0;
  const waiting = waitForOperator("chrome", "grant", expected.origin, "browser-loss", {
    inputStream: input,
    outputStream: output,
    testMode: true,
    heartbeatMs: 5,
    expectedLiveness: expected,
    livenessProbe: async () => (++probes === 1 ? alive : { ...alive, browserProcessAlive: false, browserPid: null }),
  });
  await assert.rejects(waiting, (error) => {
    assert.equal(error.code, "BROWSER_PROCESS_LOST_DURING_OPERATOR_WAIT");
    assert.notEqual(error.code, "ABORTED_BY_OPERATOR");
    return true;
  });
});

await test("stale CONTINUE is rejected after browser loss", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let probes = 0;
  const waiting = waitForOperator("chrome", "grant", expected.origin, "stale-continue", {
    inputStream: input,
    outputStream: output,
    testMode: true,
    heartbeatMs: 10_000,
    challenges: { operatorChallenge: "ABORT123", decisionChallenge: "GO123" },
    expectedLiveness: expected,
    livenessProbe: async () => (++probes === 1 ? alive : { ...alive, browserProcessAlive: false, browserPid: null }),
  });
  setTimeout(() => input.write("CONTINUE GO123\n"), 5);
  await assert.rejects(waiting, (error) => {
    assert.equal(error.code, "OPERATOR_CONTINUE_REJECTED_STALE_BROWSER_STATE");
    assert.equal(error.livenessFailureCode, "BROWSER_PROCESS_LOST_DURING_OPERATOR_WAIT");
    evidence.staleContinue = {
      status: "PASS",
      submittedCommand: "CONTINUE GO123",
      errorCode: error.code,
      livenessFailureCode: error.livenessFailureCode,
      reusableForAcceptance: false,
    };
    return true;
  });
});

await test("Bridge traffic correlation requires live browser and exact UI window", () => {
  const runStartedAt = "2026-07-20T00:00:00.000Z";
  const runEndedAt = "2026-07-20T00:01:00.000Z";
  const row = {
    request_received: true,
    timestamp: "2026-07-20T00:00:30.000Z",
    origin: expected.origin,
    user_agent: "Mozilla/5.0 Chrome/150.0.0.0",
    host: "127.0.0.1:3217",
  };
  const context = {
    runStartedAt,
    runEndedAt,
    origin: expected.origin,
    userAgentToken: "Chrome/",
    browserAliveAtRequest: true,
    controlChannelConnectedAtRequest: true,
    previewPageOpenAtRequest: true,
    uiActionAt: "2026-07-20T00:00:29.000Z",
  };
  const live = correlateBridgeTraffic(row, context);
  const browserLost = correlateBridgeTraffic(row, { ...context, browserAliveAtRequest: false });
  const wrongOrigin = correlateBridgeTraffic({ ...row, origin: "https://wrong.example" }, context);
  assert.equal(live.correlated, true);
  assert.equal(browserLost.correlated, false);
  assert.equal(wrongOrigin.correlated, false);
  evidence.bridgeCorrelation = { status: "PASS", live, browserLost, wrongOrigin };
});

for (const browser of ["chrome", "edge"]) {
  await test(`${browser} real sandbox browser-loss smoke`, async () => {
    const smoke = await runBrowserLossSmoke({
      browser,
      profilePath: path.join(artifactDirectory, "browser-loss-profiles", browser),
      artifactDirectory,
    });
    assert.equal(smoke.status, "PASS");
    assert.equal(smoke.failureStatus, "NOT_TESTED");
    assert.equal(smoke.failureCode, "BROWSER_PROCESS_LOST_DURING_OPERATOR_WAIT");
    assert.equal(smoke.reusableForAcceptance, false);
    assert.equal(smoke.debugPortReleased, true);
    await writeFile(path.join(artifactDirectory, `${browser}-browser-loss-smoke.json`), `${JSON.stringify(smoke, null, 2)}\n`, "utf8");
  });
}

const failed = results.filter((result) => result.status === "FAIL");
const report = { suite: "r5-2r1h-browser-liveness", pass: results.length - failed.length, fail: failed.length, results };
await writeFile(path.join(artifactDirectory, "browser-liveness-contract.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(path.join(artifactDirectory, "heartbeat-state-schema.json"), `${JSON.stringify({
  schemaVersion: "r5-2r1h-heartbeat-v1",
  intervalMs: 30_000,
  required: [
    "harnessProcessAlive", "browserPid", "browserProcessAlive", "executableIdentityMatches",
    "sessionMatches", "userMatches", "profileMatches", "commandLineCompliant",
    "controlChannelResponsive", "cdpIdentityMatches", "browserContextConnected",
    "previewPageOpen", "previewUrlExact", "visibleWindowPresent", "bridgeProcessAlive",
    "bridgeLoopbackOnly", "originEnrolled",
  ],
  failureStatus: "NOT_TESTED",
  reusableForAcceptance: false,
}, null, 2)}\n`, "utf8");
await writeFile(path.join(artifactDirectory, "stale-continue-rejection.json"), `${JSON.stringify(evidence.staleContinue, null, 2)}\n`, "utf8");
await writeFile(path.join(artifactDirectory, "bridge-traffic-correlation-tests.json"), `${JSON.stringify(evidence.bridgeCorrelation, null, 2)}\n`, "utf8");
await writeFile(path.join(artifactDirectory, "cleanup-tests.json"), `${JSON.stringify({
  status: failed.length === 0 ? "PASS" : "FAIL",
  chromeDebugPortReleased: results.find((result) => result.name === "chrome real sandbox browser-loss smoke")?.status === "PASS",
  edgeDebugPortReleased: results.find((result) => result.name === "edge real sandbox browser-loss smoke")?.status === "PASS",
  profileAutoRestarted: false,
  acceptanceRunStarted: false,
}, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failed.length) process.exitCode = 1;

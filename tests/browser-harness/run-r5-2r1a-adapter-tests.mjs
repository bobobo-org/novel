import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  FORBIDDEN_BROWSER_ARGS,
  assertSafeBrowserArgs,
  classifyChannelError,
  parseArgs,
  reserveLoopbackPort,
  validateIdentity,
  validateProfilePath,
} from "../../scripts/r5-2-desktop/local-cdp-adapter.mjs";

const results = [];
async function test(name, operation) {
  try {
    await operation();
    results.push({ name, status: "PASS" });
  } catch (error) {
    results.push({ name, status: "FAIL", error: error.message });
  }
}

await test("argument parser", () => {
  assert.deepEqual(parseArgs(["--browser", "chrome", "--flow", "grant"]), { browser: "chrome", flow: "grant" });
});

await test("forbidden browser arguments rejected", () => {
  for (const argument of FORBIDDEN_BROWSER_ARGS) {
    assert.throws(() => assertSafeBrowserArgs([argument]), { code: "FORBIDDEN_BROWSER_ARGUMENT" });
  }
});

await test("safe CDP arguments accepted", () => {
  assert.equal(assertSafeBrowserArgs(["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=49152", "--no-first-run"]), true);
});

await test("Chrome default profile rejected", () => {
  assert.throws(() => validateProfilePath("C:\\Users\\user\\AppData\\Local\\Google\\Chrome\\User Data", "chrome"), { code: "DEFAULT_PROFILE_REJECTED" });
});

await test("Edge default profile rejected", () => {
  assert.throws(() => validateProfilePath("C:\\Users\\user\\AppData\\Local\\Microsoft\\Edge\\User Data", "edge"), { code: "DEFAULT_PROFILE_REJECTED" });
});

await test("dedicated profile accepted", () => {
  assert.equal(validateProfilePath("C:\\dev\\evidence\\browser-profiles\\chrome-grant", "chrome"), path.resolve("C:\\dev\\evidence\\browser-profiles\\chrome-grant"));
});

await test("loopback ephemeral port reservation", async () => {
  const first = await reserveLoopbackPort();
  const second = await reserveLoopbackPort();
  assert.ok(first > 0 && second > 0);
  assert.notEqual(first, second);
});

await test("Chrome identity validation", () => {
  assert.equal(validateIdentity("chrome", { cdpProduct: "Chrome/150.0.0.0", executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" }), true);
});

await test("Edge identity validation", () => {
  assert.equal(validateIdentity("edge", { cdpProduct: "Edg/150.0.0.0", executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" }), true);
});

await test("identity mismatch rejected", () => {
  assert.throws(() => validateIdentity("chrome", { cdpProduct: "Chromium/150", executablePath: "chrome.exe" }), { code: "BROWSER_IDENTITY_MISMATCH" });
});

await test("channel errors classified", () => {
  assert.equal(classifyChannelError(new Error("Executable doesn't exist")), "CHANNEL_BINARY_NOT_FOUND");
  assert.equal(classifyChannelError(new Error("SingletonLock profile error")), "CHANNEL_PROFILE_LOCKED");
  assert.equal(classifyChannelError(new Error("Browser process exited")), "CHANNEL_PROCESS_EXITED");
});

const runner = await readFile(new URL("../../scripts/run-r5-2r1a-real-browser.ps1", import.meta.url), "utf8");
const adapter = await readFile(new URL("../../scripts/r5-2-desktop/local-cdp-adapter.mjs", import.meta.url), "utf8");

await test("Bridge starts before browser adapter", () => {
  assert.ok(runner.indexOf('Invoke-Launcher @("start"') < runner.indexOf("& powershell -NoProfile"));
});

await test("origin enrollment precedes Bridge start", () => {
  assert.ok(runner.indexOf('Invoke-Launcher @("origin", "add"') < runner.indexOf('Invoke-Launcher @("start"'));
});

await test("human LNA pause requires CONTINUE", () => {
  assert.match(adapter, /WAITING_FOR_HUMAN_LNA_DECISION/);
  assert.match(adapter, /trim\(\) !== "CONTINUE"/);
  assert.match(adapter, /ABORTED_BY_OPERATOR/);
});

await test("channel attempted before CDP fallback", () => {
  assert.ok(adapter.indexOf("await launchChannel") < adapter.indexOf("await launchCdp"));
});

await test("run evidence has SHA-256 manifest", () => {
  assert.match(adapter, /sha256-manifest\.json/);
  assert.match(adapter, /createHash\("sha256"\)/);
  assert.match(runner, /Write-RunHashManifest \$runDirectory \$run\.run_id/);
  assert.ok(runner.indexOf('Write-Json "runs/\$\(\$run\.run_id\)/bridge-access\.json"') < runner.indexOf("Write-RunHashManifest $runDirectory $run.run_id"));
});

await test("four isolated flow profiles declared", () => {
  for (const value of ["chrome-grant", "chrome-deny", "edge-grant", "edge-deny"]) assert.match(runner, new RegExp(value));
});

const failed = results.filter((result) => result.status === "FAIL");
process.stdout.write(`${JSON.stringify({ suite: "r5-2r1a-local-cdp-adapter", pass: results.length - failed.length, fail: failed.length, results }, null, 2)}\n`);
if (failed.length) process.exitCode = 1;

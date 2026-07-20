import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import {
  FORBIDDEN_BROWSER_ARGS,
  assertSafeBrowserArgs,
  auditActualBrowserCommandLine,
  createOperatorChallenges,
  findForbiddenBrowserArguments,
  parseOperatorCommand,
  waitForOperator,
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

await test("all forbidden arguments are rejected statically", () => {
  for (const argument of FORBIDDEN_BROWSER_ARGS) {
    assert.throws(() => assertSafeBrowserArgs([argument]), { code: "FORBIDDEN_BROWSER_ARGUMENT" });
  }
});

await test("forbidden features are detected inside an aggregate switch", () => {
  assert.deepEqual(
    findForbiddenBrowserArguments("chrome.exe --disable-features=Translate,LocalNetworkAccessChecks,MediaRouter"),
    ["--disable-features=localnetworkaccesschecks"],
  );
});

await test("safe browser command line passes runtime audit", () => {
  const audit = auditActualBrowserCommandLine([{ pid: 1, commandLine: "chrome.exe --user-data-dir=C:\\test --no-first-run" }]);
  assert.equal(audit.status, "PASS");
  assert.equal(audit.forbiddenArgumentCount, 0);
});

await test("runtime audit fails closed on no-sandbox", () => {
  assert.throws(
    () => auditActualBrowserCommandLine([{ pid: 1, commandLine: "chrome.exe --no-sandbox" }]),
    { code: "BROWSER_SECURITY_ARGUMENT_DETECTED" },
  );
});

await test("runtime audit fails when command line evidence is unavailable", () => {
  assert.throws(() => auditActualBrowserCommandLine([]), { code: "BROWSER_COMMAND_LINE_UNAVAILABLE" });
});

await test("operator challenges are unique", () => {
  const first = createOperatorChallenges();
  const second = createOperatorChallenges();
  assert.notEqual(first.operatorChallenge, second.operatorChallenge);
  assert.notEqual(first.decisionChallenge, second.decisionChallenge);
});

await test("operator continue requires the decision challenge", () => {
  const challenges = { operatorChallenge: "ABORT123", decisionChallenge: "GO123" };
  assert.equal(parseOperatorCommand("CONTINUE GO123", challenges), "CONTINUE");
  assert.equal(parseOperatorCommand("CONTINUE", challenges), "INVALID");
  assert.equal(parseOperatorCommand("CONTINUE ABORT123", challenges), "INVALID");
});

await test("operator abort requires the operator challenge", () => {
  const challenges = { operatorChallenge: "ABORT123", decisionChallenge: "GO123" };
  assert.equal(parseOperatorCommand("ABORT ABORT123", challenges), "ABORT");
  assert.equal(parseOperatorCommand("ABORT", challenges), "INVALID");
});

await test("operator heartbeat continues until challenged abort", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let transcript = "";
  output.on("data", (chunk) => { transcript += chunk.toString(); });
  const waiting = waitForOperator("chrome", "grant", "https://preview.example", "run-heartbeat", {
    inputStream: input,
    outputStream: output,
    testMode: true,
    heartbeatMs: 5,
    challenges: { operatorChallenge: "ABORT123", decisionChallenge: "GO123" },
  });
  await new Promise((resolve) => setTimeout(resolve, 16));
  input.write("ABORT ABORT123\n");
  await assert.rejects(waiting, { code: "ABORTED_BY_OPERATOR" });
  assert.ok((transcript.match(/WAITING_FOR_OPERATOR/g) || []).length >= 2);
});

await test("operator terminal absence fails closed", async () => {
  await assert.rejects(
    waitForOperator("edge", "deny", "https://preview.example", "run-unavailable", {
      inputStream: new PassThrough(),
      outputStream: new PassThrough(),
    }),
    { code: "ABORTED_OPERATOR_UNAVAILABLE" },
  );
});

const adapter = await readFile(new URL("../../scripts/r5-2-desktop/local-cdp-adapter.mjs", import.meta.url), "utf8");

await test("Playwright channel explicitly enables Chromium sandbox", () => {
  assert.match(adapter, /chromiumSandbox:\s*true/);
  assert.doesNotMatch(adapter, /chromiumSandbox:\s*false/);
});

await test("Playwright default sandbox disabling switches are removed", () => {
  assert.match(adapter, /ignoreDefaultArgs:\s*\[[^\]]*"--no-sandbox"[^\]]*"--disable-setuid-sandbox"/s);
  assert.match(adapter, /ignoreDefaultArgs:\s*\[[^\]]*"--unsafely-disable-devtools-self-xss-warnings"/s);
  assert.doesNotMatch(adapter, /ignoreDefaultArgs:\s*true/);
});

await test("operator gate has heartbeat and no automatic timeout", () => {
  assert.match(adapter, /options\.heartbeatMs \|\| 30_000/);
  assert.doesNotMatch(adapter, /Operator timed out/);
  assert.match(adapter, /ABORTED_OPERATOR_UNAVAILABLE/);
});

await test("actual command line is audited before Preview navigation", () => {
  assert.ok(adapter.indexOf("auditActualBrowserCommandLine(processEvidence)") < adapter.indexOf("page.goto(options.targetUrl"));
});

const failed = results.filter((result) => result.status === "FAIL");
process.stdout.write(`${JSON.stringify({ suite: "r5-2r1d-sandbox-hardening", pass: results.length - failed.length, fail: failed.length, results }, null, 2)}\n`);
if (failed.length) process.exitCode = 1;

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TERMINAL_EMERGENCY_FILE,
  TERMINAL_EVIDENCE_FILES,
  TERMINAL_MANIFEST_FILE,
  TERMINAL_MANIFEST_SCHEMA,
  TERMINAL_MANIFEST_SHA_FILE,
  TerminalEvidenceError,
  computeFormalAttemptEventDigest,
  computeFormalAttemptLeaseDigest,
  finalizeFormalProductionBrowserTerminalEvidence,
  sha256Hex,
  simulateFormalProductionBrowserTerminalEvidence,
  stableStringify,
  validateFormalProductionBrowserTerminalEvidence,
} from "./rc6-2-terminal-evidence.mjs";

const CONTROL_COMMIT = "b326c2fc9925798ffbc750ae37db847f0c8b5625";
const TEST_ROOT_PREFIX = "novel-rc6-2-terminal-tests-";
const MODULE_PATH = fileURLToPath(new URL("./rc6-2-terminal-evidence.mjs", import.meta.url));
const MODE = process.argv[2] ?? "all";
const ALLOWED_MODES = new Set(["all", "mutations", "simulations"]);
if (!ALLOWED_MODES.has(MODE)) throw new Error("TERMINAL_EVIDENCE_TEST_MODE_INVALID");
const tests = [];
const mutationResults = [];

function test(name, callback, modes = []) {
  tests.push({ name, callback, modes: new Set(modes) });
}

function canonical(value) {
  return stableStringify(value);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function redigestLease(lease) {
  const body = { ...lease };
  delete body.leaseDigest;
  return { ...body, leaseDigest: computeFormalAttemptLeaseDigest(body) };
}

function redigestEvent(event) {
  const body = { ...event };
  delete body.eventDigest;
  return { ...body, eventDigest: computeFormalAttemptEventDigest(body) };
}

async function readJournal(path) {
  return (await readFile(path, "utf8")).trimEnd().split("\n").map(JSON.parse);
}

async function writeJournal(path, events) {
  await writeFile(path, `${events.map(canonical).join("\n")}\n`, "utf8");
}

async function rewriteManifest(bundleDirectory, mutate) {
  const manifestPath = join(bundleDirectory, TERMINAL_MANIFEST_FILE);
  const manifest = await readJson(manifestPath);
  mutate(manifest);
  const body = { ...manifest };
  delete body.manifestBodyDigest;
  manifest.manifestBodyDigest = createHash("sha256")
    .update(`${TERMINAL_MANIFEST_SCHEMA}\n${canonical(body)}`)
    .digest("hex");
  const bytes = Buffer.from(canonical(manifest), "utf8");
  await writeFile(manifestPath, bytes);
  await writeFile(join(bundleDirectory, TERMINAL_MANIFEST_SHA_FILE), `${sha256Hex(bytes)}\n`, "ascii");
}

async function replaceProjection(bundleDirectory, path, mutate) {
  const fullPath = join(bundleDirectory, path);
  const projection = await readJson(fullPath);
  mutate(projection);
  const bytes = Buffer.from(canonical(projection), "utf8");
  await writeFile(fullPath, bytes);
  await rewriteManifest(bundleDirectory, (manifest) => {
    const record = manifest.files.find((candidate) => candidate.path === path);
    assert.ok(record, `manifest record missing: ${path}`);
    record.bytes = bytes.length;
    record.sha256 = sha256Hex(bytes);
  });
}

async function cloneBundle(sourceDirectory, parent, label) {
  const attemptDirectory = join(parent, label);
  await mkdir(attemptDirectory, { recursive: false });
  const target = join(attemptDirectory, "terminal-evidence");
  await cp(sourceDirectory, target, { recursive: true, errorOnExist: true, force: false });
  return target;
}

async function expectReject(callback, label) {
  await assert.rejects(callback, (error) => (
    error instanceof TerminalEvidenceError
    && /^TERMINAL_EVIDENCE_[A-Z0-9_]+$/u.test(error.code)
  ), label);
}

async function createPassFixture(root, seed) {
  return simulateFormalProductionBrowserTerminalEvidence({
    rootDirectory: root,
    scenario: "PASS",
    controlCommit: CONTROL_COMMIT,
    seed,
  });
}

test("terminal stub simulations and both precheck receipt states produce manifest and SHA", async (root) => {
  const expected = new Map([
    ["PASS", ["TERMINAL_PASS", "PASS"]],
    ["FAIL", ["TERMINAL_FAIL", "FAIL"]],
    ["POST_RUN_CAS_FAILURE", ["TERMINAL_FAIL", "FAIL"]],
    ["RUNNER_CRASH", ["TERMINAL_ABORTED", "ABORTED"]],
    ["BROWSER_LAUNCH_FAILURE", ["TERMINAL_FAIL", "FAIL"]],
    ["PRECHECK_FAIL", ["PRECHECK_FAILED", "FAIL"]],
    ["PRECHECK_FAIL_AFTER_RECEIPT", ["PRECHECK_FAILED", "FAIL"]],
  ]);
  for (const [scenario, [state, terminalStatus]] of expected) {
    const simulation = await simulateFormalProductionBrowserTerminalEvidence({
      rootDirectory: root,
      scenario,
      controlCommit: CONTROL_COMMIT,
      seed: `simulation-${scenario}`,
    });
    assert.equal(simulation.manifest.attemptState, state);
    assert.equal(simulation.manifest.terminalStatus, terminalStatus);
    assert.equal(simulation.manifest.containsCredentialValues, false);
    assert.deepEqual(simulation.manifest.missingRequiredFiles, []);
    assert.deepEqual(simulation.manifest.unexpectedFiles, []);
    assert.deepEqual(simulation.manifest.digestMismatches, []);
    assert.equal(
      await readFile(join(simulation.bundleDirectory, TERMINAL_MANIFEST_SHA_FILE), "ascii"),
      `${simulation.manifestFileSha256}\n`,
    );
    const records = simulation.manifest.files;
    assert.equal(records.length, TERMINAL_EVIDENCE_FILES.length);
    for (const record of records.filter(({ present }) => !present)) {
      assert.equal(record.notReached, true);
      assert.match(record.reasonCode, /^[A-Z][A-Z0-9_]+$/u);
    }
    const events = await readJournal(join(simulation.attemptDirectory, "attempt-events.jsonl"));
    const terminalEvent = events.at(-1);
    if (scenario.startsWith("PRECHECK_FAIL")) {
      assert.equal(terminalEvent.eventType, "PREFLIGHT_FAILED");
    } else {
      assert.ok(new Set(["TERMINAL_PASS", "TERMINAL_FAIL", "TERMINAL_ABORTED"]).has(terminalEvent.eventType));
      assert.equal(events.at(-2).eventType, "CLEANUP_COMPLETED");
      const cleanup = events.at(-2).eventBody;
      assert.equal(
        cleanup.profileCleanupDigest,
        sha256Hex(await readFile(join(simulation.bundleDirectory, "profile-cleanup.json"))),
      );
      assert.equal(
        cleanup.processCleanupDigest,
        sha256Hex(await readFile(join(simulation.bundleDirectory, "process-cleanup.json"))),
      );
      const runnerCompleted = events.find(({ eventType }) => eventType === "RUNNER_COMPLETED");
      if (runnerCompleted) {
        const runnerPath = runnerCompleted.eventBody.outcome === "PASS" ? "runner-result.json" : "runner-failure.json";
        assert.equal(
          runnerCompleted.eventBody.runnerEvidenceDigest,
          sha256Hex(await readFile(join(simulation.bundleDirectory, runnerPath))),
        );
      }
    }
    if (scenario === "POST_RUN_CAS_FAILURE") {
      const runnerResultRecord = records.find(({ path }) => path === "runner-result.json");
      const runnerFailureRecord = records.find(({ path }) => path === "runner-failure.json");
      assert.equal(runnerResultRecord.requiredForState, true);
      assert.equal(runnerResultRecord.present, true);
      assert.equal(runnerFailureRecord.requiredForState, false);
      assert.equal(runnerFailureRecord.present, false);
      assert.equal(runnerFailureRecord.notReached, true);
      assert.equal(runnerFailureRecord.reasonCode, "RUNNER_PASS_NO_FAILURE_ARTIFACT");
      assert.equal((await readJson(join(simulation.bundleDirectory, "runner-result.json"))).status, "PASS");
      await assert.rejects(readFile(join(simulation.bundleDirectory, "runner-failure.json")));
      assert.equal((await readJson(join(simulation.bundleDirectory, "wrapper-result.json"))).status, "FAIL");
      assert.equal(simulation.validation.status, "PASS");
      assert.equal(simulation.validation.attemptState, "TERMINAL_FAIL");
    }
    const runtimeRecord = records.find(({ path }) => path === "runtime-receipt.json");
    const toolchainRecord = records.find(({ path }) => path === "toolchain-receipt.json");
    if (scenario === "PRECHECK_FAIL") {
      assert.equal(runtimeRecord.requiredForState, false);
      assert.equal(runtimeRecord.present, false);
      assert.equal(toolchainRecord.requiredForState, false);
      assert.equal(toolchainRecord.present, false);
    } else {
      assert.equal(runtimeRecord.requiredForState, true);
      assert.equal(runtimeRecord.present, true);
      assert.equal(toolchainRecord.requiredForState, true);
      assert.equal(toolchainRecord.present, true);
    }
  }
}, ["simulations"]);

test("post-run terminal failure rejects runner-failure substitution for durable runner PASS", async (root) => {
  const source = await simulateFormalProductionBrowserTerminalEvidence({
    rootDirectory: root,
    scenario: "POST_RUN_CAS_FAILURE",
    controlCommit: CONTROL_COMMIT,
    seed: "post-run-runner-kind-mutation",
  });
  const projections = Object.fromEntries(await Promise.all([
    ["runtimeReceipt", "runtime-receipt.json"],
    ["toolchainReceipt", "toolchain-receipt.json"],
    ["wrapperResult", "wrapper-result.json"],
    ["browserFailure", "browser-failure.json"],
    ["profileCleanup", "profile-cleanup.json"],
    ["processCleanup", "process-cleanup.json"],
  ].map(async ([key, path]) => [key, await readJson(join(source.bundleDirectory, path))])));
  const runnerResult = await readJson(join(source.bundleDirectory, "runner-result.json"));
  const runnerFailure = {
    schemaVersion: "p24b-rc6.2-formal-runner-failure-v1",
    attemptId: runnerResult.attemptId,
    status: "FAIL",
    reasonCode: "POST_RUN_CAS_FAILED",
    exitCode: runnerResult.exitCode,
  };
  await rm(source.bundleDirectory, { recursive: true, force: false });
  await assert.rejects(
    finalizeFormalProductionBrowserTerminalEvidence({
      attemptDirectory: source.attemptDirectory,
      bundleDirectory: source.bundleDirectory,
      expectedControlCommit: CONTROL_COMMIT,
      startedAt: source.manifest.startedAt,
      completedAt: source.manifest.completedAt,
      ...projections,
      runnerFailure,
    }),
    (error) => error instanceof TerminalEvidenceError
      && error.code === "TERMINAL_EVIDENCE_FINALIZATION_FAILED"
      && error.causeCode === "TERMINAL_EVIDENCE_PROJECTION_INVALID",
  );
  assert.equal((await readJson(join(source.bundleDirectory, TERMINAL_EMERGENCY_FILE))).status, "FAIL");
  await assert.rejects(readFile(join(source.bundleDirectory, TERMINAL_MANIFEST_FILE)));
}, ["simulations"]);

test("formal PASS exact truth validates", async (root) => {
  const pass = await createPassFixture(root, "formal-pass-exact");
  const validation = await validateFormalProductionBrowserTerminalEvidence({
    bundleDirectory: pass.bundleDirectory,
    expectedControlCommit: CONTROL_COMMIT,
  });
  assert.equal(validation.status, "PASS");
  assert.equal(validation.formalPass, true);
  assert.equal(validation.attemptState, "TERMINAL_PASS");
  assert.equal(validation.containsCredentialValues, false);
  const cliResult = spawnSync(process.execPath, [MODULE_PATH, "validate-formal"], {
    input: JSON.stringify({ expectedControlCommit: CONTROL_COMMIT, bundleDirectory: pass.bundleDirectory }, null, 2),
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(cliResult.status, 0, cliResult.stderr);
  assert.equal(cliResult.stderr, "");
  const cliSafe = JSON.parse(cliResult.stdout);
  assert.equal(cliSafe.status, "PASS");
  assert.equal(cliSafe.formalPass, true);
  assert.equal(cliResult.stdout.includes(pass.bundleDirectory), false);
  assert.equal(cliResult.stdout.includes("https://"), false);
  const bindInput = {
    runnerResult: await readJson(join(pass.bundleDirectory, "runner-result.json")),
    profileCleanup: await readJson(join(pass.bundleDirectory, "profile-cleanup.json")),
    processCleanup: await readJson(join(pass.bundleDirectory, "process-cleanup.json")),
  };
  const bindResult = spawnSync(process.execPath, [MODULE_PATH, "bind-projections"], {
    input: JSON.stringify(bindInput, null, 2),
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(bindResult.status, 0, bindResult.stderr);
  assert.equal(bindResult.stderr, "");
  const bindings = JSON.parse(bindResult.stdout);
  const events = await readJournal(join(pass.attemptDirectory, "attempt-events.jsonl"));
  assert.equal(
    bindings.runnerEvidenceDigest,
    events.find(({ eventType }) => eventType === "RUNNER_COMPLETED").eventBody.runnerEvidenceDigest,
  );
  assert.equal(
    bindings.profileCleanupDigest,
    events.find(({ eventType }) => eventType === "CLEANUP_COMPLETED").eventBody.profileCleanupDigest,
  );
});

test("finalizer failure emits minimal emergency sidecar and never a manifest", async (root) => {
  const source = await createPassFixture(root, "writer-source");
  const bundleDirectory = source.bundleDirectory;
  const projections = Object.fromEntries(await Promise.all([
    ["runtimeReceipt", "runtime-receipt.json"],
    ["toolchainReceipt", "toolchain-receipt.json"],
    ["wrapperResult", "wrapper-result.json"],
    ["runnerResult", "runner-result.json"],
    ["browserResult", "browser-result.json"],
    ["networkReceipt", "network-receipt.json"],
    ["modelMetadata", "model-metadata.json"],
    ["persistenceTruth", "persistence-truth.json"],
    ["storyBibleTruth", "story-bible-truth.json"],
    ["candidateLineage", "candidate-lineage.json"],
    ["approvalReceipt", "approval-receipt.json"],
    ["profileCleanup", "profile-cleanup.json"],
    ["processCleanup", "process-cleanup.json"],
  ].map(async ([key, path]) => [key, await readJson(join(bundleDirectory, path))])));
  await rm(bundleDirectory, { recursive: true, force: false });
  process.env.RC6_2_TERMINAL_EVIDENCE_TEST_MODE = "1";
  try {
    await assert.rejects(
      finalizeFormalProductionBrowserTerminalEvidence({
      attemptDirectory: source.attemptDirectory,
      bundleDirectory,
      expectedControlCommit: CONTROL_COMMIT,
      startedAt: source.manifest.startedAt,
      completedAt: source.manifest.completedAt,
      ...projections,
      faultInjection: "before-manifest",
      }),
      (error) => error instanceof TerminalEvidenceError
        && error.code === "TERMINAL_EVIDENCE_FINALIZATION_FAILED",
    );
  } finally {
    delete process.env.RC6_2_TERMINAL_EVIDENCE_TEST_MODE;
  }
  assert.equal((await readJson(join(bundleDirectory, TERMINAL_EMERGENCY_FILE))).status, "FAIL");
  await assert.rejects(readFile(join(bundleDirectory, TERMINAL_MANIFEST_FILE)));
});

test("credential scanner rejects credential values without storing them in manifest", async (root) => {
  const source = await createPassFixture(root, "credential-source");
  const bundleDirectory = source.bundleDirectory;
  const secret = `sk-${"A9".repeat(20)}`;
  const wrapperResult = await readJson(join(source.bundleDirectory, "wrapper-result.json"));
  wrapperResult.debugValue = secret;
  await rm(bundleDirectory, { recursive: true, force: false });
  await assert.rejects(
    finalizeFormalProductionBrowserTerminalEvidence({
      attemptDirectory: source.attemptDirectory,
      bundleDirectory,
      expectedControlCommit: CONTROL_COMMIT,
      wrapperResult,
      credentialEnvironment: { C7_TEST_API_TOKEN: secret },
    }),
    (error) => error instanceof TerminalEvidenceError
      && error.code === "TERMINAL_EVIDENCE_FINALIZATION_FAILED"
      && error.causeCode === "TERMINAL_EVIDENCE_CREDENTIAL_VALUE_DETECTED",
  );
  const emergencyText = await readFile(join(bundleDirectory, TERMINAL_EMERGENCY_FILE), "utf8");
  assert.equal(emergencyText.includes(secret), false);
});

test("bounded CLI accepts PowerShell-style JSON while keeping finite stderr only", async () => {
  const result = spawnSync(process.execPath, [MODULE_PATH, "validate"], {
    input: '{ "bundleDirectory": "C:/invalid" }',
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^TERMINAL_EVIDENCE_[A-Z0-9_]+\n$/u);
  assert.equal(result.stderr.includes("C:/invalid"), false);
});

const mutations = [
  {
    name: "01 remove attemptId",
    apply: async (bundle) => replaceProjection(bundle, "attempt-lease-initial.json", (value) => {
      delete value.attemptId;
      Object.assign(value, redigestLease(value));
    }),
  },
  {
    name: "02 duplicate attemptId",
    apply: async (bundle) => replaceProjection(bundle, "attempt-lease-initial.json", (value) => {
      value.duplicateAttemptId = value.attemptId;
      Object.assign(value, redigestLease(value));
    }),
  },
  {
    name: "03 authorization mismatch",
    apply: async (bundle) => replaceProjection(bundle, "attempt-lease-terminal.json", (value) => {
      value.authorizationId = "C7-AUTH-mismatched";
      Object.assign(value, redigestLease(value));
    }),
  },
  {
    name: "04 Product commit wrong",
    apply: async (bundle) => replaceProjection(bundle, "attempt-lease-terminal.json", (value) => {
      value.productCommit = "0".repeat(40);
      Object.assign(value, redigestLease(value));
    }),
  },
  {
    name: "05 Control commit wrong",
    apply: async (bundle) => replaceProjection(bundle, "attempt-lease-terminal.json", (value) => {
      value.controlCommit = "1".repeat(40);
      Object.assign(value, redigestLease(value));
    }),
  },
  {
    name: "06 Deployment wrong",
    apply: async (bundle) => replaceProjection(bundle, "attempt-lease-terminal.json", (value) => {
      value.deploymentId = "dpl_wrong";
      Object.assign(value, redigestLease(value));
    }),
  },
  {
    name: "07 Origin wrong",
    apply: async (bundle) => replaceProjection(bundle, "attempt-lease-terminal.json", (value) => {
      value.productionOrigin = "https://wrong.invalid";
      Object.assign(value, redigestLease(value));
    }),
  },
  {
    name: "08 event sequence gap",
    apply: async (bundle) => {
      const path = join(bundle, "attempt-events.jsonl");
      const events = await readJournal(path);
      events[2].sequence = 99;
      events[2] = redigestEvent(events[2]);
      await writeJournal(path, events);
      await rewriteManifest(bundle, (manifest) => {
        const bytes = Buffer.from(`${events.map(canonical).join("\n")}\n`);
        const record = manifest.files.find(({ path: name }) => name === "attempt-events.jsonl");
        record.bytes = bytes.length;
        record.sha256 = sha256Hex(bytes);
      });
    },
  },
  {
    name: "09 previous event digest wrong",
    apply: async (bundle) => {
      const path = join(bundle, "attempt-events.jsonl");
      const events = await readJournal(path);
      events[2].previousEventDigest = "0".repeat(64);
      events[2] = redigestEvent(events[2]);
      await writeJournal(path, events);
      await rewriteManifest(bundle, (manifest) => {
        const bytes = Buffer.from(`${events.map(canonical).join("\n")}\n`);
        const record = manifest.files.find(({ path: name }) => name === "attempt-events.jsonl");
        record.bytes = bytes.length;
        record.sha256 = sha256Hex(bytes);
      });
    },
  },
  {
    name: "10 consumed before launch",
    apply: async (bundle) => replaceProjection(bundle, "attempt-lease-initial.json", (value) => {
      value.attemptConsumed = true;
      Object.assign(value, redigestLease(value));
    }),
  },
  {
    name: "11 unconsumed after launch",
    apply: async (bundle) => replaceProjection(bundle, "attempt-lease-terminal.json", (value) => {
      value.attemptConsumed = false;
      Object.assign(value, redigestLease(value));
    }),
  },
  {
    name: "12 browser started without runner",
    apply: async (bundle) => replaceProjection(bundle, "attempt-lease-terminal.json", (value) => {
      value.runnerStarted = false;
      Object.assign(value, redigestLease(value));
    }),
  },
  {
    name: "13 terminal PASS browser not started",
    apply: async (bundle) => replaceProjection(bundle, "attempt-lease-terminal.json", (value) => {
      value.browserStarted = false;
      Object.assign(value, redigestLease(value));
    }),
  },
  {
    name: "14 runner FAIL terminal PASS",
    apply: async (bundle) => replaceProjection(bundle, "runner-result.json", (value) => { value.status = "FAIL"; }),
  },
  {
    name: "15 manifest missing file",
    apply: async (bundle) => rm(join(bundle, "approval-receipt.json")),
  },
  {
    name: "16 manifest unknown file",
    apply: async (bundle) => writeFile(join(bundle, "unknown.json"), "{}"),
  },
  {
    name: "17 manifest file digest wrong",
    apply: async (bundle) => rewriteManifest(bundle, (manifest) => {
      manifest.files.find(({ path }) => path === "approval-receipt.json").sha256 = "0".repeat(64);
    }),
  },
  {
    name: "18 manifest SHA wrong",
    apply: async (bundle) => writeFile(join(bundle, TERMINAL_MANIFEST_SHA_FILE), `${"0".repeat(64)}\n`),
  },
  {
    name: "19 persistence memory backend",
    apply: async (bundle) => replaceProjection(bundle, "persistence-truth.json", (value) => {
      value.persistence.backend = "memory";
    }),
  },
  {
    name: "20 persistence degraded",
    apply: async (bundle) => replaceProjection(bundle, "persistence-truth.json", (value) => {
      value.persistence.degraded = true;
    }),
  },
  {
    name: "21 memory fallback used",
    apply: async (bundle) => replaceProjection(bundle, "persistence-truth.json", (value) => {
      value.persistence.memoryFallbackUsed = true;
    }),
  },
  {
    name: "22 persistence reload false",
    apply: async (bundle) => replaceProjection(bundle, "persistence-truth.json", (value) => {
      value.persistence.reloadVerified = false;
    }),
  },
  {
    name: "23 Story Bible error",
    apply: async (bundle) => replaceProjection(bundle, "story-bible-truth.json", (value) => {
      value.storyBible.status = "error";
    }),
  },
  {
    name: "24 Story Bible reload false",
    apply: async (bundle) => replaceProjection(bundle, "story-bible-truth.json", (value) => {
      value.storyBible.approvedRecordReloadVerified = false;
    }),
  },
  {
    name: "25 Story Bible model context false",
    apply: async (bundle) => replaceProjection(bundle, "story-bible-truth.json", (value) => {
      value.storyBible.modelContextBindingVerified = false;
    }),
  },
  {
    name: "26 Story Bible project leak",
    apply: async (bundle) => replaceProjection(bundle, "story-bible-truth.json", (value) => {
      value.storyBible.crossProjectLeakCount = 1;
    }),
  },
  {
    name: "27 actual executor local Ollama",
    apply: async (bundle) => replaceProjection(bundle, "browser-result.json", (value) => {
      value.actualExecutor = "local-ollama";
    }),
  },
  {
    name: "28 external request true",
    apply: async (bundle) => replaceProjection(bundle, "network-receipt.json", (value) => {
      value.externalRequest = true;
    }),
  },
  {
    name: "29 data left device",
    apply: async (bundle) => replaceProjection(bundle, "network-receipt.json", (value) => {
      value.dataLeftDevice = true;
    }),
  },
  {
    name: "30 profile not disposed",
    apply: async (bundle) => replaceProjection(bundle, "profile-cleanup.json", (value) => {
      value.profileDisposed = false;
    }),
  },
  {
    name: "31 Edge residue",
    apply: async (bundle) => replaceProjection(bundle, "profile-cleanup.json", (value) => {
      value.edgeResidueCount = 1;
    }),
  },
  {
    name: "32 runner residue",
    apply: async (bundle) => replaceProjection(bundle, "process-cleanup.json", (value) => {
      value.runnerResidueCount = 1;
    }),
  },
];

test("32-item negative mutation matrix rejects every mutation", async (root) => {
  const source = await createPassFixture(root, "mutation-source");
  assert.equal(mutations.length, 32);
  for (const [index, mutation] of mutations.entries()) {
    const bundle = await cloneBundle(source.bundleDirectory, root, `mutation-${String(index + 1).padStart(2, "0")}`);
    await mutation.apply(bundle);
    await expectReject(
      () => validateFormalProductionBrowserTerminalEvidence({
        bundleDirectory: bundle,
        expectedControlCommit: CONTROL_COMMIT,
      }),
      mutation.name,
    );
    mutationResults.push({ index: index + 1, name: mutation.name, status: "PASS" });
  }
}, ["mutations"]);

const root = await mkdtemp(join(tmpdir(), TEST_ROOT_PREFIX));
const results = [];
try {
  const selectedTests = MODE === "all" ? tests : tests.filter(({ modes }) => modes.has(MODE));
  for (const { name, callback } of selectedTests) {
    const started = Date.now();
    try {
      await callback(root);
      results.push({ name, status: "PASS", elapsedMs: Date.now() - started });
    } catch (error) {
      results.push({ name, status: "FAIL", elapsedMs: Date.now() - started });
      throw error;
    }
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

if (MODE === "all" || MODE === "mutations") assert.equal(mutationResults.length, 32);
assert.equal(results.filter(({ status }) => status !== "PASS").length, 0);
process.stdout.write(`${JSON.stringify({
  schemaVersion: "p24b-rc6.2-terminal-evidence-tests-v1",
  status: "PASS",
  mode: MODE,
  assertions: results.length,
  mutationCount: mutationResults.length,
  blockingSkipCount: 0,
  simulations: [
    "PASS", "FAIL", "POST_RUN_CAS_FAILURE", "RUNNER_CRASH", "BROWSER_LAUNCH_FAILURE",
    "PRECHECK_FAIL", "PRECHECK_FAIL_AFTER_RECEIPT",
  ],
  simulationMechanism: "production-state-api-with-structured-projections",
  results,
  mutationResults,
}, null, 2)}\n`);

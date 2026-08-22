import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";

import {
  BROWSER_AI_SETUP_DIAGNOSTIC_CHECKPOINTS,
  BROWSER_AI_SETUP_DIAGNOSTIC_FAULTS,
  BROWSER_AI_SETUP_DIAGNOSTIC_SCHEMA_VERSION,
  browserAiSetupDiagnosticController,
  createBrowserAiSetupDiagnosticsForTests,
} from "../lib/novel-ai/providers/browser-ai/browser-ai-setup-diagnostics.ts";

const mode = process.argv[2] ?? "all";
const supportedModes = new Set([
  "authorization",
  "checkpoints",
  "ownership",
  "faults",
  "privacy",
  "source",
  "all",
]);

if (!supportedModes.has(mode)) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: "rc6.4-browser-ai-setup-diagnostic-tests-v1",
    mode,
    status: "FAIL",
    code: "UNSUPPORTED_MODE",
    supportedModes: [...supportedModes],
  }, null, 2)}\n`);
  process.exit(2);
}

const results = [];
const AUTHORIZATION_ID = "9d03f6ba-b9ef-47ec-a910-fc5bb5660be1";
const ATTEMPT_ID = "browser-ai-attempt-raw-sentinel";
const ABORT_CONTROLLER_GENERATION_ID = "6466fe34-8038-4eb7-b8cf-638431d345e2";
const BOOTSTRAP_GLOBAL = "__NOVEL_RC6_4_BROWSER_SETUP_DIAGNOSTIC_BOOTSTRAP__";
const BRIDGE_GLOBAL = "__NOVEL_RC6_4_BROWSER_SETUP_DIAGNOSTICS__";

async function check(name, operation) {
  await operation();
  results.push({ name, status: "PASS" });
}

function errorCode(error) {
  return error && typeof error === "object" && "code" in error
    ? error.code
    : null;
}

async function expectCode(code, operation) {
  await assert.rejects(operation, (error) => errorCode(error) === code);
}

function expectSyncCode(code, operation) {
  assert.throws(operation, (error) => errorCode(error) === code);
}

function diagnosticOwnership(attemptId, epoch, abortControllerGenerationId = (
  ABORT_CONTROLLER_GENERATION_ID
)) {
  return { attemptId, epoch, abortControllerGenerationId };
}

async function passCheckpoint(bridge, attempt, checkpoint, runtime = {}) {
  bridge.arm({ checkpoint });
  const arrivalPromise = bridge.waitForArrival(checkpoint);
  let settled = false;
  const checkpointPromise = attempt.checkpoint(checkpoint, runtime).then((value) => {
    settled = true;
    return value;
  });
  const arrival = await arrivalPromise;
  await Promise.resolve();
  assert.equal(settled, false, `${checkpoint} settled before release`);
  bridge.release(checkpoint);
  const outcome = await checkpointPromise;
  assert.deepEqual(outcome, { disposition: "released", fault: null });
  return arrival;
}

const suites = {
  async authorization() {
    await check("compile-time flag absent is synchronous inert path", () => {
      const previous = process.env.NEXT_PUBLIC_RC6_4_BROWSER_SETUP_DIAGNOSTICS;
      const priorWindow = globalThis.window;
      const inertWindow = {
        [BOOTSTRAP_GLOBAL]: {
          schemaVersion: BROWSER_AI_SETUP_DIAGNOSTIC_SCHEMA_VERSION,
          authorizationId: AUTHORIZATION_ID,
        },
      };
      delete process.env.NEXT_PUBLIC_RC6_4_BROWSER_SETUP_DIAGNOSTICS;
      globalThis.window = inertWindow;
      try {
        assert.equal(browserAiSetupDiagnosticController(), null);
        assert.equal(BRIDGE_GLOBAL in inertWindow, false);
        assert.equal(BOOTSTRAP_GLOBAL in inertWindow, true);
      } finally {
        if (priorWindow === undefined) delete globalThis.window;
        else globalThis.window = priorWindow;
        if (previous === undefined) {
          delete process.env.NEXT_PUBLIC_RC6_4_BROWSER_SETUP_DIAGNOSTICS;
        } else {
          process.env.NEXT_PUBLIC_RC6_4_BROWSER_SETUP_DIAGNOSTICS = previous;
        }
      }
    });

    await check("malformed bootstrap is consumed once and fails closed", async () => {
      const priorWindow = globalThis.window;
      const priorFlag = process.env.NEXT_PUBLIC_RC6_4_BROWSER_SETUP_DIAGNOSTICS;
      let getterRead = false;
      const diagnosticWindow = {};
      Object.defineProperty(diagnosticWindow, BOOTSTRAP_GLOBAL, {
        configurable: true,
        enumerable: false,
        get() {
          getterRead = true;
          return { authorizationId: AUTHORIZATION_ID };
        },
      });
      globalThis.window = diagnosticWindow;
      process.env.NEXT_PUBLIC_RC6_4_BROWSER_SETUP_DIAGNOSTICS = "1";
      try {
        const isolated = await import(
          `../lib/novel-ai/providers/browser-ai/browser-ai-setup-diagnostics.ts?malformed=${Date.now()}`
        );
        assert.equal(await isolated.browserAiSetupDiagnosticController(), null);
        assert.equal(getterRead, false);
        assert.equal(BOOTSTRAP_GLOBAL in diagnosticWindow, false);
        diagnosticWindow[BOOTSTRAP_GLOBAL] = {
          schemaVersion: BROWSER_AI_SETUP_DIAGNOSTIC_SCHEMA_VERSION,
          authorizationId: AUTHORIZATION_ID,
        };
        assert.equal(await isolated.browserAiSetupDiagnosticController(), null);
        assert.equal(BRIDGE_GLOBAL in diagnosticWindow, false);
      } finally {
        if (priorWindow === undefined) delete globalThis.window;
        else globalThis.window = priorWindow;
        if (priorFlag === undefined) {
          delete process.env.NEXT_PUBLIC_RC6_4_BROWSER_SETUP_DIAGNOSTICS;
        } else {
          process.env.NEXT_PUBLIC_RC6_4_BROWSER_SETUP_DIAGNOSTICS = priorFlag;
        }
      }
    });

    await check("authorization identifier is strict lowercase UUIDv4", async () => {
      await expectCode(
        "BROWSER_AI_SETUP_DIAGNOSTIC_AUTHORIZATION_INVALID",
        () => createBrowserAiSetupDiagnosticsForTests("not-an-authorization"),
      );
      await expectCode(
        "BROWSER_AI_SETUP_DIAGNOSTIC_AUTHORIZATION_INVALID",
        () => createBrowserAiSetupDiagnosticsForTests(AUTHORIZATION_ID.toUpperCase()),
      );
    });

    await check("one-time bootstrap installs opaque exact bridge", async () => {
      const priorWindow = globalThis.window;
      const priorFlag = process.env.NEXT_PUBLIC_RC6_4_BROWSER_SETUP_DIAGNOSTICS;
      const diagnosticWindow = {};
      diagnosticWindow[BOOTSTRAP_GLOBAL] = {
        schemaVersion: BROWSER_AI_SETUP_DIAGNOSTIC_SCHEMA_VERSION,
        authorizationId: AUTHORIZATION_ID,
      };
      globalThis.window = diagnosticWindow;
      process.env.NEXT_PUBLIC_RC6_4_BROWSER_SETUP_DIAGNOSTICS = "1";
      try {
        const controller = await browserAiSetupDiagnosticController();
        assert.ok(controller);
        assert.equal(BOOTSTRAP_GLOBAL in diagnosticWindow, false);
        const bridge = diagnosticWindow[BRIDGE_GLOBAL];
        assert.deepEqual(Object.keys(bridge).sort(), [
          "arm",
          "checkpoints",
          "faults",
          "release",
          "schemaVersion",
          "snapshot",
          "waitForArrival",
        ]);
        const descriptor = Object.getOwnPropertyDescriptor(
          diagnosticWindow,
          BRIDGE_GLOBAL,
        );
        assert.deepEqual({
          configurable: descriptor.configurable,
          enumerable: descriptor.enumerable,
          writable: descriptor.writable,
        }, { configurable: false, enumerable: false, writable: false });
        assert.equal(bridge.arm.length, 1);
        assert.equal(bridge.waitForArrival.length, 1);
        assert.equal(bridge.release.length, 1);
        assert.equal(bridge.snapshot.length, 0);
      } finally {
        if (priorWindow === undefined) delete globalThis.window;
        else globalThis.window = priorWindow;
        if (priorFlag === undefined) {
          delete process.env.NEXT_PUBLIC_RC6_4_BROWSER_SETUP_DIAGNOSTICS;
        } else {
          process.env.NEXT_PUBLIC_RC6_4_BROWSER_SETUP_DIAGNOSTICS = priorFlag;
        }
      }
    });
  },

  async checkpoints() {
    await check("checkpoint and fault enums are exact finite frozen sets", () => {
      assert.deepEqual(BROWSER_AI_SETUP_DIAGNOSTIC_CHECKPOINTS, [
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
      ]);
      assert.deepEqual(BROWSER_AI_SETUP_DIAGNOSTIC_FAULTS, [
        "worker-crash",
        "metadata-transaction-abort",
        "stale-completion",
      ]);
      assert.equal(Object.isFrozen(BROWSER_AI_SETUP_DIAGNOSTIC_CHECKPOINTS), true);
      assert.equal(Object.isFrozen(BROWSER_AI_SETUP_DIAGNOSTIC_FAULTS), true);
    });

    await check("all 12 checkpoints pause until attempt-owned release", async () => {
      const { controller, bridge } = await createBrowserAiSetupDiagnosticsForTests(
        AUTHORIZATION_ID,
      );
      const attempt = await controller.bindAttempt(diagnosticOwnership(ATTEMPT_ID, 7));
      const arrivals = [];
      for (const checkpoint of BROWSER_AI_SETUP_DIAGNOSTIC_CHECKPOINTS) {
        arrivals.push(await passCheckpoint(bridge, attempt, checkpoint, {
          workerGeneration: 11,
          engineGeneration: 13,
          ordering: checkpoint === "metadata-transaction"
            ? "inside-open-readwrite-transaction-before-writes"
            : "not-applicable",
        }));
      }
      assert.deepEqual(arrivals.map(({ sequence }) => sequence), [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      ]);
      for (const arrival of arrivals) {
        assert.deepEqual(Object.keys(arrival).sort(), [
          "abortControllerGenerationDigest",
          "attemptIdDigest",
          "checkpoint",
          "controllerGenerationDigest",
          "engineGenerationDigest",
          "fault",
          "runtimeOrdering",
          "schemaVersion",
          "sequence",
          "setupEpoch",
          "singleFlightGenerationDigest",
          "workerGenerationDigest",
        ]);
        assert.match(arrival.attemptIdDigest, /^[a-f0-9]{64}$/u);
        assert.match(arrival.controllerGenerationDigest, /^[a-f0-9]{64}$/u);
        assert.match(arrival.singleFlightGenerationDigest, /^[a-f0-9]{64}$/u);
        assert.match(arrival.abortControllerGenerationDigest, /^[a-f0-9]{64}$/u);
        assert.match(arrival.workerGenerationDigest, /^[a-f0-9]{64}$/u);
        assert.match(arrival.engineGenerationDigest, /^[a-f0-9]{64}$/u);
        assert.equal(Object.isFrozen(arrival), true);
      }
      assert.equal(bridge.snapshot().arrivalCount, 12);
      assert.equal(bridge.snapshot().releaseCount, 12);
    });

    await check("checkpoint controls reject invalid lifecycle operations", async () => {
      const { controller, bridge } = await createBrowserAiSetupDiagnosticsForTests(
        AUTHORIZATION_ID,
      );
      const attempt = await controller.bindAttempt(diagnosticOwnership(ATTEMPT_ID, 1));
      expectSyncCode(
        "BROWSER_AI_SETUP_DIAGNOSTIC_CHECKPOINT_INVALID",
        () => bridge.arm({ checkpoint: "unknown" }),
      );
      bridge.arm({ checkpoint: "warmup" });
      expectSyncCode(
        "BROWSER_AI_SETUP_DIAGNOSTIC_ALREADY_ARMED",
        () => bridge.arm({ checkpoint: "integrity-verify" }),
      );
      expectSyncCode(
        "BROWSER_AI_SETUP_DIAGNOSTIC_NOT_ARMED",
        () => bridge.waitForArrival("integrity-verify"),
      );
      expectSyncCode(
        "BROWSER_AI_SETUP_DIAGNOSTIC_NOT_ARRIVED",
        () => bridge.release("warmup"),
      );
      const arrival = bridge.waitForArrival("warmup");
      const held = attempt.checkpoint("warmup");
      await arrival;
      bridge.release("warmup");
      expectSyncCode(
        "BROWSER_AI_SETUP_DIAGNOSTIC_NOT_ARRIVED",
        () => bridge.release("warmup"),
      );
      await held;
    });
  },

  async ownership() {
    await check("abort-controller generation digest reuses identity and separates retry", async () => {
      const { controller, bridge } = await createBrowserAiSetupDiagnosticsForTests(
        AUTHORIZATION_ID,
      );
      await controller.bindAttempt(diagnosticOwnership("same-signal-a", 1));
      const first = bridge.snapshot().abortControllerGenerationDigest;
      await controller.bindAttempt(diagnosticOwnership("same-signal-b", 2));
      const reused = bridge.snapshot().abortControllerGenerationDigest;
      await controller.bindAttempt(diagnosticOwnership(
        "new-signal",
        3,
        "6251d88d-c615-4eab-a2b8-b925277c1a91",
      ));
      const retry = bridge.snapshot().abortControllerGenerationDigest;
      assert.match(first, /^[a-f0-9]{64}$/u);
      assert.equal(reused, first);
      assert.notEqual(retry, first);
    });

    await check("concurrent bind invocation order fences earlier token", async () => {
      const { controller, bridge } = await createBrowserAiSetupDiagnosticsForTests(
        AUTHORIZATION_ID,
      );
      const stalePromise = controller.bindAttempt(diagnosticOwnership("racing-old", 1));
      const currentPromise = controller.bindAttempt(diagnosticOwnership("racing-new", 2));
      const [stale, current] = await Promise.all([stalePromise, currentPromise]);
      bridge.arm({ checkpoint: "warmup" });
      await expectCode(
        "BROWSER_AI_SETUP_DIAGNOSTIC_STALE_ATTEMPT",
        () => stale.checkpoint("warmup"),
      );
      const arrival = bridge.waitForArrival("warmup");
      const held = current.checkpoint("warmup");
      assert.equal((await arrival).setupEpoch, 2);
      bridge.release("warmup");
      await held;
    });

    await check("latest bound attempt fences stale epoch before arrival", async () => {
      const { controller, bridge } = await createBrowserAiSetupDiagnosticsForTests(
        AUTHORIZATION_ID,
      );
      const stale = await controller.bindAttempt(diagnosticOwnership("old-attempt", 1));
      const current = await controller.bindAttempt(diagnosticOwnership("new-attempt", 2));
      expectSyncCode(
        "BROWSER_AI_SETUP_DIAGNOSTIC_STALE_ATTEMPT",
        () => stale.acknowledgeCleanup({
          engineOwnershipMatched: true,
          engineDetached: true,
          workerDisposeAcknowledged: true,
          metadataCleanupAcknowledged: true,
        }),
      );
      assert.equal(bridge.snapshot().lastCleanup, null);
      bridge.arm({ checkpoint: "warmup" });
      await expectCode(
        "BROWSER_AI_SETUP_DIAGNOSTIC_STALE_ATTEMPT",
        () => stale.checkpoint("warmup"),
      );
      const arrival = bridge.waitForArrival("warmup");
      const currentHold = current.checkpoint("warmup");
      assert.equal((await arrival).setupEpoch, 2);
      bridge.release("warmup");
      await currentHold;
      current.recordStaleCompletion();
      current.recordLateFailure();
      assert.deepEqual({
        stale: bridge.snapshot().staleCompletionRejectedCount,
        late: bridge.snapshot().lateFailureRejectedCount,
      }, { stale: 3, late: 1 });
    });

    await check("single checkpoint accepts one owning flight", async () => {
      const { controller, bridge } = await createBrowserAiSetupDiagnosticsForTests(
        AUTHORIZATION_ID,
      );
      const attempt = await controller.bindAttempt(diagnosticOwnership(ATTEMPT_ID, 3));
      bridge.arm({ checkpoint: "warmup" });
      const arrival = bridge.waitForArrival("warmup");
      const owner = attempt.checkpoint("warmup");
      await arrival;
      await expectCode(
        "BROWSER_AI_SETUP_DIAGNOSTIC_CHECKPOINT_DUPLICATE",
        () => attempt.checkpoint("warmup"),
      );
      bridge.release("warmup");
      await owner;
      assert.equal(bridge.snapshot().releaseCount, 1);
    });

    await check("stale attempt cannot overwrite latest cleanup receipt", async () => {
      const { controller, bridge } = await createBrowserAiSetupDiagnosticsForTests(
        AUTHORIZATION_ID,
      );
      const stale = await controller.bindAttempt(diagnosticOwnership("old-cleanup", 1));
      const current = await controller.bindAttempt(diagnosticOwnership("new-cleanup", 2));
      const acknowledgement = {
        engineOwnershipMatched: true,
        engineDetached: true,
        workerDisposeAcknowledged: true,
        metadataCleanupAcknowledged: true,
      };
      await expectCode(
        "BROWSER_AI_SETUP_DIAGNOSTIC_STALE_ATTEMPT",
        async () => stale.acknowledgeCleanup(acknowledgement),
      );
      assert.equal(bridge.snapshot().lastCleanup, null);
      const latest = current.acknowledgeCleanup(acknowledgement);
      assert.equal(latest.setupEpoch, 2);
      assert.deepEqual(bridge.snapshot().lastCleanup, latest);
    });
  },

  async faults() {
    for (const [checkpoint, fault, counter] of [
      ["worker-engine-initialize", "worker-crash", "workerCrashFaultTriggeredCount"],
      [
        "metadata-transaction",
        "metadata-transaction-abort",
        "metadataTransactionAbortFaultTriggeredCount",
      ],
      [
        "before-generation-verification",
        "stale-completion",
        "staleCompletionFaultTriggeredCount",
      ],
    ]) {
      await check(`${fault} is one-shot and bound to ${checkpoint}`, async () => {
        const { controller, bridge } = await createBrowserAiSetupDiagnosticsForTests(
          AUTHORIZATION_ID,
        );
        const attempt = await controller.bindAttempt(diagnosticOwnership(ATTEMPT_ID, 4));
        bridge.arm({ checkpoint, fault });
        const arrival = bridge.waitForArrival(checkpoint);
        const held = attempt.checkpoint(checkpoint);
        await arrival;
        bridge.release(checkpoint);
        assert.deepEqual(await held, { disposition: "released", fault });
        assert.equal(bridge.snapshot()[counter], 1);
        assert.deepEqual(await attempt.checkpoint(checkpoint), {
          disposition: "not-armed",
          fault: null,
        });
        assert.equal(bridge.snapshot()[counter], 1);
      });
    }

    await check("faults reject every non-owning checkpoint", async () => {
      const { bridge } = await createBrowserAiSetupDiagnosticsForTests(AUTHORIZATION_ID);
      expectSyncCode(
        "BROWSER_AI_SETUP_DIAGNOSTIC_FAULT_INVALID",
        () => bridge.arm({ checkpoint: "warmup", fault: "worker-crash" }),
      );
      expectSyncCode(
        "BROWSER_AI_SETUP_DIAGNOSTIC_FAULT_INVALID",
        () => bridge.arm({
          checkpoint: "before-verified-metadata-transaction",
          fault: "metadata-transaction-abort",
        }),
      );
    });
  },

  async privacy() {
    await check("cleanup acknowledgement is safe and exact", async () => {
      const { controller, bridge } = await createBrowserAiSetupDiagnosticsForTests(
        AUTHORIZATION_ID,
      );
      const attempt = await controller.bindAttempt(diagnosticOwnership(ATTEMPT_ID, 8));
      const cleanup = attempt.acknowledgeCleanup({
        engineOwnershipMatched: true,
        engineDetached: true,
        workerDisposeAcknowledged: true,
        metadataCleanupAcknowledged: true,
      });
      assert.deepEqual(Object.keys(cleanup).sort(), [
        "abortControllerGenerationDigest",
        "attemptIdDigest",
        "cleanupAcknowledged",
        "engineDetached",
        "engineOwnershipMatched",
        "metadataCleanupAcknowledged",
        "schemaVersion",
        "setupEpoch",
        "workerDisposeAcknowledged",
      ]);
      assert.equal(cleanup.cleanupAcknowledged, true);
      assert.equal(Object.isFrozen(cleanup), true);
      assert.deepEqual(bridge.snapshot().lastCleanup, cleanup);
      const ownershipMismatch = attempt.acknowledgeCleanup({
        engineOwnershipMatched: false,
        engineDetached: true,
        workerDisposeAcknowledged: true,
        metadataCleanupAcknowledged: true,
      });
      assert.equal(ownershipMismatch.cleanupAcknowledged, false);
    });

    await check("canonical snapshot contains digests and counters only", async () => {
      const { controller, bridge } = await createBrowserAiSetupDiagnosticsForTests(
        AUTHORIZATION_ID,
      );
      const attempt = await controller.bindAttempt(diagnosticOwnership(ATTEMPT_ID, 9));
      await passCheckpoint(bridge, attempt, "worker-engine-initialize", {
        workerGeneration: 21,
        engineGeneration: 34,
        ordering: "worker-created-before-engine-created",
      });
      const snapshot = bridge.snapshot();
      assert.deepEqual(Object.keys(snapshot).sort(), [
        "abortControllerGenerationDigest",
        "armState",
        "armedCheckpoint",
        "armedFault",
        "arrivalCount",
        "authorizationIdDigest",
        "enabled",
        "lastArrival",
        "lastCleanup",
        "lateFailureRejectedCount",
        "metadataTransactionAbortFaultTriggeredCount",
        "releaseCount",
        "schemaVersion",
        "staleCompletionFaultTriggeredCount",
        "staleCompletionRejectedCount",
        "workerCrashFaultTriggeredCount",
      ]);
      const canonical = JSON.stringify(snapshot);
      assert.doesNotMatch(canonical, new RegExp(AUTHORIZATION_ID, "u"));
      assert.doesNotMatch(canonical, new RegExp(ATTEMPT_ID, "u"));
      assert.doesNotMatch(canonical, new RegExp(ABORT_CONTROLLER_GENERATION_ID, "u"));
      assert.doesNotMatch(canonical, /https?:|credential|cookie|prompt|response|userData/iu);
      assert.match(snapshot.authorizationIdDigest, /^[a-f0-9]{64}$/u);
      assert.equal(Object.isFrozen(snapshot), true);
    });
  },

  async source() {
    await check("Product wiring covers only checkpoints 1 and 6 through 12", async () => {
      const diagnosticsSource = await readFile(new URL(
        "../lib/novel-ai/providers/browser-ai/browser-ai-setup-diagnostics.ts",
        import.meta.url,
      ), "utf8");
      const runtimeSource = await readFile(new URL(
        "../lib/novel-ai/providers/browser-ai/browser-webllm-runtime.ts",
        import.meta.url,
      ), "utf8");
      const coordinatorSource = await readFile(new URL(
        "../lib/novel-ai/web/closed-ai-bootstrap-coordinator.ts",
        import.meta.url,
      ), "utf8");
      assert.match(
        diagnosticsSource,
        /process\.env\.NEXT_PUBLIC_RC6_4_BROWSER_SETUP_DIAGNOSTICS !== "1"/u,
      );
      assert.doesNotMatch(
        `${diagnosticsSource}\n${runtimeSource}\n${coordinatorSource}`,
        /(?:globalThis|window)\.fetch\s*=/u,
      );
      for (const checkpoint of [
        "before-first-immutable-request",
        "all-shards-before-integrity-verify",
        "integrity-verify",
        "worker-engine-initialize",
        "warmup",
        "before-verified-metadata-transaction",
        "metadata-transaction",
      ]) assert.match(runtimeSource, new RegExp(`"${checkpoint}"`, "u"));
      assert.match(coordinatorSource, /"before-generation-verification"/u);
      assert.match(coordinatorSource, /injectAuthorizedStaleCompletion/u);
      for (const networkCheckpoint of [
        "model-config-download",
        "shard-manifest-download",
        "first-shard-download",
        "multiple-shards-mid-download",
      ]) assert.doesNotMatch(runtimeSource, new RegExp(`"${networkCheckpoint}"`, "u"));
      assert.match(runtimeSource, /keepTransactionAlive/u);
      assert.match(
        runtimeSource,
        /inside-open-readwrite-transaction-before-writes/u,
      );
      assert.match(runtimeSource, /BROWSER_AI_SETUP_DIAGNOSTIC_WORKER_CRASH/u);
      assert.match(
        runtimeSource,
        /BROWSER_AI_SETUP_DIAGNOSTIC_METADATA_TRANSACTION_ABORT/u,
      );
      assert.match(coordinatorSource, /\.\.\.\(diagnostics \? \{ diagnostics \} : \{\}\)/u);
    });
  },
};

const selectedSuites = mode === "all" ? Object.keys(suites) : [mode];

try {
  for (const suite of selectedSuites) await suites[suite]();
  process.stdout.write(`${JSON.stringify({
    schemaVersion: "rc6.4-browser-ai-setup-diagnostic-tests-v1",
    mode,
    status: "PASS",
    caseCount: results.length,
    results,
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: "rc6.4-browser-ai-setup-diagnostic-tests-v1",
    mode,
    status: "FAIL",
    code: errorCode(error) ?? "DIAGNOSTIC_CONTRACT_ASSERTION_FAILED",
    message: error instanceof Error ? error.message : String(error),
    completed: results,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

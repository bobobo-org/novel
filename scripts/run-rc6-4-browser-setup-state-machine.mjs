import assert from "node:assert/strict";
import process from "node:process";

import {
  BrowserAiSetupStateMachine,
  BrowserAiSetupStateMachineError,
} from "../lib/novel-ai/web/browser-ai-setup-state-machine.ts";
import { readFile } from "node:fs/promises";

const mode = process.argv[2] ?? "all";
const supportedModes = new Set([
  "state-machine",
  "attempt-epoch",
  "stale-completion",
  "single-flight",
  "all",
]);

if (!supportedModes.has(mode)) {
  throw new Error(`Unsupported Browser AI setup state-machine mode: ${mode}`);
}

const cases = [];

async function check(name, fn) {
  await fn();
  cases.push({ name, status: "PASS" });
}

function key(overrides = {}) {
  return {
    kind: "prepare",
    projectId: "project-alpha",
    taskType: "chapter.continue",
    ...overrides,
  };
}

function expectCode(code, fn) {
  assert.throws(fn, (error) => (
    error instanceof BrowserAiSetupStateMachineError
    && error.code === code
  ));
}

const suites = {
  async "state-machine"() {
    await check("staged unselected model crosses verification boundary", async () => {
      const runtimeSource = await readFile(
        new URL("../lib/novel-ai/providers/browser-ai/browser-webllm-runtime.ts", import.meta.url),
        "utf8",
      );
      assert.match(
        runtimeSource,
        /setupVerification\?\.modelId\s*\?\? expectedModelIdentity\?\.modelId\s*\?\? snapshot\.selectedModelId/u,
      );
      assert.match(
        runtimeSource,
        /readyModel\(\s*input\.signal,\s*input\.setupVerification,\s*input\.expectedModelIdentity/u,
      );
      assert.match(
        runtimeSource,
        /const verifiedMetadata:[\s\S]*?installStatus: "staged"/u,
      );
      assert.doesNotMatch(
        runtimeSource,
        /installStatus: options\.setupOwnership \? "staged" : "ready"/u,
      );
    });

    await check("initial state is idle with zero counters", () => {
      const machine = new BrowserAiSetupStateMachine();
      const snapshot = machine.snapshot();
      assert.equal(snapshot.state, "idle");
      assert.equal(snapshot.epoch, 0);
      assert.equal(snapshot.activeAttemptId, null);
      assert.deepEqual(Object.values(snapshot.counters), Array(12).fill(0));
    });

    await check("full setup lifecycle reaches ready", () => {
      const machine = new BrowserAiSetupStateMachine();
      const { ownership } = machine.acquire(key());
      machine.transition(ownership, "downloading", "model-download");
      machine.transition(ownership, "verifying", "integrity-verify");
      machine.transition(ownership, "initializing", "worker-init");
      machine.transition(ownership, "warming", "warmup");
      machine.transition(ownership, "generation-verifying", "generation");
      const snapshot = machine.completeReady(ownership);
      assert.equal(snapshot.state, "ready");
      assert.equal(snapshot.activeAttemptId, null);
      assert.equal(snapshot.counters.readyCompletions, 1);
      assert.equal(snapshot.counters.transitionsCommitted, 7);
    });

    await check("cached setup may skip download", () => {
      const machine = new BrowserAiSetupStateMachine();
      const { ownership } = machine.acquire(key());
      machine.transition(ownership, "verifying");
      machine.transition(ownership, "initializing");
      machine.transition(ownership, "warming");
      machine.transition(ownership, "generation-verifying");
      machine.completeReady(ownership);
      assert.deepEqual(
        machine.snapshot().transitions.map(({ to }) => to),
        [
          "preparing",
          "verifying",
          "initializing",
          "warming",
          "generation-verifying",
          "ready",
        ],
      );
    });

    await check("cancellation requires request then acknowledgement", () => {
      const machine = new BrowserAiSetupStateMachine();
      const { ownership } = machine.acquire(key());
      machine.transition(ownership, "downloading");
      assert.equal(machine.requestCancellation(ownership).state, "cancelling");
      const snapshot = machine.acknowledgeCancellation(ownership);
      assert.equal(snapshot.state, "cancelled");
      assert.equal(snapshot.activeAttemptId, null);
      assert.equal(snapshot.counters.cancellationRequests, 1);
      assert.equal(snapshot.counters.cancellationsAcknowledged, 1);
    });

    await check("cancellation request is idempotent", () => {
      const machine = new BrowserAiSetupStateMachine();
      const { ownership } = machine.acquire(key());
      machine.requestCancellation(ownership);
      machine.requestCancellation(ownership);
      assert.equal(machine.snapshot().counters.cancellationRequests, 1);
      assert.equal(machine.snapshot().state, "cancelling");
    });

    await check("cancel during pre-resource inspection is acknowledged", () => {
      const machine = new BrowserAiSetupStateMachine();
      const { ownership } = machine.acquire(key());
      machine.requestCancellation(ownership, "inspect-aborted");
      const snapshot = machine.acknowledgeCancellation(
        ownership,
        "no-resource-rollback-not-reached",
      );
      assert.equal(snapshot.state, "cancelled");
      assert.equal(snapshot.counters.cancellationsAcknowledged, 1);
    });

    await check("cancel winning an already-ready inspect race stays cancelled", () => {
      const machine = new BrowserAiSetupStateMachine();
      const { ownership } = machine.acquire(key());
      machine.requestCancellation(ownership, "ready-inspect-race");
      expectCode(
        "BROWSER_AI_SETUP_STALE_COMPLETION",
        () => machine.completeReady(ownership),
      );
      machine.acknowledgeCancellation(ownership, "no-resource-rollback-not-reached");
      assert.equal(machine.snapshot().state, "cancelled");
    });

    await check("cancellation cleanup failure reaches failed", () => {
      const machine = new BrowserAiSetupStateMachine();
      const { ownership } = machine.acquire(key());
      machine.requestCancellation(ownership);
      const snapshot = machine.failCancellation(
        ownership,
        Object.assign(new Error("safe"), { code: "METADATA_CLEANUP_FAILED" }),
      );
      assert.equal(snapshot.state, "failed");
      assert.equal(snapshot.activeAttemptId, null);
      assert.equal(snapshot.counters.cancellationsAcknowledged, 0);
      assert.equal(snapshot.counters.failureCompletions, 1);
    });

    await check("retry starts after cancellation cleanup failed", () => {
      const machine = new BrowserAiSetupStateMachine();
      const first = machine.acquire(key()).ownership;
      machine.requestCancellation(first);
      machine.failCancellation(first, new Error("safe"));
      const retry = machine.acquire(key()).ownership;
      assert.equal(retry.epoch, 2);
      assert.equal(machine.snapshot().state, "preparing");
    });

    await check("ordinary error reaches failed", () => {
      const machine = new BrowserAiSetupStateMachine();
      const { ownership } = machine.acquire(key());
      const error = Object.assign(new Error("safe"), { code: "SAFE_FAILURE" });
      const snapshot = machine.completeFailure(ownership, error);
      assert.equal(snapshot.state, "failed");
      assert.equal(snapshot.counters.failureCompletions, 1);
      assert.equal(snapshot.transitions.at(-1)?.reason, "attempt-failed:SAFE_FAILURE");
    });

    await check("backwards transition is rejected", () => {
      const machine = new BrowserAiSetupStateMachine();
      const { ownership } = machine.acquire(key());
      machine.transition(ownership, "verifying");
      expectCode(
        "BROWSER_AI_SETUP_INVALID_TRANSITION",
        () => machine.transition(ownership, "downloading"),
      );
      assert.equal(machine.snapshot().state, "verifying");
      assert.equal(machine.snapshot().counters.invalidTransitionsRejected, 1);
    });

    await check("same progress state is an idempotent no-op", () => {
      const machine = new BrowserAiSetupStateMachine();
      const { ownership } = machine.acquire(key());
      machine.transition(ownership, "downloading");
      const before = machine.snapshot().counters.transitionsCommitted;
      machine.transition(ownership, "downloading");
      assert.equal(machine.snapshot().counters.transitionsCommitted, before);
    });

    await check("history remains bounded", () => {
      const machine = new BrowserAiSetupStateMachine({ historyLimit: 3 });
      const { ownership } = machine.acquire(key());
      machine.transition(ownership, "downloading");
      machine.transition(ownership, "verifying");
      machine.transition(ownership, "initializing");
      machine.transition(ownership, "warming");
      assert.deepEqual(
        machine.snapshot().transitions.map(({ to }) => to),
        ["verifying", "initializing", "warming"],
      );
    });

    await check("snapshots and ownership are immutable", () => {
      const machine = new BrowserAiSetupStateMachine();
      const { ownership } = machine.acquire(key());
      const snapshot = machine.snapshot();
      assert.equal(Object.isFrozen(ownership), true);
      assert.equal(Object.isFrozen(snapshot), true);
      assert.equal(Object.isFrozen(snapshot.counters), true);
      assert.equal(Object.isFrozen(snapshot.transitions), true);
    });
  },

  async "attempt-epoch"() {
    await check("first attempt owns epoch one", () => {
      const machine = new BrowserAiSetupStateMachine();
      const acquisition = machine.acquire(key());
      assert.equal(acquisition.disposition, "started");
      assert.equal(acquisition.ownership.epoch, 1);
      assert.equal(acquisition.ownership.attemptId, "browser-ai-setup-1");
    });

    await check("ready completion permits a fresh attempt", () => {
      const machine = new BrowserAiSetupStateMachine();
      const first = machine.acquire(key()).ownership;
      machine.completeReady(first);
      const second = machine.acquire(key()).ownership;
      assert.equal(second.epoch, 2);
      assert.notEqual(second.attemptId, first.attemptId);
      assert.notEqual(second, first);
    });

    await check("cancelled attempt permits a fresh attempt", () => {
      const machine = new BrowserAiSetupStateMachine();
      const first = machine.acquire(key()).ownership;
      machine.requestCancellation(first);
      machine.acknowledgeCancellation(first);
      const second = machine.acquire(key()).ownership;
      assert.equal(second.epoch, first.epoch + 1);
      assert.equal(machine.snapshot().state, "preparing");
    });

    await check("failed attempt permits a fresh attempt", () => {
      const machine = new BrowserAiSetupStateMachine();
      const first = machine.acquire(key()).ownership;
      machine.completeFailure(first, new Error("safe"));
      const second = machine.acquire(key()).ownership;
      assert.equal(second.epoch, 2);
      assert.equal(machine.snapshot().counters.attemptsStarted, 2);
    });

    await check("custom attempt prefix is deterministic", () => {
      const machine = new BrowserAiSetupStateMachine({ attemptIdPrefix: "test-attempt" });
      const first = machine.acquire(key()).ownership;
      assert.equal(first.attemptId, "test-attempt-1");
    });

    await check("independent coordinators use distinct epoch-one authority", () => {
      const firstMachine = new BrowserAiSetupStateMachine({
        attemptIdFactory: (epoch) => `coordinator-a-${epoch}`,
      });
      const secondMachine = new BrowserAiSetupStateMachine({
        attemptIdFactory: (epoch) => `coordinator-b-${epoch}`,
      });
      const first = firstMachine.acquire(key()).ownership;
      const second = secondMachine.acquire(key()).ownership;
      assert.equal(first.epoch, 1);
      assert.equal(second.epoch, 1);
      assert.notEqual(first.attemptId, second.attemptId);
    });

    await check("active ownership appears in snapshot", () => {
      const machine = new BrowserAiSetupStateMachine();
      const ownership = machine.acquire(key()).ownership;
      const snapshot = machine.snapshot();
      assert.equal(snapshot.activeAttemptId, ownership.attemptId);
      assert.equal(snapshot.epoch, ownership.epoch);
      assert.equal(snapshot.activeOperationKey, ownership.operationKey);
    });

    await check("terminal state clears active ownership", () => {
      const machine = new BrowserAiSetupStateMachine();
      const ownership = machine.acquire(key()).ownership;
      machine.completeReady(ownership);
      assert.equal(machine.owns(ownership), false);
      assert.equal(machine.snapshot().activeOperationKey, null);
    });
  },

  async "stale-completion"() {
    await check("old completion is rejected after retry starts", () => {
      const machine = new BrowserAiSetupStateMachine();
      const oldAttempt = machine.acquire(key()).ownership;
      machine.requestCancellation(oldAttempt);
      machine.acknowledgeCancellation(oldAttempt);
      const retry = machine.acquire(key()).ownership;
      expectCode(
        "BROWSER_AI_SETUP_STALE_COMPLETION",
        () => machine.completeReady(oldAttempt),
      );
      assert.equal(machine.snapshot().activeAttemptId, retry.attemptId);
      assert.equal(machine.snapshot().state, "preparing");
    });

    await check("old failure is rejected after retry starts", () => {
      const machine = new BrowserAiSetupStateMachine();
      const oldAttempt = machine.acquire(key()).ownership;
      machine.requestCancellation(oldAttempt);
      machine.acknowledgeCancellation(oldAttempt);
      const retry = machine.acquire(key()).ownership;
      expectCode(
        "BROWSER_AI_SETUP_STALE_FAILURE",
        () => machine.completeFailure(oldAttempt, new Error("late")),
      );
      assert.equal(machine.snapshot().activeAttemptId, retry.attemptId);
      assert.equal(machine.snapshot().counters.staleFailuresRejected, 1);
    });

    await check("old progress is rejected after retry starts", () => {
      const machine = new BrowserAiSetupStateMachine();
      const oldAttempt = machine.acquire(key()).ownership;
      machine.requestCancellation(oldAttempt);
      machine.acknowledgeCancellation(oldAttempt);
      const retry = machine.acquire(key()).ownership;
      expectCode(
        "BROWSER_AI_SETUP_STALE_OWNERSHIP",
        () => machine.transition(oldAttempt, "downloading"),
      );
      assert.equal(machine.owns(retry), true);
      assert.equal(machine.snapshot().counters.staleTransitionsRejected, 1);
    });

    await check("completion during cancellation is rejected", () => {
      const machine = new BrowserAiSetupStateMachine();
      const ownership = machine.acquire(key()).ownership;
      machine.requestCancellation(ownership);
      expectCode(
        "BROWSER_AI_SETUP_STALE_COMPLETION",
        () => machine.completeReady(ownership),
      );
      assert.equal(machine.snapshot().state, "cancelling");
    });

    await check("durable committed completion wins cancellation request", () => {
      const machine = new BrowserAiSetupStateMachine();
      const ownership = machine.acquire(key()).ownership;
      machine.transition(ownership, "generation-verifying");
      machine.requestCancellation(ownership, "abort-after-idb-commit-started");
      const snapshot = machine.completeCommittedReady(
        ownership,
        "ready-selected-transaction-committed",
      );
      assert.equal(snapshot.state, "ready");
      assert.equal(snapshot.activeAttemptId, null);
      assert.equal(snapshot.counters.readyCompletions, 1);
      assert.deepEqual(snapshot.transitions.slice(-2).map(({ to }) => to), [
        "cancelling",
        "ready",
      ]);
    });

    await check("failure during cancellation is rejected", () => {
      const machine = new BrowserAiSetupStateMachine();
      const ownership = machine.acquire(key()).ownership;
      machine.requestCancellation(ownership);
      expectCode(
        "BROWSER_AI_SETUP_STALE_FAILURE",
        () => machine.completeFailure(ownership, new Error("late")),
      );
      assert.equal(machine.snapshot().state, "cancelling");
    });

    await check("copied ownership cannot forge authority", () => {
      const machine = new BrowserAiSetupStateMachine();
      const ownership = machine.acquire(key()).ownership;
      const forged = { ...ownership };
      expectCode(
        "BROWSER_AI_SETUP_STALE_OWNERSHIP",
        () => machine.transition(forged, "downloading"),
      );
      assert.equal(machine.snapshot().state, "preparing");
    });

    await check("stale rejection does not change retry transition history", () => {
      const machine = new BrowserAiSetupStateMachine();
      const oldAttempt = machine.acquire(key()).ownership;
      machine.completeReady(oldAttempt);
      const retry = machine.acquire(key()).ownership;
      const before = machine.snapshot().transitions.length;
      expectCode(
        "BROWSER_AI_SETUP_STALE_FAILURE",
        () => machine.completeFailure(oldAttempt, new Error("late")),
      );
      assert.equal(machine.snapshot().transitions.length, before);
      assert.equal(machine.owns(retry), true);
    });
  },

  async "single-flight"() {
    await check("same operation reuses the active attempt", () => {
      const machine = new BrowserAiSetupStateMachine();
      const first = machine.acquire(key());
      const second = machine.acquire(key());
      assert.equal(first.disposition, "started");
      assert.equal(second.disposition, "reused");
      assert.equal(second.ownership, first.ownership);
    });

    await check("reuse increments only single-flight counter", () => {
      const machine = new BrowserAiSetupStateMachine();
      machine.acquire(key());
      machine.acquire(key());
      machine.acquire(key());
      const counters = machine.snapshot().counters;
      assert.equal(counters.attemptsStarted, 1);
      assert.equal(counters.singleFlightReuses, 2);
    });

    await check("different project is rejected while active", () => {
      const machine = new BrowserAiSetupStateMachine();
      const active = machine.acquire(key()).ownership;
      expectCode(
        "BROWSER_AI_SETUP_OPERATION_IN_PROGRESS",
        () => machine.acquire(key({ projectId: "project-beta" })),
      );
      assert.equal(machine.owns(active), true);
    });

    await check("different task is rejected while active", () => {
      const machine = new BrowserAiSetupStateMachine();
      machine.acquire(key());
      expectCode(
        "BROWSER_AI_SETUP_OPERATION_IN_PROGRESS",
        () => machine.acquire(key({ taskType: "rpg.resolve" })),
      );
      assert.equal(machine.snapshot().counters.singleFlightRejections, 1);
    });

    await check("different operation kind is rejected while active", () => {
      const machine = new BrowserAiSetupStateMachine();
      machine.acquire(key());
      expectCode(
        "BROWSER_AI_SETUP_OPERATION_IN_PROGRESS",
        () => machine.acquire(key({ kind: "bootstrap" })),
      );
      assert.equal(machine.snapshot().state, "preparing");
    });

    await check("terminal completion releases single flight", () => {
      const machine = new BrowserAiSetupStateMachine();
      const first = machine.acquire(key()).ownership;
      machine.completeReady(first);
      const second = machine.acquire(key());
      assert.equal(second.disposition, "started");
      assert.equal(second.ownership.epoch, 2);
    });

    await check("cancellation acknowledgement releases single flight", () => {
      const machine = new BrowserAiSetupStateMachine();
      const first = machine.acquire(key()).ownership;
      machine.requestCancellation(first);
      expectCode(
        "BROWSER_AI_SETUP_OPERATION_IN_PROGRESS",
        () => machine.acquire(key({ projectId: "project-beta" })),
      );
      machine.acknowledgeCancellation(first);
      assert.equal(machine.acquire(key({ projectId: "project-beta" })).disposition, "started");
    });
  },
};

for (const [suiteName, suite] of Object.entries(suites)) {
  if (mode === "all" || mode === suiteName) await suite();
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: "rc6.4-browser-ai-setup-state-machine-tests-v1",
  mode,
  status: "PASS",
  caseCount: cases.length,
  cases,
}, null, 2)}\n`);

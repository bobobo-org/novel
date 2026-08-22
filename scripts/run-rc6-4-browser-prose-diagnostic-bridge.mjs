import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BROWSER_PROSE_DIAGNOSTIC_BASE_SEEDS,
  BROWSER_PROSE_DIAGNOSTIC_BOOTSTRAP_GLOBAL,
  BROWSER_PROSE_DIAGNOSTIC_BOOTSTRAP_VERSION,
  BROWSER_PROSE_DIAGNOSTIC_BRIDGE_GLOBAL,
  BROWSER_PROSE_DIAGNOSTIC_BRIDGE_VERSION,
  BROWSER_PROSE_DIAGNOSTIC_CONTEXT_IDS,
  BROWSER_PROSE_DIAGNOSTIC_SNAPSHOT_VERSION,
  consumeBrowserProseDiagnosticSeed,
  digestBrowserProseDiagnosticAuthorization,
  digestBrowserProseDiagnosticMatrix,
  digestBrowserProseDiagnosticRequestBinding,
  digestBrowserProseDiagnosticTuple,
  initializeBrowserProseDiagnosticBridge,
} from "../lib/novel-ai/web/browser-prose-diagnostic-bridge.ts";

const tests = [];

function test(name, run) {
  tests.push({ name, run });
}

function bootstrap(authorizationId, matrixDigest, extra = {}) {
  return {
    schemaVersion: BROWSER_PROSE_DIAGNOSTIC_BOOTSTRAP_VERSION,
    authorizationId,
    matrixDigest,
    ...extra,
  };
}

function installBootstrap(host, value) {
  Object.defineProperty(host, BROWSER_PROSE_DIAGNOSTIC_BOOTSTRAP_GLOBAL, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function exactKeys(value, keys) {
  assert.deepEqual(Reflect.ownKeys(value).sort(), [...keys].sort());
}

const matrix = BROWSER_PROSE_DIAGNOSTIC_CONTEXT_IDS.flatMap(
  (contextId) => BROWSER_PROSE_DIAGNOSTIC_BASE_SEEDS.map((baseSeed) => ({
    contextId,
    consumerOrdinal: 0,
    baseSeed,
  })),
).map((entry, index) => ({ ...entry, consumerOrdinal: index + 1 }));
const matrixDigest = await digestBrowserProseDiagnosticMatrix(matrix);
const authorizationId = "53f3341f-4284-4a6d-8ad6-6284f971dd01";
const validBootstrap = bootstrap(authorizationId, matrixDigest);

test("compile flag off leaves bootstrap and bridge globals untouched", async () => {
  const host = {};
  installBootstrap(host, validBootstrap);
  assert.equal(await initializeBrowserProseDiagnosticBridge(host, false), null);
  assert.equal(
    Object.getOwnPropertyDescriptor(host, BROWSER_PROSE_DIAGNOSTIC_BOOTSTRAP_GLOBAL)?.value,
    validBootstrap,
  );
  assert.equal(BROWSER_PROSE_DIAGNOSTIC_BRIDGE_GLOBAL in host, false);
  assert.equal(await consumeBrowserProseDiagnosticSeed({
    projectId: "project-01",
    sessionId: "session-01",
    taskType: "chapter.continue",
    requestId: "request-01",
  }, host, false), null);
});

test("invalid bootstrap is deleted and burns the same-document initializer", async () => {
  const host = {};
  installBootstrap(host, bootstrap(authorizationId, matrixDigest, { extra: true }));
  assert.equal(await initializeBrowserProseDiagnosticBridge(host, true), null);
  assert.equal(BROWSER_PROSE_DIAGNOSTIC_BOOTSTRAP_GLOBAL in host, false);
  assert.equal(BROWSER_PROSE_DIAGNOSTIC_BRIDGE_GLOBAL in host, false);
  installBootstrap(host, validBootstrap);
  assert.equal(await initializeBrowserProseDiagnosticBridge(host, true), null);
  assert.equal(BROWSER_PROSE_DIAGNOSTIC_BOOTSTRAP_GLOBAL in host, false);
  assert.equal(BROWSER_PROSE_DIAGNOSTIC_BRIDGE_GLOBAL in host, false);
});

test("bootstrap accessor is deleted without invocation", async () => {
  const host = {};
  let reads = 0;
  Object.defineProperty(host, BROWSER_PROSE_DIAGNOSTIC_BOOTSTRAP_GLOBAL, {
    get() {
      reads += 1;
      return validBootstrap;
    },
    configurable: true,
  });
  assert.equal(await initializeBrowserProseDiagnosticBridge(host, true), null);
  assert.equal(reads, 0);
  assert.equal(BROWSER_PROSE_DIAGNOSTIC_BOOTSTRAP_GLOBAL in host, false);
});

test("valid bootstrap creates an exact sealed safe bridge", async () => {
  const host = {};
  installBootstrap(host, validBootstrap);
  const bridge = await initializeBrowserProseDiagnosticBridge(host, true);
  assert.ok(bridge);
  assert.equal(BROWSER_PROSE_DIAGNOSTIC_BOOTSTRAP_GLOBAL in host, false);
  assert.equal(bridge.schemaVersion, BROWSER_PROSE_DIAGNOSTIC_BRIDGE_VERSION);
  assert.equal(
    bridge.authorizationDigest,
    await digestBrowserProseDiagnosticAuthorization(validBootstrap),
  );
  assert.equal(bridge.matrixDigest, matrixDigest);
  assert.equal(Object.isFrozen(bridge), true);
  exactKeys(bridge, [
    "schemaVersion",
    "authorizationDigest",
    "matrixDigest",
    "arm",
    "snapshot",
  ]);
  const descriptor = Object.getOwnPropertyDescriptor(
    host,
    BROWSER_PROSE_DIAGNOSTIC_BRIDGE_GLOBAL,
  );
  assert.deepEqual({
    enumerable: descriptor?.enumerable,
    writable: descriptor?.writable,
    configurable: descriptor?.configurable,
  }, {
    enumerable: false,
    writable: false,
    configurable: false,
  });
  assert.equal(descriptor?.value, bridge);
  assert.equal(Reflect.deleteProperty(host, BROWSER_PROSE_DIAGNOSTIC_BRIDGE_GLOBAL), false);
  const first = bridge.snapshot();
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.schemaVersion, BROWSER_PROSE_DIAGNOSTIC_SNAPSHOT_VERSION);
  assert.equal(first.state, "idle");
  assert.equal(first.lastCode, "INITIALIZED");
  exactKeys(first, [
    "schemaVersion",
    "state",
    "lastCode",
    "authorizationDigest",
    "matrixDigest",
    "tupleDigest",
    "requestBindingDigest",
    "contextId",
    "consumerOrdinal",
    "baseSeed",
    "armAttempts",
    "armAccepted",
    "consumeAttempts",
    "consumeAccepted",
    "rejectedAttempts",
  ]);
});

test("arm validates exact tuple and cannot be replaced", async () => {
  const host = {};
  installBootstrap(host, validBootstrap);
  const bridge = await initializeBrowserProseDiagnosticBridge(host, true);
  assert.ok(bridge);
  const malformed = await bridge.arm({
    contextId: "context-01",
    consumerOrdinal: 1,
    baseSeed: 17_041,
  });
  assert.deepEqual([malformed.status, malformed.code], ["rejected", "ARM_INPUT_INVALID"]);
  const mismatch = await bridge.arm({
    contextId: "context-01",
    consumerOrdinal: 1,
    baseSeed: 17_041,
    tupleDigest: "0".repeat(64),
  });
  assert.deepEqual(
    [mismatch.status, mismatch.code],
    ["rejected", "TUPLE_DIGEST_MISMATCH"],
  );
  const tupleDigest = await digestBrowserProseDiagnosticTuple({
    authorizationId,
    matrixDigest,
    contextId: "context-01",
    consumerOrdinal: 1,
    baseSeed: 17_041,
  });
  const armed = await bridge.arm({
    contextId: "context-01",
    consumerOrdinal: 1,
    baseSeed: 17_041,
    tupleDigest,
  });
  assert.deepEqual([armed.status, armed.code], ["armed", "ARMED"]);
  assert.equal(armed.tupleDigest, tupleDigest);
  const duplicate = await bridge.arm({
    contextId: "context-02",
    consumerOrdinal: 4,
    baseSeed: 17_041,
    tupleDigest: await digestBrowserProseDiagnosticTuple({
      authorizationId,
      matrixDigest,
      contextId: "context-02",
      consumerOrdinal: 4,
      baseSeed: 17_041,
    }),
  });
  assert.deepEqual(
    [duplicate.status, duplicate.code],
    ["rejected", "BRIDGE_ALREADY_ARMED"],
  );
  assert.deepEqual(
    [bridge.snapshot().contextId, bridge.snapshot().consumerOrdinal],
    ["context-01", 1],
  );
});

test("one eligible request receives the seed and exact binding digest", async () => {
  const host = {};
  installBootstrap(host, validBootstrap);
  const bridge = await initializeBrowserProseDiagnosticBridge(host, true);
  assert.ok(bridge);
  const tupleDigest = await digestBrowserProseDiagnosticTuple({
    authorizationId,
    matrixDigest,
    contextId: "context-03",
    consumerOrdinal: 8,
    baseSeed: 27_043,
  });
  await bridge.arm({
    contextId: "context-03",
    consumerOrdinal: 8,
    baseSeed: 27_043,
    tupleDigest,
  });
  const request = {
    projectId: "project-03",
    sessionId: "session-03",
    taskType: "chapter.continue",
    requestId: "conversation-agent:0053f334-4284-4a6d-8ad6-6284f971dd01",
  };
  const applied = await consumeBrowserProseDiagnosticSeed(request, host, true);
  assert.ok(applied);
  assert.deepEqual(
    [applied.status, applied.code, applied.baseSeed],
    ["applied", "SEED_APPLIED", 27_043],
  );
  const expectedBinding = await digestBrowserProseDiagnosticRequestBinding({
    authorizationDigest: bridge.authorizationDigest,
    matrixDigest,
    tupleDigest,
    ...request,
  });
  assert.equal(applied.requestBindingDigest, expectedBinding);
  const replay = await consumeBrowserProseDiagnosticSeed(request, host, true);
  assert.ok(replay);
  assert.deepEqual(
    [replay.status, replay.code, replay.baseSeed, replay.requestBindingDigest],
    ["rejected", "BRIDGE_ALREADY_CONSUMED", null, null],
  );
  const rearm = await bridge.arm({
    contextId: "context-03",
    consumerOrdinal: 8,
    baseSeed: 27_043,
    tupleDigest,
  });
  assert.deepEqual(
    [rearm.status, rearm.code],
    ["rejected", "BRIDGE_ALREADY_CONSUMED"],
  );
  const final = bridge.snapshot();
  assert.equal(final.state, "consumed");
  assert.equal(final.requestBindingDigest, expectedBinding);
  assert.deepEqual({
    armAttempts: final.armAttempts,
    armAccepted: final.armAccepted,
    consumeAttempts: final.consumeAttempts,
    consumeAccepted: final.consumeAccepted,
    rejectedAttempts: final.rejectedAttempts,
  }, {
    armAttempts: 2,
    armAccepted: 1,
    consumeAttempts: 2,
    consumeAccepted: 1,
    rejectedAttempts: 2,
  });
  const serialized = JSON.stringify({ bridge, applied, final });
  for (const forbidden of [
    authorizationId,
    request.projectId,
    request.sessionId,
    request.requestId,
    "prompt",
    "story",
    "output",
  ]) assert.equal(serialized.includes(forbidden), false);
});

test("unarmed and malformed requests fail closed", async () => {
  const unarmedHost = {};
  installBootstrap(unarmedHost, validBootstrap);
  const unarmedBridge = await initializeBrowserProseDiagnosticBridge(
    unarmedHost,
    true,
  );
  assert.ok(unarmedBridge);
  const request = {
    projectId: "project-safe",
    sessionId: "session-safe",
    taskType: "chapter.continue",
    requestId: "request-safe",
  };
  const unarmed = await consumeBrowserProseDiagnosticSeed(request, unarmedHost, true);
  assert.deepEqual(
    [unarmed?.status, unarmed?.code, unarmed?.baseSeed],
    ["rejected", "BRIDGE_NOT_ARMED", null],
  );
  const malformedHost = {};
  installBootstrap(malformedHost, validBootstrap);
  const malformedBridge = await initializeBrowserProseDiagnosticBridge(
    malformedHost,
    true,
  );
  assert.ok(malformedBridge);
  const tupleDigest = await digestBrowserProseDiagnosticTuple({
    authorizationId,
    matrixDigest,
    contextId: "context-04",
    consumerOrdinal: 12,
    baseSeed: 37_049,
  });
  await malformedBridge.arm({
    contextId: "context-04",
    consumerOrdinal: 12,
    baseSeed: 37_049,
    tupleDigest,
  });
  const malformed = await consumeBrowserProseDiagnosticSeed({
    ...request,
    taskType: "assistant.general",
  }, malformedHost, true);
  assert.deepEqual(
    [malformed?.status, malformed?.code, malformed?.baseSeed],
    ["rejected", "REQUEST_BINDING_INVALID", null],
  );
  assert.equal(malformedBridge.snapshot().state, "consumed");
  const afterBurn = await consumeBrowserProseDiagnosticSeed(
    request,
    malformedHost,
    true,
  );
  assert.equal(afterBurn?.code, "BRIDGE_ALREADY_CONSUMED");
});

test("same document cannot replace authorization and reload needs bootstrap", async () => {
  const host = {};
  installBootstrap(host, validBootstrap);
  const first = await initializeBrowserProseDiagnosticBridge(host, true);
  assert.ok(first);
  const replacement = bootstrap(
    "ce09f995-abcb-42f3-b69e-f32a2d158aff",
    "f".repeat(64),
  );
  installBootstrap(host, replacement);
  const second = await initializeBrowserProseDiagnosticBridge(host, true);
  assert.equal(second, first);
  assert.equal(BROWSER_PROSE_DIAGNOSTIC_BOOTSTRAP_GLOBAL in host, false);
  assert.equal(second?.authorizationDigest, first.authorizationDigest);

  const reloadWithoutBootstrap = {};
  assert.equal(
    await initializeBrowserProseDiagnosticBridge(reloadWithoutBootstrap, true),
    null,
  );
  assert.equal(BROWSER_PROSE_DIAGNOSTIC_BRIDGE_GLOBAL in reloadWithoutBootstrap, false);
  installBootstrap(reloadWithoutBootstrap, validBootstrap);
  assert.equal(
    await initializeBrowserProseDiagnosticBridge(reloadWithoutBootstrap, true),
    null,
  );
  assert.equal(BROWSER_PROSE_DIAGNOSTIC_BOOTSTRAP_GLOBAL in reloadWithoutBootstrap, false);

  const reloadedAndBootstrapped = {};
  installBootstrap(reloadedAndBootstrapped, validBootstrap);
  assert.ok(await initializeBrowserProseDiagnosticBridge(
    reloadedAndBootstrapped,
    true,
  ));
});

test("matrix, request-binding, and consumer source contracts are exact", async () => {
  await assert.rejects(
    digestBrowserProseDiagnosticMatrix(matrix.slice(0, 11)),
    /BROWSER_PROSE_DIAGNOSTIC_MATRIX_INVALID/u,
  );
  const tupleDigest = await digestBrowserProseDiagnosticTuple({
    authorizationId,
    matrixDigest,
    contextId: "context-01",
    consumerOrdinal: 2,
    baseSeed: 27_043,
  });
  const authorizationDigest = await digestBrowserProseDiagnosticAuthorization(
    validBootstrap,
  );
  const left = await digestBrowserProseDiagnosticRequestBinding({
    authorizationDigest,
    matrixDigest,
    tupleDigest,
    projectId: "project-01",
    sessionId: "session-01",
    taskType: "chapter.continue",
    requestId: "request-left",
  });
  const right = await digestBrowserProseDiagnosticRequestBinding({
    authorizationDigest,
    matrixDigest,
    tupleDigest,
    projectId: "project-01",
    sessionId: "session-01",
    taskType: "chapter.continue",
    requestId: "request-right",
  });
  assert.notEqual(left, right);

  const [bridgeSource, consumerSource, consumerHookSource] = await Promise.all([
    readFile(
      "lib/novel-ai/web/browser-prose-diagnostic-bridge.ts",
      "utf8",
    ),
    readFile(
      "app/studio/project/[projectId]/chat/conversation-workspace.tsx",
      "utf8",
    ),
    readFile(
      "app/studio/project/[projectId]/chat/hooks/use-browser-prose-diagnostics.ts",
      "utf8",
    ),
  ]);
  assert.match(
    bridgeSource,
    /process\.env\.NEXT_PUBLIC_RC6_4_BROWSER_PROSE_DIAGNOSTICS === "1"/u,
  );
  assert.match(consumerHookSource, /initializeBrowserProseDiagnosticBridge\(\)/u);
  assert.match(consumerHookSource, /consumeBrowserProseDiagnosticSeed\(\{/u);
  assert.match(consumerSource, /useProseDiagnostics\(\)/u);
  assert.match(consumerSource, /generationOptions: await proseSeedOptions\(/u);
  assert.doesNotMatch(bridgeSource, /promptText|storyText|rawOutput|selectedPrefix/u);
});

let passed = 0;
for (const entry of tests) {
  try {
    await entry.run();
    passed += 1;
    process.stdout.write(`PASS ${entry.name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${entry.name}\n${error?.stack ?? error}\n`);
    process.exitCode = 1;
  }
}

process.stdout.write(`${JSON.stringify({
  suite: "P2.4B_RC6_4_BROWSER_PROSE_DIAGNOSTIC_SEED_BRIDGE",
  pass: passed,
  fail: tests.length - passed,
  tests: tests.map((entry) => entry.name),
})}\n`);

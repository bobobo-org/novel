import assert from "node:assert/strict";
import { promoteDualAliases } from "./vercel-dual-alias-cutover.mjs";

const PRIMARY = "primary-pr23-r21.invalid";
const MIRROR = "mirror-pr23-r21.invalid";
const BEFORE_PRIMARY = {
  deploymentId: "dpl_before_primary",
  appCommit: "a".repeat(40),
};
const BEFORE_MIRROR = {
  deploymentId: "dpl_before_mirror",
  appCommit: "b".repeat(40),
};
const STAGED = {
  deploymentId: "dpl_staged",
  appCommit: "c".repeat(40),
};
const TARGET = "https://staged-pr23-r21.invalid";

function harness(failureMode = null) {
  const state = new Map([
    [PRIMARY, BEFORE_PRIMARY],
    [MIRROR, BEFORE_MIRROR],
  ]);
  const operations = [];
  const identityByTarget = new Map([
    [BEFORE_PRIMARY.deploymentId, BEFORE_PRIMARY],
    [BEFORE_MIRROR.deploymentId, BEFORE_MIRROR],
    [TARGET, STAGED],
  ]);
  return {
    state,
    operations,
    setAlias: async (target, alias, phase) => {
      operations.push({ target, alias, phase });
      state.set(alias, identityByTarget.get(target));
    },
    readIdentity: async (alias, context) => {
      const current = state.get(alias);
      if (
        failureMode === "mirror-verification"
        && context.phase === "verify-mirror"
      ) {
        return {
          ...current,
          deploymentId: "dpl_wrong_mirror",
          provenanceStatus: "verified",
        };
      }
      if (
        failureMode === "primary-verification"
        && context.phase === "verify-primary"
      ) {
        return {
          ...current,
          deploymentId: "dpl_wrong_primary",
          provenanceStatus: "verified",
        };
      }
      return { ...current, provenanceStatus: "verified" };
    },
  };
}

const silentLogger = {
  log() {},
  error() {},
};

async function runScenario(failureMode) {
  const current = harness(failureMode);
  const execute = () => promoteDualAliases({
    primaryAlias: PRIMARY,
    mirrorAlias: MIRROR,
    stagedTarget: TARGET,
    stagedIdentity: STAGED,
    primaryBeforeIdentity: BEFORE_PRIMARY,
    mirrorBeforeIdentity: BEFORE_MIRROR,
    setAlias: current.setAlias,
    readIdentity: current.readIdentity,
    verifyAttempts: 1,
    verifyDelayMs: 0,
    logger: silentLogger,
  });
  return { current, execute };
}

const success = await runScenario(null);
const successResult = await success.execute();
assert.equal(successResult.status, "PASS");
assert.deepEqual(success.current.state.get(PRIMARY), STAGED);
assert.deepEqual(success.current.state.get(MIRROR), STAGED);
assert.equal(successResult.rollbackPerformed, false);

for (const failureMode of [
  "mirror-verification",
  "primary-verification",
]) {
  const scenario = await runScenario(failureMode);
  await assert.rejects(
    scenario.execute(),
    (error) => error?.code === "DUAL_ALIAS_CUTOVER_ROLLED_BACK",
  );
  assert.deepEqual(scenario.current.state.get(PRIMARY), BEFORE_PRIMARY);
  assert.deepEqual(scenario.current.state.get(MIRROR), BEFORE_MIRROR);
  assert.ok(
    scenario.current.operations.some((operation) =>
      operation.phase === "rollback-primary"
      && operation.target === BEFORE_PRIMARY.deploymentId),
  );
  assert.ok(
    scenario.current.operations.some((operation) =>
      operation.phase === "rollback-mirror"
      && operation.target === BEFORE_MIRROR.deploymentId),
  );
}

console.log(JSON.stringify({
  schemaVersion: "pr23-r2-1-dual-alias-atomic-rollback-v1",
  status: "PASS",
  aliases: [PRIMARY, MIRROR],
  productionAliasesTouched: 0,
  successCutoverVerified: true,
  mirrorFailureRestoredBoth: true,
  primaryFailureRestoredBoth: true,
  restoredDeploymentIdentityMatch: true,
}, null, 2));

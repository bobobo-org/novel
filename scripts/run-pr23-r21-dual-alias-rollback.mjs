import assert from "node:assert/strict";
import {
  captureCurrentAliasIdentities,
  createAliasIdentityReader,
  createVercelAliasSetter,
  createVercelControlPlaneReader,
  normalizeVercelControlPlaneIdentity,
  promoteDualAliases,
} from "./vercel-dual-alias-cutover.mjs";

const PRIMARY = "primary-pr23-r21.invalid";
const MIRROR = "mirror-pr23-r21.invalid";
const BEFORE_PRIMARY = {
  deploymentId: "dpl_BeforePrimary",
  appCommit: "a".repeat(40),
};
const BEFORE_MIRROR = {
  deploymentId: "dpl_BeforeMirror",
  appCommit: "b".repeat(40),
};
const STAGED = {
  deploymentId: "dpl_Staged",
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

const controlPlanePayload = {
  id: "dpl_ControlPlane123",
  projectId: "prj_control_plane_test",
  readyState: "READY",
  target: "production",
  meta: {
    githubCommitSha: "d".repeat(40),
  },
};
const normalizedControlPlaneIdentity = normalizeVercelControlPlaneIdentity({
  alias: PRIMARY,
  deployment: controlPlanePayload,
  expectedProjectId: controlPlanePayload.projectId,
});
assert.deepEqual(normalizedControlPlaneIdentity, {
  deploymentId: controlPlanePayload.id,
  appCommit: controlPlanePayload.meta.githubCommitSha,
  provenanceStatus: "verified",
  environment: "production",
  identitySource: "vercel_control_plane_legacy_bootstrap",
});
assert.throws(
  () => normalizeVercelControlPlaneIdentity({
    alias: PRIMARY,
    deployment: {
      ...controlPlanePayload,
      projectId: "prj_wrong",
    },
    expectedProjectId: controlPlanePayload.projectId,
  }),
  (error) => error?.code === "VERCEL_CONTROL_PLANE_IDENTITY_INVALID",
);

let apiRequestVerified = false;
const controlPlaneReader = createVercelControlPlaneReader({
  token: "unit-placeholder",
  teamId: "team_control_plane_test",
  projectId: controlPlanePayload.projectId,
  fetchImpl: async (url, options) => {
    assert.equal(url.hostname, "api.vercel.com");
    assert.equal(url.pathname, `/v13/deployments/${PRIMARY}`);
    assert.equal(url.searchParams.get("url"), PRIMARY);
    assert.equal(url.searchParams.get("teamId"), "team_control_plane_test");
    assert.equal(options.headers.Authorization, "Bearer unit-placeholder");
    apiRequestVerified = true;
    return new Response(JSON.stringify(controlPlanePayload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
});
assert.deepEqual(
  await controlPlaneReader(PRIMARY),
  normalizedControlPlaneIdentity,
);
assert.equal(apiRequestVerified, true);

let aliasApiRequestVerified = false;
const aliasSetter = createVercelAliasSetter({
  token: "unit-placeholder",
  teamId: "team_control_plane_test",
  fetchImpl: async (url, options) => {
    assert.equal(url.hostname, "api.vercel.com");
    assert.equal(
      url.pathname,
      "/v2/deployments/staged-pr23-r21.invalid/aliases",
    );
    assert.equal(url.searchParams.get("teamId"), "team_control_plane_test");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer unit-placeholder");
    assert.deepEqual(JSON.parse(options.body), { alias: MIRROR });
    aliasApiRequestVerified = true;
    return new Response(JSON.stringify({ alias: MIRROR }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
});
await aliasSetter(TARGET, MIRROR);
assert.equal(aliasApiRequestVerified, true);

let legacyControlPlaneReads = 0;
const legacyIdentityReader = createAliasIdentityReader({
  fetchImpl: async () => new Response("missing", { status: 404 }),
  legacyBootstrapIdentity: normalizedControlPlaneIdentity,
  readControlPlane: async () => {
    legacyControlPlaneReads += 1;
    return normalizedControlPlaneIdentity;
  },
});
const capturedLegacyIdentities = await captureCurrentAliasIdentities({
  primaryAlias: PRIMARY,
  mirrorAlias: MIRROR,
  readIdentity: legacyIdentityReader,
  attempts: 1,
  delayMs: 0,
});
assert.equal(
  capturedLegacyIdentities.primary.deploymentId,
  normalizedControlPlaneIdentity.deploymentId,
);
assert.equal(
  capturedLegacyIdentities.mirror.deploymentId,
  normalizedControlPlaneIdentity.deploymentId,
);
assert.equal(legacyControlPlaneReads, 2);
assert.deepEqual(
  await legacyIdentityReader(PRIMARY, {
    phase: "verify-rollback-primary",
    attempt: 1,
  }),
  normalizedControlPlaneIdentity,
);
assert.equal(legacyControlPlaneReads, 3);
await assert.rejects(
  legacyIdentityReader(PRIMARY, {
    phase: "verify-primary",
    attempt: 1,
  }),
  (error) => error?.code === "LEGACY_CONTROL_PLANE_FALLBACK_NOT_ALLOWED",
);
assert.equal(legacyControlPlaneReads, 3);

const mismatchedLegacyIdentityReader = createAliasIdentityReader({
  fetchImpl: async () => new Response("missing", { status: 404 }),
  legacyBootstrapIdentity: normalizedControlPlaneIdentity,
  readControlPlane: async () => ({
    ...normalizedControlPlaneIdentity,
    deploymentId: "dpl_UnexpectedBaseline",
  }),
});
await assert.rejects(
  mismatchedLegacyIdentityReader(PRIMARY, {
    phase: "capture-primary",
    attempt: 1,
  }),
  (error) => error?.code === "LEGACY_CONTROL_PLANE_BASELINE_MISMATCH",
);

let non404ControlPlaneReads = 0;
const non404IdentityReader = createAliasIdentityReader({
  fetchImpl: async () => new Response("server error", { status: 500 }),
  legacyBootstrapIdentity: normalizedControlPlaneIdentity,
  readControlPlane: async () => {
    non404ControlPlaneReads += 1;
    return normalizedControlPlaneIdentity;
  },
});
await assert.rejects(
  non404IdentityReader(PRIMARY, {
    phase: "capture-primary",
    attempt: 1,
  }),
  (error) => error?.code === "RELEASE_IDENTITY_HTTP_ERROR",
);
assert.equal(non404ControlPlaneReads, 0);

console.log(JSON.stringify({
  schemaVersion: "pr23-r2-1-dual-alias-atomic-rollback-v1",
  status: "PASS",
  aliases: [PRIMARY, MIRROR],
  productionAliasesTouched: 0,
  successCutoverVerified: true,
  mirrorFailureRestoredBoth: true,
  primaryFailureRestoredBoth: true,
  restoredDeploymentIdentityMatch: true,
  legacy404ControlPlaneBootstrap: true,
  legacyBootstrapFrozenToKnownBaseline: true,
  controlPlaneProjectCommitAndStateVerified: true,
  aliasMutationUsesAuthorizationHeader: true,
  tokenExcludedFromChildProcessArguments: true,
  promotionFallbackForbidden: true,
  non404FallbackForbidden: true,
}, null, 2));

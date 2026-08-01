import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const LEGACY_CONTROL_PLANE_PHASES = new Set([
  "capture-primary",
  "capture-mirror",
  "verify-rollback-primary",
  "verify-rollback-mirror",
]);

function cutoverError(code, details = {}) {
  return Object.assign(new Error(code), { code, details });
}

function isCommitSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
}

function isDeploymentId(value) {
  return typeof value === "string" && /^dpl_[A-Za-z0-9]+$/u.test(value);
}

export function normalizeVercelControlPlaneIdentity({
  alias,
  deployment,
  expectedProjectId,
}) {
  const deploymentId = deployment?.id ?? deployment?.uid ?? null;
  const appCommit = deployment?.meta?.githubCommitSha ?? null;
  const projectId = deployment?.projectId ?? deployment?.project?.id ?? null;
  const readyState = deployment?.readyState ?? deployment?.state ?? null;
  const target = deployment?.target ?? null;
  if (
    !isDeploymentId(deploymentId)
    || !isCommitSha(appCommit)
    || projectId !== expectedProjectId
    || readyState !== "READY"
    || target !== "production"
  ) {
    throw cutoverError("VERCEL_CONTROL_PLANE_IDENTITY_INVALID", {
      alias,
      deploymentId,
      appCommit,
      projectId,
      readyState,
      target,
    });
  }
  return {
    deploymentId,
    appCommit,
    provenanceStatus: "verified",
    environment: "production",
    identitySource: "vercel_control_plane_legacy_bootstrap",
  };
}

export function createVercelControlPlaneReader({
  token,
  teamId,
  projectId,
  fetchImpl = fetch,
}) {
  if (!token || !teamId || !projectId) {
    throw cutoverError("VERCEL_CONTROL_PLANE_CONFIGURATION_INCOMPLETE");
  }
  return async (alias) => {
    const url = new URL(
      `https://api.vercel.com/v13/deployments/${encodeURIComponent(alias)}`,
    );
    url.searchParams.set("url", alias);
    url.searchParams.set("teamId", teamId);
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
    if (!response.ok) {
      throw cutoverError("VERCEL_CONTROL_PLANE_HTTP_ERROR", {
        alias,
        status: response.status,
      });
    }
    let deployment;
    try {
      deployment = await response.json();
    } catch {
      throw cutoverError("VERCEL_CONTROL_PLANE_JSON_INVALID", { alias });
    }
    return normalizeVercelControlPlaneIdentity({
      alias,
      deployment,
      expectedProjectId: projectId,
    });
  };
}

export function createVercelAliasSetter({
  token,
  teamId,
  fetchImpl = fetch,
}) {
  if (!token || !teamId) {
    throw cutoverError("VERCEL_ALIAS_CONFIGURATION_INCOMPLETE");
  }
  return async (target, alias) => {
    const deployment = String(target)
      .replace(/^https?:\/\//u, "")
      .replace(/\/+$/u, "");
    if (!deployment || !alias) {
      throw cutoverError("VERCEL_ALIAS_TARGET_INVALID");
    }
    const url = new URL(
      `https://api.vercel.com/v2/deployments/${encodeURIComponent(deployment)}/aliases`,
    );
    url.searchParams.set("teamId", teamId);
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ alias }),
      cache: "no-store",
    });
    if (!response.ok) {
      throw cutoverError("VERCEL_ALIAS_SET_FAILED", {
        alias,
        status: response.status,
      });
    }
  };
}

export function createAliasIdentityReader({
  readControlPlane,
  legacyBootstrapIdentity,
  fetchImpl = fetch,
}) {
  return async (alias, context) => {
    const query = new URLSearchParams({
      phase: context.phase,
      attempt: String(context.attempt),
      run: process.env.GITHUB_RUN_ID ?? "local",
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "0",
    });
    const response = await fetchImpl(
      `https://${alias}/api/release/identity?${query}`,
      { cache: "no-store" },
    );
    if (response.ok) {
      const identity = await response.json();
      return {
        ...identity,
        identitySource: "release_identity_endpoint",
      };
    }
    if (response.status !== 404) {
      throw cutoverError("RELEASE_IDENTITY_HTTP_ERROR", {
        alias,
        status: response.status,
      });
    }
    if (!LEGACY_CONTROL_PLANE_PHASES.has(context.phase)) {
      throw cutoverError("LEGACY_CONTROL_PLANE_FALLBACK_NOT_ALLOWED", {
        alias,
        phase: context.phase,
      });
    }
    if (typeof readControlPlane !== "function") {
      throw cutoverError("LEGACY_CONTROL_PLANE_READER_MISSING", {
        alias,
        phase: context.phase,
      });
    }
    const identity = await readControlPlane(alias);
    if (
      !isDeploymentId(legacyBootstrapIdentity?.deploymentId)
      || !isCommitSha(legacyBootstrapIdentity?.appCommit)
      || identity?.deploymentId !== legacyBootstrapIdentity.deploymentId
      || identity?.appCommit !== legacyBootstrapIdentity.appCommit
    ) {
      throw cutoverError("LEGACY_CONTROL_PLANE_BASELINE_MISMATCH", {
        alias,
        phase: context.phase,
        expectedDeploymentId:
          legacyBootstrapIdentity?.deploymentId ?? null,
        expectedCommit: legacyBootstrapIdentity?.appCommit ?? null,
        observedDeploymentId: identity?.deploymentId ?? null,
        observedCommit: identity?.appCommit ?? null,
      });
    }
    return identity;
  };
}

function assertCapturedIdentity(alias, identity) {
  if (
    identity?.provenanceStatus !== "verified"
    || !isDeploymentId(identity?.deploymentId)
    || !isCommitSha(identity?.appCommit)
  ) {
    throw cutoverError("CAPTURED_ALIAS_IDENTITY_INVALID", {
      alias,
      identitySource: identity?.identitySource ?? null,
    });
  }
  return identity;
}

export async function captureCurrentAliasIdentities({
  primaryAlias,
  mirrorAlias,
  readIdentity,
  attempts = 5,
  delayMs = 1_000,
}) {
  const capture = async (alias, label) => {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return assertCapturedIdentity(
          alias,
          await readIdentity(alias, {
            attempt,
            phase: `capture-${label}`,
          }),
        );
      } catch (error) {
        lastError = error;
      }
      if (attempt < attempts && delayMs > 0) await delay(delayMs);
    }
    throw cutoverError("ALIAS_IDENTITY_CAPTURE_FAILED", {
      alias,
      code: lastError?.code ?? "ALIAS_IDENTITY_CAPTURE_UNKNOWN",
    });
  };
  const [primary, mirror] = await Promise.all([
    capture(primaryAlias, "primary"),
    capture(mirrorAlias, "mirror"),
  ]);
  return { primary, mirror };
}

async function verifyAliasIdentity({
  alias,
  expected,
  phase,
  readIdentity,
  attempts,
  delayMs,
}) {
  let lastIdentity = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const identity = await readIdentity(alias, {
        attempt,
        phase,
      });
      lastIdentity = identity;
      if (
        identity?.provenanceStatus === "verified"
        && identity?.deploymentId === expected.deploymentId
        && identity?.appCommit === expected.appCommit
      ) {
        return identity;
      }
    } catch (error) {
      lastIdentity = {
        errorCode: error?.code ?? "IDENTITY_READ_FAILED",
      };
    }
    if (attempt < attempts && delayMs > 0) await delay(delayMs);
  }
  throw cutoverError("ALIAS_IDENTITY_MISMATCH", {
    alias,
    phase,
    expected,
    observed: lastIdentity,
  });
}

export async function promoteDualAliases({
  primaryAlias,
  mirrorAlias,
  stagedTarget,
  stagedIdentity,
  primaryBeforeIdentity,
  mirrorBeforeIdentity,
  setAlias,
  readIdentity,
  verifyAttempts = 30,
  verifyDelayMs = 2_000,
  logger = console,
}) {
  if (!primaryAlias || !mirrorAlias || primaryAlias === mirrorAlias) {
    throw cutoverError("DUAL_ALIAS_CONFIGURATION_INVALID");
  }
  for (const identity of [
    stagedIdentity,
    primaryBeforeIdentity,
    mirrorBeforeIdentity,
  ]) {
    if (!identity?.deploymentId || !identity?.appCommit) {
      throw cutoverError("DUAL_ALIAS_IDENTITY_INCOMPLETE");
    }
  }

  let cutoverAttempted = false;
  try {
    cutoverAttempted = true;
    await setAlias(stagedTarget, mirrorAlias, "promote-mirror");
    await verifyAliasIdentity({
      alias: mirrorAlias,
      expected: stagedIdentity,
      phase: "verify-mirror",
      readIdentity,
      attempts: verifyAttempts,
      delayMs: verifyDelayMs,
    });
    await setAlias(stagedTarget, primaryAlias, "promote-primary");
    await verifyAliasIdentity({
      alias: primaryAlias,
      expected: stagedIdentity,
      phase: "verify-primary",
      readIdentity,
      attempts: verifyAttempts,
      delayMs: verifyDelayMs,
    });
    logger.log("DUAL_ALIAS_CUTOVER_VERIFIED");
    return {
      status: "PASS",
      primary: stagedIdentity,
      mirror: stagedIdentity,
      rollbackPerformed: false,
    };
  } catch (cutoverFailure) {
    if (!cutoverAttempted) throw cutoverFailure;
    logger.error("DUAL_ALIAS_CUTOVER_FAILED_ROLLBACK_STARTED");
    const rollbackFailures = [];
    for (const [target, alias, phase] of [
      [primaryBeforeIdentity.deploymentId, primaryAlias, "rollback-primary"],
      [mirrorBeforeIdentity.deploymentId, mirrorAlias, "rollback-mirror"],
    ]) {
      try {
        await setAlias(target, alias, phase);
      } catch (error) {
        rollbackFailures.push({
          phase,
          code: error?.code ?? "ALIAS_SET_FAILED",
        });
      }
    }
    for (const [alias, expected, phase] of [
      [primaryAlias, primaryBeforeIdentity, "verify-rollback-primary"],
      [mirrorAlias, mirrorBeforeIdentity, "verify-rollback-mirror"],
    ]) {
      try {
        await verifyAliasIdentity({
          alias,
          expected,
          phase,
          readIdentity,
          attempts: verifyAttempts,
          delayMs: verifyDelayMs,
        });
      } catch (error) {
        rollbackFailures.push({
          phase,
          code: error?.code ?? "ALIAS_ROLLBACK_VERIFY_FAILED",
        });
      }
    }
    if (rollbackFailures.length > 0) {
      throw cutoverError("DUAL_ALIAS_ROLLBACK_FAILED", {
        cutoverFailure: cutoverFailure?.code ?? "DUAL_ALIAS_CUTOVER_FAILED",
        rollbackFailures,
      });
    }
    logger.error("DUAL_ALIAS_ROLLBACK_VERIFIED");
    throw cutoverError("DUAL_ALIAS_CUTOVER_ROLLED_BACK", {
      cutoverFailure: cutoverFailure?.code ?? "DUAL_ALIAS_CUTOVER_FAILED",
      primaryRestored: true,
      mirrorRestored: true,
    });
  }
}

export async function restoreDualAliases({
  primaryAlias,
  mirrorAlias,
  primaryIdentity,
  mirrorIdentity,
  setAlias,
  readIdentity,
  verifyAttempts = 30,
  verifyDelayMs = 2_000,
  logger = console,
}) {
  if (!primaryAlias || !mirrorAlias || primaryAlias === mirrorAlias) {
    throw cutoverError("DUAL_ALIAS_CONFIGURATION_INVALID");
  }
  for (const [alias, identity] of [
    [primaryAlias, primaryIdentity],
    [mirrorAlias, mirrorIdentity],
  ]) {
    if (
      !isDeploymentId(identity?.deploymentId)
      || !isCommitSha(identity?.appCommit)
    ) {
      throw cutoverError("RESTORE_ALIAS_IDENTITY_INVALID", { alias });
    }
  }

  const failures = [];
  for (const [target, alias, phase] of [
    [primaryIdentity.deploymentId, primaryAlias, "restore-primary"],
    [mirrorIdentity.deploymentId, mirrorAlias, "restore-mirror"],
  ]) {
    try {
      await setAlias(target, alias, phase);
    } catch (error) {
      failures.push({ phase, code: error?.code ?? "ALIAS_SET_FAILED" });
    }
  }
  for (const [alias, expected, phase] of [
    [primaryAlias, primaryIdentity, "verify-rollback-primary"],
    [mirrorAlias, mirrorIdentity, "verify-rollback-mirror"],
  ]) {
    try {
      await verifyAliasIdentity({
        alias,
        expected,
        phase,
        readIdentity,
        attempts: verifyAttempts,
        delayMs: verifyDelayMs,
      });
    } catch (error) {
      failures.push({
        phase,
        code: error?.code ?? "ALIAS_RESTORE_VERIFY_FAILED",
      });
    }
  }
  if (failures.length > 0) {
    throw cutoverError("DUAL_ALIAS_RESTORE_FAILED", { failures });
  }
  logger.log("DUAL_ALIAS_RESTORE_VERIFIED");
  return {
    status: "PASS",
    primary: primaryIdentity,
    mirror: mirrorIdentity,
  };
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw cutoverError(`MISSING_ENVIRONMENT:${name}`);
  return value;
}

function createEnvironmentIdentityReader() {
  const readControlPlane = createVercelControlPlaneReader({
    token: requiredEnvironment("VERCEL_TOKEN"),
    teamId: requiredEnvironment("VERCEL_ORG_ID"),
    projectId: requiredEnvironment("VERCEL_PROJECT_ID"),
  });
  return createAliasIdentityReader({
    readControlPlane,
    legacyBootstrapIdentity: {
      deploymentId: requiredEnvironment("LEGACY_BOOTSTRAP_DEPLOYMENT_ID"),
      appCommit: requiredEnvironment("LEGACY_BOOTSTRAP_COMMIT"),
    },
  });
}

async function runCaptureCli() {
  const primaryAlias = requiredEnvironment("PRIMARY_ALIAS");
  const mirrorAlias = requiredEnvironment("MIRROR_ALIAS");
  const outputPath = requiredEnvironment("GITHUB_OUTPUT");
  const identities = await captureCurrentAliasIdentities({
    primaryAlias,
    mirrorAlias,
    readIdentity: createEnvironmentIdentityReader(),
  });
  appendFileSync(
    outputPath,
    [
      `primary_deployment_id=${identities.primary.deploymentId}`,
      `primary_app_commit=${identities.primary.appCommit}`,
      `mirror_deployment_id=${identities.mirror.deploymentId}`,
      `mirror_app_commit=${identities.mirror.appCommit}`,
      "",
    ].join("\n"),
    "utf8",
  );
  console.log("VERCEL_ALIAS_IDENTITIES_CAPTURED");
}

async function runCutoverCli() {
  const primaryAlias = requiredEnvironment("PRIMARY_ALIAS");
  const mirrorAlias = requiredEnvironment("MIRROR_ALIAS");
  const stagedTarget = requiredEnvironment("STAGED_TARGET");
  const stagedIdentity = {
    deploymentId: requiredEnvironment("STAGED_DEPLOYMENT_ID"),
    appCommit: requiredEnvironment("EXPECTED_COMMIT"),
  };
  const primaryBeforeIdentity = {
    deploymentId: requiredEnvironment("PRIMARY_BEFORE_DEPLOYMENT"),
    appCommit: requiredEnvironment("PRIMARY_BEFORE_COMMIT"),
  };
  const mirrorBeforeIdentity = {
    deploymentId: requiredEnvironment("MIRROR_BEFORE_DEPLOYMENT"),
    appCommit: requiredEnvironment("MIRROR_BEFORE_COMMIT"),
  };
  const token = requiredEnvironment("VERCEL_TOKEN");
  const teamId = requiredEnvironment("VERCEL_ORG_ID");
  const readIdentity = createEnvironmentIdentityReader();
  const setAlias = createVercelAliasSetter({ token, teamId });
  await promoteDualAliases({
    primaryAlias,
    mirrorAlias,
    stagedTarget,
    stagedIdentity,
    primaryBeforeIdentity,
    mirrorBeforeIdentity,
    setAlias,
    readIdentity,
  });
}

async function runRestoreCli() {
  const primaryAlias = requiredEnvironment("PRIMARY_ALIAS");
  const mirrorAlias = requiredEnvironment("MIRROR_ALIAS");
  const primaryIdentity = {
    deploymentId: requiredEnvironment("PRIMARY_BEFORE_DEPLOYMENT"),
    appCommit: requiredEnvironment("PRIMARY_BEFORE_COMMIT"),
  };
  const mirrorIdentity = {
    deploymentId: requiredEnvironment("MIRROR_BEFORE_DEPLOYMENT"),
    appCommit: requiredEnvironment("MIRROR_BEFORE_COMMIT"),
  };
  const token = requiredEnvironment("VERCEL_TOKEN");
  const teamId = requiredEnvironment("VERCEL_ORG_ID");
  await restoreDualAliases({
    primaryAlias,
    mirrorAlias,
    primaryIdentity,
    mirrorIdentity,
    setAlias: createVercelAliasSetter({ token, teamId }),
    readIdentity: createEnvironmentIdentityReader(),
  });
}

async function runCli() {
  const mode = process.argv[2] ?? "cutover";
  if (mode === "capture") {
    await runCaptureCli();
    return;
  }
  if (mode === "cutover") {
    await runCutoverCli();
    return;
  }
  if (mode === "restore") {
    await runRestoreCli();
    return;
  }
  throw cutoverError("UNKNOWN_CLI_MODE", { mode });
}

if (
  process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url
) {
  runCli().catch((error) => {
    console.error(error?.code ?? "DUAL_ALIAS_CUTOVER_FAILED");
    process.exitCode = 1;
  });
}

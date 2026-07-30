import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function cutoverError(code, details = {}) {
  return Object.assign(new Error(code), { code, details });
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

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw cutoverError(`MISSING_ENVIRONMENT:${name}`);
  return value;
}

async function runCli() {
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
  const scope = requiredEnvironment("VERCEL_SCOPE");
  const token = requiredEnvironment("VERCEL_TOKEN");
  const setAlias = async (target, alias) => {
    const result = spawnSync(
      "vercel",
      [
        "alias",
        "set",
        target,
        alias,
        `--scope=${scope}`,
        `--token=${token}`,
      ],
      {
        encoding: "utf8",
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (result.status !== 0) {
      throw cutoverError("VERCEL_ALIAS_SET_FAILED", {
        alias,
        exitCode: result.status,
      });
    }
  };
  const readIdentity = async (alias, context) => {
    const query = new URLSearchParams({
      phase: context.phase,
      attempt: String(context.attempt),
      run: process.env.GITHUB_RUN_ID ?? "local",
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "0",
    });
    const response = await fetch(
      `https://${alias}/api/release/identity?${query}`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw cutoverError("RELEASE_IDENTITY_HTTP_ERROR", {
        alias,
        status: response.status,
      });
    }
    return response.json();
  };
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

if (
  process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url
) {
  runCli().catch((error) => {
    console.error(error?.code ?? "DUAL_ALIAS_CUTOVER_FAILED");
    process.exitCode = 1;
  });
}

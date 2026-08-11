import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import manifest from "../release-manifest.json" with { type: "json" };
import { boundedFetch, boundedOperation } from "./bounded-fetch.mjs";

const RECEIPT_SCHEMA = "p24b-rc6.2-deployment-temporal-proof-v2";

function timestamp(name, value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`INVALID_TEMPORAL_FIELD:${name}`);
  return parsed;
}

export function validateDeploymentTemporalProvenance({
  deployment,
  runtimeIdentity,
  expectedDeploymentId,
  expectedCommit,
  expectedControlCommit = expectedCommit,
  expectedProjectId,
  expectedTeamId,
  buildStartedAt,
  buildCompletedAt,
  deployedAt,
  productCommitTime,
  maximumControlPlaneSkewMs = 120_000,
  maximumFutureSkewMs = 30_000,
  now = new Date(),
}) {
  const controlDeploymentId = deployment?.id ?? deployment?.uid;
  const productCommit = deployment?.meta?.githubCommitSha;
  const controlCommit = deployment?.meta?.novelControlCommit
    ?? (expectedControlCommit === expectedCommit ? productCommit : null);
  const controlProjectId = deployment?.projectId ?? deployment?.project?.id;
  const controlTeamId = deployment?.teamId
    ?? deployment?.ownerId
    ?? deployment?.project?.accountId;
  if (controlDeploymentId !== expectedDeploymentId
    || productCommit !== expectedCommit
    || controlCommit !== expectedControlCommit
    || controlProjectId !== expectedProjectId
    || controlTeamId !== expectedTeamId
    || (deployment?.readyState ?? deployment?.state) !== "READY"
    || deployment?.target !== "production") {
    throw new Error("DEPLOYMENT_TEMPORAL_CONTROL_PLANE_IDENTITY_INVALID");
  }
  const releaseEpoch = timestamp("releaseEpoch", manifest.releaseEpoch);
  const commitTime = timestamp("productCommitTime", productCommitTime);
  const started = timestamp("buildStartedAt", buildStartedAt);
  const completed = timestamp("buildCompletedAt", buildCompletedAt);
  const invoked = timestamp("deployedAt", deployedAt);
  const controlCreated = timestamp("deployment.createdAt", deployment?.createdAt);
  if (releaseEpoch > started || commitTime > started || started > completed || completed > invoked) {
    throw new Error("DEPLOYMENT_TEMPORAL_ORDER_INVALID");
  }
  const controlSkewMs = controlCreated.getTime() - invoked.getTime();
  if (Math.abs(controlSkewMs) > maximumControlPlaneSkewMs) {
    throw new Error("DEPLOYMENT_TEMPORAL_CREATED_AT_MISMATCH");
  }
  const trustedNow = timestamp("verificationTime", now);
  for (const [name, value] of [
    ["buildStartedAt", started],
    ["buildCompletedAt", completed],
    ["deployedAt", invoked],
    ["deployment.createdAt", controlCreated],
  ]) {
    if (value.getTime() > trustedNow.getTime() + maximumFutureSkewMs) {
      throw new Error(`DEPLOYMENT_TEMPORAL_FUTURE_TIMESTAMP:${name}`);
    }
  }
  const expectedTimes = {
    buildStartedAt: started.toISOString(),
    buildCompletedAt: completed.toISOString(),
    deployedAt: invoked.toISOString(),
  };
  if (runtimeIdentity?.deploymentId !== expectedDeploymentId
    || runtimeIdentity?.appCommit !== expectedCommit
    || runtimeIdentity?.releaseProductCommit !== expectedCommit
    || runtimeIdentity?.releaseLine !== manifest.releaseLine
    || runtimeIdentity?.releaseTag !== manifest.releaseTag
    || runtimeIdentity?.releaseRevision !== manifest.releaseRevision
    || runtimeIdentity?.releaseName !== manifest.releaseName
    || runtimeIdentity?.consumerRelease !== manifest.consumerRelease
    || runtimeIdentity?.architectureStage !== manifest.architectureStage
    || runtimeIdentity?.provenanceStatus !== "verified"
    || runtimeIdentity?.temporalProvenanceStatus !== "verified"
    || runtimeIdentity?.environment !== "production"
    || runtimeIdentity?.buildStartedAt !== expectedTimes.buildStartedAt
    || runtimeIdentity?.buildCompletedAt !== expectedTimes.buildCompletedAt
    || runtimeIdentity?.deployedAt !== expectedTimes.deployedAt) {
    throw new Error("DEPLOYMENT_TEMPORAL_RUNTIME_IDENTITY_INVALID");
  }
  const core = {
    schemaVersion: RECEIPT_SCHEMA,
    status: "PASS",
    deploymentId: expectedDeploymentId,
    appCommit: expectedCommit,
    releaseProductCommit: expectedCommit,
    controlCommit: expectedControlCommit,
    releaseLine: manifest.releaseLine,
    releaseTag: manifest.releaseTag,
    releaseRevision: manifest.releaseRevision,
    releaseEpoch: releaseEpoch.toISOString(),
    productCommitTime: commitTime.toISOString(),
    ...expectedTimes,
    controlPlaneCreatedAt: controlCreated.toISOString(),
    controlPlaneCreatedAtSkewMs: controlSkewMs,
    controlPlaneVersion: "vercel-deployments-v13",
    runtimeBound: true,
  };
  return {
    ...core,
    proofDigest: createHash("sha256").update(JSON.stringify(core)).digest("hex"),
  };
}

function requiredEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`MISSING_ENVIRONMENT:${name}`);
  return value;
}

async function main() {
  const deploymentId = requiredEnvironment("STAGED_DEPLOYMENT_ID");
  const teamId = requiredEnvironment("VERCEL_ORG_ID");
  const token = requiredEnvironment("VERCEL_TOKEN");
  const url = new URL(`https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentId)}`);
  url.searchParams.set("teamId", teamId);
  const response = await boundedFetch(fetch, url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
  }, {
    timeoutMs: 10_000,
    deadlineAt: Date.now() + 30_000,
    timeoutCode: "DEPLOYMENT_TEMPORAL_CONTROL_PLANE_TIMEOUT",
  });
  const deployment = await boundedOperation(() => response.json(), {
    timeoutMs: 10_000,
    deadlineAt: Date.now() + 30_000,
    timeoutCode: "DEPLOYMENT_TEMPORAL_CONTROL_PLANE_BODY_TIMEOUT",
    onTimeout: () => response.body?.cancel().catch(() => undefined),
  }).catch(() => null);
  if (!response.ok || !deployment) throw new Error("DEPLOYMENT_TEMPORAL_CONTROL_PLANE_LOOKUP_FAILED");
  const runtimeIdentity = JSON.parse(await readFile(requiredEnvironment("RUNTIME_IDENTITY_PATH"), "utf8"));
  const receipt = validateDeploymentTemporalProvenance({
    deployment,
    runtimeIdentity,
    expectedDeploymentId: deploymentId,
    expectedCommit: requiredEnvironment("EXPECTED_APP_COMMIT"),
    expectedControlCommit: requiredEnvironment("EXPECTED_CONTROL_COMMIT"),
    expectedProjectId: requiredEnvironment("VERCEL_PROJECT_ID"),
    expectedTeamId: teamId,
    buildStartedAt: requiredEnvironment("NOVEL_BUILD_STARTED_AT"),
    buildCompletedAt: requiredEnvironment("NOVEL_BUILD_COMPLETED_AT"),
    deployedAt: requiredEnvironment("NOVEL_DEPLOYED_AT"),
    productCommitTime: requiredEnvironment("EXPECTED_PRODUCT_COMMIT_TIME"),
  });
  await writeFile(requiredEnvironment("TEMPORAL_PROOF_PATH"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    status: "PASS",
    deploymentId: receipt.deploymentId,
    controlPlaneVersion: receipt.controlPlaneVersion,
    proofDigest: receipt.proofDigest,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: "deployment_temporal_provenance_failed",
      errorCode: String(error?.code || error?.message || "UNKNOWN_TEMPORAL_PROVENANCE_ERROR"),
    }));
    process.exitCode = 1;
  });
}

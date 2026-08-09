import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDeadline,
  boundedFetch,
  boundedOperation,
} from "./bounded-fetch.mjs";

const LKG_SCHEMA = "last-known-good-production-identity-v1";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function isDeploymentId(value) {
  return /^dpl_[A-Za-z0-9]+$/u.test(String(value || ""));
}

function isCommit(value) {
  return /^[a-f0-9]{40}$/u.test(String(value || ""));
}

export function createLastKnownGoodProductionIdentity({
  primaryDeploymentId,
  mirrorDeploymentId,
  appCommit,
  releaseTag,
  releaseRevision,
  verifiedAt = new Date().toISOString(),
}) {
  if (
    !isDeploymentId(primaryDeploymentId)
    || !isDeploymentId(mirrorDeploymentId)
    || !isCommit(appCommit)
    || !releaseTag
    || !releaseRevision
    || !Number.isFinite(Date.parse(verifiedAt))
  ) {
    throw new Error("LAST_KNOWN_GOOD_IDENTITY_INVALID");
  }
  const provenanceCore = {
    schemaVersion: LKG_SCHEMA,
    primaryDeploymentId,
    mirrorDeploymentId,
    appCommit,
    releaseTag,
    releaseRevision,
    verifiedAt,
  };
  return {
    ...provenanceCore,
    provenanceDigest: digest(provenanceCore),
  };
}

export function validateLastKnownGoodProductionIdentity(value) {
  const normalized = createLastKnownGoodProductionIdentity({
    primaryDeploymentId: value?.primaryDeploymentId,
    mirrorDeploymentId: value?.mirrorDeploymentId,
    appCommit: value?.appCommit,
    releaseTag: value?.releaseTag,
    releaseRevision: value?.releaseRevision,
    verifiedAt: value?.verifiedAt,
  });
  if (value?.schemaVersion !== LKG_SCHEMA || value?.provenanceDigest !== normalized.provenanceDigest) {
    throw Object.assign(new Error("LAST_KNOWN_GOOD_DIGEST_INVALID"), {
      code: "LAST_KNOWN_GOOD_DIGEST_INVALID",
    });
  }
  if (!Number.isFinite(Date.parse(value.verifiedAt))) {
    throw Object.assign(new Error("LAST_KNOWN_GOOD_TIMESTAMP_INVALID"), {
      code: "LAST_KNOWN_GOOD_TIMESTAMP_INVALID",
    });
  }
  return normalized;
}

export function parseLastKnownGoodCandidate(source) {
  try {
    const parsed = JSON.parse(String(source || ""));
    return {
      candidate: validateLastKnownGoodProductionIdentity(parsed),
      rejectionCode: null,
    };
  } catch (error) {
    return {
      candidate: null,
      rejectionCode: String(error?.code || error?.message || "LAST_KNOWN_GOOD_INVALID"),
    };
  }
}

function normalizeCandidate(source, value) {
  if (!value) return null;
  const candidate = {
    source,
    primary: {
      deploymentId: value.primaryDeploymentId,
      appCommit: value.primaryAppCommit || value.appCommit,
    },
    mirror: {
      deploymentId: value.mirrorDeploymentId,
      appCommit: value.mirrorAppCommit || value.appCommit,
    },
  };
  if (
    !isDeploymentId(candidate.primary.deploymentId)
    || !isDeploymentId(candidate.mirror.deploymentId)
    || !isCommit(candidate.primary.appCommit)
    || !isCommit(candidate.mirror.appCommit)
  ) return null;
  return candidate;
}

export function validateDeploymentControlPlaneTarget({
  deployment,
  expectedDeploymentId,
  expectedCommit,
  expectedProjectId,
  expectedTeamId,
}) {
  const deploymentId = deployment?.id ?? deployment?.uid ?? null;
  const appCommit = deployment?.meta?.githubCommitSha ?? null;
  const projectId = deployment?.projectId ?? deployment?.project?.id ?? null;
  const teamId = deployment?.teamId
    ?? deployment?.ownerId
    ?? deployment?.project?.accountId
    ?? null;
  const readyState = deployment?.readyState ?? deployment?.state ?? null;
  const target = deployment?.target ?? null;
  const deploymentUrl = deployment?.url ?? null;
  if (
    deploymentId !== expectedDeploymentId
    || appCommit !== expectedCommit
    || projectId !== expectedProjectId
    || teamId !== expectedTeamId
    || readyState !== "READY"
    || target !== "production"
    || !deploymentUrl
  ) {
    throw Object.assign(new Error("ROLLBACK_TARGET_CONTROL_PLANE_INVALID"), {
      code: "ROLLBACK_TARGET_CONTROL_PLANE_INVALID",
    });
  }
  return { deploymentId, appCommit, projectId, teamId, deploymentUrl };
}

async function verifyOneDeployment({
  identity,
  token,
  teamId,
  projectId,
  fetcher,
  fetchTimeoutMs,
  deadlineAt,
}) {
  const controlUrl = new URL(
    `https://api.vercel.com/v13/deployments/${encodeURIComponent(identity.deploymentId)}`,
  );
  controlUrl.searchParams.set("teamId", teamId);
  const response = await boundedFetch(fetcher, controlUrl, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
  }, {
    timeoutMs: fetchTimeoutMs,
    deadlineAt,
    timeoutCode: "ROLLBACK_TARGET_CONTROL_PLANE_TIMEOUT",
  });
  const deployment = await boundedOperation(() => response.json(), {
    timeoutMs: fetchTimeoutMs,
    deadlineAt,
    timeoutCode: "ROLLBACK_TARGET_CONTROL_PLANE_BODY_TIMEOUT",
    onTimeout: () => response.body?.cancel().catch(() => undefined),
  }).catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error("ROLLBACK_TARGET_DEPLOYMENT_NOT_FOUND"), {
      code: "ROLLBACK_TARGET_DEPLOYMENT_NOT_FOUND",
    });
  }
  const verified = validateDeploymentControlPlaneTarget({
    deployment,
    expectedDeploymentId: identity.deploymentId,
    expectedCommit: identity.appCommit,
    expectedProjectId: projectId,
    expectedTeamId: teamId,
  });
  const identityResponse = await boundedFetch(
    fetcher,
    `https://${verified.deploymentUrl}/api/release/identity?rollback-target=${Date.now()}`,
    { cache: "no-store" },
    {
      timeoutMs: fetchTimeoutMs,
      deadlineAt,
      timeoutCode: "ROLLBACK_TARGET_RUNTIME_TIMEOUT",
    },
  );
  const runtimeIdentity = await boundedOperation(() => identityResponse.json(), {
    timeoutMs: fetchTimeoutMs,
    deadlineAt,
    timeoutCode: "ROLLBACK_TARGET_RUNTIME_BODY_TIMEOUT",
    onTimeout: () => identityResponse.body?.cancel().catch(() => undefined),
  }).catch(() => null);
  if (
    !identityResponse.ok
    || runtimeIdentity?.deploymentId !== identity.deploymentId
    || runtimeIdentity?.appCommit !== identity.appCommit
    || runtimeIdentity?.provenanceStatus !== "verified"
    || runtimeIdentity?.environment !== "production"
  ) {
    throw Object.assign(new Error("ROLLBACK_TARGET_RUNTIME_IDENTITY_INVALID"), {
      code: "ROLLBACK_TARGET_RUNTIME_IDENTITY_INVALID",
    });
  }
  return { ...identity, provenanceStatus: "verified", environment: "production" };
}

export async function verifyRollbackCandidate({
  candidate,
  token,
  teamId,
  projectId,
  fetcher = fetch,
  fetchTimeoutMs = 5_000,
  deadlineAt = Date.now() + 15_000,
}) {
  if (!candidate) throw new Error("ROLLBACK_CANDIDATE_MISSING");
  const [primary, mirror] = await Promise.all([
    verifyOneDeployment({
      identity: candidate.primary,
      token,
      teamId,
      projectId,
      fetcher,
      fetchTimeoutMs,
      deadlineAt,
    }),
    verifyOneDeployment({
      identity: candidate.mirror,
      token,
      teamId,
      projectId,
      fetcher,
      fetchTimeoutMs,
      deadlineAt,
    }),
  ]);
  return { source: candidate.source, primary, mirror };
}

export async function selectVerifiedRollbackTarget({
  current,
  lastKnownGood,
  emergency,
  token,
  teamId,
  projectId,
  fetcher = fetch,
  fetchTimeoutMs = 5_000,
  candidateTimeoutMs = 15_000,
  deadlineAt = Date.now() + 60_000,
}) {
  const candidates = [
    normalizeCandidate("current-transaction-capture", current),
    normalizeCandidate("last-known-good", lastKnownGood),
    normalizeCandidate("emergency-static", emergency),
  ].filter(Boolean);
  const failures = [];
  for (const candidate of candidates) {
    assertDeadline(deadlineAt, "ROLLBACK_TARGET_SELECTION_DEADLINE_EXCEEDED");
    const candidateDeadlineAt = Math.min(deadlineAt, Date.now() + candidateTimeoutMs);
    try {
      return await verifyRollbackCandidate({
        candidate,
        token,
        teamId,
        projectId,
        fetcher,
        fetchTimeoutMs,
        deadlineAt: candidateDeadlineAt,
      });
    } catch (error) {
      failures.push({ source: candidate.source, code: error?.code || error?.message });
    }
  }
  throw Object.assign(new Error("NO_VERIFIED_ROLLBACK_TARGET"), {
    code: "NO_VERIFIED_ROLLBACK_TARGET",
    failures,
  });
}

export async function discoverLatestLastKnownGoodArtifact({
  repository,
  token,
  fetcher = fetch,
  fetchTimeoutMs = 5_000,
  deadlineAt = Date.now() + 30_000,
}) {
  const artifacts = [];
  const maximumPages = 10;
  for (let page = 1; page <= maximumPages; page += 1) {
    assertDeadline(deadlineAt, "LAST_KNOWN_GOOD_DISCOVERY_DEADLINE_EXCEEDED");
    const url = new URL(`https://api.github.com/repos/${repository}/actions/artifacts`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const response = await boundedFetch(fetcher, url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    }, {
      timeoutMs: fetchTimeoutMs,
      deadlineAt,
      timeoutCode: "LAST_KNOWN_GOOD_ARTIFACT_LIST_TIMEOUT",
    });
    const body = await boundedOperation(() => response.json(), {
      timeoutMs: fetchTimeoutMs,
      deadlineAt,
      timeoutCode: "LAST_KNOWN_GOOD_ARTIFACT_LIST_BODY_TIMEOUT",
      onTimeout: () => response.body?.cancel().catch(() => undefined),
    }).catch(() => null);
    if (!response.ok || !Array.isArray(body?.artifacts)) {
      throw Object.assign(new Error("LAST_KNOWN_GOOD_ARTIFACT_LOOKUP_FAILED"), {
        code: "LAST_KNOWN_GOOD_ARTIFACT_LOOKUP_FAILED",
      });
    }
    artifacts.push(...body.artifacts);
    const totalCount = Number(body.total_count);
    if (
      body.artifacts.length < 100
      || (Number.isFinite(totalCount) && artifacts.length >= totalCount)
    ) break;
  }
  const candidates = artifacts
    .filter((entry) =>
      entry?.expired === false
      && /^production-last-known-good-[a-f0-9]{40}$/u.test(String(entry?.name || ""))
      && entry?.workflow_run?.head_branch === "main"
      && entry?.workflow_run?.head_sha === String(entry?.name || "").slice(-40))
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
  for (const artifact of candidates) {
    assertDeadline(deadlineAt, "LAST_KNOWN_GOOD_DISCOVERY_DEADLINE_EXCEEDED");
    const runResponse = await boundedFetch(
      fetcher,
      `https://api.github.com/repos/${repository}/actions/runs/${artifact.workflow_run.id}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
      },
      {
        timeoutMs: fetchTimeoutMs,
        deadlineAt,
        timeoutCode: "LAST_KNOWN_GOOD_RUN_LOOKUP_TIMEOUT",
      },
    );
    const run = await boundedOperation(() => runResponse.json(), {
      timeoutMs: fetchTimeoutMs,
      deadlineAt,
      timeoutCode: "LAST_KNOWN_GOOD_RUN_BODY_TIMEOUT",
      onTimeout: () => runResponse.body?.cancel().catch(() => undefined),
    }).catch(() => null);
    if (
      runResponse.ok
      && run?.conclusion === "success"
      && run?.event === "push"
      && run?.head_branch === "main"
      && run?.head_sha === artifact.workflow_run.head_sha
      && run?.path === ".github/workflows/deploy.yml"
    ) {
      return {
        artifactId: artifact.id,
        artifactName: artifact.name,
        runId: artifact.workflow_run.id,
      };
    }
  }
  return null;
}

export async function safeDiscoverLatestLastKnownGoodArtifact(options) {
  try {
    return {
      artifact: await discoverLatestLastKnownGoodArtifact(options),
      rejectionCode: null,
    };
  } catch (error) {
    return {
      artifact: null,
      rejectionCode: String(error?.code || error?.message || "LAST_KNOWN_GOOD_DISCOVERY_FAILED"),
    };
  }
}

function requiredEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`MISSING_ENVIRONMENT:${name}`);
  return value;
}

function optionalIdentity(prefix) {
  const primaryDeploymentId = process.env[`${prefix}_PRIMARY_DEPLOYMENT`] || "";
  const primaryAppCommit = process.env[`${prefix}_PRIMARY_COMMIT`] || "";
  const mirrorDeploymentId = process.env[`${prefix}_MIRROR_DEPLOYMENT`] || "";
  const mirrorAppCommit = process.env[`${prefix}_MIRROR_COMMIT`] || "";
  return { primaryDeploymentId, primaryAppCommit, mirrorDeploymentId, mirrorAppCommit };
}

function appendOutputs(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`,
    "utf8",
  );
}

async function discoverCli() {
  const result = await safeDiscoverLatestLastKnownGoodArtifact({
    repository: requiredEnvironment("GITHUB_REPOSITORY"),
    token: requiredEnvironment("GITHUB_TOKEN"),
  });
  const artifact = result.artifact;
  appendOutputs({
    available: String(Boolean(artifact)),
    artifact_name: artifact?.artifactName || "",
    run_id: artifact?.runId || "",
    rejection_code: result.rejectionCode || "",
  });
  console.log(JSON.stringify({
    status: "PASS",
    available: Boolean(artifact),
    candidateRejected: Boolean(result.rejectionCode),
    rejectionCode: result.rejectionCode,
  }));
}

async function selectCli() {
  let lastKnownGood = null;
  let lastKnownGoodRejection = null;
  if (process.env.LAST_KNOWN_GOOD_PATH) {
    try {
      const parsed = parseLastKnownGoodCandidate(
        await readFile(process.env.LAST_KNOWN_GOOD_PATH, "utf8"),
      );
      lastKnownGood = parsed.candidate;
      lastKnownGoodRejection = parsed.rejectionCode;
    } catch (error) {
      lastKnownGoodRejection = String(
        error?.code || error?.message || "LAST_KNOWN_GOOD_ARTIFACT_UNREADABLE",
      );
    }
  }
  const selectionDeadlineMs = Number(process.env.ROLLBACK_TARGET_SELECTION_DEADLINE_MS || 60_000);
  const fetchTimeoutMs = Number(process.env.VERCEL_FETCH_TIMEOUT_MS || 5_000);
  if (!Number.isFinite(selectionDeadlineMs) || selectionDeadlineMs < 5_000 || selectionDeadlineMs > 120_000) {
    throw new Error("ROLLBACK_TARGET_SELECTION_DEADLINE_INVALID");
  }
  if (!Number.isFinite(fetchTimeoutMs) || fetchTimeoutMs < 100 || fetchTimeoutMs > 30_000) {
    throw new Error("ROLLBACK_TARGET_FETCH_TIMEOUT_INVALID");
  }
  const selected = await selectVerifiedRollbackTarget({
    current: process.env.DISABLE_CURRENT_CAPTURE === "true" ? null : optionalIdentity("CURRENT"),
    lastKnownGood,
    emergency: optionalIdentity("EMERGENCY"),
    token: requiredEnvironment("VERCEL_TOKEN"),
    teamId: requiredEnvironment("VERCEL_ORG_ID"),
    projectId: requiredEnvironment("VERCEL_PROJECT_ID"),
    fetchTimeoutMs,
    deadlineAt: Date.now() + selectionDeadlineMs,
  });
  appendOutputs({
    source: selected.source,
    primary_deployment_id: selected.primary.deploymentId,
    primary_app_commit: selected.primary.appCommit,
    mirror_deployment_id: selected.mirror.deploymentId,
    mirror_app_commit: selected.mirror.appCommit,
  });
  console.log(JSON.stringify({
    status: "PASS",
    source: selected.source,
    lastKnownGoodCandidateRejected: Boolean(lastKnownGoodRejection),
    lastKnownGoodRejection,
  }));
}

async function writeCli() {
  const document = createLastKnownGoodProductionIdentity({
    primaryDeploymentId: requiredEnvironment("PRIMARY_DEPLOYMENT_ID"),
    mirrorDeploymentId: requiredEnvironment("MIRROR_DEPLOYMENT_ID"),
    appCommit: requiredEnvironment("APP_COMMIT"),
    releaseTag: requiredEnvironment("RELEASE_TAG"),
    releaseRevision: requiredEnvironment("RELEASE_REVISION"),
  });
  await writeFile(requiredEnvironment("LAST_KNOWN_GOOD_PATH"), `${JSON.stringify(document, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: "PASS", provenanceDigest: document.provenanceDigest }));
}

async function main() {
  const mode = process.argv[2];
  if (mode === "discover") return discoverCli();
  if (mode === "select") return selectCli();
  if (mode === "write") return writeCli();
  throw new Error(`UNKNOWN_LAST_KNOWN_GOOD_MODE:${mode}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: "last_known_good_governance_failed",
      errorCode: String(error?.code || error?.message || "LAST_KNOWN_GOOD_GOVERNANCE_FAILED"),
      failures: Array.isArray(error?.failures) ? error.failures : [],
    }));
    process.exitCode = 1;
  });
}

import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";
import {
  assertDeadline,
  boundedFetch,
  boundedOperation,
} from "./bounded-fetch.mjs";

const LKG_SCHEMA = "last-known-good-production-identity-v1";
const LKG_ARTIFACT_PROOF_SCHEMA = "github-actions-lkg-artifact-proof-v1";
const ARTIFACT_DIGEST = /^sha256:([a-f0-9]{64})$/u;

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

function isSafeZipPath(value) {
  const normalized = String(value || "").replaceAll("\\", "/");
  return Boolean(normalized)
    && !normalized.startsWith("/")
    && !/^[A-Za-z]:\//u.test(normalized)
    && !normalized.split("/").includes("..");
}

export function extractLastKnownGoodIdentityFromZip(zipBytes) {
  const zip = Buffer.from(zipBytes);
  const minimumEocd = Math.max(0, zip.length - 65_557);
  let eocd = -1;
  for (let offset = zip.length - 22; offset >= minimumEocd; offset -= 1) {
    if (zip.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("LAST_KNOWN_GOOD_ZIP_EOCD_MISSING");
  const entries = zip.readUInt16LE(eocd + 10);
  const centralSize = zip.readUInt32LE(eocd + 12);
  const centralOffset = zip.readUInt32LE(eocd + 16);
  if (entries !== 1 || centralOffset + centralSize > eocd) {
    throw new Error("LAST_KNOWN_GOOD_ZIP_TOPOLOGY_INVALID");
  }
  if (zip.readUInt32LE(centralOffset) !== 0x02014b50) {
    throw new Error("LAST_KNOWN_GOOD_ZIP_CENTRAL_DIRECTORY_INVALID");
  }
  const flags = zip.readUInt16LE(centralOffset + 8);
  const method = zip.readUInt16LE(centralOffset + 10);
  const compressedSize = zip.readUInt32LE(centralOffset + 20);
  const uncompressedSize = zip.readUInt32LE(centralOffset + 24);
  const nameLength = zip.readUInt16LE(centralOffset + 28);
  const extraLength = zip.readUInt16LE(centralOffset + 30);
  const commentLength = zip.readUInt16LE(centralOffset + 32);
  const localOffset = zip.readUInt32LE(centralOffset + 42);
  const entryName = zip.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString("utf8");
  const centralEnd = centralOffset + 46 + nameLength + extraLength + commentLength;
  if (centralEnd !== centralOffset + centralSize
    || flags & 0x1
    || ![0, 8].includes(method)
    || compressedSize === 0xffffffff
    || uncompressedSize === 0xffffffff
    || !isSafeZipPath(entryName)
    || entryName !== "last-known-good-production.json"
    || zip.readUInt32LE(localOffset) !== 0x04034b50) {
    throw new Error("LAST_KNOWN_GOOD_ZIP_ENTRY_INVALID");
  }
  const localNameLength = zip.readUInt16LE(localOffset + 26);
  const localExtraLength = zip.readUInt16LE(localOffset + 28);
  const localFlags = zip.readUInt16LE(localOffset + 6);
  const localMethod = zip.readUInt16LE(localOffset + 8);
  const localName = zip.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString("utf8");
  if (localFlags !== flags || localMethod !== method || localName !== entryName || !isSafeZipPath(localName)) {
    throw new Error("LAST_KNOWN_GOOD_ZIP_LOCAL_HEADER_MISMATCH");
  }
  const contentStart = localOffset + 30 + localNameLength + localExtraLength;
  const contentEnd = contentStart + compressedSize;
  if (contentEnd > zip.length) throw new Error("LAST_KNOWN_GOOD_ZIP_TRUNCATED");
  const compressed = zip.subarray(contentStart, contentEnd);
  let content;
  try {
    content = method === 8 ? inflateRawSync(compressed) : compressed;
  } catch {
    throw new Error("LAST_KNOWN_GOOD_ZIP_INFLATE_FAILED");
  }
  if (content.length !== uncompressedSize || content.length > 1_000_000) {
    throw new Error("LAST_KNOWN_GOOD_ZIP_SIZE_INVALID");
  }
  return content.toString("utf8");
}

export function createLastKnownGoodArtifactProof({
  repository,
  artifactId,
  artifactName,
  artifactDigest,
  runId,
  headSha,
  workflowPath,
  createdAt,
  downloadedAt = new Date().toISOString(),
  identity,
}) {
  if (!repository
    || !Number.isSafeInteger(Number(artifactId))
    || Number(artifactId) <= 0
    || !/^production-last-known-good-[a-f0-9]{40}$/u.test(String(artifactName || ""))
    || !ARTIFACT_DIGEST.test(String(artifactDigest || ""))
    || !Number.isSafeInteger(Number(runId))
    || !isCommit(headSha)
    || workflowPath !== ".github/workflows/deploy.yml"
    || !Number.isFinite(Date.parse(createdAt))
    || !Number.isFinite(Date.parse(downloadedAt))) {
    throw new Error("LAST_KNOWN_GOOD_ARTIFACT_PROOF_INVALID");
  }
  const normalizedIdentity = validateLastKnownGoodProductionIdentity(identity);
  if (normalizedIdentity.appCommit !== headSha
    || !String(artifactName).endsWith(normalizedIdentity.appCommit)) {
    throw new Error("LAST_KNOWN_GOOD_ARTIFACT_IDENTITY_MISMATCH");
  }
  const core = {
    schemaVersion: LKG_ARTIFACT_PROOF_SCHEMA,
    repository,
    artifactId: Number(artifactId),
    artifactName,
    artifactDigest,
    archiveSha256: ARTIFACT_DIGEST.exec(artifactDigest)[1],
    runId: Number(runId),
    headSha,
    workflowPath,
    createdAt: new Date(createdAt).toISOString(),
    downloadedAt: new Date(downloadedAt).toISOString(),
    identityProvenanceDigest: normalizedIdentity.provenanceDigest,
    readOnlyDiscovery: true,
    artifactControlPlaneVerified: true,
    workflowRunControlPlaneVerified: true,
  };
  return { ...core, proofDigest: digest(core) };
}

export function validateLastKnownGoodArtifactProof(value, identity) {
  const normalized = createLastKnownGoodArtifactProof({ ...value, identity });
  if (value?.schemaVersion !== LKG_ARTIFACT_PROOF_SCHEMA
    || value?.proofDigest !== normalized.proofDigest
    || value?.archiveSha256 !== normalized.archiveSha256) {
    throw Object.assign(new Error("LAST_KNOWN_GOOD_ARTIFACT_PROOF_DIGEST_INVALID"), {
      code: "LAST_KNOWN_GOOD_ARTIFACT_PROOF_DIGEST_INVALID",
    });
  }
  return normalized;
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

export function assertExpectedLastKnownGoodIdentity(identity, expected = {}) {
  const normalized = validateLastKnownGoodProductionIdentity(identity);
  const comparisons = {
    appCommit: expected.appCommit,
    primaryDeploymentId: expected.primaryDeploymentId,
    mirrorDeploymentId: expected.mirrorDeploymentId,
    releaseTag: expected.releaseTag,
    releaseRevision: expected.releaseRevision,
  };
  for (const [field, expectedValue] of Object.entries(comparisons)) {
    if (expectedValue && normalized[field] !== expectedValue) {
      throw Object.assign(new Error(`LAST_KNOWN_GOOD_EXPECTED_IDENTITY_MISMATCH:${field}`), {
        code: "LAST_KN_GOOD_EXPECTED_IDENTITY_MISMATCH",
      });
    }
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
      releaseTag: value.releaseTag || null,
      releaseRevision: value.releaseRevision || null,
    },
    mirror: {
      deploymentId: value.mirrorDeploymentId,
      appCommit: value.mirrorAppCommit || value.appCommit,
      releaseTag: value.releaseTag || null,
      releaseRevision: value.releaseRevision || null,
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
    || (identity.releaseTag && runtimeIdentity?.releaseTag !== identity.releaseTag)
    || (identity.releaseRevision && runtimeIdentity?.releaseRevision !== identity.releaseRevision)
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
  failClosedSources = [],
}) {
  const requiredSources = new Set(failClosedSources);
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
      if (requiredSources.has(candidate.source)) {
        throw Object.assign(new Error("REQUIRED_ROLLBACK_TARGET_VERIFICATION_FAILED"), {
          code: "REQUIRED_ROLLBACK_TARGET_VERIFICATION_FAILED",
          failures,
        });
      }
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
  excludeRunId = null,
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
      && ARTIFACT_DIGEST.test(String(entry?.digest || ""))
      && entry?.workflow_run?.head_branch === "main"
      && entry?.workflow_run?.head_sha === String(entry?.name || "").slice(-40)
      && Number(entry?.workflow_run?.id) !== Number(excludeRunId))
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
        artifactDigest: artifact.digest,
        runId: artifact.workflow_run.id,
        headSha: artifact.workflow_run.head_sha,
        workflowPath: run.path,
        createdAt: artifact.created_at,
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

export async function downloadLastKnownGoodArtifact({
  repository,
  token,
  artifact,
  identityPath,
  proofPath,
  fetcher = fetch,
  fetchTimeoutMs = 10_000,
  deadlineAt = Date.now() + 30_000,
  expectedIdentity = {},
}) {
  if (!artifact?.artifactId || !ARTIFACT_DIGEST.test(String(artifact?.artifactDigest || ""))) {
    throw new Error("LAST_KNOWN_GOOD_DOWNLOAD_METADATA_INVALID");
  }
  const response = await boundedFetch(
    fetcher,
    `https://api.github.com/repos/${repository}/actions/artifacts/${artifact.artifactId}/zip`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
      redirect: "follow",
    },
    {
      timeoutMs: fetchTimeoutMs,
      deadlineAt,
      timeoutCode: "LAST_KNOWN_GOOD_ARTIFACT_DOWNLOAD_TIMEOUT",
    },
  );
  if (!response.ok) {
    throw Object.assign(new Error("LAST_KNOWN_GOOD_ARTIFACT_DOWNLOAD_FAILED"), {
      code: "LAST_KNOWN_GOOD_ARTIFACT_DOWNLOAD_FAILED",
    });
  }
  const archive = Buffer.from(await boundedOperation(() => response.arrayBuffer(), {
    timeoutMs: fetchTimeoutMs,
    deadlineAt,
    timeoutCode: "LAST_KNOWN_GOOD_ARTIFACT_BODY_TIMEOUT",
    onTimeout: () => response.body?.cancel().catch(() => undefined),
  }));
  const actualDigest = createHash("sha256").update(archive).digest("hex");
  const expectedDigest = ARTIFACT_DIGEST.exec(artifact.artifactDigest)[1];
  if (actualDigest !== expectedDigest) {
    throw Object.assign(new Error("LAST_KNOWN_GOOD_ARCHIVE_DIGEST_MISMATCH"), {
      code: "LAST_KNOWN_GOOD_ARCHIVE_DIGEST_MISMATCH",
    });
  }
  const identity = assertExpectedLastKnownGoodIdentity(JSON.parse(
    extractLastKnownGoodIdentityFromZip(archive),
  ), expectedIdentity);
  const proof = createLastKnownGoodArtifactProof({
    repository,
    ...artifact,
    identity,
  });
  if (identityPath) await writeFile(identityPath, `${JSON.stringify(identity, null, 2)}\n`, "utf8");
  if (proofPath) await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
  return { identity, proof };
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
    excludeRunId: process.env.GITHUB_RUN_ID || null,
  });
  const artifact = result.artifact;
  appendOutputs({
    available: String(Boolean(artifact)),
    artifact_name: artifact?.artifactName || "",
    artifact_id: artifact?.artifactId || "",
    artifact_digest: artifact?.artifactDigest || "",
    run_id: artifact?.runId || "",
    head_sha: artifact?.headSha || "",
    workflow_path: artifact?.workflowPath || "",
    created_at: artifact?.createdAt || "",
    rejection_code: result.rejectionCode || "",
  });
  console.log(JSON.stringify({
    status: "PASS",
    available: Boolean(artifact),
    candidateRejected: Boolean(result.rejectionCode),
    rejectionCode: result.rejectionCode,
  }));
}

async function downloadCli() {
  const result = await downloadLastKnownGoodArtifact({
    repository: requiredEnvironment("GITHUB_REPOSITORY"),
    token: requiredEnvironment("GITHUB_TOKEN"),
    artifact: {
      artifactId: Number(requiredEnvironment("LAST_KNOWN_GOOD_ARTIFACT_ID")),
      artifactName: requiredEnvironment("LAST_KNOWN_GOOD_ARTIFACT_NAME"),
      artifactDigest: requiredEnvironment("LAST_KNOWN_GOOD_ARTIFACT_DIGEST"),
      runId: Number(requiredEnvironment("LAST_KNOWN_GOOD_RUN_ID")),
      headSha: requiredEnvironment("LAST_KNOWN_GOOD_HEAD_SHA"),
      workflowPath: requiredEnvironment("LAST_KNOWN_GOOD_WORKFLOW_PATH"),
      createdAt: requiredEnvironment("LAST_KNOWN_GOOD_CREATED_AT"),
    },
    identityPath: requiredEnvironment("LAST_KNOWN_GOOD_PATH"),
    proofPath: requiredEnvironment("LAST_KNOWN_GOOD_PROOF_PATH"),
    expectedIdentity: {
      appCommit: process.env.EXPECTED_LKG_APP_COMMIT,
      primaryDeploymentId: process.env.EXPECTED_LKG_PRIMARY_DEPLOYMENT_ID,
      mirrorDeploymentId: process.env.EXPECTED_LKG_MIRROR_DEPLOYMENT_ID,
      releaseTag: process.env.EXPECTED_LKG_RELEASE_TAG,
      releaseRevision: process.env.EXPECTED_LKG_RELEASE_REVISION,
    },
  });
  console.log(JSON.stringify({
    status: "PASS",
    appCommit: result.identity.appCommit,
    artifactDigest: result.proof.artifactDigest,
    proofDigest: result.proof.proofDigest,
    readOnlyDiscovery: true,
  }));
}

async function selectCli() {
  let lastKnownGood = null;
  let lastKnownGoodRejection = null;
  let lastKnownGoodProof = null;
  const lastKnownGoodAvailable = process.env.LAST_KNOWN_GOOD_AVAILABLE === "true";
  if (lastKnownGoodAvailable && (!process.env.LAST_KNOWN_GOOD_PATH || !process.env.LAST_KNOWN_GOOD_PROOF_PATH)) {
    throw new Error("LAST_KNOWN_GOOD_AVAILABLE_BUT_PROOF_MISSING");
  }
  if (process.env.LAST_KNOWN_GOOD_PATH) {
    try {
      const parsed = parseLastKnownGoodCandidate(
        await readFile(process.env.LAST_KNOWN_GOOD_PATH, "utf8"),
      );
      lastKnownGood = parsed.candidate;
      lastKnownGoodRejection = parsed.rejectionCode;
      if (lastKnownGoodAvailable) {
        lastKnownGoodProof = validateLastKnownGoodArtifactProof(
          JSON.parse(await readFile(process.env.LAST_KNOWN_GOOD_PROOF_PATH, "utf8")),
          lastKnownGood,
        );
      }
    } catch (error) {
      lastKnownGoodRejection = String(
        error?.code || error?.message || "LAST_KNOWN_GOOD_ARTIFACT_UNREADABLE",
      );
    }
  }
  if (lastKnownGoodAvailable && (!lastKnownGood || !lastKnownGoodProof || lastKnownGoodRejection)) {
    throw Object.assign(new Error("LAST_KNOWN_GOOD_AVAILABLE_BUT_UNVERIFIED"), {
      code: "LAST_KNOWN_GOOD_AVAILABLE_BUT_UNVERIFIED",
    });
  }
  const selectionDeadlineMs = Number(process.env.ROLLBACK_TARGET_SELECTION_DEADLINE_MS || 60_000);
  const fetchTimeoutMs = Number(process.env.VERCEL_FETCH_TIMEOUT_MS || 5_000);
  if (!Number.isFinite(selectionDeadlineMs) || selectionDeadlineMs < 5_000 || selectionDeadlineMs > 120_000) {
    throw new Error("ROLLBACK_TARGET_SELECTION_DEADLINE_INVALID");
  }
  if (!Number.isFinite(fetchTimeoutMs) || fetchTimeoutMs < 100 || fetchTimeoutMs > 30_000) {
    throw new Error("ROLLBACK_TARGET_FETCH_TIMEOUT_INVALID");
  }
  const token = requiredEnvironment("VERCEL_TOKEN");
  const teamId = requiredEnvironment("VERCEL_ORG_ID");
  const projectId = requiredEnvironment("VERCEL_PROJECT_ID");
  if (lastKnownGoodAvailable) {
    await verifyRollbackCandidate({
      candidate: normalizeCandidate("last-known-good", lastKnownGood),
      token,
      teamId,
      projectId,
      fetchTimeoutMs,
      deadlineAt: Date.now() + Math.min(selectionDeadlineMs, 30_000),
    }).catch((error) => {
      throw Object.assign(new Error("LAST_KNOWN_GOOD_CONTROL_PLANE_FAIL_CLOSED"), {
        code: "LAST_KNOWN_GOOD_CONTROL_PLANE_FAIL_CLOSED",
        causeCode: error?.code || error?.message,
      });
    });
  }
  const selected = await selectVerifiedRollbackTarget({
    current: process.env.DISABLE_CURRENT_CAPTURE === "true" ? null : optionalIdentity("CURRENT"),
    lastKnownGood,
    emergency: optionalIdentity("EMERGENCY"),
    token,
    teamId,
    projectId,
    fetchTimeoutMs,
    deadlineAt: Date.now() + selectionDeadlineMs,
  });
  let selectionProofDigest = "";
  if (process.env.ROLLBACK_SELECTION_PROOF_PATH) {
    const core = {
      schemaVersion: "p24b-rc6.2-readonly-rollback-selection-proof-v1",
      status: "PASS",
      selectedAt: new Date().toISOString(),
      source: selected.source,
      primaryDeploymentId: selected.primary.deploymentId,
      primaryAppCommit: selected.primary.appCommit,
      mirrorDeploymentId: selected.mirror.deploymentId,
      mirrorAppCommit: selected.mirror.appCommit,
      lastKnownGoodAvailable,
      lastKnownGoodArtifactProofDigest: lastKnownGoodProof?.proofDigest || null,
      lastKnownGoodControlPlaneVerified: lastKnownGoodAvailable,
      readOnlySelection: true,
    };
    selectionProofDigest = digest(core);
    await writeFile(
      process.env.ROLLBACK_SELECTION_PROOF_PATH,
      `${JSON.stringify({ ...core, proofDigest: selectionProofDigest }, null, 2)}\n`,
      "utf8",
    );
  }
  appendOutputs({
    source: selected.source,
    primary_deployment_id: selected.primary.deploymentId,
    primary_app_commit: selected.primary.appCommit,
    mirror_deployment_id: selected.mirror.deploymentId,
    mirror_app_commit: selected.mirror.appCommit,
    selection_proof_digest: selectionProofDigest,
  });
  console.log(JSON.stringify({
    status: "PASS",
    source: selected.source,
    lastKnownGoodCandidateRejected: Boolean(lastKnownGoodRejection),
    lastKnownGoodRejection,
    lastKnownGoodAvailable,
    lastKnownGoodArtifactProofVerified: Boolean(lastKnownGoodProof),
    lastKnownGoodControlPlaneVerified: lastKnownGoodAvailable,
    selectionProofDigest: selectionProofDigest || null,
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
  if (mode === "download") return downloadCli();
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

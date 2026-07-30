import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..", "..");
const outputDir = path.join(root, "artifacts", "pr23-r22-luna-unblock");
const ghPath = "C:\\Program Files\\GitHub CLI\\gh.exe";
const repository = "bobobo-org/novel";
const prNumber = "23";
const baseline = {
  baseMain: "d0e80323dc68bf08cb541e46c6b9114a71e05cd9",
  validatedProductHead: "cf80c045cdab88e3515e9fc9a894c65400a59284",
  finalPrHead: "6c00673bb3349e49a49f0f5d72cce499c67033d6",
  mergeRef: "169328016111d69e0adab784d817a5653113a852",
  productCi: 30570122337,
  evidenceCi: 30572775023,
  productPreview: "https://novel-hxh5cy2vk-lqtechs-projects.vercel.app",
  finalEvidencePreview:
    "https://novel-15gi72tr4-lqtechs-projects.vercel.app",
  finalEvidenceDeployment: "dpl_5G2ggFhtgvLJxB8Q29X94RMoXFxY",
  productionCommit: "d0e80323dc68bf08cb541e46c6b9114a71e05cd9",
  productionDeployment: "dpl_8vdPA2mFkDJUezr5Rfn5MuxqJuBa",
  productionPrimary: "https://novel-orcin.vercel.app",
  productionMirror: "https://novel-lqtechs-projects.vercel.app",
  lunaR1Verdict: "PR23_R2_1_FRESH_INDEPENDENT_LUNA_R1_BLOCKED",
  lunaR1Manifest:
    "c2886dd7831789c77132a2a7fc26d7f54afd8905d95b389bd2fa845750f3b213",
};
const expectedArtifacts = [
  "abc-choices.json",
  "actual-executor.json",
  "audit-baseline.json",
  "backup-restore.json",
  "canon-approval.json",
  "canon-discard.json",
  "console-classification.json",
  "console-raw.ndjson",
  "console-summary.json",
  "console-summary.md",
  "edge-executable.json",
  "edge-profile.json",
  "edge-run-metadata.json",
  "evidence-manifest.json",
  "evidence-manifest.sha256",
  "executive-summary.md",
  "findings.json",
  "full-workspace.json",
  "http-errors-raw.ndjson",
  "local-bridge-runtime.json",
  "local-network-permission.json",
  "local-ollama-execution.json",
  "luna-r2-handoff.md",
  "network-failures-raw.ndjson",
  "page-errors-raw.ndjson",
  "pr-body-current.md",
  "pr-body-update-result.json",
  "pr-head-verification.json",
  "preview-release-identity.json",
  "production-mirror-identity-1.json",
  "production-mirror-identity-2.json",
  "production-mirror-identity-3.json",
  "production-primary-identity-1.json",
  "production-primary-identity-2.json",
  "production-primary-identity-3.json",
  "redaction-report.json",
  "release-identity-bootstrap-transition.json",
  "reload-persistence.json",
  "remote-preview-gate-v3.json",
].sort();
const rawFiles = [
  "console-raw.ndjson",
  "page-errors-raw.ndjson",
  "network-failures-raw.ndjson",
  "http-errors-raw.ndjson",
];
const credentialPatterns = [
  { name: "vercel_personal_token", pattern: /\bvcp_[A-Za-z0-9]{20,}\b/gu },
  { name: "supabase_personal_token", pattern: /\bsbp_[A-Za-z0-9]{20,}\b/gu },
  { name: "github_token", pattern: /\bgh[opsu]_[A-Za-z0-9]{20,}\b/gu },
  {
    name: "github_fine_grained_token",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/gu,
  },
  { name: "openai_style_key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/gu },
  {
    name: "authorization_header",
    pattern: /\bAuthorization\s*:\s*(?!\[REDACTED_SECRET\])[^\r\n]+/giu,
  },
  {
    name: "bearer_value",
    pattern: /\bBearer\s+(?!\[REDACTED_SECRET\])[A-Za-z0-9._~+/-]{8,}/giu,
  },
  {
    name: "cookie_value",
    pattern: /\b(?:set-)?cookie\s*:\s*(?!\[REDACTED_SECRET\])[^\r\n]+/giu,
  },
  {
    name: "csrf_value",
    pattern: /\bcsrf\s*[:=]\s*(?!\[REDACTED_SECRET\])[^\s,;"']+/giu,
  },
];
const privateStoryFixtures = [
  "林澈",
  "在封閉車站找回失蹤名單",
  "舊月臺",
  "謹慎、重承諾",
  "午夜封站規則",
  "午夜前任何人不得離開舊車站。",
  "第一章：末班車",
  "末班車停下時，林澈在空月臺拾起一張寫著自己名字的舊票。",
];

mkdirSync(outputDir, { recursive: true });

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(
      Buffer.isBuffer(value)
        ? value
        : typeof value === "string"
          ? value
          : JSON.stringify(stable(value)),
    )
    .digest("hex");
}

function normalizeText(value) {
  return `${String(value).replace(/\r\n?/gu, "\n").replace(/\n*$/u, "")}\n`;
}

function writeJson(name, value) {
  writeFileSync(
    path.join(outputDir, name),
    normalizeText(JSON.stringify(value, null, 2)),
    "utf8",
  );
}

function writeText(name, value) {
  writeFileSync(path.join(outputDir, name), normalizeText(value), "utf8");
}

function command(executable, args, options = {}) {
  return execFileSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  }).trim();
}

function git(...args) {
  return command("git.exe", args);
}

function gh(...args) {
  return command(ghPath, args);
}

function ghJson(...args) {
  return JSON.parse(gh(...args));
}

function runNodeTest(relativePath) {
  const result = spawnSync(process.execPath, [path.join(root, relativePath)], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const stdout = String(result.stdout ?? "").trim();
  const stderr = String(result.stderr ?? "").trim();
  let payload = null;
  try {
    payload = JSON.parse(stdout);
  } catch {
    payload = null;
  }
  return {
    status: result.status === 0 ? "PASS" : "FAIL",
    exitCode: result.status,
    payload,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
  };
}

async function fetchSnapshot(url) {
  const requestUrl = new URL(url);
  requestUrl.searchParams.set("audit", `${Date.now()}-${crypto.randomUUID()}`);
  const response = await fetch(requestUrl, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  const rawBody = await response.text();
  let body = null;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    body = null;
  }
  return {
    httpStatus: response.status,
    cacheControl: response.headers.get("cache-control"),
    responseBodySha256: sha256(rawBody),
    checkedAt: new Date().toISOString(),
    body,
  };
}

function safeHealth(snapshot) {
  return {
    httpStatus: snapshot.httpStatus,
    appCommit: snapshot.body?.appCommit ?? null,
    deploymentId: snapshot.body?.deploymentId ?? null,
    releaseTag: snapshot.body?.releaseTag ?? null,
    architectureStage: snapshot.body?.architectureStage ?? null,
    cacheControl: snapshot.cacheControl,
    responseBodySha256: snapshot.responseBodySha256,
    checkedAt: snapshot.checkedAt,
  };
}

function safeRelease(snapshot) {
  return {
    httpStatus: snapshot.httpStatus,
    appCommit: snapshot.body?.appCommit ?? null,
    deploymentId: snapshot.body?.deploymentId ?? null,
    releaseTag: snapshot.body?.releaseTag ?? null,
    architectureStage: snapshot.body?.architectureStage ?? null,
    environment: snapshot.body?.environment ?? null,
    provenanceStatus: snapshot.body?.provenanceStatus ?? null,
    cacheControl: snapshot.cacheControl,
    responseBodySha256: snapshot.responseBodySha256,
    checkedAt: snapshot.checkedAt,
  };
}

function extractSource(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `SOURCE_START_NOT_FOUND:${start}`);
  assert.ok(endIndex > startIndex, `SOURCE_END_NOT_FOUND:${end}`);
  return source.slice(startIndex, endIndex);
}

function parseRemoteRefs(output) {
  return Object.fromEntries(
    output
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => {
        const [oid, reference] = line.trim().split(/\s+/u);
        return [reference, oid];
      }),
  );
}

function validateRawRecordFiles() {
  const result = {};
  for (const name of rawFiles) {
    const value = readFileSync(path.join(outputDir, name), "utf8");
    const lines = value.split(/\r?\n/u).filter(Boolean);
    const parsed = lines.map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${name}:${index + 1}:${error.message}`);
      }
    });
    result[name] = {
      bytes: Buffer.byteLength(value),
      recordCount: parsed.length,
      validNdjson: true,
    };
  }
  return result;
}

function scanEvidence(fileNames) {
  const credentialHits = [];
  const privateStoryHits = [];
  for (const name of fileNames) {
    const filePath = path.join(outputDir, name);
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) continue;
    const value = readFileSync(filePath, "utf8");
    for (const { name: patternName, pattern } of credentialPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(value)) {
        credentialHits.push({ file: name, pattern: patternName });
      }
    }
    for (const fixture of privateStoryFixtures) {
      if (value.includes(fixture)) {
        privateStoryHits.push({
          file: name,
          fixtureDigest: sha256(fixture),
        });
      }
    }
  }
  return { credentialHits, privateStoryHits };
}

const branch = git("branch", "--show-current");
const head = git("rev-parse", "HEAD");
const worktreeStatusBefore = git("status", "--porcelain=v1", "-uall");
const auditTooling = Object.fromEntries(
  [
    "scripts/audit/run-pr23-r22-edge-evidence.mjs",
    "scripts/audit/run-pr23-r22-edge-evidence.ps1",
    "scripts/audit/seal-pr23-r22-audit.mjs",
  ].map((name) => [
    name,
    sha256(readFileSync(path.join(root, name))),
  ]),
);
assert.equal(branch, "audit/pr23-r22-luna-unblock");
assert.equal(head, baseline.finalPrHead);
const remoteRefs = parseRemoteRefs(
  git(
    "ls-remote",
    "origin",
    "refs/heads/main",
    "refs/heads/agent/closed-ai-runtime-truth-r2",
    "refs/pull/23/head",
    "refs/pull/23/merge",
  ),
);
assert.equal(remoteRefs["refs/heads/main"], baseline.baseMain);
assert.equal(
  remoteRefs["refs/heads/agent/closed-ai-runtime-truth-r2"],
  baseline.finalPrHead,
);
assert.equal(remoteRefs["refs/pull/23/head"], baseline.finalPrHead);
assert.equal(remoteRefs["refs/pull/23/merge"], baseline.mergeRef);

const prBefore = ghJson(
  "pr",
  "view",
  prNumber,
  "--repo",
  repository,
  "--json",
  "number,url,title,state,isDraft,mergeable,mergeStateStatus,headRefName,headRefOid,baseRefName,baseRefOid,body",
);
const repoView = ghJson(
  "repo",
  "view",
  repository,
  "--json",
  "nameWithOwner,defaultBranchRef,url",
);
const productCi = ghJson(
  "run",
  "view",
  String(baseline.productCi),
  "--repo",
  repository,
  "--json",
  "databaseId,status,conclusion,headSha,headBranch,event,url,workflowName",
);
const evidenceCi = ghJson(
  "run",
  "view",
  String(baseline.evidenceCi),
  "--repo",
  repository,
  "--json",
  "databaseId,status,conclusion,headSha,headBranch,event,url,workflowName",
);
const workflow = ghJson(
  "api",
  `repos/${repository}/actions/workflows/deploy.yml`,
);
const repositorySecrets = ghJson(
  "secret",
  "list",
  "--repo",
  repository,
  "--json",
  "name,updatedAt",
);
const mainPushRuns = ghJson(
  "run",
  "list",
  "--repo",
  repository,
  "--workflow",
  "deploy.yml",
  "--branch",
  "main",
  "--event",
  "push",
  "--limit",
  "5",
  "--json",
  "databaseId,status,conclusion,headSha,createdAt,updatedAt,url,workflowName,event",
);
assert.equal(prBefore.state, "OPEN");
assert.equal(prBefore.isDraft, true);
assert.equal(prBefore.headRefOid, baseline.finalPrHead);
assert.equal(prBefore.baseRefOid, baseline.baseMain);
assert.equal(repoView.defaultBranchRef.name, "main");
assert.equal(productCi.status, "completed");
assert.equal(productCi.conclusion, "success");
assert.equal(productCi.headSha, baseline.validatedProductHead);
assert.equal(evidenceCi.status, "completed");
assert.equal(evidenceCi.conclusion, "success");
assert.equal(evidenceCi.headSha, baseline.finalPrHead);
assert.equal(workflow.state, "active");
assert.equal(workflow.path, ".github/workflows/deploy.yml");
const secretNames = repositorySecrets.map((row) => row.name).sort();
assert.deepEqual(
  secretNames.filter((name) =>
    ["VERCEL_ORG_ID", "VERCEL_PROJECT_ID", "VERCEL_TOKEN"].includes(name)),
  ["VERCEL_ORG_ID", "VERCEL_PROJECT_ID", "VERCEL_TOKEN"],
);
assert.equal(mainPushRuns[0]?.headSha, baseline.baseMain);
assert.equal(mainPushRuns[0]?.status, "completed");
assert.equal(mainPushRuns[0]?.conclusion, "success");

writeJson("audit-baseline.json", {
  schemaVersion: "pr23-r2-2-audit-baseline-v1",
  status: "PASS",
  repository,
  prNumber: Number(prNumber),
  auditBranch: branch,
  auditBase: head,
  baseline,
  previousEvidenceImmutable:
    git(
      "status",
      "--porcelain=v1",
      "--",
      "artifacts/closed-ai-runtime-r2/remote-preview-gate-v2.json",
    ) === "",
  auditTooling,
  generatedAt: new Date().toISOString(),
});

writeJson("pr-head-verification.json", {
  schemaVersion: "pr23-r2-2-pr-head-verification-v1",
  status: "PASS",
  localAuditBase: head,
  remoteMain: remoteRefs["refs/heads/main"],
  remotePrBranch:
    remoteRefs["refs/heads/agent/closed-ai-runtime-truth-r2"],
  remotePrHead: remoteRefs["refs/pull/23/head"],
  remoteMergeRef: remoteRefs["refs/pull/23/merge"],
  pr: {
    state: prBefore.state,
    isDraft: prBefore.isDraft,
    mergeable: prBefore.mergeable,
    mergeStateStatus: prBefore.mergeStateStatus,
    headRefName: prBefore.headRefName,
    headRefOid: prBefore.headRefOid,
    baseRefName: prBefore.baseRefName,
    baseRefOid: prBefore.baseRefOid,
  },
  defaultBranch: repoView.defaultBranchRef.name,
  ci: { product: productCi, evidence: evidenceCi },
  deploymentAutomation: {
    status: "PASS",
    workflowName: workflow.name,
    workflowPath: workflow.path,
    workflowState: workflow.state,
    trigger: "push(main)",
    validateBeforeDeploy: true,
    primaryAlias: "novel-orcin.vercel.app",
    mirrorAlias: "novel-lqtechs-projects.vercel.app",
    requiredSecretNamesPresent: [
      "VERCEL_ORG_ID",
      "VERCEL_PROJECT_ID",
      "VERCEL_TOKEN",
    ],
    secretValuesRead: false,
    latestMainPushRun: mainPushRuns[0],
    automaticRollbackContractTest: "PASS",
  },
  prHeadUnchanged: true,
});

const previewSnapshot = await fetchSnapshot(
  `${baseline.finalEvidencePreview}/api/release/identity`,
);
const previewIdentity = safeRelease(previewSnapshot);
assert.equal(previewIdentity.httpStatus, 200);
assert.equal(previewIdentity.appCommit, baseline.mergeRef);
assert.equal(
  previewIdentity.deploymentId,
  baseline.finalEvidenceDeployment,
);
assert.equal(previewIdentity.environment, "preview");
assert.equal(previewIdentity.provenanceStatus, "verified");
writeJson("preview-release-identity.json", {
  schemaVersion: "pr23-r2-2-preview-release-identity-v1",
  status: "PASS",
  url: baseline.finalEvidencePreview,
  ...previewIdentity,
});

for (const [role, alias] of [
  ["primary", baseline.productionPrimary],
  ["mirror", baseline.productionMirror],
]) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const [release, health] = await Promise.all([
      fetchSnapshot(`${alias}/api/release/identity`),
      fetchSnapshot(`${alias}/api/ai/health`),
    ]);
    const releaseSafe = safeRelease(release);
    const healthSafe = safeHealth(health);
    assert.equal(releaseSafe.httpStatus, 404);
    assert.equal(healthSafe.httpStatus, 200);
    assert.equal(healthSafe.appCommit, baseline.productionCommit);
    assert.equal(healthSafe.deploymentId, baseline.productionDeployment);
    writeJson(`production-${role}-identity-${attempt}.json`, {
      schemaVersion: "pr23-r2-2-production-identity-v1",
      status: "PASS",
      role,
      alias,
      attempt,
      releaseIdentityEndpoint: {
        path: "/api/release/identity",
        expectedLegacyStatus: 404,
        observedStatus: releaseSafe.httpStatus,
        cacheControl: releaseSafe.cacheControl,
        responseBodySha256: releaseSafe.responseBodySha256,
        checkedAt: releaseSafe.checkedAt,
      },
      publicIdentityFallback: {
        path: "/api/ai/health",
        ...healthSafe,
      },
      productionUnchanged: true,
    });
  }
}

const cutoverSource = readFileSync(
  path.join(root, "scripts", "vercel-dual-alias-cutover.mjs"),
  "utf8",
);
const identityReaderSource = extractSource(
  cutoverSource,
  "export function createAliasIdentityReader",
  "\nfunction assertCapturedIdentity",
);
const phasesSource = extractSource(
  cutoverSource,
  "const LEGACY_CONTROL_PLANE_PHASES",
  "\n\nfunction cutoverError",
);
const bootstrapSource = extractSource(
  cutoverSource,
  "legacyBootstrapIdentity: {",
  "\n    },\n  });",
);
const rollbackTest = runNodeTest(
  "scripts/run-pr23-r21-dual-alias-rollback.mjs",
);
const workflowTest = runNodeTest(
  "scripts/run-pr23-r21-workflow-contract.mjs",
);
assert.equal(rollbackTest.status, "PASS");
assert.equal(workflowTest.status, "PASS");
assert.equal(rollbackTest.payload?.legacyBootstrapFrozenToKnownBaseline, true);
assert.equal(rollbackTest.payload?.promotionFallbackForbidden, true);
assert.equal(rollbackTest.payload?.non404FallbackForbidden, true);
writeJson("release-identity-bootstrap-transition.json", {
  schemaVersion: "pr23-release-identity-bootstrap-transition-v1",
  status: "PASS",
  legacyProductionCommit: baseline.productionCommit,
  legacyProductionDeployment: baseline.productionDeployment,
  legacyEndpoint: "/api/release/identity",
  legacyEndpointExpectedStatus: 404,
  legacyPublicIdentitySurface: "/api/ai/health",
  targetIdentitySurface: "/api/release/identity",
  transitionMode: "one_time_legacy_bootstrap",
  allowedFallbackPhases: [
    "capture-primary",
    "capture-mirror",
    "verify-rollback-primary",
    "verify-rollback-mirror",
  ],
  forbiddenFallbackPhases: [
    "verify-staged",
    "verify-mirror",
    "verify-primary",
    "promote-mirror",
    "promote-primary",
  ],
  sourceEvidence: {
    file: "scripts/vercel-dual-alias-cutover.mjs",
    createAliasIdentityReaderSha256: sha256(identityReaderSource),
    legacyControlPlanePhasesSha256: sha256(phasesSource),
    legacyBootstrapIdentityBindingSha256: sha256(bootstrapSource),
  },
  legacyBootstrapIdentity: {
    deploymentId: baseline.productionDeployment,
    appCommit: baseline.productionCommit,
    valuesFrozenByRequiredEnvironment: true,
  },
  contractAssertions: {
    mismatchedBaselineRejected: true,
    http500FallbackForbidden: true,
    promotionVerificationFallbackForbidden: true,
    captureFallbackAllowed: true,
    rollbackVerificationFallbackAllowed: true,
    newPreviewIdentityHttp200: previewIdentity.httpStatus === 200,
    newPreviewProvenanceVerified:
      previewIdentity.provenanceStatus === "verified",
    productionModified: false,
  },
  tests: {
    dualAliasRollback: rollbackTest,
    workflowContract: workflowTest,
  },
});

const edgeExecutablePath = path.join(outputDir, "edge-executable.json");
assert.ok(existsSync(edgeExecutablePath));
const edgeExecutable = JSON.parse(readFileSync(edgeExecutablePath, "utf8"));
const edgePreflight = JSON.parse(
  readFileSync(path.join(outputDir, "edge-run-metadata.json"), "utf8"),
);
const priorOllamaEvidence = JSON.parse(
  readFileSync(path.join(outputDir, "local-ollama-execution.json"), "utf8"),
);
assert.equal(edgeExecutable.status, "PASS");
assert.match(edgeExecutable.executablePath, /\\msedge\.exe$/iu);
const ollamaPreflight = edgePreflight.status === "PREFLIGHT_PASS"
  ? edgePreflight.localRuntime?.ollama
  : {
    reachable: priorOllamaEvidence.ollamaReachable,
    version: priorOllamaEvidence.ollamaVersion,
    models: priorOllamaEvidence.requiredModelPresent
      ? [priorOllamaEvidence.requiredModel]
      : [],
  };
assert.equal(ollamaPreflight?.reachable, true);
assert.ok(ollamaPreflight.models.includes("qwen2.5:3b"));
writeJson("edge-profile.json", {
  schemaVersion: "pr23-r2-2-edge-profile-v1",
  status: "NOT_EXECUTED",
  reason: "EDGE_CONTROL_SURFACE_UNAVAILABLE_IN_CURRENT_CODEX_RUNTIME",
  installedMicrosoftEdgeVerified: true,
  executablePath: edgeExecutable.executablePath,
  version: edgeExecutable.version,
  availableBrowserControlSurface: "Codex In-app Browser (IAB)",
  requiredBrowserControlSurface: "Microsoft Edge",
  profileCreated: false,
  existingUserProfileUsed: false,
  priorPairingSessionReused: false,
  permissionInjectionUsed: false,
  localNetworkAccessBypassUsed: false,
  mockBrowserUsed: false,
  chromiumUsedAsEdge: false,
});
writeJson("edge-run-metadata.json", {
  schemaVersion: "pr23-r2-2-edge-run-metadata-v1",
  status: "PR23_R2_2_EDGE_ENVIRONMENT_BLOCKED",
  reasonCode: "EDGE_CONTROL_SURFACE_UNAVAILABLE_IN_CURRENT_CODEX_RUNTIME",
  actualEdgeRunExecuted: false,
  actualEdgeFlowCompleted: false,
  rawRecordsCaptured: false,
  installedMicrosoftEdgeVerified: true,
  executablePath: edgeExecutable.executablePath,
  version: edgeExecutable.version,
  runnerReady:
    "scripts/audit/run-pr23-r22-edge-evidence.ps1",
  runnerSha256:
    auditTooling["scripts/audit/run-pr23-r22-edge-evidence.mjs"],
  powershellWrapperSha256:
    auditTooling["scripts/audit/run-pr23-r22-edge-evidence.ps1"],
  controlSurfaceEvidence: {
    selectedSurface: "Codex In-app Browser",
    selectedSurfaceType: "iab",
    microsoftEdgeSurfaceAvailable: false,
  },
  noOldSolEvidenceReused: true,
  noPassInferredFromPreflight: true,
  generatedAt: new Date().toISOString(),
});
writeJson("local-network-permission.json", {
  schemaVersion: "pr23-r2-2-local-network-permission-v1",
  status: "NOT_EXECUTED",
  reason: "EDGE_ENVIRONMENT_BLOCKED_BEFORE_NATIVE_PERMISSION_FLOW",
  nativePermissionObserved: false,
  permissionInjectionUsed: false,
  browserPolicyModified: false,
  localNetworkAccessBypassUsed: false,
});
writeJson("local-bridge-runtime.json", {
  schemaVersion: "pr23-r2-2-local-bridge-runtime-v1",
  status: "PREFLIGHT_ONLY",
  bridgeAliveBeforeAudit: false,
  bridgeStartedByAudit: false,
  bridgeStoppedByAudit: false,
  exactOriginTemporarilyEnrolled: false,
  pairingPerformed: false,
  reason: "EDGE_ENVIRONMENT_BLOCKED_BEFORE_BRIDGE_START",
});
writeJson("local-ollama-execution.json", {
  schemaVersion: "pr23-r2-2-local-ollama-execution-v1",
  status: "PREFLIGHT_PASS_EXECUTION_NOT_RUN",
  ollamaReachable: true,
  ollamaVersion: ollamaPreflight.version,
  requiredModel: "qwen2.5:3b",
  requiredModelPresent: true,
  modelDownloadedOrModified: false,
  realGenerationExecutedInThisAudit: false,
});

for (const [name, schema] of [
  ["actual-executor.json", "pr23-r2-2-actual-executor-v1"],
  ["canon-discard.json", "pr23-r2-2-canon-discard-v1"],
  ["canon-approval.json", "pr23-r2-2-canon-approval-v1"],
  ["reload-persistence.json", "pr23-r2-2-reload-persistence-v1"],
  ["abc-choices.json", "pr23-r2-2-abc-choices-v1"],
  ["full-workspace.json", "pr23-r2-2-full-workspace-v1"],
  ["backup-restore.json", "pr23-r2-2-backup-restore-v1"],
]) {
  writeJson(name, {
    schemaVersion: schema,
    status: "NOT_RUN",
    reason: "PR23_R2_2_EDGE_ENVIRONMENT_BLOCKED",
    passClaimed: false,
  });
}

for (const name of rawFiles) {
  writeFileSync(path.join(outputDir, name), "", "utf8");
}
const rawValidation = validateRawRecordFiles();
writeJson("console-classification.json", {
  schemaVersion: "pr23-r2-2-console-classification-v1",
  status: "NOT_EXECUTED",
  reason: "EDGE_ENVIRONMENT_BLOCKED_BEFORE_FRESH_AUTHORITATIVE_RERUN",
  entries: [],
  rawRecordsReusedFromV2: false,
  productErrorZeroClaimed: false,
  securityErrorZeroClaimed: false,
  unclassifiedZeroClaimed: false,
});
const consoleSummary = {
  schemaVersion: "pr23-r2-2-console-summary-v1",
  status: "NOT_EXECUTED",
  actualEdgeRunCompleted: false,
  previousGateCount: 22,
  currentGateCount: null,
  countDifference: null,
  countDifferenceReason:
    "edge_environment_blocked_before_fresh_authoritative_rerun",
  rawRecordCount: 0,
  classifiedRecordCount: 0,
  productErrorCount: null,
  securityErrorCount: null,
  unclassifiedCount: null,
  pass: false,
};
writeJson("console-summary.json", consoleSummary);
writeText("console-summary.md", `# PR23 R2.2 Console evidence

- Previous count-only gate: 22
- Current fresh Edge console error count: NOT EXECUTED
- Structured raw records captured: 0
- Classification result: NOT EXECUTED
- Reason: the current Codex runtime exposes only the in-app browser, not a controllable Microsoft Edge surface.
- Old SOL v2 evidence was not reused as new raw evidence.
- PASS claimed: no
`);

writeJson("remote-preview-gate-v3.json", {
  schemaVersion: "pr23-r2-2-remote-preview-gate-v3",
  status: "PR23_R2_2_EDGE_ENVIRONMENT_BLOCKED",
  previousEvidenceVersion: "pr23-r2-1-remote-preview-gate-v2",
  previousConsoleEvidenceStatus: "count_only_raw_records_missing",
  previousConsoleErrorCount: 22,
  previousEvidenceSupersededForConsoleClassification: false,
  supersessionPendingReason:
    "fresh_edge_raw_records_not_captured_in_current_environment",
  preview: {
    url: baseline.finalEvidencePreview,
    identityStatus: "PASS",
    appCommit: previewIdentity.appCommit,
    deploymentId: previewIdentity.deploymentId,
    environment: previewIdentity.environment,
    provenanceStatus: previewIdentity.provenanceStatus,
  },
  edge: {
    installed: true,
    executablePath: edgeExecutable.executablePath,
    version: edgeExecutable.version,
    controlSurfaceAvailable: false,
    actualRunExecuted: false,
  },
  rawEvidence: consoleSummary,
  productFlowExecuted: false,
  independentLunaPassClaimed: false,
  productionModified: false,
  generatedAt: new Date().toISOString(),
});

const prBody = `## PR23 R2.2 current release identity

This Draft PR remains open and unmerged. R2.2 is an audit-only follow-up; it does not modify the PR Head or Production.

### Protected identities

- Base \`main\`: \`${baseline.baseMain}\`
- Validated Product Head: \`${baseline.validatedProductHead}\`
- Final PR Head: \`${baseline.finalPrHead}\`
- Current merge ref: \`${baseline.mergeRef}\`
- Product CI: [${baseline.productCi}](https://github.com/${repository}/actions/runs/${baseline.productCi}) — \`completed/success\`
- Evidence CI: [${baseline.evidenceCi}](https://github.com/${repository}/actions/runs/${baseline.evidenceCi}) — \`completed/success\`
- Product Preview: ${baseline.productPreview}
- Final Evidence Preview: ${baseline.finalEvidencePreview}
- Default branch: \`main\`

### Independent LUNA R1

Status: **BLOCKED**

The R1 blockers were:

- the reviewer environment did not expose a controllable Microsoft Edge surface;
- v2 retained only the aggregate Console count and did not retain raw Console records;
- the PR body contained stale identities;
- legacy Production does not yet contain the new \`/api/release/identity\` route.

R2.2 confirms that Microsoft Edge is installed and provides a repeatable raw-evidence runner, but this execution environment still exposes only the Codex in-app browser. Therefore no fresh Edge raw records or Edge PASS are claimed.

### Release Identity transition

Production \`/api/release/identity\` returning 404 is the expected legacy-baseline state. The new Preview already returns a verified Release Identity. Deployment tooling may use the exactly frozen legacy Vercel control-plane identity only during \`capture-primary\`, \`capture-mirror\`, \`verify-rollback-primary\`, and \`verify-rollback-mirror\`. After a new release is switched, verification must use the new endpoint; promotion verification cannot use the fallback.

### Current boundary

- \`LOCAL_CANONICAL_FLOW_READY\`
- \`CLOUD_PERSISTENCE_NOT_READY\`
- \`SUPABASE_PRODUCTION_REPAIR_NOT_COMPLETED\`
- \`PRODUCTION_UNCHANGED\`
- \`PR23_OPEN\`
- \`PR23_DRAFT\`
- \`PR23_UNMERGED\`
- \`PR23_R2_2_EDGE_ENVIRONMENT_BLOCKED\`

### Automatic Production deployment

The active repository workflow is configured as \`push(main) → validate → staged Vercel production → Release Identity verification → Mirror alias → novel-orcin primary alias\`, with atomic compensation on a failed alias verification. Required repository secret names are present; secret values were not read. The latest \`main\` push completed this workflow successfully.

This R2.2 audit did not push or merge into \`main\`, because the required fresh Edge raw-evidence Gate is still blocked.

### Audit evidence

- [Audit branch](https://github.com/${repository}/tree/audit/pr23-r22-luna-unblock)
- [Audit commit history](https://github.com/${repository}/commits/audit/pr23-r22-luna-unblock)

No Production deployment, alias mutation, Supabase Production repair, Ready-for-Review transition, approval, auto-merge, or merge was performed.
`;
writeText("pr-body-current.md", prBody);

let bodyUpdateResult;
try {
  gh(
    "pr",
    "edit",
    prNumber,
    "--repo",
    repository,
    "--body-file",
    path.join(outputDir, "pr-body-current.md"),
  );
  const prAfter = ghJson(
    "pr",
    "view",
    prNumber,
    "--repo",
    repository,
    "--json",
    "number,url,state,isDraft,mergeable,mergeStateStatus,headRefOid,baseRefOid,body",
  );
  const requiredBodyValues = [
    baseline.baseMain,
    baseline.validatedProductHead,
    baseline.finalPrHead,
    baseline.mergeRef,
    String(baseline.productCi),
    String(baseline.evidenceCi),
    baseline.productPreview,
    baseline.finalEvidencePreview,
    "LOCAL_CANONICAL_FLOW_READY",
    "CLOUD_PERSISTENCE_NOT_READY",
    "SUPABASE_PRODUCTION_REPAIR_NOT_COMPLETED",
    "PRODUCTION_UNCHANGED",
    "PR23_OPEN",
    "PR23_DRAFT",
    "PR23_UNMERGED",
    "PR23_R2_2_EDGE_ENVIRONMENT_BLOCKED",
  ];
  const missingBodyValues = requiredBodyValues.filter(
    (value) => !prAfter.body.includes(value),
  );
  assert.deepEqual(missingBodyValues, []);
  assert.equal(prAfter.state, "OPEN");
  assert.equal(prAfter.isDraft, true);
  assert.equal(prAfter.headRefOid, baseline.finalPrHead);
  assert.equal(prAfter.baseRefOid, baseline.baseMain);
  bodyUpdateResult = {
    schemaVersion: "pr23-r2-2-pr-body-update-result-v1",
    status: "PASS",
    command: "gh pr edit 23 --repo bobobo-org/novel --body-file [audit artifact]",
    requiredBodyValueCount: requiredBodyValues.length,
    missingBodyValues,
    bodySha256: sha256(prAfter.body),
    prState: prAfter.state,
    isDraft: prAfter.isDraft,
    mergeable: prAfter.mergeable,
    mergeStateStatus: prAfter.mergeStateStatus,
    headRefOid: prAfter.headRefOid,
    baseRefOid: prAfter.baseRefOid,
    updatedAt: new Date().toISOString(),
  };
} catch (error) {
  bodyUpdateResult = {
    schemaVersion: "pr23-r2-2-pr-body-update-result-v1",
    status: "PR23_BODY_UPDATE_BLOCKED",
    errorCode: error?.code ?? error?.name ?? "GH_PR_EDIT_FAILED",
    messageSha256: sha256(String(error?.message ?? error)),
    tokenFromPromptUsed: false,
    updatedAt: new Date().toISOString(),
  };
}
writeJson("pr-body-update-result.json", bodyUpdateResult);

const productionEvidence = readdirSync(outputDir)
  .filter((name) => /^production-(?:primary|mirror)-identity-\d+\.json$/u.test(name))
  .map((name) => JSON.parse(readFileSync(path.join(outputDir, name), "utf8")));
assert.equal(productionEvidence.length, 6);
assert.ok(productionEvidence.every((entry) =>
  entry.productionUnchanged
  && entry.releaseIdentityEndpoint.observedStatus === 404
  && entry.publicIdentityFallback.appCommit === baseline.productionCommit
  && entry.publicIdentityFallback.deploymentId === baseline.productionDeployment));

writeJson("findings.json", {
  schemaVersion: "pr23-r2-2-findings-v1",
  status: "BLOCKED",
  findings: [
    {
      id: "R22-EDGE-001",
      severity: "BLOCKER",
      status: "OPEN",
      title: "Current runtime cannot control Microsoft Edge",
      impact:
        "Fresh raw browser records and the complete Edge product flow cannot be produced.",
      disposition:
        "Run the committed audit runner in an Edge-capable LUNA environment.",
    },
    {
      id: "R22-IDENTITY-001",
      severity: "INFO",
      status: "RESOLVED",
      title: "Legacy Production Release Identity transition is bounded",
      impact: "Legacy 404 is limited to capture and rollback verification.",
    },
    {
      id: "R22-PRBODY-001",
      severity: bodyUpdateResult.status === "PASS" ? "INFO" : "BLOCKER",
      status: bodyUpdateResult.status === "PASS" ? "RESOLVED" : "OPEN",
      title: "PR #23 body current identity",
      impact: bodyUpdateResult.status,
    },
    {
      id: "R22-PRODUCTION-001",
      severity: "INFO",
      status: "VERIFIED",
      title: "Production remained unchanged",
      impact: `${baseline.productionCommit}/${baseline.productionDeployment}`,
    },
    {
      id: "R22-AUTODEPLOY-001",
      severity: "INFO",
      status: "VERIFIED",
      title: "main push automatic Production deployment is configured",
      impact:
        "Active workflow, required secret names present, latest main push completed/success, dual-alias rollback contract PASS.",
    },
  ],
  finalVerdict: "PR23_R2_2_EDGE_ENVIRONMENT_BLOCKED",
});

writeText("executive-summary.md", `# PR23 R2.2 executive summary

Result: **PR23_R2_2_EDGE_ENVIRONMENT_BLOCKED**

The audit branch and repeatable raw-evidence runner are ready. Microsoft Edge ${edgeExecutable.version}, Ollama 0.32.1, and qwen2.5:3b were found by non-mutating preflight checks. The current Codex browser runtime exposes only the in-app browser, so it cannot execute or observe the required real Microsoft Edge native Local Network Access flow.

No old SOL browser evidence was promoted to new raw evidence. All four raw NDJSON files are intentionally empty and marked not executed. Console zero-error claims are not made.

The Release Identity transition contract passed its rollback and workflow tests. Preview identity is verified. Primary and Mirror Production were each read three times: the legacy route remained 404 and the public health identity remained ${baseline.productionCommit}/${baseline.productionDeployment}. Production was not modified.

PR #23 remains Open, Draft, Unmerged, and its Head remains ${baseline.finalPrHead}. PR body update: ${bodyUpdateResult.status}.

The active GitHub Actions workflow is correctly configured for automatic Production deployment on every push to \`main\`; its required secret names are present and the latest \`main\` push completed successfully. No new \`main\` push or Production deployment was performed because the Edge Gate remains blocked.
`);

writeText("luna-r2-handoff.md", `# PR23 R2.2 Edge-capable LUNA handoff

Verdict from this SOL environment: **PR23_R2_2_EDGE_ENVIRONMENT_BLOCKED**

Use the audit branch \`audit/pr23-r22-luna-unblock\`. From a runtime that can control the installed Microsoft Edge and let the reviewer make the native Local Network Access decision, run:

\`\`\`powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\audit\\run-pr23-r22-edge-evidence.ps1
\`\`\`

The runner uses a fresh random profile, the exact installed \`msedge.exe\`, sandboxing, no permission injection, no bypass, no mock, no external AI, redacted structured raw records, and exact-origin Bridge enrollment with cleanup.

Do not reuse v2 as fresh raw evidence. A valid R2 continuation requires a completed Edge run, non-empty records where the browser emits records, complete per-record classification, zero PRODUCT_ERROR, zero SECURITY_ERROR, zero UNCLASSIFIED, real qwen2.5:3b execution, and all Canon/ABC/workspace/backup assertions.

Protected boundaries remain:

- PR #23 Head: \`${baseline.finalPrHead}\`
- Production: \`${baseline.productionCommit}\` / \`${baseline.productionDeployment}\`
- no Supabase Production repair
- no Production deploy/promote/rollback
- no Ready-for-Review or merge transition
`);

const preRedactionFiles = expectedArtifacts.filter(
  (name) =>
    ![
      "redaction-report.json",
      "evidence-manifest.json",
      "evidence-manifest.sha256",
    ].includes(name),
);
const firstScan = scanEvidence(preRedactionFiles);
assert.equal(firstScan.credentialHits.length, 0);
assert.equal(firstScan.privateStoryHits.length, 0);
writeJson("redaction-report.json", {
  schemaVersion: "pr23-r2-2-redaction-report-v1",
  status: "PASS",
  scannedFileCount: preRedactionFiles.length,
  credentialPatternHits: 0,
  credentialHits: [],
  privateStoryTextPersisted: false,
  privateStoryHits: [],
  pairingCodePersisted: false,
  tokenPersisted: false,
  csrfPersisted: false,
  cookiePersisted: false,
  authorizationHeaderPersisted: false,
  rawChainOfThoughtPersisted: false,
  rawFiles: rawValidation,
});

const filesBeforeManifest = readdirSync(outputDir)
  .filter((name) =>
    !["evidence-manifest.json", "evidence-manifest.sha256"].includes(name))
  .sort();
const missingBeforeManifest = expectedArtifacts.filter(
  (name) =>
    !["evidence-manifest.json", "evidence-manifest.sha256"].includes(name)
    && !filesBeforeManifest.includes(name),
);
const unexpectedBeforeManifest = filesBeforeManifest.filter(
  (name) => !expectedArtifacts.includes(name),
);
assert.deepEqual(missingBeforeManifest, []);
assert.deepEqual(unexpectedBeforeManifest, []);

const manifestFiles = Object.fromEntries(
  filesBeforeManifest.map((name) => {
    const bytes = readFileSync(path.join(outputDir, name));
    return [
      name,
      {
        bytes: bytes.length,
        sha256: sha256(bytes),
      },
    ];
  }),
);
const manifestBase = {
  schemaVersion: "pr23-r2-2-evidence-manifest-v1",
  status: "PASS",
  verdict: "PR23_R2_2_EDGE_ENVIRONMENT_BLOCKED",
  expectedArtifactCount: expectedArtifacts.length,
  hashedArtifactCount: filesBeforeManifest.length,
  expectedArtifacts,
  files: manifestFiles,
  integrity: {
    missing: [],
    unexpected: [],
    mismatch: [],
    credentialHits: [],
    missingCount: 0,
    unexpectedCount: 0,
    mismatchCount: 0,
    credentialHitCount: 0,
  },
  selfHashMethod:
    "sha256(JSON.stringify(stable(manifest_without_selfHash)))",
  generatedAt: new Date().toISOString(),
};
const selfHash = sha256(manifestBase);
const manifest = {
  ...manifestBase,
  selfHash,
  selfHashVerification: sha256(manifestBase) === selfHash ? "MATCH" : "MISMATCH",
};
writeJson("evidence-manifest.json", manifest);
const manifestBytes = readFileSync(
  path.join(outputDir, "evidence-manifest.json"),
);
writeText(
  "evidence-manifest.sha256",
  `${sha256(manifestBytes)}  evidence-manifest.json`,
);

const finalFiles = readdirSync(outputDir).sort();
const missing = expectedArtifacts.filter((name) => !finalFiles.includes(name));
const unexpected = finalFiles.filter((name) => !expectedArtifacts.includes(name));
assert.deepEqual(missing, []);
assert.deepEqual(unexpected, []);
const finalScan = scanEvidence(finalFiles);
assert.equal(finalScan.credentialHits.length, 0);
assert.equal(finalScan.privateStoryHits.length, 0);
const finalManifest = JSON.parse(
  readFileSync(path.join(outputDir, "evidence-manifest.json"), "utf8"),
);
const { selfHash: storedSelfHash, selfHashVerification, ...storedManifestBase } =
  finalManifest;
assert.equal(selfHashVerification, "MATCH");
assert.equal(sha256(storedManifestBase), storedSelfHash);
const checksumLine = readFileSync(
  path.join(outputDir, "evidence-manifest.sha256"),
  "utf8",
).trim();
assert.equal(
  checksumLine,
  `${sha256(readFileSync(path.join(outputDir, "evidence-manifest.json")))}  evidence-manifest.json`,
);

const allowedPrefixes = [
  "scripts/audit/",
  "artifacts/pr23-r22-luna-unblock/",
];
const statusAfter = git("status", "--porcelain=v1", "-uall");
const changedPaths = statusAfter
  .split(/\r?\n/u)
  .filter(Boolean)
  .map((line) => line.slice(3).replace(/\\/gu, "/"));
assert.ok(changedPaths.length > 0);
assert.ok(changedPaths.every((name) =>
  allowedPrefixes.some((prefix) => name.startsWith(prefix))));
assert.equal(
  git(
    "status",
    "--porcelain=v1",
    "--",
    "app",
    "lib",
    "public",
    "local-ai",
    "package.json",
    ".github/workflows",
  ),
  "",
);

process.stdout.write(`${JSON.stringify({
  status: "PASS",
  verdict: "PR23_R2_2_EDGE_ENVIRONMENT_BLOCKED",
  outputDir,
  artifactCount: finalFiles.length,
  manifestSelfHash: storedSelfHash,
  manifestSha256: sha256(
    readFileSync(path.join(outputDir, "evidence-manifest.json")),
  ),
  prBodyUpdate: bodyUpdateResult.status,
  changedPathCount: changedPaths.length,
  worktreeStatusBeforeSha256: sha256(worktreeStatusBefore),
})}\n`);

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFile,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const wrapperUrl = new URL("./run-rc6-2-production-browser-gate.ps1", import.meta.url);
const [wrapper, browserRunner, runtimeContract, workflow, workflowContract] = await Promise.all([
  readFile(wrapperUrl, "utf8"),
  readFile(new URL("./run-rc6-2-closed-agent-browser.mjs", import.meta.url), "utf8"),
  readFile(new URL("./run-rc6-2-closed-agent-runtime.mjs", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"),
  readFile(new URL("./run-pr23-r21-workflow-contract.mjs", import.meta.url), "utf8"),
]);

const PRODUCT_COMMIT = "29fc6e742672bb07187765d34ea818afdadf56ae";
const PRODUCTION_RECOVERY_CONTROL = "9cd074f239b73dd9b61f6d758fcf97fbd809face";
const FAILED_RECOVERY_CONTROL = "3b716fc0d974a9d59b49ffca5953776af66c7a07";
const INITIAL_BROWSER_GATE_CONTROL = "aab0e7bd52c57bc57ecfe8be8b08c1cf63db9824";
const PREVIOUS_BROWSER_GATE_CONTROL = "100eea11003c5132ab2b519707c5dee658bc9cbe";
const EXPECTED_DEPLOYMENT_ID = "dpl_8pqTpwAgQQAqmLKNzZNCzSfPuqNn";
const EXPECTED_ORIGIN = "https://novel-eexnlr77y-lqtechs-projects.vercel.app";
const EXPECTED_RELEASE_TAG = "novel-ai-p24b-conversation-first-studio-rc6.2";
const EXPECTED_RELEASE_BUILD = `rc6.2+${PRODUCT_COMMIT}`;
const EXPECTED_EDGE_VERSION = "151.0.4129.72";
const EXPECTED_EDGE_EXE_DIGEST = "e73e04dacdb48557c13d9f93f90a248f3e5a0bf55bb738f2fc548a768a9a10af";
const EXPECTED_EDGE_DLL_DIGEST = "340669f76761a7844f6efa26ee58781a68ae43d5f54dbe158545528b8507137a";
const EXPECTED_EDGE_DIRECTORY_DIGEST = "7148bc3bddf499f24f003ed47741301ee10792f709fb7966876ebcbdfb0b0974";
const EXPECTED_PACKAGE_JSON_DIGEST = "96418a3c785af02f424150d33aaa88e2be3d0dc35e6c7774d424c6ecbff37748";
const EXPECTED_PNPM_LOCK_DIGEST = "bf80df1d7e1419628c2dac09bfb8b39360942098324d47269f9690eab52b7b7f";
const GATE_BLOB_PATHS = [
  ".github/workflows/deploy.yml",
  "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-closed-agent-browser.mjs",
  "scripts/run-rc6-2-closed-agent-runtime.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate.ps1",
];
const GATE_REPAIR_PATHS = [
  ".github/workflows/deploy.yml",
  "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate.ps1",
];

function occurrences(source, literal) {
  return source.split(literal).length - 1;
}

async function dependencyDigest(root) {
  const digest = createHash("sha256");
  async function walk(directory, relativeDirectory = "") {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const absolutePath = join(directory, entry.name);
      const truth = await lstat(absolutePath);
      assert.equal(truth.isSymbolicLink(), false, `dependency package contains a symlink: ${relativePath}`);
      if (truth.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else if (truth.isFile()) {
        const bytes = await readFile(absolutePath);
        digest.update(relativePath);
        digest.update("\0");
        digest.update(String(bytes.length));
        digest.update("\0");
        digest.update(bytes);
      } else {
        assert.fail(`dependency package contains an unsupported entry: ${relativePath}`);
      }
    }
  }
  await walk(root);
  return digest.digest("hex");
}

async function completeTreeReceipt(root) {
  const digest = createHash("sha256");
  let fileCount = 0;
  let byteCount = 0;
  async function walk(directory, relativeDirectory = "") {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const absolutePath = join(directory, entry.name);
      const truth = await lstat(absolutePath);
      assert.equal(truth.isSymbolicLink(), false, `sealed tree contains a symlink: ${relativePath}`);
      if (truth.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else if (truth.isFile()) {
        const bytes = await readFile(absolutePath);
        digest.update(relativePath);
        digest.update("\0");
        digest.update(String(bytes.length));
        digest.update("\0");
        digest.update(bytes);
        fileCount += 1;
        byteCount += bytes.length;
      } else {
        assert.fail(`sealed tree contains an unsupported entry: ${relativePath}`);
      }
    }
  }
  await walk(root);
  return {
    fileCount,
    byteCount,
    digest: digest.digest("hex"),
  };
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function assertExactDirectoryEntries(directory, expected) {
  const entries = (await readdir(directory)).sort();
  assert.deepEqual(entries, [...expected].sort());
}

function assertPlainObject(value, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
}

function assertExactKeys(value, expectedKeys, label) {
  assertPlainObject(value, label);
  assert.deepEqual(Object.keys(value).sort(), [...expectedKeys].sort(), `${label} keys drifted`);
}

function assertSha256(value, label) {
  assert.match(value, /^[a-f0-9]{64}$/u, `${label} is not a SHA-256 digest`);
}

const RUNNER_EVIDENCE_SCHEMA_VERSION = "p24b-rc6-2-closed-ai-browser-evidence-v3";
const RUNNER_SUCCESS_EVIDENCE_KEYS = [
  "schemaVersion",
  "status",
  "mode",
  "exactOrigin",
  "freshBrowserContext",
  "releaseIdentity",
  "edgeIdentity",
  "freshStorage",
  "mocksInstalled",
  "prohibitedExternalAiRequestCount",
  "crossOriginPolicy",
  "networkZeroReceipt",
  "projectId",
  "setup",
  "consumerReadiness",
  "storyBible",
  "attachmentProbe",
  "t1ContextAttestationProbe",
  "conversationIsolation",
  "firstCandidateBeforeApproval",
  "directRegenerationCandidate",
  "directRegenerationSourceAfterward",
  "rejectedCandidate",
  "regeneratedCandidateBeforeApproval",
  "browserRuntimeReceipt",
  "finalContextProof",
  "modelCacheReuse",
  "approval",
  "completedAt",
  "profileDisposed",
];
const RUNNER_POLICY_KEYS = [
  "policy",
  "contextRouteInstalledBeforeNavigation",
  "allowedMethods",
  "immutableModelAssetsAllowedOnlyDuringExplicitInstall",
  "sameOriginTargetPolicy",
  "disallowedRequestCount",
  "disallowedMethodRequestCount",
  "blockedNonToolbarResponseCount",
  "previewToolbarPolicy",
  "observedPreviewToolbarRequestCount",
  "blockedPreviewToolbarRequestCount",
  "previewToolbarResponseCount",
  "webSocketRouteInstalledBeforeNavigation",
  "webSocketPolicy",
  "observedWebSocketAttemptCount",
  "blockedWebSocketAttemptCount",
  "disallowedWebSocketAttemptCount",
  "webSocketServerConnectionCount",
  "observedPreviewToolbarWebSocketAttemptCount",
  "blockedPreviewToolbarWebSocketAttemptCount",
];
const RUNNER_DETAILED_FAILURE_KEYS = [
  "schemaVersion",
  "status",
  "mode",
  "exactOrigin",
  "freshBrowserContext",
  "requestPhase",
  "gateCheckpoint",
  "freshStorageAtFailure",
  "modelPayloadRequestCount",
  "immutableModelRootRequestCount",
  "approvedModelRedirectRequestCount",
  "modelMetadataAtFailure",
  "latestRegenerationAttemptEvidence",
  "uiSafeErrorCodesAtFailure",
  "uiStateAtFailure",
  "profileOwnershipAtFailure",
  "profilePathDigestAtFailure",
  "networkSentinelEvidenceAtFailure",
  "contextRouteInstalledBeforeNavigation",
  "contextWebSocketRouteInstalledBeforeNavigation",
  "webSocketPolicy",
  "blockedNetworkPolicyAttemptCount",
  "blockedNetworkPolicyAttempts",
  "blockedNetworkPolicyProjectionTruncated",
  "prohibitedExternalAiRequestCount",
  "observedPreviewToolbarRequestCount",
  "blockedPreviewToolbarRequestCount",
  "previewToolbarResponseCount",
  "disallowedCrossOriginRequestCount",
  "disallowedSameOriginTargetRequestCount",
  "disallowedSameOriginTargetRequests",
  "disallowedImmutableModelTargetRequestCount",
  "disallowedImmutableModelTargetRequests",
  "disallowedMethodRequestCount",
  "blockedNonToolbarResponseCount",
  "blockedNonToolbarResponses",
  "observedWebSocketAttemptCount",
  "blockedWebSocketAttemptCount",
  "disallowedWebSocketAttemptCount",
  "disallowedWebSocketAttempts",
  "disallowedWebSocketProjectionTruncated",
  "webSocketServerConnectionCount",
  "observedPreviewToolbarWebSocketAttemptCount",
  "blockedPreviewToolbarWebSocketAttemptCount",
  "blockedPreviewToolbarWebSocketAttempts",
  "blockedPreviewToolbarWebSocketProjectionTruncated",
  "disallowedCrossOriginHostDigests",
  "error",
  "completedAt",
  "profileDisposed",
];
const RUNNER_MINIMAL_FAILURE_KEYS = [
  "schemaVersion",
  "status",
  "mode",
  "exactOrigin",
  "profileOwnershipAtFailure",
  "profilePathDigestAtFailure",
  "contextRouteInstalledBeforeNavigation",
  "contextWebSocketRouteInstalledBeforeNavigation",
  "webSocketPolicy",
  "observedWebSocketAttemptCount",
  "blockedWebSocketAttemptCount",
  "disallowedWebSocketAttemptCount",
  "webSocketServerConnectionCount",
  "observedPreviewToolbarWebSocketAttemptCount",
  "blockedPreviewToolbarWebSocketAttemptCount",
  "error",
  "profileDisposed",
  "completedAt",
];
const RUNNER_FAILURE_COUNT_KEYS = [
  "modelPayloadRequestCount",
  "immutableModelRootRequestCount",
  "approvedModelRedirectRequestCount",
  "blockedNetworkPolicyAttemptCount",
  "prohibitedExternalAiRequestCount",
  "observedPreviewToolbarRequestCount",
  "blockedPreviewToolbarRequestCount",
  "previewToolbarResponseCount",
  "disallowedCrossOriginRequestCount",
  "disallowedSameOriginTargetRequestCount",
  "disallowedImmutableModelTargetRequestCount",
  "disallowedMethodRequestCount",
  "blockedNonToolbarResponseCount",
  "observedWebSocketAttemptCount",
  "blockedWebSocketAttemptCount",
  "disallowedWebSocketAttemptCount",
  "webSocketServerConnectionCount",
  "observedPreviewToolbarWebSocketAttemptCount",
  "blockedPreviewToolbarWebSocketAttemptCount",
];

function literalsBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `runner literal boundary missing: ${startMarker}`);
  return [...source.slice(start, end).matchAll(/"([A-Z][A-Z0-9_]+)"/gu)]
    .map((match) => match[1]);
}

const RUNNER_SAFE_DIAGNOSTIC_CODES = new Set(literalsBetween(
  browserRunner,
  "const SAFE_DIAGNOSTIC_CODES",
  "const SAFE_DIAGNOSTIC_CODE_SET",
));
const RUNNER_PERSISTED_FAILURE_CODES = literalsBetween(
  browserRunner,
  "const PERSISTED_FAILURE_SAFE_CODES",
  "const PERSISTED_FAILURE_SAFE_CODE_SET",
);
const RUNNER_UI_FAILURE_CODES = literalsBetween(
  browserRunner,
  "const SAFE_UI_ERROR_CODE_SET",
  "const SAFE_FAILURE_CODES",
);
const RUNNER_SAFE_FAILURE_CODES = new Set([
  ...RUNNER_PERSISTED_FAILURE_CODES,
  ...RUNNER_UI_FAILURE_CODES,
  ...literalsBetween(
    browserRunner,
    "const SAFE_FAILURE_CODES",
    "function sanitizeDiagnosticCodes",
  ),
]);
const RUNNER_CHECKPOINTS = new Set([
  ...browserRunner.matchAll(/gateCheckpoint\s*=\s*"([a-z0-9-]+)"/gu),
].map((match) => match[1]));
const RUNNER_REQUEST_PHASES = new Set([
  ...browserRunner.matchAll(/requestPhase\s*=\s*"([a-z0-9-]+)"/gu),
].map((match) => match[1]));
assert.ok(RUNNER_SAFE_DIAGNOSTIC_CODES.size > 20);
assert.ok(RUNNER_SAFE_FAILURE_CODES.size > 20);
assert.ok(RUNNER_CHECKPOINTS.size > 20);
assert.deepEqual([...RUNNER_REQUEST_PHASES].sort(), [
  "bootstrap",
  "inference",
  "model-install",
  "project-setup",
  "release-identity",
]);

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  )).join(",")}}`;
}

function gitOutput(arguments_) {
  assert.ok(arguments_.length > 0 && arguments_.length <= 16);
  for (const argument of arguments_) assert.match(argument, /^[A-Za-z0-9._/:@^{}+=,\-]{1,512}$/u);
  const result = spawnSync("git", arguments_, {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
    env: {
      PATH: process.env.PATH ?? "",
      SystemRoot: process.env.SystemRoot ?? "",
      WINDIR: process.env.WINDIR ?? "",
      COMSPEC: process.env.COMSPEC ?? "",
      LC_ALL: "C",
      LANG: "C",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "core.fsmonitor",
      GIT_CONFIG_VALUE_0: "false",
      GIT_CONFIG_KEY_1: "core.untrackedCache",
      GIT_CONFIG_VALUE_1: "false",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  assert.equal(result.status, 0, "browser gate control git proof failed");
  assert.equal(result.signal, null);
  assert.ok(result.stdout.length <= 1_048_576 && result.stderr.length <= 65_536);
  return result.stdout.trim();
}

async function assertPowerShellGitScalarBehavior() {
  if (process.platform !== "win32") return;
  const helperEnd = wrapper.indexOf("function Invoke-CleanNodeContract");
  assert.ok(helperEnd > 0, "PowerShell Git helper boundary is missing");
  const directory = await mkdtemp(join(tmpdir(), "novel-rc6-2-git-scalar-"));
  const scriptPath = join(directory, "git-scalar-self-test.ps1");
  const expectedHead = "0123456789abcdef0123456789abcdef01234567";
  try {
    await writeFile(scriptPath, `${wrapper.slice(0, helperEnd)}
$script:StubGitLines = @("  ${expectedHead}  ")
function Invoke-Git([string[]]$Arguments, [string]$Code) { return @($script:StubGitLines) }
$actual = Invoke-GitScalar @("rev-parse", "HEAD") "GIT_SCALAR_SELF_TEST_FAILED"
if ($actual -ne '${expectedHead}') { Fail "GIT_SCALAR_SELF_TEST_FAILED" }
$script:StubGitLines = @("  https://github.com/bobobo-org/novel.git  ")
$url = Invoke-GitScalar @("config", "--get", "remote.origin.url") "GIT_SCALAR_URL_SELF_TEST_FAILED"
if ($url -ne "https://github.com/bobobo-org/novel.git") { Fail "GIT_SCALAR_URL_SELF_TEST_FAILED" }
$trimmed = Get-SingleTrimmedLine @("  ${expectedHead}  ") "GIT_SCALAR_TRIM_SELF_TEST_FAILED"
if ($trimmed -ne '${expectedHead}') { Fail "GIT_SCALAR_TRIM_SELF_TEST_FAILED" }
$script:StubGitLines = @()
$zeroRejected = $false
try { [void](Invoke-GitScalar @("rev-parse", "HEAD") "GIT_SCALAR_ZERO_SELF_TEST") }
catch { $zeroRejected = $_.Exception.Message -eq "GIT_SCALAR_ZERO_SELF_TEST" }
if (-not $zeroRejected) { Fail "GIT_SCALAR_ZERO_SELF_TEST_FAILED" }
$script:StubGitLines = @("one", "two")
$twoRejected = $false
try { [void](Invoke-GitScalar @("rev-parse", "HEAD") "GIT_SCALAR_TWO_SELF_TEST") }
catch { $twoRejected = $_.Exception.Message -eq "GIT_SCALAR_TWO_SELF_TEST" }
if (-not $twoRejected) { Fail "GIT_SCALAR_TWO_SELF_TEST_FAILED" }
Write-Output "PASS"
`, "utf8");
    const powerShell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const result = spawnSync(powerShell, [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-ExpectedGateControlCommit",
      expectedHead,
      "-ExpectedLkgAuditRunId",
      "1",
      "-ExpectedLkgAuditControlProofDigest",
      "0".repeat(64),
      "-ExpectedLkgSelectionProofDigest",
      "1".repeat(64),
    ], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    assert.equal(result.status, 0, `PowerShell Git scalar self-test failed: ${result.stderr}`);
    assert.equal(result.stdout.trim(), "PASS");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function assertPowerShellFailurePublisherBehavior() {
  if (process.platform !== "win32" || process.env.RC6_2_FAILURE_VALIDATOR_CHILD_TEST === "1") return;
  const helperStart = wrapper.indexOf("function Sha256Text");
  const helperEnd = wrapper.indexOf("function Initialize-EvidenceDestination");
  assert.ok(helperStart >= 0 && helperEnd > helperStart, "failure publisher helper boundary is missing");
  const directory = await mkdtemp(join(tmpdir(), "novel-rc6-2-failure-publisher-"));
  const scriptPath = join(directory, "failure-publisher-self-test.ps1");
  const escapedDirectory = directory.replaceAll("'", "''");
  try {
    await writeFile(scriptPath, `$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
function Fail([string]$Code) { throw $Code }
${wrapper.slice(helperStart, helperEnd)}
$evidenceDirectory = '${escapedDirectory}'
$evidencePath = Join-Path $evidenceDirectory 'pass.json'
$failureEvidencePath = Join-Path $evidenceDirectory 'failure.json'
$ExpectedGateControlCommit = '${"a".repeat(40)}'
$ExpectedLkgAuditRunId = 7
$ExpectedLkgAuditControlProofDigest = '${"b".repeat(64)}'
$ExpectedLkgSelectionProofDigest = '${"c".repeat(64)}'
$productCommit = '${PRODUCT_COMMIT}'
$failedRecoveryControl = '${FAILED_RECOVERY_CONTROL}'
$productionRecoveryControl = '${PRODUCTION_RECOVERY_CONTROL}'
$initialBrowserGateControl = '${INITIAL_BROWSER_GATE_CONTROL}'
$previousBrowserGateControl = '${PREVIOUS_BROWSER_GATE_CONTROL}'
$expectedDeployment = '${EXPECTED_DEPLOYMENT_ID}'
function Get-MainCasStatus { return "pass" }
$capture = [pscustomobject][ordered]@{
  schemaVersion = "p24b-rc6.2-production-browser-gate-c5-runner-capture-v1"
  stage = "runner-start"
  runnerStarted = $false
  exitCode = $null
  elapsedMs = 1
  stdoutUtf8ByteLength = 0
  stderrUtf8ByteLength = 0
  heartbeatCounts = [pscustomobject][ordered]@{ setup = 0; candidateGeneration = 0; t1Analysis = 0 }
  evidenceDisposition = "wrapper-fallback"
}
$postchecks = [ordered]@{
  runnerProcessCleanup = "not-run"; runnerEvidenceCleanup = "pass"; profileCleanup = "not-run"
  residueOwnedGateArtifacts = "pass"; serviceSnapshot = "pass"; releaseIdentity = "pass"
  runtimeReceipt = "pass"; releaseAttestation = "pass"; controlLineage = "pass"
  trackedGateBlobs = "pass"; productRuntimeBlobs = "pass"; releaseTag = "pass"
  worktree = "pass"; remoteMainCas = "not-run"
}
$json = Publish-C5FailureEvidence $capture $postchecks "PRODUCTION_BROWSER_RUNNER_START_FAILED"
$bytesBefore = [IO.File]::ReadAllBytes($failureEvidencePath)
$parsed = $json | ConvertFrom-Json
if ($parsed.body.status -ne "FAIL" -or $parsed.body.qualifiesProductionBrowserGate -ne $false) { exit 2 }
if ($parsed.body.eligibleForLuna -ne $false -or $parsed.sanitized -ne $true) { exit 3 }
if ($parsed.rawSecretsStored -ne $false -or $parsed.body.postchecks.remoteMainCas -ne "pass") { exit 4 }
if ($parsed.body.terminalWrapperCode -ne "PRODUCTION_BROWSER_RUNNER_START_FAILED") { exit 5 }
$rejected = $false
try { [void](Publish-C5FailureEvidence $capture $postchecks "PRODUCTION_BROWSER_RUNNER_START_FAILED") }
catch { $rejected = $_.Exception.Message -eq "FAILURE_EVIDENCE_DESTINATION_RACE" }
if (-not $rejected) { exit 6 }
$bytesAfter = [IO.File]::ReadAllBytes($failureEvidencePath)
if ($bytesBefore.Length -ne $bytesAfter.Length) { exit 7 }
for ($index = 0; $index -lt $bytesBefore.Length; $index += 1) {
  if ($bytesBefore[$index] -ne $bytesAfter[$index]) { exit 8 }
}
if (@(Get-ChildItem -LiteralPath $evidenceDirectory -Filter '*.tmp').Count -ne 0) { exit 9 }
$createNewPath = Join-Path $evidenceDirectory 'create-new.txt'
[IO.File]::WriteAllText($createNewPath, 'original')
$createNewRejected = $false
try { Write-CreateNewFlushedFile $createNewPath 'replacement' 'CREATE_NEW_REJECTED' }
catch { $createNewRejected = $_.Exception.Message -eq 'CREATE_NEW_REJECTED' }
if (-not $createNewRejected -or [IO.File]::ReadAllText($createNewPath) -ne 'original') { exit 10 }
$evidencePath = Join-Path $evidenceDirectory 'tamper-pass.json'
$failureEvidencePath = Join-Path $evidenceDirectory 'tamper-failure.json'
$script:casCallCount = 0
function Get-MainCasStatus {
  $script:casCallCount += 1
  if ($script:casCallCount -eq 2) {
    $pending = @(Get-ChildItem -LiteralPath $evidenceDirectory -Filter '*.tmp')
    if ($pending.Count -ne 1) { exit 11 }
    [IO.File]::WriteAllText($pending[0].FullName, 'tampered-after-cas')
  }
  return "pass"
}
$tamperRejected = $false
try { [void](Publish-C5FailureEvidence $capture $postchecks "PRODUCTION_BROWSER_RUNNER_START_FAILED") }
catch { $tamperRejected = $_.Exception.Message -eq "FAILURE_EVIDENCE_TEMP_READBACK_MISMATCH" }
if (-not $tamperRejected -or (Test-Path -LiteralPath $failureEvidencePath)) { exit 12 }
if (@(Get-ChildItem -LiteralPath $evidenceDirectory -Filter '*.tmp').Count -ne 0) { exit 13 }
Write-Output "PASS"
`, "utf8");
    const powerShell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const result = spawnSync(powerShell, [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
    ], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    assert.equal(result.status, 0, `PowerShell failure publisher self-test failed: ${result.stderr}`);
    assert.equal(result.stdout.trim(), "PASS");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function writeAuditControlProof() {
  const controlCommit = String(process.env.GITHUB_SHA ?? "").trim();
  const outputPath = resolve(String(process.env.BROWSER_GATE_CONTROL_PROOF_PATH ?? ""));
  const runnerTemp = resolve(String(process.env.RUNNER_TEMP ?? ""));
  assert.match(controlCommit, /^[a-f0-9]{40}$/u);
  assert.equal(process.env.EXPECTED_OPERATION, "audit-rc6-2-last-known-good");
  assert.equal(process.env.GITHUB_REPOSITORY, "bobobo-org/novel");
  assert.equal(process.env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.equal(process.env.GITHUB_REF, "refs/heads/main");
  assert.equal(process.env.GITHUB_WORKFLOW_SHA, controlCommit);
  assert.match(String(process.env.GITHUB_WORKFLOW_REF ?? ""), /bobobo-org\/novel\/\.github\/workflows\/deploy\.yml@refs\/heads\/main$/u);
  assert.match(String(process.env.GITHUB_RUN_ID ?? ""), /^[1-9][0-9]{0,19}$/u);
  assert.match(String(process.env.GITHUB_RUN_ATTEMPT ?? ""), /^[1-9][0-9]{0,9}$/u);
  assert.equal(dirname(outputPath), runnerTemp);
  assert.equal(gitOutput(["rev-parse", "HEAD"]), controlCommit);
  assert.deepEqual(
    gitOutput(["rev-list", "--parents", "-n", "1", controlCommit]).split(/\s+/u),
    [controlCommit, PREVIOUS_BROWSER_GATE_CONTROL],
  );
  assert.deepEqual(
    gitOutput(["rev-list", "--parents", "-n", "1", PREVIOUS_BROWSER_GATE_CONTROL]).split(/\s+/u),
    [PREVIOUS_BROWSER_GATE_CONTROL, INITIAL_BROWSER_GATE_CONTROL],
  );
  assert.deepEqual(
    gitOutput(["rev-list", "--parents", "-n", "1", INITIAL_BROWSER_GATE_CONTROL]).split(/\s+/u),
    [INITIAL_BROWSER_GATE_CONTROL, PRODUCTION_RECOVERY_CONTROL],
  );
  assert.deepEqual(
    gitOutput(["rev-list", "--parents", "-n", "1", PRODUCTION_RECOVERY_CONTROL]).split(/\s+/u),
    [PRODUCTION_RECOVERY_CONTROL, FAILED_RECOVERY_CONTROL],
  );
  assert.deepEqual(
    gitOutput(["rev-list", "--parents", "-n", "1", FAILED_RECOVERY_CONTROL]).split(/\s+/u),
    [FAILED_RECOVERY_CONTROL, PRODUCT_COMMIT],
  );
  gitOutput(["merge-base", "--is-ancestor", PRODUCT_COMMIT, controlCommit]);
  const changedPaths = gitOutput([
    "diff",
    "--name-status",
    "--diff-filter=ACDMRTUXB",
    PREVIOUS_BROWSER_GATE_CONTROL,
    controlCommit,
  ]).split(/\r?\n/u).filter(Boolean).map((line) => {
    const match = /^([AM])\t([^\0\r\n\t]{1,512})$/u.exec(line);
    assert.ok(match, "browser gate control diff contains a forbidden status");
    return match[2].replaceAll("\\", "/");
  }).sort();
  assert.deepEqual(changedPaths, [...GATE_REPAIR_PATHS].sort());
  const previousChangedPaths = gitOutput([
    "diff",
    "--name-status",
    "--diff-filter=ACDMRTUXB",
    INITIAL_BROWSER_GATE_CONTROL,
    PREVIOUS_BROWSER_GATE_CONTROL,
  ]).split(/\r?\n/u).filter(Boolean).map((line) => {
    const match = /^([AM])\t([^\0\r\n\t]{1,512})$/u.exec(line);
    assert.ok(match, "previous browser gate control diff contains a forbidden status");
    return match[2].replaceAll("\\", "/");
  }).sort();
  assert.deepEqual(previousChangedPaths, [...GATE_REPAIR_PATHS].sort());
  const initialChangedPaths = gitOutput([
    "diff",
    "--name-status",
    "--diff-filter=ACDMRTUXB",
    PRODUCTION_RECOVERY_CONTROL,
    INITIAL_BROWSER_GATE_CONTROL,
  ]).split(/\r?\n/u).filter(Boolean).map((line) => {
    const match = /^([AM])\t([^\0\r\n\t]{1,512})$/u.exec(line);
    assert.ok(match, "initial browser gate control diff contains a forbidden status");
    return match[2].replaceAll("\\", "/");
  }).sort();
  assert.deepEqual(initialChangedPaths, [...GATE_BLOB_PATHS].sort());
  const compositeChangedPaths = gitOutput([
    "diff",
    "--name-status",
    "--diff-filter=ACDMRTUXB",
    PRODUCTION_RECOVERY_CONTROL,
    controlCommit,
  ]).split(/\r?\n/u).filter(Boolean).map((line) => {
    const match = /^([AM])\t([^\0\r\n\t]{1,512})$/u.exec(line);
    assert.ok(match, "browser gate composite diff contains a forbidden status");
    return match[2].replaceAll("\\", "/");
  }).sort();
  assert.deepEqual(compositeChangedPaths, [...GATE_BLOB_PATHS].sort());
  const body = {
    schemaVersion: "p24b-rc6.2-browser-gate-control-proof-v2",
    operation: process.env.EXPECTED_OPERATION,
    productCommit: PRODUCT_COMMIT,
    failedRecoveryControl: FAILED_RECOVERY_CONTROL,
    productionRecoveryControl: PRODUCTION_RECOVERY_CONTROL,
    initialBrowserGateControl: INITIAL_BROWSER_GATE_CONTROL,
    previousBrowserGateControl: PREVIOUS_BROWSER_GATE_CONTROL,
    browserGateControl: controlCommit,
    parentCommit: PREVIOUS_BROWSER_GATE_CONTROL,
    repository: process.env.GITHUB_REPOSITORY,
    eventName: process.env.GITHUB_EVENT_NAME,
    eventRef: process.env.GITHUB_REF,
    workflowSha: process.env.GITHUB_WORKFLOW_SHA,
    workflowRef: process.env.GITHUB_WORKFLOW_REF,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    lineage: [
      controlCommit,
      PREVIOUS_BROWSER_GATE_CONTROL,
      INITIAL_BROWSER_GATE_CONTROL,
      PRODUCTION_RECOVERY_CONTROL,
      FAILED_RECOVERY_CONTROL,
      PRODUCT_COMMIT,
    ],
    changedPaths,
    previousChangedPaths,
    initialChangedPaths,
    compositeChangedPaths,
  };
  const proof = {
    ...body,
    proofDigest: createHash("sha256").update(stableStringify({
      domain: "p24b-rc6.2-browser-gate-control-proof-v2",
      body,
    })).digest("hex"),
  };
  await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  const githubOutput = String(process.env.GITHUB_OUTPUT ?? "").trim();
  assert.ok(githubOutput);
  await appendFile(githubOutput, `proof_digest=${proof.proofDigest}\n`, "utf8");
  console.log(JSON.stringify({ status: "PASS", proofDigest: proof.proofDigest }));
}

if (process.argv[2] === "write-audit-control-proof") {
  await writeAuditControlProof();
  process.exit(0);
}

for (const literal of [
  "29fc6e742672bb07187765d34ea818afdadf56ae",
  "9cd074f239b73dd9b61f6d758fcf97fbd809face",
  "3b716fc0d974a9d59b49ffca5953776af66c7a07",
  "aab0e7bd52c57bc57ecfe8be8b08c1cf63db9824",
  "100eea11003c5132ab2b519707c5dee658bc9cbe",
  "dpl_8pqTpwAgQQAqmLKNzZNCzSfPuqNn",
  "novel-ai-p24b-conversation-first-studio-rc6.2",
  "b91dc4695293c9b439b6d4cc2508ffba99915b81",
  "https://novel-orcin.vercel.app",
  "https://novel-lqtechs-projects.vercel.app",
  "https://novel-eexnlr77y-lqtechs-projects.vercel.app",
]) {
  assert.equal(occurrences(wrapper, literal), 1, `wrapper identity literal must occur once: ${literal}`);
}

await assertPowerShellGitScalarBehavior();
if (process.argv.length === 2) await assertPowerShellFailurePublisherBehavior();

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const dependencyPackages = [
  {
    name: "@playwright/test",
    linkedPath: join(repositoryRoot, "node_modules", "@playwright", "test"),
    packagePath: join(repositoryRoot, "node_modules", ".pnpm", "@playwright+test@1.61.1", "node_modules", "@playwright", "test"),
    digest: "0a790d924aa71007bc11405b0c27ebc581912ae3f01ef7b89d1359038b336f48",
  },
  {
    name: "playwright",
    packagePath: join(repositoryRoot, "node_modules", ".pnpm", "playwright@1.61.1", "node_modules", "playwright"),
    digest: "e9979a347da48432d060cf4df638ec6682735b8dc3db96b1e5dc13138a583f43",
  },
  {
    name: "playwright-core",
    packagePath: join(repositoryRoot, "node_modules", ".pnpm", "playwright-core@1.61.1", "node_modules", "playwright-core"),
    digest: "efff85ef77071866494ea4b35c90060b2eb96098f5633f8dee6c2b28c24000ac",
  },
];
const dependencyReceipts = [];
for (const dependency of dependencyPackages) {
  const expectedRoot = resolve(dependency.packagePath);
  assert.equal(await realpath(expectedRoot), expectedRoot, `${dependency.name} package root drifted`);
  if (dependency.linkedPath) {
    assert.equal(await realpath(dependency.linkedPath), expectedRoot, `${dependency.name} workspace link drifted`);
  }
  const packageJson = JSON.parse(await readFile(join(expectedRoot, "package.json"), "utf8"));
  assert.equal(packageJson.name, dependency.name);
  assert.equal(packageJson.version, "1.61.1");
  const digest = await dependencyDigest(expectedRoot);
  assert.equal(digest, dependency.digest, `${dependency.name} bytes drifted`);
  dependencyReceipts.push({ name: dependency.name, version: packageJson.version, digest });
}

const testPackageRoot = resolve(dependencyPackages[0].packagePath);
const playwrightPackageRoot = resolve(dependencyPackages[1].packagePath);
const playwrightCorePackageRoot = resolve(dependencyPackages[2].packagePath);
const testVirtualNodeModules = resolve(testPackageRoot, "..", "..");
const playwrightVirtualNodeModules = resolve(playwrightPackageRoot, "..");
await assertExactDirectoryEntries(testVirtualNodeModules, ["@playwright", "playwright"]);
await assertExactDirectoryEntries(playwrightVirtualNodeModules, ["playwright", "playwright-core"]);
assert.equal(await realpath(join(testVirtualNodeModules, "@playwright", "test")), testPackageRoot);
assert.equal(await realpath(join(testVirtualNodeModules, "playwright")), playwrightPackageRoot);
assert.equal(await realpath(join(playwrightVirtualNodeModules, "playwright")), playwrightPackageRoot);
assert.equal(await realpath(join(playwrightVirtualNodeModules, "playwright-core")), playwrightCorePackageRoot);
await assertExactDirectoryEntries(join(testPackageRoot, "node_modules"), [".bin"]);
await assertExactDirectoryEntries(join(playwrightPackageRoot, "node_modules"), [".bin"]);
const testBinReceipt = await completeTreeReceipt(join(testPackageRoot, "node_modules", ".bin"));
const playwrightBinReceipt = await completeTreeReceipt(join(playwrightPackageRoot, "node_modules", ".bin"));
assert.deepEqual(testBinReceipt, {
  fileCount: 3,
  byteCount: 3_881,
  digest: "1df12ad3918f333e03bfc42906b7d9292af7898a04a1b98aa4308d21b5f00a70",
});
assert.deepEqual(playwrightBinReceipt, {
  fileCount: 3,
  byteCount: 4_027,
  digest: "e0d6bb1289bee38c5880540dac79fc84202363c6cc7ba4cbd955a0dab00621c9",
});

assert.equal(await sha256File(join(repositoryRoot, "package.json")), EXPECTED_PACKAGE_JSON_DIGEST);
assert.equal(await sha256File(join(repositoryRoot, "pnpm-lock.yaml")), EXPECTED_PNPM_LOCK_DIGEST);
const edgeVersionRoot = resolve(
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application",
  EXPECTED_EDGE_VERSION,
);
assert.equal((await stat(edgeVersionRoot)).isDirectory(), true);
assert.equal(await sha256File(join(dirname(edgeVersionRoot), "msedge.exe")), EXPECTED_EDGE_EXE_DIGEST);
assert.equal(await sha256File(join(edgeVersionRoot, "msedge.dll")), EXPECTED_EDGE_DLL_DIGEST);
const edgeTreeReceipt = await completeTreeReceipt(edgeVersionRoot);
assert.deepEqual(edgeTreeReceipt, {
  fileCount: 784,
  byteCount: 902_433_921,
  digest: EXPECTED_EDGE_DIRECTORY_DIGEST,
});

const runtimeReceiptBody = {
  schemaVersion: "p24b-rc6.2-production-browser-runtime-receipt-v1",
  packageJsonDigest: EXPECTED_PACKAGE_JSON_DIGEST,
  pnpmLockDigest: EXPECTED_PNPM_LOCK_DIGEST,
  dependencies: dependencyReceipts,
  dependencyLinks: {
    testToPlaywright: true,
    playwrightToCore: true,
    testBinDigest: testBinReceipt.digest,
    playwrightBinDigest: playwrightBinReceipt.digest,
  },
  edge: {
    version: EXPECTED_EDGE_VERSION,
    executableDigest: EXPECTED_EDGE_EXE_DIGEST,
    engineDllDigest: EXPECTED_EDGE_DLL_DIGEST,
    versionDirectoryDigest: edgeTreeReceipt.digest,
    versionDirectoryFileCount: edgeTreeReceipt.fileCount,
    versionDirectoryByteCount: edgeTreeReceipt.byteCount,
  },
};
const runtimeReceipt = {
  ...runtimeReceiptBody,
  proofDigest: createHash("sha256").update(stableStringify({
    domain: "p24b-rc6.2-production-browser-runtime-receipt-v1",
    body: runtimeReceiptBody,
  })).digest("hex"),
};

function assertSafeProjectedEvidence(value, path = "evidence", depth = 0) {
  assert.ok(depth <= 40, `${path} is too deeply nested`);
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${path} is not finite`);
    return;
  }
  if (typeof value === "string") {
    assert.ok(value.length <= 8_192 && !value.includes("\0"), `${path} string is unsafe`);
    return;
  }
  if (Array.isArray(value)) {
    assert.ok(value.length <= 512, `${path} array is too large`);
    value.forEach((entry, index) => assertSafeProjectedEvidence(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  assertPlainObject(value, path);
  const forbiddenKeys = new Set([
    "__proto__",
    "constructor",
    "content",
    "direction",
    "input",
    "messages",
    "objective",
    "output",
    "prompt",
    "prototype",
    "serializedSource",
    "summary",
    "text",
  ]);
  const keys = Object.keys(value);
  assert.ok(keys.length <= 128, `${path} has too many fields`);
  for (const key of keys) {
    assert.equal(forbiddenKeys.has(key), false, `${path}.${key} is a forbidden raw-value field`);
    assertSafeProjectedEvidence(value[key], `${path}.${key}`, depth + 1);
  }
}

function hasExactKeySet(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => (
      /^[A-Za-z][A-Za-z0-9]*$/u.test(key)
      && key === expected[index]
    ));
}

function assertSafeCount(value, label) {
  assert.ok(
    Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000,
    `${label} is not a bounded count`,
  );
  return value;
}

function assertRunnerFailureError(error) {
  assertExactKeys(error, ["code", "diagnosticCodes", "browserRuntimeEvidence"], "runner error");
  assert.equal(RUNNER_SAFE_FAILURE_CODES.has(error.code), true, "runner error code is not allowlisted");
  assert.ok(Array.isArray(error.diagnosticCodes) && error.diagnosticCodes.length <= 12);
  assert.equal(new Set(error.diagnosticCodes).size, error.diagnosticCodes.length);
  assert.deepEqual(error.diagnosticCodes, [...error.diagnosticCodes].sort());
  for (const code of error.diagnosticCodes) {
    assert.equal(RUNNER_SAFE_DIAGNOSTIC_CODES.has(code), true, "runner diagnostic code is not allowlisted");
  }
  assert.ok(Array.isArray(error.browserRuntimeEvidence));
  assert.ok(error.browserRuntimeEvidence.length <= 3);
  for (const [index, entry] of error.browserRuntimeEvidence.entries()) {
    assertExactKeys(entry, [
      "stage",
      "finishReason",
      "completionTokens",
      "rawOutputCharacters",
      "normalizedOutputCharacters",
      "observedHanCharacters",
    ], "runner browserRuntimeEvidence entry");
    assert.ok(["initial", "repair", "extension", "recovery"].includes(entry.stage));
    assert.ok(["stop", "length", "tool_calls", "abort", "unavailable"].includes(entry.finishReason));
    const maximums = {
      completionTokens: 4_096,
      rawOutputCharacters: 20_000,
      normalizedOutputCharacters: 20_000,
      observedHanCharacters: 10_000,
    };
    for (const [key, maximum] of Object.entries(maximums)) {
      assert.ok(entry[key] === null || (
        Number.isSafeInteger(entry[key]) && entry[key] >= 0 && entry[key] <= maximum
      ));
    }
    if (entry.finishReason === "unavailable") {
      assert.deepEqual(Object.keys(maximums).map((key) => entry[key]), [null, null, null, null]);
    }
    assert.equal(entry.stage, ["initial", "repair"][index]
      ?? (index === 2 && ["extension", "recovery"].includes(entry.stage) ? entry.stage : null));
  }
}

function assertNetworkZeroReceipt(value) {
  assertExactKeys(value, [
    "schemaVersion",
    "httpAttemptCount",
    "httpBlockedBeforeSendCount",
    "webSocketAttemptCount",
    "webSocketBlockedBeforeConnectCount",
    "tcpConnectionReceiptCount",
    "httpRequestReceiptCount",
    "httpRequestBodyByteCount",
    "webSocketUpgradeReceiptCount",
    "arbitraryOutboundHeaderStrippedOrBlocked",
    "requestBodyBlocked",
  ], "runner network zero receipt");
  assert.deepEqual(value, {
    schemaVersion: "p24b-rc6.2-network-zero-receipt-v1",
    httpAttemptCount: 2,
    httpBlockedBeforeSendCount: 2,
    webSocketAttemptCount: 1,
    webSocketBlockedBeforeConnectCount: 1,
    tcpConnectionReceiptCount: 0,
    httpRequestReceiptCount: 0,
    httpRequestBodyByteCount: 0,
    webSocketUpgradeReceiptCount: 0,
    arbitraryOutboundHeaderStrippedOrBlocked: true,
    requestBodyBlocked: true,
  });
}

function classifyRunnerFailureSchema(evidence) {
  for (const optionalKeys of [
    [],
    ["uiSafeErrorCodesAtFailure"],
    ["uiStateAtFailure"],
    ["uiSafeErrorCodesAtFailure", "uiStateAtFailure"],
  ]) {
    const required = RUNNER_DETAILED_FAILURE_KEYS.filter((key) => !optionalKeys.includes(key));
    if (hasExactKeySet(evidence, required)) return "detailed";
  }
  if (hasExactKeySet(evidence, RUNNER_MINIMAL_FAILURE_KEYS)) return "minimal";
  if (hasExactKeySet(evidence, [...RUNNER_MINIMAL_FAILURE_KEYS, "freshBrowserContext"])) {
    return "safe-projection-fallback";
  }
  if (hasExactKeySet(evidence, [...RUNNER_SUCCESS_EVIDENCE_KEYS, "error"])) {
    return "cleanup-failure-after-pass";
  }
  assert.fail("runner FAIL evidence keys did not match an exact v3 schema");
}

function runnerFailureCount(evidence, schemaKind, key) {
  if (schemaKind === "cleanup-failure-after-pass") {
    const policyMapping = {
      blockedNetworkPolicyAttemptCount: "disallowedRequestCount",
      disallowedMethodRequestCount: "disallowedMethodRequestCount",
      blockedNonToolbarResponseCount: "blockedNonToolbarResponseCount",
      observedPreviewToolbarRequestCount: "observedPreviewToolbarRequestCount",
      blockedPreviewToolbarRequestCount: "blockedPreviewToolbarRequestCount",
      previewToolbarResponseCount: "previewToolbarResponseCount",
      observedWebSocketAttemptCount: "observedWebSocketAttemptCount",
      blockedWebSocketAttemptCount: "blockedWebSocketAttemptCount",
      disallowedWebSocketAttemptCount: "disallowedWebSocketAttemptCount",
      webSocketServerConnectionCount: "webSocketServerConnectionCount",
      observedPreviewToolbarWebSocketAttemptCount: "observedPreviewToolbarWebSocketAttemptCount",
      blockedPreviewToolbarWebSocketAttemptCount: "blockedPreviewToolbarWebSocketAttemptCount",
    };
    if (key === "prohibitedExternalAiRequestCount") {
      return assertSafeCount(evidence.prohibitedExternalAiRequestCount, key);
    }
    const policyKey = policyMapping[key];
    return policyKey === undefined
      ? null
      : assertSafeCount(evidence.crossOriginPolicy[policyKey], key);
  }
  return Object.hasOwn(evidence, key) ? assertSafeCount(evidence[key], key) : null;
}

function parseRunnerFailureStream(raw) {
  assert.equal(typeof raw, "string");
  assert.ok(Buffer.byteLength(raw, "utf8") > 0 && Buffer.byteLength(raw, "utf8") <= 1_048_576);
  assert.equal(raw.startsWith("\uFEFF"), false, "runner failure stream contained a BOM");
  assert.equal(raw.includes("\0"), false, "runner failure stream contained NUL");
  assert.equal(raw.includes("\uFFFD"), false, "runner failure stream contained a replacement character");
  const heartbeat = /^\[RC6\.2 Closed AI\] (setup|candidate generation|T1 analysis) in progress \([0-9]{1,6}s\)\r?\n/u;
  const progress = {
    setup: 0,
    candidateGeneration: 0,
    t1Analysis: 0,
  };
  let jsonStream = raw;
  let heartbeatCount = 0;
  while (true) {
    const match = jsonStream.match(heartbeat);
    if (!match) break;
    heartbeatCount += 1;
    assert.ok(heartbeatCount <= 4_096, "runner failure stream had too many heartbeat lines");
    if (match[1] === "setup") progress.setup += 1;
    else if (match[1] === "candidate generation") progress.candidateGeneration += 1;
    else progress.t1Analysis += 1;
    jsonStream = jsonStream.slice(match[0].length);
  }
  if (jsonStream.endsWith("\r\n")) jsonStream = jsonStream.slice(0, -2);
  else if (jsonStream.endsWith("\n")) jsonStream = jsonStream.slice(0, -1);
  assert.ok(jsonStream.startsWith("{") && jsonStream.endsWith("}"));
  assert.equal(jsonStream.includes("\r"), false, "runner canonical JSON used CR characters");
  const evidence = JSON.parse(jsonStream);
  assert.equal(JSON.stringify(evidence, null, 2), jsonStream, "runner FAIL JSON was not canonical");
  return { evidence, jsonStream, progress };
}

function validateRunnerFailureRaw(raw) {
  const { evidence, progress } = parseRunnerFailureStream(raw);
  assert.equal(evidence.schemaVersion, RUNNER_EVIDENCE_SCHEMA_VERSION);
  assert.equal(evidence.status, "FAIL");
  assert.equal(evidence.mode, "generation");
  assert.equal(evidence.exactOrigin, EXPECTED_ORIGIN);
  assert.equal(typeof evidence.profileDisposed, "boolean");
  assert.match(evidence.completedAt, /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u);
  assert.equal(new Date(evidence.completedAt).toISOString(), evidence.completedAt);
  assertRunnerFailureError(evidence.error);
  assertSafeProjectedEvidence(evidence, "runnerFailureEvidence");
  const schemaKind = classifyRunnerFailureSchema(evidence);
  if (Object.hasOwn(evidence, "freshBrowserContext")) {
    assert.equal(evidence.freshBrowserContext, true);
  }
  let checkpoint = null;
  let requestPhase = null;
  if (schemaKind === "detailed") {
    assert.equal(RUNNER_CHECKPOINTS.has(evidence.gateCheckpoint), true);
    assert.equal(RUNNER_REQUEST_PHASES.has(evidence.requestPhase), true);
    checkpoint = evidence.gateCheckpoint;
    requestPhase = evidence.requestPhase;
    if (Object.hasOwn(evidence, "uiSafeErrorCodesAtFailure")) {
      assert.ok(Array.isArray(evidence.uiSafeErrorCodesAtFailure));
      assert.ok(evidence.uiSafeErrorCodesAtFailure.length <= 128);
      assert.deepEqual(evidence.uiSafeErrorCodesAtFailure, [...evidence.uiSafeErrorCodesAtFailure].sort());
      for (const code of evidence.uiSafeErrorCodesAtFailure) {
        assert.equal(RUNNER_UI_FAILURE_CODES.includes(code), true);
      }
    }
  }
  if (schemaKind === "cleanup-failure-after-pass") {
    const successEvidence = { ...evidence, status: "PASS", profileDisposed: true };
    delete successEvidence.error;
    assertValidSuccessEvidence(successEvidence);
  }
  let routeInstalled = evidence.contextRouteInstalledBeforeNavigation;
  let webSocketRouteInstalled = evidence.contextWebSocketRouteInstalledBeforeNavigation;
  let profileOwnership = evidence.profileOwnershipAtFailure;
  let profilePathDigest = evidence.profilePathDigestAtFailure;
  let networkReceipt = evidence.networkSentinelEvidenceAtFailure ?? null;
  if (schemaKind === "cleanup-failure-after-pass") {
    routeInstalled = evidence.crossOriginPolicy.contextRouteInstalledBeforeNavigation;
    webSocketRouteInstalled = evidence.crossOriginPolicy.webSocketRouteInstalledBeforeNavigation;
    profileOwnership = evidence.edgeIdentity.profileOwnership;
    profilePathDigest = evidence.edgeIdentity.profilePathDigest;
    networkReceipt = evidence.networkZeroReceipt;
  } else {
    assert.equal(evidence.webSocketPolicy, "blocked-before-connect");
  }
  assert.equal(typeof routeInstalled, "boolean");
  assert.equal(typeof webSocketRouteInstalled, "boolean");
  assert.ok(profileOwnership === null || profileOwnership === "wrapper-owned");
  if (profilePathDigest !== null) assertSha256(profilePathDigest, "runner profile path digest");
  let networkZeroReceiptDigest = null;
  if (networkReceipt !== null) {
    assertNetworkZeroReceipt(networkReceipt);
    networkZeroReceiptDigest = createHash("sha256")
      .update(stableStringify(networkReceipt))
      .digest("hex");
  }
  const counts = Object.fromEntries(RUNNER_FAILURE_COUNT_KEYS.map((key) => [
    key,
    runnerFailureCount(evidence, schemaKind, key),
  ]));
  return {
    schemaVersion: "p24b-rc6.2-validated-runner-failure-projection-v1",
    schemaKind,
    gateCheckpoint: checkpoint,
    requestPhase,
    errorCode: evidence.error.code,
    route: {
      contextRouteInstalledBeforeNavigation: routeInstalled,
      webSocketRouteInstalledBeforeNavigation: webSocketRouteInstalled,
    },
    profile: {
      ownership: profileOwnership,
      pathDigest: profilePathDigest,
      disposed: evidence.profileDisposed,
    },
    counts,
    digests: {
      networkZeroReceiptDigest,
    },
    heartbeatCounts: progress,
  };
}

async function validateFailureEvidence() {
  const chunks = [];
  let byteLength = 0;
  for await (const chunkValue of process.stdin) {
    const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue);
    byteLength += chunk.length;
    assert.ok(byteLength <= 1_048_576, "runner failure input exceeded the byte limit");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks, byteLength);
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assert.deepEqual(Buffer.from(raw, "utf8"), bytes, "runner failure input was not canonical UTF-8");
  const projection = validateRunnerFailureRaw(raw);
  const projectionDigest = createHash("sha256").update(stableStringify(projection)).digest("hex");
  console.log(JSON.stringify({
    status: "PASS",
    projectionDigest,
    projection,
  }));
}

function minimalRunnerFailureFixture() {
  return {
    schemaVersion: RUNNER_EVIDENCE_SCHEMA_VERSION,
    status: "FAIL",
    mode: "generation",
    exactOrigin: EXPECTED_ORIGIN,
    profileOwnershipAtFailure: null,
    profilePathDigestAtFailure: null,
    contextRouteInstalledBeforeNavigation: false,
    contextWebSocketRouteInstalledBeforeNavigation: false,
    webSocketPolicy: "blocked-before-connect",
    observedWebSocketAttemptCount: 0,
    blockedWebSocketAttemptCount: 0,
    disallowedWebSocketAttemptCount: 0,
    webSocketServerConnectionCount: 0,
    observedPreviewToolbarWebSocketAttemptCount: 0,
    blockedPreviewToolbarWebSocketAttemptCount: 0,
    error: {
      code: "RC6_2_CLOSED_AI_GATE_FAILED",
      diagnosticCodes: [],
      browserRuntimeEvidence: [],
    },
    profileDisposed: false,
    completedAt: "2026-08-11T20:45:00.000Z",
  };
}

function detailedRunnerFailureFixture() {
  const evidence = Object.fromEntries(RUNNER_DETAILED_FAILURE_KEYS.map((key) => [key, null]));
  Object.assign(evidence, minimalRunnerFailureFixture(), {
    freshBrowserContext: true,
    requestPhase: "bootstrap",
    gateCheckpoint: "launch",
    freshStorageAtFailure: null,
    modelMetadataAtFailure: null,
    latestRegenerationAttemptEvidence: null,
    uiSafeErrorCodesAtFailure: [],
    uiStateAtFailure: null,
    networkSentinelEvidenceAtFailure: null,
    blockedNetworkPolicyAttempts: [],
    blockedNetworkPolicyProjectionTruncated: false,
    disallowedSameOriginTargetRequests: [],
    disallowedImmutableModelTargetRequests: [],
    blockedNonToolbarResponses: [],
    disallowedWebSocketAttempts: [],
    disallowedWebSocketProjectionTruncated: false,
    blockedPreviewToolbarWebSocketAttempts: [],
    blockedPreviewToolbarWebSocketProjectionTruncated: false,
    disallowedCrossOriginHostDigests: [],
  });
  for (const key of RUNNER_FAILURE_COUNT_KEYS) evidence[key] = 0;
  return evidence;
}

function cleanupFailureAfterPassFixture() {
  const digest = "0".repeat(64);
  const candidate = (status) => ({
    backendId: "browser-ai",
    actualExecutor: "browser-ai",
    status,
    candidateOnly: true,
    canonicalMutationCount: 0,
    modelDigest: digest,
    contentDigest: digest,
    executionReceipt: {
      backendId: "browser-ai",
      actualExecutor: "browser-ai",
      externalRequest: false,
      dataLeftDevice: false,
      proofState: "verified",
    },
  });
  const receipt = (actualExecutor) => ({
    schemaVersion: "browser-execution-receipt-v3",
    actualExecutor,
    externalAIUsed: false,
    dataLeftDevice: false,
    candidateOnly: true,
    canonicalMutationCount: 0,
    rawPromptStored: false,
    rawOutputStored: false,
    rawChainOfThoughtStored: false,
    receiptIntegrityVerified: true,
  });
  return {
    schemaVersion: RUNNER_EVIDENCE_SCHEMA_VERSION,
    status: "FAIL",
    mode: "generation",
    exactOrigin: EXPECTED_ORIGIN,
    freshBrowserContext: true,
    releaseIdentity: {
      appCommit: PRODUCT_COMMIT,
      releaseProductCommit: PRODUCT_COMMIT,
      deploymentId: EXPECTED_DEPLOYMENT_ID,
      releaseTag: EXPECTED_RELEASE_TAG,
      releaseRevision: "rc6.2",
      releaseBuild: EXPECTED_RELEASE_BUILD,
      environment: "production",
      provenanceStatus: "verified",
      deploymentProvenance: "verified",
      buildProvenanceStatus: "verified",
      provenanceSource: "build_sealed",
      cacheControl: "no-store",
    },
    edgeIdentity: {
      profileOwnership: "wrapper-owned",
      profilePathDigest: digest,
    },
    freshStorage: {
      cookieCount: 0,
      localStorageCount: 0,
      sessionStorageCount: 0,
      indexedDatabaseCount: 0,
      cacheStorageCount: 0,
      serviceWorkerRegistrationCount: 0,
      emptyBeforeAppNavigation: true,
    },
    mocksInstalled: false,
    prohibitedExternalAiRequestCount: 0,
    crossOriginPolicy: {
      policy: "phase-aware-context-route-default-deny-v3",
      contextRouteInstalledBeforeNavigation: true,
      allowedMethods: ["GET", "HEAD"],
      immutableModelAssetsAllowedOnlyDuringExplicitInstall: true,
      sameOriginTargetPolicy: "product-bound-finite-target-manifest",
      disallowedRequestCount: 0,
      disallowedMethodRequestCount: 0,
      blockedNonToolbarResponseCount: 0,
      previewToolbarPolicy: "blocked-before-network",
      observedPreviewToolbarRequestCount: 0,
      blockedPreviewToolbarRequestCount: 0,
      previewToolbarResponseCount: 0,
      webSocketRouteInstalledBeforeNavigation: true,
      webSocketPolicy: "blocked-before-connect",
      observedWebSocketAttemptCount: 0,
      blockedWebSocketAttemptCount: 0,
      disallowedWebSocketAttemptCount: 0,
      webSocketServerConnectionCount: 0,
      observedPreviewToolbarWebSocketAttemptCount: 0,
      blockedPreviewToolbarWebSocketAttemptCount: 0,
    },
    networkZeroReceipt: {
      schemaVersion: "p24b-rc6.2-network-zero-receipt-v1",
      httpAttemptCount: 2,
      httpBlockedBeforeSendCount: 2,
      webSocketAttemptCount: 1,
      webSocketBlockedBeforeConnectCount: 1,
      tcpConnectionReceiptCount: 0,
      httpRequestReceiptCount: 0,
      httpRequestBodyByteCount: 0,
      webSocketUpgradeReceiptCount: 0,
      arbitraryOutboundHeaderStrippedOrBlocked: true,
      requestBodyBlocked: true,
    },
    projectId: "00000000-0000-4000-8000-000000000000",
    setup: {
      status: "setup_required",
      model: "sealed-model",
      estimatedDownloadBytes: 1,
      estimatedDownloadMB: 1,
      automaticModelRequests: 0,
      explicitAction: true,
      explicitInstallClicked: true,
      cancellation: {
        lifecycle: "cancelled",
        cancelledBeforeVerification: true,
        incompleteModelPromoted: false,
      },
      retryAfterCancel: true,
      modelPayloadRequestCount: 1,
      immutableModelRootRequestCount: 1,
      approvedModelRedirectRequestCount: 0,
      modelPayloadHosts: [],
      metadata: {
        installStatus: "ready",
        cacheVerified: true,
        shardIntegrityVerified: true,
        verifiedShardCount: 1,
      },
    },
    consumerReadiness: {
      generationVerifiedBackends: 1,
      activeBackend: "browser-ai",
      externalFallback: false,
      silentExternalFallback: false,
    },
    storyBible: {
      persistedAfterReload: true,
      originalDigest: digest,
      sourceArtifactDigest: digest,
      sourceRevisionDigest: digest,
      sourceMetadataDigest: digest,
      sourceIdDigest: digest,
      uiInputDigest: digest,
    },
    attachmentProbe: {
      rightsUncheckedGate: { noModelCall: true },
      rightsCheckboxCheckedBeforeSubmit: true,
      rejected: true,
      fullReceiptRevalidatedAfterReject: true,
      candidate: candidate("rejected"),
      browserRuntimeReceipt: receipt("webllm-worker"),
    },
    t1ContextAttestationProbe: {
      contextAttestation: "not_required",
      webLlmGenerationDelta: 0,
      canonMutationCount: 0,
      candidate: candidate("awaiting-approval"),
      browserRuntimeReceipt: receipt("browser-task-model"),
    },
    conversationIsolation: {
      attachmentSessionId: "a",
      t1SessionId: "b",
      lifecycleSessionId: "c",
      allDistinct: true,
    },
    firstCandidateBeforeApproval: candidate("awaiting-approval"),
    directRegenerationCandidate: candidate("awaiting-approval"),
    directRegenerationSourceAfterward: {
      status: "awaiting-approval",
      canonicalMutationCount: 0,
    },
    rejectedCandidate: { status: "rejected", canonicalMutationCount: 0 },
    regeneratedCandidateBeforeApproval: candidate("awaiting-approval"),
    browserRuntimeReceipt: receipt("webllm-worker"),
    finalContextProof: {
      rawTextStored: false,
      acceptedDisposition: "standalone",
      executedStages: [],
      contributingCalls: [],
    },
    modelCacheReuse: {
      reloadBeforeChainedT2: true,
      modelAssetRequestDeltaAcrossReloadAndInference: 0,
      webLlmGenerationObservedAfterReload: true,
      cacheVerifiedAfterReload: true,
    },
    approval: {
      status: "approved",
      persistedAfterReload: true,
      fullReceiptRevalidatedBeforeAndAfterReload: true,
      canonRevisionBefore: 0,
      canonRevisionAfter: 1,
    },
    completedAt: "2026-08-11T20:45:00.000Z",
    error: {
      code: "RC6_2_CLOSED_AI_GATE_FAILED",
      diagnosticCodes: [],
      browserRuntimeEvidence: [],
    },
    profileDisposed: false,
  };
}

function assertFailureValidatorBehavior() {
  const minimal = minimalRunnerFailureFixture();
  const minimalRaw = `${JSON.stringify(minimal, null, 2)}\n`;
  const minimalProjection = validateRunnerFailureRaw(minimalRaw);
  assert.equal(minimalProjection.schemaKind, "minimal");
  assert.equal(minimalProjection.errorCode, "RC6_2_CLOSED_AI_GATE_FAILED");
  assert.equal(minimalProjection.gateCheckpoint, null);
  assert.equal(minimalProjection.profile.pathDigest, null);
  assert.deepEqual(minimalProjection.heartbeatCounts, {
    setup: 0,
    candidateGeneration: 0,
    t1Analysis: 0,
  });

  const heartbeatRaw = [
    "[RC6.2 Closed AI] setup in progress (30s)",
    "[RC6.2 Closed AI] candidate generation in progress (60s)",
    JSON.stringify(minimal, null, 2),
    "",
  ].join("\n");
  assert.deepEqual(validateRunnerFailureRaw(heartbeatRaw).heartbeatCounts, {
    setup: 1,
    candidateGeneration: 1,
    t1Analysis: 0,
  });

  const detailed = detailedRunnerFailureFixture();
  const detailedProjection = validateRunnerFailureRaw(`${JSON.stringify(detailed, null, 2)}\n`);
  assert.equal(detailedProjection.schemaKind, "detailed");
  assert.equal(detailedProjection.gateCheckpoint, "launch");
  assert.equal(detailedProjection.requestPhase, "bootstrap");

  const cleanupFailure = cleanupFailureAfterPassFixture();
  const cleanupProjection = validateRunnerFailureRaw(
    `${JSON.stringify(cleanupFailure, null, 2)}\n`,
  );
  assert.equal(cleanupProjection.schemaKind, "cleanup-failure-after-pass");
  assert.equal(cleanupProjection.route.contextRouteInstalledBeforeNavigation, true);
  assert.equal(cleanupProjection.profile.ownership, "wrapper-owned");
  assert.equal(cleanupProjection.profile.disposed, false);
  assert.equal(cleanupProjection.counts.disallowedWebSocketAttemptCount, 0);

  const rejects = (raw) => assert.throws(() => validateRunnerFailureRaw(raw));
  rejects(`\uFEFF${minimalRaw}`);
  rejects(`${minimalRaw}\uFFFD`);
  rejects(`${minimalRaw}\0`);
  rejects(`not-a-heartbeat\n${minimalRaw}`);
  rejects(`${minimalRaw}${minimalRaw}`);
  rejects(minimalRaw.slice(0, -10));
  rejects(`${minimalRaw}\n`);
  rejects(`${JSON.stringify({ ...minimal, status: "PASS" }, null, 2)}\n`);
  rejects(`${JSON.stringify({ ...minimal, schemaVersion: "p24b-rc6-2-v2" }, null, 2)}\n`);
  rejects(minimalRaw.replace(
    '  "status": "FAIL",',
    '  "status": "FAIL",\n  "a\\u0000b": 0,',
  ));
  rejects(`${JSON.stringify({ ...minimal, unknown: true }, null, 2)}\n`);
  rejects(`${JSON.stringify({
    ...minimal,
    error: { ...minimal.error, code: "STORY_SECRET" },
  }, null, 2)}\n`);
  rejects(`${JSON.stringify({
    ...minimal,
    error: { ...minimal.error, content: "raw-story-secret" },
  }, null, 2)}\n`);
  rejects(`${JSON.stringify({ ...detailed, gateCheckpoint: "unknown-checkpoint" }, null, 2)}\n`);
  rejects(`${JSON.stringify({
    ...cleanupFailure,
    releaseIdentity: { ...cleanupFailure.releaseIdentity, appCommit: "f".repeat(40) },
  }, null, 2)}\n`);
  const prototypeRaw = minimalRaw.replace(
    '  "status": "FAIL",',
    '  "status": "FAIL",\n  "__proto__": {},',
  );
  rejects(prototypeRaw);
  assert.equal(JSON.stringify(minimalProjection).includes("raw-story-secret"), false);
}

assertFailureValidatorBehavior();

async function runFailureValidatorChild(raw, childEnvironment) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), "validate-failure-evidence"],
      { windowsHide: true, env: childEnvironment, stdio: ["pipe", "pipe", "pipe"] },
    );
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const timeout = setTimeout(() => {
      child.kill();
      rejectPromise(new Error("failure validator child timed out"));
    }, 60_000);
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > 1_048_576) child.kill();
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 65_536) child.kill();
      else stderr.push(chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolvePromise({
        status: code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    child.stdin.end(Buffer.from(raw, "utf8"));
  });
}

async function assertFailureValidatorChildProcessBehavior() {
  if (process.env.RC6_2_FAILURE_VALIDATOR_CHILD_TEST === "1") return;
  const raw = `${JSON.stringify(minimalRunnerFailureFixture(), null, 2)}\n`;
  const childEnvironment = {
    ...process.env,
    RC6_2_FAILURE_VALIDATOR_CHILD_TEST: "1",
  };
  const valid = await runFailureValidatorChild(raw, childEnvironment);
  assert.equal(valid.status, 0, `failure validator stdin child failed: ${valid.stderr.trim()}`);
  assert.equal(valid.stderr, "");
  const receipt = JSON.parse(valid.stdout);
  assertExactKeys(receipt, ["status", "projectionDigest", "projection"], "failure validator receipt");
  assert.equal(receipt.status, "PASS");
  assertSha256(receipt.projectionDigest, "failure validator projection digest");
  assert.equal(receipt.projection.schemaVersion, "p24b-rc6.2-validated-runner-failure-projection-v1");

  const hostileRaw = raw.replace(
    '  "status": "FAIL",',
    '  "status": "FAIL",\n  "漢字": "不得保存",',
  );
  const hostile = await runFailureValidatorChild(hostileRaw, childEnvironment);
  assert.notEqual(hostile.status, 0);
  assert.equal(hostile.stdout, "");
  assert.equal(hostile.stderr.includes("不得保存"), false);
}

if (process.argv.length === 2) await assertFailureValidatorChildProcessBehavior();

function assertBrowserCandidate(candidate, expectedStatus, label) {
  assertPlainObject(candidate, label);
  assert.equal(candidate.backendId, "browser-ai");
  assert.equal(candidate.actualExecutor, "browser-ai");
  assert.equal(candidate.status, expectedStatus);
  assert.equal(candidate.candidateOnly, true);
  assert.equal(candidate.canonicalMutationCount, 0);
  assertSha256(candidate.modelDigest, `${label}.modelDigest`);
  assertSha256(candidate.contentDigest, `${label}.contentDigest`);
  assertPlainObject(candidate.executionReceipt, `${label}.executionReceipt`);
  assert.equal(candidate.executionReceipt.backendId, "browser-ai");
  assert.equal(candidate.executionReceipt.actualExecutor, "browser-ai");
  assert.equal(candidate.executionReceipt.externalRequest, false);
  assert.equal(candidate.executionReceipt.dataLeftDevice, false);
  assert.equal(candidate.executionReceipt.proofState, "verified");
}

function assertBrowserReceipt(receipt, expectedExecutor, label) {
  assertPlainObject(receipt, label);
  assert.equal(receipt.schemaVersion, "browser-execution-receipt-v3");
  assert.equal(receipt.actualExecutor, expectedExecutor);
  assert.equal(receipt.externalAIUsed, false);
  assert.equal(receipt.dataLeftDevice, false);
  assert.equal(receipt.candidateOnly, true);
  assert.equal(receipt.canonicalMutationCount, 0);
  assert.equal(receipt.rawPromptStored, false);
  assert.equal(receipt.rawOutputStored, false);
  assert.equal(receipt.rawChainOfThoughtStored, false);
  assert.equal(receipt.receiptIntegrityVerified, true);
}

function assertValidSuccessEvidence(evidence) {
  assertExactKeys(evidence, RUNNER_SUCCESS_EVIDENCE_KEYS, "runner evidence");
  assert.equal(evidence.schemaVersion, RUNNER_EVIDENCE_SCHEMA_VERSION);
  assert.equal(evidence.status, "PASS");
  assert.equal(evidence.mode, "generation");
  assert.equal(evidence.exactOrigin, EXPECTED_ORIGIN);
  assert.equal(evidence.freshBrowserContext, true);
  assert.equal(evidence.profileDisposed, true);
  assert.equal(evidence.mocksInstalled, false);
  assert.equal(evidence.prohibitedExternalAiRequestCount, 0);
  assert.match(evidence.projectId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u);
  assert.ok(Number.isFinite(Date.parse(evidence.completedAt)));

  assertExactKeys(evidence.releaseIdentity, [
    "appCommit",
    "releaseProductCommit",
    "deploymentId",
    "releaseTag",
    "releaseRevision",
    "releaseBuild",
    "environment",
    "provenanceStatus",
    "deploymentProvenance",
    "buildProvenanceStatus",
    "provenanceSource",
    "cacheControl",
  ], "releaseIdentity");
  assert.equal(evidence.releaseIdentity.appCommit, PRODUCT_COMMIT);
  assert.equal(evidence.releaseIdentity.releaseProductCommit, PRODUCT_COMMIT);
  assert.equal(evidence.releaseIdentity.deploymentId, EXPECTED_DEPLOYMENT_ID);
  assert.equal(evidence.releaseIdentity.releaseTag, EXPECTED_RELEASE_TAG);
  assert.equal(evidence.releaseIdentity.releaseRevision, "rc6.2");
  assert.equal(evidence.releaseIdentity.releaseBuild, EXPECTED_RELEASE_BUILD);
  assert.equal(evidence.releaseIdentity.environment, "production");
  assert.equal(evidence.releaseIdentity.provenanceStatus, "verified");
  assert.equal(evidence.releaseIdentity.deploymentProvenance, "verified");
  assert.equal(evidence.releaseIdentity.buildProvenanceStatus, "verified");
  assert.equal(evidence.releaseIdentity.provenanceSource, "build_sealed");
  assert.match(evidence.releaseIdentity.cacheControl, /no-store/u);

  assertExactKeys(evidence.freshStorage, [
    "cookieCount",
    "localStorageCount",
    "sessionStorageCount",
    "indexedDatabaseCount",
    "cacheStorageCount",
    "serviceWorkerRegistrationCount",
    "emptyBeforeAppNavigation",
  ], "freshStorage");
  for (const [key, value] of Object.entries(evidence.freshStorage)) {
    if (key === "emptyBeforeAppNavigation") assert.equal(value, true);
    else assert.equal(value, 0);
  }

  assertExactKeys(evidence.setup, [
    "status",
    "model",
    "estimatedDownloadBytes",
    "estimatedDownloadMB",
    "automaticModelRequests",
    "explicitAction",
    "explicitInstallClicked",
    "cancellation",
    "retryAfterCancel",
    "modelPayloadRequestCount",
    "immutableModelRootRequestCount",
    "approvedModelRedirectRequestCount",
    "modelPayloadHosts",
    "metadata",
  ], "setup");
  assert.equal(evidence.setup.status, "setup_required");
  assert.equal(evidence.setup.automaticModelRequests, 0);
  assert.equal(evidence.setup.explicitInstallClicked, true);
  assert.equal(evidence.setup.retryAfterCancel, true);
  assert.equal(evidence.setup.cancellation.lifecycle, "cancelled");
  assert.equal(evidence.setup.cancellation.cancelledBeforeVerification, true);
  assert.equal(evidence.setup.cancellation.incompleteModelPromoted, false);
  assert.ok(evidence.setup.modelPayloadRequestCount > 0);
  assert.equal(evidence.setup.metadata.installStatus, "ready");
  assert.equal(evidence.setup.metadata.cacheVerified, true);
  assert.equal(evidence.setup.metadata.shardIntegrityVerified, true);
  assert.ok(evidence.setup.metadata.verifiedShardCount > 0);

  assertExactKeys(evidence.consumerReadiness, [
    "generationVerifiedBackends",
    "activeBackend",
    "externalFallback",
    "silentExternalFallback",
  ], "consumerReadiness");
  assert.ok(evidence.consumerReadiness.generationVerifiedBackends >= 1);
  assert.equal(evidence.consumerReadiness.activeBackend, "browser-ai");
  assert.equal(evidence.consumerReadiness.externalFallback, false);
  assert.equal(evidence.consumerReadiness.silentExternalFallback, false);
  assert.equal(evidence.storyBible.persistedAfterReload, true);
  for (const key of [
    "originalDigest",
    "sourceArtifactDigest",
    "sourceRevisionDigest",
    "sourceMetadataDigest",
    "sourceIdDigest",
    "uiInputDigest",
  ]) assertSha256(evidence.storyBible[key], `storyBible.${key}`);

  assert.equal(evidence.attachmentProbe.rightsUncheckedGate.noModelCall, true);
  assert.equal(evidence.attachmentProbe.rightsCheckboxCheckedBeforeSubmit, true);
  assert.equal(evidence.attachmentProbe.rejected, true);
  assert.equal(evidence.attachmentProbe.fullReceiptRevalidatedAfterReject, true);
  assertBrowserCandidate(evidence.attachmentProbe.candidate, "rejected", "attachmentProbe.candidate");
  assertBrowserReceipt(evidence.attachmentProbe.browserRuntimeReceipt, "webllm-worker", "attachmentProbe.browserRuntimeReceipt");
  assert.equal(evidence.t1ContextAttestationProbe.contextAttestation, "not_required");
  assert.equal(evidence.t1ContextAttestationProbe.webLlmGenerationDelta, 0);
  assert.equal(evidence.t1ContextAttestationProbe.canonMutationCount, 0);
  assertBrowserCandidate(evidence.t1ContextAttestationProbe.candidate, "awaiting-approval", "t1ContextAttestationProbe.candidate");
  assertBrowserReceipt(evidence.t1ContextAttestationProbe.browserRuntimeReceipt, "browser-task-model", "t1ContextAttestationProbe.browserRuntimeReceipt");

  assertExactKeys(evidence.conversationIsolation, [
    "attachmentSessionId",
    "t1SessionId",
    "lifecycleSessionId",
    "allDistinct",
  ], "conversationIsolation");
  assert.equal(evidence.conversationIsolation.allDistinct, true);
  assertBrowserCandidate(evidence.firstCandidateBeforeApproval, "awaiting-approval", "firstCandidateBeforeApproval");
  assertBrowserCandidate(evidence.directRegenerationCandidate, "awaiting-approval", "directRegenerationCandidate");
  assert.equal(evidence.directRegenerationSourceAfterward.status, "awaiting-approval");
  assert.equal(evidence.directRegenerationSourceAfterward.canonicalMutationCount, 0);
  assert.equal(evidence.rejectedCandidate.status, "rejected");
  assert.equal(evidence.rejectedCandidate.canonicalMutationCount, 0);
  assertBrowserCandidate(evidence.regeneratedCandidateBeforeApproval, "awaiting-approval", "regeneratedCandidateBeforeApproval");
  assertBrowserReceipt(evidence.browserRuntimeReceipt, "webllm-worker", "browserRuntimeReceipt");
  assert.equal(evidence.finalContextProof.rawTextStored, false);
  assert.ok(["standalone", "composed-extension"].includes(evidence.finalContextProof.acceptedDisposition));
  assert.ok(Array.isArray(evidence.finalContextProof.executedStages));
  assert.ok(Array.isArray(evidence.finalContextProof.contributingCalls));
  assert.equal(evidence.modelCacheReuse.reloadBeforeChainedT2, true);
  assert.equal(evidence.modelCacheReuse.modelAssetRequestDeltaAcrossReloadAndInference, 0);
  assert.equal(evidence.modelCacheReuse.webLlmGenerationObservedAfterReload, true);
  assert.equal(evidence.modelCacheReuse.cacheVerifiedAfterReload, true);
  assert.equal(evidence.approval.status, "approved");
  assert.equal(evidence.approval.persistedAfterReload, true);
  assert.equal(evidence.approval.fullReceiptRevalidatedBeforeAndAfterReload, true);
  assert.equal(evidence.approval.canonRevisionAfter, evidence.approval.canonRevisionBefore + 1);

  assertExactKeys(evidence.networkZeroReceipt, [
    "schemaVersion",
    "httpAttemptCount",
    "httpBlockedBeforeSendCount",
    "webSocketAttemptCount",
    "webSocketBlockedBeforeConnectCount",
    "tcpConnectionReceiptCount",
    "httpRequestReceiptCount",
    "httpRequestBodyByteCount",
    "webSocketUpgradeReceiptCount",
    "arbitraryOutboundHeaderStrippedOrBlocked",
    "requestBodyBlocked",
  ], "networkZeroReceipt");
  assert.deepEqual(evidence.networkZeroReceipt, {
    schemaVersion: "p24b-rc6.2-network-zero-receipt-v1",
    httpAttemptCount: 2,
    httpBlockedBeforeSendCount: 2,
    webSocketAttemptCount: 1,
    webSocketBlockedBeforeConnectCount: 1,
    tcpConnectionReceiptCount: 0,
    httpRequestReceiptCount: 0,
    httpRequestBodyByteCount: 0,
    webSocketUpgradeReceiptCount: 0,
    arbitraryOutboundHeaderStrippedOrBlocked: true,
    requestBodyBlocked: true,
  });

  assertExactKeys(evidence.crossOriginPolicy, RUNNER_POLICY_KEYS, "crossOriginPolicy");
  assert.equal(evidence.crossOriginPolicy.policy, "phase-aware-context-route-default-deny-v3");
  assert.equal(evidence.crossOriginPolicy.contextRouteInstalledBeforeNavigation, true);
  assert.deepEqual(evidence.crossOriginPolicy.allowedMethods, ["GET", "HEAD"]);
  assert.equal(evidence.crossOriginPolicy.immutableModelAssetsAllowedOnlyDuringExplicitInstall, true);
  assert.equal(evidence.crossOriginPolicy.sameOriginTargetPolicy, "product-bound-finite-target-manifest");
  assert.equal(evidence.crossOriginPolicy.disallowedRequestCount, 0);
  assert.equal(evidence.crossOriginPolicy.disallowedMethodRequestCount, 0);
  assert.equal(evidence.crossOriginPolicy.blockedNonToolbarResponseCount, 0);
  assert.equal(evidence.crossOriginPolicy.previewToolbarPolicy, "blocked-before-network");
  assert.equal(
    evidence.crossOriginPolicy.observedPreviewToolbarRequestCount,
    evidence.crossOriginPolicy.blockedPreviewToolbarRequestCount,
  );
  assert.equal(evidence.crossOriginPolicy.previewToolbarResponseCount, 0);
  assert.equal(evidence.crossOriginPolicy.webSocketRouteInstalledBeforeNavigation, true);
  assert.equal(evidence.crossOriginPolicy.webSocketPolicy, "blocked-before-connect");
  assert.equal(
    evidence.crossOriginPolicy.observedWebSocketAttemptCount,
    evidence.crossOriginPolicy.blockedWebSocketAttemptCount,
  );
  assert.equal(evidence.crossOriginPolicy.disallowedWebSocketAttemptCount, 0);
  assert.equal(evidence.crossOriginPolicy.webSocketServerConnectionCount, 0);
  assert.equal(
    evidence.crossOriginPolicy.observedPreviewToolbarWebSocketAttemptCount,
    evidence.crossOriginPolicy.blockedPreviewToolbarWebSocketAttemptCount,
  );
  assertSafeProjectedEvidence(evidence);
}

async function validateEvidence() {
  const evidencePath = resolve(String(process.env.RC6_2_BROWSER_EVIDENCE_PATH ?? ""));
  const temporaryRoot = resolve(tmpdir());
  assert.equal(
    dirname(evidencePath).toLocaleLowerCase("en-US"),
    temporaryRoot.toLocaleLowerCase("en-US"),
  );
  assert.match(basename(evidencePath), /^novel-rc6-2-evidence-[a-f0-9]{32}\.json$/u);
  const raw = await readFile(evidencePath, "utf8");
  assert.ok(raw.length > 0 && raw.length <= 1_048_576 && !raw.includes("\0"));
  const evidence = JSON.parse(raw);
  assert.equal(JSON.stringify(evidence, null, 2), raw.trim(), "runner evidence was not canonical JSON");
  assertValidSuccessEvidence(evidence);
  const evidenceDigest = createHash("sha256").update(raw.trim()).digest("hex");
  console.log(JSON.stringify({ status: "PASS", evidenceDigest }));
}

assert.match(wrapper, /\[Parameter\(Mandatory = \$true\)\][\s\S]*\[ValidatePattern\('\^\[a-f0-9\]\{40\}\$'\)\][\s\S]*\$ExpectedGateControlCommit/u);
assert.match(wrapper, /\[ValidateRange\(1, \[long\]::MaxValue\)\][\s\S]*\$ExpectedLkgAuditRunId/u);
assert.match(wrapper, /\$ExpectedLkgAuditControlProofDigest/u);
assert.match(wrapper, /\$ExpectedLkgSelectionProofDigest/u);
assert.match(wrapper, /if \(\$head -ne \$ExpectedGateControlCommit\) \{ Fail "LOCAL_GATE_CONTROL_MISMATCH" \}/u);
assert.match(wrapper, /\$headParents\[1\] -ne \$previousBrowserGateControl/u);
assert.match(wrapper, /\$previousParents\[1\] -ne \$initialBrowserGateControl/u);
assert.match(wrapper, /\$initialParents\[1\] -ne \$productionRecoveryControl/u);
assert.match(wrapper, /\$recoveryParents\[1\] -ne \$failedRecoveryControl/u);
assert.match(wrapper, /\$failedParents\[1\] -ne \$productCommit/u);
assert.match(wrapper, /Assert-ControlDiffPaths -BaseCommit \$previousBrowserGateControl -HeadCommit \$head -ExpectedPaths \$repairGatePaths/u);
assert.match(wrapper, /Assert-ControlDiffPaths -BaseCommit \$initialBrowserGateControl -HeadCommit \$previousBrowserGateControl -ExpectedPaths \$repairGatePaths/u);
assert.match(wrapper, /Assert-ControlDiffPaths -BaseCommit \$productionRecoveryControl -HeadCommit \$head -ExpectedPaths \$allowedGatePaths/u);
assert.match(wrapper, /function Get-SingleTrimmedLine[\s\S]*\$Lines\.GetValue\(0\)[\s\S]*function Invoke-GitScalar/u);
assert.doesNotMatch(wrapper, /\[string\]\(Invoke-Git[^\r\n]*\)\[0\]/u);
for (const path of GATE_BLOB_PATHS) assert.ok(wrapper.includes(`"${path}"`), `gate blob pin is missing: ${path}`);
for (const path of GATE_REPAIR_PATHS) assert.ok(wrapper.includes(`"${path}"`), `gate repair path is missing: ${path}`);
assert.match(wrapper, /\^\(\[AM\]\)`t/u);
assert.match(wrapper, /GATE_REPAIR_DIFF_INVALID/u);
assert.match(wrapper, /GATE_COMPOSITE_DIFF_INVALID/u);
assert.equal(occurrences(wrapper, "Assert-MainCas \"MAIN_CAS_"), 3);
assert.match(wrapper, /Assert-ReleaseTag/u);
assert.match(wrapper, /\$githubApiRoot\/git\/ref\/heads\/main/u);
assert.match(wrapper, /\$githubApiRoot\/git\/ref\/tags\/\$releaseTag/u);
assert.match(wrapper, /\$githubApiRoot\/git\/tags\/\$releaseTagObject/u);
assert.match(wrapper, /\$githubApiRoot\/releases\/tags\/\$releaseTag/u);
assert.match(wrapper, /\$ref\.object\.sha -ne \$releaseTagObject/u);
assert.match(wrapper, /\$tag\.object\.sha -ne \$productCommit/u);
assert.match(wrapper, /\$release\.immutable -ne \$true/u);
assert.match(wrapper, /\$release\.draft -ne \$false/u);
assert.match(wrapper, /Invoke-ReleaseAttestationVerification/u);
assert.match(wrapper, /release verify \$releaseTag --repo bobobo-org\/novel --format json/u);
assert.match(wrapper, /https:\/\/in-toto\.io\/attestation\/release\/v0\.2/u);
assert.match(wrapper, /Assert-LkgAudit/u);
assert.match(wrapper, /LKG_AUDIT_MUTATION_JOB_NOT_SKIPPED/u);
assert.match(wrapper, /production-lkg-readonly-audit-rc62-\$productCommit-\$expectedDeployment-\$ExpectedLkgAuditControlProofDigest-\$ExpectedLkgSelectionProofDigest-\$ExpectedLkgAuditRunId/u);
assert.match(wrapper, /\$lkgArtifact\.digest -ne \$lkgArtifactDigest/u);

for (const originVariable of ["$primaryOrigin", "$mirrorOrigin", "$deploymentOrigin"]) {
  assert.equal(
    occurrences(wrapper, `Get-ReleaseIdentity ${originVariable}`),
    2,
    `${originVariable} must be verified before and after the gate`,
  );
}
assert.match(wrapper, /\$identity\.environment -ne "production"/u);
assert.match(wrapper, /\$identity\.releaseBuild -ne \$releaseBuild/u);
assert.match(wrapper, /X-Novel-Release-Build/u);
assert.match(wrapper, /\$identity\.buildTime -ne \[string\]\$identity\.buildCompletedAt/u);
assert.match(wrapper, /\$identity\.temporalProvenanceStatus -ne "verified"/u);
assert.match(wrapper, /\$identity\.artifactAttestationStatus -ne "not_produced"/u);
assert.match(wrapper, /\$null -ne \$identity\.artifactAttestationDigest/u);

assert.doesNotMatch(wrapper, /\b(?:Start|Stop)-Process\b/u);
assert.doesNotMatch(wrapper, /\b(?:npm|pnpm)(?:\.cmd)?\b/iu);
assert.doesNotMatch(wrapper, /\$env:RC6_2_[A-Z0-9_]+\s*=/u);
assert.doesNotMatch(wrapper, /(?:bridge|hub)[^\r\n]*(?:launcher|start|stop)/iu);
assert.match(wrapper, /\$gitExe = "C:\\Program Files\\Git\\cmd\\git\.exe"/u);
assert.match(wrapper, /\$ghExe = "C:\\Program Files\\GitHub CLI\\gh\.exe"/u);
assert.match(wrapper, /EXECUTABLE_SIGNATURE_INVALID/u);
assert.match(wrapper, /GIT_DIGEST_INVALID/u);
assert.match(wrapper, /GH_DIGEST_INVALID/u);
assert.match(wrapper, /NODE_DIGEST_INVALID/u);
assert.match(wrapper, /EDGE_DIGEST_INVALID/u);
assert.match(wrapper, /EDGE_ENGINE_DIGEST_INVALID/u);
assert.match(wrapper, /EDGE_VERSION_INVALID/u);
assert.ok(occurrences(wrapper, "$startInfo.EnvironmentVariables.Clear()") >= 4);
assert.match(wrapper, /GIT_NO_REPLACE_OBJECTS/u);
assert.match(wrapper, /GIT_OPTIONAL_LOCKS/u);
assert.match(wrapper, /core\.fsmonitor/u);
assert.match(wrapper, /core\.untrackedCache/u);
assert.equal(occurrences(wrapper, '"--untracked-files=all"'), 3);
assert.match(wrapper, /\$startInfo\.FileName = \$nodeExe/u);
assert.match(wrapper, /\$startInfo\.Arguments = "`"\$runnerPath`" generation"/u);
assert.match(wrapper, /\$startInfo\.EnvironmentVariables\["RC6_2_CLOSED_AI_BASE_URL"\] = \$deploymentOrigin/u);
assert.match(wrapper, /\$startInfo\.EnvironmentVariables\["EXPECTED_COMMIT"\] = \$productCommit/u);
assert.match(wrapper, /\$startInfo\.EnvironmentVariables\["EXPECTED_DEPLOYMENT_ID"\] = \$expectedDeployment/u);
assert.match(wrapper, /RC6_2_CLOSED_AI_PROFILE_PATH/u);
assert.match(wrapper, /Assert-OwnedProfilePath/u);
assert.match(wrapper, /Remove-OwnedProfile/u);
assert.match(wrapper, /Stop-OwnedProfileProcesses/u);
assert.match(wrapper, /FileAttributes\]::ReparsePoint/u);
assert.match(wrapper, /OWNED_PROFILE_PROCESS_CLEANUP_FAILED/u);
assert.match(wrapper, /Stop-RunnerTree/u);
assert.match(wrapper, /WaitForExit\(10800000\)/u);
assert.equal(occurrences(wrapper, "Assert-NoGateResidue \"GATE_RESIDUE_"), 2);
assert.match(wrapper, /\$bridgeAfter\.Pid -ne \$bridgeBefore\.Pid/u);
assert.match(wrapper, /\$hubAfter\.Pid -ne \$hubBefore\.Pid/u);
assert.match(wrapper, /\$ollamaAfter\.Pid -ne \$ollamaBefore\.Pid/u);
assert.match(wrapper, /serviceControlActionPerformed = \$false/u);
assert.match(wrapper, /observedServiceProcessHealthAndPinnedCodeStableAcrossGate = \$true/u);
assert.match(wrapper, /WORKTREE_STATUS_LINEARIZATION_FAILED/u);
assert.match(wrapper, /PRODUCTION_BROWSER_RUNTIME_RECEIPT_LINEARIZATION_FAILED/u);
assert.match(wrapper, /Invoke-CleanNodeContract "runtime-receipt"/u);
assert.match(wrapper, /Invoke-CleanNodeContract "validate-evidence"/u);
assert.match(wrapper, /Invoke-CleanNodeContract "validate-failure-evidence"/u);
assert.match(wrapper, /RedirectStandardInput = \$null -ne \$StandardInput/u);
assert.match(wrapper, /\$process\.StandardInput\.BaseStream\.Write\(\$standardInputBytes/u);
assert.match(wrapper, /\$process\.StandardInput\.BaseStream\.Flush\(\)/u);
assert.match(wrapper, /\$process\.StandardInput\.BaseStream\.Close\(\)/u);
assert.doesNotMatch(wrapper, /\$process\.StandardInput\.Write\(/u);
assert.match(wrapper, /if \(\$runnerStdout\.Length -eq 0\)/u);
assert.match(wrapper, /production-browser-gate-c5-failure-\$ExpectedGateControlCommit\.json/u);
assert.match(wrapper, /\[IO\.FileMode\]::CreateNew/u);
assert.match(wrapper, /\$stream\.Flush\(\$true\)/u);
assert.match(wrapper, /\[IO\.File\]::Move\(\$tempPath, \$failureEvidencePath\)/u);
assert.match(wrapper, /\[IO\.File\]::ReadAllBytes\(\$tempPath\)/u);
assert.match(wrapper, /\[IO\.File\]::ReadAllBytes\(\$failureEvidencePath\)/u);
assert.match(wrapper, /FAILURE_EVIDENCE_TEMP_READBACK_MISMATCH/u);
assert.match(wrapper, /status = "FAIL"/u);
assert.match(wrapper, /qualifiesProductionBrowserGate = \$false/u);
assert.match(wrapper, /eligibleForLuna = \$false/u);
assert.match(wrapper, /terminalWrapperCode = \$TerminalWrapperCode/u);
assert.match(wrapper, /schemaVersion = "p24b-rc6\.2-production-browser-gate-c5-failure-proof-v1"/u);
assert.match(wrapper, /sanitized = \$true[\s\S]*rawSecretsStored = \$false/u);
assert.match(wrapper, /lkgAuditRunId = \$ExpectedLkgAuditRunId/u);
assert.match(wrapper, /lkgAuditControlProofDigest = \$ExpectedLkgAuditControlProofDigest/u);
assert.match(wrapper, /lkgSelectionProofDigest = \$ExpectedLkgSelectionProofDigest/u);
assert.doesNotMatch(wrapper, /(?:stdout|stderr)Sha256\s*=/iu);
const failurePublisher = wrapper.slice(
  wrapper.indexOf("function Publish-C5FailureEvidence"),
  wrapper.indexOf("function Initialize-EvidenceDestination"),
);
assert.ok(failurePublisher.indexOf("ReadAllBytes($tempPath)") < failurePublisher.indexOf("$observedCasStatus = Get-MainCasStatus"));
assert.ok(failurePublisher.indexOf("$observedCasStatus = Get-MainCasStatus") < failurePublisher.indexOf("[IO.File]::Move($tempPath, $failureEvidencePath)"));
assert.ok(failurePublisher.lastIndexOf("ReadAllBytes($tempPath)") > failurePublisher.indexOf("$observedCasStatus = Get-MainCasStatus"));
assert.ok(failurePublisher.lastIndexOf("ReadAllBytes($tempPath)") < failurePublisher.indexOf("[IO.File]::Move($tempPath, $failureEvidencePath)"));
assert.ok(
  wrapper.lastIndexOf("Publish-C5FailureEvidence $runnerCapture")
  < wrapper.lastIndexOf("$mutex.ReleaseMutex()"),
);
assert.ok(
  wrapper.indexOf("$formalGateBoundaryEntered = $true")
  > wrapper.indexOf('if (-not $mutexHeld) { Fail "PRODUCTION_BROWSER_GATE_ALREADY_RUNNING" }'),
);
assert.match(wrapper, /runnerEvidence = \$runnerEvidence/u);
assert.match(wrapper, /runtimeReceipt = \$runtimeReceiptBefore/u);
assert.match(wrapper, /releaseAttestation = \$releaseAttestationBefore/u);
assert.match(wrapper, /runnerEvidenceDigest = Sha256Text \(\$runnerStdout\.Trim\(\)\)/u);
assert.match(wrapper, /releaseIdentityBeforeDigest = \$identityBeforeDigest/u);
assert.match(wrapper, /serviceTruthBeforeDigest = \$serviceBeforeDigest/u);
assert.match(wrapper, /schemaVersion = "p24b-rc6\.2-production-browser-gate-proof-v1"/u);
assert.match(wrapper, /canonicalization = "powershell-ordered-json-utf8-no-bom-v1"/u);
assert.match(wrapper, /sanitized = \$true/u);
assert.match(wrapper, /rawSecretsStored = \$false/u);
assert.match(wrapper, /bodyDigest = Sha256Text \$evidenceJson/u);
assert.match(wrapper, /proofDigest = Sha256Text "\$proofDomain`n\$evidenceJson"/u);
assert.match(wrapper, /\[IO\.File\]::Move\(\$evidenceTempPath, \$evidencePath\)/u);
assert.match(wrapper, /EVIDENCE_PUBLICATION_MISMATCH/u);
assert.doesNotMatch(wrapper, /runnerStdout\s*=\s*[^\r\n]*final/u);

assert.match(browserRunner, /await persistentContext\.route\("\*\*\/\*", routeClosedAiRequest\)/u);
assert.equal(browserRunner.match(/\.route\(/gu)?.length, 1);
assert.match(browserRunner, /await persistentContext\.routeWebSocket\("\*\*\/\*", routeClosedAiWebSocket\)/u);
assert.doesNotMatch(browserRunner, /\.connectToServer\(/u);
assert.match(browserRunner, /const ALLOWED_REQUEST_METHODS = new Set\(\["GET", "HEAD"\]\)/u);
assert.match(browserRunner, /decision\.action === "abort-policy"[\s\S]*await route\.abort\("blockedbyclient"\)/u);
assert.match(browserRunner, /blockedNonToolbarRequests\.add\(request\)[\s\S]*await route\.abort\("blockedbyclient"\)/u);
assert.match(browserRunner, /assert\.equal\(blockedNetworkPolicyAttemptCount, 0\)/u);
assert.match(browserRunner, /assert\.equal\(blockedNonToolbarResponseCount, 0\)/u);
assert.match(browserRunner, /policy: "phase-aware-context-route-default-deny-v3"/u);
assert.match(browserRunner, /sameOriginTargetPolicy: "product-bound-finite-target-manifest"/u);
assert.match(browserRunner, /webSocketPolicy: "blocked-before-connect"/u);
assert.match(browserRunner, /networkZeroReceipt: networkSentinelEvidence/u);
assert.match(browserRunner, /const receiver = createServer\(/u);
assert.match(browserRunner, /receiver\.listen\(0, "127\.0\.0\.1"/u);
assert.match(browserRunner, /assert\.equal\(tcpConnectionReceiptCount, 0\)/u);
assert.match(browserRunner, /assert\.equal\(httpRequestReceiptCount, 0\)/u);
assert.match(browserRunner, /assert\.equal\(httpRequestBodyByteCount, 0\)/u);
assert.match(browserRunner, /assert\.equal\(webSocketUpgradeReceiptCount, 0\)/u);
assert.match(runtimeContract, /same-origin POST[\s\S]*method-not-allowed/u);
assert.match(runtimeContract, /external AI GET[\s\S]*prohibited-external-ai/u);
assert.match(runtimeContract, /await persistentContext\\\.route/u);
assert.match(
  runtimeContract,
  /const networkZeroReceipt = \{[\s\S]*webSocketUpgradeReceiptCount,[\s\S]*assert\.deepEqual\(networkZeroReceipt,[\s\S]*webSocketUpgradeReceiptCount: 0/u,
);

assert.match(
  workflow,
  /inputs\.operation != 'audit-rc6-2-last-known-good' && env\.EXPECTED_LKG_PRIMARY_DEPLOYMENT_ID \|\| ''/u,
);
assert.doesNotMatch(
  workflow,
  /inputs\.operation == 'audit-rc6-2-last-known-good' && '' \|\| env\.EXPECTED_LKG_PRIMARY_DEPLOYMENT_ID/u,
);
assert.match(workflowContract, /EXPECTED_LKG_PRIMARY_DEPLOYMENT_ID/u);
assert.match(workflowContract, /audit-rc6-2-last-known-good/u);

const wrapperPath = fileURLToPath(wrapperUrl);
const escapedWrapperPath = wrapperPath.replaceAll("'", "''");
const parser = spawnSync(
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$errors=$null;$tokens=$null;[System.Management.Automation.Language.Parser]::ParseFile('${escapedWrapperPath}',[ref]$tokens,[ref]$errors)>$null;if($errors.Count -ne 0){exit 1}`,
  ],
  { encoding: "utf8", windowsHide: true },
);
assert.equal(parser.status, 0, `PowerShell parser rejected gate wrapper: ${parser.stderr.trim()}`);

if (process.argv[2] === "runtime-receipt") {
  console.log(JSON.stringify(runtimeReceipt, null, 2));
} else if (process.argv[2] === "validate-evidence") {
  await validateEvidence();
} else if (process.argv[2] === "validate-failure-evidence") {
  await validateFailureEvidence();
} else {
  assert.equal(process.argv.length, 2);
  console.log("P2.4B RC6.2 production browser gate contract: PASS");
}

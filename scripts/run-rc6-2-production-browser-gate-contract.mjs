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
import { spawnSync } from "node:child_process";
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
const PREVIOUS_BROWSER_GATE_CONTROL = "aab0e7bd52c57bc57ecfe8be8b08c1cf63db9824";
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
    [PREVIOUS_BROWSER_GATE_CONTROL, PRODUCTION_RECOVERY_CONTROL],
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
    schemaVersion: "p24b-rc6.2-browser-gate-control-proof-v1",
    operation: process.env.EXPECTED_OPERATION,
    productCommit: PRODUCT_COMMIT,
    productionRecoveryControl: PRODUCTION_RECOVERY_CONTROL,
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
    changedPaths,
    compositeChangedPaths,
  };
  const proof = {
    ...body,
    proofDigest: createHash("sha256").update(stableStringify({
      domain: "p24b-rc6.2-browser-gate-control-proof-v1",
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
  assertExactKeys(evidence, [
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
  ], "runner evidence");
  assert.equal(evidence.schemaVersion, "p24b-rc6-2-closed-ai-browser-evidence-v3");
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

  const policyKeys = [
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
  assertExactKeys(evidence.crossOriginPolicy, policyKeys, "crossOriginPolicy");
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
  const evidenceDigest = createHash("sha256").update(raw.trim()).digest("hex");
  console.log(JSON.stringify({ status: "PASS", evidenceDigest }));
}

assert.match(wrapper, /\[Parameter\(Mandatory = \$true\)\][\s\S]*\[ValidatePattern\('\^\[a-f0-9\]\{40\}\$'\)\][\s\S]*\$ExpectedGateControlCommit/u);
assert.match(wrapper, /\[ValidateRange\(1, \[long\]::MaxValue\)\][\s\S]*\$ExpectedLkgAuditRunId/u);
assert.match(wrapper, /\$ExpectedLkgAuditControlProofDigest/u);
assert.match(wrapper, /\$ExpectedLkgSelectionProofDigest/u);
assert.match(wrapper, /if \(\$head -ne \$ExpectedGateControlCommit\) \{ Fail "LOCAL_GATE_CONTROL_MISMATCH" \}/u);
assert.match(wrapper, /\$headParents\[1\] -ne \$previousBrowserGateControl/u);
assert.match(wrapper, /\$previousParents\[1\] -ne \$productionRecoveryControl/u);
assert.match(wrapper, /\$recoveryParents\[1\] -ne \$failedRecoveryControl/u);
assert.match(wrapper, /\$failedParents\[1\] -ne \$productCommit/u);
assert.match(wrapper, /Assert-ControlDiffPaths -BaseCommit \$previousBrowserGateControl -HeadCommit \$head -ExpectedPaths \$repairGatePaths/u);
assert.match(wrapper, /Assert-ControlDiffPaths -BaseCommit \$productionRecoveryControl -HeadCommit \$head -ExpectedPaths \$allowedGatePaths/u);
assert.match(wrapper, /function Get-SingleTrimmedLine[\s\S]*\$Lines\.GetValue\(0\)[\s\S]*function Invoke-GitScalar/u);
assert.doesNotMatch(wrapper, /\[string\]\(Invoke-Git[^\r\n]*\)\[0\]/u);
for (const path of GATE_BLOB_PATHS) assert.ok(wrapper.includes(`"${path}"`), `gate blob pin is missing: ${path}`);
for (const path of GATE_REPAIR_PATHS) assert.ok(wrapper.includes(`"${path}"`), `gate repair path is missing: ${path}`);
assert.match(wrapper, /\^\(\[AM\]\)`t/u);
assert.match(wrapper, /GATE_REPAIR_DIFF_INVALID/u);
assert.match(wrapper, /GATE_COMPOSITE_DIFF_INVALID/u);
assert.equal(occurrences(wrapper, "Assert-MainCas \"MAIN_CAS_"), 2);
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
assert.match(wrapper, /serviceStateStableAcrossGate = \$true/u);
assert.match(wrapper, /WORKTREE_STATUS_LINEARIZATION_FAILED/u);
assert.match(wrapper, /PRODUCTION_BROWSER_RUNTIME_RECEIPT_LINEARIZATION_FAILED/u);
assert.match(wrapper, /Invoke-CleanNodeContract "runtime-receipt"/u);
assert.match(wrapper, /Invoke-CleanNodeContract "validate-evidence"/u);
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
} else {
  assert.equal(process.argv.length, 2);
  console.log("P2.4B RC6.2 production browser gate contract: PASS");
}

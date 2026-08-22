import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFile,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PRODUCT_COMMIT = "29fc6e742672bb07187765d34ea818afdadf56ae";
const PRODUCTION_RECOVERY_CONTROL = "9cd074f239b73dd9b61f6d758fcf97fbd809face";
const FAILED_RECOVERY_CONTROL = "3b716fc0d974a9d59b49ffca5953776af66c7a07";
const INITIAL_BROWSER_GATE_CONTROL = "aab0e7bd52c57bc57ecfe8be8b08c1cf63db9824";
const C4_BROWSER_GATE_CONTROL = "100eea11003c5132ab2b519707c5dee658bc9cbe";
const C5_BROWSER_GATE_CONTROL = "99695b247c2b1626c38efc8ae4589dd9bd8d30da";
const C6_BROWSER_GATE_CONTROL = "b326c2fc9925798ffbc750ae37db847f0c8b5625";
const C7_BROWSER_GATE_CONTROL = "7dea0b8dd488a0f2a24132266944cb95b2f15ca9";
const C8_BROWSER_GATE_CONTROL = "04e78268cfcfeaeffdc72b603d0700944c7142e7";
const C9_BROWSER_GATE_CONTROL = "92fe2ff7550ef3aeff9447252714d10d6c771d6b";
const EXPECTED_DEPLOYMENT_ID = "dpl_8pqTpwAgQQAqmLKNzZNCzSfPuqNn";
const EXPECTED_ORIGIN = "https://novel-eexnlr77y-lqtechs-projects.vercel.app";
const EXPECTED_RELEASE_TAG = "novel-ai-p24b-conversation-first-studio-rc6.2";
const EXPECTED_RELEASE_BUILD = `rc6.2+${PRODUCT_COMMIT}`;
const EXPECTED_EDGE_VERSION = "151.0.4129.78";
const EXPECTED_EDGE_EXE_DIGEST = "af02a342b7e6fa7d1154d9152b5997ff2be300b3a7a678feaae863c9fbea32cb";
const EXPECTED_EDGE_DLL_DIGEST = "29b191751916dbfe5ed4206022a0d7ab45bd79966d9074ed872112d1865dcec6";
const EXPECTED_EDGE_VERSION_DIRECTORY_DIGEST = "9d79d47dd5fde1d3fcf2fb7e740b85b1f25441d84d5e4240d3a51182f3570f13";
const EXPECTED_EDGE_APPLICATION_DIGEST = "bf2e1fe3a62d67d1c9915191b161c64b99203bbbe03e88c07ab7aa7ab295d273";
const EXPECTED_EDGE_APPLICATION_BYTE_COUNT = 915_721_905;
const EXPECTED_EDGE_MANIFEST_DIGEST = "cc7564ed83797ee8ab21a8101ab473592c0b05fc9fd14915e8c5db75ef806f06";
const EXPECTED_EDGE_MANIFEST_FILE_DIGEST = "2e9a981c925362aedc3b7202a2aac0ef165b3b9e774bb44344a255cc3f36c4cd";
const EXPECTED_EDGE_MANIFEST_BYTES = 1_117;
const EXPECTED_EDGE_SOURCE_MSI_URL = "https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/f5e477ef-f201-49dd-866a-8e25850421dd/MicrosoftEdgeEnterpriseX64.msi";
const EXPECTED_EDGE_SOURCE_MSI_DIGEST = "716b2549eedf4305b92d149186f878394c8d8b7b743db0eaaec773349ed3c273";
const EXPECTED_EDGE_VISUAL_MANIFEST_DIGEST = "582a35a65c0362bda88598852ff9e153e1e044bc76d21fb90492b60ee31b6aa7";
const EXPECTED_EDGE_PROXY_DIGEST = "5347986b9305d3b471efafb452416c91f254fef9bc3a8d405a2e03da059e1d02";
const EXPECTED_EDGE_PWA_HELPER_DIGEST = "6a6a11189a9830a5248927257bc1c2e5c40c8f263d86879649c7b4ff15c9b332";
const TASK_OWNED_EDGE_MANIFEST_SCHEMA = "p24b-rc6.2-task-owned-edge-toolchain-manifest-v1";
const TASK_OWNED_EDGE_ROOT_RELATIVE_PATH = join("NovelRC62Toolchains", "Edge", EXPECTED_EDGE_VERSION);
const TASK_OWNED_EDGE_APPLICATION_ENTRIES = Object.freeze([
  EXPECTED_EDGE_VERSION,
  "msedge.exe",
  "msedge.VisualElementsManifest.xml",
  "msedge_proxy.exe",
  "PlatformExperiencesHelper",
  "pwahelper.exe",
]);
const EXPECTED_PACKAGE_JSON_DIGEST = "c69575d984fd7df0cbd1b7ca4aa0050939b3061a2fea7aa4a220641007bf1984";
const EXPECTED_PNPM_LOCK_DIGEST = "bf80df1d7e1419628c2dac09bfb8b39360942098324d47269f9690eab52b7b7f";
const INITIAL_GATE_BLOB_PATHS = [
  ".github/workflows/deploy.yml",
  "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-closed-agent-browser.mjs",
  "scripts/run-rc6-2-closed-agent-runtime.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate.ps1",
];
const HISTORICAL_GATE_REPAIR_PATHS = [
  ".github/workflows/deploy.yml",
  "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate.ps1",
];
const C6_GATE_REPAIR_PATHS = [
  ".github/workflows/deploy.yml",
  "package.json",
  "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate.ps1",
];
const C7_GATE_REPAIR_PATHS = [
  ".github/workflows/deploy.yml",
  "package.json",
  "scripts/rc6-2-formal-attempt-state.mjs",
  "scripts/rc6-2-terminal-evidence.mjs",
  "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-closed-agent-browser.mjs",
  "scripts/run-rc6-2-formal-attempt-state-tests.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate.ps1",
  "scripts/run-rc6-2-terminal-evidence-tests.mjs",
];
const C8_GATE_REPAIR_PATHS = [
  ".github/workflows/deploy.yml",
  "package.json",
  "scripts/rc6-2-terminal-evidence.mjs",
  "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-closed-agent-browser.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate.ps1",
  "scripts/run-rc6-2-runner-envelope-tests.mjs",
  "scripts/run-rc6-2-terminal-evidence-tests.mjs",
];
const C9_GATE_REPAIR_PATHS = [
  ".github/workflows/deploy.yml",
  "package.json",
  "scripts/rc6-2-terminal-evidence.mjs",
  "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-closed-agent-browser.mjs",
  "scripts/run-rc6-2-closed-agent-runtime.mjs",
  "scripts/run-rc6-2-network-sentinel-tests.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate.ps1",
  "scripts/run-rc6-2-runner-envelope-tests.mjs",
  "scripts/run-rc6-2-terminal-evidence-tests.mjs",
];
const C10_GATE_REPAIR_PATHS = [
  ".github/workflows/deploy.yml",
  "package.json",
  "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate.ps1",
];
const COMPOSITE_GATE_BLOB_PATHS = [...new Set([
  ...INITIAL_GATE_BLOB_PATHS,
  ...C7_GATE_REPAIR_PATHS,
  ...C8_GATE_REPAIR_PATHS,
  ...C9_GATE_REPAIR_PATHS,
])];
const PRODUCT_RUNTIME_TRUTH_PATHS = [
  "lib/novel-ai/character-agent/repository.ts",
  "lib/novel-ai/repository/contracts/index.ts",
  "lib/novel-ai/repository/indexeddb/indexeddb-repository.ts",
  "lib/novel-ai/repository/persistence-recovery.ts",
  "scripts/rc6-2-closed-agent-network-policy.mjs",
];

function occurrences(source, literal) {
  return source.split(literal).length - 1;
}

function sourceSection(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label} start marker is missing`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${label} end marker is missing`);
  assert.ok(end > start, `${label} source markers are out of order`);
  return source.slice(start, end);
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
      // pnpm generates package-local command shims containing the absolute
      // workspace path. They are not on the direct Node runner import path and
      // are sealed separately using a path-neutral canonical receipt below.
      if (relativePath === "node_modules") continue;
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

function normalizeGeneratedBinShim(text) {
  const forwardRoot = repositoryRoot.replaceAll("\\", "/");
  const windowsRoot = forwardRoot.replaceAll("/", "\\");
  const driveMatch = /^([A-Za-z]):\/(.*)$/u.exec(forwardRoot);
  assert.ok(driveMatch, "repository root was not an absolute Windows path");
  const wslRoot = `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`;
  let normalized = text;
  for (const variant of [windowsRoot, forwardRoot, wslRoot]) {
    normalized = normalized.split(variant).join("<REPOSITORY_ROOT>");
  }
  assert.equal(normalized.includes(windowsRoot), false);
  assert.equal(normalized.includes(forwardRoot), false);
  assert.equal(normalized.includes(wslRoot), false);
  return normalized;
}

async function generatedBinReceipt(root, commandName) {
  const digest = createHash("sha256");
  let fileCount = 0;
  let byteCount = 0;
  const entries = (await readdir(root, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  assert.deepEqual(entries.map((entry) => entry.name), [
    commandName, `${commandName}.CMD`, `${commandName}.ps1`,
  ]);
  for (const entry of entries) {
    const absolutePath = join(root, entry.name);
    const truth = await lstat(absolutePath);
    assert.equal(truth.isFile(), true, `generated dependency shim is not a file: ${entry.name}`);
    assert.equal(truth.isSymbolicLink(), false, `generated dependency shim is a symlink: ${entry.name}`);
    const rawBytes = await readFile(absolutePath);
    const rawText = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
    const normalizedBytes = Buffer.from(normalizeGeneratedBinShim(rawText), "utf8");
    digest.update(entry.name);
    digest.update("\0");
    digest.update(String(normalizedBytes.length));
    digest.update("\0");
    digest.update(normalizedBytes);
    fileCount += 1;
    byteCount += normalizedBytes.length;
  }
  return { fileCount, byteCount, digest: digest.digest("hex") };
}

function comparableFilesystemPath(value) {
  const absolute = resolve(value);
  return process.platform === "win32" ? absolute.toLocaleLowerCase("en-US") : absolute;
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.nlink === right.nlink;
}

function sameDirectoryIdentity(left, right) {
  return left.isDirectory() && right.isDirectory()
    && !left.isSymbolicLink() && !right.isSymbolicLink()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === right.nlink;
}

async function assertCanonicalUnlinkedPath(path, expectedKind, label) {
  const expected = resolve(path);
  const truth = await lstat(expected);
  assert.equal(truth.isSymbolicLink(), false, `${label} is a link or reparse path`);
  assert.equal(truth[expectedKind](), true, `${label} has the wrong filesystem kind`);
  assert.equal(
    comparableFilesystemPath(await realpath(expected)),
    comparableFilesystemPath(expected),
    `${label} resolved through an alias or reparse target`,
  );
  return truth;
}

async function readBoundedFileHandle(path, {
  maxByteCount,
  expectedByteCount = null,
  afterRead = null,
  onChunk = null,
  label = "sealed file",
} = {}) {
  assert.ok(Number.isSafeInteger(maxByteCount) && maxByteCount >= 0, `${label} byte cap is invalid`);
  const canonicalPath = resolve(path);
  const pathBefore = await assertCanonicalUnlinkedPath(canonicalPath, "isFile", label);
  assert.equal(pathBefore.nlink, 1, `${label} must not be hardlinked`);
  assert.ok(Number.isSafeInteger(pathBefore.size) && pathBefore.size >= 0, `${label} size is invalid`);
  assert.ok(pathBefore.size <= maxByteCount, `${label} exceeds its byte cap`);
  if (expectedByteCount !== null) assert.equal(pathBefore.size, expectedByteCount, `${label} length drifted`);
  const handle = await open(canonicalPath, "r");
  let offset = 0;
  try {
    const handleBefore = await handle.stat();
    assert.equal(handleBefore.isFile(), true, `${label} handle has the wrong filesystem kind`);
    assert.equal(handleBefore.nlink, 1, `${label} handle must not be hardlinked`);
    assert.equal(sameFileIdentity(pathBefore, handleBefore), true, `${label} changed before open`);
    const chunk = Buffer.allocUnsafe(65_536);
    while (offset < handleBefore.size) {
      const requested = Math.min(chunk.length, handleBefore.size - offset);
      const { bytesRead } = await handle.read(chunk, 0, requested, offset);
      assert.ok(bytesRead > 0 && bytesRead <= requested, `${label} ended before its sealed length`);
      if (onChunk) onChunk(chunk.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const eofProbe = Buffer.allocUnsafe(1);
    assert.equal((await handle.read(eofProbe, 0, 1, offset)).bytesRead, 0, `${label} grew while read`);
    if (afterRead) await afterRead(canonicalPath);
    const handleAfter = await handle.stat();
    assert.equal(sameFileIdentity(handleBefore, handleAfter), true, `${label} changed while read`);
  } finally {
    await handle.close();
  }
  const pathAfter = await lstat(canonicalPath);
  assert.equal(sameFileIdentity(pathBefore, pathAfter), true, `${label} path changed while read`);
  assert.equal(pathAfter.isFile() && !pathAfter.isSymbolicLink() && pathAfter.nlink === 1, true);
  assert.equal(
    comparableFilesystemPath(await realpath(canonicalPath)),
    comparableFilesystemPath(canonicalPath),
    `${label} resolved through an alias after read`,
  );
  return offset;
}

async function completeTreeReceipt(root, {
  afterFileRead = null,
  maxByteCount = EXPECTED_EDGE_APPLICATION_BYTE_COUNT,
} = {}) {
  const canonicalRoot = resolve(root);
  const rootBefore = await assertCanonicalUnlinkedPath(canonicalRoot, "isDirectory", "sealed tree root");
  const digest = createHash("sha256");
  let directoryCount = 0;
  let fileCount = 0;
  let byteCount = 0;
  async function walk(directory, relativeDirectory = "") {
    const directoryBefore = await assertCanonicalUnlinkedPath(
      directory,
      "isDirectory",
      relativeDirectory || "sealed tree root",
    );
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
        directoryCount += 1;
        await walk(absolutePath, relativePath);
      } else if (truth.isFile()) {
        assert.equal(truth.nlink, 1, `sealed tree contains a hardlinked file: ${relativePath}`);
        assert.equal(
          comparableFilesystemPath(await realpath(absolutePath)),
          comparableFilesystemPath(absolutePath),
          `sealed tree file resolved through an alias: ${relativePath}`,
        );
        assert.ok(Number.isSafeInteger(truth.size) && truth.size >= 0);
        assert.ok(byteCount + truth.size <= maxByteCount, `sealed tree exceeds its byte cap: ${relativePath}`);
        digest.update(relativePath);
        digest.update("\0");
        digest.update(String(truth.size));
        digest.update("\0");
        const bytesRead = await readBoundedFileHandle(absolutePath, {
          maxByteCount: maxByteCount - byteCount,
          expectedByteCount: truth.size,
          afterRead: afterFileRead
            ? async (path) => afterFileRead(path, relativePath)
            : null,
          onChunk: (chunk) => digest.update(chunk),
          label: `sealed tree file ${relativePath}`,
        });
        fileCount += 1;
        byteCount += bytesRead;
      } else {
        assert.fail(`sealed tree contains an unsupported entry: ${relativePath}`);
      }
    }
    assert.deepEqual(
      (await readdir(directory)).sort((left, right) => left.localeCompare(right, "en")),
      entries.map(({ name }) => name),
      `sealed tree directory changed while read: ${relativeDirectory || "."}`,
    );
    const directoryAfter = await lstat(directory);
    assert.equal(
      sameFileIdentity(directoryBefore, directoryAfter),
      true,
      `sealed tree directory identity changed while read: ${relativeDirectory || "."}`,
    );
  }
  await walk(canonicalRoot);
  assert.equal(sameFileIdentity(rootBefore, await lstat(canonicalRoot)), true, "sealed tree root changed while read");
  return {
    directoryCount,
    fileCount,
    byteCount,
    digest: digest.digest("hex"),
  };
}

async function sha256File(path) {
  const digest = createHash("sha256");
  await readBoundedFileHandle(path, {
    maxByteCount: EXPECTED_EDGE_APPLICATION_BYTE_COUNT,
    onChunk: (chunk) => digest.update(chunk),
    label: `digest source ${basename(path)}`,
  });
  return digest.digest("hex");
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

const PRODUCTION_RUNTIME_RECEIPT_SCHEMA = "p24b-rc6.2-production-browser-runtime-receipt-v2";
const PRODUCTION_RUNTIME_RECEIPT_SOURCE = "production-browser-preflight-read-only-v1";
const TOOLCHAIN_RECEIPT_SCHEMA = "p24b-rc6.2-production-browser-toolchain-receipt-v1";
const PREFLIGHT_FAILURE_SCHEMA = "p24b-rc6.2-production-browser-preflight-failure-v1";
const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const RUN_ID = /^[a-f0-9]{32}$/u;
const UTC_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const TASK_OWNED_EDGE_APPLICATION_PATH_DOMAIN = "p24b-rc6.2-task-owned-edge-application-root-v1";
const TASK_OWNED_EDGE_MANIFEST_KEYS = Object.freeze([
  "schemaVersion",
  "installationKind",
  "edgeVersion",
  "applicationRelativePath",
  "sourceMsiUrl",
  "sourceMsiSha256",
  "sourceMsiPublishedAt",
  "executableSha256",
  "engineDllSha256",
  "versionDirectoryFileCount",
  "versionDirectoryByteCount",
  "versionDirectorySha256",
  "applicationDirectoryCount",
  "applicationFileCount",
  "applicationByteCount",
  "applicationSha256",
  "provisionedAt",
  "manifestDigest",
]);
const EXPECTED_TASK_OWNED_EDGE_MANIFEST = Object.freeze({
  applicationByteCount: 915_721_905,
  applicationDirectoryCount: 45,
  applicationFileCount: 789,
  applicationRelativePath: "Application",
  applicationSha256: EXPECTED_EDGE_APPLICATION_DIGEST,
  edgeVersion: EXPECTED_EDGE_VERSION,
  engineDllSha256: EXPECTED_EDGE_DLL_DIGEST,
  executableSha256: EXPECTED_EDGE_EXE_DIGEST,
  installationKind: "task-owned-receipt-sealed",
  manifestDigest: EXPECTED_EDGE_MANIFEST_DIGEST,
  provisionedAt: "2026-08-13T05:39:37.000Z",
  schemaVersion: TASK_OWNED_EDGE_MANIFEST_SCHEMA,
  sourceMsiPublishedAt: "2026-08-10T15:04:00.000Z",
  sourceMsiSha256: EXPECTED_EDGE_SOURCE_MSI_DIGEST,
  sourceMsiUrl: EXPECTED_EDGE_SOURCE_MSI_URL,
  versionDirectoryByteCount: 902_472_183,
  versionDirectoryFileCount: 784,
  versionDirectorySha256: EXPECTED_EDGE_VERSION_DIRECTORY_DIGEST,
});

class PreflightContractError extends Error {
  constructor(code) {
    super(code);
    this.name = "PreflightContractError";
    this.code = code;
  }
}

function preflightReject(code) {
  throw new PreflightContractError(code);
}

function requireExactKeys(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) preflightReject(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    preflightReject(code);
  }
}

function requireSafeTimestamp(value, code) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (
    typeof value !== "string" || !UTC_MILLISECONDS.test(value) || !Number.isFinite(parsed)
    || new Date(parsed).toISOString() !== value
  ) {
    preflightReject(code);
  }
}

const BRIDGE_HEALTH_KEYS = [
  "status", "processAlive", "pid", "protocolVersion", "bindAddress", "modelAvailable",
  "active", "queued", "serverDigest", "coreDigest",
];
const HUB_HEALTH_KEYS = [
  "status", "processAlive", "pid", "protocolVersion", "bindAddress", "modelAvailable",
  "active", "queued", "serverDigest",
];
const OLLAMA_HEALTH_KEYS = [
  "status", "processAlive", "bindAddress", "version", "idle", "runningModelCount",
  "modelInstalled",
];
const RUNTIME_OBSERVATION_KEYS = [
  "preflightRunId", "executionMode", "productCommit", "controlCommit",
  "productionDeploymentId", "productionOrigin", "releaseTag", "releaseRevision", "createdAt",
  "bridgeHealth", "hubHealth", "ollamaHealth", "ollamaPid", "modelId", "modelDigest",
  "toolchainReceiptDigest", "readOnly", "mutationCount",
];

function validateBridgeHealth(value) {
  requireExactKeys(value, BRIDGE_HEALTH_KEYS, "PREFLIGHT_RECEIPT_BRIDGE_SCHEMA_INVALID");
  if (
    value.status !== "PASS" || value.processAlive !== true
    || !Number.isSafeInteger(value.pid) || value.pid < 1
    || value.protocolVersion !== "novel-local-bridge/v1" || value.bindAddress !== "127.0.0.1"
    || value.modelAvailable !== true || value.active !== 0 || value.queued !== 0
    || !SHA256.test(value.serverDigest) || !SHA256.test(value.coreDigest)
  ) preflightReject("PREFLIGHT_RECEIPT_BRIDGE_HEALTH_INVALID");
}

function validateHubHealth(value) {
  requireExactKeys(value, HUB_HEALTH_KEYS, "PREFLIGHT_RECEIPT_HUB_SCHEMA_INVALID");
  if (
    value.status !== "PASS" || value.processAlive !== true
    || !Number.isSafeInteger(value.pid) || value.pid < 1
    || value.protocolVersion !== "novel-private-hub/v1" || value.bindAddress !== "127.0.0.1"
    || value.modelAvailable !== true || value.active !== 0 || value.queued !== 0
    || !SHA256.test(value.serverDigest)
  ) preflightReject("PREFLIGHT_RECEIPT_HUB_HEALTH_INVALID");
}

function validateOllamaHealth(value) {
  requireExactKeys(value, OLLAMA_HEALTH_KEYS, "PREFLIGHT_RECEIPT_OLLAMA_SCHEMA_INVALID");
  if (
    value.status !== "PASS" || value.processAlive !== true || value.bindAddress !== "127.0.0.1"
    || typeof value.version !== "string" || !/^[0-9A-Za-z.+-]{1,64}$/u.test(value.version)
    || value.idle !== true || value.runningModelCount !== 0 || value.modelInstalled !== true
  ) preflightReject("PREFLIGHT_RECEIPT_OLLAMA_HEALTH_INVALID");
}

function validateRuntimeObservation(value) {
  requireExactKeys(value, RUNTIME_OBSERVATION_KEYS, "PREFLIGHT_RECEIPT_SCHEMA_INVALID");
  if (!RUN_ID.test(value.preflightRunId)) preflightReject("PREFLIGHT_RECEIPT_RUN_ID_INVALID");
  if (!["PreflightDryRun", "FormalBrowserGate"].includes(value.executionMode)) {
    preflightReject("PREFLIGHT_RECEIPT_EXECUTION_MODE_INVALID");
  }
  if (value.productCommit !== PRODUCT_COMMIT || !COMMIT.test(value.controlCommit)) {
    preflightReject("PREFLIGHT_RECEIPT_COMMIT_BINDING_INVALID");
  }
  if (
    value.productionDeploymentId !== EXPECTED_DEPLOYMENT_ID || value.productionOrigin !== EXPECTED_ORIGIN
    || value.releaseTag !== EXPECTED_RELEASE_TAG || value.releaseRevision !== "rc6.2"
  ) preflightReject("PREFLIGHT_RECEIPT_PRODUCTION_BINDING_INVALID");
  requireSafeTimestamp(value.createdAt, "PREFLIGHT_RECEIPT_CREATED_AT_INVALID");
  validateBridgeHealth(value.bridgeHealth);
  validateHubHealth(value.hubHealth);
  validateOllamaHealth(value.ollamaHealth);
  if (!Number.isSafeInteger(value.ollamaPid) || value.ollamaPid < 1) {
    preflightReject("PREFLIGHT_RECEIPT_OLLAMA_PID_INVALID");
  }
  if (value.modelId !== "qwen2.5:3b" || !SHA256.test(value.modelDigest)) {
    preflightReject("PREFLIGHT_RECEIPT_MODEL_IDENTITY_INVALID");
  }
  if (!SHA256.test(value.toolchainReceiptDigest)) preflightReject("PREFLIGHT_RECEIPT_TOOLCHAIN_DIGEST_INVALID");
  if (value.readOnly !== true || value.mutationCount !== 0) {
    preflightReject("PREFLIGHT_RECEIPT_MUTATION_BOUNDARY_INVALID");
  }
  return structuredClone(value);
}

function createProductionRuntimeReceipt(observation) {
  const validated = validateRuntimeObservation(observation);
  const body = {
    schemaVersion: PRODUCTION_RUNTIME_RECEIPT_SCHEMA,
    ...validated,
    source: PRODUCTION_RUNTIME_RECEIPT_SOURCE,
  };
  return {
    ...body,
    digest: createHash("sha256").update(`${PRODUCTION_RUNTIME_RECEIPT_SCHEMA}\n${stableStringify(body)}`).digest("hex"),
  };
}

function validateProductionRuntimeReceipt(receiptText, expectedObservation, validatedAt, freshnessMode) {
  if (typeof receiptText !== "string" || receiptText.length === 0) preflightReject("PREFLIGHT_RECEIPT_MISSING");
  if (
    receiptText.length > 65_536 || receiptText.includes("\0") || receiptText.includes("\uFFFD")
    || receiptText.startsWith("\uFEFF")
  ) preflightReject("PREFLIGHT_RECEIPT_ENCODING_INVALID");
  let receipt;
  try { receipt = JSON.parse(receiptText); } catch { preflightReject("PREFLIGHT_RECEIPT_JSON_INVALID"); }
  const expected = createProductionRuntimeReceipt(expectedObservation);
  requireExactKeys(receipt, [...Object.keys(expected)], "PREFLIGHT_RECEIPT_SCHEMA_INVALID");
  if (
    receipt.schemaVersion !== PRODUCTION_RUNTIME_RECEIPT_SCHEMA
    || receipt.source !== PRODUCTION_RUNTIME_RECEIPT_SOURCE
  ) preflightReject("PREFLIGHT_RECEIPT_SCHEMA_INVALID");
  if (stableStringify(receipt) !== receiptText) preflightReject("PREFLIGHT_RECEIPT_NON_CANONICAL");
  const { digest, ...body } = receipt;
  const recomputed = createHash("sha256")
    .update(`${PRODUCTION_RUNTIME_RECEIPT_SCHEMA}\n${stableStringify(body)}`).digest("hex");
  if (digest !== recomputed) preflightReject("PREFLIGHT_RECEIPT_DIGEST_MISMATCH");
  if (stableStringify(receipt) !== stableStringify(expected)) preflightReject("PREFLIGHT_RECEIPT_BINDING_MISMATCH");
  requireSafeTimestamp(validatedAt, "PREFLIGHT_RECEIPT_VALIDATION_TIME_INVALID");
  if (!["preflight", "immutable-readback"].includes(freshnessMode)) {
    preflightReject("PREFLIGHT_RECEIPT_FRESHNESS_MODE_INVALID");
  }
  if (freshnessMode === "preflight") {
    const age = Date.parse(validatedAt) - Date.parse(receipt.createdAt);
    if (age < -5_000 || age > 300_000) preflightReject("PREFLIGHT_RECEIPT_STALE");
  }
  return {
    schemaVersion: "p24b-rc6.2-production-browser-runtime-receipt-validation-v1",
    status: "PASS",
    receiptDigest: digest,
    receiptByteLength: Buffer.byteLength(receiptText, "utf8"),
    receiptFileSha256: createHash("sha256").update(receiptText, "utf8").digest("hex"),
  };
}

async function validateProductionRuntimeReceiptFile({
  actualPath,
  expectedPath,
  expectedObservation,
  validatedAt,
  freshnessMode,
  expectedFileSha256 = null,
}) {
  if (resolve(actualPath) !== resolve(expectedPath)) preflightReject("PREFLIGHT_RECEIPT_PATH_MISMATCH");
  let receiptText;
  try { receiptText = await readFile(actualPath, "utf8"); } catch { preflightReject("PREFLIGHT_RECEIPT_MISSING"); }
  const validation = validateProductionRuntimeReceipt(
    receiptText,
    expectedObservation,
    validatedAt,
    freshnessMode,
  );
  if (expectedFileSha256 !== null && validation.receiptFileSha256 !== expectedFileSha256) {
    preflightReject("PREFLIGHT_RECEIPT_FILE_SHA_MISMATCH");
  }
  return validation;
}

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const dependencyPackages = [
  {
    name: "@playwright/test",
    linkedPath: join(repositoryRoot, "node_modules", "@playwright", "test"),
    packagePath: join(repositoryRoot, "node_modules", ".pnpm", "@playwright+test@1.61.1", "node_modules", "@playwright", "test"),
    digest: "8ae6c026ab472520a31557e9f0b78a983b94873300f144de6ce2b167b8fac14f",
  },
  {
    name: "playwright",
    packagePath: join(repositoryRoot, "node_modules", ".pnpm", "playwright@1.61.1", "node_modules", "playwright"),
    digest: "8ea0b3ae44708b3bf4ef923aced06c8b1f8dccc15df6a9131aacc2c1d40a57ba",
  },
  {
    name: "playwright-core",
    packagePath: join(repositoryRoot, "node_modules", ".pnpm", "playwright-core@1.61.1", "node_modules", "playwright-core"),
    digest: "efff85ef77071866494ea4b35c90060b2eb96098f5633f8dee6c2b28c24000ac",
  },
];

function taskOwnedEdgePaths(localAppData = process.env.LOCALAPPDATA) {
  assert.equal(typeof localAppData, "string", "LOCALAPPDATA is required for the task-owned Edge root");
  assert.equal(isAbsolute(localAppData), true, "LOCALAPPDATA must be absolute");
  const localRoot = resolve(localAppData);
  const toolchainRoot = resolve(localRoot, TASK_OWNED_EDGE_ROOT_RELATIVE_PATH);
  assert.equal(
    comparableFilesystemPath(dirname(dirname(dirname(toolchainRoot)))),
    comparableFilesystemPath(localRoot),
    "task-owned Edge root escaped LOCALAPPDATA",
  );
  const applicationRoot = join(toolchainRoot, "Application");
  const versionRoot = join(applicationRoot, EXPECTED_EDGE_VERSION);
  return Object.freeze({
    localRoot,
    toolchainsRoot: join(localRoot, "NovelRC62Toolchains"),
    edgeRoot: join(localRoot, "NovelRC62Toolchains", "Edge"),
    toolchainRoot,
    applicationRoot,
    versionRoot,
    executablePath: join(applicationRoot, "msedge.exe"),
    engineDllPath: join(versionRoot, "msedge.dll"),
    manifestPath: join(toolchainRoot, "toolchain-manifest.json"),
  });
}

async function readTaskOwnedEdgeManifest(manifestPath, { afterRead = null } = {}) {
  const chunks = [];
  const length = await readBoundedFileHandle(manifestPath, {
    maxByteCount: EXPECTED_EDGE_MANIFEST_BYTES,
    expectedByteCount: EXPECTED_EDGE_MANIFEST_BYTES,
    afterRead,
    onChunk: (chunk) => chunks.push(Buffer.from(chunk)),
    label: "task-owned Edge manifest",
  });
  assert.equal(length, EXPECTED_EDGE_MANIFEST_BYTES);
  const bytes = Buffer.concat(chunks, length);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), EXPECTED_EDGE_MANIFEST_FILE_DIGEST);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assert.equal(text.startsWith("\uFEFF"), false, "task-owned Edge manifest contains a BOM");
  assert.equal(text.includes("\0") || text.includes("\r") || text.includes("\n"), false);
  const manifest = JSON.parse(text);
  assertExactKeys(manifest, TASK_OWNED_EDGE_MANIFEST_KEYS, "task-owned Edge manifest");
  assert.deepEqual(manifest, EXPECTED_TASK_OWNED_EDGE_MANIFEST);
  assert.equal(stableStringify(manifest), text, "task-owned Edge manifest is not canonical JSON");
  const { manifestDigest, ...body } = manifest;
  assert.equal(
    manifestDigest,
    createHash("sha256").update(`${TASK_OWNED_EDGE_MANIFEST_SCHEMA}\n${stableStringify(body)}`).digest("hex"),
    "task-owned Edge manifest digest drifted",
  );
  return manifest;
}

function assertTaskOwnedEdgeAuthenticode(executablePath, engineDllPath) {
  if (process.platform !== "win32") assert.fail("task-owned Edge validation requires Windows");
  const powerShell = join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const script = [
    "$ErrorActionPreference='Stop'",
    "$expected='CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US'",
    "foreach($path in $args){$sig=Get-AuthenticodeSignature -LiteralPath $path;if($sig.Status -ne 'Valid' -or $null -eq $sig.SignerCertificate -or -not [StringComparer]::Ordinal.Equals($sig.SignerCertificate.Subject,$expected)){exit 9}}",
  ].join(";");
  const result = spawnSync(powerShell, [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-Command", `& { ${script} }`, executablePath, engineDllPath,
  ], { encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 65_536 });
  assert.equal(result.status, 0, "task-owned Edge Authenticode validation failed");
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
}

function assertTaskOwnedEdgeFilesystemPolicy(paths, expectedDescendantCount = 836) {
  assert.ok(Number.isSafeInteger(expectedDescendantCount) && expectedDescendantCount >= 0);
  if (process.platform !== "win32") assert.fail("task-owned Edge filesystem policy requires Windows");
  const powerShell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = String.raw`
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$toolchains=[IO.Path]::GetFullPath($args[0]).TrimEnd('\');$edge=[IO.Path]::GetFullPath($args[1]).TrimEnd('\');$root=[IO.Path]::GetFullPath($args[2]).TrimEnd('\');$version=[string]$args[3];$expectedCount=[int]$args[4]
$current=[Security.Principal.WindowsIdentity]::GetCurrent();$currentSid=$current.User.Value
function Fail([string]$code){Write-Error $code;exit 19}
function ExactEntries([string]$path,[string[]]$expected,[string]$code){$actual=@((Get-ChildItem -LiteralPath $path -Force|ForEach-Object{$_.Name})|Sort-Object -CaseSensitive);$want=@($expected|Sort-Object -CaseSensitive);if($actual.Count-ne$want.Count){Fail $code};for($i=0;$i-lt$want.Count;$i+=1){if(-not[StringComparer]::Ordinal.Equals([string]$actual[$i],[string]$want[$i])){Fail $code}}}
function Rule([Security.AccessControl.FileSystemAccessRule]$rule){$sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;return "$sid|$([int64]$rule.FileSystemRights)|$($rule.AccessControlType)|$($rule.IsInherited)|$([int]$rule.InheritanceFlags)|$([int]$rule.PropagationFlags)"}
function Expected([bool]$inherited,[bool]$container){$flags=if($container){3}else{0};return @("S-1-5-18|2032127|Allow|$inherited|$flags|0","S-1-5-32-544|2032127|Allow|$inherited|$flags|0","$currentSid|1179817|Allow|$inherited|$flags|0")|Sort-Object -CaseSensitive}
function AssertAcl([string]$path,[bool]$rootEntry){$item=Get-Item -LiteralPath $path -Force;if(($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne 0-or$null-ne$item.LinkType){Fail 'TASK_OWNED_EDGE_REPARSE_INVALID'};$acl=Get-Acl -LiteralPath $path;$owner=(New-Object Security.Principal.NTAccount($acl.Owner)).Translate([Security.Principal.SecurityIdentifier]).Value;if($owner-ne$currentSid){Fail 'TASK_OWNED_EDGE_OWNER_INVALID'};if($rootEntry-ne[bool]$acl.AreAccessRulesProtected){Fail 'TASK_OWNED_EDGE_ACL_PROTECTION_INVALID'};$actual=@($acl.Access|ForEach-Object{Rule $_}|Sort-Object -CaseSensitive);$want=@(Expected (-not$rootEntry) ([bool]$item.PSIsContainer));if($actual.Count-ne$want.Count){Fail 'TASK_OWNED_EDGE_ACL_INVALID'};for($i=0;$i-lt$want.Count;$i+=1){if(-not[StringComparer]::Ordinal.Equals([string]$actual[$i],[string]$want[$i])){Fail 'TASK_OWNED_EDGE_ACL_INVALID'}}}
ExactEntries $toolchains @('Edge') 'TASK_OWNED_EDGE_TOOLCHAINS_TOPOLOGY_INVALID';ExactEntries $edge @($version) 'TASK_OWNED_EDGE_FAMILY_TOPOLOGY_INVALID';AssertAcl $toolchains $true;AssertAcl $edge $true;AssertAcl $root $true
$descendants=@(Get-ChildItem -LiteralPath $root -Force -Recurse);if($descendants.Count-ne$expectedCount){Fail 'TASK_OWNED_EDGE_DESCENDANT_COUNT_INVALID'};foreach($entry in $descendants){AssertAcl $entry.FullName $false}
[ordered]@{status='PASS';entryCount=$descendants.Count;badReparseCount=0;ownerMatchesCurrentUser=$true;rootAclProtected=$true;descendantAclInherited=$true}|ConvertTo-Json -Compress
`;
  const result = spawnSync(powerShell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", `& { ${script} }`, paths.toolchainsRoot, paths.edgeRoot, paths.toolchainRoot, EXPECTED_EDGE_VERSION, String(expectedDescendantCount)], { encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 65_536 });
  assert.equal(result.status, 0, `task-owned Edge filesystem policy failed: ${result.stderr}`);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout.trim()), { status: "PASS", entryCount: expectedDescendantCount, badReparseCount: 0, ownerMatchesCurrentUser: true, rootAclProtected: true, descendantAclInherited: true });
}

async function validateTaskOwnedEdgeInstallation({
  localAppData = process.env.LOCALAPPDATA,
  manifestAfterRead = null,
  treeAfterFileRead = null,
  requireAuthenticode = true,
} = {}) {
  const paths = taskOwnedEdgePaths(localAppData);
  assertTaskOwnedEdgeFilesystemPolicy(paths);
  for (const [path, label] of [
    [paths.localRoot, "LOCALAPPDATA"],
    [paths.toolchainsRoot, "task-owned toolchains root"],
    [paths.edgeRoot, "task-owned Edge family root"],
    [paths.toolchainRoot, "task-owned Edge version root"],
    [paths.applicationRoot, "task-owned Edge Application root"],
    [paths.versionRoot, "task-owned Edge engine version root"],
  ]) await assertCanonicalUnlinkedPath(path, "isDirectory", label);
  await assertExactDirectoryEntries(paths.toolchainRoot, ["Application", "toolchain-manifest.json"]);
  await assertExactDirectoryEntries(paths.applicationRoot, TASK_OWNED_EDGE_APPLICATION_ENTRIES);
  assert.equal((await readdir(join(paths.applicationRoot, "PlatformExperiencesHelper"))).length, 1);
  const manifest = await readTaskOwnedEdgeManifest(paths.manifestPath, { afterRead: manifestAfterRead });
  const applicationReceipt = await completeTreeReceipt(paths.applicationRoot, { afterFileRead: treeAfterFileRead });
  assert.deepEqual(applicationReceipt, {
    directoryCount: manifest.applicationDirectoryCount,
    fileCount: manifest.applicationFileCount,
    byteCount: manifest.applicationByteCount,
    digest: manifest.applicationSha256,
  });
  const versionReceipt = await completeTreeReceipt(paths.versionRoot, { afterFileRead: treeAfterFileRead });
  assert.equal(versionReceipt.directoryCount, 43);
  assert.deepEqual({
    fileCount: versionReceipt.fileCount,
    byteCount: versionReceipt.byteCount,
    digest: versionReceipt.digest,
  }, {
    fileCount: manifest.versionDirectoryFileCount,
    byteCount: manifest.versionDirectoryByteCount,
    digest: manifest.versionDirectorySha256,
  });
  const visualManifestPath = join(paths.applicationRoot, "msedge.VisualElementsManifest.xml");
  const proxyPath = join(paths.applicationRoot, "msedge_proxy.exe");
  const pwaHelperPath = join(paths.applicationRoot, "pwahelper.exe");
  const boundFileDigests = Object.freeze({
    executable: await sha256File(paths.executablePath),
    engineDll: await sha256File(paths.engineDllPath),
    visualManifest: await sha256File(visualManifestPath),
    proxy: await sha256File(proxyPath),
    pwaHelper: await sha256File(pwaHelperPath),
  });
  assert.equal(boundFileDigests.executable, manifest.executableSha256);
  assert.equal(boundFileDigests.engineDll, manifest.engineDllSha256);
  assert.equal(boundFileDigests.visualManifest, EXPECTED_EDGE_VISUAL_MANIFEST_DIGEST);
  assert.equal(boundFileDigests.proxy, EXPECTED_EDGE_PROXY_DIGEST);
  assert.equal(boundFileDigests.pwaHelper, EXPECTED_EDGE_PWA_HELPER_DIGEST);
  if (requireAuthenticode) assertTaskOwnedEdgeAuthenticode(paths.executablePath, paths.engineDllPath);
  assert.deepEqual(await readTaskOwnedEdgeManifest(paths.manifestPath), manifest, "task-owned Edge manifest drifted after signature validation");
  assert.deepEqual(
    await completeTreeReceipt(paths.applicationRoot),
    applicationReceipt,
    "task-owned Edge Application tree drifted after signature validation",
  );
  assert.deepEqual(
    await completeTreeReceipt(paths.versionRoot),
    versionReceipt,
    "task-owned Edge version tree drifted after signature validation",
  );
  assert.deepEqual({
    executable: await sha256File(paths.executablePath),
    engineDll: await sha256File(paths.engineDllPath),
    visualManifest: await sha256File(visualManifestPath),
    proxy: await sha256File(proxyPath),
    pwaHelper: await sha256File(pwaHelperPath),
  }, boundFileDigests, "task-owned Edge executable bytes drifted after signature validation");
  assertTaskOwnedEdgeFilesystemPolicy(paths);
  const applicationRootPathDigest = createHash("sha256").update(
    `${TASK_OWNED_EDGE_APPLICATION_PATH_DOMAIN}\n${comparableFilesystemPath(paths.applicationRoot)}`,
  ).digest("hex");
  return Object.freeze({ paths, manifest, applicationReceipt, versionReceipt, applicationRootPathDigest });
}

async function createToolchainReceipt() {
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
  const testBinReceipt = await generatedBinReceipt(
    join(testPackageRoot, "node_modules", ".bin"),
    "playwright",
  );
  const playwrightBinReceipt = await generatedBinReceipt(
    join(playwrightPackageRoot, "node_modules", ".bin"),
    "playwright-core",
  );
  assert.deepEqual(testBinReceipt, {
    fileCount: 3,
    byteCount: 3_449,
    digest: "9d2b696817d199a4e981d81593666f9d058f6b4f8def881fe7d62353058c0f2b",
  });
  assert.deepEqual(playwrightBinReceipt, {
    fileCount: 3,
    byteCount: 3_595,
    digest: "9635711cb5f5ab01e01927df43d2f947d287a9f7be7e5f21d0b66b2ed83eb5e3",
  });
  assert.equal(await sha256File(join(repositoryRoot, "package.json")), EXPECTED_PACKAGE_JSON_DIGEST);
  assert.equal(await sha256File(join(repositoryRoot, "pnpm-lock.yaml")), EXPECTED_PNPM_LOCK_DIGEST);
  const edgeTruth = await validateTaskOwnedEdgeInstallation();
  const body = {
    schemaVersion: TOOLCHAIN_RECEIPT_SCHEMA,
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
      installationKind: edgeTruth.manifest.installationKind,
      version: EXPECTED_EDGE_VERSION,
      applicationRootPathDigest: edgeTruth.applicationRootPathDigest,
      sourceManifestSchemaVersion: edgeTruth.manifest.schemaVersion,
      sourceManifestDigest: edgeTruth.manifest.manifestDigest,
      sourceManifestFileSha256: EXPECTED_EDGE_MANIFEST_FILE_DIGEST,
      sourceMsiUrl: edgeTruth.manifest.sourceMsiUrl,
      sourceMsiDigest: edgeTruth.manifest.sourceMsiSha256,
      sourceMsiPublishedAt: edgeTruth.manifest.sourceMsiPublishedAt,
      provisionedAt: edgeTruth.manifest.provisionedAt,
      executableDigest: EXPECTED_EDGE_EXE_DIGEST,
      engineDllDigest: EXPECTED_EDGE_DLL_DIGEST,
      visualElementsManifestDigest: EXPECTED_EDGE_VISUAL_MANIFEST_DIGEST,
      proxyExecutableDigest: EXPECTED_EDGE_PROXY_DIGEST,
      pwaHelperExecutableDigest: EXPECTED_EDGE_PWA_HELPER_DIGEST,
      versionDirectoryDigest: edgeTruth.versionReceipt.digest,
      versionDirectoryFileCount: edgeTruth.versionReceipt.fileCount,
      versionDirectoryByteCount: edgeTruth.versionReceipt.byteCount,
      applicationDirectoryDigest: edgeTruth.applicationReceipt.digest,
      applicationDirectoryCount: edgeTruth.applicationReceipt.directoryCount,
      applicationFileCount: edgeTruth.applicationReceipt.fileCount,
      applicationByteCount: edgeTruth.applicationReceipt.byteCount,
    },
  };
  return {
    ...body,
    proofDigest: createHash("sha256").update(`${TOOLCHAIN_RECEIPT_SCHEMA}\n${stableStringify(body)}`).digest("hex"),
  };
}

function invokeFilesystemPolicyFixturePowerShell(script, args) {
  const powerShell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const result = spawnSync(powerShell, [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-Command", `& { $ErrorActionPreference='Stop';Set-StrictMode -Version Latest;${script} }`, ...args,
  ], { encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 65_536 });
  assert.equal(result.status, 0, `filesystem policy fixture mutation failed: ${result.stderr}`);
  assert.equal(result.stderr, "");
}

async function createFilesystemPolicyFixture(base, {
  reparseDescendant = false,
  extraToolchainsSibling = false,
  extraEdgeSibling = false,
} = {}) {
  const toolchainsRoot = join(base, "NovelRC62Toolchains");
  const edgeRoot = join(toolchainsRoot, "Edge");
  const toolchainRoot = join(edgeRoot, EXPECTED_EDGE_VERSION);
  const applicationRoot = join(toolchainRoot, "Application");
  await mkdir(applicationRoot, { recursive: true });
  await writeFile(join(applicationRoot, "value.bin"), "sealed", "utf8");
  if (extraToolchainsSibling) await mkdir(join(toolchainsRoot, "unexpected"));
  if (extraEdgeSibling) await mkdir(join(edgeRoot, "unexpected"));
  if (reparseDescendant) {
    const target = join(base, "reparse-target");
    await mkdir(target);
    await symlink(target, join(applicationRoot, "linked"), process.platform === "win32" ? "junction" : "dir");
  }
  invokeFilesystemPolicyFixturePowerShell(String.raw`
$root=[IO.Path]::GetFullPath($args[0]);$edge=[IO.Path]::GetDirectoryName($root);$toolchains=[IO.Path]::GetDirectoryName($edge);$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$icacls=Join-Path $env:SystemRoot 'System32\icacls.exe'
foreach($sealedRoot in @($toolchains,$edge,$root)){& $icacls $sealedRoot '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)' "*$($sid):(OI)(CI)(RX)" | Out-Null;if($LASTEXITCODE-ne 0){exit 31}}
foreach($entry in @(Get-ChildItem -LiteralPath $root -Force -Recurse|Sort-Object {$_.FullName.Length})){& $icacls $entry.FullName '/inheritance:e'|Out-Null;if($LASTEXITCODE-ne 0){exit 32}}
`, [toolchainRoot]);
  return { toolchainsRoot, edgeRoot, toolchainRoot };
}

function unsealFilesystemPolicyFixture(toolchainRoot) {
  invokeFilesystemPolicyFixturePowerShell(String.raw`
$root=[IO.Path]::GetFullPath($args[0]);$edge=[IO.Path]::GetDirectoryName($root);$toolchains=[IO.Path]::GetDirectoryName($edge);$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$icacls=Join-Path $env:SystemRoot 'System32\icacls.exe';& $icacls $toolchains '/grant:r' "*$($sid.Value):(OI)(CI)(F)" '/T' '/C' | Out-Null;if($LASTEXITCODE-ne 0){exit 33}
`, [toolchainRoot]);
}

async function assertTaskOwnedEdgeFilesystemPolicyMutations() {
  const cases = [
    ["unprotected root", String.raw`$icacls=Join-Path $env:SystemRoot 'System32\icacls.exe';& $icacls $args[0] '/inheritance:e'|Out-Null;if($LASTEXITCODE-ne 0){exit 34}`],
    ["current-user write ACE", String.raw`$icacls=Join-Path $env:SystemRoot 'System32\icacls.exe';$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;& $icacls $args[0] '/grant' "*$($sid):(OI)(CI)(W)"|Out-Null;if($LASTEXITCODE-ne 0){exit 35}`],
    ["explicit descendant DACL", String.raw`$icacls=Join-Path $env:SystemRoot 'System32\icacls.exe';& $icacls (Join-Path $args[0] 'Application') '/inheritance:d'|Out-Null;if($LASTEXITCODE-ne 0){exit 36}`],
  ];
  for (const [label, mutation] of cases) {
    const base = await mkdtemp(join(tmpdir(), "novel-rc6-2-edge-acl-"));
    let paths;
    try {
      paths = await createFilesystemPolicyFixture(base);
      assertTaskOwnedEdgeFilesystemPolicy(paths, 2);
      invokeFilesystemPolicyFixturePowerShell(mutation, [paths.toolchainRoot]);
      assert.throws(() => assertTaskOwnedEdgeFilesystemPolicy(paths, 2), /filesystem policy failed/u, label);
    } finally {
      if (paths) unsealFilesystemPolicyFixture(paths.toolchainRoot);
      await rm(base, { recursive: true, force: true });
    }
  }
  for (const [label, options] of [
    ["extra Toolchains sibling", { extraToolchainsSibling: true }],
    ["extra Edge sibling", { extraEdgeSibling: true }],
  ]) {
    const base = await mkdtemp(join(tmpdir(), "novel-rc6-2-edge-topology-"));
    let paths;
    try {
      paths = await createFilesystemPolicyFixture(base, options);
      assert.throws(() => assertTaskOwnedEdgeFilesystemPolicy(paths, 2), /filesystem policy failed/u, label);
    } finally {
      if (paths) unsealFilesystemPolicyFixture(paths.toolchainRoot);
      await rm(base, { recursive: true, force: true });
    }
  }
  const reparseBase = await mkdtemp(join(tmpdir(), "novel-rc6-2-edge-reparse-"));
  let reparsePaths;
  try {
    reparsePaths = await createFilesystemPolicyFixture(reparseBase, { reparseDescendant: true });
    assert.throws(() => assertTaskOwnedEdgeFilesystemPolicy(reparsePaths, 3), /filesystem policy failed/u);
  } finally {
    if (reparsePaths) unsealFilesystemPolicyFixture(reparsePaths.toolchainRoot);
    await rm(reparseBase, { recursive: true, force: true });
  }
}

async function assertTaskOwnedEdgePolicy() {
  const profileBaseline = await taskOwnedEdgeProfilePaths();
  assert.deepEqual(profileBaseline, [], "gate-owned Edge profile residue exists before task-owned policy");
  const actual = await validateTaskOwnedEdgeInstallation();
  assert.equal(actual.paths.applicationRoot, taskOwnedEdgePaths().applicationRoot);
  assert.equal(actual.manifest.manifestDigest, EXPECTED_EDGE_MANIFEST_DIGEST);
  await assertTaskOwnedEdgeFilesystemPolicyMutations();
  await assertProductionGateMutexBehavior();
  await assertSentinelSandboxObservationBehavior();
  await assertSentinelCleanupSafetyBehavior();
  const root = await mkdtemp(join(tmpdir(), "novel-rc6-2-edge-policy-"));
  try {
    const manifestCopy = join(root, "toolchain-manifest.json");
    await copyFile(actual.paths.manifestPath, manifestCopy);
    assert.deepEqual(await readTaskOwnedEdgeManifest(manifestCopy), actual.manifest);

    const hardlinkSource = join(root, "manifest-hardlink-source.json");
    const hardlinkTarget = join(root, "manifest-hardlink-target.json");
    await copyFile(actual.paths.manifestPath, hardlinkSource);
    await link(hardlinkSource, hardlinkTarget);
    await assert.rejects(
      readTaskOwnedEdgeManifest(hardlinkTarget),
      /must not be hardlinked/u,
    );

    const manifestRace = join(root, "manifest-race.json");
    await copyFile(actual.paths.manifestPath, manifestRace);
    await assert.rejects(
      readTaskOwnedEdgeManifest(manifestRace, {
        afterRead: async (path) => writeFile(path, "changed-during-read", "utf8"),
      }),
      /changed while read/u,
    );

    const tree = join(root, "tree");
    await mkdir(join(tree, "nested"), { recursive: true });
    await writeFile(join(tree, "nested", "value.bin"), "sealed-value", "utf8");
    assert.deepEqual(await completeTreeReceipt(tree), {
      directoryCount: 1,
      fileCount: 1,
      byteCount: 12,
      digest: createHash("sha256")
        .update("nested/value.bin\0" + "12\0" + "sealed-value")
        .digest("hex"),
    });

    const hardlinkTree = join(root, "hardlink-tree");
    await mkdir(hardlinkTree);
    await writeFile(join(hardlinkTree, "source.bin"), "sealed", "utf8");
    await link(join(hardlinkTree, "source.bin"), join(hardlinkTree, "alias.bin"));
    await assert.rejects(completeTreeReceipt(hardlinkTree), /hardlinked file/u);

    const reparseTarget = join(root, "reparse-target");
    const reparseTree = join(root, "reparse-tree");
    await mkdir(reparseTarget);
    await symlink(reparseTarget, reparseTree, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(completeTreeReceipt(reparseTree), /link or reparse path/u);

    const raceTree = join(root, "race-tree");
    await mkdir(raceTree);
    await writeFile(join(raceTree, "value.bin"), "before", "utf8");
    let mutated = false;
    await assert.rejects(
      completeTreeReceipt(raceTree, {
        afterFileRead: async (path) => {
          if (!mutated) {
            mutated = true;
            await writeFile(path, "changed-during-tree-read", "utf8");
          }
        },
      }),
      /changed while read/u,
    );

    const oversizeTree = join(root, "oversize-tree");
    await mkdir(oversizeTree);
    await writeFile(join(oversizeTree, "value.bin"), "123456789", "utf8");
    await assert.rejects(
      completeTreeReceipt(oversizeTree, { maxByteCount: 8 }),
      /exceeds its byte cap/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  assert.deepEqual(
    await taskOwnedEdgeProfilePaths(),
    profileBaseline,
    "task-owned Edge policy leaked a gate-owned profile fixture",
  );
}

function parseExactProcessInventory(result, label) {
  assert.equal(result.status, 0, `${label} failed`);
  assert.equal(result.stderr, "");
  const records = JSON.parse(result.stdout.trim());
  assert.ok(Array.isArray(records));
  for (const record of records) {
    assertExactKeys(record, ["pid", "parentPid", "creationDate", "executablePath", "commandLineDigest"], label);
    assert.ok(Number.isSafeInteger(record.pid) && record.pid > 0);
    assert.ok(Number.isSafeInteger(record.parentPid) && record.parentPid >= 0);
    assert.match(record.creationDate, UTC_MILLISECONDS);
    assert.equal(new Date(record.creationDate).toISOString(), record.creationDate);
    assert.equal(isAbsolute(record.executablePath), true);
    assertSha256(record.commandLineDigest, `${label} command line`);
  }
  assert.deepEqual(records.map(({ pid }) => pid), [...records.map(({ pid }) => pid)].sort((left, right) => left - right));
  return records;
}

function taskOwnedEdgeProcesses(executablePath) {
  const powerShell = join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32", "WindowsPowerShell", "v1.0", "powershell.exe",
  );
  const script = [
    "$ErrorActionPreference='Stop'",
    "$target=[IO.Path]::GetFullPath($args[0])",
    "$sha=[Security.Cryptography.SHA256]::Create()",
    "try{$records=@(Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\"|Where-Object{$_.ExecutablePath -and [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath([string]$_.ExecutablePath),$target)}|Sort-Object ProcessId|ForEach-Object{$cmd=[string]$_.CommandLine;$digest=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($cmd)))).Replace('-','').ToLowerInvariant();[ordered]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;creationDate=([DateTime]$_.CreationDate).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ');executablePath=[IO.Path]::GetFullPath([string]$_.ExecutablePath);commandLineDigest=$digest}})}finally{$sha.Dispose()}",
    "ConvertTo-Json -Compress -InputObject @($records)",
  ].join(";");
  const result = spawnSync(powerShell, [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-Command", `& { ${script} }`, executablePath,
  ], { encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 65_536 });
  return parseExactProcessInventory(result, "task-owned Edge process inventory");
}

async function taskOwnedEdgeProfilePaths() {
  const temporaryRoot = resolve(tmpdir());
  const entries = await readdir(temporaryRoot, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    if (!/^novel-rc6-2-edge-[A-Za-z0-9][A-Za-z0-9-]{4,62}[A-Za-z0-9]$/u.test(entry.name)) continue;
    assert.equal(entry.isDirectory() && !entry.isSymbolicLink(), true, "gate-owned Edge profile is not a plain directory");
    const path = join(temporaryRoot, entry.name);
    assert.equal(comparableFilesystemPath(await realpath(path)), comparableFilesystemPath(path));
    matches.push(path);
  }
  return matches.sort((left, right) => left.localeCompare(right, "en"));
}

function expectedNetworkSentinelRunnerCommandLines(runnerPath) {
  const node = resolve(process.execPath);
  const runner = resolve(runnerPath);
  return Object.freeze([
    `"${node}" "${runner}" network-sentinel-only`,
    `"${node}" ${runner} network-sentinel-only`,
    `${node} ${runner} network-sentinel-only`,
  ]);
}

function exactNetworkSentinelRunnerProcesses(runnerPath) {
  const powerShell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = [
    "$node=[IO.Path]::GetFullPath($args[0])",
    "$runner=[IO.Path]::GetFullPath($args[1])",
    "$runnerSpellings=@($runner,[string]$args[2],[string]$args[3])",
    "$expected=@();foreach($nodeSpelling in @($node,'\"'+$node+'\"')){foreach($runnerSpelling in $runnerSpellings){foreach($runnerArgument in @($runnerSpelling,'\"'+$runnerSpelling+'\"')){$expected+=($nodeSpelling+' '+$runnerArgument+' network-sentinel-only')}}}",
    "$sha=[Security.Cryptography.SHA256]::Create()",
    "try{$records=@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\"|Where-Object{$_.ExecutablePath -and $_.CommandLine -and [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath([string]$_.ExecutablePath),$node) -and $expected -contains ([string]$_.CommandLine).Trim()}|Sort-Object ProcessId|ForEach-Object{$cmd=([string]$_.CommandLine).Trim();$digest=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($cmd)))).Replace('-','').ToLowerInvariant();[ordered]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;creationDate=([DateTime]$_.CreationDate).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ');executablePath=[IO.Path]::GetFullPath([string]$_.ExecutablePath);commandLineDigest=$digest}})}finally{$sha.Dispose()}",
    "ConvertTo-Json -Compress -InputObject @($records)",
  ].join(";");
  const result = spawnSync(powerShell, [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-Command", `& { ${script} }`, process.execPath, resolve(runnerPath),
    "scripts\\run-rc6-2-closed-agent-browser.mjs", "scripts/run-rc6-2-closed-agent-browser.mjs",
  ], { encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 65_536 });
  return parseExactProcessInventory(result, "network sentinel runner process inventory");
}

function processIdentity(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const powerShell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = String.raw`
$p=Get-CimInstance Win32_Process -Filter ("ProcessId="+[int]$args[0]);if($null-eq$p){'null';exit 0}
$sha=[Security.Cryptography.SHA256]::Create();try{$cmd=[string]$p.CommandLine;$digest=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($cmd)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
[ordered]@{pid=[int]$p.ProcessId;parentPid=[int]$p.ParentProcessId;creationDate=([DateTime]$p.CreationDate).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ');executablePath=[IO.Path]::GetFullPath([string]$p.ExecutablePath);commandLineDigest=$digest}|ConvertTo-Json -Compress
`;
  const result = spawnSync(powerShell, [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-Command", `& { ${script} }`, String(pid),
  ], { encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 65_536 });
  assert.equal(result.status, 0, `process identity read failed for ${pid}`);
  assert.equal(result.stderr, "");
  const identity = JSON.parse(result.stdout.trim());
  if (identity === null) return null;
  assert.deepEqual(Object.keys(identity), ["pid", "parentPid", "creationDate", "executablePath", "commandLineDigest"]);
  assert.equal(identity.pid, pid);
  assert.match(identity.creationDate, UTC_MILLISECONDS);
  assert.match(identity.commandLineDigest, /^[a-f0-9]{64}$/u);
  return identity;
}

function stopExactProcessTree(pid, expectedIdentity = null) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const before = processIdentity(pid);
  if (before === null) return false;
  if (expectedIdentity !== null) assert.deepEqual(before, expectedIdentity, `process identity changed before cleanup: ${pid}`);
  const taskkill = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
  const result = spawnSync(taskkill, ["/PID", String(pid), "/T", "/F"], {
    encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 65_536,
  });
  if (processIdentity(pid) !== null) {
    assert.equal(result.status, 0, `failed to stop exact runner process tree ${pid}`);
    assert.fail(`runner process ${pid} survived cleanup`);
  }
  return true;
}

async function removeExactSentinelSandbox(sandboxPath, expectedIdentity) {
  const canonical = resolve(sandboxPath);
  assert.equal(comparableFilesystemPath(dirname(canonical)), comparableFilesystemPath(resolve(tmpdir())));
  assert.match(basename(canonical), /^novel-rc6-2-sentinel-[A-Za-z0-9_-]{6}$/u);
  const current = await lstat(canonical);
  assert.equal(current.isDirectory() && !current.isSymbolicLink(), true);
  assert.equal(sameDirectoryIdentity(current, expectedIdentity), true, "sentinel sandbox identity changed before deletion");
  assert.equal(comparableFilesystemPath(await realpath(canonical)), comparableFilesystemPath(canonical));
  for (const entry of await readdir(canonical, { recursive: true, withFileTypes: true })) {
    assert.equal(entry.isSymbolicLink(), false, "sentinel sandbox contains a link");
  }
  const final = await lstat(canonical);
  assert.equal(final.isDirectory() && !final.isSymbolicLink(), true);
  assert.equal(sameDirectoryIdentity(final, expectedIdentity), true, "sentinel sandbox identity changed immediately before deletion");
  assert.equal(comparableFilesystemPath(await realpath(canonical)), comparableFilesystemPath(canonical));
  await rm(canonical, { recursive: true, force: true });
  await assert.rejects(lstat(canonical), (error) => error?.code === "ENOENT");
}

async function assertSentinelSandboxObservationBehavior() {
  const sandboxPath = await mkdtemp(join(resolve(tmpdir()), "novel-rc6-2-sentinel-"));
  const sandboxIdentity = await lstat(sandboxPath);
  try {
    assert.equal(await observeSentinelProfile(sandboxPath, null), null);
    const profilePath = join(sandboxPath, "novel-rc6-2-edge-Abc123");
    await mkdir(profilePath);
    const first = await observeSentinelProfile(sandboxPath, null);
    assert.equal(first.profilePath, await realpath(profilePath));
    await writeFile(join(profilePath, "runtime-write.bin"), "bounded", "utf8");
    assert.equal(await observeSentinelProfile(sandboxPath, first), first);
    const unexpectedPath = join(sandboxPath, "unexpected");
    await mkdir(unexpectedPath);
    assert.equal(await observeSentinelProfile(sandboxPath, first), first);
    const duplicateProfilePath = join(sandboxPath, "novel-rc6-2-edge-Dup456");
    await mkdir(duplicateProfilePath);
    await assert.rejects(observeSentinelProfile(sandboxPath, first), /multiple runner profiles/u);
    await rm(duplicateProfilePath, { recursive: true, force: true });
    await rm(unexpectedPath, { recursive: true, force: true });
  } finally {
    await removeExactSentinelSandbox(sandboxPath, sandboxIdentity);
  }

  const ancillarySandbox = await mkdtemp(join(resolve(tmpdir()), "novel-rc6-2-sentinel-"));
  const ancillarySandboxIdentity = await lstat(ancillarySandbox);
  const ancillaryTarget = await mkdtemp(join(resolve(tmpdir()), "novel-rc6-2-sentinel-target-"));
  const ancillaryMarker = join(ancillaryTarget, "must-survive.txt");
  const ancillaryJunction = join(ancillarySandbox, "ancillary-junction");
  try {
    await writeFile(ancillaryMarker, "untouched", "utf8");
    await symlink(
      ancillaryTarget,
      ancillaryJunction,
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(
      observeSentinelProfile(ancillarySandbox, null),
      /direct link|reparse target/u,
    );
    assert.equal(await readFile(ancillaryMarker, "utf8"), "untouched");
  } finally {
    await rm(ancillaryJunction, { recursive: true, force: true });
    await removeExactSentinelSandbox(ancillarySandbox, ancillarySandboxIdentity);
    assert.equal(await readFile(ancillaryMarker, "utf8"), "untouched");
    await rm(ancillaryTarget, { recursive: true, force: true });
  }

  const boundedSandbox = await mkdtemp(join(resolve(tmpdir()), "novel-rc6-2-sentinel-"));
  const boundedSandboxIdentity = await lstat(boundedSandbox);
  try {
    await Promise.all(Array.from({ length: 65 }, (_, index) => (
      writeFile(join(boundedSandbox, `ancillary-${String(index).padStart(2, "0")}.tmp`), "x", "utf8")
    )));
    await assert.rejects(
      observeSentinelProfile(boundedSandbox, null),
      /direct-child bound/u,
    );
  } finally {
    await removeExactSentinelSandbox(boundedSandbox, boundedSandboxIdentity);
  }
}

async function assertSentinelCleanupSafetyBehavior() {
  const reparseSandbox = await mkdtemp(join(resolve(tmpdir()), "novel-rc6-2-sentinel-"));
  const reparseSandboxIdentity = await lstat(reparseSandbox);
  const externalTarget = await mkdtemp(join(resolve(tmpdir()), "novel-rc6-2-sentinel-target-"));
  const markerPath = join(externalTarget, "must-survive.txt");
  const junctionPath = join(reparseSandbox, "novel-rc6-2-edge-Abc123");
  try {
    await writeFile(markerPath, "untouched", "utf8");
    await symlink(externalTarget, junctionPath, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(
      removeExactSentinelSandbox(reparseSandbox, reparseSandboxIdentity),
      /contains a link/u,
    );
    assert.equal(await readFile(markerPath, "utf8"), "untouched");
  } finally {
    await rm(junctionPath, { recursive: true, force: true });
    await removeExactSentinelSandbox(reparseSandbox, reparseSandboxIdentity);
    assert.equal(await readFile(markerPath, "utf8"), "untouched");
    await rm(externalTarget, { recursive: true, force: true });
  }

  const replacementPath = await mkdtemp(join(resolve(tmpdir()), "novel-rc6-2-sentinel-"));
  const replacementIdentity = await lstat(replacementPath);
  const originalMovedPath = `${replacementPath}-original`;
  try {
    await rename(replacementPath, originalMovedPath);
    await mkdir(replacementPath);
    await assert.rejects(
      removeExactSentinelSandbox(replacementPath, replacementIdentity),
      /identity changed/u,
    );
    assert.equal((await lstat(replacementPath)).isDirectory(), true);
  } finally {
    await rm(replacementPath, { recursive: true, force: true });
    await rm(originalMovedPath, { recursive: true, force: true });
  }

  const selfIdentity = processIdentity(process.pid);
  assert.ok(selfIdentity);
  assert.throws(
    () => stopExactProcessTree(process.pid, { ...selfIdentity, commandLineDigest: "0".repeat(64) }),
    /process identity changed/u,
  );
  assert.deepEqual(processIdentity(process.pid), selfIdentity, "identity mismatch attempted to kill the protected process");

  const fastRoot = await mkdtemp(join(resolve(tmpdir()), "novel-rc6-2-fast-child-"));
  const fastSandbox = await mkdtemp(join(resolve(tmpdir()), "novel-rc6-2-sentinel-"));
  const fastSandboxIdentity = await lstat(fastSandbox);
  try {
    const fastRunner = join(fastRoot, "fast-exit.mjs");
    await writeFile(fastRunner, "process.stdout.write('fast-exit\\n');", "utf8");
    const started = Date.now();
    let fastDeadline;
    const outcome = await Promise.race([
      runBoundedNetworkSentinelChild(fastRunner, {
        SystemRoot: process.env.SystemRoot,
        PATH: process.env.PATH,
        TEMP: fastSandbox,
        TMP: fastSandbox,
      }, fastSandbox).then((value) => ({ value }), (error) => ({ error })),
      new Promise((_, rejectPromise) => {
        fastDeadline = setTimeout(
          () => rejectPromise(new Error("fast-exit sentinel child did not settle")),
          10_000,
        );
      }),
    ]).finally(() => clearTimeout(fastDeadline));
    assert.ok(Date.now() - started < 10_000);
    if (outcome.value) {
      assert.equal(outcome.value.code, 0);
      assert.equal(outcome.value.stdoutBytes.toString("utf8"), "fast-exit\n");
    } else assert.ok(outcome.error instanceof Error);
  } finally {
    await removeExactSentinelSandbox(fastSandbox, fastSandboxIdentity);
    await rm(fastRoot, { recursive: true, force: true });
  }
}

async function observeSentinelProfile(sandboxPath, priorObservation) {
  const entries = await readdir(sandboxPath, { withFileTypes: true });
  assert.ok(entries.length <= 64, "sentinel sandbox exceeded its direct-child bound");
  const observedEntries = [];
  for (const entry of entries) {
    const entryPath = resolve(sandboxPath, entry.name);
    assert.equal(
      comparableFilesystemPath(dirname(entryPath)),
      comparableFilesystemPath(sandboxPath),
      "sentinel sandbox direct child escaped containment",
    );
    let truth;
    try {
      truth = await lstat(entryPath);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    assert.equal(
      entry.isSymbolicLink() || truth.isSymbolicLink(),
      false,
      "sentinel sandbox contained a direct link",
    );
    assert.equal(
      (entry.isDirectory() && truth.isDirectory()) || (entry.isFile() && truth.isFile()),
      true,
      "sentinel sandbox contained an unsupported direct child",
    );
    let canonicalEntryPath;
    try {
      canonicalEntryPath = await realpath(entryPath);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    assert.equal(
      comparableFilesystemPath(canonicalEntryPath),
      comparableFilesystemPath(entryPath),
      "sentinel sandbox direct child resolved through a reparse target",
    );
    observedEntries.push(entry);
  }
  const profiles = observedEntries.filter((entry) => (
    /^novel-rc6-2-edge-[A-Za-z0-9][A-Za-z0-9-]{4,62}[A-Za-z0-9]$/u.test(entry.name)
  ));
  assert.ok(profiles.length <= 1, "sentinel sandbox contained multiple runner profiles");
  if (profiles.length === 0) return priorObservation;
  const [entry] = profiles;
  assert.equal(entry.isDirectory() && !entry.isSymbolicLink(), true, "sentinel profile was not a plain directory");
  const profilePath = resolve(sandboxPath, entry.name);
  assert.equal(comparableFilesystemPath(dirname(profilePath)), comparableFilesystemPath(sandboxPath));
  const identity = await lstat(profilePath);
  assert.equal(identity.isDirectory() && !identity.isSymbolicLink(), true);
  const canonicalPath = await realpath(profilePath);
  assert.equal(comparableFilesystemPath(canonicalPath), comparableFilesystemPath(profilePath));
  const observation = { profilePath: canonicalPath, identity };
  if (priorObservation !== null) {
    assert.equal(comparableFilesystemPath(priorObservation.profilePath), comparableFilesystemPath(observation.profilePath));
    assert.equal(sameDirectoryIdentity(priorObservation.identity, observation.identity), true, "sentinel profile identity changed while observed");
    return priorObservation;
  }
  return observation;
}

async function runBoundedNetworkSentinelChild(runnerPath, cleanEnvironment, sandboxPath) {
  const spawnedAt = Date.now();
  let childIdentity = null;
  let profileObservation = null;
  let observerDone = false;
  let observerError = null;
  const stdoutChunks = [];
  const stderrChunks = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let timedOut = false;
  let overflow = false;
  let terminationError = null;
  let rejectTerminationDeadline;
  let terminationTimer;
  const terminationDeadline = new Promise((_, rejectPromise) => { rejectTerminationDeadline = rejectPromise; });
  let terminationRequested = false;
  let terminationAttempted = false;
  let child;
  const attemptIdentityBoundTermination = () => {
    if (!terminationRequested || terminationAttempted || childIdentity === null) return;
    terminationAttempted = true;
    try {
      if (processIdentity(child.pid) !== null) stopExactProcessTree(child.pid, childIdentity);
    } catch (error) {
      terminationError ??= error;
    }
  };
  const terminate = () => {
    if (!terminationRequested) {
      terminationRequested = true;
      terminationTimer = setTimeout(
        () => rejectTerminationDeadline(new Error("network sentinel child did not close after termination")),
        15_000,
      );
    }
    attemptIdentityBoundTermination();
  };
  const append = (chunks, chunk, currentBytes, limit) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const next = currentBytes + bytes.length;
    if (next > limit) {
      overflow = true;
      terminate();
    }
    else chunks.push(bytes);
    return next;
  };
  const assertSpawnedChildIdentity = (identity) => {
    assert.ok(identity);
    assert.equal(identity.parentPid, process.pid, "sentinel runner parent PID drifted");
    assert.equal(comparableFilesystemPath(identity.executablePath), comparableFilesystemPath(process.execPath));
    const creationTime = Date.parse(identity.creationDate);
    assert.ok(creationTime >= spawnedAt - 1_000 && creationTime <= Date.now() + 1_000, "sentinel runner creation time escaped spawn window");
    const expectedDigests = expectedNetworkSentinelRunnerCommandLines(runnerPath)
      .map((value) => createHash("sha256").update(value).digest("hex"));
    assert.equal(expectedDigests.includes(identity.commandLineDigest), true, "sentinel runner argv digest drifted");
  };
  let timer = null;
  let observer = null;
  try {
    child = spawn(process.execPath, [runnerPath, "network-sentinel-only"], {
      cwd: repositoryRoot, env: cleanEnvironment, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    const spawned = new Promise((resolvePromise) => {
      child.once("spawn", () => resolvePromise({ error: null }));
      child.once("error", (error) => resolvePromise({ error }));
    });
    const close = new Promise((resolvePromise) => {
      child.once("error", (error) => resolvePromise({ code: null, signal: null, error }));
      child.once("close", (code, signal) => resolvePromise({ code, signal, error: null }));
    });
    child.stdout.on("data", (chunk) => { stdoutBytes = append(stdoutChunks, chunk, stdoutBytes, 1_048_576); });
    child.stderr.on("data", (chunk) => { stderrBytes = append(stderrChunks, chunk, stderrBytes, 65_536); });
    timer = setTimeout(() => { timedOut = true; terminate(); }, 600_000);
    observer = (async () => {
      while (!observerDone) {
        try { profileObservation = await observeSentinelProfile(sandboxPath, profileObservation); }
        catch (error) { observerError ??= error; terminate(); }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
      }
    })();
    const spawnResult = await spawned;
    if (spawnResult.error) throw spawnResult.error;
    childIdentity = processIdentity(child.pid);
    assertSpawnedChildIdentity(childIdentity);
    attemptIdentityBoundTermination();
    const exit = await Promise.race([close, terminationDeadline]);
    observerDone = true;
    await observer;
    if (observerError) throw observerError;
    if (terminationError) throw terminationError;
    if (exit.error) throw exit.error;
    assert.equal(processIdentity(child.pid), null, "network sentinel runner process remained after close");
    return {
      pid: child.pid, childIdentity, profileObservation, timedOut, overflow, ...exit,
      stdoutBytes: Buffer.concat(stdoutChunks),
      stderrBytes: Buffer.concat(stderrChunks),
    };
  } finally {
    observerDone = true;
    if (timer) clearTimeout(timer);
    if (terminationTimer) clearTimeout(terminationTimer);
    if (observer) await observer;
    if (child?.pid) {
      const current = processIdentity(child.pid);
      if (current !== null && childIdentity === null) {
        assertSpawnedChildIdentity(current);
        childIdentity = current;
      }
      if (childIdentity !== null && processIdentity(child.pid) !== null) stopExactProcessTree(child.pid, childIdentity);
      assert.equal(processIdentity(child.pid), null, "network sentinel runner cleanup was incomplete");
    }
  }
}

async function acquireProductionGateMutex(name = "Global\\NovelRC62ProductionBrowserGate") {
  assert.match(name, /^Global\\NovelRC62ProductionBrowserGate(?:Contract-[a-f0-9]{32})?$/u);
  const powerShell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = String.raw`
$ErrorActionPreference='Stop';$mutex=$null;$held=$false
try{$mutex=[Threading.Mutex]::new($false,[string]$args[0]);try{$held=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$held=$true};if(-not$held){[Console]::Out.WriteLine('BUSY');[Console]::Out.Flush();[void][Console]::In.ReadLine();exit 23};[Console]::Out.WriteLine('ACQUIRED');[Console]::Out.Flush();[void][Console]::In.ReadLine()}
catch{throw}
finally{if($held){$mutex.ReleaseMutex()};if($null-ne$mutex){$mutex.Dispose()}}
`;
  const child = spawn(powerShell, [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-Command", `& { ${script} }`, name,
  ], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  await new Promise((resolvePromise, rejectPromise) => {
    child.once("spawn", resolvePromise);
    child.once("error", rejectPromise);
  });
  const helperIdentity = processIdentity(child.pid);
  assert.ok(helperIdentity, "production gate mutex helper identity was unavailable");
  assert.equal(helperIdentity.parentPid, process.pid);
  assert.equal(comparableFilesystemPath(helperIdentity.executablePath), comparableFilesystemPath(powerShell));
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(0, 65_536); });
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(0, 65_536); });
  try {
    await new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => rejectPromise(new Error("production gate mutex acquisition timed out")), 10_000);
      const inspect = () => {
        if (stdout.includes("ACQUIRED\n") || stdout.includes("ACQUIRED\r\n")) {
          clearTimeout(timer);
          resolvePromise();
        }
        else if (stdout.includes("BUSY\n") || stdout.includes("BUSY\r\n")) {
          clearTimeout(timer);
          rejectPromise(new Error("production gate mutex is already held"));
        }
      };
      child.stdout.on("data", inspect);
      child.once("error", (error) => { clearTimeout(timer); rejectPromise(error); });
      child.once("exit", (code) => {
        if (!stdout.includes("ACQUIRED")) {
          clearTimeout(timer);
          rejectPromise(new Error(code === 23 ? "production gate mutex is already held" : `production gate mutex helper failed: ${stderr}`));
        }
      });
    });
  } catch (error) {
    if (processIdentity(child.pid) !== null) stopExactProcessTree(child.pid, helperIdentity);
    assert.equal(processIdentity(child.pid), null, "mutex helper survived failed acquisition");
    throw error;
  }
  return {
    child, helperIdentity,
    async release() {
      try {
        if (child.exitCode !== null) assert.fail("production gate mutex helper exited before release");
        child.stdin.end("RELEASE\n");
        const code = await new Promise((resolvePromise, rejectPromise) => {
          const timer = setTimeout(() => rejectPromise(new Error("production gate mutex release timed out")), 10_000);
          child.once("error", (error) => { clearTimeout(timer); rejectPromise(error); });
          child.once("exit", (exitCode) => { clearTimeout(timer); resolvePromise(exitCode); });
        });
        assert.equal(code, 0, `production gate mutex helper release failed: ${stderr}`);
        assert.equal(stderr, "");
      } catch (error) {
        if (processIdentity(child.pid) !== null) stopExactProcessTree(child.pid, helperIdentity);
        throw error;
      } finally {
        assert.equal(processIdentity(child.pid), null, "mutex helper survived release");
      }
    },
  };
}

async function assertProductionGateMutexBehavior() {
  const name = `Global\\NovelRC62ProductionBrowserGateContract-${createHash("sha256").update(String(Date.now()) + Math.random()).digest("hex").slice(0, 32)}`;
  const first = await acquireProductionGateMutex(name);
  try {
    await assert.rejects(acquireProductionGateMutex(name), /already held/u);
  } finally {
    await first.release();
  }
  const second = await acquireProductionGateMutex(name);
  await second.release();
  stopExactProcessTree(process.pid + 1_000_000_000);
  stopExactProcessTree(process.pid + 1_000_000_000);
  const timeoutStub = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    stdio: "ignore", windowsHide: true,
  });
  await new Promise((resolvePromise, rejectPromise) => {
    timeoutStub.once("spawn", resolvePromise);
    timeoutStub.once("error", rejectPromise);
  });
  const timeoutIdentity = processIdentity(timeoutStub.pid);
  assert.ok(timeoutIdentity);
  assert.equal(stopExactProcessTree(timeoutStub.pid, timeoutIdentity), true);
  assert.equal(stopExactProcessTree(timeoutStub.pid, timeoutIdentity), false);
}

const NETWORK_SENTINEL_ONLY_EVIDENCE_KEYS = Object.freeze([
  "schemaVersion", "status", "mode", "networkZeroReceipt", "freshBrowserContext",
  "profileOwnership", "profilePathDigest", "edgeIdentity", "profileDisposed", "completedAt",
]);
const NETWORK_SENTINEL_ONLY_EDGE_IDENTITY_KEYS = Object.freeze([
  "executableName", "executableDigest", "persistentContext", "disposableProfile",
  "profileOwnership", "profileEntryCountBeforeLaunch", "profilePathDigest",
  "webSocketRouteInstalledBeforeNavigation", "product", "engineVersionDirectoryName",
  "engineDllName", "engineDllDigest", "protocolVersion", "browserRevisionDigest",
  "userAgentProductVerified", "preNavigationNetworkSentinel",
]);

function parseCanonicalNetworkSentinelEvidence(bytes) {
  assert.ok(Buffer.isBuffer(bytes));
  assert.ok(bytes.length > 0 && bytes.length <= 1_048_576);
  assert.equal(
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
    false,
    "sentinel evidence contained a UTF-8 BOM",
  );
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assert.equal(text.startsWith("\uFEFF"), false, "sentinel evidence contained a BOM");
  assert.equal(text.includes("\0"), false, "sentinel evidence contained NUL");
  assert.equal(text.includes("\uFFFD"), false, "sentinel evidence contained a replacement character");
  assert.equal(text.includes("\r"), false, "sentinel evidence contained CR bytes");
  assert.equal(text.endsWith("\n"), true, "sentinel evidence lacked its single terminal LF");
  const jsonText = text.slice(0, -1);
  assert.equal(jsonText.endsWith("\n") || /\s$/u.test(jsonText), false, "sentinel evidence had trailing whitespace");
  const evidence = JSON.parse(jsonText);
  assert.equal(`${JSON.stringify(evidence, null, 2)}\n`, text, "sentinel evidence was not canonical pretty JSON");
  return evidence;
}

function validateNetworkSentinelOnlyEvidence(evidence, profileObservation, startedAt, completedBy) {
  assertExactKeys(evidence, NETWORK_SENTINEL_ONLY_EVIDENCE_KEYS, "network sentinel-only evidence");
  assert.equal(evidence.schemaVersion, "p24b-rc6.2-network-sentinel-only-evidence-v1");
  assert.equal(evidence.status, "PASS");
  assert.equal(evidence.mode, "network-sentinel-only");
  assert.equal(evidence.freshBrowserContext, true);
  assert.equal(evidence.profileOwnership, "runner-created");
  assertSha256(evidence.profilePathDigest, "sentinel profile path");
  assert.ok(profileObservation, "runner-created sentinel profile was never observed");
  assert.equal(
    evidence.profilePathDigest,
    createHash("sha256").update(profileObservation.profilePath).digest("hex"),
    "sentinel profile path digest did not bind the observed sandbox child",
  );
  assert.equal(evidence.profileDisposed, true);
  assert.match(evidence.completedAt, UTC_MILLISECONDS);
  assert.equal(new Date(evidence.completedAt).toISOString(), evidence.completedAt);
  const completedAt = Date.parse(evidence.completedAt);
  assert.ok(completedAt >= startedAt - 1_000 && completedAt <= completedBy + 1_000, "sentinel completion time escaped the run window");
  assertExactKeys(evidence.edgeIdentity, NETWORK_SENTINEL_ONLY_EDGE_IDENTITY_KEYS, "sentinel Edge identity");
  const identity = evidence.edgeIdentity;
  assert.equal(identity.executableName, "msedge.exe");
  assert.equal(identity.executableDigest, EXPECTED_EDGE_EXE_DIGEST);
  assert.equal(identity.persistentContext, true);
  assert.equal(identity.disposableProfile, true);
  assert.equal(identity.profileOwnership, "runner-created");
  assert.equal(identity.profileEntryCountBeforeLaunch, 0);
  assert.equal(identity.profilePathDigest, evidence.profilePathDigest);
  assert.equal(identity.webSocketRouteInstalledBeforeNavigation, true);
  assert.equal(identity.product, `Edg/${EXPECTED_EDGE_VERSION}`);
  assert.equal(identity.engineVersionDirectoryName, EXPECTED_EDGE_VERSION);
  assert.equal(identity.engineDllName, "msedge.dll");
  assert.equal(identity.engineDllDigest, EXPECTED_EDGE_DLL_DIGEST);
  assert.match(identity.protocolVersion, /^\d+\.\d+$/u);
  assertSha256(identity.browserRevisionDigest, "Edge browser revision");
  assert.equal(identity.userAgentProductVerified, true);
  assert.deepEqual(identity.preNavigationNetworkSentinel, evidence.networkZeroReceipt);
  assert.equal(evidence.networkZeroReceipt.status, "PASS");
  assertNetworkZeroReceipt(evidence.networkZeroReceipt);
}

async function runTaskOwnedEdgeNetworkSentinel() {
  const mutex = await acquireProductionGateMutex();
  try {
    const edge = await validateTaskOwnedEdgeInstallation();
    const runnerPath = join(repositoryRoot, "scripts", "run-rc6-2-closed-agent-browser.mjs");
    assert.deepEqual(exactNetworkSentinelRunnerProcesses(runnerPath), [], "network sentinel runner residue exists before sentinel");
    assert.deepEqual(taskOwnedEdgeProcesses(edge.paths.executablePath), [], "task-owned Edge process residue exists before sentinel");
    assert.deepEqual(await taskOwnedEdgeProfilePaths(), [], "gate-owned Edge profile residue exists before sentinel");
    const sentinelSandbox = await mkdtemp(join(resolve(tmpdir()), "novel-rc6-2-sentinel-"));
    const sentinelSandboxIdentity = await lstat(sentinelSandbox);
    const cleanEnvironment = {};
    for (const name of ["SystemRoot", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "ProgramData", "COMSPEC"]) {
      if (process.env[name]) cleanEnvironment[name] = process.env[name];
    }
    Object.assign(cleanEnvironment, {
      PATH: "C:\\Windows\\System32;C:\\Windows;C:\\Program Files\\nodejs",
      NO_COLOR: "1",
      RC6_2_CLOSED_AI_EDGE_EXECUTABLE: edge.paths.executablePath,
      RC6_2_CLOSED_AI_HEADLESS: "1",
      TEMP: sentinelSandbox,
      TMP: sentinelSandbox,
    });
    let child;
    const startedAt = Date.now();
    try {
      child = await runBoundedNetworkSentinelChild(runnerPath, cleanEnvironment, sentinelSandbox);
    } finally {
      if (child?.pid && processIdentity(child.pid) !== null) {
        stopExactProcessTree(child.pid, child.childIdentity);
      }
      await removeExactSentinelSandbox(sentinelSandbox, sentinelSandboxIdentity);
    }
    assert.deepEqual(exactNetworkSentinelRunnerProcesses(runnerPath), [], "network sentinel runner residue remains after sentinel");
    assert.deepEqual(taskOwnedEdgeProcesses(edge.paths.executablePath), [], "task-owned Edge process residue remains after sentinel");
    assert.deepEqual(await taskOwnedEdgeProfilePaths(), [], "gate-owned Edge profile residue remains after sentinel");
    assert.ok(child);
    assert.equal(child.timedOut, false, "task-owned Edge sentinel timed out");
    assert.equal(child.overflow, false, "task-owned Edge sentinel output exceeded its bound");
    const stderr = new TextDecoder("utf-8", { fatal: true }).decode(child.stderrBytes);
    assert.equal(child.code, 0, `task-owned Edge sentinel failed: ${stderr}`);
    assert.equal(child.signal, null);
    assert.equal(stderr, "");
    const evidence = parseCanonicalNetworkSentinelEvidence(child.stdoutBytes);
    validateNetworkSentinelOnlyEvidence(evidence, child.profileObservation, startedAt, Date.now());
    await writeSafeStream(process.stdout, stableStringify({
      schemaVersion: "p24b-rc6.2-task-owned-edge-network-sentinel-validation-v1", status: "PASS",
      applicationRootPathDigest: edge.applicationRootPathDigest, executableDigest: EXPECTED_EDGE_EXE_DIGEST,
      engineDllDigest: EXPECTED_EDGE_DLL_DIGEST, matrixDigest: evidence.networkZeroReceipt.matrixDigest,
      runnerExitCode: child.code, runnerResidueCount: 0, taskOwnedEdgeResidueCount: 0,
      gateOwnedProfileResidueCount: 0, profileDisposed: true,
    }));
  } finally {
    await mutex.release();
  }
}

function fixtureObservation(overrides = {}) {
  const createdAt = "2026-08-12T00:00:00.000Z";
  return {
    preflightRunId: "a".repeat(32),
    executionMode: "PreflightDryRun",
    productCommit: PRODUCT_COMMIT,
    controlCommit: "b".repeat(40),
    productionDeploymentId: EXPECTED_DEPLOYMENT_ID,
    productionOrigin: EXPECTED_ORIGIN,
    releaseTag: EXPECTED_RELEASE_TAG,
    releaseRevision: "rc6.2",
    createdAt,
    bridgeHealth: {
      status: "PASS", processAlive: true, pid: 101, protocolVersion: "novel-local-bridge/v1",
      bindAddress: "127.0.0.1", modelAvailable: true, active: 0, queued: 0,
      serverDigest: "c".repeat(64), coreDigest: "d".repeat(64),
    },
    hubHealth: {
      status: "PASS", processAlive: true, pid: 102, protocolVersion: "novel-private-hub/v1",
      bindAddress: "127.0.0.1", modelAvailable: true, active: 0, queued: 0,
      serverDigest: "e".repeat(64),
    },
    ollamaHealth: {
      status: "PASS", processAlive: true, bindAddress: "127.0.0.1", version: "0.11.10",
      idle: true, runningModelCount: 0, modelInstalled: true,
    },
    ollamaPid: 103,
    modelId: "qwen2.5:3b",
    modelDigest: "f".repeat(64),
    toolchainReceiptDigest: "1".repeat(64),
    readOnly: true,
    mutationCount: 0,
    ...overrides,
  };
}

function expectPreflightCode(callback, expectedCode) {
  assert.throws(callback, (error) => error instanceof PreflightContractError && error.code === expectedCode);
}

async function readSafeStdin() {
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += bytes.length;
    if (byteLength > 131_072) preflightReject("PREFLIGHT_CONTRACT_INPUT_INVALID");
    chunks.push(bytes);
  }
  if (byteLength === 0) preflightReject("PREFLIGHT_CONTRACT_INPUT_INVALID");
  const bytes = Buffer.concat(chunks, byteLength);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.includes("\0") || text.includes("\uFFFD") || text.startsWith("\uFEFF")) {
    preflightReject("PREFLIGHT_CONTRACT_INPUT_INVALID");
  }
  try { return JSON.parse(text); } catch { preflightReject("PREFLIGHT_CONTRACT_INPUT_INVALID"); }
}

async function writeSafeStream(stream, value) {
  await new Promise((resolvePromise, rejectPromise) => {
    stream.write(value, (error) => {
      if (error) rejectPromise(error);
      else resolvePromise();
    });
  });
}

function assertProductionRuntimeReceiptStdinBoundary() {
  const contractPath = fileURLToPath(import.meta.url);
  const observation = fixtureObservation();
  const producer = spawnSync(process.execPath, [contractPath, "production-runtime-receipt"], {
    input: stableStringify(observation),
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1_048_576,
    windowsHide: true,
  });
  assert.equal(producer.status, 0, `runtime receipt stdin producer failed: ${producer.stderr}`);
  assert.equal(producer.stderr, "");
  const receiptText = producer.stdout;
  assert.equal(stableStringify(JSON.parse(receiptText)), receiptText);

  const validatorInput = stableStringify({
    receiptText,
    expectedObservation: observation,
    validatedAt: "2026-08-12T00:00:01.000Z",
    freshnessMode: "preflight",
  });
  const validator = spawnSync(process.execPath, [contractPath, "validate-production-runtime-receipt"], {
    input: validatorInput,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1_048_576,
    windowsHide: true,
  });
  assert.equal(validator.status, 0, `runtime receipt stdin validator failed: ${validator.stderr}`);
  assert.equal(validator.stderr, "");
  const validation = JSON.parse(validator.stdout);
  assert.equal(validation.status, "PASS");
  assert.equal(validation.receiptDigest, JSON.parse(receiptText).digest);
}

async function runEarlyPreflightMode(mode) {
  if (mode === "toolchain-receipt" || mode === "task-owned-edge-toolchain-receipt") {
    await writeSafeStream(process.stdout, stableStringify(await createToolchainReceipt()));
    return true;
  }
  if (mode === "test-task-owned-edge-policy") {
    await assertTaskOwnedEdgePolicy();
    await writeSafeStream(process.stdout, "P2.4B RC6.2 task-owned Edge policy: PASS");
    return true;
  }
  if (mode === "production-runtime-receipt") {
    await writeSafeStream(process.stdout, stableStringify(createProductionRuntimeReceipt(await readSafeStdin())));
    return true;
  }
  if (mode === "validate-production-runtime-receipt") {
    const input = await readSafeStdin();
    requireExactKeys(
      input,
      ["receiptText", "expectedObservation", "validatedAt", "freshnessMode"],
      "PREFLIGHT_VALIDATOR_INPUT_INVALID",
    );
    await writeSafeStream(process.stdout, stableStringify(validateProductionRuntimeReceipt(
      input.receiptText,
      input.expectedObservation,
      input.validatedAt,
      input.freshnessMode,
    )));
    return true;
  }
  const fixture = fixtureObservation();
  if (mode === "test-preflight-runtime-receipt") {
    const text = stableStringify(createProductionRuntimeReceipt(fixture));
    assert.equal(validateProductionRuntimeReceipt(
      text, fixture, "2026-08-12T00:00:01.000Z", "preflight",
    ).status, "PASS");
  } else if (mode === "test-preflight-receipt-missing") {
    expectPreflightCode(
      () => validateProductionRuntimeReceipt("", fixture, "2026-08-12T00:00:01.000Z", "preflight"),
      "PREFLIGHT_RECEIPT_MISSING",
    );
    const directory = await mkdtemp(join(tmpdir(), "novel-rc6-2-preflight-missing-"));
    try {
      const expectedPath = join(directory, "receipt.json");
      await assert.rejects(
        validateProductionRuntimeReceiptFile({
          actualPath: expectedPath,
          expectedPath,
          expectedObservation: fixture,
          validatedAt: "2026-08-12T00:00:01.000Z",
          freshnessMode: "preflight",
        }),
        (error) => error instanceof PreflightContractError && error.code === "PREFLIGHT_RECEIPT_MISSING",
      );
      const wrongPath = join(directory, "wrong.json");
      await writeFile(wrongPath, stableStringify(createProductionRuntimeReceipt(fixture)), "utf8");
      await assert.rejects(
        validateProductionRuntimeReceiptFile({
          actualPath: wrongPath,
          expectedPath,
          expectedObservation: fixture,
          validatedAt: "2026-08-12T00:00:01.000Z",
          freshnessMode: "preflight",
        }),
        (error) => error instanceof PreflightContractError && error.code === "PREFLIGHT_RECEIPT_PATH_MISMATCH",
      );
      await writeFile(expectedPath, stableStringify(createProductionRuntimeReceipt(fixture)), "utf8");
      await rm(expectedPath, { force: true });
      await assert.rejects(
        validateProductionRuntimeReceiptFile({
          actualPath: expectedPath,
          expectedPath,
          expectedObservation: fixture,
          validatedAt: "2026-08-12T00:00:01.000Z",
          freshnessMode: "preflight",
        }),
        (error) => error instanceof PreflightContractError && error.code === "PREFLIGHT_RECEIPT_MISSING",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } else if (mode === "test-preflight-receipt-digest") {
    const receipt = createProductionRuntimeReceipt(fixture);
    receipt.digest = "0".repeat(64);
    expectPreflightCode(
      () => validateProductionRuntimeReceipt(
        stableStringify(receipt), fixture, "2026-08-12T00:00:01.000Z", "preflight",
      ),
      "PREFLIGHT_RECEIPT_DIGEST_MISMATCH",
    );
    const directory = await mkdtemp(join(tmpdir(), "novel-rc6-2-preflight-digest-"));
    try {
      const path = join(directory, "receipt.json");
      await writeFile(path, stableStringify(createProductionRuntimeReceipt(fixture)), "utf8");
      await assert.rejects(
        validateProductionRuntimeReceiptFile({
          actualPath: path,
          expectedPath: path,
          expectedObservation: fixture,
          validatedAt: "2026-08-12T00:00:01.000Z",
          freshnessMode: "preflight",
          expectedFileSha256: "0".repeat(64),
        }),
        (error) => error instanceof PreflightContractError && error.code === "PREFLIGHT_RECEIPT_FILE_SHA_MISMATCH",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } else if (mode === "test-preflight-receipt-schema") {
    expectPreflightCode(
      () => createProductionRuntimeReceipt(fixtureObservation({ productCommit: "0".repeat(40) })),
      "PREFLIGHT_RECEIPT_COMMIT_BINDING_INVALID",
    );
    expectPreflightCode(
      () => createProductionRuntimeReceipt(fixtureObservation({ productionDeploymentId: "dpl_wrong" })),
      "PREFLIGHT_RECEIPT_PRODUCTION_BINDING_INVALID",
    );
    const receipt = createProductionRuntimeReceipt(fixture);
    receipt.unexpected = true;
    expectPreflightCode(
      () => validateProductionRuntimeReceipt(
        stableStringify(receipt), fixture, "2026-08-12T00:00:01.000Z", "preflight",
      ),
      "PREFLIGHT_RECEIPT_SCHEMA_INVALID",
    );
    const wrongSchema = createProductionRuntimeReceipt(fixture);
    wrongSchema.schemaVersion = "p24b-rc6.2-production-browser-runtime-receipt-v1";
    expectPreflightCode(
      () => validateProductionRuntimeReceipt(
        stableStringify(wrongSchema), fixture, "2026-08-12T00:00:01.000Z", "preflight",
      ),
      "PREFLIGHT_RECEIPT_SCHEMA_INVALID",
    );
  } else if (mode === "test-preflight-receipt-ordering") {
    const text = stableStringify(createProductionRuntimeReceipt(fixture));
    expectPreflightCode(
      () => validateProductionRuntimeReceipt(text, fixture, "2026-08-12T00:10:00.000Z", "preflight"),
      "PREFLIGHT_RECEIPT_STALE",
    );
    expectPreflightCode(
      () => validateProductionRuntimeReceipt(
        text,
        fixtureObservation({ preflightRunId: "2".repeat(32) }),
        "2026-08-12T00:00:01.000Z",
        "preflight",
      ),
      "PREFLIGHT_RECEIPT_BINDING_MISMATCH",
    );
  } else if (mode === "test-preflight-failure-evidence") {
    const failure = {
      schemaVersion: PREFLIGHT_FAILURE_SCHEMA,
      status: "FAIL",
      phase: "preflight",
      attemptConsumed: false,
      browserStarted: false,
      runnerStarted: false,
      safeErrorCode: "PREFLIGHT_RECEIPT_MISSING",
      mutationCount: 0,
    };
    requireExactKeys(failure, [
      "schemaVersion", "status", "phase", "attemptConsumed", "browserStarted", "runnerStarted",
      "safeErrorCode", "mutationCount",
    ], "PREFLIGHT_FAILURE_EVIDENCE_INVALID");
    assert.equal(failure.schemaVersion, PREFLIGHT_FAILURE_SCHEMA);
    assert.equal(failure.attemptConsumed, false);
    assert.equal(failure.mutationCount, 0);
    assert.doesNotMatch(stableStringify(failure), /secret|token|cookie|authorization|prompt|output/iu);
    const directory = await mkdtemp(join(tmpdir(), "novel-rc6-2-preflight-failure-"));
    try {
      const failureText = stableStringify(failure);
      const failureDigest = createHash("sha256").update(failureText).digest("hex");
      const failurePath = join(directory, "preflight-failure.json");
      const shaPath = join(directory, "preflight-failure.sha256");
      const manifestPath = join(directory, "preflight-manifest.json");
      await writeFile(failurePath, failureText, { encoding: "utf8", flag: "wx" });
      await writeFile(shaPath, `${failureDigest}\n`, { encoding: "utf8", flag: "wx" });
      const manifest = {
        schemaVersion: "p24b-rc6.2-production-browser-preflight-manifest-v1",
        status: "FAIL",
        phase: "preflight",
        files: [
          { name: "preflight-failure.json", sha256: failureDigest },
          {
            name: "preflight-failure.sha256",
            sha256: createHash("sha256").update(`${failureDigest}\n`).digest("hex"),
          },
        ],
      };
      await writeFile(manifestPath, stableStringify(manifest), { encoding: "utf8", flag: "wx" });
      assert.deepEqual((await readdir(directory)).sort(), [
        "preflight-failure.json", "preflight-failure.sha256", "preflight-manifest.json",
      ]);
      assert.equal(createHash("sha256").update(await readFile(failurePath)).digest("hex"), failureDigest);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } else {
    return false;
  }
  await writeSafeStream(process.stdout, `P2.4B RC6.2 ${mode}: PASS`);
  return true;
}

const earlyPreflightModes = new Set([
  "toolchain-receipt",
  "task-owned-edge-toolchain-receipt",
  "test-task-owned-edge-policy",
  "production-runtime-receipt",
  "validate-production-runtime-receipt",
  "test-preflight-runtime-receipt",
  "test-preflight-receipt-missing",
  "test-preflight-receipt-digest",
  "test-preflight-receipt-schema",
  "test-preflight-receipt-ordering",
  "test-preflight-failure-evidence",
]);
if (earlyPreflightModes.has(process.argv[2])) {
  try {
    await runEarlyPreflightMode(process.argv[2]);
  } catch (error) {
    const safeCode = error instanceof PreflightContractError ? error.code : "PREFLIGHT_CONTRACT_INTERNAL_FAILED";
    await writeSafeStream(process.stderr, `${safeCode}\n`);
    process.exitCode = 2;
  }
  process.exit(process.exitCode ?? 0);
}

const wrapperUrl = new URL("./run-rc6-2-production-browser-gate.ps1", import.meta.url);
const [wrapper, browserRunner, runtimeContract, workflow, workflowContract, gateContractSource, networkSentinelContract, packageSource] = await Promise.all([
  readFile(wrapperUrl, "utf8"),
  readFile(new URL("./run-rc6-2-closed-agent-browser.mjs", import.meta.url), "utf8"),
  readFile(new URL("./run-rc6-2-closed-agent-runtime.mjs", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"),
  readFile(new URL("./run-pr23-r21-workflow-contract.mjs", import.meta.url), "utf8"),
  readFile(fileURLToPath(import.meta.url), "utf8"),
  readFile(new URL("./run-rc6-2-network-sentinel-tests.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

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
  "persistence",
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
const NETWORK_SENTINEL_SCHEMA = "p24b-rc6.2-network-zero-receipt-v2";
const NETWORK_SENTINEL_SCALAR_EXPECTATIONS = Object.freeze([
  ["bootstrapAllowedCount", 1, "NETWORK_SENTINEL_BOOTSTRAP_EXACTLY_ONCE"],
  ["bootstrapReceiverHttpCount", 1, "NETWORK_SENTINEL_BOOTSTRAP_EXACTLY_ONCE"],
  ["bootstrapConsumed", true, "NETWORK_SENTINEL_BOOTSTRAP_EXACTLY_ONCE"],
  ["bootstrapExceptionDisabledBeforeProbes", true, "NETWORK_SENTINEL_BOOTSTRAP_DISABLED"],
  ["httpProbeAttemptCount", 2, "NETWORK_SENTINEL_HTTP_ROUTE_OBSERVED"],
  ["httpRouteObservedCount", 2, "NETWORK_SENTINEL_HTTP_ROUTE_OBSERVED"],
  ["httpRouteBlockedCount", 2, "NETWORK_SENTINEL_HTTP_ROUTE_BLOCKED"],
  ["crossOriginClassificationCount", 2, "NETWORK_SENTINEL_HTTP_ROUTE_OBSERVED"],
  ["methodRejectedCount", 1, "NETWORK_SENTINEL_POST_METHOD_REJECTED"],
  ["bodyRejectedCount", 1, "NETWORK_SENTINEL_POST_BODY_REJECTED"],
  ["webSocketProbeAttemptCount", 1, "NETWORK_SENTINEL_WEBSOCKET_ROUTE_OBSERVED"],
  ["webSocketRouteObservedCount", 1, "NETWORK_SENTINEL_WEBSOCKET_ROUTE_OBSERVED"],
  ["webSocketRouteBlockedCount", 1, "NETWORK_SENTINEL_WEBSOCKET_ROUTE_BLOCKED"],
  ["disallowedWebSocketCount", 1, "NETWORK_SENTINEL_WEBSOCKET_ROUTE_BLOCKED"],
  ["browserNativePreblockCount", 0, "NETWORK_SENTINEL_HTTP_ROUTE_OBSERVED"],
  ["tcpConnectionReceiptDelta", 0, "NETWORK_SENTINEL_RECEIVER_TCP_DELTA_ZERO"],
  ["httpRequestReceiptDelta", 0, "NETWORK_SENTINEL_RECEIVER_HTTP_DELTA_ZERO"],
  ["httpRequestBodyByteDelta", 0, "NETWORK_SENTINEL_RECEIVER_BODY_DELTA_ZERO"],
  ["webSocketUpgradeReceiptDelta", 0, "NETWORK_SENTINEL_RECEIVER_WEBSOCKET_DELTA_ZERO"],
  ["arbitraryOutboundHeaderBlocked", true, "NETWORK_SENTINEL_HTTP_ROUTE_BLOCKED"],
  ["requestBodyBlocked", true, "NETWORK_SENTINEL_POST_BODY_REJECTED"],
  ["httpGetBrowserResult", "blocked-by-route", "NETWORK_SENTINEL_HTTP_ROUTE_BLOCKED"],
  ["httpPostBrowserResult", "blocked-by-route", "NETWORK_SENTINEL_HTTP_ROUTE_BLOCKED"],
  ["webSocketBrowserResult", "blocked-by-route", "NETWORK_SENTINEL_WEBSOCKET_ROUTE_BLOCKED"],
  ["operationalErrorCount", 0, "NETWORK_SENTINEL_OPERATION_COMPLETED"],
  ["pageReturnedToAboutBlank", true, "NETWORK_SENTINEL_RETURNED_TO_ABOUT_BLANK"],
  ["browserContextCount", 1, "NETWORK_SENTINEL_CONTEXT_SINGLE_PAGE"],
  ["pageCount", 1, "NETWORK_SENTINEL_CONTEXT_SINGLE_PAGE"],
  ["serviceWorkerCount", 0, "NETWORK_SENTINEL_SERVICE_WORKERS_ZERO"],
  ["receiverClosed", true, "NETWORK_SENTINEL_RECEIVER_HTTP_DELTA_ZERO"],
  ["bootstrapSecretsCleared", true, "NETWORK_SENTINEL_BOOTSTRAP_DISABLED"],
  ["productPolicyCountersZero", true, "NETWORK_SENTINEL_COUNTERS_RESET"],
  ["sentinelCountersReset", true, "NETWORK_SENTINEL_COUNTERS_RESET"],
]);
const NETWORK_SENTINEL_KEYS = Object.freeze([
  "schemaVersion", "status",
  ...NETWORK_SENTINEL_SCALAR_EXPECTATIONS.map(([scalarId]) => scalarId),
  "receiverBaseline", "probeRouteRecords", "firstFailedScalarAssertion", "matrixDigest",
]);
const NETWORK_SENTINEL_BASELINE_KEYS = Object.freeze([
  "tcpConnectionReceiptCount", "httpRequestReceiptCount", "httpRequestBodyByteCount",
  "webSocketUpgradeReceiptCount",
]);
const NETWORK_SENTINEL_PROBE_IDS = Object.freeze(["HTTP_GET", "HTTP_POST", "WEBSOCKET"]);
const NETWORK_SENTINEL_ROUTE_DECISIONS = new Set([
  "blocked", "block-failed", "continued", "continue-failed", "not-observed",
]);
const NETWORK_SENTINEL_REASON_CODES = new Set([
  "method-not-allowed", "network-classification-blocked", "request-body-not-allowed",
]);
const NETWORK_SENTINEL_BROWSER_RESULTS = new Set([
  "blocked-by-route", "route-action-failed", "evaluation-failed", "native-preblock",
  "unexpected-rejection", "timeout", "unexpected-success", "not-attempted",
]);
const NETWORK_SENTINEL_PASS_ROUTE_RECORDS = Object.freeze([
  Object.freeze({
    probeId: "HTTP_GET",
    routeObserved: true,
    routeDecision: "blocked",
    reasonCodes: Object.freeze(["network-classification-blocked"]),
  }),
  Object.freeze({
    probeId: "HTTP_POST",
    routeObserved: true,
    routeDecision: "blocked",
    reasonCodes: Object.freeze([
      "method-not-allowed", "network-classification-blocked", "request-body-not-allowed",
    ]),
  }),
  Object.freeze({
    probeId: "WEBSOCKET",
    routeObserved: true,
    routeDecision: "blocked",
    reasonCodes: Object.freeze(["network-classification-blocked"]),
  }),
]);
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
  ...browserRunner.matchAll(/setRunnerCheckpoint\("([a-z0-9-]+)"\)/gu),
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
      "-ExecutionMode",
      "PreflightDryRun",
    ], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    assert.equal(result.status, 0, `PowerShell Git scalar self-test failed: ${result.stderr}`);
    assert.equal(result.stdout.trim(), "PASS");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function assertPowerShellRuntimeReceiptStdinBehavior() {
  if (process.platform !== "win32") return;
  const invokeStart = wrapper.indexOf("function Invoke-CleanNodeContract");
  const invokeEnd = wrapper.indexOf("function Invoke-ReleaseAttestationVerification");
  assert.ok(invokeStart >= 0 && invokeEnd > invokeStart, "clean Node contract helper boundary is missing");
  const directory = await mkdtemp(join(tmpdir(), "novel-rc6-2-runtime-stdin-"));
  const scriptPath = join(directory, "runtime-stdin-self-test.ps1");
  const escapedNode = process.execPath.replaceAll("'", "''");
  const escapedContract = fileURLToPath(import.meta.url).replaceAll("'", "''");
  const escapedRoot = repositoryRoot.replaceAll("'", "''");
  const observation = stableStringify(fixtureObservation()).replaceAll("'", "''");
  try {
    await writeFile(scriptPath, `$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
function Fail([string]$Code) { throw $Code }
$nodeExe = '${escapedNode}'
$contractPath = '${escapedContract}'
$repoRoot = '${escapedRoot}'
${wrapper.slice(invokeStart, invokeEnd)}
$inputJson = '${observation}'
$receiptText = Invoke-CleanNodeContract 'production-runtime-receipt' @{} 'PS_RUNTIME_STDIN_FAILED' $inputJson
$receipt = $receiptText | ConvertFrom-Json
if ($receipt.schemaVersion -ne '${PRODUCTION_RUNTIME_RECEIPT_SCHEMA}' -or $receipt.digest -notmatch '^[a-f0-9]{64}$') { exit 2 }
if (-not $script:lastNodeContractMetrics.processStarted -or $script:lastNodeContractMetrics.exitCode -ne 0) { exit 3 }
$bomRejected = $false
try { [void](Invoke-CleanNodeContract 'production-runtime-receipt' @{} 'PS_RUNTIME_BOM_REJECTED' (([string][char]0xFEFF) + $inputJson)) }
catch { $bomRejected = $_.Exception.Message -eq 'PS_RUNTIME_BOM_REJECTED' }
if (-not $bomRejected -or $script:lastNodeContractMetrics.processStarted) { exit 4 }
Write-Output 'PASS'
`, "utf8");
    const powerShell = join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32", "WindowsPowerShell", "v1.0", "powershell.exe",
    );
    const result = spawnSync(powerShell, [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath,
    ], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    assert.equal(result.status, 0, `PowerShell runtime receipt stdin self-test failed: ${result.stderr}`);
    assert.equal(result.stdout.trim(), "PASS");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function assertPowerShellBoundedRunnerCaptureBehavior() {
  if (process.platform !== "win32") return;
  const helperStart = wrapper.indexOf("function Start-BoundedProcessStreamCapture");
  const helperEnd = wrapper.indexOf("function Get-ReleaseIdentity");
  assert.ok(helperStart >= 0 && helperEnd > helperStart, "bounded runner capture helper boundary is missing");
  const directory = await mkdtemp(join(tmpdir(), "novel-rc6-2-bounded-capture-"));
  const scriptPath = join(directory, "bounded-capture-self-test.ps1");
  const escapedNode = process.execPath.replaceAll("'", "''");
  try {
    await writeFile(scriptPath, `$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
function Fail([string]$Code) { throw $Code }
${wrapper.slice(helperStart, helperEnd)}
function Invoke-CaptureProbe([string]$JavaScript, [string]$FloodStream, [bool]$ExpectLimit) {
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = '${escapedNode}'
  $startInfo.Arguments = '-e "' + $JavaScript.Replace('"', '\\"') + '"'
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { Fail 'CAPTURE_STUB_START_FAILED' }
  $stdout = Start-BoundedProcessStreamCapture $process.StandardOutput.BaseStream 1048576 'CAPTURE_STDOUT_FAILED'
  $stderr = Start-BoundedProcessStreamCapture $process.StandardError.BaseStream 1048576 'CAPTURE_STDERR_FAILED'
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while (-not $process.HasExited -and [DateTime]::UtcNow -lt $deadline) {
    Update-BoundedProcessStreamCapture $stdout 'CAPTURE_STDOUT_FAILED'
    Update-BoundedProcessStreamCapture $stderr 'CAPTURE_STDERR_FAILED'
    if ($stdout.LimitExceeded -or $stderr.LimitExceeded) { $process.Kill(); break }
    [void]$process.WaitForExit(10)
  }
  if (-not $process.HasExited) { $process.Kill(); Fail 'CAPTURE_STUB_TIMEOUT' }
  $process.WaitForExit()
  $stdoutResult = Get-BoundedProcessStreamCapture $stdout 5000 'CAPTURE_STDOUT_FAILED'
  $stderrResult = Get-BoundedProcessStreamCapture $stderr 5000 'CAPTURE_STDERR_FAILED'
  $selected = if ($FloodStream -eq 'stderr') { $stderrResult } else { $stdoutResult }
  $other = if ($FloodStream -eq 'stderr') { $stdoutResult } else { $stderrResult }
  if (
    [bool]$selected.LimitExceeded -ne $ExpectLimit -or
    [bool]$other.LimitExceeded -or
    ($ExpectLimit -and (
      [long]$selected.CapturedBytes -ne 1048576 -or
      [long]$selected.ObservedBytes -le 1048576
    ))
  ) { Fail 'CAPTURE_LIMIT_MISMATCH' }
  return [pscustomobject]@{ Stdout = $stdoutResult; Stderr = $stderrResult }
}
$normal = Invoke-CaptureProbe "process.stdout.write('normal');process.stderr.write('err')" 'stdout' $false
if (
  (Convert-BoundedProcessCaptureToText $normal.Stdout 'CAPTURE_UTF8_FAILED') -ne 'normal' -or
  (Convert-BoundedProcessCaptureToText $normal.Stderr 'CAPTURE_UTF8_FAILED') -ne 'err'
) { Fail 'CAPTURE_NORMAL_MISMATCH' }
$stdoutFlood = Invoke-CaptureProbe "process.stdout.write('a'.repeat(2097152));setTimeout(()=>{},60000)" 'stdout' $true
$stderrFlood = Invoke-CaptureProbe "process.stderr.write('b'.repeat(2097152));setTimeout(()=>{},60000)" 'stderr' $true
Write-Output 'PASS'
`, "utf8");
    const powerShell = join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32", "WindowsPowerShell", "v1.0", "powershell.exe",
    );
    const result = spawnSync(powerShell, [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath,
    ], { encoding: "utf8", timeout: 45_000, windowsHide: true });
    assert.equal(result.status, 0, `PowerShell bounded runner capture self-test failed: ${result.stderr}`);
    assert.equal(result.signal, null);
    assert.equal(result.stdout.trim(), "PASS");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function assertPowerShellFailurePublisherBehavior() {
  if (process.platform !== "win32" || process.env.RC6_2_FAILURE_VALIDATOR_CHILD_TEST === "1") return;
  const helperStart = wrapper.indexOf("function Get-RequiredZeroHealthCounter");
  const helperEnd = wrapper.indexOf("function Initialize-EvidenceDestination");
  assert.ok(helperStart >= 0 && helperEnd > helperStart, "failure publisher helper boundary is missing");
  const directory = await mkdtemp(join(tmpdir(), "novel-rc6-2-failure-publisher-"));
  const scriptPath = join(directory, "failure-publisher-self-test.ps1");
  const escapedDirectory = directory.replaceAll("'", "''");
  const escapedWrapper = fileURLToPath(wrapperUrl).replaceAll("'", "''");
  const escapedRunner = fileURLToPath(new URL("./run-rc6-2-closed-agent-browser.mjs", import.meta.url)).replaceAll("'", "''");
  const escapedContract = fileURLToPath(import.meta.url).replaceAll("'", "''");
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
$c4BrowserGateControl = '${C4_BROWSER_GATE_CONTROL}'
$c5BrowserGateControl = '${C5_BROWSER_GATE_CONTROL}'
$expectedDeployment = '${EXPECTED_DEPLOYMENT_ID}'
function Get-MainCasStatus { return "pass" }
$capture = [pscustomobject][ordered]@{
  schemaVersion = "p24b-rc6.2-production-browser-gate-c6-runner-capture-v1"
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
$json = Publish-C6FailureEvidence $capture $postchecks "PRODUCTION_BROWSER_RUNNER_START_FAILED"
$bytesBefore = [IO.File]::ReadAllBytes($failureEvidencePath)
$parsed = $json | ConvertFrom-Json
if ($parsed.body.status -ne "FAIL" -or $parsed.body.qualifiesProductionBrowserGate -ne $false) { exit 2 }
if ($parsed.body.eligibleForLuna -ne $false -or $parsed.sanitized -ne $true) { exit 3 }
if ($parsed.rawSecretsStored -ne $false -or $parsed.body.postchecks.remoteMainCas -ne "pass") { exit 4 }
if ($parsed.body.terminalWrapperCode -ne "PRODUCTION_BROWSER_RUNNER_START_FAILED") { exit 5 }
$rejected = $false
try { [void](Publish-C6FailureEvidence $capture $postchecks "PRODUCTION_BROWSER_RUNNER_START_FAILED") }
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
$preflightRunId = '${"d".repeat(32)}'
$createNewRejected = $false
try { Write-CreateNewFlushedFile $createNewPath 'replacement' 'CREATE_NEW_REJECTED' }
catch { $createNewRejected = $_.Exception.Message -eq 'CREATE_NEW_REJECTED' }
if (-not $createNewRejected -or [IO.File]::ReadAllText($createNewPath) -ne 'original') { exit 10 }
$ownedPath = Join-Path $evidenceDirectory 'owned-exact.txt'
$ownedDigest = Publish-AtomicTextFile $ownedPath 'owned' 'OWNED_EXACT_WRITE_FAILED'
if ($ownedDigest -ne (Sha256Text 'owned')) { exit 23 }
[IO.File]::WriteAllText($ownedPath, 'replacement')
if (Remove-OwnedExactFile $ownedPath 'owned') { exit 24 }
if ([IO.File]::ReadAllText($ownedPath) -ne 'replacement') { exit 25 }
[IO.File]::Delete($ownedPath)
$nullCounterRejected = $false
try { [void](Get-RequiredZeroHealthCounter ([pscustomobject]@{ active = $null }) 'active' 'COUNTER_NULL_REJECTED') }
catch { $nullCounterRejected = $_.Exception.Message -eq 'COUNTER_NULL_REJECTED' }
if (-not $nullCounterRejected) { exit 17 }
$stringCounterRejected = $false
try { [void](Get-RequiredZeroHealthCounter ([pscustomobject]@{ active = '0' }) 'active' 'COUNTER_STRING_REJECTED') }
catch { $stringCounterRejected = $_.Exception.Message -eq 'COUNTER_STRING_REJECTED' }
if (-not $stringCounterRejected) { exit 18 }
if ((Get-RequiredZeroHealthCounter ([pscustomobject]@{ active = 0 }) 'active' 'COUNTER_ZERO_REJECTED') -ne 0) { exit 19 }
$ExecutionMode = 'PreflightDryRun'
$deploymentOrigin = '${EXPECTED_ORIGIN}'
$wrapperPath = '${escapedWrapper}'
$runnerPath = '${escapedRunner}'
$contractPath = '${escapedContract}'
$runtimeReceiptBefore = $null
$runtimeReceiptPath = Join-Path $evidenceDirectory 'runtime-missing.json'
$runtimeReceiptShaPath = Join-Path $evidenceDirectory 'runtime-missing.sha256'
$preflightStartedAt = '2026-08-12T00:00:00.000Z'
$script:lastNodeContractMetrics = [pscustomobject][ordered]@{
  mode = 'production-runtime-receipt'; processStarted = $true; exitCode = 2; elapsedMs = 1
  stdoutUtf8ByteLength = 0; stderrUtf8ByteLength = 34; safeErrorCode = 'PREFLIGHT_RECEIPT_MISSING'
}
$preflightFailurePath = Join-Path $evidenceDirectory 'preflight-failure.json'
$preflightFailureShaPath = Join-Path $evidenceDirectory 'preflight-failure.sha256'
$preflightManifestPath = Join-Path $evidenceDirectory 'preflight-manifest.json'
$rootCauseAnalysisPath = Join-Path $evidenceDirectory 'root-cause-analysis.json'
$preflightJson = Publish-PreflightBundle 'FAIL' 'PREFLIGHT_RECEIPT_MISSING' 'preflight-failed'
$preflight = $preflightJson | ConvertFrom-Json
if ($preflight.attemptConsumed -ne $false -or $preflight.browserStarted -ne $false -or $preflight.runnerStarted -ne $false) { exit 14 }
foreach ($sidecar in @($preflightFailurePath, $preflightFailureShaPath, $preflightManifestPath, $rootCauseAnalysisPath)) {
  if (-not (Test-Path -LiteralPath $sidecar -PathType Leaf)) { exit 15 }
}
$preflightDigest = (Get-FileHash -LiteralPath $preflightFailurePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ([IO.File]::ReadAllText($preflightFailureShaPath, [Text.Encoding]::ASCII) -ne "$preflightDigest\`n") { exit 16 }
$preflightFailurePath = Join-Path $evidenceDirectory 'partial-failure.json'
$preflightFailureShaPath = Join-Path $evidenceDirectory 'partial-failure.sha256'
$preflightManifestPath = Join-Path $evidenceDirectory 'partial-manifest.json'
$rootCauseAnalysisPath = Join-Path $evidenceDirectory 'preexisting-root-cause.json'
[IO.File]::WriteAllText($rootCauseAnalysisPath, 'original')
$partialRejected = $false
try { [void](Publish-PreflightBundle 'FAIL' 'PREFLIGHT_RECEIPT_MISSING' 'preflight-failed') }
catch { $partialRejected = $_.Exception.Message -eq 'ROOT_CAUSE_ANALYSIS_WRITE_FAILED' }
if (-not $partialRejected) { exit 20 }
if ((Test-Path -LiteralPath $preflightFailurePath) -or (Test-Path -LiteralPath $preflightFailureShaPath) -or (Test-Path -LiteralPath $preflightManifestPath)) { exit 21 }
if ([IO.File]::ReadAllText($rootCauseAnalysisPath) -ne 'original') { exit 22 }
[IO.File]::Delete($rootCauseAnalysisPath)
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
try { [void](Publish-C6FailureEvidence $capture $postchecks "PRODUCTION_BROWSER_RUNNER_START_FAILED") }
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
    [controlCommit, C9_BROWSER_GATE_CONTROL],
  );
  assert.deepEqual(
    gitOutput(["rev-list", "--parents", "-n", "1", C9_BROWSER_GATE_CONTROL]).split(/\s+/u),
    [C9_BROWSER_GATE_CONTROL, C8_BROWSER_GATE_CONTROL],
  );
  assert.deepEqual(
    gitOutput(["rev-list", "--parents", "-n", "1", C8_BROWSER_GATE_CONTROL]).split(/\s+/u),
    [C8_BROWSER_GATE_CONTROL, C7_BROWSER_GATE_CONTROL],
  );
  assert.deepEqual(
    gitOutput(["rev-list", "--parents", "-n", "1", C7_BROWSER_GATE_CONTROL]).split(/\s+/u),
    [C7_BROWSER_GATE_CONTROL, C6_BROWSER_GATE_CONTROL],
  );
  assert.deepEqual(
    gitOutput(["rev-list", "--parents", "-n", "1", C6_BROWSER_GATE_CONTROL]).split(/\s+/u),
    [C6_BROWSER_GATE_CONTROL, C5_BROWSER_GATE_CONTROL],
  );
  assert.deepEqual(
    gitOutput(["rev-list", "--parents", "-n", "1", C5_BROWSER_GATE_CONTROL]).split(/\s+/u),
    [C5_BROWSER_GATE_CONTROL, C4_BROWSER_GATE_CONTROL],
  );
  assert.deepEqual(
    gitOutput(["rev-list", "--parents", "-n", "1", C4_BROWSER_GATE_CONTROL]).split(/\s+/u),
    [C4_BROWSER_GATE_CONTROL, INITIAL_BROWSER_GATE_CONTROL],
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
    C9_BROWSER_GATE_CONTROL,
    controlCommit,
  ]).split(/\r?\n/u).filter(Boolean).map((line) => {
    const match = /^([AM])\t([^\0\r\n\t]{1,512})$/u.exec(line);
    assert.ok(match, "browser gate control diff contains a forbidden status");
    return match[2].replaceAll("\\", "/");
  }).sort();
  assert.deepEqual(changedPaths, [...C10_GATE_REPAIR_PATHS].sort());
  const c9ChangedPaths = gitOutput([
    "diff",
    "--name-status",
    "--diff-filter=ACDMRTUXB",
    C8_BROWSER_GATE_CONTROL,
    C9_BROWSER_GATE_CONTROL,
  ]).split(/\r?\n/u).filter(Boolean).map((line) => {
    const match = /^([AM])\t([^\0\r\n\t]{1,512})$/u.exec(line);
    assert.ok(match, "C9 browser gate control diff contains a forbidden status");
    return match[2].replaceAll("\\", "/");
  }).sort();
  assert.deepEqual(c9ChangedPaths, [...C9_GATE_REPAIR_PATHS].sort());
  const c8ChangedPaths = gitOutput([
    "diff",
    "--name-status",
    "--diff-filter=ACDMRTUXB",
    C7_BROWSER_GATE_CONTROL,
    C8_BROWSER_GATE_CONTROL,
  ]).split(/\r?\n/u).filter(Boolean).map((line) => {
    const match = /^([AM])\t([^\0\r\n\t]{1,512})$/u.exec(line);
    assert.ok(match, "C8 browser gate control diff contains a forbidden status");
    return match[2].replaceAll("\\", "/");
  }).sort();
  assert.deepEqual(c8ChangedPaths, [...C8_GATE_REPAIR_PATHS].sort());
  const c7ChangedPaths = gitOutput([
    "diff",
    "--name-status",
    "--diff-filter=ACDMRTUXB",
    C6_BROWSER_GATE_CONTROL,
    C7_BROWSER_GATE_CONTROL,
  ]).split(/\r?\n/u).filter(Boolean).map((line) => {
    const match = /^([AM])\t([^\0\r\n\t]{1,512})$/u.exec(line);
    assert.ok(match, "C7 browser gate control diff contains a forbidden status");
    return match[2].replaceAll("\\", "/");
  }).sort();
  assert.deepEqual(c7ChangedPaths, [...C7_GATE_REPAIR_PATHS].sort());
  const c6ChangedPaths = gitOutput([
    "diff",
    "--name-status",
    "--diff-filter=ACDMRTUXB",
    C5_BROWSER_GATE_CONTROL,
    C6_BROWSER_GATE_CONTROL,
  ]).split(/\r?\n/u).filter(Boolean).map((line) => {
    const match = /^([AM])\t([^\0\r\n\t]{1,512})$/u.exec(line);
    assert.ok(match, "C6 browser gate control diff contains a forbidden status");
    return match[2].replaceAll("\\", "/");
  }).sort();
  assert.deepEqual(c6ChangedPaths, [...C6_GATE_REPAIR_PATHS].sort());
  const c5ChangedPaths = gitOutput([
    "diff",
    "--name-status",
    "--diff-filter=ACDMRTUXB",
    C4_BROWSER_GATE_CONTROL,
    C5_BROWSER_GATE_CONTROL,
  ]).split(/\r?\n/u).filter(Boolean).map((line) => {
    const match = /^([AM])\t([^\0\r\n\t]{1,512})$/u.exec(line);
    assert.ok(match, "previous browser gate control diff contains a forbidden status");
    return match[2].replaceAll("\\", "/");
  }).sort();
  assert.deepEqual(c5ChangedPaths, [...HISTORICAL_GATE_REPAIR_PATHS].sort());
  const c4ChangedPaths = gitOutput([
    "diff",
    "--name-status",
    "--diff-filter=ACDMRTUXB",
    INITIAL_BROWSER_GATE_CONTROL,
    C4_BROWSER_GATE_CONTROL,
  ]).split(/\r?\n/u).filter(Boolean).map((line) => {
    const match = /^([AM])\t([^\0\r\n\t]{1,512})$/u.exec(line);
    assert.ok(match, "C4 browser gate control diff contains a forbidden status");
    return match[2].replaceAll("\\", "/");
  }).sort();
  assert.deepEqual(c4ChangedPaths, [...HISTORICAL_GATE_REPAIR_PATHS].sort());
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
  assert.deepEqual(initialChangedPaths, [...INITIAL_GATE_BLOB_PATHS].sort());
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
  assert.deepEqual(compositeChangedPaths, [...COMPOSITE_GATE_BLOB_PATHS].sort());
  const body = {
    schemaVersion: "p24b-rc6.2-browser-gate-control-proof-v7",
    operation: process.env.EXPECTED_OPERATION,
    productCommit: PRODUCT_COMMIT,
    failedRecoveryControl: FAILED_RECOVERY_CONTROL,
    productionRecoveryControl: PRODUCTION_RECOVERY_CONTROL,
    initialBrowserGateControl: INITIAL_BROWSER_GATE_CONTROL,
    c4BrowserGateControl: C4_BROWSER_GATE_CONTROL,
    c5BrowserGateControl: C5_BROWSER_GATE_CONTROL,
    c6BrowserGateControl: C6_BROWSER_GATE_CONTROL,
    c7BrowserGateControl: C7_BROWSER_GATE_CONTROL,
    c8BrowserGateControl: C8_BROWSER_GATE_CONTROL,
    c9BrowserGateControl: C9_BROWSER_GATE_CONTROL,
    browserGateControl: controlCommit,
    parentCommit: C9_BROWSER_GATE_CONTROL,
    repository: process.env.GITHUB_REPOSITORY,
    eventName: process.env.GITHUB_EVENT_NAME,
    eventRef: process.env.GITHUB_REF,
    workflowSha: process.env.GITHUB_WORKFLOW_SHA,
    workflowRef: process.env.GITHUB_WORKFLOW_REF,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    lineage: [
      controlCommit,
      C9_BROWSER_GATE_CONTROL,
      C8_BROWSER_GATE_CONTROL,
      C7_BROWSER_GATE_CONTROL,
      C6_BROWSER_GATE_CONTROL,
      C5_BROWSER_GATE_CONTROL,
      C4_BROWSER_GATE_CONTROL,
      INITIAL_BROWSER_GATE_CONTROL,
      PRODUCTION_RECOVERY_CONTROL,
      FAILED_RECOVERY_CONTROL,
      PRODUCT_COMMIT,
    ],
    changedPaths,
    c9ChangedPaths,
    c8ChangedPaths,
    c7ChangedPaths,
    c6ChangedPaths,
    c5ChangedPaths,
    c4ChangedPaths,
    initialChangedPaths,
    compositeChangedPaths,
  };
  const proof = {
    ...body,
    proofDigest: createHash("sha256").update(stableStringify({
      domain: "p24b-rc6.2-browser-gate-control-proof-v7",
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

const c10AuditControlProofSchema = ["p24b-rc6.2-browser-gate-control-proof", "v7"].join("-");
const historicalC9AuditControlProofSchema = [
  "p24b-rc6.2-browser-gate-control-proof", "v6",
].join("-");
assert.equal(
  occurrences(gateContractSource, c10AuditControlProofSchema),
  2,
  "C10 audit control proof must bind the v7 body and digest domain",
);
assert.equal(
  occurrences(gateContractSource, historicalC9AuditControlProofSchema),
  0,
  "C10 audit control proof must not masquerade under the historical C9 v6 schema",
);

for (const literal of [
  "29fc6e742672bb07187765d34ea818afdadf56ae",
  "9cd074f239b73dd9b61f6d758fcf97fbd809face",
  "3b716fc0d974a9d59b49ffca5953776af66c7a07",
  "aab0e7bd52c57bc57ecfe8be8b08c1cf63db9824",
  "100eea11003c5132ab2b519707c5dee658bc9cbe",
  "99695b247c2b1626c38efc8ae4589dd9bd8d30da",
  "b326c2fc9925798ffbc750ae37db847f0c8b5625",
  "7dea0b8dd488a0f2a24132266944cb95b2f15ca9",
  "04e78268cfcfeaeffdc72b603d0700944c7142e7",
  "92fe2ff7550ef3aeff9447252714d10d6c771d6b",
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
if (process.argv.length === 2) {
  assertProductionRuntimeReceiptStdinBoundary();
  await assertPowerShellRuntimeReceiptStdinBehavior();
  await assertPowerShellBoundedRunnerCaptureBehavior();
  await assertPowerShellFailurePublisherBehavior();
}

const toolchainReceiptForContract = await createToolchainReceipt();
assert.equal(toolchainReceiptForContract.schemaVersion, TOOLCHAIN_RECEIPT_SCHEMA);
assertSha256(toolchainReceiptForContract.proofDigest, "toolchain receipt proof digest");

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

function networkSentinelMatrixDigest(value) {
  const body = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "matrixDigest"),
  );
  return createHash("sha256")
    .update(`${NETWORK_SENTINEL_SCHEMA}\n${stableStringify(body)}`)
    .digest("hex");
}

function firstNetworkSentinelMismatch(value) {
  for (const [scalarId, expectedSafeValue, assertionId] of NETWORK_SENTINEL_SCALAR_EXPECTATIONS) {
    if (value[scalarId] !== expectedSafeValue) {
      return { assertionId, scalarId, expectedSafeValue, actualSafeValue: value[scalarId] };
    }
  }
  const baselineMismatch = [
    [
      "receiverBaseline.tcpConnectionReceiptCount",
      1,
      value.receiverBaseline.tcpConnectionReceiptCount,
      "NETWORK_SENTINEL_RECEIVER_TCP_DELTA_ZERO",
      value.receiverBaseline.tcpConnectionReceiptCount < 1,
    ],
    [
      "receiverBaseline.httpRequestReceiptCount",
      1,
      value.receiverBaseline.httpRequestReceiptCount,
      "NETWORK_SENTINEL_BOOTSTRAP_EXACTLY_ONCE",
      value.receiverBaseline.httpRequestReceiptCount !== 1,
    ],
    [
      "receiverBaseline.httpRequestBodyByteCount",
      0,
      value.receiverBaseline.httpRequestBodyByteCount,
      "NETWORK_SENTINEL_POST_BODY_REJECTED",
      value.receiverBaseline.httpRequestBodyByteCount !== 0,
    ],
    [
      "receiverBaseline.webSocketUpgradeReceiptCount",
      0,
      value.receiverBaseline.webSocketUpgradeReceiptCount,
      "NETWORK_SENTINEL_RECEIVER_WEBSOCKET_DELTA_ZERO",
      value.receiverBaseline.webSocketUpgradeReceiptCount !== 0,
    ],
  ].find((entry) => entry[4]);
  return baselineMismatch === undefined ? null : {
    scalarId: baselineMismatch[0],
    expectedSafeValue: baselineMismatch[1],
    actualSafeValue: baselineMismatch[2],
    assertionId: baselineMismatch[3],
  };
}

function assertNetworkZeroReceipt(value) {
  assertExactKeys(value, NETWORK_SENTINEL_KEYS, "runner network zero receipt v2");
  assert.equal(value.schemaVersion, NETWORK_SENTINEL_SCHEMA);
  assert.equal(new Set(["PASS", "FAIL"]).has(value.status), true);
  for (const [scalarId, expectedSafeValue] of NETWORK_SENTINEL_SCALAR_EXPECTATIONS) {
    if (typeof expectedSafeValue === "number") assertSafeCount(value[scalarId], scalarId);
    else if (typeof expectedSafeValue === "boolean") assert.equal(typeof value[scalarId], "boolean");
    else assert.equal(NETWORK_SENTINEL_BROWSER_RESULTS.has(value[scalarId]), true);
  }
  assertExactKeys(value.receiverBaseline, NETWORK_SENTINEL_BASELINE_KEYS, "sentinel receiver baseline");
  for (const key of NETWORK_SENTINEL_BASELINE_KEYS) {
    assertSafeCount(value.receiverBaseline[key], `receiverBaseline.${key}`);
  }
  assert.ok(Array.isArray(value.probeRouteRecords));
  assert.equal(value.probeRouteRecords.length, 3);
  const browserResults = [
    value.httpGetBrowserResult,
    value.httpPostBrowserResult,
    value.webSocketBrowserResult,
  ];
  for (const [index, record] of value.probeRouteRecords.entries()) {
    assertExactKeys(
      record,
      ["probeId", "routeObserved", "routeDecision", "reasonCodes"],
      `sentinel route record ${index}`,
    );
    assert.equal(record.probeId, NETWORK_SENTINEL_PROBE_IDS[index]);
    assert.equal(typeof record.routeObserved, "boolean");
    assert.equal(NETWORK_SENTINEL_ROUTE_DECISIONS.has(record.routeDecision), true);
    assert.equal(record.routeObserved, record.routeDecision !== "not-observed");
    assert.ok(Array.isArray(record.reasonCodes) && record.reasonCodes.length <= 3);
    assert.equal(new Set(record.reasonCodes).size, record.reasonCodes.length);
    for (const code of record.reasonCodes) assert.equal(NETWORK_SENTINEL_REASON_CODES.has(code), true);
    if (record.routeDecision === "blocked") {
      assert.deepEqual(record.reasonCodes, NETWORK_SENTINEL_PASS_ROUTE_RECORDS[index].reasonCodes);
      assert.equal(
        new Set(["blocked-by-route", "evaluation-failed", "timeout", "unexpected-success"])
          .has(browserResults[index]),
        true,
      );
    } else if (record.routeDecision === "block-failed") {
      assert.deepEqual(record.reasonCodes, NETWORK_SENTINEL_PASS_ROUTE_RECORDS[index].reasonCodes);
      assert.equal(browserResults[index], "route-action-failed");
    } else if (record.routeDecision === "continue-failed") {
      assert.deepEqual(record.reasonCodes, []);
      assert.equal(browserResults[index], "route-action-failed");
    } else {
      assert.deepEqual(record.reasonCodes, []);
      assert.notEqual(browserResults[index], "blocked-by-route");
      assert.notEqual(browserResults[index], "route-action-failed");
      if (record.routeDecision === "continued") {
        assert.equal(
          new Set(["evaluation-failed", "unexpected-rejection", "timeout", "unexpected-success"])
            .has(browserResults[index]),
          true,
        );
      }
    }
    if (browserResults[index] === "route-action-failed") {
      assert.equal(
        new Set(["block-failed", "continue-failed"]).has(record.routeDecision),
        true,
      );
    }
    if (browserResults[index] === "unexpected-rejection") {
      assert.equal(record.routeDecision, "continued");
    }
  }
  const operationalFailureObserved = value.probeRouteRecords.some(
    ({ routeDecision }) => new Set(["block-failed", "continue-failed"]).has(routeDecision),
  ) || browserResults.includes("evaluation-failed");
  if (operationalFailureObserved) assert.ok(value.operationalErrorCount >= 1);
  const [httpGetRecord, httpPostRecord, webSocketRecord] = value.probeRouteRecords;
  const httpRecords = [httpGetRecord, httpPostRecord];
  const attempted = (result) => result !== "not-attempted";
  assert.ok(value.httpProbeAttemptCount >= browserResults.slice(0, 2).filter(attempted).length);
  assert.ok(value.httpRouteObservedCount >= httpRecords.filter(({ routeObserved }) => routeObserved).length);
  assert.ok(value.httpRouteBlockedCount >= httpRecords.filter(({ routeDecision }) => routeDecision === "blocked").length);
  assert.ok(value.httpRouteBlockedCount <= value.httpRouteObservedCount);
  assert.ok(value.crossOriginClassificationCount >= httpRecords.filter(
    ({ reasonCodes }) => reasonCodes.includes("network-classification-blocked"),
  ).length);
  assert.ok(value.crossOriginClassificationCount <= value.httpRouteObservedCount);
  assert.ok(value.methodRejectedCount >= httpRecords.filter(
    ({ reasonCodes }) => reasonCodes.includes("method-not-allowed"),
  ).length);
  assert.ok(value.methodRejectedCount <= value.httpRouteObservedCount);
  assert.ok(value.bodyRejectedCount >= httpRecords.filter(
    ({ reasonCodes }) => reasonCodes.includes("request-body-not-allowed"),
  ).length);
  assert.ok(value.bodyRejectedCount <= value.httpRouteObservedCount);
  assert.ok(value.webSocketProbeAttemptCount >= Number(attempted(value.webSocketBrowserResult)));
  assert.ok(value.webSocketRouteObservedCount >= Number(webSocketRecord.routeObserved));
  assert.ok(value.webSocketRouteBlockedCount >= Number(webSocketRecord.routeDecision === "blocked"));
  assert.ok(value.webSocketRouteBlockedCount <= value.webSocketRouteObservedCount);
  assert.ok(value.disallowedWebSocketCount >= Number(
    webSocketRecord.reasonCodes.includes("network-classification-blocked"),
  ));
  assert.ok(value.disallowedWebSocketCount <= value.webSocketRouteObservedCount);
  assert.equal(
    value.browserNativePreblockCount,
    browserResults.filter((result) => result === "native-preblock").length,
  );
  if (value.httpGetBrowserResult === "unexpected-success"
    || value.httpPostBrowserResult === "unexpected-success") {
    assert.ok(value.httpRequestReceiptDelta > 0);
  }
  if (value.webSocketBrowserResult === "unexpected-success") {
    assert.ok(value.webSocketUpgradeReceiptDelta > 0);
  }
  assert.equal(value.arbitraryOutboundHeaderBlocked, value.httpRequestReceiptDelta === 0);
  assert.equal(value.requestBodyBlocked, value.httpRequestBodyByteDelta === 0);
  const firstMismatch = firstNetworkSentinelMismatch(value);
  assert.equal(value.status, firstMismatch === null ? "PASS" : "FAIL");
  if (firstMismatch === null) {
    assert.equal(value.firstFailedScalarAssertion, null);
    for (const [scalarId, expectedSafeValue] of NETWORK_SENTINEL_SCALAR_EXPECTATIONS) {
      assert.equal(value[scalarId], expectedSafeValue);
    }
    assert.ok(value.receiverBaseline.tcpConnectionReceiptCount >= 1);
    assert.equal(value.receiverBaseline.httpRequestReceiptCount, 1);
    assert.equal(value.receiverBaseline.httpRequestBodyByteCount, 0);
    assert.equal(value.receiverBaseline.webSocketUpgradeReceiptCount, 0);
    assert.deepEqual(value.probeRouteRecords, NETWORK_SENTINEL_PASS_ROUTE_RECORDS);
  } else {
    assertExactKeys(
      value.firstFailedScalarAssertion,
      ["assertionId", "scalarId", "expectedSafeValue", "actualSafeValue"],
      "sentinel first failed scalar assertion",
    );
    assert.deepEqual(value.firstFailedScalarAssertion, firstMismatch);
  }
  assert.match(value.matrixDigest, /^[a-f0-9]{64}$/u);
  assert.equal(value.matrixDigest, networkSentinelMatrixDigest(value));
}

function passingNetworkSentinelFixture() {
  const body = {
    schemaVersion: NETWORK_SENTINEL_SCHEMA,
    status: "PASS",
    ...Object.fromEntries(NETWORK_SENTINEL_SCALAR_EXPECTATIONS.map(
      ([scalarId, expectedSafeValue]) => [scalarId, expectedSafeValue],
    )),
    receiverBaseline: {
      tcpConnectionReceiptCount: 1,
      httpRequestReceiptCount: 1,
      httpRequestBodyByteCount: 0,
      webSocketUpgradeReceiptCount: 0,
    },
    probeRouteRecords: NETWORK_SENTINEL_PASS_ROUTE_RECORDS.map((record) => ({
      ...record,
      reasonCodes: [...record.reasonCodes],
    })),
    firstFailedScalarAssertion: null,
  };
  return { ...body, matrixDigest: networkSentinelMatrixDigest(body) };
}

function failingNetworkSentinelFixture(overrides) {
  const passing = passingNetworkSentinelFixture();
  const candidate = { ...passing, ...overrides };
  delete candidate.matrixDigest;
  candidate.firstFailedScalarAssertion = firstNetworkSentinelMismatch(candidate);
  candidate.status = candidate.firstFailedScalarAssertion === null ? "PASS" : "FAIL";
  return { ...candidate, matrixDigest: networkSentinelMatrixDigest(candidate) };
}

const passingNetworkSentinelContractFixture = passingNetworkSentinelFixture();
assertNetworkZeroReceipt(passingNetworkSentinelContractFixture);
const duplicateObservationFailureFixture = failingNetworkSentinelFixture({
  httpRouteObservedCount: 3,
});
assert.equal(duplicateObservationFailureFixture.status, "FAIL");
assert.equal(
  duplicateObservationFailureFixture.firstFailedScalarAssertion.scalarId,
  "httpRouteObservedCount",
);
assertNetworkZeroReceipt(duplicateObservationFailureFixture);
const routeActionFailureRecords = passingNetworkSentinelContractFixture.probeRouteRecords.map(
  (record) => ({ ...record, reasonCodes: [...record.reasonCodes] }),
);
routeActionFailureRecords[0] = {
  probeId: "HTTP_GET",
  routeObserved: true,
  routeDecision: "block-failed",
  reasonCodes: ["network-classification-blocked"],
};
const routeActionFailureFixture = failingNetworkSentinelFixture({
  httpRouteBlockedCount: 1,
  httpGetBrowserResult: "route-action-failed",
  operationalErrorCount: 1,
  probeRouteRecords: routeActionFailureRecords,
});
assert.equal(routeActionFailureFixture.status, "FAIL");
assert.equal(routeActionFailureFixture.operationalErrorCount, 1);
assertNetworkZeroReceipt(routeActionFailureFixture);
const routeActionFailureMissingOperationalCount = {
  ...routeActionFailureFixture,
  operationalErrorCount: 0,
};
routeActionFailureMissingOperationalCount.matrixDigest = networkSentinelMatrixDigest(
  routeActionFailureMissingOperationalCount,
);
assert.throws(() => assertNetworkZeroReceipt(routeActionFailureMissingOperationalCount));
const continueActionFailureRecords = passingNetworkSentinelContractFixture.probeRouteRecords.map(
  (record) => ({ ...record, reasonCodes: [...record.reasonCodes] }),
);
continueActionFailureRecords[0] = {
  probeId: "HTTP_GET",
  routeObserved: true,
  routeDecision: "continue-failed",
  reasonCodes: [],
};
const continueActionFailureFixture = failingNetworkSentinelFixture({
  httpRouteBlockedCount: 1,
  crossOriginClassificationCount: 1,
  httpGetBrowserResult: "route-action-failed",
  operationalErrorCount: 1,
  probeRouteRecords: continueActionFailureRecords,
});
assert.equal(continueActionFailureFixture.status, "FAIL");
assert.equal(continueActionFailureFixture.operationalErrorCount, 1);
assertNetworkZeroReceipt(continueActionFailureFixture);
const continueActionFailureMissingOperationalCount = {
  ...continueActionFailureFixture,
  operationalErrorCount: 0,
};
continueActionFailureMissingOperationalCount.matrixDigest = networkSentinelMatrixDigest(
  continueActionFailureMissingOperationalCount,
);
assert.throws(() => assertNetworkZeroReceipt(continueActionFailureMissingOperationalCount));
const continueActionFailureWrongReasons = {
  ...continueActionFailureFixture,
  probeRouteRecords: continueActionFailureFixture.probeRouteRecords.map(
    (record) => ({ ...record, reasonCodes: [...record.reasonCodes] }),
  ),
};
continueActionFailureWrongReasons.probeRouteRecords[0].reasonCodes = [
  "network-classification-blocked",
];
continueActionFailureWrongReasons.matrixDigest = networkSentinelMatrixDigest(
  continueActionFailureWrongReasons,
);
assert.throws(() => assertNetworkZeroReceipt(continueActionFailureWrongReasons));
const continueActionFailureWrongResult = {
  ...continueActionFailureFixture,
  httpGetBrowserResult: "evaluation-failed",
};
continueActionFailureWrongResult.matrixDigest = networkSentinelMatrixDigest(
  continueActionFailureWrongResult,
);
assert.throws(() => assertNetworkZeroReceipt(continueActionFailureWrongResult));
const evaluationFailureFixture = failingNetworkSentinelFixture({
  httpGetBrowserResult: "evaluation-failed",
  operationalErrorCount: 1,
});
assert.equal(
  evaluationFailureFixture.firstFailedScalarAssertion.scalarId,
  "httpGetBrowserResult",
);
assertNetworkZeroReceipt(evaluationFailureFixture);
const evaluationFailureMissingOperationalCount = {
  ...evaluationFailureFixture,
  operationalErrorCount: 0,
};
evaluationFailureMissingOperationalCount.matrixDigest = networkSentinelMatrixDigest(
  evaluationFailureMissingOperationalCount,
);
assert.throws(() => assertNetworkZeroReceipt(evaluationFailureMissingOperationalCount));
const unexpectedRejectionRecords = passingNetworkSentinelContractFixture.probeRouteRecords.map(
  (record) => ({ ...record, reasonCodes: [...record.reasonCodes] }),
);
unexpectedRejectionRecords[0] = {
  probeId: "HTTP_GET",
  routeObserved: true,
  routeDecision: "continued",
  reasonCodes: [],
};
const unexpectedRejectionFixture = failingNetworkSentinelFixture({
  httpRouteBlockedCount: 1,
  crossOriginClassificationCount: 1,
  httpGetBrowserResult: "unexpected-rejection",
  operationalErrorCount: 1,
  probeRouteRecords: unexpectedRejectionRecords,
});
assert.equal(unexpectedRejectionFixture.status, "FAIL");
assertNetworkZeroReceipt(unexpectedRejectionFixture);
const impossibleCountFailureFixture = failingNetworkSentinelFixture({
  httpRouteObservedCount: 2,
  httpRouteBlockedCount: 3,
});
assert.throws(() => assertNetworkZeroReceipt(impossibleCountFailureFixture));
const impossibleBlockedResultRecords = passingNetworkSentinelContractFixture.probeRouteRecords.map(
  (record) => ({ ...record, reasonCodes: [...record.reasonCodes] }),
);
assert.throws(() => assertNetworkZeroReceipt(failingNetworkSentinelFixture({
  httpGetBrowserResult: "route-action-failed",
  probeRouteRecords: impossibleBlockedResultRecords,
})));
const unexpectedBaselineReceiptFailureFixture = failingNetworkSentinelFixture({
  receiverBaseline: {
    ...passingNetworkSentinelContractFixture.receiverBaseline,
    httpRequestReceiptCount: 2,
  },
});
assert.equal(
  unexpectedBaselineReceiptFailureFixture.firstFailedScalarAssertion.scalarId,
  "receiverBaseline.httpRequestReceiptCount",
);
assertNetworkZeroReceipt(unexpectedBaselineReceiptFailureFixture);
assert.throws(() => assertNetworkZeroReceipt({
  ...passingNetworkSentinelContractFixture,
  matrixDigest: "0".repeat(64),
}));

function assertNetworkSentinelOnlyLauncherEvidenceContract() {
  const completedAt = "2026-08-13T06:00:00.000Z";
  const completedMs = Date.parse(completedAt);
  const profilePath = resolve(tmpdir(), "novel-rc6-2-sentinel-ABC123", "novel-rc6-2-edge-Abc123");
  const profilePathDigest = createHash("sha256").update(profilePath).digest("hex");
  const networkZeroReceipt = passingNetworkSentinelFixture();
  const edgeIdentity = {
    executableName: "msedge.exe",
    executableDigest: EXPECTED_EDGE_EXE_DIGEST,
    persistentContext: true,
    disposableProfile: true,
    profileOwnership: "runner-created",
    profileEntryCountBeforeLaunch: 0,
    profilePathDigest,
    webSocketRouteInstalledBeforeNavigation: true,
    product: `Edg/${EXPECTED_EDGE_VERSION}`,
    engineVersionDirectoryName: EXPECTED_EDGE_VERSION,
    engineDllName: "msedge.dll",
    engineDllDigest: EXPECTED_EDGE_DLL_DIGEST,
    protocolVersion: "1.3",
    browserRevisionDigest: "a".repeat(64),
    userAgentProductVerified: true,
    preNavigationNetworkSentinel: networkZeroReceipt,
  };
  const evidence = {
    schemaVersion: "p24b-rc6.2-network-sentinel-only-evidence-v1",
    status: "PASS",
    mode: "network-sentinel-only",
    networkZeroReceipt,
    freshBrowserContext: true,
    profileOwnership: "runner-created",
    profilePathDigest,
    edgeIdentity,
    profileDisposed: true,
    completedAt,
  };
  const canonical = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  const parsed = parseCanonicalNetworkSentinelEvidence(canonical);
  validateNetworkSentinelOnlyEvidence(parsed, { profilePath }, completedMs, completedMs);
  assert.throws(() => parseCanonicalNetworkSentinelEvidence(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), canonical])));
  assert.throws(() => parseCanonicalNetworkSentinelEvidence(Buffer.from(canonical.toString("utf8").replaceAll("\n", "\r\n"), "utf8")));
  assert.throws(() => parseCanonicalNetworkSentinelEvidence(Buffer.from(`${canonical.toString("utf8")} `, "utf8")));
  assert.throws(() => parseCanonicalNetworkSentinelEvidence(Buffer.from(`${JSON.stringify(evidence)}\n`, "utf8")));
  assert.throws(() => validateNetworkSentinelOnlyEvidence(
    { ...evidence, unexpected: true }, { profilePath }, completedMs, completedMs,
  ));
  assert.throws(() => validateNetworkSentinelOnlyEvidence(
    { ...evidence, profilePathDigest: "0".repeat(64) }, { profilePath }, completedMs, completedMs,
  ));
  assert.throws(() => validateNetworkSentinelOnlyEvidence(
    { ...evidence, freshBrowserContext: false }, { profilePath }, completedMs, completedMs,
  ));
  assert.throws(() => validateNetworkSentinelOnlyEvidence(
    { ...evidence, profileOwnership: "wrapper-owned" }, { profilePath }, completedMs, completedMs,
  ));
  assert.throws(() => validateNetworkSentinelOnlyEvidence(
    { ...evidence, completedAt: "2026-08-13T05:59:00.000Z" }, { profilePath }, completedMs, completedMs,
  ));
  assert.throws(() => validateNetworkSentinelOnlyEvidence({
    ...evidence,
    edgeIdentity: { ...edgeIdentity, profilePathDigest: "0".repeat(64) },
  }, { profilePath }, completedMs, completedMs));
  const embeddedPassBody = {
    ...passingNetworkSentinelFixture(),
    receiverBaseline: {
      ...passingNetworkSentinelFixture().receiverBaseline,
      tcpConnectionReceiptCount: 2,
    },
  };
  delete embeddedPassBody.matrixDigest;
  const embeddedPass = {
    ...embeddedPassBody,
    matrixDigest: networkSentinelMatrixDigest(embeddedPassBody),
  };
  assertNetworkZeroReceipt(embeddedPass);
  assert.throws(() => validateNetworkSentinelOnlyEvidence({
    ...evidence,
    edgeIdentity: { ...edgeIdentity, preNavigationNetworkSentinel: embeddedPass },
  }, { profilePath }, completedMs, completedMs));
  const semanticFailureBody = {
    ...passingNetworkSentinelFixture(),
    httpRouteObservedCount: 3,
  };
  delete semanticFailureBody.matrixDigest;
  const semanticFailure = {
    ...semanticFailureBody,
    matrixDigest: networkSentinelMatrixDigest(semanticFailureBody),
  };
  assert.throws(() => validateNetworkSentinelOnlyEvidence({
    ...evidence,
    networkZeroReceipt: semanticFailure,
    edgeIdentity: { ...edgeIdentity, preNavigationNetworkSentinel: semanticFailure },
  }, { profilePath }, completedMs, completedMs));
  assert.throws(() => validateNetworkSentinelOnlyEvidence(
    { ...evidence, profileDisposed: false }, { profilePath }, completedMs, completedMs,
  ));
}

assertNetworkSentinelOnlyLauncherEvidenceContract();

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
    networkZeroReceipt: passingNetworkSentinelFixture(),
    projectId: "00000000-0000-4000-8000-000000000000",
    persistence: {
      backend: "indexeddb",
      degraded: false,
      databaseName: "novel-intelligence-platform",
      requiredStoresVerified: true,
      writeVerified: true,
      reloadVerified: true,
      memoryFallbackUsed: false,
    },
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
      status: "ready",
      approvedRecordCreated: true,
      approvedRecordReloadVerified: true,
      modelContextBindingVerified: true,
      crossProjectLeakCount: 0,
      observedOtherProjectCount: 1,
      observedOtherStoryBibleCount: 1,
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

function assertNetworkSentinelChildModeBehavior() {
  const scriptPath = fileURLToPath(
    new URL("./run-rc6-2-network-sentinel-tests.mjs", import.meta.url),
  );
  for (const sentinelMode of ["unit", "mutations"]) {
    const result = spawnSync(process.execPath, [scriptPath, sentinelMode], {
      cwd: repositoryRoot,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1_048_576,
    });
    assert.equal(
      result.status,
      0,
      `network sentinel ${sentinelMode} child failed: ${result.stderr.trim()}`,
    );
    assert.equal(result.signal, null);
    assert.equal(result.stderr, "");
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.schemaVersion, "p24b-rc6.2-network-sentinel-tests-v1");
    assert.equal(summary.status, "PASS");
    assert.equal(summary.mode, sentinelMode);
    assert.equal(summary.matrixSchemaVersion, "p24b-rc6.2-network-zero-receipt-v2");
    assert.equal(summary.digestDomain, "p24b-rc6.2-network-zero-receipt-v2");
    assert.match(summary.passMatrixDigest, /^[a-f0-9]{64}$/u);
    assert.equal(summary.browserLaunchCount, 0);
    assert.equal(summary.edgeLaunchCount, 0);
    assert.equal(summary.playwrightLaunchCount, 0);
    assert.equal(summary.networkRequestCount, 0);
    assert.equal(summary.formalAuthorizationCount, 0);
    assert.equal(summary.formalAttemptCount, 0);
    assert.equal(summary.blockingSkipCount, 0);
    assert.equal(summary.runnerSourceContract, true);
    assert.ok(summary.casePassCount > 0);
  }
}

if (process.argv.length === 2) {
  await assertFailureValidatorChildProcessBehavior();
  assertNetworkSentinelChildModeBehavior();
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
  assertExactKeys(evidence.persistence, [
    "backend",
    "degraded",
    "databaseName",
    "requiredStoresVerified",
    "writeVerified",
    "reloadVerified",
    "memoryFallbackUsed",
  ], "persistence");
  assert.deepEqual(evidence.persistence, {
    backend: "indexeddb",
    degraded: false,
    databaseName: "novel-intelligence-platform",
    requiredStoresVerified: true,
    writeVerified: true,
    reloadVerified: true,
    memoryFallbackUsed: false,
  });
  assert.equal(evidence.storyBible.status, "ready");
  assert.equal(evidence.storyBible.approvedRecordCreated, true);
  assert.equal(evidence.storyBible.approvedRecordReloadVerified, true);
  assert.equal(evidence.storyBible.modelContextBindingVerified, true);
  assert.equal(evidence.storyBible.crossProjectLeakCount, 0);
  assert.ok(evidence.storyBible.observedOtherProjectCount >= 1);
  assert.ok(evidence.storyBible.observedOtherStoryBibleCount >= 1);
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

  assertNetworkZeroReceipt(evidence.networkZeroReceipt);
  assert.equal(evidence.networkZeroReceipt.status, "PASS");

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
assert.ok(
  gateContractSource.indexOf("if (earlyPreflightModes.has(process.argv[2]))")
  < gateContractSource.indexOf("const wrapperUrl = new URL"),
  "early preflight dispatch must precede broad wrapper/browser/runtime/workflow reads",
);
assert.ok(
  gateContractSource.indexOf("const wrapperUrl = new URL")
  < gateContractSource.indexOf("const RUNNER_EVIDENCE_SCHEMA_VERSION"),
  "broad source reads must remain on the non-early path",
);
assert.match(wrapper, /\[ValidateRange\(1, \[long\]::MaxValue\)\][\s\S]*\$ExpectedLkgAuditRunId/u);
assert.match(wrapper, /\$ExpectedLkgAuditControlProofDigest/u);
assert.match(wrapper, /\$ExpectedLkgSelectionProofDigest/u);
assert.match(wrapper, /\[ValidateSet\("PreflightDryRun", "FormalBrowserGate"\)\][\s\S]*\[string\]\$ExecutionMode/u);
assert.doesNotMatch(wrapper, /\$ExecutionMode\s*=/u);
assert.match(wrapper, /if \(\$head -ne \$ExpectedGateControlCommit\) \{ Fail "LOCAL_GATE_CONTROL_MISMATCH" \}/u);
assert.match(wrapper, /\$headParents\[1\] -ne \$c9BrowserGateControl/u);
assert.match(wrapper, /\$c9Parents\[1\] -ne \$c8BrowserGateControl/u);
assert.match(wrapper, /\$c8Parents\[1\] -ne \$c7BrowserGateControl/u);
assert.match(wrapper, /\$c7Parents\[1\] -ne \$c6BrowserGateControl/u);
assert.match(wrapper, /\$c6Parents\[1\] -ne \$c5BrowserGateControl/u);
assert.match(wrapper, /\$c5Parents\[1\] -ne \$c4BrowserGateControl/u);
assert.match(wrapper, /\$c4Parents\[1\] -ne \$initialBrowserGateControl/u);
assert.match(wrapper, /\$initialParents\[1\] -ne \$productionRecoveryControl/u);
assert.match(wrapper, /\$recoveryParents\[1\] -ne \$failedRecoveryControl/u);
assert.match(wrapper, /\$failedParents\[1\] -ne \$productCommit/u);
assert.match(wrapper, /Assert-ControlDiffPaths -BaseCommit \$c9BrowserGateControl -HeadCommit \$head -ExpectedPaths \$c10RepairGatePaths/u);
assert.match(wrapper, /Assert-ControlDiffPaths -BaseCommit \$c8BrowserGateControl -HeadCommit \$c9BrowserGateControl -ExpectedPaths \$c9RepairGatePaths/u);
assert.match(wrapper, /Assert-ControlDiffPaths -BaseCommit \$c7BrowserGateControl -HeadCommit \$c8BrowserGateControl -ExpectedPaths \$c8RepairGatePaths/u);
assert.match(wrapper, /Assert-ControlDiffPaths -BaseCommit \$c6BrowserGateControl -HeadCommit \$c7BrowserGateControl -ExpectedPaths \$c7RepairGatePaths/u);
assert.match(wrapper, /Assert-ControlDiffPaths -BaseCommit \$c5BrowserGateControl -HeadCommit \$c6BrowserGateControl -ExpectedPaths \$c6RepairGatePaths/u);
assert.match(wrapper, /Assert-ControlDiffPaths -BaseCommit \$c4BrowserGateControl -HeadCommit \$c5BrowserGateControl -ExpectedPaths \$historicalRepairGatePaths/u);
assert.match(wrapper, /Assert-ControlDiffPaths -BaseCommit \$initialBrowserGateControl -HeadCommit \$c4BrowserGateControl -ExpectedPaths \$historicalRepairGatePaths/u);
assert.match(wrapper, /Assert-ControlDiffPaths -BaseCommit \$productionRecoveryControl -HeadCommit \$initialBrowserGateControl -ExpectedPaths \$initialGatePaths/u);
assert.match(wrapper, /Assert-ControlDiffPaths -BaseCommit \$productionRecoveryControl -HeadCommit \$head -ExpectedPaths \$allowedGatePaths/u);
assert.match(wrapper, /function Get-SingleTrimmedLine[\s\S]*\$Lines\.GetValue\(0\)[\s\S]*function Invoke-GitScalar/u);
assert.doesNotMatch(wrapper, /\[string\]\(Invoke-Git[^\r\n]*\)\[0\]/u);
for (const path of COMPOSITE_GATE_BLOB_PATHS) assert.ok(wrapper.includes(`"${path}"`), `gate blob pin is missing: ${path}`);
for (const path of C7_GATE_REPAIR_PATHS) assert.ok(wrapper.includes(`"${path}"`), `C7 repair path is missing: ${path}`);
for (const path of C8_GATE_REPAIR_PATHS) assert.ok(wrapper.includes(`"${path}"`), `C8 repair path is missing: ${path}`);
for (const path of C9_GATE_REPAIR_PATHS) assert.ok(wrapper.includes(`"${path}"`), `C9 repair path is missing: ${path}`);
for (const path of C10_GATE_REPAIR_PATHS) assert.ok(wrapper.includes(`"${path}"`), `C10 repair path is missing: ${path}`);
for (const path of C6_GATE_REPAIR_PATHS) assert.ok(wrapper.includes(`"${path}"`), `C6 repair path is missing: ${path}`);
for (const path of PRODUCT_RUNTIME_TRUTH_PATHS) {
  assert.ok(wrapper.includes(`"${path}"`), `Product runtime truth blob pin is missing: ${path}`);
}
assert.match(wrapper, /\^\(\[AM\]\)`t/u);
assert.match(wrapper, /C7_GATE_REPAIR_DIFF_INVALID/u);
assert.match(wrapper, /C8_GATE_REPAIR_DIFF_INVALID/u);
assert.match(wrapper, /C9_GATE_REPAIR_DIFF_INVALID/u);
assert.match(wrapper, /C10_GATE_REPAIR_DIFF_INVALID/u);
assert.match(wrapper, /C6_GATE_REPAIR_DIFF_INVALID/u);
assert.match(wrapper, /GATE_COMPOSITE_DIFF_INVALID/u);
assert.ok(occurrences(wrapper, "Assert-MainCas \"MAIN_CAS_") >= 4);
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
assert.match(wrapper, /Initialize-TaskOwnedEdgePaths/u);
assert.match(wrapper, /NovelRC62Toolchains/u);
assert.match(wrapper, /TASK_OWNED_EDGE_NOT_PROVISIONED/u);
assert.doesNotMatch(wrapper, /RC6_2_[A-Z0-9_]*(?:EDGE|BROWSER)[A-Z0-9_]*\s*\)/u);
assert.ok(occurrences(wrapper, "$startInfo.EnvironmentVariables.Clear()") >= 4);
assert.match(wrapper, /GIT_NO_REPLACE_OBJECTS/u);
assert.match(wrapper, /GIT_OPTIONAL_LOCKS/u);
assert.match(wrapper, /core\.fsmonitor/u);
assert.match(wrapper, /core\.untrackedCache/u);
assert.equal(occurrences(wrapper, '"--untracked-files=all"'), 6);
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
assert.match(wrapper, /\$runnerDeadline = \[DateTime\]::UtcNow\.AddMilliseconds\(10800000\)/u);
assert.match(wrapper, /while \(-not \$runnerProcess\.HasExited\)[\s\S]*Update-BoundedProcessStreamCapture/u);
assert.equal(occurrences(wrapper, "Assert-NoGateResidue \"GATE_RESIDUE_"), 2);
assert.match(wrapper, /\$bridgeAfter\.Pid -ne \$bridgeBefore\.Pid/u);
assert.match(wrapper, /\$hubAfter\.Pid -ne \$hubBefore\.Pid/u);
assert.match(wrapper, /\$ollamaAfter\.Pid -ne \$ollamaBefore\.Pid/u);
assert.match(wrapper, /function Get-RequiredZeroHealthCounter/u);
assert.match(wrapper, /\$null -eq \$property -or \$null -eq \$property\.Value/u);
assert.doesNotMatch(wrapper, /\[int\]\$(?:bridge|hub)\.workload\.(?:active|queued)/u);
assert.match(wrapper, /\$runningModelsProperty\.Value -is \[Array\]/u);
assert.match(wrapper, /\$tagModelsProperty\.Value -is \[Array\]/u);
assert.match(wrapper, /serviceControlActionPerformed = \$false/u);
assert.match(wrapper, /observedServiceProcessHealthAndPinnedCodeStableAcrossGate = \$true/u);
assert.match(wrapper, /WORKTREE_STATUS_LINEARIZATION_FAILED/u);
assert.match(wrapper, /PRODUCTION_BROWSER_RUNTIME_RECEIPT_LINEARIZATION_FAILED/u);
assert.match(wrapper, /Invoke-CleanNodeContract \(\s*"production-runtime-receipt"/u);
assert.match(wrapper, /Invoke-CleanNodeContract "toolchain-receipt"/u);
assert.equal(occurrences(wrapper, '"toolchain-receipt"'), 2);
assert.match(wrapper, /function Assert-TaskOwnedEdgeToolchainReceipt/u);
assert.match(wrapper, /applicationRootPathDigest/u);
assert.match(wrapper, /sourceManifestDigest/u);
assert.match(wrapper, /applicationDirectoryDigest/u);
assert.match(wrapper, /TASK_OWNED_EDGE_REVALIDATION_DRIFT/u);
assert.ok(
  wrapper.indexOf('$toolchainReceiptText = Invoke-CleanNodeContract "toolchain-receipt"')
    < wrapper.indexOf('if ($ExecutionMode -eq "FormalBrowserGate") { Initialize-FormalAttempt }'),
  "full task-owned Edge receipt must precede formal claim creation",
);
const firstToolchainReceiptIndex = wrapper.indexOf('$toolchainReceiptText = Invoke-CleanNodeContract "toolchain-receipt"');
const formalInitializeIndex = wrapper.indexOf('if ($ExecutionMode -eq "FormalBrowserGate") { Initialize-FormalAttempt }');
const firstReceiptCas = wrapper.slice(firstToolchainReceiptIndex, formalInitializeIndex);
assert.match(firstReceiptCas, /WORKTREE_STATUS_AFTER_TOOLCHAIN_RECEIPT_FAILED/u);
assert.match(firstReceiptCas, /Assert-ControlLineage/u);
assert.match(firstReceiptCas, /Assert-TrackedGateBlobs/u);
assert.match(firstReceiptCas, /Assert-ProductRuntimeBlobs/u);
assert.match(firstReceiptCas, /Assert-MainCas "MAIN_CAS_AFTER_TOOLCHAIN_RECEIPT_FAILED"/u);
assert.ok(
  wrapper.lastIndexOf('"toolchain-receipt"')
    < wrapper.indexOf('Invoke-FormalAttemptTransition "LAUNCH_COMMITTED"'),
  "second task-owned Edge receipt must precede LAUNCH_COMMITTED",
);
const secondToolchainReceiptIndex = wrapper.lastIndexOf('"toolchain-receipt"');
const launchCommittedIndex = wrapper.indexOf('Invoke-FormalAttemptTransition "LAUNCH_COMMITTED"');
const secondReceiptCas = wrapper.slice(secondToolchainReceiptIndex, launchCommittedIndex);
assert.match(secondReceiptCas, /WORKTREE_STATUS_AFTER_LAUNCH_RECEIPT_FAILED/u);
assert.match(secondReceiptCas, /Assert-ControlLineage/u);
assert.match(secondReceiptCas, /Assert-TrackedGateBlobs/u);
assert.match(secondReceiptCas, /Assert-ProductRuntimeBlobs/u);
assert.match(secondReceiptCas, /Assert-MainCas "MAIN_CAS_AFTER_LAUNCH_RECEIPT_FAILED"/u);
for (const formalDigest of [
  "$formalWrapperDigest", "$formalRunnerDigest", "$formalContractDigest",
  "$formalAttemptStateDigest", "$terminalEvidenceDigest", "$runnerEnvelopeValidatorDigest",
]) assert.match(secondReceiptCas, new RegExp(formalDigest.replace("$", "\\$"), "u"));
assert.match(wrapper, /Invoke-CleanNodeContract "validate-production-runtime-receipt"/u);
assert.match(wrapper, /Assert-PersistedRuntimeReceipt/u);
assert.match(wrapper, /Invoke-CleanNodeContract "validate-evidence"/u);
assert.match(wrapper, /function Resolve-RunnerEnvelopeValidation/u);
assert.match(wrapper, /"validate-envelope"/u);
assert.match(wrapper, /RC6_2_FORMAL_RUNNER_ENVELOPE_PATH/u);
assert.match(wrapper, /RC6_2_FORMAL_RUNNER_ENVELOPE_SHA_PATH/u);
assert.match(wrapper, /runner-envelope-validation\.json/u);
assert.match(wrapper, /p24b-rc6\.2-formal-runner-envelope-validation-v1/u);
assert.match(wrapper, /validationFileSha256/u);
assert.match(wrapper, /PRODUCTION_BROWSER_RUNNER_ENVELOPE_VALIDATION_FAILED/u);
assert.match(wrapper, /RC6_2_RUNNER_TERMINAL_FAIL/u);
assert.match(wrapper, /FORMAL_RUNNER_ENVELOPE_STATE_VERIFY_FAILED/u);
assert.match(wrapper, /\$formalRunnerEnvelopeValidation\.validationDisposition -eq "VALIDATED"/u);
assert.match(wrapper, /\$formalRunnerEnvelopeValidation\.statusObserved -eq "PASS"/u);
assert.match(wrapper, /\$formalRunnerEnvelopeValidation\.observedExitCode -eq 0/u);
assert.match(wrapper, /\$expectedEnvelopeStatus = if \(\$runnerExitCode -eq 0\) \{ "PASS" \} else \{ "FAIL" \}/u);
assert.match(wrapper, /function Read-BoundedExactFile[\s\S]*\$null -ne \$before\.LinkType[\s\S]*\$null -ne \$after\.LinkType/u);
assert.match(wrapper, /Read-BoundedExactFile \$formalRunnerEnvelopeValidationPath 65536/u);
assert.doesNotMatch(wrapper, /\$runnerOutcome = if \(\$runnerPassValidated/u);
assert.doesNotMatch(wrapper, /Invoke-CleanNodeContract "validate-failure-evidence"/u);
assert.match(wrapper, /RedirectStandardInput = \$null -ne \$StandardInput/u);
assert.match(wrapper, /\$process\.StandardInput\.BaseStream\.Write\(\$standardInputBytes/u);
assert.match(wrapper, /\$process\.StandardInput\.BaseStream\.Flush\(\)/u);
assert.match(wrapper, /\$process\.StandardInput\.BaseStream\.Close\(\)/u);
assert.doesNotMatch(wrapper, /\$process\.StandardInput\.Write\(/u);
assert.match(wrapper, /\$StandardInput\.Length -gt 0 -and \$StandardInput\[0\] -eq \[char\]0xFEFF/u);
assert.doesNotMatch(wrapper, /\$StandardInput\.StartsWith\(\[string\]\[char\]0xFEFF\)/u);
assert.match(wrapper, /\$safeTerminalCodes\.Count -ne 1/u);
assert.match(wrapper, /\$unexpectedStderr\.Count -ne 0/u);
assert.match(wrapper, /production-browser-gate-c6-failure-\$ExpectedGateControlCommit\.json/u);
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
assert.match(wrapper, /schemaVersion = "p24b-rc6\.2-production-browser-gate-c6-failure-proof-v1"/u);
assert.match(wrapper, /sanitized = \$true[\s\S]*rawSecretsStored = \$false/u);
assert.match(wrapper, /lkgAuditRunId = \$ExpectedLkgAuditRunId/u);
assert.match(wrapper, /lkgAuditControlProofDigest = \$ExpectedLkgAuditControlProofDigest/u);
assert.match(wrapper, /lkgSelectionProofDigest = \$ExpectedLkgSelectionProofDigest/u);
assert.doesNotMatch(wrapper, /(?:stdout|stderr)Sha256\s*=/iu);
const failurePublisher = wrapper.slice(
  wrapper.indexOf("function Publish-C6FailureEvidence"),
  wrapper.indexOf("function Initialize-EvidenceDestination"),
);
assert.ok(failurePublisher.indexOf("ReadAllBytes($tempPath)") < failurePublisher.indexOf("$observedCasStatus = Get-MainCasStatus"));
assert.ok(failurePublisher.indexOf("$observedCasStatus = Get-MainCasStatus") < failurePublisher.indexOf("[IO.File]::Move($tempPath, $failureEvidencePath)"));
assert.ok(failurePublisher.lastIndexOf("ReadAllBytes($tempPath)") > failurePublisher.indexOf("$observedCasStatus = Get-MainCasStatus"));
assert.ok(failurePublisher.lastIndexOf("ReadAllBytes($tempPath)") < failurePublisher.indexOf("[IO.File]::Move($tempPath, $failureEvidencePath)"));
assert.ok(
  wrapper.lastIndexOf("Publish-C6FailureEvidence $runnerCapture")
  < wrapper.lastIndexOf("$mutex.ReleaseMutex()"),
);
assert.ok(
  wrapper.indexOf("$formalGateBoundaryEntered = $true")
  > wrapper.indexOf('if (-not $mutexHeld) { Fail "PRODUCTION_BROWSER_GATE_ALREADY_RUNNING" }'),
);
assert.ok(
  wrapper.indexOf('if ($ExecutionMode -eq "PreflightDryRun")')
  < wrapper.indexOf('$mutex = [Threading.Mutex]::new'),
);
assert.ok(
  wrapper.indexOf('if ($ExecutionMode -eq "PreflightDryRun")')
  < wrapper.indexOf('$ownedProfilePath = Assert-OwnedProfilePath'),
);
assert.ok(
  wrapper.indexOf('if ($ExecutionMode -eq "PreflightDryRun")')
  < wrapper.indexOf('$runnerProcess.Start()'),
);
assert.match(wrapper, /preflight-pass\.json/u);
assert.match(wrapper, /preflight-failure\.json/u);
assert.match(wrapper, /preflight-manifest\.json/u);
assert.match(wrapper, /EVIDENCE_WRITE_FAILED/u);
assert.match(wrapper, /preflight-emergency-\$preflightRunId\.json/u);
assert.match(wrapper, /NovelRC62EvidenceEmergency/u);
assert.match(wrapper, /PREFLIGHT_RECEIPT_LINEARIZATION_FAILED/u);
assert.match(wrapper, /commitMarker = "manifest-published-last-v1"/u);
const preflightBundlePublisher = wrapper.slice(
  wrapper.indexOf("function Publish-PreflightBundle"),
  wrapper.indexOf("function Publish-EmergencyPreflightFailure"),
);
const preflightManifestCommit = preflightBundlePublisher.lastIndexOf(
  "Publish-AtomicTextFile $preflightManifestPath",
);
assert.ok(preflightManifestCommit > preflightBundlePublisher.lastIndexOf("Assert-PersistedRuntimeReceipt"));
assert.ok(preflightManifestCommit > preflightBundlePublisher.lastIndexOf("Test-ExactRegularFileValue"));
assert.match(wrapper, /function Remove-OwnedExactFile/u);
const atomicTextPublisher = wrapper.slice(
  wrapper.indexOf("function Publish-AtomicTextFile"),
  wrapper.indexOf("function Get-OptionalFileDigest"),
);
assert.doesNotMatch(atomicTextPublisher, /Get-FileHash -LiteralPath \$Destination/u);
assert.match(
  wrapper,
  /catch \{\s*Publish-EmergencyPreflightFailure \$safePreflightCode\s*exit 2\s*\}/u,
);
assert.match(wrapper, /attemptConsumed = \$false[\s\S]*browserStarted = \$false[\s\S]*runnerStarted = \$false/u);
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
const formalRunnerPath = wrapper.slice(
  wrapper.indexOf('$runnerProcess = [Diagnostics.Process]::new()'),
  wrapper.indexOf('$runnerStage = "gate-linearization"'),
);
assert.match(formalRunnerPath, /Start-BoundedProcessStreamCapture/u);
assert.match(formalRunnerPath, /Update-BoundedProcessStreamCapture/u);
assert.match(formalRunnerPath, /Get-BoundedProcessStreamCapture/u);
assert.doesNotMatch(formalRunnerPath, /ReadToEndAsync/u);
const processStartOffset = formalRunnerPath.indexOf("$runnerProcess.Start()")
const localRunnerStartedOffset = formalRunnerPath.indexOf("$runnerStarted = $true")
const durableRunnerStartedOffset = formalRunnerPath.indexOf('Invoke-FormalAttemptTransition "RUNNER_STARTED"');
const captureStartOffset = formalRunnerPath.indexOf("Start-BoundedProcessStreamCapture");
assert.ok(
  processStartOffset >= 0
  && localRunnerStartedOffset > processStartOffset
  && durableRunnerStartedOffset > localRunnerStartedOffset
  && captureStartOffset > durableRunnerStartedOffset,
  "runner start, durable transition, and bounded capture order must remain exact",
);
for (const reason of [
  "runner-envelope-validation",
  "runner-output-too-large",
  "runner-failed",
]) {
  assert.ok(
    wrapper.indexOf(`\"${reason}\" { return \"`) < wrapper.indexOf("if ($PostcheckErrorCount -gt 0)"),
    `${reason} must take precedence over postcheck aggregation`,
  );
}

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
assert.doesNotMatch(browserRunner, /p24b-rc6\.2-network-zero-receipt-v1/u);
assert.match(browserRunner, /NETWORK_SENTINEL_SCHEMA = "p24b-rc6\.2-network-zero-receipt-v2"/u);
const sentinelScalarDeclaration = sourceSection(
  browserRunner,
  "const NETWORK_SENTINEL_SCALAR_EXPECTATIONS",
  "const NETWORK_SENTINEL_PROBE_SPECS",
  "frozen sentinel scalar declaration",
);
const compactSentinelScalarDeclaration = sentinelScalarDeclaration.replace(/\s+/gu, "");
const sentinelScalarDeclarationPrefix = "constNETWORK_SENTINEL_SCALAR_EXPECTATIONS=Object.freeze([";
assert.ok(compactSentinelScalarDeclaration.startsWith(sentinelScalarDeclarationPrefix));
assert.ok(compactSentinelScalarDeclaration.endsWith("]);"));
assert.equal(
  compactSentinelScalarDeclaration
    .slice(sentinelScalarDeclarationPrefix.length, -3)
    .replace(/,$/u, ""),
  NETWORK_SENTINEL_SCALAR_EXPECTATIONS.map((tuple) => JSON.stringify(tuple)).join(","),
  "runner sentinel scalar order, values, and assertion IDs must match the frozen v2 contract",
);
assert.match(
  browserRunner,
  /new Set\(\["setup", "generation", "all", "network-sentinel-only"\]\)\.has\(mode\)/u,
);
assert.match(browserRunner, /const networkSentinelOnly = mode === "network-sentinel-only"/u);
assert.match(browserRunner, /networkSentinelOnly[\s\S]*formalAttemptEnabled, false/u);
assert.match(browserRunner, /p24b-rc6\.2-network-sentinel-only-evidence-v1/u);
assert.match(browserRunner, /const handleReceiverRequest = \(request, response\) =>/u);
assert.match(browserRunner, /receiver = createServer\(handleReceiverRequest\)/u);
assert.match(browserRunner, /receiver\.listen\(0, "127\.0\.0\.1"/u);
const sentinelDigestContract = sourceSection(
  browserRunner,
  "function networkSentinelMatrixDigest(value)",
  "function firstNetworkSentinelScalarMismatch(value)",
  "v2 sentinel digest",
);
assert.match(
  sentinelDigestContract,
  /sha256Value\(`\$\{NETWORK_SENTINEL_SCHEMA\}\\n\$\{stableStringify\(body\)\}`\)/u,
);
const bootstrapDecisionContract = sourceSection(
  browserRunner,
  "async function requestRouteDecision(request)",
  "function safeBlockedRequestProjection(request, decision)",
  "one-shot sentinel bootstrap decision",
);
for (const marker of [
  'requestPhase === "bootstrap"',
  "sentinelBootstrapActive",
  "!sentinelBootstrapConsumed",
  "urlValue === sentinelBootstrapUrl",
  'normalizedMethod === "GET"',
  'request.resourceType() === "document"',
  "request.postDataBuffer() === null",
  'parsedUrl?.username === ""',
  'parsedUrl.password === ""',
  "NETWORK_SENTINEL_CREDENTIAL_HEADERS",
  "request.headersArray()",
  "request.redirectedFrom() === null",
  'parsedUrl.search === ""',
  'parsedUrl.hash === ""',
  'action: "continue-bootstrap"',
]) assert.ok(bootstrapDecisionContract.includes(marker), `bootstrap predicate marker is missing: ${marker}`);
const sentinelHttpRouteContract = sourceSection(
  browserRunner,
  "async function routeClosedAiRequest(route)",
  "function observeClosedAiRequest(request)",
  "sentinel HTTP route handling",
);
const consumeAt = sentinelHttpRouteContract.indexOf("sentinelBootstrapConsumed = true");
const allowedAt = sentinelHttpRouteContract.indexOf("sentinelBootstrapAllowedCount += 1");
const continueAt = sentinelHttpRouteContract.indexOf("await route.continue", allowedAt);
assert.ok(
  consumeAt >= 0 && allowedAt > consumeAt && continueAt > allowedAt,
  "bootstrap must be consumed and counted before route continuation",
);
for (const marker of [
  "sentinelProbeState.httpGetUrl",
  "sentinelProbeState.httpPostUrl",
  '"HTTP_GET"',
  '"HTTP_POST"',
  "probeRouteRecords[probeIndex]",
  'routeDecision: "blocked"',
  'routeDecision: "block-failed"',
  'routeDecision: "continued"',
  'routeDecision: "continue-failed"',
]) assert.ok(sentinelHttpRouteContract.includes(marker), `separate HTTP route record marker is missing: ${marker}`);
assert.match(
  sentinelHttpRouteContract,
  /routeDecision: "block-failed",\s*reasonCodes: \[\.\.\.decision\.reasonCodes\]/u,
);
assert.match(
  sentinelHttpRouteContract,
  /routeDecision: "continue-failed",\s*reasonCodes: \[\]/u,
);
const sentinelWebSocketRouteContract = sourceSection(
  browserRunner,
  "async function routeClosedAiWebSocket(webSocketRoute)",
  "async function routeClosedAiRequest(route)",
  "sentinel WebSocket route handling",
);
for (const marker of [
  "probeState.webSocketUrl",
  "probeRouteRecords[2]",
  'probeId: "WEBSOCKET"',
  'routeDecision: "blocked"',
  'routeDecision: "block-failed"',
]) assert.ok(sentinelWebSocketRouteContract.includes(marker), `WebSocket route record marker is missing: ${marker}`);
assert.match(
  sentinelWebSocketRouteContract,
  /routeDecision: "block-failed",\s*reasonCodes: \["network-classification-blocked"\]/u,
);
for (const finiteResult of [
  "route-action-failed", "evaluation-failed", "unexpected-rejection",
]) assert.ok(browserRunner.includes(`"${finiteResult}"`), `finite sentinel result is missing: ${finiteResult}`);
const sentinelLifecycleContract = sourceSection(
  browserRunner,
  "async function runPreNavigationNetworkSentinel()",
  "async function assertExactOrigin()",
  "deterministic sentinel lifecycle",
);
for (const marker of [
  "randomBytes(16)",
  "bootstrapReceiverHttpCount",
  "receiverBaseline",
  "httpGetUrl",
  "httpPostUrl",
  "webSocketUrl",
  "probeRouteRecords",
  "operationalErrorCount",
  "tcpConnectionReceiptDelta",
  "httpRequestReceiptDelta",
  "httpRequestBodyByteDelta",
  "webSocketUpgradeReceiptDelta",
  "firstFailedScalarAssertion: null",
  "finalizeNetworkSentinelMatrix({",
  'page.goto("about:blank"',
  "receiver.close",
  "sentinelBootstrapUrl = null",
  'nonce = ""',
  "resetPreNavigationSentinelPolicyCounters()",
]) assert.ok(sentinelLifecycleContract.includes(marker), `sentinel lifecycle marker is missing: ${marker}`);
assert.ok(
  sentinelScalarDeclaration.includes("NETWORK_SENTINEL_OPERATION_COMPLETED"),
  "sentinel operational-error scalar must bind its finite assertion ID",
);
const sentinelMatrixBuildContract = sentinelLifecycleContract.slice(
  sentinelLifecycleContract.indexOf("let matrix = finalizeNetworkSentinelMatrix({"),
);
assert.match(sentinelMatrixBuildContract, /^\s*bootstrapReceiverHttpCount,\s*$/mu);
assert.doesNotMatch(
  sentinelLifecycleContract,
  /assert\.equal\((?:tcpConnectionReceiptCount|httpRequestReceiptCount|httpRequestBodyByteCount|webSocketUpgradeReceiptCount), 0\)/u,
);
const sentinelResetContract = sourceSection(
  browserRunner,
  "function resetPreNavigationSentinelPolicyCounters()",
  "async function runPreNavigationNetworkSentinel()",
  "sentinel-only counter reset",
);
assert.match(sentinelResetContract, /sentinelProbeState = null/u);
assert.match(sentinelResetContract, /sentinelBootstrapActive = false/u);
for (const productCounter of [
  "blockedNetworkPolicyAttemptCount",
  "disallowedCrossOriginRequestCount",
  "disallowedMethodRequestCount",
  "observedWebSocketAttemptCount",
  "blockedWebSocketAttemptCount",
  "disallowedWebSocketAttemptCount",
]) assert.doesNotMatch(sentinelResetContract, new RegExp(`\\b${productCounter}\\b`, "u"));
assert.match(runtimeContract, /same-origin POST[\s\S]*method-not-allowed/u);
assert.match(runtimeContract, /external AI GET[\s\S]*prohibited-external-ai/u);
assert.match(runtimeContract, /await persistentContext\\\.route/u);
assert.match(runtimeContract, /NETWORK_SENTINEL_SCHEMA = "p24b-rc6\.2-network-zero-receipt-v2"/u);
assert.match(runtimeContract, /consumeBeforeContinue/u);
assert.match(runtimeContract, /NETWORK_SENTINEL_PASS_ROUTE_RECORDS/u);
assert.match(runtimeContract, /networkSentinelDigest/u);
assert.doesNotMatch(
  runtimeContract,
  /schemaVersion:\s*"p24b-rc6\.2-network-zero-receipt-v1"/u,
);
const forbiddenNetworkSentinelDependencySources = [
  ["from ", '"@playwright/test"'].join(""),
  ["from ", '"node:http"'].join(""),
  ["const receiver", " = createServer"].join(""),
];
for (const forbiddenDependencySource of forbiddenNetworkSentinelDependencySources) {
  assert.equal(runtimeContract.includes(forbiddenDependencySource), false);
}
assert.match(networkSentinelContract, /new Set\(\["unit", "mutations", "all"\]\)/u);
assert.match(networkSentinelContract, /browserLaunchCount: 0/u);
assert.match(networkSentinelContract, /edgeLaunchCount: 0/u);
assert.match(networkSentinelContract, /playwrightLaunchCount: 0/u);
assert.match(networkSentinelContract, /networkRequestCount: 0/u);
for (const forbiddenDependencySource of forbiddenNetworkSentinelDependencySources) {
  assert.equal(networkSentinelContract.includes(forbiddenDependencySource), false);
}
const packageScripts = JSON.parse(packageSource).scripts;
assert.equal(
  packageScripts["test:rc6.2:network-sentinel-unit"],
  "node scripts/run-rc6-2-network-sentinel-tests.mjs unit",
);
assert.equal(
  packageScripts["test:rc6.2:network-sentinel-mutations"],
  "node scripts/run-rc6-2-network-sentinel-tests.mjs mutations",
);
assert.equal(
  packageScripts["test:rc6.2:network-sentinel-real-edge"],
  "node scripts/run-rc6-2-closed-agent-browser.mjs network-sentinel-only",
);
assert.equal(
  packageScripts["test:rc6.2:task-owned-edge-network-sentinel"],
  "node scripts/run-rc6-2-production-browser-gate-contract.mjs task-owned-edge-network-sentinel",
);
assert.equal(
  packageScripts["test:rc6.2:task-owned-edge-policy"],
  "node scripts/run-rc6-2-production-browser-gate-contract.mjs test-task-owned-edge-policy",
);
assert.equal(
  packageScripts["test:rc6.2:task-owned-edge-toolchain"],
  "node scripts/run-rc6-2-production-browser-gate-contract.mjs task-owned-edge-toolchain-receipt",
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

if (process.argv[2] === "task-owned-edge-network-sentinel") {
  await runTaskOwnedEdgeNetworkSentinel();
} else if (process.argv[2] === "validate-evidence") {
  await validateEvidence();
} else if (process.argv[2] === "validate-failure-evidence") {
  await validateFailureEvidence();
} else {
  assert.equal(process.argv.length, 2);
  console.log("P2.4B RC6.2 production browser gate contract: PASS");
}

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

Error.stackTraceLimit = 0;

const RUNNER_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(RUNNER_PATH), "..");
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/u;
const LIVE_ENV = "NOVEL_RC65_BROWSER_PROSE_QUALIFICATION_LIVE_ONCE";
const LIVE_CONFIG_ENV = "NOVEL_RC65_BROWSER_PROSE_QUALIFICATION_CONFIG";
const PRIOR_CANDIDATE_IDENTITY =
  "613a38d1d9201eed8acdb4851b4a7674e5e1baacdc5faf84d405352d6293af41";
const CANDIDATE_IDENTITY =
  "757c58b5e1bbc327a0dafe530e31d42908eb19c2c0fa83518f7790c885b2fbdb";
const CANDIDATE_LINEAGE_ENVELOPE = Object.freeze({
  schemaVersion: "p2.4b-rc6.5-browser-prose-candidate-identity-envelope-v2",
  candidateOrdinal: 2,
  priorCandidateIdentityDigest: PRIOR_CANDIDATE_IDENTITY,
  priorCandidateOrdinal: 1,
  priorCandidateStatus: "not-qualified",
  priorCandidateSafeCode: "QUALIFICATION_SETUP_NETWORK_NOT_CLOSED",
  priorCandidateTerminalFailureSha256:
    "7de5fbb614e5964f77ac691300356f6b8cbf6d21c53da55d031bf330ed343a4a",
  finalSourceFreezeAuthoritySha256:
    "2d82f47d6bf6c74987ee58b6e0300efb68b4cdf4ae050623539abd0e0fff34d8",
  edgeExecutableSha256:
    "af02a342b7e6fa7d1154d9152b5997ff2be300b3a7a678feaae863c9fbea32cb",
  edgeDllSha256:
    "29b191751916dbfe5ed4206022a0d7ab45bd79966d9074ed872112d1865dcec6",
  modelCacheVaultManifestSha256:
    "8710f97dd4ea031fb266b9fd44b3a98d6277a20957de3c2c83f43876eb881e2e",
  modelCachePayloadDigest:
    "f052b1f3d1e860b217a6c8bf25f3cd33da34c90b23e58c5c7134da5f941954b1",
  edgeManagedPreferencesSeedSha256:
    "6ffc3a019bf36a5444fa01268fb48fc7e8e57fcafb64625609478d672dd69e96",
  edgeShoppingNetworkSuppressionMode: "pinned-edge-disable-features-v1",
  edgeShoppingNetworkSuppressionFeatures: Object.freeze([
    "msEdgeShoppingCohorts",
    "msEdgeShoppingFSASettings",
    "msEdgeShoppingFSASettingsPDPEvent",
    "msEdgeShoppingServerNotifications",
  ]),
});
const LIVE_TOKEN_PREFIX = "P2.4B_RC6_5_LIVE_ONCE_" + CANDIDATE_IDENTITY + "_";
const MUTEX_NAME =
  "Global\\Novel_P2_4B_RC6_5_BrowserProseCandidateV2_" + CANDIDATE_IDENTITY;
const QUALIFICATION_SCHEMA =
  "p2.4b-rc6.5-browser-prose-candidate-v2-edge-qualification-v1";
const OBSERVATION_SCHEMA =
  "p2.4b-rc6.5-browser-prose-candidate-v2-edge-observation-v1";
const REGISTRY_SCHEMA =
  "p2.4b-rc6.5-browser-prose-candidate-registry-v1";
const STARTED_SCHEMA =
  "p2.4b-rc6.5-browser-prose-candidate-started-v1";
const PROFILE_OWNER_SCHEMA =
  "p2.4b-rc6.5-browser-prose-qualification-profile-owner-v1";
const BRIDGE_SCHEMA =
  "p2.4b-rc6.5-c-to-d-edge-authority-bridge-v1";
const CONFIG_SCHEMA =
  "p2.4b-rc6.5-browser-prose-qualification-live-config-v1";
const EVIDENCE_SCHEMA =
  "p2.4b-rc6.5-browser-prose-qualification-evidence-v1";
const NETWORK_POLICY_SCHEMA =
  "p2.4b-rc6.5-browser-prose-network-policy-v1";
const ADAPTER_SCHEMA =
  "p2.4b-rc6.5-browser-prose-qualification-adapter-v1";
const TUNING_FREEZE_SCHEMA =
  "p2.4b-rc6.5-browser-prose-observed-tuning-freeze-v1";
const SOURCE_FREEZE_SCHEMA =
  "p2.4b-rc6.5-browser-prose-qualification-source-freeze-v2";
const VAULT_MANIFEST_SCHEMA =
  "p2.4b-rc6.5-browser-prose-qualification-vault-manifest-v1";
const ADAPTER_GLOBAL =
  "__NOVEL_RC6_5_BROWSER_PROSE_CANDIDATE_V2_QUALIFICATION__";
const SOURCE_ARTIFACT_ROLES = Object.freeze([
  "source-freeze",
  "build-manifest",
  "static-manifest",
  "static-bundle",
  "vault-manifest",
]);
const RUNNER_RELATIVE_PATH =
  "scripts/run-rc6-5-browser-prose-qualification-edge.mjs";
const FINAL_SOURCE_FREEZE_AUTHORITY_SHA256 =
  "2d82f47d6bf6c74987ee58b6e0300efb68b4cdf4ae050623539abd0e0fff34d8";
const FINAL_SOURCE_FREEZE_AUTHORITY_PATH =
  "D:\\evidence\\novel\\p2.4b-rc6.5-browser-prose-v2\\20260822T0138237085294Z"
  + "\\source-final-freeze-excluding-qualification-runner"
  + "\\final-source-freeze-authority.json";
const FINAL_SOURCE_FREEZE_STATUS_PATH_SET_SHA256 =
  "f950e0273a4d7bd281a33bfd3dbb881ad7b339f377487a40c0eb51ed16dcd14d";
const FINAL_SOURCE_FREEZE_CONTENT_SET_SHA256 =
  "c119b38ac31232401ba9247371eb1564580605cc240cf4aa77aea38a972f9332";
const PLAYWRIGHT_TEST_PACKAGE = "@playwright/test";
const PLAYWRIGHT_TEST_RESOLUTION = import.meta.resolve("@playwright/test");
const EDGE_MANAGED_PREFERENCES_SEED = Object.freeze({
  FetchShoppingSettingsOnStartUp: true,
  edge_shopping_assistant_enabled: false,
  profile: Object.freeze({
    managed_default_content_settings: Object.freeze({ ads: 1 }),
  }),
  shopping: Object.freeze({
    contextual_features_enabled: false,
  }),
});
const EDGE_SHOPPING_NETWORK_SUPPRESSION_FEATURES = Object.freeze([
  ...CANDIDATE_LINEAGE_ENVELOPE.edgeShoppingNetworkSuppressionFeatures,
]);
const EDGE_MOUSE_GESTURE_NETWORK_SUPPRESSION_FEATURES = Object.freeze([
  "msEdgeMouseGestureDefaultEnabled",
  "msEdgeMouseGestureSupported",
]);
const EDGE_DISABLED_FEATURES = Object.freeze([
  "AvoidUnnecessaryBeforeUnloadCheckSync",
  "BoundaryEventDispatchTracksNodeRemoval",
  "DestroyProfileOnBrowserClose",
  "DialMediaRouteProvider",
  "GlobalMediaControls",
  "HttpsUpgrades",
  "LensOverlay",
  "MediaRouter",
  "NetworkTimeServiceQuerying",
  "PaintHolding",
  "PreconnectToSearch",
  "PreconnectToSearchNonBing",
  "ThirdPartyStoragePartitioning",
  "Translate",
  "AutoDeElevate",
  "RenderDocument",
  "OptimizationHints",
  "msBrowserSignInAllowedByPolicy",
  "msDesktopRewards",
  "msEdgeOnlineAccounts",
  "msEdgeOSAccountInfoSubstrate",
  "msForceBrowserSignIn",
  "msIdentityCore",
  "msImplicitSignin",
  "msLoadOneAuthInBackground",
  "msOneAuthWAM",
  "msPrimaryOSAccountInfoCache",
  "msSigninRewards",
  ...EDGE_MOUSE_GESTURE_NETWORK_SUPPRESSION_FEATURES,
  ...EDGE_SHOPPING_NETWORK_SUPPRESSION_FEATURES,
  "msEdgeUpdateLaunchServicesPreferredVersion",
  "msUXConfigService",
  "msUXConfigServiceV3",
]);
const EDGE_LAUNCH_POLICY = Object.freeze({
  serviceWorkers: "block",
  proxyBypassConfigured: false,
  args: Object.freeze([
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-features=" + EDGE_DISABLED_FEATURES.join(","),
    "--disable-component-update",
    "--disable-sync",
    "--disable-quic",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--proxy-bypass-list=<-loopback>",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
  ]),
});
const STATE_ORDER = Object.freeze([
  "Preflight",
  "Development",
  "Holdout",
  "Warm",
  "CancelRetry",
  "Decision",
  "Cleanup",
  "Seal",
  "Sealed",
]);
const SEGMENTS = Object.freeze(["action", "reaction", "consequence"]);
const DEVELOPMENT_FIXTURES = Object.freeze([
  "rc65-development-01",
  "rc65-development-02",
  "rc65-development-03",
  "rc65-development-04",
  "rc65-development-05",
]);
const HOLDOUT_FIXTURES = Object.freeze([
  "rc65-holdout-01",
  "rc65-holdout-02",
  "rc65-holdout-03",
  "rc65-holdout-04",
  "rc65-holdout-05",
]);
const BLOCKED_RC64_IDENTITIES = Object.freeze([
  "5dad4b92027be971309636ef52f3f00c76409c82baece122fe950168fd26bd85",
  "f50f9153fca22f7965c68a11a61a101b757072b5d3cb1b7f29d149f8b7c676c8",
]);
const BASE_COMMIT = "03fdbf3a6cf04aaca300c89d31326c6ccc0af89c";
const CANDIDATE_RUNTIME_POLICY_DIGEST =
  "1bd1ddb3713e315f2872a9e39fab9e95736f015253bbab77baaada4506eaf3f0";
const AUTHORITY = Object.freeze({
  archiveManifestSha256:
    "fcd2be399c356bfa0600e1aa936588e9328c8667e74ec36cc396189e37bb03e4",
  relocationAuthoritySha256:
    "208a9934d8f4004b368ba1e738a9c3f77f0403699cd4f30f4dc597d46c08329d",
  cToDPathMapSha256:
    "a3d33864c36ef4fe486644702dc9cab3eda96131d3aa2cdfce8b61bd1ba5ab00",
  junctionMapSha256:
    "12b53214c6edfba5cba2ba7695ec2fdbaaa0cb332126bf9473d182519ea6c179",
  environmentPathsSha256:
    "539559653094ccab3d566ff6fc148c12ce2ebfecffafe25e39d6507b5ff3f3bf",
  priorC10ReceiptSha256:
    "c4225b24592721df92545343b1732cdb2e671b240872cd7606ee11de668851ba",
  priorC10ProofDigest:
    "55e15bc7c4ab277b2ba347dc025fe92b763c5ca75f4fd1528643f1daab2d80dc",
  edgeManifestSha256:
    "2e9a981c925362aedc3b7202a2aac0ef165b3b9e774bb44344a255cc3f36c4cd",
  edgeManifestDigest:
    "cc7564ed83797ee8ab21a8101ab473592c0b05fc9fd14915e8c5db75ef806f06",
  edgeTreeDigest:
    "bf2e1fe3a62d67d1c9915191b161c64b99203bbbe03e88c07ab7aa7ab295d273",
  edgeExecutableSha256:
    "af02a342b7e6fa7d1154d9152b5997ff2be300b3a7a678feaae863c9fbea32cb",
  edgeDllSha256:
    "29b191751916dbfe5ed4206022a0d7ab45bd79966d9074ed872112d1865dcec6",
  cCompatibilityRoot: "C:\\Users\\user\\AppData\\Local\\NovelRC62Toolchains",
  dToolchainRoot: "D:\\dev\\novel-p24b-rc7-toolchains",
  dEdgeExecutable:
    "D:\\dev\\novel-p24b-rc7-toolchains\\Edge\\151.0.4129.78\\Application\\msedge.exe",
  dEdgeDll:
    "D:\\dev\\novel-p24b-rc7-toolchains\\Edge\\151.0.4129.78\\Application\\151.0.4129.78\\msedge.dll",
});
const FORBIDDEN_EVIDENCE_KEYS = new Set([
  "content",
  "output",
  "rawoutput",
  "prompt",
  "rawprompt",
  "storybible",
  "currentchapter",
  "chapter",
  "chainofthought",
  "reasoning",
  "tokendelta",
  "rawurl",
  "url",
  "uri",
  "href",
  "origin",
  "hostname",
  "host",
  "requestbody",
  "responsebody",
  "text",
]);

class QualificationError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = "QualificationError";
    this.code = code;
  }
}

function fail(code, cause) {
  throw new QualificationError(code, cause ? { cause } : undefined);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value, seen = new Set()) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("NON_FINITE_JSON_VALUE");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") fail("NON_JSON_VALUE");
  if (seen.has(value)) fail("CYCLIC_JSON_VALUE");
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = "[" + value.map((entry) => stableJson(entry, seen)).join(",") + "]";
  } else {
    const keys = Object.keys(value).sort();
    result = "{" + keys.map((key) => (
      JSON.stringify(key) + ":" + stableJson(value[key], seen)
    )).join(",") + "}";
  }
  seen.delete(value);
  return result;
}

function exactKeys(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) fail(code);
}

function assertSha256(value, code) {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) fail(code);
  return value;
}

function canonicalBytes(value) {
  return Buffer.from(stableJson(value) + "\n", "utf8");
}

function deriveCandidateIdentityFromLineageEnvelope() {
  return sha256(
    "p2.4b-rc6.5-browser-prose-candidate-identity-v2\n"
      + stableJson(CANDIDATE_LINEAGE_ENVELOPE),
  );
}

function normalizeForIdentity(value) {
  return path.win32.normalize(path.resolve(value))
    .replaceAll("/", "\\")
    .toLocaleLowerCase("en-US");
}

function isDDrive(value) {
  return /^[dD]:\\/u.test(path.win32.normalize(path.resolve(value)));
}

function isWithin(parent, child) {
  const parentValue = normalizeForIdentity(parent);
  const childValue = normalizeForIdentity(child);
  return childValue === parentValue || childValue.startsWith(parentValue + "\\");
}

function assertDPath(value, options = {}) {
  const code = options.code || "D_PATH_INVALID";
  if (typeof value !== "string" || !path.win32.isAbsolute(value)) fail(code);
  if (value.split(/[\\/]/u).includes("..")) fail(code);
  const resolved = path.win32.normalize(path.win32.resolve(value));
  if (!isDDrive(resolved)) fail(code);
  const mustExist = options.mustExist !== false;
  if (!mustExist) {
    let ancestor = resolved;
    while (!existsSync(ancestor)) {
      const parent = path.win32.dirname(ancestor);
      if (parent === ancestor) fail(code);
      ancestor = parent;
    }
    assertDPath(ancestor, { code, mustExist: true, kind: "directory" });
    return resolved;
  }
  const info = lstatSync(resolved, { throwIfNoEntry: false });
  if (!info) fail(code);
  if (info.isSymbolicLink()) fail(code + "_REPARSE");
  if (options.kind === "file" && !info.isFile()) fail(code);
  if (options.kind === "directory" && !info.isDirectory()) fail(code);
  const canonical = realpathSync.native(resolved);
  if (!isDDrive(canonical) || normalizeForIdentity(canonical) !== normalizeForIdentity(resolved)) {
    fail(code + "_NOT_PHYSICAL");
  }
  let current = path.win32.parse(resolved).root;
  for (const segment of resolved.slice(current.length).split("\\").filter(Boolean)) {
    current = path.win32.join(current, segment);
    const currentInfo = lstatSync(current, { throwIfNoEntry: false });
    if (!currentInfo || currentInfo.isSymbolicLink()) fail(code + "_ANCESTOR_REPARSE");
  }
  return resolved;
}

function readCanonicalJson(file, options = {}) {
  const resolved = options.allowContractPath
    ? path.win32.normalize(path.win32.resolve(file))
    : assertDPath(file, {
      code: options.code || "CANONICAL_JSON_PATH_INVALID",
      kind: "file",
    });
  const info = lstatSync(resolved, { throwIfNoEntry: false });
  if (!info?.isFile() || info.isSymbolicLink() || info.size < 2
    || info.size > (options.maxBytes || 2 * 1024 * 1024)) {
    fail(options.code || "CANONICAL_JSON_FILE_INVALID");
  }
  const raw = readFileSync(resolved);
  let value;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    fail((options.code || "CANONICAL_JSON_FILE_INVALID") + "_PARSE", error);
  }
  if (!raw.equals(canonicalBytes(value))) {
    fail((options.code || "CANONICAL_JSON_FILE_INVALID") + "_NONCANONICAL");
  }
  const digest = sha256(raw);
  if (options.expectedSha256 && digest !== options.expectedSha256) {
    fail((options.code || "CANONICAL_JSON_FILE_INVALID") + "_DIGEST");
  }
  if (options.requireSidecar) {
    const sidecarPath = resolved + ".sha256";
    const expected = digest + "  " + path.win32.basename(resolved) + "\n";
    if (
      !existsSync(sidecarPath)
      || readFileSync(sidecarPath, "utf8") !== expected
      || lstatSync(sidecarPath).isSymbolicLink()
    ) fail((options.code || "CANONICAL_JSON_FILE_INVALID") + "_SIDECAR");
  }
  return Object.freeze({ path: resolved, value, digest, bytes: raw.length });
}

function writeCanonicalExclusive(file, value, options = {}) {
  const resolved = path.win32.normalize(path.win32.resolve(file));
  const root = path.win32.normalize(path.win32.resolve(options.allowedRoot || path.dirname(resolved)));
  if (!isDDrive(resolved) || !isWithin(root, resolved) || !existsSync(root)) {
    fail("EXCLUSIVE_WRITE_PATH_INVALID");
  }
  assertNoForbiddenEvidence(value);
  const bytes = canonicalBytes(value);
  let descriptor;
  try {
    descriptor = openSync(resolved, "wx", 0o444);
  } catch (error) {
    fail("EXCLUSIVE_WRITE_ALREADY_EXISTS", error);
  }
  try {
    writeFileSync(descriptor, bytes);
  } finally {
    closeSync(descriptor);
  }
  const digest = sha256(bytes);
  const sidecar = resolved + ".sha256";
  let sidecarDescriptor;
  try {
    sidecarDescriptor = openSync(sidecar, "wx", 0o444);
  } catch (error) {
    fail("EXCLUSIVE_SIDECAR_ALREADY_EXISTS", error);
  }
  try {
    writeFileSync(
      sidecarDescriptor,
      digest + "  " + path.win32.basename(resolved) + "\n",
      "utf8",
    );
  } finally {
    closeSync(sidecarDescriptor);
  }
  return Object.freeze({ path: resolved, sidecar, digest, bytes: bytes.length });
}

function normalizedEvidenceKey(key) {
  return key.replaceAll(/[^A-Za-z0-9]/gu, "").toLocaleLowerCase("en-US");
}

function assertNoForbiddenEvidence(value, pointer = "$", seen = new Set()) {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) fail("EVIDENCE_CYCLE_FORBIDDEN");
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertNoForbiddenEvidence(entry, pointer + "[" + index + "]", seen);
    });
  } else {
    for (const [key, entry] of Object.entries(value)) {
      const normalized = normalizedEvidenceKey(key);
      if (FORBIDDEN_EVIDENCE_KEYS.has(normalized)) {
        fail("RAW_EVIDENCE_KEY_FORBIDDEN");
      }
      if (
        typeof entry === "string"
        && /(?:^|[\\/])NovelRC62FormalAttempts(?:[\\/]|$)/iu.test(entry)
      ) fail("RC6_4_FORMAL_PATH_FORBIDDEN");
      assertNoForbiddenEvidence(entry, pointer + "." + key, seen);
    }
  }
  seen.delete(value);
}

function assertNotRc64Formal(value) {
  const serialized = stableJson(value).toLocaleLowerCase("en-US");
  if (
    serialized.includes("p2.4b-rc6.4-formal")
    || serialized.includes("rc6-4-formal-browser")
    || serialized.includes("novelrc62formalattempt")
  ) fail("RC6_4_FORMAL_CONTROL_REUSE_FORBIDDEN");
}

function validateArtifactBinding(binding, expectedRole, options = {}) {
  exactKeys(binding, [
    "canonicalJson",
    "path",
    "role",
    "sha256",
    "sidecarRequired",
  ], "ARTIFACT_BINDING_SHAPE_INVALID");
  if (
    binding.role !== expectedRole
    || typeof binding.canonicalJson !== "boolean"
    || typeof binding.sidecarRequired !== "boolean"
  ) fail("ARTIFACT_BINDING_INVALID");
  assertSha256(binding.sha256, "ARTIFACT_BINDING_DIGEST_INVALID");
  const resolved = options.allowContractPath
    ? path.win32.normalize(path.win32.resolve(binding.path))
    : assertDPath(binding.path, { code: "ARTIFACT_PATH_INVALID", kind: "file" });
  const info = lstatSync(resolved, { throwIfNoEntry: false });
  if (!info?.isFile() || info.isSymbolicLink() || sha256(readFileSync(resolved)) !== binding.sha256) {
    fail("ARTIFACT_DIGEST_MISMATCH");
  }
  if (binding.canonicalJson) {
    readCanonicalJson(resolved, {
      allowContractPath: options.allowContractPath,
      code: "ARTIFACT_CANONICAL_JSON_INVALID",
      expectedSha256: binding.sha256,
      requireSidecar: binding.sidecarRequired,
    });
  } else if (binding.sidecarRequired) {
    const expected = binding.sha256 + "  " + path.win32.basename(resolved) + "\n";
    if (readFileSync(resolved + ".sha256", "utf8") !== expected) {
      fail("ARTIFACT_SIDECAR_MISMATCH");
    }
  }
  return Object.freeze({
    role: expectedRole,
    sha256: binding.sha256,
    pathDigest: sha256(normalizeForIdentity(resolved)),
    resolvedPath: resolved,
  });
}

function sourceFreezeIdentityBody(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    candidateIdentityDigest: manifest.candidateIdentityDigest,
    baseCommit: manifest.baseCommit,
    originMain: manifest.originMain,
    changedPathCount: manifest.changedPathCount,
    trackedModifiedCount: manifest.trackedModifiedCount,
    untrackedCount: manifest.untrackedCount,
    changedPathSetDigest: manifest.changedPathSetDigest,
    changedContentSetDigest: manifest.changedContentSetDigest,
    changedFiles: manifest.changedFiles,
    runnerSha256: manifest.runnerSha256,
    finalAuthorityPathDigest: manifest.finalAuthorityPathDigest,
    finalAuthoritySha256: manifest.finalAuthoritySha256,
    finalAuthorityStatusPathSetSha256: manifest.finalAuthorityStatusPathSetSha256,
    finalAuthorityChangedPathCount: manifest.finalAuthorityChangedPathCount,
    buildManifestSha256: manifest.buildManifestSha256,
    staticManifestSha256: manifest.staticManifestSha256,
    adapterBundleSha256: manifest.adapterBundleSha256,
    adapterDigest: manifest.adapterDigest,
    vaultManifestSha256: manifest.vaultManifestSha256,
    candidateRegistrySha256: manifest.candidateRegistrySha256,
    adapterRuntimePolicyDigest: manifest.adapterRuntimePolicyDigest,
    sourceFrozen: manifest.sourceFrozen,
    productionPassClaimed: manifest.productionPassClaimed,
  };
}

function runGitText(args, code) {
  const result = spawnSync("git", args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  if (result.status !== 0 || result.signal || result.error) fail(code, result.error);
  return result.stdout.trim();
}

function captureCurrentGitTruth() {
  const statusResult = spawnSync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "buffer",
      windowsHide: true,
      timeout: 30_000,
    },
  );
  if (statusResult.status !== 0 || statusResult.signal || statusResult.error) {
    fail("SOURCE_FREEZE_GIT_STATUS_FAILED", statusResult.error);
  }
  const raw = statusResult.stdout.toString("utf8");
  const tokens = raw.split("\0");
  if (tokens.at(-1) !== "") fail("SOURCE_FREEZE_GIT_STATUS_INVALID");
  tokens.pop();
  const files = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.length < 4 || token[2] !== " ") {
      fail("SOURCE_FREEZE_GIT_STATUS_INVALID");
    }
    const porcelainStatus = token.slice(0, 2);
    if (/[RC]/u.test(porcelainStatus)) {
      fail("SOURCE_FREEZE_RENAME_OR_COPY_FORBIDDEN");
    }
    const relativePath = token.slice(3).replaceAll("\\", "/");
    if (
      !relativePath
      || path.posix.isAbsolute(relativePath)
      || relativePath.split("/").includes("..")
    ) fail("SOURCE_FREEZE_STATUS_PATH_INVALID");
    const absolutePath = path.resolve(REPOSITORY_ROOT, ...relativePath.split("/"));
    if (!isWithin(REPOSITORY_ROOT, absolutePath)) {
      fail("SOURCE_FREEZE_STATUS_PATH_ESCAPE");
    }
    const info = lstatSync(absolutePath, { throwIfNoEntry: false });
    if (!info?.isFile() || info.isSymbolicLink()) {
      fail("SOURCE_FREEZE_STATUS_FILE_INVALID");
    }
    const status = porcelainStatus === "??" ? "??" : porcelainStatus.trim();
    if (status !== "??" && status !== "M") {
      fail("SOURCE_FREEZE_STATUS_CLASS_INVALID");
    }
    files.push({
      status,
      path: relativePath,
      sha256: sha256(readFileSync(absolutePath)),
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path, "en-US"));
  const trackedModifiedCount = files.filter((row) => row.status === "M").length;
  const untrackedCount = files.filter((row) => row.status === "??").length;
  const pathRows = files.map((row) => row.status + "\t" + row.path + "\n").join("");
  const contentRows = files.map((row) => (
    row.status + "\t" + row.path + "\t" + row.sha256 + "\n"
  )).join("");
  return Object.freeze({
    head: runGitText(["rev-parse", "HEAD"], "SOURCE_FREEZE_HEAD_READ_FAILED"),
    originMain: runGitText(
      ["rev-parse", "origin/main"],
      "SOURCE_FREEZE_ORIGIN_MAIN_READ_FAILED",
    ),
    changedPathCount: files.length,
    trackedModifiedCount,
    untrackedCount,
    changedPathSetDigest: sha256(pathRows),
    changedContentSetDigest: sha256(contentRows),
    files: Object.freeze(files),
  });
}

function readFinalSourceFreezeAuthority(file, options = {}) {
  const resolved = options.allowContractPath
    ? path.win32.normalize(path.win32.resolve(file))
    : assertDPath(file, {
      code: "FINAL_SOURCE_FREEZE_PATH_INVALID",
      kind: "file",
    });
  const bytes = readFileSync(resolved);
  if (sha256(bytes) !== FINAL_SOURCE_FREEZE_AUTHORITY_SHA256) {
    fail("FINAL_SOURCE_FREEZE_DIGEST_MISMATCH");
  }
  const sidecarPath = resolved + ".sha256";
  const expectedSidecar = FINAL_SOURCE_FREEZE_AUTHORITY_SHA256
    + " *" + path.win32.basename(resolved) + "\n";
  if (
    !existsSync(sidecarPath)
    || lstatSync(sidecarPath).isSymbolicLink()
    || readFileSync(sidecarPath, "utf8") !== expectedSidecar
  ) fail("FINAL_SOURCE_FREEZE_SIDECAR_MISMATCH");
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail("FINAL_SOURCE_FREEZE_INVALID", error);
  }
  if (!bytes.equals(canonicalBytes(manifest))) {
    fail("FINAL_SOURCE_FREEZE_CANONICAL_BYTES_INVALID");
  }
  exactKeys(manifest, [
    "auditedAt",
    "candidateIdentityDigest",
    "currentStatusFiles",
    "disposition",
    "excludedPaths",
    "generationPolicyDigest",
    "priorAuthorities",
    "releaseBoundary",
    "repository",
    "safeEvidenceBoundary",
    "schemaVersion",
  ], "FINAL_SOURCE_FREEZE_SHAPE_INVALID");
  exactKeys(manifest.repository, [
    "branch",
    "changedContentSetCanonicalization",
    "changedContentSetSha256",
    "expectedBase",
    "head",
    "originMain",
    "statusPathCount",
    "statusPathSetCanonicalization",
    "statusPathSetSha256",
    "trackedModifiedCount",
    "untrackedAddedCount",
    "worktree",
  ], "FINAL_SOURCE_FREEZE_REPOSITORY_SHAPE_INVALID");
  exactKeys(manifest.safeEvidenceBoundary, [
    "authorityCreatedNoReplace",
    "authoritySidecarCreatedNoReplace",
    "browserExecuted",
    "buildExecuted",
    "modelExecuted",
    "networkExecuted",
    "qualificationRunnerExcluded",
  ], "FINAL_SOURCE_FREEZE_SAFE_BOUNDARY_SHAPE_INVALID");
  exactKeys(manifest.releaseBoundary, [
    "deploymentPerformed",
    "formalCampaignPerformed",
    "productionPassClaimed",
    "qualificationPerformed",
    "releaseContractsVerified",
    "sourceFrozen",
  ], "FINAL_SOURCE_FREEZE_RELEASE_BOUNDARY_SHAPE_INVALID");
  const expectedPriorAuthorities = [
    {
      disposition: "PHASE_A_SOURCE_FREEZE_PASS_RELEASE_CONTRACTS_DEFERRED",
      path:
        "D:\\evidence\\novel\\p2.4b-rc6.5-browser-prose-v2"
        + "\\20260815T153840202Z\\source-phase-a-freeze"
        + "\\phase-a-source-freeze-manifest.json",
      schemaVersion: "p2.4b-rc6.5-phase-a-independent-source-freeze-v1",
      sha256: "3937ec223e635414a2cc7c94f1d84eb3c71996584d30cdc52fd99f1ff9afb6da",
      statusPathCount: 38,
      statusPathSetSha256:
        "33dae7d3841690f3e4677cf260b6a1681e7ac67107b4ff34a41db046bab329c7",
    },
    {
      disposition:
        "PHASE_A_PLUS_QUALIFICATION_RUNNER_SOURCE_FREEZE_PASS_RELEASE_CONTRACTS_DEFERRED",
      path:
        "D:\\evidence\\novel\\p2.4b-rc6.5-browser-prose-v2"
        + "\\20260815T153840202Z\\source-phase-a-plus-qualification-runner-freeze"
        + "\\phase-a-plus-qualification-runner-source-freeze-manifest.json",
      schemaVersion:
        "p2.4b-rc6.5-phase-a-plus-qualification-runner-independent-source-freeze-v1",
      sha256: "f618713c2b4d19d3e2a2c13fb205662db1efecf75fb9a89ad0580520da945bc6",
      statusPathCount: 39,
      statusPathSetSha256:
        "18ee35c28e17660d4bbf77141bb4df0be865c697f3d8eef40d56d24160982824",
    },
  ];
  if (stableJson(manifest.priorAuthorities) !== stableJson(expectedPriorAuthorities)) {
    fail("FINAL_SOURCE_FREEZE_PRIOR_AUTHORITIES_INVALID");
  }
  if (!Array.isArray(manifest.currentStatusFiles)) {
    fail("FINAL_SOURCE_FREEZE_STATUS_FILES_INVALID");
  }
  const baseline = manifest.currentStatusFiles.map((entry) => {
    exactKeys(entry, ["path", "sha256", "status"],
      "FINAL_SOURCE_FREEZE_STATUS_ROW_SHAPE_INVALID");
    if (
      (entry.status !== "M" && entry.status !== "??")
      || typeof entry.path !== "string"
      || !entry.path
      || path.posix.isAbsolute(entry.path)
      || entry.path.split("/").includes("..")
      || !SHA256_HEX.test(entry.sha256)
    ) fail("FINAL_SOURCE_FREEZE_STATUS_ROW_INVALID");
    return { status: entry.status, path: entry.path, sha256: entry.sha256 };
  }).sort((left, right) => left.path.localeCompare(right.path, "en-US"));
  const pathRows = baseline.map(
    (entry) => entry.status + "\t" + entry.path + "\n",
  ).join("");
  const contentRows = baseline.map(
    (entry) => entry.status + "\t" + entry.path + "\t" + entry.sha256 + "\n",
  ).join("");
  if (
    manifest.schemaVersion !== "p2.4b-rc6.5-final-source-freeze-authority-v1"
    || manifest.disposition
      !== "FINAL_SOURCE_FREEZE_AUTHORITY_PASS_RUNNER_EXCLUDED_RELEASE_CONTRACTS_DEFERRED"
    || manifest.candidateIdentityDigest !== PRIOR_CANDIDATE_IDENTITY
    || manifest.generationPolicyDigest !== CANDIDATE_RUNTIME_POLICY_DIGEST
    || !Array.isArray(manifest.excludedPaths)
    || stableJson(manifest.excludedPaths) !== stableJson([RUNNER_RELATIVE_PATH])
    || !Number.isFinite(Date.parse(manifest.auditedAt))
    || manifest.repository.worktree !== REPOSITORY_ROOT
    || manifest.repository.branch !== "agent/p24b-rc6-5-browser-prose-v2"
    || manifest.repository.expectedBase !== BASE_COMMIT
    || manifest.repository?.head !== BASE_COMMIT
    || manifest.repository?.originMain !== BASE_COMMIT
    || manifest.repository?.trackedModifiedCount !== 29
    || manifest.repository?.untrackedAddedCount !== 21
    || manifest.repository?.statusPathCount !== 50
    || manifest.repository?.statusPathSetCanonicalization
      !== "UTF-8 without BOM; sorted rows status-tab-path-LF"
    || manifest.repository?.changedContentSetCanonicalization
      !== "UTF-8 without BOM; sorted rows status-tab-path-tab-fileSha256-LF"
    || manifest.repository?.statusPathSetSha256
      !== FINAL_SOURCE_FREEZE_STATUS_PATH_SET_SHA256
    || manifest.repository?.changedContentSetSha256
      !== FINAL_SOURCE_FREEZE_CONTENT_SET_SHA256
    || sha256(pathRows) !== FINAL_SOURCE_FREEZE_STATUS_PATH_SET_SHA256
    || sha256(contentRows) !== FINAL_SOURCE_FREEZE_CONTENT_SET_SHA256
    || baseline.length !== 50
    || new Set(baseline.map((entry) => entry.path)).size !== 50
    || baseline.filter((entry) => entry.status === "M").length !== 29
    || baseline.filter((entry) => entry.status === "??").length !== 21
    || stableJson(manifest.safeEvidenceBoundary) !== stableJson({
      authorityCreatedNoReplace: true,
      authoritySidecarCreatedNoReplace: true,
      browserExecuted: false,
      buildExecuted: false,
      modelExecuted: false,
      networkExecuted: false,
      qualificationRunnerExcluded: true,
    })
    || stableJson(manifest.releaseBoundary) !== stableJson({
      deploymentPerformed: false,
      formalCampaignPerformed: false,
      productionPassClaimed: false,
      qualificationPerformed: false,
      releaseContractsVerified: true,
      sourceFrozen: true,
    })
  ) fail("FINAL_SOURCE_FREEZE_AUTHORITY_REJECTED");
  return Object.freeze({
    path: resolved,
    pathDigest: sha256(normalizeForIdentity(resolved)),
    digest: FINAL_SOURCE_FREEZE_AUTHORITY_SHA256,
    baseline,
  });
}

function assertCurrent51PathClosure(gitTruth, finalAuthority) {
  if (
    gitTruth.head !== BASE_COMMIT
    || gitTruth.originMain !== BASE_COMMIT
    || gitTruth.changedPathCount !== 51
    || gitTruth.trackedModifiedCount !== 29
    || gitTruth.untrackedCount !== 22
  ) fail("SOURCE_FREEZE_STATUS_COUNT_DRIFT");
  const runnerEntry = gitTruth.files.find((row) => row.path === RUNNER_RELATIVE_PATH);
  if (
    !runnerEntry
    || runnerEntry.status !== "??"
    || runnerEntry.sha256 !== sha256(readFileSync(RUNNER_PATH))
  ) fail("SOURCE_FREEZE_RUNNER_CLOSURE_INVALID");
  const withoutRunner = gitTruth.files.filter((row) => row.path !== RUNNER_RELATIVE_PATH);
  if (stableJson(withoutRunner) !== stableJson(finalAuthority.baseline)) {
    fail("SOURCE_FREEZE_FINAL_50_PATH_DRIFT");
  }
}

function validateSourceFreezeManifest(file, options = {}) {
  const parsed = readCanonicalJson(file, {
    allowContractPath: options.allowContractPath,
    code: "SOURCE_FREEZE_MANIFEST_INVALID",
    requireSidecar: true,
  });
  const manifest = parsed.value;
  exactKeys(manifest, [
    "adapterBundleSha256",
    "adapterDigest",
    "adapterRuntimePolicyDigest",
    "baseCommit",
    "buildManifestSha256",
    "candidateRegistrySha256",
    "candidateIdentityDigest",
    "changedContentSetDigest",
    "changedFiles",
    "changedPathCount",
    "changedPathSetDigest",
    "originMain",
    "finalAuthorityChangedPathCount",
    "finalAuthorityPath",
    "finalAuthorityPathDigest",
    "finalAuthoritySha256",
    "finalAuthorityStatusPathSetSha256",
    "productionPassClaimed",
    "runnerSha256",
    "schemaVersion",
    "sourceFrozen",
    "sourceIdentityDigest",
    "staticManifestSha256",
    "trackedModifiedCount",
    "untrackedCount",
    "vaultManifestSha256",
  ], "SOURCE_FREEZE_MANIFEST_SHAPE_INVALID");
  const finalAuthority = readFinalSourceFreezeAuthority(
    manifest.finalAuthorityPath,
    options,
  );
  const gitTruth = options.gitTruth || captureCurrentGitTruth();
  assertCurrent51PathClosure(gitTruth, finalAuthority);
  if (
    manifest.schemaVersion !== SOURCE_FREEZE_SCHEMA
    || manifest.candidateIdentityDigest !== CANDIDATE_IDENTITY
    || manifest.baseCommit !== BASE_COMMIT
    || manifest.originMain !== BASE_COMMIT
    || !Number.isSafeInteger(manifest.changedPathCount)
    || manifest.changedPathCount !== 51
    || !Number.isSafeInteger(manifest.trackedModifiedCount)
    || manifest.trackedModifiedCount !== 29
    || !Number.isSafeInteger(manifest.untrackedCount)
    || manifest.untrackedCount !== 22
    || manifest.changedPathCount
      !== manifest.trackedModifiedCount + manifest.untrackedCount
    || manifest.changedPathSetDigest !== gitTruth.changedPathSetDigest
    || manifest.changedContentSetDigest !== gitTruth.changedContentSetDigest
    || stableJson(manifest.changedFiles) !== stableJson(gitTruth.files)
    || manifest.runnerSha256 !== sha256(readFileSync(RUNNER_PATH))
    || manifest.finalAuthoritySha256 !== FINAL_SOURCE_FREEZE_AUTHORITY_SHA256
    || manifest.finalAuthorityPathDigest !== finalAuthority.pathDigest
    || manifest.finalAuthorityStatusPathSetSha256
      !== FINAL_SOURCE_FREEZE_STATUS_PATH_SET_SHA256
    || manifest.finalAuthorityChangedPathCount !== 50
    || !SHA256_HEX.test(manifest.buildManifestSha256)
    || !SHA256_HEX.test(manifest.staticManifestSha256)
    || !SHA256_HEX.test(manifest.adapterBundleSha256)
    || manifest.adapterDigest !== manifest.adapterBundleSha256
    || !SHA256_HEX.test(manifest.vaultManifestSha256)
    || !SHA256_HEX.test(manifest.candidateRegistrySha256)
    || manifest.adapterRuntimePolicyDigest !== CANDIDATE_RUNTIME_POLICY_DIGEST
    || manifest.sourceFrozen !== true
    || manifest.productionPassClaimed !== false
  ) fail("SOURCE_FREEZE_MANIFEST_REJECTED");
  const expectedIdentity = sha256(
      "p2.4b-rc6.5-browser-prose-qualification-source-freeze-v2\n"
      + stableJson(sourceFreezeIdentityBody(manifest)),
  );
  if (manifest.sourceIdentityDigest !== expectedIdentity) {
    fail("SOURCE_FREEZE_IDENTITY_DIGEST_MISMATCH");
  }
  return Object.freeze({
    manifestDigest: parsed.digest,
    sourceIdentityDigest: manifest.sourceIdentityDigest,
    changedPathCount: manifest.changedPathCount,
    gitTruth,
    finalAuthority,
    bindings: Object.freeze({
      buildManifestSha256: manifest.buildManifestSha256,
      staticManifestSha256: manifest.staticManifestSha256,
      adapterBundleSha256: manifest.adapterBundleSha256,
      vaultManifestSha256: manifest.vaultManifestSha256,
      candidateRegistrySha256: manifest.candidateRegistrySha256,
      adapterRuntimePolicyDigest: manifest.adapterRuntimePolicyDigest,
    }),
  });
}

function validateVaultManifest(file, options = {}) {
  const parsed = readCanonicalJson(file, {
    allowContractPath: options.allowContractPath,
    code: "VAULT_MANIFEST_INVALID",
    requireSidecar: true,
  });
  const manifest = parsed.value;
  exactKeys(manifest, [
    "candidateIdentityDigest",
    "developmentFixtureCount",
    "developmentPartitionDigest",
    "fixtureIdSetDigest",
    "holdoutFixtureCount",
    "holdoutPartitionDigest",
    "partitionOverlapCount",
    "productionPassClaimed",
    "rawContextInProductEvidence",
    "rawContextStoredInVault",
    "schemaVersion",
    "tuningBoundarySealed",
    "vaultPayloadDigest",
  ], "VAULT_MANIFEST_SHAPE_INVALID");
  const expectedDevelopmentDigest = sha256(canonicalBytes(DEVELOPMENT_FIXTURES));
  const expectedHoldoutDigest = sha256(canonicalBytes(HOLDOUT_FIXTURES));
  const expectedFixtureSetDigest = sha256(canonicalBytes(
    [...DEVELOPMENT_FIXTURES, ...HOLDOUT_FIXTURES],
  ));
  if (
    manifest.schemaVersion !== VAULT_MANIFEST_SCHEMA
    || manifest.candidateIdentityDigest !== CANDIDATE_IDENTITY
    || manifest.developmentFixtureCount !== 5
    || manifest.holdoutFixtureCount !== 5
    || manifest.developmentPartitionDigest !== expectedDevelopmentDigest
    || manifest.holdoutPartitionDigest !== expectedHoldoutDigest
    || manifest.fixtureIdSetDigest !== expectedFixtureSetDigest
    || manifest.developmentPartitionDigest === manifest.holdoutPartitionDigest
    || manifest.partitionOverlapCount !== 0
    || manifest.rawContextStoredInVault !== true
    || manifest.rawContextInProductEvidence !== false
    || manifest.tuningBoundarySealed !== true
    || !SHA256_HEX.test(manifest.vaultPayloadDigest)
    || manifest.productionPassClaimed !== false
  ) fail("VAULT_MANIFEST_REJECTED");
  return Object.freeze({
    manifestDigest: parsed.digest,
    vaultPayloadDigest: manifest.vaultPayloadDigest,
    fixtureIdSetDigest: manifest.fixtureIdSetDigest,
  });
}

function validateCandidateRegistry(registry) {
  assertNotRc64Formal(registry);
  exactKeys(registry, [
    "entries",
    "maxCandidates",
    "schemaVersion",
  ], "CANDIDATE_REGISTRY_SHAPE_INVALID");
  if (
    registry.schemaVersion !== REGISTRY_SCHEMA
    || registry.maxCandidates !== 2
    || !Array.isArray(registry.entries)
    || registry.entries.length < 1
    || registry.entries.length > 2
  ) fail("CANDIDATE_REGISTRY_INVALID");
  const identities = new Set();
  const ordinals = new Set();
  let currentCount = 0;
  for (const entry of registry.entries) {
    exactKeys(entry, [
      "blockedRc64Reused",
      "identityDigest",
      "materiallyDifferent",
      "ordinal",
      "status",
    ], "CANDIDATE_REGISTRY_ENTRY_SHAPE_INVALID");
    if (
      !Number.isSafeInteger(entry.ordinal)
      || entry.ordinal < 1
      || entry.ordinal > 2
      || !["eligible", "started", "not-qualified", "qualified"].includes(entry.status)
      || entry.materiallyDifferent !== true
      || entry.blockedRc64Reused !== false
      || identities.has(entry.identityDigest)
      || ordinals.has(entry.ordinal)
      || !SHA256_HEX.test(entry.identityDigest)
      || BLOCKED_RC64_IDENTITIES.includes(entry.identityDigest)
    ) fail("CANDIDATE_REGISTRY_ENTRY_INVALID");
    identities.add(entry.identityDigest);
    ordinals.add(entry.ordinal);
    if (entry.identityDigest === CANDIDATE_IDENTITY) currentCount += 1;
  }
  if (currentCount !== 1) fail("CURRENT_CANDIDATE_NOT_REGISTERED_EXACTLY_ONCE");
  const priorEntry = registry.entries.find((entry) => entry.ordinal === 1);
  const currentEntry = registry.entries.find((entry) => entry.ordinal === 2);
  if (
    registry.entries.length !== 2
    || !priorEntry
    || priorEntry.identityDigest !== PRIOR_CANDIDATE_IDENTITY
    || priorEntry.status !== "not-qualified"
    || !currentEntry
    || currentEntry.identityDigest !== CANDIDATE_IDENTITY
    || currentEntry.status !== "eligible"
  ) fail("CANDIDATE_REGISTRY_LINEAGE_INVALID");
  return Object.freeze({
    candidateCount: registry.entries.length,
    candidateIdentityDigest: CANDIDATE_IDENTITY,
    registryDigest: sha256(canonicalBytes(registry)),
  });
}

function validateBridge(bridge, options = {}) {
  assertNotRc64Formal(bridge);
  exactKeys(bridge, [
    "archiveManifestSha256",
    "cCompatibilityRoot",
    "cCompatibilityRootIsJunction",
    "cToDPathMapSha256",
    "dEdgeDll",
    "dEdgeExecutable",
    "dPhysicalExecutionRequired",
    "dToolchainRoot",
    "edgeDllSha256",
    "edgeExecutableSha256",
    "edgeManifestDigest",
    "edgeManifestSha256",
    "edgeTreeDigest",
    "environmentPathsSha256",
    "historicalLimitationCode",
    "junctionMapSha256",
    "migrationAuthorityDisposition",
    "preMigrationCPhysicalRetentionClaimed",
    "priorC10ProofDigest",
    "priorC10ReceiptSha256",
    "relocationAuthoritySha256",
    "schemaVersion",
  ], "EDGE_BRIDGE_SHAPE_INVALID");
  if (
    bridge.schemaVersion !== BRIDGE_SCHEMA
    || bridge.archiveManifestSha256 !== AUTHORITY.archiveManifestSha256
    || bridge.relocationAuthoritySha256 !== AUTHORITY.relocationAuthoritySha256
    || bridge.cToDPathMapSha256 !== AUTHORITY.cToDPathMapSha256
    || bridge.junctionMapSha256 !== AUTHORITY.junctionMapSha256
    || bridge.environmentPathsSha256 !== AUTHORITY.environmentPathsSha256
    || bridge.priorC10ReceiptSha256 !== AUTHORITY.priorC10ReceiptSha256
    || bridge.priorC10ProofDigest !== AUTHORITY.priorC10ProofDigest
    || bridge.edgeManifestSha256 !== AUTHORITY.edgeManifestSha256
    || bridge.edgeManifestDigest !== AUTHORITY.edgeManifestDigest
    || bridge.edgeTreeDigest !== AUTHORITY.edgeTreeDigest
    || bridge.edgeExecutableSha256 !== AUTHORITY.edgeExecutableSha256
    || bridge.edgeDllSha256 !== AUTHORITY.edgeDllSha256
    || normalizeForIdentity(bridge.cCompatibilityRoot)
      !== normalizeForIdentity(AUTHORITY.cCompatibilityRoot)
    || normalizeForIdentity(bridge.dToolchainRoot)
      !== normalizeForIdentity(AUTHORITY.dToolchainRoot)
    || normalizeForIdentity(bridge.dEdgeExecutable)
      !== normalizeForIdentity(AUTHORITY.dEdgeExecutable)
    || normalizeForIdentity(bridge.dEdgeDll) !== normalizeForIdentity(AUTHORITY.dEdgeDll)
    || bridge.cCompatibilityRootIsJunction !== true
    || bridge.dPhysicalExecutionRequired !== true
    || bridge.historicalLimitationCode
      !== "PRE_MIGRATION_C_PHYSICAL_RETENTION_UNVERIFIABLE"
    || bridge.migrationAuthorityDisposition
      !== "D_VERIFIED_PRESERVATION_PACKAGE_IS_AUTHORITY"
    || bridge.preMigrationCPhysicalRetentionClaimed !== false
  ) fail("EDGE_BRIDGE_AUTHORITY_MISMATCH");
  if (options.verifyFilesystem) {
    const executable = assertDPath(bridge.dEdgeExecutable, {
      code: "EDGE_EXECUTABLE_NOT_D_PHYSICAL",
      kind: "file",
    });
    const dll = assertDPath(bridge.dEdgeDll, {
      code: "EDGE_DLL_NOT_D_PHYSICAL",
      kind: "file",
    });
    assertDPath(bridge.dToolchainRoot, {
      code: "EDGE_TOOLCHAIN_ROOT_NOT_D_PHYSICAL",
      kind: "directory",
    });
    const manifestPath = assertDPath(path.win32.join(
      bridge.dToolchainRoot,
      "Edge",
      "151.0.4129.78",
      "toolchain-manifest.json",
    ), {
      code: "EDGE_TOOLCHAIN_MANIFEST_NOT_D_PHYSICAL",
      kind: "file",
    });
    const manifestBytes = readFileSync(manifestPath);
    let manifest;
    try {
      manifest = JSON.parse(manifestBytes.toString("utf8"));
    } catch (error) {
      fail("EDGE_TOOLCHAIN_MANIFEST_INVALID", error);
    }
    if (
      sha256(readFileSync(executable)) !== bridge.edgeExecutableSha256
      || sha256(readFileSync(dll)) !== bridge.edgeDllSha256
      || sha256(manifestBytes) !== bridge.edgeManifestSha256
      || manifest.manifestDigest !== bridge.edgeManifestDigest
      || manifest.applicationSha256 !== bridge.edgeTreeDigest
      || manifest.executableSha256 !== bridge.edgeExecutableSha256
      || manifest.engineDllSha256 !== bridge.edgeDllSha256
      || manifest.edgeVersion !== "151.0.4129.78"
      || manifest.installationKind !== "task-owned-receipt-sealed"
    ) fail("EDGE_BINARY_DIGEST_MISMATCH");
    const cInfo = lstatSync(bridge.cCompatibilityRoot, { throwIfNoEntry: false });
    if (!cInfo?.isSymbolicLink()) fail("C_COMPATIBILITY_JUNCTION_NOT_PRESENT");
    if (
      normalizeForIdentity(realpathSync.native(bridge.cCompatibilityRoot))
      !== normalizeForIdentity(bridge.dToolchainRoot)
    ) fail("C_COMPATIBILITY_JUNCTION_TARGET_MISMATCH");
  }
  return Object.freeze({
    authorityManifestSha256: bridge.archiveManifestSha256,
    bridgeDigest: sha256(canonicalBytes(bridge)),
    dPhysicalExecutionRequired: true,
    historicalLimitationCode: bridge.historicalLimitationCode,
  });
}

function parseNetworkPolicy(policy) {
  exactKeys(policy, [
    "allowedPathPrefixes",
    "measurementOrigins",
    "modelSetupDownloadAllowed",
    "proxyMode",
    "schemaVersion",
    "setupOrigins",
  ], "NETWORK_POLICY_SHAPE_INVALID");
  if (
    policy.schemaVersion !== NETWORK_POLICY_SCHEMA
    || !Array.isArray(policy.setupOrigins)
    || !Array.isArray(policy.measurementOrigins)
    || !Array.isArray(policy.allowedPathPrefixes)
    || policy.modelSetupDownloadAllowed !== false
    || policy.proxyMode !== "sealed-loopback-http-connect-deny-v1"
  ) fail("NETWORK_POLICY_INVALID");
  const parseOrigins = (values) => {
    const origins = new Set();
    for (const value of values) {
      if (typeof value !== "string") fail("NETWORK_ALLOWLIST_ORIGIN_INVALID");
      let parsed;
      try {
        parsed = new URL(value);
      } catch (error) {
        fail("NETWORK_ALLOWLIST_ORIGIN_INVALID", error);
      }
      if (
        parsed.origin !== value
        || parsed.username
        || parsed.password
        || parsed.pathname !== "/"
        || parsed.search
        || parsed.hash
        || parsed.protocol !== "http:"
      ) fail("NETWORK_ALLOWLIST_ORIGIN_INVALID");
      const loopback = parsed.hostname === "127.0.0.1";
      if (!loopback) {
        fail("MEASUREMENT_EXTERNAL_ORIGIN_FORBIDDEN");
      }
      if (origins.has(parsed.origin)) fail("NETWORK_ALLOWLIST_DUPLICATE");
      origins.add(parsed.origin);
    }
    return origins;
  };
  const setup = parseOrigins(policy.setupOrigins);
  const measurement = parseOrigins(policy.measurementOrigins);
  if (
    setup.size !== 1
    || measurement.size !== 1
    || [...setup][0] !== [...measurement][0]
  ) fail("MEASUREMENT_LOOPBACK_ORIGIN_COUNT_INVALID");
  const allowedPathPrefixes = [];
  for (const prefix of policy.allowedPathPrefixes) {
    if (
      typeof prefix !== "string"
      || !prefix.startsWith("/")
      || prefix.includes("\\")
      || prefix.includes("?")
      || prefix.includes("#")
      || prefix.split("/").includes("..")
      || allowedPathPrefixes.includes(prefix)
    ) fail("NETWORK_PATH_PREFIX_INVALID");
    allowedPathPrefixes.push(prefix);
  }
  if (allowedPathPrefixes.length < 1) fail("NETWORK_PATH_PREFIX_INVALID");
  return Object.freeze({
    setup,
    measurement,
    allowedPathPrefixes: Object.freeze(allowedPathPrefixes),
    policyDigest: sha256(canonicalBytes(policy)),
  });
}

function classifyNetworkRequest(rawUrl, phase, parsedPolicy, method = "GET") {
  if (typeof rawUrl !== "string" || !["setup", "measurement"].includes(phase)) {
    fail("NETWORK_REQUEST_INPUT_INVALID");
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    fail("NETWORK_REQUEST_URL_INVALID", error);
  }
  if (
    parsed.username
    || parsed.password
    || parsed.protocol !== "http:"
  ) fail("NETWORK_REQUEST_PROTOCOL_FORBIDDEN");
  const loopback = parsed.hostname === "127.0.0.1";
  const allowlist = phase === "setup" ? parsedPolicy.setup : parsedPolicy.measurement;
  const pathAllowed = parsedPolicy.allowedPathPrefixes.some(
    (prefix) => parsed.pathname === prefix
      || (prefix.endsWith("/") && parsed.pathname.startsWith(prefix)),
  );
  const methodAllowed = ["GET", "HEAD"].includes(method);
  const allowed = allowlist.has(parsed.origin) && pathAllowed && methodAllowed;
  return Object.freeze({
    schemaVersion: "p2.4b-rc6.5-network-request-safe-observation-v1",
    requestDigest: sha256("p2.4b-rc6.5-network-request-v1\n" + rawUrl),
    originDigest: sha256("p2.4b-rc6.5-network-origin-v1\n" + parsed.origin),
    pathDigest: sha256("p2.4b-rc6.5-network-path-v1\n" + parsed.pathname),
    method,
    phase,
    protocolClass: parsed.protocol === "https:" ? "https" : "http",
    loopback,
    allowlisted: allowed,
    pathAllowed,
    methodAllowed,
    external: !loopback,
    blocked: !allowed,
    rawUrlStored: false,
  });
}

function denyProxyResponse(response, statusCode = 403) {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
  });
  response.end("blocked");
}

async function startSealedLoopbackObserver(parsedPolicy) {
  if (!parsedPolicy || parsedPolicy.setup.size !== 1) {
    fail("SEALED_PROXY_POLICY_INVALID");
  }
  let phase = "setup";
  let stopped = false;
  let forwardFailureCount = 0;
  const journal = [];
  const server = createServer((request, response) => {
    let record;
    try {
      record = classifyNetworkRequest(
        request.url || "",
        phase,
        parsedPolicy,
        request.method || "",
      );
    } catch {
      record = Object.freeze({
        schemaVersion: "p2.4b-rc6.5-network-request-safe-observation-v1",
        requestDigest: sha256("invalid-proxy-request"),
        originDigest: sha256("invalid-proxy-origin"),
        pathDigest: sha256("invalid-proxy-path"),
        method: request.method || "INVALID",
        phase,
        protocolClass: "invalid",
        loopback: false,
        allowlisted: false,
        pathAllowed: false,
        methodAllowed: false,
        external: true,
        blocked: true,
        rawUrlStored: false,
      });
    }
    journal.push(record);
    if (record.blocked) {
      denyProxyResponse(response);
      return;
    }
    const target = new URL(request.url);
    const headers = { ...request.headers };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    const upstream = httpRequest({
      protocol: "http:",
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: request.method,
      headers,
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.on("error", () => {
      forwardFailureCount += 1;
      if (!response.headersSent) denyProxyResponse(response, 502);
      else response.destroy();
    });
    request.pipe(upstream);
  });
  server.on("connect", (request, socket) => {
    journal.push(Object.freeze({
      schemaVersion: "p2.4b-rc6.5-network-request-safe-observation-v1",
      requestDigest: sha256("connect\n" + (request.url || "")),
      originDigest: sha256("connect-origin"),
      pathDigest: sha256("connect-path"),
      method: "CONNECT",
      phase,
      protocolClass: "connect",
      loopback: false,
      allowlisted: false,
      pathAllowed: false,
      methodAllowed: false,
      external: true,
      blocked: true,
      rawUrlStored: false,
    }));
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  });
  server.on("upgrade", (request, socket) => {
    journal.push(Object.freeze({
      schemaVersion: "p2.4b-rc6.5-network-request-safe-observation-v1",
      requestDigest: sha256("upgrade\n" + (request.url || "")),
      originDigest: sha256("upgrade-origin"),
      pathDigest: sha256("upgrade-path"),
      method: "UPGRADE",
      phase,
      protocolClass: "upgrade",
      loopback: false,
      allowlisted: false,
      pathAllowed: false,
      methodAllowed: false,
      external: true,
      blocked: true,
      rawUrlStored: false,
    }));
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
    server.close();
    fail("SEALED_PROXY_LISTEN_IDENTITY_INVALID");
  }
  const proxyOrigin = "http://127.0.0.1:" + address.port;
  return Object.freeze({
    proxyOrigin,
    proxyOriginDigest: sha256("p2.4b-rc6.5-proxy-origin-v1\n" + proxyOrigin),
    setPhase(nextPhase) {
      if (!["setup", "measurement"].includes(nextPhase) || stopped) {
        fail("SEALED_PROXY_PHASE_INVALID");
      }
      phase = nextPhase;
    },
    snapshot() {
      const allowed = journal.filter((row) => !row.blocked);
      const denied = journal.filter((row) => row.blocked);
      return Object.freeze({
        schemaVersion: "p2.4b-rc6.5-sealed-proxy-journal-v1",
        observerStarted: true,
        observerStopped: stopped,
        proxyOriginDigest: sha256("p2.4b-rc6.5-proxy-origin-v1\n" + proxyOrigin),
        proxyServerArgumentDigest: sha256("--proxy-server=" + proxyOrigin),
        requestCount: journal.length,
        allowedRequestCount: allowed.length,
        deniedRequestCount: denied.length,
        connectDeniedCount: denied.filter((row) => row.method === "CONNECT").length,
        upgradeDeniedCount: denied.filter((row) => row.method === "UPGRADE").length,
        forwardFailureCount,
        externalRequestCount: journal.filter((row) => row.external).length,
        setupRequestCount: journal.filter((row) => row.phase === "setup").length,
        measurementRequestCount:
          journal.filter((row) => row.phase === "measurement").length,
        requestDigests: journal.map((row) => row.requestDigest),
        rawUrlStored: false,
      });
    },
    async stop() {
      if (stopped) fail("SEALED_PROXY_DOUBLE_STOP");
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      stopped = true;
    },
  });
}

function deriveNetworkObservationReceipt(input) {
  if (!input.observerSnapshot) fail("NETWORK_OBSERVER_MISSING");
  const snapshot = input.observerSnapshot;
  const routeRecords = input.routeRecords;
  exactKeys(snapshot, [
    "allowedRequestCount",
    "connectDeniedCount",
    "deniedRequestCount",
    "externalRequestCount",
    "forwardFailureCount",
    "measurementRequestCount",
    "observerStarted",
    "observerStopped",
    "proxyOriginDigest",
    "proxyServerArgumentDigest",
    "rawUrlStored",
    "requestCount",
    "requestDigests",
    "schemaVersion",
    "setupRequestCount",
    "upgradeDeniedCount",
  ], "NETWORK_OBSERVER_JOURNAL_SHAPE_INVALID");
  const launchArgs = input.launchArgs;
  const countFields = [
    "allowedRequestCount",
    "connectDeniedCount",
    "deniedRequestCount",
    "externalRequestCount",
    "forwardFailureCount",
    "measurementRequestCount",
    "requestCount",
    "setupRequestCount",
    "upgradeDeniedCount",
  ];
  const countsValid = countFields.every(
    (key) => Number.isSafeInteger(snapshot[key]) && snapshot[key] >= 0,
  );
  const proxyArgument = Array.isArray(launchArgs)
    ? launchArgs.at(-1)
    : null;
  const launchArgsExact = (
    Array.isArray(launchArgs)
    && launchArgs.length === EDGE_LAUNCH_POLICY.args.length + 1
    && launchArgs.slice(0, -1).every(
      (value, index) => value === EDGE_LAUNCH_POLICY.args[index],
    )
    && typeof proxyArgument === "string"
    && /^--proxy-server=http:\/\/127\.0\.0\.1:\d+$/u.test(proxyArgument)
    && sha256(proxyArgument) === snapshot.proxyServerArgumentDigest
  );
  const argsDigest = launchArgsExact ? sha256(canonicalBytes(launchArgs)) : null;
  const complete = (
    snapshot.schemaVersion === "p2.4b-rc6.5-sealed-proxy-journal-v1"
    && countsValid
    && snapshot.observerStarted === true
    && snapshot.observerStopped === true
    && input.observerStartedBeforeEdge === true
    && input.routeInstalledBeforeNavigation === true
    && input.proxyConfigured === true
    && input.proxyBypassConfigured === false
    && input.serviceWorkers === "block"
    && launchArgsExact
    && input.launchArgsDigest === argsDigest
    && Array.isArray(routeRecords)
    && routeRecords.every((row) => row.allowlisted && !row.blocked && !row.external)
    && snapshot.deniedRequestCount === 0
    && snapshot.connectDeniedCount === 0
    && snapshot.upgradeDeniedCount === 0
    && snapshot.forwardFailureCount === 0
    && snapshot.externalRequestCount === 0
    && snapshot.allowedRequestCount === routeRecords.length
    && snapshot.requestCount === snapshot.allowedRequestCount
    && snapshot.requestCount
      === snapshot.setupRequestCount + snapshot.measurementRequestCount
    && snapshot.requestCount
      === snapshot.allowedRequestCount + snapshot.deniedRequestCount
    && snapshot.rawUrlStored === false
    && Array.isArray(snapshot.requestDigests)
    && snapshot.requestDigests.length === snapshot.requestCount
    && snapshot.requestDigests.every((value) => SHA256_HEX.test(value))
  );
  if (!complete) fail("NETWORK_OBSERVATION_INCOMPLETE");
  return Object.freeze({
    schemaVersion: "p2.4b-rc6.5-network-observation-receipt-v1",
    observerJournalDigest: sha256(canonicalBytes(snapshot)),
    routeJournalDigest: sha256(canonicalBytes(routeRecords)),
    launchArgsDigest: input.launchArgsDigest,
    serviceWorkers: input.serviceWorkers,
    proxyConfigured: input.proxyConfigured,
    proxyBypassConfigured: input.proxyBypassConfigured,
    observerStartedBeforeEdge: input.observerStartedBeforeEdge,
    routeInstalledBeforeNavigation: input.routeInstalledBeforeNavigation,
    requestCount: snapshot.requestCount,
    deniedRequestCount: snapshot.deniedRequestCount,
    externalNetworkRequestCount: snapshot.externalRequestCount,
    dataEgressEventCount: snapshot.externalRequestCount,
    networkObservationComplete: complete,
    rawUrlStored: snapshot.rawUrlStored,
  });
}

function contractNetworkObservationInput(parsedPolicy, pageUrl) {
  const routeRecord = classifyNetworkRequest(
    pageUrl,
    "measurement",
    parsedPolicy,
    "GET",
  );
  const proxyOrigin = "http://127.0.0.1:49876";
  const launchArgs = [
    ...EDGE_LAUNCH_POLICY.args,
    "--proxy-server=" + proxyOrigin,
  ];
  return {
    observerSnapshot: {
      schemaVersion: "p2.4b-rc6.5-sealed-proxy-journal-v1",
      observerStarted: true,
      observerStopped: true,
      proxyOriginDigest: sha256(
        "p2.4b-rc6.5-proxy-origin-v1\n" + proxyOrigin,
      ),
      proxyServerArgumentDigest: sha256("--proxy-server=" + proxyOrigin),
      requestCount: 1,
      allowedRequestCount: 1,
      deniedRequestCount: 0,
      connectDeniedCount: 0,
      upgradeDeniedCount: 0,
      forwardFailureCount: 0,
      externalRequestCount: 0,
      setupRequestCount: 0,
      measurementRequestCount: 1,
      requestDigests: [routeRecord.requestDigest],
      rawUrlStored: false,
    },
    observerStartedBeforeEdge: true,
    routeInstalledBeforeNavigation: true,
    proxyConfigured: true,
    proxyBypassConfigured: false,
    serviceWorkers: "block",
    launchArgs,
    launchArgsDigest: sha256(canonicalBytes(launchArgs)),
    routeRecords: [routeRecord],
  };
}

function assertObservation(observation, expected) {
  assertNoForbiddenEvidence(observation);
  exactKeys(observation, [
    "actualExecutor",
    "candidateIdentityDigest",
    "candidateOnly",
    "candidateQualificationPass",
    "canonicalMutationCount",
    "cancelledPartialPersisted",
    "cancelledSegment",
    "chainOfThoughtStored",
    "characterAnchorVerified",
    "contextAnchorVerified",
    "dataLeftDevice",
    "executionMode",
    "externalRequest",
    "finalAttestationDigest",
    "finishReasons",
    "fixtureId",
    "formalApprovalMutationCount",
    "modelResponseCount",
    "modelRetryCount",
    "narrativeProgressVerified",
    "partition",
    "productionPassClaimed",
    "qualityReasonCodes",
    "qualityScore",
    "rawChapterStored",
    "rawOutputStored",
    "rawPromptStored",
    "rawStoryBibleStored",
    "repetitionDisposition",
    "retryReusedCancelledOutput",
    "runtimeReceiptDigest",
    "schemaVersion",
    "selectedHanCharacters",
    "selectedPrefixDigest",
    "syntheticObservedReceipt",
    "tuningAllowed",
    "tuningMutationCount",
    "underlyingExecutor",
  ], "QUALIFICATION_OBSERVATION_SHAPE_INVALID");
  if (
    observation.schemaVersion !== OBSERVATION_SCHEMA
    || observation.candidateIdentityDigest !== CANDIDATE_IDENTITY
    || observation.fixtureId !== expected.fixtureId
    || observation.partition !== expected.partition
    || observation.executionMode !== expected.executionMode
    || observation.actualExecutor !== "browser-ai"
    || observation.underlyingExecutor !== "webllm-worker"
    || observation.candidateOnly !== true
    || observation.modelResponseCount !== 3
    || observation.modelRetryCount !== 0
    || !Array.isArray(observation.finishReasons)
    || observation.finishReasons.length !== 3
    || observation.finishReasons.some((value) => value !== "stop")
    || !Number.isSafeInteger(observation.selectedHanCharacters)
    || observation.selectedHanCharacters < 220
    || observation.selectedHanCharacters > 320
    || observation.qualityScore !== 1
    || !Array.isArray(observation.qualityReasonCodes)
    || observation.qualityReasonCodes.length !== 0
    || observation.contextAnchorVerified !== true
    || observation.characterAnchorVerified !== true
    || observation.narrativeProgressVerified !== true
    || observation.repetitionDisposition !== "acceptable"
    || !SHA256_HEX.test(observation.runtimeReceiptDigest)
    || !SHA256_HEX.test(observation.finalAttestationDigest)
    || !SHA256_HEX.test(observation.selectedPrefixDigest)
    || observation.externalRequest !== false
    || observation.dataLeftDevice !== false
    || observation.canonicalMutationCount !== 0
    || observation.formalApprovalMutationCount !== 0
    || observation.rawOutputStored !== false
    || observation.rawPromptStored !== false
    || observation.rawStoryBibleStored !== false
    || observation.rawChapterStored !== false
    || observation.chainOfThoughtStored !== false
    || observation.cancelledPartialPersisted !== false
    || observation.retryReusedCancelledOutput !== false
    || observation.syntheticObservedReceipt !== false
    || observation.productionPassClaimed !== false
    || observation.candidateQualificationPass !== true
    || observation.tuningAllowed !== (expected.partition === "development")
    || observation.tuningMutationCount !== 0
  ) fail("QUALIFICATION_OBSERVATION_REJECTED");
  const cancelExpected = expected.executionMode === "cancel-retry";
  if (
    cancelExpected !== (observation.cancelledSegment !== null)
    || (cancelExpected && observation.cancelledSegment !== expected.cancelledSegment)
    || (!cancelExpected && observation.cancelledSegment !== null)
  ) fail("CANCEL_RETRY_SEMANTICS_INVALID");
  return observation;
}

function assertExactFixtureSet(rows, fixtureIds, partition, executionMode, cancelledSegments) {
  if (!Array.isArray(rows) || rows.length !== fixtureIds.length) {
    fail("QUALIFICATION_PHASE_COUNT_INVALID");
  }
  const observedIds = new Set();
  rows.forEach((row, index) => {
    const cancelledSegment = cancelledSegments ? cancelledSegments[index] : null;
    assertObservation(row, {
      fixtureId: fixtureIds[index],
      partition,
      executionMode,
      cancelledSegment,
    });
    if (observedIds.has(row.fixtureId)) fail("QUALIFICATION_FIXTURE_REPLAY");
    observedIds.add(row.fixtureId);
  });
  if (observedIds.size !== fixtureIds.length) fail("QUALIFICATION_FIXTURE_COUNT_INVALID");
}

function createState(candidateOrdinal) {
  if (!Number.isSafeInteger(candidateOrdinal) || candidateOrdinal < 1 || candidateOrdinal > 2) {
    fail("CANDIDATE_ORDINAL_INVALID");
  }
  return {
    schemaVersion: QUALIFICATION_SCHEMA,
    candidateIdentityDigest: CANDIDATE_IDENTITY,
    candidateOrdinal,
    state: "Preflight",
    sequence: 0,
    previousEventDigest: null,
    eventDigests: [],
    tuningFreezeDigest: null,
    tuningFreezeReceipt: null,
    phases: {
      development: [],
      holdout: [],
      warm: [],
      cancelRetry: [],
    },
    decision: null,
    cleanup: null,
    sealedEvidenceDigest: null,
  };
}

function appendStateEvent(state, eventName, safePayload) {
  assertNoForbiddenEvidence(safePayload);
  state.sequence += 1;
  const event = {
    schemaVersion: "p2.4b-rc6.5-browser-prose-qualification-state-event-v1",
    candidateIdentityDigest: CANDIDATE_IDENTITY,
    sequence: state.sequence,
    eventName,
    previousEventDigest: state.previousEventDigest,
    payloadDigest: sha256(canonicalBytes(safePayload)),
  };
  const eventDigest = sha256(
    "p2.4b-rc6.5-browser-prose-qualification-state-event-v1\n"
      + stableJson(event),
  );
  state.previousEventDigest = eventDigest;
  state.eventDigests.push(eventDigest);
}

function transitionState(state, eventName, payload) {
  const transition = STATE_ORDER.indexOf(state.state);
  const expectedEvent = [
    "PREFLIGHT_PASS",
    "DEVELOPMENT_COMPLETE",
    "HOLDOUT_COMPLETE",
    "WARM_COMPLETE",
    "CANCEL_RETRY_COMPLETE",
    "DECISION_COMPLETE",
    "CLEANUP_COMPLETE",
    "SEAL",
  ][transition];
  if (!expectedEvent || eventName !== expectedEvent) {
    fail("QUALIFICATION_STATE_TRANSITION_INVALID");
  }
  if (eventName === "PREFLIGHT_PASS") {
    exactKeys(payload, [
      "bridgeDigest",
      "candidateRegistryDigest",
      "liveIdentityClaimed",
      "preconditionSetDigest",
      "sourceSetDigest",
    ], "PREFLIGHT_PAYLOAD_INVALID");
    for (const key of [
      "bridgeDigest",
      "candidateRegistryDigest",
      "preconditionSetDigest",
      "sourceSetDigest",
    ]) assertSha256(payload[key], "PREFLIGHT_DIGEST_INVALID");
    if (payload.liveIdentityClaimed !== true) fail("LIVE_IDENTITY_NOT_CLAIMED");
  } else if (eventName === "DEVELOPMENT_COMPLETE") {
    exactKeys(payload, [
      "metrics",
      "tuningFreezeReceipt",
    ], "DEVELOPMENT_PAYLOAD_INVALID");
    const tuningFreeze = validateObservedTuningFreezeReceipt(
      payload.tuningFreezeReceipt,
    );
    assertExactFixtureSet(
      payload.metrics,
      DEVELOPMENT_FIXTURES,
      "development",
      "cold",
      null,
    );
    state.phases.development = structuredClone(payload.metrics);
    state.tuningFreezeDigest = tuningFreeze.digest;
    state.tuningFreezeReceipt = structuredClone(tuningFreeze.receipt);
  } else if (eventName === "HOLDOUT_COMPLETE") {
    exactKeys(payload, [
      "metrics",
      "tuningFreezeDigest",
      "tuningMutationCount",
    ], "HOLDOUT_PAYLOAD_INVALID");
    if (
      payload.tuningFreezeDigest !== state.tuningFreezeDigest
      || payload.tuningMutationCount !== 0
    ) fail("HOLDOUT_TUNING_BOUNDARY_BROKEN");
    assertExactFixtureSet(payload.metrics, HOLDOUT_FIXTURES, "holdout", "cold", null);
    state.phases.holdout = structuredClone(payload.metrics);
  } else if (eventName === "WARM_COMPLETE") {
    exactKeys(payload, ["metrics"], "WARM_PAYLOAD_INVALID");
    assertExactFixtureSet(payload.metrics, HOLDOUT_FIXTURES, "holdout", "warm", null);
    state.phases.warm = structuredClone(payload.metrics);
  } else if (eventName === "CANCEL_RETRY_COMPLETE") {
    exactKeys(payload, ["metrics"], "CANCEL_RETRY_PAYLOAD_INVALID");
    assertExactFixtureSet(
      payload.metrics,
      HOLDOUT_FIXTURES.slice(0, 3),
      "holdout",
      "cancel-retry",
      SEGMENTS,
    );
    state.phases.cancelRetry = structuredClone(payload.metrics);
  } else if (eventName === "DECISION_COMPLETE") {
    exactKeys(payload, [
      "candidateQualificationPass",
      "productionPassClaimed",
      "safeCode",
      "syntheticObservedReceipt",
    ], "DECISION_PAYLOAD_INVALID");
    if (
      payload.candidateQualificationPass !== true
      || payload.productionPassClaimed !== false
      || payload.syntheticObservedReceipt !== false
      || payload.safeCode !== "P2_4B_RC6_5_BROWSER_PROSE_CANDIDATE_V2_QUALIFIED"
    ) fail("QUALIFICATION_DECISION_INVALID");
    state.decision = structuredClone(payload);
  } else if (eventName === "CLEANUP_COMPLETE") {
    validateCleanup(payload);
    state.cleanup = structuredClone(payload);
  } else if (eventName === "SEAL") {
    exactKeys(payload, [
      "evidenceDigest",
      "mutexReleased",
      "startedMarkerRetained",
    ], "SEAL_PAYLOAD_INVALID");
    assertSha256(payload.evidenceDigest, "SEALED_EVIDENCE_DIGEST_INVALID");
    if (payload.mutexReleased !== true || payload.startedMarkerRetained !== true) {
      fail("SEAL_PRECONDITION_INVALID");
    }
    state.sealedEvidenceDigest = payload.evidenceDigest;
  }
  appendStateEvent(state, eventName, payload);
  state.state = STATE_ORDER[transition + 1];
  return state;
}

function validateCleanup(cleanup) {
  assertNoForbiddenEvidence(cleanup);
  exactKeys(cleanup, [
    "edgeResidueCount",
    "mutexResidueCount",
    "networkObserverDisposed",
    "profileDisposed",
    "profileResidueCount",
    "runnerOwnedResourcesReleased",
    "workerResidueCount",
  ], "CLEANUP_SHAPE_INVALID");
  if (
    cleanup.profileDisposed !== true
    || cleanup.networkObserverDisposed !== true
    || cleanup.profileResidueCount !== 0
    || cleanup.edgeResidueCount !== 0
    || cleanup.workerResidueCount !== 0
    || cleanup.mutexResidueCount !== 0
    || cleanup.runnerOwnedResourcesReleased !== true
  ) fail("QUALIFICATION_CLEANUP_INCOMPLETE");
  return cleanup;
}

function markerFileFor(ledgerRoot) {
  return path.win32.join(
    ledgerRoot,
    "candidate-ledger",
    CANDIDATE_IDENTITY,
    "started.json",
  );
}

function physicalFileIdentity(file, code) {
  const resolved = assertDPath(file, { code, kind: "file" });
  const info = lstatSync(resolved);
  if (info.isSymbolicLink()) fail(code + "_REPARSE");
  return Object.freeze({
    device: String(info.dev),
    inode: String(info.ino),
    bytes: info.size,
    linkCount: info.nlink,
    canonicalPathDigest: sha256(normalizeForIdentity(realpathSync.native(resolved))),
  });
}

function assertProspectivePhysicalChild(directory, file, code) {
  const physicalDirectory = assertDPath(directory, {
    code: code + "_PARENT",
    kind: "directory",
  });
  const resolved = path.win32.normalize(path.win32.resolve(file));
  if (
    path.win32.dirname(resolved) !== physicalDirectory
    || !isWithin(physicalDirectory, resolved)
  ) fail(code + "_ESCAPE");
  const existing = lstatSync(resolved, { throwIfNoEntry: false });
  if (existing) {
    if (existing.isSymbolicLink()) fail(code + "_REPARSE");
    fail(code + "_PREEXISTING");
  }
  return resolved;
}

function createProfileOwner(profilePath, runId) {
  if (!SAFE_ID.test(runId)) fail("RUN_ID_INVALID");
  const basename = path.win32.basename(profilePath);
  if (
    !new RegExp(
      "^novel-rc65-qualification-" + CANDIDATE_IDENTITY.slice(0, 12)
        + "-rc65q-[a-f0-9]{32}$",
      "u",
    ).test(basename)
  ) fail("QUALIFICATION_PROFILE_BASENAME_INVALID");
  return writeCanonicalExclusive(
    path.win32.join(profilePath, "qualification-profile-owner.json"),
    {
      schemaVersion: PROFILE_OWNER_SCHEMA,
      candidateIdentityDigest: CANDIDATE_IDENTITY,
      runId,
      ownership: "runner-created",
      freshBeforeLaunch: true,
      rawContextSeeded: false,
      productionPassClaimed: false,
    },
    { allowedRoot: profilePath },
  );
}

function createEdgeManagedPreferencesSeed(profilePath) {
  const physicalProfile = assertDPath(profilePath, {
    code: "QUALIFICATION_PROFILE_SEED_ROOT_INVALID",
    kind: "directory",
  });
  const defaultProfile = path.win32.join(physicalProfile, "Default");
  if (!isWithin(physicalProfile, defaultProfile) || existsSync(defaultProfile)) {
    fail("QUALIFICATION_PROFILE_SEED_NOT_FRESH");
  }
  mkdirSync(defaultProfile);
  assertDPath(defaultProfile, {
    code: "QUALIFICATION_PROFILE_SEED_DIRECTORY_INVALID",
    kind: "directory",
  });
  const preferencesPath = assertProspectivePhysicalChild(
    defaultProfile,
    path.win32.join(defaultProfile, "Preferences"),
    "QUALIFICATION_PROFILE_PREFERENCES_INVALID",
  );
  const bytes = canonicalBytes(EDGE_MANAGED_PREFERENCES_SEED);
  writeFileSync(preferencesPath, bytes, {
    encoding: null,
    flag: "wx",
    mode: 0o600,
  });
  const info = lstatSync(preferencesPath, { throwIfNoEntry: false });
  const readback = info?.isFile() && !info.isSymbolicLink()
    ? readFileSync(preferencesPath)
    : null;
  if (!readback?.equals(bytes)) fail("QUALIFICATION_PROFILE_SEED_READBACK_INVALID");
  return Object.freeze({
    schemaVersion: "p2.4b-rc6.5-edge-managed-preferences-seed-v1",
    profileSeedDigest: sha256(bytes),
    managedIntrusiveAdsSetting: 1,
    shoppingPreferenceSeeded: true,
    shoppingNetworkCanarySeeded: true,
    rawContextSeeded: false,
    canonicalBytes: true,
    observedBeforeEdgeLaunch: true,
  });
}

function createStartedMarker(ledgerRoot, candidateOrdinal, runId, options = {}) {
  if (!SAFE_ID.test(runId)) fail("RUN_ID_INVALID");
  if (
    !Number.isSafeInteger(candidateOrdinal)
    || candidateOrdinal < 1
    || candidateOrdinal > 2
  ) fail("CANDIDATE_ORDINAL_INVALID");
  const scope = options.scope || "live";
  const root = path.win32.normalize(path.win32.resolve(ledgerRoot));
  if (!isDDrive(root) || !existsSync(root)) fail("LEDGER_ROOT_INVALID");
  assertDPath(root, {
    code: scope === "live"
      ? "LIVE_LEDGER_ROOT_INVALID"
      : "CONTRACT_LEDGER_ROOT_INVALID",
    kind: "directory",
  });
  const directoryName = scope === "live" ? "candidate-ledger" : "contract-ledger";
  const ledgerDirectory = path.win32.join(root, directoryName);
  if (!existsSync(ledgerDirectory)) mkdirSync(ledgerDirectory);
  assertDPath(ledgerDirectory, {
    code: "CANDIDATE_LEDGER_DIRECTORY_INVALID",
    kind: "directory",
  });
  const directory = path.win32.join(ledgerDirectory, CANDIDATE_IDENTITY);
  const existingChild = lstatSync(directory, { throwIfNoEntry: false });
  if (existingChild) {
    if (existingChild.isSymbolicLink()) fail("CANDIDATE_LEDGER_CHILD_REPARSE");
    fail("CANDIDATE_LEDGER_CHILD_PREEXISTING");
  }
  mkdirSync(directory);
  assertDPath(directory, {
    code: "CANDIDATE_LEDGER_CHILD_INVALID",
    kind: "directory",
  });
  const file = path.win32.join(directory, "started.json");
  assertProspectivePhysicalChild(directory, file, "STARTED_MARKER_CHILD_INVALID");
  assertProspectivePhysicalChild(
    directory,
    file + ".sha256",
    "STARTED_MARKER_SIDECAR_CHILD_INVALID",
  );
  const marker = {
    schemaVersion: STARTED_SCHEMA,
    candidateIdentityDigest: CANDIDATE_IDENTITY,
    candidateOrdinal,
    runId,
    scope,
    onceConsumed: true,
    rc64FormalAttemptCreated: false,
    productionPassClaimed: false,
  };
  const written = writeCanonicalExclusive(file, marker, { allowedRoot: directory });
  const identity = physicalFileIdentity(
    written.path,
    "STARTED_MARKER_PHYSICAL_IDENTITY_INVALID",
  );
  const sidecarIdentity = physicalFileIdentity(
    written.sidecar,
    "STARTED_MARKER_SIDECAR_PHYSICAL_IDENTITY_INVALID",
  );
  return Object.freeze({
    ...written,
    marker,
    identity,
    sidecarIdentity,
    scope,
  });
}

function verifyStartedMarkerRetained(startedMarker) {
  if (
    !startedMarker?.path
    || !startedMarker?.digest
    || !startedMarker?.identity
    || !startedMarker?.sidecarIdentity
  ) {
    fail("STARTED_MARKER_OBSERVATION_MISSING");
  }
  const read = readCanonicalJson(startedMarker.path, {
    code: "STARTED_MARKER_RETAINED_READ_FAILED",
    expectedSha256: startedMarker.digest,
    requireSidecar: true,
  });
  if (stableJson(read.value) !== stableJson(startedMarker.marker)) {
    fail("STARTED_MARKER_RETAINED_VALUE_MISMATCH");
  }
  const currentIdentity = physicalFileIdentity(
    startedMarker.path,
    "STARTED_MARKER_RETAINED_IDENTITY_INVALID",
  );
  const currentSidecarIdentity = physicalFileIdentity(
    startedMarker.sidecar,
    "STARTED_MARKER_RETAINED_SIDECAR_IDENTITY_INVALID",
  );
  if (
    stableJson(currentIdentity) !== stableJson(startedMarker.identity)
    || stableJson(currentSidecarIdentity)
      !== stableJson(startedMarker.sidecarIdentity)
  ) {
    fail("STARTED_MARKER_RETAINED_PHYSICAL_DRIFT");
  }
  return Object.freeze({
    retained: true,
    digest: read.digest,
    physicalIdentityDigest: sha256(canonicalBytes(currentIdentity)),
    sidecarPhysicalIdentityDigest:
      sha256(canonicalBytes(currentSidecarIdentity)),
    sidecarVerified: true,
  });
}

function acquireDurableMutexGuard(mutexRoot, runId, options = {}) {
  if (!SAFE_ID.test(runId)) fail("RUN_ID_INVALID");
  const scope = options.scope || "live";
  const root = path.win32.normalize(path.win32.resolve(mutexRoot));
  if (!isDDrive(root) || !existsSync(root)) fail("MUTEX_ROOT_INVALID");
  if (scope === "live") {
    assertDPath(root, { code: "LIVE_MUTEX_ROOT_INVALID", kind: "directory" });
  }
  const safeName = MUTEX_NAME.replaceAll(/[^A-Za-z0-9._-]/gu, "_");
  const directory = path.win32.join(root, (scope === "live" ? "live-" : "contract-") + safeName);
  try {
    mkdirSync(directory);
  } catch (error) {
    fail("QUALIFICATION_NAMED_MUTEX_ALREADY_HELD", error);
  }
  const owner = {
    schemaVersion: "p2.4b-rc6.5-browser-prose-qualification-mutex-owner-v1",
    candidateIdentityDigest: CANDIDATE_IDENTITY,
    mutexName: MUTEX_NAME,
    runId,
    scope,
    productionPassClaimed: false,
  };
  try {
    writeCanonicalExclusive(path.win32.join(directory, "owner.json"), owner, {
      allowedRoot: directory,
    });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  let released = false;
  return Object.freeze({
    directory,
    name: MUTEX_NAME,
    release() {
      if (released) fail("QUALIFICATION_NAMED_MUTEX_DOUBLE_RELEASE");
      const canonicalRoot = normalizeForIdentity(root);
      const canonicalDirectory = normalizeForIdentity(directory);
      if (!canonicalDirectory.startsWith(canonicalRoot + "\\")) {
        fail("QUALIFICATION_NAMED_MUTEX_RELEASE_PATH_INVALID");
      }
      rmSync(directory, { recursive: true, force: false });
      released = true;
    },
    isReleased() {
      return released;
    },
  });
}

async function acquireWindowsNamedMutex(name) {
  if (!/^Global\\Novel_P2_4B_RC6_5_BrowserProseCandidateV2_[a-f0-9]{64}(?:Contract-[a-f0-9]{32})?$/u.test(name)) {
    fail("QUALIFICATION_WINDOWS_MUTEX_NAME_INVALID");
  }
  const powerShell = path.win32.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const script = [
    "$ErrorActionPreference='Stop'",
    "$mutex=$null",
    "$held=$false",
    "try{",
    "  $mutex=[Threading.Mutex]::new($false,[string]$args[0])",
    "  try{$held=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$held=$true}",
    "  if(-not $held){[Console]::Out.WriteLine('BUSY');[Console]::Out.Flush();exit 23}",
    "  [Console]::Out.WriteLine('ACQUIRED')",
    "  [Console]::Out.Flush()",
    "  [void][Console]::In.ReadLine()",
    "} finally {",
    "  if($held){$mutex.ReleaseMutex()}",
    "  if($null-ne$mutex){$mutex.Dispose()}",
    "}",
  ].join(";");
  const child = spawn(powerShell, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "& { " + script + " }",
    name,
  ], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout = (stdout + chunk).slice(0, 4096);
  });
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(0, 4096);
  });
  const acquisition = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new QualificationError("QUALIFICATION_WINDOWS_MUTEX_TIMEOUT"));
    }, 10_000);
    const inspect = () => {
      if (/(?:^|\r?\n)ACQUIRED(?:\r?\n|$)/u.test(stdout)) {
        clearTimeout(timer);
        resolve("ACQUIRED");
      } else if (/(?:^|\r?\n)BUSY(?:\r?\n|$)/u.test(stdout)) {
        clearTimeout(timer);
        reject(new QualificationError("QUALIFICATION_WINDOWS_MUTEX_ALREADY_HELD"));
      }
    };
    child.stdout.on("data", inspect);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new QualificationError("QUALIFICATION_WINDOWS_MUTEX_HELPER_FAILED", {
        cause: error,
      }));
    });
    child.once("exit", (code) => {
      if (!stdout.includes("ACQUIRED")) {
        clearTimeout(timer);
        reject(new QualificationError(
          code === 23
            ? "QUALIFICATION_WINDOWS_MUTEX_ALREADY_HELD"
            : "QUALIFICATION_WINDOWS_MUTEX_HELPER_FAILED",
          { cause: stderr ? new Error(sha256(stderr)) : undefined },
        ));
      }
    });
  }).catch((error) => {
    try {
      child.stdin.end();
      child.kill();
    } catch {
      // Process already exited.
    }
    throw error;
  });
  if (acquisition !== "ACQUIRED") fail("QUALIFICATION_WINDOWS_MUTEX_HELPER_FAILED");
  let released = false;
  return Object.freeze({
    name,
    async release() {
      if (released) fail("QUALIFICATION_WINDOWS_MUTEX_DOUBLE_RELEASE");
      const exitCode = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new QualificationError("QUALIFICATION_WINDOWS_MUTEX_RELEASE_TIMEOUT"));
        }, 10_000);
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(new QualificationError(
            "QUALIFICATION_WINDOWS_MUTEX_RELEASE_FAILED",
            { cause: error },
          ));
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          resolve(code);
        });
        child.stdin.end("RELEASE\n");
      });
      released = true;
      if (exitCode !== 0 || stderr) {
        fail("QUALIFICATION_WINDOWS_MUTEX_RELEASE_FAILED");
      }
    },
  });
}

async function acquireNamedMutex(mutexRoot, runId, options = {}) {
  const scope = options.scope || "live";
  const osName = scope === "live"
    ? MUTEX_NAME
    : MUTEX_NAME + "Contract-"
      + sha256(normalizeForIdentity(mutexRoot)).slice(0, 32);
  const windowsMutex = await acquireWindowsNamedMutex(osName);
  let durable = null;
  try {
    durable = acquireDurableMutexGuard(mutexRoot, runId, options);
  } catch (error) {
    await windowsMutex.release();
    throw error;
  }
  let released = false;
  return Object.freeze({
    directory: durable.directory,
    name: osName,
    async release() {
      if (released) fail("QUALIFICATION_NAMED_MUTEX_DOUBLE_RELEASE");
      durable.release();
      await windowsMutex.release();
      released = true;
    },
    isReleased() {
      return released;
    },
  });
}

function validateBoundCanonical(binding, code, options = {}) {
  exactKeys(binding, ["path", "sha256"], code + "_SHAPE");
  assertSha256(binding.sha256, code + "_DIGEST_INVALID");
  return readCanonicalJson(binding.path, {
    allowContractPath: options.allowContractPath,
    code,
    expectedSha256: binding.sha256,
    requireSidecar: true,
  });
}

function validateLiveConfig(config, options = {}) {
  assertNotRc64Formal(config);
  exactKeys(config, [
    "adapter",
    "candidateIdentityDigest",
    "candidateOrdinal",
    "candidateRegistry",
    "edgeBridge",
    "evidenceRoot",
    "ledgerRoot",
    "liveDriverSealed",
    "mutexRoot",
    "networkPolicy",
    "preconditions",
    "profileRoot",
    "schemaVersion",
    "temporaryRoot",
  ], "LIVE_CONFIG_SHAPE_INVALID");
  if (
    config.schemaVersion !== CONFIG_SCHEMA
    || config.candidateIdentityDigest !== CANDIDATE_IDENTITY
    || config.candidateOrdinal !== 2
    || deriveCandidateIdentityFromLineageEnvelope() !== CANDIDATE_IDENTITY
    || config.liveDriverSealed !== true
    || !Array.isArray(config.preconditions)
    || config.preconditions.length !== SOURCE_ARTIFACT_ROLES.length
  ) fail("LIVE_CONFIG_INVALID");
  exactKeys(config.adapter, [
    "adapterDigest",
    "globalName",
    "pageUrl",
  ], "LIVE_ADAPTER_CONFIG_SHAPE_INVALID");
  if (
    config.adapter.globalName !== ADAPTER_GLOBAL
    || !SHA256_HEX.test(config.adapter.adapterDigest)
  ) fail("LIVE_ADAPTER_CONFIG_INVALID");
  let pageUrl;
  try {
    pageUrl = new URL(config.adapter.pageUrl);
  } catch (error) {
    fail("LIVE_ADAPTER_PAGE_URL_INVALID", error);
  }
  if (
    pageUrl.protocol !== "http:"
    || pageUrl.hostname !== "127.0.0.1"
    || pageUrl.username
    || pageUrl.password
  ) fail("LIVE_ADAPTER_PAGE_URL_INVALID");
  const allowContractPath = options.allowContractPath === true;
  const roots = {};
  for (const key of [
    "evidenceRoot",
    "ledgerRoot",
    "mutexRoot",
    "profileRoot",
    "temporaryRoot",
  ]) {
    roots[key] = allowContractPath
      ? path.win32.normalize(path.win32.resolve(config[key]))
      : assertDPath(config[key], { code: "LIVE_ROOT_INVALID", kind: "directory" });
  }
  const seenRoles = new Set();
  const preconditions = config.preconditions.map((binding) => {
    if (!SOURCE_ARTIFACT_ROLES.includes(binding.role) || seenRoles.has(binding.role)) {
      fail("PRECONDITION_ROLE_INVALID");
    }
    seenRoles.add(binding.role);
    return validateArtifactBinding(binding, binding.role, { allowContractPath });
  });
  if (seenRoles.size !== SOURCE_ARTIFACT_ROLES.length) {
    fail("PRECONDITION_SET_INCOMPLETE");
  }
  const sourceBinding = preconditions.find((row) => row.role === "source-freeze");
  const buildBinding = preconditions.find((row) => row.role === "build-manifest");
  const staticManifestBinding = preconditions.find(
    (row) => row.role === "static-manifest",
  );
  const staticBinding = preconditions.find((row) => row.role === "static-bundle");
  const vaultBinding = preconditions.find((row) => row.role === "vault-manifest");
  if (
    !sourceBinding
    || !buildBinding
    || !staticManifestBinding
    || !staticBinding
    || !vaultBinding
  ) {
    fail("PRECONDITION_SET_INCOMPLETE");
  }
  const sourceFreeze = validateSourceFreezeManifest(sourceBinding.resolvedPath, {
    allowContractPath,
  });
  const vaultManifest = validateVaultManifest(vaultBinding.resolvedPath, {
    allowContractPath,
  });
  if (
    config.adapter.adapterDigest !== staticBinding.sha256
    || sourceFreeze.bindings.buildManifestSha256 !== buildBinding.sha256
    || sourceFreeze.bindings.staticManifestSha256 !== staticManifestBinding.sha256
    || sourceFreeze.bindings.adapterBundleSha256 !== staticBinding.sha256
    || sourceFreeze.bindings.vaultManifestSha256 !== vaultBinding.sha256
    || sourceFreeze.bindings.adapterRuntimePolicyDigest
      !== CANDIDATE_RUNTIME_POLICY_DIGEST
  ) {
    fail("ADAPTER_STATIC_BUNDLE_DIGEST_MISMATCH");
  }
  const registryFile = validateBoundCanonical(
    config.candidateRegistry,
    "CANDIDATE_REGISTRY_FILE_INVALID",
    { allowContractPath },
  );
  const registry = validateCandidateRegistry(registryFile.value);
  if (sourceFreeze.bindings.candidateRegistrySha256 !== registryFile.digest) {
    fail("SOURCE_FREEZE_REGISTRY_BINDING_MISMATCH");
  }
  const registryEntry = registryFile.value.entries.find(
    (entry) => entry.identityDigest === CANDIDATE_IDENTITY,
  );
  if (
    registryEntry.ordinal !== config.candidateOrdinal
    || registryEntry.status !== "eligible"
  ) fail("CANDIDATE_REGISTRY_LIVE_STATUS_INVALID");
  const bridgeFile = validateBoundCanonical(
    config.edgeBridge,
    "EDGE_BRIDGE_FILE_INVALID",
    { allowContractPath },
  );
  const bridge = validateBridge(bridgeFile.value, {
    verifyFilesystem: !allowContractPath,
  });
  const networkPolicy = parseNetworkPolicy(config.networkPolicy);
  if (!networkPolicy.measurement.has(pageUrl.origin)) {
    fail("ADAPTER_ORIGIN_NOT_IN_MEASUREMENT_ALLOWLIST");
  }
  const sourceSetDigest = sha256(canonicalBytes(preconditions));
  const preconditionSetDigest = sha256(canonicalBytes({
    bridgeDigest: bridge.bridgeDigest,
    candidateRegistryDigest: registryFile.digest,
    preconditions,
    sourceFreeze,
    vaultManifest,
    runnerDigest: sha256(readFileSync(RUNNER_PATH)),
  }));
  return Object.freeze({
    config,
    roots,
    preconditions,
    sourceFreeze,
    sourceFreezeManifestDigest: sourceBinding.sha256,
    vaultManifest,
    artifactBindings: Object.freeze({
      sourceFreeze: sourceBinding,
      buildManifest: buildBinding,
      staticManifest: staticManifestBinding,
      staticBundle: staticBinding,
      vaultManifest: vaultBinding,
    }),
    registry,
    registryFileDigest: registryFile.digest,
    bridge,
    bridgeFileDigest: bridgeFile.digest,
    networkPolicy,
    sourceSetDigest,
    preconditionSetDigest,
    pageOrigin: pageUrl.origin,
  });
}

function assertLiveOnceToken(liveToken, sourceFreezeManifestDigest) {
  assertSha256(sourceFreezeManifestDigest, "LIVE_SOURCE_MANIFEST_DIGEST_INVALID");
  const expected = LIVE_TOKEN_PREFIX + sourceFreezeManifestDigest;
  if (liveToken !== expected) fail("LIVE_ONCE_TOKEN_INVALID");
  return expected;
}

async function importPlaywrightTestForLive() {
  return import("@playwright/test");
}

async function loadPlaywrightForLive(
  liveToken,
  sourceFreezeManifestDigest,
  importer = importPlaywrightTestForLive,
) {
  assertLiveOnceToken(liveToken, sourceFreezeManifestDigest);
  const loaded = await importer();
  if (!loaded?.chromium?.launchPersistentContext) {
    fail("PLAYWRIGHT_LIVE_DRIVER_INVALID");
  }
  return loaded;
}

function validateAdapterDescription(value, expected) {
  assertNoForbiddenEvidence(value);
  exactKeys(value, [
    "adapterDigest",
    "candidateIdentityDigest",
    "candidateOnly",
    "buildManifestSha256",
    "productionPassClaimed",
    "runtimePolicyDigest",
    "schemaVersion",
    "sourceIdentityDigest",
    "staticManifestSha256",
    "syntheticObservedReceipt",
  ], "ADAPTER_DESCRIPTION_SHAPE_INVALID");
  if (
    value.schemaVersion !== ADAPTER_SCHEMA
    || value.adapterDigest !== expected.adapterDigest
    || value.candidateIdentityDigest !== CANDIDATE_IDENTITY
    || value.sourceIdentityDigest !== expected.sourceIdentityDigest
    || value.buildManifestSha256 !== expected.buildManifestSha256
    || value.staticManifestSha256 !== expected.staticManifestSha256
    || value.runtimePolicyDigest !== CANDIDATE_RUNTIME_POLICY_DIGEST
    || value.candidateOnly !== true
    || value.syntheticObservedReceipt !== false
    || value.productionPassClaimed !== false
  ) fail("ADAPTER_DESCRIPTION_INVALID");
  return value;
}

function validateSetupReceipt(value, expected) {
  assertNoForbiddenEvidence(value);
  exactKeys(value, [
    "adapterDigest",
    "candidateIdentityDigest",
    "immutableModelReady",
    "modelDownloadCount",
    "modelReadyFromCache",
    "modelSetupNetworkRequestCount",
    "productionPassClaimed",
    "sealedVaultLoaded",
    "sourceSetDigest",
    "syntheticObservedReceipt",
  ], "ADAPTER_SETUP_RECEIPT_SHAPE_INVALID");
  if (
    value.adapterDigest !== expected.adapterDigest
    || value.candidateIdentityDigest !== CANDIDATE_IDENTITY
    || value.immutableModelReady !== true
    || value.modelDownloadCount !== 0
    || value.modelReadyFromCache !== true
    || value.modelSetupNetworkRequestCount !== 0
    || value.sealedVaultLoaded !== true
    || value.sourceSetDigest !== expected.sourceSetDigest
    || value.syntheticObservedReceipt !== false
    || value.productionPassClaimed !== false
  ) fail("ADAPTER_SETUP_RECEIPT_INVALID");
  return value;
}

function adapterExpectationFromValidated(validated) {
  return Object.freeze({
    adapterDigest: validated.sourceFreeze.bindings.adapterBundleSha256,
    sourceIdentityDigest: validated.sourceFreeze.sourceIdentityDigest,
    buildManifestSha256: validated.artifactBindings.buildManifest.sha256,
    staticManifestSha256: validated.artifactBindings.staticManifest.sha256,
  });
}

function captureObservedTuningBoundarySnapshot(
  config,
  adapterDescription,
  options = {},
) {
  const current = validateLiveConfig(config, options);
  const description = validateAdapterDescription(
    adapterDescription,
    adapterExpectationFromValidated(current),
  );
  const artifacts = [
    ...Object.entries(current.artifactBindings).map(([role, binding]) => ({
      role,
      sha256: binding.sha256,
    })),
    {
      role: "candidateRegistry",
      sha256: current.registryFileDigest,
    },
  ].sort((left, right) => left.role.localeCompare(right.role, "en-US"));
  const runner = current.sourceFreeze.gitTruth.files.find(
    (row) => row.path === RUNNER_RELATIVE_PATH,
  );
  if (!runner) fail("TUNING_BOUNDARY_RUNNER_BINDING_MISSING");
  const snapshot = {
    schemaVersion: "p2.4b-rc6.5-browser-prose-tuning-boundary-snapshot-v1",
    candidateIdentityDigest: CANDIDATE_IDENTITY,
    sourceFreezeManifestSha256: current.sourceFreezeManifestDigest,
    sourceIdentityDigest: current.sourceFreeze.sourceIdentityDigest,
    sourceChangedPathSetDigest:
      current.sourceFreeze.gitTruth.changedPathSetDigest,
    sourceChangedContentSetDigest:
      current.sourceFreeze.gitTruth.changedContentSetDigest,
    runnerSha256: runner.sha256,
    artifactSetDigest: sha256(canonicalBytes(artifacts)),
    adapterBundleSha256: current.artifactBindings.staticBundle.sha256,
    buildManifestSha256: current.artifactBindings.buildManifest.sha256,
    staticManifestSha256: current.artifactBindings.staticManifest.sha256,
    vaultManifestSha256: current.artifactBindings.vaultManifest.sha256,
    candidateRegistrySha256: current.registryFileDigest,
    adapterDescriptionDigest: sha256(canonicalBytes(description)),
    adapterRuntimePolicyDigest: CANDIDATE_RUNTIME_POLICY_DIGEST,
    diskArtifactsRehashed: true,
    productionPassClaimed: false,
    syntheticObservedReceipt: false,
  };
  assertNoForbiddenEvidence(snapshot);
  return Object.freeze(snapshot);
}

function createObservedTuningFreezeReceipt(before, after) {
  if (stableJson(before) !== stableJson(after)) {
    fail("POST_DEVELOPMENT_TUNING_FREEZE_DRIFT");
  }
  if (
    before?.schemaVersion
      !== "p2.4b-rc6.5-browser-prose-tuning-boundary-snapshot-v1"
    || before.candidateIdentityDigest !== CANDIDATE_IDENTITY
    || before.diskArtifactsRehashed !== true
    || before.syntheticObservedReceipt !== false
    || before.productionPassClaimed !== false
    || before.adapterRuntimePolicyDigest !== CANDIDATE_RUNTIME_POLICY_DIGEST
  ) fail("TUNING_BOUNDARY_SNAPSHOT_INVALID");
  const snapshotDigest = sha256(canonicalBytes(before));
  const receipt = {
    schemaVersion: TUNING_FREEZE_SCHEMA,
    candidateIdentityDigest: CANDIDATE_IDENTITY,
    preDevelopmentSnapshotDigest: snapshotDigest,
    postDevelopmentSnapshotDigest: snapshotDigest,
    sourceFreezeManifestSha256: before.sourceFreezeManifestSha256,
    sourceIdentityDigest: before.sourceIdentityDigest,
    sourceChangedContentSetDigest: before.sourceChangedContentSetDigest,
    artifactSetDigest: before.artifactSetDigest,
    adapterDescriptionDigest: before.adapterDescriptionDigest,
    adapterRuntimePolicyDigest: before.adapterRuntimePolicyDigest,
    candidateRegistrySha256: before.candidateRegistrySha256,
    observedBeforeDevelopment: true,
    observedAfterDevelopment: true,
    tuningMutationCount: 0,
    syntheticObservedReceipt: false,
    productionPassClaimed: false,
  };
  assertNoForbiddenEvidence(receipt);
  return Object.freeze(receipt);
}

function validateObservedTuningFreezeReceipt(receipt) {
  assertNoForbiddenEvidence(receipt);
  exactKeys(receipt, [
    "adapterDescriptionDigest",
    "adapterRuntimePolicyDigest",
    "artifactSetDigest",
    "candidateIdentityDigest",
    "candidateRegistrySha256",
    "observedAfterDevelopment",
    "observedBeforeDevelopment",
    "postDevelopmentSnapshotDigest",
    "preDevelopmentSnapshotDigest",
    "productionPassClaimed",
    "schemaVersion",
    "sourceChangedContentSetDigest",
    "sourceFreezeManifestSha256",
    "sourceIdentityDigest",
    "syntheticObservedReceipt",
    "tuningMutationCount",
  ], "TUNING_FREEZE_RECEIPT_SHAPE_INVALID");
  for (const key of [
    "adapterDescriptionDigest",
    "adapterRuntimePolicyDigest",
    "artifactSetDigest",
    "candidateRegistrySha256",
    "postDevelopmentSnapshotDigest",
    "preDevelopmentSnapshotDigest",
    "sourceChangedContentSetDigest",
    "sourceFreezeManifestSha256",
    "sourceIdentityDigest",
  ]) assertSha256(receipt[key], "TUNING_FREEZE_RECEIPT_DIGEST_INVALID");
  if (
    receipt.schemaVersion !== TUNING_FREEZE_SCHEMA
    || receipt.candidateIdentityDigest !== CANDIDATE_IDENTITY
    || receipt.preDevelopmentSnapshotDigest
      !== receipt.postDevelopmentSnapshotDigest
    || receipt.adapterRuntimePolicyDigest !== CANDIDATE_RUNTIME_POLICY_DIGEST
    || receipt.observedBeforeDevelopment !== true
    || receipt.observedAfterDevelopment !== true
    || receipt.tuningMutationCount !== 0
    || receipt.syntheticObservedReceipt !== false
    || receipt.productionPassClaimed !== false
  ) fail("TUNING_FREEZE_RECEIPT_INVALID");
  return Object.freeze({
    receipt,
    digest: sha256(canonicalBytes(receipt)),
  });
}

function deriveEdgeLaunchIsolationPreconditionReceipt(
  disabledFeatures = EDGE_DISABLED_FEATURES,
  launchArgs = EDGE_LAUNCH_POLICY.args,
) {
  if (!Array.isArray(disabledFeatures) || !Array.isArray(launchArgs)) {
    fail("EDGE_LAUNCH_ISOLATION_PRECONDITION_INVALID");
  }
  const featureSet = new Set(disabledFeatures);
  const disableFeatureArgs = launchArgs.filter(
    (argument) => argument.startsWith("--disable-features="),
  );
  if (
    featureSet.size !== disabledFeatures.length
    || disabledFeatures.some((feature) => !SAFE_ID.test(feature))
    || EDGE_SHOPPING_NETWORK_SUPPRESSION_FEATURES.some(
      (feature) => !featureSet.has(feature),
    )
    || EDGE_MOUSE_GESTURE_NETWORK_SUPPRESSION_FEATURES.some(
      (feature) => !featureSet.has(feature),
    )
    || sha256(canonicalBytes(EDGE_MANAGED_PREFERENCES_SEED))
      !== CANDIDATE_LINEAGE_ENVELOPE.edgeManagedPreferencesSeedSha256
    || disableFeatureArgs.length !== 1
    || disableFeatureArgs[0] !== "--disable-features=" + disabledFeatures.join(",")
  ) fail("EDGE_LAUNCH_ISOLATION_PRECONDITION_INVALID");
  const receipt = {
    schemaVersion: "p2.4b-rc6.5-edge-launch-isolation-precondition-v2",
    candidateIdentityDigest: CANDIDATE_IDENTITY,
    edgeDisabledFeatureCount: disabledFeatures.length,
    edgeDisabledFeatureSetDigest: sha256(canonicalBytes(disabledFeatures)),
    shoppingSuppressionFeatureCount:
      EDGE_SHOPPING_NETWORK_SUPPRESSION_FEATURES.length,
    shoppingSuppressionFeatureSetDigest: sha256(
      canonicalBytes(EDGE_SHOPPING_NETWORK_SUPPRESSION_FEATURES),
    ),
    mouseGestureSuppressionFeatureCount:
      EDGE_MOUSE_GESTURE_NETWORK_SUPPRESSION_FEATURES.length,
    mouseGestureSuppressionFeatureSetDigest: sha256(
      canonicalBytes(EDGE_MOUSE_GESTURE_NETWORK_SUPPRESSION_FEATURES),
    ),
    managedPreferencesSeedDigest:
      CANDIDATE_LINEAGE_ENVELOPE.edgeManagedPreferencesSeedSha256,
    launchArgsDigest: sha256(canonicalBytes(launchArgs)),
    observedBeforeEdgeLaunch: true,
    pinnedEdgeFeatureControls: true,
    machinePolicyRequired: false,
    independentlyDerivedFromSealedLaunchPolicy: true,
  };
  assertNoForbiddenEvidence(receipt);
  return Object.freeze(receipt);
}

function queryExactEdgeProcesses(edgeExecutable) {
  const command = [
    "$ErrorActionPreference='Stop'",
    "$edge=$env:NOVEL_RC65_EDGE_QUERY",
    "$rows=@(Get-CimInstance Win32_Process | Where-Object {",
    "  $_.ExecutablePath -and $_.ExecutablePath.Equals($edge,[StringComparison]::OrdinalIgnoreCase)",
    "} | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine)",
    "[Console]::Out.Write((ConvertTo-Json -InputObject $rows -Compress))",
  ].join("; ");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        NOVEL_RC65_EDGE_QUERY: edgeExecutable,
      },
      windowsHide: true,
      timeout: 30_000,
    },
  );
  if (result.status !== 0 || result.signal || result.error) {
    fail("EDGE_PROCESS_TABLE_OBSERVATION_FAILED", result.error);
  }
  let rows;
  try {
    rows = JSON.parse(result.stdout || "[]");
  } catch (error) {
    fail("EDGE_PROCESS_TABLE_PARSE_FAILED", error);
  }
  if (!Array.isArray(rows)) fail("EDGE_PROCESS_TABLE_SHAPE_INVALID");
  return rows.map((row) => {
    if (
      !Number.isSafeInteger(row.ProcessId)
      || row.ProcessId < 1
      || !Number.isSafeInteger(row.ParentProcessId)
      || row.ParentProcessId < 0
      || normalizeForIdentity(row.ExecutablePath)
        !== normalizeForIdentity(edgeExecutable)
      || (row.CommandLine !== null && typeof row.CommandLine !== "string")
    ) fail("EDGE_PROCESS_TABLE_ROW_INVALID");
    return Object.freeze({
      pid: row.ProcessId,
      parentPid: row.ParentProcessId,
      executablePath: row.ExecutablePath,
      commandLine: row.CommandLine || "",
      commandLineDigest: sha256(
        "p2.4b-rc6.5-edge-command-line-v1\n" + (row.CommandLine || ""),
      ),
    });
  });
}

function commandLineContainsPhysicalPath(commandLine, physicalPath) {
  if (typeof commandLine !== "string") return false;
  const normalizedCommand = commandLine
    .replaceAll("/", "\\")
    .toLocaleLowerCase("en-US");
  return normalizedCommand.includes(normalizeForIdentity(physicalPath));
}

function createEdgeBaselineReceipt(rows) {
  if (!Array.isArray(rows)) fail("EDGE_BASELINE_OBSERVATION_MISSING");
  const pids = rows.map((row) => row.pid).sort((left, right) => left - right);
  if (pids.length !== 0) fail("QUALIFICATION_EDGE_BASELINE_NOT_ZERO");
  return Object.freeze({
    schemaVersion: "p2.4b-rc6.5-edge-process-baseline-v1",
    exactExecutableSha256: AUTHORITY.edgeExecutableSha256,
    processCount: pids.length,
    pids: Object.freeze(pids),
    processSetDigest: sha256(canonicalBytes(pids)),
    independentlyObserved: true,
  });
}

async function waitForExactEdgeProcessTree(edgeExecutable, profilePath, baselinePids) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const rows = queryExactEdgeProcesses(edgeExecutable);
    const fresh = rows.filter((row) => !baselinePids.has(row.pid));
    const freshPids = new Set(fresh.map((row) => row.pid));
    const roots = fresh.filter((row) => (
      !freshPids.has(row.parentPid)
      && commandLineContainsPhysicalPath(row.commandLine, profilePath)
    ));
    if (roots.length === 1) {
      const root = roots[0];
      const owned = new Set([root.pid]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const row of fresh) {
          if (!owned.has(row.pid) && owned.has(row.parentPid)) {
            owned.add(row.pid);
            changed = true;
          }
        }
      }
      if (fresh.every((row) => owned.has(row.pid))) {
        const treeRows = fresh.filter((row) => owned.has(row.pid)).map((row) => ({
          pid: row.pid,
          parentPid: row.parentPid,
          commandLineDigest: row.commandLineDigest,
        })).sort((left, right) => left.pid - right.pid);
        return Object.freeze({
          schemaVersion: "p2.4b-rc6.5-edge-process-tree-launch-v1",
          edgeExecutableSha256: AUTHORITY.edgeExecutableSha256,
          rootPid: root.pid,
          processCount: treeRows.length,
          descendantCount: treeRows.length - 1,
          processTreeDigest: sha256(canonicalBytes(treeRows)),
          processTree: Object.freeze(treeRows),
          ownedPids: Object.freeze([...owned].sort((left, right) => left - right)),
          profilePathDigest: sha256(normalizeForIdentity(profilePath)),
          exactExecutableBound: true,
        });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail("EDGE_PROCESS_TREE_LAUNCH_NOT_OBSERVED");
}

function deriveExactEdgeProcessResidueObservation(
  currentRows,
  edgeExecutable,
  launchReceipt,
) {
  if (
    !launchReceipt
    || launchReceipt.exactExecutableBound !== true
    || !Array.isArray(launchReceipt.ownedPids)
  ) fail("EDGE_PROCESS_LAUNCH_RECEIPT_MISSING");
  if (!Array.isArray(currentRows)) fail("EDGE_PROCESS_RESIDUE_OBSERVATION_MISSING");
  const residues = currentRows.filter((row) => (
    typeof row.executablePath === "string"
    && normalizeForIdentity(row.executablePath)
      === normalizeForIdentity(edgeExecutable)
  )).map((row) => ({
    pid: row.pid,
    parentPid: row.parentPid,
    commandLineDigest: row.commandLineDigest,
  })).sort((left, right) => left.pid - right.pid);
  return Object.freeze({
    edgeResidueCount: residues.length,
    residueDigest: sha256(canonicalBytes(residues)),
    residueProcesses: Object.freeze(residues),
    independentlyObserved: true,
  });
}

function observeExactEdgeProcessResidue(edgeExecutable, launchReceipt) {
  return deriveExactEdgeProcessResidueObservation(
    queryExactEdgeProcesses(edgeExecutable),
    edgeExecutable,
    launchReceipt,
  );
}

async function waitForExactEdgeProcessCleanup(
  edgeExecutable,
  launchReceipt,
) {
  let observation = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    observation = observeExactEdgeProcessResidue(
      edgeExecutable,
      launchReceipt,
    );
    if (observation.edgeResidueCount === 0) return observation;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return observation;
}

function createWebWorkerRegistry(context) {
  const active = new Map();
  const activeServiceWorkers = new Map();
  const allWorkerDigests = [];
  const allServiceWorkerDigests = [];
  let workerSequence = 0;
  const register = (worker) => {
    if (active.has(worker)) return;
    workerSequence += 1;
    const digest = sha256(
      "p2.4b-rc6.5-web-worker-v1\n" + String(workerSequence),
    );
    active.set(worker, digest);
    allWorkerDigests.push(digest);
    worker.once("close", () => {
      active.delete(worker);
    });
  };
  const registerPage = (page) => {
    for (const worker of page.workers()) register(worker);
    page.on("worker", register);
  };
  const registerServiceWorker = (worker) => {
    if (activeServiceWorkers.has(worker)) return;
    workerSequence += 1;
    const digest = sha256(
      "p2.4b-rc6.5-service-worker-v1\n" + String(workerSequence),
    );
    activeServiceWorkers.set(worker, digest);
    allServiceWorkerDigests.push(digest);
    worker.once("close", () => {
      activeServiceWorkers.delete(worker);
    });
  };
  for (const page of context.pages()) registerPage(page);
  context.on("page", registerPage);
  for (const worker of context.serviceWorkers()) registerServiceWorker(worker);
  context.on("serviceworker", registerServiceWorker);
  return Object.freeze({
    snapshot() {
      return Object.freeze({
        schemaVersion: "p2.4b-rc6.5-web-worker-registry-receipt-v1",
        webWorkerObservedCount: allWorkerDigests.length,
        activeWebWorkerCount: active.size,
        serviceWorkerObservedCount: allServiceWorkerDigests.length,
        activeServiceWorkerCount: activeServiceWorkers.size,
        workerSetDigest: sha256(canonicalBytes(allWorkerDigests)),
        serviceWorkerSetDigest:
          sha256(canonicalBytes(allServiceWorkerDigests)),
        independentlyObserved: true,
      });
    },
  });
}

async function waitForWebWorkerCleanup(registry) {
  let observation = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    observation = registry.snapshot();
    if (
      observation.activeWebWorkerCount === 0
      && observation.activeServiceWorkerCount === 0
    ) return observation;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return observation;
}

async function describeAdapter(page) {
  return page.evaluate((globalName) => {
    const adapter = globalThis[globalName];
    if (!adapter || typeof adapter.describe !== "function") {
      throw new Error("QUALIFICATION_ADAPTER_MISSING");
    }
    return adapter.describe();
  }, ADAPTER_GLOBAL);
}

async function prepareAdapter(page, input) {
  return page.evaluate(async ({ globalName, prepareInput }) => {
    const adapter = globalThis[globalName];
    if (!adapter || typeof adapter.prepare !== "function") {
      throw new Error("QUALIFICATION_ADAPTER_PREPARE_MISSING");
    }
    return adapter.prepare(prepareInput);
  }, { globalName: ADAPTER_GLOBAL, prepareInput: input });
}

async function observeAdapter(page, input) {
  const result = await page.evaluate(async ({ globalName, observationInput }) => {
    const adapter = globalThis[globalName];
    if (!adapter || typeof adapter.observe !== "function") {
      throw new Error("QUALIFICATION_ADAPTER_OBSERVE_MISSING");
    }
    return adapter.observe(observationInput);
  }, { globalName: ADAPTER_GLOBAL, observationInput: input });
  return result;
}

async function collectPhase(page, fixtureIds, partition, executionMode, cancelledSegments) {
  const rows = [];
  for (let index = 0; index < fixtureIds.length; index += 1) {
    const expected = {
      fixtureId: fixtureIds[index],
      partition,
      executionMode,
      cancelledSegment: cancelledSegments ? cancelledSegments[index] : null,
    };
    const result = await observeAdapter(page, {
      schemaVersion: "p2.4b-rc6.5-browser-prose-observation-request-v1",
      candidateIdentityDigest: CANDIDATE_IDENTITY,
      ...expected,
      rawContextTransferred: false,
      productionPassRequested: false,
    });
    assertObservation(result, expected);
    rows.push(result);
  }
  return rows;
}

function safeFailureCode(error) {
  if (error instanceof QualificationError && SAFE_ID.test(error.code)) return error.code;
  return "QUALIFICATION_RUNNER_UNEXPECTED_FAILURE";
}

function safeFailureDigest(error) {
  const message = error instanceof Error ? error.message : String(error);
  return sha256("p2.4b-rc6.5-qualification-error-v1\n" + message);
}

async function runLiveOnce(configPath, liveToken) {
  const configFile = readCanonicalJson(configPath, {
    code: "LIVE_CONFIG_FILE_INVALID",
    requireSidecar: true,
  });
  const validated = validateLiveConfig(configFile.value);
  const edgeLaunchIsolationPrecondition =
    deriveEdgeLaunchIsolationPreconditionReceipt();
  const playwright = await loadPlaywrightForLive(
    liveToken,
    validated.sourceFreezeManifestDigest,
  );
  const runId = "rc65q-" + randomBytes(16).toString("hex");
  const markerPath = markerFileFor(validated.roots.ledgerRoot);
  if (existsSync(markerPath)) fail("CANDIDATE_IDENTITY_ALREADY_CONSUMED");
  const state = createState(validated.config.candidateOrdinal);
  let mutex = null;
  let marker = null;
  let context = null;
  let observer = null;
  let observerStopped = false;
  let profilePath = null;
  let profileOwner = null;
  let evidenceDirectory = null;
  let started = false;
  try {
    observer = await startSealedLoopbackObserver(validated.networkPolicy);
    const observerStartedBeforeEdge = true;
    mutex = await acquireNamedMutex(validated.roots.mutexRoot, runId);
    marker = createStartedMarker(
      validated.roots.ledgerRoot,
      validated.config.candidateOrdinal,
      runId,
    );
    started = true;
    evidenceDirectory = path.win32.join(
      validated.roots.evidenceRoot,
      "browser-prose-candidate-v2-qualification",
      CANDIDATE_IDENTITY,
      runId,
    );
    mkdirSync(evidenceDirectory, { recursive: true });
    assertDPath(evidenceDirectory, {
      code: "QUALIFICATION_EVIDENCE_DIRECTORY_INVALID",
      kind: "directory",
    });
    profilePath = path.win32.join(
      validated.roots.profileRoot,
      "novel-rc65-qualification-" + CANDIDATE_IDENTITY.slice(0, 12) + "-" + runId,
    );
    if (existsSync(profilePath)) fail("QUALIFICATION_PROFILE_NOT_FRESH");
    const baselineRows = queryExactEdgeProcesses(AUTHORITY.dEdgeExecutable);
    const edgeBaseline = createEdgeBaselineReceipt(baselineRows);
    const baselinePids = new Set(baselineRows.map((row) => row.pid));
    mkdirSync(profilePath);
    assertDPath(profilePath, {
      code: "QUALIFICATION_PROFILE_PATH_INVALID",
      kind: "directory",
    });
    profileOwner = createProfileOwner(profilePath, runId);
    const edgeManagedPreferencesSeed =
      createEdgeManagedPreferencesSeed(profilePath);
    const routeRecords = [];
    let networkPhase = "setup";
    const launchArgs = [
      ...EDGE_LAUNCH_POLICY.args,
      "--proxy-server=" + observer.proxyOrigin,
    ];
    context = await playwright.chromium.launchPersistentContext(profilePath, {
      executablePath: AUTHORITY.dEdgeExecutable,
      headless: true,
      acceptDownloads: false,
      serviceWorkers: EDGE_LAUNCH_POLICY.serviceWorkers,
      proxy: { server: observer.proxyOrigin },
      args: launchArgs,
    });
    const edgeLaunch = await waitForExactEdgeProcessTree(
      AUTHORITY.dEdgeExecutable,
      profilePath,
      baselinePids,
    );
    const workerRegistry = createWebWorkerRegistry(context);
    let routeInstalledBeforeNavigation = false;
    await context.route("**/*", async (route) => {
      const safeRecord = classifyNetworkRequest(
        route.request().url(),
        networkPhase,
        validated.networkPolicy,
        route.request().method(),
      );
      routeRecords.push(safeRecord);
      if (safeRecord.blocked) {
        await route.abort("blockedbyclient");
      } else {
        await route.continue();
      }
    });
    routeInstalledBeforeNavigation = true;
    const pages = context.pages();
    const page = pages[0] || await context.newPage();
    await page.goto(validated.config.adapter.pageUrl, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    const adapterDescriptionBefore = validateAdapterDescription(
      await describeAdapter(page),
      adapterExpectationFromValidated(validated),
    );
    const setupReceipt = validateSetupReceipt(await prepareAdapter(page, {
      schemaVersion: "p2.4b-rc6.5-browser-prose-qualification-prepare-v1",
      candidateIdentityDigest: CANDIDATE_IDENTITY,
      sourceSetDigest: validated.sourceSetDigest,
      rawContextTransferred: false,
      productionPassRequested: false,
    }), {
      adapterDigest: validated.config.adapter.adapterDigest,
      sourceSetDigest: validated.sourceSetDigest,
    });
    const setupNetworkSnapshot = observer.snapshot();
    if (
      routeRecords.some((row) => row.external || row.blocked)
      || setupNetworkSnapshot.deniedRequestCount !== 0
      || setupNetworkSnapshot.externalRequestCount !== 0
      || setupNetworkSnapshot.forwardFailureCount !== 0
    ) {
      fail("QUALIFICATION_SETUP_NETWORK_NOT_CLOSED");
    }
    transitionState(state, "PREFLIGHT_PASS", {
      bridgeDigest: validated.bridge.bridgeDigest,
      candidateRegistryDigest: validated.registryFileDigest,
      liveIdentityClaimed: true,
      preconditionSetDigest: validated.preconditionSetDigest,
      sourceSetDigest: validated.sourceSetDigest,
    });
    const preDevelopmentSnapshot = captureObservedTuningBoundarySnapshot(
      configFile.value,
      adapterDescriptionBefore,
    );
    networkPhase = "measurement";
    observer.setPhase("measurement");
    const development = await collectPhase(
      page,
      DEVELOPMENT_FIXTURES,
      "development",
      "cold",
      null,
    );
    const adapterDescriptionAfter = await describeAdapter(page);
    const postDevelopmentSnapshot = captureObservedTuningBoundarySnapshot(
      configFile.value,
      adapterDescriptionAfter,
    );
    const tuningFreezeReceipt = createObservedTuningFreezeReceipt(
      preDevelopmentSnapshot,
      postDevelopmentSnapshot,
    );
    transitionState(state, "DEVELOPMENT_COMPLETE", {
      metrics: development,
      tuningFreezeReceipt,
    });
    const holdout = await collectPhase(
      page,
      HOLDOUT_FIXTURES,
      "holdout",
      "cold",
      null,
    );
    transitionState(state, "HOLDOUT_COMPLETE", {
      metrics: holdout,
      tuningFreezeDigest: sha256(canonicalBytes(tuningFreezeReceipt)),
      tuningMutationCount: 0,
    });
    const warm = await collectPhase(
      page,
      HOLDOUT_FIXTURES,
      "holdout",
      "warm",
      null,
    );
    transitionState(state, "WARM_COMPLETE", { metrics: warm });
    const cancelRetry = await collectPhase(
      page,
      HOLDOUT_FIXTURES.slice(0, 3),
      "holdout",
      "cancel-retry",
      SEGMENTS,
    );
    transitionState(state, "CANCEL_RETRY_COMPLETE", { metrics: cancelRetry });
    if (routeRecords.some((row) => row.external || row.blocked)) {
      fail("QUALIFICATION_MEASUREMENT_NETWORK_NOT_CLOSED");
    }
    transitionState(state, "DECISION_COMPLETE", {
      candidateQualificationPass: true,
      productionPassClaimed: false,
      safeCode: "P2_4B_RC6_5_BROWSER_PROSE_CANDIDATE_V2_QUALIFIED",
      syntheticObservedReceipt: false,
    });
    await context.close();
    context = null;
    const workerCleanup = await waitForWebWorkerCleanup(workerRegistry);
    rmSync(profilePath, { recursive: true, force: false });
    const edgeCleanup = await waitForExactEdgeProcessCleanup(
      AUTHORITY.dEdgeExecutable,
      edgeLaunch,
    );
    const profileResidueCount = existsSync(profilePath) ? 1 : 0;
    await observer.stop();
    observerStopped = true;
    const networkObservation = deriveNetworkObservationReceipt({
      observerSnapshot: observer.snapshot(),
      observerStartedBeforeEdge,
      routeInstalledBeforeNavigation,
      proxyConfigured: true,
      proxyBypassConfigured: EDGE_LAUNCH_POLICY.proxyBypassConfigured,
      serviceWorkers: EDGE_LAUNCH_POLICY.serviceWorkers,
      launchArgs,
      launchArgsDigest: sha256(canonicalBytes(launchArgs)),
      routeRecords,
    });
    await mutex.release();
    const cleanup = {
      edgeResidueCount: edgeCleanup.edgeResidueCount,
      mutexResidueCount: existsSync(mutex.directory) ? 1 : 0,
      networkObserverDisposed: observerStopped,
      profileDisposed: profileResidueCount === 0,
      profileResidueCount,
      runnerOwnedResourcesReleased:
        edgeCleanup.edgeResidueCount === 0
        && workerCleanup.activeWebWorkerCount === 0
        && workerCleanup.activeServiceWorkerCount === 0
        && workerCleanup.serviceWorkerObservedCount === 0
        && profileResidueCount === 0
        && observerStopped
        && !existsSync(mutex.directory),
      workerResidueCount:
        workerCleanup.activeWebWorkerCount
        + workerCleanup.activeServiceWorkerCount,
    };
    transitionState(state, "CLEANUP_COMPLETE", cleanup);
    const markerObservation = verifyStartedMarkerRetained(marker);
    const evidenceBody = {
      schemaVersion: EVIDENCE_SCHEMA,
      candidateIdentityDigest: CANDIDATE_IDENTITY,
      candidateOrdinal: validated.config.candidateOrdinal,
      runId,
      freshCandidateLineage: true,
      edgeExecuted: true,
      modelExecuted: true,
      externalNetworkRequestCount: 0,
      dataEgressEventCount: 0,
      productionPassClaimed: false,
      formalAttemptCreated: false,
      lunaExecuted: false,
      preconditionSetDigest: validated.preconditionSetDigest,
      sourceSetDigest: validated.sourceSetDigest,
      bridgeDigest: validated.bridge.bridgeDigest,
      registryDigest: validated.registryFileDigest,
      edgeExecutableSha256: AUTHORITY.edgeExecutableSha256,
      profilePathDigest: sha256(normalizeForIdentity(profilePath)),
      profileOwnerDigest: profileOwner.digest,
      edgeLaunchIsolationPrecondition,
      edgeManagedPreferencesSeed,
      setupReceipt,
      networkObservation,
      edgeBaseline,
      edgeLaunch,
      edgeCleanup,
      workerCleanup,
      tuningFreezeReceipt,
      phases: state.phases,
      decision: state.decision,
      cleanup: state.cleanup,
      startedMarkerDigest: marker.digest,
      startedMarkerObservation: markerObservation,
      stateEventDigests: state.eventDigests,
      rawEvidenceStored: false,
    };
    assertNoForbiddenEvidence(evidenceBody);
    const evidenceBodyDigest = sha256(canonicalBytes(evidenceBody));
    transitionState(state, "SEAL", {
      evidenceDigest: evidenceBodyDigest,
      mutexReleased: true,
      startedMarkerRetained: markerObservation.retained,
    });
    const evidence = {
      ...evidenceBody,
      evidenceBodyDigest,
      finalState: state.state,
      finalStateEventDigest: state.previousEventDigest,
      stateEventDigests: state.eventDigests,
    };
    const written = writeCanonicalExclusive(
      path.win32.join(evidenceDirectory, "qualification-evidence.json"),
      evidence,
      { allowedRoot: evidenceDirectory },
    );
    const evidenceReadback = readCanonicalJson(written.path, {
      code: "QUALIFICATION_EVIDENCE_READBACK_INVALID",
      expectedSha256: written.digest,
      requireSidecar: true,
    });
    if (stableJson(evidenceReadback.value) !== stableJson(evidence)) {
      fail("QUALIFICATION_EVIDENCE_READBACK_MISMATCH");
    }
    return Object.freeze({
      mode: "LIVE_ONCE",
      evidence: written,
      candidateQualificationPass: true,
      productionPassClaimed: false,
    });
  } catch (error) {
    if (context) {
      try {
        await context.close();
      } catch {
        // Safe failure projection below is authoritative.
      }
    }
    if (observer && !observerStopped) {
      try {
        await observer.stop();
        observerStopped = true;
      } catch {
        // A live observer residue prevents PASS because this path always rethrows.
      }
    }
    if (profilePath && existsSync(profilePath)) {
      try {
        if (isWithin(validated.roots.profileRoot, profilePath)) {
          rmSync(profilePath, { recursive: true, force: true });
        }
      } catch {
        // Residue remains a blocker and is never projected as PASS.
      }
    }
    if (mutex && !mutex.isReleased()) {
      try {
        await mutex.release();
      } catch {
        // Mutex cleanup failure remains visible by the absence of terminal PASS.
      }
    }
    if (started && evidenceDirectory && existsSync(evidenceDirectory)) {
      const terminal = {
        schemaVersion: "p2.4b-rc6.5-browser-prose-qualification-terminal-failure-v1",
        candidateIdentityDigest: CANDIDATE_IDENTITY,
        runId,
        safeCode: safeFailureCode(error),
        errorDigest: safeFailureDigest(error),
        onceConsumed: true,
        candidateQualificationPass: false,
        productionPassClaimed: false,
        syntheticObservedReceipt: false,
        formalAttemptCreated: false,
        rawEvidenceStored: false,
      };
      try {
        writeCanonicalExclusive(
          path.win32.join(evidenceDirectory, "terminal-failure.json"),
          terminal,
          { allowedRoot: evidenceDirectory },
        );
      } catch {
        // Never replace the original failure with evidence-write failure.
      }
    }
    throw error;
  }
}

function contractBridge() {
  return {
    schemaVersion: BRIDGE_SCHEMA,
    archiveManifestSha256: AUTHORITY.archiveManifestSha256,
    relocationAuthoritySha256: AUTHORITY.relocationAuthoritySha256,
    cToDPathMapSha256: AUTHORITY.cToDPathMapSha256,
    junctionMapSha256: AUTHORITY.junctionMapSha256,
    environmentPathsSha256: AUTHORITY.environmentPathsSha256,
    priorC10ReceiptSha256: AUTHORITY.priorC10ReceiptSha256,
    priorC10ProofDigest: AUTHORITY.priorC10ProofDigest,
    edgeManifestSha256: AUTHORITY.edgeManifestSha256,
    edgeManifestDigest: AUTHORITY.edgeManifestDigest,
    edgeTreeDigest: AUTHORITY.edgeTreeDigest,
    edgeExecutableSha256: AUTHORITY.edgeExecutableSha256,
    edgeDllSha256: AUTHORITY.edgeDllSha256,
    cCompatibilityRoot: AUTHORITY.cCompatibilityRoot,
    dToolchainRoot: AUTHORITY.dToolchainRoot,
    dEdgeExecutable: AUTHORITY.dEdgeExecutable,
    dEdgeDll: AUTHORITY.dEdgeDll,
    cCompatibilityRootIsJunction: true,
    dPhysicalExecutionRequired: true,
    historicalLimitationCode: "PRE_MIGRATION_C_PHYSICAL_RETENTION_UNVERIFIABLE",
    migrationAuthorityDisposition: "D_VERIFIED_PRESERVATION_PACKAGE_IS_AUTHORITY",
    preMigrationCPhysicalRetentionClaimed: false,
  };
}

function contractRegistry(entries = null) {
  return {
    schemaVersion: REGISTRY_SCHEMA,
    maxCandidates: 2,
    entries: entries || [
      {
        ordinal: 1,
        identityDigest: PRIOR_CANDIDATE_IDENTITY,
        status: "not-qualified",
        materiallyDifferent: true,
        blockedRc64Reused: false,
      },
      {
        ordinal: 2,
        identityDigest: CANDIDATE_IDENTITY,
        status: "eligible",
        materiallyDifferent: true,
        blockedRc64Reused: false,
      },
    ],
  };
}

function contractObservation(input) {
  const cancelledSegment = input.cancelledSegment || null;
  return {
    schemaVersion: OBSERVATION_SCHEMA,
    candidateIdentityDigest: CANDIDATE_IDENTITY,
    fixtureId: input.fixtureId,
    partition: input.partition,
    executionMode: input.executionMode,
    runtimeReceiptDigest: sha256("runtime\n" + input.fixtureId + "\n" + input.executionMode),
    finalAttestationDigest:
      sha256("attestation\n" + input.fixtureId + "\n" + input.executionMode),
    selectedPrefixDigest:
      sha256("selected-prefix\n" + input.fixtureId + "\n" + input.executionMode),
    selectedHanCharacters: 264,
    qualityScore: 1,
    qualityReasonCodes: [],
    contextAnchorVerified: true,
    characterAnchorVerified: true,
    narrativeProgressVerified: true,
    repetitionDisposition: "acceptable",
    modelResponseCount: 3,
    modelRetryCount: 0,
    finishReasons: ["stop", "stop", "stop"],
    actualExecutor: "browser-ai",
    underlyingExecutor: "webllm-worker",
    candidateOnly: true,
    externalRequest: false,
    dataLeftDevice: false,
    canonicalMutationCount: 0,
    formalApprovalMutationCount: 0,
    rawOutputStored: false,
    rawPromptStored: false,
    rawStoryBibleStored: false,
    rawChapterStored: false,
    chainOfThoughtStored: false,
    cancelledSegment,
    cancelledPartialPersisted: false,
    retryReusedCancelledOutput: false,
    syntheticObservedReceipt: false,
    productionPassClaimed: false,
    candidateQualificationPass: true,
    tuningAllowed: input.partition === "development",
    tuningMutationCount: 0,
  };
}

function contractPhase(fixtureIds, partition, executionMode, cancelledSegments = null) {
  return fixtureIds.map((fixtureId, index) => contractObservation({
    fixtureId,
    partition,
    executionMode,
    cancelledSegment: cancelledSegments ? cancelledSegments[index] : null,
  }));
}

function contractTuningFreezeReceipt(seed = "contract-authority") {
  const digest = sha256(seed);
  return {
    schemaVersion: TUNING_FREEZE_SCHEMA,
    candidateIdentityDigest: CANDIDATE_IDENTITY,
    preDevelopmentSnapshotDigest: digest,
    postDevelopmentSnapshotDigest: digest,
    sourceFreezeManifestSha256: digest,
    sourceIdentityDigest: digest,
    sourceChangedContentSetDigest: digest,
    artifactSetDigest: digest,
    adapterDescriptionDigest: digest,
    adapterRuntimePolicyDigest: CANDIDATE_RUNTIME_POLICY_DIGEST,
    candidateRegistrySha256: digest,
    observedBeforeDevelopment: true,
    observedAfterDevelopment: true,
    tuningMutationCount: 0,
    syntheticObservedReceipt: false,
    productionPassClaimed: false,
  };
}

function completeContractState(candidateOrdinal = 2) {
  const state = createState(candidateOrdinal);
  const digest = sha256("contract-authority");
  const tuningFreezeReceipt = contractTuningFreezeReceipt();
  transitionState(state, "PREFLIGHT_PASS", {
    bridgeDigest: digest,
    candidateRegistryDigest: digest,
    liveIdentityClaimed: true,
    preconditionSetDigest: digest,
    sourceSetDigest: digest,
  });
  transitionState(state, "DEVELOPMENT_COMPLETE", {
    metrics: contractPhase(DEVELOPMENT_FIXTURES, "development", "cold"),
    tuningFreezeReceipt,
  });
  transitionState(state, "HOLDOUT_COMPLETE", {
    metrics: contractPhase(HOLDOUT_FIXTURES, "holdout", "cold"),
    tuningFreezeDigest: sha256(canonicalBytes(tuningFreezeReceipt)),
    tuningMutationCount: 0,
  });
  transitionState(state, "WARM_COMPLETE", {
    metrics: contractPhase(HOLDOUT_FIXTURES, "holdout", "warm"),
  });
  transitionState(state, "CANCEL_RETRY_COMPLETE", {
    metrics: contractPhase(
      HOLDOUT_FIXTURES.slice(0, 3),
      "holdout",
      "cancel-retry",
      SEGMENTS,
    ),
  });
  transitionState(state, "DECISION_COMPLETE", {
    candidateQualificationPass: true,
    productionPassClaimed: false,
    safeCode: "P2_4B_RC6_5_BROWSER_PROSE_CANDIDATE_V2_QUALIFIED",
    syntheticObservedReceipt: false,
  });
  transitionState(state, "CLEANUP_COMPLETE", {
    edgeResidueCount: 0,
    mutexResidueCount: 0,
    networkObserverDisposed: true,
    profileDisposed: true,
    profileResidueCount: 0,
    runnerOwnedResourcesReleased: true,
    workerResidueCount: 0,
  });
  transitionState(state, "SEAL", {
    evidenceDigest: sha256("contract-evidence"),
    mutexReleased: true,
    startedMarkerRetained: true,
  });
  return state;
}

function writeContractFile(file, bytes) {
  mkdirSync(path.win32.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  return sha256(bytes);
}

function writeContractCanonical(file, value) {
  mkdirSync(path.win32.dirname(file), { recursive: true });
  return writeCanonicalExclusive(file, value, {
    allowedRoot: path.win32.dirname(file),
  });
}

function createContractFixture(contractRoot) {
  const artifactsRoot = path.win32.join(contractRoot, "artifacts");
  mkdirSync(artifactsRoot, { recursive: true });
  const staticPath = path.win32.join(artifactsRoot, "qualification-adapter.bundle.js");
  const staticBytes = Buffer.from(
    "globalThis.__RC65_CONTRACT_STATIC_BUNDLE__=true;\n",
    "utf8",
  );
  const staticDigest = writeContractFile(staticPath, staticBytes);
  writeFileSync(
    staticPath + ".sha256",
    staticDigest + "  " + path.win32.basename(staticPath) + "\n",
    "utf8",
  );
  const build = writeContractCanonical(
    path.win32.join(artifactsRoot, "build-manifest.json"),
    {
      schemaVersion: "p2.4b-rc6.5-contract-build-manifest-v1",
      candidateIdentityDigest: CANDIDATE_IDENTITY,
      buildIdentityDigest: sha256("contract-build-identity"),
      dPhysicalBuild: true,
      productionPassClaimed: false,
    },
  );
  const staticManifest = writeContractCanonical(
    path.win32.join(artifactsRoot, "static-manifest.json"),
    {
      schemaVersion: "p2.4b-rc6.5-contract-static-manifest-v1",
      candidateIdentityDigest: CANDIDATE_IDENTITY,
      adapterBundleSha256: staticDigest,
      assetSetDigest: sha256("contract-static-asset-set"),
      productionPassClaimed: false,
    },
  );
  const vault = writeContractCanonical(
    path.win32.join(artifactsRoot, "vault-manifest.json"),
    {
      schemaVersion: VAULT_MANIFEST_SCHEMA,
      candidateIdentityDigest: CANDIDATE_IDENTITY,
      developmentFixtureCount: 5,
      holdoutFixtureCount: 5,
      developmentPartitionDigest: sha256(canonicalBytes(DEVELOPMENT_FIXTURES)),
      holdoutPartitionDigest: sha256(canonicalBytes(HOLDOUT_FIXTURES)),
      fixtureIdSetDigest: sha256(canonicalBytes(
        [...DEVELOPMENT_FIXTURES, ...HOLDOUT_FIXTURES],
      )),
      partitionOverlapCount: 0,
      rawContextStoredInVault: true,
      rawContextInProductEvidence: false,
      tuningBoundarySealed: true,
      vaultPayloadDigest: sha256("contract-vault-payload"),
      productionPassClaimed: false,
    },
  );
  const registry = writeContractCanonical(
    path.win32.join(artifactsRoot, "candidate-registry.json"),
    contractRegistry(),
  );
  const bridge = writeContractCanonical(
    path.win32.join(artifactsRoot, "edge-bridge.json"),
    contractBridge(),
  );
  const gitTruth = captureCurrentGitTruth();
  const finalAuthority = readFinalSourceFreezeAuthority(
    FINAL_SOURCE_FREEZE_AUTHORITY_PATH,
    { allowContractPath: true },
  );
  assertCurrent51PathClosure(gitTruth, finalAuthority);
  const sourceFreezeBody = {
    schemaVersion: SOURCE_FREEZE_SCHEMA,
    candidateIdentityDigest: CANDIDATE_IDENTITY,
    baseCommit: BASE_COMMIT,
    originMain: BASE_COMMIT,
    changedPathCount: gitTruth.changedPathCount,
    trackedModifiedCount: gitTruth.trackedModifiedCount,
    untrackedCount: gitTruth.untrackedCount,
    changedPathSetDigest: gitTruth.changedPathSetDigest,
    changedContentSetDigest: gitTruth.changedContentSetDigest,
    changedFiles: gitTruth.files,
    runnerSha256: sha256(readFileSync(RUNNER_PATH)),
    finalAuthorityPath: FINAL_SOURCE_FREEZE_AUTHORITY_PATH,
    finalAuthorityPathDigest: finalAuthority.pathDigest,
    finalAuthoritySha256: FINAL_SOURCE_FREEZE_AUTHORITY_SHA256,
    finalAuthorityStatusPathSetSha256: FINAL_SOURCE_FREEZE_STATUS_PATH_SET_SHA256,
    finalAuthorityChangedPathCount: 50,
    buildManifestSha256: build.digest,
    staticManifestSha256: staticManifest.digest,
    adapterBundleSha256: staticDigest,
    adapterDigest: staticDigest,
    vaultManifestSha256: vault.digest,
    candidateRegistrySha256: registry.digest,
    adapterRuntimePolicyDigest: CANDIDATE_RUNTIME_POLICY_DIGEST,
    sourceFrozen: true,
    productionPassClaimed: false,
  };
  const sourceIdentityDigest = sha256(
    "p2.4b-rc6.5-browser-prose-qualification-source-freeze-v2\n"
      + stableJson(sourceFreezeIdentityBody(sourceFreezeBody)),
  );
  const source = writeContractCanonical(
    path.win32.join(artifactsRoot, "source-freeze.json"),
    {
      ...sourceFreezeBody,
      sourceIdentityDigest,
    },
  );
  const neverRoot = path.win32.join(contractRoot, "must-not-exist");
  const adapterOrigin = "http://127.0.0.1:49165";
  const config = {
    schemaVersion: CONFIG_SCHEMA,
    candidateIdentityDigest: CANDIDATE_IDENTITY,
    candidateOrdinal: 2,
    liveDriverSealed: true,
    evidenceRoot: path.win32.join(neverRoot, "live-evidence"),
    ledgerRoot: path.win32.join(neverRoot, "live-ledger"),
    mutexRoot: path.win32.join(neverRoot, "live-mutex"),
    profileRoot: path.win32.join(neverRoot, "live-profile"),
    temporaryRoot: path.win32.join(neverRoot, "live-temp"),
    adapter: {
      adapterDigest: staticDigest,
      globalName: ADAPTER_GLOBAL,
      pageUrl: adapterOrigin + "/qualification",
    },
    networkPolicy: {
      schemaVersion: NETWORK_POLICY_SCHEMA,
      setupOrigins: [adapterOrigin],
      measurementOrigins: [adapterOrigin],
      allowedPathPrefixes: ["/qualification", "/_next/", "/models/"],
      modelSetupDownloadAllowed: false,
      proxyMode: "sealed-loopback-http-connect-deny-v1",
    },
    preconditions: [
      {
        role: "source-freeze",
        path: source.path,
        sha256: source.digest,
        canonicalJson: true,
        sidecarRequired: true,
      },
      {
        role: "build-manifest",
        path: build.path,
        sha256: build.digest,
        canonicalJson: true,
        sidecarRequired: true,
      },
      {
        role: "static-manifest",
        path: staticManifest.path,
        sha256: staticManifest.digest,
        canonicalJson: true,
        sidecarRequired: true,
      },
      {
        role: "static-bundle",
        path: staticPath,
        sha256: staticDigest,
        canonicalJson: false,
        sidecarRequired: true,
      },
      {
        role: "vault-manifest",
        path: vault.path,
        sha256: vault.digest,
        canonicalJson: true,
        sidecarRequired: true,
      },
    ],
    candidateRegistry: {
      path: registry.path,
      sha256: registry.digest,
    },
    edgeBridge: {
      path: bridge.path,
      sha256: bridge.digest,
    },
  };
  return Object.freeze({
    config,
    neverRoot,
    source,
    build,
    staticManifest,
    vault,
    registry,
    bridge,
    staticPath,
    adapterDescription: Object.freeze({
      schemaVersion: ADAPTER_SCHEMA,
      candidateIdentityDigest: CANDIDATE_IDENTITY,
      adapterDigest: staticDigest,
      sourceIdentityDigest,
      buildManifestSha256: build.digest,
      staticManifestSha256: staticManifest.digest,
      runtimePolicyDigest: CANDIDATE_RUNTIME_POLICY_DIGEST,
      candidateOnly: true,
      syntheticObservedReceipt: false,
      productionPassClaimed: false,
    }),
  });
}

async function expectFailure(fn, pattern) {
  let captured = null;
  try {
    await fn();
  } catch (error) {
    captured = error;
  }
  if (!captured) fail("NEGATIVE_CONTRACT_DID_NOT_FAIL");
  const code = captured instanceof QualificationError
    ? captured.code
    : String(captured.message || captured);
  if (!pattern.test(code)) {
    throw new Error(
      "NEGATIVE_CONTRACT_WRONG_FAILURE expected "
        + pattern.source
        + " actual "
        + code,
    );
  }
}

async function runOfflineContract() {
  const contractParent = "D:\\runtime\\novel\\temp";
  assertDPath(contractParent, {
    code: "CONTRACT_TEMP_PARENT_INVALID",
    kind: "directory",
  });
  const contractRoot = path.win32.join(
    contractParent,
    "rc65-qualification-offline-contract-" + process.pid + "-"
      + randomBytes(8).toString("hex"),
  );
  mkdirSync(contractRoot);
  const tests = [];
  let mutationCount = 0;
  const test = (name, fn, mutation = false) => {
    tests.push({ name, fn, mutation });
  };
  let fixture;
  try {
    fixture = createContractFixture(contractRoot);
    test("current candidate identity is exact and not blocked RC6.4", () => {
      assert.equal(CANDIDATE_IDENTITY.length, 64);
      assert.match(CANDIDATE_IDENTITY, SHA256_HEX);
      assert.equal(
        deriveCandidateIdentityFromLineageEnvelope(),
        CANDIDATE_IDENTITY,
      );
      assert.equal(CANDIDATE_LINEAGE_ENVELOPE.candidateOrdinal, 2);
      assert.equal(
        CANDIDATE_LINEAGE_ENVELOPE.priorCandidateIdentityDigest,
        PRIOR_CANDIDATE_IDENTITY,
      );
      assert.equal(BLOCKED_RC64_IDENTITIES.includes(CANDIDATE_IDENTITY), false);
      assert.equal(CANDIDATE_IDENTITY.startsWith("f39"), false);
    });
    test("source static vault registry and bridge preconditions bind exact hashes", () => {
      const result = validateLiveConfig(fixture.config, { allowContractPath: true });
      assert.equal(result.preconditions.length, 5);
      assert.equal(result.registry.candidateCount, 2);
      assert.equal(result.bridge.dPhysicalExecutionRequired, true);
      assert.match(result.preconditionSetDigest, SHA256_HEX);
      const snapshot = captureObservedTuningBoundarySnapshot(
        fixture.config,
        fixture.adapterDescription,
        { allowContractPath: true },
      );
      assert.equal(snapshot.diskArtifactsRehashed, true);
    });
    test("C to D bridge recognizes historical retention limitation without false claim", () => {
      const result = validateBridge(contractBridge());
      assert.equal(
        result.historicalLimitationCode,
        "PRE_MIGRATION_C_PHYSICAL_RETENTION_UNVERIFIABLE",
      );
      assert.equal(contractBridge().preMigrationCPhysicalRetentionClaimed, false);
    });
    test("full state machine is exact Dev5 Holdout5 Warm5 CancelRetry3", () => {
      const state = completeContractState();
      assert.equal(state.state, "Sealed");
      assert.equal(state.phases.development.length, 5);
      assert.equal(state.phases.holdout.length, 5);
      assert.equal(state.phases.warm.length, 5);
      assert.equal(state.phases.cancelRetry.length, 3);
      assert.equal(state.eventDigests.length, 8);
      assert.equal(state.decision.productionPassClaimed, false);
    });
    test("safe canonical evidence writes with matching sidecar", () => {
      const root = path.win32.join(contractRoot, "canonical-proof");
      mkdirSync(root);
      const value = {
        schemaVersion: "p2.4b-rc6.5-contract-safe-evidence-v1",
        candidateIdentityDigest: CANDIDATE_IDENTITY,
        productionPassClaimed: false,
      };
      const written = writeCanonicalExclusive(
        path.win32.join(root, "safe.json"),
        value,
        { allowedRoot: root },
      );
      const read = readCanonicalJson(written.path, {
        allowContractPath: true,
        requireSidecar: true,
      });
      assert.equal(read.digest, written.digest);
    });
    test("network parser emits digests only and loopback measurement is allowed", () => {
      const parsed = parseNetworkPolicy(fixture.config.networkPolicy);
      const row = classifyNetworkRequest(
        fixture.config.adapter.pageUrl + "?contract=1",
        "measurement",
        parsed,
      );
      assert.equal(row.allowlisted, true);
      assert.equal(row.external, false);
      assert.equal(Object.hasOwn(row, "url"), false);
      assert.equal(stableJson(row).includes(fixture.config.adapter.pageUrl), false);
    });
    test("network completeness is derived from observer route and launch policy", () => {
      const parsed = parseNetworkPolicy(fixture.config.networkPolicy);
      const receipt = deriveNetworkObservationReceipt(
        contractNetworkObservationInput(parsed, fixture.config.adapter.pageUrl),
      );
      assert.equal(receipt.networkObservationComplete, true);
      assert.equal(receipt.deniedRequestCount, 0);
      assert.equal(receipt.rawUrlStored, false);
    });
    test("contract mutex and exclusive started marker do not use live namespaces", async () => {
      const root = path.win32.join(contractRoot, "once-control");
      mkdirSync(root);
      const mutex = await acquireNamedMutex(root, "contract-run-01", {
        scope: "contract",
      });
      const marker = createStartedMarker(root, 2, "contract-run-01", {
        scope: "contract",
      });
      assert.equal(
        path.win32.basename(path.win32.dirname(marker.path)),
        CANDIDATE_IDENTITY,
      );
      assert.equal(
        path.win32.basename(path.win32.dirname(path.win32.dirname(marker.path))),
        "contract-ledger",
      );
      assert.match(path.win32.basename(mutex.directory), /^contract-/u);
      await mutex.release();
    });
    test("offline resolves the Playwright test package without loading it", () => {
      assert.equal(PLAYWRIGHT_TEST_PACKAGE, "@playwright/test");
      assert.match(PLAYWRIGHT_TEST_RESOLUTION, /@playwright[\\/]test/u);
      assert.equal(EDGE_LAUNCH_POLICY.serviceWorkers, "block");
      assert.equal(EDGE_LAUNCH_POLICY.proxyBypassConfigured, false);
      assert.deepEqual(EDGE_MANAGED_PREFERENCES_SEED, {
        FetchShoppingSettingsOnStartUp: true,
        edge_shopping_assistant_enabled: false,
        profile: { managed_default_content_settings: { ads: 1 } },
        shopping: { contextual_features_enabled: false },
      });
      for (const feature of [
        "NetworkTimeServiceQuerying",
        "PreconnectToSearch",
        "PreconnectToSearchNonBing",
        "msBrowserSignInAllowedByPolicy",
        "msDesktopRewards",
        "msEdgeOnlineAccounts",
        "msEdgeOSAccountInfoSubstrate",
        "msIdentityCore",
        "msImplicitSignin",
        "msLoadOneAuthInBackground",
        "msOneAuthWAM",
        "msPrimaryOSAccountInfoCache",
        "msSigninRewards",
        ...EDGE_MOUSE_GESTURE_NETWORK_SUPPRESSION_FEATURES,
        ...EDGE_SHOPPING_NETWORK_SUPPRESSION_FEATURES,
        "msUXConfigService",
        "msUXConfigServiceV3",
      ]) assert.equal(EDGE_DISABLED_FEATURES.includes(feature), true);
    });
    test("sealed Edge shopping launch isolation is digest-only", () => {
      const receipt = deriveEdgeLaunchIsolationPreconditionReceipt();
      assert.match(receipt.edgeDisabledFeatureSetDigest, SHA256_HEX);
      assert.match(receipt.shoppingSuppressionFeatureSetDigest, SHA256_HEX);
      assert.match(receipt.mouseGestureSuppressionFeatureSetDigest, SHA256_HEX);
      assert.equal(receipt.mouseGestureSuppressionFeatureCount, 2);
      assert.equal(
        receipt.managedPreferencesSeedDigest,
        CANDIDATE_LINEAGE_ENVELOPE.edgeManagedPreferencesSeedSha256,
      );
      assert.equal(receipt.shoppingSuppressionFeatureCount, 4);
      assert.equal(receipt.observedBeforeEdgeLaunch, true);
      assert.equal(receipt.machinePolicyRequired, false);
      for (const feature of EDGE_SHOPPING_NETWORK_SUPPRESSION_FEATURES) {
        assert.equal(stableJson(receipt).includes(feature), false);
      }
      for (const feature of EDGE_MOUSE_GESTURE_NETWORK_SUPPRESSION_FEATURES) {
        assert.equal(stableJson(receipt).includes(feature), false);
      }
    });
    test("missing Edge shopping suppression feature fails before live launch", async () => {
      await expectFailure(
        () => deriveEdgeLaunchIsolationPreconditionReceipt(
          EDGE_DISABLED_FEATURES.filter(
            (feature) => feature !== EDGE_SHOPPING_NETWORK_SUPPRESSION_FEATURES[0],
          ),
          EDGE_LAUNCH_POLICY.args,
        ),
        /EDGE_LAUNCH_ISOLATION_PRECONDITION_INVALID/u,
      );
    });
    test("missing Edge mouse gesture suppression feature fails before live launch", async () => {
      await expectFailure(
        () => deriveEdgeLaunchIsolationPreconditionReceipt(
          EDGE_DISABLED_FEATURES.filter(
            (feature) => feature !== EDGE_MOUSE_GESTURE_NETWORK_SUPPRESSION_FEATURES[0],
          ),
          EDGE_LAUNCH_POLICY.args,
        ),
        /EDGE_LAUNCH_ISOLATION_PRECONDITION_INVALID/u,
      );
    });
    test("without exact LIVE_ONCE token Playwright importer is never called", async () => {
      let imported = 0;
      await expectFailure(
        () => loadPlaywrightForLive("OFFLINE", fixture.source.digest, async () => {
          imported += 1;
          return {};
        }),
        /LIVE_ONCE_TOKEN_INVALID/u,
      );
      assert.equal(imported, 0);
    });
    test("missing precondition fails closed", async () => {
      const mutated = structuredClone(fixture.config);
      mutated.preconditions.pop();
      await expectFailure(
        () => validateLiveConfig(mutated, { allowContractPath: true }),
        /LIVE_CONFIG_INVALID/u,
      );
    }, true);
    test("artifact hash drift fails closed", async () => {
      const mutated = structuredClone(fixture.config);
      mutated.preconditions[0].sha256 = "0".repeat(64);
      await expectFailure(
        () => validateLiveConfig(mutated, { allowContractPath: true }),
        /ARTIFACT_DIGEST_MISMATCH/u,
      );
    }, true);
    test("current 51 path status count drift fails closed", async () => {
      const gitTruth = captureCurrentGitTruth();
      const finalAuthority = readFinalSourceFreezeAuthority(
        FINAL_SOURCE_FREEZE_AUTHORITY_PATH,
        { allowContractPath: true },
      );
      await expectFailure(
        () => assertCurrent51PathClosure({
          ...gitTruth,
          changedPathCount: gitTruth.changedPathCount + 1,
        }, finalAuthority),
        /SOURCE_FREEZE_STATUS_COUNT_DRIFT/u,
      );
    }, true);
    test("stale f39 identity is rejected", async () => {
      const mutated = contractRegistry([{
        ordinal: 1,
        identityDigest: "f39" + "0".repeat(61),
        status: "eligible",
        materiallyDifferent: true,
        blockedRc64Reused: false,
      }]);
      await expectFailure(
        () => validateCandidateRegistry(mutated),
        /CURRENT_CANDIDATE_NOT_REGISTERED_EXACTLY_ONCE/u,
      );
    }, true);
    test("blocked RC6.4 candidate identity is rejected", async () => {
      const mutated = contractRegistry([{
        ordinal: 1,
        identityDigest: BLOCKED_RC64_IDENTITIES[0],
        status: "eligible",
        materiallyDifferent: true,
        blockedRc64Reused: false,
      }]);
      await expectFailure(
        () => validateCandidateRegistry(mutated),
        /CANDIDATE_REGISTRY_ENTRY_INVALID/u,
      );
    }, true);
    test("candidate registry above max two is rejected", async () => {
      const mutated = contractRegistry([
        {
          ordinal: 1,
          identityDigest: CANDIDATE_IDENTITY,
          status: "eligible",
          materiallyDifferent: true,
          blockedRc64Reused: false,
        },
        {
          ordinal: 2,
          identityDigest: "1".repeat(64),
          status: "eligible",
          materiallyDifferent: true,
          blockedRc64Reused: false,
        },
        {
          ordinal: 2,
          identityDigest: "2".repeat(64),
          status: "eligible",
          materiallyDifferent: true,
          blockedRc64Reused: false,
        },
      ]);
      await expectFailure(
        () => validateCandidateRegistry(mutated),
        /CANDIDATE_REGISTRY_INVALID/u,
      );
    }, true);
    test("RC6.4 Formal namespace reuse is rejected", async () => {
      await expectFailure(
        () => assertNotRc64Formal({
          schemaVersion: "p2.4b-rc6.4-formal-browser-gate-v1",
        }),
        /RC6_4_FORMAL_CONTROL_REUSE_FORBIDDEN/u,
      );
    }, true);
    test("recursive raw content key is rejected", async () => {
      await expectFailure(
        () => assertNoForbiddenEvidence({
          safe: {
            nested: [{
              content: "forbidden",
            }],
          },
        }),
        /RAW_EVIDENCE_KEY_FORBIDDEN/u,
      );
    }, true);
    test("synthetic observed receipt is rejected", async () => {
      const row = contractObservation({
        fixtureId: DEVELOPMENT_FIXTURES[0],
        partition: "development",
        executionMode: "cold",
      });
      row.syntheticObservedReceipt = true;
      await expectFailure(
        () => assertObservation(row, {
          fixtureId: DEVELOPMENT_FIXTURES[0],
          partition: "development",
          executionMode: "cold",
          cancelledSegment: null,
        }),
        /QUALIFICATION_OBSERVATION_REJECTED/u,
      );
    }, true);
    test("qualification cannot claim Production PASS", async () => {
      const row = contractObservation({
        fixtureId: DEVELOPMENT_FIXTURES[0],
        partition: "development",
        executionMode: "cold",
      });
      row.productionPassClaimed = true;
      await expectFailure(
        () => assertObservation(row, {
          fixtureId: DEVELOPMENT_FIXTURES[0],
          partition: "development",
          executionMode: "cold",
          cancelledSegment: null,
        }),
        /QUALIFICATION_OBSERVATION_REJECTED/u,
      );
    }, true);
    test("wrong development count is rejected", async () => {
      const state = createState(1);
      const digest = sha256("contract-authority");
      transitionState(state, "PREFLIGHT_PASS", {
        bridgeDigest: digest,
        candidateRegistryDigest: digest,
        liveIdentityClaimed: true,
        preconditionSetDigest: digest,
        sourceSetDigest: digest,
      });
      await expectFailure(
        () => transitionState(state, "DEVELOPMENT_COMPLETE", {
          metrics: contractPhase(
            DEVELOPMENT_FIXTURES.slice(0, 4),
            "development",
            "cold",
          ),
          tuningFreezeReceipt: contractTuningFreezeReceipt(),
        }),
        /QUALIFICATION_PHASE_COUNT_INVALID/u,
      );
    }, true);
    test("holdout tuning mutation is rejected", async () => {
      const state = createState(1);
      const digest = sha256("contract-authority");
      transitionState(state, "PREFLIGHT_PASS", {
        bridgeDigest: digest,
        candidateRegistryDigest: digest,
        liveIdentityClaimed: true,
        preconditionSetDigest: digest,
        sourceSetDigest: digest,
      });
      transitionState(state, "DEVELOPMENT_COMPLETE", {
        metrics: contractPhase(DEVELOPMENT_FIXTURES, "development", "cold"),
        tuningFreezeReceipt: contractTuningFreezeReceipt(),
      });
      await expectFailure(
        () => transitionState(state, "HOLDOUT_COMPLETE", {
          metrics: contractPhase(HOLDOUT_FIXTURES, "holdout", "cold"),
          tuningFreezeDigest:
            sha256(canonicalBytes(contractTuningFreezeReceipt())),
          tuningMutationCount: 1,
        }),
        /HOLDOUT_TUNING_BOUNDARY_BROKEN/u,
      );
    }, true);
    test("adapter runtime policy drift is rejected", async () => {
      const validated = validateLiveConfig(fixture.config, {
        allowContractPath: true,
      });
      const mutated = structuredClone(fixture.adapterDescription);
      mutated.runtimePolicyDigest = "0".repeat(64);
      await expectFailure(
        () => validateAdapterDescription(
          mutated,
          adapterExpectationFromValidated(validated),
        ),
        /ADAPTER_DESCRIPTION_INVALID/u,
      );
    }, true);
    test("post development source or adapter drift blocks Holdout", async () => {
      const before = captureObservedTuningBoundarySnapshot(
        fixture.config,
        fixture.adapterDescription,
        { allowContractPath: true },
      );
      const after = {
        ...before,
        adapterDescriptionDigest: "0".repeat(64),
      };
      await expectFailure(
        () => createObservedTuningFreezeReceipt(before, after),
        /POST_DEVELOPMENT_TUNING_FREEZE_DRIFT/u,
      );
    }, true);
    test("cancel-retry partial persistence is rejected", async () => {
      const row = contractObservation({
        fixtureId: HOLDOUT_FIXTURES[0],
        partition: "holdout",
        executionMode: "cancel-retry",
        cancelledSegment: "action",
      });
      row.cancelledPartialPersisted = true;
      await expectFailure(
        () => assertObservation(row, {
          fixtureId: HOLDOUT_FIXTURES[0],
          partition: "holdout",
          executionMode: "cancel-retry",
          cancelledSegment: "action",
        }),
        /QUALIFICATION_OBSERVATION_REJECTED/u,
      );
    }, true);
    test("cancel-retry reused cancelled output is rejected", async () => {
      const row = contractObservation({
        fixtureId: HOLDOUT_FIXTURES[0],
        partition: "holdout",
        executionMode: "cancel-retry",
        cancelledSegment: "action",
      });
      row.retryReusedCancelledOutput = true;
      await expectFailure(
        () => assertObservation(row, {
          fixtureId: HOLDOUT_FIXTURES[0],
          partition: "holdout",
          executionMode: "cancel-retry",
          cancelledSegment: "action",
        }),
        /QUALIFICATION_OBSERVATION_REJECTED/u,
      );
    }, true);
    test("cancel-retry wrong segment matrix is rejected", async () => {
      const rows = contractPhase(
        HOLDOUT_FIXTURES.slice(0, 3),
        "holdout",
        "cancel-retry",
        ["action", "reaction", "reaction"],
      );
      await expectFailure(
        () => assertExactFixtureSet(
          rows,
          HOLDOUT_FIXTURES.slice(0, 3),
          "holdout",
          "cancel-retry",
          SEGMENTS,
        ),
        /CANCEL_RETRY_SEMANTICS_INVALID/u,
      );
    }, true);
    test("cleanup residue is rejected", async () => {
      await expectFailure(
        () => validateCleanup({
          edgeResidueCount: 1,
          mutexResidueCount: 0,
          networkObserverDisposed: true,
          profileDisposed: true,
          profileResidueCount: 0,
          runnerOwnedResourcesReleased: false,
          workerResidueCount: 1,
        }),
        /QUALIFICATION_CLEANUP_INCOMPLETE/u,
      );
    }, true);
    test("exact Edge PID residue is independently rejected", async () => {
      await expectFailure(
        () => validateCleanup({
          edgeResidueCount: 1,
          mutexResidueCount: 0,
          networkObserverDisposed: true,
          profileDisposed: true,
          profileResidueCount: 0,
          runnerOwnedResourcesReleased: false,
          workerResidueCount: 0,
        }),
        /QUALIFICATION_CLEANUP_INCOMPLETE/u,
      );
    }, true);
    test("late exact Edge child is residue while a different executable is not", async () => {
      const baseline = createEdgeBaselineReceipt([]);
      assert.equal(baseline.processCount, 0);
      const launchReceipt = {
        exactExecutableBound: true,
        ownedPids: [100],
      };
      const observation = deriveExactEdgeProcessResidueObservation([
        {
          pid: 200,
          parentPid: 100,
          executablePath: AUTHORITY.dEdgeExecutable,
          commandLine: "--type=renderer",
          commandLineDigest: sha256("late-exact-edge-child"),
        },
        {
          pid: 300,
          parentPid: 1,
          executablePath: "D:\\unrelated\\msedge.exe",
          commandLine: "--type=renderer",
          commandLineDigest: sha256("different-edge-executable"),
        },
      ], AUTHORITY.dEdgeExecutable, launchReceipt);
      assert.equal(observation.edgeResidueCount, 1);
      assert.equal(observation.residueProcesses[0].pid, 200);
      await expectFailure(
        () => validateCleanup({
          edgeResidueCount: observation.edgeResidueCount,
          mutexResidueCount: 0,
          networkObserverDisposed: true,
          profileDisposed: true,
          profileResidueCount: 0,
          runnerOwnedResourcesReleased: false,
          workerResidueCount: 0,
        }),
        /QUALIFICATION_CLEANUP_INCOMPLETE/u,
      );
    }, true);
    test("WebWorker residue is independently rejected", async () => {
      await expectFailure(
        () => validateCleanup({
          edgeResidueCount: 0,
          mutexResidueCount: 0,
          networkObserverDisposed: true,
          profileDisposed: true,
          profileResidueCount: 0,
          runnerOwnedResourcesReleased: false,
          workerResidueCount: 1,
        }),
        /QUALIFICATION_CLEANUP_INCOMPLETE/u,
      );
    }, true);
    test("missing sealed network observer is rejected", async () => {
      const parsed = parseNetworkPolicy(fixture.config.networkPolicy);
      const input = contractNetworkObservationInput(
        parsed,
        fixture.config.adapter.pageUrl,
      );
      await expectFailure(
        () => deriveNetworkObservationReceipt({
          ...input,
          observerSnapshot: null,
        }),
        /NETWORK_OBSERVER_MISSING/u,
      );
    }, true);
    test("proxy bypass configuration is rejected", async () => {
      const parsed = parseNetworkPolicy(fixture.config.networkPolicy);
      const input = contractNetworkObservationInput(
        parsed,
        fixture.config.adapter.pageUrl,
      );
      await expectFailure(
        () => deriveNetworkObservationReceipt({
          ...input,
          proxyBypassConfigured: true,
        }),
        /NETWORK_OBSERVATION_INCOMPLETE/u,
      );
    }, true);
    test("proxy denied request prevents network completeness", async () => {
      const parsed = parseNetworkPolicy(fixture.config.networkPolicy);
      const input = contractNetworkObservationInput(
        parsed,
        fixture.config.adapter.pageUrl,
      );
      const observerSnapshot = {
        ...input.observerSnapshot,
        requestCount: 2,
        deniedRequestCount: 1,
        externalRequestCount: 1,
        requestDigests: [
          ...input.observerSnapshot.requestDigests,
          sha256("contract-denied-request"),
        ],
      };
      await expectFailure(
        () => deriveNetworkObservationReceipt({ ...input, observerSnapshot }),
        /NETWORK_OBSERVATION_INCOMPLETE/u,
      );
    }, true);
    test("service worker allow mutation is rejected", async () => {
      const parsed = parseNetworkPolicy(fixture.config.networkPolicy);
      const input = contractNetworkObservationInput(
        parsed,
        fixture.config.adapter.pageUrl,
      );
      await expectFailure(
        () => deriveNetworkObservationReceipt({
          ...input,
          serviceWorkers: "allow",
        }),
        /NETWORK_OBSERVATION_INCOMPLETE/u,
      );
    }, true);
    test("external measurement origin is rejected in policy", async () => {
      await expectFailure(
        () => parseNetworkPolicy({
          schemaVersion: NETWORK_POLICY_SCHEMA,
          setupOrigins: ["http://example.invalid"],
          measurementOrigins: ["http://example.invalid"],
          allowedPathPrefixes: ["/qualification"],
          modelSetupDownloadAllowed: false,
          proxyMode: "sealed-loopback-http-connect-deny-v1",
        }),
        /MEASUREMENT_EXTERNAL_ORIGIN_FORBIDDEN/u,
      );
    }, true);
    test("unallowlisted network request is digest-only and blocked", () => {
      const parsed = parseNetworkPolicy(fixture.config.networkPolicy);
      const row = classifyNetworkRequest(
        "http://example.invalid/private?secret=never-store",
        "setup",
        parsed,
      );
      assert.equal(row.blocked, true);
      assert.equal(row.external, true);
      assert.equal(stableJson(row).includes("example.invalid"), false);
      assert.equal(stableJson(row).includes("secret"), false);
    }, true);
    test("exclusive started marker rejects replay and double start", async () => {
      const root = path.win32.join(contractRoot, "replay-control");
      mkdirSync(root);
      createStartedMarker(root, 1, "contract-replay-01", { scope: "contract" });
      await expectFailure(
        () => createStartedMarker(root, 1, "contract-replay-02", {
          scope: "contract",
        }),
        /CANDIDATE_LEDGER_CHILD_PREEXISTING/u,
      );
    }, true);
    test("deleted started marker is rejected before seal", async () => {
      const root = path.win32.join(contractRoot, "deleted-marker-control");
      mkdirSync(root);
      const marker = createStartedMarker(root, 1, "contract-deleted-marker", {
        scope: "contract",
      });
      unlinkSync(marker.path);
      await expectFailure(
        () => verifyStartedMarkerRetained(marker),
        /STARTED_MARKER_RETAINED_READ_FAILED/u,
      );
    }, true);
    test("reparse candidate ledger child is rejected", async () => {
      const root = path.win32.join(contractRoot, "reparse-ledger-control");
      const ledger = path.win32.join(root, "contract-ledger");
      const target = path.win32.join(root, "reparse-target");
      mkdirSync(ledger, { recursive: true });
      mkdirSync(target);
      symlinkSync(target, path.win32.join(ledger, CANDIDATE_IDENTITY), "junction");
      await expectFailure(
        () => createStartedMarker(root, 1, "contract-reparse-child", {
          scope: "contract",
        }),
        /CANDIDATE_LEDGER_CHILD_REPARSE/u,
      );
    }, true);
    test("named mutex rejects concurrent double acquisition", async () => {
      const root = path.win32.join(contractRoot, "mutex-control");
      mkdirSync(root);
      const first = await acquireNamedMutex(root, "contract-mutex-01", {
        scope: "contract",
      });
      try {
        await expectFailure(
          () => acquireNamedMutex(root, "contract-mutex-02", {
            scope: "contract",
          }),
          /QUALIFICATION_(?:WINDOWS|NAMED)_MUTEX_ALREADY_HELD/u,
        );
      } finally {
        await first.release();
      }
    }, true);
    test("fixture replay within a phase is rejected", async () => {
      const rows = contractPhase(DEVELOPMENT_FIXTURES, "development", "cold");
      rows[4].fixtureId = rows[0].fixtureId;
      await expectFailure(
        () => assertExactFixtureSet(
          rows,
          DEVELOPMENT_FIXTURES,
          "development",
          "cold",
          null,
        ),
        /QUALIFICATION_OBSERVATION_REJECTED|QUALIFICATION_FIXTURE_REPLAY/u,
      );
    }, true);
    test("C path is rejected by D physical path guard", async () => {
      await expectFailure(
        () => assertDPath("C:\\Users\\user\\AppData\\Local", {
          code: "TEST_D_PATH",
          mustExist: false,
        }),
        /TEST_D_PATH/u,
      );
    }, true);

    let passed = 0;
    for (const row of tests) {
      await row.fn();
      passed += 1;
      if (row.mutation) mutationCount += 1;
      console.log("PASS " + row.name);
    }
    assert.equal(existsSync(fixture.neverRoot), false);
    const report = {
      schemaVersion:
        "p2.4b-rc6.5-browser-prose-qualification-edge-offline-contract-result-v1",
      status: "PASS",
      candidateIdentityDigest: CANDIDATE_IDENTITY,
      contractCount: passed,
      mutationCount,
      stateMachine: "Dev5-Holdout5-Warm5-CancelRetry3",
      candidateLimit: 2,
      freshCandidateLineage: true,
      edgeExecuted: false,
      modelExecuted: false,
      serverStarted: false,
      buildExecuted: false,
      networkExecuted: false,
      playwrightImported: false,
      liveLedgerCreated: false,
      liveEvidenceCreated: false,
      liveProfileCreated: false,
      formalAttemptCreated: false,
      lunaExecuted: false,
      syntheticObservedReceipt: false,
      productionPassClaimed: false,
      rawEvidenceStored: false,
      contractTemporaryRootDisposed: true,
    };
    assertNoForbiddenEvidence(report);
    return report;
  } finally {
    if (existsSync(contractRoot)) {
      const expectedPrefix = normalizeForIdentity(contractParent) + "\\"
        + "rc65-qualification-offline-contract-";
      if (!normalizeForIdentity(contractRoot).startsWith(expectedPrefix)) {
        fail("CONTRACT_TEMP_CLEANUP_PATH_INVALID");
      }
      rmSync(contractRoot, { recursive: true, force: true });
    }
  }
}

async function main() {
  const liveValue = process.env[LIVE_ENV];
  if (liveValue === undefined || liveValue === "") {
    const report = await runOfflineContract();
    console.log(stableJson(report));
    return;
  }
  const configPath = process.env[LIVE_CONFIG_ENV];
  if (!configPath) fail("LIVE_CONFIG_PATH_REQUIRED");
  const result = await runLiveOnce(configPath, liveValue);
  console.log(stableJson({
    schemaVersion: "p2.4b-rc6.5-browser-prose-qualification-live-result-v1",
    mode: result.mode,
    candidateIdentityDigest: CANDIDATE_IDENTITY,
    evidenceDigest: result.evidence.digest,
    candidateQualificationPass: result.candidateQualificationPass,
    productionPassClaimed: false,
  }));
}

await main();

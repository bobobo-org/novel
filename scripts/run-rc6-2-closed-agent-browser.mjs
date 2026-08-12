import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  constants as fsConstants,
  link,
  lstat,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyClosedAiCrossOriginRequest,
  isPreviewToolbarRequest,
} from "./rc6-2-closed-agent-network-policy.mjs";
import {
  commitBrowserStartedOrClose,
  transitionAttempt,
  waitForAttemptState,
} from "./rc6-2-formal-attempt-state.mjs";

Error.stackTraceLimit = 0;

const mode = process.argv[2] ?? "generation";
const networkSentinelOnly = mode === "network-sentinel-only";
if (!new Set(["setup", "generation", "all", "network-sentinel-only"]).has(mode)) {
  throw new Error("RC6_2_CLOSED_AI_UNKNOWN_MODE");
}

const configuredOrigin = networkSentinelOnly
  ? "https://network-sentinel.invalid"
  : process.env.RC6_2_CLOSED_AI_BASE_URL?.trim();
if (!configuredOrigin) {
  throw new Error("RC6_2_CLOSED_AI_BASE_URL_REQUIRED");
}
let parsedOrigin;
try {
  parsedOrigin = new URL(configuredOrigin);
} catch {
  throw new Error("RC6_2_CLOSED_AI_BASE_URL_INVALID");
}
const expectedOrigin = parsedOrigin.origin;
if (
  parsedOrigin.protocol !== "https:"
  && process.env.RC6_2_CLOSED_AI_ALLOW_HTTP_LOCAL !== "1"
) {
  throw new Error("RC6_2_CLOSED_AI_EXACT_HTTPS_ORIGIN_REQUIRED");
}

const expectedCommit = networkSentinelOnly
  ? "0".repeat(40)
  : process.env.EXPECTED_COMMIT?.trim();
if (!expectedCommit || !/^[a-f0-9]{40}$/u.test(expectedCommit)) {
  throw new Error("EXPECTED_COMMIT_REQUIRED");
}
const expectedDeploymentId = networkSentinelOnly
  ? "network-sentinel-only"
  : process.env.EXPECTED_DEPLOYMENT_ID?.trim();
if (!expectedDeploymentId) {
  throw new Error("EXPECTED_DEPLOYMENT_ID_REQUIRED");
}
const configuredEdgeExecutable = process.env.RC6_2_CLOSED_AI_EDGE_EXECUTABLE?.trim()
  || (networkSentinelOnly && process.platform === "win32"
    ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    : "");
if (!configuredEdgeExecutable) {
  throw new Error("RC6_2_CLOSED_AI_EDGE_EXECUTABLE_REQUIRED");
}

const setupTimeoutMs = Number(process.env.RC6_2_CLOSED_AI_SETUP_TIMEOUT_MS ?? 1_800_000);
const generationTimeoutMs = Number(process.env.RC6_2_CLOSED_AI_GENERATION_TIMEOUT_MS ?? 1_200_000);
const headless = process.env.RC6_2_CLOSED_AI_HEADLESS !== "0";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const formalAttemptDirectory = process.env.RC6_2_FORMAL_ATTEMPT_DIRECTORY?.trim() ?? "";
const formalAttemptId = process.env.RC6_2_FORMAL_ATTEMPT_ID?.trim() ?? "";
const formalAuthorizationId = process.env.RC6_2_FORMAL_AUTHORIZATION_ID?.trim() ?? "";
const formalControlCommit = process.env.RC6_2_FORMAL_CONTROL_COMMIT?.trim() ?? "";
const formalAuthorizationDigest = process.env.RC6_2_FORMAL_AUTHORIZATION_DIGEST?.trim() ?? "";
const formalReleaseTag = process.env.RC6_2_FORMAL_RELEASE_TAG?.trim() ?? "";
const formalReleaseRevision = process.env.RC6_2_FORMAL_RELEASE_REVISION?.trim() ?? "";
const formalRuntimeReceiptDigest = process.env.RC6_2_FORMAL_RUNTIME_RECEIPT_DIGEST?.trim() ?? "";
const formalWrapperDigest = process.env.RC6_2_FORMAL_WRAPPER_DIGEST?.trim() ?? "";
const formalRunnerDigest = process.env.RC6_2_FORMAL_RUNNER_DIGEST?.trim() ?? "";
const formalContractDigest = process.env.RC6_2_FORMAL_CONTRACT_DIGEST?.trim() ?? "";
const formalRunnerEnvelopePath = process.env.RC6_2_FORMAL_RUNNER_ENVELOPE_PATH?.trim() ?? "";
const formalRunnerEnvelopeShaPath = process.env.RC6_2_FORMAL_RUNNER_ENVELOPE_SHA_PATH?.trim() ?? "";
const formalAttemptValues = [
  formalAttemptDirectory,
  formalAttemptId,
  formalAuthorizationId,
  formalControlCommit,
  formalAuthorizationDigest,
  formalReleaseTag,
  formalReleaseRevision,
  formalRuntimeReceiptDigest,
  formalWrapperDigest,
  formalRunnerDigest,
  formalContractDigest,
  formalRunnerEnvelopePath,
  formalRunnerEnvelopeShaPath,
];
const formalAttemptEnabled = formalAttemptValues.some(Boolean);
if (networkSentinelOnly) {
  assert.equal(formalAttemptEnabled, false, "sentinel-only mode forbids formal attempt state");
}
if (formalAttemptEnabled) {
  assert.equal(formalAttemptValues.every(Boolean), true, "formal attempt configuration incomplete");
  assert.equal(isAbsolute(formalAttemptDirectory), true, "formal attempt directory was not absolute");
  assert.match(formalAttemptId, /^C7-PROD-BROWSER-\d{8}T\d{9}Z-[a-f0-9]{32}$/u);
  assert.match(formalAuthorizationId, /^C7-PROD-BROWSER-AUTH-\d{8}T\d{9}Z-[a-f0-9]{32}$/u);
  assert.match(formalControlCommit, /^[a-f0-9]{40}$/u);
  assert.equal(formalReleaseTag, "novel-ai-p24b-conversation-first-studio-rc6.2");
  assert.equal(formalReleaseRevision, "rc6.2");
  for (const digest of [
    formalAuthorizationDigest,
    formalRuntimeReceiptDigest,
    formalWrapperDigest,
    formalRunnerDigest,
    formalContractDigest,
  ]) assert.match(digest, /^[a-f0-9]{64}$/u);
  assert.equal(resolve(formalRunnerEnvelopePath), formalRunnerEnvelopePath);
  assert.equal(resolve(formalRunnerEnvelopeShaPath), formalRunnerEnvelopeShaPath);
  assert.equal(dirname(formalRunnerEnvelopePath), formalAttemptDirectory);
  assert.equal(dirname(formalRunnerEnvelopeShaPath), formalAttemptDirectory);
  assert.equal(basename(formalRunnerEnvelopePath), "runner-terminal-envelope.json");
  assert.equal(basename(formalRunnerEnvelopeShaPath), "runner-terminal-envelope.sha256");
}
const immutableModelRootRequests = [];
const approvedModelRedirectRequests = [];
const prohibitedExternalAiRequests = [];
const disallowedCrossOriginRequests = [];
const disallowedSameOriginTargetRequests = [];
const disallowedImmutableModelTargetRequests = [];
const disallowedMethodRequests = [];
const blockedNetworkPolicyAttempts = [];
const blockedNonToolbarRequests = new WeakSet();
const blockedNonToolbarResponses = [];
const disallowedWebSocketAttempts = [];
const blockedPreviewToolbarWebSocketAttempts = [];
const observedPreviewToolbarRequests = [];
const blockedPreviewToolbarRequests = new Set();
const previewToolbarResponses = [];
const sensitiveEvidenceSentinels = new Set();
const finalContextFragmentVariants = new Map();
let requestPhase = "bootstrap";
let gateCheckpoint = "bootstrap";
let browser;
let context;
let page;
let formalRunnerStartedLease = null;
let profilePath;
let profileOwnership = null;
let profilePathDigest = null;
let edgeExecutablePath;
let edgeCdpSession;
let contextRouteInstalledBeforeNavigation = false;
let contextWebSocketRouteInstalledBeforeNavigation = false;
let authoritativeFailureEvidence = null;
let finalOutput = null;
let freshStorageAtFailure = null;
let latestRegenerationAttemptEvidence = null;
let networkSentinelEvidence = null;
let prohibitedExternalAiRequestCount = 0;
let disallowedCrossOriginRequestCount = 0;
let disallowedSameOriginTargetRequestCount = 0;
let disallowedImmutableModelTargetRequestCount = 0;
let disallowedMethodRequestCount = 0;
let blockedNetworkPolicyAttemptCount = 0;
let blockedNonToolbarResponseCount = 0;
let previewToolbarResponseCount = 0;
let observedWebSocketAttemptCount = 0;
let blockedWebSocketAttemptCount = 0;
let disallowedWebSocketAttemptCount = 0;
let webSocketServerConnectionCount = 0;
let observedPreviewToolbarWebSocketAttemptCount = 0;
let blockedPreviewToolbarWebSocketAttemptCount = 0;
let sentinelBootstrapActive = false;
let sentinelBootstrapUrl = null;
let sentinelBootstrapConsumed = false;
let sentinelBootstrapAllowedCount = 0;
let sentinelProbeState = null;
const pendingSentinelRouteActions = new Set();

const RUNNER_TERMINAL_ENVELOPE_SCHEMA_VERSION =
  "p24b-rc6.2-formal-runner-terminal-envelope-v2";
const RUNNER_ENVELOPE_MAX_CHECKPOINTS = 32;
const RUNNER_ENVELOPE_MAX_BYTES = 131_072;
const RUNNER_ENVELOPE_FAILURE_SHAPES = new Set([
  "ASSERTION",
  "GATE_ERROR",
  "PLAYWRIGHT_ERROR",
  "TIMEOUT",
  "PROCESS_ERROR",
  "NETWORK_POLICY_REJECTION",
  "EVIDENCE_VALIDATION_ERROR",
  "UNKNOWN_SAFE",
]);
const RUNNER_ENVELOPE_DISPOSITIONS = new Set([
  "true",
  "false",
  "null",
  "missing",
  "present",
  "zero",
  "nonzero",
  "equal",
  "different",
  "ready",
  "not_ready",
  "indexeddb",
  "memory",
  "browser_ai",
  "other_executor",
  "valid_digest",
  "invalid_digest",
]);
const RUNNER_ENVELOPE_ASSERTION_IDS = new Set([
  "EDGE_CONTEXT_SINGLE_PAGE",
  "EDGE_INITIAL_PAGE_ABOUT_BLANK",
  "NETWORK_SENTINEL_ZERO_EGRESS",
  "NETWORK_SENTINEL_BOOTSTRAP_EXACTLY_ONCE",
  "NETWORK_SENTINEL_BOOTSTRAP_DISABLED",
  "NETWORK_SENTINEL_HTTP_ROUTE_OBSERVED",
  "NETWORK_SENTINEL_HTTP_ROUTE_BLOCKED",
  "NETWORK_SENTINEL_POST_METHOD_REJECTED",
  "NETWORK_SENTINEL_POST_BODY_REJECTED",
  "NETWORK_SENTINEL_WEBSOCKET_ROUTE_OBSERVED",
  "NETWORK_SENTINEL_WEBSOCKET_ROUTE_BLOCKED",
  "NETWORK_SENTINEL_RECEIVER_TCP_DELTA_ZERO",
  "NETWORK_SENTINEL_RECEIVER_HTTP_DELTA_ZERO",
  "NETWORK_SENTINEL_RECEIVER_BODY_DELTA_ZERO",
  "NETWORK_SENTINEL_RECEIVER_WEBSOCKET_DELTA_ZERO",
  "NETWORK_SENTINEL_RETURNED_TO_ABOUT_BLANK",
  "NETWORK_SENTINEL_CONTEXT_SINGLE_PAGE",
  "NETWORK_SENTINEL_SERVICE_WORKERS_ZERO",
  "NETWORK_SENTINEL_OPERATION_COMPLETED",
  "NETWORK_SENTINEL_COUNTERS_RESET",
  "RELEASE_IDENTITY_EXACT",
  "FRESH_STORAGE_EMPTY",
  "PROJECT_CREATED",
  "STORY_BIBLE_CREATED",
  "BROWSER_AI_SETUP_READY",
  "MODEL_CACHE_VERIFIED",
  "MODEL_SHARDS_VERIFIED",
  "ATTACHMENT_RIGHTS_NEGATIVE_BLOCKED",
  "ATTACHMENT_RIGHTS_POSITIVE_ACCEPTED",
  "T1_CONTEXT_BOUND",
  "FIRST_CANDIDATE_CREATED",
  "DIRECT_REGENERATION_CREATED",
  "REJECT_CANON_UNCHANGED",
  "CACHE_REUSED_AFTER_RELOAD",
  "CHAINED_REGENERATION_CREATED",
  "APPROVAL_REVISION_INCREMENTED_ONCE",
  "FINAL_RELOAD_PERSISTED",
  "PROFILE_DISPOSED",
]);
const RUNNER_ENVELOPE_KEYS = Object.freeze([
  "schemaVersion", "status", "attemptId", "authorizationId", "authorizationDigest",
  "productCommit", "controlCommit", "deploymentId", "productionOrigin", "releaseTag",
  "releaseRevision", "runtimeReceiptDigest", "wrapperDigest", "runnerDigest",
  "contractDigest", "mode", "exitCode", "startedAt", "completedAt", "requestPhase",
  "gateCheckpoint", "lastCompletedCheckpoint", "checkpointOrdinal", "checkpointTrail",
  "failureShape", "safeErrorCode", "firstFailedOperation", "firstFailedAssertion",
  "projectionValidation", "freshBrowserContext", "profileOwnership", "profilePathDigest",
  "profileDisposed", "networkSummary", "modelSummary", "uiSummary", "persistenceReached",
  "storyBibleReached", "candidateReached", "externalRequestCount", "dataLeftDevice",
  "envelopeDigest",
]);
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
const NETWORK_SENTINEL_PROBE_SPECS = Object.freeze([
  Object.freeze({
    probeId: "HTTP_GET",
    method: "GET",
    reasonCodes: Object.freeze(["network-classification-blocked"]),
  }),
  Object.freeze({
    probeId: "HTTP_POST",
    method: "POST",
    reasonCodes: Object.freeze([
      "method-not-allowed",
      "network-classification-blocked",
      "request-body-not-allowed",
    ]),
  }),
  Object.freeze({
    probeId: "WEBSOCKET",
    method: null,
    reasonCodes: Object.freeze(["network-classification-blocked"]),
  }),
]);
const NETWORK_SENTINEL_HEADER_NAME = "x-network-sentinel";
const NETWORK_SENTINEL_HEADER_VALUE = "finite";
const NETWORK_SENTINEL_BODY_VALUE = "finite-network-sentinel-body";
const NETWORK_SENTINEL_WEBSOCKET_PROTOCOL = "network-sentinel-v2";
const NETWORK_SENTINEL_BOOTSTRAP_PREFIX = "/network-sentinel-bootstrap/";
const NETWORK_SENTINEL_NONCE = /^[a-f0-9]{32}$/u;
const NETWORK_SENTINEL_CREDENTIAL_HEADERS = new Set([
  "authorization", "cookie", "cookie2", "proxy-authorization",
]);
const runnerEnvelopeStartedAt = new Date().toISOString();
const runnerCheckpointTrail = [];
let runnerCheckpointOrdinal = 0;
let runnerLastCompletedCheckpoint = "none";
let runnerFirstFailedOperation = null;
let runnerFirstFailedAssertion = null;
let runnerCaughtError = null;
let runnerCleanupFailed = false;
let runnerPersistenceReached = false;
let runnerStoryBibleReached = false;
let runnerCandidateReached = false;
let chromiumRuntime = null;

function setRunnerCheckpoint(checkpoint) {
  enterRunnerCheckpoint(checkpoint);
}

const FAILURE_EVIDENCE_SCHEMA_VERSION = "closed-agent-failure-evidence-v1";
const MAX_SAFE_NETWORK_PROJECTIONS = 32;
const ALLOWED_REQUEST_METHODS = new Set(["GET", "HEAD"]);
const LOCAL_NON_NETWORK_PROTOCOLS = new Set(["about:", "blob:", "data:"]);
const ALLOWED_REQUEST_CLASSIFICATIONS = new Set([
  "local-scheme",
  "same-origin",
  "immutable-model-root",
  "immutable-model-redirect",
]);
const SAFE_REQUEST_PHASES = new Set([
  "bootstrap",
  "release-identity",
  "project-setup",
  "model-install",
  "inference",
]);
const PRODUCT_STATIC_ASSET_MANIFEST_COMMIT = "29fc6e742672bb07187765d34ea818afdadf56ae";
// Finite transitive chunk graph read from the immutable Product P deployment
// for every gate page and every Product navigation target those pages prefetch.
const PRODUCT_STATIC_ASSET_PATHS = new Set([
  "/_next/static/chunks/04k3pu8w7soaf.js",
  "/_next/static/chunks/06lrtlswxyb7h.js",
  "/_next/static/chunks/0cz1d0mv5g_q7.js",
  "/_next/static/chunks/0hli89lc-7oh2.js",
  "/_next/static/chunks/0qe-a8rxi0abp.js",
  "/_next/static/chunks/0r-zdhpwzzodc.js",
  "/_next/static/chunks/0tkmteu-xy88h.js",
  "/_next/static/chunks/0w5bo491hxqji.js",
  "/_next/static/chunks/0x-_9txpd6bfe.js",
  "/_next/static/chunks/0x15n8m5rd7gp.js",
  "/_next/static/chunks/0y_w1l3nhq2ct.js",
  "/_next/static/chunks/10agmf7i5hysj.js",
  "/_next/static/chunks/15vym6j-e8z2l.js",
  "/_next/static/chunks/17h5qma-zvwv7.js",
  "/_next/static/chunks/185sv7ya_94jb.js",
  "/_next/static/chunks/1ce_-atwphf5i.css",
  "/_next/static/chunks/1wqeeq-uw-v7e.js",
  "/_next/static/chunks/1x8p4lk40jco1.js",
  "/_next/static/chunks/20gd2-yosfmhk.js",
  "/_next/static/chunks/20ldyvjz1jby_.js",
  "/_next/static/chunks/239wwvgnaka7_.js",
  "/_next/static/chunks/2pdk9pk490qc9.js",
  "/_next/static/chunks/2pentl2oxnk9m.js",
  "/_next/static/chunks/2qsuxvnf-bktb.js",
  "/_next/static/chunks/2-tqhs_6aaxbk.js",
  "/_next/static/chunks/2vn5m7jgu08x7.js",
  "/_next/static/chunks/2xn0hhu_lqe01.js",
  "/_next/static/chunks/37n5b-5spzr23.js",
  "/_next/static/chunks/3cyzxlz23sbvh.js",
  "/_next/static/chunks/3dq3l9zveiqxv.js",
  "/_next/static/chunks/3eupiqb2yy4q6.js",
  "/_next/static/chunks/3mmkb0_c4i5fa.js",
  "/_next/static/chunks/3oqxxk5jlt610.js",
  "/_next/static/chunks/3tmj40j4-74yb.js",
  "/_next/static/chunks/3u8sh4kpwg9bg.js",
  "/_next/static/chunks/3vk9bbaj5f466.css",
  "/_next/static/chunks/3zh5sw6bqdcgn.js",
  "/_next/static/chunks/turbopack-0-fbl8kb234_a.js",
  "/_next/static/chunks/turbopack-30pawe7lbg0xj.js",
  "/_next/static/chunks/turbopack-3c7jzpqyr9r89.js",
  "/_next/static/chunks/turbopack-worker-2gqdcwp7k90ea.js",
  "/_next/static/chunks/09r4ognl-vvsl.js",
  "/_next/static/chunks/0fh43nmoyrvtk.css",
  "/_next/static/chunks/0l4ev7zuuqu88.js",
  "/_next/static/chunks/0m1ol8-pez3ux.js",
  "/_next/static/chunks/0t9tt3v-0br_y.js",
  "/_next/static/chunks/0vyon6_dzo6fy.js",
  "/_next/static/chunks/0zwwwcb2eboyt.js",
  "/_next/static/chunks/11-qjqpuyj7q1.js",
  "/_next/static/chunks/140dp12w-djg1.js",
  "/_next/static/chunks/175u68op286at.js",
  "/_next/static/chunks/187fe-em8097q.js",
  "/_next/static/chunks/19bknx75lki7t.js",
  "/_next/static/chunks/1jg_3i3xtmdlm.js",
  "/_next/static/chunks/1koj4z42ibe00.css",
  "/_next/static/chunks/1rznc28pdimkz.js",
  "/_next/static/chunks/1s19bwjs47f3v.js",
  "/_next/static/chunks/212ne2da2w25m.css",
  "/_next/static/chunks/25bl4p0jwvuj7.js",
  "/_next/static/chunks/2ffct51wka6zw.js",
  "/_next/static/chunks/2iql0qw5_ufii.js",
  "/_next/static/chunks/2lrib3r7g82hw.css",
  "/_next/static/chunks/2ls0hmuftd6wt.js",
  "/_next/static/chunks/3_4l61zwq6y3q.js",
  "/_next/static/chunks/311treeyjr29u.css",
  "/_next/static/chunks/32o-wy0yyo7kg.js",
  "/_next/static/chunks/3hnf11jk3zb7h.css",
  "/_next/static/chunks/3tqzxo4lpfcwo.js",
]);
const PRODUCT_PROJECT_SCREEN_PATHS = new Set([
  "achievements",
  "backups",
  "character-ai",
  "characters",
  "chat",
  "closed-ai",
  "drama",
  "learning",
  "rpg",
  "story-bible",
  "tasks",
  "timeline",
  "world",
  "write",
]);
const PRODUCT_NAVIGATION_PROMPT_DIGESTS = new Set([
  "7dfca3a6911ce28ebac9c08ee11dbf5776e05ff76f7398d1c7dc3fbf89d2961e",
  "b14faa0b55b38cad8d2e2b2d452183747c164f86e4a43946a1143d6929b1a1f3",
]);
const PRODUCT_STORY_BIBLE_OBJECTIVE_DIGEST =
  "6c4bb86c557cf16a759acdda48eb5e2dc75194195425c154ed3b79284e25c5f3";
const PRODUCT_IMMUTABLE_MODEL_ROOT_URLS = new Set([
  ...[
    "mlc-chat-config.json",
    "ndarray-cache.json",
    "tokenizer.json",
    ...Array.from({ length: 8 }, (_, index) => `params_shard_${index}.bin`),
  ].map((path) => (
    "https://huggingface.co/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC/"
    + `resolve/32ff081fe7e4dfe4ffb167b94c66fdf11e02b8ad/${path}`
  )),
  [
    "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/",
    "025bcaf3780fa8254f5e5efd3bfea0a5397248f4/",
    "web-llm-models/v0_2_84/base/",
    "Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm",
  ].join(""),
]);
const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const NEXT_RSC_TOKEN = /^[A-Za-z0-9_-]{1,64}$/u;
const PROFILE_NAME = /^novel-rc6-2-edge-[A-Za-z0-9][A-Za-z0-9-]{4,62}[A-Za-z0-9]$/u;

if (!networkSentinelOnly && expectedCommit !== PRODUCT_STATIC_ASSET_MANIFEST_COMMIT) {
  throw new Error("RC6_2_CLOSED_AI_PRODUCT_STATIC_MANIFEST_COMMIT_MISMATCH");
}

const SAFE_DIAGNOSTIC_CODES = Object.freeze([
  "CLOSED_AGENT_TRADITIONAL_CHINESE_POLICY_INVALID",
  "CLOSED_AGENT_TRADITIONAL_CHINESE_INTEGRITY_INVALID",
  "CLOSED_AGENT_PROVIDER_NORMALIZATION_NOT_DEFERRED",
  "QUALITY_TRADITIONALCHINESE_LOW",
  "QUALITY_CANONCOMPLIANCE_LOW",
  "QUALITY_CHARACTERVOICE_LOW",
  "QUALITY_CONTINUITY_LOW",
  "QUALITY_SPECIFICITY_LOW",
  "QUALITY_REPETITION_LOW",
  "QUALITY_STRUCTUREDOUTPUT_LOW",
  "QUALITY_TASKUSEFULNESS_LOW",
  "QUALITY_LENGTHCOMPLIANCE_LOW",
  "QUALITY_EMPTY_CANDIDATE",
  "QUALITY_TASK_FORM_MISMATCH",
  "QUALITY_SCORE_BELOW_THRESHOLD",
  "QUALITY_CONTEXT_ANCHOR_MISSING",
  "QUALITY_CONTEXT_CHARACTER_MISSING",
  "QUALITY_OUTPUT_TRUNCATED",
  "QUALITY_OUTPUT_CREDENTIAL_LEAK",
  "QUALITY_OUTPUT_RAW_REASONING_LEAK",
  "QUALITY_OUTPUT_CONTROL_TOKEN",
  "QUALITY_OUTPUT_ROLE_ENVELOPE",
  "QUALITY_OUTPUT_INTERNAL_ENVELOPE",
  "QUALITY_NARRATIVE_TOO_SHORT",
  "QUALITY_CONTEXT_COPY_EXCESSIVE",
  "QUALITY_NARRATIVE_PROGRESS_MISSING",
  "QUALITY_WORLD_REGISTER_DRIFT",
  "QUALITY_CONTINUATION_CONTROL_TOKEN",
  "QUALITY_CONTINUATION_ROLE_ENVELOPE",
  "QUALITY_CONTINUATION_INTERNAL_ENVELOPE",
  "QUALITY_CONTINUATION_ANCHOR_INVALID",
  "QUALITY_CONTINUATION_ANCHOR_REPEATED",
  "QUALITY_CONTINUATION_SUFFIX_EMPTY",
  "QUALITY_CONTINUATION_BASE_REPEATED",
  "QUALITY_CONTINUATION_CONTRACT_UNSATISFIED",
  "CHARACTER_KNOWLEDGE_BOUNDARY_LEAK",
  "CANDIDATE_EMPTY",
  "CANDIDATE_CREDENTIAL_LEAK",
  "CANDIDATE_RAW_REASONING_LEAK",
  "CANDIDATE_TRADITIONAL_CHINESE_INTEGRITY_INVALID",
  "CANDIDATE_SIMPLIFIED_CHINESE_REMAINS",
  "CANDIDATE_PROPER_NOUN_DRIFT",
  "CANDIDATE_ONLY_CONTRACT_MISSING",
  "CANDIDATE_DEVICE_BOUNDARY_VIOLATION",
  "ABC_CHOICES_INVALID_STRUCTURE",
  "BROWSER_AI_MANDATORY_PROMPT_CONTRACT_MISSING",
  "BROWSER_AI_MANDATORY_PROMPT_BUDGET_EXCEEDED",
  "BROWSER_FINAL_CONTEXT_PROOF_REQUIRED",
  "BROWSER_FINAL_CONTEXT_BINDING_MISMATCH",
  "BROWSER_FINAL_CONTEXT_ENVELOPE_INVALID",
  "BROWSER_FINAL_CONTEXT_BUDGET_EXCEEDED",
  "BROWSER_WEBLLM_EMPTY_RESPONSE",
  "BROWSER_WEBLLM_MODEL_NOT_INSTALLED",
  "BROWSER_WEBLLM_MODEL_NOT_SELECTED",
  "BROWSER_GPU_QUEUE_BACKPRESSURE",
  "BROWSER_GPU_MEMORY_BUDGET_EXCEEDED",
  "BROWSER_GPU_JOB_TIMEOUT",
  "BROWSER_GPU_RECOVERY_FAILED",
  "BROWSER_WEBLLM_GPU_DEVICE_LOST",
  "BROWSER_WEBLLM_WORKER_CRASHED",
  "BROWSER_WEBLLM_WORKER_MESSAGE_FAILED",
  "BROWSER_WEBLLM_GENERATION_FAILED",
]);
const SAFE_DIAGNOSTIC_CODE_SET = new Set(SAFE_DIAGNOSTIC_CODES);
const SAFE_RUNTIME_STAGES = Object.freeze(["initial", "repair", "extension", "recovery"]);
const SAFE_RUNTIME_FINISH_REASONS = Object.freeze([
  "stop",
  "length",
  "tool_calls",
  "abort",
  "unavailable",
]);
const SAFE_RUNTIME_STAGE_SET = new Set(SAFE_RUNTIME_STAGES);
const SAFE_RUNTIME_FINISH_REASON_SET = new Set(SAFE_RUNTIME_FINISH_REASONS);
const PERSISTED_FAILURE_SAFE_CODES = Object.freeze([
  "CLOSED_AGENT_TASK_FAILED",
  "CLOSED_AGENT_EVALUATION_BLOCKED",
  "CLOSED_AGENT_FAILURE_EVIDENCE_INVALID",
  "CLOSED_AGENT_FAILURE_EVIDENCE_PERSIST_FAILED",
  "CLOSED_AI_REQUIRED_BACKEND_NOT_READY",
  "BROWSER_AI_QUALITY_INSUFFICIENT",
  "BROWSER_AI_REQUIRED_GENERATIVE_EXECUTION_FAILED",
  "BROWSER_AI_REQUIRED_GENERATIVE_EXECUTOR_UNAVAILABLE",
  "BROWSER_AI_MANDATORY_PROMPT_CONTRACT_MISSING",
  "BROWSER_AI_MANDATORY_PROMPT_BUDGET_EXCEEDED",
  "BROWSER_FINAL_CONTEXT_PROOF_REQUIRED",
  "BROWSER_FINAL_CONTEXT_BINDING_MISMATCH",
  "BROWSER_FINAL_CONTEXT_ENVELOPE_INVALID",
  "BROWSER_FINAL_CONTEXT_BUDGET_EXCEEDED",
  "BROWSER_WEBLLM_EMPTY_RESPONSE",
  "BROWSER_WEBLLM_MODEL_NOT_INSTALLED",
  "BROWSER_WEBLLM_MODEL_NOT_SELECTED",
  "BROWSER_GPU_QUEUE_BACKPRESSURE",
  "BROWSER_GPU_MEMORY_BUDGET_EXCEEDED",
  "BROWSER_GPU_JOB_TIMEOUT",
  "BROWSER_GPU_RECOVERY_FAILED",
  "BROWSER_WEBLLM_GPU_DEVICE_LOST",
  "BROWSER_WEBLLM_WORKER_CRASHED",
  "BROWSER_WEBLLM_WORKER_MESSAGE_FAILED",
  "BROWSER_WEBLLM_GENERATION_FAILED",
]);
const PERSISTED_FAILURE_SAFE_CODE_SET = new Set(PERSISTED_FAILURE_SAFE_CODES);
const SAFE_UI_ERROR_CODE_SET = new Set([
  "CONVERSATION_ATTACHMENT_RIGHTS_CONFIRMATION_REQUIRED",
  "LEARNING_RIGHTS_CONFIRMATION_REQUIRED",
  "CONVERSATION_REGENERATION_SESSION_NOT_READY",
  "CONVERSATION_OPERATION_ALREADY_RUNNING",
  "CONVERSATION_REGENERATION_CLOSED_BACKEND_NOT_READY",
  "CONVERSATION_REGENERATION_SOURCE_STALE",
  "CONVERSATION_REGENERATION_SOURCE_PROOF_INVALID",
]);
const SAFE_FAILURE_CODES = new Set([
  "RC6_2_CLOSED_AI_GATE_FAILED",
  "RC6_2_CLOSED_AI_SETUP_FAILED",
  "RC6_2_CLOSED_AI_SETUP_TIMEOUT",
  "RC6_2_CLOSED_AI_UI_BUSY_TIMEOUT",
  "RC6_2_CLOSED_AI_GENERATION_FAILED",
  "RC6_2_CLOSED_AI_GENERATION_TIMEOUT",
  "RC6_2_CLOSED_AI_REGENERATION_UI_NOT_READY",
  "RC6_2_CLOSED_AI_REGENERATION_START_TIMEOUT",
  "RC6_2_CLOSED_AI_INCOMPLETE_TERMINAL_STATE",
  ...SAFE_UI_ERROR_CODE_SET,
  ...PERSISTED_FAILURE_SAFE_CODES,
]);

function sanitizeDiagnosticCodes(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(
    (value) => typeof value === "string" && SAFE_DIAGNOSTIC_CODE_SET.has(value),
  ))].sort().slice(0, 12);
}

function sanitizeRuntimeInteger(value, maximum) {
  return value === null
    || (
      typeof value === "number"
      && Number.isInteger(value)
      && value >= 0
      && value <= maximum
    )
    ? value
    : null;
}

function sanitizeBrowserRuntimeEvidence(values) {
  if (!Array.isArray(values) || values.length > 3) return [];
  const sanitized = values.flatMap((value) => {
    if (
      !value
      || typeof value !== "object"
      || !SAFE_RUNTIME_STAGE_SET.has(value.stage)
      || !SAFE_RUNTIME_FINISH_REASON_SET.has(value.finishReason)
      || Object.keys(value).length !== 6
    ) return [];
    const completionTokens = sanitizeRuntimeInteger(value.completionTokens, 4_096);
    const rawOutputCharacters = sanitizeRuntimeInteger(value.rawOutputCharacters, 20_000);
    const normalizedOutputCharacters = sanitizeRuntimeInteger(
      value.normalizedOutputCharacters,
      20_000,
    );
    const observedHanCharacters = sanitizeRuntimeInteger(
      value.observedHanCharacters,
      10_000,
    );
    if (
      value.completionTokens !== completionTokens
      || value.rawOutputCharacters !== rawOutputCharacters
      || value.normalizedOutputCharacters !== normalizedOutputCharacters
      || value.observedHanCharacters !== observedHanCharacters
      || (
        value.finishReason === "unavailable"
        && [
          completionTokens,
          rawOutputCharacters,
          normalizedOutputCharacters,
          observedHanCharacters,
        ].some((metric) => metric !== null)
      )
    ) return [];
    return [{
      stage: value.stage,
      finishReason: value.finishReason,
      completionTokens,
      rawOutputCharacters,
      normalizedOutputCharacters,
      observedHanCharacters,
    }];
  });
  if (sanitized.length !== values.length) return [];
  const stages = sanitized.map((value) => value.stage);
  if (
    (stages.length > 0 && stages[0] !== "initial")
    || (stages[1] !== undefined && stages[1] !== "repair")
    || (stages[2] !== undefined && !["extension", "recovery"].includes(stages[2]))
  ) return [];
  return sanitized;
}

function parsePersistedFailureEvidence(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096) return null;
  try {
    const parsed = JSON.parse(value);
    if (
      !parsed
      || typeof parsed !== "object"
      || Object.keys(parsed).length !== 4
      || parsed.schemaVersion !== FAILURE_EVIDENCE_SCHEMA_VERSION
      || !PERSISTED_FAILURE_SAFE_CODE_SET.has(parsed.safeCode)
      || !Array.isArray(parsed.diagnosticCodes)
      || parsed.diagnosticCodes.length > 12
      || parsed.diagnosticCodes.some((code) => (
        typeof code !== "string" || !SAFE_DIAGNOSTIC_CODE_SET.has(code)
      ))
      || new Set(parsed.diagnosticCodes).size !== parsed.diagnosticCodes.length
      || [...parsed.diagnosticCodes].sort().some((code, index) => (
        code !== parsed.diagnosticCodes[index]
      ))
      || !Array.isArray(parsed.browserRuntimeEvidence)
    ) return null;
    const browserRuntimeEvidence = sanitizeBrowserRuntimeEvidence(
      parsed.browserRuntimeEvidence,
    );
    if (browserRuntimeEvidence.length !== parsed.browserRuntimeEvidence.length) return null;
    const normalized = {
      schemaVersion: FAILURE_EVIDENCE_SCHEMA_VERSION,
      safeCode: parsed.safeCode,
      diagnosticCodes: [...parsed.diagnosticCodes],
      browserRuntimeEvidence,
    };
    return JSON.stringify(normalized) === value ? normalized : null;
  } catch {
    return null;
  }
}

function gateError(code) {
  const safeCode = SAFE_FAILURE_CODES.has(code)
    ? code
    : "RC6_2_CLOSED_AI_GATE_FAILED";
  return Object.assign(new Error(safeCode), { code: safeCode });
}

function safeFailureCode(error) {
  if (error && typeof error === "object") {
    const code = error.code;
    if (code === "ERR_ASSERTION") return "RC6_2_CLOSED_AI_GATE_FAILED";
    if (typeof code === "string" && SAFE_FAILURE_CODES.has(code)) return code;
  }
  return "RC6_2_CLOSED_AI_GATE_FAILED";
}

function runnerEnvelopeSafeErrorCode(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  return /^[A-Z][A-Z0-9_]{2,127}$/u.test(code)
    ? code
    : "RC6_2_CLOSED_AI_GATE_FAILED";
}

function rootRedirectRequest(request) {
  let current = request;
  while (current.redirectedFrom()) current = current.redirectedFrom();
  return current;
}

function requestNetworkClassification(request) {
  return classifyClosedAiCrossOriginRequest({
    urlValue: request.url(),
    expectedOrigin,
    requestPhase,
    rootUrlValue: rootRedirectRequest(request).url(),
  });
}

function modelAssetRequestCount() {
  return immutableModelRootRequests.length + approvedModelRedirectRequests.length;
}

function parsedRequestUrl(urlValue) {
  try {
    return new URL(urlValue);
  } catch {
    return null;
  }
}

function finiteRequestProtocol(url) {
  if (!url) return "invalid";
  if (LOCAL_NON_NETWORK_PROTOCOLS.has(url.protocol)) return url.protocol.slice(0, -1);
  if (["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
    return url.protocol.slice(0, -1);
  }
  return "other";
}

function finiteNetworkClassification(value) {
  return ALLOWED_REQUEST_CLASSIFICATIONS.has(value) ? value : "blocked";
}

function isAllowedLocalNonNetworkRequest(url) {
  if (!url || !LOCAL_NON_NETWORK_PROTOCOLS.has(url.protocol)) return false;
  return url.protocol !== "about:"
    || url.href === "about:blank"
    || url.href === "about:srcdoc";
}

function remainingSearchAfterOptionalRsc(url) {
  const params = new URLSearchParams(url.search);
  const rscValues = params.getAll("_rsc");
  if (rscValues.length > 1 || (rscValues[0] !== undefined && !NEXT_RSC_TOKEN.test(rscValues[0]))) {
    return null;
  }
  params.delete("_rsc");
  return params;
}

function hasSingleExactParameter(params, name, predicate) {
  const entries = [...params.entries()];
  return entries.length === 1
    && entries[0][0] === name
    && predicate(entries[0][1]);
}

function isAllowedProductDocumentTarget(url) {
  const params = remainingSearchAfterOptionalRsc(url);
  if (!params) return false;
  if (url.pathname === "/studio" || url.pathname === "/settings/local-ai") {
    return [...params].length === 0;
  }
  if (url.pathname === "/studio/create") {
    return [...params].length === 0
      || hasSingleExactParameter(params, "cloneFrom", (value) => UUID_V4.test(value));
  }
  if (url.pathname === "/professional") {
    return hasSingleExactParameter(params, "projectId", (value) => UUID_V4.test(value));
  }
  const match = url.pathname.match(
    /^\/studio\/project\/([a-f0-9-]{36})\/([a-z-]+)$/u,
  );
  if (!match || !UUID_V4.test(match[1]) || !PRODUCT_PROJECT_SCREEN_PATHS.has(match[2])) {
    return false;
  }
  if ([...params].length === 0) return true;
  if (match[2] === "chat") {
    return hasSingleExactParameter(params, "prompt", (value) => (
      PRODUCT_NAVIGATION_PROMPT_DIGESTS.has(sha256Value(value))
    ));
  }
  if (match[2] === "closed-ai") {
    if (hasSingleExactParameter(params, "backend", (value) => (
      value === "local-ollama" || value === "private-ai-hub"
    ))) return true;
    const task = params.getAll("task");
    const objective = params.getAll("objective");
    const source = params.getAll("source");
    return [...params].length === 3
      && task.length === 1
      && task[0] === "story.storyBibleCandidate"
      && objective.length === 1
      && sha256Value(objective[0]) === PRODUCT_STORY_BIBLE_OBJECTIVE_DIGEST
      && source.length === 1
      && source[0] === "project-data";
  }
  if (match[2] === "write") {
    return hasSingleExactParameter(params, "chapterId", (value) => UUID_V4.test(value));
  }
  return false;
}

function isAllowedSameOriginTarget(url) {
  if (!url || url.origin !== expectedOrigin) return false;
  if (PRODUCT_STATIC_ASSET_PATHS.has(url.pathname)) return url.search === "";
  if (url.pathname === "/manifest.webmanifest" || url.pathname === "/studio-service-worker.js") {
    return url.search === "";
  }
  if (url.pathname === "/favicon.ico") {
    return url.search === "?favicon.2vob68tjqpejf.ico";
  }
  if (url.pathname === "/api/persistence/health") return url.search === "";
  if (url.pathname === "/api/release/identity") {
    if (url.search === "") return true;
    const params = new URLSearchParams(url.search);
    return hasSingleExactParameter(params, "rc6_2", (value) => UUID_V4.test(value));
  }
  return isAllowedProductDocumentTarget(url);
}

function isAllowedImmutableModelTarget(request, classification) {
  if (classification === "immutable-model-root") {
    return PRODUCT_IMMUTABLE_MODEL_ROOT_URLS.has(request.url());
  }
  if (classification === "immutable-model-redirect") {
    return PRODUCT_IMMUTABLE_MODEL_ROOT_URLS.has(rootRedirectRequest(request).url());
  }
  return true;
}

function safeNetworkTargetProjection(urlValue) {
  const url = parsedRequestUrl(urlValue);
  return {
    phase: SAFE_REQUEST_PHASES.has(requestPhase) ? requestPhase : "unknown",
    protocol: finiteRequestProtocol(url),
    hostDigest: url?.host ? sha256Value(url.host.toLowerCase()) : null,
    pathDigest: url ? sha256Value(url.pathname) : null,
    targetDigest: url ? sha256Value(`${url.pathname}${url.search}`) : null,
  };
}

function isProhibitedExternalAi(urlValue) {
  const hostname = parsedRequestUrl(urlValue)?.hostname.toLowerCase().replace(/\.+$/u, "");
  if (!hostname) return false;
  return [
    "api.openai.com",
    "api.x.ai",
    "api.groq.com",
    "generativelanguage.googleapis.com",
    "api.anthropic.com",
  ].some((blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`));
}

function isExactPreviewToolbarRequest(urlValue) {
  const url = parsedRequestUrl(urlValue);
  return isPreviewToolbarRequest(urlValue)
    && url?.protocol === "https:"
    && url.hostname === "vercel.live"
    && url.port === ""
    && url.username === ""
    && url.password === "";
}

function sanitizedOutboundHeaders(request, parsedUrl) {
  const acceptByResourceType = {
    document: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    image: "image/avif,image/webp,image/apng,image/svg+xml,*/*;q=0.8",
    manifest: "application/manifest+json,application/json;q=0.9,*/*;q=0.8",
    script: "*/*",
    stylesheet: "text/css,*/*;q=0.1",
  };
  const headers = {
    accept: acceptByResourceType[request.resourceType()] ?? "*/*",
    "accept-language": "zh-TW,zh;q=0.9,en;q=0.8",
  };
  const originalHeaders = request.headers();
  if (parsedUrl?.searchParams.has("_rsc") && originalHeaders.rsc === "1") {
    headers.rsc = "1";
    if (originalHeaders["next-router-prefetch"] === "1") {
      headers["next-router-prefetch"] = "1";
    }
  }
  return headers;
}

async function requestRouteDecision(request) {
  const urlValue = request.url();
  if (isExactPreviewToolbarRequest(urlValue)) {
    return {
      action: "abort-toolbar",
      classification: "blocked",
      method: ALLOWED_REQUEST_METHODS.has(request.method().toUpperCase())
        ? request.method().toUpperCase()
        : "OTHER",
      reasonCodes: [],
      sanitizedHeaders: null,
    };
  }
  const parsedUrl = parsedRequestUrl(urlValue);
  const normalizedMethod = request.method().toUpperCase();
  if (
    requestPhase === "bootstrap"
    && sentinelBootstrapActive
    && sentinelBootstrapUrl !== null
    && !sentinelBootstrapConsumed
    && urlValue === sentinelBootstrapUrl
    && normalizedMethod === "GET"
    && request.resourceType() === "document"
    && request.postDataBuffer() === null
    && parsedUrl?.username === ""
    && parsedUrl.password === ""
    && request.redirectedFrom() === null
    && parsedUrl.search === ""
    && parsedUrl.hash === ""
  ) {
    const credentialHeaderCount = (await request.headersArray()).filter((header) => (
      NETWORK_SENTINEL_CREDENTIAL_HEADERS.has(header.name.toLowerCase())
    )).length;
    if (
      credentialHeaderCount === 0
      && requestPhase === "bootstrap"
      && sentinelBootstrapActive
      && !sentinelBootstrapConsumed
      && urlValue === sentinelBootstrapUrl
    ) {
      return {
        action: "continue-bootstrap",
        classification: "blocked",
        method: "GET",
        reasonCodes: [],
        sanitizedHeaders: { accept: "text/html" },
      };
    }
  }
  const localScheme = isAllowedLocalNonNetworkRequest(parsedUrl);
  const classification = localScheme
    ? "local-scheme"
    : requestNetworkClassification(request);
  const methodAllowed = ALLOWED_REQUEST_METHODS.has(normalizedMethod);
  const prohibitedExternalAi = isProhibitedExternalAi(urlValue);
  const classificationAllowed = ALLOWED_REQUEST_CLASSIFICATIONS.has(classification);
  const sameOriginTargetAllowed = classification !== "same-origin"
    || isAllowedSameOriginTarget(parsedUrl);
  const immutableModelTargetAllowed = isAllowedImmutableModelTarget(request, classification);
  const requestBodyAllowed = request.postDataBuffer() === null;
  const urlCredentialsAllowed = parsedUrl?.username === "" && parsedUrl.password === "";
  const credentialHeaderNames = new Set([
    "authorization",
    "cookie",
    "cookie2",
    "proxy-authorization",
  ]);
  const credentialHeadersAllowed = !(await request.headersArray()).some((header) => (
    credentialHeaderNames.has(header.name.toLowerCase())
  ));
  const reasonCodes = [];
  if (prohibitedExternalAi) reasonCodes.push("prohibited-external-ai");
  if (!methodAllowed) reasonCodes.push("method-not-allowed");
  if (!classificationAllowed) reasonCodes.push("network-classification-blocked");
  if (!sameOriginTargetAllowed) reasonCodes.push("same-origin-target-not-allowed");
  if (!immutableModelTargetAllowed) reasonCodes.push("immutable-model-target-not-allowed");
  if (!requestBodyAllowed) reasonCodes.push("request-body-not-allowed");
  if (!urlCredentialsAllowed) reasonCodes.push("url-credentials-not-allowed");
  if (!credentialHeadersAllowed) reasonCodes.push("credential-header-not-allowed");
  return {
    action: reasonCodes.length === 0 ? "continue" : "abort-policy",
    classification: finiteNetworkClassification(classification),
    method: methodAllowed ? normalizedMethod : "OTHER",
    reasonCodes,
    sanitizedHeaders: reasonCodes.length === 0
      ? sanitizedOutboundHeaders(request, parsedUrl)
      : null,
  };
}

function safeBlockedRequestProjection(request, decision) {
  return {
    ...safeNetworkTargetProjection(request.url()),
    method: decision.method,
    classification: decision.classification,
    reasonCodes: [...decision.reasonCodes],
  };
}

function appendBoundedProjection(collection, projection) {
  if (collection.length < MAX_SAFE_NETWORK_PROJECTIONS) collection.push(projection);
}

function recordBlockedNetworkAttempt(request, decision) {
  const projection = safeBlockedRequestProjection(request, decision);
  blockedNetworkPolicyAttemptCount += 1;
  appendBoundedProjection(blockedNetworkPolicyAttempts, projection);
  if (decision.reasonCodes.includes("prohibited-external-ai")) {
    prohibitedExternalAiRequestCount += 1;
    appendBoundedProjection(prohibitedExternalAiRequests, projection);
  }
  if (decision.reasonCodes.includes("network-classification-blocked")) {
    disallowedCrossOriginRequestCount += 1;
    appendBoundedProjection(disallowedCrossOriginRequests, projection);
  }
  if (decision.reasonCodes.includes("same-origin-target-not-allowed")) {
    disallowedSameOriginTargetRequestCount += 1;
    appendBoundedProjection(disallowedSameOriginTargetRequests, projection);
  }
  if (decision.reasonCodes.includes("immutable-model-target-not-allowed")) {
    disallowedImmutableModelTargetRequestCount += 1;
    appendBoundedProjection(disallowedImmutableModelTargetRequests, projection);
  }
  if (decision.reasonCodes.includes("method-not-allowed")) {
    disallowedMethodRequestCount += 1;
    appendBoundedProjection(disallowedMethodRequests, projection);
  }
}

function isPreviewToolbarWebSocket(urlValue) {
  const url = parsedRequestUrl(urlValue);
  return url?.protocol === "wss:"
    && url.hostname === "vercel.live"
    && url.port === ""
    && url.username === ""
    && url.password === "";
}

async function routeClosedAiWebSocket(webSocketRoute) {
  const probeState = sentinelProbeState;
  if (
    probeState !== null
    && webSocketRoute.url() === probeState.webSocketUrl
  ) {
    probeState.webSocketRouteObservationCount += 1;
    probeState.disallowedWebSocketCount += 1;
    probeState.probeRouteRecords[2] = {
      probeId: "WEBSOCKET",
      routeObserved: true,
      routeDecision: "not-observed",
      reasonCodes: [],
    };
    const action = webSocketRoute.close({ code: 1008, reason: "closed-ai-network-policy" })
      .then(() => {
        probeState.webSocketRouteBlockedCount += 1;
        probeState.probeRouteRecords[2] = {
          probeId: "WEBSOCKET",
          routeObserved: true,
          routeDecision: "blocked",
          reasonCodes: ["network-classification-blocked"],
        };
      }, (error) => {
        probeState.probeRouteRecords[2] = {
          probeId: "WEBSOCKET",
          routeObserved: true,
          routeDecision: "block-failed",
          reasonCodes: ["network-classification-blocked"],
        };
        probeState.routeActionErrors.push(error);
      });
    pendingSentinelRouteActions.add(action);
    await action.finally(() => pendingSentinelRouteActions.delete(action));
    return;
  }
  const projection = safeNetworkTargetProjection(webSocketRoute.url());
  observedWebSocketAttemptCount += 1;
  blockedWebSocketAttemptCount += 1;
  if (isPreviewToolbarWebSocket(webSocketRoute.url())) {
    observedPreviewToolbarWebSocketAttemptCount += 1;
    blockedPreviewToolbarWebSocketAttemptCount += 1;
    appendBoundedProjection(blockedPreviewToolbarWebSocketAttempts, projection);
  } else {
    disallowedWebSocketAttemptCount += 1;
    appendBoundedProjection(disallowedWebSocketAttempts, projection);
  }
  await webSocketRoute.close({ code: 1008, reason: "closed-ai-network-policy" });
}

async function routeClosedAiRequest(route) {
  const request = route.request();
  const decision = await requestRouteDecision(request);
  if (decision.action === "continue-bootstrap") {
    if (
      !sentinelBootstrapActive
      || sentinelBootstrapConsumed
      || request.url() !== sentinelBootstrapUrl
    ) throw gateError("RC6_2_NETWORK_SENTINEL_BOOTSTRAP_RACE");
    sentinelBootstrapConsumed = true;
    sentinelBootstrapAllowedCount += 1;
    await route.continue({ headers: decision.sanitizedHeaders });
    return;
  }
  if (sentinelProbeState !== null) {
    const probeState = sentinelProbeState;
    const probeIndex = request.url() === sentinelProbeState.httpGetUrl
      ? 0
      : request.url() === sentinelProbeState.httpPostUrl
        ? 1
        : -1;
    if (probeIndex !== -1) {
      const probeId = probeIndex === 0 ? "HTTP_GET" : "HTTP_POST";
      probeState.httpRouteObservationCount += 1;
      if (decision.reasonCodes.includes("network-classification-blocked")) {
        probeState.crossOriginClassificationCount += 1;
      }
      if (decision.reasonCodes.includes("method-not-allowed")) {
        probeState.methodRejectedCount += 1;
      }
      if (decision.reasonCodes.includes("request-body-not-allowed")) {
        probeState.bodyRejectedCount += 1;
      }
      probeState.probeRouteRecords[probeIndex] = {
        probeId,
        routeObserved: true,
        routeDecision: "not-observed",
        reasonCodes: [],
      };
      if (decision.action === "abort-policy") {
        const action = route.abort("blockedbyclient").then(() => {
          probeState.httpRouteBlockedCount += 1;
          probeState.probeRouteRecords[probeIndex] = {
            probeId,
            routeObserved: true,
            routeDecision: "blocked",
            reasonCodes: [...decision.reasonCodes],
          };
        }, (error) => {
          probeState.probeRouteRecords[probeIndex] = {
            probeId,
            routeObserved: true,
            routeDecision: "block-failed",
            reasonCodes: [...decision.reasonCodes],
          };
          probeState.routeActionErrors.push(error);
        });
        pendingSentinelRouteActions.add(action);
        await action.finally(() => pendingSentinelRouteActions.delete(action));
      }
      else {
        assert.ok(decision.sanitizedHeaders);
        const action = route.continue({ headers: decision.sanitizedHeaders }).then(() => {
          probeState.probeRouteRecords[probeIndex] = {
            probeId,
            routeObserved: true,
            routeDecision: "continued",
            reasonCodes: [],
          };
        }, (error) => {
          probeState.probeRouteRecords[probeIndex] = {
            probeId,
            routeObserved: true,
            routeDecision: "continue-failed",
            reasonCodes: [],
          };
          probeState.routeActionErrors.push(error);
        });
        pendingSentinelRouteActions.add(action);
        await action.finally(() => pendingSentinelRouteActions.delete(action));
      }
      return;
    }
  }
  if (decision.action === "abort-toolbar") {
    blockedPreviewToolbarRequests.add(request);
    await route.abort("blockedbyclient");
    return;
  }
  if (decision.action === "abort-policy") {
    recordBlockedNetworkAttempt(request, decision);
    blockedNonToolbarRequests.add(request);
    await route.abort("blockedbyclient");
    return;
  }
  if (
    decision.classification === "immutable-model-root"
    || decision.classification === "immutable-model-redirect"
  ) {
    const parsed = new URL(request.url());
    const collection = decision.classification === "immutable-model-root"
      ? immutableModelRootRequests
      : approvedModelRedirectRequests;
    collection.push({ host: parsed.host, path: parsed.pathname });
  }
  assert.ok(decision.sanitizedHeaders, "allowed request did not receive finite sanitized headers");
  await route.continue({ headers: decision.sanitizedHeaders });
}

function observeClosedAiRequest(request) {
  if (isExactPreviewToolbarRequest(request.url())) {
    observedPreviewToolbarRequests.push(request);
  }
}

function observeClosedAiResponse(response) {
  if (isExactPreviewToolbarRequest(response.url())) {
    previewToolbarResponseCount += 1;
    appendBoundedProjection(
      previewToolbarResponses,
      safeNetworkTargetProjection(response.url()),
    );
  }
  if (blockedNonToolbarRequests.has(response.request())) {
    blockedNonToolbarResponseCount += 1;
    appendBoundedProjection(blockedNonToolbarResponses, {
      phase: SAFE_REQUEST_PHASES.has(requestPhase) ? requestPhase : "unknown",
      code: "blocked-request-produced-response",
    });
  }
}

function sha256Value(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

function networkSentinelMatrixDigest(value) {
  const body = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "matrixDigest"),
  );
  return sha256Value(`${NETWORK_SENTINEL_SCHEMA}\n${stableStringify(body)}`);
}

function firstNetworkSentinelScalarMismatch(value) {
  for (const [scalarId, expectedSafeValue, assertionId] of NETWORK_SENTINEL_SCALAR_EXPECTATIONS) {
    if (value[scalarId] !== expectedSafeValue) {
      return { assertionId, scalarId, expectedSafeValue, actualSafeValue: value[scalarId] };
    }
  }
  const baselineMismatch = [
    ["receiverBaseline.tcpConnectionReceiptCount", 1, value.receiverBaseline.tcpConnectionReceiptCount,
      "NETWORK_SENTINEL_RECEIVER_TCP_DELTA_ZERO", value.receiverBaseline.tcpConnectionReceiptCount < 1],
    ["receiverBaseline.httpRequestReceiptCount", 1, value.receiverBaseline.httpRequestReceiptCount,
      "NETWORK_SENTINEL_BOOTSTRAP_EXACTLY_ONCE",
      value.receiverBaseline.httpRequestReceiptCount !== 1],
    ["receiverBaseline.httpRequestBodyByteCount", 0, value.receiverBaseline.httpRequestBodyByteCount,
      "NETWORK_SENTINEL_POST_BODY_REJECTED", value.receiverBaseline.httpRequestBodyByteCount !== 0],
    ["receiverBaseline.webSocketUpgradeReceiptCount", 0, value.receiverBaseline.webSocketUpgradeReceiptCount,
      "NETWORK_SENTINEL_RECEIVER_WEBSOCKET_DELTA_ZERO",
      value.receiverBaseline.webSocketUpgradeReceiptCount !== 0],
  ].find((entry) => entry[4]);
  return baselineMismatch ? {
    scalarId: baselineMismatch[0],
    expectedSafeValue: baselineMismatch[1],
    actualSafeValue: baselineMismatch[2],
    assertionId: baselineMismatch[3],
  } : null;
}

function finalizeNetworkSentinelMatrix(value) {
  const firstFailedScalarAssertion = firstNetworkSentinelScalarMismatch(value);
  const body = {
    ...value,
    status: firstFailedScalarAssertion === null ? "PASS" : "FAIL",
    firstFailedScalarAssertion,
  };
  return { ...body, matrixDigest: networkSentinelMatrixDigest(body) };
}

function createPassingNetworkSentinelFixture() {
  return finalizeNetworkSentinelMatrix({
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
    probeRouteRecords: NETWORK_SENTINEL_PROBE_SPECS.map(({ probeId, reasonCodes }) => ({
      probeId,
      routeObserved: true,
      routeDecision: "blocked",
      reasonCodes: [...reasonCodes],
    })),
    firstFailedScalarAssertion: null,
  });
}

function runnerEnvelopeDigest(value) {
  const body = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "envelopeDigest"),
  );
  return sha256Value(stableStringify(body));
}

function safeMessageDigest(error) {
  const name = typeof error?.name === "string" ? error.name : "Error";
  const code = typeof error?.code === "string" ? error.code : "UNKNOWN";
  return sha256Value(`${name}\n${code}`);
}

function classifyRunnerEnvelopeFailure(error) {
  const name = typeof error?.name === "string" ? error.name : "";
  const code = typeof error?.code === "string" ? error.code : "";
  if (code === "ERR_ASSERTION") return "ASSERTION";
  if (/timeout/iu.test(name) || /TIMEOUT/u.test(code)) return "TIMEOUT";
  if (/playwright/iu.test(name) || /browser/iu.test(name)) return "PLAYWRIGHT_ERROR";
  if (/NETWORK|WEBSOCKET|EGRESS/u.test(code)) return "NETWORK_POLICY_REJECTION";
  if (/PROCESS/u.test(code)) return "PROCESS_ERROR";
  if (SAFE_FAILURE_CODES.has(code)) return "GATE_ERROR";
  return "UNKNOWN_SAFE";
}

function checkpointOperationId(checkpoint) {
  return `CHECKPOINT_${checkpoint.replace(/[^A-Za-z0-9]+/gu, "_").toUpperCase()}`.slice(0, 96);
}

function checkpointAssertionId(checkpoint) {
  const mappings = [
    [/^launch$/u, "EDGE_CONTEXT_SINGLE_PAGE"],
    [/^edge-identity$/u, "EDGE_INITIAL_PAGE_ABOUT_BLANK"],
    [/^network-zero-receipt-sentinel$/u, "NETWORK_SENTINEL_ZERO_EGRESS"],
    [/release-identity/u, "RELEASE_IDENTITY_EXACT"],
    [/^fresh-storage$/u, "FRESH_STORAGE_EMPTY"],
    [/^project-create$/u, "PROJECT_CREATED"],
    [/story-bible/u, "STORY_BIBLE_CREATED"],
    [/prepare-consumer-readiness/u, "BROWSER_AI_SETUP_READY"],
    [/prepare-model-metadata/u, "MODEL_SHARDS_VERIFIED"],
    [/attachment-rights-negative/u, "ATTACHMENT_RIGHTS_NEGATIVE_BLOCKED"],
    [/attachment-rights-positive/u, "ATTACHMENT_RIGHTS_POSITIVE_ACCEPTED"],
    [/^t1-probe$/u, "T1_CONTEXT_BOUND"],
    [/first-candidate/u, "FIRST_CANDIDATE_CREATED"],
    [/direct-regeneration/u, "DIRECT_REGENERATION_CREATED"],
    [/reject-canon/u, "REJECT_CANON_UNCHANGED"],
    [/cache-reuse/u, "CACHE_REUSED_AFTER_RELOAD"],
    [/chained-regeneration/u, "CHAINED_REGENERATION_CREATED"],
    [/approval-revision/u, "APPROVAL_REVISION_INCREMENTED_ONCE"],
    [/final-reload/u, "FINAL_RELOAD_PERSISTED"],
    [/final-release-identity/u, "FINAL_RELOAD_PERSISTED"],
  ];
  return mappings.find(([pattern]) => pattern.test(checkpoint))?.[1] ?? null;
}

function enterRunnerCheckpoint(checkpoint) {
  if (runnerCheckpointTrail.at(-1)?.status === "entered") {
    runnerCheckpointTrail[runnerCheckpointTrail.length - 1] = {
      ...runnerCheckpointTrail.at(-1),
      completedAt: new Date().toISOString(),
      status: "completed",
    };
    runnerLastCompletedCheckpoint = runnerCheckpointTrail.at(-1).checkpoint;
  }
  runnerCheckpointOrdinal += 1;
  runnerCheckpointTrail.push({
    ordinal: runnerCheckpointOrdinal,
    checkpoint,
    enteredAt: new Date().toISOString(),
    completedAt: null,
    status: "entered",
  });
  if (runnerCheckpointTrail.length > RUNNER_ENVELOPE_MAX_CHECKPOINTS) runnerCheckpointTrail.shift();
  gateCheckpoint = checkpoint;
}

function completeRunnerCheckpoint() {
  const current = runnerCheckpointTrail.at(-1);
  if (!current || current.status !== "entered") return;
  runnerCheckpointTrail[runnerCheckpointTrail.length - 1] = {
    ...current,
    completedAt: new Date().toISOString(),
    status: "completed",
  };
  runnerLastCompletedCheckpoint = current.checkpoint;
}

function failRunnerCheckpoint(error) {
  const current = runnerCheckpointTrail.at(-1);
  if (current?.status === "entered") {
    runnerCheckpointTrail[runnerCheckpointTrail.length - 1] = {
      ...current,
      completedAt: new Date().toISOString(),
      status: "failed",
    };
  }
  if (!runnerFirstFailedOperation) {
    runnerFirstFailedOperation = {
      operationId: checkpointOperationId(gateCheckpoint),
      operationKind: "CHECKPOINT",
      messageDigest: safeMessageDigest(error),
    };
  }
  const sentinelScalarAssertion = error?.sentinelScalarAssertion;
  const assertionId = sentinelScalarAssertion
    && RUNNER_ENVELOPE_ASSERTION_IDS.has(sentinelScalarAssertion.assertionId)
    ? sentinelScalarAssertion.assertionId
    : checkpointAssertionId(gateCheckpoint);
  if (!runnerFirstFailedAssertion && error?.code === "ERR_ASSERTION" && assertionId) {
    runnerFirstFailedAssertion = {
      assertionId,
      errorName: "AssertionError",
      errorCode: "ERR_ASSERTION",
      operator: typeof error.operator === "string" ? error.operator : "unknown",
      messageDigest: safeMessageDigest(error),
      expectedDisposition: "equal",
      actualDisposition: "different",
    };
  }
}

function runnerEnvelopeProjectionValidation({
  detailedProjectionAvailable,
  minimalProjectionUsed,
  rejectedProjection = null,
}) {
  const rejectedKeys = rejectedProjection && typeof rejectedProjection === "object"
    ? Object.keys(rejectedProjection)
    : [];
  const unknownKeys = rejectedKeys
    .filter((key) => !RUNNER_ENVELOPE_KEYS.includes(key))
    .sort();
  const missingKeys = RUNNER_ENVELOPE_KEYS
    .filter((key) => key !== "envelopeDigest" && !rejectedKeys.includes(key))
    .sort();
  return {
    attempted: true,
    status: detailedProjectionAvailable ? "PASS" : "FAIL",
    schemaExpected: RUNNER_TERMINAL_ENVELOPE_SCHEMA_VERSION,
    schemaObserved: RUNNER_TERMINAL_ENVELOPE_SCHEMA_VERSION,
    detailedProjectionAvailable,
    minimalProjectionUsed,
    validatorErrorCode: detailedProjectionAvailable
      ? null
      : "RUNNER_TERMINAL_ENVELOPE_SCHEMA_INVALID",
    unknownKeys: minimalProjectionUsed ? unknownKeys : [],
    missingKeys: minimalProjectionUsed ? missingKeys : [],
    typeMismatchKeys: [],
    originalProjectionDigest: minimalProjectionUsed
      ? sha256Value(stableStringify(rejectedProjection))
      : null,
  };
}

function finiteNetworkSummary() {
  const externalRequestCount = prohibitedExternalAiRequestCount
    + disallowedCrossOriginRequestCount;
  return {
    policy: "phase-aware-context-route-default-deny-v3",
    routeInstalledBeforeNavigation: contextRouteInstalledBeforeNavigation,
    webSocketRouteInstalledBeforeNavigation: contextWebSocketRouteInstalledBeforeNavigation,
    blockedRequestCount: blockedNetworkPolicyAttemptCount,
    prohibitedExternalAiRequestCount,
    permittedImmutableModelRequestCount:
      immutableModelRootRequests.length + approvedModelRedirectRequests.length,
    externalRequestCount,
    dataLeftDevice: false,
    preNavigationSentinel: networkSentinelEvidence,
  };
}

function finiteModelSummary() {
  return {
    modelPayloadRequestCount: modelAssetRequestCount(),
    immutableModelRootRequestCount: immutableModelRootRequests.length,
    approvedModelRedirectRequestCount: approvedModelRedirectRequests.length,
    metadataObserved: finalOutput?.modelMetadataAtFailure !== null
      && finalOutput?.modelMetadataAtFailure !== undefined,
  };
}

function finiteUiSummary() {
  return {
    alertCount: Number.isSafeInteger(finalOutput?.uiStateAtFailure?.alertCount)
      ? finalOutput.uiStateAtFailure.alertCount
      : 0,
    safeErrorCodeCount: Array.isArray(finalOutput?.uiSafeErrorCodesAtFailure)
      ? finalOutput.uiSafeErrorCodesAtFailure.length
      : 0,
  };
}

function createRunnerTerminalEnvelope({
  status,
  exitCode,
  projectionFailure = null,
  rejectedProjection = null,
}) {
  const detailedProjectionAvailable = projectionFailure === null;
  const minimalProjectionUsed = projectionFailure !== null;
  const completedAt = new Date().toISOString();
  const failureError = projectionFailure ?? runnerCaughtError;
  const body = {
    schemaVersion: RUNNER_TERMINAL_ENVELOPE_SCHEMA_VERSION,
    status,
    attemptId: formalAttemptId,
    authorizationId: formalAuthorizationId,
    authorizationDigest: formalAuthorizationDigest,
    productCommit: expectedCommit,
    controlCommit: formalControlCommit,
    deploymentId: expectedDeploymentId,
    productionOrigin: expectedOrigin,
    releaseTag: formalReleaseTag,
    releaseRevision: formalReleaseRevision,
    runtimeReceiptDigest: formalRuntimeReceiptDigest,
    wrapperDigest: formalWrapperDigest,
    runnerDigest: formalRunnerDigest,
    contractDigest: formalContractDigest,
    mode,
    exitCode,
    startedAt: runnerEnvelopeStartedAt,
    completedAt,
    requestPhase,
    gateCheckpoint,
    lastCompletedCheckpoint: runnerLastCompletedCheckpoint,
    checkpointOrdinal: runnerCheckpointOrdinal,
    checkpointTrail: runnerCheckpointTrail.map((entry) => ({ ...entry })),
    failureShape: status === "PASS"
      ? null
      : projectionFailure === null
        ? classifyRunnerEnvelopeFailure(failureError)
        : "EVIDENCE_VALIDATION_ERROR",
    safeErrorCode: status === "PASS" ? null : runnerEnvelopeSafeErrorCode(failureError),
    firstFailedOperation: status === "PASS" ? null : runnerFirstFailedOperation ?? {
      operationId: checkpointOperationId(gateCheckpoint),
      operationKind: "CHECKPOINT",
      messageDigest: safeMessageDigest(failureError),
    },
    firstFailedAssertion: status === "PASS" ? null : runnerFirstFailedAssertion,
    projectionValidation: runnerEnvelopeProjectionValidation({
      detailedProjectionAvailable,
      minimalProjectionUsed,
      rejectedProjection,
    }),
    freshBrowserContext: context !== undefined && context !== null,
    profileOwnership,
    profilePathDigest,
    profileDisposed: finalOutput?.profileDisposed === true,
    networkSummary: finiteNetworkSummary(),
    modelSummary: finiteModelSummary(),
    uiSummary: finiteUiSummary(),
    persistenceReached: runnerPersistenceReached,
    storyBibleReached: runnerStoryBibleReached,
    candidateReached: runnerCandidateReached,
    externalRequestCount: prohibitedExternalAiRequestCount + disallowedCrossOriginRequestCount,
    dataLeftDevice: false,
  };
  return { ...body, envelopeDigest: runnerEnvelopeDigest(body) };
}

async function assertCreateNewDestination(path) {
  const destinationDirectory = dirname(path);
  const directoryTruth = await lstat(destinationDirectory);
  assert.equal(directoryTruth.isDirectory(), true);
  assert.equal(directoryTruth.isSymbolicLink(), false);
  assert.equal(
    comparableFilesystemPath(await realpath(destinationDirectory)),
    comparableFilesystemPath(destinationDirectory),
  );
  await lstat(path).then(
    () => { throw gateError("RC6_2_RUNNER_ENVELOPE_DESTINATION_EXISTS"); },
    (error) => { if (error?.code !== "ENOENT") throw error; },
  );
}

async function publishCreateNewAtomic(path, bytes) {
  await assertCreateNewDestination(path);
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporaryPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    assert.deepEqual(await readFile(temporaryPath), bytes);
    await link(temporaryPath, path);
    assert.deepEqual(await readFile(path), bytes);
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function publishRunnerTerminalEnvelope(envelope) {
  assert.equal(formalAttemptEnabled, true);
  const canonical = stableStringify(envelope);
  const bytes = Buffer.from(canonical, "utf8");
  assert.ok(bytes.length > 0 && bytes.length <= RUNNER_ENVELOPE_MAX_BYTES);
  assert.equal(JSON.parse(canonical).envelopeDigest, runnerEnvelopeDigest(envelope));
  await Promise.all([
    assertCreateNewDestination(formalRunnerEnvelopePath),
    assertCreateNewDestination(formalRunnerEnvelopeShaPath),
  ]);
  await publishCreateNewAtomic(formalRunnerEnvelopePath, bytes);
  const fileDigest = sha256Value(bytes);
  await publishCreateNewAtomic(
    formalRunnerEnvelopeShaPath,
    Buffer.from(`${fileDigest}\n`, "utf8"),
  );
  for (const path of [formalRunnerEnvelopePath, formalRunnerEnvelopeShaPath]) {
    const truth = await lstat(path);
    assert.equal(truth.isFile(), true);
    assert.equal(truth.isSymbolicLink(), false);
    assert.equal(truth.nlink, 1);
  }
  assert.equal(sha256Value(await readFile(formalRunnerEnvelopePath)), fileDigest);
  assert.equal(await readFile(formalRunnerEnvelopeShaPath, "utf8"), `${fileDigest}\n`);
  return { envelopeDigest: envelope.envelopeDigest, fileDigest };
}

const BROWSER_EXECUTION_RECEIPT_KEYS = Object.freeze([
  "actualExecutor",
  "browserGenerationUsed",
  "browserPrecomputeUsed",
  "candidateOnly",
  "canonicalMutationCount",
  "completedAt",
  "contextAttestation",
  "contextTokensAfter",
  "contextTokensBefore",
  "dataLeftDevice",
  "elapsedMs",
  "externalAIUsed",
  "finalModelContextAttestation",
  "localOllamaCallsAvoided",
  "localOllamaUsed",
  "modelDigest",
  "modelId",
  "outerRequestIdDigest",
  "plannedPipeline",
  "privateHubJobsAvoided",
  "privateHubUsed",
  "rawChainOfThoughtStored",
  "rawOutputStored",
  "rawPromptStored",
  "receiptId",
  "remoteModelCallsAvoided",
  "remoteModelInputTokensSaved",
  "remoteModelOutputRepairAvoided",
  "schemaVersion",
  "taskDigest",
  "taskType",
  "tokensSaved",
]);

const CLOSED_EXECUTION_RECEIPT_KEYS = Object.freeze([
  "actualExecutor",
  "backendId",
  "browserComputeReceiptId",
  "browserFabricPlannedGraph",
  "browserFabricReceiptId",
  "completedAt",
  "contentDigest",
  "contextAttestation",
  "contextDigest",
  "contextTokensAfter",
  "contextTokensBefore",
  "dataLeftDevice",
  "externalRequest",
  "finalModelContextAttestation",
  "generatedTokenEvents",
  "modelDigest",
  "modelId",
  "outputCharacters",
  "proofState",
  "startedAt",
  "taskId",
  "tokensSaved",
  "traditionalChineseNormalization",
]);

const FORBIDDEN_EVIDENCE_VALUE_KEYS = new Set([
  "content",
  "direction",
  "input",
  "messages",
  "objective",
  "output",
  "prompt",
  "serializedSource",
  "summary",
  "text",
]);

function assertSafeEvidenceProjection(value, path = "evidence") {
  if (typeof value === "string") {
    for (const sentinel of sensitiveEvidenceSentinels) {
      assert.equal(
        value.includes(sentinel),
        false,
        `${path} exposed a raw Preview-prose sentinel`,
      );
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeEvidenceProjection(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    assert.equal(
      FORBIDDEN_EVIDENCE_VALUE_KEYS.has(key),
      false,
      `${path}.${key} is a raw-value evidence field`,
    );
    assertSafeEvidenceProjection(child, `${path}.${key}`);
  }
}

function registerSensitiveEvidenceSentinel(value) {
  const normalized = String(value ?? "").replace(/\r\n?/gu, "\n").trim();
  if (Array.from(normalized).length >= 8) sensitiveEvidenceSentinels.add(normalized);
}

function escapeFinalContextFragment(value) {
  return value
    .replace(/\r\n?/gu, "\n")
    .trim()
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

function estimateBrowserTokensForEvidence(text) {
  const normalized = text.trim();
  if (!normalized) return 0;
  const cjk = (normalized.match(/[\u3400-\u9fff\uf900-\ufaff]/gu) ?? []).length;
  const other = Math.max(0, normalized.length - cjk);
  return Math.max(1, Math.ceil(cjk * 1.08 + other / 3.6));
}

function fitBrowserSourceForEvidence(text, maxTokens) {
  const normalizedBudget = Math.max(0, Math.floor(maxTokens));
  if (estimateBrowserTokensForEvidence(text) <= normalizedBudget) return text;
  const units = Array.from(text);
  const marker = "\n[…已壓縮…]\n";
  let low = 0;
  let high = units.length;
  let best = "";
  while (low <= high) {
    const sourceUnits = Math.floor((low + high) / 2);
    const headUnits = Math.floor(sourceUnits * 0.36);
    const tailUnits = sourceUnits - headUnits;
    const candidate = sourceUnits === 0
      ? ""
      : `${units.slice(0, headUnits).join("")}${marker}${units.slice(-tailUnits).join("")}`;
    if (estimateBrowserTokensForEvidence(candidate) <= normalizedBudget) {
      best = candidate;
      low = sourceUnits + 1;
    } else {
      high = sourceUnits - 1;
    }
  }
  if (!best && normalizedBudget > 0) {
    const prefix = [];
    for (const unit of units) {
      const candidate = `${prefix.join("")}${unit}`;
      if (estimateBrowserTokensForEvidence(candidate) > normalizedBudget) break;
      prefix.push(unit);
    }
    best = prefix.join("");
  }
  return best;
}

function possibleFinalContextFragments(source) {
  const cached = finalContextFragmentVariants.get(source.originalDigest);
  if (cached) return cached;
  const fittedSources = new Set([source.serializedSource]);
  for (let budget = 1; budget <= 4_096; budget += 1) {
    const fitted = fitBrowserSourceForEvidence(source.serializedSource, budget);
    if (fitted) fittedSources.add(fitted);
  }
  const fragments = [...fittedSources].map((serializedSource) => escapeFinalContextFragment(
    `[${source.outerKind}]\n${serializedSource}`,
  ));
  finalContextFragmentVariants.set(source.originalDigest, fragments);
  return fragments;
}

function assertSubstantiveSurvivingPrefix(binding, source) {
  assert.equal(binding.originalDigest, source.originalDigest);
  assert.equal(source.originalDigest, sha256Value(
    source.serializedSource.replace(/\r\n?/gu, "\n").trim(),
  ));
  const substantivePrefix = escapeFinalContextFragment(source.substantivePrefix);
  assert.ok(
    binding.survivingFragmentCharacters >= Array.from(substantivePrefix).length,
    `${source.sourceKind} did not retain its substantive serialized prefix`,
  );
  const matches = possibleFinalContextFragments(source).filter((fragment) => {
    const characters = Array.from(fragment);
    if (binding.survivingFragmentCharacters > characters.length) return false;
    const surviving = characters.slice(0, binding.survivingFragmentCharacters).join("");
    return surviving.startsWith(substantivePrefix)
      && sha256Value(surviving) === binding.survivingFragmentDigest
      && Buffer.byteLength(surviving, "utf8") === binding.survivingFragmentUtf8Bytes;
  });
  assert.ok(matches.length >= 1, `${source.sourceKind} surviving prefix digest was not reproducible`);
}

function finalContextSourceMetadataDigest(input) {
  return sha256Value(stableStringify({
    domain: "browser-final-context-source-metadata-v3",
    sourceKind: input.sourceKind,
    authority: input.authority,
    sourceArtifactDigest: input.sourceArtifactDigest,
    sourceRevisionDigest: input.sourceRevisionDigest,
  }));
}

function finalContextSourceIdDigest(sourceId, sourceKind) {
  return sha256Value(stableStringify({
    domain: "browser-final-context-source-id-v3",
    sourceId,
    sourceKind,
  }));
}

const FINAL_CONTEXT_DIGEST = /^[a-f0-9]{64}$/u;
const FINAL_CONTEXT_STAGES = new Set(["initial", "repair", "extension", "recovery"]);
const FINAL_CONTEXT_QUALITY_PHASES = new Set(["draft", "critic", "revision"]);
const FINAL_CONTEXT_QUALITY_MODES = new Set(["fast", "balanced", "deep"]);

function finalContextInnerIndex(stage) {
  return stage === "initial" ? 0 : stage === "repair" ? 1 : 2;
}

function expectedClosedQualityPassIdentity(evidence, qualityPhase) {
  const qualityMode = evidence.candidate.qualityMode;
  const qualityPasses = evidence.candidate.qualityPasses;
  assert.equal(FINAL_CONTEXT_QUALITY_MODES.has(qualityMode), true);
  assert.equal(FINAL_CONTEXT_QUALITY_PHASES.has(qualityPhase), true);
  assert.equal(qualityPhase, qualityMode === "fast" ? "draft" : "revision");
  assert.equal(
    qualityPasses,
    qualityMode === "fast" ? 1 : qualityMode === "balanced" ? 2 : 3,
  );
  const passIndex = qualityPhase === "draft"
    ? 0
    : qualityPhase === "critic"
      ? 1
      : qualityMode === "deep"
        ? 2
        : 1;
  if (qualityPhase === "critic") assert.equal(qualityMode, "deep");
  if (qualityPhase === "revision") assert.notEqual(qualityMode, "fast");
  assert.ok(passIndex < qualityPasses);
  const passDigest = sha256Value(
    `${evidence.candidate.taskId}|${qualityPhase}|${passIndex}`,
  );
  const outerRequestId =
    `${evidence.candidate.taskId}:quality:${qualityPhase}:${passDigest.slice(0, 32)}`;
  return {
    outerRequestId,
    outerRequestIdDigest: sha256Value(outerRequestId),
    taskDigest: sha256Value(`${evidence.projectId}:${outerRequestId}`),
  };
}

function expectedInnerRequestIdDigest(passIdentity, innerStage) {
  const suffix = {
    initial: "",
    repair: ":bounded-same-model-repair",
    extension: ":bounded-prose-extension",
    recovery: ":bounded-fresh-recovery",
  }[innerStage];
  assert.notEqual(suffix, undefined);
  return sha256Value(`${passIdentity.outerRequestId}${suffix}`);
}

function hasExactKeys(value, keys) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(","),
  );
}

function safeInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function sanitizeFinalContextInvocationProof(value) {
  const proofKeys = [
    "bindingDigest",
    "callOptionsDigest",
    "contextBindings",
    "digestSuite",
    "innerIndex",
    "innerStage",
    "invocationRequestIdDigest",
    "messageDescriptors",
    "modelDigest",
    "modelId",
    "omittedCharacters",
    "outerQualityPhase",
    "outerRequestIdDigest",
    "outerTaskType",
    "rawTextStored",
    "requiredManifestDigest",
    "schemaVersion",
  ];
  if (
    !hasExactKeys(value, proofKeys)
    || value.schemaVersion !== "browser-final-model-context-proof-v3"
    || value.digestSuite !== "sha256-utf8-exact-v1"
    || value.rawTextStored !== false
    || !FINAL_CONTEXT_STAGES.has(value.innerStage)
    || !FINAL_CONTEXT_QUALITY_PHASES.has(value.outerQualityPhase)
    || !safeInteger(value.innerIndex, 0, 2)
    || value.innerIndex !== finalContextInnerIndex(value.innerStage)
    || !safeInteger(value.omittedCharacters, 0, 10_000_000)
    || !/^[A-Za-z][A-Za-z0-9.-]{1,80}$/u.test(value.outerTaskType ?? "")
    || typeof value.modelId !== "string"
    || !value.modelId.trim()
    || value.modelId.length > 192
    || !Array.isArray(value.messageDescriptors)
    || value.messageDescriptors.length !== 2
    || !Array.isArray(value.contextBindings)
    || value.contextBindings.length > 13
  ) return null;
  for (const digest of [
    value.outerRequestIdDigest,
    value.invocationRequestIdDigest,
    value.modelDigest,
    value.callOptionsDigest,
    value.requiredManifestDigest,
    value.bindingDigest,
  ]) if (!FINAL_CONTEXT_DIGEST.test(digest ?? "")) return null;

  const messageDescriptors = [];
  for (const [index, descriptor] of value.messageDescriptors.entries()) {
    if (
      !hasExactKeys(descriptor, ["characters", "digest", "index", "role", "utf8Bytes"])
      || descriptor.index !== index
      || descriptor.role !== (index === 0 ? "system" : "user")
      || !FINAL_CONTEXT_DIGEST.test(descriptor.digest ?? "")
      || !safeInteger(descriptor.utf8Bytes, 0, 100_000_000)
      || !safeInteger(descriptor.characters, 0, 100_000_000)
    ) return null;
    messageDescriptors.push({
      index: descriptor.index,
      role: descriptor.role,
      digest: descriptor.digest,
      utf8Bytes: descriptor.utf8Bytes,
      characters: descriptor.characters,
    });
  }

  const bindingKeys = [
    "authority",
    "coverage",
    "endUtf8Byte",
    "messageIndex",
    "ordinal",
    "originalDigest",
    "segmentIndex",
    "sourceArtifactDigest",
    "sourceIdDigest",
    "sourceKind",
    "sourceMetadataDigest",
    "sourceRevisionDigest",
    "startUtf8Byte",
    "survivingFragmentCharacters",
    "survivingFragmentDigest",
    "survivingFragmentUtf8Bytes",
  ];
  const contextBindings = [];
  const sourceIds = new Set();
  let previousEnd = 0;
  for (const [index, binding] of value.contextBindings.entries()) {
    const storyBible = binding?.sourceKind === "approved-story-bible"
      && binding.authority === "composer-repository-verified";
    const attachment = binding?.sourceKind === "selected-local-attachment-summary"
      && binding.authority === "user-selected-sanitized-untrusted-reference";
    if (
      !hasExactKeys(binding, bindingKeys)
      || (!storyBible && !attachment)
      || binding.ordinal !== index + 1
      || binding.messageIndex !== 1
      || binding.segmentIndex !== index
      || binding.coverage !== "fragment"
      || !safeInteger(binding.startUtf8Byte, 0, 100_000_000)
      || !safeInteger(binding.endUtf8Byte, 1, 100_000_000)
      || binding.endUtf8Byte <= binding.startUtf8Byte
      || binding.startUtf8Byte < previousEnd
      || binding.endUtf8Byte > messageDescriptors[1].utf8Bytes
      || !safeInteger(binding.survivingFragmentUtf8Bytes, 1, 100_000_000)
      || !safeInteger(binding.survivingFragmentCharacters, 1, 100_000_000)
      || binding.endUtf8Byte - binding.startUtf8Byte !== binding.survivingFragmentUtf8Bytes
      || binding.survivingFragmentCharacters > messageDescriptors[1].characters
      || binding.survivingFragmentUtf8Bytes < binding.survivingFragmentCharacters
      || binding.survivingFragmentUtf8Bytes > binding.survivingFragmentCharacters * 4
    ) return null;
    for (const digest of [
      binding.sourceIdDigest,
      binding.originalDigest,
      binding.sourceArtifactDigest,
      binding.sourceRevisionDigest,
      binding.sourceMetadataDigest,
      binding.survivingFragmentDigest,
    ]) if (!FINAL_CONTEXT_DIGEST.test(digest ?? "")) return null;
    if (sourceIds.has(binding.sourceIdDigest)) return null;
    sourceIds.add(binding.sourceIdDigest);
    const expectedMetadataDigest = finalContextSourceMetadataDigest(binding);
    if (binding.sourceMetadataDigest !== expectedMetadataDigest) return null;
    contextBindings.push(Object.fromEntries(bindingKeys.map((key) => [key, binding[key]])));
    previousEnd = binding.endUtf8Byte;
  }

  const expectations = contextBindings.map((binding) => ({
    ordinal: binding.ordinal,
    sourceIdDigest: binding.sourceIdDigest,
    sourceKind: binding.sourceKind,
    authority: binding.authority,
    originalDigest: binding.originalDigest,
    sourceArtifactDigest: binding.sourceArtifactDigest,
    sourceRevisionDigest: binding.sourceRevisionDigest,
    sourceMetadataDigest: binding.sourceMetadataDigest,
  }));
  const expectedManifestDigest = sha256Value(stableStringify({
    domain: "browser-final-context-required-manifest-v3",
    outerRequestIdDigest: value.outerRequestIdDigest,
    outerTaskType: value.outerTaskType,
    outerQualityPhase: value.outerQualityPhase,
    expectations,
  }));
  if (value.requiredManifestDigest !== expectedManifestDigest) return null;
  const body = {
    schemaVersion: value.schemaVersion,
    digestSuite: value.digestSuite,
    outerRequestIdDigest: value.outerRequestIdDigest,
    invocationRequestIdDigest: value.invocationRequestIdDigest,
    outerTaskType: value.outerTaskType,
    outerQualityPhase: value.outerQualityPhase,
    innerStage: value.innerStage,
    innerIndex: value.innerIndex,
    modelId: value.modelId,
    modelDigest: value.modelDigest,
    callOptionsDigest: value.callOptionsDigest,
    requiredManifestDigest: value.requiredManifestDigest,
    messageDescriptors,
    contextBindings,
    omittedCharacters: value.omittedCharacters,
    rawTextStored: false,
  };
  if (value.bindingDigest !== sha256Value(stableStringify({
    domain: "browser-final-model-context-invocation-proof-v3",
    body,
  }))) return null;
  return { ...body, bindingDigest: value.bindingDigest };
}

function sanitizeFinalModelContextAttestation(value) {
  const attestationKeys = [
    "acceptedDisposition",
    "acceptedStage",
    "bindingDigest",
    "contributingCalls",
    "executedStages",
    "extensionBaseStage",
    "outerQualityPhase",
    "outerRequestIdDigest",
    "outerTaskType",
    "rawTextStored",
    "requiredManifestDigest",
    "schemaVersion",
  ];
  if (
    !hasExactKeys(value, attestationKeys)
    || value.schemaVersion !== "browser-final-model-context-attestation-v3"
    || value.rawTextStored !== false
    || !FINAL_CONTEXT_DIGEST.test(value.bindingDigest ?? "")
    || !FINAL_CONTEXT_DIGEST.test(value.outerRequestIdDigest ?? "")
    || !FINAL_CONTEXT_DIGEST.test(value.requiredManifestDigest ?? "")
    || !FINAL_CONTEXT_QUALITY_PHASES.has(value.outerQualityPhase)
    || !/^[A-Za-z][A-Za-z0-9.-]{1,80}$/u.test(value.outerTaskType ?? "")
    || !Array.isArray(value.executedStages)
    || !Array.isArray(value.contributingCalls)
    || value.contributingCalls.length < 1
    || value.contributingCalls.length > 2
  ) return null;
  const executedStages = [...value.executedStages];
  if (
    executedStages.length < 1
    || executedStages.length > 3
    || executedStages[0] !== "initial"
    || (executedStages[1] !== undefined && executedStages[1] !== "repair")
    || (executedStages[2] !== undefined
      && executedStages[2] !== "extension"
      && executedStages[2] !== "recovery")
    || new Set(executedStages).size !== executedStages.length
  ) return null;
  const contributingCalls = value.contributingCalls.map(sanitizeFinalContextInvocationProof);
  if (contributingCalls.some((call) => !call)) return null;
  const [first] = contributingCalls;
  if (!contributingCalls.every((call) => (
    call.outerQualityPhase === first.outerQualityPhase
    && call.outerRequestIdDigest === first.outerRequestIdDigest
    && call.outerTaskType === first.outerTaskType
    && call.modelId === first.modelId
    && call.modelDigest === first.modelDigest
    && call.requiredManifestDigest === first.requiredManifestDigest
  ))) return null;
  if (new Set(contributingCalls.map((call) => call.invocationRequestIdDigest)).size
    !== contributingCalls.length) return null;
  if (!contributingCalls.every((call) => (
    call.innerIndex === finalContextInnerIndex(call.innerStage)
    && executedStages[call.innerIndex] === call.innerStage
  ))) return null;
  const standalone = value.acceptedDisposition === "standalone"
    && contributingCalls.length === 1
    && contributingCalls[0].innerStage === value.acceptedStage
    && value.acceptedStage !== "extension"
    && value.extensionBaseStage === null;
  const composedExtension = value.acceptedDisposition === "composed-extension"
    && value.acceptedStage === "extension"
    && new Set(["initial", "repair"]).has(value.extensionBaseStage)
    && contributingCalls.length === 2
    && contributingCalls[0].innerStage === value.extensionBaseStage
    && contributingCalls[1].innerStage === "extension";
  if (!standalone && !composedExtension) return null;
  if (
    value.outerQualityPhase !== first.outerQualityPhase
    || value.outerRequestIdDigest !== first.outerRequestIdDigest
    || value.outerTaskType !== first.outerTaskType
    || value.requiredManifestDigest !== first.requiredManifestDigest
  ) return null;
  const body = {
    schemaVersion: value.schemaVersion,
    acceptedDisposition: value.acceptedDisposition,
    acceptedStage: value.acceptedStage,
    extensionBaseStage: value.extensionBaseStage,
    executedStages,
    outerQualityPhase: value.outerQualityPhase,
    outerRequestIdDigest: value.outerRequestIdDigest,
    outerTaskType: value.outerTaskType,
    requiredManifestDigest: value.requiredManifestDigest,
    contributingCalls,
    rawTextStored: false,
  };
  if (value.bindingDigest !== sha256Value(stableStringify({
    domain: "browser-final-model-context-attestation-v3",
    body,
  }))) return null;
  return { ...body, bindingDigest: value.bindingDigest };
}

async function sha256File(filePath) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest("hex");
}

function comparableFilesystemPath(value) {
  const normalized = resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function canonicalTemporaryRoot() {
  return realpath(resolve(tmpdir()));
}

async function validatePersistentEdgeProfile(candidate) {
  assert.equal(isAbsolute(candidate), true, "Edge profile path was not absolute");
  assert.equal(resolve(candidate), candidate, "Edge profile path was not exact and normalized");
  assert.equal(PROFILE_NAME.test(basename(candidate)), true, "Edge profile name was not gate-owned");
  const candidateLstat = await lstat(candidate);
  assert.equal(candidateLstat.isDirectory(), true, "Edge profile path was not a directory");
  assert.equal(candidateLstat.isSymbolicLink(), false, "Edge profile path was a symbolic link");
  const [temporaryRoot, canonicalCandidate] = await Promise.all([
    canonicalTemporaryRoot(),
    realpath(candidate),
  ]);
  assert.equal(
    comparableFilesystemPath(dirname(canonicalCandidate)),
    comparableFilesystemPath(temporaryRoot),
    "Edge profile was not an immediate child of the operating-system temporary directory",
  );
  assert.equal(
    comparableFilesystemPath(canonicalCandidate),
    comparableFilesystemPath(candidate),
    "Edge profile path resolved through an alias or reparse target",
  );
  assert.deepEqual(await readdir(canonicalCandidate), [], "fresh Edge profile was not empty before launch");
  return canonicalCandidate;
}

async function preparePersistentEdgeProfile() {
  const configuredProfile = process.env.RC6_2_CLOSED_AI_PROFILE_PATH;
  if (networkSentinelOnly) {
    assert.equal(
      configuredProfile,
      undefined,
      "sentinel-only mode forbids an inherited Edge profile path",
    );
  }
  if (configuredProfile !== undefined) {
    assert.equal(
      configuredProfile.trim(),
      configuredProfile,
      "wrapper-owned Edge profile contained surrounding whitespace",
    );
    assert.notEqual(configuredProfile, "", "wrapper-owned Edge profile was empty");
    return {
      path: await validatePersistentEdgeProfile(configuredProfile),
      ownership: "wrapper-owned",
    };
  }
  const temporaryRoot = await canonicalTemporaryRoot();
  const created = await mkdtemp(join(temporaryRoot, "novel-rc6-2-edge-"));
  try {
    return {
      path: await validatePersistentEdgeProfile(created),
      ownership: "runner-created",
    };
  } catch (error) {
    await rm(created, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function formalAttemptIdentity() {
  return {
    expectedAttemptId: formalAttemptId,
    expectedAuthorizationId: formalAuthorizationId,
    expectedControlCommit: formalControlCommit,
    expectedProductCommit: expectedCommit,
    expectedDeploymentId,
    expectedProductionOrigin: expectedOrigin,
    expectedAuthorizationDigest: formalAuthorizationDigest,
    expectedReleaseTag: formalReleaseTag,
    expectedReleaseRevision: formalReleaseRevision,
    expectedRuntimeReceiptDigest: formalRuntimeReceiptDigest,
    expectedWrapperDigest: formalWrapperDigest,
    expectedRunnerDigest: formalRunnerDigest,
    expectedContractDigest: formalContractDigest,
  };
}

async function waitForFormalRunnerStart() {
  if (!formalAttemptEnabled) return null;
  const lease = await waitForAttemptState({
    attemptDirectory: formalAttemptDirectory,
    state: "RUNNER_STARTED",
    timeoutMs: 30_000,
    pollMs: 50,
    ...formalAttemptIdentity(),
  });
  return lease;
}

function markFormalBrowserStarted(runnerStartedLease) {
  if (!formalAttemptEnabled) return null;
  assert.ok(runnerStartedLease);
  const result = transitionAttempt({
    attemptDirectory: formalAttemptDirectory,
    eventType: "BROWSER_STARTED",
    eventBody: {
      persistentContextEstablished: true,
      networkRoutesInstalled: true,
      productInteractionStarted: false,
    },
    expectedRevision: runnerStartedLease.revision,
    expectedState: "RUNNER_STARTED",
    ...formalAttemptIdentity(),
  });
  assert.equal(result.lease.state, "BROWSER_STARTED");
  assert.equal(result.lease.attemptConsumed, true);
  assert.equal(result.lease.runnerStarted, true);
  assert.equal(result.lease.browserStarted, true);
  return result.lease;
}

async function launch() {
  if (chromiumRuntime === null) ({ chromium: chromiumRuntime } = await import("@playwright/test"));
  edgeExecutablePath = await realpath(configuredEdgeExecutable);
  const executableStat = await stat(edgeExecutablePath);
  assert.equal(executableStat.isFile(), true, "configured Edge executable is not a file");
  assert.equal(
    basename(edgeExecutablePath).toLocaleLowerCase("en-US"),
    "msedge.exe",
    "configured browser is not Microsoft Edge",
  );
  const preparedProfile = await preparePersistentEdgeProfile();
  profilePath = preparedProfile.path;
  profileOwnership = preparedProfile.ownership;
  profilePathDigest = sha256Value(profilePath);
  const launchOptions = {
    executablePath: edgeExecutablePath,
    headless,
    args: [
      "--enable-unsafe-webgpu",
      "--ignore-gpu-blocklist",
      ...(networkSentinelOnly ? [
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-domain-reliability",
        "--disable-features=OptimizationHints,MediaRouter,AutofillServerCommunication",
        "--disable-sync",
        "--metrics-recording-only",
        "--no-default-browser-check",
        "--no-first-run",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      ] : []),
    ],
    locale: "zh-TW",
    viewport: { width: 1440, height: 900 },
    serviceWorkers: "block",
  };
  let persistentContext;
  try {
    persistentContext = await chromiumRuntime.launchPersistentContext(profilePath, launchOptions);
    await persistentContext.routeWebSocket("**/*", routeClosedAiWebSocket);
    contextWebSocketRouteInstalledBeforeNavigation = true;
    await persistentContext.route("**/*", routeClosedAiRequest);
    contextRouteInstalledBeforeNavigation = true;
    persistentContext.on("request", observeClosedAiRequest);
    persistentContext.on("response", observeClosedAiResponse);
    try {
      await commitBrowserStartedOrClose({
        persistentContext,
        transition: () => markFormalBrowserStarted(formalRunnerStartedLease),
      });
    } catch (error) {
      // commitBrowserStartedOrClose owns cleanup when the durable transition fails.
      // Clear this local reference so the outer launch cleanup cannot close it twice.
      persistentContext = null;
      throw error;
    }
    return {
      context: persistentContext,
      browser: persistentContext.browser(),
      evidence: {
        executableName: "msedge.exe",
        executableDigest: await sha256File(edgeExecutablePath),
        persistentContext: true,
        disposableProfile: true,
        profileOwnership,
        profileEntryCountBeforeLaunch: 0,
        profilePathDigest,
        webSocketRouteInstalledBeforeNavigation: contextWebSocketRouteInstalledBeforeNavigation,
      },
    };
  } catch (error) {
    if (persistentContext) {
      try {
        await persistentContext.close();
      } catch {
        throw gateError("RC6_2_FORMAL_BROWSER_START_TRANSITION_CLEANUP_FAILED");
      }
    }
    throw error;
  }
}

function resetPreNavigationSentinelPolicyCounters() {
  sentinelProbeState = null;
  sentinelBootstrapActive = false;
}

async function runPreNavigationNetworkSentinel() {
  let nonce = "";
  let sentinelHeaderValue = NETWORK_SENTINEL_HEADER_VALUE;
  let sentinelBodyValue = NETWORK_SENTINEL_BODY_VALUE;
  let sentinelWebSocketProtocol = NETWORK_SENTINEL_WEBSOCKET_PROTOCOL;
  let tcpConnectionReceiptCount = 0;
  let httpRequestReceiptCount = 0;
  let httpRequestBodyByteCount = 0;
  let webSocketUpgradeReceiptCount = 0;
  let sentinelHeaderReceiptCount = 0;
  let bootstrapReceiverHttpCount = 0;
  let receiverClosed = false;
  let bootstrapConsumedEvidence = false;
  let bootstrapAllowedCountEvidence = 0;
  let bootstrapExceptionDisabledBeforeProbes = false;
  let httpProbeAttemptCount = 0;
  let webSocketProbeAttemptCount = 0;
  let httpRouteObservationCountEvidence = 0;
  let httpRouteBlockedCountEvidence = 0;
  let webSocketRouteObservationCountEvidence = 0;
  let webSocketRouteBlockedCountEvidence = 0;
  let crossOriginClassificationCountEvidence = 0;
  let methodRejectedCountEvidence = 0;
  let bodyRejectedCountEvidence = 0;
  let disallowedWebSocketCountEvidence = 0;
  let operationalErrorCount = 0;
  let pageReturnedToAboutBlank = false;
  let browserContextCount = 0;
  let pageCount = 0;
  let serviceWorkerCount = 0;
  let receiverBaseline = {
    tcpConnectionReceiptCount: 0,
    httpRequestReceiptCount: 0,
    httpRequestBodyByteCount: 0,
    webSocketUpgradeReceiptCount: 0,
  };
  let sentinelHeaderReceiptBaseline = 0;
  let browserProbeResults = {
    httpGetBrowserResult: "not-attempted",
    httpPostBrowserResult: "not-attempted",
    webSocketBrowserResult: "not-attempted",
  };
  const probeRouteRecords = NETWORK_SENTINEL_PROBE_SPECS.map(({ probeId }) => ({
    probeId,
    routeObserved: false,
    routeDecision: "not-observed",
    reasonCodes: [],
  }));
  let probeRouteRecordsEvidence = probeRouteRecords.map((record) => ({
    ...record,
    reasonCodes: [...record.reasonCodes],
  }));
  let pendingRouteActionsSettled = true;
  // Exact finite route-record vocabulary is kept in this lifecycle for source-bound tests:
  // HTTP_GET, HTTP_POST, WEBSOCKET; method-not-allowed, network-classification-blocked,
  // request-body-not-allowed; blocked-by-route.
  let operationalError = null;
  const recordOperationalError = (error) => {
    operationalErrorCount += 1;
    operationalError ??= error;
  };
  let receiver = null;
  const handleReceiverRequest = (request, response) => {
    httpRequestReceiptCount += 1;
    if (
      sentinelHeaderValue !== ""
      && request.headers[NETWORK_SENTINEL_HEADER_NAME] === sentinelHeaderValue
    ) sentinelHeaderReceiptCount += 1;
    request.on("data", (chunk) => { httpRequestBodyByteCount += chunk.length; });
    request.on("end", () => {
      const exactBootstrapRequest = request.method === "GET"
        && request.url === `${NETWORK_SENTINEL_BOOTSTRAP_PREFIX}${nonce}`;
      if (exactBootstrapRequest) bootstrapReceiverHttpCount += 1;
      const body = exactBootstrapRequest
        ? "<!doctype html><meta charset=utf-8><title>network sentinel</title>"
        : "";
      response.writeHead(exactBootstrapRequest ? 200 : 204, {
        "content-type": exactBootstrapRequest ? "text/html; charset=utf-8" : "text/plain",
        "cache-control": "no-store",
        "content-length": Buffer.byteLength(body),
      });
      response.end(body);
    });
  };
  let receiverListening = false;
  let receiverOrigin = "";
  let httpGetUrl = "";
  let httpPostUrl = "";
  let webSocketUrl = "";
  let receiverErrorHandler = null;
  try {
    nonce = randomBytes(16).toString("hex");
    assert.match(nonce, NETWORK_SENTINEL_NONCE);
    receiver = createServer(handleReceiverRequest);
    receiver.on("connection", () => { tcpConnectionReceiptCount += 1; });
    receiver.on("upgrade", (_request, socket) => {
      webSocketUpgradeReceiptCount += 1;
      socket.destroy();
    });
    await new Promise((resolvePromise, rejectPromise) => {
      const onError = (error) => {
        receiver.off("listening", onListening);
        rejectPromise(error);
      };
      const onListening = () => {
        receiver.off("error", onError);
        resolvePromise();
      };
      receiver.once("error", onError);
      receiver.once("listening", onListening);
      receiver.listen(0, "127.0.0.1");
    });
    receiverListening = true;
    receiverErrorHandler = recordOperationalError;
    receiver.on("error", receiverErrorHandler);
    const address = receiver.address();
    assert.ok(address && typeof address === "object");
    receiverOrigin = `http://127.0.0.1:${address.port}`;
    sentinelBootstrapUrl = `${receiverOrigin}${NETWORK_SENTINEL_BOOTSTRAP_PREFIX}${nonce}`;
    sentinelBootstrapActive = true;
    sentinelBootstrapConsumed = false;
    sentinelBootstrapAllowedCount = 0;
    httpGetUrl = `${receiverOrigin}/http-get-probe/${nonce}`;
    httpPostUrl = `${receiverOrigin}/http-post-probe/${nonce}`;
    webSocketUrl = `ws://127.0.0.1:${address.port}/websocket-probe/${nonce}`;
    const bootstrapResponse = await page.goto(sentinelBootstrapUrl, {
      waitUntil: "load",
      timeout: 30_000,
    });
    assert.ok(bootstrapResponse);
    assert.equal(bootstrapResponse.status(), 200);
    assert.equal(page.url(), sentinelBootstrapUrl);
    assert.equal(new URL(page.url()).origin, receiverOrigin);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    receiverBaseline = {
      tcpConnectionReceiptCount,
      httpRequestReceiptCount,
      httpRequestBodyByteCount,
      webSocketUpgradeReceiptCount,
    };
    sentinelHeaderReceiptBaseline = sentinelHeaderReceiptCount;
    if (bootstrapReceiverHttpCount !== 1) {
      recordOperationalError(new assert.AssertionError({
        message: "NETWORK_SENTINEL_BOOTSTRAP_EXACTLY_ONCE",
        actual: bootstrapReceiverHttpCount,
        expected: 1,
        operator: "strictEqual",
      }));
    }
    bootstrapConsumedEvidence = sentinelBootstrapConsumed;
    bootstrapAllowedCountEvidence = sentinelBootstrapAllowedCount;
    sentinelBootstrapActive = false;
    sentinelProbeState = {
      httpGetUrl,
      httpPostUrl,
      webSocketUrl,
      httpRouteObservationCount: 0,
      httpRouteBlockedCount: 0,
      webSocketRouteObservationCount: 0,
      webSocketRouteBlockedCount: 0,
      crossOriginClassificationCount: 0,
      methodRejectedCount: 0,
      bodyRejectedCount: 0,
      disallowedWebSocketCount: 0,
      routeActionErrors: [],
      probeRouteRecords,
    };
    bootstrapExceptionDisabledBeforeProbes = sentinelBootstrapActive === false;
    const settlePendingSentinelRouteActions = async () => {
      if (pendingSentinelRouteActions.size === 0) return;
      let timeoutId;
      const settled = await Promise.race([
        Promise.allSettled([...pendingSentinelRouteActions]).then(() => true),
        new Promise((resolvePromise) => {
          timeoutId = setTimeout(() => resolvePromise(false), 5_000);
        }),
      ]).finally(() => clearTimeout(timeoutId));
      if (!settled) recordOperationalError(gateError("RC6_2_NETWORK_SENTINEL_ROUTE_ACTION_TIMEOUT"));
    };
    const evaluateHttpProbe = async ({ url, method }) => {
      httpProbeAttemptCount += 1;
      try {
        return await page.evaluate(async ({
          probeUrl, probeMethod, headerName, headerValue, bodyValue,
        }) => {
          let timeoutId;
          try {
            const options = {
              method: probeMethod,
              headers: { [headerName]: headerValue },
            };
            if (probeMethod === "POST") {
              options.headers["content-type"] = "text/plain";
              options.body = bodyValue;
            }
            return await Promise.race([
              fetch(probeUrl, options).then(() => "unexpected-success", () => "rejected"),
              new Promise((resolvePromise) => {
                timeoutId = setTimeout(() => resolvePromise("timeout"), 5_000);
              }),
            ]);
          } finally {
            clearTimeout(timeoutId);
          }
        }, {
          probeUrl: url,
          probeMethod: method,
          headerName: NETWORK_SENTINEL_HEADER_NAME,
          headerValue: sentinelHeaderValue,
          bodyValue: sentinelBodyValue,
        });
      } catch (error) {
        recordOperationalError(error);
        return "evaluation-failed";
      } finally {
        await settlePendingSentinelRouteActions();
      }
    };
    const evaluateWebSocketProbe = async () => {
      webSocketProbeAttemptCount += 1;
      try {
        return await page.evaluate(async ({ probeUrl, protocol }) => (
          new Promise((resolvePromise) => {
            const socket = new WebSocket(probeUrl, protocol);
            let settled = false;
            const settle = (value) => {
              if (settled) return;
              settled = true;
              clearTimeout(timeoutId);
              resolvePromise(value);
            };
            const timeoutId = setTimeout(() => settle("timeout"), 5_000);
            socket.addEventListener("open", () => settle("unexpected-success"), { once: true });
            socket.addEventListener("error", () => settle("rejected"), { once: true });
            socket.addEventListener("close", () => settle("rejected"), { once: true });
          })
        ), { probeUrl: webSocketUrl, protocol: sentinelWebSocketProtocol });
      } catch (error) {
        recordOperationalError(error);
        return "evaluation-failed";
      } finally {
        await settlePendingSentinelRouteActions();
      }
    };
    const result = {
      httpGet: await evaluateHttpProbe({ url: httpGetUrl, method: "GET" }),
      httpPost: await evaluateHttpProbe({ url: httpPostUrl, method: "POST" }),
      webSocket: await evaluateWebSocketProbe(),
    };
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    await settlePendingSentinelRouteActions();
    for (const error of sentinelProbeState.routeActionErrors) {
      recordOperationalError(error);
    }
    sentinelProbeState.routeActionErrors.length = 0;
    const browserResult = (raw, record) => new Set(["block-failed", "continue-failed"])
      .has(record.routeDecision)
      ? "route-action-failed"
      : raw === "evaluation-failed"
        ? "evaluation-failed"
        : raw === "unexpected-success"
      ? "unexpected-success"
      : raw === "timeout"
        ? "timeout"
        : record.routeObserved && record.routeDecision === "blocked"
          ? "blocked-by-route"
          : record.routeObserved && record.routeDecision === "continued"
            ? "unexpected-rejection"
            : "native-preblock";
    browserProbeResults = {
      httpGetBrowserResult: browserResult(result.httpGet, probeRouteRecords[0]),
      httpPostBrowserResult: browserResult(result.httpPost, probeRouteRecords[1]),
      webSocketBrowserResult: browserResult(result.webSocket, probeRouteRecords[2]),
    };
  } catch (error) {
    recordOperationalError(error);
  } finally {
    httpRouteObservationCountEvidence = sentinelProbeState?.httpRouteObservationCount ?? 0;
    httpRouteBlockedCountEvidence = sentinelProbeState?.httpRouteBlockedCount ?? 0;
    webSocketRouteObservationCountEvidence = sentinelProbeState?.webSocketRouteObservationCount ?? 0;
    webSocketRouteBlockedCountEvidence = sentinelProbeState?.webSocketRouteBlockedCount ?? 0;
    crossOriginClassificationCountEvidence = sentinelProbeState?.crossOriginClassificationCount ?? 0;
    methodRejectedCountEvidence = sentinelProbeState?.methodRejectedCount ?? 0;
    bodyRejectedCountEvidence = sentinelProbeState?.bodyRejectedCount ?? 0;
    disallowedWebSocketCountEvidence = sentinelProbeState?.disallowedWebSocketCount ?? 0;
    for (const error of sentinelProbeState?.routeActionErrors ?? []) {
      recordOperationalError(error);
    }
    if (sentinelProbeState) sentinelProbeState.routeActionErrors.length = 0;
    pendingRouteActionsSettled = pendingSentinelRouteActions.size === 0;
    if (!pendingRouteActionsSettled) {
      recordOperationalError(gateError("RC6_2_NETWORK_SENTINEL_ROUTE_ACTION_TIMEOUT"));
    }
    probeRouteRecordsEvidence = probeRouteRecords.map((record) => ({
      ...record,
      reasonCodes: [...record.reasonCodes],
    }));
    bootstrapConsumedEvidence ||= sentinelBootstrapConsumed;
    bootstrapAllowedCountEvidence = Math.max(
      bootstrapAllowedCountEvidence,
      sentinelBootstrapAllowedCount,
    );
    sentinelBootstrapActive = false;
    await page.goto("about:blank").catch(recordOperationalError);
    pageReturnedToAboutBlank = page.url() === "about:blank";
    browserContextCount = typeof browser?.contexts === "function" ? browser.contexts().length : 0;
    pageCount = typeof context?.pages === "function" ? context.pages().length : 0;
    serviceWorkerCount = typeof context?.serviceWorkers === "function"
      ? context.serviceWorkers().length
      : 1;
    if (receiverListening && receiver) {
      receiver.closeIdleConnections?.();
      receiver.closeAllConnections?.();
      let closeTimeoutId;
      const closePromise = new Promise((resolvePromise, rejectPromise) => {
        receiver.close((error) => (error ? rejectPromise(error) : resolvePromise()));
      });
      try {
        await Promise.race([
          closePromise,
          new Promise((_, rejectPromise) => {
            closeTimeoutId = setTimeout(
              () => rejectPromise(gateError("RC6_2_NETWORK_SENTINEL_RECEIVER_CLOSE_TIMEOUT")),
              5_000,
            );
          }),
        ]);
        receiverClosed = true;
      } catch (error) {
        receiver.closeAllConnections?.();
        recordOperationalError(error);
        let forcedCloseTimeoutId;
        const forcedClosed = await Promise.race([
          closePromise.then(() => true, () => false),
          new Promise((resolvePromise) => {
            forcedCloseTimeoutId = setTimeout(() => resolvePromise(false), 1_000);
          }),
        ]).finally(() => clearTimeout(forcedCloseTimeoutId));
        receiverClosed = forcedClosed;
      } finally {
        clearTimeout(closeTimeoutId);
      }
    }
    if (receiverErrorHandler && receiver) receiver.off("error", receiverErrorHandler);
    sentinelBootstrapUrl = null;
    sentinelProbeState = null;
    nonce = "";
    httpGetUrl = "";
    httpPostUrl = "";
    webSocketUrl = "";
    sentinelHeaderValue = "";
    sentinelBodyValue = "";
    sentinelWebSocketProtocol = "";
    receiverOrigin = "";
    sentinelBootstrapConsumed = false;
    sentinelBootstrapAllowedCount = 0;
    resetPreNavigationSentinelPolicyCounters();
  }
  const tcpConnectionReceiptDelta = tcpConnectionReceiptCount
    - receiverBaseline.tcpConnectionReceiptCount;
  const httpRequestReceiptDelta = httpRequestReceiptCount
    - receiverBaseline.httpRequestReceiptCount;
  const httpRequestBodyByteDelta = httpRequestBodyByteCount
    - receiverBaseline.httpRequestBodyByteCount;
  const webSocketUpgradeReceiptDelta = webSocketUpgradeReceiptCount
    - receiverBaseline.webSocketUpgradeReceiptCount;
  const sentinelCountersReset = sentinelProbeState === null
    && sentinelBootstrapActive === false
    && sentinelBootstrapConsumed === false
    && sentinelBootstrapAllowedCount === 0
    && pendingRouteActionsSettled
    && pendingSentinelRouteActions.size === 0;
  const productPolicyCountersZero = blockedNetworkPolicyAttemptCount === 0
    && disallowedCrossOriginRequestCount === 0
    && disallowedMethodRequestCount === 0
    && observedWebSocketAttemptCount === 0
    && blockedWebSocketAttemptCount === 0
    && disallowedWebSocketAttemptCount === 0
    && prohibitedExternalAiRequestCount === 0
    && disallowedSameOriginTargetRequestCount === 0
    && disallowedImmutableModelTargetRequestCount === 0
    && blockedNonToolbarResponseCount === 0
    && previewToolbarResponseCount === 0
    && observedPreviewToolbarWebSocketAttemptCount === 0
    && blockedPreviewToolbarWebSocketAttemptCount === 0
    && webSocketServerConnectionCount === 0
    && prohibitedExternalAiRequests.length === 0
    && disallowedCrossOriginRequests.length === 0
    && disallowedSameOriginTargetRequests.length === 0
    && disallowedImmutableModelTargetRequests.length === 0
    && disallowedMethodRequests.length === 0
    && blockedNetworkPolicyAttempts.length === 0
    && blockedNonToolbarResponses.length === 0
    && disallowedWebSocketAttempts.length === 0
    && blockedPreviewToolbarWebSocketAttempts.length === 0
    && observedPreviewToolbarRequests.length === 0
    && previewToolbarResponses.length === 0
    && blockedPreviewToolbarRequests.size === 0
    && immutableModelRootRequests.length === 0
    && approvedModelRedirectRequests.length === 0
    && pendingSentinelRouteActions.size === 0;
  let matrix = finalizeNetworkSentinelMatrix({
    schemaVersion: NETWORK_SENTINEL_SCHEMA,
    status: "FAIL",
    bootstrapAllowedCount: bootstrapAllowedCountEvidence,
    bootstrapReceiverHttpCount,
    bootstrapConsumed: bootstrapConsumedEvidence,
    bootstrapExceptionDisabledBeforeProbes,
    httpProbeAttemptCount,
    httpRouteObservedCount: httpRouteObservationCountEvidence,
    httpRouteBlockedCount: httpRouteBlockedCountEvidence,
    crossOriginClassificationCount: crossOriginClassificationCountEvidence,
    methodRejectedCount: methodRejectedCountEvidence,
    bodyRejectedCount: bodyRejectedCountEvidence,
    webSocketProbeAttemptCount,
    webSocketRouteObservedCount: webSocketRouteObservationCountEvidence,
    webSocketRouteBlockedCount: webSocketRouteBlockedCountEvidence,
    disallowedWebSocketCount: disallowedWebSocketCountEvidence,
    browserNativePreblockCount: Object.values(browserProbeResults)
      .filter((value) => value === "native-preblock").length,
    tcpConnectionReceiptDelta,
    httpRequestReceiptDelta,
    httpRequestBodyByteDelta,
    webSocketUpgradeReceiptDelta,
    arbitraryOutboundHeaderBlocked:
      sentinelHeaderReceiptCount - sentinelHeaderReceiptBaseline === 0,
    requestBodyBlocked: httpRequestBodyByteDelta === 0,
    ...browserProbeResults,
    operationalErrorCount,
    pageReturnedToAboutBlank,
    browserContextCount,
    pageCount,
    serviceWorkerCount,
    receiverClosed,
    bootstrapSecretsCleared: sentinelBootstrapUrl === null
      && nonce === ""
      && httpGetUrl === ""
      && httpPostUrl === ""
      && webSocketUrl === ""
      && sentinelHeaderValue === ""
      && sentinelBodyValue === ""
      && sentinelWebSocketProtocol === "",
    productPolicyCountersZero,
    sentinelCountersReset,
    receiverBaseline,
    probeRouteRecords: probeRouteRecordsEvidence,
    firstFailedScalarAssertion: null,
  });
  return { matrix, operationalError };
}

async function assertExactOrigin() {
  assert.equal(new URL(page.url()).origin, expectedOrigin, "browser was redirected away from the exact gate origin");
}

function assertReleaseIdentityTruth(truth) {
  assert.equal(truth.httpStatus, 200);
  assert.match(truth.cacheControl ?? "", /no-store/u);
  assert.equal(truth.body.appCommit, expectedCommit);
  assert.equal(truth.body.releaseProductCommit, expectedCommit);
  assert.equal(truth.body.deploymentId, expectedDeploymentId);
  assert.equal(truth.body.provenanceStatus, "verified");
  assert.equal(truth.body.deploymentProvenance, "verified");
  assert.equal(truth.body.buildProvenanceStatus, "verified");
  for (const field of [
    "releaseTag",
    "releaseRevision",
    "releaseBuild",
    "environment",
    "provenanceSource",
  ]) {
    assert.ok(String(truth.body[field] ?? "").trim(), `release identity ${field} was empty`);
  }
  assert.notEqual(truth.body.releaseBuild, "provenance-unavailable");
  assert.equal(truth.headers.appCommit, truth.body.appCommit);
  assert.equal(truth.headers.releaseProductCommit, truth.body.releaseProductCommit);
  assert.equal(truth.headers.deploymentId, truth.body.deploymentId);
  assert.equal(truth.headers.releaseRevision, truth.body.releaseRevision);
  assert.equal(truth.headers.releaseBuild, truth.body.releaseBuild);
  assert.equal(truth.headers.deploymentProvenance, truth.body.deploymentProvenance);
}

function safeReleaseIdentity(truth) {
  return {
    appCommit: truth.body.appCommit,
    releaseProductCommit: truth.body.releaseProductCommit,
    deploymentId: truth.body.deploymentId,
    releaseTag: truth.body.releaseTag,
    releaseRevision: truth.body.releaseRevision,
    releaseBuild: truth.body.releaseBuild,
    environment: truth.body.environment,
    provenanceStatus: truth.body.provenanceStatus,
    deploymentProvenance: truth.body.deploymentProvenance,
    buildProvenanceStatus: truth.body.buildProvenanceStatus,
    provenanceSource: truth.body.provenanceSource,
    cacheControl: truth.cacheControl,
  };
}

async function readReleaseIdentityTruth({ navigate = false } = {}) {
  const nonce = crypto.randomUUID();
  let truth;
  if (navigate) {
    const response = await page.goto(
      `${expectedOrigin}/api/release/identity?rc6_2=${encodeURIComponent(nonce)}`,
      { waitUntil: "domcontentloaded", timeout: 90_000 },
    );
    assert.ok(response, "release identity navigation did not return a response");
    truth = {
      httpStatus: response.status(),
      cacheControl: response.headers()["cache-control"] ?? null,
      headers: {
        appCommit: response.headers()["x-novel-app-commit"] ?? null,
        releaseProductCommit: response.headers()["x-novel-release-product-commit"] ?? null,
        releaseRevision: response.headers()["x-novel-release-revision"] ?? null,
        releaseBuild: response.headers()["x-novel-release-build"] ?? null,
        deploymentId: response.headers()["x-novel-deployment-id"] ?? null,
        deploymentProvenance: response.headers()["x-novel-deployment-provenance"] ?? null,
      },
      body: await response.json(),
    };
  } else {
    truth = await page.evaluate(async ({ origin, requestNonce }) => {
      const response = await fetch(
        `${origin}/api/release/identity?rc6_2=${encodeURIComponent(requestNonce)}`,
        { cache: "no-store", credentials: "same-origin" },
      );
      return {
        httpStatus: response.status,
        cacheControl: response.headers.get("cache-control"),
        headers: {
          appCommit: response.headers.get("x-novel-app-commit"),
          releaseProductCommit: response.headers.get("x-novel-release-product-commit"),
          releaseRevision: response.headers.get("x-novel-release-revision"),
          releaseBuild: response.headers.get("x-novel-release-build"),
          deploymentId: response.headers.get("x-novel-deployment-id"),
          deploymentProvenance: response.headers.get("x-novel-deployment-provenance"),
        },
        body: await response.json(),
      };
    }, { origin: expectedOrigin, requestNonce: nonce });
  }
  assertReleaseIdentityTruth(truth);
  return safeReleaseIdentity(truth);
}

async function readFreshStorageTruth() {
  await assertExactOrigin();
  const cookies = await context.cookies();
  const storage = await page.evaluate(async () => ({
    localStorageCount: window.localStorage.length,
    sessionStorageCount: window.sessionStorage.length,
    indexedDatabaseCount: (await indexedDB.databases()).length,
    cacheStorageCount: (await caches.keys()).length,
    serviceWorkerRegistrationCount: "serviceWorker" in navigator
      ? (await navigator.serviceWorker.getRegistrations()).length
      : 0,
  }));
  const evidence = {
    cookieCount: cookies.length,
    ...storage,
    emptyBeforeAppNavigation: true,
  };
  freshStorageAtFailure = evidence;
  for (const [key, value] of Object.entries(evidence)) {
    if (key === "emptyBeforeAppNavigation") continue;
    assert.equal(value, 0, `${key} was not empty before app navigation`);
  }
  return evidence;
}

async function readEdgeIdentity(launchEvidence) {
  edgeCdpSession = await context.newCDPSession(page);
  const version = await edgeCdpSession.send("Browser.getVersion");
  assert.match(version.product ?? "", /^Edg\/[0-9.]+$/u);
  assert.match(version.protocolVersion ?? "", /^[0-9]+\.[0-9]+$/u);
  assert.ok(version.revision?.trim(), "Edge CDP revision was empty");
  assert.match(version.userAgent ?? "", /\bEdg\/[0-9.]+/u);
  const engineVersion = version.product.slice("Edg/".length);
  assert.match(engineVersion, /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/u);
  const versionDirectory = await realpath(join(dirname(edgeExecutablePath), engineVersion));
  assert.equal(
    comparableFilesystemPath(dirname(versionDirectory)),
    comparableFilesystemPath(dirname(edgeExecutablePath)),
    "Edge engine version directory escaped the configured application root",
  );
  assert.equal(basename(versionDirectory), engineVersion);
  const engineDllPath = await realpath(join(versionDirectory, "msedge.dll"));
  const engineDllStat = await stat(engineDllPath);
  assert.equal(engineDllStat.isFile(), true, "Edge engine DLL was not a file");
  assert.equal(
    comparableFilesystemPath(dirname(engineDllPath)),
    comparableFilesystemPath(versionDirectory),
    "Edge engine DLL escaped its exact version directory",
  );
  assert.equal(basename(engineDllPath).toLowerCase(), "msedge.dll");
  return {
    ...launchEvidence,
    product: version.product,
    engineVersionDirectoryName: engineVersion,
    engineDllName: "msedge.dll",
    engineDllDigest: await sha256File(engineDllPath),
    protocolVersion: version.protocolVersion,
    browserRevisionDigest: sha256Value(version.revision ?? ""),
    userAgentProductVerified: true,
  };
}

async function createProject() {
  await page.goto(`${expectedOrigin}/studio/create`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await assertExactOrigin();
  await page.getByTestId("canonical-create-flow").waitFor({
    state: "visible",
    timeout: 90_000,
  });
  await page.getByTestId("p2-project-title").fill(
    `RC6.2 Browser AI Production Gate ${crypto.randomUUID().slice(0, 8)}`,
  );
  await page.getByTestId("create-play-mode-general").click();
  await page.locator(".p2CreationAssistantActions button").first().click();
  await page.locator(".p2FoundationReady").waitFor({ state: "visible", timeout: 90_000 });
  const stepBar = page.locator(".p2StepBar");
  const next = page.locator(".p2CreatePanel > footer button.gold");
  for (let expectedStep = 2; expectedStep <= 3; expectedStep += 1) {
    const previous = await stepBar.getAttribute("aria-label");
    await next.click();
    await page.waitForFunction(
      ({ selector, previousLabel }) => (
        document.querySelector(selector)?.getAttribute("aria-label") !== previousLabel
      ),
      { selector: ".p2StepBar", previousLabel: previous },
    );
    assert.match(await stepBar.getAttribute("aria-label") ?? "", new RegExp(String(expectedStep), "u"));
  }
  await next.click();
  const primary = page.locator(".p2CreateSuccess a.primaryAction");
  await primary.waitFor({ state: "visible", timeout: 90_000 });
  const href = await primary.getAttribute("href");
  assert.match(href ?? "", /^\/studio\/project\/[^/]+\/chat$/u);
  const projectId = href.split("/")[3];
  await primary.click();
  await page.getByTestId("conversation-first-workspace").waitFor({
    state: "visible",
    timeout: 90_000,
  });
  await assertExactOrigin();
  return projectId;
}

async function readStoryBibleEvidence(projectId, requireIsolationWitness = false) {
  return page.evaluate(async ({ id, requireIsolationWitness }) => {
    const stableStringify = (value) => {
      if (value === null || typeof value !== "object") return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
      const entries = Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
      return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
    };
    const sha256 = async (value) => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
      return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    };
    const requestResult = (request) => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onupgradeneeded = () => {
        request.transaction?.abort();
        reject(new Error("RC6_2_STORY_BIBLE_DATABASE_SCHEMA_MISSING"));
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const records = await requestResult(
        database.transaction("storyBibles", "readonly")
          .objectStore("storyBibles").index("projectId").getAll(id),
      );
      const allRecords = await requestResult(
        database.transaction("storyBibles", "readonly")
          .objectStore("storyBibles").getAll(),
      );
      if (records.length !== 1) return null;
      const record = records[0];
      if (
        record.schemaVersion !== "novel-domain-v1"
        || record.projectId !== id
        || !Number.isSafeInteger(record.revision)
        || record.revision < 1
        || (record.deletedAt !== null && record.deletedAt !== undefined)
      ) return null;
      const project = await requestResult(
        database.transaction("projects", "readonly").objectStore("projects").get(id),
      );
      if (!project || project.storyBibleId !== record.id) return null;
      const allProjects = await requestResult(
        database.transaction("projects", "readonly").objectStore("projects").getAll(),
      );
      const observedOtherProjectCount = allProjects.filter((candidate) => candidate?.id !== id).length;
      const observedOtherStoryBibleCount = allRecords
        .filter((candidate) => candidate?.projectId !== id).length;
      if (requireIsolationWitness
          && (observedOtherProjectCount < 1 || observedOtherStoryBibleCount < 1)) return null;
      const fields = [
        "theme",
        "style",
        "protagonistIds",
        "characterIds",
        "relationshipIds",
        "worldId",
        "worldRuleIds",
        "loreIds",
        "timelineEventIds",
        "foreshadowing",
        "unresolvedThreads",
        "forbiddenContradictions",
        "authorPreferences",
        "revision",
      ];
      const recordValue = (candidate) => Object.fromEntries(fields
        .map((field) => {
          const fieldValue = candidate[field];
          const presented = fieldValue
            && typeof fieldValue === "object"
            && "status" in fieldValue
            && "value" in fieldValue
            ? fieldValue.value ?? null
            : fieldValue;
          return [field, presented];
        })
        .filter(([, fieldValue]) => (
          fieldValue !== null
          && fieldValue !== undefined
          && fieldValue !== ""
          && (!Array.isArray(fieldValue) || fieldValue.length > 0)
        )));
      const value = recordValue(record);
      const crossProjectLeakCount = allRecords.filter((candidate) => (
        candidate?.projectId !== id && candidate?.id === record.id
      )).length + allProjects.filter((candidate) => (
        candidate?.id !== id && candidate?.storyBibleId === record.id
      )).length;
      const sourceArtifactDigest = await sha256(stableStringify({
        domain: "approved-story-bible-source-artifact-v1",
        value,
      }));
      const sourceRevisionDigest = await sha256(stableStringify({
        domain: "approved-story-bible-source-revision-v1",
        store: "storyBibles",
        schemaVersion: record.schemaVersion,
        id: record.id,
        projectId: record.projectId,
        revision: record.revision,
        sourceArtifactDigest,
      }));
      const serializedSource = [
        "[story-bible]",
        "[APPROVED_STORY_BIBLE]",
        stableStringify(value),
      ].join("\n");
      return {
        recordId: record.id,
        revision: record.revision,
        originalDigest: await sha256(serializedSource),
        sourceArtifactDigest,
        sourceRevisionDigest,
        serializedSource,
        crossProjectLeakCount,
        observedOtherProjectCount,
        observedOtherStoryBibleCount,
      };
    } finally {
      database.close();
    }
  }, { id: projectId, requireIsolationWitness });
}

async function createApprovedStoryBible(projectId, { requireIsolationWitness = false } = {}) {
  const marker = crypto.randomUUID().slice(0, 8);
  const values = {
    theme: `雨夜追索與承諾 ${marker}`,
    style: "第三人稱限知、繁體中文、具體場景敘事",
    foreshadowing: "舊懷錶停在午夜十二點",
    unresolved: "主角尚未知道匿名信的寄件者",
    contradictions: "主角不得無故知道未曾目擊的事件",
    preferences: "以可見行動推進，不以摘要取代場景",
  };
  Object.values(values).forEach(registerSensitiveEvidenceSentinel);
  await page.goto(`${expectedOrigin}/studio/project/${encodeURIComponent(projectId)}/story-bible`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await assertExactOrigin();
  await page.getByTestId("story-bible-editor").waitFor({ state: "visible", timeout: 90_000 });
  const record = page.getByTestId("story-bible-record");
  const previousRevision = await record.count()
    ? Number(await record.getAttribute("data-revision"))
    : -1;
  await page.getByTestId("story-bible-theme").fill(values.theme);
  await page.getByTestId("story-bible-style").fill(values.style);
  await page.getByTestId("story-bible-foreshadowing").fill(values.foreshadowing);
  await page.getByTestId("story-bible-unresolved").fill(values.unresolved);
  await page.getByTestId("story-bible-contradictions").fill(values.contradictions);
  await page.getByTestId("story-bible-preferences").fill(values.preferences);
  await page.getByTestId("story-bible-save").click();
  await page.waitForFunction((prior) => {
    const saved = document.querySelector('[data-testid="story-bible-record"]');
    return saved && Number(saved.getAttribute("data-revision")) > prior;
  }, previousRevision, { timeout: 90_000 });
  const savedRevision = Number(await record.getAttribute("data-revision"));
  const recordId = await record.getAttribute("data-record-id");
  assert.ok(recordId);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByTestId("story-bible-editor").waitFor({ state: "visible", timeout: 90_000 });
  await page.waitForFunction((expected) => (
    document.querySelector('[data-testid="story-bible-theme"]')?.value === expected.theme
    && document.querySelector('[data-testid="story-bible-style"]')?.value === expected.style
    && document.querySelector('[data-testid="story-bible-foreshadowing"]')?.value === expected.foreshadowing
    && document.querySelector('[data-testid="story-bible-unresolved"]')?.value === expected.unresolved
    && document.querySelector('[data-testid="story-bible-contradictions"]')?.value === expected.contradictions
    && document.querySelector('[data-testid="story-bible-preferences"]')?.value === expected.preferences
  ), values, { timeout: 90_000 });
  const reloadedRevision = Number(
    await page.getByTestId("story-bible-record").getAttribute("data-revision"),
  );
  const reloadedRecordId = await page.getByTestId("story-bible-record")
    .getAttribute("data-record-id");
  assert.equal(reloadedRevision, savedRevision);
  assert.equal(reloadedRecordId, recordId);
  const persisted = await readStoryBibleEvidence(projectId, requireIsolationWitness);
  assert.ok(persisted);
  assert.equal(persisted.recordId, recordId);
  assert.equal(persisted.revision, savedRevision);
  const serializedSource = persisted.serializedSource;
  assert.equal(persisted.originalDigest, sha256Value(serializedSource));
  assert.equal(
    serializedSource.startsWith("[story-bible]\n[APPROVED_STORY_BIBLE]\n{"),
    true,
  );
  for (const value of Object.values(values)) assert.equal(serializedSource.includes(value), true);
  assert.match(persisted.sourceArtifactDigest, /^[a-f0-9]{64}$/u);
  assert.match(persisted.sourceRevisionDigest, /^[a-f0-9]{64}$/u);
  const persistedAfterReload = reloadedRevision === savedRevision
    && reloadedRecordId === recordId
    && persisted.recordId === recordId
    && persisted.revision === savedRevision;
  assert.equal(persistedAfterReload, true);
  await page.goto(`${expectedOrigin}/studio/project/${encodeURIComponent(projectId)}/chat`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.getByTestId("conversation-first-workspace").waitFor({ state: "visible", timeout: 90_000 });
  await assertExactOrigin();
  const { serializedSource: _serializedSource, ...persistedEvidence } = persisted;
  void _serializedSource;
  const evidence = {
    ...persistedEvidence,
    sourceMetadataDigest: finalContextSourceMetadataDigest({
      sourceKind: "approved-story-bible",
      authority: "composer-repository-verified",
      sourceArtifactDigest: persisted.sourceArtifactDigest,
      sourceRevisionDigest: persisted.sourceRevisionDigest,
    }),
    sourceIdDigest: finalContextSourceIdDigest(
      `story-bible:${persisted.recordId}`,
      "approved-story-bible",
    ),
    persistedAfterReload,
    uiInputDigest: sha256Value(JSON.stringify(values)),
  };
  Object.defineProperty(evidence, "runnerFinalContext", {
    enumerable: false,
    value: {
      outerKind: "story-bible",
      serializedSource,
      substantivePrefix:
        "[story-bible]\n[story-bible]\n[APPROVED_STORY_BIBLE]\n{",
    },
  });
  runnerStoryBibleReached = true;
  return evidence;
}

function parseSourceStringArray(source, constantName) {
  const escaped = constantName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(
    `export const ${escaped} = \\[([\\s\\S]*?)\\] as const;`,
    "u",
  ).exec(source);
  assert.ok(match, `persistence contract array missing: ${constantName}`);
  const values = [...match[1].matchAll(/"([A-Za-z][A-Za-z0-9]{0,63})"/gu)]
    .map((entry) => entry[1]);
  assert.ok(values.length > 0, `persistence contract array empty: ${constantName}`);
  assert.equal(new Set(values).size, values.length);
  return values;
}

async function readPersistenceContractTruth() {
  const [contractsSource, characterSource, indexedDbSource, recoverySource] = await Promise.all([
    readFile(join(repositoryRoot, "lib/novel-ai/repository/contracts/index.ts"), "utf8"),
    readFile(join(repositoryRoot, "lib/novel-ai/character-agent/repository.ts"), "utf8"),
    readFile(join(repositoryRoot, "lib/novel-ai/repository/indexeddb/indexeddb-repository.ts"), "utf8"),
    readFile(join(repositoryRoot, "lib/novel-ai/repository/persistence-recovery.ts"), "utf8"),
  ]);
  const versionMatch = /export const INDEXEDDB_DATABASE_VERSION = ([1-9][0-9]{0,3});/u
    .exec(recoverySource);
  assert.ok(versionMatch, "persistence database version contract missing");
  const requestStoreMatch = /const REQUEST_STORE = "([A-Za-z][A-Za-z0-9]{0,63})";/u
    .exec(indexedDbSource);
  assert.ok(requestStoreMatch, "persistence request store contract missing");
  const stores = [...new Set([
    ...parseSourceStringArray(contractsSource, "LEGACY_NOVEL_STORES"),
    ...parseSourceStringArray(contractsSource, "DRAMA_STORES"),
    ...parseSourceStringArray(characterSource, "CHARACTER_AGENT_STORE_NAMES"),
    ...parseSourceStringArray(contractsSource, "CONVERSATION_STORES"),
    ...parseSourceStringArray(contractsSource, "RPG_V3_STORES"),
    requestStoreMatch[1],
  ])].sort();
  return {
    databaseVersion: Number(versionMatch[1]),
    stores,
  };
}

async function readFormalPersistenceTruth(projectId, storyBible, persistenceContract) {
  const { databaseVersion, stores: requiredStores } = persistenceContract;
  assert.ok(Number.isSafeInteger(databaseVersion));
  assert.ok(Array.isArray(requiredStores));
  assert.ok(requiredStores.length > 0);
  assert.deepEqual(requiredStores, [...new Set(requiredStores)].sort());
  const runtimeTruth = await page.getByTestId("project-indexeddb-runtime").evaluate((element) => ({
    backend: element.getAttribute("data-persistence-backend"),
    degraded: element.getAttribute("data-persistence-degraded"),
    memoryFallback: element.getAttribute("data-memory-fallback"),
  }));
  const storageTruth = await page.evaluate(async ({ id, requiredStores }) => {
    const requestResult = (request) => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onupgradeneeded = () => {
        request.transaction?.abort();
        reject(new Error("RC6_2_FORMAL_PERSISTENCE_DATABASE_MISSING"));
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const probeId = `rc6-2-formal-persistence-${crypto.randomUUID()}`;
    const probe = {
      id: probeId,
      projectId: id,
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      const actualStores = [...database.objectStoreNames].sort();
      const missingStores = requiredStores.filter((store) => !actualStores.includes(store));
      const project = await requestResult(
        database.transaction("projects", "readonly").objectStore("projects").get(id),
      );
      const storyBibles = await requestResult(
        database.transaction("storyBibles", "readonly")
          .objectStore("storyBibles").index("projectId").getAll(id),
      );
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("settings", "readwrite");
        transaction.objectStore("settings").put(probe);
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
      const persistedProbe = await requestResult(
        database.transaction("settings", "readonly").objectStore("settings").get(probeId),
      );
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("settings", "readwrite");
        transaction.objectStore("settings").delete(probeId);
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
      const removedProbe = await requestResult(
        database.transaction("settings", "readonly").objectStore("settings").get(probeId),
      );
      return {
        databaseName: database.name,
        databaseVersion: database.version,
        missingStores,
        actualStoreCount: actualStores.length,
        projectRecordVerified: project?.id === id,
        storyBibleRecordVerified: storyBibles.length === 1
          && storyBibles[0]?.id === project?.storyBibleId,
        writeProbeVerified: persistedProbe?.id === probeId && removedProbe === undefined,
      };
    } finally {
      database.close();
    }
  }, { id: projectId, requiredStores });
  assert.deepEqual(runtimeTruth, {
    backend: "indexeddb",
    degraded: "false",
    memoryFallback: "false",
  });
  assert.equal(storageTruth.databaseName, "novel-intelligence-platform");
  assert.equal(storageTruth.databaseVersion, databaseVersion);
  assert.deepEqual(storageTruth.missingStores, []);
  assert.equal(storageTruth.actualStoreCount, requiredStores.length);
  assert.equal(storageTruth.projectRecordVerified, true);
  assert.equal(storageTruth.storyBibleRecordVerified, true);
  assert.equal(storageTruth.writeProbeVerified, true);
  assert.equal(storyBible.persistedAfterReload, true);
  return {
    backend: runtimeTruth.backend,
    degraded: runtimeTruth.degraded === "true",
    databaseName: storageTruth.databaseName,
    requiredStoresVerified: storageTruth.missingStores.length === 0
      && storageTruth.actualStoreCount === requiredStores.length,
    writeVerified: storageTruth.writeProbeVerified && storageTruth.storyBibleRecordVerified,
    reloadVerified: storyBible.persistedAfterReload,
    memoryFallbackUsed: runtimeTruth.memoryFallback === "true",
  };
}

async function waitUntilNotBusy(locator, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await locator.getAttribute("aria-busy") === "false") return;
    await page.waitForTimeout(250);
  }
  throw gateError("RC6_2_CLOSED_AI_UI_BUSY_TIMEOUT");
}

async function readSanitizedQualityCodes() {
  return sanitizeDiagnosticCodes(authoritativeFailureEvidence?.diagnosticCodes ?? []);
}

async function readSanitizedBrowserRuntimeEvidence() {
  return sanitizeBrowserRuntimeEvidence(
    authoritativeFailureEvidence?.browserRuntimeEvidence ?? [],
  );
}

async function assertProductFailureEvidenceDom(invocation, serialized) {
  const expected = {
    invocationId: invocation.id,
    taskId: invocation.taskId,
    schemaVersion: FAILURE_EVIDENCE_SCHEMA_VERSION,
    serialized,
  };
  await page.waitForFunction((value) => {
    const timeline = document.querySelector('[data-testid="conversation-message-timeline"]');
    const composer = document.querySelector('[data-testid="conversation-message-composer"]');
    if (!timeline || composer?.getAttribute("aria-busy") !== "false") return false;
    const matches = [...timeline.querySelectorAll(
      '[data-testid="conversation-closed-agent-failure-evidence"]',
    )].filter((node) => (
      node.getAttribute("data-invocation-id") === value.invocationId
      && node.getAttribute("data-task-id") === value.taskId
      && node.getAttribute("data-failure-evidence-schema") === value.schemaVersion
      && node.getAttribute("data-failure-evidence") === value.serialized
    ));
    return matches.length === 1
      && matches[0].getAttribute("role") === "alert"
      && !matches[0].hidden;
  }, expected, { timeout: 30_000 });
  const values = await page.evaluate((value) => {
    const timeline = document.querySelector('[data-testid="conversation-message-timeline"]');
    return [...(timeline?.querySelectorAll(
      '[data-testid="conversation-closed-agent-failure-evidence"]',
    ) ?? [])].filter((node) => (
      node.getAttribute("data-invocation-id") === value.invocationId
      && node.getAttribute("data-task-id") === value.taskId
    )).map((node) => node.getAttribute("data-failure-evidence"));
  }, expected);
  assert.deepEqual(values, [serialized]);
  assert.deepEqual(parsePersistedFailureEvidence(values[0]), invocation.failureEvidence);
}

async function assertMaliciousDomDiagnosticsAreRejected() {
  await page.evaluate(async (schemaVersion) => {
    const arbitraryStatus = document.createElement("div");
    arbitraryStatus.hidden = true;
    arbitraryStatus.setAttribute("role", "status");
    arbitraryStatus.textContent = "private prompt and output QUALITY_EMPTY_CANDIDATE BROWSER_RUNTIME_EVIDENCE:initial:stop:12:30:30:20";
    const nearMatch = document.createElement("div");
    nearMatch.hidden = true;
    nearMatch.setAttribute("role", "alert");
    nearMatch.setAttribute("data-testid", "conversation-closed-agent-failure-evidence");
    nearMatch.setAttribute("data-failure-evidence-schema", `${schemaVersion}-attacker`);
    nearMatch.setAttribute("data-failure-evidence", JSON.stringify({
      schemaVersion,
      safeCode: "BROWSER_AI_QUALITY_INSUFFICIENT",
      diagnosticCodes: ["QUALITY_EMPTY_CANDIDATE"],
      browserRuntimeEvidence: [{
        stage: "initial",
        finishReason: "stop",
        completionTokens: 12,
        rawOutputCharacters: 30,
        normalizedOutputCharacters: 30,
        observedHanCharacters: 20,
      }],
    }));
    nearMatch.setAttribute("data-invocation-id", "attacker-invocation");
    nearMatch.setAttribute("data-task-id", "attacker-task");
    document.body.append(arbitraryStatus, nearMatch);
    await new Promise((resolve) => setTimeout(resolve, 0));
    arbitraryStatus.remove();
    nearMatch.remove();
  }, FAILURE_EVIDENCE_SCHEMA_VERSION);
  assert.equal(authoritativeFailureEvidence, null);
  assert.deepEqual(await readSanitizedQualityCodes(), []);
  assert.deepEqual(await readSanitizedBrowserRuntimeEvidence(), []);
}

async function inspectFreshSetup() {
  const card = page.getByTestId("closed-ai-setup-card");
  await card.waitFor({ state: "visible", timeout: 90_000 });
  await waitUntilNotBusy(card);
  assert.equal(await card.getAttribute("data-status"), "setup_required");
  const text = await card.textContent() ?? "";
  assert.match(text, /Qwen2\.5 0\.5B/u);
  assert.match(text, /約 294\.5 MB 本機儲存（十進位 MB）/u);
  assert.equal(await card.getAttribute("data-estimated-download-bytes"), "294543984");
  assert.match(text, /此瀏覽器／此裝置/u);
  assert.match(text, /作品資料不離開裝置/u);
  assert.match(text, /改用 Local Ollama/u);
  assert.match(text, /連接 Private AI Hub/u);
  assert.equal(modelAssetRequestCount(), 0, "fresh inspection triggered an automatic model download");
  return {
    status: "setup_required",
    model: "Qwen2.5 0.5B",
    estimatedDownloadBytes: 294_543_984,
    estimatedDownloadMB: 294.5,
    automaticModelRequests: 0,
    explicitAction: "closed-ai-prepare-browser",
  };
}

async function waitForBrowserAiReady(card) {
  const startedAt = Date.now();
  let nextHeartbeat = startedAt + 30_000;
  while (Date.now() - startedAt < setupTimeoutMs) {
    if (await card.count() === 0 || !(await card.isVisible().catch(() => false))) return;
    const busy = await card.getAttribute("aria-busy");
    const retry = await card.getByTestId("closed-ai-prepare-browser").textContent().catch(() => "");
    if (busy === "false" && /重試/u.test(retry ?? "")) {
      throw gateError("RC6_2_CLOSED_AI_SETUP_FAILED");
    }
    if (Date.now() >= nextHeartbeat) {
      process.stderr.write(`[RC6.2 Closed AI] setup in progress (${Math.round((Date.now() - startedAt) / 1_000)}s)\n`);
      nextHeartbeat += 30_000;
    }
    await page.waitForTimeout(1_000);
  }
  throw gateError("RC6_2_CLOSED_AI_SETUP_TIMEOUT");
}

async function readModelMetadata() {
  return page.evaluate(async () => {
    const databaseNames = (await indexedDB.databases()).map((database) => database.name);
    if (!databaseNames.includes("novel-browser-webllm-v1")) return null;
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-browser-webllm-v1");
      request.onupgradeneeded = () => {
        request.transaction?.abort();
        reject(new Error("RC6_2_BROWSER_MODEL_DATABASE_SCHEMA_MISSING"));
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const records = await new Promise((resolve, reject) => {
        const request = database.transaction("runtime-records", "readonly")
          .objectStore("runtime-records").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const selected = records.find((record) => record.kind === "setting" && record.key === "selected-model");
      const model = records.find((record) => record.kind === "model" && record.modelId === selected?.modelId);
      const safeInteger = (value) => (
        Number.isSafeInteger(value) && value >= 0 ? value : null
      );
      const sha256Digest = (value) => (
        typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) ? value : null
      );
      return model ? {
        modelDigest: sha256Digest(model.modelDigest),
        installStatus: ["not_installed", "installing", "ready", "error"].includes(model.installStatus)
          ? model.installStatus
          : null,
        cacheVerified: typeof model.cacheVerified === "boolean" ? model.cacheVerified : null,
        shardIntegrityVerified: typeof model.shardIntegrityVerified === "boolean"
          ? model.shardIntegrityVerified
          : null,
        shardManifestDigest: model.shardManifestDigest === null
          ? null
          : sha256Digest(model.shardManifestDigest),
        verifiedShardCount: safeInteger(model.verifiedShardCount),
        generationCount: safeInteger(model.generationCount ?? 0),
      } : null;
    } finally {
      database.close();
    }
  });
}

async function readChapterTruth(projectId) {
  return page.evaluate(async (id) => {
    const requestResult = (request) => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const project = await requestResult(
        database.transaction("projects", "readonly").objectStore("projects").get(id),
      );
      const chapter = await requestResult(
        database.transaction("chapters", "readonly").objectStore("chapters").get(project.activeChapterId),
      );
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(chapter.content ?? ""),
      );
      return {
        chapterId: chapter.id,
        revision: chapter.revision,
        contentDigest: [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join(""),
      };
    } finally {
      database.close();
    }
  }, projectId);
}

async function readRightsGateExecutionCounts(projectId) {
  const persistentCounts = await page.evaluate(async (id) => {
    const names = new Set((await indexedDB.databases()).map((database) => database.name));
    const requestResult = (request) => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const openExisting = (name) => new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => {
        request.transaction?.abort();
        reject(new Error(`RC6_2_REQUIRED_DATABASE_MISSING:${name}`));
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const counts = {
      attachmentRecords: 0,
      conversationMessages: 0,
      toolInvocations: 0,
      artifacts: 0,
      closedCandidates: 0,
      browserExecutionReceipts: 0,
    };
    if (names.has("novel-intelligence-platform")) {
      const database = await openExisting("novel-intelligence-platform");
      try {
        for (const [store, key] of [
          ["conversationAttachments", "attachmentRecords"],
          ["conversationMessages", "conversationMessages"],
          ["conversationToolInvocations", "toolInvocations"],
          ["conversationArtifacts", "artifacts"],
        ]) {
          const records = await requestResult(
            database.transaction(store, "readonly").objectStore(store).getAll(),
          );
          counts[key] = records.filter((record) => record.projectId === id).length;
        }
      } finally {
        database.close();
      }
    }
    if (names.has("novel-closed-agent-state")) {
      const database = await openExisting("novel-closed-agent-state");
      try {
        const records = await requestResult(
          database.transaction("records", "readonly").objectStore("records").getAll(),
        );
        counts.closedCandidates = records.filter((record) => (
          record.kind === "candidate" && record.projectId === id
        )).length;
      } finally {
        database.close();
      }
    }
    if (names.has("novel-browser-offload-metrics-v1")) {
      const database = await openExisting("novel-browser-offload-metrics-v1");
      try {
        counts.browserExecutionReceipts = await requestResult(
          database.transaction("execution-receipts", "readonly")
            .objectStore("execution-receipts").count(),
        );
      } finally {
        database.close();
      }
    }
    return counts;
  }, projectId);
  const modelMetadata = await readModelMetadata();
  return {
    ...persistentCounts,
    modelGenerationCount: modelMetadata?.generationCount ?? 0,
    modelPayloadRequestCount: modelAssetRequestCount(),
  };
}

async function readCandidateEvidence(projectId, candidateId = null, taskId = null) {
  const evidence = await page.evaluate(async ({ id, candidateId: exactCandidateId, taskId: exactTaskId }) => {
    const stableStringify = (value) => {
      if (value === null || typeof value !== "object") return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
      const entries = Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
      return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
    };
    const sha256 = async (value) => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
      return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    };
    const requestResult = (request) => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const databaseNames = (await indexedDB.databases()).map((database) => database.name);
    if (
      !databaseNames.includes("novel-closed-agent-state")
      || !databaseNames.includes("novel-intelligence-platform")
      || !databaseNames.includes("novel-browser-offload-metrics-v1")
    ) return null;
    const open = (name) => new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => {
        request.transaction?.abort();
        reject(new Error(`RC6_2_REQUIRED_DATABASE_MISSING:${name}`));
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const closedDatabase = await open("novel-closed-agent-state");
    const appDatabase = await open("novel-intelligence-platform");
    const offloadDatabase = await open("novel-browser-offload-metrics-v1");
    try {
      const records = await requestResult(
        closedDatabase.transaction("records", "readonly")
          .objectStore("records").index("projectId").getAll(id),
      );
      const candidates = records
        .filter((record) => record.kind === "candidate")
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      const candidate = exactCandidateId
        ? candidates.find((record) => record.id === exactCandidateId) ?? null
        : exactTaskId
          ? candidates.find((record) => record.taskId === exactTaskId) ?? null
          : candidates[0] ?? null;
      if (!candidate) return null;
      const contentDigestVerified = candidate.contentDigest === await sha256(candidate.content);
      const normalizedContentDigest = [...new Uint8Array(await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(candidate.content.normalize("NFKC")),
      ))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const invocations = (await requestResult(
        appDatabase.transaction("conversationToolInvocations", "readonly")
          .objectStore("conversationToolInvocations").getAll(),
      )).filter((record) => record.projectId === id);
      const invocation = invocations.find((record) => record.taskId === candidate.taskId) ?? null;
      const message = invocation
        ? await requestResult(
            appDatabase.transaction("conversationMessages", "readonly")
              .objectStore("conversationMessages").get(invocation.messageId),
          )
        : null;
      const artifacts = (await requestResult(
        appDatabase.transaction("conversationArtifacts", "readonly")
          .objectStore("conversationArtifacts").getAll(),
      )).filter((record) => record.projectId === id);
       const artifact = artifacts.find(
         (record) => record.sourceMessageId === invocation?.messageId,
       ) ?? null;
      const computeReceipts = await requestResult(
        offloadDatabase.transaction("execution-receipts", "readonly")
          .objectStore("execution-receipts").getAll(),
      );
      const computeReceipt = computeReceipts.find(
        (record) => record.receiptId === candidate.generationTelemetry?.browserComputeReceiptId,
      ) ?? null;
      let computeReceiptIntegrityVerified = false;
      if (computeReceipt?.schemaVersion === "browser-execution-receipt-v3") {
        const { receiptId, ...body } = computeReceipt;
        computeReceiptIntegrityVerified = receiptId === await sha256(stableStringify({
          domain: "browser-execution-receipt-v3",
          body,
        }));
      }
      return {
        projectId: id,
        candidate: {
          id: candidate.id,
          taskId: candidate.taskId,
          backendId: candidate.backendId,
          actualExecutor: candidate.actualExecutor,
          modelId: candidate.modelId,
          modelDigest: candidate.modelDigest,
          contentDigest: candidate.contentDigest,
          contentDigestVerified,
          normalizedContentDigest,
          status: candidate.status,
          candidateOnly: candidate.candidateOnly,
          canonicalMutationCount: candidate.canonicalMutationCount,
          externalRequest: candidate.externalRequest,
          dataLeftDevice: candidate.dataLeftDevice,
          qualityMode: candidate.generationTelemetry?.qualityMode ?? null,
          qualityPasses: candidate.generationTelemetry?.qualityPasses ?? null,
          regeneration: candidate.regeneration ?? null,
          executionReceipt: candidate.executionReceipt ? {
            receiptKeys: Object.keys(candidate.executionReceipt).sort(),
            taskId: candidate.executionReceipt.taskId,
            backendId: candidate.executionReceipt.backendId,
            actualExecutor: candidate.executionReceipt.actualExecutor,
            modelId: candidate.executionReceipt.modelId,
            modelDigest: candidate.executionReceipt.modelDigest,
            proofState: candidate.executionReceipt.proofState,
            contentDigest: candidate.executionReceipt.contentDigest,
            contextDigest: candidate.executionReceipt.contextDigest,
            externalRequest: candidate.executionReceipt.externalRequest,
            dataLeftDevice: candidate.executionReceipt.dataLeftDevice,
            browserComputeReceiptId: candidate.executionReceipt.browserComputeReceiptId,
            browserFabricReceiptId: candidate.executionReceipt.browserFabricReceiptId,
            contextAttestation: candidate.executionReceipt.contextAttestation ?? null,
            finalModelContextAttestationState:
              candidate.executionReceipt.finalModelContextAttestation === undefined
                ? "absent"
                : candidate.executionReceipt.finalModelContextAttestation === null
                  ? "null"
                  : "present",
            finalModelContextAttestation:
              candidate.executionReceipt.finalModelContextAttestation ?? null,
          } : null,
        },
        invocation: invocation ? {
          id: invocation.id,
          messageId: invocation.messageId,
          taskId: invocation.taskId,
          taskType: invocation.taskType,
          status: invocation.status,
          actualExecutor: invocation.actualExecutor,
          modelId: invocation.modelId,
          modelDigest: invocation.modelDigest,
          contextDigest: invocation.contextDigest,
          externalRequest: invocation.externalRequest,
          dataLeftDevice: invocation.dataLeftDevice,
          canonicalMutationCount: invocation.canonicalMutationCount,
          executionReceipt: invocation.executionReceipt ? {
            providerRunId: invocation.executionReceipt.providerRunId,
            outputDigest: invocation.executionReceipt.outputDigest,
            modelId: invocation.executionReceipt.modelId,
            modelDigest: invocation.executionReceipt.modelDigest,
            externalRequest: invocation.executionReceipt.externalRequest,
            dataLeftDevice: invocation.executionReceipt.dataLeftDevice,
          } : null,
        } : null,
        message: message ? {
          id: message.id,
          role: message.role,
          status: message.status,
          candidateLinked: Array.isArray(message.candidateIds)
            && message.candidateIds.includes(candidate.id),
          invocationLinked: Array.isArray(message.toolInvocationIds)
            && message.toolInvocationIds.includes(invocation.id),
        } : null,
        artifact: artifact ? {
          id: artifact.id,
          sourceMessageId: artifact.sourceMessageId,
          status: artifact.status,
          candidateDigest: artifact.candidateDigest,
          targetStore: artifact.targetStore,
          targetRecordId: artifact.targetRecordId,
          sourceRevision: artifact.sourceRevision,
        } : null,
        browserComputeReceipt: computeReceipt ? {
          receiptKeys: Object.keys(computeReceipt).sort(),
          schemaVersion: computeReceipt.schemaVersion,
          receiptId: computeReceipt.receiptId,
          taskDigest: computeReceipt.taskDigest,
          taskType: computeReceipt.taskType,
          actualExecutor: computeReceipt.actualExecutor,
          modelId: computeReceipt.modelId,
          modelDigest: computeReceipt.modelDigest,
          browserGenerationUsed: computeReceipt.browserGenerationUsed,
          externalAIUsed: computeReceipt.externalAIUsed,
          dataLeftDevice: computeReceipt.dataLeftDevice,
          candidateOnly: computeReceipt.candidateOnly,
          canonicalMutationCount: computeReceipt.canonicalMutationCount,
          rawPromptStored: computeReceipt.rawPromptStored,
          rawOutputStored: computeReceipt.rawOutputStored,
          rawChainOfThoughtStored: computeReceipt.rawChainOfThoughtStored,
          contextAttestation: computeReceipt.contextAttestation ?? null,
          finalModelContextAttestationState:
            computeReceipt.finalModelContextAttestation === undefined
              ? "absent"
              : computeReceipt.finalModelContextAttestation === null
                ? "null"
                : "present",
          outerRequestIdDigest: computeReceipt.outerRequestIdDigest ?? null,
          finalModelContextAttestation:
            computeReceipt.finalModelContextAttestation ?? null,
          receiptIntegrityVerified: computeReceiptIntegrityVerified,
        } : null,
        candidateCount: candidates.length,
      };
    } finally {
      closedDatabase.close();
      appDatabase.close();
      offloadDatabase.close();
    }
  }, { id: projectId, candidateId, taskId });
  if (!evidence) return null;
  if (evidence.candidate.executionReceipt) {
    evidence.candidate.executionReceipt.finalModelContextAttestation =
      sanitizeFinalModelContextAttestation(
        evidence.candidate.executionReceipt.finalModelContextAttestation,
      );
  }
  if (evidence.browserComputeReceipt) {
    evidence.browserComputeReceipt.finalModelContextAttestation =
      sanitizeFinalModelContextAttestation(
        evidence.browserComputeReceipt.finalModelContextAttestation,
      );
  }
  return evidence;
}

function assertCandidateTruth(evidence, expected = {}) {
  assert.ok(evidence?.candidate);
  assert.equal(evidence.candidate.backendId, "browser-ai");
  assert.equal(evidence.candidate.actualExecutor, "browser-ai");
  assert.match(evidence.candidate.modelId, /^Qwen2\.5-0\.5B-/u);
  assert.match(evidence.candidate.modelDigest, /^[a-f0-9]{64}$/u);
  assert.equal(evidence.candidate.status, expected.status ?? "awaiting-approval");
  assert.equal(evidence.candidate.candidateOnly, true);
  assert.equal(evidence.candidate.canonicalMutationCount, expected.canonicalMutationCount ?? 0);
  assert.equal(evidence.candidate.externalRequest, false);
  assert.equal(evidence.candidate.dataLeftDevice, false);
  assert.equal(evidence.candidate.contentDigestVerified, true);
  assert.deepEqual(
    evidence.candidate.executionReceipt?.receiptKeys,
    [...CLOSED_EXECUTION_RECEIPT_KEYS].sort(),
  );
  assert.equal(evidence.candidate.executionReceipt?.taskId, evidence.candidate.taskId);
  assert.equal(evidence.candidate.executionReceipt?.backendId, "browser-ai");
  assert.equal(evidence.candidate.executionReceipt?.actualExecutor, "browser-ai");
  assert.equal(evidence.candidate.executionReceipt?.modelId, evidence.candidate.modelId);
  assert.equal(evidence.candidate.executionReceipt?.modelDigest, evidence.candidate.modelDigest);
  assert.equal(evidence.candidate.executionReceipt?.contentDigest, evidence.candidate.contentDigest);
  assert.match(evidence.candidate.executionReceipt?.contextDigest ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(evidence.candidate.executionReceipt?.proofState, "verified");
  assert.equal(evidence.candidate.executionReceipt?.externalRequest, false);
  assert.equal(evidence.candidate.executionReceipt?.dataLeftDevice, false);
  assert.equal(evidence.candidate.executionReceipt?.contextAttestation, "required");
  assert.equal(
    evidence.candidate.executionReceipt?.finalModelContextAttestationState,
    "present",
  );
  assert.equal(
    evidence.candidate.executionReceipt?.browserComputeReceiptId,
    evidence.browserComputeReceipt?.receiptId,
  );
  assert.equal(evidence.invocation?.status, "completed");
  assert.equal(evidence.invocation?.actualExecutor, "browser-ai");
  assert.equal(evidence.invocation?.taskType, "chapter.continue");
  assert.equal(evidence.invocation?.modelId, evidence.candidate.modelId);
  assert.equal(evidence.invocation?.modelDigest, evidence.candidate.modelDigest);
  assert.equal(evidence.invocation?.contextDigest, evidence.candidate.executionReceipt?.contextDigest);
  assert.equal(evidence.invocation?.executionReceipt?.providerRunId, evidence.candidate.taskId);
  assert.equal(evidence.invocation?.executionReceipt?.outputDigest, evidence.candidate.contentDigest);
  assert.equal(evidence.invocation?.executionReceipt?.modelId, evidence.candidate.modelId);
  assert.equal(evidence.invocation?.executionReceipt?.modelDigest, evidence.candidate.modelDigest);
  assert.equal(evidence.invocation?.executionReceipt?.externalRequest, false);
  assert.equal(evidence.invocation?.executionReceipt?.dataLeftDevice, false);
  assert.equal(evidence.invocation?.canonicalMutationCount, 0);
  assert.equal(evidence.message?.id, evidence.invocation?.messageId);
  assert.equal(evidence.message?.role, "assistant");
  assert.equal(evidence.message?.status, "completed");
  assert.equal(evidence.message?.candidateLinked, true);
  assert.equal(evidence.message?.invocationLinked, true);
  assert.equal(evidence.artifact?.sourceMessageId, evidence.message?.id);
  assert.deepEqual(
    evidence.browserComputeReceipt?.receiptKeys,
    [...BROWSER_EXECUTION_RECEIPT_KEYS].sort(),
  );
  assert.equal(evidence.browserComputeReceipt?.schemaVersion, "browser-execution-receipt-v3");
  assert.equal(evidence.browserComputeReceipt?.actualExecutor, "webllm-worker");
  assert.equal(evidence.browserComputeReceipt?.taskType, evidence.invocation?.taskType);
  assert.equal(evidence.browserComputeReceipt?.modelId, evidence.candidate.modelId);
  assert.equal(evidence.browserComputeReceipt?.modelDigest, evidence.candidate.modelDigest);
  assert.equal(evidence.browserComputeReceipt?.browserGenerationUsed, true);
  assert.equal(evidence.browserComputeReceipt?.externalAIUsed, false);
  assert.equal(evidence.browserComputeReceipt?.dataLeftDevice, false);
  assert.equal(evidence.browserComputeReceipt?.candidateOnly, true);
  assert.equal(evidence.browserComputeReceipt?.canonicalMutationCount, 0);
  assert.equal(evidence.browserComputeReceipt?.rawPromptStored, false);
  assert.equal(evidence.browserComputeReceipt?.rawOutputStored, false);
  assert.equal(evidence.browserComputeReceipt?.rawChainOfThoughtStored, false);
  assert.equal(evidence.browserComputeReceipt?.contextAttestation, "required");
  assert.equal(evidence.browserComputeReceipt?.finalModelContextAttestationState, "present");
  assert.ok(evidence.browserComputeReceipt?.finalModelContextAttestation);
  const expectedPassIdentity = expectedClosedQualityPassIdentity(
    evidence,
    evidence.browserComputeReceipt.finalModelContextAttestation.outerQualityPhase,
  );
  assert.equal(
    evidence.browserComputeReceipt?.outerRequestIdDigest,
    expectedPassIdentity.outerRequestIdDigest,
  );
  assert.equal(evidence.browserComputeReceipt?.taskDigest, expectedPassIdentity.taskDigest);
  for (const call of evidence.browserComputeReceipt.finalModelContextAttestation.contributingCalls) {
    assert.equal(
      call.invocationRequestIdDigest,
      expectedInnerRequestIdDigest(expectedPassIdentity, call.innerStage),
    );
  }
  assert.equal(evidence.browserComputeReceipt?.receiptIntegrityVerified, true);
  assert.equal(evidence.artifact?.candidateDigest, evidence.candidate.normalizedContentDigest);
  assert.equal(
    evidence.artifact?.status,
    expected.artifactStatus
      ?? (expected.status === "rejected"
        ? "rejected"
        : expected.status === "committed"
          ? "approved"
          : "candidate"),
  );
  if (expected.previous) {
    assert.equal(
      evidence.candidate.regeneration?.previousCandidateId,
      expected.previous.candidate.id,
    );
    assert.equal(
      evidence.candidate.regeneration?.previousTaskId,
      expected.previous.candidate.taskId,
    );
    assert.equal(
      evidence.candidate.regeneration?.previousCandidateDigest,
      expected.previous.candidate.contentDigest,
    );
    assert.equal(
      evidence.candidate.regeneration?.regenerationAttempt,
      expected.regenerationAttempt,
    );
    assert.equal(evidence.candidate.regeneration?.cacheBypassReason, "explicit_regeneration");
    assert.equal(evidence.candidate.regeneration?.cacheBypassed, true);
    assert.equal(evidence.candidate.regeneration?.previousContentReused, false);
    assert.equal(evidence.candidate.regeneration?.newCandidate, true);
    assert.equal(evidence.candidate.regeneration?.nonceStored, false);
  }
  runnerCandidateReached = true;
}

function assertT1CandidateTruth(evidence) {
  const taskModel = {
    modelId: "novel-browser-task-runtime-v3",
    modelDigest: "5ea2191560d86727a4d897f1b552a5f624b74dfb8ef0c57683b02d52d6db4b4f",
  };
  assert.ok(evidence?.candidate);
  assert.equal(evidence.candidate.backendId, "browser-ai");
  assert.equal(evidence.candidate.actualExecutor, "browser-ai");
  assert.equal(evidence.candidate.modelId, taskModel.modelId);
  assert.equal(evidence.candidate.modelDigest, taskModel.modelDigest);
  assert.equal(evidence.candidate.status, "awaiting-approval");
  assert.equal(evidence.candidate.candidateOnly, true);
  assert.equal(evidence.candidate.canonicalMutationCount, 0);
  assert.equal(evidence.candidate.externalRequest, false);
  assert.equal(evidence.candidate.dataLeftDevice, false);
  assert.equal(evidence.candidate.contentDigestVerified, true);
  assert.deepEqual(
    evidence.candidate.executionReceipt?.receiptKeys,
    [...CLOSED_EXECUTION_RECEIPT_KEYS].sort(),
  );
  assert.equal(evidence.candidate.executionReceipt?.taskId, evidence.candidate.taskId);
  assert.equal(evidence.candidate.executionReceipt?.backendId, "browser-ai");
  assert.equal(evidence.candidate.executionReceipt?.actualExecutor, "browser-ai");
  assert.equal(evidence.candidate.executionReceipt?.modelId, taskModel.modelId);
  assert.equal(evidence.candidate.executionReceipt?.modelDigest, taskModel.modelDigest);
  assert.equal(evidence.candidate.executionReceipt?.contentDigest, evidence.candidate.contentDigest);
  assert.match(evidence.candidate.executionReceipt?.contextDigest ?? "", FINAL_CONTEXT_DIGEST);
  assert.equal(evidence.candidate.executionReceipt?.proofState, "verified");
  assert.equal(evidence.candidate.executionReceipt?.externalRequest, false);
  assert.equal(evidence.candidate.executionReceipt?.dataLeftDevice, false);
  assert.equal(evidence.candidate.executionReceipt?.contextAttestation, "not_required");
  assert.equal(
    evidence.candidate.executionReceipt?.finalModelContextAttestationState,
    "absent",
  );
  assert.equal(evidence.candidate.executionReceipt?.finalModelContextAttestation, null);
  assert.equal(
    evidence.candidate.executionReceipt?.browserComputeReceiptId,
    evidence.browserComputeReceipt?.receiptId,
  );
  assert.equal(evidence.invocation?.status, "completed");
  assert.equal(evidence.invocation?.actualExecutor, "browser-ai");
  assert.equal(evidence.invocation?.taskType, "story.consistencyCheck");
  assert.equal(evidence.invocation?.modelId, taskModel.modelId);
  assert.equal(evidence.invocation?.modelDigest, taskModel.modelDigest);
  assert.equal(evidence.invocation?.contextDigest, evidence.candidate.executionReceipt?.contextDigest);
  assert.equal(evidence.invocation?.executionReceipt?.providerRunId, evidence.candidate.taskId);
  assert.equal(evidence.invocation?.executionReceipt?.outputDigest, evidence.candidate.contentDigest);
  assert.equal(evidence.invocation?.executionReceipt?.modelId, taskModel.modelId);
  assert.equal(evidence.invocation?.executionReceipt?.modelDigest, taskModel.modelDigest);
  assert.equal(evidence.invocation?.executionReceipt?.externalRequest, false);
  assert.equal(evidence.invocation?.executionReceipt?.dataLeftDevice, false);
  assert.equal(evidence.invocation?.canonicalMutationCount, 0);
  assert.equal(evidence.artifact, null);
  assert.deepEqual(
    evidence.browserComputeReceipt?.receiptKeys,
    [...BROWSER_EXECUTION_RECEIPT_KEYS].sort(),
  );
  assert.equal(evidence.browserComputeReceipt?.schemaVersion, "browser-execution-receipt-v3");
  assert.equal(evidence.browserComputeReceipt?.actualExecutor, "browser-task-model");
  assert.equal(evidence.browserComputeReceipt?.taskType, "story.consistencyCheck");
  assert.equal(evidence.browserComputeReceipt?.modelId, taskModel.modelId);
  assert.equal(evidence.browserComputeReceipt?.modelDigest, taskModel.modelDigest);
  assert.equal(evidence.browserComputeReceipt?.browserGenerationUsed, false);
  assert.equal(evidence.browserComputeReceipt?.externalAIUsed, false);
  assert.equal(evidence.browserComputeReceipt?.dataLeftDevice, false);
  assert.equal(evidence.browserComputeReceipt?.candidateOnly, true);
  assert.equal(evidence.browserComputeReceipt?.canonicalMutationCount, 0);
  assert.equal(evidence.browserComputeReceipt?.rawPromptStored, false);
  assert.equal(evidence.browserComputeReceipt?.rawOutputStored, false);
  assert.equal(evidence.browserComputeReceipt?.rawChainOfThoughtStored, false);
  assert.equal(evidence.browserComputeReceipt?.contextAttestation, "not_required");
  assert.equal(evidence.browserComputeReceipt?.finalModelContextAttestationState, "null");
  assert.equal(evidence.browserComputeReceipt?.finalModelContextAttestation, null);
  const qualityPhase = evidence.candidate.qualityMode === "fast" ? "draft" : "revision";
  const passIdentity = expectedClosedQualityPassIdentity(evidence, qualityPhase);
  assert.equal(evidence.browserComputeReceipt?.outerRequestIdDigest, passIdentity.outerRequestIdDigest);
  assert.equal(evidence.browserComputeReceipt?.taskDigest, passIdentity.taskDigest);
  assert.equal(evidence.browserComputeReceipt?.receiptIntegrityVerified, true);
}

function assertFinalContextBindings(evidence, requiredSources) {
  const candidateAttestation =
    evidence.candidate.executionReceipt?.finalModelContextAttestation;
  const browserAttestation =
    evidence.browserComputeReceipt?.finalModelContextAttestation;
  assert.ok(candidateAttestation, "candidate receipt omitted final model context attestation");
  assert.ok(browserAttestation, "Browser receipt omitted final model context attestation");
  assert.equal(evidence.candidate.executionReceipt?.contextAttestation, "required");
  assert.equal(evidence.browserComputeReceipt?.contextAttestation, "required");
  assert.deepEqual(candidateAttestation, browserAttestation);
  const expectedPassIdentity = expectedClosedQualityPassIdentity(
    evidence,
    browserAttestation.outerQualityPhase,
  );
  assert.equal(
    browserAttestation.outerRequestIdDigest,
    expectedPassIdentity.outerRequestIdDigest,
  );
  assert.equal(
    evidence.browserComputeReceipt.outerRequestIdDigest,
    browserAttestation.outerRequestIdDigest,
  );
  assert.equal(browserAttestation.outerTaskType, evidence.invocation.taskType);
  assert.ok(browserAttestation.contributingCalls.length >= 1);
  assert.ok(browserAttestation.contributingCalls.length <= 2);
  for (const call of browserAttestation.contributingCalls) {
    assert.equal(
      call.invocationRequestIdDigest,
      expectedInnerRequestIdDigest(expectedPassIdentity, call.innerStage),
    );
    assert.equal(call.modelId, evidence.candidate.modelId);
    assert.equal(call.modelDigest, evidence.candidate.modelDigest);
    assert.equal(call.outerTaskType, evidence.invocation.taskType);
    assert.equal(call.contextBindings.length, requiredSources.length);
    assert.equal(call.messageDescriptors.length, 2);
    assert.equal(call.messageDescriptors[0].role, "system");
    assert.equal(call.messageDescriptors[1].role, "user");
    for (const [sourceIndex, source] of requiredSources.entries()) {
      const matches = call.contextBindings.filter((binding) => (
        binding.sourceKind === source.sourceKind
      ));
      assert.equal(matches.length, 1);
      const [binding] = matches;
      assert.equal(binding.ordinal, sourceIndex + 1);
      assert.equal(binding.segmentIndex, sourceIndex);
      assert.equal(binding.authority, source.authority);
      assert.equal(binding.sourceIdDigest, source.sourceIdDigest);
      assert.equal(binding.originalDigest, source.originalDigest);
      assert.equal(binding.sourceArtifactDigest, source.sourceArtifactDigest);
      assert.equal(binding.sourceRevisionDigest, source.sourceRevisionDigest);
      assert.equal(binding.sourceMetadataDigest, source.sourceMetadataDigest);
      assert.equal(binding.messageIndex, 1);
      assert.equal(binding.coverage, "fragment");
      assert.ok(binding.survivingFragmentUtf8Bytes > 0);
      assert.ok(binding.survivingFragmentCharacters > 0);
      assert.match(binding.survivingFragmentDigest, FINAL_CONTEXT_DIGEST);
      assertSubstantiveSurvivingPrefix(binding, source);
    }
  }
  return {
    schemaVersion: browserAttestation.schemaVersion,
    bindingDigest: browserAttestation.bindingDigest,
    requiredManifestDigest: browserAttestation.requiredManifestDigest,
    acceptedDisposition: browserAttestation.acceptedDisposition,
    acceptedStage: browserAttestation.acceptedStage,
    executedStages: browserAttestation.executedStages,
    contributingCallCount: browserAttestation.contributingCalls.length,
    sourceBindingCount: requiredSources.length,
    originalDigests: requiredSources.map((source) => source.originalDigest),
    substantivePrefixBound: true,
    rawTextStored: false,
  };
}

function storyBibleFinalContextSource(storyBible) {
  return {
    sourceKind: "approved-story-bible",
    authority: "composer-repository-verified",
    sourceIdDigest: storyBible.sourceIdDigest,
    originalDigest: storyBible.originalDigest,
    sourceArtifactDigest: storyBible.sourceArtifactDigest,
    sourceRevisionDigest: storyBible.sourceRevisionDigest,
    sourceMetadataDigest: storyBible.sourceMetadataDigest,
    ...storyBible.runnerFinalContext,
  };
}

function attachmentFinalContextSource(attachment) {
  return {
    sourceKind: "selected-local-attachment-summary",
    authority: "user-selected-sanitized-untrusted-reference",
    sourceIdDigest: attachment.sourceIdDigest,
    originalDigest: attachment.originalDigest,
    sourceArtifactDigest: attachment.sourceArtifactDigest,
    sourceRevisionDigest: attachment.sourceRevisionDigest,
    sourceMetadataDigest: attachment.sourceMetadataDigest,
    ...attachment.runnerFinalContext,
  };
}

async function readFailedClosedAgentInvocation(projectId, exact = {}) {
  return page.evaluate(async ({ id, invocationId, taskId }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const records = await new Promise((resolve, reject) => {
        const request = database.transaction("conversationToolInvocations", "readonly")
          .objectStore("conversationToolInvocations").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const failed = records
        .filter((record) => (
          record.projectId === id
          && record.status === "failed"
          && record.toolId === "closed-agent-os:conversation-plan"
          && (!invocationId || record.id === invocationId)
          && (!taskId || record.taskId === taskId)
        ))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      return failed ? {
        id: failed.id,
        taskId: failed.taskId,
        toolId: failed.toolId,
        status: failed.status,
        safeErrorCode: failed.safeErrorCode,
        safeProgress: failed.safeProgress,
      } : null;
    } finally {
      database.close();
    }
  }, {
    id: projectId,
    invocationId: exact.invocationId ?? null,
    taskId: exact.taskId ?? null,
  });
}

async function attestPersistedFailureEvidence(projectId, invocation) {
  assert.equal(invocation.toolId, "closed-agent-os:conversation-plan");
  assert.equal(invocation.status, "failed");
  assert.equal(invocation.safeProgress?.stage, "closed-agent-failure-evidence");
  assert.equal(invocation.safeProgress?.percent, 100);
  const serialized = invocation.safeProgress?.message;
  const failureEvidence = parsePersistedFailureEvidence(serialized);
  assert.ok(failureEvidence, "failed invocation did not contain canonical finite evidence");
  assert.equal(failureEvidence.safeCode, invocation.safeErrorCode);
  await assertProductFailureEvidenceDom(
    { ...invocation, failureEvidence },
    serialized,
  );

  await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByTestId("conversation-first-workspace").waitFor({
    state: "visible",
    timeout: 90_000,
  });
  await assertExactOrigin();
  const reloaded = await readFailedClosedAgentInvocation(projectId, {
    invocationId: invocation.id,
    taskId: invocation.taskId,
  });
  assert.ok(reloaded, "exact failed invocation disappeared after reload");
  assert.equal(reloaded.safeErrorCode, invocation.safeErrorCode);
  assert.deepEqual(reloaded.safeProgress, invocation.safeProgress);
  await assertProductFailureEvidenceDom(
    { ...reloaded, failureEvidence },
    serialized,
  );
  authoritativeFailureEvidence = failureEvidence;
  return failureEvidence.safeCode;
}

async function waitForClosedAiRegenerationReady(timeoutMs = 90_000) {
  const composer = page.getByTestId("conversation-message-composer");
  await composer.waitFor({ state: "visible", timeout: timeoutMs });
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-testid="conversation-message-composer"]');
    if (!node) return false;
    const verified = Number(node.getAttribute("data-closed-ai-generation-verified-backends"));
    return Number.isSafeInteger(verified)
      && verified > 0
      && node.getAttribute("data-closed-ai-active-backend") === "browser-ai"
      && node.getAttribute("data-closed-ai-setup-busy") === "false"
      && node.getAttribute("aria-busy") === "false";
  }, undefined, { timeout: timeoutMs }).catch(() => {
    throw gateError("RC6_2_CLOSED_AI_REGENERATION_UI_NOT_READY");
  });
}

async function readRegenerationAttempt(projectId, sourceMessageId, previousTaskId) {
  return page.evaluate(async ({ id, sourceId, previousId }) => {
    const requestResult = (request) => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onupgradeneeded = () => {
        request.transaction?.abort();
        reject(new Error("RC6_2_CONVERSATION_DATABASE_MISSING"));
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const [messages, invocations, artifacts] = await Promise.all([
        requestResult(database.transaction("conversationMessages", "readonly")
          .objectStore("conversationMessages").getAll()),
        requestResult(database.transaction("conversationToolInvocations", "readonly")
          .objectStore("conversationToolInvocations").getAll()),
        requestResult(database.transaction("conversationArtifacts", "readonly")
          .objectStore("conversationArtifacts").getAll()),
      ]);
      const attempts = invocations.filter((invocation) => (
        invocation.projectId === id
        && invocation.taskId !== previousId
        && invocation.toolId === "closed-agent-os:conversation-plan"
        && messages.some((message) => (
          message.id === invocation.messageId
          && message.projectId === id
          && message.sourceMessageId === sourceId
          && message.role === "assistant"
        ))
      )).sort((left, right) => right.startedAt.localeCompare(left.startedAt));
      if (!attempts.length) return null;
      const invocation = attempts[0];
      const message = messages.find((record) => record.id === invocation.messageId) ?? null;
      const linkedArtifacts = artifacts.filter((record) => (
        record.projectId === id && record.sourceMessageId === invocation.messageId
      ));
      return {
        attemptCount: attempts.length,
        invocationId: invocation.id,
        taskId: invocation.taskId,
        invocationStatus: invocation.status,
        messageId: invocation.messageId,
        messageStatus: message?.status ?? null,
        artifactCount: linkedArtifacts.length,
        candidateArtifactCount: linkedArtifacts.filter((record) => record.status === "candidate").length,
      };
    } finally {
      database.close();
    }
  }, { id: projectId, sourceId: sourceMessageId, previousId: previousTaskId });
}

async function waitForRegenerationStart(projectId, sourceMessageId, previousTaskId) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const attempt = await readRegenerationAttempt(
      projectId,
      sourceMessageId,
      previousTaskId,
    ).catch(() => null);
    if (attempt) {
      assert.equal(attempt.attemptCount, 1, "regeneration created more than one attempt");
      assert.ok(["pending", "running", "completed", "failed", "cancelled"].includes(
        attempt.invocationStatus,
      ));
      assert.ok(["pending", "streaming", "completed", "failed", "cancelled"].includes(
        attempt.messageStatus,
      ));
      assert.ok(Number.isSafeInteger(attempt.artifactCount) && attempt.artifactCount >= 0);
      assert.ok(
        Number.isSafeInteger(attempt.candidateArtifactCount)
        && attempt.candidateArtifactCount >= 0
        && attempt.candidateArtifactCount <= attempt.artifactCount,
      );
      latestRegenerationAttemptEvidence = {
        invocationIdDigest: sha256Value(attempt.invocationId),
        taskIdDigest: sha256Value(attempt.taskId),
        messageIdDigest: sha256Value(attempt.messageId),
        invocationStatus: attempt.invocationStatus,
        messageStatus: attempt.messageStatus,
        artifactCount: attempt.artifactCount,
        candidateArtifactCount: attempt.candidateArtifactCount,
      };
      return { ...attempt, sourceMessageId, previousTaskId };
    }
    const safeCodes = await page.locator('[role="alert"] strong').allTextContents()
      .then((values) => values.map((value) => value.trim()).filter((value) => (
        SAFE_UI_ERROR_CODE_SET.has(value)
      )))
      .catch(() => []);
    if (safeCodes.length) throw gateError(safeCodes[0]);
    await page.waitForTimeout(250);
  }
  throw gateError("RC6_2_CLOSED_AI_REGENERATION_START_TIMEOUT");
}

async function waitForCandidate(
  projectId,
  previousTaskId = null,
  expectedTaskId = null,
  expectedAttempt = null,
) {
  const startedAt = Date.now();
  let nextHeartbeat = startedAt + 30_000;
  while (Date.now() - startedAt < generationTimeoutMs) {
    const evidence = await readCandidateEvidence(
      projectId,
      null,
      expectedTaskId,
    ).catch(() => null);
    const attempt = expectedAttempt
      ? await readRegenerationAttempt(
          projectId,
          expectedAttempt.sourceMessageId,
          expectedAttempt.previousTaskId,
        ).catch(() => null)
      : null;
    if (
      evidence?.candidate.status === "awaiting-approval"
      && evidence.candidate.taskId !== previousTaskId
      && (!expectedTaskId || evidence.candidate.taskId === expectedTaskId)
      && evidence.invocation?.status === "completed"
      && evidence.message?.status === "completed"
      && evidence.message?.candidateLinked === true
      && evidence.message?.invocationLinked === true
      && evidence.artifact?.status === "candidate"
      && evidence.artifact?.sourceMessageId === evidence.message?.id
    ) return evidence;
    if (
      expectedTaskId
      && attempt?.taskId === expectedTaskId
      && attempt.invocationStatus === "completed"
      && (
        !evidence
        || evidence.invocation?.status !== "completed"
        || evidence.message?.status !== "completed"
        || evidence.message?.candidateLinked !== true
        || evidence.message?.invocationLinked !== true
        || evidence.artifact?.status !== "candidate"
        || evidence.artifact?.sourceMessageId !== evidence.message?.id
      )
    ) {
      throw gateError("RC6_2_CLOSED_AI_INCOMPLETE_TERMINAL_STATE");
    }
    const failedInvocation = await readFailedClosedAgentInvocation(projectId, {
      taskId: expectedTaskId,
    });
    if (failedInvocation && failedInvocation.taskId !== previousTaskId) {
      const safeCode = await attestPersistedFailureEvidence(projectId, failedInvocation);
      throw gateError(safeCode);
    }
    if (Date.now() >= nextHeartbeat) {
      process.stderr.write(`[RC6.2 Closed AI] candidate generation in progress (${Math.round((Date.now() - startedAt) / 1_000)}s)\n`);
      nextHeartbeat += 30_000;
    }
    await page.waitForTimeout(1_000);
  }
  if (expectedTaskId) {
    const terminal = await readCandidateEvidence(projectId, null, expectedTaskId).catch(() => null);
    const terminalAttempt = expectedAttempt
      ? await readRegenerationAttempt(
          projectId,
          expectedAttempt.sourceMessageId,
          expectedAttempt.previousTaskId,
        ).catch(() => null)
      : null;
    if (
      terminal?.candidate.taskId === expectedTaskId
      && terminal.invocation?.status === "completed"
      && terminal.message?.status === "completed"
      && terminal.message?.candidateLinked === true
      && terminal.message?.invocationLinked === true
      && terminal.artifact?.status === "candidate"
      && terminal.artifact?.sourceMessageId === terminal.message?.id
    ) return terminal;
    if (
      terminalAttempt?.taskId === expectedTaskId
      && terminalAttempt.invocationStatus === "completed"
    ) throw gateError("RC6_2_CLOSED_AI_INCOMPLETE_TERMINAL_STATE");
  }
  throw gateError("RC6_2_CLOSED_AI_GENERATION_TIMEOUT");
}

async function waitForAnalyticalCandidate(projectId, previousTaskId = null) {
  const startedAt = Date.now();
  let nextHeartbeat = startedAt + 30_000;
  while (Date.now() - startedAt < generationTimeoutMs) {
    const evidence = await readCandidateEvidence(projectId).catch(() => null);
    if (
      evidence?.candidate.status === "awaiting-approval"
      && evidence.candidate.taskId !== previousTaskId
      && evidence.invocation?.status === "completed"
      && evidence.artifact === null
    ) return evidence;
    const failedInvocation = await readFailedClosedAgentInvocation(projectId);
    if (failedInvocation && failedInvocation.taskId !== previousTaskId) {
      const safeCode = await attestPersistedFailureEvidence(projectId, failedInvocation);
      throw gateError(safeCode);
    }
    if (Date.now() >= nextHeartbeat) {
      process.stderr.write(`[RC6.2 Closed AI] T1 analysis in progress (${Math.round((Date.now() - startedAt) / 1_000)}s)\n`);
      nextHeartbeat += 30_000;
    }
    await page.waitForTimeout(1_000);
  }
  throw gateError("RC6_2_CLOSED_AI_GENERATION_TIMEOUT");
}

async function waitForArtifactStatus(artifactId, status, timeoutMs = 90_000) {
  await page.waitForFunction(
    ({ id, expected }) => document.querySelector(`[data-artifact-id="${CSS.escape(id)}"]`)?.getAttribute("data-status") === expected,
    { id: artifactId, expected: status },
    { timeout: timeoutMs },
  );
}

async function readAttachmentEvidence(projectId, taskId) {
  return page.evaluate(async ({ id, exactTaskId }) => {
    const stableStringify = (value) => {
      if (value === null || typeof value !== "object") return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
      const entries = Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
      return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
    };
    const sha256 = async (value) => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
      return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    };
    const requestResult = (request) => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onupgradeneeded = () => {
        request.transaction?.abort();
        reject(new Error("RC6_2_ATTACHMENT_DATABASE_SCHEMA_MISSING"));
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const getRecord = (storeName, key, indexName = null) => {
        const store = database.transaction(storeName, "readonly").objectStore(storeName);
        return requestResult(indexName ? store.index(indexName).get(key) : store.get(key));
      };
       const invocation = await getRecord("conversationToolInvocations", exactTaskId, "taskId");
       if (!invocation || invocation.projectId !== id) return null;
       const assistantMessage = await getRecord("conversationMessages", invocation.messageId);
      if (
        !assistantMessage?.parentMessageId
        || assistantMessage.projectId !== id
        || assistantMessage.sessionId !== invocation.sessionId
        || assistantMessage.role !== "assistant"
      ) return null;
      const sourceMessage = await getRecord("conversationMessages", assistantMessage.parentMessageId);
      if (
        !sourceMessage
        || sourceMessage.projectId !== id
        || sourceMessage.sessionId !== invocation.sessionId
        || sourceMessage.role !== "user"
      ) return null;
      const attachments = [];
      for (const attachmentId of sourceMessage.attachmentIds ?? []) {
        const record = await getRecord("conversationAttachments", attachmentId);
        if (
          !record
          || record.projectId !== id
          || record.sessionId !== sourceMessage.sessionId
        ) return null;
        const sourceRevisionDigest = await sha256(stableStringify({
          domain: "selected-local-attachment-source-revision-v1",
          store: "conversationAttachments",
          schemaVersion: record.schemaVersion,
          conversationSchemaVersion: record.conversationSchemaVersion,
          id: record.id,
          projectId: record.projectId,
          sessionId: record.sessionId,
          revision: record.revision,
          contentHash: record.contentHash,
          rightsBasis: record.rightsBasis,
          rightsEvidenceHash: record.rightsEvidenceHash,
          userConfirmedRights: record.userConfirmedRights,
          rightsConfirmationSchemaVersion: record.rightsConfirmationSchemaVersion,
          parsingStatus: record.parsingStatus,
          localAnalysisOnly: record.localAnalysisOnly,
          rawContentRetained: record.rawContentRetained,
        }));
        attachments.push({
          schemaVersion: record.schemaVersion,
          conversationSchemaVersion: record.conversationSchemaVersion,
          id: record.id,
          revision: record.revision,
          format: record.format,
          byteLength: record.byteLength,
          contentHash: record.contentHash,
          sourceArtifactDigest: record.contentHash,
          sourceRevisionDigest,
          rightsBasis: ["user_supplied_local_analysis", "owned_by_user"]
            .includes(record.rightsBasis)
            ? record.rightsBasis
            : null,
          rightsEvidenceHash: record.rightsEvidenceHash,
          userConfirmedRights: record.userConfirmedRights ?? null,
          rightsConfirmationSchemaVersion:
            typeof record.rightsConfirmationSchemaVersion === "string"
            && /^[a-z0-9-]{1,80}$/u.test(record.rightsConfirmationSchemaVersion)
              ? record.rightsConfirmationSchemaVersion
              : null,
          parsingStatus: record.parsingStatus,
          localAnalysisOnly: record.localAnalysisOnly,
          rawContentRetained: record.rawContentRetained,
        });
      }
      return {
        sourceMessageId: sourceMessage.id,
        assistantMessageId: assistantMessage.id,
        attachmentCount: attachments.length,
        attachments,
      };
    } finally {
      database.close();
    }
  }, { id: projectId, exactTaskId: taskId });
}

async function runAttachmentProbe(projectId, storyBible) {
  setRunnerCheckpoint("attachment-init");
  const canonBefore = await readChapterTruth(projectId);
  const attachmentBytes = Buffer.from([
    "rights-confirmed-local-source-v1",
    `source-marker:${crypto.randomUUID()}`,
    "source-fact:an-old-watch-stopped-at-midnight",
  ].join("\n"), "utf8");
  const attachmentSummary = attachmentBytes.toString("utf8").trim();
  registerSensitiveEvidenceSentinel(attachmentSummary);
  attachmentSummary.split("\n").forEach(registerSensitiveEvidenceSentinel);
  const expectedContentHash = sha256Value(attachmentBytes);
  const expectedRightsEvidenceHash = sha256Value("composer-local-analysis-only");
  const generationPrompt = "請根據核准 Story Bible 與附件開始第一章";
  registerSensitiveEvidenceSentinel(generationPrompt);
  const composer = page.getByTestId("conversation-message-composer");
  setRunnerCheckpoint("attachment-file-select");
  await composer.locator('input[type="file"]').setInputFiles({
    name: "rights-confirmed-source.txt",
    mimeType: "text/plain",
    buffer: attachmentBytes,
  });
  const tray = page.getByTestId("conversation-attachment-tray");
  await tray.waitFor({ state: "visible", timeout: 90_000 });
  const rightsCheckbox = tray.getByRole("checkbox");
  assert.equal(await rightsCheckbox.isChecked(), false);
  setRunnerCheckpoint("attachment-rights-negative-baseline");
  const beforeUncheckedSubmit = await readRightsGateExecutionCounts(projectId);
  await composer.locator("textarea").fill(generationPrompt);
  await composer.getByRole("button", { name: "送出", exact: true }).click();
  setRunnerCheckpoint("attachment-rights-negative-wait");
  const rightsRequiredAlert = page.locator('[role="alert"] strong').filter({
    hasText: /^CONVERSATION_ATTACHMENT_RIGHTS_CONFIRMATION_REQUIRED$/u,
  });
  await rightsRequiredAlert.waitFor({ state: "visible", timeout: 90_000 });
  await waitUntilNotBusy(composer);
  setRunnerCheckpoint("attachment-rights-negative-verify");
  const afterUncheckedSubmit = await readRightsGateExecutionCounts(projectId);
  assert.deepEqual(
    afterUncheckedSubmit,
    beforeUncheckedSubmit,
    "unchecked attachment rights created persistent or model-execution evidence",
  );
  assert.deepEqual(await readChapterTruth(projectId), canonBefore);
  setRunnerCheckpoint("attachment-rights-positive-submit");
  await rightsCheckbox.check();
  assert.equal(await rightsCheckbox.isChecked(), true);
  await composer.locator("textarea").fill(generationPrompt);
  await composer.getByRole("button", { name: "送出", exact: true }).click();
  setRunnerCheckpoint("attachment-candidate-wait");
  const generated = await waitForCandidate(projectId);
  setRunnerCheckpoint("attachment-candidate-truth");
  assertCandidateTruth(generated);
  assert.deepEqual(
    await readChapterTruth(projectId),
    canonBefore,
    "attachment candidate mutated Canon before rejection",
  );
  setRunnerCheckpoint("attachment-evidence-read");
  const attachmentEvidence = await readAttachmentEvidence(projectId, generated.candidate.taskId);
  assert.ok(attachmentEvidence);
  assert.equal(attachmentEvidence.attachmentCount, 1);
  const [attachment] = attachmentEvidence.attachments;
  assert.equal(attachment.schemaVersion, "novel-domain-v1");
  assert.equal(attachment.conversationSchemaVersion, "conversation-attachment-v1");
  assert.equal(attachment.format, "txt");
  assert.equal(attachment.byteLength, attachmentBytes.byteLength);
  assert.equal(attachment.contentHash, expectedContentHash);
  assert.equal(attachment.sourceArtifactDigest, expectedContentHash);
  assert.match(attachment.sourceRevisionDigest, /^[a-f0-9]{64}$/u);
  attachment.sourceMetadataDigest = finalContextSourceMetadataDigest({
    sourceKind: "selected-local-attachment-summary",
    authority: "user-selected-sanitized-untrusted-reference",
    sourceArtifactDigest: attachment.sourceArtifactDigest,
    sourceRevisionDigest: attachment.sourceRevisionDigest,
  });
  attachment.sourceIdDigest = finalContextSourceIdDigest(
    `conversation-attachment-summary:${attachment.id}`,
    "selected-local-attachment-summary",
  );
  assert.match(attachment.sourceMetadataDigest, /^[a-f0-9]{64}$/u);
  assert.match(attachment.sourceIdDigest, /^[a-f0-9]{64}$/u);
  assert.equal(attachment.rightsBasis, "user_supplied_local_analysis");
  assert.equal(attachment.rightsEvidenceHash, expectedRightsEvidenceHash);
  assert.equal(attachment.userConfirmedRights, true);
  assert.equal(
    attachment.rightsConfirmationSchemaVersion,
    "conversation-attachment-rights-confirmation-v1",
  );
  assert.equal(attachment.parsingStatus, "completed");
  assert.equal(attachment.localAnalysisOnly, true);
  assert.equal(attachment.rawContentRetained, false);
  const attachmentValue = {
    authority: "untrusted_reference_data_only",
    contentDigest: expectedContentHash,
    sanitizationStatus: "unchanged",
    detectedInjectionSignals: [],
    summary: attachmentSummary,
    mayInvokeTools: false,
    mayMutateCanonical: false,
    mayAuthorizeExternalTransfer: false,
  };
  const serializedSource = [
    "[retrieval]",
    "[EXPLICITLY_SELECTED_LOCAL_ATTACHMENT_SUMMARY_UNTRUSTED]",
    stableStringify(attachmentValue),
  ].join("\n");
  attachment.originalDigest = sha256Value(serializedSource);
  Object.defineProperty(attachment, "runnerFinalContext", {
    enumerable: false,
    value: {
      outerKind: "untrusted-reference",
      serializedSource,
      substantivePrefix: [
        "[untrusted-reference]",
        "[retrieval]",
        "[EXPLICITLY_SELECTED_LOCAL_ATTACHMENT_SUMMARY_UNTRUSTED]",
        "{",
      ].join("\n"),
    },
  });
  setRunnerCheckpoint("attachment-context-proof");
  const finalContextProof = assertFinalContextBindings(generated, [
    storyBibleFinalContextSource(storyBible),
    attachmentFinalContextSource(attachment),
  ]);
  setRunnerCheckpoint("attachment-reject-submit");
  const approvalActions = page.locator(
    `[data-testid="conversation-approval-actions"][data-artifact-id="${generated.artifact.id}"]`,
  );
  await approvalActions.getByRole("button", { name: "放棄", exact: true }).click();
  setRunnerCheckpoint("attachment-reject-wait");
  await waitForArtifactStatus(generated.artifact.id, "rejected");
  setRunnerCheckpoint("attachment-reject-verify");
  const rejected = await readCandidateEvidence(projectId, generated.candidate.id);
  assertCandidateTruth(rejected, { status: "rejected" });
  assert.deepEqual(
    assertFinalContextBindings(rejected, [
      storyBibleFinalContextSource(storyBible),
      attachmentFinalContextSource(attachment),
    ]),
    finalContextProof,
  );
  assert.deepEqual(await readChapterTruth(projectId), canonBefore, "attachment reject mutated Canon");
  return {
    rightsUncheckedGate: {
      safeCode: "CONVERSATION_ATTACHMENT_RIGHTS_CONFIRMATION_REQUIRED",
      noAttachmentRecord: true,
      noMessage: true,
      noInvocation: true,
      noCandidate: true,
      noBrowserReceipt: true,
      noModelCall: true,
    },
    rightsCheckboxCheckedBeforeSubmit: true,
    sourceMessageId: attachmentEvidence.sourceMessageId,
    assistantMessageId: attachmentEvidence.assistantMessageId,
    attachment,
    candidate: rejected.candidate,
    browserRuntimeReceipt: rejected.browserComputeReceipt,
    finalContextProof,
    artifactId: rejected.artifact.id,
    rejected: true,
    fullReceiptRevalidatedAfterReject: true,
  };
}

async function startNewConversationSession() {
  const sidebar = page.getByTestId("conversation-session-sidebar");
  const active = sidebar.locator('[data-session-id][data-active="true"]');
  await active.waitFor({ state: "attached", timeout: 90_000 });
  const previousSessionId = await active.getAttribute("data-session-id");
  assert.ok(previousSessionId);
  await sidebar.getByRole("button", { name: "＋ 新對話", exact: true }).click();
  await page.waitForFunction((previous) => {
    const current = document.querySelector(
      '[data-testid="conversation-session-sidebar"] [data-session-id][data-active="true"]',
    )?.getAttribute("data-session-id");
    return Boolean(current && current !== previous);
  }, previousSessionId, { timeout: 90_000 });
  const newSessionId = await sidebar
    .locator('[data-session-id][data-active="true"]')
    .getAttribute("data-session-id");
  assert.ok(newSessionId);
  assert.notEqual(newSessionId, previousSessionId);
  assert.equal(await page.getByTestId("conversation-attachment-tray").count(), 0);
  await waitUntilNotBusy(page.getByTestId("conversation-message-composer"));
  return { previousSessionId, newSessionId };
}

async function runT1ContextAttestationProbe(projectId, storyBible, previousTaskId) {
  const canonBefore = await readChapterTruth(projectId);
  const modelMetadataBefore = await readModelMetadata();
  const modelAssetRequestsBefore = modelAssetRequestCount();
  const prompt = "檢查目前章節與 Story Bible 的一致性，只回報分析，不修改 Canon";
  registerSensitiveEvidenceSentinel(prompt);
  const composer = page.getByTestId("conversation-message-composer");
  await composer.locator("textarea").fill(prompt);
  await composer.getByRole("button", { name: "送出", exact: true }).click();
  const evidence = await waitForAnalyticalCandidate(projectId, previousTaskId);
  assertT1CandidateTruth(evidence);
  assert.equal(evidence.candidate.executionReceipt.finalModelContextAttestation, null);
  assert.equal(evidence.browserComputeReceipt.finalModelContextAttestation, null);
  assert.deepEqual(await readChapterTruth(projectId), canonBefore);
  assert.equal(modelAssetRequestCount(), modelAssetRequestsBefore);
  const modelMetadataAfter = await readModelMetadata();
  assert.equal(
    modelMetadataAfter?.generationCount,
    modelMetadataBefore?.generationCount,
    "packaged T1 task invoked the WebLLM model",
  );
  assert.match(storyBible.originalDigest, FINAL_CONTEXT_DIGEST);
  return {
    taskType: "story.consistencyCheck",
    contextAttestation: "not_required",
    packagedTaskModelPinned: true,
    storyBibleSidecarStrippedBeforeT1: true,
    finalModelContextAttestation: null,
    modelAssetRequestDelta: 0,
    webLlmGenerationDelta: 0,
    candidate: evidence.candidate,
    browserRuntimeReceipt: evidence.browserComputeReceipt,
    canonMutationCount: 0,
  };
}

async function prepareBrowserAi(setupEvidence) {
  requestPhase = "model-install";
  setRunnerCheckpoint("prepare-click");
  const card = page.getByTestId("closed-ai-setup-card");
  const beforeClickRequests = modelAssetRequestCount();
  await card.getByTestId("closed-ai-prepare-browser").click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="closed-ai-setup-card"]')?.getAttribute("aria-busy") === "true",
  );
  assert.equal(await card.getAttribute("data-setup-lifecycle"), "preparing");
  const earlyRequestDeadline = Date.now() + 15_000;
  while (
    modelAssetRequestCount() === beforeClickRequests
    && Date.now() < earlyRequestDeadline
  ) {
    await page.waitForTimeout(100);
  }
  assert.ok(
    modelAssetRequestCount() > beforeClickRequests,
    "explicit setup did not start a real model request before cancellation",
  );
  setRunnerCheckpoint("prepare-cancel");
  await card.getByRole("button", { name: "取消準備", exact: true }).click();
  await waitUntilNotBusy(card);
  assert.equal(await card.getAttribute("data-setup-lifecycle"), "cancelled");
  assert.match(await card.textContent() ?? "", /已取消準備/u);
  assert.equal(
    await card.getByTestId("closed-ai-prepare-browser").textContent(),
    "重試 Browser AI",
  );
  const metadataAfterCancel = await readModelMetadata().catch(() => null);
  assert.notEqual(
    metadataAfterCancel?.cacheVerified,
    true,
    "cancelled setup was incorrectly promoted to a verified model",
  );
  const requestsAtCancel = modelAssetRequestCount();
  setRunnerCheckpoint("prepare-retry");
  await card.getByTestId("closed-ai-prepare-browser").click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="closed-ai-setup-card"]')?.getAttribute("data-setup-lifecycle") === "preparing",
  );
  setRunnerCheckpoint("prepare-wait-ready");
  await waitForBrowserAiReady(card);
  assert.ok(
    modelAssetRequestCount() > requestsAtCancel,
    "retry did not resume a real model payload request after cancellation",
  );
  setRunnerCheckpoint("prepare-consumer-readiness");
  const composerTruth = page.getByTestId("conversation-message-composer");
  const consumerReadiness = {
    generationVerifiedBackends: Number(
      await composerTruth.getAttribute("data-closed-ai-generation-verified-backends"),
    ),
    activeBackend: await composerTruth.getAttribute("data-closed-ai-active-backend"),
    externalFallback: await composerTruth.getAttribute("data-closed-ai-external-fallback") === "true",
    silentExternalFallback: await composerTruth.getAttribute("data-closed-ai-silent-external-fallback") === "true",
  };
  assert.ok(consumerReadiness.generationVerifiedBackends >= 1);
  assert.equal(consumerReadiness.activeBackend, "browser-ai");
  assert.equal(consumerReadiness.externalFallback, false);
  assert.equal(consumerReadiness.silentExternalFallback, false);
  setRunnerCheckpoint("prepare-model-metadata");
  const modelMetadata = await readModelMetadata();
  assert.ok(modelMetadata);
  assert.equal(modelMetadata.installStatus, "ready");
  assert.equal(modelMetadata.cacheVerified, true);
  assert.equal(modelMetadata.shardIntegrityVerified, true);
  assert.ok(modelMetadata.verifiedShardCount > 0);
  assert.match(modelMetadata.shardManifestDigest, /^[a-f0-9]{64}$/u);
  requestPhase = "inference";

  return {
    setup: {
      ...setupEvidence,
      explicitInstallClicked: true,
      cancellation: {
        lifecycle: "cancelled",
        cancelledBeforeVerification: true,
        modelPayloadRequestCountAtCancel: requestsAtCancel,
        incompleteModelPromoted: false,
      },
      retryAfterCancel: true,
      modelPayloadRequestCount: modelAssetRequestCount(),
      immutableModelRootRequestCount: immutableModelRootRequests.length,
      approvedModelRedirectRequestCount: approvedModelRedirectRequests.length,
      modelPayloadHosts: [...new Set([
        ...immutableModelRootRequests,
        ...approvedModelRedirectRequests,
      ].map((item) => item.host))].sort(),
      metadata: modelMetadata,
    },
    consumerReadiness,
  };
}

async function runGenerationLifecycle(projectId, storyBible) {
  const canonBefore = await readChapterTruth(projectId);
  await assertMaliciousDomDiagnosticsAreRejected();
  const requiredSources = [storyBibleFinalContextSource(storyBible)];
  const generationPrompt = "幫我開始第一章";
  registerSensitiveEvidenceSentinel(generationPrompt);
  const composer = page.locator('textarea[aria-label="小說專案訊息"]');
  await composer.fill("幫我開始第一章");
  await page.getByRole("button", { name: "送出", exact: true }).click();
  setRunnerCheckpoint("first-candidate-created");
  const first = await waitForCandidate(projectId);
  assertCandidateTruth(first);
  const firstContextProof = assertFinalContextBindings(first, requiredSources);
  assert.deepEqual(await readChapterTruth(projectId), canonBefore, "first candidate mutated Canon before approval");

  const firstCard = page.locator(`[data-artifact-id="${first.artifact.id}"]`).first();
  const firstArticle = firstCard.locator("xpath=ancestor::article");
  const directRegenerate = firstArticle.getByRole("button", {
    name: "重新產生",
    exact: true,
  }).last();
  await waitForClosedAiRegenerationReady();
  await directRegenerate.click();
  setRunnerCheckpoint("direct-regeneration-created");
  const directAttempt = await waitForRegenerationStart(
    projectId,
    first.invocation.messageId,
    first.candidate.taskId,
  );
  const second = await waitForCandidate(
    projectId,
    first.candidate.taskId,
    directAttempt.taskId,
    directAttempt,
  );
  assertCandidateTruth(second, { previous: first, regenerationAttempt: 1 });
  const secondContextProof = assertFinalContextBindings(second, requiredSources);
  assert.notEqual(second.candidate.id, first.candidate.id);
  assert.notEqual(second.candidate.taskId, first.candidate.taskId);
  assert.notEqual(second.candidate.contentDigest, first.candidate.contentDigest);
  const firstAfterDirectRegeneration = await readCandidateEvidence(
    projectId,
    first.candidate.id,
  );
  assert.equal(firstAfterDirectRegeneration.candidate.status, "awaiting-approval");
  assert.equal(firstAfterDirectRegeneration.artifact.status, "candidate");
  assertCandidateTruth(firstAfterDirectRegeneration);
  assert.deepEqual(
    assertFinalContextBindings(firstAfterDirectRegeneration, requiredSources),
    firstContextProof,
  );
  assert.deepEqual(
    await readChapterTruth(projectId),
    canonBefore,
    "direct regeneration mutated Canon or closed its awaiting sibling",
  );

  const secondCard = page.locator(`[data-artifact-id="${second.artifact.id}"]`).first();
  await secondCard.getByRole("button", { name: "放棄", exact: true }).click();
  setRunnerCheckpoint("reject-canon-unchanged");
  await waitForArtifactStatus(second.artifact.id, "rejected");
  const rejectedSecond = await readCandidateEvidence(projectId, second.candidate.id);
  assertCandidateTruth(rejectedSecond, {
    status: "rejected",
    previous: first,
    regenerationAttempt: 1,
  });
  assert.deepEqual(
    assertFinalContextBindings(rejectedSecond, requiredSources),
    secondContextProof,
  );
  assert.deepEqual(await readChapterTruth(projectId), canonBefore, "reject mutated Canon");

  const modelAssetRequestsBeforeReload = modelAssetRequestCount();
  const modelMetadataBeforeReload = await readModelMetadata();
  setRunnerCheckpoint("cache-reuse-after-reload");
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByTestId("conversation-first-workspace").waitFor({
    state: "visible",
    timeout: 90_000,
  });
  await assertExactOrigin();
  assert.equal(
    modelAssetRequestCount(),
    modelAssetRequestsBeforeReload,
    "reload fetched model assets despite the verified local cache",
  );
  const modelMetadataAfterReload = await readModelMetadata();
  assert.equal(modelMetadataAfterReload?.installStatus, "ready");
  assert.equal(modelMetadataAfterReload?.cacheVerified, true);
  assert.equal(modelMetadataAfterReload?.shardIntegrityVerified, true);
  assert.equal(
    modelMetadataAfterReload?.generationCount,
    modelMetadataBeforeReload?.generationCount,
  );
  const rejectedAfterReload = await readCandidateEvidence(projectId, second.candidate.id);
  assertCandidateTruth(rejectedAfterReload, {
    status: "rejected",
    previous: first,
    regenerationAttempt: 1,
  });
  assert.deepEqual(
    assertFinalContextBindings(rejectedAfterReload, requiredSources),
    secondContextProof,
  );

  await waitForClosedAiRegenerationReady();
  const rejectedSecondCard = page.locator(`[data-artifact-id="${second.artifact.id}"]`).first();
  await rejectedSecondCard.waitFor({ state: "visible", timeout: 90_000 });
  const secondArticle = rejectedSecondCard.locator("xpath=ancestor::article");
  const chainedRegenerate = secondArticle.getByRole("button", {
    name: "重新產生",
    exact: true,
  }).last();
  assert.equal(await chainedRegenerate.count(), 1);
  assert.equal(await chainedRegenerate.isEnabled(), true);
  await chainedRegenerate.click();
  setRunnerCheckpoint("chained-regeneration-created");
  const chainedAttempt = await waitForRegenerationStart(
    projectId,
    second.invocation.messageId,
    second.candidate.taskId,
  );
  const third = await waitForCandidate(
    projectId,
    second.candidate.taskId,
    chainedAttempt.taskId,
    chainedAttempt,
  );
  assert.equal(
    modelAssetRequestCount(),
    modelAssetRequestsBeforeReload,
    "chained T2 inference fetched model assets instead of reusing the verified cache",
  );
  const modelMetadataAfterChainedInference = await readModelMetadata();
  assert.ok(
    modelMetadataAfterChainedInference.generationCount
      > modelMetadataAfterReload.generationCount,
    "chained T2 evidence did not record a WebLLM generation",
  );
  assertCandidateTruth(third, { previous: second, regenerationAttempt: 2 });
  const finalContextProof = assertFinalContextBindings(third, requiredSources);
  assert.notEqual(third.candidate.id, second.candidate.id);
  assert.notEqual(third.candidate.taskId, second.candidate.taskId);
  assert.notEqual(third.candidate.contentDigest, second.candidate.contentDigest);
  assert.deepEqual(await readChapterTruth(projectId), canonBefore, "chained regeneration mutated Canon before approval");

  const thirdCard = page.locator(`[data-artifact-id="${third.artifact.id}"]`).first();
  await thirdCard.getByRole("button", { name: "採用", exact: true }).click();
  setRunnerCheckpoint("approval-revision-incremented-once");
  await waitForArtifactStatus(third.artifact.id, "approved");
  const canonAfterApproval = await readChapterTruth(projectId);
  assert.equal(canonAfterApproval.chapterId, canonBefore.chapterId);
  assert.equal(canonAfterApproval.revision, canonBefore.revision + 1);
  assert.notEqual(canonAfterApproval.contentDigest, canonBefore.contentDigest);
  const approvedBeforeReload = await readCandidateEvidence(projectId, third.candidate.id);
  assertCandidateTruth(approvedBeforeReload, {
    status: "committed",
    canonicalMutationCount: 1,
    previous: second,
    regenerationAttempt: 2,
  });
  assert.deepEqual(
    assertFinalContextBindings(approvedBeforeReload, requiredSources),
    finalContextProof,
  );

  await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByTestId("conversation-first-workspace").waitFor({ state: "visible", timeout: 90_000 });
  await assertExactOrigin();
  setRunnerCheckpoint("final-reload-persisted");
  const canonAfterReload = await readChapterTruth(projectId);
  assert.deepEqual(canonAfterReload, canonAfterApproval);
  const persisted = await readCandidateEvidence(projectId, third.candidate.id);
  assert.equal(persisted.candidate.id, third.candidate.id);
  assertCandidateTruth(persisted, {
    status: "committed",
    canonicalMutationCount: 1,
    previous: second,
    regenerationAttempt: 2,
  });
  assert.deepEqual(
    assertFinalContextBindings(persisted, requiredSources),
    finalContextProof,
  );
  const approvalPersistedAfterReload = canonAfterReload.revision === canonAfterApproval.revision
    && persisted.candidate.id === third.candidate.id
    && persisted.candidate.status === "committed"
    && persisted.candidate.canonicalMutationCount === 1;
  assert.equal(approvalPersistedAfterReload, true);

  return {
    firstCandidateBeforeApproval: first.candidate,
    directRegenerationCandidate: second.candidate,
    directRegenerationSourceAfterward: {
      id: firstAfterDirectRegeneration.candidate.id,
      taskId: firstAfterDirectRegeneration.candidate.taskId,
      status: firstAfterDirectRegeneration.candidate.status,
      canonicalMutationCount: firstAfterDirectRegeneration.candidate.canonicalMutationCount,
    },
    rejectedCandidate: {
      id: rejectedSecond.candidate.id,
      taskId: rejectedSecond.candidate.taskId,
      status: rejectedSecond.candidate.status,
      canonicalMutationCount: rejectedSecond.candidate.canonicalMutationCount,
    },
    regeneratedCandidateBeforeApproval: third.candidate,
    browserRuntimeReceipt: third.browserComputeReceipt,
    finalContextProof,
    modelCacheReuse: {
      reloadBeforeChainedT2: true,
      modelAssetRequestDeltaAcrossReloadAndInference: 0,
      webLlmGenerationObservedAfterReload: true,
      cacheVerifiedAfterReload: true,
    },
    approval: {
      artifactId: third.artifact.id,
      status: "approved",
      canonRevisionBefore: canonBefore.revision,
      canonRevisionAfter: canonAfterApproval.revision,
      persistedAfterReload: approvalPersistedAfterReload,
      fullReceiptRevalidatedBeforeAndAfterReload: true,
    },
  };
}

try {
  const runnerEnvelopeTestScenario = process.env.RC6_2_RUNNER_ENVELOPE_TEST_SCENARIO?.trim() ?? "";
  if (runnerEnvelopeTestScenario) {
    assert.equal(formalAttemptEnabled, true);
    process.stderr.write([
      "[RC6.2 Closed AI] setup in progress (0s)",
      "[RC6.2 Closed AI] setup in progress (1s)",
      "[RC6.2 Closed AI] setup in progress (2s)",
      "",
    ].join("\n"));
    if (runnerEnvelopeTestScenario === "PASS") {
      setRunnerCheckpoint("launch");
      completeRunnerCheckpoint();
      setRunnerCheckpoint("network-zero-receipt-sentinel");
      networkSentinelEvidence = createPassingNetworkSentinelFixture();
      completeRunnerCheckpoint();
      context = {};
      profileOwnership = "wrapper-owned";
      profilePathDigest = "0".repeat(64);
      runnerPersistenceReached = true;
      runnerStoryBibleReached = true;
      runnerCandidateReached = true;
      finalOutput = { status: "PASS", profileDisposed: true };
    } else if (runnerEnvelopeTestScenario === "ASSERTION_FAIL") {
      setRunnerCheckpoint("fresh-storage");
      const injected = new assert.AssertionError({
        message: "injected assertion",
        actual: "different",
        expected: "equal",
        operator: "strictEqual",
      });
      throw injected;
    } else if (runnerEnvelopeTestScenario === "PLAYWRIGHT_FAIL") {
      setRunnerCheckpoint("launch");
      throw Object.assign(new Error("injected playwright failure"), {
        name: "PlaywrightError",
        code: "RC6_2_CLOSED_AI_GATE_FAILED",
      });
    } else if (runnerEnvelopeTestScenario === "PROJECTION_FAIL") {
      setRunnerCheckpoint("release-identity");
      throw Object.assign(new Error("injected projection failure"), {
        code: "RC6_2_RUNNER_ENVELOPE_TEST_PROJECTION_FAIL",
      });
    } else {
      throw gateError("RC6_2_CLOSED_AI_GATE_FAILED");
    }
  } else {
  setRunnerCheckpoint("launch");
  formalRunnerStartedLease = await waitForFormalRunnerStart();
  const launched = await launch();
  browser = launched.browser;
  context = launched.context;
  assert.equal(context.pages().length, 1, "fresh Edge profile opened an unexpected startup page");
  page = context.pages()[0] ?? await context.newPage();
  assert.equal(page.url(), "about:blank");
  requestPhase = "release-identity";
  setRunnerCheckpoint("edge-identity");
  const edgeIdentity = await readEdgeIdentity(launched.evidence);
  requestPhase = "bootstrap";
  setRunnerCheckpoint("network-zero-receipt-sentinel");
  const sentinelResult = await runPreNavigationNetworkSentinel();
  networkSentinelEvidence = sentinelResult.matrix;
  if (networkSentinelEvidence.firstFailedScalarAssertion !== null) {
    const scalarFailure = networkSentinelEvidence.firstFailedScalarAssertion;
    const sentinelAssertion = new assert.AssertionError({
      message: scalarFailure.assertionId,
      actual: scalarFailure.actualSafeValue,
      expected: scalarFailure.expectedSafeValue,
      operator: "strictEqual",
    });
    sentinelAssertion.sentinelScalarAssertion = scalarFailure;
    throw sentinelAssertion;
  }
  if (sentinelResult.operationalError !== null) throw sentinelResult.operationalError;
  edgeIdentity.preNavigationNetworkSentinel = networkSentinelEvidence;
  if (networkSentinelOnly) {
    completeRunnerCheckpoint();
    finalOutput = {
      schemaVersion: "p24b-rc6.2-network-sentinel-only-evidence-v1",
      status: "PASS",
      mode,
      networkZeroReceipt: networkSentinelEvidence,
      freshBrowserContext: true,
      profileOwnership,
      profilePathDigest,
      edgeIdentity,
    };
  } else {
  requestPhase = "release-identity";
  setRunnerCheckpoint("release-identity");
  const releaseIdentityBeforeApp = await readReleaseIdentityTruth({ navigate: true });
  setRunnerCheckpoint("fresh-storage");
  const freshStorage = await readFreshStorageTruth();
  requestPhase = "project-setup";
  setRunnerCheckpoint("project-create");
  let projectId;
  let storyBible;
  if (mode === "setup") {
    projectId = await createProject();
    storyBible = null;
  } else {
    setRunnerCheckpoint("story-bible-isolation-witness");
    const isolationProjectId = await createProject();
    const isolationStoryBible = await createApprovedStoryBible(isolationProjectId);
    setRunnerCheckpoint("project-create");
    projectId = await createProject();
    setRunnerCheckpoint("story-bible");
    storyBible = await createApprovedStoryBible(projectId, { requireIsolationWitness: true });
    assert.notEqual(projectId, isolationProjectId);
    assert.notEqual(storyBible.recordId, isolationStoryBible.recordId);
    assert.notEqual(storyBible.originalDigest, isolationStoryBible.originalDigest);
    assert.ok(storyBible.observedOtherProjectCount >= 1);
    assert.ok(storyBible.observedOtherStoryBibleCount >= 1);
  }
  setRunnerCheckpoint("inspect-setup");
  const setup = await inspectFreshSetup();
  let lifecycle;
  if (mode === "setup") {
    lifecycle = { setup };
  } else {
    setRunnerCheckpoint("prepare");
    const prepared = await prepareBrowserAi(setup);
    setRunnerCheckpoint("attachment-probe");
    const attachmentProbe = await runAttachmentProbe(projectId, storyBible);
    setRunnerCheckpoint("attachment-to-t1-session");
    const attachmentToT1 = await startNewConversationSession();
    setRunnerCheckpoint("t1-probe");
    const t1ContextAttestationProbe = await runT1ContextAttestationProbe(
      projectId,
      storyBible,
      attachmentProbe.candidate.taskId,
    );
    setRunnerCheckpoint("t1-to-lifecycle-session");
    const t1ToLifecycle = await startNewConversationSession();
    assert.equal(t1ToLifecycle.previousSessionId, attachmentToT1.newSessionId);
    const conversationIsolation = {
      attachmentSessionId: attachmentToT1.previousSessionId,
      t1SessionId: attachmentToT1.newSessionId,
      lifecycleSessionId: t1ToLifecycle.newSessionId,
      allDistinct: new Set([
        attachmentToT1.previousSessionId,
        attachmentToT1.newSessionId,
        t1ToLifecycle.newSessionId,
      ]).size === 3,
    };
    assert.equal(conversationIsolation.allDistinct, true);
    setRunnerCheckpoint("generation-lifecycle");
    const ordinaryLifecycle = await runGenerationLifecycle(projectId, storyBible);
    lifecycle = {
      ...prepared,
      storyBible,
      attachmentProbe,
      t1ContextAttestationProbe,
      conversationIsolation,
      ...ordinaryLifecycle,
    };
    const modelContextBindingVerified = ordinaryLifecycle.finalContextProof.sourceBindingCount === 1
      && ordinaryLifecycle.finalContextProof.originalDigests.includes(storyBible.originalDigest)
      && ordinaryLifecycle.finalContextProof.substantivePrefixBound === true;
    const storyBibleTruth = {
      ...storyBible,
      approvedRecordCreated: typeof storyBible.recordId === "string" && storyBible.recordId.length > 0,
      approvedRecordReloadVerified: storyBible.persistedAfterReload,
      modelContextBindingVerified,
      crossProjectLeakCount: storyBible.crossProjectLeakCount,
    };
    const storyBibleReady = storyBibleTruth.approvedRecordCreated === true
      && storyBibleTruth.approvedRecordReloadVerified === true
      && storyBibleTruth.modelContextBindingVerified === true
      && storyBibleTruth.crossProjectLeakCount === 0;
    assert.equal(storyBibleReady, true);
    lifecycle.storyBible = {
      ...storyBibleTruth,
      status: storyBibleReady ? "ready" : "error",
    };
  }
  const persistenceContract = mode === "setup" ? null : await readPersistenceContractTruth();
  const persistence = mode === "setup"
    ? null
    : await readFormalPersistenceTruth(projectId, lifecycle.storyBible, persistenceContract);
  runnerPersistenceReached = persistence !== null;
  setRunnerCheckpoint("final-release-identity");
  const releaseIdentityAfterReload = await readReleaseIdentityTruth();
  assert.deepEqual(releaseIdentityAfterReload, releaseIdentityBeforeApp);
  const edgeVersionAfterReload = await edgeCdpSession.send("Browser.getVersion");
  assert.equal(edgeVersionAfterReload.product, edgeIdentity.product);
  assert.equal(edgeVersionAfterReload.protocolVersion, edgeIdentity.protocolVersion);
  assert.equal(context.pages().length, 1, "gate opened an unexpected second Edge page");
  assert.equal(context.pages()[0], page, "gate changed the authoritative Edge page");
  assert.equal(browser?.contexts().length, 1, "gate opened an unexpected Edge context");
  assert.equal(browser?.contexts()[0], context, "gate changed the persistent Edge context");
  edgeIdentity.sameBrowserAfterReload = true;
  edgeIdentity.browserContextCount = 1;
  edgeIdentity.pageCount = 1;
  assert.equal(contextRouteInstalledBeforeNavigation, true);
  assert.equal(contextWebSocketRouteInstalledBeforeNavigation, true);
  assert.equal(networkSentinelEvidence.schemaVersion, NETWORK_SENTINEL_SCHEMA);
  assert.equal(networkSentinelEvidence.status, "PASS");
  assert.equal(networkSentinelEvidence.matrixDigest, networkSentinelMatrixDigest(networkSentinelEvidence));
  assert.equal(blockedNetworkPolicyAttemptCount, 0);
  assert.deepEqual(blockedNetworkPolicyAttempts, []);
  assert.equal(prohibitedExternalAiRequestCount, 0);
  assert.deepEqual(prohibitedExternalAiRequests, []);
  assert.equal(disallowedCrossOriginRequestCount, 0);
  assert.deepEqual(disallowedCrossOriginRequests, []);
  assert.equal(disallowedSameOriginTargetRequestCount, 0);
  assert.deepEqual(disallowedSameOriginTargetRequests, []);
  assert.equal(disallowedImmutableModelTargetRequestCount, 0);
  assert.deepEqual(disallowedImmutableModelTargetRequests, []);
  assert.equal(disallowedMethodRequestCount, 0);
  assert.deepEqual(disallowedMethodRequests, []);
  assert.equal(blockedNonToolbarResponseCount, 0);
  assert.deepEqual(blockedNonToolbarResponses, []);
  assert.equal(observedWebSocketAttemptCount, blockedWebSocketAttemptCount);
  assert.equal(disallowedWebSocketAttemptCount, 0);
  assert.deepEqual(disallowedWebSocketAttempts, []);
  assert.equal(webSocketServerConnectionCount, 0);
  assert.equal(
    observedPreviewToolbarWebSocketAttemptCount,
    blockedPreviewToolbarWebSocketAttemptCount,
  );
  assert.equal(
    observedWebSocketAttemptCount,
    observedPreviewToolbarWebSocketAttemptCount + disallowedWebSocketAttemptCount,
  );
  assert.equal(
    blockedPreviewToolbarWebSocketAttempts.length,
    Math.min(blockedPreviewToolbarWebSocketAttemptCount, MAX_SAFE_NETWORK_PROJECTIONS),
  );
  assert.equal(observedPreviewToolbarRequests.length, blockedPreviewToolbarRequests.size);
  for (const request of observedPreviewToolbarRequests) {
    assert.equal(blockedPreviewToolbarRequests.has(request), true);
  }
  assert.equal(previewToolbarResponseCount, 0);
  assert.deepEqual(previewToolbarResponses, []);
  finalOutput = {
    schemaVersion: "p24b-rc6-2-closed-ai-browser-evidence-v3",
    status: "PASS",
    mode,
    exactOrigin: expectedOrigin,
    freshBrowserContext: true,
    releaseIdentity: releaseIdentityAfterReload,
    edgeIdentity,
    freshStorage,
    mocksInstalled: false,
    prohibitedExternalAiRequestCount: 0,
    crossOriginPolicy: {
      policy: "phase-aware-context-route-default-deny-v3",
      contextRouteInstalledBeforeNavigation,
      allowedMethods: [...ALLOWED_REQUEST_METHODS],
      immutableModelAssetsAllowedOnlyDuringExplicitInstall: true,
      sameOriginTargetPolicy: "product-bound-finite-target-manifest",
      disallowedRequestCount: blockedNetworkPolicyAttemptCount,
      disallowedMethodRequestCount,
      blockedNonToolbarResponseCount,
      previewToolbarPolicy: "blocked-before-network",
      observedPreviewToolbarRequestCount: observedPreviewToolbarRequests.length,
      blockedPreviewToolbarRequestCount: blockedPreviewToolbarRequests.size,
      previewToolbarResponseCount,
      webSocketRouteInstalledBeforeNavigation:
        contextWebSocketRouteInstalledBeforeNavigation,
      webSocketPolicy: "blocked-before-connect",
      observedWebSocketAttemptCount,
      blockedWebSocketAttemptCount,
      disallowedWebSocketAttemptCount,
      webSocketServerConnectionCount,
      observedPreviewToolbarWebSocketAttemptCount,
      blockedPreviewToolbarWebSocketAttemptCount,
    },
    networkZeroReceipt: networkSentinelEvidence,
    projectId,
    persistence,
    ...lifecycle,
    completedAt: new Date().toISOString(),
  };
  assertSafeEvidenceProjection(finalOutput);
  }
  }
} catch (error) {
  runnerCaughtError = error;
  failRunnerCheckpoint(error);
  if (process.env.RC6_2_RUNNER_ENVELOPE_TEST_SCENARIO) {
    finalOutput = {
      schemaVersion: "p24b-rc6-2-closed-ai-browser-evidence-v3",
      status: "FAIL",
      mode,
      exactOrigin: expectedOrigin,
      error: { code: safeFailureCode(error), diagnosticCodes: [], browserRuntimeEvidence: [] },
    };
    process.exitCode = 1;
  } else {
  const diagnosticCodes = await readSanitizedQualityCodes().catch(() => []);
  const browserRuntimeEvidence = await readSanitizedBrowserRuntimeEvidence().catch(() => []);
  const modelMetadataAtFailure = await readModelMetadata().catch(() => null);
  const uiSafeErrorCodesAtFailure = await page?.locator('[role="alert"] strong')
    .allTextContents()
    .then((values) => values
      .map((value) => value.trim())
      .filter((value) => SAFE_UI_ERROR_CODE_SET.has(value))
      .sort())
    .catch(() => []);
  const uiStateAtFailure = await page?.evaluate(async () => {
    const composer = document.querySelector('[data-testid="conversation-message-composer"]');
    const textarea = composer?.querySelector("textarea");
    const buttons = [...(composer?.querySelectorAll('button[type="button"]') ?? [])];
    const sendButton = buttons.at(-1) ?? null;
    const checkbox = document.querySelector(
      '[data-testid="conversation-attachment-tray"] input[type="checkbox"]',
    );
    const lockState = "locks" in navigator && navigator.locks?.query
      ? await navigator.locks.query()
      : { held: [], pending: [] };
    const relevantLocks = (values) => values.filter((entry) => (
      typeof entry.name === "string"
      && entry.name.startsWith("novel:conversation-operation:")
    ));
    return {
      composerBusy: composer?.getAttribute("aria-busy") === "true"
        ? true
        : composer?.getAttribute("aria-busy") === "false"
          ? false
          : null,
      sendDisabled: sendButton?.hasAttribute("disabled") ?? null,
      draftCharacters: textarea ? Array.from(textarea.value).length : null,
      attachmentTrayCount: document.querySelectorAll(
        '[data-testid="conversation-attachment-tray"]',
      ).length,
      rightsCheckboxCount: document.querySelectorAll(
        '[data-testid="conversation-attachment-tray"] input[type="checkbox"]',
      ).length,
      rightsChecked: checkbox instanceof HTMLInputElement ? checkbox.checked : null,
      branchPendingStatusCount: document.querySelectorAll(
        '[data-testid="conversation-branch-global-status"]',
      ).length,
      alertCount: document.querySelectorAll('[role="alert"]').length,
      heldConversationLockCount: relevantLocks(lockState.held ?? []).length,
      pendingConversationLockCount: relevantLocks(lockState.pending ?? []).length,
    };
  }).catch(() => null);
  const disallowedCrossOriginHostDigests = [...new Set(
    disallowedCrossOriginRequests.map((entry) => entry.hostDigest).filter(Boolean),
  )].sort().map((hostDigest) => ({
    hostDigest,
    projectedCount: disallowedCrossOriginRequests.filter(
      (entry) => entry.hostDigest === hostDigest,
    ).length,
  }));
  finalOutput = {
    schemaVersion: "p24b-rc6-2-closed-ai-browser-evidence-v3",
    status: "FAIL",
    mode,
    exactOrigin: expectedOrigin,
    freshBrowserContext: true,
    requestPhase,
    gateCheckpoint,
    freshStorageAtFailure,
    modelPayloadRequestCount: modelAssetRequestCount(),
    immutableModelRootRequestCount: immutableModelRootRequests.length,
    approvedModelRedirectRequestCount: approvedModelRedirectRequests.length,
    modelMetadataAtFailure,
    latestRegenerationAttemptEvidence,
    uiSafeErrorCodesAtFailure,
    uiStateAtFailure,
    profileOwnershipAtFailure: profileOwnership,
    profilePathDigestAtFailure: profilePathDigest,
    networkSentinelEvidenceAtFailure: networkSentinelEvidence,
    contextRouteInstalledBeforeNavigation,
    contextWebSocketRouteInstalledBeforeNavigation,
    webSocketPolicy: "blocked-before-connect",
    blockedNetworkPolicyAttemptCount,
    blockedNetworkPolicyAttempts,
    blockedNetworkPolicyProjectionTruncated:
      blockedNetworkPolicyAttemptCount > blockedNetworkPolicyAttempts.length,
    prohibitedExternalAiRequestCount,
    observedPreviewToolbarRequestCount: observedPreviewToolbarRequests.length,
    blockedPreviewToolbarRequestCount: blockedPreviewToolbarRequests.size,
    previewToolbarResponseCount,
    disallowedCrossOriginRequestCount,
    disallowedSameOriginTargetRequestCount,
    disallowedSameOriginTargetRequests,
    disallowedImmutableModelTargetRequestCount,
    disallowedImmutableModelTargetRequests,
    disallowedMethodRequestCount,
    blockedNonToolbarResponseCount,
    blockedNonToolbarResponses,
    observedWebSocketAttemptCount,
    blockedWebSocketAttemptCount,
    disallowedWebSocketAttemptCount,
    disallowedWebSocketAttempts,
    disallowedWebSocketProjectionTruncated:
      disallowedWebSocketAttemptCount > disallowedWebSocketAttempts.length,
    webSocketServerConnectionCount,
    observedPreviewToolbarWebSocketAttemptCount,
    blockedPreviewToolbarWebSocketAttemptCount,
    blockedPreviewToolbarWebSocketAttempts,
    blockedPreviewToolbarWebSocketProjectionTruncated:
      blockedPreviewToolbarWebSocketAttemptCount
      > blockedPreviewToolbarWebSocketAttempts.length,
    disallowedCrossOriginHostDigests,
    error: {
      code: safeFailureCode(error),
      diagnosticCodes: sanitizeDiagnosticCodes(diagnosticCodes),
      browserRuntimeEvidence: sanitizeBrowserRuntimeEvidence(browserRuntimeEvidence),
    },
    completedAt: new Date().toISOString(),
  };
  process.exitCode = 1;
  }
} finally {
  await edgeCdpSession?.detach().catch(() => undefined);
  let cleanupFailed = false;
  await context?.close?.().catch(() => { cleanupFailed = true; });
  await browser?.close().catch(() => undefined);
  let profileDisposed = false;
  if (profilePath) {
    const resolvedProfile = resolve(profilePath);
    const temporaryRoot = await canonicalTemporaryRoot().catch(() => null);
    const exactSafeTarget = temporaryRoot !== null
      && isAbsolute(profilePath)
      && profilePath === resolvedProfile
      && PROFILE_NAME.test(basename(resolvedProfile))
      && comparableFilesystemPath(dirname(resolvedProfile))
        === comparableFilesystemPath(temporaryRoot);
    if (!exactSafeTarget) {
      cleanupFailed = true;
    } else {
      const disposableTarget = await lstat(resolvedProfile)
        .then(async (entry) => (
          entry.isDirectory()
          && !entry.isSymbolicLink()
          && comparableFilesystemPath(await realpath(resolvedProfile))
            === comparableFilesystemPath(resolvedProfile)
        ))
        .catch((error) => error?.code === "ENOENT");
      if (!disposableTarget) cleanupFailed = true;
      else await rm(resolvedProfile, { recursive: true, force: true })
        .then(async () => {
          profileDisposed = await stat(resolvedProfile)
            .then(() => false)
            .catch((error) => error?.code === "ENOENT");
          if (!profileDisposed) cleanupFailed = true;
        })
        .catch(() => { cleanupFailed = true; });
    }
  }
  if (process.env.RC6_2_RUNNER_ENVELOPE_TEST_SCENARIO === "PASS" && !profilePath) {
    profileDisposed = true;
  }
  if (!finalOutput) {
    finalOutput = {
      schemaVersion: "p24b-rc6-2-closed-ai-browser-evidence-v3",
      status: "FAIL",
      mode,
      exactOrigin: expectedOrigin,
      profileOwnershipAtFailure: profileOwnership,
      profilePathDigestAtFailure: profilePathDigest,
      contextRouteInstalledBeforeNavigation,
      contextWebSocketRouteInstalledBeforeNavigation,
      webSocketPolicy: "blocked-before-connect",
      observedWebSocketAttemptCount,
      blockedWebSocketAttemptCount,
      disallowedWebSocketAttemptCount,
      webSocketServerConnectionCount,
      observedPreviewToolbarWebSocketAttemptCount,
      blockedPreviewToolbarWebSocketAttemptCount,
      error: {
        code: "RC6_2_CLOSED_AI_GATE_FAILED",
        diagnosticCodes: [],
        browserRuntimeEvidence: [],
      },
    };
    process.exitCode = 1;
  }
  if (cleanupFailed) {
    setRunnerCheckpoint("profile-cleanup");
    const cleanupError = gateError("RC6_2_CLOSED_AI_GATE_FAILED");
    runnerCaughtError ??= cleanupError;
    failRunnerCheckpoint(cleanupError);
    finalOutput.status = "FAIL";
    finalOutput.error = {
      code: "RC6_2_CLOSED_AI_GATE_FAILED",
      diagnosticCodes: [],
      browserRuntimeEvidence: [],
    };
    process.exitCode = 1;
  }
  runnerCleanupFailed = cleanupFailed;
  finalOutput.profileDisposed = profileDisposed;
  finalOutput.completedAt = new Date().toISOString();
  try {
    assertSafeEvidenceProjection(finalOutput);
  } catch {
    finalOutput = {
      schemaVersion: "p24b-rc6-2-closed-ai-browser-evidence-v3",
      status: "FAIL",
      mode,
      exactOrigin: expectedOrigin,
      freshBrowserContext: true,
      profileOwnershipAtFailure: profileOwnership,
      profilePathDigestAtFailure: profilePathDigest,
      profileDisposed,
      contextRouteInstalledBeforeNavigation,
      contextWebSocketRouteInstalledBeforeNavigation,
      webSocketPolicy: "blocked-before-connect",
      observedWebSocketAttemptCount,
      blockedWebSocketAttemptCount,
      disallowedWebSocketAttemptCount,
      webSocketServerConnectionCount,
      observedPreviewToolbarWebSocketAttemptCount,
      blockedPreviewToolbarWebSocketAttemptCount,
      error: {
        code: "RC6_2_CLOSED_AI_GATE_FAILED",
        diagnosticCodes: [],
        browserRuntimeEvidence: [],
      },
      completedAt: new Date().toISOString(),
    };
    process.exitCode = 1;
  }
  if (!cleanupFailed) completeRunnerCheckpoint();
  let envelopePublished = !formalAttemptEnabled;
  if (formalAttemptEnabled) {
    const envelopeStatus = finalOutput.status === "PASS" && !runnerCleanupFailed ? "PASS" : "FAIL";
    let envelope;
    try {
      envelope = createRunnerTerminalEnvelope({
        status: envelopeStatus,
        exitCode: envelopeStatus === "PASS" ? 0 : 1,
      });
      if (process.env.RC6_2_RUNNER_ENVELOPE_TEST_MUTATION === "PROJECTION_FAILURE") {
        envelope.injectedUnexpectedKey = true;
      }
      assert.deepEqual(Object.keys(envelope).sort(), [...RUNNER_ENVELOPE_KEYS].sort());
      assert.equal(RUNNER_ENVELOPE_FAILURE_SHAPES.has(envelope.failureShape), envelopeStatus === "FAIL");
      if (envelope.firstFailedAssertion) {
        assert.equal(RUNNER_ENVELOPE_ASSERTION_IDS.has(envelope.firstFailedAssertion.assertionId), true);
        assert.equal(
          RUNNER_ENVELOPE_DISPOSITIONS.has(envelope.firstFailedAssertion.expectedDisposition),
          true,
        );
        assert.equal(
          RUNNER_ENVELOPE_DISPOSITIONS.has(envelope.firstFailedAssertion.actualDisposition),
          true,
        );
      }
    } catch (projectionError) {
      const rejectedProjection = envelope;
      runnerCaughtError = projectionError;
      failRunnerCheckpoint(projectionError);
      finalOutput.status = "FAIL";
      process.exitCode = 1;
      envelope = createRunnerTerminalEnvelope({
        status: "FAIL",
        exitCode: 1,
        projectionFailure: projectionError,
        rejectedProjection,
      });
    }
    try {
      await publishRunnerTerminalEnvelope(envelope);
      envelopePublished = true;
    } catch {
      process.exitCode = 1;
      finalOutput.status = "FAIL";
    }
  }
  const serialized = JSON.stringify(finalOutput, null, 2);
  if (finalOutput.status === "PASS" && envelopePublished) console.log(serialized);
  else if (!formalAttemptEnabled) console.error(serialized);
  else process.stderr.write("RC6_2_RUNNER_TERMINAL_FAIL\n");
}

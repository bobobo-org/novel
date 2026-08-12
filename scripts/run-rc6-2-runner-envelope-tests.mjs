import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  constants as fsConstants,
  link,
  lstat,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ENVELOPE_SCHEMA = "p24b-rc6.2-formal-runner-terminal-envelope-v2";
const VALIDATION_SCHEMA = "p24b-rc6.2-formal-runner-envelope-validation-v1";
const MAX_ENVELOPE_BYTES = 131_072;
const SHA_SIDECAR_BYTES = 65;
const MAX_STDIN_BYTES = 65_536;
const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const ATTEMPT = /^C7-PROD-BROWSER-\d{8}T\d{9}Z-[a-f0-9]{32}$/u;
const AUTHORIZATION = /^C7-PROD-BROWSER-AUTH-\d{8}T\d{9}Z-[a-f0-9]{32}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,127}$/u;
const UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const ENVELOPE_KEYS = [
  "schemaVersion", "status", "attemptId", "authorizationId", "authorizationDigest",
  "productCommit", "controlCommit", "deploymentId", "productionOrigin", "releaseTag",
  "releaseRevision", "runtimeReceiptDigest", "wrapperDigest", "runnerDigest", "contractDigest",
  "mode", "exitCode", "startedAt", "completedAt", "requestPhase", "gateCheckpoint",
  "lastCompletedCheckpoint", "checkpointOrdinal", "checkpointTrail", "failureShape",
  "safeErrorCode", "firstFailedOperation", "firstFailedAssertion", "projectionValidation",
  "freshBrowserContext", "profileOwnership", "profilePathDigest", "profileDisposed",
  "networkSummary", "modelSummary", "uiSummary", "persistenceReached", "storyBibleReached",
  "candidateReached", "externalRequestCount", "dataLeftDevice", "envelopeDigest",
];
const VALIDATION_KEYS = [
  "schemaVersion", "attemptId", "status", "validationDisposition", "fileExists", "fileBytes",
  "fileSha256", "shaSidecarMatches", "canonicalJson", "schemaValid", "identityValid",
  "digestValid", "statusObserved", "detailedProjectionAvailable", "minimalProjectionUsed",
  "validatorErrorCode", "validatedAt", "envelopeDigest", "observedExitCode", "stdoutBytes",
  "stderrBytes", "progressCount", "unexpectedLineCount", "safeTerminalCodeCount",
  "validationDigest",
];
const FAILURE_SHAPES = new Set([
  "ASSERTION", "GATE_ERROR", "PLAYWRIGHT_ERROR", "TIMEOUT", "PROCESS_ERROR",
  "NETWORK_POLICY_REJECTION", "EVIDENCE_VALIDATION_ERROR", "UNKNOWN_SAFE",
]);
const CHECKPOINT_STATUSES = new Set(["entered", "completed", "failed"]);
const DISPOSITIONS = new Set([
  "true", "false", "null", "missing", "present", "zero", "nonzero", "equal", "different",
  "ready", "not_ready", "indexeddb", "memory", "browser_ai", "other_executor",
  "valid_digest", "invalid_digest",
]);
const ASSERTION_IDS = new Set([
  "EDGE_CONTEXT_SINGLE_PAGE", "EDGE_INITIAL_PAGE_ABOUT_BLANK", "NETWORK_SENTINEL_ZERO_EGRESS",
  "RELEASE_IDENTITY_EXACT", "FRESH_STORAGE_EMPTY", "PROJECT_CREATED", "STORY_BIBLE_CREATED",
  "BROWSER_AI_SETUP_READY", "MODEL_CACHE_VERIFIED", "MODEL_SHARDS_VERIFIED",
  "ATTACHMENT_RIGHTS_NEGATIVE_BLOCKED", "ATTACHMENT_RIGHTS_POSITIVE_ACCEPTED",
  "T1_CONTEXT_BOUND", "FIRST_CANDIDATE_CREATED", "DIRECT_REGENERATION_CREATED",
  "REJECT_CANON_UNCHANGED", "CACHE_REUSED_AFTER_RELOAD", "CHAINED_REGENERATION_CREATED",
  "APPROVAL_REVISION_INCREMENTED_ONCE", "FINAL_RELOAD_PERSISTED", "PROFILE_DISPOSED",
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
const NETWORK_SENTINEL_BROWSER_RESULTS = new Set([
  "blocked-by-route", "native-preblock", "timeout", "unexpected-success", "not-attempted",
  "route-action-failed", "evaluation-failed", "unexpected-rejection",
]);
const NETWORK_SENTINEL_PROBE_IDS = ["HTTP_GET", "HTTP_POST", "WEBSOCKET"];
const NETWORK_SENTINEL_ROUTE_DECISIONS = new Set([
  "blocked", "continued", "not-observed", "block-failed", "continue-failed",
]);
const NETWORK_SENTINEL_REASON_CODES = new Set([
  "method-not-allowed", "network-classification-blocked", "request-body-not-allowed",
]);
const NETWORK_SENTINEL_RECEIVER_BASELINE_KEYS = [
  "tcpConnectionReceiptCount", "httpRequestReceiptCount", "httpRequestBodyByteCount",
  "webSocketUpgradeReceiptCount",
];
const NETWORK_SENTINEL_RECEIVER_BASELINE_EXPECTATIONS = [
  ["tcpConnectionReceiptCount", 1, "NETWORK_SENTINEL_RECEIVER_TCP_DELTA_ZERO", "minimum"],
  ["httpRequestReceiptCount", 1, "NETWORK_SENTINEL_BOOTSTRAP_EXACTLY_ONCE", "equal"],
  ["httpRequestBodyByteCount", 0, "NETWORK_SENTINEL_POST_BODY_REJECTED", "equal"],
  ["webSocketUpgradeReceiptCount", 0, "NETWORK_SENTINEL_RECEIVER_WEBSOCKET_DELTA_ZERO", "equal"],
];
const NETWORK_SENTINEL_ASSERTION_IDS = new Set(
  NETWORK_SENTINEL_SCALAR_EXPECTATIONS.map(([, , assertionId]) => assertionId),
);
for (const assertionId of NETWORK_SENTINEL_ASSERTION_IDS) ASSERTION_IDS.add(assertionId);
const NETWORK_SENTINEL_KEYS = [
  "schemaVersion", "status",
  ...NETWORK_SENTINEL_SCALAR_EXPECTATIONS.map(([scalarId]) => scalarId),
  "receiverBaseline", "probeRouteRecords", "firstFailedScalarAssertion",
  "matrixDigest",
];
const VALIDATION_ERROR_CODES = new Set([
  "RUNNER_TERMINAL_ENVELOPE_MISSING",
  "RUNNER_TERMINAL_ENVELOPE_SHA_MISSING",
  "RUNNER_TERMINAL_ENVELOPE_FILE_INVALID",
  "RUNNER_TERMINAL_ENVELOPE_TOO_LARGE",
  "RUNNER_TERMINAL_ENVELOPE_UTF8_INVALID",
  "RUNNER_TERMINAL_ENVELOPE_JSON_INVALID",
  "RUNNER_TERMINAL_ENVELOPE_NOT_CANONICAL",
  "RUNNER_TERMINAL_ENVELOPE_SCHEMA_INVALID",
  "RUNNER_TERMINAL_ENVELOPE_IDENTITY_INVALID",
  "RUNNER_TERMINAL_ENVELOPE_DIGEST_INVALID",
  "RUNNER_TERMINAL_ENVELOPE_SHA_MISMATCH",
  "RUNNER_TERMINAL_ENVELOPE_PATH_INVALID",
  "RUNNER_TERMINAL_ENVELOPE_REPARSE_POINT",
  "RUNNER_TERMINAL_ENVELOPE_PROCESS_TRUTH_MISMATCH",
  "RUNNER_TERMINAL_ENVELOPE_VALIDATION_DESTINATION_PREEXISTED",
  "RUNNER_TERMINAL_ENVELOPE_VALIDATION_PUBLICATION_FAILED",
]);
const FATAL_VALIDATION_ERROR_CODES = new Set([
  "RUNNER_TERMINAL_ENVELOPE_PATH_INVALID",
  "RUNNER_TERMINAL_ENVELOPE_REPARSE_POINT",
]);

class ValidationFault extends Error {
  constructor(code, detail = "") {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function samePath(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(",")}}`;
}

function makeV2PreNavigationSentinel({ failed = false, continued = false } = {}) {
  const body = {
    schemaVersion: NETWORK_SENTINEL_SCHEMA,
    status: failed ? "FAIL" : "PASS",
    ...Object.fromEntries(NETWORK_SENTINEL_SCALAR_EXPECTATIONS.map(
      ([scalarId, expectedSafeValue]) => [scalarId, expectedSafeValue],
    )),
    receiverBaseline: {
      tcpConnectionReceiptCount: 1,
      httpRequestReceiptCount: 1,
      httpRequestBodyByteCount: 0,
      webSocketUpgradeReceiptCount: 0,
    },
    probeRouteRecords: [
      {
        probeId: "HTTP_GET",
        routeObserved: continued || !failed,
        routeDecision: continued ? "continued" : failed ? "not-observed" : "blocked",
        reasonCodes: failed ? [] : ["network-classification-blocked"],
      },
      {
        probeId: "HTTP_POST",
        routeObserved: true,
        routeDecision: "blocked",
        reasonCodes: [
          "method-not-allowed", "network-classification-blocked", "request-body-not-allowed",
        ],
      },
      {
        probeId: "WEBSOCKET",
        routeObserved: true,
        routeDecision: "blocked",
        reasonCodes: ["network-classification-blocked"],
      },
    ],
    firstFailedScalarAssertion: failed ? {
      assertionId: continued
        ? "NETWORK_SENTINEL_HTTP_ROUTE_BLOCKED"
        : "NETWORK_SENTINEL_HTTP_ROUTE_OBSERVED",
      scalarId: continued ? "httpRouteBlockedCount" : "httpRouteObservedCount",
      expectedSafeValue: 2,
      actualSafeValue: 1,
    } : null,
  };
  if (failed) {
    Object.assign(body, {
      httpRouteObservedCount: continued ? 2 : 1,
      httpRouteBlockedCount: 1,
      crossOriginClassificationCount: 1,
      browserNativePreblockCount: continued ? 0 : 1,
      tcpConnectionReceiptDelta: continued ? 1 : 0,
      httpRequestReceiptDelta: continued ? 1 : 0,
      httpGetBrowserResult: continued ? "unexpected-success" : "native-preblock",
    });
  }
  return {
    ...body,
    matrixDigest: sha256(`${NETWORK_SENTINEL_SCHEMA}\n${stableStringify(body)}`),
  };
}

function redigestEnvelopeValue(envelope) {
  envelope.envelopeDigest = sha256(stableStringify(
    Object.fromEntries(Object.entries(envelope).filter(([key]) => key !== "envelopeDigest")),
  ));
  return envelope;
}

function makeV2ScalarFailureEnvelope(envelope, scalarId, actualSafeValue) {
  const value = structuredClone(envelope);
  const expectation = NETWORK_SENTINEL_SCALAR_EXPECTATIONS.find(
    ([candidateScalarId]) => candidateScalarId === scalarId,
  );
  assert.ok(expectation, `missing sentinel scalar expectation: ${scalarId}`);
  const [, expectedSafeValue, assertionId] = expectation;
  const sentinel = value.networkSummary.preNavigationSentinel;
  sentinel[scalarId] = actualSafeValue;
  sentinel.status = "FAIL";
  sentinel.firstFailedScalarAssertion = {
    assertionId,
    scalarId,
    expectedSafeValue,
    actualSafeValue,
  };
  const sentinelBody = Object.fromEntries(
    Object.entries(sentinel).filter(([key]) => key !== "matrixDigest"),
  );
  sentinel.matrixDigest = sha256(`${NETWORK_SENTINEL_SCHEMA}\n${stableStringify(sentinelBody)}`);
  const sentinelCheckpoint = value.checkpointTrail.find(
    ({ checkpoint }) => checkpoint === "network-zero-receipt-sentinel",
  );
  assert.ok(sentinelCheckpoint);
  sentinelCheckpoint.status = "failed";
  value.gateCheckpoint = "network-zero-receipt-sentinel";
  value.lastCompletedCheckpoint = value.checkpointTrail
    .filter((record) => record !== sentinelCheckpoint && record.status === "completed")
    .at(-1)?.checkpoint ?? "none";
  value.status = "FAIL";
  value.exitCode = 1;
  value.requestPhase = "bootstrap";
  value.failureShape = "ASSERTION";
  value.safeErrorCode = "RC6_2_CLOSED_AI_GATE_FAILED";
  value.firstFailedOperation = {
    operationId: "CHECKPOINT_NETWORK_ZERO_RECEIPT_SENTINEL",
    operationKind: "CHECKPOINT",
    messageDigest: sha256(`v2-sentinel-${scalarId}-operation`),
  };
  value.firstFailedAssertion = {
    assertionId,
    errorName: "AssertionError",
    errorCode: "ERR_ASSERTION",
    operator: "strictEqual",
    messageDigest: sha256(`v2-sentinel-${scalarId}-assertion`),
    expectedDisposition: "equal",
    actualDisposition: "different",
  };
  return redigestEnvelopeValue(value);
}

function redigestV2SentinelEnvelope(value) {
  const sentinel = value.networkSummary.preNavigationSentinel;
  sentinel.matrixDigest = sha256(`${NETWORK_SENTINEL_SCHEMA}\n${stableStringify(
    Object.fromEntries(Object.entries(sentinel).filter(([key]) => key !== "matrixDigest")),
  )}`);
  return redigestEnvelopeValue(value);
}

function makeV2BaselineFailureEnvelope(envelope, scalarKey, actualSafeValue) {
  const value = structuredClone(envelope);
  const expectation = NETWORK_SENTINEL_RECEIVER_BASELINE_EXPECTATIONS.find(
    ([candidateScalarKey]) => candidateScalarKey === scalarKey,
  );
  assert.ok(expectation, `missing sentinel receiver baseline expectation: ${scalarKey}`);
  const [, expectedSafeValue, assertionId] = expectation;
  const sentinel = value.networkSummary.preNavigationSentinel;
  sentinel.receiverBaseline[scalarKey] = actualSafeValue;
  sentinel.status = "FAIL";
  sentinel.firstFailedScalarAssertion = {
    assertionId,
    scalarId: `receiverBaseline.${scalarKey}`,
    expectedSafeValue,
    actualSafeValue,
  };
  sentinel.matrixDigest = sha256(`${NETWORK_SENTINEL_SCHEMA}\n${stableStringify(
    Object.fromEntries(Object.entries(sentinel).filter(([key]) => key !== "matrixDigest")),
  )}`);
  const sentinelCheckpoint = value.checkpointTrail.find(
    ({ checkpoint }) => checkpoint === "network-zero-receipt-sentinel",
  );
  assert.ok(sentinelCheckpoint);
  sentinelCheckpoint.status = "failed";
  value.gateCheckpoint = "network-zero-receipt-sentinel";
  value.lastCompletedCheckpoint = value.checkpointTrail
    .filter((record) => record !== sentinelCheckpoint && record.status === "completed")
    .at(-1)?.checkpoint ?? "none";
  value.status = "FAIL";
  value.exitCode = 1;
  value.requestPhase = "bootstrap";
  value.failureShape = "ASSERTION";
  value.safeErrorCode = "RC6_2_CLOSED_AI_GATE_FAILED";
  value.firstFailedOperation = {
    operationId: "CHECKPOINT_NETWORK_ZERO_RECEIPT_SENTINEL",
    operationKind: "CHECKPOINT",
    messageDigest: sha256(`v2-sentinel-baseline-${scalarKey}-operation`),
  };
  value.firstFailedAssertion = {
    assertionId,
    errorName: "AssertionError",
    errorCode: "ERR_ASSERTION",
    operator: "strictEqual",
    messageDigest: sha256(`v2-sentinel-baseline-${scalarKey}-assertion`),
    expectedDisposition: "equal",
    actualDisposition: "different",
  };
  return redigestEnvelopeValue(value);
}

function makeV2BootstrapReceiverFailureEnvelope(envelope, actualSafeValue) {
  const value = makeV2ScalarFailureEnvelope(
    envelope,
    "bootstrapReceiverHttpCount",
    actualSafeValue,
  );
  const sentinel = value.networkSummary.preNavigationSentinel;
  sentinel.receiverBaseline.httpRequestReceiptCount = actualSafeValue;
  sentinel.matrixDigest = sha256(`${NETWORK_SENTINEL_SCHEMA}\n${stableStringify(
    Object.fromEntries(Object.entries(sentinel).filter(([key]) => key !== "matrixDigest")),
  )}`);
  return redigestEnvelopeValue(value);
}

function makeV2NoRouteReceiptFailureEnvelope(envelope) {
  const value = structuredClone(envelope);
  const sentinel = value.networkSummary.preNavigationSentinel;
  Object.assign(sentinel, {
    status: "FAIL",
    httpRouteObservedCount: 1,
    httpRouteBlockedCount: 1,
    crossOriginClassificationCount: 1,
    tcpConnectionReceiptDelta: 1,
    httpRequestReceiptDelta: 1,
    httpGetBrowserResult: "unexpected-success",
    firstFailedScalarAssertion: {
      assertionId: "NETWORK_SENTINEL_HTTP_ROUTE_OBSERVED",
      scalarId: "httpRouteObservedCount",
      expectedSafeValue: 2,
      actualSafeValue: 1,
    },
  });
  sentinel.probeRouteRecords[0] = {
    probeId: "HTTP_GET",
    routeObserved: false,
    routeDecision: "not-observed",
    reasonCodes: [],
  };
  sentinel.matrixDigest = sha256(`${NETWORK_SENTINEL_SCHEMA}\n${stableStringify(
    Object.fromEntries(Object.entries(sentinel).filter(([key]) => key !== "matrixDigest")),
  )}`);
  const sentinelCheckpoint = value.checkpointTrail.find(
    ({ checkpoint }) => checkpoint === "network-zero-receipt-sentinel",
  );
  assert.ok(sentinelCheckpoint);
  sentinelCheckpoint.status = "failed";
  value.gateCheckpoint = "network-zero-receipt-sentinel";
  value.lastCompletedCheckpoint = value.checkpointTrail
    .filter((record) => record !== sentinelCheckpoint && record.status === "completed")
    .at(-1)?.checkpoint ?? "none";
  value.status = "FAIL";
  value.exitCode = 1;
  value.requestPhase = "bootstrap";
  value.failureShape = "ASSERTION";
  value.safeErrorCode = "RC6_2_CLOSED_AI_GATE_FAILED";
  value.firstFailedOperation = {
    operationId: "CHECKPOINT_NETWORK_ZERO_RECEIPT_SENTINEL",
    operationKind: "CHECKPOINT",
    messageDigest: sha256("v2-sentinel-no-route-receipt-operation"),
  };
  value.firstFailedAssertion = {
    assertionId: "NETWORK_SENTINEL_HTTP_ROUTE_OBSERVED",
    errorName: "AssertionError",
    errorCode: "ERR_ASSERTION",
    operator: "strictEqual",
    messageDigest: sha256("v2-sentinel-no-route-receipt-assertion"),
    expectedDisposition: "equal",
    actualDisposition: "different",
  };
  return redigestEnvelopeValue(value);
}

function makeV2EnvelopeFromHistorical(envelope, { failed = false, continued = false } = {}) {
  const value = structuredClone(envelope);
  value.schemaVersion = ENVELOPE_SCHEMA;
  value.projectionValidation.schemaExpected = ENVELOPE_SCHEMA;
  value.projectionValidation.schemaObserved = ENVELOPE_SCHEMA;
  const launch = { ...value.checkpointTrail[0], status: "completed" };
  if (launch.completedAt === null) launch.completedAt = value.completedAt;
  value.checkpointOrdinal = 2;
  value.gateCheckpoint = "network-zero-receipt-sentinel";
  value.lastCompletedCheckpoint = failed ? launch.checkpoint : "network-zero-receipt-sentinel";
  value.checkpointTrail = [launch, {
    ordinal: 2,
    checkpoint: "network-zero-receipt-sentinel",
    enteredAt: value.completedAt,
    completedAt: value.completedAt,
    status: failed ? "failed" : "completed",
  }];
  value.networkSummary.preNavigationSentinel = makeV2PreNavigationSentinel({ failed, continued });
  if (failed) {
    value.status = "FAIL";
    value.exitCode = 1;
    value.requestPhase = "bootstrap";
    value.failureShape = "ASSERTION";
    value.safeErrorCode = "RC6_2_CLOSED_AI_GATE_FAILED";
    value.firstFailedOperation = {
      operationId: "CHECKPOINT_NETWORK_ZERO_RECEIPT_SENTINEL",
      operationKind: "CHECKPOINT",
      messageDigest: sha256("v2-sentinel-operation"),
    };
    value.firstFailedAssertion = {
      assertionId: continued
        ? "NETWORK_SENTINEL_HTTP_ROUTE_BLOCKED"
        : "NETWORK_SENTINEL_HTTP_ROUTE_OBSERVED",
      errorName: "AssertionError",
      errorCode: "ERR_ASSERTION",
      operator: "strictEqual",
      messageDigest: sha256("v2-sentinel-assertion"),
      expectedDisposition: "equal",
      actualDisposition: "different",
    };
  } else {
    value.status = "PASS";
    value.exitCode = 0;
    value.failureShape = null;
    value.safeErrorCode = null;
    value.firstFailedOperation = null;
    value.firstFailedAssertion = null;
  }
  return redigestEnvelopeValue(value);
}

function makeV2TruncatedPostSentinelEnvelope(envelope, { omitSentinel = false } = {}) {
  const value = structuredClone(envelope);
  value.checkpointTrail = Array.from({ length: 32 }, (_, index) => ({
    ordinal: 10 + index,
    checkpoint: `post-sentinel-${index + 1}`,
    enteredAt: value.completedAt,
    completedAt: value.completedAt,
    status: "completed",
  }));
  value.checkpointOrdinal = value.checkpointTrail.at(-1).ordinal;
  value.gateCheckpoint = value.checkpointTrail.at(-1).checkpoint;
  value.lastCompletedCheckpoint = value.checkpointTrail.at(-1).checkpoint;
  if (omitSentinel) value.networkSummary.preNavigationSentinel = null;
  return redigestEnvelopeValue(value);
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function safeInteger(value, maximum = Number.MAX_SAFE_INTEGER, nullable = false) {
  return (nullable && value === null)
    || (Number.isSafeInteger(value) && value >= 0 && value <= maximum);
}

function signedExitCode(value, nullable = false) {
  return (nullable && value === null)
    || (Number.isSafeInteger(value) && value >= -2_147_483_648 && value <= 4_294_967_295);
}

function timestamp(value) {
  return typeof value === "string"
    && UTC_MS.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}

function safeProjection(value, depth = 0) {
  if (depth > 12) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= 1_024 && !/[\0\r\n]/u.test(value);
  if (Array.isArray(value)) return value.length <= 64 && value.every((entry) => safeProjection(entry, depth + 1));
  if (!value || typeof value !== "object") return false;
  const forbidden = /(?:authorization|cookie|header|prompt|output|message|stack|url|content|story|text)/iu;
  const keys = Object.keys(value);
  return keys.length <= 64
    && keys.every((key) => !forbidden.test(key))
    && Object.values(value).every((entry) => safeProjection(entry, depth + 1));
}

function validateProjectionShape(projection, envelopeSchema) {
  const keys = [
    "attempted", "status", "schemaExpected", "schemaObserved", "detailedProjectionAvailable",
    "minimalProjectionUsed", "validatorErrorCode", "unknownKeys", "missingKeys",
    "typeMismatchKeys", "originalProjectionDigest",
  ];
  if (!exactKeys(projection, keys)) return false;
  if (
    typeof projection.attempted !== "boolean"
    || !new Set(["PASS", "FAIL", "NOT_ATTEMPTED"]).has(projection.status)
    || projection.schemaExpected !== envelopeSchema
    || (projection.schemaObserved !== null && projection.schemaObserved !== envelopeSchema)
    || typeof projection.detailedProjectionAvailable !== "boolean"
    || typeof projection.minimalProjectionUsed !== "boolean"
    || (projection.validatorErrorCode !== null && !SAFE_CODE.test(projection.validatorErrorCode))
    || !["unknownKeys", "missingKeys", "typeMismatchKeys"].every((key) => (
      Array.isArray(projection[key])
      && projection[key].length <= 64
      && projection[key].every((entry) => SAFE_ID.test(entry))
    ))
    || (projection.originalProjectionDigest !== null && !SHA256.test(projection.originalProjectionDigest))
  ) return false;
  if (projection.detailedProjectionAvailable) {
    return projection.attempted === true
      && projection.minimalProjectionUsed === false
      && projection.status === "PASS"
      && projection.validatorErrorCode === null
      && projection.unknownKeys.length === 0
      && projection.missingKeys.length === 0
      && projection.typeMismatchKeys.length === 0
      && projection.originalProjectionDigest === null;
  }
  return projection.attempted === true
    && projection.minimalProjectionUsed === true
    && projection.status === "FAIL"
    && projection.validatorErrorCode !== null
    && projection.originalProjectionDigest !== null;
}

function validatePreNavigationSentinel(sentinel, envelope) {
  const sentinelCheckpoints = envelope.checkpointTrail.filter(
    ({ checkpoint }) => checkpoint === "network-zero-receipt-sentinel",
  );
  const sentinelWasReached = sentinelCheckpoints.length > 0;
  const trailHasTruncatedPrefix = envelope.checkpointTrail.length === 32
    && envelope.checkpointTrail[0]?.ordinal === envelope.checkpointOrdinal - 31;
  if (sentinelCheckpoints.length > 1) return false;
  if (sentinel === null) {
    return !sentinelWasReached && !trailHasTruncatedPrefix && envelope.status !== "PASS";
  }
  if (
    (!sentinelWasReached && !trailHasTruncatedPrefix)
    || !exactKeys(sentinel, NETWORK_SENTINEL_KEYS)
    || sentinel.schemaVersion !== NETWORK_SENTINEL_SCHEMA
    || !new Set(["PASS", "FAIL"]).has(sentinel.status)
    || (sentinel.status === "PASS" && sentinelWasReached
      && sentinelCheckpoints[0].status !== "completed")
    || (sentinel.status === "FAIL" && (
      !sentinelWasReached
      || sentinelCheckpoints[0].status !== "failed"
      || envelope.gateCheckpoint !== "network-zero-receipt-sentinel"
    ))
  ) {
    return false;
  }
  let firstMismatch = null;
  for (const [scalarId, expectedSafeValue, assertionId] of NETWORK_SENTINEL_SCALAR_EXPECTATIONS) {
    const actualSafeValue = sentinel[scalarId];
    if (typeof actualSafeValue !== typeof expectedSafeValue) return false;
    if (typeof actualSafeValue === "number" && !safeInteger(actualSafeValue, 1_000_000)) return false;
    if (typeof actualSafeValue === "string" && !NETWORK_SENTINEL_BROWSER_RESULTS.has(actualSafeValue)) {
      return false;
    }
    if (firstMismatch === null && actualSafeValue !== expectedSafeValue) {
      firstMismatch = { assertionId, scalarId, expectedSafeValue, actualSafeValue };
    }
  }
  if (
    !exactKeys(sentinel.receiverBaseline, NETWORK_SENTINEL_RECEIVER_BASELINE_KEYS)
    || !NETWORK_SENTINEL_RECEIVER_BASELINE_KEYS.every(
      (key) => safeInteger(sentinel.receiverBaseline[key], 1_000_000),
    )
    || !Array.isArray(sentinel.probeRouteRecords)
    || sentinel.probeRouteRecords.length !== 3
  ) return false;
  if (firstMismatch === null) {
    for (const [scalarKey, expectedSafeValue, assertionId, comparison] of
      NETWORK_SENTINEL_RECEIVER_BASELINE_EXPECTATIONS) {
      const actualSafeValue = sentinel.receiverBaseline[scalarKey];
      if (
        (comparison === "minimum" && actualSafeValue < expectedSafeValue)
        || (comparison === "equal" && actualSafeValue !== expectedSafeValue)
      ) {
        firstMismatch = {
          assertionId,
          scalarId: `receiverBaseline.${scalarKey}`,
          expectedSafeValue,
          actualSafeValue,
        };
        break;
      }
    }
  }
  const expectedReasons = [
    ["network-classification-blocked"],
    ["method-not-allowed", "network-classification-blocked", "request-body-not-allowed"],
    ["network-classification-blocked"],
  ];
  const browserResults = [
    sentinel.httpGetBrowserResult,
    sentinel.httpPostBrowserResult,
    sentinel.webSocketBrowserResult,
  ];
  for (const [index, record] of sentinel.probeRouteRecords.entries()) {
    if (
      !exactKeys(record, ["probeId", "routeObserved", "routeDecision", "reasonCodes"])
      || record.probeId !== NETWORK_SENTINEL_PROBE_IDS[index]
      || typeof record.routeObserved !== "boolean"
      || !NETWORK_SENTINEL_ROUTE_DECISIONS.has(record.routeDecision)
      || !Array.isArray(record.reasonCodes)
      || record.reasonCodes.length > 4
      || new Set(record.reasonCodes).size !== record.reasonCodes.length
      || !record.reasonCodes.every((reasonCode) => NETWORK_SENTINEL_REASON_CODES.has(reasonCode))
    ) return false;
    if (record.routeObserved && record.routeDecision === "blocked") {
      if (
        new Set([
          "native-preblock", "not-attempted", "route-action-failed", "unexpected-rejection",
        ]).has(browserResults[index])
        || stableStringify(record.reasonCodes) !== stableStringify(expectedReasons[index])
      ) return false;
    } else if (record.routeObserved && record.routeDecision === "continued") {
      if (
        record.reasonCodes.length !== 0
        || new Set([
          "blocked-by-route", "native-preblock", "not-attempted", "route-action-failed",
        ]).has(
          browserResults[index],
        )
      ) return false;
    } else if (record.routeObserved && record.routeDecision === "block-failed") {
      if (
        stableStringify(record.reasonCodes) !== stableStringify(expectedReasons[index])
        || browserResults[index] !== "route-action-failed"
      ) {
        return false;
      }
    } else if (record.routeObserved && record.routeDecision === "continue-failed") {
      if (record.reasonCodes.length !== 0 || browserResults[index] !== "route-action-failed") {
        return false;
      }
    } else if (
      record.routeObserved
      || record.routeDecision !== "not-observed"
      || record.reasonCodes.length !== 0
      || new Set(["blocked-by-route", "route-action-failed", "unexpected-rejection"]).has(
        browserResults[index],
      )
    ) return false;
  }
  const attempted = (result) => result !== "not-attempted";
  const httpRecords = sentinel.probeRouteRecords.slice(0, 2);
  if (
    sentinel.httpProbeAttemptCount !== browserResults.slice(0, 2).filter(attempted).length
    || sentinel.httpRouteObservedCount < httpRecords.filter(({ routeObserved }) => routeObserved).length
    || sentinel.httpRouteBlockedCount > sentinel.httpRouteObservedCount
    || sentinel.crossOriginClassificationCount > sentinel.httpRouteObservedCount
    || sentinel.methodRejectedCount > sentinel.httpRouteObservedCount
    || sentinel.bodyRejectedCount > sentinel.httpRouteObservedCount
    || sentinel.httpRouteBlockedCount < httpRecords.filter(
      ({ routeDecision }) => routeDecision === "blocked",
    ).length
    || sentinel.crossOriginClassificationCount < httpRecords.filter(
      ({ reasonCodes }) => reasonCodes.includes("network-classification-blocked"),
    ).length
    || sentinel.methodRejectedCount < httpRecords.filter(
      ({ reasonCodes }) => reasonCodes.includes("method-not-allowed"),
    ).length
    || sentinel.bodyRejectedCount < httpRecords.filter(
      ({ reasonCodes }) => reasonCodes.includes("request-body-not-allowed"),
    ).length
    || sentinel.webSocketProbeAttemptCount !== Number(attempted(sentinel.webSocketBrowserResult))
    || sentinel.webSocketRouteObservedCount < Number(sentinel.probeRouteRecords[2].routeObserved)
    || sentinel.webSocketRouteBlockedCount > sentinel.webSocketRouteObservedCount
    || sentinel.disallowedWebSocketCount > sentinel.webSocketRouteObservedCount
    || sentinel.webSocketRouteBlockedCount < Number(
      sentinel.probeRouteRecords[2].routeDecision === "blocked",
    )
    || sentinel.disallowedWebSocketCount < Number(
      sentinel.probeRouteRecords[2].reasonCodes.includes("network-classification-blocked"),
    )
    || sentinel.browserNativePreblockCount !== browserResults.filter(
      (result) => result === "native-preblock",
    ).length
    || (
      browserResults.slice(0, 2).includes("unexpected-success")
      && sentinel.httpRequestReceiptDelta === 0
    )
    || (
      sentinel.webSocketBrowserResult === "unexpected-success"
      && sentinel.webSocketUpgradeReceiptDelta === 0
    )
    || (sentinel.httpRequestBodyByteDelta > 0 && sentinel.httpRequestReceiptDelta === 0)
    || (sentinel.requestBodyBlocked !== (sentinel.httpRequestBodyByteDelta === 0))
    || (!sentinel.arbitraryOutboundHeaderBlocked && sentinel.httpRequestReceiptDelta === 0)
    || (
      (
        sentinel.probeRouteRecords.some(({ routeDecision }) => new Set([
          "block-failed", "continue-failed",
        ]).has(routeDecision))
        || browserResults.includes("evaluation-failed")
      )
      && sentinel.operationalErrorCount < 1
    )
  ) return false;
  if (sentinel.firstFailedScalarAssertion !== null && (
    !exactKeys(sentinel.firstFailedScalarAssertion, [
      "assertionId", "scalarId", "expectedSafeValue", "actualSafeValue",
    ])
    || !NETWORK_SENTINEL_ASSERTION_IDS.has(sentinel.firstFailedScalarAssertion.assertionId)
    || ![
      ...NETWORK_SENTINEL_SCALAR_EXPECTATIONS.map(([scalarId]) => scalarId),
      ...NETWORK_SENTINEL_RECEIVER_BASELINE_EXPECTATIONS.map(
        ([scalarKey]) => `receiverBaseline.${scalarKey}`,
      ),
    ].includes(sentinel.firstFailedScalarAssertion.scalarId)
    || !new Set(["boolean", "number", "string"]).has(
      typeof sentinel.firstFailedScalarAssertion.expectedSafeValue,
    )
    || typeof sentinel.firstFailedScalarAssertion.actualSafeValue
      !== typeof sentinel.firstFailedScalarAssertion.expectedSafeValue
    || (typeof sentinel.firstFailedScalarAssertion.expectedSafeValue === "number" && (
      !safeInteger(sentinel.firstFailedScalarAssertion.expectedSafeValue, 1_000_000)
      || !safeInteger(sentinel.firstFailedScalarAssertion.actualSafeValue, 1_000_000)
    ))
    || (typeof sentinel.firstFailedScalarAssertion.expectedSafeValue === "string" && (
      !NETWORK_SENTINEL_BROWSER_RESULTS.has(sentinel.firstFailedScalarAssertion.expectedSafeValue)
      || !NETWORK_SENTINEL_BROWSER_RESULTS.has(sentinel.firstFailedScalarAssertion.actualSafeValue)
    ))
  )) return false;
  if (
    stableStringify(sentinel.firstFailedScalarAssertion) !== stableStringify(firstMismatch)
    || sentinel.status !== (firstMismatch === null ? "PASS" : "FAIL")
    || !SHA256.test(sentinel.matrixDigest)
    || sentinel.matrixDigest !== sha256(
      `${NETWORK_SENTINEL_SCHEMA}\n${stableStringify(
        Object.fromEntries(Object.entries(sentinel).filter(([key]) => key !== "matrixDigest")),
      )}`,
    )
  ) return false;
  if (sentinel.status === "PASS" && (
    sentinel.receiverBaseline.tcpConnectionReceiptCount < 1
    || sentinel.receiverBaseline.httpRequestReceiptCount !== 1
    || sentinel.receiverBaseline.httpRequestBodyByteCount !== 0
    || sentinel.receiverBaseline.webSocketUpgradeReceiptCount !== 0
    || stableStringify(sentinel.probeRouteRecords) !== stableStringify([
      {
        probeId: "HTTP_GET", routeObserved: true, routeDecision: "blocked",
        reasonCodes: ["network-classification-blocked"],
      },
      {
        probeId: "HTTP_POST", routeObserved: true, routeDecision: "blocked",
        reasonCodes: [
          "method-not-allowed", "network-classification-blocked", "request-body-not-allowed",
        ],
      },
      {
        probeId: "WEBSOCKET", routeObserved: true, routeDecision: "blocked",
        reasonCodes: ["network-classification-blocked"],
      },
    ])
  )) return false;
  if (firstMismatch !== null) {
    return envelope.status === "FAIL"
      && envelope.firstFailedAssertion?.assertionId === firstMismatch.assertionId
      && envelope.firstFailedAssertion.errorCode === "ERR_ASSERTION"
      && envelope.firstFailedAssertion.expectedDisposition === "equal"
      && envelope.firstFailedAssertion.actualDisposition === "different";
  }
  return envelope.firstFailedAssertion === null
    || !NETWORK_SENTINEL_ASSERTION_IDS.has(envelope.firstFailedAssertion.assertionId);
}

function validateNetworkSummary(summary, envelope) {
  const countKeys = [
    "blockedRequestCount", "prohibitedExternalAiRequestCount",
    "permittedImmutableModelRequestCount", "externalRequestCount",
  ];
  return exactKeys(summary, [
    "policy", "routeInstalledBeforeNavigation", "webSocketRouteInstalledBeforeNavigation",
    ...countKeys, "dataLeftDevice", "preNavigationSentinel",
  ])
    && summary.policy === "phase-aware-context-route-default-deny-v3"
    && typeof summary.routeInstalledBeforeNavigation === "boolean"
    && typeof summary.webSocketRouteInstalledBeforeNavigation === "boolean"
    && countKeys.every((key) => safeInteger(summary[key], 1_000_000))
    && typeof summary.dataLeftDevice === "boolean"
    && summary.externalRequestCount === envelope.externalRequestCount
    && summary.dataLeftDevice === envelope.dataLeftDevice
    && validatePreNavigationSentinel(summary.preNavigationSentinel, envelope);
}

function validateModelSummary(summary) {
  const countKeys = [
    "modelPayloadRequestCount", "immutableModelRootRequestCount",
    "approvedModelRedirectRequestCount",
  ];
  return exactKeys(summary, [...countKeys, "metadataObserved"])
    && countKeys.every((key) => safeInteger(summary[key], 1_000_000))
    && typeof summary.metadataObserved === "boolean";
}

function validateUiSummary(summary) {
  return exactKeys(summary, ["alertCount", "safeErrorCodeCount"])
    && safeInteger(summary.alertCount, 1_000_000)
    && safeInteger(summary.safeErrorCodeCount, 1_000_000);
}

function validateFailureObjects(envelope) {
  if (envelope.status === "PASS") {
    return envelope.failureShape === null
      && envelope.safeErrorCode === null
      && envelope.firstFailedOperation === null
      && envelope.firstFailedAssertion === null;
  }
  if (!FAILURE_SHAPES.has(envelope.failureShape) || !SAFE_CODE.test(envelope.safeErrorCode)) return false;
  if (!exactKeys(envelope.firstFailedOperation, ["operationId", "operationKind", "messageDigest"])) return false;
  if (
    !SAFE_ID.test(envelope.firstFailedOperation.operationId)
    || !SAFE_ID.test(envelope.firstFailedOperation.operationKind)
    || !SHA256.test(envelope.firstFailedOperation.messageDigest)
  ) return false;
  if (envelope.firstFailedAssertion === null) return true;
  if (!exactKeys(envelope.firstFailedAssertion, [
    "assertionId", "errorName", "errorCode", "operator", "messageDigest",
    "expectedDisposition", "actualDisposition",
  ])) return false;
  return ["assertionId", "errorName", "errorCode", "operator"].every(
    (key) => SAFE_ID.test(envelope.firstFailedAssertion[key]),
  ) && ASSERTION_IDS.has(envelope.firstFailedAssertion.assertionId)
    && SHA256.test(envelope.firstFailedAssertion.messageDigest)
    && DISPOSITIONS.has(envelope.firstFailedAssertion.expectedDisposition)
    && DISPOSITIONS.has(envelope.firstFailedAssertion.actualDisposition);
}

function validateEnvelopeShape(envelope) {
  if (!exactKeys(envelope, ENVELOPE_KEYS)) return false;
  const envelopeSchema = envelope.schemaVersion;
  if (
    envelopeSchema !== ENVELOPE_SCHEMA
    || !new Set(["PASS", "FAIL"]).has(envelope.status)
    || !ATTEMPT.test(envelope.attemptId)
    || !AUTHORIZATION.test(envelope.authorizationId)
    || !["authorizationDigest", "runtimeReceiptDigest", "wrapperDigest", "runnerDigest", "contractDigest"]
      .every((key) => SHA256.test(envelope[key]))
    || !SHA256.test(envelope.envelopeDigest)
    || !COMMIT.test(envelope.productCommit)
    || !COMMIT.test(envelope.controlCommit)
    || envelope.mode !== "generation"
    || !timestamp(envelope.startedAt)
    || !timestamp(envelope.completedAt)
    || Date.parse(envelope.completedAt) < Date.parse(envelope.startedAt)
    || !signedExitCode(envelope.exitCode)
    || !SAFE_ID.test(envelope.requestPhase)
    || !SAFE_ID.test(envelope.gateCheckpoint)
    || !SAFE_ID.test(envelope.lastCompletedCheckpoint)
    || !safeInteger(envelope.checkpointOrdinal, 100_000)
    || !Array.isArray(envelope.checkpointTrail)
    || envelope.checkpointTrail.length > 32
    || !validateFailureObjects(envelope)
    || !validateProjectionShape(envelope.projectionValidation, envelopeSchema)
    || typeof envelope.freshBrowserContext !== "boolean"
    || !new Set([null, "wrapper-owned", "runner-created"]).has(envelope.profileOwnership)
    || (envelope.profilePathDigest !== null && !SHA256.test(envelope.profilePathDigest))
    || !["profileDisposed", "persistenceReached", "storyBibleReached", "candidateReached", "dataLeftDevice"]
      .every((key) => typeof envelope[key] === "boolean")
    || !safeInteger(envelope.externalRequestCount, 1_000_000)
    || !safeProjection(envelope.modelSummary)
    || !safeProjection(envelope.uiSummary)
    || !validateNetworkSummary(envelope.networkSummary, envelope)
    || !validateModelSummary(envelope.modelSummary)
    || !validateUiSummary(envelope.uiSummary)
  ) return false;
  let previous = -1;
  for (const [index, record] of envelope.checkpointTrail.entries()) {
    if (
      !exactKeys(record, ["ordinal", "checkpoint", "enteredAt", "completedAt", "status"])
      || !safeInteger(record.ordinal, 100_000)
      || record.ordinal <= previous
      || (index > 0 && record.ordinal !== previous + 1)
      || !SAFE_ID.test(record.checkpoint)
      || !timestamp(record.enteredAt)
      || (record.completedAt !== null && !timestamp(record.completedAt))
      || !CHECKPOINT_STATUSES.has(record.status)
      || ((record.status === "entered") !== (record.completedAt === null))
    ) return false;
    previous = record.ordinal;
  }
  if (
    envelope.status === "PASS"
    && (
      envelope.freshBrowserContext !== true
      || envelope.profileDisposed !== true
      || envelope.persistenceReached !== true
      || envelope.storyBibleReached !== true
      || envelope.candidateReached !== true
      || envelope.externalRequestCount !== 0
      || envelope.dataLeftDevice !== false
      || envelope.projectionValidation.detailedProjectionAvailable !== true
      || envelope.projectionValidation.minimalProjectionUsed !== false
      || !new Set(["wrapper-owned", "runner-created"]).has(envelope.profileOwnership)
      || !SHA256.test(envelope.profilePathDigest)
    )
  ) return false;
  if (envelope.candidateReached && !envelope.storyBibleReached) return false;
  if (envelope.persistenceReached && !envelope.candidateReached) return false;
  if (envelope.checkpointTrail.length === 0) return false;
  if (
    envelope.checkpointTrail[0].ordinal !== 1
    && (
      envelope.checkpointTrail.length !== 32
      || envelope.checkpointTrail[0].ordinal !== previous - 31
    )
  ) return false;
  const completed = envelope.checkpointTrail.filter((record) => record.status === "completed").at(-1);
  return envelope.checkpointOrdinal === previous
    && envelope.gateCheckpoint === envelope.checkpointTrail.at(-1).checkpoint
    && envelope.lastCompletedCheckpoint === (completed?.checkpoint ?? "none");
}

function envelopeSchemaFailureReason(envelope) {
  if (!exactKeys(envelope, ENVELOPE_KEYS)) return "keys";
  if (!validateFailureObjects(envelope)) return "failure";
  if (!validateProjectionShape(envelope.projectionValidation, envelope.schemaVersion)) return "projection";
  if (!validateNetworkSummary(envelope.networkSummary, envelope)) return "network";
  if (!safeProjection(envelope.modelSummary)) return "model";
  if (!safeProjection(envelope.uiSummary)) return "ui";
  if (envelope.status === "PASS") {
    if (!envelope.freshBrowserContext) return "fresh";
    if (!envelope.profileDisposed) return "disposed";
    if (!envelope.persistenceReached) return "persistence";
    if (!envelope.storyBibleReached) return "story";
    if (!envelope.candidateReached) return "candidate";
  }
  return "other";
}

function identityValid(envelope, input) {
  return envelope.attemptId === input.expectedAttemptId
    && envelope.authorizationId === input.expectedAuthorizationId
    && envelope.authorizationDigest === input.expectedAuthorizationDigest
    && envelope.productCommit === input.expectedProductCommit
    && envelope.controlCommit === input.expectedControlCommit
    && envelope.deploymentId === input.expectedDeploymentId
    && envelope.productionOrigin === input.expectedProductionOrigin
    && envelope.releaseTag === input.expectedReleaseTag
    && envelope.releaseRevision === input.expectedReleaseRevision
    && envelope.runtimeReceiptDigest === input.expectedRuntimeReceiptDigest
    && envelope.wrapperDigest === input.expectedWrapperDigest
    && envelope.runnerDigest === input.expectedRunnerDigest
    && envelope.contractDigest === input.expectedContractDigest
    && envelope.mode === input.expectedMode;
}

function processTruthValid(envelope, input) {
  if (envelope.exitCode !== input.observedExitCode) return false;
  if (envelope.status === "PASS") {
    return envelope.exitCode === 0
      && input.unexpectedLineCount === 0
      && input.safeTerminalCodeCount === 0;
  }
  return envelope.exitCode !== 0
    && input.unexpectedLineCount === 0
    && input.safeTerminalCodeCount === 1;
}

function requireInput(input) {
  const keys = [
    "envelopePath", "shaPath", "validationPath", "expectedAttemptDirectory",
    "expectedAttemptId", "expectedAuthorizationId", "expectedAuthorizationDigest",
    "expectedProductCommit", "expectedControlCommit", "expectedDeploymentId",
    "expectedProductionOrigin", "expectedReleaseTag", "expectedReleaseRevision",
    "expectedRuntimeReceiptDigest", "expectedWrapperDigest", "expectedRunnerDigest",
    "expectedContractDigest", "expectedMode", "observedExitCode", "stdoutBytes", "stderrBytes",
    "progressCount", "unexpectedLineCount", "safeTerminalCodeCount", "validatedAt",
  ];
  if (!exactKeys(input, keys)) throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_PATH_INVALID", "keys");
  if (
    ![input.envelopePath, input.shaPath, input.validationPath, input.expectedAttemptDirectory]
      .every((value) => typeof value === "string" && isAbsolute(value) && resolve(value) === value)
    || dirname(input.envelopePath) !== input.expectedAttemptDirectory
    || dirname(input.shaPath) !== input.expectedAttemptDirectory
    || dirname(input.validationPath) !== input.expectedAttemptDirectory
    || basename(input.envelopePath) !== "runner-terminal-envelope.json"
    || basename(input.shaPath) !== "runner-terminal-envelope.sha256"
    || basename(input.validationPath) !== "runner-envelope-validation.json"
    || !ATTEMPT.test(input.expectedAttemptId)
    || !AUTHORIZATION.test(input.expectedAuthorizationId)
    || ![input.expectedAuthorizationDigest, input.expectedRuntimeReceiptDigest,
      input.expectedWrapperDigest, input.expectedRunnerDigest, input.expectedContractDigest]
      .every((value) => SHA256.test(value))
    || !COMMIT.test(input.expectedProductCommit)
    || !COMMIT.test(input.expectedControlCommit)
    || input.expectedMode !== "generation"
    || !signedExitCode(input.observedExitCode, true)
    || !["stdoutBytes", "stderrBytes"].every((key) => safeInteger(input[key]))
    || !["progressCount", "unexpectedLineCount", "safeTerminalCodeCount"]
      .every((key) => safeInteger(input[key]))
    || !timestamp(input.validatedAt)
  ) throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_PATH_INVALID", "values");
}

async function pathTruth(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_PATH_INVALID");
  }
}

async function assertParent(path, expectedDirectory) {
  const parent = await lstat(dirname(path));
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_REPARSE_POINT");
  if (!samePath(await realpath(dirname(path)), expectedDirectory)) {
    throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_REPARSE_POINT");
  }
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.nlink === right.nlink;
}

async function readBoundedRegularFile(path, {
  maximumBytes,
  expectedBytes,
  code = "RUNNER_TERMINAL_ENVELOPE_PATH_INVALID",
}) {
  const pathTruthBefore = await lstat(path);
  if (
    !pathTruthBefore.isFile()
    || pathTruthBefore.isSymbolicLink()
    || pathTruthBefore.nlink !== 1
    || pathTruthBefore.size > maximumBytes
    || pathTruthBefore.size !== expectedBytes
    || !samePath(await realpath(path), path)
  ) throw new ValidationFault(code);
  let handle;
  try {
    handle = await open(path, "r");
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || !sameFileIdentity(pathTruthBefore, before)) {
      throw new ValidationFault(code);
    }
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) throw new ValidationFault(code);
      offset += bytesRead;
    }
    if ((await handle.read(Buffer.alloc(1), 0, 1, bytes.length)).bytesRead !== 0) {
      throw new ValidationFault(code);
    }
    const after = await handle.stat();
    const pathTruthAfter = await lstat(path);
    if (
      !sameFileIdentity(before, after)
      || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs
      || !sameFileIdentity(after, pathTruthAfter)
      || !samePath(await realpath(path), path)
    ) throw new ValidationFault(code);
    return bytes;
  } catch (error) {
    if (error instanceof ValidationFault) throw error;
    throw new ValidationFault(code);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function publishCreateNew(path, bytes) {
  if (await pathTruth(path)) throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_VALIDATION_DESTINATION_PREEXISTED");
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  let handle;
  try {
    handle = await open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    const temporaryBytes = await readBoundedRegularFile(temporary, {
      maximumBytes: bytes.length,
      expectedBytes: bytes.length,
      code: "RUNNER_TERMINAL_ENVELOPE_VALIDATION_PUBLICATION_FAILED",
    });
    if (!temporaryBytes.equals(bytes)) throw new Error("readback");
    await link(temporary, path);
    await unlink(temporary);
    const publishedBytes = await readBoundedRegularFile(path, {
      maximumBytes: bytes.length,
      expectedBytes: bytes.length,
      code: "RUNNER_TERMINAL_ENVELOPE_VALIDATION_PUBLICATION_FAILED",
    });
    if (!publishedBytes.equals(bytes)) throw new Error("readback");
  } catch (error) {
    if (error instanceof ValidationFault) throw error;
    throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_VALIDATION_PUBLICATION_FAILED");
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

function blankValidation(input) {
  return {
    schemaVersion: VALIDATION_SCHEMA,
    attemptId: input.expectedAttemptId,
    status: "FAIL",
    validationDisposition: "INVALID",
    fileExists: false,
    fileBytes: 0,
    fileSha256: null,
    shaSidecarMatches: false,
    canonicalJson: false,
    schemaValid: false,
    identityValid: false,
    digestValid: false,
    statusObserved: null,
    detailedProjectionAvailable: false,
    minimalProjectionUsed: true,
    validatorErrorCode: "RUNNER_TERMINAL_ENVELOPE_FILE_INVALID",
    validatedAt: input.validatedAt,
    envelopeDigest: null,
    observedExitCode: input.observedExitCode,
    stdoutBytes: input.stdoutBytes,
    stderrBytes: input.stderrBytes,
    progressCount: input.progressCount,
    unexpectedLineCount: input.unexpectedLineCount,
    safeTerminalCodeCount: input.safeTerminalCodeCount,
  };
}

async function validateEnvelope(input) {
  requireInput(input);
  await Promise.all([
    assertParent(input.envelopePath, input.expectedAttemptDirectory),
    assertParent(input.shaPath, input.expectedAttemptDirectory),
    assertParent(input.validationPath, input.expectedAttemptDirectory),
  ]);
  const validation = blankValidation(input);
  let envelope = null;
  try {
    const envelopeTruth = await pathTruth(input.envelopePath);
    if (!envelopeTruth) throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_MISSING");
    validation.fileExists = true;
    if (envelopeTruth.isSymbolicLink()) throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_REPARSE_POINT");
    if (!envelopeTruth.isFile() || envelopeTruth.nlink !== 1) {
      throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_PATH_INVALID");
    }
    if (!samePath(await realpath(input.envelopePath), input.envelopePath)) {
      throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_REPARSE_POINT");
    }
    if (!Number.isSafeInteger(envelopeTruth.size) || envelopeTruth.size < 0) {
      throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_PATH_INVALID");
    }
    validation.fileBytes = envelopeTruth.size;
    if (envelopeTruth.size === 0) {
      throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_FILE_INVALID");
    }
    if (envelopeTruth.size > MAX_ENVELOPE_BYTES) {
      throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_TOO_LARGE");
    }
    const bytes = await readBoundedRegularFile(input.envelopePath, {
      maximumBytes: MAX_ENVELOPE_BYTES,
      expectedBytes: envelopeTruth.size,
    });
    validation.fileSha256 = sha256(bytes);
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_UTF8_INVALID");
    }
    let source;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_UTF8_INVALID");
    }
    try {
      envelope = JSON.parse(source);
    } catch {
      throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_JSON_INVALID");
    }
    validation.canonicalJson = stableStringify(envelope) === source;
    if (!validation.canonicalJson) throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_NOT_CANONICAL");
    validation.schemaValid = validateEnvelopeShape(envelope);
    if (!validation.schemaValid) {
      throw new ValidationFault(
        "RUNNER_TERMINAL_ENVELOPE_SCHEMA_INVALID",
        envelopeSchemaFailureReason(envelope),
      );
    }
    validation.statusObserved = envelope.status;
    validation.envelopeDigest = envelope.envelopeDigest;
    validation.detailedProjectionAvailable = envelope.projectionValidation.detailedProjectionAvailable;
    validation.minimalProjectionUsed = envelope.projectionValidation.minimalProjectionUsed;
    validation.digestValid = envelope.envelopeDigest === sha256(stableStringify(
      Object.fromEntries(Object.entries(envelope).filter(([key]) => key !== "envelopeDigest")),
    ));
    if (!validation.digestValid) throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_DIGEST_INVALID");
    validation.identityValid = identityValid(envelope, input);
    if (!validation.identityValid) throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_IDENTITY_INVALID");
    if (!processTruthValid(envelope, input)) {
      throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_PROCESS_TRUTH_MISMATCH");
    }
    const shaTruth = await pathTruth(input.shaPath);
    if (!shaTruth) throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_SHA_MISSING");
    if (shaTruth.isSymbolicLink()) {
      throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_REPARSE_POINT");
    }
    if (!shaTruth.isFile() || shaTruth.nlink !== 1) {
      throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_PATH_INVALID");
    }
    if (!samePath(await realpath(input.shaPath), input.shaPath)) {
      throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_REPARSE_POINT");
    }
    if (shaTruth.size !== SHA_SIDECAR_BYTES) {
      throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_SHA_MISMATCH");
    }
    const shaBytes = await readBoundedRegularFile(input.shaPath, {
      maximumBytes: SHA_SIDECAR_BYTES,
      expectedBytes: SHA_SIDECAR_BYTES,
    });
    validation.shaSidecarMatches = shaBytes.length === SHA_SIDECAR_BYTES
      && shaBytes.equals(Buffer.from(`${validation.fileSha256}\n`, "ascii"));
    if (!validation.shaSidecarMatches) throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_SHA_MISMATCH");
    validation.status = "PASS";
    validation.validationDisposition = "VALIDATED";
    validation.validatorErrorCode = null;
  } catch (error) {
    if (FATAL_VALIDATION_ERROR_CODES.has(error?.code)) throw error;
    const code = VALIDATION_ERROR_CODES.has(error?.code)
      ? error.code
      : "RUNNER_TERMINAL_ENVELOPE_FILE_INVALID";
    validation.status = "FAIL";
    validation.validationDisposition = code === "RUNNER_TERMINAL_ENVELOPE_MISSING"
      ? "MISSING"
      : "INVALID";
    validation.validatorErrorCode = code;
  }
  const complete = {
    ...validation,
    validationDigest: sha256(stableStringify(validation)),
  };
  assert.equal(exactKeys(complete, VALIDATION_KEYS), true);
  const bytes = Buffer.from(stableStringify(complete), "utf8");
  await publishCreateNew(input.validationPath, bytes);
  const validationReadback = await readBoundedRegularFile(input.validationPath, {
    maximumBytes: bytes.length,
    expectedBytes: bytes.length,
    code: "RUNNER_TERMINAL_ENVELOPE_VALIDATION_PUBLICATION_FAILED",
  });
  if (!validationReadback.equals(bytes)) {
    throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_VALIDATION_PUBLICATION_FAILED");
  }
  return {
    schemaVersion: VALIDATION_SCHEMA,
    status: "PASS",
    validationStatus: complete.status,
    validationDisposition: complete.validationDisposition,
    attemptId: complete.attemptId,
    envelopeDigest: complete.envelopeDigest,
    statusObserved: complete.statusObserved,
    validationDigest: complete.validationDigest,
    validationFileSha256: sha256(bytes),
  };
}

async function readBoundedStdin() {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > MAX_STDIN_BYTES) throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_PATH_INVALID");
    chunks.push(chunk);
  }
  const source = Buffer.concat(chunks).toString("utf8");
  if (!source) throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_PATH_INVALID");
  try {
    return JSON.parse(source);
  } catch {
    throw new ValidationFault("RUNNER_TERMINAL_ENVELOPE_PATH_INVALID");
  }
}

function runChild(script, args, options = {}) {
  return new Promise((settle, reject) => {
    const maxBytes = 2_097_152;
    let outputBytes = 0;
    let terminal = false;
    const child = spawn(process.execPath, [script, ...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let timer;
    const bounded = (collection) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxBytes && !terminal) {
        terminal = true;
        child.kill("SIGKILL");
        reject(new Error("RUNNER_ENVELOPE_TEST_CHILD_OUTPUT_TOO_LARGE"));
        return;
      }
      collection.push(chunk);
    };
    child.stdout.on("data", bounded(stdout));
    child.stderr.on("data", bounded(stderr));
    child.on("error", (error) => {
      if (!terminal) {
        terminal = true;
        clearTimeout(timer);
        reject(error);
      }
    });
    timer = setTimeout(() => {
      if (terminal) return;
      terminal = true;
      child.kill("SIGKILL");
      reject(new Error("RUNNER_ENVELOPE_TEST_CHILD_TIMEOUT"));
    }, 50_000);
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      if (terminal) return;
      terminal = true;
      if (signal !== null) {
        reject(new Error("RUNNER_ENVELOPE_TEST_CHILD_SIGNAL"));
        return;
      }
      settle({
        exitCode,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    if (options.stdin !== undefined) child.stdin.end(options.stdin);
  });
}

async function readBoundedJsonFile(path, maximum = MAX_ENVELOPE_BYTES) {
  const truth = await lstat(path);
  assert.equal(truth.isFile(), true);
  assert.equal(truth.isSymbolicLink(), false);
  assert.equal(truth.nlink, 1);
  assert.ok(truth.size > 0 && truth.size <= maximum);
  const bytes = await readBoundedRegularFile(path, {
    maximumBytes: maximum,
    expectedBytes: truth.size,
  });
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function fixtureIdentity(root) {
  const attemptId = "C7-PROD-BROWSER-20260812T120000000Z-0123456789abcdef0123456789abcdef";
  return {
    attemptId,
    authorizationId: "C7-PROD-BROWSER-AUTH-20260812T115900000Z-fedcba9876543210fedcba9876543210",
    authorizationDigest: "1".repeat(64),
    productCommit: "29fc6e742672bb07187765d34ea818afdadf56ae",
    controlCommit: "7dea0b8dd488a0f2a24132266944cb95b2f15ca9",
    deploymentId: "dpl_test",
    productionOrigin: "https://example.invalid",
    releaseTag: "novel-ai-p24b-conversation-first-studio-rc6.2",
    releaseRevision: "rc6.2",
    runtimeReceiptDigest: "2".repeat(64),
    wrapperDigest: "3".repeat(64),
    runnerDigest: "4".repeat(64),
    contractDigest: "5".repeat(64),
    envelopePath: join(root, "runner-terminal-envelope.json"),
    shaPath: join(root, "runner-terminal-envelope.sha256"),
    validationPath: join(root, "runner-envelope-validation.json"),
  };
}

function runnerEnvironment(identity, scenario) {
  return {
    ...process.env,
    RC6_2_CLOSED_AI_BASE_URL: identity.productionOrigin,
    RC6_2_CLOSED_AI_ALLOW_HTTP_LOCAL: "0",
    EXPECTED_COMMIT: identity.productCommit,
    EXPECTED_DEPLOYMENT_ID: identity.deploymentId,
    RC6_2_CLOSED_AI_EDGE_EXECUTABLE: join(dirname(identity.envelopePath), "never-launched-msedge.exe"),
    RC6_2_FORMAL_ATTEMPT_DIRECTORY: dirname(identity.envelopePath),
    RC6_2_FORMAL_ATTEMPT_ID: identity.attemptId,
    RC6_2_FORMAL_AUTHORIZATION_ID: identity.authorizationId,
    RC6_2_FORMAL_AUTHORIZATION_DIGEST: identity.authorizationDigest,
    RC6_2_FORMAL_CONTROL_COMMIT: identity.controlCommit,
    RC6_2_FORMAL_RELEASE_TAG: identity.releaseTag,
    RC6_2_FORMAL_RELEASE_REVISION: identity.releaseRevision,
    RC6_2_FORMAL_RUNTIME_RECEIPT_DIGEST: identity.runtimeReceiptDigest,
    RC6_2_FORMAL_WRAPPER_DIGEST: identity.wrapperDigest,
    RC6_2_FORMAL_RUNNER_DIGEST: identity.runnerDigest,
    RC6_2_FORMAL_CONTRACT_DIGEST: identity.contractDigest,
    RC6_2_FORMAL_RUNNER_ENVELOPE_PATH: identity.envelopePath,
    RC6_2_FORMAL_RUNNER_ENVELOPE_SHA_PATH: identity.shaPath,
    RC6_2_RUNNER_ENVELOPE_TEST_SCENARIO: scenario,
  };
}

function validationInput(identity, processTruth, validationPath = identity.validationPath) {
  const stderrLines = processTruth.stderr.split(/\r?\n/gu).filter(Boolean);
  return {
    envelopePath: identity.envelopePath,
    shaPath: identity.shaPath,
    validationPath,
    expectedAttemptDirectory: dirname(identity.envelopePath),
    expectedAttemptId: identity.attemptId,
    expectedAuthorizationId: identity.authorizationId,
    expectedAuthorizationDigest: identity.authorizationDigest,
    expectedProductCommit: identity.productCommit,
    expectedControlCommit: identity.controlCommit,
    expectedDeploymentId: identity.deploymentId,
    expectedProductionOrigin: identity.productionOrigin,
    expectedReleaseTag: identity.releaseTag,
    expectedReleaseRevision: identity.releaseRevision,
    expectedRuntimeReceiptDigest: identity.runtimeReceiptDigest,
    expectedWrapperDigest: identity.wrapperDigest,
    expectedRunnerDigest: identity.runnerDigest,
    expectedContractDigest: identity.contractDigest,
    expectedMode: "generation",
    observedExitCode: processTruth.exitCode,
    stdoutBytes: Buffer.byteLength(processTruth.stdout),
    stderrBytes: Buffer.byteLength(processTruth.stderr),
    progressCount: stderrLines.filter((line) => (
      /^\[RC6\.2 Closed AI\] (?:setup|candidate generation|T1 analysis) in progress \([0-9]+s\)$/u
        .test(line)
    )).length,
    unexpectedLineCount: stderrLines.filter((line) => (
      !/^\[RC6\.2 Closed AI\] (?:setup|candidate generation|T1 analysis) in progress \([0-9]+s\)$/u
        .test(line)
      && line !== "RC6_2_RUNNER_TERMINAL_FAIL"
    )).length,
    safeTerminalCodeCount: stderrLines.filter(
      (line) => line === "RC6_2_RUNNER_TERMINAL_FAIL",
    ).length,
    validatedAt: new Date().toISOString(),
  };
}

function domainReceipt(schemaVersion, body, digestKey) {
  return {
    ...body,
    [digestKey]: sha256(`${schemaVersion}\n${stableStringify(body)}`),
  };
}

async function runFullStubTerminalChain({ root, runner, validator }) {
  const state = await import("./rc6-2-formal-attempt-state.mjs");
  const terminal = await import("./rc6-2-terminal-evidence.mjs");
  const { mkdir } = await import("node:fs/promises");
  const chainRoot = join(root, "FULL_STUB_TERMINAL_CHAIN");
  const registryRoot = join(chainRoot, "registry");
  const attemptRoot = join(chainRoot, "attempts");
  await mkdir(chainRoot);
  await mkdir(registryRoot);
  await mkdir(attemptRoot);
  const baseTime = "2026-08-12T12:00:00.000Z";
  const controlCommit = "7dea0b8dd488a0f2a24132266944cb95b2f15ca9";
  const attemptId = state.generateFormalAttemptId({
    now: new Date(baseTime),
    random: Buffer.from("0123456789abcdef0123456789abcdef", "hex"),
  });
  const authorizationId = state.generateFormalAuthorizationId({
    now: new Date(baseTime),
    random: Buffer.from("fedcba9876543210fedcba9876543210", "hex"),
  });
  const authorization = state.createAttemptAuthorization({
    registryRoot,
    authorizationId,
    authorizedControlCommit: controlCommit,
    authorizedProductCommit: terminal.RC6_2_PRODUCT_COMMIT,
    authorizedDeploymentId: terminal.RC6_2_DEPLOYMENT_ID,
    authorizedAt: baseTime,
  });
  const wrapperDigest = sha256("full-chain-wrapper");
  const runnerDigest = sha256("full-chain-runner");
  const contractDigest = sha256("full-chain-contract");
  const created = state.createFormalProductionBrowserAttempt({
    attemptRoot,
    registryRoot,
    attemptId,
    authorizationId,
    authorizationDigest: authorization.authorizationDigest,
    productCommit: terminal.RC6_2_PRODUCT_COMMIT,
    controlCommit,
    deploymentId: terminal.RC6_2_DEPLOYMENT_ID,
    productionOrigin: terminal.RC6_2_PRODUCTION_ORIGIN,
    releaseTag: terminal.RC6_2_RELEASE_TAG,
    releaseRevision: terminal.RC6_2_RELEASE_REVISION,
    wrapperDigest,
    runnerDigest,
    contractDigest,
    createdAt: baseTime,
  });
  const toolchainBody = {
    schemaVersion: "p24b-rc6.2-production-browser-toolchain-receipt-v1",
    packageJsonDigest: sha256("full-chain-package"),
    pnpmLockDigest: sha256("full-chain-lock"),
    dependencies: [],
    dependencyLinks: {},
    edge: {},
  };
  const toolchainReceipt = domainReceipt(
    toolchainBody.schemaVersion,
    toolchainBody,
    "proofDigest",
  );
  const runtimeBody = {
    schemaVersion: "p24b-rc6.2-production-browser-runtime-receipt-v2",
    preflightRunId: sha256("full-chain-preflight").slice(0, 32),
    executionMode: "FormalBrowserGate",
    productCommit: terminal.RC6_2_PRODUCT_COMMIT,
    controlCommit,
    productionDeploymentId: terminal.RC6_2_DEPLOYMENT_ID,
    productionOrigin: terminal.RC6_2_PRODUCTION_ORIGIN,
    releaseTag: terminal.RC6_2_RELEASE_TAG,
    releaseRevision: terminal.RC6_2_RELEASE_REVISION,
    createdAt: new Date(Date.parse(baseTime) + 1_000).toISOString(),
    bridgeHealth: {
      status: "PASS", processAlive: true, pid: process.pid,
      protocolVersion: "novel-local-bridge/v1", bindAddress: "127.0.0.1",
      modelAvailable: true, active: 0, queued: 0,
      serverDigest: sha256("full-chain-bridge-server"),
      coreDigest: sha256("full-chain-bridge-core"),
    },
    hubHealth: {
      status: "PASS", processAlive: true, pid: process.pid,
      protocolVersion: "novel-private-hub/v1", bindAddress: "127.0.0.1",
      modelAvailable: true, active: 0, queued: 0,
      serverDigest: sha256("full-chain-hub-server"),
    },
    ollamaHealth: {
      status: "PASS", processAlive: true, bindAddress: "127.0.0.1",
      version: "0.12.0", idle: true, runningModelCount: 0, modelInstalled: true,
    },
    ollamaPid: 101,
    modelId: "qwen2.5:3b",
    modelDigest: sha256("full-chain-model"),
    toolchainReceiptDigest: toolchainReceipt.proofDigest,
    readOnly: true,
    mutationCount: 0,
    source: "production-browser-preflight-read-only-v1",
  };
  const runtimeReceipt = domainReceipt(runtimeBody.schemaVersion, runtimeBody, "digest");
  let lease = created.lease;
  let eventOffset = 1;
  const transition = (eventType, eventBody = {}) => {
    eventOffset += 1;
    lease = state.transitionAttempt({
      attemptDirectory: created.attemptDirectory,
      eventType,
      eventBody,
      occurredAt: new Date(Date.parse(baseTime) + eventOffset * 1_000).toISOString(),
      expectedRevision: lease.revision,
      expectedState: lease.state,
      expectedAttemptId: attemptId,
      expectedControlCommit: controlCommit,
      expectedProductCommit: terminal.RC6_2_PRODUCT_COMMIT,
      expectedDeploymentId: terminal.RC6_2_DEPLOYMENT_ID,
      expectedProductionOrigin: terminal.RC6_2_PRODUCTION_ORIGIN,
      expectedAuthorizationDigest: authorization.authorizationDigest,
    }).lease;
  };
  transition("PREFLIGHT_PASSED", {
    runtimeReceiptDigest: runtimeReceipt.digest,
    wrapperDigest,
    runnerDigest,
    contractDigest,
  });
  transition("LAUNCH_COMMITTED");
  transition("RUNNER_STARTED", { runnerPid: process.pid });
  transition("BROWSER_STARTED", {
    persistentContextEstablished: true,
    networkRoutesInstalled: true,
    productInteractionStarted: false,
  });
  const identity = {
    attemptId,
    authorizationId,
    authorizationDigest: authorization.authorizationDigest,
    productCommit: terminal.RC6_2_PRODUCT_COMMIT,
    controlCommit,
    deploymentId: terminal.RC6_2_DEPLOYMENT_ID,
    productionOrigin: terminal.RC6_2_PRODUCTION_ORIGIN,
    releaseTag: terminal.RC6_2_RELEASE_TAG,
    releaseRevision: terminal.RC6_2_RELEASE_REVISION,
    runtimeReceiptDigest: runtimeReceipt.digest,
    wrapperDigest,
    runnerDigest,
    contractDigest,
    envelopePath: join(created.attemptDirectory, "runner-terminal-envelope.json"),
    shaPath: join(created.attemptDirectory, "runner-terminal-envelope.sha256"),
    validationPath: join(created.attemptDirectory, "runner-envelope-validation.json"),
  };
  const child = await runChild(runner, ["generation"], {
    cwd: dirname(runner),
    env: runnerEnvironment(identity, "ASSERTION_FAIL"),
  });
  assert.equal(child.exitCode, 1);
  const validatorChild = await runChild(validator, ["validate-envelope"], {
    cwd: dirname(runner),
    env: process.env,
    stdin: stableStringify(validationInput(identity, child)),
  });
  assert.equal(validatorChild.exitCode, 0);
  const envelope = await readBoundedJsonFile(identity.envelopePath);
  const envelopeValidation = await readBoundedJsonFile(identity.validationPath, MAX_STDIN_BYTES);
  assert.equal(envelopeValidation.validationDisposition, "VALIDATED");
  const runnerFailure = {
    schemaVersion: "p24b-rc6.2-formal-runner-failure-v2",
    attemptId,
    status: "FAIL",
    reasonCode: "FORMAL_RUNNER_FAILED",
    exitCode: child.exitCode,
    runnerEnvelopeDigest: envelope.envelopeDigest,
    runnerEnvelopeValidationDigest: envelopeValidation.validationDigest,
  };
  const profileCleanup = {
    schemaVersion: "p24b-rc6.2-formal-profile-cleanup-v1",
    attemptId,
    status: "PASS",
    profileDisposed: true,
    edgeResidueCount: 0,
  };
  const processCleanup = {
    schemaVersion: "p24b-rc6.2-formal-process-cleanup-v1",
    attemptId,
    status: "PASS",
    runnerResidueCount: 0,
    edgeResidueCount: 0,
  };
  transition("RUNNER_COMPLETED", {
    outcome: "FAIL",
    exitCode: child.exitCode,
    runnerEvidenceDigest: sha256(Buffer.from(stableStringify(runnerFailure), "utf8")),
  });
  transition("CLEANUP_COMPLETED", {
    profileCleanupDigest: sha256(Buffer.from(stableStringify(profileCleanup), "utf8")),
    processCleanupDigest: sha256(Buffer.from(stableStringify(processCleanup), "utf8")),
  });
  transition("TERMINAL_FAIL", { reasonCode: "FORMAL_BROWSER_ASSERTION_FAILED" });
  const bundleDirectory = join(created.attemptDirectory, "terminal-evidence");
  const finalized = await terminal.finalizeFormalProductionBrowserTerminalEvidence({
    attemptDirectory: created.attemptDirectory,
    bundleDirectory,
    expectedControlCommit: controlCommit,
    startedAt: baseTime,
    completedAt: lease.updatedAt,
    runtimeReceipt,
    toolchainReceipt,
    wrapperResult: {
      schemaVersion: "p24b-rc6.2-formal-wrapper-result-v1",
      attemptId,
      status: "FAIL",
      completedAt: lease.updatedAt,
    },
    runnerFailure,
    browserFailure: {
      schemaVersion: "p24b-rc6.2-formal-browser-failure-v1",
      attemptId,
      status: "FAIL",
      reasonCode: "FORMAL_BROWSER_ASSERTION_FAILED",
    },
    profileCleanup,
    processCleanup,
  });
  const validation = await terminal.validateTerminalEvidenceBundle({
    bundleDirectory,
    expectedControlCommit: controlCommit,
  });
  const manifestBytes = await readFile(join(bundleDirectory, terminal.TERMINAL_MANIFEST_FILE));
  const manifestSidecar = await readFile(join(bundleDirectory, terminal.TERMINAL_MANIFEST_SHA_FILE), "utf8");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const requiredRunnerFiles = [
    terminal.RUNNER_TERMINAL_ENVELOPE_FILE,
    terminal.RUNNER_TERMINAL_ENVELOPE_SHA_FILE,
    terminal.RUNNER_ENVELOPE_VALIDATION_FILE,
  ];
  return validation.status === "PASS"
    && validation.attemptState === "TERMINAL_FAIL"
    && validation.containsCredentialValues === false
    && finalized.manifestFileSha256 === sha256(manifestBytes)
    && manifestSidecar === `${sha256(manifestBytes)}\n`
    && requiredRunnerFiles.every((path) => (
      manifest.files.some((record) => record.path === path && record.present === true)
    ));
}

async function runTests() {
  const root = await mkdtemp(join(tmpdir(), "rc6-2-runner-envelope-tests-"));
  const runner = resolve(dirname(fileURLToPath(import.meta.url)), "run-rc6-2-closed-agent-browser.mjs");
  const self = fileURLToPath(import.meta.url);
  const tests = [];
  const record = (name, passed) => {
    assert.equal(passed, true, name);
    tests.push({ name, status: "PASS" });
  };
  try {
    for (const [name, scenario, expectedStatus, expectedShape] of [
      ["A_FAIL_CHILD", "PLAYWRIGHT_FAIL", "FAIL", "PLAYWRIGHT_ERROR"],
      ["B_PASS_CHILD", "PASS", "PASS", null],
      ["I_ASSERTION", "ASSERTION_FAIL", "FAIL", "ASSERTION"],
      ["J_PLAYWRIGHT", "PLAYWRIGHT_FAIL", "FAIL", "PLAYWRIGHT_ERROR"],
    ]) {
      const dir = join(root, name);
      await (await import("node:fs/promises")).mkdir(dir);
      const identity = fixtureIdentity(dir);
      const child = await runChild(runner, ["generation"], { cwd: dirname(runner), env: runnerEnvironment(identity, scenario) });
      const envelope = JSON.parse(await readFile(identity.envelopePath, "utf8"));
      record(name, child.exitCode === (expectedStatus === "PASS" ? 0 : 1)
        && envelope.status === expectedStatus
        && envelope.failureShape === expectedShape
        && child.stderr.startsWith("[RC6.2 Closed AI] setup in progress (0s)\n")
        && child.stderr.endsWith(expectedStatus === "PASS" ? "(2s)\n" : "RC6_2_RUNNER_TERMINAL_FAIL\n")
        && !child.stderr.includes("{")
        && envelope.checkpointTrail.length <= 32
        && (expectedStatus === "PASS"
          ? envelope.networkSummary.preNavigationSentinel?.status === "PASS"
          : envelope.networkSummary.preNavigationSentinel === null)
        && (name !== "I_ASSERTION"
          || envelope.firstFailedAssertion?.assertionId === "FRESH_STORAGE_EMPTY")
        && (name !== "J_PLAYWRIGHT"
          || (envelope.gateCheckpoint === "launch"
            && envelope.lastCompletedCheckpoint === "none"
            && envelope.firstFailedOperation?.operationId === "CHECKPOINT_LAUNCH")));
      const validatorPath = identity.validationPath;
      const input = validationInput(identity, child, validatorPath);
      requireInput(input);
      const validationChild = await runChild(self, ["validate-envelope"], {
        cwd: dirname(runner),
        env: process.env,
        stdin: stableStringify(input),
      });
      if (!validationChild.stdout) {
        throw new Error(`validator failed: ${validationChild.exitCode} ${validationChild.stderr}`);
      }
      const summary = JSON.parse(validationChild.stdout);
      if (summary.validationStatus !== "PASS") {
        const debugValidation = JSON.parse(await readFile(validatorPath, "utf8"));
        throw new Error(`${name}: ${envelopeSchemaFailureReason(envelope)}: ${stableStringify(debugValidation)}`);
      }
      record(`${name}_VALIDATION`, validationChild.exitCode === 0
        && validationChild.stderr === ""
        && summary.validationStatus === "PASS"
        && SHA256.test(summary.validationFileSha256));
    }

    const mutationBase = join(root, "mutations");
    await (await import("node:fs/promises")).mkdir(mutationBase);
    const baseIdentity = fixtureIdentity(mutationBase);
    const baseChild = await runChild(runner, ["generation"], {
      cwd: dirname(runner), env: runnerEnvironment(baseIdentity, "PLAYWRIGHT_FAIL"),
    });
    const baseEnvelope = JSON.parse(await readFile(baseIdentity.envelopePath, "utf8"));
    const mutations = [
      ["C_MALFORMED", null, "{"],
      ["E_WRONG_ATTEMPT", (value) => { value.attemptId = value.attemptId.replace(/.$/u, "0"); }, null, true],
      ["WRONG_PRODUCT", (value) => { value.productCommit = "0".repeat(40); }, null, true],
      ["F_WRONG_CONTROL", (value) => { value.controlCommit = "0".repeat(40); }, null, true],
      ["WRONG_DEPLOYMENT", (value) => { value.deploymentId = "dpl_wrong"; }, null, true],
      ["WRONG_ORIGIN", (value) => { value.productionOrigin = "https://wrong.invalid"; }, null, true],
      ["G_WRONG_DIGEST", (value) => { value.envelopeDigest = "0".repeat(64); }],
      ["REMOVE_CHECKPOINT", (value) => { delete value.gateCheckpoint; }],
      ["REMOVE_LAST_COMPLETED", (value) => { delete value.lastCompletedCheckpoint; }],
      ["REMOVE_FAILURE_SHAPE", (value) => { delete value.failureShape; }],
      ["REMOVE_SAFE_ERROR", (value) => { delete value.safeErrorCode; }],
      ["BAD_ORDINAL", (value) => { value.checkpointOrdinal += 1; }],
      ["BAD_TRAIL", (value) => { value.checkpointTrail[0].status = "unknown"; }],
      ["UNEXPECTED_KEY", (value) => { value.prompt = "forbidden"; }],
      ["RAW_MESSAGE", (value) => { value.message = "forbidden"; }],
      ["RAW_STACK", (value) => { value.stack = "forbidden"; }],
      ["RAW_PROMPT", (value) => { value.prompt = "forbidden"; }],
      ["RAW_OUTPUT", (value) => { value.output = "forbidden"; }],
      ["RAW_COOKIE", (value) => { value.cookie = "forbidden"; }],
      ["RAW_AUTHORIZATION_HEADER", (value) => { value.authorizationHeader = "forbidden"; }],
      ["BAD_EXTERNAL_COUNT", (value) => { value.externalRequestCount = -1; }],
      ["BAD_PROFILE_DISPOSED", (value) => { value.profileDisposed = "yes"; }],
      ["BAD_PROJECTION", (value) => { value.projectionValidation.missingKeys = ["raw prompt"]; }],
      ["MISSING_PROJECTION_DISPOSITION", (value) => {
        delete value.projectionValidation.minimalProjectionUsed;
      }],
      ["BAD_ASSERTION_ID", (value) => {
        value.firstFailedAssertion = {
          assertionId: "UNRECOGNIZED_ASSERTION",
          errorName: "AssertionError",
          errorCode: "ERR_ASSERTION",
          operator: "strictEqual",
          messageDigest: "a".repeat(64),
          expectedDisposition: "equal",
          actualDisposition: "different",
        };
      }, null, false, true],
      ["MINIMAL_ATTEMPTED_FALSE", (value) => {
        value.projectionValidation = {
          ...value.projectionValidation,
          attempted: false,
          status: "FAIL",
          detailedProjectionAvailable: false,
          minimalProjectionUsed: true,
          validatorErrorCode: "RUNNER_TERMINAL_ENVELOPE_SCHEMA_INVALID",
          originalProjectionDigest: "a".repeat(64),
        };
      }, null, false, true],
      ["MINIMAL_ERROR_NULL", (value) => {
        value.projectionValidation = {
          ...value.projectionValidation,
          status: "FAIL",
          detailedProjectionAvailable: false,
          minimalProjectionUsed: true,
          validatorErrorCode: null,
          originalProjectionDigest: "a".repeat(64),
        };
      }, null, false, true],
      ["MINIMAL_ORIGINAL_DIGEST_NULL", (value) => {
        value.projectionValidation = {
          ...value.projectionValidation,
          status: "FAIL",
          detailedProjectionAvailable: false,
          minimalProjectionUsed: true,
          validatorErrorCode: "RUNNER_TERMINAL_ENVELOPE_SCHEMA_INVALID",
          originalProjectionDigest: null,
        };
      }, null, false, true],
      ["FAIL_CANDIDATE_WITHOUT_STORY", (value) => {
        value.candidateReached = true;
        value.storyBibleReached = false;
        value.persistenceReached = false;
      }, null, false, true],
      ["FAIL_PERSISTENCE_WITHOUT_CANDIDATE", (value) => {
        value.storyBibleReached = true;
        value.candidateReached = false;
        value.persistenceReached = true;
      }, null, false, true],
      ["FAIL_TRAIL_DISCONTINUITY", (value) => {
        const tail = value.checkpointTrail[0];
        value.checkpointOrdinal = 3;
        value.checkpointTrail = [{
          ordinal: 1,
          checkpoint: "bootstrap",
          enteredAt: tail.enteredAt,
          completedAt: tail.enteredAt,
          status: "completed",
        }, { ...tail, ordinal: 3 }];
        value.lastCompletedCheckpoint = "bootstrap";
      }, null, false, true],
      ["FAIL_GATE_CHECKPOINT_NOT_TAIL", (value) => {
        value.gateCheckpoint = "bootstrap";
      }, null, false, true],
      ["FAIL_LAST_COMPLETED_INCORRECT", (value) => {
        value.lastCompletedCheckpoint = "launch";
      }, null, false, true],
      ["FAIL_NETWORK_EMPTY", (value) => { value.networkSummary = {}; }, null, false, true],
      ["FAIL_NETWORK_CONTRADICTION", (value) => {
        value.networkSummary.externalRequestCount = value.externalRequestCount + 1;
      }, null, false, true],
      ["FAIL_NETWORK_MISSING_KEY", (value) => {
        delete value.networkSummary.policy;
      }, null, false, true],
      ["FAIL_MODEL_EMPTY", (value) => { value.modelSummary = {}; }, null, false, true],
      ["FAIL_UI_EMPTY", (value) => { value.uiSummary = {}; }, null, false, true],
    ];
    const mutationValidationByName = new Map();
    for (const [name, mutate, raw, identityMutation = false, recomputeDigest = false] of mutations) {
      const dir = join(root, name);
      await (await import("node:fs/promises")).mkdir(dir);
      const identity = fixtureIdentity(dir);
      const envelope = structuredClone(baseEnvelope);
      mutate?.(envelope);
      if (identityMutation || recomputeDigest) {
        envelope.envelopeDigest = sha256(stableStringify(
          Object.fromEntries(Object.entries(envelope).filter(([key]) => key !== "envelopeDigest")),
        ));
      }
      const bytes = Buffer.from(raw ?? stableStringify(envelope));
      await writeFile(identity.envelopePath, bytes, { flag: "wx" });
      await writeFile(identity.shaPath, `${sha256(bytes)}\n`, { flag: "wx" });
      const child = await runChild(self, ["validate-envelope"], {
        cwd: dirname(runner), env: process.env,
        stdin: stableStringify(validationInput(identity, baseChild)),
      });
      const summary = JSON.parse(child.stdout);
      const validation = JSON.parse(await readFile(identity.validationPath, "utf8"));
      mutationValidationByName.set(name, validation);
      record(name, child.exitCode === 0
        && summary.validationStatus === "FAIL"
        && (!identityMutation
          || validation.validatorErrorCode === "RUNNER_TERMINAL_ENVELOPE_IDENTITY_INVALID")
        && (name !== "G_WRONG_DIGEST"
          || (validation.schemaValid === true
            && validation.digestValid === false
            && validation.validatorErrorCode === "RUNNER_TERMINAL_ENVELOPE_DIGEST_INVALID"))
        && (!recomputeDigest
          || validation.validatorErrorCode === "RUNNER_TERMINAL_ENVELOPE_SCHEMA_INVALID"));
    }

    const passMutationDir = join(root, "PASS_MUTATIONS_SOURCE");
    await (await import("node:fs/promises")).mkdir(passMutationDir);
    const passIdentity = fixtureIdentity(passMutationDir);
    const passChild = await runChild(runner, ["generation"], {
      cwd: dirname(runner), env: runnerEnvironment(passIdentity, "PASS"),
    });
    const passEnvelope = JSON.parse(await readFile(passIdentity.envelopePath, "utf8"));
    const validateV2Fixture = async (name, envelope, processTruth) => {
      const dir = join(root, name);
      await (await import("node:fs/promises")).mkdir(dir);
      const identity = fixtureIdentity(dir);
      const bytes = Buffer.from(stableStringify(envelope));
      await writeFile(identity.envelopePath, bytes, { flag: "wx" });
      await writeFile(identity.shaPath, `${sha256(bytes)}\n`, { flag: "wx" });
      const child = await runChild(self, ["validate-envelope"], {
        cwd: dirname(runner),
        env: process.env,
        stdin: stableStringify(validationInput(identity, processTruth)),
      });
      return {
        child,
        summary: JSON.parse(child.stdout),
        validation: JSON.parse(await readFile(identity.validationPath, "utf8")),
      };
    };
    const v2PassEnvelope = makeV2EnvelopeFromHistorical(passEnvelope);
    const v2Pass = await validateV2Fixture("V2_PASS_EXACT_SENTINEL", v2PassEnvelope, passChild);
    record("V2_PASS_EXACT_SENTINEL", v2Pass.child.exitCode === 0
      && v2Pass.summary.validationStatus === "PASS"
      && v2Pass.validation.validationDisposition === "VALIDATED");
    for (const [scalarId, actualSafeValue, assertionId] of [
      ["tcpConnectionReceiptDelta", 1, "NETWORK_SENTINEL_RECEIVER_TCP_DELTA_ZERO"],
      ["browserContextCount", 2, "NETWORK_SENTINEL_CONTEXT_SINGLE_PAGE"],
      ["pageCount", 2, "NETWORK_SENTINEL_CONTEXT_SINGLE_PAGE"],
      ["serviceWorkerCount", 1, "NETWORK_SENTINEL_SERVICE_WORKERS_ZERO"],
    ]) {
      const scalarEnvelope = makeV2ScalarFailureEnvelope(
        v2PassEnvelope,
        scalarId,
        actualSafeValue,
      );
      const scalarResult = await validateV2Fixture(
        `V2_SCALAR_ASSERTION_${scalarId}`,
        scalarEnvelope,
        baseChild,
      );
      record(`V2_SCALAR_ASSERTION_${scalarId}`, scalarResult.child.exitCode === 0
        && scalarResult.summary.validationStatus === "PASS"
        && scalarEnvelope.networkSummary.preNavigationSentinel
          .firstFailedScalarAssertion.assertionId === assertionId
        && scalarEnvelope.firstFailedAssertion.assertionId === assertionId);
    }
    const blockedTimeoutEnvelope = makeV2ScalarFailureEnvelope(
      v2PassEnvelope,
      "httpGetBrowserResult",
      "timeout",
    );
    const blockedTimeout = await validateV2Fixture(
      "V2_OBSERVED_BLOCKED_TIMEOUT_FAILURE_EXACT",
      blockedTimeoutEnvelope,
      baseChild,
    );
    record("V2_OBSERVED_BLOCKED_TIMEOUT_FAILURE_EXACT", blockedTimeout.child.exitCode === 0
      && blockedTimeout.summary.validationStatus === "PASS"
      && blockedTimeoutEnvelope.networkSummary.preNavigationSentinel
        .probeRouteRecords[0].routeDecision === "blocked"
      && blockedTimeoutEnvelope.networkSummary.preNavigationSentinel.httpGetBrowserResult
        === "timeout");
    const noRouteReceiptEnvelope = makeV2NoRouteReceiptFailureEnvelope(v2PassEnvelope);
    const noRouteReceipt = await validateV2Fixture(
      "V2_NO_ROUTE_UNEXPECTED_SUCCESS_RECEIPT_FAILURE_EXACT",
      noRouteReceiptEnvelope,
      baseChild,
    );
    record("V2_NO_ROUTE_UNEXPECTED_SUCCESS_RECEIPT_FAILURE_EXACT",
      noRouteReceipt.child.exitCode === 0
      && noRouteReceipt.summary.validationStatus === "PASS"
      && noRouteReceiptEnvelope.networkSummary.preNavigationSentinel
        .probeRouteRecords[0].routeDecision === "not-observed"
      && noRouteReceiptEnvelope.networkSummary.preNavigationSentinel.httpRequestReceiptDelta === 1);
    const bootstrapReceiverEnvelope = makeV2BootstrapReceiverFailureEnvelope(v2PassEnvelope, 2);
    const bootstrapReceiver = await validateV2Fixture(
      "V2_BOOTSTRAP_RECEIVER_COUNT_FAILURE_EXACT",
      bootstrapReceiverEnvelope,
      baseChild,
    );
    record("V2_BOOTSTRAP_RECEIVER_COUNT_FAILURE_EXACT", bootstrapReceiver.child.exitCode === 0
      && bootstrapReceiver.summary.validationStatus === "PASS"
      && bootstrapReceiverEnvelope.networkSummary.preNavigationSentinel
        .firstFailedScalarAssertion.scalarId === "bootstrapReceiverHttpCount"
      && bootstrapReceiverEnvelope.firstFailedAssertion.assertionId
        === "NETWORK_SENTINEL_BOOTSTRAP_EXACTLY_ONCE");
    for (const [scalarKey, actualSafeValue, assertionId] of [
      ["tcpConnectionReceiptCount", 0, "NETWORK_SENTINEL_RECEIVER_TCP_DELTA_ZERO"],
      ["httpRequestReceiptCount", 2, "NETWORK_SENTINEL_BOOTSTRAP_EXACTLY_ONCE"],
      ["httpRequestBodyByteCount", 1, "NETWORK_SENTINEL_POST_BODY_REJECTED"],
      ["webSocketUpgradeReceiptCount", 1, "NETWORK_SENTINEL_RECEIVER_WEBSOCKET_DELTA_ZERO"],
    ]) {
      const baselineEnvelope = makeV2BaselineFailureEnvelope(
        v2PassEnvelope,
        scalarKey,
        actualSafeValue,
      );
      const baselineResult = await validateV2Fixture(
        `V2_BASELINE_ASSERTION_${scalarKey}`,
        baselineEnvelope,
        baseChild,
      );
      record(`V2_BASELINE_ASSERTION_${scalarKey}`, baselineResult.child.exitCode === 0
        && baselineResult.summary.validationStatus === "PASS"
        && baselineEnvelope.networkSummary.preNavigationSentinel
          .firstFailedScalarAssertion.assertionId === assertionId
        && baselineEnvelope.firstFailedAssertion.assertionId === assertionId);
    }
    for (const [name, scalarId, actualSafeValue, applyTruth] of [
      ["V2_DUPLICATE_HTTP_ROUTE_FAILURE_EXACT", "httpRouteObservedCount", 3, (sentinel) => {
        sentinel.httpRouteBlockedCount = 3;
        sentinel.crossOriginClassificationCount = 3;
      }],
      ["V2_DUPLICATE_WEBSOCKET_ROUTE_FAILURE_EXACT", "webSocketRouteObservedCount", 2,
        (sentinel) => {
          sentinel.webSocketRouteBlockedCount = 2;
          sentinel.disallowedWebSocketCount = 2;
        }],
      ["V2_BLOCK_ACTION_FAILURE_EXACT", "httpRouteBlockedCount", 1, (sentinel) => {
        sentinel.probeRouteRecords[0].routeDecision = "block-failed";
        sentinel.httpGetBrowserResult = "route-action-failed";
        sentinel.operationalErrorCount = 1;
      }],
      ["V2_CONTINUE_ACTION_FAILURE_EXACT", "httpRouteBlockedCount", 1, (sentinel) => {
        sentinel.probeRouteRecords[0].routeDecision = "continue-failed";
        sentinel.probeRouteRecords[0].reasonCodes = [];
        sentinel.httpGetBrowserResult = "route-action-failed";
        sentinel.operationalErrorCount = 1;
      }],
      ["V2_EVALUATION_FAILURE_EXACT", "httpGetBrowserResult", "evaluation-failed",
        (sentinel) => { sentinel.operationalErrorCount = 1; }],
      ["V2_LATE_OPERATIONAL_FAILURE_EXACT", "operationalErrorCount", 1, () => undefined],
    ]) {
      const envelope = makeV2ScalarFailureEnvelope(v2PassEnvelope, scalarId, actualSafeValue);
      applyTruth(envelope.networkSummary.preNavigationSentinel);
      redigestV2SentinelEnvelope(envelope);
      const result = await validateV2Fixture(name, envelope, baseChild);
      record(name, result.child.exitCode === 0
        && result.summary.validationStatus === "PASS"
        && result.validation.statusObserved === "FAIL");
    }
    for (const [name, applyTruth] of [
      ["V2_BLOCK_ACTION_ZERO_OPERATIONAL_ERROR_REJECTED", (sentinel) => {
        sentinel.probeRouteRecords[0].routeDecision = "block-failed";
        sentinel.httpGetBrowserResult = "route-action-failed";
      }],
      ["V2_CONTINUE_ACTION_ZERO_OPERATIONAL_ERROR_REJECTED", (sentinel) => {
        sentinel.probeRouteRecords[0].routeDecision = "continue-failed";
        sentinel.probeRouteRecords[0].reasonCodes = [];
        sentinel.httpGetBrowserResult = "route-action-failed";
      }],
      ["V2_EVALUATION_ZERO_OPERATIONAL_ERROR_REJECTED", (sentinel) => {
        sentinel.httpGetBrowserResult = "evaluation-failed";
      }],
    ]) {
      const envelope = makeV2ScalarFailureEnvelope(
        v2PassEnvelope,
        "httpGetBrowserResult",
        name.includes("EVALUATION") ? "evaluation-failed" : "route-action-failed",
      );
      applyTruth(envelope.networkSummary.preNavigationSentinel);
      redigestV2SentinelEnvelope(envelope);
      const result = await validateV2Fixture(name, envelope, baseChild);
      record(name, result.child.exitCode === 0
        && result.summary.validationStatus === "FAIL"
        && result.validation.validatorErrorCode
          === "RUNNER_TERMINAL_ENVELOPE_SCHEMA_INVALID");
    }
    const v2TruncatedPassEnvelope = makeV2TruncatedPostSentinelEnvelope(v2PassEnvelope);
    const v2TruncatedPass = await validateV2Fixture(
      "V2_PASS_TRUNCATED_POST_SENTINEL_TRAIL",
      v2TruncatedPassEnvelope,
      passChild,
    );
    record("V2_PASS_TRUNCATED_POST_SENTINEL_TRAIL", v2TruncatedPass.child.exitCode === 0
      && v2TruncatedPass.summary.validationStatus === "PASS"
      && v2TruncatedPassEnvelope.checkpointTrail[0].ordinal > 1
      && v2TruncatedPassEnvelope.networkSummary.preNavigationSentinel.status === "PASS");
    const v2TruncatedOmissionEnvelope = makeV2TruncatedPostSentinelEnvelope(
      v2PassEnvelope,
      { omitSentinel: true },
    );
    const v2TruncatedOmission = await validateV2Fixture(
      "V2_TRUNCATED_POST_SENTINEL_OMISSION_REJECTED",
      v2TruncatedOmissionEnvelope,
      passChild,
    );
    record("V2_TRUNCATED_POST_SENTINEL_OMISSION_REJECTED",
      v2TruncatedOmission.child.exitCode === 0
      && v2TruncatedOmission.summary.validationStatus === "FAIL"
      && v2TruncatedOmission.validation.validatorErrorCode
        === "RUNNER_TERMINAL_ENVELOPE_SCHEMA_INVALID");
    const v2ForgedShortPrefixEnvelope = structuredClone(v2PassEnvelope);
    v2ForgedShortPrefixEnvelope.checkpointTrail = [{
      ordinal: 2,
      checkpoint: "post-sentinel-forged",
      enteredAt: v2ForgedShortPrefixEnvelope.completedAt,
      completedAt: v2ForgedShortPrefixEnvelope.completedAt,
      status: "completed",
    }];
    v2ForgedShortPrefixEnvelope.checkpointOrdinal = 2;
    v2ForgedShortPrefixEnvelope.gateCheckpoint = "post-sentinel-forged";
    v2ForgedShortPrefixEnvelope.lastCompletedCheckpoint = "post-sentinel-forged";
    redigestEnvelopeValue(v2ForgedShortPrefixEnvelope);
    const v2ForgedShortPrefix = await validateV2Fixture(
      "V2_FORGED_SHORT_TRUNCATED_PREFIX_REJECTED",
      v2ForgedShortPrefixEnvelope,
      passChild,
    );
    record("V2_FORGED_SHORT_TRUNCATED_PREFIX_REJECTED",
      v2ForgedShortPrefix.child.exitCode === 0
      && v2ForgedShortPrefix.summary.validationStatus === "FAIL"
      && v2ForgedShortPrefix.validation.validatorErrorCode
        === "RUNNER_TERMINAL_ENVELOPE_SCHEMA_INVALID");
    const v2FailureEnvelope = makeV2EnvelopeFromHistorical(passEnvelope, { failed: true });
    const v2Failure = await validateV2Fixture("V2_SENTINEL_FAILURE_EXACT", v2FailureEnvelope, baseChild);
    record("V2_SENTINEL_FAILURE_EXACT", v2Failure.child.exitCode === 0
      && v2Failure.summary.validationStatus === "PASS"
      && v2Failure.validation.statusObserved === "FAIL"
      && v2FailureEnvelope.networkSummary.preNavigationSentinel.firstFailedScalarAssertion.scalarId
        === "httpRouteObservedCount");
    const v2ContinuedFailureEnvelope = makeV2EnvelopeFromHistorical(passEnvelope, {
      failed: true,
      continued: true,
    });
    const v2ContinuedFailure = await validateV2Fixture(
      "V2_SENTINEL_CONTINUED_RECEIPT_FAILURE_EXACT",
      v2ContinuedFailureEnvelope,
      baseChild,
    );
    const continuedSentinel = v2ContinuedFailureEnvelope.networkSummary.preNavigationSentinel;
    record("V2_SENTINEL_CONTINUED_RECEIPT_FAILURE_EXACT",
      v2ContinuedFailure.child.exitCode === 0
      && v2ContinuedFailure.summary.validationStatus === "PASS"
      && v2ContinuedFailure.validation.statusObserved === "FAIL"
      && continuedSentinel.probeRouteRecords[0].routeDecision === "continued"
      && continuedSentinel.httpGetBrowserResult === "unexpected-success"
      && continuedSentinel.tcpConnectionReceiptDelta === 1
      && continuedSentinel.httpRequestReceiptDelta === 1
      && continuedSentinel.firstFailedScalarAssertion.assertionId
        === "NETWORK_SENTINEL_HTTP_ROUTE_BLOCKED");
    for (const [name, source, mutate, redigestMatrix = false] of [
      ["V2_MATRIX_DIGEST_TAMPER", v2PassEnvelope, (value) => {
        value.networkSummary.preNavigationSentinel.matrixDigest = "0".repeat(64);
      }],
      ["V2_SCALAR_FAILURE_OMITTED", v2PassEnvelope, (value) => {
        value.networkSummary.preNavigationSentinel.httpRouteObservedCount = 1;
      }, true],
      ["V2_ROUTE_RECORD_ORDER_TAMPER", v2PassEnvelope, (value) => {
        value.networkSummary.preNavigationSentinel.probeRouteRecords.reverse();
      }, true],
      ["V2_COUNTER_ROUTE_CONTRADICTION", v2FailureEnvelope, (value) => {
        value.networkSummary.preNavigationSentinel.httpRouteObservedCount = 0;
        value.networkSummary.preNavigationSentinel.firstFailedScalarAssertion.actualSafeValue = 0;
      }, true],
      ["V2_TOP_LEVEL_SCALAR_BINDING_TAMPER", v2FailureEnvelope, (value) => {
        value.firstFailedAssertion.assertionId = "NETWORK_SENTINEL_HTTP_ROUTE_BLOCKED";
      }],
      ["V2_RAW_BOOTSTRAP_URL_REJECTED", v2PassEnvelope, (value) => {
        value.networkSummary.preNavigationSentinel.bootstrapUrl = "http://127.0.0.1/forbidden";
      }, true],
      ["V2_SENTINEL_MISSING_AFTER_CHECKPOINT", v2PassEnvelope, (value) => {
        value.networkSummary.preNavigationSentinel = null;
      }],
      ["V2_CONTINUED_BLOCKED_RESULT_CONTRADICTION", v2ContinuedFailureEnvelope, (value) => {
        value.networkSummary.preNavigationSentinel.httpGetBrowserResult = "blocked-by-route";
      }, true],
      ["V2_CONTINUED_REASON_CONTRADICTION", v2ContinuedFailureEnvelope, (value) => {
        value.networkSummary.preNavigationSentinel.probeRouteRecords[0].reasonCodes = [
          "network-classification-blocked",
        ];
      }, true],
      ["V2_NOT_OBSERVED_SUCCESS_ZERO_RECEIPT_CONTRADICTION", v2FailureEnvelope, (value) => {
        value.networkSummary.preNavigationSentinel.httpGetBrowserResult = "unexpected-success";
      }, true],
      ["V2_WEBSOCKET_SUCCESS_ZERO_RECEIPT_CONTRADICTION", v2PassEnvelope, (value) => {
        value.networkSummary.preNavigationSentinel.webSocketBrowserResult = "unexpected-success";
      }, true],
      ["V2_BOOTSTRAP_BASELINE_CONTRADICTION", v2PassEnvelope, (value) => {
        value.networkSummary.preNavigationSentinel.receiverBaseline.httpRequestReceiptCount = 2;
      }, true],
      ["V2_SENTINEL_CHECKPOINT_STATUS_CONTRADICTION", v2FailureEnvelope, (value) => {
        value.checkpointTrail.at(-1).status = "completed";
        value.lastCompletedCheckpoint = "network-zero-receipt-sentinel";
      }],
    ]) {
      const envelope = structuredClone(source);
      mutate(envelope);
      if (redigestMatrix && envelope.networkSummary.preNavigationSentinel !== null) {
        const sentinelBody = Object.fromEntries(Object.entries(
          envelope.networkSummary.preNavigationSentinel,
        ).filter(([key]) => key !== "matrixDigest"));
        envelope.networkSummary.preNavigationSentinel.matrixDigest = sha256(
          `${NETWORK_SENTINEL_SCHEMA}\n${stableStringify(sentinelBody)}`,
        );
      }
      redigestEnvelopeValue(envelope);
      const result = await validateV2Fixture(name, envelope, envelope.status === "PASS" ? passChild : baseChild);
      record(name, result.child.exitCode === 0
        && result.summary.validationStatus === "FAIL"
        && result.validation.validatorErrorCode === "RUNNER_TERMINAL_ENVELOPE_SCHEMA_INVALID");
    }
    const v1Downgrade = structuredClone(v2PassEnvelope);
    v1Downgrade.schemaVersion = "p24b-rc6.2-formal-runner-terminal-envelope-v1";
    v1Downgrade.projectionValidation.schemaExpected = v1Downgrade.schemaVersion;
    v1Downgrade.projectionValidation.schemaObserved = v1Downgrade.schemaVersion;
    delete v1Downgrade.networkSummary.preNavigationSentinel;
    redigestEnvelopeValue(v1Downgrade);
    const downgrade = await validateV2Fixture("V1_RUNTIME_DOWNGRADE_REJECTED", v1Downgrade, passChild);
    record("V1_RUNTIME_DOWNGRADE_REJECTED", downgrade.child.exitCode === 0
      && downgrade.summary.validationStatus === "FAIL"
      && downgrade.validation.validatorErrorCode === "RUNNER_TERMINAL_ENVELOPE_SCHEMA_INVALID");
    for (const [name, mutate] of [
      ["PASS_FRESH_CONTEXT_FALSE", (value) => { value.freshBrowserContext = false; }],
      ["PASS_PROFILE_NOT_DISPOSED", (value) => { value.profileDisposed = false; }],
      ["PASS_PERSISTENCE_NOT_REACHED", (value) => { value.persistenceReached = false; }],
      ["PASS_STORY_BIBLE_NOT_REACHED", (value) => { value.storyBibleReached = false; }],
      ["PASS_CANDIDATE_NOT_REACHED", (value) => { value.candidateReached = false; }],
      ["PASS_EXTERNAL_REQUEST_NONZERO", (value) => { value.externalRequestCount = 1; }],
      ["PASS_DATA_LEFT_DEVICE", (value) => { value.dataLeftDevice = true; }],
      ["PASS_MINIMAL_PROJECTION", (value) => {
        value.projectionValidation.status = "FAIL";
        value.projectionValidation.detailedProjectionAvailable = false;
        value.projectionValidation.minimalProjectionUsed = true;
        value.projectionValidation.validatorErrorCode = "RUNNER_TERMINAL_ENVELOPE_SCHEMA_INVALID";
        value.projectionValidation.originalProjectionDigest = "a".repeat(64);
      }],
      ["PASS_PROFILE_OWNERSHIP_NULL", (value) => { value.profileOwnership = null; }],
      ["PASS_PROFILE_DIGEST_NULL", (value) => { value.profilePathDigest = null; }],
    ]) {
      const dir = join(root, name);
      await (await import("node:fs/promises")).mkdir(dir);
      const identity = fixtureIdentity(dir);
      const envelope = structuredClone(passEnvelope);
      mutate(envelope);
      envelope.envelopeDigest = sha256(stableStringify(
        Object.fromEntries(Object.entries(envelope).filter(([key]) => key !== "envelopeDigest")),
      ));
      const bytes = Buffer.from(stableStringify(envelope));
      await writeFile(identity.envelopePath, bytes, { flag: "wx" });
      await writeFile(identity.shaPath, `${sha256(bytes)}\n`, { flag: "wx" });
      const child = await runChild(self, ["validate-envelope"], {
        cwd: dirname(runner), env: process.env,
        stdin: stableStringify(validationInput(identity, passChild)),
      });
      record(name, JSON.parse(child.stdout).validationStatus === "FAIL");
    }

    const missingDir = join(root, "D_MISSING");
    await (await import("node:fs/promises")).mkdir(missingDir);
    const missingIdentity = fixtureIdentity(missingDir);
    const missing = await runChild(self, ["validate-envelope"], {
      cwd: dirname(runner), env: process.env,
      stdin: stableStringify(validationInput(missingIdentity, baseChild)),
    });
    record("D_MISSING", missing.exitCode === 0
      && JSON.parse(missing.stdout).validationDisposition === "MISSING");

    const largeOutputDir = join(root, "OUTPUT_BYTES_OVER_2MIB");
    await (await import("node:fs/promises")).mkdir(largeOutputDir);
    const largeOutputIdentity = fixtureIdentity(largeOutputDir);
    const largeOutputInput = validationInput(largeOutputIdentity, baseChild);
    largeOutputInput.stdoutBytes = 5_000_000;
    largeOutputInput.stderrBytes = 5_000_000;
    const largeOutputChild = await runChild(self, ["validate-envelope"], {
      cwd: dirname(runner), env: process.env, stdin: stableStringify(largeOutputInput),
    });
    const largeOutputValidation = JSON.parse(await readFile(largeOutputIdentity.validationPath, "utf8"));
    record("OUTPUT_BYTES_LARGE_STILL_DISPOSITION", largeOutputChild.exitCode === 0
      && largeOutputValidation.validationDisposition === "MISSING"
      && largeOutputValidation.stdoutBytes === 5_000_000
      && largeOutputValidation.stderrBytes === 5_000_000);

    const zeroDir = join(root, "ZERO_BYTE_ENVELOPE");
    await (await import("node:fs/promises")).mkdir(zeroDir);
    const zeroIdentity = fixtureIdentity(zeroDir);
    await writeFile(zeroIdentity.envelopePath, Buffer.alloc(0), { flag: "wx" });
    const zeroChild = await runChild(self, ["validate-envelope"], {
      cwd: dirname(runner), env: process.env,
      stdin: stableStringify(validationInput(zeroIdentity, baseChild)),
    });
    const zeroValidation = JSON.parse(await readFile(zeroIdentity.validationPath, "utf8"));
    record("ZERO_BYTE_ENVELOPE_BOUNDED", zeroChild.exitCode === 0
      && zeroValidation.validationDisposition === "INVALID"
      && zeroValidation.validatorErrorCode === "RUNNER_TERMINAL_ENVELOPE_FILE_INVALID"
      && zeroValidation.fileExists === true
      && zeroValidation.fileBytes === 0
      && zeroValidation.fileSha256 === null);

    const oversizeDir = join(root, "OVERSIZE_ENVELOPE");
    await (await import("node:fs/promises")).mkdir(oversizeDir);
    const oversizeIdentity = fixtureIdentity(oversizeDir);
    await writeFile(oversizeIdentity.envelopePath, Buffer.alloc(MAX_ENVELOPE_BYTES + 1, 0x61), { flag: "wx" });
    const oversizeChild = await runChild(self, ["validate-envelope"], {
      cwd: dirname(runner), env: process.env,
      stdin: stableStringify(validationInput(oversizeIdentity, baseChild)),
    });
    const oversizeValidation = JSON.parse(await readFile(oversizeIdentity.validationPath, "utf8"));
    record("OVERSIZE_ENVELOPE_BOUNDED", oversizeChild.exitCode === 0
      && oversizeValidation.validationDisposition === "INVALID"
      && oversizeValidation.validatorErrorCode === "RUNNER_TERMINAL_ENVELOPE_TOO_LARGE"
      && oversizeValidation.fileExists === true
      && oversizeValidation.fileBytes === MAX_ENVELOPE_BYTES + 1
      && oversizeValidation.fileSha256 === null);

    const hugeDir = join(root, "OVER_2MIB_ENVELOPE");
    await (await import("node:fs/promises")).mkdir(hugeDir);
    const hugeIdentity = fixtureIdentity(hugeDir);
    const hugeBytes = 2_097_153;
    await writeFile(hugeIdentity.envelopePath, Buffer.alloc(hugeBytes, 0x61), { flag: "wx" });
    const hugeChild = await runChild(self, ["validate-envelope"], {
      cwd: dirname(runner), env: process.env,
      stdin: stableStringify(validationInput(hugeIdentity, baseChild)),
    });
    const hugeValidation = JSON.parse(await readFile(hugeIdentity.validationPath, "utf8"));
    record("OVER_2MIB_ENVELOPE_LSTAT_ONLY", hugeChild.exitCode === 0
      && hugeValidation.validationDisposition === "INVALID"
      && hugeValidation.validatorErrorCode === "RUNNER_TERMINAL_ENVELOPE_TOO_LARGE"
      && hugeValidation.fileBytes === hugeBytes
      && hugeValidation.fileSha256 === null);

    const longShaDir = join(root, "OVERSIZE_SHA_SIDECAR");
    await (await import("node:fs/promises")).mkdir(longShaDir);
    const longShaIdentity = fixtureIdentity(longShaDir);
    await writeFile(longShaIdentity.envelopePath, await readFile(baseIdentity.envelopePath), { flag: "wx" });
    await writeFile(longShaIdentity.shaPath, Buffer.alloc(SHA_SIDECAR_BYTES + 1, 0x61), { flag: "wx" });
    const longShaChild = await runChild(self, ["validate-envelope"], {
      cwd: dirname(runner), env: process.env,
      stdin: stableStringify(validationInput(longShaIdentity, baseChild)),
    });
    const longShaValidation = JSON.parse(await readFile(longShaIdentity.validationPath, "utf8"));
    record("SHA_SIDECAR_EXACT_65_BYTES", longShaChild.exitCode === 0
      && longShaValidation.validationDisposition === "INVALID"
      && longShaValidation.validatorErrorCode === "RUNNER_TERMINAL_ENVELOPE_SHA_MISMATCH");

    const hDir = join(root, "H_MINIMAL");
    await (await import("node:fs/promises")).mkdir(hDir);
    const hIdentity = fixtureIdentity(hDir);
    const hChild = await runChild(runner, ["generation"], {
      cwd: dirname(runner),
      env: {
        ...runnerEnvironment(hIdentity, "PROJECTION_FAIL"),
        RC6_2_RUNNER_ENVELOPE_TEST_MUTATION: "PROJECTION_FAILURE",
      },
    });
    assert.equal(hChild.signal, null);
    const hEnvelope = await readBoundedJsonFile(hIdentity.envelopePath);
    const hRejectedDigest = hEnvelope.projectionValidation.originalProjectionDigest;
    const hValidationChild = await runChild(self, ["validate-envelope"], {
      cwd: dirname(runner), env: process.env,
      stdin: stableStringify(validationInput(hIdentity, hChild)),
    });
    const hValidation = await readBoundedJsonFile(hIdentity.validationPath, MAX_STDIN_BYTES);
    record("H_MINIMAL_FALLBACK", hChild.exitCode === 1
      && hEnvelope.failureShape === "EVIDENCE_VALIDATION_ERROR"
      && hEnvelope.projectionValidation.status === "FAIL"
      && hEnvelope.projectionValidation.minimalProjectionUsed === true
      && hEnvelope.projectionValidation.detailedProjectionAvailable === false
      && hEnvelope.projectionValidation.validatorErrorCode === "RUNNER_TERMINAL_ENVELOPE_SCHEMA_INVALID"
      && JSON.stringify(hEnvelope.projectionValidation.unknownKeys) === '["injectedUnexpectedKey"]'
      && hEnvelope.projectionValidation.missingKeys.length === 0
      && SHA256.test(hRejectedDigest)
      && hRejectedDigest !== sha256(stableStringify({
        requestPhase: hEnvelope.requestPhase,
        gateCheckpoint: hEnvelope.gateCheckpoint,
      }))
      && hValidationChild.exitCode === 0
      && hValidation.validationDisposition === "VALIDATED"
      && hValidation.minimalProjectionUsed === true);

    const kDir = join(root, "K_STDOUT_NOISE");
    await (await import("node:fs/promises")).mkdir(kDir);
    const kIdentity = fixtureIdentity(kDir);
    await writeFile(kIdentity.envelopePath, await readFile(baseIdentity.envelopePath), { flag: "wx" });
    await writeFile(kIdentity.shaPath, await readFile(baseIdentity.shaPath), { flag: "wx" });
    const kInput = validationInput(kIdentity, { ...baseChild, stdout: "not evidence\n" });
    const kChild = await runChild(self, ["validate-envelope"], {
      cwd: dirname(runner), env: process.env, stdin: stableStringify(kInput),
    });
    record("K_STDOUT_NOT_AUTHORITY", JSON.parse(kChild.stdout).validationStatus === "PASS");
    const lInput = validationInput(baseIdentity, baseChild);
    record("L_STDERR_NOT_ENVELOPE", !baseChild.stderr.includes("{")
      && baseChild.stderr.includes("RUNNER_TERMINAL_FAIL")
      && lInput.progressCount === 3
      && lInput.safeTerminalCodeCount === 1
      && lInput.unexpectedLineCount === 0);

    const beforeEdge = (await import("node:child_process")).execFileSync(
      process.execPath,
      ["-e", "process.stdout.write('0')"],
      { encoding: "utf8", windowsHide: true, timeout: 5_000, maxBuffer: 1_024 },
    );
    const mValidation = mutationValidationByName.get("G_WRONG_DIGEST");
    record("M_VALIDATION_DISPOSITION", beforeEdge === "0"
      && mValidation.validationDisposition === "INVALID"
      && mValidation.status === "FAIL"
      && mValidation.validatorErrorCode === "RUNNER_TERMINAL_ENVELOPE_DIGEST_INVALID");
    record("N_FULL_STATE_RUNNER_VALIDATOR_TERMINAL_CHAIN", await runFullStubTerminalChain({
      root,
      runner,
      validator: self,
    }));
    const noOverwriteBefore = sha256(await readFile(baseIdentity.envelopePath));
    const secondWriter = await runChild(runner, ["generation"], {
      cwd: dirname(runner), env: runnerEnvironment(baseIdentity, "PLAYWRIGHT_FAIL"),
    });
    const noOverwriteAfter = sha256(await readFile(baseIdentity.envelopePath));
    const temporaryResidue = (await (await import("node:fs/promises")).readdir(mutationBase))
      .filter((name) => name.endsWith(".tmp"));
    record("ATOMIC_CREATE_NEW_NO_OVERWRITE", secondWriter.exitCode === 1
      && noOverwriteBefore === noOverwriteAfter
      && temporaryResidue.length === 0);

    const hardlinkDir = join(root, "HARDLINK_REJECTED");
    await (await import("node:fs/promises")).mkdir(hardlinkDir);
    const hardlinkIdentity = fixtureIdentity(hardlinkDir);
    await link(baseIdentity.envelopePath, hardlinkIdentity.envelopePath);
    await writeFile(hardlinkIdentity.shaPath, await readFile(baseIdentity.shaPath), { flag: "wx" });
    const hardlinkChild = await runChild(self, ["validate-envelope"], {
      cwd: dirname(runner), env: process.env,
      stdin: stableStringify(validationInput(hardlinkIdentity, baseChild)),
    });
    record("HARDLINK_REJECTED_FATAL", hardlinkChild.exitCode === 1
      && hardlinkChild.stdout === ""
      && hardlinkChild.stderr === "RUNNER_TERMINAL_ENVELOPE_PATH_INVALID\n"
      && !(await pathTruth(hardlinkIdentity.validationPath)));

    const shaHardlinkDir = join(root, "SHA_HARDLINK_REJECTED");
    await (await import("node:fs/promises")).mkdir(shaHardlinkDir);
    const shaHardlinkIdentity = fixtureIdentity(shaHardlinkDir);
    await writeFile(shaHardlinkIdentity.envelopePath, await readFile(baseIdentity.envelopePath), { flag: "wx" });
    await link(baseIdentity.shaPath, shaHardlinkIdentity.shaPath);
    const shaHardlinkChild = await runChild(self, ["validate-envelope"], {
      cwd: dirname(runner), env: process.env,
      stdin: stableStringify(validationInput(shaHardlinkIdentity, baseChild)),
    });
    record("SHA_HARDLINK_REJECTED_FATAL", shaHardlinkChild.exitCode === 1
      && shaHardlinkChild.stdout === ""
      && shaHardlinkChild.stderr === "RUNNER_TERMINAL_ENVELOPE_PATH_INVALID\n"
      && !(await pathTruth(shaHardlinkIdentity.validationPath)));

    const validationHardlinkDir = join(root, "VALIDATION_HARDLINK_REJECTED");
    await (await import("node:fs/promises")).mkdir(validationHardlinkDir);
    const validationHardlinkIdentity = fixtureIdentity(validationHardlinkDir);
    await writeFile(validationHardlinkIdentity.envelopePath, await readFile(baseIdentity.envelopePath), { flag: "wx" });
    await writeFile(validationHardlinkIdentity.shaPath, await readFile(baseIdentity.shaPath), { flag: "wx" });
    await link(baseIdentity.envelopePath, validationHardlinkIdentity.validationPath);
    const validationBefore = sha256(await readFile(validationHardlinkIdentity.validationPath));
    const validationHardlinkChild = await runChild(self, ["validate-envelope"], {
      cwd: dirname(runner), env: process.env,
      stdin: stableStringify(validationInput(validationHardlinkIdentity, baseChild)),
    });
    record("VALIDATION_HARDLINK_NO_OVERWRITE", validationHardlinkChild.exitCode === 1
      && validationHardlinkChild.stdout === ""
      && validationHardlinkChild.stderr === "RUNNER_TERMINAL_ENVELOPE_VALIDATION_DESTINATION_PREEXISTED\n"
      && sha256(await readFile(validationHardlinkIdentity.validationPath)) === validationBefore);

    const bomDir = join(root, "UTF8_BOM_REJECTED");
    await (await import("node:fs/promises")).mkdir(bomDir);
    const bomIdentity = fixtureIdentity(bomDir);
    const bomBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), await readFile(baseIdentity.envelopePath)]);
    await writeFile(bomIdentity.envelopePath, bomBytes, { flag: "wx" });
    await writeFile(bomIdentity.shaPath, `${sha256(bomBytes)}\n`, { flag: "wx" });
    const bomChild = await runChild(self, ["validate-envelope"], {
      cwd: dirname(runner), env: process.env,
      stdin: stableStringify(validationInput(bomIdentity, baseChild)),
    });
    record("UTF8_BOM_REJECTED", JSON.parse(bomChild.stdout).validationStatus === "FAIL");

    const reparseTarget = join(root, "REPARSE_TARGET");
    const reparsePath = join(root, "REPARSE_ATTEMPT");
    await (await import("node:fs/promises")).mkdir(reparseTarget);
    await symlink(reparseTarget, reparsePath, process.platform === "win32" ? "junction" : "dir");
    const reparseIdentity = fixtureIdentity(reparsePath);
    const reparseChild = await runChild(self, ["validate-envelope"], {
      cwd: dirname(runner), env: process.env,
      stdin: stableStringify(validationInput(reparseIdentity, baseChild)),
    });
    record("REPARSE_PATH_REJECTED", reparseChild.exitCode === 1
      && reparseChild.stderr === "RUNNER_TERMINAL_ENVELOPE_REPARSE_POINT\n");

    const negativeExitDir = join(root, "NEGATIVE_EXIT_CODE");
    await (await import("node:fs/promises")).mkdir(negativeExitDir);
    const negativeIdentity = fixtureIdentity(negativeExitDir);
    const negativeEnvelope = structuredClone(baseEnvelope);
    negativeEnvelope.exitCode = -1;
    negativeEnvelope.envelopeDigest = sha256(stableStringify(
      Object.fromEntries(Object.entries(negativeEnvelope).filter(([key]) => key !== "envelopeDigest")),
    ));
    const negativeBytes = Buffer.from(stableStringify(negativeEnvelope));
    await writeFile(negativeIdentity.envelopePath, negativeBytes, { flag: "wx" });
    await writeFile(negativeIdentity.shaPath, `${sha256(negativeBytes)}\n`, { flag: "wx" });
    const negativeTruth = {
      exitCode: -1,
      stdout: "",
      stderr: "RC6_2_RUNNER_TERMINAL_FAIL\n",
    };
    const negativeChild = await runChild(self, ["validate-envelope"], {
      cwd: dirname(runner), env: process.env,
      stdin: stableStringify(validationInput(negativeIdentity, negativeTruth)),
    });
    record("NEGATIVE_EXIT_CODE", JSON.parse(negativeChild.stdout).validationStatus === "PASS");
    process.stdout.write(`${stableStringify({
      schemaVersion: "p24b-rc6.2-runner-envelope-tests-v1",
      status: "PASS",
      passCount: tests.length,
      failCount: 0,
      blockingSkipCount: 0,
      browserLaunchCount: 0,
      edgeProcessCount: 0,
      networkRequestCount: 0,
      tests,
    })}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const command = process.argv[2] ?? "test";
if (command === "validate-envelope") {
  try {
    const summary = await validateEnvelope(await readBoundedStdin());
    process.stdout.write(stableStringify(summary));
  } catch (error) {
    const code = VALIDATION_ERROR_CODES.has(error?.code)
      ? error.code
      : "RUNNER_TERMINAL_ENVELOPE_FILE_INVALID";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
} else if (new Set(["test", "all", "child-process", "mutations"]).has(command)) {
  await runTests();
} else {
  process.stderr.write("RUNNER_TERMINAL_ENVELOPE_FILE_INVALID\n");
  process.exitCode = 1;
}

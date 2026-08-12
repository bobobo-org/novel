import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const mode = process.argv[2] ?? "all";
assert.ok(new Set(["unit", "mutations", "all"]).has(mode), "expected unit, mutations, or all");

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
const NETWORK_SENTINEL_PROBE_IDS = Object.freeze(["HTTP_GET", "HTTP_POST", "WEBSOCKET"]);
const NETWORK_SENTINEL_ROUTE_DECISIONS = new Set([
  "blocked", "continued", "not-observed", "block-failed", "continue-failed",
]);
const NETWORK_SENTINEL_REASON_CODES = new Set([
  "method-not-allowed", "network-classification-blocked", "request-body-not-allowed",
]);
const NETWORK_SENTINEL_BASELINE_KEYS = Object.freeze([
  "tcpConnectionReceiptCount", "httpRequestReceiptCount", "httpRequestBodyByteCount",
  "webSocketUpgradeReceiptCount",
]);
const NETWORK_SENTINEL_BASELINE_EXPECTATIONS = Object.freeze([
  ["tcpConnectionReceiptCount", 1, "NETWORK_SENTINEL_RECEIVER_TCP_DELTA_ZERO", "minimum"],
  ["httpRequestReceiptCount", 1, "NETWORK_SENTINEL_BOOTSTRAP_EXACTLY_ONCE", "equal"],
  ["httpRequestBodyByteCount", 0, "NETWORK_SENTINEL_POST_BODY_REJECTED", "equal"],
  ["webSocketUpgradeReceiptCount", 0,
    "NETWORK_SENTINEL_RECEIVER_WEBSOCKET_DELTA_ZERO", "equal"],
]);
const NETWORK_SENTINEL_KEYS = Object.freeze([
  "schemaVersion", "status",
  ...NETWORK_SENTINEL_SCALAR_EXPECTATIONS.map(([scalarId]) => scalarId),
  "receiverBaseline", "probeRouteRecords", "firstFailedScalarAssertion", "matrixDigest",
]);
const PASS_BASELINE = Object.freeze({
  tcpConnectionReceiptCount: 1,
  httpRequestReceiptCount: 1,
  httpRequestBodyByteCount: 0,
  webSocketUpgradeReceiptCount: 0,
});
const PASS_ROUTE_RECORDS = Object.freeze([
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
const VALID_BOOTSTRAP_REQUEST = Object.freeze({
  exactBootstrapUrl: true,
  method: "GET",
  resourceType: "document",
  bodyByteCount: 0,
  usernameEmpty: true,
  passwordEmpty: true,
  credentialHeaderCount: 0,
  redirectCount: 0,
  queryEmpty: true,
  fragmentEmpty: true,
});
const ACTIVE_BOOTSTRAP_STATE = Object.freeze({
  requestPhase: "bootstrap",
  sentinelBootstrapActive: true,
  sentinelBootstrapConsumed: false,
});

function sourceSection(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label} start marker is missing`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${label} end marker is missing`);
  assert.ok(end > start, `${label} source markers are out of order`);
  return source.slice(start, end);
}

function compactSource(source) {
  return source.replace(/\s+/gu, "");
}

function assertSourceMarkers(section, markers, label) {
  for (const marker of markers) {
    assert.ok(section.includes(marker), `${label} is missing bound marker ${marker}`);
  }
}

function assertSourceMarkerOrder(section, markers, label) {
  let cursor = 0;
  for (const marker of markers) {
    const index = section.indexOf(marker, cursor);
    assert.notEqual(index, -1, `${label} is missing ordered marker ${marker}`);
    cursor = index + marker.length;
  }
}

async function assertRunnerSourceContract() {
  const source = await readFile(
    new URL("./run-rc6-2-closed-agent-browser.mjs", import.meta.url),
    "utf8",
  );
  assert.equal(
    /p24b-rc6[.]2-network-zero-receipt-v1/u.test(source),
    false,
    "the runner must not retain the nondeterministic v1 sentinel schema",
  );
  assert.ok(
    compactSource(source).includes(
      'newSet(["setup","generation","all","network-sentinel-only"]).has(mode)',
    ),
    "the runner must expose the exact bounded network-sentinel-only mode set",
  );
  assert.ok(
    source.includes('mode === "network-sentinel-only"'),
    "the runner must isolate the sentinel-only execution branch",
  );
  assert.ok(
    source.includes(`"${NETWORK_SENTINEL_SCHEMA}"`),
    "the runner must emit the exact frozen v2 sentinel schema",
  );
  const digestHelper = sourceSection(
    source,
    "function networkSentinelMatrixDigest(value)",
    "function firstNetworkSentinelScalarMismatch(value)",
    "network sentinel matrix digest helper",
  );
  assertSourceMarkerOrder(digestHelper, [
    "Object.entries(value)",
    'key !== "matrixDigest"',
    "sha256Value",
    "NETWORK_SENTINEL_SCHEMA",
    "stableStringify(body)",
  ], "independent schema-domain matrix digest helper");
  const mismatchHelper = sourceSection(
    source,
    "function firstNetworkSentinelScalarMismatch(value)",
    "function finalizeNetworkSentinelMatrix(value)",
    "network sentinel first-scalar mismatch helper",
  );
  assertSourceMarkerOrder(mismatchHelper, [
    "NETWORK_SENTINEL_SCALAR_EXPECTATIONS",
    "const baselineMismatch =",
    '"receiverBaseline.tcpConnectionReceiptCount"',
    '"receiverBaseline.httpRequestReceiptCount"',
    '"receiverBaseline.httpRequestBodyByteCount"',
    '"receiverBaseline.webSocketUpgradeReceiptCount"',
    "return baselineMismatch ?",
  ], "ordered scalar and receiver-baseline mismatch mapping");
  const matrixFinalizer = sourceSection(
    source,
    "function finalizeNetworkSentinelMatrix(value)",
    "function createPassingNetworkSentinelFixture()",
    "network sentinel matrix finalizer",
  );
  assertSourceMarkerOrder(matrixFinalizer, [
    "firstNetworkSentinelScalarMismatch(value)",
    'firstFailedScalarAssertion === null ? "PASS" : "FAIL"',
    "firstFailedScalarAssertion",
    "matrixDigest: networkSentinelMatrixDigest(body)",
  ], "finite matrix finalization and independent digest binding");
  const scalarDeclaration = sourceSection(
    source,
    "const NETWORK_SENTINEL_SCALAR_EXPECTATIONS",
    "const NETWORK_SENTINEL_PROBE_SPECS",
    "frozen sentinel scalar declaration",
  );
  const scalarDeclarationPrefix = "constNETWORK_SENTINEL_SCALAR_EXPECTATIONS=Object.freeze([";
  const compactScalarDeclaration = compactSource(scalarDeclaration);
  assert.ok(compactScalarDeclaration.startsWith(scalarDeclarationPrefix));
  assert.ok(compactScalarDeclaration.endsWith("]);"));
  const scalarTupleSource = compactScalarDeclaration
    .slice(scalarDeclarationPrefix.length, -3)
    .replace(/,$/u, "");
  assert.equal(
    scalarTupleSource,
    NETWORK_SENTINEL_SCALAR_EXPECTATIONS.map((tuple) => JSON.stringify(tuple)).join(","),
    "the runner scalar order, safe values, and assertion-ID mappings must be exact",
  );
  for (const [scalarId, , assertionId] of NETWORK_SENTINEL_SCALAR_EXPECTATIONS) {
    assert.ok(source.includes(scalarId), `runner is missing frozen sentinel scalar ${scalarId}`);
    assert.ok(source.includes(assertionId), `runner is missing finite assertion ID ${assertionId}`);
  }

  const profilePreparation = sourceSection(
    source,
    "async function preparePersistentEdgeProfile()",
    "function formalAttemptIdentity()",
    "fresh sentinel-only Edge profile preparation",
  );
  assertSourceMarkerOrder(profilePreparation, [
    "process.env.RC6_2_CLOSED_AI_PROFILE_PATH",
    "if (networkSentinelOnly)",
    "configuredProfile",
    "undefined",
    "canonicalTemporaryRoot()",
    'mkdtemp(join(temporaryRoot, "novel-rc6-2-edge-"))',
    "validatePersistentEdgeProfile(created)",
    'ownership: "runner-created"',
  ], "sentinel-only inherited-profile rejection and runner-owned fresh profile");
  const launchLifecycle = sourceSection(
    source,
    "async function launch()",
    "function resetPreNavigationSentinelPolicyCounters()",
    "sentinel-only isolated launch lifecycle",
  );
  assertSourceMarkerOrder(launchLifecycle, [
    "preparePersistentEdgeProfile()",
    "profileOwnership = preparedProfile.ownership",
    "...(networkSentinelOnly ? [",
    '"--disable-background-networking"',
    '"--disable-component-update"',
    '"--disable-default-apps"',
    '"--disable-domain-reliability"',
    '"--disable-sync"',
    '"--metrics-recording-only"',
    '"--no-default-browser-check"',
    '"--no-first-run"',
    '"--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"',
    'serviceWorkers: "block"',
    "launchPersistentContext(profilePath, launchOptions)",
    'routeWebSocket("**/*", routeClosedAiWebSocket)',
    'route("**/*", routeClosedAiRequest)',
  ], "fresh persistent context and sentinel-only network isolation arguments");
  assert.equal(
    /RC6_2_CLOSED_AI_PROFILE_PATH[\s\S]*if \(networkSentinelOnly\)[\s\S]*configuredProfile[\s\S]*undefined/u
      .test(profilePreparation),
    true,
    "sentinel-only mode must reject rather than reuse a wrapper/inherited profile",
  );
  const sentinelOnlyConfiguration = sourceSection(
    source,
    "const networkSentinelOnly =",
    "if (formalAttemptEnabled)",
    "sentinel-only configuration isolation",
  );
  assertSourceMarkers(sentinelOnlyConfiguration, [
    'mode === "network-sentinel-only"',
    '"https://network-sentinel.invalid"',
    '"network-sentinel-only"',
    "assert.equal(formalAttemptEnabled, false",
  ], "sentinel-only fake origin, identity, and no-formal-attempt isolation");
  const productManifestGuard = sourceSection(
    source,
    "const PRODUCT_STATIC_ASSET_MANIFEST_COMMIT =",
    "const SAFE_DIAGNOSTIC_CODES =",
    "Product static-manifest guard",
  );
  assert.match(
    productManifestGuard,
    /if \(!networkSentinelOnly && expectedCommit !== PRODUCT_STATIC_ASSET_MANIFEST_COMMIT\)/u,
    "sentinel-only mode must bypass the Product-only static-manifest identity assertion",
  );
  const httpRoutePipeline = sourceSection(
    source,
    "async function requestRouteDecision(request)",
    "function observeClosedAiRequest",
    "HTTP route pipeline",
  );
  assertSourceMarkers(httpRoutePipeline, [
    'requestPhase === "bootstrap"',
    "sentinelBootstrapActive",
    "sentinelBootstrapUrl",
    "sentinelBootstrapConsumed",
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
  ], "exact one-shot bootstrap route predicate");
  assertSourceMarkerOrder(httpRoutePipeline, [
    'action: "continue-bootstrap"',
    'decision.action === "continue-bootstrap"',
    "sentinelBootstrapConsumed = true",
    "sentinelBootstrapAllowedCount += 1",
    "await route.continue",
  ], "bootstrap consume-before-continue branch");

  const httpRouteHandler = sourceSection(
    source,
    "async function routeClosedAiRequest(route)",
    "function observeClosedAiRequest",
    "HTTP sentinel route recorder",
  );
  assertSourceMarkers(httpRouteHandler, [
    "sentinelProbeState",
    "httpGetUrl",
    "httpPostUrl",
    '"HTTP_GET"',
    '"HTTP_POST"',
    "probeRouteRecords",
    "routeObserved",
    "routeDecision",
    "reasonCodes",
  ], "separate HTTP GET/POST route records");

  const webSocketRouteHandler = sourceSection(
    source,
    "async function routeClosedAiWebSocket(webSocketRoute)",
    "async function routeClosedAiRequest(route)",
    "WebSocket sentinel route recorder",
  );
  assertSourceMarkers(webSocketRouteHandler, [
    "sentinelProbeState",
    "webSocketUrl",
    '"WEBSOCKET"',
    "probeRouteRecords",
    "routeObserved",
    "routeDecision",
    "reasonCodes",
  ], "separate WebSocket route record");

  const sentinelLifecycle = sourceSection(
    source,
    "async function runPreNavigationNetworkSentinel()",
    "async function assertExactOrigin()",
    "deterministic sentinel lifecycle",
  );
  assertSourceMarkers(sentinelLifecycle, [
    "NETWORK_SENTINEL_BOOTSTRAP_PREFIX",
    "randomBytes(16)",
    "sentinelBootstrapActive = true",
    "sentinelBootstrapUrl =",
    "sentinelBootstrapConsumed = false",
    "sentinelBootstrapAllowedCount = 0",
    "tcpConnectionReceiptCount",
    "httpRequestReceiptCount",
    "httpRequestBodyByteCount",
    "webSocketUpgradeReceiptCount",
    "receiverBaseline",
    "httpGetUrl",
    "httpPostUrl",
    "webSocketUrl",
    "probeRouteRecords",
    "probeId",
    "routeObserved",
    "routeDecision",
    "reasonCodes",
    "HTTP_GET",
    "HTTP_POST",
    "WEBSOCKET",
    "method-not-allowed",
    "network-classification-blocked",
    "request-body-not-allowed",
    "blocked-by-route",
    "route-action-failed",
    "evaluation-failed",
    "unexpected-rejection",
    "operationalErrorCount",
    "recordOperationalError",
    "firstFailedScalarAssertion",
    "finalizeNetworkSentinelMatrix({",
    "resetPreNavigationSentinelPolicyCounters",
  ], "sentinel receiver/probe/matrix/reset lifecycle");
  assertSourceMarkerOrder(sentinelLifecycle, [
    'const exactBootstrapRequest = request.method === "GET"',
    'request.url === `${NETWORK_SENTINEL_BOOTSTRAP_PREFIX}${nonce}`',
    "if (exactBootstrapRequest) bootstrapReceiverHttpCount += 1",
  ], "exact bootstrap-path receiver count");
  assertSourceMarkerOrder(sentinelLifecycle, [
    "sentinelBootstrapActive = true",
    "page.goto(sentinelBootstrapUrl",
    "receiverBaseline",
    "sentinelBootstrapActive = false",
    "sentinelProbeState =",
    "evaluateHttpProbe",
    "evaluateWebSocketProbe",
    'page.goto("about:blank"',
    "receiver.close",
    "sentinelBootstrapUrl = null",
    "sentinelProbeState = null",
    "resetPreNavigationSentinelPolicyCounters()",
  ], "bootstrap, baseline, probes, about:blank, and cleanup sequence");

  const counterReset = sourceSection(
    source,
    "function resetPreNavigationSentinelPolicyCounters()",
    "async function runPreNavigationNetworkSentinel()",
    "sentinel counter reset",
  );
  assertSourceMarkers(counterReset, [
    "sentinelProbeState = null",
    "sentinelBootstrapActive = false",
  ], "sentinel-only state reset");
  for (const forbiddenProductState of [
    "blockedNetworkPolicyAttempts",
    "prohibitedExternalAiRequests",
    "disallowedCrossOriginRequests",
    "disallowedSameOriginTargetRequests",
    "disallowedImmutableModelTargetRequests",
    "disallowedMethodRequests",
    "disallowedWebSocketAttempts",
    "blockedPreviewToolbarWebSocketAttempts",
    "observedPreviewToolbarRequests",
    "previewToolbarResponses",
    "blockedNetworkPolicyAttemptCount",
    "prohibitedExternalAiRequestCount",
    "disallowedCrossOriginRequestCount",
    "disallowedSameOriginTargetRequestCount",
    "disallowedImmutableModelTargetRequestCount",
    "disallowedMethodRequestCount",
    "observedWebSocketAttemptCount",
    "blockedWebSocketAttemptCount",
    "disallowedWebSocketAttemptCount",
    "webSocketServerConnectionCount",
    "blockedNonToolbarResponseCount",
    "previewToolbarResponseCount",
  ]) {
    assert.equal(
      counterReset.includes(forbiddenProductState),
      false,
      `sentinel reset must not clear Product/global state ${forbiddenProductState}`,
    );
  }
  const resetAssignmentTargets = [...counterReset.matchAll(
    /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:null|false|0|\[\])\s*;/gmu,
  )].map((match) => match[1]);
  assert.ok(resetAssignmentTargets.length >= 2, "sentinel reset must contain explicit state clears");
  assert.equal(
    resetAssignmentTargets.every((target) => target.startsWith("sentinel")),
    true,
    "sentinel reset may assign only sentinel-prefixed state",
  );
  assert.equal(
    /[.]length\s*=\s*0/u.test(counterReset),
    false,
    "sentinel reset must not truncate Product/global collections",
  );

  const matrixAssembly = sourceSection(
    sentinelLifecycle,
    "finalizeNetworkSentinelMatrix({",
    "return { matrix, operationalError };",
    "sentinel matrix assembly",
  );
  assert.equal(
    /(?:^|[\r\n])\s*bootstrapReceiverHttpCount(?:\s*:\s*bootstrapReceiverHttpCount)?\s*,/u
      .test(matrixAssembly),
    true,
    "matrix bootstrapReceiverHttpCount must bind the exact-path counter, not total HTTP receipts",
  );
  assert.equal(
    /bootstrapReceiverHttpCount\s*:\s*receiverBaseline[.]httpRequestReceiptCount/u
      .test(matrixAssembly),
    false,
    "matrix must not alias the exact bootstrap-path count to the total receiver baseline",
  );
  assertSourceMarkers(matrixAssembly, [
    "httpRouteObservedCount: httpRouteObservationCountEvidence",
    "webSocketRouteObservedCount: webSocketRouteObservationCountEvidence",
    "tcpConnectionReceiptDelta",
    "httpRequestReceiptDelta",
    "httpRequestBodyByteDelta",
    "webSocketUpgradeReceiptDelta",
    "sentinelHeaderReceiptCount - sentinelHeaderReceiptBaseline === 0",
    "requestBodyBlocked: httpRequestBodyByteDelta === 0",
    "operationalErrorCount",
    "receiverBaseline",
  ], "actual route, receiver, secret-header, body, and operational-error matrix bindings");

  const operationalErrorRecorder = sourceSection(
    sentinelLifecycle,
    "const recordOperationalError = (error) => {",
    "let receiver = null",
    "durable sentinel operational error recorder",
  );
  assertSourceMarkerOrder(operationalErrorRecorder, [
    "operationalErrorCount += 1",
    "operationalError ??= error",
  ], "operational error count and first-error binding");

  const evaluateHttpLifecycle = sourceSection(
    sentinelLifecycle,
    "const evaluateHttpProbe = async",
    "const evaluateWebSocketProbe = async",
    "sentinel HTTP evaluate failure capture",
  );
  assertSourceMarkerOrder(evaluateHttpLifecycle, [
    "httpProbeAttemptCount += 1",
    "return await page.evaluate",
    "headerName: NETWORK_SENTINEL_HEADER_NAME",
    "headerValue: sentinelHeaderValue",
    "bodyValue: sentinelBodyValue",
    "} catch (error) {",
    "recordOperationalError(error)",
    'return "evaluation-failed"',
    "settlePendingSentinelRouteActions()",
  ], "HTTP probe secrets and evaluate-level operational failure capture");
  const evaluateWebSocketLifecycle = sourceSection(
    sentinelLifecycle,
    "const evaluateWebSocketProbe = async",
    "const result = {",
    "sentinel WebSocket evaluate failure capture",
  );
  assertSourceMarkerOrder(evaluateWebSocketLifecycle, [
    "webSocketProbeAttemptCount += 1",
    "return await page.evaluate",
    "protocol: sentinelWebSocketProtocol",
    "} catch (error) {",
    "recordOperationalError(error)",
    'return "evaluation-failed"',
    "settlePendingSentinelRouteActions()",
  ], "WebSocket probe evaluate-level operational failure capture");

  const browserResultMapping = sourceSection(
    sentinelLifecycle,
    "const browserResult = (raw, record)",
    "browserProbeResults = {",
    "finite sentinel browser-result mapping",
  );
  assert.ok(
    compactSource(browserResultMapping).includes(
      'newSet(["block-failed","continue-failed"]).has(record.routeDecision)?"route-action-failed"',
    ),
    "both failed block and failed continue actions must map to route-action-failed",
  );
  assertSourceMarkerOrder(browserResultMapping, [
    'raw === "evaluation-failed"',
    '? "evaluation-failed"',
    'raw === "unexpected-success"',
    '? "unexpected-success"',
    'raw === "timeout"',
    '? "timeout"',
    'record.routeDecision === "blocked"',
    '? "blocked-by-route"',
    'record.routeDecision === "continued"',
    '? "unexpected-rejection"',
    ': "native-preblock"',
  ], "finite Browser result precedence after route-action failures");

  const receiverCloseLifecycle = sourceSection(
    sentinelLifecycle,
    "if (receiverListening && receiver)",
    "sentinelBootstrapUrl = null",
    "bounded sentinel receiver close",
  );
  assertSourceMarkerOrder(receiverCloseLifecycle, [
    "receiver.close",
    "Promise.race([",
    '"RC6_2_NETWORK_SENTINEL_RECEIVER_CLOSE_TIMEOUT"',
    "receiverClosed = true",
    "receiver.closeAllConnections",
    "recordOperationalError(error)",
  ], "receiver close timeout and fail-closed capture");

  const sentinelConsumer = sourceSection(
    source,
    "const sentinelResult = await runPreNavigationNetworkSentinel()",
    "if (networkSentinelOnly)",
    "sentinel result consumer",
  );
  assertSourceMarkerOrder(sentinelConsumer, [
    "networkSentinelEvidence = sentinelResult.matrix",
    "networkSentinelEvidence.firstFailedScalarAssertion !== null",
    "throw sentinelAssertion",
    "sentinelResult.operationalError !== null",
    "throw sentinelResult.operationalError",
  ], "scalar-before-operational sentinel failure propagation");
  const sentinelOnlyEvidence = sourceSection(
    source,
    "if (networkSentinelOnly) {",
    '} else {\n  requestPhase = "release-identity";',
    "sentinel-only bounded success evidence",
  );
  assertSourceMarkers(sentinelOnlyEvidence, [
    'schemaVersion: "p24b-rc6.2-network-sentinel-only-evidence-v1"',
    "networkZeroReceipt: networkSentinelEvidence",
    "freshBrowserContext: true",
    "profileOwnership",
    "profilePathDigest",
  ], "sentinel-only evidence binds the fresh runner-owned profile and exact matrix");
  for (const decision of NETWORK_SENTINEL_ROUTE_DECISIONS) {
    assert.ok(source.includes(`"${decision}"`), `runner is missing finite route decision ${decision}`);
  }
  assert.equal(
    /routeDecision\s*:\s*"native-preblock"/u.test(source),
    false,
    "native-preblock is a Browser result and must never be emitted as a route decision",
  );
  assert.equal(
    /(?:pageReturnedToAboutBlank\s*=\s*page[.]url[(][)]\s*===\s*"about:blank"|assert[.]equal[(]\s*page[.]url[(][)]\s*,\s*"about:blank"\s*[)])/u
      .test(sentinelLifecycle),
    true,
    "the sentinel must perform an exact semantic about:blank verification before cleanup",
  );
  return true;
}

const runnerSourceContract = await assertRunnerSourceContract();

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(",")}}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function exactKeys(value, keys) {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
}

function safeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
}

function withoutMatrixDigest(matrix) {
  return Object.fromEntries(Object.entries(matrix).filter(([key]) => key !== "matrixDigest"));
}

function matrixDigest(matrix) {
  return createHash("sha256")
    .update(`${NETWORK_SENTINEL_SCHEMA}\n${stableStringify(withoutMatrixDigest(matrix))}`)
    .digest("hex");
}

function firstScalarMismatch(matrix) {
  for (const [scalarId, expectedSafeValue, assertionId] of NETWORK_SENTINEL_SCALAR_EXPECTATIONS) {
    if (matrix[scalarId] !== expectedSafeValue) {
      return { assertionId, scalarId, expectedSafeValue, actualSafeValue: matrix[scalarId] };
    }
  }
  for (const [scalarKey, expectedSafeValue, assertionId, comparison] of
    NETWORK_SENTINEL_BASELINE_EXPECTATIONS) {
    const actualSafeValue = matrix.receiverBaseline[scalarKey];
    if (
      (comparison === "minimum" && actualSafeValue < expectedSafeValue)
      || (comparison === "equal" && actualSafeValue !== expectedSafeValue)
    ) {
      return {
        assertionId,
        scalarId: `receiverBaseline.${scalarKey}`,
        expectedSafeValue,
        actualSafeValue,
      };
    }
  }
  return null;
}

function makeMatrix(overrides = {}) {
  const matrix = {
    schemaVersion: NETWORK_SENTINEL_SCHEMA,
    status: "PASS",
    ...Object.fromEntries(NETWORK_SENTINEL_SCALAR_EXPECTATIONS.map(([scalarId, value]) => [scalarId, value])),
    receiverBaseline: clone(PASS_BASELINE),
    probeRouteRecords: clone(PASS_ROUTE_RECORDS),
    firstFailedScalarAssertion: null,
    matrixDigest: "",
    ...clone(overrides),
  };
  matrix.firstFailedScalarAssertion = firstScalarMismatch(matrix);
  matrix.status = matrix.firstFailedScalarAssertion === null ? "PASS" : "FAIL";
  matrix.matrixDigest = matrixDigest(matrix);
  return matrix;
}

function bootstrapRequestAllowed(state, request) {
  return state.requestPhase === "bootstrap"
    && state.sentinelBootstrapActive === true
    && state.sentinelBootstrapConsumed === false
    && request.exactBootstrapUrl === true
    && request.method === "GET"
    && request.resourceType === "document"
    && request.bodyByteCount === 0
    && request.usernameEmpty === true
    && request.passwordEmpty === true
    && request.credentialHeaderCount === 0
    && request.redirectCount === 0
    && request.queryEmpty === true
    && request.fragmentEmpty === true;
}

function assertRouteRecordsAndDerivedCounts(matrix) {
  assert.equal(matrix.probeRouteRecords.length, NETWORK_SENTINEL_PROBE_IDS.length);
  const browserResults = [
    matrix.httpGetBrowserResult,
    matrix.httpPostBrowserResult,
    matrix.webSocketBrowserResult,
  ];
  for (const [index, record] of matrix.probeRouteRecords.entries()) {
    exactKeys(record, ["probeId", "routeObserved", "routeDecision", "reasonCodes"]);
    assert.equal(record.probeId, NETWORK_SENTINEL_PROBE_IDS[index]);
    assert.equal(typeof record.routeObserved, "boolean");
    assert.ok(NETWORK_SENTINEL_ROUTE_DECISIONS.has(record.routeDecision));
    assert.equal(record.routeObserved, record.routeDecision !== "not-observed");
    assert.ok(Array.isArray(record.reasonCodes));
    assert.equal(new Set(record.reasonCodes).size, record.reasonCodes.length);
    assert.ok(record.reasonCodes.every((reasonCode) => NETWORK_SENTINEL_REASON_CODES.has(reasonCode)));
    assert.ok(record.reasonCodes.length <= 4);
    const browserResult = browserResults[index];
    if (record.routeObserved && record.routeDecision === "blocked") {
      assert.equal(new Set([
        "native-preblock", "not-attempted", "route-action-failed", "unexpected-rejection",
      ]).has(browserResult), false);
      assert.deepEqual(record.reasonCodes, PASS_ROUTE_RECORDS[index].reasonCodes);
    } else if (record.routeObserved && record.routeDecision === "continued") {
      assert.deepEqual(record.reasonCodes, []);
      assert.equal(
        new Set([
          "blocked-by-route", "native-preblock", "not-attempted", "route-action-failed",
        ]).has(browserResult),
        false,
      );
    } else if (record.routeObserved && record.routeDecision === "block-failed") {
      assert.deepEqual(record.reasonCodes, PASS_ROUTE_RECORDS[index].reasonCodes);
      assert.equal(browserResult, "route-action-failed");
    } else if (record.routeObserved && record.routeDecision === "continue-failed") {
      assert.deepEqual(record.reasonCodes, []);
      assert.equal(browserResult, "route-action-failed");
    } else {
      assert.equal(record.routeObserved, false);
      assert.equal(record.routeDecision, "not-observed");
      assert.deepEqual(record.reasonCodes, []);
      assert.equal(
        new Set(["blocked-by-route", "route-action-failed", "unexpected-rejection"])
          .has(browserResult),
        false,
      );
    }
  }
  const [httpGet, httpPost, webSocket] = matrix.probeRouteRecords;
  const httpRecords = [httpGet, httpPost];
  const attempted = (result) => result !== "not-attempted";
  assert.equal(matrix.httpProbeAttemptCount, browserResults.slice(0, 2).filter(attempted).length);
  assert.ok(matrix.httpRouteObservedCount
    >= httpRecords.filter(({ routeObserved }) => routeObserved).length);
  assert.ok(matrix.httpRouteBlockedCount <= matrix.httpRouteObservedCount);
  assert.ok(matrix.crossOriginClassificationCount <= matrix.httpRouteObservedCount);
  assert.ok(matrix.methodRejectedCount <= matrix.httpRouteObservedCount);
  assert.ok(matrix.bodyRejectedCount <= matrix.httpRouteObservedCount);
  assert.ok(matrix.httpRouteBlockedCount
    >= httpRecords.filter(({ routeDecision }) => routeDecision === "blocked").length);
  assert.ok(matrix.crossOriginClassificationCount >= httpRecords.filter(
    ({ reasonCodes }) => reasonCodes.includes("network-classification-blocked"),
  ).length);
  assert.ok(matrix.methodRejectedCount >= httpRecords.filter(
    ({ reasonCodes }) => reasonCodes.includes("method-not-allowed"),
  ).length);
  assert.ok(matrix.bodyRejectedCount >= httpRecords.filter(
    ({ reasonCodes }) => reasonCodes.includes("request-body-not-allowed"),
  ).length);
  assert.equal(matrix.webSocketProbeAttemptCount, Number(attempted(matrix.webSocketBrowserResult)));
  assert.ok(matrix.webSocketRouteObservedCount >= Number(webSocket.routeObserved));
  assert.ok(matrix.webSocketRouteBlockedCount <= matrix.webSocketRouteObservedCount);
  assert.ok(matrix.disallowedWebSocketCount <= matrix.webSocketRouteObservedCount);
  assert.ok(matrix.webSocketRouteBlockedCount >= Number(webSocket.routeDecision === "blocked"));
  assert.ok(matrix.disallowedWebSocketCount
    >= Number(webSocket.reasonCodes.includes("network-classification-blocked")));
  assert.equal(
    matrix.browserNativePreblockCount,
    browserResults.filter((result) => result === "native-preblock").length,
  );
  if (browserResults.slice(0, 2).includes("unexpected-success")) {
    assert.ok(matrix.httpRequestReceiptDelta > 0);
  }
  if (matrix.webSocketBrowserResult === "unexpected-success") {
    assert.ok(matrix.webSocketUpgradeReceiptDelta > 0);
  }
  if (matrix.httpRequestBodyByteDelta > 0) assert.ok(matrix.httpRequestReceiptDelta > 0);
  assert.equal(matrix.requestBodyBlocked, matrix.httpRequestBodyByteDelta === 0);
  if (!matrix.arbitraryOutboundHeaderBlocked) assert.ok(matrix.httpRequestReceiptDelta > 0);
}

function validateMatrix(matrix) {
  exactKeys(matrix, NETWORK_SENTINEL_KEYS);
  assert.equal(matrix.schemaVersion, NETWORK_SENTINEL_SCHEMA);
  assert.ok(new Set(["PASS", "FAIL"]).has(matrix.status));
  for (const [scalarId, expectedSafeValue] of NETWORK_SENTINEL_SCALAR_EXPECTATIONS) {
    if (typeof expectedSafeValue === "number") assert.ok(safeInteger(matrix[scalarId]));
    else if (typeof expectedSafeValue === "boolean") assert.equal(typeof matrix[scalarId], "boolean");
    else assert.ok(NETWORK_SENTINEL_BROWSER_RESULTS.has(matrix[scalarId]));
  }
  exactKeys(matrix.receiverBaseline, NETWORK_SENTINEL_BASELINE_KEYS);
  for (const key of NETWORK_SENTINEL_BASELINE_KEYS) assert.ok(safeInteger(matrix.receiverBaseline[key]));
  assert.ok(Array.isArray(matrix.probeRouteRecords));
  assertRouteRecordsAndDerivedCounts(matrix);
  const mismatch = firstScalarMismatch(matrix);
  assert.deepEqual(matrix.firstFailedScalarAssertion, mismatch);
  if (mismatch !== null) {
    assert.ok(["boolean", "number", "string"].includes(typeof mismatch.expectedSafeValue));
    assert.equal(typeof mismatch.actualSafeValue, typeof mismatch.expectedSafeValue);
    if (typeof mismatch.actualSafeValue === "number") assert.ok(safeInteger(mismatch.actualSafeValue));
    if (typeof mismatch.actualSafeValue === "string") {
      assert.ok(NETWORK_SENTINEL_BROWSER_RESULTS.has(mismatch.actualSafeValue));
    }
  }
  assert.equal(matrix.status, mismatch === null ? "PASS" : "FAIL");
  assert.match(matrix.matrixDigest, /^[a-f0-9]{64}$/u);
  assert.equal(matrix.matrixDigest, matrixDigest(matrix));
  if (matrix.status === "PASS") {
    assert.ok(matrix.receiverBaseline.tcpConnectionReceiptCount >= 1);
    assert.equal(matrix.receiverBaseline.httpRequestReceiptCount, 1);
    assert.equal(matrix.receiverBaseline.httpRequestBodyByteCount, 0);
    assert.equal(matrix.receiverBaseline.webSocketUpgradeReceiptCount, 0);
    assert.deepEqual(matrix.probeRouteRecords, clone(PASS_ROUTE_RECORDS));
  }
  return matrix;
}

function requirePass(matrix) {
  validateMatrix(matrix);
  assert.equal(matrix.status, "PASS");
}

function assertFiniteFailure(matrix, scalarId, assertionId) {
  validateMatrix(matrix);
  assert.equal(matrix.status, "FAIL");
  assert.equal(matrix.firstFailedScalarAssertion.scalarId, scalarId);
  assert.equal(matrix.firstFailedScalarAssertion.assertionId, assertionId);
  assert.ok(["boolean", "number", "string"].includes(
    typeof matrix.firstFailedScalarAssertion.actualSafeValue,
  ));
  assert.throws(() => requirePass(matrix));
}

function requireSuccessfulSentinelResult(result) {
  exactKeys(result, ["matrix", "operationalError"]);
  requirePass(result.matrix);
  if (result.operationalError !== null) throw result.operationalError;
  return result.matrix;
}

function nativePreblockRecords() {
  return NETWORK_SENTINEL_PROBE_IDS.map((probeId) => ({
    probeId,
    routeObserved: false,
    routeDecision: "not-observed",
    reasonCodes: [],
  }));
}

function missingHttpGetRouteRecords() {
  const records = clone(PASS_ROUTE_RECORDS);
  records[0] = {
    probeId: "HTTP_GET",
    routeObserved: false,
    routeDecision: "not-observed",
    reasonCodes: [],
  };
  return records;
}

function blockFailedHttpGetRouteRecords() {
  const records = clone(PASS_ROUTE_RECORDS);
  records[0] = {
    probeId: "HTTP_GET",
    routeObserved: true,
    routeDecision: "block-failed",
    reasonCodes: ["network-classification-blocked"],
  };
  return records;
}

function continueFailedHttpGetRouteRecords() {
  const records = clone(PASS_ROUTE_RECORDS);
  records[0] = {
    probeId: "HTTP_GET",
    routeObserved: true,
    routeDecision: "continue-failed",
    reasonCodes: [],
  };
  return records;
}

function invalidBootstrapMatrix() {
  return makeMatrix({
    bootstrapAllowedCount: 0,
    bootstrapReceiverHttpCount: 0,
    bootstrapConsumed: false,
    receiverBaseline: {
      ...clone(PASS_BASELINE),
      httpRequestReceiptCount: 0,
    },
  });
}

const passedCases = [];

function runUnitCases() {
  assert.equal(bootstrapRequestAllowed(ACTIVE_BOOTSTRAP_STATE, VALID_BOOTSTRAP_REQUEST), true);
  const passMatrix = makeMatrix();
  requirePass(passMatrix);
  assert.equal(requireSuccessfulSentinelResult({
    matrix: passMatrix,
    operationalError: null,
  }), passMatrix);
  assert.equal(passMatrix.matrixDigest, matrixDigest(passMatrix));
  assert.deepEqual(passMatrix.probeRouteRecords, clone(PASS_ROUTE_RECORDS));
  assert.equal(passMatrix.receiverBaseline.tcpConnectionReceiptCount, 1);
  for (const forbiddenKey of ["bootstrapUrl", "nonce", "headerValue", "bodyValue"]) {
    assert.equal(Object.hasOwn(passMatrix, forbiddenKey), false);
  }
  passedCases.push("B");
  return passMatrix.matrixDigest;
}

function runMutationCases() {
  const aboutBlankNativePreblock = makeMatrix({
    httpRouteObservedCount: 0,
    httpRouteBlockedCount: 0,
    crossOriginClassificationCount: 0,
    methodRejectedCount: 0,
    bodyRejectedCount: 0,
    webSocketRouteObservedCount: 0,
    webSocketRouteBlockedCount: 0,
    disallowedWebSocketCount: 0,
    browserNativePreblockCount: 3,
    httpGetBrowserResult: "native-preblock",
    httpPostBrowserResult: "native-preblock",
    webSocketBrowserResult: "native-preblock",
    probeRouteRecords: nativePreblockRecords(),
  });
  assertFiniteFailure(
    aboutBlankNativePreblock,
    "httpRouteObservedCount",
    "NETWORK_SENTINEL_HTTP_ROUTE_OBSERVED",
  );
  passedCases.push("A");

  assert.equal(bootstrapRequestAllowed({
    ...ACTIVE_BOOTSTRAP_STATE,
    sentinelBootstrapConsumed: true,
  }, VALID_BOOTSTRAP_REQUEST), false);
  assertFiniteFailure(
    makeMatrix({
      bootstrapAllowedCount: 2,
      bootstrapReceiverHttpCount: 2,
      receiverBaseline: {
        ...clone(PASS_BASELINE),
        httpRequestReceiptCount: 2,
      },
    }),
    "bootstrapAllowedCount",
    "NETWORK_SENTINEL_BOOTSTRAP_EXACTLY_ONCE",
  );
  passedCases.push("C");

  for (const [caseId, requestMutation] of [
    ["D", { exactBootstrapUrl: false }],
    ["E", { method: "POST" }],
    ["F", { bodyByteCount: 1 }],
    ["G", { credentialHeaderCount: 1 }],
  ]) {
    assert.equal(bootstrapRequestAllowed(ACTIVE_BOOTSTRAP_STATE, {
      ...VALID_BOOTSTRAP_REQUEST,
      ...requestMutation,
    }), false);
    assertFiniteFailure(
      invalidBootstrapMatrix(),
      "bootstrapAllowedCount",
      "NETWORK_SENTINEL_BOOTSTRAP_EXACTLY_ONCE",
    );
    passedCases.push(caseId);
  }

  assertFiniteFailure(makeMatrix({
    httpRouteObservedCount: 1,
    httpRouteBlockedCount: 1,
    crossOriginClassificationCount: 1,
    browserNativePreblockCount: 1,
    httpGetBrowserResult: "native-preblock",
    probeRouteRecords: missingHttpGetRouteRecords(),
  }), "httpRouteObservedCount", "NETWORK_SENTINEL_HTTP_ROUTE_OBSERVED");
  passedCases.push("H");

  assertFiniteFailure(
    makeMatrix({ httpRequestReceiptDelta: 1 }),
    "httpRequestReceiptDelta",
    "NETWORK_SENTINEL_RECEIVER_HTTP_DELTA_ZERO",
  );
  passedCases.push("I");

  assertFiniteFailure(
    makeMatrix({ webSocketUpgradeReceiptDelta: 1 }),
    "webSocketUpgradeReceiptDelta",
    "NETWORK_SENTINEL_RECEIVER_WEBSOCKET_DELTA_ZERO",
  );
  passedCases.push("J");

  assertFiniteFailure(makeMatrix({
    bootstrapReceiverHttpCount: 0,
    receiverBaseline: {
      tcpConnectionReceiptCount: 1,
      httpRequestReceiptCount: 0,
      httpRequestBodyByteCount: 0,
      webSocketUpgradeReceiptCount: 0,
    },
  }), "bootstrapReceiverHttpCount", "NETWORK_SENTINEL_BOOTSTRAP_EXACTLY_ONCE");
  passedCases.push("K");

  assertFiniteFailure(
    makeMatrix({ pageReturnedToAboutBlank: false }),
    "pageReturnedToAboutBlank",
    "NETWORK_SENTINEL_RETURNED_TO_ABOUT_BLANK",
  );
  passedCases.push("L");

  assertFiniteFailure(
    makeMatrix({ sentinelCountersReset: false }),
    "sentinelCountersReset",
    "NETWORK_SENTINEL_COUNTERS_RESET",
  );
  passedCases.push("M");

  const missingScalar = makeMatrix();
  delete missingScalar.httpRouteObservedCount;
  missingScalar.matrixDigest = matrixDigest(missingScalar);
  assert.throws(() => validateMatrix(missingScalar));
  passedCases.push("N");

  const wrongDigest = makeMatrix();
  wrongDigest.matrixDigest = "0".repeat(64);
  assert.throws(() => validateMatrix(wrongDigest));
  passedCases.push("O");

  assertFiniteFailure(
    makeMatrix({ httpRouteObservedCount: 3 }),
    "httpRouteObservedCount",
    "NETWORK_SENTINEL_HTTP_ROUTE_OBSERVED",
  );
  passedCases.push("DUPLICATE_HTTP_OBSERVATION");

  assertFiniteFailure(
    makeMatrix({ webSocketRouteObservedCount: 2 }),
    "webSocketRouteObservedCount",
    "NETWORK_SENTINEL_WEBSOCKET_ROUTE_OBSERVED",
  );
  passedCases.push("DUPLICATE_WEBSOCKET_OBSERVATION");

  assertFiniteFailure(makeMatrix({
    httpRouteBlockedCount: 1,
    httpGetBrowserResult: "route-action-failed",
    operationalErrorCount: 1,
    probeRouteRecords: blockFailedHttpGetRouteRecords(),
  }), "httpRouteBlockedCount", "NETWORK_SENTINEL_HTTP_ROUTE_BLOCKED");
  passedCases.push("ROUTE_BLOCK_ACTION_FAILURE");

  assertFiniteFailure(makeMatrix({
    httpGetBrowserResult: "route-action-failed",
    operationalErrorCount: 1,
    probeRouteRecords: continueFailedHttpGetRouteRecords(),
  }), "httpGetBrowserResult", "NETWORK_SENTINEL_HTTP_ROUTE_BLOCKED");
  passedCases.push("ROUTE_CONTINUE_ACTION_FAILURE");

  const evaluateFailure = Object.assign(
    new Error("bounded sentinel evaluate failure"),
    { code: "RC6_2_NETWORK_SENTINEL_EVALUATE_FAILED" },
  );
  const evaluateFailureMatrix = makeMatrix({
    httpRouteObservedCount: 1,
    httpRouteBlockedCount: 1,
    crossOriginClassificationCount: 1,
    httpGetBrowserResult: "evaluation-failed",
    operationalErrorCount: 1,
    probeRouteRecords: missingHttpGetRouteRecords(),
  });
  assertFiniteFailure(
    evaluateFailureMatrix,
    "httpRouteObservedCount",
    "NETWORK_SENTINEL_HTTP_ROUTE_OBSERVED",
  );
  assert.equal(evaluateFailureMatrix.httpGetBrowserResult, "evaluation-failed");
  assert.equal(evaluateFailureMatrix.operationalErrorCount, 1);
  assert.throws(
    () => requireSuccessfulSentinelResult({
      matrix: evaluateFailureMatrix,
      operationalError: evaluateFailure,
    }),
    (error) => error?.code === "ERR_ASSERTION",
  );
  passedCases.push("EVALUATE_LEVEL_FAILURE");

  const bootstrapExactPathVsTotal = makeMatrix({
    receiverBaseline: {
      ...clone(PASS_BASELINE),
      httpRequestReceiptCount: 2,
    },
  });
  assert.equal(bootstrapExactPathVsTotal.bootstrapReceiverHttpCount, 1);
  assert.equal(bootstrapExactPathVsTotal.receiverBaseline.httpRequestReceiptCount, 2);
  assertFiniteFailure(
    bootstrapExactPathVsTotal,
    "receiverBaseline.httpRequestReceiptCount",
    "NETWORK_SENTINEL_BOOTSTRAP_EXACTLY_ONCE",
  );
  passedCases.push("BOOTSTRAP_EXACT_PATH_VS_TOTAL");

  const receiverCloseTimeout = makeMatrix({
    operationalErrorCount: 1,
    receiverClosed: false,
  });
  assertFiniteFailure(
    receiverCloseTimeout,
    "operationalErrorCount",
    "NETWORK_SENTINEL_OPERATION_COMPLETED",
  );
  const receiverCloseTimeoutError = Object.assign(
    new Error("bounded receiver close timeout"),
    { code: "RC6_2_NETWORK_SENTINEL_RECEIVER_CLOSE_TIMEOUT" },
  );
  assert.equal(receiverCloseTimeoutError.code, "RC6_2_NETWORK_SENTINEL_RECEIVER_CLOSE_TIMEOUT");
  assert.throws(
    () => requireSuccessfulSentinelResult({
      matrix: receiverCloseTimeout,
      operationalError: receiverCloseTimeoutError,
    }),
    (error) => error?.code === "ERR_ASSERTION",
  );
  passedCases.push("RECEIVER_CLOSE_TIMEOUT");
}

let passMatrixDigest = null;
if (mode === "unit" || mode === "all") passMatrixDigest = runUnitCases();
if (mode === "mutations" || mode === "all") runMutationCases();
if (passMatrixDigest === null) passMatrixDigest = makeMatrix().matrixDigest;

const summary = {
  schemaVersion: "p24b-rc6.2-network-sentinel-tests-v1",
  status: "PASS",
  mode,
  matrixSchemaVersion: NETWORK_SENTINEL_SCHEMA,
  digestDomain: NETWORK_SENTINEL_SCHEMA,
  passMatrixDigest,
  passedCases,
  casePassCount: passedCases.length,
  unitPassCount: passedCases.includes("B") ? 1 : 0,
  mutationPassCount: passedCases.filter((caseId) => caseId !== "B").length,
  browserLaunchCount: 0,
  edgeLaunchCount: 0,
  playwrightLaunchCount: 0,
  networkRequestCount: 0,
  formalAuthorizationCount: 0,
  formalAttemptCount: 0,
  blockingSkipCount: 0,
  runnerSourceContract,
};

console.log(JSON.stringify(summary, null, 2));

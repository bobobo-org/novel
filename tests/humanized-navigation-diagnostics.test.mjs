import assert from "node:assert/strict";
import {
  classifyPostCutoverExactChunkRetry,
  isCompletedNextStaticScriptNavigationCancellation,
  isExactProductReleaseIdentity,
  isVerifiedNextStaticScriptResponse,
} from "../scripts/humanized-navigation-diagnostics.mjs";

const baseUrl = "https://novel.example.test";
const chromiumFailure = {
  url: `${baseUrl}/_next/static/chunks/3zh5sw6bqdcgn.js`,
  errorText: "net::ERR_ABORTED",
  method: "GET",
  resourceType: "script",
  rscHeader: "",
  observedAt: 1_500,
};
const navigationProof = {
  startedAt: 1_000,
  arrivedAt: 2_000,
  destinationUrl: `${baseUrl}/studio/project/test-project/chat?mode=play`,
  landed: true,
};
const accepts = (
  failure,
  engineName = "chromium",
  proof = navigationProof,
  currentUrl = navigationProof.destinationUrl,
) => (
  isCompletedNextStaticScriptNavigationCancellation({
    failure,
    engineName,
    baseUrl,
    currentUrl,
    navigationProof: proof,
  })
);

assert.equal(accepts(chromiumFailure), true, "Chromium may cancel one available Next chunk after completed navigation");
assert.equal(accepts({
  ...chromiumFailure,
  errorText: "Load request cancelled",
}, "webkit"), true, "WebKit keeps its existing completed-navigation cancellation allowance");

for (const [label, failure, engineName = "chromium"] of [
  ["unknown browser engine", chromiumFailure, "firefox"],
  ["non-abort failure", { ...chromiumFailure, errorText: "net::ERR_FAILED" }],
  ["non-GET request", { ...chromiumFailure, method: "POST" }],
  ["non-script resource", { ...chromiumFailure, resourceType: "fetch" }],
  ["RSC request", { ...chromiumFailure, rscHeader: "1" }],
  ["cross-origin script", { ...chromiumFailure, url: "https://other.example.test/_next/static/chunks/3zh5sw6bqdcgn.js" }],
  ["credentialed URL", { ...chromiumFailure, url: "https://user@novel.example.test/_next/static/chunks/3zh5sw6bqdcgn.js" }],
  ["query-bearing chunk", { ...chromiumFailure, url: `${chromiumFailure.url}?retry=1` }],
  ["fragment-bearing chunk", { ...chromiumFailure, url: `${chromiumFailure.url}#retry` }],
  ["nested chunk path", { ...chromiumFailure, url: `${baseUrl}/_next/static/chunks/app/3zh5sw6bqdcgn.js` }],
  ["non-Next script", { ...chromiumFailure, url: `${baseUrl}/assets/3zh5sw6bqdcgn.js` }],
  ["non-JavaScript asset", { ...chromiumFailure, url: `${baseUrl}/_next/static/chunks/3zh5sw6bqdcgn.css` }],
  ["failure before navigation", { ...chromiumFailure, observedAt: 999 }],
  ["failure after navigation", { ...chromiumFailure, observedAt: 2_001 }],
]) {
  assert.equal(accepts(failure, engineName), false, label);
}

assert.equal(accepts(chromiumFailure, "chromium", { ...navigationProof, landed: false }), false, "destination must have landed");
assert.equal(
  accepts(chromiumFailure, "chromium", {
    ...navigationProof,
    destinationUrl: `${baseUrl}/studio/project/other/chat?mode=play`,
  }),
  false,
  "navigation proof must bind to the exact settled route",
);

const verifiedResponse = {
  status: 200,
  contentType: "application/javascript; charset=utf-8",
  cacheControl: "public, max-age=31536000, immutable",
  bodyLength: 256,
};
assert.equal(isVerifiedNextStaticScriptResponse(verifiedResponse), true);
for (const [label, response] of [
  ["404 response", { ...verifiedResponse, status: 404 }],
  ["500 response", { ...verifiedResponse, status: 500 }],
  ["redirect response", { ...verifiedResponse, status: 302 }],
  ["wrong MIME", { ...verifiedResponse, contentType: "text/html" }],
  ["non-immutable response", { ...verifiedResponse, cacheControl: "public, max-age=0" }],
  ["empty response", { ...verifiedResponse, bodyLength: 0 }],
]) {
  assert.equal(isVerifiedNextStaticScriptResponse(response), false, label);
}

const expectedProductCommit = "a".repeat(40);
assert.equal(isExactProductReleaseIdentity({
  appCommit: expectedProductCommit,
  releaseProductCommit: expectedProductCommit,
}, expectedProductCommit), true);
assert.equal(isExactProductReleaseIdentity({
  appCommit: "b".repeat(40),
  releaseProductCommit: expectedProductCommit,
}, expectedProductCommit), false, "a different app commit is rejected");
assert.equal(isExactProductReleaseIdentity({
  appCommit: expectedProductCommit,
  releaseProductCommit: "b".repeat(40),
}, expectedProductCommit), false, "a different release Product commit is rejected");

const postCutoverOrigin = "https://novel-orcin.vercel.app";
const nestedChunkPath = "/_next/static/chunks/app/editor/3zh5sw6bqdcgn.js";
function pageErrorsAssertion(pageErrors) {
  try {
    assert.deepEqual(pageErrors, [], "320x568: create page errors");
  } catch (error) {
    error.mobileViewportPageErrorsAssertion = pageErrors;
    return error;
  }
  throw new Error("PAGE_ERRORS_ASSERTION_FIXTURE_MISSING");
}
function exactRetryInput(overrides = {}) {
  const pageErrors = overrides.pageErrors
    || [`Failed to load chunk ${nestedChunkPath} from module 1234`];
  return {
    runtimePhase: "post-cutover-production",
    retryMode: "exact-once",
    engineName: "webkit",
    viewport: { width: 320, height: 568 },
    attempt: 0,
    baseUrl: postCutoverOrigin,
    expectedProductCommit,
    pageErrors,
    requestedChunkRequests: [{
      url: `${postCutoverOrigin}${nestedChunkPath}`,
      method: "GET",
      resourceType: "script",
    }],
    ...overrides,
    error: overrides.error || pageErrorsAssertion(pageErrors),
  };
}
assert.deepEqual(classifyPostCutoverExactChunkRetry(exactRetryInput()), {
  chunkPath: nestedChunkPath,
  chunkUrl: `${postCutoverOrigin}${nestedChunkPath}`,
  origin: postCutoverOrigin,
}, "the exact production WebKit 320x568 failure qualifies once");
assert.deepEqual(classifyPostCutoverExactChunkRetry({
  ...exactRetryInput(),
  baseUrl: "https://novel-lqtechs-projects.vercel.app",
  requestedChunkRequests: [{
    url: `https://novel-lqtechs-projects.vercel.app${nestedChunkPath}`,
    method: "GET",
    resourceType: "script",
  }],
}), {
  chunkPath: nestedChunkPath,
  chunkUrl: `https://novel-lqtechs-projects.vercel.app${nestedChunkPath}`,
  origin: "https://novel-lqtechs-projects.vercel.app",
}, "the mirror production alias is also eligible");

for (const [label, overrides] of [
  ["staged phase", { runtimePhase: "staged-production" }],
  ["retry disabled", { retryMode: "none" }],
  ["Chromium", { engineName: "chromium" }],
  ["different viewport", { viewport: { width: 390, height: 844 } }],
  ["second attempt", { attempt: 1 }],
  ["missing expected Product commit", { expectedProductCommit: "" }],
  ["unapproved production origin", {
    baseUrl: "https://preview.example.test",
    requestedChunkRequests: [{
      url: `https://preview.example.test${nestedChunkPath}`,
      method: "GET",
      resourceType: "script",
    }],
  }],
  ["production origin with credentials", { baseUrl: "https://user@novel-orcin.vercel.app" }],
  ["production origin with a path", { baseUrl: "https://novel-orcin.vercel.app/staged" }],
  ["production origin with a query", { baseUrl: "https://novel-orcin.vercel.app/?staged=1" }],
  ["production origin with a fragment", { baseUrl: "https://novel-orcin.vercel.app/#staged" }],
  ["non-assertion failure", { error: { code: "ERR_NETWORK" } }],
  ["different assertion", { error: { code: "ERR_ASSERTION", operator: "strictEqual" } }],
  ["more than one page error", { pageErrors: [
    `Failed to load chunk ${nestedChunkPath} from module 1234`,
    `Failed to load chunk ${nestedChunkPath} from module 1234`,
  ] }],
  ["query-bearing error", {
    pageErrors: [`Failed to load chunk ${nestedChunkPath}?retry=1 from module 1234`],
  }],
  ["matching unhashed script", {
    pageErrors: ["Failed to load chunk /_next/static/chunks/other.js from module 1234"],
    requestedChunkRequests: [{
      url: `${postCutoverOrigin}/_next/static/chunks/other.js`, method: "GET", resourceType: "script",
    }],
  }],
  ["different requested chunk", { requestedChunkRequests: [{
    url: `${postCutoverOrigin}/_next/static/chunks/other.js`, method: "GET", resourceType: "script",
  }] }],
  ["query-bearing request", { requestedChunkRequests: [{
    url: `${postCutoverOrigin}${nestedChunkPath}?retry=1`, method: "GET", resourceType: "script",
  }] }],
  ["cross-origin request", { requestedChunkRequests: [{
    url: `https://other.example.test${nestedChunkPath}`, method: "GET", resourceType: "script",
  }] }],
  ["non-GET request", { requestedChunkRequests: [{
    url: `${postCutoverOrigin}${nestedChunkPath}`, method: "POST", resourceType: "script",
  }] }],
  ["non-script request", { requestedChunkRequests: [{
    url: `${postCutoverOrigin}${nestedChunkPath}`, method: "GET", resourceType: "fetch",
  }] }],
  ["no observed request", { requestedChunkRequests: [] }],
]) {
  assert.equal(classifyPostCutoverExactChunkRetry(exactRetryInput(overrides)), null, label);
}

console.log(JSON.stringify({
  suite: "HUMANIZED_NAVIGATION_DIAGNOSTICS",
  pass: 52,
  fail: 0,
}, null, 2));

import assert from "node:assert/strict";
import {
  isCompletedNextStaticScriptNavigationCancellation,
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

console.log(JSON.stringify({
  suite: "HUMANIZED_NAVIGATION_DIAGNOSTICS",
  pass: 25,
  fail: 0,
}, null, 2));

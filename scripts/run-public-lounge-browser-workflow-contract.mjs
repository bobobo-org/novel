import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
const browserGate = await readFile(new URL("./verify-public-lounge-browser.mjs", import.meta.url), "utf8");

const stagedRuntime = workflow.indexOf("Verify staged public lounge runtime and privacy boundary");
const stagedBrowser = workflow.indexOf("Verify staged public lounge in a real browser");
const stagedBrowserUpload = workflow.indexOf("Upload staged public lounge browser evidence");

assert(stagedRuntime >= 0);
assert(stagedBrowser > stagedRuntime);
assert(stagedBrowserUpload > stagedBrowser);
assert.equal(workflow.includes("working-directory: .release-product"), true);
assert.equal(workflow.includes("PUBLIC_LOUNGE_BROWSER_ORIGINS: ${{ env.STAGED_URL }}"), true);
assert.equal(workflow.includes("PUBLIC_LOUNGE_BROWSER_REPORT_PATH: ${{ runner.temp }}/staged-public-lounge-browser.json"), true);
assert.equal(workflow.includes("(cd .release-product && node scripts/verify-public-lounge-browser.mjs)"), true);
assert.equal(workflow.includes('test -s "$PUBLIC_LOUNGE_BROWSER_REPORT_PATH"'), true);
assert.equal(workflow.includes('test -s "$RUNNER_TEMP/post-cutover-mobile-browser.log"'), true);
assert.equal(workflow.includes("public-lounge-browser-waiver-v1"), true);
assert.equal(workflow.includes("immutable-product-recovery-uses-release-bound-browser-proof"), true);
assert.equal(workflow.includes("${{ runner.temp }}/post-cutover-browser-proof-waiver.json"), true);

assert.equal(browserGate.includes("ephemeral-client-fixture"), true);
assert.equal(browserGate.includes("positiveDetailProof"), true);
assert.equal(browserGate.includes("PUBLIC_LOUNGE_BROWSER_PUBLIC_METRIC_INVENTED"), true);
assert.equal(browserGate.includes("captureInteractionReads"), true);
assert.equal(browserGate.includes("PUBLIC_LOUNGE_BROWSER_READY_METRICS_NOT_AUTHORITATIVE"), true);
assert.equal(browserGate.includes('value.schemaVersion !== "public-lounge-interactions-api-v1"'), true);
assert.equal(browserGate.includes("PUBLIC_LOUNGE_BROWSER_FRESH_CONTEXT_AUTHENTICATED"), true);
assert.equal(browserGate.includes("PUBLIC_LOUNGE_BROWSER_UNAVAILABLE_STATUS_MISSING"), true);
assert.equal(browserGate.includes("capture.settle()"), true);
assert.equal(browserGate.includes("PUBLIC_LOUNGE_BROWSER_MAGIC_LINK_AVAILABLE_WITHOUT_SERVICE"), true);
assert.equal(browserGate.includes('"推薦｜等待登入服務"'), true);
assert.equal(browserGate.includes('"留言｜等待登入服務"'), true);
assert.equal(browserGate.includes("authoritativeInteractionMetricsVerified"), true);
assert.equal(browserGate.includes("deployedClientFixtureVerified"), true);
assert.equal(browserGate.includes("PUBLIC_LOUNGE_BROWSER_CLIENT_FIXTURE_ONLY"), true);
assert.equal(browserGate.includes("PUBLIC_LOUNGE_BROWSER_ALLOW_LOOPBACK_HTTP"), true);
assert.equal(browserGate.includes("schemaVersion: \"public-lounge-browser-runtime-gate-v1\""), true);
assert.equal(browserGate.includes("status: \"FAIL\""), true);
assert.equal(browserGate.includes("responseBodiesStored: false"), true);
assert.equal(browserGate.includes("privatePayloadStored: false"), true);

console.log("PUBLIC_LOUNGE_BROWSER_WORKFLOW_CONTRACT_TESTS_PASS");

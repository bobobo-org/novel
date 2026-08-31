import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const AUDIT_CONTROL_PROOF_SCHEMA = "p24b-rc6.2-browser-gate-control-proof-v7";
const HISTORICAL_C9_AUDIT_CONTROL_PROOF_SCHEMA = "p24b-rc6.2-browser-gate-control-proof-v6";
const PRODUCT_COMMIT = "29fc6e742672bb07187765d34ea818afdadf56ae";
const FAILED_RECOVERY_CONTROL = "3b716fc0d974a9d59b49ffca5953776af66c7a07";
const PRODUCTION_RECOVERY_CONTROL = "9cd074f239b73dd9b61f6d758fcf97fbd809face";
const INITIAL_BROWSER_GATE_CONTROL = "aab0e7bd52c57bc57ecfe8be8b08c1cf63db9824";
const C4_BROWSER_GATE_CONTROL = "100eea11003c5132ab2b519707c5dee658bc9cbe";
const C5_BROWSER_GATE_CONTROL = "99695b247c2b1626c38efc8ae4589dd9bd8d30da";
const C6_BROWSER_GATE_CONTROL = "b326c2fc9925798ffbc750ae37db847f0c8b5625";
const C7_BROWSER_GATE_CONTROL = "7dea0b8dd488a0f2a24132266944cb95b2f15ca9";
const C8_BROWSER_GATE_CONTROL = "04e78268cfcfeaeffdc72b603d0700944c7142e7";
const C9_BROWSER_GATE_CONTROL = "92fe2ff7550ef3aeff9447252714d10d6c771d6b";
const C10_AUDIT_CONTROL_FIXTURE = "1111111111111111111111111111111111111111";
const C8_CHANGED_PATHS = [
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
const C9_CHANGED_PATHS = [
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
const C10_CHANGED_PATHS = [
  ".github/workflows/deploy.yml",
  "package.json",
  "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate.ps1",
];
const C7_CHANGED_PATHS = [
  ".github/workflows/deploy.yml", "package.json", "scripts/rc6-2-formal-attempt-state.mjs",
  "scripts/rc6-2-terminal-evidence.mjs", "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-closed-agent-browser.mjs", "scripts/run-rc6-2-formal-attempt-state-tests.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate.ps1", "scripts/run-rc6-2-terminal-evidence-tests.mjs",
];
const C6_CHANGED_PATHS = [
  ".github/workflows/deploy.yml", "package.json", "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs", "scripts/run-rc6-2-production-browser-gate.ps1",
];
const HISTORICAL_CHANGED_PATHS = [
  ".github/workflows/deploy.yml", "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs", "scripts/run-rc6-2-production-browser-gate.ps1",
];
const INITIAL_CHANGED_PATHS = [
  ".github/workflows/deploy.yml", "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-closed-agent-browser.mjs", "scripts/run-rc6-2-closed-agent-runtime.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs", "scripts/run-rc6-2-production-browser-gate.ps1",
];
const COMPOSITE_CHANGED_PATHS = [
  ".github/workflows/deploy.yml", "package.json", "scripts/rc6-2-formal-attempt-state.mjs",
  "scripts/rc6-2-terminal-evidence.mjs", "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-rc6-2-closed-agent-browser.mjs", "scripts/run-rc6-2-closed-agent-runtime.mjs",
  "scripts/run-rc6-2-formal-attempt-state-tests.mjs", "scripts/run-rc6-2-network-sentinel-tests.mjs",
  "scripts/run-rc6-2-production-browser-gate-contract.mjs",
  "scripts/run-rc6-2-production-browser-gate.ps1", "scripts/run-rc6-2-runner-envelope-tests.mjs",
  "scripts/run-rc6-2-terminal-evidence-tests.mjs",
];

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  )).join(",")}}`;
}

function auditControlProofDigest(body, domain = AUDIT_CONTROL_PROOF_SCHEMA) {
  return createHash("sha256").update(stableStringify({ domain, body })).digest("hex");
}

function validateAuditControlProof(proof, label) {
  assert.ok(proof && typeof proof === "object" && !Array.isArray(proof), `${label} must be an object`);
  assert.deepEqual(Object.keys(proof).sort(), [
    "browserGateControl", "c4BrowserGateControl", "c4ChangedPaths", "c5BrowserGateControl",
    "c5ChangedPaths", "c6BrowserGateControl", "c6ChangedPaths", "c7BrowserGateControl",
    "c7ChangedPaths", "c8BrowserGateControl", "c8ChangedPaths", "c9BrowserGateControl",
    "c9ChangedPaths", "changedPaths", "compositeChangedPaths", "eventName", "eventRef",
    "failedRecoveryControl", "initialBrowserGateControl", "initialChangedPaths", "lineage",
    "operation", "parentCommit", "productCommit", "productionRecoveryControl", "proofDigest",
    "repository", "runAttempt", "runId", "schemaVersion", "workflowRef", "workflowSha",
  ].sort(), `${label} must have the exact v7 key set`);
  const { proofDigest, ...body } = proof;
  assert.equal(
    body.schemaVersion,
    AUDIT_CONTROL_PROOF_SCHEMA,
    `${label} must use the C10 v7 body schema`,
  );
  assert.match(body.browserGateControl, /^[a-f0-9]{40}$/u, `${label} control commit must be exact`);
  assert.equal(body.productCommit, PRODUCT_COMMIT, `${label} must pin the Product commit`);
  assert.equal(body.failedRecoveryControl, FAILED_RECOVERY_CONTROL, `${label} must pin failed recovery`);
  assert.equal(body.productionRecoveryControl, PRODUCTION_RECOVERY_CONTROL, `${label} must pin recovery`);
  assert.equal(body.initialBrowserGateControl, INITIAL_BROWSER_GATE_CONTROL, `${label} must pin initial control`);
  assert.equal(body.c4BrowserGateControl, C4_BROWSER_GATE_CONTROL, `${label} must pin C4`);
  assert.equal(body.c5BrowserGateControl, C5_BROWSER_GATE_CONTROL, `${label} must pin C5`);
  assert.equal(body.c6BrowserGateControl, C6_BROWSER_GATE_CONTROL, `${label} must pin C6`);
  assert.equal(body.c7BrowserGateControl, C7_BROWSER_GATE_CONTROL, `${label} must pin C7`);
  assert.equal(body.c9BrowserGateControl, C9_BROWSER_GATE_CONTROL, `${label} must pin the C9 control`);
  assert.equal(body.c8BrowserGateControl, C8_BROWSER_GATE_CONTROL, `${label} must pin the C8 control`);
  assert.equal(body.parentCommit, C9_BROWSER_GATE_CONTROL, `${label} parent must be the C9 control`);
  assert.deepEqual(
    body.lineage,
    [body.browserGateControl, C9_BROWSER_GATE_CONTROL, C8_BROWSER_GATE_CONTROL,
      C7_BROWSER_GATE_CONTROL, C6_BROWSER_GATE_CONTROL, C5_BROWSER_GATE_CONTROL,
      C4_BROWSER_GATE_CONTROL, INITIAL_BROWSER_GATE_CONTROL, PRODUCTION_RECOVERY_CONTROL,
      FAILED_RECOVERY_CONTROL, PRODUCT_COMMIT],
    `${label} must bind the complete exact C10 -> Product lineage`,
  );
  assert.deepEqual(body.changedPaths, C10_CHANGED_PATHS, `${label} must bind the exact C10 path set`);
  assert.deepEqual(body.c9ChangedPaths, C9_CHANGED_PATHS, `${label} must bind the exact C9 path set`);
  assert.deepEqual(body.c8ChangedPaths, C8_CHANGED_PATHS, `${label} must bind the exact C8 path set`);
  assert.deepEqual(body.c7ChangedPaths, C7_CHANGED_PATHS, `${label} must bind the exact C7 path set`);
  assert.deepEqual(body.c6ChangedPaths, C6_CHANGED_PATHS, `${label} must bind the exact C6 path set`);
  assert.deepEqual(body.c5ChangedPaths, HISTORICAL_CHANGED_PATHS, `${label} must bind the exact C5 path set`);
  assert.deepEqual(body.c4ChangedPaths, HISTORICAL_CHANGED_PATHS, `${label} must bind the exact C4 path set`);
  assert.deepEqual(body.initialChangedPaths, INITIAL_CHANGED_PATHS, `${label} must bind the exact initial path set`);
  assert.deepEqual(body.compositeChangedPaths, COMPOSITE_CHANGED_PATHS, `${label} must bind the exact composite path set`);
  assert.equal(body.operation, "audit-rc6-2-last-known-good", `${label} operation drifted`);
  assert.equal(body.repository, "bobobo-org/novel", `${label} repository drifted`);
  assert.equal(body.eventName, "workflow_dispatch", `${label} event drifted`);
  assert.equal(body.eventRef, "refs/heads/main", `${label} ref drifted`);
  assert.equal(body.workflowSha, body.browserGateControl, `${label} workflow SHA drifted`);
  assert.equal(body.workflowRef, "bobobo-org/novel/.github/workflows/deploy.yml@refs/heads/main", `${label} workflow ref drifted`);
  assert.match(body.runId, /^[1-9][0-9]{0,19}$/u, `${label} run ID drifted`);
  assert.match(body.runAttempt, /^[1-9][0-9]{0,9}$/u, `${label} run attempt drifted`);
  assert.match(proofDigest, /^[a-f0-9]{64}$/u, `${label} digest must be a SHA-256 value`);
  assert.equal(
    proofDigest,
    auditControlProofDigest(body),
    `${label} digest must use the C10 v7 domain over the complete v7 body`,
  );
  return proofDigest;
}

function auditControlProofFixture({
  schemaVersion = AUDIT_CONTROL_PROOF_SCHEMA,
  digestDomain = AUDIT_CONTROL_PROOF_SCHEMA,
} = {}) {
  const body = {
    schemaVersion,
    operation: "audit-rc6-2-last-known-good",
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
    browserGateControl: C10_AUDIT_CONTROL_FIXTURE,
    parentCommit: C9_BROWSER_GATE_CONTROL,
    repository: "bobobo-org/novel",
    eventName: "workflow_dispatch",
    eventRef: "refs/heads/main",
    workflowSha: C10_AUDIT_CONTROL_FIXTURE,
    workflowRef: "bobobo-org/novel/.github/workflows/deploy.yml@refs/heads/main",
    runId: "1",
    runAttempt: "1",
    lineage: [C10_AUDIT_CONTROL_FIXTURE, C9_BROWSER_GATE_CONTROL, C8_BROWSER_GATE_CONTROL,
      C7_BROWSER_GATE_CONTROL, C6_BROWSER_GATE_CONTROL, C5_BROWSER_GATE_CONTROL,
      C4_BROWSER_GATE_CONTROL, INITIAL_BROWSER_GATE_CONTROL, PRODUCTION_RECOVERY_CONTROL,
      FAILED_RECOVERY_CONTROL, PRODUCT_COMMIT],
    changedPaths: C10_CHANGED_PATHS,
    c9ChangedPaths: C9_CHANGED_PATHS,
    c8ChangedPaths: C8_CHANGED_PATHS,
    c7ChangedPaths: C7_CHANGED_PATHS,
    c6ChangedPaths: C6_CHANGED_PATHS,
    c5ChangedPaths: HISTORICAL_CHANGED_PATHS,
    c4ChangedPaths: HISTORICAL_CHANGED_PATHS,
    initialChangedPaths: INITIAL_CHANGED_PATHS,
    compositeChangedPaths: COMPOSITE_CHANGED_PATHS,
  };
  return { ...body, proofDigest: auditControlProofDigest(body, digestDomain) };
}

validateAuditControlProof(auditControlProofFixture(), "C10 v7 positive fixture");
assert.throws(
  () => validateAuditControlProof(auditControlProofFixture({
    schemaVersion: HISTORICAL_C9_AUDIT_CONTROL_PROOF_SCHEMA,
    digestDomain: HISTORICAL_C9_AUDIT_CONTROL_PROOF_SCHEMA,
  }), "C10-as-v6 negative fixture"),
  /must use the C10 v7 body schema/u,
  "a C10 proof must not be accepted under the historical C9 v6 body/domain",
);
assert.throws(
  () => validateAuditControlProof(auditControlProofFixture({
    digestDomain: HISTORICAL_C9_AUDIT_CONTROL_PROOF_SCHEMA,
  }), "v6-domain negative fixture"),
  /digest must use the C10 v7 domain/u,
  "a v7 body must not be accepted with the historical v6 digest domain",
);
{
  const truncated = auditControlProofFixture();
  const truncatedBody = { ...truncated, lineage: truncated.lineage.slice(0, 4) };
  delete truncatedBody.proofDigest;
  assert.throws(
    () => validateAuditControlProof({ ...truncatedBody, proofDigest: auditControlProofDigest(truncatedBody) }, "truncated lineage negative fixture"),
    /complete exact C10/u,
  );
  const omitted = auditControlProofFixture();
  delete omitted.c9ChangedPaths;
  const omittedBody = { ...omitted };
  delete omittedBody.proofDigest;
  assert.throws(
    () => validateAuditControlProof({ ...omittedBody, proofDigest: auditControlProofDigest(omittedBody) }, "omitted field negative fixture"),
    /exact v7 key set/u,
  );
}

const [
  workflow,
  rollback,
  packageText,
  p21ThreeHigh,
  vercelConfigurationText,
  browserGateContract,
] = await Promise.all([
  readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"),
  readFile(new URL("./vercel-dual-alias-cutover.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("./run-p21-three-high-closure.mjs", import.meta.url), "utf8"),
  readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  readFile(new URL("./run-rc6-2-production-browser-gate-contract.mjs", import.meta.url), "utf8"),
]);
const packageScripts = JSON.parse(packageText).scripts;
const vercelConfiguration = JSON.parse(vercelConfigurationText);
assert.equal(
  vercelConfiguration.git?.deploymentEnabled,
  false,
  "native Vercel Git deploys must stay disabled so they cannot bypass the staged Actions pipeline",
);

const jobNames = [
  "validate",
  "preview",
  "historical_rc6_2_recovery_hold",
  "audit_last_known_good",
  "production_env_audit",
  "production_env_repair",
  "restore_known_stable",
  "production_build",
  "post_build_secret_scan",
  "staged_deploy",
  "runtime_gates",
  "alias_cutover",
  "alias_cutover_rollback_guard",
  "main_push_complete",
  "recovery_complete",
];
const jobsHeaderIndex = workflow.indexOf("\njobs:");
assert.ok(jobsHeaderIndex > 0);
const parsedJobNames = [
  ...workflow.slice(jobsHeaderIndex + "\njobs:".length).matchAll(/^  ([a-z][a-z0-9_]*):\s*$/gmu),
].map((match) => match[1]);
assert.deepEqual(parsedJobNames, jobNames, "workflow jobs must be unique and remain in the exact gated order");
const indexes = Object.fromEntries(jobNames.map((name) => [name, workflow.indexOf(`\n  ${name}:`)]));
for (const name of jobNames) assert.ok(indexes[name] > 0, `missing workflow job ${name}`);
for (let index = 1; index < jobNames.length; index += 1) {
  const left = jobNames[index - 1];
  const right = jobNames[index];
  assert.ok(indexes[left] < indexes[right], `${left} must precede ${right}`);
}

function section(name) {
  const start = indexes[name];
  const next = Object.values(indexes).filter((index) => index > start).sort((a, b) => a - b)[0];
  return workflow.slice(start, next || workflow.length);
}

function stepSection(job, name) {
  const marker = `      - name: ${name}`;
  const start = job.indexOf(marker);
  assert.ok(start >= 0, `missing workflow step ${name}`);
  const next = job.indexOf("\n      - name:", start + marker.length);
  return job.slice(start, next < 0 ? job.length : next);
}

function successfulStepOutcomes(step) {
  return [...step.matchAll(/steps\.([a-z][a-z0-9_]*)\.outcome == 'success'/gu)]
    .map((match) => match[1]);
}

function failedStepOutcomes(step) {
  return [...step.matchAll(/steps\.([a-z][a-z0-9_]*)\.outcome != 'success'/gu)]
    .map((match) => match[1]);
}

const globalConfiguration = workflow.slice(0, workflow.indexOf("\njobs:"));
const validateJob = section("validate");
const previewJob = section("preview");
const historicalRecoveryHoldJob = section("historical_rc6_2_recovery_hold");
const lastKnownGoodAuditJob = section("audit_last_known_good");
const productionAuditJob = section("production_env_audit");
const repairJob = section("production_env_repair");
const buildJob = section("production_build");
const postBuildSecretScanJob = section("post_build_secret_scan");
const stagedJob = section("staged_deploy");
const runtimeJob = section("runtime_gates");
const aliasJob = section("alias_cutover");
const aliasRollbackGuardJob = section("alias_cutover_rollback_guard");
const restoreJob = section("restore_known_stable");
const mainPushCompleteJob = section("main_push_complete");
const recoveryCompleteJob = section("recovery_complete");

assert.match(globalConfiguration, /permissions:\s*[\s\S]*contents:\s*read[\s\S]*actions:\s*read[\s\S]*attestations:\s*read/u);

for (const secret of [
  "VERCEL_TOKEN",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID",
  "SUPABASE_SERVICE_ROLE_KEY",
  "XAI_API_KEY",
]) {
  assert.doesNotMatch(globalConfiguration, new RegExp(`\\b${secret}\\b`, "u"), `${secret} must not be global`);
  assert.doesNotMatch(validateJob, new RegExp(`\\b${secret}\\b`, "u"), `${secret} must not be available to validate`);
}
assert.match(
  validateJob,
  /VERCEL_GIT_COMMIT_SHA:[^\r\n]*inputs\.operation == 'deploy-immutable-product-recovery'[^\r\n]*29fc6e742672bb07187765d34ea818afdadf56ae[^\r\n]*github\.sha/u,
);
assert.match(validateJob, /Verify exact dual-SHA recovery control commit/u);
assert.match(validateJob, /verify-production-recovery-control\.mjs/u);
assert.match(validateJob, /run-production-recovery-control-tests\.mjs/u);
assert.match(validateJob, /run-production-main-head-cas-tests\.mjs/u);
assert.match(validateJob, /Checkout trusted recovery control commit[\s\S]*fetch-depth:\s*3/u);
assert.ok(
  validateJob.indexOf("Install locked recovery-control test dependencies")
    < validateJob.indexOf("Verify dual-SHA runtime-closure contract from the control commit")
  && validateJob.indexOf("Verify dual-SHA runtime-closure contract from the control commit")
    < validateJob.indexOf("Checkout exact Product commit"),
  "control closure must run with locked dependencies before the Product checkout replaces the control tree",
);
assert.match(validateJob, /node --import \.\/scripts\/register-rc6-test-loader\.mjs scripts\/run-rc6-2-runtime-closure\.mjs/u);
assert.match(validateJob, /node scripts\/run-rc6-1-deployment-governance\.mjs all/u);
assert.ok(
  validateJob.indexOf("node scripts/generate-release-provenance.mjs")
    < validateJob.indexOf("node --import ./scripts/register-rc6-test-loader.mjs scripts/run-rc6-2-runtime-closure.mjs")
  && validateJob.indexOf("node --import ./scripts/register-rc6-test-loader.mjs scripts/run-rc6-2-runtime-closure.mjs")
    < validateJob.indexOf("Checkout exact Product commit"),
  "control provenance must be generated before the loader-backed closure, both before Product checkout",
);
assert.match(validateJob, /repository:\s*\$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.repo\.full_name \|\| github\.repository \}\}/u);
assert.match(validateJob, /ref:\s*\$\{\{ env\.VERCEL_GIT_COMMIT_SHA \}\}/u);
assert.match(validateJob, /--arg headSha "\$VERCEL_GIT_COMMIT_SHA"/u);
assert.match(validateJob, /p24b-rc6-validation-\$\{\{ env\.VERCEL_GIT_COMMIT_SHA \}\}/u);

assert.match(globalConfiguration, /push:[\s\S]*branches:[\s\S]*- main/u);
assert.doesNotMatch(globalConfiguration, /agent\/p24b-rc6-conversation-first/u);
assert.match(globalConfiguration, /preview_ref:/u);
assert.match(globalConfiguration, /deploy-preview/u);
assert.match(globalConfiguration, /deploy-immutable-product-recovery/u);
assert.match(globalConfiguration, /audit-rc6-2-last-known-good/u);
assert.match(globalConfiguration, /RECOVERY_PRODUCT_COMMIT:\s*29fc6e742672bb07187765d34ea818afdadf56ae/u);
assert.match(globalConfiguration, /CONTROL_COMMIT:\s*\$\{\{ github\.sha \}\}/u);
assert.match(globalConfiguration, /PRODUCT_COMMIT:[^\r\n]*deploy-immutable-product-recovery[^\r\n]*github\.sha/u);
assert.match(globalConfiguration, /VERCEL_GIT_COMMIT_SHA:[^\r\n]*deploy-immutable-product-recovery[^\r\n]*github\.sha/u);
assert.doesNotMatch(globalConfiguration, /vars\.RC6_4_PRODUCT_COMMIT|vars\.RC6_4_RELEASE_DATABASE_ID/u);
assert.match(validateJob, /Validate and export Product-owned release identity/u);
assert.match(validateJob, /release-manifest\.json[\s\S]*release-metadata-contract\.json[\s\S]*generated\/release-provenance\.json/u);
for (const [name, value] of [
  ["RC6_2_LKG_APP_COMMIT", PRODUCT_COMMIT],
  ["RC6_2_LKG_PRIMARY_DEPLOYMENT_ID", "dpl_8pqTpwAgQQAqmLKNzZNCzSfPuqNn"],
  ["RC6_2_LKG_MIRROR_DEPLOYMENT_ID", "dpl_8pqTpwAgQQAqmLKNzZNCzSfPuqNn"],
  ["RC6_2_LKG_RELEASE_TAG", "novel-ai-p24b-conversation-first-studio-rc6.2"],
  ["RC6_2_LKG_RELEASE_REVISION", "rc6.2"],
  ["RC6_2_LKG_ARTIFACT_ID", "'9114871493'"],
  ["RC6_2_LKG_ARTIFACT_NAME", "production-last-known-good-control-9cd074f239b73dd9b61f6d758fcf97fbd809face-product-29fc6e742672bb07187765d34ea818afdadf56ae"],
  ["RC6_2_LKG_ARTIFACT_DIGEST", "sha256:b08153dd5ae5b908a1b972799746a1a2621cb2a33bf90025853fa1688f941a5b"],
  ["RC6_2_LKG_RUN_ID", "'31524952520'"],
  ["RC6_2_LKG_CONTROL_COMMIT", PRODUCTION_RECOVERY_CONTROL],
  ["HISTORICAL_RC6_1_LKG_APP_COMMIT", "e84972aaec80885f9e2ab58e56252fb7b93522ea"],
  ["HISTORICAL_RC6_1_LKG_DEPLOYMENT_ID", "dpl_EHemQJyNZtn1NS69tnxQ24dKBRN3"],
  ["HISTORICAL_RC6_1_LKG_RELEASE_TAG", "novel-ai-p24b-conversation-first-studio-rc6"],
  ["HISTORICAL_RC6_1_LKG_RELEASE_REVISION", "rc6.1"],
]) assert.match(globalConfiguration, new RegExp(`^  ${name}: ${value}$`, "mu"));
assert.match(globalConfiguration, /group:[^\r\n]*deploy-immutable-product-recovery[^\r\n]*vercel-production-main/u);
assert.match(globalConfiguration, /group:[^\r\n]*audit-rc6-2-last-known-good[^\r\n]*vercel-lkg-audit/u);
assert.match(globalConfiguration, /cancel-in-progress:[^\r\n]*deploy-immutable-product-recovery/u);

assert.match(previewJob, /needs:\s*validate/u);
assert.match(previewJob, /head\.repo\.full_name == github\.repository/u);
assert.match(previewJob, /inputs\.operation == 'deploy-preview'/u);
assert.doesNotMatch(previewJob, /github\.event_name == 'push'|audit-last-known-good|audit-rc6-2-last-known-good|deploy-immutable-product-recovery|restore-known-stable/u);
assert.match(previewJob, /\^\[a-f0-9\]\{40\}\$/u);
assert.match(previewJob, /git rev-parse HEAD/u);
assert.match(previewJob, /ref:\s*\$\{\{ env\.VERCEL_GIT_COMMIT_SHA \}\}/u);
assert.match(previewJob, /environment=preview/u);
assert.match(previewJob, /vercel deploy --prebuilt/u);
assert.match(previewJob, /\/api\/release\/identity/u);
assert.doesNotMatch(previewJob, /--prod/u);
assert.doesNotMatch(previewJob, /PRIMARY_ALIAS|MIRROR_ALIAS/u);
assert.doesNotMatch(previewJob, /SUPABASE_ACCESS_TOKEN/u);
assert.doesNotMatch(previewJob, /production-last-known-good|production-environment-governance|vercel-dual-alias-cutover/u);
assert.doesNotMatch(previewJob, /\n  audit_last_known_good:/u);

assert.match(historicalRecoveryHoldJob, /github\.event_name == 'workflow_dispatch'/u);
assert.match(historicalRecoveryHoldJob, /github\.ref == 'refs\/heads\/main'/u);
assert.match(historicalRecoveryHoldJob, /inputs\.operation == 'deploy-immutable-product-recovery'/u);
assert.match(historicalRecoveryHoldJob, /github\.sha != '9cd074f239b73dd9b61f6d758fcf97fbd809face'/u);
assert.match(historicalRecoveryHoldJob, /HOLD: RC6\.2 recovery is preserved only as read-only prior provenance/u);
assert.match(historicalRecoveryHoldJob, /exit 1/u);
assert.doesNotMatch(historicalRecoveryHoldJob, /actions\/checkout|vercel|gh\s+api|curl|wget/u);

assert.match(
  lastKnownGoodAuditJob,
  /if:\s*>-[\s\S]*always\(\)[\s\S]*deploy-immutable-product-recovery[\s\S]*audit-last-known-good[\s\S]*audit-rc6-2-last-known-good/u,
);
assert.match(lastKnownGoodAuditJob, /^    needs:\s*validate$/mu);
assert.match(
  lastKnownGoodAuditJob,
  /AUDIT_COMMIT:\s*\$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.operation == 'audit-last-known-good' && inputs\.preview_ref \|\| github\.sha \}\}/u,
);
assert.match(lastKnownGoodAuditJob, /EXPECTED_EVENT_COMMIT:\s*\$\{\{ github\.sha \}\}/u);
assert.match(lastKnownGoodAuditJob, /\[\[ "\$AUDIT_COMMIT" =~ \^\[a-f0-9\]\{40\}\$ \]\]/u);
assert.match(lastKnownGoodAuditJob, /\[\[ "\$AUDIT_COMMIT" == "\$EXPECTED_EVENT_COMMIT" \]\]/u);
assert.match(lastKnownGoodAuditJob, /ref:\s*\$\{\{ github\.sha \}\}/u);
const readOnlyAuditCheckoutStep = stepSection(lastKnownGoodAuditJob, "Checkout exact read-only audit commit");
assert.match(readOnlyAuditCheckoutStep, /ref:\s*\$\{\{ github\.sha \}\}/u);
assert.match(readOnlyAuditCheckoutStep, /fetch-depth:\s*11/u);
assert.equal(
  [...readOnlyAuditCheckoutStep.matchAll(/fetch-depth:/gu)].length,
  1,
  "the read-only C10 lineage checkout must declare exactly one finite fetch depth",
);
assert.match(lastKnownGoodAuditJob, /persist-credentials:\s*false/u);
assert.match(lastKnownGoodAuditJob, /\[\[ "\$\(git rev-parse HEAD\)" == "\$AUDIT_COMMIT" \]\]/u);
assert.match(lastKnownGoodAuditJob, /Prove exact read-only RC6\.2 browser-gate control lineage/u);
assert.match(lastKnownGoodAuditJob, /id:\s*browser_gate_control/u);
assert.match(lastKnownGoodAuditJob, /if:\s*inputs\.operation == 'audit-rc6-2-last-known-good'/u);
assert.match(lastKnownGoodAuditJob, /run-rc6-2-production-browser-gate-contract\.mjs write-audit-control-proof/u);
const auditControlProofProducerStep = stepSection(
  lastKnownGoodAuditJob,
  "Prove exact read-only RC6.2 browser-gate control lineage",
);
const auditControlProofValidationStep = stepSection(
  lastKnownGoodAuditJob,
  "Validate exact C10 read-only audit control proof",
);
assert.match(
  auditControlProofProducerStep,
  /run:\s*node scripts\/run-rc6-2-production-browser-gate-contract\.mjs write-audit-control-proof\s*$/mu,
);
assert.match(
  auditControlProofValidationStep,
  /if:\s*inputs\.operation == 'audit-rc6-2-last-known-good'/u,
);
assert.match(
  auditControlProofValidationStep,
  /BROWSER_GATE_CONTROL_PROOF_PATH:\s*\$\{\{ runner\.temp \}\}\/rc6-2-browser-gate-control-proof\.json/u,
);
assert.match(
  auditControlProofValidationStep,
  /run:\s*node scripts\/run-pr23-r21-workflow-contract\.mjs validate-audit-control-proof\s*$/mu,
);
assert.doesNotMatch(
  auditControlProofValidationStep,
  /curl|wget|gh\s+api|fetch\(|https?:\/\/|playwright|msedge|run-rc6-2-closed-agent-browser/u,
  "the C10 proof validator must stay read-only and offline",
);
assert.ok(
  lastKnownGoodAuditJob.indexOf("Prove exact read-only RC6.2 browser-gate control lineage")
    < lastKnownGoodAuditJob.indexOf("Validate exact C10 read-only audit control proof")
  && lastKnownGoodAuditJob.indexOf("Validate exact C10 read-only audit control proof")
    < lastKnownGoodAuditJob.indexOf("Discover prior Last Known Good artifact"),
  "the v7 proof must be produced and validated before any LKG discovery or selection",
);
const auditControlProofProducerStart = browserGateContract.indexOf("async function writeAuditControlProof()");
const auditControlProofProducerEnd = browserGateContract.indexOf(
  'if (process.argv[2] === "write-audit-control-proof")',
  auditControlProofProducerStart,
);
assert.ok(auditControlProofProducerStart >= 0 && auditControlProofProducerEnd > auditControlProofProducerStart);
const auditControlProofProducer = browserGateContract.slice(
  auditControlProofProducerStart,
  auditControlProofProducerEnd,
);
assert.equal(
  auditControlProofProducer.split(AUDIT_CONTROL_PROOF_SCHEMA).length - 1,
  2,
  "the C10 producer must use v7 for both the proof body and digest domain",
);
assert.equal(
  auditControlProofProducer.split(HISTORICAL_C9_AUDIT_CONTROL_PROOF_SCHEMA).length - 1,
  0,
  "the C10 producer must not emit or digest its proof as historical v6",
);
assert.match(auditControlProofProducer, /c9BrowserGateControl:\s*C9_BROWSER_GATE_CONTROL/u);
assert.match(auditControlProofProducer, /c8BrowserGateControl:\s*C8_BROWSER_GATE_CONTROL/u);
assert.match(auditControlProofProducer, /parentCommit:\s*C9_BROWSER_GATE_CONTROL/u);
assert.match(auditControlProofProducer, /c9ChangedPaths,/u);
assert.match(auditControlProofProducer, /c8ChangedPaths,/u);
assert.match(
  auditControlProofProducer,
  /proofDigest:\s*createHash\("sha256"\)\.update\(stableStringify\(\{[\s\S]*domain:\s*"p24b-rc6\.2-browser-gate-control-proof-v7",[\s\S]*body,[\s\S]*\}\)\)\.digest\("hex"\)/u,
);
assert.match(lastKnownGoodAuditJob, /production-last-known-good\.mjs discover/u);
assert.match(lastKnownGoodAuditJob, /production-last-known-good\.mjs download/u);
assert.match(
  lastKnownGoodAuditJob,
  /EXPECTED_LKG_PRIMARY_DEPLOYMENT_ID:[^\r\n]*deploy-immutable-product-recovery[^\r\n]*audit-rc6-2-last-known-good[^\r\n]*env\.RC6_2_LKG_PRIMARY_DEPLOYMENT_ID[^\r\n]*\|\| ''/u,
);
assert.match(
  lastKnownGoodAuditJob,
  /EXPECTED_LKG_MIRROR_DEPLOYMENT_ID:[^\r\n]*deploy-immutable-product-recovery[^\r\n]*audit-rc6-2-last-known-good[^\r\n]*env\.RC6_2_LKG_MIRROR_DEPLOYMENT_ID[^\r\n]*\|\| ''/u,
);
assert.doesNotMatch(
  lastKnownGoodAuditJob,
  /env\.EXPECTED_LKG_(?:PRIMARY|MIRROR)_DEPLOYMENT_ID/u,
);
assert.match(lastKnownGoodAuditJob, /Require cryptographic dynamic Last Known Good metadata for normal main push/u);
assert.match(
  lastKnownGoodAuditJob,
  /AUDIT_PRODUCT_COMMIT:[^\r\n]*deploy-immutable-product-recovery[^\r\n]*env\.PRODUCT_COMMIT[^\r\n]*audit-rc6-2-last-known-good[^\r\n]*env\.RECOVERY_PRODUCT_COMMIT[^\r\n]*env\.AUDIT_COMMIT/u,
);
assert.match(
  lastKnownGoodAuditJob,
  /AUDIT_CONTROL_PROOF_DIGEST:[^\r\n]*audit-rc6-2-last-known-good[^\r\n]*steps\.browser_gate_control\.outputs\.proof_digest/u,
);
assert.match(lastKnownGoodAuditJob, /production-last-known-good\.mjs select/u);
assert.match(lastKnownGoodAuditJob, /REQUIRE_AUDIT_SELECTION_PROVENANCE:\s*'true'/u);
assert.match(lastKnownGoodAuditJob, /DISABLE_CURRENT_CAPTURE:\s*'true'/u);
assert.match(
  lastKnownGoodAuditJob,
  /production-lkg-readonly-audit-rc62-\{0\}-\{1\}-\{2\}-\{3\}-\{4\}[\s\S]*steps\.browser_gate_control\.outputs\.proof_digest[\s\S]*steps\.lkg_selection\.outputs\.selection_proof_digest/u,
);
assert.match(lastKnownGoodAuditJob, /production-lkg-readonly-audit-current-\{0\}-\{1\}/u);
assert.match(lastKnownGoodAuditJob, /\$\{\{ runner\.temp \}\}\/rc6-2-browser-gate-control-proof\.json/u);
assert.match(lastKnownGoodAuditJob, /LAST_KNOWN_GOOD_PRODUCT_COMMIT:\s*\$\{\{ steps\.lkg\.outputs\.product_commit \}\}/u);
assert.match(lastKnownGoodAuditJob, /LAST_KNOWN_GOOD_CONTROL_COMMIT:\s*\$\{\{ steps\.lkg\.outputs\.control_commit \}\}/u);
assert.doesNotMatch(lastKnownGoodAuditJob, /deploy-preview|restore-known-stable|--prod|vercel deploy|vercel alias/u);
assert.doesNotMatch(lastKnownGoodAuditJob, /production-environment-governance|vercel-dual-alias-cutover|EMERGENCY_RECOVERY/u);
assert.doesNotMatch(lastKnownGoodAuditJob, /SUPABASE_ACCESS_TOKEN|XAI_API_KEY|OPENAI_API_KEY/u);
assert.doesNotMatch(lastKnownGoodAuditJob, /\n  production_env_audit:/u);

assert.match(productionAuditJob, /needs:\s*\[validate,\s*audit_last_known_good\]/u);
assert.match(productionAuditJob, /inputs\.operation == 'deploy-immutable-product-recovery'/u);
assert.match(productionAuditJob, /production-environment-governance\.mjs audit/u);
assert.match(productionAuditJob, /read-only Production audit tooling/u);
assert.match(productionAuditJob, /production-environment-audit-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_id \}\}/u);
assert.match(productionAuditJob, /overwrite:\s*true/u);
assert.doesNotMatch(productionAuditJob, /inputs\.operation == '(?:deploy-preview|audit-last-known-good|audit-rc6-2-last-known-good|restore-known-stable)'/u);
assert.doesNotMatch(productionAuditJob, /bootstrap-production-|environment-governance\.mjs repair|vercel-dual-alias|env add|vercel alias/u);
assert.doesNotMatch(productionAuditJob, /secrets\.OPENAI_API_KEY/u);

assert.match(repairJob, /needs:\s*\[validate,\s*production_env_audit\]/u);
assert.match(repairJob, /production-environment-governance\.mjs repair/u);
assert.match(repairJob, /PRODUCTION_ENV_REPAIR_RECEIPT_PATH/u);
assert.match(repairJob, /Download exact sanitized Production audit evidence/u);
assert.match(repairJob, /production-environment-audit-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_id \}\}/u);
assert.doesNotMatch(repairJob, /production-environment-audit-[^\n]*github\.run_attempt/u);
assert.match(repairJob, /PRODUCTION_ENV_AUDIT_INPUT_PATH/u);
assert.match(repairJob, /AUDIT_REPAIR_REQUIRED/u);
assert.match(repairJob, /if:\s*needs\.production_env_audit\.outputs\.repair_required == 'true'/u);
assert.match(repairJob, /Record zero-mutation repair receipt/u);
assert.match(repairJob, /if:\s*needs\.production_env_audit\.outputs\.repair_required != 'true'/u);
assert.doesNotMatch(repairJob, /secrets\.OPENAI_API_KEY/u);

assert.match(buildJob, /needs:\s*\[validate,\s*production_env_repair\]/u);
assert.match(buildJob, /vercel build --prod/u);
assert.match(buildJob, /production-prebuilt-/u);
assert.match(buildJob, /verify-vercel-prebuilt-file-references\.mjs/u);
assert.match(buildJob, /tar --create --gzip/u);
assert.match(buildJob, /--file "\$RUNNER_TEMP\/production-prebuilt\.tgz"/u);
assert.match(buildJob, /--exclude='\.next\/cache'/u);
assert.match(buildJob, /\.vercel\/output \.next/u);
assert.match(buildJob, /path:\s*\|[\s\S]*\$\{\{ runner\.temp \}\}\/production-prebuilt\.tgz/u);
assert.match(buildJob, /include-hidden-files:\s*true/u);
assert.match(buildJob, /name:\s*production-prebuilt-\$\{\{ env\.PRODUCT_COMMIT \}\}-control-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_id \}\}/u);
assert.match(buildJob, /overwrite:\s*true/u);
assert.doesNotMatch(buildJob, /production-prebuilt-[^\n]*github\.run_attempt/u);
assert.doesNotMatch(buildJob, /vercel deploy/u);
assert.doesNotMatch(buildJob, /vercel-dual-alias-cutover/u);
assert.match(buildJob, /vercel build --prod[\s\S]*tar --create --gzip[\s\S]*scan-sealed-production-artifact\.mjs[\s\S]*Upload sealed prebuilt Production artifact/u);
assert.match(postBuildSecretScanJob, /needs:\s*production_build/u);
assert.match(postBuildSecretScanJob, /actions\/download-artifact@[a-f0-9]{40}/u);
assert.match(postBuildSecretScanJob, /scan-sealed-production-artifact\.mjs/u);
assert.match(postBuildSecretScanJob, /--expected-digest/u);
assert.match(postBuildSecretScanJob, /--prior-receipt/u);

assert.match(stagedJob, /needs:\s*\[validate,\s*production_build,\s*post_build_secret_scan\]/u);
assert.match(stagedJob, /actions\/download-artifact@[a-f0-9]{40}/u);
assert.match(stagedJob, /vercel deploy --prebuilt --prod --skip-domain/u);
assert.match(stagedJob, /name:\s*production-prebuilt-\$\{\{ env\.PRODUCT_COMMIT \}\}-control-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_id \}\}/u);
assert.match(stagedJob, /--meta "githubCommitSha=\$PRODUCT_COMMIT"/u);
assert.match(stagedJob, /--meta "novelControlCommit=\$CONTROL_COMMIT"/u);
assert.match(stagedJob, /--meta "novelDeploymentAuthority=github-actions"/u);
assert.match(stagedJob, /Prove exact single Vercel Production deployment in the control plane/u);
assert.match(stagedJob, /node \.release-control\/scripts\/run-main-push-auto-deploy-workflow-contract\.mjs verify-vercel-production-authority/u);
assert.match(stagedJob, /PRODUCTION_AUTHORITY_RECEIPT_SCHEMA="p24b-production-deployment-authority-v1"/u);
assert.match(stagedJob, /\.pageCount >= 1 and \.paginationComplete == true/u);
assert.match(stagedJob, /\.rawApiBodyIncluded' "\$receipt_path"\)" = false/u);
assert.match(stagedJob, /Checkout trusted Production control commit for staged-deploy CAS[\s\S]*ref:\s*\$\{\{ github\.sha \}\}[\s\S]*path:\s*\.release-control/u);
const stagedMutationStep = stepSection(stagedJob, "Deploy staged production without alias mutation");
assert.match(stagedMutationStep, /EXPECTED_MAIN_HEAD_COMMIT:\s*\$\{\{ github\.sha \}\}/u);
assert.ok(
  stagedMutationStep.indexOf("node .release-control/scripts/verify-production-main-head-cas.mjs")
    < stagedMutationStep.indexOf("pnpm exec vercel deploy --prebuilt --prod --skip-domain"),
  "the live main Control CAS must execute immediately before the staged Production mutation",
);
assert.doesNotMatch(stagedJob, /production-prebuilt-[^\n]*github\.run_attempt/u);
assert.match(stagedJob, /path:\s*\$\{\{ runner\.temp \}\}\/production-prebuilt/u);
assert.match(stagedJob, /tar --extract --gzip --file "\$archive" --directory "\$GITHUB_WORKSPACE"/u);
assert.match(stagedJob, /test -f \.vercel\/output\/config\.json/u);
assert.match(stagedJob, /Verify sealed artifact after Vercel project pull[\s\S]*verify-vercel-prebuilt-file-references\.mjs/u);
assert.ok(
  stagedJob.indexOf("Verify sealed artifact after Vercel project pull")
    > stagedJob.indexOf("Pull Vercel project identity for staged deployment"),
  "the sealed artifact must be checked again after vercel pull",
);
assert.ok(
  stagedJob.indexOf("Deploy staged production without alias mutation")
    > stagedJob.indexOf("Verify sealed artifact after Vercel project pull"),
  "staged deploy must not start before the post-pull artifact gate",
);
assert.match(stagedJob, /deployment_stdout="\$RUNNER_TEMP\/vercel-staged-deploy\.stdout"/u);
assert.match(stagedJob, /deploy_log="\$RUNNER_TEMP\/vercel-staged-deploy\.stderr\.log"/u);
assert.match(stagedJob, /perl -pe '[^\n]*\$ENV\{"VERCEL_TOKEN"\}[^\n]*\[REDACTED\]/u);
assert.match(stagedJob, /> "\$deployment_stdout"; \} 2>&1/u);
assert.match(stagedJob, /\| tee "\$deploy_log" >&2/u);
assert.match(stagedJob, /pipeline_status=\("\$\{PIPESTATUS\[@\]\}"\)/u);
assert.match(stagedJob, /deploy_status="\$\{pipeline_status\[0\]\}"/u);
assert.match(stagedJob, /exit "\$deploy_status"/u);
assert.ok(stagedJob.includes("deployment_url=\"$(sed -e 's/\\r$//' \"$deployment_stdout\")\""));
assert.ok(stagedJob.includes('[[ ! "$deployment_url" =~ ^https://[[:alnum:]]([[:alnum:]-]{0,61}[[:alnum:]])?[.]vercel[.]app/?$ ]]'));
assert.match(stagedJob, /deployment_url="\$\{deployment_url%\/\}"/u);
assert.doesNotMatch(stagedJob, /output="\$\(pnpm exec vercel deploy/u);
assert.ok(!stagedJob.includes("grep -Eo 'https://[^[:space:]]+'"));
assert.doesNotMatch(stagedJob, /set -x|(?:echo|printf)[^\n]*\$VERCEL_TOKEN/u);
assert.doesNotMatch(stagedJob, /vercel-dual-alias-cutover/u);
assert.doesNotMatch(stagedJob, /PRIMARY_ALIAS|MIRROR_ALIAS/u);

assert.match(runtimeJob, /needs:\s*\[validate,\s*staged_deploy\]/u);
assert.match(runtimeJob, /\/api\/release\/identity/u);
assert.match(runtimeJob, /\/api\/persistence\/sync\/health/u);
assert.match(runtimeJob, /\/api\/ai\/external\/providers/u);
assert.match(runtimeJob, /EXPECTED_RELEASE_REVISION/u);
assert.match(runtimeJob, /release_product_commit/u);
assert.match(runtimeJob, /EXPECTED_APP_COMMIT:\s*\$\{\{ env\.PRODUCT_COMMIT \}\}/u);
assert.match(runtimeJob, /EXPECTED_CONTROL_COMMIT:\s*\$\{\{ github\.sha \}\}/u);
assert.match(runtimeJob, /Checkout trusted Production control commit for runtime proof[\s\S]*ref:\s*\$\{\{ github\.sha \}\}/u);
assert.match(runtimeJob, /Checkout immutable Product commit for runtime timestamp proof[\s\S]*ref:\s*\$\{\{ env\.PRODUCT_COMMIT \}\}[\s\S]*path:\s*\.release-product/u);
assert.match(runtimeJob, /git -C \.release-product show -s --format=%cI "\$PRODUCT_COMMIT"/u);
assert.match(runtimeJob, /cloud_sync_e2ee_storage_001/u);
assert.match(runtimeJob, /private-object-storage/u);
assert.match(runtimeJob, /generated\/manual-learning-worker\.js/u);
assert.match(runtimeJob, /curl --connect-timeout 5 --max-time 20/u);
assert.match(runtimeJob, /LEARNING_FILE_MAGIC_MISMATCH/u);
assert.match(runtimeJob, /splitManualLearningDocumentSemantically/u);
assert.match(runtimeJob, /LEARNING_WORKER_DUPLICATE_REQUEST/u);
assert.match(runtimeJob, /prepare_import_file/u);
assert.match(runtimeJob, /manual-learning-worker-protocol-v2/u);
assert.match(runtimeJob, /EXPECTED_XAI_MODEL_ID:\s*grok-4\.5/u);
assert.match(runtimeJob, /XAI_EXPECTED:\s*\$\{\{ secrets\.XAI_API_KEY != '' \}\}/u);
assert.match(runtimeJob, /grok_verified/u);
assert.match(runtimeJob, /grok_not_configured/u);
assert.match(runtimeJob, /grok_safe/u);
assert.match(runtimeJob, /openai_not_configured/u);
assert.match(runtimeJob, /openai_verified/u);
assert.match(runtimeJob, /top_level_safe/u);
assert.match(runtimeJob, /\.configured == false and \.verification == "not_configured" and \.verificationCode == "NOT_CONFIGURED"/u);
assert.match(runtimeJob, /\.modelId == \$expectedModel/u);
assert.match(runtimeJob, /"\$provider_verification" == "degraded"/u);
assert.match(runtimeJob, /"\$provider_verification" == "verified"/u);
assert.doesNotMatch(runtimeJob, /\.verification == "failed"/u);
assert.doesNotMatch(runtimeJob, /EXTERNAL_PROVIDER_AUTH_FAILED/u);
assert.doesNotMatch(runtimeJob, /grok-4\.5-latest/u);
assert.doesNotMatch(runtimeJob, /vercel-dual-alias-cutover/u);

assert.match(aliasJob, /needs:\s*\[validate,\s*staged_deploy,\s*runtime_gates\]/u);
assert.match(aliasJob, /production-last-known-good\.mjs discover/u);
assert.match(aliasJob, /production-last-known-good\.mjs select/u);
assert.match(aliasJob, /current dual-alias transaction identity/u);
assert.match(aliasJob, /Cut over both aliases with atomic compensation/u);
assert.match(aliasJob, /verify-production-public-cutover\.mjs/u);
assert.match(aliasJob, /Compensating rollback after public verification failure/u);
assert.match(aliasJob, /vercel-dual-alias-cutover\.mjs restore/u);
assert.match(aliasJob, /Write Last Known Good only after public verification passes/u);
assert.match(aliasJob, /production-last-known-good-control-\{0\}-product-\{1\}/u);
assert.match(aliasJob, /APP_COMMIT:\s*\$\{\{ env\.PRODUCT_COMMIT \}\}/u);
assert.match(aliasJob, /Checkout trusted Production control commit[\s\S]*fetch-depth:\s*3/u);
assert.match(aliasJob, /Reproduce and bind recovery control proof for Last Known Good publication[\s\S]*verify-production-recovery-control\.mjs[\s\S]*needs\.validate\.outputs\.recovery_control_proof_digest/u);
assert.match(aliasJob, /Write Last Known Good only after public verification passes[\s\S]*RECOVERY_CONTROL_PROOF_PATH:[^\r\n]*recovery-control-proof-for-lkg\.json[\s\S]*production-last-known-good\.mjs write/u);
assert.match(aliasJob, /p24b-rc6\.5-new-luna-production-control-plane-evidence-v1/u);
assert.match(aliasJob, /productionAuthorizationProofDigest:\$productionAuthorizationProofDigest/u);
assert.match(aliasJob, /recoveryControl:\$recoveryControl/u);
assert.match(aliasJob, /releaseProductCommit:\$releaseProductCommit,controlCommit:\$controlCommit/u);
assert.match(aliasJob, /steps\.public_gate\.outcome == 'success'/u);
assert.match(aliasJob, /IMMUTABLE_RELEASE_REQUIRE_REPOSITORY_SETTING:\s*'false'/u);
assert.match(aliasJob, /verify-github-release-attestation\.mjs/u);
assert.match(aliasJob, /EXPECTED_MAIN_HEAD_COMMIT:\s*\$\{\{ github\.sha \}\}/u);
assert.match(
  lastKnownGoodAuditJob,
  /AUDIT_PRODUCT_COMMIT:[^\r\n]*deploy-immutable-product-recovery[^\r\n]*env\.PRODUCT_COMMIT[^\r\n]*audit-rc6-2-last-known-good[^\r\n]*env\.RECOVERY_PRODUCT_COMMIT[^\r\n]*env\.AUDIT_COMMIT/u,
);
assert.match(lastKnownGoodAuditJob, /AUDIT_CONTROL_PROOF_DIGEST:[^\r\n]*needs\.validate\.outputs\.recovery_control_proof_digest/u);
const postCutoverFinalizationMatrix = [
  {
    name: "Upload post-cutover verification evidence",
    id: "post_cutover_evidence",
    successfulOutcomes: ["cutover"],
  },
  {
    name: "Write Last Known Good only after public verification passes",
    id: "last_known_good_write",
    successfulOutcomes: [
      "cutover",
      "public_gate",
      "immutable_tag_final",
      "main_head_final",
      "post_cutover_evidence",
    ],
  },
  {
    name: "Publish dynamic Last Known Good identity",
    id: "last_known_good_publish",
    successfulOutcomes: [
      "cutover",
      "public_gate",
      "immutable_tag_final",
      "main_head_final",
      "post_cutover_evidence",
      "last_known_good_write",
    ],
  },
  {
    name: "Create sanitized post-Production new-LUNA control-plane evidence",
    id: "new_luna_create",
    successfulOutcomes: [
      "cutover",
      "public_gate",
      "immutable_tag_final",
      "main_head_final",
      "post_cutover_evidence",
      "last_known_good_write",
      "last_known_good_publish",
    ],
  },
  {
    name: "Publish sanitized post-Production new-LUNA control-plane evidence",
    id: "new_luna_publish",
    successfulOutcomes: [
      "cutover",
      "public_gate",
      "immutable_tag_final",
      "main_head_final",
      "post_cutover_evidence",
      "last_known_good_write",
      "last_known_good_publish",
      "new_luna_create",
    ],
  },
  {
    name: "Recheck main head after LKG and LUNA evidence publication",
    id: "main_head_completion",
    successfulOutcomes: [
      "cutover",
      "public_gate",
      "immutable_tag_final",
      "main_head_final",
    ],
  },
];
const finalizationFailureOutcomes = postCutoverFinalizationMatrix.map((entry) => entry.id);
function assertPostCutoverFinalizationContract(job) {
  let priorFinalizationStepIndex = -1;
  for (const entry of postCutoverFinalizationMatrix) {
    const block = stepSection(job, entry.name);
    const index = job.indexOf(`      - name: ${entry.name}`);
    assert.ok(index > priorFinalizationStepIndex, `${entry.id} must remain in reconciliation order`);
    priorFinalizationStepIndex = index;
    assert.match(block, new RegExp(`^        id: ${entry.id}$`, "mu"));
    assert.match(block, /^        continue-on-error: true$/mu);
    assert.match(block, /^        if: (?:>-\r?\n\s+)?always\(\)/mu);
    assert.deepEqual(
      successfulStepOutcomes(block),
      entry.successfulOutcomes,
      `${entry.id} must retain its exact success dependency matrix`,
    );
  }
  assert.match(
    stepSection(job, "Upload post-cutover verification evidence"),
    /^          if-no-files-found: error$/mu,
  );
  for (const name of [
    "Compensating rollback after post-cutover finalization failure",
    "Fail after post-cutover finalization reconciliation",
  ]) {
    const block = stepSection(job, name);
    assert.match(block, /^        if: >-\r?$/mu);
    assert.match(block, /always\(\)/u);
    assert.deepEqual(
      failedStepOutcomes(block),
      finalizationFailureOutcomes,
      `${name} must fail closed for every post-cutover finalization outcome`,
    );
  }
  const finalizationRollback = stepSection(
    job,
    "Compensating rollback after post-cutover finalization failure",
  );
  assert.match(finalizationRollback, /^        id: finalization_rollback$/mu);
  assert.match(finalizationRollback, /^        continue-on-error: true$/mu);
  assert.match(finalizationRollback, /vercel-dual-alias-cutover\.mjs restore/u);
  assert.match(
    stepSection(job, "Fail after post-cutover finalization reconciliation"),
    /exit 1/u,
  );
}
assertPostCutoverFinalizationContract(aliasJob);

for (const entry of postCutoverFinalizationMatrix) {
  const block = stepSection(aliasJob, entry.name);
  const mutation = block.replace("continue-on-error: true", "continue-on-error: false");
  assert.notEqual(mutation, block);
  assert.throws(
    () => assertPostCutoverFinalizationContract(aliasJob.replace(block, mutation)),
    undefined,
    `${entry.id} continue-on-error mutation must be rejected`,
  );
}
for (const failureStepName of [
  "Compensating rollback after post-cutover finalization failure",
  "Fail after post-cutover finalization reconciliation",
]) {
  const block = stepSection(aliasJob, failureStepName);
  for (const id of finalizationFailureOutcomes) {
    const mutation = block.replace(
      `steps.${id}.outcome != 'success'`,
      `steps.${id}.outcome == 'success'`,
    );
    assert.notEqual(mutation, block);
    assert.throws(
      () => assertPostCutoverFinalizationContract(aliasJob.replace(block, mutation)),
      undefined,
      `${failureStepName} ${id} failure mutation must be rejected`,
    );
  }
}
for (const entry of postCutoverFinalizationMatrix.filter(({ successfulOutcomes }) =>
  successfulOutcomes.length > 1)) {
  const block = stepSection(aliasJob, entry.name);
  const prerequisite = entry.successfulOutcomes.at(-1);
  const mutation = block.replace(
    `steps.${prerequisite}.outcome == 'success'`,
    `steps.${prerequisite}.outcome != 'success'`,
  );
  assert.notEqual(mutation, block);
  assert.throws(
    () => assertPostCutoverFinalizationContract(aliasJob.replace(block, mutation)),
    undefined,
    `${entry.id} prerequisite mutation must be rejected`,
  );
}
for (const budget of [
  "VERCEL_FETCH_TIMEOUT_MS: 10000",
  "ALIAS_CAPTURE_DEADLINE_MS: 60000",
  "ROLLBACK_TARGET_SELECTION_DEADLINE_MS: 60000",
  "CUTOVER_DEADLINE_MS: 360000",
  "CUTOVER_ROLLBACK_RESERVE_MS: 180000",
  "POST_CUTOVER_DEADLINE_MS: 180000",
  "PUBLIC_GATE_FETCH_TIMEOUT_MS: 10000",
  "ROLLBACK_DEADLINE_MS: 240000",
]) assert.ok(aliasJob.includes(budget), `alias cutover deadline budget missing: ${budget}`);
assert.match(aliasJob, /production-last-known-good\.mjs download/u);
assert.match(aliasJob, /actions\/download-artifact@[a-f0-9]{40}/u);
assert.match(aliasJob, /production-deployment-authority-\$\{\{ env\.PRODUCT_COMMIT \}\}-control-\$\{\{ env\.CONTROL_COMMIT \}\}/u);
assert.match(aliasJob, /Recheck exact single Vercel Production deployment immediately before cutover/u);
assert.match(aliasJob, /node scripts\/run-main-push-auto-deploy-workflow-contract\.mjs verify-vercel-production-authority/u);
assert.match(aliasJob, /PRODUCTION_AUTHORITY_RECEIPT_SCHEMA="p24b-production-deployment-authority-recheck-v1"/u);
assert.match(aliasJob, /\.pageCount >= 1 and \.paginationComplete == true/u);
assert.match(aliasJob, /timeout-minutes:\s*45/u);
assert.match(aliasJob, /timeout --signal=TERM --kill-after=30s 900s bash -c/u);
assert.match(aliasRollbackGuardJob, /needs:\s*\[alias_cutover\]/u);
assert.match(aliasRollbackGuardJob, /needs\.alias_cutover\.result == 'failure'/u);
assert.match(aliasRollbackGuardJob, /needs\.alias_cutover\.result == 'cancelled'/u);
assert.match(aliasRollbackGuardJob, /production-last-known-good\.mjs discover/u);
assert.match(aliasRollbackGuardJob, /production-last-known-good\.mjs download/u);
assert.match(aliasRollbackGuardJob, /production-last-known-good\.mjs select/u);
assert.match(aliasRollbackGuardJob, /vercel-dual-alias-cutover\.mjs restore/u);

assert.match(restoreJob, /inputs\.operation == 'restore-known-stable' && github\.ref == 'refs\/heads\/main'/u);
assert.doesNotMatch(restoreJob, /github\.event_name == 'push'|deploy-preview|audit-last-known-good/u);
assert.doesNotMatch(restoreJob, /^    needs:/mu);
assert.match(restoreJob, /production-last-known-good\.mjs discover/u);
assert.match(restoreJob, /production-last-known-good\.mjs select/u);
assert.match(restoreJob, /DISABLE_CURRENT_CAPTURE:\s*'true'/u);
assert.match(restoreJob, /EMERGENCY_RECOVERY_DEPLOYMENT_ID/u);
assert.match(restoreJob, /production-last-known-good\.mjs download/u);
assert.doesNotMatch(restoreJob, /actions\/download-artifact/u);
assert.match(restoreJob, /ROLLBACK_TARGET_SELECTION_DEADLINE_MS:\s*60000/u);
assert.match(restoreJob, /ROLLBACK_DEADLINE_MS:\s*240000/u);
assert.match(restoreJob, /Checkout[\s\S]*ref:\s*\$\{\{ github\.sha \}\}[\s\S]*Enforce exact restore control checkout[\s\S]*GITHUB_WORKFLOW_SHA/u);
const restoreMutationStep = stepSection(restoreJob, "Restore and verify both production aliases");
assert.match(restoreMutationStep, /EXPECTED_MAIN_HEAD_COMMIT:\s*\$\{\{ github\.sha \}\}/u);
assert.ok(
  restoreMutationStep.indexOf("node scripts/verify-production-main-head-cas.mjs")
    < restoreMutationStep.indexOf("node scripts/vercel-dual-alias-cutover.mjs restore"),
  "restore must recheck live main Control immediately before alias mutation",
);

for (const [name, productionJob] of [
  ["production_env_audit", productionAuditJob],
  ["production_env_repair", repairJob],
  ["production_build", buildJob],
  ["post_build_secret_scan", postBuildSecretScanJob],
  ["staged_deploy", stagedJob],
  ["runtime_gates", runtimeJob],
  ["alias_cutover", aliasJob],
]) {
  assert.match(
    productionJob,
    /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main' && github\.sha == '9cd074f239b73dd9b61f6d758fcf97fbd809face' && inputs\.operation == 'deploy-immutable-product-recovery'/u,
    `${name} must support only the exact main recovery dispatch in addition to the immutable Product push`,
  );
  assert.match(
    productionJob,
    /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/u,
    `${name} must admit the exact main push SHA`,
  );
  assert.doesNotMatch(productionJob, /vars\.RC6_4_PRODUCT_COMMIT/u, `${name} must not retain a stale SHA gate`);
  assert.doesNotMatch(
    productionJob,
    /inputs\.operation == '(?:deploy-preview|audit-last-known-good|audit-rc6-2-last-known-good|restore-known-stable)'/u,
    `${name} must not be reachable from any non-recovery workflow_dispatch operation`,
  );
}

assert.match(recoveryCompleteJob, /needs:[\s\S]*validate[\s\S]*alias_cutover/u);
assert.match(recoveryCompleteJob, /if:\s*always\(\)[^\r\n]*deploy-immutable-product-recovery/u);
assert.doesNotMatch(recoveryCompleteJob, /VERCEL_TOKEN|vercel-dual-alias-cutover|production-last-known-good\.mjs|upload-artifact|verify-production-main-head-cas/u);
for (const result of [
  "VALIDATE_RESULT",
  "LKG_AUDIT_RESULT",
  "ENV_AUDIT_RESULT",
  "ENV_REPAIR_RESULT",
  "BUILD_RESULT",
  "POST_BUILD_SCAN_RESULT",
  "STAGED_DEPLOY_RESULT",
  "RUNTIME_GATES_RESULT",
  "ALIAS_CUTOVER_RESULT",
]) assert.match(recoveryCompleteJob, new RegExp(`\\$${result}`, "u"));

assert.match(mainPushCompleteJob, /if:\s*always\(\) && github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/u);
assert.match(mainPushCompleteJob, /skipped_count=0[\s\S]*test "\$skipped_count" = 0/u);
assert.match(mainPushCompleteJob, /test "\$PRODUCTION_DEPLOYMENT_AUTHORITY" = github-actions/u);
assert.match(mainPushCompleteJob, /test "\$DUPLICATE_PRODUCTION_DEPLOY_COUNT" = 0/u);

for (const publicRuntimeJob of [previewJob, runtimeJob]) {
  assert.match(publicRuntimeJob, /curl --connect-timeout 5 --max-time 10/u);
  assert.match(publicRuntimeJob, /for attempt in \{1\.\.15\}/u);
}

const requiredCommands = [
  "pnpm install --frozen-lockfile",
  "pnpm test:ci:rc6-release-hardening",
  "pnpm test:ai:p24b:all",
  "pnpm test:ai:closed:unified-os",
  "pnpm test:ai:closed:web-operability",
  "pnpm test:ai:closed:optimization",
  "pnpm test:ai:external:modes",
  "pnpm test:ai:external:request-guard",
  "pnpm test:ai:closed:super-agent-rpg",
  "pnpm test:ai:closed:cache-runtime",
  "pnpm test:ai:closed:controlled-learning-runtime",
  "pnpm test:ai:closed-ai-runtime-r2",
  "pnpm test:p12",
  "pnpm test:ai:p15:consumer-platform",
  "pnpm test:ai:p21:three-high",
  "pnpm test:ai:indexeddb-blocked-byte-preservation",
  "pnpm test:ai:indexeddb-blocked-ui-write-gate",
  "pnpm test:ai:daily-backup-marker-after-success",
  "pnpm test:ai:quick-assistant-canonical-approval",
  "pnpm test:ai:actual-executor-truth",
  "pnpm test:ai:legacy-health-cannot-claim-closed-runtime",
  "pnpm test:ci:dual-alias-rollback",
  "pnpm test:ci:workflow-contract",
  "pnpm test:ci:rc6-1-deployment-governance",
  "pnpm test:ai:browser:setup-state-machine-rc6.4",
  "pnpm test:ai:browser:setup-runtime-rc6.4",
  "pnpm test:ai:browser:setup-diagnostics-rc6.4",
  "pnpm test:ai:browser:prose-candidate-v2-rc6.5",
  "pnpm test:ai:browser:prose-candidate-v2-runtime-rc6.5",
  "pnpm test:ci:release-revision",
  "pnpm test:ci:release-tag-commit-traceability",
  "pnpm test:ci:artifact-attestation",
  "pnpm test:ci:build-provenance",
  "pnpm test:ci:signature-vs-provenance-truth",
  "pnpm test:studio:conversation-component-contract",
  "pnpm test:studio:conversation-first-browser",
  "pnpm test:studio:conversation-rpg",
  "pnpm test:studio:conversation-lazy-tools",
  "pnpm test:studio:conversation-long-session",
  "pnpm test:studio:conversation-scroll-restoration",
  "pnpm test:studio:writing-flow",
  "pnpm test:ai:manual-learning-worker-asset",
  "pnpm test:ai:attachment-worker-cancellation",
  "pnpm test:ai:attachment-worker-memory-release",
  "pnpm test:ai:attachment-late-result-rejected",
  "pnpm test:ai:p24b:secret-scan",
  "pnpm test:ci:companion-zip-content",
  "pnpm test:ci:evidence-schema",
  "pnpm test:ci:production-supabase-bootstrap",
  "pnpm test:ci:production-external-ai-bootstrap",
  "pnpm build:manual-learning-worker",
  "node scripts/generate-release-provenance.mjs",
  "pnpm exec tsc --noEmit",
  "pnpm lint:ci",
];
for (const command of requiredCommands) {
  assert.ok(validateJob.includes(command), `validate is missing: ${command}`);
}
assert.ok(
  validateJob.indexOf("pnpm build:manual-learning-worker")
    < validateJob.indexOf("pnpm test:studio:conversation-first-browser"),
  "the clean validation runner must generate the isolated Worker before browser gates",
);
assert.ok(
  validateJob.indexOf("node scripts/generate-release-provenance.mjs")
    < validateJob.indexOf("pnpm test:studio:conversation-first-contract"),
  "the clean validation runner must seal exact-SHA provenance before release consumers load",
);
assert.doesNotMatch(validateJob, /pnpm build(?:\s|$)|conversation-bundle-budget/u);
const formalBuildIndex = buildJob.indexOf("vercel build --prod");
const productionBundleGateIndex = buildJob.indexOf("pnpm test:studio:conversation-bundle-budget");
assert.ok(formalBuildIndex >= 0, "production_build must run the formal production build");
assert.ok(
  productionBundleGateIndex > formalBuildIndex,
  "the Conversation production bundle gate must read fresh .next output after the formal production build",
);

const allowedActionPins = new Set([
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  "actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131",
]);
const uses = [...workflow.matchAll(/uses:\s*([^\s]+)/gu)].map((match) => match[1]);
assert.ok(uses.length >= 8);
assert.ok(uses.every((value) => /@[a-f0-9]{40}$/u.test(value)));
assert.ok(uses.every((value) => allowedActionPins.has(value)));
assert.match(workflow, /corepack prepare pnpm@10\.34\.5 --activate/u);
assert.doesNotMatch(workflow, /npm install --global/u);
assert.doesNotMatch(workflow, /(?<!pnpm exec )vercel (?:pull|build|deploy)/u);

for (const marker of [
  "api.vercel.com/v13/deployments",
  "githubCommitSha",
  "VERCEL_CONTROL_PLANE_IDENTITY_INVALID",
  "capture-primary",
  "capture-mirror",
  "rollback-primary",
  "rollback-mirror",
  "verify-rollback-primary",
  "verify-rollback-mirror",
  "DUAL_ALIAS_ROLLBACK_FAILED",
  "api.vercel.com/v2/deployments",
]) assert.ok(rollback.includes(marker), `rollback implementation missing ${marker}`);
assert.doesNotMatch(rollback, /spawnSync/u);
assert.doesNotMatch(rollback, /--token/u);

for (const scriptName of ["test:ai:release-identity-alias", "test:ai:closed-ai-runtime-r2"]) {
  assert.match(
    packageScripts[scriptName],
    /^node scripts\/generate-release-provenance\.mjs && /u,
    `${scriptName} must bootstrap provenance in a clean checkout`,
  );
}
const rc62BrowserPreflightContractScripts = {
  "test:rc6.2:browser-preflight-runtime-receipt": "test-preflight-runtime-receipt",
  "test:rc6.2:browser-preflight-receipt-missing": "test-preflight-receipt-missing",
  "test:rc6.2:browser-preflight-receipt-digest": "test-preflight-receipt-digest",
  "test:rc6.2:browser-preflight-receipt-schema": "test-preflight-receipt-schema",
  "test:rc6.2:browser-preflight-receipt-ordering": "test-preflight-receipt-ordering",
  "test:rc6.2:browser-preflight-failure-evidence": "test-preflight-failure-evidence",
};
for (const [scriptName, mode] of Object.entries(rc62BrowserPreflightContractScripts)) {
  const command = packageScripts[scriptName];
  assert.equal(
    command,
    `node scripts/run-rc6-2-production-browser-gate-contract.mjs ${mode}`,
    `${scriptName} must remain an exact local contract-only invocation`,
  );
  assert.doesNotMatch(
    command,
    /run-rc6-2-production-browser-gate\.ps1|run-rc6-2-closed-agent-browser\.mjs|playwright|msedge|powershell|pwsh|\bgeneration\b/u,
    `${scriptName} must not start the Production Browser wrapper, Browser runner, Edge, Playwright, or generation`,
  );
}
assert.equal(
  new Set(Object.values(rc62BrowserPreflightContractScripts)).size,
  Object.keys(rc62BrowserPreflightContractScripts).length,
  "every RC6.2 browser preflight contract test must use a distinct dry-run-only mode",
);
const rc62FormalAttemptScripts = {
  "test:rc6.2:formal-attempt-state": "node scripts/run-rc6-2-formal-attempt-state-tests.mjs all",
  "test:rc6.2:formal-terminal-evidence": "node scripts/run-rc6-2-terminal-evidence-tests.mjs all",
  "test:rc6.2:formal-negative-mutations": "node scripts/run-rc6-2-terminal-evidence-tests.mjs mutations",
  "test:rc6.2:formal-simulations": "node scripts/run-rc6-2-terminal-evidence-tests.mjs simulations",
  "test:rc6.2:runner-envelope": "node scripts/run-rc6-2-runner-envelope-tests.mjs all",
  "test:rc6.2:runner-envelope-child-process": "node scripts/run-rc6-2-runner-envelope-tests.mjs child-process",
  "test:rc6.2:runner-envelope-mutations": "node scripts/run-rc6-2-runner-envelope-tests.mjs mutations",
};
for (const [scriptName, expectedCommand] of Object.entries(rc62FormalAttemptScripts)) {
  const command = packageScripts[scriptName];
  assert.equal(command, expectedCommand, `${scriptName} must remain an exact stub-only invocation`);
  assert.doesNotMatch(
    command,
    /run-rc6-2-production-browser-gate[.]ps1|run-rc6-2-closed-agent-browser[.]mjs|playwright|msedge|powershell|pwsh|chromium|webllm/u,
    `${scriptName} must not start the Production Browser wrapper, runner, Edge, Playwright, or WebLLM`,
  );
}
const rc62NetworkSentinelStaticScripts = {
  "test:rc6.2:network-sentinel-unit": "unit",
  "test:rc6.2:network-sentinel-mutations": "mutations",
};
for (const [scriptName, mode] of Object.entries(rc62NetworkSentinelStaticScripts)) {
  const command = packageScripts[scriptName];
  assert.equal(
    command,
    `node scripts/run-rc6-2-network-sentinel-tests.mjs ${mode}`,
    `${scriptName} must remain an exact no-Browser sentinel-test invocation`,
  );
  assert.doesNotMatch(
    command,
    /run-rc6-2-production-browser-gate[.]ps1|run-rc6-2-closed-agent-browser[.]mjs|playwright|msedge|powershell|pwsh|chromium|webllm|network-sentinel-only/u,
    `${scriptName} must not start the wrapper, Browser runner, Edge, Playwright, or WebLLM`,
  );
}
assert.equal(
  packageScripts["test:rc6.2:task-owned-edge-policy"],
  "node scripts/run-rc6-2-production-browser-gate-contract.mjs test-task-owned-edge-policy",
  "task-owned Edge filesystem policy must remain an explicit no-Browser contract mode",
);
assert.equal(
  packageScripts["test:rc6.2:task-owned-edge-toolchain"],
  "node scripts/run-rc6-2-production-browser-gate-contract.mjs task-owned-edge-toolchain-receipt",
  "task-owned Edge receipt must remain an explicit no-Browser contract mode",
);
assert.equal(
  packageScripts["test:rc6.2:network-sentinel-real-edge"],
  "node scripts/run-rc6-2-closed-agent-browser.mjs network-sentinel-only",
  "the historical direct real-Edge sentinel mode must remain source-compatible and must not be used by C10",
);
assert.equal(
  packageScripts["test:rc6.2:task-owned-edge-network-sentinel"],
  "node scripts/run-rc6-2-production-browser-gate-contract.mjs task-owned-edge-network-sentinel",
  "C10 real-Edge validation must use the receipt-sealed task-owned launcher",
);
assert.equal(
  new Set(Object.values(rc62NetworkSentinelStaticScripts)).size,
  Object.keys(rc62NetworkSentinelStaticScripts).length,
  "C10 sentinel unit and mutation tests must use distinct no-Browser modes",
);
assert.match(p21ThreeHigh, /process\.platform === "win32"/u);
assert.match(p21ThreeHigh, /: execFileSync\("pnpm", args/u);
assert.match(p21ThreeHigh, /process\.platform === "win32" \? "powershell\.exe" : "pwsh"/u);
assert.match(p21ThreeHigh, /fileURLToPath\(prePath\)/u);

const contractMode = process.argv[2] ?? "contract";
assert.ok(
  contractMode === "contract" || contractMode === "validate-audit-control-proof",
  `unsupported workflow-contract mode: ${contractMode}`,
);
if (contractMode === "validate-audit-control-proof") {
  const proofPath = String(process.env.BROWSER_GATE_CONTROL_PROOF_PATH ?? "").trim();
  assert.ok(proofPath, "BROWSER_GATE_CONTROL_PROOF_PATH is required for read-only proof validation");
  const proof = JSON.parse(await readFile(proofPath, "utf8"));
  validateAuditControlProof(proof, "generated C10 audit control proof");
}

console.log(JSON.stringify({
  schemaVersion: "pr23-r2-1-github-validate-contract-v2",
  status: "PASS",
  productionGateOrder: [
    "validate",
    "last-known-good-audit",
    "production-env-audit",
    "production-env-repair",
    "production-build",
    "post-build-secret-scan",
    "staged-deploy",
    "runtime-gates",
    "alias-cutover",
  ],
  exactWorkflowJobOrder: jobNames,
  lastKnownGoodAuditReadOnly: true,
  entrypointIsolation: true,
  auditConcurrencyIsolated: true,
  productionAuditReadOnly: true,
  productionMainSerializedWithoutCancellation: true,
  trustedPreviewPolicy: true,
  dynamicLastKnownGood: true,
  postCutoverCompensation: true,
  immutableActionUseCount: uses.length,
}, null, 2));

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [workflow, rollback, packageText, p21ThreeHigh] = await Promise.all([
  readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"),
  readFile(new URL("./vercel-dual-alias-cutover.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("./run-p21-three-high-closure.mjs", import.meta.url), "utf8"),
]);
const packageScripts = JSON.parse(packageText).scripts;

const jobsIndex = workflow.indexOf("\njobs:");
const validateIndex = workflow.indexOf("\n  validate:");
const previewIndex = workflow.indexOf("\n  preview:");
const productionBootstrapIndex = workflow.indexOf("\n  production_env_bootstrap:");
const restoreIndex = workflow.indexOf("\n  restore_known_stable:");
const deployIndex = workflow.indexOf("\n  deploy:");
assert.ok(
  jobsIndex > 0
  && validateIndex > jobsIndex
  && previewIndex > validateIndex
  && productionBootstrapIndex > previewIndex
  && restoreIndex > productionBootstrapIndex
  && deployIndex > restoreIndex,
);
const globalConfiguration = workflow.slice(0, jobsIndex);
const validateJob = workflow.slice(validateIndex, previewIndex);
const previewJob = workflow.slice(previewIndex, productionBootstrapIndex);
const productionBootstrapJob = workflow.slice(productionBootstrapIndex, restoreIndex);
const restoreJob = workflow.slice(restoreIndex, deployIndex);
const deployJob = workflow.slice(deployIndex);

for (const secret of [
  "VERCEL_TOKEN",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID",
  "SUPABASE_SERVICE_ROLE_KEY",
  "XAI_API_KEY",
]) {
  assert.doesNotMatch(
    globalConfiguration,
    new RegExp(`\\b${secret}\\b`, "u"),
    `${secret} must not be global`,
  );
  assert.doesNotMatch(
    validateJob,
    new RegExp(`\\b${secret}\\b`, "u"),
    `${secret} must not be available to validate`,
  );
}

assert.match(previewJob, /\n    needs:\s*validate\s*$/mu);
assert.match(
  previewJob,
  /\n    if:\s*github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.repo\.full_name == github\.repository\s*$/mu,
);
for (const secret of [
  "VERCEL_TOKEN",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID",
]) {
  assert.match(previewJob, new RegExp(`${secret}:\\s*\\$\\{\\{ secrets\\.`, "u"));
}
assert.match(previewJob, /ref:\s*\$\{\{ github\.event\.pull_request\.head\.sha \}\}/u);
assert.match(previewJob, /VERCEL_GIT_COMMIT_SHA:\s*\$\{\{ github\.event\.pull_request\.head\.sha \}\}/u);
assert.match(previewJob, /environment=preview/u);
assert.match(previewJob, /vercel deploy --prebuilt/u);
assert.match(previewJob, /\/api\/release\/identity/u);
assert.doesNotMatch(previewJob, /--prod/u);
assert.doesNotMatch(previewJob, /vercel\s+alias/u);
assert.doesNotMatch(previewJob, /PRIMARY_ALIAS|MIRROR_ALIAS/u);
assert.doesNotMatch(previewJob, /SUPABASE_ACCESS_TOKEN/u);

assert.doesNotMatch(productionBootstrapJob, /\n    needs:/u);
assert.match(
  productionBootstrapJob,
  /\n    if:\s*github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'\s*$/mu,
);
assert.match(productionBootstrapJob, /bootstrap-production-supabase-env\.mjs/u);
assert.match(productionBootstrapJob, /VERCEL_TOKEN:\s*\$\{\{ secrets\./u);
assert.match(productionBootstrapJob, /SUPABASE_ACCESS_TOKEN:\s*\$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/u);
assert.match(productionBootstrapJob, /SUPABASE_PROJECT_REF_FALLBACK:\s*iwobncchxuykcztziavw/u);
assert.match(productionBootstrapJob, /XAI_API_KEY:\s*\$\{\{ secrets\.XAI_API_KEY \}\}/u);
assert.match(productionBootstrapJob, /XAI_MODEL_ID:\s*grok-4\.5/u);
assert.match(productionBootstrapJob, /bootstrap-production-external-ai-env\.mjs/u);
assert.doesNotMatch(productionBootstrapJob, /pull_request/u);

assert.match(
  restoreJob,
  /if:\s*github\.event_name == 'workflow_dispatch' && inputs\.operation == 'restore-known-stable'/u,
);
assert.match(restoreJob, /vercel-dual-alias-cutover\.mjs restore/u);
assert.match(restoreJob, /RECOVERY_DEPLOYMENT_ID/u);
assert.match(restoreJob, /RECOVERY_COMMIT/u);

assert.match(deployJob, /\n    needs:\s*\[validate,\s*production_env_bootstrap\]\s*$/mu);
assert.match(
  deployJob,
  /\n    if:\s*github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'\s*$/mu,
);
assert.doesNotMatch(deployJob, /environment=preview/u);
assert.doesNotMatch(deployJob, /Deploy \(preview\)/u);
for (const secret of [
  "VERCEL_TOKEN",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID",
]) {
  assert.match(deployJob, new RegExp(`${secret}:\\s*\\$\\{\\{ secrets\\.`, "u"));
}
assert.doesNotMatch(deployJob, /SUPABASE_ACCESS_TOKEN/u);
assert.match(deployJob, /provision-cloud-sync-storage\.mjs --env-file \.vercel\/\.env\.production\.local --required/u);
assert.match(deployJob, /cloud_sync_e2ee_storage_001/u);
assert.match(deployJob, /private-object-storage/u);

const requiredCommands = [
  "pnpm install --frozen-lockfile",
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
  "pnpm test:ai:p24b:secret-scan",
  "pnpm test:ci:companion-zip-content",
  "pnpm test:ci:evidence-schema",
  "pnpm test:ci:production-supabase-bootstrap",
  "pnpm test:ci:production-external-ai-bootstrap",
  "pnpm exec tsc --noEmit",
  "pnpm lint",
  "pnpm build",
];
for (const command of requiredCommands) {
  assert.ok(validateJob.includes(command), `validate is missing: ${command}`);
}

const uses = [...workflow.matchAll(/uses:\s*([^\s]+)/gu)]
  .map((match) => match[1]);
assert.ok(uses.length >= 4);
assert.ok(uses.every((value) => /@[a-f0-9]{40}$/u.test(value)));
assert.ok(uses.every((value) =>
  value === "actions/checkout@11d5960a326750d5838078e36cf38b85af677262"
  || value === "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020"));

assert.match(deployJob, /\/api\/release\/identity/u);
assert.doesNotMatch(deployJob, /\/api\/ai\/health/u);
assert.match(deployJob, /PRIMARY_BEFORE_DEPLOYMENT/u);
assert.match(deployJob, /MIRROR_BEFORE_DEPLOYMENT/u);
assert.match(deployJob, /vercel-dual-alias-cutover\.mjs/u);
assert.match(
  deployJob,
  /node scripts\/vercel-dual-alias-cutover\.mjs capture/u,
);
assert.match(deployJob, /continue-on-error:\s*true/u);
assert.match(deployJob, /staged_health/u);
assert.match(deployJob, /staged_teachers/u);
assert.match(deployJob, /\/api\/ai\/external\/providers/u);
assert.match(deployJob, /probe=1&providers=openai,grok/u);
assert.match(deployJob, /server-side-only/u);
assert.match(deployJob, /MODEL_ACCESS_VERIFIED/u);
assert.match(deployJob, /\.verification == "verified"/u);
assert.match(deployJob, /grok-4\.5/u);
assert.match(deployJob, /Restore aliases after staged gate rejection/u);
assert.match(deployJob, /vercel-dual-alias-cutover\.mjs restore/u);
assert.match(deployJob, /Fail after compensated staged gate rejection/u);
assert.match(rollback, /api\.vercel\.com\/v13\/deployments/u);
assert.match(rollback, /githubCommitSha/u);
assert.match(rollback, /VERCEL_CONTROL_PLANE_IDENTITY_INVALID/u);
assert.match(rollback, /vercel_control_plane_legacy_bootstrap/u);
assert.match(rollback, /LEGACY_CONTROL_PLANE_BASELINE_MISMATCH/u);
assert.match(rollback, /capture-primary/u);
assert.match(rollback, /capture-mirror/u);
assert.match(rollback, /rollback-primary/u);
assert.match(rollback, /rollback-mirror/u);
assert.match(rollback, /verify-rollback-primary/u);
assert.match(rollback, /verify-rollback-mirror/u);
assert.match(rollback, /LEGACY_CONTROL_PLANE_FALLBACK_NOT_ALLOWED/u);
assert.match(rollback, /DUAL_ALIAS_ROLLBACK_FAILED/u);
assert.doesNotMatch(rollback, /\/api\/ai\/health/u);
assert.match(rollback, /api\.vercel\.com\/v2\/deployments/u);
assert.doesNotMatch(rollback, /spawnSync/u);
assert.doesNotMatch(rollback, /--token/u);
assert.match(
  globalConfiguration,
  /LEGACY_BOOTSTRAP_DEPLOYMENT_ID:\s*dpl_8vdPA2mFkDJUezr5Rfn5MuxqJuBa/u,
);
assert.match(
  globalConfiguration,
  /LEGACY_BOOTSTRAP_COMMIT:\s*d0e80323dc68bf08cb541e46c6b9114a71e05cd9/u,
);
for (const scriptName of [
  "test:ai:release-identity-alias",
  "test:ai:closed-ai-runtime-r2",
]) {
  assert.match(
    packageScripts[scriptName],
    /^node scripts\/generate-release-provenance\.mjs && /u,
    `${scriptName} must bootstrap provenance in a clean checkout`,
  );
}
assert.match(p21ThreeHigh, /process\.platform === "win32"/u);
assert.match(p21ThreeHigh, /: execFileSync\("pnpm", args/u);
assert.match(
  p21ThreeHigh,
  /process\.platform === "win32" \? "powershell\.exe" : "pwsh"/u,
);
assert.match(p21ThreeHigh, /fileURLToPath\(prePath\)/u);

console.log(JSON.stringify({
  schemaVersion: "pr23-r2-1-github-validate-contract-v1",
  status: "PASS",
  jobs: ["validate", "preview", "production_env_bootstrap", "deploy"],
  deployNeedsValidate: true,
  deployTrustedPushOnly: true,
  trustedPullRequestPreviewDeploy: true,
  pullRequestProductionDeploy: false,
  validateSecretCount: 0,
  requiredCommandCount: requiredCommands.length,
  immutableActionUseCount: uses.length,
  releaseIdentityRequiredForNewDeploymentVerification: true,
  legacy404ControlPlaneBootstrap: true,
  legacyBootstrapCaptureAndRollbackOnly: true,
  legacyBootstrapFrozenToKnownBaseline: true,
  cleanCheckoutProvenanceBootstrap: true,
  crossPlatformP21Validation: true,
  centralDualAliasRollback: true,
  stagedGateFailureCompensation: true,
  manualKnownStableRestore: true,
}, null, 2));

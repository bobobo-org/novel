import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [workflow, rollback] = await Promise.all([
  readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"),
  readFile(new URL("./vercel-dual-alias-cutover.mjs", import.meta.url), "utf8"),
]);

const jobsIndex = workflow.indexOf("\njobs:");
const validateIndex = workflow.indexOf("\n  validate:");
const deployIndex = workflow.indexOf("\n  deploy:");
assert.ok(jobsIndex > 0 && validateIndex > jobsIndex && deployIndex > validateIndex);
const globalConfiguration = workflow.slice(0, jobsIndex);
const validateJob = workflow.slice(validateIndex, deployIndex);
const deployJob = workflow.slice(deployIndex);

for (const secret of [
  "VERCEL_TOKEN",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID",
  "SUPABASE_SERVICE_ROLE_KEY",
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

assert.match(deployJob, /\n    needs:\s*validate\s*$/mu);
for (const secret of [
  "VERCEL_TOKEN",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID",
]) {
  assert.match(deployJob, new RegExp(`${secret}:\\s*\\$\\{\\{ secrets\\.`, "u"));
}

const requiredCommands = [
  "pnpm install --frozen-lockfile",
  "pnpm test:ai:p24b:all",
  "pnpm test:ai:closed:unified-os",
  "pnpm test:ai:closed:web-operability",
  "pnpm test:ai:closed:optimization",
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
assert.match(
  globalConfiguration,
  /LEGACY_BOOTSTRAP_DEPLOYMENT_ID:\s*dpl_8vdPA2mFkDJUezr5Rfn5MuxqJuBa/u,
);
assert.match(
  globalConfiguration,
  /LEGACY_BOOTSTRAP_COMMIT:\s*d0e80323dc68bf08cb541e46c6b9114a71e05cd9/u,
);

console.log(JSON.stringify({
  schemaVersion: "pr23-r2-1-github-validate-contract-v1",
  status: "PASS",
  jobs: ["validate", "deploy"],
  deployNeedsValidate: true,
  validateSecretCount: 0,
  requiredCommandCount: requiredCommands.length,
  immutableActionUseCount: uses.length,
  releaseIdentityRequiredForNewDeploymentVerification: true,
  legacy404ControlPlaneBootstrap: true,
  legacyBootstrapCaptureAndRollbackOnly: true,
  legacyBootstrapFrozenToKnownBaseline: true,
  centralDualAliasRollback: true,
}, null, 2));

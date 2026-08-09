import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [workflow, rollback, packageText, p21ThreeHigh, vercelConfigurationText] = await Promise.all([
  readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"),
  readFile(new URL("./vercel-dual-alias-cutover.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("./run-p21-three-high-closure.mjs", import.meta.url), "utf8"),
  readFile(new URL("../vercel.json", import.meta.url), "utf8"),
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
  "production_env_audit",
  "production_env_repair",
  "restore_known_stable",
  "production_build",
  "staged_deploy",
  "runtime_gates",
  "alias_cutover",
];
const indexes = Object.fromEntries(jobNames.map((name) => [name, workflow.indexOf(`\n  ${name}:`)]));
assert.ok(workflow.indexOf("\njobs:") > 0);
for (const name of jobNames) assert.ok(indexes[name] > 0, `missing workflow job ${name}`);
for (const [left, right] of [
  ["validate", "preview"],
  ["preview", "production_env_audit"],
  ["production_env_audit", "production_env_repair"],
  ["production_env_repair", "production_build"],
  ["production_build", "staged_deploy"],
  ["staged_deploy", "runtime_gates"],
  ["runtime_gates", "alias_cutover"],
]) assert.ok(indexes[left] < indexes[right], `${left} must precede ${right}`);

function section(name) {
  const start = indexes[name];
  const next = Object.values(indexes).filter((index) => index > start).sort((a, b) => a - b)[0];
  return workflow.slice(start, next || workflow.length);
}

const globalConfiguration = workflow.slice(0, workflow.indexOf("\njobs:"));
const validateJob = section("validate");
const previewJob = section("preview");
const auditJob = section("production_env_audit");
const repairJob = section("production_env_repair");
const buildJob = section("production_build");
const stagedJob = section("staged_deploy");
const runtimeJob = section("runtime_gates");
const aliasJob = section("alias_cutover");
const restoreJob = section("restore_known_stable");

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
  /VERCEL_GIT_COMMIT_SHA:\s*\$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.sha \|\| github\.event_name == 'workflow_dispatch' && inputs\.preview_ref \|\| github\.sha \}\}/u,
);
assert.match(validateJob, /repository:\s*\$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.repo\.full_name \|\| github\.repository \}\}/u);
assert.match(validateJob, /ref:\s*\$\{\{ env\.VERCEL_GIT_COMMIT_SHA \}\}/u);
assert.match(validateJob, /--arg headSha "\$VERCEL_GIT_COMMIT_SHA"/u);
assert.match(validateJob, /p24b-rc6-validation-\$\{\{ env\.VERCEL_GIT_COMMIT_SHA \}\}/u);

assert.match(globalConfiguration, /push:[\s\S]*branches:[\s\S]*- main/u);
assert.doesNotMatch(globalConfiguration, /agent\/p24b-rc6-conversation-first/u);
assert.match(globalConfiguration, /preview_ref:/u);
assert.match(globalConfiguration, /deploy-preview/u);
assert.match(globalConfiguration, /group:[^\n]*vercel-production-main/u);
assert.match(globalConfiguration, /cancel-in-progress:[^\n]*!\(\(/u);

assert.match(previewJob, /needs:\s*validate/u);
assert.match(previewJob, /head\.repo\.full_name == github\.repository/u);
assert.match(previewJob, /inputs\.operation == 'deploy-preview'/u);
assert.match(previewJob, /\^\[a-f0-9\]\{40\}\$/u);
assert.match(previewJob, /git rev-parse HEAD/u);
assert.match(previewJob, /ref:\s*\$\{\{ env\.VERCEL_GIT_COMMIT_SHA \}\}/u);
assert.match(previewJob, /environment=preview/u);
assert.match(previewJob, /vercel deploy --prebuilt/u);
assert.match(previewJob, /\/api\/release\/identity/u);
assert.doesNotMatch(previewJob, /--prod/u);
assert.doesNotMatch(previewJob, /PRIMARY_ALIAS|MIRROR_ALIAS/u);
assert.doesNotMatch(previewJob, /SUPABASE_ACCESS_TOKEN/u);

assert.match(auditJob, /needs:\s*validate/u);
assert.match(auditJob, /production-environment-governance\.mjs audit/u);
assert.match(auditJob, /read-only Production audit tooling/u);
assert.doesNotMatch(auditJob, /bootstrap-production-|environment-governance\.mjs repair|vercel-dual-alias|env add|vercel alias/u);

assert.match(repairJob, /needs:\s*\[validate,\s*production_env_audit\]/u);
assert.match(repairJob, /production-environment-governance\.mjs repair/u);
assert.match(repairJob, /PRODUCTION_ENV_REPAIR_RECEIPT_PATH/u);
assert.match(repairJob, /AUDIT_REPAIR_REQUIRED/u);
assert.match(repairJob, /if:\s*needs\.production_env_audit\.outputs\.repair_required == 'true'/u);
assert.match(repairJob, /Record zero-mutation repair receipt/u);
assert.match(repairJob, /if:\s*needs\.production_env_audit\.outputs\.repair_required != 'true'/u);

assert.match(buildJob, /needs:\s*production_env_repair/u);
assert.match(buildJob, /vercel build --prod/u);
assert.match(buildJob, /production-prebuilt-/u);
assert.match(buildJob, /path:\s*\.vercel\/output/u);
assert.match(buildJob, /include-hidden-files:\s*true/u);
assert.doesNotMatch(buildJob, /vercel deploy/u);
assert.doesNotMatch(buildJob, /vercel-dual-alias-cutover/u);

assert.match(stagedJob, /needs:\s*production_build/u);
assert.match(stagedJob, /actions\/download-artifact@[a-f0-9]{40}/u);
assert.match(stagedJob, /vercel deploy --prebuilt --prod --skip-domain/u);
assert.match(stagedJob, /test -f \.vercel\/output\/config\.json/u);
assert.doesNotMatch(stagedJob, /vercel-dual-alias-cutover/u);
assert.doesNotMatch(stagedJob, /PRIMARY_ALIAS|MIRROR_ALIAS/u);

assert.match(runtimeJob, /needs:\s*staged_deploy/u);
assert.match(runtimeJob, /\/api\/release\/identity/u);
assert.match(runtimeJob, /\/api\/persistence\/sync\/health/u);
assert.match(runtimeJob, /\/api\/ai\/external\/providers/u);
assert.match(runtimeJob, /EXPECTED_RELEASE_REVISION/u);
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
assert.match(runtimeJob, /grok_verified/u);
assert.match(runtimeJob, /openai_not_configured/u);
assert.match(runtimeJob, /openai_verified/u);
assert.match(runtimeJob, /top_level_safe/u);
assert.match(runtimeJob, /\.modelId == \$expectedModel/u);
assert.match(runtimeJob, /"\$provider_verification" == "degraded"/u);
assert.match(runtimeJob, /"\$provider_verification" == "verified"/u);
assert.doesNotMatch(runtimeJob, /\.verification == "failed"/u);
assert.doesNotMatch(runtimeJob, /grok-4\.5-latest/u);
assert.doesNotMatch(runtimeJob, /vercel-dual-alias-cutover/u);

assert.match(aliasJob, /needs:\s*\[staged_deploy,\s*runtime_gates\]/u);
assert.match(aliasJob, /production-last-known-good\.mjs discover/u);
assert.match(aliasJob, /production-last-known-good\.mjs select/u);
assert.match(aliasJob, /current dual-alias transaction identity/u);
assert.match(aliasJob, /Cut over both aliases with atomic compensation/u);
assert.match(aliasJob, /verify-production-public-cutover\.mjs/u);
assert.match(aliasJob, /Compensating rollback after public verification failure/u);
assert.match(aliasJob, /vercel-dual-alias-cutover\.mjs restore/u);
assert.match(aliasJob, /Write Last Known Good only after public verification passes/u);
assert.match(aliasJob, /production-last-known-good-\$\{\{ github\.sha \}\}/u);
assert.match(aliasJob, /steps\.public_gate\.outcome == 'success'/u);
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
assert.match(aliasJob, /Download latest Last Known Good identity[\s\S]*continue-on-error:\s*true/u);
assert.match(aliasJob, /timeout-minutes:\s*20/u);

assert.match(restoreJob, /inputs\.operation == 'restore-known-stable' && github\.ref == 'refs\/heads\/main'/u);
assert.match(restoreJob, /production-last-known-good\.mjs discover/u);
assert.match(restoreJob, /production-last-known-good\.mjs select/u);
assert.match(restoreJob, /DISABLE_CURRENT_CAPTURE:\s*'true'/u);
assert.match(restoreJob, /EMERGENCY_RECOVERY_DEPLOYMENT_ID/u);
assert.match(restoreJob, /Download latest Last Known Good identity[\s\S]*continue-on-error:\s*true/u);
assert.match(restoreJob, /ROLLBACK_TARGET_SELECTION_DEADLINE_MS:\s*60000/u);
assert.match(restoreJob, /ROLLBACK_DEADLINE_MS:\s*240000/u);

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
  "pnpm test:ci:release-revision",
  "pnpm test:ci:release-tag-commit-traceability",
  "pnpm test:ci:artifact-attestation",
  "pnpm test:ci:build-provenance",
  "pnpm test:ci:signature-vs-provenance-truth",
  "pnpm test:studio:conversation-component-contract",
  "pnpm test:studio:conversation-lazy-tools",
  "pnpm test:studio:conversation-long-session",
  "pnpm test:studio:conversation-scroll-restoration",
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
assert.match(p21ThreeHigh, /process\.platform === "win32"/u);
assert.match(p21ThreeHigh, /: execFileSync\("pnpm", args/u);
assert.match(p21ThreeHigh, /process\.platform === "win32" \? "powershell\.exe" : "pwsh"/u);
assert.match(p21ThreeHigh, /fileURLToPath\(prePath\)/u);

console.log(JSON.stringify({
  schemaVersion: "pr23-r2-1-github-validate-contract-v2",
  status: "PASS",
  productionGateOrder: [
    "validate",
    "production-env-audit",
    "production-env-repair",
    "build",
    "staged-deploy",
    "runtime-gates",
    "alias-cutover",
  ],
  productionAuditReadOnly: true,
  productionMainSerializedWithoutCancellation: true,
  trustedPreviewPolicy: true,
  dynamicLastKnownGood: true,
  postCutoverCompensation: true,
  immutableActionUseCount: uses.length,
}, null, 2));

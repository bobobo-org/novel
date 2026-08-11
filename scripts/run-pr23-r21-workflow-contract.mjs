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
  "audit_last_known_good",
  "production_env_audit",
  "production_env_repair",
  "restore_known_stable",
  "production_build",
  "post_build_secret_scan",
  "staged_deploy",
  "runtime_gates",
  "alias_cutover",
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
const lastKnownGoodAuditJob = section("audit_last_known_good");
const productionAuditJob = section("production_env_audit");
const repairJob = section("production_env_repair");
const buildJob = section("production_build");
const postBuildSecretScanJob = section("post_build_secret_scan");
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
assert.ok(globalConfiguration.includes(
  "group: ${{ (((github.event_name == 'push' && github.ref == 'refs/heads/main') || (github.event_name == 'workflow_dispatch' && inputs.operation == 'restore-known-stable')) && 'vercel-production-main') || ((github.event_name == 'workflow_dispatch' && inputs.operation == 'audit-last-known-good') && format('vercel-lkg-audit-{0}', inputs.preview_ref || github.sha)) || format('vercel-preview-{0}', github.event.pull_request.number || inputs.preview_ref || github.ref) }}",
), "Production, read-only audit, and Preview runs must use distinct concurrency routing");
assert.ok(globalConfiguration.includes(
  "cancel-in-progress: ${{ !((github.event_name == 'push' && github.ref == 'refs/heads/main') || (github.event_name == 'workflow_dispatch' && (inputs.operation == 'restore-known-stable' || inputs.operation == 'audit-last-known-good'))) }}",
), "Production, restore, and read-only audit runs must never be cancelled in progress");

assert.match(previewJob, /needs:\s*validate/u);
assert.match(previewJob, /head\.repo\.full_name == github\.repository/u);
assert.match(previewJob, /inputs\.operation == 'deploy-preview'/u);
assert.doesNotMatch(previewJob, /github\.event_name == 'push'|audit-last-known-good|restore-known-stable/u);
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

assert.match(
  lastKnownGoodAuditJob,
  /if:\s*>-\s*always\(\) &&\s*\(\(github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' && needs\.validate\.result == 'success'\) \|\|\s*\(github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main' && inputs\.operation == 'audit-last-known-good'\)\)/u,
);
assert.match(lastKnownGoodAuditJob, /^    needs:\s*validate$/mu);
assert.match(
  lastKnownGoodAuditJob,
  /AUDIT_COMMIT:\s*\$\{\{ github\.event_name == 'push' && github\.sha \|\| inputs\.preview_ref \}\}/u,
);
assert.match(lastKnownGoodAuditJob, /EXPECTED_EVENT_COMMIT:\s*\$\{\{ github\.sha \}\}/u);
assert.match(lastKnownGoodAuditJob, /\[\[ "\$AUDIT_COMMIT" =~ \^\[a-f0-9\]\{40\}\$ \]\]/u);
assert.match(lastKnownGoodAuditJob, /\[\[ "\$AUDIT_COMMIT" == "\$EXPECTED_EVENT_COMMIT" \]\]/u);
assert.match(lastKnownGoodAuditJob, /ref:\s*\$\{\{ github\.sha \}\}/u);
assert.match(lastKnownGoodAuditJob, /persist-credentials:\s*false/u);
assert.match(lastKnownGoodAuditJob, /\[\[ "\$\(git rev-parse HEAD\)" == "\$AUDIT_COMMIT" \]\]/u);
assert.match(lastKnownGoodAuditJob, /production-last-known-good\.mjs discover/u);
assert.match(lastKnownGoodAuditJob, /production-last-known-good\.mjs download/u);
assert.match(lastKnownGoodAuditJob, /production-last-known-good\.mjs select/u);
assert.match(lastKnownGoodAuditJob, /REQUIRE_AUDIT_SELECTION_PROVENANCE:\s*'true'/u);
assert.match(lastKnownGoodAuditJob, /DISABLE_CURRENT_CAPTURE:\s*'true'/u);
assert.match(lastKnownGoodAuditJob, /production-lkg-readonly-audit-\$\{\{ env\.AUDIT_COMMIT \}\}-\$\{\{ github\.run_id \}\}/u);
assert.doesNotMatch(lastKnownGoodAuditJob, /deploy-preview|restore-known-stable|--prod|vercel deploy|vercel alias/u);
assert.doesNotMatch(lastKnownGoodAuditJob, /production-environment-governance|vercel-dual-alias-cutover|EMERGENCY_RECOVERY/u);
assert.doesNotMatch(lastKnownGoodAuditJob, /SUPABASE_ACCESS_TOKEN|XAI_API_KEY|OPENAI_API_KEY/u);
assert.doesNotMatch(lastKnownGoodAuditJob, /\n  production_env_audit:/u);

assert.match(productionAuditJob, /needs:\s*\[validate,\s*audit_last_known_good\]/u);
assert.match(productionAuditJob, /if:\s*github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/u);
assert.match(productionAuditJob, /production-environment-governance\.mjs audit/u);
assert.match(productionAuditJob, /read-only Production audit tooling/u);
assert.match(productionAuditJob, /production-environment-audit-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_id \}\}/u);
assert.match(productionAuditJob, /overwrite:\s*true/u);
assert.doesNotMatch(productionAuditJob, /workflow_dispatch|deploy-preview|audit-last-known-good|restore-known-stable/u);
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

assert.match(buildJob, /needs:\s*production_env_repair/u);
assert.match(buildJob, /vercel build --prod/u);
assert.match(buildJob, /production-prebuilt-/u);
assert.match(buildJob, /verify-vercel-prebuilt-file-references\.mjs/u);
assert.match(buildJob, /tar --create --gzip/u);
assert.match(buildJob, /--file "\$RUNNER_TEMP\/production-prebuilt\.tgz"/u);
assert.match(buildJob, /--exclude='\.next\/cache'/u);
assert.match(buildJob, /\.vercel\/output \.next/u);
assert.match(buildJob, /path:\s*\|[\s\S]*\$\{\{ runner\.temp \}\}\/production-prebuilt\.tgz/u);
assert.match(buildJob, /include-hidden-files:\s*true/u);
assert.match(buildJob, /name:\s*production-prebuilt-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_id \}\}/u);
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

assert.match(stagedJob, /needs:\s*\[production_build, post_build_secret_scan\]/u);
assert.match(stagedJob, /actions\/download-artifact@[a-f0-9]{40}/u);
assert.match(stagedJob, /vercel deploy --prebuilt --prod --skip-domain/u);
assert.match(stagedJob, /name:\s*production-prebuilt-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_id \}\}/u);
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
assert.doesNotMatch(aliasJob, /actions\/download-artifact/u);
assert.match(aliasJob, /timeout-minutes:\s*20/u);

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
    /if:\s*github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/u,
    `${name} must remain exclusive to a main push`,
  );
  assert.doesNotMatch(
    productionJob,
    /inputs\.operation == '(?:deploy-preview|audit-last-known-good|restore-known-stable)'/u,
    `${name} must not be reachable from a workflow_dispatch operation`,
  );
}

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
assert.match(p21ThreeHigh, /process\.platform === "win32"/u);
assert.match(p21ThreeHigh, /: execFileSync\("pnpm", args/u);
assert.match(p21ThreeHigh, /process\.platform === "win32" \? "powershell\.exe" : "pwsh"/u);
assert.match(p21ThreeHigh, /fileURLToPath\(prePath\)/u);

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

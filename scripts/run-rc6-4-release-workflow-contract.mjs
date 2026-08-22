import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  createRc64ProductionAuthorization,
  RC6_4_NORMAL_PRODUCTION_AUTHORIZATION,
  RC6_4_RECOVERY_PRODUCTION_AUTHORIZATION,
  validateRc64ProductionAuthorization,
} from "./rc6-4-production-authorization.mjs";

const RC6_4_PRODUCT_PLACEHOLDER = "0000000000000000000000000000000000000000";
const RC6_2_RECOVERY_PRODUCT = "29fc6e742672bb07187765d34ea818afdadf56ae";
const RC6_2_RECOVERY_CONTROL = "9cd074f239b73dd9b61f6d758fcf97fbd809face";
const FROZEN_RC6_4_STATIC_PRODUCER_SHA256 =
  "7e24102b9e42dffbb46999456148418ee0ff9a42384eba374f8361e1e9317159";
const FROZEN_RC6_4_PRODUCTION_STATIC_PRODUCER_SHA256 =
  "a5cb76a6a37468c3241c32bcf2e9efd85e7ce3ec4971b67c3f963f5b6a169473";
const RC6_2_LAST_KNOWN_GOOD = Object.freeze({
  appCommit: RC6_2_RECOVERY_PRODUCT,
  deploymentId: "dpl_8pqTpwAgQQAqmLKNzZNCzSfPuqNn",
  releaseTag: "novel-ai-p24b-conversation-first-studio-rc6.2",
  releaseRevision: "rc6.2",
  artifactId: "9114871493",
  artifactName: `production-last-known-good-control-${RC6_2_RECOVERY_CONTROL}-product-${RC6_2_RECOVERY_PRODUCT}`,
  artifactDigest: "sha256:b08153dd5ae5b908a1b972799746a1a2621cb2a33bf90025853fa1688f941a5b",
  runId: "31524952520",
});
const ACTIVE_RELEASE = Object.freeze({
  releaseLine: "novel-ai-p24b-conversation-first-studio-rc6",
  releaseTag: "novel-ai-p24b-conversation-first-studio-rc6.5",
  releaseRevision: "rc6.5",
  releaseName: "P2.4B Conversation-First Novel Project GPT RC6.5",
  consumerRelease: "p2.4b-conversation-first-studio-rc6.5",
  architectureStage: "P2.4B RC",
});
const PRODUCTION_JOBS = Object.freeze([
  "validate",
  "audit_last_known_good",
  "production_env_audit",
  "production_env_repair",
  "production_build",
  "post_build_secret_scan",
  "staged_deploy",
  "runtime_gates",
  "alias_cutover",
]);

function job(workflow, name) {
  const marker = new RegExp(`^  ${name}:\\r?\\n`, "mu").exec(workflow);
  assert.ok(marker, `missing workflow job ${name}`);
  const bodyStart = marker.index + marker[0].length;
  const tail = workflow.slice(bodyStart);
  const next = /^  [a-zA-Z0-9_]+:\r?$/mu.exec(tail);
  return next ? tail.slice(0, next.index) : tail;
}

function step(jobSource, name) {
  const marker = new RegExp(`^      - name: ${name}\\r?\\n`, "mu").exec(jobSource);
  assert.ok(marker, `missing workflow step ${name}`);
  const bodyStart = marker.index + marker[0].length;
  const tail = jobSource.slice(bodyStart);
  const next = /^      - name: /mu.exec(tail);
  return next ? tail.slice(0, next.index) : tail;
}

function verifyWorkflow(workflow) {
  assert.doesNotMatch(workflow, /vars\.RC6_4_PRODUCT_COMMIT|vars\.RC6_4_RELEASE_DATABASE_ID/u);
  assert.match(workflow, /^  PRODUCT_COMMIT:[^\r\n]*deploy-immutable-product-recovery[^\r\n]*github\.sha\s*\}\}$/mu);
  assert.match(workflow, /^  CONTROL_COMMIT: \$\{\{ github\.sha \}\}$/mu);
  assert.match(workflow, /^  VERCEL_GIT_COMMIT_SHA:[^\r\n]*deploy-immutable-product-recovery[^\r\n]*github\.sha\s*\}\}$/mu);
  assert.match(workflow, new RegExp(`RECOVERY_PRODUCT_COMMIT:\\s*${RC6_2_RECOVERY_PRODUCT}`, "u"));
  assert.match(workflow, new RegExp(`RC6_2_RECOVERY_EXACT_CONTROL_COMMIT:\\s*${RC6_2_RECOVERY_CONTROL}`, "u"));
  assert.doesNotMatch(workflow, /^  EXPECTED_RELEASE_(?:LINE|TAG|REVISION|NAME|DATABASE_ID):/mu);

  const preview = job(workflow, "preview");
  assert.match(preview, /NEXT_PUBLIC_RC6_4_BROWSER_PROSE_DIAGNOSTICS:\s*'1'/u);
  assert.match(preview, /generate-rc6-4-static-asset-manifest\.mjs generate/u);
  assert.match(preview, /generate-rc6-4-static-asset-manifest\.mjs validate/u);
  assert.match(preview, /run-rc6-4-browser-prose-diagnostic-bridge\.mjs/u);
  assert.match(preview, /verify-rc6-4-production-diagnostics-seam\.mjs preview \.vercel\/output\/static/u);
  assert.match(
    preview,
    /RC6_4_STATIC_ASSET_MANIFEST_PATH:\s*\$\{\{ github\.workspace \}\}\/\.vercel\/rc6\.4-preview-static-assets\.json/u,
  );
  assert.match(
    preview,
    /RC6_4_STATIC_ASSET_SIDECAR_PATH:\s*\$\{\{ github\.workspace \}\}\/\.vercel\/rc6\.4-preview-static-assets\.sha256/u,
  );
  assert.match(preview, /identity_probe="\$\(cat \/proc\/sys\/kernel\/random\/uuid\)"/u);
  assert.match(preview, /rc6_4_prose_diagnostics=\$identity_probe/u);
  assert.match(preview, /\^\[a-f0-9\]\{8\}-\[a-f0-9\]\{4\}-4/u);
  assert.doesNotMatch(preview, /\?verify=/u);

  const historicalRecoveryHold = job(workflow, "historical_rc6_2_recovery_hold");
  assert.match(historicalRecoveryHold, /github\.event_name == 'workflow_dispatch'/u);
  assert.match(historicalRecoveryHold, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(historicalRecoveryHold, /inputs\.operation == 'deploy-immutable-product-recovery'/u);
  assert.match(historicalRecoveryHold, new RegExp(`github\\.sha != '${RC6_2_RECOVERY_CONTROL}'`, "u"));
  assert.match(historicalRecoveryHold, /HOLD: RC6\.2 recovery is preserved only as read-only prior provenance/u);
  assert.match(historicalRecoveryHold, /exit 1/u);
  assert.doesNotMatch(historicalRecoveryHold, /actions\/checkout|vercel|curl|wget|gh\s+api/u);

  const build = job(workflow, "production_build");
  assert.match(build, /NEXT_PUBLIC_RC6_4_BROWSER_PROSE_DIAGNOSTICS:\s*'0'/u);
  assert.match(build, /verify-rc6-4-production-diagnostics-seam\.mjs source/u);
  assert.match(build, /verify-rc6-4-production-diagnostics-seam\.mjs sealed \.vercel\/output\/static \.next\/static/u);
  assert.match(build, /rc6-4-production-diagnostics-seam\.json/u);

  for (const name of PRODUCTION_JOBS) {
    const source = job(workflow, name);
    assert.match(source, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/u, `${name} normal release gate`);
    assert.doesNotMatch(source, /vars\.RC6_4_PRODUCT_COMMIT/u, `${name} stale normal release gate`);
    assert.match(source, /deploy-immutable-product-recovery/u, `${name} recovery gate`);
  }
  const validate = job(workflow, "validate");
  assert.match(validate, /Authorize exact normal main Product from event SHA/u);
  assert.match(validate, /test "\$PRODUCT_COMMIT" = "\$GITHUB_SHA"/u);
  assert.match(validate, /test "\$CONTROL_COMMIT" = "\$GITHUB_SHA"/u);
  assert.match(validate, /Authorize exact peeled immutable recovery Product/u);
  assert.match(validate, /peeled_commit/u);
  assert.match(validate, /test "\$peeled_commit" = "\$PRODUCT_COMMIT"/u);
  assert.match(validate, /Validate and export Product-owned release identity/u);
  assert.match(validate, /verifyReleaseProvenance\(provenance\)/u);
  assert.match(validate, /Bind recovery GitHub Release database identity from immutable tag proof/u);
  assert.doesNotMatch(validate, /^      release_database_id:/mu);
  assert.match(validate, new RegExp(`github\\.sha == '${RC6_2_RECOVERY_CONTROL}'`, "u"));
  const browserCandidateGates = step(
    validate,
    "Verify RC6.4 release workflow and diagnostics isolation contracts",
  );
  assert.match(
    browserCandidateGates,
    /github\.event_name != 'workflow_dispatch' \|\| inputs\.operation != 'deploy-immutable-product-recovery'/u,
  );
  for (const command of [
    "pnpm test:ai:browser:setup-state-machine-rc6.4",
    "pnpm test:ai:browser:setup-runtime-rc6.4",
    "pnpm test:ai:browser:setup-diagnostics-rc6.4",
    "pnpm test:ai:browser:prose-candidate-v2-rc6.5",
    "pnpm test:ai:browser:prose-candidate-v2-runtime-rc6.5",
  ]) assert.ok(browserCandidateGates.includes(command), `${command} must run outside recovery`);

  const runtime = job(workflow, "runtime_gates");
  assert.match(runtime, /identity_url="\$STAGED_URL\/api\/release\/identity"/u);
  assert.doesNotMatch(runtime, /identity_url=[^\r\n]*\?/u);

  const staged = job(workflow, "staged_deploy");
  assert.match(staged, /^      deployment_id:\s*\$\{\{ steps\.production_static_identity\.outputs\.deployment_id \}\}/mu);
  assert.match(staged, /^      production_static_manifest_digest:\s*\$\{\{ steps\.production_static_manifest\.outputs\.manifest_digest \}\}/mu);
  assert.match(staged, /^      production_static_manifest_file_digest:\s*\$\{\{ steps\.production_static_manifest\.outputs\.manifest_file_digest \}\}/mu);
  assert.match(staged, /^      production_static_asset_domain_digest:\s*\$\{\{ steps\.production_static_manifest\.outputs\.asset_domain_digest \}\}/mu);
  assert.match(staged, /^      production_static_artifact_id:\s*\$\{\{ steps\.production_static_upload\.outputs\.artifact-id \}\}/mu);
  assert.match(staged, /^      production_static_artifact_digest:\s*\$\{\{ steps\.production_static_upload\.outputs\.artifact-digest \}\}/mu);
  const deployIndex = staged.indexOf("- name: Deploy staged production without alias mutation");
  const identityIndex = staged.indexOf("- name: Verify exact staged Product identity before control-plane sealing");
  const sealIndex = staged.indexOf("- name: Atomically seal exact RC6.4 Production static network manifest");
  const uploadIndex = staged.indexOf("- name: Upload exact RC6.4 Production static network evidence");
  assert.ok(deployIndex >= 0 && deployIndex < identityIndex
    && identityIndex < sealIndex && sealIndex < uploadIndex);
  assert.match(staged, /identity_url="\$STAGED_URL\/api\/release\/identity"/u);
  assert.doesNotMatch(staged, /identity_url=[^\r\n]*\?/u);
  for (const field of [
    "app_commit", "release_product_commit", "deployment_id", "provenance_status",
    "environment", "release_line", "release_tag", "release_revision", "release_name",
    "consumer_release", "architecture_stage",
  ]) assert.match(staged, new RegExp(`${field}=`, "u"));
  assert.match(staged, /RC6_4_PRODUCTION_STATIC_ASSET_ROOT:\s*\$\{\{ runner\.temp \}\}\/rc6-4-production-static-source\/\.vercel\/output\/static/u);
  assert.match(staged, /RC6_4_PRODUCTION_ORIGIN:\s*https:\/\/novel-orcin\.vercel\.app/u);
  assert.match(staged, /NEXT_PUBLIC_RC6_4_BROWSER_PROSE_DIAGNOSTICS:\s*'0'/u);
  assert.match(staged, /generate-rc6-4-production-static-network-manifest\.mjs generate/u);
  assert.match(staged, /generate-rc6-4-production-static-network-manifest\.mjs validate/u);
  assert.match(staged, /rc6\.4-production-static-network-manifest\.json/u);
  assert.match(staged, /rc6\.4-production-static-network-manifest\.sha256/u);
  assert.match(staged, /diagnostics_receipt="\$RUNNER_TEMP\/production-prebuilt\/rc6-4-production-diagnostics-seam\.json"/u);
  assert.match(staged, /\.productCommit[^\r\n]*diagnostics_receipt[\s\S]*\.releaseTag[^\r\n]*diagnostics_receipt[\s\S]*\.diagnosticsFlag[^\r\n]*diagnostics_receipt[\s\S]*\.markerHits[^\r\n]*diagnostics_receipt/u);
  assert.match(staged, /sha256sum "\$archive"[\s\S]*needs\.production_build\.outputs\.archive_sha256[\s\S]*tar --extract --gzip --file "\$archive" --directory "\$sealed_source" \.vercel\/output\/static/u);
  assert.match(staged, /test ! -e "\$evidence_directory"/u);
  assert.match(staged, /name:\s*rc6-4-production-static-network-\$\{\{ env\.PRODUCT_COMMIT \}\}-\$\{\{ steps\.production_static_identity\.outputs\.deployment_id \}\}-\$\{\{ github\.run_id \}\}/u);
  assert.match(staged, /Prove exact single Vercel Production deployment in the control plane/u);
  assert.match(staged, /node \.release-control\/scripts\/run-main-push-auto-deploy-workflow-contract\.mjs verify-vercel-production-authority/u);
  assert.match(staged, /PRODUCTION_AUTHORITY_RECEIPT_SCHEMA="p24b-production-deployment-authority-v1"/u);
  assert.match(staged, /\.pageCount >= 1 and \.paginationComplete == true/u);
  assert.match(staged, /\.duplicateProductionDeploymentCount' "\$receipt_path"\)" = 0/u);
  assert.match(job(workflow, "validate"),
    /generate-rc6-4-production-static-network-manifest\.mjs self-test/u);

  const alias = job(workflow, "alias_cutover");
  assert.match(alias, /p24b-rc6\.5-new-luna-production-control-plane-evidence-v1/u);
  assert.match(alias, /production_authorization_mode=github-actions-main-sha/u);
  assert.match(alias, /production_authorization_mode=immutable-product-recovery-control/u);
  assert.match(alias, /production_authorization_proof_digest="\$production_authority_proof_digest"/u);
  assert.match(alias, /production_authorization_proof_digest="\$recovery_control_proof_digest"/u);
  assert.match(alias, /immutable_tag_proof_digest_json=null/u);
  assert.match(alias, /release_attestation_proof_digest_json=null/u);
  assert.match(alias, /repository_immutable_release_setting_verification=not_required_for_normal_main/u);
  assert.doesNotMatch(alias, /production_authorization_mode=immutable-release-attestation/u);
  assert.match(alias, /recovery_control_json=null/u);
  assert.match(alias, /recoveryControl:\$recoveryControl/u);
  assert.match(alias, /productionAuthorizationProofDigest:\$productionAuthorizationProofDigest/u);
  assert.match(alias, /productionStaticNetwork:\$productionStaticNetwork/u);
  assert.match(alias, /production_static_network_json=null/u);
  assert.match(alias, /needs\.staged_deploy\.outputs\.deployment_id[^\r\n]*needs\.runtime_gates\.outputs\.deployment_id/u);
  assert.match(alias, /p24b-rc6\.4-formal-production-static-network-manifest-v1/u);
  assert.match(alias, /p24b-rc6\.4-formal-production-static-network-assets-v1/u);
  for (const field of [
    "production_static_manifest_digest",
    "production_static_manifest_file_digest",
    "production_static_asset_domain_digest",
    "production_static_artifact_id",
    "production_static_artifact_digest",
  ]) assert.match(alias, new RegExp(`${field}=`, "u"));
  assert.match(alias, /RECOVERY_CONTROL_PROOF_PATH:[^\r\n]*deploy-immutable-product-recovery/u);
  assert.match(alias, /Recheck exact single Vercel Production deployment immediately before cutover/u);
  assert.match(alias, /node scripts\/run-main-push-auto-deploy-workflow-contract\.mjs verify-vercel-production-authority/u);
  assert.match(alias, /PRODUCTION_AUTHORITY_RECEIPT_SCHEMA="p24b-production-deployment-authority-recheck-v1"/u);
  assert.match(alias, /\.pageCount >= 1 and \.paginationComplete == true/u);

  for (const [name, value] of [
    ["RC6_2_LKG_APP_COMMIT", RC6_2_LAST_KNOWN_GOOD.appCommit],
    ["RC6_2_LKG_PRIMARY_DEPLOYMENT_ID", RC6_2_LAST_KNOWN_GOOD.deploymentId],
    ["RC6_2_LKG_MIRROR_DEPLOYMENT_ID", RC6_2_LAST_KNOWN_GOOD.deploymentId],
    ["RC6_2_LKG_RELEASE_TAG", RC6_2_LAST_KNOWN_GOOD.releaseTag],
    ["RC6_2_LKG_RELEASE_REVISION", RC6_2_LAST_KNOWN_GOOD.releaseRevision],
    ["RC6_2_LKG_ARTIFACT_ID", `'${RC6_2_LAST_KNOWN_GOOD.artifactId}'`],
    ["RC6_2_LKG_ARTIFACT_NAME", RC6_2_LAST_KNOWN_GOOD.artifactName],
    ["RC6_2_LKG_ARTIFACT_DIGEST", RC6_2_LAST_KNOWN_GOOD.artifactDigest],
    ["RC6_2_LKG_RUN_ID", `'${RC6_2_LAST_KNOWN_GOOD.runId}'`],
    ["RC6_2_LKG_CONTROL_COMMIT", RC6_2_RECOVERY_CONTROL],
  ]) assert.match(workflow, new RegExp(`^  ${name}: ${value}$`, "mu"));
  assert.match(workflow, /^  HISTORICAL_RC6_1_LKG_APP_COMMIT: e84972aaec80885f9e2ab58e56252fb7b93522ea$/mu);
  assert.match(workflow, /^  HISTORICAL_RC6_1_LKG_DEPLOYMENT_ID: dpl_EHemQJyNZtn1NS69tnxQ24dKBRN3$/mu);
  assert.match(job(workflow, "audit_last_known_good"), /Require cryptographic dynamic Last Known Good metadata for normal main push/u);
  assert.match(job(workflow, "alias_cutover"), /Require latest verified Last Known Good for normal cutover/u);
  assert.match(workflow, /audit-rc6-2-last-known-good/u);
  assert.match(workflow, /Validate exact C10 read-only audit control proof/u);
  return true;
}

const [
  workflow,
  manifestText,
  contractText,
  staticProducer,
  productionStaticProducer,
  diagnosticsVerifier,
] = await Promise.all([
  readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"),
  readFile(new URL("../release-manifest.json", import.meta.url), "utf8"),
  readFile(new URL("../release-metadata-contract.json", import.meta.url), "utf8"),
  readFile(new URL("./generate-rc6-4-static-asset-manifest.mjs", import.meta.url), "utf8"),
  readFile(new URL("./generate-rc6-4-production-static-network-manifest.mjs", import.meta.url), "utf8"),
  readFile(new URL("./verify-rc6-4-production-diagnostics-seam.mjs", import.meta.url), "utf8"),
]);
const manifest = JSON.parse(manifestText);
const contract = JSON.parse(contractText);
assert.deepEqual(
  Object.fromEntries(Object.keys(ACTIVE_RELEASE).map((key) => [key, manifest[key]])),
  ACTIVE_RELEASE,
);
assert.deepEqual(contract.immutableReleaseIdentity, ACTIVE_RELEASE);
assert.equal(contract.provenanceSchemaVersion, "p24b-rc6.5-build-provenance-v1");
assert.ok(contract.allowedProvenanceSchemaVersions.includes("p24b-rc6.4-build-provenance-v1"));
assert.ok(contract.allowedProvenanceSchemaVersions.includes("p24b-rc6.2-build-provenance-v1"));
assert.equal(manifest.releaseEpoch, "2026-08-22T01:06:18.000Z");
assert.equal(manifest.releaseBaseCommit, "e9b1091916b53c34ed9676dc4d418baaf696786e");
assert.notEqual(manifest.releaseBaseCommit, RC6_4_PRODUCT_PLACEHOLDER);
assert.match(staticProducer, /diagnosticsFlag !== "1"/u);
assert.match(staticProducer, /environment:\s*"preview"/u);
assert.equal(
  createHash("sha256").update(staticProducer).digest("hex"),
  FROZEN_RC6_4_STATIC_PRODUCER_SHA256,
);
assert.match(productionStaticProducer, /RC6_4_PRODUCTION_STATIC_NETWORK_SCHEMA/u);
assert.match(productionStaticProducer, /environment:\s*"production"/u);
assert.match(productionStaticProducer, /diagnosticsFlag !== "0"/u);
assert.match(productionStaticProducer, /RC6_4_PRODUCTION_STATIC_ASSET_DOMAIN/u);
assert.match(productionStaticProducer, /publishManifestPairAtomically/u);
assert.match(productionStaticProducer, /preview-rejected-by-production/u);
assert.match(productionStaticProducer, /production-rejected-by-preview/u);
assert.equal(
  createHash("sha256").update(productionStaticProducer).digest("hex"),
  FROZEN_RC6_4_PRODUCTION_STATIC_PRODUCER_SHA256,
);
assert.match(diagnosticsVerifier, /diagnosticsFlag !== "0"/u);
assert.match(diagnosticsVerifier, /DIAGNOSTIC_SEAM_PRESENT_IN_SEALED_BYTES/u);
verifyWorkflow(workflow);

const releaseDigest = "a".repeat(64);
const recoveryDigest = "b".repeat(64);
const normal = createRc64ProductionAuthorization({
  productionAuthorityProofDigest: releaseDigest,
});
assert.equal(normal.mode, RC6_4_NORMAL_PRODUCTION_AUTHORIZATION);
assert.equal(normal.productionAuthorizationProofDigest, releaseDigest);
assert.equal(normal.recoveryControl, null);
assert.deepEqual(validateRc64ProductionAuthorization(normal), normal);

const recovery = createRc64ProductionAuthorization({
  recovery: true,
  productionAuthorityProofDigest: releaseDigest,
  recoveryControlProofDigest: recoveryDigest,
});
assert.equal(recovery.mode, RC6_4_RECOVERY_PRODUCTION_AUTHORIZATION);
assert.equal(recovery.productionAuthorizationProofDigest, recoveryDigest);
assert.deepEqual(recovery.recoveryControl, { proofDigest: recoveryDigest });
assert.deepEqual(validateRc64ProductionAuthorization(recovery), recovery);

assert.throws(() => createRc64ProductionAuthorization({
  productionAuthorityProofDigest: releaseDigest,
  recoveryControlProofDigest: recoveryDigest,
}), /RC6_4_NORMAL_RELEASE_RECOVERY_CONTROL_FORBIDDEN/u);
assert.throws(() => createRc64ProductionAuthorization({
  recovery: true,
  productionAuthorityProofDigest: releaseDigest,
}), /RC6_4_RECOVERY_CONTROL_PROOF_DIGEST_REQUIRED/u);
assert.throws(() => validateRc64ProductionAuthorization({
  ...normal,
  productionAuthorizationProofDigest: recoveryDigest,
}), /RC6_4_PRODUCTION_AUTHORIZATION_DIGEST_MISMATCH/u);
assert.throws(() => verifyWorkflow(workflow.replace(
  "NEXT_PUBLIC_RC6_4_BROWSER_PROSE_DIAGNOSTICS: '1'",
  "NEXT_PUBLIC_RC6_4_BROWSER_PROSE_DIAGNOSTICS: '0'",
)));
assert.throws(() => verifyWorkflow(workflow.replace(
  "verify-rc6-4-production-diagnostics-seam.mjs sealed .vercel/output/static .next/static",
  "echo skipped",
)));
assert.throws(() => verifyWorkflow(workflow.replace(
  "node scripts/generate-rc6-4-production-static-network-manifest.mjs validate",
  "echo production static validation skipped",
)));
assert.throws(() => verifyWorkflow(workflow.replace(
  "RC6_4_PRODUCTION_STATIC_ASSET_ROOT: ${{ runner.temp }}/rc6-4-production-static-source/.vercel/output/static",
  "RC6_4_PRODUCTION_STATIC_ASSET_ROOT: .next/static",
)));
assert.throws(() => verifyWorkflow(workflow.replace(
  "RC6_4_STATIC_ASSET_MANIFEST_PATH: ${{ github.workspace }}/.vercel/rc6.4-preview-static-assets.json",
  "RC6_4_STATIC_ASSET_MANIFEST_PATH: .vercel/rc6.4-preview-static-assets.json",
)));
assert.throws(() => verifyWorkflow(workflow.replace(
  "RC6_4_STATIC_ASSET_SIDECAR_PATH: ${{ github.workspace }}/.vercel/rc6.4-preview-static-assets.sha256",
  "RC6_4_STATIC_ASSET_SIDECAR_PATH: .vercel/rc6.4-preview-static-assets.sha256",
)));
assert.throws(() => verifyWorkflow(workflow.replace(
  "productionStaticNetwork:$productionStaticNetwork",
  "productionStaticNetwork:null",
)));
assert.throws(() => verifyWorkflow(workflow.replace(
  "env:\n",
  "env:\n  RC6_4_PRODUCT_COMMIT: ${{ vars.RC6_4_PRODUCT_COMMIT }}\n",
)));
assert.throws(() => verifyWorkflow(workflow.replace(
  `github.sha != '${RC6_2_RECOVERY_CONTROL}'`,
  `github.sha != '${RC6_2_RECOVERY_PRODUCT}'`,
)));

process.stdout.write(`${JSON.stringify({
  schemaVersion: "p24b-rc6.5-release-workflow-contract-v1",
  status: "PASS",
  activeRelease: ACTIVE_RELEASE,
  historicalRecoveryProduct: RC6_2_RECOVERY_PRODUCT,
  normalAuthorization: normal.mode,
  recoveryAuthorization: recovery.mode,
  frozenStaticProducerSha256: FROZEN_RC6_4_STATIC_PRODUCER_SHA256,
  frozenProductionStaticProducerSha256: FROZEN_RC6_4_PRODUCTION_STATIC_PRODUCER_SHA256,
  negativeContracts: 12,
})}\n`);

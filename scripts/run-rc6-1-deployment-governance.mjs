import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  auditProductionEnvironment,
  createEnvironmentRepairReceipt,
  deleteVercelProductionEnvironmentRecord,
  evaluateStagedExternalAiRuntimeTruth,
  planInvalidOptionalOpenAiProductionRemoval,
  readBoundProductionExternalAiRuntimeTruth,
  readBoundProductionExternalAiRuntimeTruthWithRetry,
  readProductionExternalAiRuntimeTruth,
  readVercelProductionEnvironmentMetadata,
  readVercelProjectIdentity,
  removeInvalidOptionalOpenAiProductionEnvironment,
  validateAuditedProductionEnvironmentInput,
  verifySupabaseProductionCredential,
} from "./production-environment-governance.mjs";
import {
  createLastKnownGoodProductionIdentity,
  discoverLatestLastKnownGoodArtifact,
  parseLastKnownGoodCandidate,
  safeDiscoverLatestLastKnownGoodArtifact,
  selectVerifiedRollbackTarget,
  validateLastKnownGoodProductionIdentity,
} from "./production-last-known-good.mjs";
import { verifyProductionPublicCutover } from "./verify-production-public-cutover.mjs";
import {
  createVercelAliasSetter,
  createVercelControlPlaneReader,
  promoteDualAliases,
  restoreDualAliases,
} from "./vercel-dual-alias-cutover.mjs";
import { planXaiProductionChanges } from "./bootstrap-production-external-ai-env.mjs";
import { restrictSupabaseProductionChanges } from "./bootstrap-production-supabase-env.mjs";
import { upsertSensitiveProductionEnvironment } from "./vercel-environment-mutation.mjs";
import { verifyVercelPrebuiltFileReferences } from "./verify-vercel-prebuilt-file-references.mjs";

const [workflow, envGovernanceSource, lkgSource, publicGateSource, vercelConfigurationText] = await Promise.all([
  readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"),
  readFile(new URL("./production-environment-governance.mjs", import.meta.url), "utf8"),
  readFile(new URL("./production-last-known-good.mjs", import.meta.url), "utf8"),
  readFile(new URL("./verify-production-public-cutover.mjs", import.meta.url), "utf8"),
  readFile(new URL("../vercel.json", import.meta.url), "utf8"),
]);
const vercelConfiguration = JSON.parse(vercelConfigurationText);

const jobOrder = [
  "validate",
  "production_env_audit",
  "production_env_repair",
  "production_build",
  "staged_deploy",
  "runtime_gates",
  "alias_cutover",
];

function jobSection(name) {
  const start = workflow.indexOf(`\n  ${name}:`);
  assert.ok(start > 0, `job missing: ${name}`);
  const next = [...workflow.matchAll(/^  [a-z_]+:/gmu)]
    .map((match) => match.index)
    .filter((index) => index > start + 1)
    .sort((left, right) => left - right)[0];
  return workflow.slice(start, next || workflow.length);
}

function testOrdering() {
  assert.equal(
    vercelConfiguration.git?.deploymentEnabled,
    false,
    "native Vercel Git deploys must not bypass audit, repair, runtime gates, or cutover",
  );
  const indexes = jobOrder.map((name) => workflow.indexOf(`\n  ${name}:`));
  assert.ok(indexes.every((index) => index > 0));
  assert.deepEqual([...indexes].sort((left, right) => left - right), indexes);
  assert.match(jobSection("production_env_audit"), /needs:\s*validate/u);
  assert.match(jobSection("production_env_repair"), /needs:\s*\[validate,\s*production_env_audit\]/u);
  assert.match(jobSection("production_build"), /needs:\s*production_env_repair/u);
  assert.match(jobSection("staged_deploy"), /needs:\s*production_build/u);
  assert.match(jobSection("runtime_gates"), /needs:\s*staged_deploy/u);
  assert.match(jobSection("alias_cutover"), /needs:\s*\[staged_deploy,\s*runtime_gates\]/u);
  assert.match(jobSection("production_build"), /include-hidden-files:\s*true/u);
  assert.doesNotMatch(jobSection("validate"), /pnpm build(?:\s|$)|conversation-bundle-budget/u);
  assert.match(jobSection("validate"), /pnpm build:manual-learning-worker/u);
  assert.match(jobSection("validate"), /node scripts\/generate-release-provenance\.mjs/u);
  const productionBuild = jobSection("production_build");
  assert.ok(
    productionBuild.indexOf("pnpm test:studio:conversation-bundle-budget")
      > productionBuild.indexOf("vercel build --prod"),
    "bundle budget must consume the fresh formal production build",
  );
  assert.match(productionBuild, /verify-vercel-prebuilt-file-references\.mjs/u);
  assert.match(productionBuild, /tar --create --gzip/u);
  assert.match(productionBuild, /--file "\$RUNNER_TEMP\/production-prebuilt\.tgz"/u);
  assert.match(productionBuild, /--exclude='\.next\/cache'/u);
  assert.match(productionBuild, /\.vercel\/output \.next/u);
  assert.match(productionBuild, /path:\s*\$\{\{ runner\.temp \}\}\/production-prebuilt\.tgz/u);
  assert.match(productionBuild, /name:\s*production-prebuilt-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_id \}\}/u);
  assert.match(productionBuild, /overwrite:\s*true/u);
  assert.doesNotMatch(productionBuild, /production-prebuilt-[^\n]*github\.run_attempt/u);
  const stagedDeploy = jobSection("staged_deploy");
  assert.match(stagedDeploy, /name:\s*production-prebuilt-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_id \}\}/u);
  assert.doesNotMatch(stagedDeploy, /production-prebuilt-[^\n]*github\.run_attempt/u);
  assert.match(stagedDeploy, /path:\s*\$\{\{ runner\.temp \}\}\/production-prebuilt/u);
  assert.match(stagedDeploy, /tar --extract --gzip --file "\$archive" --directory "\$GITHUB_WORKSPACE"/u);
  assert.match(stagedDeploy, /test -f \.vercel\/output\/config\.json/u);
  assert.match(stagedDeploy, /Verify sealed artifact after Vercel project pull[\s\S]*verify-vercel-prebuilt-file-references\.mjs/u);
  assert.ok(
    stagedDeploy.indexOf("Verify sealed artifact after Vercel project pull")
      > stagedDeploy.indexOf("Pull Vercel project identity for staged deployment"),
    "the sealed artifact must be checked again after vercel pull",
  );
  assert.ok(
    stagedDeploy.indexOf("Deploy staged production without alias mutation")
      > stagedDeploy.indexOf("Verify sealed artifact after Vercel project pull"),
    "staged deploy must not start before the post-pull artifact gate",
  );
  assert.match(stagedDeploy, /deployment_stdout="\$RUNNER_TEMP\/vercel-staged-deploy\.stdout"/u);
  assert.match(stagedDeploy, /deploy_log="\$RUNNER_TEMP\/vercel-staged-deploy\.stderr\.log"/u);
  assert.match(stagedDeploy, /perl -pe '[^\n]*\$ENV\{"VERCEL_TOKEN"\}[^\n]*\[REDACTED\]/u);
  assert.match(stagedDeploy, /> "\$deployment_stdout"; \} 2>&1/u);
  assert.match(stagedDeploy, /\| tee "\$deploy_log" >&2/u);
  assert.match(stagedDeploy, /pipeline_status=\("\$\{PIPESTATUS\[@\]\}"\)/u);
  assert.ok(
    stagedDeploy.indexOf('pipeline_status=("${PIPESTATUS[@]}")')
      < stagedDeploy.indexOf('set -e\n          deploy_status='),
    "the pipeline statuses must be captured before errexit is restored",
  );
  assert.match(stagedDeploy, /deploy_status="\$\{pipeline_status\[0\]\}"/u);
  assert.match(stagedDeploy, /exit "\$deploy_status"/u);
  assert.ok(stagedDeploy.includes("deployment_url=\"$(sed -e 's/\\r$//' \"$deployment_stdout\")\""));
  assert.ok(stagedDeploy.includes('[[ ! "$deployment_url" =~ ^https://[[:alnum:]]([[:alnum:]-]{0,61}[[:alnum:]])?[.]vercel[.]app/?$ ]]'));
  assert.match(stagedDeploy, /deployment_url="\$\{deployment_url%\/\}"/u);
  assert.doesNotMatch(stagedDeploy, /output="\$\(pnpm exec vercel deploy/u);
  assert.doesNotMatch(stagedDeploy, /set -x|(?:echo|printf)[^\n]*\$VERCEL_TOKEN/u);
  const runtimeGates = jobSection("runtime_gates");
  assert.match(runtimeGates, /generated\/manual-learning-worker\.js/u);
  assert.match(runtimeGates, /curl --connect-timeout 5 --max-time 20/u);
  assert.match(runtimeGates, /\(java\|ecma\)script/u);
  assert.match(runtimeGates, /bytes >= 500000 && bytes <= 3500000/u);
  assert.match(runtimeGates, /LEARNING_FILE_MAGIC_MISMATCH/u);
  assert.match(runtimeGates, /splitManualLearningDocumentSemantically/u);
  assert.match(runtimeGates, /LEARNING_WORKER_DUPLICATE_REQUEST/u);
  assert.match(runtimeGates, /prepare_import_file/u);
  assert.match(runtimeGates, /manual-learning-worker-protocol-v2/u);
  assert.match(runtimeGates, /EXPECTED_XAI_MODEL_ID:\s*grok-4\.5/u);
  assert.match(runtimeGates, /XAI_EXPECTED:\s*\$\{\{ secrets\.XAI_API_KEY != '' \}\}/u);
  assert.match(runtimeGates, /grok_verified/u);
  assert.match(runtimeGates, /grok_not_configured/u);
  assert.match(runtimeGates, /grok_safe/u);
  assert.match(runtimeGates, /\.configured == true and \.verification == "verified" and \.verificationCode == "MODEL_ACCESS_VERIFIED" and \.modelId == \$expectedModel/u);
  assert.match(runtimeGates, /openai_not_configured/u);
  assert.match(runtimeGates, /openai_verified/u);
  assert.match(runtimeGates, /top_level_safe/u);
  assert.doesNotMatch(runtimeGates, /\.verification == "failed"/u);
  assert.doesNotMatch(runtimeGates, /grok-4\.5-latest/u);
}

async function testPrebuiltFileReferences() {
  const workspace = await mkdtemp(join(tmpdir(), "rc6-1-vercel-prebuilt-"));
  const writeFixture = async (relativePath, content = "fixture") => {
    const fixturePath = join(workspace, relativePath);
    await mkdir(dirname(fixturePath), { recursive: true });
    await writeFile(fixturePath, content, "utf8");
    return fixturePath;
  };
  try {
    await writeFixture(".vercel/output/config.json", "{}");
    await writeFixture(".next/server/chunk.js");
    await writeFixture("node_modules/example/index.js");
    await writeFixture("evals/rubric.json");
    await writeFixture(".env.example");
    const writeFunctionConfig = (filePathMap) => writeFixture(
      ".vercel/output/functions/api.func/.vc-config.json",
      JSON.stringify({ runtime: "nodejs24.x", filePathMap }),
    );
    await writeFunctionConfig({
      "bundle/chunk-a.js": ".next/server/chunk.js",
      "bundle/chunk-b.js": ".next/server/chunk.js",
      "bundle/package.js": "node_modules/example/index.js",
      "bundle/rubric.json": "evals/rubric.json",
      "bundle/env.example": ".env.example",
    });

    const report = await verifyVercelPrebuiltFileReferences({ workspace });
    assert.equal(report.status, "PASS");
    assert.equal(report.functionConfigCount, 1);
    assert.equal(report.referenceCount, 5);
    assert.equal(report.uniqueReferenceCount, 4);
    assert.deepEqual(report.topLevelReferenceCounts, {
      ".next": 1,
      node_modules: 1,
      evals: 1,
      ".env.example": 1,
    });

    await rm(join(workspace, ".next/server/chunk.js"));
    await assert.rejects(
      verifyVercelPrebuiltFileReferences({ workspace }),
      (error) => error.code === "VERCEL_PREBUILT_FILE_REFERENCE_MISSING"
        && error.details.missingCount === 1,
    );

    await writeFixture(".next/server/chunk.js");
    await writeFixture(".next/cache/unsafe.bin");
    await writeFunctionConfig({ "bundle/unsafe.bin": ".next/cache/unsafe.bin" });
    await assert.rejects(
      verifyVercelPrebuiltFileReferences({ workspace }),
      (error) => error.code === "VERCEL_PREBUILT_REFERENCE_EXCLUDED_FROM_ARCHIVE",
    );

    await writeFunctionConfig({ "bundle/root": "." });
    await assert.rejects(
      verifyVercelPrebuiltFileReferences({ workspace }),
      (error) => error.code === "VERCEL_PREBUILT_FILE_REFERENCE_INVALID",
    );
    await writeFunctionConfig({ "bundle/backslash": ".next\\server\\chunk.js" });
    await assert.rejects(
      verifyVercelPrebuiltFileReferences({ workspace }),
      (error) => error.code === "VERCEL_PREBUILT_FILE_REFERENCE_INVALID",
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function readyProduction() {
  const projectRef = "iwobncchxuykcztziavw";
  const serviceRolePayload = Buffer.from(JSON.stringify({
    role: "service_role",
    ref: projectRef,
  })).toString("base64url");
  return {
    projectRef,
    production: {
      SUPABASE_PROJECT_REF: projectRef,
      NEXT_PUBLIC_SUPABASE_URL: `https://${projectRef}.supabase.co`,
      SUPABASE_SERVICE_ROLE_KEY: `header.${serviceRolePayload}.signature`,
    },
    projectIdentity: { verified: true, projectIdMatches: true, teamIdMatches: true },
    supabaseCredentialVerification: {
      verified: true,
      readOnly: true,
      projectRefMatches: true,
      restHttpStatus: 200,
      storageHttpStatus: 200,
      failureCode: null,
      secretValuesStored: false,
    },
    vercelEnvironmentMetadata: {
      verified: true,
      readOnly: true,
      entries: {
        SUPABASE_PROJECT_REF: {
          key: "SUPABASE_PROJECT_REF", type: "encrypted", targets: ["production"],
        },
        NEXT_PUBLIC_SUPABASE_URL: {
          key: "NEXT_PUBLIC_SUPABASE_URL", type: "encrypted", targets: ["production"],
        },
        SUPABASE_SERVICE_ROLE_KEY: {
          key: "SUPABASE_SERVICE_ROLE_KEY", type: "sensitive", targets: ["production"],
        },
      },
      secretValuesStored: false,
    },
  };
}

async function testEnvironmentAuditAndRepair() {
  const fixture = readyProduction();
  const ready = auditProductionEnvironment({
    production: fixture.production,
    expectedProjectRef: fixture.projectRef,
    projectIdentity: fixture.projectIdentity,
    supabaseCredentialVerification: fixture.supabaseCredentialVerification,
    vercelEnvironmentMetadata: fixture.vercelEnvironmentMetadata,
  });
  assert.equal(ready.readOnly, true);
  assert.equal(ready.mutationCount, 0);
  assert.equal(ready.repairRequired, false);
  assert.equal(ready.secretValuesStored, false);
  const sensitivePulledAsUnreadable = auditProductionEnvironment({
    production: { ...fixture.production, SUPABASE_SERVICE_ROLE_KEY: "" },
    expectedProjectRef: fixture.projectRef,
    projectIdentity: fixture.projectIdentity,
    supabaseCredentialVerification: {
      ...fixture.supabaseCredentialVerification,
      verificationMode: "vercel-metadata-plus-current-runtime",
    },
    vercelEnvironmentMetadata: fixture.vercelEnvironmentMetadata,
  });
  assert.equal(sensitivePulledAsUnreadable.repairRequired, false);
  assert.equal(sensitivePulledAsUnreadable.truth.requiredVariables.SUPABASE_SERVICE_ROLE_KEY, true);

  const metadataSecret = "must-not-survive-sanitization";
  const sanitizedMetadata = await readVercelProductionEnvironmentMetadata({
    token: "test-token",
    teamId: "team_expected",
    projectId: "prj_expected",
    fetcher: async () => Response.json({ envs: [{
      key: "SUPABASE_SERVICE_ROLE_KEY",
      value: metadataSecret,
      type: "sensitive",
      target: ["production"],
      updatedAt: 42,
    }] }),
  });
  assert.equal(sanitizedMetadata.entries.SUPABASE_SERVICE_ROLE_KEY.type, "sensitive");
  assert.doesNotMatch(JSON.stringify(sanitizedMetadata), new RegExp(metadataSecret, "u"));

  const drift = auditProductionEnvironment({
    production: { ...fixture.production, NEXT_PUBLIC_SUPABASE_URL: "https://wrong.supabase.co" },
    expectedProjectRef: fixture.projectRef,
    githubXaiApiKey: "xai-test-secret-value-with-enough-length",
    expectedXaiModelId: "grok-4.5",
    projectIdentity: fixture.projectIdentity,
    supabaseCredentialVerification: fixture.supabaseCredentialVerification,
    vercelEnvironmentMetadata: fixture.vercelEnvironmentMetadata,
  });
  assert.equal(drift.repairRequired, true);
  assert.deepEqual(drift.driftKeys, ["NEXT_PUBLIC_SUPABASE_URL", "XAI_API_KEY", "XAI_MODEL_ID"]);
  const repaired = auditProductionEnvironment({
    production: {
      ...fixture.production,
      XAI_API_KEY: "xai-test-secret-value-with-enough-length",
      XAI_MODEL_ID: "grok-4.5",
    },
    expectedProjectRef: fixture.projectRef,
    githubXaiApiKey: "xai-test-secret-value-with-enough-length",
    expectedXaiModelId: "grok-4.5",
    projectIdentity: fixture.projectIdentity,
    supabaseCredentialVerification: fixture.supabaseCredentialVerification,
    vercelEnvironmentMetadata: fixture.vercelEnvironmentMetadata,
  });
  const receipt = createEnvironmentRepairReceipt({
    before: drift,
    after: repaired,
    actualChangedKeys: ["NEXT_PUBLIC_SUPABASE_URL", "XAI_API_KEY", "XAI_MODEL_ID"],
  });
  assert.equal(receipt.changedKeysCount, 3);
  assert.equal(receipt.mutationCount, 3);
  assert.equal(receipt.secretValuesStored, false);
  const noopReceipt = createEnvironmentRepairReceipt({
    before: ready,
    after: ready,
    actualChangedKeys: [],
  });
  assert.equal(noopReceipt.mutationCount, 0);
  assert.equal(noopReceipt.beforeDigest, noopReceipt.afterDigest);

  const wrongProjectRef = "wrongprojectrefvalue";
  const wrongProjectPayload = Buffer.from(JSON.stringify({
    role: "service_role",
    ref: wrongProjectRef,
  })).toString("base64url");
  const wrongProjectCredential = `header.${wrongProjectPayload}.signature`;
  let wrongProjectFetchCount = 0;
  const wrongProjectVerification = await verifySupabaseProductionCredential({
    production: { SUPABASE_SERVICE_ROLE_KEY: wrongProjectCredential },
    expectedProjectRef: fixture.projectRef,
    fetcher: async () => {
      wrongProjectFetchCount += 1;
      return new Response("[]", { status: 200 });
    },
  });
  assert.equal(wrongProjectVerification.verified, false);
  assert.equal(wrongProjectVerification.projectRefMatches, false);
  assert.equal(wrongProjectVerification.failureCode, "SUPABASE_SERVICE_CREDENTIAL_PROJECT_MISMATCH");
  assert.equal(wrongProjectFetchCount, 0, "embedded wrong-project key must be rejected before network use");
  const wrongProjectAudit = auditProductionEnvironment({
    production: {
      ...fixture.production,
      SUPABASE_SERVICE_ROLE_KEY: wrongProjectCredential,
    },
    expectedProjectRef: fixture.projectRef,
    projectIdentity: fixture.projectIdentity,
    supabaseCredentialVerification: wrongProjectVerification,
    vercelEnvironmentMetadata: fixture.vercelEnvironmentMetadata,
  });
  assert.equal(wrongProjectAudit.repairRequired, true);
  assert.ok(wrongProjectAudit.driftKeys.includes("SUPABASE_SERVICE_ROLE_KEY"));
  assert.doesNotMatch(JSON.stringify(wrongProjectAudit), new RegExp(wrongProjectCredential, "u"));

  const revokedVerification = await verifySupabaseProductionCredential({
    production: fixture.production,
    expectedProjectRef: fixture.projectRef,
    fetcher: async () => new Response("unauthorized", { status: 401 }),
  });
  assert.equal(revokedVerification.verified, false);
  assert.equal(revokedVerification.failureCode, "SUPABASE_SERVICE_CREDENTIAL_REST_REJECTED");

  const auditJob = jobSection("production_env_audit");
  const repairJob = jobSection("production_env_repair");
  assert.match(auditJob, /production-environment-governance\.mjs audit/u);
  assert.match(auditJob, /production-environment-audit-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_id \}\}/u);
  assert.match(auditJob, /overwrite:\s*true/u);
  assert.doesNotMatch(auditJob, /bootstrap-production-|env add|vercel-dual-alias|vercel alias/u);
  assert.match(repairJob, /AUDIT_REPAIR_REQUIRED/u);
  assert.match(repairJob, /AUDIT_BEFORE_DIGEST/u);
  assert.match(repairJob, /Download exact sanitized Production audit evidence/u);
  assert.match(repairJob, /PRODUCTION_ENV_AUDIT_INPUT_PATH/u);
  assert.match(repairJob, /production-environment-audit-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_id \}\}/u);
  assert.doesNotMatch(repairJob, /production-environment-audit-[^\n]*github\.run_attempt/u);
  assert.match(repairJob, /if:\s*needs\.production_env_audit\.outputs\.repair_required == 'true'/u);
  assert.match(repairJob, /Record zero-mutation repair receipt/u);
  assert.match(envGovernanceSource, /auditedRepairRequired && before\.driftKeys/u);
  assert.match(envGovernanceSource, /PRODUCTION_REPAIR_AUDIT_DIGEST_CHANGED/u);
  assert.match(envGovernanceSource, /PRODUCTION_REPAIR_AUDIT_ARTIFACT_UNTRUSTED/u);
  assert.match(envGovernanceSource, /secretValuesStored:\s*false/u);
}

function externalAiPayload({
  grokVerification = "verified",
  grokVerificationCode = "MODEL_ACCESS_VERIFIED",
  grokConfigured = true,
  grokModelId = "grok-4.5",
  openaiVerification = "not_configured",
  openaiVerificationCode = "NOT_CONFIGURED",
  openaiConfigured = false,
  includeOpenai = true,
  topLevelVerification,
  secretMarker,
} = {}) {
  const providers = [];
  if (includeOpenai) {
    providers.push({
      id: "openai",
      configured: openaiConfigured,
      verification: openaiVerification,
      verificationCode: openaiVerificationCode,
      modelId: "gpt-5.4-mini",
      serverSideCredentialOnly: true,
      dataLeavesDevice: true,
      apiKey: secretMarker,
    });
  }
  providers.push({
    id: "grok",
    configured: grokConfigured,
    verification: grokVerification,
    verificationCode: grokVerificationCode,
    modelId: grokModelId,
    serverSideCredentialOnly: true,
    dataLeavesDevice: true,
    apiKey: secretMarker,
  });
  return {
    status: "ready",
    credentials: "server-side-only",
    silentFallback: false,
    probePerformed: true,
    verification: topLevelVerification || (
      providers.every((provider) => provider.verification === "verified") ? "verified" : "degraded"
    ),
    providers,
    secretMarker,
  };
}

async function testExternalAiProductionTruth() {
  const aliases = ["primary.example", "mirror.example"];
  const secretMarker = "xai-secret-must-never-enter-audit";
  const responseFor = (payload) => async () => Response.json(payload);
  const verified = await readProductionExternalAiRuntimeTruth({
    aliases,
    expectedXaiModelId: "grok-4.5",
    fetcher: responseFor(externalAiPayload({ secretMarker })),
  });
  assert.equal(verified.verified, true);
  assert.equal(verified.indeterminate, false);
  assert.equal(verified.readOnly, true);
  assert.equal(verified.observations.length, 2);
  assert.doesNotMatch(JSON.stringify(verified), new RegExp(secretMarker, "u"));

  const revoked = await readProductionExternalAiRuntimeTruth({
    aliases,
    expectedXaiModelId: "grok-4.5",
    fetcher: responseFor(externalAiPayload({
      grokVerification: "failed",
      grokVerificationCode: "EXTERNAL_PROVIDER_AUTH_FAILED",
      secretMarker,
    })),
  });
  assert.equal(revoked.verified, false);
  assert.equal(revoked.indeterminate, false);
  assert.equal(revoked.state, "credential_revoked");
  assert.deepEqual(revoked.repairKeys, ["XAI_API_KEY"]);

  const notConfigured = await readProductionExternalAiRuntimeTruth({
    aliases,
    expectedXaiModelId: "grok-4.5",
    fetcher: responseFor(externalAiPayload({
      grokConfigured: false,
      grokVerification: "not_configured",
      grokVerificationCode: "NOT_CONFIGURED",
    })),
  });
  assert.equal(notConfigured.indeterminate, false);
  assert.equal(notConfigured.state, "credential_not_configured");
  assert.deepEqual(notConfigured.repairKeys, ["XAI_API_KEY"]);

  const fixture = readyProduction();
  const optionalAbsent = auditProductionEnvironment({
    production: fixture.production,
    expectedProjectRef: fixture.projectRef,
    expectedXaiModelId: "grok-4.5",
    projectIdentity: fixture.projectIdentity,
    supabaseCredentialVerification: fixture.supabaseCredentialVerification,
    vercelEnvironmentMetadata: fixture.vercelEnvironmentMetadata,
    externalAiRuntimeTruth: notConfigured,
  });
  assert.equal(optionalAbsent.truth.externalAi.expected, false);
  assert.equal(optionalAbsent.truth.externalAi.runtimeState, "credential_not_configured");
  assert.equal(optionalAbsent.repairRequired, false);
  assert.deepEqual(optionalAbsent.driftKeys, []);

  const githubXaiApiKey = "xai-github-secret-with-sufficient-length";
  const expectedButAbsent = auditProductionEnvironment({
    production: { ...fixture.production, XAI_MODEL_ID: "grok-4.5" },
    expectedProjectRef: fixture.projectRef,
    githubXaiApiKey,
    expectedXaiModelId: "grok-4.5",
    projectIdentity: fixture.projectIdentity,
    supabaseCredentialVerification: fixture.supabaseCredentialVerification,
    vercelEnvironmentMetadata: fixture.vercelEnvironmentMetadata,
    externalAiRuntimeTruth: notConfigured,
  });
  assert.equal(expectedButAbsent.truth.externalAi.expected, true);
  assert.equal(expectedButAbsent.repairRequired, true);
  assert.deepEqual(expectedButAbsent.driftKeys, ["XAI_API_KEY"]);

  const auditedRevocation = auditProductionEnvironment({
    production: { ...fixture.production, XAI_API_KEY: "", XAI_MODEL_ID: "grok-4.5" },
    expectedProjectRef: fixture.projectRef,
    githubXaiApiKey,
    expectedXaiModelId: "grok-4.5",
    projectIdentity: fixture.projectIdentity,
    supabaseCredentialVerification: fixture.supabaseCredentialVerification,
    vercelEnvironmentMetadata: {
      ...fixture.vercelEnvironmentMetadata,
      entries: {
        ...fixture.vercelEnvironmentMetadata.entries,
        XAI_API_KEY: { key: "XAI_API_KEY", type: "sensitive", targets: ["production"] },
        XAI_MODEL_ID: { key: "XAI_MODEL_ID", type: "encrypted", targets: ["production"] },
      },
    },
    externalAiRuntimeTruth: revoked,
  });
  assert.deepEqual(auditedRevocation.driftKeys, ["XAI_API_KEY"]);
  assert.equal(auditedRevocation.truth.externalAi.runtimeState, "credential_revoked");
  assert.doesNotMatch(JSON.stringify(auditedRevocation), new RegExp(githubXaiApiKey, "u"));

  const invalidOptionalOpenAi = await readProductionExternalAiRuntimeTruth({
    aliases,
    expectedXaiModelId: "grok-4.5",
    fetcher: responseFor(externalAiPayload({
      grokConfigured: false,
      grokVerification: "not_configured",
      grokVerificationCode: "NOT_CONFIGURED",
      openaiConfigured: true,
      openaiVerification: "failed",
      openaiVerificationCode: "EXTERNAL_PROVIDER_AUTH_FAILED",
      secretMarker,
    })),
  });
  assert.equal(invalidOptionalOpenAi.indeterminate, false);
  assert.equal(invalidOptionalOpenAi.state, "credential_not_configured");
  assert.equal(invalidOptionalOpenAi.openaiState, "credential_revoked");
  assert.deepEqual(invalidOptionalOpenAi.openaiRepairKeys, ["OPENAI_API_KEY"]);
  assert.doesNotMatch(JSON.stringify(invalidOptionalOpenAi), new RegExp(secretMarker, "u"));

  const auditedDeploymentId = "dpl_AuditedProduction123";
  const auditedAppCommit = "a".repeat(40);
  const createBoundTruthFetcher = ({ changeIdentityAfterProbe = false, target = "production" } = {}) => {
    let identityReadCount = 0;
    return async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "api.vercel.com") {
        return Response.json({
          id: auditedDeploymentId,
          meta: { githubCommitSha: auditedAppCommit },
          projectId: "prj_expected",
          teamId: "team_expected",
          readyState: "READY",
          target,
          createdAt: 100,
        });
      }
      if (url.pathname === "/api/release/identity") {
        identityReadCount += 1;
        return Response.json({
          deploymentId: changeIdentityAfterProbe && identityReadCount > aliases.length
            ? "dpl_ChangedProduction456"
            : auditedDeploymentId,
          appCommit: auditedAppCommit,
          environment: "production",
          provenanceStatus: "verified",
        });
      }
      if (url.pathname === "/api/ai/external/providers") {
        return Response.json(externalAiPayload({
          grokConfigured: false,
          grokVerification: "not_configured",
          grokVerificationCode: "NOT_CONFIGURED",
          openaiConfigured: true,
          openaiVerification: "failed",
          openaiVerificationCode: "EXTERNAL_PROVIDER_AUTH_FAILED",
        }));
      }
      throw new Error(`UNEXPECTED_BOUND_TRUTH_URL:${url}`);
    };
  };
  const boundInvalidOptionalOpenAi = await readBoundProductionExternalAiRuntimeTruth({
    aliases,
    expectedXaiModelId: "grok-4.5",
    token: "test-token",
    teamId: "team_expected",
    projectId: "prj_expected",
    fetcher: createBoundTruthFetcher(),
  });
  assert.equal(boundInvalidOptionalOpenAi.deploymentBound, true);
  assert.equal(boundInvalidOptionalOpenAi.openaiState, "credential_revoked");
  assert.equal(boundInvalidOptionalOpenAi.earliestDeploymentCreatedAt, 100);
  assert.equal(boundInvalidOptionalOpenAi.deploymentSnapshots.length, 2);

  let retryReadCount = 0;
  const recoveredBoundTruth = await readBoundProductionExternalAiRuntimeTruthWithRetry({
    attempts: 3,
    retryDelayMs: 0,
    delay: async () => undefined,
    reader: async () => {
      retryReadCount += 1;
      return retryReadCount < 3
        ? { indeterminate: true, failureCode: "TRANSIENT_READ_ONLY_PROBE_FAILURE" }
        : boundInvalidOptionalOpenAi;
    },
  });
  assert.equal(retryReadCount, 3);
  assert.equal(recoveredBoundTruth, boundInvalidOptionalOpenAi);

  let definiteReadCount = 0;
  const definiteBoundTruth = await readBoundProductionExternalAiRuntimeTruthWithRetry({
    attempts: 3,
    retryDelayMs: 0,
    delay: async () => undefined,
    reader: async () => {
      definiteReadCount += 1;
      return boundInvalidOptionalOpenAi;
    },
  });
  assert.equal(definiteReadCount, 1);
  assert.equal(definiteBoundTruth.openaiState, "credential_revoked");

  let exhaustedReadCount = 0;
  const exhaustedTruth = await readBoundProductionExternalAiRuntimeTruthWithRetry({
    attempts: 3,
    retryDelayMs: 0,
    delay: async () => undefined,
    reader: async () => {
      exhaustedReadCount += 1;
      return {
        indeterminate: true,
        failureCode: `TRANSIENT_${exhaustedReadCount}`,
      };
    },
  });
  assert.equal(exhaustedReadCount, 3);
  assert.equal(exhaustedTruth.indeterminate, true);
  assert.equal(exhaustedTruth.failureCode, "TRANSIENT_3");

  await assert.rejects(
    readBoundProductionExternalAiRuntimeTruthWithRetry({
      attempts: 2,
      retryDelayMs: 5_000,
      deadlineAt: Date.now() - 1,
      reader: async () => ({ indeterminate: true }),
    }),
    (error) => error.code === "PRODUCTION_AUDIT_EXTERNAL_AI_RETRY_DEADLINE_EXCEEDED",
  );

  const changedIdentityTruth = await readBoundProductionExternalAiRuntimeTruth({
    aliases,
    expectedXaiModelId: "grok-4.5",
    token: "test-token",
    teamId: "team_expected",
    projectId: "prj_expected",
    fetcher: createBoundTruthFetcher({ changeIdentityAfterProbe: true }),
  });
  assert.equal(changedIdentityTruth.deploymentBound, false);
  assert.equal(changedIdentityTruth.indeterminate, true);
  assert.equal(
    changedIdentityTruth.failureCode,
    "PRODUCTION_AUDIT_EXTERNAL_AI_DEPLOYMENT_IDENTITY_CHANGED",
  );

  const invalidControlPlaneTruth = await readBoundProductionExternalAiRuntimeTruth({
    aliases,
    expectedXaiModelId: "grok-4.5",
    token: "test-token",
    teamId: "team_expected",
    projectId: "prj_expected",
    fetcher: createBoundTruthFetcher({ target: "preview" }),
  });
  assert.equal(invalidControlPlaneTruth.deploymentBound, false);
  assert.equal(invalidControlPlaneTruth.indeterminate, true);
  assert.equal(
    invalidControlPlaneTruth.failureCode,
    "PRODUCTION_AUDIT_DEPLOYMENT_CONTROL_PLANE_INVALID",
  );

  let disagreeingAliasIndex = 0;
  const disagreeingOptionalOpenAi = await readProductionExternalAiRuntimeTruth({
    aliases,
    expectedXaiModelId: "grok-4.5",
    fetcher: async () => {
      disagreeingAliasIndex += 1;
      return Response.json(externalAiPayload({
        grokConfigured: false,
        grokVerification: "not_configured",
        grokVerificationCode: "NOT_CONFIGURED",
        openaiConfigured: disagreeingAliasIndex === 1,
        openaiVerification: disagreeingAliasIndex === 1 ? "failed" : "not_configured",
        openaiVerificationCode: disagreeingAliasIndex === 1
          ? "EXTERNAL_PROVIDER_AUTH_FAILED"
          : "NOT_CONFIGURED",
      }));
    },
  });
  assert.equal(disagreeingOptionalOpenAi.indeterminate, true);
  assert.equal(
    disagreeingOptionalOpenAi.failureCode,
    "PRODUCTION_AUDIT_EXTERNAL_AI_ALIAS_TRUTH_DISAGREEMENT",
  );
  assert.deepEqual(disagreeingOptionalOpenAi.repairKeys, []);

  const invalidOptionalOpenAiMetadata = await readVercelProductionEnvironmentMetadata({
    token: "test-token",
    teamId: "team_expected",
    projectId: "prj_expected",
    fetcher: async () => Response.json({ envs: [
      {
        id: "env_openai_production_only",
        key: "OPENAI_API_KEY",
        value: secretMarker,
        type: "sensitive",
        target: "production",
        updatedAt: 73,
      },
      {
        id: "env_openai_model_production_only",
        key: "OPENAI_MODEL_ID",
        value: "gpt-5.6-sol",
        type: "encrypted",
        target: ["production"],
        updatedAt: 74,
      },
    ] }),
  });
  assert.deepEqual(
    invalidOptionalOpenAiMetadata.entries.OPENAI_API_KEY.targets,
    ["production"],
    "a string target must normalize to one exact production target",
  );
  assert.equal(invalidOptionalOpenAiMetadata.records.length, 2);
  assert.doesNotMatch(
    JSON.stringify(invalidOptionalOpenAiMetadata),
    new RegExp(secretMarker, "u"),
  );
  const invalidOptionalOpenAiBound = boundInvalidOptionalOpenAi;

  const invalidOptionalOpenAiAudit = auditProductionEnvironment({
    production: { ...fixture.production, OPENAI_API_KEY: "" },
    expectedProjectRef: fixture.projectRef,
    expectedXaiModelId: "grok-4.5",
    projectIdentity: fixture.projectIdentity,
    supabaseCredentialVerification: fixture.supabaseCredentialVerification,
    vercelEnvironmentMetadata: {
      ...fixture.vercelEnvironmentMetadata,
      entries: {
        ...fixture.vercelEnvironmentMetadata.entries,
        ...invalidOptionalOpenAiMetadata.entries,
      },
      records: invalidOptionalOpenAiMetadata.records,
    },
    externalAiRuntimeTruth: invalidOptionalOpenAiBound,
  });
  assert.deepEqual(invalidOptionalOpenAiAudit.driftKeys, ["OPENAI_API_KEY"]);
  assert.equal(
    invalidOptionalOpenAiAudit.truth.externalAi.openai.removalAuthorized,
    true,
  );
  assert.equal(invalidOptionalOpenAiAudit.truth.externalAi.openai.modelMetadataPresent, true);
  assert.doesNotMatch(
    JSON.stringify(invalidOptionalOpenAiAudit),
    new RegExp(secretMarker, "u"),
  );
  assert.equal(
    validateAuditedProductionEnvironmentInput(invalidOptionalOpenAiAudit),
    invalidOptionalOpenAiAudit,
  );
  assert.throws(
    () => validateAuditedProductionEnvironmentInput({
      ...invalidOptionalOpenAiAudit,
      truth: {
        ...invalidOptionalOpenAiAudit.truth,
        externalAi: {
          ...invalidOptionalOpenAiAudit.truth.externalAi,
          openai: {
            ...invalidOptionalOpenAiAudit.truth.externalAi.openai,
            removalAuthorized: false,
          },
        },
      },
    }),
    (error) => error.code === "PRODUCTION_REPAIR_AUDIT_ARTIFACT_UNTRUSTED",
  );
  assert.throws(
    () => validateAuditedProductionEnvironmentInput({
      ...invalidOptionalOpenAiAudit,
      driftKeys: ["XAI_API_KEY"],
    }),
    (error) => error.code === "PRODUCTION_REPAIR_AUDIT_ARTIFACT_UNTRUSTED",
  );
  const auditedDeploymentBinding = {
    deploymentBound: true,
    deploymentSnapshots:
      invalidOptionalOpenAiAudit.truth.externalAi.openai.deploymentSnapshots,
    earliestDeploymentCreatedAt:
      invalidOptionalOpenAiAudit.truth.externalAi.openai.earliestDeploymentCreatedAt,
  };
  const auditedDeploymentBindingReader = async () => auditedDeploymentBinding;

  assert.deepEqual(planInvalidOptionalOpenAiProductionRemoval({
    allowedMutationKeys: invalidOptionalOpenAiAudit.driftKeys,
    auditedExternalAiTruth: invalidOptionalOpenAiAudit.truth.externalAi,
  }), ["OPENAI_API_KEY"]);
  assert.throws(
    () => planInvalidOptionalOpenAiProductionRemoval({
      allowedMutationKeys: ["OPENAI_MODEL_ID"],
      auditedExternalAiTruth: invalidOptionalOpenAiAudit.truth.externalAi,
    }),
    (error) => error.code === "PRODUCTION_REPAIR_OPENAI_MUTATION_KEY_INVALID",
  );

  const removalCalls = [];
  let removalMetadataReadCount = 0;
  const removal = await removeInvalidOptionalOpenAiProductionEnvironment({
    allowedMutationKeys: invalidOptionalOpenAiAudit.driftKeys,
    auditedExternalAiTruth: invalidOptionalOpenAiAudit.truth.externalAi,
    auditDigestVerified: true,
    projectId: "prj_expected",
    token: "vercel-token-must-never-be-logged",
    teamId: "team_expected",
    aliases,
    recordRemover: (input) => {
      removalCalls.push(input);
      return Promise.resolve({ deleted: true, httpStatus: 204 });
    },
    deploymentBindingReader: auditedDeploymentBindingReader,
    metadataReader: async () => {
      removalMetadataReadCount += 1;
      if (removalMetadataReadCount === 1) {
        return invalidOptionalOpenAiAudit.vercelEnvironmentMetadata
          || {
            entries: invalidOptionalOpenAiMetadata.entries,
            records: invalidOptionalOpenAiMetadata.records,
          };
      }
      return {
        entries: { OPENAI_MODEL_ID: invalidOptionalOpenAiMetadata.entries.OPENAI_MODEL_ID },
        records: invalidOptionalOpenAiMetadata.records
          .filter((record) => record.key === "OPENAI_MODEL_ID"),
      };
    },
  });
  assert.deepEqual(removal.changedKeys, ["OPENAI_API_KEY"]);
  assert.equal(removal.mutationCount, 1);
  assert.equal(removal.beforeRecordFingerprint,
    invalidOptionalOpenAiAudit.truth.externalAi.openai.removableRecordFingerprint);
  assert.equal(removalCalls.length, 1);
  assert.equal(removalCalls[0].recordId, "env_openai_production_only");
  assert.equal(removalCalls[0].projectId, "prj_expected");
  assert.equal(removalCalls[0].teamId, "team_expected");
  assert.ok(
    !JSON.stringify(removalCalls[0]).includes("OPENAI_MODEL_ID"),
    "the optional model id is retained because removing the credential is sufficient",
  );

  let deleteRequest;
  const deleteResult = await deleteVercelProductionEnvironmentRecord({
    token: "test-delete-token",
    teamId: "team_expected",
    projectId: "prj_expected",
    recordId: "env_openai_production_only",
    fetcher: async (url, init) => {
      deleteRequest = { url: String(url), init };
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(deleteResult.deleted, true);
  assert.equal(deleteResult.httpStatus, 204);
  const deleteUrl = new URL(deleteRequest.url);
  assert.equal(
    deleteUrl.pathname,
    "/v10/projects/prj_expected/env/env_openai_production_only",
  );
  assert.equal(deleteUrl.searchParams.get("teamId"), "team_expected");
  assert.equal(deleteRequest.init.method, "DELETE");

  let stalePostRemovalCount = 0;
  await assert.rejects(
    removeInvalidOptionalOpenAiProductionEnvironment({
      allowedMutationKeys: invalidOptionalOpenAiAudit.driftKeys,
      auditedExternalAiTruth: invalidOptionalOpenAiAudit.truth.externalAi,
      auditDigestVerified: true,
      projectId: "prj_expected",
      token: "test-token",
      teamId: "team_expected",
      aliases,
      recordRemover: async () => {
        stalePostRemovalCount += 1;
        return { deleted: true, httpStatus: 204 };
      },
      deploymentBindingReader: auditedDeploymentBindingReader,
      metadataReader: async () => ({
        entries: invalidOptionalOpenAiMetadata.entries,
        records: invalidOptionalOpenAiMetadata.records,
      }),
    }),
    (error) => error.code === "PRODUCTION_REPAIR_OPENAI_REMOVAL_NOT_OBSERVED",
  );
  assert.equal(stalePostRemovalCount, 1);
  const pendingOptionalOpenAiRemovalTruth = {
    verified: false,
    indeterminate: false,
    readOnly: true,
    verificationMode: "audited-repair-plus-vercel-metadata-pending-staged-deployment",
    expectedModelId: "grok-4.5",
    state: "credential_not_configured",
    openaiState: "credential_not_configured_pending_staged_deployment",
    xaiRepairKeys: [],
    openaiRepairKeys: [],
    repairKeys: [],
    observations: [],
    secretValuesStored: false,
  };
  const afterOptionalOpenAiRemoval = auditProductionEnvironment({
    production: fixture.production,
    expectedProjectRef: fixture.projectRef,
    expectedXaiModelId: "grok-4.5",
    projectIdentity: fixture.projectIdentity,
    supabaseCredentialVerification: fixture.supabaseCredentialVerification,
    vercelEnvironmentMetadata: fixture.vercelEnvironmentMetadata,
    externalAiRuntimeTruth: pendingOptionalOpenAiRemovalTruth,
  });
  assert.equal(afterOptionalOpenAiRemoval.repairRequired, false);
  assert.throws(
    () => auditProductionEnvironment({
      production: fixture.production,
      expectedProjectRef: fixture.projectRef,
      expectedXaiModelId: "grok-4.5",
      projectIdentity: fixture.projectIdentity,
      supabaseCredentialVerification: fixture.supabaseCredentialVerification,
      vercelEnvironmentMetadata: {
        ...fixture.vercelEnvironmentMetadata,
        entries: {
          ...fixture.vercelEnvironmentMetadata.entries,
          ...invalidOptionalOpenAiMetadata.entries,
        },
        records: invalidOptionalOpenAiMetadata.records,
      },
      externalAiRuntimeTruth: pendingOptionalOpenAiRemovalTruth,
    }),
    (error) => error.code === "PRODUCTION_AUDIT_OPENAI_REMOVAL_PENDING_METADATA_PRESENT",
  );
  const optionalOpenAiRemovalReceipt = createEnvironmentRepairReceipt({
    before: invalidOptionalOpenAiAudit,
    after: afterOptionalOpenAiRemoval,
    actualChangedKeys: ["OPENAI_API_KEY"],
  });
  assert.equal(optionalOpenAiRemovalReceipt.mutationCount, 1);
  assert.equal(optionalOpenAiRemovalReceipt.changedKeysCount, 1);
  assert.deepEqual(optionalOpenAiRemovalReceipt.mutations, [{
    key: "OPENAI_API_KEY",
    operation: "remove",
    target: "production",
    beforeRecordFingerprint:
      invalidOptionalOpenAiAudit.truth.externalAi.openai.removableRecordFingerprint,
  }]);

  const unsafeOpenAiRecordCases = [
    ["missing-id", {}],
    ["missing-updated-at", { id: "env_missing_updated", updatedAt: null }],
    ["zero-updated-at", { id: "env_zero_updated", updatedAt: 0 }],
    ["invalid-updated-at", { id: "env_invalid_updated", updatedAt: "invalid" }],
    ["newer-than-deployment", { id: "env_newer", updatedAt: 101 }],
    ["plain-type", { id: "env_plain", type: "plain" }],
    ["multi-target", { id: "env_multi", target: ["production", "preview"] }],
    ["git-branch", { id: "env_branch", gitBranch: "main" }],
    ["custom-environment", { id: "env_custom", customEnvironmentIds: ["env_custom_target"] }],
    ["system", { id: "env_system", system: true }],
    ["configuration", { id: "env_configuration", configurationId: "icfg_managed" }],
    ["edge-config", { id: "env_edge_config", edgeConfigId: "ecfg_managed" }],
    ["edge-config-token", {
      id: "env_edge_config_token", edgeConfigTokenId: "ect_managed",
    }],
    ["sunset-secret", { id: "env_sunset_secret", sunsetSecretId: "sec_legacy" }],
    ["vsm-value", { id: "env_vsm", vsmValue: secretMarker }],
    ["content-hint", { id: "env_content", contentHint: { type: "secret" } }],
    ["internal-content-hint", {
      id: "env_internal_content", internalContentHint: { type: "secret" },
    }],
    ["integration", { id: "env_integration", integrationId: "integration_managed" }],
    ["managed", { id: "env_managed", managed: true }],
    ["shared", { id: "env_shared", shared: true }],
  ];
  let firstUnsafeTruthDigest = "";
  for (const [caseName, patch] of unsafeOpenAiRecordCases) {
    const unsafeMetadata = await readVercelProductionEnvironmentMetadata({
      token: "test-token",
      teamId: "team_expected",
      projectId: "prj_expected",
      fetcher: async () => Response.json({ envs: [{
        key: "OPENAI_API_KEY",
        type: "sensitive",
        target: "production",
        updatedAt: 72,
        updatedAt: 73,
        ...patch,
      }] }),
    });
    const unsafeAudit = auditProductionEnvironment({
      production: fixture.production,
      expectedProjectRef: fixture.projectRef,
      expectedXaiModelId: "grok-4.5",
      projectIdentity: fixture.projectIdentity,
      supabaseCredentialVerification: fixture.supabaseCredentialVerification,
      vercelEnvironmentMetadata: {
        ...fixture.vercelEnvironmentMetadata,
        entries: { ...fixture.vercelEnvironmentMetadata.entries, ...unsafeMetadata.entries },
        records: unsafeMetadata.records,
      },
      externalAiRuntimeTruth: invalidOptionalOpenAiBound,
    });
    assert.deepEqual(unsafeAudit.driftKeys, ["OPENAI_API_KEY"], caseName);
    assert.equal(unsafeAudit.truth.externalAi.openai.removalAuthorized, false, caseName);
    if (!firstUnsafeTruthDigest) firstUnsafeTruthDigest = unsafeAudit.truthDigest;
    let unsafeRemovalCount = 0;
    await assert.rejects(
      removeInvalidOptionalOpenAiProductionEnvironment({
        allowedMutationKeys: ["OPENAI_API_KEY"],
        auditedExternalAiTruth: unsafeAudit.truth.externalAi,
        auditDigestVerified: true,
        projectId: "prj_expected",
        token: "test-token",
        teamId: "team_expected",
        aliases,
        recordRemover: () => { unsafeRemovalCount += 1; },
        deploymentBindingReader: auditedDeploymentBindingReader,
        metadataReader: async () => unsafeMetadata,
      }),
      (error) => error.code === "PRODUCTION_REPAIR_OPENAI_AUDIT_AUTHORIZATION_INVALID",
      caseName,
    );
    assert.equal(unsafeRemovalCount, 0, `${caseName} must cause zero mutation attempts`);
    assert.doesNotMatch(JSON.stringify(unsafeAudit), new RegExp(secretMarker, "u"));
  }
  const duplicateOpenAiMetadata = await readVercelProductionEnvironmentMetadata({
    token: "test-token",
    teamId: "team_expected",
    projectId: "prj_expected",
    fetcher: async () => Response.json({ envs: [
      {
        id: "env_duplicate_one",
        key: "OPENAI_API_KEY",
        type: "sensitive",
        target: "production",
        updatedAt: 72,
      },
      {
        id: "env_duplicate_two",
        key: "OPENAI_API_KEY",
        type: "sensitive",
        target: ["production"],
        updatedAt: 73,
      },
    ] }),
  });
  const duplicateOpenAiAudit = auditProductionEnvironment({
    production: fixture.production,
    expectedProjectRef: fixture.projectRef,
    expectedXaiModelId: "grok-4.5",
    projectIdentity: fixture.projectIdentity,
    supabaseCredentialVerification: fixture.supabaseCredentialVerification,
    vercelEnvironmentMetadata: {
      ...fixture.vercelEnvironmentMetadata,
      entries: {
        ...fixture.vercelEnvironmentMetadata.entries,
        ...duplicateOpenAiMetadata.entries,
      },
      records: duplicateOpenAiMetadata.records,
    },
    externalAiRuntimeTruth: invalidOptionalOpenAiBound,
  });
  assert.equal(duplicateOpenAiAudit.truth.externalAi.openai.productionRecordCount, 2);
  assert.equal(duplicateOpenAiAudit.truth.externalAi.openai.removalAuthorized, false);
  assert.notEqual(invalidOptionalOpenAiAudit.truthDigest, firstUnsafeTruthDigest);
  assert.notEqual(invalidOptionalOpenAiAudit.truthDigest, duplicateOpenAiAudit.truthDigest);

  let changedFingerprintRemovalCount = 0;
  await assert.rejects(
    removeInvalidOptionalOpenAiProductionEnvironment({
      allowedMutationKeys: ["OPENAI_API_KEY"],
      auditedExternalAiTruth: invalidOptionalOpenAiAudit.truth.externalAi,
      auditDigestVerified: true,
      projectId: "prj_expected",
      token: "test-token",
      teamId: "team_expected",
      aliases,
      recordRemover: () => { changedFingerprintRemovalCount += 1; },
      deploymentBindingReader: auditedDeploymentBindingReader,
      metadataReader: async () => duplicateOpenAiMetadata,
    }),
    (error) => error.code === "PRODUCTION_REPAIR_OPENAI_RECORD_FINGERPRINT_CHANGED",
  );
  assert.equal(changedFingerprintRemovalCount, 0);
  let changedDeploymentRemovalCount = 0;
  await assert.rejects(
    removeInvalidOptionalOpenAiProductionEnvironment({
      allowedMutationKeys: ["OPENAI_API_KEY"],
      auditedExternalAiTruth: invalidOptionalOpenAiAudit.truth.externalAi,
      auditDigestVerified: true,
      projectId: "prj_expected",
      token: "test-token",
      teamId: "team_expected",
      aliases,
      recordRemover: () => { changedDeploymentRemovalCount += 1; },
      metadataReader: async () => invalidOptionalOpenAiMetadata,
      deploymentBindingReader: async () => ({
        ...auditedDeploymentBinding,
        earliestDeploymentCreatedAt:
          auditedDeploymentBinding.earliestDeploymentCreatedAt + 1,
      }),
    }),
    (error) => error.code === "PRODUCTION_REPAIR_OPENAI_DEPLOYMENT_BINDING_CHANGED",
  );
  assert.equal(changedDeploymentRemovalCount, 0);
  await assert.rejects(
    removeInvalidOptionalOpenAiProductionEnvironment({
      allowedMutationKeys: ["OPENAI_API_KEY"],
      auditedExternalAiTruth: invalidOptionalOpenAiAudit.truth.externalAi,
      auditDigestVerified: false,
      projectId: "prj_expected",
      token: "test-token",
      teamId: "team_expected",
      aliases,
      recordRemover: () => undefined,
      deploymentBindingReader: auditedDeploymentBindingReader,
      metadataReader: async () => ({ entries: {} }),
    }),
    (error) => error.code === "PRODUCTION_REPAIR_OPENAI_AUDIT_DIGEST_UNVERIFIED",
  );

  const modelInvalid = await readProductionExternalAiRuntimeTruth({
    aliases,
    expectedXaiModelId: "grok-4.5",
    fetcher: responseFor(externalAiPayload({
      grokVerification: "failed",
      grokVerificationCode: "EXTERNAL_PROVIDER_MODEL_UNAVAILABLE",
    })),
  });
  assert.equal(modelInvalid.indeterminate, false);
  assert.equal(modelInvalid.state, "model_invalid");
  assert.deepEqual(modelInvalid.repairKeys, ["XAI_MODEL_ID"]);

  const timeoutStartedAt = Date.now();
  const timedOut = await readProductionExternalAiRuntimeTruth({
    aliases,
    expectedXaiModelId: "grok-4.5",
    fetcher: () => new Promise(() => {}),
    fetchTimeoutMs: 20,
    deadlineAt: Date.now() + 100,
  });
  assert.equal(timedOut.verified, false);
  assert.equal(timedOut.indeterminate, true);
  assert.equal(timedOut.failureCode, "PRODUCTION_AUDIT_XAI_RUNTIME_TRUTH_UNAVAILABLE");
  assert.ok(Date.now() - timeoutStartedAt < 500, "dual-alias Grok audit timeout must be bounded");
  assert.throws(
    () => auditProductionEnvironment({
      production: fixture.production,
      expectedProjectRef: fixture.projectRef,
      projectIdentity: fixture.projectIdentity,
      supabaseCredentialVerification: fixture.supabaseCredentialVerification,
      vercelEnvironmentMetadata: fixture.vercelEnvironmentMetadata,
      externalAiRuntimeTruth: timedOut,
    }),
    (error) => error.code === "PRODUCTION_AUDIT_XAI_TRUTH_UNAVAILABLE",
  );

  const optionalOpenaiAbsent = evaluateStagedExternalAiRuntimeTruth({
    payload: externalAiPayload({ includeOpenai: true }),
    expectedXaiModelId: "grok-4.5",
  });
  assert.equal(optionalOpenaiAbsent.verified, true);
  assert.equal(optionalOpenaiAbsent.openaiState, "not_configured");

  const allOptionalAbsent = evaluateStagedExternalAiRuntimeTruth({
    payload: externalAiPayload({
      includeOpenai: true,
      grokConfigured: false,
      grokVerification: "not_configured",
      grokVerificationCode: "NOT_CONFIGURED",
    }),
    expectedXaiModelId: "grok-4.5",
    xaiExpected: false,
  });
  assert.equal(allOptionalAbsent.verified, true);
  assert.equal(allOptionalAbsent.grokState, "not_configured");

  const optionalGrokAbsent = evaluateStagedExternalAiRuntimeTruth({
    payload: externalAiPayload({
      includeOpenai: true,
      openaiConfigured: true,
      openaiVerification: "verified",
      openaiVerificationCode: "MODEL_ACCESS_VERIFIED",
      grokConfigured: false,
      grokVerification: "not_configured",
      grokVerificationCode: "NOT_CONFIGURED",
    }),
    expectedXaiModelId: "grok-4.5",
    xaiExpected: false,
  });
  assert.equal(optionalGrokAbsent.verified, true);

  const expectedGrokAbsent = evaluateStagedExternalAiRuntimeTruth({
    payload: externalAiPayload({
      includeOpenai: true,
      grokConfigured: false,
      grokVerification: "not_configured",
      grokVerificationCode: "NOT_CONFIGURED",
    }),
    expectedXaiModelId: "grok-4.5",
    xaiExpected: true,
  });
  assert.equal(expectedGrokAbsent.verified, false);

  const failedOpenai = evaluateStagedExternalAiRuntimeTruth({
    payload: externalAiPayload({
      includeOpenai: true,
      openaiConfigured: true,
      openaiVerification: "failed",
      openaiVerificationCode: "EXTERNAL_PROVIDER_AUTH_FAILED",
    }),
    expectedXaiModelId: "grok-4.5",
  });
  assert.equal(failedOpenai.verified, false, "configured-but-failed OpenAI must never pass");

  const failedGrok = evaluateStagedExternalAiRuntimeTruth({
    payload: externalAiPayload({
      includeOpenai: true,
      openaiConfigured: true,
      openaiVerification: "verified",
      openaiVerificationCode: "MODEL_ACCESS_VERIFIED",
      grokVerification: "failed",
      grokVerificationCode: "EXTERNAL_PROVIDER_AUTH_FAILED",
    }),
    expectedXaiModelId: "grok-4.5",
  });
  assert.equal(failedGrok.verified, false, "Grok is required and failed Grok must block cutover");

  const unexplainedDegraded = evaluateStagedExternalAiRuntimeTruth({
    payload: externalAiPayload({
      includeOpenai: true,
      openaiConfigured: true,
      openaiVerification: "verified",
      openaiVerificationCode: "MODEL_ACCESS_VERIFIED",
      topLevelVerification: "degraded",
    }),
    expectedXaiModelId: "grok-4.5",
  });
  assert.equal(
    unexplainedDegraded.verified,
    false,
    "top-level degraded is allowed only when optional OpenAI is not configured",
  );

  assert.match(envGovernanceSource, /providers=openai,grok/u);
  assert.match(envGovernanceSource, /dual-public-alias-read-only-probe/u);
  assert.match(envGovernanceSource, /PRODUCTION_REPAIR_XAI_GITHUB_SECRET_REQUIRED/u);
  assert.match(envGovernanceSource, /method:\s*"DELETE"/u);
  assert.match(envGovernanceSource, /\/v10\/projects\/\$\{encodeURIComponent\(projectId\)\}\/env\/\$\{encodeURIComponent\(recordId\)\}/u);
  assert.doesNotMatch(envGovernanceSource, /"env", "rm"/u);
  assert.match(envGovernanceSource, /PRODUCTION_REPAIR_OPENAI_RECORD_FINGERPRINT_CHANGED/u);
  assert.match(envGovernanceSource, /credential_not_configured_pending_staged_deployment/u);
}

function testConcurrency() {
  const global = workflow.slice(0, workflow.indexOf("\njobs:"));
  assert.match(global, /vercel-production-main/u);
  assert.match(global, /cancel-in-progress:[^\n]*!\(\(/u);
  assert.match(global, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/u);
  const productionPolicy = { group: "vercel-production-main", cancelInProgress: false };
  const commitA = { ...productionPolicy, phase: "alias-cutover" };
  const commitB = { ...productionPolicy, phase: "queued" };
  assert.equal(commitA.group, commitB.group);
  assert.equal(commitB.cancelInProgress, false);
  assert.equal(commitA.phase, "alias-cutover");
}

async function testBoundedTimeoutsAndRollbackBudget() {
  const neverResolvingFetch = () => new Promise(() => {});
  const startedAt = Date.now();
  await assert.rejects(
    verifyProductionPublicCutover({
      aliases: ["primary.example", "mirror.example"],
      expectedCommit: "d".repeat(40),
      expectedReleaseTag: "novel-ai-p24b-conversation-first-studio-rc6",
      expectedReleaseRevision: "rc6.1",
      fetcher: neverResolvingFetch,
      fetchTimeoutMs: 20,
      deadlineAt: Date.now() + 100,
    }),
    (error) => error.code === "PUBLIC_GATE_FETCH_TIMEOUT",
  );
  assert.ok(Date.now() - startedAt < 500, "never-resolving public fetch must be bounded");

  const reader = createVercelControlPlaneReader({
    token: "test-token",
    teamId: "team_expected",
    projectId: "prj_expected",
    fetchImpl: neverResolvingFetch,
    fetchTimeoutMs: 20,
    deadlineAt: Date.now() + 100,
  });
  await assert.rejects(
    reader("primary.example"),
    (error) => error.code === "VERCEL_CONTROL_PLANE_FETCH_TIMEOUT",
  );
  const setter = createVercelAliasSetter({
    token: "test-token",
    teamId: "team_expected",
    fetchImpl: neverResolvingFetch,
    fetchTimeoutMs: 20,
    deadlineAt: Date.now() + 100,
  });
  await assert.rejects(
    setter("dpl_timeout.vercel.app", "primary.example", "test", {
      deadlineAt: Date.now() + 100,
    }),
    (error) => error.code === "VERCEL_ALIAS_SET_TIMEOUT",
  );
  await assert.rejects(
    readVercelProjectIdentity({
      token: "test-token",
      teamId: "team_expected",
      projectId: "prj_expected",
      fetcher: neverResolvingFetch,
      fetchTimeoutMs: 20,
      deadlineAt: Date.now() + 100,
    }),
    (error) => error.code === "PRODUCTION_AUDIT_PROJECT_LOOKUP_TIMEOUT",
  );
  await assert.rejects(
    readVercelProductionEnvironmentMetadata({
      token: "test-token",
      teamId: "team_expected",
      projectId: "prj_expected",
      fetcher: neverResolvingFetch,
      fetchTimeoutMs: 20,
      deadlineAt: Date.now() + 100,
    }),
    (error) => error.code === "PRODUCTION_AUDIT_ENV_METADATA_TIMEOUT",
  );
  const fixture = readyProduction();
  const supabaseTimeout = await verifySupabaseProductionCredential({
    production: fixture.production,
    expectedProjectRef: fixture.projectRef,
    fetcher: neverResolvingFetch,
    fetchTimeoutMs: 20,
    deadlineAt: Date.now() + 100,
  });
  assert.equal(supabaseTimeout.verified, false);
  assert.equal(supabaseTimeout.failureCode, "SUPABASE_SERVICE_CREDENTIAL_REST_TIMEOUT");
  await assert.rejects(
    upsertSensitiveProductionEnvironment({
      token: "test-token",
      teamId: "team_expected",
      projectId: "prj_expected",
      key: "SUPABASE_SERVICE_ROLE_KEY",
      value: "secret-value-with-sufficient-length",
      fetcher: neverResolvingFetch,
      fetchTimeoutMs: 20,
      deadlineAt: Date.now() + 100,
    }),
    (error) => error.code === "VERCEL_SENSITIVE_ENV_UPSERT_TIMEOUT",
  );

  const rollbackRequests = [];
  const transactionDeadlineAt = Date.now() + 200;
  const transactionalSetter = createVercelAliasSetter({
    token: "test-token",
    teamId: "team_expected",
    fetchTimeoutMs: 20,
    deadlineAt: transactionDeadlineAt,
    fetchImpl: (rawUrl) => {
      const path = decodeURIComponent(new URL(String(rawUrl)).pathname);
      if (path.includes("dpl_Stage.vercel.app")) return new Promise(() => {});
      rollbackRequests.push(path);
      return new Response("{}", { status: 200 });
    },
  });
  const beforeIdentity = {
    deploymentId: "dpl_Before",
    appCommit: "e".repeat(40),
  };
  await assert.rejects(
    promoteDualAliases({
      primaryAlias: "primary.example",
      mirrorAlias: "mirror.example",
      stagedTarget: "dpl_Stage.vercel.app",
      stagedIdentity: { deploymentId: "dpl_Stage", appCommit: "d".repeat(40) },
      primaryBeforeIdentity: beforeIdentity,
      mirrorBeforeIdentity: beforeIdentity,
      setAlias: transactionalSetter,
      readIdentity: async () => ({ ...beforeIdentity, provenanceStatus: "verified" }),
      verifyAttempts: 1,
      verifyDelayMs: 0,
      deadlineAt: transactionDeadlineAt,
      rollbackReserveMs: 100,
      logger: { log() {}, error() {} },
    }),
    (error) => error.code === "DUAL_ALIAS_CUTOVER_ROLLED_BACK",
  );
  assert.equal(rollbackRequests.length, 2, "timed-out promotion must restore both aliases");

  const aliasJob = jobSection("alias_cutover");
  for (const marker of [
    "CUTOVER_DEADLINE_MS: 360000",
    "CUTOVER_ROLLBACK_RESERVE_MS: 180000",
    "POST_CUTOVER_DEADLINE_MS: 180000",
    "ROLLBACK_DEADLINE_MS: 240000",
  ]) assert.ok(aliasJob.includes(marker), `deadline budget missing: ${marker}`);
  const worstCaseSuccessThenCompensationMs =
    60_000 // current-alias capture
    + 30_000 // Last Known Good discovery
    + 60_000 // rollback-target selection
    + (360_000 - 180_000) // cutover promotion window; reserve is unavailable to promotion
    + 180_000 // public verification
    + 240_000; // compensating restore
  assert.ok(
    worstCaseSuccessThenCompensationMs <= (20 * 60_000) - 300_000,
    "alias job must reserve at least five minutes beyond bounded operations",
  );
  assert.match(aliasJob, /timeout-minutes:\s*20/u);
  assert.match(publicGateSource, /boundedFetch/u);
  assert.match(publicGateSource, /boundedOperation/u);
  assert.match(envGovernanceSource, /PRODUCTION_AUDIT_PROJECT_LOOKUP_TIMEOUT/u);
}

function deploymentPayload(deploymentId, appCommit, deploymentUrl) {
  return {
    id: deploymentId,
    projectId: "prj_expected",
    teamId: "team_expected",
    readyState: "READY",
    target: "production",
    url: deploymentUrl,
    meta: { githubCommitSha: appCommit },
  };
}

function rollbackFetcher(validDeploymentIds) {
  const commits = new Map(validDeploymentIds.map(([id, commit]) => [id, commit]));
  return async (rawUrl) => {
    const url = new URL(String(rawUrl));
    if (url.hostname === "api.vercel.com") {
      const id = decodeURIComponent(url.pathname.split("/").pop());
      const commit = commits.get(id);
      if (!commit) return new Response(JSON.stringify({ error: "missing" }), { status: 404 });
      return new Response(JSON.stringify(deploymentPayload(id, commit, `${id}.vercel.app`)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const observedId = url.hostname.split(".")[0];
    const [id, commit] = [...commits.entries()]
      .find(([candidate]) => candidate.toLowerCase() === observedId.toLowerCase()) || [];
    return new Response(JSON.stringify({
      deploymentId: id,
      appCommit: commit,
      provenanceStatus: "verified",
      environment: "production",
    }), { status: commit ? 200 : 404, headers: { "content-type": "application/json" } });
  };
}

async function testLastKnownGoodAndRollback() {
  const currentCommit = "a".repeat(40);
  const lkgCommit = "b".repeat(40);
  const emergencyCommit = "c".repeat(40);
  const lkg = createLastKnownGoodProductionIdentity({
    primaryDeploymentId: "dpl_LkgPrimary",
    mirrorDeploymentId: "dpl_LkgMirror",
    appCommit: lkgCommit,
    releaseTag: "novel-ai-p24b-conversation-first-studio-rc6",
    releaseRevision: "rc6.1",
    verifiedAt: "2026-08-10T00:00:00.000Z",
  });
  assert.deepEqual(validateLastKnownGoodProductionIdentity(lkg), lkg);
  assert.throws(
    () => validateLastKnownGoodProductionIdentity({ ...lkg, appCommit: currentCommit }),
    (error) => error.code === "LAST_KNOWN_GOOD_DIGEST_INVALID",
  );

  const common = {
    token: "test-token",
    teamId: "team_expected",
    projectId: "prj_expected",
  };
  const current = {
    primaryDeploymentId: "dpl_CurrentPrimary",
    primaryAppCommit: currentCommit,
    mirrorDeploymentId: "dpl_CurrentMirror",
    mirrorAppCommit: currentCommit,
  };
  const emergency = {
    primaryDeploymentId: "dpl_Emergency",
    primaryAppCommit: emergencyCommit,
    mirrorDeploymentId: "dpl_Emergency",
    mirrorAppCommit: emergencyCommit,
  };
  const allValid = rollbackFetcher([
    ["dpl_CurrentPrimary", currentCommit],
    ["dpl_CurrentMirror", currentCommit],
    ["dpl_LkgPrimary", lkgCommit],
    ["dpl_LkgMirror", lkgCommit],
    ["dpl_Emergency", emergencyCommit],
  ]);
  const selectedCurrent = await selectVerifiedRollbackTarget({
    current,
    lastKnownGood: lkg,
    emergency,
    ...common,
    fetcher: allValid,
  });
  assert.equal(selectedCurrent.source, "current-transaction-capture");

  const lkgFallback = await selectVerifiedRollbackTarget({
    current,
    lastKnownGood: lkg,
    emergency,
    ...common,
    fetcher: rollbackFetcher([
      ["dpl_LkgPrimary", lkgCommit],
      ["dpl_LkgMirror", lkgCommit],
      ["dpl_Emergency", emergencyCommit],
    ]),
  });
  assert.equal(lkgFallback.source, "last-known-good");
  assert.match(lkgSource, /current-transaction-capture[\s\S]*last-known-good[\s\S]*emergency-static/u);

  const artifact = await discoverLatestLastKnownGoodArtifact({
    repository: "bobobo-org/novel",
    token: "test-token",
    fetcher: async (rawUrl) => {
      const url = String(rawUrl);
      if (url.includes("/actions/artifacts")) {
        return new Response(JSON.stringify({ artifacts: [{
          id: 7,
          name: `production-last-known-good-${lkgCommit}`,
          expired: false,
          created_at: "2026-08-10T01:00:00.000Z",
          workflow_run: { id: 9, head_branch: "main", head_sha: lkgCommit },
        }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        conclusion: "success",
        event: "push",
        head_branch: "main",
        head_sha: lkgCommit,
        path: ".github/workflows/deploy.yml",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(artifact.runId, 9);
  const rejectedFailedRun = await discoverLatestLastKnownGoodArtifact({
    repository: "bobobo-org/novel",
    token: "test-token",
    fetcher: async (rawUrl) => String(rawUrl).includes("/actions/artifacts")
      ? new Response(JSON.stringify({ artifacts: [{
        id: 7,
        name: `production-last-known-good-${lkgCommit}`,
        expired: false,
        created_at: "2026-08-10T01:00:00.000Z",
        workflow_run: { id: 9, head_branch: "main", head_sha: lkgCommit },
      }] }), { status: 200, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ conclusion: "failure" }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  assert.equal(rejectedFailedRun, null);

  const artifactPages = [];
  const paginatedArtifact = await discoverLatestLastKnownGoodArtifact({
    repository: "bobobo-org/novel",
    token: "test-token",
    fetcher: async (rawUrl) => {
      const url = new URL(String(rawUrl));
      if (url.pathname.endsWith("/actions/artifacts")) {
        const page = Number(url.searchParams.get("page"));
        artifactPages.push(page);
        if (page === 1) {
          return Response.json({
            total_count: 101,
            artifacts: Array.from({ length: 100 }, (_, index) => ({
              id: index + 1,
              name: `unrelated-artifact-${index + 1}`,
              expired: false,
              created_at: "2026-08-10T02:00:00.000Z",
              workflow_run: { id: index + 1, head_branch: "main", head_sha: lkgCommit },
            })),
          });
        }
        return Response.json({
          total_count: 101,
          artifacts: [{
            id: 777,
            name: `production-last-known-good-${lkgCommit}`,
            expired: false,
            created_at: "2026-08-10T01:00:00.000Z",
            workflow_run: { id: 999, head_branch: "main", head_sha: lkgCommit },
          }],
        });
      }
      return Response.json({
        conclusion: "success",
        event: "push",
        head_branch: "main",
        head_sha: lkgCommit,
        path: ".github/workflows/deploy.yml",
      });
    },
  });
  assert.equal(paginatedArtifact.artifactId, 777);
  assert.deepEqual(artifactPages, [1, 2]);
  assert.match(lkgSource, /maximumPages = 10/u);
  assert.match(lkgSource, /searchParams\.set\("page"/u);

  const corrupt = parseLastKnownGoodCandidate('{"schemaVersion":"tampered"}');
  assert.equal(corrupt.candidate, null);
  assert.ok(corrupt.rejectionCode);
  const discoveryFailure = await safeDiscoverLatestLastKnownGoodArtifact({
    repository: "bobobo-org/novel",
    token: "test-token",
    fetchTimeoutMs: 20,
    deadlineAt: Date.now() + 100,
    fetcher: () => new Promise(() => {}),
  });
  assert.equal(discoveryFailure.artifact, null);
  assert.ok(discoveryFailure.rejectionCode);

  const emergencyOnly = await selectVerifiedRollbackTarget({
    current: null,
    lastKnownGood: corrupt.candidate,
    emergency,
    ...common,
    fetcher: rollbackFetcher([["dpl_Emergency", emergencyCommit]]),
    fetchTimeoutMs: 20,
    candidateTimeoutMs: 50,
    deadlineAt: Date.now() + 200,
  });
  assert.equal(emergencyOnly.source, "emergency-static");

  const aliasJob = jobSection("alias_cutover");
  assert.match(aliasJob, /Write Last Known Good only after public verification passes/u);
  assert.match(aliasJob, /if:\s*steps\.cutover\.outcome == 'success' && steps\.public_gate\.outcome == 'success'/u);
  assert.match(aliasJob, /Download latest Last Known Good identity[\s\S]*continue-on-error:\s*true/u);
  assert.match(lkgSource, /safeDiscoverLatestLastKnownGoodArtifact/u);
  assert.match(lkgSource, /parseLastKnownGoodCandidate/u);
}

function testActualMutationReceipt() {
  const apiKey = "xai-test-key-with-sufficient-length-123456";
  const modelOnly = planXaiProductionChanges({
    production: { XAI_API_KEY: apiKey, XAI_MODEL_ID: "grok-old" },
    configuration: {
      apiKey,
      modelId: "grok-4.5",
      credentialSource: "github_secret",
    },
    allowedMutationKeys: ["XAI_MODEL_ID"],
  });
  assert.deepEqual(modelOnly, ["XAI_MODEL_ID"]);
  assert.throws(
    () => planXaiProductionChanges({
      production: { XAI_API_KEY: "different-key-with-sufficient-length", XAI_MODEL_ID: "grok-old" },
      configuration: { apiKey, modelId: "grok-4.5", credentialSource: "github_secret" },
      allowedMutationKeys: ["XAI_MODEL_ID"],
    }),
    (error) => error.code === "XAI_UNAUDITED_PRODUCTION_DRIFT",
  );
  assert.deepEqual(restrictSupabaseProductionChanges({
    productionChanges: ["NEXT_PUBLIC_SUPABASE_URL"],
    allowedMutationKeys: ["NEXT_PUBLIC_SUPABASE_URL"],
  }), ["NEXT_PUBLIC_SUPABASE_URL"]);
  assert.throws(
    () => restrictSupabaseProductionChanges({
      productionChanges: ["SUPABASE_SERVICE_ROLE_KEY"],
      allowedMutationKeys: ["NEXT_PUBLIC_SUPABASE_URL"],
    }),
    (error) => error.code === "SUPABASE_UNAUDITED_PRODUCTION_DRIFT",
  );

  const fixture = readyProduction();
  const before = auditProductionEnvironment({
    production: { ...fixture.production, XAI_API_KEY: apiKey, XAI_MODEL_ID: "grok-old" },
    expectedProjectRef: fixture.projectRef,
    githubXaiApiKey: apiKey,
    expectedXaiModelId: "grok-4.5",
    projectIdentity: fixture.projectIdentity,
    supabaseCredentialVerification: fixture.supabaseCredentialVerification,
    vercelEnvironmentMetadata: fixture.vercelEnvironmentMetadata,
  });
  const after = auditProductionEnvironment({
    production: { ...fixture.production, XAI_API_KEY: apiKey, XAI_MODEL_ID: "grok-4.5" },
    expectedProjectRef: fixture.projectRef,
    githubXaiApiKey: apiKey,
    expectedXaiModelId: "grok-4.5",
    projectIdentity: fixture.projectIdentity,
    supabaseCredentialVerification: fixture.supabaseCredentialVerification,
    vercelEnvironmentMetadata: fixture.vercelEnvironmentMetadata,
  });
  const receipt = createEnvironmentRepairReceipt({
    before,
    after,
    actualChangedKeys: modelOnly,
  });
  assert.equal(receipt.mutationCount, 1);
  assert.equal(receipt.changedKeysCount, 1);
  assert.deepEqual(receipt.changedKeys, ["XAI_MODEL_ID"]);
  assert.doesNotMatch(JSON.stringify(receipt), new RegExp(apiKey, "u"));
  assert.equal(receipt.secretValuesStored, false);
  assert.throws(
    () => createEnvironmentRepairReceipt({
      before,
      after,
      actualChangedKeys: ["XAI_API_KEY"],
    }),
    (error) => error.code === "PRODUCTION_REPAIR_UNAUDITED_MUTATION",
  );
  assert.match(envGovernanceSource, /actualChangedKeys/u);
}

function testPreviewPolicy() {
  const top = workflow.slice(0, workflow.indexOf("\njobs:"));
  const preview = jobSection("preview");
  assert.doesNotMatch(top, /agent\/p24b-rc6-conversation-first/u);
  assert.match(top, /preview_ref:/u);
  assert.match(preview, /head\.repo\.full_name == github\.repository/u);
  const validate = jobSection("validate");
  assert.match(validate, /pull_request\.head\.sha \|\| github\.event_name == 'workflow_dispatch' && inputs\.preview_ref \|\| github\.sha/u);
  assert.match(validate, /ref:\s*\$\{\{ env\.VERCEL_GIT_COMMIT_SHA \}\}/u);
  assert.match(validate, /--arg headSha "\$VERCEL_GIT_COMMIT_SHA"/u);
  assert.match(validate, /p24b-rc6-validation-\$\{\{ env\.VERCEL_GIT_COMMIT_SHA \}\}/u);
  assert.match(preview, /\^\[a-f0-9\]\{40\}\$/u);
  assert.match(preview, /environment=preview/u);
  assert.doesNotMatch(preview, /--prod|PRIMARY_ALIAS|MIRROR_ALIAS|vercel-dual-alias/u);
}

const publicWorkerFixture = [
  "LEARNING_FILE_MAGIC_MISMATCH",
  "splitManualLearningDocumentSemantically",
  "LEARNING_WORKER_DUPLICATE_REQUEST",
  "prepare_import_file",
  "manual-learning-worker-protocol-v2",
  "",
].join("\n").padEnd(500_100, "x");

function publicFetcher({ badAsset = false, badWorker = false, mirrorWorkerMismatch = false } = {}) {
  return async (rawUrl) => {
    const url = new URL(String(rawUrl));
    if (url.pathname === "/api/release/identity") return Response.json({
      appCommit: "d".repeat(40),
      deploymentId: "dpl_Public",
      releaseTag: "novel-ai-p24b-conversation-first-studio-rc6",
      releaseRevision: "rc6.1",
      environment: "production",
      provenanceStatus: "verified",
    });
    if (url.pathname === "/api/ai/health") return Response.json({
      appCommit: "d".repeat(40),
      releaseTag: "novel-ai-p24b-conversation-first-studio-rc6",
      releaseRevision: "rc6.1",
      commitProvenanceStatus: "verified",
    });
    if (url.pathname === "/api/persistence/sync/health") return Response.json({
      status: "ready",
      migrationVersion: "cloud_sync_e2ee_storage_001",
      schemaVersion: "novel-cloud-sync-e2ee-v1",
      storageBackend: "private-object-storage",
      provider: "Supabase",
    });
    if (url.pathname === "/studio") {
      return new Response('<html><link rel="stylesheet" href="/_next/static/app.css"><script src="/_next/static/app.js"></script></html>', {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (url.pathname === "/generated/manual-learning-worker.js") {
      const source = badWorker
        ? "<!doctype html><html>fallback</html>"
        : `${publicWorkerFixture}${mirrorWorkerMismatch && url.hostname === "mirror.example" ? "mirror" : ""}`;
      return new Response(source, {
        status: 200,
        headers: { "content-type": badWorker ? "text/html" : "application/javascript; charset=utf-8" },
      });
    }
    if (url.pathname.endsWith(".css")) {
      return new Response(badAsset ? "<html>fallback</html>" : "body{}", {
        status: 200,
        headers: { "content-type": badAsset ? "text/html" : "text/css" },
      });
    }
    if (url.pathname.endsWith(".js")) {
      return new Response("export{}", { status: 200, headers: { "content-type": "application/javascript" } });
    }
    return new Response("missing", { status: 404 });
  };
}

async function testPublicVerificationAndCompensation() {
  const options = {
    aliases: ["primary.example", "mirror.example"],
    expectedCommit: "d".repeat(40),
    expectedReleaseTag: "novel-ai-p24b-conversation-first-studio-rc6",
    expectedReleaseRevision: "rc6.1",
  };
  const report = await verifyProductionPublicCutover({ ...options, fetcher: publicFetcher() });
  assert.equal(report.status, "PASS");
  assert.ok(report.aliases.every((alias) =>
    alias.assetSummary.missing === 0
    && alias.assetSummary.htmlFallback === 0
    && alias.assetSummary.mimeMismatch === 0));
  assert.ok(report.aliases.every((alias) =>
    alias.workerAsset.reference === "/generated/manual-learning-worker.js"
    && alias.workerAsset.bytes >= 500_000
    && /^[a-f0-9]{64}$/u.test(alias.workerAsset.digest)
    && alias.workerAsset.contentType.includes("javascript")));
  await assert.rejects(
    verifyProductionPublicCutover({ ...options, fetcher: publicFetcher({ badAsset: true }) }),
    (error) => error.code === "POST_CUTOVER_PUBLIC_VERIFICATION_FAILED"
      && error.report.findings.some((entry) => entry.code === "HTML_FALLBACK"),
  );
  await assert.rejects(
    verifyProductionPublicCutover({ ...options, fetcher: publicFetcher({ badWorker: true }) }),
    (error) => error.code === "POST_CUTOVER_PUBLIC_VERIFICATION_FAILED"
      && error.report.findings.some((entry) =>
        entry.surface === "manual-learning-worker" && entry.code === "HTML_FALLBACK"),
  );
  await assert.rejects(
    verifyProductionPublicCutover({ ...options, fetcher: publicFetcher({ mirrorWorkerMismatch: true }) }),
    (error) => error.code === "POST_CUTOVER_PUBLIC_VERIFICATION_FAILED"
      && error.report.findings.some((entry) =>
        entry.surface === "manual-learning-worker" && entry.code === "ALIAS_DIGEST_MISMATCH"),
  );

  const primary = "primary.example";
  const mirror = "mirror.example";
  const before = { deploymentId: "dpl_Before", appCommit: "e".repeat(40) };
  const failed = { deploymentId: "dpl_Failed", appCommit: "f".repeat(40) };
  const state = new Map([[primary, failed], [mirror, failed]]);
  await restoreDualAliases({
    primaryAlias: primary,
    mirrorAlias: mirror,
    primaryIdentity: before,
    mirrorIdentity: before,
    setAlias: async (target, alias) => state.set(alias, { ...before, deploymentId: target }),
    readIdentity: async (alias) => ({ ...state.get(alias), provenanceStatus: "verified" }),
    verifyAttempts: 1,
    verifyDelayMs: 0,
    logger: { log() {}, error() {} },
  });
  assert.deepEqual(state.get(primary), before);
  assert.deepEqual(state.get(mirror), before);
  const aliasJob = jobSection("alias_cutover");
  assert.match(aliasJob, /Compensating rollback after public verification failure/u);
  assert.match(aliasJob, /steps\.public_gate\.outcome != 'success'/u);
  assert.match(publicGateSource, /\/api\/release\/identity/u);
  assert.match(publicGateSource, /\/api\/ai\/health/u);
  assert.match(publicGateSource, /\/api\/persistence\/sync\/health/u);
  assert.match(publicGateSource, /\/studio/u);
  assert.match(publicGateSource, /generated\/manual-learning-worker\.js/u);
  assert.match(publicGateSource, /PUBLIC_GATE_WORKER_BODY_TIMEOUT/u);
  assert.match(publicGateSource, /prepare_import_file/u);
  assert.match(publicGateSource, /IMPORT_PREPARATION_MARKER_MISSING/u);
  assert.match(publicGateSource, /SEMANTIC_CHUNKING_MARKER_MISSING/u);
  assert.match(publicGateSource, /manual-learning-worker-protocol-v2/u);
  assert.match(publicGateSource, /PROTOCOL_MARKER_MISSING/u);
  assert.match(publicGateSource, /ALIAS_DIGEST_MISMATCH/u);
}

const cases = {
  "production-env-no-mutation-before-validation": [testOrdering, testEnvironmentAuditAndRepair],
  "production-env-readonly-audit": [testEnvironmentAuditAndRepair, testExternalAiProductionTruth],
  "production-env-repair-after-validation": [testOrdering, testEnvironmentAuditAndRepair],
  "production-deployment-serialization": [testOrdering, testConcurrency],
  "production-second-push-cannot-cancel-cutover": [testConcurrency],
  "deployment-timeout-compensation-budget": [testBoundedTimeoutsAndRollbackBudget],
  "last-known-good": [testLastKnownGoodAndRollback],
  "rollback-target-verification": [testLastKnownGoodAndRollback],
  "failed-release-does-not-replace-lkg": [testLastKnownGoodAndRollback],
  "lkg-candidate-failure-fallback": [testLastKnownGoodAndRollback],
  "dual-alias-rollback-race": [testConcurrency, testLastKnownGoodAndRollback, testPublicVerificationAndCompensation],
  "preview-trusted-ref-policy": [testPreviewPolicy],
  "preview-cannot-mutate-production": [testPreviewPolicy],
  "post-cutover-public-verification": [testPublicVerificationAndCompensation],
  "post-cutover-compensating-rollback": [testPublicVerificationAndCompensation],
  "production-env-actual-mutation-receipt": [testActualMutationReceipt],
  "staged-prebuilt-file-references": [testOrdering, testPrebuiltFileReferences],
  all: [
    testOrdering,
    testPrebuiltFileReferences,
    testEnvironmentAuditAndRepair,
    testExternalAiProductionTruth,
    testConcurrency,
    testBoundedTimeoutsAndRollbackBudget,
    testLastKnownGoodAndRollback,
    testActualMutationReceipt,
    testPreviewPolicy,
    testPublicVerificationAndCompensation,
  ],
};

const selected = process.argv[2] || "all";
if (!cases[selected]) throw new Error(`UNKNOWN_RC6_1_DEPLOYMENT_CASE:${selected}`);
for (const test of [...new Set(cases[selected])]) await test();
console.log(JSON.stringify({
  schemaVersion: "p24b-rc6-1-deployment-governance-tests-v1",
  status: "PASS",
  case: selected,
  blockingSkipCount: 0,
}, null, 2));

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const WORKFLOW_URL = new URL("../.github/workflows/deploy.yml", import.meta.url);
const PACKAGE_URL = new URL("../package.json", import.meta.url);
const VERCEL_URL = new URL("../vercel.json", import.meta.url);
const RECOVERY_CONTROL = "9cd074f239b73dd9b61f6d758fcf97fbd809face";
const VERCEL_DEPLOYMENTS_ENDPOINT = "https://api.vercel.com/v6/deployments";
const VERCEL_DEPLOYMENT_PAGE_LIMIT = 100;
const VERCEL_DEPLOYMENT_MAX_PAGES = 25;
const VERCEL_DEPLOYMENT_FETCH_TIMEOUT_MS = 20_000;
const MODES = new Set([
  "all",
  "auto-deploy",
  "no-stale-sha-gate",
  "full-production-dag",
  "exact-product-identity",
  "alias-cutover",
  "no-duplicate-production-deploy",
]);
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

function fail(code, { retryable = false } = {}) {
  const error = new Error(code);
  error.code = code;
  error.retryable = retryable;
  return error;
}

function parseBoundedInteger(value, name, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(String(value ?? ""))) throw fail(`${name}_INVALID`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw fail(`${name}_INVALID`);
  }
  return parsed;
}

function deploymentCreatedAt(deployment) {
  const numeric = Number(deployment?.created);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(deployment?.createdAt ?? "");
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

async function collectVercelDeploymentPages({
  fetchImplementation,
  token,
  projectId,
  teamId,
  sinceMs,
  untilMs,
  pageLimit = VERCEL_DEPLOYMENT_PAGE_LIMIT,
  maxPages = VERCEL_DEPLOYMENT_MAX_PAGES,
}) {
  assert.equal(typeof fetchImplementation, "function");
  assert.equal(pageLimit, VERCEL_DEPLOYMENT_PAGE_LIMIT);
  assert.ok(Number.isSafeInteger(maxPages) && maxPages >= 1 && maxPages <= VERCEL_DEPLOYMENT_MAX_PAGES);
  assert.ok(Number.isSafeInteger(sinceMs) && Number.isSafeInteger(untilMs) && sinceMs < untilMs);

  const deployments = [];
  const deploymentIds = new Set();
  const visitedCursors = new Set();
  let cursor = untilMs;
  let pageCount = 0;
  let paginationComplete = false;

  while (pageCount < maxPages) {
    if (visitedCursors.has(cursor)) throw fail("VERCEL_DEPLOYMENT_PAGINATION_CURSOR_LOOP");
    visitedCursors.add(cursor);

    const query = new URL(VERCEL_DEPLOYMENTS_ENDPOINT);
    query.searchParams.set("projectId", projectId);
    query.searchParams.set("teamId", teamId);
    query.searchParams.set("target", "production");
    query.searchParams.set("limit", String(pageLimit));
    query.searchParams.set("since", String(sinceMs));
    query.searchParams.set("until", String(cursor));

    let response;
    let payload;
    try {
      response = await fetchImplementation(query, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(VERCEL_DEPLOYMENT_FETCH_TIMEOUT_MS),
      });
      if (!response?.ok) throw new Error("non-success response");
      payload = await response.json();
    } catch {
      throw fail("VERCEL_DEPLOYMENT_PAGE_FETCH_FAILED");
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)
      || !Array.isArray(payload.deployments)
      || payload.deployments.length > pageLimit
      || !payload.pagination || typeof payload.pagination !== "object"
      || Array.isArray(payload.pagination)
      || !Object.hasOwn(payload.pagination, "next")) {
      throw fail("VERCEL_DEPLOYMENT_PAGE_SCHEMA_INVALID");
    }

    pageCount += 1;
    for (const deployment of payload.deployments) {
      const deploymentId = deployment?.uid;
      if (typeof deploymentId !== "string" || !/^dpl_[A-Za-z0-9]{8,96}$/u.test(deploymentId)) {
        throw fail("VERCEL_DEPLOYMENT_ID_INVALID");
      }
      if (deploymentIds.has(deploymentId)) throw fail("VERCEL_DEPLOYMENT_PAGE_OVERLAP_DETECTED");
      deploymentIds.add(deploymentId);
      deployments.push(deployment);
    }

    const next = payload.pagination.next;
    if (next === null) {
      paginationComplete = true;
      break;
    }
    const nextCursor = parseBoundedInteger(next, "VERCEL_DEPLOYMENT_PAGINATION_CURSOR", {
      minimum: sinceMs,
      maximum: untilMs,
    });
    if (nextCursor >= cursor || visitedCursors.has(nextCursor)) {
      throw fail("VERCEL_DEPLOYMENT_PAGINATION_CURSOR_LOOP");
    }
    if (pageCount >= maxPages) throw fail("VERCEL_DEPLOYMENT_PAGINATION_TRUNCATED");
    cursor = nextCursor;
  }

  if (!paginationComplete) throw fail("VERCEL_DEPLOYMENT_PAGINATION_TRUNCATED");
  return { deployments, pageCount, paginationComplete };
}

async function verifyVercelProductionAuthority({
  fetchImplementation,
  token,
  projectId,
  teamId,
  expectedDeploymentId,
  expectedProductCommit,
  expectedControlCommit,
  expectedRunId,
  expectedRunAttempt,
  sinceMs,
  untilMs,
  schemaVersion,
  maxPages = VERCEL_DEPLOYMENT_MAX_PAGES,
}) {
  const pageResult = await collectVercelDeploymentPages({
    fetchImplementation,
    token,
    projectId,
    teamId,
    sinceMs,
    untilMs,
    maxPages,
  });
  const matches = pageResult.deployments.filter((deployment) => {
    const created = deploymentCreatedAt(deployment);
    return deployment?.target === "production"
      && deployment?.meta?.githubCommitSha === expectedProductCommit
      && Number.isFinite(created)
      && created >= sinceMs
      && created <= untilMs;
  });
  if (matches.length === 0) throw fail("PRODUCTION_DEPLOYMENT_NOT_YET_VISIBLE", { retryable: true });
  if (matches.length !== 1) throw fail("DUPLICATE_PRODUCTION_DEPLOYMENT_DETECTED");

  const deployment = matches[0];
  const state = String(deployment.readyState ?? deployment.state ?? "").toUpperCase();
  if (deployment.uid !== expectedDeploymentId
    || deployment.source !== "cli"
    || state !== "READY"
    || deployment.meta?.novelControlCommit !== expectedControlCommit
    || deployment.meta?.novelDeploymentAuthority !== "github-actions"
    || deployment.meta?.novelWorkflowRunId !== expectedRunId
    || deployment.meta?.novelWorkflowRunAttempt !== expectedRunAttempt) {
    throw fail("PRODUCTION_DEPLOYMENT_AUTHORITY_MISMATCH");
  }

  return {
    schemaVersion,
    status: "PASS",
    checkedAt: new Date().toISOString(),
    productCommit: expectedProductCommit,
    controlCommit: expectedControlCommit,
    deploymentId: deployment.uid,
    deploymentTarget: "production",
    deploymentState: state,
    deploymentSource: deployment.source,
    productionDeploymentAuthority: "github-actions",
    workflowRunId: expectedRunId,
    workflowRunAttempt: expectedRunAttempt,
    querySinceMs: sinceMs,
    queryUntilMs: untilMs,
    pageLimit: VERCEL_DEPLOYMENT_PAGE_LIMIT,
    paginationMaxPages: maxPages,
    pageCount: pageResult.pageCount,
    paginationComplete: pageResult.paginationComplete,
    queriedDeploymentCount: pageResult.deployments.length,
    matchingProductionDeploymentCount: 1,
    duplicateProductionDeploymentCount: 0,
    sanitized: true,
    rawApiBodyIncluded: false,
  };
}

function requiredEnvironment(name, pattern) {
  const value = process.env[name];
  if (typeof value !== "string" || !pattern.test(value)) throw fail(`${name}_INVALID`);
  return value;
}

async function runVercelProductionAuthorityCommand() {
  const receiptPath = requiredEnvironment("PRODUCTION_AUTHORITY_RECEIPT_PATH", /\S/u);
  const receipt = await verifyVercelProductionAuthority({
    fetchImplementation: globalThis.fetch,
    token: requiredEnvironment("VERCEL_TOKEN", /\S/u),
    projectId: requiredEnvironment("VERCEL_PROJECT_ID", /^[A-Za-z0-9_-]{3,128}$/u),
    teamId: requiredEnvironment("VERCEL_ORG_ID", /^[A-Za-z0-9_-]{3,128}$/u),
    expectedDeploymentId: requiredEnvironment("EXPECTED_DEPLOYMENT_ID", /^dpl_[A-Za-z0-9]{8,96}$/u),
    expectedProductCommit: requiredEnvironment("EXPECTED_PRODUCT_COMMIT", /^[a-f0-9]{40}$/u),
    expectedControlCommit: requiredEnvironment("EXPECTED_CONTROL_COMMIT", /^[a-f0-9]{40}$/u),
    expectedRunId: requiredEnvironment("EXPECTED_RUN_ID", /^[1-9][0-9]{0,19}$/u),
    expectedRunAttempt: requiredEnvironment("EXPECTED_RUN_ATTEMPT", /^[1-9][0-9]{0,9}$/u),
    sinceMs: parseBoundedInteger(process.env.QUERY_SINCE_MS, "QUERY_SINCE_MS", { minimum: 1_000_000_000_000 }),
    untilMs: parseBoundedInteger(process.env.QUERY_UNTIL_MS, "QUERY_UNTIL_MS", { minimum: 1_000_000_000_000 }),
    schemaVersion: requiredEnvironment(
      "PRODUCTION_AUTHORITY_RECEIPT_SCHEMA",
      /^p24b-production-deployment-authority(?:-recheck)?-v[1-9][0-9]*$/u,
    ),
  });
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify({
    schemaVersion: "p24b-vercel-production-authority-verifier-result-v1",
    status: "PASS",
    pageCount: receipt.pageCount,
    paginationComplete: receipt.paginationComplete,
  })}\n`);
}

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

function requireNormalAndRecoveryGate(workflow, name) {
  const source = job(workflow, name);
  assert.match(source, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/u);
  assert.match(
    source,
    new RegExp(`github\\.sha == '${RECOVERY_CONTROL}'[^\\r\\n]*deploy-immutable-product-recovery`, "u"),
  );
  assert.doesNotMatch(source, /vars\.RC6_4_PRODUCT_COMMIT|RC6_4_PRODUCT_COMMIT\s*\|\|\s*'0{40}'/u);
}

function requireRecoveryOnlyStep(jobSource, name) {
  const source = step(jobSource, name);
  assert.match(source, /github\.event_name == 'workflow_dispatch'/u, `${name} must be manual recovery only`);
  assert.match(source, /inputs\.operation == 'deploy-immutable-product-recovery'/u,
    `${name} must require immutable recovery`);
  assert.doesNotMatch(source, /github\.event_name == 'push'/u,
    `${name} must not gate a normal main push`);
}

function verifyAutoDeploy(workflow) {
  assert.match(workflow, /^  push:\r?\n    branches:\r?\n      - main$/mu);
  assert.match(
    workflow,
    /^  PRODUCT_COMMIT:[^\r\n]*deploy-immutable-product-recovery[^\r\n]*github\.sha\s*\}\}$/mu,
  );
  assert.match(workflow, /^  CONTROL_COMMIT: \$\{\{ github\.sha \}\}$/mu);
  assert.match(
    workflow,
    /^  VERCEL_GIT_COMMIT_SHA:[^\r\n]*deploy-immutable-product-recovery[^\r\n]*github\.sha\s*\}\}$/mu,
  );
  for (const name of PRODUCTION_JOBS) requireNormalAndRecoveryGate(workflow, name);
  assert.match(workflow, /group:[^\r\n]*vercel-production-main/u);
  assert.match(workflow, /cancel-in-progress:[^\r\n]*github\.event_name == 'push'/u);
  const validate = job(workflow, "validate");
  assert.match(validate, /run-main-push-auto-deploy-workflow-contract\.mjs all/u);
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
}

function verifyNoStaleShaGate(workflow) {
  assert.doesNotMatch(workflow, /vars\.RC6_4_PRODUCT_COMMIT/u);
  assert.doesNotMatch(workflow, /^  RC6_4_PRODUCT_COMMIT:/mu);
  assert.doesNotMatch(workflow, /0000000000000000000000000000000000000000/u);
  for (const name of PRODUCTION_JOBS) {
    assert.doesNotMatch(job(workflow, name), /github\.sha\s*==\s*(?:vars\.|env\.)RC6_4_PRODUCT_COMMIT/u);
  }
  const validate = job(workflow, "validate");
  const alias = job(workflow, "alias_cutover");
  assert.doesNotMatch(validate, /^      release_database_id:/mu);
  for (const name of [
    "Verify immutable recovery release tag and GitHub Release",
    "Bind recovery GitHub Release database identity from immutable tag proof",
    "Verify recovery GitHub-signed immutable Release attestation",
    "Authorize exact peeled immutable recovery Product",
  ]) requireRecoveryOnlyStep(validate, name);
  for (const name of [
    "Re-verify immutable annotated release tag for Production evidence",
    "Rebind GitHub Release database identity from immutable tag proof",
    "Re-verify GitHub-signed immutable Release attestation",
    "Recheck immutable GitHub Release immediately before alias cutover",
    "Recheck GitHub-signed Release attestation immediately before alias cutover",
    "Final immutable GitHub Release recheck after public cutover",
    "Compensating rollback after immutable Release recheck failure",
    "Fail after immutable Release compensating rollback",
  ]) requireRecoveryOnlyStep(alias, name);
  const normalAuthorization = step(validate, "Authorize exact normal main Product from event SHA");
  assert.match(normalAuthorization, /if:\s*github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/u);
  for (const identity of ["PRODUCT_COMMIT", "CONTROL_COMMIT", "VERCEL_GIT_COMMIT_SHA", "GITHUB_WORKFLOW_SHA"]) {
    assert.match(normalAuthorization, new RegExp(`test "\\$${identity}" = "\\$GITHUB_SHA"`, "u"));
  }
  assert.doesNotMatch(normalAuthorization, /verify-immutable-release-tag|verify-github-release-attestation|release_database_id/u);
  for (const name of [
    "Final main-head CAS after public cutover",
    "Compensating rollback after final main-head CAS failure",
    "Write Last Known Good only after public verification passes",
    "Publish dynamic Last Known Good identity",
    "Create sanitized post-Production new-LUNA control-plane evidence",
    "Publish sanitized post-Production new-LUNA control-plane evidence",
    "Recheck main head after LKG and LUNA evidence publication",
    "Compensating rollback after post-cutover finalization failure",
    "Fail after main-head CAS compensating rollback",
    "Fail after post-cutover finalization reconciliation",
  ]) {
    assert.match(step(alias, name),
      /github\.event_name == 'push' \|\| steps\.immutable_tag_final\.outcome == 'success'/u,
      `${name} must not require immutable Release evidence for a normal main push`);
  }
  assert.match(alias, /production_authorization_mode=github-actions-main-sha/u);
  assert.match(alias, /production_authorization_proof_digest="\$production_authority_proof_digest"/u);
  assert.match(alias, /immutable_tag_proof_digest_json=null/u);
  assert.match(alias, /release_attestation_proof_digest_json=null/u);
  assert.doesNotMatch(alias, /production_authorization_mode=immutable-release-attestation/u);
}

function verifyFullProductionDag(workflow) {
  const closure = job(workflow, "main_push_complete");
  assert.match(closure, /if:\s*always\(\) && github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/u);
  for (const name of PRODUCTION_JOBS) {
    assert.match(closure, new RegExp(`^      - ${name}$`, "mu"), `main closure must need ${name}`);
  }
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
  ]) assert.match(closure, new RegExp(`\\$${result}`, "u"));
  assert.match(closure, /skipped_count=0[\s\S]*test "\$skipped_count" = 0/u);
  assert.match(closure, /for result in "\$\{results\[@\]\}"; do[\s\S]*test "\$result" = success/u);
  assert.match(closure, /MAIN_PUSH_AUTO_DEPLOYMENT_VERIFIED/u);
}

function verifyExactProductIdentity(workflow) {
  const validate = job(workflow, "validate");
  assert.match(validate, /Validate and export Product-owned release identity/u);
  assert.match(validate, /release-manifest\.json/u);
  assert.match(validate, /release-metadata-contract\.json/u);
  assert.match(validate, /generated\/release-provenance\.json/u);
  assert.match(validate, /verifyReleaseProvenance\(provenance\)/u);
  assert.match(validate, /provenance\.appCommit !== process\.env\.VERCEL_GIT_COMMIT_SHA/u);
  assert.match(validate, /provenance\.releaseProductCommit !== process\.env\.PRODUCT_COMMIT/u);
  for (const output of [
    "release_line", "release_tag", "release_revision", "release_name",
    "consumer_release", "architecture_stage", "provenance_hash",
  ]) assert.match(validate, new RegExp(`^      ${output}:`, "mu"));
  assert.doesNotMatch(validate, /^      release_database_id:/mu);
  assert.match(validate, /Authorize exact normal main Product from event SHA/u);
  for (const name of ["preview", "production_build", "staged_deploy", "runtime_gates", "alias_cutover"]) {
    const source = job(workflow, name);
    for (const output of [
      "release_line", "release_tag", "release_revision", "release_name", "consumer_release", "architecture_stage",
    ]) assert.match(source, new RegExp(`needs\\.validate\\.outputs\\.${output}`, "u"), `${name} ${output}`);
  }
  const normalClosure = job(workflow, "main_push_complete");
  for (const identity of ["PRODUCT_COMMIT", "CONTROL_COMMIT", "VERCEL_GIT_COMMIT_SHA"]) {
    assert.match(normalClosure, new RegExp(`test "\\$${identity}" = "\\$GITHUB_SHA"`, "u"));
  }
}

function verifyAliasCutover(workflow) {
  const audit = job(workflow, "audit_last_known_good");
  const runtime = job(workflow, "runtime_gates");
  const alias = job(workflow, "alias_cutover");
  assert.match(runtime, /for engine in webkit chromium/u);
  assert.match(alias, /timeout-minutes:\s*45/u);
  assert.match(audit, /Require cryptographic dynamic Last Known Good metadata for normal main push/u);
  assert.match(alias, /Require latest verified Last Known Good for normal cutover/u);
  const recoveryLkg = step(alias, "Require exact prior RC6.2 Last Known Good only for recovery cutover");
  assert.match(recoveryLkg, /if:\s*github\.event_name == 'workflow_dispatch'/u);
  assert.match(alias, /production-last-known-good\.mjs discover/u);
  assert.match(alias, /production-last-known-good\.mjs download/u);
  assert.match(alias, /production-last-known-good\.mjs select/u);
  assert.match(alias, /Cut over both aliases with atomic compensation/u);
  assert.match(alias, /Prepare exact Product checkout for post-cutover mobile proof/u);
  assert.match(alias, /Install locked Chromium and WebKit for post-cutover mobile proof/u);
  const publicGate = step(alias, "Verify both public aliases and their dynamic assets after cutover");
  assert.match(publicGate, /verify-production-public-cutover\.mjs/u);
  assert.match(publicGate, /run-mobile-consumer-experience\.mjs/u);
  assert.match(publicGate, /https:\/\/novel-orcin\.vercel\.app/u);
  assert.match(publicGate, /https:\/\/novel-lqtechs-projects\.vercel\.app/u);
  assert.match(publicGate, /MOBILE_BROWSER_ENGINE=chromium MOBILE_VIEWPORTS=390x844/u);
  assert.match(publicGate, /MOBILE_BROWSER_ENGINE=webkit MOBILE_VIEWPORTS=320x568/u);
  assert.ok(
    publicGate.indexOf("MOBILE_BROWSER_ENGINE=webkit MOBILE_VIEWPORTS=320x568")
      < publicGate.indexOf("MOBILE_BROWSER_ENGINE=chromium MOBILE_VIEWPORTS=390x844"),
    "post-cutover browser proof must run WebKit before the Chromium traffic sweep",
  );
  assert.match(publicGate, /timeout --signal=TERM --kill-after=30s 900s bash -c/u);
  assert.match(alias, /post-cutover-mobile-browser\.log/u);
  assert.match(alias, /Write Last Known Good only after public verification passes/u);
  assert.match(alias, /Publish dynamic Last Known Good identity/u);
  assert.doesNotMatch(recoveryLkg, /github\.event_name == 'push'/u);

  const rollbackGuard = job(workflow, "alias_cutover_rollback_guard");
  assert.match(rollbackGuard, /needs:\s*\[alias_cutover\]/u);
  assert.match(rollbackGuard, /needs\.alias_cutover\.result == 'failure'/u);
  assert.match(rollbackGuard, /needs\.alias_cutover\.result == 'cancelled'/u);
  assert.match(rollbackGuard, /production-last-known-good\.mjs discover/u);
  assert.match(rollbackGuard, /production-last-known-good\.mjs download/u);
  assert.match(rollbackGuard, /DISABLE_CURRENT_CAPTURE:\s*'true'/u);
  assert.match(rollbackGuard, /production-last-known-good\.mjs select/u);
  assert.match(rollbackGuard, /vercel-dual-alias-cutover\.mjs restore/u);
}

function verifyNoDuplicateProductionDeploy(workflow, vercel) {
  assert.equal(vercel.git?.deploymentEnabled, false);
  const exactCommands = workflow.match(/^\s*\{\s*pnpm exec vercel deploy --prebuilt --prod --skip-domain\b/gmu) ?? [];
  const allProductionCommands = workflow.match(/^\s*(?:\{\s*)?pnpm exec vercel deploy\b[^\r\n]*--prod\b/gmu) ?? [];
  assert.equal(exactCommands.length, 1);
  assert.equal(allProductionCommands.length, 1);
  const staged = job(workflow, "staged_deploy");
  const alias = job(workflow, "alias_cutover");
  assert.match(staged, /Verify single GitHub Actions Production deployment authority/u);
  assert.match(staged, /^      production_deploy_command_count:/mu);
  assert.match(staged, /^      duplicate_production_deploy_count:/mu);
  assert.match(staged, /productVercel\.git\?\.deploymentEnabled !== false/u);
  assert.match(staged, /controlVercel\.git\?\.deploymentEnabled !== false/u);
  assert.match(staged, /--meta "novelDeploymentAuthority=github-actions"/u);
  assert.match(staged, /--meta "novelWorkflowRunId=\$GITHUB_RUN_ID"/u);
  assert.match(
    staged,
    /node \.release-control\/scripts\/run-main-push-auto-deploy-workflow-contract\.mjs verify-vercel-production-authority/u,
  );
  assert.match(staged, /PRODUCTION_AUTHORITY_RECEIPT_SCHEMA="p24b-production-deployment-authority-v1"/u);
  assert.match(staged, /\.pageCount >= 1 and \.paginationComplete == true/u);
  assert.match(staged, /\.rawApiBodyIncluded' "\$receipt_path"\)" = false/u);
  assert.match(staged, /Upload sanitized Vercel Production deployment authority evidence/u);
  assert.match(alias, /Download sanitized staged Production deployment authority evidence/u);
  assert.match(alias, /Verify staged Production deployment authority receipt independently/u);
  assert.match(alias, /Recheck exact single Vercel Production deployment immediately before cutover/u);
  assert.match(
    alias,
    /node scripts\/run-main-push-auto-deploy-workflow-contract\.mjs verify-vercel-production-authority/u,
  );
  assert.match(alias, /PRODUCTION_AUTHORITY_RECEIPT_SCHEMA="p24b-production-deployment-authority-recheck-v1"/u);
  assert.match(alias, /\.pageCount >= 1 and \.paginationComplete == true/u);
  assert.match(alias, /Upload pre-cutover Production deployment authority recheck/u);
  const closure = job(workflow, "main_push_complete");
  assert.match(closure, /test "\$PRODUCTION_DEPLOY_COMMAND_COUNT" = 1/u);
  assert.match(closure, /test "\$PRODUCTION_DEPLOYMENT_AUTHORITY" = github-actions/u);
  assert.match(closure, /test "\$PRODUCTION_DEPLOYMENT_MATCH_COUNT" = 1/u);
  assert.match(closure, /test "\$DUPLICATE_PRODUCTION_DEPLOY_COUNT" = 0/u);
}

function fixtureDeployment({
  uid,
  productCommit,
  created,
  controlCommit,
  runId,
  runAttempt,
}) {
  return {
    uid,
    target: "production",
    source: "cli",
    readyState: "READY",
    created,
    meta: {
      githubCommitSha: productCommit,
      novelControlCommit: controlCommit,
      novelDeploymentAuthority: "github-actions",
      novelWorkflowRunId: runId,
      novelWorkflowRunAttempt: runAttempt,
    },
  };
}

function paginatedFetch(pages) {
  let index = 0;
  return async (url, options) => {
    assert.equal(url.searchParams.get("limit"), String(VERCEL_DEPLOYMENT_PAGE_LIMIT));
    assert.equal(url.searchParams.get("target"), "production");
    assert.match(options.headers.Authorization, /^Bearer \S+$/u);
    assert.ok(index < pages.length, "unexpected extra pagination request");
    const payload = pages[index];
    index += 1;
    return { ok: true, json: async () => payload };
  };
}

async function verifyPaginationMutationContracts() {
  const productCommit = "a".repeat(40);
  const controlCommit = "b".repeat(40);
  const expectedDeploymentId = "dpl_Expected1234";
  const sinceMs = 1_700_000_000_000;
  const untilMs = sinceMs + 10_000;
  const next = untilMs - 5_000;
  const common = {
    token: "test-token-never-printed",
    projectId: "prj_test",
    teamId: "team_test",
    expectedDeploymentId,
    expectedProductCommit: productCommit,
    expectedControlCommit: controlCommit,
    expectedRunId: "12345",
    expectedRunAttempt: "1",
    sinceMs,
    untilMs,
    schemaVersion: "p24b-production-deployment-authority-v1",
  };
  const expected = fixtureDeployment({
    uid: expectedDeploymentId,
    productCommit,
    created: sinceMs + 2_000,
    controlCommit,
    runId: common.expectedRunId,
    runAttempt: common.expectedRunAttempt,
  });
  const unrelated = fixtureDeployment({
    uid: "dpl_Unrelated1234",
    productCommit: "c".repeat(40),
    created: sinceMs + 8_000,
    controlCommit,
    runId: common.expectedRunId,
    runAttempt: common.expectedRunAttempt,
  });

  const positive = await verifyVercelProductionAuthority({
    ...common,
    fetchImplementation: paginatedFetch([
      { deployments: [unrelated], pagination: { next } },
      { deployments: [expected], pagination: { next: null } },
    ]),
  });
  assert.equal(positive.pageCount, 2);
  assert.equal(positive.paginationComplete, true);
  assert.equal(positive.matchingProductionDeploymentCount, 1);

  const duplicate = fixtureDeployment({
    uid: "dpl_Duplicate1234",
    productCommit,
    created: sinceMs + 1_000,
    controlCommit,
    runId: common.expectedRunId,
    runAttempt: common.expectedRunAttempt,
  });
  await assert.rejects(
    verifyVercelProductionAuthority({
      ...common,
      fetchImplementation: paginatedFetch([
        { deployments: [expected], pagination: { next } },
        { deployments: [duplicate], pagination: { next: null } },
      ]),
    }),
    /DUPLICATE_PRODUCTION_DEPLOYMENT_DETECTED/u,
  );
  await assert.rejects(
    verifyVercelProductionAuthority({
      ...common,
      maxPages: 1,
      fetchImplementation: paginatedFetch([
        { deployments: [expected], pagination: { next } },
      ]),
    }),
    /VERCEL_DEPLOYMENT_PAGINATION_TRUNCATED/u,
  );
  await assert.rejects(
    verifyVercelProductionAuthority({
      ...common,
      fetchImplementation: paginatedFetch([
        { deployments: [expected], pagination: { next: untilMs } },
      ]),
    }),
    /VERCEL_DEPLOYMENT_PAGINATION_CURSOR_LOOP/u,
  );
  await assert.rejects(
    verifyVercelProductionAuthority({
      ...common,
      fetchImplementation: async () => { throw new Error("offline fetch fixture failure"); },
    }),
    /VERCEL_DEPLOYMENT_PAGE_FETCH_FAILED/u,
  );
}

async function runWorkflowContract(mode) {
  assert.ok(MODES.has(mode), `unknown main-push workflow contract mode: ${mode}`);
  const [workflow, packageText, vercelText] = await Promise.all([
    readFile(WORKFLOW_URL, "utf8"),
    readFile(PACKAGE_URL, "utf8"),
    readFile(VERCEL_URL, "utf8"),
  ]);
  const packageJson = JSON.parse(packageText);
  const vercel = JSON.parse(vercelText);

  const checks = {
    "auto-deploy": () => verifyAutoDeploy(workflow),
    "no-stale-sha-gate": () => verifyNoStaleShaGate(workflow),
    "full-production-dag": () => verifyFullProductionDag(workflow),
    "exact-product-identity": () => verifyExactProductIdentity(workflow),
    "alias-cutover": () => verifyAliasCutover(workflow),
    "no-duplicate-production-deploy": () => verifyNoDuplicateProductionDeploy(workflow, vercel),
  };
  const selected = mode === "all" ? Object.keys(checks) : [mode];
  for (const name of selected) checks[name]();

  let negativeMutations = 0;
  if (mode === "all" || mode === "no-stale-sha-gate") {
    const mutations = [
      workflow.replace(
        "      - name: Verify immutable recovery release tag and GitHub Release\n        if: >-\n          github.event_name == 'workflow_dispatch' &&",
        "      - name: Verify immutable recovery release tag and GitHub Release\n        if: >-\n          github.event_name == 'push' || github.event_name == 'workflow_dispatch' &&",
      ),
      workflow.replace(
        "(github.event_name == 'push' || steps.immutable_tag_final.outcome == 'success')",
        "steps.immutable_tag_final.outcome == 'success'",
      ),
      workflow.replace(
        "production_authorization_mode=github-actions-main-sha",
        "production_authorization_mode=immutable-release-attestation",
      ),
    ];
    for (const mutation of mutations) {
      assert.notEqual(mutation, workflow, "normal-push release gate mutation fixture must change source");
      assert.throws(() => verifyNoStaleShaGate(mutation));
      negativeMutations += 1;
    }
  }
  if (mode === "all" || mode === "no-duplicate-production-deploy") {
    const mutations = [
      workflow.replace(
        '--meta "novelDeploymentAuthority=github-actions"',
        '--meta "novelDeploymentAuthority=untrusted"',
      ),
      workflow.replace(
        "          { pnpm exec vercel deploy --prebuilt --prod --skip-domain",
        "          { pnpm exec vercel deploy --prebuilt --prod --skip-domain\n          { pnpm exec vercel deploy --prebuilt --prod --skip-domain",
      ),
      workflow.replace(
        "node .release-control/scripts/run-main-push-auto-deploy-workflow-contract.mjs verify-vercel-production-authority",
        "node .release-control/scripts/run-main-push-auto-deploy-workflow-contract.mjs all",
      ),
      workflow.replace(".rawApiBodyIncluded' \"$receipt_path\")\" = false", ".rawApiBodyIncluded' \"$receipt_path\")\" = true"),
      workflow.replace(
        "Recheck exact single Vercel Production deployment immediately before cutover",
        "Skip Vercel Production deployment authority recheck",
      ),
    ];
    for (const mutation of mutations) {
      assert.notEqual(mutation, workflow, "workflow mutation fixture must change source");
      assert.throws(() => verifyNoDuplicateProductionDeploy(mutation, vercel));
      negativeMutations += 1;
    }
    assert.throws(() => verifyNoDuplicateProductionDeploy(workflow, {
      ...vercel,
      git: { ...vercel.git, deploymentEnabled: true },
    }));
    negativeMutations += 1;
    await verifyPaginationMutationContracts();
    negativeMutations += 4;
  }

  const expectedScripts = {
    "test:ci:main-push-auto-deploy": "auto-deploy",
    "test:ci:main-push-no-stale-sha-gate": "no-stale-sha-gate",
    "test:ci:main-push-full-production-dag": "full-production-dag",
    "test:ci:main-push-exact-product-identity": "exact-product-identity",
    "test:ci:main-push-alias-cutover": "alias-cutover",
    "test:ci:no-duplicate-vercel-production-deploy": "no-duplicate-production-deploy",
  };
  for (const [scriptName, scriptMode] of Object.entries(expectedScripts)) {
    assert.equal(
      packageJson.scripts?.[scriptName],
      `node scripts/run-main-push-auto-deploy-workflow-contract.mjs ${scriptMode}`,
    );
  }

  process.stdout.write(`${JSON.stringify({
    schemaVersion: "p24b-main-push-auto-deploy-workflow-contract-v1",
    status: "PASS",
    mode,
    checks: selected,
    normalProductIdentity: "github.sha",
    productionDeployCommandCount: 1,
    duplicateProductionDeployCount: 0,
    paginationMaxPages: VERCEL_DEPLOYMENT_MAX_PAGES,
    paginationMutationContracts: negativeMutations === 0 ? [] : [
      "second-page-duplicate",
      "bounded-page-truncation",
      "pagination-cursor-loop",
      "page-fetch-failure",
    ],
    negativeMutations,
  })}\n`);
}

const command = process.argv[2] || "all";
if (command === "verify-vercel-production-authority") {
  try {
    await runVercelProductionAuthorityCommand();
  } catch (error) {
    const errorCode = /^[A-Z0-9_]+$/u.test(error?.code ?? "")
      ? error.code
      : "VERCEL_PRODUCTION_AUTHORITY_VERIFICATION_FAILED";
    process.stderr.write(`${JSON.stringify({
      schemaVersion: "p24b-vercel-production-authority-verifier-result-v1",
      status: "FAIL",
      errorCode,
    })}\n`);
    process.exitCode = error?.retryable === true ? 75 : 1;
  }
} else {
  await runWorkflowContract(command);
}

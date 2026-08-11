import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const RC6_2_IMMUTABLE_PRODUCT_COMMIT = "29fc6e742672bb07187765d34ea818afdadf56ae";
export const RC6_2_RECOVERY_PREVIOUS_CONTROL_COMMIT =
  "3b716fc0d974a9d59b49ffca5953776af66c7a07";
export const RC6_2_RECOVERY_OPERATION = "deploy-immutable-product-recovery";
export const RC6_2_RECOVERY_CONTROL_SCHEMA =
  "p24b-rc6.2-production-recovery-control-proof-v2";

export const RC6_2_RECOVERY_CONTROL_ALLOWED_PATHS = Object.freeze([
  ".github/workflows/deploy.yml",
  "scripts/production-environment-governance.mjs",
  "scripts/production-last-known-good.mjs",
  "scripts/run-pr23-r21-workflow-contract.mjs",
  "scripts/run-production-main-head-cas-tests.mjs",
  "scripts/run-production-recovery-control-tests.mjs",
  "scripts/run-rc6-1-deployment-governance.mjs",
  "scripts/run-rc6-2-runtime-closure.mjs",
  "scripts/verify-deployment-temporal-provenance.mjs",
  "scripts/verify-github-release-attestation.mjs",
  "scripts/verify-production-main-head-cas.mjs",
  "scripts/verify-production-recovery-control.mjs",
]);

const RECOVERY_CONTROL_PROOF_KEYS = Object.freeze([
  "schemaVersion",
  "status",
  "mode",
  "repository",
  "eventName",
  "eventRef",
  "operation",
  "workflowRef",
  "workflowSha",
  "runId",
  "runAttempt",
  "productCommit",
  "controlCommit",
  "parentCommit",
  "productAncestorOfControl",
  "changedPaths",
  "changedPathsDigest",
  "repositorySettingVerification",
  "sanitized",
  "rawSecretsIncluded",
  "proofDigest",
]);

const FULL_COMMIT = /^[a-f0-9]{40}$/u;
const SAFE_STATUS = /^[AM]\t([^\0\r\n\t]{1,512})$/u;

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function hasExactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function normalizedCommit(value, code) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!FULL_COMMIT.test(normalized)) throw failure(code);
  return normalized;
}

function gitOutput(execFileSyncImplementation, args, options = {}) {
  try {
    return String(execFileSyncImplementation("git", args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024,
      timeout: 15_000,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      ...options,
    })).trim();
  } catch {
    throw failure("PRODUCTION_RECOVERY_CONTROL_GIT_FAILED");
  }
}

export function validateProductionRecoveryControlProof(value) {
  if (!hasExactKeys(value, RECOVERY_CONTROL_PROOF_KEYS)) {
    throw failure("PRODUCTION_RECOVERY_CONTROL_PROOF_SHAPE_INVALID");
  }
  const productCommit = normalizedCommit(
    value.productCommit,
    "PRODUCTION_RECOVERY_PRODUCT_COMMIT_INVALID",
  );
  const controlCommit = normalizedCommit(
    value.controlCommit,
    "PRODUCTION_RECOVERY_CONTROL_COMMIT_INVALID",
  );
  const workflowSha = normalizedCommit(
    value.workflowSha,
    "PRODUCTION_RECOVERY_WORKFLOW_COMMIT_INVALID",
  );
  const parentCommit = normalizedCommit(
    value.parentCommit,
    "PRODUCTION_RECOVERY_PARENT_INVALID",
  );
  const changedPaths = Array.isArray(value.changedPaths)
    ? value.changedPaths.map((path) => String(path).replaceAll("\\", "/"))
    : [];
  const sortedPaths = [...changedPaths].sort();
  const expectedWorkflowRef = `${value.repository}/.github/workflows/deploy.yml@refs/heads/main`;
  if (value.schemaVersion !== RC6_2_RECOVERY_CONTROL_SCHEMA
    || value.status !== "PASS"
    || value.mode !== "immutable-product-control"
    || productCommit !== RC6_2_IMMUTABLE_PRODUCT_COMMIT
    || controlCommit === productCommit
    || workflowSha !== controlCommit
    || parentCommit !== RC6_2_RECOVERY_PREVIOUS_CONTROL_COMMIT
    || value.productAncestorOfControl !== true
    || value.eventName !== "workflow_dispatch"
    || value.eventRef !== "refs/heads/main"
    || value.operation !== RC6_2_RECOVERY_OPERATION
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(String(value.repository || ""))
    || value.workflowRef !== expectedWorkflowRef
    || !/^[1-9][0-9]{0,19}$/u.test(String(value.runId || ""))
    || !/^[1-9][0-9]{0,9}$/u.test(String(value.runAttempt || ""))
    || changedPaths.length === 0
    || changedPaths.some((path) => !/^[^\0\r\n\t]{1,512}$/u.test(path))
    || new Set(changedPaths).size !== changedPaths.length
    || changedPaths.some((path, index) => path !== sortedPaths[index])
    || !changedPaths.includes(".github/workflows/deploy.yml")
    || !changedPaths.includes("scripts/verify-production-recovery-control.mjs")
    || changedPaths.some((path) => !RC6_2_RECOVERY_CONTROL_ALLOWED_PATHS.includes(path))
    || value.changedPathsDigest !== sha256(changedPaths)
    || value.repositorySettingVerification !== "not_authorized_by_github_token"
    || value.sanitized !== true
    || value.rawSecretsIncluded !== false) {
    throw failure("PRODUCTION_RECOVERY_CONTROL_PROOF_INVALID");
  }
  const canonicalValue = {
    ...value,
    productCommit,
    controlCommit,
    workflowSha,
    parentCommit,
    changedPaths,
  };
  const core = Object.fromEntries(
    RECOVERY_CONTROL_PROOF_KEYS
      .filter((key) => key !== "proofDigest")
      .map((key) => [key, canonicalValue[key]]),
  );
  if (!/^[a-f0-9]{64}$/u.test(String(value.proofDigest || ""))
    || value.proofDigest !== sha256(core)) {
    throw failure("PRODUCTION_RECOVERY_CONTROL_PROOF_DIGEST_INVALID");
  }
  return { ...core, proofDigest: value.proofDigest };
}

export function verifyProductionRecoveryControl({
  productCommit,
  controlCommit,
  checkoutCommit,
  workflowSha,
  eventName,
  eventRef,
  operation,
  repository,
  workflowRef,
  runId,
  runAttempt,
  execFileSyncImplementation = execFileSync,
}) {
  const product = normalizedCommit(
    productCommit,
    "PRODUCTION_RECOVERY_PRODUCT_COMMIT_INVALID",
  );
  const control = normalizedCommit(
    controlCommit,
    "PRODUCTION_RECOVERY_CONTROL_COMMIT_INVALID",
  );
  const checkout = normalizedCommit(
    checkoutCommit,
    "PRODUCTION_RECOVERY_CHECKOUT_COMMIT_INVALID",
  );
  const workflow = normalizedCommit(
    workflowSha,
    "PRODUCTION_RECOVERY_WORKFLOW_COMMIT_INVALID",
  );
  if (product !== RC6_2_IMMUTABLE_PRODUCT_COMMIT) {
    throw failure("PRODUCTION_RECOVERY_PRODUCT_COMMIT_NOT_PINNED");
  }
  if (control === product || checkout !== control || workflow !== control) {
    throw failure("PRODUCTION_RECOVERY_DUAL_SHA_BINDING_INVALID");
  }
  if (eventName !== "workflow_dispatch"
    || eventRef !== "refs/heads/main"
    || operation !== RC6_2_RECOVERY_OPERATION) {
    throw failure("PRODUCTION_RECOVERY_EVENT_INVALID");
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(String(repository || ""))) {
    throw failure("PRODUCTION_RECOVERY_REPOSITORY_INVALID");
  }
  const expectedWorkflowRef = `${repository}/.github/workflows/deploy.yml@refs/heads/main`;
  if (workflowRef !== expectedWorkflowRef
    || !/^[1-9][0-9]{0,19}$/u.test(String(runId || ""))
    || !/^[1-9][0-9]{0,9}$/u.test(String(runAttempt || ""))) {
    throw failure("PRODUCTION_RECOVERY_WORKFLOW_PROVENANCE_INVALID");
  }

  const actualHead = normalizedCommit(
    gitOutput(execFileSyncImplementation, ["rev-parse", "HEAD"]),
    "PRODUCTION_RECOVERY_HEAD_INVALID",
  );
  if (actualHead !== control) throw failure("PRODUCTION_RECOVERY_HEAD_MISMATCH");

  const parentLine = gitOutput(
    execFileSyncImplementation,
    ["rev-list", "--parents", "-n", "1", control],
  ).split(/\s+/u);
  if (parentLine.length !== 2
    || parentLine[0] !== control
    || parentLine[1] !== RC6_2_RECOVERY_PREVIOUS_CONTROL_COMMIT) {
    throw failure("PRODUCTION_RECOVERY_PARENT_INVALID");
  }
  const previousControlParentLine = gitOutput(
    execFileSyncImplementation,
    ["rev-list", "--parents", "-n", "1", RC6_2_RECOVERY_PREVIOUS_CONTROL_COMMIT],
  ).split(/\s+/u);
  if (previousControlParentLine.length !== 2
    || previousControlParentLine[0] !== RC6_2_RECOVERY_PREVIOUS_CONTROL_COMMIT
    || previousControlParentLine[1] !== product) {
    throw failure("PRODUCTION_RECOVERY_PARENT_INVALID");
  }

  gitOutput(execFileSyncImplementation, ["merge-base", "--is-ancestor", product, control]);
  const rawStatuses = gitOutput(execFileSyncImplementation, [
    "diff",
    "--name-status",
    "--diff-filter=ACDMRTUXB",
    product,
    control,
  ]);
  const changedPaths = rawStatuses
    ? rawStatuses.split(/\r?\n/u).map((line) => {
      const match = SAFE_STATUS.exec(line);
      if (!match) throw failure("PRODUCTION_RECOVERY_DIFF_STATUS_INVALID");
      return match[1].replaceAll("\\", "/");
    })
    : [];
  const uniquePaths = [...new Set(changedPaths)].sort();
  if (uniquePaths.length !== changedPaths.length
    || !uniquePaths.includes(".github/workflows/deploy.yml")
    || !uniquePaths.includes("scripts/verify-production-recovery-control.mjs")
    || uniquePaths.some((path) => !RC6_2_RECOVERY_CONTROL_ALLOWED_PATHS.includes(path))) {
    throw failure("PRODUCTION_RECOVERY_DIFF_NOT_CONTROL_ONLY");
  }

  const core = {
    schemaVersion: RC6_2_RECOVERY_CONTROL_SCHEMA,
    status: "PASS",
    mode: "immutable-product-control",
    repository,
    eventName,
    eventRef,
    operation,
    workflowRef,
    workflowSha: workflow,
    runId: String(runId),
    runAttempt: String(runAttempt),
    productCommit: product,
    controlCommit: control,
    parentCommit: RC6_2_RECOVERY_PREVIOUS_CONTROL_COMMIT,
    productAncestorOfControl: true,
    changedPaths: uniquePaths,
    changedPathsDigest: sha256(uniquePaths),
    repositorySettingVerification: "not_authorized_by_github_token",
    sanitized: true,
    rawSecretsIncluded: false,
  };
  return validateProductionRecoveryControlProof({ ...core, proofDigest: sha256(core) });
}

function requiredEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw failure(`PRODUCTION_RECOVERY_ENVIRONMENT_MISSING:${name}`);
  return value;
}

function expectedEnvironmentMatchesProof(proof) {
  if (proof.productCommit !== requiredEnvironment("EXPECTED_PRODUCT_COMMIT").toLowerCase()
    || proof.controlCommit !== requiredEnvironment("EXPECTED_MAIN_HEAD_COMMIT").toLowerCase()
    || proof.workflowSha !== requiredEnvironment("GITHUB_WORKFLOW_SHA").toLowerCase()
    || proof.eventName !== requiredEnvironment("GITHUB_EVENT_NAME")
    || proof.eventRef !== requiredEnvironment("GITHUB_REF")
    || proof.operation !== requiredEnvironment("RECOVERY_OPERATION")
    || proof.repository !== requiredEnvironment("GITHUB_REPOSITORY")
    || proof.workflowRef !== requiredEnvironment("GITHUB_WORKFLOW_REF")
    || proof.runId !== requiredEnvironment("GITHUB_RUN_ID")
    || proof.runAttempt !== requiredEnvironment("GITHUB_RUN_ATTEMPT")) {
    throw failure("PRODUCTION_RECOVERY_CONTROL_PROOF_ENVIRONMENT_MISMATCH");
  }
}

function main() {
  if (process.argv[2] === "validate-proof") {
    const proof = validateProductionRecoveryControlProof(JSON.parse(
      readFileSync(requiredEnvironment("RECOVERY_CONTROL_PROOF_PATH"), "utf8"),
    ));
    expectedEnvironmentMatchesProof(proof);
    process.stdout.write(`${JSON.stringify({
      status: proof.status,
      productCommit: proof.productCommit,
      controlCommit: proof.controlCommit,
      proofDigest: proof.proofDigest,
    })}\n`);
    return;
  }
  const proof = verifyProductionRecoveryControl({
    productCommit: requiredEnvironment("EXPECTED_PRODUCT_COMMIT"),
    controlCommit: requiredEnvironment("EXPECTED_MAIN_HEAD_COMMIT"),
    checkoutCommit: requiredEnvironment("GITHUB_SHA"),
    workflowSha: requiredEnvironment("GITHUB_WORKFLOW_SHA"),
    eventName: requiredEnvironment("GITHUB_EVENT_NAME"),
    eventRef: requiredEnvironment("GITHUB_REF"),
    operation: requiredEnvironment("RECOVERY_OPERATION"),
    repository: requiredEnvironment("GITHUB_REPOSITORY"),
    workflowRef: requiredEnvironment("GITHUB_WORKFLOW_REF"),
    runId: requiredEnvironment("GITHUB_RUN_ID"),
    runAttempt: requiredEnvironment("GITHUB_RUN_ATTEMPT"),
  });
  expectedEnvironmentMatchesProof(proof);
  const proofPath = requiredEnvironment("RECOVERY_CONTROL_PROOF_PATH");
  writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    status: proof.status,
    productCommit: proof.productCommit,
    controlCommit: proof.controlCommit,
    changedPathsDigest: proof.changedPathsDigest,
    proofDigest: proof.proofDigest,
  })}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: "production_recovery_control_failed",
      errorCode: String(error?.code || error?.message || "PRODUCTION_RECOVERY_CONTROL_FAILED"),
    })}\n`);
    process.exitCode = 1;
  }
}

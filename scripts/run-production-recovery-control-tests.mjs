import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  RC6_2_IMMUTABLE_PRODUCT_COMMIT,
  RC6_2_RECOVERY_CONTROL_ALLOWED_PATHS,
  RC6_2_RECOVERY_OPERATION,
  RC6_2_RECOVERY_PREVIOUS_CONTROL_COMMIT,
  validateProductionRecoveryControlProof,
  verifyProductionRecoveryControl,
} from "./verify-production-recovery-control.mjs";
import { validateGithubReleaseAttestation } from "./verify-github-release-attestation.mjs";

const product = RC6_2_IMMUTABLE_PRODUCT_COMMIT;
const control = "a".repeat(40);
const tagObject = "b".repeat(40);
const repository = "bobobo-org/novel";
const releaseTag = "novel-ai-p24b-conversation-first-studio-rc6.2";
const releaseDatabaseId = "368738374";
const changedPaths = [
  ".github/workflows/deploy.yml",
  "scripts/production-last-known-good.mjs",
  "scripts/run-production-recovery-control-tests.mjs",
  "scripts/verify-github-release-attestation.mjs",
  "scripts/verify-production-recovery-control.mjs",
];

function gitMock({
  head = control,
  parent = RC6_2_RECOVERY_PREVIOUS_CONTROL_COMMIT,
  previousControlParent = product,
  statuses = changedPaths.map((path) => `M\t${path}`).join("\n"),
} = {}) {
  return (_command, args) => {
    if (args[0] === "rev-parse") return `${head}\n`;
    if (args[0] === "rev-list" && args.at(-1) === control) return `${control} ${parent}\n`;
    if (args[0] === "rev-list" && args.at(-1) === RC6_2_RECOVERY_PREVIOUS_CONTROL_COMMIT) {
      return `${RC6_2_RECOVERY_PREVIOUS_CONTROL_COMMIT} ${previousControlParent}\n`;
    }
    if (args[0] === "merge-base") return "";
    if (args[0] === "diff") return `${statuses}\n`;
    throw new Error("UNEXPECTED_GIT_COMMAND");
  };
}

function validControlInput(overrides = {}) {
  return {
    productCommit: product,
    controlCommit: control,
    checkoutCommit: control,
    workflowSha: control,
    eventName: "workflow_dispatch",
    eventRef: "refs/heads/main",
    operation: RC6_2_RECOVERY_OPERATION,
    repository,
    workflowRef: `${repository}/.github/workflows/deploy.yml@refs/heads/main`,
    runId: "31520000000",
    runAttempt: "1",
    execFileSyncImplementation: gitMock(),
    ...overrides,
  };
}

const proof = verifyProductionRecoveryControl(validControlInput());
assert.equal(proof.status, "PASS");
assert.equal(proof.productCommit, product);
assert.equal(proof.controlCommit, control);
assert.equal(proof.parentCommit, RC6_2_RECOVERY_PREVIOUS_CONTROL_COMMIT);
assert.deepEqual(proof.changedPaths, [...changedPaths].sort());
assert.match(proof.changedPathsDigest, /^[a-f0-9]{64}$/u);
assert.match(proof.proofDigest, /^[a-f0-9]{64}$/u);
assert.equal(proof.repositorySettingVerification, "not_authorized_by_github_token");
assert.equal(proof.rawSecretsIncluded, false);
assert.ok(changedPaths.every((path) => RC6_2_RECOVERY_CONTROL_ALLOWED_PATHS.includes(path)));
assert.deepEqual(validateProductionRecoveryControlProof(proof), proof);
const controlSource = await readFile(new URL("./verify-production-recovery-control.mjs", import.meta.url), "utf8");
assert.match(controlSource, /--diff-filter=ACDMRTUXB/u);

for (const [name, overrides, expected] of [
  ["unpinned product", { productCommit: "c".repeat(40) }, /PRODUCT_COMMIT_NOT_PINNED/u],
  ["same product/control", { controlCommit: product, checkoutCommit: product, workflowSha: product }, /DUAL_SHA_BINDING_INVALID/u],
  ["wrong checkout", { checkoutCommit: "c".repeat(40) }, /DUAL_SHA_BINDING_INVALID/u],
  ["wrong workflow sha", { workflowSha: "c".repeat(40) }, /DUAL_SHA_BINDING_INVALID/u],
  ["push event", { eventName: "push" }, /EVENT_INVALID/u],
  ["non-main ref", { eventRef: "refs/heads/feature" }, /EVENT_INVALID/u],
  ["wrong operation", { operation: "deploy-preview" }, /EVENT_INVALID/u],
  ["wrong workflow ref", { workflowRef: `${repository}/.github/workflows/other.yml@refs/heads/main` }, /WORKFLOW_PROVENANCE_INVALID/u],
  ["wrong head", { execFileSyncImplementation: gitMock({ head: "c".repeat(40) }) }, /HEAD_MISMATCH/u],
  ["wrong parent", { execFileSyncImplementation: gitMock({ parent: "c".repeat(40) }) }, /PARENT_INVALID/u],
  ["previous control not directly based on Product", { execFileSyncImplementation: gitMock({ previousControlParent: "c".repeat(40) }) }, /PARENT_INVALID/u],
  ["deleted control file", { execFileSyncImplementation: gitMock({ statuses: "D\t.github/workflows/deploy.yml" }) }, /DIFF_STATUS_INVALID/u],
  ["app path", { execFileSyncImplementation: gitMock({ statuses: "M\t.github/workflows/deploy.yml\nM\tapp/page.tsx" }) }, /DIFF_NOT_CONTROL_ONLY/u],
]) {
  assert.throws(
    () => verifyProductionRecoveryControl(validControlInput(overrides)),
    expected,
    name,
  );
}

for (const [name, mutation] of [
  ["extra proof field", { ...proof, extra: true }],
  ["wrong proof operation", { ...proof, operation: "restore-known-stable" }],
  ["wrong proof parent", { ...proof, parentCommit: "d".repeat(40) }],
  ["wrong proof paths", { ...proof, changedPaths: [...proof.changedPaths, "app/page.tsx"] }],
  ["wrong proof digest", { ...proof, proofDigest: "0".repeat(64) }],
]) {
  assert.throws(() => validateProductionRecoveryControlProof(mutation), undefined, name);
}

const releaseTagProof = {
  status: "PASS",
  mode: "remote",
  productCommit: product,
  releaseTag,
  peeledCommit: product,
  immutableReleaseVerified: true,
  immutableReleaseId: Number(releaseDatabaseId),
  repositoryImmutableReleasesSettingVerified: false,
  repositoryImmutableReleasesEnabled: null,
  tagObject,
};
const purl = `pkg:github/${repository}@${releaseTag}`;
const attestation = {
  verificationResult: {
    statement: {
      _type: "https://in-toto.io/Statement/v1",
      subject: [{ uri: purl, digest: { sha1: tagObject } }],
      predicateType: "https://in-toto.io/attestation/release/v0.2",
      predicate: {
        databaseId: releaseDatabaseId,
        repository,
        tag: releaseTag,
        purl,
      },
    },
  },
};

const attestationProof = validateGithubReleaseAttestation({
  attestation,
  releaseTagProof,
  repository,
  releaseTag,
  releaseDatabaseId,
  productCommit: product,
});
assert.equal(attestationProof.status, "PASS");
assert.equal(attestationProof.tagObject, tagObject);
assert.equal(attestationProof.productCommit, product);
assert.equal(attestationProof.rawAttestationIncluded, false);
assert.match(attestationProof.proofDigest, /^[a-f0-9]{64}$/u);

for (const [name, changed, expected] of [
  ["mutable release", { releaseTagProof: { ...releaseTagProof, immutableReleaseVerified: false } }, /TAG_PROOF_INVALID/u],
  ["setting falsely claimed", { releaseTagProof: { ...releaseTagProof, repositoryImmutableReleasesSettingVerified: true } }, /TAG_PROOF_INVALID/u],
  ["wrong tag object", { attestation: { verificationResult: { statement: { ...attestation.verificationResult.statement, subject: [{ uri: purl, digest: { sha1: "c".repeat(40) } }] } } } }, /ATTESTATION_MISMATCH/u],
  ["wrong database id", { attestation: { verificationResult: { statement: { ...attestation.verificationResult.statement, predicate: { ...attestation.verificationResult.statement.predicate, databaseId: "1" } } } } }, /ATTESTATION_MISMATCH/u],
  ["wrong repository", { attestation: { verificationResult: { statement: { ...attestation.verificationResult.statement, predicate: { ...attestation.verificationResult.statement.predicate, repository: "other/repo" } } } } }, /ATTESTATION_MISMATCH/u],
]) {
  assert.throws(
    () => validateGithubReleaseAttestation({
      attestation: changed.attestation || attestation,
      releaseTagProof: changed.releaseTagProof || releaseTagProof,
      repository,
      releaseTag,
      releaseDatabaseId,
      productCommit: product,
    }),
    expected,
    name,
  );
}

console.log(JSON.stringify({
  status: "PASS",
  assertions: 37,
  productCommit: product,
  dualShaControl: true,
  releaseAttestation: true,
  rawSecretsIncluded: false,
}));

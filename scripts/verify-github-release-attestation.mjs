import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const FULL_COMMIT = /^[a-f0-9]{40}$/u;
const DATABASE_ID = /^[1-9][0-9]{0,19}$/u;

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

function digest(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

export function validateGithubReleaseAttestation({
  attestation,
  releaseTagProof,
  repository,
  releaseTag,
  releaseDatabaseId,
  productCommit,
}) {
  const expectedProduct = String(productCommit || "").toLowerCase();
  const expectedDatabaseId = String(releaseDatabaseId || "");
  if (!FULL_COMMIT.test(expectedProduct)
    || !DATABASE_ID.test(expectedDatabaseId)
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(String(repository || ""))
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(String(releaseTag || ""))) {
    throw failure("GITHUB_RELEASE_ATTESTATION_EXPECTATION_INVALID");
  }
  if (releaseTagProof?.status !== "PASS"
    || releaseTagProof?.mode !== "remote"
    || releaseTagProof?.productCommit !== expectedProduct
    || releaseTagProof?.releaseTag !== releaseTag
    || releaseTagProof?.peeledCommit !== expectedProduct
    || releaseTagProof?.immutableReleaseVerified !== true
    || String(releaseTagProof?.immutableReleaseId) !== expectedDatabaseId
    || releaseTagProof?.repositoryImmutableReleasesSettingVerified !== false
    || releaseTagProof?.repositoryImmutableReleasesEnabled !== null
    || !FULL_COMMIT.test(String(releaseTagProof?.tagObject || ""))) {
    throw failure("GITHUB_RELEASE_TAG_PROOF_INVALID");
  }
  const statement = attestation?.verificationResult?.statement;
  const subject = statement?.subject;
  const predicate = statement?.predicate;
  const expectedPurl = `pkg:github/${repository}@${releaseTag}`;
  if (statement?._type !== "https://in-toto.io/Statement/v1"
    || statement?.predicateType !== "https://in-toto.io/attestation/release/v0.2"
    || !Array.isArray(subject)
    || subject.length !== 1
    || subject[0]?.uri !== expectedPurl
    || subject[0]?.digest?.sha1 !== releaseTagProof.tagObject
    || predicate?.databaseId !== expectedDatabaseId
    || predicate?.repository !== repository
    || predicate?.tag !== releaseTag
    || predicate?.purl !== expectedPurl) {
    throw failure("GITHUB_RELEASE_ATTESTATION_MISMATCH");
  }
  const core = {
    schemaVersion: "p24b-rc6.2-github-release-attestation-proof-v1",
    status: "PASS",
    repository,
    releaseTag,
    releaseDatabaseId: expectedDatabaseId,
    tagObject: releaseTagProof.tagObject,
    productCommit: expectedProduct,
    attestationSubjectVerified: true,
    immutableReleasePayloadVerified: true,
    annotatedTagPeelVerified: true,
    repositorySettingVerification: "not_authorized_by_github_token",
    sanitized: true,
    rawAttestationIncluded: false,
  };
  return { ...core, proofDigest: digest(core) };
}

export function verifyGithubReleaseAttestation({
  repository,
  releaseTag,
  releaseDatabaseId,
  productCommit,
  releaseTagProofPath,
  outputPath,
  executeGhImplementation = execFileSync,
}) {
  let raw;
  try {
    raw = executeGhImplementation(
      "gh",
      ["release", "verify", releaseTag, "--repo", repository, "--format", "json"],
      {
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      },
    );
  } catch {
    throw failure("GITHUB_RELEASE_ATTESTATION_LOOKUP_FAILED");
  }
  let attestation;
  let releaseTagProof;
  try {
    attestation = JSON.parse(String(raw));
    releaseTagProof = JSON.parse(readFileSync(releaseTagProofPath, "utf8"));
  } catch {
    throw failure("GITHUB_RELEASE_ATTESTATION_DOCUMENT_INVALID");
  }
  const proof = validateGithubReleaseAttestation({
    attestation,
    releaseTagProof,
    repository,
    releaseTag,
    releaseDatabaseId,
    productCommit,
  });
  writeFileSync(outputPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
  return proof;
}

function requiredEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw failure(`GITHUB_RELEASE_ATTESTATION_ENVIRONMENT_MISSING:${name}`);
  return value;
}

function main() {
  const proof = verifyGithubReleaseAttestation({
    repository: requiredEnvironment("GITHUB_REPOSITORY"),
    releaseTag: requiredEnvironment("EXPECTED_RELEASE_TAG"),
    releaseDatabaseId: requiredEnvironment("EXPECTED_RELEASE_DATABASE_ID"),
    productCommit: requiredEnvironment("EXPECTED_PRODUCT_COMMIT"),
    releaseTagProofPath: requiredEnvironment("RELEASE_TAG_PROOF_PATH"),
    outputPath: requiredEnvironment("RELEASE_ATTESTATION_PROOF_PATH"),
  });
  process.stdout.write(`${JSON.stringify({
    status: proof.status,
    releaseTag: proof.releaseTag,
    releaseDatabaseId: proof.releaseDatabaseId,
    productCommit: proof.productCommit,
    proofDigest: proof.proofDigest,
  })}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: "github_release_attestation_failed",
      errorCode: String(error?.code || error?.message || "GITHUB_RELEASE_ATTESTATION_FAILED"),
    })}\n`);
    process.exitCode = 1;
  }
}

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import releaseManifest from "../release-manifest.json" with { type: "json" };
import releaseProvenance from "../generated/release-provenance.json" with { type: "json" };
import {
  createReleaseBuildIdentity,
  generateReleaseProvenance,
  provenancePayload,
  verifyReleaseProvenance,
} from "./generate-release-provenance.mjs";
import { createLegacyBuildTruth } from "./check-legacy-build-truth.mjs";
import { createProjectBackup } from "../lib/novel-ai/repository/backup.ts";
import {
  releaseIdentity,
  releaseProvenanceStatus,
} from "../lib/novel-ai/runtime-truth/release-identity.ts";

const RC6_BASE_COMMIT = "e9b1091916b53c34ed9676dc4d418baaf696786e";
const RC6_TAG = "novel-ai-p24b-conversation-first-studio-rc6.2";
const RC6_1_REVISION = "rc6.2";
const RC6_1_NAME = "P2.4B Conversation-First Novel Project GPT RC6.2";
const RC6_1_CONSUMER = "p2.4b-conversation-first-studio-rc6.2";
const mode = process.argv[2] || "all";
const results = [];

const sources = Object.fromEntries(await Promise.all([
  "lib/release-manifest.ts",
  "lib/novel-ai/runtime-truth/release-identity.ts",
  "app/api/release/identity/route.ts",
  "app/api/ai/health/route.ts",
  "lib/novel-ai/repository/backup.ts",
  "lib/novel-ai/domain/index.ts",
  "scripts/stamp-static-release.mjs",
  "public/legacy/novel-system.html",
  "public/legacy/novel-whole-novel-workspace.js",
].map(async (path) => [path, await readFile(path, "utf8")])));

const legacyInputs = {
  html: sources["public/legacy/novel-system.html"],
  workspace: sources["public/legacy/novel-whole-novel-workspace.js"],
  serviceWorker: await readFile("public/legacy/service-worker.js", "utf8"),
  boundary: await readFile("public/legacy/legacy-security-boundary.js", "utf8"),
};
const backupProjectId = "rc6.1-release-backup-regression";
const storedBackups = [];
const runtimeIdentity = releaseIdentity();
const backupFixture = await createProjectBackup({
  exportProject: async () => ({
    projects: [{
      id: backupProjectId,
      projectId: backupProjectId,
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
      revision: 1,
      createdBy: "system",
      updatedBy: "system",
    }],
  }),
  put: async (_store, row) => { storedBackups.push(row); },
}, backupProjectId, "full");

function test(group, name, work) {
  if (mode !== "all" && mode !== group) return;
  try {
    work();
    results.push({ group, name, status: "PASS" });
  } catch (error) {
    results.push({
      group,
      name,
      status: "FAIL",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function fixture(commit) {
  return generateReleaseProvenance({
    env: {
      NOVEL_BUILD_APP_COMMIT: commit,
      NOVEL_BUILD_SEALED_AT: "2026-08-10T00:00:00.000Z",
    },
    git: () => { throw new Error("git unavailable"); },
    write: false,
  });
}

test("release-revision", "manifest declares the exact immutable RC6.2 identity", () => {
  assert.equal(releaseManifest.releaseTag, RC6_TAG);
  assert.equal(releaseManifest.releaseRevision, RC6_1_REVISION);
  assert.equal(releaseManifest.releaseName, RC6_1_NAME);
  assert.equal(releaseManifest.consumerRelease, RC6_1_CONSUMER);
  assert.equal(releaseManifest.releaseBaseCommit, RC6_BASE_COMMIT);
  assert.equal(releaseManifest.architectureStage, "P2.4B RC");
});

test("release-revision", "release identity and Legacy health expose RC6.2 fields", () => {
  const identity = sources["lib/novel-ai/runtime-truth/release-identity.ts"];
  const releaseRoute = sources["app/api/release/identity/route.ts"];
  const legacyHealth = sources["app/api/ai/health/route.ts"];
  for (const field of [
    "releaseRevision",
    "releaseBuild",
    "releaseProductCommit",
    "releaseBaseCommit",
    "gitCommitSignature",
    "deploymentProvenance",
    "artifactAttestationStatus",
    "artifactAttestationDigest",
  ]) {
    assert.match(identity, new RegExp(field, "u"), `release identity missing ${field}`);
    assert.match(legacyHealth, new RegExp(field, "u"), `Legacy health missing ${field}`);
  }
  for (const header of [
    "X-Novel-Release-Product-Commit",
    "X-Novel-Release-Revision",
    "X-Novel-Release-Build",
    "X-Novel-Git-Commit-Signature",
    "X-Novel-Deployment-Provenance",
  ]) assert.match(releaseRoute, new RegExp(header, "u"));
  assert.equal(releaseProvenanceStatus(), "verified");
  assert.equal(runtimeIdentity.releaseTag, RC6_TAG);
  assert.equal(runtimeIdentity.releaseRevision, RC6_1_REVISION);
  assert.equal(runtimeIdentity.releaseProductCommit, releaseProvenance.appCommit);
  assert.equal(runtimeIdentity.releaseBaseCommit, RC6_BASE_COMMIT);
  assert.equal(runtimeIdentity.releaseBuild, releaseProvenance.releaseBuild);
});

test("release-revision", "static and backup metadata carry the same release revision", () => {
  const stamp = sources["scripts/stamp-static-release.mjs"];
  const html = sources["public/legacy/novel-system.html"];
  const workspace = sources["public/legacy/novel-whole-novel-workspace.js"];
  const backup = sources["lib/novel-ai/repository/backup.ts"];
  const domain = sources["lib/novel-ai/domain/index.ts"];
  for (const field of [
    "releaseRevision",
    "releaseBuild",
    "releaseProductCommit",
    "releaseBaseCommit",
  ]) {
    assert.match(stamp, new RegExp(field, "u"));
    assert.match(workspace, new RegExp(field, "u"));
    assert.match(backup, new RegExp(field, "u"));
    assert.match(domain, new RegExp(field, "u"));
  }
  for (const marker of [
    "__NOVEL_STATIC_RELEASE_REVISION__",
    "__NOVEL_STATIC_RELEASE_BUILD__",
    "__NOVEL_STATIC_RELEASE_PRODUCT_COMMIT__",
    "__NOVEL_STATIC_RELEASE_BASE_COMMIT__",
  ]) assert.match(html, new RegExp(marker, "u"));
  assert.match(backup, /releaseProductCommit\s*=\s*release\.releaseProductCommit/u);
  assert.match(backup, /RELEASE_MANIFEST\.releaseRevision/u);
  assert.equal(backupFixture.payload.manifest.releaseTag, RC6_TAG);
  assert.equal(backupFixture.payload.manifest.releaseRevision, RC6_1_REVISION);
  assert.equal(
    backupFixture.payload.manifest.releaseProductCommit,
    backupFixture.payload.manifest.appCommit,
  );
  assert.equal(
    backupFixture.payload.manifest.releaseBuild,
    `${RC6_1_REVISION}+${backupFixture.payload.manifest.releaseProductCommit}`,
  );
  assert.equal(backupFixture.payload.manifest.releaseBaseCommit, RC6_BASE_COMMIT);
  assert.equal(storedBackups.length, 1);
});

test("release-tag-commit-traceability", "product commit is exactly the build-sealed app commit", () => {
  assert.equal(verifyReleaseProvenance(releaseProvenance), true);
  assert.equal(releaseProvenance.releaseProductCommit, releaseProvenance.appCommit);
  assert.match(releaseProvenance.releaseProductCommit, /^[0-9a-f]{40}$/u);
  assert.equal(releaseProvenance.releaseBaseCommit, RC6_BASE_COMMIT);
  assert.equal(releaseProvenance.releaseTag, RC6_TAG);
  assert.equal(releaseProvenance.releaseRevision, RC6_1_REVISION);
});

test("release-tag-commit-traceability", "releaseBuild is dynamic and reproducible", () => {
  const commitA = "a".repeat(40);
  const commitB = "b".repeat(40);
  const buildA1 = fixture(commitA);
  const buildA2 = fixture(commitA);
  const buildB = fixture(commitB);
  assert.equal(buildA1.releaseBuild, buildA2.releaseBuild);
  assert.equal(buildA1.integrity.payloadHash, buildA2.integrity.payloadHash);
  assert.notEqual(buildA1.releaseBuild, buildB.releaseBuild);
  assert.equal(
    buildA1.releaseBuild,
    createReleaseBuildIdentity({ releaseRevision: RC6_1_REVISION, appCommit: commitA }),
  );
  assert.equal(buildA1.releaseBuild, `${RC6_1_REVISION}+${commitA}`);
});

test("release-tag-commit-traceability", "unknown runtime or evidence commits cannot override product truth", () => {
  const generator = sources["lib/release-manifest.ts"];
  assert.match(generator, /releaseProductCommit:\s*provenance\.releaseProductCommit/u);
  assert.doesNotMatch(generator, /process\.env\.(?:APP_COMMIT|GITHUB_SHA)/u);
  assert.doesNotMatch(
    sources["lib/novel-ai/runtime-truth/release-identity.ts"],
    /VERCEL_GIT_COMMIT_SHA|GITHUB_SHA|APP_COMMIT/u,
  );
});

test("artifact-attestation", "artifact attestation truth is distinct from verified build provenance", () => {
  const expectedDigest = createHash("sha256")
    .update(JSON.stringify(provenancePayload(releaseProvenance)), "utf8")
    .digest("hex");
  assert.equal(releaseProvenance.integrity.algorithm, "sha256");
  assert.equal(releaseProvenance.integrity.payloadHash, expectedDigest);
  assert.equal(verifyReleaseProvenance(releaseProvenance), true);
  assert.equal(runtimeIdentity.buildProvenanceStatus, "verified");
  assert.equal(runtimeIdentity.artifactAttestationStatus, "not_produced");
  assert.equal(runtimeIdentity.artifactAttestationDigest, null);
  assert.equal(
    verifyReleaseProvenance({ ...releaseProvenance, releaseProductCommit: "f".repeat(40) }),
    false,
  );
  assert.equal(
    verifyReleaseProvenance({ ...releaseProvenance, releaseRevision: "rc6.1" }),
    false,
  );
});

test("build-provenance", "Legacy artifact truth is sealed to the product commit", () => {
  const legacy = createLegacyBuildTruth({
    ...legacyInputs,
    provenance: releaseProvenance,
    manifest: releaseManifest,
    allowTemplatePlaceholders: true,
  });
  assert.equal(legacy.commit, releaseProvenance.appCommit);
  assert.equal(legacy.releaseProductCommit, releaseProvenance.appCommit);
  assert.equal(legacy.releaseBuild, releaseProvenance.releaseBuild);
  assert.equal(legacy.releaseRevision, RC6_1_REVISION);
  assert.equal(legacy.artifactAttestationDigest, null);
  assert.equal(legacy.artifactAttestationStatus, "not_produced");
});

test("signature-vs-provenance-truth", "unsigned Git commit truth is distinct from verified deployment provenance", () => {
  assert.equal(releaseManifest.gitCommitSignature, "unsigned");
  assert.equal(releaseProvenance.gitCommitSignature, "unsigned");
  const legacy = createLegacyBuildTruth({
    ...legacyInputs,
    provenance: releaseProvenance,
    manifest: releaseManifest,
    allowTemplatePlaceholders: true,
  });
  assert.equal(legacy.gitCommitSignature, "unsigned");
  assert.equal(legacy.deploymentProvenance, "verified");
  assert.notEqual(legacy.gitCommitSignature, legacy.deploymentProvenance);
  assert.equal(runtimeIdentity.gitCommitSignature, "unsigned");
  assert.equal(runtimeIdentity.deploymentProvenance, "verified");
  assert.equal(runtimeIdentity.artifactAttestationStatus, "not_produced");
  assert.equal(runtimeIdentity.artifactAttestationDigest, null);
});

test("signature-vs-provenance-truth", "sealed product commit has no Git signature header", () => {
  const commitObject = execFileSync(
    "git",
    ["cat-file", "-p", releaseProvenance.releaseProductCommit],
    { encoding: "utf8" },
  );
  assert.doesNotMatch(commitObject, /^gpgsig(?:-sha256)?\s/mu);
});

test("signature-vs-provenance-truth", "public truth never equates deployment provenance with Git signing", () => {
  const runtime = sources["lib/novel-ai/runtime-truth/release-identity.ts"];
  assert.match(runtime, /gitCommitSignature:\s*RELEASE_MANIFEST\.gitCommitSignature/u);
  assert.match(runtime, /deploymentProvenance:\s*provenanceStatus/u);
  assert.doesNotMatch(runtime, /gitCommitSignature:\s*provenanceStatus/u);
});

if (!results.length) {
  throw new Error(`UNKNOWN_RC6_1_RELEASE_TRACEABILITY_MODE:${mode}`);
}

const summary = {
  schemaVersion: "p24b-rc6.1-release-traceability-result-v1",
  mode,
  pass: results.filter((result) => result.status === "PASS").length,
  fail: results.filter((result) => result.status === "FAIL").length,
  skip: 0,
  results,
};
console.log(JSON.stringify(summary, null, 2));
if (summary.fail) process.exitCode = 1;

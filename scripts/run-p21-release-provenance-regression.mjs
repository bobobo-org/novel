import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  generateReleaseProvenance,
  resolveBuildCommit,
  verifyReleaseProvenance,
} from "./generate-release-provenance.mjs";

const commitA = "a".repeat(40);
const commitB = "b".repeat(40);
const commitC = "c".repeat(40);
const fixedTime = "2026-07-24T00:00:00.000Z";
const results = [];

async function test(name, work) {
  try {
    await work();
    results.push({ name, status: "PASS" });
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const noGit = () => {
  throw new Error("git unavailable");
};

await test("VERCEL_GIT_COMMIT_SHA is authoritative at build time", () => {
  assert.deepEqual(
    resolveBuildCommit({
      env: { VERCEL_GIT_COMMIT_SHA: commitA, APP_COMMIT: commitB },
      git: noGit,
    }),
    { appCommit: commitA, source: "vercel_git_commit_sha" },
  );
});
await test("explicit build commit is the supported non-Vercel fallback", () => {
  assert.deepEqual(
    resolveBuildCommit({
      env: { NOVEL_BUILD_APP_COMMIT: commitB, APP_COMMIT: commitA },
      git: noGit,
    }),
    { appCommit: commitB, source: "explicit_build_commit" },
  );
});
await test("Git HEAD is used when build variables are absent", () => {
  assert.deepEqual(
    resolveBuildCommit({ env: {}, git: () => commitC }),
    { appCommit: commitC, source: "git_head" },
  );
});
await test("APP_COMMIT cannot contaminate authoritative provenance", () => {
  assert.throws(
    () => resolveBuildCommit({ env: { APP_COMMIT: commitA }, git: noGit }),
    /BUILD_COMMIT_UNAVAILABLE/,
  );
});
await test("invalid explicit commit fails closed", () => {
  assert.throws(
    () => resolveBuildCommit({ env: { NOVEL_BUILD_APP_COMMIT: "short" }, git: noGit }),
    /INVALID_BUILD_COMMIT/,
  );
});
await test("missing commit fails closed", () => {
  assert.throws(() => resolveBuildCommit({ env: {}, git: noGit }), /BUILD_COMMIT_UNAVAILABLE/);
});
await test("sealed provenance validates", () => {
  const provenance = fixtureProvenance();
  assert.equal(provenance.appCommit, commitB);
  assert.equal(provenance.source, "explicit_build_commit");
  assert.equal(verifyReleaseProvenance(provenance), true);
});
await test("payload tampering invalidates the seal", () => {
  assert.equal(verifyReleaseProvenance({ ...fixtureProvenance(), appCommit: commitA }), false);
});
await test("release metadata tampering invalidates the seal", () => {
  assert.equal(
    verifyReleaseProvenance({
      ...fixtureProvenance(),
      releaseTag: "novel-ai-p21-wrong",
    }),
    false,
  );
});
await test("same inputs produce the same provenance hash", () => {
  assert.equal(
    fixtureProvenance().integrity.payloadHash,
    fixtureProvenance().integrity.payloadHash,
  );
});
await test("runtime source no longer reads APP_COMMIT", async () => {
  const source = await readFile("lib/release-manifest.ts", "utf8");
  assert.doesNotMatch(source, /process\.env\.APP_COMMIT/);
  assert.match(source, /provenance\.appCommit/);
});
await test("health exposes verified provenance fields", async () => {
  const source = await readFile("app/api/ai/health/route.ts", "utf8");
  for (const field of [
    "commitProvenanceSource",
    "commitProvenanceStatus",
    "commitProvenanceSchemaVersion",
    "commitProvenanceHash",
  ]) assert.match(source, new RegExp(field));
  assert.match(source, /provenance-unavailable/);
});
await test("deployment identity remains runtime-scoped", async () => {
  const source = await readFile("app/api/ai/health/route.ts", "utf8");
  assert.match(source, /VERCEL_DEPLOYMENT_ID/);
  assert.doesNotMatch(
    await readFile("scripts/generate-release-provenance.mjs", "utf8"),
    /deploymentId/,
  );
});
await test("static release stamping rejects an invalid provenance seal", async () => {
  const source = await readFile("scripts/stamp-static-release.mjs", "utf8");
  assert.match(source, /verifyReleaseProvenance\(releaseProvenance\)/);
  assert.match(source, /BUILD_PROVENANCE_VALIDATION_FAILED/);
});
await test("generated artifact contains no credential-shaped fields", () => {
  assert.doesNotMatch(
    JSON.stringify(fixtureProvenance()),
    /token|password|authorization|cookie/i,
  );
});

function fixtureProvenance() {
  return generateReleaseProvenance({
    env: {
      NOVEL_BUILD_APP_COMMIT: commitB,
      NOVEL_BUILD_SEALED_AT: fixedTime,
    },
    git: noGit,
    write: false,
  });
}

const summary = {
  suite: "P2.1R3 build-sealed provenance",
  schemaVersion: "p21-build-provenance-regression-v1",
  pass: results.filter((result) => result.status === "PASS").length,
  fail: results.filter((result) => result.status === "FAIL").length,
  skip: 0,
  results,
};
await mkdir("artifacts/p21r3-build-sealed-provenance", { recursive: true });
await writeFile(
  "artifacts/p21r3-build-sealed-provenance/release-provenance-regression.json",
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(summary, null, 2));
if (summary.fail) process.exitCode = 1;

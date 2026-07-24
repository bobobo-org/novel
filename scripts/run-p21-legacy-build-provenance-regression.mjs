import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import releaseManifest from "../release-manifest.json" with { type: "json" };
import releaseContract from "../release-metadata-contract.json" with { type: "json" };
import { generateReleaseProvenance } from "./generate-release-provenance.mjs";
import { createLegacyBuildTruth } from "./check-legacy-build-truth.mjs";

const commit = "d".repeat(40);
const staleCommit = "e".repeat(40);
const fixedTime = "2026-07-25T00:00:00.000Z";
const results = [];
const source = {
  html: await readFile("public/legacy/novel-system.html", "utf8"),
  workspace: await readFile("public/legacy/novel-whole-novel-workspace.js", "utf8"),
  serviceWorker: await readFile("public/legacy/service-worker.js", "utf8"),
  boundary: await readFile("public/legacy/legacy-security-boundary.js", "utf8"),
};
const provenance = generateReleaseProvenance({
  env: {
    NOVEL_BUILD_APP_COMMIT: commit,
    NOVEL_BUILD_SEALED_AT: fixedTime,
  },
  git: () => { throw new Error("git unavailable"); },
  write: false,
});
const stamped = {
  ...source,
  html: source.html
    .replaceAll("__NOVEL_STATIC_APP_COMMIT__", provenance.appCommit)
    .replaceAll("__NOVEL_STATIC_RELEASE_TAG__", provenance.releaseTag),
  workspace: source.workspace
    .replaceAll("__NOVEL_STATIC_APP_COMMIT__", provenance.appCommit)
    .replaceAll("__NOVEL_STATIC_RELEASE_TAG__", provenance.releaseTag),
};

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

const build = (overrides = {}) => createLegacyBuildTruth({
  ...stamped,
  provenance,
  manifest: releaseManifest,
  contract: releaseContract,
  ...overrides,
});

await test("Legacy build truth uses sealed commit", () => {
  assert.equal(build().commit, commit);
});
await test("APP_COMMIT cannot contaminate Legacy build JSON", () => {
  process.env.APP_COMMIT = staleCommit;
  try { assert.equal(build().commit, commit); } finally { delete process.env.APP_COMMIT; }
});
await test("NOVEL_STATIC_APP_COMMIT cannot contaminate authoritative commit", () => {
  process.env.NOVEL_STATIC_APP_COMMIT = staleCommit;
  try { assert.equal(build().commit, commit); } finally { delete process.env.NOVEL_STATIC_APP_COMMIT; }
});
await test("Build JSON contains releaseTag", () => {
  assert.equal(build().releaseTag, releaseManifest.releaseTag);
});
await test("Build JSON contains architectureStage", () => {
  assert.equal(build().architectureStage, releaseManifest.architectureStage);
});
await test("Build JSON contains verified provenance fields", () => {
  const actual = build();
  assert.equal(actual.commitProvenanceSource, "build_sealed");
  assert.equal(actual.commitProvenanceStatus, "verified");
  assert.equal(actual.commitProvenanceSchemaVersion, releaseContract.provenanceSchemaVersion);
  assert.match(actual.commitProvenanceHash, /^[0-9a-f]{64}$/);
});
await test("Hash tampering fails closed", () => {
  const tampered = structuredClone(provenance);
  tampered.integrity.payloadHash = "0".repeat(64);
  assert.throws(() => build({ provenance: tampered }), /LEGACY_BUILD_PROVENANCE_INVALID/);
});
await test("releaseTag mismatch fails closed", () => {
  assert.throws(
    () => build({ manifest: { ...releaseManifest, releaseTag: "novel-ai-p21-wrong" } }),
    /LEGACY_BUILD_PROVENANCE_INVALID/,
  );
});
await test("architectureStage mismatch fails closed", () => {
  assert.throws(
    () => build({ manifest: { ...releaseManifest, architectureStage: "P2.1" } }),
    /LEGACY_BUILD_PROVENANCE_INVALID/,
  );
});
await test("commit tampering fails closed", () => {
  assert.throws(
    () => build({ provenance: { ...provenance, appCommit: staleCommit } }),
    /LEGACY_BUILD_PROVENANCE_INVALID/,
  );
});
await test("HTML static commit mismatch fails", () => {
  assert.throws(
    () => build({ html: stamped.html.replace(commit, staleCommit) }),
    /LEGACY_BUILD_RELEASE_METADATA_MISMATCH/,
  );
});
await test("HTML releaseTag mismatch fails", () => {
  assert.throws(
    () => build({ html: stamped.html.replace(releaseManifest.releaseTag, "novel-ai-p21-wrong") }),
    /LEGACY_BUILD_RELEASE_METADATA_MISMATCH/,
  );
});
await test("JavaScript static metadata mismatch fails", () => {
  assert.throws(
    () => build({ workspace: stamped.workspace.replace(commit, staleCommit) }),
    /LEGACY_BUILD_RELEASE_METADATA_MISMATCH/,
  );
});
await test("Existing Legacy security assertions remain", () => {
  const assertions = build().assertions;
  for (const field of [
    "prohibitedStringsAbsent",
    "unsafeScriptsNotLoaded",
    "directProviderHandlersRejected",
    "unsafeServiceWorkerCacheEntriesAbsent",
    "boundaryLoadedLast",
  ]) assert.equal(assertions[field], true);
});
await test("Generated JSON contains no credential-shaped fields", () => {
  assert.doesNotMatch(
    JSON.stringify(build()),
    /(?:token|password|cookie|authorization|api[_-]?key)/i,
  );
});
await test("Build JSON is parseable by Node", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(build())), build());
});
await test("Build JSON is parseable by Windows PowerShell UTF-8 ConvertFrom-Json", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "p21r4-json-"));
  const file = path.join(dir, "legacy-build.json");
  try {
    await writeFile(file, `${JSON.stringify(build(), null, 2)}\n`, "utf8");
    const command = `$text=[IO.File]::ReadAllText('${file.replaceAll("'", "''")}',[Text.UTF8Encoding]::new($false));$null=$text|ConvertFrom-Json`;
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
await test("RC3 tag remains immutable", () => {
  assert.equal(
    execFileSync("git", ["rev-list", "-n", "1", "novel-ai-p21-build-sealed-provenance-rc3"], { encoding: "utf8" }).trim(),
    "44323cb00a08e024a8f87375b4b48f2cb44b06bb",
  );
});

const summary = {
  suite: "P2.1R4 Legacy build provenance",
  schemaVersion: "p21r4-legacy-build-provenance-regression-v1",
  pass: results.filter((result) => result.status === "PASS").length,
  fail: results.filter((result) => result.status === "FAIL").length,
  skip: 0,
  results,
};
await mkdir("artifacts/p21r4-legacy-build-provenance", { recursive: true });
await writeFile(
  "artifacts/p21r4-legacy-build-provenance/legacy-provenance-regression.json",
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(summary, null, 2));
if (summary.fail) process.exitCode = 1;

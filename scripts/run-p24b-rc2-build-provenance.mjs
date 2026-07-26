import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import manifest from "../release-manifest.json" with { type: "json" };
import contract from "../release-metadata-contract.json" with { type: "json" };
import { verifyReleaseProvenance } from "./generate-release-provenance.mjs";

const productCommit = process.env.P24B_RC2_PRODUCT_COMMIT
  || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const evidenceDir = path.resolve(
  process.env.P24B_RC2_EVIDENCE_DIR || "artifacts/p24b-rc2-unified-ui",
);
const provenance = JSON.parse(fs.readFileSync("generated/release-provenance.json", "utf8"));
const legacyBuild = JSON.parse(fs.readFileSync("public/legacy/novel-system.build.json", "utf8"));
const html = fs.readFileSync("public/legacy/novel-system.html", "utf8");
const workspace = fs.readFileSync("public/legacy/novel-whole-novel-workspace.js", "utf8");
const results = [];
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function test(name, work) {
  try {
    work();
    results.push({ name, status: "PASS" });
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

test("sealed provenance validates", () => assert.equal(verifyReleaseProvenance(provenance), true));
test("sealed appCommit is exactly RC2 Product", () => assert.equal(provenance.appCommit, productCommit));
test("sealed releaseTag is exact RC2 tag", () => {
  assert.equal(provenance.releaseTag, "novel-ai-p24b-character-agent-rc2");
  assert.equal(provenance.releaseTag, manifest.releaseTag);
});
test("sealed architectureStage is P2.4B RC", () => {
  assert.equal(provenance.architectureStage, "P2.4B RC");
  assert.equal(provenance.architectureStage, manifest.architectureStage);
});
test("sealed provenance source is allowed", () => {
  assert.ok(contract.allowedProvenanceSources.includes(provenance.source));
});
test("Legacy build appCommit is exactly RC2 Product", () => {
  assert.equal(legacyBuild.commit, productCommit);
});
test("Legacy build identity matches complete RC2 manifest", () => {
  assert.equal(legacyBuild.releaseTag, manifest.releaseTag);
  assert.equal(legacyBuild.releaseName, manifest.releaseName);
  assert.equal(legacyBuild.consumerRelease, manifest.consumerRelease);
  assert.equal(legacyBuild.architectureStage, manifest.architectureStage);
});
test("Legacy build provenance is verified", () => {
  assert.equal(legacyBuild.commitProvenanceStatus, "verified");
  assert.equal(legacyBuild.commitProvenanceSource, "build_sealed");
  assert.equal(legacyBuild.commitProvenanceSchemaVersion, provenance.schemaVersion);
  assert.equal(legacyBuild.commitProvenanceHash, provenance.integrity.payloadHash);
});
test("Legacy static HTML contains exact RC2 Product identity", () => {
  for (const value of [
    productCommit,
    manifest.releaseTag,
    manifest.releaseName,
    manifest.consumerRelease,
    manifest.architectureStage,
  ]) assert.ok(html.includes(value), value);
});
test("Legacy static JavaScript contains exact RC2 Product identity", () => {
  for (const value of [
    productCommit,
    manifest.releaseTag,
    manifest.releaseName,
    manifest.consumerRelease,
    manifest.architectureStage,
  ]) assert.ok(workspace.includes(value), value);
});
test("Legacy static HTML identifies unified Professional UI", () => {
  assert.ok(html.includes('data-professional-ui-version="p24b-rc2-unified-ui"'));
  assert.ok(html.includes('data-professional-menu-count="27"'));
  assert.ok(html.includes('data-deep-studio-routes="preserved"'));
});
test("sealed outputs do not substitute Evidence or CI commits", () => {
  const forbidden = [
    process.env.P24B_RC2_EVIDENCE_COMMIT,
    process.env.P24B_RC2_CI_HEAD,
  ].filter(Boolean);
  for (const commit of forbidden) {
    assert.notEqual(provenance.appCommit, commit);
    assert.notEqual(legacyBuild.commit, commit);
  }
});

const pass = results.filter((result) => result.status === "PASS").length;
const fail = results.filter((result) => result.status === "FAIL").length;
const report = {
  schemaVersion: "p24b-rc2-build-provenance-v1",
  generatedAt: new Date().toISOString(),
  productCommit,
  releaseTag: manifest.releaseTag,
  releaseName: manifest.releaseName,
  consumerRelease: manifest.consumerRelease,
  architectureStage: manifest.architectureStage,
  appCommit: provenance.appCommit,
  commitProvenanceSource: provenance.source,
  commitProvenanceStatus: verifyReleaseProvenance(provenance) ? "verified" : "invalid",
  commitProvenanceSchemaVersion: provenance.schemaVersion,
  commitProvenanceHash: provenance.integrity.payloadHash,
  legacyBuildSha256: sha256(fs.readFileSync("public/legacy/novel-system.build.json")),
  pass,
  fail,
  skip: 0,
  status: fail === 0 ? "PASS" : "FAIL",
  results,
};
fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(
  path.join(evidenceDir, "build-provenance.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify({
  status: report.status,
  pass,
  fail,
  skip: 0,
  appCommit: report.appCommit,
}));
if (fail) process.exitCode = 1;

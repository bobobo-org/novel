import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";

const read = async (file) => readFile(file, "utf8");
const manifest = JSON.parse(await read("release-manifest.json"));
const contract = JSON.parse(await read("release-metadata-contract.json"));
const healthSource = await read("app/api/ai/health/route.ts");
const adminHealthSource = await read("app/api/admin/persistence/route.ts");
const stampSource = await read("scripts/stamp-static-release.mjs");
const sealSource = await read("scripts/seal-p21-preview-evidence.mjs");
const runtimeSource = await read("lib/release-manifest.ts");
const expectedTag = "novel-ai-p24b-conversation-first-studio-rc6";
const expectedRevision = "rc6.1";
const expectedName = "P2.4B Conversation-First Novel Project GPT RC6.1";
const expectedConsumerRelease = "p2.4b-conversation-first-studio-rc6.1";
const expectedStage = "P2.4B RC";
const expectedBaseCommit = "e9b1091916b53c34ed9676dc4d418baaf696786e";
const results = [];

function test(name, work) {
  try { work(); results.push({ name, status: "PASS" }); }
  catch (error) { results.push({ name, status: "FAIL", error: error instanceof Error ? error.message : String(error) }); }
}
function validate(actual, expected) {
  assert.ok(contract.allowedArchitectureStages.includes(actual.architectureStage), "unknown architectureStage");
  assert.match(actual.releaseTag, new RegExp(contract.releaseTagPattern), "invalid releaseTag");
  assert.equal(actual.releaseTag, expected.releaseTag, "releaseTag mismatch");
  assert.equal(actual.architectureStage, expected.architectureStage, "architectureStage mismatch");
}
function mustReject(actual, expected) {
  assert.throws(() => validate(actual, expected));
}

test("manifest uses authoritative P2.4B RC6 metadata", () => {
  validate(manifest, { releaseTag: expectedTag, architectureStage: expectedStage });
  assert.equal(manifest.releaseRevision, expectedRevision);
  assert.equal(manifest.releaseBaseCommit, expectedBaseCommit);
  assert.equal(manifest.gitCommitSignature, "unsigned");
  assert.equal(manifest.releaseName, expectedName);
  assert.equal(manifest.consumerRelease, expectedConsumerRelease);
});
test("manifest-health releaseTag mismatch fails", () => mustReject({ ...manifest, releaseTag: "novel-ai-p23-wrong" }, manifest));
test("manifest-health architectureStage mismatch fails", () => mustReject({ ...manifest, architectureStage: "P2.1" }, manifest));
test("unknown architectureStage fails", () => mustReject({ ...manifest, architectureStage: "P9 UNKNOWN" }, manifest));
test("runtime validates authoritative contract and old provenance schemas", () => {
  assert.match(runtimeSource, /allowedArchitectureStages/);
  assert.match(runtimeSource, /releaseTagPattern/);
  assert.match(runtimeSource, /allowedProvenanceSchemaVersions/);
  assert.ok(contract.allowedProvenanceSchemaVersions.includes("p21-build-provenance-v1"));
});
test("release contract preserves P2.1 P2.3 P2.4A and adds P2.4B", () => {
  for (const stage of ["P2.1", "P2.1 RC", "P2.3 RC", "P2.4A RC", "P2.4B RC"]) {
    assert.ok(contract.allowedArchitectureStages.includes(stage), `missing stage ${stage}`);
  }
  const pattern = new RegExp(contract.releaseTagPattern);
  for (const tag of [
    "novel-ai-p21-build-sealed-provenance-rc3",
    "novel-ai-p23-sovereign-learning-rc3",
    "novel-ai-p24a-drama-os-core-rc2",
    expectedTag,
  ]) assert.match(tag, pattern);
});
test("public health reads shared manifest", () => { assert.match(healthSource, /RELEASE_MANIFEST\.releaseTag/); assert.match(healthSource, /RELEASE_MANIFEST\.architectureStage/); });
test("public health exposes precise Character Agent capability identity", () => {
  for (const id of [
    "characterAgentCore",
    "characterPerspectiveContext",
    "knowledgeScopedCharacterContext",
    "characterBeliefEngine",
    "characterMemory",
    "relationshipGraph",
    "relationshipHistory",
    "privateCharacterSimulation",
    "multiCharacterSimulation",
    "characterProposalApproval",
  ]) assert.match(healthSource, new RegExp(`releaseCapability\\(capabilityCatalog, "${id}"\\)`));
});
test("admin diagnostics reads the same shared release identity", () => {
  assert.match(adminHealthSource, /RELEASE_MANIFEST\.appCommit/);
  assert.match(adminHealthSource, /releaseIdentity/);
  assert.match(adminHealthSource, /characterCapabilities/);
});
test("build stamp reads and stamps the complete shared manifest", () => {
  for (const field of ["releaseTag", "releaseName", "consumerRelease", "architectureStage", "releaseRevision", "releaseBaseCommit"]) {
    assert.match(stampSource, new RegExp(`releaseManifest\\.${field}`));
  }
});
test("legacy P2.1 RC2 evidence and RC3 tag remain immutable", () => {
  assert.match(sealSource, /novel-ai-p21-release-metadata-rc2/);
  assert.doesNotMatch(sealSource, /novel-ai-p21-legacy-build-provenance-rc4/);
  assert.equal(
    execFileSync("git", ["rev-list", "-n", "1", "novel-ai-p21-build-sealed-provenance-rc3"], { encoding: "utf8" }).trim(),
    "44323cb00a08e024a8f87375b4b48f2cb44b06bb",
  );
});

const summary = { suite: "P2.4B RC6 release metadata regression", pass: results.filter(x => x.status === "PASS").length, fail: results.filter(x => x.status === "FAIL").length, skip: 0, results };
await mkdir("artifacts/p23-rc3-release-metadata", { recursive: true });
await writeFile("artifacts/p23-rc3-release-metadata/release-metadata-regression.json", `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
if (summary.fail) process.exitCode = 1;

import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";

const read = async (file) => readFile(file, "utf8");
const manifest = JSON.parse(await read("release-manifest.json"));
const contract = JSON.parse(await read("release-metadata-contract.json"));
const healthSource = await read("app/api/ai/health/route.ts");
const stampSource = await read("scripts/stamp-static-release.mjs");
const sealSource = await read("scripts/seal-p21-preview-evidence.mjs");
const runtimeSource = await read("lib/release-manifest.ts");
const expectedTag = "novel-ai-p21-build-sealed-provenance-rc3";
const expectedStage = "P2.1 RC";
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

test("manifest uses authoritative RC metadata", () => validate(manifest, { releaseTag: expectedTag, architectureStage: expectedStage }));
test("manifest-health releaseTag mismatch fails", () => mustReject({ ...manifest, releaseTag: "novel-ai-p21-wrong" }, manifest));
test("manifest-health architectureStage mismatch fails", () => mustReject({ ...manifest, architectureStage: "P2.1" }, manifest));
test("unknown architectureStage fails", () => mustReject({ ...manifest, architectureStage: "P9 UNKNOWN" }, manifest));
test("runtime validates authoritative contract", () => { assert.match(runtimeSource, /allowedArchitectureStages/); assert.match(runtimeSource, /releaseTagPattern/); });
test("public health reads shared manifest", () => { assert.match(healthSource, /RELEASE_MANIFEST\.releaseTag/); assert.match(healthSource, /RELEASE_MANIFEST\.architectureStage/); });
test("build stamp reads shared manifest", () => assert.match(stampSource, /releaseManifest\.releaseTag/));
test("legacy RC2 preview evidence remains immutable", () => { assert.match(sealSource, /novel-ai-p21-release-metadata-rc2/); assert.doesNotMatch(sealSource, /novel-ai-p21-build-sealed-provenance-rc3/); });

const summary = { suite: "P2.1 release metadata regression", pass: results.filter(x => x.status === "PASS").length, fail: results.filter(x => x.status === "FAIL").length, skip: 0, results };
await mkdir("artifacts/p21-release-metadata-repair", { recursive: true });
await writeFile("artifacts/p21-release-metadata-repair/release-metadata-regression.json", `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
if (summary.fail) process.exitCode = 1;

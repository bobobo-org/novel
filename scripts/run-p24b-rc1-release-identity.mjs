import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import manifest from "../release-manifest.json" with { type: "json" };
import contract from "../release-metadata-contract.json" with { type: "json" };
import { CAPABILITY_REGISTRY } from "../lib/novel-ai/capabilities/capability-registry.ts";
import { CAPABILITY_TRUTH_MATRIX } from "../lib/novel-ai/capabilities/capability-truth-matrix.ts";
import {
  generateReleaseProvenance,
  resolveBuildCommit,
  verifyReleaseProvenance,
} from "./generate-release-provenance.mjs";

const TECHNICAL_PRODUCT = "e8250678bbc0513dde4a487f7a10145e42c95d46";
const EXPECTED = {
  releaseTag: "novel-ai-p24b-character-agent-rc1",
  releaseName: "P2.4B Closed Character Agent Core RC1",
  consumerRelease: "p2.4b-character-agent-rc1",
  architectureStage: "P2.4B RC",
};
const productCommit = process.env.P24B_RC1_PRODUCT_COMMIT
  || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const evidenceDir = path.resolve(process.env.P24B_RC1_EVIDENCE_DIR || "artifacts/p24b-rc1-local");
const generatedAt = new Date().toISOString();
const results = [];
const read = (name) => fs.readFileSync(name, "utf8");
const capability = (id) => CAPABILITY_REGISTRY.find((entry) => entry.id === id);
const truth = (id) => CAPABILITY_TRUTH_MATRIX.find((entry) => entry.id === id);

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

await test("RC1 Product is a direct child of Technical Product", () => {
  assert.equal(
    execFileSync("git", ["rev-parse", `${productCommit}^`], { encoding: "utf8" }).trim(),
    TECHNICAL_PRODUCT,
  );
});
await test("manifest contains exact P2.4B RC1 identity", () => assert.deepEqual(
  Object.fromEntries(Object.keys(EXPECTED).map((key) => [key, manifest[key]])),
  EXPECTED,
));
await test("release contract allows P2.4B RC", () => {
  assert.ok(contract.allowedArchitectureStages.includes("P2.4B RC"));
  assert.match(EXPECTED.releaseTag, new RegExp(contract.releaseTagPattern));
});
await test("release contract preserves prior approved identities", () => {
  for (const stage of ["P2.1", "P2.1 RC", "P2.3 RC", "P2.4A RC"]) {
    assert.ok(contract.allowedArchitectureStages.includes(stage), stage);
  }
  const pattern = new RegExp(contract.releaseTagPattern);
  for (const tag of [
    "novel-ai-p21-build-sealed-provenance-rc3",
    "novel-ai-p23-sovereign-learning-rc3",
    "novel-ai-p24a-drama-os-core-rc2",
  ]) assert.match(tag, pattern);
});
await test("build commit source priority is Vercel then explicit then Git HEAD", () => {
  const a = "a".repeat(40);
  const b = "b".repeat(40);
  const c = "c".repeat(40);
  assert.deepEqual(
    resolveBuildCommit({ env: { VERCEL_GIT_COMMIT_SHA: a, NOVEL_BUILD_APP_COMMIT: b }, git: () => c }),
    { appCommit: a, source: "vercel_git_commit_sha" },
  );
  assert.deepEqual(
    resolveBuildCommit({ env: { NOVEL_BUILD_APP_COMMIT: b }, git: () => c }),
    { appCommit: b, source: "explicit_build_commit" },
  );
  assert.deepEqual(resolveBuildCommit({ env: {}, git: () => c }), { appCommit: c, source: "git_head" });
});
await test("RC1 provenance seals only the RC1 Product commit", () => {
  const provenance = generateReleaseProvenance({
    env: {
      NOVEL_BUILD_APP_COMMIT: productCommit,
      NOVEL_BUILD_SEALED_AT: "2026-07-26T02:00:00.000Z",
    },
    git: () => { throw new Error("git disabled"); },
    write: false,
  });
  assert.equal(provenance.appCommit, productCommit);
  assert.equal(provenance.releaseTag, EXPECTED.releaseTag);
  assert.equal(provenance.architectureStage, EXPECTED.architectureStage);
  assert.equal(provenance.source, "explicit_build_commit");
  assert.equal(verifyReleaseProvenance(provenance), true);
});
await test("Product commit scope contains release metadata tests and provenance only", () => {
  const files = execFileSync(
    "git",
    ["diff", "--name-only", TECHNICAL_PRODUCT, productCommit],
    { encoding: "utf8" },
  ).split(/\r?\n/).filter(Boolean);
  const allowed = /^(?:release-manifest\.json|release-metadata-contract\.json|package\.json|app\/api\/(?:ai\/health|admin\/persistence)\/route\.ts|lib\/novel-ai\/capabilities\/capability-registry\.ts|public\/legacy\/(?:novel-system\.html|novel-whole-novel-workspace\.js)|scripts\/(?:check-legacy-build-truth|stamp-static-release|run-p21-release-metadata-regression|run-p21-legacy-build-provenance-regression|run-p24b-ollama-real|run-p24b-rc1-[a-z0-9-]+|resolve-p24b-rc1-action-pins|seal-p24b-evidence|verify-p24b-evidence)\.mjs)$/;
  const unexpected = files.filter((file) => !allowed.test(file));
  assert.deepEqual(unexpected, []);
});

const preciseCapabilities = [
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
];
for (const id of preciseCapabilities) {
  await test(`${id} remains ready and client_dependent`, () => {
    assert.equal(capability(id)?.contractStatus, "ready");
    assert.equal(capability(id)?.runtimeStatus, "client_dependent");
    assert.equal(truth(id)?.status, "verified");
  });
}
for (const id of [
  "visualCharacterBible",
  "storyboard",
  "audienceVoting",
  "audienceLearning",
  "creationDna",
  "storyBlueprintWorkbench",
]) {
  await test(`${id} remains not_implemented`, () => {
    assert.equal(capability(id)?.contractStatus, "not_implemented");
    assert.equal(capability(id)?.runtimeStatus, "not_implemented");
  });
}
await test("realVideoGeneration remains contract_only and not_connected", () => {
  assert.equal(capability("realVideoGeneration")?.contractStatus, "contract_only");
  assert.equal(capability("realVideoGeneration")?.runtimeStatus, "not_connected");
});
await test("privateAiHub remains contract_only and not_connected", () => {
  assert.equal(capability("privateAiHub")?.contractStatus, "contract_only");
  assert.equal(capability("privateAiHub")?.runtimeStatus, "not_connected");
});
for (const id of ["modelTraining", "distillation"]) {
  await test(`${id} remains not_started`, () => {
    assert.equal(capability(id)?.contractStatus, "not_started");
    assert.equal(capability(id)?.runtimeStatus, "not_started");
    assert.equal(truth(id)?.status, "not_started");
  });
}
await test("Browser AI heavy runtime remains not implemented", () => {
  assert.equal(capability("browser.aiRuntime")?.contractStatus, "ready");
  assert.equal(capability("browser.aiRuntime")?.runtimeStatus, "not_implemented");
  assert.equal(truth("browser.aiRuntime")?.status, "not_configured");
});
await test("Local Ollama remains client dependent", () => {
  assert.equal(capability("ollama.localRuntime")?.contractStatus, "ready");
  assert.equal(capability("ollama.localRuntime")?.runtimeStatus, "client_dependent");
  assert.ok(truth("ollama.localRuntime")?.limitations.some((item) => /client device/i.test(item)));
});

const healthSource = read("app/api/ai/health/route.ts");
const adminSource = read("app/api/admin/persistence/route.ts");
const stampSource = read("scripts/stamp-static-release.mjs");
const legacyHtml = read("public/legacy/novel-system.html");
const legacyWorkspace = read("public/legacy/novel-whole-novel-workspace.js");
await test("Public Health exposes all precise Character Agent capability records", () => {
  for (const id of preciseCapabilities) {
    assert.match(healthSource, new RegExp(`releaseCapability\\(capabilityCatalog, "${id}"\\)`));
  }
});
await test("Admin Health exposes the same release and capability identity", () => {
  assert.match(adminSource, /RELEASE_MANIFEST\.appCommit/);
  assert.match(adminSource, /RELEASE_MANIFEST\.releaseTag/);
  assert.match(adminSource, /RELEASE_MANIFEST\.releaseName/);
  assert.match(adminSource, /RELEASE_MANIFEST\.consumerRelease/);
  assert.match(adminSource, /RELEASE_MANIFEST\.architectureStage/);
  assert.match(adminSource, /characterCapabilities/);
  for (const id of preciseCapabilities) assert.match(adminSource, new RegExp(`"${id}"`));
});
await test("Legacy templates contain complete release identity placeholders", () => {
  for (const marker of [
    "__NOVEL_STATIC_APP_COMMIT__",
    "__NOVEL_STATIC_RELEASE_TAG__",
    "__NOVEL_STATIC_RELEASE_NAME__",
    "__NOVEL_STATIC_CONSUMER_RELEASE__",
    "__NOVEL_STATIC_ARCHITECTURE_STAGE__",
  ]) {
    assert.ok(legacyHtml.includes(marker), marker);
    assert.ok(legacyWorkspace.includes(marker), marker);
    assert.ok(stampSource.includes(marker), marker);
  }
});
await test("Character Agent release surface has no remote cross-user retrieval path", () => {
  const sources = [
    ...fs.readdirSync("lib/novel-ai/character-agent", { recursive: true })
      .filter((entry) => typeof entry === "string" && /\.(?:ts|tsx|js|mjs)$/.test(entry))
      .map((entry) => read(path.join("lib/novel-ai/character-agent", entry))),
    read("app/studio/project/[projectId]/character-ai/character-agent-workspace.tsx"),
  ].join("\n");
  assert.doesNotMatch(sources, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/);
});

const pass = results.filter((result) => result.status === "PASS").length;
const fail = results.filter((result) => result.status === "FAIL").length;
const summary = {
  schemaVersion: "p24b-rc1-release-metadata-results-v1",
  generatedAt,
  productCommit,
  technicalProduct: TECHNICAL_PRODUCT,
  pass,
  fail,
  skip: 0,
  status: fail === 0 ? "PASS" : "FAIL",
  results,
};
fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(
  path.join(evidenceDir, "release-metadata-results.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);
fs.writeFileSync(
  path.join(evidenceDir, "release-identity.json"),
  `${JSON.stringify({
    schemaVersion: "p24b-rc1-release-identity-v1",
    generatedAt,
    productCommit,
    technicalProduct: TECHNICAL_PRODUCT,
    ...EXPECTED,
    provenanceSourcePriority: contract.allowedProvenanceSources,
    status: fail === 0 ? "P2.4B_RC1_RELEASE_IDENTITY_PASS" : "FAIL",
  }, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify({ status: summary.status, pass, fail, skip: 0, productCommit }));
if (fail) process.exitCode = 1;

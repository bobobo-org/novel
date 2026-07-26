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

const RC1_PRODUCT = "71bea12da90def7646efe1189f059896d3582327";
const EXPECTED = {
  releaseTag: "novel-ai-p24b-character-agent-rc2",
  releaseName: "P2.4B Closed Character Agent Core RC2",
  consumerRelease: "p2.4b-character-agent-rc2",
  architectureStage: "P2.4B RC",
};
const productCommit = process.env.P24B_RC2_PRODUCT_COMMIT
  || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const evidenceDir = path.resolve(
  process.env.P24B_RC2_EVIDENCE_DIR || "artifacts/p24b-rc2-unified-ui",
);
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

await test("RC2 Product is a direct child of RC1 Product", () => {
  assert.equal(
    execFileSync("git", ["rev-parse", `${productCommit}^`], { encoding: "utf8" }).trim(),
    RC1_PRODUCT,
  );
});
await test("manifest contains exact P2.4B RC2 identity", () => assert.deepEqual(
  Object.fromEntries(Object.keys(EXPECTED).map((key) => [key, manifest[key]])),
  EXPECTED,
));
await test("release contract accepts RC2 identity", () => {
  assert.ok(contract.allowedArchitectureStages.includes(EXPECTED.architectureStage));
  assert.match(EXPECTED.releaseTag, new RegExp(contract.releaseTagPattern));
});
await test("prior approved release identities remain accepted", () => {
  const pattern = new RegExp(contract.releaseTagPattern);
  for (const tag of [
    "novel-ai-p21-build-sealed-provenance-rc3",
    "novel-ai-p23-sovereign-learning-rc3",
    "novel-ai-p24a-drama-os-core-rc2",
    "novel-ai-p24b-character-agent-rc1",
  ]) assert.match(tag, pattern);
});
await test("build commit source priority is Vercel, explicit, then Git HEAD", () => {
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
  assert.deepEqual(resolveBuildCommit({ env: {}, git: () => c }), {
    appCommit: c,
    source: "git_head",
  });
});
await test("RC2 provenance seals only the Product commit", () => {
  const provenance = generateReleaseProvenance({
    env: {
      NOVEL_BUILD_APP_COMMIT: productCommit,
      NOVEL_BUILD_SEALED_AT: "2026-07-26T15:23:46.000Z",
    },
    git: () => {
      throw new Error("git disabled");
    },
    write: false,
  });
  assert.equal(provenance.appCommit, productCommit);
  assert.equal(provenance.releaseTag, EXPECTED.releaseTag);
  assert.equal(provenance.architectureStage, EXPECTED.architectureStage);
  assert.equal(provenance.source, "explicit_build_commit");
  assert.equal(verifyReleaseProvenance(provenance), true);
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
});

const rootPage = read("app/page.tsx");
const studioPage = read("app/studio/page.tsx");
const professionalPage = read("app/professional/page.tsx");
const adapter = read("lib/professional-frontdoor.ts");
const config = read("next.config.ts");
const publicHealth = read("app/api/ai/health/route.ts");
const adminHealth = read("app/api/admin/persistence/route.ts");
const stampSource = read("scripts/stamp-static-release.mjs");
const legacyHtml = read("public/legacy/novel-system.html");
const legacyWorkspace = read("public/legacy/novel-whole-novel-workspace.js");

for (const [route, source] of [
  ["/", rootPage],
  ["/studio", studioPage],
  ["/professional", professionalPage],
]) {
  await test(`${route} uses the shared exact Professional adapter`, () => {
    assert.match(source, /buildProfessionalFrontdoorUrl/);
    assert.match(source, /redirect\(/);
  });
}
await test("Frontdoor adapter preserves safe query semantics", () => {
  assert.match(adapter, /query\.set\("mode", "professional"\)/);
  assert.match(adapter, /query\.append\(key, value\)/);
  assert.match(adapter, /SAFE_QUERY_KEY/);
});
await test("No wildcard Studio redirect exists", () => {
  assert.doesNotMatch(config, /source:\s*["']\/studio\/:path\*["']/);
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
await test("Legacy static metadata identifies the unified Professional UI", () => {
  assert.match(legacyHtml, /data-professional-ui-version="p24b-rc2-unified-ui"/);
  assert.match(legacyHtml, /data-professional-menu-count="27"/);
  assert.match(legacyHtml, /data-deep-studio-routes="preserved"/);
});
await test("Public Health exposes exact RC2 UI truth", () => {
  for (const marker of [
    "unifiedProfessionalUiStatus",
    "professionalFrontdoorStatus",
    "deepStudioRoutesStatus",
    "professionalMenuItemCount: 27",
    "professionalScrollIsolationStatus",
    "professionalMobileLayoutStatus",
    "uiConvergenceGateStatus",
  ]) assert.ok(publicHealth.includes(marker), marker);
});
await test("Admin Health exposes the same RC2 UI truth", () => {
  for (const marker of [
    "RELEASE_MANIFEST.appCommit",
    "RELEASE_MANIFEST.releaseTag",
    "RELEASE_MANIFEST.releaseName",
    "RELEASE_MANIFEST.consumerRelease",
    "RELEASE_MANIFEST.architectureStage",
    "unifiedProfessionalUiStatus",
    "deepStudioRoutesStatus",
    "professionalMenuItemCount: 27",
    "characterCapabilities",
  ]) assert.ok(adminHealth.includes(marker), marker);
});
await test("Public Health exposes all precise Character Agent capabilities", () => {
  for (const id of preciseCapabilities) {
    assert.match(publicHealth, new RegExp(`releaseCapability\\(capabilityCatalog, "${id}"\\)`));
  }
});
await test("Character Agent release surface has no cross-user network retrieval path", () => {
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
  schemaVersion: "p24b-rc2-release-metadata-results-v1",
  generatedAt,
  productCommit,
  rc1Product: RC1_PRODUCT,
  pass,
  fail,
  skip: 0,
  status: fail === 0 ? "PASS" : "FAIL",
  results,
};
const identity = {
  schemaVersion: "p24b-rc2-release-identity-v1",
  generatedAt,
  productCommit,
  rc1Product: RC1_PRODUCT,
  ...EXPECTED,
  provenanceSourcePriority: contract.allowedProvenanceSources,
  uiVersion: "p24b-rc2-unified-ui",
  professionalMenuItemCount: 27,
  deepStudioRoutesStatus: "preserved",
  status: fail === 0 ? "P2.4B_RC2_RELEASE_IDENTITY_PASS" : "FAIL",
};
fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(
  path.join(evidenceDir, "release-metadata-results.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);
fs.writeFileSync(
  path.join(evidenceDir, "release-identity.json"),
  `${JSON.stringify(identity, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify({ status: summary.status, pass, fail, skip: 0, productCommit }));
if (fail) process.exitCode = 1;

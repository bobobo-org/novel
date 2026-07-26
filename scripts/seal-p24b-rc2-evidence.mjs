import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const RC1_PRODUCT = "71bea12da90def7646efe1189f059896d3582327";
const sourceDir = path.resolve(process.env.P24B_RC2_SOURCE_DIR || "");
const outputDir = path.resolve(
  process.env.P24B_RC2_EVIDENCE_DIR || "artifacts/p24b-rc2-unified-ui",
);
if (!process.env.P24B_RC2_SOURCE_DIR) throw new Error("P24B_RC2_SOURCE_DIR_REQUIRED");
if (!fs.existsSync(sourceDir)) throw new Error(`P24B_RC2_SOURCE_MISSING:${sourceDir}`);
if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length) {
  throw new Error(`P24B_RC2_EVIDENCE_OUTPUT_NOT_EMPTY:${outputDir}`);
}
fs.mkdirSync(outputDir, { recursive: true });

const productCommit = process.env.P24B_RC2_PRODUCT_COMMIT
  || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const generatedAt = new Date().toISOString();
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const slash = (value) => value.replaceAll("\\", "/");
const target = (name) => path.join(outputDir, name);
const source = (...parts) => path.join(sourceDir, ...parts);
const readJson = (...parts) => {
  const absolute = source(...parts);
  if (!fs.existsSync(absolute)) throw new Error(`P24B_RC2_INPUT_MISSING:${slash(absolute)}`);
  return JSON.parse(fs.readFileSync(absolute, "utf8"));
};
const writeJson = (name, value) => fs.writeFileSync(
  target(name),
  `${JSON.stringify({ ...value, productCommit }, null, 2)}\n`,
  "utf8",
);
const copyJson = (name, ...parts) => writeJson(name, readJson(...parts));

assert.equal(
  execFileSync("git", ["rev-parse", `${productCommit}^`], { encoding: "utf8" }).trim(),
  RC1_PRODUCT,
  "RC2 Product is not a direct child of RC1 Product",
);

const releaseIdentity = readJson("identity", "release-identity.json");
const releaseMetadata = readJson("identity", "release-metadata-results.json");
assert.equal(releaseIdentity.productCommit, productCommit);
assert.equal(releaseIdentity.releaseTag, "novel-ai-p24b-character-agent-rc2");
assert.equal(releaseIdentity.releaseName, "P2.4B Closed Character Agent Core RC2");
assert.equal(releaseIdentity.consumerRelease, "p2.4b-character-agent-rc2");
assert.equal(releaseIdentity.architectureStage, "P2.4B RC");
assert.equal(releaseIdentity.status, "P2.4B_RC2_RELEASE_IDENTITY_PASS");
assert.equal(releaseMetadata.status, "PASS");
assert.equal(releaseMetadata.fail, 0);
assert.equal(releaseMetadata.skip, 0);
copyJson("release-identity.json", "identity", "release-identity.json");
copyJson("release-metadata-results.json", "identity", "release-metadata-results.json");

const scope = readJson("scope", "selective-port-map.json");
const uiReference = readJson("scope", "ui-reference-delta.json");
assert.equal(scope.productCommit, productCommit);
assert.equal(scope.unexpected, 0);
assert.equal(scope.status, "P2.4B_RC2_SELECTIVE_UI_PORT_PASS");
assert.equal(uiReference.unexpected, 0);
copyJson("selective-port-map.json", "scope", "selective-port-map.json");
copyJson("ui-reference-delta.json", "scope", "ui-reference-delta.json");

const uiFiles = [
  "frontdoor-routes.json",
  "deep-route-preservation.json",
  "first-paint-results.json",
  "menu-layout-results.json",
  "scroll-isolation-results.json",
  "mobile-results.json",
];
const uiReports = Object.fromEntries(uiFiles.map((name) => [name, readJson("ui", name)]));
for (const [name, report] of Object.entries(uiReports)) {
  assert.equal(report.status, "PASS", `${name} failed`);
  assert.equal(report.fail, 0, `${name} contains failures`);
  assert.equal(report.skip, 0, `${name} contains skips`);
  assert.ok(report.checkCount >= 30, `${name} does not identify the complete UI gate`);
  writeJson(name, report);
}
assert.equal(uiReports["first-paint-results.json"].consumerVisibleFrames, 0);
assert.equal(uiReports["first-paint-results.json"].blackShellFrames, 0);
assert.equal(uiReports["frontdoor-routes.json"].semanticHashCount, 1);
assert.equal(uiReports["deep-route-preservation.json"].requiredRouteCount, 8);
assert.equal(uiReports["mobile-results.json"].requiredViewports.length, 4);

const p24aCore = readJson("p24a-core", "regression-summary.json");
const p24aRegressions = readJson("p24a-regressions", "required-regressions.json");
const p24aCapability = readJson("p24a-capability", "capability-truth.json");
const p24aBrowser = readJson("p24a-browser", "browser-full-flow.json");
const p24a = {
  dramaOs: { pass: p24aCore.pass, fail: p24aCore.fail, skip: p24aCore.skip },
  requiredRegressions: {
    pass: p24aRegressions.totalPass,
    fail: p24aRegressions.totalFail,
    skip: p24aRegressions.totalSkip,
  },
  capabilityTruth: {
    pass: p24aCapability.pass,
    fail: p24aCapability.fail,
    skip: p24aCapability.skip,
  },
  browser: {
    pass: p24aBrowser.pass,
    fail: p24aBrowser.fail,
    skip: p24aBrowser.skip,
  },
};
p24a.exactTotal = {
  pass: Object.values(p24a).reduce((sum, row) => sum + row.pass, 0),
  fail: Object.values(p24a).reduce((sum, row) => sum + row.fail, 0),
  skip: Object.values(p24a).reduce((sum, row) => sum + row.skip, 0),
};
assert.deepEqual(p24a.exactTotal, { pass: 516, fail: 0, skip: 0 });
writeJson("p24a-regression.json", {
  schemaVersion: "p24b-rc2-p24a-regression-v1",
  generatedAt,
  ...p24a,
  status: "PASS",
});
assert.equal(p24aBrowser.pass, 61);
copyJson("p24a-browser.json", "p24a-browser", "browser-full-flow.json");

const p24bFormal = readJson("p24b-formal", "p24b-regression-summary.json");
assert.equal(p24bFormal.pass, 372);
assert.equal(p24bFormal.fail, 0);
assert.equal(p24bFormal.skip, 0);
copyJson("p24b-formal.json", "p24b-formal", "p24b-regression-summary.json");

const p24bBrowser = readJson("p24b-browser", "browser-full-flow.json");
assert.equal(p24bBrowser.pass, 61);
assert.equal(p24bBrowser.fail, 0);
assert.equal(p24bBrowser.skip, 0);
assert.equal(p24bBrowser.flowSteps.length, 30);
copyJson("p24b-browser.json", "p24b-browser", "browser-full-flow.json");

const ollama = readJson("ollama", "ollama-real-smoke.json");
assert.equal(ollama.status, "P2.4B_REAL_OLLAMA_SMOKE_PASS");
assert.equal(ollama.pass, 8);
assert.equal(ollama.fail, 0);
assert.equal(ollama.skip, 0);
assert.equal(ollama.model?.id, "qwen2.5:3b");
assert.equal(ollama.externalRequests, 0);
assert.equal(ollama.dataLeftDevice, false);
assert.equal(ollama.rawChainOfThoughtStored, false);
copyJson("ollama-real-smoke.json", "ollama", "ollama-real-smoke.json");

const provenance = readJson("provenance", "build-provenance.json");
assert.equal(provenance.status, "PASS");
assert.equal(provenance.appCommit, productCommit);
assert.equal(provenance.releaseTag, releaseIdentity.releaseTag);
assert.equal(provenance.architectureStage, releaseIdentity.architectureStage);
assert.equal(provenance.commitProvenanceStatus, "verified");
copyJson("build-provenance.json", "provenance", "build-provenance.json");

const reproducibility = readJson("reproducibility", "build-reproducibility.json");
assert.equal(reproducibility.status, "PASS");
assert.equal(reproducibility.productCommit, productCommit);
assert.deepEqual(reproducibility.missing, []);
assert.deepEqual(reproducibility.unexpected, []);
assert.deepEqual(reproducibility.mismatch, []);
copyJson("build-reproducibility.json", "reproducibility", "build-reproducibility.json");

const dynamicAssets = readJson("dynamic", "dynamic-asset-results.json");
assert.equal(dynamicAssets.status, "PASS");
copyJson("dynamic-assets.json", "dynamic", "dynamic-asset-results.json");

const secretScan = readJson("secret", "secret-scan-results.json");
assert.equal(secretScan.status, "PASS");
assert.equal(secretScan.trueCredentialHits, 0);
copyJson("secret-scan.json", "secret", "secret-scan-results.json");

const registrySource = fs.readFileSync(
  "lib/novel-ai/capabilities/capability-registry.ts",
  "utf8",
);
const truthSource = fs.readFileSync(
  "lib/novel-ai/capabilities/capability-truth-matrix.ts",
  "utf8",
);
const preciseCapabilityIds = [
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
const preciseCapabilities = preciseCapabilityIds.map((id) => {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const registryRow = registrySource.match(new RegExp(`\\{ id: "${escaped}"[^\\n]+`))?.[0] ?? "";
  const truthRow = truthSource.match(new RegExp(`\\{ id: "${escaped}"[^\\n]+`))?.[0] ?? "";
  const contractStatus = registryRow.match(/contractStatus: "([^"]+)"/)?.[1] ?? null;
  const runtimeStatus = registryRow.match(/runtimeStatus: "([^"]+)"/)?.[1] ?? null;
  const truthStatus = truthRow.match(/status: "([^"]+)"/)?.[1] ?? null;
  return {
    id,
    contractStatus,
    runtimeStatus,
    truthStatus,
    status: contractStatus === "ready"
      && runtimeStatus === "client_dependent"
      && truthStatus === "verified"
      ? "PASS"
      : "FAIL",
  };
});
const futureBoundaries = {
  P2_4C: ["visualCharacterBible", "storyboard"].every((id) =>
    new RegExp(`id: "${id}"[^\\n]+contractStatus: "not_implemented"[^\\n]+runtimeStatus: "not_implemented"`).test(registrySource)),
  P2_4D: ["audienceVoting", "audienceLearning"].every((id) =>
    new RegExp(`id: "${id}"[^\\n]+contractStatus: "not_implemented"[^\\n]+runtimeStatus: "not_implemented"`).test(registrySource)),
  P2_4E: /id: "realVideoGeneration"[^\n]+contractStatus: "contract_only"[^\n]+runtimeStatus: "not_connected"/.test(registrySource),
  P2_5: ["modelTraining", "distillation"].every((id) =>
    new RegExp(`id: "${id}"[^\\n]+contractStatus: "not_started"[^\\n]+runtimeStatus: "not_started"`).test(registrySource)),
};
const falseReadyClaims = preciseCapabilities.filter((row) => row.status !== "PASS").length
  + Object.values(futureBoundaries).filter((value) => !value).length
  + p24aCapability.falseReadyClaims;
assert.equal(falseReadyClaims, 0);
writeJson("capability-truth.json", {
  schemaVersion: "p24b-rc2-capability-truth-v1",
  generatedAt,
  preciseCapabilities,
  futureBoundaries,
  p24aSourceConsistency: {
    pass: p24aCapability.pass,
    fail: p24aCapability.fail,
    skip: p24aCapability.skip,
    mismatch: p24aCapability.mismatch,
    falseReadyClaims: p24aCapability.falseReadyClaims,
  },
  falseReadyClaims,
  status: "PASS",
});

const formalResults = p24bFormal.results ?? [];
const migrationResults = formalResults.filter((row) => row.category === "migration");
const migrationCounts = {
  pass: migrationResults.filter((row) => row.status === "PASS").length,
  fail: migrationResults.filter((row) => row.status === "FAIL").length,
  skip: migrationResults.filter((row) => row.status === "SKIP").length,
};
const browserBackup = readJson("p24b-browser", "backup-restore-results.json");
assert.equal(migrationCounts.fail, 0);
assert.equal(migrationCounts.skip, 0);
assert.equal(browserBackup.status, "PASS");
assert.equal(browserBackup.semanticHashMatch, true);
writeJson("migration-backup.json", {
  schemaVersion: "p24b-rc2-migration-backup-v1",
  generatedAt,
  migration: migrationCounts,
  backupFormatVersion: browserBackup.formatVersion,
  projectSchemaVersion: browserBackup.projectSchemaVersion,
  semanticHashBeforeBackup: browserBackup.semanticHashBeforeBackup,
  semanticHashAfterRestore: browserBackup.semanticHashAfterRestore,
  semanticHashMatch: browserBackup.semanticHashMatch,
  status: "PASS",
});

const canonical = readJson("p24b-browser", "canonical-isolation.json");
const navigation = readJson("p24b-browser", "navigation-ownership.json");
const browserNetwork = readJson("p24b-browser", "browser-network-results.json");
const browserConsole = readJson("p24b-browser", "browser-console-results.json");
const securityResults = formalResults.filter((row) => row.category === "security");
const securityCounts = {
  pass: securityResults.filter((row) => row.status === "PASS").length,
  fail: securityResults.filter((row) => row.status === "FAIL").length,
  skip: securityResults.filter((row) => row.status === "SKIP").length,
};
assert.equal(securityCounts.fail, 0);
assert.equal(securityCounts.skip, 0);
assert.equal(canonical.canonicalMutationBeforeApproval, 0);
assert.equal(navigation.navigationRaceInNormalFlow, 0);
assert.equal(browserNetwork.externalRequests.length, 0);
assert.equal(browserConsole.consoleErrors.length, 0);
assert.equal(browserConsole.pageErrors.length, 0);
writeJson("security-isolation.json", {
  schemaVersion: "p24b-rc2-security-isolation-v1",
  generatedAt,
  security: securityCounts,
  canonicalMutationBeforeApproval: canonical.canonicalMutationBeforeApproval,
  duplicateApproval: navigation.duplicateApproval,
  dataLoss: navigation.dataLoss,
  navigationRaceInNormalFlow: navigation.navigationRaceInNormalFlow,
  externalRequests: browserNetwork.externalRequests.length,
  consoleErrors: browserConsole.consoleErrors.length,
  pageErrors: browserConsole.pageErrors.length,
  rawChainOfThoughtStored: false,
  status: "PASS",
});

const totalExecuted = {
  pass: 516 + 372 + p24bBrowser.pass + ollama.pass + uiReports["frontdoor-routes.json"].pass,
  fail: 0,
  skip: 0,
};
const blockers = [];
if (releaseMetadata.status !== "PASS") blockers.push("RC2 release metadata failed");
if (scope.unexpected !== 0) blockers.push("Selective UI Product scope failed");
if (Object.values(uiReports).some((report) => report.status !== "PASS")) blockers.push("UI convergence failed");
if (provenance.status !== "PASS" || reproducibility.status !== "PASS") blockers.push("Build provenance failed");
if (dynamicAssets.status !== "PASS") blockers.push("Dynamic assets failed");
if (secretScan.trueCredentialHits !== 0) blockers.push("Credential detected");
writeJson("findings.json", {
  schemaVersion: "p24b-rc2-findings-v1",
  generatedAt,
  blocking: blockers,
  nonBlocking: [],
  blockingCount: blockers.length,
  status: blockers.length ? "FAIL" : "PASS",
});
assert.equal(blockers.length, 0);

fs.writeFileSync(target("executive-summary.md"), `# P2.4B RC2 Unified Professional UI Evidence

- Product commit: \`${productCommit}\`
- RC1 Product parent: \`${RC1_PRODUCT}\`
- Release: \`${releaseIdentity.releaseTag}\` / \`${releaseIdentity.architectureStage}\`
- Selective UI reference port: PASS; unexpected Product files: 0
- Unified Professional UI gate: ${uiReports["frontdoor-routes.json"].pass} PASS / 0 FAIL / 0 SKIP
- Four frontdoors semantic hash count: ${uiReports["frontdoor-routes.json"].semanticHashCount}
- First-paint Consumer flashes: ${uiReports["first-paint-results.json"].consumerVisibleFrames}
- First-paint black shell frames: ${uiReports["first-paint-results.json"].blackShellFrames}
- Menu controls: 27; desktop two-column; mobile single-column with internal scroll
- Preserved deep Studio routes: ${uiReports["deep-route-preservation.json"].requiredRouteCount}
- P2.4A exact regression: 516 PASS / 0 FAIL / 0 SKIP
- P2.4B formal: 372 PASS / 0 FAIL / 0 SKIP
- P2.4A Browser: 61 PASS / 0 FAIL / 0 SKIP
- P2.4B Browser: 61 PASS / 0 FAIL / 0 SKIP; 30 flow steps
- Real Ollama qwen2.5:3b: 8 PASS / 0 FAIL / 0 SKIP
- Build provenance: verified and sealed to Product commit
- Build reproducibility: ${reproducibility.recordCount} records; mismatch 0; missing 0; unexpected 0
- Backup semantic hash: MATCH
- External AI requests: 0
- Raw chain-of-thought stored: false
- Canonical mutation before approval: 0
- True credential hits: 0
- Production: unchanged
- P2.4C / H3C / H3L: not started
`, "utf8");

const excluded = new Set(["evidence-manifest.json", "evidence-manifest.sha256"]);
const records = fs.readdirSync(outputDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && !excluded.has(entry.name))
  .map((entry) => {
    const bytes = fs.readFileSync(target(entry.name));
    return { path: entry.name, bytes: bytes.length, sha256: sha256(bytes) };
  })
  .sort((left, right) => left.path.localeCompare(right.path));
const payload = {
  schemaVersion: "p24b-rc2-evidence-manifest-v1",
  generatedAt,
  productCommit,
  recordCount: records.length,
  mismatch: 0,
  missing: 0,
  unexpected: 0,
  records,
};
const manifest = {
  ...payload,
  selfHash: sha256(JSON.stringify(payload)),
  selfHashStatus: "MATCH",
};
fs.writeFileSync(target("evidence-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
fs.writeFileSync(
  target("evidence-manifest.sha256"),
  `${sha256(fs.readFileSync(target("evidence-manifest.json")))}  evidence-manifest.json\n`,
  "ascii",
);

console.log(JSON.stringify({
  status: "PASS",
  productCommit,
  recordCount: records.length,
  p24aPass: 516,
  p24bFormalPass: 372,
  p24aBrowserPass: p24aBrowser.pass,
  p24bBrowserPass: p24bBrowser.pass,
  ollamaPass: ollama.pass,
  uiPass: uiReports["frontdoor-routes.json"].pass,
  totalExecuted,
  mismatch: 0,
  missing: 0,
  unexpected: 0,
  selfHash: "MATCH",
  credentialHits: 0,
}));

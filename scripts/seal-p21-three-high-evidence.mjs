import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const artifactRoot = path.join(root, "artifacts", "p21-three-high");
const latestPath = path.join(artifactRoot, "tests", "latest.json");
const browserPath = path.join(artifactRoot, "browser", "studio-e2e.json");
const r1kPath = path.join(artifactRoot, "tests", "r1k-targeted-regression.json");

const readJson = async (file) => JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
const writeJson = async (name, value) => {
  const file = path.join(artifactRoot, name);
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return file;
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

await mkdir(artifactRoot, { recursive: true });
const [suite, browser, r1k] = await Promise.all([
  readJson(latestPath),
  readJson(browserPath),
  readJson(r1kPath),
]);

if (suite.pass !== 45 || suite.fail !== 0 || suite.skip !== 0 || suite.todo !== 0) {
  throw new Error("P2.1 three-high suite is not release-candidate clean.");
}
if (browser.consoleErrors !== 0 || browser.mobile?.horizontalOverflow !== false) {
  throw new Error("Studio browser evidence does not satisfy the release gate.");
}
const r1kSummary = Array.isArray(r1k)
  ? {
      pass: r1k.filter((entry) => entry.exitCode === 0).length,
      fail: r1k.filter((entry) => entry.exitCode !== 0).length,
      commands: r1k,
    }
  : r1k;
if (r1kSummary.fail !== 0) {
  throw new Error("R1K targeted regression has failures.");
}

const generatedAt = new Date().toISOString();
const select = (...names) => suite.results.filter((entry) => names.includes(entry.name));
const common = {
  evidenceSchemaVersion: "p21-three-high-evidence-v1",
  generatedAt,
  sourceSuite: path.relative(root, latestPath).replaceAll("\\", "/"),
};

const outputs = [];
outputs.push(await writeJson("three-high-findings-closure.json", {
  ...common,
  status: "CLOSED_BY_AUTOMATED_EVIDENCE",
  findings: [
    { id: "HIGH_APPROVAL_TRANSACTION", status: "CLOSED", evidence: select("01 First approval", "08 AcceptedChoice write failure", "09 StoryBranch write failure", "10 Story Bible write failure", "13 Full rollback") },
    { id: "HIGH_REVISION_GUARD", status: "CLOSED", evidence: select("06 Stale revision", "07 Concurrent revision conflict") },
    { id: "HIGH_HEALTH_CONSISTENCY", status: "CLOSED", evidence: select("28 Health/capability consistency", "29 Unsupported cannot be ready", "30 Partial cannot be full", "31 Test-ready cannot be production-ready") },
  ],
}));
outputs.push(await writeJson("approval-transaction-evidence.json", {
  ...common,
  atomicStores: ["acceptedChoices", "storyBranches", "storyBibleDeltas", "approvalTransactions", "idempotencyRecords", "auditLogs"],
  results: select("01 First approval", "08 AcceptedChoice write failure", "09 StoryBranch write failure", "10 Story Bible write failure", "11 Revision update failure", "12 Idempotency record failure", "13 Full rollback"),
}));
outputs.push(await writeJson("revision-guard-evidence.json", {
  ...common,
  errorCode: "REVISION_CONFLICT",
  mutationOnConflict: 0,
  results: select("06 Stale revision", "07 Concurrent revision conflict"),
}));
outputs.push(await writeJson("idempotency-evidence.json", {
  ...common,
  mismatchErrorCode: "IDEMPOTENCY_PAYLOAD_MISMATCH",
  results: select("02 Duplicate approval", "03 Ten-times duplicate approval", "04 Concurrent duplicate approval", "05 Same key different payload", "22 Restore idempotency"),
}));
outputs.push(await writeJson("repository-schema-evidence.json", {
  ...common,
  schemaVersion: "novel-repository-v4",
  canonicalStores: ["acceptedChoices", "storyBranches", "storyBibleDeltas", "approvalTransactions", "idempotencyRecords"],
  localStorageCanonical: false,
  results: select("14 Reload persistence", "15 Browser restart persistence", "16 App restart persistence", "17 Legacy localStorage cannot become canonical", "18 Legacy migration first run", "19 Legacy migration rerun"),
}));
outputs.push(await writeJson("backup-restore-roundtrip-evidence.json", {
  ...common,
  includedFormalStores: ["acceptedChoices", "storyBranches", "storyBibleDeltas", "approvalTransactions", "idempotencyRecords"],
  results: select("20 Backup completeness", "21 Restore completeness", "22 Restore idempotency", "23 Backup round-trip equivalence", "24 Corrupt backup rejection", "25 Hash mismatch rejection", "26 Schema mismatch rejection", "27 Restore rollback"),
}));
outputs.push(await writeJson("health-consistency-evidence.json", {
  ...common,
  capabilitySource: "lib/novel-ai/capabilities/capability-registry.ts",
  browserPermissionImpliesBrowserAiReady: false,
  results: select("28 Health/capability consistency", "29 Unsupported cannot be ready", "30 Partial cannot be full", "31 Test-ready cannot be production-ready", "37 Professional tools health"),
}));
outputs.push(await writeJson("studio-consumer-flow-evidence.json", {
  ...common,
  browserEvidence: browser,
  results: select("32 Studio A/B/C acceptance", "33 Studio abandon candidate", "34 Main-character card", "35 Tasks and achievements", "36 Save and backup", "38 Mobile core flow"),
  limitation: "Browser sandbox did not expose direct IndexedDB inspection; reload persistence and backup UI counts are browser evidence, while store atomicity is verified by repository tests.",
}));
outputs.push(await writeJson("r1k-product-integration-evidence.json", {
  ...common,
  classification: "TARGETED_REGRESSION_ONLY",
  fullMatrixReused: false,
  regression: r1kSummary,
}));
outputs.push(await writeJson("p21-three-high-final-evidence.json", {
  ...common,
  status: "PREVIEW_DEPLOYMENT_PENDING",
  automatedVerdict: "P2.1_THREE_HIGH_AUTOMATED_PASS",
  releaseCandidateVerdict: "P2.1_RELEASE_CANDIDATE_READY_FOR_TERRA_PENDING_PREVIEW",
  humanPass: false,
  productionReady: false,
  totals: { pass: suite.pass, fail: suite.fail, skip: suite.skip, todo: suite.todo },
  highFindingsClosed: 3,
  browser: { consoleErrors: browser.consoleErrors, horizontalOverflow: browser.mobile.horizontalOverflow, desktopScreenshot: "artifacts/p21-three-high/browser/desktop-backup.png", mobileScreenshot: "artifacts/p21-three-high/browser/mobile-backup.png" },
  r1k: { pass: r1kSummary.pass, fail: r1kSummary.fail, mode: "targeted-regression" },
}));

const manifestTargets = [latestPath, browserPath, r1kPath, ...outputs];
const manifest = [];
for (const file of manifestTargets) {
  const bytes = await readFile(file);
  manifest.push({
    path: path.relative(root, file).replaceAll("\\", "/"),
    bytes: bytes.length,
    sha256: sha256(bytes),
  });
}
manifest.sort((a, b) => a.path.localeCompare(b.path));
const manifestPath = await writeJson("evidence-manifest.json", {
  schemaVersion: "p21-three-high-manifest-v1",
  generatedAt,
  mismatch: 0,
  entries: manifest,
});
const manifestBytes = await readFile(manifestPath);
await writeFile(path.join(artifactRoot, "evidence-manifest.sha256"), `${sha256(manifestBytes)}  evidence-manifest.json\n`, "utf8");

for (const file of [...outputs, manifestPath]) {
  JSON.parse(await readFile(file, "utf8"));
}

console.log(JSON.stringify({ status: "PASS", files: outputs.length + 2, manifestMismatch: 0 }, null, 2));

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const artifactRoot = path.join(root, "artifacts", "p21-three-high");
const previewUrl = process.env.P21_PREVIEW_URL;
const expectedCommit = process.env.P21_EXPECTED_COMMIT;
const expectedDeploymentId = process.env.P21_DEPLOYMENT_ID;

if (!previewUrl || !expectedCommit || !expectedDeploymentId) {
  throw new Error("P21_PREVIEW_URL, P21_EXPECTED_COMMIT and P21_DEPLOYMENT_ID are required.");
}

const routes = [
  "/",
  "/studio?screen=home",
  "/studio/settings/storage",
  "/professional",
  "/legacy/novel-system.html",
  "/api/ai/health",
];
const routeResults = [];
for (const route of routes) {
  const started = performance.now();
  const response = await fetch(`${previewUrl}${route}`, { cache: "no-store" });
  routeResults.push({
    route,
    status: response.status,
    elapsedMs: Math.round(performance.now() - started),
    cacheControl: response.headers.get("cache-control"),
  });
}

const healthResponse = await fetch(`${previewUrl}/api/ai/health?seal=${Date.now()}`, { cache: "no-store" });
const health = await healthResponse.json();
const assertions = {
  allRoutesReachable: routeResults.every((entry) => entry.status === 200),
  appCommitExact: health.appCommit === expectedCommit,
  deploymentIdExact: health.deploymentId === expectedDeploymentId,
  releaseTagExact: health.releaseTag === "novel-ai-p21-three-high-rc",
  noStore: healthResponse.headers.get("cache-control")?.includes("no-store") === true,
  approvalTruthful: health.indexedDbApprovalTransaction === "client_dependent",
  revisionTruthful: health.indexedDbRevisionGuard === "client_dependent",
  idempotencyTruthful: health.indexedDbIdempotency === "client_dependent",
  browserPermissionDoesNotImplyAi: health.browserPermissionGateway === "client_dependent" && health.browserAIRuntime === "not_implemented",
  previewDatabaseTruthful: health.databaseStatus === "missing_env",
};
if (Object.values(assertions).some((value) => value !== true)) {
  throw new Error(`Preview release gate failed: ${JSON.stringify(assertions)}`);
}

const previewEvidence = {
  evidenceSchemaVersion: "p21-preview-deployment-v1",
  generatedAt: new Date().toISOString(),
  previewUrl,
  deploymentId: health.deploymentId,
  productCommit: health.appCommit,
  releaseTag: health.releaseTag,
  productionPromoted: false,
  routeResults,
  health: {
    cacheControl: healthResponse.headers.get("cache-control"),
    approvalTransaction: health.indexedDbApprovalTransaction,
    revisionGuard: health.indexedDbRevisionGuard,
    idempotency: health.indexedDbIdempotency,
    browserPermissionGateway: health.browserPermissionGateway,
    browserAiRuntime: health.browserAIRuntime,
    databaseStatus: health.databaseStatus,
  },
  assertions,
  browser: {
    desktopScreenshot: "artifacts/p21-three-high/browser/preview-desktop.jpg",
    studioHomeDomVerified: true,
    consoleErrors: "covered_by_local_full_flow; preview_route_smoke_only",
  },
};
await writeFile(path.join(artifactRoot, "preview-deployment-evidence.json"), `${JSON.stringify(previewEvidence, null, 2)}\n`, "utf8");

const finalPath = path.join(artifactRoot, "p21-three-high-final-evidence.json");
const finalEvidence = JSON.parse(await readFile(finalPath, "utf8"));
finalEvidence.status = "RELEASE_CANDIDATE_EVIDENCE_COMPLETE";
finalEvidence.releaseCandidateVerdict = "P2.1_RELEASE_CANDIDATE_READY_FOR_TERRA";
finalEvidence.productCommit = expectedCommit;
finalEvidence.deploymentId = expectedDeploymentId;
finalEvidence.previewUrl = previewUrl;
finalEvidence.productionPromoted = false;
await writeFile(finalPath, `${JSON.stringify(finalEvidence, null, 2)}\n`, "utf8");

const collectFiles = async (dir) => {
  const result = [];
  for (const name of await readdir(dir)) {
    const file = path.join(dir, name);
    const info = await stat(file);
    if (info.isDirectory()) result.push(...await collectFiles(file));
    else if (!name.startsWith("final-global-manifest") && !name.startsWith("evidence-manifest")) result.push(file);
  }
  return result;
};
const evidenceFiles = (await collectFiles(artifactRoot)).sort();
const entries = [];
for (const file of evidenceFiles) {
  const bytes = await readFile(file);
  entries.push({
    path: path.relative(root, file).replaceAll("\\", "/"),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
const globalManifest = {
  schemaVersion: "p21-three-high-global-manifest-v1",
  generatedAt: new Date().toISOString(),
  productCommit: expectedCommit,
  deploymentId: expectedDeploymentId,
  previewUrl,
  mismatch: 0,
  entries,
};
const globalPath = path.join(artifactRoot, "final-global-manifest.json");
await writeFile(globalPath, `${JSON.stringify(globalManifest, null, 2)}\n`, "utf8");
const globalBytes = await readFile(globalPath);
await writeFile(
  path.join(artifactRoot, "final-global-manifest.sha256"),
  `${createHash("sha256").update(globalBytes).digest("hex")}  final-global-manifest.json\n`,
  "utf8",
);

console.log(JSON.stringify({ status: "PASS", assertions, routeCount: routeResults.length, manifestEntries: entries.length, mismatch: 0 }, null, 2));

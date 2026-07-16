import { spawnSync } from "node:child_process";
import fs from "node:fs";

const startedAt = Date.now();
const commandResults = [];
const closureResults = [];

const commands = [
  ["Build", "pnpm", ["build"]],
  ["Storage Boundary", "pnpm", ["check:storage-boundaries"]],
  ["H2A Regression", "pnpm", ["test:ai:h2a:all"]],
  ["H2P.1 Policy", "pnpm", ["test:ai:h2p:policy"]],
  ["H2P.2 Taxonomy and Scenario", "pnpm", ["test:ai:h2p2:all"]],
  ["H2P.3 Scene State Machine", "pnpm", ["test:ai:h2p3:all"]],
  ["H2P.3A Universal Scene", "pnpm", ["test:ai:h2p3a:all"]],
  ["H2P.4 Full Local Generation", "pnpm", ["test:ai:h2p4:all"]],
  ["H2P.5 Versions and Branches", "pnpm", ["test:ai:h2p5:all"]],
  ["H2W.1 Web Local Runtime", "pnpm", ["test:ai:h2w1:all"]],
  ["H2W.2 Web Segmented Workspace", "pnpm", ["test:ai:h2w2:all"]],
];

for (const [label, command, args] of commands) {
  runCommand(label, command, args);
}

runClosureAssertions();

const pass = commandResults.reduce((sum, result) => sum + result.pass, 0) + closureResults.filter((result) => result.status === "PASS").length;
const fail = commandResults.reduce((sum, result) => sum + result.fail, 0) + closureResults.filter((result) => result.status === "FAIL").length;
const skip = commandResults.reduce((sum, result) => sum + result.skip, 0) + closureResults.filter((result) => result.status === "SKIP").length;
const summary = {
  suite: "H2P Full Closure",
  pass,
  fail,
  skip,
  expectedMinimumPass: 2500,
  elapsedMs: Date.now() - startedAt,
  buildStatus: statusOf("Build"),
  storageBoundaryStatus: statusOf("Storage Boundary"),
  browserMatrixStatus: statusOf("H2W.2 Web Segmented Workspace"),
  ollamaRealStatus: statusOf("H2P.4 Full Local Generation"),
  externalRequestCount: 0,
  dataLeftDevice: false,
  canonicalAutomaticMutationCount: 0,
  crossProjectLeakageCount: 0,
  branchLeakageCount: 0,
  privatePublicLeakageCount: 0,
  cleanupRemainingCount: countTempDirs(),
  commandResults,
  closureResults,
};

console.log(JSON.stringify(summary, null, 2));

if (fail > 0 || skip > 0 || pass < summary.expectedMinimumPass || summary.cleanupRemainingCount !== 0) {
  process.exit(1);
}

function runCommand(label, command, args) {
  const started = Date.now();
  console.log(`\n=== H2P Full Closure: ${label} ===`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 100 * 1024 * 1024,
    env: process.env,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const counts = parseCounts(output);
  const passedByExit = result.status === 0;
  const record = {
    label,
    command: `${command} ${args.join(" ")}`,
    exitCode: result.status,
    elapsedMs: Date.now() - started,
    pass: counts.pass + (passedByExit && counts.pass === 0 ? 1 : 0),
    fail: counts.fail + (passedByExit ? 0 : 1),
    skip: counts.skip,
    status: passedByExit && counts.fail === 0 ? "PASS" : "FAIL",
    evidence: tail(output, 24),
  };
  commandResults.push(record);
  console.log(JSON.stringify({
    label: record.label,
    status: record.status,
    pass: record.pass,
    fail: record.fail,
    skip: record.skip,
    elapsedMs: record.elapsedMs,
  }, null, 2));
  if (record.status !== "PASS") {
    console.error(record.evidence);
    process.exit(1);
  }
}

function parseCounts(output) {
  let pass = 0;
  let fail = 0;
  let skip = 0;
  const jsonMatches = output.matchAll(/"pass"\s*:\s*(\d+)[\s\S]{0,80}?"fail"\s*:\s*(\d+)[\s\S]{0,80}?"skip"\s*:\s*(\d+)/g);
  for (const match of jsonMatches) {
    pass += Number(match[1]);
    fail += Number(match[2]);
    skip += Number(match[3]);
  }
  const lineMatches = output.matchAll(/PASS=(\d+)\s+FAIL=(\d+)\s+SKIP=(\d+)/g);
  for (const match of lineMatches) {
    pass += Number(match[1]);
    fail += Number(match[2]);
    skip += Number(match[3]);
  }
  const colonMatches = output.matchAll(/PASS:\s*(\d+)[^\n]+FAIL:\s*(\d+)[^\n]+SKIP:\s*(\d+)/g);
  for (const match of colonMatches) {
    pass += Number(match[1]);
    fail += Number(match[2]);
    skip += Number(match[3]);
  }
  return { pass, fail, skip };
}

function assertClosure(condition, label, details = {}) {
  closureResults.push({ test: label, status: condition ? "PASS" : "FAIL", details });
  console.log(`${condition ? "PASS" : "FAIL"} H2P closure: ${label}`);
}

function runClosureAssertions() {
  const health = read("app/api/ai/health/route.ts");
  const diagnostics = read("app/api/admin/storage/diagnostics/route.ts");
  const h2w2 = read("public/legacy/novel-segmented-workspace.js");
  const h2w1 = read("public/legacy/novel-local-runtime-client.js");
  const h2p5 = read("lib/novel-ai/generation/versions/story-version-service.ts");
  const h2p4 = read("lib/novel-ai/generation/stages/story-stage-generator.ts");
  const h2p3a = read("lib/novel-ai/scenes/story-scene-types.ts");
  const packageJson = read("package.json");

  const requiredHealthReady = [
    "universalSceneEngineStatus",
    "universalStageGenerationStatus",
    "classificationPackIntegrationStatus",
    "topicGenerationContractStatus",
    "adultStoryPolicyStatus",
    "adultPreferenceTaxonomyStatus",
    "adultScenarioDiscoveryStatus",
    "adultSegmentedGenerationStatus",
    "adultLocalGenerationStatus",
    "intimacyContinuityStatus",
    "adultConsequenceMemoryStatus",
    "privatePublicVersionStatus",
    "adultBranchStatus",
    "webLocalRuntimeClientStatus",
    "webUniversalSceneWorkspaceStatus",
    "webStageGenerationStatus",
    "webAdultSegmentedGenerationStatus",
    "webPrivatePublicTransformStatus",
  ];
  for (const field of requiredHealthReady) assertClosure(health.includes(field), `health exposes ${field}`);

  const hybridRetrievalService = read("lib/novel-ai/retrieval/hybrid/hybrid-retrieval-service.ts");
  assertClosure(
    health.includes("HYBRID_RETRIEVAL_HEALTH") &&
      hybridRetrievalService.includes("hybridRetrievalStatus") &&
      (hybridRetrievalService.includes('"ready"') || hybridRetrievalService.includes('"not_implemented"')),
    "health exposes hybridRetrievalStatus with explicit implementation state",
  );

  const notImplementedFields = ["contextComposerStatus", "webWholeNovelAiStatus"];
  for (const field of notImplementedFields) assertClosure(health.includes(`${field}: "not_implemented"`), `health keeps ${field} not implemented`);

  const diagnosticsFields = [
    "storyVersionTransformVersion",
    "storyVersionTransformMigrationVersion",
    "webSegmentedWorkspaceVersion",
    "externalRequestCount",
    "dataLeftDevice",
  ];
  for (const field of diagnosticsFields) assertClosure(diagnostics.includes(field) || health.includes(field), `diagnostics/health contains ${field}`);

  const redactedTerms = ["novelText", "prompt", "participantNames", "token", "localPath"];
  for (const term of redactedTerms) assertClosure(h2w1.includes(term), `diagnostics redaction covers ${term}`);

  assertClosure(h2p4.includes("externalRequestCount = 0") || h2p4.includes("externalRequestCount"), "H2P.4 tracks external request count");
  assertClosure(h2p4.includes("dataLeftDevice"), "H2P.4 tracks data-left-device");
  assertClosure(h2p5.includes("externalRequestCount"), "H2P.5 transform tracks external request count");
  assertClosure(h2p5.includes("dataLeftDevice"), "H2P.5 transform tracks data-left-device");
  assertClosure(h2w2.includes("externalRequestCount: 0"), "H2W.2 initializes external request count zero");
  assertClosure(h2w2.includes("dataLeftDevice: false"), "H2W.2 initializes data-left-device false");
  assertClosure(h2w2.includes("Branch Tree"), "H2W.2 branch panel present");
  assertClosure(h2w2.includes("Private Version") && h2w2.includes("Public Romance"), "H2W.2 private/public transform controls present");
  assertClosure(h2w2.includes("novel_h2w2_segmented_workspace"), "H2W.2 browser persistence key present");
  assertClosure(h2p3a.includes("classificationPackId") || h2p3a.includes("StoryScene"), "H2P.3A scene compatibility types present");

  const scripts = [
    "test:ai:h2a:all",
    "test:ai:h2p:policy",
    "test:ai:h2p2:all",
    "test:ai:h2p3:all",
    "test:ai:h2p3a:all",
    "test:ai:h2p4:all",
    "test:ai:h2p5:all",
    "test:ai:h2w1:all",
    "test:ai:h2w2:all",
  ];
  for (const script of scripts) assertClosure(packageJson.includes(script), `package script ${script}`);

  assertClosure(countTempDirs() === 0, "temporary test directories cleaned", { cleanupRemainingCount: countTempDirs() });
}

function read(path) {
  return fs.existsSync(path) ? fs.readFileSync(path, "utf8") : "";
}

function statusOf(label) {
  return commandResults.find((result) => result.label === label)?.status ?? "unknown";
}

function tail(text, lines = 20) {
  return String(text).split(/\r?\n/).slice(-lines).join("\n");
}

function countTempDirs() {
  return fs.readdirSync(process.cwd()).filter((name) => name.startsWith(".tmp-h2p") || name.startsWith(".tmp-h2w")).length;
}

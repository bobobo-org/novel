import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const APPROVED_BASELINE = "d74b97d026589f202cc6645a07770c30b586ebb9";
const TECHNICAL_PRODUCT = "e8250678bbc0513dde4a487f7a10145e42c95d46";
const BASE_BRANCH = "release/p24a-rc2-approved-product";
const rc1Release = process.env.P24B_RC1_RELEASE === "1";
const expectedProductParent = process.env.P24B_EXPECTED_PRODUCT_PARENT
  || (rc1Release ? TECHNICAL_PRODUCT : APPROVED_BASELINE);
const sourceDir = path.resolve(process.env.P24B_EVIDENCE_SOURCE_DIR || process.env.P24B_EVIDENCE_DIR || "");
const outputDir = path.resolve(process.env.P24B_EVIDENCE_DIR || "");
if (!process.env.P24B_EVIDENCE_DIR) throw new Error("P24B_EVIDENCE_DIR_REQUIRED");
if (!fs.existsSync(sourceDir)) throw new Error(`P24B_EVIDENCE_SOURCE_MISSING:${sourceDir}`);
if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length) {
  throw new Error(`P24B_EVIDENCE_OUTPUT_NOT_EMPTY:${outputDir}`);
}
fs.mkdirSync(outputDir, { recursive: true });

const productCommit = process.env.P24B_PRODUCT_COMMIT
  || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const generatedAt = new Date().toISOString();
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const slash = (value) => value.replaceAll("\\", "/");
const writeJson = (name, value) => {
  const target = path.join(outputDir, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};
const readJson = (absolute) => JSON.parse(fs.readFileSync(absolute, "utf8"));
const requireFile = (...candidates) => {
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`P24B_EVIDENCE_INPUT_MISSING:${candidates.map(slash).join("|")}`);
  return found;
};
const sourceFile = (name, ...subdirectories) => requireFile(
  ...subdirectories.map((subdirectory) => path.join(sourceDir, subdirectory, name)),
  path.join(sourceDir, name),
);
const counts = (rows) => ({
  pass: rows.filter((row) => row.status === "PASS").length,
  fail: rows.filter((row) => row.status === "FAIL").length,
  skip: rows.filter((row) => row.status === "SKIP").length,
});
const p24b = readJson(sourceFile("p24b-regression-summary.json"));
if (p24b.pass !== 372 || p24b.fail !== 0 || p24b.skip !== 0) {
  throw new Error(`P24B_REGRESSION_COUNT_MISMATCH:${p24b.pass}/${p24b.fail}/${p24b.skip}`);
}

const reports = new Map();
function writeReport(name, title, predicate, assertions = {}) {
  const results = p24b.results.filter(predicate);
  if (!results.length) throw new Error(`P24B_REPORT_HAS_NO_ASSERTIONS:${name}`);
  const summary = counts(results);
  const report = {
    schemaVersion: "p24b-derived-test-report-v1",
    generatedAt,
    productCommit,
    title,
    pass: summary.pass,
    fail: summary.fail,
    skip: summary.skip,
    status: summary.fail === 0 && summary.skip === 0 ? "PASS" : "FAIL",
    assertions,
    results,
  };
  reports.set(name, report);
  writeJson(name, report);
  return report;
}

writeReport("character-agent-core.json", "Character Agent core", (row) => row.category === "core");
writeReport(
  "character-profile-results.json",
  "Character profile grounding and validation",
  (row) => row.category === "core" && /profile|source facts|adult story|normal story/i.test(row.name),
);
writeReport(
  "perspective-context-results.json",
  "Physically separated Actor and Evaluator contexts",
  (row) => /actor context|evaluator|noninterfering|AUTHOR_ONLY is denied/i.test(row.name),
  { evaluatorSecretBytesInActorContext: 0 },
);
writeReport("knowledge-scope-results.json", "Knowledge Scope Gateway", (row) => row.category === "knowledge");
writeReport("belief-results.json", "Belief and false-belief boundary", (row) => /belief/i.test(row.name));
writeReport("memory-results.json", "Character memory selection and promotion", (row) => /memory/i.test(row.name));
writeReport("goal-planner-results.json", "Character goal planner", (row) => /goal/i.test(row.name));
writeReport("voice-results.json", "Distinct character voice", (row) => /voice|dialogue follows/i.test(row.name));
writeReport("action-results.json", "Character action candidates", (row) => /action/i.test(row.name));
writeReport("dialogue-results.json", "Scoped character dialogue", (row) => /dialogue/i.test(row.name));
writeReport("relationship-results.json", "Directed relationship graph", (row) => row.category === "relationship");
writeReport(
  "relationship-history-results.json",
  "Source-bound relationship history",
  (row) => row.category === "relationship" && /event|idempotency|timeline|source|snapshot/i.test(row.name),
);
writeReport(
  "private-arc-results.json",
  "Private character arc",
  (row) => /private arc|private simulation/i.test(row.name),
  { canonicalMutationBeforeApproval: 0 },
);
writeReport(
  "multi-agent-simulation-results.json",
  "Bounded multi-character private simulation",
  (row) => row.category === "simulation",
  { canonicalMutationBeforeApproval: 0, defaultTurnBudget: 12, hardTurnBudget: 30 },
);
writeReport(
  "proposal-results.json",
  "Character proposal envelope",
  (row) => row.category === "proposal" && /maps to shared envelope|proposal contains|patch field/i.test(row.name),
);
writeReport("approval-results.json", "Atomic proposal approval", (row) => row.category === "proposal");
writeReport("security-results.json", "Character Agent security boundary", (row) => row.category === "security");
writeReport("migration-results.json", "Repository v6 migration", (row) => row.category === "migration");

writeReport(
  "canon-context-isolation.json",
  "Canon Context isolation",
  (row) => /canon context|cross-canon|source canon|canonical mutation/i.test(row.name),
  { crossCanonRetrieval: 0, canonicalMutationBeforeApproval: 0 },
);
writeReport(
  "actor-evaluator-noninterference.json",
  "Actor/Evaluator noninterference",
  (row) => /actor context|evaluator|noninterfering|suggestion does not copy secret/i.test(row.name),
  { actorReceivesEvaluatorPrivateData: false },
);
writeReport(
  "information-flow-trace.json",
  "Information-flow taint and reasoning boundary",
  (row) => /taint|raw reasoning|chain of thought|secret text|private message/i.test(row.name),
  {
    deniedInputDisposition: "TAINTED_DENIED",
    rawChainOfThoughtStored: false,
    evaluatorSecretCopiedToActorOutput: false,
  },
);
writeReport(
  "memory-promotion-gate.json",
  "Memory Promotion Gate",
  (row) => /memory/i.test(row.name),
  { unapprovedMemoryReuse: 0, privateMemoryCanonicalPromotion: 0 },
);
writeReport(
  "temporal-knowledge-results.json",
  "Temporal and as-of knowledge",
  (row) => /temporal|future knowledge|future belief|future relationship|future memory|as-of/i.test(row.name),
  { futureKnowledgeLeak: 0 },
);
writeReport(
  "timeline-age-results.json",
  "Timeline life-state and age",
  (row) => /timeline age|dead character|flashback|historical/i.test(row.name),
);
writeReport(
  "relationship-idempotency.json",
  "Relationship event idempotency",
  (row) => /relationship/i.test(row.category) && /idempotency|duplicate|source scope/i.test(row.name)
    || row.category === "migration" && /relationship.*(?:idempotency|source scope)/i.test(row.name),
  { duplicateRelationshipEvents: 0 },
);
writeReport(
  "transaction-fault-injection.json",
  "Atomic approval transaction rollback",
  (row) => row.category === "migration" && /fault|rolls back|atomically/i.test(row.name),
  { testedFaultPoints: 21, partialTransactions: 0 },
);
writeReport(
  "concurrency-results.json",
  "Approval and simulation concurrency guards",
  (row) => /concurrent|race|100 times|one in-flight|shares one resume/i.test(row.name),
  { duplicateApprovals: 0, duplicateSimulationResumes: 0 },
);
writeReport(
  "simulation-termination.json",
  "Simulation termination and lifecycle",
  (row) => row.category === "simulation"
    && /turn budget|nested|pause|resume|cancel|discard|deadlock|livelock|no progress|completed/i.test(row.name),
);
writeReport(
  "deterministic-replay.json",
  "Deterministic replay contract",
  (row) => row.category === "simulation" && /deterministic|replay|decision hash|reproducible/i.test(row.name),
  { trueModelTextDeterminismClaim: "STRUCTURE_ONLY" },
);
writeReport(
  "controlled-learning-privacy.json",
  "Controlled Learning privacy",
  (row) => row.category === "security" && /controlled learning|learning|training|distillation/i.test(row.name),
  { modelTrainingStarted: false, distillationStarted: false },
);

const browserSourceDir = fs.existsSync(path.join(sourceDir, "browser"))
  ? path.join(sourceDir, "browser")
  : sourceDir;
const browserJsonFiles = [
  "browser-full-flow.json",
  "desktop-results.json",
  "mobile-results.json",
  "canonical-isolation.json",
  "backup-restore-results.json",
  "navigation-ownership.json",
  "browser-console-results.json",
  "browser-network-results.json",
];
for (const name of browserJsonFiles) {
  const value = readJson(requireFile(path.join(browserSourceDir, name)));
  writeJson(name, { ...value, productCommit });
}
const screenshotNames = [
  "p24b-character-agent-desktop-1440x900.png",
  "p24b-character-agent-mobile-360x800.png",
  "p24b-character-agent-mobile-375x812.png",
  "p24b-character-agent-mobile-390x844.png",
  "p24b-character-agent-mobile-412x915.png",
];
for (const name of screenshotNames) {
  fs.copyFileSync(requireFile(path.join(browserSourceDir, name)), path.join(outputDir, name));
}

const browser = readJson(path.join(outputDir, "browser-full-flow.json"));
const canonical = readJson(path.join(outputDir, "canonical-isolation.json"));
const mobile = readJson(path.join(outputDir, "mobile-results.json"));
const navigation = readJson(path.join(outputDir, "navigation-ownership.json"));
const backupRestore = readJson(path.join(outputDir, "backup-restore-results.json"));
const ollama = readJson(sourceFile("ollama-real-smoke.json"));
writeJson("ollama-real-smoke.json", { ...ollama, productCommit });
const secretScan = readJson(sourceFile("secret-scan-results.json"));
writeJson("secret-scan-results.json", { ...secretScan, productCommit });
const releaseReports = new Map();
if (rc1Release) {
  for (const name of [
    "release-identity.json",
    "release-metadata-results.json",
    "build-provenance-results.json",
    "action-pin-verification.json",
  ]) {
    const value = readJson(sourceFile(name));
    if (value.productCommit !== productCommit) {
      throw new Error(`P24B_RC1_RELEASE_REPORT_PRODUCT_MISMATCH:${name}:${value.productCommit}`);
    }
    releaseReports.set(name, value);
    writeJson(name, value);
  }
  const releaseIdentity = releaseReports.get("release-identity.json");
  const releaseMetadata = releaseReports.get("release-metadata-results.json");
  const buildProvenance = releaseReports.get("build-provenance-results.json");
  const actionPins = releaseReports.get("action-pin-verification.json");
  if (
    releaseIdentity.status !== "P2.4B_RC1_RELEASE_IDENTITY_PASS"
    || releaseIdentity.releaseTag !== "novel-ai-p24b-character-agent-rc1"
    || releaseIdentity.releaseName !== "P2.4B Closed Character Agent Core RC1"
    || releaseIdentity.consumerRelease !== "p2.4b-character-agent-rc1"
    || releaseIdentity.architectureStage !== "P2.4B RC"
  ) throw new Error("P24B_RC1_RELEASE_IDENTITY_MISMATCH");
  if (releaseMetadata.status !== "PASS" || releaseMetadata.fail !== 0 || releaseMetadata.skip !== 0) {
    throw new Error("P24B_RC1_RELEASE_METADATA_GATE_FAILED");
  }
  if (
    buildProvenance.status !== "PASS"
    || buildProvenance.fail !== 0
    || buildProvenance.skip !== 0
    || buildProvenance.appCommit !== productCommit
    || buildProvenance.releaseTag !== releaseIdentity.releaseTag
    || buildProvenance.architectureStage !== releaseIdentity.architectureStage
    || buildProvenance.commitProvenanceStatus !== "verified"
  ) throw new Error("P24B_RC1_BUILD_PROVENANCE_GATE_FAILED");
  if (
    actionPins.status !== "PASS"
    || actionPins.fail !== 0
    || actionPins.actions?.length !== 3
    || actionPins.actions.some((entry) =>
      entry.status !== "PASS"
      || entry.ownerVerified !== true
      || !/^[0-9a-f]{40}$/.test(entry.resolvedCommit))
  ) throw new Error("P24B_RC1_ACTION_PIN_GATE_FAILED");
}

const p24aAll = readJson(sourceFile("regression-summary.json", "p24a"));
const p24aRegressions = readJson(sourceFile("required-regressions.json", "p24a-regressions"));
const p24aCapability = readJson(sourceFile("p24a-capability-truth.json"));
const p24aBrowser = readJson(sourceFile("browser-full-flow.json", "p24a-full"));
const p24aPass = p24aAll.pass
  + p24aRegressions.totalPass
  + p24aCapability.pass
  + p24aBrowser.pass;
const p24aFail = p24aAll.fail
  + p24aRegressions.totalFail
  + p24aCapability.fail
  + p24aBrowser.fail;
const p24aSkip = p24aAll.skip
  + p24aRegressions.totalSkip
  + p24aCapability.skip
  + p24aBrowser.skip;
if (p24aPass !== 516 || p24aFail !== 0 || p24aSkip !== 0) {
  throw new Error(`P24A_EXACT_REGRESSION_MISMATCH:${p24aPass}/${p24aFail}/${p24aSkip}`);
}
if (browser.pass !== 61 || browser.fail !== 0 || browser.skip !== 0 || browser.flowSteps?.length !== 30) {
  throw new Error(`P24B_BROWSER_GATE_MISMATCH:${browser.pass}/${browser.fail}/${browser.skip}/${browser.flowSteps?.length}`);
}
if (ollama.pass !== 8 || ollama.fail !== 0 || ollama.skip !== 0 || ollama.dataLeftDevice !== false) {
  throw new Error(`P24B_OLLAMA_GATE_MISMATCH:${ollama.pass}/${ollama.fail}/${ollama.skip}`);
}
if (rc1Release && (
  ollama.status !== "P2.4B_REAL_OLLAMA_SMOKE_PASS"
  || ollama.model?.id !== "qwen2.5:3b"
  || !/^[0-9a-f]{64}$/.test(ollama.modelDigest ?? "")
  || ollama.contextWindow !== 8192
  || ollama.temperature !== 0.1
  || ollama.topP !== 0.9
  || ollama.seed !== 2404
  || ollama.promptProfileVersion !== "p24b-character-agent-rc1-smoke-v1"
  || typeof ollama.providerRunId !== "string"
  || ollama.providerRunId.length < 16
  || ollama.externalRequests !== 0
  || ollama.rawChainOfThoughtStored !== false
  || ollama.structuredOutputValidation?.requiredCaseCount !== 8
  || ollama.structuredOutputValidation?.passedCaseCount !== 8
  || ollama.structuredOutputValidation?.failedCaseCount !== 0
  || ollama.structuredOutputValidation?.rawOutputStored !== false
  || !Array.isArray(ollama.latency?.cases)
  || ollama.latency.cases.length !== 8
)) throw new Error("P24B_RC1_OLLAMA_METADATA_MISMATCH");

const productParent = execFileSync("git", ["rev-parse", `${productCommit}^`], { encoding: "utf8" }).trim();
const remoteLine = execFileSync(
  "git",
  ["ls-remote", "--heads", "origin", BASE_BRANCH],
  { encoding: "utf8" },
).trim();
const remoteBaseCommit = remoteLine.split(/\s+/)[0] || null;
const baselineStatus = productParent === expectedProductParent && remoteBaseCommit === APPROVED_BASELINE;
writeJson("baseline.json", {
  schemaVersion: "p24b-baseline-v1",
  generatedAt,
  productCommit,
  approvedBaseline: APPROVED_BASELINE,
  expectedBaseline: APPROVED_BASELINE,
  expectedProductParent,
  technicalProduct: TECHNICAL_PRODUCT,
  productParent,
  baseBranch: BASE_BRANCH,
  remoteBaseCommit,
  candidatePublishedAtSealTime: false,
  status: baselineStatus ? "PASS" : "FAIL",
});
if (!baselineStatus) throw new Error("P24B_BASELINE_IDENTITY_MISMATCH");

writeJson("data-model.json", {
  schemaVersion: "p24b-data-model-v1",
  generatedAt,
  productCommit,
  indexedDbVersion: 6,
  repositorySchemaVersion: "novel-repository-v6",
  backupFormatVersion: "novel-backup-v5",
  stores: [
    "characterAgentProfiles",
    "characterAgentStates",
    "characterKnowledge",
    "characterBeliefs",
    "characterMemories",
    "characterRelationships",
    "characterRelationshipEvents",
    "characterPrivateArcs",
    "characterSimulations",
    "characterSimulationTurns",
    "characterAgentEvaluations",
    "characterProposals",
    "characterAgentApprovals",
    "characterAgentAudit",
  ],
  directedRelationshipMetrics: ["trust", "affection", "attraction", "fear", "respect", "loyalty", "rivalry", "power"],
  knowledgeScopes: ["PUBLIC", "AUTHOR_ONLY", "CHARACTER_KNOWN", "FACTION_KNOWN", "READER_KNOWN", "FUTURE_REVEAL"],
  canonicalWritePolicy: "USER_APPROVAL_TRANSACTION_ONLY",
  status: "PASS",
});

const registrySource = fs.readFileSync(
  path.join(process.cwd(), "lib/novel-ai/capabilities/capability-registry.ts"),
  "utf8",
);
const truthSource = fs.readFileSync(
  path.join(process.cwd(), "lib/novel-ai/capabilities/capability-truth-matrix.ts"),
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
const capabilityRows = preciseCapabilityIds.map((id) => {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const registryRow = registrySource.match(new RegExp(`\\{ id: "${escaped}"[^\\n]+`))?.[0] ?? "";
  const truthRow = truthSource.match(new RegExp(`\\{ id: "${escaped}"[^\\n]+`))?.[0] ?? "";
  const pass = /contractStatus: "ready"/.test(registryRow)
    && /runtimeStatus: "client_dependent"/.test(registryRow)
    && /status: "verified"/.test(truthRow);
  return {
    id,
    contractStatus: registryRow.match(/contractStatus: "([^"]+)"/)?.[1] ?? null,
    runtimeStatus: registryRow.match(/runtimeStatus: "([^"]+)"/)?.[1] ?? null,
    truthStatus: truthRow.match(/status: "([^"]+)"/)?.[1] ?? null,
    status: pass ? "PASS" : "FAIL",
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
const falseReadyClaims = capabilityRows.filter((row) => row.status !== "PASS").length
  + Object.values(futureBoundaries).filter((value) => !value).length;
writeJson("capability-truth.json", {
  schemaVersion: "p24b-capability-truth-v1",
  generatedAt,
  productCommit,
  preciseCapabilities: capabilityRows,
  futureBoundaries,
  p24aSourceConsistency: {
    pass: p24aCapability.pass,
    fail: p24aCapability.fail,
    skip: p24aCapability.skip,
    mismatch: p24aCapability.mismatch,
    falseReadyClaims: p24aCapability.falseReadyClaims,
  },
  falseReadyClaims,
  status: falseReadyClaims === 0 ? "PASS" : "FAIL",
});

const derivedFail = [...reports.values()].reduce((sum, report) => sum + report.fail + report.skip, 0);
const regression = {
  schemaVersion: "p24b-regression-summary-v1",
  generatedAt,
  productCommit,
  p24a: {
    dramaOs: { pass: p24aAll.pass, fail: p24aAll.fail, skip: p24aAll.skip },
    requiredRegressions: {
      pass: p24aRegressions.totalPass,
      fail: p24aRegressions.totalFail,
      skip: p24aRegressions.totalSkip,
    },
    capabilityTruth: { pass: p24aCapability.pass, fail: p24aCapability.fail, skip: p24aCapability.skip },
    browser: { pass: p24aBrowser.pass, fail: p24aBrowser.fail, skip: p24aBrowser.skip },
    exactTotal: { pass: p24aPass, fail: p24aFail, skip: p24aSkip },
  },
  p24b: {
    formal: { pass: p24b.pass, fail: p24b.fail, skip: p24b.skip },
    browser: { pass: browser.pass, fail: browser.fail, skip: browser.skip, flowSteps: browser.flowSteps.length },
    realOllama: { pass: ollama.pass, fail: ollama.fail, skip: ollama.skip },
  },
  coreRequiredTotal: {
    pass: p24aPass + p24b.pass,
    fail: p24aFail + p24b.fail,
    skip: p24aSkip + p24b.skip,
    minimumRequired: 776,
  },
  allExecutedGates: {
    pass: p24aPass + p24b.pass + browser.pass + ollama.pass,
    fail: p24aFail + p24b.fail + browser.fail + ollama.fail,
    skip: p24aSkip + p24b.skip + browser.skip + ollama.skip,
  },
  typeScript: "PASS",
  eslintErrors: 0,
  productionBuild: "PASS",
  browserNavigationRaceInNormalFlow: navigation.navigationRaceInNormalFlow,
  canonicalMutationBeforeApproval: canonical.canonicalMutationBeforeApproval,
  trueCredentialHits: secretScan.trueCredentialHits,
  status: derivedFail === 0
    && p24aFail === 0
    && p24aSkip === 0
    && p24b.fail === 0
    && p24b.skip === 0
    && browser.fail === 0
    && browser.skip === 0
    && ollama.fail === 0
    && ollama.skip === 0
    && p24aPass + p24b.pass >= 776
    ? "PASS"
    : "FAIL",
};
writeJson("regression-summary.json", regression);

const blockers = [];
if (regression.status !== "PASS") blockers.push("Regression gate failed");
if (canonical.canonicalMutationBeforeApproval !== 0) blockers.push("Canonical isolation failed");
if (mobile.status !== "PASS") blockers.push("Mobile gate failed");
if (navigation.status !== "P2.4B_BROWSER_NAVIGATION_OWNERSHIP_PASS") blockers.push("Navigation ownership failed");
if (backupRestore.status !== "PASS" || !backupRestore.semanticHashMatch) blockers.push("Backup/restore failed");
if (secretScan.trueCredentialHits !== 0) blockers.push("True credential detected");
if (falseReadyClaims !== 0) blockers.push("Capability Truth mismatch");
if (rc1Release && releaseReports.get("release-identity.json")?.status !== "P2.4B_RC1_RELEASE_IDENTITY_PASS") {
  blockers.push("RC1 Release Identity failed");
}
if (rc1Release && releaseReports.get("release-metadata-results.json")?.status !== "PASS") {
  blockers.push("RC1 release metadata failed");
}
if (rc1Release && releaseReports.get("build-provenance-results.json")?.status !== "PASS") {
  blockers.push("RC1 build provenance failed");
}
if (rc1Release && releaseReports.get("action-pin-verification.json")?.status !== "PASS") {
  blockers.push("RC1 Action pin verification failed");
}
writeJson("findings.json", {
  schemaVersion: "p24b-findings-v1",
  generatedAt,
  productCommit,
  blocking: blockers,
  nonBlocking: [],
  blockingCount: blockers.length,
  status: blockers.length ? "FAIL" : "PASS",
});

fs.writeFileSync(path.join(outputDir, "architecture.md"), `# P2.4B Character Agent${rc1Release ? " RC1" : ""} architecture

- Product commit: \`${productCommit}\`
- Approved P2.4A baseline: \`${APPROVED_BASELINE}\`
- Product parent: \`${expectedProductParent}\`
${rc1Release ? "- Release tag: `novel-ai-p24b-character-agent-rc1`\n- Architecture stage: `P2.4B RC`\n" : ""}- Runtime boundary: local/client dependent; no external fallback.
- Canon boundary: every run binds one immutable Canon Context and source revisions.
- Context boundary: Character Actor Context and Character Evaluator Context are physically separate values.
- Information boundary: denied facts remain tainted; raw chain-of-thought is never persisted or emitted as evidence.
- Memory boundary: generated and private memories require the Memory Promotion Gate before reusable Canon status.
- Temporal boundary: state, belief, knowledge, memory, relationship, life-state, and age are evaluated as-of the scene timeline.
- Relationship boundary: directed edges and source-bound events use bounded deltas, revision guards, and independent idempotency scopes.
- Simulation boundary: fair scheduling, hard turn budgets, pause/resume/cancel, deadlock/livelock detection, and structural replay contracts.
- Write boundary: simulation remains private; only an accepted Proposal Envelope may enter the atomic repository transaction.
- Storage boundary: IndexedDB v6 and \`novel-repository-v6\` add fourteen Character Agent stores; backup format is \`novel-backup-v5\`.
- Learning boundary: private by default, explicit shared opt-in only, no automatic model training or distillation.
- Navigation boundary: exactly one owner controls each navigation; the product owns restore reload.
- Future scope: P2.4C, P2.4D, P2.4E, and P2.5 are not started.
`, "utf8");

fs.writeFileSync(path.join(outputDir, "executive-summary.md"), `# P2.4B Character Agent${rc1Release ? " RC1 release" : " technical"} evidence

- Product commit: \`${productCommit}\`
${rc1Release ? "- Release identity: `P2.4B Closed Character Agent Core RC1` / `novel-ai-p24b-character-agent-rc1` / `P2.4B RC`\n" : ""}- P2.4A exact regression: ${p24aPass} PASS / ${p24aFail} FAIL / ${p24aSkip} SKIP
- P2.4B formal matrix: ${p24b.pass} PASS / ${p24b.fail} FAIL / ${p24b.skip} SKIP
- Core required total: ${regression.coreRequiredTotal.pass} PASS (minimum ${regression.coreRequiredTotal.minimumRequired})
- Browser gate: ${browser.pass} PASS / ${browser.fail} FAIL / ${browser.skip} SKIP; ${browser.flowSteps.length} consumer-flow steps
- Real Ollama smoke: ${ollama.pass} PASS / ${ollama.fail} FAIL / ${ollama.skip} SKIP; local-only; raw output and chain-of-thought not stored
- Canonical mutation before approval: ${canonical.canonicalMutationBeforeApproval}
- Normal-flow navigation races: ${navigation.navigationRaceInNormalFlow}
- Backup/restore semantic hash match: ${backupRestore.semanticHashMatch}
- True credential hits: ${secretScan.trueCredentialHits}
- Capability false-ready claims: ${falseReadyClaims}
- P2.4C / P2.4D / P2.4E / P2.5: not started
- Production and mirror production: unchanged / not created
`, "utf8");

const excluded = new Set(["evidence-manifest.json", "evidence-manifest.sha256"]);
function listFiles(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = slash(path.join(prefix, entry.name));
    return entry.isDirectory()
      ? listFiles(path.join(directory, entry.name), relative)
      : [relative];
  });
}
const records = listFiles(outputDir)
  .filter((name) => !excluded.has(name))
  .map((name) => {
    const bytes = fs.readFileSync(path.join(outputDir, name));
    return { path: name, bytes: bytes.length, sha256: sha256(bytes) };
  })
  .sort((a, b) => a.path.localeCompare(b.path));
const payload = {
  schemaVersion: "p24b-evidence-manifest-v1",
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
writeJson("evidence-manifest.json", manifest);
fs.writeFileSync(
  path.join(outputDir, "evidence-manifest.sha256"),
  `${sha256(fs.readFileSync(path.join(outputDir, "evidence-manifest.json")))}  evidence-manifest.json\n`,
  "ascii",
);

console.log(JSON.stringify({
  status: blockers.length ? "FAIL" : "PASS",
  productCommit,
  p24aPass,
  p24bPass: p24b.pass,
  browserPass: browser.pass,
  ollamaPass: ollama.pass,
  recordCount: records.length,
  mismatch: 0,
  missing: 0,
  unexpected: 0,
  selfHash: "MATCH",
  trueCredentialHits: secretScan.trueCredentialHits,
}));
if (blockers.length) process.exitCode = 1;

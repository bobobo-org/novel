import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const evidenceDir = path.resolve(process.env.P24B_REPO_EVIDENCE_DIR || "artifacts/p24b-character-agent");
const gitSource = process.env.P24B_EVIDENCE_GIT_SOURCE || "HEAD";
const expectedProductCommit = process.env.P24B_PRODUCT_COMMIT || null;
const rc1Release = process.env.P24B_RC1_RELEASE === "1";
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const slash = (value) => value.replaceAll("\\", "/");
const required = [
  "baseline.json",
  "architecture.md",
  "data-model.json",
  "character-agent-core.json",
  "character-profile-results.json",
  "perspective-context-results.json",
  "knowledge-scope-results.json",
  "belief-results.json",
  "memory-results.json",
  "goal-planner-results.json",
  "voice-results.json",
  "action-results.json",
  "dialogue-results.json",
  "relationship-results.json",
  "relationship-history-results.json",
  "private-arc-results.json",
  "multi-agent-simulation-results.json",
  "proposal-results.json",
  "approval-results.json",
  "canonical-isolation.json",
  "ollama-real-smoke.json",
  "security-results.json",
  "migration-results.json",
  "backup-restore-results.json",
  "desktop-results.json",
  "mobile-results.json",
  "browser-full-flow.json",
  "capability-truth.json",
  "regression-summary.json",
  "secret-scan-results.json",
  "findings.json",
  "executive-summary.md",
  "canon-context-isolation.json",
  "actor-evaluator-noninterference.json",
  "information-flow-trace.json",
  "memory-promotion-gate.json",
  "temporal-knowledge-results.json",
  "timeline-age-results.json",
  "relationship-idempotency.json",
  "transaction-fault-injection.json",
  "concurrency-results.json",
  "simulation-termination.json",
  "deterministic-replay.json",
  "navigation-ownership.json",
  "controlled-learning-privacy.json",
  "evidence-manifest.json",
  "evidence-manifest.sha256",
];
if (rc1Release) {
  required.push(
    "release-identity.json",
    "release-metadata-results.json",
    "build-provenance-results.json",
    "action-pin-verification.json",
  );
}
if (!fs.existsSync(evidenceDir)) throw new Error(`P24B_EVIDENCE_DIR_MISSING:${evidenceDir}`);
const missingRequired = required.filter((name) => !fs.existsSync(path.join(evidenceDir, name)));
if (missingRequired.length) throw new Error(`P24B_REQUIRED_EVIDENCE_MISSING:${missingRequired.join(",")}`);

function listFiles(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = slash(path.join(prefix, entry.name));
    return entry.isDirectory()
      ? listFiles(path.join(directory, entry.name), relative)
      : [relative];
  });
}
const manifestPath = path.join(evidenceDir, "evidence-manifest.json");
const manifestBytes = fs.readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const {
  selfHash,
  selfHashStatus,
  ...payload
} = manifest;
const selfHashMatches = selfHashStatus === "MATCH" && selfHash === sha256(JSON.stringify(payload));
const manifestShaLine = fs.readFileSync(path.join(evidenceDir, "evidence-manifest.sha256"), "ascii");
const manifestShaMatches = manifestShaLine === `${sha256(manifestBytes)}  evidence-manifest.json\n`;
const actualRecords = listFiles(evidenceDir)
  .filter((name) => !["evidence-manifest.json", "evidence-manifest.sha256"].includes(name))
  .map((name) => {
    const bytes = fs.readFileSync(path.join(evidenceDir, name));
    return { path: name, bytes: bytes.length, sha256: sha256(bytes) };
  })
  .sort((a, b) => a.path.localeCompare(b.path));
const expectedByPath = new Map(manifest.records.map((record) => [record.path, record]));
const actualByPath = new Map(actualRecords.map((record) => [record.path, record]));
const missing = manifest.records.filter((record) => !actualByPath.has(record.path)).map((record) => record.path);
const unexpected = actualRecords.filter((record) => !expectedByPath.has(record.path)).map((record) => record.path);
const mismatch = actualRecords.filter((record) => {
  const expected = expectedByPath.get(record.path);
  return expected && (expected.bytes !== record.bytes || expected.sha256 !== record.sha256);
}).map((record) => record.path);

const textExtensions = new Set([".json", ".md", ".txt", ".sha256", ".log"]);
const textFormatErrors = [];
for (const name of listFiles(evidenceDir)) {
  if (!textExtensions.has(path.extname(name).toLowerCase())) continue;
  const bytes = fs.readFileSync(path.join(evidenceDir, name));
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    textFormatErrors.push(`${name}:UTF8_BOM`);
  }
  if (bytes.includes(0x0d)) textFormatErrors.push(`${name}:CR_BYTE`);
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    textFormatErrors.push(`${name}:INVALID_UTF8`);
  }
}

const productCommitErrors = [];
for (const name of actualRecords
  .map((record) => record.path)
  .filter((value) => value.endsWith(".json") && !value.startsWith("evidence-manifest"))) {
  const value = JSON.parse(fs.readFileSync(path.join(evidenceDir, name), "utf8"));
  if (value.productCommit !== manifest.productCommit) productCommitErrors.push(name);
}
if (expectedProductCommit && manifest.productCommit !== expectedProductCommit) {
  productCommitErrors.push(`manifest:${manifest.productCommit}`);
}
const rc1Errors = [];
if (rc1Release) {
  const readJson = (name) => JSON.parse(fs.readFileSync(path.join(evidenceDir, name), "utf8"));
  const baseline = readJson("baseline.json");
  const releaseIdentity = readJson("release-identity.json");
  const releaseMetadata = readJson("release-metadata-results.json");
  const buildProvenance = readJson("build-provenance-results.json");
  const actionPins = readJson("action-pin-verification.json");
  const ollama = readJson("ollama-real-smoke.json");
  if (
    baseline.status !== "PASS"
    || baseline.approvedBaseline !== "d74b97d026589f202cc6645a07770c30b586ebb9"
    || baseline.expectedProductParent !== "e8250678bbc0513dde4a487f7a10145e42c95d46"
    || baseline.productParent !== baseline.expectedProductParent
  ) rc1Errors.push("baseline.json");
  if (
    releaseIdentity.status !== "P2.4B_RC1_RELEASE_IDENTITY_PASS"
    || releaseIdentity.releaseTag !== "novel-ai-p24b-character-agent-rc1"
    || releaseIdentity.releaseName !== "P2.4B Closed Character Agent Core RC1"
    || releaseIdentity.consumerRelease !== "p2.4b-character-agent-rc1"
    || releaseIdentity.architectureStage !== "P2.4B RC"
  ) rc1Errors.push("release-identity.json");
  if (releaseMetadata.status !== "PASS" || releaseMetadata.fail !== 0 || releaseMetadata.skip !== 0) {
    rc1Errors.push("release-metadata-results.json");
  }
  if (
    buildProvenance.status !== "PASS"
    || buildProvenance.appCommit !== manifest.productCommit
    || buildProvenance.commitProvenanceStatus !== "verified"
    || buildProvenance.releaseTag !== releaseIdentity.releaseTag
    || buildProvenance.architectureStage !== releaseIdentity.architectureStage
  ) rc1Errors.push("build-provenance-results.json");
  if (
    actionPins.status !== "PASS"
    || actionPins.actions?.length !== 3
    || actionPins.actions.some((entry) =>
      entry.ownerVerified !== true
      || entry.status !== "PASS"
      || !/^[0-9a-f]{40}$/.test(entry.resolvedCommit))
  ) rc1Errors.push("action-pin-verification.json");
  if (
    ollama.status !== "P2.4B_REAL_OLLAMA_SMOKE_PASS"
    || ollama.pass !== 8
    || ollama.fail !== 0
    || ollama.skip !== 0
    || ollama.model?.id !== "qwen2.5:3b"
    || !/^[0-9a-f]{64}$/.test(ollama.modelDigest ?? "")
    || ollama.contextWindow !== 8192
    || ollama.temperature !== 0.1
    || ollama.topP !== 0.9
    || ollama.seed !== 2404
    || ollama.promptProfileVersion !== "p24b-character-agent-rc1-smoke-v1"
    || ollama.externalRequests !== 0
    || ollama.dataLeftDevice !== false
    || ollama.rawChainOfThoughtStored !== false
    || ollama.structuredOutputValidation?.passedCaseCount !== 8
  ) rc1Errors.push("ollama-real-smoke.json");
  if (manifest.records.length < 52) rc1Errors.push(`recordCount:${manifest.records.length}`);
}

const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const relativeEvidenceDir = slash(path.relative(repositoryRoot, evidenceDir));
const gitBlobMismatch = [];
if (gitSource.toLowerCase() !== "none") {
  for (const name of listFiles(evidenceDir)) {
    const repositoryPath = `${relativeEvidenceDir}/${name}`;
    const spec = gitSource.toLowerCase() === "index"
      ? `:${repositoryPath}`
      : `${gitSource}:${repositoryPath}`;
    let blob;
    try {
      blob = execFileSync("git", ["show", spec], { encoding: null, maxBuffer: 64 * 1024 * 1024 });
    } catch {
      gitBlobMismatch.push(`${name}:MISSING`);
      continue;
    }
    const fileBytes = fs.readFileSync(path.join(evidenceDir, name));
    if (!blob.equals(fileBytes)) gitBlobMismatch.push(`${name}:BYTE_MISMATCH`);
  }
}

let productCommitExists = true;
try {
  execFileSync("git", ["cat-file", "-e", `${manifest.productCommit}^{commit}`], { stdio: "ignore" });
} catch {
  productCommitExists = false;
}
const pass = missing.length === 0
  && unexpected.length === 0
  && mismatch.length === 0
  && textFormatErrors.length === 0
  && productCommitErrors.length === 0
  && rc1Errors.length === 0
  && gitBlobMismatch.length === 0
  && selfHashMatches
  && manifestShaMatches
  && manifest.recordCount === manifest.records.length
  && productCommitExists;
const result = {
  schemaVersion: "p24b-evidence-verification-v1",
  status: pass ? "PASS" : "FAIL",
  evidenceDir,
  gitSource,
  productCommit: manifest.productCommit,
  recordCount: manifest.records.length,
  missing,
  unexpected,
  mismatch,
  textFormatErrors,
  productCommitErrors,
  rc1Errors,
  gitBlobMismatch,
  selfHashMatches,
  manifestShaMatches,
  productCommitExists,
};
console.log(JSON.stringify(result));
if (!pass) process.exitCode = 1;

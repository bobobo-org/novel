import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const evidenceDir = path.resolve(process.env.P24B_REPO_EVIDENCE_DIR || "artifacts/p24b-character-agent");
const gitSource = process.env.P24B_EVIDENCE_GIT_SOURCE || "HEAD";
const expectedProductCommit = process.env.P24B_PRODUCT_COMMIT || null;
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
for (const name of required.filter((value) => value.endsWith(".json") && !value.startsWith("evidence-manifest"))) {
  const value = JSON.parse(fs.readFileSync(path.join(evidenceDir, name), "utf8"));
  if (value.productCommit !== manifest.productCommit) productCommitErrors.push(name);
}
if (expectedProductCommit && manifest.productCommit !== expectedProductCommit) {
  productCommitErrors.push(`manifest:${manifest.productCommit}`);
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
  gitBlobMismatch,
  selfHashMatches,
  manifestShaMatches,
  productCommitExists,
};
console.log(JSON.stringify(result));
if (!pass) process.exitCode = 1;

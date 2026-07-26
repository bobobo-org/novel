import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const RC1_PRODUCT = "71bea12da90def7646efe1189f059896d3582327";
const evidenceDir = path.resolve(
  process.env.P24B_RC2_EVIDENCE_DIR || "artifacts/p24b-rc2-unified-ui",
);
const gitSource = process.env.P24B_RC2_EVIDENCE_GIT_SOURCE || "HEAD";
const expectedProductCommit = process.env.P24B_RC2_PRODUCT_COMMIT || "";
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const slash = (value) => value.replaceAll("\\", "/");
const required = [
  "release-identity.json",
  "release-metadata-results.json",
  "ui-reference-delta.json",
  "selective-port-map.json",
  "frontdoor-routes.json",
  "deep-route-preservation.json",
  "first-paint-results.json",
  "menu-layout-results.json",
  "scroll-isolation-results.json",
  "mobile-results.json",
  "p24a-regression.json",
  "p24b-formal.json",
  "p24a-browser.json",
  "p24b-browser.json",
  "ollama-real-smoke.json",
  "capability-truth.json",
  "build-provenance.json",
  "build-reproducibility.json",
  "dynamic-assets.json",
  "migration-backup.json",
  "security-isolation.json",
  "secret-scan.json",
  "findings.json",
  "executive-summary.md",
  "evidence-manifest.json",
  "evidence-manifest.sha256",
];
if (!fs.existsSync(evidenceDir)) throw new Error(`P24B_RC2_EVIDENCE_MISSING:${evidenceDir}`);
const missingRequired = required.filter((name) => !fs.existsSync(path.join(evidenceDir, name)));
if (missingRequired.length) {
  throw new Error(`P24B_RC2_REQUIRED_EVIDENCE_MISSING:${missingRequired.join(",")}`);
}

const listFiles = () => fs.readdirSync(evidenceDir, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(evidenceDir, name), "utf8"));
const manifestBytes = fs.readFileSync(path.join(evidenceDir, "evidence-manifest.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const { selfHash, selfHashStatus, ...payload } = manifest;
const selfHashMatches = selfHashStatus === "MATCH" && selfHash === sha256(JSON.stringify(payload));
const digestLine = fs.readFileSync(path.join(evidenceDir, "evidence-manifest.sha256"), "ascii");
const manifestDigestMatches = digestLine
  === `${sha256(manifestBytes)}  evidence-manifest.json\n`;
const excluded = new Set(["evidence-manifest.json", "evidence-manifest.sha256"]);
const actualRecords = listFiles()
  .filter((name) => !excluded.has(name))
  .map((name) => {
    const bytes = fs.readFileSync(path.join(evidenceDir, name));
    return { path: name, bytes: bytes.length, sha256: sha256(bytes) };
  });
const expectedByPath = new Map(manifest.records.map((record) => [record.path, record]));
const actualByPath = new Map(actualRecords.map((record) => [record.path, record]));
const missing = manifest.records.filter((record) => !actualByPath.has(record.path))
  .map((record) => record.path);
const unexpected = actualRecords.filter((record) => !expectedByPath.has(record.path))
  .map((record) => record.path);
const mismatch = actualRecords.filter((record) => {
  const expected = expectedByPath.get(record.path);
  return expected && (expected.bytes !== record.bytes || expected.sha256 !== record.sha256);
}).map((record) => record.path);

const textFormatErrors = [];
for (const name of listFiles()) {
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

const credentialPatterns = [
  /vcp_[A-Za-z0-9]{24,}/g,
  /sbp_[a-f0-9]{32,}/gi,
  /sk-[A-Za-z0-9]{32,}/g,
  /gh[pousr]_[A-Za-z0-9]{36,}/g,
  /AIza[0-9A-Za-z_-]{35}/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];
const credentialHits = [];
for (const name of listFiles()) {
  const text = fs.readFileSync(path.join(evidenceDir, name), "utf8");
  for (const pattern of credentialPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) credentialHits.push(name);
  }
}

const productCommitErrors = [];
for (const name of listFiles().filter((name) =>
  name.endsWith(".json") && name !== "evidence-manifest.json")) {
  const value = readJson(name);
  if (value.productCommit !== manifest.productCommit) productCommitErrors.push(name);
}
if (expectedProductCommit && manifest.productCommit !== expectedProductCommit) {
  productCommitErrors.push(`manifest:${manifest.productCommit}`);
}

const semanticErrors = [];
const identity = readJson("release-identity.json");
const scope = readJson("selective-port-map.json");
const frontdoor = readJson("frontdoor-routes.json");
const firstPaint = readJson("first-paint-results.json");
const deepRoutes = readJson("deep-route-preservation.json");
const mobile = readJson("mobile-results.json");
const p24a = readJson("p24a-regression.json");
const p24b = readJson("p24b-formal.json");
const p24aBrowser = readJson("p24a-browser.json");
const p24bBrowser = readJson("p24b-browser.json");
const ollama = readJson("ollama-real-smoke.json");
const capability = readJson("capability-truth.json");
const provenance = readJson("build-provenance.json");
const reproducibility = readJson("build-reproducibility.json");
const dynamicAssets = readJson("dynamic-assets.json");
const migrationBackup = readJson("migration-backup.json");
const security = readJson("security-isolation.json");
const secrets = readJson("secret-scan.json");
const findings = readJson("findings.json");
const requireSemantic = (condition, code) => {
  if (!condition) semanticErrors.push(code);
};
requireSemantic(identity.status === "P2.4B_RC2_RELEASE_IDENTITY_PASS", "RELEASE_IDENTITY");
requireSemantic(identity.releaseTag === "novel-ai-p24b-character-agent-rc2", "RELEASE_TAG");
requireSemantic(identity.architectureStage === "P2.4B RC", "ARCHITECTURE_STAGE");
requireSemantic(scope.unexpected === 0, "PRODUCT_SCOPE");
requireSemantic(frontdoor.status === "PASS" && frontdoor.semanticHashCount === 1, "FRONTDOOR");
requireSemantic(firstPaint.consumerVisibleFrames === 0 && firstPaint.blackShellFrames === 0, "FIRST_PAINT");
requireSemantic(deepRoutes.status === "PASS" && deepRoutes.requiredRouteCount === 8, "DEEP_ROUTES");
requireSemantic(mobile.status === "PASS" && mobile.requiredViewports.length === 4, "MOBILE");
requireSemantic(p24a.exactTotal.pass === 516 && p24a.exactTotal.fail === 0 && p24a.exactTotal.skip === 0, "P24A_EXACT");
requireSemantic(p24b.pass === 372 && p24b.fail === 0 && p24b.skip === 0, "P24B_FORMAL");
requireSemantic(p24aBrowser.pass === 61 && p24aBrowser.fail === 0 && p24aBrowser.skip === 0, "P24A_BROWSER");
requireSemantic(p24bBrowser.pass === 61 && p24bBrowser.fail === 0 && p24bBrowser.skip === 0 && p24bBrowser.flowSteps.length === 30, "P24B_BROWSER");
requireSemantic(ollama.pass === 8 && ollama.fail === 0 && ollama.skip === 0 && ollama.model?.id === "qwen2.5:3b", "OLLAMA");
requireSemantic(capability.status === "PASS" && capability.falseReadyClaims === 0, "CAPABILITY");
requireSemantic(provenance.status === "PASS" && provenance.appCommit === manifest.productCommit && provenance.commitProvenanceStatus === "verified", "PROVENANCE");
requireSemantic(reproducibility.status === "PASS" && reproducibility.missing.length === 0 && reproducibility.unexpected.length === 0 && reproducibility.mismatch.length === 0, "REPRODUCIBILITY");
requireSemantic(dynamicAssets.status === "PASS", "DYNAMIC_ASSETS");
requireSemantic(migrationBackup.status === "PASS" && migrationBackup.semanticHashMatch === true, "MIGRATION_BACKUP");
requireSemantic(security.status === "PASS" && security.externalRequests === 0 && security.rawChainOfThoughtStored === false && security.canonicalMutationBeforeApproval === 0, "SECURITY");
requireSemantic(secrets.status === "PASS" && secrets.trueCredentialHits === 0, "SECRET_SCAN");
requireSemantic(findings.status === "PASS" && findings.blockingCount === 0, "FINDINGS");

let productCommitExists = true;
let productParentMatches = true;
try {
  execFileSync("git", ["cat-file", "-e", `${manifest.productCommit}^{commit}`], { stdio: "ignore" });
  const parent = execFileSync(
    "git",
    ["rev-parse", `${manifest.productCommit}^`],
    { encoding: "utf8" },
  ).trim();
  productParentMatches = parent === RC1_PRODUCT;
} catch {
  productCommitExists = false;
  productParentMatches = false;
}

const repositoryRoot = execFileSync(
  "git",
  ["rev-parse", "--show-toplevel"],
  { encoding: "utf8" },
).trim();
const relativeEvidenceDir = slash(path.relative(repositoryRoot, evidenceDir));
const gitBlobMismatch = [];
if (gitSource.toLowerCase() !== "none") {
  for (const name of listFiles()) {
    const repositoryPath = `${relativeEvidenceDir}/${name}`;
    const spec = gitSource.toLowerCase() === "index"
      ? `:${repositoryPath}`
      : `${gitSource}:${repositoryPath}`;
    let blob;
    try {
      blob = execFileSync("git", ["show", spec], {
        encoding: null,
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch {
      gitBlobMismatch.push(`${name}:MISSING`);
      continue;
    }
    if (!blob.equals(fs.readFileSync(path.join(evidenceDir, name)))) {
      gitBlobMismatch.push(`${name}:BYTE_MISMATCH`);
    }
  }
}

const pass = missing.length === 0
  && unexpected.length === 0
  && mismatch.length === 0
  && textFormatErrors.length === 0
  && credentialHits.length === 0
  && productCommitErrors.length === 0
  && semanticErrors.length === 0
  && gitBlobMismatch.length === 0
  && selfHashMatches
  && manifestDigestMatches
  && manifest.recordCount === manifest.records.length
  && productCommitExists
  && productParentMatches;
const result = {
  schemaVersion: "p24b-rc2-evidence-verification-v1",
  status: pass ? "PASS" : "FAIL",
  evidenceDir,
  gitSource,
  productCommit: manifest.productCommit,
  recordCount: manifest.records.length,
  missing,
  unexpected,
  mismatch,
  textFormatErrors,
  credentialHits,
  productCommitErrors,
  semanticErrors,
  gitBlobMismatch,
  selfHashMatches,
  manifestDigestMatches,
  productCommitExists,
  productParentMatches,
};
console.log(JSON.stringify(result));
if (!pass) process.exitCode = 1;

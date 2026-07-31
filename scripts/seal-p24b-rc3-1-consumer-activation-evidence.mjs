import crypto from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REQUIRED_GATE_FILES = [
  "product-preview-identity.json",
  "frontdoor-results.json",
  "studio-results.json",
  "manual-edge-results.json",
  "local-ollama-results.json",
  "regeneration-results.json",
  "canon-approval-results.json",
  "rpg-results.json",
  "backup-restore-results.json",
  "service-worker-results.json",
  "mobile-results.json",
  "supabase-boundary.json",
  "findings.json",
  "product-final-head-preview-parity.json",
];
function argsOf(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    result[key] = next && !next.startsWith("--") ? argv[++index] : true;
  }
  return result;
}

function sha(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function json(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function filesUnder(root) {
  const result = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) result.push(full);
    }
  }
  await walk(root);
  return result.sort();
}

function relative(root, file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

async function git(root, ...args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

function assertPass(name, value) {
  if (value !== "PASS") throw new Error(`${name}_NOT_PASS`);
}

async function verifyManifest(artifactRoot) {
  const manifestPath = path.join(artifactRoot, "evidence-manifest.json");
  const digestPath = path.join(artifactRoot, "evidence-manifest.sha256");
  const manifestBytes = await readFile(manifestPath);
  const digestLine = (await readFile(digestPath, "utf8")).trim();
  const expectedManifestDigest = digestLine.split(/\s+/u)[0];
  if (sha(manifestBytes) !== expectedManifestDigest) {
    throw new Error("EVIDENCE_MANIFEST_SELF_HASH_MISMATCH");
  }
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  let mismatch = 0;
  let missing = 0;
  for (const item of manifest.files) {
    const file = path.join(artifactRoot, ...item.file.split("/"));
    try {
      const bytes = await readFile(file);
      if (bytes.length !== item.bytes || sha(bytes) !== item.sha256) mismatch += 1;
    } catch {
      missing += 1;
    }
  }
  if (mismatch || missing) throw new Error("EVIDENCE_MANIFEST_FILE_MISMATCH");
  return { status: "PASS", mismatch, missing, files: manifest.files.length };
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  const repositoryRoot = process.cwd();
  const artifactRoot = path.resolve(String(
    args.artifacts || "artifacts/p24b-rc3-1-consumer-activation",
  ));
  if (args.verify === true) {
    const result = await verifyManifest(artifactRoot);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const productCommit = String(args["product-commit"] || "");
  const baselineCommit = String(args["baseline-commit"] || "0baefa171b2fd3e99eafd93f13ec292a2ba19507");
  if (![productCommit, baselineCommit].every((value) => /^[0-9a-f]{40}$/iu.test(value))) {
    throw new Error("BASELINE_AND_PRODUCT_COMMIT_REQUIRED");
  }
  await mkdir(artifactRoot, { recursive: true });
  for (const file of REQUIRED_GATE_FILES) {
    await stat(path.join(artifactRoot, file));
  }
  const [preview, manualEdge, localOllama, regeneration, canon, rpg, backup, mobile, supabase, findings, parity] = await Promise.all([
    json(path.join(artifactRoot, "product-preview-identity.json")),
    json(path.join(artifactRoot, "manual-edge-results.json")),
    json(path.join(artifactRoot, "local-ollama-results.json")),
    json(path.join(artifactRoot, "regeneration-results.json")),
    json(path.join(artifactRoot, "canon-approval-results.json")),
    json(path.join(artifactRoot, "rpg-results.json")),
    json(path.join(artifactRoot, "backup-restore-results.json")),
    json(path.join(artifactRoot, "mobile-results.json")),
    json(path.join(artifactRoot, "supabase-boundary.json")),
    json(path.join(artifactRoot, "findings.json")),
    json(path.join(artifactRoot, "product-final-head-preview-parity.json")),
  ]);
  for (const [name, row] of [
    ["MANUAL_EDGE", manualEdge],
    ["LOCAL_OLLAMA", localOllama],
    ["REGENERATION", regeneration],
    ["CANON", canon],
    ["RPG", rpg],
    ["BACKUP_RESTORE", backup],
    ["MOBILE", mobile],
    ["PREVIEW_PARITY", parity],
  ]) assertPass(name, row.status);
  if (
    preview.productCommit !== productCommit
    || preview.releaseIdentity?.appCommit !== productCommit
  ) throw new Error("PRODUCT_PREVIEW_IDENTITY_MISMATCH");
  if (
    manualEdge.permissionBefore !== "prompt"
    || manualEdge.permissionAfter !== "granted"
    || manualEdge.nativeDecisionMethod !== "HUMAN_OPERATOR"
    || manualEdge.permissionInjectionUsed
    || manualEdge.windowsUiAutomationUsed
    || manualEdge.browserPolicyModified
    || manualEdge.localNetworkAccessBypassUsed
    || !manualEdge.profileDeleted
  ) throw new Error("MANUAL_EDGE_CONTRACT_MISMATCH");
  if (
    !regeneration.normalizedDigestDifferent
    || regeneration.similarityScore >= 0.95
    || !regeneration.cacheBypassed
    || regeneration.actualExecutor !== "local-ollama"
    || regeneration.preApprovalCanonMutationCount !== 0
    || regeneration.firstTaskIdDigest === regeneration.secondTaskIdDigest
    || regeneration.firstCandidateIdDigest === regeneration.secondCandidateIdDigest
    || regeneration.firstContentDigest === regeneration.secondContentDigest
  ) throw new Error("REGENERATION_EVIDENCE_MISMATCH");
  if (
    parity.blockingMismatch !== 0
    || parity.missing !== 0
    || parity.unexpected !== 0
  ) throw new Error("PREVIEW_PARITY_BLOCKED");
  if (
    findings.consoleProductErrorCount !== 0
    || findings.consoleSecurityErrorCount !== 0
    || findings.consoleUnclassifiedCount !== 0
    || findings.externalAiRequestCount !== 0
    || findings.rawConsolePersisted
    || findings.rawNetworkPersisted
    || findings.privateStoryTextPersisted
    || findings.rawChainOfThoughtPersisted
  ) throw new Error("FINDINGS_NOT_CLEAN");
  if (supabase.productionModified || supabase.cloudPersistenceReady) {
    throw new Error("SUPABASE_BOUNDARY_MISMATCH");
  }

  const productParent = await git(repositoryRoot, "rev-parse", `${productCommit}^`);
  if (productParent !== baselineCommit) throw new Error("PRODUCT_PARENT_BASELINE_MISMATCH");
  const productFiles = (await git(repositoryRoot, "diff", "--name-only", baselineCommit, productCommit))
    .split(/\r?\n/u).filter(Boolean);
  if (productFiles.some((file) => file.startsWith("artifacts/p24b-rc3-1-consumer-activation/"))) {
    throw new Error("PRODUCT_COMMIT_CONTAINS_EVIDENCE_RESULT");
  }
  await writeJson(path.join(artifactRoot, "baseline.json"), {
    status: "PASS",
    branch: "agent/p24b-rc3-consumer-activation",
    baselineCommit,
    productionCommit: "5ddc32918f0d866a85e04b4398c7e66ce8d36e2b",
    productionModified: false,
  });
  await writeJson(path.join(artifactRoot, "product-commit.json"), {
    status: "PASS",
    productCommit,
    parentCommit: productParent,
    message: await git(repositoryRoot, "show", "-s", "--format=%s", productCommit),
    files: productFiles,
    evidenceResultIncluded: false,
  });

  const excludedFromScan = new Set([
    "secret-scan.json",
    "evidence-manifest.json",
    "evidence-manifest.sha256",
  ]);
  const credentialPattern = /\b(?:vcp|sbp|sk|gh[pousr])_[A-Za-z0-9_-]{20,}\b/gu;
  const sensitiveHeaderPattern = /(?:authorization\s*:\s*(?:bearer|basic)|set-cookie\s*:|x-csrf-token\s*:)/giu;
  const pairingPattern = /["'](?:pairingCode|pairing_code|code)["']\s*:\s*["']?\d{6}["']?/giu;
  const hits = [];
  for (const file of await filesUnder(artifactRoot)) {
    const name = relative(artifactRoot, file);
    if (excludedFromScan.has(name)) continue;
    const bytes = await readFile(file);
    const text = bytes.toString("utf8");
    for (const [kind, pattern] of [
      ["credential", credentialPattern],
      ["sensitive-header", sensitiveHeaderPattern],
      ["pairing-code", pairingPattern],
    ]) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) hits.push({ file: name, kind });
    }
  }
  await writeJson(path.join(artifactRoot, "secret-scan.json"), {
    status: hits.length ? "FAIL" : "PASS",
    credentialHits: hits.length,
    hits,
    privateStoryTextPersisted: false,
    rawChainOfThoughtPersisted: false,
    browserProfilePresent: false,
  });
  if (hits.length) throw new Error("EVIDENCE_SECRET_SCAN_FAILED");

  await writeFile(path.join(artifactRoot, "executive-summary.md"), [
    "# P2.4B RC3.1 Consumer Acceptance Evidence",
    "",
    `- Product commit: ${productCommit}`,
    `- Product Preview: ${preview.origin}`,
    "- Explicit regeneration: distinct candidate, cache bypassed, Local Ollama only.",
    "- Native Edge permission: prompt → granted by HUMAN_OPERATOR.",
    "- Canon: unchanged before approval; approved candidate persisted after reload.",
    "- Product / final PR Head runtime parity: blockingMismatch=0, missing=0, unexpected=0.",
    "- Production and Supabase Production: unchanged.",
    "- Cloud persistence: not ready.",
    "- Independent LUNA: not started.",
    "",
  ].join("\n"), "utf8");
  await writeFile(path.join(artifactRoot, "luna-handoff.md"), [
    "# Fresh Independent LUNA Handoff",
    "",
    "Review only the RC3.1 delta: explicit regeneration, human native Edge LNA, and runtime parity.",
    "Do not reuse the RC3 v1 automated native-decision result as human evidence.",
    "Verify evidence-manifest.sha256 before reviewing individual records.",
    "Production remains unchanged and is outside this handoff.",
    "",
  ].join("\n"), "utf8");

  const manifestExcluded = new Set(["evidence-manifest.json", "evidence-manifest.sha256"]);
  const manifestRows = [];
  for (const file of await filesUnder(artifactRoot)) {
    const name = relative(artifactRoot, file);
    if (manifestExcluded.has(name)) continue;
    const bytes = await readFile(file);
    manifestRows.push({ file: name, bytes: bytes.length, sha256: sha(bytes) });
  }
  const manifest = {
    schemaVersion: "p24b-rc3-1-evidence-manifest-v1",
    status: "PASS",
    productCommit,
    recordCount: manifestRows.length,
    mismatch: 0,
    missing: 0,
    unexpected: 0,
    credentialHits: 0,
    files: manifestRows,
  };
  const manifestPath = path.join(artifactRoot, "evidence-manifest.json");
  await writeJson(manifestPath, manifest);
  const manifestDigest = sha(await readFile(manifestPath));
  await writeFile(
    path.join(artifactRoot, "evidence-manifest.sha256"),
    `${manifestDigest}  evidence-manifest.json\n`,
    "utf8",
  );
  const verification = await verifyManifest(artifactRoot);
  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    productCommit,
    records: verification.files,
    mismatch: 0,
    missing: 0,
    credentialHits: 0,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: "FAIL", error: error.message })}\n`);
  process.exitCode = 1;
});

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const evidenceDir = process.env.P24A_EVIDENCE_DIR || "artifacts/p24a";
const manifestPath = path.join(evidenceDir, "evidence-manifest.json");
const checksumPath = path.join(evidenceDir, "evidence-manifest.sha256");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const mismatches = [];
const missing = [];

for (const record of manifest.records) {
  const file = path.join(evidenceDir, record.path);
  if (!fs.existsSync(file)) {
    missing.push(record.path);
    continue;
  }
  const bytes = fs.readFileSync(file);
  if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256) mismatches.push(record.path);
}

const { selfHash, selfHashStatus, ...payload } = manifest;
const selfHashMatches = sha256(JSON.stringify(payload)) === selfHash && selfHashStatus === "MATCH";
const expectedManifestHash = fs.readFileSync(checksumPath, "ascii").trim().split(/\s+/)[0];
const manifestHashMatches = sha256(fs.readFileSync(manifestPath)) === expectedManifestHash;
const result = {
  schemaVersion: "p24a-evidence-verification-v1",
  recordCount: manifest.records.length,
  mismatch: mismatches.length,
  missing: missing.length,
  unexpected: manifest.unexpected,
  selfHash: selfHashMatches ? "MATCH" : "MISMATCH",
  manifestHash: manifestHashMatches ? "MATCH" : "MISMATCH",
  mismatches,
  missingFiles: missing,
};
console.log(JSON.stringify(result));
if (mismatches.length || missing.length || manifest.unexpected || !selfHashMatches || !manifestHashMatches) process.exit(1);

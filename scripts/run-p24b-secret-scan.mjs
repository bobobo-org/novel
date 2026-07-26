import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const outputDir = path.resolve(process.env.P24B_EVIDENCE_DIR || "artifacts/p24b-ci");
const patterns = [
  { name: "vercel_cli_token", expression: /vcp_[A-Za-z0-9]{24,}/g },
  { name: "supabase_access_token", expression: /sbp_[a-f0-9]{32,}/gi },
  { name: "openai_api_key", expression: /sk-[A-Za-z0-9]{32,}/g },
  { name: "github_token", expression: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: "google_api_key", expression: /AIza[0-9A-Za-z_-]{35}/g },
  { name: "private_key_block", expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
).split(/\r?\n/).filter(Boolean);
const hits = [];
let textFiles = 0;

for (const relative of files) {
  let bytes;
  try {
    bytes = fs.readFileSync(relative);
  } catch {
    continue;
  }
  if (bytes.includes(0)) continue;
  textFiles += 1;
  const text = bytes.toString("utf8");
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.expression)) {
      hits.push({
        file: relative.replaceAll("\\", "/"),
        type: pattern.name,
        redactedFingerprint: crypto
          .createHash("sha256")
          .update(match[0])
          .digest("hex")
          .slice(0, 12),
      });
    }
  }
}

const result = {
  schemaVersion: "p24b-secret-scan-v1",
  generatedAt: new Date().toISOString(),
  trackedAndUntrackedTextFiles: textFiles,
  trueCredentialHits: hits.length,
  rawCredentialValuesStored: false,
  hits,
  status: hits.length === 0 ? "PASS" : "FAIL",
};
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
  path.join(outputDir, "secret-scan-results.json"),
  `${JSON.stringify(result, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(result));
if (hits.length) process.exitCode = 1;

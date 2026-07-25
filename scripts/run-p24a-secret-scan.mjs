import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const outputDir = process.env.P24A_CI_EVIDENCE_DIR || "artifacts/p24a-ci";
const patterns = [
  { name: "vercel_cli_token", expression: /vcp_[A-Za-z0-9]{24,}/g },
  { name: "supabase_access_token", expression: /sbp_[a-f0-9]{32,}/gi },
  { name: "openai_api_key", expression: /sk-[A-Za-z0-9]{32,}/g },
  { name: "github_token", expression: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: "google_api_key", expression: /AIza[0-9A-Za-z_-]{35}/g },
];
const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
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
        redactedFingerprint: crypto.createHash("sha256").update(match[0]).digest("hex").slice(0, 12),
      });
    }
  }
}

const result = {
  schemaVersion: "p24a-secret-scan-v1",
  generatedAt: new Date().toISOString(),
  trackedTextFiles: textFiles,
  trueCredentialHits: hits.length,
  hits,
};
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "secret-scan-results.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result));
if (hits.length) process.exit(1);

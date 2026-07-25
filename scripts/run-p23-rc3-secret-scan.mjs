import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
}).split("\0").filter(Boolean);

const rules = [
  { id: "VERCEL_TOKEN", pattern: new RegExp(`\\bv${"cp_"}[A-Za-z0-9]{20,}\\b`, "g") },
  { id: "SUPABASE_PAT", pattern: new RegExp(`\\bs${"bp_"}[A-Za-z0-9]{20,}\\b`, "g") },
  { id: "GITHUB_TOKEN", pattern: new RegExp(`\\bgh[pousr]_[A-Za-z0-9]{20,}\\b`, "g") },
  { id: "AWS_ACCESS_KEY", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: "PRIVATE_KEY", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

const textExtensions = new Set([
  ".cjs", ".css", ".csv", ".html", ".js", ".json", ".jsx", ".md", ".mjs",
  ".ps1", ".sql", ".svg", ".ts", ".tsx", ".txt", ".yaml", ".yml",
]);

const findings = [];
let scannedFiles = 0;

for (const file of trackedFiles) {
  const extension = file.includes(".") ? file.slice(file.lastIndexOf(".")).toLowerCase() : "";
  if (!textExtensions.has(extension)) continue;

  const bytes = readFileSync(file);
  if (bytes.length > 5 * 1024 * 1024 || bytes.includes(0)) continue;

  scannedFiles += 1;
  const text = bytes.toString("utf8");
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      const line = text.slice(0, match.index).split(/\r?\n/).length;
      findings.push({ file, line, rule: rule.id });
    }
  }
}

const result = {
  schemaVersion: "p23-rc3-secret-scan-v1",
  scannedFiles,
  ruleCount: rules.length,
  trueCredentialHits: findings.length,
  findings,
  status: findings.length === 0 ? "PASS" : "FAIL",
};

console.log(JSON.stringify(result, null, 2));
if (findings.length > 0) process.exit(1);

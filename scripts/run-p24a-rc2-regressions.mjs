import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const evidenceDir = process.env.P24A_EVIDENCE_DIR;
if (!evidenceDir) throw new Error("P24A_EVIDENCE_DIR_REQUIRED");
fs.mkdirSync(evidenceDir, { recursive: true });

const node = process.execPath;
const loader = ["--experimental-strip-types", "--import", "./scripts/register-ts-extension-loader.mjs"];
const suites = [
  { id: "p22Core", file: "p22-core-results.json", args: [...loader, "scripts/run-p22-story-intelligence.mjs"] },
  { id: "p23Foundation", file: "p23-foundation-results.json", args: [...loader, "scripts/run-p23-sovereign-learning.mjs"] },
  { id: "p23Security", file: "p23-security-results.json", args: [...loader, "scripts/run-p23-rc2-security.mjs"] },
  { id: "threeHigh", file: "three-high-results.json", args: [...loader, "scripts/run-p21-three-high-closure.mjs"] },
  { id: "indexedDb", file: "indexeddb-results.json", args: [...loader, "scripts/run-p21-indexeddb-transaction.mjs"] },
  { id: "backupDataClosure", file: "backup-data-closure-results.json", args: [...loader, "scripts/run-p21-data-closure.mjs"] },
];

function parseJsonOutput(output, id) {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first < 0 || last <= first) throw new Error(`${id}_OUTPUT_NOT_JSON`);
    return JSON.parse(trimmed.slice(first, last + 1));
  }
}

const results = {};
for (const suite of suites) {
  const stdout = execFileSync(node, suite.args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const result = parseJsonOutput(stdout, suite.id);
  results[suite.id] = result;
  fs.writeFileSync(path.join(evidenceDir, suite.file), `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

const summary = {
  schemaVersion: "p24a-rc2-regression-runner-v1",
  generatedAt: new Date().toISOString(),
  suites: Object.fromEntries(Object.entries(results).map(([id, result]) => [id, {
    pass: result.pass ?? 0,
    fail: result.fail ?? 0,
    skip: result.skip ?? 0,
  }])),
};
summary.totalPass = Object.values(summary.suites).reduce((sum, row) => sum + row.pass, 0);
summary.totalFail = Object.values(summary.suites).reduce((sum, row) => sum + row.fail, 0);
summary.totalSkip = Object.values(summary.suites).reduce((sum, row) => sum + row.skip, 0);
summary.status = summary.totalFail === 0 && summary.totalSkip === 0 ? "PASS" : "FAIL";
fs.writeFileSync(path.join(evidenceDir, "required-regressions.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary));
if (summary.status !== "PASS") process.exitCode = 1;

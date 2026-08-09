import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const baseline = JSON.parse(readFileSync(
  path.join(root, "config", "eslint-warning-baseline.json"),
  "utf8",
));
const eslintCli = path.join(root, "node_modules", "eslint", "bin", "eslint.js");

function gitLines(args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).split(/\r?\n/u).map((value) => value.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

const changedTracked = gitLines([
  "diff",
  "--name-only",
  "--diff-filter=ACMR",
  baseline.baseCommit,
  "--",
  ...baseline.changedSourceRoots,
]);
const changedUntracked = gitLines([
  "ls-files",
  "--others",
  "--exclude-standard",
  "--",
  ...baseline.changedSourceRoots,
]);
const changedSources = new Set([...changedTracked, ...changedUntracked]
  .map((value) => value.replaceAll("\\", "/")));

const eslintJson = execFileSync(process.execPath, [eslintCli, ".", "--format", "json"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  stdio: ["ignore", "pipe", "inherit"],
});
const results = JSON.parse(eslintJson);
const normalizedResults = results.map((result) => ({
  ...result,
  relativePath: path.relative(root, result.filePath).replaceAll("\\", "/"),
}));
const errorCount = normalizedResults.reduce((total, result) => total + result.errorCount, 0);
const warningCount = normalizedResults.reduce((total, result) => total + result.warningCount, 0);
const changedSourceFindings = normalizedResults
  .filter((result) => changedSources.has(result.relativePath))
  .filter((result) => result.errorCount > 0 || result.warningCount > 0)
  .map((result) => ({
    file: result.relativePath,
    errors: result.errorCount,
    warnings: result.warningCount,
  }));
const changedSourceWarningCount = changedSourceFindings
  .reduce((total, result) => total + result.warnings, 0);
const status = errorCount === 0
  && warningCount <= baseline.maxGlobalWarnings
  && changedSourceWarningCount <= baseline.maxChangedSourceWarnings
  && changedSourceFindings.every((result) => result.errors === 0)
  ? "PASS"
  : "FAIL";
const summary = {
  schemaVersion: "p24b-rc6-eslint-warning-ratchet-result-v1",
  status,
  baselineCommit: baseline.baseCommit,
  maxGlobalWarnings: baseline.maxGlobalWarnings,
  actualGlobalWarnings: warningCount,
  globalErrors: errorCount,
  changedSourceCount: changedSources.size,
  maxChangedSourceWarnings: baseline.maxChangedSourceWarnings,
  actualChangedSourceWarnings: changedSourceWarningCount,
  changedSourceFindings,
};

console.log(JSON.stringify(summary, null, 2));
if (status !== "PASS") process.exitCode = 1;

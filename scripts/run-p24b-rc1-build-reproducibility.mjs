import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const productCommit = process.env.P24B_RC1_PRODUCT_COMMIT
  || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const evidenceDir = path.resolve(process.env.P24B_RC1_EVIDENCE_DIR || "artifacts/p24b-rc1-local");
const expectedTag = "novel-ai-p24b-character-agent-rc1";
const expectedStage = "P2.4B RC";
const nextDir = path.join(root, ".next");
const mutableStaticPaths = [
  "public/legacy/novel-system.html",
  "public/legacy/novel-whole-novel-workspace.js",
];
const snapshots = new Map(mutableStaticPaths.map((name) => [
  name,
  fs.readFileSync(path.join(root, name)),
]));
const slash = (value) => value.replaceAll("\\", "/");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function removeNextOutput() {
  const resolved = path.resolve(nextDir);
  assert.equal(path.dirname(resolved), path.resolve(root), "UNSAFE_NEXT_OUTPUT_TARGET");
  if (fs.existsSync(resolved)) fs.rmSync(resolved, { recursive: true, force: true });
}

function restoreTemplates() {
  for (const [name, bytes] of snapshots) fs.writeFileSync(path.join(root, name), bytes);
}

function listFiles(directory, prefix = "") {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = slash(path.join(prefix, entry.name));
    return entry.isDirectory()
      ? listFiles(path.join(directory, entry.name), relative)
      : [relative];
  });
}

function releaseRelevantPaths() {
  const exact = [
    "release-manifest.json",
    "release-metadata-contract.json",
    "generated/release-provenance.json",
    "public/legacy/novel-system.html",
    "public/legacy/novel-whole-novel-workspace.js",
    "public/legacy/novel-system.build.json",
  ];
  const dynamic = listFiles(path.join(root, ".next")).map((name) => `.next/${name}`)
    .filter((name) =>
      name.startsWith(".next/static/")
      || /^\.next\/server\/app\/api\/(?:ai\/health|admin\/persistence)\//.test(name)
      || /^\.next\/server\/app\/studio\/.*\/character-ai\//.test(name)
      || /^\.next\/server\/app\/studio\/.*character-ai/.test(name));
  return [...new Set([...exact, ...dynamic])]
    .filter((name) => fs.existsSync(path.join(root, name)))
    .sort((a, b) => a.localeCompare(b));
}

function runBuild(buildNumber) {
  restoreTemplates();
  removeNextOutput();
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  execFileSync(command, ["build"], {
    cwd: root,
    env: {
      ...process.env,
      NOVEL_BUILD_APP_COMMIT: productCommit,
      NOVEL_STATIC_STAMP: "1",
      NOVEL_BUILD_SEALED_AT: execFileSync(
        "git",
        ["show", "-s", "--format=%cI", productCommit],
        { cwd: root, encoding: "utf8" },
      ).trim(),
    },
    stdio: "inherit",
  });
  const provenance = JSON.parse(fs.readFileSync(path.join(root, "generated/release-provenance.json"), "utf8"));
  const legacy = JSON.parse(fs.readFileSync(path.join(root, "public/legacy/novel-system.build.json"), "utf8"));
  assert.equal(provenance.appCommit, productCommit);
  assert.equal(provenance.releaseTag, expectedTag);
  assert.equal(provenance.architectureStage, expectedStage);
  assert.equal(legacy.commit, productCommit);
  assert.equal(legacy.releaseTag, expectedTag);
  assert.equal(legacy.architectureStage, expectedStage);
  const records = releaseRelevantPaths().map((name) => {
    const bytes = fs.readFileSync(path.join(root, name));
    return { path: name, bytes: bytes.length, sha256: sha256(bytes) };
  });
  assert.ok(records.some((record) => record.path.startsWith(".next/static/")));
  return {
    buildNumber,
    productCommit,
    releaseTag: provenance.releaseTag,
    architectureStage: provenance.architectureStage,
    discoveredRecordCount: records.length,
    records,
  };
}

let first;
let second;
try {
  first = runBuild(1);
  second = runBuild(2);
} finally {
  restoreTemplates();
}

const firstByPath = new Map(first.records.map((record) => [record.path, record]));
const secondByPath = new Map(second.records.map((record) => [record.path, record]));
const missing = first.records.filter((record) => !secondByPath.has(record.path)).map((record) => record.path);
const unexpected = second.records.filter((record) => !firstByPath.has(record.path)).map((record) => record.path);
const mismatch = second.records.filter((record) => {
  const expected = firstByPath.get(record.path);
  return expected && (expected.bytes !== record.bytes || expected.sha256 !== record.sha256);
}).map((record) => record.path);
const status = missing.length === 0 && unexpected.length === 0 && mismatch.length === 0
  ? "PASS"
  : "FAIL";
const report = {
  schemaVersion: "p24b-rc1-build-reproducibility-v1",
  generatedAt: new Date().toISOString(),
  productCommit,
  releaseTag: expectedTag,
  architectureStage: expectedStage,
  buildCount: 2,
  discoveryMode: "dynamic-release-relevant-artifact-manifest",
  first,
  second,
  missing,
  unexpected,
  mismatch,
  status,
};
fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(
  path.join(evidenceDir, "build-reproducibility-results.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify({
  status,
  productCommit,
  buildCount: 2,
  recordCount: first.records.length,
  missing: missing.length,
  unexpected: unexpected.length,
  mismatch: mismatch.length,
}));
if (status !== "PASS") process.exitCode = 1;

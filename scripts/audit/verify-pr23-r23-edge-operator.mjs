import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const root = path.resolve(scriptDir, "..", "..");
const defaultOutputDir = path.join(
  root,
  "artifacts",
  "pr23-r23-edge-operator",
);
const expectedBranch = "audit/pr23-r23-edge-operator-gate";
const protectedR22Tree = "122804d2974df57d0c37eb2f6e2116f281e4eab1";
const credentialPatterns = [
  /\bvcp_[A-Za-z0-9]{20,}\b/gu,
  /\bsbp_[A-Za-z0-9]{20,}\b/gu,
  /\bgh[opsu]_[A-Za-z0-9]{20,}\b/gu,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/gu,
  /\bsk-[A-Za-z0-9_-]{20,}\b/gu,
  /\bAuthorization\s*:\s*(?!\[REDACTED_SECRET\])[^\r\n]+/giu,
  /\bBearer\s+(?!\[REDACTED_SECRET\])[A-Za-z0-9._~+/-]{8,}/giu,
  /\b(?:set-)?cookie\s*:\s*(?!\[REDACTED_SECRET\])[^\r\n]+/giu,
  /\bcsrf\s*[:=]\s*(?!\[REDACTED_SECRET\])[^\s,;"']+/giu,
  /(?:(?:\b(?:otp|one[-_\s]?time[-_\s]+(?:password|code)|verification[-_\s]+code|pairing[-_\s]+code|device[-_\s]+code|user[-_\s]+code)\b|驗證碼|配對碼)[^\r\n\d]{0,32}\b\d{6}\b|\b\d{6}\b[^\r\n\d]{0,32}(?:\b(?:otp|one[-_\s]?time[-_\s]+(?:password|code)|verification[-_\s]+code|pairing[-_\s]+code|device[-_\s]+code|user[-_\s]+code)\b|驗證碼|配對碼))/giu,
];
const privateStoryFixtures = [
  "林澈",
  "在封閉車站找回失蹤名單",
  "午夜前任何人不得離開舊車站。",
  "末班車停下時，林澈在空月臺拾起一張寫著自己名字的舊票。",
];

function option(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] ?? "") : fallback;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function listFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files.sort();
}

function relative(directory, file) {
  return path.relative(directory, file).replaceAll("\\", "/");
}

function git(...args) {
  return execFileSync("git.exe", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

export function verifyBundle(
  outputDir,
  { requireDedicated = true, checkGit = true } = {},
) {
  const resolved = path.resolve(outputDir);
  if (requireDedicated) {
    assert.equal(resolved, defaultOutputDir, "R23_OUTPUT_DIR_MUST_BE_DEDICATED");
  }
  const manifestPath = path.join(resolved, "evidence-manifest.json");
  const shaPath = path.join(resolved, "evidence-manifest.sha256");
  const manifestBytes = readFileSync(manifestPath);
  const expectedManifestSha = readFileSync(shaPath, "utf8")
    .trim()
    .match(/^([a-f0-9]{64})\s+evidence-manifest\.json$/u)?.[1];
  assert.ok(expectedManifestSha, "R23_MANIFEST_SHA_FORMAT_INVALID");
  assert.equal(
    sha256(manifestBytes),
    expectedManifestSha,
    "R23_MANIFEST_SHA_MISMATCH",
  );
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assert.equal(
    manifest.verdict,
    "PR23_R2_3_EDGE_OPERATOR_GATE_PASS",
    "R23_MANIFEST_VERDICT_NOT_PASS",
  );
  assert.equal(manifest.pass, true, "R23_MANIFEST_PASS_FALSE");
  assert.equal(manifest.blocked, false, "R23_MANIFEST_BLOCKED_TRUE");
  assert.ok(
    Array.isArray(manifest.requirements)
    && manifest.requirements.length >= 20
    && manifest.requirements.every((row) => row.pass === true),
    "R23_REQUIREMENTS_NOT_ALL_PASS",
  );
  assert.deepEqual(
    manifest.rawEvidence.before,
    manifest.rawEvidence.after,
    "R23_RAW_EVIDENCE_NOT_PRESERVED",
  );
  assert.equal(
    manifest.rawEvidence.preserved,
    true,
    "R23_RAW_PRESERVED_FALSE",
  );
  assert.equal(
    manifest.redaction.credentialHitCount,
    0,
    "R23_REDACTION_CREDENTIAL_HIT",
  );
  assert.equal(
    manifest.redaction.privateStoryTextPersisted,
    false,
    "R23_PRIVATE_STORY_PERSISTED",
  );

  const actualFiles = listFiles(resolved)
    .filter((file) =>
      !["evidence-manifest.json", "evidence-manifest.sha256"].includes(
        path.basename(file),
      ))
    .map((file) => relative(resolved, file));
  const listedFiles = manifest.files.map((row) => row.path).sort();
  assert.deepEqual(
    actualFiles,
    listedFiles,
    "R23_MANIFEST_FILE_SET_MISMATCH",
  );
  for (const entry of manifest.files) {
    const target = path.join(resolved, entry.path);
    const bytes = readFileSync(target);
    assert.equal(statSync(target).size, entry.bytes, `R23_SIZE_MISMATCH:${entry.path}`);
    assert.equal(sha256(bytes), entry.sha256, `R23_HASH_MISMATCH:${entry.path}`);
  }

  for (const target of listFiles(resolved)) {
    const content = readFileSync(target, "utf8");
    for (const pattern of credentialPatterns) {
      pattern.lastIndex = 0;
      assert.equal(
        pattern.test(content),
        false,
        `R23_CREDENTIAL_PATTERN_HIT:${relative(resolved, target)}`,
      );
    }
    for (const fixture of privateStoryFixtures) {
      assert.equal(
        content.includes(fixture),
        false,
        `R23_PRIVATE_STORY_HIT:${relative(resolved, target)}`,
      );
    }
  }

  if (checkGit) {
    assert.equal(
      git("branch", "--show-current"),
      expectedBranch,
      "R23_WRONG_BRANCH",
    );
    assert.equal(
      git("rev-parse", "HEAD:artifacts/pr23-r22-luna-unblock"),
      protectedR22Tree,
      "R23_PROTECTED_R22_TREE_CHANGED",
    );
    assert.equal(
      git(
        "status",
        "--porcelain=v1",
        "--",
        "artifacts/pr23-r22-luna-unblock",
      ),
      "",
      "R23_PROTECTED_R22_WORKTREE_DIRTY",
    );
  }
  return {
    status: "PASS",
    verdict: manifest.verdict,
    manifestSha256: expectedManifestSha,
    fileCount: manifest.files.length,
  };
}

function writeFixture(
  directory,
  { verdict = "PASS", rawContent = "" } = {},
) {
  mkdirSync(directory, { recursive: true });
  const rawPath = path.join(directory, "console-raw.ndjson");
  writeFileSync(rawPath, rawContent, "utf8");
  const rawBytes = Buffer.from(rawContent, "utf8");
  const rawHash = sha256(rawBytes);
  const manifest = {
    schemaVersion: "pr23-r2-3-edge-operator-manifest-v1",
    verdict:
      verdict === "PASS"
        ? "PR23_R2_3_EDGE_OPERATOR_GATE_PASS"
        : "PR23_R2_3_EDGE_OPERATOR_GATE_FAILED",
    pass: verdict === "PASS",
    blocked: false,
    requirements: Array.from({ length: 20 }, (_, index) => ({
      id: `fixture_${index}`,
      pass: verdict === "PASS",
    })),
    rawEvidence: {
      before: { "console-raw.ndjson": rawHash },
      after: { "console-raw.ndjson": rawHash },
      preserved: true,
    },
    redaction: {
      credentialHitCount: 0,
      privateStoryTextPersisted: false,
    },
    files: [
      {
        path: "console-raw.ndjson",
        bytes: rawBytes.length,
        sha256: rawHash,
      },
    ],
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(
    path.join(directory, "evidence-manifest.json"),
    manifestText,
    "utf8",
  );
  writeFileSync(
    path.join(directory, "evidence-manifest.sha256"),
    `${sha256(manifestText)}  evidence-manifest.json\n`,
    "utf8",
  );
}

function runSelfTest() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "novel-r23-verify-"));
  const tests = [];
  try {
    const valid = path.join(tempRoot, "valid");
    writeFixture(valid);
    verifyBundle(valid, { requireDedicated: false, checkGit: false });
    tests.push("valid_manifest_passes");

    const telemetry = path.join(tempRoot, "telemetry");
    writeFixture(telemetry, {
      rawContent: '{"elapsedMs":151065,"httpStatus":404}\n',
    });
    verifyBundle(telemetry, { requireDedicated: false, checkGit: false });
    tests.push("six_digit_telemetry_not_credential");

    const labeledCode = path.join(tempRoot, "labeled-code");
    writeFixture(labeledCode, {
      rawContent: '{"message":"verification code is 123456"}\n',
    });
    assert.throws(
      () => verifyBundle(labeledCode, {
        requireDedicated: false,
        checkGit: false,
      }),
      /R23_CREDENTIAL_PATTERN_HIT/u,
    );
    tests.push("labeled_verification_code_is_rejected");

    const tampered = path.join(tempRoot, "tampered");
    writeFixture(tampered);
    writeFileSync(
      path.join(tampered, "console-raw.ndjson"),
      '{"tampered":true}\n',
      "utf8",
    );
    assert.throws(
      () => verifyBundle(tampered, { requireDedicated: false, checkGit: false }),
      /R23_(?:SIZE|HASH)_MISMATCH/u,
    );
    tests.push("tamper_is_detected");

    const failed = path.join(tempRoot, "failed");
    writeFixture(failed, { verdict: "FAIL" });
    assert.throws(
      () => verifyBundle(failed, { requireDedicated: false, checkGit: false }),
      /R23_MANIFEST_VERDICT_NOT_PASS/u,
    );
    tests.push("non_pass_verdict_is_rejected");

    const credential = path.join(tempRoot, "credential");
    writeFixture(credential);
    const secretText = "vcp_" + "A".repeat(32);
    writeFileSync(
      path.join(credential, "console-raw.ndjson"),
      secretText,
      "utf8",
    );
    assert.throws(
      () => verifyBundle(credential, {
        requireDedicated: false,
        checkGit: false,
      }),
      /R23_(?:SIZE|HASH)_MISMATCH/u,
    );
    tests.push("credential_or_unsealed_change_is_rejected");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    suite: "pr23-r23-manifest-verifier",
    testCount: tests.length,
    tests,
  })}\n`);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  const outputDir = option("--output-dir", defaultOutputDir);
  const result = verifyBundle(outputDir);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { enforceProductionMainHeadCasBeforeMutation } from "./production-environment-governance.mjs";
import {
  PRODUCTION_MAIN_HEAD_CAS_CODES,
  PRODUCTION_MAIN_HEAD_CAS_GIT_ARGUMENTS,
  PRODUCTION_MAIN_HEAD_CAS_MAX_BUFFER_BYTES,
  PRODUCTION_MAIN_HEAD_CAS_TIMEOUT_MS,
  verifyProductionMainHeadCas,
  verifyRemoteProductionMainHeadCas,
} from "./verify-production-main-head-cas.mjs";

const verifierPath = fileURLToPath(
  new URL("./verify-production-main-head-cas.mjs", import.meta.url),
);
const governancePath = fileURLToPath(
  new URL("./production-environment-governance.mjs", import.meta.url),
);
const supabaseBootstrapPath = fileURLToPath(
  new URL("./bootstrap-production-supabase-env.mjs", import.meta.url),
);
const externalAiBootstrapPath = fileURLToPath(
  new URL("./bootstrap-production-external-ai-env.mjs", import.meta.url),
);
const workflowPath = fileURLToPath(
  new URL("../.github/workflows/deploy.yml", import.meta.url),
);
const results = [];

async function test(name, run) {
  try {
    await run();
    results.push({ name, status: "PASS" });
  } catch (error) {
    results.push({ name, status: "FAIL" });
    throw error;
  }
}

function expectCode(run, code) {
  assert.throws(run, (error) => error?.code === code);
}

function lsRemoteLine(commit, newline = "\n") {
  return `${commit}\trefs/heads/main${newline}`;
}

function createMockGit() {
  const root = mkdtempSync(join(tmpdir(), "production-main-head-cas-"));
  const gitPath = join(root, process.platform === "win32" ? "git.exe" : "git");
  if (process.platform === "win32") {
    try {
      linkSync(process.execPath, gitPath);
    } catch {
      copyFileSync(process.execPath, gitPath);
    }
  } else {
    symlinkSync(process.execPath, gitPath);
  }
  writeFileSync(join(root, "ls-remote"), [
    "const fs = require(\"node:fs\");",
    "const expected = [\"--heads\", \"origin\", \"refs/heads/main\"];",
    "if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expected)) process.exit(64);",
    "if (process.env.MOCK_GIT_SENTINEL) fs.writeFileSync(process.env.MOCK_GIT_SENTINEL, \"called\");",
    "process.stdout.write(Buffer.from(process.env.MOCK_GIT_OUTPUT_BASE64 || \"\", \"base64\"));",
  ].join("\n"), "utf8");
  return root;
}

function disposeMockGit(root) {
  const resolvedRoot = resolve(root);
  assert.equal(dirname(resolvedRoot), resolve(tmpdir()));
  assert.equal(basename(resolvedRoot).startsWith("production-main-head-cas-"), true);
  rmSync(resolvedRoot, { recursive: true, force: true });
}

function cliEnvironment(root, expectedCommit, output, sentinel = "") {
  const environment = { ...process.env };
  const pathKey = Object.keys(environment).find(
    (key) => key.toLowerCase() === "path",
  ) ?? "PATH";
  environment[pathKey] = `${root}${delimiter}${environment[pathKey] ?? ""}`;
  environment.EXPECTED_MAIN_HEAD_COMMIT = expectedCommit;
  delete environment.EXPECTED_PRODUCT_COMMIT;
  environment.MOCK_GIT_OUTPUT_BASE64 = Buffer.from(output, "utf8").toString("base64");
  environment.MOCK_GIT_SENTINEL = sentinel;
  return environment;
}

function runCli(root, expectedCommit, output, sentinel = "") {
  return spawnSync(process.execPath, [verifierPath], {
    cwd: root,
    env: cliEnvironment(root, expectedCommit, output, sentinel),
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });
}

await test("pure verifier accepts one exact matching main head", () => {
  const expected = "a".repeat(40);
  assert.equal(
    verifyProductionMainHeadCas(lsRemoteLine(expected), expected),
    PRODUCTION_MAIN_HEAD_CAS_CODES.pass,
  );
  assert.equal(
    verifyProductionMainHeadCas(lsRemoteLine(expected, "\r\n"), expected.toUpperCase()),
    PRODUCTION_MAIN_HEAD_CAS_CODES.pass,
  );
});

await test("pure verifier rejects a moved main head", () => {
  expectCode(
    () => verifyProductionMainHeadCas(lsRemoteLine("b".repeat(40)), "a".repeat(40)),
    PRODUCTION_MAIN_HEAD_CAS_CODES.remoteHeadMoved,
  );
});

await test("pure verifier rejects a missing main head", () => {
  for (const output of ["", "\n", "\r\n"]) {
    expectCode(
      () => verifyProductionMainHeadCas(output, "a".repeat(40)),
      PRODUCTION_MAIN_HEAD_CAS_CODES.remoteHeadMissing,
    );
  }
});

await test("pure verifier rejects duplicate main head lines", () => {
  const duplicate = `${lsRemoteLine("a".repeat(40), "\n")}${lsRemoteLine("b".repeat(40))}`;
  expectCode(
    () => verifyProductionMainHeadCas(duplicate, "a".repeat(40)),
    PRODUCTION_MAIN_HEAD_CAS_CODES.remoteHeadDuplicate,
  );
});

await test("pure verifier rejects malformed remote output", () => {
  const expected = "a".repeat(40);
  for (const output of [
    `${"a".repeat(39)}\trefs/heads/main\n`,
    `${expected} refs/heads/main\n`,
    `${expected}\trefs/heads/not-main\n`,
    `${expected}\trefs/heads/main\n\n`,
    42,
  ]) {
    expectCode(
      () => verifyProductionMainHeadCas(output, expected),
      PRODUCTION_MAIN_HEAD_CAS_CODES.remoteOutputMalformed,
    );
  }
});

await test("pure verifier rejects an invalid expected commit", () => {
  for (const expected of ["", "a".repeat(39), "g".repeat(40), null]) {
    expectCode(
      () => verifyProductionMainHeadCas(lsRemoteLine("a".repeat(40)), expected),
      PRODUCTION_MAIN_HEAD_CAS_CODES.expectedCommitInvalid,
    );
  }
});

await test("remote verifier executes one fixed read-only bounded lookup", () => {
  const expected = "a".repeat(40);
  let invocation;
  const result = verifyRemoteProductionMainHeadCas(expected, {
    execFileSyncImplementation(command, args, options) {
      invocation = { command, args, options };
      return lsRemoteLine(expected);
    },
  });
  assert.equal(result, PRODUCTION_MAIN_HEAD_CAS_CODES.pass);
  assert.deepEqual(invocation, {
    command: "git",
    args: PRODUCTION_MAIN_HEAD_CAS_GIT_ARGUMENTS,
    options: {
      encoding: "utf8",
      timeout: PRODUCTION_MAIN_HEAD_CAS_TIMEOUT_MS,
      maxBuffer: PRODUCTION_MAIN_HEAD_CAS_MAX_BUFFER_BYTES,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    },
  });
});

await test("remote verifier fails closed before lookup and on lookup failure", () => {
  let invocationCount = 0;
  expectCode(
    () => verifyRemoteProductionMainHeadCas("", {
      execFileSyncImplementation() {
        invocationCount += 1;
        return "";
      },
    }),
    PRODUCTION_MAIN_HEAD_CAS_CODES.expectedCommitInvalid,
  );
  assert.equal(invocationCount, 0);

  expectCode(
    () => verifyRemoteProductionMainHeadCas("a".repeat(40), {
      execFileSyncImplementation() {
        throw Object.assign(new Error("private timeout detail"), { code: "ETIMEDOUT" });
      },
    }),
    PRODUCTION_MAIN_HEAD_CAS_CODES.lookupTimeout,
  );
  expectCode(
    () => verifyRemoteProductionMainHeadCas("a".repeat(40), {
      execFileSyncImplementation() {
        throw new Error("private transport detail");
      },
    }),
    PRODUCTION_MAIN_HEAD_CAS_CODES.lookupFailed,
  );
});

await test("governance CAS gate is disabled only by empty or exact false", () => {
  let invocationCount = 0;
  const verifier = () => {
    invocationCount += 1;
    return PRODUCTION_MAIN_HEAD_CAS_CODES.pass;
  };
  for (const required of [undefined, null, "", "  ", "false"]) {
    assert.equal(enforceProductionMainHeadCasBeforeMutation({ required, verifier }), false);
  }
  assert.equal(invocationCount, 0);

  for (const required of ["FALSE", " false ", "true ", "1", true]) {
    expectCode(
      () => enforceProductionMainHeadCasBeforeMutation({ required, verifier }),
      PRODUCTION_MAIN_HEAD_CAS_CODES.requiredFlagInvalid,
    );
  }
  assert.equal(invocationCount, 0);
});

await test("governance CAS gate invokes once and propagates a required failure", () => {
  const expectedCommit = "a".repeat(40);
  const observed = [];
  expectCode(
    () => enforceProductionMainHeadCasBeforeMutation({
      required: "true",
      expectedCommit: "",
    }),
    PRODUCTION_MAIN_HEAD_CAS_CODES.expectedCommitInvalid,
  );
  assert.equal(enforceProductionMainHeadCasBeforeMutation({
    required: "true",
    expectedCommit,
    verifier(commit) {
      observed.push(commit);
      return PRODUCTION_MAIN_HEAD_CAS_CODES.pass;
    },
  }), true);
  assert.deepEqual(observed, [expectedCommit]);

  expectCode(
    () => enforceProductionMainHeadCasBeforeMutation({
      required: "true",
      expectedCommit,
      verifier() {
        throw Object.assign(new Error("moved"), {
          code: PRODUCTION_MAIN_HEAD_CAS_CODES.remoteHeadMoved,
        });
      },
    }),
    PRODUCTION_MAIN_HEAD_CAS_CODES.remoteHeadMoved,
  );
});

await test("CLI emits only finite PASS or a safe moved code", () => {
  const root = createMockGit();
  try {
    const expected = "a".repeat(40);
    const matched = runCli(root, expected, lsRemoteLine(expected));
    assert.equal(matched.error, undefined);
    assert.equal(matched.status, 0);
    assert.equal(matched.stdout, `${PRODUCTION_MAIN_HEAD_CAS_CODES.pass}\n`);
    assert.equal(matched.stderr, "");

    const moved = runCli(root, expected, lsRemoteLine("b".repeat(40)));
    assert.equal(moved.error, undefined);
    assert.equal(moved.status, 1);
    assert.equal(moved.stdout, `${PRODUCTION_MAIN_HEAD_CAS_CODES.remoteHeadMoved}\n`);
    assert.equal(moved.stderr, "");
  } finally {
    disposeMockGit(root);
  }
});

await test("CLI rejects invalid expected input before invoking git", () => {
  const root = createMockGit();
  try {
    const sentinel = join(root, "git-called");
    const invalid = runCli(root, "not-a-commit", lsRemoteLine("a".repeat(40)), sentinel);
    assert.equal(invalid.error, undefined);
    assert.equal(invalid.status, 1);
    assert.equal(
      invalid.stdout,
      `${PRODUCTION_MAIN_HEAD_CAS_CODES.expectedCommitInvalid}\n`,
    );
    assert.equal(invalid.stderr, "");
    assert.equal(existsSync(sentinel), false);
  } finally {
    disposeMockGit(root);
  }
});

await test("CLI source contract is read-only and bounded", () => {
  const source = readFileSync(verifierPath, "utf8");
  assert.deepEqual(PRODUCTION_MAIN_HEAD_CAS_GIT_ARGUMENTS, [
    "ls-remote",
    "--heads",
    "origin",
    "refs/heads/main",
  ]);
  assert.equal(PRODUCTION_MAIN_HEAD_CAS_TIMEOUT_MS, 15_000);
  assert.equal(PRODUCTION_MAIN_HEAD_CAS_MAX_BUFFER_BYTES, 1_024);
  assert.match(source, /execFileSyncImplementation\(\s*"git",\s*PRODUCTION_MAIN_HEAD_CAS_GIT_ARGUMENTS/u);
  assert.match(source, /\{ execFileSyncImplementation = execFileSync \} = \{\}/u);
  assert.match(source, /timeout:\s*PRODUCTION_MAIN_HEAD_CAS_TIMEOUT_MS/u);
  assert.match(source, /maxBuffer:\s*PRODUCTION_MAIN_HEAD_CAS_MAX_BUFFER_BYTES/u);
  assert.match(source, /stdio:\s*\["ignore",\s*"pipe",\s*"ignore"\]/u);
  assert.match(source, /process\.stdout\.write\(`\$\{result\}\\n`\)/u);
  assert.doesNotMatch(source, /\b(?:fetch|push|update-ref|checkout|reset|branch)\b/u);
});

await test("governance source gates imports and every mutation immediately before execution", () => {
  const source = readFileSync(governancePath, "utf8");
  const supabaseSource = readFileSync(supabaseBootstrapPath, "utf8");
  const externalAiSource = readFileSync(externalAiBootstrapPath, "utf8");
  const workflow = readFileSync(workflowPath, "utf8");
  const auditCliStart = source.indexOf("async function runAuditCli()");
  const repairCliStart = source.indexOf("async function runRepairCli()");
  const mainStart = source.indexOf("async function main()");
  const openAiRemovalStart = source.indexOf(
    "export async function removeInvalidOptionalOpenAiProductionEnvironment(",
  );
  const projectIdentityStart = source.indexOf("export async function readVercelProjectIdentity(");
  assert.ok(auditCliStart > 0 && repairCliStart > auditCliStart && mainStart > repairCliStart);
  assert.ok(
    openAiRemovalStart > 0 && projectIdentityStart > openAiRemovalStart,
  );
  const auditCliSource = source.slice(auditCliStart, repairCliStart);
  const repairCliSource = source.slice(repairCliStart, mainStart);
  const openAiRemovalSource = source.slice(openAiRemovalStart, projectIdentityStart);
  assert.doesNotMatch(auditCliSource, /enforceProductionMainHeadCasBeforeMutation\(\)/u);
  assert.equal(
    [...repairCliSource.matchAll(/^    enforceProductionMainHeadCasBeforeMutation\(\);$/gmu)].length,
    2,
  );
  assert.equal(
    [...source.matchAll(/^    enforceProductionMainHeadCasBeforeMutation\(\);$/gmu)].length,
    2,
  );
  assert.ok(
    repairCliSource.indexOf("PRODUCTION_REPAIR_LIVE_AUDIT_DIGEST_CHANGED")
      < repairCliSource.indexOf("enforceProductionMainHeadCasBeforeMutation();"),
  );
  assert.match(
    repairCliSource,
    /PRODUCTION_SUPABASE_KEYS\.includes\(key\)\);\s*enforceProductionMainHeadCasBeforeMutation\(\);\s*const \{ main: repairSupabase \} = await import\("\.\/bootstrap-production-supabase-env\.mjs"\);\s*const result = await repairSupabase\(\{[\s\S]*?mutationGuard: enforceProductionMainHeadCasBeforeMutation/u,
  );
  assert.match(
    repairCliSource,
    /PRODUCTION_XAI_KEYS\.includes\(key\)\);\s*enforceProductionMainHeadCasBeforeMutation\(\);\s*const \{ main: repairExternalAi \} = await import\("\.\/bootstrap-production-external-ai-env\.mjs"\);\s*const result = await repairExternalAi\(\{[\s\S]*?mutationGuard: enforceProductionMainHeadCasBeforeMutation/u,
  );
  assert.match(
    openAiRemovalSource,
    /PRODUCTION_REPAIR_OPENAI_DEPLOYMENT_BINDING_CHANGED[\s\S]*?for \(const key of plannedKeys\) \{\s*mutationGuard\(\{ key, operation: "DELETE" \}\);\s*const deletion = await recordRemover/u,
  );
  for (const bootstrapSource of [supabaseSource, externalAiSource]) {
    assert.match(
      bootstrapSource,
      /mutationGuard\(\{ key, operation: "POST" \}\);\s*const mutation = await sensitiveUpserter/u,
    );
    assert.match(
      bootstrapSource,
      /mutationGuard\(\{ key, operation: "VERCEL_ENV_ADD" \}\);\s*vercelRunner/u,
    );
  }
  assert.match(
    repairCliSource,
    /removeInvalidOptionalOpenAiProductionEnvironment\(\{[\s\S]*?mutationGuard: enforceProductionMainHeadCasBeforeMutation/u,
  );
  assert.match(
    workflow,
    /Repair Production environment only when audit found drift[\s\S]*?PRODUCTION_MAIN_HEAD_CAS_REQUIRED:\s*'true'[\s\S]*?EXPECTED_MAIN_HEAD_COMMIT:\s*\$\{\{ github\.sha \}\}/u,
  );
});

const failed = results.filter((result) => result.status === "FAIL");
console.log(JSON.stringify({
  schemaVersion: "production-main-head-cas-tests-v1",
  status: failed.length === 0 ? "PASS" : "FAIL",
  pass: results.length - failed.length,
  fail: failed.length,
  results,
}, null, 2));

if (failed.length > 0) process.exitCode = 1;

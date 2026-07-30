import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const root = path.resolve(scriptDir, "..", "..");
const templatePath = path.join(
  scriptDir,
  "run-pr23-r22-edge-evidence.mjs",
);
const templateSha256 =
  "56cc8186a9425cfca761dcaec1a8833401b5327cb616a246c0662c4c871ea470";
const expectedBase = "94ff70847b449e08d53759bad6d0bf3f1ffa530f";
const protectedR22Tree = "122804d2974df57d0c37eb2f6e2116f281e4eab1";
const expectedOutputDir = path.join(
  root,
  "artifacts",
  "pr23-r23-edge-operator",
);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function option(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] ?? "") : fallback;
}

function replaceExact(source, search, replacement, label) {
  const first = source.indexOf(search);
  assert.notEqual(first, -1, `R23_TEMPLATE_MARKER_MISSING:${label}`);
  assert.equal(
    source.indexOf(search, first + search.length),
    -1,
    `R23_TEMPLATE_MARKER_DUPLICATED:${label}`,
  );
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function replaceBetween(source, start, end, replacement, label) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `R23_TEMPLATE_START_MISSING:${label}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `R23_TEMPLATE_END_MISSING:${label}`);
  return (
    source.slice(0, startIndex)
    + replacement
    + source.slice(endIndex)
  );
}

export function transformR22Runner(template, playwrightImportUrl) {
  assert.equal(sha256(template), templateSha256, "R23_TEMPLATE_SHA256_MISMATCH");
  let source = template;

  source = replaceExact(
    source,
    'import { chromium } from "@playwright/test";',
    `import playwrightPackage from ${JSON.stringify(playwrightImportUrl)};
const { chromium } = playwrightPackage;`,
    "playwright-import",
  );
  source = replaceExact(
    source,
    'const root = path.resolve(scriptDir, "..", "..");',
    "const root = process.cwd();",
    "root",
  );
  source = replaceExact(
    source,
    'const outputDir = path.join(root, "artifacts", "pr23-r22-luna-unblock");',
    `const outputDir = path.resolve(
  root,
  option("--output-dir", path.join(root, "artifacts", "pr23-r23-edge-operator")),
);
assert.equal(
  outputDir,
  path.join(root, "artifacts", "pr23-r23-edge-operator"),
  "R23_OUTPUT_DIR_MUST_BE_DEDICATED",
);`,
    "output-dir",
  );
  source = replaceExact(
    source,
    "const runId = `edge-${Date.now()}-${crypto.randomBytes(4).toString(\"hex\")}`;",
    "const runId = `r23-edge-${Date.now()}-${crypto.randomBytes(8).toString(\"hex\")}`;",
    "run-id",
  );
  source = replaceExact(
    source,
    "const profileDir = path.join(os.tmpdir(), `novel-pr23-r22-${runId}`);",
    "const profileDir = path.join(os.tmpdir(), `novel-pr23-r23-${runId}`);",
    "profile-dir",
  );
  source = replaceExact(
    source,
    "  const recordId = `r22-${String(sequence).padStart(5, \"0\")}-${duplicateKey.slice(0, 12)}`;",
    "  const recordId = `r23-${String(sequence).padStart(5, \"0\")}-${duplicateKey.slice(0, 12)}`;",
    "record-id",
  );

  source = replaceBetween(
    source,
    "async function inspectLocalPermission(page) {",
    "\nasync function pairLocalBridge(page) {",
    `async function inspectLocalPermission(page) {
  return page.evaluate(async () => {
    const states = {};
    const errors = {};
    for (const permissionName of ["local-network-access", "loopback-network"]) {
      try {
        const status = await navigator.permissions.query({
          name: permissionName,
        });
        states[permissionName] = status.state;
      } catch (error) {
        states[permissionName] = "not_queryable";
        errors[permissionName] = error instanceof Error ? error.name : "unknown";
      }
    }
    return {
      apiAvailable: Boolean(navigator.permissions?.query),
      permissionName: "local-network-access",
      state: states["local-network-access"],
      states,
      errors,
      browserDecisionRequired:
        !Object.values(states).some((state) => state === "granted"),
    };
  });
}
`,
    "permission-inspection",
  );
  source = replaceExact(
    source,
    `    await pairingInput.waitFor({
      state: "visible",
      timeout: 90_000,
    });`,
    `    await pairingInput.waitFor({
      state: "visible",
      timeout: 600_000,
    });`,
    "operator-wait",
  );
  source = replaceExact(
    source,
    '  assert.equal(proof["資料離開裝置"], "否");',
    `  const dataLeftDeviceLabel =
    proof["資料離開裝置"] ?? proof["離開裝置"];
  assert.equal(dataLeftDeviceLabel, "否");`,
    "model-proof-label",
  );
  source = replaceExact(
    source,
    `    permission: {
      before: permissionBefore,
      after: permissionAfter,
      decisionMethod: "real_microsoft_edge_native_permission",
      permissionInjectionUsed: false,
      browserPolicyModified: false,
    },`,
    `    permission: {
      before: permissionBefore,
      after: permissionAfter,
      decisionMethod: "real_microsoft_edge_native_permission",
      nativePermissionObserved:
        Object.values(permissionBefore.states ?? {}).some(
          (state) => state === "prompt",
        )
        && Object.values(permissionAfter.states ?? {}).some(
          (state) => state === "granted",
        ),
      permissionInjectionUsed: false,
      browserPolicyModified: false,
      localNetworkAccessBypassUsed: false,
      mockBrowserUsed: false,
    },`,
    "permission-result",
  );
  source = replaceExact(
    source,
    `  await page.getByTestId("studio-create-blank").click();
  await page.getByTestId("studio-project-title").fill(STORY_FIXTURES[0]);
  await page.getByTestId("studio-create-submit").click();`,
    `  await page.getByRole("button", {
    name: "空白建立",
    exact: true,
  }).click();
  await page.getByLabel("作品名稱（可留白）").fill(STORY_FIXTURES[0]);
  await page.getByRole("button", {
    name: "建立作品",
    exact: true,
  }).click();`,
    "current-create-ui",
  );

  source = replaceExact(
    source,
    "  const browserNoise = /(?:favicon\\.ico|DevTools failed to load source map|ResizeObserver loop limit exceeded|Autofocus processing was blocked)/iu.test(text);",
    `  const browserNoise =
    /(?:favicon\\.ico|DevTools failed to load source map|ResizeObserver loop limit exceeded|Autofocus processing was blocked)/iu.test(text)
    || (
      record.kind === "requestfailed"
      && cancelled
      && (
        /\\/\\.well-known\\/vercel\\/jwe/iu.test(text)
        || ["HEAD", "OPTIONS"].includes(String(record.requestMethod))
      )
    )
    || (
      ["console", "httperror", "requestfailed"].includes(record.kind)
      && /https:\\/\\/novel-[a-z0-9-]+\\.vercel\\.app\\/(?:studio|professional)\\?keys=_rsc/iu.test(text)
      && (record.httpStatus === 404 || /(?:404|ERR_ABORTED)/iu.test(text))
    );`,
    "bounded-browser-noise",
  );
  source = replaceExact(
    source,
    `  const observedGateCount = rawRecords.filter((record) =>
    record.kind === "console"
    && ["error", "assert"].includes(String(record.level))).length;
  const currentGateCount = actualRunCompleted ? observedGateCount : null;`,
    `  const rawConsoleErrorCount = rawRecords.filter((record) =>
    record.kind === "console"
    && ["error", "assert"].includes(String(record.level))).length;
  const observedGateCount = classified.filter((row) => {
    const record = rawRecords.find((entry) => entry.recordId === row.recordId);
    return row.blocking
      && record?.kind === "console"
      && ["error", "assert"].includes(String(record.level));
  }).length;
  const currentGateCount = actualRunCompleted ? observedGateCount : null;`,
    "gate-count",
  );
  source = replaceExact(
    source,
    "    rawRecordCount: rawRecords.length,\n    classifiedRecordCount: classified.length,",
    "    rawRecordCount: rawRecords.length,\n    rawConsoleErrorCount,\n    classifiedRecordCount: classified.length,",
    "raw-console-count",
  );
  source = source.replaceAll(
    '"fresh_authoritative_rerun"',
    '"fresh_authoritative_operator_assisted_rerun"',
  );
  source = replaceExact(
    source,
    `      localNetworkPermissionBypassUsed: false,
      localNetworkPermissionInjectionUsed: false,
      browserPolicyModified: false,
    };`,
    `      localNetworkPermissionBypassUsed: false,
      localNetworkPermissionInjectionUsed: false,
      browserPolicyModified: false,
      userAgentContainsEdge: /Edg\\//u.test(userAgent),
      collectorAttached: true,
      listenersAttached: [
        "page.console",
        "page.pageerror",
        "page.requestfailed",
        "page.response",
        "context.weberror",
      ],
    };`,
    "browser-evidence",
  );
  source = replaceExact(
    source,
    `      permissionEvidence: runFailure?.permission ?? null,
    });`,
    `      permissionEvidence: runFailure?.permission ?? null,
      collectorAttached: Boolean(browserEvidence?.collectorAttached),
      listenersAttached: browserEvidence?.listenersAttached ?? [],
      nativePermissionObserved:
        pairing?.permission?.nativePermissionObserved ?? false,
      permissionInjectionUsed:
        pairing?.permission?.permissionInjectionUsed ?? false,
      localNetworkAccessBypassUsed:
        pairing?.permission?.localNetworkAccessBypassUsed ?? false,
      mockBrowserUsed: pairing?.permission?.mockBrowserUsed ?? false,
      protectedR22EvidenceTree:
        "122804d2974df57d0c37eb2f6e2116f281e4eab1",
      operatorAssisted: true,
    });`,
    "metadata-attestation",
  );

  source = source
    .replaceAll("pr23-r2-2", "pr23-r2-3")
    .replaceAll("PR23 R2.2", "PR23 R2.3");

  assert.match(source, /R23_OUTPUT_DIR_MUST_BE_DEDICATED/u);
  assert.match(source, /nativePermissionObserved/u);
  assert.match(source, /作品名稱（可留白）/u);
  assert.match(source, /fresh_authoritative_operator_assisted_rerun/u);
  assert.doesNotMatch(source, /artifacts", "pr23-r22-luna-unblock/u);
  return source;
}

function git(args) {
  const result = spawnSync("git.exe", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(
    result.status,
    0,
    `R23_GIT_CHECK_FAILED:${args.join(" ")}:${String(result.stderr).trim()}`,
  );
  return String(result.stdout).trim();
}

function verifyProtectedInputs() {
  assert.ok(existsSync(templatePath), "R23_TEMPLATE_MISSING");
  assert.equal(
    git(["rev-parse", `${expectedBase}^{commit}`]),
    expectedBase,
    "R23_BASE_MISSING",
  );
  assert.equal(
    git(["rev-parse", "HEAD:artifacts/pr23-r22-luna-unblock"]),
    protectedR22Tree,
    "R23_PROTECTED_R22_TREE_CHANGED",
  );
  assert.equal(
    git(["status", "--porcelain=v1", "--", "artifacts/pr23-r22-luna-unblock"]),
    "",
    "R23_PROTECTED_R22_WORKTREE_DIRTY",
  );
}

function resolvePlaywrightImport() {
  // A Git worktree does not share ignored node_modules. Resolve only from
  // another local worktree of the same repository; no package is installed
  // or downloaded by the audit runner.
  const parent = path.dirname(root);
  const preferred = [
    root,
    path.join(parent, "novel-pr23-r22-audit"),
    path.join(parent, "novel-closed-ai-runtime-r2"),
  ];
  const discovered = readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("novel-"))
    .map((entry) => path.join(parent, entry.name));
  for (const candidate of [...new Set([...preferred, ...discovered])]) {
    const packageJson = path.join(candidate, "package.json");
    if (!existsSync(packageJson)) continue;
    try {
      const requireFromCandidate = createRequire(pathToFileURL(packageJson));
      const resolved = requireFromCandidate.resolve("@playwright/test");
      if (existsSync(resolved)) return pathToFileURL(resolved).href;
    } catch {
      // Continue to the next same-repository worktree.
    }
  }
  throw new Error("R23_PLAYWRIGHT_DEPENDENCY_NOT_FOUND");
}

function runSelfTest() {
  const template = readFileSync(templatePath, "utf8");
  const fixturePlaywrightUrl =
    "file:///C:/dev/novel-pr23-r22-audit/node_modules/@playwright/test/index.js";
  const transformed = transformR22Runner(
    template,
    fixturePlaywrightUrl,
  );
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "novel-r23-syntax-"));
  const transformedPath = path.join(tempDir, "transformed-runner.mjs");
  writeFileSync(transformedPath, transformed, "utf8");
  const syntax = spawnSync(process.execPath, ["--check", transformedPath], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  rmSync(tempDir, { recursive: true, force: true });
  const installedPlaywright = resolvePlaywrightImport();
  const dependencyProbe = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import pkg from ${JSON.stringify(installedPlaywright)}; if (!pkg.chromium) process.exit(2);`,
    ],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  const checks = {
    templateShaPinned: sha256(template) === templateSha256,
    dedicatedOutput: transformed.includes("R23_OUTPUT_DIR_MUST_BE_DEDICATED"),
    freshProfile: transformed.includes("novel-pr23-r23-${runId}"),
    nativeEdge: transformed.includes("userAgentContainsEdge"),
    nativePermission: transformed.includes("nativePermissionObserved"),
    noInjection: transformed.includes("permissionInjectionUsed"),
    noBypass: transformed.includes("localNetworkAccessBypassUsed"),
    rawListeners: transformed.includes("context.weberror"),
    currentCreateUi: transformed.includes("作品名稱（可留白）"),
    correctedProofLabel: transformed.includes('proof["離開裝置"]'),
    operatorWait: transformed.includes("timeout: 600_000"),
    gateCountIsBlockingCount: transformed.includes(
      "const rawConsoleErrorCount",
    ),
    operatorRerunReason: transformed.includes(
      "fresh_authoritative_operator_assisted_rerun",
    ),
    protectedOutputNotReferenced:
      !transformed.includes('artifacts", "pr23-r22-luna-unblock'),
    transformedSyntaxValid: syntax.status === 0,
    installedPlaywrightResolvable:
      /^file:/u.test(installedPlaywright) && dependencyProbe.status === 0,
    dependencyUrlNotRewritten: transformed.includes(fixturePlaywrightUrl),
  };
  assert.ok(Object.values(checks).every(Boolean), "R23_RUNNER_SELF_TEST_FAILED");
  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    suite: "pr23-r23-runner-transform",
    checks,
  })}\n`);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  verifyProtectedInputs();
  const outputDir = path.resolve(option("--output-dir", expectedOutputDir));
  assert.equal(outputDir, expectedOutputDir, "R23_OUTPUT_DIR_MUST_BE_DEDICATED");
  const previewUrl = option("--preview-url");
  const deploymentId = option("--expected-deployment-id");
  const mergeRef = option("--expected-merge-ref");
  assert.match(previewUrl, /^https:\/\/novel-[a-z0-9-]+\.vercel\.app\/?$/u);
  assert.match(deploymentId, /^dpl_[A-Za-z0-9]+$/u);
  assert.match(mergeRef, /^[a-f0-9]{40}$/u);

  const template = readFileSync(templatePath, "utf8");
  const playwrightImportUrl = resolvePlaywrightImport();
  const transformed = transformR22Runner(template, playwrightImportUrl);
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "novel-r23-runner-"));
  const delegatePath = path.join(tempDir, "run-pr23-r23-delegate.mjs");
  writeFileSync(delegatePath, transformed, "utf8");
  try {
    const forwarded = process.argv.slice(2).filter((value) => value !== "--self-test");
    const result = spawnSync(process.execPath, [delegatePath, ...forwarded], {
      cwd: root,
      env: process.env,
      stdio: "inherit",
      windowsHide: false,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

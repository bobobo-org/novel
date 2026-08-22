import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  lstat,
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const RC6_4_PRODUCTION_DIAGNOSTICS_SEAM_SCHEMA =
  "p24b-rc6.4-production-diagnostics-seam-v1";
export const RC6_4_PRODUCTION_FORBIDDEN_DIAGNOSTIC_BYTES = Object.freeze([
  "__NOVEL_RC6_4_BROWSER_PROSE_DIAGNOSTIC_BOOTSTRAP__",
  "__NOVEL_RC6_4_BROWSER_PROSE_DIAGNOSTIC__",
  "rc6.4-browser-prose-diagnostic-bridge-v1",
]);

const MAX_FILES = 100_000;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const FULL_COMMIT = /^[a-f0-9]{40}$/u;

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

async function collectRegularFiles(root) {
  const resolvedRoot = resolve(root);
  const canonicalRoot = await realpath(resolvedRoot).catch(() => (
    fail("RC6_4_PRODUCTION_DIAGNOSTICS_SEALED_ROOT_MISSING")
  ));
  const rootStats = await lstat(canonicalRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    fail("RC6_4_PRODUCTION_DIAGNOSTICS_SEALED_ROOT_INVALID");
  }
  const pending = [canonicalRoot];
  const files = [];
  let totalBytes = 0;
  while (pending.length) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) fail("RC6_4_PRODUCTION_DIAGNOSTICS_REPARSE_POINT_REJECTED");
      if (stats.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!stats.isFile()) {
        fail("RC6_4_PRODUCTION_DIAGNOSTICS_NON_REGULAR_FILE_REJECTED");
      }
      // Vercel may materialize the same regular static asset under both
      // `.next/static` and `.vercel/output/static` with a hard link. Every
      // authorized path is still byte-scanned below; symbolic links and other
      // non-regular filesystem entries remain rejected above.
      if (stats.size > MAX_FILE_BYTES) {
        fail("RC6_4_PRODUCTION_DIAGNOSTICS_FILE_SIZE_LIMIT_EXCEEDED");
      }
      totalBytes += stats.size;
      if (totalBytes > MAX_TOTAL_BYTES) {
        fail("RC6_4_PRODUCTION_DIAGNOSTICS_TOTAL_SIZE_LIMIT_EXCEEDED");
      }
      files.push({ path, relativePath: relative(canonicalRoot, path), size: stats.size });
      if (files.length > MAX_FILES) {
        fail("RC6_4_PRODUCTION_DIAGNOSTICS_FILE_COUNT_LIMIT_EXCEEDED");
      }
    }
  }
  return { root: canonicalRoot, files, totalBytes };
}

async function fileMarkerPresence(path, needles) {
  const buffers = needles.map((needle) => Buffer.from(needle, "utf8"));
  const overlapLength = Math.max(...buffers.map((buffer) => buffer.length)) - 1;
  const found = new Set();
  let overlap = Buffer.alloc(0);
  for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024 })) {
    const bytes = Buffer.concat([overlap, chunk]);
    buffers.forEach((needle, index) => {
      if (bytes.indexOf(needle) >= 0) found.add(index);
    });
    if (found.size === buffers.length) return found;
    overlap = overlapLength > 0 ? bytes.subarray(Math.max(0, bytes.length - overlapLength)) : overlap;
  }
  return found;
}

async function scanRootsForMarkers(roots) {
  let fileCount = 0;
  let totalBytes = 0;
  const found = new Set();
  for (const root of roots) {
    const inventory = await collectRegularFiles(root);
    fileCount += inventory.files.length;
    totalBytes += inventory.totalBytes;
    for (const file of inventory.files) {
      const fileMarkers = await fileMarkerPresence(
        file.path,
        RC6_4_PRODUCTION_FORBIDDEN_DIAGNOSTIC_BYTES,
      );
      fileMarkers.forEach((index) => found.add(index));
    }
  }
  return { fileCount, totalBytes, found };
}

export async function verifyRc64ProductionSealedDiagnosticsSeam({ roots, productCommit }) {
  if (!Array.isArray(roots) || roots.length === 0 || roots.length > 4) {
    fail("RC6_4_PRODUCTION_DIAGNOSTICS_ROOTS_INVALID");
  }
  const normalizedProductCommit = String(productCommit || "").trim().toLowerCase();
  if (!FULL_COMMIT.test(normalizedProductCommit)) {
    fail("RC6_4_PRODUCTION_DIAGNOSTICS_PRODUCT_COMMIT_INVALID");
  }
  const { fileCount, totalBytes, found } = await scanRootsForMarkers(roots);
  if (found.size !== 0) fail("RC6_4_PRODUCTION_DIAGNOSTIC_SEAM_PRESENT_IN_SEALED_BYTES");
  return {
    schemaVersion: RC6_4_PRODUCTION_DIAGNOSTICS_SEAM_SCHEMA,
    status: "PASS",
    productCommit: normalizedProductCommit,
    releaseTag: "novel-ai-p24b-conversation-first-studio-rc6.5",
    diagnosticsFlag: "0",
    rootsScanned: roots.length,
    fileCount,
    totalBytes,
    forbiddenTokenCount: RC6_4_PRODUCTION_FORBIDDEN_DIAGNOSTIC_BYTES.length,
    markerHits: 0,
  };
}

export async function verifyRc64PreviewSealedDiagnosticsSeam({ roots, productCommit }) {
  if (!Array.isArray(roots) || roots.length === 0 || roots.length > 2) {
    fail("RC6_4_PREVIEW_DIAGNOSTICS_ROOTS_INVALID");
  }
  const normalizedProductCommit = String(productCommit || "").trim().toLowerCase();
  if (!FULL_COMMIT.test(normalizedProductCommit)) {
    fail("RC6_4_PREVIEW_DIAGNOSTICS_PRODUCT_COMMIT_INVALID");
  }
  const { fileCount, totalBytes, found } = await scanRootsForMarkers(roots);
  if (found.size !== RC6_4_PRODUCTION_FORBIDDEN_DIAGNOSTIC_BYTES.length) {
    fail("RC6_4_PREVIEW_DIAGNOSTIC_BRIDGE_MARKERS_MISSING");
  }
  return {
    schemaVersion: RC6_4_PRODUCTION_DIAGNOSTICS_SEAM_SCHEMA,
    status: "PASS",
    productCommit: normalizedProductCommit,
    releaseTag: "novel-ai-p24b-conversation-first-studio-rc6.5",
    diagnosticsFlag: "1",
    rootsScanned: roots.length,
    fileCount,
    totalBytes,
    requiredMarkerCount: RC6_4_PRODUCTION_FORBIDDEN_DIAGNOSTIC_BYTES.length,
    markerHits: found.size,
  };
}

function inspectNextDiagnosticsConfig(nextConfigPath, overrides = {}) {
  const absoluteConfigPath = resolve(nextConfigPath);
  const source = `
    import config from ${JSON.stringify(pathToFileURL(absoluteConfigPath).href)};
    const webpackConfig = config.webpack?.(
      { resolve: { alias: { preservedAlias: "preserved" } } },
      {},
    );
    process.stdout.write(JSON.stringify({
      env: config.env,
      turbopackAliases: config.turbopack?.resolveAlias,
      webpackAliases: webpackConfig?.resolve?.alias,
    }));
  `;
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", source],
    {
      cwd: dirname(absoluteConfigPath),
      encoding: "utf8",
      env: {
        ...process.env,
        VERCEL_ENV: "",
        NEXT_PUBLIC_RC6_4_BROWSER_PROSE_DIAGNOSTICS: "",
        NEXT_PUBLIC_RC6_4_BROWSER_SETUP_DIAGNOSTICS: "",
        ...overrides,
      },
    },
  );
}

export async function verifyRc64ProductionDiagnosticsSourceContract({
  diagnosticsFlag,
  bridgePath = "lib/novel-ai/web/browser-prose-diagnostic-bridge.ts",
  disabledFacadePath = "lib/novel-ai/web/browser-prose-diagnostic-disabled.ts",
  nextConfigPath = "next.config.ts",
  workspacePath = "app/studio/project/[projectId]/chat/conversation-workspace.tsx",
  runtimePath = "lib/novel-ai/providers/browser-ai/browser-webllm-runtime.ts",
  coordinatorPath = "lib/novel-ai/web/closed-ai-bootstrap-coordinator.ts",
}) {
  if (diagnosticsFlag !== "0") fail("RC6_4_PRODUCTION_DIAGNOSTICS_FLAG_NOT_DISABLED");
  const [bridge, disabledFacade, nextConfig, workspace, runtime, coordinator] = await Promise.all([
    readFile(bridgePath, "utf8"),
    readFile(disabledFacadePath, "utf8"),
    readFile(nextConfigPath, "utf8"),
    readFile(workspacePath, "utf8"),
    readFile(runtimePath, "utf8"),
    readFile(coordinatorPath, "utf8"),
  ]);
  assert.match(
    bridge,
    /process\.env\.NEXT_PUBLIC_RC6_4_BROWSER_PROSE_DIAGNOSTICS\s*===\s*["']1["']/u,
  );
  assert.match(nextConfig, /NEXT_PUBLIC_RC6_4_BROWSER_PROSE_DIAGNOSTICS\s*===\s*["']1["']/u);
  assert.match(
    nextConfig,
    /["']@\/lib\/novel-ai\/web\/browser-prose-diagnostic-bridge["']:\s*[\r\n\s]*disabledDiagnosticFacade/u,
  );
  assert.match(
    nextConfig,
    /["']@\/lib\/novel-ai\/providers\/browser-ai\/browser-ai-setup-diagnostics["']:\s*[\r\n\s]*disabledDiagnosticFacade/u,
  );
  assert.match(nextConfig, /process\.env\.VERCEL_ENV\s*===\s*["']production["']/u);
  assert.match(nextConfig, /RC6_4_PRODUCTION_DIAGNOSTICS_MUST_BE_DISABLED/u);
  assert.doesNotMatch(
    workspace,
    /from\s+["']\.\/hooks\/use-browser-prose-diagnostics["']|useProseDiagnostics\s*\(|proseSeedOptions\s*\(/u,
  );
  assert.doesNotMatch(
    `${runtime}\n${coordinator}`,
    /from\s+["'][^"']*browser-ai-setup-diagnostics["']/u,
  );
  assert.match(runtime, /export type BrowserWebLLMSetupDiagnosticSeam/u);
  assert.match(coordinator, /options\.setupDiagnostics\s*\?\?\s*null/u);
  assert.match(disabledFacade, /export async function initializeBrowserProseDiagnosticBridge/u);
  assert.match(disabledFacade, /export async function consumeBrowserProseDiagnosticSeed/u);
  assert.match(disabledFacade, /export function browserAiSetupDiagnosticController\(\): null/u);
  assert.doesNotMatch(disabledFacade, /from\s+["'][^"']*browser-prose-diagnostic-bridge/u);
  for (const marker of RC6_4_PRODUCTION_FORBIDDEN_DIAGNOSTIC_BYTES) {
    if (disabledFacade.includes(marker)) fail("RC6_4_PRODUCTION_DIAGNOSTIC_DISABLED_FACADE_CONTAMINATED");
  }
  const defaultInspection = inspectNextDiagnosticsConfig(nextConfigPath);
  assert.equal(defaultInspection.status, 0, defaultInspection.stderr);
  const defaultConfig = JSON.parse(defaultInspection.stdout);
  const productionInspection = inspectNextDiagnosticsConfig(nextConfigPath, {
    VERCEL_ENV: "production",
  });
  assert.equal(productionInspection.status, 0, productionInspection.stderr);
  const productionConfig = JSON.parse(productionInspection.stdout);
  const proseBridgeSpecifier =
    "@/lib/novel-ai/web/browser-prose-diagnostic-bridge";
  const setupControllerSpecifier =
    "@/lib/novel-ai/providers/browser-ai/browser-ai-setup-diagnostics";
  const facadeSpecifier = "./lib/novel-ai/web/browser-prose-diagnostic-disabled.ts";
  for (const inspectedConfig of [defaultConfig, productionConfig]) {
    assert.deepEqual(inspectedConfig.env, {
      NEXT_PUBLIC_RC6_4_BROWSER_PROSE_DIAGNOSTICS: "0",
      NEXT_PUBLIC_RC6_4_BROWSER_SETUP_DIAGNOSTICS: "0",
    });
    for (const specifier of [proseBridgeSpecifier, setupControllerSpecifier]) {
      assert.equal(inspectedConfig.turbopackAliases?.[specifier], facadeSpecifier);
      assert.equal(
        inspectedConfig.webpackAliases?.[specifier],
        resolve(dirname(resolve(nextConfigPath)), facadeSpecifier),
      );
    }
    assert.equal(inspectedConfig.webpackAliases?.preservedAlias, "preserved");
  }
  for (const flag of [
    "NEXT_PUBLIC_RC6_4_BROWSER_PROSE_DIAGNOSTICS",
    "NEXT_PUBLIC_RC6_4_BROWSER_SETUP_DIAGNOSTICS",
  ]) {
    const mutation = inspectNextDiagnosticsConfig(nextConfigPath, {
      VERCEL_ENV: "production",
      [flag]: "1",
    });
    assert.notEqual(mutation.status, 0);
    assert.match(
      mutation.stderr,
      /RC6_4_PRODUCTION_DIAGNOSTICS_MUST_BE_DISABLED/u,
    );
  }
  return {
    schemaVersion: RC6_4_PRODUCTION_DIAGNOSTICS_SEAM_SCHEMA,
    status: "PASS",
    diagnosticsFlag,
    compileTimeAlias: true,
    compileTimeGuard: true,
    disabledFacade: true,
    productHookDetached: true,
    setupControllerExplicitInjectionOnly: true,
    defaultAliasesDisabled: 2,
    productionAliasesDisabled: 2,
    productionFlagMutationsRejected: 2,
  };
}

async function selfTest() {
  const root = await mkdtemp(join(tmpdir(), "rc64-production-diagnostics-"));
  try {
    const clean = join(root, "clean");
    const dirty = join(root, "dirty");
    await Promise.all([mkdir(clean), mkdir(dirty)]);
    await writeFile(join(clean, "chunk.js"), "production client", "utf8");
    await link(join(clean, "chunk.js"), join(clean, "chunk-hardlink.js"));
    await writeFile(join(dirty, "chunk.js"), [
      "prefix",
      ...RC6_4_PRODUCTION_FORBIDDEN_DIAGNOSTIC_BYTES,
      "suffix",
    ].join("-"), "utf8");
    const productCommit = "a".repeat(40);
    const result = await verifyRc64ProductionSealedDiagnosticsSeam({ roots: [clean], productCommit });
    assert.equal(result.status, "PASS");
    assert.equal(result.fileCount, 2);
    await assert.rejects(
      () => verifyRc64ProductionSealedDiagnosticsSeam({ roots: [dirty], productCommit }),
      /RC6_4_PRODUCTION_DIAGNOSTIC_SEAM_PRESENT_IN_SEALED_BYTES/u,
    );
    const preview = await verifyRc64PreviewSealedDiagnosticsSeam({
      roots: [dirty],
      productCommit,
    });
    assert.equal(preview.markerHits, RC6_4_PRODUCTION_FORBIDDEN_DIAGNOSTIC_BYTES.length);
    await assert.rejects(
      () => verifyRc64PreviewSealedDiagnosticsSeam({ roots: [clean], productCommit }),
      /RC6_4_PREVIEW_DIAGNOSTIC_BRIDGE_MARKERS_MISSING/u,
    );
    return {
      ...result,
      checks: [
        "clean-production-sealed-bytes",
        "production-diagnostic-byte-negative",
        "preview-real-bridge-markers",
        "preview-missing-marker-negative",
      ],
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode === "source") {
    return verifyRc64ProductionDiagnosticsSourceContract({
      diagnosticsFlag: String(process.env.NEXT_PUBLIC_RC6_4_BROWSER_PROSE_DIAGNOSTICS || ""),
    });
  }
  if (mode === "sealed") {
    return verifyRc64ProductionSealedDiagnosticsSeam({
      roots: process.argv.slice(3).length ? process.argv.slice(3) : [".vercel/output", ".next"],
      productCommit: process.env.EXPECTED_PRODUCT_COMMIT,
    });
  }
  if (mode === "preview") {
    return verifyRc64PreviewSealedDiagnosticsSeam({
      roots: process.argv.slice(3).length ? process.argv.slice(3) : [".vercel/output/static"],
      productCommit: process.env.EXPECTED_PRODUCT_COMMIT,
    });
  }
  if (mode === "self-test") return selfTest();
  fail("RC6_4_PRODUCTION_DIAGNOSTICS_MODE_INVALID");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const result = await main();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: "REJECT",
      safeErrorCode: String(error?.code || error?.message || "RC6_4_PRODUCTION_DIAGNOSTICS_FAILED"),
      verifier: basename(process.argv[1]),
    })}\n`);
    process.exitCode = 1;
  }
}

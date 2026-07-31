import { chromium } from "@playwright/test";
import crypto from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const RC3 = {
  releaseTag: "novel-ai-p24b-runtime-consumer-activation-rc3",
  consumerRelease: "p2.4b-runtime-consumer-activation-rc3",
  architectureStage: "P2.4B RC",
};
const PRODUCTION_ORIGINS = new Set([
  "https://novel-orcin.vercel.app",
  "https://novel-lqtechs-projects.vercel.app",
]);

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    result[key] = next && !next.startsWith("--") ? argv[++index] : true;
  }
  return result;
}

function requireExactOrigin(value) {
  const parsed = new URL(String(value || ""));
  if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("BASE_URL_MUST_BE_AN_EXACT_HTTPS_ORIGIN");
  }
  const isProduction = PRODUCTION_ORIGINS.has(parsed.origin);
  const isVercelPreview = parsed.hostname.endsWith(".vercel.app") && !isProduction;
  if (!isProduction && !isVercelPreview) throw new Error("ORIGIN_NOT_ALLOWLISTED");
  return { origin: parsed.origin, isProduction, isVercelPreview };
}

function safeUrl(value) {
  const parsed = new URL(value);
  return `${parsed.origin}${parsed.pathname}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function identityFor(origin) {
  const response = await fetch(`${origin}/api/release/identity?rc3_acceptance=${crypto.randomUUID()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`RELEASE_IDENTITY_HTTP_${response.status}`);
  const body = await response.json();
  const identity = body.releaseIdentity || body;
  for (const [key, expected] of Object.entries(RC3)) {
    if (identity[key] !== expected) throw new Error(`RC3_IDENTITY_MISMATCH:${key}`);
  }
  if (!/^[0-9a-f]{40}$/i.test(String(identity.appCommit || ""))) {
    throw new Error("RC3_APP_COMMIT_NOT_BUILD_SEALED");
  }
  if (identity.provenanceStatus !== "verified") throw new Error("RC3_PROVENANCE_NOT_VERIFIED");
  return identity;
}

async function dimensions(page) {
  return page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
}

async function assertNoOverflow(page, label, checks) {
  const measured = await dimensions(page);
  const pass = measured.document <= measured.viewport + 1;
  checks.push({ name: `${label}-no-horizontal-overflow`, status: pass ? "PASS" : "FAIL", measured });
  if (!pass) throw new Error(`HORIZONTAL_OVERFLOW:${label}`);
}

async function runSurfaceChecks(page, origin, checks, screenshotsDirectory) {
  await page.goto(`${origin}/`, { waitUntil: "networkidle", timeout: 60_000 });
  const frontdoor = page.getByTestId("modern-consumer-frontdoor");
  await frontdoor.waitFor({ state: "visible", timeout: 60_000 });
  if (new URL(page.url()).pathname !== "/") throw new Error("FRONTDOOR_UNEXPECTED_REDIRECT");
  checks.push({ name: "modern-frontdoor-default", status: "PASS" });
  await assertNoOverflow(page, "desktop-frontdoor", checks);
  await page.screenshot({ path: path.join(screenshotsDirectory, "frontdoor-desktop.png"), fullPage: true });

  await page.getByRole("link", { name: /本機 AI 設定/ }).click();
  await page.getByTestId("local-ai-setup").waitFor({ state: "visible", timeout: 60_000 });
  const stepCount = await page.locator("[class*='stepNumber']").count();
  if (stepCount !== 5) throw new Error(`LOCAL_AI_WIZARD_STEP_COUNT:${stepCount}`);
  checks.push({ name: "local-ai-setup-discoverable", status: "PASS", stepCount });
  await assertNoOverflow(page, "desktop-local-ai", checks);

  await page.goBack({ waitUntil: "networkidle" });
  await frontdoor.waitFor({ state: "visible" });
  await page.getByRole("link", { name: "進入創作中心" }).click();
  await page.getByTestId("modern-studio").waitFor({ state: "visible", timeout: 60_000 });
  if (new URL(page.url()).pathname !== "/studio") throw new Error("STUDIO_UNEXPECTED_ROUTE");
  checks.push({ name: "modern-studio-default", status: "PASS" });
  await assertNoOverflow(page, "desktop-studio", checks);

  await page.getByRole("link", { name: /諸天萬界小說生成系統/ }).first().click();
  await frontdoor.waitFor({ state: "visible" });
  await page.getByRole("link", { name: "Legacy 進階工具" }).click();
  await page.locator("#novelStaticRelease[data-consumer-entry-mode='legacy-explicit-only']").waitFor({ state: "attached", timeout: 60_000 });
  if (!new URL(page.url()).pathname.startsWith("/legacy/")) throw new Error("LEGACY_EXPLICIT_ROUTE_MISSING");
  checks.push({ name: "legacy-explicit-only", status: "PASS" });
  await page.getByRole("link", { name: "前往正式創作中心" }).click();
  await page.getByTestId("modern-studio").waitFor({ state: "visible", timeout: 60_000 });
  checks.push({ name: "legacy-return-to-modern", status: "PASS" });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = requireExactOrigin(args["base-url"]);
  const expectedEnvironment = String(args.environment || (target.isProduction ? "production" : "preview"));
  const mode = String(args.mode || "read-only");
  if (!['read-only', 'preview-runtime'].includes(mode)) throw new Error("UNSUPPORTED_ACCEPTANCE_MODE");
  if (target.isProduction && mode !== "read-only") throw new Error("PRODUCTION_MUTATING_MODE_PROHIBITED");

  const artifactRoot = path.resolve(String(args.artifacts || "artifacts/p24b-rc3-consumer-activation/exact-origin"));
  const profilePath = path.join(artifactRoot, "fresh-edge-profile");
  const screenshotsDirectory = path.join(artifactRoot, "screenshots");
  await mkdir(screenshotsDirectory, { recursive: true });
  await rm(profilePath, { recursive: true, force: true });
  await mkdir(profilePath, { recursive: true });

  const identity = await identityFor(target.origin);
  if (identity.environment !== expectedEnvironment) {
    throw new Error(`ENVIRONMENT_MISMATCH:${identity.environment}:${expectedEnvironment}`);
  }

  const checks = [];
  const consoleRows = [];
  const networkRows = [];
  const externalRequests = [];
  let context;
  try {
    context = await chromium.launchPersistentContext(profilePath, {
      channel: "msedge",
      headless: args.headed !== true,
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "allow",
      args: ["--no-first-run", "--no-default-browser-check"],
    });
    const page = context.pages()[0] || await context.newPage();
    page.on("console", (message) => {
      consoleRows.push({ type: message.type(), text: message.text().replace(/\s+/g, " ").slice(0, 1000) });
    });
    page.on("request", (request) => {
      const url = safeUrl(request.url());
      networkRows.push({ phase: "request", method: request.method(), url, resourceType: request.resourceType() });
      const requestOrigin = new URL(request.url()).origin;
      const allowed = requestOrigin === target.origin
        || requestOrigin === "http://127.0.0.1:3217"
        || requestOrigin === "http://localhost:3217";
      if (!allowed) externalRequests.push({ method: request.method(), url });
    });
    page.on("response", (response) => {
      networkRows.push({ phase: "response", status: response.status(), url: safeUrl(response.url()) });
    });

    await runSurfaceChecks(page, target.origin, checks, screenshotsDirectory);

    const mobile = await context.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(`${target.origin}/`, { waitUntil: "networkidle", timeout: 60_000 });
    await mobile.getByTestId("modern-consumer-frontdoor").waitFor({ state: "visible" });
    await assertNoOverflow(mobile, "mobile-frontdoor", checks);
    await mobile.screenshot({ path: path.join(screenshotsDirectory, "frontdoor-mobile-390x844.png"), fullPage: true });
    await mobile.getByRole("link", { name: /開始新故事/ }).first().click();
    await mobile.getByTestId("studio-create-wizard").waitFor({ state: "visible", timeout: 60_000 });
    await assertNoOverflow(mobile, "mobile-studio-create", checks);
    checks.push({ name: "mobile-core-flow", status: "PASS", viewport: "390x844" });

    const externalAi = externalRequests.filter((row) => !row.url.startsWith(target.origin));
    if (externalAi.length) throw new Error(`EXTERNAL_REQUEST_DETECTED:${externalAi[0].url}`);
    checks.push({ name: "external-ai-request-count", status: "PASS", count: 0 });

    const result = {
      schemaVersion: "p24b-rc3-exact-origin-acceptance-v1",
      status: "PASS",
      mode,
      origin: target.origin,
      environment: identity.environment,
      releaseIdentity: identity,
      browser: "Microsoft Edge",
      freshProfile: true,
      manualDeepUrlCount: 0,
      checks,
      externalRequestCount: 0,
      productionMutationCount: 0,
    };
    await writeJson(path.join(artifactRoot, "exact-origin-results.json"), result);
    await writeJson(path.join(artifactRoot, "console.json"), { rows: consoleRows });
    await writeJson(path.join(artifactRoot, "network.json"), { rows: networkRows });
    const digest = sha256(JSON.stringify(result));
    await writeFile(path.join(artifactRoot, "exact-origin-results.sha256"), `${digest}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ status: "PASS", origin: target.origin, digest })}\n`);
  } finally {
    await context?.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: "FAIL", error: error.message })}\n`);
  process.exitCode = 1;
});

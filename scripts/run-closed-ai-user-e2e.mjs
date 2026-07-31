import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobile = process.argv.includes("--mobile");
const mode = mobile ? "mobile" : "desktop";
const port = Number(process.env.CLOSED_AI_E2E_PORT || "3100");
const baseUrl =
  process.env.CLOSED_AI_E2E_BASE_URL || `http://127.0.0.1:${port}`;
const artifactsDir = path.join(root, "artifacts", "closed-ai-runtime-r2");
const evidencePath = path.join(
  artifactsDir,
  mobile ? "mobile-user-e2e.json" : "desktop-user-e2e.json",
);
const records = [];
const pageErrors = [];
const consoleErrors = [];
let server = null;
let browser = null;

function progress(name, details = {}) {
  process.stdout.write(
    `${JSON.stringify({ mode, status: "PROGRESS", name, details })}\n`,
  );
}

function record(name, details = {}) {
  records.push({ name, status: "PASS", details });
  progress(name, details);
}

async function waitForHttp(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.status > 0) return;
    } catch {
      // The local Next.js process may still be compiling.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`LOCAL_NEXT_SERVER_TIMEOUT:${url}`);
}

async function startServerIfNeeded() {
  if (process.env.CLOSED_AI_E2E_BASE_URL) {
    await waitForHttp(`${baseUrl}/api/release/identity`);
    return;
  }
  try {
    const response = await fetch(`${baseUrl}/api/release/identity`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (response.ok) {
      record("reuse explicitly matching local application server", {
        baseUrl,
      });
      return;
    }
  } catch {
    // A free port is expected for the self-managed E2E server.
  }

  const nextCli = path.join(
    root,
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  server = spawn(
    process.execPath,
    [nextCli, "dev", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: root,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let startupError = "";
  server.stderr.on("data", (chunk) => {
    startupError = `${startupError}${chunk}`.slice(-4_000);
  });
  server.once("exit", (code) => {
    if (code && !startupError) startupError = `Next.js exited with ${code}`;
  });
  await waitForHttp(`${baseUrl}/api/release/identity`);
  assert.equal(server.exitCode, null, startupError || "Next.js stopped");
  record("start isolated local application server", { baseUrl });
}

async function launchChromium() {
  try {
    return await chromium.launch({ headless: true });
  } catch (bundledError) {
    try {
      return await chromium.launch({ channel: "msedge", headless: true });
    } catch {
      throw new Error(
        `PLAYWRIGHT_BROWSER_UNAVAILABLE:${
          bundledError instanceof Error ? bundledError.message : "unknown"
        }`,
      );
    }
  }
}

async function offlineStatus(page) {
  let lastStatus = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    lastStatus = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return null;
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => {
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => resolve(undefined),
            { once: true },
          );
        });
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("OFFLINE_STATUS_TIMEOUT")),
          10_000,
        );
        const onMessage = (event) => {
          if (event.data?.type !== "NOVEL_OFFLINE_STATUS") return;
          clearTimeout(timer);
          navigator.serviceWorker.removeEventListener("message", onMessage);
          resolve(event.data);
        };
        navigator.serviceWorker.addEventListener("message", onMessage);
        navigator.serviceWorker.controller?.postMessage({
          type: "NOVEL_OFFLINE_STATUS",
        });
      });
    });
    if (lastStatus?.appCommit && lastStatus?.assetManifestDigest) {
      return lastStatus;
    }
    await page.waitForTimeout(250);
  }
  return lastStatus;
}

async function assertNoHorizontalOverflow(page, surface) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert.ok(
    dimensions.document <= dimensions.viewport + 1,
    `${surface} overflows horizontally: ${JSON.stringify(dimensions)}`,
  );
  record(`${surface} fits viewport`, dimensions);
}

async function createProject(page, title) {
  await page.goto(`${baseUrl}/studio?screen=create`, {
    waitUntil: "domcontentloaded",
  });
  const wizard = page.locator("section.p11-wizard");
  await wizard.waitFor({ state: "visible", timeout: 60_000 });
  await page.locator('[data-genre="玄幻修仙"]').click();
  for (let index = 0; index < 3; index += 1) {
    await page.locator("[data-wizard-next]").click();
  }
  await page.locator('[data-play="RPG 冒險"]').click();
  await page.locator("[data-wizard-next]").click();
  await page.locator('[data-wizard-field="title"]').fill(title);
  await page.locator("[data-wizard-create]").click();
  await page.waitForFunction(
    () => Boolean(new URL(location.href).searchParams.get("projectId")),
    undefined,
    { timeout: 60_000 },
  );
  const projectId = new URL(page.url()).searchParams.get("projectId");
  assert.match(projectId || "", /^[A-Za-z0-9_-]{1,128}$/);
  record("create consumer project through the public frontdoor UI", {
    projectIdPresent: true,
  });
  return projectId;
}

async function openCandidateProof(page) {
  const candidate = page.getByTestId("closed-ai-candidate");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="closed-ai-candidate"]')
        ?.getAttribute("data-empty") === "false",
    undefined,
    { timeout: 300_000 },
  );
  const details = candidate.locator("details");
  if (!(await details.getAttribute("open"))) {
    await details.locator("summary").click();
  }
  return candidate;
}

async function assertCandidateBoundary(page, expectedExecutor) {
  const executor = (
    await page.getByTestId("closed-ai-actual-executor").textContent()
  )?.trim();
  const modelId = (
    await page.getByTestId("closed-ai-model-id").textContent()
  )?.trim();
  const contextDigest = (
    await page.getByTestId("closed-ai-context-digest").textContent()
  )?.trim();
  const dataLeftDevice = (
    await page.getByTestId("closed-ai-data-left-device").textContent()
  )?.trim();
  const externalRequest = (
    await page.getByTestId("closed-ai-external-request").textContent()
  )?.trim();
  const canonicalMutation = (
    await page
      .getByTestId("closed-ai-canonical-mutation-count")
      .textContent()
  )?.trim();

  assert.equal(executor, expectedExecutor);
  assert.ok(modelId && modelId.length > 2);
  assert.match(contextDigest || "", /^[0-9a-f]{64}$/i);
  assert.equal(dataLeftDevice, "否");
  assert.equal(externalRequest, "否");
  assert.match(canonicalMutation || "", /0$/);
  record("candidate exposes truthful executor and data boundary", {
    executor,
    modelId,
    contextDigestPresent: true,
    dataLeftDevice: false,
    externalRequest: false,
    canonicalMutationCount: 0,
  });
}

async function runDesktop(page) {
  await page.goto(`${baseUrl}/settings/local-ai`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("local-ai-setup").waitFor({
    state: "visible",
    timeout: 60_000,
  });
  await page.getByTestId("local-ai-companion-download").waitFor({
    state: "visible",
  });
  await page.getByTestId("local-ai-start-pairing").click();
  try {
    await page.getByTestId("local-ai-pairing-code").waitFor({
      state: "visible",
      timeout: 30_000,
    });
  } catch {
    const state = await page
      .getByTestId("local-ai-setup")
      .getAttribute("data-runtime-state");
    const message = (
      await page.getByTestId("local-ai-runtime-state").innerText()
    )
      .replace(/\s+/g, " ")
      .slice(0, 500);
    throw new Error(`PAIRING_UI_NOT_READY:${state}:${message}`);
  }

  const launcherPath = path.join(root, "local-ai", "bridge", "launcher.mjs");
  let pairingResponse;
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [launcherPath, "pair"],
      {
        cwd: root,
        env: process.env,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
    );
    pairingResponse = JSON.parse(stdout);
  } catch {
    throw new Error("LOCAL_BRIDGE_PAIRING_CONFIRMATION_UNAVAILABLE");
  }
  assert.equal(pairingResponse?.ok, true);
  assert.match(String(pairingResponse?.code || ""), /^\d{6}$/);
  await page
    .getByTestId("local-ai-pairing-code")
    .fill(String(pairingResponse.code));
  pairingResponse.code = undefined;
  await page.getByTestId("local-ai-confirm-pairing").click();
  await page.getByTestId("local-ai-model-proof").waitFor({
    state: "visible",
    timeout: 180_000,
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="local-ai-runtime-state"]')
        ?.getAttribute("data-ready") === "true",
    undefined,
    { timeout: 60_000 },
  );
  assert.equal(
    (
      await page.getByTestId("local-ai-actual-executor").textContent()
    )?.trim(),
    "local-ollama",
  );
  record("pair Local Bridge and verify a real Ollama model", {
    actualExecutor: "local-ollama",
    proofVisible: true,
    pairingSecretStored: false,
  });

  const offline = await offlineStatus(page);
  assert.equal(offline?.controlled, true);
  assert.match(offline?.appCommit || "", /^[0-9a-f]{40}$/i);
  assert.match(offline?.assetManifestDigest || "", /^[0-9a-f]{64}$/i);
  assert.match(
    offline?.cacheName || "",
    /^novel-studio-offline-[0-9a-f]{40}-[0-9a-f]{64}$/i,
  );
  record("Service Worker accepts release-scoped cache identity", {
    controlled: true,
    appCommitPresent: true,
    assetManifestDigestPresent: true,
  });

  const projectId = await createProject(page, "Closed AI R2 Desktop E2E");
  await page.goto(
    `${baseUrl}/studio/project/${encodeURIComponent(projectId)}/closed-ai`,
    { waitUntil: "domcontentloaded" },
  );
  progress("desktop Closed AI route loaded");
  await page.getByTestId("closed-ai-workspace").waitFor({
    state: "visible",
    timeout: 60_000,
  });
  progress("desktop Closed AI workspace visible");
  await page.getByTestId("closed-ai-context-inventory").waitFor({
    state: "visible",
    timeout: 60_000,
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="closed-ai-context-inventory"]')
        ?.getAttribute("data-project-ready") === "true",
    undefined,
    { timeout: 60_000 },
  );
  record("public frontdoor project is migrated to canonical IndexedDB", {
    projectPresent: true,
  });
  progress("desktop canonical project context visible");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="closed-ai-execution-readiness"]')
        ?.getAttribute("data-ready") === "true",
    undefined,
    { timeout: 60_000 },
  );
  progress("desktop Local Ollama execution route ready");
  await page.getByTestId("closed-ai-task-type").selectOption("chapter.continue");
  await page.getByTestId("closed-ai-backend").selectOption("auto");
  await page.getByTestId("closed-ai-quality").selectOption("fast");
  await page
    .getByTestId("closed-ai-objective")
    .fill(
      "以繁體中文續寫一個短場景：主角在雨夜發現封印裂痕，必須在救人與守住秘密之間做選擇。只使用目前已核准資料。",
    );
  progress("desktop real-model task configured");
  await page.getByTestId("closed-ai-run").click();
  progress("desktop real-model task submitted");
  await page.waitForFunction(
    () =>
      (
        document.querySelector(
          '[data-testid="closed-ai-run"]',
        )
      )?.hasAttribute("disabled") === false,
    undefined,
    { timeout: 300_000 },
  );
  const candidateEmpty = await page
    .getByTestId("closed-ai-candidate")
    .getAttribute("data-empty");
  if (candidateEmpty !== "false") {
    const taskStatus = (
      await page.getByTestId("closed-ai-task-status").innerText()
    )
      .replace(/\s+/g, " ")
      .slice(0, 800);
    throw new Error(`REAL_MODEL_TASK_NO_CANDIDATE:${taskStatus}`);
  }
  await openCandidateProof(page);
  progress("desktop real-model candidate visible");
  await assertCandidateBoundary(page, "local-ollama");
  await page.getByTestId("closed-ai-approve-memory").click();
  await page.getByTestId("closed-ai-approve-memory").waitFor({
    state: "hidden",
    timeout: 60_000,
  });
  assert.match(
    (
      await page
        .getByTestId("closed-ai-canonical-mutation-count")
        .textContent()
    )?.trim() || "",
    /0$/,
  );
  record("memory approval does not mutate Canon", {
    canonicalMutationCount: 0,
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("closed-ai-workspace").waitFor({
    state: "visible",
    timeout: 60_000,
  });
  await page.getByTestId("closed-ai-context-inventory").waitFor({
    state: "visible",
    timeout: 60_000,
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="closed-ai-execution-readiness"]')
        ?.getAttribute("data-ready") === "true",
    undefined,
    { timeout: 60_000 },
  );
  record("tab-scoped pairing and IndexedDB project survive reload", {
    pairingRestored: true,
    projectRestored: true,
  });
}

async function runMobile(page) {
  await page.goto(`${baseUrl}/settings/local-ai`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("local-ai-setup").waitFor({
    state: "visible",
    timeout: 60_000,
  });
  await assertNoHorizontalOverflow(page, "mobile setup");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="local-ai-setup"]')
        ?.getAttribute("data-runtime-state") !== "checking",
    undefined,
    { timeout: 15_000 },
  ).catch(() => undefined);
  const runtimeState =
    (await page
      .getByTestId("local-ai-setup")
      .getAttribute("data-runtime-state")) || "checking";
  assert.ok(
    !["ready_standard", "ready_heavy"].includes(runtimeState),
    `mobile context falsely claimed a paired runtime: ${runtimeState}`,
  );
  record("mobile setup reports runtime truth without inherited pairing", {
    runtimeState,
  });

  const offline = await offlineStatus(page);
  assert.equal(offline?.controlled, true);
  assert.match(offline?.appCommit || "", /^[0-9a-f]{40}$/i);
  assert.match(offline?.assetManifestDigest || "", /^[0-9a-f]{64}$/i);
  record("mobile Service Worker release identity is available", {
    controlled: true,
  });

  const projectId = await createProject(page, "Closed AI R2 Mobile E2E");
  await assertNoHorizontalOverflow(page, "mobile Studio");
  await page.goto(
    `${baseUrl}/studio/project/${encodeURIComponent(projectId)}/closed-ai`,
    { waitUntil: "domcontentloaded" },
  );
  await page.getByTestId("closed-ai-workspace").waitFor({
    state: "visible",
    timeout: 60_000,
  });
  await page.getByTestId("closed-ai-context-inventory").waitFor({
    state: "visible",
    timeout: 60_000,
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="closed-ai-context-inventory"]')
        ?.getAttribute("data-project-ready") === "true",
    undefined,
    { timeout: 60_000 },
  );
  await page.getByTestId("closed-ai-task-type").selectOption("story.summary");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="closed-ai-execution-readiness"]')
        ?.getAttribute("data-ready") === "true",
    undefined,
    { timeout: 60_000 },
  );
  await page
    .getByTestId("closed-ai-objective")
    .fill("摘要目前已核准章節資料；如果沒有內容，清楚列出缺少的資料。");
  await page.getByTestId("closed-ai-run").click();
  await openCandidateProof(page);
  await assertCandidateBoundary(page, "browser-ai");
  assert.match(
    (
      await page.getByTestId("closed-ai-model-id").textContent()
    )?.trim() || "",
    /^novel-browser-task-runtime-v\d+$/i,
  );
  record("mobile packaged Browser AI executes only a light task", {
    taskType: "story.summary",
    actualExecutor: "browser-ai",
  });
  await assertNoHorizontalOverflow(page, "mobile Closed AI workspace");

  const touchTarget = await page.getByTestId("closed-ai-run").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  assert.ok(touchTarget.height >= 40, JSON.stringify(touchTarget));
  record("mobile primary action has a usable touch target", touchTarget);
}

async function main() {
  await startServerIfNeeded();
  browser = await launchChromium();
  const context = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    serviceWorkers: "allow",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    consoleErrors.push(message.text().replace(/\s+/g, " ").slice(0, 1_000));
  });

  if (mobile) await runMobile(page);
  else await runDesktop(page);

  assert.deepEqual(pageErrors, []);
  record("browser runtime has no uncaught page errors", {
    count: pageErrors.length,
  });
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(
    evidencePath,
    `${JSON.stringify(
      {
        schemaVersion: "closed-ai-runtime-r2-browser-e2e-v1",
        mode,
        status: "PASS",
        passCount: records.length,
        failCount: 0,
        blockingSkipCount: 0,
        baseUrl,
        pairingCodePersisted: false,
        consoleErrorCount: consoleErrors.length,
        records,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  process.stdout.write(
    `${JSON.stringify({
      mode,
      status: "PASS",
      passCount: records.length,
      failCount: 0,
      blockingSkipCount: 0,
      evidencePath,
    })}\n`,
  );
}

try {
  await main();
} catch (error) {
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(
    evidencePath,
    `${JSON.stringify(
      {
        schemaVersion: "closed-ai-runtime-r2-browser-e2e-v1",
        mode,
        status: "FAIL",
        passCount: records.length,
        failCount: 1,
        blockingSkipCount: 0,
        baseUrl,
        pairingCodePersisted: false,
        error:
          error instanceof Error ? error.message : "UNKNOWN_BROWSER_E2E_ERROR",
        consoleErrors: consoleErrors.slice(-5),
        records,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  process.stderr.write(
    `${JSON.stringify({
      mode,
      status: "FAIL",
      passCount: records.length,
      failCount: 1,
      error: error instanceof Error ? error.message : String(error),
      evidencePath,
    })}\n`,
  );
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) server.kill();
}

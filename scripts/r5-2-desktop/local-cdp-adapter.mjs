import { chromium } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PLAYWRIGHT_VERSION = require("@playwright/test/package.json").version;

export const FORBIDDEN_BROWSER_ARGS = [
  "--disable-web-security",
  "--allow-running-insecure-content",
  "--disable-features=localnetworkaccesschecks",
  "--disable-features=privatenetworkaccess",
  "--disable-features=blockinsecureprivatenetworkrequests",
  "--ignore-certificate-errors",
  "--no-sandbox",
  "--disable-site-isolation-trials",
  "--disable-popup-blocking",
];

const BROWSERS = {
  chrome: {
    channel: "chrome",
    executable: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    productPattern: /^Chrome\//,
  },
  edge: {
    channel: "msedge",
    executable: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    productPattern: /^Edg\//,
  },
};

export function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith("--") ? argv[++index] : true;
  }
  return parsed;
}

export function assertSafeBrowserArgs(args) {
  const normalized = args.map((value) => String(value).toLowerCase());
  const forbidden = normalized.filter((value) =>
    FORBIDDEN_BROWSER_ARGS.some((entry) => value === entry || value.startsWith(`${entry}=`)),
  );
  if (forbidden.length) {
    const error = new Error(`Forbidden browser arguments: ${forbidden.join(", ")}`);
    error.code = "FORBIDDEN_BROWSER_ARGUMENT";
    throw error;
  }
  return true;
}

export function validateProfilePath(profilePath, browser) {
  const resolved = path.resolve(profilePath);
  const lowered = resolved.toLowerCase();
  const defaultFragments = browser === "chrome"
    ? ["google\\chrome\\user data", "google/chrome/user data"]
    : ["microsoft\\edge\\user data", "microsoft/edge/user data"];
  if (defaultFragments.some((fragment) => lowered.includes(fragment))) {
    const error = new Error("Daily browser profile is prohibited.");
    error.code = "DEFAULT_PROFILE_REJECTED";
    throw error;
  }
  return resolved;
}

export function validateIdentity(browser, evidence) {
  const expected = BROWSERS[browser];
  const product = String(evidence.cdpProduct || "");
  const executable = path.basename(String(evidence.executablePath || "")).toLowerCase();
  const expectedExecutable = browser === "chrome" ? "chrome.exe" : "msedge.exe";
  if (!expected.productPattern.test(product) || executable !== expectedExecutable) {
    const error = new Error(`Browser identity mismatch: ${product} / ${executable}`);
    error.code = "BROWSER_IDENTITY_MISMATCH";
    throw error;
  }
  return true;
}

export async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error("Unable to reserve loopback debugging port.");
  return port;
}

async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function listFiles(root, prefix = "") {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, relative));
    else files.push(relative);
  }
  return files;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readBrowserProcesses(profilePath) {
  const escaped = profilePath.replaceAll("'", "''");
  const command = `$p='${escaped}'; @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('chrome.exe','msedge.exe') -and $_.CommandLine -and $_.CommandLine.IndexOf($p,[StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; parentPid=$_.ParentProcessId; executablePath=$_.ExecutablePath; commandLine=$_.CommandLine; sessionId=(Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).SessionId } }) | ConvertTo-Json -Depth 4`;
  try {
    const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" }).trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch { return []; }
}

async function waitForCdp(port, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return await response.json();
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const error = new Error(`CDP port ${port} did not become ready: ${lastError?.message || "timeout"}`);
  error.code = "CDP_PORT_NOT_READY";
  throw error;
}

async function waitForOperator(browser, flow, origin) {
  output.write(`\nWAITING_FOR_HUMAN_LNA_DECISION\nBrowser: ${browser}\nFlow: ${flow}\nPreview origin: ${origin}\nBridge endpoint: http://127.0.0.1:3217\nType CONTINUE after completing the native browser prompt: `);
  const reader = createInterface({ input, output });
  const timeout = new Promise((resolve) => setTimeout(() => resolve("__TIMEOUT__"), 120_000));
  const answer = await Promise.race([reader.question(""), timeout]);
  reader.close();
  if (String(answer).trim() !== "CONTINUE") {
    const error = new Error(answer === "__TIMEOUT__" ? "Operator timed out." : "Operator did not enter CONTINUE.");
    error.code = "ABORTED_BY_OPERATOR";
    throw error;
  }
  return new Date().toISOString();
}

async function launchChannel(browser, profilePath, harPath) {
  const definition = BROWSERS[browser];
  const startedAt = new Date().toISOString();
  try {
    const context = await chromium.launchPersistentContext(profilePath, {
      channel: definition.channel,
      headless: false,
      args: ["--no-first-run", "--no-default-browser-check"],
      ignoreDefaultArgs: ["--disable-popup-blocking"],
      recordHar: { path: harPath, mode: "full", content: "omit" },
    });
    return { ok: true, adapter: "playwright-channel", startedAt, context, browserProcess: null, cdpVersion: null, debugPort: null };
  } catch (error) {
    return {
      ok: false,
      adapter: "playwright-channel",
      startedAt,
      completedAt: new Date().toISOString(),
      browser,
      binaryPath: definition.executable,
      playwrightVersion: PLAYWRIGHT_VERSION,
      channel: definition.channel,
      profilePath,
      processTree: readBrowserProcesses(profilePath),
      windowsSessionId: process.env.SESSIONNAME || null,
      stdout: null,
      stderr: null,
      exitCode: null,
      error: { code: classifyChannelError(error), type: error?.constructor?.name, message: error.message, stack: error.stack },
    };
  }
}

export function classifyChannelError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("executable") || message.includes("not found")) return "CHANNEL_BINARY_NOT_FOUND";
  if (message.includes("profile") || message.includes("singletonlock")) return "CHANNEL_PROFILE_LOCKED";
  if (message.includes("closed") || message.includes("exited")) return "CHANNEL_PROCESS_EXITED";
  if (message.includes("policy")) return "CHANNEL_POLICY_BLOCKED";
  if (message.includes("session")) return "CHANNEL_SESSION_MISMATCH";
  return "CHANNEL_UNKNOWN_FAILURE";
}

async function launchCdp(browser, profilePath, targetUrl) {
  const definition = BROWSERS[browser];
  const port = await reserveLoopbackPort();
  const args = [
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profilePath}`,
    "--no-first-run",
    "--no-default-browser-check",
    targetUrl,
  ];
  assertSafeBrowserArgs(args);
  const child = spawn(definition.executable, args, { windowsHide: false, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  try {
    const cdpVersion = await waitForCdp(port);
    const browserConnection = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browserConnection.contexts()[0];
    if (!context) throw Object.assign(new Error("CDP default context missing."), { code: "CDP_ATTACH_FAILED" });
    return {
      ok: true,
      adapter: "local-cdp",
      startedAt: new Date().toISOString(),
      context,
      browserConnection,
      browserProcess: child,
      cdpVersion,
      debugPort: port,
      commandLine: [definition.executable, ...args].join(" "),
      stdout: () => stdout,
      stderr: () => stderr,
    };
  } catch (error) {
    if (!child.killed) child.kill();
    throw Object.assign(error, { stdout, stderr, debugPort: port });
  }
}

async function closeLaunch(launch) {
  try { await launch.context?.close(); } catch { }
  try { await launch.browserConnection?.close(); } catch { }
  if (launch.browserProcess && !launch.browserProcess.killed) launch.browserProcess.kill();
  if (launch.debugPort) {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      try { await fetch(`http://127.0.0.1:${launch.debugPort}/json/version`); }
      catch { return true; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }
  return true;
}

async function createManifest(runDirectory, runId) {
  const files = (await listFiles(runDirectory)).filter((file) => file !== "sha256-manifest.json");
  const records = [];
  for (const relative of files) {
    records.push({ file: relative.replaceAll("\\", "/"), sha256: await sha256File(path.join(runDirectory, relative)) });
  }
  await writeJson(path.join(runDirectory, "sha256-manifest.json"), { run_id: runId, createdAt: new Date().toISOString(), files: records });
  return records;
}

export async function runBrowserFlow(options) {
  const browser = options.browser;
  const flow = options.flow;
  const definition = BROWSERS[browser];
  if (!definition || !["grant", "deny"].includes(flow)) throw new Error("browser and flow are required.");
  const runId = options.runId || `${browser}-${flow}-${randomUUID()}`;
  const origin = new URL(options.targetUrl).origin;
  const profilePath = validateProfilePath(options.profilePath, browser);
  const runDirectory = path.resolve(options.artifactDirectory, "runs", runId);
  await rm(profilePath, { recursive: true, force: true });
  await mkdir(profilePath, { recursive: true });
  await mkdir(runDirectory, { recursive: true });
  const initialEntries = await readdir(profilePath);
  if (initialEntries.length) throw Object.assign(new Error("Fresh profile is not empty."), { code: "PROFILE_NOT_FRESH" });

  const consoleRows = [];
  const networkRows = [];
  const result = { run_id: runId, browser, flow, origin, profilePath, status: "RUNNING", startedAt: new Date().toISOString() };
  let launch = null;
  try {
    const channelResult = await launchChannel(browser, profilePath, path.join(runDirectory, "network.har"));
    await writeJson(path.join(runDirectory, "channel-result.json"), { ...channelResult, context: undefined });
    launch = channelResult.ok ? channelResult : await launchCdp(browser, profilePath, options.targetUrl);
    result.adapter = launch.adapter;
    result.channelFailure = channelResult.ok ? null : channelResult.error;
    result.debugPort = launch.debugPort;
    result.commandLine = launch.commandLine || "Playwright channel; inspect process evidence.";
    assertSafeBrowserArgs(result.commandLine.split(/\s+/));

    await launch.context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    const pages = launch.context.pages();
    const page = pages[0] || await launch.context.newPage();
    page.on("console", (message) => consoleRows.push({ run_id: runId, at: new Date().toISOString(), type: message.type(), text: message.text() }));
    page.on("request", (request) => networkRows.push({ run_id: runId, at: new Date().toISOString(), phase: "request", method: request.method(), url: request.url(), resourceType: request.resourceType() }));
    page.on("response", (response) => networkRows.push({ run_id: runId, at: new Date().toISOString(), phase: "response", status: response.status(), url: response.url() }));

    await page.goto(options.targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    const runtimeOrigin = await page.evaluate(() => window.location.origin);
    const title = await page.title();
    const bodyText = await page.locator("body").innerText();
    const cdpSession = await launch.context.newCDPSession(page);
    const cdpBrowserVersion = await cdpSession.send("Browser.getVersion");
    const processEvidence = readBrowserProcesses(profilePath);
    const primaryProcess = processEvidence.find((row) => path.basename(String(row.executablePath || "")).toLowerCase() === path.basename(definition.executable).toLowerCase());
    const identity = {
      executablePath: primaryProcess?.executablePath || definition.executable,
      fileProduct: browser === "chrome" ? "Google Chrome" : "Microsoft Edge",
      fileVersion: options.browserVersion,
      runtimeUserAgent: cdpBrowserVersion.userAgent,
      cdpProduct: cdpBrowserVersion.product,
      cdpProtocolVersion: cdpBrowserVersion.protocolVersion,
      playwrightVersion: await launch.context.browser()?.version(),
      processEvidence,
    };
    validateIdentity(browser, identity);
    result.identity = identity;
    result.preview = { title, url: page.url(), runtimeOrigin, renderedOriginPresent: bodyText.includes(origin) };
    await page.screenshot({ path: path.join(runDirectory, "visible-window.png"), fullPage: true });

    const detectButton = page.getByRole("button", { name: /重新檢查|檢查本機|偵測|連線/ }).first();
    if (await detectButton.count() === 0) throw Object.assign(new Error("Bridge detection button not found."), { code: "PREVIEW_BRIDGE_BUTTON_NOT_FOUND" });
    result.uiClickAt = new Date().toISOString();
    await detectButton.click();
    result.operatorDecisionAt = await waitForOperator(browser, flow, origin);
    await page.waitForTimeout(2_000);
    result.uiTextAfterDecision = (await page.locator("body").innerText()).slice(0, 4_000);
    result.status = "COMPLETED_FOR_REVIEW";
    result.completedAt = new Date().toISOString();
    await launch.context.tracing.stop({ path: path.join(runDirectory, "browser-trace.zip") });
    await writeJson(path.join(runDirectory, "console.json"), { run_id: runId, rows: consoleRows });
    await writeJson(path.join(runDirectory, "network.json"), { run_id: runId, rows: networkRows });
    if (launch.adapter === "local-cdp") {
      await writeJson(path.join(runDirectory, "network.har"), { log: { version: "1.2", creator: { name: "r5-2r1a-local-cdp-adapter", version: "1" }, entries: networkRows } });
    }
    await writeJson(path.join(runDirectory, "final-result.json"), result);
    return result;
  } catch (error) {
    result.status = error.code === "ABORTED_BY_OPERATOR" ? "ABORTED_BY_OPERATOR" : "FAILED";
    result.error = { code: error.code || "BROWSER_FLOW_FAILED", type: error?.constructor?.name, message: error.message, stack: error.stack };
    result.completedAt = new Date().toISOString();
    await writeJson(path.join(runDirectory, "console.json"), { run_id: runId, rows: consoleRows });
    await writeJson(path.join(runDirectory, "network.json"), { run_id: runId, rows: networkRows });
    if (launch?.adapter === "local-cdp") {
      await writeJson(path.join(runDirectory, "network.har"), { log: { version: "1.2", creator: { name: "r5-2r1a-local-cdp-adapter", version: "1" }, entries: networkRows } });
    }
    await writeJson(path.join(runDirectory, "final-result.json"), result);
    throw error;
  } finally {
    const debugPortReleased = launch ? await closeLaunch(launch) : true;
    await writeJson(path.join(runDirectory, "cleanup.json"), { run_id: runId, debugPort: launch?.debugPort || null, debugPortReleased, completedAt: new Date().toISOString() });
    await createManifest(runDirectory, runId);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ["browser", "flow", "target-url", "profile", "artifacts", "browser-version"];
  for (const key of required) if (!args[key]) throw new Error(`Missing --${key}`);
  const result = await runBrowserFlow({
    browser: args.browser,
    flow: args.flow,
    targetUrl: args["target-url"],
    profilePath: args.profile,
    artifactDirectory: args.artifacts,
    browserVersion: args["browser-version"],
    runId: args["run-id"],
  });
  output.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    output.write(`${JSON.stringify({ ok: false, errorCode: error.code || "LOCAL_CDP_ADAPTER_FAILED", message: error.message }, null, 2)}\n`);
    process.exitCode = 1;
  });
}

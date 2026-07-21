import { chromium } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { PassThrough } from "node:stream";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { BRIDGE_PROTOCOL } from "../../local-ai/bridge/bridge-core.mjs";
import {
  BROWSER_LIVENESS_FAILURE_CODES,
  validateBrowserLiveness,
} from "./browser-liveness.mjs";

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
  "--disable-setuid-sandbox",
  "--disable-site-isolation-trials",
  "--disable-popup-blocking",
  "--unsafely-disable-devtools-self-xss-warnings",
];

const FORBIDDEN_DISABLED_FEATURES = new Set([
  "localnetworkaccesschecks",
  "privatenetworkaccess",
  "blockinsecureprivatenetworkrequests",
]);

export function findForbiddenBrowserArguments(commandLineOrArgs) {
  const source = Array.isArray(commandLineOrArgs)
    ? commandLineOrArgs.map((value) => String(value)).join(" ")
    : String(commandLineOrArgs || "");
  const lowered = source.toLowerCase();
  const found = new Set();
  for (const argument of FORBIDDEN_BROWSER_ARGS) {
    if (argument.startsWith("--disable-features=")) continue;
    const escaped = argument.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|[\\s\"])(?:${escaped})(?=$|[\\s\"])`, "i").test(lowered)) found.add(argument);
  }
  for (const match of lowered.matchAll(/--disable-features=(?:"([^"]*)"|([^\s"]*))/g)) {
    const features = String(match[1] || match[2] || "").split(",").map((value) => value.trim());
    for (const feature of features) {
      if (FORBIDDEN_DISABLED_FEATURES.has(feature)) found.add(`--disable-features=${feature}`);
    }
  }
  return [...found];
}

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
  const forbidden = findForbiddenBrowserArguments(args);
  if (forbidden.length) {
    const error = new Error(`Forbidden browser arguments: ${forbidden.join(", ")}`);
    error.code = "FORBIDDEN_BROWSER_ARGUMENT";
    throw error;
  }
  return true;
}

export function auditActualBrowserCommandLine(processEvidence) {
  const rows = (processEvidence || []).map((row) => ({
    pid: row.pid,
    parentPid: row.parentPid,
    executablePath: row.executablePath,
    commandLine: row.commandLine,
    forbiddenArguments: findForbiddenBrowserArguments(row.commandLine),
  }));
  const forbiddenArguments = [...new Set(rows.flatMap((row) => row.forbiddenArguments))];
  const audit = {
    checkedAt: new Date().toISOString(),
    processCount: rows.length,
    forbiddenArgumentCount: forbiddenArguments.length,
    forbiddenArguments,
    rows,
    status: forbiddenArguments.length ? "FAIL" : "PASS",
  };
  if (!rows.length) {
    const error = new Error("No browser process command line was available for security verification.");
    error.code = "BROWSER_COMMAND_LINE_UNAVAILABLE";
    error.securityAudit = { ...audit, status: "FAIL" };
    throw error;
  }
  if (forbiddenArguments.length) {
    const error = new Error(`Browser process contains forbidden security arguments: ${forbiddenArguments.join(", ")}`);
    error.code = "BROWSER_SECURITY_ARGUMENT_DETECTED";
    error.securityAudit = audit;
    throw error;
  }
  return audit;
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

function captureDesktop(filePath) {
  const escaped = filePath.replaceAll("'", "''");
  const command = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $bounds=[System.Windows.Forms.SystemInformation]::VirtualScreen; $bitmap=New-Object System.Drawing.Bitmap $bounds.Width,$bounds.Height; $graphics=[System.Drawing.Graphics]::FromImage($bitmap); try { $graphics.CopyFromScreen($bounds.Left,$bounds.Top,0,0,$bounds.Size); $bitmap.Save('${escaped}',[System.Drawing.Imaging.ImageFormat]::Png) } finally { $graphics.Dispose(); $bitmap.Dispose() }`;
  execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" });
}

async function queryLocalNetworkPermissionStates(page) {
  return page.evaluate(async () => {
    const states = {};
    for (const name of ["loopback-network", "local-network", "local-network-access"]) {
      try { states[name] = (await navigator.permissions.query({ name })).state; }
      catch { states[name] = "unsupported"; }
    }
    return states;
  });
}

export function readBrowserProcesses(profilePath) {
  const escaped = profilePath.replaceAll("'", "''");
  const command = `$p='${escaped}'; @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('chrome.exe','msedge.exe') -and $_.CommandLine -and $_.CommandLine.IndexOf($p,[StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object { $process=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; $owner=Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue; [pscustomobject]@{ pid=$_.ProcessId; parentPid=$_.ParentProcessId; executablePath=$_.ExecutablePath; commandLine=$_.CommandLine; sessionId=$process.SessionId; mainWindowHandle=[int64]$process.MainWindowHandle; userName=if($owner -and $owner.User){\"$($owner.Domain)\\$($owner.User)\"}else{$null} } }) | ConvertTo-Json -Depth 4`;
  try {
    const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" }).trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch { return []; }
}

function processAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try { process.kill(Number(pid), 0); return true; }
  catch { return false; }
}

function primaryBrowserProcess(rows, browser, expectedPid) {
  const executable = browser === "chrome" ? "chrome.exe" : "msedge.exe";
  if (expectedPid) return rows.find((row) => row.pid === expectedPid) || null;
  return rows.find((row) => path.basename(String(row.executablePath || "")).toLowerCase() === executable
    && !/(?:^|\s)--type=/.test(String(row.commandLine || ""))) || null;
}

async function probeBridge(origin) {
  try {
    const response = await fetch("http://127.0.0.1:3217/health", {
      headers: { Origin: origin, "X-Bridge-Protocol": BRIDGE_PROTOCOL },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return { alive: false, loopbackOnly: false, originEnrolled: false, status: response.status };
    const body = await response.json();
    return {
      alive: body.bridgeProcessAlive === true,
      loopbackOnly: body.bindAddress === "127.0.0.1" || body.bindAddress === "::1",
      originEnrolled: Array.isArray(body.configuredOrigins) && body.configuredOrigins.includes(origin),
      configuredOrigins: body.configuredOrigins || [],
      instanceId: body.instanceId || null,
    };
  } catch (error) {
    return { alive: false, loopbackOnly: false, originEnrolled: false, error: error.message };
  }
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

export function createOperatorChallenges() {
  return {
    operatorChallenge: randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase(),
    decisionChallenge: randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase(),
  };
}

export function parseOperatorCommand(answer, challenges) {
  const normalized = String(answer || "").trim().toUpperCase();
  if (normalized === `CONTINUE ${challenges.decisionChallenge}`) return "CONTINUE";
  if (normalized === `ABORT ${challenges.operatorChallenge}`) return "ABORT";
  return "INVALID";
}

export async function waitForOperator(browser, flow, origin, runId, options = {}) {
  const inputStream = options.inputStream || input;
  const outputStream = options.outputStream || output;
  const automatedNativeUi = options.automationMode === "windows-ui-automation";
  if (!options.testMode && !automatedNativeUi && (!inputStream.isTTY || !outputStream.isTTY)) {
    const error = new Error("An interactive operator terminal is required.");
    error.code = "ABORTED_OPERATOR_UNAVAILABLE";
    throw error;
  }
  const challenges = options.challenges || createOperatorChallenges();
  const startedAt = Date.now();
  let latestLiveness = options.initialLiveness || null;
  let lastLivenessError = null;
  let monitoring = true;
  let checkInFlight = false;
  let rejectLiveness;
  const livenessFailure = new Promise((_, reject) => { rejectLiveness = reject; });
  void livenessFailure.catch(() => undefined);
  const checkLiveness = async (force = false) => {
    if (lastLivenessError) throw lastLivenessError;
    if (!options.livenessProbe || (!monitoring && !force) || checkInFlight) return latestLiveness;
    checkInFlight = true;
    try {
      latestLiveness = validateBrowserLiveness(await options.livenessProbe(), options.expectedLiveness);
      await options.onHeartbeat?.(latestLiveness);
      return latestLiveness;
    } catch (error) {
      lastLivenessError = error;
      monitoring = false;
      await options.onHeartbeat?.({ status: "FAILED", checkedAt: new Date().toISOString(), errorCode: error.code, ...error.livenessState });
      rejectLiveness(error);
      throw error;
    } finally {
      checkInFlight = false;
    }
  };
  if (options.livenessProbe) await checkLiveness();
  const renderHeartbeat = () => {
    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    const hours = String(Math.floor(elapsedSeconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, "0");
    const seconds = String(elapsedSeconds % 60).padStart(2, "0");
    outputStream.write(`\nWAITING_FOR_OPERATOR\nBrowser: ${browser}\nFlow: ${flow}\nRun ID: ${runId}\nElapsed: ${hours}:${minutes}:${seconds}\nHarness PID: ${latestLiveness?.harnessPid ?? "UNKNOWN"}\nBrowser PID: ${latestLiveness?.browserPid ?? "MISSING"}\nBrowser alive: ${latestLiveness?.browserProcessAlive ?? "UNKNOWN"}\nCDP responsive: ${latestLiveness?.controlChannelResponsive ?? "UNKNOWN"}\nPreview page open: ${latestLiveness?.previewPageOpen ?? "UNKNOWN"}\nVisible window present: ${latestLiveness?.visibleWindowPresent ?? "UNKNOWN"}\nBridge alive: ${latestLiveness?.bridgeProcessAlive ?? "UNKNOWN"}\nOrigin enrolled: ${latestLiveness?.originEnrolled ?? "UNKNOWN"}\nOperator challenge: ${challenges.operatorChallenge}\nDecision challenge: ${challenges.decisionChallenge}\nEnter CONTINUE ${challenges.decisionChallenge} after the native decision, or ABORT ${challenges.operatorChallenge} to stop safely.\n> `);
  };
  renderHeartbeat();
  const heartbeat = setInterval(() => {
    void checkLiveness().then(renderHeartbeat).catch(() => undefined);
  }, options.heartbeatMs || 30_000);
  const reader = createInterface({ input: inputStream, output: outputStream });
  try {
    while (true) {
      let answer;
      try {
        const question = reader.question("");
        void question.catch(() => undefined);
        answer = await Promise.race([question, livenessFailure]);
      }
      catch (cause) {
        if (BROWSER_LIVENESS_FAILURE_CODES.includes(cause.code)) throw cause;
        const error = new Error("Operator terminal became unavailable.", { cause });
        error.code = "ABORTED_OPERATOR_UNAVAILABLE";
        throw error;
      }
      const command = parseOperatorCommand(answer, challenges);
      if (command === "CONTINUE") {
        try {
          if (options.livenessProbe) await checkLiveness(true);
        } catch (cause) {
          const error = new Error("Operator CONTINUE was rejected because browser state is stale.", { cause });
          error.code = "OPERATOR_CONTINUE_REJECTED_STALE_BROWSER_STATE";
          error.livenessFailureCode = cause.code;
          error.livenessState = cause.livenessState;
          error.reusableForAcceptance = false;
          throw error;
        }
        return { decidedAt: new Date().toISOString(), latestLiveness, ...challenges };
      }
      if (command === "ABORT") {
        const error = new Error("Operator aborted the run.");
        error.code = "ABORTED_BY_OPERATOR";
        error.operatorChallenges = challenges;
        throw error;
      }
      outputStream.write(`Invalid operator response. Enter CONTINUE ${challenges.decisionChallenge} or ABORT ${challenges.operatorChallenge}.\n> `);
    }
  } finally {
    monitoring = false;
    clearInterval(heartbeat);
    reader.close();
  }
}

async function launchChannel(browser, profilePath, harPath) {
  const definition = BROWSERS[browser];
  const startedAt = new Date().toISOString();
  try {
    const context = await chromium.launchPersistentContext(profilePath, {
      channel: definition.channel,
      headless: false,
      chromiumSandbox: true,
      args: ["--no-first-run", "--no-default-browser-check"],
      ignoreDefaultArgs: [
        "--disable-popup-blocking",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--unsafely-disable-devtools-self-xss-warnings",
      ],
      recordHar: { path: harPath, mode: "full", content: "omit" },
    });
    return { ok: true, adapter: "playwright-channel", startedAt, context, browserProcess: null, cdpVersion: null, debugPort: null, sandboxEnabled: true };
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
      sandboxEnabled: true,
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

export async function runSandboxSmoke(options) {
  const browser = options.browser;
  const definition = BROWSERS[browser];
  if (!definition) throw new Error(`Unsupported browser: ${browser}`);
  const profilePath = validateProfilePath(options.profilePath, browser);
  const artifactDirectory = path.resolve(options.artifactDirectory);
  await rm(profilePath, { recursive: true, force: true });
  await mkdir(profilePath, { recursive: true });
  await mkdir(artifactDirectory, { recursive: true });
  let launch = null;
  const result = {
    browser,
    profilePath,
    targetUrl: "about:blank",
    status: "RUNNING",
    startedAt: new Date().toISOString(),
  };
  try {
    const channelResult = await launchChannel(browser, profilePath, path.join(artifactDirectory, `${browser}-sandbox-smoke.har`));
    launch = channelResult.ok ? channelResult : await launchCdp(browser, profilePath, "about:blank");
    await new Promise((resolve) => setTimeout(resolve, 250));
    const processEvidence = readBrowserProcesses(profilePath);
    const securityAudit = auditActualBrowserCommandLine(processEvidence);
    const page = launch.context.pages()[0] || await launch.context.newPage();
    await page.goto("about:blank");
    const cdpSession = await launch.context.newCDPSession(page);
    const version = await cdpSession.send("Browser.getVersion");
    const primaryProcess = primaryBrowserProcess(processEvidence, browser);
    if (!primaryProcess) throw Object.assign(new Error("Primary browser process was not found."), { code: "BROWSER_PROCESS_LOST_DURING_OPERATOR_WAIT" });
    const identity = {
      executablePath: primaryProcess?.executablePath || definition.executable,
      cdpProduct: version.product,
    };
    validateIdentity(browser, identity);
    result.status = "PASS";
    result.adapter = launch.adapter;
    result.sandboxEnabled = launch.sandboxEnabled === true;
    result.actualCommandLineVerified = securityAudit.status === "PASS";
    result.securityAudit = securityAudit;
    result.identity = identity;
    result.visibleHeadedWindow = true;
    result.freshProfile = true;
    result.completedAt = new Date().toISOString();
    return result;
  } catch (error) {
    result.status = "FAIL";
    result.error = { code: error.code || "SANDBOX_SMOKE_FAILED", message: error.message };
    if (error.securityAudit) result.securityAudit = error.securityAudit;
    result.completedAt = new Date().toISOString();
    throw Object.assign(error, { smokeResult: result });
  } finally {
    result.debugPortReleased = launch ? await closeLaunch(launch) : true;
  }
}

export async function runBrowserLossSmoke(options) {
  const browser = options.browser;
  const definition = BROWSERS[browser];
  if (!definition) throw new Error(`Unsupported browser: ${browser}`);
  const profilePath = validateProfilePath(options.profilePath, browser);
  const artifactDirectory = path.resolve(options.artifactDirectory);
  await rm(profilePath, { recursive: true, force: true });
  await mkdir(profilePath, { recursive: true });
  await mkdir(artifactDirectory, { recursive: true });
  let launch = null;
  let debugPortReleased = true;
  const result = { browser, status: "RUNNING", profilePath, startedAt: new Date().toISOString() };
  try {
    const channelResult = await launchChannel(browser, profilePath, path.join(artifactDirectory, `${browser}-browser-loss.har`));
    launch = channelResult.ok ? channelResult : await launchCdp(browser, profilePath, "about:blank");
    const page = launch.context.pages()[0] || await launch.context.newPage();
    await page.goto("about:blank");
    await new Promise((resolve) => setTimeout(resolve, 250));
    const initialRows = readBrowserProcesses(profilePath);
    const primary = primaryBrowserProcess(initialRows, browser);
    if (!primary) throw Object.assign(new Error("Primary browser process missing before smoke."), { code: "BROWSER_COMMAND_LINE_UNAVAILABLE" });
    const securityAudit = auditActualBrowserCommandLine(initialRows);
    const cdpSession = await launch.context.newCDPSession(page);
    const version = await cdpSession.send("Browser.getVersion");
    validateIdentity(browser, { executablePath: primary.executablePath, cdpProduct: version.product });
    const expected = { browserPid: primary.pid, profilePath, previewUrl: "about:blank", origin: "https://preview.example" };
    const probe = async () => {
      const rows = readBrowserProcesses(profilePath);
      const current = primaryBrowserProcess(rows, browser, primary.pid);
      let controlResponsive = true;
      try { await cdpSession.send("Browser.getVersion"); } catch { controlResponsive = false; }
      return {
        harnessPid: process.pid,
        harnessProcessAlive: true,
        browserPid: current?.pid || null,
        browserProcessAlive: Boolean(current),
        executableIdentityMatches: Boolean(current),
        sessionMatches: Boolean(current) && current.sessionId === primary.sessionId,
        userMatches: Boolean(current?.userName) && current.userName === primary.userName,
        profilePath,
        profileMatches: Boolean(current) && String(current.commandLine || "").toLowerCase().includes(profilePath.toLowerCase()),
        commandLineCompliant: current ? findForbiddenBrowserArguments(rows.map((row) => row.commandLine)).length === 0 : false,
        controlChannelResponsive: controlResponsive,
        cdpIdentityMatches: controlResponsive,
        browserContextConnected: controlResponsive,
        previewPageOpen: !page.isClosed(),
        previewUrl: page.isClosed() ? null : page.url(),
        previewUrlExact: !page.isClosed() && page.url() === "about:blank",
        visibleWindowPresent: rows.some((row) => Number(row.mainWindowHandle) > 0),
        bridgeProcessAlive: true,
        bridgeLoopbackOnly: true,
        originEnrolled: true,
        enrolledOrigin: expected.origin,
      };
    };
    const inputStream = new PassThrough();
    const outputStream = new PassThrough();
    const waiting = waitForOperator(browser, "grant", expected.origin, `${browser}-browser-loss`, {
      inputStream,
      outputStream,
      testMode: true,
      heartbeatMs: 50,
      livenessProbe: probe,
      expectedLiveness: expected,
    }).then((value) => ({ value }), (error) => ({ error }));
    await new Promise((resolve) => setTimeout(resolve, 75));
    debugPortReleased = await closeLaunch(launch);
    launch = null;
    const outcome = await waiting;
    try {
      if (outcome.error) throw outcome.error;
      throw new Error("WAITING_STATE_SURVIVES_BROWSER_LOSS");
    } catch (error) {
      if (error.code !== "BROWSER_PROCESS_LOST_DURING_OPERATOR_WAIT") throw error;
      result.status = "PASS";
      result.failureStatus = "NOT_TESTED";
      result.failureCode = error.code;
      result.reusableForAcceptance = false;
      result.securityAudit = securityAudit;
      result.debugPortReleased = debugPortReleased;
      result.completedAt = new Date().toISOString();
      return result;
    }
  } finally {
    result.debugPortReleased = launch ? await closeLaunch(launch) : debugPortReleased;
  }
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
  const result = {
    run_id: runId,
    browser,
    flow,
    origin,
    profilePath,
    status: "RUNNING",
    startedAt: new Date().toISOString(),
    automationMode: options["automated-native-ui"] || null,
  };
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
    await new Promise((resolve) => setTimeout(resolve, 250));
    const processEvidence = readBrowserProcesses(profilePath);
    const securityAudit = auditActualBrowserCommandLine(processEvidence);
    result.securityAudit = securityAudit;
    await writeJson(path.join(runDirectory, "adapter-selection.json"), {
      run_id: runId,
      browser,
      adapter_attempted: channelResult.ok ? ["playwright-channel"] : ["playwright-channel", "local-cdp"],
      adapter_selected: launch.adapter,
      channel_result: channelResult.ok ? "PASS" : "FAIL",
      channel_error: channelResult.ok ? null : channelResult.error,
      cdp_fallback_used: launch.adapter === "local-cdp",
      sandbox_enabled: launch.sandboxEnabled !== false,
      actual_command_line_verified: securityAudit.status === "PASS",
      forbidden_argument_count: securityAudit.forbiddenArgumentCount,
      final_status: "BROWSER_STARTED_SAFE",
    });

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
    const primaryProcess = primaryBrowserProcess(processEvidence, browser);
    if (!primaryProcess) throw Object.assign(new Error("Primary browser process was not found."), { code: "BROWSER_PROCESS_LOST_DURING_OPERATOR_WAIT" });
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
    await page.screenshot({ path: path.join(runDirectory, "preview-before.png"), fullPage: true });

    const expectedLiveness = {
      browserPid: primaryProcess.pid,
      executablePath: primaryProcess.executablePath,
      sessionId: primaryProcess.sessionId,
      userName: primaryProcess.userName,
      profilePath,
      cdpProduct: cdpBrowserVersion.product,
      previewUrl: options.targetUrl,
      origin,
    };
    const livenessProbe = async () => {
      const currentProcesses = readBrowserProcesses(profilePath);
      const currentPrimary = primaryBrowserProcess(currentProcesses, browser, expectedLiveness.browserPid);
      let currentVersion = null;
      let controlError = null;
      try { currentVersion = await cdpSession.send("Browser.getVersion"); }
      catch (error) { controlError = error.message; }
      let commandLineCompliant = false;
      let forbiddenArguments = [];
      try {
        const commandAudit = auditActualBrowserCommandLine(currentProcesses);
        commandLineCompliant = commandAudit.status === "PASS";
        forbiddenArguments = commandAudit.forbiddenArguments;
      } catch (error) {
        forbiddenArguments = error.securityAudit?.forbiddenArguments || [];
      }
      const bridge = await probeBridge(origin);
      const contextBrowser = launch.context.browser();
      return {
        harnessPid: Number(options.harnessPid || process.ppid),
        harnessProcessAlive: processAlive(Number(options.harnessPid || process.ppid)),
        browserPid: currentPrimary?.pid || null,
        browserProcessAlive: Boolean(currentPrimary),
        executableIdentityMatches: Boolean(currentPrimary)
          && path.resolve(String(currentPrimary.executablePath || "")).toLowerCase() === path.resolve(String(expectedLiveness.executablePath || "")).toLowerCase(),
        sessionMatches: Boolean(currentPrimary) && currentPrimary.sessionId === expectedLiveness.sessionId,
        userMatches: Boolean(currentPrimary?.userName) && Boolean(expectedLiveness.userName)
          && currentPrimary.userName === expectedLiveness.userName,
        profilePath,
        profileMatches: Boolean(currentPrimary) && String(currentPrimary.commandLine || "").toLowerCase().includes(profilePath.toLowerCase()),
        commandLineCompliant,
        forbiddenArguments,
        controlChannelResponsive: Boolean(currentVersion),
        controlError,
        cdpIdentityMatches: Boolean(currentVersion) && currentVersion.product === expectedLiveness.cdpProduct,
        browserContextConnected: contextBrowser ? contextBrowser.isConnected() : !page.isClosed(),
        previewPageOpen: !page.isClosed(),
        previewUrl: page.isClosed() ? null : page.url(),
        previewUrlExact: !page.isClosed() && page.url() === options.targetUrl,
        visibleWindowPresent: currentProcesses.some((row) => Number(row.mainWindowHandle) > 0),
        bridgeProcessAlive: bridge.alive,
        bridgeLoopbackOnly: bridge.loopbackOnly,
        originEnrolled: bridge.originEnrolled,
        enrolledOrigin: bridge.originEnrolled ? origin : null,
        bridgeInstanceId: bridge.instanceId || null,
      };
    };

    const detectButton = page.getByRole("button", { name: /重新檢查|檢查本機|偵測|連線/ }).first();
    if (await detectButton.count() === 0) throw Object.assign(new Error("Bridge detection button not found."), { code: "PREVIEW_BRIDGE_BUTTON_NOT_FOUND" });
    result.uiClickAt = new Date().toISOString();
    await detectButton.click();
    const operatorDecision = await waitForOperator(browser, flow, origin, runId, {
      automationMode: options["automated-native-ui"] || null,
      livenessProbe,
      expectedLiveness,
      heartbeatMs: options.heartbeatMs || 30_000,
      onHeartbeat: async (state) => {
        await writeJson(path.join(runDirectory, "heartbeat-state.json"), {
          run_id: runId,
          browser,
          flow,
          expected: expectedLiveness,
          current: state,
        });
        const promptPath = path.join(runDirectory, "lna-prompt.png");
        try { await access(promptPath); } catch { captureDesktop(promptPath); }
      },
    });
    result.operatorDecisionAt = operatorDecision.decidedAt;
    result.finalLiveness = operatorDecision.latestLiveness;
    result.operatorChallenge = operatorDecision.operatorChallenge;
    result.decisionChallenge = operatorDecision.decisionChallenge;
    await page.waitForTimeout(2_000);
    result.permissionStates = await queryLocalNetworkPermissionStates(page);
    result.uiTextAfterDecision = (await page.locator("body").innerText()).slice(0, 4_000);
    result.expectedHumanDecision = flow === "grant" ? "ALLOW" : "DENY";
    captureDesktop(path.join(runDirectory, "permission-state.png"));
    await page.screenshot({ path: path.join(runDirectory, "preview-after.png"), fullPage: true });
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
    const livenessFailure = BROWSER_LIVENESS_FAILURE_CODES.includes(error.code)
      || error.code === "OPERATOR_CONTINUE_REJECTED_STALE_BROWSER_STATE";
    result.status = livenessFailure ? "NOT_TESTED"
      : ["ABORTED_BY_OPERATOR", "ABORTED_OPERATOR_UNAVAILABLE"].includes(error.code) ? error.code : "FAILED";
    if (livenessFailure) {
      result.failure_code = error.code;
      result.native_lna_prompt = "NOT_OBSERVED";
      result.operator_decision = "NOT_PROVIDED";
      result.preview_ui_request_reached_bridge = "NOT_ESTABLISHED";
      result.reusable_for_acceptance = false;
      result.livenessState = error.livenessState || null;
      result.livenessFailureCode = error.livenessFailureCode || error.code;
    }
    if (error.securityAudit) result.securityAudit = error.securityAudit;
    if (error.operatorChallenges) result.operatorChallenges = error.operatorChallenges;
    result.error = { code: error.code || "BROWSER_FLOW_FAILED", type: error?.constructor?.name, message: error.message, stack: error.stack };
    result.completedAt = new Date().toISOString();
    try { await launch?.context?.tracing.stop({ path: path.join(runDirectory, "browser-trace.zip") }); } catch { }
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
  const required = ["browser", "flow", "target-url", "profile", "artifacts", "browser-version", "harness-pid"];
  for (const key of required) if (!args[key]) throw new Error(`Missing --${key}`);
  const result = await runBrowserFlow({
    browser: args.browser,
    flow: args.flow,
    targetUrl: args["target-url"],
    profilePath: args.profile,
    artifactDirectory: args.artifacts,
    browserVersion: args["browser-version"],
    harnessPid: Number(args["harness-pid"]),
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

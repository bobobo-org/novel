import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";

export const ARTIFACT_DIR = path.resolve(process.cwd(), "artifacts", "h2-full-closure");
export const RUNTIME_ROOT = path.resolve(process.cwd(), ".test-runtime", "h2");

export function ensureArtifactDir() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}

export function writeArtifact(name, data) {
  ensureArtifactDir();
  const file = path.join(ARTIFACT_DIR, name);
  fs.writeFileSync(file, `${JSON.stringify(redact(data), null, 2)}\n`, "utf8");
  return file;
}

export function createRunRuntime() {
  const runId = `run-${randomUUID()}`;
  const root = path.join(RUNTIME_ROOT, runId);
  for (const child of ["sqlite", "vector", "corpus", "backup", "restore", "browser", "diagnostics", "logs"]) {
    fs.mkdirSync(path.join(root, child), { recursive: true });
  }
  return { runId, root };
}

export async function cleanupRuntime(root) {
  const delays = [100, 250, 500, 1000, 2000];
  const attempts = [];
  for (const delay of [0, ...delays]) {
    if (delay) await sleep(delay);
    try {
      fs.rmSync(root, { recursive: true, force: true });
      const remaining = fs.existsSync(root) ? listFiles(root) : [];
      attempts.push({ delayMs: delay, remainingCount: remaining.length });
      if (remaining.length === 0) return { status: "PASS", attempts, cleanupRemainingCount: 0, remainingFiles: [] };
    } catch (error) {
      attempts.push({ delayMs: delay, error: String(error?.message || error) });
    }
  }
  const remainingFiles = fs.existsSync(root) ? listFiles(root) : [];
  return { status: remainingFiles.length === 0 ? "PASS" : "FAIL", attempts, cleanupRemainingCount: remainingFiles.length, remainingFiles };
}

export function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function runCommand(label, command, args = [], options = {}) {
  const started = Date.now();
  const resolved = resolveCommand(command, args);
  const child = spawnSync(resolved.command, resolved.args, {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    shell: false,
    maxBuffer: options.maxBuffer || 256 * 1024 * 1024,
    timeout: options.timeoutMs,
  });
  const stdout = child.stdout || "";
  const stderr = child.stderr || "";
  const counts = parseCounts(`${stdout}\n${stderr}`);
  const timedOut = child.error?.code === "ETIMEDOUT";
  const exitCode = timedOut ? 124 : (child.status ?? (child.error ? 1 : 0));
  return {
    label,
    command: `${command} ${args.join(" ")}`.trim(),
    exitCode,
    elapsedMs: Date.now() - started,
    pass: counts.pass + (exitCode === 0 && counts.pass === 0 ? 1 : 0),
    fail: counts.fail + (exitCode === 0 ? 0 : 1),
    skip: counts.skip,
    infrastructureBlocked: counts.infrastructureBlocked,
    status: timedOut ? "FAIL" : (exitCode === 0 && counts.fail === 0 && counts.infrastructureBlocked === 0 ? "PASS" : "FAIL"),
    errorCode: child.error?.code,
    stdoutTail: stdout.slice(-3000),
    stderrTail: stderr.slice(-3000),
  };
}

export function runCommandAsync(label, command, args = [], options = {}) {
  const started = Date.now();
  const resolved = resolveCommand(command, args);
  ensureArtifactDir();
  const logStem = `${Date.now()}-${randomUUID()}-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const stdoutFile = path.join(ARTIFACT_DIR, `${logStem}.stdout.log`);
  const stderrFile = path.join(ARTIFACT_DIR, `${logStem}.stderr.log`);
  const stdoutFd = fs.openSync(stdoutFile, "w");
  const stderrFd = fs.openSync(stderrFile, "w");
  const child = spawnSync(resolved.command, resolved.args, {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...(options.env || {}) },
    shell: false,
    windowsHide: true,
    stdio: ["ignore", stdoutFd, stderrFd],
    timeout: options.timeoutMs,
  });
  fs.closeSync(stdoutFd);
  fs.closeSync(stderrFd);
  const stdout = safeReadFile(stdoutFile);
  const stderr = `${safeReadFile(stderrFile)}${child.error?.message ? `\n${child.error.message}` : ""}`;
  const counts = parseCounts(`${stdout}\n${stderr}`);
  const timedOut = child.error?.code === "ETIMEDOUT";
  const exitCode = timedOut ? 124 : (child.status ?? (child.error ? 1 : 0));
  return Promise.resolve({
    label,
    command: `${command} ${args.join(" ")}`.trim(),
    exitCode,
    elapsedMs: Date.now() - started,
    pass: counts.pass + (exitCode === 0 && counts.pass === 0 ? 1 : 0),
    fail: counts.fail + (exitCode === 0 ? 0 : 1),
    skip: counts.skip,
    infrastructureBlocked: counts.infrastructureBlocked,
    status: timedOut ? "FAIL" : (exitCode === 0 && counts.fail === 0 && counts.infrastructureBlocked === 0 ? "PASS" : "FAIL"),
    errorCode: child.error?.code,
    stdoutFile,
    stderrFile,
    stdoutTail: stdout.slice(-3000),
    stderrTail: stderr.slice(-3000),
  });
}

function safeReadFile(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function resolveCommand(command, args) {
  if (process.platform !== "win32") return { command, args };
  if (command === "node") return { command: process.execPath, args };
  if (command === "pnpm") {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", ["pnpm", ...args].map(quoteCmdArg).join(" ")],
    };
  }
  return { command, args };
}

function quoteCmdArg(arg) {
  const text = String(arg);
  if (!/[ \t"&|<>^]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

export function parseCounts(output) {
  let pass = 0;
  let fail = 0;
  let skip = 0;
  let infrastructureBlocked = 0;

  for (const line of String(output).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^PASS\b/.test(trimmed)) pass += 1;
    if (/^FAIL\b/.test(trimmed)) fail += 1;
    if (/^SKIP\b/.test(trimmed)) skip += 1;
    if (/infrastructure_blocked/i.test(trimmed)) infrastructureBlocked += 1;
  }

  const json = extractLastJson(output);
  if (json) {
    pass = Math.max(pass, Number(json.pass ?? json.passCount ?? json.aggregatePassCount ?? 0));
    fail = Math.max(fail, Number(json.fail ?? json.failCount ?? 0));
    skip = Math.max(skip, Number(json.skip ?? json.skipCount ?? 0));
    infrastructureBlocked = Math.max(infrastructureBlocked, Number(json.infrastructureBlocked ?? json.infrastructureBlockedCount ?? 0));
  }
  pass = Math.max(pass, maxJsonNumber(output, ["pass", "passCount", "aggregatePassCount"]));
  fail = Math.max(fail, maxJsonNumber(output, ["fail", "failCount"]));
  skip = Math.max(skip, maxJsonNumber(output, ["skip", "skipCount"]));
  infrastructureBlocked = Math.max(infrastructureBlocked, maxJsonNumber(output, ["infrastructureBlocked", "infrastructureBlockedCount"]));
  return { pass, fail, skip, infrastructureBlocked };
}

function maxJsonNumber(output, keys) {
  let max = 0;
  for (const key of keys) {
    const pattern = new RegExp(`"${key}"\\s*:\\s*(\\d+)`, "g");
    for (const match of String(output || "").matchAll(pattern)) {
      max = Math.max(max, Number(match[1] || 0));
    }
  }
  return max;
}

export function extractLastJson(output) {
  const text = String(output || "");
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Some pnpm scripts print lifecycle lines before/after the JSON summary.
  }

  const starts = [
    trimmed.lastIndexOf("\n{"),
    trimmed.lastIndexOf("\r\n{"),
    trimmed.indexOf("{"),
  ].filter((i) => i >= 0);

  for (const start of [...new Set(starts)].sort((a, b) => b - a)) {
    const jsonStart = trimmed[start] === "{" ? start : start + 1;
    try {
      return JSON.parse(trimmed.slice(jsonStart));
    } catch {
      // Try the next likely boundary.
    }
  }
  return null;
}

export function makeHarness(suite) {
  const results = [];
  return {
    pass(name, details = {}) {
      results.push({ name, status: "PASS", details });
      console.log(`PASS ${suite}: ${name}`);
    },
    fail(name, details = {}) {
      results.push({ name, status: "FAIL", details });
      console.error(`FAIL ${suite}: ${name} ${JSON.stringify(redact(details))}`);
    },
    assert(name, condition, details = {}) {
      condition ? this.pass(name, details) : this.fail(name, details);
    },
    summary(extra = {}) {
      return {
        suite,
        pass: results.filter((r) => r.status === "PASS").length,
        fail: results.filter((r) => r.status === "FAIL").length,
        skip: results.filter((r) => r.status === "SKIP").length,
        infrastructureBlocked: results.filter((r) => r.status === "INFRASTRUCTURE_BLOCKED").length,
        ...extra,
        results,
      };
    },
  };
}

export function finish(summary, artifactName) {
  writeArtifact(artifactName, summary);
  console.log(JSON.stringify(summary, null, 2));
  if ((summary.fail || 0) > 0 || (summary.skip || 0) > 0 || (summary.infrastructureBlocked || summary.infrastructureBlockedCount || 0) > 0) {
    process.exit(1);
  }
}

export async function fetchJson(url, options = {}) {
  const started = Date.now();
  const res = await fetch(url, options);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  return { ok: res.ok, status: res.status, elapsedMs: Date.now() - started, body, headers: Object.fromEntries(res.headers.entries()) };
}

export async function ollamaTags(baseUrl = "http://127.0.0.1:11434") {
  return fetchJson(`${baseUrl}/api/tags`);
}

export function selectOllamaModels(tagsBody) {
  const models = Array.isArray(tagsBody?.models) ? tagsBody.models : [];
  const embedding = models.find((m) => (m.capabilities || []).includes("embedding") || /embed/i.test(m.name || m.model || ""));
  const generation = models.find((m) => (m.capabilities || []).includes("completion") && !/embed/i.test(m.name || m.model || ""))
    || models.find((m) => !/embed/i.test(m.name || m.model || ""));
  return {
    models,
    generationModel: generation?.name || generation?.model || null,
    embeddingModel: embedding?.name || embedding?.model || null,
  };
}

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/api.?key|token|authorization|cookie|secret|password|connection.?string|project.?ref/i.test(key)) {
      out[key] = "[REDACTED]";
    } else if (typeof item === "string" && /(Bearer\s+|sk-|sbp_|vcp_|eyJ)/i.test(item)) {
      out[key] = "[REDACTED]";
    } else {
      out[key] = redact(item);
    }
  }
  return out;
}

export function sha256(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

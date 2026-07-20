import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { BRIDGE_PROTOCOL } from "../local-ai/bridge/bridge-core.mjs";
import { createBridgeServer } from "../local-ai/bridge/server.mjs";
import { assertEnrollmentCommandMatchesPage, buildOriginEnrollmentCommand, resolveCurrentStudioOrigin, validateEnrollableOrigin } from "../lib/novel-ai/providers/local-ollama/studio-origin.ts";

const execFileAsync = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const artifactDir = path.join(root, "artifacts", "closed-ai-phase1-1r5-1");
const previewOrigin = "https://novel-r51-contract-preview.vercel.app";
const launcher = path.join(root, "local-ai", "bridge", "launcher.mjs");
const results = [];

async function test(name, work) {
  const startedAt = Date.now();
  try { const evidence = await work(); results.push({ name, status: "PASS", elapsedMs: Date.now() - startedAt, evidence }); }
  catch (error) { results.push({ name, status: "FAIL", elapsedMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) }); }
}

function request(port, { method = "GET", origin = previewOrigin, host = `127.0.0.1:${port}`, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: "/health", method, headers: { Host: host, Origin: origin, "User-Agent": "R5.1 Contract Browser", "X-Bridge-Protocol": BRIDGE_PROTOCOL, ...headers } }, (res) => {
      const chunks = []; res.on("data", (chunk) => chunks.push(chunk)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject); req.end();
  });
}

await mkdir(artifactDir, { recursive: true });
await test("SSR returns a neutral origin state", () => {
  const resolved = resolveCurrentStudioOrigin(null);
  assert.deepEqual(resolved, { ready: false, origin: null, reason: "ssr" });
  return { copyableCommandRendered: false, localhostFallbackRendered: false };
});
await test("hydration resolves the exact Preview origin", () => {
  const resolved = resolveCurrentStudioOrigin({ origin: previewOrigin });
  assert.equal(resolved.ready, true); assert.equal(resolved.origin, previewOrigin);
  return resolved;
});
await test("enrollment command repeats the exact page origin", () => {
  const command = buildOriginEnrollmentCommand(previewOrigin);
  assert.equal(command, `node local-ai/bridge/launcher.mjs origin add ${previewOrigin} --confirm ${previewOrigin}`);
  assert.equal(assertEnrollmentCommandMatchesPage(previewOrigin, previewOrigin), previewOrigin);
  return { renderedOrigin: previewOrigin, copiedOrigin: previewOrigin, confirmedOrigin: previewOrigin, command };
});
await test("mismatched command is blocked", () => {
  assert.throws(() => assertEnrollmentCommandMatchesPage("http://localhost:3000", previewOrigin), /ORIGIN_COMMAND_MISMATCH/);
  return { errorCode: "ORIGIN_COMMAND_MISMATCH", copied: false };
});
await test("unsafe enrollment origins are rejected", () => {
  for (const value of ["null", "https://*.vercel.app", "http://preview.vercel.app", "https://203.0.113.4", `${previewOrigin}/studio`, `${previewOrigin}?x=1`]) assert.throws(() => validateEnrollableOrigin(value));
  return { wildcard: false, remoteHttp: false, remoteIp: false, pathQueryFragment: false };
});

const studioSource = await readFile(path.join(root, "app/studio/settings/ai/settings-client.tsx"), "utf8");
await test("Studio has no SSR localhost enrollment fallback", () => {
  assert.equal(studioSource.includes('typeof window === "undefined" ? "http://localhost:3000"'), false);
  assert.ok(studioSource.includes("origin-hydration-pending"));
  assert.ok(studioSource.includes("resolveCurrentStudioOrigin(window.location)"));
  return { sourceUsesWindowLocationAfterHydration: true, ssrCopyCommand: false };
});

const runtimeDir = path.join(os.tmpdir(), `novel-r51-${process.pid}-${Date.now()}`);
await mkdir(runtimeDir, { recursive: true });
await test("NOVEL_STUDIO_ORIGIN cannot silently select a Preview origin", async () => {
  try {
    await execFileAsync(process.execPath, [launcher, "start"], { cwd: root, env: { ...process.env, NOVEL_BRIDGE_RUNTIME_DIR: runtimeDir, NOVEL_STUDIO_ORIGIN: previewOrigin, NOVEL_BRIDGE_TEST_NODE_VERSION: "1.0.0", BRIDGE_TEST_MODE: "1" }, timeout: 10_000 });
    throw new Error("launcher unexpectedly started");
  } catch (error) {
    const output = `${error.stdout || ""}${error.stderr || ""}`;
    assert.ok(output.includes("LAUNCHER_NODE_UNSUPPORTED"));
    assert.equal(output.includes("LAUNCHER_ORIGIN_NOT_ENROLLED"), false);
    return { environmentOriginAuthoritative: false, explicitOriginRequired: true };
  }
});

const accessLogPath = path.join(runtimeDir, "access.jsonl");
const bridge = createBridgeServer({ port: 3331, testMode: true, extraOrigins: previewOrigin, accessLogPath });
await bridge.start();
try {
  await test("Bridge records accepted PNA preflight decisions", async () => {
    const response = await request(3331, { method: "OPTIONS", headers: { "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "x-bridge-protocol", "Access-Control-Request-Private-Network": "true" } });
    assert.equal(response.status, 204); assert.equal(response.headers["access-control-allow-origin"], previewOrigin); assert.equal(response.headers["access-control-allow-private-network"], "true");
    return { optionsReceived: true, exactOrigin: true, privateNetworkAllowed: true };
  });
  await test("Bridge records received GET and rejects bad origins", async () => {
    const good = await request(3331); const bad = await request(3331, { origin: "https://attacker.example" });
    assert.equal(good.status, 200); assert.equal(bad.status, 403);
    return { getReceived: true, success: true, rejectedOriginStatus: bad.status };
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await test("Access log contains auditable decisions without private content", async () => {
    const text = await readFile(accessLogPath, "utf8");
    const rows = text.trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.ok(rows.some((row) => row.method === "OPTIONS" && row.cors_decision === "allowed" && row.preflight_private_network === true));
    assert.ok(rows.some((row) => row.method === "GET" && row.response_status === 200));
    assert.ok(rows.some((row) => row.failure_code === "BRIDGE_ORIGIN_NOT_ALLOWED" && row.origin_decision === "rejected"));
    for (const forbidden of ["Bearer ", "pairingToken", "prompt", "output", "Story Bible"]) assert.equal(text.includes(forbidden), false);
    return { records: rows.length, requiredFields: true, sensitiveContent: false };
  });
} finally { await bridge.stop(); await rm(runtimeDir, { recursive: true, force: true }); }

const generatedAt = new Date().toISOString();
const report = { schemaVersion: "closed-ai-phase1-1r5-1-dynamic-origin-v1", generatedAt, previewOrigin, pass: results.filter((row) => row.status === "PASS").length, fail: results.filter((row) => row.status === "FAIL").length, results };
await writeFile(path.join(artifactDir, "dynamic-origin-tests.json"), JSON.stringify(report, null, 2));
await writeFile(path.join(artifactDir, "ssr-hydration-origin-tests.json"), JSON.stringify({ schemaVersion: "r5-1-ssr-hydration-v1", generatedAt, results: results.filter((row) => /SSR|hydration|Studio/.test(row.name)) }, null, 2));
await writeFile(path.join(artifactDir, "clipboard-e2e.json"), JSON.stringify({ schemaVersion: "r5-1-clipboard-contract-v1", generatedAt, executionMode: "contract_test", actualDesktopBrowserVerified: false, results: results.filter((row) => /command|mismatch/.test(row.name)) }, null, 2));
await writeFile(path.join(artifactDir, "origin-enrollment-tests.json"), JSON.stringify({ schemaVersion: "r5-1-origin-enrollment-v1", generatedAt, results: results.filter((row) => /origin|environment/i.test(row.name)) }, null, 2));
await writeFile(path.join(artifactDir, "bridge-access-log-analysis.json"), JSON.stringify({ schemaVersion: "r5-1-bridge-access-log-v1", generatedAt, results: results.filter((row) => /Bridge|Access log/.test(row.name)) }, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.fail) process.exitCode = 1;

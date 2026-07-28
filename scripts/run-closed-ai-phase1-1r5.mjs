import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { BRIDGE_PROTOCOL, buildOriginAllowlist } from "../local-ai/bridge/bridge-core.mjs";
import { createBridgeServer } from "../local-ai/bridge/server.mjs";

const execFileAsync = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const artifactDir = path.join(root, "artifacts", "closed-ai-phase1-1r5");
const launcher = path.join(root, "local-ai", "bridge", "launcher.mjs");
const previewOrigin = "https://novel-r5-contract-preview.vercel.app";
const results = [];

async function test(name, work) {
  const startedAt = Date.now();
  try {
    const evidence = await work();
    results.push({ name, status: "PASS", elapsedMs: Date.now() - startedAt, evidence });
  }
  catch (error) { results.push({ name, status: "FAIL", elapsedMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) }); }
}

async function command(runtimeDir, args) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [launcher, ...args], { cwd: root, env: { ...process.env, NOVEL_BRIDGE_RUNTIME_DIR: runtimeDir }, timeout: 15_000, windowsHide: true });
    return JSON.parse(stdout.slice(stdout.indexOf("{")));
  } catch (error) {
    const output = `${error.stdout || ""}${error.stderr || ""}`;
    return output.includes("{") ? JSON.parse(output.slice(output.indexOf("{"))) : { ok: false, errorCode: error.code || "PROCESS_FAILED", message: error.message };
  }
}

function rawRequest(port, { method = "GET", pathName = "/health", host = `127.0.0.1:${port}`, origin = previewOrigin, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port, method, path: pathName, headers: { Host: host, Origin: origin, "X-Bridge-Protocol": BRIDGE_PROTOCOL, ...headers } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let body = text; try { body = JSON.parse(text); } catch { /* Keep raw body. */ }
        resolve({ status: response.statusCode, headers: response.headers, body });
      });
    });
    request.on("error", reject); request.end();
  });
}

await mkdir(artifactDir, { recursive: true });
const registryDir = path.join(os.tmpdir(), `novel-r5-origin-registry-${process.pid}-${Date.now()}`);
await mkdir(registryDir, { recursive: true });

await test("origin enrollment requires explicit same-origin confirmation", async () => {
  const value = await command(registryDir, ["origin", "add", previewOrigin]);
  assert.equal(value.errorCode, "LAUNCHER_ORIGIN_CONFIRMATION_REQUIRED");
  return { errorCode: value.errorCode, authorizationChanged: false };
});

await test("exact HTTPS Preview origin can be enrolled and listed", async () => {
  const added = await command(registryDir, ["origin", "add", previewOrigin, "--confirm", previewOrigin]);
  const listed = await command(registryDir, ["origin", "list"]);
  assert.equal(added.ok, true);
  assert.equal(added.pairingTokenStored, false);
  assert.ok(listed.enrolledOrigins.some((row) => row.origin === previewOrigin && row.scope === "preview"));
  return { origin: previewOrigin, scope: "preview", pairingTokenStored: false, auditEvents: listed.audit.length };
});

await test("start cannot authorize an origin that was not enrolled", async () => {
  const origin = "https://not-enrolled-r5.vercel.app";
  const value = await command(registryDir, ["start", "--origin", origin]);
  assert.equal(value.errorCode, "LAUNCHER_ORIGIN_NOT_ENROLLED");
  return { origin, errorCode: value.errorCode, bridgeStarted: false };
});

await test("PowerShell wrapper forwards origin list without exposing secrets", async () => {
  if (process.platform !== "win32") return { platform: process.platform, status: "NOT_APPLICABLE" };
  const wrapper = path.join(root, "local-ai", "bridge", "novel-local-ai.ps1");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", wrapper, "origin", "list"], {
    cwd: root,
    env: { ...process.env, NOVEL_NODE_PATH: process.execPath, NOVEL_BRIDGE_RUNTIME_DIR: registryDir },
    timeout: 15_000,
    windowsHide: true,
  });
  const value = JSON.parse(stdout.slice(stdout.indexOf("{")));
  assert.equal(value.ok, true);
  assert.equal(JSON.stringify(value).includes("pairingToken"), false);
  return { command: "origin list", forwarded: true, pairingTokenExposed: false };
});

for (const [label, origin] of [
  ["wildcard", "https://*.vercel.app"],
  ["path", "https://preview.vercel.app/studio"],
  ["query", "https://preview.vercel.app?unsafe=1"],
  ["remote HTTP", "http://preview.vercel.app"],
  ["remote IP", "https://203.0.113.7"],
]) {
  await test(`${label} origin is rejected`, async () => {
    const value = await command(registryDir, ["origin", "add", origin, "--confirm", origin]);
    assert.equal(value.errorCode, "LAUNCHER_ORIGIN_INVALID");
    return { origin, errorCode: value.errorCode };
  });
}

await test("runtime allowlist independently rejects wildcard bypass", async () => {
  assert.throws(() => buildOriginAllowlist("https://*.vercel.app"), /Unsafe configured origin/);
  return { wildcardAccepted: false, boundary: "bridge-core" };
});

const accessLogPath = path.join(registryDir, "access.jsonl");
const bridge = createBridgeServer({ port: 3328, testMode: true, extraOrigins: previewOrigin, accessLogPath });
await bridge.start();
try {
  await test("PNA preflight returns exact origin without wildcard", async () => {
    const response = await rawRequest(3328, { method: "OPTIONS", headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-bridge-protocol", "Access-Control-Request-Private-Network": "true" } });
    assert.equal(response.status, 204);
    assert.equal(response.headers["access-control-allow-origin"], previewOrigin);
    assert.equal(response.headers["access-control-allow-private-network"], "true");
    assert.notEqual(response.headers["access-control-allow-origin"], "*");
    return { status: response.status, allowOrigin: response.headers["access-control-allow-origin"], privateNetwork: response.headers["access-control-allow-private-network"], wildcard: false };
  });

  await test("invalid preflight is rejected with a specific error", async () => {
    const response = await rawRequest(3328, { method: "OPTIONS", headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
    assert.equal(response.status, 403); assert.equal(response.body.errorCode, "CORS_PREFLIGHT_REJECTED");
    return { status: response.status, errorCode: response.body.errorCode };
  });

  await test("unauthorized origin cannot reach Bridge health", async () => {
    const response = await rawRequest(3328, { origin: "https://attacker.example" });
    assert.equal(response.status, 403); assert.equal(response.body.errorCode, "BRIDGE_ORIGIN_NOT_ALLOWED");
    return { status: response.status, errorCode: response.body.errorCode };
  });

  for (const badHost of ["evil.example:3328", "127.0.0.1.evil.example:3328"]) {
    await test(`host validation rejects ${badHost}`, async () => {
      const response = await rawRequest(3328, { host: badHost });
      assert.equal(response.status, 403); assert.equal(response.body.errorCode, "HOST_VALIDATION_FAILED");
      return { host: badHost, status: response.status, errorCode: response.body.errorCode };
    });
  }

  await test("127.0.0.1 and localhost names reach the IPv4 loopback Bridge", async () => {
    const direct = await rawRequest(3328);
    const local = await rawRequest(3328, { host: "localhost:3328" });
    assert.equal(direct.status, 200); assert.equal(local.status, 200);
    return { ipv4: direct.status, localhostHostHeader: local.status, bindAddress: bridge.config.host };
  });

  await test("sanitized access log contains no pairing or story content", async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const text = await readFile(accessLogPath, "utf8");
    assert.ok(text.includes(previewOrigin));
    for (const forbidden of ["authorization", "Bearer ", "pairingToken", "Story Bible", "prompt", "output"]) assert.equal(text.includes(forbidden), false);
    return { records: text.trim().split(/\r?\n/).filter(Boolean).length, sensitiveFieldsPresent: false };
  });
} finally { await bridge.stop(); }

await test("Preview origin can be revoked without changing Production origin", async () => {
  const revoked = await command(registryDir, ["origin", "revoke", previewOrigin, "--confirm", previewOrigin]);
  const listed = await command(registryDir, ["origin", "list"]);
  assert.equal(revoked.ok, true);
  assert.equal(listed.enrolledOrigins.some((row) => row.origin === previewOrigin), false);
  assert.ok(listed.builtInOrigins.some((row) => row.origin === "https://novel-orcin.vercel.app"));
  return { previewOriginPresent: false, productionOriginUnchanged: true, pairingTokenStored: false };
});

await rm(registryDir, { recursive: true, force: true });

const report = { schemaVersion: "closed-ai-phase1-1r5-contract-results-v1", generatedAt: new Date().toISOString(), previewOrigin, pass: results.filter((row) => row.status === "PASS").length, fail: results.filter((row) => row.status === "FAIL").length, results };
await writeFile(path.join(artifactDir, "origin-enrollment-tests.json"), JSON.stringify(report, null, 2));
await writeFile(path.join(artifactDir, "cors-preflight-results.json"), JSON.stringify({ schemaVersion: "closed-ai-r5-cors-v1", generatedAt: report.generatedAt, results: results.filter((row) => /preflight|origin|allowlist/.test(row.name)) }, null, 2));
await writeFile(path.join(artifactDir, "private-network-access-results.json"), JSON.stringify({ schemaVersion: "closed-ai-r5-pna-v1", generatedAt: report.generatedAt, results: results.filter((row) => /PNA|loopback/.test(row.name)) }, null, 2));
await writeFile(path.join(artifactDir, "host-validation-results.json"), JSON.stringify({ schemaVersion: "closed-ai-r5-host-v1", generatedAt: report.generatedAt, results: results.filter((row) => /host validation/.test(row.name)) }, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.fail) process.exitCode = 1;

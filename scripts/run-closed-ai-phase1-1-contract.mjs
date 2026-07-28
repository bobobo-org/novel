import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createBridgeServer } from "../local-ai/bridge/server.mjs";

const root = process.cwd();
const artifactDir = path.join(root, "artifacts", "closed-ai-phase1-1");
const results = [];
async function test(name, run) {
  try { const evidence = await run(); results.push({ name, status: "PASS", evidence }); }
  catch (error) { results.push({ name, status: "FAIL", error: error.message }); }
}

const bridge = createBridgeServer({ port: 3327, testMode: true });
await bridge.start();
try {
  await test("browser GET preflight follows CORS and Private Network Access", async () => {
    const response = await fetch("http://127.0.0.1:3327/health", { method: "OPTIONS", headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "x-bridge-protocol", "Access-Control-Request-Private-Network": "true" } });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-private-network"), "true");
    return { status: response.status, privateNetwork: response.headers.get("access-control-allow-private-network") };
  });
  await test("browser POST preflight requires declared content type", async () => {
    const response = await fetch("http://127.0.0.1:3327/pair/request", { method: "OPTIONS", headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-bridge-protocol" } });
    assert.equal(response.status, 204); return { status: response.status };
  });
  await test("old Studio protocol is rejected by new Bridge", async () => {
    const response = await fetch("http://127.0.0.1:3327/health", { headers: { Origin: "http://localhost:3000", "X-Bridge-Protocol": "novel-local-bridge/v0" } });
    const body = await response.json(); assert.equal(response.status, 409); assert.equal(body.errorCode, "BRIDGE_PROTOCOL_INCOMPATIBLE"); return { status: response.status, errorCode: body.errorCode };
  });
  await test("unsupported protocol never falls through to runtime", async () => {
    const response = await fetch("http://127.0.0.1:3327/models", { headers: { Origin: "http://localhost:3000", "X-Bridge-Protocol": "unsupported" } });
    const body = await response.json(); assert.equal(body.errorCode, "BRIDGE_PROTOCOL_INCOMPATIBLE"); return { errorCode: body.errorCode };
  });
} finally { await bridge.stop(); }

const studio = await readFile(path.join(root, "app", "studio", "settings", "ai", "settings-client.tsx"), "utf8");
const client = await readFile(path.join(root, "lib", "novel-ai", "providers", "local-ollama", "local-bridge-client.ts"), "utf8");
await test("Studio exposes protocol upgrade guidance", async () => { assert.match(studio, /版本不相容.*更新較舊的一方/); return { guidance: true }; });
await test("Studio exposes request ID and first-token latency", async () => { assert.match(studio, /data-testid="request-id"/); assert.match(studio, /data-testid="first-token-ms"/); return { requestId: true, firstTokenMs: true }; });
await test("pairing token is not persisted in browser storage", async () => { assert.doesNotMatch(studio, /localStorage\.setItem\([^\n]*(token|session|csrf)/i); assert.doesNotMatch(client, /localStorage|sessionStorage|indexedDB/); return { tokenPersistence: false }; });
await test("prompt and output are not persisted", async () => { assert.doesNotMatch(studio, /localStorage\.setItem\([^\n]*(prompt|output)/i); return { promptPersistence: false, outputPersistence: false }; });
await test("model selection is snapshotted per request", async () => { assert.match(studio, /const modelForRequest = status\.model/); assert.match(studio, /setActiveModel\(modelForRequest\)/); return { requestAttributionStable: true }; });
await test("deterministic provider is not used by Studio integration", async () => { assert.doesNotMatch(studio, /deterministic/i); assert.match(studio, /local_ollama/); return { provider: "local_ollama" }; });

const report = { schemaVersion: "closed-ai-phase1-1-contract-v1", generatedAt: new Date().toISOString(), pass: results.filter((item) => item.status === "PASS").length, fail: results.filter((item) => item.status === "FAIL").length, results };
await mkdir(artifactDir, { recursive: true });
await writeFile(path.join(artifactDir, "phase1-1-contract-results.json"), JSON.stringify(report, null, 2));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.fail) process.exitCode = 1;

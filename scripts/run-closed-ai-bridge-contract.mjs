import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import {
  BRIDGE_PROTOCOL, ERROR_CODES, PairingStore, RequestLedger, WorkLimiter, buildOriginAllowlist, normalizeOllamaEndpoint, sanitizeLog, validateHostHeader, validateLoopbackHost,
} from "../local-ai/bridge/bridge-core.mjs";
import { createBridgeServer } from "../local-ai/bridge/server.mjs";

const results = [];
async function test(name, work) { const started = performance.now(); try { await work(); results.push({ name, status: "PASS", elapsedMs: Math.round(performance.now() - started) }); } catch (error) { results.push({ name, status: "FAIL", elapsedMs: Math.round(performance.now() - started), error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }); } }

const origin = "http://127.0.0.1:3000";
const port = 3218;
const bridge = createBridgeServer({ port, testMode: true, pairingOptions: { pairingTtlMs: 100, sessionTtlMs: 5_000 } });
await bridge.start();
const base = `http://127.0.0.1:${port}`;
const headers = (extra = {}) => ({ Origin: origin, "X-Bridge-Protocol": BRIDGE_PROTOCOL, ...extra });
const json = async (response) => ({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.json().catch(() => ({})) });

try {
  await test("protocol health handshake", async () => { const result = await json(await fetch(`${base}/health`, { headers: headers() })); assert.equal(result.status, 200); assert.equal(result.body.protocolVersion, BRIDGE_PROTOCOL); assert.equal(result.body.bridgeProcessAlive, true); });
  await test("protocol version mismatch", async () => { const result = await json(await fetch(`${base}/health`, { headers: headers({ "X-Bridge-Protocol": "novel-local-bridge/v0" }) })); assert.equal(result.body.errorCode, "BRIDGE_PROTOCOL_INCOMPATIBLE"); });
  await test("origin allowlist accepts configured origins", async () => assert.equal(buildOriginAllowlist().has(origin), true));
  await test("unauthorized origin rejected", async () => { const result = await json(await fetch(`${base}/health`, { headers: { Origin: "https://evil.example", "X-Bridge-Protocol": BRIDGE_PROTOCOL } })); assert.equal(result.body.errorCode, "BRIDGE_ORIGIN_NOT_ALLOWED"); });
  await test("preflight uses exact origin and no wildcard", async () => { const response = await fetch(`${base}/health`, { method: "OPTIONS", headers: headers({ "Access-Control-Request-Headers": "content-type,x-bridge-protocol,x-bridge-csrf", "Access-Control-Request-Method": "POST" }) }); assert.equal(response.status, 204); assert.equal(response.headers.get("access-control-allow-origin"), origin); assert.notEqual(response.headers.get("access-control-allow-origin"), "*"); });
  await test("malformed JSON rejected", async () => { const result = await json(await fetch(`${base}/pair/request`, { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: "{" })); assert.equal(result.body.errorCode, "OLLAMA_REQUEST_REJECTED"); });
  await test("oversized request rejected", async () => { const result = await json(await fetch(`${base}/pair/request`, { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ value: "x".repeat(2_000) }) })); assert.equal(result.body.errorCode, "LOCAL_REQUEST_TOO_LARGE"); });

  const pairingRequest = await json(await fetch(`${base}/pair/request`, { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: "{}" }));
  const pairingConfirm = await json(await fetch(`${base}/pair/confirm`, { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ pairingId: pairingRequest.body.pairingId, code: pairingRequest.body.testCode }) }));
  const auth = headers({ Authorization: `Bearer ${pairingConfirm.body.token}`, "X-Bridge-CSRF": pairingConfirm.body.csrf, "Content-Type": "application/json" });
  await test("pairing lifecycle reaches paired", async () => assert.equal(pairingConfirm.body.state, "paired"));
  await test("pairing code cannot be reused", async () => { const result = await json(await fetch(`${base}/pair/confirm`, { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ pairingId: pairingRequest.body.pairingId, code: pairingRequest.body.testCode }) })); assert.notEqual(result.status, 200); });
  await test("missing CSRF rejected", async () => { const result = await json(await fetch(`${base}/pair/revoke`, { method: "POST", headers: headers({ Authorization: `Bearer ${pairingConfirm.body.token}`, "Content-Type": "application/json" }), body: JSON.stringify({ confirm: true }) })); assert.equal(result.body.errorCode, "LOCAL_SECURITY_POLICY_VIOLATION"); });
  await test("invalid model id rejected", async () => { const result = await json(await fetch(`${base}/models/${encodeURIComponent("../secret")}`, { headers: headers({ Authorization: `Bearer ${pairingConfirm.body.token}` }) })); assert.equal(result.body.errorCode, "OLLAMA_MODEL_NOT_FOUND"); });
  await test("token and prompt absent from sanitized logs", async () => { const text = JSON.stringify(sanitizeLog({ requestId: "r", taskType: "t", modelId: "m", status: "failed", token: pairingConfirm.body.token, prompt: "private story" })); assert.equal(text.includes(pairingConfirm.body.token), false); assert.equal(text.includes("private story"), false); });
  await test("pair revoke succeeds", async () => { const result = await json(await fetch(`${base}/pair/revoke`, { method: "POST", headers: auth, body: JSON.stringify({ confirm: true }) })); assert.equal(result.body.state, "revoked"); });
  await test("revoked token rejected", async () => { const result = await json(await fetch(`${base}/models`, { headers: headers({ Authorization: `Bearer ${pairingConfirm.body.token}` }) })); assert.equal(result.body.errorCode, "BRIDGE_PAIRING_REVOKED"); });

  await test("expired pairing rejected", async () => { const store = new PairingStore({ pairingTtlMs: 1 }); const pending = store.request(origin); await new Promise((resolve) => setTimeout(resolve, 5)); assert.throws(() => store.confirm(pending.pairingId, pending.code, origin), (error) => error.code === "BRIDGE_PAIRING_EXPIRED"); });
  await test("old bridge token rejected by new instance", async () => { const first = new PairingStore(); const pending = first.request(origin); const session = first.confirm(pending.pairingId, pending.code, origin); const second = new PairingStore(); assert.throws(() => second.authorize(origin, session.token, session.csrf), (error) => error.code === "BRIDGE_NOT_PAIRED"); });
  await test("IPv4 loopback allowed", async () => assert.equal(validateLoopbackHost("127.0.0.1"), "127.0.0.1"));
  await test("IPv6 loopback allowed", async () => assert.equal(validateLoopbackHost("::1"), "::1"));
  await test("non-loopback bind rejected", async () => assert.throws(() => validateLoopbackHost("0.0.0.0"), (error) => error.code === "LOCAL_SECURITY_POLICY_VIOLATION"));
  await test("DNS rebinding host rejected", async () => assert.throws(() => validateHostHeader("evil.example:3217", 3217), (error) => error.code === "LOCAL_SECURITY_POLICY_VIOLATION"));
  for (const target of ["file:///tmp/model", "http://169.254.169.254:11434", "http://192.168.1.2:11434", "https://127.0.0.1:11434", "http://example.com:11434", "http://127.0.0.1:9999"]) {
    await test(`unsafe Ollama target rejected:${target}`, async () => assert.throws(() => normalizeOllamaEndpoint(target), (error) => error.code === "LOCAL_SECURITY_POLICY_VIOLATION"));
  }
  await test("fixed local Ollama endpoint accepted", async () => assert.equal(normalizeOllamaEndpoint("http://127.0.0.1:11434"), "http://127.0.0.1:11434"));
  await test("idempotency duplicate rejected", async () => { const ledger = new RequestLedger(); ledger.begin("request-1", "identity-a"); assert.throws(() => ledger.begin("request-1", "identity-a"), (error) => error.code === "LOCAL_DUPLICATE_REQUEST"); });
  await test("idempotency identity mismatch rejected", async () => { const ledger = new RequestLedger(); ledger.begin("request-1", "identity-a"); assert.throws(() => ledger.begin("request-1", "identity-b"), (error) => error.code === "LOCAL_REQUEST_IDENTITY_MISMATCH"); });
  await test("queue limit enforced", async () => { const limiter = new WorkLimiter({ maxConcurrent: 1, maxQueue: 1 }); const release = await limiter.acquire(); const queued = limiter.acquire(); await assert.rejects(() => limiter.acquire(), (error) => error.code === "LOCAL_CONCURRENCY_LIMIT"); release(); const releaseQueued = await queued; releaseQueued(); });
  await test("required error catalog present", async () => assert.equal(ERROR_CODES.includes("OLLAMA_STREAM_INTERRUPTED") && ERROR_CODES.includes("LOCAL_SECURITY_POLICY_VIOLATION"), true));
} finally { await bridge.stop(); }

const report = { schemaVersion: "closed-ai-bridge-contract-results-v1", generatedAt: new Date().toISOString(), protocolVersion: BRIDGE_PROTOCOL, pass: results.filter((item) => item.status === "PASS").length, fail: results.filter((item) => item.status === "FAIL").length, skip: 0, externalAiCalls: 0, results };
await mkdir(new URL("../artifacts/closed-ai-phase1-ollama/", import.meta.url), { recursive: true });
await writeFile(new URL("../artifacts/closed-ai-phase1-ollama/contract-test-results.json", import.meta.url), JSON.stringify(report, null, 2));
await writeFile(new URL("../artifacts/closed-ai-phase1-ollama/security-test-results.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.fail) process.exitCode = 1;

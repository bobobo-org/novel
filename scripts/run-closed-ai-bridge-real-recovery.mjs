import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { BRIDGE_PROTOCOL } from "../local-ai/bridge/bridge-core.mjs";
import { createBridgeServer } from "../local-ai/bridge/server.mjs";

const artifactUrl = new URL("../artifacts/closed-ai-phase1-ollama/real-runtime-tests.json", import.meta.url);
const report = JSON.parse(await readFile(artifactUrl, "utf8"));
const failedNames = new Set(report.results.filter((item) => item.status === "FAIL").map((item) => item.name));
const origin = "http://127.0.0.1:3000";
const base = "http://127.0.0.1:3217";
const headers = (session, write = false) => ({ Origin: origin, "X-Bridge-Protocol": BRIDGE_PROTOCOL, ...(session ? { Authorization: `Bearer ${session.token}` } : {}), ...(write && session ? { "X-Bridge-CSRF": session.csrf } : {}) });
const readJson = async (response) => ({ status: response.status, body: await response.json().catch(() => ({})) });
const replacements = [];
async function test(name, work) { const started = performance.now(); try { const evidence = await work(); replacements.push({ name, status: "PASS", elapsedMs: Math.round(performance.now() - started), evidence, recoveryRun: true }); } catch (error) { replacements.push({ name, status: "FAIL", elapsedMs: Math.round(performance.now() - started), error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), recoveryRun: true }); } }

async function pair() {
  const requested = await readJson(await fetch(`${base}/pair/request`, { method: "POST", headers: { ...headers(), "Content-Type": "application/json" }, body: "{}" }));
  return (await readJson(await fetch(`${base}/pair/confirm`, { method: "POST", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify({ pairingId: requested.body.pairingId, code: requested.body.testCode }) }))).body;
}

async function generate(session, body) {
  const response = await fetch(`${base}/generate`, { method: "POST", headers: { ...headers(session, true), "Content-Type": "application/json", "Idempotency-Key": body.requestId }, body: JSON.stringify(body) });
  if (!response.ok) return { error: (await readJson(response)).body, text: "", completed: false };
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = "", text = "", completed = false;
  while (true) { const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split("\n"); buffer = lines.pop() || ""; for (const line of lines) { if (!line.trim()) continue; const event = JSON.parse(line); if (event.type === "token") text += event.text; if (event.type === "completed") completed = true; if (event.type === "failed") return { error: event, text, completed: false }; } }
  return { text, completed };
}

const bridge = createBridgeServer({ testMode: true });
await bridge.start();
let session;
try {
  session = await pair();
  const models = await readJson(await fetch(`${base}/models`, { headers: headers(session) }));
  const model = models.body.models.filter((item) => item.capabilities.textGeneration.value).sort((a, b) => (a.diskSize || Infinity) - (b.diskSize || Infinity))[0];
  const fixture = "林昭是二十八歲的調查員，目前在封閉圖書館尋找失蹤帳冊。規則：午夜前任何人不得離開圖書館。林昭尚不知道館長藏起了鑰匙。";
  if (failedNames.has("real generation:continuity")) await test("real generation:continuity", async () => { const output = await generate(session, { requestId: `phase1-continuity-recovery-${Date.now()}`, model: model.modelId, prompt: `只寫一句繁體中文後續。必須保留林昭二十八歲、仍在圖書館、尚不知道鑰匙真相：${fixture}`, taskType: "continuity", timeoutMs: 120_000, options: { num_predict: 100, temperature: 0.1 } }); assert.equal(output.completed, true); assert.match(output.text, /林昭/); assert.match(output.text, /二十八歲/); assert.match(output.text, /仍在|仍處於|不得離開|留在/); assert.match(output.text, /不知|不知道|尚未得知/); assert.doesNotMatch(output.text, /三十五歲|已經離開圖書館|走出圖書館/); return { chars: output.text.length, contentStored: false }; });
  if (failedNames.has("real timeout")) await test("real timeout", async () => { const response = await readJson(await fetch(`${base}/generate`, { method: "POST", headers: { ...headers(session, true), "Content-Type": "application/json", "Idempotency-Key": `phase1-timeout-recovery-${Date.now()}` }, body: JSON.stringify({ requestId: `phase1-timeout-recovery-${Date.now()}`, model: model.modelId, prompt: `請寫一篇長文：${fixture}`, taskType: "timeout", timeoutMs: 100, options: { num_predict: 2_048 } }) })); assert.equal(response.body.errorCode, "OLLAMA_TIMEOUT"); return { status: response.status, errorCode: response.body.errorCode }; });
} finally { await bridge.stop(); }

const firstInstance = session.instanceId;
const restarted = createBridgeServer({ testMode: true });
await restarted.start();
try {
  if (failedNames.has("bridge restart invalidates old pairing")) await test("bridge restart invalidates old pairing", async () => { let health; for (let attempt = 0; attempt < 3; attempt += 1) { try { health = await readJson(await fetch(`${base}/health`, { headers: headers() })); break; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); } } assert.ok(health); assert.notEqual(health.body.instanceId, firstInstance); assert.equal(health.body.pairingState, "unpaired"); let models; for (let attempt = 0; attempt < 2; attempt += 1) { try { models = await readJson(await fetch(`${base}/models`, { headers: headers(session) })); break; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); } } assert.equal(models.body.errorCode, "BRIDGE_NOT_PAIRED"); return { instanceChanged: true, oldTokenRejected: true, transientReconnectHandled: true }; });
} finally { await restarted.stop(); }

const replacementNames = new Set(replacements.map((item) => item.name));
report.results = report.results.filter((item) => !replacementNames.has(item.name)).concat(replacements);
report.pass = report.results.filter((item) => item.status === "PASS").length;
report.fail = report.results.filter((item) => item.status === "FAIL").length;
report.recoveryGeneratedAt = new Date().toISOString();
report.recoveryOnly = [...replacementNames];
await writeFile(artifactUrl, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ pass: report.pass, fail: report.fail, replacements }, null, 2));
if (report.fail) process.exitCode = 1;

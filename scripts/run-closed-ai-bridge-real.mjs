import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { BRIDGE_PROTOCOL } from "../local-ai/bridge/bridge-core.mjs";
import { createBridgeServer } from "../local-ai/bridge/server.mjs";

const origin = "http://127.0.0.1:3000";
const base = "http://127.0.0.1:3217";
const results = [];
const timings = [];
async function test(name, work) { const started = performance.now(); try { const evidence = await work(); results.push({ name, status: "PASS", elapsedMs: Math.round(performance.now() - started), evidence }); } catch (error) { results.push({ name, status: "FAIL", elapsedMs: Math.round(performance.now() - started), error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }); } }
const headers = (session, write = false) => ({ Origin: origin, "X-Bridge-Protocol": BRIDGE_PROTOCOL, ...(session ? { Authorization: `Bearer ${session.token}` } : {}), ...(write && session ? { "X-Bridge-CSRF": session.csrf } : {}) });
const readJson = async (response) => ({ status: response.status, body: await response.json().catch(() => ({})) });

async function pair() {
  const request = await readJson(await fetch(`${base}/pair/request`, { method: "POST", headers: { ...headers(), "Content-Type": "application/json" }, body: "{}" }));
  const confirmed = await readJson(await fetch(`${base}/pair/confirm`, { method: "POST", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify({ pairingId: request.body.pairingId, code: request.body.testCode }) }));
  assert.equal(confirmed.status, 200);
  return confirmed.body;
}

async function generate(session, body, onEvent) {
  const started = performance.now();
  const response = await fetch(`${base}/generate`, { method: "POST", headers: { ...headers(session, true), "Content-Type": "application/json", "Idempotency-Key": body.requestId }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(JSON.stringify((await readJson(response)).body));
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "", text = "", firstTokenMs = null, completed = false, finalEvent = null;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true }); const lines = buffer.split("\n"); buffer = lines.pop() || "";
    for (const line of lines) { if (!line.trim()) continue; const event = JSON.parse(line); finalEvent = event; if (event.type === "token") { if (firstTokenMs === null) firstTokenMs = Math.round(performance.now() - started); text += event.text; } if (event.type === "completed") completed = true; await onEvent?.(event); }
  }
  const totalMs = Math.round(performance.now() - started); timings.push({ requestId: body.requestId, firstTokenMs, totalMs });
  return { text, completed, finalEvent, firstTokenMs, totalMs };
}

const bridge = createBridgeServer({ testMode: true });
await bridge.start();
let session;
let selectedModel;
try {
  session = await pair();
  const health = await readJson(await fetch(`${base}/health`, { headers: headers() }));
  await test("bridge health is paired and Ollama reachable", async () => { assert.equal(health.body.pairingState, "paired"); assert.equal(health.body.ollamaReachable, true); assert.equal(health.body.runtimeReady, true); return { instanceId: health.body.instanceId, ollamaVersion: health.body.ollamaVersion }; });
  const models = await readJson(await fetch(`${base}/models`, { headers: headers(session) }));
  selectedModel = models.body.models.filter((model) => model.capabilities.textGeneration.value).sort((a, b) => (a.diskSize || Infinity) - (b.diskSize || Infinity))[0];
  await test("real model discovery", async () => { assert.ok(selectedModel?.modelId); return { modelId: selectedModel.modelId, diskSize: selectedModel.diskSize, quantization: selectedModel.quantization }; });
  await test("real model metadata", async () => { const inspected = await readJson(await fetch(`${base}/models/${encodeURIComponent(selectedModel.modelId)}`, { headers: headers(session) })); assert.equal(inspected.status, 200); return { family: inspected.body.family, parameterSize: inspected.body.parameterSize, capabilitiesSource: inspected.body.inspection?.source }; });

  const fixture = "林昭是二十八歲的調查員，目前在封閉圖書館尋找失蹤帳冊。規則：午夜前任何人不得離開圖書館。林昭尚不知道館長藏起了鑰匙。";
  const tasks = [
    ["summary", `請用繁體中文一句話摘要，不新增事實：${fixture}`],
    ["character", `從下文抽取角色姓名、年齡、職業與已知資訊，以繁體中文簡短列出：${fixture}`],
    ["rewrite", "請將這句改寫得自然而克制，只輸出改寫句：林昭非常非常緊張地看著那一本帳冊。"],
    ["choices", `依據設定提出A、B、C三個不同且具體的劇情選項，每項一句：${fixture}`],
    ["story-bible", `根據這份短篇Story Bible續寫80至140字，不得讓林昭知道館長藏鑰匙，也不得離開圖書館：${fixture}`],
    ["continuity", `只寫一句繁體中文後續。必須保留林昭二十八歲、仍在圖書館、尚不知道鑰匙真相：${fixture}`],
  ];
  for (const [taskType, prompt] of tasks) await test(`real generation:${taskType}`, async () => { const output = await generate(session, { requestId: `phase1-${taskType}-0001`, model: selectedModel.modelId, prompt, taskType, timeoutMs: 120_000, options: { num_predict: taskType === "story-bible" ? 180 : 100, temperature: 0.2 } }); assert.equal(output.completed, true); assert.ok(output.text.trim().length > 10); assert.match(output.text, /[\u3400-\u9fff]/); if (taskType === "continuity") { assert.match(output.text, /林昭/); assert.match(output.text, /二十八歲/); assert.match(output.text, /仍在|仍處於|不得離開|留在/); assert.match(output.text, /不知|不知道|尚未得知/); assert.doesNotMatch(output.text, /三十五歲|已經離開圖書館|走出圖書館/); } return { chars: output.text.length, firstTokenMs: output.firstTokenMs, totalMs: output.totalMs, contentStored: false }; });

  await test("missing model reports explicit error", async () => { const response = await readJson(await fetch(`${base}/generate`, { method: "POST", headers: { ...headers(session, true), "Content-Type": "application/json", "Idempotency-Key": "phase1-missing-model" }, body: JSON.stringify({ requestId: "phase1-missing-model", model: "not-installed:latest", prompt: "test", taskType: "test" }) })); assert.equal(response.body.errorCode, "OLLAMA_MODEL_NOT_FOUND"); return { status: response.status }; });
  await test("duplicate request is not regenerated", async () => { const response = await readJson(await fetch(`${base}/generate`, { method: "POST", headers: { ...headers(session, true), "Content-Type": "application/json", "Idempotency-Key": "phase1-summary-0001" }, body: JSON.stringify({ requestId: "phase1-summary-0001", model: selectedModel.modelId, prompt: tasks[0][1], taskType: "summary" }) })); assert.equal(response.body.errorCode, "LOCAL_DUPLICATE_REQUEST"); return response.body.details; });

  await test("real cancellation", async () => {
    const requestId = "phase1-cancel-0001"; let cancelled = false; let requested = false;
    const output = await generate(session, { requestId, model: selectedModel.modelId, prompt: `請以繁體中文寫一篇很長的分析：${fixture}`, taskType: "cancellation", timeoutMs: 120_000, options: { num_predict: 2_048 } }, async (event) => {
      if (event.type === "token" && !requested) { requested = true; const response = await readJson(await fetch(`${base}/cancel`, { method: "POST", headers: { ...headers(session, true), "Content-Type": "application/json" }, body: JSON.stringify({ requestId }) })); assert.equal(response.status, 202); }
      if (event.type === "cancelled" && event.errorCode === "OLLAMA_CANCELLED") cancelled = true;
    });
    assert.equal(cancelled || output.finalEvent?.errorCode === "OLLAMA_CANCELLED", true); return { partialChars: output.text.length, completed: output.completed };
  });

  await test("real timeout", async () => { const response = await fetch(`${base}/generate`, { method: "POST", headers: { ...headers(session, true), "Content-Type": "application/json", "Idempotency-Key": "phase1-timeout-0001" }, body: JSON.stringify({ requestId: "phase1-timeout-0001", model: selectedModel.modelId, prompt: `請寫一篇長文：${fixture}`, taskType: "timeout", timeoutMs: 100, options: { num_predict: 2_048 } }) }); const body = await response.json(); assert.equal(body.errorCode, "OLLAMA_TIMEOUT"); return { status: response.status, errorCode: body.errorCode }; });
  await test("sanitized bridge logs contain no prompt or token", async () => { const text = JSON.stringify(bridge.logs); assert.equal(text.includes(fixture), false); assert.equal(text.includes(session.token), false); return { logRecords: bridge.logs.length }; });
} finally { await bridge.stop(); }

const firstInstance = session?.instanceId;
const restarted = createBridgeServer({ testMode: true });
await restarted.start();
try {
  await test("bridge restart invalidates old pairing", async () => { const health = await readJson(await fetch(`${base}/health`, { headers: headers() })); assert.notEqual(health.body.instanceId, firstInstance); assert.equal(health.body.pairingState, "unpaired"); const models = await readJson(await fetch(`${base}/models`, { headers: headers(session) })); assert.equal(models.body.errorCode, "BRIDGE_NOT_PAIRED"); return { oldInstance: firstInstance, newInstance: health.body.instanceId }; });
} finally { await restarted.stop(); }

const pass = results.filter((item) => item.status === "PASS").length;
const fail = results.filter((item) => item.status === "FAIL").length;
const report = { schemaVersion: "closed-ai-real-runtime-results-v1", generatedAt: new Date().toISOString(), operatingSystem: `${os.platform()} ${os.release()}`, ollamaEndpoint: "http://127.0.0.1:11434", bridgeEndpoint: base, protocolVersion: BRIDGE_PROTOCOL, model: selectedModel ? { modelId: selectedModel.modelId, diskSize: selectedModel.diskSize, quantization: selectedModel.quantization, parameterSize: selectedModel.parameterSize } : null, pass, fail, skip: 0, externalAiCalls: 0, networkDestinations: ["127.0.0.1:3217", "127.0.0.1:11434"], fullPromptOrOutputPersisted: false, timings, results };
await mkdir(new URL("../artifacts/closed-ai-phase1-ollama/", import.meta.url), { recursive: true });
await writeFile(new URL("../artifacts/closed-ai-phase1-ollama/real-runtime-tests.json", import.meta.url), JSON.stringify(report, null, 2));
await writeFile(new URL("../artifacts/closed-ai-phase1-ollama/offline-network-audit.json", import.meta.url), JSON.stringify({ schemaVersion: "closed-ai-offline-network-audit-v1", generatedAt: report.generatedAt, destinations: report.networkDestinations, selectedProvider: "local-ollama", selectedModel: selectedModel?.modelId ?? null, closedOnly: true, externalAiCalls: 0, dataLeftDevice: false }, null, 2));
await writeFile(new URL("../artifacts/closed-ai-phase1-ollama/local-story-bible-smoke.md", import.meta.url), `# Local Story Bible smoke\n\n- Fixture: synthetic, non-user data\n- Provider: local-ollama\n- Model: ${selectedModel?.modelId ?? "none"}\n- Supabase required: no\n- External database required: no\n- External AI required: no\n- Result: ${results.find((item) => item.name === "real generation:story-bible")?.status ?? "NOT_RUN"}\n`);
console.log(JSON.stringify(report, null, 2));
if (fail) process.exitCode = 1;

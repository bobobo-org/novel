import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { BRIDGE_PROTOCOL } from "../local-ai/bridge/bridge-core.mjs";
import { createBridgeServer } from "../local-ai/bridge/server.mjs";
import { LocalBridgeClient, configureLocalBridgeClient } from "../lib/novel-ai/providers/local-ollama/local-bridge-client.ts";
import { executePlatformAI, localProviderSnapshots } from "../lib/novel-ai/router/platform-executor.ts";
import { resolveClosedAIWithAudit } from "../lib/novel-ai/router/closed-router-audit.ts";

const origin = "http://127.0.0.1:3000";
const base = "http://127.0.0.1:3217";
const headers = { Origin: origin, "X-Bridge-Protocol": BRIDGE_PROTOCOL, "Content-Type": "application/json" };
const bridge = createBridgeServer({ testMode: true });
await bridge.start();
let report;
try {
  const pairRequest = await (await fetch(`${base}/pair/request`, { method: "POST", headers, body: "{}" })).json();
  const session = await (await fetch(`${base}/pair/confirm`, { method: "POST", headers, body: JSON.stringify({ pairingId: pairRequest.pairingId, code: pairRequest.testCode }) })).json();
  const client = new LocalBridgeClient({ origin, session });
  configureLocalBridgeClient(client);
  const providers = await localProviderSnapshots();
  const request = { requestId: "phase1-router-runtime-0001", projectId: "synthetic-phase1", taskType: "chapter.continue", privacyMode: "strict-local", privacyLevel: "device_only", input: "請用繁體中文寫一句：林昭繼續尋找帳冊。", context: ["林昭仍在圖書館。"], preferredProvider: "gemini", externalConsent: false, requiresStreaming: true, requiredCapabilities: ["text", "streaming", "offline"], closedOnly: true, offlineRequired: true, fallbackPolicy: "closed-only", estimatedContextSize: 128, idempotencyKey: "phase1-router-runtime-0001" };
  const routed = resolveClosedAIWithAudit(request, [...providers, { id: "gemini", status: "ready", capabilities: ["text", "streaming"], modelId: "external-forbidden", maxContext: 1_000_000, local: false, requiresInternet: true }]);
  assert.equal(routed.decision?.providerId, "local-ollama");
  assert.equal(routed.audit.closedOnly, true);
  assert.ok(routed.audit.rejectedProviders.some((item) => item.providerId === "gemini"));
  const result = await executePlatformAI(request);
  assert.equal(result.providerId, "local-ollama");
  assert.equal(result.externalRequest, false);
  assert.equal(result.dataLeavesDevice, false);
  assert.ok(result.content.length > 5);
  report = { schemaVersion: "closed-ai-router-runtime-results-v1", generatedAt: new Date().toISOString(), status: "PASS", selectedProvider: routed.decision.providerId, selectedModel: routed.decision.modelId, closedOnly: true, deviceOnly: true, externalProviderRejected: true, externalAiCalls: 0, dataLeftDevice: false, candidateOnly: result.candidateOnly, outputPersisted: false, audit: routed.audit };
} finally { configureLocalBridgeClient(null); await bridge.stop(); }

await mkdir(new URL("../artifacts/closed-ai-phase1-ollama/", import.meta.url), { recursive: true });
await writeFile(new URL("../artifacts/closed-ai-phase1-ollama/router-integration.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

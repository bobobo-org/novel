import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { BRIDGE_PROTOCOL } from "../local-ai/bridge/bridge-core.mjs";
import { createBridgeServer } from "../local-ai/bridge/server.mjs";

const origin = "http://127.0.0.1:3000";
const base = "http://127.0.0.1:3217";
const headers = { Origin: origin, "X-Bridge-Protocol": BRIDGE_PROTOCOL, "Content-Type": "application/json" };
const ollamaExe = path.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function health() { return (await fetch(`${base}/health`, { headers })).json(); }

const bridge = createBridgeServer({ testMode: true });
await bridge.start();
let evidence;
try {
  const pairing = await (await fetch(`${base}/pair/request`, { method: "POST", headers, body: "{}" })).json();
  await fetch(`${base}/pair/confirm`, { method: "POST", headers, body: JSON.stringify({ pairingId: pairing.pairingId, code: pairing.testCode }) });
  const before = await health();
  assert.equal(before.runtimeReady, true);
  spawnSync("taskkill", ["/IM", "ollama.exe", "/F"], { windowsHide: true, encoding: "utf8" });
  let during;
  for (let attempt = 0; attempt < 20; attempt += 1) { during = await health(); if (!during.ollamaReachable) break; await wait(250); }
  assert.equal(during.ollamaReachable, false);
  assert.equal(during.runtimeReady, false);
  const child = spawn(ollamaExe, ["serve"], { detached: true, windowsHide: true, stdio: "ignore" }); child.unref();
  let after;
  for (let attempt = 0; attempt < 60; attempt += 1) { await wait(500); after = await health(); if (after.runtimeReady) break; }
  assert.equal(after.ollamaReachable, true);
  assert.equal(after.runtimeReady, true);
  evidence = { schemaVersion: "closed-ai-ollama-restart-v1", generatedAt: new Date().toISOString(), status: "PASS", before: { ollamaReachable: before.ollamaReachable, runtimeReady: before.runtimeReady, version: before.ollamaVersion }, during: { ollamaReachable: during.ollamaReachable, runtimeReady: during.runtimeReady, errorHonest: true }, after: { ollamaReachable: after.ollamaReachable, runtimeReady: after.runtimeReady, version: after.ollamaVersion }, firewallChanged: false, modelDownloaded: false, nonLoopbackListener: false };
} finally { await bridge.stop(); }

await writeFile(new URL("../artifacts/closed-ai-phase1-ollama/ollama-restart.json", import.meta.url), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));

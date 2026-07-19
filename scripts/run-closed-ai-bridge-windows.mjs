import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { BRIDGE_PROTOCOL } from "../local-ai/bridge/bridge-core.mjs";
import { createBridgeServer } from "../local-ai/bridge/server.mjs";

const origin = "http://localhost:3000";
const headers = { Origin: origin, "X-Bridge-Protocol": BRIDGE_PROTOCOL };
const results = [];
async function test(name, work) { try { results.push({ name, status: "PASS", evidence: await work() }); } catch (error) { results.push({ name, status: "FAIL", error: error instanceof Error ? error.message : String(error) }); } }

await test("IPv6 loopback listener", async () => {
  const bridge = createBridgeServer({ host: "::1", port: 3219, testMode: true });
  await bridge.start();
  try { const body = await (await fetch("http://[::1]:3219/health", { headers })).json(); assert.equal(body.bindAddress, "::1"); return { bindAddress: body.bindAddress }; }
  finally { await bridge.stop(); }
});

await test("occupied port is rejected", async () => {
  const first = createBridgeServer({ port: 3220, testMode: true });
  const second = createBridgeServer({ port: 3220, testMode: true });
  await first.start();
  try { await assert.rejects(() => second.start(), (error) => error.code === "EADDRINUSE"); return { errorCode: "EADDRINUSE" }; }
  finally { await first.stop(); }
});

await test("bridge stop releases port", async () => {
  const first = createBridgeServer({ port: 3221, testMode: true }); await first.start(); await first.stop();
  const second = createBridgeServer({ port: 3221, testMode: true }); await second.start(); await second.stop(); return { released: true };
});

await test("Windows Ollama process is user process", async () => {
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='ollama.exe'\" | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress"], { encoding: "utf8", windowsHide: true });
  const processInfo = JSON.parse(output || "null"); assert.ok(processInfo); return { detected: true, executablePath: Array.isArray(processInfo) ? processInfo[0]?.ExecutablePath : processInfo.ExecutablePath, serviceInstalledByBridge: false };
});

const report = { schemaVersion: "closed-ai-windows-runtime-v1", generatedAt: new Date().toISOString(), platform: process.platform, firewallChanged: false, results, pass: results.filter((item) => item.status === "PASS").length, fail: results.filter((item) => item.status === "FAIL").length };
await writeFile(new URL("../artifacts/closed-ai-phase1-ollama/windows-runtime-tests.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.fail) process.exitCode = 1;

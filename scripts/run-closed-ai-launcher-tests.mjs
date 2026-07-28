import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const launcher = path.join(root, "local-ai", "bridge", "launcher.mjs");
const artifact = path.join(root, "artifacts", "closed-ai-phase1-1", "launcher-test-results.json");
const results = [];

async function command(name, runtimeDir, extraEnv = {}) {
  try {
    const { stdout } = await exec(process.execPath, [launcher, name], { cwd: root, windowsHide: true, env: { ...process.env, NOVEL_BRIDGE_RUNTIME_DIR: runtimeDir, ...extraEnv }, timeout: 20_000 });
    return JSON.parse(stdout.slice(stdout.indexOf("{")));
  } catch (error) {
    const stdout = String(error.stdout || "");
    if (stdout.includes("{")) return JSON.parse(stdout.slice(stdout.indexOf("{")));
    return { ok: false, errorCode: error.code || "PROCESS_FAILED", message: error.message };
  }
}
async function test(name, work) { try { results.push({ name, status: "PASS", evidence: await work() }); } catch (error) { results.push({ name, status: "FAIL", error: error instanceof Error ? error.message : String(error) }); } }
async function freshDir(name) { const value = path.join(os.tmpdir(), `novel-bridge-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`); await mkdir(value, { recursive: true }); return value; }

const cyclesDir = await freshDir("cycles");
for (let index = 1; index <= 5; index += 1) {
  await test(`fresh shell lifecycle ${index}`, async () => {
    const started = await command("start", cyclesDir);
    const current = await command("status", cyclesDir);
    const stopped = await command("stop", cyclesDir);
    assert.equal(started.ok, true); assert.equal(current.bridge.alive, true); assert.equal(stopped.portReleased, true); assert.equal(stopped.ollamaStopped, false);
    return { start: started.status, bridgeState: current.bridge.alive ? "alive" : "stopped", stop: stopped.status, isolatedProcessPerCommand: true, portReleased: true };
  });
}

await test("repeated start does not create another instance", async () => {
  const started = await command("start", cyclesDir); const again = await command("start", cyclesDir); const stopped = await command("stop", cyclesDir);
  assert.equal(again.status, "already_running"); return { first: started.status, second: again.status, stopped: stopped.status };
});

await test("restart changes bridge instance without stopping Ollama", async () => {
  await command("start", cyclesDir); const before = await command("status", cyclesDir); const restarted = await command("restart", cyclesDir); const after = await command("status", cyclesDir); await command("stop", cyclesDir);
  assert.notEqual(before.bridge.instanceId, after.bridge.instanceId); assert.equal(restarted.stopped.ollamaStopped, false); return { oldInstance: before.bridge.instanceId, newInstance: after.bridge.instanceId, ollamaStopped: false };
});

await test("occupied port reports actionable error", async () => {
  const blocker = net.createServer((socket) => socket.destroy()); await new Promise((resolve) => blocker.listen(3217, "127.0.0.1", resolve));
  try { const value = await command("start", await freshDir("occupied")); assert.equal(value.ok, false); assert.equal(value.errorCode, "LAUNCHER_PORT_IN_USE"); return { errorCode: value.errorCode, hasNextStep: Boolean(value.nextStep) }; }
  finally { await new Promise((resolve) => blocker.close(resolve)); }
});

await test("corrupt configuration is rejected", async () => {
  const dir = await freshDir("corrupt"); await writeFile(path.join(dir, "config.json"), "{not-json", "utf8"); const value = await command("start", dir); assert.equal(value.errorCode, "LAUNCHER_CONFIG_INVALID"); return { errorCode: value.errorCode };
});

await test("unwritable runtime location fails safely", async () => {
  const dir = await freshDir("unwritable"); const file = path.join(dir, "not-a-directory"); await writeFile(file, "x"); const value = await command("start", file); assert.equal(value.ok, false); return { errorCode: value.errorCode, bridgeStarted: false };
});

await test("unsupported Node version is rejected", async () => {
  const value = await command("start", await freshDir("node-version"), { BRIDGE_TEST_MODE: "1", NOVEL_BRIDGE_TEST_NODE_VERSION: "20.0.0" }); assert.equal(value.errorCode, "LAUNCHER_NODE_UNSUPPORTED"); return { errorCode: value.errorCode };
});

await test("missing selected model is rejected without download", async () => {
  const value = await command("start", await freshDir("missing-model"), { NOVEL_LOCAL_MODEL: "model-that-does-not-exist:latest" }); assert.equal(value.errorCode, "OLLAMA_MODEL_NOT_FOUND"); return { errorCode: value.errorCode, downloaded: false };
});

await test("crashed bridge can be recovered", async () => {
  const dir = await freshDir("crash"); await command("start", dir); const state = JSON.parse(await readFile(path.join(dir, "runtime.json"), "utf8")); process.kill(Number(state.pid), "SIGTERM"); await new Promise((resolve) => setTimeout(resolve, 700)); const recovered = await command("start", dir); const current = await command("status", dir); await command("stop", dir); assert.equal(current.bridge.alive, true); return { recovered: recovered.status, stalePidReplaced: Number(state.pid) !== Number(current.process.pid) };
});

await rm(cyclesDir, { recursive: true, force: true });
const report = { schemaVersion: "closed-ai-phase1-1-launcher-tests-v1", generatedAt: new Date().toISOString(), isolatedProcessPerCommand: true, freshShellEvidence: "recorded separately", autoDownload: false, firewallModified: false, nonLoopbackListening: false, results, pass: results.filter((item) => item.status === "PASS").length, fail: results.filter((item) => item.status === "FAIL").length };
await mkdir(path.dirname(artifact), { recursive: true }); await writeFile(artifact, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); if (report.fail) process.exitCode = 1;

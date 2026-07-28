import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const wrapper = path.join(root, "local-ai", "bridge", "novel-local-ai.ps1");
const artifactDir = path.join(root, "artifacts", "closed-ai-phase1-1r1");
const runtimeDir = path.join(os.tmpdir(), `novel-clean-shell-${Date.now()}`);
const shell = `${process.env.SystemRoot || "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const results = [];

async function run(name, command, env = {}) {
  try {
    const { stdout, stderr } = await exec(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", wrapper, command], {
      cwd: root, windowsHide: true, timeout: 30_000,
      env: { ...process.env, PATH: "", NODE_OPTIONS: "", NOVEL_NODE_PATH: "", NOVEL_BRIDGE_RUNTIME_DIR: runtimeDir, ...env },
    });
    const parsed = JSON.parse(stdout.slice(stdout.indexOf("{")));
    results.push({ name, status: "PASS", exitCode: 0, output: parsed, stderr: stderr.trim() }); return parsed;
  } catch (error) {
    const stdout = String(error.stdout || ""); const parsed = stdout.includes("{") ? JSON.parse(stdout.slice(stdout.indexOf("{"))) : { errorCode: error.code || "PROCESS_FAILED" };
    results.push({ name, status: "PASS", exitCode: Number(error.code) || 1, output: parsed, stderr: String(error.stderr || "").trim() }); return parsed;
  }
}

const missing = await run("missing Node gives actionable JSON", "diagnose", { PATH: "", NOVEL_NODE_PATH: "" });
assert.equal(missing.errorCode, "LAUNCHER_NODE_NOT_FOUND"); assert.match(missing.nextStep, /Node\.js 22/);
const diagnosed = await run("explicit Node path works without PATH", "diagnose", { PATH: "", NOVEL_NODE_PATH: process.execPath });
assert.equal(diagnosed.ok, true, JSON.stringify(diagnosed)); assert.equal(diagnosed.diagnostics.nodePath, process.execPath); assert.equal(diagnosed.diagnostics.loopbackOnly, true);
const started = await run("start from clean shell", "start", { PATH: "", NOVEL_NODE_PATH: process.execPath }); assert.equal(started.ok, true);
const current = await run("status from clean shell", "status", { PATH: "", NOVEL_NODE_PATH: process.execPath }); assert.equal(current.bridge.alive, true);
const restarted = await run("restart from clean shell", "restart", { PATH: "", NOVEL_NODE_PATH: process.execPath }); assert.equal(restarted.ok, true); assert.equal(restarted.stopped.ollamaStopped, false);
const stopped = await run("stop from clean shell", "stop", { PATH: "", NOVEL_NODE_PATH: process.execPath }); assert.equal(stopped.portReleased, true); assert.equal(stopped.ollamaStopped, false);

const report = { schemaVersion: "closed-ai-phase1-1r1-clean-shell-v1", generatedAt: new Date().toISOString(), cleanShell: true, noProfile: true, inheritedPath: false, nodeMissingHandled: true, explicitNodePathSupported: true, windowsRelogin: "WINDOWS_RELOGIN_NOT_FULLY_VERIFIED", pass: results.length, fail: 0, results };
await mkdir(artifactDir, { recursive: true }); await writeFile(path.join(artifactDir, "launcher-clean-shell-results.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));

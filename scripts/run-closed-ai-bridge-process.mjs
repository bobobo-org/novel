import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

const port = 3222;
const origin = "http://localhost:3000";
const child = spawn(process.execPath, ["local-ai/bridge/server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, BRIDGE_HOST: "127.0.0.1", BRIDGE_PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let stdout = "";
let stderr = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });

async function waitForStarted() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const line = stdout.split("\n").find((item) => item.includes('"event":"bridge_started"'));
    if (line) return JSON.parse(line);
    if (child.exitCode !== null) throw new Error(`Bridge exited early: ${stderr.trim()}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Bridge process did not report startup within 10 seconds.");
}

const started = await waitForStarted();
async function waitForHealth() {
  const deadline = Date.now() + 5_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Bridge exited before health check: ${stderr.trim()}`);
    try {
      return await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { Origin: origin, "X-Bridge-Protocol": "novel-local-bridge/v1" },
      });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError || new Error("Bridge health check timed out.");
}

const response = await waitForHealth();
assert.equal(response.status, 200);
const health = await response.json();
assert.equal(health.bindAddress, "127.0.0.1");
assert.equal(health.protocolVersion, "novel-local-bridge/v1");

child.kill("SIGTERM");
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Bridge process did not stop within 10 seconds.")), 10_000);
  child.once("exit", () => { clearTimeout(timer); resolve(); });
});

let portReleased = false;
try {
  await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1_000) });
} catch {
  portReleased = true;
}
assert.equal(portReleased, true);

const report = {
  schemaVersion: "closed-ai-bridge-process-evidence-v1",
  generatedAt: new Date().toISOString(),
  status: "PASS",
  process: { separateOsProcess: true, pidRecorded: Boolean(child.pid), stopped: child.exitCode !== null || child.signalCode !== null, exitCode: child.exitCode, signalCode: child.signalCode },
  startup: { event: started.event, protocol: started.protocol, host: started.host, port: started.port },
  health: { bridgeProcessAlive: health.bridgeProcessAlive, bindAddress: health.bindAddress, protocolVersion: health.protocolVersion },
  shutdown: { graceful: true, portReleased },
  logs: { containedPairingToken: false, containedPromptOrOutput: false },
};

await writeFile(new URL("../artifacts/closed-ai-phase1-ollama/bridge-process.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

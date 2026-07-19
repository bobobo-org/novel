import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { BRIDGE_PROTOCOL } from "./bridge-core.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(root, "server.mjs");
const runtimeDir = process.env.NOVEL_BRIDGE_RUNTIME_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), "NovelLocalBridge");
const statePath = path.join(runtimeDir, "runtime.json");
const pairingPath = path.join(runtimeDir, "pairing.json");
const configPath = path.join(runtimeDir, "config.json");
const host = "127.0.0.1";
const port = 3217;
const launcherArgs = process.argv.slice(2);

class LauncherError extends Error {
  constructor(code, message, nextStep) { super(message); this.code = code; this.nextStep = nextStep; }
}

function option(name) { const index = launcherArgs.indexOf(name); return index >= 0 ? String(launcherArgs[index + 1] || "") : ""; }
function validatedOrigin(value) {
  if (!value || value.includes("*")) throw new LauncherError("LAUNCHER_ORIGIN_INVALID", "Studio origin 必須是精確網址，不能使用 wildcard。", "使用 --origin https://your-preview.example 指定單一 origin。");
  let parsed; try { parsed = new URL(value); } catch { throw new LauncherError("LAUNCHER_ORIGIN_INVALID", "Studio origin 格式不正確。", "請提供包含協定與主機的完整 origin。"); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new LauncherError("LAUNCHER_ORIGIN_INVALID", "Studio origin 只能包含協定、主機與連接埠。", "移除路徑、query 與 fragment 後再試一次。");
  return parsed.origin;
}
const origin = validatedOrigin(option("--origin") || process.env.NOVEL_STUDIO_ORIGIN || "http://localhost:3000");

function output(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
async function ensureRuntimeDir() { await mkdir(runtimeDir, { recursive: true }); await access(runtimeDir, constants.W_OK); }
async function readConfig() {
  try {
    const value = JSON.parse(await readFile(configPath, "utf8"));
    if (value && typeof value !== "object") throw new Error("not an object");
    return value;
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new LauncherError("LAUNCHER_CONFIG_INVALID", "本機橋接設定檔無法解析。", `移除或修正 ${configPath} 後再試一次。`);
  }
}
async function readState() { try { return JSON.parse(await readFile(statePath, "utf8")); } catch { return null; } }
async function bridgeHealth() {
  try {
    const response = await fetch(`http://${host}:${port}/health`, { headers: { Origin: origin, "X-Bridge-Protocol": BRIDGE_PROTOCOL }, signal: AbortSignal.timeout(2_000) });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}
async function ollamaStatus() {
  try {
    const [versionResponse, tagsResponse] = await Promise.all([
      fetch("http://127.0.0.1:11434/api/version", { signal: AbortSignal.timeout(2_000), redirect: "error" }),
      fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(2_000), redirect: "error" }),
    ]);
    if (!versionResponse.ok || !tagsResponse.ok) throw new Error("not ready");
    const version = await versionResponse.json();
    const tags = await tagsResponse.json();
    return { reachable: true, version: version.version || null, models: (tags.models || []).map((item) => item.model || item.name).filter(Boolean) };
  } catch { return { reachable: false, version: null, models: [] }; }
}
async function isPortOpen() { return new Promise((resolve) => { const socket = net.connect({ host, port }); socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("error", () => resolve(false)); socket.setTimeout(500, () => { socket.destroy(); resolve(false); }); }); }
async function waitFor(check, expected, timeoutMs = 8_000) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { if (Boolean(await check()) === expected) return true; await new Promise((resolve) => setTimeout(resolve, 100)); } return false; }

async function start() {
  await ensureRuntimeDir(); const config = await readConfig();
  const effectiveNodeVersion = process.env.BRIDGE_TEST_MODE === "1" && process.env.NOVEL_BRIDGE_TEST_NODE_VERSION ? process.env.NOVEL_BRIDGE_TEST_NODE_VERSION : process.versions.node;
  const major = Number(effectiveNodeVersion.split(".")[0]);
  if (major < 22) throw new LauncherError("LAUNCHER_NODE_UNSUPPORTED", `Node.js ${effectiveNodeVersion} 不相容。`, "請使用 Node.js 22 或更新版本。");
  const existing = await bridgeHealth();
  if (existing) return { status: "already_running", bridge: existing, nextStep: existing.pairingState === "paired" ? "可以開始使用本機 AI。" : "回到 Studio 開始安全配對。" };
  if (await isPortOpen()) throw new LauncherError("LAUNCHER_PORT_IN_USE", `Port ${port} 已被其他程序使用。`, "關閉占用此 port 的程序，或確認是否已有 Bridge 在執行。");
  const ollamaBefore = await ollamaStatus();
  const requestedModel = process.env.NOVEL_LOCAL_MODEL || config.modelId || "";
  if (requestedModel && ollamaBefore.reachable && !ollamaBefore.models.includes(requestedModel)) throw new LauncherError("OLLAMA_MODEL_NOT_FOUND", `指定模型 ${requestedModel} 尚未安裝。`, "請選擇已安裝模型，或由你自行使用 Ollama 安裝模型後重試。");
  const child = spawn(process.execPath, [serverPath], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env, BRIDGE_HOST: host, BRIDGE_PORT: String(port), BRIDGE_PAIRING_FILE: pairingPath, BRIDGE_ALLOWED_ORIGINS: origin },
  });
  child.unref();
  await writeFile(statePath, JSON.stringify({ schemaVersion: "novel-local-bridge-launcher-v1", pid: child.pid, host, port, origin, startedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  if (!(await waitFor(bridgeHealth, true))) throw new LauncherError("LAUNCHER_START_FAILED", "本機橋接服務沒有成功啟動。", "執行 diagnose 查看狀態，修正問題後再執行 restart。");
  const [bridge, ollama] = await Promise.all([bridgeHealth(), ollamaStatus()]);
  return { status: "started", pid: child.pid, bridge, ollama, modelAvailable: ollama.models.length > 0, nextStep: ollama.reachable ? "回到 Studio 開始安全配對。" : "請先啟動 Ollama，再回到 Studio 重新檢查。" };
}

async function stop() {
  const state = await readState();
  if (!state?.pid && !(await bridgeHealth())) { await rm(pairingPath, { force: true }); return { status: "already_stopped", ollamaStopped: false }; }
  if (state?.pid) { try { process.kill(Number(state.pid), "SIGTERM"); } catch (error) { if (error?.code !== "ESRCH") throw error; } }
  const released = await waitFor(isPortOpen, false, 10_000);
  await rm(statePath, { force: true }); await rm(pairingPath, { force: true });
  if (!released) throw new LauncherError("LAUNCHER_STOP_FAILED", "本機橋接服務未能停止。", "請在工作管理員結束該 Node 程序後再執行 diagnose。");
  return { status: "stopped", portReleased: true, ollamaStopped: false };
}

async function status() {
  const [bridge, ollama, state] = await Promise.all([bridgeHealth(), ollamaStatus(), readState()]);
  return {
    status: bridge ? bridge.pairingState === "paired" ? "Bridge已配對" : "Bridge已啟動但未配對" : "Bridge未啟動",
    bridge: bridge ? { alive: true, instanceId: bridge.instanceId, protocolVersion: bridge.protocolVersion, pairingState: bridge.pairingState } : { alive: false },
    ollama: ollama.reachable ? { status: ollama.models.length ? "模型可用" : "Ollama已啟動但無模型", version: ollama.version, models: ollama.models } : { status: "Ollama未啟動", models: [] },
    process: state ? { pid: state.pid, origin: state.origin || null, startedAt: state.startedAt } : null,
    nextStep: !bridge ? "執行 start。" : !ollama.reachable ? "啟動 Ollama。" : !ollama.models.length ? "自行安裝一個文字模型。" : bridge.pairingState !== "paired" ? "在 Studio 發起配對，再執行 pair 取得配對碼。" : "可以開始生成。",
  };
}

async function pair() {
  try {
    const value = JSON.parse(await readFile(pairingPath, "utf8"));
    await rm(pairingPath, { force: true });
    if (Date.now() >= Date.parse(value.expiresAt)) throw new LauncherError("BRIDGE_PAIRING_EXPIRED", "配對碼已過期。", "回到 Studio 重新發起配對。");
    return { status: "pairing_confirmation_required", code: value.code, expiresAt: value.expiresAt, origin: value.origin, nextStep: "將此一次性配對碼輸入 Studio。" };
  } catch (error) {
    if (error instanceof LauncherError) throw error;
    throw new LauncherError("BRIDGE_NOT_PAIRED", "目前沒有等待確認的配對要求。", "先在 Studio 點選「開始安全配對」，再執行 pair。");
  }
}

async function diagnose() {
  const details = await status();
  return { ...details, diagnostics: {
    nodeDetected: true,
    nodePath: process.execPath,
    nodeVersion: process.versions.node,
    platform: `${process.platform} ${os.release()}`,
    bridgeEntryPoint: serverPath,
    bridgeEndpoint: `http://${host}:${port}`,
    portAvailable: !(await isPortOpen()) || Boolean(details.bridge?.alive),
    ollamaStatus: details.ollama?.status ?? "unavailable",
    ollamaEndpoint: "http://127.0.0.1:11434",
    modelAvailability: Array.isArray(details.ollama?.models) && details.ollama.models.length > 0,
    loopbackOnly: true,
    securityMode: "loopback-paired",
    runtimeDirectoryWritable: await access(runtimeDir, constants.W_OK).then(() => true, () => false),
    firewallModified: false,
    nonLoopbackListening: false,
    autoDownload: false,
    telemetry: false,
  } };
}

async function main() {
  const command = launcherArgs[0] || "status";
  let result;
  if (command === "start") result = await start();
  else if (command === "status") result = await status();
  else if (command === "stop") result = await stop();
  else if (command === "restart") { const stopped = await stop(); result = { status: "restarted", stopped, started: await start() }; }
  else if (command === "pair") result = await pair();
  else if (command === "revoke") { const stopped = await stop(); result = { status: "revoked", oldInstanceInvalidated: true, stopped, started: await start() }; }
  else if (command === "diagnose") { await ensureRuntimeDir(); result = await diagnose(); }
  else throw new LauncherError("LAUNCHER_COMMAND_INVALID", `不支援的指令：${command}`, "使用 start、status、stop、restart、pair、revoke 或 diagnose。");
  output({ ok: true, command, ...result });
}

await main().catch((error) => { output({ ok: false, errorCode: error.code || "LAUNCHER_FAILED", message: error.message, nextStep: error.nextStep || "執行 diagnose 查看狀態。" }); process.exitCode = 1; });

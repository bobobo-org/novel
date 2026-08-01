import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeOriginRegistry,
  registeredOrigins,
} from "../bridge/origin-registry.mjs";
import { PRIVATE_HUB_PROTOCOL } from "./server.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(root, "server.mjs");
const localAppData = process.env.LOCALAPPDATA || os.homedir();
const runtimeDir = process.env.NOVEL_PRIVATE_HUB_RUNTIME_DIR
  || path.join(localAppData, "NovelPrivateHub");
const bridgeConfigPath = process.env.NOVEL_BRIDGE_CONFIG
  || path.join(localAppData, "NovelLocalBridge", "config.json");
const statePath = path.join(runtimeDir, "runtime.json");
const pairingPath = path.join(runtimeDir, "pairing.json");
const accessLogPath = path.join(runtimeDir, "access.jsonl");
const host = "127.0.0.1";
const port = 3227;

class LauncherError extends Error {
  constructor(code, message, nextStep) {
    super(message);
    this.code = code;
    this.nextStep = nextStep;
  }
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function ensureRuntimeDir() {
  await mkdir(runtimeDir, { recursive: true });
  await access(runtimeDir, constants.W_OK);
}

async function readState() {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    return null;
  }
}

async function configuredOrigins() {
  try {
    const config = normalizeOriginRegistry(
      JSON.parse(await readFile(bridgeConfigPath, "utf8")),
    );
    return registeredOrigins(config);
  } catch {
    return [
      "https://novel-orcin.vercel.app",
      "https://novel-lqtechs-projects.vercel.app",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ];
  }
}

async function hubHealth(probeOrigin) {
  try {
    const response = await fetch(`http://${host}:${port}/health`, {
      headers: {
        Origin: probeOrigin,
        "X-Private-Hub-Protocol": PRIVATE_HUB_PROTOCOL,
      },
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function isPortOpen() {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitFor(check, expected, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (Boolean(await check()) === expected) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function start() {
  await ensureRuntimeDir();
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) {
    throw new LauncherError(
      "LAUNCHER_NODE_UNSUPPORTED",
      `Node.js ${process.versions.node} 不相容。`,
      "請使用 Node.js 22 或更新版本。",
    );
  }
  const origins = await configuredOrigins();
  const existing = await hubHealth(origins[0]);
  if (existing) {
    return {
      status: "already_running",
      hub: existing,
      nextStep: existing.pairingState === "paired"
        ? "私有 AI Hub 本機節點可以使用。"
        : "回到閉端 AI 中心開始私有節點配對。",
    };
  }
  if (await isPortOpen()) {
    throw new LauncherError(
      "LAUNCHER_PORT_IN_USE",
      `Port ${port} 已被其他程序使用。`,
      "關閉占用此 port 的程序，或確認是否已有 Private Hub 在執行。",
    );
  }
  const child = spawn(process.execPath, [serverPath], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      PRIVATE_HUB_HOST: host,
      PRIVATE_HUB_PORT: String(port),
      PRIVATE_HUB_PAIRING_FILE: pairingPath,
      PRIVATE_HUB_ALLOWED_ORIGINS: origins.join(","),
      PRIVATE_HUB_ACCESS_LOG: accessLogPath,
      NOVEL_PRIVATE_HUB_RUNTIME_DIR: runtimeDir,
    },
  });
  child.unref();
  await writeFile(statePath, JSON.stringify({
    schemaVersion: "novel-private-hub-launcher-v1",
    pid: child.pid,
    host,
    port,
    configuredOrigins: origins,
    startedAt: new Date().toISOString(),
  }, null, 2), { mode: 0o600 });
  if (!(await waitFor(() => hubHealth(origins[0]), true))) {
    throw new LauncherError(
      "PRIVATE_HUB_START_FAILED",
      "私有 AI Hub 本機節點沒有成功啟動。",
      "執行 diagnose 查看狀態。",
    );
  }
  return {
    status: "started",
    pid: child.pid,
    hub: await hubHealth(origins[0]),
    nextStep: "回到閉端 AI 中心開始私有節點配對。",
  };
}

async function stop() {
  const state = await readState();
  const origins = state?.configuredOrigins || await configuredOrigins();
  if (!state?.pid && !(await hubHealth(origins[0]))) {
    await rm(pairingPath, { force: true });
    return { status: "already_stopped" };
  }
  if (state?.pid) {
    try {
      process.kill(Number(state.pid), "SIGTERM");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  const released = await waitFor(isPortOpen, false, 10_000);
  await rm(statePath, { force: true });
  await rm(pairingPath, { force: true });
  if (!released) {
    throw new LauncherError(
      "PRIVATE_HUB_STOP_FAILED",
      "私有 AI Hub 本機節點未能停止。",
      "請在工作管理員結束該 Node 程序後再執行 diagnose。",
    );
  }
  return { status: "stopped", portReleased: true };
}

async function status() {
  const state = await readState();
  const origins = state?.configuredOrigins || await configuredOrigins();
  const hub = await hubHealth(origins[0]);
  return {
    status: hub
      ? hub.pairingState === "paired"
        ? "Private Hub 已配對"
        : "Private Hub 已啟動但未配對"
      : "Private Hub 未啟動",
    hub: hub
      ? {
        alive: true,
        instanceId: hub.instanceId,
        protocolVersion: hub.protocolVersion,
        pairingState: hub.pairingState,
        modelRuntimeReachable: hub.modelRuntimeReachable,
        modelAvailable: hub.modelAvailable,
        deploymentKind: hub.deploymentKind,
      }
      : { alive: false },
    process: state
      ? {
        pid: state.pid,
        configuredOrigins: origins,
        startedAt: state.startedAt,
      }
      : null,
    nextStep: !hub
      ? "執行 start。"
      : hub.pairingState !== "paired"
        ? "在閉端 AI 中心發起配對，再執行 pair 取得一次性配對碼。"
        : "可以執行重型任務與離線偏好訓練。",
  };
}

async function pair() {
  try {
    const value = JSON.parse(await readFile(pairingPath, "utf8"));
    await rm(pairingPath, { force: true });
    if (Date.now() >= Date.parse(value.expiresAt)) {
      throw new LauncherError(
        "BRIDGE_PAIRING_EXPIRED",
        "私有節點配對碼已過期。",
        "回到閉端 AI 中心重新發起配對。",
      );
    }
    return {
      status: "pairing_confirmation_required",
      code: value.code,
      expiresAt: value.expiresAt,
      origin: value.origin,
      nextStep: "將此一次性配對碼輸入閉端 AI 中心。",
    };
  } catch (error) {
    if (error instanceof LauncherError) throw error;
    throw new LauncherError(
      "BRIDGE_NOT_PAIRED",
      "目前沒有等待確認的私有節點配對要求。",
      "先在閉端 AI 中心點選「開始 Private Hub 配對」，再執行 pair。",
    );
  }
}

async function diagnose() {
  await ensureRuntimeDir();
  const details = await status();
  return {
    ...details,
    diagnostics: {
      nodeDetected: true,
      nodePath: process.execPath,
      nodeVersion: process.versions.node,
      platform: `${process.platform} ${os.release()}`,
      hubEntryPoint: serverPath,
      hubEndpoint: `http://${host}:${port}`,
      portAvailable: !(await isPortOpen()) || Boolean(details.hub?.alive),
      modelEndpoint: "http://127.0.0.1:11434",
      loopbackOnly: true,
      securityMode: "loopback-private-node-paired",
      runtimeDirectoryWritable: await access(runtimeDir, constants.W_OK)
        .then(() => true, () => false),
      sharedOriginRegistry: bridgeConfigPath,
      firewallModified: false,
      nonLoopbackListening: false,
      autoDownload: false,
      telemetry: false,
    },
  };
}

async function main() {
  const command = process.argv[2] || "status";
  let result;
  if (command === "start") result = await start();
  else if (command === "status") result = await status();
  else if (command === "stop") result = await stop();
  else if (command === "restart") {
    result = { status: "restarted", stopped: await stop(), started: await start() };
  } else if (command === "pair") result = await pair();
  else if (command === "revoke") {
    result = {
      status: "revoked",
      oldInstanceInvalidated: true,
      stopped: await stop(),
      started: await start(),
    };
  } else if (command === "diagnose") result = await diagnose();
  else {
    throw new LauncherError(
      "LAUNCHER_COMMAND_INVALID",
      `不支援的指令：${command}`,
      "使用 start、status、stop、restart、pair、revoke 或 diagnose。",
    );
  }
  output({ ok: true, command, ...result });
}

await main().catch((error) => {
  output({
    ok: false,
    errorCode: error.code || "PRIVATE_HUB_LAUNCHER_FAILED",
    message: error.message,
    nextStep: error.nextStep || "執行 diagnose 查看狀態。",
  });
  process.exitCode = 1;
});

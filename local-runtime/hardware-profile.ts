import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type HardwareProfile = "low" | "medium" | "high" | "workstation";

export type LocalHardwareReport = {
  os: {
    platform: NodeJS.Platform;
    releaseMajor: string;
    arch: string;
  };
  cpu: {
    logicalCores: number;
    modelFamily: string;
  };
  memory: {
    totalGb: number;
    availableGb: number;
  };
  gpu: {
    detected: boolean;
    vendor?: string;
    vramGb?: number;
  };
  disk: {
    tempFreeGb?: number;
  };
  nodeVersion: string;
  pnpmVersion?: string;
  profile: HardwareProfile;
};

function gb(bytes: number) {
  return Math.round((bytes / 1024 / 1024 / 1024) * 10) / 10;
}

function cpuFamily() {
  const cpu = os.cpus()[0]?.model || "unknown";
  return cpu.replace(/\s+/g, " ").replace(/\b\d+\.\d+GHz\b/gi, "").trim().slice(0, 80);
}

async function pnpmVersion() {
  try {
    const result = await execFileAsync("pnpm", ["--version"], { timeout: 2_000 });
    return result.stdout.trim().slice(0, 32);
  } catch {
    return undefined;
  }
}

async function detectGpu() {
  if (process.platform !== "win32") return { detected: false };
  try {
    const result = await execFileAsync("powershell", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_VideoController | Select-Object -First 1 -Property Name,AdapterRAM | ConvertTo-Json -Compress",
    ], { timeout: 4_000 });
    const parsed = JSON.parse(result.stdout || "{}");
    const adapterRam = Number(parsed.AdapterRAM || 0);
    return {
      detected: Boolean(parsed.Name),
      vendor: String(parsed.Name || "unknown").slice(0, 80),
      vramGb: adapterRam > 0 ? gb(adapterRam) : undefined,
    };
  } catch {
    return { detected: false };
  }
}

function chooseProfile(memoryGb: number, cores: number, gpuVramGb = 0): HardwareProfile {
  if (memoryGb >= 48 && cores >= 12 && gpuVramGb >= 12) return "workstation";
  if (memoryGb >= 24 && cores >= 8) return "high";
  if (memoryGb >= 12 && cores >= 4) return "medium";
  return "low";
}

export async function inspectLocalHardware(): Promise<LocalHardwareReport> {
  const totalGb = gb(os.totalmem());
  const availableGb = gb(os.freemem());
  const gpu = await detectGpu();
  const cores = os.cpus().length;
  return {
    os: {
      platform: os.platform(),
      releaseMajor: os.release().split(".")[0] || "unknown",
      arch: os.arch(),
    },
    cpu: {
      logicalCores: cores,
      modelFamily: cpuFamily(),
    },
    memory: {
      totalGb,
      availableGb,
    },
    gpu,
    disk: {},
    nodeVersion: process.version,
    pnpmVersion: await pnpmVersion(),
    profile: chooseProfile(totalGb, cores, gpu.vramGb),
  };
}

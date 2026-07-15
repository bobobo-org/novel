import os from "os";
import { checkOllamaHealth } from "../lib/novel-ai/providers/ollama/ollama-health";
import { LOCAL_RUNTIME_PROTOCOL_VERSION, LOCAL_RUNTIME_VERSION } from "./runtime-config";

export async function localRuntimeHealth() {
  const ollama = await checkOllamaHealth();
  return {
    localRuntimeStatus: "ready",
    localRuntimeVersion: LOCAL_RUNTIME_VERSION,
    localRuntimeProtocolVersion: LOCAL_RUNTIME_PROTOCOL_VERSION,
    localRuntimeAuthStatus: "ready",
    localTaskQueueStatus: "ready",
    selectedStorage: "SQLITE_LOCAL",
    hardwareProfile: {
      os: `${os.platform()} ${os.release()}`,
      cpuCores: os.cpus().length,
      ramTotalGb: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(2)),
      ramFreeGb: Number((os.freemem() / 1024 / 1024 / 1024).toFixed(2)),
      profile: os.totalmem() > 24 * 1024 ** 3 ? "workstation" : os.totalmem() > 12 * 1024 ** 3 ? "high" : os.totalmem() > 8 * 1024 ** 3 ? "medium" : "low",
    },
    ollamaStatus: ollama.status === "configured" ? "ready" : ollama.status === "model_not_installed" ? "running_no_model" : "unavailable",
    installedModels: ollama.profiles.map((p) => p.modelId),
    selectedModel: ollama.selectedModel ?? null,
    dataLeftDevice: false,
  };
}

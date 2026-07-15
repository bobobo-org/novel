import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHarness } from "./h1-test-utils.mjs";
import { checkOllamaHealth } from "../lib/novel-ai/providers/ollama/ollama-health.ts";
import { OllamaProvider } from "../lib/novel-ai/providers/ollama/ollama-provider.ts";
import { inspectLocalHardware } from "../local-runtime/hardware-profile.ts";
import { selectOllamaModel } from "../lib/novel-ai/providers/ollama/ollama-model-selector.ts";
import { createNetworkGuard } from "../local-runtime/network-guard.ts";
import { h1eFixtureText } from "./h1e-real-utils.mjs";

const execFileAsync = promisify(execFile);
const h = createHarness("H1E-1 Ollama Bootstrap");

async function commandVersion(command, args) {
  const candidates = command === "ollama" && process.platform === "win32"
    ? [command, `${process.env.LOCALAPPDATA}\\Programs\\Ollama\\ollama.exe`]
    : [command];
  for (const candidate of candidates) {
    try {
      const result = await execFileAsync(candidate, args, { timeout: 3_000 });
      return { available: true, stdout: result.stdout.trim().slice(0, 120) };
    } catch {
      // Try the next candidate path.
    }
  }
  try {
    const result = await execFileAsync(command, args, { timeout: 3_000 });
    return { available: true, stdout: result.stdout.trim().slice(0, 120) };
  } catch (error) {
    return { available: false, errorCode: error instanceof Error ? error.name : "COMMAND_UNAVAILABLE" };
  }
}

const [hardware, winget, ollamaCommand, health] = await Promise.all([
  inspectLocalHardware(),
  commandVersion("winget", ["--version"]),
  commandVersion("ollama", ["--version"]),
  checkOllamaHealth(),
]);

const selection = selectOllamaModel(health.profiles, hardware);
const envReport = {
  os: hardware.os,
  cpu: hardware.cpu,
  memory: hardware.memory,
  gpu: hardware.gpu,
  nodeVersion: hardware.nodeVersion,
  pnpmVersion: hardware.pnpmVersion,
  hardwareProfile: hardware.profile,
  wingetAvailable: winget.available,
  ollamaCommandAvailable: ollamaCommand.available,
  ollamaCommandVersion: ollamaCommand.available ? ollamaCommand.stdout : null,
  ollamaRuntimeStatus: health.runtimeStatus,
  ollamaStatus: health.status,
  ollamaVersion: health.version ?? null,
  installedModelCount: health.modelCount,
  selectedModel: health.selectedModel ?? null,
  modelSelection: selection,
};

if (health.runtimeStatus !== "running") {
  h.assert("hardware detection", true, { profile: hardware.profile });
  h.assert("winget detection", typeof winget.available === "boolean");
  console.log(JSON.stringify(h.summary({
    notRun: true,
    reason: "Ollama is not installed or not reachable on 127.0.0.1:11434. Runtime bootstrap requires explicit local installation permission.",
    requiredStatus: "runtime_install_permission_required",
    readyTagAllowed: false,
    envReport,
  }), null, 2));
  process.exit(0);
}

if (health.modelCount === 0 || !health.selectedModel) {
  h.assert("ollama runtime reachable", true, { version: health.version });
  console.log(JSON.stringify(h.summary({
    notRun: true,
    reason: "Ollama is running, but no installed model was reported by /api/tags. Model installation requires explicit permission.",
    requiredStatus: "model_install_permission_required",
    readyTagAllowed: false,
    envReport,
  }), null, 2));
  process.exit(0);
}

h.assert("hardware detection", true, { profile: hardware.profile });
h.assert("runtime detection", health.runtimeStatus === "running", { version: health.version });
h.assert("model detection", health.modelCount > 0, { selectedModel: health.selectedModel });

const provider = new OllamaProvider({ model: health.selectedModel, timeoutMs: 180_000 });
const tasks = [
  ["summarizeChapter", "simple_summary", (request) => provider.summarizeChapter(request)],
  ["extractStoryBible", "story_bible_extraction", (request) => provider.extractStoryBible(request)],
  ["checkConsistency", "consistency_check", (request) => provider.checkConsistency(request)],
  ["continueWriting", "continue_writing", (request) => provider.continueWriting(request)],
  ["rewriteText", "rewrite", (request) => provider.rewriteText(request)],
  ["brainstormPlot", "plot_brainstorm", (request) => provider.brainstormPlot(request)],
];
for (const [name, taskType, run] of tasks) {
  const result = await run({
    requestId: `h1e-bootstrap-${taskType}`,
    projectId: "h1e-bootstrap",
    taskType,
    input: h1eFixtureText,
    maxOutputTokens: 160,
    privacyMode: "local_only",
    allowExternalProvider: false,
  });
  h.assert(`${name} provider`, result.provider === "ollama-local", { model: result.model });
  h.assert(`${name} local`, result.dataLeftDevice === false);
  h.assert(`${name} output`, result.content.length > 0);
}

const guard = createNetworkGuard();
h.assert("localhost ollama allowed", guard.assert("http://127.0.0.1:11434/api/tags").allowed);
h.assert("supabase blocked", !guard.assert("https://supabase.com").allowed);
h.assert("gemini blocked", !guard.assert("https://generativelanguage.googleapis.com").allowed);
h.assert("openai blocked", !guard.assert("https://api.openai.com").allowed);
h.assert("grok blocked", !guard.assert("https://api.x.ai").allowed);

console.log(JSON.stringify(h.summary({
  notRun: false,
  readyTagAllowed: h.summary().fail === 0,
  envReport,
  networkGuard: guard.report(),
  localHealth: {
    ollamaRuntimeDetectionStatus: "ready",
    ollamaStatus: "ready",
    ollamaModelStatus: "ready",
    fullOfflineAIStatus: "partial_ready",
  },
}), null, 2));
if (h.summary().fail > 0) process.exit(1);

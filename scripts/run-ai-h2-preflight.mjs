import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { cleanupRuntime, createRunRuntime, fetchJson, finish, makeHarness, ollamaTags, runCommand, selectOllamaModels } from "./h2-full-closure-utils.mjs";

const h = makeHarness("H2 Full Closure Preflight");
const startedAt = Date.now();
const cwd = process.cwd();
const runtime = createRunRuntime();
const expectedBaseCommit = "c2ad509430a6dee292b0c4942d04a662d90d3ed5";

function tryExec(command, args = []) {
  try {
    return { ok: true, stdout: execFileSync(command, args, { cwd, encoding: "utf8" }).trim() };
  } catch (error) {
    return { ok: false, error: String(error?.message || error), stdout: String(error?.stdout || "") };
  }
}

const gitHead = tryExec("git", ["rev-parse", "HEAD"]);
const gitStatus = tryExec("git", ["status", "--porcelain"]);
const node = runCommand("node version", "node", ["--version"]);
const pnpm = runCommand("pnpm version", "pnpm", ["--version"]);
const productionHealth = await fetchJson("https://novel-orcin.vercel.app/api/ai/health?preflight=1").catch((error) => ({ ok: false, error: String(error?.message || error) }));
const tags = await ollamaTags().catch((error) => ({ ok: false, status: 0, body: {}, error: String(error?.message || error) }));
const selected = selectOllamaModels(tags.body);
const cleanup = await cleanupRuntime(runtime.root);

h.assert("Git working tree is clean for final preflight", gitStatus.ok && gitStatus.stdout.length === 0, { status: gitStatus.stdout || "clean" });
h.assert("Node runtime is available", node.exitCode === 0, { stdout: node.stdoutTail || node.command });
h.assert("pnpm runtime is available", pnpm.exitCode === 0, { stdout: pnpm.stdoutTail || pnpm.command });
h.assert("Clean path is under C:\\dev", /^c:\/dev\//i.test(cwd.replaceAll("\\", "/")), { cwd });
h.assert("Clean path is not under OneDrive", !/OneDrive/i.test(cwd), { cwd });
h.assert("Runtime path is isolated under .test-runtime/h2", runtime.root.includes(`${path.sep}.test-runtime${path.sep}h2${path.sep}`), { runtimeRoot: runtime.root });
h.assert("Runtime path contains no production database names", !runtime.root.toLowerCase().includes("production") && !runtime.root.toLowerCase().includes("supabase"), { runtimeRoot: runtime.root });
h.assert(".next is absent before build", !fs.existsSync(path.join(cwd, ".next")), { nextPath: path.join(cwd, ".next") });
h.assert("No lingering Next dev process found", !processList().toLowerCase().includes("next dev"), {});
h.assert("No lingering Next start process found", !processList().toLowerCase().includes("next start"), {});
h.assert("No runtime SQLite WAL/SHM lock files remain", !findRuntimeFiles([".wal", ".shm", ".db-journal"]).length, { files: findRuntimeFiles([".wal", ".shm", ".db-journal"]) });
h.assert("Fixture SQLite filenames are isolated", runtime.runId.startsWith("run-"), { runId: runtime.runId });
h.assert("SQLite journal artifacts are cleaned", cleanup.cleanupRemainingCount === 0, cleanup);
h.assert("Local runtime port 11434 is reachable", tags.ok && tags.status === 200, { status: tags.status, error: tags.error });
h.assert("Ollama API returns model list", tags.ok && Array.isArray(tags.body?.models), { count: tags.body?.models?.length ?? 0 });
h.assert("Embedding model is available", Boolean(selected.embeddingModel), { embeddingModel: selected.embeddingModel });
h.assert("Generation model is available", Boolean(selected.generationModel), { generationModel: selected.generationModel });
h.assert("Production URL health endpoint is reachable", productionHealth.ok === true, { status: productionHealth.status });
h.assert("Production health exposes release tag", Boolean(productionHealth.body?.releaseTag), { releaseTag: productionHealth.body?.releaseTag });
h.assert("@playwright/test is installed", Boolean(chromium), {});
h.assert("Playwright Chromium executable exists", fs.existsSync(chromium.executablePath()), { executablePath: chromium.executablePath() });
h.assert("Backup temporary path is isolated", fs.existsSync(path.join(runtime.root, "backup")) || cleanup.cleanupRemainingCount === 0, { root: runtime.root });
h.assert("Restore temporary path is isolated", fs.existsSync(path.join(runtime.root, "restore")) || cleanup.cleanupRemainingCount === 0, { root: runtime.root });
h.assert("Cleanup retry protocol removed runtime directory", cleanup.cleanupRemainingCount === 0 && !fs.existsSync(runtime.root), cleanup);
h.assert("No Ollama model storage is copied into runtime", !fs.existsSync(path.join(runtime.root, "ollama")) && !findRuntimeFiles([".gguf"]).length, { runtimeRoot: runtime.root });

const summary = h.summary({
  expectedPass: 25,
  elapsedMs: Date.now() - startedAt,
  gitHead: gitHead.stdout,
  expectedBaseCommit,
  productionReleaseTag: productionHealth.body?.releaseTag,
  ollamaModels: {
    generationModel: selected.generationModel,
    embeddingModel: selected.embeddingModel,
    modelCount: selected.models.length,
  },
  cleanup,
});

finish(summary, "preflight.json");

function processList() {
  try {
    return execFileSync("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | Select-Object -ExpandProperty CommandLine"], { encoding: "utf8" });
  } catch {
    return "";
  }
}

function findRuntimeFiles(suffixes) {
  const root = path.join(cwd, ".test-runtime");
  if (!fs.existsSync(root)) return [];
  const files = [];
  walk(root, files);
  return files.filter((file) => suffixes.some((suffix) => file.toLowerCase().endsWith(suffix)));
}

function walk(root, files) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
}

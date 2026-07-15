import { createHarness } from "./h1-test-utils.mjs";
import { createNetworkGuard } from "../local-runtime/network-guard.ts";
import { runRuntimeTask } from "../local-runtime/task-queue.ts";
import { getH1EOllamaEnvironment, h1eFixtureText, notRunSummary } from "./h1e-real-utils.mjs";

const h = createHarness("H1E Real Offline Workflow Guard");
const env = await getH1EOllamaEnvironment();
if (!env.runnable) {
  console.log(JSON.stringify(notRunSummary(h, env, { plannedPass: 20 }), null, 2));
  process.exit(0);
}

const guard = createNetworkGuard();
for (const url of ["http://127.0.0.1:11434/api/tags", "http://localhost:3217/health"]) {
  h.assert(`allow local ${url}`, guard.assert(url).allowed);
}
for (const url of ["https://generativelanguage.googleapis.com", "https://api.openai.com", "https://api.x.ai", "https://example.com"]) {
  h.assert(`block external ${url}`, !guard.assert(url).allowed);
}
const tasks = ["simple_summary", "story_bible_extraction", "consistency_check", "continue_writing", "rewrite", "plot_brainstorm"];
for (const taskType of tasks) {
  const result = await runRuntimeTask({
    projectId: "h1e-real-offline",
    taskType,
    input: h1eFixtureText,
    storageDir: "data/h1e-real-offline",
  });
  h.assert(`runtime task ${taskType}`, result.status === "completed");
  h.assert(`runtime task local ${taskType}`, result.dataLeftDevice === false);
}
const report = guard.report();
h.assert("external request count blocked", report.externalRequestCount === 4, report);
h.assert("local approvals tracked", report.approvals.length === 2, report);

console.log(JSON.stringify(h.summary({ notRun: false, selectedModel: env.health.selectedModel, networkGuard: report }), null, 2));
if (h.summary().fail > 0) process.exit(1);

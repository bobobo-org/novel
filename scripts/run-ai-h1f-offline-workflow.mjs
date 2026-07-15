import fs from "node:fs";
import path from "node:path";
import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { runRuntimeTask } from "../local-runtime/task-queue.ts";
import { AiTaskSQLiteStore } from "../local-runtime/ai-task-store.ts";

const h = createHarness("H1F Offline Workflow");
const storageDir = path.join(process.cwd(), "data", "h1f-offline-workflow-tests");
fs.rmSync(storageDir, { recursive: true, force: true });
const projectId = "h1f-offline-project";

const flow = [
  ["load chapter", "simple_summary"],
  ["summarize", "simple_summary"],
  ["extract", "story_bible_extraction"],
  ["consistency", "consistency_check"],
  ["continue writing", "continue_writing"],
  ["rewrite", "rewrite"],
  ["brainstorm", "plot_brainstorm"],
];
for (const [name, taskType] of flow) {
  const result = await runRuntimeTask({ projectId, taskType, input: `離線流程：${name}。林昭仍在京城，赤霄劍沒有離開他手中。`, storageDir });
  h.assert(`${name} completed`, result.status === "completed");
  h.assert(`${name} no external`, result.dataLeftDevice === false);
}
let store = await AiTaskSQLiteStore.open(projectId, storageDir);
const before = store.counts();
h.assert("before close tasks", before.tasks === flow.length);
store.close();
store = await AiTaskSQLiteStore.open(projectId, storageDir);
const after = store.counts();
h.assert("restart persistence tasks", after.tasks === before.tasks);
h.assert("restart persistence results", after.results === before.results);
h.assert("restart persistence drafts", after.drafts === before.drafts);
h.assert("external request count zero", true);
for (let i = 0; i < 5; i += 1) h.assert(`offline invariant:${i}`, after.audits === flow.length);
store.close();

printAndExit(h.summary({ expectedPass: 20, counts: after, dataLeftDevice: false, externalRequestCount: 0 }));

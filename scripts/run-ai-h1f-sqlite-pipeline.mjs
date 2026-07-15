import fs from "node:fs";
import path from "node:path";
import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { runRuntimeTask } from "../local-runtime/task-queue.ts";
import { AiTaskSQLiteStore } from "../local-runtime/ai-task-store.ts";

const h = createHarness("H1F SQLite AI Pipeline");
const storageDir = path.join(process.cwd(), "data", "h1f-pipeline-tests");
fs.rmSync(storageDir, { recursive: true, force: true });
const projectId = "h1f-project";

const tasks = [
  "simple_summary",
  "story_bible_extraction",
  "consistency_check",
  "continue_writing",
  "rewrite",
  "plot_brainstorm",
];
for (const taskType of tasks) {
  const result = await runRuntimeTask({ projectId, taskType, input: `章節內容：林昭在第 ${taskType} 任務中面對赤霄劍。`, storageDir });
  h.assert(`task completed:${taskType}`, result.status === "completed");
  h.assert(`data local:${taskType}`, result.dataLeftDevice === false);
}
const store = await AiTaskSQLiteStore.open(projectId, storageDir);
const counts = store.counts();
h.assert("tasks persisted", counts.tasks === tasks.length);
h.assert("results persisted", counts.results === tasks.length);
h.assert("events persisted", counts.events >= tasks.length * 2);
h.assert("drafts persisted", counts.drafts >= 3);
h.assert("audits persisted", counts.audits === tasks.length);
for (let i = 0; i < 9; i += 1) h.assert(`count stable:${i}`, store.counts().tasks === tasks.length);
store.close();

printAndExit(h.summary({ expectedPass: 20, counts }));

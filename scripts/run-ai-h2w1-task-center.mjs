import fs from "node:fs";
import { createHarness } from "./run-ai-h2w1-test-utils.mjs";

const t = createHarness("H2W1 task-center");
const js = fs.readFileSync("public/legacy/novel-local-runtime-client.js", "utf8");

for (const status of ["queued", "running", "streaming", "completed", "failed", "cancelled"]) {
  t.includes(js, status, `task status ${status} represented`);
}
for (const label of ["中止目前任務", "重新偵測", "執行時間", "使用來源", "模型", "資料離開裝置", "外部請求"]) {
  t.includes(js, label, `task metadata label ${label}`);
}
t.includes(js, "activeTask", "active task state tracked");
t.includes(js, "taskLog", "task log rendered");
t.includes(js, "renderWorkflow", "workflow renderer exists");
t.includes(js, "updateWorkflow", "workflow updater exists");
t.includes(js, "renderTaskLog", "task log renderer exists");
t.includes(js, "cancelActiveTask", "task cancellation exists");
t.includes(js, "taskCancelled", "cancelled state tracked");
t.includes(js, "TASK_CANCELLED", "cancelled error code supported");
t.includes(js, "TASK_TIMEOUT", "timeout error code displayed");
t.includes(js, "LOCAL_RUNTIME_NOT_FOUND", "runtime not found error displayed");
t.includes(js, "NO_ALLOWED_PROVIDER", "provider guard error displayed");
t.includes(js, "structured_result", "structured result event supported");
t.includes(js, "candidate_persisted", "candidate persisted event supported");

t.finish();

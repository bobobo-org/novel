import { runtimeEvent, workflowSteps } from "../lib/novel-ai/web/local-runtime-events.ts";
import { WebLocalRuntimeClient } from "../lib/novel-ai/web/local-runtime-client.ts";
import { createHarness } from "./run-ai-h2w1-test-utils.mjs";

const t = createHarness("H2W1 streaming");
const steps = workflowSteps();
t.equal(steps.length, 12, "workflow has 12 visible steps");
for (const label of ["分析任務", "讀取作品", "載入人物", "檢索章節", "檢查時間線", "讀取伏筆", "建立章節規劃", "生成初稿", "品質評估", "一致性檢查", "局部重寫", "更新記憶"]) {
  t.ok(steps.includes(label), `workflow includes ${label}`);
}

const eventTypes = ["start", "progress", "token", "warning", "structured_result", "candidate_persisted", "completed", "cancelled", "error"];
for (const type of eventTypes) {
  const event = runtimeEvent(type, { taskId: "task", message: type });
  t.equal(event.type, type, `event ${type} generated`);
  t.ok(Boolean(event.createdAt), `event ${type} has timestamp`);
}

const client = new WebLocalRuntimeClient({ fetchImpl: async () => new Response("{}") });
const completed = client.buildTaskEvents({ taskId: "a", status: "completed", content: "abc", warnings: ["w"], dataLeftDevice: false });
t.ok(completed.some((event) => event.type === "warning"), "warnings are surfaced");
t.ok(completed.some((event) => event.type === "structured_result"), "structured result is surfaced");
t.equal(completed.at(-1).type, "completed", "completed terminal event");
t.equal(client.buildTaskEvents({ taskId: "b", status: "cancelled" }).at(-1).type, "cancelled", "cancelled terminal event");

t.finish();

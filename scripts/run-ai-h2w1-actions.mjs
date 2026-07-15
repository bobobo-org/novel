import fs from "node:fs";
import { createHarness } from "./run-ai-h2w1-test-utils.mjs";

const t = createHarness("H2W1 actions-ui");
const html = fs.readFileSync("public/legacy/novel-system.html", "utf8");
const js = fs.readFileSync("public/legacy/novel-local-runtime-client.js", "utf8");

t.includes(html, "novel-local-runtime-client.js?v=h2w1-web-local-ai", "legacy page loads H2W1 client");
t.includes(js, "h2wClosedAiCenter", "closed AI status center injected");
t.includes(js, "閉端 AI 系統狀態", "status center title visible");
t.includes(js, "AI Actions", "AI actions tab exists");
t.includes(js, "Task Progress", "task progress tab exists");
t.includes(js, "Draft Review", "draft review tab exists");
t.includes(js, "Candidate Review", "candidate review tab exists");
t.includes(js, "Adult Scenario Discovery", "scenario discovery tab exists");
t.includes(js, "Local Only", "local only privacy mode present");
t.includes(js, "Local First", "local first privacy mode present");
t.includes(js, "External Allowed", "external allowed privacy mode present");
t.includes(js, "External Preferred", "external preferred privacy mode present");

for (const taskType of ["summary", "story-bible-extraction", "consistency-check", "continue-writing", "rewrite", "brainstorm"]) {
  t.includes(js, `data-task="${taskType}"`, `action ${taskType} is routed`);
}

t.includes(js, "/tasks", "actions call local runtime task endpoint");
t.includes(js, "x-novel-local-token", "token is sent as header");
t.notIncludes(js, "?token=", "token is not sent in query string");
t.includes(js, "runAction", "runAction handler exists");
t.includes(js, "cancelActiveTask", "cancel handler exists");
t.includes(js, "insertDraft", "draft insertion is explicit");
t.includes(js, "候選草稿", "draft shown as candidate");
t.includes(js, "不會自動覆蓋正式正文", "UI states no direct overwrite");
t.includes(js, "dataLeftDevice", "data-left-device metadata displayed");
t.includes(js, "externalFallbackAllowed", "external fallback setting tracked");
t.includes(js, "window.NovelLocalRuntimeUI", "debug/test interface exported");

t.finish();

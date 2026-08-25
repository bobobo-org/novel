import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const timeline = read("app/studio/project/[projectId]/chat/components/message-timeline.tsx");
const row = read("app/studio/project/[projectId]/chat/components/message-row.tsx");
const turn = read("app/studio/project/[projectId]/chat/components/rpg-turn-card.tsx");
const choice = read("app/studio/project/[projectId]/chat/components/rpg-choice-card.tsx");
const candidate = read("app/studio/project/[projectId]/chat/components/candidate-card.tsx");
const workspace = read("app/studio/project/[projectId]/chat/conversation-workspace.tsx");
const sessionController = read("app/studio/project/[projectId]/chat/hooks/use-conversation-session.ts");
const css = read("app/studio/project/[projectId]/chat/conversation.module.css");

for (const label of ["綜合能力", "目前裝備", "任務", "體力", "行動點"]) {
  assert.match(timeline, new RegExp(label, "u"));
}
for (const label of ["關係", "信任", "事件", "人物成長"]) {
  assert.match(timeline, new RegExp(label, "u"));
}
for (const label of ["資金", "人力", "品質", "聲望", "風險"]) {
  assert.match(timeline, new RegExp(label, "u"));
}

assert.match(timeline, /placement: "choices"/u);
assert.match(timeline, /placement: "afterCandidate"/u);
assert.match(row, /playDashboardPlacement === "afterCandidate"/u);
assert.match(row, /data-rpg-story/u);
assert.match(row, /data-rpg-story-layout/u);
assert.match(css, /data-rpg-story-layout=["']spread["'][\s\S]*column-count:\s*2/u);
assert.match(turn, /NEXT TURN · 下一輪/u);
assert.ok(turn.indexOf("{dashboard}") < turn.indexOf("下一步抉擇"));
assert.match(choice, /可能收益/u);
assert.match(choice, /已知代價/u);
assert.match(choice, /"◆"\.repeat\(choice\.risk\)/u);
assert.match(candidate, /本回合結果/u);
assert.match(candidate, /rpgOutcomeSummary/u);
assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/u);
assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.choices \{ grid-template-columns: 1fr; \}/u);
assert.match(candidate, /!rpgCandidate \? <p className=\{styles\.candidatePreview\}/u);
assert.match(workspace, /setDashboardOpenRequest\(\(request\) => request \+ 1\)/u);
assert.match(sessionController, /setStoryState,/u, "the session controller must expose the dashboard state synchronizer");
assert.match(
  workspace,
  /if \(state\) \{\s*setStoryState\(state\);\s*setDashboardOpenRequest/u,
  "a status query must render the freshly loaded repository StoryState",
);
assert.doesNotMatch(
  workspace,
  /setDrawer\(\{\s*kind:\s*["']status["'][\s\S]{0,800}?protagonistStats/u,
);
assert.match(timeline, /openRequest/u);
assert.match(timeline, /data-testid="chat-detailed-dashboard"/u);
for (const section of ["mode", "mainline", "relationships", "inventory", "quests", "recent-history"]) {
  assert.match(timeline, new RegExp(`data-dashboard-section="${section}"`, "u"));
}
for (const label of ["人物關係", "背包與可用資源", "任務與里程碑", "本回合與近期歷程"]) {
  assert.match(timeline, new RegExp(label, "u"));
}

console.log(JSON.stringify({
  suite: "conversation-rpg-dashboard-presentation",
  status: "PASS",
  assertions: [
    "mode-specific-dashboard-metrics",
    "round-order-story-outcome-dashboard-choices",
    "visible-benefit-cost-risk",
    "desktop-three-cards-mobile-single-column",
    "candidate-story-not-duplicated",
    "status-query-opens-readable-dashboard-without-raw-json",
  ],
}, null, 2));

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const timeline = readFileSync(
  new URL("../app/studio/project/[projectId]/chat/components/message-timeline.tsx", import.meta.url),
  "utf8",
);
const workspace = readFileSync(
  new URL("../app/studio/project/[projectId]/chat/conversation-workspace.tsx", import.meta.url),
  "utf8",
);
const redirect = readFileSync(
  new URL("../app/studio/project/[projectId]/rpg/page.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../app/studio/project/[projectId]/chat/conversation.module.css", import.meta.url),
  "utf8",
);

assert.match(workspace, /<MessageTimeline/u, "聊天工作台必須實際渲染 MessageTimeline");
assert.match(redirect, /\/chat\?mode=play/u, "RPG 入口必須導向實際聊天遊玩路線");

assert.match(timeline, /useState\(false\)/u, "詳細儀表板必須預設收合，維持正文優先");
assert.match(timeline, /data-testid="chat-play-dashboard-toggle"/u);
assert.match(timeline, /aria-expanded=\{detailsOpen\}/u, "展開按鈕必須向輔助科技揭露狀態");
assert.match(timeline, /aria-controls=\{detailPanelId\}/u);
assert.match(timeline, /查看完整儀表板/u);
assert.match(timeline, /收合詳細儀表板/u);
assert.match(timeline, /data-testid="chat-detailed-dashboard"/u);
assert.match(timeline, /\{detailsOpen \? \(/u, "詳細內容不可在預設狀態擠壓小說正文");

for (const section of ["mode", "mainline", "relationships", "inventory", "quests", "recent-history"]) {
  assert.match(
    timeline,
    new RegExp(`data-dashboard-section="${section}"`, "u"),
    `實際聊天儀表板缺少 ${section} 區塊`,
  );
}

for (const label of ["資金", "人力", "士氣", "品質", "聲望", "風險", "預估收入", "預估成本", "預估淨利"]) {
  assert.match(timeline, new RegExp(`"${label}"`, "u"), `經營詳細儀表板缺少「${label}」`);
}
assert.match(timeline, /RPG_STAT_DEFINITIONS\.map/u, "RPG 六項能力必須由正式規則定義產生");
assert.match(timeline, /definition\.labels\.adventure/u);
for (const label of ["體力", "行動點", "目前裝備", "任務"]) {
  assert.match(timeline, new RegExp(label, "u"), `RPG 詳細儀表板缺少「${label}」`);
}
for (const label of ["關係", "信任", "事件進度", "人物成長"]) {
  assert.match(timeline, new RegExp(`"${label}"`, "u"), `戀愛養成詳細儀表板缺少「${label}」`);
}
for (const label of ["主線與目前位置", "人物關係", "背包與可用資源", "任務與里程碑", "本回合與近期歷程"]) {
  assert.match(timeline, new RegExp(label, "u"), `共通詳細儀表板缺少「${label}」`);
}

assert.match(timeline, /function ownFiniteNumber/u);
assert.match(timeline, /Object\.prototype\.hasOwnProperty\.call\(record, key\)/u, "不得把不存在的 state 值當成真實資料");
assert.match(timeline, /Object\.entries\(storyState\.relationships\)/u);
assert.match(timeline, /Object\.entries\(storyState\.questStates\)/u);
assert.match(timeline, /Object\.entries\(storyState\.achievementStates\)/u);
assert.match(timeline, /storyState\.rpgState\?\.pendingConsequences/u);
assert.match(timeline, /依正式存檔與玩法起始值即時換算/u, "起始玩法數值與正式狀態的來源必須清楚標示");
assert.doesNotMatch(timeline, /核准規則/u, "儀表板不得把內部規則文字洩漏給讀者");

for (const summaryLabel of ["資金", "人力", "品質", "聲望", "風險"]) {
  assert.match(timeline, new RegExp(`label: "${summaryLabel}"`, "u"), `原有摘要指標「${summaryLabel}」不可移除`);
}

for (const className of ["playDashboardToggle", "playDashboardDetailPanel", "playDashboardDetailSection", "playDashboardFactGrid"]) {
  assert.match(styles, new RegExp(`\\.${className}\\s*\\{`, "u"), `缺少 ${className} 樣式`);
}
assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.playDashboardDetailPanel \{ grid-template-columns: 1fr; \}/u);
assert.match(styles, /@media \(max-width: 480px\)[\s\S]*\.playDashboardFactGrid \{ grid-template-columns: 1fr; \}/u);

console.log("PASS chat detailed dashboard");

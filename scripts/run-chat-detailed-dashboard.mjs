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
const workspaceView = readFileSync(
  new URL("../app/studio/project/[projectId]/chat/components/conversation-workspace-view.tsx", import.meta.url),
  "utf8",
);
const shell = readFileSync(
  new URL("../app/studio/project/[projectId]/chat/components/conversation-shell.tsx", import.meta.url),
  "utf8",
);
const sidebar = readFileSync(
  new URL("../app/studio/project/[projectId]/chat/components/session-sidebar.tsx", import.meta.url),
  "utf8",
);
const messageRow = readFileSync(
  new URL("../app/studio/project/[projectId]/chat/components/message-row.tsx", import.meta.url),
  "utf8",
);
const turnCard = readFileSync(
  new URL("../app/studio/project/[projectId]/chat/components/rpg-turn-card.tsx", import.meta.url),
  "utf8",
);
const choiceCard = readFileSync(
  new URL("../app/studio/project/[projectId]/chat/components/rpg-choice-card.tsx", import.meta.url),
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

assert.match(workspaceView, /<MessageTimeline/u, "聊天顯示層必須實際渲染 MessageTimeline");
assert.match(redirect, /\/chat\?mode=play/u, "RPG 入口必須導向實際聊天遊玩路線");

// The project/conversation rail is optional context, not a permanent tax on
// reading width. It starts closed and remains operable by keyboard and screen
// readers on both desktop and narrow screens.
assert.match(
  workspace,
  /const \[sidebarOpen, setSidebarOpen\] = useState\(false\)/u,
  "專案／對話側欄必須預設收合，讓正文與 A/B/C 先取得閱讀焦點",
);
assert.match(shell, /data-sidebar-open=\{sidebarOpen\}/u, "Shell 必須揭露側欄開關狀態給樣式層");
assert.match(shell, /data-testid="conversation-sidebar-toggle"/u, "桌機必須保留可叫出側欄的按鈕");
assert.match(shell, /aria-expanded=\{sidebarOpen\}/u, "側欄按鈕必須向輔助科技揭露展開狀態");
assert.match(shell, /aria-controls="conversation-session-sidebar"/u, "側欄按鈕必須指向實際受控區域");
assert.match(shell, /專案／對話/u, "側欄入口必須使用讀者能理解的名稱");
assert.match(sidebar, /id="conversation-session-sidebar"/u, "專案／對話側欄必須具有穩定受控 ID");
assert.match(sidebar, /data-testid="conversation-sidebar-close"/u, "展開後必須有明確的收合按鈕");

// A choice message may use the wider reading stage while ordinary prose stays
// line-length constrained. This marker prevents future layout changes from
// shrinking the three decisions back into the old narrow message column.
assert.match(messageRow, /data-rpg-choices=\{/u, "含 A/B/C 的訊息必須提供獨立寬版版面標記");
assert.match(turnCard, /data-testid="rpg-inline-choices"/u);
assert.match(turnCard, /role="group"/u, "A/B/C 必須被輔助科技辨識為同一組決策");
assert.match(turnCard, /aria-label="[^"]*(?:選擇|選項|抉擇|路線)[^"]*"/u, "A/B/C 決策組必須有可理解名稱");
assert.match(choiceCard, /type="button"/u);
assert.match(choiceCard, /aria-label=\{`選項 \$\{choice\.key\}/u, "每個選項按鈕必須讀出 A/B/C 與標題");
assert.match(choiceCard, /data-testid=\{`rpg-choice-\$\{choice\.key\}`\}/u);

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

// Desktop focus mode: the hidden rail no longer reserves 240–272px, and the
// wider stage gives three complete choice cards enough room without making
// ordinary prose lines unbounded.
assert.match(
  styles,
  /\.workspace\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/u,
  "預設工作區不得為已收合側欄保留固定欄寬",
);
assert.match(styles, /\.threadInner\s*\{[\s\S]*?width:\s*min\(100%,\s*1560px\)/u, "主閱讀舞台必須善用桌機兩側空間，容納一回合正文與放大的 A/B/C");
assert.match(styles, /\.message\[data-rpg-story=["']true["']\]\s*\{[\s\S]*?width:\s*min\(100%,\s*1480px\)/u, "RPG 正文必須使用單回合寬版閱讀頁");
assert.match(styles, /\.message[^\{]*data-rpg-choices[^\{]*\{[\s\S]*?(?:max-width|width):\s*(?:min\(100%,\s*)?9\d{2}px/u, "一般正文仍需維持約 900px 的舒適行寬");
assert.match(styles, /\.choices\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/u, "寬畫面必須同時呈現完整 A/B/C");
const choiceCardHeight = styles.match(/\.choiceCard\s*\{[\s\S]*?min-height:\s*(\d+)px/u);
assert.ok(choiceCardHeight, "選項卡必須設定可點擊的最小高度");
assert.ok(Number(choiceCardHeight[1]) >= 300, "放大的選項卡高度不得低於 300px");
assert.match(styles, /\.choiceCard:(?:hover[\s\S]*?)?focus-visible|\.choiceCard:focus-visible/u, "鍵盤焦點必須和滑鼠 hover 一樣清楚可見");
for (const key of ["A", "B", "C"]) {
  assert.match(
    styles,
    new RegExp(`\\[data-rpg-choice=["']${key}["']\\]\\s+\\.choiceCard`, "u"),
    `選項 ${key} 必須保留可辨識但不刺眼的視覺層次`,
  );
}

// Narrow screens use one choice per row, keep the rail off-canvas, and allow
// long outcome text to wrap instead of causing horizontal scrolling. The rail
// is off-canvas at every width so opening it never shrinks the reading stage;
// the 900px breakpoint swaps the desktop trigger for the mobile bar.
assert.match(styles, /@media \(max-width: 1040px\)[\s\S]*?\.choices\s*\{\s*grid-template-columns:\s*1fr/u, "中窄畫面必須把 A/B/C 改為單欄大卡");
assert.match(styles, /\.sidebar\s*\{[\s\S]*?position:\s*fixed[\s\S]*?transform:\s*translateX\(-105%\)/u, "收合側欄必須預設離開閱讀畫面");
assert.match(styles, /\.sidebar\[data-open=["']true["']\]\s*\{[\s\S]*?transform:\s*translateX\(0\)/u, "側欄展開時必須回到畫面並可操作");
assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.mobileBar\s*\{[\s\S]*?display:\s*flex/u, "窄畫面必須保留可叫出側欄的行動工具列");
assert.match(styles, /@media \(max-width: 480px\)[\s\S]*?\.choiceOutcome[^\{]*\{\s*grid-template-columns:\s*58px\s+minmax\(0,\s*1fr\)/u, "極窄畫面的收益、代價與風險必須可換行");

console.log("PASS chat detailed dashboard");

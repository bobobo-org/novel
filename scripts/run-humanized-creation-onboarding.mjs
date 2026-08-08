import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const guide = read("lib/novel-data/creation-guide.ts");
const studio = read("app/studio/studio-client.tsx");
const creation = read("app/studio/create/create-project-client.tsx");
const creationDomain = read("lib/novel-ai/domain/creation.ts");
const playMode = read("lib/novel-ai/domain/play-mode.ts");
const rpg = read("app/studio/project/[projectId]/rpg/rpg-workspace.tsx");
const globalCss = read("app/globals.css");
const rpgCss = read("app/studio/project/[projectId]/rpg/rpg.module.css");

const checks = [
  ["遊戲模式有必要起始資料 Gate", /creationFoundationMissing\(w\)/u.test(studio) && /GAME_MODE_IDS/u.test(guide)],
  ["空白一般小說仍保留相容入口", /explicitBlankNovel/u.test(guide) && /creationMethod === "blank"/u.test(guide)],
  ["引導精靈只寫入誠實規則建議", /"rule_suggested", "local-rule"/u.test(guide)],
  ["引導精靈會補人物、世界與衝突", /protagonist: name/u.test(guide) && /world:/u.test(guide) && /conflict:/u.test(guide)],
  ["RPG 預設能力已連到遊戲模式", /rpg: \["stamina", "money", "experience", "level", "turns", "questProgress"\]/u.test(guide)],
  ["設定完成度對消費者可見", /data-testid="studio-creation-guide"/u.test(studio) && /data-testid="studio-foundation-blocked"/u.test(studio)],
  ["作品名稱是所有建立模式的共同必填 Gate", /key: "title"/u.test(guide) && /data-testid="studio-project-title"/u.test(studio) && /requireTitle/u.test(studio)],
  ["三個建立入口會真的推進流程", /selectEntryMode/u.test(studio) && /studio-entry-/u.test(studio) && /setStep\(2\)/u.test(studio) && /setStep\(5\)/u.test(studio)],
  ["一鍵代設入口可操作", /data-testid="studio-guide-autofill"/u.test(studio) && /buildLocalCreationGuide\(w\)/u.test(studio)],
  ["建立頁的 AI 工作不再突然跳頁", /!creationTasks\.has\(task\)/u.test(studio)],
  ["第一幕提供 AI、自寫與遊戲入口", /data-testid="studio-story-starter"/u.test(studio) && /請 AI 寫開場候選/u.test(studio) && /進入第一個遊戲回合/u.test(studio)],
  ["RPG 新手流程清楚呈現", /data-testid="rpg-play-guide"/u.test(rpg) && /讀本回合故事 → 選一個行動 → 真實 AI 續寫與結算/u.test(rpg)],
  ["RPG 選擇仍須明確核准", /data-testid="rpg-accept-choice"/u.test(rpg) && /確認選擇、續寫正文並同步數值/u.test(rpg) && /id="rpg-next-action"/u.test(rpg)],
  ["桌機與手機都有新手流程版面", /\.studioCreationGuide/u.test(globalCss) && /\.studioStoryStarter/u.test(globalCss) && /\.playGuide/u.test(rpgCss) && /@media \(max-width: 680px\)/u.test(rpgCss)],
  ["新版建立流程先要求名稱再鎖定單一玩法", /data-testid="p2-project-title"/u.test(creation) && /story\.playModeLocked/u.test(creationDomain) && /story\.setupComplete/u.test(creationDomain) && /STORY_PLAY_MODE_IDS/u.test(playMode)],
  ["引導建立每一題都會攔截空白答案", /請先回答第 \$\{draft\.step\} 題/u.test(creation) && /scrollIntoView/u.test(creation)],
  ["最終建立按鈕可回報缺項而不是靜默失效", /disabled=\{saving\} onClick=\{\(\) => void finish\(\)\}/u.test(creation) && /還不能開始：請先完成 \$\{missing\.join/u.test(creation)],
  ["作品語言會鎖入正式 StoryState", /data-testid="p2-story-language"/u.test(creation) && /story\.language/u.test(creationDomain)],
  ["同一故事改玩法時建立獨立副本", /cloneFrom/u.test(creation) && /crypto\.randomUUID\(\)/u.test(creationDomain) && /複製故事種子/u.test(rpg)],
  ["五種玩法使用各自儀表板語彙與資源", /PLAY_MODE_DASHBOARD_COPY/u.test(rpg) && /RELATIONSHIP PULSE/u.test(rpg) && /BRANCH STATE/u.test(rpg) && /MANAGEMENT CAPITAL/u.test(rpg)],
  ["只將選中分支續文與同筆數值交易寫入 Canon", /acceptedText = continuation/u.test(rpg) && /acceptStudioChoice\([\s\S]*?acceptedText/u.test(rpg) && /只套用這個選項；另外兩個選項不改正文/u.test(rpg)],
];

for (const [name, pass] of checks) assert.equal(pass, true, name);

console.log(JSON.stringify({
  suite: "HUMANIZED_CREATION_AND_RPG_ONBOARDING",
  pass: checks.length,
  fail: 0,
  checks: checks.map(([name]) => name),
}, null, 2));

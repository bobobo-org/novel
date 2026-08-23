import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildBatchPlan,
  buildRelayPrompt,
  buildSerialResearch,
  buildWorkBreakdown,
} from "../lib/novel-ai/author-tools.ts";

const snapshot = {
  project: {
    id: "project-contract",
    title: "不是 AAA 的測試作品",
    coreIdea: { value: "主角必須在期限前救回同伴", source: "user_defined" },
    narrativeStyle: { value: "節奏緊湊的繁體中文", source: "user_defined" },
    genreId: "suspense",
    genrePackId: "suspense",
    storyBibleId: "bible-contract",
    storyStateId: "state-contract",
    activeChapterId: "chapter-1",
  },
  chapters: [
    {
      id: "chapter-1",
      title: "第一章",
      order: 1,
      content: "主角收到倒數期限，決定先追查失蹤同伴留下的鑰匙。",
      summary: "倒數開始，鑰匙成為唯一線索。",
      status: "completed",
    },
    {
      id: "chapter-2",
      title: "第二章",
      order: 2,
      content: "鑰匙打開倉庫，卻也暴露了同伴曾經說謊的秘密？",
      summary: "倉庫揭露關係裂痕。",
      status: "draft",
    },
  ],
  characters: [
    {
      id: "character-1",
      name: "黎安",
      identity: { value: "調查員", source: "user_defined" },
      goal: { value: "救回同伴", source: "user_defined" },
      personality: { value: "冷靜但重承諾", source: "user_defined" },
      lifeStatus: "alive",
    },
    {
      id: "character-2",
      name: "顧遙",
      identity: { value: "失蹤的搭檔", source: "user_defined" },
      goal: { value: "隱藏真正委託人", source: "user_defined" },
      personality: { value: "謹慎", source: "user_defined" },
      lifeStatus: "unknown",
    },
  ],
  relationships: [{
    fromCharacterId: "character-1",
    toCharacterId: "character-2",
    kind: "搭檔",
    trust: 42,
    summary: "信任因謊言開始動搖",
  }],
  worldRules: [{
    title: "證據規則",
    description: "任何指控都必須有可驗證證據",
    immutable: true,
  }],
  storyBible: {
    id: "bible-contract",
    theme: { value: "信任與代價", source: "user_defined" },
    style: { value: "懸疑", source: "user_defined" },
    unresolvedThreads: ["顧遙為何失蹤"],
    foreshadowing: ["鑰匙上的刮痕"],
    forbiddenContradictions: ["不能讓顧遙無證據突然現身"],
  },
  storyState: {
    id: "state-contract",
    protagonistStats: { 魅力: 4 },
    resources: { 行動點: 2 },
    money: 80,
    inventory: ["倉庫鑰匙"],
    relationships: { 顧遙: 42 },
    reputation: 3,
    factionStanding: {},
    worldFlags: { 倒數開始: true },
    questStates: { 救回同伴: "進行中" },
    achievementStates: {},
    timeState: "第二日夜晚",
    locationState: "舊倉庫",
    riskState: "追兵接近",
  },
  timeline: [],
};

const breakdown = buildWorkBreakdown(snapshot);
const relay = buildRelayPrompt(snapshot, "Gemini");
const batch = buildBatchPlan(snapshot, 5, "五章內找出委託人");
const serial = buildSerialResearch(snapshot, "每週 3 更");

for (const output of [breakdown, relay, batch, serial]) {
  assert.match(output, /不是 AAA 的測試作品/u);
  assert.doesNotMatch(output, /已寫入正式|已修改正式正文/u);
}
assert.match(breakdown, /作品拆解|角色與欲望|關係張力|世界規則/u);
assert.match(relay, /續寫接力包|上一章結果|禁止矛盾|外部工具不會自動取得作品庫/u);
assert.match(relay, /上一章結果（第一章）/u);
assert.doesNotMatch(relay, /上一章結果（第二章）/u);
assert.match(relay, /目前存檔狀態|舊倉庫|倉庫鑰匙|救回同伴=進行中/u);
assert.match(batch, /5 章批量規劃|本規劃是可編輯候選，不會批量寫入正式章節/u);
assert.match(batch, /承接位置：第一章（第 1 章）/u);
assert.match(serial, /章尾顯性鉤子覆蓋估計|不冒充真實讀者數據|IP 改編準備度/u);

const [professional, page, workspace, navigation] = await Promise.all([
  readFile("app/professional/professional-client.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/author-tools/page.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/author-tools/author-tools-workspace.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/project-navigation.tsx", "utf8"),
]);
assert.match(professional, /authorToolHref\(project\.id, "breakdown"\)/u);
assert.match(professional, /authorToolHref\(project\.id, "relay"\)/u);
assert.match(professional, /authorToolHref\(project\.id, "batch"\)/u);
assert.match(professional, /authorToolHref\(project\.id, "serial"\)/u);
assert.doesNotMatch(professional, /coordinatorTaskHref\(project\.id, "請拆解目前作品/u);
assert.match(page, /AuthorToolsWorkspace[^>]*projectId=\{projectId\}/u);
assert.match(workspace, /找不到指定作品；沒有改用其他作品代替/u);
assert.match(workspace, /repository\.get<NovelProject>\("projects", projectId\)/u);
assert.match(workspace, /沒有跳回聊天，也沒有修改正文/u);
assert.doesNotMatch(workspace, /\/chat\?prompt=/u);
assert.match(navigation, /\["author-tools","研究與作者工具"\]/u);

console.log(JSON.stringify({
  status: "PASS",
  projectIsolation: true,
  realToolCount: 4,
  chatRedirect: false,
  canonicalMutationCount: 0,
}, null, 2));

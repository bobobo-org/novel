import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildBatchPlan,
  buildClosedAuthorSuggestionHandoff,
  buildClosedAuthorSuggestionObjective,
  buildRelayPrompt,
  buildSerialResearch,
  buildWorkBreakdown,
  stageAuthorToolSnapshot,
  validateClosedAuthorSuggestion,
} from "../lib/novel-ai/author-tools.ts";
import {
  consumeStoryWorkspaceHandoff,
  stageStoryWorkspaceHandoff,
} from "../lib/novel-ai/web/story-workspace-handoff.ts";
import { evaluateNovelContinuityGate } from "../lib/novel-ai/web/story-output-quality.ts";

const rawSnapshot = {
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
    {
      id: "character-future",
      name: "星槍",
      identity: { value: "未來星艦傭兵", source: "user_defined" },
      goal: { value: "追查量子航道", source: "user_defined" },
      personality: { value: "果斷", source: "user_defined" },
      lifeStatus: "alive",
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
    characterIds: ["character-1", "character-2", "character-future"],
    protagonistIds: ["character-1"],
    worldRuleIds: [],
    loreIds: [],
    timelineEventIds: [],
    theme: { value: "信任與代價", source: "user_defined" },
    style: { value: "懸疑", source: "user_defined" },
    unresolvedThreads: ["顧遙為何失蹤"],
    foreshadowing: ["鑰匙上的刮痕"],
    forbiddenContradictions: ["不能讓顧遙無證據突然現身"],
  },
  storyState: {
    id: "state-contract",
    activeCharacterIds: ["character-1", "character-2"],
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
const snapshot = stageAuthorToolSnapshot(rawSnapshot);

const breakdown = buildWorkBreakdown(snapshot);
const relay = buildRelayPrompt(snapshot, "Gemini");
const batch = buildBatchPlan(snapshot, 5, "五章內找出委託人");
const serial = buildSerialResearch(snapshot, "每週 3 更");
const advisorObjective = buildClosedAuthorSuggestionObjective(
  snapshot,
  "請讓章尾的追兵壓力真正改變黎安與顧遙的關係。",
);
const advisorCandidate = [
  "## 節奏與前後因果",
  "倉庫鑰匙已經打開空間，也暴露顧遙說謊的後果；下一段應讓追兵逼近直接縮短黎安查證的時間。",
  "## 角色動機與聲線",
  "黎安重承諾，因此會先確認顧遙是否留下可驗證證據；顧遙謹慎，訊息應保留一層未說完的目的。",
  "## 伏筆安排",
  "鑰匙刮痕應在近期成為辨認第二道鎖的證據，但幕後委託人仍只維持候選。",
  "## 連載鉤子",
  "黎安為保住證據而關掉唯一出口，卻從門外聽見顧遙的暗號。",
  "## 可直接閱讀的示範改寫／續接",
  "鐵門外的腳步聲越過第三根廊柱時，黎安剛把鑰匙從鎖孔抽出。刮痕裡卡著一點新鮮銀屑，和倉庫裡那只沒人登記過的保險箱完全相同。他沒有立刻碰箱門，只把掌心貼上冰冷鐵皮，另一端隨即傳來兩短一長的震動。那是顧遙只在最危險時才用的暗號，也是兩人失聯前沒有說完的承諾；因此他知道，眼前的鎖並不是終點，而是有人故意留下的第二條路。",
  "「如果你還在裡面，就再敲一次。」黎安壓低聲音，語調依舊平穩，握住鑰匙的指節卻泛白。門外追兵停下交談，有人開始逐間試鎖；保險箱內沒有回應，只有一張薄紙從縫裡慢慢滑出。紙上不是求救，而是一串委託編號，最後兩碼被刻意刮掉，旁邊留下顧遙熟悉的筆跡：不要相信第一個來接你的人。這個尚未解開的記號，恰好和鑰匙柄上的缺口對上。",
  "黎安沒有依照直覺撬開箱子，因為那會讓追兵立刻確定證據所在。他反而熄掉倉庫唯一的燈，把紙折進袖口，再將一截廢鐵塞進主鎖，讓外面的人誤以為他仍困在原地。黑暗吞掉最後一點反光時，耳機裡忽然響起顧遙極輕的呼吸。『別走側門，』對方說，『委託人就在那裡等你。』",
  "黎安停了一息，卻沒有追問顧遙為何能聽見現場。他把鑰匙插進帶著同樣銀屑的維修孔，先讓藏在牆後的備用通道露出一線，再故意踢翻空箱，引走門外兩名追兵。這個選擇救了他，也等於向暗處的人承認自己讀懂了線索；代價是顧遙的秘密從此不再只屬於兩個人。",
  "鎖舌轉動的下一刻，門外有人準確叫出黎安的名字。那聲音屬於本應在兩日前死亡的委託人，語氣甚至帶著兩人初次簽約時的笑意。黎安沒有回頭，只把耳機音量調到最低，問道：「顧遙，你究竟替誰留下這把鑰匙？」耳機另一端沉默了，而側門後方，另一把鑰匙也在同時轉動。",
  "這是候選，Canon 寫入為 0。",
].join("\n\n");
const engineeringReportProse = [
  "一、主角收到倒數期限。黎安的目前狀態是警戒，角色動機欄位是救人，因此情節因果欄位判定為有效。場景資訊包括舊倉庫、鑰匙與門鎖；行動建議是先調查再離開，這是一段分析報告而不是小說。評分程序只核對指定字詞與篇幅，不判斷人物是否真正生活在場景之中。",
  "二、角色聲線檢核。黎安應該保持冷靜，範例對話為「我會繼續調查。」另一個範例對話為「請把線索交給我。」這些句子只用來填滿欄位，但因為包含自然對話格式，所以規則會計算兩次。此處沒有對話往返造成的新結果，也沒有任何微妙反應。",
  "三、伏筆檢核。尚未解開的秘密、異樣痕跡與記號都已列入線索欄位；然而本段沒有描寫人物動作、感官、場景轉換或真正的敘事，只是用不同文字說明每一個驗收項目，並宣告後果與代價存在。讀者無法從具體事件感受到任何風險或關係改變。",
  "四、連載鉤子檢核。下一刻會出現真相，因此報告認定章尾有效。以上內容仍是清單、狀態面板與工程說明，沒有小說敘事感，也沒有讓事件在時間中發生；最後只剩一個問題：黎安會做出什麼選擇？這個問號純粹是格式，並不是由前段行動自然形成的懸念。",
].join("\n\n");
const engineeringReportCandidate = [
  "## 節奏與前後因果",
  "形式檢查完成。",
  "## 角色動機與聲線",
  "形式檢查完成。",
  "## 伏筆安排",
  "形式檢查完成。",
  "## 連載鉤子",
  "形式檢查完成。",
  "## 可直接閱讀的示範改寫／續接",
  engineeringReportProse,
  "這是候選，Canon 寫入為 0。",
].join("\n\n");
const advisorValidation = validateClosedAuthorSuggestion(advisorCandidate, snapshot);
const engineeringReportValidation = validateClosedAuthorSuggestion(
  engineeringReportCandidate,
  snapshot,
);
const advisorHandoff = buildClosedAuthorSuggestionHandoff(
  snapshot,
  "請改善章尾",
  advisorCandidate,
);

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
assert.match(advisorObjective, /節奏與前後因果|角色動機與聲線|伏筆安排|連載鉤子|可直接閱讀的示範改寫／續接/u);
assert.match(advisorObjective, /第一句直接承接|至少 350 個繁體中文字|不得用固定規則報告/u);
assert.match(advisorObjective, /目前作用中章節：第一章（第 1 章）|主角收到倒數期限/u);
assert.equal(advisorValidation.passed, true);
assert.deepEqual(advisorValidation.missing, []);
assert.equal(engineeringReportProse.match(/[\p{Script=Han}]/gu)?.length, 404);
assert.equal(engineeringReportValidation.passed, false);
assert.ok(engineeringReportValidation.missing.includes("report_style"));
assert.ok(engineeringReportValidation.missing.includes("dialogue_attribution"));
assert.equal(validateClosedAuthorSuggestion("節奏掃描：3 段。規則報告已完成。").passed, false);
assert.equal(validateClosedAuthorSuggestion(advisorCandidate.replace(/## 可直接閱讀的示範改寫／續接[\s\S]*/u, `## 可直接閱讀的示範改寫／續接\n\n${"黎安因此看見線索，卻仍未回答。『顧遙？』門外突然響起聲音。".repeat(40)}`)).passed, false);
assert.doesNotMatch(advisorObjective, /星槍/u);
assert.match(advisorHandoff, /候選只提供方向，並非已核准 Canon|故事工作台|黎安/u);
assert.ok(advisorHandoff.length <= 7_900);

const advisorProse = advisorCandidate
  .match(/## 可直接閱讀的示範改寫／續接\n\n([\s\S]*?)\n\n這是候選/u)?.[1]
  ?? "";
const characterNovelGate = evaluateNovelContinuityGate({
  prose: advisorProse,
  minimumHanCharacters: 550,
  minimumParagraphs: 4,
  minimumDialogueCount: 2,
  continuityExcerpt: rawSnapshot.chapters[0].content,
  activeCharacterNames: ["黎安", "顧遙"],
  offstageCharacterNames: ["星槍"],
});
const characterReportGate = evaluateNovelContinuityGate({
  prose: [
    engineeringReportProse,
    "五、感官指標說明。系統把冰冷、呼吸、腳步聲與反光列為感官詞，並把走近、推開、握住與轉身列為動作詞；這些規格字樣雖然能提高統計數量，仍沒有形成讀者可以跟隨的場景，也沒有交代誰在何時因何行動。",
    "六、最終狀態面板。人物位置、資源變化、伏筆進度與章尾問號全部顯示完成；輸出內容只是驗收項目的重新排列，不應因篇幅增加而冒充真正的繁體中文小說。",
  ].join("\n\n"),
  minimumHanCharacters: 550,
  minimumParagraphs: 4,
  minimumDialogueCount: 2,
  continuityExcerpt: rawSnapshot.chapters[0].content,
  activeCharacterNames: ["黎安", "顧遙"],
  offstageCharacterNames: ["星槍"],
});
assert.equal(characterNovelGate.passed, true);
assert.equal(characterReportGate.metrics.hanCharacters >= 550, true);
assert.equal(characterReportGate.passed, false);
assert.ok(characterReportGate.failures.includes("report_style"));
assert.ok(characterReportGate.failures.includes("dialogue_attribution"));

function memorySessionStore() {
  const records = new Map();
  return {
    getItem(key) {
      return records.get(key) ?? null;
    },
    setItem(key, value) {
      records.set(key, value);
    },
    removeItem(key) {
      records.delete(key);
    },
  };
}

const handoffStore = memorySessionStore();
const stagedHandoff = stageStoryWorkspaceHandoff({
  projectId: snapshot.project.id,
  prompt: advisorHandoff,
  source: "author-tools",
  handoffId: "author-tools-handoff-0001",
  createdAt: "2026-08-26T00:00:00.000Z",
}, handoffStore);
assert.equal(
  stagedHandoff.href,
  "/studio/project/project-contract/chat?handoff=author-tools-handoff-0001",
);
assert.doesNotMatch(stagedHandoff.href, /prompt=|黎安|候選/u);
assert.equal(
  consumeStoryWorkspaceHandoff({
    projectId: snapshot.project.id,
    handoffId: stagedHandoff.handoff.handoffId,
    now: Date.parse("2026-08-26T00:00:01.000Z"),
  }, handoffStore)?.prompt,
  advisorHandoff,
);
assert.equal(
  consumeStoryWorkspaceHandoff({
    projectId: snapshot.project.id,
    handoffId: stagedHandoff.handoff.handoffId,
    now: Date.parse("2026-08-26T00:00:02.000Z"),
  }, handoffStore),
  null,
);

const isolatedStore = memorySessionStore();
const isolatedHandoff = stageStoryWorkspaceHandoff({
  projectId: snapshot.project.id,
  prompt: advisorHandoff,
  source: "character-ai",
  handoffId: "character-ai-handoff-0001",
  createdAt: "2026-08-26T00:00:00.000Z",
}, isolatedStore);
assert.equal(
  consumeStoryWorkspaceHandoff({
    projectId: "different-project",
    handoffId: isolatedHandoff.handoff.handoffId,
    now: Date.parse("2026-08-26T00:00:01.000Z"),
  }, isolatedStore),
  null,
);

const [professional, page, workspace, navigation, chatPage, handoffWrapper, characterWorkspace] = await Promise.all([
  readFile("app/professional/professional-client.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/author-tools/page.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/author-tools/author-tools-workspace.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/project-navigation.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/chat/page.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/chat/conversation-handoff-workspace.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/character-ai/character-agent-workspace.tsx", "utf8"),
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
assert.match(workspace, /executeStudioClosedAgent\(\{/u);
assert.match(workspace, /taskType: "assistant\.critique"/u);
assert.match(workspace, /preferredBackend: advisorBackend/u);
assert.match(workspace, /hasVerifiedClosedModelResult\(result, advisorBackend\)/u);
assert.match(workspace, /validateClosedAuthorSuggestion\(result\.candidate\.content, snapshot\)/u);
assert.match(workspace, /不完整輸出已擋下，沒有用模板補成候選/u);
assert.match(workspace, /啟動／配對／實測閉端 AI/u);
assert.match(workspace, /一鍵帶到故事工作台/u);
assert.match(workspace, /stageStoryWorkspaceHandoff\(\{/u);
assert.match(workspace, /source: "author-tools"/u);
assert.doesNotMatch(workspace, /searchParams\.set\(\s*"prompt"/u);
assert.doesNotMatch(workspace, /approveStudioClosedAgentCandidate/u);
assert.match(navigation, /\["author-tools","研究與作者工具"\]/u);
assert.match(chatPage, /ConversationHandoffWorkspace/u);
assert.match(chatPage, /handoffId=\{handoffId\}/u);
assert.match(handoffWrapper, /consumeStoryWorkspaceHandoff\(\{ projectId, handoffId \}\)/u);
assert.match(handoffWrapper, /consumedHandoffRef\.current === handoffId/u);
assert.match(handoffWrapper, /作者候選交接已失效或不屬於此作品/u);
assert.match(characterWorkspace, /evaluateNovelContinuityGate\(\{/u);
assert.match(characterWorkspace, /continuityGate\.passed/u);
assert.match(characterWorkspace, /minimumHanCharacters: 550/u);
assert.match(characterWorkspace, /minimumParagraphs: 4/u);

console.log(JSON.stringify({
  status: "PASS",
  projectIsolation: true,
  realToolCount: 4,
  trueClosedAuthorAdvisor: true,
  readableTraditionalChineseCandidateGate: true,
  opaqueSessionHandoff: true,
  chatRedirect: false,
  canonicalMutationCount: 0,
}, null, 2));

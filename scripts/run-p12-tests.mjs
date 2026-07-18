import fs from "node:fs";
const read = (file) => fs.readFileSync(file, "utf8"),
  library = JSON.parse(read("data/story-library.json")),
  snapshot = JSON.parse(read("public/generated/story-library.json")),
  studio = read("app/studio/studio-client.tsx"),
  reader = read("app/studio/read/[projectId]/reader-client.tsx"),
  page = read("app/page.tsx"),
  health = read("app/api/ai/health/route.ts"),
  professional = read("app/professional/professional-client.tsx"),
  legacy = read("public/legacy/novel-system.html"),
  compactStudio = studio.replace(/\s+/g, "");
const results = [];
function test(name, fn) {
  try {
    if (!fn()) throw new Error("assertion returned false");
    results.push({ name, status: "PASS" });
  } catch (error) {
    results.push({ name, status: "FAIL", error: error.message });
  }
}
const classic = library.topics.filter((topic) => topic.classic),
  adult = library.topics.filter((topic) => topic.adultOnly),
  ids = library.topics.map((topic) => topic.topicId);
test("正式題材為218類", () => classic.length === 218);
test("分類包為11個", () => library.packs.length === 11);
test("消費者方向介於6至8", () =>
  library.consumerGroups.length >= 6 && library.consumerGroups.length <= 8);
test("題材ID唯一", () => new Set(ids).size === ids.length);
test("每個經典題材有12個細分類", () =>
  classic.every((topic) => topic.subCategories.length === 12));
test("正式快照與來源一致", () =>
  JSON.stringify(library) === JSON.stringify(snapshot));
test("舊頁面引用生成快照", () =>
  legacy.includes("/generated/story-library.js"));
test("首頁使用動態故事庫統計", () => page.includes("storyLibraryStats"));
test("成人題材與經典題材分離", () =>
  adult.length > 0 && adult.every((topic) => !topic.classic));
test("成人模式預設關閉", () => compactStudio.includes("adultMode:false"));
test("成人模式需要年齡確認", () =>
  compactStudio.includes("w.adultMode&&!w.ageConfirmed"));
test("成人題材需雙重條件", () =>
  compactStudio.includes("includeAdult:w.adultMode") &&
  compactStudio.includes("ageConfirmed:w.ageConfirmed"));
test("支援unset", () => studio.includes("blankOptional()"));
test("支援deferred", () => studio.includes('"deferred"'));
test("支援not_applicable", () => studio.includes('"not_applicable"'));
test("空白不填假值", () =>
  compactStudio.includes('draft:""') &&
  !compactStudio.includes('location||"陌生的世界"'));
test("未命名作品可建立", () =>
  compactStudio.includes('w.title.trim()||"未命名作品"'));
test("保持空白是建立方式", () =>
  compactStudio.includes('creationMethod==="blank"'));
test("玩法可保持未設定", () =>
  compactStudio.includes('playModeId:"",enabledStats:[]'));
test("數值不預設啟用", () =>
  library.storyStats.every((stat) => stat.enabledByDefault === false));
test("本機服務用sessionStorage權杖", () =>
  studio.includes('sessionStorage.getItem("novel_local_runtime_token")'));
test("外部服務預設關閉", () =>
  compactStudio.includes("externalFallbackAllowed:false"));
test("本機規則誠實標示", () => studio.includes("本機故事建議"));
test("Ollama白話標示", () => studio.includes("本機 AI 建議"));
test("AI結果不直接寫正文", () =>
  studio.includes("acceptCandidate") && studio.includes("採用這份建議"));
test("建議可修改後採用", () => studio.includes("修改後採用"));
test("建議可重新產生", () => studio.includes("再產生一份"));
test("建議可保持空白", () => studio.includes("保持空白"));
test("技術資訊預設收合", () =>
  compactStudio.includes("<details><summary>查看技術資訊</summary>"));
test("繁中指令送入本機模型", () =>
  studio.includes("只提出候選，不得假設空白欄位已設定"));
test("設定不足時不硬造故事", () => studio.includes("目前設定仍較少"));
for (const term of [
  "Draft Candidate",
  "Provider",
  "Runtime",
  "Retrieval",
  "Citation",
  "Data Left Device",
  "h2w3",
  "actualExecutor",
  "selectedProvider",
  "outputDestination",
  "externalConsent",
])
  test(`一般畫面不顯示 ${term}`, () =>
    !new RegExp(`>[\\s\\S]{0,40}${term}[\\s\\S]{0,40}<`, "i").test(studio));
test("沉浸閱讀只讀正式作品", () =>
  reader.includes("project.draft") && !reader.includes("candidate"));
test("閱讀設定四主題", () =>
  ["light", "night", "eye", "paper"].every((theme) => reader.includes(theme)));
test("閱讀進度保存", () => reader.includes("novel_reader_progress_"));
test("閱讀書籤", () => reader.includes("加入書籤"));
test("閱讀私人筆記不交AI", () => reader.includes("不會交給 AI"));
test("專注寫作模式", () =>
  studio.includes("focusMode") && studio.includes("離開專注模式"));
test("專注助手仍是建議", () =>
  studio.includes("小型 AI 助手") && studio.includes("SuggestionCard"));
test("A卡片可直接點擊", () =>
  studio.includes("key={choice.key}") &&
  studio.includes("setSelected(choice.key)"));
test("自訂決定可提交", () =>
  compactStudio.includes("custom.trim()||option.text"));
test("互動選擇立即顯示進度", () =>
  studio.includes("正在整理故事脈絡") && studio.includes("正在建立故事分支"));
test("互動生成可取消", () => studio.includes("controller.current?.abort()"));
test("互動結果顯示選擇", () => studio.includes("你選擇了"));
test("互動結果顯示故事發展", () => studio.includes("故事發展"));
test("互動結果顯示影響", () => studio.includes("可能影響"));
test("數值變化包含原因", () =>
  studio.includes("statChanges") && studio.includes("原因："));
test("接受後才建立分支", () =>
  studio.includes("acceptChoiceResult") &&
  compactStudio.includes("branches:[...value.branches"));
test("放棄不修改正式作品", () =>
  compactStudio.includes("discard={()=>update({candidate:null})}"));
test("回復同步正文與數值", () =>
  compactStudio.includes("draft:last.draft") &&
  compactStudio.includes("[project.id]:last.gameState"));
test("互動技術資訊收合", () =>
  compactStudio.includes("<details><summary>查看技術資訊</summary>"));
test("角色與世界有正式畫面", () => studio.includes("function WorldScreen"));
test("主角卡可點擊", () =>
  compactStudio.includes("onClick={()=>open(card.id)}"));
test("角色詳情使用對話框語意", () =>
  studio.includes('role="dialog"') && studio.includes('aria-modal="true"'));
test("角色可鍵盤操作", () => studio.includes("<button key={card.id}"));
test("角色修改先顯示預覽", () =>
  studio.includes("查看修改預覽") && studio.includes("變更預覽"));
test("放棄角色變更不寫入", () => studio.includes("放棄變更"));
test("接受角色變更建立版本", () =>
  studio.includes("updateProjectOptional") &&
  compactStudio.includes("versions:[old,...item.versions]"));
test("主角原型可開啟", () => compactStudio.includes('id:"archetype"'));
test("主要衝突可開啟", () => compactStudio.includes('id:"conflict"'));
test("世界背景可開啟", () => compactStudio.includes('id:"world"'));
test("角色設定可標記不適用", () =>
  studio.includes('blankOptional("not_applicable")'));
test("任務與成就使用作品專屬狀態", () =>
  studio.includes("gameStates: Record<string, GameState>") &&
  studio.includes("currentGame.tasks"));
test("數值變化保留原因與來源事件", () =>
  studio.includes("sourceType: \"player_choice\"") &&
  studio.includes("sourceEventId"));
test("體力與百分比數值不超出範圍", () =>
  studio.includes('stat === "stamina" || stat === "questProgress"') &&
  studio.includes("Math.max(0, Math.min(100, value))"));
test("一般小說不強制顯示數值", () =>
  studio.includes("這本作品尚未啟用故事數值"));
test("任務成就詳情可開啟", () =>
  studio.includes('kind: "task"') && studio.includes('kind: "achievement"'));
test("快速與完整備份均可建立", () =>
  studio.includes('startBackup("quick")') &&
  studio.includes('startBackup("full")'));
test("備份包含分支數值任務成就", () =>
  studio.includes("gameState: normalizeGameState") &&
  studio.includes("state.branches.filter"));
test("正式採用內容可觸發自動備份", () =>
  studio.match(/autoBackup === "accepted_content"/g)?.length >= 2);
test("每日備份每作品每日一次", () =>
  studio.includes("novel_daily_backup_") &&
  studio.includes('state.autoBackup !== "daily"'));
test("章節完成自動備份不假裝已接通", () =>
  studio.includes("尚未連接章節完成事件"));
test("舊版作品備份可轉換", () =>
  studio.includes("function coerceBackupPackage") &&
  studio.includes("source.currentProject") && studio.includes("source.novel"));
test("成人作品標記在遷移時保留", () =>
  studio.includes("adultMode: raw.adultMode === true"));
test("匯入預設建立新作品", () => studio.includes("匯入為新作品"));
test("安全還原先建立完整備份", () =>
  studio.includes('makeBackupRecord(project, "full", state)'));
test("備份誠實標示Story Bible未接通", () =>
  studio.includes('storyBibleStatus: "not_connected"'));
test("提供TXT Markdown HTML匯出", () =>
  ["下載 TXT", "下載 Markdown", "下載 HTML"].every((label) =>
    studio.includes(label),
  ));
test("專業工具首頁不是空殼", () =>
  professional.includes("AI 與執行狀態") &&
  professional.includes("資料管理") &&
  professional.includes("系統檢查"));
test("專業工具串接健康與本機狀態", () =>
  professional.includes('/api/ai/health') &&
  professional.includes("WebLocalRuntimeClient"));
test("專業工具保留Legacy入口", () =>
  professional.includes("/legacy/novel-system.html?mode=professional"));
test("健康狀態回報正式故事庫", () =>
  health.includes("storyLibraryClassicTopicCount") &&
  health.includes("progressiveCreationStatus"));
test("Browser AI誠實標示未實作", () =>
  health.includes('browserAiStatus: "not_implemented"'));
test("Ollama誠實標示需要本機環境", () =>
  health.includes('ollamaConsumerStatus: "runtime_required"'));
const failed = results.filter((result) => result.status === "FAIL");
console.log(
  JSON.stringify(
    {
      suite: "P1.2/P1.2A",
      pass: results.length - failed.length,
      fail: failed.length,
      skip: 0,
      results,
    },
    null,
    2,
  ),
);
if (failed.length) process.exitCode = 1;

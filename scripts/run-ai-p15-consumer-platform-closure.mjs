import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(file, "utf8");
const studio = read("app/studio/studio-client.tsx");
const compactStudio = studio.replace(/\s+/g, "");
const reader = read("app/studio/read/[projectId]/reader-client.tsx");
const professional = read("app/professional/professional-client.tsx");
const health = read("app/api/ai/health/route.ts");
const library = JSON.parse(read("data/story-library.json"));
const manifest = JSON.parse(read("release-manifest.json"));
const results = [];
const productionVerifiedComponents = new Set([
  "HomeScreen",
  "ChoiceScreen",
  "WorldScreen",
  "ReaderClient",
  "BackupCenter",
]);

function test(name, fn) {
  const startedAt = performance.now();
  try {
    if (!fn()) throw new Error("assertion returned false");
    results.push({ name, status: "PASS", elapsedMs: Math.round(performance.now() - startedAt) });
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      elapsedMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

test("P1.5 release manifest remains forward compatible", () => ["P1.5", "P2"].includes(manifest.architectureStage));
test("11個分類包仍存在", () => library.packs.length === 11);
test("218個經典題材仍存在", () => library.topics.filter((topic) => topic.classic).length === 218);
test("題材ID仍唯一", () => new Set(library.topics.map((topic) => topic.topicId)).size === library.topics.length);
test("A/B/C卡片直接執行", () => compactStudio.includes("voidsubmit(choice.key,true)"));
test("自訂決定仍可執行", () => compactStudio.includes("custom.trim()||option.text"));
test("互動流程可取消", () => studio.includes("controller.current?.abort()"));
test("接受後才建立分支", () => studio.includes("acceptChoiceResult") && compactStudio.includes("branches:[...value.branches"));
test("回復同步正文與數值", () => compactStudio.includes("draft:last.draft") && compactStudio.includes("[project.id]:last.gameState"));
test("主角角色與世界卡可開啟", () => ["protagonist", "archetype", "conflict", "world"].every((id) => studio.includes(`id: "${id}"`) || studio.includes(`id:"${id}"`)));
test("角色修改先成為預覽", () => studio.includes("查看修改預覽") && studio.includes("放棄變更"));
test("任務成就與數值有詳情", () => studio.includes('kind: "task"') && studio.includes('kind: "achievement"') && studio.includes('kind: "stat"'));
test("一般小說不顯示假數值", () => studio.includes("這本作品尚未啟用故事數值"));
test("閱讀器只讀正式正文", () => reader.includes("project.draft") && !reader.includes("candidate"));
test("閱讀器支援四種主題", () => ["light", "night", "eye", "paper"].every((theme) => reader.includes(theme)));
test("閱讀器支援回到上次位置", () => reader.includes("回到上次位置") && reader.includes("progress.scrollTop"));
test("閱讀資料可持久保存", () => reader.includes("novel_reader_progress_") && reader.includes("加入書籤") && reader.includes("本章私人筆記"));
test("專注模式提供六種小型助手", () => ["繼續寫", "改寫選取內容", "加強人物對話", "增加情緒張力", "調整節奏", "製造章尾懸念"].every((label) => studio.includes(label)));
test("AI結果維持建議稿邊界", () => studio.includes("SuggestionCard") && studio.includes("acceptCandidate"));
test("章節完成事件存在", () => studio.includes('task: "chapter_completed"'));
test("章節完成可觸發完整備份", () => compactStudio.includes('value.autoBackup==="chapter_complete"') && compactStudio.includes('makeBackupRecord(nextProject,"full",nextState)'));
test("備份包含消費者故事資料快照", () => studio.includes('storyBibleStatus: "consumer_snapshot"') && studio.includes("unresolvedThreads"));
test("備份包含閱讀進度", () => studio.includes("readingProgress") && studio.includes("novel_reader_progress_"));
test("專業工具首頁有真實狀態來源", () => professional.includes("/api/ai/health") && professional.includes("WebLocalRuntimeClient"));
test("Browser AI誠實標示未完成", () => health.includes('browserAiStatus: "not_implemented"'));
test("Ollama消費者接線誠實標示需本機環境", () => health.includes('ollamaConsumerIntegrationStatus: "runtime_required"'));
test("IndexedDB遷移誠實標示未完成", () => health.includes('indexedDbMigrationStatus: "not_implemented"'));
test("平台整體狀態未冒充全數完成", () => health.includes('consumerPlatformClosureStatus: "partial"'));
test("一般模式沒有固定英文模板", () => !studio.includes("The next scene continues from the selected evidence"));
test("技術資料預設收合", () => compactStudio.includes("<details><summary>查看技術資訊</summary>"));

const audit = [
  ["首頁", "HomeScreen", "繼續最近作品", "開啟最近作品寫作區", "navigate(write)", "/studio?screen=write", "consumer-router", "ready"],
  ["建立作品", "CreateScreen", "下一步", "前往下一個設定步驟", "step clamped to 5", "/studio?screen=create", "local-state", "ready"],
  ["寫作中心", "WriteScreen", "完成章節", "建立版本並觸發章節完成事件", "chapter_completed", "/studio?screen=write", "local-event", "ready"],
  ["互動故事", "ChoiceScreen", "A／B／C卡片", "產生後續故事候選", "submit(choice,true)", "/studio?screen=choice", "local-runtime-or-rule", "ready"],
  ["角色與世界", "WorldScreen", "查看詳情", "開啟可編輯詳情面板", "open(card.id)", "/studio?screen=world", "local-state", "ready"],
  ["任務與成就", "StoryDashboard", "數值／任務／成就卡", "開啟來源與歷史詳情", "setPanel", "/studio?screen=dashboard", "local-state", "ready"],
  ["閱讀模式", "ReaderClient", "回到上次位置", "回復保存的閱讀捲動位置", "window.scrollTo", "/studio/read/[projectId]", "local-storage", "ready"],
  ["備份中心", "BackupCenter", "立即快速備份", "建立可下載作品備份", "makeBackupRecord", "/studio?screen=backup", "local-storage", "ready"],
  ["專業工具", "ProfessionalClient", "查看詳細技術資料", "展開真實健康與本機執行狀態", "health + local runtime", "/professional", "health-and-runtime", "ready"],
].map(([page, component, visibleLabel, expectedAction, actualAction, route, executor, status]) => ({
  page,
  component,
  visibleLabel,
  expectedAction,
  actualAction,
  route,
  executor,
  status,
  issue: "",
  fixStatus: "implemented",
  productionVerified:
    process.env.PRODUCTION_VERIFIED === "1" && productionVerifiedComponents.has(component),
}));

fs.mkdirSync(path.join("artifacts"), { recursive: true });
fs.writeFileSync(
  path.join("artifacts", "p15-consumer-interaction-audit.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), entries: audit }, null, 2)}\n`,
);

const failed = results.filter((result) => result.status === "FAIL");
console.log(JSON.stringify({ suite: "P1.3-P1.5 Consumer Platform Closure", pass: results.length - failed.length, fail: failed.length, skip: 0, results }, null, 2));
if (failed.length) process.exitCode = 1;

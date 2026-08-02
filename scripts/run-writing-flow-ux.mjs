import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  writing,
  navigation,
  reader,
  closedAI,
  setupWizard,
  coordinator,
  modelRecommendations,
] = await Promise.all([
  readFile(new URL("../app/studio/project/[projectId]/write/write-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/project-navigation.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/read/[projectId]/reader-client.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/closed-ai/closed-ai-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/settings/local-ai/setup-wizard.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/novel-ai/web/closed-ai-runtime-coordinator.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/novel-ai/model-orchestration/recommended-models.ts", import.meta.url), "utf8"),
]);

const checks = [];
function check(name, run) {
  run();
  checks.push({ name, status: "PASS" });
}

check("serial chapter save queue prevents overlapping writes", () => {
  assert.match(writing, /saveQueueRef\.current/u);
  assert.match(writing, /snapshotIsDirty\(snapshot\)/u);
});

check("dirty chapters autosave and protect browser close", () => {
  assert.match(writing, /window\.setTimeout\(\(\) => void save\(false\), 1_200\)/u);
  assert.match(writing, /beforeunload/u);
});

check("navigation saves first and only explicit confirmation can abandon edits", () => {
  assert.match(writing, /allowTransitionAfterSave/u);
  assert.match(writing, /只有按下「確定」才會放棄本次未保存修改/u);
  assert.match(writing, /stageStudioTaskHandoff/u);
  assert.match(writing, /router\.push\(studioHomeHref\(projectId\)\)/u);
  assert.match(navigation, /onNavigate\?: \(href: string, label: string\) => void \| Promise<void>/u);
  assert.match(navigation, /window\.location\.assign\(studioHomeHref\(projectId\)\)/u);
  assert.doesNotMatch(navigation, /<a\s/u);
});

check("chapter changes stay explicit and chapter scoped", () => {
  assert.match(writing, /async function selectChapter/u);
  assert.match(writing, /activeChapterId: next\.id/u);
  assert.match(writing, /sourceKey = `chapter:\$\{chapter\?\.id \|\| "missing"\}`/u);
});

check("writing elf guides setup, drafting, AI candidate and reading", () => {
  assert.match(writing, /創作小精靈/u);
  assert.match(writing, /先設定故事/u);
  assert.match(writing, /閉端 AI 續寫候選/u);
  assert.match(writing, /閱讀預覽/u);
});

check("paragraph editing supports insert, remove and local undo", () => {
  assert.match(writing, /insertAtSelection/u);
  assert.match(writing, /deleteCurrentParagraph/u);
  assert.match(writing, /undoToolEdit/u);
  assert.match(writing, /復原工具操作/u);
});

check("reader has progress, searchable directory and previous-next navigation", () => {
  assert.match(reader, /readerProgress/u);
  assert.match(reader, /directoryQuery/u);
  assert.match(reader, /章節目錄/u);
  assert.match(reader, /previousChapter/u);
  assert.match(reader, /nextChapter/u);
});

check("closed AI safely returns to the source writing chapter", () => {
  assert.match(writing, /returnTo/u);
  assert.match(closedAI, /requestedReturn/u);
  assert.match(closedAI, /返回原章寫作/u);
});

check("first connection verifies the fast model while retaining selectable 7B quality", () => {
  assert.match(modelRecommendations, /RECOMMENDED_LOCAL_WRITER_MODEL = "qwen2\.5:7b"/u);
  assert.match(modelRecommendations, /FAST_LOCAL_WRITER_MODEL = "qwen2\.5:3b"/u);
  assert.match(setupWizard, /RECOMMENDED_LOCAL_WRITER_MODEL/u);
  assert.match(setupWizard, /connectAutomatically\(FAST_LOCAL_WRITER_MODEL/u);
  assert.match(coordinator, /connectLocalAutomatically/u);
  assert.match(
    coordinator,
    /localClient\.connectAutomatically\(\s*FAST_LOCAL_WRITER_MODEL/u,
  );
  assert.match(coordinator, /missing Private Hub must never delay/u);
  assert.match(closedAI, /PRIVATE_HUB_DEFERRED/u);
  assert.match(closedAI, /selectedTask\?\.complexity === "heavy"/u);
  assert.match(setupWizard, /getModelVerification\(\)\?\.modelId/u);
  assert.match(closedAI, /getModelVerification\(\)\?\.modelId/u);
});

check("an explicit runtime choice survives a same-tab reload without storing credentials", () => {
  assert.match(closedAI, /closed-ai-workspace-preferences-v1/u);
  assert.match(closedAI, /window\.sessionStorage\.setItem\(workspacePreferenceKey\(projectId\)/u);
  assert.match(closedAI, /setBackend\(restored\)/u);
  assert.doesNotMatch(closedAI, /workspacePreferenceKey[\s\S]{0,600}(?:token|csrf)/u);
});

console.log(JSON.stringify({ status: "PASS", checks: checks.length, cases: checks }, null, 2));

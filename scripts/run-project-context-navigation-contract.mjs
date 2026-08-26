import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  navigation,
  contextTabs,
  sections,
  characterAI,
  authorTools,
  storyContextRoute,
  peopleWorldRoute,
  progressRoute,
  legacyTimelineRoute,
  legacyStoryBibleRoute,
  stageSelectionPage,
  stageSelector,
] = await Promise.all([
  readFile(new URL("../app/studio/project/[projectId]/project-navigation.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/project-context-tabs.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/project-section-client.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/character-ai/character-agent-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/author-tools/author-tools-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/story-context/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/people-world/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/progress/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/timeline/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/story-bible/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/story-stage-selection-page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/story-stage-selector.tsx", import.meta.url), "utf8"),
]);

const checks = [];
function check(name, run) {
  run();
  checks.push({ name, status: "PASS" });
}

check("project navigation exposes grouped tiles only", () => {
  const projectLinks = navigation.match(/const PROJECT_LINKS = \[([\s\S]*?)\] as const;/u)?.[1] ?? "";
  assert.match(projectLinks, /\["story-context","故事脈絡"\]/u);
  assert.match(projectLinks, /\["people-world","人物與世界"\]/u);
  assert.match(projectLinks, /\["ai-hub","AI 協調與學習"\]/u);
  assert.match(projectLinks, /\["progress-hub","進度與目標"\]/u);
  assert.match(projectLinks, /\["data-safety","作品與安全"\]/u);
  assert.doesNotMatch(projectLinks, /\["(?:timeline|story-bible|characters|character-ai|world|closed-ai|learning|write|tasks|achievements|backups)"/u);
});

check("all project tools stay collapsed until the author opens them", () => {
  assert.match(navigation, /<details className="p2ProjectTools">/u);
  assert.doesNotMatch(navigation, /<details className="p2ProjectTools"\s+open=/u);
});

check("optional handoff storage cannot block a real navigation", () => {
  assert.match(navigation, /try \{[\s\S]*stageStudioTaskHandoff/u);
  assert.match(navigation, /finally \{[\s\S]*window\.location\.assign\(href\)/u);
});

check("active author tool keeps URL and visible tool in sync", () => {
  assert.match(navigation, /activeHref\?: string/u);
  assert.match(navigation, /linkActive && activeHref/u);
  assert.match(authorTools, /useRouter, useSearchParams/u);
  assert.match(authorTools, /router\.replace\(`\?\$\{nextParams\.toString\(\)\}`/u);
  assert.match(authorTools, /activeHref=\{`\/studio\/project\/\$\{encodeURIComponent\(projectId\)\}\/author-tools\?tool=/u);
});

check("story context keeps both selection-only views and reports the Canon boundary", () => {
  assert.match(contextTabs, /label: "時間線"/u);
  assert.match(contextTabs, /label: "故事記憶"/u);
  assert.match(contextTabs, /唯讀事件與上場選擇/u);
  assert.match(contextTabs, /唯讀 Canon 與上場記憶/u);
  assert.match(stageSelectionPage, /data-canon-edit-surface="story-selection-only"/u);
  assert.match(stageSelector, /Story Bible 與上場記憶/u);
  assert.match(stageSelector, /activeTimelineEventIds/u);
});

check("new story-context route and old deep links all render selection-only surfaces", () => {
  assert.match(storyContextRoute, /requestedView === "story-bible"/u);
  assert.match(storyContextRoute, /StoryStageSelectionPage/u);
  assert.doesNotMatch(storyContextRoute, /project-section-client/u);
  assert.match(legacyTimelineRoute, /focus="timeline"/u);
  assert.match(legacyStoryBibleRoute, /focus="story-bible"/u);
  assert.doesNotMatch(legacyTimelineRoute, /project-section-client/u);
  assert.doesNotMatch(legacyStoryBibleRoute, /project-section-client/u);
});

check("people and world share one entry with three clear views", () => {
  assert.match(contextTabs, /label: "角色資料"/u);
  assert.match(contextTabs, /label: "角色視角 AI"/u);
  assert.match(contextTabs, /label: "世界設定"/u);
  assert.match(peopleWorldRoute, /requestedView === "character-ai"/u);
  assert.match(peopleWorldRoute, /requestedView === "world"/u);
  assert.match(peopleWorldRoute, /StoryStageSelectionPage/u);
  assert.doesNotMatch(peopleWorldRoute, /project-section-client/u);
  assert.match(characterAI, /context="people-world" active="character-ai"/u);
});

check("AI coordination and learning keep two deep-linkable child views", () => {
  assert.match(contextTabs, /label: "AI 協調"/u);
  assert.match(contextTabs, /label: "AI 學習"/u);
  assert.match(navigation, /\["ai-hub", "closed-ai", "learning"\]/u);
  assert.match(navigation, /context="ai"/u);
});

check("tasks and achievements share progress while backups stay under safety", () => {
  assert.match(contextTabs, /label: "任務"/u);
  assert.match(contextTabs, /label: "成就"/u);
  assert.match(progressRoute, /requestedView === "achievements"/u);
  assert.match(sections, /context="progress" active="tasks"/u);
  assert.match(sections, /context="progress" active="achievements"/u);
  assert.match(navigation, /"data-safety": \["data-safety", "backups"\]/u);
});

console.log(JSON.stringify({ status: "PASS", checks: checks.length, cases: checks }, null, 2));

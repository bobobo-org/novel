import assert from "node:assert/strict";
import fs from "node:fs";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import {
  buildProjectBundle,
  createDraft,
} from "../lib/novel-ai/domain/creation.ts";
import {
  makeRecord,
  optionalValue,
} from "../lib/novel-ai/domain/index.ts";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/memory/memory-repository.ts";
import { IndexedDbNovelRepository } from "../lib/novel-ai/repository/indexeddb/indexeddb-repository.ts";
import { createProjectBackup } from "../lib/novel-ai/repository/backup.ts";
import {
  buildTopicWorldFamilyStageMatrix,
  serializeTopicWorldFamilyDraftSelection,
} from "../lib/novel-ai/game/topic-world-family-stage-matrix.ts";
import {
  PROJECT_PLAYMODE_CLONE_VERSION,
  ProjectCloneSourceError,
  buildProjectPlaymodeCloneDraft,
  buildProjectPlaymodeCloneDraftWithRetry,
  isCurrentProjectPlaymodeCloneDraft,
} from "../lib/novel-ai/repository/project-playmode-clone.ts";

const checks = [];
const check = (name, condition) => {
  assert.equal(Boolean(condition), true, name);
  checks.push(name);
};

const selectStageFamily = (draft, playMode) => {
  const matrix = buildTopicWorldFamilyStageMatrix({
    seed: `novel-project:${draft.projectId}:procedural-v1`,
    topicId: draft.genreId,
    playMode,
  });
  draft.answers.stageFamily = optionalValue(
    serializeTopicWorldFamilyDraftSelection({
      matrix,
      familyId: matrix.stageFamilies[0].familyId,
    }),
    "user_defined",
  );
};

const sourceDraft = createDraft("quick");
sourceDraft.title = "來源作品";
sourceDraft.genrePackId = "pack-9";
sourceDraft.genreId = "classic-topic-002";
sourceDraft.coreIdea = optionalValue("一位調查員追查會改寫承諾的城市。", "user_defined");
sourceDraft.protagonist = optionalValue("沈星河", "user_defined");
sourceDraft.style = optionalValue("場景先行，選擇留下後果。", "user_defined");
sourceDraft.answers.playMode = optionalValue("management", "user_defined");
sourceDraft.answers.playStructure = optionalValue("choice", "user_defined");
sourceDraft.answers.language = optionalValue("zh-TW", "user_defined");
sourceDraft.answers.worldRule = optionalValue("每一次承諾都會改變資源。", "user_defined");
sourceDraft.answers.conflict = optionalValue("主角必須在守信與救人之間取捨。", "user_defined");
sourceDraft.answers.opening = optionalValue("失蹤者留下明日才會寄出的信。", "user_defined");
selectStageFamily(sourceDraft, "management");

const repository = new MemoryNovelRepository();
const sourceBundle = buildProjectBundle(sourceDraft);
await repository.createProject(sourceBundle, "create:clone-source");
await repository.put("chapters", {
  ...makeRecord(sourceBundle.project.id),
  title: "第一章",
  order: 1,
  content: "這是原作品正文，絕對不可寫入新玩法草稿。",
  summary: "原作第一章摘要",
  status: "draft",
});
const worldRule = await repository.put("worldRules", {
  ...makeRecord(sourceBundle.project.id),
  title: "承諾規則",
  description: "每一次承諾都會改變資源。",
  immutable: true,
});
await repository.put("storyBibles", {
  ...sourceBundle.storyBible,
  worldRuleIds: [worldRule.id],
  unresolvedThreads: ["主角必須在守信與救人之間取捨。"],
}, sourceBundle.storyBible.revision);

const sourceBefore = await repository.exportProject(sourceBundle.project.id);
const clone = await buildProjectPlaymodeCloneDraft(repository, sourceBundle.project.id);
const sourceAfterRead = await repository.exportProject(sourceBundle.project.id);

check("clone helper is read-only", JSON.stringify(sourceAfterRead) === JSON.stringify(sourceBefore));
check("clone draft has a fresh project id", clone.draft.projectId !== sourceBundle.project.id);
check("clone draft requires a new title", clone.draft.title === "");
check("clone draft requires explicit play mode", clone.draft.answers.playMode?.value === null);
check("clone draft carries current clone contract", clone.draft.answers.cloneFlowVersion?.value === PROJECT_PLAYMODE_CLONE_VERSION);
check("clone draft carries source lineage", clone.draft.answers.cloneFrom?.value === sourceBundle.project.id);
check("clone source title and play mode are visible data", clone.source.sourceTitle === "來源作品" && clone.source.sourcePlayMode === "management");
check("clone source reports chapters without copying prose", clone.source.sourceChapterCount === 1 && !JSON.stringify(clone.draft).includes("絕對不可寫入"));
check("project settings are prefilled", clone.draft.genrePackId === "pack-9" && clone.draft.genreId === "classic-topic-002");
check("necessary story seed is prefilled", clone.draft.seedCandidate?.protagonist.value === "沈星河" && clone.draft.seedCandidate?.worldRule.value === "每一次承諾都會改變資源。");
check("current clone draft is recognized", isCurrentProjectPlaymodeCloneDraft(clone.draft, sourceBundle.project.id));
check("source project cannot masquerade as clone draft", !isCurrentProjectPlaymodeCloneDraft({ ...clone.draft, projectId: sourceBundle.project.id }, sourceBundle.project.id));

clone.draft.title = "來源作品：RPG 支線";
clone.draft.answers.playStructure = optionalValue("choice", "user_defined");
clone.draft.answers.playMode = optionalValue("rpg", "user_defined");
selectStageFamily(clone.draft, "rpg");
const targetBundle = buildProjectBundle(clone.draft);
check("confirmed target play mode is independent", targetBundle.storyState.worldFlags["story.playMode"] === "rpg");
check("new StoryState retains local lineage", targetBundle.storyState.worldFlags["story.cloneFromProjectId"] === sourceBundle.project.id);
check("new Canon ids are independent", targetBundle.storyBible.id !== sourceBundle.storyBible.id && targetBundle.storyState.id !== sourceBundle.storyState.id);

await repository.createProject(targetBundle, "create:clone-target");
const targetChapter = await repository.put("chapters", {
  ...makeRecord(targetBundle.project.id),
  title: "第一章",
  order: 1,
  content: "",
  summary: targetBundle.seed.opening.value,
  status: "draft",
});
await repository.put("projects", {
  ...targetBundle.project,
  activeChapterId: targetChapter.id,
}, targetBundle.project.revision);
await createProjectBackup(repository, targetBundle.project.id, "full");

const targetRecords = await repository.exportProject(targetBundle.project.id);
check("new project has real initial and full backups", targetRecords.backups.length === 2);
check("new project has one fresh chapter", targetRecords.chapters.length === 1 && targetRecords.chapters[0].projectId === targetBundle.project.id);
check("new project has its own Canon", targetRecords.storyBibles.length === 1 && targetRecords.storyBibles[0].projectId === targetBundle.project.id);
const sourceAfterCreate = await repository.exportProject(sourceBundle.project.id);
check("creating clone never mutates source", JSON.stringify(sourceAfterCreate) === JSON.stringify(sourceBefore));

// Exercise the same persistence boundary as the real create page: finish the
// source with one repository instance, then immediately open a fresh instance
// (the route-transition shape) and resolve cloneFrom from IndexedDB.
globalThis.indexedDB = fakeIndexedDB;
const indexedSourceDraft = createDraft("quick");
indexedSourceDraft.title = "IndexedDB 即時來源";
indexedSourceDraft.genreId = "classic-topic-002";
indexedSourceDraft.coreIdea = optionalValue("建立完成後立刻讀取。", "user_defined");
indexedSourceDraft.protagonist = optionalValue("即時測試者", "user_defined");
indexedSourceDraft.answers.playMode = optionalValue("general", "user_defined");
indexedSourceDraft.answers.playStructure = optionalValue("general", "user_defined");
indexedSourceDraft.answers.worldRule = optionalValue("來源必須可由新 repository 讀取。", "user_defined");
indexedSourceDraft.answers.conflict = optionalValue("跨路由讀取失敗。", "user_defined");
indexedSourceDraft.answers.opening = optionalValue("建立成功後切換 cloneFrom。", "user_defined");
selectStageFamily(indexedSourceDraft, "general");
const indexedSourceBundle = buildProjectBundle(indexedSourceDraft);
const indexedCreateRepository = new IndexedDbNovelRepository();
await indexedCreateRepository.createProject(indexedSourceBundle, "create:indexed-clone-source");
const indexedChapter = await indexedCreateRepository.put("chapters", {
  ...makeRecord(indexedSourceBundle.project.id),
  title: "第一章",
  order: 1,
  content: "不可複製的正文",
  summary: indexedSourceBundle.seed.opening.value,
  status: "draft",
});
await indexedCreateRepository.put("projects", {
  ...indexedSourceBundle.project,
  activeChapterId: indexedChapter.id,
}, indexedSourceBundle.project.revision);
await createProjectBackup(indexedCreateRepository, indexedSourceBundle.project.id, "full");

const indexedRouteRepository = new IndexedDbNovelRepository();
const indexedDirectSource = await indexedRouteRepository.get("projects", indexedSourceBundle.project.id);
check("fresh IndexedDB repository reads project created by prior route", indexedDirectSource?.id === indexedSourceBundle.project.id);
const indexedClone = await buildProjectPlaymodeCloneDraft(indexedRouteRepository, indexedSourceBundle.project.id);
check("immediate IndexedDB clone route resolves source", indexedClone.source.sourceTitle === "IndexedDB 即時來源");
check("immediate IndexedDB clone route does not copy prose", !JSON.stringify(indexedClone.draft).includes("不可複製的正文"));

function repositoryWithGet(repository, get) {
  return new Proxy(repository, {
    get(target, property) {
      if (property === "get") return get;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

let visibilityReads = 0;
const delayedVisibilityRepository = repositoryWithGet(
  indexedRouteRepository,
  async (store, id) => {
    visibilityReads += 1;
    if (store === "projects" && visibilityReads < 3) return null;
    return indexedRouteRepository.get(store, id);
  },
);
const visibilityWaits = [];
const delayedVisibilityClone = await buildProjectPlaymodeCloneDraftWithRetry(
  delayedVisibilityRepository,
  indexedSourceBundle.project.id,
  { delaysMs: [10, 20, 30], sleep: async (delayMs) => { visibilityWaits.push(delayMs); } },
);
check(
  "bounded loader survives immediate IndexedDB visibility delay",
  delayedVisibilityClone.source.sourceTitle === "IndexedDB 即時來源"
    && visibilityReads === 3
    && visibilityWaits.join(",") === "10,20",
);

let transientReads = 0;
const transientReadRepository = repositoryWithGet(
  indexedRouteRepository,
  async (store, id) => {
    transientReads += 1;
    if (transientReads === 1) throw { code: "INDEXEDDB_REQUEST_FAILED" };
    return indexedRouteRepository.get(store, id);
  },
);
const transientWaits = [];
const transientReadClone = await buildProjectPlaymodeCloneDraftWithRetry(
  transientReadRepository,
  indexedSourceBundle.project.id,
  { delaysMs: [25, 50], sleep: async (delayMs) => { transientWaits.push(delayMs); } },
);
check(
  "bounded loader retries a transient IndexedDB read error",
  transientReadClone.source.sourceTitle === "IndexedDB 即時來源"
    && transientReads === 2
    && transientWaits.join(",") === "25",
);

let missingReads = 0;
const boundedMissingRepository = repositoryWithGet(
  repository,
  async () => { missingReads += 1; return null; },
);
await assert.rejects(
  () => buildProjectPlaymodeCloneDraftWithRetry(
    boundedMissingRepository,
    "missing-bounded-project",
    { delaysMs: [0, 0], sleep: async () => {} },
  ),
  (error) => error instanceof ProjectCloneSourceError && error.code === "PROJECT_CLONE_SOURCE_NOT_FOUND",
);
check("missing source retry budget is finite", missingReads === 3);

let nonRetryableWaits = 0;
const nonRetryableRepository = repositoryWithGet(
  indexedRouteRepository,
  async () => { throw { code: "INDEXEDDB_PERMISSION_DENIED" }; },
);
await assert.rejects(
  () => buildProjectPlaymodeCloneDraftWithRetry(
    nonRetryableRepository,
    indexedSourceBundle.project.id,
    { delaysMs: [0, 0, 0], sleep: async () => { nonRetryableWaits += 1; } },
  ),
  (error) => error?.code === "INDEXEDDB_PERMISSION_DENIED",
);
check("non-transient IndexedDB error fails without retry", nonRetryableWaits === 0);

await assert.rejects(
  () => buildProjectPlaymodeCloneDraft(repository, "missing-project"),
  (error) => error instanceof ProjectCloneSourceError && error.code === "PROJECT_CLONE_SOURCE_NOT_FOUND",
);
checks.push("missing source produces explicit typed error");
await assert.rejects(
  () => buildProjectPlaymodeCloneDraft(repository, "invalid/source"),
  (error) => error instanceof ProjectCloneSourceError && error.code === "PROJECT_CLONE_SOURCE_INVALID",
);
checks.push("invalid source produces explicit typed error");

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const client = read("app/studio/create/create-project-client.tsx");
const page = read("app/studio/create/page.tsx");
check("clone UI always revalidates IndexedDB source", /Always re-read the canonical IndexedDB source/u.test(client) && /buildProjectPlaymodeCloneDraftWithRetry\(createNovelRepository\(\), cloneFrom\)/u.test(client));
check("clone UI visibly identifies source", /data-testid="clone-source-banner"/u.test(client) && /複製來源已確認/u.test(client));
check("clone UI has truthful recovery", /data-testid="clone-source-error"/u.test(client) && /改為一般建立新作品/u.test(client) && /重試讀取/u.test(client) && /回作品庫確認/u.test(client));
check("invalid query is not silently changed to normal create", /Silently converting it to a normal create flow/u.test(page) && /rawCloneFrom\.slice\(0, 512\)/u.test(page));

console.log(JSON.stringify({
  suite: "PROJECT_PLAYMODE_CLONE",
  pass: checks.length,
  fail: 0,
  checks,
}, null, 2));

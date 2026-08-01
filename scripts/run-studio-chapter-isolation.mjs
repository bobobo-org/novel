import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { makeRecord } from "../lib/novel-ai/domain/index.ts";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/index.ts";
import {
  completeStudioChapter,
  ensureStudioCanonicalProject,
  saveStudioChapter,
} from "../lib/novel-ai/repository/studio-canonical.ts";
import { commitStudioCandidateToChapter } from "../lib/novel-ai/web/studio-canonical-approval.ts";

const cases = [];

async function test(name, work) {
  try {
    await work();
    cases.push({ name, status: "PASS" });
  } catch (error) {
    cases.push({
      name,
      status: "FAIL",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const repository = new MemoryNovelRepository();
const projectId = "chapter-isolation-project";
const initial = await ensureStudioCanonicalProject(repository, {
  id: projectId,
  title: "章節隔離驗收",
  chapterTitle: "第一章",
  draft: "第一章原文。",
});
const second = await repository.put("chapters", {
  ...makeRecord(projectId, "user"),
  title: "第二章",
  order: 2,
  content: "第二章原文。",
  summary: null,
  status: "draft",
});
const projectBeforeSwitch = await repository.get("projects", projectId);
await repository.put("projects", {
  ...projectBeforeSwitch,
  activeChapterId: second.id,
}, projectBeforeSwitch.revision);

await test("saving second chapter never mutates first chapter", async () => {
  await saveStudioChapter(repository, {
    id: projectId,
    title: "章節隔離驗收",
    chapterId: second.id,
    chapterTitle: "第二章",
    draft: "第二章獨立內容。",
  });
  assert.equal((await repository.get("chapters", initial.chapter.id)).content, "第一章原文。");
  assert.equal((await repository.get("chapters", second.id)).content, "第二章獨立內容。");
});

await test("targeted save remains chapter-scoped when another chapter is active", async () => {
  await saveStudioChapter(repository, {
    id: projectId,
    title: "章節隔離驗收",
    chapterId: initial.chapter.id,
    chapterTitle: "第一章",
    draft: "第一章重寫後內容。",
  });
  assert.equal((await repository.get("chapters", initial.chapter.id)).content, "第一章重寫後內容。");
  assert.equal((await repository.get("chapters", second.id)).content, "第二章獨立內容。");
  assert.equal((await repository.get("projects", projectId)).activeChapterId, second.id);
});

await test("rewrite replaces its source chapter in place", async () => {
  const current = await repository.get("chapters", second.id);
  const result = await commitStudioCandidateToChapter({
    repository,
    projectId,
    chapterId: second.id,
    sourceRevision: current.revision,
    taskId: "rewrite-second",
    idempotencyKey: "rewrite-second-once",
    content: "第二章完整重寫版本。",
    mode: "replace",
  });
  assert.equal(result.chapter.content, "第二章完整重寫版本。");
  assert.equal(result.chapter.content.includes("第二章獨立內容。"), false);
  assert.equal((await repository.get("chapters", initial.chapter.id)).content, "第一章重寫後內容。");
});

await test("continuation appends only to its source chapter", async () => {
  const current = await repository.get("chapters", second.id);
  const result = await commitStudioCandidateToChapter({
    repository,
    projectId,
    chapterId: second.id,
    sourceRevision: current.revision,
    taskId: "continue-second",
    idempotencyKey: "continue-second-once",
    content: "第二章續文。",
    mode: "append",
  });
  assert.equal(result.chapter.content, "第二章完整重寫版本。\n\n第二章續文。");
  assert.equal((await repository.get("chapters", initial.chapter.id)).content, "第一章重寫後內容。");
});

await test("stale rewrite cannot overwrite a newer chapter revision", async () => {
  const current = await repository.get("chapters", second.id);
  await assert.rejects(
    () => commitStudioCandidateToChapter({
      repository,
      projectId,
      chapterId: second.id,
      sourceRevision: current.revision - 1,
      taskId: "stale-rewrite-second",
      content: "不應寫入。",
      mode: "replace",
    }),
    (error) => error?.code === "GENERATION_SOURCE_REVISION_STALE",
  );
  assert.equal((await repository.get("chapters", second.id)).content, "第二章完整重寫版本。\n\n第二章續文。");
});

await test("chapter completion backs up the completed chapter before opening the next chapter", async () => {
  const completionRepository = new MemoryNovelRepository();
  const seeded = await ensureStudioCanonicalProject(completionRepository, {
    id: "chapter-completion-backup-project",
    title: "完成與備份驗收",
    chapterTitle: "第一章",
    draft: "尚未完成的舊正文。",
  });
  const result = await completeStudioChapter(completionRepository, {
    projectId: seeded.project.id,
    chapterId: seeded.chapter.id,
    chapterTitle: "第一章・雨夜",
    draft: "按下完成前的最新正文。",
    createFullBackup: true,
    release: { appCommit: "test-commit", releaseTag: "test-release" },
  });
  const backupProject = result.backup.payload.records.projects[0];
  const backupChapters = result.backup.payload.records.chapters;

  assert.equal(result.completedChapter.title, "第一章・雨夜");
  assert.equal(result.completedChapter.content, "按下完成前的最新正文。");
  assert.equal(result.completedChapter.status, "completed");
  assert.equal(backupProject.activeChapterId, result.completedChapter.id);
  assert.equal(backupChapters.some((chapter) => chapter.id === result.nextChapter.id), false);
  assert.equal((await completionRepository.get("projects", seeded.project.id)).activeChapterId, result.nextChapter.id);
  assert.equal(result.nextChapter.content, "");
  assert.equal(result.nextChapter.status, "draft");
});

await test("studio UI exposes real chapter controls and source-identity guard", async () => {
  const source = await readFile("app/studio/studio-client.tsx", "utf8");
  assert.match(source, /data-testid="studio-chapter-manager"/);
  assert.match(source, /完成本章並建立下一章/);
  assert.match(source, /請先採用或放棄目前 AI 候選，再切換章節/);
  assert.match(source, /chapterId: project\.activeChapterId/);
});

const failed = cases.filter((entry) => entry.status === "FAIL");
console.log(JSON.stringify({
  schemaVersion: "studio-chapter-isolation-v1",
  status: failed.length ? "FAIL" : "PASS",
  pass: cases.length - failed.length,
  fail: failed.length,
  cases,
}, null, 2));
if (failed.length) process.exitCode = 1;

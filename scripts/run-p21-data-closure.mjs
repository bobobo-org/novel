import assert from "node:assert/strict";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/memory/memory-repository.ts";
import { buildProjectBundle, createDraft } from "../lib/novel-ai/domain/creation.ts";
import { makeRecord, optionalValue } from "../lib/novel-ai/domain/index.ts";
import { createProjectBackup, validateBackupPayload } from "../lib/novel-ai/repository/backup.ts";

const cases = []; const test = async (name, work) => { try { await work(); cases.push({ name, status: "PASS" }); } catch (error) { cases.push({ name, status: "FAIL", error: error.message }); throw error; } };
const repo = new MemoryNovelRepository();
const draft = createDraft("quick"); draft.title = "P2.1 Round Trip"; draft.coreIdea = optionalValue("A door remembers every reader.", "user_defined"); draft.protagonist = optionalValue("Lin Zhao", "user_defined");
const original = buildProjectBundle(draft);
await test("project creation is idempotent", async () => { await repo.createProject(original, "p21-create"); const replay = await repo.createProject(original, "p21-create"); assert.equal(replay.project.id, original.project.id); });
await test("chapter character world reader note bookmark persist in one project", async () => {
  await repo.put("chapters", { ...makeRecord(original.project.id), id: "chapter-1", title: "Chapter one", order: 1, content: "The door opened.", summary: null, status: "completed" });
  await repo.put("readerNotes", { ...makeRecord(original.project.id), id: "note-1", chapterId: "chapter-1", anchor: "0:The door", excerpt: "The door opened.", content: "Important clue", needsRelocation: false });
  await repo.put("readerBookmarks", { ...makeRecord(original.project.id), id: "bookmark-1", chapterId: "chapter-1", anchor: "0:The door", excerpt: "The door opened.", label: "Opening", needsRelocation: false });
  const state = (await repo.list("readerStates", original.project.id))[0]; await repo.put("readerStates", { ...state, chapterId: "chapter-1", positionType: "anchor", positionValue: .42, contentAnchor: "0:The door", percentage: 42, fontSize: 24 });
  assert.equal((await repo.list("readerNotes", original.project.id)).length, 1); assert.equal((await repo.list("readerBookmarks", original.project.id)).length, 1);
});
const { payload } = await createProjectBackup(repo, original.project.id, "full", { appCommit: "test", releaseTag: "p21" });
await test("backup manifest validates and includes reader data", async () => { const checked = await validateBackupPayload(payload); assert.equal(checked.valid, true); assert.equal(payload.manifest.recordCounts.readerNotes, 1); assert.equal(payload.manifest.recordCounts.readerBookmarks, 1); });
await test("tampered backup is rejected", async () => { const tampered = structuredClone(payload); tampered.records.chapters[0].content = "tampered"; const checked = await validateBackupPayload(tampered); assert.equal(checked.valid, false); });
const copyId = await repo.importProject(payload.records, "copy");
await test("copy import preserves full data and isolates project ids", async () => { assert.notEqual(copyId, original.project.id); assert.equal((await repo.list("chapters", copyId)).length, 1); assert.equal((await repo.list("readerNotes", copyId)).length, 1); const copyChapter = (await repo.list("chapters", copyId))[0]; assert.equal(copyChapter.content, "The door opened."); await repo.put("chapters", { ...copyChapter, content: "Copy changed." }, copyChapter.revision); assert.equal((await repo.list("chapters", original.project.id))[0].content, "The door opened."); });
await test("replace restore restores original content", async () => { const chapter = (await repo.list("chapters", original.project.id))[0]; await repo.put("chapters", { ...chapter, content: "Changed before restore." }, chapter.revision); await repo.importProject(payload.records, "replace", original.project.id); assert.equal((await repo.list("chapters", original.project.id))[0].content, "The door opened."); });
await test("revision conflict is not silently overwritten", async () => { const chapter = (await repo.list("chapters", original.project.id))[0]; await repo.put("chapters", { ...chapter, content: "new" }, chapter.revision); await assert.rejects(() => repo.put("chapters", { ...chapter, content: "old" }, chapter.revision)); });
console.log(JSON.stringify({ suite: "p21-data-closure", pass: cases.filter((item) => item.status === "PASS").length, fail: cases.filter((item) => item.status === "FAIL").length, cases }, null, 2));

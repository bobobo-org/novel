import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { IndexedDbNovelRepository } from "../lib/novel-ai/repository/indexeddb/indexeddb-repository.ts";
import { buildProjectBundle, createDraft } from "../lib/novel-ai/domain/creation.ts";
import { makeRecord, optionalValue } from "../lib/novel-ai/domain/index.ts";
import {
  buildTopicWorldFamilyStageMatrix,
  serializeTopicWorldFamilyDraftSelection,
} from "../lib/novel-ai/game/topic-world-family-stage-matrix.ts";
import {
  buildRpgContextRevisionGuard,
  RPG_CONTEXT_REVISION_STORE_NAMES,
} from "../lib/novel-ai/services/rpg-context-revision/index.ts";
import { createProjectBackup, validateBackupPayload } from "../lib/novel-ai/repository/backup.ts";

const results = [];
async function test(name, work) {
  const started = performance.now();
  try { await work(); results.push({ name, status: "PASS", elapsedMs: Math.round(performance.now() - started) }); }
  catch (error) { results.push({ name, status: "FAIL", elapsedMs: Math.round(performance.now() - started), error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }); }
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
async function digest(value) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((item) => item.toString(16).padStart(2, "0")).join("");
}
const effect = { statChanges: {}, relationshipChanges: {}, resourceChanges: {}, moneyChange: 0, worldFlags: {}, questProgress: {}, achievementProgress: {}, timelineEvents: [] };
async function fixture(label, { fullContextGuard = false } = {}) {
  const repository = new IndexedDbNovelRepository();
  const draft = createDraft("quick");
  draft.title = `IndexedDB ${label} ${crypto.randomUUID()}`;
  draft.genrePackId = "pack-6";
  draft.genreId = "classic-topic-009";
  draft.coreIdea = optionalValue("A decision is persisted.", "user_defined");
  draft.protagonist = optionalValue("Lin Zhao", "user_defined");
  const stageMatrix = buildTopicWorldFamilyStageMatrix({
    seed: `novel-project:${draft.projectId}:procedural-v1`,
    topicId: draft.genreId,
    playMode: "general",
  });
  draft.answers.stageFamily = optionalValue(
    serializeTopicWorldFamilyDraftSelection({
      matrix: stageMatrix,
      familyId: stageMatrix.stageFamilies[0].familyId,
    }),
    "user_defined",
  );
  const bundle = buildProjectBundle(draft);
  await repository.createProject(bundle, `indexeddb:${bundle.project.id}`);
  const chapter = await repository.put("chapters", { ...makeRecord(bundle.project.id, "user"), title: "One", order: 1, content: "Opening.", summary: null, status: "draft" });
  const project = await repository.put("projects", { ...bundle.project, activeChapterId: chapter.id }, bundle.project.revision);
  const storyState = (await repository.list("storyStates", project.id))[0];
  const storyBible = (await repository.list("storyBibles", project.id))[0];
  const base = makeRecord(project.id, "ai_candidate");
  let candidate = await repository.put("candidates", {
    ...base,
    provenance: { ...base.provenance, providerId: "deterministic-test", modelId: "rules-v1", taskType: "interactive_choice", externalRequest: false, dataLeftDevice: false, contextSources: [], elapsedMs: 0 },
    prompt: "", optionKey: "A", text: "Open", consequence: "", effect, status: "pending", chapterId: chapter.id, sceneId: null,
    inputRevision: project.revision, chapterRevision: chapter.revision, storyStateRevision: storyState.revision, storyBibleRevision: storyBible.revision,
  });
  let rpgContextRevisionGuard;
  if (fullContextGuard) {
    const contextEntries = await Promise.all(RPG_CONTEXT_REVISION_STORE_NAMES.map(async (store) => (
      [store, await repository.list(store, project.id)]
    )));
    rpgContextRevisionGuard = await buildRpgContextRevisionGuard(Object.fromEntries(contextEntries));
    candidate = await repository.put("candidates", {
      ...candidate,
      rpgContextRevisionGuard: structuredClone(rpgContextRevisionGuard),
    }, candidate.revision);
  }
  const input = {
    operationId: `accept:${candidate.id}`, idempotencyKey: `${project.id}:${candidate.id}:${project.revision}`,
    projectId: project.id, chapterId: chapter.id, candidateId: candidate.id, acceptedText: "Open.", choiceLabel: "Open",
    expectedProjectRevision: project.revision, expectedChapterRevision: chapter.revision, expectedCandidateRevision: candidate.revision,
    expectedStoryStateRevision: storyState.revision, expectedStoryBibleRevision: storyBible.revision, origin: "studio",
    ...(rpgContextRevisionGuard ? { rpgContextRevisionGuard } : {}),
  };
  return { repository, project, chapter, storyState, storyBible, candidate, input };
}

const row = await fixture("primary");
await test("actual IndexedDB accepts one guarded choice", async () => {
  const result = await row.repository.acceptChoiceTransaction(row.input);
  assert.equal(result.replayed, false);
  assert.equal((await row.repository.listAcceptedChoices(row.project.id)).length, 1);
});
await test("actual IndexedDB copy import preserves idempotency references", async () => {
  const { payload } = await createProjectBackup(row.repository, row.project.id, "full");
  const copiedProjectId = await row.repository.importProject(payload.records, "copy");
  assert.equal((await row.repository.list("idempotencyRecords", copiedProjectId)).length, 1);
});
await test("partial v4 payload is rejected before destructive replace", async () => {
  const { payload } = await createProjectBackup(row.repository, row.project.id, "full");
  const partial = structuredClone(payload);
  for (const store of ["acceptedChoices", "storyBranches", "storyBibleDeltas", "approvalTransactions", "idempotencyRecords"]) delete partial.records[store];
  partial.manifest.includedStores = Object.keys(partial.records);
  partial.manifest.recordCounts = Object.fromEntries(Object.entries(partial.records).map(([store, records]) => [store, records.length]));
  partial.manifest.contentHash = await digest(stable(partial.records));
  const validation = await validateBackupPayload(partial);
  assert.equal(validation.valid, false);
  if (!validation.valid) assert.equal(validation.reason, "BACKUP_REQUIRED_STORE_MISSING");
  await assert.rejects(() => row.repository.importProject(partial.records, "replace", row.project.id), /BACKUP_REQUIRED_STORE_MISSING/);
  assert.equal((await row.repository.listAcceptedChoices(row.project.id)).length, 1);
});
await test("missing Story Bible revision is rejected before formal mutation", async () => {
  const stale = await fixture("stale-bible");
  await stale.repository.put("storyBibles", stale.storyBible, stale.storyBible.revision);
  const withoutRevision = { ...stale.input };
  delete withoutRevision.expectedStoryBibleRevision;
  await assert.rejects(() => stale.repository.acceptChoiceTransaction(withoutRevision), (error) => error?.code === "STORY_BIBLE_REVISION_CONFLICT");
  assert.equal((await stale.repository.listAcceptedChoices(stale.project.id)).length, 0);
  assert.equal((await stale.repository.list("approvalTransactions", stale.project.id)).length, 0);
});
await test("full RPG context CAS rejects a relationship race with zero Canon mutation", async () => {
  const stale = await fixture("stale-context", { fullContextGuard: true });
  const relationship = (await stale.repository.list("relationships", stale.project.id))[0];
  assert.ok(relationship);
  await stale.repository.put("relationships", {
    ...relationship,
    summary: `${relationship.summary ?? ""} changed after planning`,
  }, relationship.revision);
  const before = {
    project: await stale.repository.get("projects", stale.project.id),
    chapter: await stale.repository.get("chapters", stale.chapter.id),
    storyState: await stale.repository.get("storyStates", stale.storyState.id),
    storyBible: await stale.repository.get("storyBibles", stale.storyBible.id),
    acceptedChoices: await stale.repository.listAcceptedChoices(stale.project.id),
    receipts: await stale.repository.list("rpgTurnReceipts", stale.project.id),
  };
  await assert.rejects(
    () => stale.repository.acceptChoiceTransaction(stale.input),
    (error) => error?.code === "RPG_CONTEXT_REVISION_CONFLICT",
  );
  const after = {
    project: await stale.repository.get("projects", stale.project.id),
    chapter: await stale.repository.get("chapters", stale.chapter.id),
    storyState: await stale.repository.get("storyStates", stale.storyState.id),
    storyBible: await stale.repository.get("storyBibles", stale.storyBible.id),
    acceptedChoices: await stale.repository.listAcceptedChoices(stale.project.id),
    receipts: await stale.repository.list("rpgTurnReceipts", stale.project.id),
  };
  assert.deepEqual(after, before);
  assert.equal((await stale.repository.get("candidates", stale.candidate.id))?.status, "pending");
});

const summary = { suite: "p21-indexeddb-transaction", generatedAt: new Date().toISOString(), pass: results.filter((result) => result.status === "PASS").length, fail: results.filter((result) => result.status === "FAIL").length, results };
await mkdir("artifacts/p21-three-high/tests", { recursive: true });
await writeFile("artifacts/p21-three-high/tests/indexeddb-transaction.json", `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
if (summary.fail) process.exitCode = 1;

import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/memory/memory-repository.ts";
import { makeRecord, optionalValue } from "../lib/novel-ai/domain/common.ts";
import {
  LOCAL_QUALITY_SCHEMA_VERSION,
  buildExtractionFingerprint,
} from "../lib/novel-ai/providers/local-ollama/local-quality-guard.ts";
import {
  STORY_BIBLE_APPROVAL_ALREADY_COMMITTED,
  STORY_BIBLE_APPROVAL_CONFLICT,
  STORY_BIBLE_APPROVAL_REJECTED,
  STORY_BIBLE_APPROVAL_STALE,
  approveLocalStoryBibleCandidate,
  listLocalStoryBibleReviewState,
  registerValidatedLocalStoryBibleCandidates,
  rejectLocalStoryBibleCandidate,
} from "../lib/novel-ai/repository/story-bible-approval.ts";

const evidenceDir = new URL("../artifacts/closed-ai-phase1-1r3/", import.meta.url);
const repository = new MemoryNovelRepository();
const results = [];

async function test(id, title, fn) {
  const started = performance.now();
  try {
    const detail = await fn();
    results.push({ id, title, status: "PASS", elapsedMs: Math.round(performance.now() - started), detail: detail || null });
  } catch (error) {
    results.push({ id, title, status: "FAIL", elapsedMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error), errorCode: error?.code || null });
  }
}

function storyBible(projectId) {
  return {
    ...makeRecord(projectId),
    id: `${projectId}:story-bible`,
    theme: optionalValue(),
    style: optionalValue(),
    protagonistIds: [], characterIds: [], relationshipIds: [], worldId: null, worldRuleIds: [], loreIds: [], timelineEventIds: [],
    foreshadowing: [], unresolvedThreads: [], forbiddenContradictions: [], authorPreferences: [],
  };
}

function fact({ requestId, chapterId, sourceText, entityId = "character:lin-zhao", field = "age", value = 28, factType = "explicit", validatorStatus = "valid", confidence = 0.98 }) {
  const marker = String(value);
  const start = sourceText.indexOf(marker);
  return {
    entityId,
    field,
    value,
    factType,
    evidenceSpans: start >= 0 ? [{ sourceChapterId: chapterId, start, end: start + marker.length, text: marker }] : [],
    sourceChapterIds: [chapterId],
    confidence,
    validatorStatus,
    modelId: "qwen2.5:3b",
    requestId,
    schemaVersion: LOCAL_QUALITY_SCHEMA_VERSION,
  };
}

function fingerprint(requestId, revision, sourceText) {
  return buildExtractionFingerprint({ sourceRevision: revision, taskType: "character.extract", modelId: "qwen2.5:3b", schemaVersion: LOCAL_QUALITY_SCHEMA_VERSION, sourceText: `${requestId}:${sourceText}` });
}

async function seedCandidate(projectId, chapterId, requestId, sourceRevision, sourceText, overrides = {}) {
  const item = fact({ requestId, chapterId, sourceText, ...overrides });
  const registered = await registerValidatedLocalStoryBibleCandidates({ repository, projectId, chapterId, requestId, sourceRevision, candidateFingerprint: fingerprint(requestId, sourceRevision, sourceText), modelId: "qwen2.5:3b", facts: [item] });
  return registered.candidates[0];
}

for (const projectId of ["r3-project-a", "r3-project-b"]) await repository.put("storyBibles", storyBible(projectId));

const sourceText = "林昭今年28歲，仍住在京城。";
const sourceRevision = "chapter-1:revision-7";
const candidate = await seedCandidate("r3-project-a", "chapter-1", "request-normal", sourceRevision, sourceText);

await test("APPROVAL_NORMAL", "正常核准一次提交事實、證據、稽核、版本與核准事件", async () => {
  const result = await approveLocalStoryBibleCandidate({ repository, projectId: "r3-project-a", candidateId: candidate.candidateId, approvalEventId: "approval-normal", idempotencyKey: "approval-normal-key", requestId: "request-normal", currentSourceRevision: () => sourceRevision, sourceText });
  assert.equal(result.status, "committed");
  const { state } = await listLocalStoryBibleReviewState(repository, "r3-project-a");
  assert.equal(state.canonicalFacts.length, 1);
  assert.equal(state.evidence.length, 1);
  assert.equal(state.audits.filter((row) => row.action === "committed").length, 1);
  assert.equal(state.revisions.length, 1);
  assert.equal(state.approvalEvents.length, 1);
  return { fact: state.canonicalFacts[0], approvalEvent: state.approvalEvents[0] };
});

await test("APPROVAL_DUPLICATE", "重複核准回放且不重複寫入", async () => {
  const before = (await listLocalStoryBibleReviewState(repository, "r3-project-a")).state;
  const result = await approveLocalStoryBibleCandidate({ repository, projectId: "r3-project-a", candidateId: candidate.candidateId, approvalEventId: "approval-normal", idempotencyKey: "approval-normal-key", requestId: "request-normal", currentSourceRevision: () => sourceRevision, sourceText });
  const after = (await listLocalStoryBibleReviewState(repository, "r3-project-a")).state;
  assert.equal(result.status, STORY_BIBLE_APPROVAL_ALREADY_COMMITTED);
  assert.deepEqual({ facts: after.canonicalFacts.length, evidence: after.evidence.length, audits: after.audits.length, revisions: after.revisions.length }, { facts: before.canonicalFacts.length, evidence: before.evidence.length, audits: before.audits.length, revisions: before.revisions.length });
  return { replayed: result.replayed };
});

await test("APPROVAL_STALE", "來源 revision 過期時拒絕且零寫入", async () => {
  const stale = await seedCandidate("r3-project-a", "chapter-1", "request-stale", sourceRevision, sourceText, { field: "location", value: "京城" });
  const before = structuredClone((await listLocalStoryBibleReviewState(repository, "r3-project-a")).state);
  await assert.rejects(() => approveLocalStoryBibleCandidate({ repository, projectId: "r3-project-a", candidateId: stale.candidateId, approvalEventId: "approval-stale", idempotencyKey: "approval-stale-key", requestId: "request-stale", currentSourceRevision: () => "chapter-1:revision-8", sourceText }), (error) => error.code === STORY_BIBLE_APPROVAL_STALE);
  const after = (await listLocalStoryBibleReviewState(repository, "r3-project-a")).state;
  assert.deepEqual(after, before);
});

await test("APPROVAL_FAULT_ROLLBACK", "transaction fault injection 不留下半套資料", async () => {
  const fault = await seedCandidate("r3-project-a", "chapter-1", "request-fault", sourceRevision, sourceText, { field: "identity", value: "京城" });
  const before = structuredClone((await listLocalStoryBibleReviewState(repository, "r3-project-a")).state);
  await assert.rejects(() => approveLocalStoryBibleCandidate({ repository, projectId: "r3-project-a", candidateId: fault.candidateId, approvalEventId: "approval-fault", idempotencyKey: "approval-fault-key", requestId: "request-fault", currentSourceRevision: () => sourceRevision, sourceText, injectFault: true }), /測試注入/);
  const after = (await listLocalStoryBibleReviewState(repository, "r3-project-a")).state;
  assert.deepEqual(after, before);
});

await test("APPROVAL_CONFLICT", "與正式事實衝突時建立 conflict 且不覆寫", async () => {
  const conflictText = "林昭今年35歲，仍住在京城。";
  const conflict = await seedCandidate("r3-project-a", "chapter-2", "request-conflict", "chapter-2:revision-1", conflictText, { value: 35 });
  const result = await approveLocalStoryBibleCandidate({ repository, projectId: "r3-project-a", candidateId: conflict.candidateId, approvalEventId: "approval-conflict", idempotencyKey: "approval-conflict-key", requestId: "request-conflict", currentSourceRevision: () => "chapter-2:revision-1", sourceText: conflictText });
  assert.equal(result.status, STORY_BIBLE_APPROVAL_CONFLICT);
  const { state } = await listLocalStoryBibleReviewState(repository, "r3-project-a");
  assert.equal(state.canonicalFacts.find((row) => row.field === "age")?.value, 28);
  assert.equal(state.conflicts.length, 1);
  assert.equal(state.candidates.find((row) => row.candidateId === conflict.candidateId)?.status, "needs_review");
  return state.conflicts[0];
});

await test("APPROVAL_REJECT", "使用者拒絕只更新候選與稽核", async () => {
  const reject = await seedCandidate("r3-project-a", "chapter-1", "request-reject", sourceRevision, sourceText, { entityId: "character:lin-zhao", field: "goal", value: "京城" });
  const factsBefore = (await listLocalStoryBibleReviewState(repository, "r3-project-a")).state.canonicalFacts.length;
  const result = await rejectLocalStoryBibleCandidate({ repository, projectId: "r3-project-a", candidateId: reject.candidateId, requestId: "reject-event", reason: "author_rejected" });
  assert.equal(result.status, "rejected");
  const { state } = await listLocalStoryBibleReviewState(repository, "r3-project-a");
  assert.equal(state.canonicalFacts.length, factsBefore);
  assert.equal(state.candidates.find((row) => row.candidateId === reject.candidateId)?.status, "rejected");
  assert.equal(state.audits.some((row) => row.action === "rejected" && row.candidateId === reject.candidateId), true);
});

await test("APPROVAL_LOW_TRUST_BLOCK", "inferred/低可信候選不能核准", async () => {
  const low = await seedCandidate("r3-project-a", "chapter-1", "request-low", sourceRevision, sourceText, { entityId: "character:lin-zhao", field: "fear", value: null, factType: "inferred", confidence: 0.5, validatorStatus: "pending" });
  await assert.rejects(() => approveLocalStoryBibleCandidate({ repository, projectId: "r3-project-a", candidateId: low.candidateId, approvalEventId: "approval-low", idempotencyKey: "approval-low-key", requestId: "request-low", currentSourceRevision: () => sourceRevision, sourceText }), (error) => error.code === STORY_BIBLE_APPROVAL_REJECTED);
});

await test("APPROVAL_PROJECT_ISOLATION", "Project A 核准資料不會污染 Project B", async () => {
  const stateA = (await listLocalStoryBibleReviewState(repository, "r3-project-a")).state;
  const stateB = (await listLocalStoryBibleReviewState(repository, "r3-project-b")).state;
  assert.ok(stateA.canonicalFacts.length > 0);
  assert.equal(stateB.canonicalFacts.length, 0);
  assert.equal(stateB.candidates.length, 0);
});

await test("APPROVAL_RELOAD_CONSISTENCY", "重新讀取後 fact/evidence/audit/revision/conflict 一致", async () => {
  const first = (await listLocalStoryBibleReviewState(repository, "r3-project-a")).state;
  const second = (await listLocalStoryBibleReviewState(repository, "r3-project-a")).state;
  assert.deepEqual(second.canonicalFacts, first.canonicalFacts);
  assert.deepEqual(second.evidence, first.evidence);
  assert.deepEqual(second.audits, first.audits);
  assert.deepEqual(second.revisions, first.revisions);
  assert.deepEqual(second.conflicts, first.conflicts);
  return { facts: first.canonicalFacts.length, evidence: first.evidence.length, audits: first.audits.length, revisions: first.revisions.length, conflicts: first.conflicts.length };
});

const failed = results.filter((result) => result.status !== "PASS");
await mkdir(evidenceDir, { recursive: true });
const payload = { generatedAt: new Date().toISOString(), adapter: repository.kind, pass: results.length - failed.length, fail: failed.length, results };
await writeFile(new URL("studio-approval-e2e.json", evidenceDir), `${JSON.stringify(payload, null, 2)}\n`);
await writeFile(new URL("approval-idempotency-results.json", evidenceDir), `${JSON.stringify(results.find((result) => result.id === "APPROVAL_DUPLICATE"), null, 2)}\n`);
await writeFile(new URL("approval-stale-revision-results.json", evidenceDir), `${JSON.stringify(results.find((result) => result.id === "APPROVAL_STALE"), null, 2)}\n`);
await writeFile(new URL("approval-rollback-results.json", evidenceDir), `${JSON.stringify(results.find((result) => result.id === "APPROVAL_FAULT_ROLLBACK"), null, 2)}\n`);
console.log(JSON.stringify({ pass: payload.pass, fail: payload.fail, adapter: payload.adapter }, null, 2));
if (failed.length) process.exitCode = 1;

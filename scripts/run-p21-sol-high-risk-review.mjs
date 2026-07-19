import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/memory/memory-repository.ts";
import { buildProjectBundle, createDraft } from "../lib/novel-ai/domain/creation.ts";
import { makeRecord, optionalValue } from "../lib/novel-ai/domain/index.ts";
import { createProjectBackup, validateBackupPayload } from "../lib/novel-ai/repository/backup.ts";
import { NOVEL_STORES } from "../lib/novel-ai/repository/contracts/index.ts";
import { resolvePlatformProvider } from "../lib/novel-ai/router/platform-router.ts";
import { validateStoryChoiceEffect } from "../lib/novel-ai/game/effects/index.ts";

const results = [];
async function test(name, expected, work) {
  const started = performance.now();
  try { await work(); results.push({ name, expected, status: "PASS", elapsedMs: Math.round(performance.now() - started) }); }
  catch (error) { results.push({ name, expected, status: "FAIL", elapsedMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error) }); }
}

function draft(title) { const value = createDraft("quick"); value.title = title; value.coreIdea = optionalValue("A sealed door remembers each choice.", "user_defined"); value.protagonist = optionalValue("Lin Zhao", "user_defined"); return value; }
function containsOldId(value, ids) { if (typeof value === "string") return ids.has(value); if (Array.isArray(value)) return value.some((item) => containsOldId(item, ids)); if (value && typeof value === "object") return Object.values(value).some((item) => containsOldId(item, ids)); return false; }

const repo = new MemoryNovelRepository();
const bundle = buildProjectBundle(draft("Sol review fixture"));
await repo.createProject(bundle, "sol-create");
const projectId = bundle.project.id;
const chapter = await repo.put("chapters", { ...makeRecord(projectId), id: "sol-chapter", title: "Chapter", order: 1, content: "The door opened.", summary: null, status: "completed" });
const location = await repo.put("lore", { ...makeRecord(projectId), id: "sol-location", kind: "location", title: "Capital", content: "North gate" });
const character = await repo.put("characters", { ...makeRecord(projectId), id: "sol-character", name: "Lin Zhao", aliases: [], identity: optionalValue("guard", "user_defined"), personality: optionalValue(null), goal: optionalValue(null), lifeStatus: "alive", locationId: location.id });
await repo.put("readerNotes", { ...makeRecord(projectId), id: "sol-note", chapterId: chapter.id, anchor: "0:The door", excerpt: "The door opened.", content: "Remember", needsRelocation: false });
await repo.put("readerBookmarks", { ...makeRecord(projectId), id: "sol-bookmark", chapterId: chapter.id, anchor: "0:The door", excerpt: "The door opened.", label: "Opening", needsRelocation: false });
await repo.put("settings", { ...makeRecord(projectId), id: "sol-settings", endpoint: "https://secret.invalid", apiKey: "do-not-export", nested: { authorization: "Bearer secret" } });

const { payload } = await createProjectBackup(repo, projectId, "full", { appCommit: "review", releaseTag: "review" });
await test("backup excludes operational and credential-bearing stores", "PASS", async () => {
  for (const store of ["backups", "settings", "aiJobs", "migrationJournal"]) assert.equal(store in payload.records, false);
  assert.equal(JSON.stringify(payload).includes("do-not-export"), false);
});
await test("backup manifest and SHA-256 integrity validate", "PASS", async () => { assert.equal((await validateBackupPayload(payload)).valid, true); assert.match(payload.manifest.contentHash, /^[a-f0-9]{64}$/); });
await test("tampered backup is rejected", "PASS", async () => { const changed = structuredClone(payload); changed.records.chapters[0].content = "changed"; assert.equal((await validateBackupPayload(changed)).valid, false); });
await test("import rejects credential-bearing payload fields", "PASS", async () => { const changed = structuredClone(payload); changed.records.chapters[0].endpoint = "https://secret.invalid"; const result = await validateBackupPayload(changed); assert.deepEqual(result, { valid: false, reason: "BACKUP_SENSITIVE_DATA_NOT_ALLOWED" }); });

await test("copy import recursively remaps project-scoped references", "PASS", async () => {
  const oldIds = new Set(Object.values(payload.records).flat().map((row) => row.id));
  const copyId = await repo.importProject(payload.records, "copy");
  assert.notEqual(copyId, projectId);
  for (const store of NOVEL_STORES) for (const row of await repo.list(store, copyId)) {
    assert.equal(row.projectId, copyId);
    assert.equal(containsOldId(row, oldIds), false, `${store}:${row.id} retained an old id`);
  }
  const copiedCharacter = (await repo.list("characters", copyId)).find((item) => item.locationId);
  const copiedLocations = new Set((await repo.list("lore", copyId)).map((item) => item.id));
  assert.ok(copiedLocations.has(copiedCharacter.locationId));
});
await test("copy project is isolated from source", "PASS", async () => {
  const copy = (await repo.list("projects")).find((item) => item.id !== projectId);
  const copyChapter = (await repo.list("chapters", copy.id))[0];
  await repo.put("chapters", { ...copyChapter, content: "Copy only" }, copyChapter.revision);
  assert.equal((await repo.list("chapters", projectId))[0].content, "The door opened.");
});

class FaultingRepository extends MemoryNovelRepository {
  failAfter = Infinity; writes = 0; failed = false;
  async put(store, record, expectedRevision) {
    this.writes += 1;
    if (!this.failed && this.writes >= this.failAfter) { this.failed = true; throw new Error("INJECTED_IMPORT_FAILURE"); }
    return super.put(store, record, expectedRevision);
  }
}
await test("replace import failure restores exact previous project rows", "PASS", async () => {
  const target = new FaultingRepository(), targetBundle = buildProjectBundle(draft("Restore target"));
  await target.createProject(targetBundle, "target-create");
  const before = await target.put("chapters", { ...makeRecord(targetBundle.project.id), id: "target-only", title: "Original", order: 1, content: "Original content", summary: null, status: "completed" });
  target.writes = 0; target.failAfter = 3;
  await assert.rejects(() => target.importProject(payload.records, "replace", targetBundle.project.id), /INJECTED_IMPORT_FAILURE/);
  const after = await target.list("chapters", targetBundle.project.id);
  assert.deepEqual(after, [before]);
});

const providers = [
  { id: "gemini", status: "ready", capabilities: ["text"], modelId: "cloud", maxContext: 1000, local: false, requiresInternet: true },
  { id: "private-ai-hub", status: "ready", capabilities: ["text"], modelId: "private", maxContext: 1000, local: false, requiresInternet: true },
  { id: "deterministic-local", status: "ready", capabilities: ["text", "offline"], modelId: "rules", maxContext: 1000, local: true, requiresInternet: false },
];
const request = { requestId: "privacy", projectId, taskType: "chapter.continue", privacyMode: "strict-local", input: "continue", context: [], preferredProvider: "gemini", externalConsent: true };
await test("strict-local router cannot silently select private or cloud providers", "PASS", async () => { const result = resolvePlatformProvider(request, providers); assert.equal(result.providerId, "deterministic-local"); assert.equal(result.dataLeavesDevice, false); });
await test("external provider requires both external mode and consent", "PASS", async () => { const result = resolvePlatformProvider({ ...request, privacyMode: "external-allowed", externalConsent: false }, providers); assert.equal(result.providerId, "deterministic-local"); });
await test("non-finite story effects are rejected", "PASS", async () => { const validation = validateStoryChoiceEffect({ statChanges: { hp: Number.NaN }, relationshipChanges: {}, resourceChanges: {}, moneyChange: 0, worldFlags: {}, questProgress: {}, achievementProgress: {}, timelineEvents: [] }); assert.equal(validation.valid, false); });

const contracts = await readFile(new URL("../lib/novel-ai/repository/contracts/index.ts", import.meta.url), "utf8");
const studio = await readFile(new URL("../app/studio/studio-client.tsx", import.meta.url), "utf8");
await test("formal repository persists accepted choices and story branches", "PASS", async () => { assert.match(contracts, /acceptedChoices/); assert.match(contracts, /storyBranches/); });
await test("public Studio candidate acceptance uses repository transaction and idempotency key", "PASS", async () => {
  const acceptance = studio.slice(studio.indexOf("function acceptChoiceResult"), studio.indexOf("function", studio.indexOf("function acceptChoiceResult") + 10));
  assert.doesNotMatch(acceptance, /setState\s*\(/);
  assert.match(acceptance, /requestId|idempot/i);
  assert.match(acceptance, /repository|transaction/i);
});

console.log(JSON.stringify({ suite: "p21-sol-high-risk-review", reviewedCommit: "cb70dfce7bbaca2622652580a2fe60ce325da700", pass: results.filter((item) => item.status === "PASS").length, fail: results.filter((item) => item.status === "FAIL").length, results }, null, 2));

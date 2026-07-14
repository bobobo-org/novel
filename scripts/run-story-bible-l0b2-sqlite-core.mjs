import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const tmpRoot = path.join(root, ".tmp", `l0b2-sqlite-${Date.now()}`);
fs.mkdirSync(tmpRoot, { recursive: true });

const results = [];
const started = Date.now();
const { SQLiteStoryBibleStorageAdapter } = await import(`file://${path.join(root, "lib/novel-ai/storage/sqlite/sqlite-adapter.ts").replaceAll("\\", "/")}`);

function pass(name, details = {}) {
  results.push({ name, status: "PASS", details });
}

function fail(name, error) {
  results.push({ name, status: "FAIL", details: error instanceof Error ? { name: error.name, message: error.message } : error });
}

async function check(name, fn) {
  try {
    pass(name, await fn());
  } catch (error) {
    fail(name, error);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function project(id) {
  return `l0b2_${id}`;
}

async function seed(adapter, projectId) {
  await adapter.createProject({ id: projectId, projectId, project_id: projectId, title: "L0B2 SQLite" });
}

const adapter = new SQLiteStoryBibleStorageAdapter({ storageDir: tmpRoot });
const projectId = project("main");
const otherProjectId = project("other");
await seed(adapter, projectId);
await seed(adapter, otherProjectId);

await check("lazy SQLite diagnostics works", async () => {
  const d = await adapter.diagnostics(projectId);
  assert(d.foreignKeysEnabled === true, "foreign keys disabled");
  assert(String(d.journalMode).toLowerCase() === "wal", "WAL disabled");
  assert(!("databasePath" in d), "raw database path leaked");
  return d;
});

for (const entityType of ["character", "event", "item", "world_rule", "foreshadowing", "open_thread"]) {
  await check(`canonical create ${entityType}`, async () => {
    const entity = await adapter.createCanonicalEntity(entityType, {
      projectId,
      project_id: projectId,
      entityId: `${entityType}_001`,
      canonicalName: `${entityType} name`,
      field: "initial",
    });
    assert(entity.storageLocation === "local_sqlite", "storageLocation missing");
    assert(entity.canonicalAuthority === "local", "canonicalAuthority missing");
    assert(entity.dataLeftDevice === false, "dataLeftDevice should be false");
    return entity;
  });
  await check(`canonical update ${entityType}`, async () => {
    const updated = await adapter.updateCanonicalEntity(projectId, entityType, `${entityType}_001`, { field: "updated" });
    assert(updated.field === "updated", "canonical update failed");
    assert(Number(updated.versionNumber) === 2, "canonical revision did not increment");
  });
}

await check("canonical source relation", async () => {
  const source = await adapter.createSource({ projectId, project_id: projectId, id: "source_canon", sourceHash: "hash-canon", chapterId: "ch1", excerpt: "evidence" });
  const relation = await adapter.createCanonicalSourceRelation({ projectId, project_id: projectId, entityType: "character", entityId: "character_001", sourceId: source.id });
  assert(relation.sourceId === source.id, "source relation missing");
});

await check("candidate filters and restart persistence", async () => {
  await adapter.createCandidate({ projectId, project_id: projectId, id: "cand_l0b2", status: "pending", candidate_trust: "cloud-validated", sourceValid: true });
  const candidate = await adapter.getCandidate(projectId, "cand_l0b2");
  assert(candidate?.candidate_trust === "cloud-validated", "candidate trust missing");
  adapter.closeAll();
  const reopened = new SQLiteStoryBibleStorageAdapter({ storageDir: tmpRoot });
  const after = await reopened.getCandidate(projectId, "cand_l0b2");
  assert(after?.id === "cand_l0b2", "candidate not persisted after restart");
  reopened.closeAll();
});

await check("conflict relation and status", async () => {
  await adapter.createConflict({ projectId, project_id: projectId, id: "conf_l0b2", candidateId: "cand_l0b2", severity: "major", conflictType: "canonical-value-mismatch" });
  const updated = await adapter.updateConflictStatus(projectId, "conf_l0b2", "resolved", { resolution: "author accepted" });
  assert(updated.status === "resolved", "conflict status not updated");
});

await check("version create with change set", async () => {
  const version = await adapter.createVersion({
    projectId,
    project_id: projectId,
    id: "version_1",
    versionNumber: 1,
    entityType: "character",
    entityId: "character_001",
    fieldPath: "field",
    changes: [{
      entityType: "character",
      entityId: "character_001",
      fieldPath: "field",
      operation: "update",
      previousValue: "initial",
      newValue: "updated",
      candidateId: "cand_l0b2",
      sourceIds: ["source_canon"],
      reason: "L0B2 test",
      humanEdited: false,
      provenance: { source: "sqlite-contract" },
    }],
  });
  assert(version.versionNumber === 1, "version number mismatch");
});

await check("version by number and range", async () => {
  const byNumber = await adapter.getVersionByNumber(projectId, 1);
  assert(byNumber?.id === "version_1", "getVersionByNumber failed");
  const range = await adapter.getVersionRange(projectId, 1, 1);
  assert(range.length === 1, "version range failed");
});

await check("entity and field history", async () => {
  const entityHistory = await adapter.getEntityHistory(projectId, "character", "character_001");
  const fieldHistory = await adapter.getFieldHistory(projectId, "character", "character_001", "field");
  assert(entityHistory.length === 1 && fieldHistory.length === 1, "history failed");
});

await check("integrity chain valid", async () => {
  await adapter.saveIntegrityMetadata({ projectId, project_id: projectId, id: "integrity_1", versionNumber: 1, content: { version: 1, field: "updated" } });
  const verify = await adapter.verifyStoredIntegrityFields(projectId);
  assert(verify.ok === true, "integrity chain invalid");
  assert(verify.checked === 1, "integrity checked count mismatch");
});

await check("forward diff", async () => {
  const diff = await adapter.getVersionDiff(projectId, 0, 1);
  assert(diff.direction === "forward", "forward diff direction wrong");
  assert(diff.changes.length === 1, "forward diff missing changes");
});

await check("reverse diff", async () => {
  const diff = await adapter.getVersionDiff(projectId, 1, 0);
  assert(diff.direction === "reverse", "reverse diff direction wrong");
  assert(diff.changes[0].previousValue === "updated", "reverse diff did not swap values");
});

await check("same-version diff", async () => {
  const diff = await adapter.getVersionDiff(projectId, 1, 1);
  assert(diff.changes.length === 0, "same-version diff should be empty");
});

await check("entity filtered diff", async () => {
  const diff = await adapter.getVersionDiff(projectId, 0, 1, { entityType: "character", entityId: "character_001" });
  assert(diff.changes.length === 1, "entity filtered diff failed");
});

await check("field filtered diff", async () => {
  const diff = await adapter.getVersionDiff(projectId, 0, 1, { fieldPath: "field" });
  assert(diff.changes.length === 1, "field filtered diff failed");
});

await check("transaction commit with extraction context", async () => {
  await adapter.transaction(async (tx) => {
    await tx.extractionPersistence.persistRows({
      projectId,
      storyBibleRow: { projectId, id: projectId },
      extractionRunRow: { id: "run_tx", requestId: "request_tx", projectId },
      candidateRows: [{ id: "cand_tx", projectId, project_id: projectId, status: "pending" }],
      conflictRows: [],
      sourceRows: [{ id: "source_tx", projectId, project_id: projectId, candidateId: "cand_tx", sourceHash: "hash-tx", chapterId: "ch-tx" }],
      chapterSummaryRow: { id: "summary_tx", projectId, project_id: projectId },
    });
  });
  assert((await adapter.getCandidate(projectId, "cand_tx"))?.id === "cand_tx", "transaction extraction did not commit");
});

await check("transaction rollback after candidate lock", async () => {
  try {
    await adapter.transaction(async () => {
      await adapter.createCandidate({ projectId, project_id: projectId, id: "cand_fault_lock", status: "locked" });
      throw Object.assign(new Error("after_candidate_lock"), { fault: "after_candidate_lock" });
    });
  } catch {
    // expected
  }
  assert(!(await adapter.getCandidate(projectId, "cand_fault_lock")), "fault rollback left candidate");
});

await check("transaction rollback after canonical write", async () => {
  try {
    await adapter.transaction(async () => {
      await adapter.createCanonicalEntity("character", { projectId, project_id: projectId, entityId: "char_fault" });
      throw Object.assign(new Error("after_canonical_write"), { fault: "after_canonical_write" });
    });
  } catch {
    // expected
  }
  assert(!(await adapter.getCanonicalEntity(projectId, "character", "char_fault")), "fault rollback left canonical");
});

await check("source dedup replay", async () => {
  const a = await adapter.createSource({ projectId, project_id: projectId, sourceHash: "dedup", chapterId: "ch1", paragraphStart: 1, paragraphEnd: 1 });
  const b = await adapter.createSource({ projectId, project_id: projectId, sourceHash: "dedup", chapterId: "ch1", paragraphStart: 1, paragraphEnd: 1 });
  assert(a.id === b.id, "dedup did not return same source");
});

await check("cross-project source isolation", async () => {
  const a = await adapter.createSource({ projectId, project_id: projectId, sourceHash: "cross", chapterId: "ch1" });
  const b = await adapter.createSource({ projectId: otherProjectId, project_id: otherProjectId, sourceHash: "cross", chapterId: "ch1" });
  assert(a.id !== b.id, "cross project source dedup leaked");
});

await check("project isolation candidate", async () => {
  assert(!(await adapter.getCandidate(otherProjectId, "cand_l0b2")), "candidate leaked to other project");
});

await check("optimistic lock current version", async () => {
  const ok = await adapter.optimisticVersionCheck(projectId, 1);
  const bad = await adapter.optimisticVersionCheck(projectId, 2);
  const versions = await adapter.listVersions(projectId, 10);
  assert(ok.ok === true && bad.ok === false, `optimistic lock failed: ok=${JSON.stringify(ok)} bad=${JSON.stringify(bad)} versions=${JSON.stringify(versions)}`);
});

await check("10 concurrent reads", async () => {
  await Promise.all(Array.from({ length: 10 }, async () => {
    const state = await adapter.getCurrentCanonicalState(projectId);
    assert(Array.isArray(state.entities), "canonical state missing");
  }));
});

await check("2 concurrent writes allocate unique versions", async () => {
  await Promise.all([2, 3].map((n) => adapter.createVersion({
    projectId,
    project_id: projectId,
    id: `version_${n}`,
    entityType: "event",
    entityId: `event_${n}`,
    fieldPath: "name",
    changes: [{ entityType: "event", entityId: `event_${n}`, fieldPath: "name", operation: "create", newValue: `event ${n}` }],
  })));
  const versions = await adapter.listVersions(projectId, 10);
  assert(new Set(versions.map((v) => v.versionNumber)).size === versions.length, "duplicate version number");
});

await check("offline data layer does not require cloud env", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const local = new SQLiteStoryBibleStorageAdapter({ storageDir: tmpRoot });
  try {
    const row = await local.getProject(projectId);
    assert(row?.projectId === projectId, "offline local project read failed");
  } finally {
    local.closeAll();
  }
});

await check("restart version and integrity remain", async () => {
  adapter.closeAll();
  const reopened = new SQLiteStoryBibleStorageAdapter({ storageDir: tmpRoot });
  try {
    const version = await reopened.getVersionByNumber(projectId, 1);
    const versions = await reopened.listVersions(projectId, 10);
    assert(version?.id === "version_1", `version lost after restart: version=${JSON.stringify(version)} versions=${JSON.stringify(versions)}`);
    assert((await reopened.verifyStoredIntegrityFields(projectId)).ok === true, "integrity invalid after restart");
  } finally {
    reopened.closeAll();
  }
});

await check("cleanup fixture files", async () => {
  adapter.closeAll();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  assert(!fs.existsSync(tmpRoot), "fixture files remain");
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const summary = {
  pass: passCount,
  fail: failCount,
  skip: 0,
  elapsedMs: Date.now() - started,
  sqliteCoreParityReady: failCount === 0 && passCount >= 30,
};

console.log(JSON.stringify({ summary, results }, null, 2));
process.exit(summary.sqliteCoreParityReady ? 0 : 1);

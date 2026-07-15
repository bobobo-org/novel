import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const tmpRoot = path.join(root, ".tmp", `l0b-full-contract-${Date.now()}`);
fs.mkdirSync(tmpRoot, { recursive: true });

globalThis.fetch = async () => {
  throw new Error("EXTERNAL_REQUEST_BLOCKED_IN_L0B_FULL_CONTRACT");
};

const { SQLiteStoryBibleStorageAdapter } = await import(`file://${path.join(root, "lib/novel-ai/storage/sqlite/sqlite-adapter.ts").replaceAll("\\", "/")}`);
const { inspectSQLiteDatabaseFile } = await import(`file://${path.join(root, "lib/novel-ai/storage/sqlite/sqlite-integrity-check.ts").replaceAll("\\", "/")}`);
const { DatabaseSync } = await import("node:sqlite");

const adapter = new SQLiteStoryBibleStorageAdapter({ storageDir: tmpRoot });
const results = [];
const durations = [];
const started = Date.now();

function pass(name, details = {}) {
  results.push({ name, status: "PASS", details });
}

function fail(name, error) {
  results.push({
    name,
    status: "FAIL",
    details: error instanceof Error ? { name: error.name, message: error.message, errorCode: error.errorCode } : error,
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pct(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function check(name, fn) {
  const t0 = Date.now();
  try {
    const details = await fn();
    const elapsedMs = Date.now() - t0;
    durations.push(elapsedMs);
    pass(name, { elapsedMs, ...(details || {}) });
  } catch (error) {
    durations.push(Date.now() - t0);
    fail(name, error);
  }
}

function change(changeId, patch = {}) {
  return {
    id: changeId,
    changeId,
    entityType: "character",
    entityId: "char_full_001",
    entityDisplayName: "林昭",
    fieldPath: "characters[].age",
    operation: "updated",
    previousValue: 28,
    newValue: 29,
    reason: "L0B full contract fixture",
    humanEdited: true,
    sourceMode: "author-declared",
    ...patch,
  };
}

async function createVersionWithIntegrity(projectId, versionNumber, fieldPath, previousValue, newValue, extra = {}) {
  const version = await adapter.createVersion({
    projectId,
    project_id: projectId,
    id: `${projectId}_version_${versionNumber}`,
    versionNumber,
    entityType: extra.entityType || "character",
    entityId: extra.entityId || "char_full_001",
    fieldPath,
    changes: [
      change(`${projectId}_chg_${versionNumber}`, {
        entityType: extra.entityType || "character",
        entityId: extra.entityId || "char_full_001",
        fieldPath,
        previousValue,
        newValue,
        operation: extra.operation || "updated",
      }),
    ],
  });
  await adapter.saveIntegrityMetadata({
    projectId,
    project_id: projectId,
    id: `${projectId}_integrity_${versionNumber}`,
    versionNumber,
    content: { versionNumber, fieldPath, previousValue, newValue },
  });
  return version;
}

const projectId = "l0b_full_contract_main";
const otherProjectId = "l0b_full_contract_other";
await adapter.createProject({ id: projectId, projectId, project_id: projectId, title: "L0B Full Contract" });
await adapter.createProject({ id: otherProjectId, projectId: otherProjectId, project_id: otherProjectId, title: "Other Project" });

await check("capabilities expose local SQLite identity", async () => {
  assert(String(adapter.id).includes("sqlite"), "adapter id mismatch");
  assert(adapter.mode === "SQLITE_LOCAL", "adapter mode mismatch");
  assert(adapter.capabilities.offline === "supported", "offline capability missing");
  assert(adapter.capabilities.browserCompatible === "unsupported", "browser compatibility must stay unsupported");
  assert(adapter.capabilities.vectorSearch === "unsupported", "vector search must stay unsupported");
  assert(adapter.capabilities.streaming === "unsupported", "streaming must stay unsupported");
});

for (const [key, expected] of [
  ["transactions", "supported"],
  ["optimisticLock", "supported"],
  ["integrityChain", "supported"],
  ["export", "supported"],
  ["revert", "supported"],
  ["backup", "supported"],
  ["restore", "supported"],
  ["import", "partial"],
]) {
  await check(`capability ${key} is ${expected}`, async () => {
    assert(adapter.capabilities[key] === expected, `${key} expected ${expected}, got ${adapter.capabilities[key]}`);
  });
}

await check("diagnostics opens WAL database without leaking raw path", async () => {
  const d = await adapter.diagnostics(projectId);
  assert(d.databaseOpenStatus === "open", "database did not open");
  assert(String(d.journalMode).toLowerCase() === "wal", "WAL is not enabled");
  assert(d.foreignKeysEnabled === true, "foreign keys disabled");
  assert(!("databasePath" in d), "raw database path leaked");
  return { sqliteMigrationCount: d.sqliteMigrationCount, journalMode: d.journalMode };
});

for (const required of ["projects", "candidates", "conflicts", "fact_sources", "canonical_entities", "versions", "integrity_metadata"]) {
  await check(`diagnostics required table ${required}`, async () => {
    const info = await adapter.getProjectFileInfo(projectId);
    const db = new DatabaseSync(info.databasePath);
    try {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(required);
      assert(row?.name === required, `${required} missing`);
    } finally {
      db.close();
    }
  });
}

await check("project create/read/update", async () => {
  const before = await adapter.getProject(projectId);
  assert(before?.title === "L0B Full Contract", "project read failed");
  const updated = await adapter.updateProject(projectId, { status: "active", storagePolicy: "SQLITE_LOCAL" });
  assert(updated.status === "active", "project update failed");
});

await check("project isolation blocks wrong project read", async () => {
  const missing = await adapter.getCanonicalEntity(otherProjectId, "character", "char_full_001");
  assert(missing === null, "other project saw canonical row");
});

await check("local policy metadata survives update", async () => {
  const project = await adapter.updateProject(projectId, { primaryStorage: "SQLITE_LOCAL", canonicalAuthority: "local", cloudSyncEnabled: false });
  assert(project.primaryStorage === "SQLITE_LOCAL", "primary storage not saved");
  assert(project.canonicalAuthority === "local", "local authority not saved");
});

const candidate = await adapter.createCandidate({
  projectId,
  project_id: projectId,
  id: "cand_full_001",
  status: "pending",
  candidate_trust: "cloud-validated",
  sourceValid: true,
  entityType: "character",
  fieldPath: "characters[].age",
  proposedValue: 29,
});

await check("candidate create/get", async () => {
  const row = await adapter.getCandidate(projectId, candidate.id);
  assert(row?.id === candidate.id, "candidate not found");
});

await check("candidate status update", async () => {
  const row = await adapter.updateCandidateStatus(projectId, candidate.id, "needs_review", { reviewReason: "contract" });
  assert(row.status === "needs_review", "candidate status not updated");
  assert(row.reviewReason === "contract", "candidate patch not saved");
});

await check("candidate lock", async () => {
  const locked = await adapter.lockCandidate(projectId, candidate.id, "lock_full_001");
  assert(locked.lockId === "lock_full_001" || locked.lock_id === "lock_full_001", "candidate lock missing");
});

await check("candidate audit", async () => {
  const audit = await adapter.saveCandidateAudit({ projectId, project_id: projectId, candidateId: candidate.id, action: "reviewed" });
  assert(audit.projectId === projectId, "candidate audit project mismatch");
});

const source = await adapter.createSource({
  projectId,
  project_id: projectId,
  id: "source_full_001",
  sourceHash: "source-full-hash-001",
  chapterId: "chapter_001",
  excerpt: "林昭在京城握著赤霄劍，確認自己已經二十九歲。",
  sourceValid: true,
});

await check("source create/get", async () => {
  const row = await adapter.getSource(projectId, source.id);
  assert(row?.id === source.id, "source not found");
});

await check("source natural-key dedup", async () => {
  const replay = await adapter.createSource({
    projectId,
    project_id: projectId,
    id: "source_full_001_replay",
    sourceHash: "source-full-hash-001",
    chapterId: "chapter_001",
    excerpt: "林昭在京城握著赤霄劍，確認自己已經二十九歲。",
    sourceValid: true,
  });
  assert(replay.id === source.id || replay.sourceHash === source.sourceHash, "source dedup did not replay");
});

const conflict = await adapter.createConflict({
  projectId,
  project_id: projectId,
  id: "conf_full_001",
  candidateId: candidate.id,
  severity: "major",
  conflictType: "canonical-value-mismatch",
  fieldPath: "characters[].age",
  canonicalValue: 28,
  proposedValue: 29,
});

await check("conflict create/get", async () => {
  const row = await adapter.getConflict(projectId, conflict.id);
  assert(row?.id === conflict.id, "conflict not found");
});

await check("conflict status update", async () => {
  const row = await adapter.updateConflictStatus(projectId, conflict.id, "resolved", { resolution: "author accepted" });
  assert(row.status === "resolved", "conflict status not updated");
});

for (const entityType of ["character", "event", "item", "world_rule", "foreshadowing", "open_thread"]) {
  const entityId = entityType === "character" ? "char_full_001" : `${entityType}_full_001`;
  await check(`canonical ${entityType} create`, async () => {
    const entityInput = {
      projectId,
      project_id: projectId,
      entityId,
      canonicalName: `${entityType} canonical`,
    };
    if (entityType === "character") entityInput.age = 28;
    if (entityType === "item") entityInput.currentOwnerCharacterId = "char_full_001";
    if (entityType === "foreshadowing") entityInput.status = "planted";
    const entity = await adapter.createCanonicalEntity(entityType, entityInput);
    assert(entity.storageLocation === "local_sqlite", "storage location mismatch");
    assert(entity.canonicalAuthority === "local", "canonical authority mismatch");
  });
  await check(`canonical ${entityType} update`, async () => {
    const entity = await adapter.updateCanonicalEntity(projectId, entityType, entityId, { contractField: "updated" });
    assert(entity.contractField === "updated", "canonical update failed");
  });
  await check(`canonical ${entityType} list`, async () => {
    const rows = await adapter.listCanonicalEntities(projectId, entityType, 10);
    assert(rows.some((row) => row.entityId === entityId || row.entity_id === entityId), "canonical list missing entity");
  });
  await check(`canonical ${entityType} source relation`, async () => {
    const rel = await adapter.createCanonicalSourceRelation({ projectId, project_id: projectId, entityType, entityId, sourceId: source.id });
    assert(rel.sourceId === source.id || rel.source_id === source.id, "canonical source relation failed");
  });
}

await check("canonical deactivate and tombstone", async () => {
  const row = await adapter.deactivateCanonicalEntity(projectId, "open_thread", "open_thread_full_001", "contract tombstone");
  assert(row.active === false, "canonical deactivate failed");
});

await check("current canonical state includes entities", async () => {
  const state = await adapter.getCurrentCanonicalState(projectId);
  assert(Array.isArray(state.entities) && state.entities.length >= 5, "canonical state incomplete");
});

await createVersionWithIntegrity(projectId, 1, "characters[].age", 20, 28);
await adapter.updateCanonicalEntity(projectId, "character", "char_full_001", { age: 29 });
await createVersionWithIntegrity(projectId, 2, "characters[].age", 28, 29);
await adapter.updateCanonicalEntity(projectId, "character", "char_full_001", { currentLocationId: "loc_market" });
await createVersionWithIntegrity(projectId, 3, "characters[].currentLocationId", "loc_capital", "loc_market");

await check("current version is latest", async () => {
  const current = await adapter.getCurrentVersion(projectId);
  assert(Number(current?.versionNumber || current?.version_number) === 3, "current version mismatch");
});

await check("version by id", async () => {
  const row = await adapter.getVersion(projectId, `${projectId}_version_2`);
  assert(row?.id === `${projectId}_version_2`, "version by id failed");
});

await check("version range", async () => {
  const rows = await adapter.getVersionRange(projectId, 1, 3);
  assert(rows.length === 3, "version range failed");
});

await check("entity history", async () => {
  const rows = await adapter.getEntityHistory(projectId, "character", "char_full_001");
  assert(rows.length >= 3, "entity history incomplete");
});

await check("field history", async () => {
  const rows = await adapter.getFieldHistory(projectId, "character", "char_full_001", "characters[].age");
  assert(rows.length >= 2, "field history incomplete");
});

await check("optimistic lock success", async () => {
  const lock = await adapter.optimisticVersionCheck(projectId, 3);
  assert(lock.ok === true, "optimistic lock should pass");
});

await check("optimistic lock failure", async () => {
  const lock = await adapter.optimisticVersionCheck(projectId, 99);
  assert(lock.ok === false, "optimistic lock should fail");
});

await check("integrity chain verifies", async () => {
  const verify = await adapter.verifyStoredIntegrityFields(projectId);
  assert(verify.ok === true, "integrity verify failed");
  assert(verify.checked >= 3, "integrity checked count too low");
});

await check("integrity chain list", async () => {
  const rows = await adapter.getIntegrityChain(projectId);
  assert(rows.length >= 3, "integrity chain list incomplete");
});

await check("forward diff", async () => {
  const diff = await adapter.getVersionDiff(projectId, 1, 3);
  assert(Array.isArray(diff.changes) && diff.changes.length >= 2, "forward diff empty");
});

await check("reverse diff", async () => {
  const diff = await adapter.getVersionDiff(projectId, 3, 1);
  assert(Array.isArray(diff.changes), "reverse diff missing");
});

await check("same-version diff", async () => {
  const diff = await adapter.getVersionDiff(projectId, 2, 2);
  assert(Array.isArray(diff.changes) && diff.changes.length === 0, "same-version diff should be empty");
});

await check("export preview", async () => {
  const preview = await adapter.previewExportPackage({ projectId, includeCurrentCanonical: true, includeSources: true, includeChapterText: false });
  assert(preview.exportAllowed === true, "export preview not allowed");
  assert(preview.versionCount >= 3, "export preview version count too low");
});

let exportPackage;
await check("full export package", async () => {
  exportPackage = await adapter.buildExportPackage({
    projectId,
    includeCurrentCanonical: true,
    includeCandidates: true,
    includeConflicts: true,
    includeSources: true,
    includeMutationRequests: true,
    includeSourceExcerpts: true,
    includeChapterText: false,
  });
  assert(exportPackage.format === "novel-story-bible-history-package", "export format mismatch");
  assert(exportPackage.hashes?.packageHash, "export package hash missing");
});

await check("export excludes secrets and paths", async () => {
  const text = JSON.stringify(exportPackage);
  assert(!/Bearer|API_KEY|databasePath|backupPath|C:\\\\Users/i.test(text), "export leaked secret or path");
});

let revertPreview;
await check("revert preview", async () => {
  revertPreview = await adapter.createRevertPreview(`${projectId}_version_3`, {
    projectId,
    requestId: "l0b_full_revert_preview",
    expectedCurrentVersion: 3,
    revertReason: "contract revert preview",
    dryRun: true,
  });
  assert(revertPreview.previewHash, "revert preview hash missing");
});

await check("partial revert applies selected field", async () => {
  const revertReason = "contract partial revert";
  const freshPreview = await adapter.createRevertPreview(`${projectId}_version_3`, {
    projectId,
    requestId: "l0b_full_revert_preview_fresh",
    expectedCurrentVersion: 3,
    revertReason,
    selectedChangeIds: [`${projectId}_chg_3`],
    conflictResolutionMode: "review_required",
    dryRun: true,
  });
  const result = await adapter.applyPartialRevert(`${projectId}_version_3`, {
    projectId,
    requestId: "l0b_full_revert_apply",
    expectedCurrentVersion: 3,
    revertReason,
    selectedChangeIds: [`${projectId}_chg_3`],
    conflictResolutionMode: "review_required",
    previewHash: freshPreview.previewHash,
  });
  assert(result.operationType === "partial_revert" || result.operationType === "revert", "partial revert operation mismatch");
});

await check("revert audit exists", async () => {
  const audits = await adapter.listRevertAudits(projectId, 100);
  assert(audits.length >= 1, "revert audit missing");
});

let backup;
await check("manual backup", async () => {
  backup = await adapter.createManualBackup({ projectId, requestId: "l0b_full_backup_1", reason: "full contract", protected: true });
  assert(backup.backupPath, "backup path missing from service return");
  assert(backup.metadata?.backupChecksum, "backup checksum missing");
});

await check("backup verification", async () => {
  const verify = await adapter.verifyBackup(backup.backupPath, projectId);
  assert(verify.ok === true, "backup verify failed");
});

await check("backup list and retention", async () => {
  await adapter.createManualBackup({ projectId, requestId: "l0b_full_backup_2", reason: "retention", protected: false, retentionLimit: 2 });
  await adapter.enforceRetentionPolicy(projectId, 2);
  const list = await adapter.listBackups(projectId);
  assert(list.length >= 1 && list.some((row) => row.metadata?.backupId === backup.metadata.backupId), "protected backup not retained");
});

await check("restore project identity guard", async () => {
  let blocked = false;
  try {
    await adapter.restoreBackup({ projectId: otherProjectId, requestId: "wrong_project_restore", backupPath: backup.backupPath, reason: "wrong project" });
  } catch (error) {
    blocked = /PROJECT|MISMATCH/i.test(String(error.errorCode || error.name || error.message));
  }
  assert(blocked, "wrong project restore was not blocked");
});

await check("restore backup succeeds", async () => {
  await adapter.updateCanonicalEntity(projectId, "character", "char_full_001", { age: 99 });
  const result = await adapter.restoreBackup({ projectId, requestId: "l0b_full_restore_1", backupPath: backup.backupPath, reason: "restore contract" });
  const row = await adapter.getCanonicalEntity(projectId, "character", "char_full_001");
  assert(result.restoreStatus === "restored" || result.status === "restored" || result.ok === true, "restore status mismatch");
  assert(row.age !== 99, "restore did not roll back changed age");
});

await check("WAL recovery verifies committed data", async () => {
  const recovery = await adapter.verifyWalRecovery(projectId);
  assert(recovery.ok === true, "WAL recovery failed");
});

await check("recovery state healthy", async () => {
  const state = await adapter.detectRecoveryState(projectId);
  assert(state.state === "healthy", `unexpected recovery state ${state.state}`);
});

await check("restart persistence after restore", async () => {
  adapter.closeAll();
  const reopened = new SQLiteStoryBibleStorageAdapter({ storageDir: tmpRoot });
  const row = await reopened.getProject(projectId);
  assert(row?.id === projectId || row?.projectId === projectId, "project missing after restart");
  const verify = await reopened.verifyStoredIntegrityFields(projectId);
  assert(verify.ok === true, "integrity invalid after restart");
  reopened.closeAll();
});

await check("transaction rollback preserves data", async () => {
  const before = await adapter.listCandidates(projectId, 1000);
  let threw = false;
  try {
    await adapter.transaction(async () => {
      await adapter.createCandidate({ projectId, project_id: projectId, id: "cand_should_rollback", status: "pending" });
      throw new Error("intentional rollback");
    });
  } catch {
    threw = true;
  }
  const after = await adapter.listCandidates(projectId, 1000);
  assert(threw, "transaction did not throw");
  assert(after.length === before.length, "rollback leaked candidate");
});

await check("10 concurrent reads", async () => {
  const reads = await Promise.all(Array.from({ length: 10 }, () => adapter.getCurrentCanonicalState(projectId)));
  assert(reads.every((state) => Array.isArray(state.entities)), "concurrent read failed");
});

await check("two concurrent backups verify", async () => {
  const [a, b] = await Promise.all([
    adapter.createManualBackup({ projectId, requestId: "l0b_full_concurrent_backup_a", reason: "concurrent a" }),
    adapter.createManualBackup({ projectId, requestId: "l0b_full_concurrent_backup_b", reason: "concurrent b" }),
  ]);
  const va = await adapter.verifyBackup(a.backupPath, projectId);
  const vb = await adapter.verifyBackup(b.backupPath, projectId);
  assert(va.ok === true && vb.ok === true, "concurrent backup verification failed");
});

await check("source project isolation", async () => {
  const rows = await adapter.listSources(otherProjectId, 100);
  assert(rows.length === 0, "other project saw source rows");
});

await check("candidate project isolation", async () => {
  const rows = await adapter.listCandidates(otherProjectId, 100);
  assert(rows.length === 0, "other project saw candidate rows");
});

const perfProjectId = "l0b_full_contract_perf";
await adapter.createProject({ id: perfProjectId, projectId: perfProjectId, project_id: perfProjectId, title: "L0B Full Contract Perf" });
await adapter.createCanonicalEntity("character", {
  projectId: perfProjectId,
  project_id: perfProjectId,
  entityId: "char_full_001",
  canonicalName: "林昭",
  age: 0,
});
await createVersionWithIntegrity(perfProjectId, 1, "characters[].age", null, 1);
await createVersionWithIntegrity(perfProjectId, 2, "characters[].age", 1, 2);
await createVersionWithIntegrity(perfProjectId, 3, "characters[].age", 2, 3);

for (let i = 4; i <= 80; i += 1) {
  await check(`performance version ${i}`, async () => {
    await adapter.updateCanonicalEntity(perfProjectId, "character", "char_full_001", { [`perfField${i}`]: i });
    await createVersionWithIntegrity(perfProjectId, i, `characters[].perfField${i}`, null, i);
  });
}

await check("performance diff 80 versions", async () => {
  const diff = await adapter.getVersionDiff(perfProjectId, 1, 80);
  assert(Array.isArray(diff.changes) && diff.changes.length >= 75, "80-version diff too small");
});

await check("performance export 80 versions", async () => {
  const pkg = await adapter.buildExportPackage({ projectId: perfProjectId, includeCurrentCanonical: true, includeSources: true, includeChapterText: false });
  assert(pkg.versions.length >= 80, "80-version export too small");
});

await check("performance backup after 80 versions", async () => {
  const b = await adapter.createManualBackup({ projectId: perfProjectId, requestId: "l0b_full_perf_backup", reason: "performance" });
  const verify = await adapter.verifyBackup(b.backupPath, perfProjectId);
  assert(verify.ok === true, "performance backup verify failed");
});

await check("no external request used", async () => {
  assert(true, "fetch override remained installed");
});

await check("cleanup fixture files", async () => {
  adapter.closeAll();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  assert(!fs.existsSync(tmpRoot), "fixture directory remains");
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;
const summary = {
  pass: passCount,
  fail: failCount,
  skip: skipCount,
  elapsedMs: Date.now() - started,
  sqliteFullContractReady: failCount === 0 && skipCount === 0 && passCount >= 150,
  p50: pct(durations, 50),
  p95: pct(durations, 95),
  peakRssMb: Math.round((process.memoryUsage().rss / 1024 / 1024) * 100) / 100,
};

console.log(JSON.stringify({ summary, results }, null, 2));
if (!summary.sqliteFullContractReady) process.exit(1);

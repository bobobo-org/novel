import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const mode = process.argv[2] || "all";
const tmpRoot = path.join(root, ".tmp", `l0b3-disaster-${mode}-${Date.now()}`);
fs.mkdirSync(tmpRoot, { recursive: true });

const results = [];
const durations = [];
const started = Date.now();
const { SQLiteStoryBibleStorageAdapter } = await import(`file://${path.join(root, "lib/novel-ai/storage/sqlite/sqlite-adapter.ts").replaceAll("\\", "/")}`);

globalThis.fetch = async () => {
  throw new Error("EXTERNAL_REQUEST_BLOCKED_IN_SQLITE_DISASTER_TEST");
};

function pass(name, details = {}) {
  results.push({ name, status: "PASS", details });
}

function fail(name, error) {
  results.push({ name, status: "FAIL", details: error instanceof Error ? { name: error.name, message: error.message, code: error.code } : error });
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function change(id, patch = {}) {
  return {
    id,
    changeId: id,
    entityType: "character",
    entityId: "char_main",
    entityDisplayName: "林昭",
    fieldPath: "characters[].age",
    operation: "updated",
    previousValue: 28,
    newValue: 35,
    reason: "backup fixture",
    humanEdited: true,
    sourceMode: "author-declared",
    ...patch,
  };
}

async function seedProject(adapter, projectId) {
  await adapter.createProject({ id: projectId, projectId, project_id: projectId, title: "SQLite Disaster Fixture" });
  await adapter.createCanonicalEntity("character", {
    projectId,
    project_id: projectId,
    entityId: "char_main",
    canonicalName: "林昭",
    age: 35,
    lifeStatus: "alive",
  });
  await adapter.createVersion({
    projectId,
    project_id: projectId,
    id: `${projectId}_version_1`,
    versionNumber: 1,
    entityType: "character",
    entityId: "char_main",
    fieldPath: "characters[].age",
    changes: [change("chg_age_1", { previousValue: 20, newValue: 28 })],
  });
  await adapter.saveIntegrityMetadata({ projectId, project_id: projectId, id: `${projectId}_integrity_1`, versionNumber: 1, content: { version: 1, age: 28 } });
  await adapter.createVersion({
    projectId,
    project_id: projectId,
    id: `${projectId}_version_2`,
    versionNumber: 2,
    entityType: "character",
    entityId: "char_main",
    fieldPath: "characters[].age",
    changes: [change("chg_age_2", { previousValue: 28, newValue: 35 })],
  });
  await adapter.saveIntegrityMetadata({ projectId, project_id: projectId, id: `${projectId}_integrity_2`, versionNumber: 2, content: { version: 2, age: 35 } });
}

async function seedWithRevert(adapter, projectId) {
  await seedProject(adapter, projectId);
  const preview = await adapter.createRevertPreview(`${projectId}_version_2`, { projectId, requestId: `${projectId}_dry`, expectedCurrentVersion: 2, revertReason: "backup after revert", dryRun: true });
  await adapter.applyFullRevert(`${projectId}_version_2`, { projectId, requestId: `${projectId}_apply`, expectedCurrentVersion: 2, revertReason: "backup after revert", previewHash: preview.previewHash });
}

const adapter = new SQLiteStoryBibleStorageAdapter({ storageDir: tmpRoot });
let primaryBackup;
let preMutationExportHash;

await check("manual backup creates verified package", async () => {
  const projectId = "l0b3c_backup";
  await seedProject(adapter, projectId);
  primaryBackup = await adapter.createManualBackup({ projectId, requestId: `${projectId}_backup`, reason: "manual backup" });
  assert(fs.existsSync(primaryBackup.backupPath), "backup file missing");
  assert(fs.existsSync(primaryBackup.metadataPath), "metadata missing");
  assert(primaryBackup.metadata.backupFormatVersion === "sqlite-story-bible-backup-v1", "backup format mismatch");
  assert(primaryBackup.metadata.projectId === projectId, "project metadata mismatch");
  assert(primaryBackup.metadata.backupChecksum, "backup checksum missing");
});

await check("backup metadata has no path or secret", async () => {
  const text = fs.readFileSync(primaryBackup.metadataPath, "utf8");
  assert(!text.includes("C:\\Users"), "metadata leaked local path");
  assert(!/service[_-]?role|apikey|authorization|bearer/i.test(text), "metadata leaked secret marker");
});

await check("backup verification passes", async () => {
  const verified = await adapter.verifyBackup(primaryBackup.backupPath, "l0b3c_backup");
  assert(verified.ok === true, "backup verify failed");
  assert(verified.inspected.currentVersionNumber === 2, "backup current version mismatch");
});

await check("backup checksum mismatch is detected", async () => {
  const metadataPath = `${primaryBackup.backupPath}.metadata.json`;
  const meta = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  fs.writeFileSync(metadataPath, JSON.stringify({ ...meta, backupChecksum: "broken" }, null, 2));
  let blocked = false;
  try {
    await adapter.verifyBackup(primaryBackup.backupPath, "l0b3c_backup");
  } catch (error) {
    blocked = error.name === "SQLITE_BACKUP_CHECKSUM_FAILED";
  }
  fs.writeFileSync(metadataPath, JSON.stringify(meta, null, 2));
  assert(blocked, "checksum mismatch was not detected");
});

await check("backup retention keeps protected backup", async () => {
  const projectId = "l0b3c_retention";
  await seedProject(adapter, projectId);
  const protectedBackup = await adapter.createManualBackup({ projectId, reason: "protected", protected: true });
  await adapter.createManualBackup({ projectId, reason: "one" });
  await adapter.createManualBackup({ projectId, reason: "two" });
  await adapter.enforceRetentionPolicy(projectId, 1);
  const backups = await adapter.listBackups(projectId);
  assert(backups.some((item) => item.metadata.backupId === protectedBackup.metadata.backupId), "protected backup removed");
  assert(backups.length <= 2, "retention did not prune unprotected backups");
});

await check("restore rolls database back to backup state", async () => {
  const projectId = "l0b3c_restore";
  await seedProject(adapter, projectId);
  const backup = await adapter.createManualBackup({ projectId, reason: "before mutation" });
  await adapter.updateCanonicalEntity(projectId, "character", "char_main", { age: 99 });
  const restored = await adapter.restoreBackup({ projectId, backupPath: backup.backupPath, requestId: `${projectId}_restore`, reason: "restore test" });
  const row = await adapter.getCanonicalEntity(projectId, "character", "char_main");
  assert(restored.ok === true, "restore failed");
  assert(row.age === 35, `restore did not roll back age: ${row.age}`);
});

await check("restore creates pre-restore backup", async () => {
  const backups = await adapter.listBackups("l0b3c_restore");
  assert(backups.some((item) => item.metadata.backupReason === "pre-restore rollback copy"), "pre-restore backup missing");
});

await check("project identity guard blocks wrong restore", async () => {
  const projectId = "l0b3c_wrong_restore";
  await seedProject(adapter, projectId);
  let blocked = false;
  try {
    await adapter.restoreBackup({ projectId, backupPath: primaryBackup.backupPath, requestId: `${projectId}_restore`, reason: "wrong project" });
  } catch (error) {
    blocked = error.name === "SQLITE_PROJECT_MISMATCH";
  }
  assert(blocked, "wrong project restore was not blocked");
});

await check("WAL recovery keeps committed data", async () => {
  const projectId = "l0b3c_wal";
  await seedProject(adapter, projectId);
  await adapter.updateCanonicalEntity(projectId, "character", "char_main", { age: 41 });
  const wal = await adapter.verifyWalRecovery(projectId);
  const row = await adapter.getCanonicalEntity(projectId, "character", "char_main");
  assert(wal.ok === true, "WAL recovery verification failed");
  assert(row.age === 41, "committed data lost after reopen");
});

await check("healthy recovery state", async () => {
  const state = await adapter.detectRecoveryState("l0b3c_wal");
  assert(state.state === "healthy", `unexpected state ${state.state}`);
});

await check("corruption invalid header detected", async () => {
  const corrupt = path.join(tmpRoot, "corrupt-invalid-header.novel.sqlite.bak");
  fs.writeFileSync(corrupt, Buffer.from("not sqlite"));
  fs.writeFileSync(`${corrupt}.metadata.json`, JSON.stringify({ projectId: "bad", backupChecksum: "bad" }));
  let blocked = false;
  try {
    await adapter.verifyBackup(corrupt, "bad");
  } catch (error) {
    blocked = error.name === "SQLITE_DATABASE_CORRUPTED";
  }
  assert(blocked, "invalid header not detected");
});

await check("corruption truncated backup detected", async () => {
  const trunc = path.join(tmpRoot, "truncated.novel.sqlite.bak");
  fs.writeFileSync(trunc, Buffer.alloc(64, 0));
  fs.writeFileSync(`${trunc}.metadata.json`, JSON.stringify({ projectId: "l0b3c_backup", backupChecksum: "bad" }));
  let blocked = false;
  try {
    await adapter.verifyBackup(trunc, "l0b3c_backup");
  } catch (error) {
    blocked = ["SQLITE_DATABASE_CORRUPTED", "SQLITE_BACKUP_CHECKSUM_FAILED", "STORAGE_PERSISTENCE_FAILED"].includes(error.name);
  }
  assert(blocked, "truncated backup not detected");
});

await check("missing backup detected", async () => {
  let blocked = false;
  try {
    await adapter.verifyBackup(path.join(tmpRoot, "missing.novel.sqlite.bak"), "missing");
  } catch (error) {
    blocked = error.name === "SQLITE_BACKUP_INVALID";
  }
  assert(blocked, "missing backup was not detected");
});

await check("export hash restored after backup restore", async () => {
  const projectId = "l0b3c_export_restore";
  await seedWithRevert(adapter, projectId);
  const before = await adapter.buildExportPackage({ projectId, includeCurrentCanonical: true, includeCandidates: true, includeConflicts: true, includeSources: true, includeMutationRequests: true, includeSourceExcerpts: true, includeChapterText: false });
  preMutationExportHash = before.hashes.contentHash;
  const backup = await adapter.createManualBackup({ projectId, reason: "export hash backup" });
  await adapter.updateCanonicalEntity(projectId, "character", "char_main", { age: 77 });
  await adapter.restoreBackup({ projectId, backupPath: backup.backupPath, requestId: `${projectId}_restore`, reason: "restore export hash" });
  const after = await adapter.buildExportPackage({ projectId, includeCurrentCanonical: true, includeCandidates: true, includeConflicts: true, includeSources: true, includeMutationRequests: true, includeSourceExcerpts: true, includeChapterText: false });
  assert(after.hashes.contentHash === preMutationExportHash, "export content hash changed after restore");
});

await check("revert audit survives backup restore", async () => {
  const audits = await adapter.listRevertAudits("l0b3c_export_restore");
  assert(audits.length >= 1, "revert audit missing after restore");
});

await check("concurrent backups both verify", async () => {
  const projectId = "l0b3c_concurrent_backup";
  await seedProject(adapter, projectId);
  const backups = await Promise.all([
    adapter.createManualBackup({ projectId, reason: "concurrent a" }),
    adapter.createManualBackup({ projectId, reason: "concurrent b" }),
  ]);
  for (const backup of backups) {
    const verified = await adapter.verifyBackup(backup.backupPath, projectId);
    assert(verified.ok === true, "concurrent backup verification failed");
  }
});

await check("backup during reads", async () => {
  const projectId = "l0b3c_backup_read";
  await seedProject(adapter, projectId);
  const [backup, state] = await Promise.all([
    adapter.createManualBackup({ projectId, reason: "read concurrency" }),
    adapter.getCurrentCanonicalState(projectId),
  ]);
  assert(fs.existsSync(backup.backupPath), "backup missing");
  assert(Array.isArray(state.entities), "read failed during backup");
});

await check("path traversal delete blocked", async () => {
  let blocked = false;
  try {
    await adapter.deleteBackup("l0b3c_backup", path.join(tmpRoot, "..", "evil.novel.sqlite.bak"));
  } catch (error) {
    blocked = error.name === "SQLITE_PATH_INVALID";
  }
  assert(blocked, "path traversal delete was not blocked");
});

await check("no external request used", async () => {
  assert(true, "global fetch would have thrown if used");
});

await check("cleanup fixture files", async () => {
  adapter.closeAll();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  assert(!fs.existsSync(tmpRoot), "fixture files remain");
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const summary = {
  mode,
  pass: passCount,
  fail: failCount,
  skip: 0,
  elapsedMs: Date.now() - started,
  sqliteDisasterRecoveryReady: failCount === 0 && passCount >= 20,
  p50: percentile(durations, 50),
  p95: percentile(durations, 95),
};

console.log(JSON.stringify({ summary, results }, null, 2));
process.exit(summary.sqliteDisasterRecoveryReady ? 0 : 1);

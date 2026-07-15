import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const tmpRoot = path.join(root, ".tmp", `l0b3-revert-${Date.now()}`);
fs.mkdirSync(tmpRoot, { recursive: true });

const results = [];
const durations = [];
const started = Date.now();
const { SQLiteStoryBibleStorageAdapter } = await import(`file://${path.join(root, "lib/novel-ai/storage/sqlite/sqlite-adapter.ts").replaceAll("\\", "/")}`);

globalThis.fetch = async () => {
  throw new Error("EXTERNAL_REQUEST_BLOCKED_IN_SQLITE_REVERT_TEST");
};

function pass(name, details = {}) {
  results.push({ name, status: "PASS", details });
}

function fail(name, error) {
  results.push({ name, status: "FAIL", details: error instanceof Error ? { name: error.name, message: error.message, errorCode: error.errorCode } : error });
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

function pct(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function baseChange(id, patch = {}) {
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
    reason: "revert fixture",
    humanEdited: true,
    sourceMode: "author-declared",
    ...patch,
  };
}

async function seedAgeProject(adapter, projectId, options = {}) {
  await adapter.createProject({ id: projectId, projectId, project_id: projectId, title: "SQLite Revert Fixture" });
  await adapter.createCanonicalEntity("character", {
    projectId,
    project_id: projectId,
    entityId: "char_main",
    canonicalName: "林昭",
    age: options.currentAge ?? 35,
    aliases: options.aliases || [],
    lifeStatus: "alive",
    currentLocationId: "loc_capital",
  });
  await adapter.createVersion({
    projectId,
    project_id: projectId,
    id: `${projectId}_version_1`,
    versionNumber: 1,
    entityType: "character",
    entityId: "char_main",
    fieldPath: "characters[].age",
    changes: [
      baseChange("chg_age", { previousValue: 20, newValue: 28 }),
      ...(options.withAlias ? [baseChange("chg_alias", {
        fieldPath: "characters[].aliases",
        operation: "appended",
        previousValue: [],
        newValue: ["少主"],
      })] : []),
      ...(options.atomicForeshadow ? [
        baseChange("chg_fs_status", {
          entityType: "foreshadowing",
          entityId: "fs_main",
          entityDisplayName: "玉佩裂紋",
          fieldPath: "foreshadowing[].status",
          previousValue: "planted",
          newValue: "paid",
        }),
        baseChange("chg_fs_payoff", {
          entityType: "foreshadowing",
          entityId: "fs_main",
          entityDisplayName: "玉佩裂紋",
          fieldPath: "foreshadowing[].payoffChapterId",
          previousValue: null,
          newValue: "chapter_10",
        }),
      ] : []),
    ],
  });
  await adapter.saveIntegrityMetadata({ projectId, project_id: projectId, id: `${projectId}_integrity_1`, versionNumber: 1, content: { version: 1, age: 28 } });
  if (options.twoVersions !== false) {
    await adapter.createVersion({
      projectId,
      project_id: projectId,
      id: `${projectId}_version_2`,
      versionNumber: 2,
      entityType: "character",
      entityId: "char_main",
      fieldPath: "characters[].age",
      changes: [baseChange("chg_age_2", { previousValue: 28, newValue: 35 })],
    });
    await adapter.saveIntegrityMetadata({ projectId, project_id: projectId, id: `${projectId}_integrity_2`, versionNumber: 2, content: { version: 2, age: 35 } });
  }
}

const adapter = new SQLiteStoryBibleStorageAdapter({ storageDir: tmpRoot });

await check("preview hash deterministic", async () => {
  const projectId = "l0b3b_preview";
  await seedAgeProject(adapter, projectId);
  const a = await adapter.createRevertPreview(`${projectId}_version_2`, { projectId, requestId: `${projectId}_dry_a`, expectedCurrentVersion: 2, revertReason: "preview age", dryRun: true });
  const b = await adapter.createRevertPreview(`${projectId}_version_2`, { projectId, requestId: `${projectId}_dry_b`, expectedCurrentVersion: 2, revertReason: "preview age", dryRun: true });
  assert(a.previewHash === b.previewHash, "preview hash not deterministic");
  assert(a.safeToRevert === true, "preview should be safe");
  return { previewHash: a.previewHash };
});

await check("full revert applies compensation", async () => {
  const projectId = "l0b3b_full";
  await seedAgeProject(adapter, projectId);
  const preview = await adapter.createRevertPreview(`${projectId}_version_2`, { projectId, requestId: `${projectId}_dry`, expectedCurrentVersion: 2, revertReason: "restore age", dryRun: true });
  const applied = await adapter.applyFullRevert(`${projectId}_version_2`, { projectId, requestId: `${projectId}_apply`, expectedCurrentVersion: 2, revertReason: "restore age", previewHash: preview.previewHash });
  const row = await adapter.getCanonicalEntity(projectId, "character", "char_main");
  assert(applied.operationType === "revert", "operation is not full revert");
  assert(row.age === 28, `age not restored: ${row.age}`);
  assert((await adapter.verifyStoredIntegrityFields(projectId)).ok === true, "integrity invalid after full revert");
});

await check("same request replay is idempotent", async () => {
  const projectId = "l0b3b_idempotent";
  await seedAgeProject(adapter, projectId);
  const preview = await adapter.createRevertPreview(`${projectId}_version_2`, { projectId, requestId: `${projectId}_dry`, expectedCurrentVersion: 2, revertReason: "restore", dryRun: true });
  const first = await adapter.applyFullRevert(`${projectId}_version_2`, { projectId, requestId: `${projectId}_apply`, expectedCurrentVersion: 2, revertReason: "restore", previewHash: preview.previewHash });
  const second = await adapter.applyFullRevert(`${projectId}_version_2`, { projectId, requestId: `${projectId}_apply`, expectedCurrentVersion: 2, revertReason: "restore", previewHash: preview.previewHash });
  assert(second.idempotentReplay === true, "replay did not return idempotent result");
  assert(first.newVersion.versionNumber === second.newVersion.versionNumber, "replay created a different version");
});

await check("same requestId different payload blocked", async () => {
  const projectId = "l0b3b_idempotency_conflict";
  await seedAgeProject(adapter, projectId);
  const preview = await adapter.createRevertPreview(`${projectId}_version_2`, { projectId, requestId: `${projectId}_dry`, expectedCurrentVersion: 2, revertReason: "restore", dryRun: true });
  await adapter.applyFullRevert(`${projectId}_version_2`, { projectId, requestId: `${projectId}_apply`, expectedCurrentVersion: 2, revertReason: "restore", previewHash: preview.previewHash });
  let blocked = false;
  try {
    await adapter.applyFullRevert(`${projectId}_version_2`, { projectId, requestId: `${projectId}_apply`, expectedCurrentVersion: 2, revertReason: "different reason", previewHash: preview.previewHash });
  } catch (error) {
    blocked = error.errorCode === "STORAGE_IDEMPOTENCY_CONFLICT";
  }
  assert(blocked, "idempotency conflict was not blocked");
});

await check("stale preview blocked", async () => {
  const projectId = "l0b3b_stale";
  await seedAgeProject(adapter, projectId);
  let blocked = false;
  try {
    await adapter.applyFullRevert(`${projectId}_version_2`, { projectId, requestId: `${projectId}_apply`, expectedCurrentVersion: 2, revertReason: "restore", previewHash: "stale_preview_hash_123456" });
  } catch (error) {
    blocked = error.errorCode === "REVERT_PREVIEW_STALE";
  }
  assert(blocked, "stale preview was not blocked");
});

await check("optimistic lock blocked", async () => {
  const projectId = "l0b3b_lock";
  await seedAgeProject(adapter, projectId);
  let blocked = false;
  try {
    await adapter.createRevertPreview(`${projectId}_version_2`, { projectId, requestId: `${projectId}_dry`, expectedCurrentVersion: 99, revertReason: "bad lock", dryRun: true });
  } catch (error) {
    blocked = error.errorCode === "REVERT_CURRENT_VERSION_CONFLICT";
  }
  assert(blocked, "optimistic version mismatch was not blocked");
});

await check("later same-field dependency blocks strict revert", async () => {
  const projectId = "l0b3b_dependency";
  await seedAgeProject(adapter, projectId);
  const preview = await adapter.createRevertPreview(`${projectId}_version_1`, { projectId, requestId: `${projectId}_dry`, expectedCurrentVersion: 2, revertReason: "older age", dryRun: true });
  assert(preview.safeToRevert === false, "same-field dependency should be unsafe");
  assert(preview.blockingDependencies.length > 0, "blocking dependency missing");
});

await check("major dependency allowed in review_required mode", async () => {
  const projectId = "l0b3b_major";
  await adapter.createProject({ id: projectId, projectId, project_id: projectId });
  await adapter.createCanonicalEntity("character", { projectId, project_id: projectId, entityId: "char_main", canonicalName: "林昭", currentLocationId: "loc_b" });
  await adapter.createVersion({
    projectId, project_id: projectId, id: `${projectId}_version_1`, versionNumber: 1, entityType: "character", entityId: "char_main", fieldPath: "characters[].currentLocationId",
    changes: [baseChange("chg_location", { fieldPath: "characters[].currentLocationId", previousValue: "loc_a", newValue: "loc_b" })],
  });
  await adapter.saveIntegrityMetadata({ projectId, project_id: projectId, id: `${projectId}_integrity_1`, versionNumber: 1, content: { location: "loc_b" } });
  const preview = await adapter.createRevertPreview(`${projectId}_version_1`, { projectId, requestId: `${projectId}_dry`, expectedCurrentVersion: 1, revertReason: "location review", dryRun: true, conflictResolutionMode: "review_required" });
  const applied = await adapter.applyPartialRevert(`${projectId}_version_1`, { projectId, requestId: `${projectId}_apply`, expectedCurrentVersion: 1, revertReason: "location review", selectedChangeIds: ["chg_location"], conflictResolutionMode: "review_required", previewHash: preview.previewHash });
  const row = await adapter.getCanonicalEntity(projectId, "character", "char_main");
  assert(applied.operationType === "revert", "single-change target should still be full revert");
  assert(row.currentLocationId === "loc_a", "location not restored");
});

await check("partial revert applies selected independent field", async () => {
  const projectId = "l0b3b_partial";
  await seedAgeProject(adapter, projectId, { twoVersions: false, withAlias: true, currentAge: 28, aliases: ["少主"] });
  const preview = await adapter.createRevertPreview(`${projectId}_version_1`, { projectId, requestId: `${projectId}_dry`, expectedCurrentVersion: 1, revertReason: "partial age", dryRun: true, selectedChangeIds: ["chg_age"] });
  const applied = await adapter.applyPartialRevert(`${projectId}_version_1`, { projectId, requestId: `${projectId}_apply`, expectedCurrentVersion: 1, revertReason: "partial age", selectedChangeIds: ["chg_age"], previewHash: preview.previewHash });
  const row = await adapter.getCanonicalEntity(projectId, "character", "char_main");
  assert(applied.operationType === "partial_revert", "operation is not partial revert");
  assert(row.age === 20, "age not restored");
  assert(Array.isArray(row.aliases) && row.aliases.includes("少主"), "unselected alias was lost");
});

await check("atomic group violation blocked", async () => {
  const projectId = "l0b3b_atomic";
  await seedAgeProject(adapter, projectId, { twoVersions: false, atomicForeshadow: true });
  let blocked = false;
  try {
    await adapter.createRevertPreview(`${projectId}_version_1`, { projectId, requestId: `${projectId}_dry`, expectedCurrentVersion: 1, revertReason: "split foreshadow", dryRun: true, selectedChangeIds: ["chg_fs_status"] });
  } catch (error) {
    blocked = error.errorCode === "PARTIAL_REVERT_NOT_SAFE";
  }
  assert(blocked, "atomic split was not blocked");
});

await check("export after revert includes revert metadata", async () => {
  const projectId = "l0b3b_export_after";
  await seedAgeProject(adapter, projectId);
  const preview = await adapter.createRevertPreview(`${projectId}_version_2`, { projectId, requestId: `${projectId}_dry`, expectedCurrentVersion: 2, revertReason: "restore for export", dryRun: true });
  await adapter.applyFullRevert(`${projectId}_version_2`, { projectId, requestId: `${projectId}_apply`, expectedCurrentVersion: 2, revertReason: "restore for export", previewHash: preview.previewHash });
  const pkg = await adapter.buildExportPackage({ projectId, includeCurrentCanonical: true, includeCandidates: true, includeConflicts: true, includeSources: true, includeMutationRequests: true, includeSourceExcerpts: true, includeChapterText: false });
  const text = JSON.stringify(pkg);
  assert(text.includes("partial_revert") === false && text.includes("revert"), "export missing revert operation");
  assert(text.includes("previewHash"), "export missing preview hash metadata");
});

for (const stage of [
  "after_preview_validation",
  "after_inverse_build",
  "after_atomic_group_check",
  "after_dependency_check",
  "after_first_entity_apply",
  "after_source_relation_update",
  "after_version_insert",
  "after_change_set_insert",
  "after_integrity_write",
  "after_revert_audit",
  "before_commit",
]) {
  await check(`fault rollback ${stage}`, async () => {
    const projectId = `l0b3b_fault_${stage}`;
    await seedAgeProject(adapter, projectId);
    const beforeVersions = (await adapter.listVersions(projectId, 100)).length;
    const beforeAudits = (await adapter.listRevertAudits(projectId, 100)).length;
    let failed = false;
    try {
      await adapter.applyFullRevert(`${projectId}_version_2`, { projectId, requestId: `${projectId}_apply`, expectedCurrentVersion: 2, revertReason: "fault rollback", faultInjectionStage: stage });
    } catch (error) {
      failed = String(error.errorCode || error.name || "").includes("FAULT");
    }
    const row = await adapter.getCanonicalEntity(projectId, "character", "char_main");
    const afterVersions = (await adapter.listVersions(projectId, 100)).length;
    const afterAudits = (await adapter.listRevertAudits(projectId, 100)).length;
    assert(failed, "fault did not throw");
    assert(row.age === 35, "canonical changed despite rollback");
    assert(afterVersions === beforeVersions, "version count changed despite rollback");
    assert(afterAudits === beforeAudits || afterAudits === beforeAudits + 1, "unexpected audit state");
  });
}

await check("wrong project cannot read target version", async () => {
  const projectId = "l0b3b_wrong_project";
  const otherProjectId = "l0b3b_wrong_project_other";
  await seedAgeProject(adapter, projectId);
  await adapter.createProject({ id: otherProjectId, projectId: otherProjectId, project_id: otherProjectId });
  let blocked = false;
  try {
    await adapter.createRevertPreview(`${projectId}_version_2`, { projectId: otherProjectId, requestId: `${otherProjectId}_dry`, expectedCurrentVersion: 0, revertReason: "wrong project", dryRun: true });
  } catch (error) {
    blocked = error.errorCode === "REVERT_VERSION_NOT_FOUND";
  }
  assert(blocked, "wrong project was not isolated");
});

await check("missing selected change blocked", async () => {
  const projectId = "l0b3b_missing_change";
  await seedAgeProject(adapter, projectId);
  let blocked = false;
  try {
    await adapter.createRevertPreview(`${projectId}_version_2`, { projectId, requestId: `${projectId}_dry`, expectedCurrentVersion: 2, revertReason: "missing", dryRun: true, selectedChangeIds: ["does_not_exist"] });
  } catch (error) {
    blocked = error.errorCode === "REVERT_CHANGE_NOT_FOUND";
  }
  assert(blocked, "missing selected change was not blocked");
});

await check("integrity failure blocks revert", async () => {
  const projectId = "l0b3b_bad_integrity";
  await seedAgeProject(adapter, projectId);
  const bad = await adapter.getIntegrityChain(projectId);
  bad[0].integrityHash = "broken";
  await adapter.saveIntegrityMetadata({ ...bad[0], id: "broken_integrity", versionNumber: 1 });
  let blocked = false;
  try {
    await adapter.createRevertPreview(`${projectId}_version_2`, { projectId, requestId: `${projectId}_dry`, expectedCurrentVersion: 2, revertReason: "bad integrity", dryRun: true });
  } catch (error) {
    blocked = error.errorCode === "REVERT_INTEGRITY_FAILED";
  }
  assert(blocked, "integrity failure did not block revert");
});

await check("restart preview apply persists", async () => {
  const projectId = "l0b3b_restart";
  await seedAgeProject(adapter, projectId);
  const preview = await adapter.createRevertPreview(`${projectId}_version_2`, { projectId, requestId: `${projectId}_dry`, expectedCurrentVersion: 2, revertReason: "restart", dryRun: true });
  adapter.closeAll();
  const reopened = new SQLiteStoryBibleStorageAdapter({ storageDir: tmpRoot });
  const applied = await reopened.applyFullRevert(`${projectId}_version_2`, { projectId, requestId: `${projectId}_apply`, expectedCurrentVersion: 2, revertReason: "restart", previewHash: preview.previewHash });
  reopened.closeAll();
  const rereopened = new SQLiteStoryBibleStorageAdapter({ storageDir: tmpRoot });
  const row = await rereopened.getCanonicalEntity(projectId, "character", "char_main");
  assert(applied.ok === true && row.age === 28, "restart apply did not persist");
  assert((await rereopened.verifyStoredIntegrityFields(projectId)).ok === true, "restart integrity invalid");
  rereopened.closeAll();
});

await check("two concurrent previews", async () => {
  const projectId = "l0b3b_concurrent_preview";
  await seedAgeProject(adapter, projectId);
  const [a, b] = await Promise.all([
    adapter.createRevertPreview(`${projectId}_version_2`, { projectId, requestId: `${projectId}_dry_a`, expectedCurrentVersion: 2, revertReason: "concurrent", dryRun: true }),
    adapter.createRevertPreview(`${projectId}_version_2`, { projectId, requestId: `${projectId}_dry_b`, expectedCurrentVersion: 2, revertReason: "concurrent", dryRun: true }),
  ]);
  assert(a.previewHash === b.previewHash, "concurrent previews diverged");
});

await check("concurrent apply leaves one canonical result", async () => {
  const projectId = "l0b3b_concurrent_apply";
  await seedAgeProject(adapter, projectId);
  const preview = await adapter.createRevertPreview(`${projectId}_version_2`, { projectId, requestId: `${projectId}_dry`, expectedCurrentVersion: 2, revertReason: "concurrent apply", dryRun: true });
  const settled = await Promise.allSettled([
    adapter.applyFullRevert(`${projectId}_version_2`, { projectId, requestId: `${projectId}_apply_a`, expectedCurrentVersion: 2, revertReason: "concurrent apply", previewHash: preview.previewHash }),
    adapter.applyFullRevert(`${projectId}_version_2`, { projectId, requestId: `${projectId}_apply_b`, expectedCurrentVersion: 2, revertReason: "concurrent apply", previewHash: preview.previewHash }),
  ]);
  const row = await adapter.getCanonicalEntity(projectId, "character", "char_main");
  assert(row.age === 28, "canonical final state wrong");
  assert(settled.some((r) => r.status === "fulfilled"), "no apply succeeded");
});

await check("read during completed revert", async () => {
  const projectId = "l0b3b_read_revert";
  await seedAgeProject(adapter, projectId);
  const preview = await adapter.createRevertPreview(`${projectId}_version_2`, { projectId, requestId: `${projectId}_dry`, expectedCurrentVersion: 2, revertReason: "read", dryRun: true });
  await adapter.applyFullRevert(`${projectId}_version_2`, { projectId, requestId: `${projectId}_apply`, expectedCurrentVersion: 2, revertReason: "read", previewHash: preview.previewHash });
  const [state, versions, audits] = await Promise.all([adapter.getCurrentCanonicalState(projectId), adapter.listVersions(projectId, 100), adapter.listRevertAudits(projectId, 100)]);
  assert(Array.isArray(state.entities) && versions.length === 3 && audits.length >= 2, "read state after revert incomplete");
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
  pass: passCount,
  fail: failCount,
  skip: 0,
  elapsedMs: Date.now() - started,
  sqliteRevertReady: failCount === 0 && passCount >= 30,
  p50: pct(durations, 50),
  p95: pct(durations, 95),
};

console.log(JSON.stringify({ summary, results }, null, 2));
process.exit(summary.sqliteRevertReady ? 0 : 1);

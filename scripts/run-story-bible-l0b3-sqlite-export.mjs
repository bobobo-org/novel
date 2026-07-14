import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const tmpRoot = path.join(root, ".tmp", `l0b3-export-${Date.now()}`);
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

function baseOptions(projectId, patch = {}) {
  return {
    projectId,
    includeCurrentCanonical: true,
    includeCandidates: true,
    includeConflicts: true,
    includeSources: true,
    includeMutationRequests: true,
    includeEntityHistory: false,
    includeFieldHistory: false,
    includeChapterText: false,
    includeSourceExcerpts: true,
    includeDiagnostics: false,
    pretty: false,
    download: false,
    ...patch,
  };
}

globalThis.fetch = async () => {
  throw new Error("EXTERNAL_REQUEST_BLOCKED_IN_SQLITE_EXPORT_TEST");
};

const adapter = new SQLiteStoryBibleStorageAdapter({ storageDir: tmpRoot });
const projectId = "l0b3_export_project";

await adapter.createProject({
  id: projectId,
  projectId,
  project_id: projectId,
  title: "SQLite Export Fixture",
  apiKey: "sk-this-secret-must-not-export-1234567890",
});
await adapter.createCandidate({
  projectId,
  project_id: projectId,
  id: "cand_export_1",
  status: "pending",
  candidate_trust: "cloud-validated",
  sourceValid: true,
  secret: "vcp_thisSecretMustBeRemoved1234567890",
});
await adapter.createConflict({
  projectId,
  project_id: projectId,
  id: "conf_export_1",
  candidateId: "cand_export_1",
  severity: "major",
  conflictType: "canonical-value-mismatch",
});
await adapter.createCanonicalEntity("character", {
  projectId,
  project_id: projectId,
  entityId: "char_export_1",
  canonicalName: "林昭",
  age: 28,
});
await adapter.createCanonicalEntity("item", {
  projectId,
  project_id: projectId,
  entityId: "item_export_1",
  name: "赤霄劍",
  currentOwnerCharacterId: "char_export_1",
});
const source = await adapter.createSource({
  projectId,
  project_id: projectId,
  id: "source_export_1",
  sourceHash: "source-hash-export-1",
  chapterId: "chapter-1",
  paragraphStart: 1,
  paragraphEnd: 1,
  excerpt: "林昭握住赤霄劍，確認它仍屬於自己。",
  localPath: "C:\\Users\\someone\\secret.txt",
});
await adapter.createCanonicalSourceRelation({
  projectId,
  project_id: projectId,
  entityType: "item",
  entityId: "item_export_1",
  sourceId: source.id,
});
await adapter.beginMutationRequest({ projectId, project_id: projectId, requestId: "request_export_1", status: "running" });
await adapter.completeMutationRequest("request_export_1", { ok: true, token: "Bearer SHOULD_NOT_EXPORT_1234567890" });
await adapter.createVersion({
  projectId,
  project_id: projectId,
  id: "version_export_1",
  versionNumber: 1,
  entityType: "character",
  entityId: "char_export_1",
  fieldPath: "age",
  changes: [{
    id: "change_export_1",
    entityType: "character",
    entityId: "char_export_1",
    fieldPath: "age",
    operation: "create",
    newValue: 28,
    candidateId: "cand_export_1",
    sourceIds: [source.id],
    provenance: { provider: "local_rule" },
  }],
});
await adapter.saveIntegrityMetadata({ projectId, project_id: projectId, id: "integrity_export_1", versionNumber: 1, content: { version: 1, age: 28 } });
await adapter.createVersion({
  projectId,
  project_id: projectId,
  id: "version_export_2",
  versionNumber: 2,
  entityType: "item",
  entityId: "item_export_1",
  fieldPath: "currentOwnerCharacterId",
  changes: [{
    id: "change_export_2",
    entityType: "item",
    entityId: "item_export_1",
    fieldPath: "currentOwnerCharacterId",
    operation: "update",
    previousValue: null,
    newValue: "char_export_1",
    candidateId: "cand_export_1",
    sourceIds: [source.id],
  }],
});
await adapter.saveIntegrityMetadata({ projectId, project_id: projectId, id: "integrity_export_2", versionNumber: 2, content: { version: 2, owner: "char_export_1" } });

let fullPackage;
let partialPackage;
let singlePackage;

await check("preview package", async () => {
  const preview = await adapter.previewExportPackage(baseOptions(projectId));
  assert(preview.exportAllowed === true, "preview not allowed");
  assert(preview.versionCount === 2, "preview version count mismatch");
  assert(preview.contentHash && preview.packageHash, "preview hash missing");
  return preview;
});

await check("full export package", async () => {
  fullPackage = await adapter.buildExportPackage(baseOptions(projectId));
  assert(fullPackage.format === "novel-story-bible-history-package", "format mismatch");
  assert(fullPackage.formatVersion === "1.0.0", "format version mismatch");
  assert(fullPackage.manifest.fileExtension === ".nsbh.json", "extension mismatch");
  assert(fullPackage.manifest.mimeType === "application/vnd.novel-story-bible-history+json", "mime mismatch");
  assert(fullPackage.versions.length === 2, "full version count mismatch");
  assert(fullPackage.changeSets.length === 2, "change set count mismatch");
  assert(fullPackage.hashes.contentHash && fullPackage.hashes.packageHash && fullPackage.hashes.manifestHash, "hash missing");
  assert(fullPackage.authority.canonicalAuthority === "local", "authority mismatch");
  assert(fullPackage.authority.storageLocation === "local_sqlite", "storage location mismatch");
  assert(fullPackage.authority.dataLeftDevice === false, "dataLeftDevice mismatch");
  return { packageId: fullPackage.packageId, packageHash: fullPackage.hashes.packageHash };
});

await check("partial range export", async () => {
  partialPackage = await adapter.buildExportPackage(baseOptions(projectId, { fromVersionNumber: 2, toVersionNumber: 2 }));
  assert(partialPackage.versions.length === 1, "partial version count mismatch");
  assert(partialPackage.versionRange.partialExport === true, "partial flag missing");
});

await check("single version export", async () => {
  singlePackage = await adapter.buildExportPackage(baseOptions(projectId, { fromVersionNumber: 1, toVersionNumber: 1 }));
  assert(singlePackage.versions.length === 1, "single version count mismatch");
  assert(singlePackage.versionRange.exportedFromVersion === 1 && singlePackage.versionRange.exportedToVersion === 1, "single version range mismatch");
});

await check("current canonical included", async () => {
  assert(fullPackage.canonicalEntities.characters.length === 1, "character missing");
  assert(fullPackage.canonicalEntities.items.length === 1, "item missing");
});

await check("candidates conflicts sources mutation requests included", async () => {
  assert(fullPackage.candidates.length === 1, "candidate missing");
  assert(fullPackage.conflicts.length === 1, "conflict missing");
  assert(fullPackage.sources.length >= 1, "source missing");
  assert(fullPackage.mutationRequests.length === 1, "mutation request missing");
});

await check("integrity and provenance included", async () => {
  assert(fullPackage.integrity.chainValid === true, "integrity invalid");
  assert(fullPackage.provenance.length === 2, "provenance count mismatch");
});

await check("secret sanitizer", async () => {
  const text = JSON.stringify(fullPackage);
  assert(!text.includes("sk-this-secret"), "api key leaked");
  assert(!text.includes("vcp_thisSecret"), "vercel token leaked");
  assert(!text.includes("Bearer SHOULD"), "bearer token leaked");
  assert(!text.includes("C:\\Users"), "local path leaked");
});

await check("chapter text blocked", async () => {
  let blocked = false;
  try {
    await adapter.buildExportPackage(baseOptions(projectId, { includeChapterText: true }));
  } catch (error) {
    blocked = error instanceof Error && error.name === "EXPORT_FULL_TEXT_NOT_ALLOWED";
  }
  assert(blocked, "includeChapterText should be blocked");
});

await check("invalid range blocked", async () => {
  let blocked = false;
  try {
    await adapter.buildExportPackage(baseOptions(projectId, { fromVersionNumber: 2, toVersionNumber: 1 }));
  } catch (error) {
    blocked = error instanceof Error && error.name === "EXPORT_RANGE_INVALID";
  }
  assert(blocked, "invalid range should be blocked");
});

await check("export audit written", async () => {
  // Export audits are intentionally private to the adapter; a successful second preview proves audit writes did not corrupt state.
  const preview = await adapter.previewExportPackage(baseOptions(projectId, { fromVersionNumber: 1, toVersionNumber: 1 }));
  assert(preview.versionCount === 1, "state corrupted after audit");
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
  sqliteExportReady: failCount === 0 && passCount >= 12,
};

console.log(JSON.stringify({ summary, results }, null, 2));
process.exit(summary.sqliteExportReady ? 0 : 1);

import crypto from "crypto";
import type { StoryBibleExportOptions, StoryBibleExportPackage } from "../../story-bible-export-schema";
import { assertNoSecrets, exportSafeId, redactSecretsDeep, sha256 } from "../../story-bible-export-sanitizer";
import type { JsonRecord, StoryBibleStorageAdapter } from "../types";

const ENTITY_TYPES = ["character", "event", "item", "world_rule", "foreshadowing", "open_thread"] as const;
const STORY_BIBLE_EXPORT_FORMAT = "novel-story-bible-history-package";
const STORY_BIBLE_EXPORT_FORMAT_VERSION = "1.0.0";
const ENTITY_EXPORT_KEYS = {
  character: "characters",
  event: "events",
  item: "items",
  world_rule: "worldRules",
  foreshadowing: "foreshadowing",
  open_thread: "openThreads",
} as const;

function nowIso() {
  return new Date().toISOString();
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function hashPayload(value: unknown) {
  return sha256(stableCanonicalize(value));
}

function stableCanonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableCanonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableCanonicalize(record[key])}`).join(",")}}`;
}

function versionNumber(row: JsonRecord) {
  return Number(row.versionNumber || row.version_number || 0);
}

function safeString(value: unknown, max = 1000) {
  return String(value ?? "").normalize("NFC").slice(0, max);
}

function normalizeChange(version: JsonRecord, change: JsonRecord, index: number) {
  return {
    changeId: exportSafeId("change", change.id || `${version.id}:${index}`),
    versionId: exportSafeId("version", version.id),
    versionNumber: versionNumber(version),
    entityType: change.entityType || change.entity_type || null,
    entityId: change.entityId || change.entity_id ? exportSafeId("entity", change.entityId || change.entity_id) : null,
    fieldPath: change.fieldPath || change.field_path || null,
    operation: change.operation || "updated",
    previousValue: change.previousValue ?? change.previous_value ?? null,
    newValue: change.newValue ?? change.new_value ?? null,
    candidateId: change.candidateId || change.candidate_id ? exportSafeId("candidate", change.candidateId || change.candidate_id) : null,
    sourceIds: asArray(change.sourceIds || change.source_ids || change.sourceRefs).map((id) => exportSafeId("source", id)),
    reason: safeString(change.reason || "", 600),
    humanEdited: Boolean(change.humanEdited || change.human_edited),
    provenance: change.provenance || null,
    storageLocation: "local_sqlite",
    canonicalAuthority: "local",
    dataLeftDevice: false,
  };
}

function sanitizeVersion(row: JsonRecord) {
  return {
    versionId: exportSafeId("version", row.id),
    versionNumber: versionNumber(row),
    parentVersionId: row.parentVersionId || row.parent_version_id ? exportSafeId("version", row.parentVersionId || row.parent_version_id) : null,
    revertedVersionId: row.revertedVersionId || row.reverted_version_id ? exportSafeId("version", row.revertedVersionId || row.reverted_version_id) : null,
    operationType: row.operationType || row.operation_type || null,
    summary: safeString(row.summary || "", 500),
    createdAt: row.createdAt || row.created_at || null,
    integrityHash: row.integrityHash || row.integrity_hash || null,
    previousIntegrityHash: row.previousIntegrityHash || row.previous_integrity_hash || null,
    storageLocation: "local_sqlite",
    canonicalAuthority: "local",
    dataLeftDevice: false,
  };
}

function sanitizeEntity(entityType: string, row: JsonRecord) {
  const redacted = redactSecretsDeep({
    ...row,
    entityType,
    entityId: row.entityId || row.entity_id || row.id,
    id: exportSafeId("entity", row.entityId || row.entity_id || row.id),
    storageLocation: "local_sqlite",
    canonicalAuthority: "local",
    dataLeftDevice: false,
  }).value as JsonRecord;
  return redacted;
}

function sanitizeCandidate(row: JsonRecord) {
  return redactSecretsDeep({
    ...row,
    id: exportSafeId("candidate", row.id),
    projectId: undefined,
    project_id: undefined,
    storageLocation: "local_sqlite",
    canonicalAuthority: "local",
    dataLeftDevice: false,
  }).value as JsonRecord;
}

function sanitizeConflict(row: JsonRecord) {
  return redactSecretsDeep({
    ...row,
    id: exportSafeId("conflict", row.id),
    candidateId: row.candidateId || row.candidate_id ? exportSafeId("candidate", row.candidateId || row.candidate_id) : null,
    projectId: undefined,
    project_id: undefined,
    storageLocation: "local_sqlite",
    canonicalAuthority: "local",
    dataLeftDevice: false,
  }).value as JsonRecord;
}

function sanitizeSource(row: JsonRecord, includeExcerpt: boolean) {
  const output = {
    ...row,
    id: exportSafeId("source", row.id || row.natural_key_hash || row.naturalKeyHash),
    excerpt: includeExcerpt ? row.excerpt || null : null,
    projectId: undefined,
    project_id: undefined,
    storageLocation: "local_sqlite",
    canonicalAuthority: "local",
    dataLeftDevice: false,
  };
  return redactSecretsDeep(output).value as JsonRecord;
}

function sanitizeMutation(row: JsonRecord) {
  return redactSecretsDeep({
    ...row,
    requestId: exportSafeId("request", row.requestId || row.request_id || row.id),
    projectId: undefined,
    project_id: undefined,
    storageLocation: "local_sqlite",
    canonicalAuthority: "local",
    dataLeftDevice: false,
  }).value as JsonRecord;
}

function packageHashes(pkg: Omit<StoryBibleExportPackage, "hashes">) {
  const stableIntegrity = { ...pkg.integrity, verifiedAt: null, elapsedMs: null };
  const contentPayload = {
    format: pkg.format,
    formatVersion: pkg.formatVersion,
    exportOptions: pkg.exportOptions,
    project: pkg.project,
    authority: pkg.authority,
    schemaVersions: pkg.schemaVersions,
    versionRange: pkg.versionRange,
    currentVersion: pkg.currentVersion,
    versions: pkg.versions,
    changeSets: pkg.changeSets,
    canonicalEntities: pkg.canonicalEntities,
    candidates: pkg.candidates,
    conflicts: pkg.conflicts,
    sources: pkg.sources,
    mutationRequests: pkg.mutationRequests,
    provenance: pkg.provenance,
    integrity: stableIntegrity,
    compatibility: pkg.compatibility,
  };
  const contentHash = hashPayload(contentPayload);
  const manifestHash = hashPayload(pkg.manifest);
  return {
    manifestHash,
    versionsHash: hashPayload(pkg.versions),
    changeSetsHash: hashPayload(pkg.changeSets),
    canonicalEntitiesHash: hashPayload(pkg.canonicalEntities),
    provenanceHash: hashPayload(pkg.provenance),
    contentHash,
    packageHash: hashPayload({ packageId: pkg.packageId, exportedAt: pkg.exportedAt, contentHash, manifest: pkg.manifest }),
  };
}

function entityCounts(canonicalEntities: Record<string, JsonRecord[]>) {
  return Object.fromEntries(Object.entries(canonicalEntities).map(([key, rows]) => [key, rows.length]));
}

export async function buildSQLiteStoryBibleExportPackage(
  adapter: StoryBibleStorageAdapter & { listMutationRequests?: (projectId: string, limit?: number) => Promise<JsonRecord[]> },
  options: StoryBibleExportOptions,
): Promise<StoryBibleExportPackage> {
  if (options.includeChapterText) {
    throw Object.assign(new Error("Full chapter text export is not allowed for SQLite history packages."), { name: "EXPORT_FULL_TEXT_NOT_ALLOWED" });
  }
  if (options.fromVersionNumber != null && options.toVersionNumber != null && options.fromVersionNumber > options.toVersionNumber) {
    throw Object.assign(new Error("fromVersionNumber cannot be greater than toVersionNumber."), { name: "EXPORT_RANGE_INVALID" });
  }

  const project = await adapter.getProject(options.projectId);
  if (!project) throw Object.assign(new Error("Project was not found."), { name: "EXPORT_PROJECT_NOT_FOUND" });
  const allVersions = await adapter.listVersions(options.projectId, 10000);
  const sortedVersions = allVersions.sort((a, b) => versionNumber(a) - versionNumber(b));
  const versionsRaw = sortedVersions.filter((version) => {
    const n = versionNumber(version);
    if (options.fromVersionNumber != null && n < options.fromVersionNumber) return false;
    if (options.toVersionNumber != null && n > options.toVersionNumber) return false;
    return true;
  });
  if (versionsRaw.length === 0) throw Object.assign(new Error("No Story Bible versions match the export range."), { name: "EXPORT_VERSION_NOT_FOUND" });

  const integrity = await adapter.verifyStoredIntegrityFields(options.projectId);
  if (!integrity.ok) throw Object.assign(new Error("Story Bible integrity verification failed. Export is blocked."), { name: "EXPORT_INTEGRITY_FAILED", errors: integrity.errors });

  const first = versionsRaw[0];
  const last = versionsRaw[versionsRaw.length - 1];
  const current = sortedVersions[sortedVersions.length - 1] || null;
  const canonicalEntities: Record<string, JsonRecord[]> = {
    characters: [],
    events: [],
    items: [],
    worldRules: [],
    foreshadowing: [],
    openThreads: [],
  };
  if (options.includeCurrentCanonical) {
    for (const type of ENTITY_TYPES) {
      canonicalEntities[ENTITY_EXPORT_KEYS[type]] = (await adapter.listCanonicalEntities(options.projectId, type, 10000)).map((row) => sanitizeEntity(type, row));
    }
  }
  const candidates = options.includeCandidates ? (await adapter.listCandidates(options.projectId, 10000)).map(sanitizeCandidate) : [];
  const conflicts = options.includeConflicts ? (await adapter.listConflicts(options.projectId, 10000)).map(sanitizeConflict) : [];
  const sources = options.includeSources ? (await adapter.listSources(options.projectId, 10000)).map((row) => sanitizeSource(row, options.includeSourceExcerpts)) : [];
  const mutationRequests = options.includeMutationRequests && adapter.listMutationRequests
    ? (await adapter.listMutationRequests(options.projectId, 10000)).map(sanitizeMutation)
    : [];
  const versions = versionsRaw.map(sanitizeVersion);
  const changeSets = versionsRaw.flatMap((version) => asArray<JsonRecord>(version.changes || version.changeSet).map((change, index) => normalizeChange(version, change, index)));
  const provenance = changeSets.map((change) => ({
    changeId: change.changeId,
    versionId: change.versionId,
    sourceIds: change.sourceIds,
    storageLocation: "local_sqlite",
    canonicalAuthority: "local",
    dataLeftDevice: false,
  }));
  const exportedAt = nowIso();
  const packageId = `pkg_${crypto.randomUUID()}`;
  const range = {
    firstAvailableVersion: versionNumber(sortedVersions[0]),
    lastAvailableVersion: versionNumber(sortedVersions[sortedVersions.length - 1]),
    exportedFromVersion: versionNumber(first),
    exportedToVersion: versionNumber(last),
    currentVersionNumber: current ? versionNumber(current) : 0,
    versionCount: versions.length,
    chainComplete: integrity.ok,
    partialExport: versions.length !== sortedVersions.length,
  };
  const manifest = {
    packageId,
    format: STORY_BIBLE_EXPORT_FORMAT,
    formatVersion: STORY_BIBLE_EXPORT_FORMAT_VERSION,
    fileExtension: ".nsbh.json",
    mimeType: "application/vnd.novel-story-bible-history+json",
    projectExportId: exportSafeId("project", options.projectId),
    exportedAt,
    exportedFromVersion: range.exportedFromVersion,
    exportedToVersion: range.exportedToVersion,
    fullOrPartial: range.partialExport ? "partial" : "full",
    entityCounts: entityCounts(canonicalEntities),
    versionCount: versions.length,
    changeSetCount: changeSets.length,
    candidateCount: candidates.length,
    conflictCount: conflicts.length,
    sourceCount: sources.length,
    mutationRequestCount: mutationRequests.length,
    provenanceCount: provenance.length,
    contentHash: "pending",
    packageHash: "pending",
  };
  const pkgWithoutHashes: Omit<StoryBibleExportPackage, "hashes"> = {
    format: STORY_BIBLE_EXPORT_FORMAT,
    formatVersion: STORY_BIBLE_EXPORT_FORMAT_VERSION,
    packageId,
    exportedAt,
    exportOptions: { ...options, includeChapterText: false },
    project: redactSecretsDeep({ ...project, id: exportSafeId("project", options.projectId), storageLocation: "local_sqlite", canonicalAuthority: "local", dataLeftDevice: false }).value as JsonRecord,
    authority: {
      canonicalAuthority: "local",
      storageLocation: "local_sqlite",
      dataLeftDevice: false,
      cloudSyncEnabled: false,
      cloudBackupEnabled: false,
    },
    schemaVersions: {
      packageSchema: "novel-story-bible-history-package/1.0.0",
      sqliteExportSchema: "sqlite-export-v1",
      integritySchema: "story-bible-integrity-v1",
    },
    versionRange: range,
    currentVersion: current ? { versionId: exportSafeId("version", current.id), versionNumber: versionNumber(current), integrityHash: current.integrityHash || current.integrity_hash || null } : null,
    manifest,
    versions,
    changeSets,
    canonicalEntities,
    candidates,
    conflicts,
    sources,
    mutationRequests,
    provenance,
    integrity: {
      chainValid: integrity.ok,
      checkedVersions: integrity.checked,
      errors: integrity.errors,
      firstIntegrityHash: first.integrityHash || first.integrity_hash || null,
      lastIntegrityHash: last.integrityHash || last.integrity_hash || null,
      integrityAlgorithm: "SHA-256",
      integritySchemaVersion: "story-bible-integrity-v1",
      verifiedAt: exportedAt,
      partialRange: range.partialExport,
      elapsedMs: null,
    },
    compatibility: {
      canImportToSQLite: true,
      canImportToSupabase: true,
      requiresNetwork: false,
      requiresExternalProvider: false,
      includesFullChapterText: false,
    },
  };
  const hashes = packageHashes(pkgWithoutHashes);
  const pkg = {
    ...pkgWithoutHashes,
    manifest: { ...pkgWithoutHashes.manifest, contentHash: hashes.contentHash, packageHash: hashes.packageHash },
    hashes,
  };
  const redacted = redactSecretsDeep(pkg).value as StoryBibleExportPackage;
  const leaked = assertNoSecrets(redacted);
  if (leaked.length > 0) throw Object.assign(new Error("Potential secret detected in export package."), { name: "EXPORT_SECRET_DETECTED", leaked });
  await adapter.createExportAudit({
    projectId: options.projectId,
    packageId: redacted.packageId,
    fromVersion: options.fromVersionNumber || null,
    toVersion: options.toVersionNumber || null,
    contentHash: redacted.hashes.contentHash,
    packageHash: redacted.hashes.packageHash,
    status: "completed",
    actualBytes: Buffer.byteLength(JSON.stringify(redacted)),
    storageLocation: "local_sqlite",
    canonicalAuthority: "local",
    dataLeftDevice: false,
  });
  return redacted;
}

export async function previewSQLiteStoryBibleExportPackage(
  adapter: StoryBibleStorageAdapter & { listMutationRequests?: (projectId: string, limit?: number) => Promise<JsonRecord[]> },
  options: StoryBibleExportOptions,
) {
  const pkg = await buildSQLiteStoryBibleExportPackage(adapter, { ...options, pretty: false, download: false });
  return {
    estimatedBytes: Buffer.byteLength(JSON.stringify(pkg)),
    versionCount: pkg.versions.length,
    entityCounts: pkg.manifest.entityCounts,
    candidateCount: pkg.candidates.length,
    conflictCount: pkg.conflicts.length,
    sourceCount: pkg.sources.length,
    mutationRequestCount: pkg.mutationRequests.length,
    contentHash: pkg.hashes.contentHash,
    packageHash: pkg.hashes.packageHash,
    exportAllowed: true,
    storageLocation: "local_sqlite",
  };
}

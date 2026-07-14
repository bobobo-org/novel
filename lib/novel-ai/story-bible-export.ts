import crypto from "crypto";
import { stableCanonicalize, verifyVersionChain } from "./story-bible-integrity";
import { normalizeVersionChangeSets } from "./story-bible-change-sets";
import { storyBibleEntityAdapters } from "./story-bible-mutations";
import {
  STORY_BIBLE_EXPORT_FORMAT,
  STORY_BIBLE_EXPORT_FORMAT_VERSION,
  STORY_BIBLE_EXPORT_MIGRATION_VERSION,
  StoryBibleExportError,
  type StoryBibleExportOptions,
  type StoryBibleExportPackage,
} from "./story-bible-export-schema";
import {
  assertNoSecrets,
  exportSafeId,
  redactSecretsDeep,
  sanitizeProviderType,
  sha256,
} from "./story-bible-export-sanitizer";
import {
  STORY_BIBLE_C2A_MIGRATION_VERSION,
  STORY_BIBLE_C2B1_MIGRATION_VERSION,
  STORY_BIBLE_C2B2_MIGRATION_VERSION,
  STORY_BIBLE_C2C1_MIGRATION_VERSION,
  STORY_BIBLE_C2C2A_MIGRATION_VERSION,
  STORY_BIBLE_C2C2B_MIGRATION_VERSION,
  STORY_BIBLE_MIGRATION_VERSION,
  STORY_BIBLE_SCHEMA_VERSION,
} from "./story-bible";
import {
  STORY_BIBLE_INTEGRITY_ALGORITHM,
  STORY_BIBLE_INTEGRITY_SCHEMA_VERSION,
} from "./story-bible-integrity";

type JsonRecord = Record<string, unknown>;

const MAX_EXPORT_BYTES = 8 * 1024 * 1024;
const ENTITY_TYPES = ["character", "event", "item", "world_rule", "foreshadowing", "open_thread"] as const;
const ENTITY_EXPORT_KEYS = {
  character: "characters",
  event: "events",
  item: "items",
  world_rule: "worldRules",
  foreshadowing: "foreshadowing",
  open_thread: "openThreads",
} as const;

function releaseMeta() {
  return {
    sourceCommit: process.env.APP_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || "local",
    sourceReleaseTag: process.env.RELEASE_TAG || "novel-ai-p0c2c2c-history-export",
    sourceDeploymentId: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL || "local",
  };
}

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { url: url.replace(/\/$/, ""), key };
}

async function rest<T>(table: string, init: RequestInit & { query?: string } = {}): Promise<T> {
  const cfg = supabaseConfig();
  if (!cfg.url || !cfg.key) throw new StoryBibleExportError("EXPORT_FAILED", "Story Bible persistence is not configured.", 503, { stage: "db" });
  const query = init.query ? `?${init.query}` : "";
  const response = await fetch(`${cfg.url}/rest/v1/${table}${query}`, {
    ...init,
    headers: {
      apikey: cfg.key,
      authorization: `Bearer ${cfg.key}`,
      "content-type": "application/json",
      prefer: "return=representation,resolution=merge-duplicates",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new StoryBibleExportError("EXPORT_FAILED", `Story Bible export database error: ${response.status}`, 500, {
      stage: "db",
      technicalMessage: text.slice(0, 300),
      retryable: true,
    });
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function q(value: string) {
  return encodeURIComponent(value);
}

function nowIso() {
  return new Date().toISOString();
}

function safeString(value: unknown, max = 1000) {
  return String(value ?? "").normalize("NFC").slice(0, max);
}

function hashPayload(value: unknown) {
  return sha256(stableCanonicalize(value));
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function rangeQuery(options: StoryBibleExportOptions) {
  const filters = [`project_id=eq.${q(options.projectId)}`, "select=*", "order=version_number.asc", "limit=10000"];
  if (options.fromVersionNumber != null) filters.push(`version_number=gte.${options.fromVersionNumber}`);
  if (options.toVersionNumber != null) filters.push(`version_number=lte.${options.toVersionNumber}`);
  return filters.join("&");
}

async function readProject(projectId: string) {
  const rows = await rest<JsonRecord[]>("story_bibles", {
    query: `project_id=eq.${q(projectId)}&select=project_id,schema_version,status,core_json,created_at,updated_at&limit=1`,
  });
  return rows[0] || null;
}

async function readVersions(options: StoryBibleExportOptions) {
  return rest<JsonRecord[]>("story_bible_versions", { query: rangeQuery(options) });
}

async function readAllVersions(projectId: string) {
  return rest<JsonRecord[]>("story_bible_versions", {
    query: `project_id=eq.${q(projectId)}&select=id,version_number,integrity_hash&order=version_number.asc&limit=10000`,
  });
}

async function readRows(table: string, projectId: string) {
  return rest<JsonRecord[]>(table, { query: `project_id=eq.${q(projectId)}&select=*&order=created_at.asc&limit=10000` });
}

async function readCanonicalEntities(projectId: string) {
  const output: Record<string, JsonRecord[]> = {
    characters: [],
    events: [],
    items: [],
    worldRules: [],
    foreshadowing: [],
    openThreads: [],
  };
  await Promise.all(ENTITY_TYPES.map(async (type) => {
    const adapter = storyBibleEntityAdapters[type];
    const rows = await rest<JsonRecord[]>(adapter.table, {
      query: `project_id=eq.${q(projectId)}&select=*&limit=10000`,
    });
    output[ENTITY_EXPORT_KEYS[type]] = rows.map((row) => sanitizeCanonicalEntity(projectId, type, row));
  }));
  return output;
}

function versionNumber(version: JsonRecord) {
  return Number(version.version_number || 0);
}

function filterIdsFromVersions(versions: JsonRecord[]) {
  const candidateIds = new Set<string>();
  const mutationRequestIds = new Set<string>();
  for (const version of versions) {
    asArray(version.candidate_ids).forEach((id) => candidateIds.add(String(id)));
    asArray(version.approved_candidate_ids).forEach((id) => candidateIds.add(String(id)));
    asArray(version.mutation_request_ids).forEach((id) => mutationRequestIds.add(String(id)));
    for (const change of normalizeVersionChangeSets(version)) {
      if (change.candidateId) candidateIds.add(String(change.candidateId));
      if (change.mutationRequestId) mutationRequestIds.add(String(change.mutationRequestId));
    }
  }
  return { candidateIds: [...candidateIds], mutationRequestIds: [...mutationRequestIds] };
}

function filterByIds(rows: JsonRecord[], key: string, ids: string[]) {
  if (ids.length === 0) return [];
  const set = new Set(ids);
  return rows.filter((row) => set.has(String(row[key] || "")));
}

function projectExportId(projectId: string) {
  return exportSafeId("project", projectId);
}

function sanitizeVersion(row: JsonRecord) {
  return {
    versionId: exportSafeId("version", row.id),
    versionNumber: versionNumber(row),
    parentVersionId: row.parent_version_id ? exportSafeId("version", row.parent_version_id) : null,
    operationType: row.operation_type || null,
    operationSource: row.operation_source || "legacy_unknown",
    summary: safeString(row.summary, 500),
    candidateIds: asArray(row.candidate_ids).map((id) => exportSafeId("candidate", id)),
    mutationRequestIds: asArray(row.mutation_request_ids).map((id) => exportSafeId("request", id)),
    createdByType: sanitizeCreatedBy(row.created_by),
    createdAt: row.created_at || null,
    revertedVersionId: row.reverted_version_id ? exportSafeId("version", row.reverted_version_id) : null,
    revertReason: row.revert_reason ? safeString(row.revert_reason, 600) : null,
    sourceProviderType: sanitizeProviderType(row.source_provider_type),
    sourceProviderLocation: sanitizeProviderLocation(row.source_provider_location),
    sourceModelId: row.source_model_id ? safeString(row.source_model_id, 120) : null,
    sourceExecutionId: row.source_execution_id ? exportSafeId("execution", row.source_execution_id) : null,
    sourceMode: row.source_mode || null,
    dataLeftDevice: row.data_left_device ?? null,
    storageLocation: "supabase-postgres",
    canonicalAuthority: "local",
    integrityHash: row.integrity_hash || null,
    previousIntegrityHash: row.previous_integrity_hash || null,
    integrityAlgorithm: row.integrity_algorithm || STORY_BIBLE_INTEGRITY_ALGORITHM,
    integritySchemaVersion: row.integrity_schema_version || STORY_BIBLE_INTEGRITY_SCHEMA_VERSION,
  };
}

function sanitizeCreatedBy(value: unknown) {
  const raw = String(value || "system").toLowerCase();
  if (raw.includes("admin")) return "admin";
  if (raw.includes("author")) return "author";
  if (raw.includes("import")) return "imported";
  if (raw.includes("system") || raw.includes("matrix") || raw.includes("legacy")) return "system";
  return "anonymized reviewer ID";
}

function sanitizeProviderLocation(value: unknown) {
  const raw = String(value || "unknown");
  if (["cloud", "server", "browser", "local", "reviewer", "unknown"].includes(raw)) return raw;
  return "unknown";
}

function sanitizeChange(version: JsonRecord, change: JsonRecord) {
  return {
    changeId: exportSafeId("change", change.changeId || `${version.id}:${change.entityType}:${change.entityId}:${change.fieldPath}:${change.candidateId}`),
    versionId: exportSafeId("version", version.id),
    versionNumber: versionNumber(version),
    entityType: change.entityType || null,
    entityId: change.entityId ? exportSafeId("entity", change.entityId) : null,
    entityDisplayName: safeString(change.entityDisplayName || change.entityId || "", 200),
    fieldPath: change.fieldPath || null,
    operation: change.operation || "updated",
    previousValue: change.previousValue ?? null,
    newValue: change.newValue ?? null,
    candidateId: change.candidateId ? exportSafeId("candidate", change.candidateId) : null,
    mutationRequestId: change.mutationRequestId ? exportSafeId("request", change.mutationRequestId) : null,
    sourceIds: asArray(change.sourceRefs).map((ref) => exportSafeId("source", JSON.stringify(ref))),
    reviewerType: sanitizeCreatedBy(change.reviewerId || version.created_by),
    reason: safeString(change.reason || version.summary || "", 600),
    humanEdited: Boolean(change.humanEdited),
    sourceMode: change.sourceMode || version.source_mode || null,
    sourceProviderType: sanitizeProviderType(change.sourceProviderType || version.source_provider_type),
    sourceModelId: change.sourceModelId || version.source_model_id || null,
    createdAt: change.createdAt || version.created_at || null,
  };
}

function sanitizeCanonicalEntity(projectId: string, entityType: string, row: JsonRecord) {
  const adapter = storyBibleEntityAdapters[entityType as keyof typeof storyBibleEntityAdapters];
  const idValue = String(row[adapter.idColumn] || row.id || "");
  const rawData = row[adapter.jsonColumn] && typeof row[adapter.jsonColumn] === "object" ? row[adapter.jsonColumn] : {};
  const { value } = redactSecretsDeep(rawData);
  return {
    entityId: exportSafeId("entity", idValue),
    projectExportId: projectExportId(projectId),
    schemaVersion: "story-bible-entity-v1",
    currentData: value,
    displayName: safeString(row[adapter.titleColumn] || idValue, 200),
    createdVersion: row.created_version_number || null,
    lastModifiedVersion: row.last_modified_version_number || null,
    sourceIds: [],
    active: row.active !== false,
    integrityMetadata: {
      rowHash: hashPayload({ entityType, idValue, value }),
    },
  };
}

function sanitizeCandidate(row: JsonRecord) {
  return {
    candidateId: exportSafeId("candidate", row.id),
    entityType: row.entity_type || null,
    entityId: row.entity_id ? exportSafeId("entity", row.entity_id) : null,
    fieldPath: row.field_path || null,
    proposedValue: row.proposed_value ?? null,
    originalProposedValue: row.original_proposed_value ?? null,
    editedValue: row.edited_value ?? null,
    status: row.status || null,
    previousStatus: row.previous_status || null,
    trust: row.candidate_trust || null,
    confidence: row.confidence ?? null,
    sourceValid: row.source_valid ?? null,
    sourceIds: [],
    conflictIds: [],
    extractionRunId: row.extraction_run_id ? exportSafeId("extraction", row.extraction_run_id) : null,
    promptVersion: row.prompt_version || null,
    schemaVersion: row.schema_version || null,
    sourceProviderType: trustToProvider(row.candidate_trust),
    sourceProviderLocation: providerLocationForTrust(row.candidate_trust),
    sourceModelId: row.source_model_id || null,
    sourceExecutionId: row.extraction_run_id ? exportSafeId("execution", row.extraction_run_id) : null,
    createdAt: row.created_at || null,
    reviewedAt: row.reviewed_at || null,
    reviewerType: row.reviewer_id ? sanitizeCreatedBy(row.reviewer_id) : null,
    reviewReason: row.review_reason ? safeString(row.review_reason, 600) : null,
  };
}

function trustToProvider(value: unknown) {
  const trust = String(value || "");
  if (trust.startsWith("cloud")) return "gemini";
  if (trust === "local-rule") return "local_rule";
  return "legacy_unknown";
}

function providerLocationForTrust(value: unknown) {
  const trust = String(value || "");
  if (trust.startsWith("cloud")) return "server";
  if (trust === "local-rule") return "local";
  return "unknown";
}

function sanitizeConflict(row: JsonRecord) {
  return {
    conflictId: exportSafeId("conflict", row.id),
    candidateId: row.candidate_id ? exportSafeId("candidate", row.candidate_id) : null,
    entityType: row.canonical_entity_type || row.entity_type || null,
    entityId: row.canonical_entity_id ? exportSafeId("entity", row.canonical_entity_id) : null,
    fieldPath: row.field_path || null,
    conflictType: row.conflict_type || null,
    severity: row.severity || null,
    canonicalValue: row.canonical_value ?? row.canonical_fact ?? null,
    proposedValue: row.proposed_value ?? row.candidate_fact ?? null,
    explanation: safeString(row.explanation, 1000),
    suggestedResolution: safeString(row.suggested_resolution, 1000),
    autoResolvable: Boolean(row.auto_resolvable),
    confidence: row.confidence ?? null,
    status: row.status || null,
    resolvedAt: row.resolved_at || null,
    resolvedByType: row.resolved_by ? sanitizeCreatedBy(row.resolved_by) : null,
    createdAt: row.created_at || null,
  };
}

function sanitizeSource(row: JsonRecord, includeExcerpt: boolean) {
  const excerpt = includeExcerpt ? safeString(row.excerpt, 500) : undefined;
  return {
    sourceId: exportSafeId("source", row.id || row.source_hash || row.excerpt_hash),
    sourceType: row.source_type || (row.candidate_id ? "candidate-evidence" : "chapter-evidence"),
    chapterId: row.chapter_id ? exportSafeId("chapter", row.chapter_id) : null,
    sceneId: row.scene_id ? exportSafeId("scene", row.scene_id) : null,
    paragraphStart: row.paragraph_index ?? row.paragraph_start ?? null,
    paragraphEnd: row.paragraph_end ?? row.paragraph_index ?? null,
    excerpt,
    sourceHash: row.source_hash || row.excerpt_hash || (excerpt ? sha256(excerpt) : null),
    chapterHash: row.chapter_hash || null,
    providerType: sanitizeProviderType(row.provider_type || row.source_provider_type || "legacy_unknown"),
    importedFromExternal: Boolean(row.imported_from_external),
    createdAt: row.created_at || null,
  };
}

function sanitizeMutationRequest(row: JsonRecord) {
  return {
    requestExportId: exportSafeId("request", row.request_id || row.id),
    operation: row.operation || null,
    candidateId: asArray(row.candidate_ids)[0] ? exportSafeId("candidate", asArray(row.candidate_ids)[0]) : null,
    requestHash: row.request_hash ? sha256(String(row.request_hash)) : null,
    status: row.status || null,
    resultVersionId: row.result_version_id ? exportSafeId("version", row.result_version_id) : null,
    errorCode: row.error_code || null,
    createdAt: row.created_at || null,
    completedAt: row.completed_at || null,
  };
}

function provenanceFromVersions(versions: JsonRecord[]) {
  const seen = new Map<string, JsonRecord>();
  for (const version of versions) {
    const provider = sanitizeProviderType(version.source_provider_type);
    const execution = version.source_execution_id ? exportSafeId("execution", version.source_execution_id) : exportSafeId("execution", `${version.id}:${provider}`);
    const key = `${provider}:${execution}`;
    if (!seen.has(key)) {
      seen.set(key, {
        provenanceId: exportSafeId("provenance", key),
        sourceProviderType: provider,
        sourceProviderLocation: sanitizeProviderLocation(version.source_provider_location),
        sourceModelId: version.source_model_id || null,
        sourceExecutionId: execution,
        inferenceLocation: provider === "local_rule" || provider === "ollama" ? "local" : provider === "author" ? "author" : "cloud",
        storageLocation: "supabase-postgres",
        dataLeftDevice: version.data_left_device ?? null,
        importedFromExternal: provider === "supabase_import",
        sourceMode: version.source_mode || null,
        generatedAt: version.created_at || null,
      });
    }
  }
  return [...seen.values()];
}

function projectMetadata(project: JsonRecord, projectId: string) {
  const core = project.core_json && typeof project.core_json === "object" ? project.core_json as JsonRecord : {};
  const meta = releaseMeta();
  return {
    projectId: projectExportId(projectId),
    projectExportId: projectExportId(projectId),
    title: safeString(core.title || core.bookTitle || "Untitled Story Bible", 200),
    description: safeString(core.description || core.coreConcept || "", 800),
    language: safeString(core.language || "zh-Hant", 40),
    genre: safeString(core.genre || "", 120),
    createdAt: project.created_at || null,
    updatedAt: project.updated_at || null,
    sourceSystem: "zhutian-novel-system",
    sourceSystemVersion: "P0-C2C2C",
    ...meta,
  };
}

function schemaVersions() {
  return {
    packageSchemaVersion: STORY_BIBLE_EXPORT_FORMAT_VERSION,
    storyBibleSchemaVersion: STORY_BIBLE_SCHEMA_VERSION,
    candidateSchemaVersion: "story-bible-candidate-v1",
    conflictSchemaVersion: "story-bible-conflict-v1",
    sourceSchemaVersion: "story-bible-source-v1",
    versionSchemaVersion: "story-bible-version-v1",
    changeSetSchemaVersion: "story-bible-change-set-v1",
    provenanceSchemaVersion: "story-bible-provenance-v1",
    integritySchemaVersion: STORY_BIBLE_INTEGRITY_SCHEMA_VERSION,
    canonicalEntitySchemaVersions: {
      character: "story-bible-character-v1",
      event: "story-bible-event-v1",
      item: "story-bible-item-v1",
      world_rule: "story-bible-world-rule-v1",
      foreshadowing: "story-bible-foreshadowing-v1",
      open_thread: "story-bible-open-thread-v1",
    },
  };
}

function authority() {
  return {
    canonicalAuthority: "local",
    authorityModel: "local-canonical",
    externalProvidersAreAdvisory: true,
    externalProvidersCanWriteCanonicalDirectly: false,
    humanApprovalRequired: true,
    offlineCapableTarget: true,
    allowedProviders: ["browser_ai", "ollama", "local_rule", "local_closed_cloud", "chatgpt", "gemini", "grok", "supabase_import", "author", "system", "legacy_unknown"],
  };
}

function compatibility(options: StoryBibleExportOptions) {
  return {
    canImportToSupabase: "schema_compatible",
    canImportToSQLite: "schema_compatible",
    canImportToIndexedDB: "schema_compatible",
    importerImplemented: false,
    canUseWithBrowserAI: true,
    canUseWithOllama: true,
    canUseOffline: true,
    requiresExternalProvider: false,
    requiresChapterText: Boolean(options.includeChapterText),
    minimumImporterVersion: "not_implemented",
    unsupportedFeatures: ["import", "revert", "batch_approve"],
  };
}

function countEntities(entities: Record<string, JsonRecord[]>) {
  return Object.fromEntries(Object.entries(entities).map(([key, rows]) => [key, rows.length]));
}

async function auditExport(input: {
  projectId: string;
  optionsHash: string;
  fromVersion: number | null;
  toVersion: number | null;
  contentHash?: string;
  packageHash?: string;
  status: string;
  estimatedBytes?: number;
  actualBytes?: number;
  errorCode?: string | null;
  packageId?: string;
  manifest?: JsonRecord;
}) {
  try {
    await rest("story_bible_export_audits", {
      method: "POST",
      body: JSON.stringify([{
        id: `export_audit_${crypto.randomUUID()}`,
        project_id: input.projectId,
        requested_by: "system",
        export_options_hash: input.optionsHash,
        from_version: input.fromVersion,
        to_version: input.toVersion,
        content_hash: input.contentHash || null,
        package_hash: input.packageHash || null,
        status: input.status,
        estimated_bytes: input.estimatedBytes || null,
        actual_bytes: input.actualBytes || null,
        error_code: input.errorCode || null,
        created_at: nowIso(),
        completed_at: input.status === "completed" || input.status === "failed" ? nowIso() : null,
      }]),
    });
    if (input.status === "completed" && input.packageId && input.contentHash && input.packageHash) {
      await rest("story_bible_export_packages", {
        method: "POST",
        body: JSON.stringify([{
          id: input.packageId,
          project_id: input.projectId,
          content_hash: input.contentHash,
          package_hash: input.packageHash,
          from_version: input.fromVersion,
          to_version: input.toVersion,
          format: STORY_BIBLE_EXPORT_FORMAT,
          format_version: STORY_BIBLE_EXPORT_FORMAT_VERSION,
          actual_bytes: input.actualBytes || null,
          manifest_json: input.manifest || {},
          created_at: nowIso(),
        }]),
      });
    }
  } catch {
    // Audit must never leak internal configuration or block an otherwise valid preview.
  }
}

function packageHashes(pkg: Omit<StoryBibleExportPackage, "hashes">) {
  const manifestPayload = pkg.manifest;
  const stableIntegrity = {
    ...pkg.integrity,
    verifiedAt: null,
    elapsedMs: null,
  };
  const versionsHash = hashPayload(pkg.versions);
  const changeSetsHash = hashPayload(pkg.changeSets);
  const canonicalEntitiesHash = hashPayload(pkg.canonicalEntities);
  const provenanceHash = hashPayload(pkg.provenance);
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
  const manifestHash = hashPayload(manifestPayload);
  return {
    manifestHash,
    versionsHash,
    changeSetsHash,
    canonicalEntitiesHash,
    provenanceHash,
    contentHash,
    packageHash: hashPayload({ packageId: pkg.packageId, exportedAt: pkg.exportedAt, contentHash, manifest: manifestPayload }),
  };
}

export async function buildStoryBibleExportPackage(options: StoryBibleExportOptions): Promise<StoryBibleExportPackage> {
  if (options.includeChapterText) {
    await auditExport({
      projectId: options.projectId,
      optionsHash: hashPayload(options),
      fromVersion: options.fromVersionNumber || null,
      toVersion: options.toVersionNumber || null,
      status: "failed",
      errorCode: "EXPORT_FULL_TEXT_NOT_ALLOWED",
    });
    throw new StoryBibleExportError("EXPORT_FULL_TEXT_NOT_ALLOWED", "Full chapter text export is not implemented in P0-C2C2C.", 422, {
      stage: "options",
      retryable: false,
    });
  }
  if (options.fromVersionNumber != null && options.toVersionNumber != null && options.fromVersionNumber > options.toVersionNumber) {
    throw new StoryBibleExportError("EXPORT_RANGE_INVALID", "fromVersionNumber cannot be greater than toVersionNumber.", 400, { stage: "options", retryable: false });
  }
  const started = Date.now();
  const project = await readProject(options.projectId);
  if (!project) throw new StoryBibleExportError("EXPORT_PROJECT_NOT_FOUND", "Project was not found.", 404, { stage: "project", retryable: false });
  const versionsRaw = await readVersions(options);
  if (versionsRaw.length === 0) throw new StoryBibleExportError("EXPORT_VERSION_NOT_FOUND", "No Story Bible versions match the export range.", 404, { stage: "versions", retryable: false });

  const first = versionsRaw[0];
  const last = versionsRaw[versionsRaw.length - 1];
  const integrity = await verifyVersionChain({
    projectId: options.projectId,
    fromVersion: options.fromVersionNumber,
    toVersion: options.toVersionNumber,
    includeDetails: false,
  });
  if (!integrity.valid) {
    await auditExport({
      projectId: options.projectId,
      optionsHash: hashPayload(options),
      fromVersion: options.fromVersionNumber || null,
      toVersion: options.toVersionNumber || null,
      status: "failed",
      errorCode: "EXPORT_INTEGRITY_FAILED",
    });
    throw new StoryBibleExportError("EXPORT_INTEGRITY_FAILED", "Story Bible integrity verification failed. Export is blocked.", 409, {
      stage: "integrity",
      retryable: false,
      firstInvalidVersion: integrity.firstInvalidVersion || null,
    });
  }

  const allVersions = await readAllVersions(options.projectId);
  const ids = filterIdsFromVersions(versionsRaw);
  const [
    allCandidates,
    allConflicts,
    factSources,
    canonicalSources,
    mutationRows,
    canonicalEntities,
  ] = await Promise.all([
    options.includeCandidates ? readRows("story_fact_candidates", options.projectId) : Promise.resolve([]),
    options.includeConflicts ? readRows("story_fact_conflicts", options.projectId) : Promise.resolve([]),
    options.includeSources ? readRows("story_fact_sources", options.projectId) : Promise.resolve([]),
    options.includeSources ? readRows("story_canonical_sources", options.projectId) : Promise.resolve([]),
    options.includeMutationRequests ? rest<JsonRecord[]>("story_bible_mutation_requests", { query: `project_id=eq.${q(options.projectId)}&select=*&order=created_at.asc&limit=10000` }) : Promise.resolve([]),
    options.includeCurrentCanonical ? readCanonicalEntities(options.projectId) : Promise.resolve({ characters: [], events: [], items: [], worldRules: [], foreshadowing: [], openThreads: [] }),
  ]);

  const candidates = filterByIds(allCandidates, "id", ids.candidateIds).map(sanitizeCandidate);
  const conflicts = allConflicts
    .filter((row) => ids.candidateIds.includes(String(row.candidate_id || "")) || ids.candidateIds.length === 0)
    .map(sanitizeConflict);
  const sources = [
    ...factSources.filter((row) => !row.candidate_id || ids.candidateIds.includes(String(row.candidate_id))).map((row) => sanitizeSource(row, options.includeSourceExcerpts)),
    ...canonicalSources.filter((row) => !row.version_id || versionsRaw.some((version) => version.id === row.version_id)).map((row) => sanitizeSource(row, options.includeSourceExcerpts)),
  ];
  const mutationRequests = mutationRows
    .filter((row) => ids.mutationRequestIds.includes(String(row.request_id || "")))
    .map(sanitizeMutationRequest);
  const versions = versionsRaw.map(sanitizeVersion);
  const changeSets = versionsRaw.flatMap((version) => normalizeVersionChangeSets(version).map((change) => sanitizeChange(version, change)));
  const currentRaw = allVersions[allVersions.length - 1] || null;
  const range = {
    firstAvailableVersion: Number(allVersions[0]?.version_number || 0),
    lastAvailableVersion: Number(allVersions[allVersions.length - 1]?.version_number || 0),
    exportedFromVersion: versionNumber(first),
    exportedToVersion: versionNumber(last),
    currentVersionNumber: Number(currentRaw?.version_number || 0),
    versionCount: versions.length,
    chainComplete: Boolean(integrity.valid),
    partialExport: versions.length !== allVersions.length,
    parentBeforeRange: first.parent_version_id ? exportSafeId("version", first.parent_version_id) : null,
    childAfterRange: allVersions.find((row) => row.parent_version_id === last.id)?.id
      ? exportSafeId("version", allVersions.find((row) => row.parent_version_id === last.id)?.id)
      : null,
  };

  const baseManifest = {
    packageId: "pending",
    format: STORY_BIBLE_EXPORT_FORMAT,
    formatVersion: STORY_BIBLE_EXPORT_FORMAT_VERSION,
    projectExportId: projectExportId(options.projectId),
    exportedAt: "pending",
    exportedFromVersion: range.exportedFromVersion,
    exportedToVersion: range.exportedToVersion,
    fullOrPartial: range.partialExport ? "partial" : "full",
    entityCounts: countEntities(canonicalEntities),
    versionCount: versions.length,
    changeSetCount: changeSets.length,
    candidateCount: candidates.length,
    conflictCount: conflicts.length,
    sourceCount: sources.length,
    mutationRequestCount: mutationRequests.length,
    provenanceCount: provenanceFromVersions(versionsRaw).length,
    contentHash: "pending",
    packageHash: "pending",
    generatedByCommit: releaseMeta().sourceCommit,
    generatedByReleaseTag: releaseMeta().sourceReleaseTag,
    generatedByDeploymentId: releaseMeta().sourceDeploymentId,
  };

  const exportedAt = nowIso();
  const packageId = `pkg_${crypto.randomUUID()}`;
  const pkgWithoutHashes: Omit<StoryBibleExportPackage, "hashes"> = {
    format: STORY_BIBLE_EXPORT_FORMAT,
    formatVersion: STORY_BIBLE_EXPORT_FORMAT_VERSION,
    packageId,
    exportedAt,
    exportOptions: { ...options, includeChapterText: false },
    project: projectMetadata(project, options.projectId),
    authority: authority(),
    schemaVersions: schemaVersions(),
    versionRange: range,
    currentVersion: currentRaw ? {
      versionId: exportSafeId("version", currentRaw.id),
      versionNumber: currentRaw.version_number,
      integrityHash: currentRaw.integrity_hash || null,
    } : null,
    manifest: { ...baseManifest, packageId, exportedAt },
    versions,
    changeSets,
    canonicalEntities,
    candidates,
    conflicts,
    sources,
    mutationRequests,
    provenance: provenanceFromVersions(versionsRaw),
    integrity: {
      chainValid: integrity.valid,
      checkedVersions: integrity.checkedVersions,
      integrityRootHash: integrity.rootHash,
      firstIntegrityHash: first.integrity_hash || null,
      lastIntegrityHash: last.integrity_hash || null,
      integrityAlgorithm: STORY_BIBLE_INTEGRITY_ALGORITHM,
      integritySchemaVersion: STORY_BIBLE_INTEGRITY_SCHEMA_VERSION,
      verifiedAt: integrity.checkedAt,
      partialRange: range.partialExport,
      externalPreviousHash: first.previous_integrity_hash || null,
      elapsedMs: integrity.elapsedMs,
    },
    compatibility: compatibility(options),
  };
  const hashes = packageHashes(pkgWithoutHashes);
  const pkg: StoryBibleExportPackage = {
    ...pkgWithoutHashes,
    manifest: {
      ...pkgWithoutHashes.manifest,
      contentHash: hashes.contentHash,
      packageHash: hashes.packageHash,
    },
    hashes,
  };
  const redacted = redactSecretsDeep(pkg);
  const finalPackage = redacted.value as StoryBibleExportPackage;
  const leakedSecrets = assertNoSecrets(finalPackage);
  if (leakedSecrets.length > 0) {
    await auditExport({
      projectId: options.projectId,
      optionsHash: hashPayload(options),
      fromVersion: options.fromVersionNumber || null,
      toVersion: options.toVersionNumber || null,
      status: "failed",
      errorCode: "EXPORT_SECRET_DETECTED",
    });
    throw new StoryBibleExportError("EXPORT_SECRET_DETECTED", "Potential secret detected in export package. Export was blocked.", 500, {
      stage: "sanitize",
      retryable: false,
      secretTypes: leakedSecrets,
    });
  }
  const bytes = Buffer.byteLength(JSON.stringify(finalPackage));
  if (bytes > MAX_EXPORT_BYTES) {
    throw new StoryBibleExportError("EXPORT_TOO_LARGE", "Export package is too large for this endpoint.", 413, {
      stage: "serialize",
      retryable: false,
      actualBytes: bytes,
      limitBytes: MAX_EXPORT_BYTES,
    });
  }
  await auditExport({
    projectId: options.projectId,
    optionsHash: hashPayload(options),
    fromVersion: options.fromVersionNumber || null,
    toVersion: options.toVersionNumber || null,
    contentHash: finalPackage.hashes.contentHash,
    packageHash: finalPackage.hashes.packageHash,
    status: "completed",
    estimatedBytes: bytes,
    actualBytes: bytes,
    packageId: finalPackage.packageId,
    manifest: finalPackage.manifest,
  });
  return {
    ...finalPackage,
    manifest: {
      ...finalPackage.manifest,
      generationElapsedMs: Date.now() - started,
    },
  };
}

export async function previewStoryBibleExport(options: StoryBibleExportOptions) {
  const pkg = await buildStoryBibleExportPackage({ ...options, pretty: false, download: false });
  const bytes = Buffer.byteLength(JSON.stringify(pkg));
  return {
    estimatedBytes: bytes,
    versionCount: pkg.versions.length,
    entityCounts: pkg.manifest.entityCounts,
    candidateCount: pkg.candidates.length,
    conflictCount: pkg.conflicts.length,
    sourceCount: pkg.sources.length,
    mutationRequestCount: pkg.mutationRequests.length,
    containsSourceExcerpts: Boolean(options.includeSourceExcerpts),
    containsFullText: false,
    integrityValid: pkg.integrity.chainValid,
    warnings: [
      "Import is not implemented in P0-C2C2C.",
      ...(options.includeEntityHistory ? ["Entity history option is reserved; canonical snapshot is exported."] : []),
      ...(options.includeFieldHistory ? ["Field history option is reserved; changeSets are exported."] : []),
    ],
    exportAllowed: true,
    contentHash: pkg.hashes.contentHash,
    packageHash: pkg.hashes.packageHash,
  };
}

export function safeExportFilename(projectTitle: unknown, from: unknown, to: unknown) {
  const safe = safeString(projectTitle || "story-bible", 80)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "story-bible";
  return `${safe}-story-bible-history-v${from || "first"}-v${to || "latest"}.nsbh.json`;
}

export async function exportHealthStatus() {
  try {
    const rows = await rest<Array<{ version: string }>>("schema_migrations", {
      query: `select=version&version=eq.${STORY_BIBLE_EXPORT_MIGRATION_VERSION}&limit=1`,
    });
    return rows.some((row) => row.version === STORY_BIBLE_EXPORT_MIGRATION_VERSION) ? "ready" : "partial";
  } catch {
    return "unavailable";
  }
}

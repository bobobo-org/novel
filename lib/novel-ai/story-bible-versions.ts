import crypto from "crypto";
import { z } from "zod";

type JsonRecord = Record<string, unknown>;

const EntityTypeSchema = z.enum(["character", "event", "item", "world_rule", "foreshadowing", "open_thread"]);

export const VersionListQuerySchema = z.object({
  projectId: z.string().min(1).max(120),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  fromVersion: z.coerce.number().int().min(0).optional(),
  toVersion: z.coerce.number().int().min(0).optional(),
  operationType: z.string().max(80).optional(),
  entityType: EntityTypeSchema.optional(),
  entityId: z.string().max(160).optional(),
  createdBy: z.string().max(160).optional(),
  sourceProviderType: z.string().max(80).optional(),
  dateFrom: z.string().max(80).optional(),
  dateTo: z.string().max(80).optional(),
});

export const VersionDetailQuerySchema = z.object({
  projectId: z.string().min(1).max(120),
});

export const EntityHistoryQuerySchema = z.object({
  projectId: z.string().min(1).max(120),
});

export const FieldHistoryQuerySchema = z.object({
  projectId: z.string().min(1).max(120),
  fieldPath: z.string().min(1).max(300),
});

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { url: url.replace(/\/$/, ""), key };
}

async function rest<T>(table: string, init: RequestInit & { query?: string } = {}): Promise<T> {
  const cfg = supabaseConfig();
  if (!cfg.url || !cfg.key) throw new Error("STORY_BIBLE_PERSISTENCE_NOT_CONFIGURED");
  const query = init.query ? `?${init.query}` : "";
  const response = await fetch(`${cfg.url}/rest/v1/${table}${query}`, {
    ...init,
    headers: {
      apikey: cfg.key,
      authorization: `Bearer ${cfg.key}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`STORY_BIBLE_VERSION_HTTP_${response.status}:${text.slice(0, 300)}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function queryValue(value: string) {
  return encodeURIComponent(value);
}

function hashJson(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function changeSetArray(version: JsonRecord): JsonRecord[] {
  const raw = version.change_set;
  if (Array.isArray(raw)) return raw.map(asRecord);
  const record = asRecord(raw);
  return Object.keys(record).length > 0 ? [record] : [];
}

function providerType(version: JsonRecord, change?: JsonRecord) {
  return String(version.source_provider_type || change?.sourceProviderType || (change?.sourceMode === "author-declared" ? "author" : "legacy_unknown"));
}

function sourceMode(version: JsonRecord, change?: JsonRecord) {
  return String(version.source_mode || change?.sourceMode || "");
}

function operationFor(change: JsonRecord) {
  const raw = String(change.operation || "updated");
  if (raw === "create") return "created";
  if (raw === "append") return "appended";
  if (raw === "remove") return "removed";
  if (raw === "human_edited") return "updated";
  return raw;
}

function versionSummary(version: JsonRecord) {
  const changes = changeSetArray(version);
  const changedFields = new Set(changes.map((x) => String(x.fieldPath || "")).filter(Boolean));
  const changedEntities = new Set(changes.map((x) => `${x.entityType || ""}:${x.entityId || ""}`).filter((x) => x !== ":"));
  const first = changes[0] || {};
  return {
    versionId: version.id,
    versionNumber: Number(version.version_number || 0),
    parentVersionId: version.parent_version_id || null,
    operationType: version.operation_type || null,
    summary: version.summary || first.reason || "",
    changedEntityCount: changedEntities.size,
    changedFieldCount: changedFields.size,
    createdBy: version.created_by || "system",
    createdAt: version.created_at || null,
    sourceProviderType: providerType(version, first),
    sourceModelId: version.source_model_id || null,
    revertedVersionId: version.reverted_version_id || null,
  };
}

async function readVersions(projectId: string) {
  return rest<JsonRecord[]>("story_bible_versions", {
    query: `project_id=eq.${queryValue(projectId)}&select=*&order=version_number.asc&limit=1000`,
  });
}

async function readCurrentVersion(projectId: string) {
  const rows = await rest<JsonRecord[]>("story_bible_versions", {
    query: `project_id=eq.${queryValue(projectId)}&select=id,version_number&order=version_number.desc&limit=1`,
  });
  return rows[0] || null;
}

async function readSources(projectId: string, filters = "") {
  const query = [`project_id=eq.${queryValue(projectId)}`, "select=*", "order=created_at.asc"];
  if (filters) query.push(filters);
  return rest<JsonRecord[]>("story_canonical_sources", { query: query.join("&") });
}

async function readCandidates(projectId: string, candidateIds: string[]) {
  if (candidateIds.length === 0) return [];
  const ids = candidateIds.map(queryValue).join(",");
  return rest<JsonRecord[]>("story_fact_candidates", {
    query: `project_id=eq.${queryValue(projectId)}&id=in.(${ids})&select=*`,
  });
}

async function readMutationRequests(requestIds: string[]) {
  if (requestIds.length === 0) return [];
  const ids = requestIds.map(queryValue).join(",");
  return rest<JsonRecord[]>("story_bible_mutation_requests", { query: `request_id=in.(${ids})&select=*` });
}

function filterByChange(version: JsonRecord, query: z.infer<typeof VersionListQuerySchema>) {
  const changes = changeSetArray(version);
  if (!query.entityType && !query.entityId) return true;
  return changes.some((change) => {
    if (query.entityType && change.entityType !== query.entityType) return false;
    if (query.entityId && change.entityId !== query.entityId) return false;
    return true;
  });
}

export async function listStoryBibleVersions(input: unknown) {
  const query = VersionListQuerySchema.parse(input);
  const all = (await readVersions(query.projectId))
    .filter((version) => query.fromVersion == null || Number(version.version_number || 0) >= query.fromVersion!)
    .filter((version) => query.toVersion == null || Number(version.version_number || 0) <= query.toVersion!)
    .filter((version) => !query.operationType || version.operation_type === query.operationType)
    .filter((version) => !query.createdBy || version.created_by === query.createdBy)
    .filter((version) => !query.sourceProviderType || providerType(version) === query.sourceProviderType)
    .filter((version) => !query.dateFrom || String(version.created_at || "") >= query.dateFrom!)
    .filter((version) => !query.dateTo || String(version.created_at || "") <= query.dateTo!)
    .filter((version) => filterByChange(version, query))
    .sort((a, b) => Number(b.version_number || 0) - Number(a.version_number || 0));
  const totalVersions = all.length;
  const start = (query.page - 1) * query.pageSize;
  const versions = all.slice(start, start + query.pageSize).map(versionSummary);
  const current = await readCurrentVersion(query.projectId);
  return {
    versions,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total: totalVersions,
      totalPages: Math.max(1, Math.ceil(totalVersions / query.pageSize)),
    },
    currentVersion: current ? { versionId: current.id, versionNumber: current.version_number } : null,
    totalVersions,
  };
}

function makeFieldDiff(version: JsonRecord, change: JsonRecord, sources: JsonRecord[]) {
  return {
    entityType: change.entityType || null,
    entityId: change.entityId || null,
    entityDisplayName: change.entityDisplayName || change.entityId || null,
    fieldPath: change.fieldPath || null,
    operation: operationFor(change),
    previousValue: change.previousValue ?? null,
    newValue: change.newValue ?? null,
    fromValue: change.previousValue ?? null,
    toValue: change.newValue ?? null,
    introducedAtVersion: version.version_number,
    changedAtVersion: version.version_number,
    sourceRefs: sources,
    sourceProviderType: providerType(version, change),
    sourceModelId: version.source_model_id || null,
    candidateId: change.candidateId || null,
    reviewerId: change.reviewerId || version.created_by || null,
    reason: change.reason || version.summary || "",
    createdAt: version.created_at || null,
  };
}

export async function getStoryBibleVersionDetail(projectId: string, versionId: string) {
  const rows = await rest<JsonRecord[]>("story_bible_versions", {
    query: `project_id=eq.${queryValue(projectId)}&id=eq.${queryValue(versionId)}&select=*&limit=1`,
  });
  const version = rows[0];
  if (!version) return null;
  const changes = changeSetArray(version);
  const candidateIds = [...new Set([...asArray<string>(version.candidate_ids), ...changes.map((x) => String(x.candidateId || "")).filter(Boolean)])];
  const requestIds = [...new Set([...asArray<string>(version.mutation_request_ids), String(version.request_id || "")].filter(Boolean))];
  const [sources, candidates, mutationRequests, parentRows, childRows] = await Promise.all([
    readSources(projectId, `version_id=eq.${queryValue(versionId)}`),
    readCandidates(projectId, candidateIds),
    readMutationRequests(requestIds),
    version.parent_version_id ? rest<JsonRecord[]>("story_bible_versions", { query: `project_id=eq.${queryValue(projectId)}&id=eq.${queryValue(String(version.parent_version_id))}&select=id,version_number,operation_type,created_at&limit=1` }) : Promise.resolve([]),
    rest<JsonRecord[]>("story_bible_versions", { query: `project_id=eq.${queryValue(projectId)}&parent_version_id=eq.${queryValue(versionId)}&select=id,version_number,operation_type,created_at&order=version_number.asc` }),
  ]);
  return {
    metadata: versionSummary(version),
    version,
    changeSets: changes,
    fieldDiffs: changes.map((change) => makeFieldDiff(version, change, sources.filter((source) => source.field_path === change.fieldPath && source.candidate_id === change.candidateId))),
    candidateReferences: candidates,
    mutationRequestReferences: mutationRequests,
    sourceRelations: sources,
    parentVersion: parentRows[0] || null,
    childVersions: childRows,
    revertInfo: {
      revertedVersionId: version.reverted_version_id || null,
      revertReason: version.revert_reason || null,
      isRevert: version.operation_type === "revert",
    },
    providerProvenance: {
      operationSource: version.operation_source || null,
      sourceProviderType: providerType(version, changes[0]),
      sourceProviderLocation: version.source_provider_location || null,
      sourceModelId: version.source_model_id || null,
      sourceExecutionId: version.source_execution_id || null,
      sourceMode: sourceMode(version, changes[0]),
      dataLeftDevice: version.data_left_device ?? null,
      storageLocation: version.storage_location || "supabase-postgres",
    },
    integrity: {
      integrityHash: version.integrity_hash || hashJson({ projectId, versionNumber: version.version_number, parentVersionId: version.parent_version_id, operationType: version.operation_type, changeSet: version.change_set }),
      computedHash: hashJson({ projectId, versionNumber: version.version_number, parentVersionId: version.parent_version_id, operationType: version.operation_type, changeSet: version.change_set }),
    },
  };
}

export async function getStoryBibleEntityHistory(projectId: string, entityType: string, entityId: string) {
  const parsed = EntityTypeSchema.parse(entityType);
  const versions = await readVersions(projectId);
  const matching = versions
    .flatMap((version) => changeSetArray(version).filter((change) => change.entityType === parsed && change.entityId === entityId).map((change) => ({ version, change })))
    .sort((a, b) => Number(a.version.version_number || 0) - Number(b.version.version_number || 0));
  const sources = await readSources(projectId, `canonical_entity_type=eq.${queryValue(parsed)}&canonical_entity_id=eq.${queryValue(entityId)}`);
  return {
    entityType: parsed,
    entityId,
    createdVersion: matching[0] ? versionSummary(matching[0].version) : null,
    fieldChanges: matching.map(({ version, change }) => makeFieldDiff(version, change, sources.filter((source) => source.field_path === change.fieldPath))),
    sourceChanges: sources,
    statusTransitions: matching.filter(({ change }) => String(change.fieldPath || "").endsWith(".status")).map(({ version, change }) => makeFieldDiff(version, change, sources)),
    ownershipChanges: matching.filter(({ change }) => String(change.fieldPath || "").includes("Owner")).map(({ version, change }) => makeFieldDiff(version, change, sources)),
    locationChanges: matching.filter(({ change }) => String(change.fieldPath || "").includes("Location")).map(({ version, change }) => makeFieldDiff(version, change, sources)),
    relatedCandidates: [...new Set(matching.map(({ change }) => String(change.candidateId || "")).filter(Boolean))],
    revertEvents: matching.filter(({ version }) => version.operation_type === "revert").map(({ version }) => versionSummary(version)),
  };
}

export async function getStoryBibleFieldHistory(projectId: string, entityType: string, entityId: string, fieldPath: string) {
  const parsed = EntityTypeSchema.parse(entityType);
  const history = await getStoryBibleEntityHistory(projectId, parsed, entityId);
  return {
    entityType: parsed,
    entityId,
    fieldPath,
    fieldChanges: history.fieldChanges.filter((change) => change.fieldPath === fieldPath).map((change) => ({
      versionNumber: change.changedAtVersion,
      previousValue: change.previousValue,
      newValue: change.newValue,
      operation: change.operation,
      candidateId: change.candidateId,
      sourceProviderType: change.sourceProviderType,
      sourceModelId: change.sourceModelId,
      reviewerId: change.reviewerId,
      reason: change.reason,
      createdAt: change.createdAt,
    })),
  };
}

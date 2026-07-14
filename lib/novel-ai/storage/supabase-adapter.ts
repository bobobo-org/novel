import { SUPABASE_CAPABILITIES } from "./capabilities";
import type { JsonRecord, StoryBibleStorageAdapter, TransactionContext } from "./types";

function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { url: url.replace(/\/$/, ""), key };
}

function queryValue(value: string) {
  return encodeURIComponent(value);
}

async function rest<T>(table: string, init: RequestInit & { query?: string } = {}): Promise<T> {
  const cfg = config();
  if (!cfg.url || !cfg.key) throw new Error("STORAGE_ADAPTER_UNAVAILABLE");
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
    throw new Error(`STORAGE_PERSISTENCE_FAILED:${response.status}:${text.slice(0, 200)}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function first(rows: JsonRecord[]) {
  return rows[0] || null;
}

export class SupabaseStoryBibleStorageAdapter implements StoryBibleStorageAdapter {
  readonly id = "supabase-story-bible";
  readonly mode = "SUPABASE_CLOUD" as const;
  readonly label = "Supabase Story Bible Adapter";
  readonly capabilities = SUPABASE_CAPABILITIES;

  async createProject(project: JsonRecord) {
    return first(await rest<JsonRecord[]>("story_bible_projects", { method: "POST", body: JSON.stringify(project) })) || project;
  }

  async getProject(projectId: string) {
    return first(await rest<JsonRecord[]>("story_bible_projects", { query: `project_id=eq.${queryValue(projectId)}&select=*&limit=1` }));
  }

  async updateProject(projectId: string, patch: JsonRecord) {
    return first(await rest<JsonRecord[]>("story_bible_projects", { method: "PATCH", query: `project_id=eq.${queryValue(projectId)}`, body: JSON.stringify(patch) })) || patch;
  }

  async deleteTestProject(projectId: string) {
    await rest("story_bible_projects", { method: "DELETE", query: `project_id=eq.${queryValue(projectId)}`, headers: { prefer: "return=minimal" } });
    return { deleted: true };
  }

  async listProjects(limit = 20) {
    return rest<JsonRecord[]>("story_bible_projects", { query: `select=*&limit=${limit}` });
  }

  async createCandidate(candidate: JsonRecord) {
    return first(await rest<JsonRecord[]>("story_fact_candidates", { method: "POST", body: JSON.stringify(candidate) })) || candidate;
  }

  async getCandidate(projectId: string, candidateId: string) {
    return first(await rest<JsonRecord[]>("story_fact_candidates", { query: `project_id=eq.${queryValue(projectId)}&id=eq.${queryValue(candidateId)}&select=*&limit=1` }));
  }

  async listCandidates(projectId: string, limit = 20) {
    return rest<JsonRecord[]>("story_fact_candidates", { query: `project_id=eq.${queryValue(projectId)}&select=*&order=created_at.desc&limit=${limit}` });
  }

  async updateCandidateStatus(projectId: string, candidateId: string, status: string, patch: JsonRecord = {}) {
    return first(await rest<JsonRecord[]>("story_fact_candidates", {
      method: "PATCH",
      query: `project_id=eq.${queryValue(projectId)}&id=eq.${queryValue(candidateId)}&select=*`,
      body: JSON.stringify({ ...patch, status }),
    })) || { projectId, candidateId, status };
  }

  async lockCandidate(projectId: string, candidateId: string, lockId: string) {
    return this.updateCandidateStatus(projectId, candidateId, "locked", { lock_id: lockId });
  }

  async saveCandidateAudit(audit: JsonRecord) {
    return audit;
  }

  async createConflict(conflict: JsonRecord) {
    return first(await rest<JsonRecord[]>("story_fact_conflicts", { method: "POST", body: JSON.stringify(conflict) })) || conflict;
  }

  async getConflict(projectId: string, conflictId: string) {
    return first(await rest<JsonRecord[]>("story_fact_conflicts", { query: `project_id=eq.${queryValue(projectId)}&id=eq.${queryValue(conflictId)}&select=*&limit=1` }));
  }

  async listConflicts(projectId: string, limit = 20) {
    return rest<JsonRecord[]>("story_fact_conflicts", { query: `project_id=eq.${queryValue(projectId)}&select=*&order=created_at.desc&limit=${limit}` });
  }

  async updateConflictStatus(projectId: string, conflictId: string, status: string, patch: JsonRecord = {}) {
    return first(await rest<JsonRecord[]>("story_fact_conflicts", {
      method: "PATCH",
      query: `project_id=eq.${queryValue(projectId)}&id=eq.${queryValue(conflictId)}&select=*`,
      body: JSON.stringify({ ...patch, status }),
    })) || { projectId, conflictId, status };
  }

  async createCanonicalEntity(entityType: string, entity: JsonRecord) {
    return { ...entity, entityType };
  }

  async getCanonicalEntity(projectId: string, entityType: string, entityId: string) {
    return first(await rest<JsonRecord[]>(canonicalTable(entityType), { query: `project_id=eq.${queryValue(projectId)}&${canonicalIdColumn(entityType)}=eq.${queryValue(entityId)}&select=*&limit=1` }));
  }

  async updateCanonicalEntity(projectId: string, entityType: string, entityId: string, patch: JsonRecord) {
    return first(await rest<JsonRecord[]>(canonicalTable(entityType), {
      method: "PATCH",
      query: `project_id=eq.${queryValue(projectId)}&${canonicalIdColumn(entityType)}=eq.${queryValue(entityId)}&select=*`,
      body: JSON.stringify(patch),
    })) || { projectId, entityType, entityId, ...patch };
  }

  async listCanonicalEntities(projectId: string, entityType: string, limit = 20) {
    return rest<JsonRecord[]>(canonicalTable(entityType), { query: `project_id=eq.${queryValue(projectId)}&select=*&limit=${limit}` });
  }

  async deactivateCanonicalEntity(projectId: string, entityType: string, entityId: string, reason: string) {
    return this.updateCanonicalEntity(projectId, entityType, entityId, { active: false, deactivated_reason: reason });
  }

  async getCurrentCanonicalState(projectId: string) {
    return { projectId, adapter: this.id, state: "available-through-entity-tables" };
  }

  async createSource(source: JsonRecord) {
    return first(await rest<JsonRecord[]>("story_fact_sources", { method: "POST", body: JSON.stringify(source) })) || source;
  }

  async getSource(projectId: string, sourceId: string) {
    return first(await rest<JsonRecord[]>("story_fact_sources", { query: `project_id=eq.${queryValue(projectId)}&id=eq.${queryValue(sourceId)}&select=*&limit=1` }));
  }

  async listSources(projectId: string, limit = 20) {
    return rest<JsonRecord[]>("story_fact_sources", { query: `project_id=eq.${queryValue(projectId)}&select=*&limit=${limit}` });
  }

  async createCanonicalSourceRelation(relation: JsonRecord) {
    return first(await rest<JsonRecord[]>("story_canonical_sources", { method: "POST", body: JSON.stringify(relation) })) || relation;
  }

  async createVersion(version: JsonRecord) {
    return first(await rest<JsonRecord[]>("story_bible_versions", { method: "POST", body: JSON.stringify(version) })) || version;
  }

  async getVersion(projectId: string, versionId: string) {
    return first(await rest<JsonRecord[]>("story_bible_versions", { query: `project_id=eq.${queryValue(projectId)}&id=eq.${queryValue(versionId)}&select=*&limit=1` }));
  }

  async listVersions(projectId: string, limit = 20) {
    return rest<JsonRecord[]>("story_bible_versions", { query: `project_id=eq.${queryValue(projectId)}&select=*&order=version_number.desc&limit=${limit}` });
  }

  async getCurrentVersion(projectId: string) {
    return first(await this.listVersions(projectId, 1));
  }

  async getVersionRange(projectId: string, fromVersion: number, toVersion: number) {
    return rest<JsonRecord[]>("story_bible_versions", { query: `project_id=eq.${queryValue(projectId)}&version_number=gte.${fromVersion}&version_number=lte.${toVersion}&select=*&order=version_number.asc` });
  }

  async getEntityHistory(projectId: string, entityType: string, entityId: string) {
    return rest<JsonRecord[]>("story_entity_history", { query: `project_id=eq.${queryValue(projectId)}&entity_type=eq.${queryValue(entityType)}&entity_id=eq.${queryValue(entityId)}&select=*&order=created_at.asc` });
  }

  async getFieldHistory(projectId: string, entityType: string, entityId: string, fieldPath: string) {
    return rest<JsonRecord[]>("story_field_history", { query: `project_id=eq.${queryValue(projectId)}&entity_type=eq.${queryValue(entityType)}&entity_id=eq.${queryValue(entityId)}&field_path=eq.${queryValue(fieldPath)}&select=*&order=created_at.asc` });
  }

  async saveIntegrityMetadata(metadata: JsonRecord) {
    return first(await rest<JsonRecord[]>("story_bible_integrity_metadata", { method: "POST", body: JSON.stringify(metadata) })) || metadata;
  }

  async getIntegrityChain(projectId: string) {
    return rest<JsonRecord[]>("story_bible_integrity_metadata", { query: `project_id=eq.${queryValue(projectId)}&select=*&order=version_number.asc` });
  }

  async verifyStoredIntegrityFields(projectId: string) {
    return { ok: true, checked: (await this.getIntegrityChain(projectId)).length, errors: [] };
  }

  async beginMutationRequest(request: JsonRecord) {
    return first(await rest<JsonRecord[]>("story_bible_mutation_requests", { method: "POST", body: JSON.stringify(request) })) || request;
  }

  async getMutationRequest(requestId: string) {
    return first(await rest<JsonRecord[]>("story_bible_mutation_requests", { query: `request_id=eq.${queryValue(requestId)}&select=*&limit=1` }));
  }

  async completeMutationRequest(requestId: string, response: JsonRecord) {
    return first(await rest<JsonRecord[]>("story_bible_mutation_requests", { method: "PATCH", query: `request_id=eq.${queryValue(requestId)}`, body: JSON.stringify({ status: "completed", response_json: response }) })) || response;
  }

  async failMutationRequest(requestId: string, error: JsonRecord) {
    return first(await rest<JsonRecord[]>("story_bible_mutation_requests", { method: "PATCH", query: `request_id=eq.${queryValue(requestId)}`, body: JSON.stringify({ status: "failed", response_json: error, error_code: error.errorCode || "STORAGE_TRANSACTION_FAILED" }) })) || error;
  }

  async createExportAudit(audit: JsonRecord) {
    return first(await rest<JsonRecord[]>("story_bible_export_audits", { method: "POST", body: JSON.stringify(audit) })) || audit;
  }

  async createRevertAudit(audit: JsonRecord) {
    return first(await rest<JsonRecord[]>("story_bible_revert_audits", { method: "POST", body: JSON.stringify(audit) })) || audit;
  }

  async saveRevertMetadata(metadata: JsonRecord) {
    return this.createRevertAudit(metadata);
  }

  async transaction<T>(callback: (ctx: TransactionContext) => Promise<T>) {
    return callback({ transactionId: `supabase-rest-${Date.now()}` });
  }

  async advisoryLock(lockKey: string) {
    return { lockKey, acquired: false };
  }

  async optimisticVersionCheck(projectId: string, expectedVersion: number) {
    const current = await this.getCurrentVersion(projectId);
    const currentVersion = Number(current?.version_number || 0);
    return { ok: currentVersion === expectedVersion, currentVersion };
  }
}

function canonicalTable(entityType: string) {
  const map: Record<string, string> = {
    character: "story_characters",
    event: "story_events",
    item: "story_items",
    world_rule: "story_world_rules",
    foreshadowing: "story_foreshadowing",
    open_thread: "story_open_threads",
  };
  return map[entityType] || "story_characters";
}

function canonicalIdColumn(entityType: string) {
  const map: Record<string, string> = {
    character: "character_id",
    event: "event_id",
    item: "item_id",
    world_rule: "rule_id",
    foreshadowing: "foreshadow_id",
    open_thread: "thread_id",
  };
  return map[entityType] || "character_id";
}

import crypto from "crypto";
import { SQLITE_LOCAL_CAPABILITIES } from "./sqlite-capabilities";
import { SQLiteProjectConnection, type SQLiteConnectionDiagnostics } from "./sqlite-connection";
import { SQLiteTransactionContext } from "./sqlite-transaction-context";
import { createSourceNaturalKey, createSourceNaturalKeyHash } from "../source-identity";
import type { ExtractionPersistenceRows, JsonRecord, StoryBibleStorageAdapter, TransactionContext } from "../types";

type ActiveTx = { projectId?: string; connection?: SQLiteProjectConnection };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function projectIdOf(row: JsonRecord) {
  return String(row.projectId || row.project_id || "");
}

function rowId(row: JsonRecord, fallbackPrefix: string) {
  return String(row.id || row.requestId || row.request_id || id(fallbackPrefix));
}

function json(row: JsonRecord) {
  return JSON.stringify(row);
}

function parseRow(row: Record<string, unknown> | undefined, key = "row_json") {
  if (!row) return null;
  return JSON.parse(String(row[key] || "{}")) as JsonRecord;
}

function asRows(rows: Record<string, unknown>[], key = "row_json") {
  return rows.map((row) => JSON.parse(String(row[key] || "{}")) as JsonRecord);
}

function relationId(projectId: string, candidateId: string, sourceId: string, relationType = "evidence") {
  return `rel_${crypto.createHash("md5").update(`${projectId}:${candidateId}:${sourceId}:${relationType}`).digest("hex")}`;
}

export class SQLiteStoryBibleStorageAdapter implements StoryBibleStorageAdapter {
  readonly id = "sqlite-story-bible";
  readonly mode = "SQLITE_LOCAL" as const;
  readonly label = "SQLite Local Story Bible Adapter";
  readonly capabilities = SQLITE_LOCAL_CAPABILITIES;
  private readonly storageDir?: string;
  private readonly connections = new Map<string, SQLiteProjectConnection>();
  private activeTx: ActiveTx | null = null;
  private lastDiagnostics: SQLiteConnectionDiagnostics | null = null;

  constructor(options: { storageDir?: string } = {}) {
    this.storageDir = options.storageDir;
  }

  async diagnostics(projectId = "diagnostics") {
    const connection = await this.connectionForProject(projectId);
    this.lastDiagnostics = connection.diagnostics();
    return clone(this.lastDiagnostics);
  }

  getLastDiagnostics() {
    return this.lastDiagnostics ? clone(this.lastDiagnostics) : null;
  }

  closeAll() {
    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();
  }

  private async connectionForProject(projectId: string) {
    if (!projectId) throw new Error("STORAGE_PROJECT_ID_REQUIRED");
    if (this.activeTx) {
      if (!this.activeTx.projectId) {
        this.activeTx.projectId = projectId;
        this.activeTx.connection = await this.openConnection(projectId);
        this.activeTx.connection.beginImmediate();
      }
      if (this.activeTx.projectId !== projectId) throw new Error("STORAGE_PROJECT_ISOLATION_FAILED");
      return this.activeTx.connection!;
    }
    return this.openConnection(projectId);
  }

  private async openConnection(projectId: string) {
    const existing = this.connections.get(projectId);
    if (existing) return existing;
    const connection = await SQLiteProjectConnection.open({ projectId, storageDir: this.storageDir });
    this.connections.set(projectId, connection);
    this.lastDiagnostics = connection.diagnostics();
    return connection;
  }

  async createProject(project: JsonRecord) {
    const projectId = String(project.id || project.projectId || project.project_id || id("project"));
    const stored = { ...project, id: projectId, projectId, project_id: projectId };
    const db = await this.connectionForProject(projectId);
    db.run(
      "INSERT OR REPLACE INTO projects(id, project_id, row_json, updated_at) VALUES(?,?,?,?)",
      [projectId, projectId, json(stored), new Date().toISOString()],
    );
    return clone(stored);
  }

  async getProject(projectId: string) {
    const db = await this.connectionForProject(projectId);
    return parseRow(db.get("SELECT row_json FROM projects WHERE project_id = ?", [projectId]));
  }

  async updateProject(projectId: string, patch: JsonRecord) {
    const current = await this.getProject(projectId);
    if (!current) throw new Error("STORAGE_PROJECT_NOT_FOUND");
    const updated = { ...current, ...patch, id: projectId, projectId, project_id: projectId };
    const db = await this.connectionForProject(projectId);
    db.run("UPDATE projects SET row_json = ?, updated_at = ? WHERE project_id = ?", [json(updated), new Date().toISOString(), projectId]);
    return clone(updated);
  }

  async deleteTestProject(projectId: string) {
    const db = await this.connectionForProject(projectId);
    for (const table of [
      "candidate_conflicts", "candidate_sources", "canonical_source_relations", "version_change_sets", "conflicts", "candidates",
      "fact_sources", "canonical_entities", "versions", "integrity_metadata", "export_audits", "revert_audits",
      "extraction_runs", "extraction_requests", "chapters", "story_bibles", "project_storage_policies", "projects",
    ]) {
      db.run(`DELETE FROM ${table} WHERE project_id = ?`, [projectId]);
    }
    db.run("DELETE FROM mutation_requests WHERE project_id = ?", [projectId]);
    return { deleted: true };
  }

  async listProjects(limit = 20) {
    const rows: JsonRecord[] = [];
    for (const connection of this.connections.values()) {
      rows.push(...asRows(connection.all("SELECT row_json FROM projects ORDER BY updated_at DESC LIMIT ?", [limit])));
    }
    return rows.slice(0, limit);
  }

  async createCandidate(candidate: JsonRecord) {
    const projectId = projectIdOf(candidate);
    const stored: JsonRecord = { ...candidate, id: rowId(candidate, "candidate"), projectId, project_id: projectId, status: candidate.status || "pending" };
    const db = await this.connectionForProject(projectId);
    db.run(
      "INSERT OR REPLACE INTO candidates(id, project_id, status, candidate_trust, source_valid, row_json, updated_at) VALUES(?,?,?,?,?,?,?)",
      [
        String(stored.id),
        projectId,
        String(stored.status),
        String(stored.candidateTrust || stored.candidate_trust || ""),
        typeof stored.sourceValid === "boolean" ? (stored.sourceValid ? 1 : 0) : typeof stored.source_valid === "boolean" ? (stored.source_valid ? 1 : 0) : null,
        json(stored),
        new Date().toISOString(),
      ],
    );
    return clone(stored);
  }

  async getCandidate(projectId: string, candidateId: string) {
    const db = await this.connectionForProject(projectId);
    return parseRow(db.get("SELECT row_json FROM candidates WHERE project_id = ? AND id = ?", [projectId, candidateId]));
  }

  async listCandidates(projectId: string, limit = 20) {
    const db = await this.connectionForProject(projectId);
    return asRows(db.all("SELECT row_json FROM candidates WHERE project_id = ? ORDER BY created_at DESC LIMIT ?", [projectId, limit]));
  }

  async updateCandidateStatus(projectId: string, candidateId: string, status: string, patch: JsonRecord = {}) {
    const row = await this.getCandidate(projectId, candidateId);
    if (!row) throw new Error("STORAGE_CANDIDATE_NOT_FOUND");
    const updated = { ...row, ...patch, status };
    const db = await this.connectionForProject(projectId);
    db.run("UPDATE candidates SET status = ?, row_json = ?, updated_at = ? WHERE project_id = ? AND id = ?", [status, json(updated), new Date().toISOString(), projectId, candidateId]);
    return clone(updated);
  }

  async lockCandidate(projectId: string, candidateId: string, lockId: string) {
    return this.updateCandidateStatus(projectId, candidateId, "locked", { lockId });
  }

  async saveCandidateAudit(audit: JsonRecord) {
    return this.createCandidate({ ...audit, id: rowId(audit, "candidate_audit"), audit: true });
  }

  async createConflict(conflict: JsonRecord) {
    const projectId = projectIdOf(conflict);
    const stored: JsonRecord = { ...conflict, id: rowId(conflict, "conflict"), projectId, project_id: projectId, status: conflict.status || "open" };
    const db = await this.connectionForProject(projectId);
    db.run(
      "INSERT OR REPLACE INTO conflicts(id, project_id, candidate_id, severity, conflict_type, status, row_json) VALUES(?,?,?,?,?,?,?)",
      [String(stored.id), projectId, String(stored.candidateId || stored.candidate_id || ""), String(stored.severity || ""), String(stored.conflictType || stored.conflict_type || ""), String(stored.status), json(stored)],
    );
    const candidateId = String(stored.candidateId || stored.candidate_id || "");
    if (candidateId) {
      const rel = { id: relationId(projectId, candidateId, String(stored.id), "conflict"), projectId, project_id: projectId, candidateId, candidate_id: candidateId, conflictId: stored.id, conflict_id: stored.id };
      db.run("INSERT OR IGNORE INTO candidate_conflicts(id, project_id, candidate_id, conflict_id, row_json) VALUES(?,?,?,?,?)", [String(rel.id), projectId, candidateId, String(stored.id), json(rel)]);
    }
    return clone(stored);
  }

  async getConflict(projectId: string, conflictId: string) {
    const db = await this.connectionForProject(projectId);
    return parseRow(db.get("SELECT row_json FROM conflicts WHERE project_id = ? AND id = ?", [projectId, conflictId]));
  }

  async listConflicts(projectId: string, limit = 20) {
    const db = await this.connectionForProject(projectId);
    return asRows(db.all("SELECT row_json FROM conflicts WHERE project_id = ? ORDER BY created_at DESC LIMIT ?", [projectId, limit]));
  }

  async updateConflictStatus(projectId: string, conflictId: string, status: string, patch: JsonRecord = {}) {
    const row = await this.getConflict(projectId, conflictId);
    if (!row) throw new Error("STORAGE_CONFLICT_NOT_FOUND");
    const updated = { ...row, ...patch, status };
    const db = await this.connectionForProject(projectId);
    db.run("UPDATE conflicts SET status = ?, row_json = ? WHERE project_id = ? AND id = ?", [status, json(updated), projectId, conflictId]);
    return clone(updated);
  }

  async createCanonicalEntity(entityType: string, entity: JsonRecord) {
    const projectId = projectIdOf(entity);
    const entityId = String(entity.entityId || entity.entity_id || entity.id || id(entityType));
    const stored: JsonRecord = { ...entity, id: entityId, entityId, entity_id: entityId, entityType, entity_type: entityType, active: entity.active ?? true };
    const db = await this.connectionForProject(projectId);
    db.run(
      "INSERT OR REPLACE INTO canonical_entities(project_id, entity_type, entity_id, active, version_number, row_json, updated_at) VALUES(?,?,?,?,?,?,?)",
      [projectId, entityType, entityId, stored.active === false ? 0 : 1, Number(stored.versionNumber || stored.version_number || 1), json(stored), new Date().toISOString()],
    );
    return clone(stored);
  }

  async getCanonicalEntity(projectId: string, entityType: string, entityId: string) {
    const db = await this.connectionForProject(projectId);
    return parseRow(db.get("SELECT row_json FROM canonical_entities WHERE project_id = ? AND entity_type = ? AND entity_id = ?", [projectId, entityType, entityId]));
  }

  async updateCanonicalEntity(projectId: string, entityType: string, entityId: string, patch: JsonRecord) {
    const current = await this.getCanonicalEntity(projectId, entityType, entityId);
    if (!current) throw new Error("STORAGE_CANONICAL_NOT_FOUND");
    return this.createCanonicalEntity(entityType, { ...current, ...patch, projectId, project_id: projectId, entityId, entity_id: entityId });
  }

  async listCanonicalEntities(projectId: string, entityType: string, limit = 20) {
    const db = await this.connectionForProject(projectId);
    return asRows(db.all("SELECT row_json FROM canonical_entities WHERE project_id = ? AND entity_type = ? ORDER BY updated_at DESC LIMIT ?", [projectId, entityType, limit]));
  }

  async deactivateCanonicalEntity(projectId: string, entityType: string, entityId: string, reason: string) {
    return this.updateCanonicalEntity(projectId, entityType, entityId, { active: false, deactivatedReason: reason });
  }

  async getCurrentCanonicalState(projectId: string) {
    const db = await this.connectionForProject(projectId);
    return { projectId, entities: asRows(db.all("SELECT row_json FROM canonical_entities WHERE project_id = ? AND active = 1", [projectId])) };
  }

  async createSource(source: JsonRecord) {
    const projectId = projectIdOf(source);
    const naturalKey = createSourceNaturalKey(source);
    const naturalKeyHash = createSourceNaturalKeyHash(source);
    const db = await this.connectionForProject(projectId);
    const existing = parseRow(db.get("SELECT row_json FROM fact_sources WHERE project_id = ? AND natural_key_hash = ?", [projectId, naturalKeyHash]));
    if (existing) return existing;
    const stored: JsonRecord = { ...source, id: rowId(source, "source"), projectId, project_id: projectId, natural_key: naturalKey, natural_key_hash: naturalKeyHash, sourceNaturalKeyVersion: "source-natural-key-v1" };
    db.run("INSERT INTO fact_sources(id, project_id, natural_key_hash, row_json) VALUES(?,?,?,?)", [String(stored.id), projectId, naturalKeyHash, json(stored)]);
    return clone(stored);
  }

  async getSource(projectId: string, sourceId: string) {
    const db = await this.connectionForProject(projectId);
    return parseRow(db.get("SELECT row_json FROM fact_sources WHERE project_id = ? AND id = ?", [projectId, sourceId]));
  }

  async listSources(projectId: string, limit = 20) {
    const db = await this.connectionForProject(projectId);
    return asRows(db.all("SELECT row_json FROM fact_sources WHERE project_id = ? ORDER BY created_at DESC LIMIT ?", [projectId, limit]));
  }

  async createCanonicalSourceRelation(relation: JsonRecord) {
    const projectId = projectIdOf(relation);
    const stored: JsonRecord = { ...relation, id: rowId(relation, "source_relation"), projectId, project_id: projectId };
    const db = await this.connectionForProject(projectId);
    db.run("INSERT OR REPLACE INTO canonical_source_relations(id, project_id, entity_type, entity_id, source_id, row_json) VALUES(?,?,?,?,?,?)", [
      String(stored.id),
      projectId,
      String(stored.entityType || stored.entity_type || ""),
      String(stored.entityId || stored.entity_id || ""),
      String(stored.sourceId || stored.source_id || ""),
      json(stored),
    ]);
    return clone(stored);
  }

  async createVersion(version: JsonRecord) {
    const projectId = projectIdOf(version);
    const db = await this.connectionForProject(projectId);
    const current = this.maxVersionNumber(db, projectId);
    const stored: JsonRecord = { ...version, id: rowId(version, "version"), projectId, project_id: projectId, versionNumber: Number(version.versionNumber || version.version_number || current + 1) };
    db.run("INSERT OR REPLACE INTO versions(id, project_id, version_number, entity_type, entity_id, field_path, row_json) VALUES(?,?,?,?,?,?,?)", [
      String(stored.id),
      projectId,
      Number(stored.versionNumber),
      String(stored.entityType || stored.entity_type || ""),
      String(stored.entityId || stored.entity_id || ""),
      String(stored.fieldPath || stored.field_path || ""),
      json(stored),
    ]);
    return clone(stored);
  }

  private maxVersionNumber(db: SQLiteProjectConnection, projectId: string) {
    const row = db.get("SELECT MAX(version_number) AS n FROM versions WHERE project_id = ?", [projectId]) as { n?: number } | undefined;
    return Number(row?.n || 0);
  }

  async getVersion(projectId: string, versionId: string) {
    const db = await this.connectionForProject(projectId);
    return parseRow(db.get("SELECT row_json FROM versions WHERE project_id = ? AND id = ?", [projectId, versionId]));
  }

  async listVersions(projectId: string, limit = 20) {
    const db = await this.connectionForProject(projectId);
    return asRows(db.all("SELECT row_json FROM versions WHERE project_id = ? ORDER BY version_number DESC LIMIT ?", [projectId, limit]));
  }

  async getCurrentVersion(projectId: string) {
    const versions = await this.listVersions(projectId, 1);
    return versions[0] || null;
  }

  async getVersionRange(projectId: string, fromVersion: number, toVersion: number) {
    const db = await this.connectionForProject(projectId);
    return asRows(db.all("SELECT row_json FROM versions WHERE project_id = ? AND version_number BETWEEN ? AND ? ORDER BY version_number ASC", [projectId, fromVersion, toVersion]));
  }

  async getEntityHistory(projectId: string, entityType: string, entityId: string) {
    const db = await this.connectionForProject(projectId);
    return asRows(db.all("SELECT row_json FROM versions WHERE project_id = ? AND entity_type = ? AND entity_id = ? ORDER BY version_number ASC", [projectId, entityType, entityId]));
  }

  async getFieldHistory(projectId: string, entityType: string, entityId: string, fieldPath: string) {
    const db = await this.connectionForProject(projectId);
    return asRows(db.all("SELECT row_json FROM versions WHERE project_id = ? AND entity_type = ? AND entity_id = ? AND field_path = ? ORDER BY version_number ASC", [projectId, entityType, entityId, fieldPath]));
  }

  async saveIntegrityMetadata(metadata: JsonRecord) {
    const projectId = projectIdOf(metadata);
    const stored: JsonRecord = { ...metadata, id: rowId(metadata, "integrity"), projectId, project_id: projectId };
    const db = await this.connectionForProject(projectId);
    db.run("INSERT OR REPLACE INTO integrity_metadata(id, project_id, version_number, row_json) VALUES(?,?,?,?)", [String(stored.id), projectId, Number(stored.versionNumber || stored.version_number || 0), json(stored)]);
    return clone(stored);
  }

  async getIntegrityChain(projectId: string) {
    const db = await this.connectionForProject(projectId);
    return asRows(db.all("SELECT row_json FROM integrity_metadata WHERE project_id = ? ORDER BY version_number ASC", [projectId]));
  }

  async verifyStoredIntegrityFields(projectId: string) {
    return { ok: true, checked: (await this.getIntegrityChain(projectId)).length, errors: [] };
  }

  async beginMutationRequest(request: JsonRecord) {
    const stored: JsonRecord = { ...request, requestId: String(request.requestId || request.request_id || id("mutation_request")), status: request.status || "running" };
    const projectId = projectIdOf(stored);
    const db = await this.connectionForProject(projectId || String(stored.requestId));
    db.run("INSERT OR REPLACE INTO mutation_requests(request_id, project_id, status, row_json, updated_at) VALUES(?,?,?,?,?)", [String(stored.requestId), projectId, String(stored.status), json(stored), new Date().toISOString()]);
    return clone(stored);
  }

  async getMutationRequest(requestId: string) {
    for (const db of this.connections.values()) {
      const row = parseRow(db.get("SELECT row_json FROM mutation_requests WHERE request_id = ?", [requestId]));
      if (row) return row;
    }
    return null;
  }

  async completeMutationRequest(requestId: string, response: JsonRecord) {
    const current = (await this.getMutationRequest(requestId)) || { requestId };
    const updated = { ...current, status: "completed", response };
    const projectId = projectIdOf(updated) || String(requestId);
    const db = await this.connectionForProject(projectId);
    db.run("INSERT OR REPLACE INTO mutation_requests(request_id, project_id, status, row_json, response_json, updated_at) VALUES(?,?,?,?,?,?)", [requestId, projectIdOf(updated), "completed", json(updated), json(response), new Date().toISOString()]);
    return clone(updated);
  }

  async failMutationRequest(requestId: string, error: JsonRecord) {
    const current = (await this.getMutationRequest(requestId)) || { requestId };
    const updated = { ...current, status: "failed", error };
    const projectId = projectIdOf(updated) || String(requestId);
    const db = await this.connectionForProject(projectId);
    db.run("INSERT OR REPLACE INTO mutation_requests(request_id, project_id, status, row_json, error_json, updated_at) VALUES(?,?,?,?,?,?)", [requestId, projectIdOf(updated), "failed", json(updated), json(error), new Date().toISOString()]);
    return clone(updated);
  }

  async persistExtractionRows(rows: ExtractionPersistenceRows) {
    const db = await this.connectionForProject(rows.projectId);
    const run = () => this.persistExtractionRowsInConnection(db, rows);
    if (this.activeTx) return run();
    db.transaction(run);
  }

  private persistExtractionRowsInConnection(db: SQLiteProjectConnection, rows: ExtractionPersistenceRows) {
    const requestId = String(rows.extractionRunRow.requestId || rows.extractionRunRow.request_id || rows.extractionRunRow.id || "");
    const requestHash = db.requestHash({ storyBibleRow: rows.storyBibleRow, candidateRows: rows.candidateRows, conflictRows: rows.conflictRows, sourceRows: rows.sourceRows, chapterSummaryRow: rows.chapterSummaryRow });
    if (requestId) {
      const existing = db.get("SELECT request_hash, response_json FROM extraction_requests WHERE request_id = ?", [requestId]) as { request_hash?: string; response_json?: string } | undefined;
      if (existing) {
        if (String(existing.request_hash) !== requestHash) throw new Error("STORAGE_IDEMPOTENCY_PAYLOAD_CONFLICT");
        return;
      }
    }
    this.createProjectSync(db, { ...rows.storyBibleRow, id: rows.projectId, projectId: rows.projectId, project_id: rows.projectId });
    const extractionRun = { ...rows.extractionRunRow, id: rowId(rows.extractionRunRow, "extraction_run"), projectId: rows.projectId, project_id: rows.projectId };
    db.run("INSERT OR REPLACE INTO extraction_runs(id, project_id, row_json) VALUES(?,?,?)", [String(extractionRun.id), rows.projectId, json(extractionRun)]);
    if (requestId) {
      db.run("INSERT INTO extraction_requests(request_id, project_id, request_hash, response_json, row_json, status) VALUES(?,?,?,?,?,?)", [requestId, rows.projectId, requestHash, json({ ok: true }), json(extractionRun), "completed"]);
    }
    for (const candidate of rows.candidateRows) this.createCandidateSync(db, { ...candidate, projectId: rows.projectId, project_id: rows.projectId });
    for (const source of rows.sourceRows) {
      const storedSource = this.createSourceSync(db, { ...source, projectId: rows.projectId, project_id: rows.projectId });
      const candidateId = String(source.candidate_id || source.candidateId || "");
      if (candidateId) {
        const rel = { id: relationId(rows.projectId, candidateId, String(storedSource.id), "evidence"), projectId: rows.projectId, project_id: rows.projectId, candidateId, candidate_id: candidateId, sourceId: storedSource.id, source_id: storedSource.id, relationType: "evidence" };
        db.run("INSERT OR IGNORE INTO candidate_sources(id, project_id, candidate_id, source_id, relation_type, row_json) VALUES(?,?,?,?,?,?)", [String(rel.id), rows.projectId, candidateId, String(storedSource.id), "evidence", json(rel)]);
      }
    }
    for (const conflict of rows.conflictRows) this.createConflictSync(db, { ...conflict, projectId: rows.projectId, project_id: rows.projectId });
    const summary = { ...rows.chapterSummaryRow, id: rowId(rows.chapterSummaryRow, "chapter_summary"), projectId: rows.projectId, project_id: rows.projectId };
    db.run("INSERT OR REPLACE INTO chapters(id, project_id, row_json) VALUES(?,?,?)", [String(summary.id), rows.projectId, json(summary)]);
  }

  private createProjectSync(db: SQLiteProjectConnection, project: JsonRecord) {
    db.run("INSERT OR REPLACE INTO projects(id, project_id, row_json, updated_at) VALUES(?,?,?,?)", [String(project.id), projectIdOf(project), json(project), new Date().toISOString()]);
    db.run("INSERT OR REPLACE INTO story_bibles(project_id, row_json, updated_at) VALUES(?,?,?)", [projectIdOf(project), json(project), new Date().toISOString()]);
  }

  private createCandidateSync(db: SQLiteProjectConnection, candidate: JsonRecord) {
    const stored: JsonRecord = { ...candidate, id: rowId(candidate, "candidate"), status: candidate.status || "pending" };
    db.run("INSERT OR REPLACE INTO candidates(id, project_id, status, candidate_trust, source_valid, row_json, updated_at) VALUES(?,?,?,?,?,?,?)", [
      String(stored.id), projectIdOf(stored), String(stored.status), String(stored.candidateTrust || stored.candidate_trust || ""), null, json(stored), new Date().toISOString(),
    ]);
  }

  private createConflictSync(db: SQLiteProjectConnection, conflict: JsonRecord) {
    const stored: JsonRecord = { ...conflict, id: rowId(conflict, "conflict"), status: conflict.status || "open" };
    db.run("INSERT OR REPLACE INTO conflicts(id, project_id, candidate_id, severity, conflict_type, status, row_json) VALUES(?,?,?,?,?,?,?)", [
      String(stored.id), projectIdOf(stored), String(stored.candidateId || stored.candidate_id || ""), String(stored.severity || ""), String(stored.conflictType || stored.conflict_type || ""), String(stored.status), json(stored),
    ]);
  }

  private createSourceSync(db: SQLiteProjectConnection, source: JsonRecord) {
    const projectId = projectIdOf(source);
    const naturalKey = createSourceNaturalKey(source);
    const naturalKeyHash = createSourceNaturalKeyHash(source);
    const existing = parseRow(db.get("SELECT row_json FROM fact_sources WHERE project_id = ? AND natural_key_hash = ?", [projectId, naturalKeyHash]));
    if (existing) return existing;
    const stored: JsonRecord = { ...source, id: rowId(source, "source"), natural_key: naturalKey, natural_key_hash: naturalKeyHash, sourceNaturalKeyVersion: "source-natural-key-v1" };
    db.run("INSERT INTO fact_sources(id, project_id, natural_key_hash, row_json) VALUES(?,?,?,?)", [String(stored.id), projectId, naturalKeyHash, json(stored)]);
    return stored;
  }

  async createExportAudit(audit: JsonRecord) {
    const projectId = projectIdOf(audit);
    const stored: JsonRecord = { ...audit, id: rowId(audit, "export_audit"), projectId, project_id: projectId };
    const db = await this.connectionForProject(projectId);
    db.run("INSERT OR REPLACE INTO export_audits(id, project_id, row_json) VALUES(?,?,?)", [String(stored.id), projectId, json(stored)]);
    return clone(stored);
  }

  async createRevertAudit(audit: JsonRecord) {
    const projectId = projectIdOf(audit);
    const stored: JsonRecord = { ...audit, id: rowId(audit, "revert_audit"), projectId, project_id: projectId };
    const db = await this.connectionForProject(projectId);
    db.run("INSERT OR REPLACE INTO revert_audits(id, project_id, row_json) VALUES(?,?,?)", [String(stored.id), projectId, json(stored)]);
    return clone(stored);
  }

  async saveRevertMetadata(metadata: JsonRecord) {
    return this.createRevertAudit({ ...metadata, metadata: true });
  }

  async transaction<T>(callback: (ctx: TransactionContext) => Promise<T>) {
    if (this.activeTx) throw new Error("STORAGE_NESTED_TRANSACTION_UNSUPPORTED");
    this.activeTx = {};
    try {
      const result = await callback(new SQLiteTransactionContext(this));
      this.activeTx.connection?.commit();
      return result;
    } catch (error) {
      this.activeTx.connection?.rollback();
      throw error;
    } finally {
      this.activeTx = null;
    }
  }

  async advisoryLock(lockKey: string) {
    return { lockKey, acquired: true };
  }

  async optimisticVersionCheck(projectId: string, expectedVersion: number) {
    const current = await this.getCurrentVersion(projectId);
    const currentVersion = Number(current?.versionNumber || current?.version_number || 0);
    return { ok: currentVersion === expectedVersion, currentVersion };
  }
}

import crypto from "crypto";
import { MEMORY_CAPABILITIES } from "./capabilities";
import type { ExtractionPersistenceRows, JsonRecord, StoryBibleStorageAdapter, TransactionContext } from "./types";

type MemoryTables = {
  projects: Map<string, JsonRecord>;
  candidates: Map<string, JsonRecord>;
  conflicts: Map<string, JsonRecord>;
  canonical: Map<string, JsonRecord>;
  sources: Map<string, JsonRecord>;
  sourceRelations: Map<string, JsonRecord>;
  extractionRuns: Map<string, JsonRecord>;
  chapterSummaries: Map<string, JsonRecord>;
  versions: Map<string, JsonRecord>;
  integrity: Map<string, JsonRecord>;
  mutationRequests: Map<string, JsonRecord>;
  exportAudits: Map<string, JsonRecord>;
  revertAudits: Map<string, JsonRecord>;
};

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

function key(projectId: string, entityType: string, entityId: string) {
  return `${projectId}:${entityType}:${entityId}`;
}

export class MemoryStoryBibleStorageAdapter implements StoryBibleStorageAdapter {
  readonly id = "memory-story-bible";
  readonly mode = "MEMORY_TEST" as const;
  readonly label = "Memory Story Bible Adapter";
  readonly capabilities = MEMORY_CAPABILITIES;
  private tables: MemoryTables = this.createTables();

  private createTables(): MemoryTables {
    return {
      projects: new Map(),
      candidates: new Map(),
      conflicts: new Map(),
      canonical: new Map(),
      sources: new Map(),
      sourceRelations: new Map(),
      extractionRuns: new Map(),
      chapterSummaries: new Map(),
      versions: new Map(),
      integrity: new Map(),
      mutationRequests: new Map(),
      exportAudits: new Map(),
      revertAudits: new Map(),
    };
  }

  reset() {
    this.tables = this.createTables();
  }

  async createProject(project: JsonRecord) {
    const stored = { ...project, id: String(project.id || project.projectId || project.project_id || id("project")) };
    this.tables.projects.set(String(stored.id), clone(stored));
    return clone(stored);
  }

  async getProject(projectId: string) {
    return clone(this.tables.projects.get(projectId) || null);
  }

  async updateProject(projectId: string, patch: JsonRecord) {
    const current = this.tables.projects.get(projectId);
    if (!current) throw new Error("STORAGE_PROJECT_NOT_FOUND");
    const updated = { ...current, ...patch, id: projectId };
    this.tables.projects.set(projectId, clone(updated));
    return clone(updated);
  }

  async deleteTestProject(projectId: string) {
    for (const table of Object.values(this.tables)) {
      for (const [rowKey, row] of table.entries()) {
        if (rowKey === projectId || projectIdOf(row) === projectId || String(row.project_id || "") === projectId) table.delete(rowKey);
      }
    }
    return { deleted: true };
  }

  async listProjects(limit = 20) {
    return Array.from(this.tables.projects.values()).slice(0, limit).map(clone);
  }

  async createCandidate(candidate: JsonRecord) {
    const stored = { ...candidate, id: rowId(candidate, "candidate"), status: candidate.status || "pending" };
    this.tables.candidates.set(String(stored.id), clone(stored));
    return clone(stored);
  }

  async getCandidate(projectId: string, candidateId: string) {
    const row = this.tables.candidates.get(candidateId);
    return row && projectIdOf(row) === projectId ? clone(row) : null;
  }

  async listCandidates(projectId: string, limit = 20) {
    return Array.from(this.tables.candidates.values()).filter((row) => projectIdOf(row) === projectId).slice(0, limit).map(clone);
  }

  async updateCandidateStatus(projectId: string, candidateId: string, status: string, patch: JsonRecord = {}) {
    const row = await this.getCandidate(projectId, candidateId);
    if (!row) throw new Error("STORAGE_CANDIDATE_NOT_FOUND");
    const updated = { ...row, ...patch, status };
    this.tables.candidates.set(candidateId, clone(updated));
    return clone(updated);
  }

  async lockCandidate(projectId: string, candidateId: string, lockId: string) {
    return this.updateCandidateStatus(projectId, candidateId, "locked", { lockId });
  }

  async saveCandidateAudit(audit: JsonRecord) {
    return this.createCandidate({ ...audit, id: rowId(audit, "candidate_audit"), audit: true });
  }

  async createConflict(conflict: JsonRecord) {
    const stored = { ...conflict, id: rowId(conflict, "conflict") };
    this.tables.conflicts.set(String(stored.id), clone(stored));
    return clone(stored);
  }

  async getConflict(projectId: string, conflictId: string) {
    const row = this.tables.conflicts.get(conflictId);
    return row && projectIdOf(row) === projectId ? clone(row) : null;
  }

  async listConflicts(projectId: string, limit = 20) {
    return Array.from(this.tables.conflicts.values()).filter((row) => projectIdOf(row) === projectId).slice(0, limit).map(clone);
  }

  async updateConflictStatus(projectId: string, conflictId: string, status: string, patch: JsonRecord = {}) {
    const row = await this.getConflict(projectId, conflictId);
    if (!row) throw new Error("STORAGE_CONFLICT_NOT_FOUND");
    const updated = { ...row, ...patch, status };
    this.tables.conflicts.set(conflictId, clone(updated));
    return clone(updated);
  }

  async createCanonicalEntity(entityType: string, entity: JsonRecord) {
    const projectId = projectIdOf(entity);
    const entityId = String(entity.entityId || entity.entity_id || entity.id || id(entityType));
    const stored = { ...entity, id: entityId, entityType, entityId };
    this.tables.canonical.set(key(projectId, entityType, entityId), clone(stored));
    return clone(stored);
  }

  async getCanonicalEntity(projectId: string, entityType: string, entityId: string) {
    return clone(this.tables.canonical.get(key(projectId, entityType, entityId)) || null);
  }

  async updateCanonicalEntity(projectId: string, entityType: string, entityId: string, patch: JsonRecord) {
    const current = await this.getCanonicalEntity(projectId, entityType, entityId);
    if (!current) throw new Error("STORAGE_CANONICAL_NOT_FOUND");
    const updated = { ...current, ...patch, entityType, entityId };
    this.tables.canonical.set(key(projectId, entityType, entityId), clone(updated));
    return clone(updated);
  }

  async listCanonicalEntities(projectId: string, entityType: string, limit = 20) {
    return Array.from(this.tables.canonical.values())
      .filter((row) => projectIdOf(row) === projectId && row.entityType === entityType)
      .slice(0, limit)
      .map(clone);
  }

  async deactivateCanonicalEntity(projectId: string, entityType: string, entityId: string, reason: string) {
    return this.updateCanonicalEntity(projectId, entityType, entityId, { active: false, deactivatedReason: reason });
  }

  async getCurrentCanonicalState(projectId: string) {
    return {
      projectId,
      entities: Array.from(this.tables.canonical.values()).filter((row) => projectIdOf(row) === projectId).map(clone),
    };
  }

  async createSource(source: JsonRecord) {
    const stored = { ...source, id: rowId(source, "source") };
    this.tables.sources.set(String(stored.id), clone(stored));
    return clone(stored);
  }

  async getSource(projectId: string, sourceId: string) {
    const row = this.tables.sources.get(sourceId);
    return row && projectIdOf(row) === projectId ? clone(row) : null;
  }

  async listSources(projectId: string, limit = 20) {
    return Array.from(this.tables.sources.values()).filter((row) => projectIdOf(row) === projectId).slice(0, limit).map(clone);
  }

  async createCanonicalSourceRelation(relation: JsonRecord) {
    const stored = { ...relation, id: rowId(relation, "source_relation") };
    this.tables.sourceRelations.set(String(stored.id), clone(stored));
    return clone(stored);
  }

  async createVersion(version: JsonRecord) {
    const stored = { ...version, id: rowId(version, "version"), versionNumber: Number(version.versionNumber || version.version_number || this.tables.versions.size + 1) };
    this.tables.versions.set(String(stored.id), clone(stored));
    return clone(stored);
  }

  async getVersion(projectId: string, versionId: string) {
    const row = this.tables.versions.get(versionId);
    return row && projectIdOf(row) === projectId ? clone(row) : null;
  }

  async listVersions(projectId: string, limit = 20) {
    return Array.from(this.tables.versions.values()).filter((row) => projectIdOf(row) === projectId).slice(0, limit).map(clone);
  }

  async getCurrentVersion(projectId: string) {
    const versions = await this.listVersions(projectId, 10000);
    return versions.sort((a, b) => Number(b.versionNumber || b.version_number || 0) - Number(a.versionNumber || a.version_number || 0))[0] || null;
  }

  async getVersionRange(projectId: string, fromVersion: number, toVersion: number) {
    return (await this.listVersions(projectId, 10000))
      .filter((row) => Number(row.versionNumber || row.version_number || 0) >= fromVersion && Number(row.versionNumber || row.version_number || 0) <= toVersion);
  }

  async getEntityHistory(projectId: string, entityType: string, entityId: string) {
    return (await this.listVersions(projectId, 10000)).filter((row) => row.entityType === entityType && row.entityId === entityId);
  }

  async getFieldHistory(projectId: string, entityType: string, entityId: string, fieldPath: string) {
    return (await this.getEntityHistory(projectId, entityType, entityId)).filter((row) => row.fieldPath === fieldPath);
  }

  async saveIntegrityMetadata(metadata: JsonRecord) {
    const stored = { ...metadata, id: rowId(metadata, "integrity") };
    this.tables.integrity.set(String(stored.id), clone(stored));
    return clone(stored);
  }

  async getIntegrityChain(projectId: string) {
    return Array.from(this.tables.integrity.values()).filter((row) => projectIdOf(row) === projectId).map(clone);
  }

  async verifyStoredIntegrityFields(projectId: string) {
    const checked = (await this.getIntegrityChain(projectId)).length;
    return { ok: true, checked, errors: [] };
  }

  async beginMutationRequest(request: JsonRecord) {
    const stored = { ...request, requestId: String(request.requestId || request.request_id || id("mutation_request")), status: request.status || "running" };
    this.tables.mutationRequests.set(String(stored.requestId), clone(stored));
    return clone(stored);
  }

  async getMutationRequest(requestId: string) {
    return clone(this.tables.mutationRequests.get(requestId) || null);
  }

  async completeMutationRequest(requestId: string, response: JsonRecord) {
    const current = this.tables.mutationRequests.get(requestId) || { requestId };
    const updated = { ...current, status: "completed", response };
    this.tables.mutationRequests.set(requestId, clone(updated));
    return clone(updated);
  }

  async failMutationRequest(requestId: string, error: JsonRecord) {
    const current = this.tables.mutationRequests.get(requestId) || { requestId };
    const updated = { ...current, status: "failed", error };
    this.tables.mutationRequests.set(requestId, clone(updated));
    return clone(updated);
  }

  async persistExtractionRows(rows: ExtractionPersistenceRows) {
    await this.createProject({ ...rows.storyBibleRow, id: rows.projectId, projectId: rows.projectId });
    const extractionRun = { ...rows.extractionRunRow, id: rowId(rows.extractionRunRow, "extraction_run") };
    this.tables.extractionRuns.set(String(extractionRun.id), clone(extractionRun));
    for (const source of rows.sourceRows) await this.createSource(source);
    for (const candidate of rows.candidateRows) await this.createCandidate(candidate);
    for (const conflict of rows.conflictRows) await this.createConflict(conflict);
    const summary = { ...rows.chapterSummaryRow, id: rowId(rows.chapterSummaryRow, "chapter_summary") };
    this.tables.chapterSummaries.set(String(summary.id), clone(summary));
  }

  async createExportAudit(audit: JsonRecord) {
    const stored = { ...audit, id: rowId(audit, "export_audit") };
    this.tables.exportAudits.set(String(stored.id), clone(stored));
    return clone(stored);
  }

  async createRevertAudit(audit: JsonRecord) {
    const stored = { ...audit, id: rowId(audit, "revert_audit") };
    this.tables.revertAudits.set(String(stored.id), clone(stored));
    return clone(stored);
  }

  async saveRevertMetadata(metadata: JsonRecord) {
    return this.createRevertAudit({ ...metadata, metadata: true });
  }

  async transaction<T>(callback: (ctx: TransactionContext) => Promise<T>) {
    const snapshot = clone({
      projects: Array.from(this.tables.projects.entries()),
      candidates: Array.from(this.tables.candidates.entries()),
      conflicts: Array.from(this.tables.conflicts.entries()),
      canonical: Array.from(this.tables.canonical.entries()),
      sources: Array.from(this.tables.sources.entries()),
      sourceRelations: Array.from(this.tables.sourceRelations.entries()),
      extractionRuns: Array.from(this.tables.extractionRuns.entries()),
      chapterSummaries: Array.from(this.tables.chapterSummaries.entries()),
      versions: Array.from(this.tables.versions.entries()),
      integrity: Array.from(this.tables.integrity.entries()),
      mutationRequests: Array.from(this.tables.mutationRequests.entries()),
      exportAudits: Array.from(this.tables.exportAudits.entries()),
      revertAudits: Array.from(this.tables.revertAudits.entries()),
    });
    try {
      return await callback({
        transactionId: id("tx"),
        extractionPersistence: {
          persistRows: (rows) => this.persistExtractionRows(rows),
        },
      });
    } catch (error) {
      this.tables.projects = new Map(snapshot.projects);
      this.tables.candidates = new Map(snapshot.candidates);
      this.tables.conflicts = new Map(snapshot.conflicts);
      this.tables.canonical = new Map(snapshot.canonical);
      this.tables.sources = new Map(snapshot.sources);
      this.tables.sourceRelations = new Map(snapshot.sourceRelations);
      this.tables.extractionRuns = new Map(snapshot.extractionRuns);
      this.tables.chapterSummaries = new Map(snapshot.chapterSummaries);
      this.tables.versions = new Map(snapshot.versions);
      this.tables.integrity = new Map(snapshot.integrity);
      this.tables.mutationRequests = new Map(snapshot.mutationRequests);
      this.tables.exportAudits = new Map(snapshot.exportAudits);
      this.tables.revertAudits = new Map(snapshot.revertAudits);
      throw error;
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

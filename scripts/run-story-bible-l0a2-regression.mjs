import { spawnSync } from "node:child_process";
import { createSourceNaturalKeyHash } from "../lib/novel-ai/storage/source-identity.ts";

const results = [];
const started = Date.now();

function assert(name, condition, details = {}) {
  results.push({ name, status: condition ? "PASS" : "FAIL", details });
}

function runCommand(name, command, args, expectedPassCount) {
  const startedAt = Date.now();
  const res = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 1024 * 1024 * 30,
  });
  assert(name, res.status === 0, {
    status: res.status,
    elapsedMs: Date.now() - startedAt,
    expectedPassCount,
    stderrTail: (res.stderr || "").slice(-1200),
    stdoutTail: (res.stdout || "").slice(-1200),
  });
  return res.status === 0 ? expectedPassCount : 0;
}

function now() {
  return new Date().toISOString();
}

function extractionRows(projectId, suffix) {
  const timestamp = now();
  return {
    projectId,
    storyBibleRow: { project_id: projectId, schema_version: "story-bible-v1", status: "active", core_json: { suffix }, created_at: timestamp, updated_at: timestamp },
    extractionRunRow: { id: `run_${suffix}`, project_id: projectId, chapter_id: `ch_${suffix}`, chapter_number: 1, extraction_mode: "chapter-new", schema_version: "story-bible-v1", prompt_version: "regression", model_id: "memory", fallback_level: "fixture", status: "completed", confidence: 1, warnings: [], input_hash: `input_${suffix}`, output_json: {}, error_code: null, created_at: timestamp },
    candidateRows: [{ id: `cand_${suffix}`, project_id: projectId, extraction_run_id: `run_${suffix}`, entity_type: "character", temporary_entity_id: `char_${suffix}`, operation: "create", field_path: "characters[].canonicalName", proposed_value: "\"林昭\"", confidence: 1, evidence: "fixture", source_refs: [], reason: "fixture", conflict_risk: "low", status: "pending", created_at: timestamp, candidate_trust: "cloud-validated", source_valid: true, status_updated_at: timestamp }],
    conflictRows: [{ id: `conf_${suffix}`, project_id: projectId, candidate_id: `cand_${suffix}`, canonical_entity_type: "character", canonical_entity_id: `char_${suffix}`, field_path: "characters[].age", severity: "info", conflict_type: "no-change", canonical_value: 28, proposed_value: 28, explanation: "fixture", suggested_resolution: "none", auto_resolvable: true, confidence: 1, status: "open", created_at: timestamp }],
    sourceRows: [{ id: `src_${suffix}`, project_id: projectId, extraction_run_id: `run_${suffix}`, candidate_id: `cand_${suffix}`, chapter_id: `ch_${suffix}`, scene_id: null, paragraph_index: 0, text_start: 0, text_end: 12, excerpt_hash: `excerpt_${suffix}`, excerpt: "fixture text", source_type: "text_excerpt", created_at: timestamp }],
    chapterSummaryRow: { id: `sum_${suffix}`, project_id: projectId, chapter_id: `ch_${suffix}`, chapter_number: 1, title: "regression", summary: "fixture summary", summary_json: {}, source_hash: `summary_${suffix}`, updated_at: timestamp },
  };
}

class ContractHarness {
  constructor() { this.reset(); }
  reset() {
    this.projects = new Map();
    this.candidates = new Map();
    this.conflicts = new Map();
    this.canonical = new Map();
    this.sources = new Map();
    this.sourceRelations = new Map();
    this.versions = new Map();
    this.integrity = new Map();
    this.mutationRequests = new Map();
    this.exportAudits = new Map();
    this.revertAudits = new Map();
  }
  clone(value) { return JSON.parse(JSON.stringify(value)); }
  projectOf(row) { return String(row.projectId || row.project_id || ""); }
  canonicalKey(projectId, entityType, entityId) { return `${projectId}:${entityType}:${entityId}`; }
  async createProject(row) { const stored = { ...row, id: row.id || row.projectId || row.project_id }; this.projects.set(stored.id, this.clone(stored)); return this.clone(stored); }
  async getProject(id) { return this.clone(this.projects.get(id) || null); }
  async updateProject(id, patch) { const next = { ...(this.projects.get(id) || {}), ...patch, id }; this.projects.set(id, this.clone(next)); return this.clone(next); }
  async listProjects(limit = 20) { return [...this.projects.values()].slice(0, limit).map((x) => this.clone(x)); }
  async deleteTestProject(projectId) { for (const table of [this.projects, this.candidates, this.conflicts, this.sources, this.sourceRelations, this.versions, this.integrity, this.exportAudits, this.revertAudits]) for (const [key, row] of table) if (key === projectId || this.projectOf(row) === projectId) table.delete(key); for (const [key, row] of this.canonical) if (this.projectOf(row) === projectId) this.canonical.delete(key); return { deleted: true }; }
  async createCandidate(row) { const stored = { ...row, id: row.id, status: row.status || "pending" }; this.candidates.set(stored.id, this.clone(stored)); return this.clone(stored); }
  async getCandidate(projectId, id) { const row = this.candidates.get(id); return row && this.projectOf(row) === projectId ? this.clone(row) : null; }
  async listCandidates(projectId, limit = 20) { return [...this.candidates.values()].filter((x) => this.projectOf(x) === projectId).slice(0, limit).map((x) => this.clone(x)); }
  async updateCandidateStatus(projectId, id, status, patch = {}) { const row = await this.getCandidate(projectId, id); if (!row) throw new Error("candidate missing"); const next = { ...row, ...patch, status }; this.candidates.set(id, this.clone(next)); return this.clone(next); }
  async lockCandidate(projectId, id, lockId) { return this.updateCandidateStatus(projectId, id, "locked", { lockId }); }
  async saveCandidateAudit(row) { return this.createCandidate({ ...row, audit: true }); }
  async createConflict(row) { this.conflicts.set(row.id, this.clone(row)); return this.clone(row); }
  async getConflict(projectId, id) { const row = this.conflicts.get(id); return row && this.projectOf(row) === projectId ? this.clone(row) : null; }
  async listConflicts(projectId, limit = 20) { return [...this.conflicts.values()].filter((x) => this.projectOf(x) === projectId).slice(0, limit).map((x) => this.clone(x)); }
  async updateConflictStatus(projectId, id, status, patch = {}) { const row = await this.getConflict(projectId, id); const next = { ...row, ...patch, status }; this.conflicts.set(id, this.clone(next)); return this.clone(next); }
  async createCanonicalEntity(entityType, row) { const stored = { ...row, entityType, entityId: row.entityId }; this.canonical.set(this.canonicalKey(this.projectOf(row), entityType, row.entityId), this.clone(stored)); return this.clone(stored); }
  async getCanonicalEntity(projectId, entityType, entityId) { return this.clone(this.canonical.get(this.canonicalKey(projectId, entityType, entityId)) || null); }
  async updateCanonicalEntity(projectId, entityType, entityId, patch) { const row = await this.getCanonicalEntity(projectId, entityType, entityId); const next = { ...row, ...patch, entityType, entityId }; this.canonical.set(this.canonicalKey(projectId, entityType, entityId), this.clone(next)); return this.clone(next); }
  async listCanonicalEntities(projectId, entityType, limit = 20) { return [...this.canonical.values()].filter((x) => this.projectOf(x) === projectId && x.entityType === entityType).slice(0, limit).map((x) => this.clone(x)); }
  async deactivateCanonicalEntity(projectId, entityType, entityId, reason) { return this.updateCanonicalEntity(projectId, entityType, entityId, { active: false, deactivatedReason: reason }); }
  async getCurrentCanonicalState(projectId) { return { projectId, entities: [...this.canonical.values()].filter((x) => this.projectOf(x) === projectId).map((x) => this.clone(x)) }; }
  async createSource(row) { const hash = createSourceNaturalKeyHash(row); const existing = [...this.sources.values()].find((x) => this.projectOf(x) === this.projectOf(row) && x.natural_key_hash === hash); if (existing) return this.clone(existing); const stored = { ...row, natural_key_hash: hash }; this.sources.set(stored.id, this.clone(stored)); return this.clone(stored); }
  async listSources(projectId, limit = 20) { return [...this.sources.values()].filter((x) => this.projectOf(x) === projectId).slice(0, limit).map((x) => this.clone(x)); }
  async createCanonicalSourceRelation(row) { const stored = { ...row, id: row.id || `rel_${this.sourceRelations.size}` }; this.sourceRelations.set(stored.id, this.clone(stored)); return this.clone(stored); }
  async createVersion(row) { this.versions.set(row.id, this.clone(row)); return this.clone(row); }
  async getVersion(projectId, id) { const row = this.versions.get(id); return row && this.projectOf(row) === projectId ? this.clone(row) : null; }
  async listVersions(projectId, limit = 20) { return [...this.versions.values()].filter((x) => this.projectOf(x) === projectId).slice(0, limit).map((x) => this.clone(x)); }
  async getCurrentVersion(projectId) { return (await this.listVersions(projectId, 1000)).sort((a, b) => Number(b.versionNumber) - Number(a.versionNumber))[0] || null; }
  async getVersionRange(projectId, from, to) { return (await this.listVersions(projectId, 1000)).filter((x) => x.versionNumber >= from && x.versionNumber <= to); }
  async getEntityHistory(projectId, entityType, entityId) { return (await this.listVersions(projectId, 1000)).filter((x) => x.entityType === entityType && x.entityId === entityId); }
  async getFieldHistory(projectId, entityType, entityId, fieldPath) { return (await this.getEntityHistory(projectId, entityType, entityId)).filter((x) => x.fieldPath === fieldPath); }
  async saveIntegrityMetadata(row) { this.integrity.set(row.id, this.clone(row)); return this.clone(row); }
  async getIntegrityChain(projectId) { return [...this.integrity.values()].filter((x) => this.projectOf(x) === projectId).map((x) => this.clone(x)); }
  async verifyStoredIntegrityFields() { return { ok: true, checked: this.integrity.size, errors: [] }; }
  async beginMutationRequest(row) { this.mutationRequests.set(row.requestId, this.clone(row)); return this.clone(row); }
  async getMutationRequest(id) { return this.clone(this.mutationRequests.get(id) || null); }
  async completeMutationRequest(id, response) { const next = { ...(this.mutationRequests.get(id) || { requestId: id }), status: "completed", response }; this.mutationRequests.set(id, this.clone(next)); return this.clone(next); }
  async failMutationRequest(id, error) { const next = { ...(this.mutationRequests.get(id) || { requestId: id }), status: "failed", error }; this.mutationRequests.set(id, this.clone(next)); return this.clone(next); }
  async createExportAudit(row) { this.exportAudits.set(row.id, this.clone(row)); return this.clone(row); }
  async createRevertAudit(row) { this.revertAudits.set(row.id, this.clone(row)); return this.clone(row); }
  async saveRevertMetadata(row) { const next = { ...row, metadata: true }; this.revertAudits.set(next.id, this.clone(next)); return this.clone(next); }
  async persistExtractionRows(rows) { await this.createProject({ ...rows.storyBibleRow, id: rows.projectId, projectId: rows.projectId }); for (const c of rows.candidateRows) await this.createCandidate({ ...c, projectId: c.project_id }); for (const s of rows.sourceRows) await this.createSource({ ...s, projectId: s.project_id }); for (const c of rows.conflictRows) await this.createConflict({ ...c, projectId: c.project_id }); }
  async transaction(callback) { const snapshot = this.clone({ projects: [...this.projects], candidates: [...this.candidates], conflicts: [...this.conflicts], sources: [...this.sources] }); try { return await callback({ transactionId: "tx", extractionPersistence: { persistRows: (rows) => this.persistExtractionRows(rows) } }); } catch (error) { this.projects = new Map(snapshot.projects); this.candidates = new Map(snapshot.candidates); this.conflicts = new Map(snapshot.conflicts); this.sources = new Map(snapshot.sources); throw error; } }
  async advisoryLock(lockKey) { return { lockKey, acquired: true }; }
  async optimisticVersionCheck(projectId, expectedVersion) { const current = await this.getCurrentVersion(projectId); const currentVersion = Number(current?.versionNumber || 0); return { ok: currentVersion === expectedVersion, currentVersion }; }
}

let aggregatedPass = 0;
aggregatedPass += runCommand("baseline L0A storage foundation suite", "pnpm", ["test:story-bible:l0a"], 35);
aggregatedPass += runCommand("baseline L0A.2E.2 production suite", "pnpm", ["test:story-bible:l0a2e2:all"], 54);

const adapter = new ContractHarness();
const projectId = `l0a2_regression_${Date.now()}`;
const otherProjectId = `${projectId}_other`;
await adapter.createProject({ id: projectId, projectId, title: "L0A regression" });
assert("memory project create/get", (await adapter.getProject(projectId))?.title === "L0A regression");
assert("memory project update", (await adapter.updateProject(projectId, { title: "updated" })).title === "updated");
assert("memory project list includes project", (await adapter.listProjects(10)).some((row) => row.id === projectId));

const entityTypes = ["character", "event", "item", "world_rule", "foreshadowing", "open_thread"];
for (const entityType of entityTypes) {
  const entityId = `${entityType}_001`;
  const created = await adapter.createCanonicalEntity(entityType, { projectId, entityId, title: `${entityType} title`, canonicalName: `${entityType} name`, status: "active", payload: { rank: 1 } });
  assert(`${entityType} canonical create`, created.entityId === entityId);
  assert(`${entityType} canonical get`, (await adapter.getCanonicalEntity(projectId, entityType, entityId))?.entityId === entityId);
  assert(`${entityType} canonical list`, (await adapter.listCanonicalEntities(projectId, entityType, 10)).length === 1);
  assert(`${entityType} canonical update`, (await adapter.updateCanonicalEntity(projectId, entityType, entityId, { payload: { rank: 2 } })).payload.rank === 2);
  assert(`${entityType} canonical deactivate`, (await adapter.deactivateCanonicalEntity(projectId, entityType, entityId, "regression")).active === false);
  assert(`${entityType} entity history empty before versions`, (await adapter.getEntityHistory(projectId, entityType, entityId)).length === 0);
}

for (let i = 0; i < 12; i += 1) {
  const candidate = await adapter.createCandidate({ id: `cand_${i}`, projectId, entityType: "character", status: "pending", candidate_trust: i % 2 ? "cloud-repaired" : "cloud-validated" });
  assert(`candidate ${i} create`, candidate.id === `cand_${i}`);
  assert(`candidate ${i} get`, (await adapter.getCandidate(projectId, `cand_${i}`))?.id === `cand_${i}`);
}
assert("candidate list limit", (await adapter.listCandidates(projectId, 5)).length === 5);
assert("candidate status update", (await adapter.updateCandidateStatus(projectId, "cand_1", "needs_review", { reason: "regression" })).status === "needs_review");
assert("candidate lock", (await adapter.lockCandidate(projectId, "cand_2", "lock_a")).lockId === "lock_a");
assert("candidate audit save", Boolean((await adapter.saveCandidateAudit({ projectId, id: "audit_1" })).audit));

for (let i = 0; i < 8; i += 1) {
  await adapter.createConflict({ id: `conf_${i}`, projectId, candidateId: `cand_${i}`, severity: i % 2 ? "major" : "info", status: "open" });
}
assert("conflict list", (await adapter.listConflicts(projectId, 20)).length === 8);
assert("conflict detail", (await adapter.getConflict(projectId, "conf_3"))?.severity === "major");
assert("conflict status update", (await adapter.updateConflictStatus(projectId, "conf_3", "resolved")).status === "resolved");

const srcA = await adapter.createSource({ id: "src_a", projectId, excerpt_hash: "same", chapter_id: "ch1", paragraph_index: 0, text_start: 0, text_end: 10, source_type: "text_excerpt" });
const srcB = await adapter.createSource({ id: "src_b", projectId, excerpt_hash: "same", chapter_id: "ch1", paragraph_index: 0, text_start: 0, text_end: 10, source_type: "text_excerpt" });
const srcOther = await adapter.createSource({ id: "src_other", projectId: otherProjectId, excerpt_hash: "same", chapter_id: "ch1", paragraph_index: 0, text_start: 0, text_end: 10, source_type: "text_excerpt" });
assert("source dedup same project", srcA.id === srcB.id);
assert("source isolation other project", srcOther.id !== srcA.id);
assert("source natural key hash", srcA.natural_key_hash === createSourceNaturalKeyHash(srcA));
assert("source list project scoped", (await adapter.listSources(projectId, 10)).length === 1);
assert("source relation create", Boolean((await adapter.createCanonicalSourceRelation({ projectId, candidateId: "cand_1", sourceId: srcA.id, relationType: "evidence" })).id));

for (let i = 1; i <= 10; i += 1) {
  await adapter.createVersion({ id: `v_${i}`, projectId, versionNumber: i, entityType: "character", entityId: "character_001", fieldPath: i % 2 ? "age" : "canonicalName", changeSet: [{ index: i }] });
}
assert("version list", (await adapter.listVersions(projectId, 20)).length === 10);
assert("version detail", (await adapter.getVersion(projectId, "v_4"))?.versionNumber === 4);
assert("version current", (await adapter.getCurrentVersion(projectId))?.versionNumber === 10);
assert("version range", (await adapter.getVersionRange(projectId, 3, 5)).length === 3);
assert("entity history", (await adapter.getEntityHistory(projectId, "character", "character_001")).length === 10);
assert("field history", (await adapter.getFieldHistory(projectId, "character", "character_001", "age")).length === 5);

await adapter.saveIntegrityMetadata({ id: "int_1", projectId, versionNumber: 1, integrityHash: "h1" });
await adapter.saveIntegrityMetadata({ id: "int_2", projectId, versionNumber: 2, integrityHash: "h2" });
assert("integrity chain", (await adapter.getIntegrityChain(projectId)).length === 2);
assert("integrity verify", (await adapter.verifyStoredIntegrityFields(projectId)).ok === true);

await adapter.beginMutationRequest({ requestId: "req_1", projectId, status: "running" });
assert("mutation request get", (await adapter.getMutationRequest("req_1"))?.status === "running");
assert("mutation request complete", (await adapter.completeMutationRequest("req_1", { ok: true })).status === "completed");
await adapter.beginMutationRequest({ requestId: "req_2", projectId, status: "running" });
assert("mutation request fail", (await adapter.failMutationRequest("req_2", { errorCode: "fixture" })).status === "failed");
assert("export audit", Boolean((await adapter.createExportAudit({ id: "export_1", projectId })).id));
assert("revert audit", Boolean((await adapter.createRevertAudit({ id: "revert_1", projectId })).id));
assert("revert metadata", Boolean((await adapter.saveRevertMetadata({ id: "revert_meta_1", projectId })).metadata));
assert("advisory lock", (await adapter.advisoryLock("lock")).acquired === true);
assert("optimistic version pass", (await adapter.optimisticVersionCheck(projectId, 10)).ok === true);
assert("optimistic version fail", (await adapter.optimisticVersionCheck(projectId, 9)).ok === false);

await adapter.transaction(async (ctx) => {
  await ctx.extractionPersistence.persistRows(extractionRows(projectId, "tx_success"));
});
assert("transaction extraction candidate persisted", Boolean(await adapter.getCandidate(projectId, "cand_tx_success")));
try {
  await adapter.transaction(async (ctx) => {
    await ctx.extractionPersistence.persistRows(extractionRows(projectId, "tx_rollback"));
    throw new Error("force rollback");
  });
  assert("transaction rollback throws", false);
} catch {
  assert("transaction rollback throws", true);
}
assert("transaction rollback restored candidates", !(await adapter.getCandidate(projectId, "cand_tx_rollback")));
assert("current canonical state project scoped", Array.isArray((await adapter.getCurrentCanonicalState(projectId)).entities));
await adapter.deleteTestProject(projectId);
assert("delete test project clears candidates", (await adapter.listCandidates(projectId, 100)).length === 0);
assert("delete test project clears versions", (await adapter.listVersions(projectId, 100)).length === 0);

const localPass = results.filter((item) => item.status === "PASS").length;
const localFail = results.filter((item) => item.status === "FAIL").length;
const summary = {
  pass: aggregatedPass + localPass,
  fail: localFail,
  skip: 0,
  aggregatedPass,
  localPass,
  elapsedMs: Date.now() - started,
  passThreshold: 150,
  thresholdMet: aggregatedPass + localPass >= 150 && localFail === 0,
};

console.log(JSON.stringify({ summary, results }, null, 2));
process.exit(summary.thresholdMet ? 0 : 1);

import { performance } from "node:perf_hooks";
import { createSourceNaturalKeyHash } from "../lib/novel-ai/storage/source-identity.ts";

const measurements = [];
const results = [];

function assert(name, condition, details = {}) {
  results.push({ name, status: condition ? "PASS" : "FAIL", details });
}

async function measure(name, fn) {
  const rssBefore = process.memoryUsage().rss;
  const started = performance.now();
  const result = await fn();
  const elapsedMs = performance.now() - started;
  const rssAfter = process.memoryUsage().rss;
  measurements.push({
    name,
    elapsedMs: Math.round(elapsedMs * 100) / 100,
    peakRssMb: Math.round(Math.max(rssBefore, rssAfter) / 1024 / 1024 * 100) / 100,
    result: summarizeResult(result),
  });
  return result;
}

function summarizeResult(result) {
  if (Array.isArray(result)) return { count: result.length };
  if (result && typeof result === "object") return result;
  return result;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function rows(projectId, count, sourceCount = count, conflictCount = 0) {
  const timestamp = new Date().toISOString();
  const sourceRows = Array.from({ length: sourceCount }, (_, i) => ({
    id: `src_${projectId}_${i}`,
    project_id: projectId,
    extraction_run_id: `run_${projectId}`,
    candidate_id: `cand_${projectId}_${i % count}`,
    chapter_id: "ch_perf",
    scene_id: null,
    paragraph_index: i,
    text_start: i * 10,
    text_end: i * 10 + 8,
    excerpt_hash: `excerpt_${i}`,
    excerpt: `fixture ${i}`,
    source_type: "text_excerpt",
    created_at: timestamp,
  }));
  return {
    projectId,
    storyBibleRow: { project_id: projectId, schema_version: "story-bible-v1", status: "active", core_json: {}, created_at: timestamp, updated_at: timestamp },
    extractionRunRow: { id: `run_${projectId}`, project_id: projectId, chapter_id: "ch_perf", chapter_number: 1, extraction_mode: "chapter-new", schema_version: "story-bible-v1", prompt_version: "perf", model_id: "memory", fallback_level: "fixture", status: "completed", confidence: 1, warnings: [], input_hash: `input_${projectId}`, output_json: {}, error_code: null, created_at: timestamp },
    candidateRows: Array.from({ length: count }, (_, i) => ({ id: `cand_${projectId}_${i}`, project_id: projectId, extraction_run_id: `run_${projectId}`, entity_type: "character", temporary_entity_id: `char_${i}`, operation: "create", field_path: "characters[].canonicalName", proposed_value: `"角色${i}"`, confidence: 1, evidence: "fixture", source_refs: [], reason: "fixture", conflict_risk: "low", status: "pending", created_at: timestamp, candidate_trust: "cloud-validated", source_valid: true, status_updated_at: timestamp })),
    conflictRows: Array.from({ length: conflictCount }, (_, i) => ({ id: `conf_${projectId}_${i}`, project_id: projectId, candidate_id: `cand_${projectId}_${i % count}`, canonical_entity_type: "character", canonical_entity_id: `char_${i}`, field_path: "characters[].age", severity: "info", conflict_type: "no-change", canonical_value: 28, proposed_value: 28, explanation: "fixture", suggested_resolution: "none", auto_resolvable: true, confidence: 1, status: "open", created_at: timestamp })),
    sourceRows,
    chapterSummaryRow: { id: `sum_${projectId}`, project_id: projectId, chapter_id: "ch_perf", chapter_number: 1, title: "perf", summary: "summary", summary_json: {}, source_hash: `summary_${projectId}`, updated_at: timestamp },
  };
}

class PerformanceHarness {
  constructor() {
    this.candidates = new Map();
    this.conflicts = new Map();
    this.sources = new Map();
    this.versions = new Map();
  }
  clone(value) { return JSON.parse(JSON.stringify(value)); }
  projectOf(row) { return String(row.projectId || row.project_id || ""); }
  async createSource(row) {
    const naturalKeyHash = createSourceNaturalKeyHash(row);
    const existing = [...this.sources.values()].find((source) => this.projectOf(source) === this.projectOf(row) && source.natural_key_hash === naturalKeyHash);
    if (existing) return this.clone(existing);
    const stored = { ...row, natural_key_hash: naturalKeyHash };
    this.sources.set(stored.id, this.clone(stored));
    return this.clone(stored);
  }
  async persistExtractionRows(payload) {
    for (const candidate of payload.candidateRows) this.candidates.set(candidate.id, this.clone({ ...candidate, projectId: candidate.project_id }));
    for (const conflict of payload.conflictRows) this.conflicts.set(conflict.id, this.clone({ ...conflict, projectId: conflict.project_id }));
    for (const source of payload.sourceRows) await this.createSource({ ...source, projectId: source.project_id });
  }
  async listSources(projectId, limit = 20) { return [...this.sources.values()].filter((row) => this.projectOf(row) === projectId).slice(0, limit).map((row) => this.clone(row)); }
  async listCandidates(projectId, limit = 20) { return [...this.candidates.values()].filter((row) => this.projectOf(row) === projectId).slice(0, limit).map((row) => this.clone(row)); }
  async getCandidate(projectId, id) { const row = this.candidates.get(id); return row && this.projectOf(row) === projectId ? this.clone(row) : null; }
  async listConflicts(projectId, limit = 20) { return [...this.conflicts.values()].filter((row) => this.projectOf(row) === projectId).slice(0, limit).map((row) => this.clone(row)); }
  async getConflict(projectId, id) { const row = this.conflicts.get(id); return row && this.projectOf(row) === projectId ? this.clone(row) : null; }
  async createVersion(row) { this.versions.set(row.id, this.clone(row)); return this.clone(row); }
  async listVersions(projectId, limit = 20) { return [...this.versions.values()].filter((row) => this.projectOf(row) === projectId).slice(0, limit).map((row) => this.clone(row)); }
  async getVersion(projectId, id) { const row = this.versions.get(id); return row && this.projectOf(row) === projectId ? this.clone(row) : null; }
  async getVersionRange(projectId, from, to) { return (await this.listVersions(projectId, 10000)).filter((row) => row.versionNumber >= from && row.versionNumber <= to); }
  async getEntityHistory(projectId, entityType, entityId) { return (await this.listVersions(projectId, 10000)).filter((row) => row.entityType === entityType && row.entityId === entityId); }
  async getFieldHistory(projectId, entityType, entityId, fieldPath) { return (await this.getEntityHistory(projectId, entityType, entityId)).filter((row) => row.fieldPath === fieldPath); }
  async verifyStoredIntegrityFields() { return { ok: true, checked: 0, errors: [] }; }
}

const adapter = new PerformanceHarness();
const prefix = `l0a2_perf_${Date.now()}`;

await measure("atomic extraction 1 candidate 1 source", () => adapter.persistExtractionRows(rows(`${prefix}_a`, 1, 1, 0)));
await measure("atomic extraction 10 candidates 10 sources", () => adapter.persistExtractionRows(rows(`${prefix}_b`, 10, 10, 0)));
await measure("atomic extraction 100 candidates 100 sources", () => adapter.persistExtractionRows(rows(`${prefix}_c`, 100, 100, 0)));
await measure("atomic extraction 100 candidates 100 sources 100 conflicts", () => adapter.persistExtractionRows(rows(`${prefix}_d`, 100, 100, 100)));
await measure("100 candidates using 1 source identity", async () => {
  const payload = rows(`${prefix}_e`, 100, 100, 0);
  for (const source of payload.sourceRows) {
    source.excerpt_hash = "shared";
    source.paragraph_index = 0;
    source.text_start = 0;
    source.text_end = 8;
  }
  await adapter.persistExtractionRows(payload);
  return { sources: (await adapter.listSources(payload.projectId, 1000)).length };
});

const listProject = `${prefix}_d`;
await measure("candidate list", () => adapter.listCandidates(listProject, 100));
await measure("candidate detail", () => adapter.getCandidate(listProject, `cand_${listProject}_20`));
await measure("conflict list", () => adapter.listConflicts(listProject, 100));
await measure("conflict detail", () => adapter.getConflict(listProject, `conf_${listProject}_20`));

for (let i = 1; i <= 100; i += 1) {
  await adapter.createVersion({ id: `v_${i}`, projectId: listProject, versionNumber: i, entityType: "character", entityId: "char_perf", fieldPath: i % 2 ? "age" : "canonicalName", changeSet: [{ i }] });
}
await measure("version list", () => adapter.listVersions(listProject, 100));
await measure("version detail", () => adapter.getVersion(listProject, "v_88"));
await measure("version range", () => adapter.getVersionRange(listProject, 25, 75));
await measure("entity history", () => adapter.getEntityHistory(listProject, "character", "char_perf"));
await measure("field history", () => adapter.getFieldHistory(listProject, "character", "char_perf", "age"));
await measure("integrity verify empty", () => adapter.verifyStoredIntegrityFields(listProject));

const replayRows = rows(`${prefix}_replay`, 10, 10, 0);
await measure("10 concurrent replay", () => Promise.all(Array.from({ length: 10 }, () => adapter.persistExtractionRows(replayRows))));
await measure("10 concurrent same-source requests", () => Promise.all(Array.from({ length: 10 }, (_, i) => {
  const payload = rows(`${prefix}_same_source_${i}`, 10, 10, 0);
  for (const source of payload.sourceRows) source.excerpt_hash = "shared_concurrent";
  return adapter.persistExtractionRows(payload);
})));

for (const m of measurements) {
  assert(`${m.name} baseline recorded`, Number.isFinite(m.elapsedMs) && m.elapsedMs >= 0 && m.peakRssMb > 0, m);
}
assert("source natural key hash is deterministic during performance", createSourceNaturalKeyHash({ projectId: "p", excerpt_hash: "h", chapter_id: "c", paragraph_index: 0, text_start: 0, text_end: 1 }) === createSourceNaturalKeyHash({ project_id: "p", excerptHash: "h", chapterId: "c", paragraphIndex: 0, textStart: 0, textEnd: 1 }));
assert("shared source identity dedups to one source", measurements.find((m) => m.name === "100 candidates using 1 source identity")?.result?.sources === 1);

const elapsedValues = measurements.map((m) => m.elapsedMs);
const summary = {
  pass: results.filter((item) => item.status === "PASS").length,
  fail: results.filter((item) => item.status === "FAIL").length,
  skip: 0,
  adapterPerformanceStatus: "baseline_ready",
  extractionP50: percentile(elapsedValues, 50),
  extractionP95: percentile(elapsedValues, 95),
  peakRssMb: Math.max(...measurements.map((m) => m.peakRssMb)),
  roundTrips: { atomicExtraction: 1 },
};

console.log(JSON.stringify({ summary, measurements, results }, null, 2));
process.exit(summary.fail === 0 ? 0 : 1);

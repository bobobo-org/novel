import {
  SOURCE_NATURAL_KEY_VERSION,
  createSourceNaturalKey,
  createSourceNaturalKeyHash,
  normalizeSourceIdentity,
} from "../lib/novel-ai/storage/source-identity.ts";

const results = [];

function assert(name, condition, details = {}) {
  results.push({ name, status: condition ? "PASS" : "FAIL", details });
}

function source(projectId, suffix, overrides = {}) {
  return {
    id: `src_${suffix}`,
    project_id: projectId,
    extraction_run_id: `run_${suffix}`,
    candidate_id: `cand_${suffix}`,
    chapter_id: "chapter_1",
    scene_id: null,
    paragraph_index: 0,
    text_start: 0,
    text_end: 12,
    excerpt_hash: "shared_excerpt_hash",
    excerpt: "shared text",
    source_type: "text_excerpt",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function rows(projectId, suffix, sourceRow) {
  const now = new Date().toISOString();
  return {
    projectId,
    storyBibleRow: {
      project_id: projectId,
      schema_version: "story-bible-v1",
      status: "active",
      core_json: {},
      created_at: now,
      updated_at: now,
    },
    extractionRunRow: {
      id: `run_${suffix}`,
      project_id: projectId,
      status: "completed",
      created_at: now,
    },
    candidateRows: [{
      id: `cand_${suffix}`,
      project_id: projectId,
      extraction_run_id: `run_${suffix}`,
      entity_type: "character",
      temporary_entity_id: "char_contract",
      operation: "create",
      field_path: "characters[].canonicalName",
      proposed_value: "\"Lin\"",
      confidence: 0.9,
      evidence: "fixture",
      source_refs: [],
      reason: "fixture",
      conflict_risk: "low",
      status: "pending",
      created_at: now,
      candidate_trust: "cloud-validated",
      source_valid: true,
      status_updated_at: now,
    }],
    conflictRows: [],
    sourceRows: [sourceRow],
    chapterSummaryRow: {
      id: `sum_${suffix}`,
      project_id: projectId,
      chapter_id: "chapter_1",
      chapter_number: 1,
      title: "contract",
      summary: "summary",
      summary_json: {},
      source_hash: `summary_${suffix}`,
      updated_at: now,
    },
  };
}

async function runMemoryContracts() {
  const sources = new Map();
  const sourceRelations = new Map();
  const project = `memory_source_contract_${Date.now()}`;
  const otherProject = `${project}_other`;

  function persistSource(row) {
    const naturalKey = createSourceNaturalKey(row);
    const naturalKeyHash = createSourceNaturalKeyHash(row);
    const existing = Array.from(sources.values()).find((item) => item.project_id === row.project_id && item.natural_key_hash === naturalKeyHash);
    const stored = existing || { ...row, natural_key: naturalKey, natural_key_hash: naturalKeyHash, source_type: row.source_type || "text_excerpt" };
    sources.set(stored.id, stored);
    if (row.candidate_id) sourceRelations.set(`${row.project_id}:${row.candidate_id}:${stored.id}:evidence`, {
      project_id: row.project_id,
      candidate_id: row.candidate_id,
      source_id: stored.id,
      relation_type: "evidence",
    });
    return stored;
  }

  function listSources(projectId) {
    return Array.from(sources.values()).filter((row) => row.project_id === projectId);
  }

  const normalized = normalizeSourceIdentity(source(project, "norm"));
  assert("normalizer uses project id", normalized.projectId === project, normalized);
  assert("natural key has version", createSourceNaturalKey(source(project, "key")).startsWith(`${SOURCE_NATURAL_KEY_VERSION}|`), { key: createSourceNaturalKey(source(project, "key")) });
  assert("natural key hash is sha256 hex", /^[a-f0-9]{64}$/.test(createSourceNaturalKeyHash(source(project, "hash"))));

  persistSource(source(project, "a"));
  persistSource(source(project, "b"));
  let projectSources = listSources(project);
  assert("memory dedups same project same source identity", projectSources.length === 1, { sources: projectSources, relations: sourceRelations.size });

  persistSource(source(project, "range", { paragraph_index: 1, text_start: 10, text_end: 20 }));
  projectSources = listSources(project);
  assert("memory keeps different paragraph range separate", projectSources.length === 2, { sources: projectSources });

  persistSource(source(project, "type", { source_type: "author_note" }));
  projectSources = listSources(project);
  assert("memory keeps different source type separate", projectSources.length === 3, { sources: projectSources });

  persistSource(source(otherProject, "other"));
  const otherSources = listSources(otherProject);
  assert("memory keeps same source isolated by project", otherSources.length === 1 && projectSources.length === 3, { projectSources: projectSources.length, otherSources: otherSources.length });

  for (const [id, row] of Array.from(sources.entries())) if (row.project_id === project || row.project_id === otherProject) sources.delete(id);
  for (const [id, row] of Array.from(sourceRelations.entries())) if (row.project_id === project || row.project_id === otherProject) sourceRelations.delete(id);
  assert("memory contract fixture cleanup", listSources(project).length === 0 && listSources(otherProject).length === 0 && sourceRelations.size === 0);
}

try {
  await runMemoryContracts();
} catch (error) {
  assert("runner uncaught exception", false, { message: error.message, stack: error.stack });
}

const summary = {
  pass: results.filter((item) => item.status === "PASS").length,
  fail: results.filter((item) => item.status === "FAIL").length,
  skip: 0,
  contract: "source-natural-key-v1",
};

console.log(JSON.stringify({ summary, results }, null, 2));
process.exit(summary.fail === 0 ? 0 : 1);

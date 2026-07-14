const baseUrl = process.env.BASE_URL || "https://novel-orcin.vercel.app";
const expectedReleaseTag = process.env.EXPECTED_RELEASE_TAG || "novel-ai-l0a2e2-source-natural-key-contract";
const requiredMigration = "p0_l0a2e2_project_source_natural_key_015";
const supabaseToken = process.env.SUPABASE_MANAGEMENT_TOKEN || "";
const supabaseRef = process.env.SUPABASE_PROJECT_REF || "ijjicaiiirkfbewbhepx";
const prefix = `l0a2e_source_dedup_${Date.now()}_`;
const results = [];
const timings = [];

function assert(name, condition, details = {}) {
  results.push({ name, status: condition ? "PASS" : "FAIL", details });
}

function esc(value) {
  return String(value ?? "").replace(/'/g, "''");
}

async function sql(query, expectOk = true) {
  if (!supabaseToken) throw new Error("SUPABASE_MANAGEMENT_TOKEN missing");
  const started = Date.now();
  const res = await fetch(`https://api.supabase.com/v1/projects/${supabaseRef}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${supabaseToken}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  timings.push(Date.now() - started);
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (expectOk && !res.ok) throw new Error(`SQL_${res.status}:${text.slice(0, 800)}`);
  return { ok: res.ok, status: res.status, body };
}

async function health() {
  const res = await fetch(`${baseUrl}/api/ai/health?sourceDedup=${Date.now()}`, { headers: { "cache-control": "no-cache" } });
  const body = await res.json();
  return { ok: res.ok, status: res.status, cacheControl: res.headers.get("cache-control"), body };
}

function candidateRow(project, run, candidateId, now) {
  return {
    id: candidateId,
    project_id: project,
    extraction_run_id: run,
    entity_type: "character",
    entity_id: null,
    temporary_entity_id: "char_source_contract",
    operation: "create",
    field_path: "characters[].canonicalName",
    previous_value: null,
    proposed_value: "\"Lin Zhao\"",
    confidence: 0.9,
    evidence: "fixture",
    source_refs: [],
    reason: "fixture",
    conflict_risk: "low",
    status: "pending",
    created_at: now,
    reviewed_at: null,
    previous_status: null,
    reviewer_id: null,
    review_reason: null,
    request_id: null,
    source_version_id: null,
    based_on_version_id: null,
    based_on_version_number: null,
    candidate_trust: "cloud-validated",
    source_valid: true,
    status_updated_at: now,
  };
}

function payload({ project, suffix, requestId, sourceHash = "same_hash", chapterId = "chapter_1", paragraphIndex = 0, textStart = 0, textEnd = 12, sourceType = "text_excerpt" }) {
  const now = new Date().toISOString();
  const run = `run_${suffix}`;
  const candidateId = `cand_${suffix}`;
  return {
    projectId: project,
    requestId: requestId || `req_${suffix}`,
    storyBibleRow: {
      project_id: project,
      schema_version: "story-bible-v1",
      status: "active",
      core_json: { fixture: "source-dedup" },
      created_at: now,
      updated_at: now,
    },
    extractionRunRow: {
      id: run,
      project_id: project,
      chapter_id: chapterId,
      chapter_number: 1,
      extraction_mode: "chapter-new",
      schema_version: "story-bible-v1",
      prompt_version: "source-dedup-fixture",
      model_id: "fixture",
      fallback_level: "fixture",
      status: "completed",
      confidence: 0.9,
      warnings: [],
      input_hash: `hash_${suffix}`,
      output_json: {},
      error_code: null,
      created_at: now,
    },
    candidateRows: [candidateRow(project, run, candidateId, now)],
    conflictRows: [],
    sourceRows: [{
      id: `src_${suffix}`,
      project_id: project,
      extraction_run_id: run,
      candidate_id: candidateId,
      chapter_id: chapterId,
      scene_id: null,
      paragraph_index: paragraphIndex,
      text_start: textStart,
      text_end: textEnd,
      excerpt_hash: sourceHash,
      excerpt: "shared text",
      source_type: sourceType,
      created_at: now,
    }],
    chapterSummaryRow: {
      id: `sum_${suffix}`,
      project_id: project,
      chapter_id: chapterId,
      chapter_number: 1,
      title: "source dedup fixture",
      summary: "fixture summary",
      summary_json: {},
      source_hash: `summary_${suffix}`,
      updated_at: now,
    },
  };
}

function rpcSql(body) {
  return `select public.persist_story_bible_extraction_atomic('${esc(JSON.stringify(body))}'::jsonb) as result`;
}

function cleanupSql() {
  return `
delete from public.story_fact_candidate_sources where project_id like '${prefix}%';
delete from public.story_fact_sources where project_id like '${prefix}%';
delete from public.story_fact_conflicts where project_id like '${prefix}%';
delete from public.story_fact_candidates where project_id like '${prefix}%';
delete from public.story_chapter_summaries where project_id like '${prefix}%';
delete from public.story_bible_extraction_runs where project_id like '${prefix}%';
delete from public.story_bible_extraction_requests where project_id like '${prefix}%';
delete from public.story_bibles where project_id like '${prefix}%';
`;
}

async function counts(project) {
  const res = await sql(`select
    (select count(*)::int from public.story_bible_extraction_requests where project_id='${project}') as requests,
    (select count(*)::int from public.story_bible_extraction_runs where project_id='${project}') as runs,
    (select count(*)::int from public.story_fact_candidates where project_id='${project}') as candidates,
    (select count(*)::int from public.story_fact_sources where project_id='${project}') as sources,
    (select count(*)::int from public.story_fact_candidate_sources where project_id='${project}') as source_relations,
    (select count(distinct natural_key_hash)::int from public.story_fact_sources where project_id='${project}') as natural_keys,
    (select count(*)::int from public.story_chapter_summaries where project_id='${project}') as summaries`);
  return res.body[0];
}

async function runRpc(body) {
  const res = await sql(rpcSql(body));
  return res.body?.[0]?.result || {};
}

async function sameProjectSameIdentity() {
  const project = `${prefix}same_identity`;
  const a = await runRpc(payload({ project, suffix: "same_a", requestId: "req_same_a" }));
  const b = await runRpc(payload({ project, suffix: "same_b", requestId: "req_same_b" }));
  const rowCounts = await counts(project);
  assert("same project same identity reuses one source", rowCounts.sources === 1 && rowCounts.source_relations === 2 && rowCounts.natural_keys === 1, { rowCounts, a, b });
  assert("rpc reports reused source on second write", Number(b.createdCounts?.reusedSources || 0) >= 1, b.createdCounts);
}

async function concurrentSameIdentity(count) {
  const project = `${prefix}parallel_${count}`;
  const bodies = Array.from({ length: count }, (_, index) => payload({ project, suffix: `par_${index}`, requestId: `req_par_${index}` }));
  const calls = await Promise.allSettled(bodies.map(runRpc));
  const ok = calls.filter((call) => call.status === "fulfilled").length;
  const rowCounts = await counts(project);
  assert(`${count} concurrent same identity rows collapse`, ok === count && rowCounts.sources === 1 && rowCounts.source_relations === count && rowCounts.requests === count, { ok, rowCounts });
}

async function variantsStaySeparate() {
  const project = `${prefix}variants`;
  await runRpc(payload({ project, suffix: "base", requestId: "req_base" }));
  await runRpc(payload({ project, suffix: "range", requestId: "req_range", paragraphIndex: 1, textStart: 20, textEnd: 32 }));
  await runRpc(payload({ project, suffix: "type", requestId: "req_type", sourceType: "author_note" }));
  const rowCounts = await counts(project);
  assert("different range/source type stay separate", rowCounts.sources === 3 && rowCounts.source_relations === 3 && rowCounts.natural_keys === 3, rowCounts);
}

async function crossProjectIsolation() {
  const a = `${prefix}cross_a`;
  const b = `${prefix}cross_b`;
  await runRpc(payload({ project: a, suffix: "cross_a", requestId: "req_cross_a" }));
  await runRpc(payload({ project: b, suffix: "cross_b", requestId: "req_cross_b" }));
  const ca = await counts(a);
  const cb = await counts(b);
  assert("same identity is isolated by project", ca.sources === 1 && cb.sources === 1 && ca.source_relations === 1 && cb.source_relations === 1, { ca, cb });
}

async function idempotentReplayDoesNotDuplicateRelation() {
  const project = `${prefix}replay`;
  const body = payload({ project, suffix: "replay", requestId: "req_replay" });
  const a = await runRpc(body);
  const b = await runRpc(body);
  const rowCounts = await counts(project);
  assert("same request replay does not duplicate source relation", rowCounts.requests === 1 && rowCounts.sources === 1 && rowCounts.source_relations === 1 && b.idempotentReplay === true, { a, b, rowCounts });
}

async function run() {
  await sql(cleanupSql());
  const h = await health();
  assert("health source dedup version", h.ok
    && h.cacheControl === "no-store, max-age=0"
    && h.body.releaseTag === expectedReleaseTag
    && String(h.body.migrationVersion || "").includes(requiredMigration)
    && h.body.extractionSourceDedupStatus === "ready"
    && h.body.sourceNaturalKeyVersion === "source-natural-key-v1"
    && h.body.sourceDedupScope === "project", h.body);

  await sameProjectSameIdentity();
  await concurrentSameIdentity(10);
  await variantsStaySeparate();
  await crossProjectIsolation();
  await idempotentReplayDoesNotDuplicateRelation();

  await sql(cleanupSql());
  const remaining = await sql(`select
    (select count(*)::int from public.story_bibles where project_id like '${prefix}%') as bibles,
    (select count(*)::int from public.story_bible_extraction_requests where project_id like '${prefix}%') as requests,
    (select count(*)::int from public.story_bible_extraction_runs where project_id like '${prefix}%') as runs,
    (select count(*)::int from public.story_fact_sources where project_id like '${prefix}%') as sources,
    (select count(*)::int from public.story_fact_candidate_sources where project_id like '${prefix}%') as source_relations,
    (select count(*)::int from public.story_fact_candidates where project_id like '${prefix}%') as candidates,
    (select count(*)::int from public.story_chapter_summaries where project_id like '${prefix}%') as summaries`);
  assert("source dedup fixture cleanup", Object.values(remaining.body[0]).every((value) => Number(value) === 0), remaining.body[0]);
}

try {
  await run();
} catch (error) {
  assert("runner uncaught exception", false, { message: error.message, stack: error.stack });
  await sql(cleanupSql()).catch(() => undefined);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const summary = {
  baseUrl,
  prefix,
  pass: results.filter((item) => item.status === "PASS").length,
  fail: results.filter((item) => item.status === "FAIL").length,
  skip: 0,
  sqlP50: percentile(timings, 50),
  sqlP95: percentile(timings, 95),
};

console.log(JSON.stringify({ summary, results }, null, 2));
process.exit(summary.fail === 0 ? 0 : 1);

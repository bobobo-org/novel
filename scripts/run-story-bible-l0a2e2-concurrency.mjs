const baseUrl = process.env.BASE_URL || "https://novel-orcin.vercel.app";
const expectedReleaseTag = process.env.EXPECTED_RELEASE_TAG || "novel-ai-l0a2e2-rollback-fixture-contract";
const requiredMigration = "p0_l0a2e2_rollback_fixture_contract_014";
const supabaseToken = process.env.SUPABASE_MANAGEMENT_TOKEN || "";
const supabaseRef = process.env.SUPABASE_PROJECT_REF || "ijjicaiiirkfbewbhepx";
const prefix = `l0a2e_concurrency_${Date.now()}_`;
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
  timings.push({ kind: "sql", elapsedMs: Date.now() - started, status: res.status });
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (expectOk && !res.ok) throw new Error(`SQL_${res.status}:${text.slice(0, 800)}`);
  return { ok: res.ok, status: res.status, body };
}

async function health() {
  const started = Date.now();
  const res = await fetch(`${baseUrl}/api/ai/health?concurrency=${Date.now()}`, { headers: { "cache-control": "no-cache" } });
  const body = await res.json();
  timings.push({ kind: "http", elapsedMs: Date.now() - started, status: res.status });
  return { ok: res.ok, status: res.status, cacheControl: res.headers.get("cache-control"), body };
}

function candidateRow(project, run, candidateId, now) {
  return {
    id: candidateId,
    project_id: project,
    extraction_run_id: run,
    entity_type: "character",
    entity_id: null,
    temporary_entity_id: "char_concurrent",
    operation: "create",
    field_path: "characters[].canonicalName",
    previous_value: null,
    proposed_value: "\"林昭\"",
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

function payload({ project, suffix, requestId, sourceHash = "shared_hash", chapterId = "shared_chapter", changed = false }) {
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
      core_json: { fixture: true, changed },
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
      prompt_version: "concurrency-fixture",
      model_id: "fixture",
      fallback_level: "fixture",
      status: "completed",
      confidence: 0.9,
      warnings: [],
      input_hash: `hash_${suffix}_${changed ? "changed" : "same"}`,
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
      candidate_id: null,
      chapter_id: chapterId,
      scene_id: null,
      paragraph_index: 0,
      text_start: 0,
      text_end: 2,
      excerpt_hash: sourceHash,
      excerpt: "林昭",
      created_at: now,
    }],
    chapterSummaryRow: {
      id: `sum_${suffix}`,
      project_id: project,
      chapter_id: chapterId,
      chapter_number: 1,
      title: "concurrency fixture",
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
    (select count(*)::int from public.story_chapter_summaries where project_id='${project}') as summaries`);
  return res.body[0];
}

async function parallelSameRequest(count) {
  const project = `${prefix}same_${count}`;
  const body = payload({ project, suffix: `same_${count}`, requestId: `req_same_${count}` });
  const calls = await Promise.allSettled(Array.from({ length: count }, () => sql(rpcSql(body), false)));
  const ok = calls.filter((call) => call.status === "fulfilled" && call.value.ok).length;
  const rowCounts = await counts(project);
  assert(`${count} parallel same requestId same payload`, ok === count && rowCounts.requests === 1 && rowCounts.runs === 1 && rowCounts.candidates === 1 && rowCounts.sources === 1 && rowCounts.summaries === 1, { ok, rowCounts });
}

async function parallelSameRequestDifferentPayload() {
  const project = `${prefix}payload_conflict`;
  const requestId = "req_payload_conflict";
  const a = payload({ project, suffix: "conflict_a", requestId });
  const b = payload({ project, suffix: "conflict_b", requestId, changed: true });
  const calls = await Promise.allSettled([sql(rpcSql(a), false), sql(rpcSql(b), false)]);
  const ok = calls.filter((call) => call.status === "fulfilled" && call.value.ok).length;
  const blocked = calls.filter((call) => call.status === "fulfilled" && !call.value.ok).length;
  const rowCounts = await counts(project);
  assert("2 parallel same requestId different payload", ok === 1 && blocked === 1 && rowCounts.requests === 1 && rowCounts.runs === 1, { ok, blocked, rowCounts, calls });
}

async function parallelDifferentRequestsSameSource(count) {
  const project = `${prefix}source_${count}`;
  const bodies = Array.from({ length: count }, (_, index) => payload({
    project,
    suffix: `src_${index}`,
    requestId: `req_src_${index}`,
    sourceHash: "same_source_hash",
    chapterId: "same_chapter",
  }));
  const calls = await Promise.allSettled(bodies.map((body) => sql(rpcSql(body), false)));
  const ok = calls.filter((call) => call.status === "fulfilled" && call.value.ok).length;
  const rowCounts = await counts(project);
  assert(`${count} parallel different requestIds same source identity`, ok === count && rowCounts.requests === count && rowCounts.runs === count && rowCounts.candidates === count && rowCounts.summaries === 1, { ok, rowCounts });
}

async function parallelSameChapter(count) {
  const project = `${prefix}chapter_${count}`;
  const bodies = Array.from({ length: count }, (_, index) => payload({
    project,
    suffix: `chapter_${index}`,
    requestId: `req_chapter_${index}`,
    sourceHash: `chapter_source_${index}`,
    chapterId: "same_chapter",
  }));
  const calls = await Promise.allSettled(bodies.map((body) => sql(rpcSql(body), false)));
  const ok = calls.filter((call) => call.status === "fulfilled" && call.value.ok).length;
  const rowCounts = await counts(project);
  assert(`${count} parallel same chapter extractions`, ok === count && rowCounts.requests === count && rowCounts.runs === count && rowCounts.candidates === count && rowCounts.summaries === 1, { ok, rowCounts });
}

async function crossProjectSameSourceHash() {
  const projects = [`${prefix}cross_a`, `${prefix}cross_b`];
  const bodies = projects.map((project, index) => payload({
    project,
    suffix: `cross_${index}`,
    requestId: `req_cross_${index}`,
    sourceHash: "cross_project_same_hash",
    chapterId: "same_chapter",
  }));
  const calls = await Promise.allSettled(bodies.map((body) => sql(rpcSql(body), false)));
  const ok = calls.filter((call) => call.status === "fulfilled" && call.value.ok).length;
  const countRows = await Promise.all(projects.map((project) => counts(project)));
  assert("cross-project same source hash stays isolated", ok === 2 && countRows.every((row) => row.requests === 1 && row.sources === 1), { ok, countRows });
}

async function concurrentReadDuringExtraction() {
  const project = `${prefix}read`;
  const body = payload({ project, suffix: "read", requestId: "req_read" });
  const [write, read] = await Promise.allSettled([
    sql(rpcSql(body), false),
    fetch(`${baseUrl}/api/story-bible/candidates?projectId=${encodeURIComponent(project)}&limit=5`).then(async (res) => ({ ok: res.ok, status: res.status, body: await res.json().catch(() => null) })),
  ]);
  assert("concurrent extraction and candidate read", write.status === "fulfilled" && write.value.ok && read.status === "fulfilled" && [200, 404].includes(read.value.status), { write, read });
}

async function run() {
  await sql(cleanupSql());
  const h = await health();
  assert("health version before concurrency", h.ok
    && h.cacheControl === "no-store, max-age=0"
    && h.body.releaseTag === expectedReleaseTag
    && String(h.body.migrationVersion || "").includes(requiredMigration), h.body);

  await parallelSameRequest(2);
  await parallelSameRequest(10);
  await parallelSameRequestDifferentPayload();
  await parallelDifferentRequestsSameSource(10);
  await parallelSameChapter(10);
  await crossProjectSameSourceHash();
  await concurrentReadDuringExtraction();

  const statusRows = await sql(`select status, count(*)::int from public.story_bible_extraction_requests where project_id like '${prefix}%' group by status order by status`);
  assert("no processing rows remain", !statusRows.body.some((row) => row.status === "processing"), statusRows.body);
  await sql(cleanupSql());
  const remaining = await sql(`select
    (select count(*)::int from public.story_bibles where project_id like '${prefix}%') as bibles,
    (select count(*)::int from public.story_bible_extraction_requests where project_id like '${prefix}%') as requests,
    (select count(*)::int from public.story_bible_extraction_runs where project_id like '${prefix}%') as runs,
    (select count(*)::int from public.story_fact_sources where project_id like '${prefix}%') as sources,
    (select count(*)::int from public.story_fact_candidates where project_id like '${prefix}%') as candidates,
    (select count(*)::int from public.story_chapter_summaries where project_id like '${prefix}%') as summaries`);
  assert("concurrency fixture cleanup", Object.values(remaining.body[0]).every((value) => Number(value) === 0), remaining.body[0]);
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

const sqlTimes = timings.filter((item) => item.kind === "sql").map((item) => item.elapsedMs);
const httpTimes = timings.filter((item) => item.kind === "http").map((item) => item.elapsedMs);
const summary = {
  baseUrl,
  prefix,
  pass: results.filter((item) => item.status === "PASS").length,
  fail: results.filter((item) => item.status === "FAIL").length,
  skip: 0,
  maxConcurrentRequestsTested: 10,
  sqlP50: percentile(sqlTimes, 50),
  sqlP95: percentile(sqlTimes, 95),
  httpP50: percentile(httpTimes, 50),
  httpP95: percentile(httpTimes, 95),
};

console.log(JSON.stringify({ summary, results }, null, 2));
process.exit(summary.fail === 0 ? 0 : 1);

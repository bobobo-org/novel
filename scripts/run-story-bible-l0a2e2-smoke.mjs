const baseUrl = process.env.BASE_URL || "https://novel-orcin.vercel.app";
const deploymentUrl = process.env.EXPECTED_DEPLOYMENT_URL || "";
const expectedReleaseTag = process.env.EXPECTED_RELEASE_TAG || "novel-ai-l0a2e2-rollback-fixture-contract";
const expectedMigration = "p0_l0a2e2_rollback_fixture_contract_014";
const supabaseToken = process.env.SUPABASE_MANAGEMENT_TOKEN || "";
const supabaseRef = process.env.SUPABASE_PROJECT_REF || "ijjicaiiirkfbewbhepx";
const projectPrefix = `l0a2e_fault_${Date.now()}_`;
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

async function request(url) {
  const started = Date.now();
  const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
  const body = await res.json().catch(async () => ({ raw: await res.text() }));
  timings.push({ kind: "http", elapsedMs: Date.now() - started, status: res.status });
  return {
    ok: res.ok,
    status: res.status,
    cacheControl: res.headers.get("cache-control"),
    vercelCache: res.headers.get("x-vercel-cache"),
    body,
  };
}

function candidateRow(project, run, candidateId, now) {
  return {
    id: candidateId,
    project_id: project,
    extraction_run_id: run,
    entity_type: "character",
    entity_id: null,
    temporary_entity_id: "char_fixture",
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

function payload(project, suffix) {
  const now = new Date().toISOString();
  const run = `run_${suffix}`;
  const candidateId = `cand_${suffix}`;
  return {
    projectId: project,
    requestId: `req_${suffix}`,
    storyBibleRow: {
      project_id: project,
      schema_version: "story-bible-v1",
      status: "active",
      core_json: { fixture: true },
      created_at: now,
      updated_at: now,
    },
    extractionRunRow: {
      id: run,
      project_id: project,
      chapter_id: `ch_${suffix}`,
      chapter_number: 1,
      extraction_mode: "chapter-new",
      schema_version: "story-bible-v1",
      prompt_version: "fixture",
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
    conflictRows: [{
      id: `conf_${suffix}`,
      project_id: project,
      extraction_run_id: run,
      candidate_id: candidateId,
      severity: "warning",
      conflict_type: "fixture-conflict",
      canonical_entity_type: "character",
      canonical_entity_id: "char_fixture",
      field_path: "characters[].canonicalName",
      canonical_fact: {},
      candidate_fact: { value: "fixture" },
      source_refs: [],
      explanation: "fixture",
      suggested_resolution: "review",
      auto_resolvable: false,
      confidence: 0.5,
      status: "open",
      created_at: now,
    }],
    sourceRows: [{
      id: `src_${suffix}`,
      project_id: project,
      extraction_run_id: run,
      candidate_id: null,
      chapter_id: `ch_${suffix}`,
      scene_id: null,
      paragraph_index: 0,
      text_start: 0,
      text_end: 2,
      excerpt_hash: `hash_src_${suffix}`,
      excerpt: "林昭",
      created_at: now,
    }],
    chapterSummaryRow: {
      id: `sum_${suffix}`,
      project_id: project,
      chapter_id: `ch_${suffix}`,
      chapter_number: 1,
      title: "fixture",
      summary: "fixture summary",
      summary_json: {},
      source_hash: `sumhash_${suffix}`,
      updated_at: now,
    },
  };
}

function cleanupSql() {
  return `
delete from public.story_fact_sources where project_id like '${projectPrefix}%';
delete from public.story_fact_conflicts where project_id like '${projectPrefix}%';
delete from public.story_fact_candidates where project_id like '${projectPrefix}%';
delete from public.story_chapter_summaries where project_id like '${projectPrefix}%';
delete from public.story_bible_extraction_runs where project_id like '${projectPrefix}%';
delete from public.story_bible_extraction_requests where project_id like '${projectPrefix}%';
delete from public.story_bibles where project_id like '${projectPrefix}%';
`;
}

async function countRows(project) {
  const rows = await sql(`select
    (select count(*) from public.story_bibles where project_id='${project}') as bibles,
    (select count(*) from public.story_bible_extraction_requests where project_id='${project}') as requests,
    (select count(*) from public.story_bible_extraction_runs where project_id='${project}') as runs,
    (select count(*) from public.story_fact_sources where project_id='${project}') as sources,
    (select count(*) from public.story_fact_candidates where project_id='${project}') as candidates,
    (select count(*) from public.story_fact_conflicts where project_id='${project}') as conflicts,
    (select count(*) from public.story_chapter_summaries where project_id='${project}') as summaries`);
  return rows.body[0];
}

async function runHealthChecks() {
  const urls = [
    `${baseUrl}/api/ai/health`,
    `${baseUrl}/api/ai/health?verify=1`,
    `${baseUrl}/api/ai/health?ts=${Date.now()}`,
  ];
  if (deploymentUrl) urls.push(`${deploymentUrl.replace(/\/$/, "")}/api/ai/health`);
  for (const url of urls) {
    const res = await request(url);
    const body = res.body;
    assert(`health ${url}`, res.ok
      && res.cacheControl === "no-store, max-age=0"
      && body.releaseTag === expectedReleaseTag
      && String(body.migrationVersion || "").includes(expectedMigration)
      && body.extractionRollbackMatrixStatus === "fault_fixture_ready"
      && body.extractionFaultInjectionStatus === "service_role_fixture_only"
      && body.extractionConcurrencyStatus === "partial", {
      status: res.status,
      cacheControl: res.cacheControl,
      appCommit: body.appCommit,
      deploymentId: body.deploymentId,
      releaseTag: body.releaseTag,
      migrationVersion: body.migrationVersion,
      extractionRollbackMatrixStatus: body.extractionRollbackMatrixStatus,
      extractionFaultInjectionStatus: body.extractionFaultInjectionStatus,
      extractionConcurrencyStatus: body.extractionConcurrencyStatus,
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function runRollbackFixture() {
  const stages = [
    "after_idempotency_lock",
    "after_extraction_run_create",
    "after_source_insert",
    "after_source_dedup",
    "after_candidate_insert",
    "after_candidate_source_link",
    "after_conflict_insert",
    "after_candidate_conflict_link",
    "after_chapter_summary_insert",
    "before_run_complete",
    "after_run_complete",
    "before_return",
  ];
  for (const [index, stage] of stages.entries()) {
    const project = `${projectPrefix}${index}`;
    const body = payload(project, `${index}`);
    const call = await sql(`select public.persist_story_bible_extraction_atomic_fault_fixture('${esc(JSON.stringify(body))}'::jsonb, '${stage}', 'l0a2e-admin-fixture')`, false);
    const counts = await countRows(project);
    const rolledBack = Object.values(counts).every((value) => Number(value) === 0);
    assert(`fault rollback ${stage}`, !call.ok && rolledBack, { status: call.status, counts });
  }
}

async function runIdempotencySmoke() {
  const project = `${projectPrefix}success`;
  const basePayload = payload(project, "success");
  const first = await sql(`select public.persist_story_bible_extraction_atomic('${esc(JSON.stringify(basePayload))}'::jsonb) as result`);
  assert("atomic extraction commit", first.ok && first.body[0]?.result?.transactionStatus === "committed", first.body[0]?.result);
  const replay = await sql(`select public.persist_story_bible_extraction_atomic('${esc(JSON.stringify(basePayload))}'::jsonb) as result`);
  assert("idempotent replay", replay.ok && replay.body[0]?.result?.idempotentReplay === true, replay.body[0]?.result);
  const changed = { ...basePayload, storyBibleRow: { ...basePayload.storyBibleRow, core_json: { fixture: "changed" } } };
  const conflict = await sql(`select public.persist_story_bible_extraction_atomic('${esc(JSON.stringify(changed))}'::jsonb) as result`, false);
  assert("same requestId different payload blocked", !conflict.ok, { status: conflict.status, body: conflict.body });
}

async function main() {
  await sql(cleanupSql());
  await runHealthChecks();
  await runRollbackFixture();
  await runIdempotencySmoke();
  const statusRows = await sql(`select status, count(*)::int from public.story_bible_extraction_requests where project_id like '${projectPrefix}%' group by status order by status`);
  assert("idempotency status row completed", statusRows.body.some((row) => row.status === "completed" && Number(row.count) >= 1), statusRows.body);
  await sql(cleanupSql());
  const remaining = await sql(`select
    (select count(*) from public.story_bibles where project_id like '${projectPrefix}%') as bibles,
    (select count(*) from public.story_bible_extraction_requests where project_id like '${projectPrefix}%') as requests,
    (select count(*) from public.story_bible_extraction_runs where project_id like '${projectPrefix}%') as runs,
    (select count(*) from public.story_fact_sources where project_id like '${projectPrefix}%') as sources,
    (select count(*) from public.story_fact_candidates where project_id like '${projectPrefix}%') as candidates,
    (select count(*) from public.story_fact_conflicts where project_id like '${projectPrefix}%') as conflicts,
    (select count(*) from public.story_chapter_summaries where project_id like '${projectPrefix}%') as summaries`);
  assert("fixture cleanup", Object.values(remaining.body[0]).every((value) => Number(value) === 0), remaining.body[0]);
}

try {
  await main();
} catch (error) {
  assert("runner uncaught exception", false, { message: error.message, stack: error.stack });
  await sql(cleanupSql()).catch(() => undefined);
}

const httpTimings = timings.filter((item) => item.kind === "http").map((item) => item.elapsedMs).sort((a, b) => a - b);
const sqlTimings = timings.filter((item) => item.kind === "sql").map((item) => item.elapsedMs).sort((a, b) => a - b);
function percentile(values, p) {
  if (!values.length) return 0;
  return values[Math.min(values.length - 1, Math.floor((p / 100) * values.length))];
}

const summary = {
  baseUrl,
  deploymentUrl: deploymentUrl || null,
  prefix: projectPrefix,
  pass: results.filter((item) => item.status === "PASS").length,
  fail: results.filter((item) => item.status === "FAIL").length,
  skip: 0,
  httpP50: percentile(httpTimings, 50),
  httpP95: percentile(httpTimings, 95),
  sqlP50: percentile(sqlTimings, 50),
  sqlP95: percentile(sqlTimings, 95),
};

console.log(JSON.stringify({ summary, results }, null, 2));
process.exit(summary.fail === 0 ? 0 : 1);

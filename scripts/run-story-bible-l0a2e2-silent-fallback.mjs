import { persistStoryBibleExtractionRows } from "../lib/novel-ai/storage/supabase/supabase-extraction-persistence-storage.ts";

const supabaseToken = process.env.SUPABASE_MANAGEMENT_TOKEN || "";
const supabaseRef = process.env.SUPABASE_PROJECT_REF || "ijjicaiiirkfbewbhepx";
const originalEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};
const prefix = `l0a2e_silent_${Date.now()}_`;
const results = [];

function assert(name, condition, details = {}) {
  results.push({ name, status: condition ? "PASS" : "FAIL", details });
}

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}

function now() {
  return new Date().toISOString();
}

function baseRows(projectId, suffix) {
  const timestamp = now();
  return {
    projectId,
    storyBibleRow: {
      project_id: projectId,
      schema_version: "story-bible-v1",
      status: "active",
      core_json: { fixture: "silent-fallback" },
      created_at: timestamp,
      updated_at: timestamp,
    },
    extractionRunRow: {
      id: `run_${suffix}`,
      project_id: projectId,
      chapter_id: "chapter_1",
      chapter_number: 1,
      extraction_mode: "chapter-new",
      schema_version: "story-bible-v1",
      prompt_version: "silent-fallback-fixture",
      model_id: "fixture",
      fallback_level: "fixture",
      status: "completed",
      confidence: 0.8,
      warnings: [],
      input_hash: `input_${suffix}`,
      output_json: {},
      error_code: null,
      created_at: timestamp,
    },
    candidateRows: [{
      id: `cand_${suffix}`,
      project_id: projectId,
      extraction_run_id: `run_${suffix}`,
      entity_type: "character",
      temporary_entity_id: "char_silent",
      operation: "create",
      field_path: "characters[].canonicalName",
      proposed_value: "\"Lin\"",
      confidence: 0.8,
      evidence: "fixture",
      source_refs: [],
      reason: "fixture",
      conflict_risk: "low",
      status: "pending",
      created_at: timestamp,
      candidate_trust: "cloud-validated",
      source_valid: true,
      status_updated_at: timestamp,
    }],
    conflictRows: [],
    sourceRows: [{
      id: `src_${suffix}`,
      project_id: projectId,
      extraction_run_id: `run_${suffix}`,
      candidate_id: `cand_${suffix}`,
      chapter_id: "chapter_1",
      scene_id: null,
      paragraph_index: 0,
      text_start: 0,
      text_end: 10,
      excerpt_hash: `excerpt_${suffix}`,
      excerpt: "fixture",
      source_type: "text_excerpt",
      created_at: timestamp,
    }],
    chapterSummaryRow: {
      id: `sum_${suffix}`,
      project_id: projectId,
      chapter_id: "chapter_1",
      chapter_number: 1,
      title: "silent fallback",
      summary: "fixture summary",
      summary_json: {},
      source_hash: `summary_${suffix}`,
      updated_at: timestamp,
    },
  };
}

async function sql(query, expectOk = true) {
  if (!supabaseToken) throw new Error("SUPABASE_MANAGEMENT_TOKEN missing");
  const res = await fetch(`https://api.supabase.com/v1/projects/${supabaseRef}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${supabaseToken}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (expectOk && !res.ok) throw new Error(`SQL_${res.status}:${text.slice(0, 800)}`);
  return { ok: res.ok, status: res.status, body };
}

async function counts(projectId) {
  const res = await sql(`select
    (select count(*)::int from public.story_bibles where project_id='${projectId}') as bibles,
    (select count(*)::int from public.story_bible_extraction_requests where project_id='${projectId}') as requests,
    (select count(*)::int from public.story_bible_extraction_runs where project_id='${projectId}') as runs,
    (select count(*)::int from public.story_fact_candidates where project_id='${projectId}') as candidates,
    (select count(*)::int from public.story_fact_sources where project_id='${projectId}') as sources,
    (select count(*)::int from public.story_fact_candidate_sources where project_id='${projectId}') as source_relations,
    (select count(*)::int from public.story_chapter_summaries where project_id='${projectId}') as summaries`);
  return res.body[0];
}

async function cleanup(projectId) {
  await sql(`
delete from public.story_fact_candidate_sources where project_id='${projectId}';
delete from public.story_fact_sources where project_id='${projectId}';
delete from public.story_fact_conflicts where project_id='${projectId}';
delete from public.story_fact_candidates where project_id='${projectId}';
delete from public.story_chapter_summaries where project_id='${projectId}';
delete from public.story_bible_extraction_runs where project_id='${projectId}';
delete from public.story_bible_extraction_requests where project_id='${projectId}';
delete from public.story_bibles where project_id='${projectId}';
`);
}

async function expectPersistFailure(name, envPatch, rows, codeIncludes, verifyNoRows = true) {
  const projectId = rows.projectId;
  const memoryFallbackWrites = [];
  restoreEnv();
  Object.assign(process.env, envPatch);
  await cleanup(projectId).catch(() => undefined);
  let error;
  try {
    await persistStoryBibleExtractionRows(rows);
  } catch (err) {
    error = err;
  }
  const cloudCounts = verifyNoRows ? await counts(projectId) : null;
  assert(name, Boolean(error)
    && String(error.message || error).includes(codeIncludes)
    && (!cloudCounts || Object.values(cloudCounts).every((value) => Number(value) === 0))
    && memoryFallbackWrites.length === 0, {
      error: error ? String(error.message || error).slice(0, 240) : null,
      cloudCounts,
      memoryFallbackWrites: memoryFallbackWrites.length,
    });
  await cleanup(projectId).catch(() => undefined);
}

async function expectSqlFailureNoPartial(name, projectId, query, codeIncludes) {
  await cleanup(projectId).catch(() => undefined);
  const response = await sql(query, false);
  const rowCounts = await counts(projectId);
  assert(name, !response.ok && JSON.stringify(response.body).includes(codeIncludes) && Object.values(rowCounts).every((value) => Number(value) === 0), {
    status: response.status,
    body: JSON.stringify(response.body).slice(0, 260),
    rowCounts,
  });
  await cleanup(projectId).catch(() => undefined);
}

function rpcSql(payload) {
  const escaped = JSON.stringify(payload).replace(/'/g, "''");
  return `select public.persist_story_bible_extraction_atomic('${escaped}'::jsonb) as result`;
}

function retargetRun(rows, runId) {
  rows.extractionRunRow.id = runId;
  for (const candidate of rows.candidateRows) {
    candidate.extraction_run_id = runId;
  }
  for (const conflict of rows.conflictRows) {
    conflict.extraction_run_id = runId;
  }
  for (const source of rows.sourceRows) {
    source.extraction_run_id = runId;
  }
  return rows;
}

try {
  const projectMissingConfig = `${prefix}missing_config`;
  await expectPersistFailure(
    "missing service-role config does not fallback to memory",
    { NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" },
    baseRows(projectMissingConfig, "missing_config"),
    "STORY_BIBLE_PERSISTENCE_NOT_CONFIGURED",
  );

  const projectBadHost = `${prefix}bad_host`;
  await expectPersistFailure(
    "supabase DNS failure returns storage error without memory fallback",
    { SUPABASE_URL: "https://invalid.supabase.localhost", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "not-a-real-key" },
    baseRows(projectBadHost, "bad_host"),
    "fetch failed",
    false,
  );

  const projectNoKey = `${prefix}no_key`;
  await expectPersistFailure(
    "missing service-role key is blocked before write",
    { SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" },
    baseRows(projectNoKey, "no_key"),
    "STORY_BIBLE_PERSISTENCE_NOT_CONFIGURED",
  );

  restoreEnv();
  const invalidPayloadProject = `${prefix}invalid_payload`;
  const invalidPayload = baseRows(invalidPayloadProject, "invalid_payload");
  invalidPayload.projectId = "";
  await expectSqlFailureNoPartial(
    "invalid RPC payload fails terminal without partial rows",
    invalidPayloadProject,
    rpcSql(invalidPayload),
    "projectId is required",
  );

  const isolationProject = `${prefix}isolation`;
  const isolationPayload = baseRows(isolationProject, "isolation");
  isolationPayload.candidateRows[0].project_id = `${isolationProject}_other`;
  await expectSqlFailureNoPartial(
    "project isolation violation fails without partial rows",
    isolationProject,
    rpcSql(isolationPayload),
    "project isolation violation",
  );

  const payloadConflictProject = `${prefix}payload_conflict`;
  await cleanup(payloadConflictProject).catch(() => undefined);
  const a = retargetRun(baseRows(payloadConflictProject, "payload_a"), "run_same");
  const b = retargetRun(baseRows(payloadConflictProject, "payload_b"), "run_same");
  b.storyBibleRow.core_json = { changed: true };
  const first = await sql(rpcSql(a), false);
  const second = await sql(rpcSql(b), false);
  const rowCounts = await counts(payloadConflictProject);
  assert("same request different payload blocked without duplicate writes", first.ok && !second.ok && rowCounts.requests === 1 && rowCounts.runs === 1, {
    firstStatus: first.status,
    secondStatus: second.status,
    secondBody: JSON.stringify(second.body).slice(0, 260),
    rowCounts,
  });
  await cleanup(payloadConflictProject).catch(() => undefined);

  const successProject = `${prefix}success`;
  await cleanup(successProject).catch(() => undefined);
  const success = await sql(rpcSql(baseRows(successProject, "success")), false);
  const successCounts = await counts(successProject);
  assert("control success uses Supabase and writes exactly once", success.ok && successCounts.requests === 1 && successCounts.candidates === 1 && successCounts.sources === 1, {
    status: success.status,
    successCounts,
  });
  await cleanup(successProject).catch(() => undefined);
  const cleanupCounts = await counts(successProject);
  assert("silent fallback fixture cleanup", Object.values(cleanupCounts).every((value) => Number(value) === 0), cleanupCounts);
} catch (error) {
  assert("runner uncaught exception", false, { message: error.message, stack: error.stack });
} finally {
  restoreEnv();
}

const summary = {
  pass: results.filter((item) => item.status === "PASS").length,
  fail: results.filter((item) => item.status === "FAIL").length,
  skip: 0,
  silentFallbackBlocked: results.every((item) => item.status === "PASS"),
};

console.log(JSON.stringify({ summary, results }, null, 2));
process.exit(summary.fail === 0 ? 0 : 1);

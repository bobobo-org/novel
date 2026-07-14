const baseUrl = process.env.BASE_URL || "https://novel-orcin.vercel.app";
const adminToken = process.env.ADMIN_TOKEN || "";
const supabaseToken = process.env.SUPABASE_MANAGEMENT_TOKEN || "";
const supabaseProjectRef = process.env.SUPABASE_PROJECT_REF || "";
const expectedCommit = process.env.EXPECTED_APP_COMMIT || "";
const expectedDeploymentId = process.env.EXPECTED_DEPLOYMENT_ID || "";
const projectId = process.env.P0C2C2B_PROJECT_ID || `p0c2c2b-integrity-${Date.now()}`;
const legacyProjectId = `${projectId}-legacy`;
const results = [];

function assert(name, pass, detail = {}) {
  results.push({ name, status: pass ? "PASS" : "FAIL", detail });
}

function esc(value) {
  return String(value ?? "").replace(/'/g, "''");
}

function js(value) {
  return `'${esc(JSON.stringify(value ?? null))}'::jsonb`;
}

async function request(path, init = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { ok: res.ok, status: res.status, body, headers: Object.fromEntries(res.headers.entries()) };
}

async function admin(path, body) {
  return request(path, { method: "POST", headers: { "x-admin-token": adminToken }, body: JSON.stringify(body) });
}

async function sql(query) {
  if (!supabaseToken || !supabaseProjectRef) throw new Error("SUPABASE_TEST_CONFIG_MISSING");
  const res = await fetch(`https://api.supabase.com/v1/projects/${supabaseProjectRef}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${supabaseToken}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => []);
  if (!res.ok) throw new Error(`SUPABASE_SQL_${res.status}:${JSON.stringify(body).slice(0, 500)}`);
  return Array.isArray(body) ? body : body.result || body.value || [];
}

async function seedCandidate(id, proposedValue, expectedVersion) {
  const runId = `${id}_run`;
  const chapterId = `${id}_chapter`;
  const evidence = `${id} evidence`;
  const sourceRefs = [{
    projectId,
    chapterId,
    paragraphIndex: 0,
    textStart: 0,
    textEnd: evidence.length,
    excerptHash: id,
    extractionRunId: runId,
    excerpt: evidence,
    evidenceType: "direct_statement",
    sourceValid: true,
  }];
  await sql(`
insert into public.story_bible_extraction_runs(id,project_id,chapter_id,chapter_number,extraction_mode,schema_version,prompt_version,model_id,fallback_level,status,confidence,warnings,input_hash,output_json)
values ('${esc(runId)}','${esc(projectId)}','${esc(chapterId)}',1,'chapter-new','story-bible-v1','p0c2c2b-fixture','fixture-model','cloud-validated','completed',1,'[]'::jsonb,'fixture','{}'::jsonb);
insert into public.story_fact_candidates(id,project_id,extraction_run_id,entity_type,entity_id,temporary_entity_id,operation,field_path,proposed_value,confidence,evidence,source_refs,reason,conflict_risk,status,candidate_trust,source_valid,status_updated_at)
values ('${esc(id)}','${esc(projectId)}','${esc(runId)}','character','char_integrity','char_integrity','update','characters[].age',${js(proposedValue)},0.98,'${esc(evidence)}',${js(sourceRefs)},'P0-C2C2B fixture','low','pending','cloud-validated',true,now());
insert into public.story_fact_sources(id,project_id,extraction_run_id,candidate_id,chapter_id,paragraph_index,text_start,text_end,excerpt_hash,excerpt)
values ('source_${esc(id)}','${esc(projectId)}','${esc(runId)}','${esc(id)}','${esc(chapterId)}',0,0,${evidence.length},'${esc(id)}','${esc(evidence)}');
`);
  const detail = await request(`/api/story-bible/candidates/${id}?projectId=${projectId}`);
  return admin(`/api/story-bible/candidates/${id}/approve`, {
    projectId,
    requestId: `c2c2b_${id}_${Date.now()}`,
    expectedCandidateStatus: detail.body?.candidate?.status || "pending",
    expectedStoryBibleVersion: expectedVersion,
    reviewReason: `P0-C2C2B approve ${id}`,
  });
}

try {
  const health = await request("/api/ai/health?c2c2b=1");
  assert("health has P0-C2C2B deployment evidence", health.ok
    && (!expectedCommit || health.body?.appCommit === expectedCommit)
    && (!expectedDeploymentId || health.body?.deploymentId === expectedDeploymentId)
    && health.body?.releaseTag === "novel-ai-p0c2c2b-integrity-chain"
    && String(health.body?.migrationVersion || "").includes("p0c2c2b_integrity_chain_009")
    && health.body?.storyBibleIntegrityStatus === "ready"
    && health.body?.storyBibleDiffStatus === "ready"
    && health.headers["cache-control"]?.includes("no-store"), { body: health.body, headers: health.headers });

  await sql(`
insert into public.story_bibles(project_id,schema_version,status,core_json)
values ('${esc(projectId)}','story-bible-v1','active',${js({ purpose: "p0c2c2b-integrity" })});
insert into public.story_characters(id,project_id,character_id,canonical_name,character_json,confidence)
values ('${esc(projectId)}_char_integrity','${esc(projectId)}','char_integrity','Integrity Lin',${js({ age: 20 })},1);
`);
  const a1 = await seedCandidate(`${projectId}_age1`, 21, 0);
  const a2 = await seedCandidate(`${projectId}_age2`, 22, 1);
  assert("new canonical transaction writes integrity fields", a1.ok && a2.ok
    && a2.body?.storyBibleVersion === 2, { a1: a1.body, a2: a2.body });

  const versionRows = await sql(`select version_number, integrity_hash, previous_integrity_hash, integrity_algorithm, integrity_schema_version, integrity_status from public.story_bible_versions where project_id='${esc(projectId)}' order by version_number;`);
  assert("version rows contain integrity hash chain fields", versionRows.length === 2
    && versionRows.every((row) => row.integrity_hash && row.integrity_algorithm === "SHA-256" && row.integrity_schema_version === "story-bible-integrity-v1" && row.integrity_status === "valid")
    && versionRows[1].previous_integrity_hash === versionRows[0].integrity_hash, versionRows);

  const integrityPublic = await request(`/api/story-bible/versions/integrity?projectId=${projectId}`);
  assert("integrity public summary valid", integrityPublic.ok
    && integrityPublic.body?.valid === true
    && integrityPublic.body?.checkedVersions === 2
    && integrityPublic.body?.parentChainValid === true
    && !("details" in integrityPublic.body), integrityPublic.body);

  const detailsDenied = await request(`/api/story-bible/versions/integrity?projectId=${projectId}&includeDetails=true`);
  assert("integrity includeDetails without admin denied", detailsDenied.status === 401, { status: detailsDenied.status, body: detailsDenied.body });

  const detailsOk = await request(`/api/story-bible/versions/integrity?projectId=${projectId}&includeDetails=true`, { headers: { "x-admin-token": adminToken } });
  assert("integrity includeDetails with admin succeeds", detailsOk.ok
    && detailsOk.body?.details?.length === 2, detailsOk.body);

  const diffOk = await request(`/api/story-bible/versions/diff?projectId=${projectId}&fromVersion=1&toVersion=2`);
  assert("valid integrity allows diff", diffOk.ok
    && diffOk.body?.updatedCount === 1
    && diffOk.body?.integrityVerified === "not_checked", diffOk.body);

  await sql(`update public.story_bible_versions set summary='tampered summary' where project_id='${esc(projectId)}' and version_number=2;`);
  const integrityInvalid = await request(`/api/story-bible/versions/integrity?projectId=${projectId}`);
  assert("tampered version makes integrity invalid", integrityInvalid.ok
    && integrityInvalid.body?.valid === false
    && integrityInvalid.body?.firstInvalidVersion?.versionNumber === 2, integrityInvalid.body);

  const diffBlocked = await request(`/api/story-bible/versions/diff?projectId=${projectId}&fromVersion=1&toVersion=2`);
  assert("invalid integrity blocks diff", diffBlocked.status === 409
    && diffBlocked.body?.errorCode === "VERSION_INTEGRITY_FAILED", { status: diffBlocked.status, body: diffBlocked.body });

  await sql(`
insert into public.story_bibles(project_id,schema_version,status,core_json)
values ('${esc(legacyProjectId)}','story-bible-v1','active',${js({ purpose: "legacy-backfill" })});
insert into public.story_bible_versions(id,project_id,version_number,parent_version_id,operation_type,candidate_ids,approved_candidate_ids,change_set,created_by,created_at,operation_source,mutation_request_ids,summary,source_provider_type,source_provider_location,source_mode,data_left_device,storage_location,integrity_status)
values
('${esc(legacyProjectId)}_v1','${esc(legacyProjectId)}',1,null,'approve',array['legacy_c1'],array['legacy_c1'],${js({entityType:"character",entityId:"legacy_char",fieldPath:"characters[].age",operation:"update",previousValue:null,newValue:31,candidateId:"legacy_c1",reason:"legacy v1"})},'legacy','2026-07-14T00:00:00Z','legacy_unknown',array['legacy_r1'],'legacy v1','legacy_unknown','unknown','legacy',null,'legacy_unknown','legacy_uninitialized'),
('${esc(legacyProjectId)}_v2','${esc(legacyProjectId)}',2,'${esc(legacyProjectId)}_v1','approve',array['legacy_c2'],array['legacy_c2'],${js({entityType:"character",entityId:"legacy_char",fieldPath:"characters[].age",operation:"update",previousValue:31,newValue:32,candidateId:"legacy_c2",reason:"legacy v2"})},'legacy','2026-07-14T00:01:00Z','legacy_unknown',array['legacy_r2'],'legacy v2','legacy_unknown','unknown','legacy',null,'legacy_unknown','legacy_uninitialized');
`);
  const dryRun = await admin("/api/admin/story-bible/integrity-backfill", { projectId: legacyProjectId, dryRun: true, batchSize: 10 });
  assert("legacy backfill dry run plans without writes", dryRun.ok
    && dryRun.body?.dryRun === true
    && dryRun.body?.plannedCount === 2
    && dryRun.body?.updatedCount === 0, dryRun.body);

  const backfill = await admin("/api/admin/story-bible/integrity-backfill", { projectId: legacyProjectId, dryRun: false, batchSize: 10 });
  assert("legacy backfill writes hashes", backfill.ok
    && backfill.body?.updatedCount === 2
    && backfill.body?.conflictCount === 0, backfill.body);

  const backfillAgain = await admin("/api/admin/story-bible/integrity-backfill", { projectId: legacyProjectId, dryRun: false, batchSize: 10 });
  assert("legacy backfill idempotent second run", backfillAgain.ok
    && backfillAgain.body?.updatedCount === 0
    && backfillAgain.body?.conflictCount === 0, backfillAgain.body);

  const legacyIntegrity = await request(`/api/story-bible/versions/integrity?projectId=${legacyProjectId}`);
  assert("legacy project valid after backfill", legacyIntegrity.ok
    && legacyIntegrity.body?.valid === true
    && legacyIntegrity.body?.checkedVersions === 2, legacyIntegrity.body);

  const wrongProject = await request(`/api/story-bible/versions/integrity?projectId=${projectId}-missing`);
  assert("integrity wrong project 404", wrongProject.status === 404, { status: wrongProject.status, body: wrongProject.body });

  const cleanup1 = await admin("/api/admin/story-bible/conflict-test", { action: "cleanup", projectId });
  const cleanup2 = await admin("/api/admin/story-bible/conflict-test", { action: "cleanup", projectId: legacyProjectId });
  const after = await sql(`
select 'project_versions' as kind, count(*)::int as count from public.story_bible_versions where project_id in ('${esc(projectId)}','${esc(legacyProjectId)}')
union all select 'project_bibles', count(*)::int from public.story_bibles where project_id in ('${esc(projectId)}','${esc(legacyProjectId)}')
union all select 'project_candidates', count(*)::int from public.story_fact_candidates where project_id in ('${esc(projectId)}','${esc(legacyProjectId)}');
`);
  assert("fixture cleanup removes C2C2B rows", cleanup1.ok && cleanup2.ok && after.every((row) => row.count === 0), { cleanup1: cleanup1.status, cleanup2: cleanup2.status, after });
} catch (error) {
  assert("runner exception", false, { message: error.message, stack: error.stack });
}

const summary = {
  baseUrl,
  projectId,
  legacyProjectId,
  pass: results.filter((x) => x.status === "PASS").length,
  fail: results.filter((x) => x.status === "FAIL").length,
  skip: results.filter((x) => x.status === "SKIP").length,
};

console.log(JSON.stringify({ summary, results }, null, 2));
if (summary.fail > 0) process.exit(1);

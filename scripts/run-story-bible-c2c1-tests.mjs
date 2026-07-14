const baseUrl = process.env.BASE_URL || "https://novel-orcin.vercel.app";
const adminToken = process.env.ADMIN_TOKEN || "";
const supabaseToken = process.env.SUPABASE_MANAGEMENT_TOKEN || "";
const supabaseProjectRef = process.env.SUPABASE_PROJECT_REF || "";
const expectedCommit = process.env.EXPECTED_APP_COMMIT || "";
const expectedDeploymentId = process.env.EXPECTED_DEPLOYMENT_ID || "";
const projectId = process.env.P0C2C1_PROJECT_ID || `p0c2c1-history-${Date.now()}`;
const otherProjectId = `${projectId}-other`;
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

async function seedCandidate(id, entityType, entityId, fieldPath, proposedValue, operation = "update") {
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
values ('${esc(runId)}','${esc(projectId)}','${esc(chapterId)}',1,'chapter-new','story-bible-v1','p0c2c1-fixture','fixture-model','cloud-validated','completed',1,'[]'::jsonb,'fixture','{}'::jsonb);
insert into public.story_fact_candidates(id,project_id,extraction_run_id,entity_type,entity_id,temporary_entity_id,operation,field_path,proposed_value,confidence,evidence,source_refs,reason,conflict_risk,status,candidate_trust,source_valid,status_updated_at)
values ('${esc(id)}','${esc(projectId)}','${esc(runId)}','${esc(entityType)}',${entityId ? `'${esc(entityId)}'` : "null"},'${esc(entityId || id)}','${esc(operation)}','${esc(fieldPath)}',${js(proposedValue)},0.98,'${esc(evidence)}',${js(sourceRefs)},'P0-C2C1 fixture','low','pending','cloud-validated',true,now());
insert into public.story_fact_sources(id,project_id,extraction_run_id,candidate_id,chapter_id,paragraph_index,text_start,text_end,excerpt_hash,excerpt)
values ('source_${esc(id)}','${esc(projectId)}','${esc(runId)}','${esc(id)}','${esc(chapterId)}',0,0,${evidence.length},'${esc(id)}','${esc(evidence)}');
`);
}

async function approve(id, version, requestName) {
  const detail = await request(`/api/story-bible/candidates/${id}?projectId=${projectId}`);
  const candidate = detail.body?.candidate;
  const res = await admin(`/api/story-bible/candidates/${id}/approve`, {
    projectId,
    requestId: `${requestName}_${Date.now()}`,
    expectedCandidateStatus: candidate?.status || "pending",
    expectedStoryBibleVersion: version,
    reviewReason: `P0-C2C1 approve ${id}`,
  });
  return res;
}

try {
  const health = await request("/api/ai/health?c2c1=1");
  assert("health has P0-C2C1 migration", health.ok
    && (!expectedCommit || health.body?.appCommit === expectedCommit)
    && (!expectedDeploymentId || health.body?.deploymentId === expectedDeploymentId)
    && String(health.body?.migrationVersion || "").includes("p0c2c1_version_history_007")
    && health.body?.storyBibleProvenanceStatus === "partial", health.body);

  await sql(`
insert into public.story_bibles(project_id,schema_version,status,core_json)
values ('${esc(projectId)}','story-bible-v1','active',${js({ purpose: "p0c2c1-version-history" })});
insert into public.story_bibles(project_id,schema_version,status,core_json)
values ('${esc(otherProjectId)}','story-bible-v1','active',${js({ purpose: "isolation" })});
insert into public.story_characters(id,project_id,character_id,canonical_name,character_json,confidence)
values ('${esc(projectId)}_char_history','${esc(projectId)}','char_history','林昭',${js({ aliases: [], age: 28 })},1);
`);
  await seedCandidate(`${projectId}_char_alias`, "character", "char_history", "characters[].aliases", ["昭哥"], "append");
  await seedCandidate(`${projectId}_char_age`, "character", "char_history", "characters[].age", 29, "update");
  await seedCandidate(`${projectId}_event`, "event", null, "events[].title", "夜探密室", "create");

  const a1 = await approve(`${projectId}_char_alias`, 0, "c2c1_alias");
  assert("approve v1 alias append", a1.ok && a1.body?.versionId && a1.body?.storyBibleVersion === 1, { status: a1.status, body: a1.body });
  const a2 = await approve(`${projectId}_char_age`, 1, "c2c1_age");
  assert("approve v2 age update", a2.ok && a2.body?.versionId && a2.body?.storyBibleVersion === 2, { status: a2.status, body: a2.body });
  const a3 = await approve(`${projectId}_event`, 2, "c2c1_event");
  assert("approve v3 event create", a3.ok && a3.body?.versionId && a3.body?.storyBibleVersion === 3, { status: a3.status, body: a3.body });

  const list = await request(`/api/story-bible/versions?projectId=${projectId}&page=1&pageSize=2`);
  assert("version list paginates", list.ok && list.body?.versions?.length === 2 && list.body?.pagination?.total === 3 && list.body?.currentVersion?.versionNumber === 3, { status: list.status, body: list.body });

  const filtered = await request(`/api/story-bible/versions?projectId=${projectId}&entityType=character&entityId=char_history`);
  assert("version list filters entity", filtered.ok && filtered.body?.versions?.length === 2, { status: filtered.status, body: filtered.body });

  const operationFiltered = await request(`/api/story-bible/versions?projectId=${projectId}&operationType=approve`);
  assert("version list filters operation", operationFiltered.ok && operationFiltered.body?.versions?.length === 3, { status: operationFiltered.status, body: operationFiltered.body });

  const detail = await request(`/api/story-bible/versions/${a2.body.versionId}?projectId=${projectId}`);
  assert("version detail includes refs provenance integrity", detail.ok
    && detail.body?.metadata?.versionNumber === 2
    && detail.body?.sourceRelations?.length >= 1
    && detail.body?.candidateReferences?.length >= 1
    && detail.body?.mutationRequestReferences?.length >= 1
    && detail.body?.providerProvenance?.sourceProviderType === "gemini"
    && detail.body?.integrity?.integrityHash, { status: detail.status, body: detail.body });

  const wrongDetail = await request(`/api/story-bible/versions/${a2.body.versionId}?projectId=${otherProjectId}`);
  assert("version detail wrong project 404", wrongDetail.status === 404, { status: wrongDetail.status, body: wrongDetail.body });

  const entityHistory = await request(`/api/story-bible/entities/character/char_history/history?projectId=${projectId}`);
  assert("entity history returns field/source changes", entityHistory.ok
    && entityHistory.body?.createdVersion?.versionNumber === 1
    && entityHistory.body?.fieldChanges?.length === 2
    && entityHistory.body?.sourceChanges?.length === 2, { status: entityHistory.status, body: entityHistory.body });

  const fieldHistory = await request(`/api/story-bible/entities/character/char_history/fields/history?projectId=${projectId}&fieldPath=characters%5B%5D.age`);
  assert("field history returns age change", fieldHistory.ok
    && fieldHistory.body?.fieldChanges?.length === 1
    && fieldHistory.body?.fieldChanges?.[0]?.newValue === 29, { status: fieldHistory.status, body: fieldHistory.body });

  const fieldMissing = await request(`/api/story-bible/entities/character/char_history/fields/history?projectId=${projectId}`);
  assert("field history missing fieldPath 400", fieldMissing.status === 400, { status: fieldMissing.status, body: fieldMissing.body });

  const isolationList = await request(`/api/story-bible/versions?projectId=${otherProjectId}`);
  assert("project isolation hides other versions", isolationList.ok && isolationList.body?.totalVersions === 0, { status: isolationList.status, body: isolationList.body });

  const cleanup = await admin("/api/admin/story-bible/conflict-test", { action: "cleanup", projectId });
  await admin("/api/admin/story-bible/conflict-test", { action: "cleanup", projectId: otherProjectId });
  const after = await sql(`
select 'versions' as kind, count(*)::int as count from public.story_bible_versions where project_id='${esc(projectId)}'
union all select 'sources', count(*)::int from public.story_canonical_sources where project_id='${esc(projectId)}'
union all select 'candidates', count(*)::int from public.story_fact_candidates where project_id='${esc(projectId)}'
union all select 'bibles', count(*)::int from public.story_bibles where project_id='${esc(projectId)}';
`);
  assert("fixture cleanup removes C2C1 rows", cleanup.ok && after.every((x) => x.count === 0), { cleanupStatus: cleanup.status, after });
} catch (error) {
  assert("runner exception", false, { message: error.message });
}

const summary = {
  baseUrl,
  projectId,
  pass: results.filter((x) => x.status === "PASS").length,
  fail: results.filter((x) => x.status === "FAIL").length,
  skip: results.filter((x) => x.status === "SKIP").length,
};

console.log(JSON.stringify({ summary, results }, null, 2));
if (summary.fail > 0) process.exit(1);

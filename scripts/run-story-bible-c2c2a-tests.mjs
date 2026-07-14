const baseUrl = process.env.BASE_URL || "https://novel-orcin.vercel.app";
const adminToken = process.env.ADMIN_TOKEN || "";
const supabaseToken = process.env.SUPABASE_MANAGEMENT_TOKEN || "";
const supabaseProjectRef = process.env.SUPABASE_PROJECT_REF || "";
const expectedCommit = process.env.EXPECTED_APP_COMMIT || "";
const expectedDeploymentId = process.env.EXPECTED_DEPLOYMENT_ID || "";
const projectId = process.env.P0C2C2A_PROJECT_ID || `p0c2c2a-diff-${Date.now()}`;
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
values ('${esc(runId)}','${esc(projectId)}','${esc(chapterId)}',1,'chapter-new','story-bible-v1','p0c2c2a-fixture','fixture-model','cloud-validated','completed',1,'[]'::jsonb,'fixture','{}'::jsonb);
insert into public.story_fact_candidates(id,project_id,extraction_run_id,entity_type,entity_id,temporary_entity_id,operation,field_path,proposed_value,confidence,evidence,source_refs,reason,conflict_risk,status,candidate_trust,source_valid,status_updated_at)
values ('${esc(id)}','${esc(projectId)}','${esc(runId)}','${esc(entityType)}',${entityId ? `'${esc(entityId)}'` : "null"},'${esc(entityId || id)}','${esc(operation)}','${esc(fieldPath)}',${js(proposedValue)},0.98,'${esc(evidence)}',${js(sourceRefs)},'P0-C2C2A fixture','low','pending','cloud-validated',true,now());
insert into public.story_fact_sources(id,project_id,extraction_run_id,candidate_id,chapter_id,paragraph_index,text_start,text_end,excerpt_hash,excerpt)
values ('source_${esc(id)}','${esc(projectId)}','${esc(runId)}','${esc(id)}','${esc(chapterId)}',0,0,${evidence.length},'${esc(id)}','${esc(evidence)}');
`);
}

async function approve(id, version, requestName) {
  const detail = await request(`/api/story-bible/candidates/${id}?projectId=${projectId}`);
  const candidate = detail.body?.candidate;
  return admin(`/api/story-bible/candidates/${id}/approve`, {
    projectId,
    requestId: `${requestName}_${Date.now()}`,
    expectedCandidateStatus: candidate?.status || "pending",
    expectedStoryBibleVersion: version,
    reviewReason: `P0-C2C2A approve ${id}`,
  });
}

try {
  const health1 = await request("/api/ai/health?c2c2a=1");
  const health2 = await request(`/api/ai/health?c2c2a=${Date.now()}`);
  assert("health has P0-C2C2A deployment evidence", health1.ok
    && health2.ok
    && (!expectedCommit || health1.body?.appCommit === expectedCommit)
    && (!expectedDeploymentId || health1.body?.deploymentId === expectedDeploymentId)
    && String(health1.body?.migrationVersion || "").includes("p0c2c2a_version_diff_008")
    && health1.body?.storyBibleDiffStatus === "ready"
    && health1.headers["cache-control"]?.includes("no-store"), { health1: health1.body, health2: health2.body, headers: health1.headers });

  await sql(`
insert into public.story_bibles(project_id,schema_version,status,core_json)
values ('${esc(projectId)}','story-bible-v1','active',${js({ purpose: "p0c2c2a-version-diff" })});
insert into public.story_bibles(project_id,schema_version,status,core_json)
values ('${esc(otherProjectId)}','story-bible-v1','active',${js({ purpose: "isolation" })});
insert into public.story_characters(id,project_id,character_id,canonical_name,character_json,confidence)
values ('${esc(projectId)}_char_diff','${esc(projectId)}','char_diff','Lin Zhao',${js({ aliases: [], age: 28 })},1);
insert into public.story_items(id,project_id,item_id,name,item_json)
values ('${esc(projectId)}_item_diff','${esc(projectId)}','item_diff','Red Sword',${js({ currentOwnerCharacterId: "char_diff" })});
`);
  await seedCandidate(`${projectId}_age1`, "character", "char_diff", "characters[].age", 29, "update");
  await seedCandidate(`${projectId}_age2`, "character", "char_diff", "characters[].age", 30, "update");
  await seedCandidate(`${projectId}_alias`, "character", "char_diff", "characters[].aliases", ["Lord Lin"], "append");
  await seedCandidate(`${projectId}_owner`, "item", "item_diff", "items[].currentOwnerCharacterId", "char_other", "update");
  await seedCandidate(`${projectId}_event`, "event", null, "events[].title", "Capital ambush", "create");

  const a1 = await approve(`${projectId}_age1`, 0, "c2c2a_age1");
  const a2 = await approve(`${projectId}_age2`, 1, "c2c2a_age2");
  const a3 = await approve(`${projectId}_alias`, 2, "c2c2a_alias");
  const a4 = await approve(`${projectId}_owner`, 3, "c2c2a_owner");
  const a5 = await approve(`${projectId}_event`, 4, "c2c2a_event");
  assert("fixture creates five canonical versions", a1.ok && a2.ok && a3.ok && a4.ok
    && a5.ok && a5.body?.storyBibleVersion === 5, { a1: a1.body, a2: a2.body, a3: a3.body, a4: a4.body, a5: a5.body });

  const consecutive = await request(`/api/story-bible/versions/diff?projectId=${projectId}&fromVersion=1&toVersion=2`);
  assert("consecutive diff detects scalar update", consecutive.ok
    && consecutive.body?.direction === "forward"
    && consecutive.body?.updatedCount === 1
    && consecutive.body?.fieldDiffs?.[0]?.fieldPath === "characters[].age"
    && consecutive.body?.fieldDiffs?.[0]?.fromValue === 29
    && consecutive.body?.fieldDiffs?.[0]?.toValue === 30, consecutive.body);

  const nonConsecutive = await request(`/api/story-bible/versions/diff?projectId=${projectId}&fromVersion=1&toVersion=5`);
  assert("non-consecutive diff reconstructs endpoint states", nonConsecutive.ok
    && nonConsecutive.body?.affectedFieldCount === 4
    && nonConsecutive.body?.updatedCount === 1
    && nonConsecutive.body?.createdCount >= 1
    && nonConsecutive.body?.entityGroups?.length >= 3, nonConsecutive.body);

  const reverse = await request(`/api/story-bible/versions/diff?projectId=${projectId}&fromVersion=5&toVersion=1`);
  assert("reverse diff is backward and inverts endpoint changes", reverse.ok
    && reverse.body?.direction === "backward"
    && reverse.body?.deletedCount >= 1
    && reverse.body?.fieldDiffs?.some((x) => x.operation === "deleted"), reverse.body);

  const same = await request(`/api/story-bible/versions/diff?projectId=${projectId}&fromVersion=2&toVersion=2`);
  assert("same-version diff returns no changes by default", same.ok
    && same.body?.direction === "same"
    && same.body?.affectedFieldCount === 0, same.body);

  const sameUnchanged = await request(`/api/story-bible/versions/diff?projectId=${projectId}&fromVersion=2&toVersion=2&includeUnchanged=true`);
  assert("same-version includeUnchanged returns unchanged fields", sameUnchanged.ok
    && sameUnchanged.body?.unchangedCount >= 1
    && sameUnchanged.body?.fieldDiffs?.every((x) => x.operation === "unchanged"), sameUnchanged.body);

  const entityFiltered = await request(`/api/story-bible/versions/diff?projectId=${projectId}&fromVersion=1&toVersion=5&entityType=item&entityId=item_diff`);
  assert("entity diff filters item owner field", entityFiltered.ok
    && entityFiltered.body?.affectedFieldCount === 1
    && entityFiltered.body?.fieldDiffs?.[0]?.fieldPath === "items[].currentOwnerCharacterId", entityFiltered.body);

  const fieldFiltered = await request(`/api/story-bible/versions/diff?projectId=${projectId}&fromVersion=1&toVersion=5&fieldPath=characters%5B%5D.age`);
  assert("fieldPath diff filters one field", fieldFiltered.ok
    && fieldFiltered.body?.affectedFieldCount === 1
    && fieldFiltered.body?.fieldDiffs?.[0]?.toValue === 30, fieldFiltered.body);

  const current = await request(`/api/story-bible/versions/${a1.body.versionId}/diff-current?projectId=${projectId}`);
  assert("current-to-version diff reports target current and risk", current.ok
    && current.body?.targetVersion?.versionNumber === 1
    && current.body?.currentVersion?.versionNumber === 5
    && ["medium", "high", "blocking"].includes(current.body?.revertRisk)
    && current.body?.fieldDiffs?.length >= 3, current.body);

  const currentItself = await request(`/api/story-bible/versions/${a5.body.versionId}/diff-current?projectId=${projectId}`);
  assert("current-to-current diff is low risk", currentItself.ok
    && currentItself.body?.targetVersion?.versionNumber === 5
    && currentItself.body?.revertRisk === "low"
    && currentItself.body?.fieldDiffs?.length === 0, currentItself.body);

  const wrongProject = await request(`/api/story-bible/versions/diff?projectId=${otherProjectId}&fromVersion=${a1.body.versionId}&toVersion=${a5.body.versionId}`);
  assert("diff wrong project returns 404", wrongProject.status === 404, { status: wrongProject.status, body: wrongProject.body });

  const missingParams = await request(`/api/story-bible/versions/diff?projectId=${projectId}&fromVersion=1`);
  assert("diff missing toVersion returns 400", missingParams.status === 400, { status: missingParams.status, body: missingParams.body });

  const notFound = await request(`/api/story-bible/versions/diff?projectId=${projectId}&fromVersion=999&toVersion=1`);
  assert("diff version not found returns 404", notFound.status === 404, { status: notFound.status, body: notFound.body });

  const cleanup = await admin("/api/admin/story-bible/conflict-test", { action: "cleanup", projectId });
  await admin("/api/admin/story-bible/conflict-test", { action: "cleanup", projectId: otherProjectId });
  const after = await sql(`
select 'versions' as kind, count(*)::int as count from public.story_bible_versions where project_id='${esc(projectId)}'
union all select 'sources', count(*)::int from public.story_canonical_sources where project_id='${esc(projectId)}'
union all select 'candidates', count(*)::int from public.story_fact_candidates where project_id='${esc(projectId)}'
union all select 'bibles', count(*)::int from public.story_bibles where project_id='${esc(projectId)}';
`);
  assert("fixture cleanup removes C2C2A rows", cleanup.ok && after.every((x) => x.count === 0), { cleanupStatus: cleanup.status, after });
} catch (error) {
  assert("runner exception", false, { message: error.message, stack: error.stack });
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

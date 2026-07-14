const baseUrl = process.env.BASE_URL || "https://novel-orcin.vercel.app";
const adminToken = process.env.ADMIN_TOKEN || "";
const projectId = process.env.P0C2B2_PROJECT_ID || `p0c2b2-approve-${Date.now()}`;
const otherProjectId = `${projectId}-other`;
const supabaseToken = process.env.SUPABASE_MANAGEMENT_TOKEN || "";
const supabaseProjectRef = process.env.SUPABASE_PROJECT_REF || "";
const expectedCommit = process.env.EXPECTED_APP_COMMIT || "";
const expectedDeploymentId = process.env.EXPECTED_DEPLOYMENT_ID || "";
const results = [];

function assert(name, pass, detail = {}) {
  return { name, status: pass ? "PASS" : "FAIL", detail };
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
  if (!supabaseToken || !supabaseProjectRef) return [];
  const res = await fetch(`https://api.supabase.com/v1/projects/${supabaseProjectRef}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${supabaseToken}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => []);
  if (!res.ok) throw new Error(`SUPABASE_SQL_${res.status}:${JSON.stringify(body).slice(0, 500)}`);
  return Array.isArray(body) ? body : body.result || body.value || [];
}

function esc(value) {
  return String(value ?? "").replace(/'/g, "''");
}

function js(value) {
  return `'${esc(JSON.stringify(value ?? null))}'::jsonb`;
}

async function seedDirectAdapterFixture(projectId) {
  const runId = `story_extract_c2b2_${Date.now()}`;
  const chapterId = "p0c2b2-adapter-chapter";
  await sql(`
insert into public.story_bibles(project_id,schema_version,status,core_json)
values ('${esc(projectId)}','story-bible-v1','active',${js({ projectId, purpose: "p0c2b2-adapter-fixture" })})
on conflict(project_id) do nothing;

insert into public.story_bible_extraction_runs(id,project_id,chapter_id,chapter_number,extraction_mode,schema_version,prompt_version,model_id,fallback_level,status,confidence,warnings,input_hash,output_json)
values ('${esc(runId)}','${esc(projectId)}','${esc(chapterId)}',2,'chapter-new','story-bible-v1','p0c2b2-fixture','fixture','cloud-validated','completed',1,'[]'::jsonb,'fixture', '{}'::jsonb);

insert into public.story_characters(id,project_id,character_id,canonical_name,character_json,confidence)
values ('${esc(projectId)}_char_adapter','${esc(projectId)}','char_adapter','林昭',${js({ age: 28, aliases: ["阿昭"], lifeStatus: "alive" })},1)
on conflict(id) do nothing;
insert into public.story_items(id,project_id,item_id,name,item_json)
values ('${esc(projectId)}_item_adapter','${esc(projectId)}','item_adapter','青銅令',${js({ currentOwnerCharacterId: "char_adapter", history: [] })})
on conflict(id) do nothing;
insert into public.story_world_rules(id,project_id,rule_id,title,rule_json,immutable,confidence)
values ('${esc(projectId)}_rule_adapter','${esc(projectId)}','rule_adapter','血契不可違背',${js({ description: "血契不可違背" })},true,1)
on conflict(id) do nothing;
insert into public.story_foreshadowing(id,project_id,foreshadow_id,title,status,foreshadow_json)
values ('${esc(projectId)}_fs_adapter','${esc(projectId)}','fs_adapter','赤霄劍真主','paid',${js({ description: "已回收" })})
on conflict(id) do nothing;
insert into public.story_open_threads(id,project_id,thread_id,thread_type,title,status,thread_json)
values ('${esc(projectId)}_thread_adapter','${esc(projectId)}','thread_adapter','mystery','密室真相','resolved',${js({ resolvedChapterId: "ch1" })})
on conflict(id) do nothing;
`);

  async function addCandidate(id, entityType, entityId, fieldPath, proposedValue, operation = "update", sourceValid = true) {
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
      sourceValid,
    }];
    await sql(`
insert into public.story_fact_candidates(id,project_id,extraction_run_id,entity_type,entity_id,temporary_entity_id,operation,field_path,proposed_value,confidence,evidence,source_refs,reason,conflict_risk,status,candidate_trust,source_valid,status_updated_at)
values ('${esc(id)}','${esc(projectId)}','${esc(runId)}','${esc(entityType)}',${entityId ? `'${esc(entityId)}'` : "null"},'${esc(entityId || id)}','${esc(operation)}','${esc(fieldPath)}',${js(proposedValue)},0.95,'${esc(evidence)}',${js(sourceRefs)},'P0-C2B2 adapter fixture','low','pending','cloud-validated',${sourceValid ? "true" : "false"},now());
insert into public.story_fact_sources(id,project_id,extraction_run_id,candidate_id,chapter_id,paragraph_index,text_start,text_end,excerpt_hash,excerpt)
values ('source_${esc(id)}','${esc(projectId)}','${esc(runId)}','${esc(id)}','${esc(chapterId)}',0,0,${evidence.length},'${esc(id)}','${esc(evidence)}')
on conflict(id) do nothing;
`);
  }

  const prefix = `cand_${Date.now()}`;
  const ids = {
    characterCreate: `${prefix}_character_create`,
    characterAliasAppend: `${prefix}_character_alias_append`,
    characterAgeUpdate: `${prefix}_character_age_update`,
    eventCreate: `${prefix}_event_create`,
    itemCreate: `${prefix}_item_create`,
    itemOwnerUpdate: `${prefix}_item_owner_update`,
    itemHistoryAppend: `${prefix}_item_history_append`,
    worldRuleCreate: `${prefix}_world_rule_create`,
    immutableUpdate: `${prefix}_immutable_update`,
    foreshadowCreate: `${prefix}_foreshadow_create`,
    paidToPlanted: `${prefix}_paid_to_planted`,
    openThreadCreate: `${prefix}_open_thread_create`,
    openThreadResolvedOpen: `${prefix}_open_thread_resolved_open`,
    invalidSource: `${prefix}_invalid_source`,
    unsupportedField: `${prefix}_unsupported_field`,
  };
  await addCandidate(ids.characterCreate, "character", null, "characters[].canonicalName", "顧青", "create");
  await addCandidate(ids.characterAliasAppend, "character", "char_adapter", "characters[].aliases", ["昭哥"], "append");
  await addCandidate(ids.characterAgeUpdate, "character", "char_adapter", "characters[].age", 29, "update");
  await addCandidate(ids.eventCreate, "event", null, "events[].title", "夜探密室", "create");
  await addCandidate(ids.itemCreate, "item", null, "items[].name", "寒玉佩", "create");
  await addCandidate(ids.itemOwnerUpdate, "item", "item_adapter", "items[].currentOwnerCharacterId", "char_new_owner", "update");
  await addCandidate(ids.itemHistoryAppend, "item", "item_adapter", "items[].history", ["林昭交還青銅令"], "append");
  await addCandidate(ids.worldRuleCreate, "world_rule", null, "worldRules[].title", "靈契需以血為證", "create");
  await addCandidate(ids.immutableUpdate, "world_rule", "rule_adapter", "worldRules[].description", "血契可以隨意解除", "update");
  await addCandidate(ids.foreshadowCreate, "foreshadowing", null, "foreshadowing[].title", "門後第三聲", "create");
  await addCandidate(ids.paidToPlanted, "foreshadowing", "fs_adapter", "foreshadowing[].status", "planted", "update");
  await addCandidate(ids.openThreadCreate, "open_thread", null, "openThreads[].title", "誰打開了密室", "create");
  await addCandidate(ids.openThreadResolvedOpen, "open_thread", "thread_adapter", "openThreads[].status", "open", "update");
  await addCandidate(ids.invalidSource, "event", null, "events[].title", "無效來源事件", "create", false);
  await addCandidate(ids.unsupportedField, "character", "char_adapter", "characters[].notAllowed", "錯誤欄位", "update");
  return ids;
}

function approveBody(candidate, requestId, overrides = {}) {
  return {
    projectId,
    requestId,
    expectedCandidateStatus: candidate.status,
    expectedStoryBibleVersion: overrides.expectedStoryBibleVersion ?? 0,
    reviewReason: overrides.reviewReason || "P0-C2B2 approve smoke.",
    ...overrides,
  };
}

function editBody(candidate, requestId, editedValue, overrides = {}) {
  return {
    projectId,
    requestId,
    expectedCandidateStatus: candidate.status,
    expectedStoryBibleVersion: overrides.expectedStoryBibleVersion ?? 1,
    editedValue,
    editReason: overrides.editReason || "P0-C2B2 edit approve smoke.",
    sourceMode: overrides.sourceMode || "author-declared",
    ...overrides,
  };
}

const health = await request("/api/ai/health");
results.push(assert("health returns P0-C2B2 semantics", health.ok
  && health.body?.releaseTag === "novel-ai-p0c2b2-canonical-transaction"
  && (!expectedCommit || String(health.body?.appCommit || "") === expectedCommit.trim())
  && (!expectedDeploymentId || String(health.body?.deploymentId || "") === expectedDeploymentId.trim())
  && String(health.body?.migrationVersion || "").includes("p0c2b2_canonical_transaction_006")
  && health.body?.storyBibleApprovalStatus === "ready"
  && health.body?.storyBibleVersioningStatus === "partial"
  && health.body?.storyBibleConflictEngineStatus === "ready", {
    appCommit: health.body?.appCommit,
    deploymentId: health.body?.deploymentId,
    releaseTag: health.body?.releaseTag,
    migrationVersion: health.body?.migrationVersion,
    approval: health.body?.storyBibleApprovalStatus,
    versioning: health.body?.storyBibleVersioningStatus,
    conflict: health.body?.storyBibleConflictEngineStatus,
  }));

const noAdminApprove = await request("/api/story-bible/candidates/not-real/approve", { method: "POST", body: JSON.stringify({}) });
results.push(assert("unauthorized approve returns 401", noAdminApprove.status === 401 || noAdminApprove.status === 503, { status: noAdminApprove.status }));

const invalidApprove = await admin("/api/story-bible/candidates/not-real/approve", { projectId });
results.push(assert("invalid approve body returns 400", invalidApprove.status === 400, { status: invalidApprove.status, body: invalidApprove.body }));

if (!adminToken) {
  results.push(assert("admin token provided", false, { reason: "ADMIN_TOKEN missing" }));
} else {
  const injected = await admin("/api/admin/story-bible/conflict-test", { action: "run", projectId });
  results.push(assert("fixture injection created candidates", injected.ok && injected.body?.persisted?.candidateCount >= 10, { status: injected.status, persisted: injected.body?.persisted }));

  const candidatesRes = await request(`/api/story-bible/candidates?projectId=${projectId}&limit=50`);
  const candidates = candidatesRes.body?.candidates || [];
  const noConflict = candidates.find((x) => x.status === "pending" && x.entity_type === "event" && !x.entity_id);
  const exact = candidates.find((x) => x.status === "pending" && x.entity_type === "character" && x.proposed_value === 28);
  const needsReview = candidates.find((x) => x.status === "needs_review" && x.candidate_trust === "local-rule");
  const blocking = candidates.find((x) => x.entity_type === "world_rule");

  const wrongProject = noConflict ? await admin(`/api/story-bible/candidates/${noConflict.id}/approve`, { ...approveBody(noConflict, `req_wrong_${Date.now()}`), projectId: otherProjectId }) : { status: 0 };
  results.push(assert("wrong project approve returns 404", wrongProject.status === 404, { status: wrongProject.status, body: wrongProject.body }));

  const approveReq = `req_approve_${Date.now()}`;
  const approved = noConflict ? await admin(`/api/story-bible/candidates/${noConflict.id}/approve`, approveBody(noConflict, approveReq)) : { ok: false, status: 0, body: null };
  results.push(assert("approve creates canonical event and version", approved.ok && approved.body?.status === "approved" && approved.body?.canonicalChanged === true && approved.body?.versionId, { status: approved.status, body: approved.body }));

  const replay = noConflict ? await admin(`/api/story-bible/candidates/${noConflict.id}/approve`, approveBody(noConflict, approveReq)) : { ok: false };
  results.push(assert("approve idempotent replay works", replay.ok && replay.body?.idempotentReplay === true, { status: replay.status, body: replay.body }));

  const keyReuse = noConflict ? await admin(`/api/story-bible/candidates/${noConflict.id}/approve`, { ...approveBody(noConflict, approveReq), reviewReason: "different" }) : { status: 0 };
  results.push(assert("approve same requestId different payload returns 409", keyReuse.status === 409 && keyReuse.body?.errorCode === "IDEMPOTENCY_KEY_REUSED", { status: keyReuse.status, body: keyReuse.body }));

  const exactReq = `req_nochange_${Date.now()}`;
  const noChange = exact ? await admin(`/api/story-bible/candidates/${exact.id}/approve`, approveBody(exact, exactReq, { expectedStoryBibleVersion: 1 })) : { ok: false, body: null };
  results.push(assert("no_change approve does not create version", noChange.ok && noChange.body?.noChange === true && noChange.body?.versionId === null, { status: noChange.status, body: noChange.body }));

  const stale = needsReview ? await admin(`/api/story-bible/candidates/${needsReview.id}/edit-and-approve`, editBody(needsReview, `req_stale_${Date.now()}`, "作者宣告事件", { expectedStoryBibleVersion: 0 })) : { status: 0 };
  results.push(assert("expected version mismatch returns 409", stale.status === 409 && stale.body?.errorCode === "STORY_BIBLE_VERSION_CONFLICT", { status: stale.status, body: stale.body }));

  // Use a fresh needs_review candidate after stale check may mark the old one stale.
  const candidatesAfterStale = (await request(`/api/story-bible/candidates?projectId=${projectId}&limit=50`)).body?.candidates || [];
  const editable = candidatesAfterStale.find((x) => x.status === "needs_review" && x.candidate_trust === "cloud-repaired") || candidatesAfterStale.find((x) => x.status === "needs_review");
  const editReq = `req_edit_${Date.now()}`;
  const edited = editable ? await admin(`/api/story-bible/candidates/${editable.id}/edit-and-approve`, editBody(editable, editReq, "作者確認後的事件", { expectedStoryBibleVersion: 1, sourceMode: "author-declared" })) : { ok: false, body: null };
  results.push(assert("edit-and-approve author-declared creates canonical version", edited.ok && edited.body?.status === "approved" && edited.body?.humanEdited === true && edited.body?.sourceMode === "author-declared", { status: edited.status, body: edited.body }));

  const blockRes = blocking ? await admin(`/api/story-bible/candidates/${blocking.id}/approve`, approveBody(blocking, `req_block_${Date.now()}`, { expectedStoryBibleVersion: edited.body?.storyBibleVersion || 2 })) : { status: 0 };
  results.push(assert("blocking conflict blocks approve", blockRes.status === 409 && blockRes.body?.errorCode === "BLOCKING_CONFLICT_PRESENT", { status: blockRes.status, body: blockRes.body }));

  const adapterIds = await seedDirectAdapterFixture(projectId);
  let version = edited.body?.storyBibleVersion || 2;
  async function approveDirect(id, expectedName, extra = {}) {
    const detail = await request(`/api/story-bible/candidates/${id}?projectId=${projectId}`);
    const candidate = detail.body?.candidate;
    const res = await admin(`/api/story-bible/candidates/${id}/approve`, approveBody(candidate, `req_${expectedName}_${Date.now()}`, { expectedStoryBibleVersion: version, ...extra }));
    if (res.ok && res.body?.versionId) version = res.body.storyBibleVersion;
    return { detail, candidate, res };
  }
  async function editDirect(id, value, expectedName, extra = {}) {
    const detail = await request(`/api/story-bible/candidates/${id}?projectId=${projectId}`);
    const candidate = detail.body?.candidate;
    const res = await admin(`/api/story-bible/candidates/${id}/edit-and-approve`, editBody(candidate, `req_${expectedName}_${Date.now()}`, value, { expectedStoryBibleVersion: version, ...extra }));
    if (res.ok && res.body?.versionId) version = res.body.storyBibleVersion;
    return { detail, candidate, res };
  }

  for (const [label, id] of [
    ["adapter character create", adapterIds.characterCreate],
    ["adapter character alias append", adapterIds.characterAliasAppend],
    ["adapter character age update", adapterIds.characterAgeUpdate],
    ["adapter event create", adapterIds.eventCreate],
    ["adapter item create", adapterIds.itemCreate],
    ["adapter item owner update", adapterIds.itemOwnerUpdate],
    ["adapter item history append", adapterIds.itemHistoryAppend],
    ["adapter world rule create", adapterIds.worldRuleCreate],
    ["adapter foreshadowing create", adapterIds.foreshadowCreate],
    ["adapter open thread create", adapterIds.openThreadCreate],
  ]) {
    const { res } = await approveDirect(id, label.replace(/\s+/g, "_"));
    results.push(assert(label, res.ok && res.body?.status === "approved" && res.body?.versionId, { status: res.status, body: res.body }));
  }

  const immutable = await approveDirect(adapterIds.immutableUpdate, "immutable_update");
  results.push(assert("immutable world rule update is blocked", immutable.res.status === 409 && ["IMMUTABLE_RULE_CHANGE_BLOCKED", "BLOCKING_CONFLICT_PRESENT"].includes(immutable.res.body?.errorCode), { status: immutable.res.status, body: immutable.res.body }));

  const paidBack = await approveDirect(adapterIds.paidToPlanted, "paid_back");
  results.push(assert("paid foreshadowing cannot revert", paidBack.res.status === 409 && paidBack.res.body?.errorCode === "INVALID_FORESHADOWING_TRANSITION", { status: paidBack.res.status, body: paidBack.res.body }));

  const threadBack = await approveDirect(adapterIds.openThreadResolvedOpen, "thread_back");
  results.push(assert("resolved open thread cannot reopen", threadBack.res.status === 409 && threadBack.res.body?.errorCode === "INVALID_OPEN_THREAD_TRANSITION", { status: threadBack.res.status, body: threadBack.res.body }));

  const invalidSource = await approveDirect(adapterIds.invalidSource, "invalid_source");
  results.push(assert("invalid source blocks ai-supported approve", invalidSource.res.status === 409 && invalidSource.res.body?.errorCode === "INVALID_SOURCE_REFERENCE", { status: invalidSource.res.status, body: invalidSource.res.body }));

  const unsupportedField = await approveDirect(adapterIds.unsupportedField, "unsupported_field");
  results.push(assert("unsupported field returns 422", unsupportedField.res.status === 422 && unsupportedField.res.body?.errorCode === "FIELD_PATH_NOT_SUPPORTED", { status: unsupportedField.res.status, body: unsupportedField.res.body }));

  const authorDeclared = await editDirect(adapterIds.invalidSource, "作者宣告來源事件", "author_declared_invalid_source", { sourceMode: "author-declared" });
  results.push(assert("author-declared edit can approve without AI source", authorDeclared.res.ok && authorDeclared.res.body?.sourceMode === "author-declared" && authorDeclared.res.body?.humanEdited === true, { status: authorDeclared.res.status, body: authorDeclared.res.body }));

  const counts = await sql(`
select 'versions' as kind, count(*)::int as count from public.story_bible_versions where project_id='${projectId}'
union all select 'sources', count(*)::int from public.story_canonical_sources where project_id='${projectId}'
union all select 'approved', count(*)::int from public.story_fact_candidates where project_id='${projectId}' and status='approved'
union all select 'events', count(*)::int from public.story_events where project_id='${projectId}'
union all select 'characters', count(*)::int from public.story_characters where project_id='${projectId}'
union all select 'items', count(*)::int from public.story_items where project_id='${projectId}'
union all select 'world_rules', count(*)::int from public.story_world_rules where project_id='${projectId}'
union all select 'foreshadowing', count(*)::int from public.story_foreshadowing where project_id='${projectId}'
union all select 'open_threads', count(*)::int from public.story_open_threads where project_id='${projectId}';
`);
  const getCount = (kind) => counts.find((x) => x.kind === kind)?.count || 0;
  results.push(assert("DB evidence has versions sources approved candidates", getCount("versions") >= 12 && getCount("sources") >= 12 && getCount("approved") >= 14 && getCount("events") >= 4 && getCount("characters") >= 2 && getCount("items") >= 2 && getCount("world_rules") >= 2 && getCount("foreshadowing") >= 2 && getCount("open_threads") >= 2, { counts }));

  const cleanup = await admin("/api/admin/story-bible/conflict-test", { action: "cleanup", projectId });
  await admin("/api/admin/story-bible/conflict-test", { action: "cleanup", projectId: otherProjectId });
  const cleanupCounts = await sql(`
select 'candidates' as kind, count(*)::int as count from public.story_fact_candidates where project_id='${projectId}'
union all select 'conflicts', count(*)::int from public.story_fact_conflicts where project_id='${projectId}'
union all select 'versions', count(*)::int from public.story_bible_versions where project_id='${projectId}'
union all select 'sources', count(*)::int from public.story_canonical_sources where project_id='${projectId}'
union all select 'bibles', count(*)::int from public.story_bibles where project_id='${projectId}';
`);
  const cleanCount = (kind) => cleanupCounts.find((x) => x.kind === kind)?.count || 0;
  results.push(assert("fixture cleanup removes story bible rows", cleanup.ok && cleanCount("candidates") === 0 && cleanCount("conflicts") === 0 && cleanCount("versions") === 0 && cleanCount("sources") === 0 && cleanCount("bibles") === 0, { cleanupStatus: cleanup.status, cleanupCounts }));
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

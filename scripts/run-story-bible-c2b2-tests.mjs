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

  const counts = await sql(`
select 'versions' as kind, count(*)::int as count from public.story_bible_versions where project_id='${projectId}'
union all select 'sources', count(*)::int from public.story_canonical_sources where project_id='${projectId}'
union all select 'approved', count(*)::int from public.story_fact_candidates where project_id='${projectId}' and status='approved'
union all select 'events', count(*)::int from public.story_events where project_id='${projectId}';
`);
  const getCount = (kind) => counts.find((x) => x.kind === kind)?.count || 0;
  results.push(assert("DB evidence has versions sources approved candidates", getCount("versions") >= 2 && getCount("sources") >= 2 && getCount("approved") >= 3 && getCount("events") >= 1, { counts }));

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

const baseUrl = process.env.BASE_URL || "https://novel-orcin.vercel.app";
const adminToken = process.env.ADMIN_TOKEN || "";
const projectId = process.env.P0C2B1_PROJECT_ID || `p0c2b1-reject-${Date.now()}`;
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
    headers: {
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { ok: res.ok, status: res.status, body, headers: Object.fromEntries(res.headers.entries()) };
}

async function admin(path, body) {
  return request(path, {
    method: "POST",
    headers: { "x-admin-token": adminToken },
    body: JSON.stringify(body),
  });
}

async function supabaseSql(sql) {
  if (!supabaseToken || !supabaseProjectRef) return { skipped: true, rows: [] };
  const res = await fetch(`https://api.supabase.com/v1/projects/${supabaseProjectRef}/database/query`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${supabaseToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`SUPABASE_SQL_${res.status}:${JSON.stringify(body).slice(0, 500)}`);
  return body;
}

function mutationBody(candidate, requestId, overrides = {}) {
  return {
    projectId,
    reviewerId: "p0c2b1-reviewer",
    requestId,
    expectedCandidateStatus: candidate.status,
    expectedStoryBibleVersion: 0,
    reviewReason: "P0-C2B1 reject smoke test.",
    ...overrides,
  };
}

const health = await request("/api/ai/health");
results.push(assert("health returns P0-C2B1 semantics", health.ok
  && health.body?.releaseTag === "novel-ai-p0c2b1-mutation-foundation"
  && (!expectedCommit || health.body?.appCommit === expectedCommit)
  && (!expectedDeploymentId || health.body?.deploymentId === expectedDeploymentId)
  && String(health.body?.migrationVersion || "").includes("p0c2b1_mutation_foundation_005")
  && health.body?.storyBibleApprovalStatus === "partial"
  && health.body?.storyBibleVersioningStatus === "schema_ready"
  && health.body?.storyBibleConflictEngineStatus === "ready", {
    status: health.status,
    appCommit: health.body?.appCommit,
    deploymentId: health.body?.deploymentId,
    releaseTag: health.body?.releaseTag,
    migrationVersion: health.body?.migrationVersion,
    approval: health.body?.storyBibleApprovalStatus,
    versioning: health.body?.storyBibleVersioningStatus,
    conflict: health.body?.storyBibleConflictEngineStatus,
  }));

const noAdmin = await request("/api/story-bible/candidates/not-real/reject", {
  method: "POST",
  body: JSON.stringify({}),
});
results.push(assert("reject requires admin token", noAdmin.status === 401 || noAdmin.status === 503, { status: noAdmin.status, body: noAdmin.body }));

const invalidBody = await admin("/api/story-bible/candidates/not-real/reject", { projectId });
results.push(assert("reject invalid body returns 400", invalidBody.status === 400, { status: invalidBody.status, body: invalidBody.body }));

if (!adminToken) {
  results.push(assert("admin token provided for mutation tests", false, { reason: "ADMIN_TOKEN missing" }));
} else {
  const injected = await admin("/api/admin/story-bible/conflict-test", { action: "run", projectId });
  results.push(assert("fixture injection created candidates", injected.ok && injected.body?.persisted?.candidateCount >= 10, {
    status: injected.status,
    persisted: injected.body?.persisted,
  }));

  const candidatesRes = await request(`/api/story-bible/candidates?projectId=${projectId}&limit=50`);
  const candidates = candidatesRes.body?.candidates || [];
  const pending = candidates.find((x) => x.status === "pending");
  const needsReview = candidates.find((x) => x.status === "needs_review");
  results.push(assert("candidate list has pending and needs_review", candidatesRes.ok && pending && needsReview, {
    count: candidates.length,
    pending: pending?.id,
    needsReview: needsReview?.id,
  }));

  const wrongProject = pending ? await admin(`/api/story-bible/candidates/${pending.id}/reject`, {
    ...mutationBody(pending, `req_wrong_${Date.now()}`),
    projectId: otherProjectId,
  }) : { status: 0, body: null };
  results.push(assert("wrong project cannot reject candidate", wrongProject.status === 404, { status: wrongProject.status, body: wrongProject.body }));

  const rejectReq = `req_reject_${Date.now()}`;
  const rejected = pending ? await admin(`/api/story-bible/candidates/${pending.id}/reject`, mutationBody(pending, rejectReq)) : { ok: false, status: 0, body: null };
  results.push(assert("reject pending candidate succeeds", rejected.ok && rejected.body?.status === "rejected" && rejected.body?.canonicalChanged === false, {
    status: rejected.status,
    body: rejected.body,
  }));

  const detail = pending ? await request(`/api/story-bible/candidates/${pending.id}?projectId=${projectId}`) : { ok: false, body: null };
  results.push(assert("rejected candidate audit fields persisted", detail.ok
    && detail.body?.candidate?.status === "rejected"
    && detail.body?.candidate?.previous_status === "pending"
    && detail.body?.candidate?.reviewer_id === "p0c2b1-reviewer"
    && detail.body?.candidate?.request_id === rejectReq, {
      candidate: detail.body?.candidate,
    }));

  const replay = pending ? await admin(`/api/story-bible/candidates/${pending.id}/reject`, mutationBody(pending, rejectReq)) : { ok: false, body: null };
  results.push(assert("same requestId same payload replays idempotently", replay.ok && replay.body?.idempotentReplay === true, {
    status: replay.status,
    body: replay.body,
  }));

  const keyReuse = pending ? await admin(`/api/story-bible/candidates/${pending.id}/reject`, {
    ...mutationBody(pending, rejectReq),
    reviewReason: "Different payload should fail.",
  }) : { status: 0, body: null };
  results.push(assert("same requestId different payload returns 409", keyReuse.status === 409 && keyReuse.body?.errorCode === "IDEMPOTENCY_KEY_REUSED", {
    status: keyReuse.status,
    body: keyReuse.body,
  }));

  const secondReject = pending ? await admin(`/api/story-bible/candidates/${pending.id}/reject`, mutationBody(pending, `req_status_${Date.now()}`)) : { status: 0, body: null };
  results.push(assert("new reject on already rejected candidate returns status mismatch", secondReject.status === 409 && secondReject.body?.errorCode === "CANDIDATE_STATUS_MISMATCH", {
    status: secondReject.status,
    body: secondReject.body,
  }));

  const needsReq = `req_needs_${Date.now()}`;
  const rejectNeeds = needsReview ? await admin(`/api/story-bible/candidates/${needsReview.id}/reject`, mutationBody(needsReview, needsReq)) : { ok: false, body: null };
  results.push(assert("reject needs_review candidate succeeds", rejectNeeds.ok && rejectNeeds.body?.previousStatus === "needs_review" && rejectNeeds.body?.status === "rejected", {
    status: rejectNeeds.status,
    body: rejectNeeds.body,
  }));

  const approve = needsReview ? await admin(`/api/story-bible/candidates/${needsReview.id}/approve`, mutationBody(needsReview, `req_approve_${Date.now()}`)) : { status: 0, body: null };
  results.push(assert("approve is explicitly not implemented in C2B1", approve.status === 501 && approve.body?.errorCode === "MUTATION_NOT_IMPLEMENTED", {
    status: approve.status,
    body: approve.body,
  }));

  const editApprove = needsReview ? await admin(`/api/story-bible/candidates/${needsReview.id}/edit-and-approve`, {
    ...mutationBody(needsReview, `req_edit_${Date.now()}`),
    editedValue: "作者宣告值",
    editReason: "P0-C2B1 route contract only.",
    sourceMode: "author-declared",
  }) : { status: 0, body: null };
  results.push(assert("edit-and-approve is explicitly not implemented in C2B1", editApprove.status === 501 && editApprove.body?.errorCode === "MUTATION_NOT_IMPLEMENTED", {
    status: editApprove.status,
    body: editApprove.body,
  }));

  const mutationRows = await supabaseSql(`
select request_id, project_id, operation, status, error_code, response_json
from public.story_bible_mutation_requests
where project_id='${projectId}'
order by created_at asc;
`);
  if (mutationRows.skipped) {
    results.push(assert("mutation request rows query skipped", true, { reason: "SUPABASE env not provided" }));
  } else {
    const rows = mutationRows.result || [];
    results.push(assert("mutation request rows persisted", rows.some((row) => row.request_id === rejectReq && row.status === "completed") && rows.some((row) => row.error_code === "CANDIDATE_STATUS_MISMATCH"), {
      rows,
    }));
  }

  const cleanup = await admin("/api/admin/story-bible/conflict-test", { action: "cleanup", projectId });
  const cleanupCounts = await supabaseSql(`
select 'candidates' as kind, count(*)::int as count from public.story_fact_candidates where project_id='${projectId}'
union all select 'conflicts', count(*)::int from public.story_fact_conflicts where project_id='${projectId}'
union all select 'mutation_requests', count(*)::int from public.story_bible_mutation_requests where project_id='${projectId}'
union all select 'bibles', count(*)::int from public.story_bibles where project_id='${projectId}';
`);
  const cleanedRows = cleanupCounts.result || [];
  results.push(assert("test data cleanup removed story rows", cleanup.ok
    && cleanedRows.find((x) => x.kind === "candidates")?.count === 0
    && cleanedRows.find((x) => x.kind === "conflicts")?.count === 0
    && cleanedRows.find((x) => x.kind === "bibles")?.count === 0, {
      cleanupStatus: cleanup.status,
      counts: cleanedRows,
    }));
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

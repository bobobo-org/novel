const baseUrl = process.env.NOVEL_BASE_URL || "https://novel-orcin.vercel.app";
const adminToken = process.env.ADMIN_TOKEN || "";
const managementToken = process.env.SUPABASE_MANAGEMENT_TOKEN || "";
const supabaseProjectRef = process.env.SUPABASE_PROJECT_REF || "ijjicaiiirkfbewbhepx";
const projectId = process.env.P0C2A_PROJECT_ID || `p0c2a-conflict-${Date.now()}`;
const otherProjectId = `${projectId}-other`;
const expectedCommit = process.env.EXPECTED_APP_COMMIT || "";
const expectedDeploymentId = process.env.EXPECTED_DEPLOYMENT_ID || "";

async function request(path, init = {}) {
  const started = Date.now();
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { status: res.status, ok: res.ok, elapsedMs: Date.now() - started, body };
}

function adminHeaders(extra = {}) {
  return { "content-type": "application/json", "x-admin-token": adminToken, ...extra };
}

function assert(name, condition, detail = {}) {
  return { name, status: condition ? "PASS" : "FAIL", detail };
}

async function supabaseQuery(query) {
  if (!managementToken) return { skipped: true };
  const res = await fetch(`https://api.supabase.com/v1/projects/${supabaseProjectRef}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${managementToken}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, body };
}

async function cleanup() {
  if (!adminToken) return { status: "skipped", reason: "ADMIN_TOKEN not provided" };
  return request("/api/admin/story-bible/conflict-test", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ action: "cleanup", projectId }),
  });
}

const results = [];
const beforeCounts = await supabaseQuery(`
select 'candidates' as kind, count(*)::int as count from public.story_fact_candidates where project_id='${projectId}'
union all select 'conflicts', count(*)::int from public.story_fact_conflicts where project_id='${projectId}';
`);
await cleanup();

const health1 = await request("/api/ai/health");
await new Promise((resolve) => setTimeout(resolve, 10000));
const health2 = await request("/api/ai/health");
const health3 = await request(`/api/ai/health?cb=${Date.now()}`);
for (const [name, health] of [["health normal", health1], ["health after 10s", health2], ["health cache busting", health3]]) {
  results.push(assert(name, health.ok &&
    (!expectedCommit || health.body.appCommit === expectedCommit) &&
    health.body.releaseTag === "novel-ai-p0c2a-conflict-engine" &&
    (!expectedDeploymentId || health.body.deploymentId === expectedDeploymentId) &&
    String(health.body.migrationVersion || "").includes("p0c2a_conflict_engine_004") &&
    health.body.storyBibleApprovalStatus === "not_implemented" &&
    health.body.storyBibleVersioningStatus === "schema_ready" &&
    health.body.storyBibleConflictEngineStatus === "ready", {
      status: health.status,
      appCommit: health.body.appCommit,
      releaseTag: health.body.releaseTag,
      deploymentId: health.body.deploymentId,
      migrationVersion: health.body.migrationVersion,
      approval: health.body.storyBibleApprovalStatus,
      versioning: health.body.storyBibleVersioningStatus,
      conflict: health.body.storyBibleConflictEngineStatus,
    }));
}

const missingProject = await request("/api/story-bible/candidates");
results.push(assert("candidate list without projectId returns 400", missingProject.status === 400, { status: missingProject.status }));

const guessed = await request(`/api/story-bible/candidates/not-real-candidate?projectId=${projectId}`);
results.push(assert("guessed candidate id returns 404", guessed.status === 404, { status: guessed.status }));

if (!adminToken) {
  results.push(assert("admin token is configured for conflict injection", false, { reason: "ADMIN_TOKEN not provided" }));
} else {
  const injected = await request("/api/admin/story-bible/conflict-test", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ action: "run", projectId }),
  });
  results.push(assert("admin fixture injection uses formal persistence flow", injected.ok && injected.body?.persisted?.candidateCount >= 10, {
    status: injected.status,
    persisted: injected.body?.persisted,
  }));
}

const candidatesRes = await request(`/api/story-bible/candidates?projectId=${projectId}&limit=50`);
const candidates = candidatesRes.body?.candidates || [];
const conflictsRes = await request(`/api/story-bible/conflicts?projectId=${projectId}&limit=100`);
const conflicts = conflictsRes.body?.conflicts || [];
const conflictsByType = Object.fromEntries(Object.entries(conflicts.reduce((acc, row) => {
  acc[row.conflict_type] = (acc[row.conflict_type] || 0) + 1;
  return acc;
}, {})).sort());
const severityCounts = Object.fromEntries(Object.entries(conflicts.reduce((acc, row) => {
  acc[row.severity] = (acc[row.severity] || 0) + 1;
  return acc;
}, {})).sort());

results.push(assert("candidate list can read injected project", candidatesRes.ok && candidates.length >= 10, { status: candidatesRes.status, count: candidates.length }));
results.push(assert("conflict list can read injected project", conflictsRes.ok && conflicts.length >= 9, { status: conflictsRes.status, count: conflicts.length, conflictsByType, severityCounts }));

const requiredConflictTypes = [
  "low_trust_local_rule",
  "cloud_output_repaired",
  "source_reference_invalid",
  "immutable_world_rule_change",
  "canonical_value_mismatch",
  "timeline_location_conflict",
  "item_double_owner",
  "paid_foreshadowing_reopened",
];
for (const type of requiredConflictTypes) {
  results.push(assert(`conflict type ${type} exists`, conflicts.some((row) => row.conflict_type === type), { count: conflictsByType[type] || 0 }));
}

const blocking = conflicts.find((row) => row.conflict_type === "immutable_world_rule_change");
results.push(assert("immutable world rule change is blocking", blocking?.severity === "blocking", { severity: blocking?.severity }));

const conflictComplete = conflicts.every((row) =>
  row.id && row.project_id && row.candidate_id && row.canonical_entity_type && row.canonical_entity_id &&
  row.field_path && row.severity && row.conflict_type && row.explanation && row.suggested_resolution !== undefined &&
  row.auto_resolvable !== undefined && row.confidence !== undefined && row.status && row.created_at
);
results.push(assert("conflict rows include required fields", conflictComplete, { checked: conflicts.length }));

const statusByEvidence = Object.fromEntries(candidates.map((row) => [row.reason, row.status]));
results.push(assert("local-rule candidate is needs_review", statusByEvidence["local-rule候選需人工確認。"] === "needs_review", { status: statusByEvidence["local-rule候選需人工確認。"] }));
results.push(assert("cloud-repaired candidate is needs_review", statusByEvidence["cloud-repaired候選需顯示修復痕跡。"] === "needs_review", { status: statusByEvidence["cloud-repaired候選需顯示修復痕跡。"] }));
results.push(assert("invalid source candidate is needs_review", statusByEvidence["source excerpt不存在於chapterText。"] === "needs_review", { status: statusByEvidence["source excerpt不存在於chapterText。"] }));
results.push(assert("exact match does not create major conflict", !conflicts.some((row) => row.proposed_value === 28 && row.conflict_type === "canonical_value_mismatch"), {}));
results.push(assert("cloud-validated no-conflict candidate stays pending", statusByEvidence["cloud-validated無衝突候選。"] === "pending", { status: statusByEvidence["cloud-validated無衝突候選。"] }));

const firstCandidate = candidates[0];
const detail = firstCandidate ? await request(`/api/story-bible/candidates/${firstCandidate.id}?projectId=${projectId}`) : { ok: false, status: 0, body: null };
results.push(assert("candidate detail contains source refs", detail.ok && Array.isArray(detail.body?.sourceRefs) && detail.body.sourceRefs.length >= 1, { status: detail.status, sourceRefs: detail.body?.sourceRefs?.length || 0 }));
const crossProjectDetail = firstCandidate ? await request(`/api/story-bible/candidates/${firstCandidate.id}?projectId=${otherProjectId}`) : { status: 0 };
results.push(assert("project isolation blocks candidate cross-read", crossProjectDetail.status === 404, { status: crossProjectDetail.status }));

const majorFilter = await request(`/api/story-bible/conflicts?projectId=${projectId}&conflictSeverity=major&limit=50`);
results.push(assert("conflict severity filter works", majorFilter.ok && majorFilter.body.conflicts.every((row) => row.severity === "major"), { count: majorFilter.body?.conflicts?.length || 0 }));
const itemFilter = await request(`/api/story-bible/conflicts?projectId=${projectId}&entityType=item&limit=50`);
results.push(assert("conflict entityType filter works", itemFilter.ok && itemFilter.body.conflicts.every((row) => row.canonical_entity_type === "item"), { count: itemFilter.body?.conflicts?.length || 0 }));
const firstConflict = conflicts[0];
const candidateIdFilter = firstConflict ? await request(`/api/story-bible/conflicts?projectId=${projectId}&candidateId=${firstConflict.candidate_id}&limit=50`) : { ok: false, body: { conflicts: [] } };
results.push(assert("conflict candidateId filter works", candidateIdFilter.ok && candidateIdFilter.body.conflicts.every((row) => row.candidate_id === firstConflict.candidate_id), { count: candidateIdFilter.body?.conflicts?.length || 0 }));
const conflictDetail = firstConflict ? await request(`/api/story-bible/conflicts/${firstConflict.id}?projectId=${projectId}`) : { ok: false, status: 0, body: null };
results.push(assert("conflict detail is complete", conflictDetail.ok && conflictDetail.body?.conflict?.id === firstConflict.id && conflictDetail.body?.candidate, { status: conflictDetail.status }));
const crossProjectConflict = firstConflict ? await request(`/api/story-bible/conflicts/${firstConflict.id}?projectId=${otherProjectId}`) : { status: 0 };
results.push(assert("project isolation blocks conflict cross-read", crossProjectConflict.status === 404, { status: crossProjectConflict.status }));

const afterCounts = await supabaseQuery(`
select 'candidates' as kind, count(*)::int as count from public.story_fact_candidates where project_id='${projectId}'
union all select 'conflicts', count(*)::int from public.story_fact_conflicts where project_id='${projectId}'
union all select 'story_characters', count(*)::int from public.story_characters where project_id='${projectId}'
union all select 'story_world_rules', count(*)::int from public.story_world_rules where project_id='${projectId}'
union all select 'story_items', count(*)::int from public.story_items where project_id='${projectId}'
union all select 'story_foreshadowing', count(*)::int from public.story_foreshadowing where project_id='${projectId}';
`);

const cleanupRes = await cleanup();
const cleanupCounts = await supabaseQuery(`
select 'candidates' as kind, count(*)::int as count from public.story_fact_candidates where project_id='${projectId}'
union all select 'conflicts', count(*)::int from public.story_fact_conflicts where project_id='${projectId}'
union all select 'bibles', count(*)::int from public.story_bibles where project_id='${projectId}';
`);
results.push(assert("test data cleanup removed project rows", cleanupRes.ok && cleanupCounts.ok && cleanupCounts.body.every((row) => row.count === 0), {
  cleanupStatus: cleanupRes.status,
  cleanupCounts: cleanupCounts.body,
}));

const summary = {
  baseUrl,
  projectId,
  pass: results.filter((x) => x.status === "PASS").length,
  fail: results.filter((x) => x.status === "FAIL").length,
  skip: results.filter((x) => x.status === "SKIP").length,
  beforeCounts: beforeCounts.body,
  afterCounts: afterCounts.body,
  severityCounts,
  conflictsByType,
};

console.log(JSON.stringify({ summary, results }, null, 2));
process.exitCode = summary.fail ? 1 : 0;

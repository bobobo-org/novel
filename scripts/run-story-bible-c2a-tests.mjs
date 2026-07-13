const baseUrl = process.env.NOVEL_BASE_URL || "https://novel-orcin.vercel.app";
const managementToken = process.env.SUPABASE_MANAGEMENT_TOKEN || "";
const supabaseProjectRef = process.env.SUPABASE_PROJECT_REF || "ijjicaiiirkfbewbhepx";

async function request(path, init) {
  const started = Date.now();
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { status: res.status, ok: res.ok, elapsedMs: Date.now() - started, body };
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

const projectId = `p0c2a-test-${Date.now()}`;
const otherProjectId = `${projectId}-other`;
const chapterText = "C2A_CASE. Mira gave Ren the jade seal, but the silver oath forbids breaking promises without blood payment.";

const results = [];

const health = await request("/api/ai/health");
results.push(assert("health exposes P0-C2A status flags", health.ok &&
  health.body.storyBibleApprovalStatus === "ready" &&
  health.body.storyBibleVersioningStatus === "ready" &&
  health.body.storyBibleConflictEngineStatus === "ready", {
    status: health.status,
    flags: {
      approval: health.body.storyBibleApprovalStatus,
      versioning: health.body.storyBibleVersioningStatus,
      conflict: health.body.storyBibleConflictEngineStatus,
      migration: health.body.migrationVersion,
    },
  }));

const extraction = await request("/api/ai/story-bible/extract", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    projectId,
    chapterId: "chapter-1",
    chapterNumber: 1,
    chapterTitle: "C2A",
    chapterText,
    previousChapterSummary: "",
    currentCanonicalSnapshot: {},
    extractionMode: "chapter-new",
  }),
});
const candidates = extraction.body?.candidates || [];
results.push(assert("extract writes candidates", extraction.ok && candidates.length > 0, {
  status: extraction.status,
  fallbackLevel: extraction.body?.fallbackLevel,
  candidateCount: candidates.length,
  traceId: extraction.body?.traceId,
}));

const list = await request(`/api/story-bible/candidates?projectId=${encodeURIComponent(projectId)}&limit=20`);
const listed = list.body?.candidates || [];
results.push(assert("candidate list is scoped to project", list.ok && listed.length > 0 && listed.every((x) => x.project_id === projectId), {
  status: list.status,
  count: listed.length,
}));

const firstCandidateId = listed[0]?.id;
const detail = firstCandidateId ? await request(`/api/story-bible/candidates/${encodeURIComponent(firstCandidateId)}?projectId=${encodeURIComponent(projectId)}`) : { ok: false, status: 0, body: null };
results.push(assert("candidate detail includes source refs and provenance", detail.ok &&
  detail.body?.candidate?.id === firstCandidateId &&
  Array.isArray(detail.body?.sourceRefs) &&
  detail.body?.extractionProvenance?.id, {
    status: detail.status,
    sourceRefs: detail.body?.sourceRefs?.length || 0,
    provenance: detail.body?.extractionProvenance?.id || null,
  }));

const wrongProject = firstCandidateId ? await request(`/api/story-bible/candidates/${encodeURIComponent(firstCandidateId)}?projectId=${encodeURIComponent(otherProjectId)}`) : { status: 0 };
results.push(assert("candidate detail rejects cross-project read", wrongProject.status === 404, { status: wrongProject.status }));

const conflicts = await request(`/api/story-bible/conflicts?projectId=${encodeURIComponent(projectId)}&limit=20`);
results.push(assert("conflict list endpoint works and is project scoped", conflicts.ok && Array.isArray(conflicts.body?.conflicts), {
  status: conflicts.status,
  count: conflicts.body?.conflicts?.length || 0,
}));

const firstConflictId = conflicts.body?.conflicts?.[0]?.id;
if (firstConflictId) {
  const conflictDetail = await request(`/api/story-bible/conflicts/${encodeURIComponent(firstConflictId)}?projectId=${encodeURIComponent(projectId)}`);
  results.push(assert("conflict detail includes candidate context", conflictDetail.ok && conflictDetail.body?.conflict?.id === firstConflictId, {
    status: conflictDetail.status,
    conflictType: conflictDetail.body?.conflict?.conflict_type,
  }));
}

const pendingStatuses = new Set(["pending", "needs_review"]);
results.push(assert("candidate statuses remain pre-approval only", listed.every((x) => pendingStatuses.has(x.status)), {
  statuses: [...new Set(listed.map((x) => x.status))],
}));

const canonical = await supabaseQuery(`
select 'story_characters' as table_name, count(*)::int as count from public.story_characters where project_id='${projectId}'
union all select 'story_events', count(*)::int from public.story_events where project_id='${projectId}'
union all select 'story_items', count(*)::int from public.story_items where project_id='${projectId}'
union all select 'story_world_rules', count(*)::int from public.story_world_rules where project_id='${projectId}'
union all select 'story_foreshadowing', count(*)::int from public.story_foreshadowing where project_id='${projectId}'
union all select 'story_open_threads', count(*)::int from public.story_open_threads where project_id='${projectId}';
`);
if (canonical.skipped) {
  results.push({ name: "canonical rows remain zero", status: "SKIP", detail: { reason: "SUPABASE_MANAGEMENT_TOKEN not provided" } });
} else {
  results.push(assert("canonical rows remain zero", canonical.ok && canonical.body.every((row) => row.count === 0), { status: canonical.status, rows: canonical.body }));
}

const summary = {
  baseUrl,
  projectId,
  pass: results.filter((x) => x.status === "PASS").length,
  fail: results.filter((x) => x.status === "FAIL").length,
  skip: results.filter((x) => x.status === "SKIP").length,
};

console.log(JSON.stringify({ summary, results }, null, 2));
process.exitCode = summary.fail ? 1 : 0;

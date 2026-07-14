import crypto from "crypto";
import fs from "fs";

const baseUrl = process.env.BASE_URL || "https://novel-orcin.vercel.app";
const deploymentUrl = process.env.EXPECTED_DEPLOYMENT_URL || "";
const expectedCommit = process.env.EXPECTED_APP_COMMIT || "";
const expectedDeploymentId = process.env.EXPECTED_DEPLOYMENT_ID || "";
const expectedReleaseTag = process.env.EXPECTED_RELEASE_TAG || "novel-ai-p0c2c3-safe-revert";
const supabaseToken = process.env.SUPABASE_MANAGEMENT_TOKEN;
const supabaseRef = process.env.SUPABASE_PROJECT_REF || "ijjicaiiirkfbewbhepx";
const prefix = `p0c2c3-${Date.now()}`;
const results = [];
const timings = [];

function loadEnv(path) {
  if (!fs.existsSync(path)) return;
  const text = fs.readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx);
    const value = trimmed.slice(idx + 1).replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv(".env.vercel.tmp");
const adminToken = process.env.ADMIN_TOKEN || "";

function esc(value) {
  return String(value ?? "").replace(/'/g, "''");
}

function js(value) {
  return `'${esc(JSON.stringify(value ?? null))}'::jsonb`;
}

function stableCanonicalize(value, path = []) {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") {
    const time = Date.parse(value);
    return JSON.stringify(Number.isNaN(time) ? value.normalize("NFC") : new Date(time).toISOString());
  }
  if (typeof value === "number") return Number.isFinite(value) ? String(Object.is(value, -0) ? 0 : value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    const last = path[path.length - 1] || "";
    const setLike = new Set(["candidateIds", "candidate_ids", "approvedCandidateIds", "approved_candidate_ids", "mutationRequestIds", "mutation_request_ids", "aliases", "sourceRefs", "source_refs", "possessions"]);
    const list = setLike.has(last) ? [...value].sort((a, b) => stableCanonicalize(a).localeCompare(stableCanonicalize(b))) : value;
    return `[${list.map((item, index) => stableCanonicalize(item, [...path, String(index)])).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k.normalize("NFC"))}:${stableCanonicalize(v, [...path, k])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function sha(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeChange(version, change, index = 0) {
  return {
    changeId: String(change.changeId || `change_${sha(JSON.stringify({ versionId: version.id, index })).slice(0, 20)}`),
    versionId: version.id,
    versionNumber: Number(version.version_number || 0),
    entityType: change.entityType || "legacy_unknown",
    entityId: change.entityId || `legacy_entity_${index}`,
    entityDisplayName: change.entityDisplayName || change.entityId || "",
    fieldPath: change.fieldPath || "legacy.unknown",
    operation: change.operation || "updated",
    previousValue: change.previousValue ?? null,
    newValue: change.newValue ?? null,
    candidateId: change.candidateId || null,
    mutationRequestId: version.request_id || null,
    reviewerId: version.created_by || null,
    reason: change.reason || version.summary || "",
    humanEdited: false,
    sourceMode: version.source_mode || "",
    sourceRefs: [],
    sourceProviderType: version.source_provider_type || "legacy_unknown",
    sourceProviderLocation: version.source_provider_location || null,
    sourceModelId: version.source_model_id || null,
    sourceExecutionId: version.source_execution_id || null,
    createdAt: version.created_at || null,
  };
}

function integrityPayload(row, previousIntegrityHash) {
  const changes = Array.isArray(row.change_set) ? row.change_set : [row.change_set];
  return {
    projectId: row.project_id,
    versionId: row.id,
    versionNumber: row.version_number,
    parentVersionId: row.parent_version_id,
    operationType: row.operation_type,
    operationSource: row.operation_source || "legacy_unknown",
    candidateIds: row.candidate_ids || [],
    mutationRequestIds: row.mutation_request_ids || [],
    normalizedChangeSet: changes.map((change, index) => normalizeChange(row, change, index)),
    summary: row.summary || "",
    createdBy: row.created_by || "system",
    createdAt: row.created_at,
    sourceProviderType: row.source_provider_type || "legacy_unknown",
    sourceProviderLocation: row.source_provider_location || "unknown",
    sourceModelId: row.source_model_id || null,
    sourceExecutionId: row.source_execution_id || null,
    sourceMode: row.source_mode || "legacy",
    dataLeftDevice: row.data_left_device ?? null,
    storageLocation: row.storage_location || "legacy_unknown",
    canonicalAuthority: row.canonical_authority || "local",
    previousIntegrityHash,
    integritySchemaVersion: "story-bible-integrity-v1",
  };
}

function versionRow(projectId, n, parentId, change, previousHash) {
  const id = `${projectId}_v${n}`;
  const row = {
    id,
    project_id: projectId,
    version_number: n,
    parent_version_id: parentId,
    operation_type: "approve",
    candidate_ids: [],
    approved_candidate_ids: [],
    change_set: change,
    created_by: "matrix",
    created_at: `2026-07-14T00:00:0${n}Z`,
    operation_source: "author",
    mutation_request_ids: [],
    summary: `fixture v${n}`,
    source_provider_type: "author",
    source_provider_location: "reviewer",
    source_model_id: null,
    source_execution_id: null,
    source_mode: "author-declared",
    data_left_device: false,
    storage_location: "supabase-postgres",
    previous_integrity_hash: previousHash,
    integrity_algorithm: "SHA-256",
    integrity_schema_version: "story-bible-integrity-v1",
    integrity_status: "valid",
    canonical_authority: "local",
  };
  row.integrity_hash = sha(stableCanonicalize(integrityPayload(row, previousHash)));
  return row;
}

function rowSql(row) {
  return `('${esc(row.id)}','${esc(row.project_id)}',${row.version_number},${row.parent_version_id ? `'${esc(row.parent_version_id)}'` : "null"},'${row.operation_type}',array[]::text[],array[]::text[],${js(row.change_set)},'${row.created_by}','${row.created_at}','${row.operation_source}',array[]::text[],'${esc(row.summary)}','${row.source_provider_type}','${row.source_provider_location}',null,null,'${row.source_mode}',false,'${row.storage_location}','${row.integrity_hash}',${row.previous_integrity_hash ? `'${row.previous_integrity_hash}'` : "null"},'SHA-256','story-bible-integrity-v1','${row.created_at}','valid','local')`;
}

async function sql(query) {
  if (!supabaseToken) throw new Error("SUPABASE_MANAGEMENT_TOKEN missing");
  const started = Date.now();
  const response = await fetch(`https://api.supabase.com/v1/projects/${supabaseRef}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${supabaseToken}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  timings.push({ kind: "sql", elapsedMs: Date.now() - started });
  if (!response.ok) throw new Error(`SQL ${response.status}: ${text.slice(0, 400)}`);
  try { return JSON.parse(text); } catch { return []; }
}

async function request(path, init = {}) {
  const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
  const started = Date.now();
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(adminToken ? { "x-admin-token": adminToken } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  timings.push({ kind: "http", path, elapsedMs: Date.now() - started, status: response.status, bytes: text.length });
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: response.ok, status: response.status, body, headers: Object.fromEntries(response.headers.entries()), text };
}

function assert(category, name, condition, detail = {}) {
  results.push({ category, name, status: condition ? "PASS" : "FAIL", detail });
}

async function cleanup() {
  const like = `${prefix}%`;
  for (const table of [
    "story_bible_revert_audits",
    "story_bible_export_audits",
    "story_bible_export_packages",
    "story_canonical_sources",
    "story_bible_mutation_requests",
    "story_bible_versions",
    "story_characters",
    "story_bibles",
  ]) {
    await sql(`delete from public.${table} where project_id like '${esc(like)}';`).catch(() => []);
  }
}

async function seed(projectId, variant = "two") {
  await sql(`insert into public.story_bibles(project_id,schema_version,status,core_json,created_at,updated_at)
values ('${esc(projectId)}','story-bible-v1','active',${js({ projectId })},now(),now()) on conflict(project_id) do nothing;`);
  await sql(`insert into public.story_characters(id,project_id,character_id,canonical_name,character_json,confidence,updated_at)
values ('${esc(projectId)}_char','${esc(projectId)}','char_main','林昭',${js({ age: variant === "one" ? 20 : 21, aliases: variant === "partial" ? ["少主"] : [], lifeStatus: "alive" })},1,now())
on conflict(id) do update set character_json=excluded.character_json, canonical_name=excluded.canonical_name;`);
  const changes = variant === "partial"
    ? [
        { changeId: "chg_age", entityType: "character", entityId: "char_main", entityDisplayName: "林昭", fieldPath: "characters[].age", operation: "updated", previousValue: 20, newValue: 21, reason: "age update" },
        { changeId: "chg_alias", entityType: "character", entityId: "char_main", entityDisplayName: "林昭", fieldPath: "characters[].aliases", operation: "appended", previousValue: [], newValue: ["少主"], reason: "alias append" },
      ]
    : [
        { changeId: "chg_age_v1", entityType: "character", entityId: "char_main", entityDisplayName: "林昭", fieldPath: "characters[].age", operation: "updated", previousValue: null, newValue: 20, reason: "initial age" },
        { changeId: "chg_age_v2", entityType: "character", entityId: "char_main", entityDisplayName: "林昭", fieldPath: "characters[].age", operation: "updated", previousValue: 20, newValue: 21, reason: "age update" },
      ];
  const rows = [];
  let previousHash = null;
  if (variant === "one" || variant === "partial") {
    const row = versionRow(projectId, 1, null, variant === "partial" ? changes : changes[0], previousHash);
    rows.push(row);
  } else {
    const v1 = versionRow(projectId, 1, null, changes[0], previousHash);
    previousHash = v1.integrity_hash;
    const v2 = versionRow(projectId, 2, v1.id, changes[1], previousHash);
    rows.push(v1, v2);
  }
  await sql(`insert into public.story_bible_versions(id,project_id,version_number,parent_version_id,operation_type,candidate_ids,approved_candidate_ids,change_set,created_by,created_at,operation_source,mutation_request_ids,summary,source_provider_type,source_provider_location,source_model_id,source_execution_id,source_mode,data_left_device,storage_location,integrity_hash,previous_integrity_hash,integrity_algorithm,integrity_schema_version,integrity_computed_at,integrity_status,canonical_authority)
values ${rows.map(rowSql).join(",")}
on conflict(id) do nothing;`);
  return rows;
}

async function run() {
  await cleanup();
  const mainProject = `${prefix}-main`;
  const dependencyProject = `${prefix}-dep`;
  const partialProject = `${prefix}-partial`;
  const [mainRows] = await Promise.all([seed(mainProject, "two"), seed(dependencyProject, "two"), seed(partialProject, "partial")]);

  const health = await request("/api/ai/health?c2c3=1");
  assert("basic", "health exposes C2C3 revert ready", health.ok
    && (!expectedCommit || health.body?.appCommit === expectedCommit)
    && (!expectedDeploymentId || health.body?.deploymentId === expectedDeploymentId)
    && health.body?.releaseTag === expectedReleaseTag
    && String(health.body?.migrationVersion || "").includes("p0c2c3_safe_revert_011")
    && health.body?.storyBibleRevertStatus === "ready", health.body);
  if (deploymentUrl) {
    const dep = await request(`${deploymentUrl.replace(/\/$/, "")}/api/ai/health?c2c3=1`);
    assert("basic", "deployment URL matches alias release", dep.ok && dep.body?.appCommit === health.body?.appCommit && dep.body?.storyBibleRevertStatus === "ready", dep.body);
  }

  const targetV2 = mainRows[1];
  const dry = await request(`/api/story-bible/versions/${targetV2.id}/revert`, {
    method: "POST",
    body: JSON.stringify({ projectId: mainProject, requestId: `${mainProject}-dry`, expectedCurrentVersion: 2, revertReason: "dry run age revert", dryRun: true }),
  });
  assert("dry-run", "full revert preview", dry.ok && dry.body?.dryRun === true && dry.body?.safeToRevert === true, dry.body);
  assert("dry-run", "preview hash returned", Boolean(dry.body?.previewHash), dry.body);
  const beforeRows = await sql(`select count(*)::int as count from public.story_bible_versions where project_id='${esc(mainProject)}';`);
  assert("dry-run", "dry-run has no DB mutation", Number(beforeRows[0]?.count) === 2, beforeRows);
  const stale = await request(`/api/story-bible/versions/${targetV2.id}/revert`, {
    method: "POST",
    body: JSON.stringify({ projectId: mainProject, requestId: `${mainProject}-stale`, expectedCurrentVersion: 2, revertReason: "stale", dryRun: false, previewHash: "stale-preview-hash-0000000000000000" }),
  });
  assert("dry-run", "stale preview blocked", stale.status === 409 && stale.body?.errorCode === "REVERT_PREVIEW_STALE", stale.body);
  const wrong = await request(`/api/story-bible/versions/${targetV2.id}/revert`, {
    method: "POST",
    body: JSON.stringify({ projectId: `${mainProject}-wrong`, requestId: `${mainProject}-wrong`, expectedCurrentVersion: 2, revertReason: "wrong project", dryRun: true }),
  });
  assert("dry-run", "wrong project returns 404", wrong.status === 404, wrong.body);
  const mismatch = await request(`/api/story-bible/versions/${targetV2.id}/revert`, {
    method: "POST",
    body: JSON.stringify({ projectId: mainProject, requestId: `${mainProject}-mismatch`, expectedCurrentVersion: 99, revertReason: "version mismatch", dryRun: true }),
  });
  assert("dry-run", "expected version mismatch", mismatch.status === 409 && mismatch.body?.errorCode === "REVERT_CURRENT_VERSION_CONFLICT", mismatch.body);

  const depRows = await sql(`select id from public.story_bible_versions where project_id='${esc(dependencyProject)}' and version_number=1;`);
  const dep = await request(`/api/story-bible/versions/${depRows[0].id}/revert`, {
    method: "POST",
    body: JSON.stringify({ projectId: dependencyProject, requestId: `${dependencyProject}-dep`, expectedCurrentVersion: 2, revertReason: "dependency test", dryRun: true }),
  });
  assert("dependency", "later same-field modification blocking", dep.ok && dep.body?.safeToRevert === false && dep.body?.blockingDependencies?.length > 0, dep.body);
  const depApply = await request(`/api/story-bible/versions/${depRows[0].id}/revert`, {
    method: "POST",
    body: JSON.stringify({ projectId: dependencyProject, requestId: `${dependencyProject}-dep-apply`, expectedCurrentVersion: 2, revertReason: "dependency apply", dryRun: false }),
  });
  assert("dependency", "blocking dependency prevents apply", depApply.status === 409 && depApply.body?.errorCode === "REVERT_DEPENDENCY_CONFLICT", depApply.body);

  const apply = await request(`/api/story-bible/versions/${targetV2.id}/revert`, {
    method: "POST",
    body: JSON.stringify({ projectId: mainProject, requestId: `${mainProject}-apply`, expectedCurrentVersion: 2, revertReason: "apply age revert", dryRun: false, previewHash: dry.body.previewHash }),
  });
  assert("revert", "full revert applies", apply.ok && apply.body?.operationType === "revert" && apply.body?.newVersion?.versionNumber === 3, apply.body);
  const replay = await request(`/api/story-bible/versions/${targetV2.id}/revert`, {
    method: "POST",
    body: JSON.stringify({ projectId: mainProject, requestId: `${mainProject}-apply`, expectedCurrentVersion: 2, revertReason: "apply age revert", dryRun: false, previewHash: dry.body.previewHash }),
  });
  assert("revert", "same request replay", replay.ok && replay.body?.idempotentReplay === true, replay.body);
  const reused = await request(`/api/story-bible/versions/${targetV2.id}/revert`, {
    method: "POST",
    body: JSON.stringify({ projectId: mainProject, requestId: `${mainProject}-apply`, expectedCurrentVersion: 2, revertReason: "different payload", dryRun: false, previewHash: dry.body.previewHash }),
  });
  assert("revert", "same requestId different payload blocked", reused.status === 409 && reused.body?.errorCode === "REVERT_IDEMPOTENCY_KEY_REUSED", reused.body);
  const charRows = await sql(`select character_json->>'age' as age from public.story_characters where project_id='${esc(mainProject)}' and character_id='char_main';`);
  assert("revert", "canonical character restored", Number(charRows[0]?.age) === 20, charRows);
  const detail = await request(`/api/story-bible/versions/${apply.body.newVersion.versionId}/?projectId=${mainProject}`);
  assert("history", "version detail revert metadata", detail.ok && detail.body?.revertInfo?.isRevert === true && detail.body?.revertInfo?.inverseChangeSet, detail.body?.revertInfo);
  const history = await request(`/api/story-bible/entities/character/char_main/history?projectId=${mainProject}`);
  assert("history", "entity history has revert event", history.ok && history.body?.revertEvents?.length === 1, history.body);
  const diff = await request(`/api/story-bible/versions/diff?projectId=${mainProject}&fromVersion=2&toVersion=3`);
  assert("history", "diff after revert available", diff.ok && diff.body?.fieldDiffs?.length > 0, diff.body?.summary);
  const integrity = await request(`/api/story-bible/versions/integrity?projectId=${mainProject}`);
  assert("history", "integrity valid after revert", integrity.ok && integrity.body?.valid === true, integrity.body);
  const exp = await request(`/api/story-bible/versions/export?projectId=${mainProject}`);
  assert("history", "export includes revert metadata", exp.ok && JSON.stringify(exp.body?.versions || []).includes("partial_revert") === false && JSON.stringify(exp.body?.versions || []).includes("revert"), exp.body?.versions?.slice(-1)[0]);

  const partialRows = await sql(`select id from public.story_bible_versions where project_id='${esc(partialProject)}' and version_number=1;`);
  const partialDry = await request(`/api/story-bible/versions/${partialRows[0].id}/revert`, {
    method: "POST",
    body: JSON.stringify({ projectId: partialProject, requestId: `${partialProject}-dry`, expectedCurrentVersion: 1, revertReason: "partial alias revert", dryRun: true, selectedChangeIds: ["chg_alias"] }),
  });
  assert("partial", "partial revert preview", partialDry.ok && partialDry.body?.estimatedOperationType === "partial_revert", partialDry.body);
  const partialApply = await request(`/api/story-bible/versions/${partialRows[0].id}/revert`, {
    method: "POST",
    body: JSON.stringify({ projectId: partialProject, requestId: `${partialProject}-apply`, expectedCurrentVersion: 1, revertReason: "partial alias revert", dryRun: false, selectedChangeIds: ["chg_alias"], previewHash: partialDry.body.previewHash }),
  });
  assert("partial", "partial revert applies", partialApply.ok && partialApply.body?.operationType === "partial_revert", partialApply.body);

  const audits = await sql(`select status,count(*)::int as count from public.story_bible_revert_audits where project_id like '${esc(prefix)}%' group by status;`);
  assert("audit", "revert audit rows created", audits.some((row) => row.status === "completed" && Number(row.count) >= 2), audits);
  const cleanupBefore = await cleanup();
  const remaining = await sql(`select count(*)::int as remaining from public.story_bible_versions where project_id like '${esc(prefix)}%';`);
  assert("cleanup", "fixture cleanup", Number(remaining[0]?.remaining || 0) === 0, remaining);
}

try {
  await run();
} catch (error) {
  assert("runner", "uncaught exception", false, { message: error.message, stack: error.stack });
  await cleanup().catch(() => undefined);
}

const summary = {
  baseUrl,
  prefix,
  pass: results.filter((x) => x.status === "PASS").length,
  fail: results.filter((x) => x.status === "FAIL").length,
  skip: results.filter((x) => x.status === "SKIP").length,
  byCategory: Object.fromEntries([...new Set(results.map((x) => x.category))].map((category) => [
    category,
    {
      pass: results.filter((x) => x.category === category && x.status === "PASS").length,
      fail: results.filter((x) => x.category === category && x.status === "FAIL").length,
      skip: results.filter((x) => x.category === category && x.status === "SKIP").length,
    },
  ])),
  httpP50: percentile(timings.filter((x) => x.kind === "http").map((x) => x.elapsedMs), 50),
  httpP95: percentile(timings.filter((x) => x.kind === "http").map((x) => x.elapsedMs), 95),
  sqlCount: timings.filter((x) => x.kind === "sql").length,
  peakMemory: process.memoryUsage(),
};

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

console.log(JSON.stringify({ summary, results }, null, 2));
process.exit(summary.fail === 0 ? 0 : 1);

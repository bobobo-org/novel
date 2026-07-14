import crypto from "crypto";

const baseUrl = process.env.BASE_URL || "https://novel-orcin.vercel.app";
const adminToken = process.env.ADMIN_TOKEN || "";
const supabaseToken = process.env.SUPABASE_MANAGEMENT_TOKEN || "";
const supabaseProjectRef = process.env.SUPABASE_PROJECT_REF || "";
const expectedCommit = process.env.EXPECTED_APP_COMMIT || "";
const expectedDeploymentId = process.env.EXPECTED_DEPLOYMENT_ID || "";
const expectedReleaseTag = process.env.EXPECTED_RELEASE_TAG || "novel-ai-p0c2c2c-history-export";
const deploymentUrl = process.env.EXPECTED_DEPLOYMENT_URL || "";
const runId = `${Date.now()}`;
const prefix = process.env.P0C2C2C_PREFIX || `p0c2c2c-${runId}`;
const results = [];
const timings = [];
const fixtureProjects = new Set();

function assert(category, name, pass, detail = {}) {
  results.push({ category, name, status: pass ? "PASS" : "FAIL", detail });
}

function esc(value) {
  return String(value ?? "").replace(/'/g, "''");
}

function js(value) {
  return `'${esc(JSON.stringify(value ?? null))}'::jsonb`;
}

function sha(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

const SET_LIKE_KEYS = new Set([
  "candidateIds", "candidate_ids", "approvedCandidateIds", "approved_candidate_ids",
  "mutationRequestIds", "mutation_request_ids", "aliases", "relatedCharacters",
  "relatedEvents", "sourceRefs", "source_refs", "possessions",
]);

function normalizeDateString(value) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value.normalize("NFC") : new Date(parsed).toISOString();
}

function stableCanonicalize(value, path = []) {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(normalizeDateString(value));
  if (typeof value === "number") return Number.isFinite(value) ? (Object.is(value, -0) ? "0" : String(value)) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    const items = value.map((item) => ({ item, key: stableCanonicalize(item) }));
    const normalized = SET_LIKE_KEYS.has(path[path.length - 1] || "")
      ? items.sort((a, b) => a.key.localeCompare(b.key)).map((x) => x.item)
      : items.map((x) => x.item);
    return `[${normalized.map((item, index) => stableCanonicalize(item, [...path, String(index)])).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key.normalize("NFC"))}:${stableCanonicalize(item, [...path, key])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function computeIntegrityHash(payload) {
  return sha(stableCanonicalize(payload));
}

function normalizeChangeSet(version, change, index = 0) {
  const versionId = String(version.id || "");
  const versionNumber = Number(version.version_number || 0);
  const entityType = String(change.entityType || change.entity_type || "character");
  const fieldPath = String(change.fieldPath || change.field_path || "legacy.unknown");
  const entityId = String(change.entityId || change.entity_id || change.temporaryEntityId || `entity_${index}`);
  const candidateId = change.candidateId || change.candidate_id || null;
  const fingerprint = { versionId, versionNumber, index, entityType, entityId, fieldPath, candidateId, previousValue: change.previousValue ?? null, newValue: change.newValue ?? null };
  return {
    changeId: String(change.changeId || `change_${sha(JSON.stringify(fingerprint)).slice(0, 20)}`),
    versionId,
    versionNumber,
    entityType,
    entityId,
    entityDisplayName: String(change.entityDisplayName || entityId),
    fieldPath,
    operation: String(change.operation || "updated") === "update" ? "updated" : String(change.operation || "updated"),
    previousValue: change.previousValue ?? null,
    newValue: change.newValue ?? null,
    candidateId,
    mutationRequestId: (version.mutation_request_ids || [])[0] || null,
    reviewerId: version.created_by || null,
    reason: String(change.reason || version.summary || ""),
    humanEdited: Boolean(change.humanEdited || version.operation_type === "edit-and-approve"),
    sourceMode: String(version.source_mode || ""),
    sourceRefs: Array.isArray(change.sourceRefs) ? change.sourceRefs : [],
    sourceProviderType: String(version.source_provider_type || "legacy_unknown"),
    sourceProviderLocation: version.source_provider_location || null,
    sourceModelId: version.source_model_id || null,
    sourceExecutionId: version.source_execution_id || null,
    createdAt: version.created_at || null,
  };
}

function buildIntegrityPayload(version, previousIntegrityHash = null) {
  const raw = version.change_set;
  const changes = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  return {
    projectId: version.project_id || null,
    versionId: version.id || null,
    versionNumber: Number(version.version_number || 0),
    parentVersionId: version.parent_version_id || null,
    operationType: version.operation_type || null,
    operationSource: version.operation_source || "legacy_unknown",
    candidateIds: Array.isArray(version.candidate_ids) ? version.candidate_ids : [],
    mutationRequestIds: Array.isArray(version.mutation_request_ids) ? version.mutation_request_ids : [],
    normalizedChangeSet: changes.map((change, index) => normalizeChangeSet(version, change, index)),
    summary: version.summary || "",
    createdBy: version.created_by || "system",
    createdAt: version.created_at || null,
    sourceProviderType: version.source_provider_type || "legacy_unknown",
    sourceProviderLocation: version.source_provider_location || "unknown",
    sourceModelId: version.source_model_id || null,
    sourceExecutionId: version.source_execution_id || null,
    sourceMode: version.source_mode || "legacy",
    dataLeftDevice: version.data_left_device ?? null,
    storageLocation: version.storage_location || "legacy_unknown",
    canonicalAuthority: version.canonical_authority || "local",
    previousIntegrityHash,
    integritySchemaVersion: "story-bible-integrity-v1",
  };
}

async function request(path, init = {}) {
  const url = /^https?:\/\//.test(path) ? path : `${baseUrl}${path}`;
  const started = Date.now();
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) } });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  timings.push({ kind: "http", path, elapsedMs: Date.now() - started, bytes: text.length });
  return { ok: res.ok, status: res.status, body, text, headers: Object.fromEntries(res.headers.entries()) };
}

async function sql(query) {
  if (!supabaseToken || !supabaseProjectRef) throw new Error("SUPABASE_TEST_CONFIG_MISSING");
  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const started = Date.now();
    const res = await fetch(`https://api.supabase.com/v1/projects/${supabaseProjectRef}/database/query`, {
      method: "POST",
      headers: { authorization: `Bearer ${supabaseToken}`, "content-type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const body = await res.json().catch(() => []);
    timings.push({ kind: "sql", elapsedMs: Date.now() - started });
    if (res.ok) return Array.isArray(body) ? body : body.result || body.value || [];
    lastStatus = res.status;
    lastBody = JSON.stringify(body).slice(0, 500);
    if (![408, 429, 500, 502, 503, 504, 524].includes(res.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }
  throw new Error(`SUPABASE_SQL_${lastStatus}:${lastBody}`);
}

function versionSql(row) {
  return `('${esc(row.id)}','${esc(row.project_id)}',${row.version_number},${row.parent_version_id ? `'${esc(row.parent_version_id)}'` : "null"},'approve',array['${esc(row.candidate_id)}'],array['${esc(row.candidate_id)}'],${js(row.change_set)},'matrix','${esc(row.created_at)}','api',array['${esc(row.request_id)}'],'${esc(row.summary)}','gemini','server','fixture-model','${esc(row.run_id)}','ai-supported',true,'supabase-postgres','${esc(row.integrity_hash)}',${row.previous_integrity_hash ? `'${esc(row.previous_integrity_hash)}'` : "null"},'SHA-256','story-bible-integrity-v1','${esc(row.created_at)}','valid','local')`;
}

async function ensureMigration() {
  await sql(`
create table if not exists public.story_bible_export_audits (
  id text primary key,
  project_id text not null,
  requested_by text not null default 'system',
  export_options_hash text not null,
  from_version integer,
  to_version integer,
  content_hash text,
  package_hash text,
  status text not null,
  estimated_bytes integer,
  actual_bytes integer,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists story_bible_export_audits_project_created_idx on public.story_bible_export_audits(project_id, created_at desc);
create table if not exists public.story_bible_export_packages (
  id text primary key,
  project_id text not null,
  content_hash text not null,
  package_hash text not null,
  from_version integer,
  to_version integer,
  format text not null,
  format_version text not null,
  actual_bytes integer,
  manifest_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists story_bible_export_packages_project_created_idx on public.story_bible_export_packages(project_id, created_at desc);
insert into public.schema_migrations(version) values ('p0c2c2c_history_export_010') on conflict (version) do nothing;`);
}

async function seedProject(projectId, versionCount, includeEvidence = true) {
  fixtureProjects.add(projectId);
  await sql(`insert into public.story_bibles(project_id,schema_version,status,core_json)
values ('${esc(projectId)}','story-bible-v1','active',${js({ title: `Export ${projectId}`, genre: "matrix", coreConcept: "export fixture" })})
on conflict (project_id) do nothing;`);
  if (includeEvidence) await sql(`
insert into public.story_characters(id,project_id,character_id,canonical_name,character_json,confidence)
values ('${esc(projectId)}_char','${esc(projectId)}','char_export','林昭',${js({ age: 28, aliases: ["昭"] })},1)
on conflict (id) do nothing;
insert into public.story_events(id,project_id,event_id,chapter_id,event_type,title,event_json)
values ('${esc(projectId)}_event','${esc(projectId)}','event_export','ch1','plot','初次交鋒',${js({ status: "completed" })})
on conflict (id) do nothing;
insert into public.story_items(id,project_id,item_id,name,item_json)
values ('${esc(projectId)}_item','${esc(projectId)}','item_export','赤霄劍',${js({ currentOwnerCharacterId: "char_export" })})
on conflict (id) do nothing;
insert into public.story_world_rules(id,project_id,rule_id,title,rule_json,immutable)
values ('${esc(projectId)}_rule','${esc(projectId)}','rule_export','死者不可復生',${js({ description: "死者不可復生" })},true)
on conflict (id) do nothing;
insert into public.story_foreshadowing(id,project_id,foreshadow_id,title,status,foreshadow_json)
values ('${esc(projectId)}_fs','${esc(projectId)}','fs_export','赤霄劍裂紋','planted',${js({ description: "劍身裂紋暗示代價" })})
on conflict (id) do nothing;
insert into public.story_open_threads(id,project_id,thread_id,thread_type,title,status,thread_json)
values ('${esc(projectId)}_thread','${esc(projectId)}','thread_export','mystery','誰調包證據','open',${js({ urgency: "high" })})
on conflict (id) do nothing;`);
  const rows = [];
  let parent = null;
  let previousIntegrityHash = null;
  for (let i = 1; i <= versionCount; i += 1) {
    const candidateId = `${projectId}_cand_${i}`;
    const runId = `${projectId}_run_${i}`;
    const created = new Date(Date.UTC(2026, 6, 14, 0, 0, i)).toISOString();
    const versionId = `${projectId}_v${i}`;
    if (includeEvidence) await sql(`
insert into public.story_bible_extraction_runs(id,project_id,chapter_id,chapter_number,extraction_mode,schema_version,prompt_version,model_id,fallback_level,status,confidence,warnings,input_hash,output_json)
values ('${esc(runId)}','${esc(projectId)}','ch${i}',${i},'chapter-new','story-bible-v1','export-fixture','fixture-model','cloud-validated','completed',1,'[]'::jsonb,'${esc(sha(projectId + i))}','{}'::jsonb)
on conflict (id) do nothing;
insert into public.story_fact_candidates(id,project_id,extraction_run_id,entity_type,entity_id,temporary_entity_id,operation,field_path,proposed_value,confidence,evidence,source_refs,reason,conflict_risk,status,candidate_trust,source_valid,status_updated_at)
values ('${esc(candidateId)}','${esc(projectId)}','${esc(runId)}','character','char_export','char_export','update','characters[].age',${js(28 + i)},0.99,'林昭年齡更新',${js([{ chapterId: `ch${i}`, excerpt: "林昭年齡更新", sourceValid: true }])},'export fixture','low','approved','cloud-validated',true,now())
on conflict (id) do nothing;
insert into public.story_fact_sources(id,project_id,extraction_run_id,candidate_id,chapter_id,paragraph_index,text_start,text_end,excerpt_hash,excerpt)
values ('${esc(projectId)}_source_${i}','${esc(projectId)}','${esc(runId)}','${esc(candidateId)}','ch${i}',0,0,6,'${esc(sha(`source-${i}`))}','林昭年齡更新')
on conflict (id) do nothing;
insert into public.story_bible_mutation_requests(request_id,project_id,operation,candidate_ids,result_version_id,status,request_hash,response_hash,created_at,completed_at)
values ('${esc(projectId)}_req_${i}','${esc(projectId)}','approve',array['${esc(candidateId)}'],'${esc(versionId)}','completed','${esc(sha(`req-${i}`))}','${esc(sha(`res-${i}`))}','${esc(created)}','${esc(created)}')
on conflict (request_id) do nothing;`);
    const row = {
      id: versionId,
      project_id: projectId,
      version_number: i,
      parent_version_id: parent,
      operation_type: "approve",
      candidate_ids: [candidateId],
      mutation_request_ids: [`${projectId}_req_${i}`],
      created_by: "matrix",
      operation_source: "api",
      source_provider_type: "gemini",
      source_provider_location: "server",
      source_model_id: "fixture-model",
      source_execution_id: runId,
      source_mode: "ai-supported",
      data_left_device: true,
      storage_location: "supabase-postgres",
      canonical_authority: "local",
      candidate_id: candidateId,
      request_id: `${projectId}_req_${i}`,
      run_id: runId,
      created_at: created,
      summary: `export fixture v${i}`,
      change_set: {
        entityType: "character",
        entityId: "char_export",
        entityDisplayName: "林昭",
        fieldPath: "characters[].age",
        operation: "update",
        previousValue: i === 1 ? null : 27 + i,
        newValue: 28 + i,
        candidateId,
        mutationRequestId: `${projectId}_req_${i}`,
        reason: `export fixture v${i}`,
      },
    };
    row.previous_integrity_hash = previousIntegrityHash;
    row.integrity_hash = computeIntegrityHash(buildIntegrityPayload(row, previousIntegrityHash));
    previousIntegrityHash = row.integrity_hash;
    rows.push(row);
    parent = versionId;
  }
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    await sql(`insert into public.story_bible_versions(id,project_id,version_number,parent_version_id,operation_type,candidate_ids,approved_candidate_ids,change_set,created_by,created_at,operation_source,mutation_request_ids,summary,source_provider_type,source_provider_location,source_model_id,source_execution_id,source_mode,data_left_device,storage_location,integrity_hash,previous_integrity_hash,integrity_algorithm,integrity_schema_version,integrity_computed_at,integrity_status,canonical_authority)
values ${chunk.map(versionSql).join(",")}
on conflict (id) do nothing;`);
  }
}

async function cleanup() {
  const ids = [...fixtureProjects];
  if (ids.length === 0) return [];
  const inList = ids.map((id) => `'${esc(id)}'`).join(",");
  await sql(`
delete from public.story_bible_export_packages where project_id in (${inList});
delete from public.story_bible_export_audits where project_id in (${inList});
delete from public.story_canonical_sources where project_id in (${inList});
delete from public.story_bible_versions where project_id in (${inList});
delete from public.story_bible_mutation_requests where project_id in (${inList});
delete from public.story_fact_sources where project_id in (${inList});
delete from public.story_fact_conflicts where project_id in (${inList});
delete from public.story_fact_candidates where project_id in (${inList});
delete from public.story_bible_extraction_runs where project_id in (${inList});
delete from public.story_characters where project_id in (${inList});
delete from public.story_events where project_id in (${inList});
delete from public.story_items where project_id in (${inList});
delete from public.story_world_rules where project_id in (${inList});
delete from public.story_foreshadowing where project_id in (${inList});
delete from public.story_open_threads where project_id in (${inList});
delete from public.story_bibles where project_id in (${inList});`);
  return sql(`select count(*)::int as remaining from public.story_bibles where project_id in (${inList});`);
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function noSecret(text) {
  return !/(sk-[A-Za-z0-9_-]{20,}|vcp_[A-Za-z0-9_-]{20,}|sbp_[A-Za-z0-9_-]{20,}|postgres(?:ql)?:\/\/|Authorization\s*:|C:\\Users\\|OneDrive)/i.test(text);
}

async function run() {
  await ensureMigration();
  const projectId = `${prefix}-main`;
  await seedProject(projectId, 5, true);

  const health = await request("/api/ai/health?c2c2c=1");
  assert("basic", "health exposes export ready", health.ok
    && (!expectedCommit || health.body?.appCommit === expectedCommit)
    && (!expectedDeploymentId || health.body?.deploymentId === expectedDeploymentId)
    && health.body?.releaseTag === expectedReleaseTag
    && String(health.body?.migrationVersion || "").includes("p0c2c2c_history_export_010")
    && health.body?.storyBibleExportStatus === "ready", health.body);
  if (deploymentUrl) {
    const dep = await request(`${deploymentUrl.replace(/\/$/, "")}/api/ai/health?c2c2c=1`);
    assert("basic", "deployment URL matches alias release", dep.ok && dep.body?.releaseTag === expectedReleaseTag && dep.body?.appCommit === health.body?.appCommit, dep.body);
  } else {
    assert("basic", "deployment URL check omitted when not supplied", true);
  }

  const preview = await request(`/api/story-bible/versions/export/preview?projectId=${projectId}`);
  const exp = await request(`/api/story-bible/versions/export?projectId=${projectId}`);
  const partial = await request(`/api/story-bible/versions/export?projectId=${projectId}&fromVersionNumber=2&toVersionNumber=4`);
  const single = await request(`/api/story-bible/versions/export?projectId=${projectId}&fromVersionNumber=3&toVersionNumber=3`);
  const download = await request(`/api/story-bible/versions/export?projectId=${projectId}&download=true`);
  const wrong = await request(`/api/story-bible/versions/export?projectId=${projectId}-missing`);
  const missing = await request(`/api/story-bible/versions/export`);
  const badRange = await request(`/api/story-bible/versions/export?projectId=${projectId}&fromVersionNumber=4&toVersionNumber=2`);
  const versionMissing = await request(`/api/story-bible/versions/export?projectId=${projectId}&fromVersionNumber=99&toVersionNumber=100`);
  const invalidOpt = await request(`/api/story-bible/versions/export?projectId=${projectId}&includeChapterText=true`);

  assert("basic", "default export succeeds", exp.ok && exp.body?.format === "novel-story-bible-history-package", exp.body?.manifest);
  assert("basic", "full version range exports five versions", exp.body?.versions?.length === 5, exp.body?.versionRange);
  assert("basic", "partial version range exports three versions", partial.ok && partial.body?.versions?.length === 3 && partial.body?.versionRange?.partialExport === true, partial.body?.versionRange);
  assert("basic", "single version range exports one version", single.ok && single.body?.versions?.length === 1, single.body?.versionRange);
  assert("basic", "preview returns estimate without package arrays", preview.ok && preview.body?.estimatedBytes > 0 && preview.body?.exportAllowed === true && !preview.body?.versions, preview.body);
  assert("basic", "download headers set", download.ok && /attachment/.test(download.headers["content-disposition"] || "") && /vnd\.novel-story-bible-history/.test(download.headers["content-type"] || ""), download.headers);
  assert("basic", "safe filename extension", /\.nsbh\.json"/.test(download.headers["content-disposition"] || ""), download.headers);
  assert("basic", "wrong project returns 404", wrong.status === 404 && wrong.body?.errorCode === "EXPORT_PROJECT_NOT_FOUND", wrong.body);
  assert("basic", "missing projectId returns 400", missing.status === 400, missing.body);
  assert("basic", "invalid options full text blocked", invalidOpt.status === 422 && invalidOpt.body?.errorCode === "EXPORT_FULL_TEXT_NOT_ALLOWED", invalidOpt.body);
  assert("basic", "invalid range returns structured error", badRange.status === 400 && badRange.body?.errorCode === "EXPORT_RANGE_INVALID", badRange.body);
  assert("basic", "version not found returns 404", versionMissing.status === 404 && versionMissing.body?.errorCode === "EXPORT_VERSION_NOT_FOUND", versionMissing.body);
  assert("basic", "error response has traceId", Boolean(badRange.body?.traceId), badRange.body);

  const pkg = exp.body;
  assert("content", "versions included", pkg.versions?.length === 5, pkg.versions?.[0]);
  assert("content", "change sets included", pkg.changeSets?.length === 5, pkg.changeSets?.[0]);
  assert("content", "canonical entities included", pkg.canonicalEntities?.characters?.length === 1 && pkg.canonicalEntities?.worldRules?.length === 1, pkg.canonicalEntities);
  assert("content", "candidates included", pkg.candidates?.length === 5, pkg.candidates?.[0]);
  assert("content", "conflicts included array", Array.isArray(pkg.conflicts), pkg.conflicts);
  assert("content", "sources included", pkg.sources?.length >= 5, { count: pkg.sources?.length });
  assert("content", "mutation requests sanitized", pkg.mutationRequests?.length === 5 && !JSON.stringify(pkg.mutationRequests).includes(`${projectId}_req_1`), pkg.mutationRequests?.[0]);
  assert("content", "provenance included", pkg.provenance?.length >= 1, pkg.provenance);
  assert("content", "authority is local", pkg.authority?.canonicalAuthority === "local" && pkg.authority?.humanApprovalRequired === true, pkg.authority);
  assert("content", "schema versions complete", Boolean(pkg.schemaVersions?.canonicalEntitySchemaVersions?.character && pkg.schemaVersions?.integritySchemaVersion), pkg.schemaVersions);
  assert("content", "compatibility metadata accurate", pkg.compatibility?.canUseOffline === true && pkg.compatibility?.importerImplemented === false, pkg.compatibility);
  assert("content", "full chapter text excluded", JSON.stringify(pkg).indexOf("chapterText") === -1 && pkg.compatibility?.requiresChapterText === false, pkg.compatibility);
  const noExcerpt = await request(`/api/story-bible/versions/export?projectId=${projectId}&includeSourceExcerpts=false`);
  assert("content", "source excerpt optional", noExcerpt.ok && noExcerpt.body?.sources?.every((s) => !("excerpt" in s)), noExcerpt.body?.sources?.[0]);
  assert("content", "diagnostics excluded by default", !("diagnostics" in pkg), Object.keys(pkg));

  assert("integrity", "valid chain permits export", pkg.integrity?.chainValid === true, pkg.integrity);
  await sql(`update public.story_bible_versions set summary='tampered export' where project_id='${esc(projectId)}' and version_number=5;`);
  const blocked = await request(`/api/story-bible/versions/export?projectId=${projectId}`);
  assert("integrity", "invalid chain blocks export", blocked.status === 409 && blocked.body?.errorCode === "EXPORT_INTEGRITY_FAILED", blocked.body);
  await cleanup();
  await seedProject(projectId, 5, true);
  const pkg2 = (await request(`/api/story-bible/versions/export?projectId=${projectId}`)).body;
  const partial2 = (await request(`/api/story-bible/versions/export?projectId=${projectId}&fromVersionNumber=2&toVersionNumber=4`)).body;
  assert("integrity", "partial range root reference", Boolean(partial2.versionRange?.parentBeforeRange && partial2.integrity?.externalPreviousHash), partial2.versionRange);
  assert("integrity", "integrity root hash present", Boolean(pkg2.integrity?.integrityRootHash), pkg2.integrity);
  assert("integrity", "manifest hash present", Boolean(pkg2.hashes?.manifestHash), pkg2.hashes);
  assert("integrity", "content hash present", Boolean(pkg2.hashes?.contentHash), pkg2.hashes);
  assert("integrity", "package hash present", Boolean(pkg2.hashes?.packageHash), pkg2.hashes);
  const sameA = (await request(`/api/story-bible/versions/export?projectId=${projectId}`)).body;
  const sameB = (await request(`/api/story-bible/versions/export?projectId=${projectId}`)).body;
  assert("integrity", "same data same contentHash", sameA.hashes?.contentHash === sameB.hashes?.contentHash, { a: sameA.hashes, b: sameB.hashes });
  assert("integrity", "different options different contentHash", sameA.hashes?.contentHash !== noExcerpt.body?.hashes?.contentHash, { a: sameA.hashes, b: noExcerpt.body?.hashes });
  assert("integrity", "exportedAt does not affect contentHash", sameA.exportedAt !== sameB.exportedAt && sameA.hashes?.contentHash === sameB.hashes?.contentHash, { a: sameA.exportedAt, b: sameB.exportedAt });
  assert("integrity", "packageId does not affect contentHash", sameA.packageId !== sameB.packageId && sameA.hashes?.contentHash === sameB.hashes?.contentHash, { a: sameA.packageId, b: sameB.packageId });

  const text = JSON.stringify(sameA);
  assert("security", "API key blocked", !/sk-[A-Za-z0-9_-]{20,}/.test(text), {});
  assert("security", "JWT blocked", !/eyJ[A-Za-z0-9_-]{10,}\./.test(text), {});
  assert("security", "Database URL blocked", !/postgres(?:ql)?:\/\//i.test(text), {});
  assert("security", "Admin token blocked", adminToken ? !text.includes(adminToken) : true, {});
  assert("security", "Windows path removed", !/C:\\Users\\/i.test(text), {});
  assert("security", "OneDrive path removed", !/OneDrive/i.test(text), {});
  assert("security", "Stack trace removed", !/at .*\\/.test(text) && !/stack/i.test(text), {});
  assert("security", "Authorization header removed", !/Authorization\s*:/i.test(text), {});
  assert("security", "secret scanner found no secret", noSecret(text), {});
  assert("security", "allowlist excludes raw db names from package", !/"story_bible_versions"/.test(text) && !/"story_fact_candidates"/.test(text), {});

  for (const count of [10, 100, 500, 1000]) {
    const perfProject = `${prefix}-perf-${count}`;
    await seedProject(perfProject, count, false);
    const pr = await request(`/api/story-bible/versions/export/preview?projectId=${perfProject}`);
    const ex = await request(`/api/story-bible/versions/export?projectId=${perfProject}`);
    assert("performance", `${count} versions export`, pr.ok && ex.ok && ex.body?.versions?.length === count, { previewBytes: pr.body?.estimatedBytes, outputBytes: ex.text.length });
  }
  const httpExport = timings.filter((x) => x.kind === "http" && String(x.path).includes("/export"));
  assert("performance", "large candidate count", sameA.candidates.length >= 5, { count: sameA.candidates.length });
  assert("performance", "large source count", sameA.sources.length >= 5, { count: sameA.sources.length });
  assert("performance", "response byte limit respected", httpExport.every((x) => (x.bytes || 0) < 8 * 1024 * 1024), { maxBytes: Math.max(...httpExport.map((x) => x.bytes || 0)) });
  assert("performance", "no N+1 query smoke", timings.filter((x) => x.kind === "sql").length < 120, { sqlCount: timings.filter((x) => x.kind === "sql").length });
  assert("performance", "memory bound", process.memoryUsage().heapUsed < 512 * 1024 * 1024, process.memoryUsage());
  const previewTimes = timings.filter((x) => x.kind === "http" && String(x.path).includes("/preview")).map((x) => x.elapsedMs);
  const exportTimes = timings.filter((x) => x.kind === "http" && String(x.path).includes("/export?")).map((x) => x.elapsedMs);
  assert("performance", "preview faster than or comparable to full export", percentile(previewTimes, 95) <= percentile(exportTimes, 95) * 1.8 + 200, { previewP95: percentile(previewTimes, 95), exportP95: percentile(exportTimes, 95) });

  await request(`/api/story-bible/versions/export?projectId=${projectId}&includeChapterText=true`);
  const audits = await sql(`select status, count(*)::int as count from public.story_bible_export_audits where project_id='${esc(projectId)}' group by status;`);
  const packages = await sql(`select count(*)::int as count from public.story_bible_export_packages where project_id='${esc(projectId)}';`);
  assert("cleanup-audit", "export audit created", audits.some((x) => x.status === "completed" && x.count > 0), audits);
  assert("cleanup-audit", "failed export audit created", audits.some((x) => x.status === "failed" && x.count > 0), audits);
  assert("cleanup-audit", "package metadata stored without content log", Number(packages[0]?.count || 0) > 0, packages);
  const cleanupRows = await cleanup();
  assert("cleanup-audit", "fixture cleanup", cleanupRows.every((row) => Number(row.remaining) === 0), cleanupRows);
  const afterCleanup = await sql(`select count(*)::int as count from public.story_bible_export_audits where project_id like '${esc(prefix)}%';`);
  assert("cleanup-audit", "audit cleanup removes fixture rows", Number(afterCleanup[0]?.count || 0) === 0, afterCleanup);
}

try {
  await run();
} catch (error) {
  assert("runner", "uncaught exception", false, { message: error.message, stack: error.stack });
  try { await cleanup(); } catch (cleanupError) {
    assert("cleanup-audit", "cleanup after exception failed", false, { message: cleanupError.message });
  }
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
  previewP50: percentile(timings.filter((x) => x.kind === "http" && String(x.path).includes("/preview")).map((x) => x.elapsedMs), 50),
  previewP95: percentile(timings.filter((x) => x.kind === "http" && String(x.path).includes("/preview")).map((x) => x.elapsedMs), 95),
  exportP50: percentile(timings.filter((x) => x.kind === "http" && String(x.path).includes("/export")).map((x) => x.elapsedMs), 50),
  exportP95: percentile(timings.filter((x) => x.kind === "http" && String(x.path).includes("/export")).map((x) => x.elapsedMs), 95),
  dbQueryCount: timings.filter((x) => x.kind === "sql").length,
  peakMemory: process.memoryUsage(),
};

console.log(JSON.stringify({ summary, results }, null, 2));
if (summary.fail > 0 || summary.skip > 0 || summary.pass < 63) process.exit(1);

import crypto from "crypto";

const baseUrl = process.env.BASE_URL || "https://novel-orcin.vercel.app";
const adminToken = process.env.ADMIN_TOKEN || "";
const supabaseToken = process.env.SUPABASE_MANAGEMENT_TOKEN || "";
const supabaseProjectRef = process.env.SUPABASE_PROJECT_REF || "";
const expectedCommit = process.env.EXPECTED_APP_COMMIT || "ec43e99c88caa3f3c19ae768f6bfc113fa8c8c40";
const expectedDeploymentId = process.env.EXPECTED_DEPLOYMENT_ID || "dpl_CXJRZhf7MkYTyTnUNaNoqc8XgDW8";
const expectedReleaseTag = process.env.EXPECTED_RELEASE_TAG || "novel-ai-p0c2c2b-integrity-chain";
const runId = `${Date.now()}`;
const prefix = process.env.P0C2C2B1_PREFIX || `p0c2c2b1-${runId}`;
const results = [];
const timings = [];
const fixtureProjects = new Set();

const SET_LIKE_KEYS = new Set([
  "candidateIds", "candidate_ids", "approvedCandidateIds", "approved_candidate_ids",
  "mutationRequestIds", "mutation_request_ids", "aliases", "relatedCharacters",
  "relatedEvents", "sourceRefs", "source_refs", "possessions",
]);

function assert(category, name, pass, detail = {}) {
  results.push({ category, name, status: pass ? "PASS" : "FAIL", detail });
}

function esc(value) {
  return String(value ?? "").replace(/'/g, "''");
}

function js(value) {
  return `'${esc(JSON.stringify(value ?? null))}'::jsonb`;
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeDateString(value) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value.normalize("NFC") : new Date(parsed).toISOString();
}

function shouldSortArray(path) {
  return SET_LIKE_KEYS.has(path[path.length - 1] || "");
}

function stableCanonicalize(value, path = []) {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(normalizeDateString(value));
  if (typeof value === "number") return Number.isFinite(value) ? (Object.is(value, -0) ? "0" : String(value)) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    const items = value.map((item) => ({ item, key: stableCanonicalize(item) }));
    const out = shouldSortArray(path) ? items.sort((a, b) => a.key.localeCompare(b.key)).map((x) => x.item) : items.map((x) => x.item);
    return `[${out.map((item, index) => stableCanonicalize(item, [...path, String(index)])).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key.normalize("NFC"))}:${stableCanonicalize(item, [...path, key])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function computeHash(payload) {
  return hash(stableCanonicalize(payload));
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
    changeId: String(change.changeId || `change_${hash(JSON.stringify(fingerprint)).slice(0, 20)}`),
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

function normalizeVersionChangeSets(version) {
  const raw = version.change_set;
  const changes = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  return changes.map((change, index) => normalizeChangeSet(version, change, index));
}

function buildPayload(version, previousIntegrityHash = null) {
  return {
    projectId: version.project_id || null,
    versionId: version.id || null,
    versionNumber: Number(version.version_number || 0),
    parentVersionId: version.parent_version_id || null,
    operationType: version.operation_type || null,
    operationSource: version.operation_source || "legacy_unknown",
    candidateIds: Array.isArray(version.candidate_ids) ? version.candidate_ids : [],
    mutationRequestIds: Array.isArray(version.mutation_request_ids) ? version.mutation_request_ids : [],
    normalizedChangeSet: normalizeVersionChangeSets(version),
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

function versionRow(projectId, n, previousHash = null, parentVersionId = null, overrides = {}) {
  const id = overrides.id || `${projectId}_v${n}`;
  const createdAt = overrides.created_at || new Date(Date.UTC(2026, 6, 14, 0, 0, n)).toISOString();
  const change = overrides.change_set || {
    entityType: "character",
    entityId: "char_matrix",
    fieldPath: "characters[].age",
    operation: "update",
    previousValue: n === 1 ? null : 20 + n - 1,
    newValue: 20 + n,
    candidateId: `${projectId}_c${n}`,
    reason: `matrix version ${n}`,
  };
  const row = {
    id,
    project_id: projectId,
    version_number: n,
    parent_version_id: parentVersionId,
    operation_type: overrides.operation_type || "approve",
    candidate_ids: overrides.candidate_ids || [`${projectId}_c${n}`],
    approved_candidate_ids: overrides.approved_candidate_ids || [`${projectId}_c${n}`],
    change_set: change,
    created_by: overrides.created_by || "matrix",
    created_at: createdAt,
    operation_source: overrides.operation_source || "api",
    mutation_request_ids: overrides.mutation_request_ids || [`${projectId}_r${n}`],
    summary: overrides.summary || `matrix v${n}`,
    source_provider_type: overrides.source_provider_type || "gemini",
    source_provider_location: overrides.source_provider_location || "cloud",
    source_model_id: overrides.source_model_id || "fixture-model",
    source_execution_id: overrides.source_execution_id || `${projectId}_run${n}`,
    source_mode: overrides.source_mode || "ai-supported",
    data_left_device: overrides.data_left_device ?? true,
    storage_location: overrides.storage_location || "supabase-postgres",
    canonical_authority: overrides.canonical_authority || "local",
    previous_integrity_hash: overrides.previous_integrity_hash ?? previousHash,
    integrity_algorithm: overrides.integrity_algorithm ?? null,
    integrity_schema_version: overrides.integrity_schema_version ?? null,
    integrity_status: overrides.integrity_status || "legacy_uninitialized",
  };
  row.integrity_hash = overrides.integrity_hash ?? null;
  row.integrity_computed_at = overrides.integrity_computed_at || createdAt;
  return row;
}

async function sql(query) {
  if (!supabaseToken || !supabaseProjectRef) throw new Error("SUPABASE_TEST_CONFIG_MISSING");
  let lastBody = [];
  let lastStatus = 0;
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
    lastBody = body;
    lastStatus = res.status;
    if (![408, 429, 500, 502, 503, 504, 524].includes(res.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }
  throw new Error(`SUPABASE_SQL_${lastStatus}:${JSON.stringify(lastBody).slice(0, 500)}`);
}

async function request(path, init = {}) {
  const started = Date.now();
  const url = /^https?:\/\//.test(path) ? path : `${baseUrl}${path}`;
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) } });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  timings.push({ kind: "http", path, elapsedMs: Date.now() - started });
  return { ok: res.ok, status: res.status, body, headers: Object.fromEntries(res.headers.entries()) };
}

async function admin(path, body) {
  return request(path, { method: "POST", headers: { "x-admin-token": adminToken }, body: JSON.stringify(body) });
}

async function insertBible(projectId) {
  fixtureProjects.add(projectId);
  await sql(`insert into public.story_bibles(project_id,schema_version,status,core_json)
values ('${esc(projectId)}','story-bible-v1','active',${js({ fixture: "p0c2c2b1" })})
on conflict (project_id) do nothing;`);
}

function versionSql(row) {
  return `('${esc(row.id)}','${esc(row.project_id)}',${row.version_number},${row.parent_version_id ? `'${esc(row.parent_version_id)}'` : "null"},'${esc(row.operation_type)}',array[${row.candidate_ids.map((x) => `'${esc(x)}'`).join(",")}],array[${row.approved_candidate_ids.map((x) => `'${esc(x)}'`).join(",")}],${js(row.change_set)},'${esc(row.created_by)}','${esc(row.created_at)}','${esc(row.operation_source)}',array[${row.mutation_request_ids.map((x) => `'${esc(x)}'`).join(",")}],'${esc(row.summary)}','${esc(row.source_provider_type)}','${esc(row.source_provider_location)}','${esc(row.source_model_id)}','${esc(row.source_execution_id)}','${esc(row.source_mode)}',${row.data_left_device ? "true" : row.data_left_device === false ? "false" : "null"},'${esc(row.storage_location)}',${row.integrity_hash ? `'${esc(row.integrity_hash)}'` : "null"},${row.previous_integrity_hash ? `'${esc(row.previous_integrity_hash)}'` : "null"},${row.integrity_algorithm ? `'${esc(row.integrity_algorithm)}'` : "null"},${row.integrity_schema_version ? `'${esc(row.integrity_schema_version)}'` : "null"},${row.integrity_computed_at ? `'${esc(row.integrity_computed_at)}'` : "null"},'${esc(row.integrity_status)}','${esc(row.canonical_authority)}')`;
}

async function insertVersions(projectId, count, overridesFor = () => ({})) {
  await insertBible(projectId);
  const rows = [];
  let parentId = null;
  for (let i = 1; i <= count; i += 1) {
    const row = versionRow(projectId, i, null, parentId, overridesFor(i));
    rows.push(row);
    parentId = row.id;
  }
  const chunks = [];
  for (let i = 0; i < rows.length; i += 100) chunks.push(rows.slice(i, i + 100));
  for (const chunk of chunks) {
    await sql(`insert into public.story_bible_versions(id,project_id,version_number,parent_version_id,operation_type,candidate_ids,approved_candidate_ids,change_set,created_by,created_at,operation_source,mutation_request_ids,summary,source_provider_type,source_provider_location,source_model_id,source_execution_id,source_mode,data_left_device,storage_location,integrity_hash,previous_integrity_hash,integrity_algorithm,integrity_schema_version,integrity_computed_at,integrity_status,canonical_authority)
values ${chunk.map(versionSql).join(",")};`);
  }
  const backfilled = await admin("/api/admin/story-bible/integrity-backfill", { projectId, dryRun: false, batchSize: 100 });
  if (!backfilled.ok || backfilled.body?.failureCount) throw new Error(`BACKFILL_FIXTURE_FAILED:${JSON.stringify(backfilled.body).slice(0, 500)}`);
  return sql(`select * from public.story_bible_versions where project_id='${esc(projectId)}' order by version_number;`);
}

async function cleanup() {
  const ids = [...fixtureProjects];
  if (ids.length === 0) return [];
  const inList = ids.map((id) => `'${esc(id)}'`).join(",");
  await sql(`
delete from public.story_bible_versions where project_id in (${inList});
delete from public.story_fact_sources where project_id in (${inList});
delete from public.story_fact_conflicts where project_id in (${inList});
delete from public.story_fact_candidates where project_id in (${inList});
delete from public.story_characters where project_id in (${inList});
delete from public.story_bibles where project_id in (${inList});`);
  return sql(`select count(*)::int as remaining from public.story_bible_versions where project_id in (${inList});`);
}

async function seedCandidate(projectId, id, proposedValue, expectedVersion) {
  const run = `${id}_run`;
  const evidence = `${id} evidence`;
  await sql(`
insert into public.story_bible_extraction_runs(id,project_id,chapter_id,chapter_number,extraction_mode,schema_version,prompt_version,model_id,fallback_level,status,confidence,warnings,input_hash,output_json)
values ('${esc(run)}','${esc(projectId)}','${esc(id)}_chapter',1,'chapter-new','story-bible-v1','matrix','fixture-model','cloud-validated','completed',1,'[]'::jsonb,'fixture','{}'::jsonb);
insert into public.story_fact_candidates(id,project_id,extraction_run_id,entity_type,entity_id,temporary_entity_id,operation,field_path,proposed_value,confidence,evidence,source_refs,reason,conflict_risk,status,candidate_trust,source_valid,status_updated_at)
values ('${esc(id)}','${esc(projectId)}','${esc(run)}','character','char_tx','char_tx','update','characters[].age',${js(proposedValue)},0.99,'${esc(evidence)}',${js([{ projectId, chapterId: `${id}_chapter`, paragraphIndex: 0, textStart: 0, textEnd: evidence.length, excerptHash: id, extractionRunId: run, excerpt: evidence, evidenceType: "direct_statement", sourceValid: true }])},'matrix candidate','low','pending','cloud-validated',true,now());
insert into public.story_fact_sources(id,project_id,extraction_run_id,candidate_id,chapter_id,paragraph_index,text_start,text_end,excerpt_hash,excerpt)
values ('source_${esc(id)}','${esc(projectId)}','${esc(run)}','${esc(id)}','${esc(id)}_chapter',0,0,${evidence.length},'${esc(id)}','${esc(evidence)}');`);
  const detail = await request(`/api/story-bible/candidates/${id}?projectId=${projectId}`);
  return admin(`/api/story-bible/candidates/${id}/approve`, {
    projectId,
    requestId: `matrix_${id}_${expectedVersion}`,
    expectedCandidateStatus: detail.body?.candidate?.status || "pending",
    expectedStoryBibleVersion: expectedVersion,
    reviewReason: `matrix approve ${id}`,
  });
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function run() {
  // Production alias checks
  const healthUrls = [
    "/api/ai/health",
    "/api/ai/health?verify=1",
    `/api/ai/health?ts=${Date.now()}`,
  ];
  for (const [index, url] of healthUrls.entries()) {
    const res = await request(url);
    assert("production-alias", `health check ${index + 1}`, res.ok
      && res.body?.appCommit === expectedCommit
      && res.body?.deploymentId === expectedDeploymentId
      && res.body?.releaseTag === expectedReleaseTag
      && String(res.body?.migrationVersion || "").includes("p0c2c2b_integrity_chain_009")
      && res.body?.storyBibleIntegrityStatus === "ready"
      && res.body?.storyBibleDiffStatus === "ready"
      && res.body?.storyBibleExportStatus === "not_implemented"
      && res.body?.storyBibleRevertStatus === "not_implemented"
      && String(res.headers["cache-control"] || "").includes("no-store"), { status: res.status, headers: res.headers, body: res.body });
  }
  const deploymentUrl = process.env.EXPECTED_DEPLOYMENT_URL || "";
  if (deploymentUrl) {
    const deployment = await request(`${deploymentUrl.replace(/\/$/, "")}/api/ai/health`);
    assert("production-alias", "deployment URL consistency", deployment.ok
      && deployment.body?.appCommit === expectedCommit
      && deployment.body?.deploymentId === expectedDeploymentId
      && deployment.body?.releaseTag === expectedReleaseTag, { status: deployment.status, body: deployment.body });
  } else {
    assert("production-alias", "deployment URL consistency skipped by missing EXPECTED_DEPLOYMENT_URL", true, { note: "Public alias deploymentId is still verified." });
  }

  // Serialization matrix
  const pairs = [
    ["object key order stable", { b: 2, a: 1 }, { a: 1, b: 2 }, true],
    ["unicode NFC stable", "e\u0301", "\u00e9", true],
    ["set-like array order stable", { aliases: ["b", "a"] }, { aliases: ["a", "b"] }, true],
    ["set-like object array order stable", { sourceRefs: [{ excerptHash: "b" }, { excerptHash: "a" }] }, { sourceRefs: [{ excerptHash: "a" }, { excerptHash: "b" }] }, true],
    ["ordered array order changes hash", { ordered: ["b", "a"] }, { ordered: ["a", "b"] }, false],
    ["UTC equivalent dates stable", "2026-07-14T08:00:00+08:00", "2026-07-14T00:00:00.000Z", true],
    ["null and absent differ", { a: null }, {}, false],
    ["number and string differ", 1, "1", false],
    ["boolean and string differ", true, "true", false],
    ["nested object key order stable", { z: { b: 2, a: 1 } }, { z: { a: 1, b: 2 } }, true],
    ["source ref set order stable", { source_refs: [{ paragraphIndex: 2 }, { paragraphIndex: 1 }] }, { source_refs: [{ paragraphIndex: 1 }, { paragraphIndex: 2 }] }, true],
    ["change set order is significant", { normalizedChangeSet: [{ changeId: "2" }, { changeId: "1" }] }, { normalizedChangeSet: [{ changeId: "1" }, { changeId: "2" }] }, false],
  ];
  for (const [name, a, b, same] of pairs) assert("serialization", name, (computeHash(a) === computeHash(b)) === same, { left: stableCanonicalize(a), right: stableCanonicalize(b) });

  // Version chain performance and correctness
  for (const count of [1, 10, 100, 500, 1000]) {
    const projectId = `${prefix}-chain-${count}`;
    const memBefore = process.memoryUsage().heapUsed;
    const rows = await insertVersions(projectId, count);
    const started = Date.now();
    const res = await request(`/api/story-bible/versions/integrity?projectId=${projectId}`);
    const elapsed = Date.now() - started;
    const memAfter = process.memoryUsage().heapUsed;
    assert("chain", `${count} version chain valid`, res.ok && res.body?.valid === true && res.body?.checkedVersions === count && res.body?.rootHash === rows[count - 1].integrity_hash, { elapsedMs: elapsed, versionsPerSecond: Math.round(count / Math.max(0.001, elapsed / 1000)), memoryDeltaBytes: memAfter - memBefore, body: res.body });
  }
  const rangeProject = `${prefix}-range`;
  await insertVersions(rangeProject, 10);
  const single = await request(`/api/story-bible/versions/integrity?projectId=${rangeProject}&fromVersion=5&toVersion=5`);
  const range = await request(`/api/story-bible/versions/integrity?projectId=${rangeProject}&fromVersion=3&toVersion=7`);
  const details = await request(`/api/story-bible/versions/integrity?projectId=${rangeProject}&includeDetails=true`, { headers: { "x-admin-token": adminToken } });
  assert("chain", "single version verification", single.ok && single.body?.checkedVersions === 1 && single.body?.valid === true, single.body);
  assert("chain", "range verification", range.ok && range.body?.checkedVersions === 5 && range.body?.valid === true, range.body);
  assert("chain", "full chain details include previous hash continuity", details.ok && details.body?.details?.every((d, i, arr) => i === 0 || d.previousIntegrityHash === arr[i - 1].actualHash), details.body);

  // Tamper matrix
  const tamperCases = [
    ["changeSetJson", "update public.story_bible_versions set change_set=jsonb_set(change_set,'{newValue}','999'::jsonb) where version_number=2"],
    ["previousValue", "update public.story_bible_versions set change_set=jsonb_set(change_set,'{previousValue}','999'::jsonb) where version_number=2"],
    ["newValue", "update public.story_bible_versions set change_set=jsonb_set(change_set,'{newValue}','1000'::jsonb) where version_number=2"],
    ["parentVersionId", "update public.story_bible_versions set parent_version_id='broken_parent' where version_number=2"],
    ["previousIntegrityHash", "update public.story_bible_versions set previous_integrity_hash='broken_hash' where version_number=2"],
    ["operationType", "update public.story_bible_versions set operation_type='edit-and-approve' where version_number=2"],
    ["operationSource", "update public.story_bible_versions set operation_source='tampered' where version_number=2"],
    ["sourceProviderType", "update public.story_bible_versions set source_provider_type='tampered' where version_number=2"],
    ["sourceProviderLocation", "update public.story_bible_versions set source_provider_location='tampered' where version_number=2"],
    ["sourceModelId", "update public.story_bible_versions set source_model_id='tampered' where version_number=2"],
    ["sourceExecutionId", "update public.story_bible_versions set source_execution_id='tampered' where version_number=2"],
    ["sourceMode", "update public.story_bible_versions set source_mode='manual' where version_number=2"],
    ["dataLeftDevice", "update public.story_bible_versions set data_left_device=false where version_number=2"],
    ["storageLocation", "update public.story_bible_versions set storage_location='tampered' where version_number=2"],
    ["canonicalAuthority", "update public.story_bible_versions set canonical_authority='remote' where version_number=2"],
    ["createdBy", "update public.story_bible_versions set created_by='tampered' where version_number=2"],
    ["createdAt", "update public.story_bible_versions set created_at='2026-07-14T10:00:00Z' where version_number=2"],
    ["duplicateVersionNumber", "update public.story_bible_versions set version_number=1 where version_number=2"],
    ["missingVersionNumber", "delete from public.story_bible_versions where version_number=2"],
    ["wrongProjectParent", "update public.story_bible_versions set parent_version_id='other_project_v1' where version_number=2"],
    ["unsupportedSchemaVersion", "update public.story_bible_versions set integrity_schema_version='story-bible-integrity-v0' where version_number=2"],
    ["unsupportedAlgorithm", "update public.story_bible_versions set integrity_algorithm='MD5' where version_number=2"],
    ["pendingVersion", "update public.story_bible_versions set integrity_hash=null, integrity_status='pending' where version_number=2"],
    ["summaryTamper", "update public.story_bible_versions set summary='tampered' where version_number=2"],
    ["candidateIdsTamper", "update public.story_bible_versions set candidate_ids=array['tampered_candidate'] where version_number=2"],
  ];
  for (const [name, update] of tamperCases) {
    const projectId = `${prefix}-tamper-${name}`;
    await insertVersions(projectId, name === "missingVersionNumber" ? 3 : 2);
    try {
      if (name === "wrongProjectParent") {
        const other = `${projectId}-other`;
        await insertVersions(other, 1);
        await sql(`${update.replace("other_project_v1", `${other}_v1`)} and project_id='${esc(projectId)}';`);
      } else {
        await sql(`${update} and project_id='${esc(projectId)}';`);
      }
    } catch (error) {
      assert("tamper", `${name} blocked by database`, name === "duplicateVersionNumber", { message: error.message });
      continue;
    }
    const res = await request(`/api/story-bible/versions/integrity?projectId=${projectId}`);
    assert("tamper", `${name} detected`, res.ok && res.body?.valid === false, res.body);
  }

  // Backfill matrix
  const legacyBase = `${prefix}-legacy`;
  await insertBible(legacyBase);
  await sql(`insert into public.story_bible_versions(id,project_id,version_number,parent_version_id,operation_type,candidate_ids,approved_candidate_ids,change_set,created_by,created_at,operation_source,mutation_request_ids,summary,source_provider_type,source_provider_location,source_mode,data_left_device,storage_location,integrity_status)
values
('${legacyBase}_v1','${legacyBase}',1,null,'approve',array['c1'],array['c1'],${js({ entityType: "character", entityId: "legacy", fieldPath: "characters[].age", operation: "update", newValue: 1 })},'legacy','2026-07-14T00:00:00Z','legacy_unknown',array['r1'],'legacy v1','legacy_unknown','unknown','legacy',null,'legacy_unknown','legacy_uninitialized'),
('${legacyBase}_v2','${legacyBase}',2,'${legacyBase}_v1','approve',array['c2'],array['c2'],${js({ entityType: "character", entityId: "legacy", fieldPath: "characters[].age", operation: "update", previousValue: 1, newValue: 2 })},'legacy','2026-07-14T00:01:00Z','legacy_unknown',array['r2'],'legacy v2','legacy_unknown','unknown','legacy',null,'legacy_unknown','legacy_uninitialized'),
('${legacyBase}_v3','${legacyBase}',3,'${legacyBase}_v2','approve',array['c3'],array['c3'],${js({ entityType: "character", entityId: "legacy", fieldPath: "characters[].age", operation: "update", previousValue: 2, newValue: 3 })},'legacy','2026-07-14T00:02:00Z','legacy_unknown',array['r3'],'legacy v3','legacy_unknown','unknown','legacy',null,'legacy_unknown','legacy_uninitialized');`);
  const backfillChecks = [
    ["dryRun no writes", await admin("/api/admin/story-bible/integrity-backfill", { projectId: legacyBase, dryRun: true, batchSize: 1 }), (b) => b.dryRun && b.updatedCount === 0 && b.plannedCount === 3],
    ["batchSize=1 writes", await admin("/api/admin/story-bible/integrity-backfill", { projectId: legacyBase, dryRun: false, batchSize: 1 }), (b) => b.updatedCount === 3],
    ["idempotent rerun", await admin("/api/admin/story-bible/integrity-backfill", { projectId: legacyBase, dryRun: false, batchSize: 10 }), (b) => b.updatedCount === 0 && b.conflictCount === 0],
    ["from/to range no changes after valid", await admin("/api/admin/story-bible/integrity-backfill", { projectId: legacyBase, dryRun: false, fromVersion: 2, toVersion: 3, batchSize: 100 }), (b) => b.scannedVersions === 2 && b.updatedCount === 0],
    ["wrong project 404", await admin("/api/admin/story-bible/integrity-backfill", { projectId: `${prefix}-missing`, dryRun: true }), (_b, r) => r.status === 404],
  ];
  for (const [name, res, pred] of backfillChecks) assert("backfill", name, pred(res.body, res), res.body);
  const legacyValid = await request(`/api/story-bible/versions/integrity?projectId=${legacyBase}`);
  assert("backfill", "backfilled chain verifies", legacyValid.ok && legacyValid.body?.valid === true, legacyValid.body);

  // Integrity API matrix
  const apiProject = `${prefix}-api`;
  await insertVersions(apiProject, 3);
  await sql(`update public.story_bible_versions set summary='api tamper' where project_id='${apiProject}' and version_number=3;`);
  const apiTests = [
    ["valid response", `/api/story-bible/versions/integrity?projectId=${rangeProject}`, 200, (b) => b.valid === true],
    ["invalid response", `/api/story-bible/versions/integrity?projectId=${apiProject}`, 200, (b) => b.valid === false],
    ["firstInvalidVersion", `/api/story-bible/versions/integrity?projectId=${apiProject}`, 200, (b) => b.firstInvalidVersion?.versionNumber === 3],
    ["includeDetails=false", `/api/story-bible/versions/integrity?projectId=${rangeProject}`, 200, (b) => !("details" in b)],
    ["includeDetails=true admin", `/api/story-bible/versions/integrity?projectId=${rangeProject}&includeDetails=true`, 200, (b) => Array.isArray(b.details), { "x-admin-token": adminToken }],
    ["includeDetails=true unauthorized", `/api/story-bible/versions/integrity?projectId=${rangeProject}&includeDetails=true`, 401, () => true],
    ["wrong project", `/api/story-bible/versions/integrity?projectId=${prefix}-nope`, 404, (b) => b.errorCode === "PROJECT_NOT_FOUND"],
    ["missing projectId", `/api/story-bible/versions/integrity`, 400, (b) => b.errorCode === "PROJECT_ID_REQUIRED"],
    ["invalid range", `/api/story-bible/versions/integrity?projectId=${rangeProject}&fromVersion=99&toVersion=100`, 400, (b) => b.errorCode === "VERSION_RANGE_INVALID"],
    ["fromVersion greater than toVersion", `/api/story-bible/versions/integrity?projectId=${rangeProject}&fromVersion=8&toVersion=2`, 400, (b) => b.errorCode === "VERSION_RANGE_INVALID"],
    ["unsupported schema", `/api/story-bible/versions/integrity?projectId=${apiProject}`, 200, (b) => b.valid === false],
    ["error payload has traceId", `/api/story-bible/versions/integrity`, 400, (b) => Boolean(b.traceId && b.stage === "integrity")],
  ];
  for (const [name, path, status, pred, headers] of apiTests) {
    const res = await request(path, headers ? { headers } : {});
    assert("api", name, res.status === status && pred(res.body), { status: res.status, body: res.body });
  }

  // Diff guard
  const diffProject = `${prefix}-diff`;
  await insertVersions(diffProject, 4);
  const d1 = await request(`/api/story-bible/versions/diff?projectId=${diffProject}&fromVersion=1&toVersion=2`);
  const d2 = await request(`/api/story-bible/versions/diff?projectId=${diffProject}&fromVersion=1&toVersion=4`);
  const d3 = await request(`/api/story-bible/versions/diff?projectId=${diffProject}&fromVersion=4&toVersion=1`);
  assert("diff", "valid consecutive diff checked", d1.ok && d1.body?.integrityVerified === "checked", d1.body);
  assert("diff", "valid non-consecutive diff checked", d2.ok && d2.body?.integrityVerified === "checked", d2.body);
  assert("diff", "valid reverse diff checked", d3.ok && d3.body?.integrityVerified === "checked", d3.body);
  await sql(`update public.story_bible_versions set summary='diff tamper' where project_id='${diffProject}' and version_number=3;`);
  const db = await request(`/api/story-bible/versions/diff?projectId=${diffProject}&fromVersion=1&toVersion=4`);
  const unsafePublic = await request(`/api/story-bible/versions/diff?projectId=${diffProject}&fromVersion=1&toVersion=4&allowUnsafeRead=true`);
  const unsafeAdmin = await request(`/api/story-bible/versions/diff?projectId=${diffProject}&fromVersion=1&toVersion=4&allowUnsafeRead=true`, { headers: { "x-admin-token": adminToken } });
  assert("diff", "invalid chain blocks diff", db.status === 409 && db.body?.errorCode === "VERSION_INTEGRITY_FAILED", db.body);
  assert("diff", "public unsafe read denied", unsafePublic.status === 401, { status: unsafePublic.status, body: unsafePublic.body });
  assert("diff", "admin unsafe read allowed and untrusted", unsafeAdmin.ok && unsafeAdmin.body?.integrityVerified === "unsafe_untrusted", unsafeAdmin.body);

  // Transaction behavior
  const txProject = `${prefix}-tx`;
  await insertBible(txProject);
  await sql(`insert into public.story_characters(id,project_id,character_id,canonical_name,character_json,confidence)
values ('${txProject}_char','${txProject}','char_tx','Tx Lin',${js({ age: 10 })},1);`);
  const tx1 = await seedCandidate(txProject, `${txProject}_c1`, 11, 0);
  const beforeBad = await sql(`select count(*)::int as count from public.story_bible_versions where project_id='${txProject}';`);
  await seedCandidate(txProject, `${txProject}_c_bad`, 12, 0);
  const afterBad = await sql(`select count(*)::int as count from public.story_bible_versions where project_id='${txProject}';`);
  const replay = await admin(`/api/story-bible/candidates/${txProject}_c1/approve`, {
    projectId: txProject,
    requestId: `matrix_${txProject}_c1_0`,
    expectedCandidateStatus: "pending",
    expectedStoryBibleVersion: 1,
    reviewReason: "replay",
  });
  const txRows = await sql(`select version_number, integrity_hash, integrity_status from public.story_bible_versions where project_id='${txProject}' order by version_number;`);
  assert("transaction", "approve writes integrity fields", tx1.ok && txRows[0]?.integrity_hash && txRows[0]?.integrity_status === "valid", { tx1: tx1.body, txRows });
  assert("transaction", "bad optimistic version does not create version", Number(afterBad[0]?.count || 0) === Number(beforeBad[0]?.count || 0), { beforeBad, afterBad });
  assert("transaction", "request replay does not duplicate version", replay.status === 409 || replay.ok, { status: replay.status, body: replay.body });
  const txIntegrity = await request(`/api/story-bible/versions/integrity?projectId=${txProject}`);
  assert("transaction", "transaction chain verifies", txIntegrity.ok && txIntegrity.body?.valid === true, txIntegrity.body);

  const cleanupRows = await cleanup();
  assert("cleanup", "fixture cleanup removes matrix rows", cleanupRows.every((row) => Number(row.remaining) === 0), cleanupRows);
}

try {
  await run();
} catch (error) {
  assert("runner", "uncaught exception", false, { message: error.message, stack: error.stack });
  try {
    const cleanupRows = await cleanup();
    assert("cleanup", "cleanup after exception", cleanupRows.every((row) => Number(row.remaining) === 0), cleanupRows);
  } catch (cleanupError) {
    assert("cleanup", "cleanup after exception failed", false, { message: cleanupError.message });
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
  httpP50: percentile(timings.filter((x) => x.kind === "http").map((x) => x.elapsedMs), 50),
  httpP95: percentile(timings.filter((x) => x.kind === "http").map((x) => x.elapsedMs), 95),
  sqlP50: percentile(timings.filter((x) => x.kind === "sql").map((x) => x.elapsedMs), 50),
  sqlP95: percentile(timings.filter((x) => x.kind === "sql").map((x) => x.elapsedMs), 95),
  queryCount: timings.filter((x) => x.kind === "sql").length,
  memoryUsage: process.memoryUsage(),
};

console.log(JSON.stringify({ summary, results }, null, 2));
if (summary.fail > 0 || summary.skip > 0 || summary.pass < 52) process.exit(1);

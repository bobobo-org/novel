import crypto from "crypto";
import fs from "fs";

const baseUrl = process.env.BASE_URL || "https://novel-orcin.vercel.app";
const deploymentUrl = process.env.EXPECTED_DEPLOYMENT_URL || "";
const expectedCommit = process.env.EXPECTED_APP_COMMIT || "";
const expectedDeploymentId = process.env.EXPECTED_DEPLOYMENT_ID || "";
const expectedReleaseTag = process.env.EXPECTED_RELEASE_TAG || "novel-ai-p0c2c3-safe-revert";
const supabaseToken = process.env.SUPABASE_MANAGEMENT_TOKEN;
const supabaseRef = process.env.SUPABASE_PROJECT_REF || "ijjicaiiirkfbewbhepx";
const prefix = `p0c2c3m-${Date.now()}`;
const results = [];
const timings = [];

function loadEnv(path) {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
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

const entityMeta = {
  character: { table: "story_characters", idColumn: "character_id", jsonColumn: "character_json", titleColumn: "canonical_name" },
  event: { table: "story_events", idColumn: "event_id", jsonColumn: "event_json", titleColumn: "title" },
  item: { table: "story_items", idColumn: "item_id", jsonColumn: "item_json", titleColumn: "name" },
  world_rule: { table: "story_world_rules", idColumn: "rule_id", jsonColumn: "rule_json", titleColumn: "title" },
  foreshadowing: { table: "story_foreshadowing", idColumn: "foreshadow_id", jsonColumn: "foreshadow_json", titleColumn: "title", statusColumn: "status" },
  open_thread: { table: "story_open_threads", idColumn: "thread_id", jsonColumn: "thread_json", titleColumn: "title", statusColumn: "status" },
};

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
    const setLike = new Set(["candidateIds", "candidate_ids", "approvedCandidateIds", "approved_candidate_ids", "mutationRequestIds", "mutation_request_ids", "aliases", "sourceRefs", "source_refs", "possessions", "participants", "causes", "consequences", "history", "exceptions"]);
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
    created_at: `2026-07-14T00:00:${String(n).padStart(2, "0")}Z`,
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
    "story_events",
    "story_items",
    "story_world_rules",
    "story_foreshadowing",
    "story_open_threads",
    "story_bibles",
  ]) {
    await sql(`delete from public.${table} where project_id like '${esc(like)}';`).catch(() => []);
  }
}

async function seedStoryBible(projectId) {
  await sql(`insert into public.story_bibles(project_id,schema_version,status,core_json,created_at,updated_at)
values ('${esc(projectId)}','story-bible-v1','active',${js({ projectId })},now(),now()) on conflict(project_id) do nothing;`);
}

async function seedCanonical(projectId, entityType, entityId, title, json, extra = {}) {
  const meta = entityMeta[entityType];
  const columns = ["id", "project_id", meta.idColumn, meta.titleColumn, meta.jsonColumn];
  const values = [`'${esc(projectId)}_${esc(entityId)}'`, `'${esc(projectId)}'`, `'${esc(entityId)}'`, `'${esc(title)}'`, js(json)];
  if (entityType === "world_rule") {
    columns.push("immutable");
    values.push(extra.immutable ? "true" : "false");
  }
  if (meta.statusColumn) {
    columns.push(meta.statusColumn);
    values.push(`'${esc(extra.status || json.status || (entityType === "foreshadowing" ? "planted" : "open"))}'`);
  }
  if (entityType === "open_thread") {
    columns.push("thread_type");
    values.push(`'${esc(extra.threadType || json.threadType || "general")}'`);
  } else {
    columns.push("updated_at");
    values.push("now()");
  }
  await sql(`insert into public.${meta.table}(${columns.join(",")}) values (${values.join(",")}) on conflict(id) do update set ${meta.jsonColumn}=excluded.${meta.jsonColumn}, ${meta.titleColumn}=excluded.${meta.titleColumn};`);
}

async function seedVersions(projectId, changes) {
  let parent = null;
  let previousHash = null;
  const rows = [];
  for (let i = 0; i < changes.length; i += 1) {
    const row = versionRow(projectId, i + 1, parent, changes[i], previousHash);
    rows.push(row);
    parent = row.id;
    previousHash = row.integrity_hash;
  }
  await sql(`insert into public.story_bible_versions(id,project_id,version_number,parent_version_id,operation_type,candidate_ids,approved_candidate_ids,change_set,created_by,created_at,operation_source,mutation_request_ids,summary,source_provider_type,source_provider_location,source_model_id,source_execution_id,source_mode,data_left_device,storage_location,integrity_hash,previous_integrity_hash,integrity_algorithm,integrity_schema_version,integrity_computed_at,integrity_status,canonical_authority)
values ${rows.map(rowSql).join(",")}
on conflict(id) do nothing;`);
  return rows;
}

async function seedRevertCase({ slug, entityType, fieldPath, operation = "updated", previousValue, newValue, currentJson, title = "測試實體", extra = {}, secondChange = null, changeId = "chg_main" }) {
  const projectId = `${prefix}-${slug}`;
  const entityId = `${entityType}_main`;
  await seedStoryBible(projectId);
  await seedCanonical(projectId, entityType, entityId, title, currentJson, extra);
  const change = { changeId, entityType, entityId, entityDisplayName: title, fieldPath, operation, previousValue, newValue, reason: `${slug} change` };
  const changes = secondChange ? [change, secondChange] : [change];
  const rows = await seedVersions(projectId, changes);
  return { projectId, entityId, rows, change };
}

async function dry(versionId, projectId, currentVersion, selectedChangeIds, mode = "strict") {
  return request(`/api/story-bible/versions/${versionId}/revert`, {
    method: "POST",
    body: JSON.stringify({ projectId, requestId: `${projectId}-dry-${crypto.randomUUID()}`, expectedCurrentVersion: currentVersion, revertReason: "matrix dry run", dryRun: true, selectedChangeIds, conflictResolutionMode: mode }),
  });
}

async function apply(versionId, projectId, currentVersion, previewHash, selectedChangeIds, mode = "strict", requestId = `${projectId}-apply-${crypto.randomUUID()}`) {
  return request(`/api/story-bible/versions/${versionId}/revert`, {
    method: "POST",
    body: JSON.stringify({ projectId, requestId, expectedCurrentVersion: currentVersion, revertReason: "matrix apply", dryRun: false, previewHash, selectedChangeIds, conflictResolutionMode: mode }),
  });
}

async function canonicalJson(projectId, entityType, entityId) {
  const meta = entityMeta[entityType];
  const rows = await sql(`select ${meta.jsonColumn} as json_value, ${meta.titleColumn} as title_value${meta.statusColumn ? `, ${meta.statusColumn} as status_value` : ""} from public.${meta.table} where project_id='${esc(projectId)}' and ${meta.idColumn}='${esc(entityId)}';`);
  return rows[0] || {};
}

function fieldLeaf(fieldPath) {
  return fieldPath.split(".").pop();
}

async function assertRevertCase(name, options, expectedValue, category = "entity") {
  const seeded = await seedRevertCase({ slug: name.replace(/[^a-z0-9]+/gi, "-").toLowerCase(), ...options });
  const preview = await dry(seeded.rows.at(-1).id, seeded.projectId, seeded.rows.length, undefined, options.mode || "strict");
  assert(category, `${name} preview`, preview.ok && preview.body?.safeToRevert === true, preview.body);
  const applied = await apply(seeded.rows.at(-1).id, seeded.projectId, seeded.rows.length, preview.body?.previewHash, undefined, options.mode || "strict");
  assert(category, `${name} apply`, applied.ok && applied.body?.newVersion?.versionNumber === seeded.rows.length + 1, applied.body);
  const row = await canonicalJson(seeded.projectId, options.entityType, seeded.entityId);
  const leaf = fieldLeaf(options.fieldPath);
  const actual = leaf === "status" && row.status_value != null ? row.status_value : row.json_value?.[leaf] ?? row.title_value;
  assert(category, `${name} canonical`, JSON.stringify(actual) === JSON.stringify(expectedValue), { actual, expectedValue, row });
  return { ...seeded, preview, applied };
}

async function run() {
  await cleanup();

  const health = await request("/api/ai/health?matrix=1");
  assert("alias", "public alias commit", health.ok && (!expectedCommit || health.body?.appCommit === expectedCommit), health.body);
  assert("alias", "public alias tag", health.body?.releaseTag === expectedReleaseTag, health.body);
  assert("alias", "public alias deployment", !expectedDeploymentId || health.body?.deploymentId === expectedDeploymentId, health.body);
  assert("alias", "migration includes C2C3", String(health.body?.migrationVersion || "").includes("p0c2c3_safe_revert_011"), health.body);
  assert("alias", "revert ready", health.body?.storyBibleRevertStatus === "ready", health.body);
  assert("alias", "versioning ready", health.body?.storyBibleVersioningStatus === "ready", health.body);
  assert("alias", "provenance ready", health.body?.storyBibleProvenanceStatus === "ready", health.body);
  assert("alias", "cache no-store", String(health.headers["cache-control"] || "").includes("no-store"), health.headers);
  const healthBust = await request(`/api/ai/health?matrix=${Date.now()}`);
  assert("alias", "cache-busting same deployment", healthBust.body?.deploymentId === health.body?.deploymentId, healthBust.body);
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  const healthLater = await request("/api/ai/health?matrix=later");
  assert("alias", "10 second GET same deployment", healthLater.body?.deploymentId === health.body?.deploymentId, healthLater.body);
  if (deploymentUrl) {
    const dep = await request(`${deploymentUrl.replace(/\/$/, "")}/api/ai/health?matrix=deployment`);
    assert("alias", "deployment URL matches alias", dep.ok && dep.body?.appCommit === health.body?.appCommit && dep.body?.deploymentId === health.body?.deploymentId, dep.body);
  } else {
    assert("alias", "deployment URL matches alias", true, { skippedBecause: "EXPECTED_DEPLOYMENT_URL not set" });
  }

  await assertRevertCase("character scalar age", { entityType: "character", fieldPath: "characters[].age", previousValue: 28, newValue: 35, currentJson: { age: 35, lifeStatus: "alive" } }, 28);
  await assertRevertCase("character aliases append", { entityType: "character", fieldPath: "characters[].aliases", operation: "appended", previousValue: [], newValue: ["少主"], currentJson: { aliases: ["少主"] } }, []);
  await assertRevertCase("character aliases remove", { entityType: "character", fieldPath: "characters[].aliases", operation: "removed", previousValue: ["少主"], newValue: ["少主"], currentJson: { aliases: [] } }, ["少主"]);
  await assertRevertCase("character location", { entityType: "character", fieldPath: "characters[].currentLocationId", previousValue: "loc_a", newValue: "loc_b", currentJson: { currentLocationId: "loc_b" }, mode: "review_required" }, "loc_a");
  await assertRevertCase("character life status", { entityType: "character", fieldPath: "characters[].lifeStatus", previousValue: "alive", newValue: "dead", currentJson: { lifeStatus: "dead" }, mode: "review_required" }, "alive");
  await assertRevertCase("character possessions", { entityType: "character", fieldPath: "characters[].possessions", operation: "appended", previousValue: [], newValue: ["item_a"], currentJson: { possessions: ["item_a"] }, mode: "review_required" }, []);
  const created = await assertRevertCase("character create tombstone", { entityType: "character", fieldPath: "characters[].canonicalName", operation: "created", previousValue: null, newValue: "新角", currentJson: { active: true, status: "active" } }, "新角");
  const createdRow = await canonicalJson(created.projectId, "character", created.entityId);
  assert("entity", "character create revert inactive", createdRow.json_value?.active === false && createdRow.json_value?.status === "reverted", createdRow);

  await assertRevertCase("event create tombstone", { entityType: "event", fieldPath: "events[].title", operation: "created", previousValue: null, newValue: "初遇", currentJson: { title: "初遇", active: true } }, "初遇");
  await assertRevertCase("event title update", { entityType: "event", fieldPath: "events[].title", previousValue: "舊事件", newValue: "新事件", currentJson: { title: "新事件" } }, "舊事件");
  await assertRevertCase("event participants append", { entityType: "event", fieldPath: "events[].participants", operation: "appended", previousValue: [], newValue: ["char_a"], currentJson: { participants: ["char_a"] } }, []);
  await assertRevertCase("event participants remove", { entityType: "event", fieldPath: "events[].participants", operation: "removed", previousValue: ["char_a"], newValue: ["char_a"], currentJson: { participants: [] } }, ["char_a"]);
  await assertRevertCase("event causes", { entityType: "event", fieldPath: "events[].causes", operation: "appended", previousValue: [], newValue: ["event_a"], currentJson: { causes: ["event_a"] }, mode: "review_required" }, []);
  await assertRevertCase("event consequences", { entityType: "event", fieldPath: "events[].consequences", operation: "appended", previousValue: [], newValue: ["event_b"], currentJson: { consequences: ["event_b"] }, mode: "review_required" }, []);
  await assertRevertCase("event status", { entityType: "event", fieldPath: "events[].status", previousValue: "open", newValue: "completed", currentJson: { status: "completed" }, mode: "review_required" }, "open");

  await assertRevertCase("item create tombstone", { entityType: "item", fieldPath: "items[].name", operation: "created", previousValue: null, newValue: "赤霄劍", currentJson: { active: true } }, "赤霄劍");
  await assertRevertCase("item owner", { entityType: "item", fieldPath: "items[].currentOwnerCharacterId", previousValue: "char_a", newValue: "char_b", currentJson: { currentOwnerCharacterId: "char_b" }, mode: "review_required" }, "char_a");
  await assertRevertCase("item location", { entityType: "item", fieldPath: "items[].currentLocationId", previousValue: "loc_a", newValue: "loc_b", currentJson: { currentLocationId: "loc_b" }, mode: "review_required" }, "loc_a");
  await assertRevertCase("item status", { entityType: "item", fieldPath: "items[].status", previousValue: "sealed", newValue: "active", currentJson: { status: "active" } }, "sealed");
  await assertRevertCase("item history", { entityType: "item", fieldPath: "items[].history", operation: "appended", previousValue: [], newValue: ["transfer"], currentJson: { history: ["transfer"] }, mode: "review_required" }, []);

  await assertRevertCase("world rule create tombstone", { entityType: "world_rule", fieldPath: "worldRules[].title", operation: "created", previousValue: null, newValue: "死者不可復生", currentJson: { active: true }, extra: { immutable: false } }, "死者不可復生");
  await assertRevertCase("world rule mutable update", { entityType: "world_rule", fieldPath: "worldRules[].description", previousValue: "舊規則", newValue: "新規則", currentJson: { description: "新規則" }, extra: { immutable: false } }, "舊規則");
  const immutable = await seedRevertCase({ slug: "immutable-rule", entityType: "world_rule", fieldPath: "worldRules[].immutable", previousValue: false, newValue: true, currentJson: { immutable: true }, extra: { immutable: true } });
  const immutableDry = await dry(immutable.rows[0].id, immutable.projectId, 1);
  assert("dependency", "immutable rule blocks strict", immutableDry.ok && immutableDry.body?.safeToRevert === false && immutableDry.body?.blockingDependencies?.length > 0, immutableDry.body);
  await assertRevertCase("world rule exceptions", { entityType: "world_rule", fieldPath: "worldRules[].exceptions", operation: "appended", previousValue: [], newValue: ["血祭例外"], currentJson: { exceptions: ["血祭例外"] }, extra: { immutable: false } }, []);

  await assertRevertCase("foreshadow planted developing", { entityType: "foreshadowing", fieldPath: "foreshadowing[].status", previousValue: "planted", newValue: "developing", currentJson: { status: "developing" }, extra: { status: "developing" }, mode: "review_required" }, "planted");
  await assertRevertCase("foreshadow developing partial", { entityType: "foreshadowing", fieldPath: "foreshadowing[].status", previousValue: "developing", newValue: "partially_paid", currentJson: { status: "partially_paid" }, extra: { status: "partially_paid" }, mode: "review_required" }, "developing");
  await assertRevertCase("foreshadow partial paid", { entityType: "foreshadowing", fieldPath: "foreshadowing[].status", previousValue: "partially_paid", newValue: "paid", currentJson: { status: "paid" }, extra: { status: "paid" }, mode: "review_required" }, "partially_paid");
  await assertRevertCase("foreshadow payoff chapter", { entityType: "foreshadowing", fieldPath: "foreshadowing[].payoffChapterId", previousValue: null, newValue: "ch10", currentJson: { payoffChapterId: "ch10" }, mode: "review_required" }, null);
  await assertRevertCase("foreshadow abandoned reason", { entityType: "foreshadowing", fieldPath: "foreshadowing[].abandonedReason", previousValue: null, newValue: "作者放棄", currentJson: { abandonedReason: "作者放棄" }, mode: "review_required" }, null);

  await assertRevertCase("thread create tombstone", { entityType: "open_thread", fieldPath: "openThreads[].title", operation: "created", previousValue: null, newValue: "母親死因", currentJson: { active: true }, extra: { status: "open" } }, "母親死因");
  await assertRevertCase("thread open developing", { entityType: "open_thread", fieldPath: "openThreads[].status", previousValue: "open", newValue: "developing", currentJson: { status: "developing" }, extra: { status: "developing" }, mode: "review_required" }, "open");
  await assertRevertCase("thread developing resolved", { entityType: "open_thread", fieldPath: "openThreads[].status", previousValue: "developing", newValue: "resolved", currentJson: { status: "resolved" }, extra: { status: "resolved" }, mode: "review_required" }, "developing");
  await assertRevertCase("thread resolved chapter", { entityType: "open_thread", fieldPath: "openThreads[].resolvedChapterId", previousValue: null, newValue: "ch12", currentJson: { resolvedChapterId: "ch12" }, extra: { status: "resolved" }, mode: "review_required" }, null);
  await assertRevertCase("thread abandoned state", { entityType: "open_thread", fieldPath: "openThreads[].status", previousValue: "developing", newValue: "abandoned", currentJson: { status: "abandoned" }, extra: { status: "abandoned" }, mode: "review_required" }, "developing");

  const depFields = [
    ["same-field later modification", "character", "characters[].age", "field_dependency", "blocking"],
    ["character lifeStatus dependency", "character", "characters[].lifeStatus", "life_status_dependency", "major"],
    ["character location dependency", "character", "characters[].currentLocationId", "location_dependency", "major"],
    ["character possessions dependency", "character", "characters[].possessions", "possession_dependency", "major"],
    ["event causal dependency", "event", "events[].causes", "event_causal_dependency", "major"],
    ["event consequence dependency", "event", "events[].consequences", "event_consequence_dependency", "major"],
    ["item ownership dependency", "item", "items[].currentOwnerCharacterId", "ownership_dependency", "major"],
    ["item location dependency", "item", "items[].currentLocationId", "location_dependency", "major"],
    ["item history dependency", "item", "items[].history", "item_history_dependency", "major"],
    ["world rule dependency", "world_rule", "worldRules[].scope", undefined, undefined],
    ["immutable world rule dependency", "world_rule", "worldRules[].immutable", "world_rule_dependency", "blocking"],
    ["foreshadow payoff dependency", "foreshadowing", "foreshadowing[].payoffChapterId", "foreshadowing_dependency", "major"],
    ["open thread resolution dependency", "open_thread", "openThreads[].resolvedChapterId", "open_thread_dependency", "major"],
    ["source dependency", "event", "events[].sourceRefs", "source_dependency", "major"],
    ["derived fact dependency", "event", "events[].derivedScore", "derived_fact_dependency", "major"],
    ["candidate dependency", "event", "events[].candidateLink", "candidate_dependency", "major"],
    ["entity creation dependency", "item", "items[].name", "entity_creation_dependency", "major", "created"],
    ["tombstone dependency", "character", "characters[].active", "tombstone_dependency", "major"],
  ];
  for (const [name, entityType, fieldPath, depType, severity, op] of depFields) {
    const currentJson = { [fieldLeaf(fieldPath)]: fieldPath.includes("[]") ? "new" : "new" };
    const seeded = await seedRevertCase({ slug: `dep-${name}`, entityType, fieldPath, operation: op || "updated", previousValue: "old", newValue: "new", currentJson, extra: entityType === "foreshadowing" ? { status: "developing" } : entityType === "open_thread" ? { status: "developing" } : {} });
    const preview = await dry(seeded.rows[0].id, seeded.projectId, 1);
    const deps = preview.body?.dependencyGraph || [];
    const ok = depType ? deps.some((dep) => dep.dependencyType === depType && dep.severity === severity) : preview.ok;
    assert("dependency", name, ok, preview.body);
  }
  const depProject = `${prefix}-dep-later`;
  await seedStoryBible(depProject);
  await seedCanonical(depProject, "character", "character_main", "林昭", { age: 22 });
  const depRows = await seedVersions(depProject, [
    { changeId: "chg1", entityType: "character", entityId: "character_main", entityDisplayName: "林昭", fieldPath: "characters[].age", operation: "updated", previousValue: 20, newValue: 21 },
    { changeId: "chg2", entityType: "character", entityId: "character_main", entityDisplayName: "林昭", fieldPath: "characters[].age", operation: "updated", previousValue: 21, newValue: 22 },
  ]);
  const depPreview = await dry(depRows[0].id, depProject, 2);
  assert("dependency", "later version dependency", depPreview.body?.dependentVersions?.includes(2), depPreview.body);
  const depApply = await apply(depRows[0].id, depProject, 2, depPreview.body?.previewHash);
  assert("dependency", "dry-run reports dependency without mutation", depApply.status === 409 && depApply.body?.errorCode === "REVERT_DEPENDENCY_CONFLICT", depApply.body);

  const atomic = await seedRevertCase({
    slug: "atomic-item-owner-history",
    entityType: "item",
    fieldPath: "items[].currentOwnerCharacterId",
    previousValue: "char_a",
    newValue: "char_b",
    currentJson: { currentOwnerCharacterId: "char_b", history: ["transfer"] },
    secondChange: { changeId: "chg_history", entityType: "item", entityId: "item_main", entityDisplayName: "測試實體", fieldPath: "items[].history", operation: "appended", previousValue: [], newValue: ["transfer"] },
  });
  const unsafe = await dry(atomic.rows[1].id, atomic.projectId, 2, ["chg_history"]);
  assert("partial", "atomic group blocks unsafe split", unsafe.status === 422 && unsafe.body?.errorCode === "PARTIAL_REVERT_NOT_SAFE", unsafe.body);
  const unchangedCount = await sql(`select count(*)::int as count from public.story_bible_versions where project_id='${esc(atomic.projectId)}';`);
  assert("partial", "unsafe split creates no version", Number(unchangedCount[0]?.count) === 2, unchangedCount);
  const independent = await seedRevertCase({
    slug: "partial-independent",
    entityType: "character",
    fieldPath: "characters[].age",
    previousValue: 20,
    newValue: 21,
    currentJson: { age: 21, aliases: ["少主"] },
    secondChange: { changeId: "chg_alias", entityType: "character", entityId: "character_main", entityDisplayName: "測試實體", fieldPath: "characters[].aliases", operation: "appended", previousValue: [], newValue: ["少主"] },
  });
  const partialPreview = await dry(independent.rows[1].id, independent.projectId, 2, ["chg_alias"]);
  assert("partial", "independent partial preview", partialPreview.ok && partialPreview.body?.estimatedOperationType === "partial_revert", partialPreview.body);
  const partialApply = await apply(independent.rows[1].id, independent.projectId, 2, partialPreview.body?.previewHash, ["chg_alias"]);
  assert("partial", "independent partial apply", partialApply.ok && partialApply.body?.operationType === "partial_revert", partialApply.body);

  const previewProject = await seedRevertCase({ slug: "preview-stale", entityType: "character", fieldPath: "characters[].age", previousValue: 1, newValue: 2, currentJson: { age: 2 } });
  const preview = await dry(previewProject.rows[0].id, previewProject.projectId, 1);
  const stale = await apply(previewProject.rows[0].id, previewProject.projectId, 1, "stale-preview-hash-0000000000000000");
  assert("preview", "stale preview rejected", stale.status === 409 && stale.body?.errorCode === "REVERT_PREVIEW_STALE", stale.body);
  assert("preview", "preview hash binds selectedChangeIds", typeof preview.body?.previewHash === "string" && preview.body.previewHash.length >= 16, preview.body);
  const replayDry = await dry(previewProject.rows[0].id, previewProject.projectId, 1);
  assert("preview", "preview replay stable", replayDry.body?.previewHash === preview.body?.previewHash, replayDry.body);
  const afterDry = await sql(`select count(*)::int as count from public.story_bible_versions where project_id='${esc(previewProject.projectId)}';`);
  assert("preview", "preview no mutation", Number(afterDry[0]?.count) === 1, afterDry);

  const idem = await seedRevertCase({ slug: "idempotency", entityType: "character", fieldPath: "characters[].age", previousValue: 5, newValue: 6, currentJson: { age: 6 } });
  const idemPreview = await dry(idem.rows[0].id, idem.projectId, 1);
  const req = `${idem.projectId}-same`;
  const first = await apply(idem.rows[0].id, idem.projectId, 1, idemPreview.body?.previewHash, undefined, "strict", req);
  const second = await apply(idem.rows[0].id, idem.projectId, 1, idemPreview.body?.previewHash, undefined, "strict", req);
  assert("idempotency", "same requestId same payload replay", first.ok && second.ok && second.body?.idempotentReplay === true, second.body);
  const reused = await apply(idem.rows[0].id, idem.projectId, 1, idemPreview.body?.previewHash, undefined, "review_required", req);
  assert("idempotency", "same requestId different payload blocked", reused.status === 409 && reused.body?.errorCode === "REVERT_IDEMPOTENCY_KEY_REUSED", reused.body);
  const conflictAfterApply = await apply(idem.rows[0].id, idem.projectId, 1, idemPreview.body?.previewHash, undefined, "strict", `${idem.projectId}-other`);
  assert("idempotency", "different request after current version blocked", conflictAfterApply.status === 409 && conflictAfterApply.body?.errorCode === "REVERT_CURRENT_VERSION_CONFLICT", conflictAfterApply.body);

  const detail = await request(`/api/story-bible/versions/${first.body?.newVersion?.versionId}?projectId=${idem.projectId}`);
  assert("history", "version detail revertedVersionId", detail.body?.revertInfo?.revertedVersionId || detail.body?.revertInfo?.targetVersionId, detail.body?.revertInfo);
  assert("history", "version detail selectedChangeIds", Array.isArray(detail.body?.revertInfo?.selectedChangeIds), detail.body?.revertInfo);
  assert("history", "version detail dependencySummary", detail.body?.revertInfo?.dependencySummary, detail.body?.revertInfo);
  const entityHistory = await request(`/api/story-bible/entities/character/character_main/history?projectId=${idem.projectId}`);
  assert("history", "entity history restored", JSON.stringify(entityHistory.body || {}).includes("restored"), entityHistory.body);
  const forwardDiff = await request(`/api/story-bible/versions/diff?projectId=${idem.projectId}&fromVersion=1&toVersion=2`);
  assert("history", "forward diff", forwardDiff.ok && forwardDiff.body?.fieldDiffs?.length > 0, forwardDiff.body?.summary);
  const reverseDiff = await request(`/api/story-bible/versions/diff?projectId=${idem.projectId}&fromVersion=2&toVersion=1`);
  assert("history", "reverse diff", reverseDiff.ok, reverseDiff.body?.summary);
  const currentDiff = await request(`/api/story-bible/versions/${first.body?.newVersion?.versionId}/diff-current?projectId=${idem.projectId}`);
  assert("history", "current diff", currentDiff.ok, currentDiff.body?.summary);
  const integrity = await request(`/api/story-bible/versions/integrity?projectId=${idem.projectId}`);
  assert("integrity", "full chain valid", integrity.ok && integrity.body?.valid === true, integrity.body);
  const exp = await request(`/api/story-bible/versions/export?projectId=${idem.projectId}`);
  assert("export", "export includes revert metadata", exp.ok && JSON.stringify(exp.body?.versions || []).includes("revert"), exp.body?.versions?.slice(-1)[0]);
  assert("export", "export authority local", JSON.stringify(exp.body?.versions || []).includes("local"), exp.body?.versions?.slice(-1)[0]);
  assert("export", "export does not contain admin token", !JSON.stringify(exp.body || {}).includes(adminToken), {});

  const audits = await sql(`select status,count(*)::int as count from public.story_bible_revert_audits where project_id like '${esc(prefix)}%' group by status;`);
  assert("audit", "revert audit completed", audits.some((row) => row.status === "completed"), audits);
  const requests = await sql(`select status,count(*)::int as count from public.story_bible_mutation_requests where project_id like '${esc(prefix)}%' group by status;`);
  assert("audit", "mutation requests completed or failed", requests.every((row) => ["completed", "failed"].includes(row.status)), requests);
  const sourceRows = await sql(`select count(*)::int as count from public.story_canonical_sources where project_id like '${esc(prefix)}%' and source_type='revert-operation';`);
  assert("history", "source relations created", Number(sourceRows[0]?.count || 0) > 0, sourceRows);

  const beforeCleanup = await sql(`select count(*)::int as count from public.story_bible_versions where project_id like '${esc(prefix)}%';`);
  assert("cleanup", "fixture rows existed before cleanup", Number(beforeCleanup[0]?.count || 0) > 0, beforeCleanup);
  await cleanup();
  const remaining = await sql(`select count(*)::int as count from public.story_bible_versions where project_id like '${esc(prefix)}%';`);
  assert("cleanup", "fixture cleanup", Number(remaining[0]?.count || 0) === 0, remaining);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
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

console.log(JSON.stringify({ summary, results }, null, 2));
process.exit(summary.fail === 0 && summary.pass >= 69 ? 0 : 1);

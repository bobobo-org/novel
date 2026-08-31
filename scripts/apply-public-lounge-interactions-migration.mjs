import { readFile } from "node:fs/promises";

const MIGRATION_VERSION = "public_lounge_interactions_v1_027";
const args = new Set(process.argv.slice(2));
const required = args.has("--required");
const checkOnly = args.has("--check");
const selfTest = args.has("--self-test");
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_MANAGEMENT_TOKEN || "";
const projectRef = process.env.SUPABASE_PROJECT_REF || process.env.SUPABASE_PROJECT_REF_FALLBACK || "";
const migrationUrl = new URL("../prisma/migrations/027_public_lounge_interactions_v1.sql", import.meta.url);

function fail(status, code, exitCode = 1) {
  console.error(JSON.stringify({ status, migrationVersion: MIGRATION_VERSION, errorCode: code }));
  process.exit(exitCode);
}

async function query(sql) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw Object.assign(new Error(`SUPABASE_INTERACTIONS_MIGRATION_HTTP_${response.status}`), {
        code: `SUPABASE_INTERACTIONS_MIGRATION_HTTP_${response.status}`,
      });
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

const migrationSql = await readFile(migrationUrl, "utf8");

if (selfTest) {
  const requiredFragments = [
    "public_lounge_publication_owners",
    "current_version_number",
    "novel_public_lounge_set_vote",
    "novel_public_lounge_list_comments",
    "(c.created_at, c.id) < (p_before, p_before_id)",
    "novel_public_lounge_assert_owner",
    "novel_public_lounge_sync_owner",
    "novel_public_lounge_deactivate_owner",
    "novel_public_lounge_interactions_status",
    "limit 256",
    "to authenticated",
    "to service_role",
    MIGRATION_VERSION,
  ];
  const normalized = migrationSql.toLowerCase();
  const missing = requiredFragments.filter((fragment) => !normalized.includes(fragment.toLowerCase()));
  if (missing.length > 0) fail("self_test_failed", `MISSING_${missing.join("_")}`);
  for (const serviceOnlyFunction of [
    "novel_public_lounge_bind_owner",
    "novel_public_lounge_assert_owner",
    "novel_public_lounge_sync_owner",
    "novel_public_lounge_deactivate_owner",
    "novel_public_lounge_interactions_status",
  ]) {
    const unsafeGrant = new RegExp(
      `grant\\s+execute\\s+on\\s+function\\s+public\\.${serviceOnlyFunction}[^;]+to\\s+(?:public|anon|authenticated)`,
      "iu",
    );
    if (unsafeGrant.test(migrationSql)) fail("self_test_failed", `UNSAFE_GRANT_${serviceOnlyFunction}`);
  }
  console.log(JSON.stringify({
    status: "self_test_passed",
    migrationVersion: MIGRATION_VERSION,
    ownerLifecycle: "service_role_only",
    commentCursor: "created_at_id",
    cleanupBound: 256,
  }));
  process.exit(0);
}

if (!accessToken || !/^[a-z0-9]{8,32}$/u.test(projectRef)) {
  if (required) fail("migration_channel_missing", "SUPABASE_MANAGEMENT_CONFIGURATION_REQUIRED", 2);
  console.log(JSON.stringify({ status: "migration_channel_missing", migrationVersion: MIGRATION_VERSION }));
  process.exit(0);
}

const verifySql = `
select
  to_regclass('public.public_lounge_publication_owners') is not null as owners_ready,
  to_regprocedure('public.novel_public_lounge_set_vote(text,text,boolean)') is not null as vote_ready,
  to_regprocedure('public.novel_public_lounge_add_comment(text,text,integer,text,text)') is not null as comment_ready,
  to_regprocedure('public.novel_public_lounge_delete_comment(text,text,uuid,text)') is not null as delete_ready,
  to_regprocedure('public.novel_public_lounge_report(text,text,uuid,text,text)') is not null as report_ready,
  to_regprocedure('public.novel_public_lounge_list_comments(text,integer,integer,timestamp with time zone,uuid)') is not null as list_ready,
  to_regprocedure('public.novel_public_lounge_bind_owner(text,uuid,text,integer,integer)') is not null as bind_ready,
  to_regprocedure('public.novel_public_lounge_assert_owner(text,uuid)') is not null as owner_check_ready,
  to_regprocedure('public.novel_public_lounge_sync_owner(text,uuid,text,text,integer,integer)') is not null as owner_sync_ready,
  to_regprocedure('public.novel_public_lounge_deactivate_owner(text,uuid,text,integer)') is not null as deactivate_ready,
  to_regprocedure('public.novel_public_lounge_interactions_status()') is not null as status_ready,
  exists(select 1 from public.schema_migrations where version = '${MIGRATION_VERSION}') as marker_ready;
`;

function ready(value) {
  const row = Array.isArray(value) ? value[0] : value;
  return row?.owners_ready === true
    && row?.vote_ready === true
    && row?.comment_ready === true
    && row?.delete_ready === true
    && row?.report_ready === true
    && row?.list_ready === true
    && row?.bind_ready === true
    && row?.owner_check_ready === true
    && row?.owner_sync_ready === true
    && row?.deactivate_ready === true
    && row?.status_ready === true
    && row?.marker_ready === true;
}

try {
  const before = await query(verifySql);
  const alreadyReady = ready(before);
  if (checkOnly || alreadyReady) {
    console.log(JSON.stringify({
      status: alreadyReady ? "migration_already_verified" : "migration_required",
      migrationVersion: MIGRATION_VERSION,
      projectRefSuffix: projectRef.slice(-4),
    }));
    process.exit(alreadyReady ? 0 : 3);
  }
  await query(migrationSql);
  if (!ready(await query(verifySql))) {
    fail("migration_verification_failed", "PUBLIC_LOUNGE_INTERACTIONS_NOT_READY");
  }
  console.log(JSON.stringify({
    status: "migration_applied_and_verified",
    migrationVersion: MIGRATION_VERSION,
    projectRefSuffix: projectRef.slice(-4),
  }));
} catch (error) {
  fail("migration_failed", String(error?.code || error?.name || "SUPABASE_INTERACTIONS_MIGRATION_FAILED"));
}

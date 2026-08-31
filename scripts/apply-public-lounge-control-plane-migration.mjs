import { readFile } from "node:fs/promises";

const MIGRATION_VERSION = "public_lounge_control_plane_028";
const args = new Set(process.argv.slice(2));
const required = args.has("--required");
const checkOnly = args.has("--check");
const selfTest = args.has("--self-test");
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_MANAGEMENT_TOKEN || "";
const projectRef = process.env.SUPABASE_PROJECT_REF || process.env.SUPABASE_PROJECT_REF_FALLBACK || "";
const migrationUrl = new URL("../prisma/migrations/028_public_lounge_control_plane.sql", import.meta.url);

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
      throw Object.assign(new Error(`SUPABASE_PUBLIC_LOUNGE_MIGRATION_HTTP_${response.status}`), {
        code: `SUPABASE_PUBLIC_LOUNGE_MIGRATION_HTTP_${response.status}`,
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
    "public_lounge_catalog_anchors",
    "public_lounge_rate_buckets",
    "novel_public_lounge_catalog_upsert",
    "novel_public_lounge_catalog_deactivate",
    "novel_public_lounge_catalog_list",
    "novel_public_lounge_rate_reserve",
    "novel_public_lounge_control_plane_status",
    "limit p_limit + 1",
    "limit 64",
    "on conflict (identity_hash, scope, window_start) do update",
    "force row level security",
    "to service_role",
    MIGRATION_VERSION,
  ];
  const normalized = migrationSql.toLowerCase();
  const missing = requiredFragments.filter((fragment) => !normalized.includes(fragment.toLowerCase()));
  if (missing.length > 0) fail("self_test_failed", `MISSING_${missing.join("_")}`);
  if (/grant\s+[^;]+\s+to\s+(?:public|anon|authenticated)\b/iu.test(migrationSql)) {
    fail("self_test_failed", "PUBLIC_DATABASE_GRANT_DETECTED");
  }
  const catalogTable = /create table if not exists public\.public_lounge_catalog_anchors\s*\(([\s\S]*?)\n\);/iu.exec(migrationSql)?.[1] ?? "";
  if (!catalogTable || /title|author|synopsis|chapter|topic|quality|content|summary/iu.test(catalogTable)) {
    fail("self_test_failed", "CATALOG_CONTAINS_PUBLICATION_CONTENT");
  }
  console.log(JSON.stringify({
    status: "self_test_passed",
    migrationVersion: MIGRATION_VERSION,
    catalogContentColumns: 0,
    catalogRpcPageLimit: 100,
    rateCleanupBound: 64,
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
  to_regclass('public.public_lounge_catalog_anchors') is not null as catalog_table_ready,
  to_regclass('public.public_lounge_rate_buckets') is not null as rate_table_ready,
  to_regprocedure('public.novel_public_lounge_catalog_upsert(text,timestamp with time zone)') is not null as catalog_upsert_ready,
  to_regprocedure('public.novel_public_lounge_catalog_deactivate(text)') is not null as catalog_deactivate_ready,
  to_regprocedure('public.novel_public_lounge_catalog_list(timestamp with time zone,text,integer)') is not null as catalog_list_ready,
  to_regprocedure('public.novel_public_lounge_rate_reserve(text,text)') is not null as rate_reserve_ready,
  to_regprocedure('public.novel_public_lounge_control_plane_status()') is not null as status_ready,
  exists(select 1 from public.schema_migrations where version = '${MIGRATION_VERSION}') as marker_ready;
`;

function ready(value) {
  const row = Array.isArray(value) ? value[0] : value;
  return row?.catalog_table_ready === true
    && row?.rate_table_ready === true
    && row?.catalog_upsert_ready === true
    && row?.catalog_deactivate_ready === true
    && row?.catalog_list_ready === true
    && row?.rate_reserve_ready === true
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
    fail("migration_verification_failed", "PUBLIC_LOUNGE_CONTROL_PLANE_NOT_READY");
  }
  console.log(JSON.stringify({
    status: "migration_applied_and_verified",
    migrationVersion: MIGRATION_VERSION,
    projectRefSuffix: projectRef.slice(-4),
  }));
} catch (error) {
  fail("migration_failed", String(error?.code || error?.name || "SUPABASE_PUBLIC_LOUNGE_MIGRATION_FAILED"));
}

import { readFile } from "node:fs/promises";

const MIGRATION_VERSION = "shared_abstract_learning_rules_026";
const args = new Set(process.argv.slice(2));
const required = args.has("--required");
const checkOnly = args.has("--check");
const selfTest = args.has("--self-test");
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_MANAGEMENT_TOKEN || "";
const projectRef = process.env.SUPABASE_PROJECT_REF || process.env.SUPABASE_PROJECT_REF_FALLBACK || "";
const migrationUrl = new URL("../prisma/migrations/026_shared_abstract_learning_rules.sql", import.meta.url);

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
      throw Object.assign(new Error(`SUPABASE_SHARED_LEARNING_MIGRATION_HTTP_${response.status}`), {
        code: `SUPABASE_SHARED_LEARNING_MIGRATION_HTTP_${response.status}`,
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
    "shared_abstract_learning_rules",
    "shared_abstract_learning_observations",
    "novel_shared_learning_publish",
    "idx_shared_learning_family_rank",
    "idx_shared_learning_dimension_rank",
    "idx_shared_learning_global_rank",
    "jsonb_path_ops",
    MIGRATION_VERSION,
    "enable row level security",
    "to service_role",
  ];
  const missing = requiredFragments.filter((fragment) => !migrationSql.includes(fragment));
  if (missing.length) fail("self_test_failed", `MISSING_${missing.join("_")}`);
  if (/grant\s+.*\s+to\s+(?:anon|authenticated)/iu.test(migrationSql)) {
    fail("self_test_failed", "PUBLIC_DATABASE_GRANT_DETECTED");
  }
  console.log(JSON.stringify({
    status: "self_test_passed",
    migrationVersion: MIGRATION_VERSION,
    boundedTopKIndexes: 3,
    rawStoryColumns: 0,
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
  to_regclass('public.shared_abstract_learning_rules') is not null as rules_ready,
  to_regclass('public.shared_abstract_learning_observations') is not null as observations_ready,
  to_regprocedure('public.novel_shared_learning_publish(text,text,text,jsonb)') is not null as publish_ready,
  exists(select 1 from public.schema_migrations where version = '${MIGRATION_VERSION}') as marker_ready;
`;

try {
  const before = await query(verifySql);
  const beforeRow = Array.isArray(before) ? before[0] : before;
  const alreadyReady = beforeRow?.rules_ready === true
    && beforeRow?.observations_ready === true
    && beforeRow?.publish_ready === true
    && beforeRow?.marker_ready === true;
  if (checkOnly || alreadyReady) {
    console.log(JSON.stringify({
      status: alreadyReady ? "migration_already_verified" : "migration_required",
      migrationVersion: MIGRATION_VERSION,
      projectRefSuffix: projectRef.slice(-4),
    }));
    process.exit(alreadyReady ? 0 : 3);
  }
  await query(migrationSql);
  const after = await query(verifySql);
  const row = Array.isArray(after) ? after[0] : after;
  if (!(row?.rules_ready && row?.observations_ready && row?.publish_ready && row?.marker_ready)) {
    fail("migration_verification_failed", "SHARED_LEARNING_SCHEMA_NOT_READY");
  }
  console.log(JSON.stringify({
    status: "migration_applied_and_verified",
    migrationVersion: MIGRATION_VERSION,
    projectRefSuffix: projectRef.slice(-4),
  }));
} catch (error) {
  fail("migration_failed", String(error?.code || error?.name || "SUPABASE_SHARED_LEARNING_MIGRATION_FAILED"));
}

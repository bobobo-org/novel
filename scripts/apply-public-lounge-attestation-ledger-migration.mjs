import { readFile } from "node:fs/promises";

const MIGRATION_VERSION = "public_lounge_attestation_nonce_ledger_029";
const args = new Set(process.argv.slice(2));
const required = args.has("--required");
const checkOnly = args.has("--check");
const selfTest = args.has("--self-test");
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_MANAGEMENT_TOKEN || "";
const projectRef = process.env.SUPABASE_PROJECT_REF || process.env.SUPABASE_PROJECT_REF_FALLBACK || "";
const migrationUrl = new URL("../prisma/migrations/029_public_lounge_attestation_nonce_ledger.sql", import.meta.url);

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
      throw Object.assign(new Error(`SUPABASE_PUBLIC_LOUNGE_ATTESTATION_MIGRATION_HTTP_${response.status}`), {
        code: `SUPABASE_PUBLIC_LOUNGE_ATTESTATION_MIGRATION_HTTP_${response.status}`,
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
    "public_lounge_attestation_nonce_ledger",
    "attestation_id_hash text primary key",
    "attestation_digest text not null",
    "eligibility_ticket_hash text not null",
    "novel_public_lounge_consume_attestation_v5",
    "novel_public_lounge_attestation_ledger_status",
    "on conflict (attestation_id_hash) do nothing",
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
  const ledgerTable = /create table if not exists public\.public_lounge_attestation_nonce_ledger\s*\(([\s\S]*?)\n\);/iu.exec(migrationSql)?.[1] ?? "";
  if (!ledgerTable || /signature|private_key|content|chapter|synopsis|title|byline/iu.test(ledgerTable)) {
    fail("self_test_failed", "LEDGER_CONTAINS_SENSITIVE_CONTENT");
  }
  console.log(JSON.stringify({
    status: "self_test_passed",
    migrationVersion: MIGRATION_VERSION,
    attestationIdStoredAsHash: true,
    rawAttestationStored: false,
    eligibilityTicketStoredAsHash: true,
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
  to_regclass('public.public_lounge_attestation_nonce_ledger') is not null as ledger_table_ready,
  to_regprocedure('public.novel_public_lounge_consume_attestation_v5(text,text,text,text,text,text,text,timestamp with time zone)') is not null as consume_rpc_ready,
  to_regprocedure('public.novel_public_lounge_attestation_ledger_status()') is not null as status_rpc_ready,
  coalesce((
    select relation.relrowsecurity and relation.relforcerowsecurity
      from pg_catalog.pg_class as relation
     where relation.oid = to_regclass('public.public_lounge_attestation_nonce_ledger')
  ), false) as rls_ready,
  exists(
    select 1 from pg_catalog.pg_constraint as constraint_record
     where constraint_record.conrelid = to_regclass('public.public_lounge_attestation_nonce_ledger')
       and constraint_record.contype = 'p'
       and pg_catalog.pg_get_constraintdef(constraint_record.oid) = 'PRIMARY KEY (attestation_id_hash)'
  ) as primary_key_ready,
  exists(
    select 1 from pg_catalog.pg_constraint as constraint_record
     where constraint_record.conrelid = to_regclass('public.public_lounge_attestation_nonce_ledger')
       and constraint_record.contype = 'u'
       and pg_catalog.pg_get_constraintdef(constraint_record.oid) = 'UNIQUE (attestation_digest)'
  ) as attestation_digest_unique_ready,
  exists(
    select 1 from pg_catalog.pg_constraint as constraint_record
     where constraint_record.conrelid = to_regclass('public.public_lounge_attestation_nonce_ledger')
       and constraint_record.contype = 'u'
       and pg_catalog.pg_get_constraintdef(constraint_record.oid) = 'UNIQUE (eligibility_ticket_hash)'
  ) as ticket_hash_unique_ready,
  coalesce(not has_table_privilege(
    'service_role', to_regclass('public.public_lounge_attestation_nonce_ledger'), 'SELECT,INSERT,UPDATE,DELETE'
  ), false) as service_role_table_revoked,
  coalesce(not has_table_privilege(
    'anon', to_regclass('public.public_lounge_attestation_nonce_ledger'), 'SELECT,INSERT,UPDATE,DELETE'
  ), false) as anon_table_revoked,
  coalesce(not has_table_privilege(
    'authenticated', to_regclass('public.public_lounge_attestation_nonce_ledger'), 'SELECT,INSERT,UPDATE,DELETE'
  ), false) as authenticated_table_revoked,
  coalesce(has_function_privilege(
    'service_role',
    to_regprocedure('public.novel_public_lounge_consume_attestation_v5(text,text,text,text,text,text,text,timestamp with time zone)'),
    'EXECUTE'
  ), false) as service_role_execute_ready,
  coalesce(not has_function_privilege(
    'anon',
    to_regprocedure('public.novel_public_lounge_consume_attestation_v5(text,text,text,text,text,text,text,timestamp with time zone)'),
    'EXECUTE'
  ), false) as anon_execute_revoked,
  coalesce(not has_function_privilege(
    'authenticated',
    to_regprocedure('public.novel_public_lounge_consume_attestation_v5(text,text,text,text,text,text,text,timestamp with time zone)'),
    'EXECUTE'
  ), false) as authenticated_execute_revoked,
  coalesce((
    select function_record.prosecdef
      and position('on conflict (attestation_id_hash) do nothing' in lower(pg_catalog.pg_get_functiondef(function_record.oid))) > 0
      and position('clock_timestamp()' in lower(pg_catalog.pg_get_functiondef(function_record.oid))) > 0
      from pg_catalog.pg_proc as function_record
     where function_record.oid = to_regprocedure('public.novel_public_lounge_consume_attestation_v5(text,text,text,text,text,text,text,timestamp with time zone)')
  ), false) as consume_definition_ready,
  exists(select 1 from public.schema_migrations where version = '${MIGRATION_VERSION}') as marker_ready;
`;

function ready(value) {
  const row = Array.isArray(value) ? value[0] : value;
  return row?.ledger_table_ready === true
    && row?.consume_rpc_ready === true
    && row?.status_rpc_ready === true
    && row?.rls_ready === true
    && row?.primary_key_ready === true
    && row?.attestation_digest_unique_ready === true
    && row?.ticket_hash_unique_ready === true
    && row?.service_role_table_revoked === true
    && row?.anon_table_revoked === true
    && row?.authenticated_table_revoked === true
    && row?.service_role_execute_ready === true
    && row?.anon_execute_revoked === true
    && row?.authenticated_execute_revoked === true
    && row?.consume_definition_ready === true
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
    fail("migration_verification_failed", "PUBLIC_LOUNGE_ATTESTATION_LEDGER_NOT_READY");
  }
  console.log(JSON.stringify({
    status: "migration_applied_and_verified",
    migrationVersion: MIGRATION_VERSION,
    projectRefSuffix: projectRef.slice(-4),
  }));
} catch (error) {
  fail("migration_failed", String(error?.code || error?.name || "SUPABASE_PUBLIC_LOUNGE_ATTESTATION_MIGRATION_FAILED"));
}

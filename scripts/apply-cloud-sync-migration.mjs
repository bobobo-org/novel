import { readFile } from "node:fs/promises";

const MIGRATION_VERSION = "cloud_sync_e2ee_025";
const args = new Set(process.argv.slice(2));
const required = args.has("--required");
const checkOnly = args.has("--check");
const allowStagedRuntimeVerification = args.has("--allow-staged-runtime-verification");
const envFileIndex = process.argv.indexOf("--env-file");
const envFile = envFileIndex >= 0 ? process.argv[envFileIndex + 1] : "";

function parseEnvFile(source) {
  const parsed = {};
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function projectRefFromUrl(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname;
    const candidate = host.split(".")[0] ?? "";
    return /^[a-z0-9]{8,32}$/u.test(candidate) ? candidate : "";
  } catch {
    return "";
  }
}

const fileEnv = envFile
  ? parseEnvFile(await readFile(envFile, "utf8"))
  : {};
const env = { ...fileEnv, ...process.env };
const accessToken = env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_MANAGEMENT_TOKEN || "";
const projectRef = env.SUPABASE_PROJECT_REF
  || projectRefFromUrl(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "");
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || "";
const serviceRoleCredential = env.SUPABASE_SERVICE_ROLE_KEY || "";

function serviceRoleHeaders() {
  const headers = {
    apikey: serviceRoleCredential,
    accept: "application/json",
  };
  if (String(serviceRoleCredential).split(".").length === 3) {
    headers.authorization = `Bearer ${serviceRoleCredential}`;
  }
  return headers;
}

async function verifyExistingMigrationViaRest() {
  if (!supabaseUrl || !serviceRoleCredential) {
    return { ready: false, status: "runtime_configuration_missing" };
  }
  const base = supabaseUrl.replace(/\/$/u, "");
  try {
    const [markerResponse, snapshotsResponse, operationsResponse, openApiResponse] = await Promise.all([
      fetch(`${base}/rest/v1/schema_migrations?select=version&version=eq.${MIGRATION_VERSION}&limit=1`, {
        headers: serviceRoleHeaders(),
      }),
      fetch(`${base}/rest/v1/novel_cloud_snapshots?select=project_id&limit=0`, {
        headers: serviceRoleHeaders(),
      }),
      fetch(`${base}/rest/v1/novel_cloud_sync_operations?select=operation_id&limit=0`, {
        headers: serviceRoleHeaders(),
      }),
      fetch(`${base}/rest/v1/`, {
        headers: { ...serviceRoleHeaders(), accept: "application/openapi+json" },
      }),
    ]);
    const markerRows = await markerResponse.json().catch(() => null);
    const openApi = await openApiResponse.json().catch(() => null);
    await Promise.all([
      snapshotsResponse.body?.cancel().catch(() => undefined),
      operationsResponse.body?.cancel().catch(() => undefined),
    ]);
    const markerReady = markerResponse.ok
      && Array.isArray(markerRows)
      && markerRows.some((row) => row?.version === MIGRATION_VERSION);
    const rpcReady = openApiResponse.ok
      && Boolean(openApi?.paths?.["/rpc/novel_cloud_sync_push"]);
    const ready = markerReady
      && snapshotsResponse.ok
      && operationsResponse.ok
      && rpcReady;
    return { ready, status: ready ? "ready" : "migration_required" };
  } catch {
    return { ready: false, status: "runtime_verification_failed" };
  }
}

const configuration = {
  accessTokenConfigured: Boolean(accessToken),
  projectRefConfigured: Boolean(projectRef),
  migrationVersion: MIGRATION_VERSION,
};
const existingMigration = await verifyExistingMigrationViaRest();

if (checkOnly) {
  console.log(JSON.stringify({
    status: existingMigration.ready
      ? "migration_already_verified_via_rest"
      : (configuration.accessTokenConfigured && configuration.projectRefConfigured
        ? "migration_channel_ready"
        : "migration_channel_missing"),
    ...configuration,
    runtimeMigrationStatus: existingMigration.status,
  }));
  process.exit(0);
}

if (existingMigration.ready) {
  console.log(JSON.stringify({
    status: "migration_already_verified_via_rest",
    migrationVersion: MIGRATION_VERSION,
    projectRefSuffix: projectRef ? projectRef.slice(-4) : null,
  }));
  process.exit(0);
}

if (!accessToken || !projectRef) {
  console.error(JSON.stringify({
    status: "migration_channel_missing",
    ...configuration,
    runtimeMigrationStatus: existingMigration.status,
  }));
  if (required && !allowStagedRuntimeVerification) process.exit(2);
  if (allowStagedRuntimeVerification) {
    console.log(JSON.stringify({
      status: "migration_deferred_to_staged_runtime",
      migrationVersion: MIGRATION_VERSION,
      reason: "management_channel_missing",
    }));
  }
  process.exit(0);
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
      throw Object.assign(new Error(`SUPABASE_MIGRATION_HTTP_${response.status}`), {
        code: `SUPABASE_MIGRATION_HTTP_${response.status}`,
        status: response.status,
      });
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

try {
  const sql = await readFile(new URL("../prisma/migrations/025_cloud_sync_e2ee.sql", import.meta.url), "utf8");
  await query(sql);
  const verification = await query(`
    select
      to_regclass('public.novel_cloud_snapshots') is not null as snapshots_ready,
      to_regclass('public.novel_cloud_sync_operations') is not null as operations_ready,
      to_regprocedure('public.novel_cloud_sync_push(text,text,text,bigint,text,integer,jsonb)') is not null as rpc_ready,
      exists(select 1 from public.schema_migrations where version = '${MIGRATION_VERSION}') as marker_ready;
  `);
  const row = Array.isArray(verification) ? verification[0] : verification;
  const ready = row?.snapshots_ready === true
    && row?.operations_ready === true
    && row?.rpc_ready === true
    && row?.marker_ready === true;
  if (!ready) throw Object.assign(new Error("SUPABASE_MIGRATION_VERIFICATION_FAILED"), {
    code: "SUPABASE_MIGRATION_VERIFICATION_FAILED",
  });
  console.log(JSON.stringify({
    status: "migration_applied_and_verified",
    migrationVersion: MIGRATION_VERSION,
    projectRefSuffix: projectRef.slice(-4),
  }));
} catch (error) {
  if (allowStagedRuntimeVerification && [401, 403].includes(error?.status)) {
    console.log(JSON.stringify({
      status: "migration_deferred_to_staged_runtime",
      migrationVersion: MIGRATION_VERSION,
      reason: "management_channel_unauthorized",
    }));
    process.exit(0);
  }
  console.error(JSON.stringify({
    status: "migration_failed",
    migrationVersion: MIGRATION_VERSION,
    errorCode: String(error?.code || error?.name || "SUPABASE_MIGRATION_FAILED"),
  }));
  process.exit(1);
}
